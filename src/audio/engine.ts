// Motor del auto: capas (ralentí, medio, alto) con RPM simulada, cambios de marcha y carga según acelerador;
// turbo (ataque/cuerpo/cola), viento supersónico y derrape. Voces 3D simplificadas para los otros autos.

import { type AudioCore, clamp01, type Vec3Like } from './core.ts';
import { blowOff, boostAttack, supersonicWhoosh } from './sfx.ts';

// Cambios: velocidad (uu/s) donde termina cada marcha
const GEAR_TOP = [420, 820, 1240, 1700, 2300];
const IDLE_RPM = 950, MAX_RPM = 7200, SHIFT_LOW = 3900;

/** Onda periódica con armónicos de motor de 4 cilindros (fundamental fuerte, pares marcados, caída rápida). */
function engineWave(ctx: BaseAudioContext, bright: number) {
  const n = 32;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let h = 1; h < n; h++) {
    const even = h % 2 === 0 ? 1.35 : 1;
    im[h] = (even / Math.pow(h, 1.25 - bright * 0.35)) * (h === 1 ? 1.2 : 1);
    re[h] = (h % 3 === 0 ? 0.25 : 0) / h;
  }
  return ctx.createPeriodicWave(re, im, { disableNormalization: false });
}

export interface CarAudioState {
  speed: number;
  throttle: number;
  boosting: boolean;
  supersonic: boolean;
  onGround: boolean;
  slip: number; // 0..1 derrape / patinada lateral
}

interface Layer { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; mult: number }

export class LocalEngine {
  private c: AudioCore;
  private out: GainNode;
  private layers: Layer[] = [];
  private rough: GainNode;
  private shaper: WaveShaperNode;
  private boostGain: GainNode;
  private boostBand: BiquadFilterNode;
  private boostRumble: GainNode;
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private skidGain: GainNode;
  private skidBand: BiquadFilterNode;
  private scrubGain: GainNode;
  private rpm = IDLE_RPM;
  private gear = 0;
  private shiftDip = 0;
  private wasBoosting = false;
  private wasSuper = false;
  private active = false;

  constructor(c: AudioCore) {
    this.c = c;
    const ctx = c.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(c.buses.motor);

    // Aspereza: modulación de amplitud con ruido grave (combustión irregular)
    this.rough = ctx.createGain();
    this.rough.gain.value = 1;
    const roughSrc = c.noise('brown', true);
    const roughLp = c.filter('lowpass', 55, 0.7);
    const roughDepth = ctx.createGain();
    roughDepth.gain.value = 0.22;
    roughSrc.connect(roughLp).connect(roughDepth).connect(this.rough.gain);
    roughSrc.start();
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = c.softClipCurve(1.6);
    this.shaper.oversample = '2x';
    this.rough.connect(this.shaper).connect(this.out);

    // Capas: ralentí (grave, filtrado), medio (cuerpo), alto (silbido de admisión)
    const defs: [number, BiquadFilterType, number, number, number][] = [
      // mult, filtro, frecuencia, Q, brillo
      [1, 'lowpass', 380, 0.8, 0.1],
      [1, 'bandpass', 900, 0.9, 0.5],
      [2, 'bandpass', 2200, 1.4, 0.9],
    ];
    for (const [mult, ft, f, q, bright] of defs) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(engineWave(ctx, bright));
      const osc2 = ctx.createOscillator();
      osc2.setPeriodicWave(engineWave(ctx, bright));
      osc2.detune.value = 9;
      const filter = c.filter(ft, f, q);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const mix = ctx.createGain();
      mix.gain.value = 0.5;
      osc.connect(mix);
      osc2.connect(mix);
      mix.connect(filter).connect(gain).connect(this.rough);
      osc.start();
      osc2.start();
      this.layers.push({ osc, osc2, filter, gain, mult });
    }

    // Turbo: cuerpo de ruido de banda media + retumbe grave + aleteo
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    this.boostGain.connect(c.buses.motor);
    const bSrc = c.noise('white', true);
    this.boostBand = c.filter('bandpass', 1150, 0.85);
    const flutter = ctx.createGain();
    flutter.gain.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 17;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.2;
    lfo.connect(lfoG).connect(flutter.gain);
    lfo.start();
    bSrc.connect(this.boostBand).connect(flutter).connect(this.boostGain);
    bSrc.start();
    this.boostRumble = ctx.createGain();
    this.boostRumble.gain.value = 0;
    const rSrc = c.noise('brown', true);
    const rLp = c.filter('lowpass', 160, 0.9);
    rSrc.connect(rLp).connect(this.boostRumble).connect(c.buses.motor);
    rSrc.start();

