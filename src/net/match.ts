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
import { installNetRng, maxDiff, quantizeWorldInPlace, restoreWorld, stateSignature } from './state.ts';

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
  /** Fracción de inputs propios que no llegaron a tiempo al servidor (0..1). */
  loss: number;
  rollbacks: number;
  resimTicks: number;
  slack: number;
  timeScale: number;
  lead: number;
  maxCorrection: number;
  /** Snapshots comparados contra la predicción y cuántos coincidieron bit a bit. */
  checked: number;
  exact: number;
  /** Error de posición del auto propio entre lo predicho y lo que dijo el servidor (último y máximo). */
  localErr: number;
  localErrMax: number;
  /** Bytes por segundo recibidos en snapshots (promedio móvil). */
  bytesPerSec: number;
}

export class OnlineMatch {
  world: World;
  localId: number;
  roster: RosterEntry[];
  info: MatchStartInfo;
  ready = false; // recibió el primer estado
  incompatible = '';
  stats: NetStats = {
    ping: 0, jitter: 0, loss: 0, rollbacks: 0, resimTicks: 0, slack: 0, timeScale: 1, lead: 0, maxCorrection: 0,
    checked: 0, exact: 0, localErr: 0, localErrMax: 0, bytesPerSec: 0,
  };
  /** Último tick del servidor recibido. */
  serverTick = 0;

  private net: NetClient;
  private inputs = new Map<number, CarInput>();
  private lastLocal: CarInput = emptyInput();
  private history = new Map<number, Float32Array>();
  private base: Float32Array | null = null;
  private lastSeq = 0;
  private ackSeq = FULL;
  private lastServerAt = 0;
  private acc = 0;
  private timeScale = 1;
  private slack = 0;
  private smoother = new Smoother();
  private pendingEvents: GameEvent[] = [];
  private scratch: World;
  private resyncAt = 0;
  private bytesWin: { t: number; b: number }[] = [];
  private pending: { tick: number; flat: Float32Array } | null = null;
  private lastRollbackAt = 0;
  /** Lo que tarda una corrección (ms, promedio móvil): limita cuántas por segundo hacemos. */
  private rollbackCost = 0;
  /** Fracción máxima del tiempo que dedicamos a re-simular. */
  rollbackBudget = 0.2;

  constructor(net: NetClient, info: MatchStartInfo) {
    this.net = net;
    this.info = info;
    this.roster = info.roster;
    this.localId = info.yourCarId;
    this.world = buildWorldFromRoster(info.cfg, info.roster);
    this.scratch = buildWorldFromRoster(info.cfg, info.roster);
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
    if (this.incompatible) return;
    const h = decodeSnapshotHeader(buf);
    if (h.seq <= this.lastSeq && this.lastSeq !== 0 && h.baseline !== FULL) return;
    const flat = decodeSnapshotBody(buf, h.delta && h.baseline === this.lastSeq ? this.base : null);
    if (!flat) {
      // Falta la línea base (no debería pasar con TCP): pedir un estado completo
      const t = now();
      if (t - this.resyncAt > 500) { this.resyncAt = t; this.net.send({ t: 'resync' }); }
      return;
    }
    const t = now();
    this.bytesWin.push({ t, b: buf.byteLength });
    while (this.bytesWin.length && t - this.bytesWin[0].t > 2000) this.bytesWin.shift();
    this.lastSeq = h.seq;
    this.base = flat;
    this.ackSeq = h.seq;
    this.slack = h.slack;
    this.stats.loss = h.loss;
    this.serverTick = h.tick;
    this.lastServerAt = t;

    if (!this.ready) {
      if (!this.tryRestore(this.world, flat)) return;
      this.history.set(h.tick, flat);
      this.ready = true;
      // Arrancamos adelantados: lo que tarda en llegar el input al servidor + margen
      const lead = this.targetLead();
      for (let i = 0; i < lead; i++) this.stepPredicted(true);
      return;
    }

    // Comparar contra lo predicho es barato; re-simular no. Si coincide bit a bit, no hay nada que corregir
    // (y cualquier corrección pendiente más vieja queda obsoleta).
    const predicted = h.tick <= this.world.tick ? this.history.get(h.tick) : undefined;
    if (predicted) {
      this.stats.checked++;
      if (maxDiff(predicted, flat) === 0) {
        this.stats.exact++;
        this.stats.localErr = 0;
        this.pending = null;
        this.pruneHistory(h.tick);
        return;
      }
      if (predicted.length === flat.length) {
        // Cuánto se equivocó la predicción del auto propio (para estadísticas y pruebas)
        const pa = this.localPos(predicted), pb = this.localPos(flat);
        if (pa && pb) {
          this.stats.localErr = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
          this.stats.localErrMax = Math.max(this.stats.localErrMax, this.stats.localErr);
        }
      }
    }
    // La corrección se aplica en tick(), con la más nueva y con un tope de frecuencia según lo que cuesta
    this.pending = { tick: h.tick, flat };
  }

