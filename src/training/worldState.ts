// Captura y restauración del estado completo de la simulación (para rebobinar).
// Copia genérica de los campos de cada auto y la pelota: sigue funcionando aunque la física agregue campos nuevos.

import { Quat, V3 } from '../sim/math.ts';
import type { World } from '../sim/world.ts';

type Plain = Record<string, unknown>;

function cloneVal(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof V3 || v instanceof Quat) return v.clone();
  if (ArrayBuffer.isView(v)) return (v as unknown as { slice: () => unknown }).slice();
  if (Array.isArray(v)) return v.map((x) => cloneVal(x, depth + 1));
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, cloneVal(x, depth + 1)]));
  if (v instanceof Set) return new Set(v);
  const proto = Object.getPrototypeOf(v);
  if ((proto === Object.prototype || proto === null) && depth < 6) {
    const o: Plain = {};
    for (const [k, x] of Object.entries(v as Plain)) o[k] = cloneVal(x, depth + 1);
    return o;
  }
  return v; // instancias de otras clases: se comparten (son datos de configuración)
}

/** Campos de configuración que se comparten por referencia (no cambian durante la partida). */
const REF_KEYS = new Set(['body', 'config', 'id', 'team', 'name', 'isBot']);

/** Copia los campos propios de un objeto (instancia de clase) en un objeto plano. */
function captureFields(obj: object): Plain {
  const out: Plain = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function' || REF_KEYS.has(k)) continue;
    out[k] = cloneVal(v);
  }
  return out;
}

function restoreFields(obj: object, saved: Plain) {
  const target = obj as Plain;
  for (const [k, v] of Object.entries(saved)) target[k] = cloneVal(v);
}

export interface WorldState {
  tick: number;
  phase: World['phase'];
  phaseTimer: number;
  clock: number;
  overtime: boolean;
  zeroClock: boolean;
  score: number[];
  cars: Plain[];
  ball: Plain;
  pads: { active: boolean; timer: number }[];
  lastTouches: World['lastTouches'];
  extra?: unknown;
}

export function captureWorld(w: World, extra?: unknown): WorldState {
  return {
    tick: w.tick,
    phase: w.phase,
    phaseTimer: w.phaseTimer,
    clock: w.clock,
    overtime: w.overtime,
    zeroClock: w.zeroClock,
    score: [...w.score],
    cars: w.cars.map(captureFields),
    ball: captureFields(w.ball),
    pads: w.pads.map((p) => ({ active: p.active, timer: p.timer })),
    lastTouches: w.lastTouches.map((t) => ({ ...t })),
    extra: cloneVal(extra),
  };
}

export function restoreWorld(w: World, s: WorldState) {
  w.tick = s.tick;
  w.phase = s.phase;
  w.phaseTimer = s.phaseTimer;
  w.clock = s.clock;
  w.overtime = s.overtime;
  w.zeroClock = s.zeroClock;
  w.score = [...s.score];
  s.cars.forEach((c, i) => { if (w.cars[i]) restoreFields(w.cars[i], c); });
  restoreFields(w.ball, s.ball);
  s.pads.forEach((p, i) => { if (w.pads[i]) { w.pads[i].active = p.active; w.pads[i].timer = p.timer; } });
  w.lastTouches = s.lastTouches.map((t) => ({ ...t }));
  w.events = [];
}

/** Buffer de rebobinado: guarda el estado cada `every` ticks durante `seconds`. */
export class RewindBuffer {
  private states: WorldState[] = [];
  private readonly max: number;
  private readonly every: number;
  private n = 0;
  cursor = -1; // índice mientras se rebobina

  constructor(seconds = 5, every = 2) {
    this.every = every;
    this.max = Math.round((seconds * 120) / every);
  }

  clear() { this.states = []; this.n = 0; this.cursor = -1; }

  push(w: World, extra?: unknown) {
    if (this.n++ % this.every !== 0) return;
    this.states.push(captureWorld(w, extra));
    if (this.states.length > this.max) this.states.shift();
  }

  get length() { return this.states.length; }
  get rewinding() { return this.cursor >= 0; }

  /** Empieza a rebobinar desde el estado más reciente. */
  begin() { if (this.states.length) this.cursor = this.states.length - 1; }

  /** Retrocede `ticks` ticks de simulación y devuelve el estado a mostrar. */
  back(ticks: number): WorldState | null {
    if (this.cursor < 0) return null;
    this.cursor = Math.max(0, this.cursor - ticks / this.every);
    return this.states[Math.round(this.cursor)] ?? null;
  }

  /** Termina de rebobinar: descarta el "futuro" y devuelve el estado desde el que se sigue. */
  end(): WorldState | null {
    if (this.cursor < 0) return null;
    const i = Math.round(this.cursor);
    const s = this.states[i] ?? null;
    this.states = this.states.slice(0, i + 1);
    this.cursor = -1;
    return s;
  }

  /** Fracción del buffer disponible (0..1) para la barra de rebobinado. */
  progress() { return this.cursor < 0 ? 1 : this.cursor / Math.max(1, this.states.length - 1); }
}
