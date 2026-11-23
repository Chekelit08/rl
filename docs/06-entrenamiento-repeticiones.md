# 06 · Entrenamiento, juego libre extendido, repeticiones y clips

Este documento describe las funciones de práctica y de video de TURBOGOL. El código está en `src/training/` y `src/replay/`, con la cámara en `src/render/camera.ts`.

## Arquitectura

- **`src/training/extras.ts`**: la clase `Extras` coordina todo. `main.ts` la llama desde pocos ganchos:
  - `onWorldStart` al crear un mundo;
  - `beforeStep` y `afterStep` alrededor de cada tick (si `beforeStep` devuelve `true`, ese tick no se simula y se está rebobinando);
  - `onEvent`, `handleUi` (antes que el juego, y puede consumir acciones);
  - `restart`, `action` (botones `data-act` del menú) y `frame` (estado `'ext'`).
- **Estado `'ext'`**: lo usan las pantallas propias (visor y editor). En ese estado el juego no simula ni dibuja el HUD, y la pantalla dibuja con `renderer.render(snap, dt, 'custom')` y una función de cámara propia (`camCtl.customFn`).
- **Interfaz**: se crea desde los módulos (DOM propio, estilos en `src/training/extras.css`). `index.html` solo suma dos botones al menú y filas a la tabla de controles.
- **`src/training/host.ts`**: define lo que estos módulos usan del juego.

## Entrenamiento

- **Packs** (`types.ts`, `packs.ts`):
  - tienen categoría (Delantero, Arquero, Aéreo), dificultad (Novato, Intermedio, Pro), autor, descripción y hasta 50 tiros;
  - cada tiro define la pelota (posición, velocidad y giro) y el auto (posición, rumbo, nariz, altura y turbo inicial), más un tiempo límite y una nota opcionales.
- **Packs oficiales**: hay 6 de 10 tiros:
  - 3 de Delantero (Novato, Intermedio y Pro);
  - 2 de Arquero (Novato e Intermedio);
  - 1 de Aéreo (Pro).
  `tests/training.test.ts` los verifica con la física real: ningún tiro de ataque entra solo, todos los tiros de arquero van al arco y todas las posiciones son válidas.
- **Sesión** (`session.ts`, sin DOM, corre en Node):
  - el tiro queda congelado hasta el primer input del jugador;
  - después mide el tiempo y decide el resultado;
  - en Delantero y Aéreo, el gol propio es acierto y el tiempo agotado es fallo;
  - en Arquero, atajar o despejar (tocarla y que se aleje del arco, o que rebote afuera) es acierto, y que te la metan es fallo;
  - tras un acierto pasa al tiro siguiente, y tras un fallo repite el mismo;
  - el récord de cada pack se guarda en `localStorage` (`turbogol.packs.best`).
- **Opciones**: variación leve (posición, velocidad y ángulo) y turbo infinito. Se guardan en `turbogol.training.opts`.
- **Controles**:

  | Acción | Teclado | Mando |
  |---|---|---|
  | Reintentar | R | D-pad ↑ |
  | Siguiente / anterior | N / B | D-pad → / ← |
  | Rebobinar | mantener Z o Retroceso | mantener View |
  | Guardar clip | G | D-pad ↓ |

- **Pausa**: suma "Siguiente tiro", las opciones, "Cambiar de pack" y, si estás probando desde el editor, "Volver al editor".
- **Códigos para compartir** (`codes.ts`): `TG1-` + JSON compacto (filas de enteros), comprimido con deflate y pasado a base64url. Un pack de 10 tiros ocupa unos 600 caracteres. Los packs propios se guardan en `localStorage` (`turbogol.packs`).

### Editor de tiros (`editor.ts`)

- **Cámara**: libre (WASD, Q/E para bajar y subir, Shift para ir más rápido, clic derecho y mouse para mirar).
- **Ubicar con el mouse**:
  - clic izquierdo (o arrastrar) mueve el objeto seleccionado (1: pelota, 2: auto) sobre el piso;
  - la rueda cambia la altura;
  - Ctrl + clic apunta la velocidad de la pelota, o el rumbo del auto, hacia ese punto;
  - `[` y `]` giran el auto.
- **Panel**:
  - nombre, categoría, dificultad y descripción del pack;
  - lista de tiros (nuevo, duplicar, reordenar, borrar);
  - posición, y velocidad como rapidez, dirección y elevación;
  - efecto (giro), botones "A mi arco" y "Al arco rival", tiempo límite y nota.
- **Ayudas visuales**: flecha amarilla de velocidad, trayectoria de 3 s simulada con la física real (línea punteada), flecha de rumbo del auto y anillo de selección.
- **Acciones**:
  - "Probar tiro" (P) juega el tiro y la pausa permite volver al editor;
  - "Guardar pack";
  - "Compartir" copia el código.

## Juego libre extendido

