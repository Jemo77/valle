// Uso: npm run create-admin -- <usuario> [contraseña]
// Si no pasás la contraseña, se pide por la terminal. Si el usuario existe, lo convierte en admin y cambia su contraseña.
import readline from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { createDb } from '../db.js';
import { hashPassword } from '../lib/auth.js';
import { migrate } from '../migrate.js';

const [username, passwordArg] = process.argv.slice(2);
if (!username) {
  console.error('Uso: npm run create-admin -- <usuario> [contraseña]');
  process.exit(1);
}

let password = passwordArg;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Contraseña (mínimo 8 caracteres): ');
  rl.close();
}
if (!password || password.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  await migrate(db, config.migrationsDir);
  await db.query(
    `insert into users (username, display_name, password_hash, role) values ($1, $1, $2, 'admin')
     on conflict (lower(username)) do update set role = 'admin', password_hash = excluded.password_hash, disabled = false`,
    [username, await hashPassword(password)],
  );
  console.log(`Listo: "${username}" es administrador.`);
} finally {
  await db.close();
}
