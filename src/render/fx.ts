// Efectos especiales: estelas de cinta (supersónico, pelota), ondas expansivas y explosiones de gol.
// API pensada para que la personalización (garage) enchufe estilos de turbo y de explosión.

import * as THREE from 'three';

/**
 * Mezcla de los efectos luminosos: suman luz (uGain) y además tapan parte del fondo (uSolid).
 * De día, el aditivo puro se lava contra el césped y el cielo; de noche alcanza con muy poco.
 */
export const fxUniforms = { uSolid: { value: 0.6 }, uGain: { value: 1.7 } };

// ---------- Estilos personalizables ----------

/** Estilo de turbo de un auto (lo puede definir el garage). */
export interface BoostStyle {
  core: string; // color del núcleo caliente
  flame: string; // color de la llama
  tip: string; // color de la punta (al apagarse)
  smoke: boolean;
  sparks: boolean;
  /** 'fuego' llama clásica, 'plasma' más delgada y brillante, 'humo' casi sin llama, 'chispas' chisporroteo. */
  kind: 'fuego' | 'plasma' | 'humo' | 'chispas';
}

export const DEFAULT_BOOST: [BoostStyle, BoostStyle] = [
  { core: '#fff6d8', flame: '#ffb347', tip: '#4aa3ff', smoke: true, sparks: true, kind: 'fuego' },
  { core: '#fff6d8', flame: '#ffb347', tip: '#ff4d6a', smoke: true, sparks: true, kind: 'fuego' },
];

export type GoalFxKind = 'clasica' | 'nova' | 'confeti' | 'chispas';

/** Estilo de explosión de gol (lo puede definir el garage). */
export interface GoalFxStyle {
  kind: GoalFxKind;
  primary: string;
  secondary: string;
}

// ---------- Estelas de cinta ----------

const TRAIL_POINTS = 28;

interface TrailState {
  pts: THREE.Vector3[];
  ages: number[];
  width: number;
  color: THREE.Color;
  alpha: number;
  life: number;
  active: boolean; // si sigue recibiendo puntos
  lastPush: number;
}

/** Cintas que miran a la cámara, todas en un único draw call. */
export class TrailSystem {
  mesh: THREE.Mesh;
  private trails = new Map<string, TrailState>();
  private readonly maxTrails: number;
  private pos: Float32Array;
  private col: Float32Array;
  private alp: Float32Array;
  private uvy: Float32Array;

