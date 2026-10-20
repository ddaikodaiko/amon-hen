# Quickstart: Vigía v1

## 1. Ver la demo (sin keys ni red)

```bash
git clone <repo> vigia && cd vigia
bun install           # una vez, con red: instala también el panel (workspace)
bun run demo          # → http://localhost:4250
```

`bun run demo` no lee `.env` ni sale a la red: abre `demo/vigia-demo.sqlite` en solo lectura y, la primera vez, compila el panel. Cada visitante tiene su propio reloj de replay, a 60× por defecto.

> Mientras no exista `demo/vigia-demo.sqlite` (se construye con `bun run demo:build`, apartado 5), se puede probar con cualquier base: `bun run demo --db <ruta>`.

**Comprobación (SC-001):**
1. En el mapa se mueven los barcos del golfo de Finlandia y aparecen los gaps.
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
   - instalar Bun y clonar el repo en `~/vigia`, con `bun install`;
   - copiar `.env.example` a `.env` y rellenar al menos `VIGIA_LOCAL_URL` y `GFW_TOKEN` (todas las variables están en `contracts/cli.md`);
   - instalar las unidades de `deploy/`, que dicen cómo en su cabecera: `vigia-ingest.service`, `vigia-server.service`, y `vigia-brief.service` con su `vigia-brief.timer`;
   - `sudo loginctl enable-linger "$USER"`, para que arranquen sin sesión.
5. **El panel** escucha solo en `127.0.0.1` en modo `live`, porque puede investigar y etiquetar. Desde otra máquina: `ssh -L 4250:127.0.0.1:4250 <pi>` y `http://localhost:4250`.

**Comprobación (US4):**
1. A los pocos minutos de arrancar `vigia-ingest`, aparecen barcos en el mapa y minutos en `/health`.
2. Si paras la ingesta 10 minutos (`systemctl --user stop vigia-ingest`), aparece una caída en `/health` y ningún candidato de esa ventana.
3. Con el PC apagado, los candidatos quedan como `pending_no_model`, sin perder su sitio en la cola. Al encenderlo, se investigan solos y en orden (el modelo se prueba cada 2 min).
4. Cada mañana a las 08:00 (Madrid) hay un brief en `/briefs`. Si el PC estaba apagado, el párrafo del modelo llega cuando se enciende.

## 3. Etiquetar y medir

```bash
bun run server                 # en local, en modo live, sobre la base
# panel → /label: etiquetas a ciegas y por orden cronológico (teclas 1, 2, 3)
bun run eval                   # con el último expediente de cada caso
bun run eval --profile local   # investiga de nuevo con el modelo local, solo
bun run eval --profile haiku   # opcional, con ANTHROPIC_API_KEY y VIGIA_BUDGET_USD > 0
```

`--profile` no repite los casos que ya tienen un expediente de esa misma versión del agente; `--fresh` los repite.

**Comprobación (SC-003):**
1. El informe dice si se cumple la regla de parada (100 casos o más y al menos 15 positivos, o 300 casos) y, si no, cuánto falta.
2. Trae las cifras del agente y de la regla de 60 min, con intervalos de Wilson, en la terminal y en `/eval`.
3. Al repetirlo sobre los mismos datos, la regla da exactamente lo mismo.

## 4. Desarrollo

```bash
bun run dev:db --out data/dev.sqlite          # rastros sintéticos y un caso en cada estado
VIGIA_DB=data/dev.sqlite bun run server       # el panel sin modelo ni datos reales
cd panel && bun run dev                       # el panel con recarga; el servidor sigue en 4250
bun run investigate --ids 1,2 --profile local # investigar a mano
bun run brief --date 2026-10-20               # rehacer el brief de un día
```

## 5. Construir la demo

```bash
bun run demo:build --from 2026-10-21T06:00 --to 2026-10-22T06:00
```

Investiga en la base principal, con los datos completos, los casos de la ventana que aún no tienen expediente (necesita el modelo). Después reduce la ventana a una posición por barco y minuto, añade los briefs y los informes del eval, y escribe `demo/vigia-demo.sqlite`, de 50 MB como mucho.

## 6. Pruebas

```bash
bun run check                 # tsc y bun test: sin red, sin keys, sin GPU (modelos de guion)
cd panel && bun run check     # svelte-check del panel
```
