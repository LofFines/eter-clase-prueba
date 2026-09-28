/**
 * Espacio Éter · Reserva y pago de la clase de prueba
 * Backend en Google Apps Script (app web pegada a una planilla; escribe en la solapa sheetId 934024988).
 * Falla cerrado: si la configuración no es válida para el MODE, no procesa nada (create, verify,
 * webhook, reconcile ni escrituras) y lo loguea.
 *
 * Script Properties (Configuración del proyecto > Propiedades de la secuencia de comandos):
 *   MODE             Obligatorio y exacto: "mock" | "sandbox" | "production" (minúsculas).
 *   MOCK_SHEET_ID    id de la planilla PRUEBA (alias aceptado: TEST_SHEET_ID).
 *                    mock y sandbox: obligatorio, y la planilla que usa el script tiene que ser esa.
 *                    production: si está cargado, la planilla NO puede ser esa.
 *   MP_ACCESS_TOKEN  sandbox/production: obligatorio (de prueba en sandbox). No se usa en mock.
 *   MP_COLLECTOR_ID  sandbox/production: obligatorio, solo dígitos (user id de la cuenta que cobra).
 *   WEBHOOK_KEY      sandbox/production: obligatorio, 32+ caracteres. Va en notification_url como
 *                    &k=...; las notificaciones sin esa clave se descartan sin consultar a MP.
 *   WEBAPP_URL       sandbox/production: obligatorio, https://…/exec (base de notification_url).
 *   SHEET_ID         (opcional) id de la planilla. Si falta, usa la planilla contenedora.
 *   SITE_URL         https://loffines.github.io/eter-clase-prueba/
 *
 * Seguridad:
 *   - El precio (5000) y la moneda (ARS) están fijos acá; el navegador no los puede cambiar.
 *   - Nunca se anota una fila con datos que manda el navegador: en sandbox/producción los datos
 *     salen del pago consultado a Mercado Pago con nuestro token (metadata, revalidada con
 *     validarReserva_) y solo si está aprobado por $5.000 ARS, con referencia "ETER-", cobrado por
 *     MP_COLLECTOR_ID y con live_mode acorde al modo. En mock salen del caché del create.
 *   - verify solo devuelve datos si la external_reference del pedido coincide con la del pago.
 *   - Todo texto libre que va a la planilla pasa por textoPlanilla_() (anti fórmulas) y B, D y K
 *     tienen formato texto.
 *   - En mock y sandbox la columna G dice "PRUEBA" (nunca "Sí") y K lo aclara.
 *   - Escritura: primero K (con "id <payment_id>", reserva la fila) y después A:I; J nunca se toca.
 *   - El token jamás se loguea ni se devuelve.
 */

// ───────────────────────── Constantes ─────────────────────────
var ETER = {
  PRECIO: 5000,
  MONEDA: 'ARS',
  SHEET_GID: 934024988,          // solapa "Clase de prueba" (se busca por id, no por nombre)
  TZ: 'America/Argentina/Buenos_Aires',
  MP_API: 'https://api.mercadopago.com',
  REF_PREFIX: 'ETER-',
  MODOS: ['mock', 'sandbox', 'production'],
  VENCIMIENTO_HORAS: 48,
  CACHE_TTL: 21600,              // 6 h (máximo de CacheService)
  // slug (parámetro d del link) → nombre exacto que va a la columna E (tiene que coincidir con su lista).
  DISCIPLINAS: {
    'pole-sport': 'Pole sport',
    'pole-coreo': 'Pole coreo',
    'funcional': 'Funcional',
    'bachata': 'Bachata',
    'salsa': 'Salsa',
    'acro-adultos': 'Acro adultos',
    'acro-infantil': 'Acro infantil',
    'flexibilidad': 'Flexibilidad'
  },
  // Mismas opciones que la validación de datos de la columna D ("Anuncio de origen").
  ORIGENES_VALIDOS: ['3 segundos', 'salsa', 'bachata', 'comunidad', 'genio', 'Orgánico / IG', 'Recomendación', 'No sabe'],
  ORIGEN_SI_NO_COINCIDE: 'No sabe',
  // Columnas (1 = A)
  COL: { A: 1, K: 11 },
  FORMATO_FECHA: 'dd/mm',        // formato que ya usa la columna A
  FORMATO_FECHA_HORA: 'dd/mm HH:mm' // formato que ya usa la columna F
};

// ───────────────────────── Configuración ─────────────────────────
function cfg_() {
  var p = PropertiesService.getScriptProperties();
  // Sin default ni minúsculas: si MODE no es exactamente uno de ETER.MODOS, el modo queda inválido
  // y configError_() hace que todo falle cerrado. (Solo se recortan espacios al principio/final.)
  var mode = String(p.getProperty('MODE') || '').trim();
  var site = String(p.getProperty('SITE_URL') || 'https://loffines.github.io/eter-clase-prueba/').trim();
  if (site.slice(-1) !== '/') site += '/';
  return {
    mode: mode,
    modeOk: ETER.MODOS.indexOf(mode) !== -1,
    token: String(p.getProperty('MP_ACCESS_TOKEN') || '').trim(),
    sheetId: String(p.getProperty('SHEET_ID') || '').trim(),
    mockSheetId: String(p.getProperty('MOCK_SHEET_ID') || '').trim(),
    testSheetIdAlias: String(p.getProperty('TEST_SHEET_ID') || '').trim(), // alias de MOCK_SHEET_ID
    webhookKey: String(p.getProperty('WEBHOOK_KEY') || ''),
    collectorId: String(p.getProperty('MP_COLLECTOR_ID') || '').trim(),
    siteUrl: site,
    webappUrl: String(p.getProperty('WEBAPP_URL') || '').trim()
  };
}

