# Fase 0: investigación técnica (Vigía v1)

Fecha: 2026-10-19. Cada punto sigue el formato Decisión / Por qué / Alternativas descartadas. Los puntos marcados **[verificar en T0xx]** se comprueban en la primera tarea que los toca. Hasta entonces son la mejor información disponible, no un hecho comprobado.

## R1. El modelo es intercambiable, con Ollama por defecto

- **Decisión:** el agente usa el SDK oficial `@anthropic-ai/sdk` (TypeScript) y cambia de modelo con un **perfil**: `baseURL`, nombre del modelo y precios. Hay tres perfiles:
  - `local`: Ollama en el PC de casa, por Tailscale (`http://<pc>:11434`).
  - `haiku`: `claude-haiku-5-5`, a 0,10 $ / 0,50 $ por millón de tokens (prompts de hasta 100k).
  - `sonnet`: `claude-sonnet-5-5`, a 2 $ / 10 $ por millón de tokens.
- **Por qué:** el código de Ollama (`Proyectos/ollama`, mayo de 2026) expone `POST /v1/messages` con `tools`, `tool_choice`, `system`, `stream` y `thinking`, y devuelve `usage.input_tokens/output_tokens`. Un solo camino de código para el modelo local y el de pago hace justa la comparación del eval (principio V).
- **Limitaciones encontradas en el código de Ollama:** de `output_config` solo lee `effort`, así que **no hay salidas estructuradas**. `thinking` solo acepta `enabled` y `disabled`.
- **Alternativas:**
  - Un cliente OpenAI-compatible para Ollama y FreeLLMAPI: serían dos caminos de código y dos formatos de traza.
  - El Claude Agent SDK: trae herramientas de sistema que aquí sobran y oculta el bucle que queremos enseñar.

## R2. Modelo local: qwen3 8B como punto de partida, con una prueba de varios modelos

- **Decisión:** se empieza con un modelo de 7-9B con llamadas a herramientas y cuantización Q4. Ocupa ~5 GB y cabe entero en los 8 GB de la RTX 3060 Ti, con margen para el contexto. El candidato inicial es `qwen3:8b`. La tarea de comparación prueba también `llama3.1:8b` y `granite3.3:8b` sobre los mismos 10 casos de humo y se queda con el que más expedientes válidos produce **[verificar en T0xx]**.
- **Por qué:** un modelo de 14B (Q4, ~9 GB) no cabe entero, y descargar capas a la CPU lo hace varias veces más lento. Los modelos de 3-4B fallan más al llamar a herramientas.
- **Alternativas:** `mistral-nemo` de 12B, muy justo de memoria. `gpt-oss` de 20B no cabe.

## R3. Bucle del agente manual, sin Tool Runner

- **Decisión:** un bucle propio sobre `client.messages.create` (no la versión beta):
  1. Llama al modelo.
  2. Ejecuta las herramientas.
  3. Añade a `messages` el `response.content` íntegro, sin editar el historial.
  4. Repite hasta `submit_verdict`.
- **Límites:**
  - Como mucho 10 llamadas a herramientas.
  - Un solo aviso si el modelo termina sin llamar a `submit_verdict`.
  - Hasta 2 reintentos si el veredicto no valida con zod.
- **Por qué:**
  - Cada paso tiene que quedar en la traza con sus tokens, su coste y su duración (principio II).
  - El bucle es justo lo que se enseña en una entrevista.
  - Además, así no se depende de que Ollama acepte las rutas beta.
- **Alternativas:** el Tool Runner del SDK (`client.beta.messages.toolRunner`). Va bien, pero oculta el bucle y no está comprobado contra Ollama.
- **Nota para implementar:** antes de escribir el bucle hay que leer `typescript/claude-api/README.md` y `tool-use.md` de la skill `claude-api`. Con los modelos 5.5 de Claude no se puede forzar `tool_choice` (`any`/`tool` da 400), así que se usa `auto` y una instrucción en el prompt.

## R4. Veredicto con la herramienta `submit_verdict` y zod

- **Decisión:** el veredicto se entrega llamando a `submit_verdict`, que se valida con un esquema zod: veredicto, confianza, explicación y pruebas con índice de paso. En los perfiles de Anthropic, la herramienta lleva `strict: true`.
- **Por qué:** Ollama ignora las salidas estructuradas (R1). Una herramienta funciona igual con los tres perfiles.
- **Alternativas:** JSON en texto libre (frágil) y `output_config.format` (no existe en Ollama).

