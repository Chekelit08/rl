// Efectos de un disparo (todos sintetizados): pelota, superficies, red, auto, demoliciones, pads, UI,
// megafonía (cuenta regresiva), bocina de gol y silbato.

import { ARENA } from '../sim/constants.ts';
import { type AudioCore, type Bus, clamp01, type Vec3Like } from './core.ts';

type VoiceH = NonNullable<ReturnType<AudioCore['voice']>>;

function tone(c: AudioCore, v: VoiceH, at: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.003, dest?: AudioNode) {
  const ctx = c.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  const g = ctx.createGain();
  c.env(g.gain, at, peak, attack, dur);
  o.connect(g).connect(dest ?? v.out);
  o.start(at);
  o.stop(at + dur * 1.6 + 0.05);
  v.srcs.push(o);
  return o;
}

function burst(c: AudioCore, v: VoiceH, at: number, kind: 'white' | 'pink' | 'brown', ftype: BiquadFilterType, freq: number, q: number, dur: number, peak: number, attack = 0.002, freqEnd?: number, dest?: AudioNode) {
  const ctx = c.ctx;
  const s = c.noise(kind);
  const f = c.filter(ftype, freq, q);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), at + dur);
  const g = ctx.createGain();
  c.env(g.gain, at, peak, attack, dur);
  s.connect(f).connect(g).connect(dest ?? v.out);
  const off = c.rnd() * Math.max(0, (s.buffer!.duration - dur - 0.1));
  s.start(at, off);
  s.stop(at + dur * 1.6 + 0.05);
  v.srcs.push(s);
}

/** Parciales inarmónicos que suenan a metal (poste, carrocería). */
function metal(c: AudioCore, v: VoiceH, at: number, partials: number[], dur: number, peak: number) {
  partials.forEach((f, i) => tone(c, v, at, 'sine', f, f * 0.995, dur * (1 - i * 0.12), peak / (1 + i * 0.6), 0.001));
}

export type Surface = 'piso' | 'tablero' | 'vidrio' | 'poste' | 'techo';

/** Clasifica la superficie de un rebote de la pelota según su posición. */
export function surfaceAt(p: Vec3Like): Surface {
  const ax = Math.abs(p.x), ay = Math.abs(p.y);
  // Marco del arco: postes (x≈±893) y travesaño (z≈642) en la línea de gol
  if (Math.abs(ay - ARENA.Y) < 190) {
    const nearPost = Math.abs(ax - ARENA.GOAL_HW) < 190 && p.z < ARENA.GOAL_H + 120;
    const nearBar = Math.abs(p.z - ARENA.GOAL_H) < 190 && ax < ARENA.GOAL_HW + 120;
    if (nearPost || nearBar) return 'poste';
  }
  if (p.z > ARENA.H - 260) return 'techo';
  if (p.z < 150) return 'piso';
  return p.z < 340 ? 'tablero' : 'vidrio';
}

export function ballHit(c: AudioCore, strength: number, pos: Vec3Like | null) {
  if (!c.rateLimit('hit', 0.03)) return;
  const k = clamp01(strength / 3600);
  const v = c.voice({ bus: 'efectos', dur: 0.9, prio: 4, reverb: 0.15 + 0.35 * k, pos });
  if (!v) return;
  const t = v.t;
  // Grave: el "pum" de la carrocería contra la pelota
  tone(c, v, t, 'sine', 95 + 45 * k, 42, 0.16 + 0.12 * k, 0.32 + 0.55 * k, 0.002);
  // Agudo: chasquido del contacto
  burst(c, v, t, 'white', 'bandpass', 2300 + 2600 * k, 1.1, 0.05 + 0.04 * k, 0.12 + 0.42 * k);
  // Cuerpo de la pelota (resonancia hueca)
  tone(c, v, t, 'sine', 610 + 80 * k, 560, 0.22, 0.06 + 0.12 * k, 0.001);
  tone(c, v, t, 'sine', 980 + 60 * k, 930, 0.14, 0.03 + 0.07 * k, 0.001);
  if (k > 0.55) {
    // Golpe potente: subgrave y "aire"
    tone(c, v, t, 'sine', 58, 34, 0.42, 0.45 * (k - 0.4), 0.004);
    burst(c, v, t + 0.005, 'pink', 'lowpass', 1800, 0.7, 0.25, 0.18 * k, 0.004, 400);
  }
}

