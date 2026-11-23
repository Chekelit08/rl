// Física del auto: manejo, adherencia a paredes, salto, doble salto, flip (con cancel),
// control aéreo, derrape, turbo, supersónico, auto-flip y colisión con la arena.

import { arenaDistance, arenaNormal, arenaRaycast } from './arena.ts';
import {
  CAR, type CarBody, CURVATURE_CURVE, LAT_FRICTION_CURVE, NON_STICKY_FRICTION_CURVE,
  POWERSLIDE_STEER_CURVE, STEER_ANGLE_CURVE, THROTTLE_CURVE,
} from './constants.ts';
import { clamp, curve, Quat, sign, V3 } from './math.ts';
import { boostRecharge, RULES } from './rules.ts';

export interface CarInput {
  throttle: number; // -1..1
  steer: number; // -1..1 (derecha +)
  pitch: number; // -1..1 (+ = nariz arriba)
  yaw: number; // -1..1 (derecha +)
  roll: number; // -1..1 (derecha +)
  jump: boolean;
  boost: boolean;
  handbrake: boolean;
}

export const emptyInput = (): CarInput => ({
  throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false,
});

const Z_UP = new V3(0, 0, 1);

export class Car {
  id: number;
  team: number;
  name: string;
  body: CarBody;
  isBot = false;

  pos = new V3();
  vel = new V3();
  q = new Quat();
  ang = new V3();
  boost = CAR.BOOST_SPAWN;
  unlimitedBoost = false;

  onGround = false;
  groundNormal = new V3(0, 0, 1);
  isJumping = false;
  jumpTime = 0;
  hasJumped = false;
  hasDoubleJumped = false;
  hasFlipped = false;
  isFlipping = false;
  flipTime = 0;
  flipFwd = 0; // dirección del flip (adelante +)
  flipRight = 0; // dirección del flip (derecha +)
  airTimeSinceJump = 0;
  isBoosting = false;
  boostingTime = 0;
  supersonic = false;
  supersonicTime = 0;
  handbrakeVal = 0;
  isAutoFlipping = false;
  autoFlipTimer = 0;
  autoFlipDir = 0;
  worldContactTimer = 0; // > 0 si el hitbox tocó la arena hace poco
  worldContactNormal = new V3(0, 0, 1);
  lastJumpInput = false;
  demoed = false;
  respawnTimer = 0;
  bumpCooldowns = new Map<number, number>();
  lastExtraHitTick = -10;
  input: CarInput = emptyInput();

  // Inercia (caja) para colisiones
  invInertia: V3;
  half: V3;
  offset: V3;

  stats = { goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, touches: 0, score: 0 };

  constructor(id: number, team: number, name: string, body: CarBody) {
    this.id = id;
    this.team = team;
    this.name = name;
    this.body = body;
    const [L, W, H] = body.size;
    this.half = new V3(L / 2, W / 2, H / 2);
    this.offset = new V3(body.offset[0], body.offset[1], body.offset[2]);
    const m = CAR.MASS;
    this.invInertia = new V3(
      12 / (m * (W * W + H * H)),
      12 / (m * (L * L + H * H)),
      12 / (m * (L * L + W * W)),
    );
  }

  forward() { return this.q.forward(); }
  up() { return this.q.up(); }
  left() { return this.q.left(); }
  hitboxCenter() { return this.pos.add(this.q.rotate(this.offset)); }
  speed() { return this.vel.len(); }

  /** Aplica I⁻¹ en coordenadas de mundo. */
  applyInvInertia(v: V3) {
    const l = this.q.unrotate(v);
    return this.q.rotate(l.mul(this.invInertia));
  }

  placeAt(x: number, y: number, yaw: number) {
    this.pos.set(x, y, CAR.REST_Z);
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    this.q = Quat.fromYPR(yaw);
    this.onGround = true;
    this.groundNormal.set(0, 0, 1);
    this.isJumping = false;
    this.hasJumped = false;
    this.hasDoubleJumped = false;
    this.hasFlipped = false;
    this.isFlipping = false;
    this.flipTime = 0;
    this.jumpTime = 0;
    this.airTimeSinceJump = 0;
    this.isBoosting = false;
    this.boostingTime = 0;
    this.supersonic = false;
    this.supersonicTime = 0;
    this.handbrakeVal = 0;
    this.isAutoFlipping = false;
    this.demoed = false;
    this.respawnTimer = 0;
  }

