export const DEFAULT_SITE = {
  name: 'Valle Interior',
  intro:
    'Acá traduzco mangas que todavía no existen en español, dibujo y dejo mis proyectos web. Pasá, leé, dibujá con alguien o quedate mirando el horizonte.',
  influences: [
    { kanji: '命', title: 'Evangelion', text: 'La vida que insiste y pelea frente a la corrupción.' },
    { kanji: '空', title: 'Tsutomu Nihei', text: 'El espacio sin final y los lugares desolados de Blame!' },
    { kanji: '問', title: 'Yoshitoshi ABe', text: 'Preguntarse quiénes somos, en voz baja.' },
  ],
  readRequiresLogin: false,
};

export function createSettings(db) {
  let cache = null;
  let cachedAt = 0;

  async function get() {
    if (cache && Date.now() - cachedAt < 5000) return cache;
    const rows = await db.many('select key, value from settings');
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cache = { ...DEFAULT_SITE, ...stored };
    cachedAt = Date.now();
    return cache;
  }

  async function set(patch) {
    for (const [key, value] of Object.entries(patch)) {
      await db.query(
        `insert into settings (key, value) values ($1, $2::jsonb)
         on conflict (key) do update set value = excluded.value`,
        [key, JSON.stringify(value)],
      );
    }
    cache = null;
    return get();
  }

  return { get, set };
}
