// Autos procedurales realistas: carrocerías esculpidas por "loft" (secciones suavizadas a lo largo del auto),
// pintura con barniz (clearcoat), cabina de vidrio con techo pintado, llantas, neumáticos, luces y alerón.
// 6 diseños originales, cada uno escalado exactamente a su hitbox.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarBody } from '../sim/constants.ts';
import { BOOST_COLOR, TEAM_COLORS, TEAM_COLORS_LIGHT } from './palette.ts';

/** Sección clave: x ∈ [-0.5, 0.5] (atrás→adelante), top/bot como fracción de la altura, w como fracción del semiancho. */
type Key = [x: number, top: number, bot: number, w: number];

interface Design {
  body: Key[];
  cabin: Key[]; // bot se ignora (la cabina se apoya dentro de la carrocería)
  roof: [number, number]; // tramo x con techo pintado
  spoiler: 'wing' | 'lip' | 'none';
  n: number; // exponente de la superelipse (más alto = más cuadrado)
}

const DESIGNS: Record<string, Design> = {
  toro: {
    body: [[-0.52, 0.0, -0.3, 0.8], [-0.46, 0.13, -0.42, 0.96], [-0.3, 0.17, -0.45, 1], [-0.05, 0.15, -0.45, 1], [0.2, 0.07, -0.45, 0.98], [0.4, -0.04, -0.43, 0.92], [0.52, -0.15, -0.36, 0.78]],
    cabin: [[-0.37, 0.15, 0, 0.7], [-0.29, 0.43, 0, 0.74], [-0.12, 0.5, 0, 0.74], [0.02, 0.47, 0, 0.72], [0.19, 0.11, 0, 0.66]],
    roof: [-0.27, 0.0], spoiler: 'wing', n: 3.2,
  },
  flecha: {
    body: [[-0.52, 0.0, -0.32, 0.8], [-0.45, 0.1, -0.42, 0.96], [-0.25, 0.12, -0.45, 1], [0.05, 0.04, -0.45, 1], [0.3, -0.06, -0.45, 0.96], [0.45, -0.16, -0.42, 0.88], [0.53, -0.25, -0.36, 0.7]],
    cabin: [[-0.39, 0.1, 0, 0.66], [-0.3, 0.34, 0, 0.7], [-0.16, 0.41, 0, 0.7], [-0.02, 0.36, 0, 0.68], [0.15, 0.03, 0, 0.6]],
    roof: [-0.28, -0.04], spoiler: 'wing', n: 3,
  },
  lamina: {
    body: [[-0.52, 0.06, -0.3, 0.86], [-0.44, 0.12, -0.42, 1], [-0.2, 0.1, -0.45, 1], [0.1, 0.0, -0.45, 1], [0.35, -0.14, -0.45, 0.96], [0.53, -0.3, -0.4, 0.84]],
    cabin: [[-0.31, 0.1, 0, 0.56], [-0.22, 0.28, 0, 0.6], [-0.08, 0.33, 0, 0.6], [0.06, 0.25, 0, 0.56], [0.17, 0.0, 0, 0.5]],
    roof: [-0.2, -0.02], spoiler: 'lip', n: 3.6,
  },
  aguja: {
    body: [[-0.52, 0.04, -0.3, 0.8], [-0.44, 0.1, -0.4, 0.96], [-0.2, 0.08, -0.42, 1], [0.1, 0.0, -0.4, 0.86], [0.35, -0.1, -0.38, 0.6], [0.54, -0.2, -0.34, 0.34]],
    cabin: [[-0.31, 0.06, 0, 0.6], [-0.2, 0.38, 0, 0.62], [-0.06, 0.42, 0, 0.6], [0.06, 0.3, 0, 0.54], [0.17, 0.02, 0, 0.44]],
    roof: [-0.18, -0.02], spoiler: 'wing', n: 2.8,
  },
  mixto: {
    body: [[-0.52, 0.06, -0.3, 0.82], [-0.46, 0.14, -0.42, 0.96], [-0.25, 0.14, -0.44, 1], [0.05, 0.1, -0.44, 1], [0.3, 0.0, -0.44, 0.96], [0.45, -0.1, -0.42, 0.9], [0.53, -0.18, -0.36, 0.76]],
    cabin: [[-0.43, 0.14, 0, 0.7], [-0.36, 0.44, 0, 0.74], [-0.14, 0.48, 0, 0.74], [0.02, 0.44, 0, 0.72], [0.19, 0.08, 0, 0.64]],
    roof: [-0.34, -0.02], spoiler: 'wing', n: 3.2,
  },
  furgon: {
    body: [[-0.52, 0.1, -0.3, 0.86], [-0.47, 0.18, -0.42, 0.98], [-0.2, 0.2, -0.44, 1], [0.15, 0.16, -0.44, 1], [0.38, 0.08, -0.42, 0.96], [0.53, -0.02, -0.34, 0.86]],
    cabin: [[-0.49, 0.18, 0, 0.8], [-0.45, 0.48, 0, 0.84], [0.0, 0.5, 0, 0.84], [0.16, 0.46, 0, 0.82], [0.33, 0.12, 0, 0.74]],
    roof: [-0.43, 0.12], spoiler: 'lip', n: 4,
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
 */
function loft(keys: Key[], L: number, W: number, H: number, n: number, opts: { stations?: number; ring?: number; fixedBot?: number; botScale?: number; x0?: number; x1?: number } = {}) {
  const stations = opts.stations ?? 30, ring = opts.ring ?? 32;
  const x0 = opts.x0 ?? keys[0][0], x1 = opts.x1 ?? keys[keys.length - 1][0];
  const pos: number[] = [];
  const idx: number[] = [];
  const e = 2 / n;
  const sgnPow = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const capRounds = 3;
  const xs: { x: number; s: number }[] = [];
  for (let r = capRounds; r >= 1; r--) xs.push({ x: x0 - (r / capRounds) * 0.012, s: Math.sqrt(1 - (r / (capRounds + 0.5)) ** 2) });
  for (let i = 0; i <= stations; i++) xs.push({ x: x0 + ((x1 - x0) * i) / stations, s: 1 });
  for (let r = 1; r <= capRounds; r++) xs.push({ x: x1 + (r / capRounds) * 0.012, s: Math.sqrt(1 - (r / (capRounds + 0.5)) ** 2) });

  for (const { x, s } of xs) {
    const k = sampleKeys(keys, Math.min(Math.max(x, x0), x1));
    const top = k[1] * H, bot = (opts.fixedBot ?? k[2]) * H;
    const zc = (top + bot) / 2, hh = ((top - bot) / 2) * s, hw = (k[3] * W) / 2 * s;
    for (let j = 0; j < ring; j++) {
      const th = (j / ring) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const lower = sn < 0 ? (opts.botScale ?? 1) : 1;
      pos.push(x * L, sgnPow(c) * hw * (sn < 0 ? 1 - (1 - lower) * Math.abs(sn) : 1), zc + sgnPow(sn) * hh);
    }
  }
  const rows = xs.length;
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < ring; j++) {
      const a = r * ring + j, b = r * ring + ((j + 1) % ring), c = (r + 1) * ring + j, d = (r + 1) * ring + ((j + 1) % ring);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Tapas
  const addCap = (row: number, flip: boolean) => {
    const center = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < ring; j++) { cx += pos[(row * ring + j) * 3]; cy += pos[(row * ring + j) * 3 + 1]; cz += pos[(row * ring + j) * 3 + 2]; }
    pos.push(cx / ring, cy / ring, cz / ring);
    for (let j = 0; j < ring; j++) {
      const a = row * ring + j, b = row * ring + ((j + 1) % ring);
      if (flip) idx.push(center, a, b); else idx.push(center, b, a);
    }
  };
  addCap(0, false);
  addCap(rows - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface CarVisual {
  group: THREE.Group;
  frontWheels: THREE.Object3D[];
  wheels: THREE.Object3D[];
  flame: THREE.Group;
  bodyMat: THREE.MeshPhysicalMaterial;
  wheelRadius: number;
  rearOffset: THREE.Vector3;
  brakeLights: THREE.MeshBasicMaterial;
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
  tireTex = new THREE.CanvasTexture(cv);
  tireTex.wrapS = THREE.RepeatWrapping;
  return tireTex;
}

function buildWheel(r: number, rimMat: THREE.Material, tireMat: THREE.Material, darkMat: THREE.Material) {
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
  // Llanta de rayos
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(rin, rin, hw * 1.6, 24, 1, true), darkMat);
  spin.add(dish);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(rin * 0.28, rin * 0.28, hw * 2.1, 12));
  for (let i = 0; i < 6; i++) {
    for (const side of [1, -1]) {
      const sp = new THREE.BoxGeometry(rin * 0.95, 1.6, 2.6);
      const m = new THREE.Matrix4().makeRotationY((i / 6) * Math.PI * 2)
        .multiply(new THREE.Matrix4().makeTranslation(rin * 0.45, side * hw * 0.9, 0));
      sp.applyMatrix4(m);
      parts.push(sp);
    }
  }
  for (const side of [1, -1]) {
    const ring = new THREE.TorusGeometry(rin, 1.1, 8, 28);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, side * hw * 0.95, 0);
    parts.push(ring);
  }
  const rim = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), rimMat);
  spin.add(rim);
  w.add(spin);
  return w;
}

