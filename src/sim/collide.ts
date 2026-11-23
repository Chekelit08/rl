// Colisiones auto↔pelota (con el impulso extra que da "feel" a los golpes) y auto↔auto (bump / demolición).

import { Ball, ballInertia, ballInvMass } from './ball.ts';
import { RULES } from './rules.ts';
import { Car } from './car.ts';
import {
  BALL, BALL_HIT_EXTRA_CURVE, BUMP_AIR_CURVE, BUMP_GROUND_CURVE, BUMP_UP_CURVE, CAR,
} from './constants.ts';
import { curve, V3 } from './math.ts';

export interface BallHit {
  carId: number;
  impulse: number; // cambio de velocidad de la pelota (uu/s)
  point: V3;
  flipReset: boolean;
}

/** Devuelve info del golpe si hubo contacto. */
export function collideCarBall(c: Car, b: Ball, tick: number): BallHit | null {
  if (c.demoed || b.frozen) return null;
  const R = BALL.RADIUS;
  const center = c.hitboxCenter();
  const rel = b.pos.sub(center);
  if (rel.len2() > (R + 100) * (R + 100)) return null;

  const local = c.q.unrotate(rel);
  const h = c.half;
  const cl = new V3(
    Math.max(-h.x, Math.min(h.x, local.x)),
    Math.max(-h.y, Math.min(h.y, local.y)),
    Math.max(-h.z, Math.min(h.z, local.z)),
  );
  let diff = local.sub(cl);
  let dist = diff.len();
  if (dist >= R) return null;

  let nLocal: V3;
  if (dist < 1e-6) {
    // Centro de la pelota dentro del hitbox: salir por la cara más cercana
    const px = h.x - Math.abs(local.x), py = h.y - Math.abs(local.y), pz = h.z - Math.abs(local.z);
    if (px < py && px < pz) nLocal = new V3(Math.sign(local.x) || 1, 0, 0);
    else if (py < pz) nLocal = new V3(0, Math.sign(local.y) || 1, 0);
    else nLocal = new V3(0, 0, Math.sign(local.z) || 1);
    dist = -Math.min(px, py, pz);
    diff = nLocal.clone();
  } else {
    nLocal = diff.scale(1 / dist);
  }
  const n = c.q.rotate(nLocal);
  const contact = center.add(c.q.rotate(cl));
  const pen = R - dist;

  // Flip reset: tocar la pelota con las ruedas (cara inferior del auto) en el aire devuelve el flip
  let flipReset = false;
  if (!c.onGround && nLocal.z < -0.75 && (c.hasFlipped || c.hasDoubleJumped || c.hasJumped)) {
    c.hasJumped = false;
    c.hasDoubleJumped = false;
    c.hasFlipped = false;
    c.isFlipping = false;
    c.airTimeSinceJump = 0;
    flipReset = true;
  }

  const BALL_INV_MASS = ballInvMass(), BALL_INERTIA = ballInertia();
  // Velocidades antes del impulso (para el impulso extra)
  const ballVel0 = b.vel.clone();
  const carVel0 = c.vel.clone();

  // Corrección de posición
  const carShare = c.onGround ? 0 : (BALL.MASS * RULES.ballMass) / (CAR.MASS + BALL.MASS * RULES.ballMass);
  b.pos.addScaledIn(n, pen * (1 - carShare));
  c.pos.addScaledIn(n, -pen * carShare);

  // Impulso físico (restitución 0, fricción 2.0)
  const mC = CAR.MASS;
  const rc = contact.sub(c.pos);
  const rb = n.scale(-R);
  const linearOnly = c.onGround;
  const vCarP = linearOnly ? c.vel.clone() : c.vel.add(c.ang.cross(rc));
  const vBallP = b.vel.add(b.ang.cross(rb));
  const vrel = vBallP.sub(vCarP);
  const vn = vrel.dot(n);
  let impulseMag = 0;
  if (vn < 0) {
    let kN = BALL_INV_MASS + 1 / mC;
    if (!linearOnly) kN += n.dot(c.applyInvInertia(rc.cross(n)).cross(rc));
    const jn = -vn / kN;
    b.vel.addScaledIn(n, jn * BALL_INV_MASS);
    c.vel.addScaledIn(n, -jn / mC);
    if (!linearOnly) c.ang.subIn(c.applyInvInertia(rc.cross(n.scale(jn))));
    impulseMag += jn * BALL_INV_MASS;

    const vt = vrel.sub(n.scale(vn));
    const vtl = vt.len();
    if (vtl > 1e-3) {
      const t = vt.scale(1 / vtl);
      let kT = BALL_INV_MASS + 1 / mC + (R * R) / BALL_INERTIA;
      if (!linearOnly) kT += t.dot(c.applyInvInertia(rc.cross(t)).cross(rc));
      const jt = Math.min(vtl / kT, 2.0 * jn);
      b.vel.addScaledIn(t, -jt * BALL_INV_MASS);
      b.ang.addIn(rb.cross(t.scale(-jt)).scale(1 / BALL_INERTIA));
      c.vel.addScaledIn(t, jt / mC);
      if (!linearOnly) c.ang.addIn(c.applyInvInertia(rc.cross(t.scale(jt))));
    }
  }

  // Impulso extra (máx. uno cada 2 ticks)
  if (tick > c.lastExtraHitTick + 1 || c.lastExtraHitTick > tick) {
    c.lastExtraHitTick = tick;
    const fwd = c.forward();
    const relPos = b.pos.sub(c.pos);
    const relVel = ballVel0.sub(carVel0);
    const relSpeed = Math.min(relVel.len(), 4600);
    if (relSpeed > 0) {
      let hitDir = new V3(relPos.x, relPos.y, relPos.z * 0.35).normIn();
      hitDir = hitDir.sub(fwd.scale(hitDir.dot(fwd) * (1 - 0.65))).normIn();
      const added = hitDir.scale(relSpeed * curve(BALL_HIT_EXTRA_CURVE, relSpeed));
      b.vel.addIn(added);
      impulseMag += added.len();
    }
  }

  b.vel.clampLenIn(RULES.ballMaxSpeed);
  b.ang.clampLenIn(BALL.MAX_ANG);
  return { carId: c.id, impulse: impulseMag, point: contact, flipReset };
}

