// Presets de calidad gráfica, resolución dinámica y contador de fps.

export type QualityLevel = 'baja' | 'media' | 'alta' | 'ultra';
export const QUALITY_LEVELS: QualityLevel[] = ['baja', 'media', 'alta', 'ultra'];
export const QUALITY_LABELS: Record<QualityLevel, string> = { baja: 'Baja', media: 'Media', alta: 'Alta', ultra: 'Ultra' };

export interface QualityPreset {
  /** Tope del pixel ratio (se multiplica por la escala de resolución dinámica). */
  pixelRatio: number;
  /** 'off' sin sombras, 'single' un mapa para toda la cancha, 'csm' cascadas que siguen a la cámara. */
  shadows: 'off' | 'single' | 'csm';
  shadowMapSize: number;
  /** Post-proceso (composer). Sin post se dibuja directo con el MSAA del canvas. */
  post: boolean;
  msaa: number; // muestras del render target del composer
  /** Oclusión ambiental: apagada, a media resolución o completa. */
  gtao: 'off' | 'half' | 'full';
  bloom: boolean;
  /** Fracción del público dibujada (el resto se descarta en el shader). */
  crowdDensity: number;
  /** Multiplicador de partículas emitidas. */
  particles: number;
  /** Resolución dinámica para sostener 60 fps. */
  dynamicRes: boolean;
  /** Escala mínima permitida por la resolución dinámica. */
  minScale: number;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  baja: { pixelRatio: 1, shadows: 'off', shadowMapSize: 1024, post: false, msaa: 0, gtao: 'off', bloom: false, crowdDensity: 0.35, particles: 0.45, dynamicRes: true, minScale: 0.6 },
  media: { pixelRatio: 1.25, shadows: 'single', shadowMapSize: 2048, post: true, msaa: 2, gtao: 'off', bloom: true, crowdDensity: 0.7, particles: 0.75, dynamicRes: true, minScale: 0.65 },
  alta: { pixelRatio: 1.5, shadows: 'csm', shadowMapSize: 2048, post: true, msaa: 4, gtao: 'half', bloom: true, crowdDensity: 1, particles: 1, dynamicRes: true, minScale: 0.7 },
  ultra: { pixelRatio: 2, shadows: 'csm', shadowMapSize: 4096, post: true, msaa: 4, gtao: 'full', bloom: true, crowdDensity: 1, particles: 1.25, dynamicRes: false, minScale: 1 },
};

/** Normaliza valores guardados de versiones anteriores ('alta' | 'baja'). */
export function normalizeQuality(q: unknown): QualityLevel {
  return QUALITY_LEVELS.includes(q as QualityLevel) ? (q as QualityLevel) : 'alta';
}

/**
 * Resolución dinámica: mide el tiempo real entre frames y baja/sube la escala de render
 * para sostener ~60 fps. Cambia como mucho una vez cada `cooldown` segundos para no oscilar.
 */
export class DynamicResolution {
  scale = 1;
  enabled = true;
  minScale = 0.7;
  private avg = 1 / 60;
  private cooldown = 0;
  private slowTime = 0;
  private fastTime = 0;

  /** Devuelve true si la escala cambió. dtReal en segundos. */
  update(dtReal: number): boolean {
    if (!this.enabled || dtReal <= 0 || dtReal > 0.5) return false; // pestaña oculta o pausa larga
    this.avg += (dtReal - this.avg) * 0.08;
    this.cooldown -= dtReal;
    const fps = 1 / this.avg;
    if (fps < 54) { this.slowTime += dtReal; this.fastTime = 0; }
    else if (fps > 59) { this.fastTime += dtReal; this.slowTime = 0; }
    else { this.slowTime = 0; this.fastTime = 0; }
    if (this.cooldown > 0) return false;
    if (this.slowTime > 0.8 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale - (fps < 40 ? 0.15 : 0.08));
      this.cooldown = 1.2;
      this.slowTime = 0;
      return true;
    }
    if (this.fastTime > 3 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.cooldown = 2;
      this.fastTime = 0;
      return true;
    }
    return false;
  }

  reset() { this.scale = 1; this.cooldown = 1; this.slowTime = 0; this.fastTime = 0; }
}

/** Contador de fps (se muestra/oculta con F3; la preferencia se recuerda). */
export class FpsMeter {
  el: HTMLDivElement;
  private frames = 0;
  private acc = 0;
  private visible = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fps-meter';
    container.appendChild(this.el);
    try { this.visible = localStorage.getItem('turbogol.fps') === '1'; } catch { /* sin almacenamiento */ }
    this.apply();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.setVisible(!this.visible); }
    });
  }

  setVisible(v: boolean) {
    this.visible = v;
    try { localStorage.setItem('turbogol.fps', v ? '1' : '0'); } catch { /* sin almacenamiento */ }
    this.apply();
  }

  private apply() { this.el.style.display = this.visible ? '' : 'none'; }

  tick(dtReal: number, info: { calls: number; triangles: number }, scale: number, level: string) {
    if (!this.visible) return;
    this.frames++;
    this.acc += dtReal;
    if (this.acc >= 0.5) {
      const fps = this.frames / this.acc;
      this.el.textContent = `${fps.toFixed(0)} fps · ${(1000 / fps).toFixed(1)} ms · ${level} · res ${(scale * 100).toFixed(0)}% · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris`;
      this.frames = 0;
      this.acc = 0;
    }
  }
}
