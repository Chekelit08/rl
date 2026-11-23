// Paleta de TURBOGOL (identidad propia).
export const TEAM_COLORS = ['#2E8BFF', '#FF3355'] as const;
export const TEAM_COLORS_LIGHT = ['#8CC4FF', '#FF9AAE'] as const;
export const BOOST_COLOR = '#FFC23D';
export const BALL_GLOW = '#7CF7FF';

/** Pinturas primarias permitidas por equipo (siempre dentro del tono del equipo, para que se lea en cancha). */
export const TEAM_PAINTS: ReadonlyArray<ReadonlyArray<{ name: string; hex: string }>> = [
  [
    { name: 'Eléctrico', hex: '#2E8BFF' },
    { name: 'Cobalto', hex: '#1F55D6' },
    { name: 'Celeste', hex: '#5DB8FF' },
    { name: 'Marino', hex: '#1A3C8F' },
    { name: 'Turquesa', hex: '#1FB3C8' },
    { name: 'Índigo', hex: '#3B3FCF' },
    { name: 'Glaciar', hex: '#8FD3FF' },
    { name: 'Medianoche', hex: '#14245E' },
  ],
  [
    { name: 'Carmesí', hex: '#FF3355' },
    { name: 'Rubí', hex: '#C8102E' },
    { name: 'Frambuesa', hex: '#D6245C' },
    { name: 'Fucsia', hex: '#E5287A' },
    { name: 'Bordó', hex: '#7E1230' },
    { name: 'Cereza', hex: '#E01A3C' },
    { name: 'Rosa chicle', hex: '#FF6F9C' },
    { name: 'Vino', hex: '#5A0E24' },
  ],
];

/** Colores secundarios libres (calcos, franjas, detalles). */
export const SECONDARY_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Blanco', hex: '#F4F6F8' },
  { name: 'Negro', hex: '#15171C' },
  { name: 'Plata', hex: '#B9C2CC' },
  { name: 'Grafito', hex: '#4A5260' },
  { name: 'Oro', hex: '#E8B931' },
  { name: 'Lima', hex: '#9BE33B' },
  { name: 'Amarillo', hex: '#FFE14D' },
  { name: 'Cian', hex: '#2EE6E6' },
  { name: 'Violeta', hex: '#9B5CFF' },
  { name: 'Rosa', hex: '#FF7AC6' },
  { name: 'Verde', hex: '#1FAE6B' },
  { name: 'Celeste', hex: '#9CD8FF' },
  { name: 'Rojo', hex: '#E0283F' },
  { name: 'Azul', hex: '#2453D6' },
];
