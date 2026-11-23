// Estrategia de equipo: roles (1.º / 2.º / 3.er hombre), elección de tiro, búsqueda de intercepción,
// posiciones defensivas, rotación por el palo lejano y rutas de turbo.

import type { Car } from '../sim/car.ts';
import { ARENA, BALL, CAR } from '../sim/constants.ts';
import { clamp, V3 } from '../sim/math.ts';
import type { World } from '../sim/world.ts';
import { DOUBLE_JUMP_Z, flat, flatDist, JUMP_Z, localAngle, reachCurve, riseTime, timeToCover, turnTime } from './control.ts';
import { Aerial } from './maneuvers.ts';
import { type BotParams, TUNING } from './params.ts';
import type { BallPredictor, Slice } from './prediction.ts';

export type Role = 'first' | 'second' | 'third';
export type HitKind = 'ground' | 'jump' | 'double' | 'aerial';

export interface ShotPlan {
  kind: HitKind;
  /** Tiempo hasta el contacto (s) y tick absoluto. */
  t: number;
  tick: number;
  ball: V3;
  /** Hacia dónde queremos mandar la pelota. */
  target: V3;
  /** Punto donde tiene que estar el auto al contacto (en el piso para golpes de piso/salto). */
  contact: V3;
  /** Dirección del tiro (horizontal, normalizada). */
  dir: V3;
  /** Tiempo estimado de llegada del auto. */
  eta: number;
}

export const attackSign = (team: number) => (team === 0 ? 1 : -1);
export const ownGoalPos = (team: number) => new V3(0, -attackSign(team) * ARENA.Y, 0);
export const oppGoalPos = (team: number) => new V3(0, attackSign(team) * ARENA.Y, 0);

/** ¿El auto está "en juego" (entre la pelota y su propio arco)? */
export function isOnside(car: Car, ball: V3): boolean {
  return (ball.y - car.pos.y) * attackSign(car.team) > -150;
}

// ---------------------------------------------------------------------------
// Roles con histéresis (memoria compartida por equipo y por mundo)
// ---------------------------------------------------------------------------

const roleMemory = new WeakMap<World, { first: [number, number]; tick: number }>();

/** Estimación rápida del tiempo que tarda un auto en llegar a la pelota. */
export function quickEta(car: Car, pred: BallPredictor, world: World): number {
  if (car.demoed) return Infinity;
  const ballNow = world.ball.pos;
  let best = Infinity;
  const v = Math.max(car.speed(), 600);
  for (let i = 5; i < pred.slices.length; i += 10) {
    const s = pred.slices[i];
    if (s.pos.z > 400) continue;
    const d = flatDist(car.pos, s.pos);
    const eta = d / ((v + 2000) / 2) + Math.abs(localAngle(car, s.pos)) * 0.25;
    if (eta <= s.t) { best = s.t; break; }
  }
  if (best === Infinity) best = flatDist(car.pos, ballNow) / 1200 + 2;
  if (!isOnside(car, ballNow)) best += 1.1;
  if (!car.onGround) best += 0.25;
  return best;
}

export function computeRole(world: World, me: Car, pred: BallPredictor, p: BotParams): Role {
  const mates = world.cars.filter((o) => o.team === me.team);
  if (mates.length <= 1) return 'first';
  if (p.rotation === 0) return 'first';
  let mem = roleMemory.get(world);
  if (!mem) { mem = { first: [-1, -1], tick: -1 }; roleMemory.set(world, mem); }
  const etas = new Map<number, number>();
  for (const m of mates) etas.set(m.id, quickEta(m, pred, world));
  // 1.er hombre con histéresis
  let firstId = [...mates].sort((a, b) => etas.get(a.id)! - etas.get(b.id)! || a.id - b.id)[0].id;
  const prev = mem.first[me.team];
  if (prev >= 0 && prev !== firstId) {
    const prevCar = world.cars[prev];
    if (prevCar && !prevCar.demoed && prevCar.team === me.team && etas.get(prev)! < etas.get(firstId)! + TUNING.roleHysteresis) firstId = prev;
  }
  if (mem.tick !== world.tick) { mem.first[me.team] = firstId; }
  mem.tick = world.tick;
  if (me.id === firstId) return 'first';
  // Entre el resto: el más adelantado (más cerca de la pelota en profundidad) es el 2.º, el más atrás el 3.º
  const others = mates.filter((m) => m.id !== firstId && !m.demoed);
  if (others.length <= 1) return 'second';
  const s = attackSign(me.team);
  others.sort((a, b) => (b.pos.y - a.pos.y) * s || a.id - b.id);
  return others[0].id === me.id ? 'second' : 'third';
}

// ---------------------------------------------------------------------------
// Elección del objetivo del tiro
// ---------------------------------------------------------------------------

