export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

export const bad = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = 'Necesitás iniciar sesión.') => new HttpError(401, msg, 'auth_required');
export const forbidden = (msg = 'No tenés permiso para hacer esto.') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'No encontrado.') => new HttpError(404, msg, 'not_found');
export const conflict = (msg) => new HttpError(409, msg, 'conflict');

/* ---------- validación mínima ---------- */

export function str(value, { min = 0, max = 500, field = 'campo', trim = true } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`${field} debe ser texto.`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw bad(min === 1 ? `${field} es obligatorio.` : `${field} es demasiado corto.`);
  if (v.length > max) throw bad(`${field} es demasiado largo (máximo ${max}).`);
  return v;
}

export function int(value, { min = -Infinity, max = Infinity, field = 'número' } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} no es válido.`);
  return n;
}

export function num(value, { min = -Infinity, max = Infinity, field = 'número' } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw bad(`${field} no es válido.`);
  return n;
}

export function oneOf(value, list, field = 'valor') {
  if (!list.includes(value)) throw bad(`${field} no es válido.`);
  return value;
}

export function id(value, field = 'id') {
  return int(value, { min: 1, max: Number.MAX_SAFE_INTEGER, field });
}

/** Solo se aceptan enlaces http(s) o vacíos. */
export function url(value, field = 'enlace') {
  const v = str(value, { max: 500, field });
  if (!v) return '';
  let u;
  try { u = new URL(v); } catch { throw bad(`${field} no es una dirección válida.`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad(`${field} debe empezar con http:// o https://.`);
  return u.toString();
}

/* ---------- limitador de ritmo en memoria ---------- */

export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  const check = (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n += 1;
    return h.n <= max;
  };
  check.stop = () => clearInterval(timer);
  return check;
}

export function limitMiddleware(limiter, message = 'Demasiados intentos. Esperá un momento.') {
  return (req, res, next) => {
    if (!limiter(req.ip)) return next(new HttpError(429, message, 'rate_limited'));
    next();
  };
}

/* ---------- defensa CSRF: el origen debe coincidir con el sitio ---------- */

export function sameOrigin(config) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    if (!origin) return next(); // clientes que no son navegadores
    try {
      const o = new URL(origin);
      const host = req.get('host');
      if (o.host === host) return next();
      if (config.publicOrigin && origin === config.publicOrigin) return next();
    } catch { /* origen ilegible */ }
    next(new HttpError(403, 'Origen no permitido.', 'bad_origin'));
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
