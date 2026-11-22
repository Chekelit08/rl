// Mundo y reglas del partido: kickoff, reloj, goles, tiempo extra, pads de turbo, estadísticas y eventos.

import { goalOwnerAt } from './arena.ts';
import { Ball, stepBall } from './ball.ts';
import { Car, type CarInput, emptyInput, stepCar } from './car.ts';
import { collideCarBall, collideCars } from './collide.ts';
import {
  ARENA, BALL, BIG_PADS, CAR, CAR_BODIES, DT, KICKOFF_SPAWNS, PAD, RESPAWNS, SMALL_PADS,
} from './constants.ts';
import { rng, V3 } from './math.ts';

export type Phase = 'countdown' | 'playing' | 'goal' | 'ended';

export interface MatchConfig {
  mode: 'freeplay' | 'match';
  teamSize: number; // jugadores por equipo
  duration: number; // segundos
  unlimitedBoost: boolean;
  seed: number;
}

export interface Pad { pos: V3; big: boolean; active: boolean; timer: number }

export type GameEvent =
  | { type: 'hit'; carId: number; strength: number; pos: V3 }
  | { type: 'bounce'; strength: number; pos: V3 }
  | { type: 'goal'; team: number; scorerId: number; assistId: number; speed: number; pos: V3 }
  | { type: 'pad'; carId: number; big: boolean }
  | { type: 'demo'; attacker: number; victim: number; pos: V3 }
  | { type: 'bump'; attacker: number; victim: number; pos: V3 }
  | { type: 'jump'; carId: number }
  | { type: 'flip'; carId: number }
  | { type: 'flipreset'; carId: number }
  | { type: 'countdown'; n: number }
  | { type: 'kickoff' }
  | { type: 'save'; carId: number }
  | { type: 'shot'; carId: number }
  | { type: 'overtime' }
  | { type: 'end'; winner: number };

export interface CarSnap {
  id: number; team: number;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  boosting: boolean; supersonic: boolean; demoed: boolean; onGround: boolean;
  steer: number; boost: number; handbrake: number;
}
export interface BallSnap { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; vx: number; vy: number; vz: number; hidden: boolean }
export interface Snapshot { tick: number; cars: CarSnap[]; ball: BallSnap; pads: boolean[] }

const BOT_NAMES = ['Chispa', 'Turbina', 'Rayo', 'Pistón', 'Nitro', 'Bujía', 'Cometa', 'Trueno'];