  /** Ángulo de roll respecto del "arriba" del mundo (0 = derecho, ±π = panza arriba). */
  rollAngle() {
    return Math.atan2(this.left().z, this.up().z);
  }
}

/** Avanza un tick de física del auto (sin colisiones con otros objetos). */
export function stepCar(c: Car, inp: CarInput, dt: number) {
  if (c.demoed) return;
  c.input = inp;
  const jumpPressed = inp.jump && !c.lastJumpInput;
  c.lastJumpInput = inp.jump;
  const groundAtStart = c.onGround;

  for (const [k, t] of c.bumpCooldowns) {
    if (t - dt <= 0) c.bumpCooldowns.delete(k);
    else c.bumpCooldowns.set(k, t - dt);
  }
  if (c.worldContactTimer > 0) c.worldContactTimer -= dt;

  // Derrape analógico
  c.handbrakeVal = clamp(c.handbrakeVal + (inp.handbrake ? CAR.POWERSLIDE_RISE : -CAR.POWERSLIDE_FALL) * dt, 0, 1);

  // Estado del turbo (se decide antes del manejo: el turbo fuerza el acelerador al máximo)
  updateBoostState(c, inp, dt);

  if (!(c.onGround && driveOnGround(c, inp, dt))) {
    airControl(c, inp, dt);
    c.vel.z += RULES.gravity * dt;
  }

  updateJump(c, inp, jumpPressed, dt, groundAtStart);
  updateAutoFlip(c, jumpPressed, dt);
  updateDoubleJumpOrFlip(c, inp, jumpPressed, dt, groundAtStart);
  updateAutoRoll(c, inp, dt);

  if (c.isBoosting) {
    const a = (c.onGround ? CAR.BOOST_GROUND : CAR.BOOST_AIR) * RULES.boostPower;
    c.vel.addScaledIn(c.forward(), a * dt);
  }

  // Integración
  c.vel.clampLenIn(CAR.MAX_SPEED);
  c.pos.addScaledIn(c.vel, dt);
  if (!c.onGround) c.q.integrateIn(c.ang, dt);

  if (c.onGround) followSurface(c, dt);
  else tryLand(c);

  collideArena(c);

  // Límites
  c.vel.clampLenIn(CAR.MAX_SPEED);
  c.ang.clampLenIn(CAR.MAX_ANG);

  // Supersónico
  const s2 = c.vel.len2();
  if (c.supersonic && c.supersonicTime < CAR.SUPERSONIC_KEEP_TIME) {
    c.supersonic = s2 >= CAR.SUPERSONIC_KEEP * CAR.SUPERSONIC_KEEP;
  } else {
    c.supersonic = s2 >= CAR.SUPERSONIC * CAR.SUPERSONIC;
  }
  c.supersonicTime = c.supersonic ? c.supersonicTime + dt : 0;

  if (c.unlimitedBoost) c.boost = 100;
}

function updateBoostState(c: Car, inp: CarInput, dt: number) {
  if (c.boost > 0) {
    if (c.isBoosting) c.isBoosting = inp.boost || c.boostingTime < CAR.BOOST_MIN_TIME;
    else c.isBoosting = inp.boost;
  } else {
    c.isBoosting = false;
  }
  if (c.isBoosting) {
    c.boostingTime += dt;
    c.boost = Math.max(0, c.boost - CAR.BOOST_PER_SEC * dt);
  } else {
    c.boostingTime = 0;
    // Mutador: recarga pasiva de turbo
    const re = boostRecharge(RULES.boostMode);
    if (re > 0) c.boost = Math.min(100, c.boost + re * dt);
  }
  if (RULES.boostMode === 'none') { c.boost = 0; c.isBoosting = false; }
}

