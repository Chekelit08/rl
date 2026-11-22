# 01 · Estudio del género "fútbol con autos"

> Documento de investigación. Analiza el juego de referencia del género (Rocket League, de Psyonix/Epic) para entender **por qué funciona**: espacio, físicas, mecánicas, rangos, modos, presentación y online.
> El objetivo es replicar la **sensación de juego y las mecánicas** (no se pueden proteger), **no** su marca, arte, autos, estadios, música ni nombres (eso sí está protegido). Ver la sección 17.

**Unidades:** todo se mide en *Unreal Units* (uu). **1 uu = 1 cm.** Eje Z hacia arriba. El equipo que defiende el arco en −Y ataca hacia +Y.

**Fuentes:** las constantes vienen de mediciones de la comunidad, que el código abierto de **RocketSim** (ZealanL, `RLConst.h`, `CarConfig.cpp`) recopila y verifica contra el juego real. Las complementan las notas de física de Samuel P. Mish (RLUtilities) y la wiki de RLBot. Los datos de rangos y temporadas son de 2026.

---

## 1. Por qué funciona el género

1. **Una regla, profundidad infinita.** "Meté la pelota en el arco con un auto." Cualquiera lo entiende en 5 segundos, y los mejores siguen aprendiendo después de miles de horas.
2. **Física determinista y consistente.** Una misma acción produce siempre el mismo resultado. Eso permite *aprender* tiros, como en un deporte real. **Es el pilar más importante.**
3. **Control total del auto en 3D.** El auto salta, hace flips, vuela con turbo y maneja por paredes y techo. El techo de habilidad no tiene límite.
4. **Partidas cortas (5 min).** El ciclo "una más" es muy adictivo.
5. **Sin pay-to-win.** Todos los autos que se usan en competitivo comparten la misma física. Solo cambian la *hitbox* (6 tipos) y la estética.
6. **Lectura visual impecable.** Pelota enorme, sombra justo debajo, colores de equipo opuestos, cancha simétrica y HUD mínimo.

---

## 2. Espacio: la arena

### 2.1 Dimensiones (arena estándar, todos los mapas competitivos son idénticos)

| Elemento | Valor |
|---|---|
| Ancho de la cancha (paredes laterales) | **8192 uu** (x = ±4096) |
| Largo de la cancha (hasta la línea de gol) | **10240 uu** (y = ±5120) |
| Altura del techo | **2044 uu** (≈2048) |
| Esquinas | Achaflanadas a 45°: plano `|x| + |y| = 8064`, cada corte mide 1152 uu por lado |
| Transición piso↔pared y pared↔techo | Curvas cóncavas (rampas) de radio ~256 uu. Permiten subir a la pared sin saltar |
| Arco: ancho | **1786 uu** (x = ±893) |
| Arco: alto | **642.775 uu** |
| Arco: profundidad | **880 uu** (fondo de red en y = ±6000) |
| Gol válido | La pelota cruza **entera** la línea: `|y| > 5124.25 + radio de la pelota` |

**Lecturas de diseño:**
- La cancha es **más larga que ancha** (relación ≈ 1.25), igual que en el fútbol.
- La altura (2044) da para que el juego aéreo sea parte central del juego.
- No hay esquinas muertas: chaflanes y rampas hacen que la pelota *siempre* vuelva al juego.
- Las paredes son superficies de juego: se maneja por ellas y la pelota rebota predeciblemente.

### 2.2 Pads de turbo (boost)

| Tipo | Cantidad | Turbo que da | Reaparece en | Radio de recogida |
|---|---|---|---|---|
| **Grande** | 6 | +100 (llena) | 10 s | 208 uu |
| **Chico** | 28 | +12 | 4 s | 144 uu |

**Pads grandes:** (±3584, 0) en los laterales del medio campo y (±3072, ±4096) en las 4 esquinas.

**Pads chicos (x, y):** (0, ±4240), (±1792, ±4184), (±940, ±3308), (0, ±2816), (±3584, ±2484), (±1788, ±2300), (±2048, ±1036), (0, ±1024), (±1024, 0).