/** Elige a qué parte del arco rival (o hacia dónde despejar) mandar la pelota. */
export function chooseShotTarget(world: World, me: Car, ballPos: V3, rand: () => number, p: BotParams): V3 {
  const s = attackSign(me.team);
  const ownY = -s * ARENA.Y;
  const distOwn = Math.abs(ballPos.y - ownY);
  // Despeje: pelota en el tercio propio y lejos del centro → afuera, hacia el lateral y adelante
  if (distOwn < 3000 && Math.abs(ballPos.x) > 600) {
    const side = Math.sign(ballPos.x) || 1;
    return new V3(side * 3900, ballPos.y + s * 3500, 300);
  }
  if (distOwn < 1800) {
    const side = Math.sign(ballPos.x) || (rand() < 0.5 ? -1 : 1);
    return new V3(side * 4000, ballPos.y + s * 2500, 500);
  }
  // Tiro al arco: elegir el punto con más ángulo libre respecto de los rivales
  const goalY = s * (ARENA.Y + 200);
  const opps = world.cars.filter((o) => o.team !== me.team && !o.demoed);
  let bestX = 0, bestScore = -Infinity;
  for (const x of [-620, -360, -120, 120, 360, 620]) {
    const tgt = new V3(x, goalY, 0);
    const d = tgt.sub(ballPos).norm();
    let score = 0;
    for (const o of opps) {
      const rel = o.pos.sub(ballPos);
      const along = rel.dot(d);
      if (along < 0) continue;
      const perp = rel.sub(d.scale(along)).len();
      score -= Math.max(0, 900 - perp) * (1 + 2000 / (along + 400));
    }
    // Preferir el palo lejano respecto de la pelota (ángulo más abierto)
    score -= Math.abs(x - -Math.sign(ballPos.x) * 300) * 0.3;
    if (score > bestScore) { bestScore = score; bestX = x; }
  }
  const err = (rand() * 2 - 1) * p.aimError;
  const tgt = new V3(bestX, goalY, 180);
  if (err !== 0) {
    const d = tgt.sub(ballPos);
    const c = Math.cos(err), sn = Math.sin(err);
    return ballPos.add(new V3(d.x * c - d.y * sn, d.x * sn + d.y * c, d.z));
  }
  return tgt;
}

// ---------------------------------------------------------------------------
// Búsqueda de intercepción
// ---------------------------------------------------------------------------

/** Altura (centro de la pelota) que el auto alcanza con un salto, contando el hitbox. */
const CAR_REACH_Z = CAR.REST_Z + 35 + BALL.RADIUS; // altura de contacto sin saltar ≈ 143

export interface SearchOpts {
  target: V3;
  allowAerial: boolean;
  /** Margen extra de tiempo exigido (s). */
  margin: number;
  /** Sólo considera muestras desde este tiempo (s). */
  minT?: number;
}

/**
 * Busca la primera muestra de la predicción en la que el auto puede llegar a la pelota y pegarle hacia el objetivo.
 * Combina golpes de piso, con salto, doble salto y aéreo según la dificultad.
 */
export function findShot(world: World, me: Car, pred: BallPredictor, p: BotParams, opts: SearchOpts): ShotPlan | null {
  const reach = reachCurve(Math.max(0, me.speed()), me.boost, p, me.unlimitedBoost);
  const ownGoal = ownGoalPos(me.team);
  const tick0 = world.tick;
  let aerialCandidate: ShotPlan | null = null;
  for (let i = 1; i < pred.slices.length; i++) {
    const s = pred.slices[i];
    if (opts.minT && s.t < opts.minT) continue;
    if (Math.abs(s.pos.y) > ARENA.Y + 50) break; // entraría al arco: ya no hay nada que hacer después
    const h = s.pos.z;
    let kind: HitKind;
    if (h < CAR_REACH_Z) kind = 'ground';
    else if (p.jumpShotMax > 0 && h < p.jumpShotMax) kind = 'jump';
    else if (p.doubleJumpMax > 0 && h < p.doubleJumpMax) kind = 'double';
    else if (opts.allowAerial && p.aerialMax > 0 && h < p.aerialMax && me.boost >= p.aerialMinBoost) kind = 'aerial';
    else continue;

    const dir = flat(opts.target.sub(s.pos));
    if (dir.len2() < 1) continue;
    dir.normIn();
    // Evitar mandarla contra el propio arco
    const toOwn = flat(ownGoal.sub(s.pos)).norm();
    if (dir.dot(toOwn) > 0.7) continue;

    if (kind === 'aerial') {
      if (aerialCandidate) continue;
      if (me.onGround && Aerial.feasible(me, s.pos, opts.target, s.t, me.boost, p.aerialSkill)) {
        aerialCandidate = { kind, t: s.t, tick: tick0 + Math.round(s.t * 120), ball: s.pos.clone(), target: opts.target, contact: s.pos.clone(), dir, eta: s.t };
      }
      continue;
    }

    const back = kind === 'ground' ? TUNING.contactDist : 60;
    const contact = new V3(s.pos.x - dir.x * back, s.pos.y - dir.y * back, CAR.REST_Z);
    const dist = flatDist(me.pos, contact);
    // Si estamos del lado equivocado de la pelota, hay que rodearla
    const rel = flat(me.pos.sub(s.pos));
    const ahead = rel.dot(dir);
    const detour = ahead > -100 ? (ahead + 300) * 1.4 : 0;
    const ang = localAngle(me, contact);
    let eta = turnTime(me, ang, p) + timeToCover(reach, dist + detour);
    if (kind === 'jump') eta = Math.max(eta, riseTime(JUMP_Z, h - CAR_REACH_Z + 20));
    if (kind === 'double') eta = Math.max(eta, riseTime(DOUBLE_JUMP_Z, h - CAR_REACH_Z + 20));
    if (!me.onGround) eta += 0.35;
    if (eta + opts.margin <= s.t) {
      const plan: ShotPlan = { kind, t: s.t, tick: tick0 + Math.round(s.t * 120), ball: s.pos.clone(), target: opts.target, contact, dir, eta };
      // Si un aéreo llega bastante antes, preferirlo
      if (aerialCandidate && aerialCandidate.t + 0.45 < plan.t) return aerialCandidate;
      return plan;
    }
  }
  return aerialCandidate;
}

