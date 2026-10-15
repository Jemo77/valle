import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import WebSocket from 'ws';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createDb } from '../server/db.js';
import { migrate } from '../server/migrate.js';

export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/valle_test';

/** Levanta la app real contra una base limpia y devuelve utilidades para probarla. */
export async function startTestApp(extraEnv = {}) {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'valle-uploads-'));
  const config = loadConfig({ DATABASE_URL: TEST_DB, UPLOAD_DIR: uploadDir, RATE_AUTH_MAX: '1000', RATE_GUESTBOOK_MAX: '1000', ...extraEnv });
  const db = createDb(config.databaseUrl);
  await db.query('drop schema public cascade');
  await db.query('create schema public');
  await migrate(db, config.migrationsDir);
  const app = await createApp({ config, db });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  return {
    config, db, app, base, port, uploadDir,
    client: () => new Client(base),
    /** Otra instancia del servidor sobre la misma base, con ajustes distintos. */
    async extra(overrides = {}) {
      const other = await createApp({ config: { ...config, ...overrides }, db });
      await new Promise((resolve) => other.server.listen(0, '127.0.0.1', resolve));
      const otherBase = `http://127.0.0.1:${other.server.address().port}`;
      return { client: () => new Client(otherBase), stop: () => other.close() };
    },
    async stop() {
      await app.close();
      await db.close();
      await fs.rm(uploadDir, { recursive: true, force: true });
    },
  };
}

/** Cliente HTTP con "cookie jar" mínimo. */
export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }

  async req(method, url, body, { headers = {}, raw = false } = {}) {
    const opts = { method, headers: { ...headers } };
    if (this.cookie) opts.headers.cookie = this.cookie;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(this.base + url, opts);
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair] = c.split(';');
      if (pair.endsWith('=')) this.cookie = '';
      else this.cookie = pair;
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* no es JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }

  get(url, o) { return this.req('GET', url, undefined, o); }
  post(url, body, o) { return this.req('POST', url, body ?? {}, o); }
  put(url, body, o) { return this.req('PUT', url, body ?? {}, o); }
  patch(url, body, o) { return this.req('PATCH', url, body ?? {}, o); }
  del(url, o) { return this.req('DELETE', url, undefined, o); }

  async register(username, password = 'clave-segura-1', displayName) {
    const r = await this.post('/api/auth/register', { username, password, displayName });
    if (r.status !== 201) throw new Error(`register ${username}: ${r.status} ${r.text}`);
    return r.json.user;
  }

  async login(username, password = 'clave-segura-1') {
    const r = await this.post('/api/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${r.text}`);
    return r.json.user;
  }
}

/** Convierte una cuenta en admin directamente en la base (como lo haría create-admin). */
export async function makeAdmin(ctx, username) {
  await ctx.db.query(`update users set role = 'admin' where lower(username) = lower($1)`, [username]);
}

/* ---------- imágenes de prueba ---------- */

function crc32(buf) { return zlib.crc32(buf) >>> 0; }

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG RGBA sólido válido de w×h. */
export function makePng(w = 8, h = 12, rgba = [20, 40, 30, 255]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 4);
  for (let x = 0; x < w; x += 1) { row[1 + x * 4] = rgba[0]; row[2 + x * 4] = rgba[1]; row[3 + x * 4] = rgba[2]; row[4 + x * 4] = rgba[3]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pngForm(field, names, sizes = []) {
  const fd = new FormData();
  names.forEach((name, i) => {
    const [w, h] = sizes[i] || [8 + i, 12 + i];
    fd.append(field, new Blob([makePng(w, h)], { type: 'image/png' }), name);
  });
  return fd;
}

/* ---------- WebSocket ---------- */

export class WsClient {
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = this.waiters.findIndex((w) => w.match(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
  }

  static async connect(ctx, client) {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`, {
      headers: { ...(client?.cookie ? { cookie: client.cookie } : {}), origin: `http://127.0.0.1:${ctx.port}` },
    });
    const c = new WsClient(ws);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    c.welcome = await c.next('welcome');
    return c;
  }

  send(msg) { this.ws.send(JSON.stringify(msg)); }

  /** Espera el próximo mensaje de ese tipo (y, si se pasa, que cumpla `pred`). */
  next(type, timeout = 3000, pred = () => true) {
    const match = (m) => m.t === type && pred(m);
    const i = this.queue.findIndex(match);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando "${type}"`)), timeout);
      this.waiters.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  }

  /** Verifica que NO llegue un mensaje de ese tipo en `ms`. */
  async none(type, ms = 300) {
    await new Promise((r) => setTimeout(r, ms));
    return !this.queue.some((m) => m.t === type);
  }

  close() { this.ws.close(); }
}
