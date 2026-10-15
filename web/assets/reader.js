/* Lector de páginas: modo página a página (derecha→izquierda o izquierda→derecha) y modo continuo (scroll vertical). */
(function (V) {
  'use strict';

  V.createReader = function (opts) {
    var el = V.el;
    var root = el('div', { class: 'rd', tabindex: '0', 'aria-label': 'Lector de páginas' });
    var stage = el('div', { class: 'rd-stage' });
    var scroller = el('div', { class: 'rd-scroll' });
    var zoneL = el('button', { type: 'button', class: 'rd-zone rd-left', tabindex: '-1', 'aria-hidden': 'true' });
    var zoneR = el('button', { type: 'button', class: 'rd-zone rd-right', tabindex: '-1', 'aria-hidden': 'true' });
    var note = el('div', { class: 'rd-note', role: 'status' });
    root.append(stage, scroller, zoneL, zoneR, note);
    opts.container.append(root);

    var chapter = null;
    var page = 0;
    var rtl = opts.rtl !== false;
    var mode = opts.mode || 'page';
    var fit = opts.fit === 'width' ? 'width' : 'screen';
    var observer = null;
    var suppress = false;
    var destroyed = false;

    function total() { return chapter ? chapter.pages.length : 0; }

    function notify(silent) {
      if (!silent && opts.onPage) opts.onPage(page, total());
    }

    /* ---------- modo página ---------- */
    function preload(i) {
      if (!chapter || i < 0 || i >= total()) return;
      var im = new Image();
      im.decoding = 'async';
      im.src = chapter.pages[i].url;
    }

    function renderPage() {
      V.clear(stage);
      if (!chapter || !total()) {
        stage.append(el('div', { class: 'rd-empty', text: 'Este capítulo todavía no tiene páginas.' }));
        return;
      }
      var p = chapter.pages[page];
      var wrap = el('div', { class: 'rd-frame' });
      var img = el('img', { class: 'rd-img is-loading', alt: 'Página ' + (page + 1) + ' de ' + total(), decoding: 'async', draggable: 'false' });
      zoomImg = img;
      if (p.width && p.height) { img.width = p.width; img.height = p.height; }
      img.addEventListener('load', function () { img.classList.remove('is-loading'); reflow(); });
      img.addEventListener('error', function () {
        img.classList.remove('is-loading');
        wrap.replaceChildren(el('div', { class: 'rd-empty' },
          el('p', { text: 'No se pudo cargar esta página.' }),
          el('button', { type: 'button', class: 'btn', text: 'Reintentar', onclick: renderPage })));
      });
      img.src = p.url;
      wrap.append(img);
      stage.append(wrap);
      resetZoom();
      preload(page + 1);
      preload(page + 2);
    }

    /* ---------- modo continuo ---------- */
    function renderScroll() {
      V.clear(scroller);
      if (observer) { observer.disconnect(); observer = null; }
      if (!chapter || !total()) { scroller.append(el('div', { class: 'rd-empty', text: 'Este capítulo todavía no tiene páginas.' })); return; }
      var imgs = chapter.pages.map(function (p, i) {
        var img = el('img', { class: 'rd-strip', src: p.url, alt: 'Página ' + (i + 1) + ' de ' + total(), loading: i < 3 ? 'eager' : 'lazy', decoding: 'async', draggable: 'false' });
        if (p.width && p.height) { img.width = p.width; img.height = p.height; }
        img.dataset.i = String(i);
        scroller.append(img);
        return img;
      });
      if ('IntersectionObserver' in window) {
        var seen = {};
        observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) { seen[e.target.dataset.i] = e.isIntersecting ? e.intersectionRatio : 0; });
          if (suppress) return;
          var best = -1, bestR = 0;
          Object.keys(seen).forEach(function (k) { if (seen[k] > bestR) { bestR = seen[k]; best = Number(k); } });
          if (best >= 0 && best !== page) { page = best; notify(false); }
        }, { root: scroller, threshold: [0, 0.25, 0.5, 0.75, 1] });
        imgs.forEach(function (im) { observer.observe(im); });
      }
    }

    function scrollToPage(i) {
      var img = scroller.querySelector('[data-i="' + i + '"]');
      if (!img) return;
      suppress = true;
      scroller.scrollTop = img.offsetTop - scroller.offsetTop;
      setTimeout(function () { suppress = false; }, 120);
    }

    function render() {
      root.classList.toggle('is-scroll', mode === 'scroll');
      root.classList.toggle('is-rtl', rtl);
      root.classList.toggle('is-fit-width', fit === 'width');
      if (mode === 'scroll') { stage.hidden = true; scroller.hidden = false; zoneL.hidden = zoneR.hidden = true; renderScroll(); scrollToPage(page); }
      else { stage.hidden = false; scroller.hidden = true; zoneL.hidden = zoneR.hidden = false; renderPage(); }
      zoneL.setAttribute('aria-label', rtl ? 'Página siguiente' : 'Página anterior');
      zoneR.setAttribute('aria-label', rtl ? 'Página anterior' : 'Página siguiente');
    }

    /* ---------- navegación ---------- */
    function goto(i, o) {
      if (!chapter || !total()) return;
      var silent = o && o.silent;
      var clamped = Math.max(0, Math.min(total() - 1, i));
      var changed = clamped !== page;
      page = clamped;
      if (mode === 'scroll') scrollToPage(page); else if (changed || !stage.firstChild) renderPage();
      if (changed || !silent) notify(silent);
    }
    function step(d) {
      if (!chapter) return;
      var t = page + d;
      if (t < 0 || t >= total()) { if (opts.onEdge) opts.onEdge(d); return; }
      goto(t);
    }

    zoneL.addEventListener('click', function () { step(rtl ? 1 : -1); root.focus({ preventScroll: true }); });
    zoneR.addEventListener('click', function () { step(rtl ? -1 : 1); root.focus({ preventScroll: true }); });

    root.addEventListener('keydown', function (e) {
      if (e.target !== root || e.altKey || e.ctrlKey || e.metaKey) return;
      var k = e.key, d = 0;
      if (mode === 'scroll') {
        if (k === 'Home') { goto(0); e.preventDefault(); }
        else if (k === 'End') { goto(total() - 1); e.preventDefault(); }
        return;
      }
      if (k === 'ArrowLeft') d = rtl ? 1 : -1;
      else if (k === 'ArrowRight') d = rtl ? -1 : 1;
      else if (k === 'PageDown' || k === ' ') d = 1;
      else if (k === 'PageUp') d = -1;
      else if (k === 'Home') { goto(0); e.preventDefault(); return; }
      else if (k === 'End') { goto(total() - 1); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      step(d);
    });

    /* ---------- zoom táctil: pellizco, arrastre y doble toque ---------- */
    var MIN_SCALE = 1, MAX_SCALE = 4;
    var scale = 1, tx = 0, ty = 0;
    var pointers = new Map();
    var prevDist = 0, prevMid = null;
    var gesture = null;
    var lastTap = { t: 0, x: 0, y: 0 };
    var zoomImg = null;

    // Geometría de la imagen sin transformar, en coordenadas del escenario.
    function imgGeom() {
      if (!zoomImg) return null;
      var r = zoomImg.getBoundingClientRect();
      var sr = stage.getBoundingClientRect();
      return {
        w: r.width / scale, h: r.height / scale,
        cx: (r.left + r.width / 2 - tx) - sr.left,
        cy: (r.top + r.height / 2 - ty) - sr.top,
        sw: stage.clientWidth, sh: stage.clientHeight, sr: sr,
      };
    }
    // Mantiene la imagen dentro del recuadro (o centrada si es más chica).
    function clampT(g) {
      if (!g) return;
      var cw = scale * g.w, ch = scale * g.h;
      if (cw <= g.sw + 0.5) tx = g.sw / 2 - g.cx;
      else tx = Math.max(g.sw - g.cx - cw / 2, Math.min(cw / 2 - g.cx, tx));
      if (ch <= g.sh + 0.5) ty = g.sh / 2 - g.cy;
      else ty = Math.max(g.sh - g.cy - ch / 2, Math.min(ch / 2 - g.cy, ty));
    }
    function applyZoom() {
      if (!zoomImg) return;
      var active = Math.abs(scale - 1) > 0.001 || Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5;
      zoomImg.style.transform = active
        ? 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + scale.toFixed(4) + ')'
        : '';
      root.classList.toggle('is-zoomed', scale > 1.001);
    }
    function resetZoom() { scale = 1; tx = 0; ty = 0; applyZoom(); }
    function reflow() { var g = imgGeom(); clampT(g); applyZoom(); }
    function zoomAt(clientX, clientY, target) {
      var g = imgGeom(); if (!g) return;
      var s2 = Math.max(MIN_SCALE, Math.min(MAX_SCALE, target));
      var k = s2 / scale;
      var px = clientX - g.sr.left, py = clientY - g.sr.top;
      tx = (px - g.cx) * (1 - k) + k * tx;
      ty = (py - g.cy) * (1 - k) + k * ty;
      scale = s2;
      clampT(g); applyZoom();
    }

    function ptPos(e) { return { x: e.clientX, y: e.clientY }; }

    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      pointers.set(e.pointerId, ptPos(e));
      if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        prevDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        prevMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        gesture = null;
      } else if (pointers.size === 1) {
        gesture = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: Date.now(), mode: null };
      }
      try { if (stage.setPointerCapture) stage.setPointerCapture(e.pointerId); } catch (err) {}
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, ptPos(e));

      if (pointers.size >= 2 && prevMid) {
        e.preventDefault();
        var pts = Array.from(pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        var g = imgGeom();
        if (g) {
          var s2 = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * (dist / prevDist)));
          var k = s2 / scale;
          var px = mid.x - g.sr.left, py = mid.y - g.sr.top;
          tx = (px - g.cx) * (1 - k) + k * tx;
          ty = (py - g.cy) * (1 - k) + k * ty;
          scale = s2;
          clampT(g); applyZoom();
        }
        prevDist = dist; prevMid = mid;
        return;
      }

      if (!gesture) return;
      if (!gesture.mode && (Math.abs(e.clientX - gesture.x) > 8 || Math.abs(e.clientY - gesture.y) > 8)) {
        var g2 = imgGeom();
        var cw = g2 ? scale * g2.w : 0, ch = g2 ? scale * g2.h : 0;
        var horizontal = Math.abs(e.clientX - gesture.x) > Math.abs(e.clientY - gesture.y);
        if (!g2) gesture.mode = 'none';
        else if (horizontal && cw > g2.sw + 1) gesture.mode = 'pan';
        else if (!horizontal && ch > g2.sh + 1) gesture.mode = 'pan';
        else if (horizontal) gesture.mode = 'swipe';
        else gesture.mode = 'none';
      }
      if (gesture.mode === 'pan') {
        e.preventDefault();
        var g3 = imgGeom();
        tx += e.clientX - gesture.lx;
        ty += e.clientY - gesture.ly;
        if (g3) clampT(g3);
        applyZoom();
        gesture.lx = e.clientX; gesture.ly = e.clientY;
      }
    });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      var wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      try { if (stage.releasePointerCapture) stage.releasePointerCapture(e.pointerId); } catch (err) {}
      if (pointers.size !== 0) return;
      prevDist = 0; prevMid = null;
      if (wasSingle && gesture && gesture.mode !== 'pan') {
        var dur = Date.now() - gesture.t;
        var ddx = e.clientX - gesture.x, ddy = e.clientY - gesture.y;
        var moved = Math.hypot(ddx, ddy);
        if (moved < 12 && dur < 300) {
          var now = Date.now();
          if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
            lastTap.t = 0;
            if (scale > 1.05) resetZoom(); else zoomAt(e.clientX, e.clientY, 2.5);
          } else {
            lastTap = { t: now, x: e.clientX, y: e.clientY };
          }
        } else if (gesture.mode === 'swipe' || (!gesture.mode && Math.abs(ddx) > 50 && Math.abs(ddy) < 40)) {
          step((ddx > 0) === rtl ? 1 : -1);
        }
      }
      gesture = null;
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', function (e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) { prevDist = 0; prevMid = null; gesture = null; }
    });
    stage.addEventListener('dblclick', function (e) {
      e.preventDefault();
      if (scale > 1.05) resetZoom(); else zoomAt(e.clientX, e.clientY, 2.5);
    });
    window.addEventListener('resize', reflow);

    render();

    return {
      el: root,
      load: function (ch, start) {
        chapter = ch;
        page = Math.max(0, Math.min(Math.max(0, total() - 1), start || 0));
        render();
        notify(false);
      },
      goto: goto,
      next: function () { step(1); },
      prev: function () { step(-1); },
      get page() { return page; },
      get total() { return total(); },
      get rtl() { return rtl; },
      get mode() { return mode; },
      get fit() { return fit; },
      setRtl: function (b) { rtl = !!b; render(); },
      setMode: function (m) { mode = m === 'scroll' ? 'scroll' : 'page'; render(); },
      setFit: function (f) { fit = f === 'width' ? 'width' : 'screen'; root.classList.toggle('is-fit-width', fit === 'width'); resetZoom(); reflow(); },
      focus: function () { root.focus({ preventScroll: true }); },
      say: function (msg) { note.textContent = msg || ''; note.classList.toggle('on', !!msg); },
      resetZoom: resetZoom,
      reflow: reflow,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (observer) observer.disconnect();
        window.removeEventListener('resize', reflow);
        root.remove();
      },
    };
  };
})(window.Valle = window.Valle || {});
