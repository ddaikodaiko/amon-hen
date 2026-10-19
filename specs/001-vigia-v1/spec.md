# Feature Specification: Vigía v1, un agente que investiga barcos oscuros en el Estrecho de Gibraltar

**Feature Branch**: `001-vigia-v1`
**Created**: 2026-10-19
**Status**: Draft
**Input**: idea.md (alcance v1 tras el consejo), consejo.md e investigacion.md. Un panel que sigue el AIS del Estrecho, registra la salud de su propia ingesta, mide la cobertura, detecta gaps con reglas y pone a un agente de IA a investigar cada uno con herramientas, dejando un expediente con veredicto, pruebas y traza. Incluye etiquetado manual, un eval contra la regla ingenua, un brief diario y un modo replay sin keys.

## Clarifications

### Session 2026-10-19

- Q: ¿Qué casos se etiquetan para el eval? → A: Todos los candidatos de la grabación, en orden cronológico y sin elegir, hasta tener 100 casos o más **y** al menos 15 *apagado probable*, con un máximo de 300. El informe da intervalos de confianza.
- Q: ¿En qué idioma van el panel, los expedientes y el brief? → A: En inglés, para llegar a r/OSINT, HN y a los reclutadores internacionales. La documentación interna (idea, spec, plan) sigue en español.
- Q: ¿Qué zonas portuarias se excluyen? → A: Solo las dársenas y los amarres, donde los barcos están atracados. Los fondeaderos sí generan candidatos, porque ahí ocurren los trasbordos y el bunkering.
- Q: ¿Qué umbral de silencio crea un candidato? → A: 30 min para la clase A en navegación y 60 min para la clase B. La regla ingenua de comparación sigue en 60 min para todos.
- Q: ¿Qué grabación va en el repo? → A: 24 h del Estrecho, reducidas a una posición por barco y minuto, como mucho 50 MB. El conjunto del eval (la grabación larga y las etiquetas) se publica como descarga aparte, no dentro del repo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Investigar un gap y leer su expediente (Priority: P1)

Un barco deja de emitir en el Estrecho y el sistema lo marca como candidato. El agente lo investiga:
- mira el rastro antes y después;
- comprueba la cobertura de esa zona a esa hora;
- consulta los datos del barco, los barcos cercanos y los eventos de Global Fishing Watch.

Después deja un **expediente** con un veredicto (*hueco de cobertura*, *apagado probable* o *no concluyente*), la confianza, las pruebas citadas y la traza completa de lo que hizo. Marcos, o quien evalúe el repo, abre el caso y entiende en menos de un minuto por qué el agente llegó a esa conclusión.

**Why this priority**: es lo que demuestra trabajo con agentes. Sin esto, el resto es otro panel más.

**Independent Test**: se prueba sobre una grabación con candidatos conocidos. Se lanza la investigación de un candidato y se comprueba que el expediente tiene un veredicto, la confianza, al menos una prueba enlazada a un paso de la traza y la traza completa con su coste.

**Acceptance Scenarios**:

1. **Given** un candidato en una zona con buena cobertura y sin caídas propias, **When** el agente lo investiga, **Then** el expediente tiene uno de los tres veredictos, la confianza, al menos una prueba citada y la traza de todos sus pasos.
2. **Given** un candidato en una celda donde se reciben pocos mensajes a esa hora, **When** el agente lo investiga, **Then** la traza incluye la consulta de cobertura y el expediente la cita como prueba.
3. **Given** que el modelo por defecto devuelve *no concluyente* y queda presupuesto, **When** termina la investigación, **Then** el caso se reinvestiga una vez con el modelo superior, y los dos intentos quedan en la traza con su coste.
4. **Given** que se ha alcanzado el tope mensual de gasto, **When** aparece un candidato nuevo, **Then** no se hace ninguna llamada al modelo y el caso queda *pendiente por tope*, visible en el panel.
5. **Given** un expediente, **When** se pulsa una prueba citada, **Then** el panel salta al paso de la traza que la respalda.

---

### User Story 2 - La demo en 5 minutos, sin keys (Priority: P2)

Un reclutador o evaluador técnico clona el repo y ejecuta un solo comando. Se abre el panel en **modo replay**:
- el tráfico del Estrecho, grabado, se reproduce en el mapa;
- la lista de casos y los expedientes ya están calculados, con sus trazas;
- también están el brief del día grabado y la página del eval.

No necesita ninguna API key ni conexión a servicios externos.

**Why this priority**: es por donde entra cualquier persona que vea el repo. Si para ver algo hacen falta tres keys, no lo ve nadie.