/** MOCK_SHEET_ID (o su alias TEST_SHEET_ID). Si están los dos y son distintos: ambiguo → null. */
function idPlanillaPrueba_(c) {
  if (c.mockSheetId && c.testSheetIdAlias && c.mockSheetId !== c.testSheetIdAlias) return null;
  return c.mockSheetId || c.testSheetIdAlias || '';
}

/**
 * Devuelve '' si la configuración permite operar, o los motivos (para el log) si no.
 * - MODE tiene que ser exactamente mock | sandbox | production.
 * - sandbox/production: MP_ACCESS_TOKEN, MP_COLLECTOR_ID (dígitos), WEBHOOK_KEY (32+) y
 *   WEBAPP_URL (https://) obligatorios.
 * - mock y sandbox: solo sobre la planilla MOCK_SHEET_ID. production: nunca sobre esa planilla.
 */
function motivoConfigInvalida_(c) {
  if (!c.modeOk) return 'MODE inválido o vacío (tiene que ser exactamente mock, sandbox o production)';
  var m = [];
  if (c.mode !== 'mock') {
    if (!c.token) m.push('falta MP_ACCESS_TOKEN');
    if (!/^\d+$/.test(c.collectorId)) m.push('MP_COLLECTOR_ID falta o no es solo dígitos');
    if (c.webhookKey.length < 32) m.push('WEBHOOK_KEY falta o tiene menos de 32 caracteres');
    if (!/^https:\/\/\S+$/.test(c.webappUrl)) m.push('WEBAPP_URL falta o no empieza con https://');
  }
  var prueba = idPlanillaPrueba_(c);
  if (prueba === null) {
    m.push('MOCK_SHEET_ID y TEST_SHEET_ID son distintos');
  } else if (c.mode === 'mock' || c.mode === 'sandbox' || prueba) {
    var ssId = '';
    try { var ss = getSpreadsheet_(c); ssId = ss ? String(ss.getId()) : ''; } catch (err) { ssId = ''; }
    if (c.mode === 'mock' || c.mode === 'sandbox') {
      if (!prueba) m.push('MODE=' + c.mode + ' sin MOCK_SHEET_ID');
      else if (!ssId) m.push('MODE=' + c.mode + ' pero no hay planilla');
      else if (ssId !== prueba) m.push('MODE=' + c.mode + ' pero la planilla no es la de MOCK_SHEET_ID');
    } else if (ssId && ssId === prueba) {
      m.push('MODE=production sobre la planilla de prueba (MOCK_SHEET_ID)');
    }
  }
  return m.join('; ');
}

/** null si está todo bien; si no, loguea y devuelve la respuesta de error (ok:false, sin detalles). */
function configError_(c, donde) {
  var motivo = motivoConfigInvalida_(c);
  if (!motivo) return null;
  console.error('config (' + donde + '): ' + motivo + '. No se procesa nada.');
  return { ok: false, error: 'config', message: 'La reserva online no está disponible en este momento.' };
}

// ───────────────────────── Entradas HTTP ─────────────────────────
/** Health check: GET a la URL /exec. No expone nada (ni el modo ni si hay token). */
function doGet() {
  return json_({ ok: true });
}

function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var raw = (e && e.postData && e.postData.contents) || '';
    var body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (err) { body = null; }

    if (body && (body.action === 'create' || body.action === 'verify')) {
      var errCfg = configError_(cfg_(), 'doPost ' + body.action);
      if (errCfg) return json_(errCfg);
      return json_(body.action === 'create' ? handleCreate_(body) : handleVerify_(body));
    }

    // Si no es una acción nuestra, lo tratamos como notificación de Mercado Pago
    // (Webhooks: ?type=payment&data.id=123 / body {type, data:{id}}; IPN: ?topic=payment&id=123).
    var tipo = String(params.type || params.topic || (body && (body.type || body.topic)) || '').toLowerCase();
    if (tipo) {
      // Sin la clave correcta (&k= en notification_url) se descarta en silencio: no se consulta a MP.
      var c = cfg_();
      if (!claveWebhookOk_(params.k, c.webhookKey)) return json_({ ok: true });
      var errWh = configError_(c, 'webhook');
      if (errWh) return json_(errWh);
      if (tipo.indexOf('payment') === 0) {
        var id = params['data.id'] || (body && body.data && body.data.id) || params.id || idDesdeResource_(body && body.resource);
        if (id) handleWebhook_(String(id));
        return json_({ ok: true });
      }
      // Otras notificaciones (merchant_order, etc.): se aceptan y se ignoran.
      return json_({ ok: true, ignored: tipo });
    }
    return json_({ ok: false, error: 'bad_request', message: 'Pedido no reconocido.' });
  } catch (err) {
    console.error('doPost error: ' + (err && err.message));
    return json_({ ok: false, error: 'internal', message: 'Tuvimos un problema técnico.' });
  }
}

