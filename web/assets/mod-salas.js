/* Salas: grupos de lectura sincronizada y lienzo compartido. */
(function (V) {
  'use strict';
  var el = V.el;

  V.registerModule({
    id: 'salas', kanji: '集', label: 'Salas', order: 50,
    render: function (root, ctx) {
      var api = ctx.api;
      var tab = ctx.params && ctx.params.arg === 'dibujo' ? 'dibujo' : 'lectura';
      var body = el('div');
      var cleanup = null;
      var alive = true;

      var tLec = el('button', { type: 'button', role: 'tab', text: 'Lectura en grupo' });
      var tDib = el('button', { type: 'button', role: 'tab', text: 'Lienzo compartido' });
      var tabs = el('div', { class: 'sala-tabs', role: 'tablist' }, tLec, tDib);
      root.append(el('p', { class: 'eyebrow', text: 'Sala compartida' }), el('h2', { class: 'mt', text: 'Juntas y juntos' }), tabs, body);

      function setTab(t) {
        tab = t;
        if (cleanup) { cleanup(); cleanup = null; }
        V.clear(body);
        tLec.setAttribute('aria-selected', t === 'lectura' ? 'true' : 'false');
        tDib.setAttribute('aria-selected', t === 'dibujo' ? 'true' : 'false');
        if (!ctx.user && api.features.accounts) {
          body.append(V.empty('Entrá para compartir sala', 'Las salas necesitan una cuenta, así sabemos quién lee y dibuja con vos.',
            el('button', { type: 'button', class: 'btn pri', text: 'Entrar o crear cuenta', onclick: function () {
              ctx.requireLogin().then(function () { /* afterAuth vuelve a dibujar el módulo */ }, function () {});
            } })));
          return;
        }
        cleanup = (t === 'lectura' ? groupsView : drawView)(body, ctx, function () { return alive; });
      }
      tLec.addEventListener('click', function () { setTab('lectura'); });
      tDib.addEventListener('click', function () { setTab('dibujo'); });
      setTab(tab);
      return function () { alive = false; if (cleanup) cleanup(); };
    },
  });

  /* ---------------- lienzo compartido ---------------- */

  function drawView(box, ctx, isAlive) {
    var api = ctx.api;
    var tool = null;
    var holder = el('div');
    var list = el('div');
    box.append(el('p', { class: 'sub', text: 'Un lienzo para todas las personas que entren. Lo que dibujes lo ven al instante, y queda ahí hasta que alguien lo limpie.' }), list, holder);
    if (!api.features.sharedDraw) {
      list.append(V.empty('No disponible acá', 'El lienzo compartido en tiempo real necesita el servidor propio.'));
      return null;
    }
    function open(room) {
      if (tool) tool.destroy();
      V.clear(holder);
      tool = V.createCanvasTool({ container: holder, channel: api.openDraw(room.id) });
    }
    api.listDrawRooms().then(function (rooms) {
      if (!isAlive()) return;
      if (!rooms.length) { list.append(V.empty('No hay lienzos abiertos')); return; }
      if (rooms.length > 1) {
        list.append(el('div', { class: 'sala-tabs' }, rooms.map(function (r) {
          return el('button', { type: 'button', text: r.name + (r.online ? ' · ' + r.online : ''), onclick: function () { open(r); } });
        })));
      }
      open(rooms[0]);
    }, function (err) { if (isAlive()) list.append(V.errorView(err)); });
    return function () { if (tool) tool.destroy(); };
  }

  /* ---------------- grupos de lectura ---------------- */

  function groupsView(box, ctx, isAlive) {
    var api = ctx.api;
    var inner = null;
    var arg = ctx.params && ctx.params.arg && ctx.params.arg !== 'dibujo' ? String(ctx.params.arg) : null;

    function showList() {
      if (inner) { inner(); inner = null; }
      V.clear(box);
      history.replaceState(null, '', '#salas');
      inner = listView(box, ctx, isAlive, function (g) { showGroup(g.id); });
    }
    function showGroup(id) {
      if (inner) { inner(); inner = null; }
      V.clear(box);
      history.replaceState(null, '', '#salas/' + id);
      inner = groupView(box, ctx, id, isAlive, showList);
    }
    if (arg) showGroup(arg); else showList();
    return function () { if (inner) inner(); };
  }

  function groupBadges(g) {
    return el('div', { class: 'meta' },
      el('span', { class: 'chip', text: g.visibility === 'public' ? 'abierto' : 'por invitación' }),
      el('span', { class: 'chip', text: g.control === 'guide' ? 'guía quien lo creó' : 'todas guían' }),
      el('span', { class: 'chip', text: g.memberCount + (g.memberCount === 1 ? ' persona' : ' personas') }));
  }

  function listView(box, ctx, isAlive, onOpen) {
    var api = ctx.api;
    var mine = el('ul', { class: 'glist' });
    var open = el('ul', { class: 'glist' });
    var codeIn = el('input', { type: 'text', maxlength: '16', placeholder: 'Código de invitación', 'aria-label': 'Código de invitación', autocomplete: 'off', autocapitalize: 'characters' });
    var codeErr = el('p', { class: 'err', role: 'alert' });
    var joinForm = el('form', { class: 'row', style: { maxWidth: '420px' } }, el('div', { class: 'grow1' }, codeIn), el('button', { type: 'submit', class: 'btn', text: 'Unirme' }));
    joinForm.addEventListener('submit', function (e) {
      e.preventDefault(); codeErr.textContent = '';
      var code = codeIn.value.trim();
      if (!code) return;
      api.joinGroup({ code: code }).then(function (g) { onOpen(g); }, function (err) { codeErr.textContent = V.errMsg(err); });
    });
    box.append(
      el('p', { class: 'sub', text: 'Leé el mismo capítulo a la vez: quien guía pasa las páginas y todos las ven al mismo tiempo, con un chat al costado.' }),
      el('div', { class: 'row', style: { marginBottom: '16px' } },
        el('button', { type: 'button', class: 'btn pri', text: '+ Crear grupo', onclick: function () { createModal(ctx, onOpen); } })),
      el('h3', { class: 'mt2', style: { marginTop: '8px' }, text: 'Tus grupos' }), mine,
      el('h3', { class: 'mt2', text: 'Grupos abiertos' }), open,
      el('h3', { class: 'mt2', text: 'Tengo un código' }), joinForm, codeErr);

    function card(g, isMine) {
      var act = isMine
        ? el('button', { type: 'button', class: 'btn pri', text: 'Entrar', onclick: function () { onOpen(g); } })
        : el('button', { type: 'button', class: 'btn', text: 'Unirme', onclick: function () {
          api.joinGroup({ id: g.id }).then(function (x) { onOpen(x); }, function (err) { V.toast(V.errMsg(err)); });
        } });
      return el('li', { class: 'gcard' },
        el('div', {},
          el('h3', { text: g.name }),
          el('p', { text: [g.seriesTitle, g.chapterNumber != null ? 'va por el cap. ' + V.fmtNumber(g.chapterNumber) : null, 'de ' + g.ownerName].filter(Boolean).join(' · ') }),
          groupBadges(g)),
        el('div', { class: 'pa' }, act));
    }
    function load() {
      mine.replaceChildren(el('li', {}, V.loadingView()));
      open.replaceChildren();
      api.listGroups().then(function (r) {
        if (!isAlive()) return;
        mine.replaceChildren();
        if (!r.mine.length) mine.append(el('li', {}, V.empty('Todavía no estás en ningún grupo', 'Creá uno o unite a uno abierto.')));
        r.mine.forEach(function (g) { mine.append(card(g, true)); });
        if (!r.open.length) open.append(el('li', {}, el('p', { class: 'muted', text: 'No hay otros grupos abiertos ahora.' })));
        r.open.forEach(function (g) { open.append(card(g, false)); });
      }, function (err) { if (isAlive()) { mine.replaceChildren(V.errorView(err, load)); } });
    }
    load();
    return function () {};
  }

  function createModal(ctx, onOpen) {
    var api = ctx.api;
    V.modal({
      title: 'Crear grupo de lectura',
      render: function (body, close) {
        var name = el('input', { type: 'text', maxlength: '60', required: true, placeholder: 'Ej: Domingos de manga' });
        var desc = el('textarea', { maxlength: '240', rows: '2', placeholder: 'Opcional' });
        var series = el('select', {}, el('option', { value: '', text: 'Cargando series…' }));
        var vis = el('select', {}, el('option', { value: 'private', text: 'Por invitación (con código)' }), el('option', { value: 'public', text: 'Abierto: cualquiera puede unirse' }));
        var ctl = el('select', {}, el('option', { value: 'guide', text: 'Solo yo paso las páginas' }), el('option', { value: 'everyone', text: 'Cualquiera del grupo puede pasar' }));
        var err = el('p', { class: 'err', role: 'alert' });
        var go = el('button', { type: 'submit', class: 'btn pri', text: 'Crear' });
        var form = el('form', { class: 'form' },
          el('label', { class: 'field' }, el('span', { text: 'Nombre' }), name),
          el('label', { class: 'field' }, el('span', { text: 'Descripción' }), desc),
          el('label', { class: 'field' }, el('span', { text: 'Qué van a leer' }), series),
          el('div', { class: 'two' },
            el('label', { class: 'field' }, el('span', { text: 'Quién entra' }), vis),
            el('label', { class: 'field' }, el('span', { text: 'Quién guía' }), ctl)),
          err, el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn', text: 'Cancelar', onclick: close }), go));
        body.append(form);
        api.listSeries().then(function (list) {
          V.clear(series);
          if (!list.length) { series.append(el('option', { value: '', text: 'No hay series publicadas' })); go.disabled = true; return; }
          list.forEach(function (s) { series.append(el('option', { value: String(s.id), text: s.title })); });
        }, function (e) { V.clear(series); series.append(el('option', { value: '', text: V.errMsg(e) })); go.disabled = true; });
        form.addEventListener('submit', function (e) {
          e.preventDefault(); err.textContent = '';
          if (!name.value.trim()) { err.textContent = 'Ponele un nombre al grupo.'; return; }
          if (!series.value) { err.textContent = 'Elegí una serie.'; return; }
          go.disabled = true;
          api.createGroup({ name: name.value.trim(), description: desc.value.trim(), seriesId: series.value, visibility: vis.value, control: ctl.value })
            .then(function (g) { close(); onOpen(g); }, function (er) { err.textContent = V.errMsg(er); go.disabled = false; });
        });
      },
    });
  }

  /* ---- sala de un grupo ---- */

  function groupView(box, ctx, gid, isAlive, back) {
    var api = ctx.api;
    var channel = api.openGroup(gid);
    var offs = [];
    var reading = null;
    var info = null;           // group meta from server
    var members = [];
    var canNav = false;
    var following = true;
    var applying = false;
    var lastChapterSent = null;
    var remote = { chapterId: null, page: 0 };
    var groupData = null;      // listGroups entry (for invite code)
    var seriesChapters = [];
    var destroyed = false;

    var title = el('h3', { class: 'mt', text: 'Entrando…' });
    var codeBox = el('span');
    var topActions = el('div', { class: 'row' });
    var syncBar = el('div', { class: 'sync' });
    var readBox = el('div');
    var membersUl = el('ul', { class: 'members' });
    var log = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
    var chatIn = el('input', { type: 'text', maxlength: '500', placeholder: 'Escribí al grupo', 'aria-label': 'Mensaje', autocomplete: 'off' });
    var chatForm = el('form', {}, chatIn, el('button', { type: 'submit', class: 'btn sm', text: 'Enviar' }));
    var picker = el('div');

    box.append(
      el('div', { class: 'gtop' }, el('div', {}, el('button', { type: 'button', class: 'lnk', text: '← Todos los grupos', onclick: back }), title), topActions),
      el('div', { class: 'gwrap' },
        el('div', { class: 'box' }, syncBar, el('div', { style: { padding: '10px' } }, picker, readBox)),
        el('div', { class: 'gside' },
          el('div', { class: 'box' }, el('h4', { text: 'Personas' }), membersUl),
          el('div', { class: 'box chat' }, el('h4', { text: 'Chat' }), log, chatForm))));

    function addMsg(m, sys) {
      var mine = ctx.user && m.userId === ctx.user.id;
      var row = sys ? el('div', { class: 'msg sys', text: m }) : el('div', { class: 'msg' + (mine ? ' me' : '') }, el('b', { text: m.name }), document.createTextNode(m.body));
      var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.append(row);
      while (log.children.length > 200) log.firstChild.remove();
      if (atBottom || mine) log.scrollTop = log.scrollHeight;
    }

    function renderMembers(online) {
      V.clear(membersUl);
      members.forEach(function (m) {
        var here = online ? online.indexOf(m.id) >= 0 : m.online;
        m.online = here;
        var li = el('li', { class: here ? 'here' : '' }, el('i'), el('span', { text: m.name }));
        if (info && m.id === info.ownerId) li.append(el('span', { class: 'tagx', text: 'guía' }));
        else if (ctx.user && info && info.ownerId === ctx.user.id) {
          li.append(el('button', { type: 'button', 'aria-label': 'Sacar a ' + m.name, title: 'Sacar del grupo', text: '×', onclick: function () {
            V.confirm('Sacar del grupo', '¿Sacar a ' + m.name + ' del grupo?', 'Sacar').then(function (ok) {
              if (ok) api.kickMember(gid, m.id).then(function () { members = members.filter(function (x) { return x.id !== m.id; }); renderMembers(); }, function (e) { V.toast(V.errMsg(e)); });
            });
          } }));
        }
        membersUl.append(li);
      });
    }

    function renderSync() {
      V.clear(syncBar);
      if (!info) return;
      if (canNav) {
        syncBar.append(el('span', { text: info.control === 'guide' ? 'Vos guiás: cada página que pases la ven todas.' : 'Cualquiera puede pasar páginas: lo que hagas lo ve el grupo.' }));
        return;
      }
      var cb = el('input', { type: 'checkbox', id: 'follow', checked: following ? true : null });
      cb.checked = following;
      cb.addEventListener('change', function () {
        following = cb.checked;
        if (following) catchUp();
        renderSync();
      });
      syncBar.append(el('label', { class: 'field inline', for: 'follow', style: { margin: 0 } }, cb, el('span', { text: 'Seguir al grupo' })));
      if (!following) syncBar.append(el('button', { type: 'button', class: 'btn sm', text: 'Ir adonde está el grupo', onclick: function () { following = true; catchUp(); renderSync(); } }));
    }

    function applyRemote(chapterId, page) {
      if (!reading) return Promise.resolve();
      applying = true;
      var done = function () { applying = false; };
      if (chapterId != null && (!reading.chapter || reading.chapter.id !== chapterId)) {
        return reading.loadChapter(chapterId, page, false).then(function () { applying = false; }, done);
      }
      reading.setPage(page);
      applying = false;
      return Promise.resolve();
    }
    function catchUp() { if (remote.chapterId != null) applyRemote(remote.chapterId, remote.page); }

    function buildReader() {
      if (reading) return;
      reading = V.mountReading({
        container: readBox, api: api, lockNav: !canNav && following,
        onPage: function (chapterId, page) {
          if (applying || !canNav) return;
          var msg = { page: page };
          if (lastChapterSent !== chapterId) { msg.chapterId = chapterId; lastChapterSent = chapterId; }
          channel.send('nav', msg);
        },
      });
    }

    function buildPicker() {
      V.clear(picker);
      if (!canNav || !info || !info.seriesId) return;
      api.getSeries(info.seriesId).then(function (d) {
        if (destroyed) return;
        seriesChapters = d.chapters;
        if (!seriesChapters.length) { picker.append(el('p', { class: 'muted', text: 'Esta serie todavía no tiene capítulos publicados.' })); return; }
        var sel = el('select', { 'aria-label': 'Capítulo del grupo' }, seriesChapters.map(function (c) { return el('option', { value: String(c.id), text: V.chapterLabel(c) }); }));
        if (remote.chapterId != null) sel.value = String(remote.chapterId);
        sel.addEventListener('change', function () {
          var picked = seriesChapters.filter(function (c) { return String(c.id) === sel.value; })[0];
          if (!picked) return;
          var id = picked.id;
          lastChapterSent = id;
          channel.send('nav', { chapterId: id, page: 0 });
          remote = { chapterId: id, page: 0 };
          applyRemote(id, 0);
        });
        picker.append(el('label', { class: 'field', style: { marginBottom: '10px' } }, el('span', { text: 'Capítulo del grupo' }), sel));
        picker._sel = sel;
      }, function () {});
    }

    function setupActions() {
      V.clear(topActions); V.clear(codeBox);
      if (groupData && groupData.inviteCode) {
        var code = groupData.inviteCode;
        topActions.append(el('span', { class: 'row' }, el('span', { class: 'muted', text: 'Código' }), el('span', { class: 'code', text: code }),
          el('button', { type: 'button', class: 'btn sm', text: 'Copiar', onclick: function () { V.copyText(code).then(function (ok) { V.toast(ok ? 'Código copiado.' : 'No se pudo copiar. Seleccionalo a mano.'); }); } })));
      }
      if (info && ctx.user && info.ownerId === ctx.user.id) {
        topActions.append(V.armedButton('Eliminar grupo', '¿Seguro?', function () {
          api.deleteGroup(gid).then(function () { V.toast('Grupo eliminado.'); back(); }, function (e) { V.toast(V.errMsg(e)); });
        }, 'danger'));
      } else {
        topActions.append(V.armedButton('Salir del grupo', '¿Seguro?', function () {
          api.leaveGroup(gid).then(function () { V.toast('Saliste del grupo.'); back(); }, function (e) { V.toast(V.errMsg(e)); });
        }));
      }
    }

    offs.push(channel.on('state', function (m) {
      info = m.group;
      canNav = !!m.group.canNavigate;
      title.textContent = m.group.name;
      members = m.members;
      remote = { chapterId: m.state.chapterId, page: m.state.page || 0 };
      V.clear(log);
      m.messages.forEach(function (x) { addMsg(x); });
      renderMembers();
      buildReader();
      reading.setLock(!canNav);
      renderSync();
      buildPicker();
      api.listGroups().then(function (r) {
        if (destroyed) return;
        groupData = r.mine.filter(function (g) { return String(g.id) === String(gid); })[0] || null;
        setupActions();
      }, function () { setupActions(); });
      if (remote.chapterId != null) {
        lastChapterSent = remote.chapterId;
        applyRemote(remote.chapterId, remote.page).then(function () { if (picker._sel) picker._sel.value = String(remote.chapterId); });
      } else if (!canNav) {
        V.clear(readBox);
        readBox.append(el('p', { class: 'muted', text: 'Esperando a que quien guía elija un capítulo.' }));
        reading.destroy(); reading = null;
      }
    }));
    offs.push(channel.on('nav', function (m) {
      if (m.chapterId != null) remote.chapterId = m.chapterId;
      remote.page = m.page;
      if (picker._sel && m.chapterId != null) picker._sel.value = String(m.chapterId);
      if (!reading) { buildReader(); reading.setLock(!canNav); }
      if (canNav && info && info.control === 'guide') return;
      if (canNav || following) applyRemote(remote.chapterId, remote.page);
      else if (reading) reading.reader.say((m.by && m.by.name ? m.by.name : 'El grupo') + ' está en la página ' + (m.page + 1));
    }));
    offs.push(channel.on('members', function (m) { members = m.members; renderMembers(); }));
    offs.push(channel.on('chat', function (m) { addMsg(m); }));
    offs.push(channel.on('presence', function (m) { renderMembers(m.online); }));
    offs.push(channel.on('closed', function (m) {
      V.toast(m.reason === 'kicked' ? 'Te sacaron del grupo.' : m.reason === 'deleted' ? 'El grupo fue eliminado.' : 'La sala se cerró.');
      back();
    }));
    offs.push(channel.on('error', function (m) { V.toast(m.message || 'Algo salió mal en la sala.'); }));
    offs.push(channel.on('disconnected', function () { addMsg('Se cortó la conexión. Reconectando…', true); }));

    chatForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = chatIn.value.trim();
      if (!t) return;
      if (channel.send('chat', { body: t })) chatIn.value = ''; else V.toast('Sin conexión. Probá en un momento.');
    });

    return function () {
      destroyed = true;
      offs.forEach(function (f) { f(); });
      channel.close();
      if (reading) reading.destroy();
    };
  }
})(window.Valle = window.Valle || {});