export function bounce(c: AudioCore, surface: Surface, strength: number, pos: Vec3Like | null) {
  if (!c.rateLimit('bounce', 0.045)) return;
  const k = clamp01(strength / 2600);
  if (k < 0.04) return;
  const v = c.voice({ bus: 'efectos', dur: surface === 'poste' ? 1.6 : 0.8, prio: surface === 'poste' ? 5 : 2, reverb: 0.2 + 0.3 * k, pos });
  if (!v) return;
  const t = v.t;
  switch (surface) {
    case 'piso':
      tone(c, v, t, 'sine', 78 + 20 * k, 40, 0.18, 0.22 + 0.4 * k);
      burst(c, v, t, 'pink', 'lowpass', 700 + 500 * k, 0.7, 0.09, 0.1 + 0.25 * k);
      break;
    case 'tablero':
      tone(c, v, t, 'sine', 115, 70, 0.16, 0.25 + 0.4 * k);
      burst(c, v, t, 'pink', 'bandpass', 520, 1.2, 0.12, 0.15 + 0.3 * k);
      break;
    case 'vidrio':
      tone(c, v, t, 'sine', 140, 85, 0.14, 0.18 + 0.32 * k);
      burst(c, v, t, 'white', 'bandpass', 1500, 2.5, 0.08, 0.08 + 0.18 * k);
      // Vibración del panel
      [2170, 3340, 4710].forEach((f, i) => tone(c, v, t, 'sine', f, f * 0.99, 0.35 - i * 0.07, (0.04 + 0.07 * k) / (1 + i), 0.001));
      break;
    case 'poste':
      // ¡Palo! Sonido metálico largo
      metal(c, v, t, [520, 1310, 2390, 3720], 1.25, 0.18 + 0.32 * k);
      tone(c, v, t, 'sine', 160, 90, 0.2, 0.3 * k + 0.1);
      burst(c, v, t, 'white', 'highpass', 3500, 0.7, 0.05, 0.15 + 0.2 * k);
      break;
    case 'techo':
      tone(c, v, t, 'sine', 120, 70, 0.18, 0.15 + 0.3 * k);
      burst(c, v, t, 'pink', 'bandpass', 900, 1.5, 0.12, 0.08 + 0.2 * k);
      break;
  }
}

/** La pelota sacude la red al entrar al arco. */
export function net(c: AudioCore, pos: Vec3Like | null, speed: number) {
  const k = clamp01(speed / 3500);
  const v = c.voice({ bus: 'efectos', dur: 1.2, prio: 6, reverb: 0.25, pos });
  if (!v) return;
  const t = v.t;
  // Golpe sordo contra la red + roce de las cuerdas con trémolo
  tone(c, v, t, 'sine', 90, 50, 0.25, 0.3 + 0.3 * k);
  const ctx = c.ctx;
  const s = c.noise('white');
  const f = c.filter('bandpass', 2800, 0.9);
  const g = ctx.createGain();
  const trem = ctx.createGain();
  trem.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 23;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.5;
  lfo.connect(lfoG).connect(trem.gain);
  c.env(g.gain, t, 0.22 + 0.25 * k, 0.01, 0.65);
  s.connect(f).connect(trem).connect(g).connect(v.out);
  s.start(t, c.rnd());
  s.stop(t + 1.1);
  lfo.start(t);
  lfo.stop(t + 1.1);
  v.srcs.push(s, lfo);
}

export function landing(c: AudioCore, intensity: number, pos: Vec3Like | null, bus: Bus = 'efectos') {
  const k = clamp01(intensity);
  if (k < 0.08 || !c.rateLimit('land' + (pos ? 'r' : 'l'), 0.12)) return;
  const v = c.voice({ bus, dur: 0.5, prio: 2, pos, reverb: 0.08 });
  if (!v) return;
  const t = v.t;
  tone(c, v, t, 'sine', 70, 38, 0.2, 0.22 + 0.45 * k);
  burst(c, v, t, 'brown', 'lowpass', 500, 0.7, 0.16, 0.2 + 0.4 * k);
  // Suspensión
  if (k > 0.35) metal(c, v, t + 0.02, [310, 690], 0.18, 0.05 * k);
}

