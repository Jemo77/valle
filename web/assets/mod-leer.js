/* Biblioteca y lector. Exporta Valle.mountReading para que las salas de lectura en grupo reutilicen el lector. */
(function (V) {
  'use strict';
  var el = V.el;

  var prefs = {
    get rtl() { return V.ls.get('rtl') !== '0'; },
    set rtl(v) { V.ls.set('rtl', v ? '1' : '0'); },
    get mode() { return V.ls.get('mode') === 'scroll' ? 'scroll' : 'page'; },
    set mode(v) { V.ls.set('mode', v); },
  };

  /**
   * Monta un lector con barra de control.
   * opts: { container, api, onPage(chapterId,page), onChapter(chapterId), lockNav, startChapter, startPage, series }
   * Devuelve { loadChapter, setPage, reader, destroy, chapter }.
   */
  V.mountReading = function (opts) {
    var api = opts.api;
    var box = opts.container;
    var titleB = el('b');
    var titleS = el('span');
    var pgOut = el('span', { id: 'r-pg', text: '— / —', 'aria-live': 'polite' });
    var dirBtn = el('button', { type: 'button', class: 'chip' });
    var modeBtn = el('button', { type: 'button', class: 'chip' });
    var bar = el('div', { class: 'rbar' },
      el('div', { class: 'rt' }, titleB, titleS),
      el('div', { class: 'rctl' }, dirBtn, modeBtn));
    var host = el('div');
    var prevBtn = el('button', { type: 'button', class: 'btn', text: '← Capítulo anterior' });
    var nextBtn = el('button', { type: 'button', class: 'btn pri', text: 'Capítulo siguiente →' });
    var navRow = el('div', { class: 'rnav' }, prevBtn, pgOut, nextBtn);
    box.append(bar, host, navRow);

    var chapter = null;
    var token = 0;
    var progressT = 0;
    var destroyed = false;

    var reader = V.createReader({
      container: host, rtl: prefs.rtl, mode: prefs.mode,
      onPage: function (p, total) {
        pgOut.textContent = total ? (p + 1) + ' / ' + total : '— / —';
        if (chapter) {
          clearTimeout(progressT);
          progressT = setTimeout(function () { if (!destroyed && chapter) api.setProgress(chapter.id, p); }, 800);
          if (opts.onPage) opts.onPage(chapter.id, p);
        }
      },
      onEdge: function (d) {
        if (!chapter) return;
        if (d > 0 && chapter.nextId) loadChapter(chapter.nextId, 0, true);
        else if (d < 0 && chapter.prevId) loadChapter(chapter.prevId, 'last', true);
        else reader.say(d > 0 ? 'Fin de lo que hay por ahora.' : 'Este es el principio.');
      },
    });

    function syncButtons() {
      dirBtn.textContent = reader.rtl ? 'Derecha → izquierda' : 'Izquierda → derecha';
      dirBtn.setAttribute('aria-pressed', reader.rtl ? 'true' : 'false');
      dirBtn.hidden = reader.mode === 'scroll';
      modeBtn.textContent = reader.mode === 'scroll' ? 'Continuo' : 'Página a página';
      modeBtn.setAttribute('aria-pressed', reader.mode === 'scroll' ? 'true' : 'false');
      prevBtn.disabled = !chapter || !chapter.prevId || !!opts.lockNav;
      nextBtn.disabled = !chapter || !chapter.nextId || !!opts.lockNav;
    }
    dirBtn.addEventListener('click', function () { reader.setRtl(!reader.rtl); prefs.rtl = reader.rtl; syncButtons(); });
    modeBtn.addEventListener('click', function () { reader.setMode(reader.mode === 'scroll' ? 'page' : 'scroll'); prefs.mode = reader.mode; syncButtons(); });
    prevBtn.addEventListener('click', function () { if (chapter && chapter.prevId) loadChapter(chapter.prevId, 0, true); });
    nextBtn.addEventListener('click', function () { if (chapter && chapter.nextId) loadChapter(chapter.nextId, 0, true); });

    function loadChapter(id, page, notify) {
      var my = ++token;
      reader.say('');
      return api.getChapter(id).then(function (c) {
        if (destroyed || my !== token) return null;
        chapter = c;
        titleB.textContent = c.seriesTitle || '';
        titleS.textContent = V.chapterLabel(c);
        var start = page === 'last' ? Math.max(0, c.pages.length - 1) : (page || 0);
        reader.load(c, start);
        syncButtons();
        if (notify && opts.onChapter) opts.onChapter(c.id, start);
        return c;
      }, function (err) {
        if (destroyed || my !== token) return null;
        V.clear(host);
        host.append(V.errorView(err, function () { loadChapter(id, page, notify); }));
        throw err;
      });
    }
    syncButtons();

    return {
      reader: reader,
      get chapter() { return chapter; },
      loadChapter: loadChapter,
      setPage: function (p) { reader.goto(p, { silent: true }); pgOut.textContent = (reader.page + 1) + ' / ' + reader.total; },
      setLock: function (b) { opts.lockNav = b; syncButtons(); },
      destroy: function () { destroyed = true; clearTimeout(progressT); reader.destroy(); V.clear(box); },
    };
  };

  V.registerModule({
    id: 'leer', kanji: '読', label: 'Leer', order: 20,
    render: function (root, ctx) {
      var api = ctx.api;
      var alive = true;
      var reading = null;
      var seriesList = [];
      var selected = null;
      var progress = {};
      var detail = {};

      var shelf = el('ul', { class: 'shelf', 'aria-label': 'Series' });
      var right = el('div', { class: 'reader' });
      root.append(
        el('p', { class: 'eyebrow', text: 'Biblioteca · traducciones de aficionado' }),
        el('div', { class: 'read' }, shelf, right));

      function renderShelf() {
        V.clear(shelf);
        seriesList.forEach(function (s) {
          var b = el('button', { type: 'button', class: 'ser', 'aria-pressed': selected && selected.id === s.id ? 'true' : 'false', onclick: function () { openSeries(s.id); } },
            V.cover(s),
            el('span', { class: 'sm' }, el('b', { text: s.title }),
              el('em', { text: (s.sourceLang ? s.sourceLang.toUpperCase() + ' → ES · ' : '') + s.chapterCount + (s.chapterCount === 1 ? ' cap.' : ' caps.') })));
          shelf.append(el('li', {}, b));
        });
      }

      function teardownReader() { if (reading) { reading.destroy(); reading = null; } }

      function renderSeries(data, chapterId) {
        teardownReader();
        V.clear(right);
        var s = data.series, chs = data.chapters;
        var about = el('div', { class: 'about' },
          el('p', { class: 'sub', style: { margin: '0 0 6px' }, text: [s.author, s.originalTitle, V.statusLabel[s.status]].filter(Boolean).join(' · ') }),
          s.synopsis ? el('p', { class: 'synopsis', text: s.synopsis }) : null);
        if (!chs.length) {
          right.append(about);
          right.append(V.empty('Todavía no hay capítulos publicados', 'Volvé en un tiempo: se están preparando.'));
          return;
        }
        var chList = el('div', { class: 'chs', role: 'group', 'aria-label': 'Capítulos' });
        var readerBox = el('div');
        right.append(readerBox, chList, about);
        reading = V.mountReading({
          container: readerBox, api: api,
          onChapter: function (id) { markCurrent(id); history.replaceState(null, '', '#leer/' + id); },
        });
        function markCurrent(id) {
          V.$$('button', chList).forEach(function (b) {
            if (String(b.dataset.id) === String(id)) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
          });
        }
        chs.forEach(function (c) {
          var read = progress[c.id] != null;
          chList.append(el('button', { type: 'button', dataset: { id: c.id }, title: c.title || '', onclick: function () { reading.loadChapter(c.id, 0, true); } },
            read ? el('span', { class: 'dot2', 'aria-label': 'ya empezaste' }) : null, 'Cap. ' + V.fmtNumber(c.number)));
        });
        var first = chapterId || (function () {
          var started = chs.filter(function (c) { return progress[c.id] != null; });
          return started.length ? started[started.length - 1].id : chs[0].id;
        })();
        reading.loadChapter(first, progress[first] || 0, false).then(function () { markCurrent(first); }, function () {});
      }

      function openSeries(id, chapterId) {
        selected = seriesList.filter(function (s) { return s.id === id; })[0] || { id: id };
        renderShelf();
        V.clear(right); right.append(V.loadingView());
        var p = detail[id] ? Promise.resolve(detail[id]) : api.getSeries(id);
        p.then(function (d) {
          if (!alive) return;
          detail[id] = d;
          renderSeries(d, chapterId);
        }, function (err) { if (alive) { V.clear(right); right.append(V.errorView(err, function () { openSeries(id, chapterId); })); } });
      }

      function start() {
        V.clear(shelf); shelf.append(el('li', {}, V.loadingView()));
        Promise.all([api.listSeries(), api.getProgress().catch(function () { return {}; })]).then(function (r) {
          if (!alive) return;
          seriesList = r[0]; progress = r[1] || {};
          renderShelf();
          if (!seriesList.length) {
            V.clear(right);
            right.append(V.empty('La biblioteca está vacía', 'Cuando se publique la primera serie aparece acá.'));
            return;
          }
          var arg = ctx.params && ctx.params.arg;
          if (arg) {
            api.getChapter(arg).then(function (c) { if (alive) openSeries(c.seriesId, c.id); }, function () { if (alive) openSeries(seriesList[0].id); });
          } else openSeries(seriesList[0].id);
        }, function (err) {
          if (!alive) return;
          V.clear(shelf); V.clear(right);
          right.append(V.errorView(err, start));
        });
      }
      start();
      return function () { alive = false; teardownReader(); };
    },
  });
})(window.Valle = window.Valle || {});
