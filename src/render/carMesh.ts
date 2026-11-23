// Autos procedurales realistas: carrocerías esculpidas por "loft" (secciones suavizadas a lo largo del auto),
// pintura con barniz y acabados (brillante, mate, metalizado, perlado), calcomanías mapeadas por UV,
// cabina de vidrio con techo pintado, faros con carcasa, llantas de varios diseños, neumáticos, difusor y alerón.
// 6 diseños originales, cada uno escalado exactamente a su hitbox (los detalles son sólo visuales).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Finish, WheelId } from '../garage/cosmetics.ts';
import { paintDecal } from '../garage/decals.ts';
import type { CarLook } from '../garage/loadout.ts';
import type { CarBody } from '../sim/constants.ts';
import { BOOST_COLOR, SECONDARY_COLORS, TEAM_COLORS, TEAM_COLORS_LIGHT } from './palette.ts';

/** Sección clave: x ∈ [-0.5, 0.5] (atrás→adelante), top/bot como fracción de la altura, w como fracción del semiancho. */
type Key = [x: number, top: number, bot: number, w: number];

interface Design {
  body: Key[];
  cabin: Key[]; // bot se ignora (la cabina se apoya dentro de la carrocería)
  roof: [number, number]; // tramo x con techo pintado
  spoiler: 'wing' | 'lip' | 'none';
  n: number; // exponente de la superelipse (más alto = más cuadrado)
  scoop: boolean; // toma de aire en el capó
}

const DESIGNS: Record<string, Design> = {
  toro: {
    body: [[-0.52, 0.0, -0.3, 0.8], [-0.46, 0.13, -0.42, 0.96], [-0.3, 0.17, -0.45, 1], [-0.05, 0.15, -0.45, 1], [0.2, 0.07, -0.45, 0.98], [0.4, -0.04, -0.43, 0.92], [0.52, -0.15, -0.36, 0.78]],
    cabin: [[-0.37, 0.15, 0, 0.7], [-0.29, 0.43, 0, 0.74], [-0.12, 0.5, 0, 0.74], [0.02, 0.47, 0, 0.72], [0.19, 0.11, 0, 0.66]],
    roof: [-0.27, 0.0], spoiler: 'wing', n: 3.2, scoop: true,
  },
  flecha: {
    body: [[-0.52, 0.0, -0.32, 0.8], [-0.45, 0.1, -0.42, 0.96], [-0.25, 0.12, -0.45, 1], [0.05, 0.04, -0.45, 1], [0.3, -0.06, -0.45, 0.96], [0.45, -0.16, -0.42, 0.88], [0.53, -0.25, -0.36, 0.7]],
    cabin: [[-0.39, 0.1, 0, 0.66], [-0.3, 0.34, 0, 0.7], [-0.16, 0.41, 0, 0.7], [-0.02, 0.36, 0, 0.68], [0.15, 0.03, 0, 0.6]],
    roof: [-0.28, -0.04], spoiler: 'wing', n: 3, scoop: true,
  },
  lamina: {
    body: [[-0.52, 0.06, -0.3, 0.86], [-0.44, 0.12, -0.42, 1], [-0.2, 0.1, -0.45, 1], [0.1, 0.0, -0.45, 1], [0.35, -0.14, -0.45, 0.96], [0.53, -0.3, -0.4, 0.84]],
    cabin: [[-0.31, 0.1, 0, 0.56], [-0.22, 0.28, 0, 0.6], [-0.08, 0.33, 0, 0.6], [0.06, 0.25, 0, 0.56], [0.17, 0.0, 0, 0.5]],
    roof: [-0.2, -0.02], spoiler: 'lip', n: 3.6, scoop: false,
  },
  aguja: {
    body: [[-0.52, 0.04, -0.3, 0.8], [-0.44, 0.1, -0.4, 0.96], [-0.2, 0.08, -0.42, 1], [0.1, 0.0, -0.4, 0.86], [0.35, -0.1, -0.38, 0.6], [0.54, -0.2, -0.34, 0.34]],
    cabin: [[-0.31, 0.06, 0, 0.6], [-0.2, 0.38, 0, 0.62], [-0.06, 0.42, 0, 0.6], [0.06, 0.3, 0, 0.54], [0.17, 0.02, 0, 0.44]],
    roof: [-0.18, -0.02], spoiler: 'wing', n: 2.8, scoop: false,
  },
  mixto: {
    body: [[-0.52, 0.06, -0.3, 0.82], [-0.46, 0.14, -0.42, 0.96], [-0.25, 0.14, -0.44, 1], [0.05, 0.1, -0.44, 1], [0.3, 0.0, -0.44, 0.96], [0.45, -0.1, -0.42, 0.9], [0.53, -0.18, -0.36, 0.76]],
    cabin: [[-0.43, 0.14, 0, 0.7], [-0.36, 0.44, 0, 0.74], [-0.14, 0.48, 0, 0.74], [0.02, 0.44, 0, 0.72], [0.19, 0.08, 0, 0.64]],
    roof: [-0.34, -0.02], spoiler: 'wing', n: 3.2, scoop: true,
  },
  furgon: {
    body: [[-0.52, 0.1, -0.3, 0.86], [-0.47, 0.18, -0.42, 0.98], [-0.2, 0.2, -0.44, 1], [0.15, 0.16, -0.44, 1], [0.38, 0.08, -0.42, 0.96], [0.53, -0.02, -0.34, 0.86]],
    cabin: [[-0.49, 0.18, 0, 0.8], [-0.45, 0.48, 0, 0.84], [0.0, 0.5, 0, 0.84], [0.16, 0.46, 0, 0.82], [0.33, 0.12, 0, 0.74]],
    roof: [-0.43, 0.12], spoiler: 'lip', n: 4, scoop: false,
  },
};

