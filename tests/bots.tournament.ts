// Torneo headless de bots: muchas partidas y semillas, con estadísticas detalladas.
// Uso: node --experimental-strip-types tests/bots.tournament.ts [rápido]
// Verifica la jerarquía Leyenda > Profesional > Novato, estabilidad y rendimiento.

import { BallPredictor, Bot, type Difficulty } from '../src/ai/bot.ts';
import { DIFFICULTY_NAMES } from '../src/ai/params.ts';
import { DT } from '../src/sim/constants.ts';
import { World } from '../src/sim/world.ts';

const QUICK = process.argv.includes('rapido') || process.argv.includes('rápido');

interface TeamStats {
  goals: number; shots: number; saves: number; touches: number; aerialTouches: number; demos: number;
  possession: number; kickoffWins: number;
}
const emptyTeam = (): TeamStats => ({ goals: 0, shots: 0, saves: 0, touches: 0, aerialTouches: 0, demos: 0, possession: 0, kickoffWins: 0 });

interface MatchResult { teams: [TeamStats, TeamStats]; nan: boolean; out: number; thinkMs: number[]; maneuvers: Record<string, number>[]; ticks: number; kickoffs: number }

function playMatch(teamSize: number, d0: Difficulty, d1: Difficulty, seed: number, duration: number): MatchResult {
  const w = new World({ mode: 'match', teamSize, duration, unlimitedBoost: false, seed });
  const bots: Bot[] = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < teamSize; i++) bots.push(new Bot(w.addCar(t, `B${t}${i}`, (i * 2 + t) % 6), t === 0 ? d0 : d1));
  w.setupKickoff();
  const pred = new BallPredictor();
  const teams: [TeamStats, TeamStats] = [emptyTeam(), emptyTeam()];
  let ticks = 0, nan = false, out = 0, kickoffs = 0;
  let kickoffTick = -1;
  let kickoffPending = true;
  let lastTouchTeam = -1;
  while (w.phase !== 'ended' && ticks < 120 * (duration + 240)) {
    pred.update(w);
    w.step(bots.map((b) => b.think(w, pred, DT)));
    for (const ev of w.takeEvents()) {
      if (ev.type === 'hit') {
        const car = w.cars[ev.carId];
        teams[car.team].touches++;
        if (!car.onGround && ev.pos.z > 300) teams[car.team].aerialTouches++;
        lastTouchTeam = car.team;
        if (kickoffPending) { kickoffPending = false; }
      } else if (ev.type === 'goal') teams[ev.team].goals++;
      else if (ev.type === 'shot') teams[w.cars[ev.carId].team].shots++;
      else if (ev.type === 'save') teams[w.cars[ev.carId].team].saves++;
      else if (ev.type === 'demo') teams[w.cars[ev.attacker].team].demos++;
      else if (ev.type === 'kickoff') { kickoffPending = true; kickoffs++; kickoffTick = w.tick; }
    }
    // Ganador del kickoff: lado de la cancha donde está la pelota 2,5 s después del saque
    if (kickoffTick > 0 && w.tick === kickoffTick + 300 && w.phase === 'playing') {
      const side = w.ball.pos.y > 0 ? 0 : 1; // pelota en campo rival del equipo 0 → ganó el 0
      teams[side].kickoffWins++;
      kickoffTick = -1;
    }
    if (w.phase === 'playing' && lastTouchTeam >= 0) teams[lastTouchTeam].possession += DT;
    if (w.phase === 'goal' && w.phaseTimer <= 0) w.setupKickoff();
    for (const c of w.cars) {
      if (!Number.isFinite(c.pos.x + c.pos.y + c.pos.z + c.vel.x + c.vel.y + c.vel.z)) nan = true;
      if (Math.abs(c.pos.x) > 4200 || Math.abs(c.pos.y) > 6100 || c.pos.z < -20 || c.pos.z > 2100) out++;
    }
    if (!Number.isFinite(w.ball.pos.x + w.ball.pos.y + w.ball.pos.z)) nan = true;
    ticks++;
  }
  const thinkMs = bots.map((b) => b.stats.thinkMs / Math.max(1, b.stats.thinks));
  const maneuvers = bots.map((b) => ({ aerials: b.stats.aerials, jumpShots: b.stats.jumpShots, flipShots: b.stats.flipShots, speedFlips: b.stats.speedFlips, halfFlips: b.stats.halfFlips, waveDashes: b.stats.waveDashes, flicks: b.stats.flicks, demoChases: b.stats.demoChases }));
  return { teams, nan, out, thinkMs, maneuvers, ticks, kickoffs };
}

