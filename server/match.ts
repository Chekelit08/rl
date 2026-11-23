// Partido autoritativo del servidor: simula a 120 Hz con la MISMA simulación del cliente,
// aplica los inputs de cada jugador en su tick (con buffer de jitter), maneja bots, y manda
// snapshots cuantizados con compresión delta contra la última línea base confirmada por cada cliente.

import { BallPredictor, Bot, type Difficulty } from '../src/ai/bot.ts';
import { type CarInput, emptyInput } from '../src/sim/car.ts';
import { CAR_BODIES, DT } from '../src/sim/constants.ts';
import { type GameEvent, type MatchConfig, World } from '../src/sim/world.ts';
import {
  AUTHORITATIVE_EVENTS, encodeSnapshot, FULL, QUANT_EVERY, type RosterEntry, SNAPSHOT_EVERY, SNAPSHOT_EVERY_SLOW,
} from '../src/net/protocol.ts';
import { installNetRng, quantizeWorldInPlace, stateSignature } from '../src/net/state.ts';

export interface PeerSink {
  sendJson(obj: unknown): void;
  sendBinary(buf: ArrayBuffer): void;
  /** Bytes pendientes de envío (para detectar congestión). */
  buffered(): number;
}

interface Peer {
  playerId: string;
  carId: number;
  sink: PeerSink | null;
  ackSeq: number;
  slow: boolean;
  needFull: boolean;
  /** Último estado que se le mandó (línea base del próximo delta: WebSocket es confiable y ordenado). */
  lastSent: Float32Array | null;
  lastSentSeq: number;
}

/** Opciones globales del servidor (main.ts las toma del entorno). */
export const serverOptions = {
  /** Ticks entre snapshots: 2 = 60 Hz (por defecto), 4 = 30 Hz. */
  snapshotEvery: SNAPSHOT_EVERY,
};

const POST_GOAL_DELAY = 2.0; // segundos extra de festejo antes del kickoff (sin repetición online)
const LOSS_WINDOW = 120; // ticks (1 s) para medir inputs que no llegaron a tiempo

export class ServerMatch {
  world: World;
  roster: RosterEntry[];
  cfg: MatchConfig;
  id: number;
  sig: number;
  bots = new Map<number, Bot>();
  tempBots = new Map<number, Bot>(); // conducen autos de jugadores desconectados
  predictor = new BallPredictor();
  peers = new Map<string, Peer>();
  ended = false;
  onEnd: (score: number[], winner: number) => void = () => {};
  private inputs = new Map<number, Map<number, CarInput>>();
  private lastInput = new Map<number, CarInput>();
  private latestTick = new Map<number, number>();
  private lastActiveTick = new Map<number, number>();
  private miss = new Map<number, { win: Uint8Array; i: number; n: number }>();
  /** Buffer de jitter: el menor adelanto (ticks) con que llegaron los inputs de cada auto, por tramos de 250 ms. */
  private early = new Map<number, number[]>();
  private seq = 0;
  /** Segundos sin tocar nada antes de echar a un jugador. */
  afkSeconds = 120;
  private postGoal = 0;
  private botDifficulty: Difficulty;

  constructor(id: number, cfg: MatchConfig, roster: RosterEntry[], botDifficulty: Difficulty) {
    this.id = id;
    this.cfg = cfg;
    this.roster = roster;
    this.botDifficulty = botDifficulty;
    this.world = new World(cfg);
    for (const r of roster) {
      const c = this.world.addCar(r.team, r.name, r.body % CAR_BODIES.length, r.isBot);
      if (r.isBot) this.bots.set(c.id, new Bot(c, botDifficulty));
      else {
        this.inputs.set(c.id, new Map());
        this.lastActiveTick.set(c.id, 0);
        this.miss.set(c.id, { win: new Uint8Array(LOSS_WINDOW), i: 0, n: 0 });
      }
    }
    installNetRng(this.world, cfg.seed);
    this.world.setupKickoff();
    this.sig = stateSignature(this.world);
    this.quantizeAndSend(true);
  }

  startMsg(carId: number) {
    return { t: 'start', matchId: this.id, cfg: this.cfg, roster: this.roster, yourCarId: carId, sig: this.sig, quantEvery: QUANT_EVERY };
  }

  attach(playerId: string, carId: number, sink: PeerSink) {
    this.peers.set(playerId, { playerId, carId, sink, ackSeq: FULL, slow: false, needFull: true, lastSent: null, lastSentSeq: 0 });
    this.tempBots.delete(carId);
    this.lastActiveTick.set(carId, this.world.tick);
    sink.sendJson(this.startMsg(carId));
    // El estado completo sale en el próximo tick cuantizado
  }

  /** El cliente perdió la línea base (no debería pasar con TCP): mandarle un estado completo. */
  resync(playerId: string) {
    const p = this.peers.get(playerId);
    if (p) p.needFull = true;
  }

  /** true si faltaron los inputs de los últimos n ticks seguidos. */
  private recentMisses(carId: number, n: number) {
    const m = this.miss.get(carId);
    if (!m) return false;
    for (let k = 1; k <= n; k++) if (!m.win[(m.i - k + LOSS_WINDOW) % LOSS_WINDOW]) return false;
    return true;
  }

  /** Fracción de ticks del último segundo en que el input del auto no llegó a tiempo. */
  inputLoss(carId: number) {
    const m = this.miss.get(carId);
    return m ? m.n / LOSS_WINDOW : 0;
  }

  detach(playerId: string) {
    const p = this.peers.get(playerId);
    if (!p) return;
    p.sink = null;
    // Mientras no vuelva, un bot maneja su auto
    const car = this.world.cars[p.carId];
    if (car) this.tempBots.set(p.carId, new Bot(car, this.botDifficulty));
  }

