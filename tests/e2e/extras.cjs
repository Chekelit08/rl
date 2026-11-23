// Prueba de punta a punta de entrenamiento, juego libre extendido, repeticiones, clips y editor.
// Uso: npx vite build && npx vite preview --port 4303 --strictPort &  →  node tests/e2e/extras.cjs [url] [carpeta-capturas]
/* eslint-disable */
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const URL = process.argv[2] || 'http://localhost:4303/';
const SHOTS = process.argv[3] || '';
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name.padEnd(56)} ${detail}`); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('turbogol.settings', JSON.stringify({ quality: 'baja', replays: false })));
  await page.goto(URL, { timeout: 180000 });
  await page.waitForFunction(() => window.__turbogol && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 120000 });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
  const key = (code, type = 'keydown') => G(([c, t]) => window.dispatchEvent(new KeyboardEvent(t, { code: c, key: c, bubbles: true })), [code, type]);
  const press = async (code) => { await key(code); await page.waitForTimeout(80); await key(code, 'keyup'); };
  const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);
  const clickText = (sel, text) => G(([s, t]) => { const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim().startsWith(t)); if (b) b.click(); return !!b; }, [sel, text]);

  // ---------- Menú ----------
  check('Menú: botones Entrenamiento y Repeticiones', await G(() => !!document.querySelector('[data-act=training]') && !!document.querySelector('[data-act=replays]')));

  // ---------- Entrenamiento ----------
  await G(() => document.querySelector('[data-act=training]').click());
  const packs = await G(() => document.querySelectorAll('#tg-training .tg-pack').length);
  check('Entrenamiento: lista de packs', packs >= 3, `${packs} packs`);
  await clickText('#tg-training .tg-pack:first-child button', 'Jugar');
  await page.waitForTimeout(300);
  let st = await G(() => ({ state: __turbogol.state, mode: __turbogol.ext.mode, phase: __turbogol.ext.session?.phase, hud: !document.querySelector('.tg-hud').classList.contains('hidden') }));
  check('Entrenamiento: arranca esperando el primer input', st.state === 'playing' && st.mode === 'training' && st.phase === 'esperando' && st.hud, JSON.stringify(st));
  await shot('01-entrenamiento');
  await G(() => __turbogol.fastForward(4, { throttle: 1, boost: true }));
  st = await G(() => ({ r: __turbogol.ext.session.results[0], idx: __turbogol.ext.session.index }));
  check('Entrenamiento: remate de frente = acierto y avanza', st.r === 'acierto', JSON.stringify(st));
  await press('KeyN');
  const idx = await G(() => __turbogol.ext.session.index);
  check('Entrenamiento: N pasa al siguiente tiro', idx === st.idx + 1, `tiro ${idx + 1}`);
  await press('KeyR');
  check('Entrenamiento: R reintenta (esperando)', await G(() => __turbogol.ext.session.phase === 'esperando'));
  await G(() => __turbogol.fastForward(1.5, { throttle: 1 }));
  // Rebobinar en entrenamiento
  const before = await G(() => __turbogol.world.cars[0].pos.y);
  await key('KeyZ');
  await G(() => __turbogol.fastForward(1));
  const during = await G(() => ({ y: __turbogol.world.cars[0].pos.y, rw: __turbogol.ext.debug.rewinding }));
  await key('KeyZ', 'keyup');
  await G(() => __turbogol.fastForward(0.05));
  check('Entrenamiento: mantener Z rebobina', during.rw && during.y < before - 200, `y ${before.toFixed(0)} → ${during.y.toFixed(0)}`);
  check('Entrenamiento: al soltar Z sigue jugando', await G(() => !__turbogol.ext.debug.rewinding && __turbogol.ext.session.phase === 'jugando'));
  await press('KeyG');
  await page.waitForTimeout(400);
  // Pausa: botones extra
  await press('Escape');
  await page.waitForTimeout(100);
  check('Pausa en entrenamiento: botones extra', await G(() => !!document.querySelector('#tg-pause-extra') && document.querySelector('#tg-pause-extra').textContent.includes('Cambiar de pack')));
  await G(() => __turbogol.quit());

  // ---------- Juego libre extendido ----------
  await G(() => document.querySelector('[data-act=freeplay]').click());
  await G(() => document.querySelector('[data-act=play]').click());
  await page.waitForTimeout(200);
  check('Juego libre: modo extendido', await G(() => __turbogol.ext.mode === 'freeplay' && !document.querySelector('.tg-fchips').classList.contains('hidden')));
  await G(() => __turbogol.fastForward(2, { throttle: 1 }));
  const y0 = await G(() => __turbogol.world.cars[0].pos.y);
  await key('Backspace');
  await G(() => __turbogol.fastForward(1.5));
  const y1 = await G(() => __turbogol.world.cars[0].pos.y);
  await key('Backspace', 'keyup');
  check('Juego libre: rebobinar con Retroceso', y1 < y0 - 300, `y ${y0.toFixed(0)} → ${y1.toFixed(0)}`);
  await press('KeyV');
  const v = await G(() => __turbogol.world.ball.vel.len());
  check('Juego libre: V lanza la pelota', v > 500, `${v.toFixed(0)} uu/s`);
  await G(() => __turbogol.fastForward(0.4));
  await press('KeyF');
  const p0 = await G(() => [__turbogol.world.ball.pos.x, __turbogol.world.ball.pos.y, __turbogol.world.ball.pos.z]);
  await G(() => __turbogol.fastForward(1));
  const p1 = await G(() => [__turbogol.world.ball.pos.x, __turbogol.world.ball.pos.y, __turbogol.world.ball.pos.z]);
  check('Juego libre: F congela la pelota', Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) < 1 && (await G(() => __turbogol.ext.debug.freeze)));
  await press('KeyI');
  check('Juego libre: I activa turbo infinito', await G(() => __turbogol.world.cars[0].unlimitedBoost));
  await shot('02-juego-libre');
  await G(() => __turbogol.fastForward(3, { throttle: 1, steer: 0.4 }));
  await press('KeyG');
  await page.waitForTimeout(500);
  check('Clip: toast de guardado', await G(() => document.querySelector('.tg-toast').textContent.includes('Clip guardado')));
  await G(() => __turbogol.quit());

  // ---------- Biblioteca y visor ----------
  await G(() => document.querySelector('[data-act=replays]').click());
  await clickText('#tg-library .tg-tabs button', 'Clips');
  await waitFor(() => document.querySelectorAll('#tg-library .tg-replay').length >= 2);
  const clips = await G(() => document.querySelectorAll('#tg-library .tg-replay').length);
  check('Biblioteca: clips guardados', clips >= 2, `${clips} clips`);
  await clickText('#tg-library .tg-replay:first-child button', 'Ver');
  await waitFor(() => __turbogol.ext.debug.screen === 'visor');
  await page.waitForTimeout(1500);
  st = await G(() => ({ state: __turbogol.state, screen: __turbogol.ext.debug.screen, time: document.querySelector('.tg-vtime')?.textContent }));
  check('Visor: abre y reproduce', st.state === 'ext' && st.screen === 'visor' && !/^0:00 \//.test(st.time || '0:00 /'), JSON.stringify(st));
  await shot('03-visor');
  // Velocidad, cámaras y scrub
  await clickText('.tg-viewer .seg button', '0.25×');
  await clickText('.tg-viewer .seg button', 'Libre');
  await key('KeyW'); await page.waitForTimeout(300); await key('KeyW', 'keyup');
  await clickText('.tg-viewer .seg button', 'Vos');
  await G(() => { const r = document.querySelector('.tg-vtimeline input'); r.value = '1'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300);
  st = await G(() => ({ on: [...document.querySelectorAll('.tg-viewer .seg button.on')].map((b) => b.textContent), t: document.querySelector('.tg-vtime').textContent }));
  check('Visor: velocidad, cámara de jugador y scrub', st.on.includes('0.25×') && st.on.includes('Vos') && st.t.startsWith('0:01'), JSON.stringify(st));
  await press('Space');
  const paused = await G(() => document.querySelector('.tg-vgroup .tg-vbtn:nth-child(2)').textContent === '▶');
  check('Visor: Espacio pausa', paused);
  // Exportar WebM
  const hasExport = await G(() => [...document.querySelectorAll('.tg-viewer button')].some((b) => b.textContent.startsWith('Exportar')));
  if (hasExport) {
    const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await clickText('.tg-viewer button', 'Exportar');
    const d = await dl;
    let size = 0;
    if (d) { const path = await d.path(); size = path ? require('fs').statSync(path).size : 0; }
    check('Visor: exportar WebM descarga un video', !!d && d.suggestedFilename().endsWith('.webm') && size > 1000, d ? `${d.suggestedFilename()} ${(size / 1024).toFixed(0)} KB` : 'sin descarga');
  } else check('Visor: exportar WebM disponible', false, 'MediaRecorder no disponible');
  await press('Escape');
  await waitFor(() => __turbogol.state === 'menu' && !!document.getElementById('tg-library'));
  check('Visor: Esc vuelve a la biblioteca', await G(() => __turbogol.state === 'menu' && !!document.getElementById('tg-library')));
  await G(() => __turbogol.ext.backToMenu());

  // ---------- Partido: grabación, repetición de gol con director, guardado al terminar ----------
  await G(() => { __turbogol.settings.replays = true; });
  await G(() => { document.querySelector('[data-act=match]').click(); document.querySelector('[data-act=play]').click(); });
  await G(() => __turbogol.fastForward(3.2));
  await G(() => { const w = __turbogol.world; w.ball.pos.set(0, 4700, 93); w.ball.vel.set(0, 2500, 0); });
  await G(() => __turbogol.fastForward(5));
  st = await G(() => ({ state: __turbogol.state, shot: __turbogol.renderer.camCtl.currentShot }));
  check('Repetición de gol: usa el director', st.state === 'replay' && ['chase', 'wide', 'goal', 'low'].includes(st.shot), JSON.stringify(st));
  await page.waitForTimeout(1200);
  const shots = await G(() => __turbogol.renderer.camCtl.currentShot);
  await press('Space');
  await waitFor(() => __turbogol.state === 'playing');
  check('Repetición de gol: al terminar se oculta el cartel', await G(() => document.getElementById('replayBadge').classList.contains('hidden') && __turbogol.world.phase === 'countdown'));
  check('Partido: graba mientras se juega', (await G(() => __turbogol.ext.debug.recFrames)) > 100, `${await G(() => __turbogol.ext.debug.recFrames)} cuadros · plano ${shots}`);
  await G(() => { __turbogol.settings.replays = false; __turbogol.world.clock = 2; });
  await G(() => __turbogol.fastForward(12));
  await G(() => __turbogol.fastForward(4));
  await waitFor(() => !document.getElementById('end').classList.contains('hidden'), null, 60000);
  st = await G(() => ({ state: __turbogol.state, phase: __turbogol.world.phase, btn: !!document.querySelector('#end .tg-endbtns') }));
  check('Partido: termina con botones de repetición', st.phase === 'ended' && st.btn, JSON.stringify(st));
  await clickText('#end .tg-endbtns button', 'Guardar repetición');
  await page.waitForTimeout(500);
  await clickText('#end .tg-endbtns button', 'Ver repetición');
  await waitFor(() => __turbogol.ext.debug.screen === 'visor');
  await page.waitForTimeout(500);
  st = await G(() => ({ screen: __turbogol.ext.debug.screen, marks: document.querySelectorAll('.tg-vmarks i').length, cams: document.querySelectorAll('.tg-viewer .seg button[data-cam=jugador]').length }));
  check('Partido: repetición guardada y visor con goles', st.screen === 'visor' && st.marks >= 1 && st.cams === 2, JSON.stringify(st));
  await press('Escape');
  await waitFor(() => document.querySelectorAll('#tg-library .tg-replay').length >= 1);
  const saved = await G(() => [...document.querySelectorAll('#tg-library .tg-replay b')].map((b) => b.textContent));
  check('Biblioteca: partido guardado (★)', saved.some((t) => t.startsWith('★')), saved.slice(0, 2).join(' | '));
  await G(() => __turbogol.ext.backToMenu());

  // ---------- Editor ----------
  await G(() => document.querySelector('[data-act=training]').click());
  await clickText('#tg-training .actions button', 'Crear pack');
  await page.waitForTimeout(500);
  check('Editor: abre', await G(() => __turbogol.ext.debug.screen === 'editor' && !!document.querySelector('.tg-editor')));
  const bx0 = await G(() => __turbogol.world.ball.pos.x);
  await page.mouse.click(300, 360);
  await page.waitForTimeout(200);
  const bx1 = await G(() => __turbogol.world.ball.pos.x);
  check('Editor: clic ubica la pelota', Math.abs(bx1 - bx0) > 50, `x ${bx0.toFixed(0)} → ${bx1.toFixed(0)}`);
  await G(() => { const rows = [...document.querySelectorAll('.tg-ed-row')]; const r = rows.find((x) => x.textContent.startsWith('Rapidez')); const i = r.querySelector('input[type=number]'); i.value = '1500'; i.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(200);
  await shot('04-editor');
  check('Editor: flecha de velocidad visible', await G(() => { let vis = false; __turbogol.renderer.scene.traverse((o) => { if (o.type === 'ArrowHelper' && o.visible && o.parent?.visible !== false) vis = true; }); return vis; }));
  await clickText('.tg-editor button', 'Guardar pack');
  check('Editor: guardar pack', await G(() => JSON.parse(localStorage.getItem('turbogol.packs') || '[]').length >= 1));
  await clickText('.tg-editor button', 'Probar tiro');
  await page.waitForTimeout(300);
  st = await G(() => ({ state: __turbogol.state, mode: __turbogol.ext.mode, testing: __turbogol.ext.testing }));
  check('Editor: probar tiro', st.state === 'playing' && st.mode === 'training' && st.testing, JSON.stringify(st));
  await press('Escape');
  await page.waitForTimeout(150);
  await clickText('#tg-pause-extra button', 'Volver al editor');
  await page.waitForTimeout(400);
  check('Editor: volver desde la pausa', await G(() => __turbogol.ext.debug.screen === 'editor'));
  await G(() => __turbogol.ext.closeEditor());
  await page.waitForTimeout(200);
  const own = await G(() => [...document.querySelectorAll('#tg-training .tg-badge.own')].length);
  check('Menú de entrenamiento: muestra el pack propio', own >= 1, `${own} propio(s)`);

  check('Sin errores de JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
