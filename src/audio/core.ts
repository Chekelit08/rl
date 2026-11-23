// Núcleo de audio: buses de mezcla, limitador, reverb de estadio, cadena de megafonía,
// gestor de voces (límite de simultáneas con robo por prioridad), buffers de ruido y utilidades.
// Funciona con AudioContext (juego) y con OfflineAudioContext (pruebas).

export type Bus = 'motor' | 'efectos' | 'publico' | 'musica' | 'ui';
export const BUSES: Bus[] = ['motor', 'efectos', 'publico', 'musica', 'ui'];

export interface Vec3Like { x: number; y: number; z: number }

interface Voice { end: number; prio: number; stop: () => void }

/** Generador pseudoaleatorio rápido (determinista por instancia) para síntesis. */
export function rand01(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export class AudioCore {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly buses: Record<Bus, GainNode>;
  /** Envío a la reverb de estadio. */
  readonly reverbSend: GainNode;
  /** Entrada a la cadena de megafonía (banda telefónica + saturación + eco + reverb). */
  readonly paIn: GainNode;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  clockOverride: number | null = null;
  maxVoices = 28;
  private voices: Voice[] = [];
  private lastPlay = new Map<string, number>();
  readonly rnd = rand01(0x9e3779b9);

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.22;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.limiter).connect(ctx.destination);

    this.buses = {} as Record<Bus, GainNode>;
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }

    const sr = ctx.sampleRate;
    this.white = this.makeNoise('white', sr * 3);
    this.pink = this.makeNoise('pink', sr * 3);
    this.brown = this.makeNoise('brown', sr * 3);

    // Reverb de estadio (impulso sintético: cola larga y oscura con reflexiones tempranas)
    const conv = ctx.createConvolver();
    conv.buffer = this.stadiumImpulse(2.8);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(conv).connect(revOut).connect(this.master);

    // Megafonía: parlantes del estadio
    this.paIn = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 380; hp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3600; lp.Q.value = 1.1;
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking'; pk.frequency.value = 1800; pk.gain.value = 6; pk.Q.value = 1.2;
    const sat = ctx.createWaveShaper();
    sat.curve = this.softClipCurve(2.2);
    const paOut = ctx.createGain();
    paOut.gain.value = 0.8;
    const echo = ctx.createDelay(1.0);
    echo.delayTime.value = 0.29;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass'; echoLp.frequency.value = 2200;
    this.paIn.connect(hp).connect(lp).connect(pk).connect(sat).connect(paOut);
    paOut.connect(this.buses.efectos);
    paOut.connect(echo);
    echo.connect(echoLp).connect(fb).connect(echo);
    echoLp.connect(this.buses.efectos);
    const paRev = ctx.createGain();
    paRev.gain.value = 0.6;
    paOut.connect(paRev).connect(this.reverbSend);
  }

  now() { return this.clockOverride ?? this.ctx.currentTime; }

  /** Limita disparos repetidos del mismo sonido (en segundos). */
  rateLimit(key: string, minGap: number): boolean {
    const t = this.now();
    const last = this.lastPlay.get(key) ?? -1e9;
    if (t - last < minGap) return false;
    this.lastPlay.set(key, t);
    return true;
  }

  activeVoices() {
    const t = this.now();
    this.voices = this.voices.filter((v) => v.end > t);
    return this.voices.length;
  }

  /** Reserva una voz. Si está lleno, roba la de menor prioridad (o rechaza). */
  claim(prio: number, dur: number, stop: () => void): boolean {
    const t = this.now();
    this.voices = this.voices.filter((v) => v.end > t);
    if (this.voices.length >= this.maxVoices) {
      let worst = -1;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (v.prio < prio && (worst < 0 || v.prio < this.voices[worst].prio || (v.prio === this.voices[worst].prio && v.end < this.voices[worst].end))) worst = i;
      }
      if (worst < 0) return false;
      this.voices[worst].stop();
      this.voices.splice(worst, 1);
    }
    this.voices.push({ end: t + dur, prio, stop });
    return true;
  }

  /**
   * Crea la salida de una voz de un disparo: GainNode (envolvente maestra de la voz) conectada al bus,
   * con envío opcional a reverb y panner 3D opcional. Devuelve null si no hay voces libres.
   */
  voice(opts: { bus: Bus; dur: number; prio?: number; reverb?: number; pos?: Vec3Like | null; gain?: number }): { out: GainNode; t: number; srcs: AudioScheduledSourceNode[] } | null {
    const ctx = this.ctx;
    const t = this.now();
    const out = ctx.createGain();
    out.gain.value = opts.gain ?? 1;
    const srcs: AudioScheduledSourceNode[] = [];
    const ok = this.claim(opts.prio ?? 1, opts.dur, () => {
      const n = this.now();
      out.gain.cancelScheduledValues(n);
      out.gain.setTargetAtTime(0, n, 0.012);
      for (const s of srcs) { try { s.stop(n + 0.08); } catch { /* ya detenido */ } }
    });
    if (!ok) return null;
    let dest: AudioNode = this.buses[opts.bus];
    if (opts.pos) {
      const p = this.panner(opts.pos);
      p.connect(dest);
      dest = p;
    }
    out.connect(dest);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      out.connect(s).connect(this.reverbSend);
    }
    return { out, t, srcs };
  }

  panner(pos: Vec3Like): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 650;
    p.maxDistance = 30000;
    p.rolloffFactor = 1.15;
    p.coneOuterGain = 1;
    this.setPannerPos(p, pos);
    return p;
  }

  setPannerPos(p: PannerNode, pos: Vec3Like, smooth = 0) {
    const t = this.now();
    if (p.positionX) {
      if (smooth > 0) {
        p.positionX.setTargetAtTime(pos.x, t, smooth);
        p.positionY.setTargetAtTime(pos.y, t, smooth);
        p.positionZ.setTargetAtTime(pos.z, t, smooth);
      } else {
        p.positionX.setValueAtTime(pos.x, t);
        p.positionY.setValueAtTime(pos.y, t);
        p.positionZ.setValueAtTime(pos.z, t);
      }
    } else {
      (p as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos.x, pos.y, pos.z);
    }
  }

  setListener(pos: Vec3Like, fwd: Vec3Like, up: Vec3Like) {
    const l = this.ctx.listener;
    const t = this.now();
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      const ll = l as unknown as { setPosition: (...a: number[]) => void; setOrientation: (...a: number[]) => void };
      ll.setPosition(pos.x, pos.y, pos.z);
      ll.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Fuente de ruido (buffer) con desfase aleatorio. */
  noise(kind: 'white' | 'pink' | 'brown', loop = false): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = kind === 'white' ? this.white : kind === 'pink' ? this.pink : this.brown;
    s.loop = loop;
    if (loop) { s.loopStart = 0; s.loopEnd = s.buffer.duration; }
    return s;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707, gain = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (gain) f.gain.value = gain;
    return f;
  }

  /** Envolvente percusiva sin clicks: ataque lineal corto y caída exponencial. */
  env(p: AudioParam, t: number, peak: number, attack: number, decay: number) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + Math.max(0.002, attack));
    p.setTargetAtTime(0, t + attack, Math.max(0.005, decay / 4));
  }

  softClipCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const c = new Float32Array(new ArrayBuffer(n * 4));
    const k = Math.tanh(amount);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * amount) / k;
    }
    return c;
  }

  makeNoise(kind: 'white' | 'pink' | 'brown', len: number): AudioBuffer {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const r = rand01(kind === 'white' ? 11 : kind === 'pink' ? 23 : 37);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = r() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
    // Fundido en los extremos para loops sin click
    const fade = Math.min(512, len >> 3);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      d[i] *= g;
      d[len - 1 - i] *= g;
    }
    return buf;
  }

  /** Respuesta al impulso de un estadio abierto: reflexiones tempranas + cola difusa oscura. */
  stadiumImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const r = rand01(101 + ch * 7);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const decay = Math.exp(-t / 0.62);
        // Se oscurece con el tiempo (absorción del aire y del público)
        const a = 0.35 + 0.6 * Math.exp(-t / 0.35);
        lp = lp + a * ((r() * 2 - 1) - lp);
        d[i] = lp * decay * 0.55;
      }
      // Reflexiones tempranas (tribunas y techo)
      for (const [dt, g] of [[0.019, 0.5], [0.033, 0.35], [0.051, 0.32], [0.077, 0.25], [0.112, 0.2], [0.161, 0.15]] as const) {
        const i = Math.floor((dt + ch * 0.0031) * sr);
        if (i < len) d[i] += g * (ch ? -1 : 1);
      }
    }
    return buf;
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