// ───────────────────────── create ─────────────────────────
function handleCreate_(b) {
  var c = cfg_();
  var errCfg = configError_(c, 'create');
  if (errCfg) return errCfg;
  var v = validarReserva_(b);
  if (!v.ok) return { ok: false, error: 'invalid', message: v.message };
  var datos = v.datos;
  var reservaId = nuevaReserva_();
  datos.reserva_id = reservaId;

  var cache = CacheService.getScriptCache();
  cache.put('res_' + reservaId, JSON.stringify(datos), ETER.CACHE_TTL);

  if (c.mode === 'mock') {
    var mockId = 'MOCK-' + Utilities.getUuid().toUpperCase(); // no predecible
    cache.put('mockpay_' + mockId, reservaId, ETER.CACHE_TTL);
    var url = c.siteUrl + 'confirmacion.html?payment_id=' + encodeURIComponent(mockId) +
      '&status=approved&external_reference=' + encodeURIComponent(reservaId);
    return { ok: true, mode: 'mock', reserva_id: reservaId, init_point: url };
  }

  if (!c.token) {
    console.error('create: falta MP_ACCESS_TOKEN en modo ' + c.mode);
    return { ok: false, error: 'config', message: 'El pago online no está configurado todavía.' };
  }

  var titulo = 'Clase de prueba – ' + ETER.DISCIPLINAS[datos.disciplina];
  var ahora = new Date();
  var vence = new Date(ahora.getTime() + ETER.VENCIMIENTO_HORAS * 3600 * 1000);
  var pref = {
    items: [{
      id: 'clase-prueba-' + datos.disciplina,
      title: titulo,
      description: 'Espacio Éter · ' + datos.fecha + ' ' + datos.hora + ' hs',
      category_id: 'services',
      quantity: 1,
      unit_price: ETER.PRECIO,       // fijo del lado del servidor
      currency_id: ETER.MONEDA       // fijo del lado del servidor
    }],
    payer: { name: datos.nombre },
    external_reference: reservaId,
    metadata: {
      reserva_id: reservaId,
      nombre: datos.nombre,
      whatsapp: datos.whatsapp,
      disciplina: datos.disciplina,
      fecha: datos.fecha,
      hora: datos.hora,
      origen: datos.origen
    },
    back_urls: {
      success: c.siteUrl + 'confirmacion.html',
      pending: c.siteUrl + 'confirmacion.html',
      failure: c.siteUrl + 'confirmacion.html'
    },
    auto_return: 'approved',
    statement_descriptor: 'ESPACIO ETER',
    expires: true,
    expiration_date_from: isoAr_(ahora),
    expiration_date_to: isoAr_(vence)
  };
  // motivoConfigInvalida_ ya garantiza WEBAPP_URL https:// y WEBHOOK_KEY de 32+ caracteres.
  pref.notification_url = c.webappUrl + '?src=mp&k=' + encodeURIComponent(c.webhookKey);

  var res = mpFetch_('post', '/checkout/preferences', pref, c.token, reservaId);
  if (res.code !== 200 && res.code !== 201) {
    console.error('create: MP respondió ' + res.code + ' ' + resumenError_(res.data));
    return { ok: false, error: 'mp', message: 'Mercado Pago no respondió como esperábamos.' };
  }
  var initPoint = c.mode === 'sandbox'
    ? (res.data.sandbox_init_point || res.data.init_point)
    : res.data.init_point;
  if (!initPoint) return { ok: false, error: 'mp', message: 'No recibimos el link de pago.' };
  return { ok: true, mode: c.mode, reserva_id: reservaId, init_point: initPoint };
}

