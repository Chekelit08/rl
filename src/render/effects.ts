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
  private grow: number;

  constructor(opts: { additive?: boolean; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
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
      if (this.grow > 0) {
        this.alpha[i] = t * t * 0.55;
        this.size[i] = this.size0[i] * (1 + this.grow * (1 - t));
      } else {
        this.alpha[i] = t;
        this.size[i] = this.size0[i] * (0.4 + 0.6 * t);
      }
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Textura de pelota de fútbol clásica (icosaedro truncado) calculada por píxel en coordenadas esféricas. */
function ballTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const phi = (1 + Math.sqrt(5)) / 2;
  // 12 centros de pentágono (vértices del icosaedro) + 20 de hexágono (vértices del dodecaedro)
  const pent: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    pent.push([0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a]);
  }
  const hex: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) hex.push([a, b, c]);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    hex.push([0, a / phi, b * phi], [a / phi, b * phi, 0], [b * phi, 0, a / phi]);
  }
  const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const centers = [...pent.map(norm), ...hex.map(norm)];
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = Math.PI / 2 - (y / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      // Misma convención que SphereGeometry (eje Y como polo)
      const d = [-Math.cos(lon) * cl, sl, Math.sin(lon) * cl];
      let b1 = -2, b2 = -2, bi = 0;
      for (let k = 0; k < 32; k++) {
        const c = centers[k];
        const dot = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
        if (dot > b1) { b2 = b1; b1 = dot; bi = k; } else if (dot > b2) b2 = dot;
      }
      const seam = 1 - Math.min(1, (b1 - b2) / 0.012);
      let r: number, gg: number, bb: number;
      if (bi < 12) { r = 24; gg = 30; bb = 40; } else { r = 240; gg = 243; bb = 247; }
      const k = seam * 0.85;
      r = r * (1 - k) + 70 * k; gg = gg * (1 - k) + 76 * k; bb = bb * (1 - k) + 86 * k;
      const i = (y * W + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
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
      new THREE.MeshPhysicalMaterial({ map: ballTexture(), roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    );
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: BALL_GLOW, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }));
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
  const ringMat = new THREE.MeshStandardMaterial({ color: '#8b939e', metalness: 0.5, roughness: 0.35 });
  const coreMat = () => new THREE.MeshBasicMaterial({ color: BOOST_COLOR, transparent: true, opacity: 0.95 });
  const all: [number, number, boolean][] = [...BIG_PADS.map(([x, y]) => [x, y, true] as [number, number, boolean]), ...SMALL_PADS.map(([x, y]) => [x, y, false] as [number, number, boolean])];
  for (const [x, y, big] of all) {
    const obj = new THREE.Group();
    obj.position.set(x, y, 0);
    const r = big ? 150 : 75;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 4, 24), ringMat);
    base.rotation.x = Math.PI / 2;
    base.position.z = 2;
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

/** Sombra de contacto suave bajo cada auto (lo "apoya" en el piso). */
export class ContactShadows {
  mesh = new THREE.Group();
  private items: THREE.Mesh[] = [];
  constructor(n: number) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }));
      m.renderOrder = 1;
      m.visible = false;
      this.items.push(m);
      this.mesh.add(m);
    }
  }
  /** Ubica la sombra i sobre la superficie (punto, normal) con el tamaño y el rumbo del auto. */
  set(i: number, visible: boolean, px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 1, yaw = 0, len = 120, wid = 85, height = 0) {
    const m = this.items[i];
    if (!m) return;
    m.visible = visible;
    if (!visible) return;
    m.position.set(px + nx * 1.5, py + ny * 1.5, pz + nz * 1.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, ny, nz));
    m.rotateZ(yaw);
    const s = 1 + height / 400;
    m.scale.set(len * 1.35 * s, wid * 1.5 * s, 1);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 - height / 500);
  }
}

/** Marcas de neumáticos (derrapes y frenadas) en un buffer circular instanciado. */
export class SkidMarks {
  mesh: THREE.InstancedMesh;
  private next = 0;
  private count = 0;
  private readonly max = 4000;
  private m = new THREE.Matrix4();
  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: '#0d120c', transparent: true, opacity: 0.42, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  add(ax: number, ay: number, bx: number, by: number, z: number, width: number) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(dy, dx));
    this.m.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, z + 0.8), q, new THREE.Vector3(len + 2, width, 1));
    this.mesh.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.count = 0; this.next = 0; this.mesh.count = 0; }
}
