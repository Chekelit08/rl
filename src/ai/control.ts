// Modelo de capacidades del auto y controladores de bajo nivel (manejo, velocidad, orientación aérea, recuperación).
// Todo se traduce a CarInput: los bots "aprietan los mismos botones" que un humano.

import { arenaDistance, arenaNormal } from '../sim/arena.ts';
import type { Car, CarInput } from '../sim/car.ts';
import { CAR, CURVATURE_CURVE, GRAVITY, THROTTLE_CURVE } from '../sim/constants.ts';
import { clamp, curve, Quat, V3 } from '../sim/math.ts';
import type { BotParams } from './params.ts';
import { HORIZON, SLICE_DT } from './prediction.ts';

const Z = new V3(0, 0, 1);

// ---------------------------------------------------------------------------
// Geometría local
// ---------------------------------------------------------------------------

/** Ángulo horizontal hacia un punto en el marco del auto (+ = a la derecha). */
export function localAngle(car: Car, target: V3): number {
  const l = car.q.unrotate(target.sub(car.pos));
  return Math.atan2(-l.y, l.x);
}

export function flatDist(a: V3, b: V3) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function flat(v: V3) { return new V3(v.x, v.y, 0); }

/** Velocidad hacia adelante (en el eje del auto). */
export function forwardSpeed(car: Car) { return car.vel.dot(car.forward()); }

// ---------------------------------------------------------------------------
// Modelo de alcance en el piso
// ---------------------------------------------------------------------------

/**
 * Curva de distancia recorrida en línea recta en función del tiempo, partiendo de v0 y con el turbo disponible.
 * reach[i] = distancia a los (i+1)·SLICE_DT segundos.
 */
export function reachCurve(v0: number, boost: number, p: BotParams, unlimited = false): Float32Array {
  const n = Math.round(HORIZON / SLICE_DT);
  const out = new Float32Array(n);
  let v = Math.max(0, v0), d = 0, b = unlimited ? 1e9 : boost;
  const dt = SLICE_DT;
  for (let i = 0; i < n; i++) {
    let a = p.maxThrottle * CAR.THROTTLE_ACCEL * curve(THROTTLE_CURVE, v);
    if (p.useBoost && b > 0 && v < CAR.MAX_SPEED - 1) {
      a = CAR.THROTTLE_ACCEL * curve(THROTTLE_CURVE, v) + CAR.BOOST_GROUND;
      b -= CAR.BOOST_PER_SEC * dt;
    }
    v = Math.min(CAR.MAX_SPEED, v + a * dt);
    d += v * dt;
    out[i] = d;
  }
  return out;
}

/** Tiempo para recorrer una distancia según la curva de alcance (Infinity si no llega en el horizonte). */
export function timeToCover(reach: Float32Array, dist: number): number {
  if (dist <= 0) return 0;
  if (dist > reach[reach.length - 1]) return Infinity;
  let lo = 0, hi = reach.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reach[mid] >= dist) hi = mid; else lo = mid + 1;
  }
  return (lo + 1) * SLICE_DT;
}

/** Tiempo aproximado para girar el rumbo un ángulo dado (con o sin derrape). */
export function turnTime(car: Car, angle: number, p: BotParams): number {
  const a = Math.abs(angle);
  if (a < 0.08) return 0;
  const v = Math.max(400, Math.abs(forwardSpeed(car)));
  const omega = v * curve(CURVATURE_CURVE, v); // rad/s
  const eff = p.powerslide && a > 1.2 ? omega * 1.9 : omega;
  return a / Math.max(eff, 1.2);
}

// ---------------------------------------------------------------------------
// Perfil de salto (para remates de cabeza / con salto)
// ---------------------------------------------------------------------------

const JUMP_TICKS = 240;
/** Altura del origen del auto sobre la posición inicial en función del tiempo (salto mantenido 0,2 s). */
export const JUMP_Z = new Float32Array(JUMP_TICKS);
/** Ídem con doble salto al terminar el primero. */
export const DOUBLE_JUMP_Z = new Float32Array(JUMP_TICKS);
(() => {
  for (const [arr, dbl] of [[JUMP_Z, false], [DOUBLE_JUMP_Z, true]] as const) {
    let z = 0, vz = CAR.JUMP_IMPULSE, t = 0;
    const dt = 1 / 120;
    let didDouble = false;
    for (let i = 0; i < JUMP_TICKS; i++) {
      let a = GRAVITY;
      if (t < CAR.JUMP_MAX_TIME) a += CAR.JUMP_ACCEL * (t < CAR.JUMP_MIN_TIME ? 0.62 : 1);
      vz += a * dt;
      if (dbl && !didDouble && t >= CAR.JUMP_MAX_TIME + 2 / 120) { vz += CAR.JUMP_IMPULSE; didDouble = true; }
      z += vz * dt;
      t += dt;
      arr[i] = z;
    }
  }
})();