```
           ARCO ROJO (+Y)
   G  .   .   .   .   .   G        G = pad grande (esquinas)
     .   .   .   .   .   .         . = pads chicos (caminos)
   .     .       .     .
 G   .       ●       .   G         ● = saque inicial (centro)
   .     .       .     .           G laterales en (±3584, 0)
     .   .   .   .   .   .
   G  .   .   .   .   .   G
           ARCO AZUL (−Y)
```

El layout crea **rutas de turbo** ("caminos de pads chicos") que premian el movimiento eficiente. Agarrar los pads grandes es una decisión táctica, porque te saca de la jugada.

### 2.3 Posiciones de saque (kickoff)

Cinco posiciones fijas por equipo (azul; el rojo es el espejo):

| Posición | (x, y) | Orientación |
|---|---|---|
| Diagonal izquierda | (−2048, −2560) | 45° hacia la pelota |
| Diagonal derecha | (2048, −2560) | 135° hacia la pelota |
| Off-center izquierda | (−256, −3840) | hacia +Y |
| Off-center derecha | (256, −3840) | hacia +Y |
| Atrás (centro) | (0, −4608) | hacia +Y |

- Cuenta regresiva de 3 s con los autos congelados. Cada auto arranca con **33.3 de turbo**.
- En 1v1 se sortea una posición y el rival recibe la misma, espejada (es justo).
- **Respawn tras una demolición:** (±2304, −4608) y (±2688, −4608), después de **3 s**.

---

## 3. Física de la pelota

| Propiedad | Valor |
|---|---|
| Radio de colisión | 91.25 uu (visual ≈ 92.75) |
| Masa | 30 (el auto pesa 180, o sea 6 veces más) |
| Gravedad | −650 uu/s² (más baja que la real, la pelota "flota") |
| Restitución (rebote) | 0.6 |
| Fricción con superficies | 0.35 |
| Resistencia del aire (drag) | 3 % de la velocidad por segundo |
| Velocidad máxima | 6000 uu/s (216 km/h) |
| Velocidad angular máxima | 6 rad/s |

**Lecturas de diseño:**
- La gravedad baja da tiempo a leer la pelota y a preparar aéreos.
- Con rebote 0.6, la pelota pierde energía en cada bote y termina rodando: hay momentos de "control" en el piso (dribbles).
- El efecto (spin) cambia el rebote: una pelota con giro picará distinto. Es sutil, pero los jugadores avanzados lo leen.

### 3.1 Golpe auto → pelota (clave del "feel")

Además del choque físico normal (restitución 0 y fricción alta, 2.0), el juego **agrega un impulso extra** a la pelota en cada toque, para que los golpes se sientan potentes y controlables:

```
relSpeed = min(|v_pelota − v_auto|, 4600)
dir      = normalizar((pos_pelota − pos_auto) * (1, 1, 0.35))   // aplana la componente vertical
dir      = normalizar(dir − adelante * (dir·adelante) * 0.35)  // reduce la componente frontal
v_pelota += dir * relSpeed * factor(relSpeed)
factor: 0 → 0.65 | 500 → 0.65 | 2300 → 0.55 | 4600 → 0.30   (interpolación lineal)
```

- La dirección del tiro depende de **dónde toca la pelota** en el auto (centro a centro), no de la cara del hitbox. Por eso pegarle "con la esquina" desvía el tiro, y los jugadores apuntan.
- Hay un enfriamiento de 1 tick entre impulsos extra.

---

## 4. Física del auto

La física corre a **120 ticks por segundo** (fijo). El auto es un cuerpo rígido (caja, masa 180) con 4 ruedas de suspensión por rayos (estilo `btRaycastVehicle` de Bullet).

### 4.1 Velocidades

| Concepto | Valor |
|---|---|
| Velocidad máx. solo con acelerador | **1410 uu/s** (~51 km/h) |
| Velocidad máx. absoluta (con turbo) | **2300 uu/s** (~83 km/h) |
| Supersónico | desde **2200 uu/s**; se mantiene si no bajás de 2100 por hasta 1 s |
| Velocidad angular máx. | 5.5 rad/s |