// ───────────────────────── verify ─────────────────────────
function handleVerify_(b) {
  var c = cfg_();
  var errCfg = configError_(c, 'verify');
  if (errCfg) return errCfg;
  var paymentId = String(b.payment_id || '').trim();
  var ref = String(b.external_reference || '').trim();
  if (!/^(MOCK-[A-Z0-9-]{1,60}|\d{1,20})$/.test(paymentId)) {
    return { ok: false, error: 'invalid', message: 'Número de operación inválido.' };
  }
  // Sin una referencia "ETER-" no se devuelve nada (ni siquiera se consulta el pago).
  if (ref.indexOf(ETER.REF_PREFIX) !== 0 || ref.length > 64) {
    return { ok: false, error: 'invalid_ref', message: 'Falta la referencia de la reserva.' };
  }

  // Pagos simulados
  if (paymentId.indexOf('MOCK-') === 0) {
    if (c.mode !== 'mock') return { ok: false, error: 'mock_disabled', message: 'Los pagos de prueba no están habilitados.' };
    var cache = CacheService.getScriptCache();
    var reservaId = cache.get('mockpay_' + paymentId);
    if (!reservaId || ref !== reservaId) return { ok: false, error: 'not_found', message: 'No encontramos ese pago de prueba.' };
    var datosMock = leerJson_(cache.get('res_' + reservaId));
    if (!datosMock) return { ok: false, error: 'not_found', message: 'La reserva de prueba venció (más de 6 h).' };
    var r = registrar_(paymentId, datosMock, c);
    return { ok: true, mode: 'mock', mock: true, status: 'approved', payment_id: paymentId, registrado: r.ok, reserva: vistaPublica_(datosMock) };
  }

  if (c.mode === 'mock') return { ok: false, error: 'mode_mock', message: 'El sistema está en modo prueba.' };
  if (!c.token) return { ok: false, error: 'config', message: 'El pago online no está configurado todavía.' };

  var pago = obtenerPago_(paymentId, c.token);
  if (!pago) return { ok: false, error: 'not_found', message: 'Todavía no vemos ese pago.' };
  // La referencia tiene que coincidir ANTES de devolver cualquier dato del pago.
  if (String(pago.external_reference || '') !== ref) {
    return { ok: false, error: 'mismatch', message: 'El pago no coincide con la reserva.' };
  }
  var dv = datosValidadosDePago_(pago);
  var datos = dv.ok ? dv.datos : null;
  var check = pagoValido_(pago, c);
  if (check.ok) {
    if (!dv.ok) {
      return { ok: false, error: 'invalid_metadata', message: 'Recibimos el pago pero no pudimos anotarlo solos. Escribinos y lo resolvemos.' };
    }
    var reg = registrar_(String(pago.id), datos, c);
    return { ok: true, mode: c.mode, status: 'approved', payment_id: String(pago.id), registrado: reg.ok, reserva: vistaPublica_(datos) };
  }
  if (pago.status === 'approved') {
    // Aprobado pero no es una clase de prueba válida (monto/moneda/referencia distintos).
    console.warn('verify: pago aprobado no válido ' + pago.id + ' (' + check.motivo + ')');
    return { ok: false, error: 'invalid_payment', message: 'Ese pago no corresponde a una clase de prueba.' };
  }
  return { ok: true, mode: c.mode, status: pago.status, status_detail: pago.status_detail, payment_id: String(pago.id), reserva: vistaPublica_(datos) };
}

// ───────────────────────── webhook ─────────────────────────
function handleWebhook_(id) {
  var c = cfg_();
  var errCfg = configError_(c, 'webhook');
  if (errCfg) return errCfg;
  if (c.mode === 'mock' || !c.token) return { ok: true };
  if (!/^\d{1,20}$/.test(id)) return { ok: true };
  var pago = obtenerPago_(id, c.token);   // se re-consulta siempre: no confiamos en el cuerpo de la notificación
  if (!pago) return { ok: true };
  if (pagoValido_(pago, c).ok) {
    var dv = datosValidadosDePago_(pago);
    if (dv.ok) registrar_(String(pago.id), dv.datos, c);
  }
  return { ok: true };
}

