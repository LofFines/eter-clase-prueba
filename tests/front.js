'use strict';
/*
 * Pruebas del front (index / confirmacion / generar) en Chrome headless.
 * Levanta un servidor estático propio con el repo en /eter-clase-prueba/ y responde las llamadas al
 * Apps Script con respuestas falsas (no sale nada a internet).
 * Uso: cd tests && npm i && node front.js
 *   CHROME_PATH=/ruta/a/chrome (default: /usr/bin/google-chrome)   SHOTS_DIR=/carpeta (opcional, capturas)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const ROOT = path.join(__dirname, '..');
const PORT = +(process.env.PORT || 8766);
const BASE = 'http://localhost:' + PORT + '/eter-clase-prueba/';
const SHOTS = process.env.SHOTS_DIR || '';
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const mas = (n) => new Date(Date.UTC(+hoyAR.slice(0, 4), +hoyAR.slice(5, 7) - 1, +hoyAR.slice(8, 10) + n)).toISOString().slice(0, 10);
const F = mas(3);

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function servidor() {
  return http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith('/eter-clase-prueba/')) { res.writeHead(404); return res.end(); }
    u = u.slice('/eter-clase-prueba'.length);
    if (u.endsWith('/')) u += 'index.html';
    const file = path.normalize(path.join(ROOT, u));
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || /^(tests|apps-script|\.git|node_modules)([\\/]|$)/.test(rel)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT, '127.0.0.1');
}
const shot = (page, name, opts) => (SHOTS ? page.screenshot(Object.assign({ path: path.join(SHOTS, name) }, opts || {})) : Promise.resolve());
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

async function withPage(browser, scriptResponder, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  const navs = [];
  const calls = [];
  page.on('request', async (req) => {
    const u = req.url();
    if (u.startsWith('https://script.google.com/')) {
      const body = JSON.parse(req.postData() || '{}');
      calls.push(body);
      const r = scriptResponder(body, calls.length);
      if (r === 'NETERR') return req.abort('failed');
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
    }
    if (req.isNavigationRequest() && !u.startsWith(BASE)) { navs.push(u); return req.respond({ status: 200, contentType: 'text/html', body: '<h1>EXTERNAL</h1>' }); }
    if (req.isNavigationRequest()) navs.push(u);
    return req.continue();
  });
  try { return await fn(page, navs, calls); } finally { await page.close(); }
}

async function submitForm(page, nombre) {
  await page.goto(BASE + '?d=pole-sport&f=' + F + '&h=19:00&o=salsa', { waitUntil: 'networkidle0' });
  await page.type('#nombre', nombre || 'Sofi Gómez');
  await page.type('#whatsapp', '11 2345-6789');
  await page.click('#btn-pagar');
  await new Promise(r => setTimeout(r, 1200));
}

(async () => {
  if (!CHROME) throw new Error('No encontré Chrome: definí CHROME_PATH.');
  const srv = servidor();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  try {
    console.log('\n[M6] init_point allowlist (reserva.js)');
    const casos = [
      ['foráneo https://evil.example/pay', { ok: true, mode: 'sandbox', init_point: 'https://evil.example/pay' }, false],
      ['look-alike https://www.mercadopago.com.ar.evil.com/', { ok: true, mode: 'production', init_point: 'https://www.mercadopago.com.ar.evil.com/x' }, false],
      ['http MP (no https)', { ok: true, mode: 'production', init_point: 'http://www.mercadopago.com.ar/checkout' }, false],
      ['mercadopago.com (sin .ar)', { ok: true, mode: 'production', init_point: 'https://www.mercadopago.com/checkout' }, false],
      ['javascript:', { ok: true, mode: 'mock', init_point: 'javascript:alert(1)' }, false],
      ['mock pero github.io desde localhost (otro origen)', { ok: true, mode: 'mock', init_point: 'https://loffines.github.io/eter-clase-prueba/confirmacion.html?payment_id=MOCK-X' }, false],
      ['propio sitio pero mode=sandbox', { ok: true, mode: 'sandbox', init_point: BASE + 'confirmacion.html?payment_id=MOCK-X&external_reference=ETER-1' }, false],
      ['mock, mismo origen pero otra carpeta', { ok: true, mode: 'mock', init_point: 'http://localhost:' + PORT + '/otro/confirmacion.html?payment_id=MOCK-X' }, false],
      ['www.mercadopago.com.ar', { ok: true, mode: 'production', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1' }, true],
      ['sandbox.mercadopago.com.ar', { ok: true, mode: 'sandbox', init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=1' }, true],
      ['mock + propio sitio (origin+carpeta)/confirmacion.html', { ok: true, mode: 'mock', init_point: BASE + 'confirmacion.html?payment_id=MOCK-ABC&status=approved&external_reference=ETER-1' }, true],
    ];
    for (const [n, resp, debeIr] of casos) {
      await withPage(browser, () => resp, async (page, navs) => {
        await submitForm(page);
        const destino = navs.find(u => u === resp.init_point || u.startsWith(resp.init_point.split('?')[0]));
        const err = await page.$eval('#error-envio', e => (e.hidden ? '' : e.textContent.trim())).catch(() => '');
        if (debeIr) check(n + ' → redirige', !!destino && !err, { navs, err });
        else check(n + ' → NO redirige y muestra error', !destino && /no reconocemos/.test(err), { navs, err: err.slice(0, 80) });
      });
    }

    console.log('\n[A1 front] nombre sin letras');
    for (const nm of ['123', '=1+1', '- =1+1']) {
      await withPage(browser, () => ({ ok: false }), async (page, navs, calls) => {
        await submitForm(page, nm);
        const msg = await page.$eval('#nombre-error', e => e.textContent);
        check('nombre ' + JSON.stringify(nm) + ' → mensaje amable, sin llamar al script', /con letras/.test(msg) && calls.length === 0, { msg, calls: calls.length });
      });
    }
    await withPage(browser, () => ({ ok: true, mode: 'production', init_point: 'https://www.mercadopago.com.ar/x' }), async (page, navs, calls) => {
      await submitForm(page, 'Ñandú');
      check('nombre "Ñandú" aceptado en el front', calls.length === 1 && calls[0].nombre === 'Ñandú');
    });

    console.log('\n[M4] confirmacion.js');
    const visible = (page) => page.evaluate(() => ['vista-cargando', 'vista-ok', 'vista-verificando', 'vista-pendiente', 'vista-rechazado', 'vista-error'].filter(id => !document.getElementById(id).hidden));
    const conf = [
      ['not_found siempre (URL status=approved)', '?payment_id=123456&status=approved&external_reference=ETER-260930-1900-ABCDE', () => ({ ok: false, error: 'not_found' }), 'vista-verificando', 12000],
      ['mismatch', '?payment_id=123456&status=approved&external_reference=ETER-260930-1900-ABCDE', () => ({ ok: false, error: 'mismatch' }), 'vista-verificando', 3000],
      ['invalid_ref del servidor', '?payment_id=123456&status=approved&external_reference=ETER-X', () => ({ ok: false, error: 'invalid_ref' }), 'vista-verificando', 3000],
      ['config', '?payment_id=123456&status=approved&external_reference=ETER-X', () => ({ ok: false, error: 'config' }), 'vista-verificando', 3000],
      ['invalid_payment', '?payment_id=123456&status=approved&external_reference=ETER-X', () => ({ ok: false, error: 'invalid_payment', message: 'x' }), 'vista-verificando', 3000],
      ['sin external_reference en la URL (no llama al server)', '?payment_id=123456&status=approved', () => ({ ok: true, status: 'approved', registrado: true }), 'vista-verificando', 2000],
      ['approved pero registrado:false', '?payment_id=123456&status=approved&external_reference=ETER-X', () => ({ ok: true, status: 'approved', registrado: false }), 'vista-verificando', 3000],
      ['error de red', '?payment_id=123456&status=approved&external_reference=ETER-X', () => 'NETERR', 'vista-verificando', 6000],
      ['pending (servidor)', '?payment_id=123456&status=pending&external_reference=ETER-X', () => ({ ok: true, status: 'pending' }), 'vista-pendiente', 3000],
      ['approved + registrado (servidor)', '?payment_id=123456&status=approved&external_reference=ETER-X', () => ({ ok: true, status: 'approved', registrado: true, reserva: { nombre: 'Sofi', d: 'pole-sport', f: F, h: '19:00' } }), 'vista-ok', 3000],
      ['mock approved + registrado', '?payment_id=MOCK-1519B4D0-DEA9-46D6-BF45-CA3D07875290&status=approved&external_reference=ETER-X', () => ({ ok: true, mock: true, status: 'approved', registrado: true, reserva: { nombre: 'Sofi', d: 'pole-sport', f: F, h: '19:00' } }), 'vista-ok', 3000],
    ];
    for (const [n, qs, resp, esperada, wait] of conf) {
      await withPage(browser, resp, async (page, navs, calls) => {
        await page.goto(BASE + 'confirmacion.html' + qs, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, wait));
        const v = await visible(page);
        const txt = await page.evaluate(() => document.querySelector('main').innerText);
        const exito = /Tu lugar está reservado|salió bien/.test(txt);
        check(n + ' → ' + esperada + (esperada !== 'vista-ok' ? ' y nunca texto de éxito' : ''), v.length === 1 && v[0] === esperada && (esperada === 'vista-ok' ? exito : !exito), { v, calls: calls.length });
        if (n.startsWith('not_found')) {
          check('  not_found reintenta 4 veces antes de "verificando"', calls.length === 4, calls.length);
          const wa = await page.$eval('#btn-wa', a => decodeURIComponent(a.href));
          check('  verificando: título + guía WhatsApp + botón WA visible', /Estamos verificando tu pago/.test(txt) && /WhatsApp/.test(txt) && /verificando. Operación 123456/.test(wa) && !(await page.$eval('#bloque-wa', e => e.hidden)), wa);
          await shot(page, 'confirmacion-verificando.png');
        }
        if (n.startsWith('sin external_reference')) check('  sin ref no se llama al servidor', calls.length === 0, calls.length);
      });
    }

    console.log('\n[M5] aviso de privacidad + screenshot');
    await withPage(browser, () => ({}), async (page) => {
      await page.goto(BASE + '?d=pole-sport&f=' + F + '&h=19:00&o=salsa', { waitUntil: 'networkidle0' });
      const info = await page.evaluate(() => {
        const btn = document.getElementById('btn-pagar').getBoundingClientRect();
        const pv = document.getElementById('aviso-privacidad');
        const r = pv.getBoundingClientRect();
        const cs = getComputedStyle(pv);
        return { below: r.top > btn.bottom, visible: r.height > 0 && cs.display !== 'none' && !pv.closest('details'), fs: cs.fontSize, h: r.height, text: pv.innerText, href: pv.querySelector('a').href, inForm: !!pv.closest('#form-reserva'), hasCheckbox: !!document.querySelector('#form-reserva input[type=checkbox]') };
      });
      check('aviso debajo del botón, visible, sin <details>, sin checkbox', info.below && info.visible && info.inForm && !info.hasCheckbox, info);
      const need = ['Espacio Éter', 'San Martín 39, Ciudadela', 'gestionar tu clase de prueba y contactarte', 'planilla de Google', 'Mercado Pago', 'necesarios para reservar', 'acceso, corrección o eliminación',
        'El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley N° 25.326.',
        'La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.'];
      const faltan = need.filter(s => info.text.indexOf(s) === -1);
      check('aviso cubre todos los puntos + leyenda textual', faltan.length === 0, faltan);
      check('link wa.me/541123978429', info.href === 'https://wa.me/541123978429', info.href);
      console.log('  info: font-size ' + info.fs + ', alto ' + Math.round(info.h) + 'px');
      await page.evaluate(() => { const n = document.querySelector('#form-reserva .notice.notice--info:not([hidden])'); window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 16); });
      await new Promise(r => setTimeout(r, 300));
      await shot(page, 'index-privacidad.png');
    });

    console.log('\n[RL] rate_limited en el front');
    await withPage(browser, () => ({ ok: false, error: 'rate_limited', message: 'Hay muchos pedidos en este momento. Probá de nuevo en unos minutos.' }), async (page, navs, calls) => {
      await submitForm(page);
      const err = await page.$eval('#error-envio', e => (e.hidden ? '' : e.innerText.trim()));
      const btnOk = await page.$eval('#btn-pagar', b => !b.disabled);
      check('reserva: rate_limited → muestra el mensaje (una vez), link a WhatsApp, botón habilitado, sin redirigir',
        /Hay muchos pedidos en este momento\. Probá de nuevo en unos minutos\./.test(err) && !/ratito/.test(err) && /WhatsApp/.test(err) && btnOk && calls.length === 1 &&
        !navs.some(u => !u.startsWith(BASE)), { err, btnOk, calls: calls.length });
      await shot(page, 'index-rate-limited.png');
    });
    await withPage(browser, () => ({ ok: false, error: 'rate_limited', message: 'Ya recibimos varios pedidos con este WhatsApp. Esperá unos minutos y probá de nuevo.' }), async (page) => {
      await submitForm(page);
      const err = await page.$eval('#error-envio', e => e.innerText);
      check('reserva: rate_limited por persona → mensaje por persona', /varios pedidos con este WhatsApp/.test(err), err);
    });
    await withPage(browser, () => ({ ok: false, error: 'rate_limited', message: 'x' }), async (page, navs, calls) => {
      await page.goto(BASE + 'confirmacion.html?payment_id=123456&status=approved&external_reference=ETER-X', { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 5000));
      const v = await page.evaluate(() => ['vista-ok', 'vista-verificando', 'vista-pendiente', 'vista-rechazado', 'vista-error'].filter(id => !document.getElementById(id).hidden));
      const txt = await page.evaluate(() => document.querySelector('main').innerText);
      check('confirmación: rate_limited → "Estamos verificando" + aviso de volver a chequear, sin reintento automático, nunca éxito',
        v.length === 1 && v[0] === 'vista-verificando' && /muchos pedidos/.test(txt) && /Volver a chequear/.test(txt) && calls.length === 1 && !/Tu lugar está reservado/.test(txt), { v, calls: calls.length });
      await shot(page, 'confirmacion-rate-limited.png');
    });

    console.log('\n[FECHAS] tope de 120 días en el front');
    for (const [n, valido] of [[120, true], [121, false], [400, false]]) {
      await withPage(browser, () => ({}), async (page) => {
        await page.goto(BASE + '?d=salsa&f=' + mas(n) + '&h=19:00', { waitUntil: 'networkidle0' });
        const r = await page.evaluate(() => ({ reserva: !document.getElementById('vista-reserva').hidden, invalido: !document.getElementById('vista-link-invalido').hidden, t: document.getElementById('titulo-invalido').textContent, x: document.getElementById('texto-invalido').textContent }));
        if (valido) check('landing hoy+' + n + ' → formulario', r.reserva && !r.invalido, r);
        else check('landing hoy+' + n + ' → link inválido "Esa fecha está muy lejos"', !r.reserva && r.invalido && /muy lejos/.test(r.t) && /120 días/.test(r.x), r);
      });
    }
    await withPage(browser, () => ({}), async (page) => {
      await page.goto(BASE + 'generar.html', { waitUntil: 'networkidle0' });
      const max = await page.$eval('#fecha', i => i.max);
      check('generar: input fecha con max = hoy+120', max === mas(120), max);
      const probar = async (f) => {
        await page.$eval('#fecha', (i, v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, f);
        await page.$eval('#hora', (i) => { i.value = '19:00'; i.dispatchEvent(new Event('input', { bubbles: true })); });
        return page.evaluate(() => ({ err: document.getElementById('fecha-error').textContent, link: document.getElementById('link-out').textContent }));
      };
      const r121 = await probar(mas(121));
      check('generar: hoy+121 → error y sin link', /120 días/.test(r121.err) && r121.link === '—', r121);
      const r120 = await probar(mas(120));
      check('generar: hoy+120 → link generado', !r120.err && r120.link.indexOf('f=' + mas(120)) !== -1, r120);
    });
  } finally { await browser.close(); srv.close(); }
  console.log(`\nRESULTADO FRONT: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
