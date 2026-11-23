// Bots: usan exactamente la misma API de input que un jugador humano (CarInput).
// Arquitectura: planificador por estados (kickoff, ataque, apoyo, último hombre, defensa, sombra, demolición)
// + maniobras con estado (flip, remate con salto, aéreo rápido, speed flip, half-flip)
// + controladores PD de manejo y de aire. Parámetros por dificultad en params.ts.

import { type Car, type CarInput, emptyInput } from '../sim/car.ts';
import { BALL, CAR, DT } from '../sim/constants.ts';
import { rng, V3 } from '../sim/math.ts';
import type { World } from '../sim/world.ts';
import {
  arriveAt, DOUBLE_JUMP_Z, driveTo, flat, flatDist, forwardSpeed, hasFlip, JUMP_Z, localAngle, recover, riseTime, steerTo,
} from './control.ts';
import { Aerial, type Ctx, Dodge, HalfFlip, JumpShot, type Maneuver, SpeedFlip } from './maneuvers.ts';
import { type BotParams, type Difficulty, DIFFICULTY_NAMES, PARAMS, TUNING } from './params.ts';
import { BallPredictor } from './prediction.ts';
import {
  attackSign, boostDetour, chooseShotTarget, computeRole, farPost, findShot, goalLineBlock, isOnside, lastManPosition,
  nearestBigPad, oppGoalPos, ownGoalPos, type Role, type ShotPlan, supportPosition,
} from './strategy.ts';

export { BallPredictor, DIFFICULTY_NAMES };
export type { Difficulty };

type Mode = 'kickoff' | 'shot' | 'position' | 'retreat' | 'shadow' | 'demo' | 'dribble' | 'idle';
type KickoffRole = 'take' | 'cheat' | 'boost' | 'fake';

export interface BotStats {
  aerials: number; jumpShots: number; flipShots: number; speedFlips: number; halfFlips: number;
  waveDashes: number; demoChases: number; flicks: number; thinkMs: number; thinks: number;
}

export class Bot {
  car: Car;
  diff: Difficulty;
  p: BotParams;
  stats: BotStats = { aerials: 0, jumpShots: 0, flipShots: 0, speedFlips: 0, halfFlips: 0, waveDashes: 0, demoChases: 0, flicks: 0, thinkMs: 0, thinks: 0 };
  /** Último modo (para depuración / HUD). */
  mode: Mode = 'idle';
  role: Role = 'first';

  private rand: () => number;
  private man: Maneuver | null = null;
  private plan: ShotPlan | null = null;
  private posTarget = new V3();
  private planTimer = 0;
  private flipDecision = false;
  private kick: { role: KickoffRole; started: boolean; spawn: V3 } | null = null;
  private hesitate = 0;
  private demoTarget: Car | null = null;
  private demoTimer = 0;
  private lastHalfFlipTick = -1000;
  private seeded = false;

  constructor(car: Car, diff: Difficulty) {
    this.car = car;
    this.diff = diff;
    this.p = PARAMS[diff];
    this.rand = rng(0x9e3779b9 ^ ((car.id + 1) * 2654435761));
  }

  think(world: World, pred: BallPredictor, dt: number): CarInput {
    const t0 = performance.now();
    const inp = this.decide(world, pred, dt);
    this.stats.thinkMs += performance.now() - t0;
    this.stats.thinks++;
    return inp;
  }