/** Tiempo (s) para que el auto suba Δz con el perfil dado (mientras sube). Infinity si no alcanza. */
export function riseTime(profile: Float32Array, dz: number): number {
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] >= dz) return (i + 1) / 120;
    if (i > 0 && profile[i] < profile[i - 1]) break; // empezó a bajar
  }
  return Infinity;
}

// ---------------------------------------------------------------------------
// Controladores en el piso
// ---------------------------------------------------------------------------

/** Volante + derrape + reversa hacia un punto. Devuelve el ángulo al objetivo. */
export function steerTo(car: Car, inp: CarInput, target: V3, p: BotParams, allowReverse = true): number {
  const ang = localAngle(car, target);
  const dist = flatDist(car.pos, target);
  const fs = forwardSpeed(car);
  // Reversa corta si el objetivo está muy atrás y cerca
  if (allowReverse && Math.abs(ang) > 2.4 && dist < 650 && fs < 400) {
    const back = ang > 0 ? ang - Math.PI : ang + Math.PI;
    inp.steer = clamp(-back * p.steerGain, -1, 1);
    inp.throttle = -1;
    return ang;
  }
  inp.steer = clamp(ang * p.steerGain, -1, 1);
  inp.handbrake = p.powerslide && Math.abs(ang) > 1.55 && fs > 450 && car.onGround;
  return ang;
}

/**
 * Control de velocidad hacia adelante: acelera, frena o usa turbo para acercarse a la velocidad deseada.
 * aligned indica si estamos apuntando al objetivo (sólo entonces conviene el turbo).
 */
export function speedControl(car: Car, inp: CarInput, desired: number, p: BotParams, aligned: boolean) {
  const fs = forwardSpeed(car);
  const target = Math.min(desired, CAR.MAX_SPEED);
  if (inp.throttle === -1) return; // reversa ya decidida
  if (fs < target - 40) {
    inp.throttle = p.maxThrottle;
    const needBoost = target > 1350 || target - fs > 450;
    inp.boost = p.useBoost && aligned && needBoost && car.boost > 0 && fs < CAR.MAX_SPEED - 30;
  } else if (fs > target + 160) {
    inp.throttle = fs > target + 450 ? -1 : 0;
    inp.boost = false;
  } else {
    inp.throttle = Math.min(p.maxThrottle, 0.3 + (target / 1410) * 0.7);
    inp.boost = false;
  }
}

/** Ir a un punto llegando en un tiempo dado (control de llegada). */
export function arriveAt(car: Car, inp: CarInput, target: V3, timeLeft: number, p: BotParams) {
  const ang = steerTo(car, inp, target, p);
  const dist = flatDist(car.pos, target);
  const aligned = Math.abs(ang) < 0.35;
  let desired: number;
  if (!p.arrivalControl || timeLeft <= 0.05) desired = CAR.MAX_SPEED;
  else desired = clamp(dist / timeLeft, 0, CAR.MAX_SPEED);
  // Si hay que girar mucho, bajar la velocidad deseada para no pasarse
  if (Math.abs(ang) > 0.9 && dist < 1500) desired = Math.min(desired, 1100);
  speedControl(car, inp, desired, p, aligned);
  return ang;
}

/** Ir a un punto lo más rápido posible (con frenada para quedarse quieto al llegar). */
export function driveTo(car: Car, inp: CarInput, target: V3, p: BotParams, opts: { stopAt?: boolean; boost?: boolean } = {}) {
  const ang = steerTo(car, inp, target, p);
  const dist = flatDist(car.pos, target);
  let desired: number = CAR.MAX_SPEED;
  if (opts.stopAt) desired = clamp(dist * 1.6, 0, CAR.MAX_SPEED);
  if (opts.boost === false) desired = Math.min(desired, 1400);
  speedControl(car, inp, desired, p, Math.abs(ang) < 0.3 && dist > 700);
  return ang;
}

