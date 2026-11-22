// Bots: usan exactamente la misma API de input que un jugador humano (CarInput).
// Roles en equipo (atacante / apoyo / arquero), predicción de pelota, kickoff con flip,
// dodges al llegar a la pelota, saltos a pelotas altas, aéreos simples (Leyenda) y recuperación en el aire.

import { Ball, stepBall } from '../sim/ball.ts';
import { Car, type CarInput, emptyInput } from '../sim/car.ts';
import { ARENA, BALL, DT } from '../sim/constants.ts';
import { clamp, Quat, V3 } from '../sim/math.ts';
import type { World } from '../sim/world.ts';

export type Difficulty = 0 | 1 | 2;
export const DIFFICULTY_NAMES = ['Novato', 'Profesional', 'Leyenda'];

interface Slice { t: number; pos: V3; vel: V3 }

/** Predicción de la pelota compartida por todos los bots (se recalcula cada pocos ticks). */
export class BallPredictor {
  slices: Slice[] = [];
  private lastTick = -100;
  update(world: World) {
    if (world.tick - this.lastTick < 4 && this.slices.length) return;
    this.lastTick = world.tick;
    const b: Ball = world.ball.clone();
    this.slices = [];
    const step = 4; // cada 4 ticks (1/30 s)
    for (let i = 1; i <= 120 * 4; i++) {
      if (!world.ball.frozen) stepBall(b, DT);
      if (i % step === 0) this.slices.push({ t: i * DT, pos: b.pos.clone(), vel: b.vel.clone() });
    }
  }
}

type DodgeStage = 'none' | 'jump' | 'wait' | 'flip' | 'air';

export class Bot {
  car: Car;
  diff: Difficulty;
  private dodge: DodgeStage = 'none';
  private dodgeTimer = 0;
  private dodgeDir = new V3();
  private aerial = false;
  private aerialTimer = 0;
  private aerialTarget = new V3();
  private reactTimer = 0;
  private cachedTarget = new V3();
  private kickoffFlipDone = false;

  constructor(car: Car, diff: Difficulty) {
    this.car = car;
    this.diff = diff;
  }