**Independent Test**: en una máquina limpia, sin variables de entorno y sin red, se ejecuta el comando de demo y se abre un expediente en menos de 5 minutos, contando la instalación.

**Acceptance Scenarios**:

1. **Given** un clon recién hecho, sin keys y sin red, **When** se ejecuta el comando de demo, **Then** el panel abre con el mapa, los casos, los expedientes, el brief y el eval.
2. **Given** la demo en marcha, **When** se abre un caso, **Then** se ve su expediente y su traza tal como se calcularon.
3. **Given** la demo sin key del modelo, **When** se intenta reinvestigar un caso, **Then** la acción está desactivada y se explica qué key hace falta.
4. **Given** la demo en marcha, **When** se cambia la velocidad de reproducción, **Then** los barcos y sus rastros avanzan a esa velocidad y los gaps se marcan cuando ocurren.

---

### User Story 3 - Etiquetar casos y medir al agente (Priority: P3)

Marcos etiqueta a mano los candidatos, **sin ver antes el veredicto del agente**, como *hueco de cobertura*, *apagado probable* o *indeterminable*. Después, un comando de eval compara al agente con la regla ingenua (todo gap de más de 60 min es un barco oscuro). Da la precisión y la exhaustividad de cada uno al detectar *apagado probable*, la matriz de confusión, el coste medio por caso y la comparación entre el modelo por defecto y el superior. El informe se ve como una página del panel.

**Why this priority**: es el número que se publica y el gancho del artículo. Sin eval, el agente es una opinión.

**Independent Test**: con una muestra etiquetada que cumple la regla de parada (FR-021), se ejecuta el eval y se obtiene un informe con las métricas del agente y de la regla, con sus intervalos de confianza. Al repetirlo sobre los mismos datos, las métricas de la regla salen idénticas.

**Acceptance Scenarios**:

1. **Given** un candidato sin etiquetar, **When** Marcos lo abre en la vista de etiquetado, **Then** no ve el veredicto del agente hasta haber guardado su etiqueta.
2. **Given** una muestra que cumple la regla de parada, **When** se ejecuta el eval, **Then** el informe trae la precisión y la exhaustividad (con intervalo de confianza) y la matriz de confusión del agente y de la regla, el coste medio por caso y por modelo, la fecha y la versión del agente.
3. **Given** un informe generado, **When** se abre la página del eval en el panel, **Then** se ve el último informe y el historial de los anteriores.
4. **Given** una muestra que todavía no cumple la regla de parada, **When** se ejecuta el eval, **Then** el informe sale marcado como *muestra insuficiente* y dice cuántos casos y cuántos positivos faltan.

---

### User Story 4 - Vigilancia en vivo (Priority: P4)

Con una key de AIS, el sistema ingiere en vivo el tráfico del Estrecho:
- registra la salud de su propia conexión;
- actualiza el mapa de cobertura;
- crea candidatos cuando un barco deja de emitir;
- lanza al agente sin que nadie intervenga.

El mismo modo en vivo graba los datos para poder reproducirlos después.

**Why this priority**: da los datos reales para el eval y para la demo, pero la parte de agente se puede demostrar antes con una grabación.

**Independent Test**: se conecta en vivo durante una hora, se fuerza una caída de la conexión de 10 minutos y se comprueba que los barcos aparecen en el mapa, que la caída queda registrada y que no se crea ningún candidato por esos 10 minutos.

**Acceptance Scenarios**:

1. **Given** una key válida y conexión, **When** arranca el modo en vivo, **Then** los barcos del Estrecho aparecen en el mapa y se actualizan.
2. **Given** que la propia ingesta pasa 10 minutos sin recibir mensajes, **When** se reanuda, **Then** la caída queda en el panel de salud y ningún gap que se solape con ella crea candidato.
3. **Given** un barco que navega en zona de buena cobertura y deja de emitir más tiempo del umbral, **When** se cumple la condición de disparo, **Then** se crea el candidato y el agente lo investiga sin intervención.
4. **Given** el modo en vivo en marcha, **When** se pide guardar una ventana de tiempo, **Then** queda grabada y se puede reproducir en modo replay.

---

### User Story 5 - Brief diario (Priority: P5)

Cada mañana, el sistema redacta un brief de las últimas 24 horas con:
- los casos por veredicto y los 5 más relevantes, con enlace a su expediente;
- la salud de la ingesta;
- el gasto del día.

Los briefs anteriores se consultan en el panel.

**Why this priority**: es la salida que más se lee y la que mejor queda en una captura, pero depende de que lo anterior funcione.

