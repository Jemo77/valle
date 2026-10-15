/* Administración: se monta con Valle.mountAdmin(root, api). Se usa sola en /admin/ y como pestaña dentro de la versión de prueba. */
(function (V) {
  'use strict';
  var el = V.el;

  var SECTIONS = [
    ['resumen', '要', 'Resumen'],
    ['mangas', '読', 'Mangas'],
    ['proyectos', '作', 'Proyectos'],
    ['sitio', '谷', 'Sitio'],
    ['visitas', '想', 'Visitas'],
    ['personas', '人', 'Personas'],
  ];

  function field(label, input, hint) {
    return el('label', { class: 'field' }, el('span', { text: label }), input, hint ? el('small', { text: hint }) : null);
  }
  function badge(on, yes, no) { return el('span', { class: 'badge ' + (on ? 'live' : 'draft'), text: on ? yes : no }); }
  function wrapTable(table) { return el('div', { class: 'tbl-wrap' }, table); }
  function th(cols) { return el('thead', {}, el('tr', {}, cols.map(function (c) { return el('th', { text: c }); }))); }

  V.mountAdmin = function (root, api) {
    var A = api.admin;
    var features = api.features || {};
    var nav = el('nav', { class: 'adm-nav', role: 'tablist', 'aria-label': 'Secciones' });
    var body = el('div', { class: 'adm-body' });
    root.append(el('div', { class: 'adm' }, nav, body));
    var current = null;
    var disposers = [];

    SECTIONS.filter(function (s) { return s[0] !== 'personas' || features.adminPeople !== false; }).forEach(function (s) {
      var b = el('button', { type: 'button', role: 'tab', dataset: { s: s[0] }, 'aria-selected': 'false' },
        el('span', { class: 'kj', lang: 'ja', 'aria-hidden': 'true', text: s[1] }), s[2]);
      b.addEventListener('click', function () { open(s[0]); });
      nav.append(b);
    });

    function open(id, arg) {
      disposers.forEach(function (f) { f(); }); disposers = [];
      current = id;
      V.$$('button', nav).forEach(function (b) { b.setAttribute('aria-selected', b.dataset.s === id ? 'true' : 'false'); });
      V.clear(body);
      var view = { resumen: resumen, mangas: mangas, proyectos: proyectos, sitio: sitio, visitas: visitas, personas: personas }[id];
      view(body, arg);
    }

    function fail(box, err, retry) { V.clear(box); box.append(V.errorView(err, retry)); }

    /* ---------- resumen ---------- */
    function resumen(box) {
      box.append(el('h2', { class: 'mt', text: 'Resumen' }), el('p', { class: 'sub', text: 'Lo que hay en el valle ahora mismo.' }));
      var cards = el('div', { class: 'cards' });
      box.append(cards, el('h3', { class: 'mt2', text: 'Por dónde empezar' }));
      box.append(el('ol', { class: 'sub', style: { paddingLeft: '20px' } },
        el('li', { text: 'Mangas → “Nueva serie”: título, autor, sinopsis y portada.' }),
        el('li', { text: 'Dentro de la serie, “Nuevo capítulo” y arrastrá las imágenes de las páginas (se ordenan por nombre).' }),
        el('li', { text: 'Publicá la serie y el capítulo cuando estén listos. Hasta entonces nadie los ve.' })));
      function load() {
        cards.replaceChildren(V.loadingView());
        A.stats().then(function (s) {
          cards.replaceChildren();
          [['series', 'series'], ['chapters', 'capítulos'], ['pages', 'páginas'], ['projects', 'proyectos'], ['users', 'personas'], ['groups', 'grupos'], ['guestbook', 'huellas'], ['online', 'conectadas ahora']].forEach(function (k) {
            if (s[k[0]] == null) return;
            cards.append(el('div', { class: 'stat' }, el('b', { text: String(s[k[0]]) }), el('span', { text: k[1] })));
          });
        }, function (err) { fail(cards, err, load); });
      }
      load();
    }

    /* ---------- mangas ---------- */
    function mangas(box, arg) {
      if (arg && arg.chapter) return pagesView(box, arg.series, arg.chapter);
      if (arg && arg.series) return seriesView(box, arg.series);
      var list = el('div');
      box.append(
        el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('h2', { class: 'mt', text: 'Mangas' }),
          el('button', { type: 'button', class: 'btn pri', text: '+ Nueva serie', onclick: function () { open('mangas', { series: { id: null } }); } })),
        el('p', { class: 'sub', text: 'Cada serie tiene capítulos y cada capítulo, páginas. Lo que no está publicado solo lo ves vos.' }), list);
      function load() {
        list.replaceChildren(V.loadingView());
        A.listSeries().then(function (rows) {
          list.replaceChildren();
          if (!rows.length) { list.append(V.empty('Todavía no cargaste ninguna serie', 'Creá la primera con el botón de arriba.')); return; }
          var tb = el('tbody');
          rows.forEach(function (s) {
            tb.append(el('tr', {},
              el('td', {}, el('span', { class: 'cov thumb' }, V.cover(s))),
              el('td', {}, el('b', { text: s.title }), el('br'), el('span', { class: 'muted', text: [s.author, s.originalTitle].filter(Boolean).join(' · ') })),
              el('td', {}, badge(s.published, 'publicada', 'borrador')),
              el('td', { text: s.publishedChapters + ' / ' + s.chapterCount }),
              el('td', { class: 'act' }, el('button', { type: 'button', class: 'btn sm', text: 'Abrir', onclick: function () { open('mangas', { series: s }); } }))));
          });
          list.append(wrapTable(el('table', { class: 'tbl' }, th(['', 'Serie', 'Estado', 'Caps. publicados', '']), tb)));
        }, function (err) { fail(list, err, load); });
      }
      load();
    }

    function seriesView(box, s) {
      var isNew = !s.id;
      var crumbs = el('div', { class: 'crumbs' }, el('button', { type: 'button', text: 'Mangas', onclick: function () { open('mangas'); } }), '/', isNew ? 'Nueva serie' : s.title);
      box.append(crumbs);
      var formBox = el('div');
      var chBox = el('div');
      box.append(formBox, chBox);

      function renderForm(cur) {
        V.clear(formBox);
        var title = el('input', { type: 'text', maxlength: '120', value: cur.title || '', required: true });
        var orig = el('input', { type: 'text', maxlength: '120', value: cur.originalTitle || '' });
        var author = el('input', { type: 'text', maxlength: '80', value: cur.author || '' });
        var lang = el('select', {}, [['ja', 'Japonés'], ['en', 'Inglés'], ['ko', 'Coreano'], ['zh', 'Chino'], ['fr', 'Francés'], ['it', 'Italiano'], ['other', 'Otro']].map(function (l) { return el('option', { value: l[0], text: l[1] }); }));
        lang.value = cur.sourceLang || 'ja';
        var status = el('select', {}, [['ongoing', 'En curso'], ['completed', 'Completa'], ['paused', 'En pausa']].map(function (l) { return el('option', { value: l[0], text: l[1] }); }));
        status.value = cur.status || 'ongoing';
        var syn = el('textarea', { rows: '4', maxlength: '2000' }); syn.value = cur.synopsis || '';
        var pub = el('input', { type: 'checkbox' }); pub.checked = !!cur.published;
        var pos = el('input', { type: 'number', min: '0', max: '9999', value: String(cur.position || 0) });
        var err = el('p', { class: 'err', role: 'alert' });
        var save = el('button', { type: 'submit', class: 'btn pri', text: isNew ? 'Crear serie' : 'Guardar' });
        var form = el('form', { class: 'form', novalidate: true },
          el('div', { class: 'two' }, field('Título en español', title), field('Título original', orig)),
          el('div', { class: 'two' }, field('Autoría', author), field('Idioma original', lang)),
          el('div', { class: 'two' }, field('Estado de la obra', status), field('Orden en la biblioteca', pos, 'Menor número, primero.')),
          field('Sinopsis', syn),
          el('label', { class: 'field inline' }, pub, el('span', { text: 'Publicada (visible para todos)' })),
          err, el('div', { class: 'form-actions' },
            isNew ? null : V.armedButton('Eliminar serie', '¿Con todo?', function () {
              A.deleteSeries(cur.id).then(function () { V.toast('Serie eliminada.'); open('mangas'); }, function (e) { V.toast(V.errMsg(e)); });
            }, 'danger'),
            save));
        form.addEventListener('submit', function (e) {
          e.preventDefault(); err.textContent = '';
          if (!title.value.trim()) { err.textContent = 'La serie necesita un título.'; return; }
          save.disabled = true;
          A.saveSeries({ id: cur.id, title: title.value.trim(), originalTitle: orig.value.trim(), author: author.value.trim(), sourceLang: lang.value, synopsis: syn.value.trim(), status: status.value, published: pub.checked, position: Number(pos.value) || 0 })
            .then(function (saved) {
              V.toast('Serie guardada.');
              if (isNew) open('mangas', { series: saved }); else { s = saved; renderForm(saved); }
            }, function (er) { err.textContent = V.errMsg(er); save.disabled = false; });
        });
        formBox.append(el('h2', { class: 'mt', text: isNew ? 'Nueva serie' : 'Datos de la serie' }));
        if (!isNew) formBox.append(coverRow(cur));
        formBox.append(form);
      }

      function coverRow(cur) {
        var preview = el('span', { class: 'cov' }, V.cover(cur, 'big'));
        var input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': 'Elegir portada', style: { display: 'none' } });
        var msg = el('span', { class: 'muted' });
        var btn = el('button', { type: 'button', class: 'btn', text: cur.coverUrl ? 'Cambiar portada' : 'Subir portada', onclick: function () { input.click(); } });
        input.addEventListener('change', function () {
          var f = input.files[0];
          if (!f) return;
          btn.disabled = true; msg.textContent = 'Subiendo…';
          A.setCover(cur.id, f).then(function (url) {
            cur.coverUrl = url; V.clear(preview); preview.append(V.cover(cur, 'big')); msg.textContent = 'Portada actualizada.'; btn.textContent = 'Cambiar portada';
          }, function (e) { msg.textContent = V.errMsg(e); }).then(function () { btn.disabled = false; input.value = ''; });
        });
        return el('div', { class: 'row', style: { margin: '10px 0 18px' } }, preview, el('div', {}, btn, input, el('div', {}, msg)));
      }

      renderForm(s);
      if (isNew) return;

      chBox.append(el('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '28px' } },
        el('h2', { class: 'mt', text: 'Capítulos' }),
        el('button', { type: 'button', class: 'btn pri', text: '+ Nuevo capítulo', onclick: function () { chapterModal(s, null, loadChapters); } })));
      var chList = el('div');
      chBox.append(chList);
      function loadChapters() {
        chList.replaceChildren(V.loadingView());
        A.listChapters(s.id).then(function (rows) {
          chList.replaceChildren();
          if (!rows.length) { chList.append(V.empty('Sin capítulos todavía', 'Creá el primero y después subí sus páginas.')); return; }
          var tb = el('tbody');
          rows.forEach(function (c) {
            tb.append(el('tr', {},
              el('td', { text: V.fmtNumber(c.number) }),
              el('td', { text: c.title || '—' }),
              el('td', { text: String(c.pageCount) }),
              el('td', {}, badge(c.published, 'publicado', 'borrador')),
              el('td', { class: 'act' },
                el('button', { type: 'button', class: 'btn sm', text: 'Páginas', onclick: function () { open('mangas', { series: s, chapter: c }); } }), ' ',
                el('button', { type: 'button', class: 'btn sm', text: 'Editar', onclick: function () { chapterModal(s, c, loadChapters); } }))));
          });
          chList.append(wrapTable(el('table', { class: 'tbl' }, th(['N.º', 'Título', 'Págs.', 'Estado', '']), tb)));
        }, function (err) { fail(chList, err, loadChapters); });
      }
      loadChapters();
    }

    function chapterModal(series, ch, done) {
      V.modal({
        title: ch ? 'Editar capítulo' : 'Nuevo capítulo',
        render: function (body, close) {
          var num = el('input', { type: 'number', step: 'any', min: '0', required: true, value: ch ? String(ch.number) : '' });
          var title = el('input', { type: 'text', maxlength: '120', value: ch ? ch.title || '' : '' });
          var pub = el('input', { type: 'checkbox' }); pub.checked = ch ? !!ch.published : false;
          var err = el('p', { class: 'err', role: 'alert' });
          var save = el('button', { type: 'submit', class: 'btn pri', text: 'Guardar' });
          var form = el('form', { class: 'form', novalidate: true },
            field('Número', num, 'Se admiten decimales: 12.5 para un extra.'),
            field('Título (opcional)', title),
            el('label', { class: 'field inline' }, pub, el('span', { text: 'Publicado' })),
            err, el('div', { class: 'form-actions' },
              ch ? V.armedButton('Eliminar', '¿Seguro?', function () {
                A.deleteChapter(ch.id).then(function () { close(); V.toast('Capítulo eliminado.'); done(); }, function (e) { err.textContent = V.errMsg(e); });
              }, 'danger') : null, save));
          form.addEventListener('submit', function (e) {
            e.preventDefault(); err.textContent = '';
            if (num.value === '' || isNaN(Number(num.value))) { err.textContent = 'Poné el número del capítulo.'; return; }
            save.disabled = true;
            A.saveChapter(series.id, { id: ch && ch.id, number: Number(num.value), title: title.value.trim(), published: pub.checked })
              .then(function () { close(); V.toast('Capítulo guardado.'); done(); }, function (er) { err.textContent = V.errMsg(er); save.disabled = false; });
          });
          body.append(form);
        },
      });
    }

    /* ---------- páginas de un capítulo ---------- */
    function pagesView(box, series, chapter) {
      box.append(el('div', { class: 'crumbs' },
        el('button', { type: 'button', text: 'Mangas', onclick: function () { open('mangas'); } }), '/',
        el('button', { type: 'button', text: series.title, onclick: function () { open('mangas', { series: series }); } }), '/',
        'Cap. ' + V.fmtNumber(chapter.number)));
      box.append(el('h2', { class: 'mt', text: 'Páginas del capítulo ' + V.fmtNumber(chapter.number) }),
        el('p', { class: 'sub', text: 'Subí las imágenes (JPG, PNG, WebP o GIF). Se ordenan por nombre de archivo; después podés arrastrarlas o usar las flechas.' }));

      var input = el('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' }, 'aria-label': 'Elegir imágenes' });
      var prog = el('div', { class: 'prog', hidden: true }, el('i'));
      var status = el('p', { class: 'muted', role: 'status' });
      var drop = el('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Subir páginas' },
        el('b', { text: 'Arrastrá las imágenes acá' }), el('span', { text: 'o tocá para elegirlas' }));
      var grid = el('ul', { class: 'pgrid' });
      box.append(drop, input, prog, status, grid);

      var pages = [];
      function renderGrid() {
        V.clear(grid);
        if (!pages.length) { grid.append(el('li', { style: { gridColumn: '1/-1', cursor: 'default', border: 0 } }, el('p', { class: 'muted', text: 'Todavía no hay páginas.' }))); return; }
        pages.forEach(function (p, i) {
          var li = el('li', { draggable: 'true', dataset: { id: p.id } },
            el('img', { src: p.url, alt: 'Página ' + (i + 1), loading: 'lazy' }),
            el('span', { class: 'n', text: String(i + 1) }),
            el('button', { type: 'button', class: 'x', 'aria-label': 'Eliminar página ' + (i + 1), text: '×', onclick: function () {
              V.confirm('Eliminar página', 'Se borra la página ' + (i + 1) + ' del capítulo.', 'Eliminar').then(function (ok) {
                if (ok) A.deletePage(chapter.id, p.id).then(function () { pages.splice(i, 1); renderGrid(); }, function (e) { V.toast(V.errMsg(e)); });
              });
            } }),
            el('div', { class: 'mv' },
              el('button', { type: 'button', 'aria-label': 'Mover antes', disabled: i === 0 ? true : null, text: '←', onclick: function () { move(i, i - 1); } }),
              el('button', { type: 'button', 'aria-label': 'Mover después', disabled: i === pages.length - 1 ? true : null, text: '→', onclick: function () { move(i, i + 1); } })));
          li.addEventListener('dragstart', function (e) { li.classList.add('drag'); e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; });
          li.addEventListener('dragend', function () { li.classList.remove('drag'); V.$$('li.over', grid).forEach(function (x) { x.classList.remove('over'); }); });
          li.addEventListener('dragover', function (e) { e.preventDefault(); li.classList.add('over'); });
          li.addEventListener('dragleave', function () { li.classList.remove('over'); });
          li.addEventListener('drop', function (e) {
            e.preventDefault(); li.classList.remove('over');
            var from = Number(e.dataTransfer.getData('text/plain'));
            if (!isNaN(from) && from !== i) move(from, i);
          });
          grid.append(li);
        });
      }
      var saveT = 0;
      function move(from, to) {
        var item = pages.splice(from, 1)[0];
        pages.splice(to, 0, item);
        renderGrid();
        clearTimeout(saveT);
        saveT = setTimeout(function () {
          A.reorderPages(chapter.id, pages.map(function (p) { return p.id; })).then(function (r) { if (r) pages = r; status.textContent = 'Orden guardado.'; renderGrid(); }, function (e) { status.textContent = V.errMsg(e); });
        }, 500);
      }
      disposers.push(function () { clearTimeout(saveT); });

      function upload(files) {
        files = Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type); });
        if (!files.length) { status.textContent = 'No encontré imágenes en lo que elegiste.'; return; }
        var BATCH = 8, done = 0, failed = [];
        prog.hidden = false; drop.classList.add('over');
        function setProg() { prog.firstChild.style.width = Math.round(done / files.length * 100) + '%'; status.textContent = 'Subiendo ' + done + ' / ' + files.length + '…'; }
        setProg();
        var chain = Promise.resolve();
        for (var i = 0; i < files.length; i += BATCH) {
          (function (batch) {
            chain = chain.then(function () {
              return A.uploadPages(chapter.id, batch).then(function (added) { done += batch.length; setProg(); return added; }, function (e) { failed.push(V.errMsg(e)); done += batch.length; setProg(); });
            });
          })(files.slice(i, i + BATCH));
        }
        chain.then(function () {
          drop.classList.remove('over'); prog.hidden = true;
          status.textContent = failed.length ? 'Algunas no se subieron: ' + failed[0] : 'Listo: páginas subidas.';
          return A.listPages(chapter.id);
        }).then(function (r) { pages = r; renderGrid(); }, function (e) { status.textContent = V.errMsg(e); });
      }
      drop.addEventListener('click', function () { input.click(); });
      drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      input.addEventListener('change', function () { upload(input.files); input.value = ''; });
      ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); drop.classList.add('over'); } }); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); });

      grid.append(V.loadingView());
      A.listPages(chapter.id).then(function (r) { pages = r; renderGrid(); }, function (err) { fail(grid, err); });
    }

    /* ---------- proyectos ---------- */
    function proyectos(box) {
      var list = el('div');
      box.append(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('h2', { class: 'mt', text: 'Proyectos' }),
        el('button', { type: 'button', class: 'btn pri', text: '+ Nuevo proyecto', onclick: function () { projectModal(null, load); } })),
        el('p', { class: 'sub', text: 'Lo que aparece en “Proyectos”. Cada uno crece de semilla a brote y a crecido.' }), list);
      function load() {
        list.replaceChildren(V.loadingView());
        A.listProjects().then(function (rows) {
          list.replaceChildren();
          if (!rows.length) { list.append(V.empty('Todavía no hay proyectos', 'Agregá el primero.')); return; }
          var tb = el('tbody');
          rows.forEach(function (p) {
            tb.append(el('tr', {},
              el('td', {}, el('b', { text: p.name }), el('br'), el('span', { class: 'muted', text: p.url || '' })),
              el('td', { text: p.stage }),
              el('td', {}, badge(p.visible, 'visible', 'oculto')),
              el('td', { class: 'act' }, el('button', { type: 'button', class: 'btn sm', text: 'Editar', onclick: function () { projectModal(p, load); } }))));
          });
          list.append(wrapTable(el('table', { class: 'tbl' }, th(['Proyecto', 'Etapa', 'Estado', '']), tb)));
        }, function (err) { fail(list, err, load); });
      }
      load();
    }

    function projectModal(p, done) {
      V.modal({
        title: p ? 'Editar proyecto' : 'Nuevo proyecto',
        render: function (body, close) {
          var name = el('input', { type: 'text', maxlength: '80', required: true, value: p ? p.name : '' });
          var desc = el('textarea', { rows: '3', maxlength: '400' }); desc.value = p ? p.description || '' : '';
          var stage = el('select', {}, [['semilla', 'Semilla · una idea'], ['brote', 'Brote · en construcción'], ['crecido', 'Crecido · listo']].map(function (s) { return el('option', { value: s[0], text: s[1] }); }));
          stage.value = p ? p.stage : 'semilla';
          var tags = el('input', { type: 'text', maxlength: '200', value: p && p.tags ? p.tags.join(', ') : '', placeholder: 'canvas, juego, herramienta' });
          var url = el('input', { type: 'url', maxlength: '300', value: p ? p.url || '' : '', placeholder: 'https://…' });
          var vis = el('input', { type: 'checkbox' }); vis.checked = p ? !!p.visible : true;
          var pos = el('input', { type: 'number', min: '0', max: '9999', value: String(p ? p.position || 0 : 0) });
          var err = el('p', { class: 'err', role: 'alert' });
          var save = el('button', { type: 'submit', class: 'btn pri', text: 'Guardar' });
          var form = el('form', { class: 'form', novalidate: true },
            field('Nombre', name), field('Descripción', desc),
            el('div', { class: 'two' }, field('Etapa', stage), field('Orden', pos)),
            field('Etiquetas', tags, 'Separadas por coma.'), field('Enlace', url),
            el('label', { class: 'field inline' }, vis, el('span', { text: 'Visible en el sitio' })),
            err, el('div', { class: 'form-actions' },
              p ? V.armedButton('Eliminar', '¿Seguro?', function () {
                A.deleteProject(p.id).then(function () { close(); V.toast('Proyecto eliminado.'); done(); }, function (e) { err.textContent = V.errMsg(e); });
              }, 'danger') : null, save));
          form.addEventListener('submit', function (e) {
            e.preventDefault(); err.textContent = '';
            if (!name.value.trim()) { err.textContent = 'Falta el nombre.'; return; }
            save.disabled = true;
            A.saveProject({ id: p && p.id, name: name.value.trim(), description: desc.value.trim(), stage: stage.value,
              tags: tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean), url: url.value.trim(), visible: vis.checked, position: Number(pos.value) || 0 })
              .then(function () { close(); V.toast('Proyecto guardado.'); done(); }, function (er) { err.textContent = V.errMsg(er); save.disabled = false; });
          });
          body.append(form);
        },
      });
    }

    /* ---------- sitio ---------- */
    function sitio(box) {
      box.append(el('h2', { class: 'mt', text: 'Sitio' }), el('p', { class: 'sub', text: 'El nombre, el texto de bienvenida y las tres influencias de “Notas”.' }));
      var holder = el('div');
      box.append(holder);
      holder.append(V.loadingView());
      A.getSite().then(function (site) {
        V.clear(holder);
        var name = el('input', { type: 'text', maxlength: '40', value: site.name || '' });
        var intro = el('textarea', { rows: '4', maxlength: '600' }); intro.value = site.intro || '';
        var gate = el('input', { type: 'checkbox' }); gate.checked = !!site.readRequiresLogin;
        var infl = (site.influences || []).slice(0, 8);
        var inflBox = el('div', { class: 'form' });
        function renderInfl() {
          V.clear(inflBox);
          infl.forEach(function (x, i) {
            var k = el('input', { type: 'text', maxlength: '2', value: x.kanji || '', 'aria-label': 'Kanji', style: { width: '64px', textAlign: 'center' } });
            var t = el('input', { type: 'text', maxlength: '60', value: x.title || '', 'aria-label': 'Título' });
            var d = el('input', { type: 'text', maxlength: '200', value: x.text || '', 'aria-label': 'Texto' });
            k.addEventListener('input', function () { x.kanji = k.value; });
            t.addEventListener('input', function () { x.title = t.value; });
            d.addEventListener('input', function () { x.text = d.value; });
            inflBox.append(el('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, k, el('div', { class: 'grow1', style: { display: 'grid', gap: '6px' } }, t, d),
              el('button', { type: 'button', class: 'ib', 'aria-label': 'Quitar', text: '×', onclick: function () { infl.splice(i, 1); renderInfl(); } })));
          });
          if (infl.length < 8) inflBox.append(el('div', {}, el('button', { type: 'button', class: 'btn sm', text: '+ Agregar influencia', onclick: function () { infl.push({ kanji: '', title: '', text: '' }); renderInfl(); } })));
        }
        renderInfl();
        var err = el('p', { class: 'err', role: 'alert' });
        var save = el('button', { type: 'submit', class: 'btn pri', text: 'Guardar cambios' });
        var form = el('form', { class: 'form', novalidate: true },
          field('Nombre del sitio', name), field('Texto de bienvenida', intro),
          features.accounts === false ? null : el('label', { class: 'field inline' }, gate, el('span', { text: 'Pedir cuenta para leer' }), ),
          features.accounts === false ? null : el('small', { class: 'muted', text: 'Si lo activás, quien no tenga cuenta no puede leer los mangas. Útil para limitar el alcance de las traducciones.' }),
          el('h3', { class: 'mt2', text: 'Influencias' }), inflBox, err, el('div', { class: 'form-actions' }, save));
        form.addEventListener('submit', function (e) {
          e.preventDefault(); err.textContent = ''; save.disabled = true;
          var patch = { name: name.value.trim(), intro: intro.value.trim(), influences: infl.filter(function (x) { return (x.title || '').trim(); }).map(function (x) { return { kanji: (x.kanji || '').trim(), title: x.title.trim(), text: (x.text || '').trim() }; }) };
          if (features.accounts !== false) patch.readRequiresLogin = gate.checked;
          A.saveSite(patch).then(function () { V.toast('Sitio guardado. Recargá la página pública para verlo.'); }, function (er) { err.textContent = V.errMsg(er); }).then(function () { save.disabled = false; });
        });
        holder.append(form);
      }, function (err) { fail(holder, err); });
    }

    /* ---------- visitas ---------- */
    function visitas(box) {
      box.append(el('h2', { class: 'mt', text: 'Libro de visitas' }), el('p', { class: 'sub', text: 'Ocultá lo que no quieras mostrar o borralo del todo.' }));
      var list = el('div');
      box.append(list);
      function load() {
        list.replaceChildren(V.loadingView());
        A.listGuestbook().then(function (rows) {
          list.replaceChildren();
          if (!rows.length) { list.append(V.empty('Nadie dejó huellas todavía')); return; }
          var tb = el('tbody');
          rows.forEach(function (g) {
            tb.append(el('tr', {},
              el('td', { text: g.author }), el('td', { text: g.body, style: { overflowWrap: 'anywhere', maxWidth: '360px' } }),
              el('td', { text: V.fmtDate(g.createdAt) }), el('td', {}, badge(!g.hidden, 'visible', 'oculta')),
              el('td', { class: 'act' },
                el('button', { type: 'button', class: 'btn sm', text: g.hidden ? 'Mostrar' : 'Ocultar', onclick: function () { A.setGuestbookHidden(g.id, !g.hidden).then(load, function (e) { V.toast(V.errMsg(e)); }); } }), ' ',
                V.armedButton('Borrar', '¿Seguro?', function () { A.deleteGuestbook(g.id).then(load, function (e) { V.toast(V.errMsg(e)); }); }, 'sm danger'))));
          });
          list.append(wrapTable(el('table', { class: 'tbl' }, th(['Quién', 'Mensaje', 'Cuándo', 'Estado', '']), tb)));
        }, function (err) { fail(list, err, load); });
      }
      load();
    }

    /* ---------- personas y grupos ---------- */
    function personas(box) {
      box.append(el('h2', { class: 'mt', text: 'Personas' }));
      var users = el('div'); var groups = el('div');
      box.append(users, el('h3', { class: 'mt2', text: 'Grupos de lectura' }), groups);
      function loadUsers() {
        users.replaceChildren(V.loadingView());
        A.listUsers().then(function (rows) {
          users.replaceChildren();
          if (!rows.length) { users.append(V.empty('Todavía no hay cuentas')); return; }
          var tb = el('tbody');
          rows.forEach(function (u) {
            var role = el('select', { 'aria-label': 'Rol de ' + u.username, style: { width: 'auto' } }, [['user', 'Lectora/or'], ['admin', 'Administración']].map(function (r) { return el('option', { value: r[0], text: r[1] }); }));
            role.value = u.role;
            role.addEventListener('change', function () {
              A.saveUser(u.id, { role: role.value, disabled: u.disabled }).then(function () { V.toast('Rol actualizado.'); loadUsers(); }, function (e) { V.toast(V.errMsg(e)); role.value = u.role; });
            });
            tb.append(el('tr', {},
              el('td', {}, el('b', { text: u.name || u.username }), el('br'), el('span', { class: 'muted', text: '@' + u.username })),
              el('td', {}, role), el('td', { text: V.fmtDate(u.createdAt) }), el('td', {}, badge(!u.disabled, 'activa', 'suspendida')),
              el('td', { class: 'act' }, el('button', { type: 'button', class: 'btn sm', text: u.disabled ? 'Reactivar' : 'Suspender', onclick: function () {
                A.saveUser(u.id, { role: u.role, disabled: !u.disabled }).then(function () { loadUsers(); }, function (e) { V.toast(V.errMsg(e)); });
              } }))));
          });
          users.append(wrapTable(el('table', { class: 'tbl' }, th(['Cuenta', 'Rol', 'Desde', 'Estado', '']), tb)));
        }, function (err) { fail(users, err, loadUsers); });
      }
      function loadGroups() {
        groups.replaceChildren(V.loadingView());
        A.listGroups().then(function (rows) {
          groups.replaceChildren();
          if (!rows.length) { groups.append(V.empty('No hay grupos')); return; }
          var tb = el('tbody');
          rows.forEach(function (g) {
            tb.append(el('tr', {}, el('td', { text: g.name }), el('td', { text: g.ownerName }), el('td', { text: String(g.memberCount) }), el('td', { text: g.visibility === 'public' ? 'abierto' : 'privado' }),
              el('td', { class: 'act' }, V.armedButton('Eliminar', '¿Seguro?', function () { A.deleteGroup(g.id).then(loadGroups, function (e) { V.toast(V.errMsg(e)); }); }, 'sm danger'))));
          });
          groups.append(wrapTable(el('table', { class: 'tbl' }, th(['Grupo', 'Creado por', 'Personas', 'Acceso', '']), tb)));
        }, function (err) { fail(groups, err, loadGroups); });
      }
      loadUsers(); loadGroups();
    }

    open('resumen');
    return { open: open, destroy: function () { disposers.forEach(function (f) { f(); }); V.clear(root); } };
  };
})(window.Valle = window.Valle || {});
