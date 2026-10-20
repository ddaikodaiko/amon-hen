---
description: "Tareas de Vigía v1, por historia de usuario"
---

# Tasks: Vigía v1, un agente que investiga barcos oscuros en el golfo de Finlandia

**Input**: documentos de diseño en `specs/001-vigia-v1/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: se piden (constitución, "Flujo de trabajo", y R14). Usan `bun test`, sin red, keys ni GPU. El agente se prueba con un modelo de pega con guion (`FakeClient`). Las pruebas se escriben antes que el código que las hace pasar.

**Organization**: por historia de usuario. La grabadora va primero (T001) porque el eval necesita días de datos de la Pi.

## Formato: `[ID] [P?] [Story] [clase|bloque] Descripción`

- **[P]**: se puede hacer en paralelo (otro archivo, sin depender de tareas sin terminar).
- **[Story]**: la historia de usuario (US1-US5).
- **[clase]**: menos de 50 min, sin GPU y sin la Pi. Vale para los ratos de clase.
- **[bloque]**: unas 3 h, o necesita la Pi, el PC con Ollama o datos reales en vivo. Va en los bloques de 17:30-20:30.
- Rutas desde la raíz del repo (`osint-maritimo/`).

## Lo que tiene que tener Marcos antes

| Qué | Para | Cuándo |
|---|---|---|
| La Pi 5 reformateada: Raspberry Pi OS Lite de 64 bits, SSH, Tailscale y Bun | T001 (despliegue), T064 | En el primer bloque en casa |
| PC: Tailscale, Ollama con `OLLAMA_HOST=0.0.0.0`, `ollama pull qwen3:8b` | T031, T033 | Antes de T031 |
| Token gratuito de Global Fishing Watch | T032 | Antes de T032 |

---

## Phase 1: Setup (la grabadora primero)

**Purpose**: que la Pi grabe desde la primera semana y que el repo tenga su base.

- [ ] T001 [bloque] Grabadora AIS mínima en la Pi. Crear:
  - `package.json` (Bun, `"type": "module"`, scripts `ingest`, `test` y `check`, y de desarrollo `typescript` y `@types/bun`) y `tsconfig.json` con `strict`;
  - `src/ingest/mqtt.ts`: el subconjunto de MQTT 3.1.1 que hace falta (CONNECT, SUBSCRIBE, PUBLISH con QoS 0 y PINGREQ) y un lector de paquetes que aguanta paquetes partidos o pegados entre mensajes del WebSocket;
  - `src/ingest/digitraffic.ts`: WebSocket a `wss://meri.digitraffic.fi:443/mqtt` (subprotocolo `mqtt`). Tras el CONNACK se suscribe a `vessels-v2/+/location` y `vessels-v2/+/metadata`, y manda PINGREQ cada 30 s. Se reconecta con espera exponencial (de 1 s a 60 s), y fuerza la reconexión si pasan 2 min sin mensajes;
  - `src/ingest/raw-archive.ts`: una línea por mensaje, `{t: recibido_ms, m: {topic, data}}`, y líneas de evento, `{t, ev: "open"|"close"|"error", detail?}`, en `data/raw/YYYY-MM-DD/HH.ndjson`. Al cambiar de hora, comprime el archivo a `.ndjson.gz` con zlib en streaming (sin bloquear la ingesta) y borra el original. Al arrancar, comprime las horas anteriores que quedaran sin comprimir;
  - `src/cli/ingest.ts`: no necesita key. Cada minuto imprime los mensajes y los barcos por minuto;
  - `deploy/vigia-ingest.service`: unidad de usuario de systemd con `Restart=always` (con `loginctl enable-linger`, para que arranque sin sesión abierta).
  **Estado (2026-10-19):** mientras la Pi no esté, la grabadora corre en el portátil como servicio de usuario temporal (`systemctl --user status vigia-ingest-laptop`; se pierde al reiniciar el portátil). Desde las 17:24 UTC escribe también en `data/vigia.sqlite`. Lo de antes se importó con `--from-archive`.

  La primera versión, contra aisstream (commit `806a157`), sirvió para medir que el Estrecho no daba datos suficientes (R7).
  **Hecho:** graba en el portátil (prueba) y, con la Pi lista, como servicio en la Pi, que sigue grabando tras un `systemctl --user restart`. Mientras la Pi no esté, se puede dejar grabando el portátil para medir el volumen.
- [ ] T002 [bloque] Con 24 h grabadas, medir:
  - mensajes por segundo (media y pico);
  - MB por hora, ya comprimidos;
  - barcos distintos en el golfo, y cuántos en el extremo ruso (al este de 28° E).

  Anotarlo en `specs/001-vigia-v1/research.md` (R5 y R7) y quitar sus **[verificar en T001]**. Copiar las 24 h del archivo al portátil, en `data/raw/` (fuera de git), para desarrollar en clase sin la Pi. Con 2 h no saldrían los 10 candidatos de la prueba de modelos (T033). Las pruebas siguen con fixtures sintéticas.
- [x] T003 [clase] Completar `package.json`:
  - `bun add @anthropic-ai/sdk zod` (zod v4, para `z.toJSONSchema`);
  - los scripts de `contracts/cli.md` (`demo`, `ingest`, `server`, `eval`, `brief`, `record`, `demo:build`, `test`), cada uno apuntando a su `src/cli/*.ts`;

  Crear `.env.example` con todas las variables de `contracts/cli.md`, sin valores.
- [x] T004 [clase] Crear el panel en `panel/`:
  - SvelteKit con `@sveltejs/adapter-static` (`fallback: "index.html"`), `maplibre-gl` y TypeScript estricto;
  - un workspace de Bun (`"workspaces": ["panel"]` en el `package.json` raíz), para que baste un solo `bun install`;
  - layout en inglés con la navegación (Map, Cases, Label, Eval, Briefs, Health) y el aviso "Educational project, no warranty" (FR-027).

  **Hecho:** `bun run --cwd panel build` genera `panel/build`.
  **Hecho (2026-10-19), con SvelteKit 3.1:** la configuración va en `vite.config.ts` (ya no hay `svelte.config.js`), el `tsconfig` extiende `$app/tsconfig` y el panel usa TypeScript 6, porque SvelteKit 3 aún no admite el 7 (la raíz sí lo usa). Las vistas son marcadores hasta sus tareas.
