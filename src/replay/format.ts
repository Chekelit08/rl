// Formato compacto de repeticiones y clips: cada cuadro se cuantiza a Int16 y el conjunto se comprime con gzip.
// Se usa para partidos completos (30 cuadros/s), clips (60 cuadros/s) y archivos exportados.

import { Quat } from '../sim/math.ts';
import type { CarSnap, Snapshot } from '../sim/world.ts';

export type ReplayKind = 'partido' | 'clip';

export interface ReplayCarInfo { id: number; team: number; name: string; bodyIndex: number }
export interface ReplayGoal { t: number; team: number; scorer: string }

export interface ReplayMeta {
  id: string;
  kind: ReplayKind;
  title: string;
  date: number;
  mode: string; // "1v1", "Juego libre", "Entrenamiento"…
  fps: number;
  frames: number;
  nCars: number;
  nPads: number;
  duration: number; // s
  score: [number, number];
  winner: number;
  cars: ReplayCarInfo[];
  goals: ReplayGoal[];
  saved: boolean; // guardada a mano (no se borra sola)
  version: 1;
}

export interface HudFrame { clock: number; score: [number, number]; overtime: boolean }

const POS = 4; // uu → unidades enteras (precisión 0.25 uu)
const VEL = 4;
const Q = 32767;
const HEADER = 4; // reloj, gol azul, gol rojo, flags
const BALL = 10;
const CAR = 15;
const padWords = (nPads: number) => Math.ceil(nPads / 16);

export function strideFor(nCars: number, nPads: number) {
  return HEADER + BALL + padWords(nPads) + CAR * nCars;
}

const i16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)));

/** Escribe un cuadro en `out` a partir de `off`. */
export function writeFrame(out: Int16Array, off: number, snap: Snapshot, hud: HudFrame, nCars: number) {
  let o = off;
  out[o++] = i16(hud.clock * 10);
  out[o++] = hud.score[0];
  out[o++] = hud.score[1];
  out[o++] = (hud.overtime ? 1 : 0) | (snap.ball.hidden ? 2 : 0);
  const b = snap.ball;
  out[o++] = i16(b.x * POS); out[o++] = i16(b.y * POS); out[o++] = i16(b.z * POS);
  out[o++] = i16(b.qx * Q); out[o++] = i16(b.qy * Q); out[o++] = i16(b.qz * Q); out[o++] = i16(b.qw * Q);
  out[o++] = i16(b.vx * VEL); out[o++] = i16(b.vy * VEL); out[o++] = i16(b.vz * VEL);
  const pw = padWords(snap.pads.length);
  for (let w = 0; w < pw; w++) {
    let bits = 0;
    for (let k = 0; k < 16; k++) if (snap.pads[w * 16 + k]) bits |= 1 << k;
    out[o++] = (bits << 16) >> 16; // a Int16 con signo
  }
  for (let i = 0; i < nCars; i++) {
    const c = snap.cars[i];
    if (!c) { o += CAR; continue; }
    out[o++] = i16(c.x * POS); out[o++] = i16(c.y * POS); out[o++] = i16(c.z * POS);
    out[o++] = i16(c.qx * Q); out[o++] = i16(c.qy * Q); out[o++] = i16(c.qz * Q); out[o++] = i16(c.qw * Q);
    out[o++] = i16(c.vx * VEL); out[o++] = i16(c.vy * VEL); out[o++] = i16(c.vz * VEL);
    out[o++] = (c.boosting ? 1 : 0) | (c.supersonic ? 2 : 0) | (c.demoed ? 4 : 0) | (c.onGround ? 8 : 0);
    out[o++] = i16(c.steer * 127);
    out[o++] = i16((c.throttle ?? 0) * 127);
    out[o++] = i16(c.boost * 100);
    out[o++] = i16(c.handbrake * 1000);
  }
}

/** Lee el cuadro `i` como Snapshot (los datos fijos —id, equipo— vienen de la meta). */
export function readFrame(data: Int16Array, i: number, meta: Pick<ReplayMeta, 'nCars' | 'nPads' | 'cars'>, out?: Snapshot): Snapshot {
  const stride = strideFor(meta.nCars, meta.nPads);
  let o = i * stride + HEADER;
  const ball = {
    x: data[o++] / POS, y: data[o++] / POS, z: data[o++] / POS,
    qx: data[o++] / Q, qy: data[o++] / Q, qz: data[o++] / Q, qw: data[o++] / Q,
    vx: data[o++] / VEL, vy: data[o++] / VEL, vz: data[o++] / VEL,
    hidden: (data[i * stride + 3] & 2) !== 0,
  };
  const pads: boolean[] = [];
  const pw = padWords(meta.nPads);
  for (let w = 0; w < pw; w++) {
    const bits = data[o++] & 0xffff;
    for (let k = 0; k < 16 && w * 16 + k < meta.nPads; k++) pads.push((bits & (1 << k)) !== 0);
  }
  const cars: CarSnap[] = [];
  for (let k = 0; k < meta.nCars; k++) {
    const info = meta.cars[k];
    const x = data[o++] / POS, y = data[o++] / POS, z = data[o++] / POS;
    const qx = data[o++] / Q, qy = data[o++] / Q, qz = data[o++] / Q, qw = data[o++] / Q;
    const vx = data[o++] / VEL, vy = data[o++] / VEL, vz = data[o++] / VEL;
    const f = data[o++];
    const steer = data[o++] / 127, throttle = data[o++] / 127, boost = data[o++] / 100, handbrake = data[o++] / 1000;
    cars.push({
      id: info?.id ?? k, team: info?.team ?? 0, x, y, z, qx, qy, qz, qw, vx, vy, vz,
      boosting: (f & 1) !== 0, supersonic: (f & 2) !== 0, demoed: (f & 4) !== 0, onGround: (f & 8) !== 0,
      steer, throttle, boost, handbrake,
    } as CarSnap);
  }
  const snap: Snapshot = { tick: i, ball, pads, cars };
  if (out) Object.assign(out, snap);
  return snap;
}

