(function (V) {
  'use strict';
  var el = V.el;

  V.registerModule({
    id: 'notas', kanji: '想', label: 'Notas', order: 60,
    render: function (root, ctx) {
      var alive = true;
      var site = ctx.site || {};
      var infl = site.influences || [];
      root.append(
        el('p', { class: 'eyebrow', text: 'Notas' }),
        el('h2', { class: 'mt', text: 'De dónde viene esto' }),
        el('p', { class: 'sub', text: 'Tres cosas que me acompañan y que le dieron forma al valle.' }));
      if (infl.length) {
        root.append(el('ul', { class: 'infl' }, infl.map(function (i) {
          return el('li', {}, el('span', { class: 'kj', lang: 'ja', 'aria-hidden': 'true', text: i.kanji || '·' }),
            el('div', {}, el('b', { text: i.title }), el('span', { text: i.text })));
        })));
      }

      root.append(el('h2', { class: 'mt2', text: 'Libro de visitas' }),
        el('p', { class: 'sub', text: 'Dejá una huella. Se ve acá, sin más.' }));

      var gt = el('textarea', { id: 'g-text', maxlength: '280', rows: '3', 'aria-label': 'Tu mensaje', placeholder: 'Algo breve, amable.' });
      var count = el('span', { text: '0 / 280' });
      var nameIn = el('input', { type: 'text', maxlength: '24', placeholder: 'tu nombre (opcional)', 'aria-label': 'Tu nombre' });
      var hp = el('input', { type: 'text', name: 'website', class: 'hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
      var send = el('button', { type: 'submit', class: 'btn pri', text: 'Dejar huella' });
      var msg = el('p', { class: 'err', role: 'alert' });
      var form = el('form', { class: 'gform' },
        gt, hp,
        el('div', { class: 'grow' }, ctx.user ? el('span', { text: 'como ' + (ctx.user.name || ctx.user.username) }) : nameIn, count),
        msg, el('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, send));
      root.append(form);
      gt.addEventListener('input', function () { count.textContent = gt.value.length + ' / 280'; });

      var prints = el('ul', { class: 'prints' });
      root.append(prints);

      function entry(g) {
        var icon = el('span', { 'aria-hidden': 'true' });
        icon.innerHTML = V.sproutIcon;
        return el('li', {}, icon, el('div', {}, el('p', { text: g.body }), el('small', { text: g.author + ' · ' + V.fmtDate(g.createdAt) })));
      }
      function load() {
        ctx.api.listGuestbook().then(function (list) {
          if (!alive) return;
          V.clear(prints);
          if (!list.length) prints.append(el('li', {}, el('span'), el('div', {}, el('p', { class: 'muted', text: 'Todavía no hay huellas. Podés ser la primera.' }))));
          list.forEach(function (g) { prints.append(entry(g)); });
        }, function () { /* sin libro de visitas, el resto funciona */ });
      }
      load();

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        msg.textContent = '';
        var body = gt.value.trim();
        if (!body) { msg.textContent = 'Escribí algo primero.'; return; }
        if (hp.value) return;
        send.disabled = true;
        ctx.api.addGuestbook(body, nameIn.value.trim() || undefined).then(function () {
          gt.value = ''; count.textContent = '0 / 280';
          V.toast('Huella dejada.');
          load();
        }, function (err) { msg.textContent = V.errMsg(err); }).then(function () { send.disabled = false; });
      });
      return function () { alive = false; };
    },
  });
})(window.Valle = window.Valle || {});
