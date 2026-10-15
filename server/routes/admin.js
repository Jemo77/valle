import { Router } from 'express';
import { bad, conflict, id, notFound, num, oneOf, str, url } from '../lib/http.js';
import { naturalCompare, uniqueSlug } from '../lib/util.js';

const bool = (v) => v === true || v === 'true' || v === '1' || v === 1;

export function adminRoutes({ db, auth, storage, settings, hub }) {
  const r = Router();
  r.use(auth.requireAdmin);

  const seriesOut = (s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    originalTitle: s.original_title,
    author: s.author,
    sourceLang: s.source_lang,
    synopsis: s.synopsis,
    status: s.status,
    published: s.published,
    position: s.position,
    coverUrl: storage.urlFor(s.cover),
    chapterCount: s.chapter_count ?? 0,
    publishedChapters: s.published_chapters ?? 0,
    updatedAt: s.updated_at,
  });

  const chapterOut = (c) => ({
    id: c.id, seriesId: c.series_id, number: c.number, title: c.title, published: c.published,
    pageCount: c.page_count ?? 0, createdAt: c.created_at,
  });

  /* ---------- resumen ---------- */

  r.get('/stats', async (req, res) => {
    const row = await db.one(
      `select (select count(*) from series) as series,
              (select count(*) from chapters) as chapters,
              (select count(*) from pages) as pages,
              (select count(*) from projects) as projects,
              (select count(*) from users) as users,
              (select count(*) from reading_groups) as groups,
              (select count(*) from guestbook where not hidden) as guestbook`,
    );
    res.json({ stats: { ...row, online: hub.onlineCount?.() ?? 0 } });
  });

  /* ---------- sitio ---------- */

  r.get('/site', async (req, res) => res.json({ site: await settings.get() }));

  r.put('/site', async (req, res) => {
    const patch = {};
    if (req.body.name !== undefined) patch.name = str(req.body.name, { min: 1, max: 40, field: 'El nombre del sitio' });
    if (req.body.intro !== undefined) patch.intro = str(req.body.intro, { max: 600, field: 'El texto de bienvenida' });
    if (req.body.readRequiresLogin !== undefined) patch.readRequiresLogin = bool(req.body.readRequiresLogin);
    if (req.body.influences !== undefined) {
      if (!Array.isArray(req.body.influences) || req.body.influences.length > 8) throw bad('La lista de influencias no es válida.');
      patch.influences = req.body.influences.map((x) => ({
        kanji: str(x.kanji, { max: 2, field: 'El kanji' }),
        title: str(x.title, { min: 1, max: 60, field: 'El título' }),
        text: str(x.text, { max: 200, field: 'El texto' }),
      }));
    }
    res.json({ site: await settings.set(patch) });
  });

  /* ---------- series ---------- */

  function seriesFields(body, current = {}) {
    return {
      title: body.title !== undefined ? str(body.title, { min: 1, max: 120, field: 'El título' }) : current.title,
      original_title: body.originalTitle !== undefined ? str(body.originalTitle, { max: 120, field: 'El título original' }) : current.original_title ?? '',
      author: body.author !== undefined ? str(body.author, { max: 80, field: 'El autor' }) : current.author ?? '',
      source_lang: body.sourceLang !== undefined ? str(body.sourceLang, { min: 2, max: 5, field: 'El idioma' }).toLowerCase() : current.source_lang ?? 'ja',
      synopsis: body.synopsis !== undefined ? str(body.synopsis, { max: 1200, field: 'La sinopsis' }) : current.synopsis ?? '',
      status: body.status !== undefined ? oneOf(body.status, ['ongoing', 'completed', 'paused'], 'El estado') : current.status ?? 'ongoing',
      published: body.published !== undefined ? bool(body.published) : current.published ?? false,
      position: body.position !== undefined ? num(body.position, { min: 0, max: 9999, field: 'La posición' }) : current.position ?? 0,
    };
  }

  r.get('/series', async (req, res) => {
    const rows = await db.many(
      `select s.*, (select count(*) from chapters c where c.series_id = s.id) as chapter_count,
              (select count(*) from chapters c where c.series_id = s.id and c.published) as published_chapters
       from series s order by s.position, lower(s.title)`,
    );
    res.json({ series: rows.map(seriesOut) });
  });

  r.post('/series', async (req, res) => {
    const f = seriesFields(req.body);
    if (!f.title) throw bad('El título es obligatorio.');
    const slug = await uniqueSlug(db, 'series', f.title);
    const row = await db.one(
      `insert into series (slug, title, original_title, author, source_lang, synopsis, status, published, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [slug, f.title, f.original_title, f.author, f.source_lang, f.synopsis, f.status, f.published, f.position],
    );
    res.status(201).json({ series: seriesOut(row) });
  });

  r.patch('/series/:id', async (req, res) => {
    const sid = id(req.params.id);
    const cur = await db.one('select * from series where id = $1', [sid]);
    if (!cur) throw notFound('Esa serie no existe.');
    const f = seriesFields(req.body, cur);
    const row = await db.one(
      `update series set title = $2, original_title = $3, author = $4, source_lang = $5, synopsis = $6,
         status = $7, published = $8, position = $9, updated_at = now() where id = $1 returning *`,
      [sid, f.title, f.original_title, f.author, f.source_lang, f.synopsis, f.status, f.published, f.position],
    );
    res.json({ series: seriesOut(row) });
  });

  r.delete('/series/:id', async (req, res) => {
    const sid = id(req.params.id);
    const cur = await db.one('select id from series where id = $1', [sid]);
    if (!cur) throw notFound('Esa serie no existe.');
    await db.query('delete from series where id = $1', [sid]);
    await storage.removeDir(`series/${sid}`);
    res.json({ ok: true });
  });

  r.post('/series/:id/cover', storage.upload.single('cover'), async (req, res) => {
    const sid = id(req.params.id);
    try {
      if (!req.file) throw bad('Elegí una imagen para la portada.');
      const cur = await db.one('select cover from series where id = $1', [sid]);
      if (!cur) throw notFound('Esa serie no existe.');
      const saved = await storage.saveImage(req.file, `series/${sid}`, 'cover-');
      await db.query('update series set cover = $2, updated_at = now() where id = $1', [sid, saved.rel]);
      await storage.remove(cur.cover);
      res.json({ coverUrl: storage.urlFor(saved.rel) });
    } finally {
      await storage.discard([req.file].filter(Boolean));
    }
  });

  /* ---------- capítulos ---------- */

  const CHAPTER_SELECT = `select c.*, (select count(*) from pages p where p.chapter_id = c.id) as page_count from chapters c`;

  r.get('/series/:id/chapters', async (req, res) => {
    const sid = id(req.params.id);
    const rows = await db.many(`${CHAPTER_SELECT} where c.series_id = $1 order by c.number`, [sid]);
    res.json({ chapters: rows.map(chapterOut) });
  });

  r.post('/series/:id/chapters', async (req, res) => {
    const sid = id(req.params.id);
    if (!(await db.one('select 1 from series where id = $1', [sid]))) throw notFound('Esa serie no existe.');
    const number = num(req.body.number, { min: 0, max: 99999, field: 'El número de capítulo' });
    const title = str(req.body.title, { max: 120, field: 'El título del capítulo' });
    const published = bool(req.body.published);
    const dup = await db.one('select 1 from chapters where series_id = $1 and number = $2', [sid, number]);
    if (dup) throw conflict(`Ya existe el capítulo ${number} en esta serie.`);
    const row = await db.one(
      'insert into chapters (series_id, number, title, published) values ($1, $2, $3, $4) returning *',
      [sid, number, title, published],
    );
    res.status(201).json({ chapter: chapterOut({ ...row, page_count: 0 }) });
  });

  r.patch('/chapters/:id', async (req, res) => {
    const cid = id(req.params.id);
    const cur = await db.one('select * from chapters where id = $1', [cid]);
    if (!cur) throw notFound('Ese capítulo no existe.');
    const number = req.body.number !== undefined ? num(req.body.number, { min: 0, max: 99999, field: 'El número de capítulo' }) : cur.number;
    const title = req.body.title !== undefined ? str(req.body.title, { max: 120, field: 'El título del capítulo' }) : cur.title;
    const published = req.body.published !== undefined ? bool(req.body.published) : cur.published;
    if (number !== cur.number) {
      const dup = await db.one('select 1 from chapters where series_id = $1 and number = $2 and id <> $3', [cur.series_id, number, cid]);
      if (dup) throw conflict(`Ya existe el capítulo ${number} en esta serie.`);
    }
    await db.query('update chapters set number = $2, title = $3, published = $4 where id = $1', [cid, number, title, published]);
    const row = await db.one(`${CHAPTER_SELECT} where c.id = $1`, [cid]);
    res.json({ chapter: chapterOut(row) });
  });

  r.delete('/chapters/:id', async (req, res) => {
    const cid = id(req.params.id);
    const cur = await db.one('select series_id from chapters where id = $1', [cid]);
    if (!cur) throw notFound('Ese capítulo no existe.');
    await db.query('delete from chapters where id = $1', [cid]);
    await storage.removeDir(`series/${cur.series_id}/${cid}`);
    res.json({ ok: true });
  });

  /* ---------- páginas ---------- */

  const pageOut = (p) => ({ id: p.id, position: p.position, url: storage.urlFor(p.file), width: p.width, height: p.height });

  r.get('/chapters/:id/pages', async (req, res) => {
    const cid = id(req.params.id);
    const rows = await db.many('select * from pages where chapter_id = $1 order by position', [cid]);
    res.json({ pages: rows.map(pageOut) });
  });

  r.post('/chapters/:id/pages', storage.upload.array('pages', 120), async (req, res) => {
    const cid = id(req.params.id);
    const files = req.files || [];
    try {
      const cur = await db.one('select series_id from chapters where id = $1', [cid]);
      if (!cur) throw notFound('Ese capítulo no existe.');
      if (!files.length) throw bad('No llegó ninguna imagen.');
      // Si el cliente manda "sort=name", se ordenan por nombre natural (2 antes que 10).
      const ordered = req.body.sort === 'name'
        ? [...files].sort((a, b) => naturalCompare(a.originalname, b.originalname))
        : files;
      const saved = [];
      for (const f of ordered) saved.push(await storage.saveImage(f, `series/${cur.series_id}/${cid}`));
      const added = await db.tx(async (t) => {
        const max = await t.one('select coalesce(max(position), -1) as m from pages where chapter_id = $1', [cid]);
        const out = [];
        for (let i = 0; i < saved.length; i += 1) {
          out.push(await t.one(
            'insert into pages (chapter_id, position, file, width, height) values ($1, $2, $3, $4, $5) returning *',
            [cid, max.m + 1 + i, saved[i].rel, saved[i].width, saved[i].height],
          ));
        }
        return out;
      });
      res.status(201).json({ pages: added.map(pageOut) });
    } finally {
      await storage.discard(files);
    }
  });

  r.put('/chapters/:id/pages/order', async (req, res) => {
    const cid = id(req.params.id);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => id(x, 'página')) : null;
    if (!ids) throw bad('Falta el orden de las páginas.');
    await db.tx(async (t) => {
      const current = (await t.many('select id from pages where chapter_id = $1', [cid])).map((p) => p.id).sort((a, b) => a - b);
      const given = [...ids].sort((a, b) => a - b);
      if (current.length !== given.length || current.some((v, i) => v !== given[i])) throw bad('El orden no coincide con las páginas del capítulo.');
      for (let i = 0; i < ids.length; i += 1) await t.query('update pages set position = $2 where id = $1', [ids[i], i]);
    });
    const rows = await db.many('select * from pages where chapter_id = $1 order by position', [cid]);
    res.json({ pages: rows.map(pageOut) });
  });

  r.delete('/pages/:id', async (req, res) => {
    const pid = id(req.params.id);
    const p = await db.one('select * from pages where id = $1', [pid]);
    if (!p) throw notFound('Esa página no existe.');
    await db.tx(async (t) => {
      await t.query('delete from pages where id = $1', [pid]);
      await t.query(
        `update pages set position = sub.rn - 1
         from (select id, row_number() over (order by position) as rn from pages where chapter_id = $1) sub
         where pages.id = sub.id`,
        [p.chapter_id],
      );
    });
    await storage.remove(p.file);
    res.json({ ok: true });
  });

  /* ---------- proyectos ---------- */

  const projectOut = (p) => ({
    id: p.id, slug: p.slug, name: p.name, description: p.description, stage: p.stage, tags: p.tags,
    url: p.url, visible: p.visible, position: p.position,
  });

  function projectFields(body, cur = {}) {
    let tags = cur.tags ?? [];
    if (body.tags !== undefined) {
      const list = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',');
      tags = list.map((t) => str(t, { max: 24, field: 'Una etiqueta' })).filter(Boolean).slice(0, 8);
    }
    return {
      name: body.name !== undefined ? str(body.name, { min: 1, max: 80, field: 'El nombre' }) : cur.name,
      description: body.description !== undefined ? str(body.description, { max: 400, field: 'La descripción' }) : cur.description ?? '',
      stage: body.stage !== undefined ? oneOf(body.stage, ['semilla', 'brote', 'crecido'], 'La etapa') : cur.stage ?? 'semilla',
      tags,
      url: body.url !== undefined ? url(body.url, 'El enlace') : cur.url ?? '',
      visible: body.visible !== undefined ? bool(body.visible) : cur.visible ?? true,
      position: body.position !== undefined ? num(body.position, { min: 0, max: 9999, field: 'La posición' }) : cur.position ?? 0,
    };
  }

  r.get('/projects', async (req, res) => {
    const rows = await db.many('select * from projects order by position, id');
    res.json({ projects: rows.map(projectOut) });
  });

  r.post('/projects', async (req, res) => {
    const f = projectFields(req.body);
    if (!f.name) throw bad('El nombre es obligatorio.');
    const slug = await uniqueSlug(db, 'projects', f.name);
    const row = await db.one(
      `insert into projects (slug, name, description, stage, tags, url, visible, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [slug, f.name, f.description, f.stage, f.tags, f.url, f.visible, f.position],
    );
    res.status(201).json({ project: projectOut(row) });
  });

  r.patch('/projects/:id', async (req, res) => {
    const pid = id(req.params.id);
    const cur = await db.one('select * from projects where id = $1', [pid]);
    if (!cur) throw notFound('Ese proyecto no existe.');
    const f = projectFields(req.body, cur);
    const row = await db.one(
      `update projects set name = $2, description = $3, stage = $4, tags = $5, url = $6, visible = $7, position = $8
       where id = $1 returning *`,
      [pid, f.name, f.description, f.stage, f.tags, f.url, f.visible, f.position],
    );
    res.json({ project: projectOut(row) });
  });

  r.delete('/projects/:id', async (req, res) => {
    const pid = id(req.params.id);
    const del = await db.query('delete from projects where id = $1', [pid]);
    if (!del.rowCount) throw notFound('Ese proyecto no existe.');
    res.json({ ok: true });
  });

  /* ---------- libro de visitas ---------- */

  r.get('/guestbook', async (req, res) => {
    const rows = await db.many('select * from guestbook order by id desc limit 200');
    res.json({
      entries: rows.map((g) => ({ id: g.id, author: g.author, body: g.body, hidden: g.hidden, createdAt: g.created_at })),
    });
  });

  r.patch('/guestbook/:id', async (req, res) => {
    const gid = id(req.params.id);
    const upd = await db.query('update guestbook set hidden = $2 where id = $1', [gid, bool(req.body.hidden)]);
    if (!upd.rowCount) throw notFound('Esa huella no existe.');
    res.json({ ok: true });
  });

  r.delete('/guestbook/:id', async (req, res) => {
    const gid = id(req.params.id);
    await db.query('delete from guestbook where id = $1', [gid]);
    res.json({ ok: true });
  });

  /* ---------- usuarios y grupos ---------- */

  r.get('/users', async (req, res) => {
    const rows = await db.many('select id, username, display_name, role, disabled, created_at from users order by id');
    res.json({
      users: rows.map((u) => ({
        id: u.id, username: u.username, name: u.display_name, role: u.role, disabled: u.disabled, createdAt: u.created_at,
      })),
    });
  });

  r.patch('/users/:id', async (req, res) => {
    const uid = id(req.params.id);
    const cur = await db.one('select * from users where id = $1', [uid]);
    if (!cur) throw notFound('Ese usuario no existe.');
    const role = req.body.role !== undefined ? oneOf(req.body.role, ['reader', 'admin'], 'El rol') : cur.role;
    const disabled = req.body.disabled !== undefined ? bool(req.body.disabled) : cur.disabled;
    if (uid === req.user.id && (role !== 'admin' || disabled)) throw conflict('No podés quitarte el acceso a vos mismo.');
    await db.query('update users set role = $2, disabled = $3 where id = $1', [uid, role, disabled]);
    if (disabled) await db.query('delete from sessions where user_id = $1', [uid]);
    res.json({ ok: true });
  });

  r.get('/groups', async (req, res) => {
    const rows = await db.many(
      `select g.id, g.name, g.visibility, g.created_at, u.display_name as owner_name,
              (select count(*) from group_members m where m.group_id = g.id) as member_count
       from reading_groups g join users u on u.id = g.owner_id order by g.id desc limit 200`,
    );
    res.json({
      groups: rows.map((g) => ({
        id: g.id, name: g.name, visibility: g.visibility, ownerName: g.owner_name, memberCount: g.member_count, createdAt: g.created_at,
      })),
    });
  });

  r.delete('/groups/:id', async (req, res) => {
    const gid = id(req.params.id);
    await db.query('delete from reading_groups where id = $1', [gid]);
    hub.groupDeleted?.(gid);
    res.json({ ok: true });
  });

  return r;
}
