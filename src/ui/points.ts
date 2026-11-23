// Notificaciones de puntos al estilo del género: "+100 GOL", "+50 ATAJADA", etc. Sólo para el jugador local.

import type { GameEvent } from '../sim/world.ts';
import type { TouchFeat } from '../sim/touchEvents.ts';

const FEAT_LABEL: Record<TouchFeat, string> = { firsttouch: 'Primer toque', clear: 'Despeje', center: 'Centro', aerialhit: 'Toque aéreo' };

/** Convierte un evento de simulación en notificaciones de puntos para el jugador `me`. */
export function pointsFor(ev: GameEvent, me: number, cars: { id: number; team: number }[]): { label: string; pts: number; kind: string }[] {
  const out: { label: string; pts: number; kind: string }[] = [];
  switch (ev.type) {
    case 'shot': if (ev.carId === me) out.push({ label: 'Tiro', pts: 20, kind: 'shot' }); break;
    case 'save': if (ev.carId === me) out.push({ label: ev.epic ? 'Atajada épica' : 'Atajada', pts: ev.epic ? 75 : 50, kind: 'save' }); break;
    case 'goal':
      if (ev.scorerId === me && cars[me] && cars[me].team === ev.team) out.push({ label: 'Gol', pts: 100, kind: 'goal' });
      if (ev.assistId === me) out.push({ label: 'Asistencia', pts: 50, kind: 'assist' });
      break;
    case 'demo': if (ev.attacker === me) out.push({ label: 'Demolición', pts: 10, kind: 'demo' }); break;
    case 'feat': if (ev.carId === me) out.push({ label: FEAT_LABEL[ev.feat], pts: ev.points, kind: 'feat' }); break;
  }
  return out;
}

export class PointsFeed {
  private el: HTMLDivElement;
  total = 0;
  private totalEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pts-feed';
    this.totalEl = document.createElement('div');
    this.totalEl.className = 'pts-total hidden';
    parent.append(this.el, this.totalEl);
  }

  add(label: string, pts: number, kind = '') {
    const d = document.createElement('div');
    d.className = 'pts-item ' + kind;
    d.innerHTML = `<b>+${pts}</b><span>${label}</span>`;
    this.el.append(d);
    while (this.el.children.length > 5) this.el.firstChild?.remove();
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3100);
    this.total += pts;
    this.totalEl.textContent = `+${this.total} PUNTOS`;
    this.totalEl.classList.remove('hidden');
    this.totalEl.classList.remove('bump');
    void this.totalEl.offsetWidth;
    this.totalEl.classList.add('bump');
  }

  reset() { this.total = 0; this.el.innerHTML = ''; this.totalEl.classList.add('hidden'); }
}