export class World {
  cfg: MatchConfig;
  cars: Car[] = [];
  ball = new Ball();
  pads: Pad[] = [];
  tick = 0;
  phase: Phase = 'countdown';
  phaseTimer = 3;
  clock: number;
  overtime = false;
  zeroClock = false;
  score = [0, 0];
  events: GameEvent[] = [];
  lastTouches: { carId: number; team: number; tick: number }[] = [];
  lastGoal: { team: number; scorerId: number; tick: number } | null = null;
  winner = -1;
  private rand: () => number;
  private lastCountdown = 4;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.clock = cfg.duration;
    this.rand = rng(cfg.seed);
    for (const [x, y] of BIG_PADS) this.pads.push({ pos: new V3(x, y, 73), big: true, active: true, timer: 0 });
    for (const [x, y] of SMALL_PADS) this.pads.push({ pos: new V3(x, y, 70), big: false, active: true, timer: 0 });
  }

  addCar(team: number, name: string, bodyIndex = 0, isBot = false) {
    const c = new Car(this.cars.length, team, name, CAR_BODIES[bodyIndex % CAR_BODIES.length]);
    c.isBot = isBot;
    c.unlimitedBoost = this.cfg.unlimitedBoost;
    this.cars.push(c);
    return c;
  }

  static botName(i: number) { return BOT_NAMES[i % BOT_NAMES.length]; }

  /** Coloca autos y pelota para el saque. */
  setupKickoff() {
    this.ball.reset();
    this.ball.frozen = this.cfg.mode === 'match';
    for (const p of this.pads) { p.active = true; p.timer = 0; }
    const perTeam = [0, 1].map((t) => this.cars.filter((c) => c.team === t));
    // Elegir posiciones distintas (las mismas para ambos equipos, espejadas)
    const order = [0, 1, 2, 3, 4];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // En 1v1 cualquier posición; en equipos priorizamos diagonales + atrás para que se vea natural
    for (let t = 0; t < 2; t++) {
      perTeam[t].forEach((c, i) => {
        const [x, y, yaw] = KICKOFF_SPAWNS[order[i % 5]];
        if (t === 0) c.placeAt(x, y, yaw);
        else c.placeAt(-x, -y, yaw + Math.PI);
        c.boost = c.unlimitedBoost ? 100 : CAR.BOOST_SPAWN;
      });
    }
    this.lastTouches = [];
    if (this.cfg.mode === 'match') {
      this.phase = 'countdown';
      this.phaseTimer = 3;
      this.lastCountdown = 4;
    } else {
      this.phase = 'playing';
    }
  }

  resetFreeplay(car?: Car) {
    this.ball.reset(0, 0, BALL.REST_Z);
    if (car) car.placeAt(0, -2000, Math.PI / 2);
    this.phase = 'playing';
  }

  respawn(c: Car) {
    const [x, y, yaw] = RESPAWNS[Math.floor(this.rand() * RESPAWNS.length)];
    if (c.team === 0) c.placeAt(x, y, yaw);
    else c.placeAt(-x, -y, yaw + Math.PI);
    c.pos.z = 36;
    c.onGround = false;
    c.boost = c.unlimitedBoost ? 100 : CAR.BOOST_SPAWN;
  }

  /** Un tick de simulación (1/120 s). inputs[i] corresponde a cars[i]. */
  step(inputs: CarInput[]) {
    this.tick++;
    const dt = DT;

    if (this.phase === 'countdown') {
      this.phaseTimer -= dt;
      const n = Math.ceil(this.phaseTimer);
      if (n !== this.lastCountdown && n >= 1) { this.lastCountdown = n; this.events.push({ type: 'countdown', n }); }
      if (this.phaseTimer <= 0) {
        this.phase = 'playing';
        this.ball.frozen = false;
        this.events.push({ type: 'kickoff' });
      } else {
        // Autos congelados (pero el input de salto no debe "acumularse")
        this.cars.forEach((c, i) => { c.lastJumpInput = (inputs[i] ?? emptyInput()).jump; });
        return;
      }
    }

    // Autos
    this.cars.forEach((c, i) => {
      if (c.demoed) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0) this.respawn(c);
        return;
      }
      const inp = inputs[i] ?? emptyInput();
      const hadJumped = c.hasJumped, hadFlipped = c.hasFlipped, hadDouble = c.hasDoubleJumped;
      stepCar(c, inp, dt);
      if (!hadJumped && c.hasJumped) this.events.push({ type: 'jump', carId: c.id });
      if (!hadFlipped && c.hasFlipped) this.events.push({ type: 'flip', carId: c.id });
      if (!hadDouble && c.hasDoubleJumped) this.events.push({ type: 'jump', carId: c.id });
    });

    // Auto ↔ auto
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        for (const ev of collideCars(this.cars[i], this.cars[j])) {
          this.events.push(ev);
          if (ev.type === 'demo') {
            const att = this.cars[ev.attacker];
            att.stats.demos++;
            att.stats.score += 10;
          }
        }
      }
    }

    // Pelota
    const ballActive = this.phase === 'playing' || (this.phase === 'ended' && !this.ball.hidden);
    if (ballActive && !this.ball.hidden) {
      const bounce = stepBall(this.ball, dt);
      if (bounce > 250) this.events.push({ type: 'bounce', strength: bounce, pos: this.ball.pos.clone() });
      for (const c of this.cars) {
        const preVel = this.ball.vel.clone();
        const hit = collideCarBall(c, this.ball, this.tick);
        if (hit) {
          this.onTouch(c, hit.impulse, preVel);
          if (hit.flipReset) this.events.push({ type: 'flipreset', carId: c.id });
        }
      }
    }

    // Pads
    for (const p of this.pads) {
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) p.active = true;
        continue;
      }
      const r = p.big ? PAD.BIG_RADIUS : PAD.SMALL_RADIUS;
      for (const c of this.cars) {
        if (c.demoed || c.boost >= 100) continue;
        const dx = c.pos.x - p.pos.x, dy = c.pos.y - p.pos.y;
        if (dx * dx + dy * dy < r * r && Math.abs(c.pos.z - p.pos.z) < PAD.HEIGHT + 40) {
          c.boost = Math.min(100, c.boost + (p.big ? PAD.BIG_AMOUNT : PAD.SMALL_AMOUNT));
          p.active = false;
          p.timer = p.big ? PAD.BIG_COOLDOWN : PAD.SMALL_COOLDOWN;
          this.events.push({ type: 'pad', carId: c.id, big: p.big });
          break;
        }
      }
    }

    // Goles
    if (this.phase === 'playing' && !this.ball.hidden) {
      const owner = goalOwnerAt(this.ball.pos, BALL.RADIUS);
      if (owner >= 0) this.onGoal(1 - owner);
    }

    // Reloj
    if (this.cfg.mode === 'match') {
      if (this.phase === 'playing') {
        if (this.overtime) this.clock += dt;
        else if (!this.zeroClock) {
          this.clock -= dt;
          if (this.clock <= 0) { this.clock = 0; this.zeroClock = true; }
        }
        // En 0:00 el partido termina cuando la pelota toca el piso
        if (this.zeroClock && !this.overtime && this.ball.pos.z <= BALL.RADIUS + 8) {
          if (this.score[0] !== this.score[1]) this.endMatch();
          else {
            this.overtime = true;
            this.zeroClock = false;
            this.clock = 0;
            this.events.push({ type: 'overtime' });
            this.setupKickoff();
          }
        }
      } else if (this.phase === 'goal') {
        this.phaseTimer -= dt;
      }
    } else if (this.phase === 'goal') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.ball.reset(0, 0, BALL.REST_Z);
        this.ball.vel.set(0, 0, 0);
        this.phase = 'playing';
      }
    }
  }

  private onTouch(c: Car, impulse: number, preVel: V3) {
    const last = this.lastTouches[this.lastTouches.length - 1];
    if (!last || last.carId !== c.id || this.tick - last.tick > 30) {
      c.stats.touches++;
      c.stats.score += 2;
    }
    if (impulse > 80) this.events.push({ type: 'hit', carId: c.id, strength: impulse, pos: this.ball.pos.clone() });
    if (!last || last.carId !== c.id || this.tick - last.tick > 10) {
      // Atajada / tiro (predicción balística corta)
      const before = this.ballWouldScore(preVel);
      const after = this.ballWouldScore(this.ball.vel);
      const ownGoalOwner = c.team; // arco propio
      if (before === ownGoalOwner && after !== ownGoalOwner && this.cfg.mode === 'match') {
        c.stats.saves++;
        c.stats.score += 50;
        this.events.push({ type: 'save', carId: c.id });
      }
      if (after === 1 - c.team && before !== 1 - c.team) {
        c.stats.shots++;
        c.stats.score += 20;
        this.events.push({ type: 'shot', carId: c.id });
      }
    }
    if (last && last.carId === c.id) last.tick = this.tick;
    else this.lastTouches.push({ carId: c.id, team: c.team, tick: this.tick });
    if (this.lastTouches.length > 8) this.lastTouches.shift();
  }

  /** ¿En qué arco entraría la pelota (dueño) en los próximos 2.5 s? -1 si en ninguno. */
  private ballWouldScore(vel: V3): number {
    const b = this.ball.clone();
    b.vel = vel.clone();
    for (let i = 0; i < 300; i++) {
      stepBall(b, DT);
      const owner = goalOwnerAt(b.pos, BALL.RADIUS);
      if (owner >= 0) return owner;
    }
    return -1;
  }

  private onGoal(team: number) {
    this.score[team]++;
    const speed = this.ball.vel.len();
    // Goleador: último toque del equipo que anotó; asistencia: toque previo de un compañero (≤ 5 s)
    let scorerId = -1, assistId = -1;
    for (let i = this.lastTouches.length - 1; i >= 0; i--) {
      const t = this.lastTouches[i];
      if (t.team === team) {
        if (scorerId < 0) scorerId = t.carId;
        else if (t.carId !== scorerId && this.tick - t.tick < 600) { assistId = t.carId; break; }
      } else if (scorerId >= 0) break;
    }
    if (scorerId >= 0) { const s = this.cars[scorerId]; s.stats.goals++; s.stats.score += 100; }
    if (assistId >= 0) { const a = this.cars[assistId]; a.stats.assists++; a.stats.score += 50; }
    this.events.push({ type: 'goal', team, scorerId, assistId, speed, pos: this.ball.pos.clone() });
    this.lastGoal = { team, scorerId, tick: this.tick };
    this.ball.hidden = true;
    this.ball.frozen = true;
    this.phase = 'goal';
    this.phaseTimer = this.cfg.mode === 'match' ? 3 : 1.5;
    if (this.overtime && this.cfg.mode === 'match') this.endMatch();
  }

  endMatch() {
    this.phase = 'ended';
    this.winner = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1;
    this.events.push({ type: 'end', winner: this.winner });
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(): Snapshot {
    return {
      tick: this.tick,
      cars: this.cars.map((c) => ({
        id: c.id, team: c.team,
        x: c.pos.x, y: c.pos.y, z: c.pos.z,
        qx: c.q.x, qy: c.q.y, qz: c.q.z, qw: c.q.w,
        vx: c.vel.x, vy: c.vel.y, vz: c.vel.z,
        boosting: c.isBoosting, supersonic: c.supersonic, demoed: c.demoed, onGround: c.onGround,
        steer: c.input.steer, boost: c.boost, handbrake: c.handbrakeVal,
      })),
      ball: {
        x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z,
        qx: this.ball.q.x, qy: this.ball.q.y, qz: this.ball.q.z, qw: this.ball.q.w,
        vx: this.ball.vel.x, vy: this.ball.vel.y, vz: this.ball.vel.z,
        hidden: this.ball.hidden,
      },
      pads: this.pads.map((p) => p.active),
    };
  }
}

export { ARENA };
