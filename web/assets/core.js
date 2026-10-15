/* Núcleo compartido: utilidades, avisos, ventanas, registro de módulos.
 *
 * El resto de la interfaz habla solo con `Valle.api`, que tiene dos implementaciones:
 *   - api-rest.js      → servidor propio con PostgreSQL (producción)
 *   - api-artifact.js  → capacidades de la página publicada (versión de prueba en vivo)
 */
(function (V) {
  'use strict';

  var doc = document;
  V.$ = function (s, r) { return (r || doc).querySelector(s); };
  V.$$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };

  /** Crea un elemento. `text` va como textContent; `html` solo para texto propio y fijo (íconos). */
  V.el = function (tag, props) {
    var n = doc.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { if (p.slice(0, 2) === '--') n.style.setProperty(p, v[p]); else n.style[p] = v[p]; });
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i += 1) append(n, arguments[i]);
    return n;
  };
  function append(parent, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(parent, k); }); return; }
    parent.append(kid.nodeType ? kid : doc.createTextNode(String(kid)));
  }
  V.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  /** Emisor de eventos mínimo. */
  V.emitter = function () {
    var map = {};
    return {
      on: function (evt, fn) {
        (map[evt] = map[evt] || []).push(fn);
        return function () { map[evt] = (map[evt] || []).filter(function (f) { return f !== fn; }); };
      },
      emit: function (evt) {
        var args = Array.prototype.slice.call(arguments, 1);
        (map[evt] || []).slice().forEach(function (fn) {
          try { fn.apply(null, args); } catch (e) { console.error(e); }
        });
      },
      clear: function () { map = {}; },
    };
  };
  V.bus = V.emitter();

  /* ---------- almacenamiento local (comodidades por navegador) ---------- */
  V.ls = {
    get: function (k) { try { return localStorage.getItem('valle:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('valle:' + k, v); } catch (e) { /* sin espacio o bloqueado */ } },
  };

  /* ---------- formato ---------- */
  V.fmtDate = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  };
  V.fmtNumber = function (n) {
    var x = Number(n);
    return Number.isInteger(x) ? String(x) : String(x).replace(/0+$/, '');
  };
  V.chapterLabel = function (c) {
    return 'Cap. ' + V.fmtNumber(c.number) + (c.title ? ' · ' + c.title : '');
  };
  V.debounce = function (fn, ms) {
    var t = 0;
    var f = function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
    f.cancel = function () { clearTimeout(t); };
    return f;
  };
  V.errMsg = function (e) {
    return (e && e.message) || 'Algo salió mal. Probá de nuevo.';
  };

  /* ---------- aviso flotante ---------- */
  var toastEl, toastT = 0;
  V.toast = function (msg) {
    if (!toastEl) toastEl = V.$('#toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.hidden = true; }, 3800);
  };

  /* ---------- ventana modal accesible ---------- */
  V.modal = function (opts) {
    var previous = doc.activeElement;
    var overlay = V.el('div', { class: 'modal-overlay' });
    var box = V.el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Ventana' });
    var closeBtn = V.el('button', { type: 'button', class: 'ib modal-x', 'aria-label': 'Cerrar', text: '×' });
    var head = V.el('div', { class: 'modal-h' }, V.el('h2', { class: 'mt2', text: opts.title || '' }), closeBtn);
    var body = V.el('div', { class: 'modal-b' });
    box.append(head, body);
    overlay.append(box);
    doc.body.append(overlay);

    function close() {
      doc.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previous && previous.focus) previous.focus();
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = V.$$('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])', box).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    doc.addEventListener('keydown', onKey, true);
    if (opts.render) opts.render(body, close);
    var focusable = V.$('input,select,textarea,button:not(.modal-x)', body);
    (focusable || closeBtn).focus();
    return { close: close, body: body };
  };

  /** Confirmación dentro de la página (no usa confirm()). Devuelve una promesa de booleano. */
  V.confirm = function (title, text, okLabel) {
    return new Promise(function (resolve) {
      var done = false;
      var m = V.modal({
        title: title,
        onClose: function () { if (!done) resolve(false); },
        render: function (body, close) {
          body.append(
            V.el('p', { class: 'sub', text: text }),
            V.el('div', { class: 'form-actions' },
              V.el('button', { type: 'button', class: 'btn', text: 'Cancelar', onclick: close }),
              V.el('button', { type: 'button', class: 'btn pri', text: okLabel || 'Aceptar', onclick: function () { done = true; resolve(true); close(); } })
            )
          );
        },
      });
      return m;
    });
  };

  /** Botón que pide un segundo toque para confirmar, sin ventana. */
  V.armedButton = function (label, armedLabel, onConfirm, cls) {
    var armed = false, t = 0;
    var b = V.el('button', { type: 'button', class: 'btn ' + (cls || ''), text: label });
    b.addEventListener('click', function () {
      if (!armed) {
        armed = true; b.textContent = armedLabel; b.classList.add('armed');
        t = setTimeout(reset, 3000);
        return;
      }
      clearTimeout(t); reset(); onConfirm();
    });
    function reset() { armed = false; b.textContent = label; b.classList.remove('armed'); }
    return b;
  };

  V.copyText = function (text) {
    function fallback() {
      var ta = V.el('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
      doc.body.append(ta); ta.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  };

  /* ---------- íconos y portadas generadas ---------- */
  V.stageIcon = function (s) {
    var g = '<path d="M8 44H48"/>', b;
    if (s === 'semilla') b = '<ellipse cx="28" cy="39" rx="5" ry="3.5"/><path d="M14 44q14-8 28 0"/>';
    else if (s === 'brote') b = '<path d="M28 44V26"/><path d="M28 32c-8 0-11-4-11-9 7 0 11 3 11 9z"/><path d="M28 28c6 0 9-3 9-8-6 0-9 3-9 8z"/>';
    else b = '<path d="M28 44V24"/><path d="M28 34L20 27M28 30L36 23"/><circle cx="28" cy="15" r="9"/><circle cx="18" cy="22" r="6"/><circle cx="38" cy="20" r="6"/>';
    return '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + g + b + '</svg>';
  };

  V.sproutIcon = '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M14 24V13"/><path d="M14 17c-5 0-7-3-7-6 5 0 7 2 7 6z"/><path d="M14 15c4 0 6-2 6-5-4 0-6 2-6 5z"/></svg>';

  /** Portada de reemplazo cuando una serie no tiene imagen. */
  V.coverFallback = function (seed) {
    var n = Math.abs(Number(seed) || 0);
    var towers = [[4, 10, 6, 16, 4, 22], [6, 8, 5, 20, 7, 14], [3, 14, 5, 10, 8, 26]][n % 3];
    var s = '', x = 5, j;
    for (j = 0; j < towers.length; j += 2) {
      s += '<rect x="' + x + '" y="' + (44 - towers[j + 1]) + '" width="' + (towers[j] + 2) + '" height="' + towers[j + 1] + '" fill="#e4e8da" opacity="' + (0.35 + j * 0.1) + '"/>';
      x += towers[j] + 9;
    }
    return '<svg viewBox="0 0 44 62" aria-hidden="true"><rect x=".5" y=".5" width="43" height="61" fill="#0f1c18" stroke="rgba(205,228,196,.5)"/><circle cx="' + (30 - (n % 3) * 4) + '" cy="14" r="5" fill="#e4e8da" opacity=".85"/>' + s + '<path d="M2 44H42" stroke="#86b06a" stroke-width="1.2"/><path d="M4 44q2-6 3-9M9 44q0-5 3-8M33 44q1-5 4-7" stroke="#86b06a" stroke-width="1" fill="none"/></svg>';
  };

  V.cover = function (series, cls) {
    var box = V.el('span', { class: 'cov ' + (cls || '') });
    if (series.coverUrl) {
      var img = V.el('img', { src: series.coverUrl, alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', function () { box.innerHTML = V.coverFallback(series.id); });
      box.append(img);
    } else box.innerHTML = V.coverFallback(series.id);
    return box;
  };

  V.statusLabel = { ongoing: 'en curso', completed: 'completa', paused: 'en pausa' };

  /** Estado vacío con instrucción. */
  V.empty = function (title, text, action) {
    return V.el('div', { class: 'empty' },
      V.el('h3', { class: 'mt2', text: title }),
      text ? V.el('p', { class: 'sub', text: text }) : null,
      action || null);
  };

  /* ---------- vistas comunes de carga y error ---------- */
  V.loadingView = function () { return V.el('div', { class: 'loading', text: 'Cargando' }); };

  V.errorView = function (err, retry) {
    var el = V.el;
    var box = el('div', { class: 'empty' });
    var canLogin = V.ctx && V.ctx.requireLogin;
    if (err && err.status === 401 && canLogin) {
      box.append(
        el('h3', { class: 'mt2', text: 'Hace falta una cuenta' }),
        el('p', { class: 'sub', text: V.errMsg(err) }),
        el('button', { type: 'button', class: 'btn pri', text: 'Entrar', onclick: function () { V.ctx.requireLogin().then(function () { if (retry) retry(); }, function () {}); } }));
    } else {
      box.append(
        el('h3', { class: 'mt2', text: 'No se pudo cargar' }),
        el('p', { class: 'sub', text: V.errMsg(err) }),
        retry ? el('button', { type: 'button', class: 'btn', text: 'Reintentar', onclick: retry }) : null);
    }
    return box;
  };

  /* ---------- registro de módulos ---------- */
  V.modules = [];
  V.registerModule = function (m) { V.modules.push(m); V.modules.sort(function (a, b) { return a.order - b.order; }); };
})(window.Valle = window.Valle || {});