  /** Aplica el último estado del servidor: rollback y re-simulación hasta el presente. */
  private applyPending() {
    const p = this.pending!;
    this.pending = null;
    const t0 = now();
    const before = this.smoother.apply(this.world.snapshot());
    if (p.tick > this.world.tick) {
      // El servidor va adelante nuestro (por ejemplo, después de un tirón): saltamos a su estado
      if (!this.tryRestore(this.world, p.flat)) return;
      this.history.clear();
      this.history.set(p.tick, p.flat);
      const lead = this.targetLead();
      for (let i = 0; i < lead; i++) this.stepPredicted(true);
      this.stats.resimTicks += lead;
    } else {
      const target = this.world.tick;
      if (!this.tryRestore(this.world, p.flat)) return;
      this.history.set(p.tick, p.flat);
      let n = 0;
      while (this.world.tick < target) { this.stepPredicted(true); n++; }
      this.stats.resimTicks += n;
    }
    const after = this.world.snapshot();
    this.smoother.correct(before, after);
    this.stats.rollbacks++;
    let maxC = 0;
    for (let i = 0; i < after.cars.length; i++) {
      const a = before.cars[i], b = after.cars[i];
      if (a && b && !a.demoed && !b.demoed) maxC = Math.max(maxC, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    this.stats.maxCorrection = Math.max(this.stats.maxCorrection * 0.98, maxC);
    this.pruneHistory(p.tick);
    const t1 = now();
    this.rollbackCost = this.rollbackCost ? this.rollbackCost * 0.8 + (t1 - t0) * 0.2 : t1 - t0;
    this.lastRollbackAt = t1;
  }

  private tryRestore(w: World, flat: Float32Array) {
    try {
      restoreWorld(w, flat);
      return true;
    } catch {
      this.incompatible = 'El estado del servidor no coincide con esta versión del juego. Recargá la página.';
      return false;
    }
  }

  private localPos(flat: Float32Array): [number, number, number] | null {
    try {
      restoreWorld(this.scratch, flat);
    } catch { return null; }
    const c = this.scratch.cars[this.localId];
    return c ? [c.pos.x, c.pos.y, c.pos.z] : null;
  }

  private pruneHistory(serverTick: number) {
    for (const k of this.history.keys()) if (k < serverTick) this.history.delete(k);
    for (const k of this.inputs.keys()) if (k < serverTick - 30) this.inputs.delete(k);
  }

  /** Ticks que vamos adelantados al servidor: medio RTT + margen anti-jitter. */
  private targetLead() {
    const rtt = this.net.rtt || 80;
    return Math.ceil(rtt / 2 / (DT * 1000)) + this.wantSlack();
  }

  /** Margen (en ticks) con que queremos que lleguen nuestros inputs al servidor: el buffer de jitter. */
  private wantSlack() {
    return Math.min(10, Math.max(2, Math.ceil((this.net.rttVar * 1.5) / (DT * 1000)))) + 1;
  }

  private estimatedServerTick() {
    if (!this.lastServerAt) return this.serverTick;
    return this.serverTick + (now() - this.lastServerAt) / (DT * 1000);
  }

  /** Un paso de la simulación predicha. */
  private stepPredicted(resim: boolean, local?: CarInput) {
    const w = this.world;
    const t = w.tick + 1;
    if (local) this.inputs.set(t, local);
    const mine = this.inputs.get(t) ?? this.lastLocal;
    // Copia: restoreWorld escribe car.input en el lugar y no debe tocar el historial de inputs.
    // Los demás autos repiten su último input conocido (extrapolación).
    const inputs = w.cars.map((c) => (c.id === this.localId ? { ...mine } : c.input));
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
    if (this.pending && now() - this.lastRollbackAt >= this.rollbackCost / this.rollbackBudget) this.applyPending();
    const q = quantizeInput(localInput);
    // Control del margen: slack = con cuántos ticks de anticipación llegó el input más atrasado del último
    // segundo al servidor (el servidor ya mide el jitter). Apuntamos a un margen chico pero positivo.
    const err = this.slack - (this.stats.loss > 0.02 ? 3 : 2);
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
    this.stats.slack = this.slack;
    this.stats.timeScale = this.timeScale;
    this.stats.lead = Math.round(this.world.tick - est);
    const win = this.bytesWin;
    if (win.length > 1) this.stats.bytesPerSec = win.reduce((a, x) => a + x.b, 0) / Math.max(0.5, (win[win.length - 1].t - win[0].t) / 1000);
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
