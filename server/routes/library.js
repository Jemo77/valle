import { Router } from 'express';
import { bad, id, int, limitMiddleware, notFound, rateLimiter, str, unauthorized } from '../lib/http.js';

export function libraryRoutes({ db, auth, settings, storage, config }) {
  const r = Router();

  const seriesOut = (s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    originalTitle: s.original_title,
    author: s.author,
    sourceLang: s.source_lang,
    synopsis: s.synopsis,
    status: s.status,
    coverUrl: storage.urlFor(s.cover),
    chapterCount: s.chapter_count ?? 0,
    updatedAt: s.updated_at,
  });

  async function guardRead(req) {
    const site = await settings.get();
    if (site.readRequiresLogin && !req.user) throw unauthorized('Para leer hace falta una cuenta.');
  }

  r.get('/site', async (req, res) => {
    const site = await settings.get();
    res.json({
      name: site.name,
      intro: site.intro,
      influences: site.influences,
      readRequiresLogin: site.readRequiresLogin,
      allowRegistration: config.allowRegistration,
    });
  });

  r.get('/series', async (req, res) => {
    await guardRead(req);
    const rows = await db.many(
      `select s.*, (select count(*) from chapters c
                    where c.series_id = s.id and c.published
                      and exists (select 1 from pages p where p.chapter_id = c.id)) as chapter_count
       from series s where s.published order by s.position, lower(s.title)`,
    );
    res.json({ series: rows.map(seriesOut) });
  });

  r.get('/series/:id', async (req, res) => {
    await guardRead(req);
    const sid = id(req.params.id);
    const s = await db.one(`select * from series where id = $1 and published`, [sid]);
    if (!s) throw notFound('Esa serie no existe.');
    const chapters = await db.many(
      `select c.id, c.number, c.title, c.created_at, (select count(*) from pages p where p.chapter_id = c.id) as page_count
       from chapters c where c.series_id = $1 and c.published
         and exists (select 1 from pages p where p.chapter_id = c.id)
       order by c.number`,
      [sid],
    );
    res.json({
      series: { ...seriesOut(s), chapterCount: chapters.length },
      chapters: chapters.map((c) => ({ id: c.id, number: c.number, title: c.title, pageCount: c.page_count, createdAt: c.created_at })),
    });
  });

  r.get('/chapters/:id', async (req, res) => {
    await guardRead(req);
    const cid = id(req.params.id);
    const c = await db.one(
      `select c.*, s.title as series_title, s.id as sid from chapters c join series s on s.id = c.series_id
       where c.id = $1 and c.published and s.published`,
      [cid],
    );
    if (!c) throw notFound('Ese capítulo no existe.');
    const pages = await db.many('select id, file, width, height from pages where chapter_id = $1 order by position', [cid]);
    const siblings = await db.many(
      `select c2.id, c2.number from chapters c2
       where c2.series_id = $1 and c2.published and exists (select 1 from pages p where p.chapter_id = c2.id)
       order by c2.number`,
      [c.sid],
    );
    const idx = siblings.findIndex((x) => x.id === cid);
    res.json({
      chapter: {
        id: c.id, number: c.number, title: c.title, seriesId: c.sid, seriesTitle: c.series_title,
        pages: pages.map((p) => ({ id: p.id, url: storage.urlFor(p.file), width: p.width, height: p.height })),
        prevId: idx > 0 ? siblings[idx - 1].id : null,
        nextId: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null,
      },
    });
  });

  r.get('/latest', async (req, res) => {
    await guardRead(req);
    const rows = await db.many(
      `select c.id, c.number, c.title, c.created_at, s.id as series_id, s.title as series_title, s.cover
       from chapters c join series s on s.id = c.series_id
       where c.published and s.published and exists (select 1 from pages p where p.chapter_id = c.id)
       order by c.created_at desc limit 6`,
    );
    res.json({
      chapters: rows.map((c) => ({
        id: c.id, number: c.number, title: c.title, seriesId: c.series_id, seriesTitle: c.series_title,
        coverUrl: storage.urlFor(c.cover), createdAt: c.created_at,
      })),
    });
  });

  /* ---------- progreso de lectura ---------- */

  r.get('/progress', auth.requireUser, async (req, res) => {
    const rows = await db.many('select chapter_id, page from reading_progress where user_id = $1', [req.user.id]);
    res.json({ progress: Object.fromEntries(rows.map((p) => [p.chapter_id, p.page])) });
  });

  r.put('/progress', auth.requireUser, async (req, res) => {
    const chapterId = id(req.body.chapterId, 'capítulo');
    const page = int(req.body.page, { min: 0, max: 5000, field: 'página' });
    const exists = await db.one('select 1 from chapters where id = $1 and published', [chapterId]);
    if (!exists) throw notFound('Ese capítulo no existe.');
    await db.query(
      `insert into reading_progress (user_id, chapter_id, page) values ($1, $2, $3)
       on conflict (user_id, chapter_id) do update set page = excluded.page, updated_at = now()`,
      [req.user.id, chapterId, page],
    );
    res.json({ ok: true });
  });

  /* ---------- proyectos ---------- */

  r.get('/projects', async (req, res) => {
    const rows = await db.many('select * from projects where visible order by position, id');
    res.json({
      projects: rows.map((p) => ({ id: p.id, name: p.name, description: p.description, stage: p.stage, tags: p.tags, url: p.url })),
    });
  });

  /* ---------- libro de visitas ---------- */

  const guestLimit = limitMiddleware(rateLimiter({ windowMs: 60_000, max: config.rate.guestbook }), 'Esperá un momento antes de dejar otra huella.');

  r.get('/guestbook', async (req, res) => {
    const rows = await db.many('select id, author, body, created_at from guestbook where not hidden order by id desc limit 60');
    res.json({ entries: rows.map((g) => ({ id: g.id, author: g.author, body: g.body, createdAt: g.created_at })) });
  });

  r.post('/guestbook', guestLimit, async (req, res) => {
    if (req.body.website) throw bad('No se pudo enviar.'); // trampa para bots
    const body = str(req.body.body, { min: 1, max: 280, field: 'El mensaje' });
    const author = req.user ? req.user.display_name : str(req.body.name || 'visitante', { min: 1, max: 24, field: 'El nombre' });
    const row = await db.one(
      'insert into guestbook (user_id, author, body) values ($1, $2, $3) returning id, author, body, created_at',
      [req.user?.id ?? null, author, body],
    );
    res.status(201).json({ entry: { id: row.id, author: row.author, body: row.body, createdAt: row.created_at } });
  });

  r.get('/stats', async (req, res) => {
    const row = await db.one(
      `select (select count(*) from series where published) as series,
              (select count(*) from chapters c join series s on s.id = c.series_id where c.published and s.published) as chapters,
              (select count(*) from projects where visible) as projects`,
    );
    res.json(row);
  });

  return r;
}
