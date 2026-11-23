// Predicción de la pelota compartida por todos los bots.
// Usa exactamente la misma física de la pelota que la simulación (rebotes en rampas, paredes y techo).

import { goalOwnerAt } from '../sim/arena.ts';
import { Ball, stepBall } from '../sim/ball.ts';
import { BALL, DT } from '../sim/constants.ts';
import { V3 } from '../sim/math.ts';
import type { World } from '../sim/world.ts';

export interface Slice { t: number; pos: V3; vel: V3 }

/** Paso entre muestras (s) y horizonte de predicción (s). */
export const SLICE_DT = 1 / 60;
export const HORIZON = 4;

export class BallPredictor {
  slices: Slice[] = [];
  /** Primer instante (s) en que la pelota entraría en el arco de cada equipo (Infinity si no entra). */
  goalTime: [number, number] = [Infinity, Infinity];
  private lastTick = -100;
  private lastWorld: World | null = null;

  update(world: World) {
    if (world === this.lastWorld && world.tick - this.lastTick < 3 && this.slices.length) return;
    this.lastWorld = world;
    this.lastTick = world.tick;
    const b: Ball = world.ball.clone();
    const frozen = world.ball.frozen || world.ball.hidden;
    const perSlice = Math.round(SLICE_DT / DT);
    const n = Math.round(HORIZON / SLICE_DT);
    if (this.slices.length !== n) this.slices = Array.from({ length: n }, (_, i) => ({ t: (i + 1) * SLICE_DT, pos: new V3(), vel: new V3() }));
    this.goalTime = [Infinity, Infinity];
    let scored = false;
    for (let i = 0; i < n; i++) {
      if (!frozen && !scored) for (let k = 0; k < perSlice; k++) stepBall(b, DT);
      const s = this.slices[i];
      s.pos.copy(b.pos);
      s.vel.copy(b.vel);
      if (!scored) {
        const owner = goalOwnerAt(b.pos, BALL.RADIUS);
        if (owner >= 0) { this.goalTime[owner] = s.t; scored = true; }
      }
    }
  }

  /** Muestra más cercana a un tiempo dado. */
  at(t: number): Slice {
    const i = Math.max(0, Math.min(this.slices.length - 1, Math.round(t / SLICE_DT) - 1));
    return this.slices[i];
  }
}