## R5. Almacenamiento: SQLite (`bun:sqlite`) más un archivo crudo comprimido

- **Decisión:**
  - Una base **SQLite en modo WAL** para el estado: buques, posiciones reducidas a una cada 30 s por barco, salud, cobertura, candidatos, expedientes, trazas, etiquetas, informes, briefs y presupuesto.
  - Los **mensajes crudos** se archivan por horas en NDJSON con gzip. Sirven para el replay fiel y para la reproducibilidad del eval.
  - La demo es **un único archivo SQLite** (`demo/vigia-demo.sqlite`, 50 MB como mucho).
- **Por qué:**
  - Viene con Bun, así que no añade dependencias (principio I) y corre de sobra en la Pi 5.
  - Para una sola región, las consultas espaciales son cajas de coordenadas y una función haversine en TypeScript.
- **Volumen estimado, sin medir:** con ~400 barcos, ~1 M de filas de posición al día (~70 MB). El crudo comprimido serían ~100 MB al día. En vivo se guardan 30 días, y las ventanas del eval se exportan antes de borrar **[verificar en T001]**.
- **Alternativas:**
  - DuckDB: dependencia nativa en ARM y bindings de Bun poco maduros.
  - PostgreSQL con PostGIS: un servicio más en la Pi, sobredimensionado para una región.

## R6. Cobertura: rejilla regular y "minutos-barco"

- **Decisión:** rejilla regular de 0,025° (~2,5 km), que da ~1.200 celdas en la región. Para cada celda y hora del día:
  - Se interpola el rastro de cada barco a 1 minuto entre sus posiciones recibidas, incluidos los minutos de los gaps.
  - **Solo cuentan los minutos en los que el barco va a más de 3 nudos**, según su SOG o, dentro de un gap, según la velocidad implícita entre los dos extremos. A esa velocidad, la clase A emite cada 10 s o menos y la clase B cada 30 s, así que cada minuto debería tener al menos un mensaje. Un barco fondeado emite cada 3 min: si contara, la cobertura saldría baja justo en los fondeaderos.
  - **cobertura = minutos-barco con al menos un mensaje / minutos-barco estimados en la celda**.
  - Se calcula sobre una ventana móvil de 7 días y se guarda el tamaño de la muestra.
  - `get_coverage` resta la contribución del barco investigado (se recalcula al vuelo solo para él), para que su propio gap no cuente como prueba de mala cobertura.
- **Por qué:** no necesita dependencias, se explica en una frase y se puede comprobar a mano. Con el filtro de velocidad tampoco hace falta modelar el intervalo de reporte de cada clase AIS.
- **Alternativas:**
  - H3 (`h3-js`): hexágonos más bonitos, pero una dependencia que una sola región no necesita.
  - Calcular los reportes esperados según la norma ITU-R M.1371: más preciso en teoría, pero frágil con transpondedores que no cumplen.

## R7. Ingesta desde aisstream

- **Decisión:**
  - Un proceso `ingest` en la Pi con el cliente WebSocket de Bun.
  - Manda la suscripción en menos de 3 s: `BoundingBoxes` con los pares `[lat, lon]` de la región y los tipos de mensaje `PositionReport`, `StandardClassBPositionReport`, `ExtendedClassBPositionReport`, `ShipStaticData` y `StaticDataReport`.
  - Se reconecta con espera exponencial.
  - Registra la salud por minuto. Un periodo de 2 minutos o más sin mensajes es una caída propia (FR-002).
- **Por qué:** la documentación de aisstream exige un backend (no admite conexiones desde el navegador), el bounding box y la suscripción rápida.
- **Riesgo:** la documentación pide la compresión `permessage-deflate`, y no está comprobado que el cliente de Bun la negocie. Si no lo hace, se usa el paquete `ws` **[verificar en T001]**.

## R8. Detector y exclusiones

- **Decisión:** el detector es determinista y no usa LLM. Crea un candidato si un barco pasa sin emitir 30 min o más (clase A) o 60 min o más (clase B), navegando o fondeado. No usa el `nav_status`, porque lo declara el propio barco y se puede falsear. Se descarta, con su motivo, si:
  - el gap se solapa con una caída propia;
  - el barco está junto al borde de la región con rumbo hacia fuera;
  - el gap empieza en una dársena o un amarre (polígonos en `data/ports.geojson`; los fondeaderos no se excluyen).

  La investigación se dispara cuando el barco reaparece o cuando el gap cumple 6 h.