- **Rebobinar**: mantené Z, Retroceso o View en el mando. `RewindBuffer` (`worldState.ts`) guarda el estado completo de la simulación cada 2 ticks durante 5 s. Rebobina a velocidad real y, al soltar, el juego sigue desde ese punto (se descarta el "futuro"). Repetir los mismos inputs después de restaurar da exactamente el mismo resultado, y una prueba lo verifica.
- **Congelar pelota** (F o D-pad ←): la pelota queda flotando quieta y se suelta al tocarla.
- **Lanzar pelota** (V o D-pad →): la pelota viene hacia el auto con un globo. Si está muy cerca, primero se aleja hacia adelante. La velocidad del lanzamiento se elige en la pausa (43 a 108 km/h).
- **Turbo infinito**: I o la pausa.
- **Reiniciar**: R o D-pad ↑.
- **HUD**: velocidad actual de la pelota y velocidad máxima tras tu último toque.

## Repeticiones

- **Formato** (`format.ts`):
  - cada cuadro se cuantiza a Int16: posiciones a 0.25 uu, cuaterniones, velocidades, bits de pads, estados del auto, reloj y marcador;
  - el conjunto se comprime con gzip (`CompressionStream`);
  - un 2v2 ocupa unos 180 B por cuadro antes de comprimir;
  - los partidos se graban a 30 cuadros/s y los clips a 60;
  - el visor interpola entre cuadros, sin interpolar los teletransportes.
- **Grabación** (`recorder.ts`): `MatchRecorder` graba el partido completo por bloques. Al terminar (2.5 s después del final, para incluir el festejo), se guarda solo en IndexedDB (`store.ts`; si no hay IndexedDB, queda en memoria).
  - Se conservan las últimas 10 repeticiones automáticas y 40 clips.
  - Las marcadas con ★ ("Guardar repetición" en la pausa o al final del partido) no se borran.
- **Biblioteca** (Menú › Repeticiones y clips):
  - pestañas Partidos y Clips;
  - por cada grabación: ver, exportar video, marcar ★, renombrar, descargar el archivo `.tgrep` y borrar;
  - también importa archivos `.tgrep`.
- **Visor** (`viewer.ts`):
  - línea de tiempo con scrub y marcas de gol (clic para ir al gol);
  - play/pausa, ±5 s y velocidad de 0.25× a 2×;
  - cámaras:
    - director automático;
    - libre (WASD, Q/E y mouse);
    - seguir a cada jugador con cámara de pelota o de auto (C para alternar).
  - Atajos:
    - Espacio pausa, ←/→ saltan 5 s, −/+ cambian la velocidad;
    - 0 vuelve al director, 1–9 eligen jugador y F pasa a la cámara libre;
    - Esc sale.
  - Mando: A pausa, LB/RB saltan 5 s, D-pad ←/→ cambian de cámara y D-pad ↑/↓ cambian la velocidad.
  - Sonidos y partículas: se reconstruyen desde los cuadros (goles por cambio de marcador, toques y piques por cambio brusco de velocidad).
- **Director de transmisión** (`camera.ts`):
  - plano de persecución detrás del protagonista (el auto más cercano a la pelota, o el preferido);
  - plano bajo a mucha velocidad;
  - plano general desde la tribuna si la pelota vuela alto o la jugada se estira;
  - cámara detrás del arco cuando la pelota se acerca al área;
  - los cortes tienen un tiempo mínimo entre planos.

  La repetición automática de gol del partido usa este director, con el goleador como protagonista.

## Clips

- G o D-pad ↓ guarda los últimos 15 s (buffer circular a 60 cuadros/s) en partido, juego libre, entrenamiento o durante la repetición de un gol. Si el clip tiene un gol, se titula con el goleador.
- **Exportar a WebM** (`exporter.ts`):
  - `canvas.captureStream(60)` más `MediaRecorder` (VP9 o VP8);
  - el audio se toma de la salida general del motor de sonido (`MediaStreamAudioDestinationNode`), si el navegador lo permite;
  - un clip se exporta entero y de un partido se exportan 30 s desde la posición actual;
  - durante la exportación se ocultan los controles (Esc cancela) y al terminar se descarga el `.webm`.
  - la grabación es en tiempo real: si el equipo no llega a dibujar fluido, el video sale más lento que el juego.

## Pruebas

- `npm run test:training` cubre packs, sesión (acierto, fallo y arquero), rebobinado determinista, formato de repetición (precisión, pads, reloj, interpolación), clips y códigos.
- `tests/e2e/extras.cjs` (Playwright, con el preview en el puerto 4303) recorre el flujo completo:
  - menú;
  - entrenamiento (acierto, siguiente, reintentar, rebobinar, pausa);
  - juego libre (rebobinar, lanzar, congelar, turbo);
  - clips, biblioteca y visor (velocidad, cámaras, scrub, pausa, exportar WebM);
  - partido (repetición de gol con director, cartel oculto al volver al juego, grabación, guardado al terminar, visor con goles);
  - editor (ubicar con clic, flecha de velocidad, guardar, probar y volver).
