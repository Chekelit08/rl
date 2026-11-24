// Pantallas de Competitivo, Perfil y Reasignar controles.

import { TITLES, BANNERS } from '../garage/cosmetics.ts';
import { getLoadout, setLoadout } from '../garage/loadout.ts';
import { ACTION_LABELS, ACTIONS, codeName, DEFAULT_CONTROLS, getControls, padName, PAD_ACTIONS, resetControls, saveControls, type Action, type InputManager } from '../input/input.ts';
import { getProfile, levelInfo, setPlayerName } from '../progression/progression.ts';
import { bestTier, getRanked, PLACEMENT_MATCHES, PLAYLISTS, rankFor, TIER_COLORS, TIER_NAMES, type Playlist } from '../progression/ranked.ts';
import { bannerBg } from './banner.ts';
import { fillRanges } from './range.ts';
import { rankIcon } from './rankIcons.ts';

export function overlay(id: string, panelCls = 'wide'): { el: HTMLDivElement; panel: HTMLDivElement } {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'overlay hidden w5';
  const panel = document.createElement('div');
  panel.className = 'panel ' + panelCls;
  el.append(panel);
  document.body.append(el);
  return { el, panel };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---------------- Competitivo ----------------
export class RankedScreen {
  el: HTMLDivElement;
  private panel: HTMLDivElement;
  private searching = false;

  constructor(private onPlay: (p: Playlist) => void) {
    ({ el: this.el, panel: this.panel } = overlay('ui-ranked', 'xl'));
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-play]') as HTMLElement | null;
      if (b && !this.searching) this.search(b.dataset.play as Playlist);
    });
  }

  render() {
    this.searching = false;
    const st = getRanked();
    const cards = PLAYLISTS.map((pl) => {
      const r = st[pl.id];
      const placed = r.played >= PLACEMENT_MATCHES;
      const rk = rankFor(r.r, placed);
      const pk = rankFor(r.peak, placed);
      const left = PLACEMENT_MATCHES - r.played;
      const streak = r.streak >= 2 ? `<span class="tag green">Racha de ${r.streak}</span>` : r.streak <= -2 ? `<span class="tag red">${-r.streak} derrotas seguidas</span>` : '';
      return `
      <div class="rk-card card" data-pl="${pl.id}" style="--tc:${placed ? TIER_COLORS[rk.tier] : 'var(--line-2)'}">
        <div class="rk-top"><h3>${pl.name}</h3>${streak}</div>
        <div class="rk-icon">${placed ? rankIcon(rk.tier, rk.sub) : '<div class="unranked">?</div>'}</div>
        <div class="rk-name">${placed ? rk.short : 'Sin clasificar'}</div>
        <span class="bar rank"><i style="width:${(placed ? rk.frac : r.played / PLACEMENT_MATCHES) * 100}%"></i></span>
        <div class="rk-mmr">${placed ? `MMR ${Math.round(r.r)} · mejor: ${pk.name}` : left === 1 ? `Clasificatoria ${r.played} de ${PLACEMENT_MATCHES} · falta 1` : `Clasificatoria ${r.played} de ${PLACEMENT_MATCHES} · faltan ${left}`}</div>
        <div class="rk-rec"><span><b>${r.wins}</b> ganados</span><span><b>${r.played - r.wins}</b> perdidos</span></div>
        <button class="btn primary" data-play="${pl.id}">${placed ? 'Buscar partida' : 'Jugar clasificatoria'}</button>
        <div class="rk-wait"><span class="bar"><i></i></span>Buscando rivales…</div>
      </div>`;
    }).join('');
    const best = bestTier();
    const ladder = TIER_NAMES.map((n, t) => `<div class="ld${t === best ? ' on' : ''}" style="--tc:${TIER_COLORS[t]}">${rankIcon(t, -1)}<span>${n}</span></div>`).join('');
    this.panel.innerHTML = `
      <header class="panel-head"><h2>Competitivo</h2><p class="sub">Jugás contra bots de tu nivel. Diez partidas de clasificación por modo definen tu rango; abandonar cuenta como derrota.</p></header>
      <div class="rk-grid">${cards}</div>
      <h3>Escalera de rangos</h3>
      <div class="rk-ladder">${ladder}</div>
      <div class="actions"><button class="btn" data-ui="back">Volver</button></div>`;
  }

  private search(p: Playlist) {
    this.searching = true;
    this.panel.classList.add('searching');
    this.panel.querySelector(`.rk-card[data-pl="${p}"]`)?.classList.add('picked');
    setTimeout(() => {
      // Si mientras tanto se cerró la pantalla, no arranca nada
      if (this.searching && !this.el.classList.contains('hidden')) this.onPlay(p);
      this.searching = false;
      this.panel.classList.remove('searching');
    }, 1100);
  }
}

// ---------------- Perfil ----------------
export class ProfileScreen {
  el: HTMLDivElement;
  private panel: HTMLDivElement;

