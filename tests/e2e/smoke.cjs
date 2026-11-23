// Prueba de humo end-to-end con Playwright (Chromium con render por software).
// Uso: npx vite build && npx vite preview --port 4173 --strictPort &  luego  node tests/e2e/smoke.cjs [url] [carpeta_capturas]
// Recorre los menús principales, juega unos segundos en cada modo y falla si hay errores de página.

const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text().slice(0, 300)}`); });
  // Calidad baja para que el render por software sea tolerable
  await page.addInitScript(() => {
    try {
      const s = JSON.parse(localStorage.getItem('turbogol.settings') || '{}');
      s.quality = 'baja';
      localStorage.setItem('turbogol.settings', JSON.stringify(s));
    } catch { /* ignorar */ }
  });

  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      await fn();
      console.log(`✅ ${name} (${Date.now() - t0} ms)`);
    } catch (e) {
      errors.push(`[paso] ${name}: ${e.message}`);
      console.log(`❌ ${name}: ${e.message}`);
    }
  };
  const click = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('no existe ' + s); el.click(); }, sel);
  const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
  const game = (fn, arg) => page.evaluate(fn, arg);

  await step('carga', async () => {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForSelector('#loading.hidden', { timeout: 120000, state: 'attached' });
    await page.waitForTimeout(1500);
    await shot('01-menu');
  });

  await step('juego libre', async () => {
    await click('[data-act=freeplay]');
    await click('[data-act=play]');
    await page.waitForTimeout(800);
    await game(() => window.__turbogol.fastForward(3, { throttle: 1, boost: true }));
    await page.waitForTimeout(800);
    const st = await game(() => window.__turbogol.state);
    if (st !== 'playing') throw new Error('estado ' + st);
    await shot('02-libre');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await click('#pause [data-act=quit]');
  });

  for (const n of [1, 2, 3]) {
    await step(`partido ${n}v${n}`, async () => {
      await click('[data-act=match]');
      await click(`[data-key=teamSize] button[data-v="${n}"]`);
      await click('[data-act=play]');
      await page.waitForTimeout(800);
      await game(() => window.__turbogol.fastForward(15, { throttle: 1, steer: 0.2 }));
      await page.waitForTimeout(800);
      const info = await game(() => ({ state: window.__turbogol.state, phase: window.__turbogol.world.phase, cars: window.__turbogol.world.cars.length, clock: window.__turbogol.world.clock }));
      if (info.cars !== n * 2) throw new Error(`autos ${info.cars}`);
      if (info.clock >= 300) throw new Error('el reloj no avanzó');
      await shot(`03-partido-${n}v${n}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const paused = await game(() => window.__turbogol.state);
      if (paused === 'paused') await click('#pause [data-act=quit]');
      else await game(() => window.__turbogol.quit());
    });
  }

  await step('ajustes', async () => {
    await click('#menu [data-act=settings]');
    await page.waitForTimeout(300);
    await shot('04-ajustes');
    await click('[data-act=closeSettings]');
  });

  await step('controles', async () => {
    await click('#menu [data-act=controls]');
    await page.waitForTimeout(300);
    await click('[data-act=closeControls]');
  });

  // Menús agregados por otras fases: se abren si existen y se vuelve con Escape (o el botón de volver)
  const extra = await page.evaluate(() => [...document.querySelectorAll('#menu [data-act]')].map((b) => b.getAttribute('data-act')));
  console.log('Menú principal:', extra.join(', '));
  const base = new Set(['match', 'freeplay', 'settings', 'controls']);
  for (const act of extra) {
    if (base.has(act)) continue;
    await step(`pantalla "${act}"`, async () => {
      await click(`#menu [data-act="${act}"]`);
      await page.waitForTimeout(2500);
      await shot(`05-${act}`);
      const menuVisible = () => page.evaluate(() => !document.getElementById('menu').classList.contains('hidden') && getComputedStyle(document.getElementById('menu')).display !== 'none');
      if (await menuVisible()) {
        // Algunas entradas abren primero un submenú del propio menú: está bien si no hubo errores
        return;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      if (!(await menuVisible())) {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button, [data-act]')].find((el) => /volver|cerrar|atr[aá]s|men[uú]/i.test(el.textContent || '') && el.offsetParent !== null);
          b?.click();
        });
        await page.waitForTimeout(1500);
      }
      if (!(await menuVisible())) {
        const st = await game(() => window.__turbogol.state);
        if (st !== 'menu') await game(() => window.__turbogol.quit());
        await page.waitForTimeout(800);
        if (!(await menuVisible())) throw new Error('no se pudo volver al menú');
      }
    });
  }

  await browser.close();
  if (errors.length) {
    console.log('\nErrores:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('\nPrueba de humo OK');
})();
