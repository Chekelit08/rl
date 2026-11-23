// Parámetros de ajuste de los bots, agrupados por dificultad.
// Todo lo "tuneable" vive acá para poder retocarlo sin tocar la lógica.

export type Difficulty = 0 | 1 | 2;
export const DIFFICULTY_NAMES = ['Novato', 'Profesional', 'Leyenda'];

export interface BotParams {
  /** Cada cuántos segundos se replanifica (tiempo de reacción). */
  replan: number;
  /** Error de puntería (radianes, desvío aleatorio del objetivo de tiro). */
  aimError: number;
  /** Acelerador máximo en conducción normal. */
  maxThrottle: number;
  /** Ganancia del volante (más alto = giros más agresivos). */
  steerGain: number;
  /** Usa derrape para girar en seco. */
  powerslide: boolean;
  /** Usa turbo para llegar más rápido. */
  useBoost: boolean;
  /** Probabilidad de rematar con flip cuando la jugada lo permite. */
  flipShot: number;
  /** Altura máxima de pelota que intenta con salto simple / doble (uu, centro de la pelota). */
  jumpShotMax: number;
  doubleJumpMax: number;
  /** Altura máxima de aéreo (0 = no hace aéreos) y turbo mínimo para intentarlo. */
  aerialMax: number;
  aerialMinBoost: number;
  /** Precisión de la guía aérea (0..1). */
  aerialSkill: number;
  /** Nivel de rotación: 0 = persigue la pelota, 1 = básica, 2 = completa (1.º/2.º/3.er hombre). */
  rotation: 0 | 1 | 2;
  /** Mecánicas avanzadas. */
  speedFlip: boolean;
  waveDash: boolean;
  halfFlip: boolean;
  dribble: boolean;
  demos: boolean;
  shadowDefense: boolean;
  boostManagement: boolean;
  /** Controla la velocidad para llegar justo a tiempo a la pelota. */
  arrivalControl: boolean;
  /** Ganancias del control aéreo (proporcional, derivativo). */
  airKp: number;
  airKd: number;
  /** Probabilidad por segundo de "dudar" (soltar el acelerador un instante). */
  hesitation: number;
  /** Margen de seguridad (s) al decidir si llega a una intercepción. */
  etaMargin: number;
}

export const PARAMS: Record<Difficulty, BotParams> = {
  0: {
    replan: 0.45,
    aimError: 0.32,
    maxThrottle: 0.78,
    steerGain: 2.2,
    powerslide: false,
    useBoost: false,
    flipShot: 0.15,
    jumpShotMax: 0,
    doubleJumpMax: 0,
    aerialMax: 0,
    aerialMinBoost: 100,
    aerialSkill: 0,
    rotation: 0,
    speedFlip: false,
    waveDash: false,
    halfFlip: false,
    dribble: false,
    demos: false,
    shadowDefense: false,
    boostManagement: false,
    arrivalControl: false,
    airKp: 2.6,
    airKd: 0.55,
    hesitation: 0.35,
    etaMargin: 0.35,
  },
  1: {
    replan: 0.12,
    aimError: 0.12,
    maxThrottle: 1,
    steerGain: 3.2,
    powerslide: true,
    useBoost: true,
    flipShot: 0.8,
    jumpShotMax: 300,
    doubleJumpMax: 430,
    aerialMax: 900,
    aerialMinBoost: 45,
    aerialSkill: 0.6,
    rotation: 1,
    speedFlip: false,
    waveDash: false,
    halfFlip: true,
    dribble: false,
    demos: false,
    shadowDefense: true,
    boostManagement: true,
    arrivalControl: true,
    airKp: 4.4,
    airKd: 0.8,
    hesitation: 0.05,
    etaMargin: 0.12,
  },
  2: {
    replan: 1 / 30,
    aimError: 0.035,
    maxThrottle: 1,
    steerGain: 3.8,
    powerslide: true,
    useBoost: true,
    flipShot: 1,
    jumpShotMax: 320,
    doubleJumpMax: 520,
    aerialMax: 1800,
    aerialMinBoost: 30,
    aerialSkill: 1,
    rotation: 2,
    speedFlip: true,
    waveDash: true,
    halfFlip: true,
    dribble: true,
    demos: true,
    shadowDefense: true,
    boostManagement: true,
    arrivalControl: true,
    airKp: 5.6,
    airKd: 0.92,
    hesitation: 0,
    etaMargin: 0.04,
  },
};

/** Constantes geométricas y de estrategia compartidas (no dependen de la dificultad). */
export const TUNING = {
  /** Distancia detrás de la pelota a la que se alinea antes de pegarle (uu). */
  approachBack: 520,
  /** Distancia de contacto (centro de la pelota ↔ centro del auto) para un golpe de frente. */
  contactDist: 150,
  /** Posición del 2.º hombre detrás de la pelota (uu). */
  supportDepth: 2300,
  /** Distancia del 3.er hombre al arco propio (mín./máx.). */
  lastManMin: 700,
  lastManMax: 2200,
  /** Turbo por debajo del cual el apoyo busca pads. */
  lowBoost: 45,
  /** Desvío máximo aceptado para pasar por un pad grande / chico (uu). */
  bigPadDetour: 1600,
  smallPadDetour: 420,
  /** Tiempo (s) desde el que se considera una amenaza un tiro al arco propio. */
  threatTime: 2.6,
  /** Histéresis de roles: ventaja de tiempo que necesita otro para quitarle el rol de 1.er hombre (s). */
  roleHysteresis: 0.3,
};