/** Devuelve false si el auto se despegó de la superficie en este tick. */
function driveOnGround(c: Car, inp: CarInput, dt: number): boolean {
  const n = c.groundNormal;
  const throttle = c.isBoosting ? 1 : inp.throttle;
  const fwdRaw = c.forward();
  const fwd = fwdRaw.sub(n.scale(fwdRaw.dot(n))).normIn();
  const left = n.cross(fwd);

  // Gravedad + adherencia
  const absVf0 = Math.abs(c.vel.dot(fwd));
  let sticky = 0.5;
  if (throttle !== 0 || absVf0 > CAR.STOP_SPEED) sticky += 1 - Math.abs(n.z);
  const ext = new V3(0, 0, RULES.gravity).addScaledIn(n, RULES.gravity * sticky);
  const an = ext.dot(n);
  if (an > 0) {
    // La superficie no nos sostiene (techo): despegamos
    c.onGround = false;
    return false;
  }
  c.vel.addScaledIn(ext.sub(n.scale(an)), dt);

  let vf = c.vel.dot(fwd);
  let vl = c.vel.dot(left);
  const absVf = Math.abs(vf);
  const stickyContact = throttle !== 0;
  const nonSticky = stickyContact ? 1 : curve(NON_STICKY_FRICTION_CURVE, Math.max(0, n.z));

  // Acelerador / freno
  if (c.handbrakeVal > 0 && inp.handbrake) {
    vf += throttle * CAR.THROTTLE_ACCEL * curve(THROTTLE_CURVE, absVf) * dt;
  } else if (Math.abs(throttle) > 0.001) {
    if (absVf > CAR.STOP_SPEED && sign(throttle) !== sign(vf)) {
      vf = sign(vf) * Math.max(0, absVf - CAR.BRAKE_ACCEL * dt);
    } else {
      vf += throttle * CAR.THROTTLE_ACCEL * curve(THROTTLE_CURVE, absVf) * dt;
    }
  } else {
    const brake = (absVf < CAR.STOP_SPEED ? CAR.BRAKE_ACCEL : CAR.COAST_ACCEL) * nonSticky;
    vf = sign(vf) * Math.max(0, absVf - brake * dt);
  }

  // Fricción lateral (agarre / derrape)
  const slip = Math.abs(vl) > 5 ? Math.abs(vl) / (Math.abs(vf) + Math.abs(vl)) : 0;
  let lat = curve(LAT_FRICTION_CURVE, slip);
  if (c.handbrakeVal > 0) lat *= (0.1 - 1) * c.handbrakeVal + 1;
  lat *= nonSticky;
  vl *= Math.pow(1 - clamp(lat, 0, 1), dt * 120);

  c.vel = fwd.scale(vf).addScaledIn(left, vl);

  // Giro: curvatura según velocidad (y ampliada al derrapar)
  let k = curve(CURVATURE_CURVE, absVf);
  if (c.handbrakeVal > 0) {
    const ratio = curve(POWERSLIDE_STEER_CURVE, absVf) / curve(STEER_ANGLE_CURVE, absVf);
    k *= 1 + (ratio - 1) * c.handbrakeVal;
  }
  const yawRate = vf * k * inp.steer;
  c.ang = n.scale(-yawRate);
  c.q.integrateIn(c.ang, dt);
  return true;
}

function airControl(c: Car, inp: CarInput, dt: number) {
  if (c.isFlipping) c.isFlipping = c.hasFlipped && c.flipTime < CAR.FLIP_TIME;

  let doAirControl = true;
  if (c.isFlipping) {
    doAirControl = false;
    if (c.flipFwd !== 0 || c.flipRight !== 0) {
      let pitchScale = 1;
      if (c.flipFwd !== 0 && inp.pitch !== 0 && sign(inp.pitch) === sign(c.flipFwd)) {
        // Flip cancel
        pitchScale = 1 - Math.min(Math.abs(inp.pitch), 1);
        doAirControl = true;
      }
      const local = new V3(c.flipRight * CAR.FLIP_TORQUE_ROLL, c.flipFwd * pitchScale * CAR.FLIP_TORQUE_PITCH, 0);
      c.ang.addScaledIn(c.q.rotate(local), dt);
    } else {
      doAirControl = true; // flip sin dirección (stall)
    }
  }
  if (c.isAutoFlipping) doAirControl = false;

  if (doAirControl) {
    let pitchScale = 1;
    if (c.isFlipping) pitchScale = 0;
    else if (c.hasFlipped && c.flipTime < CAR.FLIP_TIME + CAR.FLIP_PITCHLOCK_EXTRA) pitchScale = 0;

    const wl = c.q.unrotate(c.ang);
    const torque = new V3(
      inp.roll * CAR.AIR_ROLL,
      -inp.pitch * pitchScale * CAR.AIR_PITCH,
      -inp.yaw * CAR.AIR_YAW,
    );
    const damp = new V3(
      wl.x * CAR.DAMP_ROLL,
      wl.y * CAR.DAMP_PITCH * (1 - Math.abs(inp.pitch * pitchScale)),
      wl.z * CAR.DAMP_YAW * (1 - Math.abs(inp.yaw)),
    );
    c.ang.addScaledIn(c.q.rotate(torque.sub(damp)), dt);
  }

  if (inp.throttle !== 0) c.vel.addScaledIn(c.forward(), inp.throttle * CAR.AIR_THROTTLE * dt);
}

