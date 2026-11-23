// Público reactivo: murmullo, charla (formantes), rugido según la tensión, "uuuh" en las que pasan cerca,
// explosión en los goles, aplausos pre-renderizados, cánticos rítmicos con palmas y silbidos de festejo.

import { ARENA } from '../sim/constants.ts';
import { type AudioCore, clamp01, rand01 } from './core.ts';

// Formantes de vocales (F1, F2) — voz grave masculina/femenina mezclada
const VOWELS: Record<string, [number, number]> = {
  a: [760, 1220], e: [520, 1820], i: [320, 2250], o: [520, 900], u: [330, 830],
};

/** Resonador de dos polos (para síntesis en JS de buffers). */
function resonate(x: Float32Array, freq: number, bw: number, sr: number) {
  const r = Math.exp((-Math.PI * bw) / sr);
  const a1 = 2 * r * Math.cos((2 * Math.PI * freq) / sr), a2 = -r * r;
  let y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] * (1 - r) + a1 * y1 + a2 * y2;
    y2 = y1; y1 = y;
    x[i] = y;
  }
}

export class Crowd {
  private c: AudioCore;
  private out: GainNode;
  private murmur: GainNode;
  private babble: GainNode;
  private roar: GainNode;
  private roarFilter: BiquadFilterNode;
  private applauseBuf: AudioBuffer;
  private babbleBuf: AudioBuffer;
  private tension = 0;
  private excite = 0;
  private level = 1;
  private missArmed = 0;
  private missSide = 0;
  private oohCooldown = 0;
  private chantTimer = 30;
  private pendingChant = -1;
  private rnd = rand01(4242);

  constructor(c: AudioCore) {
    this.c = c;
    const ctx = c.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(c.buses.publico);
    const rev = ctx.createGain();
    rev.gain.value = 0.25;
    this.out.connect(rev).connect(c.reverbSend);

    this.applauseBuf = this.renderApplause(6);
    this.babbleBuf = this.renderBabble(5.5);

    // Murmullo de fondo
    this.murmur = ctx.createGain();
    this.murmur.gain.value = 0.06;
    const m = c.noise('pink', true);
    m.connect(c.filter('bandpass', 480, 0.55)).connect(this.murmur).connect(this.out);
    m.start();
    // Charla (dos copias desfasadas para que no se note el loop)
    this.babble = ctx.createGain();
    this.babble.gain.value = 0.16;
    for (const off of [0, 2.7]) {
      const b = ctx.createBufferSource();
      b.buffer = this.babbleBuf;
      b.loop = true;
      b.playbackRate.value = off ? 0.97 : 1.02;
      b.connect(this.babble);
      b.start(0, off);
    }
    this.babble.connect(this.out);
    // Rugido (crece con la tensión y explota en los goles)
    this.roar = ctx.createGain();
    this.roar.gain.value = 0;
    const r = c.noise('pink', true);
    const r2 = c.noise('brown', true);
    this.roarFilter = c.filter('lowpass', 1400, 0.6);
    const pk = c.filter('peaking', 850, 0.9, 5);
    r.connect(this.roarFilter);
    const r2g = ctx.createGain();
    r2g.gain.value = 0.6;
    r2.connect(r2g).connect(this.roarFilter);
    this.roarFilter.connect(pk).connect(this.roar).connect(this.out);
    r.start(); r2.start();
  }

  /** Nivel general (menú más bajo, partido normal, pausa baja). */
  setLevel(level: number) {
    this.level = level;
    this.out.gain.setTargetAtTime(level, this.c.now(), 0.6);
  }

