// Calcomanías procedurales: se pintan en un canvas que se mapea sobre la carrocería (UV del loft).
// Convención UV de la carrocería (ver carMesh.loft):
//   u = (x/L + 0.55) / 1.1   → atrás (0) a adelante (1)
//   v = ángulo/2π desde abajo → 0 abajo, 0.25 lateral izquierdo (+Y), 0.5 techo, 0.75 lateral derecho (−Y)
// El canvas tiene flipY: la fila superior del canvas es v = 1.

import type { DecalId } from './cosmetics.ts';

export interface DecalParams {
  decal: DecalId;
  paint: string;
  secondary: string;
  number: number;
  /** Largo, ancho y alto del hitbox (uu). */
  L: number;
  W: number;
  H: number;
}

const SIZE = 1024;

interface Ctx { g: CanvasRenderingContext2D; uPx: number; vPx: number; cx: number; L: number }

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}

/** Dibuja en el lateral (coordenadas locales en uu: x = derecha en pantalla mirando ese lateral, y = abajo). */
function side(c: Ctx, which: 'izq' | 'der', fn: (g: CanvasRenderingContext2D) => void) {
  const { g } = c;
  g.save();
  if (which === 'izq') g.setTransform(-c.uPx, 0, 0, c.vPx, c.cx, SIZE * 0.75);
  else g.setTransform(c.uPx, 0, 0, -c.vPx, c.cx, SIZE * 0.25);
  fn(g);
  g.restore();
}

/** Dibuja en el techo/capó visto desde arriba con el frente hacia arriba (x = derecha del auto, y = hacia atrás). */
function top(c: Ctx, fn: (g: CanvasRenderingContext2D) => void) {
  const { g } = c;
  g.save();
  g.setTransform(0, -c.vPx, -c.uPx, 0, c.cx, SIZE * 0.5);
  fn(g);
  g.restore();
}

/** Dibuja en ambos laterales con el frente del auto siempre hacia el mismo lado del dibujo (x+ = atrás). */
function bothSides(c: Ctx, fn: (g: CanvasRenderingContext2D, front: number) => void) {
  // En el lateral izquierdo, x local + apunta hacia atrás; en el derecho, hacia adelante.
  side(c, 'izq', (g) => fn(g, -1));
  side(c, 'der', (g) => fn(g, 1));
}

