// Pruebas de mecánicas de los bots en escenarios aislados (no sólo que se intenten: que funcionen).
// Uso: node --experimental-strip-types tests/bots.mechanics.ts [filtro]

import { BallPredictor, Bot, type Difficulty } from '../src/ai/bot.ts';
import { predictLanding, recover } from '../src/ai/control.ts';
import { Aerial, HalfFlip, type Ctx } from '../src/ai/maneuvers.ts';
import { PARAMS } from '../src/ai/params.ts';
import { type CarInput, emptyInput, stepCar } from '../src/sim/car.ts';
import { DT, KICKOFF_SPAWNS } from '../src/sim/constants.ts';
import { Quat, rng, V3 } from '../src/sim/math.ts';
import { World } from '../src/sim/world.ts';

const filter = process.argv[2] ?? '';
let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
}
const want = (n: string) => !filter || n.includes(filter);

function makeWorld(teamSize: number, seed = 1) {
  return new World({ mode: 'match', teamSize, duration: 300, unlimitedBoost: false, seed });
}

// ---------------------------------------------------------------------------
// Kickoffs: tiempo al primer toque, ganador y goles directos
// ---------------------------------------------------------------------------
function kickoffDuel(d0: Difficulty, d1: Difficulty, spawn: number, seed: number) {
  const w = makeWorld(1, seed);
  const b0 = new Bot(w.addCar(0, 'A', 0), d0);
  const b1 = new Bot(w.addCar(1, 'B', 0), d1);
  w.setupKickoff();
  const [x, y, yaw] = KICKOFF_SPAWNS[spawn];
  w.cars[0].placeAt(x, y, yaw);
  w.cars[1].placeAt(-x, -y, yaw + Math.PI);
  const pred = new BallPredictor();
  let first = -1, firstT = -1, goal = -1;
  const touchT = [-1, -1];
  for (let i = 0; i < 120 * 9; i++) {
    pred.update(w);
    w.step([b0.think(w, pred, DT), b1.think(w, pred, DT)]);
    for (const ev of w.takeEvents()) {
      if (ev.type === 'hit') {
        const team = w.cars[ev.carId].team;
        if (touchT[team] < 0) touchT[team] = (w.tick) * DT;
        if (first < 0) { first = team; firstT = w.tick * DT; }
      }
      if (ev.type === 'goal') goal = ev.team;
    }
    if (goal >= 0) break;
  }
  // Ganador: lado de la pelota 2,5 s después del saque (si no hubo gol)
  return { first, firstT, touchT, goal };
}

if (want('kickoff')) {
  for (const [d0, d1, label] of [[1, 1, 'Pro vs Pro'], [2, 2, 'Leyenda vs Leyenda'], [2, 1, 'Leyenda vs Pro'], [0, 0, 'Novato vs Novato']] as [Difficulty, Difficulty, string][]) {
    let goals0 = 0, goals1 = 0, n = 0;
    const firstTimes: number[] = [];
    const sides = [0, 0];
    for (let sp = 0; sp < 5; sp++) for (let s = 0; s < 4; s++) {
      const r = kickoffDuel(d0, d1, sp, 1000 + sp * 31 + s);
      n++;
      if (r.goal === 0) goals0++;
      if (r.goal === 1) goals1++;
      if (r.first >= 0) sides[r.first]++;
      if (r.touchT[0] > 0) firstTimes.push(r.touchT[0] - 3);
    }
    const avg = firstTimes.reduce((a, b) => a + b, 0) / Math.max(1, firstTimes.length);
    console.log(`   kickoff ${label.padEnd(20)} primer toque A/B ${sides[0]}/${sides[1]} · goles en 6 s A/B ${goals0}/${goals1} de ${n} · llegada A ${avg.toFixed(2)} s`);
    if (d0 === d1) check(`Kickoff parejo (${label})`, goals0 + goals1 <= n * 0.25, `goles directos ${goals0 + goals1}/${n}`);
  }
}

// ---------------------------------------------------------------------------
// Recuperación: caer sobre las ruedas desde orientaciones aleatorias
// ---------------------------------------------------------------------------
if (want('recover')) {
  for (const d of [1, 2] as Difficulty[]) {
    const p = PARAMS[d];
    const r = rng(7 + d);
    let ok = 0;
    const N = 60;
    for (let k = 0; k < N; k++) {
      const w = makeWorld(1, k);
      const car = w.addCar(0, 'A', k % 6);
      w.addCar(1, 'B', 0);
      car.placeAt((r() - 0.5) * 5000, (r() - 0.5) * 7000, r() * 6.28);
      car.onGround = false;
      car.pos.z = 500 + r() * 900;
      car.q = Quat.fromYPR(r() * 6.28, (r() - 0.5) * 3, (r() - 0.5) * 6.28);
      car.vel.set((r() - 0.5) * 1600, (r() - 0.5) * 1600, (r() - 0.3) * 600);
      car.ang.set((r() - 0.5) * 4, (r() - 0.5) * 4, (r() - 0.5) * 4);
      car.hasJumped = true;
      let landedOk = false;
      for (let i = 0; i < 120 * 4; i++) {
        const inp: CarInput = emptyInput();
        recover(car, inp, p);
        stepCar(car, inp, DT);
        if (car.onGround) { landedOk = car.up().dot(car.groundNormal) > 0.8; break; }
      }
      if (landedOk) ok++;
    }
    check(`Recuperación sobre las ruedas (${d === 1 ? 'Pro' : 'Leyenda'})`, ok / N >= 0.9, `${ok}/${N}`);
  }
  // Predicción de aterrizaje en pared
  {
    const w = makeWorld(1);
    const car = w.addCar(0, 'A', 0);
    car.placeAt(3500, 0, 0);
    car.onGround = false; car.pos.z = 600; car.vel.set(1200, 0, 100);
    const land = predictLanding(car);
    check('Predice aterrizaje en la pared lateral', !!land && land.normal.x < -0.8, land ? `n=(${land.normal.x.toFixed(2)},${land.normal.z.toFixed(2)}) t=${land.t.toFixed(2)}` : 'sin aterrizaje');
  }
}

