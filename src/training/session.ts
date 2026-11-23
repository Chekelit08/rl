// Sesión de entrenamiento (sin DOM): carga tiros, congela todo hasta que el jugador se mueve,
// mide el tiempo y decide acierto o fallo. Corre igual en el navegador y en las pruebas.

import type { CarInput } from '../sim/car.ts';
import { ARENA, BALL } from '../sim/constants.ts';
import { Quat } from '../sim/math.ts';
import type { GameEvent, World } from '../sim/world.ts';
import { DEFAULT_TIME, type Pack, type Shot } from './types.ts';

export type ShotResult = 'pendiente' | 'acierto' | 'fallo';
export type SessionPhase = 'esperando' | 'jugando' | 'resultado' | 'terminado';

export interface SessionOptions {
  /** Variación aleatoria leve de cada tiro (posición, velocidad y ángulo). */
  variance: boolean;
  /** Turbo infinito durante el pack. */
  unlimitedBoost: boolean;
  /** Avanzar solo al siguiente tiro después de un acierto. */
  autoAdvance: boolean;
  rand?: () => number;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = { variance: false, unlimitedBoost: false, autoAdvance: true };

const RESULT_PAUSE = 1.4;

export function inputActive(i: CarInput) {
  return Math.abs(i.throttle) > 0.1 || Math.abs(i.steer) > 0.25 || Math.abs(i.pitch) > 0.25 || Math.abs(i.yaw) > 0.25 ||
    Math.abs(i.roll) > 0.25 || i.jump || i.boost;
}

/** Ubica pelota y auto según el tiro (sin liberar la pelota). */
export function placeShot(world: World, shot: Shot, carIndex = 0) {
  const car = world.cars[carIndex];
  const b = world.ball;
  b.reset(shot.ball.p[0], shot.ball.p[1], Math.max(BALL.RADIUS + 1, shot.ball.p[2]) as number as typeof BALL.REST_Z);
  b.frozen = true;
  b.hidden = false;
  if (car) {
    const yaw = (shot.car.yaw * Math.PI) / 180;
    car.placeAt(shot.car.p[0], shot.car.p[1], yaw);
    const pitch = ((shot.car.pitch ?? 0) * Math.PI) / 180;
    const roll = ((shot.car.roll ?? 0) * Math.PI) / 180;
    if (pitch || roll) car.q = Quat.fromYPR(yaw, -pitch, roll);
    if (shot.car.p[2] > 18) {
      car.pos.z = shot.car.p[2];
      car.onGround = false;
    }
    car.vel.set(0, 0, 0);
    car.ang.set(0, 0, 0);
    car.boost = shot.car.boost ?? 100;
    car.lastJumpInput = true; // un salto mantenido no cuenta como "presionado" al liberar
  }
}

/** Aplica la velocidad inicial (pelota y auto) al liberar el tiro. */
export function releaseShot(world: World, shot: Shot, carIndex = 0) {
  const b = world.ball;
  b.frozen = false;
  b.vel.set(shot.ball.v[0], shot.ball.v[1], shot.ball.v[2]);
  if (shot.ball.w) b.ang.set(shot.ball.w[0], shot.ball.w[1], shot.ball.w[2]);
  const car = world.cars[carIndex];
  if (car && shot.car.v) car.vel.set(shot.car.v[0], shot.car.v[1], shot.car.v[2]);
}

/** Variación leve de un tiro (como la opción de variación del género). */
export function varyShot(shot: Shot, rand: () => number): Shot {
  const r = (a: number) => (rand() * 2 - 1) * a;
  const ang = r(0.07);
  const sp = 1 + r(0.08);
  const [vx, vy, vz] = shot.ball.v;
  const c = Math.cos(ang), s = Math.sin(ang);
  return {
    ...shot,
    ball: {
      ...shot.ball,
      p: [shot.ball.p[0] + r(90), shot.ball.p[1] + r(90), shot.ball.p[2] + Math.max(0, r(40))],
      v: [(vx * c - vy * s) * sp, (vx * s + vy * c) * sp, vz * (1 + r(0.06))],
    },
    car: { ...shot.car, p: [shot.car.p[0] + r(80), shot.car.p[1] + r(80), shot.car.p[2]], yaw: shot.car.yaw + r(6) },
  };
}

export class TrainingSession {
  readonly world: World;
  pack: Pack;
  opts: SessionOptions;
  index = 0;
  results: ShotResult[];
  phase: SessionPhase = 'esperando';
  timer = 0;
  resultTimer = 0;
  lastResult: ShotResult = 'pendiente';
  attempts = 0;
  private current: Shot;
  private touchedTick = -1;
  private releaseTick = 0;
  private clearTimer = 0;
  private minY = 0;
  private rand: () => number;
  /** Para la interfaz: se llama cuando hay un resultado nuevo. */
  onResult: ((r: ShotResult, s: TrainingSession) => void) | null = null;

