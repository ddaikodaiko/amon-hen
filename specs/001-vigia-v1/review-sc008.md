# SC-008: revisión de 10 expedientes (T073)

**SC-008:** en una revisión de 10 expedientes al azar, cada veredicto se puede justificar solo con las pruebas que cita.

## Cómo se revisa

- **Criterio:** se leen solo los pasos que cita el expediente, con lo que devolvió la herramienta en cada uno, y se mira si bastan para el veredicto y su confianza. Hay tres resultados:
  - **Sí:** el veredicto, la confianza y lo que dice de cada prueba cuadran con lo que muestra.
  - **A medias:** el veredicto se sostiene con alguna prueba citada, pero la explicación lee mal otra, calla algo en contra que está en un paso citado o pone más confianza de la que dan las pruebas.
  - **No:** con lo citado no se llega a ese veredicto.
- **Muestra:** 10 expedientes sacados con un generador congruencial con semilla 20261021 (el script vuelve a dar los mismos). Salen de los 26 de 178 cuya última llamada cabía de sobra en 4.096 tokens (3.700 o menos, estimados). Los demás los recortó Ollama sin avisar antes del arreglo del contexto (R1, T031), y revisarlos juzgaría ese fallo, que ya está corregido, y no al agente.
- **Sesgo de la muestra:** son las investigaciones cortas. Los 10 son `coverage_gap` y 9 son barcos parados en la bahía del Neva o en el puerto de San Petersburgo. Los dos `likely_dark` de la base (39 y 140) se pasaban de 4.096 y no entran. La revisión no dice nada de cómo justifica el agente un `likely_dark`.

## Primera pasada: agente `e4a0d837bb04` (expedientes del 2026-10-20)

| Exp. | Barco y gap | Veredicto | ¿Se justifica? | Por qué |
|---|---|---|---|---|
| 11 | KAPITAN M. IZMAYLOV, amarrado, 91 min | coverage_gap, high | A medias | Los 15 vecinos callaron (paso 3), pero la prueba del paso 2 dice "cobertura mala" y la celda no tiene ni un minuto medido (las vecinas, 6). Sin cobertura medida, `high` sobra. |
| 15 | BREMEN, amarrado, 36 min | coverage_gap, medium | Sí | 8 de 9 vecinos callaron y el único que siguió estaba a 9,4 mn. Dice bien que la muestra de cobertura es pequeña. |
| 16 | BREMEN, amarrado, 36 min | coverage_gap, medium | Sí | Los 5 vecinos callaron; la ingesta, sin caídas. |
| 28 | Clase B sin nombre, parado, 101 min | coverage_gap, medium | Sí | Los 15 vecinos callaron. La explicación reconoce que la cobertura no basta para decidir. |
| 31 | NEVA-LEADER 3, amarrado, 63 min | coverage_gap, medium | A medias | 15 de 18 vecinos callaron, pero en ese mismo paso SOLSTRAUM, a 1 mn, siguió emitiendo, y la explicación no lo menciona. |
| 43 | VOLGO-DON 195, parado, 54 min | coverage_gap, high | A medias | Lee "0 % de 5 minutos (muestra demasiado pequeña)" como mala recepción. El veredicto se sostiene con 15 de 16 vecinos callados, pero no con `high`. |
| 48 | RUSLANA, amarrado, 30 min | coverage_gap, high | A medias | Cita bien "14 % de 14, muestra pequeña", pero la explicación lo convierte en "cobertura mala". Los 11 vecinos callaron. |
| 59 | KAILEEN, en marcha a 15 nudos, 41 min | coverage_gap, high | A medias | Ni la celda ni las de alrededor tienen nada medido, y la explicación dice "cobertura mala". Solo hay 4 vecinos, todos callados: da para `coverage_gap` con poca confianza, no con `high`. |
| 143 | NEVA-LEADER 3, amarrado, 30 min | coverage_gap, high | **No** | Se apoya en una "cobertura mala" que no está medida. Cita como prueba el paso 5, en el que ALLEK, a 0,2 mn, siguió emitiendo. Con lo citado, lo que toca es `inconclusive` o `coverage_gap` con confianza baja. |
| 152 | VASILII NIKITIN, amarrado, 51 min | coverage_gap, high | A medias | Los 15 vecinos callaron, pero la explicación dice "cobertura mala" sin nada medido. |

