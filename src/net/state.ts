// Serialización completa del estado de la simulación para el online:
// - capturar / restaurar el mundo entero (rollback del cliente y snapshots del servidor),
// - cuantización a float32 en ticks de snapshot (servidor y cliente quedan bit a bit iguales),
// - compresión delta contra una línea base confirmada.
//
// Los autos se recorren por reflexión (claves ordenadas), así cualquier campo nuevo de física
// que agregue la simulación viaja solo, sin tener que tocar este archivo.

import { Quat, V3 } from '../sim/math.ts';
import type { World } from '../sim/world.ts';

const PHASES = ['countdown', 'playing', 'goal', 'ended'] as const;

/** Campos del auto que no son estado dinámico (identidad, constantes de forma, configuración). */
const SKIP_CAR = new Set(['id', 'team', 'name', 'body', 'isBot', 'offset', 'half', 'invInertia', 'unlimitedBoost']);
const SKIP_BALL = new Set<string>();

/** PRNG mulberry32 con estado serializable (reemplaza al cerrojo interno de World). */
export class NetRng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next = (): number => {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Campos internos (privados en TS) del mundo. Son opcionales: si la simulación los renombra o los quita,
 * el online sigue andando (sólo se pierde precisión en la predicción de saques y reapariciones, que de
 * todos modos corrige el servidor). Servidor y cliente corren el mismo código, así que coinciden.
 */
interface WorldInternals { rand?: () => number; lastCountdown?: number; __netRng?: NetRng }
const internals = (w: World) => w as unknown as WorldInternals;

/** Instala un PRNG serializable en el mundo (servidor y cliente lo hacen igual, con la misma semilla). */
export function installNetRng(world: World, seed: number): NetRng {
  const r = new NetRng(seed);
  const w = internals(world);
  if (typeof w.rand === 'function') w.rand = r.next;
  w.__netRng = r;
  return r;
}

/** Los Map (p. ej. enfriamientos por auto) viajan con una cantidad fija de pares: el tamaño del estado no cambia. */
const MAP_SLOTS = 8;

// ---------- Recorrido genérico ----------

function writeValue(v: unknown, out: number[], skip?: Set<string>): void {
  if (typeof v === 'number') { out.push(v); return; }
  if (typeof v === 'boolean') { out.push(v ? 1 : 0); return; }
  if (v instanceof V3) { out.push(v.x, v.y, v.z); return; }
  if (v instanceof Quat) { out.push(v.x, v.y, v.z, v.w); return; }
  if (v instanceof Map) {
    const entries = [...v.entries()].filter(([k, val]) => typeof k === 'number' && typeof val === 'number');
    entries.sort((a, b) => (a[0] as number) - (b[0] as number));
    for (let i = 0; i < MAP_SLOTS; i++) {
      const e = entries[i];
      if (e) out.push(e[0] as number, e[1] as number);
      else out.push(-1, 0);
    }
    return;
  }
  if (Array.isArray(v)) {
    out.push(v.length);
    for (const e of v) writeValue(e, out);
    return;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o).sort()) {
      if (skip?.has(k)) continue;
      const val = o[k];
      if (typeof val === 'function' || typeof val === 'string' || val === undefined || val === null) continue;
      writeValue(val, out);
    }
  }
}

class Reader {
  i = 0;
  data: ArrayLike<number>;
  constructor(data: ArrayLike<number>) { this.data = data; }
  next() { return this.data[this.i++]; }
}

function readValue(cur: unknown, r: Reader, skip?: Set<string>): unknown {
  if (typeof cur === 'number') return r.next();
  if (typeof cur === 'boolean') return r.next() !== 0;
  if (cur instanceof V3) return new V3(r.next(), r.next(), r.next());
  if (cur instanceof Quat) return new Quat(r.next(), r.next(), r.next(), r.next());
  if (cur instanceof Map) {
    const m = new Map<number, number>();
    for (let i = 0; i < MAP_SLOTS; i++) {
      const k = r.next(), val = r.next();
      if (k !== -1) m.set(k, val);
    }
    // conservar entradas no numéricas (no serializadas), si las hubiera
    for (const [k, val] of cur) if (typeof k !== 'number' || typeof val !== 'number') m.set(k as number, val as number);
    return m;
  }
  if (Array.isArray(cur)) {
    const n = r.next();
    if (n === cur.length) {
      for (let i = 0; i < n; i++) cur[i] = readValue(cur[i], r);
      return cur;
    }
    // Longitud distinta: sólo soportado para arreglos de números
    const arr: number[] = [];
    for (let i = 0; i < n; i++) arr.push(r.next());
    return arr;
  }
  if (cur && typeof cur === 'object') {
    const o = cur as Record<string, unknown>;
    for (const k of Object.keys(o).sort()) {
      if (skip?.has(k)) continue;
      const val = o[k];
      if (typeof val === 'function' || typeof val === 'string' || val === undefined || val === null) continue;
      o[k] = readValue(val, r);
    }
    return o;
  }
  return cur;
}

