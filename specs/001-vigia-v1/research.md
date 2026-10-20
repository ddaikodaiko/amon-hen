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

- **Comprobado (2026-10-19, prueba de humo del portátil al PC por Tailscale):** con `@anthropic-ai/sdk` 0.135 y el `baseURL` apuntando a Ollama 0.40.4, `qwen3:8b` hace tool use: devuelve `stop_reason: tool_use`, bloques `tool_use` y `usage`, y respeta `thinking: {type: "disabled"}`. La primera llamada en frío tarda ~113 s, porque carga el modelo en la VRAM. En caliente, cada paso tarda entre 4 y 13 s (~70 tokens/s de salida), con el modelo entero en la GPU (5,6 GB). Hay que tener en cuenta tres cosas:
  - **El contexto por defecto es de 4.096 tokens** (lo dice `ollama ps`). Una investigación con rastros lo supera, y Ollama recorta sin avisar. Hay que subirlo, por ejemplo con `OLLAMA_CONTEXT_LENGTH=16384`, `OLLAMA_FLASH_ATTENTION=1` y `OLLAMA_KV_CACHE_TYPE=q8_0` para que quepa en 8 GB, y mantener compactas las salidas de las herramientas.
  - **Medido (2026-10-20, T031):** el system, las herramientas y el resumen del caso ya ocupan unos 2.400 tokens. Contra el tokenizador real (con un prefijo al azar para que Ollama no use la caché), `estimateTokens` (caracteres / 3) acierta al 2 % mientras la conversación cabe. A partir de 4.096, el tamaño real se queda entre 3.000 y 4.060 aunque la conversación siga creciendo: Ollama tira los mensajes más antiguos, el resumen del caso el primero. **84 de las 115 primeras investigaciones pasaron de 4.096** en su última llamada (mediana 4.273, p90 4.893, máximo 9.512); con 16.384 no pasaría ninguna. Desde entonces el bucle nunca manda más que `VIGIA_LOCAL_CONTEXT`: los resultados antiguos se quedan con su paso y su resumen, y si ni así cabe, el caso acaba en error diciendo por qué.
  - **`usage.input_tokens` de Ollama cuenta solo lo que no estaba en caché.** Ollama reutiliza el prefijo de la petición anterior, así que una llamada puede anotar 135 tokens con miles de contexto detrás. En los expedientes del perfil `local`, los tokens de entrada son trabajo de la GPU, no el tamaño de la conversación.
  - **El `usage.input_tokens` de Ollama solo cuenta lo que no reaprovecha de su caché** (en una llamada repetida dio 4 tokens). Por eso los tokens locales no se pueden comparar tal cual con los de la API de pago. La traza guarda el valor tal como llega, y el eval compara costes, no tokens.
  - **El modelo se inventa índices de paso** en `evidence`: citó los pasos 2 y 3, que no existían. La validación de `submit_verdict` contra la traza (R4) es imprescindible.
- **Comprobado (2026-10-20):** con el PC apagado, una petición a Ollama por Tailscale se queda colgada en vez de fallar. Antes de cada investigación se prueba `GET /api/version` con 3 s de plazo (T021).

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
  - Los minutos de una caída propia no cuentan como esperados, y los silencios de más de 6 h no se interpolan (decidido en T018).
- **Por qué:** no necesita dependencias, se explica en una frase y se puede comprobar a mano. Con el filtro de velocidad tampoco hace falta modelar el intervalo de reporte de cada clase AIS.
- **Alternativas:**
  - H3 (`h3-js`): hexágonos más bonitos, pero una dependencia que una sola región no necesita.
  - Calcular los reportes esperados según la norma ITU-R M.1371: más preciso en teoría, pero frágil con transpondedores que no cumplen.

## R7. Ingesta desde Digitraffic (antes, aisstream)

- **Decisión:**
  - Un proceso `ingest` en la Pi se conecta por WebSocket a `wss://meri.digitraffic.fi:443/mqtt` (subprotocolo `mqtt`) con un cliente MQTT 3.1.1 mínimo y propio: CONNECT, SUBSCRIBE, PUBLISH con QoS 0 y PINGREQ cada 30 s.
  - Se suscribe a `vessels-v2/+/location` y `vessels-v2/+/metadata`. Llega toda la flota que ve Fintraffic (~40 mensajes/s): se archiva todo, y el filtro por región se aplica al procesar.
  - Se reconecta con espera exponencial y fuerza la reconexión si pasan 2 min sin mensajes.
  - Registra la salud por minuto. Un periodo de 2 minutos o más sin mensajes es una caída propia (FR-002).
- **Formato** (visto el 2026-10-19): el MMSI va en el topic.
  - `location`: `lat`, `lon`, `sog`, `cog`, `heading`, `navStat`, `rot`, `posAcc`, `raim` y `time` (Unix, en segundos).
  - `metadata`: `name`, `callSign`, `imo`, `destination`, `draught`, `eta`, `type`, `posType`, `refA`-`refD` y `timestamp` (en ms).
