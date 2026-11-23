// Audio de TURBOGOL: todo sintetizado con WebAudio (sin assets con licencia).
// Fachada única para el juego: eventos de la simulación, estado por cuadro (motor, público, música,
// audio 3D con el oyente en la cámara), buses de mezcla y vibración del mando.

import * as THREE from 'three';
import type { GameEvent, Snapshot } from '../sim/world.ts';
import { AudioCore, type Bus, BUSES, clamp01, type Vec3Like } from './core.ts';
import { Crowd } from './crowd.ts';
import { LocalEngine, RemoteEngines } from './engine.ts';
import { Haptics } from './haptics.ts';
import { MenuMusic } from './music.ts';
import * as sfx from './sfx.ts';

export interface MixSettings {
  motor: number;
  efectos: number;
  publico: number;
  musica: number;
  ui: number;
  haptics: boolean;
}

export const DEFAULT_MIX: MixSettings = { motor: 0.8, efectos: 0.9, publico: 0.55, musica: 0.6, ui: 0.7, haptics: true };

export type AudioState = 'menu' | 'playing' | 'paused' | 'replay' | 'ended';

/** Cámara mínima (THREE.Camera) para ubicar el oyente. */
export interface ListenerCamera {
  position: Vec3Like;
  quaternion: THREE.Quaternion;
  getWorldDirection: (target: THREE.Vector3) => THREE.Vector3;
}

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _right = new THREE.Vector3();

export class AudioEngine {
  ctx: BaseAudioContext | null = null;
  core: AudioCore | null = null;
  haptics = new Haptics();
  volume = 0.7;
  mix: MixSettings = { ...DEFAULT_MIX };
  private engine: LocalEngine | null = null;
  private remotes: RemoteEngines | null = null;
  private crowd: Crowd | null = null;
  private music: MenuMusic | null = null;
  private state: AudioState | null = null;
  private stateTime = 0;
  private prevCars = new Map<number, { onGround: boolean; vz: number }>();
  private listener: Vec3Like = { x: 0, y: -3000, z: 300 };

