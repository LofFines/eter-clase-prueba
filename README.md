# Espacio Éter · Reserva y pago de la clase de prueba

Landing estática para que una persona que ya coordinó por WhatsApp con Araceli **reserve y pague su clase de prueba ($5.000 ARS) con Mercado Pago Checkout Pro**, y quede anotada sola en la planilla *Espacio Éter — Control marketing* (solapa **Clase de prueba**).

> Estado: **prueba**. Todas las páginas tienen `noindex`. El backend arranca en `MODE=mock` (no cobra nada ni llama a Mercado Pago).

- Sitio: https://loffines.github.io/eter-clase-prueba/
- Generador de links (uso interno): https://loffines.github.io/eter-clase-prueba/generar.html
- Estudio: San Martín 39, Ciudadela (GBA) · IG [@espacioeter](https://www.instagram.com/espacioeter/) · WhatsApp [11 2397-8429](https://wa.me/541123978429)

---

## Arquitectura

```
Araceli (WhatsApp) ──► generar.html ──► link: /?d=pole&f=2026-10-02&h=19:00&o=salsa
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
| `index.html` + `assets/reserva.js` | Lee `d` (pole\|acro\|flexi\|danza), `f` (YYYY-MM-DD), `h` (HH:mm), `o` (origen, opcional; default `WhatsApp`). Muestra “Pole · viernes 2 de octubre · 19:00 hs”, valida nombre y celular argentino, llama a `create` y redirige al `init_point`. Si el link está incompleto, vencido o es inválido, ofrece pedir otro por WhatsApp. |
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
| A | Fecha anotación | Fecha de hoy (valor fecha real; la columna tiene formato `dd/mm` y validación “es número”) |
| B | Nombre | Nombre |
| C | WhatsApp | Texto (`@`), p. ej. `+54 9 11 2397-8429` |
| D | Anuncio de origen | Valor de la lista de la columna (`3 segundos`, `salsa`, `bachata`, `comunidad`, `genio`, `Orgánico / IG`, `Recomendación`, `No sabe`). Si el origen no está en la lista (p. ej. el default `WhatsApp`) se anota `No sabe` y el valor original va a Notas. |
| E | Disciplina | `Pole` / `Acro` / `Flexi` / `Danza` |
| F | Día y hora de la clase | **Fecha-hora real** (la columna tiene formato `dd/mm HH:mm`; se ve como `02/10 19:00`). Tiene que ser número porque la fórmula de J lo usa. |
| G | ¿Confirmó? | `Sí` |
| H, I | ¿Vino? / ¿Volvió? | vacías |
| J | Semana | **No se toca**: `J2` tiene un ARRAYFORMULA: `=ARRAYFORMULA(IF(ISNUMBER(F2:F1000),INT(F2:F1000)-WEEKDAY(F2:F1000,3),""))` que llena J2:J1000 (rango protegido con advertencia). |
| K | Notas | `Pagó $5.000 MP · id <payment_id>` |

- A:I y K se escriben por separado.
- Fila destino: la **primera fila vacía** (A y B vacías y sin nada en C:I ni K, para no pisar una fila a medio cargar). No se usa `getLastRow()` porque el ARRAYFORMULA de J y el panel de resumen de M:Q llegan hasta la fila 1000.
- **Idempotente**: si `id <payment_id>` ya está en K, no duplica. Todo dentro de `LockService`.

---

## Instalar el script (una vez)

> Recomendado: probar primero en la copia **“PRUEBA (borrar) — Espacio Éter — Control marketing”** (mantiene el mismo sheetId de la solapa).

1. Abrí la planilla → **Extensiones → Apps Script**.
2. Pegá el contenido de `apps-script/Code.gs` en `Code.gs`.
3. En **Configuración del proyecto** (engranaje) tildá *Mostrar el archivo de manifiesto "appsscript.json"* y pegá `apps-script/appsscript.json` (zona `America/Argentina/Buenos_Aires`, app web “ejecutar como quien implementa”, acceso “cualquier persona”).
4. En **Configuración del proyecto → Propiedades de la secuencia de comandos** cargá:

   | Propiedad | Valor |
   |---|---|
   | `MODE` | `mock` (para empezar) |
   | `SITE_URL` | `https://loffines.github.io/eter-clase-prueba/` |
   | `WEBAPP_URL` | (la completás en el paso 6) |
   | `SHEET_ID` | opcional; vacío = usa la planilla donde está pegado el script |
   | `MP_ACCESS_TOKEN` | **solo** cuando pases a sandbox; en mock no hace falta |

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
`MODE=mock`. `create` no llama a MP: devuelve un `init_point` a `confirmacion.html?payment_id=MOCK-<timestamp>&status=approved&external_reference=…`. `verify` acepta `MOCK-*` solo si coincide con lo guardado en el `create` (CacheService, 6 h). `reconcile` y los webhooks no hacen nada.

⚠️ En mock cualquiera que abra la landing puede generar una fila de prueba: **usalo solo sobre la copia PRUEBA**, no con el script instalado en la planilla real.

### 2) Sandbox (cuentas de prueba de MP)
1. Araceli crea la aplicación y cuentas de prueba siguiendo `docs/guia-araceli-mercadopago.md`.
2. El **Access Token de prueba** se carga en `MP_ACCESS_TOKEN` por el canal seguro que coordina Leandro (nunca por chat, nunca en el repo, nunca en `config.js`).
3. `MODE=sandbox`. `create` devuelve `sandbox_init_point` (si MP no lo manda, usa `init_point`).
4. Probar en ventana de incógnito, logueado como **comprador de prueba**, con las tarjetas de prueba de MP (titular `APRO` = aprobado, `OTHE` = rechazado, `CONT` = pendiente).
5. Verificar: fila anotada, reintento de `confirmacion.html` sin duplicar, webhook y `reconcile` (dejá pasar 15 min con un pago cuyo `verify` no se haya llamado).

### 3) Producción (no activar todavía)
1. Araceli activa las credenciales de producción (rubro + sitio `https://loffines.github.io/eter-clase-prueba/`).
2. Reemplazar `MP_ACCESS_TOKEN` por el de producción y `MODE=production`.
3. Instalar el script en la planilla real (o `SHEET_ID` apuntando a ella) y crear una nueva versión de la implementación.
4. Sacar `noindex` de las páginas cuando se quiera (opcional; `generar.html` conviene dejarlo con `noindex`).

---

## Seguridad y decisiones

- **Precio y moneda fijos del lado del servidor** (`unit_price: 5000`, `currency_id: "ARS"`). El navegador solo manda nombre, WhatsApp, disciplina, fecha, hora y origen, que se validan en el servidor.
- **Una fila solo se escribe con un pago verificado** consultando `GET /v1/payments/{id}` con el token: `status=approved`, `transaction_amount=5000`, `currency_id=ARS` y `external_reference` que empieza con `ETER-` (así no se anotan otros cobros de $5.000 de la cuenta). Los datos de la fila salen de la `metadata` del pago, no de lo que manda el navegador.
- Apps Script no puede leer headers, así que **no se valida la firma `x-signature`** del webhook; en su lugar, cada notificación se re-consulta a la API con el token (una notificación falsa no puede anotar nada).
- Apps Script responde a los POST con una redirección 302; MP puede reintentar la notificación. No pasa nada: la escritura es idempotente y `reconcile` cubre cualquier notificación perdida.
- El token nunca se loguea ni se devuelve. `doGet` solo informa `mode` y si hay token cargado (sí/no).
- `confirmacion.html` devuelve solo el primer nombre y los datos de la clase; nunca el teléfono.
- Vencimiento de la preferencia: 48 h.

## GitHub Pages

El workflow `.github/workflows/pages.yml` publica en cada push a `main`. **Requiere activar Pages una vez** en *Settings → Pages → Build and deployment → Source: **GitHub Actions***. (Alternativa: “Deploy from a branch” → `main` / `(root)`; en ese caso borrá el workflow para que no falle.)

## Probar localmente

```bash
python3 -m http.server 8000
# http://localhost:8000/?d=pole&f=2026-10-02&h=19:00
```
Sin `SCRIPT_URL` configurada, el botón de pago avisa que la reserva online no está activa y deriva a WhatsApp.
