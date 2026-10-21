# Pendientes

Actualizado el 2026-10-21, después de publicar el repo como Amon Hen. El detalle de cada tarea está en [`specs/001-vigia-v1/tasks.md`](../specs/001-vigia-v1/tasks.md), y el panorama completo en [`roadmap.md`](roadmap.md).

## Antes de meterlo en el CV

1. **Arrancar la grabación,** en la Pi o, mientras tanto, en el PC. Los datos acaban el 2026-10-20 a las 17:15: ahora mismo no se graba nada, y sin grabación no hay casos que etiquetar.
2. **Arreglar una contradicción que se ve en el GIF del caso** (BALT FLOT 4, `docs/media/case.gif`). El bloque "What the data says" dice "3 of 3 kept transmitting", y el veredicto del analista dice que callaron 9 de 12. Seguramente cada uno usa una ventana o un radio distintos al llamar a `get_nearby`: el panel desde `src/server/case-context.ts`, el agente desde la traza. Hay que alinearlos o, si ambas cifras son válidas, decir en el panel qué ventana usa. Después, regrabar el GIF.
3. **Fijar el repo en el perfil de GitHub.**

## Para el CV

**Se puede afirmar:**
- Un sistema completo sobre datos reales: grabadora AIS, detector, cobertura medida, agente y panel.
- Un agente con herramientas que cita sus pruebas, validadas contra la traza, con un modelo local en una GPU propia.
- Un método de evaluación: etiquetado a ciegas, una regla ingenua como referencia, intervalos de Wilson y una regla de parada fijada de antemano.
- La revisión de los expedientes descubrió que las herramientas, no el modelo, daban pruebas falsas, y se arreglaron (`specs/001-vigia-v1/review-sc008.md`).

**Todavía no se puede afirmar:**
- Ninguna precisión.
- Que detecte barcos con el transpondedor apagado. De 178 casos salió uno, y se desdijo al repetirlo.
- Que funcione 24/7.

Si preguntan por la precisión, la respuesta es: "aún no está medida; este es el método, y esto es lo que encontré revisando los expedientes".

**Entrada propuesta:**

> **Amon Hen**: analista de IA para vigilancia marítima (OSINT) · github.com/ddaikodaiko/amon-hen
> - Graba el AIS público del golfo de Finlandia, detecta los barcos que dejan de emitir, y un agente LLM con herramientas investiga cada caso. Cada veredicto cita sus pruebas y conserva la traza completa.
> - Funciona con un modelo local (Ollama, `qwen3:8b`) y puede escalar a Claude con un tope de gasto. Hecho con Bun, SQLite y SvelteKit, con un mapa 3D en MapLibre.
> - Se evalúa sobre etiquetas a ciegas, frente a una regla ingenua y con intervalos de confianza. La revisión de los expedientes destapó seis fallos en las herramientas del agente.

## Camino crítico de la v1

| # | Qué | Necesita |
|---|---|---|
| 1 | La Pi grabando 24/7, con el servidor y el brief (T001, T002, T064, T065, T071) | La Pi |
| 2 | Averiguar por qué el PC va unas 10 veces más lento (100-175 s por caso, frente a ~13 s el 2026-10-20) | El PC |
| 3 | Fijar la temperatura del perfil local (ahora 0,6, la de `qwen3:8b`; 3 de 12 casos cambiaron de veredicto con las mismas pruebas) y comparar `qwen3:8b`, `llama3.1:8b` y `granite3.3:8b` (T033) | El PC |
| 4 | Etiquetar a ciegas hasta la regla de parada: 100 casos con al menos 15 *likely dark*, o 300 (T057) | Marcos, en varias sesiones. Con 1 *likely dark* de 178, lo más probable es llegar a 300 |
| 5 | El eval: precisión y recall frente a la regla de 60 min, con intervalos (T058) | Los pasos 3 y 4 |
| 6 | Repetir la revisión SC-008 con el modelo elegido y una muestra nueva (T073) | El paso 3 |
| 7 | La demo final (T077), probarla en un clon limpio sin red (T049) y poner las cifras en el README (T072) | El paso 5 |
| 8 | La demo pública en un VPS (T078) y el conjunto etiquetado como descarga (T075) | Un VPS y la confirmación de Marcos para publicar los datos |

**Opcionales dentro de la v1:**
- La comparación de pago con Haiku y Sonnet, con un tope de 10 € (T074). Necesita que se decida el presupuesto.
- La herramienta de Global Fishing Watch (T032). Necesita un token gratuito.

## Después de la v1

1. **Saber cuándo fiarse:** la consistencia entre ejecuciones y la calibración de la confianza.
2. **Ver más:** un segundo feed AIS y las detecciones de radar de Sentinel-1.
3. **Detectar más que silencios:**
   - barcos lentos sobre cables y gasoductos;
   - encuentros en alta mar;
   - la interferencia GNSS como alerta propia, con datos que ya da `jumping_count`;
   - las listas de sanciones.
4. **Que funcione solo:** avisos al móvil, copias de seguridad fuera de la máquina y autenticación.

## Limpieza local

- `refs/original/` guarda el historial de antes de quitar las líneas de coautor (2026-10-21). No se sube a GitHub. Cuando ya no haga falta: `git for-each-ref --format='%(refname)' refs/original | xargs -n1 git update-ref -d`.
