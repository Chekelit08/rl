// Partido online del lado del cliente: predicción local + rollback y re-simulación al recibir el estado
// autoritativo, suavizado visual de correcciones, extrapolación de los demás con su último input y
// sincronización de reloj (dilatación de tiempo) para que los inputs lleguen justo a tiempo al servidor.
// Sin DOM: lo usa el navegador y las pruebas en Node.

import { type CarInput, emptyInput } from '../sim/car.ts';
import { CAR_BODIES, DT } from '../sim/constants.ts';
import { Quat } from '../sim/math.ts';
import { type GameEvent, type Snapshot, World } from '../sim/world.ts';
import type { NetClient } from './client.ts';
import { now } from './client.ts';
import {
  AUTHORITATIVE_EVENTS, decodeSnapshotBody, decodeSnapshotHeader, encodeInputs, FULL, PREDICTED_EVENTS,
  quantizeInput, type RosterEntry, type ServerMsg,
} from './protocol.ts';
import { captureWorld, installNetRng, maxDiff, quantizeWorldInPlace, restoreWorld, stateSignature } from './state.ts';

export interface MatchStartInfo {
  matchId: number;
  cfg: World['cfg'];
  roster: RosterEntry[];
  yourCarId: number;
  sig: number;
  quantEvery: number;
}

/** Construye el mundo exactamente igual que el servidor (mismo orden de autos y misma semilla). */
export function buildWorldFromRoster(cfg: World['cfg'], roster: RosterEntry[]): World {
  const w = new World(cfg);
  for (const r of roster) w.addCar(r.team, r.name, r.body % CAR_BODIES.length, r.isBot);
  installNetRng(w, cfg.seed);
  return w;
}

interface Offset { x: number; y: number; z: number; q: Quat }

/** Suaviza visualmente las correcciones del rollback (el estado simulado es exacto; lo que se dibuja converge). */
class Smoother {
  cars = new Map<number, Offset>();
  ball: Offset = { x: 0, y: 0, z: 0, q: new Quat() };

  correct(before: Snapshot, after: Snapshot) {
    for (let i = 0; i < after.cars.length; i++) {
      const a = before.cars[i], b = after.cars[i];
      if (!a || !b) continue;
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      if (a.demoed !== b.demoed || Math.hypot(dx, dy, dz) > 350) { this.cars.delete(b.id); continue; }
      const qa = new Quat(a.qx, a.qy, a.qz, a.qw), qb = new Quat(b.qx, b.qy, b.qz, b.qw);
      this.cars.set(b.id, { x: dx, y: dy, z: dz, q: qa.mul(qb.conj()).normIn() });
    }
    const ba = before.ball, bb = after.ball;
    const d = Math.hypot(ba.x - bb.x, ba.y - bb.y, ba.z - bb.z);
    if (d > 500 || ba.hidden !== bb.hidden) this.ball = { x: 0, y: 0, z: 0, q: new Quat() };
    else {
      const qa = new Quat(ba.qx, ba.qy, ba.qz, ba.qw), qb = new Quat(bb.qx, bb.qy, bb.qz, bb.qw);
      this.ball = { x: ba.x - bb.x, y: ba.y - bb.y, z: ba.z - bb.z, q: qa.mul(qb.conj()).normIn() };
    }
  }

  decay(dt: number) {
    const k = Math.exp(-dt * 14);
    const kb = Math.exp(-dt * 18);
    const id = new Quat();
    for (const [key, o] of this.cars) {
      o.x *= k; o.y *= k; o.z *= k;
      o.q = id.slerp(o.q, k);
      if (Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.z) < 0.05 && Math.abs(o.q.w) > 0.99999) this.cars.delete(key);
    }
    const b = this.ball;
    b.x *= kb; b.y *= kb; b.z *= kb;
    b.q = id.slerp(b.q, kb);
  }

  apply(s: Snapshot): Snapshot {
    const cars = s.cars.map((c) => {
      const o = this.cars.get(c.id);
      if (!o) return c;
      const q = o.q.mul(new Quat(c.qx, c.qy, c.qz, c.qw));
      return { ...c, x: c.x + o.x, y: c.y + o.y, z: c.z + o.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    });
    const b = this.ball;
    const bq = b.q.mul(new Quat(s.ball.qx, s.ball.qy, s.ball.qz, s.ball.qw));
    const ball = { ...s.ball, x: s.ball.x + b.x, y: s.ball.y + b.y, z: s.ball.z + b.z, qx: bq.x, qy: bq.y, qz: bq.z, qw: bq.w };
    return { ...s, cars, ball };
  }
}