/** Compara la clave del webhook sin cortar en el primer carácter distinto. Sin WEBHOOK_KEY, nada pasa. */
function claveWebhookOk_(recibida, esperada) {
  var a = String(recibida == null ? '' : recibida), b = String(esperada || '');
  if (!b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ───────────────────────── Conciliación ─────────────────────────
/** Cada 15 min: busca pagos aprobados de los últimos 3 días y anota los que falten. */
function reconcile() {
  var c = cfg_();
  var errCfg = configError_(c, 'reconcile');
  if (errCfg) return errCfg;
  if (c.mode === 'mock') { console.log('reconcile: modo mock, no hace nada.'); return { ok: true }; }
  if (!c.token) { console.warn('reconcile: falta MP_ACCESS_TOKEN.'); return { ok: false, error: 'config' }; }
  var offset = 0, limit = 50, escritos = 0, revisados = 0;
  for (var page = 0; page < 10; page++) {
    var path = '/v1/payments/search?sort=date_created&criteria=desc&range=date_created' +
      '&begin_date=NOW-3DAYS&end_date=NOW&status=approved&limit=' + limit + '&offset=' + offset;
    var res = mpFetch_('get', path, null, c.token);
    if (res.code !== 200 || !res.data) { console.error('reconcile: MP respondió ' + res.code); return { ok: false, error: 'mp' }; }
    var results = res.data.results || [];
    for (var i = 0; i < results.length; i++) {
      var p = results[i];
      revisados++;
      if (!pagoValido_(p, c).ok) continue;
      if (!p.metadata || !p.metadata.nombre) p = obtenerPago_(String(p.id), c.token) || p;
      var dv = datosValidadosDePago_(p);
      if (!dv.ok) continue;
      var r = registrar_(String(p.id), dv.datos, c);
      if (r.written) escritos++;
    }
    var total = (res.data.paging && res.data.paging.total) || 0;
    offset += limit;
    if (results.length < limit || offset >= total) break;
  }
  console.log('reconcile: revisados ' + revisados + ', anotados ' + escritos);
  return { ok: true, revisados: revisados, anotados: escritos };
}

/** Correr una vez desde el editor: instala el trigger de conciliación cada 15 minutos. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'reconcile') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reconcile').timeBased().everyMinutes(15).create();
  console.log('Trigger "reconcile" instalado (cada 15 min).');
}

// ───────────────────────── Planilla ─────────────────────────
function getSpreadsheet_(cfg) {
  var c = cfg || cfg_();
  return c.sheetId ? SpreadsheetApp.openById(c.sheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(cfg) {
  var ss = getSpreadsheet_(cfg);
  if (!ss) throw new Error('No hay planilla: cargá SHEET_ID o pegá el script en la planilla.');
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === ETER.SHEET_GID) return sheets[i];
  }
  throw new Error('No encontré la solapa con sheetId ' + ETER.SHEET_GID + ' ("Clase de prueba").');
}

/**
 * Anota la reserva pagada. Idempotente por payment_id (busca "id <payment_id>" en la columna K).
 * Orden: 1) K con la nota (incluye "id <payment_id>": reserva la fila), 2) A:I. J NO se toca
 * (tiene un ARRAYFORMULA en J2), por eso nunca se escribe A:K de una.
 * Si K ya tiene el id pero B está vacía (fila a medio escribir), se completa esa misma fila.
 * Si falla la escritura de A:I, K queda y el próximo intento (verify/webhook/reconcile) la completa.
 */
function registrar_(paymentId, datos, cfg) {
  var c = cfg || cfg_();
  var motivo = motivoConfigInvalida_(c);
  if (motivo) {
    console.error('registrar_: config inválida (' + motivo + '); no se anota ' + paymentId);
    return { ok: false, written: false, error: 'config' };
  }
  if (!datos || !datos.nombre || !disciplinaValida_(datos.disciplina)) {
    console.error('registrar_: datos incompletos para el pago ' + paymentId);
    return { ok: false, written: false, error: 'datos' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    console.error('registrar_: no se pudo tomar el lock para ' + paymentId);
    return { ok: false, written: false, error: 'lock' };
  }
  try {
    var sheet = getSheet_(c);
    var maxRows = sheet.getMaxRows();
    var data = maxRows > 1 ? sheet.getRange(2, 1, maxRows - 1, ETER.COL.K).getValues() : [];

    // 1) ¿Ya está anotado? (K con el id). Con B llena: duplicado. Con B vacía: completar esa fila.
    var re = new RegExp('(^|[^0-9A-Za-z-])id ' + escapeRe_(paymentId) + '(?![0-9A-Za-z-])');
    var row = -1, completar = false;
    for (var i = 0; i < data.length; i++) {
      if (re.test(String(data[i][10] || ''))) {
        if (String(data[i][1] || '') !== '') return { ok: true, written: false, duplicate: true, row: i + 2 };
        row = i + 2; completar = true;
        console.warn('registrar_: la fila ' + row + ' tenía el id ' + paymentId + ' en K pero B vacía; la completo.');
        break;
      }
    }

    // 2) Si no: primera fila vacía (A:I y K vacías; J es fórmula), para no pisar algo a medio cargar.
    if (row === -1) {
      for (var j = 0; j < data.length; j++) {
        var r = data[j];
        var vacia = true;
        for (var k = 0; k < ETER.COL.K; k++) {
          if (k === 9) continue; // J: fórmula
          if (r[k] !== '' && r[k] !== null) { vacia = false; break; }
        }
        if (vacia) { row = j + 2; break; }
      }
    }
    if (row === -1) {
      sheet.insertRowsAfter(maxRows, 50);
      row = maxRows + 1;
      console.warn('registrar_: la solapa estaba llena, agregué 50 filas (el ARRAYFORMULA de J llega hasta la fila 1000).');
    }

    var prueba = c.mode === 'mock' || c.mode === 'sandbox';
    var origen = origenParaPlanilla_(datos.origen);
    // Fechas como número de serie de Sheets (hora de pared de Argentina), no como Date:
    // así no depende de la zona horaria de la planilla ni del script, y Sheets no pisa el formato.
    var hoy = serialSheets_(Utilities.formatDate(new Date(), ETER.TZ, 'yyyy-MM-dd'), '00:00');
    var clase = serialSheets_(datos.fecha, datos.hora);
    var prefijoNota = c.mode === 'mock' ? 'PRUEBA (mock), no se cobró · id '
      : c.mode === 'sandbox' ? 'SANDBOX, no es plata real · id '
      : 'Pagó $5.000 MP · id ';
    var nota = prefijoNota + paymentId + (origen.nota ? ' · ' + origen.nota : '');

    // Formatos: A dd/mm, F dd/mm HH:mm (números); B, C, D y K texto ("1e5" no se vuelve número).
    sheet.getRange(row, 1).setNumberFormat(ETER.FORMATO_FECHA);
    sheet.getRange(row, 2).setNumberFormat('@');
    sheet.getRange(row, 3).setNumberFormat('@');
    sheet.getRange(row, 4).setNumberFormat('@');
    sheet.getRange(row, 6).setNumberFormat(ETER.FORMATO_FECHA_HORA);
    sheet.getRange(row, ETER.COL.K).setNumberFormat('@');

    // 3) K primero: reserva la fila con el id (si algo falla después, el reintento la encuentra).
    if (!completar) sheet.getRange(row, ETER.COL.K).setValue(textoPlanilla_(nota));

    // 4) A:I (J no se toca).
    try {
      sheet.getRange(row, 1, 1, 9).setValues([[
        hoy,                                   // A Fecha anotación (serial → se ve dd/mm)
        textoPlanilla_(datos.nombre),          // B Nombre (anti fórmulas)
        whatsappPlanilla_(datos.whatsapp),     // C WhatsApp (texto)
        textoPlanilla_(origen.valor),          // D Anuncio de origen (de la lista)
        ETER.DISCIPLINAS[datos.disciplina],    // E Disciplina
        clase,                                 // F Día y hora de la clase (serial → dd/mm HH:mm; alimenta la fórmula de J)
        prueba ? 'PRUEBA' : 'Sí',              // G ¿Confirmó? (en mock/sandbox nunca "Sí")
        '',                                    // H ¿Vino?
        ''                                     // I ¿Volvió / se inscribió?
      ]]);
      SpreadsheetApp.flush();
    } catch (err) {
      console.error('registrar_: falló la escritura de A:I en la fila ' + row + ' para ' + paymentId +
        ' (' + (err && err.message) + '). K queda con el id; el próximo intento completa la fila.');
      return { ok: false, written: false, error: 'escritura', row: row };
    }
    console.log('registrar_: anotado pago ' + paymentId + ' en fila ' + row + (completar ? ' (completada)' : ''));
    return { ok: true, written: true, row: row, completed: completar };
  } finally {
    lock.releaseLock();
  }
}

/** Escribe una fila de prueba (MOCK) desde el editor. Usala en la copia PRUEBA de la planilla. */
function selfTest() {
  var c = cfg_();
  var motivo = motivoConfigInvalida_(c);
  if (motivo) throw new Error('selfTest: ' + motivo);
  if (c.mode !== 'mock') throw new Error('selfTest solo corre con MODE=mock (sobre la planilla MOCK_SHEET_ID).');
  var manana = Utilities.formatDate(new Date(Date.now() + 24 * 3600 * 1000), ETER.TZ, 'yyyy-MM-dd');
  var datos = {
    reserva_id: nuevaReserva_(),
    nombre: 'Prueba selfTest',
    whatsapp: '5491100000000',
    disciplina: 'pole-sport',
    fecha: manana,
    hora: '19:00',
    origen: 'Orgánico / IG'
  };
  var pid = 'MOCK-SELFTEST-' + Utilities.getUuid().toUpperCase();
  var ss = getSpreadsheet_(c);
  console.log('selfTest: escribiendo en "' + ss.getName() + '"');
  var r1 = registrar_(pid, datos, c);
  var r2 = registrar_(pid, datos, c); // segunda vez: no debe duplicar
  console.log('selfTest: primera escritura ' + JSON.stringify(r1) + ' · segunda (debe ser duplicate) ' + JSON.stringify(r2));
  if (!r1.written || !r2.duplicate) throw new Error('selfTest falló: revisá el log.');
}

/** Muestra la configuración sin exponer el token. */
function checkConfig() {
  var c = cfg_();
  var sheet = getSheet_(c);
  console.log(JSON.stringify({
    mode: c.mode,
    config_ok: !motivoConfigInvalida_(c),
    config_problema: motivoConfigInvalida_(c) || '(ninguno)',
    planilla_id_es_prueba: sheet.getParent().getId() === idPlanillaPrueba_(c),
    token_cargado: !!c.token,
    webhook_key_cargada: !!c.webhookKey,
    collector_id: c.collectorId || '(sin cargar)',
    sheet: sheet.getParent().getName() + ' › ' + sheet.getName(),
    zona_planilla: sheet.getParent().getSpreadsheetTimeZone(),
    site_url: c.siteUrl,
    webapp_url: c.webappUrl || '(falta)',
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); })
  }, null, 2));
}

