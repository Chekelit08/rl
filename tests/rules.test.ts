// Pruebas headless de mutadores y desafíos.
// Ejecutar: npm run test:rules

import { arenaDistance } from '../src/sim/arena.ts';
import { Ball, stepBall } from '../src/sim/ball.ts';
import { emptyInput, type CarInput } from '../src/sim/car.ts';
import { DT } from '../src/sim/constants.ts';
import { V3 } from '../src/sim/math.ts';
import { applyRules, DEFAULT_RULES, makeRules, MUTATORS, RULES, type Rules } from '../src/sim/rules.ts';
import { World } from '../src/sim/world.ts';
import { buildGates, ChallengeRun, COURSES, medalFor } from '../src/challenges/courses.ts';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
}
const world = (rules?: Partial<Rules>, mode: 'match' | 'freeplay' = 'freeplay') => {
  const w = new World({ mode, teamSize: 1, duration: 300, unlimitedBoost: false, seed: 9, rules });
  w.addCar(0, 'a');
  if (mode === 'match') w.addCar(1, 'b');
  w.setupKickoff();
  if (mode === 'freeplay') w.resetFreeplay(w.cars[0]);
  return w;
};
const steps = (w: World, seconds: number, inp: Partial<CarInput> = {}, cb?: () => void) => {
  const full = { ...emptyInput(), ...inp };
  for (let i = 0; i < Math.round(seconds / DT); i++) { w.step(w.cars.map((_, j) => (j === 0 ? full : emptyInput()))); cb?.(); }
};
/** Altura máxima de un salto simple manteniendo el botón. */
const jumpApex = (rules?: Partial<Rules>) => {
  const w = world(rules);
  let top = 0, n = 0;
  steps(w, 6, { jump: true }, () => { n++; if (n > 30) top = Math.max(top, w.cars[0].pos.z); });
  return top;
};
/** Altura del primer rebote de la pelota soltada desde 1000 uu. */
const firstBounce = (rules?: Partial<Rules>) => {
  applyRules(makeRules(rules));
  const b = new Ball();
  b.reset(0, 0, 1000);
  let bounced = false, top = 0;
  for (let i = 0; i < 120 * 6; i++) {
    const hit = stepBall(b, DT);
    if (hit > 0 && !bounced) bounced = true;
    else if (bounced) { if (b.vel.z < 0 && top > 0) break; top = Math.max(top, b.pos.z); }
  }
  return top;
};

