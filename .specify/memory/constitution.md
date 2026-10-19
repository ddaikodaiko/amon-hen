<!--
Informe de sincronización
- Versión: 1.0.0 → 1.1.0 (MINOR: el principio V amplía su guía)
- Principio renombrado: V "Coste acotado" → "Gratis por defecto, coste acotado". El modelo es
  intercambiable, el local va por defecto en la RTX 3060 Ti y el tope por defecto es 0 €.
- Restricciones técnicas: el modelo va en el PC de casa (a ratos) y los candidatos esperan en cola
- 1.0.0: plantilla → primera ratificación, con los principios I-VI
- Secciones añadidas: Restricciones técnicas, Flujo de trabajo, Gobierno
- Plantillas:
  ✅ .specify/templates/plan-template.md (su "Constitution Check" es genérico y lee este archivo)
  ✅ .specify/templates/spec-template.md (sin secciones obligatorias nuevas)
  ✅ .specify/templates/tasks-template.md (los tipos de tarea encajan: tests, observabilidad)
- TODO pendientes: ninguno
-->

# Constitución de Vigía

## Principios

### I. Bun + TypeScript estricto
- Todo el código MUST ser TypeScript con `strict: true` y ejecutarse con Bun.
- `any` está prohibido salvo que sea inevitable, y entonces MUST llevar un comentario que lo justifique.
- Cada dependencia nueva MUST justificarse en `plan.md`: si Bun o la librería estándar lo resuelven, no se añade.

**Por qué:** es la convención de todos los proyectos de Marcos, y un repo pequeño se entiende y se defiende mejor en una entrevista.

### II. Todo lo que decide el agente es trazable
- Cada expediente MUST guardar la traza completa: cada llamada a una herramienta con su entrada, su salida, el modelo usado, los tokens y el coste.
- El veredicto MUST citar las pruebas de la traza en las que se apoya.
- El panel MUST enseñar la traza como el razonamiento de un analista, no como un volcado de JSON.

**Por qué:** el proyecto existe para demostrar trabajo con agentes. Un veredicto sin traza es una caja negra y no demuestra nada.

### III. Ninguna afirmación sin eval
- Cualquier número que se publique (precisión, exhaustividad, coste por caso, comparación entre modelos) MUST salir de `bun run eval` sobre casos etiquetados a mano.
- Las fuentes que consulta el agente (Global Fishing Watch, entre otras) MUST NOT servir como verdad del eval.
- El eval MUST compararse siempre con la regla ingenua (gap de más de 60 min).

**Por qué:** el gancho del proyecto es un número medido. Si hay fuga entre las herramientas y las etiquetas, ese número no vale.

### IV. Reproducible sin keys
- `bun run demo` MUST levantar el panel en modo replay, con datos grabados y expedientes ya calculados, sin ninguna API key ni red externa.
- Los servicios externos (aisstream, GFW, la API de Claude) solo se usan en el modo en vivo.

**Por qué:** quien evalúa el repo no va a sacar tres keys. Además, la demo no puede caerse si aisstream falla.

### V. Gratis por defecto, coste acotado
- El agente MUST funcionar con cualquier modelo compatible con la API de mensajes de Anthropic: cambiar de modelo es cambiar la URL y el nombre, no el código.
- El modelo por defecto MUST ser local y gratuito: Ollama en el PC de casa, con la RTX 3060 Ti.
- La API de pago es opcional (para comparar en el eval o escalar los casos "no concluyentes") y tiene un tope mensual que MUST cortar las llamadas. El tope por defecto es 0 €.
- Los tokens y el coste de cada caso MUST medirse y guardarse, también con el modelo local.

**Por qué:** probar no puede costar dinero. Además, comparar el modelo local con los de pago en precisión y coste es en sí un resultado que enseñar.

### VI. Datos abiertos, buques y no personas
- Solo fuentes abiertas, y siempre dentro de sus términos de uso. Global Fishing Watch es solo para uso no comercial.
- Se analizan señales de buques, nunca personas.
- El README MUST llevar un aviso de proyecto educativo, sin garantías.

**Por qué:** en defensa e inteligencia, trabajar con esta disciplina es lo que te hace contratable.

## Restricciones técnicas

- **Región única:** el Estrecho de Gibraltar. Más regiones es v2.
- **Detección:** reglas deterministas generan los candidatos; el agente investiga, no detecta.
- **Ingesta:** aisstream solo desde el backend, porque no admite conexiones desde el navegador. La salud de la ingesta MUST registrarse, y los gaps que coinciden con caídas propias se descartan.
- **Despliegue:** la ingesta, el panel y la demo pública van en la Pi 5 (24/7, con Cloudflare Tunnel). El modelo va en el PC de casa, que solo está encendido a ratos y se alcanza por Tailscale. Mientras está apagado, los candidatos esperan en cola sin perderse.
- **Secretos:** solo en variables de entorno (`.env` fuera del repo), nunca en el código.

## Flujo de trabajo

- Una tarea de `tasks.md` cada vez, con "hecho" definido antes de escribir código.
- Las pruebas van con `bun test`, y las MUST ejecutar quien implementa antes del commit.
- Si un cambio toca 3 archivos o más, pasa por `/code-review medium`.
- Commits pequeños, con la tarea marcada en `tasks.md`.

## Gobierno

- Esta constitución manda sobre cualquier otra práctica del repo. `plan.md` MUST pasar su "Constitution Check", y cada excepción se justifica en su tabla de complejidad.
- **Cambios:** se edita este archivo con `/speckit-constitution`, con versionado semántico:
  - MAJOR si se quita o redefine un principio;
  - MINOR si se añade uno;
  - PATCH si solo cambia la redacción.

**Versión**: 1.1.0 | **Ratificada**: 2026-10-19 | **Última modificación**: 2026-10-19
