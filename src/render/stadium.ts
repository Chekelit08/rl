// Estadio realista: cielo físico (día) o nocturno, tribunas en dos anillos con público, techo con reflectores,
// carteles LED alrededor de la cancha y pantallas gigantes. Diseño propio.
// Rendimiento: toda la estructura estática se fusiona por material (pocos draw calls).

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEAM_COLORS } from './palette.ts';

export type Theme = 'dia' | 'noche';

/** Cielo físico (Preetham + nubes) adaptado a nuestro mundo con Z hacia arriba. */
export function buildDaySky(sunDir: THREE.Vector3): Sky {
  const sky = new Sky();
  const mat = sky.material as THREE.ShaderMaterial;
  mat.fragmentShader = mat.fragmentShader.replace(
    'vec3 direction = normalize( vWorldPosition - cameraPosition );',
    'vec3 dz = normalize( vWorldPosition - cameraPosition ); vec3 direction = vec3( dz.x, dz.z, -dz.y );',
  );
  mat.needsUpdate = true;
  sky.scale.setScalar(450000);
  const u = mat.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  if (u.cloudCoverage) u.cloudCoverage.value = 0.35;
  if (u.cloudDensity) u.cloudDensity.value = 0.5;
  // Sky usa Y arriba: (x, y, z)_nuestro → (x, z, -y)
  u.sunPosition.value.set(sunDir.x, sunDir.z, -sunDir.y);
  return sky;
}

export function buildNightSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.z;
        vec3 col = mix(vec3(0.03, 0.05, 0.09), vec3(0.004, 0.008, 0.02), smoothstep(0.0, 0.7, h));
        col += vec3(0.10, 0.09, 0.08) * exp(-abs(h) * 12.0); // resplandor de la ciudad
        vec3 sp = floor(d * 500.0);
        col += vec3(0.85, 0.9, 1.0) * step(0.998, hash(sp)) * smoothstep(0.08, 0.5, h);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 24), mat);
}

