// Partido headless bot vs bot: verifica que los bots juegan, anotan y que la simulación no explota.
import { BallPredictor, Bot, type Difficulty } from '../src/ai/bot.ts';
import { DT } from '../src/sim/constants.ts';
import { World } from '../src/sim/world.ts';

function match(teamSize: number, d0: Difficulty, d1: Difficulty, seed: number) {
  const w = new World({ mode: 'match', teamSize, duration: 300, unlimitedBoost: false, seed });
  const bots: Bot[] = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < teamSize; i++) bots.push(new Bot(w.addCar(t, `B${t}${i}`, i), t === 0 ? d0 : d1));
  w.setupKickoff();
  const pred = new BallPredictor();
  let ticks = 0, touches = 0, nan = false, outOfArena = 0, maxBall = 0;
  while (w.phase !== 'ended' && ticks < 120 * 60 * 12) {
    pred.update(w);
    w.step(bots.map((b) => b.think(w, pred, DT)));
    for (const ev of w.takeEvents()) if (ev.type === 'hit') touches++;
    if (w.phase === 'goal' && w.phaseTimer <= 0) w.setupKickoff();
    for (const c of w.cars) {
      if (!Number.isFinite(c.pos.x + c.pos.y + c.pos.z)) nan = true;
      if (Math.abs(c.pos.x) > 4200 || Math.abs(c.pos.y) > 6100 || c.pos.z < -20 || c.pos.z > 2100) outOfArena++;
    }
    if (!Number.isFinite(w.ball.pos.x)) nan = true;
    maxBall = Math.max(maxBall, w.ball.vel.len());
    ticks++;
  }
  const stats = w.cars.map((c) => `${c.name}:${c.stats.goals}g/${c.stats.saves}s/${c.stats.touches}t`).join(' ');
  return { score: w.score.join('-'), ot: w.overtime, touches, nan, outOfArena, maxBall: Math.round(maxBall), minutes: (ticks * DT / 60).toFixed(1), stats };
}

const t0 = performance.now();
console.log('1v1 Pro vs Pro    ', match(1, 1, 1, 11));
console.log('1v1 Leyenda vs Nov', match(1, 2, 0, 12));
console.log('2v2 Pro vs Pro    ', match(2, 1, 1, 13));
console.log('3v3 Pro vs Leyenda', match(3, 1, 2, 14));
console.log('tiempo total ms', Math.round(performance.now() - t0));