- [ ] T005 [P] [clase] Crear dos archivos de datos:
  - `data/region.json`: la caja de la región de Assumptions, más `border_margin_nm: 2`;
  - `data/ports.geojson`: polígonos de las dársenas y los amarres de Helsinki (Eteläsatama, Länsisatama, Vuosaari), Porvoo-Sköldvik, Loviisa, Kotka-Hamina (Mussalo, Hietanen), Tallinn (Vanasadam, Muuga, Paljassaare), Paldiski, Sillamäe, Ust-Luga, Primorsk, Vysotsk y San Petersburgo, dibujados a mano (geojson.io), cada uno con `properties.name` y `kind: "berth"`. Sin fondeaderos (clarificación 3).
  **Estado (2026-10-19):** `data/region.json` está hecho. `data/ports.geojson` es un **borrador**, generado desde OSM con `scripts/ports-from-osm.ts`: 177 polígonos (zonas portuarias e industriales, más los muelles de Primorsk y Vysotsk), ampliados 150 m hacia el agua. Medido contra los barcos parados de la primera hora:
  - Solo 77 de los 131 barcos que se declaran amarrados caen dentro. Faltan los muelles urbanos de Helsinki (rompehielos y remolcadores en Pohjoissatama y Katajanokka), Tammisaari, Inkoo y otros puertos pequeños.
  - 3 de los 87 barcos fondeados caen dentro por error (Lugaport en Ust-Luga, Vysotsk y Vyborg).
  - El script ya amplía la consulta (muelles y `quay` de todo el golfo, dársenas, marinas y los puertos y atraques de OpenSeaMap), pero no se ha podido ejecutar: Overpass estaba saturado. **Siguiente paso:** ejecutarlo, repetir la medición y repasar en un mapa los casos que fallen. Si los muelles urbanos siguen fuera, decidir si se añade la regla "parado y a menos de 150 m de tierra" (necesita `land.geojson`).
  - Los datos derivados de OSM van con licencia ODbL y la atribución dentro del archivo.

---

## Phase 2: Foundational (lo que bloquea todas las historias)

**Purpose**: configuración, base de datos, geometría, el procesado de mensajes y el esqueleto del servidor.

**⚠️ CRITICAL**: ninguna historia empieza antes de terminar esta fase.

- [x] T006 [clase] `src/config.ts`: lee el entorno (Bun carga `.env`), lo valida con zod y exporta:
  - la región y los umbrales (30 min, 60 min, 6 h y caída de 2 min o más);
  - el puerto 4250, el modo y la ruta de la base;
  - los perfiles `local | haiku | sonnet`, con `baseURL`, `model` y precios por MTok (R1).

  Por defecto, `VIGIA_BUDGET_USD=0` y `VIGIA_ESCALATE_PROFILE=none`.
- [x] T007 [clase] `src/db/schema.sql`, con todas las tablas e índices de `data-model.md`, y `src/db/index.ts`. `openDb(path)` usa `bun:sqlite` con `journal_mode=WAL` y `busy_timeout=5000` (escriben dos procesos), y migra con `PRAGMA user_version`. Prueba en `tests/unit/db.test.ts` sobre `:memory:`: crear el esquema dos veces no da error.
  **Nota:** se añadió la tabla `meta` (clave y valor) para el estado que debe sobrevivir a un reinicio, como hasta dónde están cerrados los minutos de salud.
- [x] T008 [P] [clase] `src/geo/`:
  - `grid.ts`: rejilla de 0,025° sobre la región, con `cellId(lat, lon)`, `cellBounds(id)` y las celdas vecinas;
  - `haversine.ts`: distancia en millas náuticas y rumbo inicial;
  - `polygons.ts`: punto dentro de polígono para `ports.geojson`, y `headingOut(lat, lon, cog)`, que es cierto si el barco está a menos de `border_margin_nm` del borde con rumbo hacia fuera;
  - `mid.ts`: tabla MID → país.

  Pruebas en `tests/unit/geo.test.ts` con puntos conocidos (un punto del puerto de Vuosaari está dentro; uno en mitad del golfo, no).
- [x] T009 [P] [clase] `src/ingest/parse.ts` convierte un mensaje de Digitraffic (`{topic, data}`, formato en R7) en uno de dos tipos:
  - `{kind: "position", mmsi, ts, lat, lon, sog, cog, heading, nav_status, ais_class}`;
  - `{kind: "static", mmsi, name, callsign, imo, ship_type, length_m, width_m, destination, ais_class}`.
  **Hecho (2026-10-19), con un cambio:** la posición no lleva `ais_class`, porque un mensaje de posición no la dice. La clase vive en `vessels`: es B hasta que llega la metadata, y la metadata decide. Comprobado sobre 10 min: los 59 barcos en marcha con metadata de clase A emiten cada 15 s o menos. Pero Digitraffic solo publica metadata de clase A, y la manda cuando el barco la emite, así que nada más arrancar muchos de clase A parecían B. Por eso la ingesta carga al arrancar la metadata completa por REST (`/api/ais/v1/vessels`, unos 940 barcos), y la archiva marcada con `src: "rest"`. Revisar con las 24 h de T002.

  `ts` es la hora de recepción. El MMSI sale del topic. Es clase A si la metadata del barco trae `imo`, `eta` o `draught`; si no se sabe, clase B (R7). Antes de fijar la regla, comprobarla sobre la muestra de T002: los de clase B emiten cada 30 s en marcha, y los de clase A, cada 10 s o menos. Descarta las lat/lon fuera de rango, la posición (0,0) y los MMSI que no tienen 9 dígitos. Pruebas en `tests/unit/parse.test.ts` con mensajes sintéticos en `tests/fixtures/ais/messages.json`: uno de cada tipo y varios no válidos.