function updateJump(c: Car, inp: CarInput, jumpPressed: boolean, dt: number, groundAtStart: boolean) {
  if (groundAtStart && !c.isJumping) {
    if (!(c.hasJumped && c.jumpTime < CAR.JUMP_MIN_TIME + 1 / 40)) {
      c.hasJumped = false;
      c.jumpTime = 0;
    }
  }

  if (c.isJumping) {
    c.isJumping = c.jumpTime < CAR.JUMP_MIN_TIME || (inp.jump && c.jumpTime < CAR.JUMP_MAX_TIME);
  } else if (groundAtStart && jumpPressed) {
    c.isJumping = true;
    c.jumpTime = 0;
    c.vel.addScaledIn(c.up(), CAR.JUMP_IMPULSE);
    c.onGround = false;
  }

  if (c.isJumping) {
    c.hasJumped = true;
    const a = CAR.JUMP_ACCEL * (c.jumpTime < CAR.JUMP_MIN_TIME ? 0.62 : 1);
    c.vel.addScaledIn(c.up(), a * dt);
  }
  if (c.isJumping || c.hasJumped) c.jumpTime += dt;
}

function updateDoubleJumpOrFlip(c: Car, inp: CarInput, jumpPressed: boolean, dt: number, groundAtStart: boolean) {
  if (groundAtStart) {
    c.hasDoubleJumped = false;
    c.hasFlipped = false;
    c.isFlipping = false;
    c.airTimeSinceJump = 0;
    c.flipTime = 0;
  } else {
    if (c.hasJumped && !c.isJumping) c.airTimeSinceJump += dt;
    else c.airTimeSinceJump = 0;

    if (jumpPressed && c.airTimeSinceJump < CAR.DOUBLE_JUMP_WINDOW && !c.hasDoubleJumped && !c.hasFlipped && !c.isAutoFlipping) {
      const mag = Math.abs(inp.yaw) + Math.abs(inp.pitch) + Math.abs(inp.roll);
      if (mag >= CAR.DODGE_DEADZONE) {
        c.flipTime = 0;
        c.hasFlipped = true;
        c.isFlipping = true;
        const fwd = c.forward();
        const fwdSpeed = c.vel.dot(fwd);
        const ratio = Math.abs(fwdSpeed) / CAR.MAX_SPEED;
        let df = -inp.pitch;
        let dr = inp.yaw + inp.roll;
        if (Math.abs(dr) < 0.1 && Math.abs(df) < 0.1) { df = 0; dr = 0; }
        else { const l = Math.hypot(df, dr); df /= l; dr /= l; }
        c.flipFwd = df;
        c.flipRight = dr;
        if (Math.abs(df) < 0.1) df = 0;
        if (Math.abs(dr) < 0.1) dr = 0;
        if (df !== 0 || dr !== 0) {
          const backwards = Math.abs(fwdSpeed) < 100 ? df < 0 : (df >= 0) !== (fwdSpeed >= 0);
          let ivf = df * CAR.FLIP_IMPULSE;
          let ivr = dr * CAR.FLIP_IMPULSE;
          const maxF = backwards ? CAR.FLIP_BACK_SCALE : 1;
          ivf *= (maxF - 1) * ratio + 1;
          ivr *= (CAR.FLIP_SIDE_SCALE - 1) * ratio + 1;
          if (backwards) ivf *= CAR.FLIP_BACK_X;
          let f2 = new V3(fwd.x, fwd.y, 0);
          if (f2.len2() < 1e-6) { const u = c.up(); f2 = new V3(-u.x, -u.y, 0); }
          f2.normIn();
          const r2 = new V3(f2.y, -f2.x, 0);
          c.vel.addScaledIn(f2, ivf).addScaledIn(r2, ivr);
        }
      } else {
        c.vel.addScaledIn(c.up(), CAR.JUMP_IMPULSE);
        c.hasDoubleJumped = true;
      }
    }
  }

  if (c.isFlipping) {
    c.flipTime += dt;
    if (c.flipTime <= CAR.FLIP_TIME && c.flipTime >= CAR.FLIP_Z_DAMP_START && (c.vel.z < 0 || c.flipTime < CAR.FLIP_Z_DAMP_END)) {
      c.vel.z *= Math.pow(1 - CAR.FLIP_Z_DAMP, dt * 120);
    }
  } else if (c.hasFlipped) {
    c.flipTime += dt;
  }
}

