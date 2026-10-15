import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createAuth } from './lib/auth.js';
import { HttpError, sameOrigin, unauthorized } from './lib/http.js';
import { createSettings } from './lib/settings.js';
import { createStorage } from './lib/storage.js';
import { createRealtime } from './realtime.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { groupRoutes } from './routes/groups.js';
import { libraryRoutes } from './routes/library.js';

export async function createApp({ config, db }) {
  const app = express();
  const hub = {};
  const auth = createAuth({ db, config });
  const storage = createStorage(config);
  const settings = createSettings(db);
  await storage.init();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    });
    next();
  });

  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', sameOrigin(config));
  app.use('/api', auth.loadUser);
  app.use('/api', (req, res, next) => { req.body ??= {}; res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', async (req, res) => {
    await db.query('select 1');
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes({ db, auth, config }));
  app.use('/api/admin', adminRoutes({ db, auth, storage, settings, hub }));
  app.use('/api/groups', groupRoutes({ db, auth, hub }));
  app.get('/api/draw/rooms', async (req, res) => {
    res.json({ rooms: (await hub.drawRooms?.()) ?? [] });
  });
  app.use('/api', libraryRoutes({ db, auth, settings, storage, config }));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'Ruta no encontrada.', 'not_found')));

  /* ---------- archivos subidos ---------- */

  app.use('/media', auth.loadUser, async (req, res, next) => {
    try {
      const site = await settings.get();
      if (site.readRequiresLogin && !req.user) return next(unauthorized('Para ver esto hace falta una cuenta.'));
      next();
    } catch (e) { next(e); }
  }, express.static(config.uploadDir, {
    dotfiles: 'deny', index: false, maxAge: '30d', immutable: true,
    setHeaders: (res) => res.set('Content-Disposition', 'inline'),
  }));

  /* ---------- sitio ---------- */

  const sendPage = (file) => (req, res) => res.sendFile(path.join(config.webDir, file));
  app.use('/admin', auth.loadUser);
  app.get('/admin', (req, res, next) => (req.originalUrl.split('?')[0] === '/admin' ? res.redirect(301, '/admin/') : next()));
  app.use(express.static(config.webDir, { extensions: ['html'], maxAge: '5m' }));
  app.get('/', sendPage('index.html'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { message: err.message, code: err.code } });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: { message: `Una imagen supera el máximo de ${Math.round(config.maxUploadBytes / 1048576)} MB.`, code: 'too_large' } });
    }
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: { message: 'Demasiados archivos en un mismo envío.', code: 'bad_request' } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { message: 'El pedido no es JSON válido.', code: 'bad_request' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { message: 'El pedido es demasiado grande.', code: 'too_large' } });
    }
    console.error('[error]', req.method, req.originalUrl, err);
    res.status(500).json({ error: { message: 'Algo salió mal de nuestro lado.', code: 'server_error' } });
  });

  const server = http.createServer(app);
  const realtime = createRealtime({ server, db, auth, config, hub });
  const cleanupTimer = setInterval(() => auth.cleanup().catch(() => {}), 6 * 3600_000);
  cleanupTimer.unref();

  async function close() {
    clearInterval(cleanupTimer);
    await realtime.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return { app, server, hub, close, settings, storage, auth };
}
