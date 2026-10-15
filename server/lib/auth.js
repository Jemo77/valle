import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { forbidden, parseCookies, unauthorized } from './http.js';

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;
const COOKIE = 'valle_sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function publicUser(u) {
  return u ? { id: u.id, username: u.username, name: u.display_name, role: u.role } : null;
}

export function createAuth({ db, config }) {
  async function userFromToken(token) {
    if (!token) return null;
    return db.one(
      `select u.* from sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now() and not u.disabled`,
      [sha256(token)],
    );
  }

  async function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + config.sessionDays * 86400_000);
    await db.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [
      sha256(token), userId, expires,
    ]);
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires, path: '/',
    });
  }

  async function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await db.query('delete from sessions where token_hash = $1', [sha256(token)]);
    res.clearCookie(COOKIE, { path: '/' });
  }

  /** Carga req.user (o null) en cada pedido. */
  async function loadUser(req, res, next) {
    try {
      req.user = await userFromToken(parseCookies(req.headers.cookie)[COOKIE]);
      next();
    } catch (e) { next(e); }
  }

  const requireUser = (req, res, next) => (req.user ? next() : next(unauthorized()));
  const requireAdmin = (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== 'admin') return next(forbidden('Esta zona es solo para la administración.'));
    next();
  };

  async function cleanup() {
    await db.query('delete from sessions where expires_at < now()');
  }

  return {
    userFromToken, startSession, endSession, loadUser, requireUser, requireAdmin, cleanup,
    tokenFromCookieHeader: (h) => parseCookies(h)[COOKIE],
  };
}
