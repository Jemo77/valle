import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { makeAdmin, makePng, pngForm, startTestApp } from './helpers.js';

let ctx;
let admin;
let reader;
let anon;

before(async () => {
  ctx = await startTestApp();
  admin = ctx.client();
  reader = ctx.client();
  anon = ctx.client();
  await admin.register('mei');
  await makeAdmin(ctx, 'mei');
  await reader.register('lector1');
});
after(async () => { await ctx.stop(); });

describe('salud y sitio', () => {
  it('responde /api/health y /api/site con valores por defecto', async () => {
    assert.equal((await anon.get('/api/health')).json.ok, true);
    const site = (await anon.get('/api/site')).json;
    assert.equal(site.name, 'Valle Interior');
    assert.equal(site.influences.length, 3);
    assert.equal(site.readRequiresLogin, false);
  });

  it('sirve el HTML y envía cabeceras de seguridad', async () => {
    const res = await anon.get('/', { raw: true });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  });
});

describe('cuentas', () => {
  it('valida el registro', async () => {
    assert.equal((await anon.post('/api/auth/register', { username: 'a', password: 'clave-segura-1' })).status, 400);
    assert.equal((await anon.post('/api/auth/register', { username: 'valido', password: 'corta' })).status, 400);
    assert.equal((await anon.post('/api/auth/register', { username: 'con espacio', password: 'clave-segura-1' })).status, 400);
    const dup = await anon.post('/api/auth/register', { username: 'LECTOR1', password: 'clave-segura-1' });
    assert.equal(dup.status, 409);
  });

  it('inicia y cierra sesión con cookie httpOnly', async () => {
    const c = ctx.client();
    const res = await c.post('/api/auth/login', { username: 'lector1', password: 'clave-segura-1' }, { raw: true });
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    c.cookie = cookie.split(';')[0];
    assert.equal((await c.get('/api/auth/me')).json.user.username, 'lector1');
    await c.post('/api/auth/logout');
    c.cookie = cookie.split(';')[0]; // reutilizar el token viejo ya no sirve
    assert.equal((await c.get('/api/auth/me')).json.user, null);
  });

  it('rechaza credenciales incorrectas sin revelar cuál falló', async () => {
    const a = await anon.post('/api/auth/login', { username: 'lector1', password: 'incorrecta1' });
    const b = await anon.post('/api/auth/login', { username: 'noexiste', password: 'incorrecta1' });
    assert.equal(a.status, 401);
    assert.equal(a.json.error.message, b.json.error.message);
  });

  it('cambia la contraseña y cierra las otras sesiones', async () => {
    const c = ctx.client();
    await c.register('cambia', 'clave-segura-1');
    const otra = ctx.client();
    await otra.login('cambia');
    assert.equal((await c.post('/api/auth/password', { current: 'mal-mal-mal', next: 'nueva-clave-2' })).status, 401);
    assert.equal((await c.post('/api/auth/password', { current: 'clave-segura-1', next: 'nueva-clave-2' })).status, 200);
    assert.equal((await otra.get('/api/auth/me')).json.user, null);
    assert.equal((await c.get('/api/auth/me')).json.user.username, 'cambia');
    await ctx.client().login('cambia', 'nueva-clave-2');
  });

  it('frena los intentos de inicio de sesión repetidos', async () => {
    const strict = await ctx.extra({ rate: { auth: 4, guestbook: 1000 } });
    try {
      const c = strict.client();
      const statuses = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await c.post('/api/auth/login', { username: 'lector1', password: 'incorrecta1' })).status);
      assert.deepEqual(statuses, [401, 401, 401, 401, 429, 429]);
    } finally { await strict.stop(); }
  });

  it('respeta ALLOW_REGISTRATION=false', async () => {
    const closed = await ctx.extra({ allowRegistration: false });
    try {
      const r = await closed.client().post('/api/auth/register', { username: 'nuevo', password: 'clave-segura-1' });
      assert.equal(r.status, 403);
      assert.equal(r.json.error.code, 'registration_closed');
    } finally { await closed.stop(); }
  });
});