**Resultado:** 3 sí, 6 a medias y 1 no. **SC-008 no se cumple** con esta versión del agente.

## Lo que falló

1. **Una cobertura sin medir, leída como mala (6 de 10: 11, 43, 48, 59, 143 y 152).** `get_coverage` mide la recepción con los barcos en marcha que pasan por la celda. Con unas 25 h grabadas, en los 10 casos la celda se queda por debajo de los 30 minutos esperados de la muestra mínima, y en 4 no tiene ninguno. El modelo leyó "no pasó ningún barco en marcha" y "muestra demasiado pequeña" como mala recepción. Son justo los 6 expedientes con `high`: el error de lectura es lo que infla la confianza.
2. **Un vecino cercano que siguió emitiendo, sin explicar (31 y 143).** Es la prueba más fuerte en contra de un hueco de cobertura, y en los dos casos está en un paso que el propio expediente cita.
3. **`get_track` perdía la posición que cierra el gap (8 de 10).** El resumen del caso da las horas al segundo y las posiciones guardan sus milisegundos. Si el modelo pedía el rastro hasta el final del gap tal como lo dice el resumen (`to: …:48:47Z`), la posición de las `…:48:47.609` quedaba fuera. Le llegaba una sola posición y "ningún silencio de 5 min o más": no veía el gap que investigaba. En el 59 tampoco vio que el barco había reaparecido 6 mn al este a 9,5 nudos, que encaja con un tránsito normal.
4. **"Recibió al menos 0 mensajes por minuto" (11, 15, 16 y 28).** El 2026-10-20 entre las 09:00 y las 10:46 UTC hubo minutos sueltos sin mensajes (09:38 y 10:00), y de 09:23 a 09:25 llegaron entre 87 y 141 por minuto en lugar de unos 2.500. Ninguno llega a caída (2 min seguidos). El resumen era cierto, pero se contradecía. No cambió ningún veredicto: una caída de un minuto no explica un gap de 30.

## Qué se cambió tras la primera pasada (agente `632829c2a0a2`)

- **`get_track`:** `to` incluye su segundo entero (hasta las `…:47.999`), así que el gap pedido tal como lo da el resumen trae la posición que lo cierra. Cambiado también en el contrato de herramientas, y con su prueba.
- **`get_coverage`:** si ni la celda ni las de alrededor llegan a la muestra mínima, el resumen termina con "Too little to tell whether reception there is good or poor."
- **`get_ingest_health`:** sin caídas pero con un minuto sin mensajes, dice "its quietest minute had no messages, a drop of under 2 min".
- **`system.md`:**
  - una cobertura con muy poca muestra, o sin ella, no está medida, ni buena ni mala;
  - si un vecino cercano siguió emitiendo, la explicación tiene que decir cómo encaja;
  - `high` no vale con la cobertura sin medir.
- **El prompt no crece.** El system y las herramientas pasaron de unos 2.280 tokens a 2.440 con las tres reglas, y un caso de las pruebas ya no cabía en los 4.096 por defecto. Se quitó lo repetido: "How to finish" copiaba las descripciones del esquema de `submit_verdict` (de 1 a 4 frases, de 1 a 5 pruebas, 160 caracteres) y la regla del vecino repetía lo que ya dice `get_nearby`. Ahora ocupan 2.253, menos que antes, y el caso de las pruebas cabe desde 3.997 tokens, frente a 4.029 antes del cambio.

## Segunda pasada: los mismos 10 con el agente `632829c2a0a2`

Investigados de nuevo el 2026-10-21 con `qwen3:8b` en el PC, contexto de 16.384 tokens, sin escalado y sobre una copia de la base (los expedientes nuevos no están en `data/vigia.sqlite`). La cobertura es la de la base de ese día, así que cambian dos cosas a la vez: el agente y unas horas más de datos.