  /** Paquete de inputs de un jugador. */
  onInputs(playerId: string, ackSeq: number, lastTick: number, inputs: CarInput[]) {
    const p = this.peers.get(playerId);
    if (!p) return;
    if (ackSeq !== FULL) p.ackSeq = ackSeq;
    const buf = this.inputs.get(p.carId);
    if (!buf) return;
    const first = lastTick - inputs.length + 1;
    for (let k = 0; k < inputs.length; k++) {
      const t = first + k;
      if (t <= this.world.tick) continue; // llegó tarde: ese tick ya se simuló
      if (t > this.world.tick + 240) continue; // absurdo (reloj del cliente roto)
      buf.set(t, inputs[k]);
    }
    const prev = this.latestTick.get(p.carId) ?? 0;
    if (lastTick > prev) this.latestTick.set(p.carId, lastTick);
    let e = this.early.get(p.carId);
    if (!e) { e = [Infinity, Infinity, Infinity, Infinity]; this.early.set(p.carId, e); }
    e[0] = Math.min(e[0], lastTick - this.world.tick);
  }

  /** Avanza un tick (1/120 s). */
  step(): GameEvent[] {
    const w = this.world;
    const t = w.tick + 1;
    this.predictor.update(w);
    const inputs = w.cars.map((c) => {
      const bot = this.bots.get(c.id) ?? this.tempBots.get(c.id);
      if (bot) return bot.think(w, this.predictor, DT);
      const buf = this.inputs.get(c.id);
      const inp = buf?.get(t);
      const m = this.miss.get(c.id);
      if (m) {
        const missed = inp ? 0 : 1;
        m.n += missed - m.win[m.i];
        m.win[m.i] = missed;
        m.i = (m.i + 1) % LOSS_WINDOW;
      }
      if (inp) {
        this.lastInput.set(c.id, inp);
        buf!.delete(t);
        if (inp.throttle || inp.steer || inp.jump || inp.boost || inp.pitch || inp.yaw || inp.roll || inp.handbrake) {
          this.lastActiveTick.set(c.id, t);
        }
        return inp;
      }
      // Input faltante: repetimos el último (como el estándar del género) durante un rato corto;
      // si deja de llegar (pestaña en segundo plano, corte), el auto suelta los controles.
      if (m && m.n > 30 && this.recentMisses(c.id, 30)) return emptyInput();
      return this.lastInput.get(c.id) ?? emptyInput();
    });
    for (const buf of this.inputs.values()) for (const k of buf.keys()) if (k <= t) buf.delete(k);
    w.step(inputs);

    const events = w.takeEvents();
    for (const e of events) {
      if (AUTHORITATIVE_EVENTS.has(e.type)) this.broadcast({ t: 'ev', tick: w.tick, e });
      if (e.type === 'end' && !this.ended) {
        this.ended = true;
        this.onEnd([...w.score], w.winner);
      }
    }

    // Después del gol: festejo y nuevo kickoff (el servidor decide; los clientes lo reciben en el estado)
    if (w.phase === 'goal' && w.phaseTimer <= 0) {
      this.postGoal += DT;
      if (this.postGoal >= POST_GOAL_DELAY) { w.setupKickoff(); this.postGoal = 0; }
    } else this.postGoal = 0;

    if (w.tick % 30 === 0) for (const e of this.early.values()) { e.pop(); e.unshift(Infinity); }
    if (w.tick % QUANT_EVERY === 0) this.quantizeAndSend(false);
    return events;
  }

  private quantizeAndSend(initial: boolean) {
    const w = this.world;
    const flat = quantizeWorldInPlace(w);
    this.seq++;
    for (const p of this.peers.values()) {
      if (!p.sink) continue;
      // Congestión: si el socket acumula, bajamos a 30 Hz para ese cliente
      const buffered = p.sink.buffered();
      if (buffered > 64 * 1024) p.slow = true;
      else if (buffered < 8 * 1024) p.slow = false;
      const every = p.slow ? Math.max(SNAPSHOT_EVERY_SLOW, serverOptions.snapshotEvery) : serverOptions.snapshotEvery;
      if (!initial && !p.needFull && w.tick % every !== 0) continue;
      if (buffered > 512 * 1024) continue; // cliente colgado: no seguir acumulando (el próximo delta es contra lo último enviado)
      const base = p.needFull ? null : p.lastSent;
      // Slack: el peor adelanto del último segundo (lo que el cliente ajusta con la dilatación de tiempo)
      const e = this.early.get(p.carId);
      const worst = e ? Math.min(...e) : Infinity;
      const slack = Number.isFinite(worst) ? worst : (this.latestTick.get(p.carId) ?? w.tick) - w.tick;
      const buf = encodeSnapshot({
        seq: this.seq, tick: w.tick, baseline: base ? p.lastSentSeq : FULL, slack, sig: this.sig, loss: this.inputLoss(p.carId),
      }, flat, base);
      p.sink.sendBinary(buf);
      p.lastSent = flat;
      p.lastSentSeq = this.seq;
      p.needFull = false;
    }
  }

  broadcast(obj: unknown) {
    for (const p of this.peers.values()) p.sink?.sendJson(obj);
  }

  /** Jugadores que no tocan nada hace mucho (para echarlos). */
  afkPlayers(): string[] {
    const out: string[] = [];
    if (this.world.phase !== 'playing') return out;
    for (const p of this.peers.values()) {
      if (!p.sink) continue;
      const last = this.lastActiveTick.get(p.carId) ?? 0;
      if (this.world.tick - last > this.afkSeconds / DT) out.push(p.playerId);
    }
    return out;
  }
}
