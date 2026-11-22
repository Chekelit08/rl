// Cámara estilo género: cámara de pelota / de auto, con FOV, distancia, altura, ángulo, rigidez, giro y transición.

import * as THREE from 'three';
import { arenaDistance, arenaNormal } from '../sim/arena.ts';
import type { BallSnap, CarSnap } from '../sim/world.ts';

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
    const dir = new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);
    const desired = cp.clone().addScaledVector(dir, -s.distance).add(new THREE.Vector3(0, 0, s.height));
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
    const a = (s.angle * Math.PI) / 180;
    const carLook = new THREE.Vector3(Math.cos(yaw) * Math.cos(a), Math.sin(yaw) * Math.cos(a), Math.sin(a));
    const ballLook = new THREE.Vector3(ball.x, ball.y, ball.z).sub(this.pos).normalize();
    const pitch = Math.max(-0.45, Math.min(0.95, Math.asin(Math.max(-1, Math.min(1, ballLook.z)))));
    const bh = Math.hypot(ballLook.x, ballLook.y) || 1;
    ballLook.set((ballLook.x / bh) * Math.cos(pitch), (ballLook.y / bh) * Math.cos(pitch), Math.sin(pitch));
    // La pelota pesa un poco menos que el auto en el encuadre vertical para que el auto no salga de pantalla
    ballLook.z = ballLook.z * 0.85 + Math.sin(a) * 0.15;
    const lookDir = carLook.clone().lerp(ballLook, lookX ? 0 : this.blend).normalize();
    this.look.lerp(lookDir, 1 - Math.exp(-dt * 14)).normalize();

    this.applyShake(dt);
    this.cam.lookAt(this.cam.position.clone().add(this.look));
  }

  /** Cámara de repetición: plano de transmisión siguiendo la pelota. */
  replay(ball: BallSnap, focus: CarSnap | null, dt: number) {
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
