(function (V) {
  'use strict';
  var el = V.el;

  V.registerModule({
    id: 'inicio', kanji: '谷', label: 'Inicio', order: 10,
    render: function (root, ctx) {
      var site = ctx.site || {};
      var alive = true;
      root.append(
        el('span', { class: 'wm', lang: 'ja', 'aria-hidden': 'true', text: '谷' }),
        el('p', { class: 'eyebrow', text: 'Bienvenida' }),
        el('h1', { class: 'big', text: site.name || 'Valle Interior' }),
        el('p', { class: 'lead', text: site.intro || '' }));

      var paths = [
        ['leer', '読', 'Leer', 'Mangas traducidos al español'],
        ['dibujar', '描', 'Dibujar', 'Un lienzo libre, solo o con gente'],
        ['proyectos', '作', 'Proyectos', 'Lo que está creciendo'],
        ['salas', '集', 'Salas', 'Leer o dibujar en compañía'],
      ];
      root.append(el('ul', { class: 'paths' }, paths.map(function (p) {
        return el('li', {}, el('button', { type: 'button', onclick: function () { ctx.go(p[0]); } },
          el('span', { class: 'kj', lang: 'ja', 'aria-hidden': 'true', text: p[1] }),
          el('span', {}, el('b', { text: p[2] }), el('em', { text: p[3] })),
          el('span', { class: 'arr', 'aria-hidden': 'true', text: '→' })));
      })));

      var latestBox = el('div');
      root.append(latestBox);
      ctx.api.latestChapters().then(function (list) {
        if (!alive || !list.length) return;
        latestBox.append(el('h2', { class: 'mt2', text: 'Últimos capítulos' }));
        latestBox.append(el('ul', { class: 'latest' }, list.map(function (c) {
          return el('li', {}, el('button', { type: 'button', onclick: function () { ctx.go('leer', { arg: c.id }); } },
            V.cover({ id: c.seriesId, coverUrl: c.coverUrl }),
            el('span', { class: 'sm' },
              el('b', { text: c.seriesTitle }),
              el('em', { text: V.chapterLabel(c) + (c.createdAt ? ' · ' + V.fmtDate(c.createdAt) : '') }))));
        })));
      }, function () { /* la portada funciona sin esto */ });

      root.append(el('p', { class: 'hint', text: 'Elegí un camino en el selector, o tocá uno de arriba.' }));
      return function () { alive = false; };
    },
  });
})(window.Valle = window.Valle || {});
