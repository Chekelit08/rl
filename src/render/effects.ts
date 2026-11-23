// Partículas (turbo, estelas, explosiones), pelota, sombra de pelota, pads de turbo (instanciados),
// sombras de contacto y marcas de neumáticos.

import * as THREE from 'three';
import { BALL, BIG_PADS, SMALL_PADS } from '../sim/constants.ts';
import { BALL_GLOW, BOOST_COLOR } from './palette.ts';
import { glowTexture } from './stadium.ts';

const MAX_PARTICLES = 8000;

export interface ParticleOptions {
  additive?: boolean;
  /** Crecimiento del tamaño a lo largo de la vida (humo). */
  grow?: number;
  /** Textura del punto (por defecto, brillo radial). */
  texture?: THREE.Texture;
  /** Alfa máximo (humo/confeti). */
  maxAlpha?: number;
  max?: number;
}

/** Sistema de partículas por puntos, con color inicial→final y gravedad/arrastre por partícula. */
export class Particles {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private next = 0;
  private grow: number;
  private maxAlpha: number;
  private readonly max: number;
  private live = 0;
  /** Multiplicador global de emisión (preset de calidad). */
  density = 1;

  constructor(opts: ParticleOptions = {}) {
    this.grow = opts.grow ?? 0;
    this.maxAlpha = opts.maxAlpha ?? 1;
    this.max = opts.max ?? MAX_PARTICLES;
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.col0 = new Float32Array(n * 3);
    this.col1 = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { uTex: { value: opts.texture ?? glowTexture() }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vCol; varying float vA; uniform float uScale;
        void main() {
          vCol = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = alpha > 0.0 ? min(size * uScale / -mv.z, 512.0) : 0.0;
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

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, grav = 0, drag = 0, endColor?: THREE.Color) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    const e = endColor ?? color;
    this.col0[i * 3] = color.r; this.col0[i * 3 + 1] = color.g; this.col0[i * 3 + 2] = color.b;
    this.col1[i * 3] = e.r; this.col1[i * 3 + 1] = e.g; this.col1[i * 3 + 2] = e.b;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size0[i] = size; this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.alpha[i] = this.maxAlpha;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  /** Cantidad a emitir ajustada por la densidad del preset (con redondeo probabilístico). */
  count(n: number) {
    const v = n * this.density;
    const f = Math.floor(v);
    return f + (Math.random() < v - f ? 1 : 0);
  }

  burst(at: THREE.Vector3, count: number, speed: number, colors: THREE.Color[], size: number, life: number, grav = -400, drag = 1.2, endColor?: THREE.Color) {
    const n = this.count(count);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn(at.x, at.y, at.z, r * Math.cos(th) * s, r * Math.sin(th) * s, u * s + speed * 0.2,
        colors[i % colors.length], size * (0.5 + Math.random()), life * (0.5 + Math.random() * 0.5), grav, drag, endColor);
    }
  }

  /** Anillo de partículas que sale rasante sobre una superficie (polvo de aterrizaje / pique). */
  ring(at: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number, color: THREE.Color, size: number, life: number) {
    const n = this.count(count);
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    t1.set(normal.y, normal.z, normal.x).cross(normal).normalize();
    if (t1.lengthSq() < 0.01) t1.set(1, 0, 0);
    t2.crossVectors(normal, t1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const s = speed * (0.6 + Math.random() * 0.5);
      const dx = (Math.cos(a) * t1.x + Math.sin(a) * t2.x) * s + normal.x * speed * 0.15;
      const dy = (Math.cos(a) * t1.y + Math.sin(a) * t2.y) * s + normal.y * speed * 0.15;
      const dz = (Math.cos(a) * t1.z + Math.sin(a) * t2.z) * s + normal.z * speed * 0.15;
      this.spawn(at.x, at.y, at.z, dx, dy, dz, color, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), 0, 2.4);
    }
  }

