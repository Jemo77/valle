import { Router } from 'express';
import { hashPassword, publicUser, verifyPassword } from '../lib/auth.js';
import { bad, conflict, HttpError, limitMiddleware, rateLimiter, str } from '../lib/http.js';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

export function authRoutes({ db, auth, config }) {
  const r = Router();
  const authLimit = limitMiddleware(rateLimiter({ windowMs: 60_000, max: config.rate.auth }));

  r.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user), config: { allowRegistration: config.allowRegistration } });
  });

  r.post('/register', authLimit, async (req, res) => {
    if (!config.allowRegistration) throw new HttpError(403, 'El registro está cerrado por ahora.', 'registration_closed');
    const username = str(req.body.username, { min: 1, max: 24, field: 'El usuario' });
    const password = str(req.body.password, { min: 8, max: 200, field: 'La contraseña', trim: false });
    const displayName = str(req.body.displayName || username, { min: 1, max: 40, field: 'El nombre' });
    if (!USERNAME_RE.test(username)) throw bad('El usuario debe tener entre 3 y 24 letras, números, punto, guion o guion bajo.');
    const taken = await db.one('select 1 from users where lower(username) = lower($1)', [username]);
    if (taken) throw conflict('Ese usuario ya existe.');
    const user = await db.one(
      `insert into users (username, display_name, password_hash) values ($1, $2, $3) returning *`,
      [username, displayName, await hashPassword(password)],
    );
    await auth.startSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  r.post('/login', authLimit, async (req, res) => {
    const username = str(req.body.username, { min: 1, max: 24, field: 'El usuario' });
    const password = str(req.body.password, { min: 1, max: 200, field: 'La contraseña', trim: false });
    const user = await db.one('select * from users where lower(username) = lower($1)', [username]);
    const ok = user && !user.disabled && (await verifyPassword(password, user.password_hash));
    if (!ok) throw new HttpError(401, 'Usuario o contraseña incorrectos.', 'bad_credentials');
    await auth.startSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  r.post('/logout', async (req, res) => {
    await auth.endSession(req, res);
    res.json({ ok: true });
  });

  r.patch('/me', auth.requireUser, async (req, res) => {
    const displayName = str(req.body.displayName, { min: 1, max: 40, field: 'El nombre' });
    const user = await db.one('update users set display_name = $2 where id = $1 returning *', [req.user.id, displayName]);
    res.json({ user: publicUser(user) });
  });

  r.post('/password', authLimit, auth.requireUser, async (req, res) => {
    const current = str(req.body.current, { min: 1, max: 200, field: 'La contraseña actual', trim: false });
    const next = str(req.body.next, { min: 8, max: 200, field: 'La contraseña nueva', trim: false });
    if (!(await verifyPassword(current, req.user.password_hash))) throw new HttpError(401, 'La contraseña actual no coincide.', 'bad_credentials');
    await db.query('update users set password_hash = $2 where id = $1', [req.user.id, await hashPassword(next)]);
    await db.query('delete from sessions where user_id = $1', [req.user.id]);
    await auth.startSession(res, req.user.id);
    res.json({ ok: true });
  });

  return r;
}
