// Protocolo del online. Mensajes de control en JSON; inputs y snapshots en binario.
// Sin dependencias del DOM: lo usan el servidor (Node), el cliente del navegador y las pruebas.

import type { CarInput } from '../sim/car.ts';
import type { GameEvent, MatchConfig } from '../sim/world.ts';

export const PROTOCOL_VERSION = 4;
export const DEFAULT_PORT = 8787;
/** Ticks entre snapshots (2 = 60 Hz, 4 = 30 Hz). El servidor baja a 30 Hz si un cliente se congestiona (o con SNAPSHOT_HZ=30). */
export const SNAPSHOT_EVERY = 2;
export const SNAPSHOT_EVERY_SLOW = 4;
/** Los dos lados cuantizan el estado en múltiplos de este número de ticks. */
export const QUANT_EVERY = 2;

export interface LobbyPlayer { id: string; name: string; team: number; ready: boolean; connected: boolean; body: number; host: boolean }
export interface RoomConfig { teamSize: number; duration: number; botFill: boolean; botDifficulty: 0 | 1 | 2 }
export interface RosterEntry { carId: number; name: string; team: number; body: number; isBot: boolean; playerId: string | null }

export type ClientMsg =
  | { t: 'hello'; name: string; token: string; body: number; version: number }
  | { t: 'create'; cfg: RoomConfig }
  | { t: 'join'; code: string }
  | { t: 'team'; team: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'config'; cfg: Partial<RoomConfig> }
  | { t: 'start' }
  | { t: 'leave' }
  | { t: 'lobby' }
  | { t: 'resync' }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'welcome'; id: string; token: string }
  | { t: 'room'; code: string; state: 'lobby' | 'playing' | 'results'; players: LobbyPlayer[]; cfg: RoomConfig; you: string }
  | { t: 'start'; matchId: number; cfg: MatchConfig; roster: RosterEntry[]; yourCarId: number; sig: number; quantEvery: number }
  | { t: 'ev'; tick: number; e: GameEvent }
  | { t: 'end'; score: number[]; winner: number }
  | { t: 'pong'; c: number; s: number }
  | { t: 'left' }
  | { t: 'error'; msg: string }
  | { t: 'kicked'; reason: string };

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;
export const FULL = 0xffffffff;

// ---------- Inputs ----------

const q8 = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));

/** Cuantiza un input igual que viaja por la red (el cliente predice con el input cuantizado). */
export function quantizeInput(i: CarInput): CarInput {
  return {
    throttle: q8(i.throttle) / 127, steer: q8(i.steer) / 127, pitch: q8(i.pitch) / 127,
    yaw: q8(i.yaw) / 127, roll: q8(i.roll) / 127, jump: !!i.jump, boost: !!i.boost, handbrake: !!i.handbrake,
  };
}

export const INPUT_BYTES = 6;

function writeInput(dv: DataView, o: number, i: CarInput) {
  dv.setInt8(o, q8(i.throttle));
  dv.setInt8(o + 1, q8(i.steer));
  dv.setInt8(o + 2, q8(i.pitch));
  dv.setInt8(o + 3, q8(i.yaw));
  dv.setInt8(o + 4, q8(i.roll));
  dv.setUint8(o + 5, (i.jump ? 1 : 0) | (i.boost ? 2 : 0) | (i.handbrake ? 4 : 0));
}

function readInput(dv: DataView, o: number): CarInput {
  const b = dv.getUint8(o + 5);
  return {
    throttle: dv.getInt8(o) / 127, steer: dv.getInt8(o + 1) / 127, pitch: dv.getInt8(o + 2) / 127,
    yaw: dv.getInt8(o + 3) / 127, roll: dv.getInt8(o + 4) / 127,
    jump: (b & 1) !== 0, boost: (b & 2) !== 0, handbrake: (b & 4) !== 0,
  };
}

/** Paquete de inputs: los últimos N ticks (redundancia contra pérdidas) + confirmación del último snapshot. */
export function encodeInputs(ackSeq: number, lastTick: number, inputs: CarInput[]): ArrayBuffer {
  const n = Math.min(255, inputs.length);
  const buf = new ArrayBuffer(10 + n * INPUT_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG_INPUT);
  dv.setUint32(1, ackSeq >>> 0);
  dv.setUint32(5, lastTick >>> 0);
  dv.setUint8(9, n);
  const start = inputs.length - n;
  for (let k = 0; k < n; k++) writeInput(dv, 10 + k * INPUT_BYTES, inputs[start + k]);
  return buf;
}

export function decodeInputs(buf: ArrayBuffer): { ackSeq: number; lastTick: number; inputs: CarInput[] } {
  const dv = new DataView(buf);
  const ackSeq = dv.getUint32(1);
  const lastTick = dv.getUint32(5);
  const n = dv.getUint8(9);
  const inputs: CarInput[] = [];
  for (let k = 0; k < n; k++) inputs.push(readInput(dv, 10 + k * INPUT_BYTES));
  return { ackSeq, lastTick, inputs };
}

// ---------- Snapshots con delta ----------

export interface SnapshotHeader {
  seq: number; tick: number; baseline: number; slack: number; sig: number;
  /** Fracción de ticks recientes en que el input de este jugador no llegó a tiempo al servidor (0..1). */
  loss: number;
}
const SNAP_HEADER = 1 + 4 + 4 + 4 + 2 + 4 + 2 + 1 + 1;

const u32Of = (a: Float32Array) => new Uint32Array(a.buffer, a.byteOffset, a.length);