  private decide(world: World, pred: BallPredictor, dt: number): CarInput {
    const c = this.car;
    const inp = emptyInput();
    if (!this.seeded) { this.rand = rng((world.cfg.seed ^ ((c.id + 1) * 2654435761)) >>> 0); this.seeded = true; }
    if (c.demoed) { this.man = null; this.plan = null; this.kick = null; return inp; }
    const ctx: Ctx = { car: c, world, pred, p: this.p, dt };

    // Gol / fin: la pelota no está en juego
    if (world.ball.hidden || world.phase === 'goal' || world.phase === 'ended') {
      this.man = null; this.plan = null; this.kick = null;
      this.mode = 'idle';
      if (!c.onGround) recover(c, inp, this.p);
      return inp;
    }

    // Kickoff
    const kickoff = world.phase === 'countdown' || (world.lastTouches.length === 0 && world.ball.pos.x === 0 && world.ball.pos.y === 0);
    if (kickoff) return this.kickoff(world, ctx, inp);
    this.kick = null;

    // Maniobra en curso
    if (this.man && !this.man.done) {
      this.man.step(ctx, inp);
      if (this.man.done) this.endManeuver();
      return inp;
    }
    this.man = null;

    // En el aire sin maniobra: recuperación (con wave dash)
    if (!c.onGround) {
      this.airRecovery(world, inp);
      return inp;
    }

    // Duda ocasional (Novato)
    if (this.hesitate > 0) { this.hesitate -= dt; inp.steer = 0; inp.throttle = 0.2; return inp; }
    if (this.p.hesitation > 0 && this.rand() < this.p.hesitation * dt) this.hesitate = 0.25 + this.rand() * 0.35;

    // Replanificar con el tiempo de reacción de la dificultad
    this.planTimer -= dt;
    if (this.planTimer <= 0 || (this.plan && world.tick > this.plan.tick + 15)) {
      this.planTimer = this.p.replan;
      this.replan(world, pred);
    }

    this.execute(world, ctx, inp);
    return inp;
  }

  private endManeuver() {
    this.man = null;
    this.plan = null;
    this.planTimer = 0;
  }

  // -------------------------------------------------------------------------
  // Kickoff
  // -------------------------------------------------------------------------

  private kickoff(world: World, ctx: Ctx, inp: CarInput): CarInput {
    const c = this.car;
    if (!this.kick) this.kick = { role: this.kickoffRole(world), started: false, spawn: c.pos.clone() };
    this.mode = 'kickoff';
    if (world.phase === 'countdown') { this.man = null; return inp; }
    const ball = world.ball.pos;
    const k = this.kick;

    if (this.man && !this.man.done) {
      this.man.step(ctx, inp);
      if (this.man.done) this.man = null;
      return inp;
    }
    if (!c.onGround) { recover(c, inp, this.p, ball); return inp; }

    switch (k.role) {
      case 'take': {
        // Apuntar un poco descentrado para que la pelota salga hacia adelante y no hacia el propio arco
        const s = attackSign(c.team);
        const aim = new V3(ball.x + (c.pos.x > 0 ? 18 : c.pos.x < 0 ? -18 : 0), ball.y - s * 40, 0);
        const dist = flatDist(c.pos, ball);
        if (!k.started) {
          k.started = true;
          if (this.p.speedFlip && dist > 3000) {
            const side: 1 | -1 = c.pos.x * s > 0 ? -1 : c.pos.x * s < 0 ? 1 : (this.rand() < 0.5 ? 1 : -1);
            this.man = new SpeedFlip(side, aim);
            this.stats.speedFlips++;
            this.man.step(ctx, inp);
            return inp;
          }
        }
        steerTo(c, inp, aim, this.p, false);
        inp.throttle = 1;
        inp.boost = this.p.useBoost || dist > 2200;
        // Flip hacia la pelota a la distancia justa (más potencia y gana el 50/50)
        const flipDist = this.diff === 0 ? 420 : this.p.speedFlip ? 560 : 680;
        if (dist < flipDist && (this.diff > 0 || this.rand() < 0.3 * DT * 60)) {
          this.man = new Dodge(ball, 0.03, 1 / 120, false);
          this.stats.flipShots++;
          this.man.step(ctx, inp);
        }
        return inp;
      }
      case 'cheat': {
        const s = attackSign(c.team);
        const spot = new V3(k.spawn.x * 0.35, -s * 1700, 0);
        if (flatDist(c.pos, spot) > 200) driveTo(c, inp, spot, this.p, { stopAt: true, boost: false });
        else { steerTo(c, inp, ball, this.p, false); inp.throttle = forwardSpeed(c) > 100 ? -0.6 : 0.1; }
        return inp;
      }
      case 'boost': {
        const pad = nearestBigPad(world, c, ownGoalPos(c.team));
        const dest = pad && c.boost < 95 ? pad : lastManPosition(world, c);
        driveTo(c, inp, dest, this.p, { stopAt: dest !== pad });
        return inp;
      }
      case 'fake': {
        steerTo(c, inp, ball, this.p, false);
        inp.throttle = 0;
        return inp;
      }
    }
  }