  /** Inicia el audio (requiere un gesto del usuario). Para pruebas se puede pasar un OfflineAudioContext. */
  start(ctx?: BaseAudioContext) {
    if (this.core) {
      if (typeof AudioContext !== 'undefined' && this.ctx instanceof AudioContext && this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    let c = ctx;
    if (!c) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      c = new AC({ latencyHint: 'interactive' });
    }
    this.ctx = c;
    const core = new AudioCore(c);
    this.core = core;
    this.engine = new LocalEngine(core);
    this.remotes = new RemoteEngines(core, 3);
    this.crowd = new Crowd(core);
    this.music = new MenuMusic(core);
    this.setVolume(this.volume);
    this.setMix(this.mix);
  }

  get started() { return !!this.core; }

  setVolume(v: number) {
    this.volume = v;
    if (this.core) this.core.master.gain.setTargetAtTime(v, this.core.now(), 0.05);
  }

  setMix(m: Partial<MixSettings>) {
    Object.assign(this.mix, m);
    this.haptics.enabled = this.mix.haptics;
    if (!this.core) return;
    for (const b of BUSES) this.core.buses[b].gain.setTargetAtTime(this.mix[b as Bus] as number, this.core.now(), 0.05);
  }

  // ---------- Eventos de la simulación ----------
  onEvent(ev: GameEvent, snap: Snapshot, localId: number) {
    const c = this.core;
    if (!c || !this.crowd) return;
    const me = snap.cars.find((x) => x.id === localId);
    const carPos = (id: number): Vec3Like | null => {
      const car = snap.cars.find((x) => x.id === id);
      return car ? { x: car.x, y: car.y, z: car.z } : null;
    };
    const near = (p: Vec3Like | null, r: number) => !!p && Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z) < r;
    switch (ev.type) {
      case 'hit':
        sfx.ballHit(c, ev.strength, ev.pos);
        if (ev.carId === localId) this.haptics.ballHit(ev.strength);
        break;
      case 'bounce':
        sfx.bounce(c, sfx.surfaceAt(ev.pos), ev.strength, ev.pos);
        break;
      case 'pad':
        if (ev.carId === localId) { sfx.pad(c, ev.big); this.haptics.boostPad(ev.big); }
        break;
      case 'jump':
      case 'flip': {
        const dodge = ev.type === 'flip';
        if (ev.carId === localId) sfx.jump(c, null, dodge);
        else { const p = carPos(ev.carId); if (near(p, 2500)) sfx.jump(c, p, dodge); }
        break;
      }
      case 'flipreset':
        if (ev.carId === localId) sfx.flipReset(c);
        break;
      case 'countdown':
        sfx.paBeep(c, false);
        break;
      case 'kickoff':
        sfx.paBeep(c, true);
        this.crowd.cheer(0.6);
        break;
      case 'goal': {
        const ours = !!me && me.team === ev.team;
        sfx.net(c, ev.pos, ev.speed);
        sfx.horn(c);
        this.crowd.noteGoal();
        this.duck(0.45, 3);
        this.crowd.goal(ours);
        if (me) this.haptics.goal(ours);
        break;
      }
      case 'demo':
        sfx.demolition(c, ev.pos);
        this.crowd.cheer(0.8);
        if (ev.attacker === localId || ev.victim === localId) this.haptics.demo(ev.victim === localId);
        break;
      case 'bump':
        if (ev.attacker === localId || ev.victim === localId) { sfx.bump(c, 1400, null); this.haptics.bump(); }
        else if (near(ev.pos, 3500)) sfx.bump(c, 900, ev.pos);
        break;
      case 'save':
        this.crowd.save();
        break;
      case 'shot':
        this.crowd.shot();
        break;
      case 'overtime':
        sfx.whistle(c, [0.3, 0.3]);
        sfx.horn(c, 1.2);
        this.crowd.cheer(1);
        break;
      case 'end':
        sfx.whistle(c, [0.25, 0.25, 1.0]);
        sfx.horn(c, 2.2);
        this.crowd.finalApplause();
        break;
    }
  }

  /** Baja el bus del motor un momento para que el público y la bocina del gol se luzcan. */
  private duck(amount: number, secs: number) {
    const c = this.core;
    if (!c) return;
    const g = c.buses.motor.gain, t = c.now(), base = this.mix.motor;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(base * amount, t, 0.08);
    g.setTargetAtTime(base, t + secs, 0.6);
  }

  // ---------- Estado por cuadro ----------
  update(dt: number, snap: Snapshot | null, camera: ListenerCamera | null, state: AudioState, localId: number) {
    const c = this.core;
    if (!c || !this.engine || !this.remotes || !this.crowd || !this.music) return;
    if (state !== this.state) this.enterState(state);
    this.stateTime += dt;

    // Oyente en la cámara
    if (camera) {
      camera.getWorldDirection(_fwd);
      _q.copy(camera.quaternion);
      _up.set(0, 1, 0).applyQuaternion(_q);
      this.listener = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      c.setListener(this.listener, _fwd, _up);
    }

    const playing = state === 'playing';
    if (snap) {
      // Auto local
      const me = localId >= 0 ? snap.cars.find((x) => x.id === localId) : undefined;
      const engineOn = (playing || state === 'ended') && !!me && !me.demoed;
      this.engine.setActive(engineOn);
      if (engineOn && me) {
        const speed = Math.hypot(me.vx, me.vy, me.vz);
        _q.set(me.qx, me.qy, me.qz, me.qw);
        _right.set(0, -1, 0).applyQuaternion(_q);
        const lateral = Math.abs(me.vx * _right.x + me.vy * _right.y + me.vz * _right.z);
        const slip = Math.max(me.handbrake > 0.3 ? me.handbrake * clamp01(speed / 900) : 0, clamp01((lateral - 250) / 600));
        this.engine.update(dt, { speed, throttle: me.throttle, boosting: me.boosting, supersonic: me.supersonic, onGround: me.onGround, slip });
      }
      // Aterrizajes (todos los autos)
      for (const car of snap.cars) {
        const prev = this.prevCars.get(car.id);
        if (prev && playing && !car.demoed && !prev.onGround && car.onGround) {
          const k = clamp01(-prev.vz / 1300);
          if (car.id === localId) { sfx.landing(c, k, null); this.haptics.landing(k); }
          else {
            const p = { x: car.x, y: car.y, z: car.z };
            if (Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z) < 3000) sfx.landing(c, k * 0.8, p);
          }
        }
        this.prevCars.set(car.id, { onGround: car.onGround, vz: car.vz });
      }
      // Motores 3D de los demás
      this.remotes.setEnabled(playing || state === 'ended');
      this.remotes.update(dt, snap.cars.filter((x) => x.id !== localId && !x.demoed).map((x) => ({
        id: x.id, pos: { x: x.x, y: x.y, z: x.z }, speed: Math.hypot(x.vx, x.vy, x.vz), throttle: x.throttle, boosting: x.boosting, onGround: x.onGround,
      })), this.listener);
      this.crowd.update(dt, snap.ball, playing);
    }

