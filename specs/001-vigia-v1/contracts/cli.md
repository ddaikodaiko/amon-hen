# Contrato: comandos (`package.json` → `bun run …`)

| Comando | Qué hace | Necesita |
|---|---|---|
| `bun run demo` | Compila el panel si hace falta y levanta el servidor en modo `replay` sobre `demo/vigia-demo.sqlite`. Abre `http://localhost:4250` | Nada: ni keys ni red (FR-024) |
| `bun run ingest` | Proceso 24/7: aisstream → SQLite + archivo crudo por horas + salud | `AISSTREAM_KEY` |
| `bun run server` | Panel, API, SSE, detector, cobertura y la cola del agente (modo `live`, o `public` con `VIGIA_MODE`) | La base de la ingesta. Para investigar: un perfil de modelo alcanzable |
| `bun run eval [--profile local\|haiku\|sonnet]` | Reinvestiga los casos etiquetados con ese perfil (respetando el tope) y guarda un informe | Etiquetas; el perfil |
| `bun run brief [--date YYYY-MM-DD]` | Genera la parte determinista del brief y, si hay modelo, la narrativa | La base |
| `bun run record --from <ISO> --to <ISO> --kind demo\|eval --out <ruta>` | Exporta una ventana a una base aparte; para la demo, reduce a una posición por minuto | La base y el archivo crudo |
| `bun run demo:build --from <ISO> --to <ISO>` | `record --kind demo` + investiga todos los candidatos + briefs + informe de eval → `demo/vigia-demo.sqlite` (50 MB como mucho) | Un perfil de modelo |
| `bun test` | Todas las pruebas, sin red ni keys | Nada |

**Variables de entorno** (`.env`, fuera del repo):

| Variable | Para qué | Por defecto |
|---|---|---|
| `AISSTREAM_KEY` | Ingesta | — |
| `GFW_TOKEN` | Herramienta de Global Fishing Watch | — |
| `ANTHROPIC_API_KEY` | Solo para los perfiles de pago | — |
| `VIGIA_LOCAL_URL` | Ollama | `http://pc-casa:11434` |
| `VIGIA_LOCAL_MODEL` | Modelo local | `qwen3:8b` |
| `VIGIA_ESCALATE_PROFILE` | Perfil de escalado | `none` |
| `VIGIA_BUDGET_USD` | Tope mensual de pago | `0` |
| `VIGIA_MODE` | `live`, `replay` o `public` | — |
| `VIGIA_DB` | Ruta de la base | `data/vigia.sqlite` |
| `VIGIA_BRIEF_HOUR` | Hora del brief | `8` |
