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
      if (p.width && p.height) { img.width = p.width; img.height = p.height; }
      img.addEventListener('load', function () { img.classList.remove('is-loading'); });
      img.addEventListener('error', function () {
        img.classList.remove('is-loading');
        wrap.replaceChildren(el('div', { class: 'rd-empty' },
          el('p', { text: 'No se pudo cargar esta página.' }),
          el('button', { type: 'button', class: 'btn', text: 'Reintentar', onclick: renderPage })));
      });
      img.src = p.url;
      wrap.append(img);
      stage.append(wrap);
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

    var sx = 0, sy = 0, tracking = false;
    stage.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse') return; tracking = true; sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 40) step((dx > 0) === rtl ? 1 : -1);
    });
    stage.addEventListener('pointercancel', function () { tracking = false; });

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
      setRtl: function (b) { rtl = !!b; render(); },
      setMode: function (m) { mode = m === 'scroll' ? 'scroll' : 'page'; render(); },
      focus: function () { root.focus({ preventScroll: true }); },
      say: function (msg) { note.textContent = msg || ''; note.classList.toggle('on', !!msg); },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (observer) observer.disconnect();
        root.remove();
      },
    };
  };
})(window.Valle = window.Valle || {});
