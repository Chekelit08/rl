// Mutadores: reglas de física y de partido que se pueden cambiar por partida.
// RULES es el juego de reglas activo; cada World aplica las suyas al empezar cada tick,
// así dos mundos con reglas distintas (por ejemplo el partido y el fondo del menú) no se pisan.
// Con los valores por defecto la simulación es idéntica a la estándar (online y competitivo no los tocan).

export type BoostMode = 'normal' | 'unlimited' | 'slow' | 'fast' | 'none';
export type DemoMode = 'normal' | 'off' | 'contact';

export interface Rules {
  /** Gravedad en uu/s² (negativa). */
  gravity: number;
  /** Rebote de la pelota contra la arena (0–1). */
  ballBounce: number;
  /** Velocidad máxima de la pelota (uu/s). */
  ballMaxSpeed: number;
  /** Multiplicador de la masa de la pelota (1 = estándar). */
  ballMass: number;
  boostMode: BoostMode;
  /** Multiplicador de la aceleración del turbo. */
  boostPower: number;
  demo: DemoMode;
  /** El partido termina cuando un equipo llega a esta cantidad de goles (0 = sin tope). */
  maxGoals: number;
}

export const DEFAULT_RULES: Readonly<Rules> = {
  gravity: -650,
  ballBounce: 0.6,
  ballMaxSpeed: 6000,
  ballMass: 1,
  boostMode: 'normal',
  boostPower: 1,
  demo: 'normal',
  maxGoals: 0,
};

/** Reglas activas (las lee la simulación). No modificar a mano: usar applyRules. */
export const RULES: Rules = { ...DEFAULT_RULES };

export function makeRules(partial?: Partial<Rules>): Rules {
  return { ...DEFAULT_RULES, ...(partial ?? {}) };
}

export function applyRules(r: Rules) {
  RULES.gravity = r.gravity;
  RULES.ballBounce = r.ballBounce;
  RULES.ballMaxSpeed = r.ballMaxSpeed;
  RULES.ballMass = r.ballMass;
  RULES.boostMode = r.boostMode;
  RULES.boostPower = r.boostPower;
  RULES.demo = r.demo;
  RULES.maxGoals = r.maxGoals;
}

/** Recarga pasiva de turbo por segundo según el modo. */
export function boostRecharge(mode: BoostMode): number {
  return mode === 'slow' ? 10 : mode === 'fast' ? 25 : 0;
}

export function isDefaultRules(r: Rules): boolean {
  return (Object.keys(DEFAULT_RULES) as (keyof Rules)[]).every((k) => r[k] === DEFAULT_RULES[k]);
}

// ---------- Opciones que se muestran en el menú ----------
export interface MutatorOption<T> { label: string; value: T }
export interface MutatorDef<K extends keyof Rules = keyof Rules> { key: K; label: string; options: MutatorOption<Rules[K]>[] }

const def = <K extends keyof Rules>(key: K, label: string, options: MutatorOption<Rules[K]>[]): MutatorDef => ({ key, label, options } as unknown as MutatorDef);

export const MUTATORS: MutatorDef[] = [
  def('gravity', 'Gravedad', [
    { label: 'Baja', value: -325 }, { label: 'Normal', value: -650 }, { label: 'Alta', value: -1137.5 }, { label: 'Lunar', value: -110 },
  ]),
  def('ballBounce', 'Rebote de la pelota', [
    { label: 'Bajo', value: 0.35 }, { label: 'Normal', value: 0.6 }, { label: 'Alto', value: 0.8 }, { label: 'Súper', value: 0.95 },
  ]),
  def('ballMaxSpeed', 'Velocidad de la pelota', [
    { label: 'Lenta', value: 3500 }, { label: 'Normal', value: 6000 }, { label: 'Rápida', value: 8500 }, { label: 'Sin freno', value: 10500 },
  ]),
  def('ballMass', 'Peso de la pelota', [
    { label: 'Liviana', value: 0.35 }, { label: 'Normal', value: 1 }, { label: 'Pesada', value: 3 },
  ]),
  def('boostMode', 'Turbo', [
    { label: 'Normal', value: 'normal' }, { label: 'Ilimitado', value: 'unlimited' }, { label: 'Recarga lenta', value: 'slow' },
    { label: 'Recarga rápida', value: 'fast' }, { label: 'Sin turbo', value: 'none' },
  ]),
  def('boostPower', 'Fuerza del turbo', [
    { label: '1x', value: 1 }, { label: '1.5x', value: 1.5 }, { label: '2x', value: 2 },
  ]),
  def('demo', 'Demoliciones', [
    { label: 'Normales', value: 'normal' }, { label: 'Desactivadas', value: 'off' }, { label: 'Al contacto', value: 'contact' },
  ]),
  def('maxGoals', 'Tope de goles', [
    { label: 'Sin tope', value: 0 }, { label: '1', value: 1 }, { label: '3', value: 3 }, { label: '5', value: 5 },
  ]),
];