  private kickoffRole(world: World): KickoffRole {
    const c = this.car;
    const s = attackSign(c.team);
    const mates = world.cars.filter((o) => o.team === c.team && !o.demoed);
    // El más cercano va; desempate: el de la izquierda (desde su arco)
    const key = (o: Car) => Math.round(flatDist(o.pos, world.ball.pos) / 50) * 10000 + o.pos.x * s;
    const sorted = [...mates].sort((a, b) => key(a) - key(b));
    const idx = sorted.indexOf(c);
    if (this.p.rotation === 0) return 'take';
    if (mates.length === 1) {
      // Leyenda a veces hace "fake" desde atrás en 1v1
      if (this.diff === 2 && Math.abs(c.pos.x) < 10 && this.rand() < 0.12) return 'fake';
      return 'take';
    }
    if (idx === 0) return 'take';
    if (idx === 1) return 'cheat';
    return 'boost';
  }

  // -------------------------------------------------------------------------
  // Planificación
  // -------------------------------------------------------------------------

  private replan(world: World, pred: BallPredictor) {
    const c = this.car;
    const p = this.p;
    const ball = world.ball.pos;
    const s = attackSign(c.team);
    this.role = computeRole(world, c, pred, p);
    const threatT = pred.goalTime[c.team];
    const threat = threatT < TUNING.threatTime;
    const onside = isOnside(c, ball);
    this.plan = null;

    // Demolición en curso
    if (this.demoTarget && this.demoTimer > 0 && this.role !== 'first' && !threat) { this.mode = 'demo'; return; }
    this.demoTarget = null;

    // Dribble (Leyenda): la pelota quedó arriba del auto
    if (p.dribble && this.ballOnRoof(world)) { this.mode = 'dribble'; return; }

    if (this.role === 'first' || p.rotation === 0) {
      // Defensa urgente: la pelota va al arco propio
      if (threat) {
        const clearTarget = this.clearTarget(world);
        const save = findShot(world, c, pred, p, { target: clearTarget, allowAerial: true, margin: p.etaMargin * 0.5 });
        if (save && save.t < threatT + 0.05) { this.setPlan(save); return; }
        this.mode = 'retreat';
        this.posTarget = onside ? goalLineBlock(world, c, pred) : farPost(world, c);
        return;
      }
      // Fuera de juego: volver rotando por el palo lejano si la pelota se acerca a nuestro arco
      if (!onside && p.rotation > 0 && (ball.y * s < 0 || flatDist(c.pos, ball) > 2500)) {
        this.mode = 'retreat';
        this.posTarget = farPost(world, c);
        const pad = boostDetour(world, c, this.posTarget, p, c.boost < 40);
        if (pad) this.posTarget = pad;
        return;
      }
      // Sombra: el rival viene con la pelota controlada hacia nuestro arco y no hay buena intercepción
      const target = chooseShotTarget(world, c, ball, this.rand, p);
      const shot = findShot(world, c, pred, p, { target, allowAerial: true, margin: p.etaMargin });
      if (p.shadowDefense && this.shouldShadow(world, shot)) {
        this.mode = 'shadow';
        return;
      }
      if (shot) { this.setPlan(shot); return; }
      // Sin intercepción clara: ir hacia donde va a estar la pelota
      this.mode = 'position';
      const sl = pred.at(1.2).pos;
      this.posTarget = new V3(sl.x, sl.y - s * 300, 0);
      return;
    }

    if (this.role === 'second') {
      if (threat) {
        // Ayudar a defender: tapar el arco por el palo lejano
        this.mode = 'retreat';
        this.posTarget = threatT < 1.2 ? goalLineBlock(world, c, pred) : farPost(world, c);
        return;
      }
      if (p.demos && this.findDemo(world)) { this.mode = 'demo'; return; }
      this.mode = 'position';
      this.posTarget = supportPosition(world, c);
      const pad = c.boost < TUNING.lowBoost ? boostDetour(world, c, this.posTarget, p, true) ?? nearestBigPad(world, c, this.posTarget) : boostDetour(world, c, this.posTarget, p, false);
      if (pad && (c.boost < TUNING.lowBoost || flatDist(c.pos, pad) < 1200)) this.posTarget = pad;
      return;
    }

    // 3.er hombre: último en la defensa, no se compromete salvo amenaza
    if (threat) {
      const clearTarget = this.clearTarget(world);
      const save = findShot(world, c, pred, p, { target: clearTarget, allowAerial: true, margin: p.etaMargin });
      if (save && save.t < threatT) { this.setPlan(save); return; }
      this.mode = 'retreat';
      this.posTarget = goalLineBlock(world, c, pred);
      return;
    }
    this.mode = 'position';
    this.posTarget = lastManPosition(world, c);
    if (c.boost < 30) {
      // Sólo pads de atrás
      const pad = boostDetour(world, c, this.posTarget, p, true);
      if (pad && pad.y * s < -1500) this.posTarget = pad;
    }
  }

