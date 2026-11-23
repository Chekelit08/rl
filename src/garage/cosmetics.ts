// Catálogo de cosméticos de TURBOGOL. Nada afecta la física: sólo cómo se ve el auto.
// Todo se desbloquea jugando (nivel de cuenta o rango), sin dinero real.

export type Finish = 'brillante' | 'mate' | 'metalizado' | 'perlado';
export type DecalId = 'ninguna' | 'franjas' | 'carrera' | 'llamas' | 'numero' | 'geometrica' | 'rayo' | 'camuflaje' | 'ondas' | 'damero';
export type WheelId = 'rayos6' | 'cinco' | 'malla' | 'turbina' | 'disco' | 'tres' | 'estrella';
export type TrailId = 'clasica' | 'fuego' | 'plasma' | 'hielo' | 'toxica' | 'arcoiris' | 'humo' | 'chispas' | 'dorada';
export type ExplosionId = 'clasica' | 'fuegos' | 'onda' | 'confeti' | 'tormenta' | 'supernova' | 'cubos' | 'agujero';

export interface Unlock {
  /** Nivel de cuenta necesario (1 = disponible desde el principio). */
  level?: number;
  /** Rango mínimo (índice de tier: 0 Bronce … 7 Ícono) alcanzado en cualquier playlist ranked. */
  tier?: number;
}

export interface Item<T extends string> { id: T; name: string; unlock: Unlock; desc?: string }

export const FINISHES: Item<Finish>[] = [
  { id: 'brillante', name: 'Brillante', unlock: { level: 1 } },
  { id: 'mate', name: 'Mate', unlock: { level: 1 } },
  { id: 'metalizado', name: 'Metalizado', unlock: { level: 3 } },
  { id: 'perlado', name: 'Perlado', unlock: { level: 8 } },
];

export const DECALS: Item<DecalId>[] = [
  { id: 'ninguna', name: 'Sin calco', unlock: { level: 1 } },
  { id: 'franjas', name: 'Franjas laterales', unlock: { level: 1 } },
  { id: 'carrera', name: 'Doble franja', unlock: { level: 2 } },
  { id: 'numero', name: 'Número de carrera', unlock: { level: 2 } },
  { id: 'geometrica', name: 'Geométrica', unlock: { level: 4 } },
  { id: 'rayo', name: 'Rayo', unlock: { level: 5 } },
  { id: 'ondas', name: 'Ondas', unlock: { level: 7 } },
  { id: 'damero', name: 'Damero', unlock: { level: 9 } },
  { id: 'camuflaje', name: 'Camuflaje', unlock: { level: 12 } },
  { id: 'llamas', name: 'Llamas', unlock: { level: 15 } },
];

export const WHEELS: Item<WheelId>[] = [
  { id: 'rayos6', name: 'Seis rayos', unlock: { level: 1 } },
  { id: 'cinco', name: 'Cinco rayos', unlock: { level: 1 } },
  { id: 'malla', name: 'Malla', unlock: { level: 3 } },
  { id: 'tres', name: 'Tres brazos', unlock: { level: 6 } },
  { id: 'disco', name: 'Disco aero', unlock: { level: 10 } },
  { id: 'turbina', name: 'Turbina', unlock: { level: 14 } },
  { id: 'estrella', name: 'Estrella', unlock: { tier: 4 }, desc: 'Recompensa de rango Diamante' },
];

export interface TrailStyle {
  /** Color del cono exterior de la llama (null = color del equipo). */
  flame: string | null;
  core: string;
  /** Colores de las partículas (null en la lista = color del equipo). */
  sparks: (string | null)[];
  smoke: string | null;
  mode: 'normal' | 'arcoiris' | 'chispas';
}

export const TRAILS: (Item<TrailId> & { style: TrailStyle })[] = [
  { id: 'clasica', name: 'Clásica', unlock: { level: 1 }, style: { flame: null, core: '#FFC23D', sparks: ['#FFC23D', null, null], smoke: '#c8cbd0', mode: 'normal' } },
  { id: 'fuego', name: 'Fuego', unlock: { level: 2 }, style: { flame: '#ff5a1f', core: '#ffe08a', sparks: ['#ff7a1a', '#ffb02e', '#ff3b1a'], smoke: '#6a6a6a', mode: 'normal' } },
  { id: 'hielo', name: 'Hielo', unlock: { level: 4 }, style: { flame: '#7fe3ff', core: '#ffffff', sparks: ['#bff3ff', '#7fe3ff', '#ffffff'], smoke: '#e6f8ff', mode: 'normal' } },
  { id: 'plasma', name: 'Plasma', unlock: { level: 6 }, style: { flame: '#b06bff', core: '#f0d6ff', sparks: ['#c38bff', '#7a4dff', '#ff8bf2'], smoke: null, mode: 'normal' } },
  { id: 'toxica', name: 'Tóxica', unlock: { level: 9 }, style: { flame: '#7dff3a', core: '#eaffb0', sparks: ['#9bff4a', '#3ae86a', '#d4ff6a'], smoke: '#5a7a3a', mode: 'normal' } },
  { id: 'humo', name: 'Humo negro', unlock: { level: 11 }, style: { flame: '#ff9a3d', core: '#ffd9a0', sparks: ['#ff9a3d'], smoke: '#1a1a1a', mode: 'normal' } },
  { id: 'chispas', name: 'Chispas', unlock: { level: 13 }, style: { flame: null, core: '#ffffff', sparks: ['#ffffff', '#fff3b0', null], smoke: null, mode: 'chispas' } },
  { id: 'arcoiris', name: 'Arcoíris', unlock: { level: 18 }, style: { flame: '#ffffff', core: '#ffffff', sparks: [], smoke: null, mode: 'arcoiris' } },
  { id: 'dorada', name: 'Dorada', unlock: { tier: 2 }, desc: 'Recompensa de rango Oro', style: { flame: '#ffcf4a', core: '#fff6d0', sparks: ['#ffd84a', '#fff1a8', '#e8b931'], smoke: null, mode: 'chispas' } },
];

