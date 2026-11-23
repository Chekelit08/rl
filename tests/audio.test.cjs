// Prueba de audio con OfflineAudioContext en Chromium headless.
// Renderiza escenarios completos (partido, estrés, música de menú) y verifica niveles RMS, picos (sin clipping),
// ausencia de NaN, límite de voces simultáneas y que el motor "suba" de brillo con las RPM.
// Uso: node tests/audio.test.cjs   (AUDIO_WAV_DIR=/ruta guarda WAVs para inspección)

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.AUDIO_TEST_PORT || 4306);
const root = path.resolve(__dirname, '..');
const wavDir = process.env.AUDIO_WAV_DIR || '';

function waitHttp(url, ms) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http.get(url, (res) => { res.resume(); resolve(); }).on('error', () => {
        if (Date.now() - t0 > ms) reject(new Error('Vite no arrancó')); else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

/** Se ejecuta dentro de la página. */
async function runScenario(kind) {
  const sr = 44100;
  const T = kind === 'partido' ? 22 : kind === 'musica' ? 18 : 4;
  const ctx = new OfflineAudioContext(2, sr * T, sr);
  const eng = new window.AudioEngine();
  eng.start(ctx);
  const core = eng.core;
  const cam = {
    position: { x: 0, y: -3270, z: 117 },
    quaternion: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
    getWorldDirection(v) { return v.set(0, 1, 0); },
  };
  const yawQ = { qx: 0, qy: 0, qz: Math.SQRT1_2, qw: Math.SQRT1_2 };
  const mkCar = (id, team, x, y, z, vx, vy, vz, o) => Object.assign({
    id, team, x, y, z, ...yawQ, vx, vy, vz, boosting: false, supersonic: false, demoed: false, onGround: true,
    steer: 0, throttle: 0, boost: 50, handbrake: 0,
  }, o);
  const ball = { x: 0, y: 0, z: 93, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, hidden: false };

  // Línea de tiempo de eventos
  const P = (x, y, z) => ({ x, y, z });
  const events = [];
  if (kind === 'partido') {
    events.push(
      [1.0, { type: 'hit', carId: 0, strength: 800, pos: P(0, -2500, 100) }],
      [2.0, { type: 'hit', carId: 0, strength: 2000, pos: P(0, -2000, 100) }],
      [3.0, { type: 'hit', carId: 1, strength: 3500, pos: P(800, -1000, 300) }],
      [4.0, { type: 'bounce', strength: 1500, pos: P(0, -1500, 92) }],
      [4.4, { type: 'bounce', strength: 1500, pos: P(4000, 0, 200) }],
      [4.8, { type: 'bounce', strength: 1500, pos: P(4000, 0, 900) }],
      [5.2, { type: 'bounce', strength: 2000, pos: P(893, 5120, 300) }],
      [5.6, { type: 'bounce', strength: 1200, pos: P(0, 0, 1950) }],
      [6.0, { type: 'pad', carId: 0, big: true }],
      [6.3, { type: 'pad', carId: 0, big: false }],
      [6.6, { type: 'jump', carId: 0 }],
      [6.9, { type: 'flip', carId: 0 }],
      [7.2, { type: 'flipreset', carId: 0 }],
      [9.0, { type: 'shot', carId: 0 }],
      [11.0, { type: 'goal', team: 0, scorerId: 0, assistId: -1, speed: 3000, pos: P(0, 5300, 300) }],
      [13.0, { type: 'demo', attacker: 0, victim: 1, pos: P(500, 0, 17) }],
      [13.8, { type: 'bump', attacker: 1, victim: 0, pos: P(0, 0, 17) }],
      [14.5, { type: 'save', carId: 0 }],
      [15.0, { type: 'countdown', n: 3 }],
      [15.7, { type: 'countdown', n: 2 }],
      [16.4, { type: 'countdown', n: 1 }],
      [17.1, { type: 'kickoff' }],
      [18.0, { type: 'overtime' }],
      [19.5, { type: 'end', winner: 0 }],
    );
  } else if (kind === 'estres') {
    let r = 1;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) events.push([rnd() * 1.0, { type: 'hit', carId: 0, strength: 500 + rnd() * 3500, pos: P(rnd() * 4000 - 2000, rnd() * 8000 - 4000, 100 + rnd() * 1500) }]);
    for (let i = 0; i < 60; i++) events.push([rnd() * 1.5, { type: 'bounce', strength: 400 + rnd() * 2500, pos: P(rnd() * 8000 - 4000, rnd() * 10000 - 5000, rnd() * 2000) }]);
    for (let i = 0; i < 10; i++) events.push([0.5 + rnd(), { type: 'demo', attacker: 1, victim: 2, pos: P(0, 0, 17) }]);
    for (let i = 0; i < 4; i++) events.push([0.2 + i * 0.3, { type: 'goal', team: 0, scorerId: 0, assistId: -1, speed: 3000, pos: P(0, 5300, 300) }]);
  }
  events.sort((a, b) => a[0] - b[0]);

  const dt = 1 / 60;
  let ei = 0;
  let maxVoices = 0;
  const probes = {};
  let y = -3000;
  for (let t = 0; t < T - 0.3; t += dt) {
    core.clockOverride = t;
    let state = kind === 'musica' ? 'menu' : 'playing';
    if (kind === 'partido' && t >= 19.5) state = 'ended';
    // Auto local: acelera, turbo, supersónico, derrape, vuelo y aterrizaje
    let speed = 0, throttle = 0, boosting = false, supersonic = false, onGround = true, handbrake = 0, vz = 0, vx = 0;
    if (t < 4) { speed = 1410 * Math.min(1, t / 3.2); throttle = 1; }
    else if (t < 8) { speed = Math.min(2300, 1410 + (t - 4) * 450); throttle = 1; boosting = true; supersonic = speed > 2200; }
    else if (t < 9) { speed = 2300 - (t - 8) * 600; }
    else if (t < 10.5) { speed = 1200; throttle = 1; handbrake = 1; vx = 500; }
    else if (t < 11.2) { speed = 1300; throttle = 1; }
    else if (t < 12) { speed = 1300; onGround = false; vz = 600 - (t - 11.2) * 2300; }
    else { speed = 1100; throttle = 0.6; }
    y += speed * dt;
    const me = mkCar(0, 0, 0, y % 5000, 17, vx, speed, vz, { throttle, boosting, supersonic, onGround, handbrake });
    const other = mkCar(1, 1, 1500 * Math.cos(t), 1500 * Math.sin(t), 17, -1500 * Math.sin(t), 1500 * Math.cos(t), 0, { throttle: 1, boosting: t % 3 < 1 });
    // Pelota: casi gol entre 9.4 y 10.4 s (se acerca rápido y rebota afuera) → "uuuh"
    if (kind === 'partido' && t > 9.4 && t < 10.4) {
      const k = t - 9.4;
      ball.x = 1300; ball.z = 300;
      if (k < 0.5) { ball.y = 4200 + k * 1700; ball.vy = 2500; } else { ball.y = 5050 - (k - 0.5) * 1500; ball.vy = -1500; }
    } else { ball.x = 0; ball.y = 0; ball.vy = 0; }
    const snap = { tick: Math.floor(t * 120), cars: [me, other], ball: { ...ball }, pads: [] };
    while (ei < events.length && events[ei][0] <= t) { eng.onEvent(events[ei][1], snap, 0); ei++; }
    eng.update(dt, snap, cam, state, kind === 'musica' ? -1 : 0);
    const info = eng.debugInfo();
    maxVoices = Math.max(maxVoices, info.voices);
    for (const pt of [0.5, 3.5, 7.5, 12.5]) if (Math.abs(t - pt) < dt / 2) probes['rpm@' + pt] = Math.round(info.rpm) + ' (marcha ' + info.gear + ')';
  }
  core.clockOverride = null;
  const buf = await ctx.startRendering();

  // Análisis
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0, nan = 0, clip = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nan++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    if (m >= 0.999) clip++;
  }
  const win = Math.floor(sr * 0.25);
  const rms = [];
  for (let s = 0; s + win <= L.length; s += win) {
    let acc = 0;
    for (let i = s; i < s + win; i++) acc += (L[i] * L[i] + R[i] * R[i]) / 2;
    rms.push(+(10 * Math.log10(acc / win + 1e-12)).toFixed(1));
  }
  // Centroide espectral (DFT de 2048 muestras) en instantes clave
  const centroid = (t) => {
    const N = 2048, s0 = Math.floor(t * sr);
    let num = 0, den = 0;
    for (let k = 1; k < N / 2; k += 2) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
        const x = L[s0 + n] * w;
        const ph = (2 * Math.PI * k * n) / N;
        re += x * Math.cos(ph); im -= x * Math.sin(ph);
      }
      const mag = Math.hypot(re, im);
      num += mag * (k * sr) / N; den += mag;
    }
    return Math.round(num / (den || 1));
  };
  const cents = kind === 'partido' ? { 'c@0.6': centroid(0.6), 'c@7.6': centroid(7.6) } : {};

  // WAV opcional
  let wav = '';
  if (window.__wantWav) {
    const n = L.length;
    const ab = new ArrayBuffer(44 + n * 4);
    const dv = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true);
    dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    const bytes = new Uint8Array(ab);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    wav = btoa(bin);
  }
  return { kind, seconds: T, peak: +peak.toFixed(3), nan, clip, maxVoices, maxAllowed: core.maxVoices, rms, probes, cents, wav };
}

