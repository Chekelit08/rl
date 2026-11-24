// Relleno de los deslizadores: el riel se pinta hasta el cursor con la variable CSS --p (ver theme.css).

/** Recalcula el relleno de un deslizador (llamar si su valor cambió desde el código). */
export function fillRange(input: HTMLInputElement) {
  const min = Number(input.min || 0), max = Number(input.max || 100);
  const p = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--p', `${Math.max(0, Math.min(100, p)).toFixed(2)}%`);
}

/** Recalcula todos los deslizadores dentro de `root` (después de armar una pantalla). */
export function fillRanges(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(fillRange);
}

// Mientras se arrastra, el relleno acompaña solo
if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | null;
    if (t && t.type === 'range') fillRange(t);
  }, true);
}
