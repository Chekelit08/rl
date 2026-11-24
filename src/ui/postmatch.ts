// Fin del partido: primero el MVP y después el resumen (resultado, tabla, XP con la barra de nivel animada
// y, en competitivo, la tarjeta de rango que sube o baja). Se dibuja dentro de #end.

import { TITLES } from '../garage/cosmetics.ts';
import { getLoadout } from '../garage/loadout.ts';
import type { XpReport } from '../progression/progression.ts';
import { PLACEMENT_MATCHES, PLAYLISTS, TIER_COLORS, type RankedOutcome } from '../progression/ranked.ts';
import { statsTable } from './hud.ts';
import { rankIcon } from './rankIcons.ts';

export interface PmCar { id: number; name: string; team: number; isBot: boolean; stats: { score: number; goals: number; assists: number; saves: number; shots: number; demos: number; touches: number } }
export interface PmArgs {
  cars: PmCar[];
  score: [number, number];
  winner: number;
  myId: number;
  myTeam: number;
  label: string; // "Casual 2v2", "Competitivo 3v3"
  xp: XpReport | null;
  ranked: RankedOutcome | null;
  /** Botones extra para el pie del resumen (guardar y ver la repetición). */
  extra?: HTMLElement | null;
}

/** MVP: el mejor puntaje del equipo ganador (o de todos si hay empate). */
export function pickMvp(cars: PmCar[], winner: number): PmCar | null {
  const pool = winner >= 0 ? cars.filter((c) => c.team === winner) : cars;
  return pool.slice().sort((a, b) => b.stats.score - a.stats.score || b.stats.goals - a.stats.goals)[0] ?? null;
}

