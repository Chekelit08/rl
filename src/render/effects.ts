// Partículas (turbo, estelas, explosiones), pelota, sombra de pelota y pads de turbo.

import * as THREE from 'three';
import { BALL, BIG_PADS, SMALL_PADS } from '../sim/constants.ts';
import { BALL_GLOW, BOOST_COLOR } from './palette.ts';
import { glowTexture } from './stadium.ts';

const MAX_PARTICLES = 6000;

export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private col = new Float32Array(MAX_PARTICLES * 3);
  private size = new Float32Array(MAX_PARTICLES);
  private alpha = new Float32Array(MAX_PARTICLES);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private maxLife = new Float32Array(MAX_PARTICLES);
  private size0 = new Float32Array(MAX_PARTICLES);
  private grav = new Float32Array(MAX_PARTICLES);
  private drag = new Float32Array(MAX_PARTICLES);
  private next = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: glowTexture() }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vCol; varying float vA; uniform float uScale;
        void main() {
          vCol = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying vec3 vCol; varying float vA;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vCol * t.rgb, t.a * vA);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  setViewportHeight(h: number, fovY: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h / (2 * Math.tan((fovY * Math.PI) / 360));
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, grav = 0, drag = 0) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size0[i] = size; this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.alpha[i] = 1;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  burst(at: THREE.Vector3, count: number, speed: number, colors: THREE.Color[], size: number, life: number, grav = -400) {
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn(at.x, at.y, at.z, r * Math.cos(th) * s, r * Math.sin(th) * s, u * s + speed * 0.2,
        colors[i % colors.length], size * (0.5 + Math.random()), life * (0.5 + Math.random() * 0.5), grav, 1.2);
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] *= k; this.vel[i * 3 + 2] = this.vel[i * 3 + 2] * k + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t;
      this.size[i] = this.size0[i] * (0.4 + 0.6 * t);
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Textura de la pelota: base clara con costura curva continua (diseño propio). */
function ballTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#f4f7fb');
  grd.addColorStop(0.5, '#dde5ef');
  grd.addColorStop(1, '#f4f7fb');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // Costura tipo "pelota de tenis": curva sinusoidal en coordenadas esféricas
  const seam = (offset: number, color: string, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (let i = 0; i <= 400; i++) {
      const u = i / 400;
      const lon = u * Math.PI * 2;
      const lat = 0.55 * Math.sin(2 * lon + offset);
      const x = u * W, y = (0.5 - lat / Math.PI) * H;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  };
  seam(0, '#26313f', 26);
  seam(0, '#7CF7FF', 8);
  // Paneles
  g.fillStyle = 'rgba(30,40,55,0.12)';
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.arc((i + 0.5) * (W / 8), i % 2 ? H * 0.25 : H * 0.75, 30, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class BallVisual {
  group = new THREE.Group();
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  glow: THREE.Sprite;
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.VISUAL_RADIUS, 48, 32),
      new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35, metalness: 0.05, emissive: '#1a2a3a', emissiveIntensity: 0.25 }),
    );
    this.mesh.castShadow = true;
    // La textura usa lon/lat con eje Y de la esfera; giramos para que el "polo" sea Z
    this.mesh.geometry.rotateX(Math.PI / 2);
    this.group.add(this.mesh);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: BALL_GLOW, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.set(380, 380, 1);
    this.group.add(this.glow);
    // Sombra explícita justo debajo de la pelota (clave para leer la altura)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(BALL.RADIUS * 2.4, BALL.RADIUS * 2.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }),
    );
    this.shadow.renderOrder = 1;
  }
}

export interface PadVisual { obj: THREE.Object3D; core: THREE.Object3D; big: boolean; on: number }

export function buildPads(group: THREE.Group): PadVisual[] {
  const pads: PadVisual[] = [];
  const ringMat = new THREE.MeshStandardMaterial({ color: '#2a3140', metalness: 0.7, roughness: 0.3 });
  const coreMat = () => new THREE.MeshBasicMaterial({ color: BOOST_COLOR, transparent: true, opacity: 0.95 });
  const all: [number, number, boolean][] = [...BIG_PADS.map(([x, y]) => [x, y, true] as [number, number, boolean]), ...SMALL_PADS.map(([x, y]) => [x, y, false] as [number, number, boolean])];
  for (const [x, y, big] of all) {
    const obj = new THREE.Group();
    obj.position.set(x, y, 0);
    const r = big ? 150 : 75;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, 8, 24), ringMat);
    base.rotation.x = Math.PI / 2;
    base.position.z = 4;
    base.receiveShadow = true;
    obj.add(base);
    let core: THREE.Object3D;
    if (big) {
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(55, 0), coreMat());
      orb.position.z = 110;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: BOOST_COLOR, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(420, 420, 1);
      orb.add(halo);
      core = orb;
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 4, 20), coreMat());
      disc.rotation.x = Math.PI / 2;
      disc.position.z = 10;
      core = disc;
    }
    obj.add(core);
    group.add(obj);
    pads.push({ obj, core, big, on: 1 });
  }
  return pads;
}
