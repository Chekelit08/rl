// Efectos cosméticos: estelas de turbo y explosiones de gol personalizadas.
// El renderer llama a estos hooks; si no hay hooks, usa sus efectos por defecto.

import * as THREE from 'three';
import type { CarVisual } from '../render/carMesh.ts';
import type { Particles } from '../render/effects.ts';
import { BOOST_COLOR, TEAM_COLORS, TEAM_COLORS_LIGHT } from '../render/palette.ts';
import { type ExplosionId, TRAILS, type TrailId, type TrailStyle } from './cosmetics.ts';
import type { CarLook } from './loadout.ts';

export interface CosmeticsHooks {
  /** Emite partículas de turbo. Devuelve true si reemplazó el efecto por defecto. */
  boost(v: CarVisual, team: number, rear: THREE.Vector3, back: THREE.Vector3, vel: THREE.Vector3, dt: number): boolean;
  /** Explosión de gol del goleador. Devuelve true si reemplazó el efecto por defecto. */
  goal(pos: THREE.Vector3, team: number, look: CarLook | undefined): boolean;
  update(dt: number): void;
}

const tmp = new THREE.Color();
const trailStyle = (id: TrailId): TrailStyle => (TRAILS.find((t) => t.id === id) ?? TRAILS[0]).style;

/** Colorea la llama del auto según la estela (se llama una vez al crear el auto o cambiar el look). */
export function applyFlameColors(v: CarVisual, team: number) {
  const s = trailStyle(v.look.trail);
  const [outer, mid, inner] = v.flameMats;
  if (!outer) return;
  outer.color.set(s.flame ?? TEAM_COLORS_LIGHT[team]);
  mid.color.set(s.mode === 'arcoiris' ? '#ff4fd8' : s.core === '#ffffff' ? (s.flame ?? TEAM_COLORS_LIGHT[team]) : s.core);
  inner.color.set('#ffffff');
}

interface Cube { mesh: THREE.Mesh; vel: THREE.Vector3; rot: THREE.Vector3; life: number; max: number }
interface Bolt { line: THREE.Line; life: number }

export class CosmeticFx implements CosmeticsHooks {
  private scene: THREE.Scene;
  private particles: Particles;
  private smoke: Particles;
  private time = 0;
  private queue: { at: number; fn: () => void }[] = [];
  private cubes: Cube[] = [];
  private bolts: Bolt[] = [];
  private light = new THREE.PointLight('#ffffff', 0, 9000, 1.4);
  private cubeGeo = new THREE.BoxGeometry(34, 34, 34);
  private ring: THREE.Mesh | null = null;
  private ringLife = 0;

  constructor(scene: THREE.Scene, particles: Particles, smoke: Particles) {
    this.scene = scene;
    this.particles = particles;
    this.smoke = smoke;
    scene.add(this.light);
  }

