// Post-partido: MVP, tabla de resultados, XP con barra de nivel animada y, en ranked, la tarjeta de rango que sube o baja.

import { BANNERS, TITLES } from '../garage/cosmetics.ts';
import { getLoadout } from '../garage/loadout.ts';
import type { XpReport } from '../progression/progression.ts';
import { PLACEMENT_MATCHES, PLAYLISTS, TIER_COLORS, type RankedOutcome } from '../progression/ranked.ts';
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
}

/** MVP: el mejor puntaje del equipo ganador (o de todos si hay empate). */
export function pickMvp(cars: PmCar[], winner: number): PmCar | null {
  const pool = winner >= 0 ? cars.filter((c) => c.team === winner) : cars;
  return pool.slice().sort((a, b) => b.stats.score - a.stats.score || b.stats.goals - a.stats.goals)[0] ?? null;
}

const TEAM = ['AZUL', 'ROJO'];

export class PostMatch {
  el: HTMLDivElement;
  private timers: number[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'ui-postmatch';
    this.el.className = 'overlay hidden pm';
    document.body.append(this.el);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-pm="next"]')) this.stage2();
    });
  }

  private args!: PmArgs;
  private mvp: PmCar | null = null;

  hide() { this.el.classList.add('hidden'); this.timers.forEach((t) => clearTimeout(t)); this.timers = []; }
  get visible() { return !this.el.classList.contains('hidden'); }

  show(a: PmArgs) {
    this.args = a;
    this.mvp = pickMvp(a.cars, a.winner);
    const m = this.mvp;
    const lo = getLoadout();
    const meMvp = !!m && m.id === a.myId;
    const title = meMvp ? (TITLES.find((t) => t.id === lo.title)?.name ?? '') : '';
    this.el.innerHTML = `
      <div class="pm-mvp t${m?.team ?? 0}">
        <div class="pm-mvp-tag">MVP</div>
        <div class="pm-mvp-name">${m?.name ?? '—'}</div>
        ${title ? `<div class="pm-mvp-title">${title}</div>` : ''}
        <div class="pm-mvp-stats">${m ? `<span><b>${m.stats.score}</b> puntos</span><span><b>${m.stats.goals}</b> goles</span><span><b>${m.stats.assists}</b> asist.</span><span><b>${m.stats.saves}</b> atajadas</span>` : ''}</div>
        <div class="pm-mvp-sub">${meMvp ? '¡Sos el MVP del partido!' : `Equipo ${m ? TEAM[m.team] : ''}`}</div>
        <button class="btn" data-pm="next">Continuar</button>
      </div>`;
    this.el.classList.remove('hidden');
    this.timers.push(window.setTimeout(() => this.stage2(), 3600));
  }

  private stage2() {
    if (!this.visible || this.el.querySelector('.pm-res')) return;
    const a = this.args;
    const res = a.winner === a.myTeam ? 'VICTORIA' : a.winner < 0 ? 'EMPATE' : 'DERROTA';
    const cls = a.winner === a.myTeam ? 'win' : a.winner < 0 ? 'draw' : 'loss';
    const rows = [...a.cars].sort((x, y) => x.team - y.team || y.stats.score - x.stats.score).map((c) =>
      `<tr class="t${c.team}${c.id === a.myId ? ' me' : ''}"><td>${c === this.mvp ? '★ ' : ''}${c.name}</td><td>${c.stats.score}</td><td>${c.stats.goals}</td><td>${c.stats.assists}</td><td>${c.stats.saves}</td><td>${c.stats.shots}</td><td>${c.stats.demos}</td></tr>`).join('');
    const x = a.xp;
    const xpHtml = x ? `
      <div class="pm-xp">
        <div class="pm-xp-head"><span>Nivel <b id="pmLv">${x.before.level}</b></span><span>+<b id="pmXpTot">0</b> XP</span></div>
        <div class="pm-bar"><i id="pmBar" style="width:${x.before.frac * 100}%"></i></div>
        <ul class="pm-lines">${x.lines.map((l, i) => `<li style="animation-delay:${i * 0.18}s"><span>${l.label}</span><b>+${l.xp}</b></li>`).join('')}</ul>
        <div class="pm-unlocks" id="pmUnlocks"></div>
      </div>` : '';
    this.el.innerHTML = `
      <div class="panel wide pm-res">
        <div class="pm-title ${cls}">${res}</div>
        <div class="endscore"><span class="b">${a.score[0]}</span> – <span class="r">${a.score[1]}</span></div>
        <div class="pm-sub">${a.label}</div>
        <table class="stats"><tr><th>Jugador</th><th>Puntos</th><th>Goles</th><th>Asist.</th><th>Atajadas</th><th>Tiros</th><th>Demos</th></tr>${rows}</table>
        <div class="pm-cols">${xpHtml}${a.ranked ? this.rankedHtml(a.ranked) : ''}</div>
        <div class="actions">
          <button class="btn primary" data-act="restart">${a.ranked ? 'Otra partida' : 'Revancha'}</button>
          <button class="btn" data-act="quit">Menú</button>
        </div>
      </div>`;
    if (x) this.animateXp(x);
    if (a.ranked) this.animateRank(a.ranked);
  }

  private animateXp(x: XpReport) {
    const bar = this.el.querySelector<HTMLElement>('#pmBar')!;
    const lv = this.el.querySelector<HTMLElement>('#pmLv')!;
    const tot = this.el.querySelector<HTMLElement>('#pmXpTot')!;
    const un = this.el.querySelector<HTMLElement>('#pmUnlocks')!;
    // Recorrido por niveles: from before.frac → (after.level - before.level) pasadas completas → after.frac
    let level = x.before.level;
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
          level = st.lvl;
          lv.textContent = String(level);
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
      un.innerHTML = `<h4>¡Nivel ${x.after.level}! Desbloqueaste</h4>` + x.unlocks.map((u) => `<span class="chip">${u.cat}: ${u.item.name}</span>`).join('');
    }
  }

  private rankedHtml(r: RankedOutcome): string {
    const pl = PLAYLISTS.find((p) => p.id === r.playlist)!;
    const showAfter = r.after.placed;
    const head = r.placementDone ? '¡Clasificación completa!' : !showAfter ? `Clasificatoria ${PLACEMENT_MATCHES - r.placementsLeft}/${PLACEMENT_MATCHES}` : r.tierUp ? '¡Subiste de rango!' : r.tierDown ? 'Bajaste de rango' : r.divUp ? '¡Subiste de división!' : r.divDown ? 'Bajaste de división' : 'Rango sin cambios';
    const dir = !showAfter ? '' : r.tierUp || r.divUp ? 'up' : r.tierDown || r.divDown ? 'down' : '';
    const rb = r.before, ra = r.after;
    const shownBefore = rb.placed ? rb : ra;
    return `
      <div class="pm-rank ${dir}" style="--tc:${TIER_COLORS[(showAfter ? ra : rb).tier]}">
        <div class="pm-rank-head">${pl.name} · ${head}</div>
        <div class="pm-rank-icon" id="pmRankIcon">${showAfter ? rankIcon(shownBefore.tier, shownBefore.sub, 92, 'pmb') : '<div class="unranked">?</div>'}</div>
        <div class="pm-rank-name" id="pmRankName">${showAfter ? shownBefore.short : 'Sin clasificar'}</div>
        <div class="pm-bar rank"><i id="pmRankBar" style="width:${showAfter ? shownBefore.frac * 100 : ((PLACEMENT_MATCHES - r.placementsLeft) / PLACEMENT_MATCHES) * 100}%"></i></div>
        <div class="pm-rank-delta" id="pmRankDelta"></div>
      </div>`;
  }

  private animateRank(r: RankedOutcome) {
    const icon = this.el.querySelector<HTMLElement>('#pmRankIcon')!;
    const name = this.el.querySelector<HTMLElement>('#pmRankName')!;
    const bar = this.el.querySelector<HTMLElement>('#pmRankBar')!;
    const delta = this.el.querySelector<HTMLElement>('#pmRankDelta')!;
    const ra = r.after;
    if (!ra.placed) {
      delta.textContent = `Faltan ${r.placementsLeft} partidas para conocer tu rango`;
      return;
    }
    const d = Math.round(r.rAfter - r.rBefore);
    this.timers.push(window.setTimeout(() => {
      icon.innerHTML = rankIcon(ra.tier, ra.sub, 92, 'pma');
      icon.classList.add('swap');
      name.textContent = ra.short;
      bar.style.width = `${ra.frac * 100}%`;
      delta.innerHTML = `<b class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '▲' : '▼'} ${d >= 0 ? '+' : ''}${d} MMR</b>`;
    }, 1300));
  }
}
