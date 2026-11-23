// Pruebas de entrenamiento, rebobinado, formato de repeticiones y códigos de packs.
// Ejecutar: npm run test:training

import { goalOwnerAt } from '../src/sim/arena.ts';
import { Ball, stepBall } from '../src/sim/ball.ts';
import { emptyInput, type CarInput } from '../src/sim/car.ts';
import { BALL, DT } from '../src/sim/constants.ts';
import { World } from '../src/sim/world.ts';
import { lerpSnapshots, readFrame, readHud, strideFor, writeFrame } from '../src/replay/format.ts';
import { ClipBuffer, MatchRecorder } from '../src/replay/recorder.ts';
import { decodePack, encodePack } from '../src/training/codes.ts';
import { OFFICIAL_PACKS } from '../src/training/packs.ts';
import { TrainingSession } from '../src/training/session.ts';
import { DEFAULT_TIME } from '../src/training/types.ts';
import { captureWorld, restoreWorld, RewindBuffer } from '../src/training/worldState.ts';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
}

/** ¿La pelota sola entra en algún arco dentro del tiempo? Devuelve el dueño del arco o -1. */
function ballAlone(p: number[], v: number[], seconds: number) {
  const b = new Ball();
  b.reset(p[0], p[1], Math.max(BALL.RADIUS + 1, p[2]));
  b.vel.set(v[0], v[1], v[2]);
  for (let i = 0; i < seconds * 120; i++) {
    stepBall(b, DT);
    const o = goalOwnerAt(b.pos, BALL.RADIUS);
    if (o >= 0) return { owner: o, t: i * DT };
  }
  return { owner: -1, t: seconds };
}

// 1. Packs oficiales
check('Hay al menos 3 packs oficiales de 10 tiros', OFFICIAL_PACKS.length >= 3 && OFFICIAL_PACKS.every((p) => p.shots.length === 10), `${OFFICIAL_PACKS.length} packs`);
for (const pack of OFFICIAL_PACKS) {
  const limit = (s: { time?: number }) => s.time ?? DEFAULT_TIME[pack.category];
  if (pack.category === 'arquero') {
    const res = pack.shots.map((s) => ballAlone(s.ball.p, s.ball.v, limit(s)));
    const bad = res.map((r, i) => (r.owner === 0 ? -1 : i + 1)).filter((i) => i > 0);
    check(`"${pack.name}": todos los tiros van al arco`, bad.length === 0, bad.length ? `fallan: ${bad.join(', ')}` : `llegan en ${res.map((r) => r.t.toFixed(1)).join('/')} s`);
  } else {
    const res = pack.shots.map((s) => ballAlone(s.ball.p, s.ball.v, limit(s)));
    const trivial = res.map((r, i) => (r.owner === 1 ? i + 1 : -1)).filter((i) => i > 0);
    const own = res.map((r, i) => (r.owner === 0 ? i + 1 : -1)).filter((i) => i > 0);
    check(`"${pack.name}": ningún tiro entra solo`, trivial.length === 0 && own.length === 0, trivial.length || own.length ? `solos: ${trivial.join(',')} en contra: ${own.join(',')}` : '');
  }
  // Pelota y auto dentro de la cancha
  const out = pack.shots.map((s, i) => (Math.abs(s.ball.p[0]) > 3950 || Math.abs(s.ball.p[1]) > 5000 || Math.abs(s.car.p[0]) > 3950 || Math.abs(s.car.p[1]) > 5100 ? i + 1 : -1)).filter((i) => i > 0);
  check(`"${pack.name}": posiciones válidas`, out.length === 0, out.join(','));
}