// ───────────────────────── Mercado Pago ─────────────────────────
function mpFetch_(method, path, payload, token, idempotencyKey) {
  var opts = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (idempotencyKey) opts.headers['X-Idempotency-Key'] = idempotencyKey;
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  var resp = UrlFetchApp.fetch(ETER.MP_API + path, opts);
  var data = null;
  try { data = JSON.parse(resp.getContentText()); } catch (e) { data = null; }
  return { code: resp.getResponseCode(), data: data };
}

function obtenerPago_(id, token) {
  var res = mpFetch_('get', '/v1/payments/' + encodeURIComponent(id), null, token);
  if (res.code === 200 && res.data && res.data.id) return res.data;
  if (res.code !== 404) console.error('obtenerPago_: MP respondió ' + res.code + ' para ' + id);
  return null;
}

/**
 * Solo acepta: aprobado, $5.000, ARS, referencia de esta landing, cobrado por MP_COLLECTOR_ID
 * (obligatorio fuera de mock) y live_mode acorde al MODE (true solo en production).
 */
function pagoValido_(p, cfg) {
  var c = cfg || cfg_();
  if (!p) return { ok: false, motivo: 'sin pago' };
  if (p.status !== 'approved') return { ok: false, motivo: 'status ' + p.status };
  if (Number(p.transaction_amount) !== ETER.PRECIO) return { ok: false, motivo: 'monto ' + p.transaction_amount };
  if (p.currency_id !== ETER.MONEDA) return { ok: false, motivo: 'moneda ' + p.currency_id };
  if (String(p.external_reference || '').indexOf(ETER.REF_PREFIX) !== 0) return { ok: false, motivo: 'referencia' };
  if (!c.collectorId || String(p.collector_id) !== c.collectorId) return { ok: false, motivo: 'collector ' + p.collector_id };
  if (p.live_mode !== (c.mode === 'production')) return { ok: false, motivo: 'live_mode ' + p.live_mode };
  return { ok: true };
}