| Exp. (antes) | Barco | Veredicto | ¿Se justifica? | Por qué |
|---|---|---|---|---|
| 179 (11) | KAPITAN M. IZMAYLOV | coverage_gap, low | Sí | Dice que la cobertura no está medida y que los 15 vecinos callaron. Con eso, confianza baja. |
| 180 (15) | BREMEN | coverage_gap, medium | Sí | Ahora ve el gap de 36 min en el rastro. Muestra pequeña, dicha como tal; los 8 vecinos callaron. |
| 181 (16) | BREMEN | coverage_gap, medium | Sí | Pide la cobertura de las 10 UTC, la hora del gap (antes, la de las 9). Los 15 vecinos callaron. |
| 182 (28) | Clase B sin nombre | coverage_gap, high | A medias | Todo lo que dice de cada prueba es cierto, y la propia explicación reconoce que la cobertura no se puede valorar. Con eso no toca `high`. |
| 183 (31) | NEVA-LEADER 3 | coverage_gap, high | Sí | La celda tiene poca muestra, pero alrededor sí está medida: un 49 % de 35 minutos. Callaron 19 de 20 vecinos, y el único que siguió estaba a 6,9 mn. `high` queda en el límite. |
| 184 (43) | VOLGO-DON 195 | inconclusive, medium | A medias | `inconclusive` encaja con lo citado, pero lee "20 % de 10 minutos (muestra demasiado pequeña)" como zona de mala recepción y no dice nada de SOLSTRAUM, que a 0,4 mn siguió emitiendo. |
| 185 (48) | RUSLANA | coverage_gap, medium | Sí | Muestra pequeña, dicha como tal; callaron 13 de 15, los cinco más cercanos también; el primero que siguió emitiendo estaba a 2,3 mn. |
| 186 (59) | KAILEEN | coverage_gap, high | A medias | Ahora ve que el barco recorrió 6,4 mn a 9,4 nudos, pero no lo usa. Sigue hablando de "baja cobertura" sin nada medido y pone `high` con 4 vecinos. |
| 187 (143) | NEVA-LEADER 3 | coverage_gap, medium | A medias | Ya no se inventa una mala cobertura y baja la confianza, pero sigue sin decir nada de ALLEK, que a 0,2 mn siguió emitiendo. |
| 188 (152) | VASILII NIKITIN | coverage_gap, low | A medias | Pide la cobertura de las 12 UTC para un gap de 07:53 a 08:44. A las 8 tampoco hay nada medido, así que no cambia el veredicto, pero la prueba citada no es la del gap. |

**Resultado:** 5 sí, 5 a medias y 0 no, frente a 3, 6 y 1. Leer como mala una cobertura sin medir pasa de 6 a 2 casos, y `high` de 6 a 3. `get_track` enseña ya el gap en los 10.

**Lo que queda:**
- **El vecino cercano que siguió emitiendo sigue sin explicar (184 y 187).** La regla del prompt no bastó. Lo que sí funcionó con la cobertura fue decirlo en el resumen de la herramienta.
- **Muestra pequeña leída como mala (184 y 186).** En el 184, el resumen no lleva la frase nueva porque las celdas de alrededor sí tienen muestra, y el modelo se queda con la cifra de la celda.
- **Una hora equivocada (188)** y un `high` que la propia explicación desmiente (182).

**El tiempo:** cada caso tardó entre 97 y 175 s, frente a unos 13 s de media el 2026-10-20. Los tokens de cada llamada son los mismos, pero generar 80 tokens pasa de 1 s a unos 16 s. `ollama ps` da el modelo entero en la VRAM y con 16.384 de contexto. No se ha investigado: puede ser el contexto más grande con la caché en q8_0, o que el PC estuviera ocupado con otra cosa. A este ritmo, el eval de T058 con 300 casos tardaría unas 10 h.

## Qué se cambió tras la segunda pasada

- **`get_nearby`:** el resumen da la distancia del más cercano que siguió emitiendo y la del más cercano que calló: "9 other vessels …: 2 kept reporting (the closest at 0.2 nm), 7 went silent for 10 min or more (the closest at 0.1 nm)." Es solo el resumen, así que el prompt fijo no crece.
- **`agent_version` no recogía este cambio.** Era el hash del prompt, de los esquemas de las herramientas y del perfil, pero no de lo que devuelven. La tercera pasada salió con el mismo `632829c2a0a2` que la segunda aunque `get_nearby` ya respondía distinto, y el eval habría mezclado los dos agentes. Ahora el hash cubre el código que decide lo que lee el modelo: `prompts/`, `tools/`, `investigate.ts` (el resumen del caso), `loop.ts` (avisos y límites) y `model.ts` (cómo se le llama). Queda fuera lo que las herramientas usan de fuera de `src/agent`, como la cobertura y la geometría.

## Tercera pasada: 10 casos nuevos y los dos `likely_dark`

