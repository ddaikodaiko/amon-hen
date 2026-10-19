# Implementation Plan: Vigía v1, un agente que investiga barcos oscuros en el golfo de Finlandia

**Branch**: `001-vigia-v1` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-vigia-v1/spec.md`

## Summary

La Pi 5 ingiere 24/7 el AIS del golfo de Finlandia desde Digitraffic (MQTT sobre WebSocket, sin key) y hace cuatro cosas:
- guarda las posiciones reducidas en SQLite y el crudo por horas;
- registra la salud de su propia ingesta;
- calcula la cobertura en "minutos-barco" sobre una rejilla de 0,025°;
- detecta los gaps con reglas deterministas.

Cada candidato lo investiga un **agente con un bucle propio de llamadas a herramientas** (SDK de Anthropic para TypeScript):
- el perfil por defecto es **Ollama en el PC de casa (RTX 3060 Ti), gratis**, por Tailscale;
- Haiku y Sonnet son perfiles opcionales con tope.

El agente deja un expediente con su veredicto, las pruebas enlazadas a los pasos y la traza completa. El panel, en SvelteKit estático con MapLibre y un mapa base offline, muestra el mapa, los casos, los expedientes, el etiquetado a ciegas, el eval (con intervalos de Wilson) y los briefs. La demo es un único archivo SQLite con todo ya calculado: `bun run demo`, sin keys ni red.

## Technical Context

**Language/Version**: TypeScript (`strict`) sobre Bun 1.x
**Primary Dependencies**:
- `@anthropic-ai/sdk`: el agente, con el perfil local a través del `/v1/messages` de Ollama;
- `zod`: validar las entradas de las herramientas y el veredicto;
- `@sveltejs/kit` + `adapter-static` y `maplibre-gl`: el panel.

Sin cliente MQTT de npm: el subconjunto que se usa (CONNECT, SUBSCRIBE, PUBLISH con QoS 0 y PINGREQ) cabe en un módulo propio con pruebas (R7).

De desarrollo, que no llegan a producción:
- `typescript` y `@types/bun`: Bun ejecuta TypeScript sin comprobar tipos, así que el modo `strict` solo se hace cumplir con `tsc --noEmit` (`bun run check`);
- `mapshaper`: se ejecuta una vez con `bunx` para generar `data/land.geojson` (T039) y no se instala;
- SvelteKit trae `svelte` y `vite` como dependencias de desarrollo del panel.
**Storage**: SQLite (`bun:sqlite`, WAL) y el archivo crudo NDJSON con gzip por horas (R5)
**Testing**: `bun test` con un modelo de pega con guion; sin red ni keys (R14)
**Target Platform**:
- Raspberry Pi 5 (Linux arm64, systemd): ingesta, servidor y brief.
- PC con RTX 3060 Ti: Ollama, que se enciende a ratos.
- Cualquier máquina con Bun: la demo.

**Project Type**: una aplicación web en un solo paquete Bun (servidor, procesos y panel estático)
**Performance Goals**:
- Ingesta sostenida del flujo completo de Digitraffic en la Pi: ~40 mensajes/s medidos, ~21/s dentro del golfo.
- Posiciones en el panel a 1 Hz.
- Expediente en 10 minutos o menos con el modelo disponible (SC-005).

**Constraints**: demo de 50 MB como mucho y sin red; 0 $ de API por defecto; prompts y salidas del agente en inglés; nada de datos de personas.
**Scale/Scope**:
- Una región y un solo usuario que etiqueta.
- ~400 barcos a la vez en el golfo (415 medidos en 3 min).
- Decenas de candidatos al día (estimado; se mide en vivo).
- Muestra del eval: entre 100 y 300 casos.

## Constitution Check

*GATE: antes de la fase 0 ✅ · después del diseño (fase 1) ✅*

| Principio | Cómo lo cumple el diseño | ¿Pasa? |
|---|---|---|
| I. Bun + TS estricto, dependencias mínimas | 4 dependencias de ejecución, cada una justificada en research.md, y 2 de desarrollo, justificadas arriba; SQLite viene con Bun; se descartan H3, DuckDB, PostGIS y PMTiles | ✅ |
| II. Traza | `trace_steps` guarda cada paso con tokens, coste y duración; `evidence.step_idx` se valida contra la traza; el panel muestra `output_summary` en tono de analista | ✅ |
| III. Ninguna afirmación sin eval | Etiquetas humanas a ciegas en orden; GFW solo como herramienta; comparación con la regla de 60 min; Wilson; regla de parada | ✅ |
| IV. Reproducible sin keys | `demo/vigia-demo.sqlite` + mapa base GeoJSON offline + modo `replay` que no llama a nada de fuera | ✅ |
| V. Gratis por defecto, coste acotado | Perfil `local` por defecto; `VIGIA_BUDGET_USD=0`; los tokens se miden también en local; el escalado está desactivado por defecto | ✅ |
| VI. Datos abiertos, buques y no personas | Digitraffic (CC BY 4.0), GFW (no comercial) y OSM (ODbL), con atribución; el prompt prohíbe buscar personas; aviso en el panel y en el README | ✅ |

No hay incumplimientos. La tabla de complejidad (abajo) solo recoge decisiones que conviene justificar.

## Project Structure

### Documentation (this feature)

```text
specs/001-vigia-v1/
├── plan.md            # este archivo
├── research.md        # fase 0: R1-R14
├── data-model.md      # fase 1: tablas y estados
├── quickstart.md      # fase 1
├── contracts/
│   ├── agent-tools.md # herramientas del agente y submit_verdict
│   ├── http-api.md    # API del servidor y modos
│   └── cli.md         # comandos y variables de entorno
└── tasks.md           # fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── config.ts              # .env, perfiles de modelo y precios, región, umbrales
├── db/                    # schema.sql, migraciones, consultas tipadas
├── geo/                   # rejilla 0,025°, haversine, celdas, polígonos (puertos, borde)
├── ingest/                # cliente MQTT de Digitraffic, archivo crudo, parse, pipeline (reducción a 30 s), salud
│                          # e importación del archivo crudo
├── coverage/              # minutos-barco por celda y hora (ventana de 7 días)
├── detect/                # detector de gaps, exclusiones y disparo (reaparece o 6 h)
├── agent/
│   ├── model.ts           # interfaz ModelClient: AnthropicClient(perfil) | FakeClient(guion)
│   ├── loop.ts            # bucle manual de herramientas y traza
│   ├── tools/             # get_track, get_coverage, get_vessel, get_nearby,
│   │                      # get_ingest_health, get_gfw_events, submit_verdict
│   ├── prompts/system.md  # en inglés
│   ├── budget.ts          # tope mensual y coste por usage
│   └── queue.ts           # cola: pending, pending_no_model, pending_budget, error
├── eval/                  # métricas, Wilson, regla de parada, informe
├── brief/                 # parte determinista y narrativa opcional
├── replay/                # reloj del replay y exportación de grabaciones
├── server/                # Bun.serve: API (routes/), SSE, trabajos del modo live, estáticos y guardas de modo
└── cli/                   # ingest.ts, server.ts, investigate.ts, eval.ts, brief.ts, record.ts, demo.ts, demo-build.ts
panel/                     # SvelteKit (adapter-static) + MapLibre
└── src/routes/            # / (mapa), /cases, /cases/[id], /label, /eval, /briefs, /health
data/                      # land.geojson (OSM recortado), ports.geojson (dársenas), region.json
demo/                      # vigia-demo.sqlite (generado con demo:build, 50 MB como mucho)
deploy/                    # unidades systemd para la Pi
tests/
├── unit/                  # geo, cobertura, detector, Wilson, presupuesto, validación del veredicto
├── integration/           # bucle del agente con FakeClient, cola, modos del servidor
└── fixtures/              # mensajes AIS con gaps conocidos y guiones del modelo de pega
```

**Structure Decision**: un solo paquete Bun. El panel es un subdirectorio SvelteKit que compila a estáticos, y los sirve el mismo `Bun.serve`. Así `bun run demo` es un único proceso, y en la Pi solo hay dos servicios (`ingest` y `server`) y un timer.

## Plan de entrega (para `/speckit-tasks`)

Cada tarea irá marcada como **[clase]** (menos de 50 min, sin GPU, sin la Pi; p. ej. pruebas, geo, métricas, vistas del panel con fixtures) o **[bloque]** (3 h, o que necesita la Pi, el PC o datos reales).

1. **Primero, la grabadora** (T001, [bloque]). La ingesta corre en la Pi desde la primera semana, porque el eval necesita días de datos. También mide el volumen real y comprueba `permessage-deflate`.
2. **Después, la P1 sobre los datos grabados**: detector → bucle del agente con el modelo de pega → herramientas → perfil local en la 3060 Ti → prueba de modelos (R2).
3. **P2 (demo)**, **P3 (etiquetado y eval)**, **P4 (en vivo con cola)** y **P5 (brief)**, en ese orden.

## Complexity Tracking

| Decisión | Por qué hace falta | Alternativa más simple descartada |
|---|---|---|
| Dos procesos en la Pi (`ingest` y `server`) | Si el servidor se cae o se reinicia, no se pierden datos ni aparecen caídas falsas, que se convertirían en candidatos falsos | Un solo proceso: un fallo del panel crearía gaps falsos |
| Bucle del agente propio en vez del Tool Runner | Traza paso a paso con tokens y coste, y no depender de que Ollama acepte las rutas beta | El Tool Runner del SDK: oculta el bucle y no está comprobado contra Ollama |
| SvelteKit para el panel | Siete vistas con estado (mapa, casos, expediente, etiquetado, eval, briefs, salud) | HTML a mano: no se puede mantener con siete vistas |
