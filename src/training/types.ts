// Tipos de entrenamiento: tiros y packs.

export type ShotCategory = 'delantero' | 'arquero' | 'aereo';
export type ShotDifficulty = 'novato' | 'intermedio' | 'pro';

export const CATEGORY_NAMES: Record<ShotCategory, string> = { delantero: 'Delantero', arquero: 'Arquero', aereo: 'Aéreo' };
export const DIFFICULTY_LABELS: Record<ShotDifficulty, string> = { novato: 'Novato', intermedio: 'Intermedio', pro: 'Pro' };
export const CATEGORIES: ShotCategory[] = ['delantero', 'arquero', 'aereo'];
export const DIFFICULTIES: ShotDifficulty[] = ['novato', 'intermedio', 'pro'];

export type V3t = [number, number, number];

export interface Shot {
  /** Pelota: posición, velocidad y giro (rad/s). */
  ball: { p: V3t; v: V3t; w?: V3t };
  /** Auto: posición, rumbo en grados (90 = mirando al arco rival), pitch/roll en grados, turbo inicial. */
  car: { p: V3t; yaw: number; pitch?: number; roll?: number; v?: V3t; boost?: number };
  /** Tiempo límite en segundos (por defecto según categoría). */
  time?: number;
  note?: string;
}

export interface Pack {
  id: string;
  name: string;
  category: ShotCategory;
  difficulty: ShotDifficulty;
  author: string;
  description?: string;
  shots: Shot[];
  official?: boolean;
  created: number;
}

export const DEFAULT_TIME: Record<ShotCategory, number> = { delantero: 8, arquero: 6, aereo: 7 };
