# Fase 2: consejo de 2 lentes (2026-10-19)

Lo hizo un solo agente, sin subagentes, con los lentes Product y Monopoly de `founder-skill/skills/founder-board/lenses.md`. Como es un proyecto de portfolio, el "comprador" es quien te entrevista.

## Lente Product: 4/10 tal cual, 7/10 con los recortes

- **Lo único que tiene que hacer brillantemente:** *pinchas un barco que se ha apagado y en 30 segundos tienes su expediente: veredicto, pruebas y cada paso que dio el agente para llegar ahí.* Todo lo demás es decorado.
- **Los primeros 5 minutos:** un reclutador no va a sacar tres API keys para ver algo. Hace falta un **modo replay**: `git clone` y `bun run demo` levantan el panel con unas horas del Estrecho ya grabadas y los expedientes ya calculados, sin ninguna key. Con una key de Anthropic, el agente vuelve a investigar en vivo.
- **Las juntas, donde se rompe:**
  - **aisstream → backend:** si **tu** ingesta se cae 10 minutos, todos los barcos "se apagan" a la vez. Hay que registrar la salud de la ingesta y descartar los gaps que coincidan con tus propias caídas. Es la parte que no se ve y la que más dice de ti.
  - **agente → panel:** la traza tiene que leerse como el razonamiento de un analista ("miré la cobertura en esa celda: 94 % → el hueco no es de cobertura"), no como un volcado de JSON.
- **Oficio:** que el informe del eval sea una página más del panel, no un CSV escondido.

## Lente Monopoly: 6/10

- **Competencia:** worldmonitor domina la amplitud, así que no hay que pelear ahí. El mercado pequeño que sí se puede ganar es el **triaje de barcos oscuros, medido, en un solo estrecho**.
- **¿10 veces mejor en algo?** En una sola cosa: un veredicto explicado y una precisión medida, frente a una regla de 60 min que nadie ha medido. En todo lo demás es una mejora pequeña.
- **¿Por qué ahora?**
  - Los agentes son lo que piden las ofertas de 2026.
  - El apagado de AIS y la flota en la sombra salen en las noticias.
- **El secreto (es una hipótesis, el eval la confirma o la tumba):** con AIS terrestre, la mayoría de los gaps son huecos de cobertura. Si mides la cobertura con tus propios datos, el ruido se convierte en señal.
- **Distribución:** el gancho es **el número del eval**.
  - Un artículo en inglés: *"How many 'dark ships' are just coverage holes? I built an agent to find out"*, para r/OSINT y HN.
  - Un post en LinkedIn con el GIF, para los reclutadores de defensa en España.
  - El README con el GIF arriba del todo.
- **Equipo:** no tienes formación marítima. Etiquetar tú los 50 casos y leer la metodología de GFW sobre el apagado de AIS cubre ese hueco, y además se cuenta en la entrevista.

## Riesgos

| Riesgo | Qué hacer |
|---|---|
| Las caídas de tu ingesta parecen barcos oscuros | Un registro de salud de la ingesta y descartar esos gaps (ver arriba) |
| El coste de la API. Estimación sin medir, para ~20 casos al día con ~6 llamadas cada uno: **Haiku 5.5 ~0,4 céntimos/caso (~2-3 $/mes), Sonnet 5.5 ~7 céntimos (~40 $/mes), Opus 5.5 ~14 céntimos (~85 $/mes)** | Haiku investiga todos los casos y solo los "no concluyentes" suben a Sonnet. El coste por caso se mide y se pone un tope al mes que corta. **Comparar Haiku y Sonnet en el eval es en sí un resultado que enseñar** |
| Si GFW es una herramienta del agente y también la verdad del eval, hay fuga | Las etiquetas del eval van a mano. GFW es solo una herramienta |
| Etiquetar 50 casos lleva tiempo | Hacer una vista de etiquetado en el propio panel: un bloque |
| aisstream es gratis, sin SLA y con términos que no se pudieron leer | El modo replay hace que la demo no dependa de aisstream. Hay que leer los términos antes de publicar |
| Tiempo: el bar, el TFG y la FCT | Si v1 no cabe en ~10 bloques, se recorta más, no se alarga |

## Qué quitar (aplicado a `idea.md`)

- ❌ **La capa satélite (Sentinel):** pasa cada pocos días, gasta cuota y no aporta nada al agente.
- ❌ **Las noticias (GDELT y RSS):** casi nunca se pueden ligar a un gap concreto del Estrecho.
- ❌ **Los detectores de loitering y concentración:** pasan a v2, como herramientas nuevas una vez que los gaps funcionen.
- ➕ **Se añaden:** el modo replay, la salud de la ingesta, el reparto de modelos con el coste por caso y la vista de etiquetado.
