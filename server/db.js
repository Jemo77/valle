import pg from 'pg';

// numeric (1700) llega como número para que "12.50" sea 12.5 en el JSON.
pg.types.setTypeParser(1700, (v) => Number(v));
// bigint (20) como número: los ids nunca superan 2^53 en este proyecto.
pg.types.setTypeParser(20, (v) => Number(v));

export function createDb(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  pool.on('error', (err) => console.error('[pg] error en conexión inactiva:', err.message));

  const db = {
    pool,
    query: (text, params) => pool.query(text, params),
    async one(text, params) {
      const r = await pool.query(text, params);
      return r.rows[0] || null;
    },
    async many(text, params) {
      const r = await pool.query(text, params);
      return r.rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({
          query: (t, p) => client.query(t, p),
          one: async (t, p) => (await client.query(t, p)).rows[0] || null,
          many: async (t, p) => (await client.query(t, p)).rows,
        });
        await client.query('commit');
        return out;
      } catch (err) {
        try { await client.query('rollback'); } catch { /* conexión ya perdida */ }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}
