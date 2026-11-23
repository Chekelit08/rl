// Prueba de punta a punta del online con Playwright: el servidor sirve dist/ y dos pestañas del navegador
// juegan en la misma sala (crear, unirse por enlace, listo, empezar, gol, marcador y resultado final).
// Requiere `npx vite build` antes. Ejecutar: npm run test:net:e2e
// Variables: SHOTS=<carpeta> guarda capturas del lobby y del partido.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/main.ts';

const require = createRequire(import.meta.url);
type PW = typeof import('playwright');
function loadPlaywright(): PW {
  try { return require('playwright'); } catch { /* no está en el proyecto */ }
  const root = execSync('npm root -g').toString().trim();
  return require(path.join(root, 'playwright'));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('Falta dist/: corré `npx vite build` primero');
  process.exit(1);
}

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(50)} ${detail}`);
  if (!ok) failed++;
}

const shots = process.env.SHOTS;
const { chromium } = loadPlaywright();
const srv = await startServer({ port: 0, staticDir: dist, log: false });
const origin = `http://127.0.0.1:${srv.port}`;
const serverParam = `server=${encodeURIComponent(`ws://127.0.0.1:${srv.port}/ws`)}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

type Page = Awaited<ReturnType<typeof browser.newPage>>;
interface OnlineDebug {
  active: boolean; status: string; lastError: string;
  room: { code: string; state: string; players: { name: string; team: number; ready: boolean }[] } | null;
  match: { ready: boolean; localId: number; world: { score: number[]; tick: number }; stats: { ping: number } } | null;
}
const onlineOf = (p: Page) => p.evaluate(() => {
  const o = (window as unknown as { __turbogol: { online: OnlineDebug } }).__turbogol.online;
  return {
    active: o.active, status: o.status, err: o.lastError, code: o.room?.code ?? '', state: o.room?.state ?? '',
    players: o.room?.players.map((p) => `${p.name}:${p.team}:${p.ready ? 1 : 0}`) ?? [],
    ready: !!o.match?.ready, score: o.match ? o.match.world.score.join('-') : '', ping: o.match?.stats.ping ?? 0,
  };
});
async function waitUntil(p: Page, what: string, cond: (s: Awaited<ReturnType<typeof onlineOf>>) => boolean, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const s = await onlineOf(p);
    if (cond(s)) return s;
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${what}: ${JSON.stringify(s)}`);
    await p.waitForTimeout(150);
  }
}
const click = (p: Page, sel: string) => p.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.click(), sel);

try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('turbogol.settings', JSON.stringify({ quality: 'baja', replays: false })); } catch { /* */ }
  });
  const errors: string[] = [];
  const A = await ctx.newPage();
  const B = await ctx.newPage();
  for (const [n, p] of [['A', A], ['B', B]] as const) {
    p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
    p.on('crash', () => { errors.push(`${n}: la pestaña se colgó`); console.log(`   [${n}] la pestaña se colgó`); });
    p.on('close', () => console.log(`   [${n}] pestaña cerrada`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n} consola: ${m.text()}`); });
  }

  // Pestaña A: crea una sala 1v1
  await A.goto(`${origin}/?${serverParam}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await A.waitForFunction(() => !!(window as unknown as { __turbogol?: unknown }).__turbogol, null, { timeout: 120000 });
  await A.evaluate(() => localStorage.setItem('turbogol.name', 'Ana'));
  await click(A, '[data-act="online"]');
  await waitUntil(A, 'conexión', (s) => s.status === 'open');
  await click(A, '[data-on="cTeam:1"]');
  await click(A, '[data-on="create"]');
  const a1 = await waitUntil(A, 'sala creada', (s) => s.code.length === 5);
  check('Pestaña A crea una sala con código', /^[A-Z]{5}$/.test(a1.code), a1.code);

  // Pestaña B: entra con el enlace ?room=CODE
  await B.bringToFront(); // la pestaña A deja de dibujar mientras B carga (comparten el proceso de GPU)
  const tB = Date.now();
  await B.goto(`${origin}/?${serverParam}&room=${a1.code}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await B.waitForFunction(() => !!(window as unknown as { __turbogol?: unknown }).__turbogol, null, { timeout: 120000 });
  await B.evaluate(() => localStorage.setItem('turbogol.name', 'Beto'));
  console.log(`   (pestaña B lista en ${((Date.now() - tB) / 1000).toFixed(1)} s)`);
  const b1 = await waitUntil(B, 'unirse', (s) => s.code === a1.code && s.players.length === 2);
  check('Pestaña B se une por enlace a la misma sala', b1.code === a1.code, b1.players.join(', '));
  const a2 = await waitUntil(A, 'lobby con 2', (s) => s.players.length === 2);
  const teams = a2.players.map((p) => p.split(':')[1]);
  check('Lobby con un jugador por equipo', teams.includes('0') && teams.includes('1'), a2.players.join(', '));

  await click(B, '#onReady');
  await waitUntil(A, 'B listo', (s) => s.players.some((p) => p.endsWith(':1')));
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await A.screenshot({ path: path.join(shots, 'online-lobby.png') }); }
  await click(A, '#onStart');
  const [sa, sb] = await Promise.all([
    waitUntil(A, 'partido A', (s) => s.active && s.ready, 30000),
    waitUntil(B, 'partido B', (s) => s.active && s.ready, 30000),
  ]);
  check('Las dos pestañas entran al partido', sa.active && sb.active, `ping A ${sa.ping} ms · B ${sb.ping} ms`);

  // Manejar un rato en las dos pestañas
  await A.bringToFront();
  await A.keyboard.down('KeyW');
  await B.bringToFront();
  await B.keyboard.down('KeyW');
  await B.waitForTimeout(5000);
  await A.keyboard.up('KeyW');
  await B.keyboard.up('KeyW');
  const room = srv.lobby.rooms.get(a1.code)!;
  const sw = room.match!.world;
  const moved = sw.cars.map((c) => Math.round(Math.hypot(c.vel.x, c.vel.y) + Math.abs(c.pos.y)));
  check('El servidor simula el partido', sw.tick > 600 && sw.phase !== 'countdown', `tick ${sw.tick}, fase ${sw.phase}`);
  void moved;

  // Gol forzado en el servidor: el marcador tiene que coincidir en las dos pestañas
  sw.ball.reset(0, 4300);
  sw.ball.pos.z = 300;
  sw.ball.vel.set(0, 3500, 0);
  const [ga, gb] = await Promise.all([
    waitUntil(A, 'gol en A', (s) => s.score === '1-0'),
    waitUntil(B, 'gol en B', (s) => s.score === '1-0'),
  ]);
  const hud = await Promise.all([A, B].map((p) => p.evaluate(() => `${document.getElementById('s0')!.textContent}-${document.getElementById('s1')!.textContent}`)));
  check('Gol: marcador igual en servidor y pestañas', ga.score === sw.score.join('-') && gb.score === ga.score && hud[0] === '1-0' && hud[1] === '1-0',
    `servidor ${sw.score.join('-')} · A ${ga.score} (HUD ${hud[0]}) · B ${gb.score} (HUD ${hud[1]})`);
  const chip = await A.evaluate(() => document.getElementById('netChip')?.textContent ?? '');
  check('Indicador de ping y pérdida en el HUD', /\d+ ms.*pérdida \d+%/.test(chip), chip);
  if (shots) await A.screenshot({ path: path.join(shots, 'online-partido.png') });

  // Fin del partido: pantalla de resultado en las dos pestañas
  await A.waitForTimeout(1500);
  sw.clock = 0.5;
  const res = await Promise.all([A, B].map(async (p) => {
    await p.waitForSelector('#onResult', { timeout: 30000 });
    return p.evaluate(() => document.getElementById('onResult')!.textContent);
  }));
  check('Resultado final en las dos pestañas', res[0] === '¡Victoria!' && res[1] === 'Derrota', `A ${res[0]} · B ${res[1]}`);
  if (shots) await B.screenshot({ path: path.join(shots, 'online-resultado.png') });

  // Volver a la sala
  await click(A, '[data-on="toLobby"]');
  const back = await Promise.all([A, B].map((p) => waitUntil(p, 'vuelta al lobby', (s) => !s.active && s.state === 'lobby')));
  check('Las dos pestañas vuelven al lobby', back.every((s) => s.code === a1.code));
  check('Sin errores en la consola', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('❌ Error:', (e as Error).message);
  failed++;
} finally {
  await browser.close();
  await srv.close();
}

console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas de punta a punta del online pasaron');
process.exit(failed ? 1 : 0);