/** Interpolación Catmull-Rom de las claves (suaviza la silueta). */
function sampleKeys(keys: Key[], x: number): Key {
  if (x <= keys[0][0]) return keys[0];
  if (x >= keys[keys.length - 1][0]) return keys[keys.length - 1];
  let i = 0;
  while (keys[i + 1][0] < x) i++;
  const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = (x - p1[0]) / (p2[0] - p1[0]);
  const cr = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return [x, cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2]), cr(p0[3], p1[3], p2[3], p3[3])];
}

/**
 * Superficie "loft": secciones de superelipse a lo largo de X. Los extremos se cierran con tapas redondeadas.
 * botScale estrecha la mitad inferior (deja ver las ruedas como en un auto real).
 * UV: u = (x + 0.55) / 1.1 (atrás→adelante), v = ángulo/2π desde abajo (0.25 lateral izq., 0.5 techo, 0.75 lateral der.).
 */
function loft(keys: Key[], L: number, W: number, H: number, n: number, opts: { stations?: number; ring?: number; fixedBot?: number; botScale?: number; x0?: number; x1?: number } = {}) {
  const stations = opts.stations ?? 30, ring = opts.ring ?? 32;
  const x0 = opts.x0 ?? keys[0][0], x1 = opts.x1 ?? keys[keys.length - 1][0];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const e = 2 / n;
  const sgnPow = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const capRounds = 3;
  const xs: { x: number; s: number }[] = [];
  for (let r = capRounds; r >= 1; r--) xs.push({ x: x0 - (r / capRounds) * 0.012, s: Math.sqrt(1 - (r / (capRounds + 0.5)) ** 2) });
  for (let i = 0; i <= stations; i++) xs.push({ x: x0 + ((x1 - x0) * i) / stations, s: 1 });
  for (let r = 1; r <= capRounds; r++) xs.push({ x: x1 + (r / capRounds) * 0.012, s: Math.sqrt(1 - (r / (capRounds + 0.5)) ** 2) });

  const cols = ring + 1;
  for (const { x, s } of xs) {
    const k = sampleKeys(keys, Math.min(Math.max(x, x0), x1));
    const top = k[1] * H, bot = (opts.fixedBot ?? k[2]) * H;
    const zc = (top + bot) / 2, hh = ((top - bot) / 2) * s, hw = (k[3] * W) / 2 * s;
    for (let j = 0; j <= ring; j++) {
      const th = -Math.PI / 2 + (j / ring) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const lower = sn < 0 ? (opts.botScale ?? 1) : 1;
      pos.push(x * L, sgnPow(c) * hw * (sn < 0 ? 1 - (1 - lower) * Math.abs(sn) : 1), zc + sgnPow(sn) * hh);
      uv.push((x + 0.55) / 1.1, j / ring);
    }
  }
  const rows = xs.length;
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < ring; j++) {
      const a = r * cols + j, b = a + 1, c = (r + 1) * cols + j, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Tapas
  const addCap = (row: number, flip: boolean) => {
    const center = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < ring; j++) { cx += pos[(row * cols + j) * 3]; cy += pos[(row * cols + j) * 3 + 1]; cz += pos[(row * cols + j) * 3 + 2]; }
    pos.push(cx / ring, cy / ring, cz / ring);
    uv.push(uv[row * cols * 2], 0.5);
    for (let j = 0; j < ring; j++) {
      const a = row * cols + j, b = a + 1;
      if (flip) idx.push(center, a, b); else idx.push(center, b, a);
    }
  };
  addCap(0, false);
  addCap(rows - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface CarVisual {
  group: THREE.Group;
  frontWheels: THREE.Object3D[];
  wheels: THREE.Object3D[];
  flame: THREE.Group;
  flameMats: THREE.MeshBasicMaterial[];
  bodyMat: THREE.MeshPhysicalMaterial;
  wheelRadius: number;
  rearOffset: THREE.Vector3;
  brakeLights: THREE.MeshBasicMaterial;
  look: CarLook;
  nameplate?: HTMLDivElement;
}

let tireTex: THREE.CanvasTexture | null = null;
function tireTexture() {
  if (tireTex) return tireTex;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 32;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1b1d22';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#0d0e11';
  for (let i = 0; i < 32; i++) g.fillRect(i * 8, 4, 4, 24);
  // Letras del flanco (marca ficticia)
  g.fillStyle = '#3a3d44';
  g.fillRect(0, 0, 256, 2);
  g.fillRect(0, 30, 256, 2);
  tireTex = new THREE.CanvasTexture(cv);
  tireTex.wrapS = THREE.RepeatWrapping;
  return tireTex;
}

/** Color de llanta según diseño. */
const RIM_COLORS: Record<WheelId, { color: string; metal: number; rough: number }> = {
  rayos6: { color: '#d8dee8', metal: 1, rough: 0.22 },
  cinco: { color: '#5b616b', metal: 0.9, rough: 0.3 },
  malla: { color: '#d6b25a', metal: 1, rough: 0.25 },
  tres: { color: '#1b1d22', metal: 0.6, rough: 0.35 },
  disco: { color: '#eef1f5', metal: 0.4, rough: 0.3 },
  turbina: { color: '#30353d', metal: 1, rough: 0.15 },
  estrella: { color: '#e8c55a', metal: 1, rough: 0.18 },
};

function spokes(parts: THREE.BufferGeometry[], count: number, rin: number, hw: number, width: number, thick: number, twist = 0, len = 0.95) {
  for (let i = 0; i < count; i++) {
    for (const side of [1, -1]) {
      const sp = new THREE.BoxGeometry(rin * len, thick, width);
      const m = new THREE.Matrix4().makeRotationY((i / count) * Math.PI * 2 + twist * side)
        .multiply(new THREE.Matrix4().makeTranslation(rin * len * 0.5, side * hw * 0.9, 0));
      sp.applyMatrix4(m);
      parts.push(sp);
    }
  }
}

/** Geometría de la llanta (sin neumático) para cada diseño. */
function rimGeometry(design: WheelId, rin: number, hw: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(rin * 0.26, rin * 0.26, hw * 2.1, 12));
  switch (design) {
    case 'rayos6': spokes(parts, 6, rin, hw, 2.6, 1.6); break;
    case 'cinco': spokes(parts, 5, rin, hw, 4.4, 1.8); break;
    case 'malla':
      spokes(parts, 10, rin, hw, 1.1, 1.2, 0.18);
      spokes(parts, 10, rin, hw, 1.1, 1.2, -0.18);
      for (const side of [1, -1]) {
        const inner = new THREE.TorusGeometry(rin * 0.55, 0.7, 6, 24);
        inner.rotateX(Math.PI / 2);
        inner.translate(0, side * hw * 0.92, 0);
        parts.push(inner);
      }
      break;
    case 'tres': spokes(parts, 3, rin, hw, 6.5, 2.2); break;
    case 'disco':
      for (const side of [1, -1]) {
        const disc = new THREE.CylinderGeometry(rin * 0.98, rin * 0.98, 0.8, 28);
        disc.translate(0, side * hw * 0.92, 0);
        parts.push(disc);
      }
      break;
    case 'turbina':
      for (const side of [1, -1]) {
        const disc = new THREE.CylinderGeometry(rin * 0.5, rin * 0.5, 0.8, 20);
        disc.translate(0, side * hw * 0.92, 0);
        parts.push(disc);
      }
      for (let i = 0; i < 14; i++) {
        for (const side of [1, -1]) {
          const vane = new THREE.BoxGeometry(rin * 0.5, 1.4, 2.2);
          const m = new THREE.Matrix4().makeRotationY((i / 14) * Math.PI * 2)
            .multiply(new THREE.Matrix4().makeTranslation(rin * 0.72, side * hw * 0.88, 0))
            .multiply(new THREE.Matrix4().makeRotationX(0.6 * side));
          vane.applyMatrix4(m);
          parts.push(vane);
        }
      }
      break;
    case 'estrella': {
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? rin * 0.96 : rin * 0.38;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      shape.closePath();
      for (const side of [1, -1]) {
        const star = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
        star.rotateX(Math.PI / 2);
        star.translate(0, side * hw * 0.92 + (side > 0 ? 0.6 : 0.6), 0);
        parts.push(star);
      }
      break;
    }
  }
  for (const side of [1, -1]) {
    const ring = new THREE.TorusGeometry(rin, 1.1, 8, 28);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, side * hw * 0.95, 0);
    parts.push(ring);
  }
  // Disco de freno visible detrás de los rayos
  const brake = new THREE.CylinderGeometry(rin * 0.72, rin * 0.72, 1.2, 20);
  parts.push(brake);
  return mergeGeometries(parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    q.deleteAttribute('uv');
    return q;
  }));
}