// 2. Sesión: remate de frente con un input simple (acelerar + turbo) es acierto
function runSession(packIndex: number, shotIndex: number, input: (t: number) => Partial<CarInput>, seconds = 9) {
  const w = new World({ mode: 'freeplay', teamSize: 1, duration: 300, unlimitedBoost: false, seed: 3 });
  w.addCar(0, 'Vos', 0);
  w.setupKickoff();
  const s = new TrainingSession(w, OFFICIAL_PACKS[packIndex], { autoAdvance: false });
  s.load(shotIndex);
  let result = 'pendiente';
  s.onResult = (r) => { result = r; };
  for (let i = 0; i < seconds * 120 && result === 'pendiente'; i++) {
    const inp = { ...emptyInput(), ...input(i * DT) };
    s.beforeTick(inp);
    w.step([inp]);
    for (const ev of w.takeEvents()) s.onEvent(ev);
    s.afterTick(DT);
  }
  return { result, session: s };
}
{
  const r = runSession(0, 0, () => ({ throttle: 1, boost: true }));
  check('Sesión: remate de frente = acierto', r.result === 'acierto', r.result);
  const idle = runSession(0, 0, (t) => (t < 0.05 ? { throttle: 1 } : {}), 10);
  check('Sesión: sin tocar la pelota = fallo por tiempo', idle.result === 'fallo', idle.result);
  // Arquero sin moverse: el tiro entra → fallo
  const g = runSession(3, 0, (t) => (t < 0.05 ? { throttle: -0.2 } : {}), 8);
  check('Sesión arquero: si no atajás = fallo', g.result === 'fallo', g.result);
  // Esperando: la pelota no se mueve hasta que el jugador da un input
  const w = new World({ mode: 'freeplay', teamSize: 1, duration: 300, unlimitedBoost: false, seed: 4 });
  w.addCar(0, 'Vos', 0);
  w.setupKickoff();
  const s = new TrainingSession(w, OFFICIAL_PACKS[1]);
  const p0 = w.ball.pos.clone();
  for (let i = 0; i < 240; i++) { s.beforeTick(emptyInput()); w.step([emptyInput()]); s.afterTick(DT); }
  check('Sesión: todo congelado hasta el primer input', w.ball.pos.dist(p0) < 1 && s.phase === 'esperando', `Δ=${w.ball.pos.dist(p0).toFixed(2)}`);
}

// 3. Rebobinado determinista
{
  const mk = () => {
    const w = new World({ mode: 'freeplay', teamSize: 1, duration: 300, unlimitedBoost: true, seed: 5 });
    w.addCar(0, 'Vos', 2);
    w.setupKickoff();
    w.resetFreeplay(w.cars[0]);
    return w;
  };
  const inputAt = (i: number): CarInput => ({ ...emptyInput(), throttle: 1, boost: i % 200 < 120, steer: Math.sin(i / 50) * 0.6, jump: i % 300 > 280, pitch: i % 300 > 290 ? -1 : 0 });
  const w = mk();
  let saved = null as ReturnType<typeof captureWorld> | null;
  for (let i = 0; i < 900; i++) {
    if (i === 400) saved = captureWorld(w);
    w.step([inputAt(i)]);
  }
  const endA = { car: w.cars[0].pos.clone(), ball: w.ball.pos.clone(), q: w.cars[0].q.clone() };
  restoreWorld(w, saved!);
  for (let i = 400; i < 900; i++) w.step([inputAt(i)]);
  const dCar = w.cars[0].pos.dist(endA.car), dBall = w.ball.pos.dist(endA.ball);
  check('Rebobinar y repetir los mismos inputs da el mismo resultado', dCar < 1e-6 && dBall < 1e-6, `Δauto=${dCar.toExponential(1)} Δpelota=${dBall.toExponential(1)}`);
  // Buffer: rebobinar 2 s y seguir
  const w2 = mk();
  const rb = new RewindBuffer(5, 2);
  for (let i = 0; i < 1000; i++) { w2.step([inputAt(i)]); rb.push(w2); }
  rb.begin();
  const st = rb.back(240)!;
  restoreWorld(w2, st);
  const tickAfter = w2.tick;
  const res = rb.end();
  check('Buffer de rebobinado vuelve ~2 s', res !== null && 1000 - tickAfter >= 238 && 1000 - tickAfter <= 244, `retrocedió ${1000 - tickAfter} ticks`);
  check('El auto conserva su carrocería al restaurar', w2.cars[0].body === mk().cars[0].body);
}