    // Viento supersónico
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(c.buses.motor);
    const wSrc = c.noise('pink', true);
    this.windFilter = c.filter('highpass', 1400, 0.6);
    const wRes = c.filter('peaking', 3200, 1.5, 5);
    wSrc.connect(this.windFilter).connect(wRes).connect(this.windGain);
    wSrc.start();

    // Derrape: chirrido (banda estrecha que tiembla) + roce grave
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidGain.connect(c.buses.efectos);
    const sSrc = c.noise('white', true);
    this.skidBand = c.filter('bandpass', 2300, 7);
    sSrc.connect(this.skidBand).connect(this.skidGain);
    sSrc.start();
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    this.scrubGain.connect(c.buses.efectos);
    const scSrc = c.noise('pink', true);
    const scLp = c.filter('lowpass', 650, 0.7);
    scSrc.connect(scLp).connect(this.scrubGain);
    scSrc.start();
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    const t = this.c.now();
    this.out.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.15 : 0.08);
    if (!on) {
      for (const g of [this.boostGain, this.boostRumble, this.windGain, this.skidGain, this.scrubGain]) g.gain.setTargetAtTime(0, t, 0.06);
    }
  }

  get currentRpm() { return this.rpm; }
  get currentGear() { return this.gear + 1; }

  update(dt: number, s: CarAudioState) {
    if (!this.active) return;
    const c = this.c;
    const t = c.now();
    const speed = Math.max(0, s.speed);
    const load = s.boosting ? 1 : clamp01(Math.abs(s.throttle));

    // Marcha según velocidad (con histéresis)
    let g = this.gear;
    while (g < GEAR_TOP.length - 1 && speed > GEAR_TOP[g] + 20) g++;
    while (g > 0 && speed < GEAR_TOP[g - 1] - 60) g--;
    if (g > this.gear && load > 0.5) {
      this.shiftDip = 0.09;
      if (s.boosting || speed > 1100) blowOff(c);
    }
    this.gear = g;

    // RPM objetivo
    let target: number;
    if (s.onGround) {
      const lo = g === 0 ? 0 : GEAR_TOP[g - 1];
      const frac = clamp01((speed - lo) / (GEAR_TOP[g] - lo));
      const base = g === 0 ? IDLE_RPM + 1400 * clamp01(speed / 120) : SHIFT_LOW;
      target = base + frac * (MAX_RPM - base);
      if (load < 0.1) target = Math.max(IDLE_RPM, target * 0.82);
      if (speed < 30 && load < 0.1) target = IDLE_RPM;
    } else {
      // En el aire las ruedas giran libres: el motor se revoluciona o cae
      target = load > 0.1 ? 5200 + 1600 * load : 2600;
    }
    const rate = target > this.rpm ? 9 : 5;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
    if (this.shiftDip > 0) {
      this.shiftDip -= dt;
      this.rpm -= (this.rpm - SHIFT_LOW) * Math.min(1, dt * 30);
    }

    // Frecuencia de encendido (4 cilindros: 2 explosiones por vuelta)
    const f0 = (this.rpm / 60) * 2;
    const r = clamp01((this.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM));
    const wLow = clamp01(1 - r * 1.6);
    const wMid = clamp01(1 - Math.abs(r - 0.45) * 2.2);
    const wHigh = clamp01((r - 0.35) / 0.55);
    const dip = this.shiftDip > 0 ? 0.55 : 1;
    const gain = (0.06 + 0.07 * load + 0.03 * r) * dip * (s.onGround ? 1 : 0.8);
    const weights = [wLow, wMid, wHigh];
    this.layers.forEach((l, i) => {
      l.osc.frequency.setTargetAtTime(f0 * l.mult, t, 0.025);
      l.osc2.frequency.setTargetAtTime(f0 * l.mult, t, 0.025);
      const bright = i === 0 ? 260 + 900 * load + 600 * r : i === 1 ? 600 + 1400 * r + 500 * load : 1500 + 2600 * r;
      l.filter.frequency.setTargetAtTime(bright, t, 0.05);
      l.gain.gain.setTargetAtTime(weights[i] * gain * (i === 2 ? 0.5 : 1), t, 0.04);
    });

    // Turbo
    if (s.boosting && !this.wasBoosting) {
      boostAttack(c);
      this.boostGain.gain.setTargetAtTime(0.24, t, 0.03);
      this.boostRumble.gain.setTargetAtTime(0.3, t, 0.05);
      this.boostBand.frequency.setTargetAtTime(1250, t, 0.05);
    } else if (!s.boosting && this.wasBoosting) {
      // Cola: se apaga barriendo hacia abajo
      this.boostGain.gain.setTargetAtTime(0, t, 0.09);
      this.boostRumble.gain.setTargetAtTime(0, t, 0.12);
      this.boostBand.frequency.setTargetAtTime(520, t, 0.1);
    }
    if (s.boosting) this.boostBand.frequency.setTargetAtTime(1050 + 500 * clamp01(speed / 2300), t, 0.2);
    this.wasBoosting = s.boosting;

    // Viento (sube con la velocidad; fuerte en supersónico)
    const wk = clamp01((speed - 1500) / 800);
    this.windGain.gain.setTargetAtTime(wk * wk * 0.14 + (s.supersonic ? 0.06 : 0), t, 0.15);
    this.windFilter.frequency.setTargetAtTime(1200 + 1800 * wk, t, 0.2);
    if (s.supersonic && !this.wasSuper) supersonicWhoosh(c);
    this.wasSuper = s.supersonic;

    // Derrape
    const slip = s.onGround ? clamp01(s.slip) * clamp01(speed / 700) : 0;
    this.skidGain.gain.setTargetAtTime(slip * 0.11, t, 0.05);
    this.scrubGain.gain.setTargetAtTime(slip * 0.18, t, 0.05);
    this.skidBand.frequency.setTargetAtTime(1900 + 900 * c.rnd() + 400 * slip, t, 0.03);
  }
}