export const EXPLOSIONS: Item<ExplosionId>[] = [
  { id: 'clasica', name: 'Clásica', unlock: { level: 1 } },
  { id: 'onda', name: 'Onda de choque', unlock: { level: 3 } },
  { id: 'confeti', name: 'Confeti', unlock: { level: 5 } },
  { id: 'fuegos', name: 'Fuegos artificiales', unlock: { level: 8 } },
  { id: 'cubos', name: 'Cubos', unlock: { level: 10 } },
  { id: 'tormenta', name: 'Tormenta eléctrica', unlock: { level: 16 } },
  { id: 'agujero', name: 'Agujero negro', unlock: { level: 20 } },
  { id: 'supernova', name: 'Supernova', unlock: { tier: 5 }, desc: 'Recompensa de rango Élite' },
];

export const TITLES: Item<string>[] = [
  { id: 'novato', name: 'Novato', unlock: { level: 1 } },
  { id: 'piloto', name: 'Piloto', unlock: { level: 2 } },
  { id: 'goleador', name: 'Goleador', unlock: { level: 4 } },
  { id: 'muralla', name: 'La Muralla', unlock: { level: 6 } },
  { id: 'aviador', name: 'Aviador', unlock: { level: 9 } },
  { id: 'demoledor', name: 'Demoledor', unlock: { level: 12 } },
  { id: 'crack', name: 'Crack', unlock: { level: 15 } },
  { id: 'veterano', name: 'Veterano', unlock: { level: 25 } },
  { id: 'leyenda', name: 'Leyenda del Turbo', unlock: { level: 40 } },
  { id: 'oro', name: 'Temporada 1 · Oro', unlock: { tier: 2 } },
  { id: 'diamante', name: 'Temporada 1 · Diamante', unlock: { tier: 4 } },
  { id: 'elite', name: 'Temporada 1 · Élite', unlock: { tier: 5 } },
  { id: 'maestro', name: 'Temporada 1 · Maestro', unlock: { tier: 6 } },
  { id: 'icono', name: 'ÍCONO', unlock: { tier: 7 } },
];

export interface BannerStyle { a: string; b: string; pattern: 'liso' | 'diagonal' | 'rayas' | 'puntos' | 'hex' | 'rayo' }
export const BANNERS: (Item<string> & { style: BannerStyle })[] = [
  { id: 'noche', name: 'Noche', unlock: { level: 1 }, style: { a: '#0e1a33', b: '#1f3a6b', pattern: 'diagonal' } },
  { id: 'brasa', name: 'Brasa', unlock: { level: 1 }, style: { a: '#33100e', b: '#7a1f2a', pattern: 'diagonal' } },
  { id: 'cancha', name: 'Cancha', unlock: { level: 3 }, style: { a: '#123d22', b: '#2f7a3f', pattern: 'rayas' } },
  { id: 'neon', name: 'Neón', unlock: { level: 7 }, style: { a: '#120b2e', b: '#6a2bff', pattern: 'puntos' } },
  { id: 'tormenta', name: 'Tormenta', unlock: { level: 13 }, style: { a: '#0b1424', b: '#3a7bd5', pattern: 'rayo' } },
  { id: 'panal', name: 'Panal', unlock: { level: 19 }, style: { a: '#2a1e05', b: '#c99a1d', pattern: 'hex' } },
  { id: 'campeon', name: 'Campeón', unlock: { tier: 3 }, style: { a: '#0d2b2e', b: '#46c7c0', pattern: 'diagonal' } },
];

export function isUnlocked(u: Unlock, level: number, bestTier: number): boolean {
  if (u.level !== undefined && level < u.level) return false;
  if (u.tier !== undefined && bestTier < u.tier) return false;
  return true;
}

export function unlockLabel(u: Unlock, tierNames: readonly string[]): string {
  if (u.tier !== undefined) return `Rango ${tierNames[u.tier]}`;
  if (u.level !== undefined) return `Nivel ${u.level}`;
  return '';
}

/** Todos los ítems de todas las categorías (para listar desbloqueos al subir de nivel). */
export function allItems(): { cat: string; item: Item<string> }[] {
  return [
    ...FINISHES.map((item) => ({ cat: 'Acabado', item })),
    ...DECALS.map((item) => ({ cat: 'Calco', item })),
    ...WHEELS.map((item) => ({ cat: 'Llantas', item })),
    ...TRAILS.map((item) => ({ cat: 'Estela de turbo', item })),
    ...EXPLOSIONS.map((item) => ({ cat: 'Explosión de gol', item })),
    ...TITLES.map((item) => ({ cat: 'Título', item })),
    ...BANNERS.map((item) => ({ cat: 'Banner', item })),
  ];
}
