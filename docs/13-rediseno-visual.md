# Rediseño visual: estadio, efectos, interfaz y autos

Todo el aspecto del juego pasó a un estilo limpio y luminoso, con identidad propia. La física, los bots, el
online y los hitbox no cambian.

## Estadio (`src/render/stadium.ts`)

- Tribunas abiertas en dos anillos. Las butacas se dibujan como tiras con una grilla de colores
  (`seatColorAt`): cabeceras a rayas del equipo (sur azul, norte roja), laterales en mosaico azul→rojo y el
  rótulo TURBOGOL armado con butacas blancas. El público ocupa la mitad de los lugares y viste el color de
  su sector, así el mosaico se sigue leyendo.
- Visera blanca sobre laterales y esquinas; las cabeceras quedan abiertas y llevan las pantallas con el
  marcador. Cuatro torres de luz en las esquinas (con halo en el estadio de noche).
- Césped parejo de dos tonos, tableros lisos con publicidad blanca y vidrios casi invisibles
  (`src/render/arenaMesh.ts`). Mapeo de tonos neutro y menos viñeta (`src/render/renderer.ts`).

## Efectos

- Los efectos luminosos ya no son aditivos puros: suman luz y además tapan parte del fondo
  (`fxUniforms` en `src/render/fx.ts`). De día, el aditivo puro se lavaba contra el césped y el cielo.
- Turbo: llama más grande y una cinta del color de la llama detrás del auto.
- Gol: toda explosión arranca de una base común (destello con volumen, ondas, humo del color del equipo y
  papelitos) y encima va la explosión elegida en el garage. La pantalla destella con el color del equipo.

## Interfaz

Plana, oscura y de bordes rectos, con acento amarillo turbo y tipografía Archivo (paquete
`@fontsource-variable/archivo`: viene dentro del juego, no depende de internet).

### Cómo está armada

- `src/theme.css` es la base: variables de `:root` (colores, tipografías, trama diagonal) y los componentes
  que comparten todas las pantallas: `.overlay`, `.panel` con encabezado (`.panel-head`) y pie (`.actions`)
  fijos, `.btn`, `.seg`, `.tabs`, `.row`, `.slider`, `.stats`, `.chip`, `.tag`, `.bar`, `.card`, `kbd`.
- `src/style.css` la importa primero y suma lo que vive en `index.html`: carga, menú principal, configuración
  de partido, ajustes, controles, pausa y HUD. Cada módulo trae sólo lo suyo: `src/ui/ui.css` (garage,
  competitivo, perfil, reasignar, fin de partido, puntos y chat), `src/training/extras.css`,
  `src/net/online.css` y `src/challenges/challenges.css`. Ya no hay hojas que se pisen entre sí ni `!important`
  de parche: un selector de módulo siempre es más específico que el componente base.
- Todo se mide en `rem`. La raíz escala con la ventana (`1rem = 16px` en 1440×810, con piso de 14px), así
  la interfaz conserva sus proporciones en 1280×720, 1920×1080 y más grande. En ventanas de 720px o menos
  las grillas pasan a una columna y el garage pone la sala arriba y el panel abajo.
- El foco de teclado se ve igual en todos lados (contorno amarillo). Esc vuelve atrás en ajustes, controles,
  configuración de partido, desafíos, online (inicio), garage, competitivo, perfil y reasignar.

### Piezas compartidas (`src/ui/`)

- `icons.ts`: íconos propios en SVG, de un color. Reemplazan a los emojis en avisos, medallas y botones.
- `hud.ts`: avisos de jugadas (`feedLine`), medidor de turbo (`setTurboHud`) y tabla de puntajes
  (`statsTable`, `scorePanel`). Los usan el partido local y el online, que antes los duplicaban.
- `range.ts`: relleno de los deslizadores (variable `--p`).
- `thumbs.ts`: miniaturas de las carrocerías con el auto real y la pintura elegida; se dibujan de a una por
  cuadro en un lienzo aparte y quedan guardadas. El encuadre sale de la caja del modelo, no de su forma.
- `studio.ts`: reflejos de estudio (degradé suave) para el garage y las miniaturas.

### Pantallas

- **Marca**: TURBO en blanco y GOL en amarillo, en Archivo negra, ancha e inclinada. El ícono de la pestaña
  (`public/favicon.svg`) es la T inclinada con la pelota amarilla. La pantalla de carga muestra la marca y
  una barra que corre mientras se arma el estadio.
- **HUD**: marcador en bloques de equipo; medidor de turbo en barra por tramos con número grande, velocidad
  y cámara; carteles siempre sobre placa (cuenta regresiva, ¡Ya!, gol con autor y velocidad, tiempo extra)
  para leerse sobre césped y cielo; durante la repetición del gol se ocultan los medidores y aparecen
  franjas de cine (`#hud.replaying`).
- **Garage**: sala de exhibición clara. El fondo es una pintura 2D (degradé y nombre de la carrocería en
  letras enormes) y sobre él van la plataforma con el aro del equipo, la sombra del auto y el auto girando.
  Se gira arrastrando y se acerca con la rueda. Panel con categorías a la izquierda y tarjetas a la derecha.
- **Fin de partido** (`src/ui/postmatch.ts`, dentro de `#end`): primero la figura del partido, después el
  resumen con resultado, tabla, XP con barra de nivel, desbloqueos, rango en competitivo y los botones para
  guardar o ver la repetición.
- **Ajustes**: pestañas Cámara, Audio, Gráficos y Juego. Las opciones de sí/no y de lista son botones; los
  valores continuos, deslizadores. Los nombres de cámara no usan jerga (Campo de visión, Firmeza, Velocidad
  de giro, Cambio de cámara) y Sacudida va primero. En Juego están la repetición del gol, «Mostrar caja de
  choque» (`settings.hitbox`, llama a `renderer.setHitboxVisible` si existe) y la dirección del servidor.

### Capturas para revisar

Los scripts de Playwright que recorren todas las pantallas no están en el repo (usan una instalación aparte);
la prueba de humo `tests/e2e/smoke.cjs` y `tests/e2e/extras.cjs` dependen de selectores (`[data-act=…]`,
`#loading.hidden`, `#end .tg-endbtns`, `.tg-viewer .seg button`…): si se cambia el HTML, hay que cuidarlos.

## Autos modelados en Blender

- Las seis carrocerías se generan con `tools/autos/generar_autos.py` y se guardan en
  `public/assets/models/<id>.glb`. Son diseños propios: compacto con portón (Toro), gran turismo (Flecha),
  cuña (Lámina), trompa larga (Aguja), cupé de tres volúmenes (Mixto) y furgón.
- Para regenerarlas después de tocar un diseño (tabla `DESIGNS` del script):

      /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/autos/generar_autos.py -- carpeta_de_previas

  El último argumento es opcional: si se pasa, deja ahí tres láminas con los seis autos.
- Cada carrocería es una grilla de secciones suavizada con subdivisión; vidrios, luces, rejilla y piso van
  como materiales con nombre (`paint`, `glass`, `trim`, `light_front`, `light_rear`) y los pasarruedas se
  recortan con booleanas. Las medidas (largo, ruedas, despeje) salen de `CAR_BODIES`: si cambian ahí, hay
  que copiarlas al script.
- El juego las carga al iniciar (`preloadCarModels` en `src/render/carMesh.ts`) y les aplica pintura,
  acabado, calcomanías, llantas y luces de freno como antes. Si un modelo no carga, ese auto usa la
  carrocería procedural anterior.
