/* Espacio Éter · landing de reserva (index.html) */
(function () {
  'use strict';
  var E = window.Eter;
  var qs = new URLSearchParams(window.location.search);
  var d = (qs.get('d') || '').toLowerCase().trim();
  var f = (qs.get('f') || '').trim();
  var h = (qs.get('h') || '').trim();
  var o = (qs.get('o') || '').trim().slice(0, 40) || 'WhatsApp';

  var check = E.validarClase(d, f, h);

  if (!check.ok) {
    var texto = E.el('texto-invalido');
    var msgWa = 'Hola Araceli! Quiero reservar la clase de prueba pero el link no me funciona. ¿Me lo mandás de nuevo?';
    if (check.motivo === 'pasada') {
      E.el('titulo-invalido').textContent = 'Esta clase ya pasó';
      texto.textContent = 'La fecha de este link ya quedó atrás. Escribinos y buscamos otro día que te quede cómodo.';
      msgWa = 'Hola Araceli! Me quedó vencido el link de la clase de prueba. ¿Me pasás otro día y horario?';
    } else if (check.motivo === 'lejana') {
      E.el('titulo-invalido').textContent = 'Esa fecha está muy lejos';
      texto.textContent = 'Por ahora reservamos hasta ' + E.MAX_DIAS_ADELANTE + ' días para adelante. Escribinos y buscamos una fecha que te quede cómoda.';
      msgWa = 'Hola Araceli! Mi link de la clase de prueba tiene una fecha muy lejana. ¿Me pasás otro día?';
    }
    E.el('wa-link-invalido').href = E.waLink(msgWa);
    E.show(E.el('vista-link-invalido'), true);
    document.title = 'Pedí tu link · Espacio Éter';
    return;
  }

  var clase = check.clase;
  var claseTexto = E.claseHumana(clase.d, clase.f, clase.h);
  E.el('clase-texto').textContent = claseTexto;
  E.el('wa-dudas').href = E.waLink('Hola Araceli! Tengo una duda sobre mi clase de prueba (' + claseTexto + ').');
  E.show(E.el('vista-reserva'), true);

  var form = E.el('form-reserva');
  var inNombre = E.el('nombre');
  var inWa = E.el('whatsapp');
  var btn = E.el('btn-pagar');
  var btnTexto = E.el('btn-pagar-texto');
  var errorEnvio = E.el('error-envio');
  var TEXTO_BTN = btnTexto.textContent;

  // Acro infantil: el formulario lo completa el/la adulto/a responsable (la planilla no cambia).
  if (clase.d === 'acro-infantil') {
    E.show(E.el('nota-infantil'), true);
    E.el('label-nombre').textContent = 'Tu nombre (adulto/a responsable)';
    E.el('label-whatsapp').textContent = 'Tu WhatsApp';
    inNombre.setAttribute('aria-describedby', 'nota-infantil nombre-error');
  }

  function setFieldError(input, msg) {
    var box = E.el(input.id + '-error');
    box.textContent = msg || '';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  // Al menos una letra (cualquier alfabeto, con tildes y ñ); mismo criterio que el servidor.
  var LETRA = (function () {
    try { return new RegExp('\\p{L}', 'u'); } catch (e) { return /[A-Za-zÀ-ÖØ-öø-ÿÑñ]/; }
  })();
  var INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD\u061C\u180E]/g;

  function validarNombre() {
    var v = inNombre.value.replace(INVISIBLES, '').replace(/\s+/g, ' ').trim();
    if (v.length < 2) { setFieldError(inNombre, 'Contanos tu nombre (al menos 2 letras).'); return null; }
    if (!LETRA.test(v)) { setFieldError(inNombre, 'Escribí tu nombre con letras, así sabemos cómo llamarte (por ejemplo, Sofi).'); return null; }
    setFieldError(inNombre, '');
    return v.slice(0, 60);
  }

  function validarWa() {
    var raw = inWa.value.trim();
    if (!raw) { setFieldError(inWa, 'Necesitamos tu WhatsApp para confirmarte la clase.'); return null; }
    var n = E.normalizarCelular(raw);
    if (!n) {
      var digitos = raw.replace(/\D/g, '');
      setFieldError(inWa, digitos.length === 8
        ? 'Sumale el código de área adelante (por ejemplo, 11).'
        : 'Ese número no parece un celular argentino. Probá así: 11 2345-6789.');
      return null;
    }
    setFieldError(inWa, '');
    return n;
  }

  // Mientras escribe, borramos el error apenas el dato queda bien (así el botón no "salta" al tocarlo).
  inNombre.addEventListener('input', function () { if (inNombre.getAttribute('aria-invalid') === 'true') validarNombre(); });
  inWa.addEventListener('input', function () { if (inWa.getAttribute('aria-invalid') === 'true') validarWa(); });
  // Al salir del campo solo mostramos errores nuevos; nunca los ocultamos acá.
  inNombre.addEventListener('blur', function () { if (inNombre.value && inNombre.getAttribute('aria-invalid') !== 'true') validarNombre(); });
  inWa.addEventListener('blur', function () { if (inWa.value && inWa.getAttribute('aria-invalid') !== 'true') validarWa(); });

  function mostrarError(html) {
    errorEnvio.innerHTML = html;
    E.show(errorEnvio, true);
    errorEnvio.setAttribute('tabindex', '-1');
    errorEnvio.focus();
  }

  function cargando(si) {
    btn.disabled = si;
    btn.setAttribute('aria-busy', si ? 'true' : 'false');
    btnTexto.textContent = si ? 'Preparando el pago…' : TEXTO_BTN;
  }

  /**
   * Solo redirigimos a Mercado Pago (www o sandbox). En modo prueba (mock) el servidor manda a
   * nuestra propia confirmacion.html: eso se acepta solo si coincide con este mismo sitio.
   */
  function initPointPermitido(res) {
    var u = String((res && res.init_point) || '');
    if (/[\s\\]/.test(u)) return false;
    if (u.indexOf('https://www.mercadopago.com.ar/') === 0 || u.indexOf('https://sandbox.mercadopago.com.ar/') === 0) return true;
    if (res && res.mode === 'mock') {
      var carpeta = window.location.pathname.replace(/[^\/]*$/, ''); // "/eter-clase-prueba/"
      var propia = window.location.origin + carpeta + 'confirmacion.html?';
      return u.indexOf(propia) === 0;
    }
    return false;
  }

  function waAyuda(nombre) {
    return E.waLink('Hola Araceli! ' + (nombre ? 'Soy ' + nombre + '. ' : '') +
      'Quise pagar la clase de prueba (' + claseTexto + ') desde la web pero no me dejó. ¿Me ayudás?');
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    E.show(errorEnvio, false);
    var nombre = validarNombre();
    var wa = validarWa();
    if (!nombre) { inNombre.focus(); return; }
    if (!wa) { inWa.focus(); return; }

    if (!E.scriptConfigurado()) {
      mostrarError('<p>La reserva online todavía no está activa. Escribinos y te la dejamos lista por WhatsApp.</p>' +
        '<p><a href="' + waAyuda(nombre) + '" rel="noopener">Escribir por WhatsApp</a></p>');
      return;
    }

    cargando(true);
    var payload = {
      action: 'create',
      nombre: nombre,
      whatsapp: wa.e164,
      disciplina: clase.d,
      fecha: clase.f,
      hora: clase.h,
      origen: o
    };

    try {
      sessionStorage.setItem('eter_reserva', JSON.stringify({ d: clase.d, f: clase.f, h: clase.h, o: o, nombre: nombre }));
    } catch (e) { /* modo privado: no pasa nada */ }

    E.llamarScript(payload, 25000).then(function (res) {
      if (res && res.ok && res.init_point && initPointPermitido(res)) {
        btnTexto.textContent = 'Te llevamos a Mercado Pago…';
        window.location.assign(res.init_point);
        return;
      }
      cargando(false);
      if (res && res.ok && res.init_point) {
        // Respuesta con un link de pago que no es de Mercado Pago: no redirigimos.
        mostrarError('<p>Recibimos un link de pago que no reconocemos, así que por seguridad no te llevamos ahí. ' +
          'No se te cobró nada. Escribinos y te ayudamos a reservar.</p>' +
          '<p><a href="' + waAyuda(nombre) + '" rel="noopener">Pedir ayuda por WhatsApp</a></p>');
        return;
      }
      if (res && res.error === 'rate_limited') {
        // Demasiados pedidos: el mensaje del servidor ya dice qué hacer; sin reintento automático.
        mostrarError('<p>' + escapeHtml(res.message || 'Hay muchos pedidos en este momento. Probá de nuevo en unos minutos.') + '</p>' +
          '<p><a href="' + waAyuda(nombre) + '" rel="noopener">Si preferís, escribinos por WhatsApp</a></p>');
        return;
      }
      var msg = (res && res.message) ? res.message : 'No pudimos preparar el pago.';
      mostrarError('<p>' + escapeHtml(msg) + ' Probá de nuevo en un ratito o escribinos.</p>' +
        '<p><a href="' + waAyuda(nombre) + '" rel="noopener">Pedir ayuda por WhatsApp</a></p>');
    }).catch(function () {
      cargando(false);
      mostrarError('<p>Se cortó la conexión mientras preparábamos el pago. Revisá tu internet y volvé a tocar el botón.</p>' +
        '<p><a href="' + waAyuda(nombre) + '" rel="noopener">O escribinos por WhatsApp</a></p>');
    });
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Si vuelve con "atrás" desde Mercado Pago, el botón no debe quedar trabado.
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) cargando(false); });
})();
