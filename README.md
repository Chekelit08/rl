# TURBOGOL (nombre provisorio)

Fútbol con autos en el navegador: física competitiva a 120 Hz, aéreos, flips, paredes, turbo, demoliciones y bots.
Inspirado en el género "car soccer", con **identidad propia** (nombre, arte, autos, estadio y audio originales).

## Jugar

```bash
npm install
npm run dev        # http://localhost:5173
```

Build de producción: `npm run build` (sale en `dist/`, es estático y se puede subir a cualquier hosting).

## Qué hay en esta versión (Fase 1)

- **Arena** de medidas estándar del género, modelada como SDF. Incluye rampas curvas, esquinas achaflanadas, arcos con red y postes redondeados.
- **Física del auto** calibrada con los números del estudio:
  - acelerador, freno, giro según velocidad y derrape analógico;
  - adherencia a paredes; en el techo te caés;
  - salto con hold, doble salto, flips con cancel (half-flip, speed flip), control aéreo y air roll;
  - turbo, supersónico, bumps y demoliciones.
- **Pelota:** rebote con fricción y spin, drag y el impulso extra en los golpes que da el "feel" del género.
- **Partidos vs bots** 1v1, 2v2 y 3v3, con 3 dificultades (Novato, Profesional, Leyenda).
  - Reglas: kickoff con 5 posiciones, reloj, gol de oro y fin cuando la pelota toca el piso en 0:00.
  - Puntaje y estadísticas: goles, asistencias, atajadas, tiros, demos y toques.
- **Juego libre** con turbo infinito opcional.
- **Repetición de gol** automática con cámara lenta (se saltea con Espacio / A).
- **Cámara** de pelota y de auto con FOV, distancia, altura, ángulo, rigidez, giro y transición configurables.
- **HUD:** marcador, medidor de turbo, feed de eventos, nombres sobre los autos y tabla de puntajes (Tab).
- **Controles:** teclado, mouse y mando.
- **Audio** sintetizado (sin assets con licencia).

## Controles

| Acción | Teclado / mouse | Mando |
|---|---|---|
| Acelerar / reversa | W / S | RT / LT |
| Dirección · yaw | A / D | Stick izq. |
| Pitch en el aire | W / S | Stick izq. ↑↓ |
| Saltar / flip | Espacio · clic der. | A |
| Turbo | Clic izq. · K | B |
| Derrape + air roll | Shift izq. | X |
| Air roll izq./der. | Q / E | LB / RB |
| Cámara de pelota | C · rueda | Y |
| Reiniciar (libre) | R | D-pad ↑ |
| Puntajes / Pausa | Tab / Esc | View / Menu |

## Pruebas

```bash
npm run test:sim    # física: velocidades, saltos, flips, paredes, rebotes, tiros, goles
npm run test:bots   # partidos completos bot vs bot (1v1, 2v2, 3v3)
npm run typecheck
```

## Estructura

```
docs/01-estudio-referencia.md   estudio del género: espacio, física, mecánicas, rangos, modos, online
docs/02-diseno-juego.md         diseño de TURBOGOL: identidad, modos, rangos, arquitectura, hoja de ruta
src/sim/      simulación pura y determinista (sin Three.js) → reutilizable en el servidor online
src/ai/       bots (misma API de input que un jugador)
src/render/   Three.js: estadio, autos procedurales, efectos, cámara
src/input/    teclado + mouse + mando
src/audio/    WebAudio sintetizado
src/main.ts   bucle de juego, menús, HUD, repeticiones
tests/        pruebas headless de la simulación y de los bots
```

## Próximas fases

- **F2:** entrenamiento (packs + editor + códigos), guardar clips, visor de repeticiones, reasignar controles.
- **F3:** online casual (servidor autoritativo, predicción + rollback).
- **F4:** competitivo (MMR Glicko-2, rangos, temporadas).

Ver la hoja de ruta completa en `docs/02-diseno-juego.md`.