describe('seguridad', () => {
  it('la zona admin pide sesión y rol de admin', async () => {
    assert.equal((await anon.get('/api/admin/stats')).status, 401);
    assert.equal((await reader.get('/api/admin/stats')).status, 403);
    assert.equal((await reader.post('/api/admin/series', { title: 'x' })).status, 403);
    assert.equal((await admin.get('/api/admin/stats')).status, 200);
  });

  it('rechaza pedidos de otro origen (CSRF)', async () => {
    const r = await admin.post('/api/admin/projects', { name: 'x' }, { headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'bad_origin');
  });

  it('no deja salir de la carpeta de archivos', async () => {
    const res = await anon.get('/media/..%2f..%2fpackage.json', { raw: true });
    assert.ok([400, 403, 404].includes(res.status));
    const tmp = await anon.get('/media/.tmp/x', { raw: true });
    assert.ok([403, 404].includes(tmp.status));
  });
});

describe('biblioteca: series, capítulos y páginas', () => {
  let seriesId; let chapterId; let pageIds;

  it('crea una serie borrador que no aparece en lo público', async () => {
    const r = await admin.post('/api/admin/series', { title: 'Estrato Hueco', author: 'Autora X', sourceLang: 'ja', synopsis: 'Una ciudad vertical.' });
    assert.equal(r.status, 201);
    seriesId = r.json.series.id;
    assert.equal(r.json.series.slug, 'estrato-hueco');
    assert.equal(r.json.series.published, false);
    assert.equal((await anon.get('/api/series')).json.series.length, 0);
    assert.equal((await anon.get(`/api/series/${seriesId}`)).status, 404);
  });

  it('genera slugs únicos', async () => {
    const r = await admin.post('/api/admin/series', { title: 'Estrato Hueco' });
    assert.equal(r.json.series.slug, 'estrato-hueco-2');
    await admin.del(`/api/admin/series/${r.json.series.id}`);
  });

  it('sube una portada válida y rechaza archivos que no son imágenes', async () => {
    const ok = await admin.post(`/api/admin/series/${seriesId}/cover`, pngForm('cover', ['portada.png']));
    assert.equal(ok.status, 200);
    assert.match(ok.json.coverUrl, /^\/media\/series\/\d+\/cover-.+\.png$/);

    const fd = new FormData();
    fd.append('cover', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'portada.png');
    const bad = await admin.post(`/api/admin/series/${seriesId}/cover`, fd);
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'bad_image');
  });

  it('crea capítulos, evita duplicados y sube páginas en orden natural', async () => {
    const ch = await admin.post(`/api/admin/series/${seriesId}/chapters`, { number: 1, title: 'Despertar' });
    assert.equal(ch.status, 201);
    chapterId = ch.json.chapter.id;
    assert.equal((await admin.post(`/api/admin/series/${seriesId}/chapters`, { number: 1 })).status, 409);

    const fd = pngForm('pages', ['10.png', '2.png', '1.png'], [[30, 40], [20, 30], [10, 20]]);
    fd.append('sort', 'name');
    const up = await admin.post(`/api/admin/chapters/${chapterId}/pages`, fd);
    assert.equal(up.status, 201);
    assert.deepEqual(up.json.pages.map((p) => [p.width, p.height]), [[10, 20], [20, 30], [30, 40]]);
    pageIds = up.json.pages.map((p) => p.id);
  });

  it('un capítulo sin publicar no se ve; publicado, sí', async () => {
    await admin.patch(`/api/admin/series/${seriesId}`, { published: true });
    assert.equal((await anon.get('/api/series')).json.series[0].chapterCount, 0);
    assert.equal((await anon.get(`/api/chapters/${chapterId}`)).status, 404);

    await admin.patch(`/api/admin/chapters/${chapterId}`, { published: true });
    const list = (await anon.get('/api/series')).json.series;
    assert.equal(list.length, 1);
    assert.equal(list[0].chapterCount, 1);
    assert.ok(list[0].coverUrl);

    const detail = (await anon.get(`/api/series/${seriesId}`)).json;
    assert.equal(detail.chapters[0].pageCount, 3);

    const chap = (await anon.get(`/api/chapters/${chapterId}`)).json.chapter;
    assert.equal(chap.pages.length, 3);
    assert.equal(chap.prevId, null);
    assert.equal(chap.nextId, null);
    const img = await anon.get(chap.pages[0].url, { raw: true });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
  });

  it('calcula capítulo anterior y siguiente', async () => {
    const c2 = (await admin.post(`/api/admin/series/${seriesId}/chapters`, { number: 2, published: true })).json.chapter;
    await admin.post(`/api/admin/chapters/${c2.id}/pages`, pngForm('pages', ['a.png']));
    const first = (await anon.get(`/api/chapters/${chapterId}`)).json.chapter;
    const second = (await anon.get(`/api/chapters/${c2.id}`)).json.chapter;
    assert.equal(first.nextId, c2.id);
    assert.equal(second.prevId, chapterId);
  });

  it('reordena y borra páginas compactando posiciones', async () => {
    const reversed = [...pageIds].reverse();
    const ord = await admin.put(`/api/admin/chapters/${chapterId}/pages/order`, { ids: reversed });
    assert.deepEqual(ord.json.pages.map((p) => p.id), reversed);
    assert.equal((await admin.put(`/api/admin/chapters/${chapterId}/pages/order`, { ids: [pageIds[0]] })).status, 400);

    const file = ord.json.pages[0].url;
    assert.equal((await admin.del(`/api/admin/pages/${reversed[0]}`)).status, 200);
    const after = (await admin.get(`/api/admin/chapters/${chapterId}/pages`)).json.pages;
    assert.deepEqual(after.map((p) => p.position), [0, 1]);
    assert.equal((await anon.get(file, { raw: true })).status, 404);
  });

  it('guarda y devuelve el progreso de lectura', async () => {
    assert.equal((await anon.put('/api/progress', { chapterId, page: 1 })).status, 401);
    assert.equal((await reader.put('/api/progress', { chapterId, page: 1 })).status, 200);
    assert.equal((await reader.put('/api/progress', { chapterId, page: 0 })).status, 200);
    assert.equal((await reader.put('/api/progress', { chapterId, page: -1 })).status, 400);
    assert.deepEqual((await reader.get('/api/progress')).json.progress, { [chapterId]: 0 });
  });

  it('lista los últimos capítulos', async () => {
    const latest = (await anon.get('/api/latest')).json.chapters;
    assert.ok(latest.length >= 2);
    assert.equal(latest[0].seriesTitle, 'Estrato Hueco');
  });

  it('borrar la serie borra también sus archivos', async () => {
    const dir = path.join(ctx.uploadDir, 'series', String(seriesId));
    assert.ok((await fs.readdir(dir)).length > 0);
    assert.equal((await admin.del(`/api/admin/series/${seriesId}`)).status, 200);
    await assert.rejects(fs.readdir(dir));
    assert.equal((await anon.get('/api/series')).json.series.length, 0);
  });

  it('limita el tamaño de cada imagen', async () => {
    const s = (await admin.post('/api/admin/series', { title: 'Grande' })).json.series;
    const c = (await admin.post(`/api/admin/series/${s.id}/chapters`, { number: 1 })).json.chapter;
    const fd = new FormData();
    fd.append('pages', new Blob([Buffer.concat([makePng(8, 8), Buffer.alloc(3 * 1024 * 1024)])], { type: 'image/png' }), 'enorme.png');
    const r = await admin.post(`/api/admin/chapters/${c.id}/pages`, fd);
    assert.equal(r.status, 413);
  });
});

