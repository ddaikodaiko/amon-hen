# Fase 1: investigación (2026-10-19)

> **Cambio de región (2026-10-19):** tras medir la cobertura, Vigía pasa del Estrecho de Gibraltar al golfo de Finlandia, con datos de Digitraffic. Ver `specs/001-vigia-v1/research.md`, R7. Lo de abajo es el encuadre original.

Tiempo: ~25 min. Usé `gh search`, la API de GitHub y Jina. Exa cortó a la tercera búsqueda por el límite gratuito.

## Las tres preguntas

**1. ¿Ya existe el panel?** Sí, y muy grande.

| Proyecto | ★ | Qué hace | Qué no hace |
|---|---|---|---|
| [koala73/worldmonitor](https://github.com/koala73/worldmonitor) | 88,8k | Panel global en TypeScript (AGPL). Ingiere AIS por aisstream, vigila chokepoints y marca "dark ships" con un gap de más de 60 min ([docs](https://github.com/koala73/worldmonitor/blob/main/docs/maritime-intelligence.mdx)) | La regla es ingenua: con AIS terrestre, la mayoría de gaps son huecos de cobertura. Su propio mantenedor lo reconoce en el [issue #6225](https://github.com/koala73/worldmonitor/issues/6225): *"we do nothing with AIS gaps… the single biggest hole in our maritime coverage"* |
| [simplifaisoul/osiris](https://github.com/simplifaisoul/osiris) | 11k | Panel OSINT global con un asistente que "habla con el mapa" | Lo marítimo son puertos y chokepoints estáticos |
| [tg12/phantomtide](https://github.com/tg12/phantomtide) | 128 | Inteligencia marítima y aérea, con filas de "dark-vessel" y sanciones | Sin licencia. Las capas buenas son "premium" |
| Repos de estudiante de 2026 (SAR + AIS, *dark vessel detection*) | 0-4 | Detección con Sentinel-1 y YOLO en Ormuz, Dinamarca… | Son notebooks, no productos, y nadie los usa |
| [Global Fishing Watch](https://globalfishingwatch.org/our-apis/documentation) | — | Calcula eventos de gap, encounter y loitering con AIS terrestre y de satélite. API con token gratuito | **Solo uso no comercial.** Es una fuente, no un competidor |

**Conclusión:** competir en amplitud (mapa + satélite + noticias) es perder contra worldmonitor.

**2. ¿Hay agentes que investiguen anomalías AIS?** **No.** Busqué "AIS LLM agent", "maritime agent LLM", "vessel anomaly LLM" y "dark vessel agent" en GitHub, y no hay **ningún resultado**. Lo único parecido es un repo coreano con 0★ (Maritime-OSINT-sentry). Los paneles grandes usan el LLM para resumir noticias o para manejar el mapa, no para investigar un caso con herramientas y medirse.

**3. Las fuentes y sus límites**

| Fuente | Qué da | Límite |
|---|---|---|
| [aisstream.io](https://aisstream.io/documentation) | AIS en vivo por WebSocket, con API key | El **bounding box es obligatorio** y se pueden filtrar hasta 200 MMSI. **No admite conexiones directas desde el navegador**, así que hace falta un backend que haga de proxy. Son receptores terrestres de voluntarios: hay huecos de cobertura. No pude leer los términos (¿se puede enseñar en una demo pública?) |
| Global Fishing Watch (API v3) | Eventos de gap, encounter y loitering, e identidad del barco | Solo uso no comercial y token gratuito. Si es una herramienta del agente, **no puede ser también la verdad del eval** (fuga): las etiquetas del eval van a mano |
| Sentinel-1 y 2 (Copernicus) | Imagen radar y óptica | Pasa cada pocos días: sirve de fondo, no de dato en vivo |
| GDELT y RSS | Noticias geolocalizadas | Muy pocas veces se pueden ligar a un gap concreto del Estrecho |

## Puerta: SÍ se construye, con un ángulo estrecho

El hueco no es el panel. Es **el agente que investiga cada gap y se mide**:
- Responde a la pregunta que worldmonitor no responde: ¿cuántos de esos "dark ships" son solo huecos de cobertura?
- Nadie en GitHub lo enseña con trazas y evals.
- Es justo lo que hay que demostrar: trabajar con agentes, no solo con prompts.
