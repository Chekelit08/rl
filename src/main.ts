// TURBOGOL — bucle principal: física fija a 120 Hz, render interpolado, repetición de gol, menús y HUD.

import { normalizeQuality, QUALITY_LABELS, QUALITY_LEVELS, type QualityLevel } from './render/quality.ts';
import { BallPredictor, Bot, type Difficulty, DIFFICULTY_NAMES } from './ai/bot.ts';
import { AudioEngine, DEFAULT_MIX, type MixSettings } from './audio/audio.ts';
import { InputManager } from './input/input.ts';
import { CosmeticFx } from './garage/fxRender.ts';
import { botLook, getLoadout, lookFromLoadout, setLoadout } from './garage/loadout.ts';
import { getProfile, recordMatch, recordTier, type XpReport } from './progression/progression.ts';
import { bestTier, botDifficultyFor, getRanked, PLAYLISTS, recordRanked, type Playlist, type RankedOutcome } from './progression/ranked.ts';
import { pickMvp } from './ui/postmatch.ts';
import { pointsFor } from './ui/points.ts';
import { UiManager } from './ui/ui.ts';
import { DEFAULT_CAMERA, type CameraSettings } from './render/camera.ts';
import { GameRenderer } from './render/renderer.ts';
import type { Theme } from './render/stadium.ts';
import { OnlineMode } from './net/online.ts';
import { emptyInput, type CarInput } from './sim/car.ts';
import { CAR_BODIES, DT, TEAM_NAMES } from './sim/constants.ts';
import { Quat } from './sim/math.ts';
import { Extras } from './training/extras.ts';
import { type GameEvent, type MatchConfig, type Snapshot, World } from './sim/world.ts';
import { DEFAULT_RULES, isDefaultRules, makeRules, MUTATORS, type Rules } from './sim/rules.ts';
import { Challenges } from './challenges/challenges.ts';

// ---------- Ajustes persistentes ----------
interface Settings { camera: CameraSettings; volume: number; quality: QualityLevel; replays: boolean; bodyIndex: number; theme: Theme; mix: MixSettings }
const DEFAULTS: Settings = { camera: { ...DEFAULT_CAMERA }, volume: 0.7, quality: 'alta', replays: true, bodyIndex: 0, theme: 'dia', mix: { ...DEFAULT_MIX } };
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('turbogol.settings');
    if (raw) {
      const s = JSON.parse(raw);
      return { ...DEFAULTS, ...s, quality: normalizeQuality(s.quality), camera: { ...DEFAULT_CAMERA, ...(s.camera ?? {}) }, mix: { ...DEFAULT_MIX, ...(s.mix ?? {}) } };
    }
  } catch { /* almacenamiento no disponible */ }
  return structuredClone(DEFAULTS);
}
function saveSettings(s: Settings) {
  try { localStorage.setItem('turbogol.settings', JSON.stringify(s)); } catch { /* ignorar */ }
}