describe('proyectos', () => {
  it('crea, edita, oculta y borra proyectos', async () => {
    const p = (await admin.post('/api/admin/projects', {
      name: 'Canvas online', description: 'Lienzo en el navegador', stage: 'brote', tags: 'canvas, web', url: 'https://example.com/canvas',
    })).json.project;
    assert.deepEqual(p.tags, ['canvas', 'web']);
    assert.equal((await anon.get('/api/projects')).json.projects.length, 1);

    assert.equal((await admin.patch(`/api/admin/projects/${p.id}`, { stage: 'crecido' })).json.project.stage, 'crecido');
    assert.equal((await admin.patch(`/api/admin/projects/${p.id}`, { visible: false })).status, 200);
    assert.equal((await anon.get('/api/projects')).json.projects.length, 0);
    assert.equal((await admin.get('/api/admin/projects')).json.projects.length, 1);

    assert.equal((await admin.post('/api/admin/projects', { name: 'x', url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await admin.post('/api/admin/projects', { name: 'x', stage: 'arbol' })).status, 400);
    assert.equal((await admin.del(`/api/admin/projects/${p.id}`)).status, 200);
    assert.equal((await admin.del(`/api/admin/projects/${p.id}`)).status, 404);
  });
});

describe('libro de visitas', () => {
  it('acepta huellas anónimas, frena bots y permite moderar', async () => {
    const guest = ctx.client();
    const r = await guest.post('/api/guestbook', { body: 'Pasé por acá', name: 'Nube' });
    assert.equal(r.status, 201);
    assert.equal((await guest.post('/api/guestbook', { body: 'spam', website: 'http://x' })).status, 400);
    assert.equal((await guest.post('/api/guestbook', { body: '' })).status, 400);
    assert.equal((await guest.post('/api/guestbook', { body: 'x'.repeat(281) })).status, 400);

    const mine = (await reader.post('/api/guestbook', { body: 'Hola desde mi cuenta' })).json.entry;
    assert.equal(mine.author, 'lector1');

    assert.equal((await anon.get('/api/guestbook')).json.entries.length, 2);
    await admin.patch(`/api/admin/guestbook/${r.json.entry.id}`, { hidden: true });
    assert.equal((await anon.get('/api/guestbook')).json.entries.length, 1);
    assert.equal((await admin.get('/api/admin/guestbook')).json.entries.length, 2);
  });

  it('limita la cantidad de huellas por minuto', async () => {
    const strict = await ctx.extra({ rate: { auth: 1000, guestbook: 3 } });
    try {
      const spammer = strict.client();
      const statuses = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await spammer.post('/api/guestbook', { body: `n${i}` })).status);
      assert.deepEqual(statuses, [201, 201, 201, 429, 429, 429]);
    } finally { await strict.stop(); }
  });
});