**Independent Test**: sobre una grabación de 24 horas con expedientes calculados, se genera el brief y se comprueba que los recuentos coinciden con los expedientes y que los enlaces llevan a casos existentes.

**Acceptance Scenarios**:

1. **Given** las 24 h anteriores con expedientes, **When** llega la hora del brief, **Then** se genera con los recuentos por veredicto, los 5 casos principales con enlace, la salud y el gasto.
2. **Given** un día sin candidatos, **When** llega la hora del brief, **Then** el brief se genera igual e indica que no hubo casos.

---

### Edge Cases

- **Se cae la propia ingesta:** todos los barcos "se apagan" a la vez. Los gaps que se solapan con una caída propia no crean candidato.
- **Un barco sale de la región:** si su última posición está junto al borde y su rumbo apunta hacia fuera, no es candidato.
- **Barcos atracados** (dársenas y amarres de Algeciras, Gibraltar, Tánger Med y Ceuta): emiten con menos frecuencia y el terreno tapa la señal, así que los gaps que empiezan ahí no crean candidato. **Los fondeaderos sí crean candidato**, porque ahí ocurren los trasbordos y el bunkering.
- **Transpondedores de clase B:** informan con menos frecuencia que los de clase A y tienen un umbral propio.
- **El mismo MMSI en dos sitios a la vez** (duplicado o suplantación): se registra en la traza y el veredicto no puede ser *hueco de cobertura* sin más pruebas.
- **El gap sigue abierto:** el agente investiga cuando el barco reaparece o cuando el gap cumple 6 horas. Si reaparece después, la reaparición se añade al expediente y se reinvestiga, guardando las dos versiones.
- **Global Fishing Watch no responde o limita las peticiones:** el agente sigue sin esa herramienta y la traza registra el fallo.
- **El modelo falla o devuelve un expediente con formato no válido:** se reintenta un número limitado de veces. Si sigue fallando, el caso queda en estado *error*, visible y reintentable.
- **El tope se alcanza a mitad de una investigación:** no se hace la llamada que lo superaría y el caso queda *pendiente por tope*.
- **El PC con el modelo se apaga a mitad de una investigación:** ese intento se descarta entero (no queda un expediente a medias), y el caso vuelve a la cola como *pendiente sin modelo*.
- **La demo pública:** es de solo lectura. Nadie de fuera puede etiquetar, reinvestigar ni gastar presupuesto.

## Requirements *(mandatory)*

### Functional Requirements

**Ingesta, salud y cobertura**

- **FR-001**: El sistema MUST ingerir en vivo los mensajes AIS de posición y estáticos de la región del Estrecho.
- **FR-002**: El sistema MUST registrar de forma continua la salud de su ingesta: estado de la conexión y mensajes por minuto. Cualquier periodo de 2 minutos o más sin mensajes MUST marcarse como caída propia.
- **FR-003**: El sistema MUST guardar los mensajes recibidos, para poder reproducir cualquier ventana de tiempo en modo replay.
- **FR-004**: El sistema MUST calcular un mapa de cobertura por celda y por hora del día: la proporción de los reportes que se esperaban de los barcos que pasan por esa celda y que realmente se recibieron.

**Detección**

- **FR-005**: El sistema MUST crear un candidato cuando un barco en navegación supera un tiempo sin emitir. El umbral depende de la clase de transpondedor (ver Assumptions).
- **FR-006**: El sistema MUST descartar como candidatos los gaps que se solapan con caídas propias, las salidas de la región y los gaps que empiezan en una dársena o zona de amarre (los fondeaderos no se excluyen). Cada descarte MUST quedar registrado con su motivo.

**Agente investigador**

- **FR-007**: El agente MUST investigar automáticamente cada candidato con estas herramientas:
  - el rastro del barco antes y después del gap;
  - la cobertura en esa celda a esa hora;
  - los datos estáticos del barco;
  - los barcos cercanos al principio y al final del gap;
  - los eventos de Global Fishing Watch de ese barco en esa ventana.
- **FR-008**: Cada investigación MUST producir un expediente con:
  - un veredicto (*hueco de cobertura*, *apagado probable* o *no concluyente*);
  - la confianza (alta, media o baja);
  - las pruebas citadas, cada una enlazada a un paso de la traza;
  - una explicación breve en lenguaje de analista.
