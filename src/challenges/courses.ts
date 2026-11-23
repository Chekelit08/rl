// Desafíos contrarreloj: recorridos de aros dentro del estadio (aéreos, slalom en el piso y manejo por pared).
// Lógica pura (sin Three.js ni DOM) para poder probarla en Node.

import type { Car } from '../sim/car.ts';
import { Quat, V3 } from '../sim/math.ts';

export type CourseKind = 'Anillos' | 'Slalom' | 'Pared';

export interface Course {
  id: string;
  name: string;
  kind: CourseKind;
  desc: string;
  /** Salida: x, y, yaw. */
  start: [number, number, number];
  unlimitedBoost: boolean;
  /** Radio de los aros (uu). */
  radius: number;
  /** Centro de cada aro, en orden. */
  gates: [number, number, number][];
  /** Tiempos de medalla en segundos: oro, plata, bronce. */
  medals: [number, number, number];
}

const helix = (turns: number, n: number, r: number, z0: number, z1: number): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const a = -Math.PI / 2 + t * turns * 2 * Math.PI;
    return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r), Math.round(z0 + (z1 - z0) * t)] as [number, number, number];
  });

export const COURSES: Course[] = [
  {
    id: 'slalom', name: 'Slalom del estadio', kind: 'Slalom',
    desc: '10 puertas en zigzag por el piso. El turbo sale de las pastillas: elegí bien la línea.',
    start: [0, -4500, Math.PI / 2], unlimitedBoost: false, radius: 300,
    gates: [[-1300, -3300, 170], [1300, -2300, 170], [-1600, -1100, 170], [1600, 0, 170], [-1600, 1100, 170], [1300, 2300, 170], [-1300, 3300, 170], [0, 4300, 170], [2900, 3500, 170], [3500, 1200, 170]],
    medals: [22, 28, 38],
  },
  {
    id: 'vuelo', name: 'Primer vuelo', kind: 'Anillos',
    desc: '12 aros grandes con curvas suaves. Ideal para aprender a volar con turbo.',
    start: [0, -4500, Math.PI / 2], unlimitedBoost: true, radius: 340,
    gates: [[0, -3100, 320], [0, -1900, 620], [500, -700, 820], [1200, 500, 760], [900, 1800, 900], [-200, 2700, 1050], [-1400, 2000, 1200], [-2100, 600, 1100], [-1900, -900, 900], [-1000, -2100, 700], [-200, -3000, 480], [0, -3900, 260]],
    medals: [26, 36, 55],
  },
  {
    id: 'pared', name: 'Vuelta por las paredes', kind: 'Pared',
    desc: '12 puertas: la mitad están sobre las paredes laterales. Subí por la rampa sin soltar el acelerador.',
    start: [1800, -3900, 0.5], unlimitedBoost: false, radius: 300,
    gates: [[3100, -2700, 170], [3960, -1500, 520], [3960, 0, 900], [3960, 1500, 520], [3000, 2800, 170], [0, 3700, 170], [-3000, 2800, 170], [-3960, 1500, 520], [-3960, 0, 900], [-3960, -1500, 520], [-3000, -2800, 170], [0, -3700, 170]],
    medals: [24, 31, 42],
  },
  {
    id: 'tirabuzon', name: 'Tirabuzón', kind: 'Anillos',
    desc: 'Dos vueltas en espiral hasta el techo con aros chicos y una picada final. Para pilotos con air roll.',
    start: [-1600, -1800, 0.06], unlimitedBoost: true, radius: 240,
    gates: [...helix(2, 15, 1700, 300, 1650), [800, -900, 1500], [0, 0, 1100], [-700, 900, 600], [-1300, 1900, 280]],
    medals: [34, 48, 75],
  },
];

export interface Gate { p: V3; n: V3; r: number }