/** Datos de la reserva: metadata del pago y, si falta, lo guardado en el create. */
function datosDePago_(p) {
  var m = (p && p.metadata) || {};
  var d = {
    reserva_id: m.reserva_id || p.external_reference || '',
    nombre: m.nombre || '',
    whatsapp: m.whatsapp || '',
    disciplina: String(m.disciplina || '').trim().toLowerCase(),
    fecha: m.fecha || '',
    hora: m.hora || '',
    origen: m.origen || ''
  };
  if (!d.nombre && p && p.external_reference) {
    var c = leerJson_(CacheService.getScriptCache().get('res_' + p.external_reference));
    if (c) d = c;
  }
  return d;
}

/**
 * Datos del pago revalidados con las mismas reglas que el create (disciplina, fecha, hora, nombre con
 * letras, celular). Se permite una clase ya pasada: el pago pudo aprobarse antes y anotarse tarde.
 * Devuelve { ok, datos } o { ok:false, motivo } (y lo loguea).
 */
function datosValidadosDePago_(p) {
  var d = datosDePago_(p);
  var v = validarReserva_({
    nombre: d.nombre, whatsapp: d.whatsapp, disciplina: d.disciplina,
    fecha: d.fecha, hora: d.hora, origen: d.origen
  }, { permitirPasada: true });
  if (!v.ok) {
    console.error('metadata inválida en el pago ' + (p && p.id) + ': ' + v.message + ' No se anota.');
    return { ok: false, motivo: v.message };
  }
  v.datos.reserva_id = d.reserva_id || (p && p.external_reference) || '';
  return { ok: true, datos: v.datos };
}

