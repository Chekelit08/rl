// Coordinador de los modos extra: entrenamiento, juego libre extendido (rebobinar, congelar/lanzar pelota,
// turbo infinito), grabación de partidos y clips, biblioteca y visor de repeticiones, editor de tiros.
// main.ts lo llama desde unos pocos ganchos (inicio de mundo, antes/después de cada tick, eventos, UI y menús).

import './extras.css';
import type { UiActions } from '../input/input.ts';
import { readHud, type ReplayGoal, type ReplayMeta, newId } from '../replay/format.ts';
import { isTyping } from '../replay/freecam.ts';
import { ReplayLibrary } from '../replay/library.ts';
import { ClipBuffer, hudOf, MatchRecorder } from '../replay/recorder.ts';
import { loadReplay, saveReplay, updateMeta } from '../replay/store.ts';
import { ReplayViewer } from '../replay/viewer.ts';
import { type CarInput, emptyInput } from '../sim/car.ts';
import { DT } from '../sim/constants.ts';
import { V3 } from '../sim/math.ts';
import type { GameEvent, MatchConfig, Snapshot } from '../sim/world.ts';
import { saveBest } from './codes.ts';
import { button, el } from './dom.ts';
import { ShotEditor } from './editor.ts';
import type { GameHost } from './host.ts';
import { ExtrasHud } from './hud.ts';
import { TrainingMenu } from './menu.ts';
import { aimAt } from './packs.ts';
import { insideField, type ShotResult, TrainingSession } from './session.ts';
import type { Pack } from './types.ts';
import { restoreWorld, RewindBuffer } from './worldState.ts';

type Mode = 'none' | 'match' | 'freeplay' | 'training';

/** Pantalla propia que toma el control del cuadro (visor, editor). */
export interface ExtScreen {
  readonly kind: 'visor' | 'editor';
  frame(dt: number): void;
  handleUi(ui: UiActions): void;
  dispose(): void;
}

export interface TrainingOptions { variance: boolean; unlimitedBoost: boolean }
const OPTS_KEY = 'turbogol.training.opts';
const LAUNCH_SPEEDS = [1200, 1800, 2400, 3000];

type SessionState = ReturnType<TrainingSession['saveState']>;

export class Extras {
  readonly g: GameHost;
  mode: Mode = 'none';
  session: TrainingSession | null = null;
  testing = false;
  opts: TrainingOptions = { variance: false, unlimitedBoost: false };
  launchSpeed = LAUNCH_SPEEDS[1];

  private pending: { pack: Pack; index: number; testing: boolean } | null = null;
  private quietWorld = false;
  private draft: { pack: Pack; index: number } | null = null;
  private rewind = new RewindBuffer(5, 2);
  private rewinding = false;
  private clips = new ClipBuffer(15, 60);
  private recorder: MatchRecorder | null = null;
  private rec = { id: '', manual: false, endTicks: -1, saved: null as ReplayMeta | null, label: '' };
  private modeLabel = '';
  private screen: ExtScreen | null = null;
  private overlayUi: { close(): void } | null = null;
  private hud = new ExtrasHud();
  private keys = new Set<string>();
  private padPrev: boolean[] = [];
  private padRewind = false;
  private lastLoads = -1;
  private freeze: V3 | null = null;
  private touch = { tick: -1, kmh: 0 };
  private lastFrame = performance.now();
  private pauseKey = '';
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private endBox: HTMLDivElement | null = null;
  private doneBox: HTMLDivElement | null = null;