- [x] T010 [clase] Dos funciones de procesado, en `src/ingest/pipeline.ts`:
  - `applyMessage(db, msg)`: actualiza o inserta en `vessels`, guarda en `positions` como mucho una posición cada 30 s por barco y suma en `ingest_minutes`;
  - `applyEvent(db, ev)`: registra los eventos `open` y `close`.
  **Nota:** `ingestRaw(db, topic, data, ts)` cuenta cualquier mensaje para la salud (también los no válidos) y luego lo procesa. Las caídas guardan la causa: `no_messages` o `disconnected`. La ingesta en vivo ya escribe en SQLite y cierra los minutos cada 60 s.

  `src/ingest/health.ts`: `closeMinutes(db, now)` marca como `outage` cualquier periodo de 2 minutos seguidos o más sin mensajes, o con la conexión caída (FR-002). Pruebas en `tests/unit/pipeline.test.ts`:
  - la reducción a 30 s;
  - una caída de 3 min queda registrada;
  - 1 minuto sin mensajes no es caída.
- [x] T011 [clase] Importar el archivo crudo con `bun run ingest --from-archive data/raw [--from ISO --to ISO]`. Lee los `.ndjson` y `.ndjson.gz` en orden y los pasa por `pipeline.ts`. Así se trabaja en clase sobre la muestra de T002, sin la Pi. La opción ya está en `contracts/cli.md`.
  **Hecho:** la muestra de 24 h carga en `data/vigia.sqlite`, y el recuento de `positions` cuadra con la reducción a 30 s.
  **Comprobado** con la primera hora grabada en el portátil (27.000 mensajes en 0,2 s). Falta repetirlo con las 24 h de T002.
- [x] T012 [clase] `src/server/app.ts`: `Bun.serve` en el puerto 4250 con:
  - un router mínimo y errores `{error: {code, message}}` (400, 403 y 404);
  - la guarda de modo: en `replay` y en `public`, responde 403 a todo lo marcado ✎ en `contracts/http-api.md`. En `replay` sí permite `POST /api/replay/speed`;
  - los estáticos de `panel/build`, con `index.html` como fallback;
  - `GET /api/meta`.
  **Nota:** en modo `live` escucha solo en `127.0.0.1`; en `replay` y `public`, en todas las interfaces.

  `src/cli/server.ts` arranca el servidor. Prueba en `tests/integration/server-modes.test.ts`: una ruta ✎ de prueba da 403 en `public` y en `replay`, y 200 en `live`.

**Checkpoint**: `bun run check` en verde y la muestra cargada en la base. Ya se pueden empezar las historias.

---

## Phase 3: User Story 1 - Investigar un gap y leer su expediente (Priority: P1) 🎯 MVP

**Goal**: un candidato detectado sobre datos grabados se investiga con el agente y deja un expediente con veredicto, confianza, pruebas enlazadas y la traza completa, que se lee en el panel.

**Independent Test**: sobre la muestra importada, `bun run investigate --all-pending --profile local` y `bun run server`. Abrir un caso: tiene veredicto, confianza, al menos una prueba que salta a su paso, y la traza con su coste.

### Tests for User Story 1 ⚠️

> Se escriben primero y deben fallar antes de implementar.

- [x] T013 [P] [US1] [clase] Fixtures sintéticas en `tests/fixtures/ais/gaps.ts`: un generador de rastros (un barco en línea recta a 12 nudos) con estos gaps conocidos:

  | Caso | ¿Candidato? |
  |---|---|
  | Clase A, 45 min en mar abierto | Sí |
  | Clase A, 20 min | No |
  | Clase B, 45 min | No |
  | Clase B, 70 min | Sí |
  | Gap que se solapa con una caída propia | No (`own_outage`) |
  | Salida por el borde oeste | No (`left_region`) |
  | Gap que empieza en el puerto de Vuosaari | No (`berth`) |
  | Gap en un fondeadero frente a Kotka | Sí |
  | Gap abierto de 6 h | Sí |
- [x] T014 [P] [US1] [clase] `tests/unit/detect.test.ts` sobre T013: los candidatos y los motivos de descarte (`own_outage`, `left_region`, `berth`) son los esperados, y la investigación se dispara al reaparecer el barco o a las 6 h.
- [x] T015 [P] [US1] [clase] `tests/unit/coverage.test.ts`: con dos barcos en una celda y un hueco conocido, `received_min / expected_min` da el valor calculado a mano. `sample_ok` es falso con menos de 30 minutos-barco. Un barco fondeado (a menos de 3 nudos) no suma minutos esperados, y la contribución del barco investigado se puede restar (R6).
- [ ] T016 [P] [US1] [clase] `tests/unit/verdict.test.ts`: el esquema de `submit_verdict` rechaza un veredicto:
  - sin pruebas, o con más de 5;
  - con un `step` que no está en la traza;
  - con un valor fuera de su enumeración;
  - con un `claim` de más de 160 caracteres.

  Y acepta uno válido.
- [ ] T017 [P] [US1] [clase] Guiones del modelo de pega en `tests/fixtures/scripts/` (JSON: la lista de respuestas, con `content` y `usage`) y `tests/integration/agent-loop.test.ts` con `FakeClient`. Casos:
  - (a) camino feliz: expediente con al menos una prueba enlazada y la traza completa con tokens;
  - (b) una herramienta falla: el agente sigue y la traza guarda el error (FR-012);
  - (c) el modelo termina sin `submit_verdict`: recibe un aviso, y solo uno;
  - (d) el veredicto no valida 3 veces seguidas: el caso queda en `error`;
  - (e) el modelo pide una 11.ª herramienta: se corta;
  - (f) `inconclusive` con escalado y presupuesto: hay un segundo intento con el otro perfil, los dos quedan en la traza y `escalated = 1`;
  - (g) el tope ya está alcanzado: ninguna llamada al modelo y el caso queda en `pending_budget`;
  - (h) el cliente da un error de conexión a mitad: no queda expediente y el caso pasa a `pending_no_model`;
  - (i) la siguiente llamada superaría el tope en el peor caso (`max_tokens` de salida): no se hace y el caso queda en `pending_budget`.