  constructor(private unlocked: (u: { level?: number; tier?: number }) => boolean) {
    ({ el: this.el, panel: this.panel } = overlay('ui-profile', 'xl'));
    this.el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'pfName') { setPlayerName(t.value); this.render(); }
      if (t.id === 'pfTitle') { setLoadout({ title: t.value }); this.render(); }
      if (t.id === 'pfBanner') { setLoadout({ banner: t.value }); this.render(); }
    });
  }

  render() {
    const p = getProfile();
    const lv = levelInfo(p.xp);
    const s = p.stats;
    const lo = getLoadout();
    const bn = BANNERS.find((b) => b.id === lo.banner) ?? BANNERS[0];
    const title = TITLES.find((t) => t.id === lo.title)?.name ?? '';
    const st = getRanked();
    const best = PLAYLISTS.map((pl) => ({ pl, rk: rankFor(st[pl.id].r, st[pl.id].played >= PLACEMENT_MATCHES), placed: st[pl.id].played >= PLACEMENT_MATCHES }));
    const per = (a: number, b: number) => (b ? (a / b).toFixed(2) : '—');
    const hist = p.history.slice(0, 7).map((h) => `<tr><td>${new Date(h.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</td><td>${esc(h.playlist)}</td><td><span class="tag ${h.won ? 'green' : 'red'}">${h.won ? 'Ganado' : 'Perdido'}</span></td><td>${h.score[0]}–${h.score[1]}</td><td>${h.myScore}${h.mvp ? '<span class="tag accent">MVP</span>' : ''}</td><td>+${h.xp}</td></tr>`).join('');
    const hrs = s.secondsPlayed >= 3600 ? `${(s.secondsPlayed / 3600).toFixed(1)} h` : `${Math.round(s.secondsPlayed / 60)} min`;
    const opt = (list: { id: string; name: string; unlock: { level?: number; tier?: number } }[], cur: string) =>
      list.filter((i) => this.unlocked(i.unlock)).map((i) => `<option value="${i.id}"${i.id === cur ? ' selected' : ''}>${i.name}</option>`).join('');
    const key: [string, string | number][] = [['Partidos', s.matches], ['Victorias', s.matches ? `${Math.round((s.wins / s.matches) * 100)}%` : '—'], ['Goles', s.goals], ['MVP', s.mvps]];
    const rows: [string, string | number][] = [
      ['Ganados', s.wins], ['Perdidos', s.losses], ['Asistencias', s.assists], ['Tiros', s.shots], ['Atajadas', s.saves], ['Atajadas épicas', s.epicSaves],
      ['Demoliciones', s.demos], ['Despejes', s.clears], ['Centros', s.centers], ['Toques aéreos', s.aerialHits],
      ['Goles por partido', per(s.goals, s.matches)], ['Gol más rápido', s.fastestGoalKmh ? `${s.fastestGoalKmh} km/h` : '—'], ['Tiempo jugado', hrs],
    ];
    this.panel.innerHTML = `
      <header class="panel-head"><h2>Perfil</h2></header>
      <div class="pf-cols">
        <div>
          <div class="pf-banner" style="background:${bannerBg(bn.style)}">
            <div class="pf-lv">${lv.level}</div>
            <div class="pf-id"><b>${esc(p.name)}</b><span>${esc(title)}</span>
              <span class="bar"><i style="width:${lv.frac * 100}%"></i></span><small>${lv.into} / ${lv.need} XP para el nivel ${lv.level + 1}</small></div>
            <div class="pf-ranks">${best.map((b) => `<div title="${b.pl.name}">${b.placed ? rankIcon(b.rk.tier, b.rk.sub) : '<div class="unranked sm">?</div>'}<small>${b.pl.id}</small></div>`).join('')}</div>
          </div>
          <div class="pf-form">
            <label class="field"><span>Nombre</span><input id="pfName" class="txt" maxlength="16" value="${esc(p.name)}" autocomplete="off" spellcheck="false"></label>
            <label class="field"><span>Título</span><select id="pfTitle" class="txt">${opt(TITLES, lo.title)}</select></label>
            <label class="field"><span>Banner</span><select id="pfBanner" class="txt">${opt(BANNERS, lo.banner)}</select></label>
          </div>
          <h3>Últimos partidos</h3>
          ${hist ? `<table class="stats hist"><tr><th>Fecha</th><th>Modo</th><th>Resultado</th><th>Marcador</th><th>Puntos</th><th>XP</th></tr>${hist}</table>` : '<p class="tip pf-empty">Todavía no jugaste ningún partido. Cuando termines uno, aparece acá.</p>'}
        </div>
        <div>
          <h3>Estadísticas</h3>
          <div class="pf-key">${key.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
          <dl class="pf-list">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        </div>
      </div>
      <div class="actions"><button class="btn" data-ui="back">Volver</button></div>`;
  }
}

// ---------------- Reasignar controles ----------------
export class RemapScreen {
  el: HTMLDivElement;
  private panel: HTMLDivElement;
  private tab: 'teclado' | 'mando' = 'teclado';

