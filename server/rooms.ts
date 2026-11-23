// Salas: código de 5 letras, equipos, listo/arrancar, relleno con bots, reconexión e inactividad.

import type { Difficulty } from '../src/ai/bot.ts';
import { DT } from '../src/sim/constants.ts';
import { World } from '../src/sim/world.ts';
import {
  type ClientMsg, decodeInputs, type LobbyPlayer, MSG_INPUT, normalizeCode, PROTOCOL_VERSION, randomCode, randomToken,
  type RoomConfig, type RosterEntry, type ServerMsg,
} from '../src/net/protocol.ts';
import { type PeerSink, ServerMatch } from './match.ts';

export interface Socket {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  bufferedAmount: number;
}

export class Player {
  id: string;
  token: string;
  name = 'Jugador';
  body = 0;
  team = 0;
  ready = false;
  socket: Socket | null = null;
  room: Room | null = null;
  lastSeen = Date.now();
  disconnectedAt = 0;
  constructor(id: string, token: string) { this.id = id; this.token = token; }

  sendJson(obj: ServerMsg | Record<string, unknown>) {
    try { this.socket?.send(JSON.stringify(obj)); } catch { /* socket cerrado */ }
  }

  sink(): PeerSink {
    return {
      sendJson: (o) => this.sendJson(o as ServerMsg),
      sendBinary: (b) => { try { this.socket?.send(b); } catch { /* cerrado */ } },
      buffered: () => this.socket?.bufferedAmount ?? 0,
    };
  }
}

export const DEFAULT_ROOM: RoomConfig = { teamSize: 2, duration: 300, botFill: true, botDifficulty: 1 };

let matchCounter = 1;

export class Room {
  code: string;
  cfg: RoomConfig;
  players: Player[] = [];
  hostId = '';
  state: 'lobby' | 'playing' | 'results' = 'lobby';
  match: ServerMatch | null = null;
  emptySince = 0;
  private resultsTimer = 0;
  private acc = 0;
  private noHumans = 0;

  constructor(code: string, cfg: RoomConfig) {
    this.code = code;
    this.cfg = { ...DEFAULT_ROOM, ...cfg };
    this.sanitize();
  }

  private sanitize() {
    const c = this.cfg;
    c.teamSize = Math.max(1, Math.min(3, Math.round(c.teamSize || 2)));
    c.duration = [120, 180, 300, 600].includes(c.duration) ? c.duration : 300;
    c.botFill = !!c.botFill;
    c.botDifficulty = (Math.max(0, Math.min(2, Math.round(c.botDifficulty ?? 1))) as Difficulty);
  }

  capacity() { return this.cfg.teamSize * 2; }

  add(p: Player) {
    if (!this.players.includes(p)) {
      // Al equipo con menos jugadores
      const n0 = this.players.filter((x) => x.team === 0).length;
      const n1 = this.players.filter((x) => x.team === 1).length;
      p.team = n0 <= n1 ? 0 : 1;
      p.ready = false;
      this.players.push(p);
    }
    p.room = this;
    if (!this.hostId || !this.players.some((x) => x.id === this.hostId)) this.hostId = p.id;
    this.emptySince = 0;
    this.broadcastRoom();
  }

