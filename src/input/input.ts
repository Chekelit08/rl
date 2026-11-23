// Input unificado: teclado + mouse + mando → CarInput (más acciones de UI).
// Los controles son reasignables (teclado y mando), con sensibilidad, deadzone, invertir pitch y vibración.

import type { CarInput } from '../sim/car.ts';

export interface UiActions {
  ballCamToggle: boolean;
  reset: boolean;
  pause: boolean;
  scoreboard: boolean;
  skip: boolean;
  help: boolean;
  saveClip: boolean;
  /** Chat rápido: 0..3 (teclas 1–4 o D-pad) o -1. */
  chat: number;
  lookX: number;
  lookY: number;
}

// ---------- Configuración de controles ----------
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'boost' | 'handbrake' | 'rollLeft' | 'rollRight'
  | 'ballCam' | 'reset' | 'scoreboard' | 'pause' | 'saveClip' | 'chat1' | 'chat2' | 'chat3' | 'chat4';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Acelerar · nariz abajo', back: 'Reversa · nariz arriba', left: 'Izquierda', right: 'Derecha',
  jump: 'Saltar · flip', boost: 'Turbo', handbrake: 'Derrape · air roll libre', rollLeft: 'Air roll izquierda', rollRight: 'Air roll derecha',
  ballCam: 'Cámara de pelota', reset: 'Reiniciar (juego libre)', scoreboard: 'Puntajes', pause: 'Pausa', saveClip: 'Guardar clip',
  chat1: 'Chat rápido 1', chat2: 'Chat rápido 2', chat3: 'Chat rápido 3', chat4: 'Chat rápido 4',
};
export const ACTIONS = Object.keys(ACTION_LABELS) as Action[];
/** Acciones que existen en el mando como botón reasignable. */
export const PAD_ACTIONS: Action[] = ['jump', 'boost', 'handbrake', 'rollLeft', 'rollRight', 'ballCam', 'scoreboard', 'pause', 'reset', 'saveClip'];

export interface ControlSettings {
  keys: Record<Action, string[]>;
  pad: Partial<Record<Action, number>>;
  steerSens: number; // 0.5–2: sensibilidad del stick (dirección)
  airSens: number; // 0.5–2: sensibilidad del stick en el aire
  deadzone: number; // 0–0.4
  invertPitch: boolean;
  vibration: boolean;
}

export const DEFAULT_CONTROLS: ControlSettings = {
  keys: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    jump: ['Mouse2', 'KeyJ'], boost: ['Mouse0', 'KeyK'], handbrake: ['ShiftLeft', 'KeyL'], rollLeft: ['KeyQ'], rollRight: ['KeyE'],
    ballCam: ['Space', 'KeyC'], reset: ['KeyR'], scoreboard: ['Tab'], pause: ['Escape', 'KeyP'], saveClip: ['KeyG'],
    chat1: ['Digit1'], chat2: ['Digit2'], chat3: ['Digit3'], chat4: ['Digit4'],
  },
  pad: { jump: 0, boost: 1, handbrake: 2, ballCam: 3, rollLeft: 4, rollRight: 5, scoreboard: 8, pause: 9, reset: 10, saveClip: 11 },
  steerSens: 1, airSens: 1, deadzone: 0.12, invertPitch: false, vibration: true,
};

const CKEY = 'turbogol.controls';
let controls: ControlSettings | null = null;

export function getControls(): ControlSettings {
  if (controls) return controls;
  const c = structuredClone(DEFAULT_CONTROLS);
  try {
    const j = JSON.parse(localStorage.getItem(CKEY) ?? 'null');
    if (j) {
      for (const a of ACTIONS) if (Array.isArray(j.keys?.[a])) c.keys[a] = j.keys[a].filter((x: unknown) => typeof x === 'string').slice(0, 2);
      // v2: el Espacio pasó de saltar a alternar la cámara (auto ↔ pelota). Se migra lo guardado con el esquema anterior.
      if (j.v !== 2) {
        c.keys.jump = c.keys.jump.filter((k) => k !== 'Space');
        if (!c.keys.jump.length) c.keys.jump = [...DEFAULT_CONTROLS.keys.jump];
        else if (c.keys.jump.length < 2 && !c.keys.jump.includes('KeyJ')) c.keys.jump.push('KeyJ');
        c.keys.ballCam = ['Space', ...c.keys.ballCam.filter((k) => k !== 'Space')].slice(0, 2);
      }
      for (const a of PAD_ACTIONS) if (typeof j.pad?.[a] === 'number') c.pad[a] = j.pad[a];
      if (typeof j.steerSens === 'number') c.steerSens = Math.max(0.5, Math.min(2, j.steerSens));
      if (typeof j.airSens === 'number') c.airSens = Math.max(0.5, Math.min(2, j.airSens));
      if (typeof j.deadzone === 'number') c.deadzone = Math.max(0, Math.min(0.4, j.deadzone));
      if (typeof j.invertPitch === 'boolean') c.invertPitch = j.invertPitch;
      if (typeof j.vibration === 'boolean') c.vibration = j.vibration;
    }
  } catch { /* sin almacenamiento */ }
  controls = c;
  return c;
}