### 4.2 Aceleración en el piso

| Concepto | Valor |
|---|---|
| Acelerador a 0 uu/s | **1600 uu/s²**, que cae linealmente a 160 uu/s² en 1400 uu/s y a 0 en 1410 |
| Freno (acelerar en sentido contrario) | **3500 uu/s²** |
| Rodar sin acelerar ("coasting") | 525 uu/s² de frenado (15 % del freno); por debajo de 25 uu/s, frenado total |
| Turbo en el piso | **+991.67 uu/s²** (el acelerador queda forzado al máximo) |
| Turbo en el aire | **+1058.33 uu/s²** |
| Acelerador en el aire | +66.67 uu/s² (casi nada, pero existe) |

### 4.3 Giro (steering)

El ángulo máximo de las ruedas baja con la velocidad. El radio de giro **crece** cuanto más rápido vas:

| Velocidad (uu/s) | Ángulo máx. de rueda (rad) | Curvatura aprox. (1/uu) |
|---|---|---|
| 0 | 0.534 | 0.00690 |
| 500 | 0.319 | 0.00398 |
| 1000 | 0.182 | 0.00235 |
| 1500 | 0.106 | 0.00138 |
| 1750 | 0.085 | 0.00110 |
| 2300+ | ~0.035–0.06 | 0.00088 |

### 4.4 Derrape (powerslide / freno de mano)

- Es un valor analógico de 0 a 1: sube a **5/s** al apretar y baja a **2/s** al soltar.
- Reduce la fricción lateral al **10 %** y amplía el ángulo de giro (0.39 rad a 0 uu/s → 0.126 rad a 2500 uu/s).
- Sirve para girar en seco, **recuperar orientación** al aterrizar y hacer *wave dash*.

### 4.5 Fricción de neumáticos

- La fricción lateral depende del deslizamiento: 1.0 sin deslizar, 0.2 deslizando del todo.
- **Fricción "no pegajosa":** si no acelerás, la fricción baja según la inclinación de la superficie (×0.1 en pared vertical, ×1 en el piso). Por eso, si soltás el acelerador en la pared, **resbalás hacia abajo**.

### 4.6 Fuerza de adherencia (manejar por paredes)

Mientras alguna rueda toca una superficie, se aplica una fuerza hacia la superficie:

```
escala = 0.5                         (siempre)
       + (1 − |normal.z|)            (si acelerás o vas a más de 25 uu/s)
fuerza = −normal * escala * 650 uu/s²
```

- En el piso: 0.5 g extra.
- En una pared vertical: 1.5 g hacia la pared, así que el auto se queda pegado.
- En el techo: 0.5 g, menos que la gravedad, así que **te caés del techo**. Por eso los *ceiling shots* se hacen saltando desde ahí.

### 4.7 Salto

| Concepto | Valor |
|---|---|
| Impulso inmediato | **291.67 uu/s** en la dirección "arriba" del auto |
| Fuerza mientras mantenés | **1458.33 uu/s²** (×0.62 los primeros 0.025 s) |
| Tiempo máx. manteniendo | **0.2 s** (mínimo 0.025 s) |
| Ventana de 2.º salto / flip | hasta **1.25 s** después de terminar el primer salto |

- Saltar **en la dirección del techo del auto** permite saltar desde paredes y techo.
- **Doble salto:** otro impulso de 291.67 hacia arriba (sin dirección en el stick).

### 4.8 Flip (dodge)

Con dirección en el stick, el segundo salto se convierte en un **flip**:

| Concepto | Valor |
|---|---|
| Impulso | 500 uu/s en la dirección del stick (en el plano horizontal) |
| Escalado por velocidad | Lateral hasta ×1.9; hacia atrás hasta ×2.5 (×16/15) cuando vas rápido |
| Duración de la rotación | **0.65 s** (torque de flip: 260 lateral / 224 frontal) |
| Amortiguación vertical | Entre 0.15 s y 0.21 s (o mientras caés) la velocidad Z se multiplica por 0.65 cada tick: el flip es "plano" |
| Bloqueo de pitch | 0.3 s extra al terminar el flip |
| **Flip cancel** | Si durante el flip empujás el pitch **en contra**, la rotación se cancela (base del *half-flip* y del *speed flip*) |