function buildWheel(r: number, design: WheelId, tireMat: THREE.Material, darkMat: THREE.Material) {
  const w = new THREE.Group();
  const spin = new THREE.Group();
  const hw = 7.5;
  const rin = r * 0.66;
  // Neumático: perfil redondeado girado alrededor del eje Y
  const prof = [
    new THREE.Vector2(rin, -hw), new THREE.Vector2(r - 2.2, -hw), new THREE.Vector2(r - 0.4, -hw + 1.4),
    new THREE.Vector2(r, -hw + 3), new THREE.Vector2(r, hw - 3), new THREE.Vector2(r - 0.4, hw - 1.4),
    new THREE.Vector2(r - 2.2, hw), new THREE.Vector2(rin, hw),
  ];
  const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), tireMat);
  tire.castShadow = true;
  spin.add(tire);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(rin, rin, hw * 1.6, 24, 1, true), darkMat);
  spin.add(dish);
  const rc = RIM_COLORS[design];
  const rimMat = new THREE.MeshStandardMaterial({ color: rc.color, metalness: rc.metal, roughness: rc.rough });
  const rim = new THREE.Mesh(rimGeometry(design, rin, hw), rimMat);
  spin.add(rim);
  w.add(spin);
  return w;
}

function paintMaterial(finish: Finish, map: THREE.Texture): THREE.MeshPhysicalMaterial {
  const base = { map, color: new THREE.Color(0.82, 0.82, 0.82) };
  switch (finish) {
    case 'mate':
      return new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.0, roughness: 0.8, clearcoat: 0, envMapIntensity: 0.5 });
    case 'metalizado':
      return new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.72, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 });
    case 'perlado':
      return new THREE.MeshPhysicalMaterial({
        ...base, metalness: 0.3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05,
        iridescence: 0.85, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 520], envMapIntensity: 0.85,
      });
    default:
      return new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.15, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.75 });
  }
}

