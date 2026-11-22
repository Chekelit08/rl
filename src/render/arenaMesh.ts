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

/** Material de paredes: vidrio oscuro con patrón de rombos, tinte por equipo y franja luminosa en la base. */
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
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos; varying vec3 vNor;
      void main() {
        vPos = position; vNor = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBlue; uniform vec3 uRed; uniform float uTime; uniform vec3 uCam;
      varying vec3 vPos; varying vec3 vNor;
      float lineGrid(vec2 p, float s, float w) {
        vec2 q = abs(fract(p / s) - 0.5);
        float d = min(q.x, q.y) * s;
        return 1.0 - smoothstep(w * 0.5, w, d);
      }
      void main() {
        vec3 n = normalize(vNor);
        // Coordenadas sobre la superficie (triplanar simple)
        vec3 an = abs(n);
        vec2 uv = an.x > an.y && an.x > an.z ? vPos.yz : (an.y > an.z ? vPos.xz : vPos.xy);
        // Rombos: rejilla rotada 45°
        vec2 r = vec2(uv.x + uv.y, uv.x - uv.y) * 0.70710678;
        float g1 = lineGrid(r, 360.0, 7.0);
        float g2 = lineGrid(r, 1440.0, 14.0);
        float team = smoothstep(-2500.0, 2500.0, vPos.y);
        vec3 tint = mix(uBlue, uRed, team);
        vec3 base = mix(vec3(0.03, 0.06, 0.12), tint * 0.25, 0.35);
        float floorGlow = (1.0 - smoothstep(0.0, 90.0, vPos.z)) * smoothstep(-1.0, 4.0, vPos.z);
        float topGlow = smoothstep(ARENA_H - 60.0, ARENA_H - 4.0, vPos.z);
        vec3 V = normalize(uCam - vPos);
        float fres = pow(1.0 - max(dot(V, n), 0.0), 3.0);
        vec3 col = base + tint * (g1 * 0.35 + g2 * 0.6) + tint * floorGlow * 1.6 + vec3(0.6, 0.8, 1.0) * topGlow * 0.4;
        col += vec3(0.25, 0.4, 0.6) * fres * 0.5;
        float alpha = 0.28 + g1 * 0.25 + g2 * 0.35 + floorGlow * 0.6 + fres * 0.25;
        // Distancia: las paredes lejanas más tenues para no tapar el estadio
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
        #include <colorspace_fragment>
      }`.replace(/ARENA_H/g, ARENA.H.toFixed(1)),
  });
}

/** Contorno del piso (octógono redondeado + arcos), en el plano XY. */
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

/** Textura del césped con líneas (diseño propio). */
function floorTexture(): THREE.CanvasTexture {
  const W = 2048, H = 3000; // 4 uu por px
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const sx = W / 8192, sy = H / 12000;
  const X = (x: number) => (x + 4096) * sx;
  const Y = (y: number) => H - (y + 6000) * sy;

  // Franjas de césped (cortadas en diagonal suave)
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? '#1d5a3a' : '#1a5235';
    g.fillRect(0, Y(-6000 + (i + 1) * 500), W, 500 * sy + 1);
  }
  // Tinte por mitad de cancha
  const grad = g.createLinearGradient(0, Y(-6000), 0, Y(6000));
  grad.addColorStop(0, 'rgba(46,139,255,0.30)');
  grad.addColorStop(0.42, 'rgba(46,139,255,0.06)');
  grad.addColorStop(0.58, 'rgba(255,51,85,0.06)');
  grad.addColorStop(1, 'rgba(255,51,85,0.30)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Ruido sutil
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  g.strokeStyle = 'rgba(235,245,255,0.85)';
  g.lineWidth = 6;
  g.lineJoin = 'round';
  // Línea media y círculo central
  g.beginPath(); g.moveTo(X(-4096), Y(0)); g.lineTo(X(4096), Y(0)); g.stroke();
  g.beginPath(); g.ellipse(X(0), Y(0), 1000 * sx, 1000 * sy, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.ellipse(X(0), Y(0), 140 * sx, 140 * sy, 0, 0, Math.PI * 2); g.stroke();
  // Áreas (diseño propio: rectángulo con esquinas redondeadas + semicírculo)
  for (const s of [-1, 1]) {
    const yl = s * 5120;
    g.beginPath();
    g.moveTo(X(-1700), Y(yl));
    g.lineTo(X(-1700), Y(yl - s * 1150));
    g.quadraticCurveTo(X(-1700), Y(yl - s * 1400), X(-1450), Y(yl - s * 1400));
    g.lineTo(X(1450), Y(yl - s * 1400));
    g.quadraticCurveTo(X(1700), Y(yl - s * 1400), X(1700), Y(yl - s * 1150));
    g.lineTo(X(1700), Y(yl));
    g.stroke();
    g.beginPath();
    g.ellipse(X(0), Y(yl - s * 1400), 600 * sx, 600 * sy, 0, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : Math.PI * 2);
    g.stroke();
    g.beginPath(); g.moveTo(X(-893), Y(yl)); g.lineTo(X(893), Y(yl)); g.lineWidth = 10; g.stroke(); g.lineWidth = 6;
  }
  // Logo central
  g.save();
  g.translate(X(0), Y(0));
  g.font = 'italic 900 64px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.fillText('TURBOGOL', 0, 0);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildFloor(): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(floorShape());
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 4096) / 8192, (p.getY(i) + 6000) / 12000);
  const mat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.92, metalness: 0 });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** Textura de red (tile). */
function netTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 3;
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
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const color = new THREE.Color(TEAM_COLORS[team]);
    const frameMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.2 });
    const r = 22;
    const H = ARENA.GOAL_H, W = ARENA.GOAL_HW, Y = ARENA.Y + 10;
    // Postes
    for (const x of [-W, W]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, H, 16), frameMat);
      post.rotation.x = Math.PI / 2;
      post.position.set(x, s * Y, H / 2);
      grp.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, W * 2 + r * 2, 16), frameMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, s * Y, H);
    grp.add(bar);
    // Red: fondo, techo y laterales
    const mk = (w: number, h: number, rep: [number, number]) => {
      const t = net.clone();
      t.needsUpdate = true;
      t.repeat.set(rep[0], rep[1]);
      return new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: t, color: color.clone().lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      );
    };
    const depth = ARENA.GOAL_DEPTH - 10;
    const back = mk(W * 2, H, [W / 40, H / 40]);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, s * (ARENA.Y + depth), H / 2);
    grp.add(back);
    const top = mk(W * 2, depth, [W / 40, depth / 80]);
    top.position.set(0, s * (ARENA.Y + depth / 2), H - 2);
    grp.add(top);
    for (const x of [-W, W]) {
      const side = mk(depth, H, [depth / 80, H / 40]);
      side.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      side.position.set(x + Math.sign(x) * -2, s * (ARENA.Y + depth / 2), H / 2);
      grp.add(side);
    }
    // Luz de fondo del arco
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 2, 60),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    glow.position.set(0, s * (ARENA.Y + depth - 4), 4);
    glow.rotation.x = Math.PI / 2;
    grp.add(glow);
  }
  return grp;
}
