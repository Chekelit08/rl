// Física de la pelota: gravedad, drag, rebote con fricción y spin, límites.

import { arenaDistance, arenaNormal } from './arena.ts';
import { BALL, GRAVITY } from './constants.ts';
import { Quat, V3 } from './math.ts';

export class Ball {
  pos = new V3(0, 0, BALL.REST_Z);
  vel = new V3();
  ang = new V3();
  q = new Quat();
  frozen = false;
  hidden = false;

  reset(x = 0, y = 0, z = BALL.REST_Z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    this.frozen = false;
    this.hidden = false;
  }

  clone() {
    const b = new Ball();
    b.pos = this.pos.clone();
    b.vel = this.vel.clone();
    b.ang = this.ang.clone();
    b.q = this.q.clone();
    return b;
  }
}

const INV_MASS = 1 / BALL.MASS;
const INERTIA = 0.4 * BALL.MASS * BALL.RADIUS * BALL.RADIUS;

/** Avanza la pelota un tick. Devuelve la velocidad normal del impacto contra la arena (0 si no hubo). */
export function stepBall(b: Ball, dt: number): number {
  if (b.frozen) return 0;
  b.vel.z += GRAVITY * dt;
  b.vel.scaleIn(1 - BALL.DRAG * dt);
  b.vel.clampLenIn(BALL.MAX_SPEED);
  b.pos.addScaledIn(b.vel, dt);
  b.q.integrateIn(b.ang, dt);
  return collideBallArena(b);
}

export function collideBallArena(b: Ball): number {
  const R = BALL.RADIUS;
  const d = arenaDistance(b.pos.x, b.pos.y, b.pos.z);
  if (d >= R) return 0;
  const n = arenaNormal(b.pos.x, b.pos.y, b.pos.z);
  b.pos.addScaledIn(n, R - d);
  const r = n.scale(-R);
  const vp = b.vel.add(b.ang.cross(r));
  const vn = vp.dot(n);
  if (vn >= 0) return 0;
  const e = vn > -25 ? 0 : BALL.RESTITUTION;
  const jn = (-(1 + e) * vn) / INV_MASS;
  b.vel.addScaledIn(n, jn * INV_MASS);
  const vt = vp.sub(n.scale(vn));
  const vtl = vt.len();
  if (vtl > 1e-3) {
    const t = vt.scale(1 / vtl);
    const kt = INV_MASS + (R * R) / INERTIA;
    const jt = Math.min(vtl / kt, BALL.FRICTION * jn);
    b.vel.addScaledIn(t, -jt * INV_MASS);
    // torque = r × (−t·jt)
    b.ang.addIn(r.cross(t.scale(-jt)).scale(1 / INERTIA));
  }
  b.ang.clampLenIn(BALL.MAX_ANG);
  return -vn;
}

export const BALL_INV_MASS = INV_MASS;
export const BALL_INERTIA = INERTIA;
