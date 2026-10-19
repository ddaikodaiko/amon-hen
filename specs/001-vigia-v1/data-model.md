# Fase 1: modelo de datos (Vigía v1)

Todo se guarda en una base SQLite (`bun:sqlite`, modo WAL). Las horas son UTC en milisegundos desde epoch (`INTEGER`) y se convierten a Europe/Madrid solo en el panel y en el brief. Los costes van en dólares, que es como factura el proveedor.

## Tablas

### vessels: buques (FR-001, FR-007)
| Campo | Tipo | Notas |
|---|---|---|
| mmsi | INTEGER PK | 9 dígitos |
| name, callsign, destination | TEXT NULL | según lo que emita el barco |
| imo | INTEGER NULL | |
| ship_type | INTEGER NULL | código AIS; la etiqueta legible se calcula al mostrarla |
| ais_class | TEXT | `A` o `B` |
| length_m, width_m | REAL NULL | |
| flag_mid | INTEGER | primeros 3 dígitos del MMSI (MID → país) |
| updated_at | INTEGER | |

### positions: posiciones reducidas (FR-003, FR-007, FR-014)
| Campo | Tipo | Notas |
|---|---|---|
| mmsi | INTEGER | FK → vessels |
| ts | INTEGER | como mucho 1 cada 30 s por barco |
| lat, lon | REAL | validadas: dentro del rango y no (0,0) |
| sog, cog, heading | REAL NULL | |
| nav_status | INTEGER NULL | código AIS (0 = navegando con máquina, 1 = fondeado, 5 = amarrado…) |

Índices: `(mmsi, ts)` y `(ts)`. En vivo se guardan 30 días.

### ingest_minutes y outages: salud de la ingesta (FR-002, FR-006, FR-017)
- `ingest_minutes(minute_ts PK, connected INTEGER, msg_count INTEGER)`
- `outages(id PK, start_ts, end_ts NULL, cause TEXT NULL)`
- **Regla:** 2 minutos seguidos o más con `msg_count = 0`, o la conexión caída, cuentan como una `outage`. Tiene `end_ts` NULL mientras dura.

### coverage: cobertura por celda y hora (FR-004)
| Campo | Tipo | Notas |
|---|---|---|
| cell_id | INTEGER | `row * ncols + col` de la rejilla de 0,025° |
| hour_utc | INTEGER | 0-23 |
| expected_min | INTEGER | minutos-barco estimados (por interpolación, solo a más de 3 nudos; R6) |
| received_min | INTEGER | minutos-barco con al menos un mensaje |
| window_start, window_end | INTEGER | ventana móvil de 7 días |

`ratio = received_min / expected_min`. Si `expected_min < 30`, la muestra se marca como insuficiente.

### candidates: candidatos (FR-005, FR-006, FR-028)
| Campo | Tipo | Notas |
|---|---|---|
| id | INTEGER PK | |
| mmsi | INTEGER | |
| gap_start, gap_end | INTEGER, INTEGER NULL | `gap_end` es NULL mientras el gap sigue abierto |
| start_lat, start_lon, end_lat, end_lon | REAL (los `end_*` pueden ser NULL) | |
| ais_class, nav_status_start | | |
| state | TEXT | ver los estados abajo |
| discard_reason | TEXT NULL | `own_outage`, `left_region` o `berth` |
| trigger_at | INTEGER NULL | cuándo se disparó la investigación |
| created_at | INTEGER | |

### dossiers: expedientes (FR-008, FR-011, FR-013)
| Campo | Tipo | Notas |
|---|---|---|
| id | INTEGER PK | |
| candidate_id | INTEGER | FK. Un candidato tiene N versiones |
| version | INTEGER | empieza en 1 |
| verdict | TEXT | `coverage_gap`, `likely_dark` o `inconclusive` |
| confidence | TEXT | `high`, `medium` o `low` |
| explanation | TEXT | en inglés (FR-030) |
| profile | TEXT | `local`, `haiku` o `sonnet`; si hubo escalado, el último |
| escalated | INTEGER | 0 o 1 |
| input_tokens, output_tokens | INTEGER | suma de todos los pasos |
| cost_usd | REAL | 0 con el perfil local |
| duration_ms | INTEGER | |
| agent_version | TEXT | hash del prompt, las herramientas y el perfil |
| created_at | INTEGER | |

