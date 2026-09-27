/**
 * Espacio Éter · Reserva y pago de la clase de prueba
 * Backend en Google Apps Script (pegado a la planilla "Control marketing").
 *
 * Script Properties (Configuración del proyecto > Propiedades de la secuencia de comandos):
 *   MODE             "mock" | "sandbox" | "production"   (si falta o es inválido: "mock")
 *   MP_ACCESS_TOKEN  Access Token de Mercado Pago (de prueba en sandbox). NO hace falta en mock.
 *   SHEET_ID         (opcional) id de la planilla. Si falta, usa la planilla contenedora.
 *   SITE_URL         https://loffines.github.io/eter-clase-prueba/
 *   WEBAPP_URL       URL de esta app web (termina en /exec). Se usa para notification_url.
 *
 * Seguridad:
 *   - El precio (5000) y la moneda (ARS) están fijos acá; el navegador no los puede cambiar.
 *   - Nunca se anota una fila con datos que manda el navegador: en sandbox/producción los datos
 *     salen del pago consultado a Mercado Pago con nuestro token (metadata) y solo si está
 *     aprobado por $5.000 ARS con una referencia "ETER-". En mock salen del caché del create.
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
  VENCIMIENTO_HORAS: 48,
  CACHE_TTL: 21600,              // 6 h (máximo de CacheService)
  DISCIPLINAS: { pole: 'Pole', acro: 'Acro', flexi: 'Flexi', danza: 'Danza' },
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
  var mode = String(p.getProperty('MODE') || 'mock').trim().toLowerCase();
  if (['mock', 'sandbox', 'production'].indexOf(mode) === -1) mode = 'mock';
  var site = String(p.getProperty('SITE_URL') || 'https://loffines.github.io/eter-clase-prueba/').trim();
  if (site.slice(-1) !== '/') site += '/';
  return {
    mode: mode,
    token: String(p.getProperty('MP_ACCESS_TOKEN') || '').trim(),
    sheetId: String(p.getProperty('SHEET_ID') || '').trim(),
    siteUrl: site,
    webappUrl: String(p.getProperty('WEBAPP_URL') || '').trim()
  };
}

// ───────────────────────── Entradas HTTP ─────────────────────────
/** Health check: GET a la URL /exec. No expone datos sensibles. */
function doGet() {
  var c = cfg_();
  return json_({ ok: true, service: 'eter-clase-prueba', mode: c.mode, token_cargado: !!c.token });
}

function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var raw = (e && e.postData && e.postData.contents) || '';
    var body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (err) { body = null; }

    if (body && body.action === 'create') return json_(handleCreate_(body));
    if (body && body.action === 'verify') return json_(handleVerify_(body));

    // Si no es una acción nuestra, lo tratamos como notificación de Mercado Pago
    // (Webhooks: ?type=payment&data.id=123 / body {type, data:{id}}; IPN: ?topic=payment&id=123).
    var tipo = String(params.type || params.topic || (body && (body.type || body.topic)) || '').toLowerCase();
    if (tipo.indexOf('payment') === 0) {
      var id = params['data.id'] || (body && body.data && body.data.id) || params.id || idDesdeResource_(body && body.resource);
      if (id) handleWebhook_(String(id));
      return json_({ ok: true });
    }
    // Otras notificaciones (merchant_order, etc.): se aceptan y se ignoran.
    if (tipo) return json_({ ok: true, ignored: tipo });
    return json_({ ok: false, error: 'bad_request', message: 'Pedido no reconocido.' });
  } catch (err) {
    console.error('doPost error: ' + (err && err.message));
    return json_({ ok: false, error: 'internal', message: 'Tuvimos un problema técnico.' });
  }
}

