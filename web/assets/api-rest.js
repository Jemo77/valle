/* Implementación de Valle.api para el servidor propio (Express + PostgreSQL + WebSocket). */
(function (V) {
  'use strict';

  function ApiError(message, code, status) {
    var e = new Error(message);
    e.code = code || null;
    e.status = status || 0;
    return e;
  }

  function http(method, url, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = data && data.error;
          throw ApiError(err ? err.message : 'No pudimos completar el pedido (' + res.status + ').', err && err.code, res.status);
        }
        return data;
      });
    }, function () { throw ApiError('No hay conexión con el servidor.', 'network', 0); });
  }
  var GET = function (u) { return http('GET', u); };
  var POST = function (u, b) { return http('POST', u, b === undefined ? {} : b); };
  var PUT = function (u, b) { return http('PUT', u, b); };
  var PATCH = function (u, b) { return http('PATCH', u, b); };
  var DEL = function (u) { return http('DELETE', u); };

  /* ---------- tiempo real: una sola conexión, reconectable ---------- */

  var rt = (function () {
    var ws = null, backoff = 1000, timer = 0, cid = null, wanted = true;
    var bus = V.emitter();
    var state = { online: 0 };

    function url() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }

    function connect() {
      if (!wanted || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
      ws = new WebSocket(url());
      ws.onopen = function () { backoff = 1000; };
      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.t === 'welcome') { cid = msg.cid; state.online = msg.online; bus.emit('open', msg); bus.emit('online', msg.online); return; }
        if (msg.t === 'online') { state.online = msg.n; bus.emit('online', msg.n); return; }
        bus.emit(msg.t, msg);
      };
      ws.onclose = function () {
        ws = null; cid = null;
        bus.emit('close');
        if (!wanted) return;
        clearTimeout(timer);
        timer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
      ws.onerror = function () { /* onclose se encarga */ };
    }
    function send(msg) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
      return false;
    }
    function reset() {
      wanted = true;
      if (ws) { try { ws.close(); } catch (e) { /* ya cerrada */ } } else connect();
    }
    setInterval(function () { send({ t: 'ping' }); }, 25000);
    return { connect: connect, send: send, reset: reset, on: bus.on, get cid() { return cid; }, get online() { return state.online; } };
  })();

  /** Canal sobre la conexión: reenvía solo los eventos con un prefijo y se vuelve a unir tras una reconexión. */
  function channel(prefix, joinMsg) {
    var out = V.emitter();
    var offs = [];
    var closed = false;
    var tracked = ['state', 'nav', 'chat', 'presence', 'closed', 'init', 'stroke', 'clear', 'peers', 'snapshot_request', 'error'];
    tracked.forEach(function (name) {
      offs.push(rt.on(name === 'error' ? 'error' : prefix + ':' + name, function (m) {
        if (name === 'error' && !(m.ref && m.ref.indexOf(prefix + ':') === 0)) return;
        out.emit(name, m);
      }));
    });
    offs.push(rt.on('open', function () { if (!closed) rt.send(joinMsg); }));
    offs.push(rt.on('close', function () { if (!closed) out.emit('disconnected'); }));
    rt.connect();
    if (!rt.send(joinMsg)) { /* se unirá cuando abra */ }
    out.send = function (type, data) {
      var msg = { t: prefix + ':' + type };
      if (data) Object.keys(data).forEach(function (k) { msg[k] = data[k]; });
      return rt.send(msg);
    };
    out.close = function () {
      if (closed) return;
      closed = true;
      rt.send({ t: prefix + ':leave' });
      offs.forEach(function (f) { f(); });
      out.clear();
    };
    Object.defineProperty(out, 'cid', { get: function () { return rt.cid; } });
    return out;
  }

  /* ---------- API ---------- */

  var api = {
    mode: 'rest',
    user: null,
    site: null,
    features: { accounts: true, registration: true, groups: true, sharedDraw: true, download: true },

    init: function () {
      return Promise.all([GET('/api/auth/me'), GET('/api/site')]).then(function (r) {
        api.user = r[0].user;
        api.site = r[1];
        api.features.registration = r[1].allowRegistration;
        rt.connect();
        return { user: api.user, canAdmin: !!api.user && api.user.role === 'admin', site: api.site };
      });
    },
    onOnline: function (fn) { fn(rt.online); return rt.on('online', fn); },

    /* cuentas */
    login: function (username, password) {
      return POST('/api/auth/login', { username: username, password: password }).then(function (r) { api.user = r.user; rt.reset(); return r.user; });
    },
    register: function (username, password, displayName) {
      return POST('/api/auth/register', { username: username, password: password, displayName: displayName }).then(function (r) { api.user = r.user; rt.reset(); return r.user; });
    },
    logout: function () { return POST('/api/auth/logout').then(function () { api.user = null; rt.reset(); }); },

    /* biblioteca */
    listSeries: function () { return GET('/api/series').then(function (r) { return r.series; }); },
    getSeries: function (id) { return GET('/api/series/' + id); },
    getChapter: function (id) { return GET('/api/chapters/' + id).then(function (r) { return r.chapter; }); },
    latestChapters: function () { return GET('/api/latest').then(function (r) { return r.chapters; }); },
    getProgress: function () { return api.user ? GET('/api/progress').then(function (r) { return r.progress; }) : Promise.resolve({}); },
    setProgress: function (chapterId, page) { return api.user ? PUT('/api/progress', { chapterId: chapterId, page: page }).catch(function () {}) : Promise.resolve(); },

    /* contenido */
    listProjects: function () { return GET('/api/projects').then(function (r) { return r.projects; }); },
    listGuestbook: function () { return GET('/api/guestbook').then(function (r) { return r.entries; }); },
    addGuestbook: function (body, name) { return POST('/api/guestbook', { body: body, name: name }).then(function (r) { return r.entry; }); },

    /* grupos de lectura */
    listGroups: function () {
      return GET('/api/groups').then(function (r) {
        return { mine: r.groups.filter(function (g) { return g.isMember; }), open: r.groups.filter(function (g) { return !g.isMember; }) };
      });
    },
    createGroup: function (data) { return POST('/api/groups', Object.assign({}, data, { seriesId: data.seriesId == null ? null : Number(data.seriesId) })).then(function (r) { return r.group; }); },
    joinGroup: function (arg) {
      return (arg.code ? POST('/api/groups/join', { code: arg.code }) : POST('/api/groups/' + arg.id + '/join')).then(function (r) { return r.group; });
    },
    leaveGroup: function (id) { return POST('/api/groups/' + id + '/leave'); },
    deleteGroup: function (id) { return DEL('/api/groups/' + id); },
    kickMember: function (gid, uid) { return DEL('/api/groups/' + gid + '/members/' + uid); },
    openGroup: function (id) { return channel('group', { t: 'group:join', groupId: Number(id) }); },

    /* lienzo compartido */
    listDrawRooms: function () { return GET('/api/draw/rooms').then(function (r) { return r.rooms; }); },
    openDraw: function (room) { return channel('draw', { t: 'draw:join', room: room }); },

    /* administración */
    admin: {
      stats: function () { return GET('/api/admin/stats').then(function (r) { return r.stats; }); },
      getSite: function () { return GET('/api/admin/site').then(function (r) { return r.site; }); },
      saveSite: function (patch) { return PUT('/api/admin/site', patch).then(function (r) { return r.site; }); },

      listSeries: function () { return GET('/api/admin/series').then(function (r) { return r.series; }); },
      saveSeries: function (s) {
        var body = { title: s.title, originalTitle: s.originalTitle, author: s.author, sourceLang: s.sourceLang, synopsis: s.synopsis, status: s.status, published: s.published, position: s.position };
        return (s.id ? PATCH('/api/admin/series/' + s.id, body) : POST('/api/admin/series', body)).then(function (r) { return r.series; });
      },
      deleteSeries: function (id) { return DEL('/api/admin/series/' + id); },
      setCover: function (id, file) {
        var fd = new FormData(); fd.append('cover', file, file.name);
        return http('POST', '/api/admin/series/' + id + '/cover', fd).then(function (r) { return r.coverUrl; });
      },

      listChapters: function (seriesId) { return GET('/api/admin/series/' + seriesId + '/chapters').then(function (r) { return r.chapters; }); },
      saveChapter: function (seriesId, c) {
        var body = { number: c.number, title: c.title, published: c.published };
        return (c.id ? PATCH('/api/admin/chapters/' + c.id, body) : POST('/api/admin/series/' + seriesId + '/chapters', body)).then(function (r) { return r.chapter; });
      },
      deleteChapter: function (id) { return DEL('/api/admin/chapters/' + id); },

      listPages: function (chapterId) { return GET('/api/admin/chapters/' + chapterId + '/pages').then(function (r) { return r.pages; }); },
      uploadPages: function (chapterId, files) {
        var fd = new FormData();
        fd.append('sort', 'name');
        files.forEach(function (f) { fd.append('pages', f, f.name); });
        return http('POST', '/api/admin/chapters/' + chapterId + '/pages', fd).then(function (r) { return r.pages; });
      },
      deletePage: function (chapterId, pageId) { return DEL('/api/admin/pages/' + pageId); },
      reorderPages: function (chapterId, ids) { return PUT('/api/admin/chapters/' + chapterId + '/pages/order', { ids: ids }).then(function (r) { return r.pages; }); },

      listProjects: function () { return GET('/api/admin/projects').then(function (r) { return r.projects; }); },
      saveProject: function (p) {
        var body = { name: p.name, description: p.description, stage: p.stage, tags: p.tags, url: p.url, visible: p.visible, position: p.position };
        return (p.id ? PATCH('/api/admin/projects/' + p.id, body) : POST('/api/admin/projects', body)).then(function (r) { return r.project; });
      },
      deleteProject: function (id) { return DEL('/api/admin/projects/' + id); },

      listGuestbook: function () { return GET('/api/admin/guestbook').then(function (r) { return r.entries; }); },
      setGuestbookHidden: function (id, hidden) { return PATCH('/api/admin/guestbook/' + id, { hidden: hidden }); },
      deleteGuestbook: function (id) { return DEL('/api/admin/guestbook/' + id); },

      listUsers: function () { return GET('/api/admin/users').then(function (r) { return r.users; }); },
      saveUser: function (id, patch) { return PATCH('/api/admin/users/' + id, patch); },
      listGroups: function () { return GET('/api/admin/groups').then(function (r) { return r.groups; }); },
      deleteGroup: function (id) { return DEL('/api/admin/groups/' + id); },
    },
  };

  V.api = api;
  V.ApiError = ApiError;
})(window.Valle = window.Valle || {});