  constructor(private input: InputManager) {
    ({ el: this.el, panel: this.panel } = overlay('ui-remap', 'xl'));
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('input', (e) => this.slider(e.target as HTMLInputElement));
    this.el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      const c = getControls();
      if (t.id === 'cInvert') c.invertPitch = t.checked;
      if (t.id === 'cVib') { c.vibration = t.checked; if (t.checked) this.input.rumble(0.8, 0.8, 250); }
      saveControls();
    });
  }

  close() { this.input.cancelCapture(); }

  private slider(t: HTMLInputElement) {
    const c = getControls();
    const out = this.el.querySelector<HTMLOutputElement>(`#${t.id}Out`);
    const v = Number(t.value);
    if (t.id === 'cSteer') c.steerSens = v;
    else if (t.id === 'cAir') c.airSens = v;
    else if (t.id === 'cDead') c.deadzone = v;
    else return;
    if (out) out.textContent = v.toFixed(2);
    saveControls();
  }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const tab = t.closest('[data-tab]') as HTMLElement | null;
    if (tab) { this.tab = tab.dataset.tab as 'teclado' | 'mando'; this.render(); return; }
    if (t.closest('[data-reset]')) { resetControls(); this.render(); return; }
    const slot = t.closest('[data-bind]') as HTMLElement | null;
    if (!slot) return;
    const a = slot.dataset.bind as Action;
    const i = Number(slot.dataset.slot ?? 0);
    slot.textContent = 'Apretá…';
    slot.classList.add('wait');
    const kind = this.tab === 'teclado' ? 'key' : 'pad';
    this.input.captureNext(kind, (v) => {
      const c = getControls();
      if (v !== null) {
        if (kind === 'key') {
          // Una tecla sólo puede estar en una acción
          for (const k of ACTIONS) c.keys[k] = c.keys[k].filter((x) => x !== v);
          const cur = c.keys[a].slice();
          cur[i] = v as string;
          c.keys[a] = cur.filter(Boolean);
        } else {
          for (const k of PAD_ACTIONS) if (c.pad[k] === v && k !== a) c.pad[k] = c.pad[a] ?? DEFAULT_CONTROLS.pad[k];
          c.pad[a] = v as number;
        }
        saveControls();
      }
      this.render();
    });
  }

  render() {
    const c = getControls();
    const key = this.tab === 'teclado';
    const fixed = (label: string, what: string) => `<div class="rm-row"><span>${label}</span><span class="bind fixed">${what}</span></div>`;
    const rows = key
      ? ACTIONS.map((a) => `<div class="rm-row"><span>${ACTION_LABELS[a]}</span>${[0, 1].map((i) => `<button class="bind${c.keys[a][i] ? '' : ' empty'}" data-bind="${a}" data-slot="${i}">${c.keys[a][i] ? codeName(c.keys[a][i]) : '—'}</button>`).join('')}</div>`)
      : [...PAD_ACTIONS.map((a) => `<div class="rm-row"><span>${ACTION_LABELS[a]}</span><button class="bind" data-bind="${a}">${padName(c.pad[a] ?? -1)}</button></div>`),
        fixed('Acelerar / reversa', 'RT / LT'), fixed('Dirección y nariz', 'Stick izquierdo'), fixed('Mirar alrededor', 'Stick derecho'), fixed('Chat rápido', 'Cruceta')];
    const sl = (id: string, label: string, min: number, max: number, v: number) =>
      `<div class="slider"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="0.05" value="${v}"><output id="${id}Out">${v.toFixed(2)}</output></div>`;
    this.panel.innerHTML = `
      <header class="panel-head"><h2>Reasignar controles</h2><p class="sub">Hacé clic en una casilla y apretá la tecla o el botón nuevo. Esc cancela. También valen los botones del mouse.</p></header>
      <div class="tabs rm-tabs"><button data-tab="teclado" class="${key ? 'on' : ''}">Teclado y mouse</button><button data-tab="mando" class="${key ? '' : 'on'}">Mando</button></div>
      <div class="rm-body">
        <div>
          <div class="rm-binds ${key ? 'keys' : 'pad'}" style="--rows:${Math.ceil(rows.length / 2)}">${rows.join('')}</div>
        </div>
        <div class="rm-side">
          <h3>Sensibilidad del mando</h3>
          <div class="sliders">
            ${sl('cSteer', 'Dirección', 0.5, 2, c.steerSens)}
            ${sl('cAir', 'En el aire', 0.5, 2, c.airSens)}
            ${sl('cDead', 'Zona muerta', 0, 0.4, c.deadzone)}
          </div>
          <label class="chk"><input type="checkbox" id="cInvert"${c.invertPitch ? ' checked' : ''}> Invertir arriba y abajo en el aire</label>
          <label class="chk"><input type="checkbox" id="cVib"${c.vibration ? ' checked' : ''}> Vibración del mando</label>
        </div>
      </div>
      <div class="actions"><button class="btn" data-reset="1">Restablecer</button><button class="btn primary" data-ui="back">Listo</button></div>`;
    fillRanges(this.panel);
  }
}