  boost(v: CarVisual, team: number, rear: THREE.Vector3, back: THREE.Vector3, vel: THREE.Vector3): boolean {
    const s = trailStyle(v.look.trail);
    const P = this.particles;
    const base = new THREE.Vector3(rear.x + back.x * 40, rear.y + back.y * 40, rear.z + back.z * 40);
    const n = s.mode === 'chispas' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const sp = (s.mode === 'chispas' ? 650 : 400) + Math.random() * 300;
      let col: THREE.Color;
      if (s.mode === 'arcoiris') col = tmp.setHSL((this.time * 0.6 + i * 0.12) % 1, 0.95, 0.6).clone();
      else {
        const c = s.sparks.length ? s.sparks[i % s.sparks.length] : null;
        col = new THREE.Color(c ?? (i === 0 ? BOOST_COLOR : TEAM_COLORS_LIGHT[team]));
      }
      const spread = s.mode === 'chispas' ? 260 : 120;
      P.spawn(base.x, base.y, base.z,
        back.x * sp + vel.x * 0.6 + (Math.random() - 0.5) * spread,
        back.y * sp + vel.y * 0.6 + (Math.random() - 0.5) * spread,
        back.z * sp + vel.z * 0.6 + (Math.random() - 0.5) * spread + (s.mode === 'chispas' ? 120 : 0),
        col, s.mode === 'chispas' ? 22 : 38, s.mode === 'chispas' ? 0.45 : 0.28, s.mode === 'chispas' ? -900 : 0, 2);
    }
    if (s.smoke) {
      tmp.set(s.smoke);
      const k = 0.9 + Math.random() * 0.15;
      this.smoke.spawn(rear.x + back.x * 70, rear.y + back.y * 70, rear.z + back.z * 70,
        vel.x * 0.15 + (Math.random() - 0.5) * 60, vel.y * 0.15 + (Math.random() - 0.5) * 60, vel.z * 0.15 + 40,
        new THREE.Color(tmp.r * k, tmp.g * k, tmp.b * k), 55, 0.9, 30, 1.5);
    }
    if (s.mode === 'arcoiris') {
      const [outer] = v.flameMats;
      outer?.color.setHSL((this.time * 0.6) % 1, 0.9, 0.6);
    }
    return true;
  }

  goal(pos: THREE.Vector3, team: number, look: CarLook | undefined): boolean {
    const id: ExplosionId = look?.explosion ?? 'clasica';
    const tc = new THREE.Color(TEAM_COLORS[team]);
    const tl = new THREE.Color(TEAM_COLORS_LIGHT[team]);
    const white = new THREE.Color('#ffffff');
    const P = this.particles;
    const flash = (col: THREE.Color, k = 40) => { this.light.position.copy(pos); this.light.color.copy(col); this.light.intensity = k; };
    switch (id) {
      case 'clasica':
        P.burst(pos, 900, 2600, [tc, tl, white], 70, 1.8, -500);
        P.burst(pos, 300, 900, [white, new THREE.Color(BOOST_COLOR)], 120, 1.2, 0);
        flash(tc);
        break;
      case 'onda': {
        // Anillo horizontal expansivo + domo
        for (let i = 0; i < 520; i++) {
          const a = (i / 520) * Math.PI * 2;
          const sp = 2600 + Math.random() * 300;
          P.spawn(pos.x, pos.y, pos.z, Math.cos(a) * sp, Math.sin(a) * sp, (Math.random() - 0.5) * 120, i % 3 ? tc : white, 60, 1.1, 0, 0.6);
        }
        P.burst(pos, 300, 1400, [tl, white], 80, 1.0, -200);
        this.shockRing(pos, tc);
        flash(white, 55);
        break;
      }
      case 'confeti': {
        const cols = ['#ff4f6d', '#ffd23d', '#4fd1ff', '#7dff6a', '#c77dff', '#ffffff'].map((c) => new THREE.Color(c));
        for (let i = 0; i < 900; i++) {
          const a = Math.random() * Math.PI * 2, u = Math.random();
          const sp = 600 + Math.random() * 1500;
          P.spawn(pos.x, pos.y, pos.z, Math.cos(a) * sp * (1 - u * 0.5), Math.sin(a) * sp * (1 - u * 0.5), 600 + u * 1800,
            cols[i % cols.length], 24 + Math.random() * 16, 3 + Math.random() * 1.5, -520, 1.4);
        }
        flash(tl, 25);
        break;
      }
      case 'fuegos': {
        const cols = [tc, tl, new THREE.Color('#ffd23d'), white];
        P.burst(pos, 200, 900, [white], 50, 0.6, 0);
        for (let k = 0; k < 6; k++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 1400, (Math.random() - 0.5) * 900, 500 + Math.random() * 900);
          const at = pos.clone().add(off);
          // Cohete subiendo
          this.queue.push({ at: this.time + k * 0.12, fn: () => { for (let i = 0; i < 18; i++) P.spawn(pos.x, pos.y, pos.z + i * 10, off.x * 1.6, off.y * 1.6, off.z * 1.6, white, 26, 0.55, 0, 0); } });
          this.queue.push({
            at: this.time + 0.6 + k * 0.12, fn: () => {
              P.burst(at, 260, 1300, [cols[k % cols.length], white], 55, 1.6, -300);
              this.light.position.copy(at); this.light.color.copy(cols[k % cols.length]); this.light.intensity = 30;
            },
          });
        }
        break;
      }
      case 'cubos': {
        const mats = [tc, tl, white].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3 }));
        for (let i = 0; i < 70; i++) {
          const m = new THREE.Mesh(this.cubeGeo, mats[i % mats.length]);
          m.position.copy(pos);
          const s = 0.5 + Math.random() * 1.1;
          m.scale.setScalar(s);
          this.scene.add(m);
          const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
          const r = Math.sqrt(1 - u * u), sp = 900 + Math.random() * 1500;
          this.cubes.push({ mesh: m, vel: new THREE.Vector3(Math.cos(a) * r * sp, Math.sin(a) * r * sp, Math.abs(u) * sp + 500), rot: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), life: 2.6, max: 2.6 });
        }
        P.burst(pos, 250, 1600, [white, tl], 60, 0.8, 0);
        flash(tc, 35);
        break;
      }
      case 'tormenta': {
        for (let k = 0; k < 7; k++) this.queue.push({ at: this.time + k * 0.11, fn: () => this.bolt(pos) });
        P.burst(pos, 500, 1900, [new THREE.Color('#bfe6ff'), white, tl], 50, 1.2, -200);
        flash(new THREE.Color('#bfe6ff'), 70);
        break;
      }
      case 'agujero': {
        // Partículas que caen en espiral hacia el centro y luego estallan
        for (let i = 0; i < 600; i++) {
          const a = Math.random() * Math.PI * 2, r = 700 + Math.random() * 900;
          const p = pos.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 600));
          const tang = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(900);
          const inward = pos.clone().sub(p).multiplyScalar(1.6);
          P.spawn(p.x, p.y, p.z, inward.x + tang.x, inward.y + tang.y, inward.z, i % 4 ? new THREE.Color('#5a2bff') : white, 40, 0.65, 0, 0);
        }
        this.queue.push({ at: this.time + 0.62, fn: () => { P.burst(pos, 900, 3000, [new THREE.Color('#8a5cff'), white, tc], 70, 1.6, 0); this.light.position.copy(pos); this.light.color.set('#8a5cff'); this.light.intensity = 60; } });
        break;
      }
      case 'supernova': {
        const gold = new THREE.Color('#ffd86a');
        P.burst(pos, 1200, 3600, [white, gold, tc], 90, 2.2, -150);
        this.queue.push({ at: this.time + 0.25, fn: () => P.burst(pos, 700, 1800, [tl, white], 110, 1.8, 0) });
        this.queue.push({ at: this.time + 0.5, fn: () => P.burst(pos, 500, 900, [gold], 140, 1.6, 0) });
        this.shockRing(pos, gold);
        flash(white, 90);
        break;
      }
    }
    return true;
  }

  private shockRing(pos: THREE.Vector3, col: THREE.Color) {
    if (this.ring) { this.scene.remove(this.ring); this.ring.geometry.dispose(); }
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.position.copy(pos);
    this.ring.scale.setScalar(50);
    this.scene.add(this.ring);
    this.ringLife = 1;
  }

  private bolt(target: THREE.Vector3) {
    const pts: THREE.Vector3[] = [];
    const start = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1600, (Math.random() - 0.5) * 1600, 2000));
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const p = start.clone().lerp(target, t);
      if (i > 0 && i < 12) p.add(new THREE.Vector3((Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 80));
      pts.push(p);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(line);
    this.bolts.push({ line, life: 0.35 });
    this.light.position.copy(target);
    this.light.color.set('#cfe8ff');
    this.light.intensity = 60;
  }

  update(dt: number) {
    this.time += dt;
    this.light.intensity *= Math.exp(-dt * 4);
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.at <= this.time);
      this.queue = this.queue.filter((q) => q.at > this.time);
      for (const q of due) q.fn();
    }
    for (const c of this.cubes) {
      c.life -= dt;
      c.vel.z -= 900 * dt;
      c.vel.multiplyScalar(Math.exp(-dt * 0.6));
      c.mesh.position.addScaledVector(c.vel, dt);
      if (c.mesh.position.z < 20) { c.mesh.position.z = 20; c.vel.z = Math.abs(c.vel.z) * 0.4; }
      c.mesh.rotation.x += c.rot.x * dt; c.mesh.rotation.y += c.rot.y * dt; c.mesh.rotation.z += c.rot.z * dt;
      const k = Math.max(0, Math.min(1, c.life / 0.6));
      c.mesh.scale.setScalar(Math.max(0.001, c.mesh.scale.x * (k < 1 ? 0.92 : 1)));
      if (c.life <= 0) this.scene.remove(c.mesh);
    }
    this.cubes = this.cubes.filter((c) => c.life > 0);
    for (const b of this.bolts) {
      b.life -= dt;
      (b.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / 0.35) * (Math.random() < 0.3 ? 0.3 : 1);
      if (b.life <= 0) { this.scene.remove(b.line); b.line.geometry.dispose(); }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
    if (this.ring) {
      this.ringLife -= dt;
      const t = 1 - this.ringLife;
      this.ring.scale.setScalar(50 + t * 3200);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.ringLife) * 0.9;
      this.ring.lookAt(this.ring.position.clone().add(new THREE.Vector3(0, 0, 1)));
      if (this.ringLife <= 0) { this.scene.remove(this.ring); this.ring.geometry.dispose(); this.ring = null; }
    }
  }
}
