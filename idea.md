# Vigía (nombre provisional)

- **Qué es:** un panel que sigue en vivo el tráfico AIS del Estrecho de Gibraltar, detecta barcos que dejan de emitir y pone a **un agente de IA a investigar cada caso** como lo haría un analista junior. El agente usa herramientas: rastro, cobertura, datos del barco, barcos cercanos y Global Fishing Watch. Deja un expediente con su veredicto, las pruebas y la traza de cada paso, y cada mañana redacta un brief.
- **Para quién:** reclutadores y equipos técnicos de defensa e inteligencia (Indra, GMV, Navantia y similares). El repo tiene que demostrar en 5 minutos que sé **diseñar, construir y medir un agente**, no solo llamar a un LLM. De paso, la comunidad OSINT (r/OSINT y similares).
- **Licencia y dinero:** MIT, gratis, solo datos abiertos. Global Fishing Watch solo permite uso no comercial, y el proyecto lo es.
- **De dónde sale:** `../osint-maritimo-portfolio.md` (la ficha de claude.ai) y la evaluación del 2026-10-19 (`investigacion.md`). El panel genérico ya existe (worldmonitor, 88,8k★). Lo que no existe es un agente que investigue los casos y se mida.
- **Límites:**
  - **Tiempo:** bloques de 17:30 a 20:30. Compite con el TFG, la búsqueda de FCT y el bar. *(Falta: cuántos bloques a la semana.)*
  - **Stack:** Bun + TypeScript estricto, sin `any`.
  - **Despliegue:** la demo pública va en la Pi 5 con Cloudflare Tunnel, que ya existe.
  - **Coste:** 0 € por defecto. El modelo es local, con Ollama en el PC de casa (RTX 3060 Ti), que se enciende a ratos; mientras está apagado, los casos esperan en cola. La API de Claude es opcional, solo para comparar en el eval, y tiene un tope.

## Alcance v1 (después del consejo, ver `consejo.md`)

1. **Ingesta AIS** en vivo del Estrecho (aisstream.io) con **registro de salud**: los gaps que coinciden con caídas propias se descartan.
2. **Mapa de cobertura** sacado de los mensajes recibidos (por celda y por hora).
3. **Detector de gaps:** la regla genera candidatos. El agente no detecta, investiga.
4. **Agente investigador** con herramientas:
   - el rastro antes y después del gap;
   - la cobertura en esa zona y a esa hora;
   - los datos estáticos del barco;
   - los barcos cercanos;
   - los eventos de Global Fishing Watch.

   Saca un expediente estructurado y una traza legible. El reparto de modelos sería este: un modelo barato para todos los casos y uno mejor para los "no concluyentes", midiendo el coste por caso.
5. **Panel:** mapa con barcos y rastros, la lista de casos, el expediente con su traza, una vista de etiquetado y la página del eval.
6. **Brief diario** hecho a partir de los expedientes.
7. **Modo replay** con datos grabados y expedientes calculados: `bun run demo` sin ninguna key.

**Quitado (v2):** la capa satélite, las noticias GDELT y RSS, los detectores de loitering y de concentración, y más de una región.

## Qué es "hecho"

1. **Un comando** levanta el panel con el Estrecho en vivo. Hay un **modo replay** con datos grabados que funciona sin ninguna key.
2. **Cada gap** lo investiga el agente y deja un expediente:
   - un veredicto: *hueco de cobertura*, *apagado probable* o *no concluyente*;
   - la confianza y las pruebas;
   - **la traza completa** de sus llamadas, visible en el panel.
3. **`bun run eval`** sobre 50 casos o más, etiquetados a mano, da la precisión y la exhaustividad del agente frente a la regla ingenua (gap de más de 60 min), y el coste medio por caso. El número se publica, salga el que salga.
4. **Brief diario automático** y README con GIF, instalación en una línea y demo pública.

## Sin saber todavía

- ¿Cuántos gaps salen al día en el Estrecho? Decide el tamaño del eval y el coste. Se mide dejando la ingesta unas horas.
- ¿Las condiciones de aisstream permiten enseñar sus datos en una demo pública? La página de términos no se pudo leer.
- ¿Los eventos de GFW cubren el Estrecho lo bastante como para servir de contraste? Hace falta su token gratuito.
