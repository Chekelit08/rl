// Miniaturas de las carrocerías para las tarjetas del garage y de la configuración de partido.
// Se dibujan con el auto real (misma pintura, calco y llantas que eligió el jugador) en un lienzo aparte,
// de a una por cuadro para no trabar el menú, y quedan guardadas mientras no cambie el aspecto.
// No dependen de la forma de cada carrocería: el encuadre sale de su caja envolvente.

import * as THREE from 'three';
import { getLoadout, lookFromLoadout, type CarLook } from '../garage/loadout.ts';
import { buildCar, disposeCar } from '../render/carMesh.ts';
import { CAR_BODIES } from '../sim/constants.ts';
import { aimStudioEnv, studioEnv } from './studio.ts';

export const BODY_DESC = ['Equilibrado', 'Largo y bajo', 'Plano y ancho', 'Largo y fino', 'Híbrido', 'Alto, defensivo'];

const W = 384, H = 240;
const cache = new Map<string, (string | undefined)[]>();
let kit: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; shadow: THREE.Mesh } | null | undefined;
let queue: { key: string; team: number; look: CarLook; body: number }[] = [];
let running = false;

const lookKey = (team: number, l: CarLook) => `${team}|${l.paint}|${l.secondary}|${l.finish}|${l.decal}|${l.decalNumber}|${l.wheel}`;

function initKit() {
  if (kit !== undefined) return kit;
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W * 2, H * 2, false);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    aimStudioEnv(scene, studioEnv(renderer), 1.1);
    const key = new THREE.DirectionalLight('#ffffff', 1.5);
    key.position.set(220, -320, 420);
    scene.add(key, new THREE.AmbientLight('#ffffff', 0.25));
    // Sombra de contacto: una mancha suave bajo el auto
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,.6)');
    grd.addColorStop(0.6, 'rgba(0,0,0,.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, toneMapped: false }));
    scene.add(shadow);
    const camera = new THREE.PerspectiveCamera(22, W / H, 10, 6000);
    camera.up.set(0, 0, 1);
    kit = { renderer, scene, camera, shadow };
  } catch {
    kit = null; // sin WebGL extra: las tarjetas quedan sólo con texto
  }
  return kit;
}

function renderBody(body: number, team: number, look: CarLook): string | undefined {
  const k = initKit();
  if (!k) return undefined;
  const v = buildCar(CAR_BODIES[body], team, look);
  v.flame.parent?.remove(v.flame);
  v.group.rotation.set(0, 0, 0);
  v.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(v.group);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  k.scene.add(v.group);
  k.shadow.position.set(c.x, c.y, box.min.z + 0.6);
  k.shadow.scale.set(size.x * 1.3, size.y * 1.45, 1);
  // Vista de tres cuartos delantera, encuadrada con la esfera que envuelve al auto
  const r = size.length() / 2;
  const az = -0.82, el = 0.3;
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(k.camera.fov / 2))) * 0.77;
  k.camera.position.set(c.x + Math.cos(az) * Math.cos(el) * dist, c.y + Math.sin(az) * Math.cos(el) * dist, c.z + Math.sin(el) * dist);
  k.camera.lookAt(c.x, c.y, c.z - size.z * 0.06);
  k.renderer.render(k.scene, k.camera);
  const url = k.renderer.domElement.toDataURL('image/webp', 0.92);
  k.scene.remove(v.group);
  disposeCar(v);
  return url;
}

function paint(root: ParentNode = document) {
  root.querySelectorAll<HTMLImageElement>('img.thumb[data-thumb]').forEach((img) => {
    const team = Number(img.dataset.team ?? 0);
    const url = cache.get(lookKey(team, lookFromLoadout(getLoadout(), team)))?.[Number(img.dataset.thumb)];
    if (url && img.getAttribute('src') !== url) img.src = url;
  });
}

function pump() {
  const job = queue.shift();
  if (!job) { running = false; return; }
  const list = cache.get(job.key);
  if (list && list[job.body] === undefined) {
    try { list[job.body] = renderBody(job.body, job.team, job.look); } catch { queue = []; running = false; return; }
    paint();
  }
  requestAnimationFrame(pump);
}

/** Tarjetas de las seis carrocerías. La miniatura se completa sola con `refreshBodyThumbs`. */
export function bodyCards(selected: number, team = 0, attr = 'data-body', cls = ''): string {
  return CAR_BODIES.map((b, i) => `<button class="card body-card${cls ? ' ' + cls : ''}${i === selected ? ' on' : ''}" ${attr}="${i}"><img class="thumb" data-thumb="${i}" data-team="${team}" alt=""><b>${b.name}</b><small>${BODY_DESC[i] ?? ''}</small></button>`).join('');
}

/** Pone las miniaturas que ya existen y encarga las que falten para el aspecto actual del auto. */
export function refreshBodyThumbs(root: ParentNode = document) {
  const teams = new Set<number>();
  root.querySelectorAll<HTMLImageElement>('img.thumb[data-thumb]').forEach((img) => teams.add(Number(img.dataset.team ?? 0)));
  for (const team of teams) {
    const look = lookFromLoadout(getLoadout(), team);
    const key = lookKey(team, look);
    if (cache.has(key)) continue;
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
    cache.set(key, []);
    queue = queue.filter((j) => j.team !== team);
    // Primero la carrocería elegida
    const sel = getLoadout().body;
    const order = CAR_BODIES.map((_, i) => i).sort((a, b) => Number(b === sel) - Number(a === sel));
    for (const body of order) queue.push({ key, team, look, body });
  }
  paint(root);
  if (!running && queue.length) { running = true; requestAnimationFrame(pump); }
}
