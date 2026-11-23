# 11 · Mutadores y desafíos

## Mutadores (`src/sim/rules.ts`)

Reglas de física y de partido que se eligen en la pantalla de configuración (Partido vs bots y Juego libre), dentro del desplegable **Mutadores**.

| Mutador | Opciones (la estándar en negrita) |
|---|---|
| Gravedad | Baja (−325) · **Normal (−650)** · Alta (−1137,5) · Lunar (−110) |
| Rebote de la pelota | Bajo 0,35 · **Normal 0,6** · Alto 0,8 · Súper 0,95 |
| Velocidad de la pelota | Lenta 3500 · **Normal 6000** · Rápida 8500 · Sin freno 10500 |
| Peso de la pelota | Liviana ×0,35 · **Normal** · Pesada ×3 |
| Turbo | **Normal** · Ilimitado · Recarga lenta (10/s) · Recarga rápida (25/s) · Sin turbo |
| Fuerza del turbo | **1x** · 1.5x · 2x |
| Demoliciones | **Normales** · Desactivadas · Al contacto |
| Tope de goles | **Sin tope** · 1 · 3 · 5 |
| Velocidad del juego | Lenta 0,75 · **Normal** · Rápida 1,25 (sólo escala el reloj del cliente) |

Cómo funciona:

- `MatchConfig.rules` es opcional. Cada `World` guarda sus reglas y las aplica a `RULES` al empezar cada tick, así dos mundos con reglas distintas no se pisan.
- Con las reglas por defecto la simulación es idéntica a la estándar: **online y competitivo no usan mutadores**.
- Los bots leen la gravedad activa para sus aéreos; el resto de las predicciones sale de la misma simulación.
- "Velocidad del juego" no toca la simulación: multiplica el tiempo que avanza por cuadro.

## Desafíos (`src/challenges/`)

Recorridos contrarreloj con aros dentro del estadio. Menú principal → **Desafíos**.

| Desafío | Tipo | Aros | Turbo | Oro / Plata / Bronce |
|---|---|---|---|---|
| Slalom del estadio | Piso | 10 | Pastillas | 22 / 28 / 38 s |
| Primer vuelo | Aéreo | 12 | Ilimitado | 26 / 36 / 55 s |
| Vuelta por las paredes | Piso y pared | 12 | Pastillas | 24 / 31 / 42 s |
| Tirabuzón | Aéreo | 19 | Ilimitado | 34 / 48 / 75 s |

- El cronómetro arranca cuando el auto se mueve. Hay que pasar por dentro de cada aro, en orden.
- `R` devuelve al último aro (en los aéreos reaparecés volando hacia el siguiente). El cronómetro no se frena.
- Los récords se guardan en `localStorage` (`turbogol.challenges`).
- `courses.ts` es lógica pura (se prueba en Node); `challenges.ts` dibuja los aros, el HUD y los menús.
- Los tiempos de medalla son una primera estimación: un piloto automático simple hace ~27,7 s en los dos recorridos de piso. Los aéreos no están medidos con un jugador real.

Para agregar un recorrido: sumar una entrada a `COURSES` con la salida, el radio y los centros de los aros. Las normales se calculan solas.

## Correcciones de física de esta tanda

- **Bumps y demoliciones:** se decidían con la velocidad que quedaba *después* del impulso físico del choque, así que un golpe de frente a un rival quieto o lento nunca contaba (ni bump ni demolición). Ahora se usan las velocidades previas al choque.
- **Giro a máxima velocidad:** el último punto de la curva de curvatura estaba en 2500 uu/s; el valor de referencia es 2300 (0,00088).

Pruebas: `npm run test:rules`.