export function jump(c: AudioCore, pos: Vec3Like | null, dodge: boolean) {
  if (!c.rateLimit('jump' + (pos ? 'r' : 'l') + (dodge ? 'd' : ''), 0.06)) return;
  const v = c.voice({ bus: 'efectos', dur: 0.5, prio: 1, pos, gain: pos ? 0.6 : 1 });
  if (!v) return;
  const t = v.t;
  if (dodge) {
    // Flip: "fuuum" con barrido
    burst(c, v, t, 'pink', 'bandpass', 600, 1.4, 0.32, 0.22, 0.02, 2600);
    tone(c, v, t, 'triangle', 140, 70, 0.2, 0.06);
  } else {
    // Salto: empuje neumático + golpe de suspensión
    tone(c, v, t, 'sine', 120, 60, 0.12, 0.2);
    burst(c, v, t, 'white', 'bandpass', 1100, 1.0, 0.12, 0.12, 0.004, 1800);
  }
}

export function bump(c: AudioCore, strength: number, pos: Vec3Like | null) {
  if (!c.rateLimit('bump', 0.08)) return;
  const k = clamp01(strength / 2000);
  const v = c.voice({ bus: 'efectos', dur: 1.0, prio: 4, pos, reverb: 0.2 });
  if (!v) return;
  const t = v.t;
  tone(c, v, t, 'sine', 85, 45, 0.25, 0.4 + 0.3 * k);
  burst(c, v, t, 'white', 'bandpass', 1300, 0.8, 0.14, 0.25 + 0.25 * k);
  metal(c, v, t, [430, 1090, 1870, 2930], 0.55, 0.12 + 0.12 * k);
}

export function demolition(c: AudioCore, pos: Vec3Like | null) {
  const v = c.voice({ bus: 'efectos', dur: 2.2, prio: 7, pos, reverb: 0.55 });
  if (!v) return;
  const t = v.t;
  // Explosión: subgrave con caída, cuerpo de ruido que se oscurece y chispas
  tone(c, v, t, 'sine', 70, 28, 0.9, 0.85, 0.004);
  burst(c, v, t, 'brown', 'lowpass', 2400, 0.7, 1.1, 0.75, 0.003, 180);
  burst(c, v, t, 'white', 'highpass', 2500, 0.7, 0.18, 0.35);
  metal(c, v, t + 0.01, [380, 960, 1720], 0.7, 0.12);
  for (let i = 0; i < 9; i++) {
    const dt = 0.08 + c.rnd() * 0.7;
    burst(c, v, t + dt, 'white', 'bandpass', 2500 + c.rnd() * 3500, 3, 0.02, 0.05 + c.rnd() * 0.06, 0.001);
  }
}

export function pad(c: AudioCore, big: boolean) {
  if (!c.rateLimit('pad', 0.05)) return;
  const v = c.voice({ bus: 'efectos', dur: 0.5, prio: 2, gain: 0.8 });
  if (!v) return;
  const t = v.t;
  if (big) {
    tone(c, v, t, 'triangle', 520, 1040, 0.18, 0.11);
    tone(c, v, t + 0.06, 'triangle', 780, 1560, 0.2, 0.09);
    burst(c, v, t, 'white', 'highpass', 4000, 0.7, 0.18, 0.05, 0.03);
  } else {
    tone(c, v, t, 'triangle', 980, 1450, 0.09, 0.08);
  }
}

export function flipReset(c: AudioCore) {
  const v = c.voice({ bus: 'efectos', dur: 0.6, prio: 3 });
  if (!v) return;
  const t = v.t;
  [880, 1320, 1760].forEach((f, i) => tone(c, v, t + i * 0.045, 'sine', f, f, 0.22, 0.07));
}

export function boostAttack(c: AudioCore) {
  const v = c.voice({ bus: 'motor', dur: 0.4, prio: 2 });
  if (!v) return;
  const t = v.t;
  burst(c, v, t, 'white', 'highpass', 900, 0.7, 0.12, 0.22, 0.003, 2500);
  tone(c, v, t, 'sine', 90, 55, 0.14, 0.2);
}