### Implementation for User Story 1

- [x] T018 [P] [US1] [clase] `src/coverage/compute.ts` (FR-004, R6):
  - interpola a 1 minuto el rastro de cada barco, incluidos los minutos de los gaps;
  - solo cuenta los minutos a más de 3 nudos (R6);
  - cuenta los minutos-barco esperados y los recibidos por celda y hora UTC, en una ventana de 7 días;
  - escribe el resultado en `coverage`.

  Hace pasar T015.
  **Hecho (2026-10-20).** `coverageAt(db, lat, lon, hour, {excludeMmsi})` da la celda con `ratio` y `sample_ok`, y resta al vuelo los minutos del barco investigado. Dos decisiones que R6 no decía:
  - Los minutos dentro de una caída propia no cuentan como esperados: miden nuestra ingesta, no las antenas.
  - Un silencio de más de 6 h no se interpola: el barco puede haber salido de la región y vuelto.

  **Sobre las 2 h grabadas** (77 ms): la cobertura es del 98 % al oeste de 24° E, del 96 % entre 26° y 28° E, del 65 % entre 28° y 29° E y del 43 % al este de 29° E. Con 2 h, solo 13 celdas llegan a 30 minutos-barco. En un fondeadero la celda tiene 0 minutos esperados (los fondeados no cuentan), así que ahí pesa `neighbors_avg_ratio` (T024).
- [x] T019 [US1] [clase] `src/detect/gaps.ts`, puro: encuentra los gaps de cada barco según el umbral de su clase. No usa `nav_status`: cuenta igual navegando que fondeado (clarificación tras el análisis).
  `src/detect/exclusions.ts`: solape con `outages`, `headingOut` y gaps que empiezan en un `berth`.
- [x] T020 [US1] [clase] `src/detect/run.ts`: `runDetector(db, now)` crea los `candidates` en `detected` y los pasa a `discarded` con su motivo, o a `pending` cuando se dispara la investigación (al reaparecer o a las 6 h). Hace pasar T014.
  **Hecho (2026-10-20), con dos decisiones:**
  - El detector solo mira hasta donde está cerrada la salud de la ingesta (`health_closed_until`). Si la ingesta se para, todos los barcos parecen callados; cuando vuelve, esos minutos quedan como caída y sus gaps se descartan como `own_outage`.
  - Recorre `[detect_scanned_until, horizonte)`, abierto por la derecha: el minuto que empieza en el horizonte sigue abierto. La prueba de "cada 10 min igual que una vez" encontró el fallo con el intervalo cerrado: un barco que reaparecía justo en el borde no cerraba su gap.

  **Sobre las 2 h grabadas el 2026-10-19** (en 146 ms): 702 gaps, 678 descartados (463 `own_outage` por el portátil apagado, 209 `berth` y 6 `left_region`) y 24 `pending`. De estos, 19 están en el extremo ruso (al este de 28° E), donde llegan mal las antenas finlandesas; 4 son gaps de barcos amarrados en Tallinn, cuyo puerto falta en `ports.geojson` (T005), y 1 está en mitad del golfo.
- [ ] T021 [US1] [clase] Primero, leer `typescript/claude-api/README.md` y `tool-use.md` de la skill `claude-api`. Después, `src/agent/model.ts`:
  - la interfaz `ModelClient { create(params): Promise<Message> }`;
  - `AnthropicClient(profile)`, sobre `client.messages.create` (no la beta), con el `baseURL` del perfil. Para `local`, `apiKey: "ollama"`;
  - `FakeClient(script)`, que devuelve las respuestas del guion en orden y falla si se le pide una de más.
- [ ] T022 [P] [US1] [clase] `src/agent/budget.ts`:
  - `costUsd(usage, profile)`, con los precios del perfil (0 en `local`);
  - `canSpend(db, profile, worstCaseUsd)`, contra lo gastado este mes en `budget` y `VIGIA_BUDGET_USD`. Se comprueba antes de cada llamada al modelo, con el peor caso: los tokens de entrada estimados y `max_tokens` de salida;
  - `record(db, cost)`.

  Pruebas en `tests/unit/budget.test.ts`: un tope de 0 bloquea todo lo de pago, y el perfil local nunca se bloquea.
- [ ] T023 [P] [US1] [clase] Herramientas sobre SQLite en `src/agent/tools/`: `get_track.ts`, `get_vessel.ts` (tipo legible a partir del código AIS y bandera a partir del MID) y `get_ingest_health.ts`. Cada una tiene su esquema zod de entrada, su `description` en inglés y una salida con un `summary` en tono de analista (`contracts/agent-tools.md`). `get_track` marca los `identity_conflicts` (posiciones seguidas a más de 50 nudos implícitos). Pruebas en `tests/unit/tools.test.ts`, entre ellas un salto de 40 nm en 5 min.
- [ ] T024 [P] [US1] [clase] Dos herramientas más:
  - `src/agent/tools/get_coverage.ts`: la celda, su `ratio`, `sample_ok` y la media de las celdas vecinas, restando la contribución del barco investigado (R6);
  - `src/agent/tools/get_nearby.ts`: los barcos a menos de `radius_nm`, en `±window_min` de `at`, si siguieron emitiendo durante el gap, cuántos saltan de posición (`jumping_count`, interferencia GNSS) y los recuentos.
- [ ] T025 [US1] [clase] `src/agent/tools/submit_verdict.ts`: el esquema zod de `contracts/agent-tools.md`. Comprueba cada `step` contra la traza en curso y hace pasar T016.
  `src/agent/tools/index.ts`: el registro de nombre → esquema zod.
  - El `input_schema` sale de `z.toJSONSchema`.
  - `strict: true` solo en los perfiles de Anthropic.
  - Si la entrada no valida, la ejecución devuelve `is_error` con el motivo.
- [ ] T026 [P] [US1] [clase] `src/agent/prompts/system.md`, en inglés, según el resumen de `contracts/agent-tools.md`:
  - la hipótesis de partida es un hueco de cobertura;
  - para `likely_dark` hacen falta buena cobertura **y** vecinos que siguieron emitiendo;
  - hay que citar los pasos de la traza;
  - si hay `identity_conflicts`, no se concluye `coverage_gap` sin otra prueba, y si muchos vecinos también saltan, es interferencia GNSS;
  - nunca se buscan personas;
  - se termina siempre con `submit_verdict`.