// ---------- Utilidades ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtClock = (s: number, ot: boolean) => {
  const t = ot ? Math.floor(s) : Math.ceil(s);
  return `${ot ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function lerpSnap(a: Snapshot, b: Snapshot, t: number): Snapshot {
  const lq = (ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number) =>
    new Quat(ax, ay, az, aw).slerp(new Quat(bx, by, bz, bw), t);
  const L = (x: number, y: number) => x + (y - x) * t;
  return {
    tick: b.tick,
    pads: b.pads,
    ball: (() => {
      const q = lq(a.ball.qx, a.ball.qy, a.ball.qz, a.ball.qw, b.ball.qx, b.ball.qy, b.ball.qz, b.ball.qw);
      const big = Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y, a.ball.z - b.ball.z) > 400;
      const k = big ? 1 : t;
      return { ...b.ball, x: a.ball.x + (b.ball.x - a.ball.x) * k, y: a.ball.y + (b.ball.y - a.ball.y) * k, z: a.ball.z + (b.ball.z - a.ball.z) * k, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    })(),
    cars: b.cars.map((cb, i) => {
      const ca = a.cars[i];
      if (!ca || ca.demoed !== cb.demoed || Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z) > 300) return cb;
      const q = lq(ca.qx, ca.qy, ca.qz, ca.qw, cb.qx, cb.qy, cb.qz, cb.qw);
      return { ...cb, x: L(ca.x, cb.x), y: L(ca.y, cb.y), z: L(ca.z, cb.z), qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    }),
  };
}

type State = 'menu' | 'playing' | 'paused' | 'replay' | 'ended' | 'ext';

class Game {
  settings = loadSettings();
  renderer: GameRenderer;
  input: InputManager;
  audio = new AudioEngine();
  world!: World;
  bots = new Map<number, Bot>();
  predictor = new BallPredictor();
  online: OnlineMode;
  state: State = 'menu';
  prevSnap!: Snapshot;
  curSnap!: Snapshot;
  private acc = 0;
  private last = performance.now();
  private history: Snapshot[] = [];
  private replay: { frames: Snapshot[]; t: number; goalIndex: number; focusId: number } | null = null;
  private lastCfg: MatchConfig | null = null;
  private lastDifficulty: Difficulty = 1;
  private playerInput: CarInput = emptyInput();
  private look = { x: 0, y: 0 };
  private centerTimer = 0;
  private toastTimer = 0;
  private endTimer = 0;
  private screenClock = '';
  private setupMode: 'match' | 'freeplay' = 'match';
  private setupValues = { teamSize: 1, difficulty: 1, duration: 300, unlimited: 0 };
  /** Mutadores elegidos en la pantalla de configuración. */
  private mutators: Rules = makeRules();
  private gameSpeed = 1;
  /** Velocidad de simulación del partido en curso (mutador). */
  private simSpeed = 1;
  challenges!: Challenges;
  private returnTo: 'menu' | 'pause' = 'menu';
  ui!: UiManager;
  /** Partida competitiva en curso (contra bots, con rango). */
  private ranked: { playlist: Playlist; diffs: number[] } | null = null;
  private matchDone = false;
  private endShown = false;
  private report: { xp: XpReport | null; ranked: RankedOutcome | null } = { xp: null, ranked: null };
  private tally = { clears: 0, centers: 0, aerialHits: 0, firstTouches: 0, epicSaves: 0, fastestGoalKmh: 0 };
  /** Entrenamiento, juego libre extendido, repeticiones y clips (src/training, src/replay). */
  ext: Extras;

  constructor() {
    const app = $('app');
    this.renderer = new GameRenderer(app, this.settings.camera, this.settings.theme);
    this.renderer.setQuality(this.settings.quality);
    this.input = new InputManager(app);
    this.audio.setVolume(this.settings.volume);
    this.audio.setMix(this.settings.mix);
    this.ext = new Extras(this as unknown as ConstructorParameters<typeof Extras>[0]);
    // Mundo de fondo para el menú (bots jugando)
    this.startWorld({ mode: 'match', teamSize: 2, duration: 300, unlimitedBoost: false, seed: 7 }, 1, true);
    this.wireMenus();
    this.buildMutators();
    this.renderer.cosmetics = new CosmeticFx(this.renderer.scene, this.renderer.particles, this.renderer.smoke);
    this.ui = new UiManager({
      showMain: (id) => this.showOnly(id),
      startRanked: (p) => this.startRanked(p),
      input: this.input,
      renderer: this.renderer,
      chatCars: () => this.world.cars.map((c) => ({ id: c.id, team: c.team, name: c.name, isBot: c.isBot })),
    }, $('hud'));
    this.online = new OnlineMode({
      renderer: this.renderer, audio: this.audio, bodyIndex: () => getLoadout().body,
      showOnly: (id) => this.showOnly(id), toMenu: () => this.quit(),
    });
    this.challenges = new Challenges({
      renderer: this.renderer,
      start: (cfg) => { this.audio.start(); this.ext.quietNext(); this.ranked = null; this.startWorld(cfg, 1); this.showOnly(null); $('hud').classList.remove('hidden'); this.state = 'playing'; },
      showOnly: (id) => this.showOnly(id),
      toast: (t) => this.toast(t),
      setHint: (t) => { $('hint').textContent = t; },
    });
    $('loading').classList.add('hidden');
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- Partidas ----------
  startWorld(cfg: MatchConfig, difficulty: Difficulty, attract = false, botDiffs?: number[]) {
    this.simSpeed = 1;
    this.challenges?.stop();
    this.world = new World(cfg);
    this.bots.clear();
    const names: string[] = [];
    const body = getLoadout().body;
    const myName = getProfile().name;
    if (!attract) {
      this.world.addCar(0, myName, body, false);
      names.push(myName);
    }
    if (cfg.mode === 'match' || attract) {
      let bi = 0;
      for (let team = 0; team < 2; team++) {
        const count = cfg.teamSize - (team === 0 && !attract ? 1 : 0);
        for (let i = 0; i < count; i++) {
          const c = this.world.addCar(team, World.botName(bi), (bi * 2 + 1) % CAR_BODIES.length, true);
          this.bots.set(c.id, new Bot(c, attract ? 1 : ((botDiffs?.[bi] ?? difficulty) as Difficulty)));
          bi++;
        }
      }
    }
    this.world.setupKickoff();
    if (cfg.mode === 'freeplay') this.world.resetFreeplay(this.world.cars[0]);
    this.ext.onWorldStart(cfg, attract);
    this.renderer.setupCars(this.world.cars.map((c) => ({
      id: c.id, team: c.team, bodyIndex: CAR_BODIES.indexOf(c.body), name: c.name,
      look: c.isBot ? botLook(cfg.seed + c.id * 31, c.team) : lookFromLoadout(getLoadout(), c.team),
    })), attract ? -1 : 0);
    this.renderer.camCtl.snapTo();
    this.curSnap = this.world.snapshot();
    this.prevSnap = this.curSnap;
    this.history = [];
    this.acc = 0;
    this.replay = null;
    $('replayBadge').classList.add('hidden');
    if (!attract) {
      this.lastCfg = cfg;
      this.lastDifficulty = difficulty;
      this.matchDone = false;
      this.endShown = false;
      this.report = { xp: null, ranked: null };
      this.tally = { clears: 0, centers: 0, aerialHits: 0, firstTouches: 0, epicSaves: 0, fastestGoalKmh: 0 };
      this.ui?.points.reset();
      this.ui?.chat.reset();
    }
    $<HTMLDivElement>('feed').innerHTML = '';
    this.setCenter('');
    this.updateScoreHud();
  }

  play(mode: 'match' | 'freeplay') {
    const v = this.setupValues;
    this.ranked = null;
    const cfg: MatchConfig = {
      mode,
      teamSize: mode === 'match' ? v.teamSize : 1,
      duration: v.duration,
      unlimitedBoost: mode === 'freeplay' ? v.unlimited === 1 : false,
      seed: Math.floor(Math.random() * 1e9),
      rules: isDefaultRules(this.mutators) ? undefined : { ...this.mutators },
    };
    this.audio.start();
    this.startWorld(cfg, v.difficulty as Difficulty);
    this.simSpeed = this.gameSpeed;
    const muts = this.mutatorSummary();
    this.showOnly(null);
    $('hud').classList.remove('hidden');
    $('hint').textContent = mode === 'freeplay'
      ? 'R: reiniciar · C: cámara · F1: controles · Esc: menú'
      : `${v.teamSize}v${v.teamSize} · ${DIFFICULTY_NAMES[v.difficulty]} · Tab: puntajes · Esc: pausa`;
    if (muts) this.toast(`Mutadores: ${muts}`);
    this.state = 'playing';
  }

  /** Partida competitiva: 1v1, 2v2 o 3v3 contra bots cuya dificultad sale del MMR del jugador. */
  startRanked(p: Playlist) {
    const size = PLAYLISTS.find((x) => x.id === p)!.teamSize;
    this.ranked = { playlist: p, diffs: this.rankedDiffs(p) };
    this.audio.start();
    this.startWorld({ mode: 'match', teamSize: size, duration: 300, unlimitedBoost: false, seed: Math.floor(Math.random() * 1e9) }, 1, false, this.ranked.diffs);
    this.showOnly(null);
    $('hud').classList.remove('hidden');
    $('hint').textContent = `Competitivo ${p} · Tab: puntajes · 1–4: chat rápido · Esc: pausa`;
    this.state = 'playing';
  }

  private rankedDiffs(p: Playlist): number[] {
    const size = PLAYLISTS.find((x) => x.id === p)!.teamSize;
    const r = getRanked()[p].r;
    return Array.from({ length: 2 * size - 1 }, () => botDifficultyFor(r, Math.random));
  }

  restart() {
    if (this.ext.restart()) return;
    if (this.challenges.restart()) { this.showOnly(null); this.state = 'playing'; return; }
    if (!this.lastCfg) return;
    if (this.ranked) this.ranked.diffs = this.rankedDiffs(this.ranked.playlist);
    this.startWorld({ ...this.lastCfg, seed: Math.floor(Math.random() * 1e9) }, this.lastDifficulty, false, this.ranked?.diffs);
    this.showOnly(null);
    $('hud').classList.remove('hidden');
    this.state = 'playing';
  }

  quit() {
    // Abandonar una competitiva en curso cuenta como derrota
    if (this.ranked && !this.matchDone && this.world.cfg.mode === 'match' && this.state !== 'menu') {
      this.matchDone = true;
      const size = this.world.cfg.teamSize;
      recordRanked(this.ranked.playlist, 0, this.ranked.diffs.slice(size - 1));
      recordMatch({ playlist: `Competitivo ${this.ranked.playlist}`, won: false, draw: false, completed: false, score: [this.world.score[0], this.world.score[1]], myScore: this.world.cars[0].stats.score, mvp: false, seconds: 0, stats: {}, fastestGoalKmh: 0 });
    }
    this.ranked = this.state === 'menu' ? this.ranked : null;
    this.startWorld({ mode: 'match', teamSize: 2, duration: 300, unlimitedBoost: false, seed: 7 }, 1, true);
    $('hud').classList.add('hidden');
    this.showOnly('menu');
    this.state = 'menu';
  }

  // ---------- Bucle ----------
  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { car, ui } = this.input.poll();
    if (this.online.active) { this.online.frame(dt, car, ui); requestAnimationFrame((t) => this.frame(t)); return; }
    this.playerInput = car;
    this.look = { x: ui.lookX, y: ui.lookY };
    this.handleUi(ui);

    if (this.state === 'ext') {
      this.ext.frame(dt);
    } else if (this.state === 'replay' && this.replay) {
      this.stepReplay(dt, ui.skip);
    } else if (this.state === 'playing' || this.state === 'menu' || this.state === 'ended') {
      this.acc += dt * (this.state === 'playing' ? this.simSpeed : 1);
      let steps = 0;
      while (this.acc >= DT && steps < 12) {
        this.tick();
        this.acc -= DT;
        steps++;
      }
      if (steps === 12) this.acc = 0;
      const snap = lerpSnap(this.prevSnap, this.curSnap, this.acc / DT);
      this.renderer.render(snap, dt, this.state === 'menu' ? 'menu' : 'play', this.look);
    } else {
      // Pausa: seguir dibujando el último estado
      this.renderer.render(this.curSnap, 0, 'play', this.look);
    }

    if (this.state !== 'ext') this.updateHud(dt);
    this.challenges.frame(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private tick() {
    const w = this.world;
    this.predictor.update(w);
    const inputs = w.cars.map((c) => {
      const bot = this.bots.get(c.id);
      if (bot) return bot.think(w, this.predictor, DT);
      return this.state === 'playing' ? this.playerInput : emptyInput();
    });
    if (this.ext.beforeStep(inputs)) { this.prevSnap = this.curSnap; this.curSnap = w.snapshot(); return; }
    w.step(inputs);
    this.prevSnap = this.curSnap;
    this.curSnap = w.snapshot();
    this.history.push(this.curSnap);
    if (this.history.length > 120 * 9) this.history.shift();
    for (const ev of w.takeEvents()) this.onEvent(ev);
    this.ext.afterStep(this.curSnap);
    if (this.state === 'playing') this.challenges.afterStep(w);

    // Transiciones del partido
    if (w.cfg.mode === 'match' && w.phase === 'goal' && w.phaseTimer <= 0) {
      if (this.state === 'menu') { w.setupKickoff(); return; }
      if (this.settings.replays && w.lastGoal) this.startReplay();
      else w.setupKickoff();
    }
    if (w.phase === 'ended' && this.state === 'playing') {
      this.finishMatch();
      this.endTimer = 3;
      this.state = 'ended';
    }
    if (this.state === 'menu' && w.phase === 'ended') {
      this.startWorld({ mode: 'match', teamSize: 2, duration: 300, unlimitedBoost: false, seed: Math.floor(Math.random() * 1e6) }, 1, true);
    }
  }

  /** Registra XP, estadísticas y (si corresponde) el rango al terminar el partido. */
  private finishMatch() {
    const w = this.world;
    if (this.matchDone || w.cfg.mode !== 'match') return;
    this.matchDone = true;
    const me = w.cars[0];
    const size = w.cfg.teamSize;
    const mvp = pickMvp(w.cars, w.winner);
    const won = w.winner === 0, draw = w.winner < 0;
    const label = this.ranked ? `Competitivo ${this.ranked.playlist}` : `Casual ${size}v${size}`;
    const xp = recordMatch({
      playlist: label, won, draw, completed: true, score: [w.score[0], w.score[1]], myScore: me.stats.score, mvp: mvp?.id === 0,
      seconds: w.cfg.duration, fastestGoalKmh: this.tally.fastestGoalKmh,
      stats: {
        goals: me.stats.goals, assists: me.stats.assists, saves: me.stats.saves, shots: me.stats.shots, demos: me.stats.demos,
        epicSaves: this.tally.epicSaves, clears: this.tally.clears, centers: this.tally.centers, aerialHits: this.tally.aerialHits, firstTouches: this.tally.firstTouches,
      },
    });
    let ranked: RankedOutcome | null = null;
    if (this.ranked) {
      ranked = recordRanked(this.ranked.playlist, draw ? 0.5 : won ? 1 : 0, this.ranked.diffs.slice(size - 1));
      xp.unlocks.push(...recordTier(bestTier()));
    }
    this.report = { xp, ranked };
  }

  /** Avanza la simulación sin dibujar (pruebas). */
  fastForward(seconds: number, input: Partial<CarInput> = {}) {
    const prev = this.playerInput;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      this.playerInput = { ...emptyInput(), ...input };
      if (this.state === 'replay') break;
      this.tick();
    }
    this.playerInput = prev;
  }

  private startReplay() {
    const goalTick = this.world.lastGoal!.tick;
    const idx = this.history.findIndex((s) => s.tick >= goalTick);
    if (idx < 0) { this.world.setupKickoff(); return; }
    const start = Math.max(0, idx - 120 * 5);
    const end = Math.min(this.history.length, idx + 60);
    this.replay = { frames: this.history.slice(start, end), t: 0, goalIndex: idx - start, focusId: this.world.lastGoal!.scorerId };
    this.state = 'replay';
    this.renderer.camCtl.resetDirector();
    $('replayBadge').classList.remove('hidden');
    this.setCenter('');
  }

  private stepReplay(dt: number, skip: boolean) {
    const r = this.replay!;
    const idx = r.t * 120;
    // Cámara lenta cerca del gol
    const slow = Math.abs(idx - r.goalIndex) < 70 ? 0.4 : 1;
    r.t += dt * slow;
    const i = Math.min(r.frames.length - 2, Math.floor(r.t * 120));
    const frac = r.t * 120 - i;
    const snap = lerpSnap(r.frames[Math.max(0, i)], r.frames[i + 1], Math.min(1, frac));
    this.renderer.render(snap, dt, 'replay', { x: 0, y: 0 }, r.focusId);
    if (skip || r.t * 120 >= r.frames.length - 2) {
      this.replay = null;
      $('replayBadge').classList.add('hidden');
      this.renderer.camCtl.snapTo();
      this.world.setupKickoff();
      this.curSnap = this.world.snapshot();
      this.prevSnap = this.curSnap;
      this.state = 'playing';
    }
  }

  // ---------- Eventos ----------
  private onEvent(ev: GameEvent) {
    const w = this.world;
    this.renderer.onEvent(ev, this.curSnap);
    this.ext.onEvent(ev);
    if (this.state === 'menu') return;
    this.audio.onEvent(ev, this.curSnap, 0); // sonido y vibración (W6)
    if (w.cfg.mode === 'match' || w.cfg.mode === 'freeplay') {
      for (const p of pointsFor(ev, 0, w.cars)) this.ui.points.add(p.label, p.pts, p.kind);
    }
    if (ev.type === 'feat' && ev.carId === 0) {
      const t = this.tally;
      if (ev.feat === 'clear') t.clears++; else if (ev.feat === 'center') t.centers++; else if (ev.feat === 'aerialhit') t.aerialHits++; else t.firstTouches++;
    }
    if (ev.type === 'save' && ev.carId === 0 && ev.epic) this.tally.epicSaves++;
    if (ev.type === 'goal') {
      if (ev.scorerId === 0 && w.cars[0].team === ev.team) this.tally.fastestGoalKmh = Math.max(this.tally.fastestGoalKmh, Math.round(ev.speed * 0.036));
      this.ui.chat.react('goal', ev.team);
    }
    // La vibración la maneja el motor de audio (audio.onEvent) para no duplicarla
    if (ev.type === 'demo') this.ui.chat.react('demo', w.cars[ev.attacker].team);
    if (ev.type === 'save') this.ui.chat.react('save', w.cars[ev.carId].team);
    switch (ev.type) {
      case 'flipreset': if (ev.carId === 0) this.toast('¡Flip reset!'); break;
      case 'countdown': this.setCenter(String(ev.n), 'pop'); break;
      case 'kickoff': this.setCenter('¡YA!', 'pop', 0.8); break;
      case 'goal': {
        const scorer = ev.scorerId >= 0 ? w.cars[ev.scorerId] : null;
        const own = scorer && scorer.team !== ev.team;
        this.setCenter('¡GOL!', 'pop goal' + ev.team, 2.8);
        const kmh = Math.round(ev.speed * 0.036);
        $('subcenter').textContent = scorer ? `${scorer.name}${own ? ' (en contra)' : ''} · ${kmh} km/h` : `${kmh} km/h`;
        this.feed(scorer ? `⚽ ${scorer.name} anotó para ${TEAM_NAMES[ev.team]}` : `⚽ ¡Gol de ${TEAM_NAMES[ev.team]}!`, ev.team);
        if (ev.assistId >= 0) this.feed(`🤝 Asistencia de ${w.cars[ev.assistId].name}`, ev.team);
        this.updateScoreHud();
        break;
      }
      case 'demo': {
        const a = w.cars[ev.attacker], v = w.cars[ev.victim];
        this.feed(`💥 ${a.name} demolió a ${v.name}`, a.team);
        break;
      }
      case 'save': this.feed(`🧤 ¡Atajada de ${w.cars[ev.carId].name}!`, w.cars[ev.carId].team); break;
      case 'shot': if (w.cfg.mode === 'match') this.feed(`🎯 Tiro de ${w.cars[ev.carId].name}`, w.cars[ev.carId].team); break;
      case 'overtime': this.setCenter('TIEMPO EXTRA', 'pop', 2.5); break;
    }
  }

  // ---------- HUD ----------
  private setCenter(text: string, cls = '', duration = 1) {
    const el = $('center');
    el.className = 'center';
    void el.offsetWidth;
    if (cls) el.className = 'center ' + cls;
    el.textContent = text;
    this.centerTimer = text ? duration : 0;
    if (!text) $('subcenter').textContent = '';
  }

  private feed(text: string, team: number) {
    const f = $('feed');
    const d = document.createElement('div');
    d.className = 'item t' + team;
    d.textContent = text;
    f.prepend(d);
    while (f.children.length > 5) f.lastChild?.remove();
    setTimeout(() => d.remove(), 6000);
  }

  private toast(text: string) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    this.toastTimer = 2.5;
  }

  private updateScoreHud() {
    $('s0').textContent = String(this.world.score[0]);
    $('s1').textContent = String(this.world.score[1]);
  }

  private updateHud(dt: number) {
    const w = this.world;
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.setCenter('');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').classList.add('hidden');
    }
    const clock = w.cfg.mode === 'match' ? fmtClock(w.clock, w.overtime) : '∞';
    const ce = $('clock');
    ce.textContent = clock;
    ce.classList.toggle('ot', w.overtime);
    if (clock !== this.screenClock) { this.screenClock = clock; this.renderer.stadium.updateScreens(w.score, clock); }

    const me = w.cars[0];
    if (me && this.state !== 'menu') {
      const b = Math.round(me.boost);
      $('boostNum').textContent = String(b);
      ($('boostRing') as unknown as SVGCircleElement).style.strokeDashoffset = String(314.16 * (1 - me.boost / 100));
      $('speedChip').textContent = `${Math.round(me.speed() * 0.036)} km/h${me.supersonic ? ' · SUPERSÓNICO' : ''}`;
      $('camChip').textContent = this.renderer.camCtl.ballCam ? 'CÁMARA: PELOTA' : 'CÁMARA: AUTO';
    }
    // El visor de repeticiones y el editor ('ext') suenan como una repetición
    this.audio.update(dt, this.curSnap, this.renderer.camera, this.state === 'ext' ? 'replay' : this.state, this.state === 'menu' ? -1 : 0);
    $('scoreTable').classList.toggle('hidden', !(this.input && this.tabHeld && (this.state === 'playing' || this.state === 'paused')));

    if (this.state === 'ended') {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && !this.endShown) { this.endShown = true; this.showEnd(); }
    }
  }

  private tabHeld = false;

  private statsTable() {
    const w = this.world;
    const rows = [...w.cars].sort((a, b) => a.team - b.team || b.stats.score - a.stats.score).map((c) =>
      `<tr class="t${c.team}${c.id === 0 && !c.isBot ? ' me' : ''}"><td>${c.name}</td><td>${c.stats.score}</td><td>${c.stats.goals}</td><td>${c.stats.assists}</td><td>${c.stats.saves}</td><td>${c.stats.shots}</td><td>${c.stats.demos}</td><td>${c.stats.touches}</td></tr>`).join('');
    return `<table class="stats"><tr><th>Jugador</th><th>Puntos</th><th>Goles</th><th>Asist.</th><th>Atajadas</th><th>Tiros</th><th>Demos</th><th>Toques</th></tr>${rows}</table>`;
  }

  private showEnd() {
    const w = this.world;
    const myTeam = 0;
    this.showOnly(null);
    this.ui.post.show({
      cars: w.cars.map((c) => ({ id: c.id, name: c.name, team: c.team, isBot: c.isBot, stats: c.stats })),
      score: [w.score[0], w.score[1]], winner: w.winner, myId: 0, myTeam: myTeam,
      label: this.ranked ? `Competitivo ${this.ranked.playlist}` : `Casual ${w.cfg.teamSize}v${w.cfg.teamSize}`,
      xp: this.report.xp, ranked: this.report.ranked,
    });
  }

  private handleUi(ui: ReturnType<InputManager['poll']>['ui']) {
    this.ext.handleUi(ui);
    this.tabHeld = ui.scoreboard;
    if (ui.pause && this.ui.consumeEsc()) ui.pause = false;
    if (ui.scoreboard) $('scoreTableInner').innerHTML = `<h2>Puntajes</h2>${this.statsTable()}`;
    if (ui.chat >= 0 && this.state === 'playing' && this.world.cfg.mode === 'match') this.ui.chat.press(ui.chat);
    this.ui.chat.tick();
    if (ui.ballCamToggle && this.state === 'playing') this.renderer.camCtl.ballCam = !this.renderer.camCtl.ballCam;
    if (ui.pause) {
      if (this.state === 'playing') { this.state = 'paused'; this.showOnly('pause'); }
      else if (this.state === 'paused' && !$('pause').classList.contains('hidden')) { this.state = 'playing'; this.showOnly(null); }
      else if (!$('controls').classList.contains('hidden') || !$('settings').classList.contains('hidden')) this.back();
    }
    if (ui.help && (this.state === 'playing' || this.state === 'paused')) {
      this.state = 'paused';
      this.returnTo = 'pause';
      this.showOnly('controls');
    }
    if (ui.reset && this.state === 'playing' && this.challenges.onReset()) {
      this.renderer.camCtl.snapTo();
    } else if (ui.reset && this.state === 'playing' && this.world.cfg.mode === 'freeplay') {
      this.world.resetFreeplay(this.world.cars[0]);
      this.renderer.camCtl.snapTo();
    }
  }

  // ---------- Menús ----------
  private showOnly(id: string | null) {
    this.ui?.closeAll();
    this.challenges?.closeMenu();
    for (const o of ['menu', 'setup', 'settings', 'controls', 'pause', 'end']) $(o).classList.toggle('hidden', o !== id);
  }

  private back() {
    if (this.returnTo === 'pause' && (this.state === 'paused')) this.showOnly('pause');
    else this.showOnly('menu');
  }

  private wireMenus() {
    document.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      this.audio.start();
      this.audio.click();
      const act = t.dataset.act;
      switch (act) {
        case 'match': this.openSetup('match'); break;
        case 'freeplay': this.openSetup('freeplay'); break;
        case 'online': this.online.open(); break;
        case 'settings': this.returnTo = this.state === 'paused' ? 'pause' : 'menu'; this.buildSliders(); this.showOnly('settings'); break;
        case 'controls': this.returnTo = this.state === 'paused' ? 'pause' : 'menu'; this.showOnly('controls'); break;
        case 'closeControls': case 'closeSettings': this.back(); break;
        case 'resetSettings': this.settings = structuredClone(DEFAULTS); this.applySettings(); this.buildSliders(); break;
        case 'back': this.showOnly('menu'); break;
        case 'play': this.play(this.setupMode); break;
        case 'challenges': this.challenges.openMenu(); break;
        case 'mutReset': this.mutators = makeRules(); this.gameSpeed = 1; this.buildMutators(); break;
        case 'mutRandom': this.randomMutators(); break;
        case 'garage': this.ui.open('garage'); break;
        case 'ranked': this.ui.open('ranked'); break;
        case 'profile': this.ui.open('profile'); break;
        case 'remap': this.ui.open('remap'); break;
        case 'resume': this.state = 'playing'; this.showOnly(null); break;
        case 'restart': this.restart(); break;
        case 'quit': this.quit(); break;
        default: this.ext.action(act); break;
      }
    });
    // Segmentos
    document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        (this.setupValues as Record<string, number>)[seg.dataset.key!] = Number(b.dataset.v);
      });
    });
    // Carrocerías
    const bodies = $('bodies');
    const descr = ['Equilibrado', 'Largo y bajo', 'Plano y ancho', 'Largo y fino', 'Híbrido', 'Alto, defensivo'];
    CAR_BODIES.forEach((b, i) => {
      const el = document.createElement('button');
      el.innerHTML = `<b>${b.name}</b><small>${descr[i]}</small>`;
      el.classList.toggle('on', i === getLoadout().body);
      el.addEventListener('click', () => {
        setLoadout({ body: i });
        bodies.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i));
      });
      bodies.appendChild(el);
    });
  }

  // ---------- Mutadores ----------
  private static readonly SPEEDS: [string, number][] = [['Lenta', 0.75], ['Normal', 1], ['Rápida', 1.25]];

  private mutatorSummary(): string {
    const parts: string[] = [];
    for (const m of MUTATORS) {
      const v = this.mutators[m.key];
      if (v !== DEFAULT_RULES[m.key]) parts.push(`${m.label}: ${m.options.find((o) => o.value === v)?.label ?? v}`);
    }
    if (this.gameSpeed !== 1) parts.push(`Velocidad: ${Game.SPEEDS.find((s) => s[1] === this.gameSpeed)?.[0]}`);
    return parts.join(' · ');
  }

  private buildMutators() {
    const box = $('mutRows');
    box.innerHTML = '';
    const row = (label: string, opts: string[], current: number, pick: (i: number) => void) => {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = `<label>${label}</label><div class="seg mut">${opts.map((o, i) => `<button class="${i === current ? 'on' : ''}">${o}</button>`).join('')}</div>`;
      r.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => { pick(i); this.buildMutators(); }));
      box.appendChild(r);
    };
    for (const m of MUTATORS) {
      const cur = m.options.findIndex((o) => o.value === this.mutators[m.key]);
      row(m.label, m.options.map((o) => o.label), cur, (i) => { (this.mutators as unknown as Record<string, unknown>)[m.key] = m.options[i].value; });
    }
    row('Velocidad del juego', Game.SPEEDS.map((s) => s[0]), Game.SPEEDS.findIndex((s) => s[1] === this.gameSpeed), (i) => { this.gameSpeed = Game.SPEEDS[i][1]; });
    const n = this.mutatorSummary() ? this.mutatorSummary().split(' · ').length : 0;
    $('mutCount').textContent = n ? `(${n} activo${n > 1 ? 's' : ''})` : '';
  }

  private randomMutators() {
    this.mutators = makeRules();
    const pool = [...MUTATORS].sort(() => Math.random() - 0.5).slice(0, 3);
    for (const m of pool) (this.mutators as unknown as Record<string, unknown>)[m.key] = m.options[Math.floor(Math.random() * m.options.length)].value;
    this.buildMutators();
  }

  private openSetup(mode: 'match' | 'freeplay') {
    this.setupMode = mode;
    $('setupTitle').textContent = mode === 'match' ? 'Partido vs bots' : 'Juego libre';
    for (const id of ['rowMode', 'rowDiff', 'rowTime']) $(id).classList.toggle('hidden', mode !== 'match');
    $('rowBoost').classList.toggle('hidden', mode !== 'freeplay');
    this.showOnly('setup');
  }

  private applySettings() {
    Object.assign(this.renderer.camCtl.settings, this.settings.camera);
    this.renderer.camCtl.updateFov(window.innerWidth / window.innerHeight);
    this.renderer.resize();
    this.audio.setVolume(this.settings.volume);
    this.audio.setMix(this.settings.mix);
    if (this.renderer.quality !== this.settings.quality) this.renderer.setQuality(this.settings.quality);
    if (this.renderer.theme !== this.settings.theme) {
      this.renderer.setTheme(this.settings.theme);
      this.renderer.setQuality(this.settings.quality);
      this.screenClock = '';
    }
    saveSettings(this.settings);
  }

  private buildSliders() {
    const box = $('sliders');
    box.innerHTML = '';
    const cam = this.settings.camera;
    const defs: [string, string, number, number, number, () => number, (v: number) => void, (v: number) => string][] = [
      ['FOV', 'fov', 60, 110, 1, () => cam.fov, (v) => (cam.fov = v), (v) => String(v)],
      ['Distancia', 'distance', 100, 400, 10, () => cam.distance, (v) => (cam.distance = v), (v) => String(v)],
      ['Altura', 'height', 40, 200, 10, () => cam.height, (v) => (cam.height = v), (v) => String(v)],
      ['Ángulo', 'angle', -15, 0, 1, () => cam.angle, (v) => (cam.angle = v), (v) => `${v}°`],
      ['Rigidez', 'stiffness', 0, 1, 0.05, () => cam.stiffness, (v) => (cam.stiffness = v), (v) => v.toFixed(2)],
      ['Giro (swivel)', 'swivel', 1, 10, 0.5, () => cam.swivel, (v) => (cam.swivel = v), (v) => v.toFixed(1)],
      ['Transición', 'transition', 1, 2, 0.1, () => cam.transition, (v) => (cam.transition = v), (v) => v.toFixed(1)],
      ['Sacudida', 'shake', 0, 1, 1, () => (cam.shake ? 1 : 0), (v) => (cam.shake = v === 1), (v) => (v ? 'Sí' : 'No')],
      ['Volumen', 'volume', 0, 1, 0.05, () => this.settings.volume, (v) => (this.settings.volume = v), (v) => `${Math.round(v * 100)}%`],
      ...(['motor', 'efectos', 'publico', 'musica', 'ui'] as const).map((k): [string, string, number, number, number, () => number, (v: number) => void, (v: number) => string] =>
        [{ motor: '· Motor', efectos: '· Efectos', publico: '· Público', musica: '· Música', ui: '· Interfaz' }[k], 'mix-' + k, 0, 1, 0.05, () => this.settings.mix[k], (v) => (this.settings.mix[k] = v), (v) => `${Math.round(v * 100)}%`]),
      ['Vibración', 'haptics', 0, 1, 1, () => (this.settings.mix.haptics ? 1 : 0), (v) => (this.settings.mix.haptics = v === 1), (v) => (v ? 'Sí' : 'No')],
      ['Calidad', 'quality', 0, 3, 1, () => QUALITY_LEVELS.indexOf(this.settings.quality), (v) => (this.settings.quality = QUALITY_LEVELS[v] ?? 'alta'), (v) => QUALITY_LABELS[QUALITY_LEVELS[v] ?? 'alta']],
      ['Estadio', 'theme', 0, 1, 1, () => (this.settings.theme === 'dia' ? 0 : 1), (v) => (this.settings.theme = v ? 'noche' : 'dia'), (v) => (v ? 'Noche' : 'Día')],
      ['Repeticiones', 'replays', 0, 1, 1, () => (this.settings.replays ? 1 : 0), (v) => (this.settings.replays = v === 1), (v) => (v ? 'Sí' : 'No')],
    ];
    for (const [label, key, min, max, step, get, set, fmt] of defs) {
      const row = document.createElement('div');
      row.className = 'slider';
      row.innerHTML = `<label for="sl-${key}">${label}</label><input id="sl-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${get()}"><output>${fmt(get())}</output>`;
      const input = row.querySelector('input')!;
      const out = row.querySelector('output')!;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        set(v);
        out.textContent = fmt(v);
        this.applySettings();
      });
      box.appendChild(row);
    }
  }
}

const game = new Game();
// Gancho de depuración (pruebas automáticas y consola)
(window as unknown as { __turbogol: Game }).__turbogol = game;
