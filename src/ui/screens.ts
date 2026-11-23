// Pantallas de Competitivo, Perfil y Reasignar controles.

import { TITLES, BANNERS } from '../garage/cosmetics.ts';
import { getLoadout, setLoadout } from '../garage/loadout.ts';
import { ACTION_LABELS, ACTIONS, codeName, DEFAULT_CONTROLS, getControls, padName, PAD_ACTIONS, resetControls, saveControls, type Action, type InputManager } from '../input/input.ts';
import { getProfile, levelInfo, setPlayerName } from '../progression/progression.ts';
import { getRanked, ICON_MMR, PLACEMENT_MATCHES, PLAYLISTS, rankFor, TIER_COLORS, TIER_NAMES, type Playlist } from '../progression/ranked.ts';
import { bannerBg } from './banner.ts';
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
    ({ el: this.el, panel: this.panel } = overlay('ui-ranked'));
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
      return `
      <div class="rk-card" style="--tc:${placed ? TIER_COLORS[rk.tier] : '#5a6a85'}">
        <h3>${pl.name}</h3>
        <div class="rk-icon">${placed ? rankIcon(rk.tier, rk.sub, 96, pl.id) : '<div class="unranked">?</div>'}</div>
        <div class="rk-name">${placed ? rk.short : 'Sin clasificar'}</div>
        ${placed
          ? `<div class="pm-bar rank"><i style="width:${rk.frac * 100}%"></i></div><div class="rk-mmr">MMR ${Math.round(r.r)} · pico ${pk.name}</div>`
          : `<div class="pm-bar rank"><i style="width:${(r.played / PLACEMENT_MATCHES) * 100}%"></i></div><div class="rk-mmr">Clasificatoria ${r.played}/${PLACEMENT_MATCHES} · faltan ${left}</div>`}
        <div class="rk-rec">${r.wins} G · ${r.played - r.wins} P${r.streak >= 2 ? ` · racha ${r.streak}` : r.streak <= -2 ? ` · mala racha ${-r.streak}` : ''}</div>
        <button class="btn primary" data-play="${pl.id}">${placed ? 'Buscar partida' : 'Jugar clasificatoria'}</button>
      </div>`;
    }).join('');
    const ladder = TIER_NAMES.map((n, t) => `<div class="ld" style="--tc:${TIER_COLORS[t]}">${rankIcon(t, t === 7 ? -1 : 1, 40, 'ld')}<span>${n}</span></div>`).join('');
    this.panel.innerHTML = `
      <h2>Competitivo</h2>
      <p class="tip">Partidas clasificatorias contra bots. Tu MMR (Glicko-2) define el rango y la dificultad de los bots. ${PLACEMENT_MATCHES} partidas de clasificación por modo; abandonar cuenta como derrota. Ícono desde ${Math.round(ICON_MMR)} MMR.</p>
      <div class="rk-grid">${cards}</div>
      <div class="rk-ladder">${ladder}</div>
      <div class="rk-search hidden" id="rkSearch"><div class="spinner"></div><span>Buscando rivales…</span></div>
      <div class="actions"><button class="btn" data-ui="back">Volver</button></div>`;
  }

  private search(p: Playlist) {
    this.searching = true;
    this.panel.querySelector('#rkSearch')?.classList.remove('hidden');
    setTimeout(() => { if (this.searching) this.onPlay(p); }, 1100);
  }
}

// ---------------- Perfil ----------------
export class ProfileScreen {
  el: HTMLDivElement;
  private panel: HTMLDivElement;