- [ ] T027 [US1] [bloque] `src/agent/loop.ts`, el bucle manual de R3:
  - llama al modelo, ejecuta las herramientas, añade el `response.content` íntegro y repite;
  - `tool_choice: auto`;
  - límites: 10 herramientas, 1 aviso y 2 reintentos del veredicto;
  - un `trace_steps` por cada llamada al modelo y cada herramienta, con tokens, coste, duración y `output_summary`.

  Hace pasar T017 (a)-(e).
- [ ] T028 [US1] [clase] `src/agent/investigate.ts`: candidato → bucle → escalado (FR-010).
  - En una sola transacción escribe `dossiers` (la versión siguiente), `evidence` y `trace_steps`.
  - `agent_version` es un hash de `system.md`, los esquemas y el perfil.
  - Si el cliente cae a mitad, no escribe nada.

  Hace pasar T017 (f)-(h).
- [ ] T029 [US1] [clase] `src/agent/queue.ts`: la máquina de estados de `data-model.md` (`pending → investigating → investigated | error | pending_no_model | pending_budget`).
  - Se atiende por orden de llegada (`trigger_at`).
  - Cada entrada en `investigating` escribe `trigger_at`.
  - Los casos en `error` se reintentan a mano.

  Pruebas en `tests/unit/queue.test.ts` con las transiciones válidas y las no válidas.
- [ ] T030 [US1] [clase] `src/cli/investigate.ts`: `bun run investigate [--ids 1,2] [--all-pending] --profile local|haiku|sonnet`, para lanzar investigaciones sobre los datos importados. Ya está en `contracts/cli.md`.
- [ ] T031 [US1] [bloque] Primera conexión real: con Ollama y `qwen3:8b` en el PC, por Tailscale, `bun run investigate` sobre 3 candidatos de la muestra de T002. Comprobar que, con el SDK, el `/v1/messages` de Ollama acepta `tools` y devuelve `tool_use` y `usage`. Anotar en `research.md` (R1) lo que no funcione. Necesita el PC.
- [ ] T032 [US1] [bloque] `src/agent/tools/get_gfw_events.ts`:
  - `GET /v3/events` con `GFW_TOKEN`, sobre los datasets de gaps, encounters y loitering. Hay que comprobar sus nombres y el retraso de los datos (R9);
  - timeout de 10 s y `{unavailable: reason}` si falla.

  Pruebas en `tests/unit/gfw.test.ts` con un `fetch` inyectado (respuesta normal, 429 y timeout). Anotar en `research.md` el retraso medido. Necesita el token de GFW.
- [ ] T033 [US1] [bloque] Prueba de modelos (R2): los 10 primeros candidatos de la muestra con `qwen3:8b`, `llama3.1:8b` y `granite3.3:8b`. En `research.md`, una tabla con los expedientes válidos, las llamadas a herramientas y el tiempo por caso. El ganador queda como `VIGIA_LOCAL_MODEL` por defecto en `src/config.ts` y en `contracts/cli.md`. Necesita el PC.
- [ ] T034 [US1] [clase] Rutas de la API en `src/server/routes/candidates.ts`:
  - `GET /api/candidates`: filtros `state`, `verdict`, `from` y `to`, 50 por página;
  - `GET /api/candidates/:id`: el candidato, sus versiones, las pruebas y la traza;
  - `POST /api/candidates/:id/reinvestigate` (✎): encola respetando el tope.
- [ ] T035 [P] [US1] [clase] Panel:
  - `panel/src/lib/api.ts`: un cliente tipado de `contracts/http-api.md`;
  - `panel/src/routes/cases/+page.svelte`: la lista de casos con filtros por veredicto, estado y fecha. Los estados `pending_no_model` y `pending_budget` se ven (FR-015).

  Se desarrolla contra un JSON de ejemplo en `panel/src/lib/fixtures/`.
- [ ] T036 [US1] [clase] `panel/src/routes/cases/[id]/+page.svelte` (FR-013, FR-016):
  - veredicto, confianza, explicación, coste y modelo;
  - las pruebas son enlaces `#step-N` que llevan a su paso y lo resaltan (escenario 5);
  - la traza paso a paso: herramienta, entrada plegable, `output_summary`, tokens, coste y duración;
  - un selector de versiones.

**Checkpoint**: la US1 funciona sola. Esto es el MVP: ya demuestra el trabajo con agentes.

---

## Phase 4: User Story 2 - La demo en 5 minutos, sin keys (Priority: P2)

**Goal**: `bun run demo` abre el panel en replay, con el mapa, los casos y los expedientes ya calculados, sin keys ni red.

**Independent Test**: en un clon limpio, sin `.env` y sin red, `bun install && bun run demo`, y abrir un expediente en menos de 5 minutos (SC-001).

### Tests for User Story 2 ⚠️

- [ ] T037 [P] [US2] [clase] `tests/unit/replay-clock.test.ts`: a 60×, un minuto de datos pasa en 1 s, y cambiar de velocidad no hace saltar el reloj.
- [ ] T038 [P] [US2] [clase] `tests/integration/record.test.ts`: `record --kind demo` sobre las fixtures deja una posición por barco y minuto, y conserva los candidatos, los expedientes y las trazas de la ventana.

### Implementation for User Story 2

- [ ] T039 [P] [US2] [clase] `data/land.geojson`: los polígonos de tierra de OSM (los simplificados de osmdata.openstreetmap.de), recortados a la región con margen y simplificados con `bunx mapshaper`, que es una herramienta de desarrollo y no una dependencia. Como mucho 3 MB. La atribución ODbL va en `data/README.md`.
- [ ] T040 [US2] [clase] `src/replay/clock.ts`: el reloj del replay, con velocidades 1, 10, 60 y 300, sobre el rango de tiempo de la base. Da la hora actual del replay y las posiciones de cada tic. Hace pasar T037.
- [ ] T041 [US2] [clase] `src/server/stream.ts`:
  - `GET /api/stream` (SSE), con los eventos `positions` a 1 Hz (la última posición de cada barco), `candidate`, `dossier` y `health`. En `replay` sigue el reloj de T040, y en `live`, la hora real;
  - `POST /api/replay/speed`, solo en `replay`.
