// Estadio realista: cielo físico (día) o nocturno, tribunas en dos anillos con público, techo con reflectores,
// carteles LED alrededor de la cancha y pantallas gigantes. Diseño propio.

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

/** Atlas de personas (8 variantes: 4 sentadas, 4 con brazos arriba). Canales: R=remera, G=piel, B=pelo, A=alfa. */
function peopleAtlas(): THREE.CanvasTexture {
  const CW = 128, CH = 256;
  const cv = document.createElement('canvas');
  cv.width = CW * 8; cv.height = CH;
  const g = cv.getContext('2d')!;
  const SHIRT = 'rgb(255,0,0)', SKIN = 'rgb(0,255,0)', HAIR = 'rgb(0,0,255)';
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
  };
  for (let v = 0; v < 8; v++) {
    const ox = v * CW;
    const armsUp = v >= 4;
    const k = v % 4;
    const bw = 46 + k * 4; // contextura
    const cx = ox + CW / 2;
    // Torso
    g.fillStyle = SHIRT;
    rr(cx - bw / 2, 92, bw, 150, 18);
    // Brazos
    if (armsUp) {
      g.save();
      for (const s of [-1, 1]) {
        g.fillStyle = SHIRT;
        rr(cx + s * (bw / 2 - 4) - 8, 40, 16, 70, 8);
        g.fillStyle = SKIN;
        rr(cx + s * (bw / 2 - 4) - 7, 4 + k * 3, 14, 44, 7);
      }
      g.restore();
    } else {
      for (const s of [-1, 1]) {
        g.fillStyle = SHIRT;
        rr(cx + s * (bw / 2 + 2) - 8, 96, 16, 60, 8);
        g.fillStyle = SKIN;
        rr(cx + s * (bw / 2 + 2) - 7, 150, 14, 46, 7);
      }
    }
    // Cuello y cabeza
    g.fillStyle = SKIN;
    g.fillRect(cx - 9, 80, 18, 18);
    g.beginPath(); g.ellipse(cx, 62, 21, 25, 0, 0, Math.PI * 2); g.fill();
    // Pelo / gorra
    g.fillStyle = HAIR;
    g.beginPath();
    if (k === 2) { g.ellipse(cx, 46, 24, 12, 0, Math.PI, Math.PI * 2); g.fill(); g.fillRect(cx - 4, 42, 34, 7); } // gorra
    else { g.ellipse(cx, 50, 22, 16 + k * 2, 0, Math.PI * 0.95, Math.PI * 2.05); g.fill(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
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

export class Stadium {
  group = new THREE.Group();
  private screens: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  private led: THREE.CanvasTexture;
  private crowdMat: THREE.ShaderMaterial;
  private excite = 0;
  private exciteTarget = 0;

  constructor(theme: Theme) {
    const night = theme === 'noche';
    // Contorno base de las tribunas (octógono alrededor de la arena y detrás de los arcos)
    const X = 4800, Y = 6500, C = 9700;
    const base = [
      new THREE.Vector2(X, -(C - X)), new THREE.Vector2(X, C - X), new THREE.Vector2(C - Y, Y), new THREE.Vector2(-(C - Y), Y),
      new THREE.Vector2(-X, C - X), new THREE.Vector2(-X, -(C - X)), new THREE.Vector2(-(C - Y), -Y), new THREE.Vector2(C - Y, -Y),
    ];
    const concMat = new THREE.MeshStandardMaterial({
      map: loadTex('concreto_color.jpg', [1, 1], true), normalMap: loadTex('concreto_normal.jpg', [1, 1]),
      color: '#b9bcc2', roughness: 0.92, side: THREE.DoubleSide,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#232830', roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide });

    // ---- Gradas escalonadas (dos anillos) ----
    const rings: Ring[] = [
      { d0: 80, z0: 300, rows: 16, depth: 78, rise: 52 },
      { d0: 1800, z0: 1950, rows: 18, depth: 82, rise: 70 },
    ];
    const stepGeos: THREE.BufferGeometry[] = [];
    const seatSpots: { x: number; y: number; z: number; yaw: number; team: number }[] = [];
    for (const r of rings) {
      for (let i = 0; i < r.rows; i++) {
        const d = r.d0 + i * r.depth, z = r.z0 + i * r.rise;
        stepGeos.push(band(base, d, z, d + r.depth, z, 500)); // pisada
        stepGeos.push(band(base, d + r.depth, z, d + r.depth, z + r.rise, 500)); // contrahuella
        // Butacas a lo largo de la fila (con pasillos cada ~14 butacas)
        const line = offsetPoly(base, d + r.depth * 0.55);
        for (let s = 0; s < line.length; s++) {
          const a = line[s], b = line[(s + 1) % line.length];
          const len = a.distanceTo(b);
          const dir = b.clone().sub(a).normalize();
          const yaw = Math.atan2(dir.x, -dir.y); // mira hacia adentro (normal izquierda del segmento CCW)
          const n = Math.floor(len / 58);
          for (let k = 1; k < n; k++) {
            if (k % 15 === 0) continue; // pasillo
            const p = a.clone().lerp(b, k / n);
            const team = p.y < -2600 ? 0 : p.y > 2600 ? 1 : -1;
            seatSpots.push({ x: p.x, y: p.y, z, yaw, team });
          }
        }
      }
    }
    const steps = new THREE.Mesh(mergeGeometries(stepGeos), concMat);
    steps.receiveShadow = true;
    this.group.add(steps);

    // Ocupación: ~82% de las butacas tiene público; las vacías se ven como butacas
    const occupied = seatSpots.map(() => Math.random() < 0.82);
    const emptySeats = seatSpots.filter((_, i) => !occupied[i]);
    // Butacas (instanciadas; sólo las vacías, el resto lo tapa el público)
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

    // ---- Público 3D (sprites instanciados que miran a la cámara y festejan) ----
    const people = seatSpots.filter((_, i) => occupied[i]);
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const N = people.length;
    const offs = new Float32Array(N * 3), shirt = new Float32Array(N * 3), skin = new Float32Array(N * 3), hair = new Float32Array(N * 3), misc = new Float32Array(N * 3);
    const skins = ['#f1c7a5', '#e0ac85', '#c68e64', '#a06a45', '#7a4b2e', '#593621'].map((c) => new THREE.Color(c));
    const hairs = ['#1b1410', '#3b2414', '#6b4423', '#a07a4a', '#d8c08a', '#222222'].map((c) => new THREE.Color(c));
    const neutral = ['#f2f2f2', '#1c1c1c', '#ffd166', '#3d9970', '#8e44ad', '#e67e22', '#bdc3c7', '#34495e', '#7f8c8d'].map((c) => new THREE.Color(c));
    const teamCol = [new THREE.Color('#2E8BFF'), new THREE.Color('#FF3355')];
    people.forEach((p, i) => {
      // Un poco hacia adelante del asiento y a la altura del torso
      offs.set([p.x + Math.cos(p.yaw) * 6, p.y + Math.sin(p.yaw) * 6, p.z + 20], i * 3);
      const fan = p.team >= 0 ? (Math.random() < 0.7 ? p.team : 1 - p.team) : Math.random() < 0.35 ? 0 : Math.random() < 0.55 ? 1 : -1;
      const sc0 = fan >= 0 && Math.random() < 0.85 ? teamCol[fan].clone().multiplyScalar(0.7 + Math.random() * 0.4) : neutral[Math.floor(Math.random() * neutral.length)];
      shirt.set([sc0.r, sc0.g, sc0.b], i * 3);
      const sk = skins[Math.floor(Math.random() * skins.length)];
      skin.set([sk.r, sk.g, sk.b], i * 3);
      const hr = hairs[Math.floor(Math.random() * hairs.length)];
      hair.set([hr.r, hr.g, hr.b], i * 3);
      misc.set([Math.floor(Math.random() * 4), Math.random() * Math.PI * 2, 0.9 + Math.random() * 0.22], i * 3);
    });
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 3));
    geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    geo.setAttribute('aHair', new THREE.InstancedBufferAttribute(hair, 3));
    geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 3));
    geo.instanceCount = N;
    this.crowdMat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: peopleAtlas() },
        uTime: { value: 0 },
        uExcite: { value: 0 },
        uLight: { value: night ? 0.75 : 1.0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset; attribute vec3 aShirt; attribute vec3 aSkin; attribute vec3 aHair; attribute vec3 aMisc;
        uniform float uTime; uniform float uExcite;
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying float vShade;
        void main() {
          float variant = aMisc.x; float phase = aMisc.y; float scale = aMisc.z;
          float cheer = step(0.35, uExcite) * step(0.5, fract(phase * 0.731 + 0.2));
          float jump = uExcite * max(0.0, sin(uTime * 9.0 + phase)) * 22.0 + sin(uTime * 1.7 + phase) * 1.2;
          float v = variant + cheer * 4.0;
          vUv = vec2((uv.x + v) / 8.0, uv.y);
          vShirt = aShirt; vSkin = aSkin; vHair = aHair;
          vec3 toCam = cameraPosition - aOffset; toCam.z = 0.0;
          vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), normalize(toCam)));
          vec3 p = aOffset + right * position.x * 46.0 * scale + vec3(0.0, 0.0, (position.y + 0.5) * 92.0 * scale + jump);
          vShade = 0.85 + 0.15 * fract(phase * 3.17);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas; uniform float uLight;
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying vec3 vHair; varying float vShade;
        void main() {
          vec4 t = texture2D(uAtlas, vUv);
          if (t.a < 0.5) discard;
          vec3 c = vShirt * t.r + vSkin * t.g + vHair * t.b;
          float sum = max(t.r + t.g + t.b, 0.001);
          c /= sum;
          gl_FragColor = vec4(c * vShade * uLight, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const crowd = new THREE.Mesh(geo, this.crowdMat);
    crowd.frustumCulled = false;
    this.group.add(crowd);

    // ---- Estructura: muro delantero, pasillo, frente del anillo superior, pared trasera ----
    this.group.add(new THREE.Mesh(band(base, 0, 0, 0, 300, 500), concMat));
    this.group.add(new THREE.Mesh(band(base, 0, 300, 80, 300, 500), concMat));
    const lowerTop = rings[0].d0 + rings[0].rows * rings[0].depth;
    const lowerTopZ = rings[0].z0 + rings[0].rows * rings[0].rise;
    this.group.add(new THREE.Mesh(band(base, lowerTop, lowerTopZ, 1800, lowerTopZ, 500), concMat));
    this.group.add(new THREE.Mesh(band(base, 1800, lowerTopZ, 1800, 1950, 500), darkMat));
    const upperTop = rings[1].d0 + rings[1].rows * rings[1].depth;
    const upperTopZ = rings[1].z0 + rings[1].rows * rings[1].rise;
    this.group.add(new THREE.Mesh(band(base, upperTop, upperTopZ, upperTop + 200, upperTopZ, 500), concMat));
    this.group.add(new THREE.Mesh(band(base, upperTop + 200, 0, upperTop + 200, 5600, 800), concMat));
    // Palcos vidriados entre los dos anillos
    const boxMat = new THREE.MeshStandardMaterial({ color: '#8fb3d1', metalness: 0.7, roughness: 0.15, emissive: night ? '#3a4a5c' : '#1d2630' });
    this.group.add(new THREE.Mesh(band(base, 1700, lowerTopZ + 160, 1700, 1940, 900), boxMat));

    // ---- Techo de chapa acanalada con cerchas ----
    const roofMat = new THREE.MeshStandardMaterial({
      map: loadTex('chapa_color.jpg', [1, 1], true), normalMap: loadTex('chapa_normal.jpg', [1, 1]),
      color: night ? '#8a919b' : '#e6e9ee', roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide,
      emissive: night ? '#20262e' : '#3a3f46',
    });
    const roof = new THREE.Mesh(band(base, 700, 5150, upperTop + 300, 5550, 700), roofMat);
    roof.castShadow = true;
    this.group.add(roof);
    const steel = new THREE.MeshStandardMaterial({ color: '#7d8794', metalness: 0.85, roughness: 0.35 });
    this.group.add(new THREE.Mesh(band(base, 690, 5000, 690, 5160, 600), steel));
    // Cerchas radiales bajo el techo
    const trussGeo: THREE.BufferGeometry[] = [];
    const inner = offsetPoly(base, 700);
    const outer = offsetPoly(base, upperTop + 200);
    for (let s = 0; s < inner.length; s++) {
      const a0 = inner[s], a1 = inner[(s + 1) % inner.length], b0 = outer[s], b1 = outer[(s + 1) % inner.length];
      const n = Math.max(2, Math.round(a0.distanceTo(a1) / 1100));
      for (let k = 0; k <= n; k++) {
        const pi = a0.clone().lerp(a1, k / n), po = b0.clone().lerp(b1, k / n);
        const len = pi.distanceTo(po);
        const beam = new THREE.BoxGeometry(len, 40, 140);
        const ang = Math.atan2(po.y - pi.y, po.x - pi.x);
        beam.rotateZ(ang);
        beam.translate((pi.x + po.x) / 2, (pi.y + po.y) / 2, 5060 + 200);
        trussGeo.push(beam);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(trussGeo), steel));
    // Reflectores en el borde del techo
    const lampMat = new THREE.MeshBasicMaterial({ color: '#f6fbff' });
    const lampLine = offsetPoly(base, 760);
    const lamps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < lampLine.length; i++) {
      const a = lampLine[i], b = lampLine[(i + 1) % lampLine.length];
      const count = Math.max(2, Math.round(a.distanceTo(b) / 700));
      for (let k = 0; k < count; k++) {
        const p = a.clone().lerp(b, (k + 0.5) / count);
        const lamp = new THREE.BoxGeometry(200, 200, 40);
        lamp.lookAt(new THREE.Vector3(-p.x, -p.y, -4800).normalize());
        lamp.translate(p.x, p.y, 4960);
        lamps.push(lamp);
        if (night) {
          const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#eaf3ff', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
          halo.position.set(p.x, p.y, 4940);
          halo.scale.set(1300, 1300, 1);
          this.group.add(halo);
        }
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(lamps), lampMat));

    // ---- Carteles LED a nivel de cancha (laterales y esquinas) ----
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
    const ledMat = new THREE.MeshBasicMaterial({ map: this.led, toneMapped: false, side: THREE.DoubleSide });
    const boardBase = [
      new THREE.Vector2(4240, -3900), new THREE.Vector2(4240, 3900), new THREE.Vector2(3000, 5250), new THREE.Vector2(-3000, 5250),
      new THREE.Vector2(-4240, 3900), new THREE.Vector2(-4240, -3900), new THREE.Vector2(-3000, -5250), new THREE.Vector2(3000, -5250),
    ];
    this.group.add(new THREE.Mesh(band(boardBase, 0, 0, 0, 110, 2600, [2, 6]), ledMat));
    // Cinta LED en el frente del anillo superior
    this.group.add(new THREE.Mesh(band(base, 1690, lowerTopZ + 40, 1690, lowerTopZ + 150, 2600), ledMat));

    // ---- Pantallas gigantes colgadas del techo ----
    for (const s of [-1, 1]) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 384;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(3600, 1350), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      scr.position.set(0, s * 7100, 4100);
      scr.rotation.set(Math.PI / 2, 0, s > 0 ? 0 : Math.PI, 'ZXY');
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3800, 140, 1520), darkMat);
      frame.position.set(0, s * 7180, 4100);
      this.group.add(frame, scr);
      this.screens.push({ canvas, tex });
    }
    this.updateScreens([0, 0], '5:00');

    // Terreno alrededor (fuera del estadio)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshStandardMaterial({ color: night ? '#0b100c' : '#55603f', roughness: 1 }));
    ground.position.z = -30;
    this.group.add(ground);
  }

  /** El público festeja (0..1). */
  cheer(amount: number) { this.exciteTarget = Math.max(this.exciteTarget, amount); }

  update(time: number, dt = 1 / 60) {
    this.led.offset.x = (time * 0.04) % 1;
    this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 4);
    this.exciteTarget = Math.max(0, this.exciteTarget - dt * 0.25);
    this.crowdMat.uniforms.uTime.value = time;
    this.crowdMat.uniforms.uExcite.value = this.excite;
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
