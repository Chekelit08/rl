# 05 · Online multijugador

> Servidor autoritativo en Node con la **misma simulación** que el navegador (`src/sim`), predicción con
> rollback en el cliente y salas con código de 5 letras. Siempre manda el servidor.

---

## 1. Jugar

### En tu compu (dos pestañas o dos ventanas)

```bash
npm install
npm run server          # servidor online en ws://localhost:8787
npm run dev             # el juego en http://localhost:5173
```

Menú principal → **Online** → **Crear sala**. En la otra pestaña: **Online** → escribí el código → **Unirme**
(o usá **Copiar enlace**: abre el juego con `?room=CÓDIGO` y entra solo).

### En la red local (LAN)

La forma más simple es que **una sola máquina** sirva el juego y el servidor:

```bash
npm run build
npm run server
# [online] en la red local: http://192.168.0.23:8787  (juego + servidor)
```

Los demás abren `http://<IP-de-esa-máquina>:8787` en el navegador. Como la página sale del puerto 8787,
el juego se conecta solo a `ws://<misma IP>:8787/ws`.

Con el servidor de desarrollo también anda: `npm run server` + `npx vite --host`, y los demás abren
`http://<IP>:5173` (el juego busca el servidor en `ws://<IP>:8787`).

Si no conecta: permití el puerto 8787 (y 5173) en el firewall de la máquina que hace de servidor.

### Elegir otro servidor

En orden de prioridad:

1. Parámetro de la URL: `?server=wss://mi-servidor.fly.dev` (también acepta `host:puerto` o `https://…`).
2. **Ajustes → Servidor online** (se guarda en el navegador; vacío = automático).
3. Automático: `ws://<host de la página>:8787`; el mismo origen (`/ws`) si la página es https o la sirve el
   propio servidor (puerto 8787). En `localhost` queda `ws://localhost:8787`.

---

## 2. Desplegar

El contenedor arma el juego (`vite build`) y corre el servidor, que sirve `dist/` y el WebSocket (`/ws`)
en el mismo puerto. `GET /health` devuelve el estado (salas y jugadores).

### Docker

```bash
docker build -t turbogol .
docker run --rm -p 8787:8787 -e PORT=8787 turbogol      # → http://localhost:8787
```

### Fly.io

```bash
fly launch --copy-config --no-deploy    # elegí un nombre libre (cambia "app" en fly.toml)
fly deploy
fly scale count 1                        # las salas viven en memoria: una sola máquina
```

El juego queda en `https://<app>.fly.dev` y se conecta solo a `wss://<app>.fly.dev/ws`. Elegí la región
más cercana a los jugadores (`primary_region`, por defecto `gru`): el ping manda.

Si el juego se publica en otro lado (hosting estático), apuntalo al servidor con `?server=wss://<app>.fly.dev`.

### Variables del servidor

| Variable | Valor por defecto | Para qué |
|---|---|---|
| `PORT` | `8787` | Puerto HTTP + WebSocket |
| `SNAPSHOT_HZ` | `60` | `30` manda la mitad de snapshots (para conexiones muy justas) |

---

## 3. Cómo funciona

### Servidor (`server/`)

- `main.ts`: HTTP (estático + `/health`) y WebSocket (`ws`), bucle de 120 Hz con acumulador.
- `rooms.ts`: salas con código de 5 letras (sin I ni O), equipos balanceados, listo/empezar (sólo el
  anfitrión arranca), opciones (1v1–3v3, 3/5/10 min, completar con bots y su dificultad), resultado 20 s y
  vuelta al lobby. Reconexión con el mismo token (90 s de gracia), echada por inactividad (2 min sin tocar
  nada en juego, 15 min en el lobby) y desconexión si no llega nada en 20 s.
- `match.ts`: el partido. Usa `World` y los bots de `src/ai` (rellenan equipos y manejan el auto de quien
  se desconecta hasta que vuelve). Inputs por número de tick en un buffer; si falta uno se repite el último
  (hasta 0,25 s; después el auto suelta los controles).