function updateAutoFlip(c: Car, jumpPressed: boolean, dt: number) {
  if (jumpPressed && !c.onGround && c.worldContactTimer > 0 && c.worldContactNormal.z > Math.SQRT1_2) {
    const roll = c.rollAngle();
    if (Math.abs(roll) > 2.8) {
      c.autoFlipTimer = CAR.AUTOFLIP_TIME * (Math.abs(roll) / Math.PI);
      c.autoFlipDir = roll > 0 ? -1 : 1;
      c.isAutoFlipping = true;
      c.vel.addScaledIn(c.up(), -CAR.AUTOFLIP_IMPULSE);
    }
  }
  if (c.isAutoFlipping) {
    if (c.autoFlipTimer <= 0) {
      c.isAutoFlipping = false;
      c.autoFlipTimer = 0;
    } else {
      c.ang.addScaledIn(c.forward(), 50 * c.autoFlipDir * dt);
      c.autoFlipTimer -= dt;
    }
  }
}

/** Si el auto quedó de costado apoyado y se acelera, rueda hacia la posición correcta. */
function updateAutoRoll(c: Car, inp: CarInput, dt: number) {
  if (c.onGround || c.isAutoFlipping || c.worldContactTimer <= 0) return;
  if (inp.throttle === 0 && !inp.boost) return;
  // Enderezar respecto de la superficie que estamos tocando (piso, rampa o pared), no del "arriba" del mundo:
  // si no, un auto caído de costado sobre la rampa de la pared no se endereza nunca y queda trabado.
  const n = c.worldContactNormal;
  if (n.z < -0.3) return; // techo: ahí no se apoya nadie
  const up = c.up();
  const align = up.dot(n);
  if (align > 0.95) return;
  const axis = up.cross(n);
  const fwd = c.forward(), left = c.left();
  let r = axis.dot(fwd), p = axis.dot(left);
  // Panza arriba exacta: el eje es nulo, elegimos girar sobre el eje largo
  // (siempre hacia el mismo lado salvo que ya esté claramente volcado hacia el otro)
  if (align < -0.8) { r = r < -0.12 ? -1 : 1; p = 0; }
  const k = align < 0 ? 26 : 18;
  c.ang.addScaledIn(fwd, clamp(r * 2.5, -1, 1) * k * dt);
  c.ang.addScaledIn(left, clamp(p * 2.5, -1, 1) * k * 0.6 * dt);
  // Un empujoncito hacia afuera para que el hitbox tenga lugar para girar, y adherencia cuando ya casi está
  c.vel.addScaledIn(n, (align < 0.5 ? 260 : -160) * dt);
}

/** Mantiene el auto pegado a la superficie (piso, rampas, paredes) o lo despega. */
function followSurface(c: Car, dt: number) {
  const up = c.up();
  const maxLen = CAR.REST_Z + CAR.SNAP_DIST;
  const hit = arenaRaycast(c.pos, up.neg(), maxLen + 4);
  if (!hit || hit.t > maxLen || hit.normal.dot(up) < 0.5) {
    c.onGround = false;
    return;
  }
  const n0 = c.groundNormal;
  const n1 = hit.normal;
  // Reposicionar a la altura de reposo
  c.pos.addScaledIn(up, CAR.REST_Z - hit.t);
  // Girar la velocidad al nuevo plano tangente (conserva la rapidez en las curvas)
  if (n0.dot(n1) < 0.99999) c.vel = Quat.between(n0, n1).rotate(c.vel);
  const vn = c.vel.dot(n1);
  c.vel.addScaledIn(n1, -vn);
  // Alinear la orientación con la superficie (limitado para aterrizajes suaves)
  const angle = Math.acos(clamp(up.dot(n1), -1, 1));
  const maxStep = 0.2;
  let align = Quat.between(up, n1);
  if (angle > maxStep) {
    const axis = up.cross(n1);
    align = Quat.axisAngle(axis, maxStep);
  }
  c.q = align.mul(c.q).normIn();
  if (angle > 1e-6) {
    const axis = up.cross(n1).normIn();
    c.ang.addScaledIn(axis, Math.min(angle, maxStep) / dt);
  }
  c.groundNormal = n1.clone();
}