describe('ajustes del sitio y acceso', () => {
  it('actualiza textos e influencias', async () => {
    const r = await admin.put('/api/admin/site', {
      intro: 'Nuevo texto', influences: [{ kanji: '星', title: 'Otro', text: 'Algo' }],
    });
    assert.equal(r.status, 200);
    const site = (await anon.get('/api/site')).json;
    assert.equal(site.intro, 'Nuevo texto');
    assert.equal(site.influences[0].title, 'Otro');
    assert.equal((await admin.put('/api/admin/site', { influences: 'no' })).status, 400);
  });

  it('con "leer requiere cuenta" bloquea la biblioteca y los archivos a anónimos', async () => {
    const s = (await admin.post('/api/admin/series', { title: 'Privada', published: true })).json.series;
    const c = (await admin.post(`/api/admin/series/${s.id}/chapters`, { number: 1, published: true })).json.chapter;
    const up = await admin.post(`/api/admin/chapters/${c.id}/pages`, pngForm('pages', ['p.png']));
    const url = up.json.pages[0].url;

    await admin.put('/api/admin/site', { readRequiresLogin: true });
    await new Promise((r) => setTimeout(r, 5200)); // la caché de ajustes dura 5 s
    assert.equal((await anon.get('/api/series')).status, 401);
    assert.equal((await anon.get(url, { raw: true })).status, 401);
    assert.equal((await reader.get('/api/series')).status, 200);
    assert.equal((await reader.get(url, { raw: true })).status, 200);
    await admin.put('/api/admin/site', { readRequiresLogin: false });
  });
});

describe('usuarios', () => {
  it('el admin puede cambiar roles y desactivar cuentas, pero no la suya', async () => {
    const users = (await admin.get('/api/admin/users')).json.users;
    const lector = users.find((u) => u.username === 'lector1');
    const mei = users.find((u) => u.username === 'mei');
    assert.equal((await admin.patch(`/api/admin/users/${mei.id}`, { role: 'reader' })).status, 409);
    assert.equal((await admin.patch(`/api/admin/users/${mei.id}`, { disabled: true })).status, 409);

    assert.equal((await admin.patch(`/api/admin/users/${lector.id}`, { disabled: true })).status, 200);
    assert.equal((await reader.get('/api/auth/me')).json.user, null);
    assert.equal((await ctx.client().post('/api/auth/login', { username: 'lector1', password: 'clave-segura-1' })).status, 401);
    await admin.patch(`/api/admin/users/${lector.id}`, { disabled: false });
    await reader.login('lector1');
  });
});
