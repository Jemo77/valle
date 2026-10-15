/* Estructura de la cabina: pestañas desde el registro de módulos, cuenta, reloj, contador de gente. */
(function (V) {
  'use strict';
  var el = V.el;
  var api = V.api;

  var panel, pb, selector, phl, phst;
  var current = { id: null, cleanup: null };
  var authWaiters = [];
  var ctx = {
    api: api,
    user: null,
    canAdmin: false,
    site: null,
    params: {},
    go: go,
    setStatus: function (t) { if (phst) phst.textContent = t || 'abierto'; },
    requireLogin: requireLogin,
  };
  V.ctx = ctx;

  /* ---------- navegación ---------- */
  function visibleModules() {
    return V.modules.filter(function (m) { return !m.visible || m.visible(ctx); });
  }

  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('/');
    return { id: parts[0] || 'inicio', arg: parts[1] || null };
  }

  function go(id, params) {
    params = params || {};
    var h = '#' + id + (params.arg != null ? '/' + params.arg : '');
    ctx.params = params;
    if (location.hash === h) show(id, params); else {
      pendingParams = params;
      location.hash = h;
    }
  }
  var pendingParams = null;

  function buildTabs() {
    var mods = visibleModules();
    V.$$('.tab', selector).forEach(function (t) { t.remove(); });
    mods.forEach(function (m, i) {
      var b = el('button', {
        type: 'button', class: 'tab', role: 'tab', id: 'tab-' + m.id, 'aria-controls': 'panel',
        'aria-selected': m.id === current.id ? 'true' : 'false', tabindex: m.id === current.id ? '0' : '-1', dataset: { mod: m.id },
      },
        el('span', { class: 'kj', lang: 'ja', 'aria-hidden': 'true', text: m.kanji }),
        el('span', { class: 'tx' }, el('b', { text: m.label }), el('i', { text: String(i + 1).padStart(2, '0') })));
      b.addEventListener('click', function () { go(m.id); });
      selector.append(b);
    });
  }

  function show(id, params) {
    var mods = visibleModules();
    var mod = mods.filter(function (m) { return m.id === id; })[0] || mods[0];
    if (!mod) return;
    if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } current.cleanup = null; }
    current.id = mod.id;
    ctx.params = params || {};
    ctx.setStatus('abierto');
    var idx = mods.indexOf(mod);
    phl.textContent = 'Módulo ' + String(idx + 1).padStart(2, '0') + ' · ' + mod.label;
    panel.dataset.mod = mod.id;
    panel.setAttribute('aria-labelledby', 'tab-' + mod.id);
    V.$$('.tab', selector).forEach(function (t) {
      var on = t.dataset.mod === mod.id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    V.clear(pb);
    var root = el('div', { class: 'mod m-' + mod.id, dataset: { mod: mod.id } });
    pb.append(root);
    pb.scrollTop = 0;
    try {
      var cleanup = mod.render(root, ctx);
      if (typeof cleanup === 'function') current.cleanup = cleanup;
    } catch (e) {
      console.error(e);
      root.append(V.errorView(e));
    }
    document.title = (mod.id === 'inicio' ? '' : mod.label + ' · ') + ((ctx.site && ctx.site.name) || 'Valle Interior');
  }

  function onHash() {
    var h = parseHash();
    var params = pendingParams || { arg: h.arg };
    pendingParams = null;
    if (h.arg != null && params.arg == null) params.arg = h.arg;
    show(h.id, params);
  }

  /* ---------- cuenta ---------- */
  var acctSlot;
  function renderAccount() {
    V.clear(acctSlot);
    if (!api.features.accounts) return;
    if (ctx.user) {
      acctSlot.append(el('button', { type: 'button', class: 'acct', 'aria-haspopup': 'dialog', onclick: accountModal },
        el('span', { text: ctx.user.name || ctx.user.username })));
    } else {
      acctSlot.append(el('button', { type: 'button', class: 'acct', onclick: function () { authModal().catch(function () {}); }, text: 'Entrar' }));
    }
  }

  function afterAuth() {
    ctx.user = api.user;
    ctx.canAdmin = !!api.user && api.user.role === 'admin';
    renderAccount();
    buildTabs();
    show(current.id || 'inicio', ctx.params);
    var w = authWaiters; authWaiters = [];
    w.forEach(function (f) { f(true); });
  }

  function requireLogin() {
    if (ctx.user || !api.features.accounts) return Promise.resolve(ctx.user);
    return authModal();
  }

  function authModal() {
    return new Promise(function (resolve, reject) {
      var done = false;
      V.modal({
        title: 'Entrar al valle',
        onClose: function () { if (!done) reject(new Error('cancelado')); },
        render: function (body, close) {
          var mode = 'login';
          var tabs = el('div', { class: 'tabs2', role: 'tablist' });
          var form = el('form', { class: 'form', novalidate: true });
          var tl = el('button', { type: 'button', role: 'tab', text: 'Tengo cuenta' });
          var tr = el('button', { type: 'button', role: 'tab', text: 'Crear cuenta' });
          if (api.features.registration !== false) tabs.append(tl, tr); else tabs.append(tl);
          body.append(tabs, form);
          var errEl = el('p', { class: 'err', role: 'alert' });
          var user = el('input', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '24', required: true });
          var pass = el('input', { type: 'password', name: 'password', required: true, maxlength: '200' });
          var disp = el('input', { type: 'text', name: 'displayName', autocomplete: 'nickname', maxlength: '32' });
          var submit = el('button', { type: 'submit', class: 'btn pri' });
          var dispField = el('label', { class: 'field' }, el('span', { text: 'Cómo te vemos' }), disp, el('small', { text: 'Es el nombre que se ve en chats y grupos. Podés dejarlo vacío.' }));
          var passHint = el('small', { text: '' });
          form.append(
            el('label', { class: 'field' }, el('span', { text: 'Usuario' }), user),
            el('label', { class: 'field' }, el('span', { text: 'Contraseña' }), pass, passHint),
            dispField, errEl,
            el('div', { class: 'form-actions' }, submit));
          function setMode(m) {
            mode = m;
            tl.setAttribute('aria-selected', m === 'login' ? 'true' : 'false');
            tr.setAttribute('aria-selected', m === 'register' ? 'true' : 'false');
            dispField.hidden = m === 'login';
            submit.textContent = m === 'login' ? 'Entrar' : 'Crear cuenta';
            pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
            passHint.textContent = m === 'login' ? '' : 'Mínimo 8 caracteres.';
            errEl.textContent = '';
          }
          tl.addEventListener('click', function () { setMode('login'); });
          tr.addEventListener('click', function () { setMode('register'); });
          setMode('login');
          form.addEventListener('submit', function (e) {
            e.preventDefault();
            errEl.textContent = '';
            if (!user.value.trim() || !pass.value) { errEl.textContent = 'Completá usuario y contraseña.'; return; }
            submit.disabled = true;
            var p = mode === 'login'
              ? api.login(user.value.trim(), pass.value)
              : api.register(user.value.trim(), pass.value, disp.value.trim() || undefined);
            p.then(function () {
              done = true; close(); afterAuth(); V.toast(mode === 'login' ? 'Bienvenida/o de vuelta.' : 'Cuenta creada. Bienvenida/o.'); resolve(api.user);
            }, function (err) { errEl.textContent = V.errMsg(err); submit.disabled = false; });
          });
          setTimeout(function () { user.focus(); }, 0);
        },
      });
    });
  }

  function accountModal() {
    V.modal({
      title: 'Tu cuenta',
      render: function (body, close) {
        body.append(
          el('p', { class: 'lead', text: ctx.user.name || ctx.user.username }),
          el('p', { class: 'sub', text: '@' + ctx.user.username + (ctx.canAdmin ? ' · administración' : '') }),
          el('div', { class: 'form-actions' },
            ctx.canAdmin && api.mode === 'rest' ? el('a', { class: 'btn pri', href: '/admin/', text: 'Abrir administración', style: { textDecoration: 'none' } }) : null,
            el('button', { type: 'button', class: 'btn', text: 'Salir', onclick: function () {
              api.logout().then(function () { close(); afterAuth(); V.toast('Sesión cerrada.'); }, function (e) { V.toast(V.errMsg(e)); });
            } })));
      },
    });
  }

  /* ---------- arranque ---------- */
  function boot() {
    panel = V.$('#panel'); pb = V.$('#pb'); selector = V.$('#selector');
    phl = V.$('#ph-l'); phst = V.$('#ph-st'); acctSlot = V.$('#acct-slot');

    function tick() { var c = V.$('#clock'); if (c) c.textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    tick(); setInterval(tick, 20000);

    selector.addEventListener('keydown', function (e) {
      var tabs = V.$$('.tab', selector);
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var nx = -1;
      var vertical = window.matchMedia('(min-width:821px)').matches;
      if (e.key === (vertical ? 'ArrowDown' : 'ArrowRight')) nx = (i + 1) % tabs.length;
      else if (e.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) nx = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nx = 0;
      else if (e.key === 'End') nx = tabs.length - 1;
      if (nx < 0) return;
      e.preventDefault();
      tabs[nx].focus();
      go(tabs[nx].dataset.mod);
    });

    api.init().then(function (info) {
      ctx.user = info.user; ctx.canAdmin = !!info.canAdmin; ctx.site = info.site;
      var name = (info.site && info.site.name) || 'Valle Interior';
      V.$('#site-name').textContent = name;
      renderAccount();
      buildTabs();
      api.onOnline(function (n) { var p = V.$('#pop'); if (p) p.textContent = String(Math.max(1, n)); });
      window.addEventListener('hashchange', onHash);
      onHash();
    }, function (err) {
      V.clear(pb);
      pb.append(V.errorView(err, function () { location.reload(); }));
      phl.textContent = 'Sin señal';
    });
  }

  V.bootApp = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.Valle = window.Valle || {});
