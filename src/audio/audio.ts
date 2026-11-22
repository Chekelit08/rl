// Audio sintetizado con WebAudio (sin assets con licencia): motor, turbo, golpes, pads, gol, cuenta regresiva.

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private boostGain!: GainNode;
  private windGain!: GainNode;
  private crowdGain!: GainNode;
  volume = 0.7;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Motor: dos osciladores desafinados + filtro
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    // Turbo y viento: ruido filtrado en loop
    this.boostGain = this.loopNoise('bandpass', 1400, 0.7);
    this.windGain = this.loopNoise('highpass', 2500, 0.5);
    this.crowdGain = this.loopNoise('bandpass', 700, 0.4);
    this.crowdGain.gain.value = 0.05;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  /** Actualiza los sonidos continuos del auto del jugador. */
  updateCar(speed: number, boosting: boolean, supersonic: boolean, onGround: boolean, active: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, speed / 2300);
    const base = 45 + k * 120 + (onGround ? 0 : 20);
    this.engineOsc.frequency.setTargetAtTime(base, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(base * 1.505, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(300 + k * 1600, t, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.035 + k * 0.05 : 0, t, 0.1);
    this.boostGain.gain.setTargetAtTime(active && boosting ? 0.22 : 0, t, 0.04);
    this.windGain.gain.setTargetAtTime(active && supersonic ? 0.12 : 0, t, 0.15);
  }

  setCrowd(level: number) {
    if (!this.ctx) return;
    this.crowdGain.gain.setTargetAtTime(0.04 + level * 0.25, this.ctx.currentTime, 0.4);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass', delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  hit(strength: number, near: boolean) {
    const v = Math.min(1, strength / 3500) * (near ? 1 : 0.5);
    this.tone(90 + v * 40, 0.18, 'sine', 0.5 * v + 0.05, 45);
    this.burst(0.12, 2000 + v * 3000, 0.4 * v + 0.05);
  }
  bounce(strength: number) {
    const v = Math.min(1, strength / 3000);
    this.tone(70, 0.15, 'sine', 0.25 * v + 0.02, 40);
  }
  pad(big: boolean) {
    this.tone(big ? 660 : 880, 0.12, 'triangle', 0.12, big ? 1320 : 1200);
    if (big) this.tone(990, 0.15, 'triangle', 0.1, 1980, 0.06);
  }
  jump() { this.burst(0.12, 900, 0.08, 'bandpass'); }
  countdown(final: boolean) { this.tone(final ? 1046 : 523, final ? 0.5 : 0.2, 'square', 0.12); }
  goal() {
    this.burst(1.2, 600, 0.9);
    this.tone(60, 0.8, 'sine', 0.8, 30);
    for (const [f, d] of [[220, 0], [277, 0], [330, 0], [440, 0.25]] as const) this.tone(f, 1.6, 'sawtooth', 0.09, undefined, 0.15 + d);
    this.setCrowd(1);
    setTimeout(() => this.setCrowd(0), 3500);
  }
  demo() { this.burst(0.7, 500, 0.7); this.tone(80, 0.5, 'sine', 0.5, 35); }
  bump() { this.burst(0.15, 1200, 0.25); }
  whistle() { this.tone(1800, 0.25, 'sine', 0.15, 1700); this.tone(1800, 0.5, 'sine', 0.15, 1750, 0.3); }
  click() { this.tone(1200, 0.05, 'square', 0.05); }
}
