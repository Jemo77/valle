import { Router } from 'express';
import { bad, conflict, forbidden, id, notFound, oneOf, str } from '../lib/http.js';
import { inviteCode } from '../lib/util.js';

const GROUP_SELECT = `
  select g.*, u.display_name as owner_name, s.title as series_title,
         (select count(*) from group_members m where m.group_id = g.id) as member_count,
         exists (select 1 from group_members m where m.group_id = g.id and m.user_id = $1) as is_member,
         gs.chapter_id as state_chapter, gs.page as state_page,
         c.number as chapter_number, c.title as chapter_title
  from reading_groups g
  join users u on u.id = g.owner_id
  left join series s on s.id = g.series_id
  left join group_state gs on gs.group_id = g.id
  left join chapters c on c.id = gs.chapter_id`;

export function groupOut(g, userId) {
  const isOwner = g.owner_id === userId;
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    ownerId: g.owner_id,
    ownerName: g.owner_name,
    seriesId: g.series_id,
    seriesTitle: g.series_title,
    visibility: g.visibility,
    control: g.control,
    memberCount: g.member_count,
    isMember: g.is_member,
    isOwner,
    inviteCode: g.is_member ? g.invite_code : null,
    chapterId: g.state_chapter,
    chapterNumber: g.chapter_number,
    chapterTitle: g.chapter_title,
    page: g.state_page ?? 0,
    createdAt: g.created_at,
  };
}