export function saveControls() {
  try { localStorage.setItem(CKEY, JSON.stringify({ ...getControls(), v: 2 })); } catch { /* ignorar */ }
}

export function resetControls() {
  controls = structuredClone(DEFAULT_CONTROLS);
  saveControls();
}

const CODE_NAMES: Record<string, string> = {
  Space: 'Espacio', ShiftLeft: 'Shift izq.', ShiftRight: 'Shift der.', ControlLeft: 'Ctrl izq.', ControlRight: 'Ctrl der.', AltLeft: 'Alt izq.', Escape: 'Esc',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: 'Clic izq.', Mouse1: 'Clic central', Mouse2: 'Clic der.', Tab: 'Tab', Enter: 'Enter',
  Backspace: 'Retroceso', CapsLock: 'Bloq. mayús.',
};
export function codeName(code: string): string {
  if (CODE_NAMES[code]) return CODE_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
const PAD_NAMES = ['A / ✕', 'B / ○', 'X / □', 'Y / △', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];
export const padName = (i: number) => PAD_NAMES[i] ?? `Botón ${i}`;

// ---------- Manager ----------
const DPAD_CHAT = [12, 15, 13, 14]; // ↑ → ↓ ←

export class InputManager {
  private keys = new Set<string>();
  private pressedOnce = new Set<string>();
  private mouse = new Set<number>();
  private gpPrev: boolean[] = [];
  private capture: { kind: 'key' | 'pad'; cb: (v: string | number | null) => void; ready: number } | null = null;
  usingGamepad = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.capture?.kind === 'key') {
        e.preventDefault();
        e.stopPropagation();
        const cb = this.capture.cb;
        this.capture = null;
        cb(e.code === 'Escape' ? null : e.code);
        return;
      }
      if (e.repeat) return;
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select');
      if (typing) return;
      if (['Space', 'Tab', 'F1', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressedOnce.add(e.code);
      this.usingGamepad = false;
    }, true);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.clear(); });
    window.addEventListener('mousedown', (e) => {
      if (this.capture?.kind === 'key' && e.button !== 0) {
        e.preventDefault();
        const cb = this.capture.cb;
        this.capture = null;
        cb('Mouse' + e.button);
      }
    }, true);
    target.addEventListener('mousedown', (e) => { this.mouse.add(e.button); this.pressedOnce.add('Mouse' + e.button); });
    window.addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', () => this.pressedOnce.add('Wheel'), { passive: true });
  }

  /** Espera la próxima tecla/botón (para reasignar). cb(null) = cancelado. */
  captureNext(kind: 'key' | 'pad', cb: (v: string | number | null) => void) {
    this.capture = { kind, cb, ready: performance.now() + 250 };
    this.keys.clear();
  }
  cancelCapture() { this.capture = null; }
  get capturing() { return this.capture !== null; }

  /** Vibración del mando (si está activada y el navegador la soporta). */
  rumble(strong: number, weak: number, ms: number) {
    if (!getControls().vibration || !this.usingGamepad) return;
    try {
      for (const gp of navigator.getGamepads?.() ?? []) {
        const act = (gp as unknown as { vibrationActuator?: { playEffect: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
        if (gp?.connected && act) { void act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); break; }
      }
    } catch { /* sin vibración */ }
  }

  private down(a: Action) { return getControls().keys[a].some((c) => (c.startsWith('Mouse') ? this.mouse.has(Number(c.slice(5))) : this.keys.has(c))); }
  private once(a: Action, ...extra: string[]) { return [...getControls().keys[a], ...extra].some((c) => this.pressedOnce.has(c)); }

  /** Lee el estado actual. Llamar una vez por frame. */
  poll(): { car: CarInput; ui: UiActions } {
    const cs = getControls();
    const car: CarInput = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
    const ui: UiActions = { ballCamToggle: false, reset: false, pause: false, scoreboard: false, skip: false, help: false, saveClip: false, chat: -1, lookX: 0, lookY: 0 };
    const inv = cs.invertPitch ? -1 : 1;

    // --- Teclado y mouse ---
    const fwd = this.down('forward') ? 1 : 0;
    const back = this.down('back') ? 1 : 0;
    const right = this.down('right') ? 1 : 0;
    const left = this.down('left') ? 1 : 0;
    const airRollFree = this.down('handbrake');
    car.throttle = fwd - back;
    car.steer = right - left;
    car.pitch = (back - fwd) * inv; // por defecto S = nariz arriba
    car.yaw = right - left;
    if (airRollFree) { car.roll = car.yaw; car.yaw = 0; }
    if (this.down('rollRight')) car.roll = 1;
    if (this.down('rollLeft')) car.roll = -1;
    car.jump = this.down('jump');
    car.boost = this.down('boost');
    car.handbrake = airRollFree;

    ui.ballCamToggle = this.once('ballCam', 'Wheel');
    ui.reset = this.once('reset');
    ui.pause = this.once('pause');
    ui.scoreboard = this.down('scoreboard');
    ui.skip = this.once('jump', 'Space', 'Enter', 'Mouse2');
    ui.help = this.pressedOnce.has("F1") || this.pressedOnce.has("KeyH");
    ui.saveClip = this.once('saveClip');
    for (let i = 0; i < 4; i++) if (this.once(('chat' + (i + 1)) as Action)) ui.chat = i;

    // --- Mando (mapeo estándar) ---
    const dzone = cs.deadzone;
    const dz = (v: number) => (Math.abs(v) < dzone ? 0 : (v - Math.sign(v) * dzone) / (1 - dzone));
    const pads = navigator.getGamepads?.() ?? [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const val = (i: number) => gp.buttons[i]?.value ?? 0;
      const justPressed = (i: number) => b(i) && !this.gpPrev[i];
      if (this.capture?.kind === 'pad' && performance.now() > this.capture.ready) {
        const i = gp.buttons.findIndex((x, k) => x.pressed && !this.gpPrev[k]);
        if (i >= 0) { const cb = this.capture.cb; this.capture = null; cb(i); }
        this.gpPrev = gp.buttons.map((x) => x.pressed);
        break;
      }
      const P = (a: Action) => cs.pad[a] ?? -1;
      const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0);
      const rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
      const rt = val(7), lt = val(6);
      const any = Math.abs(lx) + Math.abs(ly) + rt + lt > 0.05 || gp.buttons.some((x) => x.pressed);
      if (any) this.usingGamepad = true;
      if (!this.usingGamepad) { this.gpPrev = gp.buttons.map((x) => x.pressed); continue; }

      const cl = (v: number) => Math.max(-1, Math.min(1, v));
      car.throttle = rt - lt;
      car.steer = cl(lx * cs.steerSens);
      car.pitch = cl(ly * cs.airSens * inv); // stick abajo (+) = nariz arriba
      car.yaw = cl(lx * cs.airSens);
      car.roll = 0;
      if (b(P('handbrake'))) { car.roll = cl(lx * cs.airSens); car.yaw = 0; } // air roll libre
      if (b(P('rollLeft'))) car.roll = -1;
      if (b(P('rollRight'))) car.roll = 1;
      car.jump = b(P('jump'));
      car.boost = b(P('boost'));
      car.handbrake = b(P('handbrake'));
      ui.ballCamToggle ||= justPressed(P('ballCam'));
      ui.pause ||= justPressed(P('pause'));
      ui.scoreboard ||= b(P('scoreboard'));
      ui.reset ||= justPressed(P('reset'));
      ui.skip ||= justPressed(P('jump'));
      ui.saveClip ||= justPressed(P('saveClip'));
      DPAD_CHAT.forEach((btn, i) => { if (justPressed(btn)) ui.chat = i; });
      ui.lookX = rx;
      ui.lookY = ry;
      this.gpPrev = gp.buttons.map((x) => x.pressed);
      break;
    }

    this.pressedOnce.clear();
    return { car, ui };
  }
}