// ---------- Mutadores ----------
{
  check('Las reglas por defecto no cambian nada', new World({ mode: 'match', teamSize: 1, duration: 300, unlimitedBoost: false, seed: 1 }).rules.gravity === -650 && RULES.ballBounce === 0.6, `g=${RULES.gravity}`);
  const every = MUTATORS.every((m) => m.options.some((o) => o.value === DEFAULT_RULES[m.key]));
  check('Cada mutador ofrece la opción estándar', every, `${MUTATORS.length} mutadores`);
}
{
  const n = jumpApex(), low = jumpApex({ gravity: -325 }), high = jumpApex({ gravity: -1137.5 });
  check('Gravedad: baja salta más, alta salta menos', low > n * 1.5 && high < n * 0.75, `baja ${low.toFixed(0)} · normal ${n.toFixed(0)} · alta ${high.toFixed(0)}`);
}
{
  const n = firstBounce(), lo = firstBounce({ ballBounce: 0.35 }), hi = firstBounce({ ballBounce: 0.95 });
  check('Rebote de la pelota', lo < n * 0.6 && hi > n * 1.8, `bajo ${lo.toFixed(0)} · normal ${n.toFixed(0)} · súper ${hi.toFixed(0)}`);
}
{
  const speedAfterHit = (rules?: Partial<Rules>) => {
    const w = world(rules);
    w.cars[0].placeAt(0, -1500, Math.PI / 2);
    let max = 0;
    steps(w, 3, { throttle: 1, boost: true }, () => { max = Math.max(max, w.ball.vel.len()); });
    return max;
  };
  const n = speedAfterHit(), light = speedAfterHit({ ballMass: 0.35 }), heavy = speedAfterHit({ ballMass: 3 });
  check('Peso de la pelota: liviana sale más rápido', light > n && heavy < n, `liviana ${light.toFixed(0)} · normal ${n.toFixed(0)} · pesada ${heavy.toFixed(0)}`);
  const capped = speedAfterHit({ ballMaxSpeed: 1200 });
  check('Velocidad máxima de la pelota', capped <= 1200.5, `tope 1200 → ${capped.toFixed(0)}`);
}
{
  const boostAfter = (rules: Partial<Rules>, inp: Partial<CarInput>, seconds: number, startBoost?: number) => {
    const w = world(rules);
    if (startBoost !== undefined) w.cars[0].boost = startBoost;
    steps(w, seconds, inp);
    return w.cars[0];
  };
  check('Turbo ilimitado no se gasta', boostAfter({ boostMode: 'unlimited' }, { boost: true }, 4).boost === 100, 'queda 100');
  const none = boostAfter({ boostMode: 'none' }, { boost: true, throttle: 1 }, 4);
  check('Sin turbo: no acelera con turbo ni junta pastillas', none.boost === 0 && none.speed() < 1420, `turbo ${none.boost} · v=${none.speed().toFixed(0)}`);
  const slow = boostAfter({ boostMode: 'slow' }, {}, 3, 0).boost, fast = boostAfter({ boostMode: 'fast' }, {}, 3, 0).boost;
  check('Recarga pasiva de turbo', Math.abs(slow - 30) < 1 && Math.abs(fast - 75) < 1, `lenta ${slow.toFixed(1)} · rápida ${fast.toFixed(1)} en 3 s`);
  const t = (rules: Partial<Rules>) => { const w = world({ boostMode: 'unlimited', ...rules }); w.cars[0].placeAt(3000, -4000, Math.PI / 2); let n = 0; steps(w, 1.5, { boost: true }, () => { if (w.cars[0].speed() < 2000) n++; }); return n * DT; };
  const t1 = t({}), t2 = t({ boostPower: 2 });
  check('Fuerza del turbo 2x acelera antes', t2 < t1 * 0.7, `0→2000: 1x ${t1.toFixed(2)} s · 2x ${t2.toFixed(2)} s`);
}
{
  const demoTest = (rules: Partial<Rules>, supersonic: boolean) => {
    const w = world(rules, 'match');
    steps(w, 3.1);
    const [a, b] = w.cars;
    a.placeAt(2000, -600, Math.PI / 2);
    b.placeAt(2000, 300, Math.PI);
    if (supersonic) { a.vel.set(0, 2250, 0); a.supersonic = true; } else a.vel.set(0, 900, 0);
    steps(w, 1.2, { throttle: 1, boost: supersonic });
    return b.demoed || b.respawnTimer > 0 || w.cars[0].stats.demos > 0;
  };
  check('Demoliciones normales (supersónico)', demoTest({}, true), 'demuele');
  check('Demoliciones desactivadas', !demoTest({ demo: 'off' }, true), 'no demuele');
  check('Demolición al contacto (sin supersónico)', demoTest({ demo: 'contact' }, false) && !demoTest({}, false), 'demuele sólo con el mutador');
}
{
  const w = world({ maxGoals: 1 }, 'match');
  steps(w, 3.1);
  w.ball.pos.set(0, 5300, 200);
  steps(w, 0.1);
  check('Tope de goles termina el partido', w.phase === 'ended' && w.winner === 0 && w.score[0] === 1, `fase ${w.phase} · ${w.score.join('-')}`);
  const w2 = world({}, 'match');
  steps(w2, 3.1);
  w2.ball.pos.set(0, 5300, 200);
  steps(w2, 0.1);
  check('Sin tope el partido sigue después del gol', w2.phase === 'goal', `fase ${w2.phase}`);
}
{
  // Dos mundos con reglas distintas no se contaminan
  const a = world({ gravity: -110 }), b = world();
  for (let i = 0; i < 240; i++) { a.step([{ ...emptyInput(), jump: i < 20 }]); b.step([{ ...emptyInput(), jump: i < 20 }]); }
  check('Mundos simultáneos con reglas distintas', a.cars[0].pos.z > 150 && b.cars[0].pos.z < 20, `lunar z=${a.cars[0].pos.z.toFixed(0)} · normal z=${b.cars[0].pos.z.toFixed(0)}`);
}