  think(world: World, pred: BallPredictor, dt: number): CarInput {
    const c = this.car;
    const inp = emptyInput();
    if (c.demoed) return inp;

    const ball = world.ball;
    const attackDir = c.team === 0 ? 1 : -1; // hacia dónde ataca (+Y azul)
    const ownGoal = new V3(0, -attackDir * ARENA.Y, 0);
    const oppGoal = new V3(0, attackDir * (ARENA.Y + 200), 200);

    // Acciones en curso
    if (this.dodge !== 'none') return this.continueDodge(inp, dt);
    if (this.aerial) return this.continueAerial(inp, world, dt);

    // En el aire (sin acción): recuperación
    if (!c.onGround) {
      this.recover(inp);
      inp.throttle = 1;
      return inp;
    }

    // Kickoff
    if (world.phase === 'countdown' || (ball.pos.x === 0 && ball.pos.y === 0 && ball.vel.len2() < 1)) {
      return this.kickoff(inp, world);
    }
    this.kickoffFlipDone = false;

    // Rol
    const role = this.role(world, pred);
    let target: V3;
    let arriveTime = 0;
    let wantBoost = this.diff > 0;
    let goingForBall = false;

    if (role === 'attack') {
      const intercept = this.findIntercept(pred, oppGoal, attackDir);
      target = intercept.target;
      arriveTime = intercept.t;
      goingForBall = true;
      // Si la pelota va a nuestro arco y estamos del lado equivocado, volver
      const threat = pred.slices.find((s) => Math.abs(s.pos.y) > ARENA.Y && Math.sign(s.pos.y) === -attackDir && s.t < 2.5);
      const wrongSide = (c.pos.y - ball.pos.y) * attackDir > 400;
      if (threat && wrongSide) {
        target = new V3(clamp(ball.pos.x * 0.3, -700, 700), ownGoal.y + attackDir * 200, 0);
        goingForBall = false;
        wantBoost = true;
      }
    } else if (role === 'support') {
      target = new V3(ball.pos.x * 0.4, ball.pos.y - attackDir * 2600, 0);
      target.y = clamp(target.y, -ARENA.Y + 600, ARENA.Y - 600);
      wantBoost = this.diff > 0 && c.boost < 30;
      // Ir a buscar turbo si hace falta
      if (c.boost < 30) target = this.nearestBigPad(world, target) ?? target;
    } else {
      // Arquero
      target = new V3(clamp(ball.pos.x * 0.25, -500, 500), ownGoal.y + attackDir * 350, 0);
      wantBoost = false;
    }

    // Reacción (Novato reacciona tarde)
    const reaction = [0.5, 0.12, 0.04][this.diff];
    this.reactTimer -= dt;
    if (this.reactTimer <= 0) { this.cachedTarget = target; this.reactTimer = reaction; }
    else target = this.cachedTarget;

    this.driveTo(inp, target, wantBoost, arriveTime);

    // Golpe: dodge hacia la pelota cuando estamos cerca y alineados
    const toBall = ball.pos.sub(c.pos);
    const dist = toBall.len();
    const local = c.q.unrotate(toBall);
    const ang = Math.atan2(-local.y, local.x);
    if (goingForBall && this.diff > 0) {
      const closing = c.vel.sub(ball.vel).dot(toBall.norm());
      const tHit = dist / Math.max(closing, 1);
      if (ball.pos.z < 160 && dist < 330 && Math.abs(ang) < 0.5 && tHit < 0.3 && c.speed() > 600) {
        this.startDodge(local);
      } else if (ball.pos.z > 200 && ball.pos.z < 420 && Math.hypot(toBall.x, toBall.y) < 250 && Math.abs(ang) < 0.6) {
        // Pelota a media altura: salto para pegarle
        this.dodge = 'jump';
        this.dodgeTimer = 0;
        this.dodgeDir = new V3(0, 0, 0);
      } else if (this.diff === 2 && ball.pos.z > 450 && c.boost > 35 && this.canAerial(pred)) {
        this.aerial = true;
        this.aerialTimer = 0;
      }
    }
    return inp;
  }

  private role(world: World, pred: BallPredictor): 'attack' | 'support' | 'goalie' {
    const mates = world.cars.filter((o) => o.team === this.car.team && !o.demoed);
    if (mates.length <= 1) return 'attack';
    const ball = world.ball.pos;
    const attackDir = this.car.team === 0 ? 1 : -1;
    const score = (o: Car) => {
      const d = o.pos.dist(ball);
      const behind = (ball.y - o.pos.y) * attackDir > 0 ? 0 : 1200; // penaliza estar delante de la pelota
      return d + behind - o.speed() * 0.3;
    };
    const sorted = [...mates].sort((a, b) => score(a) - score(b));
    const idx = sorted.indexOf(this.car);
    void pred;
    if (idx === 0) return 'attack';
    if (idx === sorted.length - 1 && sorted.length >= 3) return 'goalie';
    return sorted.length === 2 ? 'support' : 'support';
  }

  private findIntercept(pred: BallPredictor, goal: V3, attackDir: number) {
    const c = this.car;
    const speed = Math.max(c.speed(), 900);
    const maxSpeed = this.diff > 0 && c.boost > 20 ? 2100 : 1400;
    for (const s of pred.slices) {
      if (s.pos.z > (this.diff > 0 ? 260 : 160)) continue;
      // Novato no apunta al arco: empuja la pelota en la dirección en que viene
      const aim = this.diff === 0 ? s.pos.sub(c.pos) : goal.sub(s.pos);
      aim.z = 0;
      aim.normIn();
      const approach = s.pos.sub(aim.scale(BALL.RADIUS + 70));
      approach.z = 0;
      const d = approach.sub(c.pos);
      d.z = 0;
      const local = c.q.unrotate(d);
      const turn = Math.abs(Math.atan2(local.y, local.x));
      const eta = d.len() / ((speed + maxSpeed) / 2) + turn * 0.35;
      if (eta <= s.t) {
        return { target: this.offsetIfWrongSide(approach, s.pos, aim, attackDir), t: s.t };
      }
    }
    const last = pred.slices[Math.min(pred.slices.length - 1, 45)] ?? { pos: new V3(), t: 1.5 };
    const aim = goal.sub(last.pos).normIn();
    return { target: this.offsetIfWrongSide(last.pos.sub(aim.scale(160)), last.pos, aim, attackDir), t: last.t };
  }