Para no ajustar el prompt y volver a medir sobre los mismos 10, esta pasada usa otra muestra: 10 candidatos al azar (el mismo generador y la misma semilla) entre los 113 que tenían expediente el 2026-10-20, sin los 10 de antes. Con 16.384 tokens de contexto ya no hace falta quitar las investigaciones largas. Fuera de la muestra se añaden los dos candidatos que alguna vez dieron `likely_dark` (427 y 453), porque la primera muestra no decía nada de ese veredicto. Los dos habían cambiado de veredicto entre una ejecución y otra.

| Exp. | Barco y gap | Antes (`e4a0d837bb04`) | Ahora | ¿Se justifica? | Por qué |
|---|---|---|---|---|---|
| 189 | AMSTELBORG, amarrado en Tallin, 30 min | coverage_gap, high | inconclusive, medium | Sí | 33 de 48 vecinos siguieron emitiendo, algunos a 0,1 mn, y la cobertura no está medida: sin las dos pruebas no puede ser `likely_dark`. Dos pruebas mal descritas: atribuye el amarre a los datos estáticos y habla de "vecinos sin problemas de ingesta". |
| 190 | AMSTELBORG, amarrado en Tallin, 48 min | coverage_gap, medium | inconclusive, medium | Sí | Lo mismo, bien dicho: 40 de 51 siguieron emitiendo, eso apunta al barco, y sin cobertura medida no llega a `likely_dark`. |
| 191 | GRANAT, fondeado, 45 min | coverage_gap, medium | inconclusive, medium | Sí | 32 de 39 callaron, pero uno a 0,4 mn siguió emitiendo. Las pruebas están mezcladas y lo dice. |
| 192 | MALIK, despacio en el puerto de San Petersburgo, 175 min | coverage_gap, high | inconclusive, low | A medias | Se apoya en "una caída de nuestra ingesta durante el gap", pero la caída fue de 11:52 a 12:02 y el gap acabó a las 11:18. |
| 193 | KOPORYE, parado, 34 min | coverage_gap, high | inconclusive, medium | Sí | 24 de 31 callaron, el más cercano también, y la cobertura no está medida. `coverage_gap` con poca confianza también valdría. Dice "zona sin actividad" donde la herramienta dice "ningún barco en marcha". |
| 194 | VIGRI, amarrado en Tallin, 60 min | coverage_gap, high | coverage_gap, low | **No** | 32 de 54 vecinos siguieron emitiendo, uno a 0,2 mn. La propia explicación dice que las pruebas están mezcladas y no concluyen, y aun así elige `coverage_gap`. |
| 195 | OSCAR, fondeado, 45 min | coverage_gap, high | coverage_gap, low | Sí, con una prueba falsa | Se justifica con lo que cita, pero "los 13 vecinos callaron" es un error de `get_nearby`: la ventana empezaba a las 17:00 y nuestra ingesta estuvo caída hasta las 17:11. |
| 196 | OMURTAG, amarrado, 33 min | coverage_gap, high | coverage_gap, medium | Sí | 17 de 26 callaron, el más cercano también; el primero que siguió emitiendo estaba a 0,9 mn. |
| 197 | KASTOR, parado, 40 min | coverage_gap, high | coverage_gap, medium | **No** | Dice que el gap coincidió con una caída nuestra, que acabó a las 16:15, dos minutos antes del gap. Lee "100 % de 1 minuto" como mala recepción, y "los 39 vecinos callaron" es el error de `get_nearby`. Su explicación dice que no se puede saber la causa y aun así da `coverage_gap`. |
| 198 | AYMAR GALACTIC, fondeado, 30 min | coverage_gap, high | inconclusive, low | A medias | Se apoya en una caída nuestra que acabó 16 minutos antes del gap, y "los 16 vecinos callaron" es el error de `get_nearby`. |
| 199 (extra) | BALT FLOT 4, petrolero, 60 min | likely_dark, medium | coverage_gap, low | **No** | El rastro trae 15 saltos imposibles (de 201 a 269 nudos) justo al volver, y 3 de los 4 vecinos también saltan: interferencia GNSS. El prompt pide no concluir `coverage_gap` así sin otra prueba, y la explicación ni lo menciona. Además cita una caída nuestra anterior al gap, y "los 4 vecinos callaron" es el error de `get_nearby`. |
| 200 (extra) | ALTAIR, remolcador, 95 min | coverage_gap, high (la primera vez, likely_dark) | inconclusive, medium | A medias | `inconclusive` encaja: alrededor sí está medida la cobertura (80 % de 41 minutos) y un barco a 0,1 mn siguió emitiendo, pero 52 de 62 callaron. Aun así lo explica con una "mala cobertura" que sale de los 4 minutos de la celda. |

