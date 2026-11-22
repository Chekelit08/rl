// Pruebas headless de la simulación: verifica que la física se comporte según el estudio.
// Ejecutar: npm run test:sim

import { Ball, stepBall } from '../src/sim/ball.ts';
import { Car, emptyInput, stepCar, type CarInput } from '../src/sim/car.ts';
import { collideCarBall } from '../src/sim/collide.ts';
import { CAR_BODIES, DT } from '../src/sim/constants.ts';
import { World } from '../src/sim/world.ts';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(46)} ${detail}`);
  if (!ok) failed++;
}

function newCar() {
  const c = new Car(0, 0, 'test', CAR_BODIES[0]);
  c.placeAt(0, 0, Math.PI / 2);
  return c;
}
function run(c: Car, inp: Partial<CarInput>, seconds: number, cb?: (t: number) => void) {
  const full = { ...emptyInput(), ...inp };
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { stepCar(c, full, DT); cb?.(i * DT); }
}

// 1. Reposo
{
  const c = newCar();
  run(c, {}, 2);
  check('Auto en reposo se mantiene en el piso', Math.abs(c.pos.z - 17) < 1 && c.onGround, `z=${c.pos.z.toFixed(2)} onGround=${c.onGround}`);
}
// 2. Acelerador
{
  const c = newCar();
  let t1000 = -1;
  run(c, { throttle: 1 }, 4, (t) => { if (t1000 < 0 && c.speed() >= 1000) t1000 = t; });
  check('Velocidad máx. sin turbo ≈ 1410', Math.abs(c.speed() - 1410) < 15, `v=${c.speed().toFixed(0)} (0→1000 en ${t1000.toFixed(2)} s)`);
}
// 3. Turbo
{
  const c = newCar();
  c.placeAt(0, -4500, Math.PI / 2);
  c.unlimitedBoost = true;
  let tSuper = -1;
  run(c, { throttle: 1, boost: true }, 2.6, (t) => { if (tSuper < 0 && c.supersonic) tSuper = t; });
  check('Turbo llega a 2300 y supersónico', Math.abs(c.speed() - 2300) < 1 && tSuper > 0, `v=${c.speed().toFixed(0)}, supersónico a los ${tSuper.toFixed(2)} s`);
}
// 4. Salto simple (mantener) y doble salto
{
  const c = newCar();
  let maxZ = 0;
  run(c, { jump: true }, 0.25);
  run(c, {}, 1.5, () => { maxZ = Math.max(maxZ, c.pos.z); });
  check('Salto simple (mantenido) ≈ 230-260 uu', maxZ - 17 > 200 && maxZ - 17 < 280, `altura=${(maxZ - 17).toFixed(0)}`);
  const d = newCar();
  let maxZ2 = 0;
  run(d, { jump: true }, 0.2);
  run(d, {}, 1 / 60);
  run(d, { jump: true }, 1 / 60);
  run(d, {}, 3, () => { maxZ2 = Math.max(maxZ2, d.pos.z); });
  check('Doble salto ≈ 450-520 uu', maxZ2 - 17 > 420 && maxZ2 - 17 < 560, `altura=${(maxZ2 - 17).toFixed(0)}`);
  check('Aterriza de nuevo', d.onGround, `onGround=${d.onGround}`);
}
// 5. Front flip gana velocidad
{
  const c = newCar();
  run(c, { throttle: 1 }, 1.0);
  const v0 = c.speed();
  run(c, { throttle: 1, jump: true }, 1 / 30);
  run(c, { throttle: 1 }, 0.05);
  run(c, { throttle: 1, jump: true, pitch: -1 }, 1 / 60);
  run(c, { throttle: 1 }, 0.1);
  const v1 = new Ball(); void v1;
  const gain = Math.hypot(c.vel.x, c.vel.y) - v0;
  check('Front flip suma ≈ +500 uu/s', gain > 380 && gain < 620, `Δv=${gain.toFixed(0)}`);
  run(c, { throttle: 1 }, 1.5);
  check('Aterriza después del flip', c.onGround, `onGround=${c.onGround} up.z=${c.up().z.toFixed(2)}`);
}
// 6. Manejar hacia la pared lateral y subir
{
  const c = newCar();
  c.placeAt(3000, 0, 0); // mirando a +X (pared derecha)
  let maxZ = 0;
  run(c, { throttle: 1 }, 2.5, () => { maxZ = Math.max(maxZ, c.pos.z); });
  const n = c.groundNormal;
  check('Sube a la pared por la rampa', c.onGround && n.x < -0.9 && maxZ > 400, `z=${c.pos.z.toFixed(0)} n=(${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`);
  // Soltar el acelerador en la pared: frena, resbala y vuelve a bajar
  let top = c.pos.z;
  run(c, {}, 6, () => { top = Math.max(top, c.pos.z); });
  check('Sin acelerar en la pared, resbala hasta el piso', c.pos.z < 200, `máx ${top.toFixed(0)} → final ${c.pos.z.toFixed(0)}`);
}
// 7. Techo: no se puede manejar
{
  const c = newCar();
  c.placeAt(3000, 0, 0);
  c.unlimitedBoost = true;
  let reachedCeiling = false;
  run(c, { throttle: 1, boost: true }, 6, () => { if (c.onGround && c.groundNormal.z < -0.9) reachedCeiling = true; });
  check('En el techo se cae (sin adherencia suficiente)', !(c.onGround && c.groundNormal.z < -0.9), `llegó al techo=${reachedCeiling}, z=${c.pos.z.toFixed(0)}`);
}
// 8. Rebote de la pelota
{
  const b = new Ball();
  b.reset(0, 0, 1000);
  const peaks: number[] = [];
  let prevVz = 0;
  for (let i = 0; i < 120 * 8; i++) {
    stepBall(b, DT);
    if (prevVz > 0 && b.vel.z <= 0) peaks.push(b.pos.z - 91.25);
    prevVz = b.vel.z;
  }
  const ratio = peaks.length > 1 ? peaks[1] / peaks[0] : 0;
  check('Rebote: altura × ~0.36 por bote (e=0.6)', ratio > 0.3 && ratio < 0.42, `picos=${peaks.slice(0, 3).map((p) => p.toFixed(0)).join(', ')}`);
  check('Pelota termina en reposo sobre el piso', Math.abs(b.pos.z - 91.25) < 3, `z=${b.pos.z.toFixed(1)}`);
}
// 9. Tiro: auto a velocidad máx. con turbo contra pelota quieta
{
  const c = newCar();
  c.placeAt(0, -3500, Math.PI / 2);
  c.unlimitedBoost = true;
  const b = new Ball();
  b.reset(0, 0, 93);
  let tick = 0;
  let hit = false;
  for (let i = 0; i < 360 && !hit; i++) {
    stepCar(c, { ...emptyInput(), throttle: 1, boost: true }, DT);
    stepBall(b, DT);
    if (collideCarBall(c, b, ++tick)) hit = true;
  }
  for (let i = 0; i < 3; i++) { stepBall(b, DT); collideCarBall(c, b, ++tick); }
  check('Tiro supersónico de frente → pelota ≈ 3000+', b.vel.len() > 2900, `v_auto=${c.speed().toFixed(0)} v_pelota=${b.vel.len().toFixed(0)}`);
}
// 9b. Flip reset: caer con las ruedas sobre la pelota devuelve el flip
{
  const c = newCar();
  c.placeAt(0, 0, Math.PI / 2);
  run(c, { jump: true }, 0.1);
  run(c, {}, 0.05);
  run(c, { jump: true, pitch: -1 }, 1 / 60); // gasta el flip
  const usedFlip = c.hasFlipped;
  // Lo ubicamos derecho, en el aire, justo encima de la pelota
  c.q = new Car(1, 0, 'x', CAR_BODIES[0]).q.clone();
  c.placeAt(0, 0, Math.PI / 2);
  c.onGround = false; c.hasJumped = true; c.hasFlipped = true;
  c.pos.set(0, 0, 400); c.vel.set(0, 0, -300); c.ang.set(0, 0, 0);
  const b = new Ball();
  b.reset(0, 13, 250); // la pelota no se integra en esta prueba: queda quieta
  let reset = false;
  for (let i = 0; i < 60 && !reset; i++) {
    stepCar(c, emptyInput(), DT);
    const hit = collideCarBall(c, b, 100 + i);
    if (hit?.flipReset) reset = true;
  }
  check('Flip reset al tocar la pelota con las ruedas', usedFlip && reset && !c.hasFlipped, `flip usado=${usedFlip} reset=${reset}`);
}
// 10. Partido: kickoff y gol
{
  const w = new World({ mode: 'match', teamSize: 1, duration: 300, unlimitedBoost: false, seed: 1 });
  w.addCar(0, 'A');
  w.addCar(1, 'B');
  w.setupKickoff();
  for (let i = 0; i < 400; i++) w.step([emptyInput(), emptyInput()]);
  check('Kickoff: arranca a jugar después de 3 s', w.phase === 'playing', `fase=${w.phase}`);
  w.ball.pos.set(0, 4900, 200);
  w.ball.vel.set(0, 2000, 0);
  for (let i = 0; i < 120; i++) w.step([emptyInput(), emptyInput()]);
  check('Gol detectado para el equipo azul', w.score[0] === 1 && w.phase === 'goal', `marcador=${w.score.join('-')} fase=${w.phase}`);
}
// 11. Rendimiento
{
  const w = new World({ mode: 'freeplay', teamSize: 3, duration: 300, unlimitedBoost: true, seed: 2 });
  for (let i = 0; i < 6; i++) w.addCar(i % 2, 'c' + i, i);
  w.setupKickoff();
  const t0 = performance.now();
  const inp = { ...emptyInput(), throttle: 1, boost: true, steer: 0.3 };
  for (let i = 0; i < 1200; i++) w.step(Array(6).fill(inp));
  const ms = performance.now() - t0;
  check('Rendimiento 3v3: 10 s de juego', ms < 2000, `${ms.toFixed(0)} ms (${(ms / 1200).toFixed(3)} ms/tick)`);
}

console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(failed ? 1 : 0);