- [ ] T042 [P] [US2] [clase] `src/server/routes/map.ts`: `GET /api/coverage?hour=` y `GET /api/vessels/:mmsi`.
- [ ] T043 [US2] [clase] `panel/src/routes/+page.svelte` y `panel/src/lib/map/` (FR-014):
  - MapLibre con un estilo local: fondo de mar y `land.geojson`, sin teselas remotas;
  - la capa de barcos, desde el SSE, y el rastro del barco seleccionado;
  - las marcas de los gaps y la capa de cobertura, que se activa y desactiva;
  - el control de velocidad en replay.
- [ ] T044 [US2] [clase] En el panel, el botón de reinvestigar está desactivado cuando `/api/meta` dice `replay` o `public`, o cuando no hay modelo. Al lado, el texto de qué hace falta (escenario 3, FR-026).
- [ ] T045 [US2] [clase] Atribución de Digitraffic ("Source: Fintraffic / digitraffic.fi, CC BY 4.0") y de OSM (ODbL) en el pie del panel y en `data/README.md`. Con CC BY 4.0, la demo y el set del eval se pueden publicar.
- [ ] T046 [US2] [clase] `src/cli/record.ts`: `bun run record --from --to --kind demo|eval --out`. Copia la ventana a una base aparte con sus candidatos, expedientes y trazas. Con `--kind demo`, reduce a una posición por barco y minuto. Registra la fila en `recordings`. Hace pasar T038.
- [ ] T047 [US2] [bloque] `src/cli/demo-build.ts` (`bun run demo:build --from --to`), en tres pasos:
  1. investiga en la base principal los candidatos de la ventana que aún no tienen expediente;
  2. hace `record --kind demo` de 24 h;
  3. copia los briefs y el informe de eval que ya existan.

  Sale en `demo/vigia-demo.sqlite` y falla si pasa de 50 MB. Investiga antes de reducir para que el agente vea los datos completos (así está en `contracts/cli.md`). Necesita el PC.
- [ ] T048 [US2] [clase] `src/cli/demo.ts` (`bun run demo`): compila el panel si no existe `panel/build`, abre `demo/vigia-demo.sqlite` en solo lectura y arranca el servidor en modo `replay` en el puerto 4250. No necesita `.env` ni red.
- [ ] T049 [US2] [clase] Validar SC-001: un clon limpio en una carpeta nueva, sin `.env` y sin red (`unshare -rn`), `bun install` ya hecho con red, y `bun run demo`. Cronometrar hasta abrir un expediente.

**Checkpoint**: la demo funciona con lo que haya calculado. El brief y el eval salen vacíos hasta que existan (T077).

---

## Phase 5: User Story 3 - Etiquetar casos y medir al agente (Priority: P3)

**Goal**: etiquetado a ciegas en orden cronológico y un informe de eval del agente frente a la regla de 60 min, con intervalos de Wilson.

**Independent Test**: con una muestra que cumple la regla de parada, `bun run eval` da las métricas del agente y de la regla con sus intervalos. Al repetirlo, las cifras de la regla salen idénticas.

### Tests for User Story 3 ⚠️

- [ ] T050 [P] [US3] [clase] `tests/unit/eval.test.ts`:
  - Wilson con un valor de referencia: 8 de 10 → [0,490, 0,943];
  - la matriz de confusión, sin contar `undeterminable`;
  - la regla de parada: 99 casos, insuficiente; 100 casos con 14 positivos, insuficiente; 300 casos sin 15 positivos, "positivos raros";
  - la regla de 60 min da lo mismo dos veces.
- [ ] T051 [P] [US3] [clase] `tests/integration/label-blind.test.ts`:
  - `GET /api/label/next` no lleva ningún campo del veredicto, sigue el orden cronológico y se salta los descartados;
  - `POST /api/labels` guarda la etiqueta y responde con el veredicto.

### Implementation for User Story 3

- [ ] T052 [P] [US3] [clase] El cálculo del eval, en cuatro archivos:
  - `src/eval/wilson.ts`;
  - `src/eval/metrics.ts`: tp, fp, fn y tn de `likely_dark` frente al resto; la precisión y la exhaustividad con su intervalo de Wilson; el coste medio por caso y por perfil;
  - `src/eval/naive.ts`: todo gap de más de 60 min es `likely_dark`;
  - `src/eval/stopping.ts`: la regla de parada (FR-021).

  Hace pasar T050.
- [ ] T053 [US3] [clase] `src/server/routes/labels.ts`:
  - `GET /api/label/next`;
  - `POST /api/labels` (✎), con `author` = el usuario del sistema (`os.userInfo().username`);
  - `GET /api/eval/reports`.

  Hace pasar T051.
- [ ] T054 [US3] [clase] `panel/src/routes/label/+page.svelte`:
  - muestra el siguiente caso: un mapa pequeño con el rastro y el gap, y los datos del buque. Sin el veredicto;
  - las teclas 1, 2 y 3 son `coverage_gap`, `likely_dark` y `undeterminable`, con una nota opcional;
  - al guardar, revela el veredicto del agente y pasa al siguiente caso.
- [ ] T055 [US3] [clase] `src/cli/eval.ts` (`bun run eval [--profile]`):
  - con perfil, reinvestiga los casos etiquetados con ese perfil, respetando el tope;
  - sin perfil, usa el último expediente de cada caso;
  - calcula las métricas con T052, guarda el informe en `eval_reports` con `agent_version` e imprime un resumen.
- [ ] T056 [US3] [clase] `panel/src/routes/eval/+page.svelte`:
  - el último informe: el agente frente a la regla, con la precisión y la exhaustividad y sus intervalos, la matriz de confusión, el coste por caso y por perfil, n, la fecha y la versión;
  - el aviso de *muestra insuficiente*, con lo que falta;
  - el historial de informes.