export function supersonicWhoosh(c: AudioCore) {
  const v = c.voice({ bus: 'motor', dur: 0.9, prio: 2 });
  if (!v) return;
  burst(c, v, v.t, 'pink', 'bandpass', 900, 1.2, 0.7, 0.16, 0.08, 3800);
}

/** Válvula de alivio del turbo al cambiar de marcha a fondo. */
export function blowOff(c: AudioCore) {
  if (!c.rateLimit('bov', 0.4)) return;
  const v = c.voice({ bus: 'motor', dur: 0.4, prio: 1, gain: 0.7 });
  if (!v) return;
  burst(c, v, v.t, 'white', 'bandpass', 3200, 1.6, 0.22, 0.08, 0.004, 1400);
}

export function click(c: AudioCore) {
  const v = c.voice({ bus: 'ui', dur: 0.1, prio: 1 });
  if (!v) return;
  tone(c, v, v.t, 'square', 1250, 1150, 0.04, 0.04, 0.001);
}

/** Pitido de cuenta regresiva por los parlantes del estadio. */
export function paBeep(c: AudioCore, final: boolean) {
  const v = c.voice({ bus: 'efectos', dur: 1.4, prio: 6 });
  if (!v) return;
  v.out.disconnect();
  v.out.connect(c.paIn);
  const t = v.t;
  const f = final ? 1046 : 587;
  const d = final ? 0.55 : 0.2;
  tone(c, v, t, 'square', f, f, d, 0.16, 0.004);
  tone(c, v, t, 'sine', f * 2, f * 2, d, 0.06, 0.004);
}

/** Bocina de estadio (gol / fin): acorde grave tipo bronce con vibrato. */
export function horn(c: AudioCore, long = 1.9) {
  const v = c.voice({ bus: 'efectos', dur: long + 2, prio: 8, reverb: 0.7, gain: 0.85 });
  if (!v) return;
  const ctx = c.ctx;
  const t = v.t;
  const lp = c.filter('lowpass', 1400, 0.9);
  const sat = ctx.createWaveShaper();
  sat.curve = c.softClipCurve(2.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.32, t + 0.06);
  g.gain.setValueAtTime(0.3, t + long);
  g.gain.setTargetAtTime(0, t + long, 0.08);
  sat.connect(lp).connect(g).connect(v.out);
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.5;
  const vibG = ctx.createGain();
  vibG.gain.value = 1.6;
  vib.connect(vibG);
  for (const f of [110, 138.6, 164.8, 220]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.94, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.12);
    vibG.connect(o.frequency);
    const og = ctx.createGain();
    og.gain.value = 0.22;
    o.connect(og).connect(sat);
    o.start(t);
    o.stop(t + long + 0.6);
    v.srcs.push(o);
  }
  vib.start(t);
  vib.stop(t + long + 0.6);
  v.srcs.push(vib);
}

/** Silbato (trino de pito de árbitro). pattern: duraciones de cada pitada. */
export function whistle(c: AudioCore, pattern: number[] = [0.25, 0.25, 0.9]) {
  const total = pattern.reduce((a, b) => a + b + 0.12, 0);
  const v = c.voice({ bus: 'efectos', dur: total + 1, prio: 7, reverb: 0.4 });
  if (!v) return;
  const ctx = c.ctx;
  let t = v.t;
  for (const d of pattern) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2850;
    const fm = ctx.createOscillator();
    fm.frequency.value = 34; // la bolita del pito
    const fmG = ctx.createGain();
    fmG.gain.value = 140;
    fm.connect(fmG).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.015);
    g.gain.setValueAtTime(0.13, t + d);
    g.gain.linearRampToValueAtTime(0, t + d + 0.03);
    const air = c.noise('white');
    const af = c.filter('bandpass', 2900, 2);
    const ag = ctx.createGain();
    ag.gain.value = 0.25;
    air.connect(af).connect(ag).connect(g);
    o.connect(g).connect(v.out);
    o.start(t); fm.start(t); air.start(t, c.rnd());
    o.stop(t + d + 0.06); fm.stop(t + d + 0.06); air.stop(t + d + 0.06);
    v.srcs.push(o, fm, air);
    t += d + 0.12;
  }
}
