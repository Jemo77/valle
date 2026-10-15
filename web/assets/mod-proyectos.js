(function (V) {
  'use strict';
  var el = V.el;
  var STAGES = [
    ['semilla', 'Semilla', 'una idea'],
    ['brote', 'Brote', 'en construcción'],
    ['crecido', 'Crecido', 'listo para usar'],
  ];

  function safeUrl(u) {
    try { var x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (e) { return null; }
  }

  V.registerModule({
    id: 'proyectos', kanji: '作', label: 'Proyectos', order: 40,
    render: function (root, ctx) {
      var alive = true;
      var list = el('ul', { class: 'plist' });
      root.append(
        el('p', { class: 'eyebrow', text: 'Jardín de proyectos' }),
        el('h2', { class: 'mt', text: 'Lo que está creciendo' }),
        el('p', { class: 'sub', text: 'Cosas que armo en la web. Algunas recién son una semilla.' }),
        el('div', { class: 'legend' }, STAGES.map(function (s) { return el('span', { class: 'chip', text: s[1] + ' · ' + s[2] }); })),
        list);
      function load() {
        V.clear(list); list.append(el('li', {}, V.loadingView()));
        ctx.api.listProjects().then(function (ps) {
          if (!alive) return;
          V.clear(list);
          if (!ps.length) { list.append(el('li', {}, V.empty('Todavía no hay proyectos', 'Cuando se agregue el primero aparece acá.'))); return; }
          ps.forEach(function (p) {
            var url = p.url ? safeUrl(p.url) : null;
            var stage = STAGES.filter(function (s) { return s[0] === p.stage; })[0] || STAGES[0];
            var icon = el('span', { class: 'stg', 'aria-hidden': 'true' });
            icon.innerHTML = V.stageIcon(stage[0]);
            list.append(el('li', { class: 'proj' },
              icon,
              el('div', {}, el('h3', { text: p.name }), p.description ? el('p', { text: p.description }) : null,
                (p.tags && p.tags.length) ? el('div', { class: 'tags' }, p.tags.map(function (t) { return el('span', { class: 'chip', text: t }); })) : null),
              el('div', { class: 'pa' },
                el('span', { class: 'chip', text: stage[1] }),
                url ? el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir ↗', style: { textDecoration: 'none' } }) : null)));
          });
        }, function (err) { if (alive) { V.clear(list); list.append(el('li', {}, V.errorView(err, load))); } });
      }
      load();
      return function () { alive = false; };
    },
  });
})(window.Valle = window.Valle || {});
