# Pruebas

Todo corre local: no toca ninguna planilla, no llama a Mercado Pago ni al Apps Script real.

## Backend: `harness.js` (sin dependencias)

Carga `apps-script/Code.gs` en Node con los servicios de Apps Script simulados (Properties, Cache con TTL y reloj controlable, Spreadsheet en memoria, UrlFetch con pagos de MP falsos, Lock, Utilities) y prueba: modo estricto y configuración por modo, anti fórmulas, `verify` con referencia, clave del webhook, `pagoValido_`, orden de escritura (K primero, fila a medio escribir, reintento), formato texto, metadata revalidada, límite de pedidos y tope de fechas.

```bash
node tests/harness.js
# otra versión del script:
CODE_GS=/ruta/a/Code.gs node tests/harness.js
```

## Front: `front.js` (Chrome headless)

Levanta un servidor estático propio con el repo en `http://localhost:8766/eter-clase-prueba/`, intercepta las llamadas a `script.google.com` con respuestas falsas y prueba: lista blanca del `init_point`, validación del nombre, estados de `confirmacion.html` (éxito solo si el servidor confirma), aviso de privacidad, mensajes de `rate_limited` y tope de 120 días en la landing y en `generar.html`.

Necesita Google Chrome/Chromium instalado y `puppeteer-core` (única dependencia, solo para pruebas):

```bash
cd tests
npm i
node front.js
# opcionales: CHROME_PATH=/ruta/a/chrome  PORT=8766  SHOTS_DIR=.shots (guarda capturas)
```

`npm test` (dentro de `tests/`) corre las dos. `node_modules/` no se sube (ver `.gitignore`); `tests/` no se publica en Pages (el workflow copia solo los archivos del sitio).