- [ ] T057 [US3] [bloque] Sesiones de etiquetado de los candidatos no descartados, en orden cronológico, hasta cumplir la regla de parada (100 casos o más y al menos 15 `likely_dark`, o 300 casos). Son varias sesiones, sin mirar el veredicto antes de etiquetar. Necesita días de datos de la Pi.
- [ ] T058 [US3] [bloque] Con el PC encendido, `bun run eval --profile local` sobre la muestra completa. Comprobar que las cifras de la regla salen iguales al repetirlo (SC-003).

**Checkpoint**: existe la cifra que se publica.

---

## Phase 6: User Story 4 - Vigilancia en vivo (Priority: P4)

**Goal**: la Pi ingiere en vivo, mide su salud y su cobertura, detecta candidatos y los investiga sola. Con el PC apagado, los encola.

**Independent Test**: una hora en vivo con una caída forzada de 10 minutos. La caída queda registrada y no crea candidatos (SC-006). Con el PC apagado, los casos quedan en `pending_no_model` y se investigan al encenderlo.

### Tests for User Story 4 ⚠️

- [ ] T059 [P] [US4] [clase] `tests/integration/queue-live.test.ts`, con `FakeClient` y un comprobador del modelo de pega:
  - 12 h "apagado" con 30 candidatos: los 30 quedan en `pending_no_model`;
  - al "encender": se investigan los 30 en orden y no se pierde ninguno (SC-005);
  - un gap que reaparece después de las 6 h crea la versión 2 del expediente.

### Implementation for User Story 4

- [ ] T060 [US4] [clase] Ingesta en vivo a SQLite:
  - `src/cli/ingest.ts` pasa cada mensaje por `pipeline.ts`, además de archivarlo, y cierra los minutos con `health.ts` cada minuto;
  - retención de 30 días para `positions` y el archivo crudo: una vez al día borra lo antiguo, salvo las ventanas ya exportadas en `recordings`.
- [ ] T061 [US4] [clase] `src/detect/run.ts`: cuando un barco reaparece después del disparo de las 6 h, se añaden `gap_end` y las posiciones finales, y se encola una reinvestigación (versión + 1).
- [ ] T062 [US4] [clase] `src/server/jobs.ts`, los trabajos del modo `live`:
  - el detector, cada minuto;
  - la cobertura, cada hora;
  - un trabajador de la cola que, antes de cada caso, comprueba el modelo (`GET {VIGIA_LOCAL_URL}/api/version`, timeout de 3 s). Sin modelo, deja el caso en `pending_no_model` y vuelve a probar cada 2 min. Cuando el modelo vuelve, investiga por orden de llegada (FR-028).

  Hace pasar T059.
- [ ] T063 [P] [US4] [clase] `GET /api/health?from=&to=` y `panel/src/routes/health/+page.svelte`: los mensajes por minuto, las caídas y el estado de la conexión (FR-017).
- [ ] T064 [US4] [bloque] Desplegar en la Pi:
  - Bun, el repo y el `.env`;
  - `deploy/vigia-ingest.service`, actualizado, y `deploy/vigia-server.service` (modo `live`, `Restart=always`);
  - importar lo grabado desde T001 con `--from-archive`, para no perder esos días.
- [ ] T065 [US4] [bloque] Probar el escenario 2 y SC-006:
  - `systemctl stop vigia-ingest` durante 10 min. En `/health` sale la caída, y ningún gap que se solape con ella crea candidato;
  - con el PC apagado, los candidatos quedan en `pending_no_model`, y al encenderlo se investigan;
  - SC-005: con el modelo disponible, el percentil 95 de `trigger_at → dossiers.created_at` es de 10 min o menos.

**Checkpoint**: la Pi trabaja sola y graba los datos del eval.

---

## Phase 7: User Story 5 - Brief diario (Priority: P5)

**Goal**: cada mañana, un brief de las últimas 24 h: la parte determinista a su hora y la narrativa cuando haya modelo.

**Independent Test**: sobre 24 h con expedientes, `bun run brief`. Los recuentos cuadran con los expedientes y los enlaces llevan a casos que existen.

### Tests for User Story 5 ⚠️

- [ ] T066 [P] [US5] [clase] `tests/unit/brief.test.ts`, con expedientes de fixtures:
  - los recuentos por veredicto cuadran;
  - los 5 principales enlazan a casos que existen;
  - un día sin candidatos da un brief que lo dice.

### Implementation for User Story 5

- [ ] T067 [US5] [clase] `src/brief/sections.ts`, la parte determinista de las últimas 24 h:
  - los recuentos por veredicto;
  - los 5 principales: primero los `likely_dark`, por confianza y por duración del gap, y después el resto;
  - la salud y el gasto del día.

  Se guarda en `briefs` con `narrative_state = pending`, o `skipped` si no hubo casos. Hace pasar T066.
- [ ] T068 [US5] [clase] `src/brief/narrative.ts`: un párrafo en inglés escrito por el modelo a partir de `sections_json`, sin herramientas y contando su coste en `budget`. El trabajador de la cola (T062) lo genera cuando hay modelo y pasa el estado a `done`.
- [ ] T069 [US5] [clase] `src/cli/brief.ts` (`bun run brief [--date]`), `deploy/vigia-brief.service` y `deploy/vigia-brief.timer`, con `OnCalendar=*-*-* 08:00:00 Europe/Madrid` y `Persistent=true`.
- [ ] T070 [P] [US5] [clase] `GET /api/briefs`, `GET /api/briefs/:date` y `panel/src/routes/briefs/+page.svelte`: la lista y el detalle, con enlaces a `/cases/[id]`.
- [ ] T071 [US5] [bloque] Instalar el timer en la Pi y comprobar que hay brief los 7 días de una semana, a su hora (SC-007).