function tryLand(c: Car) {
  if (c.isJumping) return;
  const up = c.up();
  const hit = arenaRaycast(c.pos, up.neg(), CAR.REST_Z + 6);
  if (!hit) return;
  const n = hit.normal;
  if (n.dot(up) < 0.7) return;
  const vn = c.vel.dot(n);
  if (vn > 50) return;
  // Superficies que no pueden sostener el auto (techo): sólo "tocamos" si chocamos contra ellas
  const an = RULES.gravity * n.z + RULES.gravity * (1.5 - Math.abs(n.z)); // aceleración normal con adherencia total
  if (an > 0 && vn > -100) return;
  c.onGround = true;
  c.groundNormal = n.clone();
  if (vn < 0) c.vel.addScaledIn(n, -vn);
  c.pos.addScaledIn(up, CAR.REST_Z - hit.t);
  c.ang = n.scale(c.ang.dot(n));
  c.isFlipping = false;
}

// 26 puntos del hitbox (esquinas, aristas y caras) en coordenadas unitarias
const HITBOX_POINTS: V3[] = [];
for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
  if (sx || sy || sz) HITBOX_POINTS.push(new V3(sx, sy, sz));
}

/** Colisión del hitbox con la arena (paredes, postes, techo, caer de costado o panza arriba). */
function collideArena(c: Car) {
  const center = c.hitboxCenter();
  if (arenaDistance(center.x, center.y, center.z) > 95) return;
  for (let iter = 0; iter < 3; iter++) {
    let worst = 0;
    let wp: V3 | null = null;
    for (const u of HITBOX_POINTS) {
      const local = c.offset.add(u.mul(c.half));
      const w = c.pos.add(c.q.rotate(local));
      const d = arenaDistance(w.x, w.y, w.z);
      if (d < worst) { worst = d; wp = w; }
    }
    if (!wp) return;
    const n = arenaNormal(wp.x, wp.y, wp.z);
    if (c.onGround && n.dot(c.groundNormal) > 0.7) {
      // Es la superficie por la que manejamos: sólo corregimos posición
      c.pos.addScaledIn(n, -worst);
      continue;
    }
    c.pos.addScaledIn(n, -worst);
    c.worldContactTimer = 0.1;
    c.worldContactNormal = n;
    resolveStaticContact(c, wp.add(n.scale(-worst)), n, 0.3, 0.3);
  }
}

/** Impulso contra una superficie estática (restitución e, fricción mu). */
export function resolveStaticContact(c: Car, p: V3, n: V3, e: number, mu: number) {
  const m = CAR.MASS;
  const r = p.sub(c.pos);
  const linearOnly = c.onGround;
  const vp = linearOnly ? c.vel.clone() : c.vel.add(c.ang.cross(r));
  const vn = vp.dot(n);
  if (vn >= 0) return;
  let k = 1 / m;
  if (!linearOnly) k += n.dot(c.applyInvInertia(r.cross(n)).cross(r));
  const jn = (-(1 + e) * vn) / k;
  c.vel.addScaledIn(n, jn / m);
  if (!linearOnly) c.ang.addIn(c.applyInvInertia(r.cross(n.scale(jn))));
  const vt = vp.sub(n.scale(vn));
  const vtl = vt.len();
  if (vtl > 1e-3) {
    const t = vt.scale(1 / vtl);
    let kt = 1 / m;
    if (!linearOnly) kt += t.dot(c.applyInvInertia(r.cross(t)).cross(r));
    const jt = Math.min(vtl / kt, mu * jn);
    c.vel.addScaledIn(t, -jt / m);
    if (!linearOnly) c.ang.subIn(c.applyInvInertia(r.cross(t.scale(jt))));
  }
}

export { Z_UP };