### 4.9 Control aéreo

Aceleraciones angulares directas (no dependen de la inercia):

| Eje | Aceleración (rad/s²) | Amortiguación cuando soltás (1/s) |
|---|---|---|
| Pitch (nariz arriba/abajo) | **12.46** | 2.88 |
| Yaw (girar izq./der.) | **9.11** | 1.92 |
| Roll (rotar sobre el eje largo) | **38.34** | 4.79 (siempre activa) |

- El roll es 3 veces más rápido, por eso el **air roll** es tan importante para orientarse.
- **Air roll libre:** mientras mantenés el botón, el stick horizontal controla el roll en lugar del yaw.
- La amortiguación **frena la rotación** cuando soltás el stick: es lo que hace al auto "preciso" en el aire.

### 4.10 Auto-recuperación

- **Auto-flip:** si estás panza arriba en el piso y apretás saltar, el auto se da vuelta solo.
- **Auto-roll:** con acelerador y ruedas parcialmente apoyadas, el auto tiende a alinearse con la superficie.

### 4.11 Choques entre autos

- **Bump:** chocar con la parte frontal (paragolpes) empuja al otro auto según tu velocidad:
  - en el piso, 1100 uu/s a 1400 de velocidad y 1530 a 2200;
  - en el aire, 1390 y 1945;
  - además hay un impulso hacia arriba de 278 a 417.
- **Demolición:** si lo chocás de frente **siendo supersónico**, el rival explota y reaparece en **3 s**.
- Enfriamiento de 0.25 s entre bumps contra el mismo auto.

### 4.12 Hitboxes (los 6 tipos)

En el juego real hay decenas de autos, pero **todos usan una de estas 6 cajas de colisión**. El resto es estética. Medidas (largo × ancho × alto, uu):

| Arquetipo | Hitbox | Desplazamiento (adelante, arriba) | Estilo de juego |
|---|---|---|---|
| Equilibrado alto | 120.5 × 86.7 × 38.7 | (13.9, 20.8) | Polivalente, el más usado |
| Largo y plano | 130.4 × 85.8 × 33.8 | (9.0, 15.8) | Flicks y tiros potentes |
| Muy plano y ancho | 131.3 × 87.2 × 31.9 | (9.0, 12.1) | Aéreos y bloqueos laterales |
| Largo y angosto | 134.0 × 83.0 × 32.8 | (12.5, 11.8) | Precisión en el aire |
| Híbrido | 129.5 × 84.7 × 36.7 | (13.9, 20.8) | Entre el equilibrado y el plano |
| Alto tipo furgón | 123.2 × 79.2 × 44.2 | (11.4, 21.5) | Defensa y "50/50" |

El auto descansa con el origen a 17 uu del piso.

---

## 5. Cámara

La cámara es parte de la jugabilidad (se ajusta tanto como el mouse en un shooter).

| Parámetro | Rango | Típico competitivo |
|---|---|---|
| FOV (horizontal) | 60–110 | **110** |
| Distancia | 100–400 | 260–280 |
| Altura | 40–200 | 90–110 |
| Ángulo | −15 a 0 | −3 a −5 |
| Rigidez (stiffness) | 0–1 | 0.4–0.6 |
| Velocidad de giro (swivel) | 1–10 | 3–6 |
| Velocidad de transición | 1–2 | 1.0–1.3 |

- **Cámara de pelota (ball cam):** apunta siempre a la pelota (99 % de los jugadores la usan casi todo el tiempo).
- **Cámara de auto:** mira hacia donde apunta el auto (se usa para orientarse, agarrar turbo o recuperar).
- La cámara sigue la velocidad con un leve retraso (rigidez) y **se reorienta suavemente al subir a la pared**.
- El stick derecho permite mirar alrededor.