- **Por qué:** la constitución dice que las reglas detectan y el agente investiga. La spec fija los umbrales en las clarificaciones.

## R9. Global Fishing Watch: una herramienta, nunca la verdad del eval

- **Decisión:** la herramienta `get_gfw_events` consulta `gateway.api.globalfishingwatch.org/v3/events` con un token Bearer gratuito, buscando eventos de gaps, encounters y loitering de un MMSI en una ventana de tiempo. Si falla o tarda, devuelve `unavailable` y el agente sigue (FR-012).
- **Riesgos:**
  - Uso solo no comercial.
  - Es posible que GFW publique los eventos con días de retraso, y entonces en vivo devolvería poco. Hay que medirlo **[verificar en T0xx]**.
  - Los nombres exactos de los datasets también están por verificar.

## R10. Panel: SvelteKit estático, MapLibre y mapa base offline

- **Decisión:**
  - SvelteKit con `adapter-static`, compilado a `panel/build`.
  - Lo sirve el propio `Bun.serve` junto con la API JSON y un canal **SSE** para las posiciones en vivo y el replay.
  - El mapa usa **MapLibre** con un mapa base sin servidor de teselas: polígonos de tierra de OpenStreetMap recortados a la región y simplificados (`data/land.geojson`, ~1-3 MB, licencia ODbL con atribución).
- **Por qué:** la demo tiene que funcionar sin red (FR-024), y con un GeoJSON local basta. Además encaja con la estética de estación de control de makerforge.
- **Alternativas:**
  - Teselas remotas (OpenFreeMap): requieren red.
  - PMTiles con Protomaps: offline, pero añade dos dependencias y herramientas de extracción.

## R11. El brief se genera en dos capas

- **Decisión:** un timer de systemd a las 08:00 (Europe/Madrid) genera la **parte determinista**: los recuentos, los 5 casos principales, la salud y el gasto. Siempre sale a su hora, aunque el PC esté apagado. El párrafo narrativo, escrito por el LLM, se añade cuando el modelo está disponible (estado `narrative_pending`).
- **Por qué:** cumple SC-007 sin obligar a tener el PC encendido a las 08:00.

## R12. Eval: métricas e intervalos

- **Decisión:**
  - Se calculan la precisión, la exhaustividad y la matriz de confusión de *apagado probable* frente al resto, para el agente y para la regla de 60 min.
  - Los intervalos de confianza del 95 % son de **Wilson**, implementados a mano.
  - `bun run eval --profile <local|haiku|sonnet>` reinvestiga los casos etiquetados con ese perfil, respetando el tope, y guarda el informe con `agent_version`, que es un hash del prompt, las herramientas y el perfil.
  - Las etiquetas *indeterminable* se excluyen de la precisión y la exhaustividad, y se informa de cuántas son.
  - La población son los candidatos no descartados. El informe dice cuántos se descartaron, por motivo.
  - Se aplica la regla de parada de FR-021.
- **Por qué:** Wilson se comporta bien con muestras pequeñas y proporciones extremas, y se explica en una línea.

## R13. Modo público y seguridad

- **Decisión:** con `VIGIA_MODE=public`, el **servidor** rechaza con 403 todo lo que escribe o gasta: etiquetas, reinvestigar, eval. No basta con ocultar los botones. En la demo (`replay`) solo se permite cambiar la velocidad del replay. Los secretos (`AISSTREAM_KEY`, `GFW_TOKEN`, `ANTHROPIC_API_KEY`) van solo en `.env`, fuera del repo.
- **Por qué:** FR-026 y principio V. Nadie de fuera puede gastar presupuesto.

## R14. Pruebas

- **Decisión:**
  - Se usa `bun test`.
  - El agente recibe la interfaz `ModelClient` por inyección de dependencias. En las pruebas, un **modelo de pega con guion** devuelve llamadas a herramientas fijas.
  - Las pruebas de integración usan fixtures de mensajes AIS con gaps conocidos.
  - Ninguna prueba usa red ni keys.
- **Por qué:** se prueban el bucle, la traza, el tope y la cola sin GPU ni gasto. Así, las tareas de pruebas pueden ser **[clase]**.