  private setPlan(plan: ShotPlan) {
    this.plan = plan;
    this.mode = 'shot';
    this.flipDecision = this.rand() < this.p.flipShot;
  }

  private clearTarget(world: World): V3 {
    const c = this.car;
    const s = attackSign(c.team);
    const b = world.ball.pos;
    const side = Math.sign(b.x) || (this.rand() < 0.5 ? 1 : -1);
    return new V3(side * 4000, b.y + s * 3000, 400);
  }

  private shouldShadow(world: World, shot: ShotPlan | null): boolean {
    const c = this.car;
    const s = attackSign(c.team);
    const b = world.ball;
    const toOwn = -s;
    const ballComing = b.vel.y * toOwn > 500;
    const opps = world.cars.filter((o) => o.team !== c.team && !o.demoed);
    const carrier = opps.find((o) => flatDist(o.pos, b.pos) < 450 && o.onGround);
    if (!ballComing || !carrier) return false;
    const distGoal = Math.abs(b.pos.y - ownGoalPos(c.team).y);
    if (distGoal < 2600) return false; // cerca del arco: hay que salir
    if (shot && shot.t < 0.55) return false; // podemos ganarla
    return isOnside(c, b.pos);
  }

  private findDemo(world: World): boolean {
    const c = this.car;
    if (c.boost < 45 || this.rand() > 0.35) return false;
    const fwd = c.forward();
    for (const o of world.cars) {
      if (o.team === c.team || o.demoed) continue;
      const rel = o.pos.sub(c.pos);
      const d = rel.len();
      if (d > 2400 || d < 500) continue;
      if (flat(rel).norm().dot(flat(fwd).norm()) < 0.8) continue;
      // Sólo si el rival está cerca de su arco (arquero) o yendo hacia nuestro campo sin pelota
      const oppGoalDist = Math.abs(o.pos.y - oppGoalPos(c.team).y);
      if (oppGoalDist > 3500 && flatDist(o.pos, world.ball.pos) < 1500) continue;
      this.demoTarget = o;
      this.demoTimer = 2.2;
      this.stats.demoChases++;
      return true;
    }
    return false;
  }

  private ballOnRoof(world: World): boolean {
    const c = this.car;
    const b = world.ball;
    if (!c.onGround || c.up().z < 0.9) return false;
    const rel = c.q.unrotate(b.pos.sub(c.pos));
    const top = c.offset.z + c.half.z;
    return rel.z > top && rel.z < top + BALL.RADIUS + 70 && Math.abs(rel.x - c.offset.x) < 85 && Math.abs(rel.y) < 60
      && b.vel.sub(c.vel).len() < 450;
  }

  // -------------------------------------------------------------------------
  // Ejecución
  // -------------------------------------------------------------------------

