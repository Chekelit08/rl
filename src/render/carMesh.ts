// Autos procedurales: 6 carrocerías originales, una por hitbox. La silueta se escala al hitbox real.

import * as THREE from 'three';
import type { CarBody } from '../sim/constants.ts';
import { BOOST_COLOR, TEAM_COLORS, TEAM_COLORS_LIGHT } from './palette.ts';

type P = [number, number];
// Perfiles laterales normalizados al hitbox: x ∈ [-0.5, 0.5] (atrás→adelante), y ∈ [-0.5, 0.5] (abajo→arriba)
const PROFILES: Record<string, { body: P[]; cabin: P[]; spoiler?: boolean }> = {
  toro: {
    body: [[-0.5, -0.45], [0.5, -0.45], [0.52, -0.1], [0.3, 0.06], [-0.46, 0.14], [-0.52, -0.02]],
    cabin: [[0.22, 0.04], [0.04, 0.5], [-0.22, 0.5], [-0.36, 0.12]],
    spoiler: true,
  },
  flecha: {
    body: [[-0.5, -0.45], [0.5, -0.45], [0.53, -0.24], [0.32, -0.06], [-0.44, 0.1], [-0.52, -0.04]],
    cabin: [[0.12, -0.04], [-0.06, 0.42], [-0.26, 0.42], [-0.38, 0.08]],
    spoiler: true,
  },
  lamina: {
    body: [[-0.5, -0.45], [0.5, -0.45], [0.53, -0.32], [0.2, -0.04], [-0.48, 0.14], [-0.52, -0.1]],
    cabin: [[0.1, -0.06], [-0.02, 0.3], [-0.22, 0.32], [-0.32, 0.08]],
  },
  aguja: {
    body: [[-0.5, -0.4], [0.5, -0.45], [0.54, -0.28], [0.26, -0.08], [-0.46, 0.1], [-0.52, -0.08]],
    cabin: [[0.14, -0.1], [0.0, 0.42], [-0.18, 0.44], [-0.32, 0.04]],
    spoiler: true,
  },
  mixto: {
    body: [[-0.5, -0.45], [0.5, -0.45], [0.52, -0.16], [0.3, 0.0], [-0.46, 0.12], [-0.52, -0.04]],
    cabin: [[0.2, -0.02], [0.02, 0.46], [-0.24, 0.46], [-0.36, 0.1]],
    spoiler: true,
  },
  furgon: {
    body: [[-0.5, -0.45], [0.5, -0.45], [0.52, -0.08], [0.38, 0.08], [-0.5, 0.2]],
    cabin: [[0.36, 0.06], [0.24, 0.5], [-0.42, 0.5], [-0.46, 0.18]],
  },
};

export interface CarVisual {
  group: THREE.Group;
  frontWheels: THREE.Object3D[];
  wheels: THREE.Object3D[];
  flame: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  wheelRadius: number;
  rearOffset: THREE.Vector3;
  nameplate?: HTMLDivElement;
}

function extrudeProfile(points: P[], L: number, H: number, width: number, bevel: number) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0] * L, points[0][1] * H);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0] * L, points[i][1] * H);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, (width - bevel * 2) / 2, 0);
  g.computeVertexNormals();
  return g;
}

export function buildCar(body: CarBody, team: number): CarVisual {
  const group = new THREE.Group();
  const [L, W, H] = body.size;
  const [ox, , oz] = body.offset;
  const prof = PROFILES[body.id] ?? PROFILES.toro;

  const color = new THREE.Color(TEAM_COLORS[team]);
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.28, emissive: color, emissiveIntensity: 0.12 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#10141c', metalness: 0.3, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1d3550', metalness: 0.6, roughness: 0.12, emissive: '#0e2c4a', emissiveIntensity: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS_LIGHT[team], metalness: 0.2, roughness: 0.4, emissive: TEAM_COLORS_LIGHT[team], emissiveIntensity: 0.5 });

  const chassis = new THREE.Group();
  chassis.position.set(ox, 0, oz);
  group.add(chassis);

  const bodyMesh = new THREE.Mesh(extrudeProfile(prof.body, L, H, W * 0.94, 3), bodyMat);
  bodyMesh.castShadow = true;
  chassis.add(bodyMesh);
  const cabin = new THREE.Mesh(extrudeProfile(prof.cabin, L, H, W * 0.76, 2.5), glassMat);
  cabin.castShadow = true;
  chassis.add(cabin);
  // Franja de acento sobre el capó y faldones
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, 6, 2), accentMat);
  stripe.position.set(0, 0, -H * 0.18);
  const s1 = stripe.clone(); s1.position.y = W * 0.47;
  const s2 = stripe.clone(); s2.position.y = -W * 0.47;
  chassis.add(s1, s2);
  // Alerón
  if (prof.spoiler) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(10, W * 0.9, 2.5), darkMat);
    wing.position.set(-L * 0.47, 0, H * 0.32);
    const st1 = new THREE.Mesh(new THREE.BoxGeometry(4, 3, H * 0.28), darkMat);
    st1.position.set(-L * 0.45, W * 0.3, H * 0.18);
    const st2 = st1.clone(); st2.position.y = -W * 0.3;
    chassis.add(wing, st1, st2);
  }
  // Luces
  const head = new THREE.MeshBasicMaterial({ color: '#f4fbff' });
  const tail = new THREE.MeshBasicMaterial({ color: '#ff2a3d' });
  for (const sy of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(2, 12, 4), head);
    h.position.set(L * 0.51, sy * W * 0.32, -H * 0.2);
    const t = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 4), tail);
    t.position.set(-L * 0.51, sy * W * 0.32, -H * 0.12);
    chassis.add(h, t);
  }

  // Ruedas
  const tireMat = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#c9d2e0', metalness: 0.9, roughness: 0.25 });
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const mkWheel = (r: number) => {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 13, 18), tireMat);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 13.6, 6), rimMat);
    const spin = new THREE.Group();
    spin.add(tire, rim);
    w.add(spin);
    tire.castShadow = true;
    return w;
  };
  for (const [wd, isFront] of [[body.frontWheel, true], [body.backWheel, false]] as const) {
    for (const sy of [-1, 1]) {
      const w = mkWheel(wd.r);
      w.position.set(wd.x, sy * wd.y, -17 + wd.r);
      group.add(w);
      wheels.push(w);
      if (isFront) frontWheels.push(w);
    }
  }

  // Llama del turbo
  const flame = new THREE.Group();
  const rear = new THREE.Vector3(ox - L / 2 - 2, 0, oz - H * 0.05);
  flame.position.copy(rear);
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(11, 70, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: TEAM_COLORS_LIGHT[team], transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  outer.rotation.z = Math.PI / 2;
  outer.position.x = -35;
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(6, 42, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: BOOST_COLOR, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  inner.rotation.z = Math.PI / 2;
  inner.position.x = -21;
  flame.add(outer, inner);
  flame.visible = false;
  group.add(flame);
  // Tobera
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 8, 12), darkMat);
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.copy(rear).add(new THREE.Vector3(3, 0, 0));
  group.add(nozzle);

  return { group, frontWheels, wheels, flame, bodyMat, wheelRadius: body.backWheel.r, rearOffset: rear };
}