---

## 6. Controles

### 6.1 Mando (estándar)

| Acción | Botón |
|---|---|
| Acelerar / reversa | RT / LT |
| Dirección / pitch / yaw | Stick izquierdo |
| Saltar | A |
| Turbo | B |
| Derrape + air roll | X |
| Cámara de pelota | Y |
| Air roll izq./der. dirigido | LB / RB (configurable) |
| Mirar | Stick derecho |

### 6.2 Teclado y mouse (defaults habituales)

| Acción | Tecla |
|---|---|
| Acelerar / reversa (y pitch en el aire) | W / S |
| Dirección / yaw | A / D |
| Saltar | Click derecho |
| Turbo | Click izquierdo |
| Derrape + air roll | Shift izquierdo |
| Air roll dirigido | Q / E |
| Cámara de pelota | Espacio |

Todo es reasignable. En competitivo se usa casi siempre mando o "mando-like".

---

## 7. Mecánicas de jugador (lo que la física permite)

Estas mecánicas **no están programadas como tales**: emergen de las reglas físicas de arriba. Si la física es la misma, aparecen solas. Esa es la prueba de que el clon "se siente bien".

| Nivel | Mecánica | Qué es | Física que la habilita |
|---|---|---|---|
| Básico | **Power shot** | Pegar fuerte de frente | Impulso extra + velocidad relativa |
| Básico | **Salto / doble salto** | Tocar pelotas altas | 4.7 |
| Básico | **Front flip / side flip** | Ganar velocidad y potencia | 4.8 |
| Básico | **Manejar por pared** | Usar paredes como piso | Rampas + adherencia (4.6) |
| Intermedio | **Aéreo** | Volar hacia la pelota con turbo | Turbo en aire > gravedad (1058 > 650) |
| Intermedio | **Fast aerial** | Salto + mantener + 2.º salto inmediato + turbo | Ventana de salto + turbo |
| Intermedio | **Half-flip** | Media vuelta rápida: flip atrás + cancelar + air roll | Flip cancel |
| Intermedio | **Wave dash** | Flip justo al tocar el piso para ganar velocidad | Flip al aterrizar con derrape |
| Intermedio | **Recuperación** | Caer siempre sobre las ruedas, con velocidad | Control aéreo + derrape |
| Intermedio | **Dribble** | Llevar la pelota sobre el techo del auto | Fricción auto-pelota 2.0 |
| Intermedio | **Flick** | Lanzar la pelota del techo con un flip | Flip + impulso extra |
| Avanzado | **Speed flip** | Flip diagonal cancelado: kickoff ultra rápido | Flip cancel + air roll |
| Avanzado | **Air dribble** | Llevar la pelota en el aire con toques suaves | Control aéreo fino + turbo |
| Avanzado | **Ceiling shot** | Caer del techo con el flip guardado | Sin adherencia en el techo + ventana de flip |
| Avanzado | **Flip reset** | Tocar la pelota con las 4 ruedas en el aire recupera el flip | Las ruedas en contacto reinician los saltos |
| Avanzado | **Double tap** | Tiro a la pared trasera y remate del rebote | Rebote predecible |
| Avanzado | **Musty flick** | Flip hacia atrás debajo de la pelota | Flip + impulso extra |
| Avanzado | **Demo / bump** | Sacar rivales de la jugada | 4.11 |

**Táctica:** rotación (en 3v3: atacante, apoyo y último hombre), *shadow defense* (defender retrocediendo en línea con la pelota), *boost starving* (robar turbo), *50/50* (choque simultáneo), *fakes*, pases a la pared y *kickoffs* coordinados.

---

## 8. Reglas del partido

