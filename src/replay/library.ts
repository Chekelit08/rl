// Biblioteca de repeticiones (partidos completos) y clips guardados en el navegador.

import { askText, button, confirmBox, download, el, esc, fmtDate, fmtTime, overlay } from '../training/dom.ts';
import type { Extras } from '../training/extras.ts';
import { canExportVideo } from './exporter.ts';
import { packFile, type ReplayKind, type ReplayMeta, unpackFile } from './format.ts';
import { deleteReplay, listReplays, loadReplay, saveReplay, updateMeta } from './store.ts';

export class ReplayLibrary {
  private ext: Extras;
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private tab: ReplayKind;
  private list!: HTMLDivElement;

  constructor(ext: Extras, tab: ReplayKind) {
    this.ext = ext;
    this.tab = tab;
    const o = overlay('tg-library');
    this.root = o.root;
    this.panel = o.panel;
    this.build();
  }

  close() { this.root.remove(); }

  private click() { this.ext.g.audio.start(); this.ext.g.audio.click(); }

  private build() {
    const p = this.panel;
    p.innerHTML = '';
    p.appendChild(el('h2', '', 'Repeticiones y clips'));
    const tabs = el('div', 'seg tg-tabs');
    for (const [k, label] of [['partido', 'Partidos'], ['clip', 'Clips']] as const) {
      tabs.appendChild(button(label, k === this.tab ? 'on' : '', () => { this.click(); this.tab = k; this.build(); }));
    }
    p.appendChild(tabs);
    p.appendChild(el('p', 'tip', this.tab === 'partido'
      ? 'Los partidos se graban solos y se guardan al terminar (se conservan los últimos 10; los marcados con ★ no se borran).'
      : 'Guardá un clip con <b>G</b> (o D-pad ↓) mientras jugás: se guardan los últimos 15 segundos.'));
    this.list = el('div', 'tg-replays');
    this.list.textContent = 'Cargando…';
    p.appendChild(this.list);
    const actions = el('div', 'actions');
    const file = el('input');
    file.type = 'file';
    file.accept = '.tgrep,application/octet-stream';
    file.style.display = 'none';
    file.addEventListener('change', () => { if (file.files?.[0]) void this.importFile(file.files[0]); file.value = ''; });
    actions.append(
      file,
      button('Volver', 'btn', () => { this.click(); this.ext.backToMenu(); }),
      button('Importar archivo', 'btn', () => { this.click(); file.click(); }),
    );
    p.appendChild(actions);
    void this.fill();
  }

  private async fill() {
    const items = await listReplays(this.tab);
    this.list.innerHTML = '';
    if (!items.length) {
      this.list.appendChild(el('p', 'tip', this.tab === 'partido' ? 'Todavía no hay partidos grabados. Jugá uno contra los bots.' : 'Todavía no guardaste clips.'));
      return;
    }
    for (const m of items) this.list.appendChild(this.row(m));
  }

  private row(m: ReplayMeta) {
    const r = el('div', 'tg-replay');
    const score = m.kind === 'partido' || m.goals.length
      ? `<span class="tg-score"><span class="b">${m.score[0]}</span>–<span class="r">${m.score[1]}</span></span>` : '';
    const result = m.kind === 'partido' ? (m.winner === -2 ? ' · sin terminar' : m.winner === 0 ? ' · victoria azul' : m.winner === 1 ? ' · victoria roja' : ' · empate') : '';
    r.innerHTML =
      `<div class="tg-replay-info"><b>${m.saved ? '★ ' : ''}${esc(m.title)}</b>` +
      `<small>${fmtDate(m.date)} · ${esc(m.mode)} · ${fmtTime(m.duration)}${result}${m.goals.length ? ` · ${m.goals.length} gol${m.goals.length > 1 ? 'es' : ''}` : ''}</small></div>${score}`;
    const act = el('div', 'tg-replay-actions');
    act.append(
      button('Ver', 'btn primary small', () => { this.click(); void this.ext.openViewer(m.id); }),
    );
    if (canExportVideo()) {
      act.appendChild(button(m.kind === 'clip' ? 'Exportar WebM' : 'Video…', 'btn small', () => {
        this.click();
        if (m.kind === 'clip') void this.ext.openViewer(m.id, true);
        else { this.ext.toast('Elegí el momento en el visor y tocá "Exportar"'); void this.ext.openViewer(m.id); }
      }));
    }
    act.append(
      button(m.saved ? '★' : '☆', 'btn small', async () => {
        this.click();
        await updateMeta({ ...m, saved: !m.saved });
        void this.fill();
      }),
      button('Renombrar', 'btn small', async () => {
        this.click();
        const t = await askText('Nombre', m.title);
        if (t && t.trim()) { await updateMeta({ ...m, title: t.trim().slice(0, 60) }); void this.fill(); }
      }),
      button('Archivo', 'btn small', async () => {
        this.click();
        const d = await loadReplay(m.id);
        if (d) download(await packFile(d.meta, d.frames), `turbogol-${m.kind}-${m.id}.tgrep`);
      }),
      button('Borrar', 'btn small danger', async () => {
        this.click();
        if (await confirmBox('Borrar', `¿Borrar "${m.title}"?`, 'Borrar')) { await deleteReplay(m.id); void this.fill(); }
      }),
    );
    r.appendChild(act);
    return r;
  }

  private async importFile(f: File) {
    try {
      const { meta, frames } = await unpackFile(await f.arrayBuffer());
      const m: ReplayMeta = { ...meta, saved: true, date: meta.date || Date.now() };
      await saveReplay(m, frames);
      this.tab = m.kind;
      this.build();
      this.ext.toast(`Importado: ${m.title}`);
    } catch (e) {
      this.ext.toast((e as Error).message || 'Archivo inválido');
    }
  }
}
