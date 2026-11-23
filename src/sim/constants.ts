// Constantes de juego. Ver docs/01-estudio-referencia.md (números medidos por la comunidad).

export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;
export const GRAVITY = -650;

// --- Arena ---
export const ARENA = {
  X: 4096,
  Y: 5120,
  H: 2044,
  CHAMFER: 8064, // |x| + |y| <= CHAMFER
  FILLET: 256, // radio de las rampas piso↔pared y pared↔techo
  CORNER_R: 320, // radio de redondeo de las aristas verticales
  GOAL_HW: 893,
  GOAL_H: 642.775,
  GOAL_DEPTH: 880,
  GOAL_FILLET: 48,
  POST_ROUND: 40, // redondeo de postes y travesaño
  GOAL_LINE: 5124.25,
} as const;

// --- Pelota ---
export const BALL = {
  RADIUS: 91.25,
  VISUAL_RADIUS: 92.75,
  MASS: 30,
  RESTITUTION: 0.6,
  FRICTION: 0.28,
  DRAG: 0.03,
  MAX_SPEED: 6000,
  MAX_ANG: 6,
  REST_Z: 93.15,
} as const;

// --- Auto ---
export const CAR = {
  MASS: 180,
  MAX_SPEED: 2300,
  MAX_ANG: 5.5,
  REST_Z: 17, // altura del origen sobre la superficie
  SNAP_DIST: 7, // cuánto "baja" el auto para seguir la superficie antes de despegar
  THROTTLE_ACCEL: 1600,
  BRAKE_ACCEL: 3500,
  COAST_ACCEL: 525,
  STOP_SPEED: 25,
  AIR_THROTTLE: 200 / 3,
  BOOST_GROUND: 2975 / 3,
  BOOST_AIR: 3175 / 3,
  BOOST_PER_SEC: 100 / 3,
  BOOST_MIN_TIME: 0.1,
  BOOST_SPAWN: 100 / 3,
  JUMP_IMPULSE: 875 / 3,
  JUMP_ACCEL: 4375 / 3,
  JUMP_MIN_TIME: 0.025,
  JUMP_MAX_TIME: 0.2,
  DOUBLE_JUMP_WINDOW: 1.25,
  FLIP_IMPULSE: 500,
  FLIP_TIME: 0.65,
  FLIP_Z_DAMP: 0.35,
  FLIP_Z_DAMP_START: 0.15,
  FLIP_Z_DAMP_END: 0.21,
  FLIP_PITCHLOCK_EXTRA: 0.3,
  FLIP_TORQUE_ROLL: 260,
  FLIP_TORQUE_PITCH: 224,
  FLIP_SIDE_SCALE: 1.9,
  FLIP_BACK_SCALE: 2.5,
  FLIP_BACK_X: 16 / 15,
  DODGE_DEADZONE: 0.5,
  // Aceleraciones angulares en el aire (rad/s²): 2π/65536·1000 × (130, 95, 400)
  AIR_PITCH: 130 * ((2 * Math.PI) / 65536) * 1000,
  AIR_YAW: 95 * ((2 * Math.PI) / 65536) * 1000,
  AIR_ROLL: 400 * ((2 * Math.PI) / 65536) * 1000,
  DAMP_PITCH: 30 * ((2 * Math.PI) / 65536) * 1000,
  DAMP_YAW: 20 * ((2 * Math.PI) / 65536) * 1000,
  DAMP_ROLL: 50 * ((2 * Math.PI) / 65536) * 1000,
  SUPERSONIC: 2200,
  SUPERSONIC_KEEP: 2100,
  SUPERSONIC_KEEP_TIME: 1,
  POWERSLIDE_RISE: 5,
  POWERSLIDE_FALL: 2,
  DEMO_RESPAWN: 3,
  BUMP_COOLDOWN: 0.25,
  BUMP_MIN_FORWARD: 64.5,
  AUTOFLIP_IMPULSE: 200,
  AUTOFLIP_TIME: 0.4,
} as const;