- **Duración:** 5:00. El reloj se detiene en goles y kickoffs.
- **En 0:00:** el partido termina cuando la pelota toca el piso.
- **Empate:** tiempo extra de **gol de oro**, con reloj ascendente.
- **Tras un gol:** explosión, ~3 s de festejo (podés seguir manejando), repetición opcional (se saltea) y nuevo kickoff.
- **Rendición:** se puede votar a partir de cierto minuto.
- **Puntaje individual:**
  - gol 100, asistencia 50, atajada 50, tiro 20;
  - demolición 10, toque de pelota 2;
  - despeje / centro 10–20, "épica atajada" 75.
- **Estadísticas por jugador:** goles, asistencias, atajadas, tiros, demoliciones, turbo usado, velocidad media y tiempo supersónico.

---

## 9. Modos de juego (playlists)

| Tipo | Modos |
|---|---|
| **Competitivo** | Duelo 1v1, Dobles 2v2, Estándar 3v3 |
| **Competitivo extra** | Básquet con autos, Rumble (poderes), Dropshot (piso que se rompe), Hockey sobre hielo (disco) |
| **Casual** | 1v1, 2v2, 3v3, Caos 4v4 (sin rango, se puede abandonar) |
| **Temporales** | Pelota teledirigida, Spike Rush (la pelota se pega), fútbol americano, knockout, etc. |
| **Torneos** | Torneos automáticos programados por rango, con recompensas |
| **Privado / personalizado** | Partidas privadas con "mutadores" (gravedad, tamaño de pelota, velocidad, turbo infinito…) |
| **Offline** | Partida vs bots (3 dificultades), temporada offline |

---

## 10. Sistema de rangos (estado 2026)

### 10.1 Estructura

| Tier | Subniveles | Divisiones |
|---|---|---|
| Bronce | I–III | 4 por subnivel (I–IV) |
| Plata | I–III | 4 |
| Oro | I–III | 4 |
| Platino | I–III | 4 |
| Diamante | I–III | 4 |
| Campeón | I–III | 4 |
| Gran Campeón | I–III | 4 |
| Leyenda (top) | — | — |

- **Rango separado por playlist** (1v1, 2v2, 3v3, extras).
- **MMR oculto** (variante de TrueSkill/Elo) con incertidumbre: al principio subís y bajás mucho; después se estabiliza.
- **Ganar o perder** mueve unos **±9–10 MMR** cuando el MMR está asentado.
- **Protección de división:** te demoran un poco la bajada.
- **Temporadas** de ~3 meses:
  - *soft reset* del MMR;
  - **10 partidas de clasificación**;
  - recompensas de fin de temporada según las victorias en tu rango.
- **Season 22 (marzo de 2026):** se agregó la opción de **ver tu MMR** a partir de Gran Campeón I.
- **Distribución aproximada:** la mayoría está entre Plata y Platino. Gran Campeón y la Leyenda son menos del 1–2 %.

### 10.2 MMR aproximado (2v2, referencia)

| Rango | MMR |
|---|---|
| Bronce I | ~0–170 |
| Plata I | ~380 |
| Oro I | ~560 |
| Platino I | ~740 |
| Diamante I | ~920 |
| Campeón I | ~1100 |
| Gran Campeón I | ~1400 |
| Leyenda | ~1860+ |

Los valores varían por temporada y playlist.

### 10.3 Lecciones para nuestro diseño

- Tiers con **nombres de progresión clara** e ícono por tier.
- **Divisiones chicas** (I–IV) para que el jugador sienta progreso cada pocas partidas.
- **MMR con incertidumbre** (Glicko-2 es ideal y está documentado públicamente).
- **Clasificación por temporada** para renovar el interés.

---

## 11. Progresión y economía

- **Nivel de cuenta:** XP por partido, mayor en victorias y en el primer partido del día.
- **Pase de temporada:** gratis y premium, solo cosméticos.
- **Cosméticos:**
  - autos, pinturas, calcomanías, ruedas, propulsores (estela del turbo), estelas;
  - explosiones de gol, banners, títulos y "anthems" (música del gol);
  - atributos: rarezas, pinturas de colores, "certificados" que cuentan estadísticas.
- **Tienda rotativa** diaria y destacada.
- **Regla de oro:** nada comprable afecta la física. La hitbox se elige libremente entre las 6.

---