  private execute(world: World, ctx: Ctx, inp: CarInput) {
    const c = this.car;
    const p = this.p;
    const ball = world.ball.pos;
    switch (this.mode) {
      case 'shot':
        if (this.plan) { this.executeShot(world, ctx, inp, this.plan); return; }
        break;
      case 'dribble':
        this.executeDribble(world, ctx, inp);
        return;
      case 'demo': {
        const o = this.demoTarget;
        this.demoTimer -= ctx.dt;
        if (!o || o.demoed || this.demoTimer <= 0) { this.demoTarget = null; this.planTimer = 0; break; }
        const tHit = flatDist(c.pos, o.pos) / Math.max(c.speed(), 1200);
        const aim = o.pos.add(o.vel.scale(Math.min(tHit, 1)));
        steerTo(c, inp, aim, p, false);
        inp.throttle = 1;
        inp.boost = c.boost > 0 && Math.abs(localAngle(c, aim)) < 0.5;
        return;
      }
      case 'shadow': {
        // Retroceder entre la pelota y el arco, manteniendo distancia
        const goal = ownGoalPos(c.team);
        const b = world.ball;
        const dir = flat(goal.sub(b.pos)).norm();
        const spot = b.pos.add(dir.scale(1300));
        spot.z = 0;
        const ang = steerTo(c, inp, spot, p, true);
        const desired = Math.max(0, -b.vel.dot(dir) * -1) + flatDist(c.pos, spot) * 0.8;
        const fs = forwardSpeed(c);
        inp.throttle = fs < desired ? 1 : fs > desired + 300 ? -1 : 0;
        inp.boost = p.useBoost && fs < desired - 500 && Math.abs(ang) < 0.3;
        return;
      }
      default:
        break;
    }
    // Posicionamiento (apoyo, último hombre, volver)
    this.executePosition(world, ctx, inp, this.posTarget);
    void ball;
  }

  private executePosition(world: World, ctx: Ctx, inp: CarInput, target: V3) {
    const c = this.car;
    const p = this.p;
    const ball = world.ball.pos;
    const dist = flatDist(c.pos, target);
    const ang = localAngle(c, target);
    // Half-flip para darse vuelta rápido hacia un destino lejano que quedó atrás
    if (p.halfFlip && Math.abs(ang) > 2.6 && dist > 1400 && Math.abs(forwardSpeed(c)) < 500 && world.tick - this.lastHalfFlipTick > 240) {
      this.man = new HalfFlip(target);
      this.lastHalfFlipTick = world.tick;
      this.stats.halfFlips++;
      this.man.step(ctx, inp);
      return;
    }
    if (dist < 280 && this.mode === 'position') {
      // Llegamos: mirar la pelota y quedarse listo
      steerTo(c, inp, ball, p, false);
      const fs = forwardSpeed(c);
      inp.throttle = Math.abs(localAngle(c, ball)) > 0.4 ? 0.6 : fs > 150 ? -0.4 : 0.05;
      return;
    }
    const urgent = this.mode === 'retreat';
    driveTo(c, inp, target, p, { stopAt: this.mode === 'position', boost: urgent || c.boost > 50 });
    if (!p.useBoost) inp.boost = false;
  }

