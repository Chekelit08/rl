// Cámara estilo género: cámara de pelota / de auto, con FOV, distancia, altura, ángulo, rigidez, giro y transición.

import * as THREE from 'three';
import { arenaDistance, arenaNormal } from '../sim/arena.ts';
import type { BallSnap, CarSnap, Snapshot } from '../sim/world.ts';

export type DirectorShot = 'chase' | 'wide' | 'goal' | 'low';

export interface CameraSettings {
  fov: number; // horizontal
  distance: number;
  height: number;
  angle: number; // grados
  stiffness: number; // 0..1
  swivel: number; // 1..10
  transition: number; // 1..2
  shake: boolean;
}

export const DEFAULT_CAMERA: CameraSettings = {
  fov: 110, distance: 270, height: 100, angle: -4, stiffness: 0.45, swivel: 4.5, transition: 1.2, shake: true,
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraController {
  cam: THREE.PerspectiveCamera;
  settings: CameraSettings;
  ballCam = true;
  private blend = 1;
  private yaw = Math.PI / 2;
  private pos = new THREE.Vector3(0, -3000, 300);
  private look = new THREE.Vector3(0, 1, 0);
  private shakeAmt = 0;
  private initialized = false;
  /** Inclinación de la cámara de auto cuando se maneja por rampas y paredes. */
  private wallPitch = 0;

  constructor(cam: THREE.PerspectiveCamera, settings: CameraSettings) {
    this.cam = cam;
    this.settings = settings;
  }

  shake(amount: number) { if (this.settings.shake) this.shakeAmt = Math.max(this.shakeAmt, amount); }
  snapTo() { this.initialized = false; }

  updateFov(aspect: number) {
    const h = (this.settings.fov * Math.PI) / 180;
    let v = 2 * Math.atan(Math.tan(h / 2) / aspect);
    v = Math.min(v, (100 * Math.PI) / 180);
    this.cam.fov = (v * 180) / Math.PI;
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }

  /** Cámara de juego siguiendo al auto. */
  follow(car: CarSnap, ball: BallSnap, dt: number, lookX = 0, lookY = 0) {
    const s = this.settings;
    const cp = new THREE.Vector3(car.x, car.y, car.z);
    const q = new THREE.Quaternion(car.qx, car.qy, car.qz, car.qw);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const vel = new THREE.Vector3(car.vx, car.vy, car.vz);

    // Dirección de cámara de auto (yaw)
    let carYaw = this.yaw;
    const fh = Math.hypot(fwd.x, fwd.y);
    if (fh > 0.35) carYaw = Math.atan2(fwd.y, fwd.x);
    else if (Math.hypot(vel.x, vel.y) > 300) carYaw = Math.atan2(vel.y, vel.x);
    // Si vamos en reversa, la cámara mira hacia adelante del auto igual
    // Dirección de cámara de pelota
    const toBall = new THREE.Vector3(ball.x - car.x, ball.y - car.y, ball.z - car.z);
    const ballYaw = Math.atan2(toBall.y, toBall.x);
    const useBall = this.ballCam && !ball.hidden;

    this.blend += ((useBall ? 1 : 0) - this.blend) * Math.min(1, dt * s.transition * 6);
    const targetYaw = carYaw + wrap(ballYaw - carYaw) * this.blend;
    if (!this.initialized) this.yaw = targetYaw;
    const swivelRate = 1 - Math.exp(-dt * (2 + s.swivel * 2.2));
    this.yaw = wrap(this.yaw + wrap(targetYaw - this.yaw) * swivelRate);

    const yaw = this.yaw + lookX * Math.PI;
    // En paredes y rampas la cámara de auto acompaña la trompa (si no, el auto se va de cuadro al subir).
    // Con cámara de pelota o en el aire vuelve a quedar horizontal.
    const climb = car.onGround ? Math.asin(Math.max(-1, Math.min(1, fwd.z))) * 0.55 : 0;
    const pitchTarget = climb * (1 - this.blend) * (lookX ? 0 : 1);
    if (!this.initialized) this.wallPitch = pitchTarget;
    this.wallPitch += (pitchTarget - this.wallPitch) * (1 - Math.exp(-dt * 5));
    const cw = Math.cos(this.wallPitch), sw = Math.sin(this.wallPitch);
    const dir = new THREE.Vector3(Math.cos(yaw) * cw, Math.sin(yaw) * cw, sw);
    // La "altura" se aplica perpendicular a la dirección de cámara
    const upDir = new THREE.Vector3(-Math.cos(yaw) * sw, -Math.sin(yaw) * sw, cw);
    const desired = cp.clone().addScaledVector(dir, -s.distance).addScaledVector(upDir, s.height);
    if (lookY) desired.z += lookY * 180;

    const rate = 6 + s.stiffness * 40;
    if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
    else this.pos.lerp(desired, 1 - Math.exp(-rate * dt));
    // Mantener la cámara dentro de la arena
    const d = arenaDistance(this.pos.x, this.pos.y, this.pos.z);
    if (d < 40) {
      const n = arenaNormal(this.pos.x, this.pos.y, this.pos.z);
      this.pos.add(new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(40 - d));
    }

    // Hacia dónde mira
    const a = (s.angle * Math.PI) / 180 + this.wallPitch;
    const carLook = new THREE.Vector3(Math.cos(yaw) * Math.cos(a), Math.sin(yaw) * Math.cos(a), Math.sin(a));
    const ballLook = new THREE.Vector3(ball.x, ball.y, ball.z).sub(this.pos).normalize();
    const pitch = Math.max(-0.45, Math.min(0.95, Math.asin(Math.max(-1, Math.min(1, ballLook.z)))));
    const bh = Math.hypot(ballLook.x, ballLook.y) || 1;
    ballLook.set((ballLook.x / bh) * Math.cos(pitch), (ballLook.y / bh) * Math.cos(pitch), Math.sin(pitch));
    // La pelota pesa un poco menos que el auto en el encuadre vertical para que el auto no salga de pantalla
    ballLook.z = ballLook.z * 0.85 + Math.sin((s.angle * Math.PI) / 180) * 0.15;
    const lookDir = carLook.clone().lerp(ballLook, lookX ? 0 : this.blend).normalize();
    this.look.lerp(lookDir, 1 - Math.exp(-dt * 14)).normalize();

    this.applyShake(dt);
    this.cam.lookAt(this.cam.position.clone().add(this.look));
  }

  /**
   * Cámara de repetición. Con el snapshot completo usa el director de transmisión (planos y cortes);
   * sin él, sigue la pelota desde atrás.
   */
  replay(ball: BallSnap, focus: CarSnap | null, dt: number, snap?: Snapshot) {
    if (snap) { this.director(snap, dt, focus ? focus.id : -1); return; }
    const bp = new THREE.Vector3(ball.x, ball.y, ball.z);
    const vel = new THREE.Vector3(ball.vx, ball.vy, 0);
    let dir = vel.lengthSq() > 200 * 200 ? vel.normalize() : new THREE.Vector3(0, Math.sign(ball.y) || 1, 0);
    if (focus) {
      const fp = new THREE.Vector3(focus.x, focus.y, focus.z);
      const fd = bp.clone().sub(fp); fd.z = 0;
      if (fd.lengthSq() > 1) dir = dir.lerp(fd.normalize(), 0.5).normalize();
    }
    const desired = bp.clone().addScaledVector(dir, -1100).add(new THREE.Vector3(0, 0, 420));
    const d = arenaDistance(desired.x, desired.y, desired.z);
    if (d < 80) { const n = arenaNormal(desired.x, desired.y, desired.z); desired.add(new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(80 - d)); }
    if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
    else this.pos.lerp(desired, 1 - Math.exp(-dt * 3));
    this.look.lerp(bp.clone().sub(this.pos).normalize(), 1 - Math.exp(-dt * 8)).normalize();
    this.applyShake(dt);
    this.cam.lookAt(this.cam.position.clone().add(this.look));
  }

  // ---------- Modo personalizado (entrenamiento, editor, visor de repeticiones) ----------

  /** Función de cámara externa; si es null, `custom` usa el director. */
  customFn: ((snap: Snapshot, dt: number, cc: CameraController) => void) | null = null;

  /** El renderer llama a esto en el modo 'custom'. */
  custom(snap: Snapshot, dt: number) {
    if (this.customFn) this.customFn(snap, dt, this);
    else this.director(snap, dt);
  }

  // ---------- Cámara libre ----------
  readonly free = { pos: new THREE.Vector3(0, -4200, 1100), yaw: Math.PI / 2, pitch: -0.28 };

  freeForward() {
    const f = this.free;
    return new THREE.Vector3(Math.cos(f.yaw) * Math.cos(f.pitch), Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch));
  }

  /** Mueve la cámara libre: adelante/derecha/arriba en uu (relativo a hacia dónde mira). */
  freeMove(forward: number, right: number, up: number) {
    const f = this.free;
    const rt = new THREE.Vector3(Math.sin(f.yaw), -Math.cos(f.yaw), 0);
    f.pos.addScaledVector(this.freeForward(), forward).addScaledVector(rt, right).add(new THREE.Vector3(0, 0, up));
    f.pos.x = Math.max(-9000, Math.min(9000, f.pos.x));
    f.pos.y = Math.max(-11000, Math.min(11000, f.pos.y));
    f.pos.z = Math.max(20, Math.min(6000, f.pos.z));
  }

  freeRotate(dYaw: number, dPitch: number) {
    const f = this.free;
    f.yaw = wrap(f.yaw + dYaw);
    f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch + dPitch));
  }

  /** Ubica la cámara libre mirando a un punto. */
  freeLookAt(from: THREE.Vector3, target: THREE.Vector3) {
    const f = this.free;
    f.pos.copy(from);
    const d = target.clone().sub(from);
    f.yaw = Math.atan2(d.y, d.x);
    f.pitch = Math.atan2(d.z, Math.hypot(d.x, d.y));
  }

  applyFree(dt = 0) {
    this.pos.copy(this.free.pos);
    this.look.copy(this.freeForward());
    this.applyShake(dt);
    this.cam.lookAt(this.cam.position.clone().add(this.look));
    this.initialized = false;
  }

  // ---------- Director de transmisión ----------
  private shot: DirectorShot = 'chase';
  private shotTime = 0;
  private wideSide = -1;
  /** Auto preferido por el director (-1 = automático: el más cercano a la pelota). */
  directorFocus = -1;
  get currentShot() { return this.shot; }

  /**
   * Director automático: plano de persecución detrás del protagonista, plano general desde la tribuna
   * cuando la pelota vuela alto o la jugada se estira, y cámara detrás del arco cuando la pelota llega al área.
   */
  director(snap: Snapshot, dt: number, preferId = this.directorFocus) {
    const b = snap.ball;
    const bp = new THREE.Vector3(b.x, b.y, b.z);
    const side = Math.sign(b.y) || 1;
    const toLine = 5120 - Math.abs(b.y);
    const vToward = b.vy * side;
    const speed = Math.hypot(b.vx, b.vy, b.vz);

    // Protagonista: el preferido si está vivo; si no, el más cercano a la pelota
    let focus = snap.cars.find((c) => c.id === preferId && !c.demoed) ?? null;
    if (!focus) {
      let best = Infinity;
      for (const c of snap.cars) {
        if (c.demoed) continue;
        const d = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z);
        if (d < best) { best = d; focus = c; }
      }
    }

    let want: DirectorShot = 'chase';
    if (!b.hidden && toLine < 2300 && (vToward > 250 || toLine < 900)) want = 'goal';
    else if (b.z > 900 || (this.shot === 'chase' && this.shotTime > 7) || (this.shot === 'wide' && this.shotTime < 3.5)) want = 'wide';
    if (b.hidden) want = this.shot === 'goal' ? 'goal' : 'wide';
    if (speed > 3800 && want === 'chase') want = 'low';

    this.shotTime += dt;
    let cut = false;
    if (want !== this.shot && (this.shotTime > 1.6 || want === 'goal')) {
      if (want === 'wide') this.wideSide = (focus ? Math.sign(focus.x) : 1) >= 0 ? -1 : 1;
      this.shot = want;
      this.shotTime = 0;
      cut = true;
    }

    const desired = new THREE.Vector3();
    const target = bp.clone();
    let rate = 4;
    switch (this.shot) {
      case 'chase':
      case 'low': {
        const low = this.shot === 'low';
        if (focus) {
          const fp = new THREE.Vector3(focus.x, focus.y, focus.z);
          const dir = bp.clone().sub(fp); dir.z = 0;
          if (dir.lengthSq() < 1) dir.set(0, side, 0);
          dir.normalize();
          desired.copy(fp).addScaledVector(dir, low ? -420 : -720).add(new THREE.Vector3(0, 0, low ? 90 : 270));
          target.lerp(fp, low ? 0.15 : 0.3);
        } else {
          desired.copy(bp).add(new THREE.Vector3(0, -side * 1200, 500));
        }
        rate = low ? 6 : 3.5;
        break;
      }
      case 'wide': {
        desired.set(this.wideSide * 5600, Math.max(-5400, Math.min(5400, b.y * 0.85)), 2100);
        rate = 2.2;
        break;
      }
      case 'goal': {
        desired.set(b.x * 0.3, side * 6650, 1150);
        rate = 2.5;
        break;
      }
    }
    // Las cámaras de persecución no salen de la arena (las de tribuna y arco sí: miran a través del vidrio y la red)
    if (this.shot === 'chase' || this.shot === 'low') {
      const d = arenaDistance(desired.x, desired.y, desired.z);
      if (d < 70) { const n = arenaNormal(desired.x, desired.y, desired.z); desired.add(new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(70 - d)); }
    }
    if (cut || !this.initialized) { this.pos.copy(desired); this.initialized = true; this.look.copy(target.clone().sub(this.pos).normalize()); }
    else this.pos.lerp(desired, 1 - Math.exp(-rate * dt));
    this.look.lerp(target.sub(this.pos).normalize(), 1 - Math.exp(-dt * 7)).normalize();
    this.applyShake(dt);
    this.cam.lookAt(this.cam.position.clone().add(this.look));
  }

  /** Reinicia el director (al empezar una repetición). */
  resetDirector() { this.shot = 'chase'; this.shotTime = 0; this.initialized = false; }

  /** Cámara de menú: órbita lenta sobre la cancha. */
  orbit(t: number) {
    this.pos.set(Math.cos(t * 0.06) * 5200, Math.sin(t * 0.06) * 6500, 1500);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(0, 0, 200);
    this.initialized = false;
  }

  private applyShake(dt: number) {
    this.cam.position.copy(this.pos);
    if (this.shakeAmt > 0.01) {
      this.cam.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.cam.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.cam.position.z += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
  }
}
