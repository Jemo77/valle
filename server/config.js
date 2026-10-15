import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(env = process.env) {
  const publicOrigin = (env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  return {
    root,
    port: Number(env.PORT) || 3000,
    databaseUrl: env.DATABASE_URL || 'postgres://valle:valle@localhost:5432/valle',
    uploadDir: path.resolve(env.UPLOAD_DIR || path.join(root, 'uploads')),
    webDir: path.join(root, 'web'),
    migrationsDir: path.join(root, 'db', 'migrations'),
    publicOrigin,
    cookieSecure: bool(env.COOKIE_SECURE, publicOrigin.startsWith('https://')),
    trustProxy: bool(env.TRUST_PROXY, false),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    autoMigrate: bool(env.AUTO_MIGRATE, true),
    maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || 15) * 1024 * 1024,
    sessionDays: Number(env.SESSION_DAYS) || 30,
    // Pedidos permitidos por minuto y por IP
    rate: {
      auth: Number(env.RATE_AUTH_MAX) || 12,
      guestbook: Number(env.RATE_GUESTBOOK_MAX) || 3,
    },
    adminUsername: env.ADMIN_USERNAME || '',
    adminPassword: env.ADMIN_PASSWORD || '',
  };
}
