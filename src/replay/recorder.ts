// Grabación: partido completo (30 cuadros/s, crece por bloques) y buffer circular de clips (últimos 15 s a 60 cuadros/s).

import { CAR_BODIES } from '../sim/constants.ts';
import type { Snapshot, World } from '../sim/world.ts';
import { type HudFrame, type ReplayCarInfo, type ReplayGoal, strideFor, writeFrame } from './format.ts';

export function hudOf(world: World): HudFrame {
  return { clock: world.cfg.mode === 'match' ? world.clock : 0, score: [world.score[0], world.score[1]], overtime: world.overtime };
}

export function carsInfo(world: World): ReplayCarInfo[] {
  return world.cars.map((c) => ({ id: c.id, team: c.team, name: c.name, bodyIndex: Math.max(0, CAR_BODIES.indexOf(c.body)) }));
}

/** Grabador de partido completo. */
export class MatchRecorder {
  readonly fps: number;
  readonly every: number;
  readonly nCars: number;
  readonly nPads: number;
  readonly stride: number;
  readonly cars: ReplayCarInfo[];
  readonly goals: ReplayGoal[] = [];
  private blocks: Int16Array[] = [];
  private block: Int16Array;
  private inBlock = 0;
  private readonly blockFrames = 1800;
  private tickCount = 0;
  private lastScore = [0, 0];
  frames = 0;

  constructor(world: World, fps = 30) {
    this.fps = fps;
    this.every = Math.max(1, Math.round(120 / fps));
    this.nCars = world.cars.length;
    this.nPads = world.pads.length;
    this.stride = strideFor(this.nCars, this.nPads);
    this.cars = carsInfo(world);
    this.block = new Int16Array(this.blockFrames * this.stride);
  }

  /** Llamar una vez por tick de simulación. */
  push(snap: Snapshot, world: World) {
    const hud = hudOf(world);
    if (hud.score[0] !== this.lastScore[0] || hud.score[1] !== this.lastScore[1]) {
      const team = hud.score[0] !== this.lastScore[0] ? 0 : 1;
      const g = world.lastGoal;
      const scorer = g && g.scorerId >= 0 ? world.cars[g.scorerId]?.name ?? '' : '';
      this.goals.push({ t: this.frames / this.fps, team, scorer });
      this.lastScore = [hud.score[0], hud.score[1]];
    }
    if (this.tickCount++ % this.every !== 0) return;
    writeFrame(this.block, this.inBlock * this.stride, snap, hud, this.nCars);
    this.inBlock++;
    this.frames++;
    if (this.inBlock === this.blockFrames) {
      this.blocks.push(this.block);
      this.block = new Int16Array(this.blockFrames * this.stride);
      this.inBlock = 0;
    }
  }

  finish(): Int16Array {
    const out = new Int16Array(this.frames * this.stride);
    let o = 0;
    for (const b of this.blocks) { out.set(b, o); o += b.length; }
    out.set(this.block.subarray(0, this.inBlock * this.stride), o);
    return out;
  }
}

/** Buffer circular para "Guardar clip": últimos `seconds` a `fps` cuadros por segundo. */
export class ClipBuffer {
  readonly fps: number;
  readonly every: number;
  readonly capacity: number;
  nCars = 0;
  nPads = 0;
  stride = 0;
  cars: ReplayCarInfo[] = [];
  private ring: Int16Array = new Int16Array(0);
  private head = 0;
  private count = 0;
  private tickCount = 0;
  mode = '';

  constructor(seconds = 15, fps = 60) {
    this.fps = fps;
    this.every = Math.max(1, Math.round(120 / fps));
    this.capacity = Math.round(seconds * fps);
  }

  reset(world: World, mode: string) {
    this.nCars = world.cars.length;
    this.nPads = world.pads.length;
    this.stride = strideFor(this.nCars, this.nPads);
    this.cars = carsInfo(world);
    this.ring = new Int16Array(this.capacity * this.stride);
    this.head = 0;
    this.count = 0;
    this.tickCount = 0;
    this.mode = mode;
  }

  push(snap: Snapshot, world: World) {
    if (!this.stride || snap.cars.length !== this.nCars) return;
    if (this.tickCount++ % this.every !== 0) return;
    writeFrame(this.ring, this.head * this.stride, snap, hudOf(world), this.nCars);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  get frames() { return this.count; }

  /** Copia lineal (del más viejo al más nuevo). */
  snapshot(): Int16Array {
    const out = new Int16Array(this.count * this.stride);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const src = ((start + i) % this.capacity) * this.stride;
      out.set(this.ring.subarray(src, src + this.stride), i * this.stride);
    }
    return out;
  }
}
