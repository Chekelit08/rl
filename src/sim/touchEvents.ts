// Clasificación de toques para el puntaje estilo competitivo: primer toque, despeje, centro, toque aéreo y atajada épica.
// Lo usa World.onTouch; vive aparte para no mezclarlo con la física.

import type { Car } from './car.ts';
import type { V3 } from './math.ts';

export type TouchFeat = 'firsttouch' | 'clear' | 'center' | 'aerialhit';

export const FEAT_POINTS: Record<TouchFeat, number> = { firsttouch: 10, clear: 20, center: 10, aerialhit: 10 };
export const EPIC_SAVE_BONUS = 25; // la atajada épica vale 75 (50 + 25)

const lastFeat = new WeakMap<Car, Map<TouchFeat, number>>();

function cooled(c: Car, f: TouchFeat, tick: number, ticks: number): boolean {
  let m = lastFeat.get(c);
  if (!m) { m = new Map(); lastFeat.set(c, m); }
  const t = m.get(f);
  if (t !== undefined && tick - t < ticks && tick >= t) return false;
  m.set(f, tick);
  return true;
}

/**
 * Devuelve las "hazañas" de un toque. ballPos es la posición al momento del toque;
 * pre/post son la velocidad de la pelota antes y después del golpe.
 */
export function classifyTouch(c: Car, ballPos: V3, pre: V3, post: V3, tick: number, kickoffTouched: boolean, isSave: boolean, isMatch: boolean): TouchFeat[] {
  const feats: TouchFeat[] = [];
  if (!isMatch) return feats;
  const dir = c.team === 0 ? 1 : -1; // hacia dónde ataca este auto
  const yRel = ballPos.y * dir; // > 0: mitad rival
  if (!kickoffTouched) feats.push('firsttouch');
  // Despeje: desde el tercio defensivo propio, la saca con fuerza hacia adelante
  if (!isSave && yRel < -1700 && post.y * dir > 900 && post.y * dir > pre.y * dir + 300 && cooled(c, 'clear', tick, 240)) feats.push('clear');
  // Centro: desde un costado del tercio ofensivo hacia el medio, frente al arco rival
  if (yRel > 2200 && Math.abs(ballPos.x) > 1300 && post.x * ballPos.x < 0 && Math.abs(post.x) > 600) {
    const t = Math.abs(ballPos.x / post.x);
    const yAt = (ballPos.y + post.y * t) * dir;
    if (t < 2.2 && yAt > 3000 && cooled(c, 'center', tick, 240)) feats.push('center');
  }
  // Toque aéreo
  if (!c.onGround && ballPos.z > 450 && cooled(c, 'aerialhit', tick, 120)) feats.push('aerialhit');
  return feats;
}

export function isEpicSave(c: Car, ballPos: V3, pre: V3): boolean {
  return pre.len() > 2400 || (!c.onGround && ballPos.z > 320);
}
