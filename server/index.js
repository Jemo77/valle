import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { hashPassword } from './lib/auth.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);

async function waitForDb(tries = 30) {
  for (let i = 1; i <= tries; i += 1) {
    try { await db.query('select 1'); return; } catch (err) {
      if (i === tries) throw err;
      console.log(`Esperando a la base de datos (${i}/${tries})…`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Crea el primer administrador desde ADMIN_USERNAME / ADMIN_PASSWORD si todavía no hay ninguno. */
async function bootstrapAdmin() {
  if (!config.adminUsername || !config.adminPassword) return;
  const any = await db.one(`select 1 from users where role = 'admin' limit 1`);
  if (any) return;
  if (config.adminPassword.length < 8) {
    console.warn('ADMIN_PASSWORD tiene menos de 8 caracteres: no se creó el administrador.');
    return;
  }
  await db.query(
    `insert into users (username, display_name, password_hash, role) values ($1, $1, $2, 'admin')
     on conflict (lower(username)) do update set role = 'admin'`,
    [config.adminUsername, await hashPassword(config.adminPassword)],
  );
  console.log(`Administrador "${config.adminUsername}" creado.`);
}

await waitForDb();
if (config.autoMigrate) {
  const ran = await migrate(db, config.migrationsDir);
  if (ran.length) console.log(`Migraciones aplicadas: ${ran.join(', ')}`);
}
await bootstrapAdmin();

const { server, close } = await createApp({ config, db });
server.listen(config.port, async () => {
  console.log(`Valle Interior escuchando en http://localhost:${config.port}`);
  const admin = await db.one(`select 1 from users where role = 'admin' limit 1`).catch(() => null);
  if (!admin) {
    console.warn('Todavía no hay ninguna cuenta de administración. Creala con: npm run create-admin');
  }
});

async function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando…`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  await close().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
