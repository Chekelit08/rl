# 09 — Audio y háptica

Todo el sonido de TURBOGOL se sintetiza con WebAudio en tiempo real: no hay samples ni assets con licencia.

## Módulos (`src/audio/`)
- `core.ts`: grafo base (cinco buses → master → limitador), reverb de estadio sintética, megafonía, ruido blanco/rosa/marrón, pool de voces con prioridad y límite (28), panner 3D HRTF y listener en la cámara. Toda voz entra con rampas de ataque/cola para evitar clicks.
- `engine.ts`: motor del auto local por capas (RPM con marchas y cambios, carga/acelerador, aire), turbo (ataque, cuerpo, cola), viento supersónico y derrape. `RemoteEngines` da motores 3D simplificados a los demás autos (hasta 3).
- `sfx.ts`: golpes de pelota por intensidad; rebotes según superficie (piso, pared, vidrio, poste, travesaño); red del gol; aterrizajes, salto y flip, flip reset, bumps, demoliciones, pads, bocina, silbato, pitidos de cuenta regresiva y clic de UI.
- `crowd.ts`: público reactivo (murmullo según tensión, "uuuh" en tiros cercanos, explosión en goles, cánticos y aplausos, aplauso final).
- `music.ts`: secuenciador propio para la música de menú y la pantalla final.
- `haptics.ts`: vibración del mando (dual-rumble o pulso), desactivable.
- `audio.ts`: fachada `AudioEngine` (`start`, `onEvent`, `update`, `setVolume`, `setMix`, `debugInfo`).

## Integración en `main.ts`
`audio.start()` en el primer clic; `audio.onEvent(ev, snap, 0)` por cada evento de la simulación; `audio.update(dt, snap, camera, state, localId)` una vez por cuadro. Al marcar un gol el bus del motor baja unos segundos (ducking) para que se luzca el público.

## Mezcla y Ajustes
Buses: motor, efectos, público, música e interfaz, más volumen general y la opción "Vibración". Se guardan en `settings.mix`.

## Verificación
`npm run test:audio` renderiza partidos completos con `OfflineAudioContext` en Chromium headless y comprueba: sin NaN, pico < 1.0 (sin clipping), límite de voces bajo estrés, motor más brillante con más RPM, el gol como momento más fuerte, mezcla razonable y música continua. `AUDIO_WAV_DIR=/ruta` guarda los WAV renderizados.
