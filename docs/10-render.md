# 10 · Render: calidad, rendimiento y efectos (W7)

## Presets de calidad (`src/render/quality.ts`)
Reemplazan el viejo ajuste Alta/Baja. El slider "Calidad" del menú recorre Baja, Media, Alta y Ultra y se guarda en `turbogol.settings` (los valores viejos `alta`/`baja` se normalizan).

| Preset | Pixel ratio | Sombras | Post | MSAA | GTAO | Público | Partículas | Res. dinámica |
|---|---|---|---|---|---|---|---|---|
| Baja | 1 | no | no (MSAA del canvas) | canvas | no | 35% | 45% | sí (mín. 60%) |
| Media | 1.25 | 1 mapa 2048 | sí | x2 | no | 70% | 75% | sí (mín. 65%) |
| Alta | 1.5 | 1 mapa 3072 | sí | x4 | media resolución | 100% | 100% | sí (mín. 70%) |
| Ultra | 2 | 1 mapa 4096 | sí | x4 | completa | 100% | 125% | no |

- Resolución dinámica (`DynamicResolution`): promedia el tiempo real de frame; baja la escala si hay menos de ~54 fps y la sube de a poco con más de 59. Se desactiva con `navigator.webdriver`.
- Contador de fps: tecla F3 (se recuerda); muestra fps, ms, preset, escala y draw calls/triángulos del frame completo (`renderer.info.autoReset = false`, se resetea una vez por frame).
- Sombras: un único mapa con frustum ajustado a la cancha y el techo (no se usó CSM: la arena es acotada y el techo proyecta sombra sobre las gradas desde cualquier punto).
- GTAO a media resolución en Alta; ignora sprites, puntos, líneas, materiales transparentes/aditivos y objetos con `userData.noAO` (público, banderas).

## Draw calls (renderer.info, Alta, día, partido 1v1 con 5 s jugados, Chromium/SwiftShader)
- Antes (commit 6d83bcd): ~520 llamadas y ~1,45 M de triángulos por frame.
- Después: ~220 llamadas y ~0,62 M de triángulos.
- Causas: estadio fusionado por material, pads instanciados (`PadField`: 5 draws para los 34), redes/postes/soportes de arcos fusionados (5), sombras de contacto instanciadas, estelas y ondas en pocos draws, líneas de la cancha analíticas en el shader del piso, público con LOD por densidad.

## Efectos (`effects.ts`, `fx.ts`)
- Turbo: llama del auto + partículas de fuego (núcleo→llama→punta), chispas con gravedad y humo. Estilo por auto con `BoostStyle` en `renderer.boostStyles` (id de auto → estilo); por defecto `DEFAULT_BOOST[equipo]`. `kind`: fuego, plasma, humo, chispas.
- Estelas de cinta (`TrailSystem`, un draw call): pelota rápida y autos supersónicos.
- Explosión de gol: `renderer.playGoalFx(style, pos)` con `GoalFxStyle { kind: clasica | nova | confeti | chispas, primary, secondary }`; estilos por equipo en `renderer.goalStyles`. Incluye onda expansiva (`Shockwaves`), destello (`FlashBalls`), luz puntual y vibración de la red del arco (`Goals.impact`).
- Polvo y chispas: `renderer.dust(pos, normal, fuerza)` al aterrizar (transición aire→suelo con velocidad vertical < -450) y en rebotes de pelota; chispas y ondas en golpes fuertes y demoliciones.
- Redes de los arcos: deformación en el vertex shader (impacto con rebote amortiguado y viento leve).

## Estadio
Gradas escalonadas con escaleras, barandas de vidrio y caño, banderas animadas, techo de chapa con cerchas, hormigón desaturado, cielo HDRI (día/noche), reflejos capturados del propio estadio.