  constructor(host: GameHost) {
    this.g = host;
    try {
      const raw = localStorage.getItem(OPTS_KEY);
      if (raw) this.opts = { ...this.opts, ...JSON.parse(raw) };
    } catch { /* sin almacenamiento */ }
    this.toastEl = el('div', 'tg-toast hidden');
    document.body.appendChild(this.toastEl);
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  saveOpts() {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(this.opts)); } catch { /* ignorar */ }
  }

  // ---------- Ganchos llamados desde main.ts ----------

  /** Al crear un mundo nuevo (antes de tomar el primer snapshot). */
  /** El próximo mundo no es juego libre ni entrenamiento (por ejemplo un desafío): sin HUD ni atajos de juego libre. */
  quietNext() { this.quietWorld = true; }

  onWorldStart(cfg: MatchConfig, attract: boolean) {
    if (this.recorder && this.rec.endTicks >= 0) void this.finishRecording();
    this.recorder = null;
    this.rec = { id: '', manual: false, endTicks: -1, saved: null, label: '' };
    this.endBox?.remove();
    this.endBox = null;
    this.doneBox?.remove();
    this.doneBox = null;
    this.session = null;
    this.freeze = null;
    this.rewind.clear();
    this.rewinding = false;
    this.touch = { tick: -1, kmh: 0 };
    const w = this.g.world;
    if (attract || this.quietWorld) {
      this.mode = 'none';
      this.testing = false;
      this.pending = null;
      this.quietWorld = false;
      this.hud.hide();
      this.syncBody();
      return;
    }
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.mode = 'training';
      this.testing = p.testing;
      const s = new TrainingSession(w, p.pack, { variance: this.opts.variance, unlimitedBoost: this.opts.unlimitedBoost, autoAdvance: true });
      if (p.index) s.load(p.index);
      s.onResult = (r) => this.onShotResult(r);
      this.session = s;
      this.lastLoads = s.loads;
      this.modeLabel = `Entrenamiento · ${p.pack.name}`;
    } else if (cfg.mode === 'match') {
      this.mode = 'match';
      this.testing = false;
      this.modeLabel = `${cfg.teamSize}v${cfg.teamSize}`;
      this.recorder = new MatchRecorder(w);
      this.rec.id = newId();
      this.rec.label = this.modeLabel;
    } else {
      this.mode = 'freeplay';
      this.testing = false;
      this.modeLabel = 'Juego libre';
    }
    this.clips.reset(w, this.modeLabel);
    this.syncBody();
  }

  /** Antes de cada tick. Devuelve true si el tick no debe simularse (rebobinando). */
  beforeStep(inputs: CarInput[]): boolean {
    if (this.mode === 'none' || this.mode === 'match' || this.g.state !== 'playing') return false;
    const w = this.g.world;
    if (this.rewindHeld() && (this.rewinding || this.rewind.length > 1)) {
      if (!this.rewinding) { this.rewind.begin(); this.rewinding = true; }
      const s = this.rewind.back(1);
      if (s) {
        restoreWorld(w, s);
        if (this.session && s.extra) this.session.loadState(s.extra as SessionState);
      }
      this.freeze = null;
      return true;
    }
    if (this.rewinding) {
      this.rewinding = false;
      const s = this.rewind.end();
      if (s) {
        restoreWorld(w, s);
        if (this.session && s.extra) this.session.loadState(s.extra as SessionState);
      }
    }
    if (this.freeze) {
      w.ball.pos.copy(this.freeze);
      w.ball.vel.set(0, 0, 0);
      w.ball.ang.set(0, 0, 0);
    }
    this.session?.beforeTick(inputs[0] ?? emptyInput());
    return false;
  }

  /** Después de cada tick (y de procesar sus eventos). */
  afterStep(snap: Snapshot) {
    if (this.mode === 'none') return;
    const w = this.g.world;
    const st = this.g.state;
    if (this.recorder && (st === 'playing' || st === 'ended')) {
      this.recorder.push(snap, w);
      if (w.phase === 'ended') {
        if (this.rec.endTicks < 0) { this.rec.endTicks = 300; this.addEndButtons(); }
        else if (--this.rec.endTicks <= 0) void this.finishRecording();
      }
    }
    this.clips.push(snap, w);
    if (this.mode === 'match') return;
    if (this.session) {
      this.session.afterTick(DT);
      if (this.session.loads !== this.lastLoads) {
        this.lastLoads = this.session.loads;
        this.rewind.clear();
        this.g.renderer.camCtl.snapTo();
      }
      if (this.session.phase === 'terminado' && !this.doneBox) this.showDone();
    }
    // Último toque del jugador: velocidad máxima de la pelota en los 12 ticks siguientes
    const lt = w.lastTouches[w.lastTouches.length - 1];
    if (lt && lt.carId === 0 && lt.tick === w.tick) {
      if (this.freeze) this.freeze = null;
      if (this.touch.tick < 0 || w.tick - this.touch.tick > 12) this.touch = { tick: w.tick, kmh: 0 };
    }
    if (this.touch.tick >= 0 && w.tick - this.touch.tick <= 12) this.touch.kmh = Math.max(this.touch.kmh, w.ball.vel.len() * 0.036);
    this.rewind.push(w, this.session?.saveState());
  }

  onEvent(ev: GameEvent) {
    if (this.mode === 'training') this.session?.onEvent(ev);
  }

  /** Acciones de UI del cuadro (se llama antes de que el juego las procese; puede consumirlas). */
  handleUi(ui: UiActions) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.pollPad();
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.add('hidden');
    }
    const st = this.g.state;
    if (st === 'ext') {
      this.screen?.handleUi(ui);
      ui.pause = false;
      ui.saveClip = false;
      ui.reset = false;
      ui.help = false;
      ui.ballCamToggle = false;
      return;
    }
    if (this.overlayUi && ui.pause && st === 'menu') {
      ui.pause = false;
      this.backToMenu();
    }
    if (ui.saveClip) {
      ui.saveClip = false;
      if (st === 'playing' || st === 'replay' || st === 'ended') void this.saveClip();
    }
    if (ui.reset && st === 'playing') {
      if (this.session) { ui.reset = false; this.session.retry(); this.freeze = null; }
      else if (this.mode === 'freeplay') { this.freeze = null; this.rewind.clear(); this.g.renderer.camCtl.snapTo(); }
    }
    this.updateHud(dt);
    this.syncPause();
  }

  /** "Reiniciar" del menú de pausa. true = lo resolvió este módulo. */
  restart(): boolean {
    if (this.mode !== 'training' || !this.session) return false;
    this.startTraining(this.session.pack, 0, this.testing);
    return true;
  }

  /** Acciones de botones del menú principal (data-act). */
  action(act: string | undefined): boolean {
    if (act === 'training') { this.openTrainingMenu(); return true; }
    if (act === 'replays') { this.openLibrary('partido'); return true; }
    return false;
  }

  /** El cuadro en el estado 'ext' (pantallas propias). */
  frame(dt: number) {
    if (this.screen) this.screen.frame(dt);
    else this.g.renderer.render(this.g.curSnap, dt, 'custom');
  }

  // ---------- Entrenamiento ----------

  startTraining(pack: Pack, index = 0, testing = false) {
    this.closeOverlay();
    this.exitScreen(false);
    this.pending = { pack, index, testing };
    if (testing) this.draft = { pack, index };
    this.g.audio.start();
    this.g.startWorld({ mode: 'freeplay', teamSize: 1, duration: 300, unlimitedBoost: this.opts.unlimitedBoost, seed: Math.floor(Math.random() * 1e9) }, 1);
    this.g.showOnly(null);
    document.getElementById('hud')?.classList.remove('hidden');
    this.g.state = 'playing';
  }

  private onShotResult(r: ShotResult) {
    const s = this.session;
    if (!s) return;
    if (r === 'acierto') {
      saveBest(s.pack.id, s.hits);
      this.hud.showBanner(s.pack.category === 'arquero' ? '¡ATAJADA!' : '¡ACIERTO!', 'ok');
      if (s.pack.category === 'arquero') this.g.audio.pad(true);
    } else {
      this.hud.showBanner(s.pack.category === 'arquero' ? 'TE LA METIERON' : 'FALLASTE', 'bad');
      this.g.audio.bump();
    }
  }

  private nextShot(dir: 1 | -1) {
    if (!this.session || this.g.state !== 'playing') return;
    if (dir > 0) this.session.next(); else this.session.prev();
    this.freeze = null;
  }

  private showDone() {
    const s = this.session!;
    saveBest(s.pack.id, s.hits);
    this.g.state = 'paused';
    const box = el('div', 'overlay tg-overlay');
    const panel = el('div', 'panel narrow tg-panel');
    panel.append(el('h2', '', '¡Pack terminado!'), el('div', 'tg-donescore', `${s.hits}<small>/${s.total}</small>`), el('p', 'tip', `${s.attempts} intentos en total.`));
    const actions = el('div', 'menu-buttons');
    actions.append(
      button('Repetir pack', 'btn primary', () => { this.g.audio.click(); this.startTraining(s.pack, 0, this.testing); }),
      ...(this.testing && this.draft ? [button('Volver al editor', 'btn', () => this.openEditor(this.draft!.pack, s.index))] : []),
      button('Elegir otro pack', 'btn', () => { this.g.audio.click(); this.g.quit(); this.openTrainingMenu(); }),
      button('Menú principal', 'btn', () => { this.g.audio.click(); this.g.quit(); }),
    );
    panel.appendChild(actions);
    box.appendChild(panel);
    document.body.appendChild(box);
    this.doneBox = box;
  }

  // ---------- Juego libre ----------

  toggleFreeze() {
    const b = this.g.world.ball;
    if (this.freeze) { this.freeze = null; this.toast('Pelota liberada'); }
    else if (!b.hidden) { this.freeze = b.pos.clone(); this.toast('Pelota congelada: tocala para soltarla'); }
  }

  /** Lanza la pelota hacia el auto (si está muy cerca, primero la aleja hacia adelante). */
  launchBall() {
    const w = this.g.world;
    const car = w.cars[0], b = w.ball;
    if (!car || b.hidden) return;
    this.freeze = null;
    const fwd = car.q.rotate(new V3(1, 0, 0));
    const fh = Math.hypot(fwd.x, fwd.y) || 1;
    const fx = fwd.x / fh, fy = fwd.y / fh;
    if (b.pos.dist(car.pos) < 1400) {
      let d = 2600;
      let x = car.pos.x + fx * d, y = car.pos.y + fy * d;
      while (!insideField(x, y) && d > 600) { d -= 200; x = car.pos.x + fx * d; y = car.pos.y + fy * d; }
      if (!insideField(x, y)) { x = 0; y = 0; }
      b.reset(x, y);
      b.pos.z = 320;
    }
    const target: [number, number, number] = [car.pos.x + fx * 350, car.pos.y + fy * 350, 260];
    const v = aimAt([b.pos.x, b.pos.y, b.pos.z], target, this.launchSpeed);
    b.vel.set(v[0], v[1], v[2]);
    b.ang.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    b.frozen = false;
  }

  toggleUnlimited() {
    const car = this.g.world.cars[0];
    if (!car) return;
    car.unlimitedBoost = !car.unlimitedBoost;
    if (car.unlimitedBoost) car.boost = 100;
    if (this.session) { this.opts.unlimitedBoost = car.unlimitedBoost; this.saveOpts(); }
    this.toast(car.unlimitedBoost ? 'Turbo infinito: sí' : 'Turbo infinito: no');
  }

  cycleLaunchSpeed() {
    const i = LAUNCH_SPEEDS.indexOf(this.launchSpeed);
    this.launchSpeed = LAUNCH_SPEEDS[(i + 1) % LAUNCH_SPEEDS.length];
  }

  // ---------- Teclas y mando propios ----------

  private rewindHeld() {
    return this.keys.has('KeyZ') || this.keys.has('Backspace') || this.padRewind;
  }

  private onKey(e: KeyboardEvent) {
    if (isTyping(e)) return;
    if (e.code === 'Backspace' && this.mode !== 'none') e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (this.g.state !== 'playing') return;
    if (this.mode === 'training') {
      if (e.code === 'KeyN' || e.code === 'Period') this.nextShot(1);
      if (e.code === 'KeyB' || e.code === 'Comma') this.nextShot(-1);
    }
    if (this.mode === 'freeplay' || this.mode === 'training') {
      if (e.code === 'KeyI') this.toggleUnlimited();
    }
    if (this.mode === 'freeplay') {
      if (e.code === 'KeyF') this.toggleFreeze();
      if (e.code === 'KeyV') this.launchBall();
    }
  }

  private pollPad() {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!gp) { this.padRewind = false; return; }
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    const just = (i: number) => b(i) && !this.padPrev[i];
    this.padRewind = b(8) && this.mode !== 'match';
    if (this.g.state === 'playing') {
      if (this.mode === 'training') {
        if (just(15)) this.nextShot(1);
        if (just(14)) this.nextShot(-1);
      } else if (this.mode === 'freeplay') {
        if (just(14)) this.toggleFreeze();
        if (just(15)) this.launchBall();
      }
    }
    this.padPrev = gp.buttons.map((x) => x.pressed);
  }

  // ---------- HUD y menú de pausa ----------

  private syncBody() {
    const cl = document.body.classList;
    cl.toggle('tg-training', this.mode === 'training');
    cl.toggle('tg-freeplay', this.mode === 'freeplay');
  }

  private updateHud(dt: number) {
    this.hud.tick(dt);
    const st = this.g.state;
    if (this.mode === 'none' || this.mode === 'match' || (st !== 'playing' && st !== 'paused')) { this.hud.hide(); return; }
    this.hud.setRewind(this.rewinding, this.rewind.progress());
    if (this.session) this.hud.training(this.session, this.testing);
    else {
      const w = this.g.world;
      this.hud.freeplay({
        ballKmh: w.ball.hidden ? 0 : w.ball.vel.len() * 0.036,
        touchKmh: this.touch.kmh,
        frozen: !!this.freeze,
        unlimited: !!w.cars[0]?.unlimitedBoost,
        launchKmh: Math.round(this.launchSpeed * 0.036),
      });
    }
  }

  /** Botones extra en el menú de pausa según el modo. */
  private syncPause() {
    const pause = document.getElementById('pause');
    const visible = this.g.state === 'paused' && pause && !pause.classList.contains('hidden');
    let box = document.getElementById('tg-pause-extra');
    if (!visible || this.mode === 'none') { box?.remove(); this.pauseKey = ''; return; }
    const w = this.g.world;
    const key = `${this.mode}|${this.testing}|${this.opts.variance}|${!!w.cars[0]?.unlimitedBoost}|${!!this.freeze}|${this.launchSpeed}`;
    if (box && key === this.pauseKey) return;
    this.pauseKey = key;
    box?.remove();
    box = el('div', 'tg-pause-extra');
    box.id = 'tg-pause-extra';
    const resume = () => { this.g.state = 'playing'; this.g.showOnly(null); };
    const add = (label: string, fn: () => void, cls = 'btn') => box!.appendChild(button(label, cls, () => { this.g.audio.click(); fn(); this.pauseKey = ''; }));
    if (this.mode === 'training' && this.session) {
      if (this.testing && this.draft) add('Volver al editor', () => this.openEditor(this.draft!.pack, this.session?.index ?? 0), 'btn primary');
      add('Siguiente tiro', () => { this.session?.next(); resume(); });
      add(`Variación leve: ${this.opts.variance ? 'Sí' : 'No'}`, () => { this.opts.variance = !this.opts.variance; this.session!.opts.variance = this.opts.variance; this.saveOpts(); });
      add(`Turbo infinito: ${w.cars[0]?.unlimitedBoost ? 'Sí' : 'No'}`, () => this.toggleUnlimited());
      add('Cambiar de pack', () => { this.g.quit(); this.openTrainingMenu(); });
    } else if (this.mode === 'freeplay') {
      add(`Turbo infinito: ${w.cars[0]?.unlimitedBoost ? 'Sí' : 'No'}`, () => this.toggleUnlimited());
      add(this.freeze ? 'Soltar pelota' : 'Congelar pelota', () => { this.toggleFreeze(); resume(); });
      add('Lanzar pelota', () => { resume(); this.launchBall(); });
      add(`Velocidad de la pelota: ${Math.round(this.launchSpeed * 0.036)} km/h`, () => this.cycleLaunchSpeed());
    } else if (this.mode === 'match') {
      add('Guardar repetición', () => void this.saveMatchNow());
    }
    const first = pause!.querySelector('.menu-buttons');
    first?.insertBefore(box, first.children[1] ?? null);
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = 2.6;
  }

  // ---------- Grabación ----------

  private matchMeta(rec: MatchRecorder, saved: boolean): ReplayMeta {
    const w = this.g.world;
    const hud = hudOf(w);
    return {
      id: this.rec.id,
      kind: 'partido',
      title: `${this.rec.label} · ${hud.score[0]}–${hud.score[1]}`,
      date: Date.now(),
      mode: this.rec.label,
      fps: rec.fps,
      frames: rec.frames,
      nCars: rec.nCars,
      nPads: rec.nPads,
      duration: rec.frames / rec.fps,
      score: hud.score,
      winner: w.phase === 'ended' ? w.winner : -2,
      cars: rec.cars,
      goals: [...rec.goals],
      saved,
      version: 1,
    };
  }

  /** Cierra la grabación del partido y la guarda (automática al terminar). */
  private async finishRecording() {
    const rec = this.recorder;
    if (!rec) return;
    this.recorder = null;
    const meta = this.matchMeta(rec, this.rec.manual);
    this.rec.saved = meta;
    try {
      await saveReplay(meta, rec.finish());
    } catch {
      this.toast('No se pudo guardar la repetición');
    }
  }

  /** "Guardar repetición" (pausa o fin del partido): la conserva aunque haya muchas. */
  async saveMatchNow() {
    this.rec.manual = true;
    if (this.recorder) {
      const meta = this.matchMeta(this.recorder, true);
      this.rec.saved = meta;
      try { await saveReplay(meta, this.recorder.finish()); } catch { this.toast('No se pudo guardar la repetición'); return; }
    } else if (this.rec.saved) {
      this.rec.saved = { ...this.rec.saved, saved: true };
      await updateMeta(this.rec.saved);
    } else return;
    this.toast('Repetición guardada · Menú › Repeticiones');
  }

  /** Botones de repetición para el resumen de fin de partido (los ubica src/ui/postmatch.ts). */
  endButtons(): HTMLElement | null { return this.endBox; }

  private addEndButtons() {
    if (this.endBox) return;
    const box = el('div', 'tg-endbtns lead');
    box.append(
      button('Guardar repetición', 'btn', () => { this.g.audio.click(); void this.saveMatchNow(); }),
      button('Ver repetición', 'btn', async () => {
        this.g.audio.click();
        if (this.recorder) await this.finishRecording();
        if (this.rec.saved) void this.openViewer(this.rec.saved.id);
      }),
    );
    this.endBox = box;
    // Si el resumen ya está en pantalla se suman ahí; si no, los toma cuando se abre
    document.querySelector('#end .actions')?.prepend(box);
  }

  async saveClip() {
    const w = this.g.world;
    if (this.mode === 'none' || this.clips.frames < 30) { this.toast('Todavía no hay una jugada para guardar'); return; }
    const frames = this.clips.snapshot();
    const n = this.clips.frames;
    const info = { nCars: this.clips.nCars, nPads: this.clips.nPads };
    const goals: ReplayGoal[] = [];
    let prev = readHud(frames, 0, info).score;
    for (let i = 1; i < n; i++) {
      const s = readHud(frames, i, info).score;
      if (s[0] !== prev[0] || s[1] !== prev[1]) {
        const team = s[0] !== prev[0] ? 0 : 1;
        const lg = w.lastGoal;
        const scorer = lg && lg.team === team && lg.scorerId >= 0 ? w.cars[lg.scorerId]?.name ?? '' : '';
        goals.push({ t: i / this.clips.fps, team, scorer });
      }
      prev = s;
    }
    const last = readHud(frames, n - 1, info);
    const g = goals[goals.length - 1];
    const meta: ReplayMeta = {
      id: newId(),
      kind: 'clip',
      title: g ? `Gol${g.scorer ? ' de ' + g.scorer : ''} · ${this.modeLabel}` : `Jugada · ${this.modeLabel}`,
      date: Date.now(),
      mode: this.modeLabel,
      fps: this.clips.fps,
      frames: n,
      nCars: this.clips.nCars,
      nPads: this.clips.nPads,
      duration: n / this.clips.fps,
      score: last.score,
      winner: -2,
      cars: this.clips.cars,
      goals,
      saved: false,
      version: 1,
    };
    this.toast(`Clip guardado: últimos ${Math.round(meta.duration)} s · Menú › Repeticiones`);
    try { await saveReplay(meta, frames); } catch { this.toast('No se pudo guardar el clip'); }
  }

  // ---------- Pantallas y menús propios ----------

  closeOverlay() {
    const o = this.overlayUi;
    this.overlayUi = null;
    o?.close();
  }

  /** Vuelve al menú principal desde un menú propio. */
  backToMenu() {
    this.closeOverlay();
    this.g.showOnly('menu');
  }

  openTrainingMenu() {
    this.closeOverlay();
    this.g.showOnly(null);
    this.overlayUi = new TrainingMenu(this);
  }

  openLibrary(tab: 'partido' | 'clip' = 'partido') {
    this.closeOverlay();
    this.g.showOnly(null);
    this.overlayUi = new ReplayLibrary(this, tab);
  }

  private enterScreen(make: () => ExtScreen) {
    this.closeOverlay();
    this.exitScreen(false);
    this.doneBox?.remove();
    this.doneBox = null;
    this.g.showOnly(null);
    document.getElementById('hud')?.classList.add('hidden');
    this.hud.hide();
    this.g.state = 'ext';
    this.screen = make();
  }

  /** Cierra la pantalla propia; si `toMenu`, vuelve al mundo de fondo del menú. */
  exitScreen(toMenu = true) {
    const s = this.screen;
    this.screen = null;
    s?.dispose();
    if (toMenu && this.g.state === 'ext') this.g.quit();
  }

  async openViewer(id: string, exportNow = false) {
    const data = await loadReplay(id);
    if (!data) { this.toast('No se encontró la repetición'); return; }
    this.enterScreen(() => new ReplayViewer(this.g, data, {
      exportNow,
      onClose: () => { this.exitScreen(); this.openLibrary(data.meta.kind); },
      toast: (t) => this.toast(t),
    }));
  }

  openEditor(pack: Pack, index = 0) {
    this.draft = { pack, index };
    this.quietWorld = true;
    this.g.startWorld({ mode: 'freeplay', teamSize: 1, duration: 300, unlimitedBoost: true, seed: 1 }, 1);
    this.enterScreen(() => new ShotEditor(this, pack, index));
  }

  /** Sale del editor al menú de entrenamiento. */
  closeEditor() {
    this.draft = null;
    this.exitScreen();
    this.openTrainingMenu();
  }

  /** Para pruebas automáticas. */
  get debug() {
    return { mode: this.mode, rewinding: this.rewinding, rewindLen: this.rewind.length, clipFrames: this.clips.frames, recFrames: this.recorder?.frames ?? 0, screen: this.screen?.kind ?? '', freeze: !!this.freeze };
  }
}
