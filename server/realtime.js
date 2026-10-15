import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { publicUser } from './lib/auth.js';

const CANVAS_W = 1000;
const CANVAS_H = 625;
const MAX_SNAPSHOT = 1_500_000;
const MAX_CHUNKS = 3000;

class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = Date.now(); }
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export function createRealtime({ server, db, auth, config, hub }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const groupRooms = new Map(); // groupId -> Set<conn>
  const drawRooms = new Map(); // roomId  -> room
  const timers = [];

  const send = (conn, msg) => {
    if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(msg));
  };
  const sendErr = (conn, code, message, ref) => send(conn, { t: 'error', code, message, ref });
  const broadcast = (set, msg, except = null) => {
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const c of set) if (c !== except && c.ws.readyState === 1) c.ws.send(data);
  };

  /* ---------- cuántas personas hay en el valle ---------- */

  let onlineTimer = null;
  const scheduleOnline = () => {
    if (onlineTimer) return;
    onlineTimer = setTimeout(() => {
      onlineTimer = null;
      const data = JSON.stringify({ t: 'online', n: wss.clients.size });
      for (const c of wss.clients) if (c.readyState === 1) c.send(data);
    }, 800);
    onlineTimer.unref?.();
  };

  /* ---------- grupos de lectura ---------- */

  async function loadGroupMeta(gid, uid) {
    return db.one(
      `select g.id, g.name, g.control, g.owner_id, g.series_id, g.visibility
       from reading_groups g join group_members m on m.group_id = g.id and m.user_id = $2
       where g.id = $1`,
      [gid, uid],
    );
  }

  function onlineIds(set) {
    return [...new Set([...set].map((c) => c.user.id))];
  }

  async function sendGroupState(conn) {
    const gid = conn.group.id;
    const meta = await loadGroupMeta(gid, conn.user.id);
    if (!meta) return leaveGroup(conn, 'kicked');
    conn.group.meta = meta;
    const [state, members, messages] = await Promise.all([
      db.one(
        `select gs.chapter_id, gs.page, c.number, c.title from group_state gs
         left join chapters c on c.id = gs.chapter_id where gs.group_id = $1`,
        [gid],
      ),
      db.many(
        `select u.id, u.display_name, m.role from group_members m join users u on u.id = m.user_id
         where m.group_id = $1 order by m.joined_at`,
        [gid],
      ),
      db.many(
        `select m.id, m.user_id, coalesce(u.display_name, 'alguien') as name, m.body, m.created_at
         from group_messages m left join users u on u.id = m.user_id
         where m.group_id = $1 order by m.id desc limit 50`,
        [gid],
      ),
    ]);
    const online = onlineIds(groupRooms.get(gid) || []);
    send(conn, {
      t: 'group:state',
      group: {
        id: meta.id, name: meta.name, control: meta.control, ownerId: meta.owner_id, seriesId: meta.series_id,
        canNavigate: meta.control === 'everyone' || meta.owner_id === conn.user.id,
      },
      state: state ? { chapterId: state.chapter_id, page: state.page, number: state.number, title: state.title } : { chapterId: null, page: 0 },
      members: members.map((m) => ({ id: m.id, name: m.display_name, role: m.role, online: online.includes(m.id) })),
      messages: messages.reverse().map((m) => ({ id: m.id, userId: m.user_id, name: m.name, body: m.body, at: m.created_at })),
    });
  }

  function broadcastPresence(gid) {
    const room = groupRooms.get(gid);
    if (!room) return;
    broadcast(room, { t: 'group:presence', online: onlineIds(room) });
  }

  function leaveGroup(conn, reason) {
    if (!conn.group) return;
    const gid = conn.group.id;
    const room = groupRooms.get(gid);
    conn.group = null;
    if (room) {
      room.delete(conn);
      if (!room.size) groupRooms.delete(gid);
    }
    if (reason) send(conn, { t: 'group:closed', reason });
    broadcastPresence(gid);
  }

  async function joinGroup(conn, msg) {
    if (!conn.user) return sendErr(conn, 'auth_required', 'Necesitás iniciar sesión.', msg.t);
    const gid = Number(msg.groupId);
    if (!Number.isInteger(gid) || gid < 1) return sendErr(conn, 'bad_request', 'Grupo inválido.', msg.t);
    const meta = await loadGroupMeta(gid, conn.user.id);
    if (!meta) return sendErr(conn, 'forbidden', 'No sos parte de este grupo.', msg.t);
    leaveGroup(conn);
    conn.group = { id: gid, meta };
    if (!groupRooms.has(gid)) groupRooms.set(gid, new Set());
    groupRooms.get(gid).add(conn);
    await sendGroupState(conn);
    broadcastPresence(gid);
  }

  async function groupNav(conn, msg) {
    if (!conn.group) return sendErr(conn, 'bad_request', 'No estás en un grupo.', msg.t);
    const meta = conn.group.meta;
    if (!(meta.control === 'everyone' || meta.owner_id === conn.user.id)) {
      return sendErr(conn, 'forbidden', 'En este grupo solo guía quien lo creó.', msg.t);
    }
    const page = Number(msg.page);
    if (!Number.isInteger(page) || page < 0 || page > 5000) return sendErr(conn, 'bad_request', 'Página inválida.', msg.t);
    let chapterId = msg.chapterId == null ? undefined : Number(msg.chapterId);
    if (chapterId !== undefined) {
      const ok = Number.isInteger(chapterId) && await db.one(
        `select 1 from chapters c join series s on s.id = c.series_id
         where c.id = $1 and c.published and s.published and ($2::bigint is null or c.series_id = $2)`,
        [chapterId, meta.series_id],
      );
      if (!ok) return sendErr(conn, 'bad_request', 'Ese capítulo no está disponible.', msg.t);
    }
    if (chapterId === undefined) {
      await db.query('update group_state set page = $2, updated_by = $3, updated_at = now() where group_id = $1', [conn.group.id, page, conn.user.id]);
    } else {
      await db.query('update group_state set chapter_id = $2, page = $3, updated_by = $4, updated_at = now() where group_id = $1', [conn.group.id, chapterId, page, conn.user.id]);
    }
    const out = { t: 'group:nav', page, by: { id: conn.user.id, name: conn.user.display_name } };
    if (chapterId !== undefined) out.chapterId = chapterId;
    broadcast(groupRooms.get(conn.group.id), out, conn);
  }

  async function groupChat(conn, msg) {
    if (!conn.group) return sendErr(conn, 'bad_request', 'No estás en un grupo.', msg.t);
    if (!conn.chatBucket.take()) return sendErr(conn, 'rate_limited', 'Vas muy rápido. Esperá un momento.', msg.t);
    const body = typeof msg.body === 'string' ? msg.body.trim() : '';
    if (!body || body.length > 500) return sendErr(conn, 'bad_request', 'El mensaje debe tener entre 1 y 500 caracteres.', msg.t);
    const row = await db.one(
      'insert into group_messages (group_id, user_id, body) values ($1, $2, $3) returning id, created_at',
      [conn.group.id, conn.user.id, body],
    );
    if (row.id % 50 === 0) {
      await db.query(
        `delete from group_messages where group_id = $1 and id < (
           select id from group_messages where group_id = $1 order by id desc offset 500 limit 1)`,
        [conn.group.id],
      );
    }
    broadcast(groupRooms.get(conn.group.id), {
      t: 'group:chat', id: row.id, userId: conn.user.id, name: conn.user.display_name, body, at: row.created_at,
    });
  }

  /* ---------- lienzo compartido ---------- */

  async function getDrawRoom(id) {
    let room = drawRooms.get(id);
    if (room) return room;
    const row = await db.one('select id, name, snapshot from draw_rooms where id = $1', [id]);
    if (!row) return null;
    room = drawRooms.get(id) || { id, name: row.name, clients: new Set(), snapshot: row.snapshot, chunks: [], seq: 0, dirty: false, lastSnapshotAt: 0 };
    drawRooms.set(id, room);
    return room;
  }

  function leaveDraw(conn) {
    if (!conn.draw) return;
    const room = conn.draw;
    conn.draw = null;
    room.clients.delete(conn);
    broadcast(room.clients, { t: 'draw:peers', n: room.clients.size });
  }

  async function joinDraw(conn, msg) {
    if (!conn.user) return sendErr(conn, 'auth_required', 'Iniciá sesión para dibujar con otras personas.', msg.t);
    const room = await getDrawRoom(String(msg.room || ''));
    if (!room) return sendErr(conn, 'not_found', 'Ese lienzo no existe.', msg.t);
    leaveDraw(conn);
    conn.draw = room;
    room.clients.add(conn);
    send(conn, { t: 'draw:init', room: room.id, name: room.name, snapshot: room.snapshot, chunks: room.chunks, seq: room.seq, n: room.clients.size });
    broadcast(room.clients, { t: 'draw:peers', n: room.clients.size }, conn);
  }

  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  function validStroke(m) {
    if (typeof m.sid !== 'string' || m.sid.length > 24) return false;
    if (m.tool !== 'brush' && m.tool !== 'eraser') return false;
    if (typeof m.color !== 'string' || !COLOR_RE.test(m.color)) return false;
    if (!Number.isFinite(m.size) || m.size < 1 || m.size > 80) return false;
    if (!Array.isArray(m.pts) || m.pts.length < 1 || m.pts.length > 160) return false;
    return m.pts.every((p) => Array.isArray(p) && p.length === 2
      && Number.isFinite(p[0]) && Number.isFinite(p[1])
      && p[0] > -80 && p[0] < CANVAS_W + 80 && p[1] > -80 && p[1] < CANVAS_H + 80);
  }

  function drawStroke(conn, msg) {
    const room = conn.draw;
    if (!room) return sendErr(conn, 'bad_request', 'No estás en un lienzo.', msg.t);
    if (!conn.drawBucket.take()) return; // se descarta en silencio
    if (!validStroke(msg)) return sendErr(conn, 'bad_request', 'Trazo inválido.', msg.t);
    room.seq += 1;
    const chunk = {
      seq: room.seq, cid: conn.id, sid: msg.sid, tool: msg.tool, color: msg.color.toLowerCase(),
      size: msg.size, pts: msg.pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), end: !!msg.end,
    };
    room.chunks.push(chunk);
    if (room.chunks.length > MAX_CHUNKS) room.chunks.splice(0, room.chunks.length - MAX_CHUNKS);
    room.dirty = true;
    broadcast(room.clients, { t: 'draw:stroke', ...chunk }, conn);
  }

  async function drawClear(conn, msg) {
    const room = conn.draw;
    if (!room) return sendErr(conn, 'bad_request', 'No estás en un lienzo.', msg.t);
    room.seq += 1;
    room.chunks = [];
    room.snapshot = null;
    room.dirty = false;
    await db.query('update draw_rooms set snapshot = null, updated_at = now() where id = $1', [room.id]);
    broadcast(room.clients, { t: 'draw:clear', seq: room.seq, by: conn.user.display_name });
  }

  async function drawSnapshot(conn, msg) {
    const room = conn.draw;
    if (!room) return;
    const data = msg.dataUrl;
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > MAX_SNAPSHOT) return;
    if (Date.now() - room.lastSnapshotAt < 8000) return;
    const upTo = Number(msg.upToSeq);
    if (!Number.isInteger(upTo) || upTo < 0 || upTo > room.seq) return;
    room.lastSnapshotAt = Date.now();
    room.snapshot = data;
    room.chunks = room.chunks.filter((c) => c.seq > upTo);
    await db.query('update draw_rooms set snapshot = $2, updated_at = now() where id = $1', [room.id, data]);
  }

  // Cada 15 s se le pide una foto del lienzo a una persona conectada para poder
  // descartar trazos viejos y para que un lienzo sobreviva a un reinicio.
  timers.push(setInterval(() => {
    for (const room of drawRooms.values()) {
      if (!room.dirty || !room.clients.size) continue;
      room.dirty = false;
      const pick = [...room.clients][Math.floor(Math.random() * room.clients.size)];
      send(pick, { t: 'draw:snapshot_request', seq: room.seq });
    }
  }, 15_000));

  /* ---------- conexión ---------- */

  const handlers = {
    'group:join': joinGroup,
    'group:leave': (c) => leaveGroup(c),
    'group:nav': groupNav,
    'group:chat': groupChat,
    'draw:join': joinDraw,
    'draw:leave': (c) => leaveDraw(c),
    'draw:stroke': drawStroke,
    'draw:clear': drawClear,
    'draw:snapshot': drawSnapshot,
  };

  wss.on('connection', (ws, req, user) => {
    const conn = {
      ws, user, id: crypto.randomBytes(6).toString('hex'), group: null, draw: null, alive: true,
      bucket: new Bucket(25, 50), chatBucket: new Bucket(0.6, 6), drawBucket: new Bucket(60, 120),
    };
    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', async (raw, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') return send(conn, { t: 'pong' });
      if (msg.t !== 'draw:snapshot' && raw.length > 20_000) return sendErr(conn, 'too_large', 'Mensaje demasiado grande.', msg.t);
      if (msg.t !== 'draw:stroke' && !conn.bucket.take()) return;
      const handler = handlers[msg.t];
      if (!handler) return;
      try { await handler(conn, msg); } catch (err) {
        console.error('[ws]', msg.t, err.message);
        sendErr(conn, 'server_error', 'Algo salió mal.', msg.t);
      }
    });
    ws.on('close', () => {
      leaveGroup(conn);
      leaveDraw(conn);
      scheduleOnline();
    });
    ws.on('error', () => ws.terminate());
    send(conn, { t: 'welcome', cid: conn.id, user: publicUser(user), online: wss.clients.size });
    scheduleOnline();
  });

  server.on('upgrade', (req, socket, head) => {
    (async () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/ws') return socket.destroy();
      const origin = req.headers.origin;
      if (origin) {
        const ok = new URL(origin).host === req.headers.host || (config.publicOrigin && origin === config.publicOrigin);
        if (!ok) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
      }
      const user = await auth.userFromToken(auth.tokenFromCookieHeader(req.headers.cookie));
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
    })().catch(() => socket.destroy());
  });

  timers.push(setInterval(() => {
    for (const ws of wss.clients) {
      const conn = ws;
      if (conn.isDead) { ws.terminate(); continue; }
      conn.isDead = true;
      ws.once('pong', () => { conn.isDead = false; });
      ws.ping();
    }
  }, 30_000));

  /* ---------- gancho para las rutas HTTP ---------- */

  hub.onlineCount = () => wss.clients.size;
  hub.groupChanged = (gid) => {
    const room = groupRooms.get(gid);
    if (!room) return;
    for (const c of room) sendGroupState(c).catch(() => {});
  };
  hub.groupDeleted = (gid) => {
    const room = groupRooms.get(gid);
    if (!room) return;
    for (const c of [...room]) leaveGroup(c, 'deleted');
  };
  hub.memberRemoved = (gid, uid) => {
    const room = groupRooms.get(gid);
    if (!room) return;
    for (const c of [...room]) if (c.user.id === uid) leaveGroup(c, 'kicked');
  };
  hub.drawRooms = async () => {
    const rows = await db.many('select id, name from draw_rooms order by id');
    return rows.map((r) => ({ id: r.id, name: r.name, online: drawRooms.get(r.id)?.clients.size ?? 0 }));
  };

  async function close() {
    for (const t of timers) clearInterval(t);
    if (onlineTimer) clearTimeout(onlineTimer);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
  }

  return { wss, close };
}
