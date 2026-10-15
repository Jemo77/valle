import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeAdmin, pngForm, startTestApp, WsClient } from './helpers.js';

let ctx;
let admin;
let ana;
let beto;
let caro;
let seriesId;
let chapter1;
let chapter2;

before(async () => {
  ctx = await startTestApp();
  admin = ctx.client();
  await admin.register('mei');
  await makeAdmin(ctx, 'mei');
  ana = ctx.client();
  beto = ctx.client();
  caro = ctx.client();
  await ana.register('ana', 'clave-segura-1', 'Ana');
  await beto.register('beto', 'clave-segura-1', 'Beto');
  await caro.register('caro', 'clave-segura-1', 'Caro');

  seriesId = (await admin.post('/api/admin/series', { title: 'Jardín de Fierro', published: true })).json.series.id;
  chapter1 = (await admin.post(`/api/admin/series/${seriesId}/chapters`, { number: 1, published: true })).json.chapter.id;
  chapter2 = (await admin.post(`/api/admin/series/${seriesId}/chapters`, { number: 2, published: true })).json.chapter.id;
  for (const c of [chapter1, chapter2]) await admin.post(`/api/admin/chapters/${c}/pages`, pngForm('pages', ['1.png', '2.png', '3.png']));
});
after(async () => { await ctx.stop(); });

describe('grupos de lectura (HTTP)', () => {
  let publicGroup; let privateGroup;

  it('hace falta una cuenta para crear grupos y se validan los datos', async () => {
    assert.equal((await ctx.client().post('/api/groups', { name: 'Hola' })).status, 401);
    assert.equal((await ana.post('/api/groups', { name: 'x' })).status, 400);
    assert.equal((await ana.post('/api/groups', { name: 'Grupo', visibility: 'secreto' })).status, 400);
    assert.equal((await ana.post('/api/groups', { name: 'Grupo', seriesId: 99999 })).status, 400);
  });

  it('crea un grupo público y uno privado con código de invitación', async () => {
    publicGroup = (await ana.post('/api/groups', {
      name: 'Lectura de los martes', description: 'Un capítulo por semana', seriesId, chapterId: chapter1, visibility: 'public', control: 'guide',
    })).json.group;
    assert.equal(publicGroup.isOwner, true);
    assert.equal(publicGroup.memberCount, 1);
    assert.equal(publicGroup.chapterId, chapter1);
    assert.match(publicGroup.inviteCode, /^[A-Z2-9]{8}$/);

    privateGroup = (await ana.post('/api/groups', { name: 'Solo amigas', visibility: 'private', control: 'everyone', seriesId })).json.group;
    assert.equal(privateGroup.visibility, 'private');
  });

  it('el listado muestra los públicos a todos y los privados solo a sus miembros', async () => {
    const anon = ctx.client();
    const names = (r) => r.json.groups.map((g) => g.name).sort();
    assert.deepEqual(names(await anon.get('/api/groups')), ['Lectura de los martes']);
    assert.deepEqual(names(await beto.get('/api/groups')), ['Lectura de los martes']);
    assert.deepEqual(names(await ana.get('/api/groups')), ['Lectura de los martes', 'Solo amigas']);
    const seen = (await beto.get('/api/groups')).json.groups[0];
    assert.equal(seen.inviteCode, null);
    assert.equal(seen.isMember, false);
  });

  it('los privados no se pueden ver ni unirse sin código', async () => {
    assert.equal((await beto.get(`/api/groups/${privateGroup.id}`)).status, 404);
    assert.equal((await beto.post(`/api/groups/${privateGroup.id}/join`)).status, 403);
    assert.equal((await beto.post('/api/groups/join', { code: 'NOEXISTE' })).status, 404);
    const joined = await beto.post('/api/groups/join', { code: privateGroup.inviteCode.toLowerCase() });
    assert.equal(joined.status, 200);
    assert.equal(joined.json.group.isMember, true);
    assert.equal((await beto.get(`/api/groups/${privateGroup.id}`)).status, 200);
  });

  it('un grupo público se puede unir sin código', async () => {
    const r = await caro.post(`/api/groups/${publicGroup.id}/join`);
    assert.equal(r.json.group.memberCount, 2);
    const detail = (await caro.get(`/api/groups/${publicGroup.id}`)).json;
    assert.deepEqual(detail.members.map((m) => m.name).sort(), ['Ana', 'Caro']);
  });

  it('quien creó el grupo no puede irse, el resto sí', async () => {
    assert.equal((await ana.post(`/api/groups/${publicGroup.id}/leave`)).status, 409);
    assert.equal((await caro.post(`/api/groups/${publicGroup.id}/leave`)).status, 200);
    assert.equal((await caro.get(`/api/groups/${publicGroup.id}`)).json.group.isMember, false);
    await caro.post(`/api/groups/${publicGroup.id}/join`);
  });

  it('solo quien lo creó puede cambiarlo, sacar gente o borrarlo', async () => {
    assert.equal((await beto.patch(`/api/groups/${publicGroup.id}`, { name: 'Otro' })).status, 403);
    assert.equal((await caro.patch(`/api/groups/${publicGroup.id}`, { name: 'Otro' })).status, 403);
    const upd = await ana.patch(`/api/groups/${publicGroup.id}`, { name: 'Lectura de los martes (2)', rotateCode: true });
    assert.notEqual(upd.json.group.inviteCode, publicGroup.inviteCode);
    assert.equal((await caro.del(`/api/groups/${publicGroup.id}/members/${(await ana.get('/api/auth/me')).json.user.id}`)).status, 403);
    assert.equal((await beto.del(`/api/groups/${privateGroup.id}`)).status, 403);
  });

  it('el límite de grupos por persona se respeta', async () => {
    const dev = ctx.client();
    await dev.register('creadora');
    for (let i = 0; i < 10; i += 1) assert.equal((await dev.post('/api/groups', { name: `Grupo ${i}` })).status, 201);
    assert.equal((await dev.post('/api/groups', { name: 'Uno más' })).status, 409);
  });
});