interface Agg { matches: number; wins: number; draws: number; gf: number; ga: number; strong: TeamStats; weak: TeamStats; maneuvers: Record<string, number>; maxThink: number; avgThink: number; nan: boolean; out: number }

function series(label: string, teamSize: number, strong: Difficulty, weak: Difficulty, seeds: number[], duration: number): Agg {
  const agg: Agg = { matches: 0, wins: 0, draws: 0, gf: 0, ga: 0, strong: emptyTeam(), weak: emptyTeam(), maneuvers: {}, maxThink: 0, avgThink: 0, nan: false, out: 0 };
  let thinkSum = 0, thinkN = 0;
  seeds.forEach((seed, i) => {
    // Alternar lados para eliminar el sesgo de campo
    const strongTeam = i % 2;
    const r = playMatch(teamSize, strongTeam === 0 ? strong : weak, strongTeam === 0 ? weak : strong, seed, duration);
    const S = r.teams[strongTeam], W = r.teams[1 - strongTeam];
    agg.matches++;
    agg.gf += S.goals; agg.ga += W.goals;
    if (S.goals > W.goals) agg.wins++; else if (S.goals === W.goals) agg.draws++;
    for (const k of Object.keys(S) as (keyof TeamStats)[]) { agg.strong[k] += S[k]; agg.weak[k] += W[k]; }
    r.maneuvers.forEach((m, bi) => {
      const team = bi < teamSize ? 0 : 1;
      if (team !== strongTeam) return;
      for (const [k, v] of Object.entries(m)) agg.maneuvers[k] = (agg.maneuvers[k] ?? 0) + v;
    });
    for (const t of r.thinkMs) { agg.maxThink = Math.max(agg.maxThink, t); thinkSum += t; thinkN++; }
    agg.nan ||= r.nan;
    agg.out += r.out;
  });
  agg.avgThink = thinkSum / Math.max(1, thinkN);
  const n = (d: Difficulty) => DIFFICULTY_NAMES[d];
  console.log(`\n== ${label}: ${n(strong)} vs ${n(weak)} (${agg.matches} partidos)`);
  console.log(`   victorias ${agg.wins}/${agg.matches} (empates ${agg.draws}) · goles ${agg.gf}-${agg.ga}`);
  const row = (name: string, t: TeamStats) => `   ${name.padEnd(12)} tiros ${t.shots} · atajadas ${t.saves} · toques ${t.touches} · aéreos ${t.aerialTouches} · demos ${t.demos} · posesión ${(t.possession / 60).toFixed(1)} min · kickoffs ganados ${t.kickoffWins}`;
  console.log(row(n(strong), agg.strong));
  console.log(row(n(weak), agg.weak));
  console.log(`   maniobras (${n(strong)}): ${Object.entries(agg.maneuvers).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`   pensar: promedio ${(agg.avgThink * 1000).toFixed(0)} µs/tick · máx. bot ${(agg.maxThink * 1000).toFixed(0)} µs/tick · NaN ${agg.nan} · fuera ${agg.out}`);
  return agg;
}

const t0 = performance.now();
const dur = QUICK ? 90 : 180;
const seeds = (n: number, base: number) => Array.from({ length: n }, (_, i) => base + i * 7919);
const results: [string, Agg][] = [];
results.push(['1v1 L>N', series('1v1', 1, 2, 0, seeds(QUICK ? 2 : 8, 100), dur)]);
results.push(['1v1 P>N', series('1v1', 1, 1, 0, seeds(QUICK ? 2 : 8, 200), dur)]);
results.push(['1v1 L>P', series('1v1', 1, 2, 1, seeds(QUICK ? 4 : 10, 300), dur)]);
results.push(['2v2 L>P', series('2v2', 2, 2, 1, seeds(QUICK ? 2 : 4, 400), dur)]);
results.push(['3v3 L>P', series('3v3', 3, 2, 1, seeds(QUICK ? 2 : 4, 500), dur)]);
results.push(['3v3 P>N', series('3v3', 3, 1, 0, seeds(QUICK ? 2 : 2, 600), dur)]);

let failed = 0;
console.log('\n== Verificaciones');
for (const [name, a] of results) {
  const winRate = (a.wins + a.draws * 0.5) / a.matches;
  const okRate = winRate >= (name.includes('L>P') ? 0.7 : 0.85);
  const okDiff = a.gf > a.ga * 1.5;
  const okStable = !a.nan && a.out === 0;
  const okPerf = a.avgThink < 0.2;
  const ok = okRate && okDiff && okStable && okPerf;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(8)} ganadas ${(winRate * 100).toFixed(0)}% · goles ${a.gf}-${a.ga} · estable ${okStable} · ${(a.avgThink * 1000).toFixed(0)} µs`);
}
console.log(`\ntiempo total ${((performance.now() - t0) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
