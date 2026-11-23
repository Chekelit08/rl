// Malla visual de la arena generada desde la misma SDF de colisión (Surface Nets),
// más el piso con sus líneas, los arcos (marco + red) y el material de las paredes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { arenaDistance, arenaNormal } from '../sim/arena.ts';
import { ARENA } from '../sim/constants.ts';
import { TEAM_COLORS } from './palette.ts';

/** Genera la superficie de la arena (sin piso ni techo planos) con Surface Nets. */
export function buildArenaSurface(step = 40): THREE.BufferGeometry {
  const x0 = -4200, x1 = 4200, y0 = -6080, y1 = 6080, z0 = -40, z1 = 2100;
  const nx = Math.ceil((x1 - x0) / step) + 1;
  const ny = Math.ceil((y1 - y0) / step) + 1;
  const nz = Math.ceil((z1 - z0) / step) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * step;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * step;
      for (let i = 0; i < nx; i++) vals[id(i, j, k)] = arenaDistance(x0 + i * step, y, z);
    }
  }

  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const nor: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);

  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const [a, b, d] = corners[c];
      cv[c] = vals[id(i + a, j + b, k + d)];
      if (cv[c] > 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [e0, e1] of edges) {
      const va = cv[e0], vb = cv[e1];
      if ((va > 0) === (vb > 0)) continue;
      const t = va / (va - vb);
      const [ax, ay, az] = corners[e0], [bx, by, bz] = corners[e1];
      sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t;
      cnt++;
    }
    let px = x0 + (i + sx / cnt) * step, py = y0 + (j + sy / cnt) * step, pz = z0 + (k + sz / cnt) * step;
    // Proyección a la superficie
    for (let it = 0; it < 2; it++) {
      const d = arenaDistance(px, py, pz);
      const n = arenaNormal(px, py, pz);
      px -= n.x * d; py -= n.y * d; pz -= n.z * d;
    }
    const n = arenaNormal(px, py, pz);
    cellVert[cid(i, j, k)] = pos.length / 3;
    pos.push(px, py, pz);
    nor.push(n.x, n.y, n.z);
  }

  const idx: number[] = [];
  const pushQuad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Descartar piso y techo planos (se dibujan aparte)
    const zs = [pos[a * 3 + 2], pos[b * 3 + 2], pos[c * 3 + 2], pos[d * 3 + 2]];
    if (zs.every((z) => z < 1.5)) return;
    if (zs.every((z) => z > ARENA.H - 1.5)) return;
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
      // Orientar el triángulo según la normal de la SDF (hacia adentro)
      const ux = pos[q * 3] - pos[p * 3], uy = pos[q * 3 + 1] - pos[p * 3 + 1], uz = pos[q * 3 + 2] - pos[p * 3 + 2];
      const vx = pos[r * 3] - pos[p * 3], vy = pos[r * 3 + 1] - pos[p * 3 + 1], vz = pos[r * 3 + 2] - pos[p * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const dot = cx * (nor[p * 3] + nor[q * 3] + nor[r * 3]) + cy * (nor[p * 3 + 1] + nor[q * 3 + 1] + nor[r * 3 + 1]) + cz * (nor[p * 3 + 2] + nor[q * 3 + 2] + nor[r * 3 + 2]);
      if (dot >= 0) idx.push(p, q, r); else idx.push(p, r, q);
    }
  };

  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    // arista en X entre (i,j,k) y (i+1,j,k)
    if ((vals[id(i, j, k)] > 0) !== (vals[id(i + 1, j, k)] > 0)) {
      pushQuad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)]);
    }
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    if ((vals[id(i, j, k)] > 0) !== (vals[id(i, j + 1, k)] > 0)) {
      pushQuad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)]);
    }
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    if ((vals[id(i, j, k)] > 0) !== (vals[id(i, j, k + 1)] > 0)) {
      pushQuad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)]);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Textura de publicidad de los tableros (sobria: fondo oscuro, texto claro). */
function boardAdsTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 2048, 128);
  const msgs = ['TURBOGOL', 'LIGA TURBOGOL', 'FÚTBOL CON AUTOS', 'TURBOGOL', 'TEMPORADA 1', 'ESTADIO CENTRAL'];
  g.textBaseline = 'middle';
  g.font = '800 60px "Archivo Variable", "Arial Black", Arial, sans-serif';
  const step = 2048 / msgs.length;
  msgs.forEach((m, i) => {
    g.fillStyle = '#ffffff';
    g.fillText(m, i * step + 24, 68, step - 48);
    g.fillRect(i * step + 6, 30, 6, 68);
  });
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Material de paredes realista: tablero acolchado opaco en la base (rampas) y vidrio con montantes arriba. */
export function wallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    uniforms: {
      uBlue: { value: new THREE.Color(TEAM_COLORS[0]) },
      uRed: { value: new THREE.Color(TEAM_COLORS[1]) },
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uSky: { value: new THREE.Color('#9cc4ee') },
      uSunDir: { value: new THREE.Vector3(0.5, 0.3, 0.8).normalize() },
      uBoard: { value: new THREE.Color('#1a2433') },
      uAds: { value: boardAdsTexture() },
      uAdsGlow: { value: 0.35 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos; varying vec3 vNor;
      void main() {
        vPos = position; vNor = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBlue; uniform vec3 uRed; uniform float uTime; uniform vec3 uCam; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uBoard;
      uniform sampler2D uAds; uniform float uAdsGlow;
      varying vec3 vPos; varying vec3 vNor;
      float line(float v, float s, float w) {
        float d = abs(fract(v / s) - 0.5) * s;
        float aa = max(fwidth(v), 0.001);
        return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, d);
      }
      void main() {
        // Dentro del arco: sólo se ven las redes
        if (abs(vPos.y) > 5135.0 && abs(vPos.x) < 905.0 && vPos.z < 655.0) discard;
        vec3 n = normalize(vNor);
        vec3 V = normalize(uCam - vPos);
        float team = smoothstep(-1800.0, 1800.0, vPos.y);
        vec3 tint = mix(uBlue, uRed, team);
        float fres = pow(1.0 - max(dot(V, n), 0.0), 4.0);
        // Coordenada a lo largo de la pared (para montantes verticales y paneles)
        vec3 an = abs(n);
        float along = an.x > an.y ? vPos.y * sign(n.x) : -vPos.x * sign(n.y);
        float boardTop = 300.0;
        vec3 col; float alpha;
        if (vPos.z < boardTop) {
          // Tablero liso y oscuro con publicidad blanca y franja de equipo
          float diff = max(dot(n, uSunDir), 0.0) * 0.35 + 0.65;
          float joint = line(along, 512.0, 4.0);
          float stripe = smoothstep(boardTop - 40.0, boardTop - 34.0, vPos.z) * (1.0 - smoothstep(boardTop - 8.0, boardTop - 2.0, vPos.z));
          col = mix(uBoard, uBoard * 0.65, joint) * diff;
          float adBand = smoothstep(70.0, 80.0, vPos.z) * (1.0 - smoothstep(220.0, 230.0, vPos.z));
          float ad = texture2D(uAds, vec2(along / 2600.0, clamp((vPos.z - 75.0) / 150.0, 0.0, 1.0))).r * adBand;
          col = mix(col, vec3(0.95) * (0.75 + uAdsGlow * 0.6), ad * 0.92);
          col = mix(col, tint, stripe);
          col += vec3(0.05) * fres;
          alpha = 1.0;
        } else {
          // Vidrio: casi transparente, montantes metálicos y reflejo del cielo
          float diff = max(dot(n, uSunDir), 0.0) * 0.6 + 0.4;
          float mull = line(along, 1024.0, 7.0);
          float rail = line(vPos.z, 680.0, 6.0) * step(boardTop + 40.0, vPos.z);
          float top = smoothstep(ARENA_H - 70.0, ARENA_H - 20.0, vPos.z);
          float edge = smoothstep(boardTop + 18.0, boardTop, vPos.z); // perfil metálico sobre el tablero
          vec3 glass = mix(vec3(0.75, 0.85, 0.95), tint, 0.25) * 0.25;
          col = glass + uSky * fres * 0.9;
          alpha = 0.04 + fres * 0.38;
          vec3 metal = vec3(0.86, 0.89, 0.93) * diff;
          float frame = max(max(mull, rail), edge);
          col = mix(col, metal, frame * 0.9);
          alpha = max(alpha, frame * 0.5);
          col = mix(col, metal * 1.2, top);
          alpha = max(alpha, top);
        }
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`.replace(/ARENA_H/g, ARENA.H.toFixed(1)),
  });
}

/** Contorno del piso (octógono + arcos), en el plano XY. */
function floorShape(): THREE.Shape {
  const s = new THREE.Shape();
  const X = ARENA.X, Y = ARENA.Y, C = ARENA.CHAMFER;
  const gw = ARENA.GOAL_HW, gd = Y + ARENA.GOAL_DEPTH;
  const pts: [number, number][] = [
    [-gw, -gd], [gw, -gd], [gw, -Y], [C - Y, -Y], [X, -(C - X)], [X, C - X], [C - Y, Y], [gw, Y], [gw, gd],
    [-gw, gd], [-gw, Y], [-(C - Y), Y], [-X, C - X], [-X, -(C - X)], [-(C - Y), -Y], [-gw, -Y],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** Césped parejo cortado en franjas de dos tonos (las líneas se dibujan analíticamente en el shader). */
function floorTexture(): THREE.CanvasTexture {
  const W = 1024, H = 1500; // 8 uu por px
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const sy = H / 12000;
  const Y = (y: number) => H - (y + 6000) * sy;
  // Franjas de corte (claras/oscuras) a lo largo
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? '#4b8f45' : '#43853f';
    g.fillRect(0, Y(-6000 + (i + 1) * 500), W, 500 * sy + 1);
  }
  // Tinte de equipo muy sutil en cada área
  for (const [t, y0] of [[0, -5120], [1, 5120]] as const) {
    const grd = g.createLinearGradient(0, Y(y0), 0, Y(y0 * 0.62));
    grd.addColorStop(0, t === 0 ? 'rgba(46,139,255,0.20)' : 'rgba(255,51,85,0.20)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, Math.min(Y(y0), Y(y0 * 0.62)), W, Math.abs(Y(y0) - Y(y0 * 0.62)));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

/** Mapa de normales de pasto (repetible) para el detalle cercano. */
function grassNormal(): THREE.CanvasTexture {
  const N = 256;
  const h = new Float32Array(N * N);
  for (let i = 0; i < 2600; i++) {
    let x = Math.random() * N, y = Math.random() * N;
    const a = Math.random() * Math.PI * 2, len = 4 + Math.random() * 6;
    for (let k = 0; k < len; k++) {
      const xi = ((Math.floor(x) % N) + N) % N, yi = ((Math.floor(y) % N) + N) % N;
      h[yi * N + xi] += 0.6;
      x += Math.cos(a); y += Math.sin(a);
    }
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hl = h[y * N + ((x - 1 + N) % N)], hr = h[y * N + ((x + 1) % N)];
    const hd = h[((y - 1 + N) % N) * N + x], hu = h[((y + 1) % N) * N + x];
    let nx = (hl - hr) * 1.5, ny = (hd - hu) * 1.5, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(160, 230);
  return t;
}

/** Líneas de la cancha como funciones de distancia: nítidas a cualquier distancia, con antialiasing por derivadas. */
const FIELD_LINES_GLSL = /* glsl */ `
  float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
  float lineAA(float d, float hw) { float aa = max(fwidth(d), 0.0008) * 0.9; return 1.0 - smoothstep(hw - aa, hw + aa, d); }
  float fieldLines(vec2 p) {
    const float HW = 13.0;
    vec2 q = vec2(p.x, abs(p.y));
    float m = 0.0;
    m = max(m, lineAA(abs(p.y), HW) * step(abs(p.x), 4096.0));            // línea media
    m = max(m, lineAA(abs(length(p) - 1000.0), HW));                       // círculo central
    m = max(m, lineAA(length(p), 38.0));                                   // punto central
    // Área grande
    m = max(m, lineAA(sdSeg(q, vec2(-1800.0, 5120.0), vec2(-1800.0, 3620.0)), HW));
    m = max(m, lineAA(sdSeg(q, vec2(1800.0, 5120.0), vec2(1800.0, 3620.0)), HW));
    m = max(m, lineAA(sdSeg(q, vec2(-1800.0, 3620.0), vec2(1800.0, 3620.0)), HW));
    // Área chica
    m = max(m, lineAA(sdSeg(q, vec2(-1150.0, 5120.0), vec2(-1150.0, 4560.0)), HW));
    m = max(m, lineAA(sdSeg(q, vec2(1150.0, 5120.0), vec2(1150.0, 4560.0)), HW));
    m = max(m, lineAA(sdSeg(q, vec2(-1150.0, 4560.0), vec2(1150.0, 4560.0)), HW));
    // Medialuna (sólo hacia el centro de la cancha)
    m = max(m, lineAA(abs(length(q - vec2(0.0, 3620.0)) - 700.0), HW) * step(q.y, 3620.0));
    // Punto penal
    m = max(m, lineAA(length(q - vec2(0.0, 4220.0)), 26.0));
    // Línea de gol reforzada
    m = max(m, lineAA(sdSeg(q, vec2(-893.0, 5122.0), vec2(893.0, 5122.0)), HW * 1.6));
    return m;
  }
`;

export function buildFloor(): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(floorShape());
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 4096) / 8192, (p.getY(i) + 6000) / 12000);
  const loader = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL + 'assets/textures/';
  const rep = (t: THREE.Texture, r: number) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(r, r * 1.46); t.anisotropy = 16; return t; };
  // Detalle fotográfico CC0 (Poly Haven "Leafy Grass"): normales y rugosidad; con fallback procedural
  const normal = rep(loader.load(base + 'pasto_normal.jpg', undefined, undefined, () => { mat.normalMap = grassNormal(); }), 90);
  const rough = rep(loader.load(base + 'pasto_rugosidad.jpg'), 90);
  const detail = rep(loader.load(base + 'pasto_detalle.jpg'), 140);
  const mat = new THREE.MeshStandardMaterial({
    map: floorTexture(), normalMap: normal, normalScale: new THREE.Vector2(0.45, 0.45), roughnessMap: rough, roughness: 1, metalness: 0,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform sampler2D uDetail;\n' + FIELD_LINES_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Detalle de pasto a dos escalas (evita que se note la repetición)
        float d1 = texture2D(uDetail, vWPos.xy / vec2(58.5, 58.5)).r;
        float d2 = texture2D(uDetail, vWPos.xy / vec2(356.0, 356.0)).r;
        diffuseColor.rgb *= 0.9 + 0.16 * d1 + 0.1 * (d2 - 0.5);
        // Franjas de corte que cambian con el ángulo de visión (como en una cancha real)
        float stripe = mod(floor((vWPos.y + 6000.0) / 500.0), 2.0) * 2.0 - 1.0;
        vec2 vd = normalize(cameraPosition.xy - vWPos.xy + vec2(0.0001));
        float grazing = clamp(1.0 - (cameraPosition.z - vWPos.z) / max(length(cameraPosition - vWPos), 1.0), 0.0, 1.0);
        diffuseColor.rgb *= 1.0 + stripe * vd.y * (0.10 + 0.12 * grazing);
        // Líneas pintadas sobre el pasto (conservan algo del grano del césped)
        float fl = fieldLines(vWPos.xy);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.97, 0.95) * (0.95 + 0.06 * d1), fl * 0.96);`);
  };
  mat.customProgramCacheKey = () => 'turbogol-floor';
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** Textura de red (malla de cuerda). */
function netTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Plano subdividido en coordenadas de mundo, con UV en unidades de la malla (32 uu por celda). */
function worldPlane(origin: THREE.Vector3, ua: THREE.Vector3, va: THREE.Vector3, segU: number, segV: number, cell = 32) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], pin: number[] = [];
  const lu = ua.length(), lv = va.length();
  for (let j = 0; j <= segV; j++) for (let i = 0; i <= segU; i++) {
    const p = origin.clone().addScaledVector(ua, i / segU).addScaledVector(va, j / segV);
    pos.push(p.x, p.y, p.z);
    uv.push(((i / segU) * lu) / cell, ((j / segV) * lv) / cell);
    // Peso de "sujeción": 0 en los bordes del paño (atado a postes/piso), 1 en el centro
    pin.push(Math.sin((Math.PI * i) / segU) * Math.sin((Math.PI * j) / segV));
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * (segU + 1) + i, b = a + 1, c = a + segU + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPin', new THREE.Float32BufferAttribute(pin, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Arcos: marcos, soportes, redes (que se deforman con el gol) y la luz de equipo. 5 draw calls para ambos. */
export class Goals {
  group = new THREE.Group();
  private netUniforms = {
    uTime: { value: 0 },
    uImpactA: { value: new THREE.Vector4(0, -6000, 300, -100) }, // xyz punto, w tiempo del impacto (arco azul, -Y)
    uImpactB: { value: new THREE.Vector4(0, 6000, 300, -100) }, // arco rojo, +Y
    uAmpA: { value: 0 },
    uAmpB: { value: 0 },
  };

  constructor() {
    const H = ARENA.GOAL_H, W = ARENA.GOAL_HW;
    const depth = ARENA.GOAL_DEPTH - 12;
    const postGeos: THREE.BufferGeometry[] = [], supGeos: THREE.BufferGeometry[] = [], netGeos: THREE.BufferGeometry[] = [];
    const glowGeos: THREE.BufferGeometry[] = [];
    for (const team of [0, 1]) {
      const s = team === 0 ? -1 : 1;
      const r = 20;
      const Y = ARENA.Y + 8;
      for (const x of [-W, W]) {
        postGeos.push(new THREE.CylinderGeometry(r, r, H + r, 20).rotateX(Math.PI / 2).translate(x, s * Y, (H + r) / 2));
        supGeos.push(new THREE.CylinderGeometry(6, 6, H, 10).rotateX(Math.PI / 2).translate(x, s * (ARENA.Y + depth), H / 2));
        supGeos.push(new THREE.CylinderGeometry(6, 6, depth, 10).translate(x, s * (ARENA.Y + depth / 2), H));
      }
      postGeos.push(new THREE.CylinderGeometry(r, r, W * 2 + r * 2, 20).rotateZ(Math.PI / 2).translate(0, s * Y, H));
      // Redes: fondo, techo y laterales (subdivididas para poder deformarse)
      const yb = s * (ARENA.Y + depth), yf = s * ARENA.Y;
      netGeos.push(worldPlane(new THREE.Vector3(-W, yb, 0), new THREE.Vector3(2 * W, 0, 0), new THREE.Vector3(0, 0, H), 28, 10));
      netGeos.push(worldPlane(new THREE.Vector3(-W, yf, H - 2), new THREE.Vector3(2 * W, 0, 0), new THREE.Vector3(0, yb - yf, 0), 28, 12));
      for (const x of [-W + 2, W - 2]) netGeos.push(worldPlane(new THREE.Vector3(x, yf, 0), new THREE.Vector3(0, yb - yf, 0), new THREE.Vector3(0, 0, H), 12, 10));
      glowGeos.push(new THREE.PlaneGeometry(W * 2, 40).translate(0, s * (ARENA.Y + depth - 6), 2));
    }
    const postMat = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.3, metalness: 0.5 });
    const posts = new THREE.Mesh(mergeGeometries(postGeos), postMat);
    posts.castShadow = true;
    const supMat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.4, metalness: 0.7 });
    const sups = new THREE.Mesh(mergeGeometries(supGeos), supMat);
    const net = netTexture();
    const netMat = new THREE.MeshStandardMaterial({ map: net, alphaMap: net, color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, roughness: 1 });
    const u = this.netUniforms;
    netMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPin;
          uniform float uTime; uniform vec4 uImpactA; uniform vec4 uImpactB; uniform float uAmpA; uniform float uAmpB;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float sy = sign(transformed.y);
            vec4 imp = sy < 0.0 ? uImpactA : uImpactB;
            float amp = sy < 0.0 ? uAmpA : uAmpB;
            float t = uTime - imp.w;
            // Dirección de empuje: hacia afuera del arco
            vec3 mouth = vec3(0.0, sy * 5128.0, 260.0);
            vec3 dir = normalize(transformed - mouth + vec3(0.0, sy * 250.0, 0.0));
            float d = length(transformed - imp.xyz);
            // Las cuerdas quedan fijas en el piso, los postes y el travesaño
            float edge = aPin;
            float k = t > 0.0 ? exp(-t * 2.6) * cos(t * 13.0) : 0.0;
            float bulge = amp * k * exp(-d * d / (520.0 * 520.0)) * edge;
            float wind = sin(uTime * 1.3 + transformed.x * 0.004 + transformed.z * 0.006) * 2.5 * edge;
            transformed += dir * (bulge + wind);
          }`);
    };
    netMat.customProgramCacheKey = () => 'turbogol-net';
    const nets = new THREE.Mesh(mergeGeometries(netGeos), netMat);
    nets.renderOrder = 2;
    nets.frustumCulled = false;
    this.group.add(posts, sups, nets);
    for (const team of [0, 1]) this.group.add(new THREE.Mesh(glowGeos[team], new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], toneMapped: false })));
  }

  /** La pelota entró al arco del dueño `owner` (0 azul en -Y, 1 rojo en +Y) en `pos`, a velocidad `speed`. */
  impact(owner: number, pos: THREE.Vector3, speed: number) {
    const amp = Math.min(140, 40 + speed * 0.025);
    const t = this.netUniforms.uTime.value;
    if (owner === 0) {
      this.netUniforms.uImpactA.value.set(pos.x, Math.min(pos.y, -5400), pos.z, t);
      this.netUniforms.uAmpA.value = amp;
    } else {
      this.netUniforms.uImpactB.value.set(pos.x, Math.max(pos.y, 5400), pos.z, t);
      this.netUniforms.uAmpB.value = amp;
    }
  }

  update(time: number) { this.netUniforms.uTime.value = time; }
}

/** Compatibilidad: arcos como grupo simple. */
export function buildGoals(): THREE.Group { return new Goals().group; }