  remove(p: Player) {
    this.players = this.players.filter((x) => x !== p);
    p.room = null;
    if (this.match) this.match.detach(p.id);
    if (this.hostId === p.id) this.hostId = this.players.find((x) => x.socket)?.id ?? this.players[0]?.id ?? '';
    if (!this.players.length) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  lobbyPlayers(): LobbyPlayer[] {
    return this.players.map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, connected: !!p.socket, body: p.body, host: p.id === this.hostId }));
  }

  broadcastRoom() {
    for (const p of this.players) p.sendJson({ t: 'room', code: this.code, state: this.state, players: this.lobbyPlayers(), cfg: this.cfg, you: p.id });
  }

  setConfig(by: Player, cfg: Partial<RoomConfig>) {
    if (by.id !== this.hostId || this.state !== 'lobby') return;
    Object.assign(this.cfg, cfg);
    this.sanitize();
    // Si achicamos el modo, rebalancear equipos
    for (const t of [0, 1]) {
      const members = this.players.filter((p) => p.team === t);
      while (members.length > this.cfg.teamSize) {
        const m = members.pop()!;
        m.team = 1 - t;
      }
    }
    this.players.forEach((p) => (p.ready = false));
    this.broadcastRoom();
  }

  setTeam(p: Player, team: number) {
    if (this.state !== 'lobby') return;
    const t = team ? 1 : 0;
    if (this.players.filter((x) => x.team === t && x !== p).length >= this.cfg.teamSize) {
      p.sendJson({ t: 'error', msg: 'Ese equipo está completo' });
      return;
    }
    p.team = t;
    p.ready = false;
    this.broadcastRoom();
  }

  start(by: Player) {
    if (by.id !== this.hostId) { by.sendJson({ t: 'error', msg: 'Sólo el anfitrión puede empezar' }); return; }
    if (this.state !== 'lobby') return;
    const humans = this.players.filter((p) => p.socket);
    if (humans.some((p) => !p.ready && p.id !== this.hostId)) { by.sendJson({ t: 'error', msg: 'Hay jugadores que no están listos' }); return; }
    // Plantel: equipo azul y después rojo; humanos primero, bots completan si está activado
    const roster: RosterEntry[] = [];
    let carId = 0, botIdx = 0;
    for (const team of [0, 1]) {
      const members = humans.filter((p) => p.team === team).slice(0, this.cfg.teamSize);
      for (const p of members) roster.push({ carId: carId++, name: p.name, team, body: p.body, isBot: false, playerId: p.id });
      if (this.cfg.botFill) {
        for (let i = members.length; i < this.cfg.teamSize; i++) {
          roster.push({ carId: carId++, name: World.botName(botIdx), team, body: (botIdx * 2 + 1) % 6, isBot: true, playerId: null });
          botIdx++;
        }
      }
    }
    const mcfg = { mode: 'match' as const, teamSize: this.cfg.teamSize, duration: this.cfg.duration, unlimitedBoost: false, seed: Math.floor(Math.random() * 2 ** 31) };
    const match = new ServerMatch(matchCounter++, mcfg, roster, this.cfg.botDifficulty);
    match.onEnd = (score, winner) => {
      match.broadcast({ t: 'end', score, winner });
      this.state = 'results';
      this.resultsTimer = 20;
      this.broadcastRoom();
    };
    this.match = match;
    this.state = 'playing';
    for (const r of roster) {
      if (!r.playerId) continue;
      const p = this.players.find((x) => x.id === r.playerId);
      if (p?.socket) match.attach(p.id, r.carId, p.sink());
    }
    this.players.forEach((p) => (p.ready = false));
    this.broadcastRoom();
  }

  /** Reengancha a un jugador que volvió (reconexión). */
  rejoin(p: Player) {
    this.broadcastRoom();
    if (this.match && this.state !== 'lobby') {
      const r = this.match.roster.find((x) => x.playerId === p.id);
      if (r) this.match.attach(p.id, r.carId, p.sink());
    }
  }

  backToLobby() {
    this.match = null;
    this.state = 'lobby';
    this.players.forEach((p) => (p.ready = false));
    this.broadcastRoom();
  }

  /** Avanza la sala dt segundos (corre el partido a 120 Hz exactos). */
  update(dt: number) {
    if (this.state === 'results') {
      this.resultsTimer -= dt;
      this.runMatch(dt);
      if (this.resultsTimer <= 0) this.backToLobby();
      return;
    }
    if (this.state === 'playing') this.runMatch(dt);
  }

  private runMatch(dt: number) {
    const m = this.match;
    if (!m) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 24) { m.step(); this.acc -= DT; n++; }
    if (n === 24) this.acc = 0; // servidor saturado: no acumular deuda infinita
    for (const id of m.afkPlayers()) {
      const p = this.players.find((x) => x.id === id);
      if (p) {
        p.sendJson({ t: 'kicked', reason: 'Expulsado por inactividad' });
        this.remove(p);
        p.socket?.close(4000, 'afk');
      }
    }
    // Si no queda ningún humano conectado por un rato, terminar (dejamos tiempo para reconectar)
    if (!this.players.some((p) => p.socket)) {
      this.noHumans += dt;
      if (this.noHumans > 30) this.backToLobby();
    } else this.noHumans = 0;
  }
}

/** Lobby global: jugadores, salas y mensajes. */
export class Lobby {
  rooms = new Map<string, Room>();
  players = new Map<string, Player>(); // por token
  private nextId = 1;

