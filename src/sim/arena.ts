// Geometría de la arena como función de distancia con signo (SDF).
// distance(p) > 0 dentro del espacio jugable = distancia a la superficie más cercana.
// La malla visual se genera desde la misma función → lo que ves es lo que colisiona.

import { ARENA } from './constants.ts';
import { V3 } from './math.ts';

const SQRT1_2 = Math.SQRT1_2;
const GOAL_START = 4500; // el volumen del arco se extiende dentro de la cancha (se une con max)
const GOAL_BACK = ARENA.Y + ARENA.GOAL_DEPTH; // 6000

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Distancia con signo (negativa adentro) a un octógono simétrico |x|<=X, |y|<=Y, |x|+|y|<=C. */
function octagonSdf(px: number, py: number, X: number, Y: number, C: number) {
  const x = Math.abs(px), y = Math.abs(py);
  if (x <= X && y <= Y && x + y <= C) {
    return Math.max(x - X, y - Y, (x + y - C) * SQRT1_2);
  }
  const ax = C - Y, by = C - X;
  return Math.min(
    segDist(x, y, 0, Y, ax, Y),
    segDist(x, y, ax, Y, X, by),
    segDist(x, y, X, by, X, 0),
  );
}

function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** Mínimo con filete circular (exacto para superficies ortogonales). */
function cmin(a: number, b: number, r: number) {
  if (a < r && b < r) return r - Math.hypot(r - a, r - b);
  return Math.min(a, b);
}

// Precalculados
const R = ARENA.FILLET;
const RHO = ARENA.CORNER_R;
const IX = ARENA.X - RHO, IY = ARENA.Y - RHO, IC = ARENA.CHAMFER - RHO * Math.SQRT2;
const RG = ARENA.GOAL_FILLET;

/** Distancia a las paredes de la cancha (sin piso; con techo redondeado). */
function fieldWalls(x: number, y: number, z: number) {
  const s2 = octagonSdf(x, y, IX, IY, IC) - (RHO - R);
  const wz = z - (ARENA.H - R);
  const sdf = Math.min(Math.max(s2, wz), 0) + Math.hypot(Math.max(s2, 0), Math.max(wz, 0));
  return R - sdf;
}

/** Distancia a las paredes del arco (sin piso), y ya en |y|. */
function goalWalls(ax: number, ay: number, z: number) {
  // caja interior encogida RG; z sin límite inferior
  const hx = ARENA.GOAL_HW - RG;
  const y0 = GOAL_START + RG, y1 = GOAL_BACK - RG;
  const cy = (y0 + y1) / 2, hy = (y1 - y0) / 2;
  const ztop = ARENA.GOAL_H - RG;
  const dx = ax - hx;
  const dy = Math.abs(ay - cy) - hy;
  const dz = z - ztop;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
  const inside = Math.min(Math.max(dx, dy, dz), 0);
  return RG - (outside + inside);
}

/** Distancia (positiva adentro) desde un punto a la superficie de la arena. */
export function arenaDistance(x: number, y: number, z: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  const walls = smax(fieldWalls(ax, ay, z), goalWalls(ax, ay, z), ARENA.POST_ROUND);
  // Filete del piso: grande en la cancha, chico dentro del arco
  const t = Math.min(Math.max((ay - 5000) / 200, 0), 1);
  const rf = R + (RG - R) * t * t * (3 - 2 * t);
  return cmin(walls, z, rf);
}

export function arenaDistanceV(p: V3) { return arenaDistance(p.x, p.y, p.z); }

/** Normal (gradiente normalizado) apuntando hacia el interior jugable. */
export function arenaNormal(x: number, y: number, z: number, out = new V3()): V3 {
  const e = 0.75;
  const nx = arenaDistance(x + e, y, z) - arenaDistance(x - e, y, z);
  const ny = arenaDistance(x, y + e, z) - arenaDistance(x, y - e, z);
  const nz = arenaDistance(x, y, z + e) - arenaDistance(x, y, z - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  return out.set(nx / l, ny / l, nz / l);
}

export function arenaNormalV(p: V3) { return arenaNormal(p.x, p.y, p.z); }

export interface RayHit { t: number; point: V3; normal: V3 }

/** Sphere tracing desde origin en dirección dir (unitaria). */
export function arenaRaycast(origin: V3, dir: V3, maxDist: number): RayHit | null {
  let t = 0;
  for (let i = 0; i < 32; i++) {
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    const d = arenaDistance(px, py, pz);
    if (d < 0.05) {
      const point = new V3(px, py, pz);
      return { t, point, normal: arenaNormal(px, py, pz) };
    }
    t += Math.max(d, 0.05);
    if (t > maxDist) return null;
  }
  return null;
}

/** ¿El punto está dentro de un arco? Devuelve el equipo dueño del arco (0 azul en -Y, 1 rojo en +Y) o -1. */
export function goalOwnerAt(p: V3, radius: number): number {
  if (p.y < -(ARENA.GOAL_LINE + radius)) return 0;
  if (p.y > ARENA.GOAL_LINE + radius) return 1;
  return -1;
}