### evidence: pruebas citadas (FR-008, FR-016)
- `evidence(dossier_id, step_idx, claim TEXT)`. `step_idx` MUST existir en `trace_steps` de ese expediente; si no, `submit_verdict` lo rechaza.

### trace_steps: traza del agente (FR-009, principio II)
| Campo | Tipo | Notas |
|---|---|---|
| dossier_id, idx | PK compuesta | |
| kind | TEXT | `model_call`, `tool_call`, `nudge` o `error` |
| tool | TEXT NULL | |
| input_json | TEXT | la entrada de la herramienta, o el resumen de la petición al modelo |
| output_summary | TEXT | en inglés, como lo diría un analista; es lo que se muestra en el panel |
| output_json | TEXT NULL | la salida completa, recortada a 32 KB |
| model | TEXT NULL | |
| input_tokens, output_tokens | INTEGER | |
| cost_usd | REAL | |
| duration_ms | INTEGER | |
| ts | INTEGER | |

### labels: etiquetas (FR-018, FR-019)
- `labels(candidate_id PK, value TEXT, note TEXT NULL, author TEXT NOT NULL, created_at)`
- `value` es `coverage_gap`, `likely_dark` o `undeterminable`. `author` es siempre un humano; el código nunca escribe en esta tabla.

### eval_reports (FR-020, FR-021, FR-022)
- `eval_reports(id PK, created_at, agent_version, profile, n_labeled, n_positive, n_undeterminable, stopping_rule_met INTEGER, metrics_json TEXT)`
- `metrics_json` lleva, para el agente y para la regla: tp, fp, fn, tn, la precisión y la exhaustividad con su intervalo de Wilson, el coste medio por caso y el coste por perfil.

### briefs (FR-023, R11)
- `briefs(date PK 'YYYY-MM-DD', sections_json, narrative TEXT NULL, narrative_state TEXT, generated_at)`
- `narrative_state` es `pending`, `done` o `skipped`.

### budget (FR-011)
- `budget(month PK 'YYYY-MM', spent_usd REAL, cap_usd REAL)`. El tope por defecto es 0, que impide cualquier gasto de pago.

### recordings (FR-003, FR-024)
- `recordings(id PK, start_ts, end_ts, kind TEXT, path TEXT)`. `kind` es `raw_archive`, `demo` o `eval`.

## Estados de un candidato

```
detected ──► discarded                      (own_outage | left_region | berth)
detected ──► pending ──► investigating ──► investigated
                              │  ├──► error ─────────► investigating   (reintentar)
                              │  ├──► pending_no_model ─► investigating (el modelo vuelve; por orden de llegada)
                              │  └──► pending_budget ──► investigating  (mes nuevo o tope mayor)
investigated ──► investigating   (reaparece después de las 6 h, o reinvestigación a mano → expediente con version+1)
```

- `investigating` es una sola transacción lógica. Si el modelo se cae a mitad, ese intento se descarta y no queda un expediente a medias (caso límite de la spec).
- Cada vez que se entra en `investigating` se escribe un `trigger_at`.

## Reglas de validación

- Un expediente MUST tener al menos una `evidence`, y su `step_idx` MUST existir (SC-002).
- `verdict` y `confidence` MUST pertenecer a sus enumeraciones (zod en `submit_verdict`).
- `cost_usd` se calcula a partir de `usage` y del precio del perfil, nunca a partir de lo que diga el modelo.
- Una etiqueta MUST guardarse antes de que la API devuelva el veredicto del agente para ese candidato en la vista de etiquetado (FR-018).
