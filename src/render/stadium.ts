// Estadio realista: cielo físico (día) o nocturno, tribunas en dos anillos con público, techo con reflectores,
// carteles LED alrededor de la cancha y pantallas gigantes. Diseño propio.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
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
function crowdTexture(theme: Theme): THREE.CanvasTexture {
  const W = 2048, H = 512, rows = 18;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#23272f';
  g.fillRect(0, 0, W, H);
  const rh = H / rows;
  const skins = ['#f1c7a5', '#d9a47e', '#b67a52', '#8a5636', '#5e3a24', '#f5d6bd'];
  const shirts = ['#2E8BFF', '#2E8BFF', '#FF3355', '#FF3355', '#f2f2f2', '#1c1c1c', '#ffd166', '#3d9970', '#8e44ad', '#e67e22', '#bdc3c7', '#34495e'];
  for (let r = 0; r < rows; r++) {
    // Escalón (concreto) y fila de asientos
    g.fillStyle = r % 2 ? '#2b3039' : '#262a32';
    g.fillRect(0, r * rh, W, rh);
    g.fillStyle = '#3a4a66';
    g.fillRect(0, r * rh + rh * 0.55, W, rh * 0.3);
    const seatW = 13;
    for (let i = 0; i < W / seatW; i++) {
      if (Math.random() < 0.1) continue; // asiento vacío
      const x = i * seatW + (r % 2) * 6 + Math.random() * 2;
      const y = r * rh + rh * 0.22 + Math.random() * 2;
      g.fillStyle = shirts[Math.floor(Math.random() * shirts.length)];
      g.fillRect(x + 1, y + 6, 10, rh * 0.5);
      g.fillStyle = skins[Math.floor(Math.random() * skins.length)];
      g.beginPath();
      g.arc(x + 6, y + 4, 3.8, 0, Math.PI * 2);
      g.fill();
      if (Math.random() < 0.15) { // brazos arriba / banderas
        g.fillStyle = shirts[Math.floor(Math.random() * 4)];
        g.fillRect(x + 4, y - 10, 3, 10);
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  void theme;
  return t;
}

function concreteTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#7d828a';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, 256, 3);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
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
function band(base: THREE.Vector2[], d0: number, z0: number, d1: number, z1: number, tile: number): THREE.BufferGeometry {
  const A = offsetPoly(base, d0), B = offsetPoly(base, d1);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let u = 0;
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length;
    const len = A[i].distanceTo(A[j]);
    const vi = pos.length / 3;
    pos.push(A[i].x, A[i].y, z0, A[j].x, A[j].y, z0, B[j].x, B[j].y, z1, B[i].x, B[i].y, z1);
    const u2 = u + len / tile;
    uv.push(u, 0, u2, 0, u2, 1, u, 1);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    u = u2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
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

export class Stadium {
  group = new THREE.Group();
  private screens: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  private led: THREE.CanvasTexture;
  private floodMats: THREE.SpriteMaterial[] = [];

  constructor(theme: Theme) {
    // Contorno base de las tribunas (octógono alrededor de la arena y detrás de los arcos)
    const X = 4800, Y = 6500, C = 9700;
    const base = [
      new THREE.Vector2(X, -(C - X)), new THREE.Vector2(X, C - X), new THREE.Vector2(C - Y, Y), new THREE.Vector2(-(C - Y), Y),
      new THREE.Vector2(-X, C - X), new THREE.Vector2(-X, -(C - X)), new THREE.Vector2(-(C - Y), -Y), new THREE.Vector2(C - Y, -Y),
    ];
    const crowd = crowdTexture(theme);
    const night = theme === 'noche';
    const crowdMat = new THREE.MeshStandardMaterial({
      map: crowd, roughness: 0.95, side: THREE.DoubleSide,
      emissive: '#ffffff', emissiveMap: crowd, emissiveIntensity: night ? 0.22 : 0.04,
    });
    const conc = concreteTexture();
    const concMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, side: THREE.DoubleSide });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1d222b', roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide });

    // Anillo inferior y superior de tribunas
    const lower = new THREE.Mesh(band(base, 0, 260, 1250, 1250, 1600), crowdMat);
    const upper = new THREE.Mesh(band(base, 1650, 1900, 3200, 3500, 1600), crowdMat.clone());
    (upper.material as THREE.MeshStandardMaterial).map = crowd.clone();
    ((upper.material as THREE.MeshStandardMaterial).map as THREE.Texture).offset.x = 0.37;
    ((upper.material as THREE.MeshStandardMaterial).map as THREE.Texture).needsUpdate = true;
    lower.receiveShadow = upper.receiveShadow = true;
    this.group.add(lower, upper);
    // Muro delantero, pasillo, frente del anillo superior y pared trasera
    this.group.add(new THREE.Mesh(band(base, 0, 0, 0, 260, 800), concMat));
    this.group.add(new THREE.Mesh(band(base, 1250, 1250, 1650, 1250, 800), concMat));
    this.group.add(new THREE.Mesh(band(base, 1650, 1250, 1650, 1900, 800), darkMat));
    this.group.add(new THREE.Mesh(band(base, 3200, 0, 3200, 5200, 1200), darkMat));
    // Techo (con la cara inferior iluminada) y estructura
    const roofMat = new THREE.MeshStandardMaterial({ color: night ? '#2a313c' : '#c9ced6', roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
    const roof = new THREE.Mesh(band(base, 800, 5000, 3300, 5300, 1200), roofMat);
    roof.castShadow = true;
    this.group.add(roof);
    const trussMat = new THREE.MeshStandardMaterial({ color: '#5b6573', metalness: 0.8, roughness: 0.35 });
    this.group.add(new THREE.Mesh(band(base, 790, 4880, 790, 5020, 600), trussMat));
    // Reflectores en el borde del techo
    const lampMat = new THREE.MeshBasicMaterial({ color: '#f6fbff' });
    const inner = offsetPoly(base, 820);
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i], b = inner[(i + 1) % inner.length];
      const count = Math.max(2, Math.round(a.distanceTo(b) / 900));
      for (let k = 0; k < count; k++) {
        const p = a.clone().lerp(b, (k + 0.5) / count);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(260, 260, 60), lampMat);
        lamp.position.set(p.x, p.y, 4860);
        lamp.lookAt(0, 0, 0);
        this.group.add(lamp);
        const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#eaf3ff', transparent: true, opacity: night ? 0.9 : 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
        this.floodMats.push(mat);
        const halo = new THREE.Sprite(mat);
        halo.position.set(p.x, p.y, 4840);
        halo.scale.set(night ? 1500 : 900, night ? 1500 : 900, 1);
        this.group.add(halo);
      }
    }
    // Carteles LED a nivel de cancha (laterales y esquinas)
    const ledCanvas = document.createElement('canvas');
    ledCanvas.width = 2048; ledCanvas.height = 64;
    const lg = ledCanvas.getContext('2d')!;
    const msgs = ['TURBOGOL', 'FÚTBOL CON AUTOS', '¡VAMOS!', 'TEMPORADA 1', 'TURBOGOL', 'JUGÁ ONLINE PRONTO'];
    lg.fillStyle = '#05070c';
    lg.fillRect(0, 0, 2048, 64);
    lg.font = 'italic 900 40px "Arial Black", Arial, sans-serif';
    lg.textBaseline = 'middle';
    msgs.forEach((m, i) => {
      lg.fillStyle = i % 2 ? TEAM_COLORS[1] : TEAM_COLORS[0];
      lg.fillRect(i * 341, 0, 6, 64);
      lg.fillStyle = '#ffffff';
      lg.fillText(m, i * 341 + 20, 34);
    });
    this.led = new THREE.CanvasTexture(ledCanvas);
    this.led.colorSpace = THREE.SRGBColorSpace;
    this.led.wrapS = THREE.RepeatWrapping;
    const ledMat = new THREE.MeshBasicMaterial({ map: this.led, toneMapped: false, side: THREE.DoubleSide });
    const boardBase = [
      new THREE.Vector2(4240, -3900), new THREE.Vector2(4240, 3900), new THREE.Vector2(3000, 5250), new THREE.Vector2(-3000, 5250),
      new THREE.Vector2(-4240, 3900), new THREE.Vector2(-4240, -3900), new THREE.Vector2(-3000, -5250), new THREE.Vector2(3000, -5250),
    ];
    const boardsGeo = band(boardBase, 0, 0, 0, 110, 2600);
    // Quitar los tramos detrás de los arcos (segmentos 2 y 6)
    const idx = boardsGeo.getIndex()!.array as Uint16Array | Uint32Array;
    const keep: number[] = [];
    for (let s = 0; s < 8; s++) if (s !== 2 && s !== 6) for (let k = 0; k < 6; k++) keep.push(idx[s * 6 + k]);
    boardsGeo.setIndex(keep);
    this.group.add(new THREE.Mesh(boardsGeo, ledMat));

    // Pantallas gigantes sobre las tribunas de cada fondo
    for (const s of [-1, 1]) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 384;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(3600, 1350), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      scr.position.set(0, s * 7100, 4000);
      scr.rotation.set(Math.PI / 2, 0, s > 0 ? 0 : Math.PI, 'ZXY');
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3800, 140, 1520), darkMat);
      frame.position.set(0, s * 7180, 4000);
      this.group.add(frame, scr);
      this.screens.push({ canvas, tex });
    }
    this.updateScreens([0, 0], '5:00');

    // Terreno alrededor (fuera del estadio)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), new THREE.MeshStandardMaterial({ color: night ? '#0d130f' : '#3d4a35', roughness: 1 }));
    ground.position.z = -30;
    this.group.add(ground);
  }

  update(time: number) {
    this.led.offset.x = (time * 0.04) % 1;
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