// ---------------------------------------------------------------------------
// Control aéreo
// ---------------------------------------------------------------------------

export function quatFromBasis(f: V3, l: V3, u: V3): Quat {
  const m00 = f.x, m01 = l.x, m02 = u.x;
  const m10 = f.y, m11 = l.y, m12 = u.y;
  const m20 = f.z, m21 = l.z, m22 = u.z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = new Quat((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s);
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = new Quat(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = new Quat((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = new Quat((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }
  return q.normIn();
}

/**
 * Control PD para orientar el auto en el aire: nariz hacia fwd, techo lo más cerca posible de upHint.
 * Devuelve el error angular restante (rad).
 */
export function orient(car: Car, inp: CarInput, fwd: V3, upHint: V3, kp: number, kd: number): number {
  const f = fwd.norm();
  let left = upHint.cross(f);
  if (left.len2() < 1e-4) left = Z.cross(f);
  if (left.len2() < 1e-4) left = new V3(0, 1, 0);
  left.normIn();
  const up = f.cross(left);
  const target = quatFromBasis(f, left, up);
  const err = target.mul(car.q.conj());
  if (err.w < 0) { err.x = -err.x; err.y = -err.y; err.z = -err.z; err.w = -err.w; }
  const angle = 2 * Math.acos(clamp(err.w, -1, 1));
  const s = Math.sqrt(Math.max(1 - err.w * err.w, 1e-9));
  const axisW = new V3(err.x / s, err.y / s, err.z / s).scale(angle);
  const eLocal = car.q.unrotate(axisW);
  const wLocal = car.q.unrotate(car.ang);
  const desired = eLocal.scale(kp).sub(wLocal.scale(kd));
  inp.roll = clamp(desired.x * 0.7, -1, 1);
  inp.pitch = clamp(-desired.y, -1, 1);
  inp.yaw = clamp(-desired.z, -1, 1);
  return angle;
}

// ---------------------------------------------------------------------------
// Recuperación: caer sobre las ruedas (piso, paredes, rampas)
// ---------------------------------------------------------------------------

export interface Landing { t: number; pos: V3; normal: V3 }

/** Predicción balística del aterrizaje (sin turbo). */
export function predictLanding(car: Car, maxT = 3): Landing | null {
  const p = car.pos.clone();
  const v = car.vel.clone();
  const dt = 1 / 60;
  for (let t = dt; t <= maxT; t += dt) {
    v.z += GRAVITY * dt;
    p.addScaledIn(v, dt);
    const d = arenaDistance(p.x, p.y, p.z);
    if (d < CAR.REST_Z + 12) return { t, pos: p.clone(), normal: arenaNormal(p.x, p.y, p.z) };
  }
  return null;
}

/**
 * Orienta el auto para aterrizar sobre las ruedas, con la nariz en la dirección del movimiento.
 * Devuelve la predicción de aterrizaje (o null).
 */
export function recover(car: Car, inp: CarInput, p: BotParams, faceTo?: V3): Landing | null {
  const land = predictLanding(car);
  const n = land ? land.normal : Z;
  // Dirección deseada: velocidad proyectada en el plano de aterrizaje (o hacia faceTo)
  let f: V3;
  if (faceTo) f = faceTo.sub(car.pos);
  else f = car.vel.clone();
  f = f.sub(n.scale(f.dot(n)));
  if (f.len2() < 200 * 200) {
    const cf = car.forward();
    f = cf.sub(n.scale(cf.dot(n)));
  }
  if (f.len2() < 1e-3) f = new V3(1, 0, 0);
  orient(car, inp, f.norm(), n, p.airKp, p.airKd);
  inp.throttle = 1;
  // Derrape justo antes de tocar el piso para no perder velocidad al acomodarse
  if (land && land.t < 0.12 && p.powerslide) inp.handbrake = true;
  return land;
}

/** ¿Tiene un flip/doble salto disponible en el aire? */
export function hasFlip(car: Car): boolean {
  if (car.onGround) return true;
  if (car.hasFlipped || car.hasDoubleJumped) return false;
  return !car.hasJumped || car.airTimeSinceJump < CAR.DOUBLE_JUMP_WINDOW - 0.05;
}

export { Z as WORLD_UP };