  constructor(world: World, pack: Pack, opts: Partial<SessionOptions> = {}) {
    this.world = world;
    this.pack = pack;
    this.opts = { ...DEFAULT_SESSION_OPTIONS, ...opts };
    this.rand = this.opts.rand ?? Math.random;
    this.results = pack.shots.map(() => 'pendiente');
    this.current = pack.shots[0];
    this.load(0);
  }

  get shot() { return this.current; }
  get total() { return this.pack.shots.length; }
  get hits() { return this.results.filter((r) => r === 'acierto').length; }
  get timeLimit() { return this.current.time ?? DEFAULT_TIME[this.pack.category]; }

  load(i: number) {
    this.index = Math.max(0, Math.min(this.pack.shots.length - 1, i));
    const base = this.pack.shots[this.index];
    this.current = this.opts.variance ? varyShot(base, this.rand) : base;
    this.phase = 'esperando';
    this.timer = 0;
    this.resultTimer = 0;
    this.touchedTick = -1;
    this.clearTimer = 0;
    this.minY = this.current.ball.p[1];
    this.lastResult = 'pendiente';
    const w = this.world;
    w.phase = 'playing';
    w.lastTouches = [];
    placeShot(w, this.current);
    if (w.cars[0]) w.cars[0].unlimitedBoost = this.opts.unlimitedBoost;
  }

  retry() { this.load(this.index); }
  next() { this.load(this.index + 1 >= this.total ? 0 : this.index + 1); }
  prev() { this.load(this.index - 1 < 0 ? this.total - 1 : this.index - 1); }

  /** Antes de cada tick: si estamos esperando y el jugador se mueve, se libera el tiro. */
  beforeTick(input: CarInput) {
    if (this.phase === 'esperando' && inputActive(input)) {
      this.phase = 'jugando';
      this.attempts++;
      this.releaseTick = this.world.tick;
      releaseShot(this.world, this.current);
    }
  }

  /** Después de cada tick. */
  afterTick(dt: number) {
    const w = this.world;
    if (this.phase === 'esperando') {
      // Todo queda congelado en el lugar de salida (también si el auto arranca en el aire)
      placeShot(w, this.current);
      return;
    }
    if (this.phase === 'resultado') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        if (this.lastResult === 'acierto' && this.opts.autoAdvance) {
          if (this.results.every((r) => r !== 'pendiente') && this.index === this.total - 1) this.phase = 'terminado';
          else this.next();
        } else this.retry();
      }
      return;
    }
    if (this.phase !== 'jugando') return;
    this.timer += dt;
    const last = w.lastTouches[w.lastTouches.length - 1];
    if (last && last.carId === 0 && last.tick >= this.releaseTick && this.touchedTick < 0) this.touchedTick = last.tick;

    if (this.pack.category === 'arquero') {
      const b = w.ball;
      this.minY = Math.min(this.minY, b.pos.y);
      // Atajada: la tocaste y ahora se aleja de tu arco; o llegó cerca del arco y rebotó hacia afuera (palo)
      const saved = this.touchedTick >= 0 && b.vel.y > 120;
      const rebound = this.minY < -4300 && b.vel.y > 250;
      if (saved || rebound) this.clearTimer += dt; else this.clearTimer = 0;
      if (this.clearTimer > 0.35) { this.finish('acierto'); return; }
      if (this.timer > this.timeLimit) { this.finish('acierto'); return; }
    } else if (this.timer > this.timeLimit) {
      this.finish('fallo');
    }
  }

  onEvent(ev: GameEvent) {
    if (this.phase !== 'jugando' || ev.type !== 'goal') return;
    // El jugador ataca el arco rojo: gol del equipo 0 = acierto; gol del rival (en contra) = fallo
    if (this.pack.category === 'arquero') this.finish(ev.team === 1 ? 'fallo' : 'acierto');
    else this.finish(ev.team === 0 ? 'acierto' : 'fallo');
  }

  private finish(r: ShotResult) {
    this.lastResult = r;
    if (this.results[this.index] !== 'acierto') this.results[this.index] = r;
    this.phase = 'resultado';
    this.resultTimer = RESULT_PAUSE;
    this.onResult?.(r, this);
  }

  /** Estado mínimo para rebobinar junto con el mundo. */
  saveState() {
    return { index: this.index, phase: this.phase, timer: this.timer, touchedTick: this.touchedTick, releaseTick: this.releaseTick, clearTimer: this.clearTimer, minY: this.minY };
  }

  loadState(s: ReturnType<TrainingSession['saveState']>) {
    if (s.index !== this.index || s.phase === 'resultado' || s.phase === 'terminado') return;
    this.phase = s.phase;
    this.timer = s.timer;
    this.touchedTick = s.touchedTick;
    this.releaseTick = s.releaseTick;
    this.clearTimer = s.clearTimer;
    this.minY = s.minY;
  }
}

export function insideField(x: number, y: number) {
  return Math.abs(x) < ARENA.X - 150 && Math.abs(y) < ARENA.Y - 150 && Math.abs(x) + Math.abs(y) < ARENA.CHAMFER - 250;
}
