import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db.js';

export async function migrate(db, dir) {
  await db.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await db.many('select name from schema_migrations')).map((r) => r.name));
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    await db.tx(async (t) => {
      await t.query(sql);
      await t.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    ran.push(file);
  }
  return ran;
}

// Ejecución directa: npm run migrate
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  try {
    const ran = await migrate(db, config.migrationsDir);
    console.log(ran.length ? `Migraciones aplicadas: ${ran.join(', ')}` : 'Base de datos al día.');
  } finally {
    await db.close();
  }
}
