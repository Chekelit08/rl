// Reflejos de estudio para el garage y las miniaturas: un degradé suave (claro arriba, oscuro abajo),
// sin manchas de luz, para que la pintura y los vidrios se vean limpios. No depende del estadio ni de la hora.

import * as THREE from 'three';

/** Mapa de entorno prefiltrado para `scene.environment`. Usar junto con `aimStudioEnv`. */
export function studioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.3, '#f1f4f8');
  grd.addColorStop(0.47, '#b4bdca');
  grd.addColorStop(0.53, '#5d6675');
  grd.addColorStop(1, '#262b35');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 256);
  // Una franja más clara a media altura, como una caja de luz larga
  const band = g.createLinearGradient(0, 50, 0, 100);
  band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,255,255,.9)'); band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band;
  g.fillRect(0, 50, 512, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  pm.dispose();
  tex.dispose();
  return env;
}

/** El juego usa Z hacia arriba: gira el entorno para que su "cielo" quede arriba del auto. */
export function aimStudioEnv(scene: THREE.Scene, env: THREE.Texture, intensity: number) {
  scene.environment = env;
  scene.environmentIntensity = intensity;
  scene.environmentRotation.set(Math.PI / 2, 0, 0);
}
