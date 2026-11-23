// Maniobras: secuencias de inputs con estado (flip, remate con salto, aéreo rápido, speed flip, half-flip).
// Cada maniobra se ejecuta tick a tick hasta terminar; mientras dura, tiene prioridad sobre la estrategia.

import type { Car, CarInput } from '../sim/car.ts';
import { BALL, CAR, DT, GRAVITY } from '../sim/constants.ts';
import { clamp, V3 } from '../sim/math.ts';
import type { World } from '../sim/world.ts';
import { flat, forwardSpeed, hasFlip, orient, recover } from './control.ts';
import type { BotParams } from './params.ts';
import type { BallPredictor } from './prediction.ts';

export interface Ctx {
  car: Car;
  world: World;
  pred: BallPredictor;
  p: BotParams;
  dt: number;
}

export abstract class Maneuver {
  t = 0;
  done = false;
  /** Nombre para depuración y estadísticas. */
  abstract readonly kind: string;
  abstract step(ctx: Ctx, inp: CarInput): void;
}

/** Dirección local (x adelante, y izquierda) hacia un punto del mundo, aplanada al plano del auto. */
function localDir(car: Car, target: V3): V3 {
  const l = car.q.unrotate(target.sub(car.pos));
  const d = new V3(l.x, l.y, 0);
  return d.len2() > 1e-6 ? d.normIn() : new V3(1, 0, 0);
}

/** Aplica los inputs de un flip hacia una dirección local. */
function flipInputs(inp: CarInput, dir: V3) {
  inp.jump = true;
  inp.pitch = -dir.x;
  inp.yaw = -dir.y; // +Y local es izquierda; yaw a la derecha es positivo
  inp.roll = 0;
  // El flip necesita |pitch|+|yaw| ≥ 0,5
  if (Math.abs(inp.pitch) + Math.abs(inp.yaw) < 0.55) inp.pitch = -1;
}

// ---------------------------------------------------------------------------

/** Flip (dodge) hacia un punto: salto corto, pausa y flip. Si ya está en el aire, flipea directo. */
export class Dodge extends Maneuver {
  readonly kind = 'dodge';
  private stage: 'jump' | 'gap' | 'flip' | 'air' = 'jump';
  private stageT = 0;
  target: V3 | null;
  hold: number;
  gap: number;
  boost: boolean;
  constructor(target: V3 | null, hold = 0.05, gap = 2 / 120, boost = false) {
    super();
    this.target = target; this.hold = hold; this.gap = gap; this.boost = boost;
  }