// Curvas (entrada → salida), interpolación lineal.
export const THROTTLE_CURVE = [[0, 1], [1400, 0.1], [1410, 0]] as const;
// Curvatura máxima de giro (1/uu) según velocidad hacia adelante.
export const CURVATURE_CURVE = [
  [0, 0.0069], [500, 0.00398], [1000, 0.00235], [1500, 0.001375], [1750, 0.0011], [2300, 0.00088],
] as const;
export const STEER_ANGLE_CURVE = [[0, 0.53356], [500, 0.3193], [1000, 0.18203], [1500, 0.1057], [1750, 0.08507], [3000, 0.03454]] as const;
export const POWERSLIDE_STEER_CURVE = [[0, 0.39235], [2500, 0.1261]] as const;
export const LAT_FRICTION_CURVE = [[0, 1], [1, 0.2]] as const;
export const NON_STICKY_FRICTION_CURVE = [[0, 0.1], [0.7075, 0.5], [1, 1]] as const;
export const BALL_HIT_EXTRA_CURVE = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.3]] as const;
export const BUMP_GROUND_CURVE = [[0, 5 / 6], [1400, 1100], [2200, 1530]] as const;
export const BUMP_AIR_CURVE = [[0, 5 / 6], [1400, 1390], [2200, 1945]] as const;
export const BUMP_UP_CURVE = [[0, 2 / 6], [1400, 278], [2200, 417]] as const;

// --- Hitboxes (6 arquetipos). size = (largo, ancho, alto), offset = (adelante, 0, arriba) ---
export interface CarBody {
  id: string;
  name: string;
  size: [number, number, number];
  offset: [number, number, number];
  frontWheel: { r: number; x: number; y: number };
  backWheel: { r: number; x: number; y: number };
}

export const CAR_BODIES: CarBody[] = [
  { id: 'toro', name: 'Toro', size: [120.507, 86.6994, 38.6591], offset: [13.8757, 0, 20.755], frontWheel: { r: 12.5, x: 51.25, y: 25.9 }, backWheel: { r: 15, x: -33.75, y: 29.5 } },
  { id: 'flecha', name: 'Flecha', size: [130.427, 85.7799, 33.8], offset: [9, 0, 15.75], frontWheel: { r: 12, x: 50.3, y: 31.1 }, backWheel: { r: 13.5, x: -34.75, y: 33 } },
  { id: 'lamina', name: 'Lámina', size: [131.32, 87.1704, 31.8944], offset: [9.00857, 0, 12.0942], frontWheel: { r: 12.5, x: 49.97, y: 27.8 }, backWheel: { r: 17, x: -35.43, y: 20.28 } },
  { id: 'aguja', name: 'Aguja', size: [133.992, 83.021, 32.8], offset: [12.5, 0, 11.75], frontWheel: { r: 13.5, x: 51.5, y: 26.67 }, backWheel: { r: 15, x: -35.75, y: 35 } },
  { id: 'mixto', name: 'Mixto', size: [129.519, 84.6879, 36.6591], offset: [13.8757, 0, 20.755], frontWheel: { r: 12.5, x: 51.25, y: 25.9 }, backWheel: { r: 15, x: -34, y: 29.5 } },
  { id: 'furgon', name: 'Furgón', size: [123.22, 79.2103, 44.1591], offset: [11.3757, 0, 21.505], frontWheel: { r: 15, x: 51.25, y: 25.9 }, backWheel: { r: 15, x: -33.75, y: 29.5 } },
];

// --- Pads de turbo ---
export const PAD = {
  BIG_AMOUNT: 100,
  SMALL_AMOUNT: 12,
  BIG_COOLDOWN: 10,
  SMALL_COOLDOWN: 4,
  BIG_RADIUS: 208,
  SMALL_RADIUS: 144,
  HEIGHT: 95,
} as const;

export const BIG_PADS: [number, number][] = [
  [-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096], [-3072, -4096], [3072, -4096],
];

export const SMALL_PADS: [number, number][] = [
  [0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308], [0, -2816],
  [-3584, -2484], [3584, -2484], [-1788, -2300], [1788, -2300], [-2048, -1036], [0, -1024],
  [2048, -1036], [-1024, 0], [1024, 0], [-2048, 1036], [0, 1024], [2048, 1036],
  [-1788, 2300], [1788, 2300], [-3584, 2484], [3584, 2484], [0, 2816], [-940, 3308],
  [940, 3308], [-1792, 4184], [1792, 4184], [0, 4240],
];

// Kickoff (equipo azul; el rojo se espeja). [x, y, yaw]
export const KICKOFF_SPAWNS: [number, number, number][] = [
  [-2048, -2560, Math.PI / 4],
  [2048, -2560, (3 * Math.PI) / 4],
  [-256, -3840, Math.PI / 2],
  [256, -3840, Math.PI / 2],
  [0, -4608, Math.PI / 2],
];

export const RESPAWNS: [number, number, number][] = [
  [-2304, -4608, Math.PI / 2],
  [-2688, -4608, Math.PI / 2],
  [2304, -4608, Math.PI / 2],
  [2688, -4608, Math.PI / 2],
];

export const TEAM_NAMES = ['Azul', 'Rojo'] as const;