- **Clase A o B:** Digitraffic no la da. Regla de partida: es clase A si su metadata trae `imo`, `eta` o `draught`, que solo emite el mensaje 5 (clase A). Si no se sabe, clase B, con el umbral largo (60 min), que da menos falsos positivos.
  - **Comprobado (2026-10-19, 10 min):** los 59 barcos en marcha con esa metadata emiten cada 15 s o menos, como corresponde a la clase A. La REST `/api/ais/v1/vessels` da metadata de unos 940 barcos, y solo 9 sin `imo`, `eta` ni `draught` (salvamento, prácticos, avisos). O sea: **Digitraffic publica metadata casi solo de clase A**.
  - **Consecuencia:** sin metadata, el barco es clase B, salvo justo después de arrancar, porque la metadata por MQTT llega solo cuando el barco la emite (cada ~6 min). Por eso la ingesta carga la metadata completa por REST al arrancar. Con eso, en el golfo hay 933 barcos de clase A y 13 de B **[revisar con las 24 h de T002]**.
- **Por qué:** es la fuente gratuita con mejor cobertura medida (abajo), no pide key, y su licencia (CC BY 4.0) permite publicar la demo y el set del eval con atribución.
- **Alternativa descartada: aisstream en el Estrecho de Gibraltar**, la región original. La grabadora de T001 se escribió primero contra aisstream (commit `806a157`) y sirvió para medirlo:
  - **Comprobado:** el cliente WebSocket de Bun negocia `permessage-deflate`, y aisstream responde `CompressionEnabled: true`. No hace falta el paquete `ws`.
  - **Medido (17,7 min desde el portátil):**
    - **8,9 posiciones por minuto y 52 barcos distintos** en todo el Estrecho;
    - los barcos en marcha llegan, en mediana, cada 90 s (p10: 53 s; p90: 390 s), así que aisstream da como mucho ~1 mensaje por barco y minuto;
    - casi todo viene de la orilla sur (Tánger Med y Ceuta), y de la bahía de Algeciras y Gibraltar no llega casi nada;
    - en el mismo minuto, Rotterdam dio 206 mensajes por minuto.
  - **Digitraffic, medido el mismo día:** (Finlandia), con datos abiertos CC BY 4.0, sin key y en vivo por MQTT sobre WebSocket. En 3 min dio **1.285 mensajes por minuto y 415 barcos solo en el golfo de Finlandia**, con barcos en marcha cada 9 s de mediana.
  - **Conclusión:** con aisstream, el Estrecho no tiene cobertura suficiente para detectar barcos oscuros: casi todo gap sería un hueco de cobertura. Marcos decidió cambiar al golfo de Finlandia (2026-10-19).

## R8. Detector y exclusiones

- **Decisión:** el detector es determinista y no usa LLM. Crea un candidato si un barco pasa sin emitir 30 min o más (clase A) o 60 min o más (clase B), navegando o fondeado. No usa el `nav_status`, porque lo declara el propio barco y se puede falsear. Se descarta, con su motivo, si:
  - el gap se solapa con una caída propia;
  - el barco está junto al borde de la región con rumbo hacia fuera;
  - el gap empieza en una dársena o un amarre (polígonos en `data/ports.geojson`; los fondeaderos no se excluyen).

  La investigación se dispara cuando el barco reaparece o cuando el gap cumple 6 h.
- **Por qué:** la constitución dice que las reglas detectan y el agente investiga. La spec fija los umbrales en las clarificaciones.

- **Comprobado (2026-10-19):** OSM tiene bien etiquetados los puertos grandes, pero no los muelles urbanos ni los puertos pequeños. Con solo las zonas portuarias, quedan fuera ~4 de cada 10 barcos amarrados (detalle en T005). El borrador de `ports.geojson` sale de `scripts/ports-from-osm.ts`, y hay que revisarlo a mano antes de usarlo en el detector.

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

- **Decisión:** con `VIGIA_MODE=public`, el **servidor** rechaza con 403 todo lo que escribe o gasta: etiquetas, reinvestigar, eval. No basta con ocultar los botones. La demo (`replay`) también es de solo lectura: cada visitante tiene su propio reloj de replay en su conexión SSE, así que cambiar la velocidad no escribe nada ni afecta a los demás (decidido en T041). Los secretos (`GFW_TOKEN`, `ANTHROPIC_API_KEY`) van solo en `.env`, fuera del repo.
- **Por qué:** FR-026 y principio V. Nadie de fuera puede gastar presupuesto.

## R14. Pruebas

- **Decisión:**
  - Se usa `bun test`.
  - El agente recibe la interfaz `ModelClient` por inyección de dependencias. En las pruebas, un **modelo de pega con guion** devuelve llamadas a herramientas fijas.
  - Las pruebas de integración usan fixtures de mensajes AIS con gaps conocidos.
  - Ninguna prueba usa red ni keys.
- **Por qué:** se prueban el bucle, la traza, el tope y la cola sin GPU ni gasto. Así, las tareas de pruebas pueden ser **[clase]**.
