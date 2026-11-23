# 07 · Bots

Los bots viven en `src/ai/` y juegan solo a través de `CarInput` (igual que una persona). Corren en Node sin Three.js.

## Módulos
- `params.ts`: todos los parámetros por dificultad (Novato, Profesional, Leyenda). Es el único lugar para afinar.
- `prediction.ts`: trayectoria de la pelota a 60 Hz y tiempo de gol por arco.
- `control.ts`: alcance (curva de velocidad/turbo), conducción con llegada a tiempo, control aéreo PD con air roll, recuperación y predicción de aterrizaje en paredes.
- `maneuvers.ts`: flip, remate con salto/doble salto, aéreo rápido guiado (con tramo de conducción previo), speed flip y half-flip.
- `strategy.ts`: roles 1.º/2.º/3.er hombre con histéresis, elección de tiro apuntado dentro del arco, búsqueda de intercepción, posiciones defensivas y rutas de turbo.
- `bot.ts`: máquina de modos (kickoff, tiro, posición, retirada, sombra, demo, dribble) y kickoffs por rol (tomar, cheat, turbo, fake).

## Niveles
- Novato: sin turbo, sin rotación, sin saltos; reacciona lento y apunta con error.
- Profesional: rotación básica, turbo, saltos y flips, aéreos de baja altura, recuperación.
- Leyenda: todo lo anterior más speed flip, half-flip, wave dash, dribble y flick, aéreos con flip final, sombra, demoliciones y gestión de turbo.

## Validación
- `npm run test:bots` (menos de 60 s): mecánicas aisladas (`tests/bots.mechanics.ts`: kickoffs, recuperación, aéreos, half-flip, costo por tick) y torneo rápido (`tests/bots.tournament.ts rapido`).
- Torneo completo: `node --experimental-strip-types tests/bots.tournament.ts` (unos 2 minutos). Resultados de referencia: Leyenda vence a Profesional 110-8 en 1v1 y 85-3 en 2v2; Profesional vence a Novato 25-3; sin NaN ni autos fuera de la arena; costo de 2 a 9 µs por tick por bot (límite 200 µs).
- La lógica usa constantes de `src/sim/constants.ts` y la predicción real del mundo, por lo que tolera cambios pequeños de física.
