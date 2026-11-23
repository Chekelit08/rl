# 12 · Autos e interfaz (rediseño)

## Autos (`src/render/carMesh.ts`)

Las seis carrocerías siguen siendo diseños propios, una por hitbox. Lo que cambió es cómo se construyen:

- **Las caras estaban invertidas.** La malla de la carrocería, la cabina y el techo se dibujaba con las caras hacia adentro: se veía el interior del auto y la luz le pegaba al revés. Venía de la primera versión y era la causa principal de que los autos se vieran raros y oscuros. Corregido en `loft`.
- **Sección de auto en vez de "barra de jabón":** piso plano, laterales con hombro (`nTop`) y cierre hacia arriba (`tumble`).
- **Pasarruedas reales:** el borde inferior del lateral sigue el arco de cada rueda (`arches`), y donde la rueda es más alta que el capó el lateral sube en un guardabarros.
- **Carrocería hasta casi el piso:** el hitbox del género flota sobre las ruedas; la carrocería visible ahora baja hasta 6 uu del piso, así las ruedas quedan dentro de los pasarruedas. **El hitbox no cambió.**
- **Luces al ras:** faros, luz diurna, faroles traseros y la tira LED de la cola son parches que copian la superficie (`surfacePatch`), no cajas pegadas.
- **Trompa y cola:** parrilla sobre la punta, tomas de aire en las esquinas, splitter y tobera del turbo que asoma por detrás.
- Se quitaron las cajas sueltas (toma del capó, tomas laterales, zócalos).

Herramienta de desarrollo: `src/dev/carsheet.ts` dibuja las seis carrocerías desde tres ángulos en una sola imagen. Desde la consola del navegador en `npm run dev`:

```js
(await import('/src/dev/carsheet.ts')).carSheet()   // devuelve un data URL PNG
```

## Interfaz

- **Menú principal:** tarjetas agrupadas en *Jugar* (Partido rápido, Competitivo, Online) y *Practicar* (Juego libre, Desafíos, Entrenamiento, Repeticiones), barra inferior (Garage, Perfil, Ajustes, Controles) y tarjeta del jugador con nivel y XP. El menú anterior, una lista de 11 botones, se cortaba por abajo en pantallas de 810 px de alto.
- **Medidor de turbo:** arco de 270°, rojo cuando queda poco y número resaltado en supersónico.
- **Garage:** el auto se ve más cerca.
- Ícono de pestaña propio (`public/favicon.svg`).