describe('lectura sincronizada (WebSocket)', () => {
  let group; let wa; let wb; let wc;

  before(async () => {
    group = (await ana.post('/api/groups', { name: 'Sincronía', seriesId, chapterId: chapter1, control: 'guide', visibility: 'public' })).json.group;
    await beto.post(`/api/groups/${group.id}/join`);
    await caro.post(`/api/groups/${group.id}/join`);
    wa = await WsClient.connect(ctx, ana);
    wb = await WsClient.connect(ctx, beto);
    wc = await WsClient.connect(ctx, caro);
  });
  after(() => { wa.close(); wb.close(); wc.close(); });

  it('da la bienvenida con identidad y cantidad de conectados', async () => {
    assert.equal(wa.welcome.user.username, 'ana');
    const anon = await WsClient.connect(ctx, null);
    assert.equal(anon.welcome.user, null);
    const online = await anon.next('online');
    assert.ok(online.n >= 4);
    anon.close();
  });

  it('un anónimo no puede entrar a un grupo', async () => {
    const anon = await WsClient.connect(ctx, null);
    anon.send({ t: 'group:join', groupId: group.id });
    assert.equal((await anon.next('error')).code, 'auth_required');
    anon.close();
  });

  it('quien no es miembro no puede entrar', async () => {
    const outsider = ctx.client();
    await outsider.register('afuera');
    const w = await WsClient.connect(ctx, outsider);
    w.send({ t: 'group:join', groupId: group.id });
    assert.equal((await w.next('error')).code, 'forbidden');
    w.close();
  });

  it('al entrar recibe el estado y la presencia se actualiza para todos', async () => {
    wa.send({ t: 'group:join', groupId: group.id });
    const st = await wa.next('group:state');
    assert.equal(st.group.canNavigate, true);
    assert.equal(st.state.chapterId, chapter1);
    assert.equal(st.members.length, 3);
    assert.equal(st.members.find((m) => m.name === 'Ana').online, true);

    wb.send({ t: 'group:join', groupId: group.id });
    const stB = await wb.next('group:state');
    assert.equal(stB.group.canNavigate, false);
    const pres = await wa.next('group:presence', 3000, (m) => m.online.length === 2);
    assert.equal(pres.online.length, 2);
  });

  it('la guía cambia de página y los demás la reciben; el resto no puede guiar', async () => {
    wa.send({ t: 'group:nav', page: 2 });
    const nav = await wb.next('group:nav');
    assert.equal(nav.page, 2);
    assert.equal(nav.by.name, 'Ana');

    wb.send({ t: 'group:nav', page: 1 });
    assert.equal((await wb.next('error')).code, 'forbidden');
    assert.ok(await wa.none('group:nav'));

    const state = (await ctx.db.one('select page from group_state where group_id = $1', [group.id])).page;
    assert.equal(state, 2);
  });

  it('cambiar de capítulo se valida contra la serie del grupo', async () => {
    wa.send({ t: 'group:nav', chapterId: chapter2, page: 0 });
    assert.equal((await wb.next('group:nav')).chapterId, chapter2);

    const otra = (await admin.post('/api/admin/series', { title: 'Otra', published: true })).json.series.id;
    const foreign = (await admin.post(`/api/admin/series/${otra}/chapters`, { number: 1, published: true })).json.chapter.id;
    await admin.post(`/api/admin/chapters/${foreign}/pages`, pngForm('pages', ['a.png']));
    wa.send({ t: 'group:nav', chapterId: foreign, page: 0 });
    assert.equal((await wa.next('error')).code, 'bad_request');
    wa.send({ t: 'group:nav', page: -3 });
    assert.equal((await wa.next('error')).code, 'bad_request');
  });

  it('el chat llega a todos, se guarda y tiene límites', async () => {
    wc.send({ t: 'group:join', groupId: group.id });
    await wc.next('group:state');
    wb.send({ t: 'group:chat', body: 'Qué final…' });
    for (const w of [wa, wb, wc]) {
      const m = await w.next('group:chat');
      assert.equal(m.name, 'Beto');
      assert.equal(m.body, 'Qué final…');
    }
    wb.send({ t: 'group:chat', body: '   ' });
    assert.equal((await wb.next('error')).code, 'bad_request');
    wb.send({ t: 'group:chat', body: 'x'.repeat(501) });
    assert.equal((await wb.next('error')).code, 'bad_request');

    const detail = (await beto.get(`/api/groups/${group.id}`)).json;
    assert.equal(detail.messages.at(-1).body, 'Qué final…');
  });

  it('con control "todos" cualquiera puede avanzar', async () => {
    await ana.patch(`/api/groups/${group.id}`, { control: 'everyone' });
    const st = await wb.next('group:state'); // la app refresca el estado de los conectados
    assert.equal(st.group.canNavigate, true);
    wb.send({ t: 'group:nav', page: 1 });
    assert.equal((await wa.next('group:nav')).page, 1);
  });

  it('al sacar a alguien se lo expulsa del grupo en vivo', async () => {
    const anaId = (await ana.get('/api/auth/me')).json.user.id;
    const carolId = (await caro.get('/api/auth/me')).json.user.id;
    assert.notEqual(anaId, carolId);
    const r = await ana.del(`/api/groups/${group.id}/members/${carolId}`);
    assert.equal(r.status, 200);
    assert.equal((await wc.next('group:closed')).reason, 'kicked');
    wc.send({ t: 'group:chat', body: 'sigo acá?' });
    assert.equal((await wc.next('error')).code, 'bad_request');
  });

  it('al borrar el grupo se cierra para todos', async () => {
    assert.equal((await ana.del(`/api/groups/${group.id}`)).status, 200);
    assert.equal((await wa.next('group:closed')).reason, 'deleted');
    assert.equal((await wb.next('group:closed')).reason, 'deleted');
  });
});