const TEAM = ['Azul', 'Rojo'];
const MVP_SECONDS = 4;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class PostMatch {
  el: HTMLElement;
  private timers: number[] = [];
  private args!: PmArgs;
  private mvp: PmCar | null = null;

  constructor() {
    let el = document.getElementById('end');
    if (!el) {
      el = document.createElement('div');
      el.id = 'end';
      document.body.append(el);
    }
    el.className = 'overlay hidden pm';
    this.el = el;
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-pm="next"]')) this.stage2();
    });
  }

  hide() { this.el.classList.add('hidden'); this.timers.forEach((t) => clearTimeout(t)); this.timers = []; }
  get visible() { return !this.el.classList.contains('hidden'); }

  show(a: PmArgs) {
    this.args = a;
    this.mvp = pickMvp(a.cars, a.winner);
    const m = this.mvp;
    const meMvp = !!m && m.id === a.myId;
    const title = meMvp ? (TITLES.find((t) => t.id === getLoadout().title)?.name ?? '') : '';
    const stat = (v: number, label: string) => `<div><b>${v}</b><span>${label}</span></div>`;
    this.el.innerHTML = `
      <div class="pm-mvp t${m?.team ?? 0}">
        <div class="pm-mvp-kicker">Figura del partido</div>
        <div class="pm-mvp-tag">MVP</div>
        <div class="pm-mvp-name">${esc(m?.name ?? '—')}</div>
        <div class="pm-mvp-sub">${meMvp ? `¡Fuiste vos!${title ? ` · ${esc(title)}` : ''}` : m ? `Equipo ${TEAM[m.team]}` : ''}</div>
        <div class="pm-mvp-stats">${m ? stat(m.stats.score, 'Puntos') + stat(m.stats.goals, 'Goles') + stat(m.stats.assists, 'Asistencias') + stat(m.stats.saves, 'Atajadas') : ''}</div>
        <button class="btn primary" data-pm="next">Continuar</button>
        <span class="bar pm-auto"><i style="animation-duration:${MVP_SECONDS}s"></i></span>
      </div>`;
    // Los botones de repetición ya existen (ocultos) mientras se ve el MVP; el resumen los pone en su pie
    if (a.extra) { a.extra.classList.add('hidden'); this.el.append(a.extra); }
    this.el.classList.remove('hidden');
    this.el.querySelector<HTMLElement>('[data-pm="next"]')?.focus();
    this.timers.push(window.setTimeout(() => this.stage2(), MVP_SECONDS * 1000));
  }

  private stage2() {
    if (!this.visible || this.el.querySelector('.pm-res')) return;
    const a = this.args;
    const cls = a.winner === a.myTeam ? 'win' : a.winner < 0 ? 'draw' : 'loss';
    const res = cls === 'win' ? 'Victoria' : cls === 'draw' ? 'Empate' : 'Derrota';
    const x = a.xp;
    const xpHtml = x ? `
      <section class="pm-xp">
        <h3>Progreso</h3>
        <div class="pm-xp-head">
          <span class="pm-lv" id="pmLv">${x.before.level}</span>
          <div class="pm-xp-main">
            <div class="pm-xp-top"><b>Nivel <span id="pmLvTxt">${x.before.level}</span></b><span class="pm-xp-gain">+<b id="pmXpTot">0</b> XP</span></div>
            <span class="bar"><i id="pmBar" style="width:${x.before.frac * 100}%"></i></span>
          </div>
        </div>
        <ul class="pm-lines">${x.lines.map((l, i) => `<li style="animation-delay:${0.25 + i * 0.14}s"><span>${esc(l.label)}</span><b>+${l.xp}</b></li>`).join('')}</ul>
        <div class="pm-unlocks" id="pmUnlocks"></div>
      </section>` : '';
    this.el.innerHTML = `
      <div class="panel xl pm-res ${cls}">
        <header class="pm-head">
          <div class="pm-result"><span class="pm-title">${res}</span><span class="pm-sub">${esc(a.label)}</span></div>
          <div class="pm-score"><span class="n">Azul</span><b class="b">${a.score[0]}</b><b class="r">${a.score[1]}</b><span class="n">Rojo</span></div>
        </header>
        ${statsTable(a.cars, a.myId, { touches: false, mvpId: this.mvp?.id })}
        <div class="pm-cols">${xpHtml}${a.ranked ? this.rankedHtml(a.ranked) : ''}</div>
        <div class="actions">
          <button class="btn" data-act="quit">Menú</button>
          <button class="btn primary" data-act="restart">${a.ranked ? 'Otra partida' : 'Revancha'}</button>
        </div>
      </div>`;
    if (a.extra) { a.extra.classList.remove('hidden'); this.el.querySelector('.actions')?.prepend(a.extra); }
    this.el.querySelector<HTMLElement>('[data-act="restart"]')?.focus();
    if (x) this.animateXp(x);
    if (a.ranked) this.animateRank(a.ranked);
  }

  private animateXp(x: XpReport) {
    const bar = this.el.querySelector<HTMLElement>('#pmBar')!;
    const lv = this.el.querySelector<HTMLElement>('#pmLv')!;
    const lvTxt = this.el.querySelector<HTMLElement>('#pmLvTxt')!;
    const tot = this.el.querySelector<HTMLElement>('#pmXpTot')!;
    const un = this.el.querySelector<HTMLElement>('#pmUnlocks')!;
    // Recorrido por niveles: de before.frac → una pasada completa por cada nivel subido → after.frac
    const steps: { to: number; lvl: number }[] = [];
    for (let l = x.before.level; l < x.after.level; l++) steps.push({ to: 1, lvl: l + 1 });
    steps.push({ to: x.after.frac, lvl: x.after.level });
    let i = 0;
    const run = () => {
      const st = steps[i];
      if (!st) return;
      bar.style.transition = 'width .9s cubic-bezier(.2,.8,.2,1)';
      bar.style.width = `${st.to * 100}%`;
      this.timers.push(window.setTimeout(() => {
        if (i < steps.length - 1) {
          lv.textContent = lvTxt.textContent = String(st.lvl);
          lv.classList.remove('lvup');
          void lv.offsetWidth;
          lv.classList.add('lvup');
          bar.style.transition = 'none';
          bar.style.width = '0%';
          void bar.offsetWidth;
        }
        i++;
        run();
      }, 1000));
    };
    this.timers.push(window.setTimeout(run, 700));
    // Contador de XP total
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 1200);
      tot.textContent = String(Math.round(x.total * k));
      if (k < 1 && this.visible) requestAnimationFrame(tick);
    };
    tick();
    if (x.unlocks.length) {
      un.innerHTML = `<h4>${x.after.level > x.before.level ? `¡Nivel ${x.after.level}! ` : ''}Desbloqueaste</h4>` + x.unlocks.map((u) => `<span class="tag accent">${esc(u.cat)} · ${esc(u.item.name)}</span>`).join('');
    }
  }

  private rankedHtml(r: RankedOutcome): string {
    const pl = PLAYLISTS.find((p) => p.id === r.playlist)!;
    const showAfter = r.after.placed;
    const head = r.placementDone ? '¡Clasificación completa!' : !showAfter ? `Clasificatoria ${PLACEMENT_MATCHES - r.placementsLeft} de ${PLACEMENT_MATCHES}` : r.tierUp ? '¡Subiste de rango!' : r.tierDown ? 'Bajaste de rango' : r.divUp ? '¡Subiste de división!' : r.divDown ? 'Bajaste de división' : 'Mismo rango';
    const dir = !showAfter ? '' : r.tierUp || r.divUp ? 'up' : r.tierDown || r.divDown ? 'down' : '';
    const rb = r.before, ra = r.after;
    const shownBefore = rb.placed ? rb : ra;
    return `
      <section class="pm-rank ${dir}" style="--tc:${showAfter ? TIER_COLORS[ra.tier] : 'var(--muted)'}">
        <h3>${pl.name}</h3>
        <div class="pm-rank-body">
          <div class="pm-rank-icon" id="pmRankIcon">${showAfter ? rankIcon(shownBefore.tier, shownBefore.sub) : '<div class="unranked">?</div>'}</div>
          <div class="pm-rank-main">
            <div class="pm-rank-head">${head}</div>
            <div class="pm-rank-name" id="pmRankName">${showAfter ? shownBefore.short : 'Sin clasificar'}</div>
            <span class="bar rank"><i id="pmRankBar" style="width:${showAfter ? shownBefore.frac * 100 : ((PLACEMENT_MATCHES - r.placementsLeft) / PLACEMENT_MATCHES) * 100}%"></i></span>
            <div class="pm-rank-delta" id="pmRankDelta"></div>
          </div>
        </div>
      </section>`;
  }

  private animateRank(r: RankedOutcome) {
    const icon = this.el.querySelector<HTMLElement>('#pmRankIcon')!;
    const name = this.el.querySelector<HTMLElement>('#pmRankName')!;
    const bar = this.el.querySelector<HTMLElement>('#pmRankBar')!;
    const delta = this.el.querySelector<HTMLElement>('#pmRankDelta')!;
    const ra = r.after;
    if (!ra.placed) {
      delta.textContent = r.placementsLeft === 1 ? 'Falta 1 partida para conocer tu rango' : `Faltan ${r.placementsLeft} partidas para conocer tu rango`;
      return;
    }
    const d = Math.round(r.rAfter - r.rBefore);
    this.timers.push(window.setTimeout(() => {
      icon.innerHTML = rankIcon(ra.tier, ra.sub);
      icon.classList.add('swap');
      name.textContent = ra.short;
      bar.style.width = `${ra.frac * 100}%`;
      delta.innerHTML = `<b class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '▲ +' : '▼ '}${d} MMR</b>`;
    }, 1300));
  }
}