export function readHud(data: Int16Array, i: number, meta: Pick<ReplayMeta, 'nCars' | 'nPads'>): HudFrame {
  const o = i * strideFor(meta.nCars, meta.nPads);
  return { clock: data[o] / 10, score: [data[o + 1], data[o + 2]], overtime: (data[o + 3] & 1) !== 0 };
}

/** Interpola dos snapshots (posiciones lineales, rotaciones esféricas; sin interpolar teletransportes). */
export function lerpSnapshots(a: Snapshot, b: Snapshot, t: number): Snapshot {
  const L = (x: number, y: number) => x + (y - x) * t;
  const sl = (ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number) =>
    new Quat(ax, ay, az, aw).normIn().slerp(new Quat(bx, by, bz, bw).normIn(), t);
  const jumpB = Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y, a.ball.z - b.ball.z) > 500;
  const qb = sl(a.ball.qx, a.ball.qy, a.ball.qz, a.ball.qw, b.ball.qx, b.ball.qy, b.ball.qz, b.ball.qw);
  const kb = jumpB ? 1 : t;
  return {
    tick: b.tick,
    pads: t < 0.5 ? a.pads : b.pads,
    ball: {
      ...b.ball,
      x: a.ball.x + (b.ball.x - a.ball.x) * kb, y: a.ball.y + (b.ball.y - a.ball.y) * kb, z: a.ball.z + (b.ball.z - a.ball.z) * kb,
      vx: L(a.ball.vx, b.ball.vx), vy: L(a.ball.vy, b.ball.vy), vz: L(a.ball.vz, b.ball.vz),
      qx: qb.x, qy: qb.y, qz: qb.z, qw: qb.w,
    },
    cars: b.cars.map((cb, i) => {
      const ca = a.cars[i];
      if (!ca || ca.demoed !== cb.demoed || Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z) > 400) return cb;
      const q = sl(ca.qx, ca.qy, ca.qz, ca.qw, cb.qx, cb.qy, cb.qz, cb.qw);
      return {
        ...cb, x: L(ca.x, cb.x), y: L(ca.y, cb.y), z: L(ca.z, cb.z), qx: q.x, qy: q.y, qz: q.z, qw: q.w,
        vx: L(ca.vx, cb.vx), vy: L(ca.vy, cb.vy), vz: L(ca.vz, cb.vz),
      };
    }),
  };
}

// ---------- Compresión ----------
const hasStreams = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

export async function gzip(bytes: Uint8Array): Promise<{ data: Uint8Array; compressed: boolean }> {
  if (!hasStreams) return { data: bytes, compressed: false };
  try { return { data: await pipe(bytes, new CompressionStream('gzip')), compressed: true }; } catch { return { data: bytes, compressed: false }; }
}

export async function gunzip(bytes: Uint8Array, compressed: boolean): Promise<Uint8Array> {
  if (!compressed) return bytes;
  return pipe(bytes, new DecompressionStream('gzip'));
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasStreams) throw new Error('Este navegador no soporta compresión');
  return pipe(bytes, new CompressionStream('deflate-raw'));
}

export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasStreams) throw new Error('Este navegador no soporta compresión');
  return pipe(bytes, new DecompressionStream('deflate-raw'));
}

export function int16ToBytes(a: Int16Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

export function bytesToInt16(b: Uint8Array): Int16Array {
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Int16Array(copy.buffer, 0, Math.floor(copy.byteLength / 2));
}

// ---------- Base64url ----------
export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- Archivo exportable (.tgrep): "TGR1" + largo meta + meta JSON + datos ----------
export async function packFile(meta: ReplayMeta, frames: Int16Array): Promise<Blob> {
  const z = await gzip(int16ToBytes(frames));
  const metaBytes = new TextEncoder().encode(JSON.stringify({ ...meta, _gz: z.compressed }));
  const head = new Uint8Array(8);
  head.set([84, 71, 82, 49]); // TGR1
  new DataView(head.buffer).setUint32(4, metaBytes.length, true);
  return new Blob([head as BlobPart, metaBytes as BlobPart, z.data as BlobPart], { type: 'application/octet-stream' });
}

export async function unpackFile(buf: ArrayBuffer): Promise<{ meta: ReplayMeta; frames: Int16Array }> {
  const u = new Uint8Array(buf);
  if (u[0] !== 84 || u[1] !== 71 || u[2] !== 82 || u[3] !== 49) throw new Error('No es un archivo de repetición de TURBOGOL');
  const len = new DataView(buf).getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + len))) as ReplayMeta & { _gz?: boolean };
  const raw = await gunzip(u.subarray(8 + len), meta._gz !== false);
  delete meta._gz;
  return { meta, frames: bytesToInt16(raw) };
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
