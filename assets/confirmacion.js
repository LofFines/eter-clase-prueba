/* Espacio Éter · confirmación (back_url de Mercado Pago) */
(function () {
  'use strict';
  var E = window.Eter;
  var qs = new URLSearchParams(window.location.search);
  var paymentId = (qs.get('payment_id') || qs.get('collection_id') || '').trim();
  var statusQuery = (qs.get('status') || qs.get('collection_status') || '').trim().toLowerCase();
  var ref = (qs.get('external_reference') || '').trim();

  var guardada = null;
  try { guardada = JSON.parse(sessionStorage.getItem('eter_reserva') || 'null'); } catch (e) { guardada = null; }

  var VISTAS = ['vista-cargando', 'vista-ok', 'vista-ok-sin-verificar', 'vista-pendiente', 'vista-rechazado', 'vista-error'];
  var intentos = 0;

  function mostrar(id, conInfo) {
    VISTAS.forEach(function (v) { E.show(E.el(v), v === id); });
    E.show(E.el('info-clase'), !!conInfo);
    E.show(E.el('bloque-wa'), id !== 'vista-cargando');
    var h1 = E.el(id) && E.el(id).querySelector('h1');
    if (h1 && id !== 'vista-cargando') { h1.setAttribute('tabindex', '-1'); h1.focus(); }
  }

  function claseDe(reserva) {
    var r = reserva || guardada;
    if (r && E.esDisciplina(r.d) && E.parseFecha(r.f) && E.parseHora(r.h)) return r;
    return null;
  }

  function setWa(texto, etiqueta) {
    E.el('btn-wa').href = E.waLink(texto);
    E.el('btn-wa-texto').textContent = etiqueta || 'Escribinos por WhatsApp';
  }

  function ajustarPole(clase) {
    E.show(E.el('item-pole'), !clase || clase.d === 'pole-sport' || clase.d === 'pole-coreo');
  }

  function linkReintento(clase) {
    var btn = E.el('btn-reintentar-pago');
    if (!clase) { E.show(btn, false); return; }
    var o = (guardada && guardada.o) || clase.o || '';
    btn.href = './?d=' + clase.d + '&f=' + clase.f + '&h=' + clase.h + (o ? '&o=' + encodeURIComponent(o) : '');
    E.show(btn, true);
  }

  function vistaOk(res) {
    var clase = claseDe(res && res.reserva);
    // El servidor solo devuelve el primer nombre; si esta pestaña guardó el nombre completo, lo usamos para el WhatsApp.
    var nombre = (guardada && guardada.nombre) || (res && res.reserva && res.reserva.nombre) || '';
    var primerNombre = nombre ? nombre.split(' ')[0] : '';
    if (primerNombre) E.el('titulo-ok').textContent = '¡Listo, ' + primerNombre + '! Tu lugar está reservado';
    if (clase) {
      E.el('clase-ok').textContent = E.claseHumana(clase.d, clase.f, clase.h);
      E.show(E.el('caja-clase-ok'), true);
    }
    if (paymentId) E.el('operacion-ok').textContent = 'Operación de Mercado Pago: ' + paymentId;
    E.show(E.el('banner-mock'), !!(res && res.mock));
    ajustarPole(clase);
    setWa('Hola Araceli! ' + (nombre ? 'Soy ' + nombre + '. ' : '') + 'Ya pagué mi clase de prueba' +
      (clase ? ' (' + E.claseHumana(clase.d, clase.f, clase.h) + ')' : '') +
      (paymentId ? '. Operación ' + paymentId : '') + '. ¡Nos vemos!', 'Avisarle a Araceli por WhatsApp');
    mostrar('vista-ok', true);
  }

  function vistaOkSinVerificar() {
    var clase = claseDe(null);
    E.el('operacion-osv').textContent = paymentId || '—';
    ajustarPole(clase);
    setWa('Hola Araceli! Pagué la clase de prueba' +
      (clase ? ' (' + E.claseHumana(clase.d, clase.f, clase.h) + ')' : '') +
      '. Operación ' + paymentId + '.', 'Avisarle a Araceli por WhatsApp');
    mostrar('vista-ok-sin-verificar', true);
  }

  function vistaPendiente(res) {
    var clase = claseDe(res && res.reserva);
    ajustarPole(clase);
    E.show(E.el('banner-mock'), !!(res && res.mock));
    setWa('Hola Araceli! Pagué la clase de prueba' +
      (clase ? ' (' + E.claseHumana(clase.d, clase.f, clase.h) + ')' : '') +
      ' y me figura pendiente. Operación ' + paymentId + '.');
    mostrar('vista-pendiente', true);
  }

  function vistaRechazado(res, sinPago) {
    var clase = claseDe(res && res.reserva);
    if (sinPago) {
      E.el('titulo-rech').textContent = 'No llegaste a pagar';
      E.el('texto-rech').textContent = 'Parece que saliste de Mercado Pago antes de terminar. Tu lugar todavía no está reservado: podés volver a intentarlo cuando quieras.';
    } else {
      E.el('titulo-rech').textContent = 'El pago no se aprobó';
    }
    linkReintento(clase);
    setWa('Hola Araceli! Quise pagar la clase de prueba' +
      (clase ? ' (' + E.claseHumana(clase.d, clase.f, clase.h) + ')' : '') +
      ' y no se completó el pago. ¿Me ayudás?');
    mostrar('vista-rechazado', false);
  }

  function vistaError(texto) {
    if (texto) E.el('texto-err').textContent = texto;
    setWa('Hola Araceli! Hice el pago de la clase de prueba y la página no me lo pudo confirmar' +
      (paymentId ? '. Operación ' + paymentId : '') + '.');
    mostrar('vista-error', false);
  }

  /** Cuando no se puede verificar, usamos lo que dice la URL (solo para mostrar, nunca para anotar). */
  function segunQuery() {
    if (statusQuery === 'approved') return vistaOkSinVerificar();
    if (statusQuery === 'pending' || statusQuery === 'in_process') return vistaPendiente(null);
    if (statusQuery === 'rejected' || statusQuery === 'cancelled' || statusQuery === 'null') return vistaRechazado(null, statusQuery === 'null');
    return vistaError();
  }

  function verificar() {
    mostrar('vista-cargando', false);
    intentos++;
    E.llamarScript({ action: 'verify', payment_id: paymentId, external_reference: ref }, 25000)
      .then(function (res) {
        if (res && res.ok) {
          var st = String(res.status || '').toLowerCase();
          if (st === 'approved') return vistaOk(res);
          if (st === 'pending' || st === 'in_process' || st === 'authorized' || st === 'in_mediation') return vistaPendiente(res);
          if (st === 'rejected' || st === 'cancelled' || st === 'refunded' || st === 'charged_back') return vistaRechazado(res, false);
          return vistaError();
        }
        var err = res && res.error;
        // Mercado Pago a veces tarda unos segundos en mostrar el pago: reintentamos solos.
        if (err === 'not_found' && intentos < 4) { setTimeout(verificar, 3000); return; }
        if (err === 'not_found' || err === 'config' || err === 'internal') return segunQuery();
        return vistaError((res && res.message) || null);
      })
      .catch(function () {
        if (intentos < 2) { setTimeout(verificar, 2000); return; }
        segunQuery();
      });
  }

  E.el('btn-reintentar').addEventListener('click', function () { intentos = 0; verificar(); });
  E.el('btn-reintentar-osv').addEventListener('click', function () { intentos = 0; verificar(); });

  // --- Arranque ---
  if (!paymentId || paymentId === 'null') {
    vistaRechazado(null, true);
  } else if (!/^(MOCK-[A-Z0-9-]+|\d{1,20})$/.test(paymentId)) {
    vistaError('El número de operación que vino en el link no es válido.');
  } else if (!E.scriptConfigurado()) {
    segunQuery();
  } else {
    verificar();
  }
})();
