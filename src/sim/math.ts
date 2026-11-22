// Matemática mínima y sin dependencias para la simulación (corre en navegador y Node).
// Convención del mundo: Z arriba, unidades = uu (1 uu = 1 cm).
// Convención local del auto: +X adelante, +Y izquierda, +Z arriba.

export class V3 {
  x: number; y: number; z: number;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }

  static of(x: number, y: number, z: number) { return new V3(x, y, z); }
  clone() { return new V3(this.x, this.y, this.z); }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }

  add(v: V3) { return new V3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v: V3) { return new V3(this.x - v.x, this.y - v.y, this.z - v.z); }
  scale(s: number) { return new V3(this.x * s, this.y * s, this.z * s); }
  mul(v: V3) { return new V3(this.x * v.x, this.y * v.y, this.z * v.z); }
  neg() { return new V3(-this.x, -this.y, -this.z); }

  addIn(v: V3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  subIn(v: V3) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scaleIn(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledIn(v: V3, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }

  dot(v: V3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: V3) {
    return new V3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  len2() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  norm() {
    const l = this.len();
    return l > 1e-9 ? this.scale(1 / l) : new V3();
  }
  normIn() {
    const l = this.len();
    if (l > 1e-9) this.scaleIn(1 / l);
    return this;
  }
  dist(v: V3) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v: V3, t: number) {
    return new V3(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t);
  }
  clampLenIn(max: number) {
    const l2 = this.len2();
    if (l2 > max * max) this.scaleIn(max / Math.sqrt(l2));
    return this;
  }
  isZero() { return this.x === 0 && this.y === 0 && this.z === 0; }
}

export class Quat {
  x: number; y: number; z: number; w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }

  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  copy(q: Quat) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }

  static axisAngle(axis: V3, angle: number) {
    const a = axis.norm();
    const s = Math.sin(angle / 2);
    return new Quat(a.x * s, a.y * s, a.z * s, Math.cos(angle / 2));
  }

  /** Yaw (alrededor de Z), luego pitch (alrededor de Y local), luego roll (X local). */
  static fromYPR(yaw: number, pitch = 0, roll = 0) {
    const qy = Quat.axisAngle(new V3(0, 0, 1), yaw);
    const qp = Quat.axisAngle(new V3(0, 1, 0), pitch);
    const qr = Quat.axisAngle(new V3(1, 0, 0), roll);
    return qy.mul(qp).mul(qr);
  }

  /** Rotación mínima que lleva el vector unitario a hacia b. */
  static between(a: V3, b: V3) {
    const d = a.dot(b);
    if (d > 0.999999) return new Quat();
    if (d < -0.999999) {
      let axis = new V3(1, 0, 0).cross(a);
      if (axis.len2() < 1e-6) axis = new V3(0, 1, 0).cross(a);
      return Quat.axisAngle(axis, Math.PI);
    }
    const c = a.cross(b);
    return new Quat(c.x, c.y, c.z, 1 + d).normIn();
  }

  mul(q: Quat) {
    return new Quat(
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
    );
  }

  conj() { return new Quat(-this.x, -this.y, -this.z, this.w); }

  normIn() {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= l; this.y /= l; this.z /= l; this.w /= l;
    return this;
  }

  /** Rota un vector (local → mundo). */
  rotate(v: V3) {
    const { x, y, z, w } = this;
    const ix = w * v.x + y * v.z - z * v.y;
    const iy = w * v.y + z * v.x - x * v.z;
    const iz = w * v.z + x * v.y - y * v.x;
    const iw = -x * v.x - y * v.y - z * v.z;
    return new V3(
      ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x,
    );
  }

  /** Rota inverso (mundo → local). */
  unrotate(v: V3) { return this.conj().rotate(v); }

  forward() { return this.rotate(new V3(1, 0, 0)); }
  left() { return this.rotate(new V3(0, 1, 0)); }
  up() { return this.rotate(new V3(0, 0, 1)); }

  /** Integra una velocidad angular en mundo (rad/s) durante dt. */
  integrateIn(w: V3, dt: number) {
    const angle = w.len() * dt;
    if (angle < 1e-9) return this;
    const dq = Quat.axisAngle(w, angle);
    const r = dq.mul(this).normIn();
    return this.copy(r);
  }

  slerp(q: Quat, t: number) {
    let { x, y, z, w } = q;
    let cos = this.x * x + this.y * y + this.z * z + this.w * w;
    if (cos < 0) { cos = -cos; x = -x; y = -y; z = -z; w = -w; }
    if (cos > 0.9995) {
      return new Quat(
        this.x + (x - this.x) * t, this.y + (y - this.y) * t,
        this.z + (z - this.z) * t, this.w + (w - this.w) * t,
      ).normIn();
    }
    const th = Math.acos(cos);
    const s = Math.sin(th);
    const a = Math.sin((1 - t) * th) / s;
    const b = Math.sin(t * th) / s;
    return new Quat(this.x * a + x * b, this.y * a + y * b, this.z * a + z * b, this.w * a + w * b);
  }
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Curva lineal por tramos: puntos [x, y] ordenados por x. Fuera de rango se mantiene el extremo. */
export function curve(points: ReadonlyArray<readonly [number, number]>, x: number) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** PRNG determinista (mulberry32) para que kickoffs y bots sean reproducibles. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