// ───────────────────────── create ─────────────────────────
function handleCreate_(b) {
  var c = cfg_();
  var v = validarReserva_(b);
  if (!v.ok) return { ok: false, error: 'invalid', message: v.message };
  var datos = v.datos;
  var reservaId = nuevaReserva_();
  datos.reserva_id = reservaId;

  var cache = CacheService.getScriptCache();
  cache.put('res_' + reservaId, JSON.stringify(datos), ETER.CACHE_TTL);

  if (c.mode === 'mock') {
    var mockId = 'MOCK-' + Date.now();
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
  if (/^https:\/\//.test(c.webappUrl)) pref.notification_url = c.webappUrl + '?src=mp';

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
  var paymentId = String(b.payment_id || '').trim();
  var ref = String(b.external_reference || '').trim();
  if (!/^(MOCK-[A-Z0-9-]+|\d{1,20})$/.test(paymentId)) {
    return { ok: false, error: 'invalid', message: 'Número de operación inválido.' };
  }

  // Pagos simulados
  if (paymentId.indexOf('MOCK-') === 0) {
    if (c.mode !== 'mock') return { ok: false, error: 'mock_disabled', message: 'Los pagos de prueba no están habilitados.' };
    var cache = CacheService.getScriptCache();
    var reservaId = cache.get('mockpay_' + paymentId);
    if (!reservaId || (ref && ref !== reservaId)) return { ok: false, error: 'not_found', message: 'No encontramos ese pago de prueba.' };
    var datosMock = leerJson_(cache.get('res_' + reservaId));
    if (!datosMock) return { ok: false, error: 'not_found', message: 'La reserva de prueba venció (más de 6 h).' };
    var r = registrar_(paymentId, datosMock);
    return { ok: true, mode: 'mock', mock: true, status: 'approved', payment_id: paymentId, registrado: r.ok, reserva: vistaPublica_(datosMock) };
  }

  if (c.mode === 'mock') return { ok: false, error: 'mode_mock', message: 'El sistema está en modo prueba.' };
  if (!c.token) return { ok: false, error: 'config', message: 'El pago online no está configurado todavía.' };

  var pago = obtenerPago_(paymentId, c.token);
  if (!pago) return { ok: false, error: 'not_found', message: 'Todavía no vemos ese pago.' };
  if (ref && pago.external_reference && ref !== pago.external_reference) {
    return { ok: false, error: 'mismatch', message: 'El pago no coincide con la reserva.' };
  }
  var datos = datosDePago_(pago);
  var check = pagoValido_(pago);
  if (check.ok) {
    var reg = registrar_(String(pago.id), datos);
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
  if (c.mode === 'mock' || !c.token) return;
  if (!/^\d{1,20}$/.test(id)) return;
  var pago = obtenerPago_(id, c.token);   // se re-consulta siempre: no confiamos en el cuerpo de la notificación
  if (!pago) return;
  if (pagoValido_(pago).ok) registrar_(String(pago.id), datosDePago_(pago));
}

// ───────────────────────── Conciliación ─────────────────────────
/** Cada 15 min: busca pagos aprobados de los últimos 3 días y anota los que falten. */
function reconcile() {
  var c = cfg_();
  if (c.mode === 'mock') { console.log('reconcile: modo mock, no hace nada.'); return; }
  if (!c.token) { console.warn('reconcile: falta MP_ACCESS_TOKEN.'); return; }
  var offset = 0, limit = 50, escritos = 0, revisados = 0;
  for (var page = 0; page < 10; page++) {
    var path = '/v1/payments/search?sort=date_created&criteria=desc&range=date_created' +
      '&begin_date=NOW-3DAYS&end_date=NOW&status=approved&limit=' + limit + '&offset=' + offset;
    var res = mpFetch_('get', path, null, c.token);
    if (res.code !== 200 || !res.data) { console.error('reconcile: MP respondió ' + res.code); return; }
    var results = res.data.results || [];
    for (var i = 0; i < results.length; i++) {
      var p = results[i];
      revisados++;
      if (!pagoValido_(p).ok) continue;
      if (!p.metadata || !p.metadata.nombre) p = obtenerPago_(String(p.id), c.token) || p;
      var r = registrar_(String(p.id), datosDePago_(p));
      if (r.written) escritos++;
    }
    var total = (res.data.paging && res.data.paging.total) || 0;
    offset += limit;
    if (results.length < limit || offset >= total) break;
  }
  console.log('reconcile: revisados ' + revisados + ', anotados ' + escritos);
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
function getSpreadsheet_() {
  var c = cfg_();
  return c.sheetId ? SpreadsheetApp.openById(c.sheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_() {
  var ss = getSpreadsheet_();
  if (!ss) throw new Error('No hay planilla: cargá SHEET_ID o pegá el script en la planilla.');
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === ETER.SHEET_GID) return sheets[i];
  }
  throw new Error('No encontré la solapa con sheetId ' + ETER.SHEET_GID + ' ("Clase de prueba").');
}

/**
 * Anota la reserva pagada. Idempotente por payment_id (busca "id <payment_id>" en la columna K).
 * Escribe A:I y K por separado; J NO se toca (tiene un ARRAYFORMULA en J2).
 */
function registrar_(paymentId, datos) {
  if (!datos || !datos.nombre || !ETER.DISCIPLINAS[datos.disciplina]) {
    console.error('registrar_: datos incompletos para el pago ' + paymentId);
    return { ok: false, written: false, error: 'datos' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    console.error('registrar_: no se pudo tomar el lock para ' + paymentId);
    return { ok: false, written: false, error: 'lock' };
  }
  try {
    var sheet = getSheet_();
    var ss = sheet.getParent();
    var tz = ss.getSpreadsheetTimeZone() || ETER.TZ;
    var maxRows = sheet.getMaxRows();
    var data = maxRows > 1 ? sheet.getRange(2, 1, maxRows - 1, ETER.COL.K).getValues() : [];

    // 1) ¿Ya está anotado?
    var re = new RegExp('(^|[^0-9A-Za-z-])id ' + escapeRe_(paymentId) + '(?![0-9A-Za-z-])');
    for (var i = 0; i < data.length; i++) {
      if (re.test(String(data[i][10] || ''))) return { ok: true, written: false, duplicate: true, row: i + 2 };
    }

    // 2) Primera fila vacía (A y B vacías, y sin nada en C:I ni K para no pisar algo a medio cargar).
    var row = -1;
    for (var j = 0; j < data.length; j++) {
      var r = data[j];
      var vacia = true;
      for (var k = 0; k < ETER.COL.K; k++) {
        if (k === 9) continue; // J: fórmula
        if (r[k] !== '' && r[k] !== null) { vacia = false; break; }
      }
      if (vacia) { row = j + 2; break; }
    }
    if (row === -1) {
      sheet.insertRowsAfter(maxRows, 50);
      row = maxRows + 1;
      console.warn('registrar_: la solapa estaba llena, agregué 50 filas (el ARRAYFORMULA de J llega hasta la fila 1000).');
    }

    var origen = origenParaPlanilla_(datos.origen);
    var hoy = Utilities.parseDate(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), tz, 'yyyy-MM-dd');
    var clase = Utilities.parseDate(datos.fecha + ' ' + datos.hora, tz, 'yyyy-MM-dd HH:mm');
    var nota = 'Pagó $5.000 MP · id ' + paymentId + (origen.nota ? ' · ' + origen.nota : '');

    // Formatos: respetamos los de la planilla; si la celda no tiene (filas nuevas), ponemos los mismos.
    var cA = sheet.getRange(row, 1), cC = sheet.getRange(row, 3), cF = sheet.getRange(row, 6);
    if (esFormatoGeneral_(cA.getNumberFormat())) cA.setNumberFormat(ETER.FORMATO_FECHA);
    if (esFormatoGeneral_(cF.getNumberFormat())) cF.setNumberFormat(ETER.FORMATO_FECHA_HORA);
    cC.setNumberFormat('@'); // WhatsApp como texto

    sheet.getRange(row, 1, 1, 9).setValues([[
      hoy,                                   // A Fecha anotación
      datos.nombre,                          // B Nombre
      whatsappVisible_(datos.whatsapp),      // C WhatsApp (texto)
      origen.valor,                          // D Anuncio de origen
      ETER.DISCIPLINAS[datos.disciplina],    // E Disciplina
      clase,                                 // F Día y hora de la clase (fecha real → alimenta la fórmula de J)
      'Sí',                                  // G ¿Confirmó?
      '',                                    // H ¿Vino?
      ''                                     // I ¿Volvió / se inscribió?
    ]]);
    sheet.getRange(row, ETER.COL.K).setValue(nota); // K Notas (J no se toca)
    SpreadsheetApp.flush();
    console.log('registrar_: anotado pago ' + paymentId + ' en fila ' + row);
    return { ok: true, written: true, row: row };
  } finally {
    lock.releaseLock();
  }
}

/** Escribe una fila de prueba (MOCK) desde el editor. Usala en la copia PRUEBA de la planilla. */
function selfTest() {
  var manana = Utilities.formatDate(new Date(Date.now() + 24 * 3600 * 1000), ETER.TZ, 'yyyy-MM-dd');
  var datos = {
    reserva_id: nuevaReserva_(),
    nombre: 'Prueba selfTest',
    whatsapp: '5491100000000',
    disciplina: 'pole',
    fecha: manana,
    hora: '19:00',
    origen: 'Orgánico / IG'
  };
  var pid = 'MOCK-SELFTEST-' + Date.now();
  var ss = getSpreadsheet_();
  console.log('selfTest: escribiendo en "' + ss.getName() + '"');
  var r1 = registrar_(pid, datos);
  var r2 = registrar_(pid, datos); // segunda vez: no debe duplicar
  console.log('selfTest: primera escritura ' + JSON.stringify(r1) + ' · segunda (debe ser duplicate) ' + JSON.stringify(r2));
  if (!r1.written || !r2.duplicate) throw new Error('selfTest falló: revisá el log.');
}

/** Muestra la configuración sin exponer el token. */
function checkConfig() {
  var c = cfg_();
  var sheet = getSheet_();
  console.log(JSON.stringify({
    mode: c.mode,
    token_cargado: !!c.token,
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

/** Solo acepta: aprobado, $5.000, ARS y referencia de esta landing. */
function pagoValido_(p) {
  if (!p) return { ok: false, motivo: 'sin pago' };
  if (p.status !== 'approved') return { ok: false, motivo: 'status ' + p.status };
  if (Number(p.transaction_amount) !== ETER.PRECIO) return { ok: false, motivo: 'monto ' + p.transaction_amount };
  if (p.currency_id !== ETER.MONEDA) return { ok: false, motivo: 'moneda ' + p.currency_id };
  if (String(p.external_reference || '').indexOf(ETER.REF_PREFIX) !== 0) return { ok: false, motivo: 'referencia' };
  return { ok: true };
}

/** Datos de la reserva: metadata del pago y, si falta, lo guardado en el create. */
function datosDePago_(p) {
  var m = (p && p.metadata) || {};
  var d = {
    reserva_id: m.reserva_id || p.external_reference || '',
    nombre: m.nombre || '',
    whatsapp: m.whatsapp || '',
    disciplina: String(m.disciplina || '').toLowerCase(),
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

// ───────────────────────── Validaciones ─────────────────────────
function validarReserva_(b) {
  var disciplina = String(b.disciplina || '').trim().toLowerCase();
  var fecha = String(b.fecha || '').trim();
  var hora = String(b.hora || '').trim();
  var nombre = String(b.nombre || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  var origen = String(b.origen || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40) || 'WhatsApp';

  if (!ETER.DISCIPLINAS[disciplina]) return { ok: false, message: 'La disciplina no es válida.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !fechaReal_(fecha)) return { ok: false, message: 'La fecha no es válida.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { ok: false, message: 'La hora no es válida.' };
  var ahora = Utilities.formatDate(new Date(), ETER.TZ, 'yyyy-MM-dd HH:mm');
  if (fecha + ' ' + hora < ahora) return { ok: false, message: 'Esa clase ya pasó.' };
  if (nombre.length < 2 || nombre.length > 60) return { ok: false, message: 'Revisá el nombre.' };
  // Evita que un nombre se interprete como fórmula en la planilla.
  if (/^[=+\-@]/.test(nombre)) nombre = nombre.replace(/^[=+\-@]+/, '').trim();
  var wa = normalizarCelular_(b.whatsapp);
  if (!wa) return { ok: false, message: 'Revisá el WhatsApp (celular argentino con código de área).' };

  return { ok: true, datos: { nombre: nombre, whatsapp: wa, disciplina: disciplina, fecha: fecha, hora: hora, origen: origen } };
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
  var raw = String(origen || '').trim();
  var norm = function (s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var alias = { 'organico': 'Orgánico / IG', 'ig': 'Orgánico / IG', 'instagram': 'Orgánico / IG', 'organico/ig': 'Orgánico / IG' };
  var n = norm(raw);
  for (var i = 0; i < ETER.ORIGENES_VALIDOS.length; i++) {
    if (norm(ETER.ORIGENES_VALIDOS[i]) === n) return { valor: ETER.ORIGENES_VALIDOS[i], nota: '' };
  }
  if (alias[n.replace(/\s/g, '')]) return { valor: alias[n.replace(/\s/g, '')], nota: '' };
  return { valor: ETER.ORIGEN_SI_NO_COINCIDE, nota: raw ? 'origen: ' + raw : '' };
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

function esFormatoGeneral_(f) { return !f || f === 'General' || f === 'general'; }

function resumenError_(data) {
  if (!data) return '';
  return String(data.message || data.error || '').slice(0, 200);
}