  step(ctx: Ctx, inp: CarInput) {
    const c = ctx.car;
    this.t += ctx.dt;
    this.stageT += ctx.dt;
    inp.throttle = 1;
    inp.boost = this.boost && c.boost > 0;
    if (this.t === ctx.dt && !c.onGround) this.stage = hasFlip(c) ? 'flip' : 'air';
    switch (this.stage) {
      case 'jump':
        inp.jump = true;
        if (this.stageT >= this.hold) { this.stage = 'gap'; this.stageT = 0; }
        break;
      case 'gap':
        inp.jump = false;
        if (this.stageT >= this.gap) { this.stage = 'flip'; this.stageT = 0; }
        break;
      case 'flip': {
        const dir = this.target ? localDir(c, this.target) : new V3(1, 0, 0);
        flipInputs(inp, dir);
        this.stage = 'air';
        this.stageT = 0;
        break;
      }
      case 'air':
        inp.jump = false;
        if (!c.isFlipping || c.flipTime > 0.55) recover(c, inp, ctx.p);
        if ((c.onGround && this.stageT > 0.05) || this.t > 2.5) this.done = true;
        break;
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Remate con salto (simple o doble) para pelotas a media altura.
 * Arranca en el piso; salta, opcionalmente hace doble salto y flipea hacia la pelota en el contacto.
 */
export class JumpShot extends Maneuver {
  readonly kind = 'jumpshot';
  private doubled = false;
  private flipped = false;
  private releaseTick = -1;
  hitTick: number;
  double: boolean;
  flipAtHit: boolean;
  shotTarget: V3;
  constructor(hitTick: number, double: boolean, flipAtHit: boolean, shotTarget: V3) {
    super();
    this.hitTick = hitTick; this.double = double; this.flipAtHit = flipAtHit; this.shotTarget = shotTarget;
  }

  step(ctx: Ctx, inp: CarInput) {
    const c = ctx.car, w = ctx.world;
    this.t += ctx.dt;
    const T = (this.hitTick - w.tick) * DT;
    inp.throttle = 1;
    const ball = w.ball.pos;
    if (this.t <= CAR.JUMP_MAX_TIME) {
      inp.jump = true;
      return;
    }
    // Doble salto: soltar un tick y volver a apretar sin dirección
    if (this.double && !this.doubled) {
      if (this.releaseTick < 0) { this.releaseTick = w.tick; inp.jump = false; return; }
      inp.jump = true; inp.pitch = 0; inp.yaw = 0; inp.roll = 0;
      this.doubled = true;
      return;
    }
    // Apuntar la nariz hacia la pelota mientras sube
    const toBall = ball.sub(c.pos);
    if (!this.flipped) {
      orient(c, inp, toBall.norm(), new V3(0, 0, 1), ctx.p.airKp, ctx.p.airKd);
      // Flip de remate justo antes del contacto (si queda flip)
      const near = toBall.len() < 200 + BALL.RADIUS;
      if (this.flipAtHit && hasFlip(c) && (T < 0.07 || near) && T > -0.2) {
        const aim = ball.add(this.shotTarget.sub(ball).norm().scale(300));
        flipInputs(inp, localDir(c, aim));
        this.flipped = true;
        return;
      }
    } else {
      inp.jump = false;
      if (!c.isFlipping) recover(c, inp, ctx.p);
    }
    if (T < -0.35) recover(c, inp, ctx.p);
    if ((c.onGround && this.t > 0.3) || this.t > 3) this.done = true;
  }
}

// ---------------------------------------------------------------------------

/** Aéreo rápido con guía por aceleración requerida (recalcula el objetivo con la predicción). */
export class Aerial extends Maneuver {
  readonly kind = 'aerial';
  private launched = 0; // 0 salto, 1 soltar, 2 doble salto hecho
  private flipped = false;
  aborted = false;
  hitTick: number;
  shotTarget: V3;
  startTick: number;
  constructor(hitTick: number, shotTarget: V3, startTick: number) {
    super();
    this.hitTick = hitTick; this.shotTarget = shotTarget; this.startTick = startTick;
  }

  /** Aceleración necesaria para estar en P dentro de T segundos (descontando la gravedad). */
  static required(car: Car, P: V3, T: number): V3 {
    const a = P.sub(car.pos).sub(car.vel.scale(T)).scale(2 / (T * T));
    a.z -= GRAVITY;
    return a;
  }

  /** Punto que el auto tiene que ocupar para pegarle a la pelota hacia shotTarget. */
  static contactPoint(ballPos: V3, shotTarget: V3): V3 {
    const d = shotTarget.sub(ballPos).norm();
    return ballPos.sub(d.scale(BALL.RADIUS + 45));
  }

  step(ctx: Ctx, inp: CarInput) {
    const c = ctx.car, w = ctx.world, p = ctx.p;
    this.t += ctx.dt;
    inp.throttle = 1;
    // Despegue: salto mantenido + turbo + nariz arriba; luego doble salto
    if (this.launched === 0) {
      inp.jump = true;
      inp.boost = this.t > 0.04;
      inp.pitch = c.forward().z < 0.75 ? 1 : 0;
      if (this.t >= CAR.JUMP_MAX_TIME) this.launched = 1;
      return;
    }
    if (this.launched === 1) {
      inp.jump = false; inp.boost = true;
      this.launched = 2;
      return;
    }
    if (this.launched === 2) {
      inp.jump = true; inp.boost = true; inp.pitch = 0; inp.yaw = 0; inp.roll = 0;
      this.launched = 3;
      return;
    }

    let T = (this.hitTick - w.tick) * DT;
    // Re-elegir el instante de contacto cada pocos ticks (la pelota pudo cambiar de trayectoria)
    if ((w.tick - this.startTick) % 6 === 0) this.retarget(ctx, T);
    T = (this.hitTick - w.tick) * DT;
    const ballP = T > 0.02 ? ctx.pred.at(T).pos : w.ball.pos;
    const P = Aerial.contactPoint(ballP, this.shotTarget);
    const Tg = Math.max(T, 0.04);
    const a = Aerial.required(c, P, Tg);
    const mag = a.len();
    const dir = mag > 1 ? a.scale(1 / mag) : c.forward();
    const toBall = w.ball.pos.sub(c.pos);
    const fwdTarget = mag > 220 ? dir : toBall.norm();
    const err = orient(c, inp, fwdTarget, new V3(0, 0, 1), p.airKp * (0.75 + 0.25 * p.aerialSkill), p.airKd);
    const alignedNeed = 0.92 - 0.12 * p.aerialSkill;
    inp.boost = c.boost > 0 && c.forward().dot(dir) > alignedNeed && mag > 200 && err < 0.9;
    // Flip final hacia la pelota (más potencia), sólo Leyenda
    if (!this.flipped && p.aerialSkill >= 1 && hasFlip(c) && toBall.len() < BALL.RADIUS + 140 && T < 0.1) {
      const aim = w.ball.pos.add(this.shotTarget.sub(w.ball.pos).norm().scale(300));
      const l = c.q.unrotate(aim.sub(c.pos));
      const d = new V3(l.x, l.y, 0);
      if (d.len2() > 1e-6) { flipInputs(inp, d.normIn()); this.flipped = true; inp.boost = false; }
    }
    if (T < -0.25 || (c.onGround && this.t > 0.6) || this.t > 4) { this.done = true; return; }
    // Si es imposible llegar, abortar (la estrategia recupera)
    if (mag > CAR.BOOST_AIR * 1.6 && T < 0.6 && this.t > 0.5) { this.aborted = true; this.done = true; }
  }

  private retarget(ctx: Ctx, T: number) {
    let best = this.hitTick, bestMag = Infinity;
    const c = ctx.car;
    for (let dT = -0.4; dT <= 0.4; dT += 1 / 30) {
      const tt = T + dT;
      if (tt < 0.08 || tt > 3.5) continue;
      const ballP = ctx.pred.at(tt).pos;
      const m = Aerial.required(c, Aerial.contactPoint(ballP, this.shotTarget), tt).len();
      const cost = m + Math.abs(dT) * 120;
      if (cost < bestMag) { bestMag = cost; best = ctx.world.tick + Math.round(tt / DT); }
    }
    this.hitTick = best;
  }

  /**
   * ¿Es factible un aéreo para pegarle a la pelota en el instante T (desde el piso)?
   * Modela el despegue rápido (salto + doble salto) y exige que la aceleración requerida sea alcanzable con turbo.
   */
  static feasible(car: Car, ballPos: V3, shotTarget: V3, T: number, boost: number, skill: number): boolean {
    const launchT = 0.3;
    if (T < launchT + 0.25) return false;
    const up = car.up();
    // Estado aproximado al final del despegue
    const vz = (CAR.JUMP_IMPULSE * 2 + CAR.JUMP_ACCEL * CAR.JUMP_MAX_TIME) + GRAVITY * launchT;
    const v1 = car.vel.add(up.scale(vz));
    const p1 = car.pos.add(car.vel.scale(launchT)).add(up.scale(100));
    const rem = T - launchT;
    const P = Aerial.contactPoint(ballPos, shotTarget);
    const a = P.sub(p1).sub(v1.scale(rem)).scale(2 / (rem * rem));
    a.z -= GRAVITY;
    const mag = a.len();
    const maxA = CAR.BOOST_AIR * (0.62 + 0.25 * skill);
    if (mag > maxA) return false;
    // Turbo necesario (fracción del tiempo con turbo ≈ mag / BOOST_AIR) + giro inicial
    const need = (rem * (mag / CAR.BOOST_AIR) + launchT) * CAR.BOOST_PER_SEC + 6;
    if (need > boost) return false;
    // La dirección de aceleración no puede apuntar hacia abajo ni muy atrás del auto
    const dirH = flat(a).norm();
    const fH = flat(car.forward()).norm();
    if (a.z < 0) return false;
    return dirH.dot(fH) > -0.2 || flat(a).len() < 300;
  }
}

// ---------------------------------------------------------------------------

/** Speed flip de kickoff: flip diagonal cancelado con air roll para llegar más rápido. */
export class SpeedFlip extends Maneuver {
  readonly kind = 'speedflip';
  private stage: 'drive' | 'jump' | 'gap' | 'flip' | 'cancel' = 'drive';
  private stageT = 0;
  static readonly cfg = { driveT: 0.18, hold: 0.06, gap: 1 / 120, side: 0.4, steer: 0.18, rollGain: 1 };
  side: 1 | -1;
  target: V3;
  constructor(side: 1 | -1, target: V3) {
    super();
    this.side = side; this.target = target;
  }

  step(ctx: Ctx, inp: CarInput) {
    const c = ctx.car;
    const k = SpeedFlip.cfg;
    this.t += ctx.dt;
    this.stageT += ctx.dt;
    inp.throttle = 1;
    inp.boost = c.boost > 0;
    switch (this.stage) {
      case 'drive': {
        const l = c.q.unrotate(this.target.sub(c.pos));
        const ang = Math.atan2(-l.y, l.x);
        inp.steer = clamp(ang * 4 - this.side * k.steer, -1, 1);
        if (this.stageT >= k.driveT) { this.stage = 'jump'; this.stageT = 0; }
        break;
      }
      case 'jump':
        inp.jump = true;
        if (this.stageT >= k.hold) { this.stage = 'gap'; this.stageT = 0; }
        break;
      case 'gap':
        inp.jump = false;
        if (this.stageT >= k.gap) { this.stage = 'flip'; this.stageT = 0; }
        break;
      case 'flip':
        inp.jump = true;
        inp.pitch = -1;
        inp.yaw = this.side * k.side;
        this.stage = 'cancel';
        this.stageT = 0;
        break;
      case 'cancel': {
        inp.jump = false;
        // Cancelar el pitch del flip y contrarrestar el giro con air roll
        if (c.isFlipping) {
          inp.pitch = 1;
          const wl = c.q.unrotate(c.ang);
          inp.roll = clamp(-wl.x * k.rollGain, -1, 1);
          inp.yaw = 0;
        } else {
          recover(c, inp, ctx.p, this.target);
          inp.boost = c.boost > 0 && c.forward().z > -0.2;
        }
        if ((c.onGround && this.stageT > 0.05) || this.t > 2) this.done = true;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------

/** Half-flip: media vuelta rápida (flip hacia atrás + cancel + air roll). */
export class HalfFlip extends Maneuver {
  readonly kind = 'halfflip';
  private stage: 'back' | 'jump' | 'gap' | 'flip' | 'cancel' = 'back';
  private stageT = 0;
  private rollDir = 1;
  faceTo: V3;
  constructor(faceTo: V3) {
    super();
    this.faceTo = faceTo;
  }

  step(ctx: Ctx, inp: CarInput) {
    const c = ctx.car;
    this.t += ctx.dt;
    this.stageT += ctx.dt;
    switch (this.stage) {
      case 'back':
        inp.throttle = -1;
        if (forwardSpeed(c) < -220 || this.stageT > 0.35) { this.stage = 'jump'; this.stageT = 0; }
        break;
      case 'jump':
        inp.throttle = -1;
        inp.jump = true;
        if (this.stageT >= 0.07) { this.stage = 'gap'; this.stageT = 0; }
        break;
      case 'gap':
        inp.jump = false;
        if (this.stageT >= 0.025) { this.stage = 'flip'; this.stageT = 0; }
        break;
      case 'flip': {
        inp.jump = true;
        inp.pitch = 1; // flip hacia atrás
        // Rodar hacia el lado del objetivo
        const l = c.q.unrotate(this.faceTo.sub(c.pos));
        this.rollDir = l.y > 0 ? -1 : 1;
        this.stage = 'cancel';
        this.stageT = 0;
        break;
      }
      case 'cancel': {
        inp.jump = false;
        inp.throttle = 1;
        if (this.stageT > 0.1 && this.stageT < 0.75 && c.up().z < 0.8) {
          inp.pitch = -1; // cancela el flip
          inp.roll = this.rollDir;
        } else if (this.stageT >= 0.1) {
          recover(c, inp, ctx.p, this.faceTo);
        }
        inp.boost = c.up().z > 0.8 && c.forward().dot(this.faceTo.sub(c.pos).norm()) > 0.7 && c.boost > 0;
        if ((c.onGround && this.stageT > 0.15) || this.t > 2) this.done = true;
        break;
      }
    }
  }
}