// ---------- Auto ↔ auto (OBB vs OBB por SAT) ----------

function axes(c: Car) { return [c.q.forward(), c.q.left(), c.q.up()]; }

interface SatResult { depth: number; normal: V3 }

function obbOverlap(a: Car, b: Car): SatResult | null {
  const ca = a.hitboxCenter(), cb = b.hitboxCenter();
  const T = cb.sub(ca);
  const A = axes(a), B = axes(b);
  const ha = [a.half.x, a.half.y, a.half.z], hb = [b.half.x, b.half.y, b.half.z];
  const cand: V3[] = [...A, ...B];
  for (const u of A) for (const v of B) {
    const cr = u.cross(v);
    if (cr.len2() > 1e-6) cand.push(cr.normIn());
  }
  let best: SatResult | null = null;
  for (const L of cand) {
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++) { ra += Math.abs(ha[i] * A[i].dot(L)); rb += Math.abs(hb[i] * B[i].dot(L)); }
    const t = T.dot(L);
    const overlap = ra + rb - Math.abs(t);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) best = { depth: overlap, normal: t >= 0 ? L.clone() : L.neg() };
  }
  return best;
}

export interface CarCarEvent { type: 'bump' | 'demo'; attacker: number; victim: number; pos: V3 }

export function collideCars(a: Car, b: Car): CarCarEvent[] {
  const events: CarCarEvent[] = [];
  if (a.demoed || b.demoed) return events;
  if (a.pos.dist(b.pos) > 260) return events;
  const sat = obbOverlap(a, b);
  if (!sat) return events;
  const n = sat.normal; // de a hacia b
  a.pos.addScaledIn(n, -sat.depth / 2);
  b.pos.addScaledIn(n, sat.depth / 2);
  // Velocidades antes del choque: el bump y la demolición se deciden con estas, no con las que deja el impulso físico
  // (si no, un golpe de frente a un rival quieto nunca cuenta: el impulso ya le pasó la mitad de la velocidad).
  const va0 = a.vel.clone(), vb0 = b.vel.clone();
  const vn = b.vel.sub(a.vel).dot(n);
  if (vn < 0) {
    const j = (-(1 + 0.1) * vn) / 2;
    a.vel.addScaledIn(n, -j);
    b.vel.addScaledIn(n, j);
  }

  for (const [c1, c2] of [[a, b], [b, a]] as const) {
    if (c1.bumpCooldowns.has(c2.id)) continue;
    const v1 = c1 === a ? va0 : vb0, v2 = c1 === a ? vb0 : va0;
    const delta = c2.pos.sub(c1.pos);
    if (v1.dot(delta) <= 0) continue;
    const velDir = v1.norm();
    const dirTo = delta.norm();
    const towards = v1.dot(dirTo);
    const away = v2.dot(velDir);
    if (towards <= away) continue;
    // Punto de contacto aproximado: punto del hitbox de c1 más cercano al centro de c2
    const lc = c1.q.unrotate(c2.hitboxCenter().sub(c1.hitboxCenter()));
    const h = c1.half;
    const clx = Math.max(-h.x, Math.min(h.x, lc.x)) + c1.offset.x;
    if (clx <= CAR.BUMP_MIN_FORWARD) continue;

    const isDemo = RULES.demo !== 'off' && (c1.supersonic || RULES.demo === 'contact') && c1.team !== c2.team;
    if (isDemo) {
      c2.demoed = true;
      c2.respawnTimer = CAR.DEMO_RESPAWN;
      events.push({ type: 'demo', attacker: c1.id, victim: c2.id, pos: c2.pos.clone() });
    } else {
      const base = curve(c2.onGround ? BUMP_GROUND_CURVE : BUMP_AIR_CURVE, towards);
      const up = c2.onGround ? c2.up() : new V3(0, 0, 1);
      c2.vel.addScaledIn(velDir, base).addScaledIn(up, curve(BUMP_UP_CURVE, towards));
      c2.onGround = false;
      events.push({ type: 'bump', attacker: c1.id, victim: c2.id, pos: c2.pos.clone() });
    }
    c1.bumpCooldowns.set(c2.id, CAR.BUMP_COOLDOWN);
  }
  return events;
}
