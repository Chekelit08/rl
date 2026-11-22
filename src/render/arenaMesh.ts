// Malla visual de la arena generada desde la misma SDF de colisión (Surface Nets),
// más el piso con sus líneas, los arcos (marco + red) y el material de las paredes.

import * as THREE from 'three';
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
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos; varying vec3 vNor;
      void main() {
        vPos = position; vNor = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBlue; uniform vec3 uRed; uniform float uTime; uniform vec3 uCam; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uBoard;
      varying vec3 vPos; varying vec3 vNor;
      float line(float v, float s, float w) { float d = abs(fract(v / s) - 0.5) * s; return 1.0 - smoothstep(w * 0.5, w, d); }
      void main() {
        // Dentro del arco: sólo se ven las redes
        if (abs(vPos.y) > 5135.0 && abs(vPos.x) < 905.0 && vPos.z < 655.0) discard;
        vec3 n = normalize(vNor);
        vec3 V = normalize(uCam - vPos);
        float team = smoothstep(-1800.0, 1800.0, vPos.y);
        vec3 tint = mix(uBlue, uRed, team);
        float fres = pow(1.0 - max(dot(V, n), 0.0), 4.0);
        float diff = max(dot(n, uSunDir), 0.0) * 0.6 + 0.4;
        // Coordenada a lo largo de la pared (para montantes verticales)
        vec3 an = abs(n);
        float along = an.x > an.y ? vPos.y : vPos.x;
        float boardTop = 300.0;
        vec3 col; float alpha;
        if (vPos.z < boardTop) {
          // Tablero acolchado: paneles con juntas y franja de equipo arriba
          float joint = line(along, 512.0, 6.0);
          float stripe = smoothstep(boardTop - 42.0, boardTop - 34.0, vPos.z) * (1.0 - smoothstep(boardTop - 10.0, boardTop - 2.0, vPos.z));
          col = mix(uBoard, uBoard * 0.6, joint) * diff;
          col = mix(col, tint * 1.1, stripe);
          col += vec3(0.15) * fres;
          alpha = 1.0;
        } else {
          // Vidrio: casi transparente, montantes metálicos y reflejo del cielo
          float mull = line(along, 1024.0, 14.0);
          float rail = line(vPos.z, 680.0, 10.0) * step(boardTop + 40.0, vPos.z);
          float top = smoothstep(ARENA_H - 70.0, ARENA_H - 20.0, vPos.z);
          vec3 glass = mix(vec3(0.75, 0.85, 0.95), tint, 0.25) * 0.25;
          col = glass + uSky * fres * 0.9;
          alpha = 0.06 + fres * 0.45;
          vec3 metal = vec3(0.55, 0.6, 0.66) * diff;
          col = mix(col, metal, max(mull, rail) * 0.9);
          alpha = max(alpha, max(mull, rail) * 0.85);
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

/** Césped natural cortado en franjas, con líneas blancas. */
function floorTexture(): THREE.CanvasTexture {
  const W = 2048, H = 3000; // 4 uu por px
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const sx = W / 8192, sy = H / 12000;
  const X = (x: number) => (x + 4096) * sx;
  const Y = (y: number) => H - (y + 6000) * sy;

  // Franjas de corte (claras/oscuras) a lo largo
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? '#3f7d33' : '#356d2b';
    g.fillRect(0, Y(-6000 + (i + 1) * 500), W, 500 * sy + 1);
  }
  // Variación orgánica: manchas suaves
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 20 + Math.random() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const c = Math.random() < 0.5 ? '255,255,200' : '0,30,0';
    grd.addColorStop(0, `rgba(${c},0.05)`);
    grd.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Grano fino
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n * 0.7; img.data[i + 1] += n; img.data[i + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
  // Tinte de equipo muy sutil en cada área
  for (const [t, y0] of [[0, -5120], [1, 5120]] as const) {
    const grd = g.createLinearGradient(0, Y(y0), 0, Y(y0 * 0.6));
    grd.addColorStop(0, t === 0 ? 'rgba(46,139,255,0.16)' : 'rgba(255,51,85,0.16)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, Math.min(Y(y0), Y(y0 * 0.6)), W, Math.abs(Y(y0) - Y(y0 * 0.6)));
  }

  g.strokeStyle = 'rgba(245,248,250,0.9)';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.beginPath(); g.moveTo(X(-4096), Y(0)); g.lineTo(X(4096), Y(0)); g.stroke();
  g.beginPath(); g.ellipse(X(0), Y(0), 1000 * sx, 1000 * sy, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(245,248,250,0.9)';
  g.beginPath(); g.ellipse(X(0), Y(0), 40 * sx, 40 * sy, 0, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    const yl = s * 5120;
    // Área grande y área chica
    g.strokeRect(X(-1800), Math.min(Y(yl), Y(yl - s * 1500)), 3600 * sx, 1500 * sy);
    g.strokeRect(X(-1150), Math.min(Y(yl), Y(yl - s * 560)), 2300 * sx, 560 * sy);
    // Medialuna
    g.beginPath();
    g.ellipse(X(0), Y(yl - s * 1500), 700 * sx, 700 * sy, 0, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : Math.PI * 2);
    g.stroke();
    // Línea de gol reforzada
    g.save(); g.lineWidth = 11; g.beginPath(); g.moveTo(X(-893), Y(yl)); g.lineTo(X(893), Y(yl)); g.stroke(); g.restore();
  }
  // Logo central pintado en el césped
  g.save();
  g.translate(X(0), Y(0));
  g.font = 'italic 900 66px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillText('TURBOGOL', 0, 0);
  g.restore();

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
    // hojas: trazos cortos
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

export function buildFloor(): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(floorShape());
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 4096) / 8192, (p.getY(i) + 6000) / 12000);
  const mat = new THREE.MeshStandardMaterial({
    map: floorTexture(), normalMap: grassNormal(), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.96, metalness: 0,
  });
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

export function buildGoals(): THREE.Group {
  const grp = new THREE.Group();
  const net = netTexture();
  const postMat = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.3, metalness: 0.5 });
  const supportMat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.4, metalness: 0.7 });
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const color = new THREE.Color(TEAM_COLORS[team]);
    const r = 20;
    const H = ARENA.GOAL_H, W = ARENA.GOAL_HW, Y = ARENA.Y + 8;
    const depth = ARENA.GOAL_DEPTH - 12;
    // Postes y travesaño blancos
    for (const x of [-W, W]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, H, 20), postMat);
      post.rotation.x = Math.PI / 2;
      post.position.set(x, s * Y, H / 2);
      post.castShadow = true;
      grp.add(post);
      // Soportes traseros
      const back = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, H, 10), supportMat);
      back.rotation.x = Math.PI / 2;
      back.position.set(x, s * (ARENA.Y + depth), H / 2);
      grp.add(back);
      const topBar = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, depth, 10), supportMat);
      topBar.position.set(x, s * (ARENA.Y + depth / 2), H);
      grp.add(topBar);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, W * 2 + r * 2, 20), postMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, s * Y, H);
    bar.castShadow = true;
    grp.add(bar);
    // Red
    const mk = (w: number, h: number, rep: [number, number]) => {
      const t = net.clone();
      t.needsUpdate = true;
      t.repeat.set(rep[0], rep[1]);
      return new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: t, alphaMap: t, color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }),
      );
    };
    const back = mk(W * 2, H, [W / 32, H / 32]);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, s * (ARENA.Y + depth), H / 2);
    grp.add(back);
    const top = mk(W * 2, depth, [W / 32, depth / 64]);
    top.position.set(0, s * (ARENA.Y + depth / 2), H - 2);
    grp.add(top);
    for (const x of [-W, W]) {
      const side = mk(depth, H, [depth / 64, H / 32]);
      side.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      side.position.set(x - Math.sign(x) * 2, s * (ARENA.Y + depth / 2), H / 2);
      grp.add(side);
    }
    // Iluminación de equipo dentro del arco (franja en el piso del fondo)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 40), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    glow.position.set(0, s * (ARENA.Y + depth - 6), 2);
    grp.add(glow);
  }
  return grp;
}