export function paintDecal(p: DecalParams): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d')!;
  // Base: pintura primaria con un leve degradé vertical (más oscura abajo) para dar volumen
  const grd = g.createLinearGradient(0, 0, 0, SIZE);
  grd.addColorStop(0, shade(p.paint, 0.82));
  grd.addColorStop(0.25, shade(p.paint, 1.0));
  grd.addColorStop(0.5, shade(p.paint, 1.06));
  grd.addColorStop(0.75, shade(p.paint, 1.0));
  grd.addColorStop(1, shade(p.paint, 0.82));
  g.fillStyle = grd;
  g.fillRect(0, 0, SIZE, SIZE);

  const L = p.L;
  const perimeter = 2 * (p.W * 0.95 + p.H * 0.62) * 1.04;
  const c: Ctx = { g, uPx: SIZE / (1.1 * L), vPx: SIZE / perimeter, cx: SIZE / 2, L };
  const sec = p.secondary;
  const half = L / 2;

  // Juntas de puertas (detalle realista, siempre presentes)
  bothSides(c, (gg, f) => {
    gg.strokeStyle = 'rgba(0,0,0,0.28)';
    gg.lineWidth = 0.5;
    for (const x of [-0.04, 0.2]) {
      gg.beginPath();
      gg.moveTo(f * x * L, -9);
      gg.lineTo(f * x * L, 7);
      gg.stroke();
    }
  });

  switch (p.decal) {
    case 'ninguna':
      break;
    case 'franjas':
      bothSides(c, (gg, f) => {
        gg.fillStyle = sec;
        gg.beginPath();
        gg.moveTo(f * -0.48 * L, -1.5);
        gg.lineTo(f * 0.42 * L, -1.5);
        gg.lineTo(f * 0.36 * L, 1.8);
        gg.lineTo(f * -0.48 * L, 1.8);
        gg.closePath();
        gg.fill();
        gg.fillRect(f > 0 ? -0.48 * L : -0.3 * L, 3.2, 0.78 * L, 0.8);
      });
      break;
    case 'carrera':
      top(c, (gg) => {
        gg.fillStyle = sec;
        for (const x of [-9, 4]) gg.fillRect(x, -half * 1.1, 5, L * 1.1);
      });
      break;
    case 'numero':
      bothSides(c, (gg) => {
        gg.fillStyle = sec;
        gg.beginPath();
        gg.arc(0, -1, 11, 0, Math.PI * 2);
        gg.fill();
        gg.fillStyle = p.paint;
        gg.font = 'bold 15px "Arial Black", Arial, sans-serif';
        gg.textAlign = 'center';
        gg.textBaseline = 'middle';
        gg.fillText(String(p.number), 0, 0);
      });
      top(c, (gg) => {
        gg.fillStyle = sec;
        gg.font = 'bold 18px "Arial Black", Arial, sans-serif';
        gg.textAlign = 'center';
        gg.textBaseline = 'middle';
        gg.fillText(String(p.number), 0, -0.32 * L);
      });
      break;
    case 'geometrica':
      bothSides(c, (gg, f) => {
        const tris = [[-0.45, 0.25, 0.1], [-0.2, 0.15, 0.6], [0.05, 0.3, 0.35], [0.25, 0.1, 0.8], [-0.35, 0.05, 0.5]];
        tris.forEach(([x, w, a], i) => {
          gg.fillStyle = sec;
          gg.globalAlpha = 0.45 + a * 0.5;
          gg.beginPath();
          gg.moveTo(f * x * L, i % 2 ? 6 : -9);
          gg.lineTo(f * (x + w) * L, i % 2 ? -8 : 6);
          gg.lineTo(f * (x + w * 0.4) * L, i % 2 ? 7 : -2);
          gg.closePath();
          gg.fill();
        });
        gg.globalAlpha = 1;
      });
      break;
    case 'rayo':
      bothSides(c, (gg, f) => {
        gg.fillStyle = sec;
        const pts = [[-0.48, -3], [-0.1, -4], [-0.16, -0.5], [0.22, -1.5], [0.4, 0], [0.05, 1.2], [0.1, -1.6], [-0.48, 1.5]];
        gg.beginPath();
        pts.forEach(([x, y], i) => (i ? gg.lineTo(f * x * L, y) : gg.moveTo(f * x * L, y)));
        gg.closePath();
        gg.fill();
      });
      break;
    case 'ondas':
      bothSides(c, (gg, f) => {
        gg.strokeStyle = sec;
        for (let k = 0; k < 3; k++) {
          gg.lineWidth = 1.6 - k * 0.4;
          gg.beginPath();
          for (let i = 0; i <= 60; i++) {
            const x = -0.48 + (0.9 * i) / 60;
            const y = -3 + k * 3.4 + Math.sin(x * 22 + k) * 1.6;
            if (i === 0) gg.moveTo(f * x * L, y); else gg.lineTo(f * x * L, y);
          }
          gg.stroke();
        }
      });
      break;
    case 'damero':
      bothSides(c, (gg, f) => {
        const s = 3.2;
        for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
          if ((i + j) % 2) continue;
          gg.fillStyle = sec;
          gg.fillRect(f * (-0.48 * L + i * s) - (f < 0 ? s : 0), -7 + j * s, s, s);
        }
      });
      top(c, (gg) => {
        const s = 4;
        for (let i = -3; i < 3; i++) for (let j = 0; j < 3; j++) {
          if ((i + j) % 2) continue;
          gg.fillStyle = sec;
          gg.fillRect(i * s, 0.3 * L + j * s, s, s);
        }
      });
      break;
    case 'camuflaje': {
      let s = 1337 + p.number * 17;
      const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const cols = [shade(p.paint, 0.6), shade(p.paint, 1.25), sec, shade(sec, 0.7)];
      for (let i = 0; i < 160; i++) {
        g.fillStyle = cols[i % cols.length];
        g.globalAlpha = 0.85;
        const x = r() * SIZE, y = r() * SIZE, rr = 20 + r() * 60;
        g.beginPath();
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          const rad = rr * (0.6 + r() * 0.6);
          const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad * 0.7;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'llamas':
      bothSides(c, (gg, f) => {
        const flame = (col: string, scale: number) => {
          gg.fillStyle = col;
          gg.beginPath();
          gg.moveTo(f * 0.5 * L, -6 * scale);
          const tongues = [[0.28, -7], [0.12, -3], [0.02, -6.5], [-0.12, -2], [-0.2, -5], [-0.32, 0], [-0.22, 2], [-0.08, 3.5], [0.1, 2], [0.3, 4.5]];
          for (const [x, y] of tongues) gg.quadraticCurveTo(f * (x + 0.08) * L, y * scale * 0.4, f * x * L, y * scale);
          gg.lineTo(f * 0.5 * L, 5 * scale);
          gg.closePath();
          gg.fill();
        };
        flame(sec, 1.1);
        flame('#ffd23d', 0.75);
        flame('#fff3b0', 0.4);
      });
      break;
  }
  return cv;
}
