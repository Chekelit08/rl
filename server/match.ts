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
}

const POST_GOAL_DELAY = 2.0; // segundos extra de festejo antes del kickoff (sin repetición online)
const AFK_SECONDS = 150;

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
  private history = new Map<number, Float32Array>();
  private seq = 0;
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
    this.peers.set(playerId, { playerId, carId, sink, ackSeq: FULL, slow: false, needFull: true });
    this.tempBots.delete(carId);
    this.lastActiveTick.set(carId, this.world.tick);
    sink.sendJson(this.startMsg(carId));
    // El estado completo sale en el próximo tick cuantizado
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
    if (ackSeq !== FULL && this.history.has(ackSeq)) { p.ackSeq = ackSeq; p.needFull = false; }
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
      if (inp) {
        this.lastInput.set(c.id, inp);
        buf!.delete(t);
        if (inp.throttle || inp.steer || inp.jump || inp.boost || inp.pitch || inp.yaw || inp.roll || inp.handbrake) {
          this.lastActiveTick.set(c.id, t);
        }
        return inp;
      }
      // Input faltante: repetimos el último (como el estándar del género)
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

    if (w.tick % QUANT_EVERY === 0) this.quantizeAndSend(false);
    return events;
  }

  private quantizeAndSend(initial: boolean) {
    const w = this.world;
    const flat = quantizeWorldInPlace(w);
    this.seq++;
    this.history.set(this.seq, flat);
    this.history.delete(this.seq - 160);
    for (const p of this.peers.values()) {
      if (!p.sink) continue;
      // Congestión: si el socket acumula, bajamos a 30 Hz para ese cliente
      const buffered = p.sink.buffered();
      if (buffered > 64 * 1024) p.slow = true;
      else if (buffered < 8 * 1024) p.slow = false;
      const every = p.slow ? SNAPSHOT_EVERY_SLOW : SNAPSHOT_EVERY;
      if (!initial && !p.needFull && w.tick % every !== 0) continue;
      if (buffered > 512 * 1024) continue; // cliente colgado: no seguir acumulando
      const base = p.needFull ? null : this.history.get(p.ackSeq) ?? null;
      const slack = (this.latestTick.get(p.carId) ?? w.tick) - w.tick;
      const buf = encodeSnapshot({ seq: this.seq, tick: w.tick, baseline: base ? p.ackSeq : FULL, slack, sig: this.sig }, flat, base);
      p.sink.sendBinary(buf);
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
      if (this.world.tick - last > AFK_SECONDS / DT) out.push(p.playerId);
    }
    return out;
  }
}