**Checkpoint**: todas las historias funcionan.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T072 [P] [clase] `README.md` en inglés:
  - qué es, con una captura o un GIF, y `bun run demo`;
  - cómo funciona el agente: el bucle y la traza;
  - las cifras, **solo** las del último informe de eval;
  - los límites y el aviso de proyecto educativo;
  - las atribuciones (Digitraffic con CC BY 4.0, GFW de uso no comercial, OSM con ODbL) y la licencia MIT.
- [ ] T073 [clase] SC-008: revisar 10 expedientes al azar y anotar en `specs/001-vigia-v1/review-sc008.md` si cada veredicto se justifica con sus pruebas. Si no, ajustar `system.md`, lo que da una nueva `agent_version`.
- [ ] T074 [bloque] La comparación de pago (los 10 €): con `VIGIA_BUDGET_USD=10`, `bun run eval --profile haiku` y `--profile sonnet` sobre la misma muestra. Comprobar que con Haiku el coste medio por caso es de 0,01 $ o menos (SC-004).
- [ ] T075 [clase] Preparar el conjunto del eval (la grabación larga y las etiquetas) como descarga aparte, con `bun run record --kind eval` y la atribución de T045. No se publica sin la confirmación de Marcos.
- [ ] T076 [clase] Repasar `quickstart.md` de principio a fin y corregir lo que no cuadre.
- [ ] T077 [bloque] Reconstruir la demo con `bun run demo:build` cuando ya haya briefs e informe de eval. Comprobar que ocupa 50 MB o menos y repetir T049.
- [ ] T078 [bloque] Demo pública en la Pi, detrás de Cloudflare Tunnel (constitución, "Restricciones técnicas"): en modo `public` (solo lectura) con los datos en vivo, o en `replay` sobre `demo/vigia-demo.sqlite`. No se publica nada sin la confirmación de Marcos.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1)**: T001 primero y cuanto antes. Mientras la Pi graba, T003-T005 avanzan en clase.
- **Foundational (fase 2)**: depende de T003. T011 necesita la muestra de T002.
- **US1 (fase 3)**: depende de la fase 2. Es la base del resto.
- **US2 (fase 4)**: depende de la US1, porque la demo enseña expedientes.
- **US3 (fase 5)**: depende de la US1. T057 necesita días de datos, que llegan con T001 y T064.
- **US4 (fase 6)**: depende de la US1 (el agente y la cola). Conviene hacer T064 pronto para que la Pi acumule datos del eval.
- **US5 (fase 7)**: la parte determinista depende de la US1. La narrativa (T068) usa el trabajador de T062, que es de la US4.
- **Polish (fase 8)**: al final. T077 depende de las US3 y US5.

### Ruta crítica

T001 → T002 → T011 → US1 (T013-T036) → T064 (la Pi en vivo, acumulando) → T057 (etiquetar) → T058 (eval) → T077 (demo final) → T072 (README con cifras).

Lo que más tiempo de calendario lleva es juntar los datos y etiquetar, no escribir código. Por eso la Pi graba desde el primer día.

### Within Each User Story

- Las pruebas, antes que el código, y fallando.
- Las funciones puras (geo, detector, cobertura, eval), antes que lo que escribe en la base.
- El servidor, antes que el panel.
- `bun run check` en verde antes de cada commit. Un commit pequeño por tarea, marcándola aquí.

### Parallel Opportunities

Uno solo programa, así que aquí "paralelo" quiere decir: **tareas [clase] intercambiables en el mismo rato**, y **la Pi grabando mientras tanto**.

- Fase 1: T005, y T004 después de T003, mientras la Pi graba.
- Fase 2: T008 y T009.
- US1: las pruebas T013-T017 entre sí; T018, T022, T023, T024 y T026 entre sí; T035, en el panel, contra fixtures.
- US2: T037, T038, T039 y T042.
- US3: T050, T051 y T052.

---

## Parallel Example: User Story 1

```bash
# Un rato de clase, las pruebas:
Task: "tests/unit/detect.test.ts"      # T014
Task: "tests/unit/coverage.test.ts"    # T015
Task: "tests/unit/verdict.test.ts"     # T016

# Otro rato de clase, las herramientas del agente:
Task: "src/agent/tools/get_track.ts, get_vessel.ts, get_ingest_health.ts"  # T023
Task: "src/agent/tools/get_coverage.ts, get_nearby.ts"                     # T024
Task: "src/agent/prompts/system.md"                                        # T026

# Un bloque de tarde, con el PC encendido:
Task: "Primera conexión real con Ollama"  # T031
Task: "Prueba de modelos"                 # T033
```

---

## Implementation Strategy

### MVP First (US1)

1. T001 en la Pi (un bloque) y, en clase, T003-T012.
2. US1 sobre la muestra grabada, con `FakeClient` hasta T031.
3. **Parar y validar**: abrir un expediente real y entender el veredicto en menos de un minuto. Esto ya se puede enseñar en una entrevista.

### Incremental Delivery

1. Setup + Foundational → la Pi graba y la base carga.
2. US1 → el agente investiga (el MVP).
3. US2 → cualquiera lo ve con `bun run demo`.
4. US4 → la Pi trabaja sola. Se puede adelantar a la US3 si faltan datos para etiquetar.
5. US3 → la cifra del eval.
6. US5 → el brief diario.
7. Polish → el README con cifras, los 10 € de comparación y la demo final.

### Reparto [clase] / [bloque]

- **[clase]**: 63 tareas. Pruebas, geo, detector, cobertura, herramientas, eval, rutas, vistas del panel con fixtures.
- **[bloque]**: 15 tareas. La Pi (T001, T002, T064, T065, T071, T078), el PC (T031, T033, T047, T058, T074, T077), las fuentes reales (T032), el bucle del agente (T027) y el etiquetado (T057).

---

## Notes

- Una tarea cada vez, con su "hecho" definido antes de escribir código (constitución, "Flujo de trabajo").
- Si un cambio toca 3 archivos o más, pasa por `/code-review medium`.
- Los secretos, solo en `.env`. Nunca en el repo ni en el código.
- Solo buques: ninguna herramienta ni prompt busca personas (principio VI).
- Los datos de Digitraffic son CC BY 4.0: si entran en el repo o en la demo, van con su atribución.