export interface NetStats {
  ping: number;
  jitter: number;
  loss: number; // 0..1
  rollbacks: number;
  resimTicks: number;
  slack: number;
  timeScale: number;
  lead: number;
  maxCorrection: number;
}

export class OnlineMatch {
  world: World;
  localId: number;
  roster: RosterEntry[];
  info: MatchStartInfo;
  ready = false; // recibió el primer estado
  incompatible = '';
  stats: NetStats = { ping: 0, jitter: 0, loss: 0, rollbacks: 0, resimTicks: 0, slack: 0, timeScale: 1, lead: 0, maxCorrection: 0 };

  private net: NetClient;
  private inputs = new Map<number, CarInput>();
  private lastLocal: CarInput = emptyInput();
  private history = new Map<number, Float32Array>();
  private received = new Map<number, Float32Array>();
  private lastSeq = 0;
  private ackSeq = FULL;
  private lastServerTick = 0;
  private lastServerAt = 0;
  private acc = 0;
  private timeScale = 1;
  private slack = 0;
  private smoother = new Smoother();
  private pendingEvents: GameEvent[] = [];
  private seqWindow: number[] = [];
  private flatLen = -1;

  constructor(net: NetClient, info: MatchStartInfo) {
    this.net = net;
    this.info = info;
    this.roster = info.roster;
    this.localId = info.yourCarId;
    this.world = buildWorldFromRoster(info.cfg, info.roster);
    const sig = stateSignature(this.world);
    if (sig !== info.sig) this.incompatible = 'Tu versión del juego no coincide con la del servidor. Recargá la página.';
  }

  /** Mensajes JSON del servidor relevantes para el partido. */
  handleMessage(m: ServerMsg) {
    if (m.t === 'ev') {
      if (AUTHORITATIVE_EVENTS.has(m.e.type)) this.pendingEvents.push(m.e);
    }
  }

