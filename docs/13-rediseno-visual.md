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

## Interfaz (`src/theme.css`)

- Tema plano y oscuro de bordes rectos, con acento amarillo. Se carga último y pisa los estilos de cada
  módulo; los colores y tipografías salen de las variables de `:root`.
- Tipografía Archivo (paquete `@fontsource-variable/archivo`): viene dentro del juego, no depende de internet.
- Ajustes ordenados en pestañas: Cámara, Audio, Gráficos y Juego.

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
