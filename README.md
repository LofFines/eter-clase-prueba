# Espacio Éter · Reserva y pago de la clase de prueba

Landing estática para que una persona que ya coordinó por WhatsApp con Araceli **reserve y pague su clase de prueba ($5.000 ARS) con Mercado Pago Checkout Pro**, y quede anotada sola en la planilla *Espacio Éter — Control marketing* (solapa **Clase de prueba**).

> Estado: **prueba**. Todas las páginas tienen `noindex`. El backend arranca en `MODE=mock` (no cobra nada ni llama a Mercado Pago).

- Sitio: https://loffines.github.io/eter-clase-prueba/
- Generador de links (uso interno): https://loffines.github.io/eter-clase-prueba/generar.html
- Estudio: San Martín 39, Ciudadela (GBA) · IG [@espacioeter](https://www.instagram.com/espacioeter/) · WhatsApp [11 2397-8429](https://wa.me/541123978429)

---

## Arquitectura

```
Araceli (WhatsApp) ──► generar.html ──► link: /?d=pole-sport&f=2026-10-02&h=19:00&o=salsa
                                              │
Persona ──► index.html (ve su clase, deja nombre + WhatsApp)
              │  POST text/plain {action:"create", ...}      (sin preflight CORS)
              ▼
        Apps Script (app web, pegado a la planilla)
              │  arma la preferencia de Checkout Pro (precio y moneda FIJOS en el servidor)
              ▼
        Mercado Pago Checkout Pro ──(back_url)──► confirmacion.html
              │                                       │ POST {action:"verify", payment_id}
              │ notification_url (webhook)            ▼
              └──────────────────────────────► Apps Script: GET /v1/payments/{id}
                                                      │ approved + 5000 + ARS + ref "ETER-"
                                                      ▼
                                         Planilla › "Clase de prueba" (sheetId 934024988)
        + trigger `reconcile` cada 15 min: /v1/payments/search → anota lo que falte
```

| Archivo | Qué hace |
|---|---|
| `assets/og.svg` | Imagen para compartir (Open Graph). El workflow la convierte a `og.png` al publicar (WhatsApp/Facebook no leen SVG). |
| `index.html` + `assets/reserva.js` | Lee `d` (slug de la disciplina: `pole-sport`, `pole-coreo`, `funcional`, `bachata`, `salsa`, `acro-adultos`, `acro-infantil`, `flexibilidad`; un slug viejo o desconocido cae en “link inválido”), `f` (YYYY-MM-DD), `h` (HH:mm), `o` (origen, opcional; default `WhatsApp`). Muestra “Pole sport · viernes 2 de octubre · 19:00 hs”, en `acro-infantil` aclara que completa el/la adulto/a responsable, valida nombre y celular argentino, llama a `create` y redirige al `init_point`. Si el link está incompleto, vencido o es inválido, ofrece pedir otro por WhatsApp. |
| `confirmacion.html` + `assets/confirmacion.js` | `back_url` de MP. Lee `payment_id`, `status`, `external_reference`, llama a `verify` y muestra aprobado / pendiente / rechazado / no pagó. Incluye dirección, Google Maps, qué traer, política de reprogramación y botón a WhatsApp. |
| `generar.html` + `assets/generar.js` | Herramienta para Araceli: disciplina, día, hora, origen → link listo, “Copiar” y “Mandar por WhatsApp” (con o sin número). |
| `config.js` | `SCRIPT_URL` (URL `/exec` de la app web) y `SITE_URL`. |
| `assets/common.js` | Formato de fechas en español, validación de celular, links de WhatsApp, `fetch` al script. |
| `apps-script/Code.gs`, `apps-script/appsscript.json` | Backend: `doPost` (create / verify / webhook), `reconcile`, `installTriggers`, `selfTest`, `checkConfig`. |
| `.github/workflows/pages.yml` | Publica el sitio en GitHub Pages (solo los archivos públicos). |
| `docs/guia-araceli-mercadopago.md` | Guía para Araceli: crear la aplicación en Mercado Pago Developers. |

### Cómo escribe en la planilla

Solapa buscada **por sheetId `934024988`** (no por nombre). Encabezados en la fila 1:

| Col | Encabezado | Qué se escribe |
|---|---|---|
| A | Fecha anotación | Fecha de hoy como número de serie de Sheets (formato `dd/mm`; la columna valida “es número”) |
| B | Nombre | Nombre |
| C | WhatsApp | Texto (`@`), p. ej. `+54 9 11 2397-8429` |
| D | Anuncio de origen | Valor de la lista de la columna (`3 segundos`, `salsa`, `bachata`, `comunidad`, `genio`, `Orgánico / IG`, `Recomendación`, `No sabe`). Si el origen no está en la lista (p. ej. el default `WhatsApp`) se anota `No sabe` y el valor original va a Notas. |
| E | Disciplina | Nombre exacto según el slug: `Pole sport` / `Pole coreo` / `Funcional` / `Bachata` / `Salsa` / `Acro adultos` / `Acro infantil` / `Flexibilidad` (mismas opciones que la lista de la columna). En `Acro infantil`, B y C son los datos del/de la adulto/a responsable. |
| F | Día y hora de la clase | **Fecha-hora como número de serie** (formato `dd/mm HH:mm`; se ve como `02/10 19:00`). Tiene que ser número porque la fórmula de J lo usa. Se escribe como serial calculado desde la hora de Argentina, no como objeto `Date`, para que no dependa de la zona horaria de la planilla y Sheets no reemplace el formato. |
| G | ¿Confirmó? | `Sí` en production; `PRUEBA` en mock y sandbox (la lista de validación de G en la copia PRUEBA tiene que incluir `PRUEBA`) |
| H, I | ¿Vino? / ¿Volvió? | vacías |
| J | Semana | **No se toca**: `J2` tiene un ARRAYFORMULA: `=ARRAYFORMULA(IF(ISNUMBER(F2:F);INT(F2:F)-WEEKDAY(F2:F;3);""))` que llena toda la columna (J2:J1000 está protegido con advertencia). |
| K | Notas | production: `Pagó $5.000 MP · id <payment_id>` · sandbox: `SANDBOX, no es plata real · id <payment_id>` · mock: `PRUEBA (mock), no se cobró · id MOCK-…` |

- A:I y K se escriben por separado (nunca A:K de una, para no pisar el ARRAYFORMULA de J). **Primero K** (la nota con `id <payment_id>` reserva la fila), después A:I. Si A:I falla (p. ej. validación estricta de una columna), K queda y el próximo intento (verify / webhook / reconcile) **completa esa misma fila**: un id en K con B vacía se completa; con B llena es duplicado.
- B, C, D y K con formato texto (`@`), así `1e5` no se convierte en número.
- En sandbox/production, la `metadata` del pago se revalida con las mismas reglas del create (disciplina, fecha, hora, nombre con letras, celular) antes de escribir; si no pasa, no se anota y se loguea.
- **Anti fórmulas**: todo texto libre (nombre, WhatsApp, origen, notas) pasa por `textoPlanilla_()`: saca caracteres invisibles y, si empieza con `=` `+` `-` `@` tab, `\r` o `'`, le antepone un apóstrofo (Sheets lo guarda como texto). El nombre tiene que tener al menos una letra.
- Fila destino: la **primera fila vacía** (A y B vacías y sin nada en C:I ni K, para no pisar una fila a medio cargar). No se usa `getLastRow()` porque el ARRAYFORMULA de J y el panel de resumen de M:Q llegan hasta la fila 1000.
- **Idempotente**: si `id <payment_id>` ya está en K, no duplica. Todo dentro de `LockService`.

---

## Instalar el script (una vez)

> Recomendado: probar primero en la copia **“PRUEBA (borrar) — Espacio Éter — Control marketing”** (mantiene el mismo sheetId de la solapa).

1. Abrí la planilla → **Extensiones → Apps Script**.
2. Pegá el contenido de `apps-script/Code.gs` en `Code.gs`.
3. En **Configuración del proyecto** (engranaje) tildá *Mostrar el archivo de manifiesto "appsscript.json"* y pegá `apps-script/appsscript.json` (zona `America/Argentina/Buenos_Aires`, app web “ejecutar como quien implementa”, acceso “cualquier persona”).
4. En **Configuración del proyecto → Propiedades de la secuencia de comandos** cargá:

   | Propiedad | mock | sandbox | production |
   |---|---|---|---|
   | `MODE` | `mock` | `sandbox` | `production` |
   | `MOCK_SHEET_ID` (alias `TEST_SHEET_ID`) | **obligatoria**: la planilla tiene que ser esta | **obligatoria**: la planilla tiene que ser esta | opcional: si está, la planilla **no** puede ser esta |
   | `MP_ACCESS_TOKEN` | — | **obligatoria** (de prueba) | **obligatoria** |
   | `MP_COLLECTOR_ID` | — | **obligatoria**, solo dígitos | **obligatoria**, solo dígitos |
   | `WEBHOOK_KEY` | — | **obligatoria**, 32+ caracteres al azar | **obligatoria**, 32+ caracteres |
   | `WEBAPP_URL` | opcional | **obligatoria**, `https://…/exec` | **obligatoria**, `https://…/exec` |
   | `SITE_URL` | `https://loffines.github.io/eter-clase-prueba/` | ídem | ídem |
   | `SHEET_ID` | opcional; vacío = usa la planilla donde está pegado el script | ídem | ídem |

   Límites de pedidos (opcionales; entero de 1 a 100000; si falta o es inválido se usa el default):

   | Propiedad | Default | Qué limita |
   |---|---|---|
   | `RL_CREATE_PER_MIN` | 10 | `create`, global por minuto |
   | `RL_CREATE_PER_HOUR` | 60 | `create`, global por hora |
   | `RL_CREATE_PER_WA_10MIN` | 3 | `create`, por WhatsApp (normalizado, con hash) cada 10 min |
   | `RL_VERIFY_PER_MIN` | 30 | `verify`, global por minuto |
   | `RL_VERIFY_PER_HOUR` | 300 | `verify`, global por hora |
   | `RL_WEBHOOK_PER_MIN` | 60 | notificaciones de MP **con la clave correcta**, por minuto |

   `MODE` es exacto (minúsculas). Si falta algo obligatorio para el modo, el script **falla cerrado**: no procesa create / verify / webhook / reconcile ni escribe, responde `ok:false`, `error:"config"` y loguea qué falta (`checkConfig` también lo muestra). `WEBHOOK_KEY` va en `notification_url` como `&k=…`; las notificaciones sin esa clave se descartan sin consultar a MP. `MP_COLLECTOR_ID` es el user id de la cuenta que cobra: un pago de otra cuenta no se acepta.

5. **Implementar → Nueva implementación → tipo “Aplicación web”**: *Ejecutar como*: **Yo**; *Quién tiene acceso*: **Cualquier persona**. Autorizá los permisos (planilla, conexiones externas, triggers).
6. Copiá la URL que termina en `/exec`:
   - pegala en `config.js` → `SCRIPT_URL` (commit + push; Pages se actualiza solo), y
   - en la propiedad `WEBAPP_URL`.
7. En el editor, ejecutá `selfTest` → tiene que aparecer una fila “Prueba selfTest” (y no duplicarse). Borrala a mano después.
8. Ejecutá `installTriggers` (instala `reconcile` cada 15 min). `checkConfig` muestra la configuración sin mostrar el token.
9. Probá el circuito: abrí `generar.html`, armá un link, completá el formulario → en mock vas directo a `confirmacion.html` con un pago `MOCK-…` y se anota la fila.

> Cada vez que cambies `Code.gs`: **Implementar → Administrar implementaciones → editar → Versión: nueva**. Así la URL `/exec` no cambia.

---

## De mock → sandbox → producción

### 1) Mock (actual)
`MODE=mock` + `MOCK_SHEET_ID`. `create` no llama a MP: devuelve un `init_point` a `confirmacion.html?payment_id=MOCK-<UUID>&status=approved&external_reference=ETER-…`. `verify` acepta `MOCK-*` solo si la `external_reference` coincide con lo guardado en el `create` (CacheService, 6 h). La fila lleva `PRUEBA` en G. `reconcile` y los webhooks no hacen nada.

⚠️ En mock cualquiera que abra la landing puede generar una fila de prueba: por eso mock **solo funciona si la planilla es la de `MOCK_SHEET_ID`** (la copia PRUEBA); instalado en la planilla real, el script se niega.

### 2) Sandbox (cuentas de prueba de MP)
1. Araceli crea la aplicación y cuentas de prueba siguiendo `docs/guia-araceli-mercadopago.md`.
2. El **Access Token de prueba** se carga en `MP_ACCESS_TOKEN` por el canal seguro que coordina Leandro (nunca por chat, nunca en el repo, nunca en `config.js`).
3. `MODE=sandbox` con `MP_ACCESS_TOKEN`, `MP_COLLECTOR_ID`, `WEBHOOK_KEY` y `WEBAPP_URL`, **sobre la copia PRUEBA** (`MOCK_SHEET_ID`; en cualquier otra planilla se niega). `create` devuelve `sandbox_init_point` (si MP no lo manda, usa `init_point`). Solo se aceptan pagos con `live_mode=false`. Las filas quedan marcadas: G=`PRUEBA` y K=`SANDBOX, no es plata real · id …`.
4. Probar en ventana de incógnito, logueado como **comprador de prueba**, con las tarjetas de prueba de MP (titular `APRO` = aprobado, `OTHE` = rechazado, `CONT` = pendiente).
5. Verificar: fila anotada, reintento de `confirmacion.html` sin duplicar, webhook y `reconcile` (dejá pasar 15 min con un pago cuyo `verify` no se haya llamado).

### 3) Producción (no activar todavía)
1. Araceli activa las credenciales de producción (rubro + sitio `https://loffines.github.io/eter-clase-prueba/`).
2. Reemplazar `MP_ACCESS_TOKEN` por el de producción, `MODE=production` (solo se aceptan pagos con `live_mode=true`) y revisar `WEBHOOK_KEY` / `MP_COLLECTOR_ID` / `WEBAPP_URL`. En production el script se niega a correr sobre la planilla `MOCK_SHEET_ID`.
3. Instalar el script en la planilla real (o `SHEET_ID` apuntando a ella) y crear una nueva versión de la implementación.
4. Sacar `noindex` de las páginas cuando se quiera (opcional; `generar.html` conviene dejarlo con `noindex`).

---

## Seguridad y decisiones

- **Precio y moneda fijos del lado del servidor** (`unit_price: 5000`, `currency_id: "ARS"`). El navegador solo manda nombre, WhatsApp, disciplina, fecha, hora y origen, que se validan en el servidor.
- **Falla cerrado**: `MODE` inválido o faltante, una propiedad obligatoria del modo faltante o mal formada, mock/sandbox fuera de la planilla `MOCK_SHEET_ID` o production sobre ella → `ok:false` (`error:"config"`) en create / verify / webhook / reconcile, y no se escribe nada.
- **Una fila solo se escribe con un pago verificado** consultando `GET /v1/payments/{id}` con el token: `status=approved`, `transaction_amount=5000`, `currency_id=ARS`, `external_reference` que empieza con `ETER-` (así no se anotan otros cobros de $5.000 de la cuenta), `live_mode` acorde al modo (`true` solo en production) y `collector_id` igual a `MP_COLLECTOR_ID`. Los datos de la fila salen de la `metadata` del pago, no de lo que manda el navegador.
- `verify` exige que la `external_reference` que manda el navegador empiece con `ETER-` y sea **igual** a la del pago antes de devolver cualquier dato.
- Apps Script no puede leer headers, así que **no se valida la firma `x-signature`** del webhook; en su lugar la `notification_url` lleva `&k=<WEBHOOK_KEY>` (lo que no trae esa clave se descarta sin llamar a MP) y cada notificación se re-consulta a la API con el token (una notificación falsa no puede anotar nada). Webhooks configurados a mano en el panel de MP (sin `k`) se descartan.
- El front solo redirige a `https://www.mercadopago.com.ar/` o `https://sandbox.mercadopago.com.ar/` (o, en mock, a la `confirmacion.html` del mismo sitio) y solo muestra “¡Listo!” si el servidor confirma aprobado + anotado; si no, “Estamos verificando tu pago”.
- Aviso de privacidad (Ley 25.326, art. 6, y Disposición AAIP 10/2008) visible debajo del botón de pago.
- **Límite de pedidos** (para que nadie agote las cuotas diarias de Apps Script ni golpee a MP copiando la URL `/exec`): contadores de ventana fija en `CacheService`, al principio de `doPost` y en este orden: cuerpo > 4 KB → `too_large` sin parsear; `JSON.parse`; `create`/`verify` → límites globales (y por WhatsApp en `create`) **antes** de leer toda la configuración, abrir la planilla, tomar el lock o llamar a MP; recién después la configuración y el handler. Webhooks: primero la clave `k` (gratis), después su propio límite; los límites de `create`/`verify` no los afectan. `reconcile` no tiene límite. Limitado → `{ok:false, error:"rate_limited"}` (se loguea una vez por ventana); el front lo muestra y en `confirmacion.html` queda en “Estamos verificando”. CacheService no es atómico: con mucha concurrencia puede pasarse por poco.
- Las Script Properties se leen una sola vez por ejecución (`getProperties`) y la planilla se abre una sola vez por ejecución.
- **Fechas**: `create` acepta clases hasta hoy + 120 días (hora de Argentina); la landing y `generar.html` también. Al revalidar la metadata de un pago se acepta desde hoy − 30 hasta hoy + 127 días (notificaciones tardías).
- Apps Script responde a los POST con una redirección 302; MP puede reintentar la notificación. No pasa nada: la escritura es idempotente y `reconcile` cubre cualquier notificación perdida.
- El token nunca se loguea ni se devuelve. `doGet` responde solo `{"ok":true}`.
- `confirmacion.html` devuelve solo el primer nombre y los datos de la clase; nunca el teléfono.
- Vencimiento de la preferencia: 48 h.

## GitHub Pages

El workflow `.github/workflows/pages.yml` publica en cada push a `main`. **Requiere activar Pages una vez** en *Settings → Pages → Build and deployment → Source: **GitHub Actions***. (Alternativa: “Deploy from a branch” → `main` / `(root)`; en ese caso borrá el workflow para que no falle.)

## Pruebas automáticas

En `tests/` (ver `tests/README.md`): `node tests/harness.js` (backend simulado, sin dependencias) y `cd tests && npm i && node front.js` (front en Chrome headless).

## Probar localmente

```bash
python3 -m http.server 8000
# http://localhost:8000/?d=pole-sport&f=2026-10-02&h=19:00
```
Sin `SCRIPT_URL` configurada, el botón de pago avisa que la reserva online no está activa y deriva a WhatsApp.
