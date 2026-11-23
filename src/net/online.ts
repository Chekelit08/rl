// Modo online en el navegador: menú (crear sala / unirse con código), lobby (equipos, listo, opciones del
// anfitrión), partido (predicción + rollback de OnlineMatch, HUD propio, indicador de ping y pérdida) y
// resultado final. Arma su propio DOM y CSS; main.ts sólo le cede el bucle mientras hay un partido.

import type { AudioEngine } from '../audio/audio.ts';
import type { UiActions } from '../input/input.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { CarInput } from '../sim/car.ts';
import { emptyInput } from '../sim/car.ts';
import { CAR_BODIES, DT, TEAM_NAMES } from '../sim/constants.ts';
import { Quat } from '../sim/math.ts';
import type { GameEvent, Snapshot } from '../sim/world.ts';
import { NetClient, type NetStatus } from './client.ts';
import { OnlineMatch } from './match.ts';
import { DEFAULT_PORT, type LobbyPlayer, normalizeCode, type RoomConfig, type ServerMsg } from './protocol.ts';
import './online.css';

/** Lo que el modo online necesita del juego (main.ts). */
export interface OnlineHost {
  renderer: GameRenderer;
  audio: AudioEngine;
  /** Carrocería elegida en el menú. */
  bodyIndex(): number;
  /** Muestra sólo ese panel del juego (o ninguno). */
  showOnly(id: string | null): void;
  /** Vuelve al menú principal con el partido de fondo. */
  toMenu(): void;
}

// ---------- URL del servidor ----------

const LS_SERVER = 'turbogol.server';
const LS_NAME = 'turbogol.name';
const SS_TOKEN = 'turbogol.token';
const SS_ROOM = 'turbogol.room'; // en una sala: al recargar la pestaña se vuelve solo (reconexión)

const store = {
  get(k: string, session = false) { try { return (session ? sessionStorage : localStorage).getItem(k) ?? ''; } catch { return ''; } },
  set(k: string, v: string, session = false) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { /* ignorar */ } },
};

/** Servidor por defecto: el mismo host (puerto 8787), o el mismo origen si la página la sirve el propio servidor o es https. */
export function defaultServerUrl(loc: { protocol: string; hostname: string; host: string; port: string }): string {
  if (loc.protocol === 'https:') return `wss://${loc.host}/ws`;
  if (loc.port === String(DEFAULT_PORT)) return `ws://${loc.host}/ws`;
  return `ws://${loc.hostname || 'localhost'}:${DEFAULT_PORT}`;
}

/** Acepta "host:puerto", "http(s)://…" o "ws(s)://…". */
export function normalizeServerUrl(s: string, https = false): string {
  let u = s.trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) u = u.replace(/^http/i, 'ws');
  else if (!/^wss?:\/\//i.test(u)) u = (https ? 'wss://' : 'ws://') + u;
  return u.replace(/\/+$/, '');
}

export function serverUrl(): string {
  const https = location.protocol === 'https:';
  const q = new URLSearchParams(location.search).get('server');
  if (q) return normalizeServerUrl(q, https);
  const saved = store.get(LS_SERVER);
  if (saved) return normalizeServerUrl(saved, https);
  return defaultServerUrl(location);
}

