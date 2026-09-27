/* Espacio Éter · generador de links para Araceli */
(function () {
  'use strict';
  var E = window.Eter;
  var form = E.el('form-generar');
  var inFecha = E.el('fecha');
  var inHora = E.el('hora');
  var selOrigen = E.el('origen');
  var inNumero = E.el('numero');
  var outLink = E.el('link-out');
  var outResumen = E.el('resumen');
  var txtMensaje = E.el('mensaje');
  var btnCopiar = E.el('btn-copiar');
  var btnCopiarMsj = E.el('btn-copiar-msj');
  var btnWa = E.el('btn-wa');
  var btnProbar = E.el('btn-probar');
  var avisoCopiado = E.el('copiado');

  var base = (typeof SITE_URL === 'string' && SITE_URL) ? SITE_URL : 'https://loffines.github.io/eter-clase-prueba/';
  if (base.slice(-1) !== '/') base += '/';

  inFecha.min = E.hoyArgentina();
  var linkActual = '';
  var mensajeEditado = false;

  function err(id, msg) {
    E.el(id + '-error').textContent = msg || '';
    E.el(id).setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function disciplina() {
    var r = form.querySelector('input[name="d"]:checked');
    return r ? r.value : 'pole';
  }

  function armarLink(d, f, h, o) {
    return base + '?d=' + d + '&f=' + f + '&h=' + h + (o ? '&o=' + encodeURIComponent(o) : '');
  }

  function mensajePara(d, f, h, link) {
    return '¡Hola! 💜 Te paso el link para reservar tu clase de prueba de ' + E.DISCIPLINAS[d] +
      ' el ' + E.fechaHumana(f) + ' a las ' + h + ' hs en Espacio Éter (San Martín 39, Ciudadela).\n\n' +
      'Dejás tu nombre y WhatsApp, pagás los $5.000 con Mercado Pago y queda reservado:\n' + link + '\n\n' +
      'Si después no podés venir, avisame antes de la clase y la pasamos a otro día sin perder lo que pagaste.';
  }

  function habilitar(si) {
    btnCopiar.disabled = !si;
    btnCopiarMsj.disabled = !si;
    btnWa.setAttribute('aria-disabled', si ? 'false' : 'true');
    E.show(btnProbar, si);
  }

  function actualizar() {
    var d = disciplina();
    var f = inFecha.value;
    var h = inHora.value ? inHora.value.slice(0, 5) : '';
    var o = selOrigen.value;
    err('fecha', ''); err('hora', ''); err('numero', '');

    if (!f || !h) {
      linkActual = '';
      outResumen.textContent = 'Completá día y hora.';
      outLink.textContent = '—';
      if (!mensajeEditado) txtMensaje.value = '';
      habilitar(false);
      return;
    }
    var v = E.validarClase(d, f, h);
    if (!v.ok) {
      linkActual = '';
      if (v.motivo === 'pasada') err(f < E.hoyArgentina() ? 'fecha' : 'hora', 'Ese día y hora ya pasaron.');
      else if (v.motivo === 'fecha') err('fecha', 'Revisá la fecha.');
      else err('hora', 'Revisá la hora.');
      outResumen.textContent = 'Revisá los datos.';
      outLink.textContent = '—';
      habilitar(false);
      return;
    }
    linkActual = armarLink(d, f, h, o);
    outResumen.textContent = E.claseHumana(d, f, h);
    outLink.textContent = linkActual;
    btnProbar.href = linkActual;
    if (!mensajeEditado) txtMensaje.value = mensajePara(d, f, h, linkActual);
    habilitar(true);
    actualizarWa();
  }

  function actualizarWa() {
    if (!linkActual) return;
    var numero = '';
    if (inNumero.value.trim()) {
      var n = E.normalizarCelular(inNumero.value);
      if (!n) { err('numero', 'No parece un celular argentino. Probá así: 11 2345-6789.'); }
      else numero = n.e164;
    }
    btnWa.href = E.waLink(txtMensaje.value, numero);
  }

  function copiar(texto) {
    function ok() {
      E.show(avisoCopiado, true);
      clearTimeout(copiar._t);
      copiar._t = setTimeout(function () { E.show(avisoCopiado, false); }, 2500);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(texto).then(ok, function () { copiarViejo(texto) && ok(); });
    } else if (copiarViejo(texto)) ok();
  }

  function copiarViejo(texto) {
    var ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  form.addEventListener('input', function (ev) {
    if (ev.target === inNumero) { actualizarWa(); return; }
    mensajeEditado = false; // si cambia la clase, regeneramos el mensaje
    actualizar();
  });
  form.addEventListener('change', function (ev) { if (ev.target !== inNumero) { mensajeEditado = false; actualizar(); } });
  txtMensaje.addEventListener('input', function () { mensajeEditado = true; actualizarWa(); });
  btnCopiar.addEventListener('click', function () { if (linkActual) copiar(linkActual); });
  btnCopiarMsj.addEventListener('click', function () { if (linkActual) copiar(txtMensaje.value); });
  btnWa.addEventListener('click', function (ev) { if (!linkActual) ev.preventDefault(); else actualizarWa(); });
  form.addEventListener('submit', function (ev) { ev.preventDefault(); });

  actualizar();
})();
