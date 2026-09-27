/* Espacio Éter · utilidades compartidas (sin dependencias). */
(function (global) {
  'use strict';

  var TZ = 'America/Argentina/Buenos_Aires';
  // slug (va en el link ?d=) → nombre exacto (es el que se anota en la columna E de la planilla).
  var DISCIPLINAS = {
    'pole-sport': 'Pole sport',
    'pole-coreo': 'Pole coreo',
    'funcional': 'Funcional',
    'bachata': 'Bachata',
    'salsa': 'Salsa',
    'acro-adultos': 'Acro adultos',
    'acro-infantil': 'Acro infantil',
    'flexibilidad': 'Flexibilidad'
  };
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var WA_NUMERO = '541123978429';
  var WA_VISIBLE = '11 2397-8429';
  var DIRECCION = 'San Martín 39, Ciudadela';
  var MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent('San Martín 39, Ciudadela, Buenos Aires, Argentina');
  var PRECIO_TEXTO = '$5.000';

  /** true solo si el slug es una disciplina propia del mapa (nada de "constructor", "toString", etc.). */
  function esDisciplina(d) {
    return typeof d === 'string' && /^[a-z]+(-[a-z]+)*$/.test(d) &&
      Object.prototype.hasOwnProperty.call(DISCIPLINAS, d);
  }

  function waLink(texto, numero) {
    var base = 'https://wa.me/' + (numero === undefined ? WA_NUMERO : (numero || ''));
    return texto ? base + '?text=' + encodeURIComponent(texto) : base;
  }

  /** Valida "YYYY-MM-DD" y que sea una fecha real. Devuelve {y,m,d} o null. */
  function parseFecha(f) {
    if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
    var y = +f.slice(0, 4), m = +f.slice(5, 7), d = +f.slice(8, 10);
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: m, d: d, dow: dt.getUTCDay() };
  }

  /** Valida "HH:mm" (24 h). */
  function parseHora(h) {
    if (typeof h !== 'string') return null;
    var mt = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(h);
    return mt ? { hh: +mt[1], mm: +mt[2] } : null;
  }

  /** "Ahora" en Argentina como "YYYY-MM-DD HH:mm" (independiente de la zona del teléfono). */
  function ahoraArgentina() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date());
      var o = {};
      parts.forEach(function (p) { o[p.type] = p.value; });
      return o.year + '-' + o.month + '-' + o.day + ' ' + o.hour + ':' + o.minute;
    } catch (e) {
      // Fallback: Argentina es UTC-3 todo el año.
      var d = new Date(Date.now() - 3 * 3600 * 1000);
      return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16);
    }
  }

  function hoyArgentina() { return ahoraArgentina().slice(0, 10); }

  /** "viernes 2 de octubre" */
  function fechaHumana(f) {
    var p = parseFecha(f);
    if (!p) return '';
    return DIAS[p.dow] + ' ' + p.d + ' de ' + MESES[p.m - 1];
  }

  /** "Pole sport · viernes 2 de octubre · 19:00 hs" */
  function claseHumana(d, f, h) {
    return (esDisciplina(d) ? DISCIPLINAS[d] : d) + ' · ' + fechaHumana(f) + ' · ' + h + ' hs';
  }

  /** Revisa los parámetros de la clase. Devuelve {ok, motivo, clase}. */
  function validarClase(d, f, h) {
    d = (d || '').toLowerCase().trim();
    if (!esDisciplina(d)) return { ok: false, motivo: 'disciplina' };
    if (!parseFecha(f)) return { ok: false, motivo: 'fecha' };
    if (!parseHora(h)) return { ok: false, motivo: 'hora' };
    if ((f + ' ' + h) < ahoraArgentina()) return { ok: false, motivo: 'pasada' };
    return { ok: true, clase: { d: d, f: f, h: h } };
  }

  /**
   * Normaliza un celular argentino. Acepta "11 2397-8429", "+54 9 11 2397-8429",
   * "011 15 2397-8429", "2215551234", etc. Devuelve {e164: "5491123978429", visible: "+54 9 11 2397-8429"} o null.
   */
  function normalizarCelular(valor) {
    var n = String(valor || '').replace(/\D/g, '');
    if (n.indexOf('549') === 0 && n.length >= 13) n = n.slice(3);
    else if (n.indexOf('54') === 0 && n.length >= 12) n = n.slice(2);
    if (n.charAt(0) === '0') n = n.slice(1);
    if (n.length === 12) {
      // Sacar el "15" que va después del código de área (2, 3 o 4 dígitos).
      // CABA/GBA usa "11"; el resto del país usa códigos de 3 o 4 dígitos.
      var largos = n.indexOf('11') === 0 ? [2] : [3, 4];
      for (var i = 0; i < largos.length; i++) {
        var a = largos[i];
        if (n.substr(a, 2) === '15') { n = n.slice(0, a) + n.slice(a + 2); break; }
      }
    }
    if (!/^[1-3]\d{9}$/.test(n)) return null;
    var visible = n.indexOf('11') === 0
      ? '+54 9 11 ' + n.slice(2, 6) + '-' + n.slice(6)
      : '+54 9 ' + n;
    return { e164: '549' + n, visible: visible };
  }

  function el(id) { return document.getElementById(id); }

  function show(node, visible) {
    if (!node) return;
    if (visible) node.removeAttribute('hidden'); else node.setAttribute('hidden', '');
  }

  function scriptConfigurado() {
    return typeof SCRIPT_URL === 'string' && /^https:\/\/script\.google\.com\//.test(SCRIPT_URL) &&
      SCRIPT_URL.indexOf('PEGAR_ACA') === -1;
  }

  /** POST al Apps Script con text/plain (sin preflight de CORS). */
  function llamarScript(payload, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 25000) : null;
    return fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  global.Eter = {
    TZ: TZ, DISCIPLINAS: DISCIPLINAS, esDisciplina: esDisciplina, WA_NUMERO: WA_NUMERO, WA_VISIBLE: WA_VISIBLE,
    DIRECCION: DIRECCION, MAPS_URL: MAPS_URL, PRECIO_TEXTO: PRECIO_TEXTO,
    waLink: waLink, parseFecha: parseFecha, parseHora: parseHora, fechaHumana: fechaHumana,
    claseHumana: claseHumana, validarClase: validarClase, normalizarCelular: normalizarCelular,
    ahoraArgentina: ahoraArgentina, hoyArgentina: hoyArgentina, el: el, show: show,
    scriptConfigurado: scriptConfigurado, llamarScript: llamarScript
  };
})(window);
