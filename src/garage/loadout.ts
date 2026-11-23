// Loadout del jugador (persistente) y "looks" de los autos (jugador y bots).

import { SECONDARY_COLORS, TEAM_PAINTS } from '../render/palette.ts';
import { DECALS, type DecalId, EXPLOSIONS, type ExplosionId, type Finish, FINISHES, TRAILS, type TrailId, WHEELS, type WheelId } from './cosmetics.ts';

export interface Loadout {
  body: number;
  /** Índice de pintura dentro de TEAM_PAINTS[equipo]. */
  paint: [number, number];
  secondary: number;
  finish: Finish;
  decal: DecalId;
  decalNumber: number;
  wheel: WheelId;
  trail: TrailId;
  explosion: ExplosionId;
  title: string;
  banner: string;
}

/** Lo que el render necesita para dibujar un auto. */
export interface CarLook {
  paint: string;
  secondary: string;
  finish: Finish;
  decal: DecalId;
  decalNumber: number;
  wheel: WheelId;
  trail: TrailId;
  explosion: ExplosionId;
}

export const DEFAULT_LOADOUT: Loadout = {
  body: 0, paint: [0, 0], secondary: 0, finish: 'brillante', decal: 'franjas', decalNumber: 7,
  wheel: 'rayos6', trail: 'clasica', explosion: 'clasica', title: 'novato', banner: 'noche',
};

const KEY = 'turbogol.loadout';
let cached: Loadout | null = null;
const listeners = new Set<(l: Loadout) => void>();

export function getLoadout(): Loadout {
  if (cached) return cached;
  let l: Loadout = structuredClone(DEFAULT_LOADOUT);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) l = { ...l, ...JSON.parse(raw) };
  } catch { /* sin almacenamiento */ }
  // Saneamiento (por si cambia el catálogo)
  if (!FINISHES.some((f) => f.id === l.finish)) l.finish = DEFAULT_LOADOUT.finish;
  if (!DECALS.some((d) => d.id === l.decal)) l.decal = DEFAULT_LOADOUT.decal;
  if (!WHEELS.some((w) => w.id === l.wheel)) l.wheel = DEFAULT_LOADOUT.wheel;
  if (!TRAILS.some((t) => t.id === l.trail)) l.trail = DEFAULT_LOADOUT.trail;
  if (!EXPLOSIONS.some((e) => e.id === l.explosion)) l.explosion = DEFAULT_LOADOUT.explosion;
  l.body = Math.max(0, Math.min(5, l.body | 0));
  l.paint = [Math.max(0, Math.min(TEAM_PAINTS[0].length - 1, l.paint?.[0] | 0)), Math.max(0, Math.min(TEAM_PAINTS[1].length - 1, l.paint?.[1] | 0))];
  l.secondary = Math.max(0, Math.min(SECONDARY_COLORS.length - 1, l.secondary | 0));
  cached = l;
  return l;
}

export function setLoadout(patch: Partial<Loadout>) {
  const l = { ...getLoadout(), ...patch };
  cached = l;
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* ignorar */ }
  for (const fn of listeners) fn(l);
}

export function onLoadoutChange(fn: (l: Loadout) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function lookFromLoadout(l: Loadout, team: number): CarLook {
  return {
    paint: TEAM_PAINTS[team][l.paint[team]].hex,
    secondary: SECONDARY_COLORS[l.secondary].hex,
    finish: l.finish,
    decal: l.decal,
    decalNumber: l.decalNumber,
    wheel: l.wheel,
    trail: l.trail,
    explosion: l.explosion,
  };
}

/** Look determinista para un bot (variedad visual como en los partidos reales). */
export function botLook(seed: number, team: number): CarLook {
  let s = (seed * 2654435761) >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  return {
    paint: pick(TEAM_PAINTS[team]).hex,
    secondary: pick(SECONDARY_COLORS).hex,
    finish: pick(FINISHES).id,
    decal: pick(DECALS).id,
    decalNumber: 1 + Math.floor(r() * 99),
    wheel: pick(WHEELS).id,
    trail: pick(TRAILS).id,
    explosion: pick(EXPLOSIONS).id,
  };
}
