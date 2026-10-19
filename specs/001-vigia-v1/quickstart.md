# Quickstart: Vigía v1

## 1. Ver la demo (sin keys ni red)

```bash
git clone <repo> vigia && cd vigia
bun install
bun run demo          # → http://localhost:4250
```

**Comprobación (SC-001):**
1. En el mapa se mueven los barcos del golfo de Finlandia.
2. Abres un caso de la lista y ves su expediente con la traza.
3. Pulsas una prueba citada y salta a su paso.
4. Ves el brief y la página del eval.

Todo en 5 minutos o menos.

## 2. Montarlo en vivo (Pi 5 + PC de casa)

**Una sola vez:**
1. **AIS:** nada que pedir. Digitraffic no usa key.
2. **Token de GFW** (gratis, solo uso no comercial), en globalfishingwatch.org/our-apis.
3. **En el PC de casa (RTX 3060 Ti):**
   - instalar Ollama y descargar el modelo: `ollama pull qwen3:8b`;
   - poner `OLLAMA_HOST=0.0.0.0` para que escuche en la red;
   - instalar Tailscale y meter el PC en la tailnet. Desde la Pi, comprobar que responde: `curl http://<pc>:11434/api/version`.
4. **En la Pi:**
   - instalar Bun y clonar el repo;
   - crear el `.env` (ver `contracts/cli.md`);
   - instalar las unidades de `deploy/`: `vigia-ingest.service`, `vigia-server.service` y `vigia-brief.timer`.

**Comprobación (US4):**
1. A los pocos minutos de arrancar `vigia-ingest`, aparecen barcos en el mapa.
2. Si paras la ingesta 10 minutos (`systemctl stop vigia-ingest`), aparece una caída en salud y ningún candidato de esa ventana.
3. Con el PC apagado, los candidatos quedan como `pending_no_model`. Al encenderlo, se investigan solos.

## 3. Etiquetar y medir

```bash
bun run server                 # en local, en modo live, sobre la base
# panel → /label: etiquetas a ciegas y por orden cronológico
bun run eval --profile local   # gratis
bun run eval --profile haiku   # opcional, con VIGIA_BUDGET_USD > 0
```

**Comprobación (SC-003):**
1. El informe dice si se cumple la regla de parada (100 casos o más y al menos 15 positivos, o 300 casos).
2. Trae las cifras del agente y de la regla de 60 min, con intervalos.
3. Al repetirlo sobre los mismos datos, la regla da exactamente lo mismo.

## 4. Pruebas

```bash
bun test     # sin red, sin keys, sin GPU: el agente usa un modelo de pega con guion
```