// ---------- Desafíos ----------
for (const c of COURSES) {
  const gates = buildGates(c);
  const inside = gates.every((g) => arenaDistance(g.p.x, g.p.y, g.p.z) > 60 && Math.abs(g.n.len() - 1) < 1e-6);
  let maxGap = 0, len = 0;
  let prev = new V3(c.start[0], c.start[1], 17);
  for (const g of gates) { const d = g.p.sub(prev).len(); maxGap = Math.max(maxGap, d); len += d; prev = g.p; }
  check(`Desafío "${c.name}": aros dentro del estadio`, inside && maxGap < 3600 && c.medals[0] < c.medals[1] && c.medals[1] < c.medals[2], `${gates.length} aros · recorrido ${(len / 100).toFixed(0)} m · tramo máx. ${maxGap.toFixed(0)}`);
}
{
  const c = COURSES[0];
  const run = new ChallengeRun(c);
  const g = run.gates[0];
  run.step(g.p.sub(g.n.scale(50)), 500);
  const hit = run.step(g.p.add(g.n.scale(50)), 500);
  const run2 = new ChallengeRun(c);
  const side = new V3(-g.n.y, g.n.x, 0).scale(c.radius + 80);
  run2.step(g.p.sub(g.n.scale(50)).add(side), 500);
  const miss = run2.step(g.p.add(g.n.scale(50)).add(side), 500);
  check('Pasar por dentro del aro cuenta; por afuera no', hit && run.index === 1 && !miss && run2.index === 0, `adentro ${hit} · afuera ${miss}`);
  check('Medallas por tiempo', medalFor(c, c.medals[0] - 1) === 3 && medalFor(c, c.medals[1]) === 2 && medalFor(c, c.medals[2] + 5) === 0, 'oro/plata/sin medalla');
}
// Piloto automático por el piso: los recorridos de piso y pared se pueden completar
for (const id of ['slalom', 'pared']) {
  const c = COURSES.find((x) => x.id === id)!;
  const w = new World({ mode: 'freeplay', teamSize: 1, duration: 300, unlimitedBoost: c.unlimitedBoost, seed: 1 });
  const car = w.addCar(0, 'piloto');
  w.setupKickoff();
  car.placeAt(c.start[0], c.start[1], c.start[2]);
  car.boost = 100;
  w.ball.hidden = true; w.ball.frozen = true;
  const run = new ChallengeRun(c);
  let respawns = 0, lastIdx = 0, lastProgress = 0;
  for (let i = 0; i < 120 * 120 && !run.finished; i++) {
    const g = run.next!;
    // Apuntar un poco más allá del aro, en coordenadas locales del auto
    const target = g.p.add(g.n.scale(120));
    const local = car.q.unrotate(target.sub(car.pos));
    const ang = Math.atan2(local.y, local.x);
    const steer = Math.max(-1, Math.min(1, -ang * 3));
    const sharp = Math.abs(ang) > 0.9;
    w.step([{ ...emptyInput(), throttle: sharp && car.speed() > 900 ? 0.2 : 1, steer, boost: Math.abs(ang) < 0.25, handbrake: sharp && car.speed() > 700 }]);
    run.step(car.pos, car.speed());
    if (run.index !== lastIdx) { lastIdx = run.index; lastProgress = i; }
    if (i - lastProgress > 120 * 12) { run.respawn(car); respawns++; lastProgress = i; }
  }
  check(`Piloto automático completa "${c.name}"`, run.finished, `${run.time.toFixed(1)} s · ${respawns} reapariciones · bronce ${c.medals[2]} s`);
}

applyRules(makeRules());
if (failed) { console.log(`\n${failed} prueba(s) fallaron`); process.exit(1); }
console.log('\nTodas las pruebas de mutadores y desafíos pasaron');