  onOpen(socket: Socket): (data: string | ArrayBuffer) => void {
    let player: Player | null = null;
    return (data) => {
      if (typeof data !== 'string') {
        if (!player || !player.room?.match) return;
        const dv = new DataView(data);
        if (data.byteLength < 10 || dv.getUint8(0) !== MSG_INPUT) return;
        const { ackSeq, lastTick, inputs } = decodeInputs(data);
        player.room.match.onInputs(player.id, ackSeq, lastTick, inputs);
        player.lastSeen = Date.now();
        return;
      }
      let m: ClientMsg;
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'hello') {
        if (m.version !== PROTOCOL_VERSION) {
          socket.send(JSON.stringify({ t: 'error', msg: 'Versión distinta del servidor: recargá la página' }));
          socket.close(4001, 'version');
          return;
        }
        const existing = m.token ? this.players.get(m.token) : undefined;
        if (existing) {
          player = existing;
          if (existing.socket && existing.socket !== socket) { try { existing.socket.close(4002, 'replaced'); } catch { /* ignorar */ } }
        } else {
          const token = m.token || randomToken();
          player = new Player(`p${this.nextId++}`, token);
          this.players.set(token, player);
        }
        player.socket = socket;
        player.name = String(m.name || 'Jugador').slice(0, 16).replace(/[<>&"]/g, '') || 'Jugador';
        player.body = Math.max(0, Math.min(5, Math.round(m.body || 0)));
        player.lastSeen = Date.now();
        player.disconnectedAt = 0;
        player.sendJson({ t: 'welcome', id: player.id, token: player.token });
        if (player.room) player.room.rejoin(player);
        return;
      }
      if (!player) return;
      player.lastSeen = Date.now();
      const room = player.room;
      switch (m.t) {
        case 'ping': {
          const tick = room?.match?.world.tick ?? 0;
          player.sendJson({ t: 'pong', c: m.c, s: tick });
          break;
        }
        case 'create': {
          if (room) room.remove(player);
          let code = randomCode();
          while (this.rooms.has(code)) code = randomCode();
          const r = new Room(code, m.cfg);
          this.rooms.set(code, r);
          r.add(player);
          break;
        }
        case 'join': {
          const code = normalizeCode(m.code);
          const r = this.rooms.get(code);
          if (!r) { player.sendJson({ t: 'error', msg: `No existe la sala ${code}` }); break; }
          if (r === room) { r.broadcastRoom(); break; }
          if (r.players.length >= r.capacity()) { player.sendJson({ t: 'error', msg: 'La sala está llena' }); break; }
          if (room) room.remove(player);
          r.add(player);
          if (r.state !== 'lobby') player.sendJson({ t: 'error', msg: 'El partido ya empezó: vas a entrar en el próximo' });
          break;
        }
        case 'team': room?.setTeam(player, m.team); break;
        case 'ready': if (room && room.state === 'lobby') { player.ready = !!m.ready; room.broadcastRoom(); } break;
        case 'config': room?.setConfig(player, m.cfg); break;
        case 'start': room?.start(player); break;
        case 'resync': room?.match?.resync(player.id); break;
        case 'lobby': if (room) { if (room.state === 'results') room.backToLobby(); else room.broadcastRoom(); } break;
        case 'leave': {
          if (room) room.remove(player);
          player.sendJson({ t: 'left' });
          break;
        }
      }
    };
  }

  onClose(socket: Socket) {
    for (const p of this.players.values()) {
      if (p.socket === socket) {
        p.socket = null;
        p.disconnectedAt = Date.now();
        if (p.room?.match) p.room.match.detach(p.id);
        p.room?.broadcastRoom();
      }
    }
  }

  /** Mantenimiento: limpia salas vacías y jugadores que no volvieron. */
  housekeeping() {
    const now = Date.now();
    for (const p of [...this.players.values()]) {
      if (!p.socket && p.disconnectedAt && now - p.disconnectedAt > 90_000) {
        p.room?.remove(p);
        this.players.delete(p.token);
      }
      if (p.socket && now - p.lastSeen > 20_000) {
        try { p.socket.close(4003, 'timeout'); } catch { /* ignorar */ }
      }
    }
    for (const [code, r] of this.rooms) {
      if (!r.players.length && r.emptySince && now - r.emptySince > 60_000) this.rooms.delete(code);
      // Sala en lobby sin actividad por 15 minutos
      if (r.state === 'lobby' && r.players.every((p) => now - p.lastSeen > 15 * 60_000)) {
        for (const p of r.players) { p.sendJson({ t: 'kicked', reason: 'Sala cerrada por inactividad' }); r.remove(p); }
        this.rooms.delete(code);
      }
    }
  }

  update(dt: number) {
    for (const r of this.rooms.values()) r.update(dt);
  }
}