**Resultado de la muestra:** 6 sí (uno con una prueba falsa), 2 a medias y 2 no. De los dos extra, 1 a medias y 1 no.

**Lo que falló:**
1. **`get_nearby` contaba como silencio de los vecinos los minutos de una caída nuestra** (195, 197, 198, 199, y la ventana del 192 también tocaba una). Si la ventana empezaba dentro de la caída, todos los vecinos parecían callados 10 min o más: "39 de 39", "16 de 16". Es un error de la herramienta que fabrica pruebas a favor de `coverage_gap`, y también lo enseñaba el panel, que usa la misma función en los datos clave del caso.
2. **Una caída nuestra fuera del gap, leída como dentro (192, 197, 198 y 199).** El modelo pide la salud de una ventana más ancha que el gap, y la herramienta da las caídas de esa ventana sin decir si tocan el gap. El detector ya descarta los gaps que se solapan con una caída nuestra, así que en un candidato esa frase no puede ser cierta.
3. **Los saltos imposibles, ignorados (199),** aunque el prompt tiene una regla para eso.
4. **Muestra pequeña leída como mala recepción (197 y 200),** las dos veces con las celdas de alrededor bien medidas, cuando el resumen no lleva la frase de "Too little to tell".
5. **Más `inconclusive`.** El agente viejo no lo dio nunca (0 de 178). Este lo da en 7 de 12. En Tallin, con la mayoría de los vecinos emitiendo, es lo que toca (189, 190). En otros casos, `coverage_gap` con confianza baja habría servido igual (193). Si es mejor o peor lo dirá el eval contra las etiquetas (T058), no esta revisión.

## Qué se cambió tras la tercera pasada

- **`get_nearby`:** los minutos de una caída nuestra no cuentan como silencio de nadie, igual que en el detector, y el resumen lo dice: "(our ingest was down 12 min of it, not counted)". Con su prueba.
- **`get_ingest_health`:** la herramienta conoce el gap que se investiga (la investigación se lo pasa, como ya le pasaba el MMSI) y, si hay caídas, dice si alguna lo toca: "None of it during the silence under investigation (16:17-16:56)." o "10 min of it during …". Con su prueba.

## Cuarta pasada: los mismos 12 con el agente `cdbd16b9129d`

| Exp. | Barco | Tercera | Cuarta | ¿Se justifica? | Por qué |
|---|---|---|---|---|---|
| 201 | AMSTELBORG, 30 min | inconclusive, medium | coverage_gap, low | **No** | 31 de 48 siguieron emitiendo, uno a 0,1 mn, y la cobertura no está medida. Solo cita a los que callaron. |
| 202 | AMSTELBORG, 48 min | inconclusive, medium | coverage_gap, low | **No** | 37 de 53 siguieron emitiendo. Habla de "baja cobertura" sin nada medido. |
| 203 | GRANAT | inconclusive, medium | coverage_gap, low | A medias | Callaron 24 de 35, y `coverage_gap` con poca confianza se sostiene, pero su propia explicación dice que no se puede saber. |
| 204 | MALIK | inconclusive, low | inconclusive, medium | A medias | La caída ya queda fuera del gap y ya no callan todos los vecinos (31 de 33). Pero la explicación dice que todo apunta a `coverage_gap`, concluye `inconclusive` y llama a la caída "durante el gap". |
| 205 | KOPORYE | inconclusive, medium | inconclusive, medium | Sí | Como en la tercera. |
| 206 | VIGRI | coverage_gap, low | coverage_gap, low | **No** | Sin los minutos de nuestra caída, 44 de 54 siguieron emitiendo, uno a 0,2 mn. Vuelve a leer como mala una cobertura sin medir. |
| 207 | OSCAR | coverage_gap, low | coverage_gap, low | Sí | La ventana ya no toca nuestra caída: no callan los 13, sino 19 de 33, entre ellos los 8 más cercanos. El primero que siguió emitiendo estaba a 2 mn. |
| 208 | OMURTAG | coverage_gap, medium | coverage_gap, medium | Sí | Como en la tercera. |
| 209 | KASTOR | coverage_gap, medium | inconclusive, medium | A medias | Sin nuestra caída, 29 de 39 siguieron emitiendo (antes, 0 de 39), y dice bien que la caída no tocó el gap. `inconclusive` encaja, pero lee "100 % de 1 minuto" como buena cobertura. |
| 210 | AYMAR GALACTIC | inconclusive, low | coverage_gap, medium | Sí | Ya no cita la caída. Callaron 18 de 21; el primero que siguió emitiendo estaba a 1 mn. |
| 211 (extra) | BALT FLOT 4 | coverage_gap, low | inconclusive, medium | Sí | Ahora habla de los saltos imposibles y de una posible interferencia GNSS, y dice bien que la caída no tocó el gap. |
| 212 (extra) | ALTAIR | inconclusive, medium | inconclusive, medium | A medias | Dice que los vecinos siguieron emitiendo y que eso apunta a un transpondedor apagado, pero callaron 53 de 61; solo siguió el más cercano. |