/** Firma estructural (nombres y tipos de los campos) para detectar versiones incompatibles. */
function signatureOf(v: unknown, skip: Set<string> | undefined, acc: string[], path: string) {
  if (typeof v === 'number') { acc.push(path + ':n'); return; }
  if (typeof v === 'boolean') { acc.push(path + ':b'); return; }
  if (v instanceof V3) { acc.push(path + ':v'); return; }
  if (v instanceof Quat) { acc.push(path + ':q'); return; }
  if (v instanceof Map) { acc.push(path + ':m'); return; }
  if (Array.isArray(v)) { acc.push(path + ':a' + v.length); v.forEach((e, i) => signatureOf(e, undefined, acc, path + '.' + i)); return; }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o).sort()) {
      if (skip?.has(k)) continue;
      const val = o[k];
      if (typeof val === 'function' || typeof val === 'string' || val === undefined || val === null) continue;
      signatureOf(val, undefined, acc, path + '.' + k);
    }
  }
}

function hashStr(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** Hash de la estructura del estado (debe coincidir entre servidor y cliente). */
export function stateSignature(world: World): number {
  const wi = internals(world);
  const acc: string[] = [`cars${world.cars.length}`, `pads${world.pads.length}`, `rng${typeof wi.rand}`, `cd${typeof wi.lastCountdown}`];
  signatureOf(world.ball, SKIP_BALL, acc, 'ball');
  // Todos los autos comparten clase: con uno alcanza
  if (world.cars[0]) signatureOf(world.cars[0], SKIP_CAR, acc, 'car');
  return hashStr(acc.join('|'));
}

// ---------- Mundo completo ----------

/** Aplana el estado dinámico del mundo en un arreglo de números (en float64). */
export function captureWorld(world: World): number[] {
  const w = world;
  const wi = internals(world);
  const out: number[] = [];
  out.push(w.tick, PHASES.indexOf(w.phase), w.phaseTimer, w.clock, w.overtime ? 1 : 0, w.zeroClock ? 1 : 0);
  out.push(w.score[0], w.score[1], w.winner, wi.lastCountdown ?? 0);
  const lg = w.lastGoal;
  out.push(lg ? 1 : 0, lg ? lg.team : 0, lg ? lg.scorerId : 0, lg ? lg.tick : 0);
  const s = wi.__netRng ? wi.__netRng.s : 0;
  out.push(s >>> 16, s & 0xffff);
  writeValue(w.ball, out, SKIP_BALL);
  for (const p of w.pads) out.push(p.active ? 1 : 0, p.timer);
  out.push(w.cars.length);
  for (const c of w.cars) writeValue(c, out, SKIP_CAR);
  return out;
}

/** Restaura el estado dinámico desde un arreglo plano (inverso exacto de captureWorld). */
export function restoreWorld(world: World, flat: ArrayLike<number>) {
  const w = world;
  const wi = internals(world);
  const r = new Reader(flat);
  w.tick = r.next();
  w.phase = PHASES[r.next()] ?? 'playing';
  w.phaseTimer = r.next();
  w.clock = r.next();
  w.overtime = r.next() !== 0;
  w.zeroClock = r.next() !== 0;
  w.score[0] = r.next();
  w.score[1] = r.next();
  w.winner = r.next();
  const lc = r.next();
  if (typeof wi.lastCountdown === 'number') wi.lastCountdown = lc;
  const hasGoal = r.next() !== 0;
  const team = r.next(), scorerId = r.next(), gtick = r.next();
  w.lastGoal = hasGoal ? { team, scorerId, tick: gtick } : null;
  const hi = r.next(), lo = r.next();
  if (wi.__netRng) wi.__netRng.s = ((hi << 16) | lo) >>> 0;
  readValue(w.ball, r, SKIP_BALL);
  for (const p of w.pads) { p.active = r.next() !== 0; p.timer = r.next(); }
  const n = r.next();
  if (n !== w.cars.length) throw new Error(`estado incompatible: ${n} autos vs ${w.cars.length}`);
  for (const c of w.cars) readValue(c, r, SKIP_CAR);
}

/** Cuantiza a float32 (lo que viaja por la red). */
export function quantize(flat: number[]): Float32Array {
  return Float32Array.from(flat);
}

/**
 * Cuantiza el mundo en el lugar: después de esto el estado es exactamente el que viaja por la red.
 * El servidor y el cliente lo hacen en los mismos ticks, así siguen caminos bit a bit idénticos.
 */
export function quantizeWorldInPlace(world: World): Float32Array {
  const q = quantize(captureWorld(world));
  restoreWorld(world, q);
  return q;
}

// ---------- Delta ----------

/** Compara dos estados planos; devuelve el máximo error absoluto (Infinity si la estructura difiere). */
export function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x !== y) {
      const d = Math.abs(x - y);
      if (!(d <= m)) m = Number.isNaN(d) ? Infinity : d;
    }
  }
  return m;
}