// ---------------------------------------------------------------------------
// Posiciones
// ---------------------------------------------------------------------------

/** Posición del 2.º hombre: detrás de la pelota, hacia el centro, mirando el juego. */
export function supportPosition(world: World, me: Car): V3 {
  const s = attackSign(me.team);
  const b = world.ball.pos;
  const y = clamp(b.y - s * TUNING.supportDepth, -ARENA.Y + 900, ARENA.Y - 1400);
  const x = clamp(b.x * 0.35, -2600, 2600);
  return new V3(x, y, 0);
}

/** Posición del último hombre: entre la pelota y el centro del arco propio. */
export function lastManPosition(world: World, me: Car): V3 {
  const goal = ownGoalPos(me.team);
  const b = world.ball.pos;
  const d = flat(b.sub(goal));
  const L = d.len();
  const k = clamp(L * 0.28, TUNING.lastManMin, TUNING.lastManMax);
  const dir = L > 1 ? d.scale(1 / L) : new V3(0, attackSign(me.team), 0);
  return new V3(clamp(goal.x + dir.x * k, -800, 800), goal.y + dir.y * k, 0);
}

/** Palo lejano (respecto de la pelota) para volver al arco rotando por afuera. */
export function farPost(world: World, me: Car): V3 {
  const s = attackSign(me.team);
  const side = -(Math.sign(world.ball.pos.x) || 1);
  return new V3(side * 850, -s * (ARENA.Y - 350), 0);
}

/** Punto para tapar el arco cuando la pelota está por entrar. */
export function goalLineBlock(world: World, me: Car, pred: BallPredictor): V3 {
  const s = attackSign(me.team);
  const t = pred.goalTime[me.team];
  let x = clamp(world.ball.pos.x * 0.3, -700, 700);
  if (Number.isFinite(t)) {
    const sl = pred.at(Math.max(0.05, t - 0.1));
    x = clamp(sl.pos.x, -700, 700);
  }
  return new V3(x, -s * (ARENA.Y - 120), 0);
}

// ---------------------------------------------------------------------------
// Turbo
// ---------------------------------------------------------------------------

/** Si conviene, devuelve un pad para pasar en el camino hacia `dest`. */
export function boostDetour(world: World, me: Car, dest: V3, p: BotParams, wantBig: boolean): V3 | null {
  if (!p.boostManagement || me.boost >= 90) return null;
  const direct = flatDist(me.pos, dest);
  let best: V3 | null = null, bestCost = Infinity;
  for (const pad of world.pads) {
    if (!pad.active) continue;
    // El pad tiene que estar "adelante" en el camino
    const via = flatDist(me.pos, pad.pos) + flatDist(pad.pos, dest);
    const detour = via - direct;
    const limit = pad.big ? (wantBig ? TUNING.bigPadDetour : TUNING.bigPadDetour * 0.5) : TUNING.smallPadDetour;
    if (detour > limit) continue;
    if (flatDist(me.pos, pad.pos) < 120) continue;
    const value = pad.big ? 100 - me.boost : Math.min(12, 100 - me.boost);
    const cost = detour - value * (pad.big ? 18 : 10);
    if (cost < bestCost) { bestCost = cost; best = pad.pos; }
  }
  return best;
}

/** Pad grande más conveniente para recargar (cuando el turbo está muy bajo). */
export function nearestBigPad(world: World, me: Car, towards: V3): V3 | null {
  let best: V3 | null = null, bd = Infinity;
  const s = attackSign(me.team);
  for (const p of world.pads) {
    if (!p.big || !p.active) continue;
    // Preferir pads del lado propio (rotar por el turbo de atrás)
    const backBias = (p.pos.y * s > 1000 ? 1200 : 0);
    const d = flatDist(p.pos, me.pos) + flatDist(p.pos, towards) * 0.4 + backBias;
    if (d < bd) { bd = d; best = p.pos; }
  }
  return best;
}

export function sliceIsThreat(s: Slice, team: number): boolean {
  return Math.abs(s.pos.y) > ARENA.Y && Math.sign(s.pos.y) === -attackSign(team);
}