export function defaultLook(team: number): CarLook {
  return {
    paint: TEAM_COLORS[team], secondary: SECONDARY_COLORS[0].hex, finish: 'brillante', decal: 'franjas', decalNumber: 7,
    wheel: 'rayos6', trail: 'clasica', explosion: 'clasica',
  };
}

export function buildCar(body: CarBody, team: number, lookIn?: CarLook): CarVisual {
  const look = lookIn ?? defaultLook(team);
  const group = new THREE.Group();
  const [L, W, H] = body.size;
  const [ox, , oz] = body.offset;
  const d = DESIGNS[body.id] ?? DESIGNS.toro;

  const decalTex = new THREE.CanvasTexture(paintDecal({ decal: look.decal, paint: look.paint, secondary: look.secondary, number: look.decalNumber, L, W, H }));
  decalTex.colorSpace = THREE.SRGBColorSpace;
  decalTex.anisotropy = 8;
  const bodyMat = paintMaterial(look.finish, decalTex);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0e1622', metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#16181d', metalness: 0.4, roughness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#0c0d10', metalness: 0.1, roughness: 0.8 });
  const carbonMat = new THREE.MeshPhysicalMaterial({ color: '#1a1c21', metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: '#d8dee8', metalness: 1, roughness: 0.18 });
  const tireMat = new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: 0.92, map: tireTexture() });
  const accentMat = new THREE.MeshPhysicalMaterial({ color: look.secondary, metalness: 0.3, roughness: 0.3, clearcoat: 1 });

  const chassis = new THREE.Group();
  chassis.position.set(ox, 0, oz);
  group.add(chassis);

  const bodyMesh = new THREE.Mesh(loft(d.body, L, W, H, d.n, { botScale: 0.86 }), bodyMat);
  bodyMesh.castShadow = true;
  chassis.add(bodyMesh);
  const cabin = new THREE.Mesh(loft(d.cabin, L, W, H, 2.6, { fixedBot: -0.05, stations: 20 }), glassMat);
  cabin.castShadow = true;
  chassis.add(cabin);
  // Techo pintado (sobre el vidrio): comparte el mapa de calcos (las franjas siguen por el techo)
  const roofKeys: Key[] = d.cabin.map(([x, t, , w]) => [x, t + 0.012, 0, w * 0.93]);
  const roof = new THREE.Mesh(loft(roofKeys, L, W, H, 3, { x0: d.roof[0], x1: d.roof[1], fixedBot: 0.3, stations: 14 }), bodyMat);
  roof.castShadow = true;
  chassis.add(roof);

  const front = sampleKeys(d.body, 0.5);
  const rearK = sampleKeys(d.body, -0.5);

  for (const sy of [-1, 1]) {
    // Zócalos laterales
    const sill = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, 2.5, H * 0.16), carbonMat);
    sill.position.set(-L * 0.04, sy * W * 0.44, -H * 0.36);
    chassis.add(sill);
    // Franja de acento (color secundario)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, 0.8, 1.4), accentMat);
    stripe.position.set(-L * 0.04, sy * W * 0.452, -H * 0.27);
    chassis.add(stripe);
    // Toma de aire lateral
    const intake = new THREE.Mesh(new THREE.BoxGeometry(L * 0.08, 1.6, H * 0.17), trimMat);
    intake.position.set(-L * 0.2, sy * W * 0.47, -H * 0.1);
    intake.rotation.z = sy * 0.12;
    chassis.add(intake);
    // Espejos
    const cab = sampleKeys(d.cabin, d.cabin[d.cabin.length - 1][0] - 0.06);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(5, 7, 4), bodyMat);
    mirror.position.set(cab[0] * L, sy * W * (cab[3] * 0.5 + 0.08), cab[1] * H * 0.4);
    const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1.2), darkMat);
    mirrorArm.position.set(cab[0] * L - 1, sy * W * (cab[3] * 0.5 + 0.03), cab[1] * H * 0.38);
    chassis.add(mirror, mirrorArm);
  }

  // Parrilla y splitter delantero
  const grille = new THREE.Mesh(new THREE.BoxGeometry(3, W * 0.52, H * 0.15), trimMat);
  grille.position.set(L * 0.505, 0, (front[2] + 0.11) * H);
  chassis.add(grille);
  for (let i = -2; i <= 2; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.2, W * 0.5, 0.5), chromeMat);
    slat.position.set(L * 0.512, 0, (front[2] + 0.11) * H + i * H * 0.024);
    chassis.add(slat);
  }
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(L * 0.07, W * 0.92, 1.1), carbonMat);
  splitter.position.set(L * 0.49, 0, front[2] * H - 0.5);
  chassis.add(splitter);

  // Toma de aire en el capó
  if (d.scoop) {
    const hk = sampleKeys(d.body, 0.22);
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(L * 0.14, W * 0.26, 2.6), bodyMat);
    scoop.position.set(L * 0.22, 0, hk[1] * H + 0.8);
    scoop.rotation.y = -0.1;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.8, W * 0.22, 1.6), trimMat);
    mouth.position.set(L * 0.29, 0, hk[1] * H + 1);
    chassis.add(scoop, mouth);
  }

  // Faros: carcasa oscura + lente emisiva + luz diurna (DRL)
  const lensMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e9f4ff', emissiveIntensity: 2.2, roughness: 0.1 });
  const drlMat = new THREE.MeshBasicMaterial({ color: '#dff0ff' });
  const brake = new THREE.MeshBasicMaterial({ color: '#7a0a18' });
  for (const sy of [-1, 1]) {
    const hx = L * 0.485, hy = sy * W * front[3] * 0.3, hz = (front[1] - 0.06) * H;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(5, W * 0.21, 4.2), carbonMat);
    housing.position.set(hx - 0.6, hy, hz);
    housing.rotation.y = -0.25;
    const lens = new THREE.Mesh(new THREE.BoxGeometry(5.2, W * 0.12, 2.4), lensMat);
    lens.position.set(hx, hy - sy * W * 0.03, hz + 0.2);
    lens.rotation.y = -0.25;
    const drl = new THREE.Mesh(new THREE.BoxGeometry(5.4, W * 0.19, 0.6), drlMat);
    drl.position.set(hx, hy, hz - 1.7);
    drl.rotation.y = -0.25;
    chassis.add(housing, lens, drl);
    // Faros traseros
    const tx = -L * 0.515, ty = sy * W * rearK[3] * 0.3, tz = (rearK[1] - 0.08) * H;
    const tHousing = new THREE.Mesh(new THREE.BoxGeometry(2, W * 0.25, 4.4), carbonMat);
    tHousing.position.set(tx + 0.5, ty, tz);
    const tLight = new THREE.Mesh(new THREE.BoxGeometry(2, W * 0.22, 2.6), brake);
    tLight.position.set(tx - 0.2, ty, tz);
    chassis.add(tHousing, tLight);
  }
  // Tira LED trasera de lado a lado
  const ledBar = new THREE.Mesh(new THREE.BoxGeometry(1.4, W * 0.5, 0.7), brake);
  ledBar.position.set(-L * 0.518, 0, (rearK[1] - 0.08) * H + 1.6);
  chassis.add(ledBar);

  // Alerón
  if (d.spoiler === 'wing') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(12, W * 0.92, 2.2), carbonMat);
    wing.position.set(-L * 0.46, 0, (rearK[1] + 0.3) * H);
    wing.rotation.y = 0.12;
    const gurney = new THREE.Mesh(new THREE.BoxGeometry(1, W * 0.92, 2), accentMat);
    gurney.position.set(-L * 0.46 - 6, 0, (rearK[1] + 0.3) * H + 1.4);
    chassis.add(wing, gurney);
    for (const sy of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 8), carbonMat);
      plate.position.set(-L * 0.46, sy * W * 0.46, (rearK[1] + 0.27) * H);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(3, 2, H * 0.22), darkMat);
      strut.position.set(-L * 0.44, sy * W * 0.25, (rearK[1] + 0.17) * H);
      chassis.add(plate, strut);
    }
  } else if (d.spoiler === 'lip') {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(6, W * 0.85, 2), carbonMat);
    lip.position.set(-L * 0.48, 0, (sampleKeys(d.body, -0.46)[1] + 0.02) * H);
    lip.rotation.y = 0.35;
    chassis.add(lip);
  }
  // Difusor con aletas
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(5, W * 0.72, H * 0.16), carbonMat);
  diffuser.position.set(-L * 0.51, 0, (rearK[2] + 0.06) * H);
  chassis.add(diffuser);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, H * 0.18), trimMat);
    fin.position.set(-L * 0.5, i * W * 0.13, (rearK[2] + 0.04) * H);
    chassis.add(fin);
  }

  // Ruedas (con la cara externa al ras de la carrocería) y pasarruedas oscuros
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const archMat = new THREE.MeshStandardMaterial({ color: '#0b0c0f', roughness: 0.9, side: THREE.DoubleSide });
  for (const [wd, isFront] of [[body.frontWheel, true], [body.backWheel, false]] as const) {
    for (const sy of [-1, 1]) {
      const w = buildWheel(wd.r, look.wheel, tireMat, darkMat);
      const y = Math.max(wd.y, W * 0.5 * 0.86 - 7.5);
      w.position.set(wd.x, sy * y, -17 + wd.r);
      group.add(w);
      wheels.push(w);
      if (isFront) frontWheels.push(w);
      // Medio cilindro abierto (arco superior) alrededor del eje de la rueda
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(wd.r + 2.6, wd.r + 2.6, 9, 20, 1, true, -Math.PI / 2, Math.PI), archMat);
      arch.position.set(wd.x, sy * (y - 3), -17 + wd.r);
      group.add(arch);
    }
  }

  // Llama del turbo (los colores dependen de la estela elegida; ver garage/fxRender)
  const flame = new THREE.Group();
  const rear = new THREE.Vector3(ox - L / 2 - 2, 0, oz + (rearK[2] + 0.16) * H);
  flame.position.copy(rear);
  const flameMats: THREE.MeshBasicMaterial[] = [];
  const mkCone = (r: number, len: number, col: string | THREE.Color, op: number, x: number) => {
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
    flameMats.push(mat);
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, len, 14, 1, true), mat);
    m.rotation.z = Math.PI / 2;
    m.position.x = x;
    return m;
  };
  flame.add(mkCone(10, 80, TEAM_COLORS_LIGHT[team], 0.55, -40), mkCone(6.5, 50, BOOST_COLOR, 0.85, -25), mkCone(3.5, 26, '#ffffff', 0.9, -13));
  flame.visible = false;
  group.add(flame);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 9.5, 9, 16, 1, true), chromeMat);
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.copy(rear).add(new THREE.Vector3(4, 0, 0));
  const nozzleCore = new THREE.Mesh(new THREE.CircleGeometry(7.2, 16), new THREE.MeshBasicMaterial({ color: '#ff9a3d' }));
  nozzleCore.rotation.y = -Math.PI / 2;
  nozzleCore.position.copy(rear).add(new THREE.Vector3(6, 0, 0));
  group.add(nozzle, nozzleCore);

  return { group, frontWheels, wheels, flame, flameMats, bodyMat, wheelRadius: body.backWheel.r, rearOffset: rear, brakeLights: brake, look };
}

/** Libera geometrías, materiales y texturas de un auto (garage, cambios de look). */
export function disposeCar(v: CarVisual) {
  v.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      const mm = mat as THREE.MeshStandardMaterial;
      if (mm.map && mm.map !== tireTex) mm.map.dispose();
      mat.dispose();
    }
  });
}