  // ---------- Buffers sintetizados en JS (evita crear miles de nodos) ----------
  private renderApplause(seconds: number): AudioBuffer {
    const ctx = this.c.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const r = rand01(77);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const claps = Math.floor(seconds * 70);
      for (let k = 0; k < claps; k++) {
        const start = Math.floor(r() * (len - sr * 0.03));
        const n = Math.floor(sr * (0.006 + r() * 0.01));
        const tmp = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) tmp[i] = (r() * 2 - 1) * Math.exp(-i / (n * 0.35));
        resonate(tmp, 900 + r() * 1700, 500 + r() * 900, sr);
        const amp = 0.25 + r() * 0.75;
        for (let i = 0; i < tmp.length && start + i < len; i++) d[start + i] += tmp[i] * amp * 1.4;
      }
      // Bordes suaves para el loop
      const f = 2048;
      for (let i = 0; i < f; i++) { d[i] *= i / f; d[len - 1 - i] *= i / f; }
    }
    return buf;
  }

  private renderBabble(seconds: number): AudioBuffer {
    const ctx = this.c.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const r = rand01(1234);
    const vow = Object.values(VOWELS);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let v = 0; v < 14; v++) {
        const pitch = 95 + r() * 150;
        const voice = new Float32Array(len);
        let phase = 0;
        let t = Math.floor(r() * sr * 0.5);
        // Sílabas: tren glotal con envolvente, separado por pausas
        while (t < len) {
          const syl = Math.floor(sr * (0.11 + r() * 0.16));
          const p = pitch * (0.9 + r() * 0.25);
          for (let i = 0; i < syl && t + i < len; i++) {
            phase += p / sr;
            if (phase >= 1) phase -= 1;
            const glot = phase < 0.4 ? Math.sin((phase / 0.4) * Math.PI) : 0;
            const e = Math.sin((i / syl) * Math.PI);
            voice[t + i] = (glot - 0.25 + (r() - 0.5) * 0.15) * e;
          }
          t += syl + Math.floor(sr * (r() < 0.25 ? 0.25 + r() * 0.5 : 0.02 + r() * 0.06));
        }
        // Formantes de una vocal cualquiera (la mezcla de muchas voces suena a "charla")
        const [f1, f2] = vow[Math.floor(r() * vow.length)];
        const a = Float32Array.from(voice), b = Float32Array.from(voice);
        resonate(a, f1 * (0.9 + r() * 0.2), 120, sr);
        resonate(b, f2 * (0.9 + r() * 0.2), 180, sr);
        const amp = 0.4 + r() * 0.6;
        for (let i = 0; i < len; i++) d[i] += (a[i] * 1.1 + b[i] * 0.7) * amp * 0.5;
      }
      const f = 4096;
      for (let i = 0; i < f; i++) { d[i] *= i / f; d[len - 1 - i] *= i / f; }
    }
    return buf;
  }

  // ---------- Reacciones ----------
  private applause(at: number, dur: number, peak: number) {
    const ctx = this.c.ctx;
    const v = this.c.voice({ bus: 'publico', dur: dur + 1.5, prio: 3 });
    if (!v) return;
    const s = ctx.createBufferSource();
    s.buffer = this.applauseBuf;
    s.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.4);
    g.gain.setValueAtTime(peak, at + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, at + dur + 1);
    s.connect(g).connect(v.out);
    s.start(at, this.rnd() * 4);
    s.stop(at + dur + 1.2);
    v.srcs.push(s);
  }

  /** Coro vocal con formantes: muchas voces desafinadas cantando una vocal. */
  private voices(at: number, vowel: keyof typeof VOWELS, dur: number, peak: number, pitchBase = 150, glide = 0.92, count = 9) {
    const ctx = this.c.ctx;
    const v = this.c.voice({ bus: 'publico', dur: dur + 0.8, prio: 4, reverb: 0.45 });
    if (!v) return;
    const [f1, f2] = VOWELS[vowel];
    const ff1 = this.c.filter('bandpass', f1, 5);
    const ff2 = this.c.filter('bandpass', f2, 7);
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + Math.min(0.35, dur * 0.4));
    env.gain.setTargetAtTime(0, at + dur * 0.55, dur * 0.25);
    const sum = ctx.createGain();
    sum.gain.value = 1 / Math.sqrt(count);
    sum.connect(ff1).connect(env);
    sum.connect(ff2).connect(g2).connect(env);
    env.connect(v.out);
    for (let i = 0; i < count; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const p = pitchBase * (0.75 + this.rnd() * 0.7);
      o.frequency.setValueAtTime(p, at);
      o.frequency.exponentialRampToValueAtTime(p * glide, at + dur);
      o.detune.value = (this.rnd() - 0.5) * 40;
      o.connect(sum);
      o.start(at + this.rnd() * 0.06);
      o.stop(at + dur + 0.6);
      v.srcs.push(o);
    }
    // Aire de las voces
    const n = this.c.noise('pink');
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(ng).connect(sum);
    n.start(at, this.rnd());
    n.stop(at + dur + 0.6);
    v.srcs.push(n);
  }

  private whistles(at: number, count: number) {
    const ctx = this.c.ctx;
    const v = this.c.voice({ bus: 'publico', dur: 3, prio: 2, reverb: 0.4, gain: 0.5 });
    if (!v) return;
    for (let i = 0; i < count; i++) {
      const t = at + this.rnd() * 1.6;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = 1900 + this.rnd() * 1300;
      o.frequency.setValueAtTime(f * 0.85, t);
      o.frequency.linearRampToValueAtTime(f * 1.12, t + 0.18);
      o.frequency.linearRampToValueAtTime(f * 0.9, t + 0.55);
      const g = ctx.createGain();
      this.c.env(g.gain, t, 0.045, 0.04, 0.6);
      o.connect(g).connect(v.out);
      o.start(t);
      o.stop(t + 0.8);
      v.srcs.push(o);
    }
  }

  private clap(v: NonNullable<ReturnType<AudioCore['voice']>>, at: number, peak: number) {
    const ctx = this.c.ctx;
    const s = this.c.noise('white');
    const f = this.c.filter('bandpass', 1400, 0.9);
    const g = ctx.createGain();
    this.c.env(g.gain, at, peak, 0.003, 0.09);
    s.connect(f).connect(g).connect(v.out);
    s.start(at, this.rnd() * 2);
    s.stop(at + 0.15);
    v.srcs.push(s);
  }

  /** Cántico: palmas "1, 2, 1-2-3" y un "¡oh!" coral en cada frase. */
  chant(loud = 1) {
    const t0 = this.c.now() + 0.05;
    const beat = 60 / 128;
    const v = this.c.voice({ bus: 'publico', dur: beat * 16 + 1, prio: 3, reverb: 0.5, gain: 0.9 * loud });
    if (!v) return;
    for (let bar = 0; bar < 4; bar++) {
      const b = t0 + bar * beat * 4;
      for (const x of [0, 1, 2, 2.5, 3]) {
        // Muchas palmas casi juntas = palmas de multitud
        for (let k = 0; k < 6; k++) this.clap(v, b + x * beat + (this.rnd() - 0.5) * 0.03, 0.09);
      }
      this.voices(b + beat * 0.02, bar % 2 ? 'a' : 'o', beat * 1.5, 0.11 * loud, 165, 0.98, 8);
    }
  }

  goal(forLocalTeam: boolean) {
    const t = this.c.now();
    this.excite = 1;
    this.missArmed = 0;
    // Explosión inicial del público
    this.roar.gain.cancelScheduledValues(t);
    this.roar.gain.setTargetAtTime(1.1, t, 0.06);
    this.roarFilter.frequency.setTargetAtTime(2600, t, 0.1);
    this.voices(t + 0.05, 'a', 3.2, 0.34, 175, 1.05, 14);
    this.whistles(t + 0.4, 14);
    this.applause(t + 1.2, 6, 0.32);
    this.pendingChant = forLocalTeam ? 6 : 8;
  }

  ooh() {
    if (this.oohCooldown > 0) return;
    this.oohCooldown = 4;
    const t = this.c.now();
    this.voices(t, 'u', 1.8, 0.13, 150, 0.82, 10);
    this.roar.gain.setTargetAtTime(0.25, t, 0.1);
  }

  save() {
    const t = this.c.now();
    this.voices(t, 'a', 1.2, 0.13, 160, 0.95, 9);
    this.applause(t + 0.3, 2.5, 0.22);
    this.missArmed = 0;
  }

  cheer(amount = 0.5) {
    const t = this.c.now();
    this.voices(t, 'e', 1.0, 0.1 * amount + 0.04, 170, 1.02, 8);
    this.excite = Math.max(this.excite, 0.35 * amount);
  }

  finalApplause() {
    const t = this.c.now();
    this.applause(t + 0.2, 7, 0.34);
    this.voices(t + 0.1, 'o', 2.5, 0.15, 150, 0.95, 10);
    this.whistles(t + 0.5, 10);
  }

  /** Avisos: tiro al arco (anticipación) y gol (cancela el "uuuh"). */
  shot() { this.tension = Math.max(this.tension, 0.6); }
  noteGoal() { this.missArmed = 0; }

  update(dt: number, ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number; hidden: boolean } | null, playing: boolean) {
    const t = this.c.now();
    if (this.oohCooldown > 0) this.oohCooldown -= dt;
    let target = 0;
    if (ball && !ball.hidden && playing) {
      const side = Math.sign(ball.y) || 1;
      const toGoal = ARENA.Y - Math.abs(ball.y);
      const toward = Math.sign(ball.vy) === side ? Math.abs(ball.vy) : 0;
      if (toGoal < 3200) target = clamp01((3200 - toGoal) / 3200) * clamp01(0.25 + toward / 1800);
      // ¿Casi gol? se arma al acercarse rápido al arco, y si se aleja sin entrar → "uuuh"
      if (toGoal < 1100 && toward > 700 && Math.abs(ball.x) < 1700 && ball.z < 1000) { this.missArmed = 1.6; this.missSide = side; }
      if (this.missArmed > 0) {
        this.missArmed -= dt;
        const away = Math.sign(ball.vy) !== this.missSide && Math.abs(ball.vy) > 250;
        if (away && Math.abs(ball.y) > ARENA.Y - 1600) { this.missArmed = 0; this.ooh(); }
        else if (this.missArmed <= 0 && Math.abs(ball.y) < ARENA.Y - 1800) this.missArmed = 0;
      }
    }
    this.tension += (target - this.tension) * Math.min(1, dt * (target > this.tension ? 3 : 0.8));
    this.excite = Math.max(0, this.excite - dt * 0.12);
    const roarLevel = 0.02 + this.tension * 0.28 + this.excite * 0.75;
    if (this.excite < 0.98) this.roar.gain.setTargetAtTime(roarLevel, t, 0.25);
    this.roarFilter.frequency.setTargetAtTime(900 + 1600 * Math.max(this.tension, this.excite), t, 0.3);
    this.babble.gain.setTargetAtTime(0.13 + this.tension * 0.1 + this.excite * 0.15, t, 0.4);

    // Cánticos ocasionales y después de los goles
    if (playing) {
      if (this.pendingChant > 0) {
        this.pendingChant -= dt;
        if (this.pendingChant <= 0) { this.pendingChant = -1; this.chant(1.2); this.chantTimer = 30 + this.rnd() * 20; }
      } else {
        this.chantTimer -= dt;
        if (this.chantTimer <= 0 && this.tension < 0.2) { this.chant(0.8); this.chantTimer = 28 + this.rnd() * 25; }
      }
    }
    void this.level;
  }
}
