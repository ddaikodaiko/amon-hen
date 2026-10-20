# Contrato: comandos (`package.json` → `bun run …`)

| Comando | Qué hace | Necesita |
|---|---|---|
| `bun run demo [--db <ruta>]` | Compila el panel si hace falta y levanta el servidor en modo `replay` sobre `demo/vigia-demo.sqlite` (u otra base con `--db`), en solo lectura y sin leer `.env`. Abre `http://localhost:4250` | Nada: ni keys ni red (FR-024) |
| `bun run ingest` | Proceso 24/7: Digitraffic (MQTT) → SQLite + archivo crudo por horas + salud | Internet; no pide key |
| `bun run ingest --from-archive <dir> [--from <ISO> --to <ISO>]` | Importa el archivo crudo a SQLite por el mismo camino que la ingesta en vivo. Sirve para trabajar sin la Pi | El archivo crudo |
| `bun run server` | Panel, API, SSE, detector, cobertura y la cola del agente (modo `live`, o `public` con `VIGIA_MODE`) | La base de la ingesta. Para investigar: un perfil de modelo alcanzable |
| `bun run investigate [--ids 1,2] [--all-pending] --profile local\|haiku\|sonnet` | Pone al día el detector y la cobertura, y luego investiga esos candidatos, o todos los que esperan, por orden y con ese perfil (respetando el tope). Se para si el modelo no responde o no hay presupuesto. Para desarrollar y para la prueba de modelos | La base; el perfil |
| `bun run eval [--profile local\|haiku\|sonnet] [--fresh]` | Con `--profile`, reinvestiga los casos etiquetados con ese perfil solo, sin escalar, respetando el tope; no repite los que ya tienen un expediente de esa misma versión del agente, salvo con `--fresh`. Se para si el modelo no responde o si se pasaría del tope. Sin perfil, usa el último expediente de cada caso. Guarda un informe y lo imprime | Etiquetas; el perfil, si se da |
| `bun run brief [--date YYYY-MM-DD] [--no-narrative]` | Genera (o vuelve a generar) la parte determinista del brief de ese día, por defecto el de hoy en Madrid. Cubre desde el brief del día anterior hasta las `VIGIA_BRIEF_HOUR` de Madrid: 24 h, o 23 y 25 los días de cambio de hora. Si el modelo responde, escribe también la narrativa; si no, la escribe el servidor en vivo cuando vuelva | La base; el modelo local, para la narrativa |
| `bun run record --from <ISO> --to <ISO> --kind demo\|eval --out <ruta>` | Exporta una ventana a una base aparte; para la demo, reduce a una posición por minuto | La base y el archivo crudo |
| `bun run demo:build --from <ISO> --to <ISO>` | Investiga en la base principal, con los datos completos, los candidatos de la ventana sin expediente → `record --kind demo` → copia los briefs y el informe de eval → `demo/vigia-demo.sqlite` (50 MB como mucho) | Un perfil de modelo |
| `bun run dev:db [--out data/dev.sqlite]` | Crea una base de desarrollo con los rastros sintéticos de las pruebas y casos investigados por modelos de guion, uno en cada estado. Para trabajar en el panel sin modelo: `VIGIA_DB=data/dev.sqlite bun run server` | Nada |
| `bun test` | Todas las pruebas, sin red ni keys | Nada |
| `bun run check` | `tsc --noEmit` y `bun test`; se pasa antes de cada commit | Nada |

**Variables de entorno** (`.env`, fuera del repo):

| Variable | Para qué | Por defecto |
|---|---|---|
| `GFW_TOKEN` | Herramienta de Global Fishing Watch | — |
| `ANTHROPIC_API_KEY` | Solo para los perfiles de pago | — |
| `VIGIA_LOCAL_URL` | Ollama | `http://pc-casa:11434` |
| `VIGIA_LOCAL_MODEL` | Modelo local | `qwen3:8b` |
| `VIGIA_ESCALATE_PROFILE` | Perfil de escalado | `none` |
| `VIGIA_BUDGET_USD` | Tope mensual de pago | `0` |
| `VIGIA_MODE` | `live`, `replay` o `public` | — |
| `VIGIA_DB` | Ruta de la base | `data/vigia.sqlite` |
| `VIGIA_BRIEF_HOUR` | Hora del brief | `8` |