// ───────────────────────── Validaciones ─────────────────────────
function validarReserva_(b, opciones) {
  var permitirPasada = !!(opciones && opciones.permitirPasada);
  var disciplina = String(b.disciplina || '').trim().toLowerCase();
  var fecha = String(b.fecha || '').trim();
  var hora = String(b.hora || '').trim();
  var nombre = sinInvisibles_(String(b.nombre || '')).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  var origen = sinInvisibles_(String(b.origen || '')).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'WhatsApp';

  if (!disciplinaValida_(disciplina)) return { ok: false, message: 'La disciplina no es válida.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !fechaReal_(fecha)) return { ok: false, message: 'La fecha no es válida.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { ok: false, message: 'La hora no es válida.' };
  var ahora = Utilities.formatDate(new Date(), ETER.TZ, 'yyyy-MM-dd HH:mm');
  if (!permitirPasada && fecha + ' ' + hora < ahora) return { ok: false, message: 'Esa clase ya pasó.' };
  if (nombre.length < 2 || nombre.length > 60) return { ok: false, message: 'Revisá el nombre.' };
  if (!LETRA_RE.test(nombre)) return { ok: false, message: 'Revisá el nombre: tiene que tener al menos una letra.' };
  // (La protección contra fórmulas se aplica al escribir en la planilla: textoPlanilla_.)
  var wa = normalizarCelular_(b.whatsapp);
  if (!wa) return { ok: false, message: 'Revisá el WhatsApp (celular argentino con código de área).' };

  return { ok: true, datos: { nombre: nombre, whatsapp: wa, disciplina: disciplina, fecha: fecha, hora: hora, origen: origen } };
}

/** Slug en minúsculas con guiones ("pole-sport") y que exista en ETER.DISCIPLINAS (propio, no heredado). */
function disciplinaValida_(d) {
  return typeof d === 'string' && /^[a-z]+(-[a-z]+)*$/.test(d) &&
    Object.prototype.hasOwnProperty.call(ETER.DISCIPLINAS, d);
}

function fechaReal_(f) {
  var y = +f.slice(0, 4), m = +f.slice(5, 7), d = +f.slice(8, 10);
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Devuelve "549XXXXXXXXXX" (10 dígitos nacionales) o null. Misma lógica que el front. */
function normalizarCelular_(valor) {
  var n = String(valor || '').replace(/\D/g, '');
  if (n.indexOf('549') === 0 && n.length >= 13) n = n.slice(3);
  else if (n.indexOf('54') === 0 && n.length >= 12) n = n.slice(2);
  if (n.charAt(0) === '0') n = n.slice(1);
  if (n.length === 12) {
    var largos = n.indexOf('11') === 0 ? [2] : [3, 4];
    for (var i = 0; i < largos.length; i++) {
      var a = largos[i];
      if (n.substr(a, 2) === '15') { n = n.slice(0, a) + n.slice(a + 2); break; }
    }
  }
  return /^[1-3]\d{9}$/.test(n) ? '549' + n : null;
}

/** "5491123978429" → "+54 9 11 2397-8429" */
function whatsappVisible_(e164) {
  var n = String(e164 || '').replace(/\D/g, '');
  if (n.indexOf('549') === 0) n = n.slice(3);
  if (n.length !== 10) return String(e164 || '');
  return n.indexOf('11') === 0 ? '+54 9 11 ' + n.slice(2, 6) + '-' + n.slice(6) : '+54 9 ' + n;
}

/**
 * La columna D tiene una lista cerrada. Si el origen coincide (sin importar mayúsculas/tildes) se usa
 * tal cual la lista; si no (por ejemplo "WhatsApp", el default), se anota "No sabe" y el valor
 * original va a Notas, así el resumen "Por anuncio" sigue cerrando.
 */
function origenParaPlanilla_(origen) {
  var raw = sinInvisibles_(String(origen || '')).trim();
  var norm = function (s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var alias = { 'organico': 'Orgánico / IG', 'ig': 'Orgánico / IG', 'instagram': 'Orgánico / IG', 'organico/ig': 'Orgánico / IG' };
  var n = norm(raw);
  for (var i = 0; i < ETER.ORIGENES_VALIDOS.length; i++) {
    if (norm(ETER.ORIGENES_VALIDOS[i]) === n) return { valor: ETER.ORIGENES_VALIDOS[i], nota: '' };
  }
  if (alias[n.replace(/\s/g, '')]) return { valor: alias[n.replace(/\s/g, '')], nota: '' };
  return { valor: ETER.ORIGEN_SI_NO_COINCIDE, nota: raw ? 'origen: ' + textoPlanilla_(raw) : '' };
}

// ───────────────────────── Anti fórmulas (planilla) ─────────────────────────
// Caracteres invisibles / de control de dirección que podrían esconder un "=" al principio.
var INVISIBLES_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD\u061C\u180E]/g;
// Al menos una letra (cualquier alfabeto, con tildes y ñ). \p{L} existe en V8; si no, rango latino.
var LETRA_RE = (function () {
  try { return new RegExp('\\p{L}', 'u'); } catch (e) { return /[A-Za-zÀ-ÖØ-öø-ÿÑñ]/; }
})();

function sinInvisibles_(s) { return String(s == null ? '' : s).replace(INVISIBLES_RE, ''); }

/**
 * Texto libre → valor seguro para Sheets: saca invisibles, cambia controles por espacios, recorta y,
 * si empieza con = + - @ tab \r o ', le antepone un apóstrofo (Sheets lo toma como texto y no lo muestra).
 * El resultado nunca empieza con un carácter de fórmula.
 */
function textoPlanilla_(valor) {
  var s = sinInvisibles_(valor).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (/^[=+\-@\t\r']/.test(s)) s = "'" + s;
  return s;
}

/**
 * Columna C: el formato propio "+54 9 11 2397-8429" (solo dígitos, espacios, + y -, en una celda con
 * formato texto) va tal cual, como siempre. Cualquier otra cosa pasa por textoPlanilla_().
 */
function whatsappPlanilla_(e164) {
  var v = whatsappVisible_(e164);
  return /^\+54 9 [0-9][0-9 -]{8,14}$/.test(v) ? v : textoPlanilla_(v);
}

// ───────────────────────── Utilidades ─────────────────────────
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function nuevaReserva_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 5; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return ETER.REF_PREFIX + Utilities.formatDate(new Date(), ETER.TZ, 'yyMMdd-HHmm') + '-' + s;
}

function vistaPublica_(d) {
  if (!d) return null;
  return {
    nombre: String(d.nombre || '').split(' ')[0], // solo el primer nombre, nada de teléfono
    d: d.disciplina, f: d.fecha, h: d.hora
  };
}

function isoAr_(date) {
  return Utilities.formatDate(date, ETER.TZ, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
}

function idDesdeResource_(resource) {
  if (!resource) return '';
  var m = String(resource).match(/(\d{6,20})\s*$/);
  return m ? m[1] : '';
}

function leerJson_(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function escapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** "2026-10-09", "19:00" → número de serie de Sheets (días desde 30/12/1899), sin zonas horarias. */
function serialSheets_(fecha, hora) {
  var y = +fecha.slice(0, 4), m = +fecha.slice(5, 7), d = +fecha.slice(8, 10);
  var hh = hora ? +hora.slice(0, 2) : 0, mm = hora ? +hora.slice(3, 5) : 0;
  return (Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(1899, 11, 30)) / 86400000;
}

function resumenError_(data) {
  if (!data) return '';
  return String(data.message || data.error || '').slice(0, 200);
}