  /** Si estamos del lado del arco rival respecto de la pelota, rodearla en vez de empujarla hacia atrás. */
  private offsetIfWrongSide(approach: V3, ballPos: V3, aim: V3, attackDir: number) {
    const c = this.car;
    const rel = c.pos.sub(ballPos);
    if (rel.dot(aim) > 50) {
      const side = Math.sign(rel.x || 1);
      return new V3(ballPos.x + side * 450, ballPos.y - attackDir * 700, 0);
    }
    approach.z = 0;
    return approach;
  }

  private nearestBigPad(world: World, near: V3) {
    let best: V3 | null = null;
    let bd = Infinity;
    for (const p of world.pads) {
      if (!p.big || !p.active) continue;
      const d = p.pos.dist(this.car.pos) + p.pos.dist(near) * 0.5;
      if (d < bd) { bd = d; best = p.pos; }
    }
    return best && bd < 4000 ? best : null;
  }

  private driveTo(inp: CarInput, target: V3, wantBoost: boolean, arriveTime: number) {
    const c = this.car;
    const d = target.sub(c.pos);
    const local = c.q.unrotate(d);
    const ang = Math.atan2(-local.y, local.x); // + = a la derecha
    const dist = Math.hypot(local.x, local.y);
    const sharp = [2.2, 3.2, 3.8][this.diff];
    inp.steer = clamp(ang * sharp, -1, 1);
    inp.throttle = this.diff === 0 ? 0.72 : 1;
    if (Math.abs(ang) > 1.7 && c.speed() > 500 && this.diff > 0) inp.handbrake = true;
    if (Math.abs(ang) > 2.6 && dist < 500) inp.throttle = -1; // muy atrás y cerca: reversa
    // Llegar a tiempo, no antes (sólo Profesional+)
    if (arriveTime > 0 && this.diff > 0) {
      const eta = dist / Math.max(c.speed(), 300);
      if (eta < arriveTime * 0.6 && dist > 800) { inp.throttle = 0.3; wantBoost = false; }
    }
    inp.boost = wantBoost && Math.abs(ang) < 0.3 && dist > 900 && c.speed() < 2250;
  }

  private kickoff(inp: CarInput, world: World) {
    const c = this.car;
    const ball = world.ball.pos;
    const toBall = ball.sub(c.pos);
    const local = c.q.unrotate(toBall);
    const ang = Math.atan2(-local.y, local.x);
    // Apuntar levemente descentrado para que el toque salga hacia adelante
    inp.steer = clamp(ang * 4, -1, 1);
    inp.throttle = 1;
    inp.boost = this.diff > 0 || toBall.len() > 2500;
    if (this.diff > 0 && !this.kickoffFlipDone && toBall.len() < 750 && world.phase === 'playing') {
      this.kickoffFlipDone = true;
      this.startDodge(local);
      return this.continueDodge(inp, DT);
    }
    return inp;
  }

  private startDodge(localToBall: V3) {
    this.dodge = 'jump';
    this.dodgeTimer = 0;
    this.dodgeDir = new V3(localToBall.x, localToBall.y, 0).normIn();
    if (this.dodgeDir.len2() < 0.5) this.dodgeDir = new V3(1, 0, 0);
  }

  private continueDodge(inp: CarInput, dt: number) {
    const c = this.car;
    this.dodgeTimer += dt;
    inp.throttle = 1;
    if (this.dodge === 'jump') {
      inp.jump = true;
      if (this.dodgeTimer > 0.08) { this.dodge = this.dodgeDir.len2() > 0 ? 'wait' : 'air'; this.dodgeTimer = 0; }
    } else if (this.dodge === 'wait') {
      inp.jump = false;
      if (this.dodgeTimer > 0.03) { this.dodge = 'flip'; this.dodgeTimer = 0; }
    } else if (this.dodge === 'flip') {
      inp.jump = true;
      inp.pitch = -this.dodgeDir.x;
      inp.yaw = -this.dodgeDir.y; // local +Y = izquierda → yaw derecha es -Y
      this.dodge = 'air';
      this.dodgeTimer = 0;
    } else {
      // Esperar a aterrizar; recuperar orientación después del flip
      if (c.flipTime > 0.7 || (!c.hasFlipped && this.dodgeTimer > 0.4)) this.recover(inp);
      if (c.onGround || this.dodgeTimer > 2.5) { this.dodge = 'none'; }
    }
    return inp;
  }