/**
 * Snapshot: estado completo en float32, o delta contra el último estado que recibió el cliente
 * (WebSocket es confiable y ordenado). El delta lleva una máscara de bits de los valores que cambiaron y,
 * por cada uno, el XOR de sus bits contra la línea base sin los bytes altos en cero (2 bits de largo + 1..4 bytes):
 * los valores que cambian poco comparten signo, exponente y la parte alta de la mantisa.
 */
export function encodeSnapshot(h: SnapshotHeader, flat: Float32Array, base: Float32Array | null): ArrayBuffer {
  const n = flat.length;
  const useDelta = !!base && base.length === n && h.baseline !== FULL;
  let buf: ArrayBuffer;
  let dv: DataView;
  if (useDelta) {
    const a = u32Of(flat), b = u32Of(base!);
    const maskBytes = (n + 7) >> 3;
    const idx: number[] = [], xs: number[] = [];
    let bytes = 0;
    for (let i = 0; i < n; i++) {
      const x = (a[i] ^ b[i]) >>> 0;
      if (x !== 0) { idx.push(i); xs.push(x); bytes += x > 0xffffff ? 4 : x > 0xffff ? 3 : x > 0xff ? 2 : 1; }
    }
    const lenBytes = (idx.length + 3) >> 2;
    buf = new ArrayBuffer(SNAP_HEADER + maskBytes + lenBytes + bytes);
    dv = new DataView(buf);
    const mo = SNAP_HEADER, lo = mo + maskBytes;
    let o = lo + lenBytes;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], x = xs[k];
      dv.setUint8(mo + (i >> 3), dv.getUint8(mo + (i >> 3)) | (1 << (i & 7)));
      const L = x > 0xffffff ? 4 : x > 0xffff ? 3 : x > 0xff ? 2 : 1;
      dv.setUint8(lo + (k >> 2), dv.getUint8(lo + (k >> 2)) | ((L - 1) << ((k & 3) * 2)));
      for (let j = L - 1; j >= 0; j--) dv.setUint8(o++, (x >>> (j * 8)) & 0xff);
    }
  } else {
    buf = new ArrayBuffer(SNAP_HEADER + n * 4);
    dv = new DataView(buf);
    for (let i = 0; i < n; i++) dv.setFloat32(SNAP_HEADER + i * 4, flat[i]);
  }
  dv.setUint8(0, MSG_SNAPSHOT);
  dv.setUint32(1, h.seq >>> 0);
  dv.setUint32(5, h.tick >>> 0);
  dv.setUint32(9, useDelta ? h.baseline >>> 0 : FULL);
  dv.setInt16(13, Math.max(-32768, Math.min(32767, Math.round(h.slack))));
  dv.setUint32(15, h.sig >>> 0);
  dv.setUint16(19, n);
  dv.setUint8(21, useDelta ? 1 : 0);
  dv.setUint8(22, Math.max(0, Math.min(255, Math.round(h.loss * 255))));
  return buf;
}

export function decodeSnapshotHeader(buf: ArrayBuffer): SnapshotHeader & { n: number; delta: boolean } {
  const dv = new DataView(buf);
  return {
    seq: dv.getUint32(1), tick: dv.getUint32(5), baseline: dv.getUint32(9), slack: dv.getInt16(13),
    sig: dv.getUint32(15), n: dv.getUint16(19), delta: dv.getUint8(21) === 1, loss: dv.getUint8(22) / 255,
  };
}

/** Reconstruye el estado completo. Devuelve null si falta la línea base o no coincide. */
export function decodeSnapshotBody(buf: ArrayBuffer, base: Float32Array | null): Float32Array | null {
  const h = decodeSnapshotHeader(buf);
  const dv = new DataView(buf);
  const out = new Float32Array(h.n);
  if (!h.delta) {
    for (let i = 0; i < h.n; i++) out[i] = dv.getFloat32(SNAP_HEADER + i * 4);
    return out;
  }
  if (!base || base.length !== h.n) return null;
  const a = u32Of(out), b = u32Of(base);
  const maskBytes = (h.n + 7) >> 3;
  let changed = 0;
  for (let i = 0; i < maskBytes; i++) { let m = dv.getUint8(SNAP_HEADER + i); while (m) { changed += m & 1; m >>= 1; } }
  const mo = SNAP_HEADER, lo = mo + maskBytes;
  let o = lo + ((changed + 3) >> 2);
  let k = 0;
  for (let i = 0; i < h.n; i++) {
    if (dv.getUint8(mo + (i >> 3)) & (1 << (i & 7))) {
      const L = ((dv.getUint8(lo + (k >> 2)) >> ((k & 3) * 2)) & 3) + 1;
      let x = 0;
      for (let j = 0; j < L; j++) x = ((x << 8) | dv.getUint8(o++)) >>> 0;
      a[i] = (b[i] ^ x) >>> 0;
      k++;
    } else a[i] = b[i];
  }
  return out;
}

// ---------- Utilidades ----------

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O (se confunden con 1 y 0)
export function randomCode(len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
}

export function randomToken(): string {
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

/** Eventos que decide el servidor (el cliente no los toma de su predicción). */
export const AUTHORITATIVE_EVENTS = new Set(['goal', 'demo', 'save', 'shot', 'countdown', 'kickoff', 'overtime', 'end']);
/** Eventos cosméticos que el cliente toma de su propia predicción (respuesta inmediata). */
export const PREDICTED_EVENTS = new Set(['hit', 'bounce', 'pad', 'jump', 'flip', 'flipreset', 'bump']);