  constructor(private unlocked: (u: { level?: number; tier?: number }) => boolean) {
    ({ el: this.el, panel: this.panel } = overlay('ui-profile'));
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
    const kd = (a: number, b: number) => (b ? (a / b).toFixed(2) : a.toFixed(0));
    const hist = p.history.slice(0, 8).map((h) => `<tr class="${h.won ? 'w' : 'l'}"><td>${new Date(h.date).toLocaleDateString('es-AR')}</td><td>${esc(h.playlist)}</td><td>${h.score[0]}–${h.score[1]}</td><td>${h.myScore}</td><td>${h.mvp ? '★' : ''}</td><td>+${h.xp}</td></tr>`).join('');
    const hrs = s.secondsPlayed >= 3600 ? `${(s.secondsPlayed / 3600).toFixed(1)} h` : `${Math.round(s.secondsPlayed / 60)} min`;
    const opt = (list: { id: string; name: string; unlock: { level?: number; tier?: number } }[], cur: string) =>
      list.filter((i) => this.unlocked(i.unlock)).map((i) => `<option value="${i.id}"${i.id === cur ? ' selected' : ''}>${i.name}</option>`).join('');
    this.panel.innerHTML = `
      <h2>Perfil y estadísticas</h2>
      <div class="pf-banner" style="background:${bannerBg(bn.style)}">
        <div class="pf-lv">${lv.level}</div>
        <div class="pf-id"><b>${esc(p.name)}</b><span>${esc(title)}</span>
          <div class="pm-bar"><i style="width:${lv.frac * 100}%"></i></div><small>${lv.into} / ${lv.need} XP al nivel ${lv.level + 1}</small></div>
        <div class="pf-ranks">${best.map((b) => `<div title="${b.pl.name}">${b.placed ? rankIcon(b.rk.tier, b.rk.sub, 40, 'pf' + b.pl.id) : '<div class="unranked sm">?</div>'}<small>${b.pl.id}</small></div>`).join('')}</div>
      </div>
      <div class="row"><label for="pfName">Nombre</label><input id="pfName" class="txt" maxlength="16" value="${esc(p.name)}"></div>
      <div class="row"><label for="pfTitle">Título</label><select id="pfTitle" class="txt">${opt(TITLES, lo.title)}</select></div>
      <div class="row"><label for="pfBanner">Banner</label><select id="pfBanner" class="txt">${opt(BANNERS, lo.banner)}</select></div>
      <div class="pf-grid">
        ${[['Partidos', s.matches], ['Victorias', s.wins], ['Derrotas', s.losses], ['% victorias', s.matches ? Math.round((s.wins / s.matches) * 100) + '%' : '—'],
        ['Goles', s.goals], ['Asistencias', s.assists], ['Atajadas', s.saves], ['Atajadas épicas', s.epicSaves], ['Tiros', s.shots], ['Demoliciones', s.demos],
        ['MVP', s.mvps], ['Despejes', s.clears], ['Centros', s.centers], ['Toques aéreos', s.aerialHits], ['Goles/partido', kd(s.goals, s.matches)], ['Gol más rápido', s.fastestGoalKmh ? s.fastestGoalKmh + ' km/h' : '—'], ['Tiempo jugado', hrs]]
          .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}
      </div>
      <h3>Últimos partidos</h3>
      ${hist ? `<table class="stats hist"><tr><th>Fecha</th><th>Modo</th><th>Marcador</th><th>Puntos</th><th>MVP</th><th>XP</th></tr>${hist}</table>` : '<p class="tip">Todavía no jugaste ningún partido.</p>'}
      <div class="actions"><button class="btn" data-ui="back">Volver</button></div>`;
  }
}

// ---------------- Reasignar controles ----------------
export class RemapScreen {
  el: HTMLDivElement;
  private panel: HTMLDivElement;
  private tab: 'teclado' | 'mando' = 'teclado';

  constructor(private input: InputManager) {
    ({ el: this.el, panel: this.panel } = overlay('ui-remap'));
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
    slot.textContent = 'Presioná…';
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
    const rows = this.tab === 'teclado'
      ? ACTIONS.map((a) => `<tr><td>${ACTION_LABELS[a]}</td>${[0, 1].map((i) => `<td><button class="bind" data-bind="${a}" data-slot="${i}">${c.keys[a][i] ? codeName(c.keys[a][i]) : '—'}</button></td>`).join('')}</tr>`).join('')
      : PAD_ACTIONS.map((a) => `<tr><td>${ACTION_LABELS[a]}</td><td colspan="2"><button class="bind" data-bind="${a}">${padName(c.pad[a] ?? -1)}</button></td></tr>`).join('')
        + '<tr><td>Acelerar / reversa</td><td colspan="2" class="dim">RT / LT</td></tr><tr><td>Dirección · pitch · yaw</td><td colspan="2" class="dim">Stick izquierdo</td></tr><tr><td>Mirar alrededor</td><td colspan="2" class="dim">Stick derecho</td></tr><tr><td>Chat rápido</td><td colspan="2" class="dim">D-pad ↑ → ↓ ←</td></tr>';
    const sl = (id: string, label: string, min: number, max: number, v: number) =>
      `<div class="slider"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="0.05" value="${v}"><output id="${id}Out">${v.toFixed(2)}</output></div>`;
    this.panel.innerHTML = `
      <h2>Reasignar controles</h2>
      <div class="seg rm-tabs"><button data-tab="teclado" class="${this.tab === 'teclado' ? 'on' : ''}">Teclado y mouse</button><button data-tab="mando" class="${this.tab === 'mando' ? 'on' : ''}">Mando</button></div>
      <div class="rm-body">
        <table class="ctable rm"><tr><th>Acción</th><th colspan="2">${this.tab === 'teclado' ? 'Principal · alternativa' : 'Botón'}</th></tr>${rows}</table>
        <div class="rm-side">
          <div class="sliders">
            ${sl('cSteer', 'Sensibilidad dirección', 0.5, 2, c.steerSens)}
            ${sl('cAir', 'Sensibilidad aire', 0.5, 2, c.airSens)}
            ${sl('cDead', 'Deadzone del stick', 0, 0.4, c.deadzone)}
          </div>
          <label class="chk"><input type="checkbox" id="cInvert"${c.invertPitch ? ' checked' : ''}> Invertir pitch</label>
          <label class="chk"><input type="checkbox" id="cVib"${c.vibration ? ' checked' : ''}> Vibración del mando</label>
          <p class="tip">Hacé clic en una casilla y presioná la tecla (o botón del mando). Esc cancela. Podés usar clic central o derecho del mouse.</p>
        </div>
      </div>
      <div class="actions"><button class="btn" data-reset="1">Restablecer</button><button class="btn primary" data-ui="back">Listo</button></div>`;
  }
}
