// Menú de entrenamiento: packs oficiales y propios por categoría y dificultad, opciones, importar y compartir.

import { deleteCustomPack, decodePack, encodePack, loadBest, loadCustomPacks, upsertCustomPack } from './codes.ts';
import { askText, button, confirmBox, copyText, el, esc, overlay } from './dom.ts';
import type { Extras } from './extras.ts';
import { OFFICIAL_PACKS } from './packs.ts';
import { CATEGORIES, CATEGORY_NAMES, DIFFICULTIES, DIFFICULTY_LABELS, type Pack, type ShotCategory, type ShotDifficulty } from './types.ts';

let lastCat: ShotCategory | 'todas' = 'todas';
let lastDiff: ShotDifficulty | 'todas' = 'todas';

export function newPack(category: ShotCategory = 'delantero'): Pack {
  return {
    id: 'own-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: 'Mi pack',
    category,
    difficulty: 'novato',
    author: 'Vos',
    description: '',
    shots: [{ ball: { p: [0, 2600, 93], v: [0, 0, 0] }, car: { p: [0, 600, 17], yaw: 90, boost: 100 } }],
    created: Date.now(),
  };
}

export class TrainingMenu {
  private ext: Extras;
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private list!: HTMLDivElement;

  constructor(ext: Extras) {
    this.ext = ext;
    const o = overlay('tg-training');
    this.root = o.root;
    this.panel = o.panel;
    this.build();
  }

  close() { this.root.remove(); }

  private click() { this.ext.g.audio.start(); this.ext.g.audio.click(); }

  private build() {
    const p = this.panel;
    p.innerHTML = '';
    p.appendChild(el('header', 'panel-head', '<h2>Entrenamiento</h2><p class="sub">Elegí un pack: cada tiro arranca cuando te movés. <kbd>R</kbd> reintenta, <kbd>N</kbd> y <kbd>B</kbd> cambian de tiro y con <kbd>Z</kbd> apretada rebobinás.</p>'));

    // Filtros
    const filters = el('div', 'tg-filters');
    const seg = <T extends string>(values: (T | 'todas')[], labels: Record<string, string>, cur: T | 'todas', set: (v: T | 'todas') => void) => {
      const s = el('div', 'seg');
      for (const v of values) {
        const b = button(v === 'todas' ? 'Todas' : labels[v], v === cur ? 'on' : '', () => { this.click(); set(v); this.build(); });
        s.appendChild(b);
      }
      return s;
    };
    const field = (label: string, control: HTMLElement) => { const f = el('div', 'field', `<span>${label}</span>`); f.appendChild(control); return f; };
    filters.append(
      field('Posición', seg<ShotCategory>(['todas', ...CATEGORIES], CATEGORY_NAMES, lastCat, (v) => { lastCat = v; })),
      field('Dificultad', seg<ShotDifficulty>(['todas', ...DIFFICULTIES], DIFFICULTY_LABELS, lastDiff, (v) => { lastDiff = v; })),
    );

    // Opciones
    const opts = el('div', 'tg-opts');
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = button(`${label}: <b>${get() ? 'Sí' : 'No'}</b>`, 'tg-toggle' + (get() ? ' on' : ''), () => {
        this.click();
        set(!get());
        this.ext.saveOpts();
        b.innerHTML = `${label}: <b>${get() ? 'Sí' : 'No'}</b>`;
        b.classList.toggle('on', get());
      });
      return b;
    };
    opts.append(
      toggle('Variación leve', () => this.ext.opts.variance, (v) => { this.ext.opts.variance = v; }),
      toggle('Turbo infinito', () => this.ext.opts.unlimitedBoost, (v) => { this.ext.opts.unlimitedBoost = v; }),
    );
    filters.appendChild(opts);
    p.appendChild(filters);

    this.list = el('div', 'tg-packs');
    p.appendChild(this.list);
    this.fillList();

    const actions = el('div', 'actions');
    actions.append(
      button('Volver', 'btn', () => { this.click(); this.ext.backToMenu(); }),
      button('Importar código', 'btn', () => { this.click(); void this.importCode(); }),
      button('Crear pack', 'btn primary', () => {
        this.click();
        this.ext.openEditor(newPack(lastCat === 'todas' ? 'delantero' : lastCat), 0);
      }),
    );
    p.appendChild(actions);
  }

  private fillList() {
    const best = loadBest();
    const custom = loadCustomPacks();
    const all = [...OFFICIAL_PACKS, ...custom].filter((pk) => (lastCat === 'todas' || pk.category === lastCat) && (lastDiff === 'todas' || pk.difficulty === lastDiff));
    this.list.innerHTML = '';
    if (!all.length) {
      this.list.appendChild(el('p', 'tip tg-empty', 'No hay packs con estos filtros. Creá uno o importá un código.'));
      return;
    }
    for (const pk of all) {
      const card = el('div', `card tg-pack cat-${pk.category}`);
      const b = best[pk.id];
      card.innerHTML =
        `<div class="tg-pack-head"><b>${esc(pk.name)}</b>${pk.official ? '<span class="tag tg-badge">Oficial</span>' : '<span class="tag accent tg-badge own">Propio</span>'}</div>` +
        `<div class="tg-pack-meta">${CATEGORY_NAMES[pk.category]} · ${DIFFICULTY_LABELS[pk.difficulty]} · ${pk.shots.length} tiros${pk.official ? '' : ` · ${esc(pk.author)}`}` +
        `${b !== undefined ? ` · <span class="tg-best">Mejor: ${b} de ${pk.shots.length}</span>` : ''}</div>` +
        (pk.description ? `<div class="tg-pack-desc">${esc(pk.description)}</div>` : '');
      const row = el('div', 'tg-pack-actions');
      row.append(
        button('Jugar', 'btn primary small', () => { this.click(); this.ext.startTraining(pk, 0); }),
        button(pk.official ? 'Editar copia' : 'Editar', 'btn small', () => {
          this.click();
          const copy: Pack = pk.official
            ? { ...structuredClone(pk), id: 'own-' + Date.now().toString(36), name: pk.name + ' (copia)', author: 'Vos', official: false, created: Date.now() }
            : structuredClone(pk);
          this.ext.openEditor(copy, 0);
        }),
        button('Compartir', 'btn small', () => { this.click(); void this.share(pk); }),
      );
      if (!pk.official) {
        row.appendChild(button('Borrar', 'btn small danger', async () => {
          this.click();
          if (await confirmBox('Borrar pack', `¿Borrar "${pk.name}"? No se puede deshacer.`, 'Borrar')) { deleteCustomPack(pk.id); this.fillList(); }
        }));
      }
      card.appendChild(row);
      this.list.appendChild(card);
    }
  }

  private async share(pk: Pack) {
    const code = await encodePack(pk);
    const ok = await copyText(code);
    await askText(ok ? 'Código copiado al portapapeles' : 'Copiá este código', code, '', true);
  }

  private async importCode() {
    const code = await askText('Importar pack', '', 'Pegá un código TG1-…', true);
    if (!code) return;
    try {
      const pk = await decodePack(code);
      upsertCustomPack(pk);
      lastCat = pk.category;
      lastDiff = 'todas';
      this.build();
      this.ext.toast(`Pack "${pk.name}" importado (${pk.shots.length} tiros)`);
    } catch (e) {
      this.ext.toast((e as Error).message);
    }
  }
}