export function groupRoutes({ db, auth, hub }) {
  const r = Router();

  async function loadGroup(groupId, userId) {
    return db.one(`${GROUP_SELECT} where g.id = $2`, [userId, groupId]);
  }

  async function validateChapter(client, seriesId, chapterId) {
    if (chapterId == null) return null;
    const row = await client.one(
      `select c.id from chapters c join series s on s.id = c.series_id
       where c.id = $1 and c.published and s.published and ($2::bigint is null or c.series_id = $2)`,
      [chapterId, seriesId],
    );
    if (!row) throw bad('Ese capítulo no está disponible.');
    return row.id;
  }

  r.get('/', async (req, res) => {
    const uid = req.user?.id ?? 0;
    const rows = await db.many(
      `${GROUP_SELECT} where g.visibility = 'public' or exists (
         select 1 from group_members m where m.group_id = g.id and m.user_id = $1)
       order by is_member desc, g.created_at desc limit 100`,
      [uid],
    );
    res.json({ groups: rows.map((g) => groupOut(g, uid)) });
  });

  r.post('/', auth.requireUser, async (req, res) => {
    const name = str(req.body.name, { min: 2, max: 60, field: 'El nombre del grupo' });
    const description = str(req.body.description, { max: 200, field: 'La descripción' });
    const visibility = oneOf(req.body.visibility || 'public', ['public', 'private'], 'La visibilidad');
    const control = oneOf(req.body.control || 'guide', ['guide', 'everyone'], 'El control');
    const seriesId = req.body.seriesId ? id(req.body.seriesId, 'serie') : null;
    const chapterId = req.body.chapterId ? id(req.body.chapterId, 'capítulo') : null;

    const owned = await db.one('select count(*) as n from reading_groups where owner_id = $1', [req.user.id]);
    if (owned.n >= 10) throw conflict('Ya tenés 10 grupos. Borrá alguno para crear otro.');

    const groupId = await db.tx(async (t) => {
      if (seriesId) {
        const s = await t.one('select 1 from series where id = $1 and published', [seriesId]);
        if (!s) throw bad('Esa serie no está disponible.');
      }
      const chapter = await validateChapter(t, seriesId, chapterId);
      let code;
      for (let i = 0; i < 8 && !code; i += 1) {
        const candidate = inviteCode();
        if (!(await t.one('select 1 from reading_groups where invite_code = $1', [candidate]))) code = candidate;
      }
      const g = await t.one(
        `insert into reading_groups (name, description, owner_id, series_id, visibility, control, invite_code)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [name, description, req.user.id, seriesId, visibility, control, code],
      );
      await t.query(`insert into group_members (group_id, user_id, role) values ($1, $2, 'owner')`, [g.id, req.user.id]);
      await t.query('insert into group_state (group_id, chapter_id, page, updated_by) values ($1, $2, 0, $3)', [g.id, chapter, req.user.id]);
      return g.id;
    });
    res.status(201).json({ group: groupOut(await loadGroup(groupId, req.user.id), req.user.id) });
  });

  r.post('/join', auth.requireUser, async (req, res) => {
    const code = str(req.body.code, { min: 4, max: 16, field: 'El código' }).toUpperCase();
    const g = await db.one('select id from reading_groups where invite_code = $1', [code]);
    if (!g) throw notFound('No encontramos un grupo con ese código.');
    await db.query(
      `insert into group_members (group_id, user_id) values ($1, $2) on conflict do nothing`,
      [g.id, req.user.id],
    );
    hub.groupChanged?.(g.id);
    res.json({ group: groupOut(await loadGroup(g.id, req.user.id), req.user.id) });
  });

  r.get('/:id', auth.requireUser, async (req, res) => {
    const gid = id(req.params.id);
    const g = await loadGroup(gid, req.user.id);
    if (!g || (!g.is_member && g.visibility === 'private')) throw notFound('Ese grupo no existe.');
    const members = await db.many(
      `select u.id, u.display_name, m.role from group_members m join users u on u.id = m.user_id
       where m.group_id = $1 order by m.joined_at`,
      [gid],
    );
    const messages = g.is_member
      ? await db.many(
        `select m.id, m.user_id, coalesce(u.display_name, 'alguien') as name, m.body, m.created_at
         from group_messages m left join users u on u.id = m.user_id
         where m.group_id = $1 order by m.id desc limit 50`,
        [gid],
      )
      : [];
    res.json({
      group: groupOut(g, req.user.id),
      members: members.map((m) => ({ id: m.id, name: m.display_name, role: m.role })),
      messages: messages.reverse().map((m) => ({ id: m.id, userId: m.user_id, name: m.name, body: m.body, at: m.created_at })),
    });
  });

  r.post('/:id/join', auth.requireUser, async (req, res) => {
    const gid = id(req.params.id);
    const g = await db.one('select id, visibility from reading_groups where id = $1', [gid]);
    if (!g) throw notFound('Ese grupo no existe.');
    if (g.visibility !== 'public') throw forbidden('Este grupo es privado: necesitás el código de invitación.');
    await db.query(`insert into group_members (group_id, user_id) values ($1, $2) on conflict do nothing`, [gid, req.user.id]);
    hub.groupChanged?.(gid);
    res.json({ group: groupOut(await loadGroup(gid, req.user.id), req.user.id) });
  });

  r.post('/:id/leave', auth.requireUser, async (req, res) => {
    const gid = id(req.params.id);
    const g = await db.one('select owner_id from reading_groups where id = $1', [gid]);
    if (!g) throw notFound('Ese grupo no existe.');
    if (g.owner_id === req.user.id) throw conflict('Quien creó el grupo no puede irse: borralo si ya no lo querés.');
    await db.query('delete from group_members where group_id = $1 and user_id = $2', [gid, req.user.id]);
    hub.memberRemoved?.(gid, req.user.id);
    res.json({ ok: true });
  });

  r.patch('/:id', auth.requireUser, async (req, res) => {
    const gid = id(req.params.id);
    const g = await db.one('select * from reading_groups where id = $1', [gid]);
    if (!g) throw notFound('Ese grupo no existe.');
    if (g.owner_id !== req.user.id) throw forbidden('Solo quien creó el grupo puede cambiarlo.');
    const name = req.body.name !== undefined ? str(req.body.name, { min: 2, max: 60, field: 'El nombre del grupo' }) : g.name;
    const description = req.body.description !== undefined ? str(req.body.description, { max: 200, field: 'La descripción' }) : g.description;
    const visibility = req.body.visibility !== undefined ? oneOf(req.body.visibility, ['public', 'private'], 'La visibilidad') : g.visibility;
    const control = req.body.control !== undefined ? oneOf(req.body.control, ['guide', 'everyone'], 'El control') : g.control;
    const code = req.body.rotateCode ? inviteCode() : g.invite_code;
    await db.query(
      `update reading_groups set name = $2, description = $3, visibility = $4, control = $5, invite_code = $6 where id = $1`,
      [gid, name, description, visibility, control, code],
    );
    hub.groupChanged?.(gid);
    res.json({ group: groupOut(await loadGroup(gid, req.user.id), req.user.id) });
  });

  r.delete('/:id', auth.requireUser, async (req, res) => {
    const gid = id(req.params.id);
    const g = await db.one('select owner_id from reading_groups where id = $1', [gid]);
    if (!g) throw notFound('Ese grupo no existe.');
    if (g.owner_id !== req.user.id && req.user.role !== 'admin') throw forbidden('Solo quien creó el grupo puede borrarlo.');
    await db.query('delete from reading_groups where id = $1', [gid]);
    hub.groupDeleted?.(gid);
    res.json({ ok: true });
  });

  r.delete('/:id/members/:userId', auth.requireUser, async (req, res) => {
    const gid = id(req.params.id);
    const uid = id(req.params.userId);
    const g = await db.one('select owner_id from reading_groups where id = $1', [gid]);
    if (!g) throw notFound('Ese grupo no existe.');
    if (g.owner_id !== req.user.id) throw forbidden('Solo quien creó el grupo puede sacar a alguien.');
    if (uid === g.owner_id) throw bad('No podés sacarte a vos mismo.');
    await db.query('delete from group_members where group_id = $1 and user_id = $2', [gid, uid]);
    hub.memberRemoved?.(gid, uid);
    res.json({ ok: true });
  });

  return r;
}