// ---------------------------------------------------------------------------
// Aéreos: pelota alta en distintas posiciones; ¿la toca en el aire?
// ---------------------------------------------------------------------------
function aerialScenario(d: Difficulty, seed: number): { attempted: boolean; touched: boolean; z: number } {
  const r = rng(seed);
  const w = makeWorld(1, seed);
  const bot = new Bot(w.addCar(0, 'A', 0), d);
  const opp = w.addCar(1, 'B', 0);
  w.setupKickoff();
  w.phase = 'playing';
  w.ball.frozen = false;
  w.lastTouches.push({ carId: 1, team: 1, tick: 0 }); // no es kickoff
  opp.placeAt(3800, 4800, 0);
  const car = w.cars[0];
  car.placeAt((r() - 0.5) * 1500, -2500 - r() * 1000, Math.PI / 2 + (r() - 0.5) * 0.4);
  car.boost = 100;
  // Pelota que cae lento cerca del área rival, a buena altura
  w.ball.reset((r() - 0.5) * 1200, -600 + r() * 1400, 700 + r() * 700);
  w.ball.vel.set((r() - 0.5) * 300, (r() - 0.5) * 300, 250 + r() * 200);
  const pred = new BallPredictor();
  let touched = false, z = 0;
  for (let i = 0; i < 120 * 4; i++) {
    pred.update(w);
    w.step([bot.think(w, pred, DT), emptyInput()]);
    for (const ev of w.takeEvents()) if (ev.type === 'hit' && ev.carId === 0 && !w.cars[0].onGround && ev.pos.z > 350) { touched = true; z = ev.pos.z; }
    if (touched) break;
  }
  return { attempted: bot.stats.aerials > 0, touched, z };
}
if (want('aerial')) {
  for (const d of [1, 2] as Difficulty[]) {
    let att = 0, hit = 0;
    const N = 30;
    for (let k = 0; k < N; k++) { const r = aerialScenario(d, 500 + k); if (r.attempted) att++; if (r.touched) hit++; }
    const name = d === 1 ? 'Pro' : 'Leyenda';
    check(`Aéreos: intenta y conecta (${name})`, hit >= (d === 2 ? N * 0.5 : N * 0.25), `intentos ${att}/${N} · toques aéreos ${hit}/${N}`);
  }
}

// ---------------------------------------------------------------------------
// Half-flip: darse vuelta hacia un objetivo detrás
// ---------------------------------------------------------------------------
if (want('halfflip')) {
  const run = (useHalf: boolean) => {
    const w = makeWorld(1);
    const car = w.addCar(0, 'A', 0);
    w.addCar(1, 'B', 0);
    car.placeAt(0, 0, Math.PI / 2);
    const target = new V3(0, -3500, 0);
    const p = { ...PARAMS[2], halfFlip: useHalf };
    const pred = new BallPredictor();
    const man = useHalf ? new HalfFlip(target) : null;
    const ctx: Ctx = { car, world: w, pred, p, dt: DT };
    for (let i = 0; i < 120 * 4; i++) {
      const inp = emptyInput();
      if (man && !man.done) man.step(ctx, inp);
      else {
        const l = car.q.unrotate(target.sub(car.pos));
        const ang = Math.atan2(-l.y, l.x);
        inp.steer = Math.max(-1, Math.min(1, ang * 4)); inp.throttle = 1;
        inp.handbrake = Math.abs(ang) > 1.5 && car.onGround;
        inp.boost = Math.abs(ang) < 0.3;
      }
      stepCar(car, inp, DT);
      if (car.pos.y < -1500) return i * DT;
    }
    return 99;
  };
  const tHalf = run(true), tTurn = run(false);
  check('Half-flip llega antes que girar derrapando', tHalf < tTurn, `half-flip ${tHalf.toFixed(2)} s · giro ${tTurn.toFixed(2)} s`);
}

// ---------------------------------------------------------------------------
// Rendimiento del pensamiento en 3v3
// ---------------------------------------------------------------------------
if (want('perf')) {
  const w = makeWorld(3, 9);
  const bots: Bot[] = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < 3; i++) bots.push(new Bot(w.addCar(t, `B${t}${i}`, i), 2));
  w.setupKickoff();
  const pred = new BallPredictor();
  for (let i = 0; i < 120 * 60; i++) {
    pred.update(w);
    w.step(bots.map((b) => b.think(w, pred, DT)));
    if (w.phase === 'goal' && w.phaseTimer <= 0) w.setupKickoff();
  }
  const avg = bots.reduce((a, b) => a + b.stats.thinkMs / b.stats.thinks, 0) / bots.length;
  check('Pensar < 0,2 ms por bot y tick (3v3 Leyenda)', avg < 0.2, `${(avg * 1000).toFixed(1)} µs`);
}

void Aerial;
console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas de mecánicas pasaron');
process.exit(failed ? 1 : 0);