(async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  let failed = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? '✅' : '❌'} ${name.padEnd(50)} ${detail}`); if (!ok) failed++; };
  try {
    await waitHttp(`http://localhost:${PORT}/tests/audio-harness.html`, 30000);
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/tests/audio-harness.html`);
    await page.waitForFunction(() => window.harnessReady === true, null, { timeout: 30000 });
    if (wavDir) await page.evaluate(() => { window.__wantWav = true; });
    for (const kind of ['partido', 'estres', 'musica']) {
      const t0 = Date.now();
      const r = await page.evaluate(runScenario, kind);
      const ms = Date.now() - t0;
      if (wavDir && r.wav) { fs.mkdirSync(wavDir, { recursive: true }); fs.writeFileSync(path.join(wavDir, `${kind}.wav`), Buffer.from(r.wav, 'base64')); }
      const avg = (a, b) => { const s = r.rms.slice(a * 4, b * 4); return s.reduce((x, y) => x + y, 0) / s.length; };
      console.log(`\n— ${kind} (${r.seconds} s renderizados en ${ms} ms) pico=${r.peak} voces máx=${r.maxVoices}/${r.maxAllowed}`);
      console.log('  RMS dB por 0.25 s:', r.rms.join(' '));
      if (Object.keys(r.probes).length) console.log('  RPM:', JSON.stringify(r.probes));
      if (Object.keys(r.cents).length) console.log('  Centroide (Hz):', JSON.stringify(r.cents));
      check(`[${kind}] sin NaN`, r.nan === 0, `NaN=${r.nan}`);
      check(`[${kind}] pico < 1.0 (sin clipping)`, r.peak < 1.0 && r.clip === 0, `pico=${r.peak} muestras≥0.999: ${r.clip}`);
      check(`[${kind}] límite de voces respetado`, r.maxVoices <= r.maxAllowed, `${r.maxVoices} ≤ ${r.maxAllowed}`);
      if (kind === 'partido') {
        const quiet = r.rms.slice(4, 76).filter((x) => x < -50).length;
        check('[partido] siempre se escucha algo (motor + público)', quiet === 0, `ventanas < -50 dB: ${quiet}`);
        check('[partido] el gol es el momento más fuerte', avg(11, 12.5) > avg(9.9, 10.9) + 2, `gol ${avg(11, 12.5).toFixed(1)} dB vs antes ${avg(9.9, 10.9).toFixed(1)} dB`);
        check('[partido] el motor sube de brillo con las RPM', r.cents['c@7.6'] > r.cents['c@0.6'], `${r.cents['c@0.6']} Hz → ${r.cents['c@7.6']} Hz`);
        check('[partido] mezcla razonable (RMS medio -40…-10 dB)', avg(1, 19) > -40 && avg(1, 19) < -10, `${avg(1, 19).toFixed(1)} dB`);
      }
      if (kind === 'musica') {
        const s = r.rms.slice(10, 68);
        const gaps = s.filter((x) => x < -45).length;
        check('[música] suena continua después del fundido', gaps === 0, `ventanas < -45 dB: ${gaps}`);
        check('[música] nivel moderado', avg(3, 16) > -36 && avg(3, 16) < -12, `${avg(3, 16).toFixed(1)} dB`);
      }
    }
    check('Sin errores en la consola', errors.length === 0, errors.slice(0, 3).join(' | ') || 'ok');
    await browser.close();
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    vite.kill('SIGTERM');
  }
  console.log(failed ? `\n${failed} verificación(es) fallaron` : '\nTodas las verificaciones de audio pasaron');
  process.exit(failed ? 1 : 0);
})();
