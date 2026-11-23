# 08 · Garage, progresión, competitivo y HUD (W5)

Todo es local y offline: sin dinero real, sin cuentas. Los datos viven en `localStorage` (siempre con `try/catch`).

## Módulos

| Ruta | Contenido |
|---|---|
| `src/garage/cosmetics.ts` | Catálogo (acabados, calcos, llantas, estelas, explosiones, títulos, banners) y reglas de desbloqueo por nivel o rango. |
| `src/garage/loadout.ts` | Loadout persistente (`turbogol.loadout`), `lookFromLoadout` y `botLook` (variedad para los bots). |
| `src/garage/decals.ts` | Calcomanías procedurales pintadas en un canvas; se mapean por UV del loft de `carMesh.ts`. |
| `src/garage/fxRender.ts` | Estelas de turbo y explosiones de gol (`CosmeticFx`), enganchadas a `GameRenderer.cosmetics`. |
| `src/progression/progression.ts` | XP, niveles (`400 + 100·(n-1)` por nivel), estadísticas de carrera, historial. |
| `src/progression/ranked.ts` | Glicko-2, tabla de rangos, clasificatorias y dificultad de bots según MMR. |
| `src/sim/touchEvents.ts` | Clasificación de toques: primer toque, despeje, centro, toque aéreo y atajada épica. |
| `src/ui/*` | Pantallas (Garage, Competitivo, Perfil, Reasignar), post-partido, puntos, chat rápido y `ui.css`. |
| `src/input/input.ts` | Controles reasignables (`turbogol.controls`). |

## Garage
- Vista 3D que gira sobre una plataforma; arrastrá para orbitar, rueda para acercar. Se dibuja con el renderer principal vía `GameRenderer.preview`.
- 6 carrocerías, pintura primaria **sólo en tonos del equipo** (8 por equipo), secundaria libre (14), 4 acabados (brillante, mate, metalizado, perlado), 10 calcos, 7 llantas, 9 estelas, 8 explosiones, 14 títulos y 7 banners.
- Los ítems bloqueados muestran qué hace falta (nivel o rango). Probar turbo / explosión en el propio garage.
- El detalle visual (tomas, faros, difusor, parrilla) no cambia las hitboxes.

## Progresión
- XP por partido: completo 120, victoria 120, 0,3×puntaje, MVP 50, primer partido del día 200. Abandonar = 0.
- Los desbloqueos por nivel se anuncian en el post-partido. Los de rango (`tier`) se otorgan al clasificar/subir en cualquier playlist.
- Estadísticas: partidos, V/D/E, goles, asistencias, atajadas (y épicas), tiros, demoliciones, MVP, despejes, centros, toques aéreos, gol más rápido, tiempo jugado.

## Competitivo (offline)
- Playlists 1v1, 2v2 y 3v3 contra bots. Cada playlist guarda su Glicko-2 (`r`, `rd`, `vol`).
- 10 partidas de clasificación: durante ellas no se muestra rango. Abandonar cuenta como derrota.
- Rangos: Bronce, Plata, Oro, Platino, Diamante (cada uno I–III), Élite I–III, Maestro I–III e Ícono; cada subnivel tiene divisiones I–IV. Íconos SVG propios (`src/ui/rankIcons.ts`).
- Dificultad de bots: `botDifficultyFor(MMR)` mezcla Novato/Profesional/Leyenda según el MMR; el rival se evalúa con `BOT_MMR = [300, 750, 1200]`.

## Puntaje y HUD
| Jugada | Puntos |
|---|---|
| Tiro | +20 |
| Atajada / épica | +50 / +75 |
| Gol | +100 |
| Asistencia | +50 |
| Demolición | +10 |
| Despeje | +20 |
| Centro, toque aéreo, primer toque | +10 |

Las notificaciones aparecen junto al turbo (`src/ui/points.ts`). Al final: pantalla de MVP (mejor puntaje del equipo ganador) y resultados con barra de XP y tarjeta de rango animada (sube/baja).

## Chat rápido
Teclas 1–4 (o D-pad) abren un grupo de 4 frases; una segunda pulsación elige la frase. Límite de 4 mensajes cada 6 s. Los bots responden a veces y comentan goles, demoliciones y atajadas.

## Controles
Menú → Controles → Reasignar. Dos teclas por acción (incluye clic central/derecho), botones del mando, sensibilidad de dirección y de aire, deadzone, invertir pitch y vibración (`vibrationActuator`, en goles, demos y choques). Defaults del mando: reset en L3, clip en R3; el D-pad queda para el chat.

## Eventos nuevos del simulador
`{ type: 'feat', carId, feat, points }` y `save.epic`. `World.kickoffTouched` marca el primer toque tras cada saque.