  private executeShot(world: World, ctx: Ctx, inp: CarInput, plan: ShotPlan) {
    const c = this.car;
    const p = this.p;
    const timeLeft = (plan.tick - world.tick) * DT;
    if (timeLeft < -0.12) { this.planTimer = 0; this.plan = null; this.executePosition(world, ctx, inp, this.posTarget); return; }

    if (plan.kind === 'aerial') {
      // Despegar cuando estamos mirando hacia la pelota
      const ang = localAngle(c, plan.ball);
      if (Math.abs(ang) < 0.45 || flatDist(c.pos, plan.ball) < 600) {
        this.man = new Aerial(plan.tick, plan.target, world.tick);
        this.stats.aerials++;
        this.man.step(ctx, inp);
        return;
      }
      steerTo(c, inp, plan.ball, p, false);
      inp.throttle = 1;
      return;
    }

    // Aproximación curva: alinearse detrás de la pelota en la dirección del tiro
    const dist = flatDist(c.pos, plan.contact);
    const back = Math.min(TUNING.approachBack, dist * 0.45);
    let aim = plan.contact.sub(plan.dir.scale(back));
    const fwd = flat(c.forward()).norm();
    if (fwd.dot(plan.dir) > 0.93 && dist < 900) aim = plan.contact.add(plan.dir.scale(60));
    aim.z = 0;
    const ang = arriveAt(c, inp, aim, timeLeft, p);

    // Turbo extra si vamos tarde
    if (timeLeft > 0 && dist / Math.max(forwardSpeed(c), 1) > timeLeft + 0.1 && Math.abs(ang) < 0.3 && p.useBoost) {
      inp.boost = c.boost > 0;
      inp.throttle = 1;
    }

    if (plan.kind === 'jump' || plan.kind === 'double') {
      const prof = plan.kind === 'double' ? DOUBLE_JUMP_Z : JUMP_Z;
      const need = riseTime(prof, plan.ball.z - (CAR.REST_Z + 35 + BALL.RADIUS) + 20);
      if (timeLeft <= need + 0.02 && dist < 260 && Math.abs(ang) < 0.6) {
        this.man = new JumpShot(plan.tick, plan.kind === 'double', plan.kind === 'jump' && this.flipDecision, plan.target);
        this.stats.jumpShots++;
        this.man.step(ctx, inp);
      }
      return;
    }

    // Remate con flip: justo antes del contacto, alineado y con la pelota baja
    const ball = world.ball.pos;
    const toBall = flatDist(c.pos, ball);
    if (this.flipDecision && timeLeft < 0.24 && timeLeft > 0.03 && toBall < 480 && ball.z < 170 && Math.abs(localAngle(c, ball)) < 0.35 && forwardSpeed(c) > 700) {
      const aimPt = ball.add(plan.dir.scale(400));
      this.man = new Dodge(aimPt, 0.03, 1 / 120, false);
      this.stats.flipShots++;
      this.man.step(ctx, inp);
    }
  }

  private executeDribble(world: World, ctx: Ctx, inp: CarInput) {
    const c = this.car;
    const p = this.p;
    const b = world.ball;
    if (!this.ballOnRoof(world)) { this.planTimer = 0; this.mode = 'position'; this.executePosition(world, ctx, inp, b.pos); return; }
    const goal = oppGoalPos(c.team);
    // Mantener la pelota apenas adelante del centro del techo, llevándola hacia el arco
    const rel = c.q.unrotate(b.pos.sub(c.pos));
    const offX = rel.x - (c.offset.x + 12);
    const desired = Math.max(250, b.vel.dot(c.forward()) + offX * 4);
    steerTo(c, inp, new V3(goal.x, goal.y, 0), { ...p, steerGain: 1.4 }, false);
    const fs = forwardSpeed(c);
    inp.throttle = fs < desired ? 1 : fs > desired + 80 ? -0.3 : 0.4;
    inp.boost = false;
    // Flick: rival cerca o a tiro del arco
    const oppNear = world.cars.some((o) => o.team !== c.team && !o.demoed && flatDist(o.pos, c.pos) < 900);
    const distGoal = flatDist(c.pos, goal);
    if (oppNear || distGoal < 2600) {
      this.man = new Dodge(goal.add(new V3(0, 0, 300)), 0.1, 0.07, false);
      this.stats.flicks++;
      this.man.step(ctx, inp);
    }
  }

  // -------------------------------------------------------------------------
  // Recuperación en el aire (+ wave dash)
  // -------------------------------------------------------------------------

  private airRecovery(world: World, inp: CarInput) {
    const c = this.car;
    const p = this.p;
    const face = this.plan ? this.plan.ball : world.ball.pos;
    const land = recover(c, inp, p, flat(c.vel).len() > 500 ? undefined : face);
    if (p.waveDash && land && land.t < 4 / 120 && land.normal.z > 0.9 && c.up().dot(land.normal) > 0.93 && hasFlip(c) && !c.isJumping) {
      const hv = flat(c.vel);
      if (hv.len() > 600 && flat(c.forward()).norm().dot(hv.norm()) > 0.8 && c.vel.z < -150) {
        inp.jump = true; inp.pitch = -1; inp.yaw = 0; inp.roll = 0; inp.handbrake = false;
        this.stats.waveDashes++;
      }
    }
  }
}

export { PARAMS };
