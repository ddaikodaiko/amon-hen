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

## Concurso: Create AI Agents Championship (Dubái)

Añadido el 2026-10-24. Amon Hen se presenta cuando la v1 esté completa, en la categoría **Best Youth AI Agent** (menos de 21 años al inscribirse).

**Lo esencial:** lo organiza la Dubai Chamber of Digital Economy ([web](https://dubaichamberdigital.com/en/create-ai-agents)). Cada categoría da 150.000 $ en ayudas. Es gratis, abierto a cualquier país, y todo va en inglés. La inscripción y la entrega cierran en **enero de 2027**, sin día exacto en la web. En enero salen 24 semifinalistas; en marzo hay un pitch de semifinal y se eligen 12 finalistas; la final es en Dubái la primera semana de mayo, con el agente funcionando en directo.

**El plazo no espera a la v1.** Si en enero no está completa, se presenta igual: las bases admiten un prototipo o un MVP temprano. Lo que más pesa, y depende de la v1, son las cifras del eval (paso 5 del camino crítico) y la demo pública (paso 8).

### Ahora

1. **Inscribirse.** Es gratis, no compromete a nada y da acceso a los talleres y mentorías de noviembre y diciembre.
2. **Preguntar a la organización** lo que las bases no aclaran:
   - Para cobrar hay que tener o crear una empresa en Dubái con licencia comercial (punto 1.3 de las bases). La ayuda es para terminar el agente y montar allí el negocio, y no se puede cambiar por dinero (4.1-4.3). ¿Se aplica igual en Youth?
   - El viaje y la estancia corren por cuenta propia (10.1). ¿La semifinal de marzo es presencial?
   - Los finalistas pasan un control de seguridad (punto 9).
3. **Mirar si la final de mayo choca con la FCT.**

### Cuando la v1 esté completa

| # | Entregable (en inglés) | Se parte de |
|---|---|---|
| 1 | Informe resumen, obligatorio (2.3): la idea y qué hace cada pieza del agente | El README |
| 2 | Pitch deck: el problema, el agente, las cifras del eval, la comparativa, para quién es, qué se haría con la ayuda y el equipo | El README, `roadmap.md` y el borrador en claude.ai (portada y problema): https://claude.ai/artifact/FnhWjJ5efcz67DAxro2p9R |
| 3 | Vídeo de demo: el replay del mapa, un caso de principio a fin y el eval | Los GIF de `docs/media/` y `bun run demo` |
| 4 | Prototipo: el repo y la demo pública | T078 |
| 5 | Validación: hablar con 3 a 5 analistas (puertos, aseguradoras marítimas, compliance) y anotar qué dicen. El concurso pide "customer need, business potential and measurable impact" | — |

### Antes de enviar

- **Nada de política.** Las bases excluyen el contenido político (2.5). Se presenta como un agente que distingue un fallo de cobertura de un transpondedor apagado, sin hablar de sanciones ni de flotas. Repasar el README y `roadmap.md` con ese criterio.
- **El nombre.** "Amon Hen" viene de Tolkien, y las bases no admiten imitar obras ajenas (2.4). Además, si se gana, el proyecto pasa a ser una empresa. Valorar presentarlo como Vigía.

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

## Hecho el 2026-11-03

- **Notas internas fuera de la raíz** (era el punto 3 de "Antes de meterlo en el CV" y R13 de la
  auditoría de GitHub): `consejo.md`, `idea.md` e `investigacion.md` están en `docs/proceso/`, con
  un README que las presenta como notas de proceso. Siguen en el historial de git. `CLAUDE.md` se
  queda en la raíz: solo apunta a `specs/001-vigia-v1/plan.md` y es lo que espera la herramienta.
- **Test que dependía del mes real:** el de "over the cap" pasaba en octubre y fallaba en
  noviembre, porque grababa el gasto con el reloj de los datos (`now: () => END`) y lo leía con
  `Date.now()`. Ahora el servidor acepta un reloj (`AppContext.now`) y `/api/meta` y el tope de
  gasto de `reinvestigate` lo usan. `bun run check`: 227 de 227 y `tsc` limpio (antes 226/1).
- **La contradicción del GIF de BALT FLOT 4** (punto 2): no era un fallo de datos, eran dos
  ventanas distintas. `get_nearby` devuelve ahora la ventana que usó (`window`), el panel la
  muestra junto al recuento ("between 07:39 and 08:25 UTC") y un test comprueba que la del panel
  empieza en el gap y no pasa de una hora. **Queda regrabar el GIF**, y eso necesita datos nuevos.
