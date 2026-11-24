// Íconos propios de la interfaz: planos, de un solo color (toman `currentColor`) y dibujados sobre una grilla de 24.

const PATHS = {
  /** Gol: pelota. */
  ball: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.6l4 2.9-1.5 4.7h-5L8 10.5z"/>',
  /** Asistencia: pase hacia adelante. */
  assist: '<path d="M3 10.5h10V6l8 6-8 6v-4.5H3z"/>',
  /** Demolición: estallido. */
  demo: '<path d="M12 2l2.2 5.6L20 5l-2.6 5.8L23 13l-5.6 2.2L20 21l-5.8-2.6L12 24l-2.2-5.6L4 21l2.6-5.8L1 13l5.6-2.2L4 5l5.8 2.6z"/>',
  /** Atajada: escudo. */
  save: '<path d="M12 2l8 3v6.5c0 5-3.4 8.6-8 10.5-4.6-1.900-8-5.500-8-10.500V5z"/>',
  /** Tiro: mira. */
  shot: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3"/>',
  /** Conexión. */
  net: '<path d="M3 17h3v4H3zM8.500 13h3v8h-3zM14 9h3v12h-3zM19.500 4h3v17h-3z"/>',
  /** Salida. */
  exit: '<path d="M4 3h9v2.500H6.500v13H13V21H4zM15 7l6 5-6 5v-3.700H9.500v-2.600H15z"/>',
  clip: '<path d="M3 5h18v14H3zM5.500 7.500v2h2v-2zM5.500 14.500v2h2v-2zM16.500 7.500v2h2v-2zM16.500 14.500v2h2v-2zM10 8.500v7l5.500-3.500z" fill-rule="evenodd"/>',
  disk: '<path d="M3 3h14l4 4v14H3zM7 3v6h9V3zM7 13v6h10v-6z" fill-rule="evenodd"/>',
  star: '<path d="M12 2.500l2.900 6.300 6.900.800-5.100 4.700 1.400 6.800L12 17.700l-6.100 3.400 1.400-6.800L2.200 9.600l6.900-.800z"/>',
  lock: '<path d="M7 10V7.500a5 5 0 0110 0V10h2v11H5V10zm2.500 0h5V7.500a2.500 2.500 0 00-5 0z" fill-rule="evenodd"/>',
  check: '<path d="M9.500 17.800L3.700 12l2.100-2.100 3.700 3.700 8.700-8.700L20.300 7z"/>',
  play: '<path d="M6 3.500v17l14-8.500z"/>',
  pause: '<path d="M5 3.500h5v17H5zM14 3.500h5v17h-5z"/>',
  back5: '<path d="M11 5v14l-9-7zM21 5v14l-9-7z"/>',
  fwd5: '<path d="M13 5v14l9-7zM3 5v14l9-7z"/>',
  /** Medalla (desafíos). */
  medal: '<path d="M7 2h4l1 4 1-4h4l-2.800 7.300a6.500 6.500 0 11-4.400 0zM12 12a3.500 3.500 0 100 7 3.500 3.500 0 000-7z" fill-rule="evenodd"/>',
  bolt: '<path d="M13.500 2L4 14h6.500L9 22l10-12.500h-6.500z"/>',
  clock: '<path d="M12 2.500a9.500 9.500 0 100 19 9.500 9.500 0 000-19zm0 2.500a7 7 0 110 14 7 7 0 010-14zm-1.200 2.500h2.400v4l3 2-1.300 2-4.100-2.700z" fill-rule="evenodd"/>',
  rotate: '<path d="M12 4a8 8 0 017.700 5.800l-2.400.700A5.500 5.500 0 106.500 12H9l-4 5-4-5h3A8 8 0 0112 4z"/>',
  link: '<path d="M10 7H7a5 5 0 000 10h3v-2.400H7a2.600 2.600 0 010-5.200h3zM14 7h3a5 5 0 010 10h-3v-2.400h3a2.600 2.600 0 000-5.200h-3zM8 10.800h8v2.400H8z"/>',
  copy: '<path d="M8 2h13v15h-4v5H3V7h5zm2.500 2.500V7H17v7.500h1.500v-10zM5.500 9.500v10h9v-10z" fill-rule="evenodd"/>',
  trash: '<path d="M9 2h6l1 2h5v2.500H3V4h5zM5 8.500h14L18 22H6z"/>',
  edit: '<path d="M16.500 2.500l5 5L8 21H3v-5zM14.500 8l-9 9v1.500H7l9-9z" fill-rule="evenodd"/>',
  share: '<path d="M12 2l5.500 5.500-1.800 1.800-2.400-2.400V15h-2.600V6.900L8.300 9.300 6.500 7.500zM4 13h2.600v6h10.800v-6H20v8.500H4z"/>',
  file: '<path d="M5 2h9l5 5v15H5zm8 1.800V8h4.200z" fill-rule="evenodd"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** SVG en línea del ícono. Hereda el color del texto que lo rodea. */
export function icon(name: IconName, cls = 'ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${PATHS[name]}</svg>`;
}
