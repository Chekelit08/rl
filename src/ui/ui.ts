// Gestor de la interfaz de W5: Garage, Competitivo, Perfil, Reasignar controles, post-partido, puntos y chat rápido.
// main.ts sólo crea un UiManager y le delega aperturas, eventos y el final del partido.

import './ui.css';
import type { InputManager } from '../input/input.ts';
import { unlocked } from '../progression/progression.ts';
import type { Playlist } from '../progression/ranked.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { Garage } from './garage.ts';
import { PostMatch } from './postmatch.ts';
import { PointsFeed } from './points.ts';
import { QuickChat } from './quickchat.ts';
import { ProfileScreen, RankedScreen, RemapScreen } from './screens.ts';

export interface UiHost {
  /** Muestra una pantalla del juego base (o ninguna). */
  showMain(id: string | null): void;
  startRanked(p: Playlist): void;
  input: InputManager;
  renderer: GameRenderer;
  chatCars(): { id: number; team: number; name: string; isBot: boolean }[];
}

export type ScreenName = 'garage' | 'ranked' | 'profile' | 'remap';

export class UiManager {
  garage: Garage;
  ranked: RankedScreen;
  profile: ProfileScreen;
  remap: RemapScreen;
  post = new PostMatch();
  points: PointsFeed;
  chat: QuickChat;
  current: ScreenName | null = null;
  private escAt = -1e9;

  constructor(private host: UiHost, hud: HTMLElement) {
    this.garage = new Garage(host.renderer);
    this.ranked = new RankedScreen((p) => { this.closeAll(); host.startRanked(p); });
    this.profile = new ProfileScreen((u) => unlocked(u));
    this.remap = new RemapScreen(host.input);
    this.points = new PointsFeed(hud);
    this.chat = new QuickChat(hud, () => host.chatCars());
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-ui="back"]')) this.back();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.current && !host.input.capturing) { e.preventDefault(); this.escAt = performance.now(); this.back(); }
    });
  }

  /** true si este Esc ya cerró una pantalla de W5 (para que main no lo tome también como pausa). */
  consumeEsc(): boolean {
    const v = performance.now() - this.escAt < 600;
    this.escAt = -1e9;
    return v;
  }

  private screens(): Record<ScreenName, { el: HTMLElement; render?: () => void }> {
    return { garage: this.garage as never, ranked: this.ranked, profile: this.profile, remap: this.remap };
  }

  open(name: ScreenName) {
    this.closeAll();
    this.host.showMain(null);
    this.current = name;
    if (name === 'garage') { this.garage.open(); return; }
    const s = this.screens()[name];
    s.render?.();
    s.el.classList.remove('hidden');
  }

  closeAll() {
    if (this.current === 'garage') this.garage.close();
    if (this.current === 'remap') this.remap.close();
    for (const s of Object.values(this.screens())) s.el.classList.add('hidden');
    this.current = null;
    this.post.hide();
  }

  back() {
    const was = this.current;
    this.closeAll();
    this.host.showMain(was === 'remap' ? 'controls' : 'menu');
  }
}
