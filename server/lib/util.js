import crypto from 'node:crypto';

export function slugify(text) {
  const s = String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'sin-titulo';
}

/** slug único dentro de una tabla (series o projects). */
export async function uniqueSlug(db, table, base, ignoreId = null) {
  const root = slugify(base);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const row = await db.one(`select id from ${table} where slug = $1 and ($2::bigint is null or id <> $2)`, [candidate, ignoreId]);
    if (!row) return candidate;
  }
  return `${root}-${crypto.randomBytes(3).toString('hex')}`;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function inviteCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export const naturalCompare = new Intl.Collator('es', { numeric: true, sensitivity: 'base' }).compare;
