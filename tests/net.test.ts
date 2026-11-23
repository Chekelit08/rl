// Prueba headless del online: servidor real + 2 clientes con latencia artificial (50–150 ms + jitter).
// Verifica: salas y lobby, arranque del partido, que los inputs llegan, que los goles y el marcador
// coinciden, que la predicción converge al estado del servidor y el ancho de banda.
// Ejecutar: npm run test:net

import { NetClient } from '../src/net/client.ts';
import { OnlineMatch } from '../src/net/match.ts';
import type { RoomConfig, ServerMsg } from '../src/net/protocol.ts';
import { type CarInput, emptyInput } from '../src/sim/car.ts';
import { DT } from '../src/sim/constants.ts';
import type { GameEvent } from '../src/sim/world.ts';
import { startServer } from '../server/main.ts';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

interface TestClient {
  net: NetClient;
  match: OnlineMatch | null;
  room: Extract<ServerMsg, { t: 'room' }> | null;
  events: GameEvent[];
  bytes: number;
  snaps: number;
  ended: boolean;
  input: () => CarInput;
}

function makeClient(name: string, base: number, jitter: number): TestClient {
  const net = new NetClient(undefined, { simulatedLatency: () => base + (Math.random() - 0.5) * 2 * jitter });
  const c: TestClient = { net, match: null, room: null, events: [], bytes: 0, snaps: 0, ended: false, input: () => emptyInput() };
  net.onMessage = (m) => {
    if (m.t === 'room') c.room = m;
    if (m.t === 'start') c.match = new OnlineMatch(net, m);
    if (m.t === 'end') c.ended = true;
    if (m.t === 'error') console.log(`   [${name}] error del servidor: ${m.msg}`);
    c.match?.handleMessage(m);
  };
  net.onBinary = (buf) => { c.bytes += buf.byteLength; c.snaps++; c.match?.handleSnapshot(buf); };
  return c;
}

async function waitFor(cond: () => boolean, ms: number, what: string) {
  const t0 = now();
  while (!cond()) {
    if (now() - t0 > ms) throw new Error(`timeout esperando: ${what}`);
    await sleep(10);
  }
}

const srv = await startServer({ port: 0, staticDir: null, log: false });
const url = `ws://127.0.0.1:${srv.port}/ws`;
const A = makeClient('A', 50, 20);
const B = makeClient('B', 120, 35);

