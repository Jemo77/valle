/* Lienzo de dibujo. Con `channel` es un lienzo compartido en tiempo real; sin él, uno personal guardado en el navegador. */
(function (V) {
  'use strict';

  var W = 1000, H = 625;
  var COLORS = [
    ['#e4e8da', 'Papel'], ['#86b06a', 'Musgo'], ['#8a86b4', 'Crepúsculo'], ['#f08a3c', 'Ámbar'], ['#a3b3a6', 'Bruma'],
  ];

  V.createCanvasTool = function (opts) {
    var el = V.el;
    var channel = opts.channel || null;
    var shared = !!channel;
    var cv = el('canvas', { width: W, height: H, 'aria-label': shared ? 'Lienzo compartido' : 'Lienzo de dibujo' });
    var cx = cv.getContext('2d');
    var tool = 'brush', color = COLORS[0][0], size = 7;
    var drawing = false, lastP = null, mid = null, undo = [], saveT = 0, pen = false;
    var sid = '', pending = [], flushT = 0;
    var lastSeq = 0, remoteLast = {};
    var offs = [];
    var statusEl = el('span', { class: 'cv-status', role: 'status' });
    var destroyed = false;

    /* ---------- barra de herramientas ---------- */
    var bBrush = el('button', { type: 'button', text: 'Pincel', 'aria-pressed': 'true' });
    var bEraser = el('button', { type: 'button', text: 'Goma', 'aria-pressed': 'false' });
    var sizeOut = el('output', { text: String(size) });
    var sizeIn = el('input', { type: 'range', min: '1', max: '36', value: String(size), 'aria-label': 'Grosor' });
    var swatches = COLORS.map(function (c, i) {
      return el('button', { type: 'button', class: 'sw', style: { '--c': c[0] }, 'aria-label': c[1], 'aria-pressed': i === 0 ? 'true' : 'false', dataset: { c: c[0] } });
    });
    var acts = el('div', { class: 'acts' });
    if (!shared) acts.append(el('button', { type: 'button', class: 'btn', text: 'Deshacer', onclick: doUndo }));
    var clearBtn = V.armedButton('Limpiar', shared ? '¿Para todos?' : '¿Seguro?', doClear);
    acts.append(clearBtn);
    if (!shared && V.api && V.api.features && V.api.features.download) {
      acts.append(el('button', { type: 'button', class: 'btn', text: 'Descargar', onclick: download }));
    }

    var tools = el('div', { class: 'tools', role: 'toolbar', 'aria-label': 'Herramientas de dibujo' },
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Herramienta' }, bBrush, bEraser),
      el('div', { class: 'swatches', role: 'group', 'aria-label': 'Pigmento' }, swatches),
      el('label', { class: 'size' }, 'Grosor ', sizeIn, sizeOut),
      acts);
    var wrap = el('div', { class: 'cwrap' }, cv);
    opts.container.append(tools, wrap, statusEl);

    function setTool(t) {
      tool = t;
      bBrush.setAttribute('aria-pressed', t === 'brush' ? 'true' : 'false');
      bEraser.setAttribute('aria-pressed', t === 'eraser' ? 'true' : 'false');
    }
    bBrush.addEventListener('click', function () { setTool('brush'); });
    bEraser.addEventListener('click', function () { setTool('eraser'); });
    swatches.forEach(function (b) {
      b.addEventListener('click', function () {
        color = b.dataset.c;
        swatches.forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        setTool('brush');
      });
    });
    sizeIn.addEventListener('input', function () { size = Number(sizeIn.value); sizeOut.textContent = String(size); });

    /* ---------- dibujo ---------- */
    function pos(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, p: e.pressure };
    }
    function style(t, c, s, p) {
      cx.lineCap = 'round'; cx.lineJoin = 'round';
      cx.globalCompositeOperation = t === 'eraser' ? 'destination-out' : 'source-over';
      cx.strokeStyle = c; cx.fillStyle = c;
      var f = pen && p > 0 ? 0.3 + p * 1.2 : 1;
      cx.lineWidth = (t === 'eraser' ? s * 1.8 : s) * f;
    }
    function snap() { undo.push(cx.getImageData(0, 0, W, H)); if (undo.length > 12) undo.shift(); }

    function queue(p) {
      pending.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
      if (pending.length >= 40) flush(false);
      else if (!flushT) flushT = setTimeout(function () { flush(false); }, 60);
    }
    function flush(end) {
      clearTimeout(flushT); flushT = 0;
      if (!channel || (!pending.length && !end)) return;
      if (!pending.length) pending = [lastP ? [lastP.x, lastP.y] : [0, 0]];
      channel.send('stroke', { sid: sid, tool: tool, color: color, size: size, pts: pending, end: !!end });
      pending = pending.length ? [pending[pending.length - 1]] : [];
      if (end) pending = [];
    }

    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
      pen = e.pointerType === 'pen';
      if (!shared) snap();
      drawing = true;
      sid = Math.random().toString(36).slice(2, 10);
      var p = pos(e);
      style(tool, color, size, p.p);
      cx.beginPath(); cx.arc(p.x, p.y, cx.lineWidth / 2, 0, Math.PI * 2); cx.fill();
      lastP = p; mid = p;
      pending = [];
      if (shared) queue(p);
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (!evs.length) evs = [e];
      for (var i = 0; i < evs.length; i += 1) {
        var p = pos(evs[i]);
        style(tool, color, size, p.p);
        var m = { x: (lastP.x + p.x) / 2, y: (lastP.y + p.y) / 2 };
        cx.beginPath(); cx.moveTo(mid.x, mid.y); cx.quadraticCurveTo(lastP.x, lastP.y, m.x, m.y); cx.stroke();
        lastP = p; mid = m;
        if (shared) queue(p);
      }
    });
    function end() {
      if (!drawing) return;
      drawing = false;
      cx.globalCompositeOperation = 'source-over';
      if (shared) flush(true); else persist();
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    function doUndo() { var s = undo.pop(); if (s) { cx.putImageData(s, 0, 0); persist(); } }
    function doClear() {
      if (shared) { channel.send('clear'); return; }
      snap(); cx.clearRect(0, 0, W, H); persist();
    }
    function download() {
      var tmp = el('canvas', { width: W, height: H });
      var t = tmp.getContext('2d');
      t.fillStyle = '#0f1c18'; t.fillRect(0, 0, W, H); t.drawImage(cv, 0, 0);
      var a = el('a', { href: tmp.toDataURL('image/png'), download: 'valle-dibujo.png' });
      document.body.append(a); a.click(); a.remove();
    }

    /* ---------- personal: se guarda en el navegador ---------- */
    function persist() {
      if (shared || !opts.storageKey) return;
      clearTimeout(saveT);
      saveT = setTimeout(function () { try { V.ls.set(opts.storageKey, cv.toDataURL('image/png')); } catch (e) { /* sin espacio */ } }, 600);
    }
    if (!shared && opts.storageKey) {
      var saved = V.ls.get(opts.storageKey);
      if (saved) { var im = new Image(); im.onload = function () { cx.drawImage(im, 0, 0); }; im.src = saved; }
      else if (opts.sample) opts.sample(cx);
    }

    /* ---------- compartido: trazos remotos ---------- */
    function applyChunk(c) {
      var key = c.cid + ':' + c.sid;
      var prev = remoteLast[key];
      var pts = c.pts;
      cx.save();
      cx.lineCap = 'round'; cx.lineJoin = 'round';
      cx.globalCompositeOperation = c.tool === 'eraser' ? 'destination-out' : 'source-over';
      cx.strokeStyle = c.color; cx.fillStyle = c.color;
      cx.lineWidth = c.tool === 'eraser' ? c.size * 1.8 : c.size;
      var from = prev || pts[0];
      if (!prev && pts.length === 1) {
        cx.beginPath(); cx.arc(pts[0][0], pts[0][1], cx.lineWidth / 2, 0, Math.PI * 2); cx.fill();
      }
      cx.beginPath();
      cx.moveTo(from[0], from[1]);
      for (var i = prev ? 0 : 1; i < pts.length; i += 1) cx.lineTo(pts[i][0], pts[i][1]);
      cx.stroke();
      cx.restore();
      remoteLast[key] = c.end ? null : pts[pts.length - 1];
      if (c.end) delete remoteLast[key];
    }

    function restore(snapshot, chunks) {
      cx.clearRect(0, 0, W, H);
      remoteLast = {};
      function replay() { (chunks || []).forEach(applyChunk); }
      if (snapshot) {
        var im = new Image();
        im.onload = function () { if (destroyed) return; cx.drawImage(im, 0, 0, W, H); replay(); };
        im.onerror = replay;
        im.src = snapshot;
      } else replay();
    }

    if (shared) {
      statusEl.textContent = 'Conectando…';
      offs.push(channel.on('init', function (m) {
        lastSeq = m.seq || 0;
        restore(m.snapshot, m.chunks);
        statusEl.textContent = peersText(m.n);
      }));
      offs.push(channel.on('stroke', function (m) {
        if (m.cid === channel.cid) return;
        lastSeq = Math.max(lastSeq, m.seq || 0);
        applyChunk(m);
      }));
      offs.push(channel.on('clear', function (m) {
        lastSeq = Math.max(lastSeq, m.seq || 0);
        cx.clearRect(0, 0, W, H); remoteLast = {};
        V.toast(m.by ? m.by + ' limpió el lienzo.' : 'El lienzo se limpió.');
      }));
      offs.push(channel.on('peers', function (m) { statusEl.textContent = peersText(m.n); }));
      offs.push(channel.on('snapshot_request', function () {
        try { channel.send('snapshot', { dataUrl: cv.toDataURL('image/png'), upToSeq: lastSeq }); } catch (e) { /* lienzo ilegible */ }
      }));
      offs.push(channel.on('disconnected', function () { statusEl.textContent = 'Sin conexión. Reconectando…'; }));
      offs.push(channel.on('error', function (m) { statusEl.textContent = m.message || 'No se pudo entrar al lienzo.'; }));
    }
    function peersText(n) {
      return n > 1 ? n + ' personas dibujando acá' : 'Estás solo por ahora';
    }

    return {
      canvas: cv,
      destroy: function () {
        destroyed = true;
        clearTimeout(flushT); clearTimeout(saveT);
        offs.forEach(function (f) { f(); });
        if (channel) channel.close();
        tools.remove(); wrap.remove(); statusEl.remove();
      },
    };
  };
})(window.Valle = window.Valle || {});