  /** Snapshot binario (estado autoritativo). */
  handleSnapshot(buf: ArrayBuffer) {
    const h = decodeSnapshotHeader(buf);
    if (h.seq <= this.lastSeq && this.lastSeq !== 0) return;
    const base = h.delta ? this.received.get(h.baseline) ?? null : null;
    const flat = decodeSnapshotBody(buf, base);
    if (!flat) return; // falta la línea base: esperamos un completo
    // Pérdida estimada: huecos en la secuencia (el servidor numera todos los ticks cuantizados)
    if (this.lastSeq) this.seqWindow.push(h.seq - this.lastSeq);
    if (this.seqWindow.length > 120) this.seqWindow.shift();
    this.lastSeq = h.seq;
    this.received.set(h.seq, flat);
    for (const k of this.received.keys()) if (k < h.seq - 200) this.received.delete(k);
    this.ackSeq = h.seq;
    this.slack = h.slack;
    this.lastServerTick = h.tick;
    this.lastServerAt = now();

    if (this.flatLen >= 0 && flat.length !== this.flatLen) {
      // Estructura distinta: no se puede aplicar sin corromper el estado
      if (!this.incompatible) this.incompatible = 'El estado del servidor no coincide con esta versión del juego.';
      return;
    }

    if (!this.ready) {
      restoreWorld(this.world, flat);
      this.flatLen = captureWorld(this.world).length;
      if (flat.length !== this.flatLen) { this.incompatible = 'El estado del servidor no coincide con esta versión del juego.'; return; }
      this.history.set(h.tick, flat);
      this.ready = true;
      // Arrancamos adelantados: lo que tarda en llegar el input al servidor + margen
      const lead = this.targetLead();
      for (let i = 0; i < lead; i++) this.stepPredicted(true);
      return;
    }

    if (h.tick > this.world.tick) {
      // El servidor va adelante nuestro (por ejemplo, después de un tirón): saltamos a su estado
      const before = this.smoother.apply(this.world.snapshot());
      restoreWorld(this.world, flat);
      this.history.clear();
      this.history.set(h.tick, flat);
      const lead = this.targetLead();
      for (let i = 0; i < lead; i++) this.stepPredicted(true);
      this.smoother.correct(before, this.world.snapshot());
      this.stats.rollbacks++;
      return;
    }

    const predicted = this.history.get(h.tick);
    const diff = predicted ? maxDiff(predicted, flat) : Infinity;
    if (diff === 0) {
      this.pruneHistory(h.tick);
      return;
    }
    // Rollback: restaurar el estado del servidor y re-simular hasta el presente
    const target = this.world.tick;
    const before = this.smoother.apply(this.world.snapshot());
    restoreWorld(this.world, flat);
    this.history.set(h.tick, flat);
    let n = 0;
    while (this.world.tick < target) { this.stepPredicted(true); n++; }
    const after = this.world.snapshot();
    this.smoother.correct(before, after);
    this.stats.rollbacks++;
    this.stats.resimTicks += n;
    let maxC = 0;
    for (let i = 0; i < after.cars.length; i++) {
      const a = before.cars[i], b = after.cars[i];
      if (a && b && !a.demoed && !b.demoed) maxC = Math.max(maxC, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    this.stats.maxCorrection = Math.max(this.stats.maxCorrection * 0.98, maxC);
    this.pruneHistory(h.tick);
  }

  private pruneHistory(serverTick: number) {
    for (const k of this.history.keys()) if (k < serverTick) this.history.delete(k);
    for (const k of this.inputs.keys()) if (k < serverTick - 30) this.inputs.delete(k);
  }

  /** Ticks que vamos adelantados al servidor: medio RTT + margen anti-jitter. */
  private targetLead() {
    const rtt = this.net.rtt || 80;
    const jitter = Math.min(8, Math.max(2, Math.ceil((this.net.rttVar * 1.5) / (DT * 1000))));
    return Math.ceil(rtt / 2 / (DT * 1000)) + jitter + 1;
  }

  private estimatedServerTick() {
    if (!this.lastServerAt) return this.lastServerTick;
    return this.lastServerTick + (now() - this.lastServerAt) / (DT * 1000);
  }

  /** Un paso de la simulación predicha. */
  private stepPredicted(resim: boolean, local?: CarInput) {
    const w = this.world;
    const t = w.tick + 1;
    if (local) this.inputs.set(t, local);
    const mine = this.inputs.get(t) ?? this.lastLocal;
    const inputs = w.cars.map((c) => (c.id === this.localId ? mine : c.input));
    w.step(inputs);
    if (t % this.info.quantEvery === 0) this.history.set(t, quantizeWorldInPlace(w));
    const evs = w.takeEvents();
    if (!resim) for (const e of evs) if (PREDICTED_EVENTS.has(e.type)) this.pendingEvents.push(e);
  }

  /**
   * Llamar a 120 Hz (tiempo real). Avanza la predicción con dilatación de tiempo para mantener el margen
   * de inputs que pide el servidor. Devuelve los eventos para HUD/audio/efectos.
   */
  tick(localInput: CarInput, dt = DT): GameEvent[] {
    this.smoother.decay(dt);
    if (!this.ready || this.incompatible) return this.takePending();
    const q = quantizeInput(localInput);
    // Control del margen: slack = cuántos ticks antes llegan nuestros inputs al servidor
    const want = Math.min(8, Math.max(2, Math.ceil((this.net.rttVar * 1.5) / (DT * 1000)))) + 1;
    const err = this.slack - want;
    const targetScale = Math.max(0.94, Math.min(1.06, 1 - err * 0.01));
    this.timeScale += (targetScale - this.timeScale) * 0.05;
    this.acc += this.timeScale;
    // Corrección dura si nos fuimos muy de rango (pestaña en segundo plano, tirón de red, etc.)
    const est = this.estimatedServerTick();
    const lead = this.targetLead();
    const ahead = this.world.tick - est;
    let steps = 0;
    if (ahead < lead - 25) this.acc += Math.min(30, lead - ahead);
    if (ahead > lead + 60) this.acc = 0;
    while (this.acc >= 1 && steps < 40) {
      this.stepPredicted(false, q);
      this.lastLocal = q;
      this.sendInputs();
      this.acc -= 1;
      steps++;
    }
    // Estadísticas
    this.stats.ping = Math.round(this.net.rtt);
    this.stats.jitter = Math.round(this.net.rttVar);
    const gaps = this.seqWindow;
    if (gaps.length) {
      const expected = gaps.reduce((a, g) => a + 1, 0);
      const missing = gaps.reduce((a, g) => a + Math.max(0, g - 1), 0);
      // Con 30 Hz por congestión el servidor saltea secuencias a propósito: no lo contamos como pérdida
      const every = Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length);
      this.stats.loss = every > 1 ? 0 : missing / (expected + missing);
    }
    this.stats.slack = this.slack;
    this.stats.timeScale = this.timeScale;
    this.stats.lead = Math.round(this.world.tick - est);
    return this.takePending();
  }

  private sendInputs() {
    const t = this.world.tick;
    const list: CarInput[] = [];
    for (let k = t - 5; k <= t; k++) list.push(this.inputs.get(k) ?? this.lastLocal);
    this.net.sendBinary(encodeInputs(this.ackSeq, t, list));
  }

  private takePending() {
    const e = this.pendingEvents;
    this.pendingEvents = [];
    return e;
  }

  /** Estado para dibujar (con el suavizado de correcciones aplicado). */
  snapshot(): Snapshot {
    return this.smoother.apply(this.world.snapshot());
  }
}
