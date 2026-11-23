// Música de menú propia: secuenciador WebAudio (122 BPM, La menor) con bombo, palmas, hi-hats, bajo con
// "sidechain", colchón de acordes y arpegio con delay. Arreglo de 32 compases: intro, tema y break.
// La programación se hace desde update() (por cuadro) con anticipación, así que no depende de timers.

import type { AudioCore } from './core.ts';

const BPM = 122;
const STEP = 60 / BPM / 4; // semicorchea
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Progresión (un compás por acorde): Am F C G Am F Dm E
const BASS = [45, 41, 48, 43, 45, 41, 38, 40];
const CHORDS = [
  [57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62],
  [57, 60, 64], [53, 57, 60], [53, 57, 62], [56, 59, 64],
];

export class MenuMusic {
  private c: AudioCore;
  private out: GainNode;
  private duck: GainNode;
  private delayIn: GainNode;
  private nextTime = 0;
  private step = 0;
  private playing = false;
  private stopAt = -1;

  constructor(c: AudioCore) {
    this.c = c;
    const ctx = c.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(c.buses.musica);
    this.duck = ctx.createGain();
    this.duck.connect(this.out);
    // Delay de 3/16 con realimentación filtrada (para el arpegio)
    this.delayIn = ctx.createGain();
    const d = ctx.createDelay(2);
    d.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = c.filter('lowpass', 2600, 0.7);
    this.delayIn.connect(d);
    d.connect(lp).connect(fb).connect(d);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    lp.connect(wet).connect(this.out);
    const rev = ctx.createGain();
    rev.gain.value = 0.18;
    this.out.connect(rev).connect(c.reverbSend);
  }

  get isPlaying() { return this.playing; }

  start() {
    if (this.playing) return;
    const t = this.c.now();
    this.playing = true;
    this.stopAt = -1;
    this.nextTime = t + 0.1;
    this.step = 0;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.55, t + 1.5);
  }

  stop() {
    if (!this.playing || this.stopAt > 0) return;
    const t = this.c.now();
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 1.4);
    this.stopAt = t + 1.5;
  }

  update() {
    if (!this.playing) return;
    const now = this.c.now();
    if (this.stopAt > 0 && now >= this.stopAt) { this.playing = false; return; }
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05; // la pestaña estuvo oculta
    while (this.nextTime < now + 0.25) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (32 * 16);
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = bar % 8;
    const intro = bar < 8;
    const brk = bar >= 24;
    const full = !intro && !brk;

    if ((full || (intro && bar >= 4)) && s % 4 === 0) this.kick(t, intro ? 0.6 : 1);
    if (full && (s === 4 || s === 12)) this.clap(t);
    if (s % 4 === 2) this.hat(t, 0.06, true);
    else if (!intro && s % 2 === 1) this.hat(t, 0.025, false);
    if (!brk && s % 2 === 0) this.bass(t, BASS[chord] + (s % 4 === 2 ? 12 : 0), intro ? 0.5 : 1);
    if (s === 0) this.pad(t, CHORDS[chord], STEP * 16);
    if (!intro) {
      const notes = CHORDS[chord];
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      const n = notes[pattern[s % 8]] + 12 + (s >= 8 ? 12 : 0);
      this.arp(t, n, brk ? 0.7 : 1, bar);
    }
  }

  private kick(t: number, amp: number) {
    const ctx = this.c.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    const g = ctx.createGain();
    this.c.env(g.gain, t, 0.55 * amp, 0.002, 0.32);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.45);
    // Sidechain: el resto respira con el bombo
    this.duck.gain.setValueAtTime(0.35, t);
    this.duck.gain.setTargetAtTime(1, t + 0.02, 0.09);
  }

  private clap(t: number) {
    const ctx = this.c.ctx;
    const s = this.c.noise('white');
    const f = this.c.filter('bandpass', 1700, 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      g.gain.linearRampToValueAtTime(0.3, t + i * 0.011 + 0.002);
      g.gain.linearRampToValueAtTime(0.05, t + i * 0.011 + 0.009);
    }
    g.gain.setTargetAtTime(0, t + 0.035, 0.05);
    s.connect(f).connect(g).connect(this.duck);
    s.start(t, this.c.rnd());
    s.stop(t + 0.3);
  }

  private hat(t: number, amp: number, open: boolean) {
    const ctx = this.c.ctx;
    const s = this.c.noise('white');
    const f = this.c.filter('highpass', open ? 7000 : 9000, 0.8);
    const g = ctx.createGain();
    this.c.env(g.gain, t, amp, 0.001, open ? 0.12 : 0.035);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, this.c.rnd());
    s.stop(t + 0.2);
  }

  private bass(t: number, note: number, amp: number) {
    const ctx = this.c.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(note);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midi(note);
    const f = this.c.filter('lowpass', 300, 4);
    f.frequency.setValueAtTime(1100, t);
    f.frequency.setTargetAtTime(260, t, 0.05);
    const g = ctx.createGain();
    this.c.env(g.gain, t, 0.16 * amp, 0.004, STEP * 1.8);
    const sg = ctx.createGain();
    sg.gain.value = 0.9;
    o.connect(f).connect(g).connect(this.duck);
    sub.connect(sg).connect(g);
    o.start(t); sub.start(t);
    o.stop(t + STEP * 2.5); sub.stop(t + STEP * 2.5);
  }

  private pad(t: number, notes: number[], dur: number) {
    const ctx = this.c.ctx;
    const f = this.c.filter('lowpass', 1100, 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.5);
    g.gain.setValueAtTime(0.06, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    f.connect(g).connect(this.duck);
    for (const n of notes) {
      for (const det of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    }
  }

  private arp(t: number, note: number, amp: number, bar: number) {
    const ctx = this.c.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midi(note);
    const f = this.c.filter('lowpass', 900 + (bar % 8) * 260, 2);
    const g = ctx.createGain();
    this.c.env(g.gain, t, 0.035 * amp, 0.002, STEP * 0.9);
    o.connect(f).connect(g);
    g.connect(this.duck);
    g.connect(this.delayIn);
    o.start(t);
    o.stop(t + STEP * 1.5);
  }
}
