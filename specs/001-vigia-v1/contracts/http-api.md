# Contrato: API HTTP del servidor

La sirve `Bun.serve`, junto con los archivos estáticos del panel (`panel/build`). Todo es JSON salvo `/api/stream`, que es SSE.

**Modos** (`VIGIA_MODE`):
- `live`: local, todo permitido;
- `replay`: la demo; solo lectura, salvo cambiar la velocidad del replay;
- `public`: el despliegue en la Pi; solo lectura.

En `replay` y `public`, el **servidor** responde 403 a todo lo marcado como ✎ (R13).

| Método y ruta | Uso | ✎ | Notas |
|---|---|---|---|
| `GET /api/meta` | Modo, si el modelo está disponible, presupuesto del mes y aviso | | El panel lo pide al cargar |
| `GET /api/stream` | SSE: `positions` (1 Hz), `candidate`, `dossier`, `health` | | En replay, emite según el reloj del replay |
| `GET /api/vessels/:mmsi` | Ficha del buque y su último rastro | | |
| `GET /api/candidates?state=&verdict=&from=&to=&page=` | Lista de casos, la más reciente primero | | Paginada, 50 por página. `state` admite varios separados por comas; sin él, todo menos `detected` y `discarded`. `verdict` es el del último expediente. `from` y `to` (fecha o fecha-hora ISO, UTC) filtran por el inicio del gap |
| `GET /api/candidates/:id` | Candidato, sus versiones de expediente, las pruebas y la traza | | En `/label` no se usa hasta que exista la etiqueta |
| `POST /api/candidates/:id/reinvestigate` | Encola una reinvestigación (opcional: `{profile}`, `local` por defecto) | ✎ | Respeta el tope. 202 con `{queued, profile, position}` |
| `GET /api/label/next` | Siguiente candidato sin etiquetar, por orden cronológico | | **No incluye el veredicto del agente** |
| `POST /api/labels` | `{candidate_id, value, note?}` | ✎ | Responde con el veredicto del agente (ya se puede revelar) |
| `GET /api/coverage?hour=` | Celdas y su `ratio`, para la capa del mapa | | |
| `GET /api/health?from=&to=` | Minutos de ingesta y caídas | | |
| `GET /api/eval/reports` | Informes, el último primero | | |
| `GET /api/briefs` · `GET /api/briefs/:date` | Briefs | | |
| `POST /api/replay/speed` | `{speed: 1\|10\|60\|300}` | Solo en `replay` | |

**Formas:** las de `src/shared/api.ts`, que comparten servidor y panel. Las horas son milisegundos UTC y los costes, USD.

**Errores:** `{error: {code, message}}`, con 400 si no valida, 403 si el modo lo prohíbe, 404 si no existe y 409 si ahora no se puede: `invalid_state` (el estado del candidato no lo permite), `no_api_key`, `over_budget`.