export function buildCar(body: CarBody, team: number): CarVisual {
  const group = new THREE.Group();
  const [L, W, H] = body.size;
  const [ox, , oz] = body.offset;
  const d = DESIGNS[body.id] ?? DESIGNS.toro;

  const color = new THREE.Color(TEAM_COLORS[team]);
  const paint = color.clone().multiplyScalar(0.62);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: paint, metalness: 0.2, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.7,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0e1622', metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#16181d', metalness: 0.4, roughness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#0c0d10', metalness: 0.1, roughness: 0.8 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#d8dee8', metalness: 1, roughness: 0.22 });
  const tireMat = new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: 0.92, map: tireTexture() });
  const accentMat = new THREE.MeshPhysicalMaterial({ color: TEAM_COLORS_LIGHT[team], metalness: 0.3, roughness: 0.3, clearcoat: 1 });

  const chassis = new THREE.Group();
  chassis.position.set(ox, 0, oz);
  group.add(chassis);

  const bodyMesh = new THREE.Mesh(loft(d.body, L, W, H, d.n, { botScale: 0.86 }), bodyMat);
  bodyMesh.castShadow = true;
  chassis.add(bodyMesh);
  const cabin = new THREE.Mesh(loft(d.cabin, L, W, H, 2.6, { fixedBot: -0.05, stations: 20 }), glassMat);
  cabin.castShadow = true;
  chassis.add(cabin);
  // Techo pintado (sobre el vidrio)
  const roofKeys: Key[] = d.cabin.map(([x, t, , w]) => [x, t + 0.012, 0, w * 0.93]);
  const roof = new THREE.Mesh(loft(roofKeys, L, W, H, 3, { x0: d.roof[0], x1: d.roof[1], fixedBot: 0.3, stations: 14 }), bodyMat);
  roof.castShadow = true;
  chassis.add(roof);

  // Zócalos laterales y paragolpes en plástico negro
  for (const sy of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, 2.5, H * 0.16), trimMat);
    sill.position.set(-L * 0.04, sy * W * 0.44, -H * 0.36);
    chassis.add(sill);
    // Franja de acento
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 1.2, 2.2), accentMat);
    stripe.position.set(0, sy * W * 0.485, -H * 0.12);
    chassis.add(stripe);
    // Espejos
    const cab = sampleKeys(d.cabin, d.cabin[d.cabin.length - 1][0] - 0.06);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(5, 7, 4), bodyMat);
    mirror.position.set(cab[0] * L, sy * W * (cab[3] * 0.5 + 0.08), cab[1] * H * 0.4);
    chassis.add(mirror);
  }
  const front = sampleKeys(d.body, 0.5);
  const rearK = sampleKeys(d.body, -0.5);
  // Toma de aire frontal
  const grille = new THREE.Mesh(new THREE.BoxGeometry(3, W * 0.5, H * 0.14), trimMat);
  grille.position.set(L * 0.505, 0, (front[2] + 0.1) * H);
  chassis.add(grille);
  // Luces
  const head = new THREE.MeshBasicMaterial({ color: '#f2f8ff' });
  const brake = new THREE.MeshBasicMaterial({ color: '#c8102e' });
  for (const sy of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(5, W * 0.18, 3.2), head);
    h.position.set(L * 0.49, sy * W * front[3] * 0.3, (front[1] - 0.06) * H);
    h.rotation.y = -0.25;
    const t = new THREE.Mesh(new THREE.BoxGeometry(2, W * 0.22, 3.5), brake);
    t.position.set(-L * 0.515, sy * W * rearK[3] * 0.3, (rearK[1] - 0.08) * H);
    chassis.add(h, t);
  }
  // Alerón
  if (d.spoiler === 'wing') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(12, W * 0.92, 2.2), darkMat);
    wing.position.set(-L * 0.46, 0, (rearK[1] + 0.3) * H);
    wing.rotation.y = 0.12;
    chassis.add(wing);
    for (const sy of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 8), darkMat);
      plate.position.set(-L * 0.46, sy * W * 0.46, (rearK[1] + 0.27) * H);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(3, 2, H * 0.22), darkMat);
      strut.position.set(-L * 0.44, sy * W * 0.25, (rearK[1] + 0.17) * H);
      chassis.add(plate, strut);
    }
  } else if (d.spoiler === 'lip') {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(6, W * 0.85, 2), bodyMat);
    lip.position.set(-L * 0.48, 0, (sampleKeys(d.body, -0.46)[1] + 0.02) * H);
    lip.rotation.y = 0.35;
    chassis.add(lip);
  }
  // Difusor / tobera del turbo
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(4, W * 0.7, H * 0.16), trimMat);
  diffuser.position.set(-L * 0.51, 0, (rearK[2] + 0.06) * H);
  chassis.add(diffuser);

  // Ruedas (con la cara externa al ras de la carrocería)
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  for (const [wd, isFront] of [[body.frontWheel, true], [body.backWheel, false]] as const) {
    for (const sy of [-1, 1]) {
      const w = buildWheel(wd.r, rimMat, tireMat, darkMat);
      const y = Math.max(wd.y, W * 0.5 * 0.86 - 7.5);
      w.position.set(wd.x, sy * y, -17 + wd.r);
      group.add(w);
      wheels.push(w);
      if (isFront) frontWheels.push(w);
    }
  }

  // Llama del turbo
  const flame = new THREE.Group();
  const rear = new THREE.Vector3(ox - L / 2 - 2, 0, oz + (rearK[2] + 0.16) * H);
  flame.position.copy(rear);
  const mkCone = (r: number, len: number, col: string | THREE.Color, op: number, x: number) => {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(r, len, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.rotation.z = Math.PI / 2;
    m.position.x = x;
    return m;
  };
  flame.add(mkCone(10, 80, TEAM_COLORS_LIGHT[team], 0.55, -40), mkCone(6.5, 50, BOOST_COLOR, 0.85, -25), mkCone(3.5, 26, '#ffffff', 0.9, -13));
  flame.visible = false;
  group.add(flame);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 9.5, 9, 16, 1, true), rimMat);
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.copy(rear).add(new THREE.Vector3(4, 0, 0));
  const nozzleCore = new THREE.Mesh(new THREE.CircleGeometry(7.2, 16), new THREE.MeshBasicMaterial({ color: '#ff9a3d' }));
  nozzleCore.rotation.y = -Math.PI / 2;
  nozzleCore.position.copy(rear).add(new THREE.Vector3(6, 0, 0));
  group.add(nozzle, nozzleCore);

  // Sombra de contacto suave bajo el auto (asienta el auto en el piso)
  return { group, frontWheels, wheels, flame, bodyMat, wheelRadius: body.backWheel.r, rearOffset: rear, brakeLights: brake };
}
