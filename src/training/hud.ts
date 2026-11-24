// HUD de entrenamiento y juego libre extendido (DOM propio, dentro de #hud).

import { el, esc } from './dom.ts';
import type { TrainingSession } from './session.ts';
import { CATEGORY_NAMES, DIFFICULTY_LABELS } from './types.ts';

export interface FreeplayInfo {
  ballKmh: number;
  touchKmh: number;
  frozen: boolean;
  unlimited: boolean;
  launchKmh: number;
}

/** Línea de atajos: cada tecla en su casilla, seguida de lo que hace. */
const keys = (list: [string, string][]) => list.map(([k, what]) => `<span>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join('')}${what}</span>`).join('');

export class ExtrasHud {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private dots: HTMLDivElement;
  private bar: HTMLElement;
  private banner: HTMLDivElement;
  private keys: HTMLDivElement;
  private rewind: HTMLDivElement;
  private rewindBar: HTMLElement;
  private chips: HTMLDivElement;
  private lastKey = '';
  private bannerTimer = 0;

  constructor() {
    this.root = el('div', 'tg-hud hidden');
    this.panel = el('div', 'tg-thud');
    this.dots = el('div', 'tg-dots');
    const tb = el('div', 'tg-timebar', '<i></i>');
    this.bar = tb.firstElementChild as HTMLElement;
    this.chips = el('div', 'tg-fchips');
    this.banner = el('div', 'tg-banner hidden');
    this.keys = el('div', 'tg-keys');
    this.rewind = el('div', 'tg-rewind hidden', '<span>Rebobinando</span><div class="tg-rbar"><i></i></div>');
    this.rewindBar = this.rewind.querySelector('i')!;
    this.panel.append(this.dots, tb);
    this.root.append(this.panel, this.chips, this.banner, this.rewind, this.keys);
    const attach = () => (document.getElementById('hud') ?? document.body).appendChild(this.root);
    attach();
  }

  hide() { this.root.classList.add('hidden'); this.lastKey = ''; }

  showBanner(text: string, cls: string, seconds = 1.3) {
    this.banner.className = 'tg-banner ' + cls;
    void this.banner.offsetWidth;
    this.banner.textContent = text;
    this.bannerTimer = seconds;
  }

  tick(dt: number) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
    }
  }

  setRewind(active: boolean, progress: number) {
    this.rewind.classList.toggle('hidden', !active);
    if (active) this.rewindBar.style.width = `${Math.round(progress * 100)}%`;
  }

  training(s: TrainingSession, testing: boolean) {
    this.root.classList.remove('hidden');
    this.panel.classList.remove('hidden');
    this.chips.classList.add('hidden');
    const key = `t|${s.pack.id}|${s.index}|${s.results.join(',')}|${s.phase}|${testing}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      const p = s.pack;
      const head = `<div class="tg-thead"><b>${esc(p.name)}</b><span>${CATEGORY_NAMES[p.category]} · ${DIFFICULTY_LABELS[p.difficulty]}</span></div>` +
        `<div class="tg-shot">Tiro ${s.index + 1} de ${s.total}<span class="tg-hits">${s.hits} ${s.hits === 1 ? 'acierto' : 'aciertos'}</span></div>`;
      const dots = s.results.map((r, i) => `<i class="${r === 'acierto' ? 'ok' : r === 'fallo' ? 'bad' : ''}${i === s.index ? ' cur' : ''}"></i>`).join('');
      const note = s.shot.note ? `<div class="tg-note">${esc(s.shot.note)}</div>` : '';
      const wait = s.phase === 'esperando' ? '<div class="tg-wait">Movete para arrancar el tiro</div>' : '';
      this.dots.innerHTML = head + `<div class="tg-dotrow">${dots}</div>` + note + wait;
      this.keys.innerHTML = keys([['R', 'Reintentar'], ['N B', 'Siguiente / anterior'], ['Z', 'Rebobinar'], ['G', 'Guardar clip'], ['Esc', testing ? 'Pausa y volver al editor' : 'Pausa']]);
    }
    const frac = s.phase === 'jugando' ? Math.min(1, s.timer / s.timeLimit) : s.phase === 'esperando' ? 0 : 1;
    this.bar.style.width = `${(1 - frac) * 100}%`;
    this.bar.classList.toggle('low', frac > 0.75);
  }

  freeplay(f: FreeplayInfo) {
    this.root.classList.remove('hidden');
    this.panel.classList.add('hidden');
    this.chips.classList.remove('hidden');
    const key = `f|${Math.round(f.ballKmh)}|${Math.round(f.touchKmh)}|${f.frozen}|${f.unlimited}|${f.launchKmh}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.chips.innerHTML =
      `<div class="chip">Pelota ${Math.round(f.ballKmh)} km/h</div>` +
      `<div class="chip dim">Último toque ${f.touchKmh > 0 ? Math.round(f.touchKmh) + ' km/h' : '—'}</div>` +
      (f.frozen ? '<div class="chip on">Pelota congelada</div>' : '') +
      (f.unlimited ? '<div class="chip on">Turbo infinito</div>' : '');
    this.keys.innerHTML = keys([['R', 'Reiniciar'], ['F', 'Congelar pelota'], ['V', `Lanzarla a ${f.launchKmh} km/h`], ['I', 'Turbo infinito'], ['Z', 'Rebobinar'], ['G', 'Guardar clip'], ['Esc', 'Pausa']]);
  }
}