/** Voces de motor 3D (simplificadas) para los autos rivales/compañeros más cercanos. */
export class RemoteEngines {
  private c: AudioCore;
  private voices: { id: number; panner: PannerNode; osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; boost: GainNode; rpm: number }[] = [];
  private enabled = true;

  constructor(c: AudioCore, count = 3) {
    this.c = c;
    const ctx = c.ctx;
    for (let i = 0; i < count; i++) {
      const panner = c.panner({ x: 0, y: 0, z: -5000 });
      panner.connect(c.buses.motor);
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(engineWave(ctx, 0.5));
      const filter = c.filter('lowpass', 900, 0.8);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(panner);
      osc.start();
      const boost = ctx.createGain();
      boost.gain.value = 0;
      const bs = c.noise('white', true);
      const bf = c.filter('bandpass', 1200, 0.9);
      bs.connect(bf).connect(boost).connect(panner);
      bs.start();
      this.voices.push({ id: -1, panner, osc, filter, gain, boost, rpm: IDLE_RPM });
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      const t = this.c.now();
      for (const v of this.voices) { v.gain.gain.setTargetAtTime(0, t, 0.05); v.boost.gain.setTargetAtTime(0, t, 0.05); v.id = -1; }
    }
  }

  update(dt: number, cars: { id: number; pos: Vec3Like; speed: number; throttle: number; boosting: boolean; onGround: boolean }[], listener: Vec3Like) {
    if (!this.enabled) return;
    const t = this.c.now();
    const near = [...cars]
      .map((car) => ({ car, d: Math.hypot(car.pos.x - listener.x, car.pos.y - listener.y, car.pos.z - listener.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.voices.length);
    const wanted = new Set(near.map((n) => n.car.id));
    // Liberar voces de autos que ya no están entre los más cercanos
    for (const v of this.voices) {
      if (v.id >= 0 && !wanted.has(v.id)) {
        v.id = -1;
        v.gain.gain.setTargetAtTime(0, t, 0.08);
        v.boost.gain.setTargetAtTime(0, t, 0.08);
      }
    }
    for (const { car } of near) {
      let v = this.voices.find((x) => x.id === car.id);
      if (!v) {
        v = this.voices.find((x) => x.id < 0);
        if (!v) continue;
        v.id = car.id;
        this.c.setPannerPos(v.panner, car.pos);
      }
      this.c.setPannerPos(v.panner, car.pos, 0.03);
      const load = car.boosting ? 1 : clamp01(Math.abs(car.throttle));
      const target = car.onGround ? 1800 + 4800 * clamp01(car.speed / 2300) : 4800;
      v.rpm += (target - v.rpm) * Math.min(1, dt * 6);
      v.osc.frequency.setTargetAtTime((v.rpm / 60) * 2, t, 0.04);
      v.filter.frequency.setTargetAtTime(500 + 1500 * load, t, 0.06);
      v.gain.gain.setTargetAtTime(0.05 + 0.06 * load, t, 0.06);
      v.boost.gain.setTargetAtTime(car.boosting ? 0.12 : 0, t, car.boosting ? 0.03 : 0.1);
    }
  }
}
