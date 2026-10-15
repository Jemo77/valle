/* Página /admin/: inicio de sesión + panel de administración. */
(function (V) {
  'use strict';
  var el = V.el;
  var root = V.$('#root');
  var api = V.api;

  function frame(title, content) {
    V.clear(root);
    root.append(el('section', { class: 'panel', style: { position: 'relative', zIndex: 10 } },
      el('div', { class: 'ph' }, el('span', { text: title }), el('span', { class: 'st' }, el('a', { href: '/', text: '← Volver al valle' }))),
      el('div', { class: 'pb' }, content)));
  }

  function loginView(note) {
    var user = el('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    var pass = el('input', { type: 'password', autocomplete: 'current-password', required: true });
    var err = el('p', { class: 'err', role: 'alert', text: note || '' });
    var go = el('button', { type: 'submit', class: 'btn pri', text: 'Entrar' });
    var form = el('form', { class: 'form login-box' },
      el('h1', { class: 'mt', text: 'Administración' }),
      el('p', { class: 'sub', text: 'Solo para quien cuida el valle.' }),
      el('label', { class: 'field' }, el('span', { text: 'Usuario' }), user),
      el('label', { class: 'field' }, el('span', { text: 'Contraseña' }), pass),
      err, el('div', { class: 'form-actions' }, go));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = ''; go.disabled = true;
      api.login(user.value.trim(), pass.value).then(check, function (er) { err.textContent = V.errMsg(er); go.disabled = false; });
    });
    frame('Acceso', form);
    user.focus();
  }

  function check() {
    api.init().then(function (info) {
      if (!info.user) return loginView();
      if (!info.canAdmin) return loginView('Esta cuenta no tiene permisos de administración.');
      var holder = el('div');
      var out = el('button', { type: 'button', class: 'btn sm', text: 'Salir', onclick: function () { api.logout().then(function () { loginView(); }); } });
      frame('Administración · ' + (info.user.name || info.user.username), el('div', {}, el('div', { class: 'row', style: { justifyContent: 'flex-end', marginBottom: '10px' } }, out), holder));
      V.mountAdmin(holder, api);
    }, function (err) { frame('Sin señal', V.empty('No se pudo conectar', V.errMsg(err), el('button', { type: 'button', class: 'btn', text: 'Reintentar', onclick: check }))); });
  }
  check();
})(window.Valle = window.Valle || {});
