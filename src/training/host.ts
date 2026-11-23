// Lo que los modos extra (entrenamiento, juego libre extendido, repeticiones y clips) usan del juego principal.
// main.ts pasa la instancia de Game; se accede por esta interfaz para no acoplarse al resto de la clase.

import type { Difficulty } from '../ai/bot.ts';
import type { AudioEngine } from '../audio/audio.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { MatchConfig, Snapshot, World } from '../sim/world.ts';

export interface GameHost {
  world: World;
  renderer: GameRenderer;
  audio: AudioEngine;
  /** 'menu' | 'playing' | 'paused' | 'replay' | 'ended' | 'ext' (pantallas propias de este módulo). */
  state: string;
  settings: { bodyIndex: number };
  curSnap: Snapshot;
  prevSnap: Snapshot;
  startWorld(cfg: MatchConfig, difficulty: Difficulty, attract?: boolean): void;
  showOnly(id: string | null): void;
  quit(): void;
}
