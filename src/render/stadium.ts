// Estadio de estilo limpio: tribunas abiertas con butacas en mosaico de colores y público, visera blanca,
// torres de luz en las esquinas, carteles LED y pantallas en las cabeceras. Diseño propio.
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

interface Tier { d0: number; z0: number; rows: number; depth: number; rise: number }
interface Spot { x: number; y: number; z: number; yaw: number; team: number; color: THREE.Color; word: boolean }

// Contorno base de las tribunas (octógono alrededor de la arena y detrás de los arcos)
const SX = 4800, SY = 6500, SC = 9700;
const BASE = [
  new THREE.Vector2(SX, -(SC - SX)), new THREE.Vector2(SX, SC - SX), new THREE.Vector2(SC - SY, SY), new THREE.Vector2(-(SC - SY), SY),
  new THREE.Vector2(-SX, SC - SX), new THREE.Vector2(-SX, -(SC - SX)), new THREE.Vector2(-(SC - SY), -SY), new THREE.Vector2(SC - SY, -SY),
];
// Tramos del contorno: 0 lateral este, 1 esquina, 2 cabecera norte (roja), 3 esquina, 4 lateral oeste, 5 esquina, 6 cabecera sur (azul), 7 esquina
const TIERS: Tier[] = [
  { d0: 80, z0: 300, rows: 20, depth: 80, rise: 46 },
  { d0: 1760, z0: 1620, rows: 15, depth: 84, rise: 68 },
];
const ROWS = TIERS.reduce((n, t) => n + t.rows, 0);
const SEAT_W = 58;
/** Columnas de color por tramo en la grilla de butacas. */
const COLS = 256;
const ROOF_IN = 1250, ROOF_OUT = 3350, ROOF_Z_IN = 3750, ROOF_Z_OUT = 3250;
const BACK = 3100;
/** Tramos sin visera: las dos cabeceras, donde van las pantallas. */
const OPEN = [2, 6];
const roofZ = (d: number) => ROOF_Z_IN + ((d - ROOF_IN) / (ROOF_OUT - ROOF_IN)) * (ROOF_Z_OUT - ROOF_Z_IN);

const SEAT = { blue: '#2f7fe6', blueDark: '#1c56b5', red: '#ee3a55', redDark: '#bd2440', white: '#f4f6f9' };