### Protocolo (`src/net/protocol.ts`)

- Control en JSON: `hello/welcome`, `create`, `join`, `team`, `ready`, `config`, `start`, `leave`,
  `lobby`, `ping/pong`, eventos autoritativos (`goal`, `demo`, `save`, `shot`, `overtime`, `end`).
- Inputs en binario (6 bytes por tick): cada paquete lleva los últimos 6 ticks (redundancia) y el tick
  del último.
- Snapshots en binario a **60 Hz** (30 Hz si el socket se congestiona o con `SNAPSHOT_HZ=30`): estado
  completo de la simulación en float32, **delta** contra el último que recibió ese cliente (WebSocket es
  ordenado y confiable) con máscara de bits y el XOR de cada valor sin sus bytes altos en cero.
  En un 2v2 son ~170 B por snapshot (≈10 KB/s de bajada por jugador).

### Estado (`src/net/state.ts`)

- Recorre `World`, `Ball` y cada `Car` por reflexión (claves ordenadas): si la física suma campos nuevos,
  viajan solos. Tamaño fijo (los `Map` usan una cantidad fija de pares) y firma estructural para detectar
  versiones distintas de cliente y servidor.
- Servidor y cliente cuantizan el estado a float32 en los mismos ticks, así siguen caminos **bit a bit
  iguales** y una predicción correcta no genera corrección.
- El PRNG del mundo se reemplaza por uno serializable (si existe): saques y reapariciones también se
  predicen igual.

### Cliente (`src/net/match.ts`, `src/net/client.ts`, `src/net/online.ts`)

- **Predicción**: el cliente simula adelantado al servidor lo justo para que sus inputs lleguen a tiempo.
- **Buffer de jitter**: el servidor mide con cuánta anticipación llegó el input más atrasado del último
  segundo (`slack`) y el cliente ajusta su velocidad ±6 % (dilatación de tiempo) para mantenerlo en 2–3
  ticks. Si se va de rango (pestaña en segundo plano, tirón) salta.
- **Rollback**: al llegar un snapshot se compara con lo predicho para ese tick; si difiere, se restaura el
  estado del servidor y se re-simula hasta el presente con los inputs propios guardados. Las correcciones
  se aplican con la más nueva y con un tope de CPU (≤ 20 % del tiempo).
- **Extrapolación**: los demás autos repiten su último input conocido.
- **Suavizado**: lo que se dibuja converge a la corrección (posición y rotación) en ~0,1 s; los saltos
  grandes (saque, demolición) no se suavizan.
- **HUD**: chip de ping y pérdida (inputs propios que no llegaron a tiempo al servidor), con el detalle de
  jitter, margen, correcciones y KB/s al pasar el mouse. La cuenta regresiva sale del estado predicho.

---

## 4. Pruebas

```bash
npm run test:net          # 2 clientes Node contra el servidor real, 50–150 ms + jitter
npx vite build && npm run test:net:e2e   # Playwright: dos pestañas en la misma sala
```

`test:net` verifica: sala y lobby, equipos, relleno con bots, que los inputs muevan el auto en el servidor,
ping, gol con marcador igual en servidor y clientes, kickoff, **convergencia bit a bit** (y el estado
completo igual al del servidor en el mismo tick), ancho de banda, buffer de jitter, bot temporal y
reconexión, fin del partido con el mismo resultado, vuelta al lobby y echada por inactividad.

`test:net:e2e` levanta el servidor sirviendo `dist/`, abre dos pestañas: una crea la sala y la otra se une
con el código; listo, empezar, manejar, gol (marcador igual en servidor y en los dos HUD), indicador de red,
resultado (Victoria/Derrota) y vuelta al lobby, sin errores de consola. Con `SHOTS=<carpeta>` guarda
capturas. Con render por software tarda unos minutos.