    // Música en el menú y en la pantalla final
    if (state === 'menu' || (state === 'ended' && this.stateTime > 3.2)) this.music.start();
    this.music.update();
  }

  private enterState(s: AudioState) {
    this.state = s;
    this.stateTime = 0;
    const crowd = this.crowd!, music = this.music!;
    switch (s) {
      case 'menu': crowd.setLevel(0.4); this.engine!.setActive(false); this.remotes!.setEnabled(false); break;
      case 'playing': crowd.setLevel(1); music.stop(); break;
      case 'paused': crowd.setLevel(0.3); this.engine!.setActive(false); this.remotes!.setEnabled(false); music.stop(); break;
      case 'replay': crowd.setLevel(0.9); this.engine!.setActive(false); this.remotes!.setEnabled(false); break;
      case 'ended': crowd.setLevel(0.9); break;
    }
  }

  // ---------- Compatibilidad con la API anterior (hooks existentes) ----------
  hit(strength: number, near: boolean) { if (this.core) sfx.ballHit(this.core, strength * (near ? 1 : 0.6), null); }
  bounce(strength: number) { if (this.core) sfx.bounce(this.core, 'piso', strength, null); }
  pad(big: boolean) { if (this.core) sfx.pad(this.core, big); }
  jump() { if (this.core) sfx.jump(this.core, null, false); }
  countdown(final: boolean) { if (this.core) sfx.paBeep(this.core, final); }
  goal() { if (this.core) { sfx.horn(this.core); this.crowd?.goal(true); } }
  demo() { if (this.core) sfx.demolition(this.core, null); }
  bump() { if (this.core) sfx.bump(this.core, 1200, null); }
  whistle() { if (this.core) sfx.whistle(this.core); }
  click() { if (this.core) sfx.click(this.core); }
  setCrowd(level: number) { this.crowd?.setLevel(0.4 + level * 0.6); }
  /** @deprecated usar update(); se mantiene para hooks antiguos. */
  updateCar(speed: number, boosting: boolean, supersonic: boolean, onGround: boolean, active: boolean) {
    if (!this.engine) return;
    this.engine.setActive(active);
    if (active) this.engine.update(1 / 60, { speed, throttle: boosting ? 1 : 0.5, boosting, supersonic, onGround, slip: 0 });
  }

  /** Datos para pruebas/depuración. */
  debugInfo() {
    return {
      voices: this.core?.activeVoices() ?? 0,
      rpm: this.engine?.currentRpm ?? 0,
      gear: this.engine?.currentGear ?? 0,
      music: this.music?.isPlaying ?? false,
      state: this.state,
    };
  }
}