// ---------- Utilidades ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtClock = (s: number, ot: boolean) => {
  const t = ot ? Math.floor(s) : Math.ceil(s);
  return `${ot ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function lerpSnap(a: Snapshot, b: Snapshot, t: number): Snapshot {
  const L = (x: number, y: number) => x + (y - x) * t;
  const lq = (ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number) =>
    new Quat(ax, ay, az, aw).slerp(new Quat(bx, by, bz, bw), t);
  const ab = a.ball, bb = b.ball;
  const ballJump = Math.hypot(ab.x - bb.x, ab.y - bb.y, ab.z - bb.z) > 400;
  const bq = lq(ab.qx, ab.qy, ab.qz, ab.qw, bb.qx, bb.qy, bb.qz, bb.qw);
  return {
    tick: b.tick,
    pads: b.pads,
    ball: ballJump ? bb : { ...bb, x: L(ab.x, bb.x), y: L(ab.y, bb.y), z: L(ab.z, bb.z), qx: bq.x, qy: bq.y, qz: bq.z, qw: bq.w },
    cars: b.cars.map((cb, i) => {
      const ca = a.cars[i];
      if (!ca || ca.demoed !== cb.demoed || Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z) > 300) return cb;
      const q = lq(ca.qx, ca.qy, ca.qz, ca.qw, cb.qx, cb.qy, cb.qz, cb.qw);
      return { ...cb, x: L(ca.x, cb.x), y: L(ca.y, cb.y), z: L(ca.z, cb.z), qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    }),
  };
}

type RoomMsg = Extract<ServerMsg, { t: 'room' }>;
type Screen = 'home' | 'lobby' | 'results' | null;

const DIFF_NAMES = ['Novato', 'Profesional', 'Leyenda'];

export class OnlineMode {
  /** true mientras hay un partido online: main.ts le cede el bucle (simulación, render y HUD). */
  active = false;
  net: NetClient | null = null;
  room: RoomMsg | null = null;
  match: OnlineMatch | null = null;
  status: NetStatus = 'idle';
  lastError = '';

  private host: OnlineHost;
  private root: HTMLDivElement | null = null;
  private screen: Screen = null;
  private createCfg: RoomConfig = { teamSize: 2, duration: 300, botFill: true, botDifficulty: 1 };
  private acc = 0;
  private prevSnap: Snapshot | null = null;
  private curSnap: Snapshot | null = null;
  private paused = false;
  private endInfo: { score: number[]; winner: number; at: number } | null = null;
  private centerTimer = 0;
  private toastTimer = 0;
  private lastCount = 0;
  private lastPhase = '';
  private screenClock = '';
  private pendingJoin = '';
  private prevPlayers: LobbyPlayer[] = [];

  constructor(host: OnlineHost) {
    this.host = host;
    this.pendingJoin = normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
    this.injectSettingsRow();
    if (this.pendingJoin.length === 5 || store.get(SS_ROOM, true)) setTimeout(() => this.open(), 0);
  }

  // ---------- Conexión ----------

  private ensureNet() {
    if (this.net && this.net.status !== 'closed') return this.net;
    const net = new NetClient(store.get(SS_TOKEN, true) || undefined);
    net.onMessage = (m) => this.onMessage(m);
    net.onBinary = (b) => this.match?.handleSnapshot(b);
    net.onStatus = (s, detail) => {
      this.status = s;
      if (s === 'closed' && detail) {
        this.lastError = `${detail}. ¿Está corriendo el servidor? (npm run server)`;
        this.room = null;
        if (this.active) this.leaveMatchView();
        if (this.screen) this.screen = 'home';
      }
      if (s === 'open') this.lastError = '';
      this.render();
    };
    this.net = net;
    net.connect(serverUrl(), this.playerName(), this.host.bodyIndex());
    return net;
  }

  private send(m: Parameters<NetClient['send']>[0]) {
    this.ensureNet();
    this.net!.send(m);
  }

  private playerName() { return store.get(LS_NAME) || 'Jugador'; }

  private onMessage(m: ServerMsg) {
    this.match?.handleMessage(m);
    switch (m.t) {
      case 'welcome':
        store.set(SS_TOKEN, m.token, true);
        if (this.pendingJoin.length === 5) { this.net!.send({ t: 'join', code: this.pendingJoin }); this.pendingJoin = ''; }
        break;
      case 'room': {
        const prev = this.room;
        this.room = m;
        store.set(SS_ROOM, m.code, true);
        this.notePlayerChanges(m.players);
        if (m.state === 'lobby' && this.active) this.leaveMatchView();
        if (!this.active) this.screen = 'lobby';
        if (!prev || prev.code !== m.code) this.lastError = '';
        break;
      }
      case 'start': this.startMatch(m); break;
      case 'end': this.endInfo = { score: m.score, winner: m.winner, at: performance.now() }; break;
      case 'left': this.room = null; store.set(SS_ROOM, '', true); this.screen = 'home'; break;
      case 'kicked':
        this.lastError = m.reason;
        this.room = null;
        store.set(SS_ROOM, '', true);
        if (this.active) this.leaveMatchView();
        this.screen = 'home';
        break;
      case 'error': this.lastError = m.msg; if (this.active) this.toast(m.msg); break;
      case 'pong': { const el = byId('onRtt'); if (el) el.textContent = `${Math.round(this.net?.rtt ?? 0)} ms`; return; }
      case 'ev': return;
    }
    this.render();
  }

  private notePlayerChanges(players: LobbyPlayer[]) {
    if (this.active) {
      for (const p of players) {
        const old = this.prevPlayers.find((x) => x.id === p.id);
        if (old && old.connected && !p.connected) this.feed(`📡 ${p.name} se desconectó (lo maneja un bot)`, p.team);
        if (old && !old.connected && p.connected) this.feed(`📡 ${p.name} volvió`, p.team);
      }
      for (const old of this.prevPlayers) if (!players.some((p) => p.id === old.id)) this.feed(`🚪 ${old.name} salió`, old.team);
    }
    this.prevPlayers = players;
  }

  // ---------- Acciones (también las usa la prueba de Playwright) ----------

  open() {
    this.host.showOnly(null);
    this.ensureNet();
    if (!this.screen) this.screen = this.room ? 'lobby' : 'home';
    this.render();
  }

  create(cfg: Partial<RoomConfig> = {}) { this.createCfg = { ...this.createCfg, ...cfg }; this.send({ t: 'create', cfg: this.createCfg }); }
  join(code: string) {
    const c = normalizeCode(code);
    if (c.length !== 5) { this.lastError = 'El código tiene 5 letras'; this.render(); return; }
    this.send({ t: 'join', code: c });
  }
  setTeam(team: number) { this.send({ t: 'team', team }); }
  setReady(ready: boolean) { this.send({ t: 'ready', ready }); }
  setConfig(cfg: Partial<RoomConfig>) { this.send({ t: 'config', cfg }); }
  start() { this.send({ t: 'start' }); }
  leaveRoom() { this.send({ t: 'leave' }); this.room = null; store.set(SS_ROOM, '', true); this.screen = 'home'; this.render(); }
  backToLobby() { this.send({ t: 'lobby' }); }

  /** Cierra el online y vuelve al menú principal. */
  exit() {
    if (this.room) this.net?.send({ t: 'leave' });
    store.set(SS_ROOM, '', true);
    this.net?.close();
    this.net = null;
    this.room = null;
    if (this.active) this.leaveMatchView();
    this.screen = null;
    this.render();
    this.host.showOnly('menu');
  }

  private me(): LobbyPlayer | undefined { return this.room?.players.find((p) => p.id === this.room!.you); }

  // ---------- Partido ----------

  private startMatch(m: Extract<ServerMsg, { t: 'start' }>) {
    if (!this.net) return;
    this.match = new OnlineMatch(this.net, m);
    this.active = true;
    this.paused = false;
    this.endInfo = null;
    this.acc = 0;
    this.prevSnap = this.curSnap = null;
    this.lastCount = 0;
    this.lastPhase = '';
    this.screenClock = '';
    this.screen = null;
    const r = this.host.renderer;
    r.setupCars(m.roster.map((x) => ({ id: x.carId, team: x.team, bodyIndex: x.body % CAR_BODIES.length, name: x.name })), m.yourCarId);
    r.camCtl.snapTo();
    this.host.audio.start();
    this.host.showOnly(null);
    byId('hud')?.classList.remove('hidden');
    byId('feed')!.innerHTML = '';
    const hint = byId('hint');
    if (hint) hint.textContent = `Online · Sala ${this.room?.code ?? ''} · ${m.cfg.teamSize}v${m.cfg.teamSize} · Tab: puntajes · Esc: menú`;
    this.setCenter(this.match.incompatible ? '' : 'Conectando…', '', 30);
    if (this.match.incompatible) this.toast(this.match.incompatible);
  }

  /** Sale de la vista del partido (vuelve al fondo del menú; el overlay online queda encima). */
  private leaveMatchView() {
    this.active = false;
    this.match = null;
    this.paused = false;
    this.endInfo = null;
    byId('netChip')?.remove();
    byId('scoreTable')?.classList.add('hidden');
    this.host.toMenu();
    this.host.showOnly(null);
    this.screen = this.room ? 'lobby' : 'home';
  }

  /** Un cuadro (lo llama main.ts en lugar de su bucle mientras `active`). */
  frame(dt: number, input: CarInput, ui: UiActions) {
    const m = this.match;
    if (!m) return;
    this.handleUi(ui);
    const myInput = this.paused || this.screen === 'results' ? emptyInput() : input;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < 12) {
      this.prevSnap = this.curSnap;
      for (const ev of m.tick(myInput)) this.onEvent(ev);
      this.curSnap = m.snapshot();
      this.acc -= DT;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    if (!m.ready || !this.curSnap) {
      this.host.renderer.render(m.world.snapshot(), dt, 'menu', { x: 0, y: 0 });
      this.updateHud(dt);
      return;
    }
    const snap = this.prevSnap ? lerpSnap(this.prevSnap, this.curSnap, Math.min(1, this.acc / DT)) : this.curSnap;
    this.host.renderer.render(snap, dt, 'play', { x: ui.lookX, y: ui.lookY });
    this.updateHud(dt);
    if (this.endInfo && this.screen !== 'results' && performance.now() - this.endInfo.at > 2500) {
      this.screen = 'results';
      this.render();
    }
  }

  private handleUi(ui: UiActions) {
    if (ui.ballCamToggle && !this.paused) this.host.renderer.camCtl.ballCam = !this.host.renderer.camCtl.ballCam;
    if (ui.pause && this.screen !== 'results') { this.paused = !this.paused; this.render(); }
    const table = byId('scoreTable');
    if (table) {
      const show = ui.scoreboard && !this.paused && this.screen !== 'results';
      table.classList.toggle('hidden', !show);
      if (show) byId('scoreTableInner')!.innerHTML = `<h2>Puntajes</h2>${this.statsTable()}`;
    }
  }

  private onEvent(ev: GameEvent) {
    const m = this.match!;
    const w = m.world, me = m.localId, a = this.host.audio;
    this.host.renderer.onEvent(ev, this.curSnap ?? w.snapshot());
    const meCar = w.cars[me];
    switch (ev.type) {
      case 'hit': a.hit(ev.strength, meCar ? meCar.pos.dist(ev.pos) < 1500 : true); break;
      case 'bounce': a.bounce(ev.strength); break;
      case 'pad': if (ev.carId === me) a.pad(ev.big); break;
      case 'jump': case 'flip': if (ev.carId === me) a.jump(); break;
      case 'flipreset': if (ev.carId === me) { a.pad(false); this.toast('¡Flip reset!'); } break;
      case 'goal': {
        a.goal();
        const scorer = ev.scorerId >= 0 ? w.cars[ev.scorerId] : null;
        const own = scorer && scorer.team !== ev.team;
        this.setCenter('¡GOL!', 'pop goal' + ev.team, 2.8);
        const kmh = Math.round(ev.speed * 0.036);
        const sub = byId('subcenter');
        if (sub) sub.textContent = scorer ? `${scorer.name}${own ? ' (en contra)' : ''} · ${kmh} km/h` : `${kmh} km/h`;
        this.feed(scorer ? `⚽ ${scorer.name} anotó para ${TEAM_NAMES[ev.team]}` : `⚽ ¡Gol de ${TEAM_NAMES[ev.team]}!`, ev.team);
        if (ev.assistId >= 0 && w.cars[ev.assistId]) this.feed(`🤝 Asistencia de ${w.cars[ev.assistId].name}`, ev.team);
        break;
      }
      case 'demo': {
        a.demo();
        const at = w.cars[ev.attacker], v = w.cars[ev.victim];
        if (at && v) this.feed(`💥 ${at.name} demolió a ${v.name}`, at.team);
        break;
      }
      case 'bump': if (ev.attacker === me || ev.victim === me) a.bump(); break;
      case 'save': if (w.cars[ev.carId]) this.feed(`🧤 ¡Atajada de ${w.cars[ev.carId].name}!`, w.cars[ev.carId].team); break;
      case 'shot': if (w.cars[ev.carId]) this.feed(`🎯 Tiro de ${w.cars[ev.carId].name}`, w.cars[ev.carId].team); break;
      case 'overtime': this.setCenter('TIEMPO EXTRA', 'pop', 2.5); a.whistle(); break;
      case 'end': a.whistle(); break;
      // La cuenta regresiva sale del estado predicho (ver updateHud): llega a tiempo aunque haya ping
    }
  }

  // ---------- HUD ----------

  private setCenter(text: string, cls = '', duration = 1) {
    const el = byId('center');
    if (!el) return;
    el.className = 'center';
    void el.offsetWidth;
    if (cls) el.className = 'center ' + cls;
    el.textContent = text;
    this.centerTimer = text ? duration : 0;
    const sub = byId('subcenter');
    if (sub) sub.textContent = ''; // el gol pone su subtítulo después

  }

  private feed(text: string, team: number) {
    const f = byId('feed');
    if (!f) return;
    const d = document.createElement('div');
    d.className = 'item t' + team;
    d.textContent = text;
    f.prepend(d);
    while (f.children.length > 5) f.lastChild?.remove();
    setTimeout(() => d.remove(), 6000);
  }

  private toast(text: string) {
    const t = byId('toast');
    if (!t) return;
    t.textContent = text;
    t.classList.remove('hidden');
    this.toastTimer = 3;
  }

  private updateHud(dt: number) {
    const m = this.match!;
    const w = m.world;
    if (this.centerTimer > 0) { this.centerTimer -= dt; if (this.centerTimer <= 0) this.setCenter(''); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) byId('toast')?.classList.add('hidden'); }
    if (m.ready) {
      // Cuenta regresiva desde el estado predicho
      if (w.phase === 'countdown') {
        const n = Math.max(1, Math.ceil(w.phaseTimer));
        if (n !== this.lastCount) { this.lastCount = n; this.host.audio.countdown(false); this.setCenter(String(n), 'pop', 1.2); }
      } else if (this.lastPhase === 'countdown' && w.phase === 'playing') {
        this.lastCount = 0;
        this.host.audio.countdown(true);
        this.setCenter('¡YA!', 'pop', 0.8);
      } else if (this.lastPhase === '') this.setCenter('');
      this.lastPhase = w.phase;
    }
    const s0 = byId('s0'), s1 = byId('s1');
    if (s0) s0.textContent = String(w.score[0]);
    if (s1) s1.textContent = String(w.score[1]);
    const clock = fmtClock(w.clock, w.overtime);
    const ce = byId('clock');
    if (ce) { ce.textContent = clock; ce.classList.toggle('ot', w.overtime); }
    if (clock !== this.screenClock) { this.screenClock = clock; this.host.renderer.stadium.updateScreens(w.score, clock); }
    const me = w.cars[m.localId];
    if (me) {
      const bn = byId('boostNum');
      if (bn) bn.textContent = String(Math.round(me.boost));
      const ring = document.getElementById('boostRing');
      if (ring) ring.style.strokeDashoffset = String(314.16 * (1 - me.boost / 100));
      const sc = byId('speedChip');
      if (sc) sc.textContent = `${Math.round(me.speed() * 0.036)} km/h${me.supersonic ? ' · SUPERSÓNICO' : ''}`;
      const cc = byId('camChip');
      if (cc) cc.textContent = this.host.renderer.camCtl.ballCam ? 'CÁMARA: PELOTA' : 'CÁMARA: AUTO';
      this.host.audio.updateCar(me.speed(), me.isBoosting, me.supersonic, me.onGround, !this.paused);
    }
    // Indicador de red
    let chip = byId('netChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'netChip';
      chip.className = 'net-chip';
      byId('hud')?.appendChild(chip);
    }
    const st = m.stats;
    const lossPct = Math.round(st.loss * 100);
    const q = this.status !== 'open' ? 'bad' : st.ping > 150 || lossPct > 5 ? 'bad' : st.ping > 80 || lossPct > 1 ? 'mid' : 'good';
    chip.className = 'net-chip ' + q;
    chip.innerHTML = this.status === 'reconnecting'
      ? '<i></i>Reconectando…'
      : `<i></i>${st.ping} ms<span>·</span>pérdida ${lossPct}%`;
    chip.title = `Jitter ${st.jitter} ms · margen ${st.slack} ticks · correcciones ${st.rollbacks} · ${(st.bytesPerSec / 1024).toFixed(1)} KB/s`;
  }

  private statsTable() {
    const m = this.match;
    if (!m) return '';
    const rows = [...m.world.cars].sort((a, b) => a.team - b.team || b.stats.score - a.stats.score).map((c) =>
      `<tr class="t${c.team}${c.id === m.localId ? ' me' : ''}"><td>${esc(c.name)}${c.isBot ? ' <small>BOT</small>' : ''}</td><td>${c.stats.score}</td><td>${c.stats.goals}</td><td>${c.stats.assists}</td><td>${c.stats.saves}</td><td>${c.stats.shots}</td><td>${c.stats.demos}</td><td>${c.stats.touches}</td></tr>`).join('');
    return `<table class="stats"><tr><th>Jugador</th><th>Puntos</th><th>Goles</th><th>Asist.</th><th>Atajadas</th><th>Tiros</th><th>Demos</th><th>Toques</th></tr>${rows}</table>`;
  }

  // ---------- Pantallas ----------

  private ensureRoot() {
    if (this.root) return this.root;
    const root = document.createElement('div');
    root.id = 'online';
    root.className = 'overlay online hidden';
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('keydown', (e) => {
      // Que escribir en los campos no mueva el auto ni dispare atajos del juego
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = e.target as HTMLElement;
        if (t.id === 'onCode') this.join((t as HTMLInputElement).value);
      }
    });
    root.addEventListener('keyup', (e) => e.stopPropagation());
    root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'onName') store.set(LS_NAME, t.value.slice(0, 16));
      if (t.id === 'onCode') t.value = normalizeCode(t.value);
    });
    root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'onName' && this.net) { this.net.name = this.playerName(); this.net.close(); this.net = null; this.ensureNet(); }
    });
    document.body.appendChild(root);
    this.root = root;
    return root;
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('[data-on]') as HTMLElement | null;
    if (!t || (t as HTMLButtonElement).disabled) return;
    this.host.audio.start();
    this.host.audio.click();
    const [act, val] = (t.dataset.on ?? '').split(':');
    const n = Number(val);
    switch (act) {
      case 'create': this.create(); break;
      case 'join': this.join(byId<HTMLInputElement>('onCode')?.value ?? ''); break;
      case 'back': this.exit(); break;
      case 'retry': this.net?.close(); this.net = null; this.lastError = ''; this.ensureNet(); break;
      case 'cTeam': this.createCfg.teamSize = n; break;
      case 'cTime': this.createCfg.duration = n; break;
      case 'cBots': this.createCfg.botFill = n === 1; break;
      case 'cDiff': this.createCfg.botDifficulty = n as 0 | 1 | 2; break;
      case 'team': this.setTeam(n); break;
      case 'ready': this.setReady(!this.me()?.ready); break;
      case 'start': this.start(); break;
      case 'leave': this.leaveRoom(); break;
      case 'copy': this.copyLink(); break;
      case 'rTeam': this.setConfig({ teamSize: n }); break;
      case 'rTime': this.setConfig({ duration: n }); break;
      case 'rBots': this.setConfig({ botFill: n === 1 }); break;
      case 'rDiff': this.setConfig({ botDifficulty: n as 0 | 1 | 2 }); break;
      case 'resume': this.paused = false; break;
      case 'abandon': this.leaveRoom(); this.leaveMatchView(); this.screen = 'home'; break;
      case 'toLobby': this.backToLobby(); break;
    }
    this.render();
  }

  private copyLink() {
    if (!this.room) return;
    const u = new URL(location.href);
    u.searchParams.set('room', this.room.code);
    const text = u.toString();
    navigator.clipboard?.writeText(text).then(() => { this.lastError = ''; }, () => {});
    const el = byId('onCopied');
    if (el) el.textContent = '¡Enlace copiado!';
  }

  private seg(act: string, opts: [number, string][], cur: number, disabled = false) {
    return `<div class="seg">${opts.map(([v, l]) =>
      `<button data-on="${act}:${v}" class="${v === cur ? 'on' : ''}"${disabled ? ' disabled' : ''}>${l}</button>`).join('')}</div>`;
  }

  private statusLine() {
    const url = this.net?.url || serverUrl();
    const s = this.status;
    const txt = s === 'open' ? `Conectado · <span id="onRtt">${Math.round(this.net?.rtt ?? 0)} ms</span>`
      : s === 'connecting' ? 'Conectando…' : s === 'reconnecting' ? 'Reconectando…' : 'Sin conexión';
    const help = s === 'reconnecting' || s === 'closed'
      ? `<div class="on-help">No se encuentra el servidor de juego. Para jugar en red, alguien tiene que iniciarlo con <code>npm run server</code> (en la misma red local o desplegado; ver docs/05-online.md) y, si no es esta compu, poner su dirección en Ajustes o en el enlace con <code>?server=ws://IP:8787</code>.</div>`
      : '';
    return `<div class="on-status ${s}"><i></i>${txt}<span class="url">${esc(url)}</span>${s === 'closed' ? '<button class="linkbtn" data-on="retry">Reintentar</button>' : ''}</div>${help}`;
  }

  private lastHtml = '';

  /** Cambia el contenido sólo si cambió, conservando lo que se estaba escribiendo y el foco. */
  private setHtml(root: HTMLElement, html: string) {
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    const focused = document.activeElement as HTMLInputElement | null;
    const keep = [...root.querySelectorAll<HTMLInputElement>('input[id]')].map((i) => [i.id, i.value, i === focused, i.selectionStart] as const);
    root.innerHTML = html;
    for (const [id, value, hadFocus, sel] of keep) {
      const el = root.querySelector<HTMLInputElement>('#' + id);
      if (!el) continue;
      el.value = value;
      if (hadFocus) { el.focus(); if (sel !== null) el.setSelectionRange(sel, sel); }
    }
  }

  /** Redibuja el overlay del online según el estado. */
  render() {
    const root = this.ensureRoot();
    const scr = this.active ? (this.screen === 'results' ? 'results' : this.paused ? 'pause' : null) : this.screen;
    root.classList.toggle('hidden', !scr);
    root.classList.toggle('in-match', this.active);
    if (!scr) { this.setHtml(root, ''); return; }
    const err = this.lastError ? `<div class="on-error">${esc(this.lastError)}</div>` : '';
    if (scr === 'home') {
      const c = this.createCfg;
      this.setHtml(root, `<div class="panel">
        <h2>Online</h2>
        ${this.statusLine()}
        <div class="row"><label for="onName">Tu nombre</label><input id="onName" type="text" maxlength="16" value="${esc(this.playerName())}" autocomplete="off"></div>
        <div class="on-box">
          <h3>Crear sala</h3>
          <div class="row"><label>Modo</label>${this.seg('cTeam', [[1, '1v1'], [2, '2v2'], [3, '3v3']], c.teamSize)}</div>
          <div class="row"><label>Duración</label>${this.seg('cTime', [[180, '3 min'], [300, '5 min'], [600, '10 min']], c.duration)}</div>
          <div class="row"><label>Completar con bots</label>${this.seg('cBots', [[1, 'Sí'], [0, 'No']], c.botFill ? 1 : 0)}</div>
          <div class="row"><label>Bots</label>${this.seg('cDiff', [[0, DIFF_NAMES[0]], [1, DIFF_NAMES[1]], [2, DIFF_NAMES[2]]], c.botDifficulty)}</div>
          <div class="actions"><button class="btn primary" data-on="create" ${this.status !== 'open' ? 'disabled' : ''}>Crear sala</button></div>
        </div>
        <div class="on-box">
          <h3>Unirme con código</h3>
          <div class="on-join"><input id="onCode" type="text" maxlength="5" placeholder="ABCDE" autocomplete="off" spellcheck="false"><button class="btn primary" data-on="join" ${this.status !== 'open' ? 'disabled' : ''}>Unirme</button></div>
        </div>
        ${err}
        <div class="actions"><button class="btn" data-on="back">Volver</button></div>
      </div>`);
      return;
    }
    if (scr === 'lobby' && this.room) {
      const r = this.room, me = this.me(), isHost = !!me?.host, cfg = r.cfg;
      const teamCol = (t: number) => {
        const ps = r.players.filter((p) => p.team === t);
        const slots: string[] = ps.map((p) => `<li class="${p.id === r.you ? 'me' : ''}${p.connected ? '' : ' off'}">
          <span class="nm">${p.host ? '<b title="Anfitrión">★</b> ' : ''}${esc(p.name)}</span>
          <span class="st ${p.ready || p.host ? 'ok' : ''}">${!p.connected ? 'desconectado' : p.host ? 'anfitrión' : p.ready ? 'listo' : 'esperando'}</span></li>`);
        for (let i = ps.length; i < cfg.teamSize; i++) slots.push(`<li class="empty"><span class="nm">${cfg.botFill ? 'Bot' : 'Libre'}</span><span class="st">${cfg.botFill ? DIFF_NAMES[cfg.botDifficulty] : ''}</span></li>`);
        const canSwitch = me && me.team !== t && ps.length < cfg.teamSize && r.state === 'lobby';
        return `<div class="on-team t${t}"><div class="th">${TEAM_NAMES[t].toUpperCase()}${canSwitch ? `<button class="linkbtn" data-on="team:${t}">Pasarme</button>` : ''}</div><ul>${slots.join('')}</ul></div>`;
      };
      const others = r.players.filter((p) => !p.host && p.connected);
      const allReady = others.every((p) => p.ready);
      const playing = r.state !== 'lobby';
      this.setHtml(root, `<div class="panel wide">
        <div class="on-head"><h2>Sala <span class="code" id="onRoomCode">${r.code}</span></h2>
          <div class="on-share"><button class="linkbtn" data-on="copy">Copiar enlace</button><span id="onCopied"></span></div></div>
        ${this.statusLine()}
        ${playing ? '<div class="on-note">Hay un partido en curso: vas a jugar en el próximo.</div>' : ''}
        <div class="on-teams">${teamCol(0)}${teamCol(1)}</div>
        <div class="on-cfg">
          <div class="row"><label>Modo</label>${this.seg('rTeam', [[1, '1v1'], [2, '2v2'], [3, '3v3']], cfg.teamSize, !isHost || playing)}</div>
          <div class="row"><label>Duración</label>${this.seg('rTime', [[180, '3 min'], [300, '5 min'], [600, '10 min']], cfg.duration, !isHost || playing)}</div>
          <div class="row"><label>Completar con bots</label>${this.seg('rBots', [[1, 'Sí'], [0, 'No']], cfg.botFill ? 1 : 0, !isHost || playing)}</div>
          <div class="row"><label>Bots</label>${this.seg('rDiff', [[0, DIFF_NAMES[0]], [1, DIFF_NAMES[1]], [2, DIFF_NAMES[2]]], cfg.botDifficulty, !isHost || playing)}</div>
        </div>
        ${err}
        <div class="actions">
          <button class="btn" data-on="leave">Salir de la sala</button>
          ${isHost
            ? `<button class="btn primary" data-on="start" id="onStart" ${playing || !allReady ? 'disabled' : ''}>${allReady ? 'Empezar partido' : 'Esperando que estén listos'}</button>`
            : `<button class="btn ${me?.ready ? '' : 'primary'}" data-on="ready" id="onReady" ${playing ? 'disabled' : ''}>${me?.ready ? 'No estoy listo' : '¡Estoy listo!'}</button>`}
        </div>
      </div>`);
      return;
    }
    if (scr === 'pause') {
      this.setHtml(root, `<div class="panel narrow"><h2>Partido online</h2>
        <p class="on-note">El partido sigue corriendo mientras estás en este menú.</p>
        <div class="menu-buttons">
          <button class="btn primary" data-on="resume">Seguir jugando</button>
          <button class="btn" data-on="abandon">Abandonar partido</button>
        </div></div>`);
      return;
    }
    if (scr === 'results' && this.match) {
      const e = this.endInfo;
      const myTeam = this.match.roster[this.match.localId]?.team ?? 0;
      const score = e?.score ?? this.match.world.score;
      const winner = e?.winner ?? this.match.world.winner;
      const title = winner === myTeam ? '¡Victoria!' : winner < 0 ? 'Empate' : 'Derrota';
      this.setHtml(root, `<div class="panel wide"><h2 id="onResult">${title}</h2>
        <div class="endscore"><span class="b">${score[0]}</span> – <span class="r">${score[1]}</span></div>
        ${this.statsTable()}
        <div class="actions">
          <button class="btn" data-on="abandon">Salir</button>
          <button class="btn primary" data-on="toLobby">Volver a la sala</button>
        </div></div>`);
      return;
    }
    this.setHtml(root, '');
    root.classList.add('hidden');
  }

  // ---------- Ajustes: URL del servidor ----------

  private injectSettingsRow() {
    const panel = document.querySelector('#settings .panel');
    const actions = panel?.querySelector('.actions');
    if (!panel || !actions || byId('onServerRow')) return;
    const row = document.createElement('div');
    row.className = 'row online-server';
    row.id = 'onServerRow';
    row.innerHTML = `<label for="onServer">Servidor online</label><input id="onServer" type="text" spellcheck="false" autocomplete="off">`;
    const input = row.querySelector('input')!;
    input.placeholder = defaultServerUrl(location);
    input.value = store.get(LS_SERVER);
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      store.set(LS_SERVER, normalizeServerUrl(input.value, location.protocol === 'https:'));
      input.value = store.get(LS_SERVER);
      // La próxima vez que se abra el online se conecta al nuevo servidor
      if (this.net && !this.active) { this.net.close(); this.net = null; this.room = null; this.screen = null; }
    });
    panel.insertBefore(row, actions);
  }
}
