# 02 · Documento de diseño: TURBOGOL (nombre provisorio)

> Fútbol con autos. **Las mismas sensaciones** que el referente del género (física, mecánicas, ritmo y competitivo) con **identidad propia**.
> Todo lo marcado con 🔧 son decisiones abiertas para charlar.

---

## 1. Pilares

1. **Física primero.** 120 Hz, determinista, calibrada con los números del estudio (doc 01). Si una mecánica avanzada del género no sale sola (half-flip, wave dash, flip reset…), es un bug.
2. **Justo.** Nada comprable afecta la física. Hay 6 hitboxes, todas disponibles desde el principio.
3. **Legible.** La pelota siempre clara, su sombra siempre debajo, los equipos con colores inconfundibles y un HUD mínimo.
4. **Sin fricción para jugar.** Se juega en el navegador: un link y estás jugando. Después, versión de escritorio.
5. **Compartible.** Clips de los últimos segundos con un botón, repeticiones completas y códigos de packs de entrenamiento.

---

## 2. Identidad

| Elemento | Decisión |
|---|---|
| Nombre | **TURBOGOL** 🔧 (provisorio) |
| Tono | **Realista:** estadio de fútbol de verdad, a pleno sol o de noche con reflectores, autos deportivos con pintura de auto real. Nada de estética "de juguete" |
| Equipos | **Azul** (#2E8BFF) vs **Rojo** (#FF3355) 🔧 (clásico deportivo, distinto del referente) |
| Pelota | Pelota de fútbol clásica (pentágonos y hexágonos), grande y bien contrastada. El patrón deja ver el giro (spin) |
| Tipografía | Display condensada en itálica (sensación de velocidad). Sans legible para el HUD |
| Estadio 1 | **Estadio Central:** dos anillos de tribunas con público, techo con reflectores, carteles LED y pantallas. Paredes de vidrio con montantes y tablero acolchado en la base. Versión **de día** (cielo físico con sol y nubes) y **de noche** |
| Estadios futuros 🔧 | Cañón Rojo (atardecer en el desierto), Puerto Neón (ciudad con lluvia), Domo Glaciar (hielo) |

Todos los estadios tienen **exactamente la misma geometría jugable** (como en el competitivo del género). Solo cambia la decoración.

---

## 2b. Fidelidad al original (qué es igual y qué es propio)

| Igual al original (mecánicas y sensación) | Propio (identidad) |
|---|---|
| Medidas de cancha, arcos, rampas y esquinas | Nombre, logo y estadios |
| Pads de turbo (posición, cantidad, tiempos) | Diseño de los autos (6 carrocerías propias) |
| Física del auto: aceleración, giro, salto, flip, cancel, aire, paredes | Pelota (patrón clásico de fútbol) |
| Física de la pelota y el impulso extra de cada golpe | Colores de equipo (Azul / Rojo) |
| Hitboxes de los 6 arquetipos | Nombres de rangos |
| Supersónico, bumps, demoliciones, flip reset | Audio |
| Reglas: 5:00, kickoff, gol de oro, fin al tocar el piso | |
| Cámara: FOV, distancia, altura, ángulo, rigidez, giro | |

## 3. Autos: 6 carrocerías originales (una por hitbox)

| Carrocería | Hitbox (L × A × H) | Personalidad |
|---|---|---|
| **Toro** | 120.5 × 86.7 × 38.7 | Equilibrado, el "auto por defecto" |
| **Flecha** | 130.4 × 85.8 × 33.8 | Largo y bajo, para flicks |
| **Lámina** | 131.3 × 87.2 × 31.9 | Plano y ancho, aéreos |
| **Aguja** | 134.0 × 83.0 × 32.8 | Largo y fino, precisión |
| **Mixto** | 129.5 × 84.7 × 36.7 | Híbrido |
| **Furgón** | 123.2 × 79.2 × 44.2 | Alto, defensivo |

**Personalización** (fase de progresión):
- pintura primaria y secundaria;
- calcomanías y ruedas;
- propulsor (color y forma de la llama del turbo) y estela;
- explosión de gol, título y banner.

---

## 4. Modos

| Fase | Modo | Descripción |
|---|---|---|
| ✅ F1 | **Juego libre** | Cancha sola, pelota y turbo infinito opcional. `R` resetea |
| ✅ F1 | **Partido vs bots** | 1v1, 2v2, 3v3; 3 dificultades (Novato, Profesional, Leyenda) |
| F2 | **Entrenamiento** | Packs de tiros (delantero, arquero, aéreo), editor y códigos para compartir |
| F2 | **Repeticiones y clips** | Repetición de gol automática; "Guardar clip" de los últimos 15 s; visor con línea de tiempo y cámaras |
| F3 | **Online casual** | Salas privadas con código; 1v1 a 3v3 |
| F4 | **Online competitivo** | Matchmaking por MMR, rangos y temporadas |
| F5 | **Modos extra** 🔧 | Básquet, hockey sobre hielo, pelota teledirigida, poderes |

---

## 5. Rangos (escalera propia)

| Tier | Subniveles | Ícono 🔧 |
|---|---|---|
| Bronce | I–III | Tuerca |
| Plata | I–III | Engranaje |
| Oro | I–III | Pistón |
| Platino | I–III | Turbina |
| Diamante | I–III | Cristal |
| **Élite** | I–III | Llama |
| **Maestro** | I–III | Corona con alas |
| **Ícono TURBOGOL** | único (top 100 por región) | Trofeo animado |

- 4 divisiones (I–IV) por subnivel.
- MMR con **Glicko-2**: rating, desviación y volatilidad.
- **Temporadas** de 3 meses con *soft reset* y 10 partidas de clasificación.
- **Recompensa** de temporada por victorias en tu rango.
- **MMR visible** opcional desde Élite.

---

## 6. Reglas de partido

- 5:00, gol de oro en el empate y fin cuando la pelota toca el piso en 0:00 (igual que el estándar del género).
- Kickoff con 5 posiciones; en 1v1 se espeja.
- Puntaje y estadísticas como se describe en el doc 01, §8.

---

## 7. Controles

### Teclado y mouse (default)

| Acción | Tecla |
|---|---|
| Acelerar / reversa / pitch | W / S |
| Dirección / yaw | A / D |
| Saltar | **Espacio** o click derecho |
| Turbo | **Click izquierdo** o K |
| Derrape + air roll libre | Shift izquierdo |
| Air roll izq./der. | Q / E |
| Cámara de pelota | C o rueda del mouse |
| Resetear (juego libre) | R |
| Pausa / menú | Esc |
| Ayuda de controles | F1 |

### Mando (Xbox/PS)

| Acción | Botón |
|---|---|
| Acelerar / reversa | RT / LT |
| Dirección | Stick izquierdo |
| Saltar | A / ✕ |
| Turbo | B / ○ |
| Derrape + air roll | X / □ |
| Cámara de pelota | Y / △ |
| Air roll dirigido | LB / RB |
| Mirar | Stick derecho |

Reasignación completa en la F2.

---

## 8. Cámara (valores por defecto, configurables)

| Parámetro | Valor |
|---|---|
| FOV | 110 (horizontal) |
| Distancia | 270 |
| Altura | 100 |
| Ángulo | −4° |
| Rigidez | 0.45 |
| Velocidad de giro (swivel) | 4.5 |
| Transición | 1.2 |

- Arranca con **cámara de pelota** activada.

---

## 9. HUD

| Zona | Contenido |
|---|---|
| Arriba al centro | Marcador Azul – Reloj – Rojo |
| Abajo a la derecha | Medidor circular de turbo (0–100) con el número grande |
| Arriba a la derecha | Feed de eventos (gol, atajada, demolición) |
| Centro | Cuenta regresiva y "¡GOL!" con el nombre del goleador |
| Sobre cada auto | Nombre y color del equipo |
| Indicador | Ícono de "ball cam" activa |

---

## 10. Arquitectura técnica

```
src/
  sim/      ← simulación pura (sin Three.js). Determinista, tick fijo 120 Hz.
              Corre igual en navegador y en Node (servidor online futuro).
    math.ts       vectores y cuaterniones propios
    constants.ts  todos los números del estudio
    arena.ts      geometría de la arena como SDF (función de distancia con signo):
                  colisiones exactas con curvas, chaflanes, arcos y postes redondeados
    car.ts        manejo, adherencia, salto, flip, control aéreo, turbo, supersónico
    ball.ts       pelota (rebote con fricción y spin, drag, límites)
    collide.ts    auto-pelota (con impulso extra), auto-auto (bump y demolición)
    world.ts      partido: reloj, kickoff, goles, pads, eventos
  ai/       ← bots (usan la misma API de input que un jugador humano)
  render/   ← Three.js: estadio, autos procedurales, pelota, efectos, cámara
  input/    ← teclado, mouse y mando unificados en un CarInput
  audio/    ← sonido sintetizado con WebAudio (sin assets con licencia)
  ui/       ← menús y HUD (HTML/CSS)
```

**Decisiones clave:**

| Decisión | Por qué |
|---|---|
| **Web (TypeScript + Three.js + Vite)** | Se juega con un link, es multiplataforma y el servidor (Node) comparte el mismo código de simulación. Después se puede empaquetar para escritorio (Tauri/Electron) |
| **Física propia, no un motor genérico** | Los motores genéricos (Rapier, Cannon) no reproducen el manejo del género. Controlar cada número es lo que da "el feel" |
| **Arena como SDF** | Superficies curvas perfectas sin mallas de colisión; la malla visual se genera de la misma función, así que lo que ves es exactamente lo que colisiona |
| **Render desacoplado con interpolación** | La física va a 120 Hz y el render a la frecuencia del monitor, interpolando entre ticks |
| **Snapshots** | El render dibuja "snapshots". Repeticiones, clips y online reutilizan el mismo formato |

### Plan online (F3–F4)

| Pieza | Solución |
|---|---|
| Servidor | Node con la misma carpeta `sim/`, autoritativo a 120 Hz |
| Transporte | WebSocket al principio; WebRTC DataChannel (UDP-like) para producción |
| Cliente | Predicción + rollback/resimulación (como el estándar del género) |
| Snapshots | 60 Hz |
| Matchmaking | Por región, MMR (Glicko-2) y playlist |
| Cuentas y datos | Supabase/Postgres 🔧 (perfiles, MMR, temporadas, clips) |
| Despliegue | Cliente en hosting estático; servidores de partida en regiones (Fly.io / VPS) 🔧 |

---

## 11. Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| **F1 — Núcleo jugable** | Arena, física completa (manejo, paredes, salto, flips, aéreos, derrape, turbo, supersónico, demoliciones), pelota, pads, goles, kickoff, reloj, HUD, cámara de pelota/auto, teclado y mando, bots 1v1/2v2/3v3, repetición de gol, audio sintetizado | ✅ |
| **F1.5 — Realismo** | Estadio realista de día y de noche, autos con carrocería esculpida y pintura con barniz, césped natural, pelota clásica, humo del turbo, flip reset | ✅ |
| **F1.6 — Realismo II** | Cielos HDRI fotográficos (CC0), público 3D animado (~20.000), gradas escalonadas, techo con cerchas, reflejos capturados del estadio, GTAO, MSAA, gradación de color, sombras de contacto, marcas de neumáticos | ✅ |
| F1.7 — Assets de artista 🔧 | Modelos 3D de autos hechos por un artista o generados con IA (mismas hitboxes), sonido grabado (público, motor, bocina) | Pendiente de recursos |
| F2 — Entrenamiento y clips | Packs de entrenamiento + editor + códigos, guardar clips (IndexedDB) y exportar, visor de repeticiones, ajustes de cámara/controles/gráficos, tutorial | Próxima |
| F3 — Online casual | Servidor autoritativo, salas con código, predicción/rollback, chat rápido | |
| F4 — Competitivo | Cuentas, matchmaking, MMR Glicko-2, rangos, temporadas, estadísticas | |
| F5 — Contenido | Más estadios, cosméticos, progresión, modos extra, torneos | |
| F6 — Pulido | Optimización, móviles con mando, escritorio, accesibilidad, anti-trampa | |
