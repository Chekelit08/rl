// Input unificado: teclado + mouse + mando → CarInput (más acciones de UI).

import type { CarInput } from '../sim/car.ts';

export interface UiActions {
  ballCamToggle: boolean;
  reset: boolean;
  pause: boolean;
  scoreboard: boolean;
  skip: boolean;
  help: boolean;
  saveClip: boolean;
  lookX: number;
  lookY: number;
}

const DEADZONE = 0.12;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

export class InputManager {
  private keys = new Set<string>();
  private pressedOnce = new Set<string>();
  private mouse = new Set<number>();
  private gpPrev: boolean[] = [];
  usingGamepad = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'Tab', 'F1', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressedOnce.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.clear(); });
    target.addEventListener('mousedown', (e) => { this.mouse.add(e.button); this.pressedOnce.add('Mouse' + e.button); });
    window.addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', () => this.pressedOnce.add('Wheel'), { passive: true });
  }

  private k(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }
  private once(...codes: string[]) { return codes.some((c) => this.pressedOnce.has(c)); }

  /** Lee el estado actual. Llamar una vez por frame. */
  poll(): { car: CarInput; ui: UiActions } {
    const car: CarInput = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
    const ui: UiActions = { ballCamToggle: false, reset: false, pause: false, scoreboard: false, skip: false, help: false, saveClip: false, lookX: 0, lookY: 0 };

    // --- Teclado y mouse ---
    const fwd = this.k('KeyW', 'ArrowUp') ? 1 : 0;
    const back = this.k('KeyS', 'ArrowDown') ? 1 : 0;
    const right = this.k('KeyD', 'ArrowRight') ? 1 : 0;
    const left = this.k('KeyA', 'ArrowLeft') ? 1 : 0;
    const airRollFree = this.k('ShiftLeft');
    car.throttle = fwd - back;
    car.steer = right - left;
    car.pitch = back - fwd; // S = nariz arriba
    car.yaw = right - left;
    if (airRollFree) { car.roll = car.yaw; car.yaw = 0; }
    if (this.k('KeyE')) car.roll = 1;
    if (this.k('KeyQ')) car.roll = -1;
    car.jump = this.k('Space', 'KeyJ') || this.mouse.has(2);
    car.boost = this.mouse.has(0) || this.k('KeyK', 'ShiftRight');
    car.handbrake = this.k('ShiftLeft', 'KeyL');

    ui.ballCamToggle = this.once('KeyC', 'Wheel', 'Mouse1');
    ui.reset = this.once('KeyR');
    ui.pause = this.once('Escape', 'KeyP');
    ui.scoreboard = this.k('Tab');
    ui.skip = this.once('Space', 'Enter', 'Mouse2');
    ui.help = this.once('F1', 'KeyH');
    ui.saveClip = this.once('KeyG');

    // --- Mando (mapeo estándar) ---
    const pads = navigator.getGamepads?.() ?? [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const val = (i: number) => gp.buttons[i]?.value ?? 0;
      const justPressed = (i: number) => b(i) && !this.gpPrev[i];
      const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0);
      const rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
      const rt = val(7), lt = val(6);
      const any = Math.abs(lx) + Math.abs(ly) + rt + lt > 0.05 || gp.buttons.some((x) => x.pressed);
      if (any) this.usingGamepad = true;
      if (!this.usingGamepad) { this.gpPrev = gp.buttons.map((x) => x.pressed); continue; }

      car.throttle = rt - lt;
      car.steer = lx;
      car.pitch = ly; // stick abajo (+) = nariz arriba
      car.yaw = lx;
      car.roll = 0;
      if (b(2)) { car.roll = lx; car.yaw = 0; } // X: air roll libre
      if (b(4)) car.roll = -1; // LB: air roll izquierda
      if (b(5)) car.roll = 1; // RB: air roll derecha
      car.jump = b(0);
      car.boost = b(1);
      car.handbrake = b(2);
      ui.ballCamToggle ||= justPressed(3);
      ui.pause ||= justPressed(9);
      ui.scoreboard ||= b(8);
      ui.reset ||= justPressed(12); // D-pad arriba
      ui.skip ||= justPressed(0);
      ui.saveClip ||= justPressed(13); // D-pad abajo
      ui.lookX = rx;
      ui.lookY = ry;
      this.gpPrev = gp.buttons.map((x) => x.pressed);
      break;
    }

    this.pressedOnce.clear();
    return { car, ui };
  }
}