## 12. Entrenamiento, repeticiones y clips

| Función | Descripción |
|---|---|
| **Juego libre** | Cancha vacía con pelota. Opciones: resetear pelota, turbo infinito, reiniciar posición |
| **Packs de entrenamiento** | Secuencias de tiros predefinidos (posición/velocidad de la pelota y del auto). Categorías: delantero, arquero y aéreo; dificultad novato → profesional. Los packs de la comunidad se comparten con un **código** |
| **Tutoriales** | Básico (manejo, salto, turbo) y avanzado (aéreos, flips, recuperación) |
| **Mapas de práctica** | Mapas con circuitos de obstáculos, anillos aéreos, dribbles |
| **Repeticiones (replays)** | Se guardan partidas completas. El visor tiene línea de tiempo, cámara libre, cámara por jugador, cámara de pelota y velocidad 0.25×–2× |
| **Repetición de gol** | Automática tras cada gol (se puede saltear) |
| **Clips** | En el juego de referencia se hacen guardando replays y grabando con herramientas externas. **Oportunidad para nosotros:** un botón de "guardar clip" de los últimos 15 s, integrado |

---

## 13. Presentación visual (principios, no copia)

| Principio | Cómo se logra |
|---|---|
| **Legibilidad primero** | La pelota es lo más contrastado de la pantalla (clara sobre fondo medio) |
| **Sombra de pelota** | La luz principal viene casi desde arriba, así que la sombra marca dónde va a caer. Fundamental para el juego aéreo |
| **Equipos por color** | Dos colores opuestos y saturados. Cada mitad de la cancha y cada arco se tiñen con el color de su equipo |
| **Paredes semitransparentes** | Ves el estadio y los autos detrás de la pared, sin perder la referencia de dónde está la pared |
| **Pads de turbo brillantes** | Animados (giran o laten) y se apagan cuando no están disponibles |
| **Estela del turbo** | Indica quién tiene turbo y hacia dónde va. La estela supersónica indica peligro de demolición |
| **Estela de la pelota** | Aparece cuando la pelota va rápida y ayuda a seguir tiros potentes |
| **Estadio "vivo"** | Público, luces, pantallas gigantes con el marcador. Profundidad visual sin distraer |
| **Explosión de gol** | Momento de celebración claro: onda expansiva, sacudida de cámara y sonido |
| **HUD mínimo** | Marcador y reloj arriba al centro; turbo abajo a la derecha (medidor circular); nombres sobre los autos; feed de eventos a un costado |
| **Paleta del estadio** | Mucha iluminación ambiental fría; el césped es el área más grande y más neutra; los acentos (turbo, equipos, pelota) son saturados |

---

## 14. Audio

- **Motor:** el tono sube con la velocidad (se mezclan capas de RPM).
- **Turbo:** loop de "soplido" con un ataque fuerte al empezar.
- **Supersónico:** viento y una estela sonora.
- **Pelota:** golpe con volumen y tono según la fuerza; rebotes contra paredes.
- **Turbo recogido:** "ding" corto (distinto para grande y chico).
- **Gol:** bocina y explosión, rugido del público, música del gol ("anthem") del goleador.
- **Cuenta regresiva:** 3 beeps y uno distinto en "¡YA!".
- **Público:** reacciona a tiros cerca del arco, atajadas y goles.
- **Menús:** música licenciada (electrónica). **Nosotros vamos a componer o generar la nuestra.**
- **Chat rápido:** frases predefinidas ("¡Qué tiro!", "¡Lo tengo!", "¡Defiendo…!").

---

## 15. Online y netcode (cómo lo resuelve el género)