// ---------- Texturas ----------
const texLoader = new THREE.TextureLoader();
function loadTex(name: string, repeat: [number, number], color = false): THREE.Texture {
  const t = texLoader.load(`${import.meta.env.BASE_URL}assets/textures/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Atlas de personas (8 variantes: 4 sentadas, 4 con brazos arriba).
 * Canales: R = remera, G = piel, B = pelo, A = alfa. La intensidad de cada canal incluye el sombreado.
 */
function peopleAtlas(): THREE.CanvasTexture {
  const CW = 256, CH = 512;
  const cv = document.createElement('canvas');
  cv.width = CW * 8; cv.height = CH;
  const g = cv.getContext('2d')!;
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
  };
  // Relleno con sombreado horizontal (más oscuro en los costados → volumen)
  const shaded = (ch: 'r' | 'g' | 'b', x0: number, x1: number, hi = 255, lo = 150) => {
    const grd = g.createLinearGradient(x0, 0, x1, 0);
    const c = (v: number) => (ch === 'r' ? `rgb(${v},0,0)` : ch === 'g' ? `rgb(0,${v},0)` : `rgb(0,0,${v})`);
    grd.addColorStop(0, c(lo)); grd.addColorStop(0.35, c(hi)); grd.addColorStop(0.65, c(hi)); grd.addColorStop(1, c(lo));
    return grd;
  };
  for (let v = 0; v < 8; v++) {
    const ox = v * CW;
    const armsUp = v >= 4;
    const k = v % 4;
    const bw = 92 + k * 8; // contextura
    const cx = ox + CW / 2;
    // Torso (remera) con sombreado y cuello en V
    g.fillStyle = shaded('r', cx - bw / 2, cx + bw / 2);
    rr(cx - bw / 2, 184, bw, 300, 36);
    g.fillStyle = 'rgb(0,0,0)';
    g.fillRect(cx - 2, 300, 4, 1); // costura (casi invisible, rompe la uniformidad)
    // Brazos
    for (const s of [-1, 1]) {
      if (armsUp) {
        g.fillStyle = shaded('r', cx + s * (bw / 2 - 8) - 16, cx + s * (bw / 2 - 8) + 16);
        rr(cx + s * (bw / 2 - 8) - 16, 80, 32, 140, 16);
        g.fillStyle = shaded('g', cx + s * (bw / 2 - 8) - 14, cx + s * (bw / 2 - 8) + 14, 235, 170);
        rr(cx + s * (bw / 2 - 8) - 14, 8 + k * 6, 28, 88, 14);
      } else {
        g.fillStyle = shaded('r', cx + s * (bw / 2 + 4) - 16, cx + s * (bw / 2 + 4) + 16, 220, 130);
        rr(cx + s * (bw / 2 + 4) - 16, 192, 32, 120, 16);
        g.fillStyle = shaded('g', cx + s * (bw / 2 + 4) - 14, cx + s * (bw / 2 + 4) + 14, 225, 160);
        rr(cx + s * (bw / 2 + 4) - 14, 300, 28, 92, 14);
      }
    }
    // Cuello y cabeza (con sombra en la mandíbula)
    g.fillStyle = 'rgb(0,190,0)';
    g.fillRect(cx - 18, 160, 36, 36);
    const hg = g.createRadialGradient(cx - 10, 112, 8, cx, 124, 56);
    hg.addColorStop(0, 'rgb(0,255,0)');
    hg.addColorStop(1, 'rgb(0,175,0)');
    g.fillStyle = hg;
    g.beginPath(); g.ellipse(cx, 124, 42, 50, 0, 0, Math.PI * 2); g.fill();
    // Ojos y boca (zonas más oscuras de piel)
    g.fillStyle = 'rgb(0,70,0)';
    g.fillRect(cx - 18, 118, 9, 6); g.fillRect(cx + 9, 118, 9, 6);
    g.fillStyle = 'rgb(0,110,0)';
    g.fillRect(cx - 10, 146, 20, 5);
    // Pelo / gorra
    g.fillStyle = shaded('b', cx - 48, cx + 48, 255, 190);
    g.beginPath();
    if (k === 2) { g.ellipse(cx, 92, 48, 24, 0, Math.PI, Math.PI * 2); g.fill(); g.fillRect(cx - 8, 84, 68, 14); } // gorra
    else if (k === 3) { g.ellipse(cx, 104, 46, 46, 0, Math.PI * 0.9, Math.PI * 2.1); g.fill(); g.fillRect(cx - 46, 104, 14, 70); g.fillRect(cx + 32, 104, 14, 70); } // pelo largo
    else { g.ellipse(cx, 100, 44, 32 + k * 4, 0, Math.PI * 0.95, Math.PI * 2.05); g.fill(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  return t;
}

/** Bandera de hinchada (atlas de 4 diseños por equipo). */
function flagAtlas(): THREE.CanvasTexture {
  const W = 256, H = 160;
  const cv = document.createElement('canvas');
  cv.width = W * 4; cv.height = H * 2;
  const g = cv.getContext('2d')!;
  for (let team = 0; team < 2; team++) {
    const c = TEAM_COLORS[team];
    for (let d = 0; d < 4; d++) {
      const x = d * W, y = team * H;
      g.fillStyle = c; g.fillRect(x, y, W, H);
      g.fillStyle = '#ffffff';
      if (d === 0) { g.fillRect(x, y + H / 3, W, H / 3); }
      else if (d === 1) { for (let i = 0; i < 4; i++) g.fillRect(x + i * 64 + 32, y, 32, H); }
      else if (d === 2) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + W, y + H); g.lineTo(x + W, y + H - 40); g.lineTo(x + 40, y); g.fill(); }
      else {
        g.font = 'italic 900 52px "Arial Black", Arial, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(team === 0 ? 'AZUL' : 'ROJO', x + W / 2, y + H / 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Desplaza un polígono convexo (CCW) hacia afuera con inglete. */
function offsetPoly(pts: THREE.Vector2[], d: number): THREE.Vector2[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const e1 = p.clone().sub(a).normalize(), e2 = b.clone().sub(p).normalize();
    const n1 = new THREE.Vector2(e1.y, -e1.x), n2 = new THREE.Vector2(e2.y, -e2.x);
    const bis = n1.clone().add(n2).normalize();
    const k = d / Math.max(0.3, bis.dot(n1));
    return p.clone().addScaledVector(bis, k);
  });
}

/** Banda entre dos contornos desplazados (alturas z0→z1), con UV repetida a lo largo. */
function band(base: THREE.Vector2[], d0: number, z0: number, d1: number, z1: number, tile: number, skip: number[] = []): THREE.BufferGeometry {
  const A = offsetPoly(base, d0), B = offsetPoly(base, d1);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let u = 0;
  const vlen = Math.hypot(d1 - d0, z1 - z0) / tile;
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length;
    const len = A[i].distanceTo(A[j]);
    const u2 = u + len / tile;
    if (!skip.includes(i)) {
      const vi = pos.length / 3;
      pos.push(A[i].x, A[i].y, z0, A[j].x, A[j].y, z0, B[j].x, B[j].y, z1, B[i].x, B[i].y, z1);
      uv.push(u, 0, u2, 0, u2, vlen, u, vlen);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    }
    u = u2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Caja orientada entre dos puntos (para barandas, pasamanos y bordes de escalón). */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(len, w, h);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

interface Ring { d0: number; z0: number; rows: number; depth: number; rise: number }

// Contorno base de las tribunas (octógono alrededor de la arena y detrás de los arcos)
const SX = 4800, SY = 6500, SC = 9700;
const BASE = [
  new THREE.Vector2(SX, -(SC - SX)), new THREE.Vector2(SX, SC - SX), new THREE.Vector2(SC - SY, SY), new THREE.Vector2(-(SC - SY), SY),
  new THREE.Vector2(-SX, SC - SX), new THREE.Vector2(-SX, -(SC - SX)), new THREE.Vector2(-(SC - SY), -SY), new THREE.Vector2(SC - SY, -SY),
];
const RINGS: Ring[] = [
  { d0: 80, z0: 300, rows: 16, depth: 78, rise: 52 },
  { d0: 1800, z0: 1950, rows: 18, depth: 82, rise: 70 },
];
const ROOF_IN = 700;

export class Stadium {
  group = new THREE.Group();
  private screenCanvas: HTMLCanvasElement;
  private screenTex: THREE.CanvasTexture;
  private led: THREE.CanvasTexture;
  private crowdMat: THREE.ShaderMaterial;
  private flagMat: THREE.ShaderMaterial;
  private excite = 0;
  private exciteTarget = 0;
  private haloMat: THREE.ShaderMaterial | null = null;
  readonly peopleCount: number;

  constructor(theme: Theme) {
    const night = theme === 'noche';
    const base = BASE;
    const concMat = new THREE.MeshStandardMaterial({
      map: loadTex('concreto_color.jpg', [1, 1], true), normalMap: loadTex('concreto_normal.jpg', [1, 1]),
      color: '#b9bcc2', roughness: 0.92, side: THREE.DoubleSide,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#232830', roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide });
    const steel = new THREE.MeshStandardMaterial({ color: '#7d8794', metalness: 0.85, roughness: 0.35 });
    const concGeos: THREE.BufferGeometry[] = [];
    const darkGeos: THREE.BufferGeometry[] = [];
    const steelGeos: THREE.BufferGeometry[] = [];
    const yellowGeos: THREE.BufferGeometry[] = [];

    // ---- Pasillos: fracciones fijas a lo largo de cada tramo (quedan alineados en todas las filas) ----
    const aisleFracs: number[][] = base.map((a, s) => {
      const b = base[(s + 1) % base.length];
      const n = Math.max(1, Math.round(a.distanceTo(b) / 1400));
      return Array.from({ length: n }, (_, i) => (i + 0.5) / n);
    });

    // ---- Gradas escalonadas (dos anillos) ----
    const seatSpots: { x: number; y: number; z: number; yaw: number; team: number }[] = [];
    for (const r of RINGS) {
      for (let i = 0; i < r.rows; i++) {
        const d = r.d0 + i * r.depth, z = r.z0 + i * r.rise;
        concGeos.push(band(base, d, z, d + r.depth, z, 500)); // pisada
        concGeos.push(band(base, d + r.depth, z, d + r.depth, z + r.rise, 500)); // contrahuella
        const line = offsetPoly(base, d + r.depth * 0.55);
        const edgeLine = offsetPoly(base, d + r.depth - 3);
        for (let s = 0; s < line.length; s++) {
          const a = line[s], b = line[(s + 1) % line.length];
          const len = a.distanceTo(b);
          const dir = b.clone().sub(a).normalize();
          const yaw = Math.atan2(dir.x, -dir.y); // mira hacia adentro (normal izquierda del segmento CCW)
          const n = Math.floor(len / 58);
          for (let k = 1; k < n; k++) {
            const f = k / n;
            if (aisleFracs[s].some((af) => Math.abs(f - af) * len < 48)) continue; // pasillo
            const p = a.clone().lerp(b, f);
            const team = p.y < -2600 ? 0 : p.y > 2600 ? 1 : -1;
            seatSpots.push({ x: p.x, y: p.y, z, yaw, team });
          }
          // Borde amarillo de los escalones del pasillo
          const ea = edgeLine[s], eb = edgeLine[(s + 1) % edgeLine.length];
          for (const af of aisleFracs[s]) {
            const c = ea.clone().lerp(eb, af);
            const dd = eb.clone().sub(ea).normalize();
            yellowGeos.push(beam(new THREE.Vector3(c.x - dd.x * 40, c.y - dd.y * 40, z + r.rise + 1), new THREE.Vector3(c.x + dd.x * 40, c.y + dd.y * 40, z + r.rise + 1), 6, 3));
          }
        }
      }
      // Pasamanos de los pasillos (un caño inclinado a cada lado)
      for (let s = 0; s < base.length; s++) {
        for (const af of aisleFracs[s]) {
          for (const side of [-1, 1]) {
            const pts: THREE.Vector3[] = [];
            for (let i = 0; i <= r.rows; i += 2) {
              const row = Math.min(i, r.rows - 1);
              const d = r.d0 + row * r.depth + r.depth * 0.5, z = r.z0 + row * r.rise + r.rise;
              const L = offsetPoly(base, d);
              const a = L[s], b = L[(s + 1) % L.length];
              const dir = b.clone().sub(a).normalize();
              const c = a.clone().lerp(b, af).addScaledVector(dir, side * 52);
              pts.push(new THREE.Vector3(c.x, c.y, z + 95));
            }
            for (let k = 0; k < pts.length - 1; k++) steelGeos.push(beam(pts[k], pts[k + 1], 5, 5));
            for (let k = 0; k < pts.length; k += 2) steelGeos.push(beam(pts[k].clone().setZ(pts[k].z - 95), pts[k], 4, 4));
          }
        }
      }
    }

    // ---- Estructura: muro delantero, pasillo, frente del anillo superior, pared trasera ----
    concGeos.push(band(base, 0, 0, 0, 300, 500));
    concGeos.push(band(base, 0, 300, 80, 300, 500));
    const lowerTop = RINGS[0].d0 + RINGS[0].rows * RINGS[0].depth;
    const lowerTopZ = RINGS[0].z0 + RINGS[0].rows * RINGS[0].rise;
    concGeos.push(band(base, lowerTop, lowerTopZ, 1800, lowerTopZ, 500));
    darkGeos.push(band(base, 1800, lowerTopZ, 1800, 1950, 500));
    const upperTop = RINGS[1].d0 + RINGS[1].rows * RINGS[1].depth;
    const upperTopZ = RINGS[1].z0 + RINGS[1].rows * RINGS[1].rise;
    concGeos.push(band(base, upperTop, upperTopZ, upperTop + 200, upperTopZ, 500));
    concGeos.push(band(base, upperTop + 200, 0, upperTop + 200, 5600, 800));

    // Barandas: vidrio + caño superior al frente de cada anillo
    const glassGeos: THREE.BufferGeometry[] = [];
    glassGeos.push(band(base, 40, 300, 40, 405, 800));
    glassGeos.push(band(base, RINGS[1].d0 - 30, 1950, RINGS[1].d0 - 30, 2060, 800));
    for (const [d, z] of [[40, 405], [RINGS[1].d0 - 30, 2060]] as const) {
      const L = offsetPoly(base, d);
      for (let s = 0; s < L.length; s++) steelGeos.push(beam(new THREE.Vector3(L[s].x, L[s].y, z), new THREE.Vector3(L[(s + 1) % L.length].x, L[(s + 1) % L.length].y, z), 8, 8));
    }

    // ---- Techo de chapa acanalada con cerchas ----
    const roofMat = new THREE.MeshStandardMaterial({
      map: loadTex('chapa_color.jpg', [1, 1], true), normalMap: loadTex('chapa_normal.jpg', [1, 1]),
      color: night ? '#8a919b' : '#e6e9ee', roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide,
      emissive: night ? '#20262e' : '#3a3f46',
    });
    const roof = new THREE.Mesh(band(base, ROOF_IN, 5150, upperTop + 300, 5550, 700), roofMat);
    roof.castShadow = true;
    this.group.add(roof);
    steelGeos.push(band(base, ROOF_IN - 10, 5000, ROOF_IN - 10, 5160, 600));
    // Cerchas radiales bajo el techo
    const inner = offsetPoly(base, ROOF_IN);
    const outer = offsetPoly(base, upperTop + 200);
    for (let s = 0; s < inner.length; s++) {
      const a0 = inner[s], a1 = inner[(s + 1) % inner.length], b0 = outer[s], b1 = outer[(s + 1) % inner.length];
      const n = Math.max(2, Math.round(a0.distanceTo(a1) / 1100));
      for (let k = 0; k <= n; k++) {
        const pi = a0.clone().lerp(a1, k / n), po = b0.clone().lerp(b1, k / n);
        steelGeos.push(beam(new THREE.Vector3(pi.x, pi.y, 5180), new THREE.Vector3(po.x, po.y, 5520), 40, 140));
        // Diagonal de la cercha
        steelGeos.push(beam(new THREE.Vector3(pi.x, pi.y, 5060), new THREE.Vector3(po.x, po.y, 5500), 20, 20));
      }
    }
    // Iluminación bajo el techo (paneles emisivos)
    const underGeos: THREE.BufferGeometry[] = [];
    underGeos.push(band(base, ROOF_IN + 900, 5228, ROOF_IN + 1000, 5244, 900));
    underGeos.push(band(base, ROOF_IN + 2100, 5375, ROOF_IN + 2200, 5390, 900));
    const underMat = new THREE.MeshBasicMaterial({ color: night ? '#fff4dd' : '#f2f2ea', toneMapped: !night, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(mergeGeometries(underGeos), underMat));

    // Reflectores en el borde del techo
    const lampMat = new THREE.MeshBasicMaterial({ color: '#f6fbff' });
    const lampLine = offsetPoly(base, 760);
    const lamps: THREE.BufferGeometry[] = [];
    const haloPos: number[] = [];
    for (let i = 0; i < lampLine.length; i++) {
      const a = lampLine[i], b = lampLine[(i + 1) % lampLine.length];
      const count = Math.max(2, Math.round(a.distanceTo(b) / 700));
      for (let k = 0; k < count; k++) {
        const p = a.clone().lerp(b, (k + 0.5) / count);
        const lamp = new THREE.BoxGeometry(200, 200, 40);
        lamp.lookAt(new THREE.Vector3(-p.x, -p.y, -4800).normalize());
        lamp.translate(p.x, p.y, 4960);
        lamps.push(lamp);
        haloPos.push(p.x, p.y, 4940);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(lamps), lampMat));
    if (night) {
      // Halos de los reflectores: un solo Points en lugar de decenas de sprites
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.Float32BufferAttribute(haloPos, 3));
      this.haloMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTex: { value: glowTexture() }, uScale: { value: 800 } },
        vertexShader: /* glsl */ `uniform float uScale; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(1300.0 * uScale / -mv.z, 900.0); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform sampler2D uTex; void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * t.rgb, t.a * 0.85); }`,
      });
      const halos = new THREE.Points(hg, this.haloMat);
      halos.frustumCulled = false;
      this.group.add(halos);
    }

    // Palcos vidriados entre los dos anillos
    const boxMat = new THREE.MeshStandardMaterial({ color: '#8fb3d1', metalness: 0.7, roughness: 0.15, emissive: night ? '#3a4a5c' : '#1d2630' });
    this.group.add(new THREE.Mesh(band(base, 1700, lowerTopZ + 160, 1700, 1940, 900), boxMat));

    // ---- Butacas y público ----
    const occupied = seatSpots.map(() => Math.random() < 0.82);
    const emptySeats = seatSpots.filter((_, i) => !occupied[i]);
    const seatGeo = mergeGeometries([
      new THREE.BoxGeometry(40, 44, 8).translate(0, 0, 18),
      new THREE.BoxGeometry(8, 44, 34).translate(-20, 0, 34),
    ]);
    const seats = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }), emptySeats.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), zAxis = new THREE.Vector3(0, 0, 1);
    const seatCols = [new THREE.Color('#1f5fbf'), new THREE.Color('#c0233f'), new THREE.Color('#5d6673')];
    emptySeats.forEach((s, i) => {
      q.setFromAxisAngle(zAxis, s.yaw);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, sc);
      seats.setMatrixAt(i, m);
      seats.setColorAt(i, seatCols[s.team < 0 ? 2 : s.team]);
    });
    this.group.add(seats);

    const people = seatSpots.filter((_, i) => occupied[i]);
    this.peopleCount = people.length;
    this.crowdMat = this.buildCrowd(people, night);

    // ---- Banderas de las hinchadas (en las tribunas detrás de cada arco y en las esquinas) ----
    const flagSpots = people.filter((p) => p.team >= 0 && Math.random() < 0.012);
    this.flagMat = this.buildFlags(flagSpots, steelGeos);

    // ---- Carteles LED a nivel de cancha (laterales y esquinas) + cinta del anillo superior ----
    const ledCanvas = document.createElement('canvas');
    ledCanvas.width = 2048; ledCanvas.height = 64;
    const lg = ledCanvas.getContext('2d')!;
    const msgs = ['TURBOGOL', 'FÚTBOL CON AUTOS', '¡VAMOS!', 'TEMPORADA 1', 'TURBOGOL', 'JUGÁ ONLINE PRONTO'];
    lg.fillStyle = '#05070c';
    lg.fillRect(0, 0, 2048, 64);
    lg.font = 'italic 900 40px "Arial Black", Arial, sans-serif';
    lg.textBaseline = 'middle';
    msgs.forEach((msg, i) => {
      lg.fillStyle = i % 2 ? TEAM_COLORS[1] : TEAM_COLORS[0];
      lg.fillRect(i * 341, 0, 6, 64);
      lg.fillStyle = '#ffffff';
      lg.fillText(msg, i * 341 + 20, 34);
    });
    this.led = new THREE.CanvasTexture(ledCanvas);
    this.led.colorSpace = THREE.SRGBColorSpace;
    this.led.wrapS = THREE.RepeatWrapping;
    this.led.anisotropy = 4;
    const ledMat = new THREE.MeshBasicMaterial({ map: this.led, toneMapped: false, side: THREE.DoubleSide });
    const boardBase = [
      new THREE.Vector2(4240, -3900), new THREE.Vector2(4240, 3900), new THREE.Vector2(3000, 5250), new THREE.Vector2(-3000, 5250),
      new THREE.Vector2(-4240, 3900), new THREE.Vector2(-4240, -3900), new THREE.Vector2(-3000, -5250), new THREE.Vector2(3000, -5250),
    ];
    this.group.add(new THREE.Mesh(mergeGeometries([
      band(boardBase, 0, 0, 0, 110, 2600, [2, 6]),
      band(base, 1690, lowerTopZ + 40, 1690, lowerTopZ + 150, 2600),
    ]), ledMat));

    // ---- Pantallas gigantes colgadas del techo (una textura compartida, un draw call) ----
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 1024; this.screenCanvas.height = 384;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const scrGeos: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const pg = new THREE.PlaneGeometry(3600, 1350);
      pg.rotateX(Math.PI / 2);
      if (s < 0) pg.rotateZ(Math.PI);
      pg.translate(0, s * 7100, 4100);
      scrGeos.push(pg);
      darkGeos.push(new THREE.BoxGeometry(3800, 140, 1520).translate(0, s * 7180, 4100));
      // Tensores que cuelgan la pantalla del techo
      for (const x of [-1700, 1700]) steelGeos.push(beam(new THREE.Vector3(x, s * 7180, 4860), new THREE.Vector3(x, s * 7180, 5300), 10, 10));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(scrGeos), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false })));
    this.updateScreens([0, 0], '5:00');

    // ---- Mallas fusionadas por material ----
    const steps = new THREE.Mesh(mergeGeometries(concGeos), concMat);
    steps.receiveShadow = true;
    this.group.add(steps);
    this.group.add(new THREE.Mesh(mergeGeometries(darkGeos), darkMat));
    this.group.add(new THREE.Mesh(mergeGeometries(steelGeos), steel));
    this.group.add(new THREE.Mesh(mergeGeometries(yellowGeos), new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 })));
    const glass = new THREE.Mesh(mergeGeometries(glassGeos), new THREE.MeshStandardMaterial({ color: '#cfe3f0', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    this.group.add(glass);

    // Terreno alrededor (fuera del estadio)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshStandardMaterial({ color: night ? '#0b100c' : '#55603f', roughness: 1 }));
    ground.position.z = -30;
    this.group.add(ground);
  }

  /** Público: sprites instanciados que miran a la cámara, con LOD por distancia, sombra del techo y festejos. */
  private buildCrowd(people: { x: number; y: number; z: number; yaw: number; team: number }[], night: boolean) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const N = people.length;
    const offs = new Float32Array(N * 4), shirt = new Float32Array(N * 3), skin = new Float32Array(N * 3), hair = new Float32Array(N * 3), misc = new Float32Array(N * 4);
    const skins = ['#f1c7a5', '#e0ac85', '#c68e64', '#a06a45', '#7a4b2e', '#593621'].map((c) => new THREE.Color(c));
    const hairs = ['#1b1410', '#3b2414', '#6b4423', '#a07a4a', '#d8c08a', '#222222'].map((c) => new THREE.Color(c));
    const neutral = ['#f2f2f2', '#1c1c1c', '#ffd166', '#3d9970', '#8e44ad', '#e67e22', '#bdc3c7', '#34495e', '#7f8c8d'].map((c) => new THREE.Color(c));
    const teamCol = [new THREE.Color('#2E8BFF'), new THREE.Color('#FF3355')];
    people.forEach((p, i) => {
      // Un poco hacia adelante del asiento y a la altura del torso; w = rumbo (para iluminar según el sol)
      offs.set([p.x + Math.cos(p.yaw) * 6, p.y + Math.sin(p.yaw) * 6, p.z + 20, p.yaw], i * 4);
      const fan = p.team >= 0 ? (Math.random() < 0.7 ? p.team : 1 - p.team) : Math.random() < 0.35 ? 0 : Math.random() < 0.55 ? 1 : -1;
      const sc0 = fan >= 0 && Math.random() < 0.85 ? teamCol[fan].clone().multiplyScalar(0.7 + Math.random() * 0.4) : neutral[Math.floor(Math.random() * neutral.length)];
      shirt.set([sc0.r, sc0.g, sc0.b], i * 3);
      const sk = skins[Math.floor(Math.random() * skins.length)];
      skin.set([sk.r, sk.g, sk.b], i * 3);
      const hr = hairs[Math.floor(Math.random() * hairs.length)];
      hair.set([hr.r, hr.g, hr.b], i * 3);
      misc.set([Math.floor(Math.random() * 4), Math.random() * Math.PI * 2, 0.9 + Math.random() * 0.22, Math.random()], i * 4);
    });
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 4));
    geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    geo.setAttribute('aHair', new THREE.InstancedBufferAttribute(hair, 3));
    geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
    geo.instanceCount = N;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: peopleAtlas() },
        uTime: { value: 0 },
        uExcite: { value: 0 },
        uLight: { value: night ? 0.78 : 1.0 },
        uDensity: { value: 1 },
        uSun: { value: new THREE.Vector3(0.6, 0.4, 0.7).normalize() },
        uRoofShadow: { value: night ? 0 : 1 },
        uA2C: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aOffset; attribute vec3 aShirt; attribute vec3 aSkin; attribute vec3 aHair; attribute vec4 aMisc;
        uniform float uTime; uniform float uExcite; uniform float uDensity; uniform vec3 uSun; uniform float uRoofShadow;
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying float vShade;
        // Distancia con signo al contorno base de las tribunas (positivo hacia afuera)
        float octD(vec2 p) {
          vec2 q = abs(p);
          return max(max(q.x - ${SX.toFixed(1)}, q.y - ${SY.toFixed(1)}), (q.x + q.y - ${SC.toFixed(1)}) * 0.70710678);
        }
        void main() {
          float variant = aMisc.x; float phase = aMisc.y; float scale = aMisc.z; float rnd = aMisc.w;
          vec3 base = aOffset.xyz;
          // LOD: lejos de la cámara se dibuja una fracción del público (la densidad visual se mantiene)
          float dist = length(cameraPosition - base);
          float keep = uDensity * mix(1.0, 0.55, smoothstep(9000.0, 16000.0, dist));
          if (rnd > keep) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          float s = scale * (1.0 + (1.0 - min(keep, 1.0)) * 0.35); // los que quedan, un poco más grandes
          float cheer = step(0.35, uExcite) * step(0.5, fract(phase * 0.731 + 0.2));
          float jump = uExcite * max(0.0, sin(uTime * 9.0 + phase)) * 22.0 + sin(uTime * 1.7 + phase) * 1.2;
          float v = variant + cheer * 4.0;
          vUv = vec2((uv.x + v) / 8.0, uv.y);
          vShirt = aShirt; vSkin = aSkin; vHair = aHair;
          vec3 toCam = cameraPosition - base; toCam.z = 0.0;
          vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), normalize(toCam)));
          vec3 p = base + right * position.x * 46.0 * s + vec3(0.0, 0.0, (position.y + 0.5) * 92.0 * s + jump);
          // Iluminación: lado al sol vs lado a la sombra, y sombra del techo (rayo hacia el sol que corta el techo)
          vec2 facing = vec2(cos(aOffset.w), sin(aOffset.w));
          vec2 sunH = normalize(uSun.xy + vec2(0.0001));
          float lit = 0.72 + 0.28 * max(dot(facing, sunH), 0.0);
          float tanEl = uSun.z / max(length(uSun.xy), 0.001);
          float h = (5300.0 - base.z) / max(tanEl, 0.05);
          float od = octD(base.xy + sunH * h);
          float underRoof = step(${ROOF_IN.toFixed(1)}, od) * step(od, 4500.0) * uRoofShadow;
          vShade = (0.86 + 0.14 * fract(phase * 3.17)) * lit * mix(1.0, 0.5, underRoof);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas; uniform float uLight; uniform float uA2C;
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying float vShade;
        void main() {
          vec4 t = texture2D(uAtlas, vUv);
          if (t.a < mix(0.5, 0.06, uA2C)) discard;
          vec3 c = vShirt * t.r + vSkin * t.g + vHair * t.b;
          gl_FragColor = vec4(c * vShade * uLight, t.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    mat.alphaToCoverage = true;
    const crowd = new THREE.Mesh(geo, mat);
    crowd.frustumCulled = false;
    crowd.userData.noAO = true;
    this.group.add(crowd);
    return mat;
  }

  /** Banderas instanciadas que flamean (más fuerte cuando el público festeja). */
  private buildFlags(spots: { x: number; y: number; z: number; yaw: number; team: number }[], steelGeos: THREE.BufferGeometry[]) {
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1, 10, 5);
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    const N = spots.length;
    const off = new Float32Array(N * 4), info = new Float32Array(N * 2);
    spots.forEach((s, i) => {
      off.set([s.x, s.y, s.z + 230, s.yaw + Math.PI / 2 + (Math.random() - 0.5) * 0.6], i * 4);
      info.set([s.team * 4 + Math.floor(Math.random() * 4), Math.random() * 6.28], i * 2);
      steelGeos.push(beam(new THREE.Vector3(s.x, s.y, s.z + 40), new THREE.Vector3(s.x, s.y, s.z + 300), 3, 3));
    });
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2));
    geo.instanceCount = N;
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTex: { value: flagAtlas() }, uTime: { value: 0 }, uExcite: { value: 0 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 aOff; attribute vec2 aInfo;
        uniform float uTime; uniform float uExcite;
        varying vec2 vUv; varying float vShade;
        void main() {
          float idx = aInfo.x; float ph = aInfo.y;
          vec2 cell = vec2(mod(idx, 4.0), floor(idx / 4.0));
          vUv = vec2((uv.x + cell.x) / 4.0, (uv.y + (1.0 - cell.y)) / 2.0);
          float u = uv.x; // 0 = asta
          float amp = 18.0 + uExcite * 26.0;
          float wave = sin(u * 7.0 - uTime * (4.0 + uExcite * 4.0) + ph) * amp * u;
          float swing = sin(uTime * (1.0 + uExcite * 3.0) + ph) * (0.25 + uExcite * 0.6);
          float ang = aOff.w + swing;
          vec3 along = vec3(cos(ang), sin(ang), 0.0);
          vec3 nrm = vec3(-sin(ang), cos(ang), 0.0);
          vec3 p = aOff.xyz + along * (position.x + 0.5) * 220.0 + vec3(0.0, 0.0, position.y * 140.0 - u * 18.0) + nrm * wave;
          vShade = 0.8 + 0.2 * cos(u * 7.0 - uTime * 4.0 + ph);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uLight; varying vec2 vUv; varying float vShade;
        void main() {
          vec4 t = texture2D(uTex, vUv);
          gl_FragColor = vec4(t.rgb * vShade * uLight, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const flags = new THREE.Mesh(geo, mat);
    flags.frustumCulled = false;
    flags.userData.noAO = true;
    this.group.add(flags);
    return mat;
  }

  /** Densidad del público (preset de calidad) y si hay MSAA (alpha-to-coverage). */
  setCrowdQuality(density: number, msaa: boolean) {
    this.crowdMat.uniforms.uDensity.value = density;
    this.crowdMat.uniforms.uA2C.value = msaa ? 1 : 0;
  }

  /** Dirección del sol (para la iluminación y la sombra del techo sobre el público). */
  setSun(dir: THREE.Vector3) {
    this.crowdMat.uniforms.uSun.value.copy(dir);
  }

  setViewportHeight(h: number, fovY: number) {
    if (this.haloMat) this.haloMat.uniforms.uScale.value = h / (2 * Math.tan((fovY * Math.PI) / 360));
  }

  /** El público festeja (0..1). */
  cheer(amount: number) { this.exciteTarget = Math.max(this.exciteTarget, amount); }

  update(time: number, dt = 1 / 60) {
    this.led.offset.x = (time * 0.04) % 1;
    this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 4);
    this.exciteTarget = Math.max(0, this.exciteTarget - dt * 0.25);
    this.crowdMat.uniforms.uTime.value = time;
    this.crowdMat.uniforms.uExcite.value = this.excite;
    this.flagMat.uniforms.uTime.value = time;
    this.flagMat.uniforms.uExcite.value = this.excite;
  }

  updateScreens(score: number[], clock: string) {
    const g = this.screenCanvas.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#06233f');
    grd.addColorStop(0.5, '#070b14');
    grd.addColorStop(1, '#3d0a18');
    g.fillStyle = grd;
    g.fillRect(0, 0, 1024, 384);
    g.font = 'italic 900 58px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.fillText('TURBOGOL', 512, 80);
    g.font = '900 170px "Arial Black", Arial, sans-serif';
    g.fillStyle = TEAM_COLORS[0];
    g.fillText(String(score[0]), 230, 300);
    g.fillStyle = TEAM_COLORS[1];
    g.fillText(String(score[1]), 794, 300);
    g.fillStyle = '#e8f1ff';
    g.font = '800 96px "Arial Black", Arial, sans-serif';
    g.fillText(clock, 512, 280);
    this.screenTex.needsUpdate = true;
  }
}
