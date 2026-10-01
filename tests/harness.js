'use strict';
/*
 * Harness del backend (apps-script/Code.gs) con los servicios de Apps Script simulados.
 * Uso: node tests/harness.js      (CODE_GS=/otra/ruta/Code.gs para probar otra versión)
 * Sin dependencias. No toca ninguna planilla ni llama a Mercado Pago: todo es falso y en memoria.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const CODE = fs.readFileSync(process.env.CODE_GS || path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

// Build a fresh Apps Script sandbox
function makeEnv(opts) {
  opts = opts || {};
  const props = Object.assign({}, opts.props || {});
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  const clock = { now: opts.now || Date.now() };   // reloj controlable (ahoraMs_ y TTL del caché)
  const cache = {};                                 // clave → { v, exp }
  const counts = { cacheGet: 0, cachePut: 0, ssOpen: 0, propsRead: 0, lock: 0 };
  const logs = [];
  const fetches = [];
  const ROWS = 30;
  // grid[r][c], 1-indexed via helpers; row 1 headers
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(11).fill(''));
  grid[0] = ['Fecha', 'Nombre', 'WhatsApp', 'Origen', 'Disciplina', 'Clase', '¿Confirmó?', '¿Vino?', '¿Volvió?', 'Semana', 'Notas'];
  const writes = [];
  const formats = {};        // "row,col" → formato
  const order = [];          // log de operaciones en orden
  const failAI = { n: opts.failAI || 0 }; // cuántas veces falla setValues de A:I (simula validación estricta)
  // Emula Sheets: un string que parece número se convierte en número salvo que la celda sea texto ('@').
  const coerce = (row, col, v) => (typeof v === 'string' && formats[row + ',' + col] !== '@' && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v.trim())) ? Number(v) : v;
  function range(row, col, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) out.push(grid[row - 1 + i].slice(col - 1, col - 1 + nc)); return out; },
      setValues(v) {
        order.push('setValues ' + row + ':' + col + 'x' + nc);
        if (col <= 10 && col + nc - 1 >= 10) throw new Error('WROTE COLUMN J');
        if (col === 1 && nc === 9 && failAI.n > 0) { failAI.n--; throw new Error('The data you entered in cell G' + row + ' violates the data validation rules'); }
        writes.push({ row, col, values: v });
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) grid[row - 1 + i][col - 1 + j] = coerce(row + i, col + j, v[i][j]);
        return this;
      },
      setValue(v) { order.push('setValue ' + row + ':' + col); if (col === 10) throw new Error('WROTE COLUMN J'); writes.push({ row, col, values: [[v]] }); grid[row - 1][col - 1] = coerce(row, col, v); return this; },
      setNumberFormat(f) { order.push('fmt ' + row + ':' + col + '=' + f); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) formats[(row + i) + ',' + (col + j)] = f; return this; }
    };
  }
  const sheet = {
    getSheetId: () => 934024988, getName: () => 'Clase de prueba',
    getMaxRows: () => grid.length, getRange: range,
    insertRowsAfter(n, k) { for (let i = 0; i < k; i++) grid.push(new Array(11).fill('')); },
    getParent: () => ss
  };
  const ss = { getId: () => opts.activeId || 'TEST_SHEET_ID', getName: () => 'PRUEBA', getSheets: () => [sheet], getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires' };
  const mpPayments = opts.mpPayments || {};
  const env = {
    console: { log: (m) => logs.push(['log', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => { counts.propsRead++; return (k in props ? props[k] : null); },
      getProperties: () => { counts.propsRead++; return Object.assign({}, props); } }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { counts.cacheGet++; const e = cache[k]; if (!e) return null; if (clock.now >= e.exp) { delete cache[k]; return null; } return e.v; },
      put: (k, v, ttl) => { counts.cachePut++; cache[k] = { v: String(v), exp: clock.now + 1000 * Math.min(ttl || 600, 21600) }; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
        return fmt.replace('yyyy', s.year).replace('yy', s.year.slice(2)).replace('MM', s.month).replace('dd', s.day).replace('HH', s.hour).replace('mm', s.minute).replace('ss', s.second).replace('.SSSXXX', '.000-03:00').replace(/'/g, '');
      }
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => { counts.ssOpen++; return ss; }, openById: (id) => { throw new Error('openById should not be called in tests: ' + id); }, flush: () => {} },
    UrlFetchApp: {
      fetch: (url, o) => {
        fetches.push({ url, o });
        const m = url.match(/\/v1\/payments\/(\d+)$/);
        if (m && mpPayments[m[1]]) return { getResponseCode: () => 200, getContentText: () => JSON.stringify(mpPayments[m[1]]) };
        if (/checkout\/preferences/.test(url)) return { getResponseCode: () => 201, getContentText: () => JSON.stringify(opts.prefResponse || { init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1', sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=1' }) };
        return { getResponseCode: () => 404, getContentText: () => '{}' };
      }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => { counts.lock++; return { tryLock: () => true, releaseLock: () => {} }; } },
    ScriptApp: { getProjectTriggers: () => [] },
  };
  vm.createContext(env);
  vm.runInContext(CODE, env, { filename: 'Code.gs' });
  env.ahoraMs_ = () => clock.now;   // el reloj del script es el reloj falso
  env.__ = { props, cache, logs, fetches, grid, writes, formats, order, failAI, clock, counts };
  return env;
}
// Cada post es una ejecución nueva de Apps Script: se reinician los memos por ejecución.
const nuevaEjecucion = (env) => { env.PROPS_MEMO_ = null; env.SS_MEMO_ = null; };
const post = (env, body, params) => { nuevaEjecucion(env); return JSON.parse(env.doPost({ parameter: params || {}, postData: body ? { contents: JSON.stringify(body) } : undefined }).text); };
const postRaw = (env, raw, params) => { nuevaEjecucion(env); return JSON.parse(env.doPost({ parameter: params || {}, postData: { contents: raw } }).text); };

function futureDate() {
  const d = new Date(Date.now() + 3 * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}
const F = futureDate();
const baseReq = (over) => Object.assign({ action: 'create', nombre: 'Sofi Gómez', whatsapp: '11 2345-6789', disciplina: 'pole-sport', fecha: F, hora: '19:00', origen: 'salsa' }, over || {});
const MOCK_OK = { MODE: 'mock', MOCK_SHEET_ID: 'TEST_SHEET_ID', SITE_URL: 'https://loffines.github.io/eter-clase-prueba/' };
const KEY64 = 'k'.repeat(64);
const REAL_BASE = { MP_ACCESS_TOKEN: 'TEST-TOKEN', MP_COLLECTOR_ID: '12345', WEBHOOK_KEY: KEY64, WEBAPP_URL: 'https://script.google.com/macros/s/X/exec' };
const SANDBOX_OK = Object.assign({ MODE: 'sandbox', MOCK_SHEET_ID: 'TEST_SHEET_ID' }, REAL_BASE);           // activeId = TEST_SHEET_ID
const PROD_OK = Object.assign({ MODE: 'production', MOCK_SHEET_ID: 'OTRA_PRUEBA' }, REAL_BASE);             // planilla real ≠ prueba
function lastRow(env) { const g = env.__.grid; for (let i = g.length - 1; i > 0; i--) if (g[i][1] !== '') return g[i]; return null; }
function mockFlow(env, req) {
  const c = post(env, req);
  if (!c.ok) return { create: c };
  const u = new URL(c.init_point);
  const v = post(env, { action: 'verify', payment_id: u.searchParams.get('payment_id'), external_reference: u.searchParams.get('external_reference') });
  return { create: c, verify: v, url: u, row: lastRow(env) };
}

console.log('\n[C1] modo fail-closed');
for (const mode of [undefined, '', 'MOCK', 'Mock', 'prod', 'sandbox2', 'test']) {
  const props = Object.assign({}, MOCK_OK); if (mode === undefined) delete props.MODE; else props.MODE = mode;
  const env = makeEnv({ props });
  const c = post(env, baseReq());
  const v = post(env, { action: 'verify', payment_id: '123', external_reference: 'ETER-X' });
  const w = post(env, null, { type: 'payment', 'data.id': '123', k: 'x' });
  const rc = env.reconcile();
  check(`MODE=${JSON.stringify(mode)} → create/verify/reconcile ok:false config, nada escrito, sin fetch`,
    c.ok === false && c.error === 'config' && v.ok === false && v.error === 'config' && rc.ok === false && rc.error === 'config' && env.__.writes.length === 0 && env.__.fetches.length === 0 && env.__.logs.some(l => l[0] === 'error' && /MODE inválido/.test(l[1])), { c, v, w, rc });
  const direct = env.handleCreate_(baseReq());
  check(`MODE=${JSON.stringify(mode)} → handleCreate_ directo también refusa`, direct.ok === false && direct.error === 'config');
}
{
  const props = Object.assign({}, MOCK_OK, { WEBHOOK_KEY: 'K' }); props.MODE = 'bogus';
  const env = makeEnv({ props });
  const w = post(env, null, { type: 'payment', 'data.id': '123', k: 'K' });
  check('webhook con k correcta pero MODE inválido → ok:false config, sin fetch', w.ok === false && w.error === 'config' && env.__.fetches.length === 0, w);
}
{
  const env = makeEnv({ props: Object.assign({}, MOCK_OK, { MOCK_SHEET_ID: 'OTRA_PLANILLA' }) });
  const c = post(env, baseReq());
  check('mock con MOCK_SHEET_ID distinto → create refusa', c.ok === false && c.error === 'config' && env.__.logs.some(l => /no es la de MOCK_SHEET_ID/.test(l[1])), c);
  const env2 = makeEnv({ props: { MODE: 'mock' } });
  const c2 = post(env2, baseReq());
  check('mock sin MOCK_SHEET_ID → create refusa', c2.ok === false && c2.error === 'config', c2);
  const r = env.registrar_('MOCK-X', { nombre: 'A', disciplina: 'pole-sport', fecha: F, hora: '19:00' });
  check('registrar_ directo con MOCK_SHEET_ID distinto → no escribe', r.ok === false && env.__.writes.length === 0, r);
  let threw = false; try { env.selfTest(); } catch (e) { threw = /MOCK_SHEET_ID/.test(e.message); }
  check('selfTest con MOCK_SHEET_ID distinto → tira error', threw);
}
{
  const env = makeEnv({ props: MOCK_OK });
  const g = JSON.parse(env.doGet().text);
  check('doGet devuelve exactamente {ok:true}', JSON.stringify(g) === '{"ok":true}', g);
}

console.log('\n[C1] flujo mock completo');
{
  const env = makeEnv({ props: MOCK_OK });
  const f = mockFlow(env, baseReq());
  const pid = f.url.searchParams.get('payment_id');
  check('create mock ok, init_point en SITE_URL/confirmacion.html', f.create.ok && f.create.mode === 'mock' && f.create.init_point.indexOf('https://loffines.github.io/eter-clase-prueba/confirmacion.html?payment_id=MOCK-') === 0, f.create);
  check('payment id mock = MOCK-<UUID> (no timestamp)', /^MOCK-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(pid), pid);
  check('verify mock ok, approved, registrado', f.verify.ok && f.verify.status === 'approved' && f.verify.registrado === true && f.verify.reserva.nombre === 'Sofi', f.verify);
  check('fila: B nombre, C WhatsApp, D salsa, E Pole sport, G="PRUEBA", J sin tocar', f.row && f.row[1] === 'Sofi Gómez' && f.row[2] === '+54 9 11 2345-6789' && f.row[3] === 'salsa' && f.row[4] === 'Pole sport' && f.row[6] === 'PRUEBA' && f.row[9] === '', f.row);
  check('K con id MOCK-<UUID>', String(f.row[10]).indexOf('id ' + pid) !== -1 && /^PRUEBA/.test(f.row[10]), f.row[10]);
  const v2 = post(env, { action: 'verify', payment_id: pid, external_reference: f.url.searchParams.get('external_reference') });
  check('verify repetido no duplica', v2.ok && env.__.grid.filter(r => String(r[10]).indexOf(pid) !== -1).length === 1);
  check('ningún fetch a MP en mock', env.__.fetches.length === 0);
  const env2 = makeEnv({ props: MOCK_OK }); mockFlow(env2, baseReq()); const env3 = makeEnv({ props: MOCK_OK }); mockFlow(env3, baseReq());
}

console.log('\n[A1] inyección de fórmulas');
{
  const env = makeEnv({ props: MOCK_OK });
  const S = env.textoPlanilla_;
  const cases = ['+ =HYPERLINK("http://x")', '- =1+1', '@ =1', '=1+1', '\u200B=1+1', '\t=1', "'x", ' =1', '\u202E=1', '\uFEFF+1', '\r=1', '\u00A0=1', '\u2060\u200B -1'];
  for (const c of cases) {
    const out = S(c);
    check('textoPlanilla_(' + JSON.stringify(c) + ') = ' + JSON.stringify(out) + ' empieza con \'', out[0] === "'" && !/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/.test(out));
  }
  check('texto normal intacto', S('Sofi Gómez') === 'Sofi Gómez' && S('Orgánico / IG') === 'Orgánico / IG');

  // via create + verify (nombres con letras)
  const conLetras = ['+ =HYPERLINK("http://x")', '- =1+1 Ana', '@ =1 Ana', '=1+1 Ana', '\u200B=1+1 Ana', '\t=1 Ana', "'x", '  =cmd Ana', '\u202E=SUM(A1) Ana'];
  for (const n of conLetras) {
    const e = makeEnv({ props: MOCK_OK });
    const f = mockFlow(e, baseReq({ nombre: n }));
    check('create+verify nombre ' + JSON.stringify(n) + ' → B=' + JSON.stringify(f.row && f.row[1]), f.verify && f.verify.ok && f.row && f.row[1][0] === "'", f.create);
  }
  // sin letras → rechazado
  for (const n of ['123', '=1+1', '- =1+1', '@ =1', '\u200B=1+1', '\t=1', '!!', '12 34']) {
    const e = makeEnv({ props: MOCK_OK });
    const c = post(e, baseReq({ nombre: n }));
    check('nombre sin letras ' + JSON.stringify(n) + ' rechazado', c.ok === false && c.error === 'invalid' && /letra|nombre/.test(c.message), c);
  }
  for (const n of ['Ñandú', 'José', 'Zoë', 'Ana-María', 'Łukasz', 'Юля']) {
    const e = makeEnv({ props: MOCK_OK });
    const c = post(e, baseReq({ nombre: n }));
    check('nombre válido ' + JSON.stringify(n) + ' aceptado', c.ok === true, c);
  }
  // origen
  for (const o of ['=1+1', '+cmd', '@SUM(1)', '-2', '\u200B=HYPERLINK("x")']) {
    const e = makeEnv({ props: MOCK_OK });
    const f = mockFlow(e, baseReq({ origen: o }));
    const k = String(f.row[10]);
    check('origen ' + JSON.stringify(o) + ' → D="No sabe", K=' + JSON.stringify(k), f.row[3] === 'No sabe' && k[0] !== '=' && /origen: '/.test(k) && !/[\u200B]/.test(k));
  }
  // registrar_ directo con datos de metadata (sin pasar por validarReserva_): nombres sin letras
  for (const n of ['=1+1', '- =1+1', '@ =1', '\u200B=1+1', '\t=1', "'x"]) {
    const e = makeEnv({ props: MOCK_OK });
    e.registrar_('MOCK-T', { nombre: n, whatsapp: '=cmd', disciplina: 'pole-sport', fecha: F, hora: '19:00', origen: '+x' });
    const row = lastRow(e);
    check('registrar_ directo nombre ' + JSON.stringify(n) + ' → B=' + JSON.stringify(row[1]) + ', C=' + JSON.stringify(row[2]),
      row[1][0] === "'" && row[2][0] === "'" && String(row[10])[0] !== '=');
  }
}

console.log('\n[M2] verify exige external_reference');
{
  const env = makeEnv({ props: MOCK_OK });
  const c = post(env, baseReq());
  const u = new URL(c.init_point); const pid = u.searchParams.get('payment_id'); const ref = u.searchParams.get('external_reference');
  const noRef = post(env, { action: 'verify', payment_id: pid });
  const badRef = post(env, { action: 'verify', payment_id: pid, external_reference: 'XYZ-123' });
  const otherRef = post(env, { action: 'verify', payment_id: pid, external_reference: 'ETER-000000-0000-AAAAA' });
  for (const [n, r] of [['sin ref', noRef], ['ref no ETER', badRef], ['ref ETER distinta', otherRef]]) {
    check('mock verify ' + n + ' → ok:false sin datos', r.ok === false && !('reserva' in r) && !('status' in r) && !JSON.stringify(r).includes('Sofi'), r);
  }
  check('mock: nada escrito tras refs inválidas', env.__.writes.length === 0);
  const good = post(env, { action: 'verify', payment_id: pid, external_reference: ref });
  check('mock verify con ref correcta → ok', good.ok === true);

  const pago = { id: 111, status: 'approved', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-260930-1900-ABCDE', live_mode: false, collector_id: 12345,
    metadata: { reserva_id: 'ETER-260930-1900-ABCDE', nombre: 'Lu Pérez', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '20:00', origen: 'genio' } };
  const pend = Object.assign({}, pago, { id: 222, status: 'pending' });
  const e2 = makeEnv({ props: SANDBOX_OK, mpPayments: { 111: pago, 222: pend } });
  for (const [n, body] of [['sin ref', { payment_id: '111' }], ['ref no ETER', { payment_id: '111', external_reference: 'OTRA-1' }], ['ref ETER distinta', { payment_id: '111', external_reference: 'ETER-260930-1900-ZZZZZ' }], ['pendiente ref distinta', { payment_id: '222', external_reference: 'ETER-X' }]]) {
    const r = post(e2, Object.assign({ action: 'verify' }, body));
    check('real verify ' + n + ' → ok:false sin datos', r.ok === false && !('reserva' in r) && !('status' in r) && !JSON.stringify(r).includes('Lu'), r);
  }
  check('real: sin ref ni fetch para refs no-ETER, nada escrito', e2.__.writes.length === 0 && e2.__.fetches.length === 2, e2.__.fetches.length);
  const ok = post(e2, { action: 'verify', payment_id: '111', external_reference: pago.external_reference });
  const row = lastRow(e2);
  check('sandbox verify ref correcta → approved, fila G="PRUEBA", K "SANDBOX, no es plata real · id 111"', ok.ok && ok.status === 'approved' && ok.registrado === true && row[6] === 'PRUEBA' && row[1] === 'Lu Pérez' && String(row[10]).indexOf('SANDBOX, no es plata real · id 111') === 0, { ok, row });
  const e3 = makeEnv({ props: PROD_OK, activeId: 'REAL_SHEET', mpPayments: { 111: Object.assign({}, pago, { live_mode: true }) } });
  const okp = post(e3, { action: 'verify', payment_id: '111', external_reference: pago.external_reference });
  const rowp = lastRow(e3);
  check('production verify → fila G="Sí", K "Pagó $5.000 MP · id 111"', okp.ok && okp.registrado === true && rowp[6] === 'Sí' && String(rowp[10]).indexOf('Pagó $5.000 MP · id 111') === 0, { okp, rowp });
}

console.log('\n[B3] webhook key');
{
  const KEY = 'S3cr3t-' + 'x'.repeat(40) + '&=/?';
  const pago = { id: 333, status: 'approved', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-1', live_mode: false, collector_id: 12345,
    metadata: { nombre: 'Wh Test', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '20:00', origen: 'genio' } };
  const mk = () => makeEnv({ props: Object.assign({}, SANDBOX_OK, { WEBHOOK_KEY: KEY }), mpPayments: { 333: pago } });
  for (const [n, params, body] of [
    ['sin k', { type: 'payment', 'data.id': '333' }],
    ['k incorrecta', { type: 'payment', 'data.id': '333', k: 'nope' }],
    ['k prefijo', { type: 'payment', 'data.id': '333', k: KEY.slice(0, -1) }],
    ['k más larga', { type: 'payment', 'data.id': '333', k: KEY + 'x' }],
    ['IPN topic sin k', { topic: 'payment', id: '333' }],
    ['body JSON sin k', {}, { type: 'payment', data: { id: '333' } }],
    ['k en body (no query)', {}, { type: 'payment', data: { id: '333' }, k: KEY }],
  ]) {
    const e = mk();
    const r = post(e, body || null, params);
    check('webhook ' + n + ' → {ok:true} y 0 fetch', r.ok === true && Object.keys(r).length === 1 && e.__.fetches.length === 0 && e.__.writes.length === 0, { r, f: e.__.fetches.length });
  }
  {
    const p = Object.assign({}, SANDBOX_OK); delete p.WEBHOOK_KEY;
    const e = makeEnv({ props: p, mpPayments: { 333: pago } });
    const r = post(e, null, { type: 'payment', 'data.id': '333', k: '' });
    check('sin WEBHOOK_KEY cargada: webhook con k vacía → descartado, 0 fetch', r.ok === true && e.__.fetches.length === 0);
  }
  {
    const e = mk();
    const r = post(e, null, { type: 'payment', 'data.id': '333', k: KEY, src: 'mp' });
    check('webhook con k correcta → consulta MP y anota', r.ok === true && e.__.fetches.length === 1 && lastRow(e)[1] === 'Wh Test', { r, f: e.__.fetches.length });
  }
  {
    const e = mk();
    const c = post(e, baseReq());
    const pref = JSON.parse(e.__.fetches[0].o.payload);
    check('create sandbox: notification_url = WEBAPP_URL?src=mp&k=<encodeURIComponent(KEY)>', pref.notification_url === 'https://script.google.com/macros/s/X/exec?src=mp&k=' + encodeURIComponent(KEY), pref.notification_url);
    check('[B-5] create sandbox usa init_point (no sandbox_init_point aunque MP lo mande)', c.ok === true && c.mode === 'sandbox' && c.init_point === 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1', c);
    const e3 = makeEnv({ props: SANDBOX_OK, prefResponse: { sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=9' } });
    const c3 = post(e3, baseReq());
    check('[B-5] sandbox: MP manda solo sandbox_init_point → no se usa, error mp "No recibimos el link"', c3.ok === false && c3.error === 'mp' && /link de pago/.test(c3.message), c3);
    const e4 = makeEnv({ props: PROD_OK, activeId: 'REAL_SHEET' });
    const c4 = post(e4, baseReq());
    check('[B-5] production: init_point', c4.ok === true && c4.init_point === 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1', c4);
    const p2 = Object.assign({}, PROD_OK); delete p2.WEBHOOK_KEY;
    const e2 = makeEnv({ props: p2, activeId: 'REAL_SHEET' });
    const c2 = post(e2, baseReq());
    check('create production sin WEBHOOK_KEY: config inválida, 0 fetch (ya no hay preferencia sin notification_url)', c2.ok === false && c2.error === 'config' && e2.__.fetches.length === 0, c2);
  }
}

console.log('\n[B4] pagoValido_');
{
  const base = { id: 1, status: 'approved', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-1', collector_id: 12345, live_mode: false };
  const e = makeEnv({ props: SANDBOX_OK });
  check('sandbox, collector ok, live_mode false → válido', e.pagoValido_(base).ok === true);
  check('collector_id distinto → inválido', e.pagoValido_(Object.assign({}, base, { collector_id: 999 })).ok === false);
  check('collector_id faltante → inválido', e.pagoValido_(Object.assign({}, base, { collector_id: undefined })).ok === false);
  check('sandbox + live_mode true → inválido', e.pagoValido_(Object.assign({}, base, { live_mode: true })).ok === false);
  check('sandbox + live_mode ausente → inválido', e.pagoValido_(Object.assign({}, base, { live_mode: undefined })).ok === false);
  const ep = makeEnv({ props: PROD_OK, activeId: 'REAL_SHEET' });
  check('production + live_mode false → inválido', ep.pagoValido_(base).ok === false);
  check('production + live_mode true + collector ok → válido', ep.pagoValido_(Object.assign({}, base, { live_mode: true })).ok === true);
  check('production + collector distinto → inválido', ep.pagoValido_(Object.assign({}, base, { live_mode: true, collector_id: 777 })).ok === false);
  check('monto 4999 → inválido', ep.pagoValido_(Object.assign({}, base, { live_mode: true, transaction_amount: 4999 })).ok === false);
  // reconcile skips wrong collector
  const pagos = { results: [Object.assign({}, base, { id: 5, collector_id: 999, metadata: { nombre: 'X', disciplina: 'salsa', fecha: F, hora: '19:00', whatsapp: '5491123456789' } })], paging: { total: 1 } };
  const er = makeEnv({ props: SANDBOX_OK });
  er.UrlFetchApp.fetch = (url) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(pagos) });
  const rr = er.reconcile();
  check('reconcile ignora pago de otro collector', rr.ok && rr.anotados === 0 && er.__.writes.length === 0, rr);
}

console.log('\n[A-1] config obligatoria fuera de mock');
{
  const probar = (nombre, props, activeId) => {
    const e = makeEnv({ props, activeId, mpPayments: { 1: { id: 1 } } });
    const c = post(e, baseReq());
    const v = post(e, { action: 'verify', payment_id: '1', external_reference: 'ETER-1' });
    const w = post(e, null, { type: 'payment', 'data.id': '1', k: props.WEBHOOK_KEY || '' });
    const rc = e.reconcile();
    const reg = e.registrar_('1', { nombre: 'Ana', disciplina: 'salsa', fecha: F, hora: '19:00', whatsapp: '5491123456789' });
    const falla = c.error === 'config' && v.error === 'config' && rc.error === 'config' && reg.error === 'config' && e.__.fetches.length === 0 && e.__.writes.length === 0 &&
      (!props.WEBHOOK_KEY || props.WEBHOOK_KEY.length < 1 || w.ok === true || w.error === 'config');
    return { falla, c, w, log: (e.__.logs.find(l => l[0] === 'error') || [])[1] };
  };
  for (const [modo, base, act] of [['sandbox', SANDBOX_OK, 'TEST_SHEET_ID'], ['production', PROD_OK, 'REAL_SHEET']]) {
    const ok = makeEnv({ props: base, activeId: act });
    check(modo + ' con todo cargado → config válida', ok.motivoConfigInvalida_(ok.cfg_()) === '', ok.motivoConfigInvalida_(ok.cfg_()));
    for (const prop of ['MP_ACCESS_TOKEN', 'MP_COLLECTOR_ID', 'WEBHOOK_KEY', 'WEBAPP_URL']) {
      const p = Object.assign({}, base); delete p[prop];
      const r = probar(modo, p, act);
      check(modo + ' sin ' + prop + ' → falla cerrado en create/verify/reconcile/registrar_, 0 fetch, 0 escrituras', r.falla && r.log && r.log.indexOf(prop) !== -1, r);
    }
    for (const [n, over] of [['MP_COLLECTOR_ID "12a45"', { MP_COLLECTOR_ID: '12a45' }], ['MP_COLLECTOR_ID "-12345"', { MP_COLLECTOR_ID: '-12345' }], ['MP_COLLECTOR_ID "123 45"', { MP_COLLECTOR_ID: '123 45' }],
      ['WEBHOOK_KEY de 31', { WEBHOOK_KEY: 'x'.repeat(31) }], ['WEBAPP_URL http://', { WEBAPP_URL: 'http://script.google.com/macros/s/X/exec' }], ['WEBAPP_URL sin esquema', { WEBAPP_URL: 'script.google.com/macros/s/X/exec' }]]) {
      const r = probar(modo, Object.assign({}, base, over), act);
      check(modo + ' con ' + n + ' → falla cerrado', r.falla, r);
    }
    const r32 = makeEnv({ props: Object.assign({}, base, { WEBHOOK_KEY: 'x'.repeat(32) }), activeId: act });
    check(modo + ' con WEBHOOK_KEY de 32 exactos → válida', r32.motivoConfigInvalida_(r32.cfg_()) === '');
  }
  const m = makeEnv({ props: MOCK_OK });
  check('mock sin token/collector/key/webapp → sigue válido (props actuales alcanzan)', m.motivoConfigInvalida_(m.cfg_()) === '');
  const alias = makeEnv({ props: { MODE: 'mock', TEST_SHEET_ID: 'TEST_SHEET_ID' } });
  check('alias TEST_SHEET_ID funciona en mock', alias.motivoConfigInvalida_(alias.cfg_()) === '');
  const conflicto = makeEnv({ props: { MODE: 'mock', MOCK_SHEET_ID: 'TEST_SHEET_ID', TEST_SHEET_ID: 'OTRA' } });
  check('MOCK_SHEET_ID y TEST_SHEET_ID distintos → inválido', /distintos/.test(conflicto.motivoConfigInvalida_(conflicto.cfg_())));
}

console.log('\n[M-2] sandbox/production y planilla de prueba');
{
  const e = makeEnv({ props: Object.assign({}, SANDBOX_OK, { MOCK_SHEET_ID: 'OTRA' }) });
  const c = post(e, baseReq());
  check('sandbox con planilla ≠ MOCK_SHEET_ID → falla cerrado', c.ok === false && c.error === 'config' && e.__.fetches.length === 0, c);
  const p = Object.assign({}, SANDBOX_OK); delete p.MOCK_SHEET_ID;
  const e1 = makeEnv({ props: p });
  check('sandbox sin MOCK_SHEET_ID → falla cerrado', post(e1, baseReq()).error === 'config');
  const e2 = makeEnv({ props: Object.assign({}, PROD_OK, { MOCK_SHEET_ID: 'TEST_SHEET_ID' }) }); // activeId TEST_SHEET_ID
  const c2 = post(e2, baseReq());
  check('production con planilla == MOCK_SHEET_ID → falla cerrado', c2.ok === false && c2.error === 'config' && e2.__.logs.some(l => /planilla de prueba/.test(l[1])), c2);
  const p3 = Object.assign({}, PROD_OK); delete p3.MOCK_SHEET_ID;
  const e3 = makeEnv({ props: p3, activeId: 'REAL_SHEET' });
  check('production sin MOCK_SHEET_ID → válido (no se exige)', e3.motivoConfigInvalida_(e3.cfg_()) === '');
  const e4 = makeEnv({ props: Object.assign({}, PROD_OK, { MOCK_SHEET_ID: undefined, TEST_SHEET_ID: 'REAL_SHEET' }), activeId: 'REAL_SHEET' });
  check('production con alias TEST_SHEET_ID == planilla → falla', /planilla de prueba/.test(e4.motivoConfigInvalida_(e4.cfg_())));
  // sandbox vía webhook y reconcile: G=PRUEBA, K SANDBOX
  const pago = { id: 444, status: 'approved', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-4', live_mode: false, collector_id: 12345,
    metadata: { nombre: 'Sandra', whatsapp: '5491123456789', disciplina: 'bachata', fecha: F, hora: '20:00', origen: 'salsa' } };
  const ew = makeEnv({ props: SANDBOX_OK, mpPayments: { 444: pago } });
  post(ew, null, { type: 'payment', 'data.id': '444', k: KEY64 });
  const rw = lastRow(ew);
  check('sandbox webhook → G="PRUEBA", K empieza "SANDBOX, no es plata real · id 444"', rw && rw[6] === 'PRUEBA' && String(rw[10]).indexOf('SANDBOX, no es plata real · id 444') === 0, rw);
}

console.log('\n[M-1] orden de escritura, fila a medio escribir y reintento');
{
  const e = makeEnv({ props: MOCK_OK });
  const f = mockFlow(e, baseReq());
  const ops = e.__.order.filter(o => /^setValue/.test(o));
  const iK = ops.findIndex(o => /^setValue \d+:11$/.test(o)), iAI = ops.findIndex(o => /^setValues \d+:1x9$/.test(o));
  check('K se escribe antes que A:I; nunca un rango que toque J', iK !== -1 && iAI !== -1 && iK < iAI && !e.__.order.some(o => /x1[01]$/.test(o)), ops);
  const row = f.row;
  const fm = (col) => e.__.formats[e.__.writes[0].row + ',' + col];
  check('formatos: A dd/mm, B/C/D/K "@", F dd/mm HH:mm', fm(1) === 'dd/mm' && fm(2) === '@' && fm(3) === '@' && fm(4) === '@' && fm(11) === '@' && fm(6) === 'dd/mm HH:mm');
  const fmtIdx = e.__.order.findIndex(o => o === 'fmt ' + e.__.writes[0].row + ':2=@');
  check('formato "@" se aplica antes de escribir valores', fmtIdx !== -1 && fmtIdx < e.__.order.findIndex(o => /^setValue/.test(o)));

  // fila a medio escribir: K con id, B vacía
  const e2 = makeEnv({ props: MOCK_OK });
  e2.__.grid[1] = [46000, 'Ya estaba', '+54 9 11 1111-1111', 'salsa', 'Salsa', 46001, 'Sí', '', '', '', 'Pagó $5.000 MP · id 999'];
  e2.__.grid[4] = ['', '', '', '', '', '', '', '', '', '', 'PRUEBA (mock), no se cobró · id MOCK-HALF'];
  const r2 = e2.registrar_('MOCK-HALF', { nombre: 'Medio Escrita', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '19:00', origen: 'salsa' });
  const conId = e2.__.grid.filter(r => /id MOCK-HALF/.test(String(r[10])));
  check('K con id y B vacía → completa la MISMA fila (5), no agrega otra', r2.ok && r2.written && r2.row === 5 && r2.completed === true && conId.length === 1 && e2.__.grid[4][1] === 'Medio Escrita' && e2.__.grid[4][6] === 'PRUEBA', r2);
  check('  al completar no reescribe K', !e2.__.order.some(o => o === 'setValue 5:11'));
  const r3 = e2.registrar_('MOCK-HALF', { nombre: 'Medio Escrita', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '19:00' });
  check('  después: mismo id con B llena → duplicado', r3.duplicate === true && r3.row === 5, r3);
  const r4 = e2.registrar_('999', { nombre: 'X', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '19:00' });
  check('  id con B llena (fila 2) → duplicado', r4.duplicate === true && r4.row === 2, r4);

  // A:I lanza (validación estricta de G) → K queda, reintento completa la misma fila
  const e3 = makeEnv({ props: MOCK_OK, failAI: 1 });
  const c = post(e3, baseReq());
  const u = new URL(c.init_point);
  const vb = { action: 'verify', payment_id: u.searchParams.get('payment_id'), external_reference: u.searchParams.get('external_reference') };
  const v1 = post(e3, vb);
  const pid = vb.payment_id;
  const filasId = () => e3.__.grid.map((r, i) => [i + 1, r]).filter(([, r]) => String(r[10]).indexOf('id ' + pid) !== -1);
  const tras1 = filasId();
  check('A:I lanza → verify registrado:false, error logueado, K queda con el id y B vacía', v1.ok === true && v1.registrado === false && tras1.length === 1 && tras1[0][1][1] === '' &&
    e3.__.logs.some(l => l[0] === 'error' && /falló la escritura de A:I/.test(l[1])), { v1, tras1 });
  const v2 = post(e3, vb);
  const tras2 = filasId();
  check('  reintento (verify otra vez) → completa la misma fila, sin duplicar', v2.registrado === true && tras2.length === 1 && tras2[0][0] === tras1[0][0] && tras2[0][1][1] === 'Sofi Gómez' && tras2[0][1][6] === 'PRUEBA', { v2, tras2 });
  const r2direct = e3.registrar_(pid, { nombre: 'Sofi Gómez', disciplina: 'pole-sport', fecha: F, hora: '19:00', whatsapp: '5491123456789' });
  check('  tercer intento → duplicado', r2direct.duplicate === true);
}

console.log('\n[B-1] texto que parece número queda como texto');
{
  for (const n of ['1e5', '1E10 Ana', 'e5']) {
    const e = makeEnv({ props: MOCK_OK });
    const f = mockFlow(e, baseReq({ nombre: n }));
    check('nombre ' + JSON.stringify(n) + ' → B string ' + JSON.stringify(f.row && f.row[1]), f.verify && f.verify.ok && typeof f.row[1] === 'string' && f.row[1] === n, f.create);
  }
  // control: sin formato '@' el stub sí lo convertiría
  const e = makeEnv({ props: MOCK_OK });
  e.__.grid; const rg = e.SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].getRange(20, 2); rg.setValue('1e5');
  check('control del stub: sin "@", "1e5" se convierte a número', e.__.grid[19][1] === 100000);
  const eo = makeEnv({ props: MOCK_OK });
  const fo = mockFlow(eo, baseReq({ origen: '1e3' }));
  check('origen "1e3" → K contiene "origen: 1e3" como texto', typeof fo.row[10] === 'string' && /origen: 1e3/.test(fo.row[10]));
}

console.log('\n[B-7] metadata del pago revalidada');
{
  const mkPago = (id, meta) => ({ id, status: 'approved', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-' + id, live_mode: false, collector_id: 12345,
    metadata: Object.assign({ nombre: 'Meta Ok', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '20:00', origen: 'salsa' }, meta) });
  const malos = [
    ['disciplina "yoga"', { disciplina: 'yoga' }], ['disciplina "constructor"', { disciplina: 'constructor' }],
    ['nombre solo fórmula "=1+1"', { nombre: '=1+1' }], ['nombre "- =1+1"', { nombre: '- =1+1' }], ['nombre "1"', { nombre: '1' }],
    ['whatsapp inválido', { whatsapp: '123' }], ['fecha inválida', { fecha: '2026-02-30' }], ['hora inválida', { hora: '25:00' }], ['sin metadata nombre ni caché', { nombre: '' }],
  ];
  let id = 7000;
  for (const [n, meta] of malos) {
    id++;
    const pago = mkPago(id, meta);
    // verify
    const ev = makeEnv({ props: SANDBOX_OK, mpPayments: { [id]: pago } });
    const v = post(ev, { action: 'verify', payment_id: String(id), external_reference: pago.external_reference });
    // webhook
    const ew = makeEnv({ props: SANDBOX_OK, mpPayments: { [id]: pago } });
    post(ew, null, { type: 'payment', 'data.id': String(id), k: KEY64 });
    // reconcile
    const er = makeEnv({ props: SANDBOX_OK, mpPayments: { [id]: pago } });
    er.UrlFetchApp.fetch = (url) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(/search/.test(url) ? { results: [pago], paging: { total: 1 } } : pago) });
    const rr = er.reconcile();
    check('metadata ' + n + ' → no se escribe (verify/webhook/reconcile) y se loguea',
      v.ok === false && v.error === 'invalid_metadata' && !('reserva' in v) && ev.__.writes.length === 0 && ew.__.writes.length === 0 && er.__.writes.length === 0 && rr.anotados === 0 &&
      ev.__.logs.some(l => l[0] === 'error' && /metadata inválida/.test(l[1])), { v, rr });
  }
  // metadata válida con clase ya pasada (pago aprobado y anotado tarde) → se anota
  const ayer = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() - 86400000));
  const pp = mkPago(7999, { fecha: ayer, whatsapp: '+54 9 11 2345-6789' });
  const ep = makeEnv({ props: SANDBOX_OK, mpPayments: { 7999: pp } });
  post(ep, null, { type: 'payment', 'data.id': '7999', k: KEY64 });
  const rp = lastRow(ep);
  check('metadata válida con clase de ayer (anotada tarde) → se anota, WhatsApp normalizado', rp && rp[1] === 'Meta Ok' && rp[2] === '+54 9 11 2345-6789', rp);
  // metadata con nombre con letras + fórmula → se anota con apóstrofo
  const pf = mkPago(7998, { nombre: '=HYPERLINK("x") Ana' });
  const ef = makeEnv({ props: SANDBOX_OK, mpPayments: { 7998: pf } });
  post(ef, null, { type: 'payment', 'data.id': '7998', k: KEY64 });
  check('metadata nombre "=HYPERLINK(...) Ana" → se anota con apóstrofo', lastRow(ef)[1] === '\'=HYPERLINK("x") Ana');
}

console.log('\n[RL] límite de pedidos');
{
  const waN = (i) => '11' + String(30000000 + i);            // celulares distintos válidos
  const create = (env, i, over) => post(env, baseReq(Object.assign({ whatsapp: waN(i) }, over || {})));
  const snap = (env) => Object.assign({ fetch: env.__.fetches.length, writes: env.__.writes.length }, env.__.counts);
  const warnsRL = (env) => env.__.logs.filter(l => l[0] === 'warn' && /^rate limit/.test(l[1])).length;

  // create global por minuto (default 10)
  const e = makeEnv({ props: MOCK_OK });
  let oks = 0; for (let i = 0; i < 10; i++) if (create(e, i).ok) oks++;
  check('create: 10 pedidos (default RL_CREATE_PER_MIN=10) pasan', oks === 10, oks);
  const antes = snap(e);
  const r11 = create(e, 10);
  const desp = snap(e);
  check('create: el 11.º → rate_limited con el mensaje global', r11.ok === false && r11.error === 'rate_limited' && r11.message === 'Hay muchos pedidos en este momento. Probá de nuevo en unos minutos.', r11);
  check('  limitado: 0 UrlFetch, 0 aperturas de planilla, 0 lock, 0 escrituras, 1 sola lectura de properties', desp.fetch === antes.fetch && desp.ssOpen === antes.ssOpen && desp.lock === antes.lock && desp.writes === antes.writes && desp.propsRead - antes.propsRead === 1, { antes, desp });
  for (let i = 0; i < 20; i++) create(e, 100 + i);
  check('  log una sola vez por ventana (21 rechazos → 1 warn)', warnsRL(e) === 1, warnsRL(e));
  const kMin = Object.keys(e.__.cache).find(k => /^rl:create:m:/.test(k));
  const vMin0 = e.__.cache[kMin].v, put0 = e.__.counts.cachePut; create(e, 200);
  check('  ya excedido: el bucket global no se reescribe (solo se lee; se cuenta solo el del número nuevo)', e.__.cache[kMin].v === vMin0 && e.__.counts.cachePut - put0 === 1, { vMin0, v: e.__.cache[kMin].v, puts: e.__.counts.cachePut - put0 });
  check('  TTL de la ventana de 1 min = 120 s (ventana + 60)', e.__.cache[kMin].exp - e.__.clock.now === 120000, e.__.cache[kMin].exp - e.__.clock.now);
  e.__.clock.now += 60000;
  check('create: ventana nueva (+60 s) → vuelve a pasar', create(e, 300).ok === true);
  check('  y el log vuelve a poder aparecer en la ventana nueva', (() => { for (let i = 0; i < 12; i++) create(e, 400 + i); return warnsRL(e) === 2; })(), warnsRL(e));

  // create global por hora
  const eh = makeEnv({ props: Object.assign({}, MOCK_OK, { RL_CREATE_PER_MIN: '1000', RL_CREATE_PER_HOUR: '5' }) });
  let okh = 0; for (let i = 0; i < 5; i++) { if (create(eh, i).ok) okh++; eh.__.clock.now += 61000; }
  const h6 = create(eh, 5);
  check('create por hora (RL_CREATE_PER_HOUR=5): 5 pasan en minutos distintos, el 6.º rate_limited', okh === 5 && h6.error === 'rate_limited', { okh, h6 });
  eh.__.clock.now += 3600000;
  check('  hora nueva → pasa', create(eh, 6).ok === true);

  // por WhatsApp (default 3 cada 10 min), independiente del global
  const ew = makeEnv({ props: MOCK_OK });
  const same = []; for (let i = 0; i < 4; i++) same.push(post(ew, baseReq({ whatsapp: '11 2345-6789' })));
  check('por WhatsApp: 3 pasan, el 4.º → rate_limited con mensaje por persona', same.slice(0, 3).every(r => r.ok) && same[3].error === 'rate_limited' && /este WhatsApp/.test(same[3].message), same[3]);
  check('  mismo número en otro formato (+54 9 11 …) también limitado', post(ew, baseReq({ whatsapp: '+54 9 11 2345-6789' })).error === 'rate_limited');
  check('  otro número → pasa (el global no se agotó: van 5 de 10)', post(ew, baseReq({ whatsapp: '11 9999-0000' })).ok === true);
  check('  la clave del caché no tiene el teléfono en claro', !Object.keys(ew.__.cache).some(k => /2345|6789/.test(k)), Object.keys(ew.__.cache));
  ew.__.clock.now += 600000;
  check('  +10 min → el mismo número vuelve a pasar', post(ew, baseReq({ whatsapp: '11 2345-6789' })).ok === true);
  const eg = makeEnv({ props: Object.assign({}, MOCK_OK, { RL_CREATE_PER_MIN: '2' }) });
  create(eg, 1); create(eg, 2);
  const g3 = post(eg, baseReq({ whatsapp: '11 7777-0000' }));
  check('  global agotado → mensaje global aunque el número sea nuevo', g3.error === 'rate_limited' && /muchos pedidos/.test(g3.message));

  // verify (sandbox: cada verify consulta a MP)
  const pend = { id: 555, status: 'pending', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-555', live_mode: false, collector_id: 12345,
    metadata: { nombre: 'Pendiente', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '20:00' } };
  const ev = makeEnv({ props: SANDBOX_OK, mpPayments: { 555: pend } });
  const vb = { action: 'verify', payment_id: '555', external_reference: 'ETER-555' };
  let okv = 0; for (let i = 0; i < 30; i++) if (post(ev, vb).ok) okv++;
  const f30 = ev.__.fetches.length, s30 = ev.__.counts.ssOpen;
  const v31 = post(ev, vb);
  check('verify: 30 pasan (30 consultas a MP), el 31.º rate_limited sin consultar a MP ni abrir la planilla', okv === 30 && f30 === 30 && v31.error === 'rate_limited' && ev.__.fetches.length === 30 && ev.__.counts.ssOpen === s30, { okv, f30, v31 });
  const evh = makeEnv({ props: Object.assign({}, SANDBOX_OK, { RL_VERIFY_PER_MIN: '1000', RL_VERIFY_PER_HOUR: '4' }), mpPayments: { 555: pend } });
  for (let i = 0; i < 4; i++) { post(evh, vb); evh.__.clock.now += 61000; }
  check('verify por hora (RL_VERIFY_PER_HOUR=4): el 5.º rate_limited', post(evh, vb).error === 'rate_limited' && evh.__.fetches.length === 4);

  // create agotado no afecta verify ni webhook; webhook con clave válida tiene su propio límite
  const pago = { id: 666, status: 'approved', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-666', live_mode: false, collector_id: 12345,
    metadata: { nombre: 'Webhook Ok', whatsapp: '5491123456789', disciplina: 'salsa', fecha: F, hora: '20:00', origen: 'salsa' } };
  const ex = makeEnv({ props: Object.assign({}, SANDBOX_OK, { RL_CREATE_PER_MIN: '1', RL_VERIFY_PER_MIN: '1' }), mpPayments: { 666: pago, 555: pend } });
  post(ex, baseReq()); const c2 = post(ex, baseReq({ whatsapp: '11 5555-0000' }));
  post(ex, vb); const v2 = post(ex, vb);
  check('create y verify agotados (límite 1)', c2.error === 'rate_limited' && v2.error === 'rate_limited');
  const f0 = ex.__.fetches.length;
  const wh = post(ex, null, { type: 'payment', 'data.id': '666', k: KEY64 });
  check('  webhook con clave válida NO queda bloqueado: consulta a MP y anota', wh.ok === true && ex.__.fetches.length === f0 + 1 && lastRow(ex)[1] === 'Webhook Ok', wh);
  const ek = makeEnv({ props: Object.assign({}, SANDBOX_OK, { RL_WEBHOOK_PER_MIN: '3' }), mpPayments: { 666: pago } });
  for (let i = 0; i < 50; i++) post(ek, null, { type: 'payment', 'data.id': '666', k: 'mala' });
  check('webhook: 50 con clave mala → 0 consultas y no consumen el límite del webhook', ek.__.fetches.length === 0 && !Object.keys(ek.__.cache).some(k => /^rl:webhook/.test(k)));
  const whs = []; for (let i = 0; i < 4; i++) whs.push(post(ek, null, { type: 'payment', 'data.id': '666', k: KEY64 }));
  check('webhook con clave válida (RL_WEBHOOK_PER_MIN=3): 3 pasan, el 4.º rate_limited sin consultar a MP', whs.slice(0, 3).every(r => r.ok) && whs[3].error === 'rate_limited' && ek.__.fetches.length === 3, { whs, f: ek.__.fetches.length });
  check('  los pedidos de webhook no consumen el límite de create', post(ek, baseReq()).ok === true);

  // [M-1/B-7] validación antes de cualquier límite; por número antes que global
  {
    const rlKeys = (env, re) => Object.keys(env.__.cache).filter(k => re.test(k));
    const ei = makeEnv({ props: MOCK_OK });
    const malos = [
      baseReq({ whatsapp: '123' }), baseReq({ nombre: '1234' }), baseReq({ disciplina: 'nada' }),
      baseReq({ fecha: '2020-01-01' }), baseReq({ fecha: '2026-02-30' }), baseReq({ hora: '25:00' }),
      { action: 'create' }, baseReq({ nombre: 'x' })
    ];
    const rs = []; for (let i = 0; i < 40; i++) rs.push(post(ei, malos[i % malos.length]));
    check('[M-1] 40 create inválidos → todos "invalid", 0 claves rl:* en el caché (ni global ni por número), 0 properties', rs.every(r => r.ok === false && r.error === 'invalid') && rlKeys(ei, /^rl:/).length === 0 && ei.__.counts.propsRead === 0 && ei.__.counts.ssOpen === 0, { r0: rs[0], keys: rlKeys(ei, /^rl:/), props: ei.__.counts.propsRead });
    let okv = 0; for (let i = 0; i < 10; i++) if (create(ei, 900 + i).ok) okv++;
    check('[M-1]   después de 40 inválidos siguen entrando 10 válidos (cupo global intacto)', okv === 10, okv);
    const ec2 = makeEnv({ props: { MODE: 'roto' } });
    const ri = post(ec2, baseReq({ whatsapp: '1' }));
    check('[M-1] inválido con config rota → "invalid" sin contar límites ni leer config', ri.error === 'invalid' && rlKeys(ec2, /^rl:/).length === 0 && ec2.__.counts.propsRead === 0, ri);

    const eo = makeEnv({ props: MOCK_OK });
    for (let i = 0; i < 3; i++) post(eo, baseReq({ whatsapp: '11 2345-6789' }));
    const kM = rlKeys(eo, /^rl:create:m:/)[0], kH = rlKeys(eo, /^rl:create:h:/)[0];
    const m0 = eo.__.cache[kM].v, h0 = eo.__.cache[kH].v;
    const lim = []; for (let i = 0; i < 20; i++) lim.push(post(eo, baseReq({ whatsapp: '11 2345-6789' })));
    check('[B-7] 20 pedidos de un número ya limitado → rate_limited por persona y NO suman al global (minuto ni hora)',
      lim.every(r => r.error === 'rate_limited' && /este WhatsApp/.test(r.message)) && eo.__.cache[kM].v === m0 && eo.__.cache[kH].v === h0 && m0 === '3' && h0 === '3', { m0, h0, m: eo.__.cache[kM].v, h: eo.__.cache[kH].v });
    let okn = 0; for (let i = 0; i < 7; i++) if (create(eo, 950 + i).ok) okn++;
    check('[B-7]   el cupo global sigue disponible: 7 números distintos más pasan (3+7=10)', okn === 7 && create(eo, 960).error === 'rate_limited', okn);

    // orden: si el global está agotado, el del número igual se cuenta primero (y el global solo se lee)
    const eg2 = makeEnv({ props: Object.assign({}, MOCK_OK, { RL_CREATE_PER_MIN: '1' }) });
    create(eg2, 1);
    const rg = post(eg2, baseReq({ whatsapp: '11 6666-0000' }));
    const kW = rlKeys(eg2, /^rl:create:wa:/);
    check('[B-7] global agotado → mensaje global; el bucket por número se contó primero', rg.error === 'rate_limited' && /muchos pedidos/.test(rg.message) && kW.length === 2, { rg, kW });
    // por minuto agotado no consume el de la hora
    const kH2 = rlKeys(eg2, /^rl:create:h:/)[0];
    check('[B-7] por minuto agotado → el bucket por hora no se incrementa', eg2.__.cache[kH2].v === '1', eg2.__.cache[kH2].v);
  }

  // el límite va antes de la configuración
  const ec = makeEnv({ props: { MODE: 'roto', RL_CREATE_PER_MIN: '1' } });
  post(ec, baseReq());
  const s0 = ec.__.counts.ssOpen;
  const lim = post(ec, baseReq({ whatsapp: '11 4444-0000' }));
  check('límite antes de la config: con MODE inválido igual responde rate_limited (sin abrir planilla)', lim.error === 'rate_limited' && ec.__.counts.ssOpen === s0);

  // propiedades: override y basura → default
  const ep = makeEnv({ props: Object.assign({}, MOCK_OK, { RL_CREATE_PER_MIN: '2' }) });
  create(ep, 1); create(ep, 2);
  check('RL_CREATE_PER_MIN=2 → el 3.º rate_limited', create(ep, 3).error === 'rate_limited');
  for (const [raw, esp] of [['abc', 10], ['-5', 10], ['0', 10], ['1.5', 10], ['', 10], ['9999999', 10], ['100001', 10], ['1e3', 10], [' 7 ', 7], ['100000', 100000], ['1', 1]]) {
    const ez = makeEnv({ props: Object.assign({}, MOCK_OK, { RL_CREATE_PER_MIN: raw }) });
    check('limite_ con RL_CREATE_PER_MIN=' + JSON.stringify(raw) + ' → ' + esp, ez.limite_('RL_CREATE_PER_MIN') === esp, ez.limite_('RL_CREATE_PER_MIN'));
  }
  const ed = makeEnv({ props: MOCK_OK });
  const d = ed.ETER.RL.DEFAULTS;
  check('defaults: create 10/min, 250/h, 3 por WhatsApp/10 min; verify 30/min, 300/h; webhook 60/min',
    d.RL_CREATE_PER_MIN === 10 && d.RL_CREATE_PER_HOUR === 250 && d.RL_CREATE_PER_WA_10MIN === 3 && d.RL_VERIFY_PER_MIN === 30 && d.RL_VERIFY_PER_HOUR === 300 && d.RL_WEBHOOK_PER_MIN === 60, d);
  const egb = makeEnv({ props: Object.assign({}, MOCK_OK, { RL_CREATE_PER_MIN: 'mucho' }) });
  let okg = 0; for (let i = 0; i < 11; i++) if (create(egb, i).ok) okg++;
  check('RL_CREATE_PER_MIN basura → default 10 (el 11.º limitado)', okg === 10);

  // cuerpo grande
  const eb = makeEnv({ props: MOCK_OK });
  const big = JSON.stringify(Object.assign(baseReq(), { relleno: 'x'.repeat(5000) }));
  const rb = postRaw(eb, big);
  check('cuerpo > 4 KB → too_large sin parsear: 0 caché, 0 properties, 0 planilla', rb.ok === false && rb.error === 'too_large' && eb.__.counts.cacheGet === 0 && eb.__.counts.propsRead === 0 && eb.__.counts.ssOpen === 0, { rb, c: eb.__.counts });
  const base = JSON.stringify(Object.assign(baseReq(), { relleno: '' }));
  const exact = base.replace('"relleno":""', '"relleno":"' + 'x'.repeat(4096 - base.length) + '"');
  check('cuerpo de exactamente 4096 → se procesa', exact.length === 4096 && postRaw(eb, exact).ok === true, exact.length);
  const whBig = postRaw(eb, 'x'.repeat(5000), { type: 'payment', 'data.id': '1', k: 'x' });
  check('webhook con cuerpo > 4 KB → too_large', whBig.error === 'too_large');
  check('cuerpo JSON no-objeto (array / número) → bad_request', postRaw(eb, '[1,2]').error === 'bad_request' && postRaw(eb, '42').error === 'bad_request');
}

console.log('\n[FECHAS] tope de 120 días');
{
  const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const mas = (n) => { const d = new Date(Date.UTC(+hoyAR.slice(0, 4), +hoyAR.slice(5, 7) - 1, +hoyAR.slice(8, 10) + n)); return d.toISOString().slice(0, 10); };
  const e = makeEnv({ props: MOCK_OK });
  const c120 = post(e, baseReq({ fecha: mas(120) }));
  const c121 = post(e, baseReq({ fecha: mas(121), whatsapp: '11 2000-0001' }));
  check('create hoy+120 → ok', c120.ok === true, c120);
  check('create hoy+121 → rechazado con mensaje amable', c121.ok === false && c121.error === 'invalid' && /muy lejos/.test(c121.message) && /120 días/.test(c121.message), c121);
  check('sumarDias_ cruza meses/años/bisiestos', e.sumarDias_('2026-12-31', 1) === '2027-01-01' && e.sumarDias_('2028-02-28', 1) === '2028-02-29' && e.sumarDias_('2026-03-01', -1) === '2026-02-28');
  const casos = [[-30, true], [-31, false], [0, true], [127, true], [128, false]];
  let id = 8100;
  for (const [n, debe] of casos) {
    id++;
    const pago = { id, status: 'approved', transaction_amount: 5000, currency_id: 'ARS', external_reference: 'ETER-' + id, live_mode: false, collector_id: 12345,
      metadata: { nombre: 'Fecha ' + n, whatsapp: '5491123456789', disciplina: 'salsa', fecha: mas(n), hora: '20:00' } };
    const ew = makeEnv({ props: SANDBOX_OK, mpPayments: { [id]: pago } });
    post(ew, null, { type: 'payment', 'data.id': String(id), k: KEY64 });
    const escrita = !!lastRow(ew);
    check('metadata con clase en hoy' + (n >= 0 ? '+' : '') + n + ' → ' + (debe ? 'se anota' : 'no se anota'), escrita === debe, { escrita, fecha: mas(n) });
  }
}

console.log(`\nRESULTADO: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