try {
  A.net.connect(url, 'Ana', 0);
  B.net.connect(url, 'Beto', 2);
  await waitFor(() => A.net.isOpen() && B.net.isOpen() && !!A.net.id && !!B.net.id, 5000, 'conexión');
  const cfg: RoomConfig = { teamSize: 2, duration: 120, botFill: true, botDifficulty: 1 };
  A.net.send({ t: 'create', cfg });
  await waitFor(() => !!A.room, 5000, 'sala creada');
  const code = A.room!.code;
  check('Sala creada con código de 5 letras', /^[A-Z]{5}$/.test(code), code);
  B.net.send({ t: 'join', code });
  await waitFor(() => !!B.room && B.room.players.length === 2 && !!A.room && A.room.players.length === 2, 5000, 'unirse');
  check('El segundo jugador se une a la sala', B.room!.code === code, `${A.room!.players.map((p) => `${p.name}(eq ${p.team})`).join(', ')}`);
  check('Equipos balanceados al entrar', A.room!.players[0].team !== A.room!.players[1].team, '');
  B.net.send({ t: 'ready', ready: true });
  await waitFor(() => !!A.room?.players.find((p) => p.name === 'Beto')?.ready, 5000, 'listo');
  A.net.send({ t: 'start' });
  await waitFor(() => !!A.match?.ready && !!B.match?.ready, 8000, 'primer estado en ambos clientes');
  check('Partido 2v2 con relleno de bots', A.match!.world.cars.length === 4 && A.match!.roster.filter((r) => r.isBot).length === 2,
    A.match!.roster.map((r) => `${r.name}${r.isBot ? '🤖' : ''}`).join(', '));
  check('Estructuras de estado compatibles', !A.match!.incompatible && !B.match!.incompatible, A.match!.incompatible || 'ok');

  // Scripts de manejo: A acelera con turbo hacia la pelota y salta seguido; B zigzaguea
  let frame = 0;
  A.input = () => {
    const w = A.match!.world, me = w.cars[A.match!.localId];
    const to = w.ball.pos.sub(me.pos), local = me.q.unrotate(to);
    const ang = Math.atan2(-local.y, local.x);
    return { ...emptyInput(), throttle: 1, steer: Math.max(-1, Math.min(1, ang * 3)), boost: frame % 240 < 120, jump: frame % 300 < 12 };
  };
  B.input = () => ({ ...emptyInput(), throttle: 1, steer: Math.sin(frame / 50), handbrake: frame % 400 > 360, jump: frame % 360 < 8 });

  const room = srv.lobby.rooms.get(code)!;
  const serverWorld = () => room.match!.world;
  const startPosA = (() => { const id = A.match!.localId; const c = serverWorld().cars[id]; return c.pos.clone(); })();

  async function runFor(seconds: number, inputs = true) {
    const t0 = now();
    let acc = 0, last = now();
    while (now() - t0 < seconds * 1000) {
      const t = now();
      acc += (t - last) / 1000;
      last = t;
      while (acc >= DT) {
        for (const c of [A, B]) {
          const evs = c.match!.tick(inputs ? c.input() : emptyInput());
          c.events.push(...evs);
        }
        frame++;
        acc -= DT;
      }
      await sleep(2);
    }
  }

  await runFor(7);
  const moved = serverWorld().cars[A.match!.localId].pos.dist(startPosA);
  check('Los inputs del cliente mueven su auto en el servidor', moved > 800, `recorrió ${moved.toFixed(0)} uu en el servidor`);
  check('Se midió el ping de cada cliente', A.net.rtt > 60 && B.net.rtt > A.net.rtt, `A ${A.net.rtt.toFixed(0)} ms · B ${B.net.rtt.toFixed(0)} ms`);

  // Gol forzado en el servidor
  const sw = serverWorld();
  sw.ball.reset(0, 4300);
  sw.ball.pos.z = 300;
  sw.ball.vel.set(0, 3500, 0);
  const goalsBefore = [A, B].map((c) => c.events.filter((e) => e.type === 'goal').length);
  await runFor(2.5);
  const goalsAfter = [A, B].map((c) => c.events.filter((e) => e.type === 'goal').length);
  check('Ambos clientes reciben el evento de gol', goalsAfter[0] > goalsBefore[0] && goalsAfter[1] > goalsBefore[1], `A ${goalsAfter[0]} · B ${goalsAfter[1]}`);
  const sScore = serverWorld().score.join('-');
  check('El marcador coincide en servidor y clientes', A.match!.world.score.join('-') === sScore && B.match!.world.score.join('-') === sScore,
    `servidor ${sScore} · A ${A.match!.world.score.join('-')} · B ${B.match!.world.score.join('-')}`);

  // Después del festejo hay kickoff (lo decide el servidor) y se sigue jugando
  await runFor(6);
  check('Kickoff después del gol', serverWorld().phase === 'playing' || serverWorld().phase === 'countdown', `fase servidor: ${serverWorld().phase}`);

  // Convergencia: soltamos los controles; con todo quieto, la predicción debe coincidir con el servidor
  await runFor(5, false);
  const sw2 = serverWorld();
  let worst = 0;
  for (const c of [A, B]) {
    const w = c.match!.world;
    for (let i = 0; i < w.cars.length; i++) {
      if (w.cars[i].isBot) continue; // los bots siguen jugando en el servidor: sus inputs cambian todo el tiempo
      worst = Math.max(worst, w.cars[i].pos.dist(sw2.cars[i].pos));
    }
  }
  check('La predicción converge al servidor (humanos quietos)', worst < 25, `máx. diferencia ${worst.toFixed(2)} uu`);
  for (const [n, c] of [['A', A], ['B', B]] as const) {
    const s = c.match!.stats;
    const secs = 20.5;
    console.log(`   ${n}: ping ${s.ping} ms, rollbacks ${s.rollbacks}, re-sim ${s.resimTicks} ticks, adelanto ${s.lead} ticks, slack ${s.slack}, ` +
      `${(c.bytes / secs / 1024).toFixed(1)} KB/s bajada, ${(c.bytes / Math.max(1, c.snaps)).toFixed(0)} B/snapshot`);
  }
  const kbA = A.bytes / 20.5 / 1024;
  check('Ancho de banda razonable (delta)', kbA < 60, `${kbA.toFixed(1)} KB/s`);
  check('Los inputs llegan antes de que el servidor los necesite', A.match!.stats.slack >= 0 && B.match!.stats.slack >= 0,
    `slack A ${A.match!.stats.slack} · B ${B.match!.stats.slack}`);

  // Reconexión: B se desconecta y vuelve con el mismo token
  const tokenB = B.net.token;
  B.net.close();
  await sleep(500);
  const B2 = makeClient('B2', 120, 35);
  B2.net.token = tokenB;
  B2.net.connect(url, 'Beto', 2);
  await waitFor(() => !!B2.match?.ready, 8000, 'reconexión');
  check('Reconexión al mismo partido con el mismo token', B2.match!.localId === B.match!.localId, `auto ${B2.match!.localId}`);
  B2.net.close();
} catch (e) {
  console.log('❌ Error:', (e as Error).message);
  failed++;
} finally {
  A.net.close();
  B.net.close();
  await srv.close();
}

console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas del online pasaron');
process.exit(failed ? 1 : 0);