  update(dt: number) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      live++;
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] *= k; this.vel[i * 3 + 2] = this.vel[i * 3 + 2] * k + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const u = 1 - t;
      this.col[i * 3] = this.col0[i * 3] + (this.col1[i * 3] - this.col0[i * 3]) * u;
      this.col[i * 3 + 1] = this.col0[i * 3 + 1] + (this.col1[i * 3 + 1] - this.col0[i * 3 + 1]) * u;
      this.col[i * 3 + 2] = this.col0[i * 3 + 2] + (this.col1[i * 3 + 2] - this.col0[i * 3 + 2]) * u;
      if (this.grow > 0) {
        this.alpha[i] = t * Math.min(1, u * 6 + 0.25) * this.maxAlpha;
        this.size[i] = this.size0[i] * (1 + this.grow * u);
      } else {
        this.alpha[i] = t * this.maxAlpha;
        this.size[i] = this.size0[i] * (0.4 + 0.6 * t);
      }
    }
    this.live = live;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }

  get alive() { return this.live; }
}

/** Textura de humo (bordes irregulares y suaves). */
export function smokeTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 18; i++) {
    const x = 64 + (Math.random() - 0.5) * 36, y = 64 + (Math.random() - 0.5) * 36, r = 22 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(cv);
}

/** Textura de confeti (cuadradito con brillo). */
export function confettiTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(10, 6, 12, 20);
  return new THREE.CanvasTexture(cv);
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

// ---------- Pads de turbo (instanciados: 5 draw calls para los 34 pads) ----------

function padRingTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.62, 'rgba(255,255,255,0.15)');
  grd.addColorStop(0.8, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.9, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

/** Todos los pads de turbo: bases, núcleos, orbes grandes, aro de luz en el piso y halos. */
export class PadField {
  group = new THREE.Group();
  readonly count: number;
  private positions: THREE.Vector3[] = [];
  private big: boolean[] = [];
  private on: number[] = [];
  private bases: THREE.InstancedMesh;
  private discs: THREE.InstancedMesh;
  private orbs: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private halos: THREE.Points;
  private haloAlpha: Float32Array;
  private smallIdx: number[] = [];
  private bigIdx: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    const all: [number, number, boolean][] = [
      ...BIG_PADS.map(([x, y]) => [x, y, true] as [number, number, boolean]),
      ...SMALL_PADS.map(([x, y]) => [x, y, false] as [number, number, boolean]),
    ];
    this.count = all.length;
    all.forEach(([x, y, b], i) => {
      this.positions.push(new THREE.Vector3(x, y, 0));
      this.big.push(b);
      this.on.push(1);
      (b ? this.bigIdx : this.smallIdx).push(i);
    });
    const baseGeo = new THREE.CylinderGeometry(1, 1.1, 4, 32);
    baseGeo.rotateX(Math.PI / 2);
    baseGeo.translate(0, 0, 2);
    const baseMat = new THREE.MeshStandardMaterial({ color: '#8b939e', metalness: 0.55, roughness: 0.32 });
    this.bases = new THREE.InstancedMesh(baseGeo, baseMat, this.count);
    this.bases.receiveShadow = true;
    all.forEach(([x, y, b], i) => {
      const r = b ? 150 : 75;
      this.m.compose(this.v.set(x, y, 0), this.q.identity(), this.s.set(r, r, 1));
      this.bases.setMatrixAt(i, this.m);
    });
    const coreMat = new THREE.MeshBasicMaterial({ color: BOOST_COLOR, toneMapped: false });
    const discGeo = new THREE.CylinderGeometry(52, 52, 4, 24);
    discGeo.rotateX(Math.PI / 2);
    this.discs = new THREE.InstancedMesh(discGeo, coreMat, this.smallIdx.length);
    this.orbs = new THREE.InstancedMesh(new THREE.OctahedronGeometry(55, 0), coreMat, this.bigIdx.length);
    // Aro de luz en el piso
    const glowMat = new THREE.MeshBasicMaterial({ map: padRingTexture(), color: BOOST_COLOR, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, this.count);
    this.glows.renderOrder = 1;
    // Halos de los pads grandes (un solo Points)
    const hp = new Float32Array(this.bigIdx.length * 3);
    this.haloAlpha = new Float32Array(this.bigIdx.length).fill(0.7);
    this.bigIdx.forEach((pi, k) => { const p = this.positions[pi]; hp.set([p.x, p.y, 110], k * 3); });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    hg.setAttribute('alpha', new THREE.BufferAttribute(this.haloAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.halos = new THREE.Points(hg, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: glowTexture() }, uColor: { value: new THREE.Color(BOOST_COLOR) }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float alpha; varying float vA; uniform float uScale;
        void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 420.0 * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
        void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uColor * t.rgb, t.a * vA); }`,
    }));
    this.halos.frustumCulled = false;
    this.group.add(this.bases, this.discs, this.orbs, this.glows, this.halos);
    this.update([], 0, 0);
  }

  setViewportHeight(h: number, fovY: number) {
    (this.halos.material as THREE.ShaderMaterial).uniforms.uScale.value = h / (2 * Math.tan((fovY * Math.PI) / 360));
  }

  update(active: boolean[], dt: number, time: number) {
    for (let i = 0; i < this.count; i++) {
      const target = active.length ? (active[i] ? 1 : 0) : 1;
      this.on[i] += (target - this.on[i]) * Math.min(1, dt * 8);
    }
    this.smallIdx.forEach((pi, k) => {
      const p = this.positions[pi];
      const s = this.on[pi] < 0.05 ? 0.0001 : 0.25 + this.on[pi] * 0.75;
      this.m.compose(this.v.set(p.x, p.y, 7 + Math.sin(time * 3 + pi) * 1.2), this.q.identity(), this.s.set(s, s, 1));
      this.discs.setMatrixAt(k, this.m);
    });
    this.bigIdx.forEach((pi, k) => {
      const p = this.positions[pi];
      const s = this.on[pi] < 0.05 ? 0.0001 : 0.2 + this.on[pi] * 0.8;
      this.q.setFromAxisAngle(this.v.set(0, 0, 1), time * 1.5 + k);
      this.m.compose(this.v.set(p.x, p.y, 110 + Math.sin(time * 2 + pi) * 10), this.q, this.s.set(s, s, s));
      this.orbs.setMatrixAt(k, this.m);
      this.haloAlpha[k] = 0.7 * this.on[pi];
    });
    this.q.identity();
    for (let i = 0; i < this.count; i++) {
      const p = this.positions[i];
      const r = (this.big[i] ? 330 : 170) * (0.6 + 0.4 * this.on[i]) * (1 + Math.sin(time * 4 + i) * 0.03);
      const vis = this.on[i] > 0.03;
      this.m.compose(this.v.set(p.x, p.y, 1.2), this.q, this.s.set(vis ? r : 0.0001, vis ? r : 0.0001, 1));
      this.glows.setMatrixAt(i, this.m);
    }
    this.discs.instanceMatrix.needsUpdate = true;
    this.orbs.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    (this.halos.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------- Sombras de contacto (un draw call para todos los autos) ----------

/** Sombra de contacto suave bajo cada auto (lo "apoya" en el piso). */
export class ContactShadows {
  mesh: THREE.InstancedMesh;
  private opacity: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 0, 1);
  private n = new THREE.Vector3();
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
    const geo = new THREE.PlaneGeometry(1, 1);
    this.opacity = new Float32Array(n);
    geo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(this.opacity, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTex: { value: tex } },
      vertexShader: /* glsl */ `
        attribute float aOpacity; varying float vO; varying vec2 vUv;
        void main() { vO = aOpacity; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying float vO; varying vec2 vUv;
        void main() { vec4 t = texture2D(uTex, vUv); gl_FragColor = vec4(0.0, 0.0, 0.0, t.a * vO); }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) this.set(i, false);
  }
  /** Ubica la sombra i sobre la superficie (punto, normal) con el tamaño y el rumbo del auto. */
  set(i: number, visible: boolean, px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 1, yaw = 0, len = 120, wid = 85, height = 0) {
    if (i >= this.opacity.length) return;
    if (!visible) {
      this.opacity[i] = 0;
      this.m.makeScale(0.0001, 0.0001, 1);
      this.mesh.setMatrixAt(i, this.m);
    } else {
      this.q.setFromUnitVectors(this.up, this.n.set(nx, ny, nz));
      this.q2.setFromAxisAngle(this.up, yaw);
      this.q.multiply(this.q2);
      const s = 1 + height / 400;
      this.m.compose(new THREE.Vector3(px + nx * 1.5, py + ny * 1.5, pz + nz * 1.5), this.q, new THREE.Vector3(len * 1.35 * s, wid * 1.5 * s, 1));
      this.mesh.setMatrixAt(i, this.m);
      this.opacity[i] = Math.max(0, 0.85 - height / 500);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.attributes.aOpacity as THREE.BufferAttribute).needsUpdate = true;
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
