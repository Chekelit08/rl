// Herramienta de desarrollo: hoja de contacto con las 6 carrocerías desde varios ángulos.
// Uso (consola del navegador en `npm run dev`):
//   (await import('/src/dev/carsheet.ts')).carSheet()   → devuelve un data URL PNG
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar } from '../render/carMesh.ts';
import { CAR_BODIES } from '../sim/constants.ts';

export function carSheet(only?: string[], cell = 520, viewsIn?: [number, number][], dist = 300, normals = false): string {
  const bodies = CAR_BODIES.filter((b) => !only || only.includes(b.id));
  const views: [number, number][] = viewsIn ?? [[-0.9, 0.32], [2.5, 0.28], [-Math.PI / 2, 0.06]]; // 3/4 delantera, 3/4 trasera, perfil
  const cw = cell, ch = Math.round(cell * 0.62);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(cw * views.length, ch * bodies.length);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#5d6878');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(200, -300, 400);
  scene.add(sun, new THREE.AmbientLight('#ffffff', 0.15));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 40), new THREE.MeshStandardMaterial({ color: '#4a5464', roughness: 0.9 }));
  floor.position.z = -17;
  scene.add(floor);
  const cam = new THREE.PerspectiveCamera(28, cw / ch, 10, 3000);
  cam.up.set(0, 0, 1);
  bodies.forEach((b, r) => {
    const v = buildCar(b, r % 2);
    if (normals) v.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material === v.bodyMat) m.material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }); });
    scene.add(v.group);
    views.forEach(([az, el], c) => {
      const d = dist;
      cam.position.set(Math.cos(az) * Math.cos(el) * d + 8, Math.sin(az) * Math.cos(el) * d, 8 + Math.sin(el) * d);
      cam.lookAt(8, 0, 10);
      const y = ch * (bodies.length - 1 - r);
      renderer.setViewport(c * cw, y, cw, ch);
      renderer.setScissor(c * cw, y, cw, ch);
      renderer.render(scene, cam);
    });
    scene.remove(v.group);
  });
  const url = renderer.domElement.toDataURL('image/png');
  renderer.dispose();
  return url;
}