- **FR-009**: Cada expediente MUST guardar la traza completa. Por cada paso: la herramienta, su entrada, un resumen de su salida, el modelo usado, los tokens, el coste y la duración.
- **FR-010**: El sistema MUST investigar con el modelo por defecto (local y gratuito). Si hay un modelo superior configurado y queda presupuesto, MUST reinvestigar con él una sola vez los casos *no concluyente*.
- **FR-011**: El sistema MUST medir y guardar los tokens y el coste de cada caso, y tener un tope mensual de gasto de pago configurable (0 € por defecto). Al alcanzarlo, MUST dejar de llamar a modelos de pago y marcar los casos que lo necesiten como *pendiente por tope*.
- **FR-028**: Si el modelo no está disponible (el PC apagado o sin conexión), los candidatos MUST quedar en cola como *pendiente sin modelo*. Cuando el modelo vuelva, MUST investigarse por orden de llegada sin perder ninguno.
- **FR-029**: El mismo agente MUST poder ejecutarse contra distintos modelos cambiando solo la configuración, para comparar en el eval el modelo local con los de pago.
- **FR-012**: Si una herramienta falla, el agente MUST continuar sin ella y registrar el fallo en la traza.
- **FR-013**: Marcos MUST poder reinvestigar un caso a mano. El sistema MUST conservar todas las versiones del expediente.

**Panel**

- **FR-014**: El panel MUST mostrar un mapa con los barcos, sus rastros, los gaps marcados y una capa de cobertura que se activa y desactiva.
- **FR-015**: El panel MUST listar los casos con filtros por veredicto, estado y fecha.
- **FR-016**: El panel MUST mostrar cada expediente con su traza en pasos legibles. Cada prueba citada MUST enlazar a su paso.
- **FR-017**: El panel MUST mostrar la salud de la ingesta: las caídas y el ritmo de mensajes.

**Etiquetado y eval**

- **FR-018**: Marcos MUST poder etiquetar, en orden cronológico y sin elegir cuáles, cada candidato como *hueco de cobertura*, *apagado probable* o *indeterminable*, con una nota opcional. El veredicto del agente MUST permanecer oculto hasta que se guarde la etiqueta.
- **FR-019**: Las etiquetas del eval MUST ser humanas. Ninguna etiqueta MUST derivarse de las fuentes que usa el agente.
- **FR-020**: Un comando de eval MUST calcular, sobre los casos etiquetados, la precisión y la exhaustividad (cada una con su intervalo de confianza del 95 %) y la matriz de confusión del agente y de la regla ingenua (todo gap de más de 60 min es *apagado probable*). También el coste medio por caso y por modelo. El informe MUST guardarse con la fecha y la versión del agente.
- **FR-021**: Regla de parada de la muestra: se etiqueta hasta tener 100 casos o más **y** al menos 15 *apagado probable*, o hasta llegar a 300 casos. Mientras no se cumpla, el informe MUST marcarse como *muestra insuficiente*. Si se llega a 300 sin 15 positivos, el informe MUST publicarse indicando que los positivos son raros.
- **FR-022**: El panel MUST mostrar el último informe del eval y el historial.

**Brief**

- **FR-023**: El sistema MUST generar cada día, a una hora configurable, un brief de las últimas 24 h con:
  - los recuentos por veredicto;
  - los 5 casos principales con enlace;
  - la salud de la ingesta;
  - el gasto del día.

  Los briefs anteriores MUST poder consultarse.

**Replay y demo**

- **FR-024**: Un único comando de demo MUST levantar el panel en modo replay sin keys ni red. Usa una grabación incluida en el repo y los expedientes, briefs e informe de eval ya calculados.
- **FR-025**: En modo replay, el tráfico MUST reproducirse con velocidad ajustable.
- **FR-026**: Las acciones que necesitan keys o gastan presupuesto MUST estar desactivadas en la demo y en el despliegue público (solo lectura), con una explicación.

**Idioma**

- **FR-030**: La interfaz del panel, los expedientes (veredicto, explicación y pasos de la traza), el brief y el README MUST estar en inglés.

**Ética**

- **FR-027**: El sistema MUST usar solo lo que emiten los propios barcos por AIS y las fuentes abiertas indicadas. No MUST buscar tripulación, propietarios ni personas. El panel MUST mostrar un aviso de proyecto educativo sin garantías.

### Key Entities