describe('lienzo compartido (WebSocket)', () => {
  let wa; let wb;

  before(async () => {
    wa = await WsClient.connect(ctx, ana);
    wb = await WsClient.connect(ctx, beto);
  });
  after(() => { wa.close(); wb.close(); });

  const stroke = (extra = {}) => ({ t: 'draw:stroke', sid: 's1', tool: 'brush', color: '#86b06a', size: 6, pts: [[10, 10], [20, 20], [30, 25]], end: true, ...extra });

  it('lista los lienzos disponibles', async () => {
    const rooms = (await ana.get('/api/draw/rooms')).json.rooms;
    assert.equal(rooms[0].id, 'lienzo-abierto');
  });

  it('hace falta cuenta y un lienzo existente', async () => {
    const anon = await WsClient.connect(ctx, null);
    anon.send({ t: 'draw:join', room: 'lienzo-abierto' });
    assert.equal((await anon.next('error')).code, 'auth_required');
    anon.close();
    wa.send({ t: 'draw:join', room: 'no-existe' });
    assert.equal((await wa.next('error')).code, 'not_found');
  });

  it('los trazos se reparten a los demás y los nuevos reciben lo dibujado', async () => {
    wa.send({ t: 'draw:join', room: 'lienzo-abierto' });
    const init = await wa.next('draw:init');
    assert.equal(init.snapshot, null);
    assert.deepEqual(init.chunks, []);

    wb.send({ t: 'draw:join', room: 'lienzo-abierto' });
    await wb.next('draw:init');
    assert.equal((await wa.next('draw:peers')).n, 2);

    wa.send(stroke());
    const got = await wb.next('draw:stroke');
    assert.equal(got.cid, wa.welcome.cid);
    assert.equal(got.pts.length, 3);
    assert.equal(got.seq, 1);
    assert.ok(await wa.none('draw:stroke'));

    const late = await WsClient.connect(ctx, ana);
    late.send({ t: 'draw:join', room: 'lienzo-abierto' });
    const lateInit = await late.next('draw:init');
    assert.equal(lateInit.chunks.length, 1);
    assert.equal(lateInit.seq, 1);
    late.close();
  });

  it('rechaza trazos inválidos', async () => {
    for (const bad of [
      stroke({ color: 'rojo' }), stroke({ tool: 'laser' }), stroke({ size: 500 }),
      stroke({ pts: [] }), stroke({ pts: [[5000, 5]] }), stroke({ pts: [['a', 'b']] }), stroke({ sid: 'x'.repeat(40) }),
    ]) {
      wa.send(bad);
      assert.equal((await wa.next('error')).code, 'bad_request');
    }
  });

  it('guarda la foto del lienzo y descarta los trazos ya incluidos', async () => {
    wa.send(stroke({ sid: 's2' }));
    await wb.next('draw:stroke');
    const png = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
    wa.send({ t: 'draw:snapshot', dataUrl: png, upToSeq: 1 });
    await new Promise((r) => setTimeout(r, 200));
    const saved = await ctx.db.one(`select snapshot from draw_rooms where id = 'lienzo-abierto'`);
    assert.equal(saved.snapshot, png);

    const late = await WsClient.connect(ctx, ana);
    late.send({ t: 'draw:join', room: 'lienzo-abierto' });
    const init = await late.next('draw:init');
    assert.equal(init.snapshot, png);
    assert.deepEqual(init.chunks.map((c) => c.seq), [2]);
    late.close();
  });

  it('ignora fotos con formato raro y limpia todo con "clear"', async () => {
    wa.send({ t: 'draw:snapshot', dataUrl: 'data:text/html;base64,PGI+', upToSeq: 0 });
    await new Promise((r) => setTimeout(r, 150));
    wa.send({ t: 'draw:clear' });
    const clear = await wb.next('draw:clear');
    assert.equal(clear.by, 'Ana');
    const row = await ctx.db.one(`select snapshot from draw_rooms where id = 'lienzo-abierto'`);
    assert.equal(row.snapshot, null);
  });

  it('un cliente que se va deja de contar', async () => {
    const peers = wa.next('draw:peers', 3000, (m) => m.n === 1);
    wb.close();
    assert.equal((await peers).n, 1);
  });
});