**Resultado de la muestra:** 4 sí, 3 a medias y 3 no. De los dos extra, 1 sí y 1 a medias.

**Lo que dice:**
- **Los arreglos de las herramientas funcionan.** Ningún expediente pone una caída nuestra dentro del gap, y los recuentos de vecinos ya no salen contaminados (1332: de 0 a 29 de 39 que siguieron emitiendo; 662: de 0 de 13 a 14 de 33). El BALT FLOT 4 por fin habla de la interferencia.
- **El resultado no mejora, por la variación del modelo.** 222, 223 y 283 tenían en las dos pasadas las mismas pruebas (ninguna caída en sus ventanas) y pasaron de `inconclusive` a `coverage_gap`. El bucle no fija la temperatura, y Ollama usa la de `qwen3:8b`, que es 0,6. Con esa variación, una revisión de 10 casos no distingue una mejora pequeña del ruido.
- **Los errores ya van en las dos direcciones.** Antes todos empujaban hacia `coverage_gap`. Ahora el 209 lee una muestra de 1 minuto como buena cobertura, y el 212 dice que los vecinos siguieron emitiendo cuando callaron 53 de 61. Las dos lecturas llevan hacia `likely_dark`.
- **Siguen igual:** una cobertura sin medir leída como mala (202 y 206) aunque el resumen diga que no se puede saber; citar solo los vecinos que dan la razón (201, 202 y 206); y un veredicto que contradice la explicación (203 y 204).

## Conclusión

**SC-008 no se cumple con `qwen3:8b`.** En las cuatro pasadas, entre 3 y 6 de cada 10 expedientes se justifican del todo con lo que citan.

La revisión sí ha encontrado seis fallos de las herramientas y del versionado, que se quedan arreglados porque eran errores con independencia del modelo:
- `get_track` perdía la posición que cierra el gap.
- `get_nearby` contaba nuestras caídas como silencio de los vecinos, y el panel también.
- `get_ingest_health` no decía si una caída tocaba el gap.
- `get_ingest_health` decía "al menos 0 mensajes".
- Las muestras sin medir no se señalaban.
- `agent_version` no veía lo que devuelven las herramientas.

Al modelo le ha servido decir las cosas en el resumen de la herramienta. Las reglas nuevas del prompt casi no se notan.

Seguir ajustando el prompt sobre estos mismos casos sería ajustarse a ellos, y con esta variación no se vería si mejora.

**Lo que queda para cerrar T073:**
1. **Decidir la temperatura del perfil local.** Con 0, cada caso da siempre el mismo expediente, y el eval y esta revisión se pueden repetir. Con la de por defecto, el eval mide también lo que el modelo cambia de una vez a otra, que la hoja de ruta quiere medir aparte ("Consistency").
2. **Repetir la revisión con el modelo que salga de T033** (`llama3.1:8b` y `granite3.3:8b` contra `qwen3:8b`), en una muestra nueva y con los expedientes del eval, que ya tendrán el `agent_version` definitivo.
3. **Si ningún modelo local llega**, una opción es que `submit_verdict` rechace lo que se puede comprobar en la traza. Ya se hace con los pasos citados (R4). Por ejemplo, `high` sin cobertura medida, o `coverage_gap` cuando la mayoría de los vecinos siguió emitiendo. La otra es medir SC-008 con Haiku (T074).