/** Aros con su normal (dirección de paso), calculada por diferencias centrales sobre el recorrido. */
export function buildGates(c: Course): Gate[] {
  const pts = c.gates.map(([x, y, z]) => new V3(x, y, z));
  const startP = new V3(c.start[0], c.start[1], 17);
  return pts.map((p, i) => {
    const prev = i === 0 ? startP : pts[i - 1];
    const next = i === pts.length - 1 ? p.add(p.sub(prev)) : pts[i + 1];
    const n = next.sub(prev);
    // Las puertas apoyadas en el piso quedan verticales
    if (p.z < 200 && prev.z < 200 && next.z < 200) n.z = 0;
    return { p, n: n.norm(), r: c.radius };
  });
}

export function medalFor(c: Course, seconds: number): 0 | 1 | 2 | 3 {
  return seconds <= c.medals[0] ? 3 : seconds <= c.medals[1] ? 2 : seconds <= c.medals[2] ? 1 : 0;
}
export const MEDAL_NAMES = ['Sin medalla', 'Bronce', 'Plata', 'Oro'] as const;

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

/** Una corrida de un desafío: detecta el paso por cada aro y lleva el cronómetro. */
export class ChallengeRun {
  gates: Gate[];
  index = 0;
  ticks = 0;
  started = false;
  finished = false;
  /** Tiempos parciales (s) al pasar cada aro. */
  splits: number[] = [];
  private prev = new V3();
  private hasPrev = false;

  course: Course;

  constructor(course: Course) { this.course = course; this.gates = buildGates(course); }

  get time() { return this.ticks / 120; }
  get next(): Gate | null { return this.gates[this.index] ?? null; }

  /** Llamar una vez por tick con la posición del auto. Devuelve true si en este tick pasó un aro. */
  step(pos: V3, speed: number): boolean {
    if (this.finished) return false;
    if (!this.started && speed > 30) this.started = true;
    if (this.started) this.ticks++;
    let passed = false;
    const g = this.next;
    if (g && this.hasPrev) {
      const d0 = this.prev.sub(g.p).dot(g.n), d1 = pos.sub(g.p).dot(g.n);
      if ((d0 < 0) !== (d1 < 0)) {
        const t = d0 / (d0 - d1);
        const hit = this.prev.add(pos.sub(this.prev).scale(t));
        if (hit.sub(g.p).len() <= g.r) passed = true;
      }
      if (passed) {
        this.splits.push(this.time);
        this.index++;
        if (this.index >= this.gates.length) this.finished = true;
      }
    }
    this.prev.set(pos.x, pos.y, pos.z);
    this.hasPrev = true;
    return passed;
  }

  /** Vuelve el auto al último aro pasado (o a la salida), apuntando al siguiente. El cronómetro sigue. */
  respawn(car: Car) {
    this.hasPrev = false;
    const c = this.course;
    if (this.index === 0) { car.placeAt(c.start[0], c.start[1], c.start[2]); return; }
    const g = this.gates[this.index - 1];
    const to = (this.next?.p ?? g.p.add(g.n)).sub(g.p).norm();
    const yaw = Math.atan2(to.y, to.x);
    car.placeAt(g.p.x, g.p.y, yaw);
    if (g.p.z > 220) {
      // Aro en el aire (o sobre una pared): reaparece volando hacia el siguiente
      const flat = new V3(Math.cos(yaw), Math.sin(yaw), 0);
      car.pos.set(g.p.x, g.p.y, g.p.z);
      car.q = Quat.between(flat, to).mul(Quat.fromYPR(yaw));
      car.vel.set(to.x * 900, to.y * 900, to.z * 900 + 150);
      car.onGround = false;
      // Sin salto previo: conserva el flip para corregir
    }
  }
}

// ---------- Récords (localStorage) ----------
const KEY = 'turbogol.challenges';
export function loadBests(): Record<string, number> {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
export function saveBest(id: string, seconds: number): boolean {
  const b = loadBests();
  if (b[id] !== undefined && b[id] <= seconds) return false;
  b[id] = seconds;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(b)); } catch { /* ignorar */ }
  return true;
}
