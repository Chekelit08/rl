// Estadio Aurora: cielo nocturno con aurora, tribunas con público, torres de luz y pantallas.

import * as THREE from 'three';
import { ARENA } from '../sim/constants.ts';
import { TEAM_COLORS } from './palette.ts';

export function buildSky(): THREE.Mesh {
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
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0));
        float c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + vec2(1, 1), 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.z;
        vec3 col = mix(vec3(0.02, 0.05, 0.10), vec3(0.005, 0.01, 0.03), smoothstep(0.0, 0.8, h));
        col += vec3(0.05, 0.12, 0.18) * exp(-abs(h) * 9.0);
        // Estrellas
        vec3 sp = floor(d * 420.0);
        float st = step(0.9975, hash(sp));
        col += vec3(0.8, 0.9, 1.0) * st * smoothstep(0.05, 0.4, h);
        // Aurora: cortinas onduladas
        float az = atan(d.y, d.x);
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float band = sin(az * (3.0 + fi) + uTime * (0.05 + fi * 0.02) + noise(vec2(az * 4.0, uTime * 0.1 + fi)) * 2.0);
          float center = 0.32 + fi * 0.09 + band * 0.05;
          float a = exp(-pow((h - center) * (14.0 - fi * 3.0), 2.0));
          float flick = 0.6 + 0.4 * noise(vec2(az * 30.0 + fi * 10.0, uTime * 0.6));
          vec3 ac = mix(vec3(0.1, 1.0, 0.6), vec3(0.5, 0.3, 1.0), fi / 2.0);
          col += ac * a * flick * 0.35;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 24), mat);
}

function crowdTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0b1220';
  g.fillRect(0, 0, 1024, 256);
  const cols = ['#e8e8f0', '#2E8BFF', '#FF3355', '#ffd166', '#9aa5b8', '#5c6b80', '#c3d7ff', '#ff9aae'];
  for (let row = 0; row < 16; row++) {
    for (let i = 0; i < 128; i++) {
      if (Math.random() < 0.12) continue;
      g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      const x = i * 8 + (row % 2) * 4 + Math.random() * 2;
      const y = row * 16 + 4 + Math.random() * 3;
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x - 3, y + 2, 6, 7);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Stadium {
  group = new THREE.Group();
  private screens: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];

  constructor() {
    const crowd = crowdTexture();
    const standMat = new THREE.MeshStandardMaterial({ color: '#141c2b', roughness: 0.9 });
    // Tribunas: anillo de gradas escalonadas alrededor del octógono
    const X = ARENA.X, Y = ARENA.Y + 400;
    const sides: [number, number, number, number][] = [
      // cx, cy, largo, rotación
      [X + 1200, 0, 7600, Math.PI / 2],
      [-X - 1200, 0, 7600, -Math.PI / 2],
      [0, Y + 1300, 5600, Math.PI],
      [0, -Y - 1300, 5600, 0],
    ];
    for (const [cx, cy, len, rot] of sides) {
      for (let tier = 0; tier < 6; tier++) {
        const depth = 420;
        const h = 300 + tier * 380;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, depth, h), standMat);
        const out = tier * 380;
        const dir = new THREE.Vector2(Math.sin(rot), -Math.cos(rot));
        m.position.set(cx - dir.x * out * -1, cy - dir.y * out * -1, h / 2 - 200);
        m.rotation.z = rot;
        this.group.add(m);
        // Público (plano inclinado delante de cada grada)
        const tex = crowd.clone();
        tex.needsUpdate = true;
        tex.repeat.set(len / 1600, 1);
        tex.offset.x = Math.random();
        const pm = new THREE.Mesh(
          new THREE.PlaneGeometry(len, 380),
          new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 1 }),
        );
        pm.position.set(m.position.x - dir.x * (depth / 2 + 2), m.position.y - dir.y * (depth / 2 + 2), h - 200 - 180);
        pm.rotation.set(Math.PI / 2 - 0.35, 0, rot + Math.PI, 'ZXY');
        this.group.add(pm);
      }
    }
    // Esquinas (bloques diagonales)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2600, 1800, 1500), standMat);
      m.position.set(sx * (X + 1100), sy * (Y + 1000), 550);
      m.rotation.z = sx * sy * Math.PI / 4;
      this.group.add(m);
    }
    // Torres de luz con focos
    const towerMat = new THREE.MeshStandardMaterial({ color: '#2a3446', metalness: 0.6, roughness: 0.4 });
    const lampMat = new THREE.MeshBasicMaterial({ color: '#eaf4ff' });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const tx = sx * (X + 2600), ty = sy * (Y + 2200);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(60, 90, 5200, 8), towerMat);
      pole.rotation.x = Math.PI / 2;
      pole.position.set(tx, ty, 2600);
      this.group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(900, 120, 500), lampMat);
      head.position.set(tx, ty, 5300);
      head.lookAt(0, 0, 0);
      this.group.add(head);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#cfe6ff', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.copy(head.position);
      halo.scale.set(2600, 2600, 1);
      this.group.add(halo);
    }
    // Pantallas gigantes detrás de cada arco
    for (const s of [-1, 1]) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 384;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const scr = new THREE.Mesh(
        new THREE.PlaneGeometry(3600, 1350),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      );
      scr.position.set(0, s * (Y + 2700), 3300);
      scr.rotation.set(Math.PI / 2, 0, s > 0 ? 0 : Math.PI, 'ZXY');
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3800, 120, 1500), towerMat);
      frame.position.set(0, s * (Y + 2770), 3300);
      this.group.add(frame, scr);
      this.screens.push({ canvas, tex });
    }
    this.updateScreens([0, 0], '5:00');
    // Anillo de luz sobre las tribunas
    const ringMat = new THREE.MeshBasicMaterial({ color: '#6fd6ff', transparent: true, opacity: 0.55 });
    for (const [cx, cy, len, rot] of sides) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 40, 40), ringMat);
      const dir = new THREE.Vector2(Math.sin(rot), -Math.cos(rot));
      strip.position.set(cx + dir.x * 2000, cy + dir.y * 2000, 2400);
      strip.rotation.z = rot;
      this.group.add(strip);
    }
  }

  updateScreens(score: number[], clock: string) {
    for (const { canvas, tex } of this.screens) {
      const g = canvas.getContext('2d')!;
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
      tex.needsUpdate = true;
    }
  }
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