| Aspecto | Solución |
|---|---|
| **Autoridad** | Servidor dedicado autoritativo que simula a 120 Hz |
| **Cliente** | Predicción local del auto propio + **rollback y resimulación** cuando llega el estado del servidor (corrige pelota y autos) |
| **Otros jugadores** | Se extrapolan con su último input conocido (se repite el input); cuando el servidor corrige, se re-simula |
| **Input** | El cliente manda inputs con número de tick. El servidor tiene un pequeño buffer para absorber jitter |
| **Envíos** | Snapshots de estado a ~60 Hz por cliente |
| **Matchmaking** | Por región (ping), por MMR y playlist; *party* con MMR combinado |
| **Anti-trampa** | La física la decide el servidor, así que el cliente solo manda inputs |
| **Reconexión** | Se puede volver a la partida si se cae la conexión. Penalización por abandono en competitivo |

**Requisito técnico derivado:** la simulación tiene que ser **determinista y separada del render**, y el mismo código debe correr en el cliente (predicción) y en el servidor (autoridad). Esto también permite:
- **Replays exactos**: guardando los inputs o snapshots;
- **Bots** que usan la misma API de input que un jugador;
- **Packs de entrenamiento**: estados iniciales de la simulación.

---

## 16. Datos clave resumidos (cheat sheet para implementar)

```
TICK                = 120 Hz
GRAVEDAD            = -650 uu/s²
ARENA               = x ±4096, y ±5120, z 0..2044, chaflán |x|+|y| ≤ 8064
ARCO                = |x| ≤ 893, z ≤ 642.775, fondo y = ±6000
GOL                 = |y_pelota| > 5124.25 + 91.25
PELOTA              = r 91.25, m 30, e 0.6, µ 0.35, drag 0.03, vmax 6000, wmax 6
AUTO                = m 180, vmax 2300, sin turbo 1410, wmax 5.5
ACELERADOR          = 1600·curva(v) [1→0.1 en 1400 → 0 en 1410]
FRENO / COASTING    = 3500 / 525 uu/s²
TURBO               = +991.67 piso / +1058.33 aire, consume 33.3/s, mín. 0.1 s
SALTO               = 291.67 inmediato + 1458.33/s² por ≤0.2 s; 2.º salto ≤1.25 s
FLIP                = 500 uu/s, 0.65 s, cancelable; damp Z 0.65/tick entre 0.15–0.21 s
AIRE (rad/s²)       = pitch 12.46, yaw 9.11, roll 38.34; damp 2.88/1.92/4.79
ADHERENCIA          = −n · (0.5 + (1−|n.z|)) · 650
SUPERSÓNICO         = 2200 (mantener ≥2100 por 1 s) → demolición de frente
PADS                = 6 grandes (100, 10 s, r 208) + 28 chicos (12, 4 s, r 144)
RESPAWN             = 3 s; turbo inicial 33.3
```

---

## 17. Qué NO vamos a copiar (para no tener problemas legales)

Las **mecánicas, reglas y números de física** no se pueden proteger. Las **expresiones creativas** sí: marca, arte, personajes, música, textos. Copiar "99,999 %" del aspecto *aumenta* el riesgo legal (marca registrada y "trade dress"). Lo seguro y lo que hace a un juego memorable es: **mismas sensaciones, identidad propia.**

| ❌ No usamos | ✅ En su lugar |
|---|---|
| Nombre, logo o tipografías del juego de referencia | Nombre propio (provisorio: **TURBOGOL**) y logo original |
| Diseños de autos (los modelos conocidos y sus nombres) | 6 carrocerías originales, una por arquetipo de hitbox, con nombres propios |
| Estadios conocidos, su arquitectura y patrón hexagonal de paredes | Estadios originales (temática y patrones propios) |
| Diseño de la pelota de referencia | Pelota propia |
| Combinación exacta de colores de equipo de referencia | Paleta propia (ver documento de diseño) |
| Nombres e íconos de rangos propios del juego (sobre todo los tiers top) | Escalera de rangos con nombres e íconos propios |
| Música, efectos de sonido, locutor | Audio propio (sintetizado o compuesto) |
| Nombres comerciales (moneda, pase, objetos) | Nombres propios |
| Assets extraídos del juego (mallas de colisión, texturas) | Todo generado por nosotros. La arena se modela con una función matemática propia (SDF) |

> Este documento cita números medidos por la comunidad (datos funcionales, no expresivos) para calibrar la sensación de juego.