  constructor(maxTrails = 24) {
    this.maxTrails = maxTrails;
    const nv = maxTrails * TRAIL_POINTS * 2;
    this.pos = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 3);
    this.alp = new Float32Array(nv);
    this.uvy = new Float32Array(nv);
    const idx: number[] = [];
    for (let t = 0; t < maxTrails; t++) {
      for (let i = 0; i < TRAIL_POINTS - 1; i++) {
        const a = (t * TRAIL_POINTS + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    for (let v = 0; v < nv; v++) this.uvy[v] = v % 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('side', new THREE.BufferAttribute(this.uvy, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: fxUniforms,
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute float alpha; attribute float side;
        varying vec3 vCol; varying float vA; varying float vSide;
        void main() { vCol = color; vA = alpha; vSide = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uSolid; uniform float uGain;
        varying vec3 vCol; varying float vA; varying float vSide;
        void main() {
          float e = 1.0 - pow(abs(vSide * 2.0 - 1.0), 2.0);
          gl_FragColor = vec4(vCol * vA * e * uGain, min(1.0, vA * e) * uSolid);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** Agrega un punto a la estela `id` (la crea si no existe). */
  push(id: string, p: THREE.Vector3, width: number, color: THREE.Color, alpha: number, life = 0.35) {
    let t = this.trails.get(id);
    if (!t) {
      if (this.trails.size >= this.maxTrails) return;
      t = { pts: [], ages: [], width, color: color.clone(), alpha, life, active: true, lastPush: 0 };
      this.trails.set(id, t);
    }
    t.active = true;
    t.width = width;
    t.color.copy(color);
    t.alpha = alpha;
    t.life = life;
    const last = t.pts[0];
    if (last && last.distanceToSquared(p) < 9) return;
    t.pts.unshift(p.clone());
    t.ages.unshift(0);
    if (t.pts.length > TRAIL_POINTS) { t.pts.pop(); t.ages.pop(); }
  }

  /** Marca la estela como terminada (se desvanece sola). */
  end(id: string) {
    const t = this.trails.get(id);
    if (t) t.active = false;
  }

  clear() { this.trails.clear(); }

  update(dt: number, cam: THREE.Vector3) {
    let slot = 0;
    const side = new THREE.Vector3(), dir = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (const [id, t] of this.trails) {
      for (let i = 0; i < t.ages.length; i++) t.ages[i] += dt;
      while (t.ages.length && t.ages[t.ages.length - 1] > t.life) { t.ages.pop(); t.pts.pop(); }
      if (!t.active && t.pts.length < 2) { this.trails.delete(id); continue; }
      const base = slot * TRAIL_POINTS * 2;
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const v = (base + i * 2) * 3;
        if (i < t.pts.length && t.pts.length >= 2) {
          const p = t.pts[i];
          const q = t.pts[Math.min(i + 1, t.pts.length - 1)];
          const r = t.pts[Math.max(i - 1, 0)];
          dir.subVectors(r, q);
          if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
          toCam.subVectors(cam, p);
          side.crossVectors(dir, toCam).normalize();
          const k = 1 - t.ages[i] / t.life;
          const w = t.width * (0.35 + 0.65 * k) * (1 - i / TRAIL_POINTS * 0.5);
          this.pos[v] = p.x + side.x * w; this.pos[v + 1] = p.y + side.y * w; this.pos[v + 2] = p.z + side.z * w;
          this.pos[v + 3] = p.x - side.x * w; this.pos[v + 4] = p.y - side.y * w; this.pos[v + 5] = p.z - side.z * w;
          const a = Math.max(0, k) * t.alpha * (1 - i / TRAIL_POINTS);
          this.alp[base + i * 2] = a; this.alp[base + i * 2 + 1] = a;
          for (let c = 0; c < 2; c++) {
            const ci = (base + i * 2 + c) * 3;
            this.col[ci] = t.color.r; this.col[ci + 1] = t.color.g; this.col[ci + 2] = t.color.b;
          }
        } else {
          // Punto no usado: colapsa sobre el último válido para no dibujar nada
          const last = t.pts[t.pts.length - 1] ?? new THREE.Vector3();
          this.pos[v] = this.pos[v + 3] = last.x; this.pos[v + 1] = this.pos[v + 4] = last.y; this.pos[v + 2] = this.pos[v + 5] = last.z;
          this.alp[base + i * 2] = this.alp[base + i * 2 + 1] = 0;
        }
      }
      slot++;
      if (slot >= this.maxTrails) break;
    }
    // Apagar los slots sobrantes
    for (let s = slot; s < this.maxTrails; s++) {
      const base = s * TRAIL_POINTS * 2;
      for (let i = 0; i < TRAIL_POINTS * 2; i++) this.alp[base + i] = 0;
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------- Ondas expansivas ----------

interface Wave { mesh: THREE.Mesh; t: number; dur: number; r0: number; r1: number; alpha: number }

/** Anillos de luz que se expanden y desvanecen (gol, demolición, aterrizajes fuertes). */
export class Shockwaves {
  group = new THREE.Group();
  private pool: Wave[] = [];
  private geo = new THREE.RingGeometry(0.82, 1, 64, 1);

  private make(): Wave {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, ...fxUniforms },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; uniform float uSolid; uniform float uGain; varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;           // 0.82..1 en el anillo
          float band = smoothstep(0.82, 0.9, r) * (1.0 - smoothstep(0.93, 1.0, r));
          gl_FragColor = vec4(uColor * band * uAlpha * uGain, min(1.0, band * uAlpha) * uSolid);
        }`,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 3;
    this.group.add(mesh);
    const w: Wave = { mesh, t: 1, dur: 1, r0: 1, r1: 1, alpha: 1 };
    this.pool.push(w);
    return w;
  }

  /** normal: hacia dónde mira el plano del anillo. */
  spawn(at: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color, r0: number, r1: number, dur: number, alpha = 1) {
    const w = this.pool.find((x) => x.t >= x.dur) ?? (this.pool.length < 16 ? this.make() : this.pool[0]);
    w.t = 0; w.dur = dur; w.r0 = r0; w.r1 = r1; w.alpha = alpha;
    w.mesh.position.copy(at);
    w.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    (w.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(color);
    w.mesh.visible = true;
  }

  update(dt: number) {
    for (const w of this.pool) {
      if (w.t >= w.dur) { w.mesh.visible = false; continue; }
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      const e = 1 - Math.pow(1 - k, 3); // ease-out
      const r = w.r0 + (w.r1 - w.r0) * e;
      w.mesh.scale.set(r, r, r);
      (w.mesh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = w.alpha * (1 - k) * (1 - k);
    }
  }
}

// ---------- Bola de luz (destello volumétrico del gol) ----------

/** Esfera aditiva que crece y se apaga: da "volumen" al destello del gol. */
export class FlashBalls {
  group = new THREE.Group();
  private items: { mesh: THREE.Mesh; t: number; dur: number; r: number }[] = [];

  constructor() {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, ...fxUniforms },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uAlpha; uniform float uSolid; uniform float uGain; varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(max(dot(vN, vV), 0.0), 1.5); // más denso en el centro
            gl_FragColor = vec4(uColor * f * uAlpha * uGain, min(1.0, f * uAlpha) * uSolid * 0.8);
          }`,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.items.push({ mesh, t: 1, dur: 1, r: 1 });
    }
  }

  spawn(at: THREE.Vector3, color: THREE.Color, radius: number, dur: number) {
    const it = this.items.find((x) => x.t >= x.dur) ?? this.items[0];
    it.t = 0; it.dur = dur; it.r = radius;
    it.mesh.position.copy(at);
    (it.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(color);
    it.mesh.visible = true;
  }

  update(dt: number) {
    for (const it of this.items) {
      if (it.t >= it.dur) { it.mesh.visible = false; continue; }
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      const s = it.r * (0.3 + 0.7 * (1 - Math.pow(1 - k, 2)));
      it.mesh.scale.set(s, s, s);
      (it.mesh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 1.4 * (1 - k) * (1 - k);
    }
  }
}
