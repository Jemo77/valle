/* Implementación de Valle.api para la versión publicada en Claude (capacidades db, assets, room y user).
 * Es una demostración funcional: los datos viven en la base compartida de la página y las imágenes en su almacén de archivos.
 * Para el sitio real, con servidor propio y PostgreSQL, se usa api-rest.js. */
(function (V) {
  'use strict';

  function ApiError(message, code, status) {
    var e = new Error(message);
    e.code = code || null;
    e.status = status || 0;
    return e;
  }
  V.ApiError = ApiError;

  var DEFAULT_SITE = {
    name: 'Valle Interior',
    intro: 'Acá traduzco mangas que todavía no existen en español, dibujo y dejo mis proyectos web. Pasá, leé, dibujá con alguien o quedate mirando el horizonte.',
    influences: [
      { kanji: '命', title: 'Evangelion', text: 'La vida que insiste y pelea frente a la corrupción.' },
      { kanji: '空', title: 'Tsutomu Nihei', text: 'El espacio sin final y los lugares desolados de Blame!' },
      { kanji: '問', title: 'Yoshitoshi ABe', text: 'Preguntarse quiénes somos, en voz baja.' },
    ],
  };

  var caps = { db: null, room: null, assets: null, user: null };
  var me = null;       // { id, name, canEdit }
  var online = V.emitter();
  var onlineCount = 1;

  function use(name) {
    if (!window.claude || !window.claude.use) return Promise.resolve(null);
    return window.claude.use(name).catch(function () { return null; });
  }
  function nowIso() { return new Date().toISOString(); }
  function rid(prefix) { return (prefix || '') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function blobUrl(id) { return id ? '/_blob/' + id : null; }
  function wrap(e) {
    if (e && e.status !== undefined) return e;
    return ApiError((e && e.message) || 'No se pudo completar la operación.', e && e.code, 0);
  }
  function needDb() {
    if (!caps.db) throw ApiError('Para ver y usar el contenido tenés que haber entrado a Claude. Si ya lo hiciste, recargá la página.', 'no_db', 401);
    return caps.db;
  }
  function needMe() {
    needDb();
    if (!me || !me.id) throw ApiError('Para esto hace falta haber entrado a Claude.', 'no_user', 401);
    return me;
  }
  function docsOf(snap) {
    return snap.docs.map(function (d) { var x = d.data() || {}; x.id = d.id; return x; });
  }
  function all(name) {
    return needDb().collection(name).get().then(docsOf, function (e) { throw wrap(e); });
  }
  function getDoc(path) {
    return needDb().doc(path).get().then(function (s) { if (!s.exists) return null; var x = s.data() || {}; x.id = s.id; return x; }, function (e) { throw wrap(e); });
  }
  function nat(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }); }

  /* ---------- caché corta para no repetir lecturas dentro de una misma pantalla ---------- */
  var cache = {};
  function cached(name, ttl) {
    var c = cache[name];
    if (c && Date.now() - c.at < ttl) return c.p;
    var p = all(name);
    cache[name] = { at: Date.now(), p: p };
    p.catch(function () { delete cache[name]; });
    return p;
  }
  function bust() { cache = {}; }

  /* ---------- mapeos a la forma que espera la interfaz ---------- */
  function seriesOut(s, chapters) {
    var mine = chapters ? chapters.filter(function (c) { return c.seriesId === s.id; }) : [];
    var live = mine.filter(function (c) { return c.published && (c.pages || []).length; });
    return {
      id: s.id, slug: s.id, title: s.title || '', originalTitle: s.originalTitle || '', author: s.author || '', sourceLang: s.sourceLang || '',
      synopsis: s.synopsis || '', status: s.status || 'ongoing', published: !!s.published, position: s.position || 0,
      coverUrl: blobUrl(s.coverId), chapterCount: chapters ? live.length : 0, publishedChapters: live.length, totalChapters: mine.length,
      updatedAt: s.updatedAt || null,
    };
  }
  function chapterOut(c) {
    return { id: c.id, seriesId: c.seriesId, number: c.number, title: c.title || '', published: !!c.published, pageCount: (c.pages || []).length, createdAt: c.createdAt || null };
  }
  function pagesOut(c) {
    return (c.pages || []).map(function (p, i) { return { id: p.id, position: i, url: blobUrl(p.id), width: p.w || null, height: p.h || null }; });
  }

  /* ---------- canal de grupos y de dibujo sobre `room` ---------- */
  function ensureRoom(name) {
    if (!caps.room || !caps.room.join) return Promise.reject(ApiError('Las salas en tiempo real no están disponibles en esta vista.', 'no_room', 0));
    return caps.room.join(name);
  }

  function baseChannel() {
    var out = V.emitter();
    out.cid = null;
    out._offs = [];
    out._closed = false;
    return out;
  }
  function asyncOpen(out, fn) {
    // Se difiere para que quien abre el canal alcance a registrar sus escuchas.
    Promise.resolve().then(function () { return fn(); }).catch(function (e) {
      out.emit('error', { message: (e && e.message) || 'No se pudo abrir la sala.', code: (e && e.code) || 'error' });
    });
  }

  function openGroup(gid) {
    var out = baseChannel();
    var room = null;
    var doc = null;
    var first = true;
    var navT = 0;
    var pendingNav = null;
    var lastMembers = '';
    var group = null;

    out.send = function (type, data) {
      if (out._closed) return false;
      data = data || {};
      if (type === 'chat') {
        var body = String(data.body || '').trim().slice(0, 500);
        if (!body || !me) return false;
        var msg = { id: rid('m'), userId: me.id, name: me.name, body: body, at: nowIso() };
        if (room) room.emit('chat', msg).catch(function (e) { out.emit('error', { message: (e && e.message) || 'No se pudo enviar.' }); });
        out.emit('chat', msg);
        return true;
      }
      if (type === 'nav') {
        if (!group || !(group.control === 'everyone' || group.ownerId === me.id)) return false;
        var payload = { page: Number(data.page) || 0, by: { id: me.id, name: me.name } };
        if (data.chapterId != null) payload.chapterId = data.chapterId;
        if (room) room.emit('nav', payload).catch(function () {});
        pendingNav = Object.assign(pendingNav || {}, { page: payload.page });
        if (payload.chapterId != null) pendingNav.chapterId = payload.chapterId;
        clearTimeout(navT);
        navT = setTimeout(function () {
          var p = pendingNav; pendingNav = null;
          if (p && doc) doc.update(p).catch(function () {});
        }, 1200);
        return true;
      }
      return false;
    };
    out.close = function () {
      if (out._closed) return;
      out._closed = true;
      clearTimeout(navT);
      if (pendingNav && doc) doc.update(pendingNav).catch(function () {});
      out._offs.forEach(function (f) { try { f(); } catch (e) { /* ya cerrado */ } });
      if (room) room.leave().catch(function () {});
      out.clear();
    };

    function membersOf(g, onlineIds) {
      return (g.memberIds || []).map(function (id) {
        return { id: id, name: (g.memberNames && g.memberNames[id]) || 'alguien', role: id === g.ownerId ? 'owner' : 'member', online: onlineIds.indexOf(id) >= 0 };
      });
    }
    var onlineIds = [];

    asyncOpen(out, function () {
      var d = needDb();
      needMe();
      doc = d.doc('groups/' + gid);
      return ensureRoom('g-' + gid).then(function (r) {
        if (out._closed) { r.leave().catch(function () {}); return; }
        room = r;
        r.presence({ uid: me.id, name: me.name }).catch(function () {});
        out._offs.push(r.on('nav', function (m) {
          if (m.isMe || !m.data) return;
          out.emit('nav', m.data);
        }));
        out._offs.push(r.on('chat', function (m) {
          if (m.isMe || !m.data) return;
          var x = m.data;
          out.emit('chat', { id: x.id, userId: x.userId, name: String(x.name || 'alguien').slice(0, 40), body: String(x.body || '').slice(0, 500), at: x.at });
        }));
        function emitPresence(peers) {
          onlineIds = peers.map(function (p) { return p.presence && p.presence.uid; }).filter(Boolean);
          if (onlineIds.indexOf(me.id) < 0) onlineIds.push(me.id);
          out.emit('presence', { online: onlineIds });
        }
        out._offs.push(r.onPeers(function (c) { emitPresence(c.peers); }));
        out._offs.push(r.onConnection(function (ok) { if (!ok) out.emit('disconnected'); }));
        emitPresence(r.peers());

        out._offs.push(doc.onSnapshot(function (snap) {
          if (out._closed) return;
          if (!snap.exists) { out.emit('closed', { reason: 'deleted' }); return; }
          var g = snap.data() || {};
          g.id = gid;
          if ((g.memberIds || []).indexOf(me.id) < 0) { out.emit('closed', { reason: 'kicked' }); return; }
          group = g;
          var sig = JSON.stringify([g.memberIds, g.memberNames]);
          if (first) {
            first = false;
            lastMembers = sig;
            out.emit('state', {
              group: { id: gid, name: g.name, control: g.control, ownerId: g.ownerId, seriesId: g.seriesId, canNavigate: g.control === 'everyone' || g.ownerId === me.id },
              state: { chapterId: g.chapterId == null ? null : g.chapterId, page: g.page || 0 },
              members: membersOf(g, onlineIds),
              messages: [],
            });
          } else if (sig !== lastMembers) {
            lastMembers = sig;
            out.emit('members', { members: membersOf(g, onlineIds) });
          }
        }, function (e) { out.emit('error', { message: (e && e.message) || 'Se perdió la conexión con el grupo.' }); }));
      });
    });
    return out;
  }

  function openDraw(roomId) {
    var out = baseChannel();
    var room = null;
    var dirty = false;
    var timer = 0;
    var lastCount = 1;
    var docPath = 'draw/' + roomId;

    function amElected() {
      var peers = room ? room.peers() : [];
      if (!peers.length) return true;
      var ids = peers.map(function (p) { return p.peer; }).sort();
      var mine = peers.filter(function (p) { return p.isMe; })[0];
      return !mine || mine.peer === ids[0];
    }
    function saveSnapshot(dataUrl) {
      if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/png;base64,') !== 0) return;
      if (dataUrl.length > 190000) return; // los documentos admiten hasta 256 KiB
      if (!caps.db) return;
      caps.db.doc(docPath).set({ snapshot: dataUrl, updatedAt: nowIso() }).catch(function () {});
    }

    out.send = function (type, data) {
      if (out._closed || !room) return false;
      data = data || {};
      if (type === 'stroke') {
        dirty = true;
        room.emit('stroke', { sid: String(data.sid || ''), tool: data.tool, color: data.color, size: data.size, pts: data.pts, end: !!data.end }).catch(function () {});
        return true;
      }
      if (type === 'clear') {
        room.emit('clear', { by: me ? me.name : null }).catch(function () {});
        if (caps.db) caps.db.doc(docPath).set({ snapshot: null, updatedAt: nowIso() }).catch(function () {});
        dirty = false;
        out.emit('clear', { by: null, seq: 0 });
        return true;
      }
      if (type === 'snapshot') { saveSnapshot(data.dataUrl); return true; }
      return false;
    };
    out.close = function () {
      if (out._closed) return;
      out._closed = true;
      clearInterval(timer);
      out._offs.forEach(function (f) { try { f(); } catch (e) { /* ya cerrado */ } });
      if (room) room.leave().catch(function () {});
      out.clear();
    };

    asyncOpen(out, function () {
      needDb(); needMe();
      return Promise.all([ensureRoom('draw-' + roomId), getDoc(docPath).catch(function () { return null; })]).then(function (r) {
        if (out._closed) { r[0].leave().catch(function () {}); return; }
        room = r[0];
        room.presence({ uid: me.id, name: me.name }).catch(function () {});
        out._offs.push(room.on('stroke', function (m) {
          if (m.isMe || !m.data) return;
          var d = m.data;
          if (!Array.isArray(d.pts) || !d.pts.length) return;
          dirty = true;
          out.emit('stroke', { cid: m.peer, sid: String(d.sid || ''), tool: d.tool === 'eraser' ? 'eraser' : 'brush', color: /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : '#e4e8da',
            size: Math.max(1, Math.min(80, Number(d.size) || 7)), pts: d.pts.slice(0, 160), end: !!d.end, seq: 0 });
        }));
        out._offs.push(room.on('clear', function (m) {
          if (m.isMe) return;
          dirty = false;
          out.emit('clear', { by: m.data && m.data.by, seq: 0 });
        }));
        out._offs.push(room.onPeers(function (c) { lastCount = Math.max(1, c.peers.length); out.emit('peers', { n: lastCount }); }));
        out._offs.push(room.onConnection(function (ok) { if (!ok) out.emit('disconnected'); }));
        timer = setInterval(function () {
          if (dirty && amElected()) { dirty = false; out.emit('snapshot_request', {}); }
        }, 15000);
        lastCount = Math.max(1, room.peers().length);
        out.emit('init', { snapshot: r[1] && r[1].snapshot || null, chunks: [], seq: 0, n: lastCount });
      });
    });
    return out;
  }

  /* ---------- API ---------- */

  var progressCache = null;
  var progressT = 0;

  function groupOut(g, series, chapters) {
    var ids = g.memberIds || [];
    var s = series.filter(function (x) { return x.id === g.seriesId; })[0];
    var c = g.chapterId ? chapters.filter(function (x) { return x.id === g.chapterId; })[0] : null;
    var isMember = !!me && ids.indexOf(me.id) >= 0;
    return {
      id: g.id, name: g.name, description: g.description || '', ownerId: g.ownerId, ownerName: g.ownerName || 'alguien',
      seriesId: g.seriesId, seriesTitle: s ? s.title : null, visibility: g.visibility, control: g.control,
      memberCount: ids.length, isMember: isMember, isOwner: !!me && g.ownerId === me.id,
      inviteCode: isMember ? g.inviteCode : null, chapterId: g.chapterId || null,
      chapterNumber: c ? c.number : null, chapterTitle: c ? c.title : null, page: g.page || 0, createdAt: g.createdAt || null,
    };
  }

  function loadGroups() {
    return Promise.all([all('groups'), cached('series', 4000), cached('chapters', 4000)]).then(function (r) {
      return r[0].map(function (g) { return groupOut(g, r[1], r[2]); });
    });
  }

  function findGroupDoc(arg) {
    var d = needDb();
    if (arg.id) return getDoc('groups/' + arg.id);
    var code = String(arg.code || '').trim().toUpperCase();
    return d.collection('groups').where('inviteCode', '==', code).limit(1).get().then(function (s) { return s.empty ? null : (function () { var x = s.docs[0].data(); x.id = s.docs[0].id; return x; })(); });
  }

  function imageSize(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).then(function (b) { var r = { w: b.width, h: b.height }; if (b.close) b.close(); return r; }, function () { return { w: null, h: null }; });
    }
    return Promise.resolve({ w: null, h: null });
  }

  function isReferenced(assetId, exceptChapter) {
    return Promise.all([all('chapters'), all('series')]).then(function (r) {
      var inCh = r[0].some(function (c) { return c.id !== exceptChapter && (c.pages || []).some(function (p) { return p.id === assetId; }); });
      var inSe = r[1].some(function (s) { return s.coverId === assetId; });
      return inCh || inSe;
    });
  }

  var api = {
    mode: 'artifact',
    user: null,
    site: null,
    features: { accounts: false, registration: false, groups: true, sharedDraw: true, download: false, adminPeople: false },

    init: function () {
      return Promise.all([use('db'), use('user'), use('assets'), use('room')]).then(function (r) {
        caps.db = r[0]; caps.user = r[1]; caps.assets = r[2]; caps.room = r[3];
        var meP = caps.user ? Promise.all([caps.user.me().catch(function () { return null; }), caps.user.canEdit().catch(function () { return false; })]) : Promise.resolve([null, false]);
        return meP;
      }).then(function (m) {
        var v = m[0];
        if (v && v.id) me = { id: v.id, name: v.name || 'Visitante', canEdit: !!m[1] };
        api.user = me ? { id: me.id, username: me.name, name: me.name, role: me.canEdit ? 'admin' : 'user' } : null;
        // contador de gente conectada: sala general
        if (caps.room && caps.room.onPeers) {
          try {
            caps.room.presence({ here: 1 }).catch(function () {});
            caps.room.onPeers(function (c) { onlineCount = Math.max(1, c.peers.length); online.emit('n', onlineCount); });
          } catch (e) { /* sin contador */ }
        }
        return (caps.db ? getDoc('site/main').catch(function () { return null; }) : Promise.resolve(null));
      }).then(function (siteDoc) {
        api.site = Object.assign({}, DEFAULT_SITE, siteDoc || {}, { readRequiresLogin: false, allowRegistration: false });
        return { user: api.user, canAdmin: !!(me && me.canEdit), site: api.site };
      });
    },
    onOnline: function (fn) { fn(onlineCount); return online.on('n', fn); },

    login: function () { return Promise.reject(ApiError('Acá la identidad viene de tu cuenta de Claude.', 'n/a')); },
    register: function () { return Promise.reject(ApiError('Acá la identidad viene de tu cuenta de Claude.', 'n/a')); },
    logout: function () { return Promise.resolve(); },

    /* biblioteca */
    listSeries: function () {
      return Promise.all([cached('series', 3000), cached('chapters', 3000)]).then(function (r) {
        return r[0].filter(function (s) { return s.published; }).map(function (s) { return seriesOut(s, r[1]); })
          .sort(function (a, b) { return (a.position - b.position) || nat(a.title, b.title); });
      });
    },
    getSeries: function (id) {
      return Promise.all([getDoc('series/' + id), cached('chapters', 3000)]).then(function (r) {
        var s = r[0];
        if (!s || !s.published) throw ApiError('Esa serie no existe.', 'not_found', 404);
        var chs = r[1].filter(function (c) { return c.seriesId === id && c.published && (c.pages || []).length; }).sort(function (a, b) { return a.number - b.number; });
        var out = seriesOut(s, r[1]);
        return { series: out, chapters: chs.map(function (c) { return { id: c.id, number: c.number, title: c.title || '', pageCount: c.pages.length, createdAt: c.createdAt || null }; }) };
      });
    },
    getChapter: function (id) {
      return Promise.all([getDoc('chapters/' + id), cached('chapters', 3000), cached('series', 3000)]).then(function (r) {
        var c = r[0];
        var s = c ? r[2].filter(function (x) { return x.id === c.seriesId; })[0] : null;
        if (!c || !c.published || !s || !s.published) throw ApiError('Ese capítulo no existe.', 'not_found', 404);
        var sib = r[1].filter(function (x) { return x.seriesId === c.seriesId && x.published && (x.pages || []).length; }).sort(function (a, b) { return a.number - b.number; });
        var i = sib.map(function (x) { return x.id; }).indexOf(id);
        return { id: c.id, number: c.number, title: c.title || '', seriesId: c.seriesId, seriesTitle: s.title,
          pages: pagesOut(c).map(function (p) { return { id: p.id, url: p.url, width: p.width, height: p.height }; }),
          prevId: i > 0 ? sib[i - 1].id : null, nextId: i >= 0 && i < sib.length - 1 ? sib[i + 1].id : null };
      });
    },
    latestChapters: function () {
      return Promise.all([cached('series', 3000), cached('chapters', 3000)]).then(function (r) {
        var live = {};
        r[0].forEach(function (s) { if (s.published) live[s.id] = s; });
        return r[1].filter(function (c) { return c.published && live[c.seriesId] && (c.pages || []).length; })
          .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); }).slice(0, 6)
          .map(function (c) { var s = live[c.seriesId]; return { id: c.id, number: c.number, title: c.title || '', seriesId: s.id, seriesTitle: s.title, coverUrl: blobUrl(s.coverId), createdAt: c.createdAt || null }; });
      });
    },
    getProgress: function () {
      if (!me || !caps.db) return Promise.resolve({});
      return getDoc('data/users/' + me.id + '/profile').then(function (d) { progressCache = (d && d.progress) || {}; return progressCache; }, function () { progressCache = {}; return {}; });
    },
    setProgress: function (chapterId, page) {
      if (!me || !caps.db) return Promise.resolve();
      progressCache = progressCache || {};
      progressCache[chapterId] = page;
      clearTimeout(progressT);
      progressT = setTimeout(function () {
        caps.db.doc('data/users/' + me.id + '/profile').set({ progress: progressCache }).catch(function () {});
      }, 1500);
      return Promise.resolve();
    },

    /* contenido */
    listProjects: function () {
      return cached('projects', 3000).then(function (rows) {
        return rows.filter(function (p) { return p.visible !== false; }).sort(function (a, b) { return ((a.position || 0) - (b.position || 0)) || nat(a.name, b.name); })
          .map(function (p) { return { id: p.id, name: p.name, description: p.description || '', stage: p.stage || 'semilla', tags: p.tags || [], url: p.url || '' }; });
      });
    },
    listGuestbook: function () {
      return all('guestbook').then(function (rows) {
        return rows.filter(function (g) { return !g.hidden; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 60)
          .map(function (g) { return { id: g.id, author: g.author, body: g.body, createdAt: g.createdAt }; });
      });
    },
    addGuestbook: function (body, name) {
      var d = needDb();
      var entry = { author: (me && me.name) || String(name || 'visitante').slice(0, 24), body: String(body).slice(0, 280), hidden: false, createdAt: nowIso(), uid: me ? me.id : null };
      return d.collection('guestbook').add(entry).then(function (ref) { entry.id = ref.id; return entry; }, function (e) { throw wrap(e); });
    },

    /* grupos de lectura */
    listGroups: function () {
      return loadGroups().then(function (list) {
        return { mine: list.filter(function (g) { return g.isMember; }), open: list.filter(function (g) { return !g.isMember && g.visibility === 'public'; }) };
      });
    },
    createGroup: function (data) {
      var m = needMe();
      var g = {
        name: String(data.name).slice(0, 60), description: String(data.description || '').slice(0, 240), seriesId: data.seriesId,
        ownerId: m.id, ownerName: m.name, visibility: data.visibility === 'public' ? 'public' : 'private', control: data.control === 'everyone' ? 'everyone' : 'guide',
        inviteCode: Math.random().toString(36).slice(2, 10).toUpperCase(), memberIds: [m.id], memberNames: {}, chapterId: null, page: 0, createdAt: nowIso(),
      };
      g.memberNames[m.id] = m.name;
      return needDb().collection('groups').add(g).then(function (ref) { g.id = ref.id; return groupOut(g, [], []); }, function (e) { throw wrap(e); });
    },
    joinGroup: function (arg) {
      var m = needMe();
      return findGroupDoc(arg).then(function (g) {
        if (!g) throw ApiError('Ese código no corresponde a ningún grupo.', 'not_found', 404);
        if (arg.id && g.visibility !== 'public' && (g.memberIds || []).indexOf(m.id) < 0) throw ApiError('Este grupo es por invitación.', 'forbidden', 403);
        var ids = (g.memberIds || []).slice();
        var names = Object.assign({}, g.memberNames || {});
        if (ids.indexOf(m.id) < 0) { ids.push(m.id); names[m.id] = m.name; }
        g.memberIds = ids; g.memberNames = names;
        return caps.db.doc('groups/' + g.id).update({ memberIds: ids, memberNames: names }).then(function () { return groupOut(g, [], []); });
      }).catch(function (e) { throw wrap(e); });
    },
    leaveGroup: function (id) {
      var m = needMe();
      return getDoc('groups/' + id).then(function (g) {
        if (!g) return;
        var ids = (g.memberIds || []).filter(function (x) { return x !== m.id; });
        return caps.db.doc('groups/' + id).update({ memberIds: ids });
      }).catch(function (e) { throw wrap(e); });
    },
    deleteGroup: function (id) { return needDb().doc('groups/' + id).delete().catch(function (e) { throw wrap(e); }); },
    kickMember: function (gid, uid) {
      needMe();
      return getDoc('groups/' + gid).then(function (g) {
        if (!g) return;
        return caps.db.doc('groups/' + gid).update({ memberIds: (g.memberIds || []).filter(function (x) { return x !== uid; }) });
      }).catch(function (e) { throw wrap(e); });
    },
    openGroup: openGroup,

    /* lienzo compartido */
    listDrawRooms: function () { return Promise.resolve([{ id: 'lienzo-abierto', name: 'Lienzo abierto', online: 0 }]); },
    openDraw: openDraw,

    /* administración */
    admin: {
      stats: function () {
        return Promise.all([all('series'), all('chapters'), all('projects'), all('guestbook'), all('groups')]).then(function (r) {
          var pages = r[1].reduce(function (n, c) { return n + (c.pages || []).length; }, 0);
          return { series: r[0].length, chapters: r[1].length, pages: pages, projects: r[2].length, guestbook: r[3].filter(function (g) { return !g.hidden; }).length, groups: r[4].length, online: onlineCount };
        });
      },
      getSite: function () { return getDoc('site/main').then(function (d) { return Object.assign({}, DEFAULT_SITE, d || {}); }); },
      saveSite: function (patch) {
        return getDoc('site/main').then(function (cur) {
          var next = Object.assign({}, cur || {}, patch);
          delete next.id; delete next.readRequiresLogin;
          return caps.db.doc('site/main').set(next).then(function () { api.site = Object.assign({}, DEFAULT_SITE, next, { readRequiresLogin: false, allowRegistration: false }); bust(); return api.site; });
        }).catch(function (e) { throw wrap(e); });
      },

      listSeries: function () {
        return Promise.all([all('series'), all('chapters')]).then(function (r) {
          return r[0].map(function (s) { return seriesOut(s, r[1]); }).sort(function (a, b) { return (a.position - b.position) || nat(a.title, b.title); });
        });
      },
      saveSeries: function (s) {
        var body = { title: s.title, originalTitle: s.originalTitle || '', author: s.author || '', sourceLang: s.sourceLang || 'ja', synopsis: s.synopsis || '', status: s.status || 'ongoing', published: !!s.published, position: Number(s.position) || 0, updatedAt: nowIso() };
        bust();
        var d = needDb();
        if (s.id) return d.doc('series/' + s.id).update(body).then(function () { return getDoc('series/' + s.id); }).then(function (x) { return seriesOut(x, null); }).catch(function (e) { throw wrap(e); });
        return d.collection('series').add(body).then(function (ref) { body.id = ref.id; return seriesOut(body, null); }).catch(function (e) { throw wrap(e); });
      },
      deleteSeries: function (id) {
        bust();
        return all('chapters').then(function (chs) {
          return Promise.all(chs.filter(function (c) { return c.seriesId === id; }).map(function (c) { return caps.db.doc('chapters/' + c.id).delete(); }));
        }).then(function () { return caps.db.doc('series/' + id).delete(); }).catch(function (e) { throw wrap(e); });
      },
      setCover: function (id, file) {
        if (!caps.assets) return Promise.reject(ApiError('Subir imágenes requiere permisos de edición.', 'no_assets', 403));
        bust();
        return caps.assets.upload(file).then(function (r) {
          return caps.db.doc('series/' + id).update({ coverId: r.id, updatedAt: nowIso() }).then(function () { return blobUrl(r.id); });
        }).catch(function (e) { throw wrap(e); });
      },

      listChapters: function (seriesId) {
        return all('chapters').then(function (rows) { return rows.filter(function (c) { return c.seriesId === seriesId; }).sort(function (a, b) { return a.number - b.number; }).map(chapterOut); });
      },
      saveChapter: function (seriesId, c) {
        bust();
        var body = { seriesId: seriesId, number: Number(c.number), title: c.title || '', published: !!c.published };
        if (c.id) return caps.db.doc('chapters/' + c.id).update(body).then(function () { return getDoc('chapters/' + c.id); }).then(chapterOut).catch(function (e) { throw wrap(e); });
        body.pages = []; body.createdAt = nowIso();
        return needDb().collection('chapters').add(body).then(function (ref) { body.id = ref.id; return chapterOut(body); }).catch(function (e) { throw wrap(e); });
      },
      deleteChapter: function (id) { bust(); return needDb().doc('chapters/' + id).delete().catch(function (e) { throw wrap(e); }); },

      listPages: function (chapterId) { return getDoc('chapters/' + chapterId).then(function (c) { return c ? pagesOut(c) : []; }); },
      uploadPages: function (chapterId, files) {
        if (!caps.assets) return Promise.reject(ApiError('Subir imágenes requiere permisos de edición.', 'no_assets', 403));
        bust();
        var sorted = files.slice().sort(function (a, b) { return nat(a.name, b.name); });
        var added = [];
        var chain = Promise.resolve();
        sorted.forEach(function (f) {
          chain = chain.then(function () {
            return Promise.all([caps.assets.upload(f), imageSize(f)]).then(function (r) { added.push({ id: r[0].id, w: r[1].w, h: r[1].h }); });
          });
        });
        return chain.then(function () {
          return getDoc('chapters/' + chapterId).then(function (c) {
            var pages = (c.pages || []).concat(added);
            return caps.db.doc('chapters/' + chapterId).update({ pages: pages }).then(function () { return pagesOut({ pages: added }); });
          });
        }).catch(function (e) {
          // si falló a mitad de camino, igual guardamos lo que sí se subió
          if (added.length) {
            return getDoc('chapters/' + chapterId).then(function (c) { return caps.db.doc('chapters/' + chapterId).update({ pages: (c.pages || []).concat(added) }); }).then(function () { throw wrap(e); });
          }
          throw wrap(e);
        });
      },
      deletePage: function (chapterId, pageId) {
        bust();
        return getDoc('chapters/' + chapterId).then(function (c) {
          var pages = (c.pages || []).filter(function (p) { return p.id !== pageId; });
          return caps.db.doc('chapters/' + chapterId).update({ pages: pages });
        }).then(function () {
          return isReferenced(pageId, null).then(function (used) { if (!used && caps.assets) return caps.assets.delete(pageId).catch(function () {}); });
        }).catch(function (e) { throw wrap(e); });
      },
      reorderPages: function (chapterId, ids) {
        bust();
        return getDoc('chapters/' + chapterId).then(function (c) {
          var byId = {};
          (c.pages || []).forEach(function (p) { byId[p.id] = p; });
          var pages = ids.map(function (id) { return byId[id]; }).filter(Boolean);
          return caps.db.doc('chapters/' + chapterId).update({ pages: pages }).then(function () { return pagesOut({ pages: pages }); });
        }).catch(function (e) { throw wrap(e); });
      },

      listProjects: function () {
        return all('projects').then(function (rows) {
          return rows.sort(function (a, b) { return ((a.position || 0) - (b.position || 0)) || nat(a.name, b.name); })
            .map(function (p) { return { id: p.id, slug: p.id, name: p.name, description: p.description || '', stage: p.stage || 'semilla', tags: p.tags || [], url: p.url || '', visible: p.visible !== false, position: p.position || 0 }; });
        });
      },
      saveProject: function (p) {
        bust();
        var body = { name: p.name, description: p.description || '', stage: p.stage || 'semilla', tags: p.tags || [], url: p.url || '', visible: p.visible !== false, position: Number(p.position) || 0 };
        var d = needDb();
        if (p.id) return d.doc('projects/' + p.id).update(body).then(function () { body.id = p.id; return body; }).catch(function (e) { throw wrap(e); });
        return d.collection('projects').add(body).then(function (ref) { body.id = ref.id; return body; }).catch(function (e) { throw wrap(e); });
      },
      deleteProject: function (id) { bust(); return needDb().doc('projects/' + id).delete().catch(function (e) { throw wrap(e); }); },

      listGuestbook: function () {
        return all('guestbook').then(function (rows) { return rows.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 200); });
      },
      setGuestbookHidden: function (id, hidden) { return needDb().doc('guestbook/' + id).update({ hidden: !!hidden }).catch(function (e) { throw wrap(e); }); },
      deleteGuestbook: function (id) { return needDb().doc('guestbook/' + id).delete().catch(function (e) { throw wrap(e); }); },

      listUsers: function () { return Promise.resolve([]); },
      saveUser: function () { return Promise.reject(ApiError('Acá los permisos se manejan desde el menú de compartir de la página.', 'n/a')); },
      listGroups: function () { return loadGroups(); },
    },
  };

  V.api = api;
})(window.Valle = window.Valle || {});
