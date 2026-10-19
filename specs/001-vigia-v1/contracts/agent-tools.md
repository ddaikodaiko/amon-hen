# Contrato: herramientas del agente

Es el contrato más importante del proyecto. El modelo solo ve estas herramientas, y cada llamada queda en `trace_steps`. Los nombres, las descripciones y las salidas van en inglés (FR-030). Las entradas se validan con zod antes de ejecutar nada. Si una entrada no valida, la herramienta devuelve `is_error: true` con el motivo y el intento cuenta como paso.

**Límites por investigación:**
- 10 llamadas a herramientas como mucho;
- 1 aviso si el modelo termina sin `submit_verdict`;
- 2 reintentos si el veredicto no valida.

`tool_choice` va siempre en `auto`, porque en los modelos 5.5 no se puede forzar (ver R3).

| Herramienta | Entrada | Salida (resumen) | Fuente |
|---|---|---|---|
| `get_track` | `mmsi`, `from`, `to` (ISO 8601, ventana de 6 h como mucho) | Hasta 120 puntos `{t, lat, lon, sog, cog, nav_status}` + un resumen: velocidad media, rumbo dominante y distancia recorrida + `identity_conflicts`: posiciones seguidas que implican más de 50 nudos (posible MMSI duplicado o suplantado) | `positions` |
| `get_coverage` | `lat`, `lon`, `hour_utc` | `{cell_id, ratio, expected_min, sample_ok, neighbors_avg_ratio}`, sin la contribución del barco investigado (R6) | `coverage` |
| `get_vessel` | `mmsi` | `{name, type_label, flag, class, length_m, destination, last_static_at}` o `unknown` | `vessels` |
| `get_nearby` | `lat`, `lon`, `at` (ISO), `radius_nm` (1-20, por defecto 10), `window_min` (por defecto 30) | `{vessels: [{mmsi, name, distance_nm, kept_reporting: boolean}], silent_count, reporting_count, jumping_count}`. `jumping_count`: vecinos con saltos de posición imposibles en la ventana (interferencia GNSS) | `positions` |
| `get_ingest_health` | `from`, `to` | `{outages: [{start, end}], min_msg_per_min}` | `ingest_minutes` y `outages` |
| `get_gfw_events` | `mmsi`, `from`, `to` | `{events: [{type: gap\|encounter\|loitering, start, end, lat, lon}]}` o `{unavailable: reason}` | API de GFW v3 |
| `submit_verdict` | ver abajo | Termina la investigación | — |

## `submit_verdict`

```ts
// zod (la forma; los nombres exactos se fijan al implementarlo)
{
  verdict: "coverage_gap" | "likely_dark" | "inconclusive",
  confidence: "high" | "medium" | "low",
  explanation: string,              // de 1 a 4 frases, en inglés y en tono de analista
  evidence: Array<{ step: number;   // índice de un paso que ya está en la traza
                    claim: string }> // qué demuestra ese paso, como mucho 160 caracteres
                                     // (hay que dar entre 1 y 5)
}
```

**Se rechaza (`is_error`) si:**
- falta alguna prueba;
- un `step` no existe en la traza;
- `verdict` o `confidence` no están en su lista.

## Escalado (FR-010)

Si el perfil por defecto da `inconclusive` y hay un perfil superior configurado con presupuesto, se repite la investigación con ese perfil. Los pasos se añaden a la misma traza, con su `model`, y el expediente final es el del perfil superior, con `escalated = 1`.

## Instrucciones del sistema (resumen; el prompt va en inglés, en `src/agent/prompts/system.md`)

- Eres un analista de inteligencia marítima. Investigas **un** gap de AIS en el golfo de Finlandia.
- Tu hipótesis de partida es que la mayoría de los gaps son huecos de cobertura. Para concluir *likely_dark* necesitas pruebas de que la cobertura era buena **y** de que los vecinos siguieron emitiendo.
- Antes de concluir, cita los pasos de la traza.
- Si `get_track` devuelve `identity_conflicts`, no concluyas *coverage_gap* sin otra prueba que lo apoye. Si muchos vecinos también saltan (`jumping_count`), es interferencia GNSS, no suplantación.
- Solo analizas buques. Nunca busques personas, tripulación ni propietarios.