/** Azar determinista por butaca (el estadio es idéntico en cada carga). */
function hash3(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Rótulo "TURBOGOL" armado con butacas blancas en las tribunas laterales (letras de 5×7 al doble de tamaño)
const GLYPHS: Record<string, string[]> = {
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
};
const WORD = 'TURBOGOL';
const GL_SCALE = 2, GL_GAP = 3;
const WORD_COLS = WORD.length * 5 * GL_SCALE + (WORD.length - 1) * GL_GAP;
function wordMask(col: number, rowFromTop: number): boolean {
  if (col < 0 || col >= WORD_COLS || rowFromTop < 0 || rowFromTop >= 7 * GL_SCALE) return false;
  const cell = 5 * GL_SCALE + GL_GAP;
  const li = Math.floor(col / cell), cx = col - li * cell;
  if (cx >= 5 * GL_SCALE) return false;
  return GLYPHS[WORD[li]][Math.floor(rowFromTop / GL_SCALE)][Math.floor(cx / GL_SCALE)] === '#';
}

/** Color de la butaca: cabeceras a rayas del equipo, laterales en degradé de mosaico azul→rojo y el rótulo en blanco. */
function seatColorAt(x: number, y: number, tier: number, row: number, rows: number, seg: number, r1: number, r2: number): string {
  if (tier === 0 && (seg === 0 || seg === 4)) {
    const tu = x > 0 ? -y : y; // sentido de lectura visto desde la cancha
    if (wordMask(Math.floor(tu / SEAT_W + WORD_COLS / 2), rows - 4 - row)) return SEAT.white;
  }
  if (tier === 1 && row >= rows - 2) return SEAT.white;
  if (seg === 2 || seg === 6) {
    if (tier === 0 && (row === rows - 6 || row === rows - 7)) return SEAT.white;
    const bar = Math.floor((x + 20000) / (SEAT_W * 7)) % 2 === 0;
    return y > 0 ? (bar ? SEAT.red : SEAT.redDark) : (bar ? SEAT.blue : SEAT.blueDark);
  }
  const m = y / 2600 + (r1 - 0.5) * 1.5;
  const dark = r2 < 0.32;
  return m > 0 ? (dark ? SEAT.redDark : SEAT.red) : (dark ? SEAT.blueDark : SEAT.blue);
}

const FONT = '"Archivo Variable", "Arial Black", Arial, sans-serif';

export class Stadium {
  group = new THREE.Group();
  private screenCanvas: HTMLCanvasElement;
  private screenTex: THREE.CanvasTexture;
  private ledCanvas: HTMLCanvasElement;
  private led: THREE.CanvasTexture;
  private crowdMat: THREE.ShaderMaterial;
  private flagMat: THREE.ShaderMaterial;
  private excite = 0;
  private exciteTarget = 0;
  private haloMat: THREE.ShaderMaterial | null = null;
  private lastScreen: { score: number[]; clock: string } = { score: [0, 0], clock: '5:00' };
  readonly peopleCount: number;

  constructor(theme: Theme) {
    const night = theme === 'noche';
    const base = BASE;
    const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, ...extra });
    const concMat = std(night ? '#8d95a1' : '#c9cfd8');
    const whiteMat = std(night ? '#b4bcc8' : '#f2f4f8', { roughness: 0.7 });
    const darkMat = std('#161d29', { roughness: 0.6, metalness: 0.2 });
    const concGeos: THREE.BufferGeometry[] = [];
    const whiteGeos: THREE.BufferGeometry[] = [];
    const darkGeos: THREE.BufferGeometry[] = [];
    const v3 = (p: THREE.Vector2, z: number) => new THREE.Vector3(p.x, p.y, z);

    // ---- Pasillos: fracciones fijas a lo largo de cada tramo (quedan alineados en todas las filas) ----
    const aisleFracs: number[][] = base.map((a, s) => {
      const b = base[(s + 1) % base.length];
      const n = Math.max(1, Math.round(a.distanceTo(b) / 1500));
      return Array.from({ length: n }, (_, i) => (i + 0.5) / n);
    });

    // ---- Gradas escalonadas, butacas (tiras con la grilla de colores) y lugares del público ----
    const grid = new Uint8Array(COLS * 8 * ROWS * 4);
    const seatPos: number[] = [], seatUv: number[] = [], seatInfo: number[] = [], seatIdx: number[] = [];
    const spots: Spot[] = [];
    const tmpCol = new THREE.Color();
    const quad = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, v0: number, v1: number, s: number, gi: number, n: number) => {
      const vi = seatPos.length / 3;
      for (const p of [p0, p1, p2, p3]) seatPos.push(p.x, p.y, p.z);
      seatUv.push(0, v0, 1, v0, 1, v1, 0, v1);
      for (let k = 0; k < 4; k++) seatInfo.push(s, gi, n);
      seatIdx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
    };
    let gi = 0;
    TIERS.forEach((t, ti) => {
      for (let i = 0; i < t.rows; i++, gi++) {
        const d = t.d0 + i * t.depth, z = t.z0 + i * t.rise;
        concGeos.push(band(base, d, z, d + t.depth, z, 500)); // pisada
        concGeos.push(band(base, d + t.depth, z, d + t.depth, z + t.rise, 500)); // contrahuella
        const front = offsetPoly(base, d + t.depth * 0.3);
        const mid = offsetPoly(base, d + t.depth * 0.5);
        const back = offsetPoly(base, d + t.depth * 0.7);
        for (let s = 0; s < base.length; s++) {
          const j = (s + 1) % base.length;
          const a = mid[s], b = mid[j];
          const len = a.distanceTo(b);
          const n = Math.max(1, Math.floor(len / SEAT_W));
          const dir = b.clone().sub(a).normalize();
          const yaw = Math.atan2(dir.x, -dir.y); // mira hacia adentro (normal izquierda del segmento CCW)
          const isAisle = (f: number) => aisleFracs[s].some((af) => Math.abs(f - af) * len < 46);
          // Grilla de colores de la fila
          for (let c = 0; c < COLS; c++) {
            const f = (c + 0.5) / COLS;
            const o = ((gi * 8 + s) * COLS + c) * 4;
            if (isAisle(f)) { grid[o + 3] = 0; continue; }
            const p = a.clone().lerp(b, f);
            tmpCol.set(seatColorAt(p.x, p.y, ti, i, t.rows, s, hash3(gi, s, c), hash3(gi + 97, s, c)));
            tmpCol.convertLinearToSRGB();
            grid[o] = Math.round(tmpCol.r * 255); grid[o + 1] = Math.round(tmpCol.g * 255); grid[o + 2] = Math.round(tmpCol.b * 255); grid[o + 3] = 255;
          }
          // Asiento (horizontal) y respaldo (vertical)
          quad(v3(front[s], z + 22), v3(front[j], z + 22), v3(back[j], z + 22), v3(back[s], z + 22), 0, 0.4, s, gi, n);
          quad(v3(back[s], z + 22), v3(back[j], z + 22), v3(back[j], z + 68), v3(back[s], z + 68), 0.4, 1, s, gi, n);
          // Lugares del público
          for (let k = 0; k < n; k++) {
            const f = (k + 0.5) / n;
            if (isAisle(f)) continue;
            const c = Math.min(COLS - 1, Math.floor(f * COLS));
            const o = ((gi * 8 + s) * COLS + c) * 4;
            const p = a.clone().lerp(b, f);
            const color = new THREE.Color().setRGB(grid[o] / 255, grid[o + 1] / 255, grid[o + 2] / 255, THREE.SRGBColorSpace);
            const word = grid[o] > 230 && grid[o + 1] > 230;
            spots.push({ x: p.x, y: p.y, z, yaw, team: p.y < -2600 ? 0 : p.y > 2600 ? 1 : -1, color, word });
          }
        }
      }
    });
    const seatTex = new THREE.DataTexture(grid, COLS * 8, ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    seatTex.colorSpace = THREE.SRGBColorSpace;
    seatTex.magFilter = seatTex.minFilter = THREE.NearestFilter;
    seatTex.needsUpdate = true;
    const seatGeo = new THREE.BufferGeometry();
    seatGeo.setAttribute('position', new THREE.Float32BufferAttribute(seatPos, 3));
    seatGeo.setAttribute('uv', new THREE.Float32BufferAttribute(seatUv, 2));
    seatGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(seatInfo, 3));
    seatGeo.setIndex(seatIdx);
    seatGeo.computeVertexNormals();
    const seatMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    seatMat.onBeforeCompile = (sh) => {
      sh.uniforms.uSeats = { value: seatTex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aInfo; varying vec3 vInfo; varying vec2 vSeatUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = aInfo; vSeatUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uSeats; varying vec3 vInfo; varying vec2 vSeatUv;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float sn = vInfo.z;
          float sfx = fract(vSeatUv.x * sn);
          float sfc = (floor(vSeatUv.x * sn) + 0.5) / sn;
          vec4 sc = texture2D(uSeats, vec2((vInfo.x + sfc) / 8.0, (vInfo.y + 0.5) / ${ROWS.toFixed(1)}));
          if (sc.a < 0.5 || sfx < 0.09 || sfx > 0.91) discard;
          diffuseColor.rgb = sc.rgb * (vSeatUv.y < 0.4 ? 0.84 : mix(0.9, 1.08, (vSeatUv.y - 0.4) / 0.6));`);
    };
    seatMat.customProgramCacheKey = () => 'turbogol-seats';
    const seats = new THREE.Mesh(seatGeo, seatMat);
    seats.receiveShadow = true;
    this.group.add(seats);

    // ---- Estructura: muro delantero, pasillo intermedio con palcos, parapeto y muro exterior ----
    const lowerTop = TIERS[0].d0 + TIERS[0].rows * TIERS[0].depth, lowerTopZ = TIERS[0].z0 + TIERS[0].rows * TIERS[0].rise;
    const upperTop = TIERS[1].d0 + TIERS[1].rows * TIERS[1].depth, upperTopZ = TIERS[1].z0 + TIERS[1].rows * TIERS[1].rise;
    whiteGeos.push(band(base, 0, 0, 0, 300, 500));
    concGeos.push(band(base, 0, 300, TIERS[0].d0, 300, 500));
    concGeos.push(band(base, lowerTop, lowerTopZ, TIERS[1].d0, lowerTopZ, 500));
    whiteGeos.push(band(base, TIERS[1].d0, lowerTopZ + 360, TIERS[1].d0, TIERS[1].z0, 500));
    whiteGeos.push(band(base, TIERS[1].d0 + 6, lowerTopZ, TIERS[1].d0 + 6, lowerTopZ + 40, 500));
    concGeos.push(band(base, upperTop, upperTopZ, BACK, upperTopZ, 500));
    whiteGeos.push(band(base, BACK, 0, BACK, upperTopZ + 260, 800));
    // Palcos vidriados entre los dos anillos
    const boxMat = new THREE.MeshStandardMaterial({ color: '#27384d', metalness: 0.6, roughness: 0.2, emissive: night ? '#4a5a70' : '#0d141d', side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(band(base, TIERS[1].d0, lowerTopZ + 40, TIERS[1].d0, lowerTopZ + 280, 900), boxMat));

    // ---- Visera blanca sobre laterales y esquinas, con vigas, columnas traseras y tira de luz ----
    // La cara de arriba recibe el sol; la de abajo es un cielorraso claro y parejo (sin teñirse del verde de la cancha)
    const roofGeo = band(base, ROOF_IN, ROOF_Z_IN, ROOF_OUT, ROOF_Z_OUT, 800, OPEN);
    const roof = new THREE.Mesh(roofGeo, std(night ? '#aab2be' : '#f6f8fb', { roughness: 0.7, side: THREE.BackSide, shadowSide: THREE.DoubleSide }));
    roof.castShadow = true;
    const ceiling = new THREE.Mesh(roofGeo, new THREE.MeshBasicMaterial({ color: night ? '#5b6472' : '#cfd5dd', side: THREE.FrontSide }));
    this.group.add(roof, ceiling);
    const trimMat = new THREE.MeshBasicMaterial({ color: night ? '#7b8492' : '#eef1f5', side: THREE.DoubleSide });
    const trimGeos: THREE.BufferGeometry[] = [];
    trimGeos.push(band(base, ROOF_IN, ROOF_Z_IN - 80, ROOF_IN, ROOF_Z_IN + 30, 800, OPEN));
    trimGeos.push(band(base, ROOF_OUT, ROOF_Z_OUT - 60, ROOF_OUT, ROOF_Z_OUT + 30, 800, OPEN));
    const rIn = offsetPoly(base, ROOF_IN), rOut = offsetPoly(base, ROOF_OUT), rBack = offsetPoly(base, BACK - 30), rMid = offsetPoly(base, 2300);
    for (let s = 0; s < base.length; s++) {
      const j = (s + 1) % base.length;
      const open = OPEN.includes(s);
      if (open) {
        // Remate de la visera en el borde de cada cabecera abierta
        for (const k of [s, j]) trimGeos.push(beam(v3(rIn[k], ROOF_Z_IN - 25), v3(rOut[k], ROOF_Z_OUT - 25), 36, 110));
        continue;
      }
      const n = Math.max(2, Math.round(rIn[s].distanceTo(rIn[j]) / 950));
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const pi = rIn[s].clone().lerp(rIn[j], f), po = rOut[s].clone().lerp(rOut[j], f);
        const pb = rBack[s].clone().lerp(rBack[j], f), pm = rMid[s].clone().lerp(rMid[j], f);
        trimGeos.push(beam(v3(pi, ROOF_Z_IN - 45), v3(po, ROOF_Z_OUT - 45), 28, 80)); // viga
        trimGeos.push(beam(v3(pb, upperTopZ), v3(pb, roofZ(BACK - 30) - 40), 44, 44)); // columna
        trimGeos.push(beam(v3(pb, upperTopZ + 120), v3(pm, roofZ(2300) - 70), 24, 24)); // tornapunta
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(trimGeos), trimMat));
    const underMat = new THREE.MeshBasicMaterial({ color: night ? '#fff4dd' : '#ffffff', toneMapped: !night, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(band(base, ROOF_IN + 70, roofZ(ROOF_IN + 70) - 50, ROOF_IN + 190, roofZ(ROOF_IN + 190) - 50, 900, OPEN), underMat));

    // ---- Torres de luz en las cuatro esquinas ----
    const lampMat = new THREE.MeshBasicMaterial({ color: night ? '#fffdf0' : '#ffffff', toneMapped: !night });
    const lampGeos: THREE.BufferGeometry[] = [];
    const haloPos: number[] = [];
    for (const s of [1, 3, 5, 7]) {
      const m = base[s].clone().add(base[(s + 1) % base.length]).multiplyScalar(0.5);
      const out = new THREE.Vector2(Math.sign(m.x), Math.sign(m.y)).normalize();
      const p = m.clone().addScaledVector(out, 3750);
      whiteGeos.push(new THREE.CylinderGeometry(70, 120, 5700, 10).rotateX(Math.PI / 2).translate(p.x, p.y, 2850));
      const head = new THREE.Object3D();
      head.position.set(p.x, p.y, 5900);
      head.lookAt(0, 0, -900);
      head.updateMatrix();
      darkGeos.push(new THREE.BoxGeometry(1560, 960, 110).applyMatrix4(head.matrix));
      for (let ix = 0; ix < 6; ix++) for (let iy = 0; iy < 4; iy++) {
        lampGeos.push(new THREE.PlaneGeometry(190, 170).translate((ix - 2.5) * 245, (iy - 1.5) * 225, 58).applyMatrix4(head.matrix));
      }
      haloPos.push(p.x - out.x * 60, p.y - out.y * 60, 5900);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(lampGeos), lampMat));
    if (night) {
      // Halos de las torres: un solo Points
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.Float32BufferAttribute(haloPos, 3));
      this.haloMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTex: { value: glowTexture() }, uScale: { value: 800 } },
        vertexShader: /* glsl */ `uniform float uScale; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(5200.0 * uScale / -mv.z, 1400.0); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform sampler2D uTex; void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * t.rgb, t.a * 0.9); }`,
      });
      const halos = new THREE.Points(hg, this.haloMat);
      halos.frustumCulled = false;
      this.group.add(halos);
    }

    // ---- Público (sobre parte de las butacas, con la ropa del color de su sector) ----
    const people = spots.filter((p, i) => p.word || hash3(i, 5, 11) < 0.5);
    this.peopleCount = people.length;
    this.crowdMat = this.buildCrowd(people, night);

    // ---- Banderas de las hinchadas (en las cabeceras y las esquinas) ----
    const steelGeos: THREE.BufferGeometry[] = [];
    const flagSpots = people.filter((p, i) => p.team >= 0 && !p.word && hash3(i, 3, 7) < 0.006);
    this.flagMat = this.buildFlags(flagSpots, steelGeos);

    // ---- Carteles LED a nivel de cancha (laterales y esquinas) + cinta entre los dos anillos ----
    this.ledCanvas = document.createElement('canvas');
    this.ledCanvas.width = 2048; this.ledCanvas.height = 64;
    this.led = new THREE.CanvasTexture(this.ledCanvas);
    this.led.colorSpace = THREE.SRGBColorSpace;
    this.led.wrapS = THREE.RepeatWrapping;
    this.led.anisotropy = 8;
    this.drawLed();
    const ledMat = new THREE.MeshBasicMaterial({ map: this.led, toneMapped: false, side: THREE.DoubleSide });
    const boardBase = [
      new THREE.Vector2(4240, -3900), new THREE.Vector2(4240, 3900), new THREE.Vector2(3000, 5250), new THREE.Vector2(-3000, 5250),
      new THREE.Vector2(-4240, 3900), new THREE.Vector2(-4240, -3900), new THREE.Vector2(-3000, -5250), new THREE.Vector2(3000, -5250),
    ];
    this.group.add(new THREE.Mesh(mergeGeometries([
      band(boardBase, 0, 0, 0, 110, 2600, [2, 6]),
      band(base, TIERS[1].d0 - 4, lowerTopZ + 280, TIERS[1].d0 - 4, lowerTopZ + 360, 2600),
    ]), ledMat));

    // ---- Pantallas gigantes en las cabeceras (una textura compartida, un draw call) ----
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 1024; this.screenCanvas.height = 384;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.anisotropy = 8;
    const scrGeos: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const y = s * (SY + BACK + 60);
      const pg = new THREE.PlaneGeometry(5200, 1950);
      pg.rotateX(Math.PI / 2);
      if (s < 0) pg.rotateZ(Math.PI);
      pg.translate(0, y - s * 90, 3950);
      scrGeos.push(pg);
      darkGeos.push(new THREE.BoxGeometry(5400, 160, 2150).translate(0, y, 3950));
      for (const x of [-1900, 1900]) darkGeos.push(new THREE.BoxGeometry(170, 170, 2900).translate(x, y + s * 40, 1450));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(scrGeos), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false })));
    this.updateScreens([0, 0], '5:00');
    // Las tipografías pueden terminar de cargar después: se redibujan carteles y pantallas
    void document.fonts?.load(`800 40px ${FONT}`).then(() => { this.drawLed(); this.updateScreens(this.lastScreen.score, this.lastScreen.clock); });

    // ---- Mallas fusionadas por material ----
    const steps = new THREE.Mesh(mergeGeometries(concGeos), concMat);
    steps.receiveShadow = true;
    const white = new THREE.Mesh(mergeGeometries(whiteGeos), whiteMat);
    white.receiveShadow = true;
    this.group.add(steps, white, new THREE.Mesh(mergeGeometries(darkGeos), darkMat));
    if (steelGeos.length) this.group.add(new THREE.Mesh(mergeGeometries(steelGeos), std('#dfe4ea', { roughness: 0.5, metalness: 0.3 })));

    // Playón entre la cancha y las tribunas, y terreno exterior
    const apronShape = new THREE.Shape(offsetPoly(base, 10));
    const apron = new THREE.Mesh(new THREE.ShapeGeometry(apronShape), std(night ? '#565e6a' : '#aab2bd', { roughness: 0.95, side: THREE.FrontSide }));
    apron.position.z = -6;
    apron.receiveShadow = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshStandardMaterial({ color: night ? '#0c1016' : '#7d8794', roughness: 1 }));
    ground.position.z = -30;
    this.group.add(apron, ground);
  }

  /** Cartel LED: fondo oscuro, texto blanco y separadores con los colores de los equipos. */
  private drawLed() {
    const g = this.ledCanvas.getContext('2d')!;
    const msgs = ['TURBOGOL', 'FÚTBOL CON AUTOS', 'LIGA TURBOGOL', 'TEMPORADA 1', 'TURBOGOL', 'ESTADIO CENTRAL'];
    g.fillStyle = '#0b0e14';
    g.fillRect(0, 0, 2048, 64);
    g.font = `800 34px ${FONT}`;
    g.textBaseline = 'middle';
    const step = 2048 / msgs.length;
    msgs.forEach((msg, i) => {
      g.fillStyle = i % 2 ? TEAM_COLORS[1] : TEAM_COLORS[0];
      g.fillRect(i * step + 4, 14, 8, 36);
      g.fillStyle = '#ffffff';
      g.fillText(msg, i * step + 26, 34, step - 40);
    });
    this.led.needsUpdate = true;
  }

  /** Público: sprites instanciados que miran a la cámara, con LOD por distancia, sombra de la visera y festejos. */
  private buildCrowd(people: Spot[], night: boolean) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const N = people.length;
    const offs = new Float32Array(N * 4), shirt = new Float32Array(N * 3), skin = new Float32Array(N * 3), hair = new Float32Array(N * 3), misc = new Float32Array(N * 4);
    const skins = ['#f1c7a5', '#e0ac85', '#c68e64', '#a06a45', '#7a4b2e', '#593621'].map((c) => new THREE.Color(c));
    const hairs = ['#1b1410', '#3b2414', '#6b4423', '#a07a4a', '#d8c08a', '#222222'].map((c) => new THREE.Color(c));
    const neutral = ['#f2f2f2', '#22262e', '#ffd166', '#bdc3c7', '#34495e'].map((c) => new THREE.Color(c));
    people.forEach((p, i) => {
      // Un poco hacia adelante del asiento y a la altura del torso; w = rumbo (para iluminar según el sol)
      offs.set([p.x + Math.cos(p.yaw) * 6, p.y + Math.sin(p.yaw) * 6, p.z + 26, p.yaw], i * 4);
      const sc0 = p.word || Math.random() < 0.8 ? p.color.clone().multiplyScalar(p.word ? 1 : 0.85 + Math.random() * 0.25) : neutral[Math.floor(Math.random() * neutral.length)];
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
        uLight: { value: night ? 0.8 : 1.05 },
        uDensity: { value: 1 },
        uSun: { value: new THREE.Vector3(0.6, 0.4, 0.7).normalize() },
        uRoofShadow: { value: night ? 0 : 1 },
        uA2C: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aOffset; attribute vec3 aShirt; attribute vec3 aSkin; attribute vec3 aHair; attribute vec4 aMisc;
        uniform float uTime; uniform float uExcite; uniform float uDensity; uniform vec3 uSun; uniform float uRoofShadow;
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying float vShade;
        // Distancia con signo al contorno base de las tribunas (positivo hacia afuera); w = 1 en las cabeceras
        vec2 octD(vec2 p) {
          vec2 q = abs(p);
          float side = max(q.x - ${SX.toFixed(1)}, (q.x + q.y - ${SC.toFixed(1)}) * 0.70710678);
          float end = q.y - ${SY.toFixed(1)};
          return vec2(max(side, end), step(side, end));
        }
        void main() {
          float variant = aMisc.x; float phase = aMisc.y; float scale = aMisc.z; float rnd = aMisc.w;
          vec3 base = aOffset.xyz;
          // LOD: lejos de la cámara se dibuja una fracción del público (la densidad visual se mantiene)
          float dist = length(cameraPosition - base);
          float keep = uDensity * mix(1.0, 0.6, smoothstep(9000.0, 16000.0, dist));
          if (rnd > keep) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          float s = scale * (1.0 + (1.0 - min(keep, 1.0)) * 0.3); // los que quedan, un poco más grandes
          float cheer = step(0.35, uExcite) * step(0.5, fract(phase * 0.731 + 0.2));
          float jump = uExcite * max(0.0, sin(uTime * 9.0 + phase)) * 22.0 + sin(uTime * 1.7 + phase) * 1.2;
          float v = variant + cheer * 4.0;
          vUv = vec2((uv.x + v) / 8.0, uv.y);
          vShirt = aShirt; vSkin = aSkin; vHair = aHair;
          vec3 toCam = cameraPosition - base; toCam.z = 0.0;
          vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), normalize(toCam)));
          vec3 p = base + right * position.x * 46.0 * s + vec3(0.0, 0.0, (position.y + 0.5) * 92.0 * s + jump);
          // Iluminación: lado al sol vs lado a la sombra, y sombra de la visera (rayo hacia el sol que la corta)
          vec2 facing = vec2(cos(aOffset.w), sin(aOffset.w));
          vec2 sunH = normalize(uSun.xy + vec2(0.0001));
          float lit = 0.8 + 0.2 * max(dot(facing, sunH), 0.0);
          float tanEl = uSun.z / max(length(uSun.xy), 0.001);
          float h = (${((ROOF_Z_IN + ROOF_Z_OUT) / 2).toFixed(1)} - base.z) / max(tanEl, 0.05);
          vec2 od = octD(base.xy + sunH * h);
          float underRoof = step(${ROOF_IN.toFixed(1)}, od.x) * step(od.x, ${ROOF_OUT.toFixed(1)}) * (1.0 - od.y) * uRoofShadow;
          vShade = (0.9 + 0.1 * fract(phase * 3.17)) * lit * mix(1.0, 0.55, underRoof);
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

  /** Pantalla gigante: marcador plano con los bloques de cada equipo y el reloj al centro. */
  updateScreens(score: number[], clock: string) {
    this.lastScreen = { score: [score[0], score[1]], clock };
    const g = this.screenCanvas.getContext('2d')!;
    g.fillStyle = '#0b0e14';
    g.fillRect(0, 0, 1024, 384);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = TEAM_COLORS[0];
    g.fillRect(28, 28, 300, 328);
    g.fillStyle = TEAM_COLORS[1];
    g.fillRect(696, 28, 300, 328);
    g.fillStyle = '#ffffff';
    g.font = `800 34px ${FONT}`;
    g.fillText('AZUL', 178, 70);
    g.fillText('ROJO', 846, 70);
    g.font = `800 210px ${FONT}`;
    g.fillText(String(score[0]), 178, 226);
    g.fillText(String(score[1]), 846, 226);
    g.font = `800 30px ${FONT}`;
    g.fillStyle = '#8d96a8';
    g.fillText('TURBOGOL', 512, 70);
    g.fillStyle = '#ffffff';
    g.font = `800 132px ${FONT}`;
    g.fillText(clock, 512, 216);
    g.fillStyle = '#ffc83d';
    g.fillRect(452, 318, 120, 8);
    this.screenTex.needsUpdate = true;
  }
}