  private canAerial(pred: BallPredictor) {
    const c = this.car;
    for (const s of pred.slices) {
      if (s.t > 2.2) break;
      if (s.pos.z < 400 || s.pos.z > 1800) continue;
      const d = s.pos.sub(c.pos);
      const horiz = Math.hypot(d.x, d.y);
      // Tiempo aproximado de subida con turbo
      const tNeed = 0.35 + Math.sqrt((2 * d.z) / 700) * 0.9 + horiz / 1800;
      if (Math.abs(tNeed - s.t) < 0.25) {
        const fwd = c.forward();
        const dirH = new V3(d.x, d.y, 0).normIn();
        if (fwd.dot(dirH) > 0.85) { this.aerialTarget = s.pos.clone(); return true; }
      }
    }
    return false;
  }

  private continueAerial(inp: CarInput, world: World, dt: number) {
    const c = this.car;
    this.aerialTimer += dt;
    const t = this.aerialTimer;
    if (t < 0.18) { inp.jump = true; inp.boost = t > 0.05; return inp; }
    if (t < 0.2) { inp.jump = false; inp.boost = true; return inp; }
    if (t < 0.22) { inp.jump = true; inp.boost = true; return inp; } // segundo salto (fast aerial)
    // Apuntar al objetivo y turbo
    const target = world.ball.pos.lerp(this.aerialTarget, 0.5);
    const dir = target.sub(c.pos).normIn();
    this.orient(inp, dir, new V3(0, 0, 1));
    inp.boost = c.forward().dot(dir) > 0.8;
    if (c.onGround && t > 0.4) this.aerial = false;
    if (t > 2.6 || world.ball.pos.dist(c.pos) < 140) { this.aerial = false; }
    return inp;
  }

  /** Recuperación: ruedas hacia abajo y nariz hacia donde vamos. */
  private recover(inp: CarInput) {
    const c = this.car;
    let fwd = new V3(c.vel.x, c.vel.y, 0);
    if (fwd.len2() < 100 * 100) fwd = new V3(c.forward().x, c.forward().y, 0);
    this.orient(inp, fwd.normIn(), new V3(0, 0, 1));
  }

  /** Control PD para orientar el auto (forward deseado, up deseado). */
  private orient(inp: CarInput, fwd: V3, upHint: V3) {
    const c = this.car;
    const left = upHint.cross(fwd).normIn();
    if (left.len2() < 0.5) return;
    const up = fwd.cross(left);
    // Matriz → quaternion objetivo
    const target = quatFromBasis(fwd, left, up);
    const err = target.mul(c.q.conj());
    if (err.w < 0) { err.x = -err.x; err.y = -err.y; err.z = -err.z; err.w = -err.w; }
    const angle = 2 * Math.acos(clamp(err.w, -1, 1));
    const s = Math.sqrt(Math.max(1 - err.w * err.w, 1e-9));
    const axisW = new V3(err.x / s, err.y / s, err.z / s).scale(angle);
    const eLocal = c.q.unrotate(axisW);
    const wLocal = c.q.unrotate(c.ang);
    const kp = [3, 4.5, 5.5][this.diff], kd = [0.6, 0.8, 0.9][this.diff];
    const desired = eLocal.scale(kp).sub(wLocal.scale(kd));
    inp.roll = clamp(desired.x * 0.7, -1, 1);
    inp.pitch = clamp(-desired.y, -1, 1);
    inp.yaw = clamp(-desired.z, -1, 1);
  }
}

function quatFromBasis(f: V3, l: V3, u: V3): Quat {
  // Columnas: f, l, u
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