- **Mensaje AIS**: un reporte de posición o de datos estáticos recibido, con su hora de recepción.
- **Buque**: se identifica por su MMSI. Tiene nombre, tipo, clase de transpondedor y dimensiones, si los ha emitido.
- **Caída propia**: un periodo en el que la ingesta no recibió mensajes. Tiene inicio, fin y causa si se conoce.
- **Celda de cobertura**: una zona del mapa y una hora del día, con su proporción de reportes recibidos frente a los esperados.
- **Candidato**: un gap de un buque. Tiene inicio, fin (si lo hay), posiciones al principio y al final, estado (*pendiente*, *pendiente sin modelo*, *investigado*, *pendiente por tope*, *error* o *descartado*) y motivo de descarte.
- **Expediente**: el resultado de investigar un candidato. Tiene veredicto, confianza, pruebas, explicación, modelos usados, coste total y versión. Un candidato puede tener varias versiones.
- **Paso de traza**: una acción del agente dentro de un expediente. Guarda la herramienta, la entrada, el resumen de la salida, el modelo, los tokens, el coste y la duración.
- **Etiqueta**: el juicio humano sobre un candidato. Tiene valor, autor, nota y fecha.
- **Informe de eval**: las métricas del agente y de la regla, los costes, el tamaño de la muestra, la fecha y la versión del agente.
- **Brief**: el resumen diario que enlaza a los expedientes.
- **Grabación**: una ventana de mensajes guardada para el replay.
- **Presupuesto**: el tope mensual y lo gastado en el mes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Alguien que no conoce el proyecto pasa de clonar el repo a leer su primer expediente en 5 minutos o menos, sin credenciales ni red.
- **SC-002**: El 100 % de los expedientes tienen veredicto, confianza, al menos una prueba enlazada a un paso de la traza y la traza completa.
- **SC-003**: Se publica un informe de eval sobre una muestra etiquetada a mano que cumple la regla de parada (FR-021), con la precisión y la exhaustividad del agente y de la regla ingenua y sus intervalos de confianza. Al repetirlo sobre los mismos datos, las cifras de la regla salen idénticas.
- **SC-004**: Con el modelo por defecto, el gasto en API es de 0 €. Con un modelo de pago activado, el coste medio por caso es de 1 céntimo de euro o menos, y el gasto de un mes nunca supera el tope.
- **SC-005**: Con el modelo disponible, el 95 % de los candidatos tiene su expediente en los 10 minutos siguientes a que se dispare la investigación. Tras 12 horas con el PC apagado, al encenderlo se investigan todos los candidatos en cola sin perder ninguno.
- **SC-006**: En una prueba con una caída forzada de 10 minutos, no se crea ningún candidato a partir de gaps que se solapen con ella.
- **SC-007**: En una semana de funcionamiento en vivo, hay brief los 7 días, a los 15 minutos de la hora configurada como mucho.
- **SC-008**: En una revisión de 10 expedientes al azar, cada veredicto se puede justificar solo con las pruebas que cita.

## Assumptions

- **Región:** el Estrecho de Gibraltar, aproximadamente entre 35,70° N y 36,30° N y entre 6,20° W y 5,00° W. Incluye la bahía de Algeciras, Tánger Med y Ceuta. Se excluyen las dársenas y los amarres de Algeciras, Gibraltar, Tánger Med y Ceuta; sus fondeaderos no.
- **Umbrales:**
  - Es candidato un barco de clase A en navegación que pasa 30 minutos o más sin emitir. Para la clase B, 60 minutos.
  - La regla ingenua de comparación usa 60 minutos.
  - La investigación se dispara cuando el barco reaparece o cuando el gap cumple 6 horas.
- **Modelo y presupuesto:**
  - El modelo por defecto es local, con Ollama en el PC de casa (RTX 3060 Ti, 8 GB de VRAM): un modelo de 7-9B con llamadas a herramientas, que cabe entero en la GPU.
  - El PC solo está encendido a ratos y se alcanza por Tailscale. La ingesta y el panel corren 24/7 en la Pi 5.
  - La API de pago (Haiku y Sonnet) es opcional y se usa para comparar en el eval. El tope por defecto es 0 € y se puede configurar.
- **Etiquetado:** etiqueta un solo usuario, Marcos, en local y sin autenticación. El despliegue público es de solo lectura.
- **Grabación de la demo:** 24 horas del Estrecho dentro del repo, reducidas a una posición por barco y minuto (50 MB como mucho), conservando los gaps y su contexto. El conjunto del eval (la grabación larga y las etiquetas) se publica como descarga aparte. Antes de publicar cualquier grabación hay que comprobar que los términos de aisstream lo permiten.
- **Fuentes:**
  - aisstream.io con key gratuita.
  - Global Fishing Watch con token gratuito y solo uso no comercial.
  - Hasta comprobar que los términos de aisstream lo permiten, la demo pública es solo replay.
- **Zona horaria:** Europe/Madrid. La hora del brief por defecto son las 08:00.
- **Fuera de alcance en v1:** la capa satélite, las noticias (GDELT y RSS), el loitering, las concentraciones, más regiones, varios usuarios y las alertas por correo o mensajería.