// 4. Formato de repeticiones
{
  const w = new World({ mode: 'match', teamSize: 2, duration: 300, unlimitedBoost: false, seed: 6 });
  for (let i = 0; i < 4; i++) w.addCar(i % 2, 'J' + i, i);
  w.setupKickoff();
  const rec = new MatchRecorder(w, 30);
  const clip = new ClipBuffer(15, 60);
  clip.reset(w, '2v2');
  const snaps = [];
  for (let i = 0; i < 120 * 25; i++) {
    w.step(w.cars.map((_, k) => ({ ...emptyInput(), throttle: 1, boost: true, steer: k % 2 ? 0.4 : -0.4 })));
    const s = w.snapshot();
    rec.push(s, w);
    clip.push(s, w);
    if (i % 4 === 0) snaps.push(s);
  }
  const data = rec.finish();
  const meta = { nCars: rec.nCars, nPads: rec.nPads, cars: rec.cars };
  let maxErr = 0, padsOk = true, flagsOk = true;
  snaps.forEach((s, i) => {
    const r = readFrame(data, i, meta);
    maxErr = Math.max(maxErr, Math.abs(r.ball.x - s.ball.x), Math.abs(r.ball.z - s.ball.z), ...r.cars.map((c, k) => Math.abs(c.y - s.cars[k].y)));
    if (r.pads.some((p, k) => p !== s.pads[k])) padsOk = false;
    if (r.cars.some((c, k) => c.boosting !== s.cars[k].boosting || c.onGround !== s.cars[k].onGround)) flagsOk = false;
  });
  check('Repetición: 30 cuadros/s, error de posición < 0.2 uu', rec.frames === snaps.length && maxErr < 0.2, `${rec.frames} cuadros, error ${maxErr.toFixed(3)} uu, ${(data.byteLength / 1024).toFixed(0)} KB`);
  check('Repetición: pads y estados del auto exactos', padsOk && flagsOk);
  check('Repetición: tamaño por cuadro (2v2)', strideFor(4, 34) === 4 + 10 + 3 + 60);
  const hud = readHud(data, rec.frames - 1, meta);
  check('Repetición: reloj del partido grabado', Math.abs(hud.clock - w.clock) < 0.2, `${hud.clock.toFixed(1)} vs ${w.clock.toFixed(1)}`);
  const lerp = lerpSnapshots(readFrame(data, 10, meta), readFrame(data, 11, meta), 0.5);
  check('Repetición: interpolación entre cuadros', Number.isFinite(lerp.ball.x) && lerp.cars.length === 4);
  const c = clip.snapshot();
  check('Clip: últimos 15 s a 60 cuadros/s', clip.frames === 900 && c.length === 900 * clip.stride, `${clip.frames} cuadros`);
  const buf = new Int16Array(strideFor(4, 34));
  writeFrame(buf, 0, w.snapshot(), { clock: 12.3, score: [2, 1], overtime: true }, 4);
  const h2 = readHud(buf, 0, meta);
  check('Formato: marcador y tiempo extra', h2.score[0] === 2 && h2.score[1] === 1 && h2.overtime && Math.abs(h2.clock - 12.3) < 0.05);
}

// 5. Códigos de packs
{
  const p = OFFICIAL_PACKS[3];
  const code = await encodePack(p);
  const back = await decodePack(code);
  const same = back.shots.length === p.shots.length && back.shots.every((s, i) => s.ball.v.every((v, k) => Math.abs(v - p.shots[i].ball.v[k]) <= 1) && s.car.yaw === Math.round(p.shots[i].car.yaw));
  check('Código de pack: ida y vuelta', same && back.category === p.category && back.name === p.name, `${code.length} caracteres`);
  let err = '';
  try { await decodePack('TG1-basura'); } catch (e) { err = (e as Error).message; }
  check('Código inválido da un error claro', err.length > 0, err);
}

console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(failed ? 1 : 0);
