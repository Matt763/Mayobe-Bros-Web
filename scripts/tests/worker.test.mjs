// Tests the Worker against a real SQLite engine (Node's built-in node:sqlite) wrapped to look like Cloudflare D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';

const ORIGIN = 'https://mayobebros.com';
const CID = 'abcdefabcdefabcdef12';
const CID2 = 'zzzzzzzzzzzzzzzzzz34';
let env;
const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async (u) => {
    if (String(u).endsWith('/data/search.json')) return new Response(JSON.stringify([{ s: 'hello-post' }, { s: 'second-post' }]), { status: 200 });
    return new Response('{}', { status: 404 });
  };
});
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => { env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN }; });

async function call(method, path, { body, origin = ORIGIN, auth, ip = '1.1.1.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}
const comment = (over = {}) => ({ name: 'Asha', body: 'Thanks, this helped me a lot.', cid: CID, ts: Date.now() - 10000, ...over });

test('stats are zero for a new post and CORS allows only our site', async () => {
  const r = await call('GET', '/v1/stats?slugs=hello-post,second-post');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json['hello-post'], { c: 0, r: { like: 0, amazed: 0, sad: 0, angry: 0 } });
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await call('GET', '/v1/stats?slugs=hello-post', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('POST from another origin or with no origin is refused', async () => {
  assert.equal((await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'like' }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'like' }, origin: null })).status, 403);
});

test('unknown post is rejected', async () => {
  assert.equal((await call('POST', '/v1/posts/not-a-real-post/react', { body: { cid: CID, type: 'like' } })).status, 404);
  assert.equal((await call('GET', '/v1/posts/Bad_Slug!')).status, 404);
});

test('reactions: add, change, remove; one per visitor', async () => {
  let r = await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'like' } });
  assert.equal(r.json.stats.r.like, 1);
  r = await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'like' } });
  assert.equal(r.json.stats.r.like, 1, 'same reaction twice does not double count');
  r = await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID2, type: 'angry' } });
  assert.deepEqual(r.json.stats.r, { like: 1, amazed: 0, sad: 0, angry: 1 });
  r = await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'sad' } });
  assert.deepEqual(r.json.stats.r, { like: 0, amazed: 0, sad: 1, angry: 1 });
  assert.equal((await call('GET', `/v1/posts/hello-post/mine?cid=${CID}`)).json.reaction, 'sad');
  r = await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: null } });
  assert.deepEqual(r.json.stats.r, { like: 0, amazed: 0, sad: 0, angry: 1 });
  assert.equal((await call('GET', `/v1/posts/hello-post/mine?cid=${CID}`)).json.reaction, null);
  assert.equal((await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'love' } })).status, 400);
  assert.equal((await call('POST', '/v1/posts/hello-post/react', { body: { cid: 'short', type: 'like' } })).status, 400);
});

const RUDE = 'You are an idiot and a fool, mjinga wewe.';

test('a clean comment is published at once and counted', async () => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'approved');
  assert.equal(r.json.comment.name, 'Asha');
  assert.equal(r.json.comment.parent, null);
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  assert.equal(pub.comments.length, 1);
  assert.equal(pub.stats.c, 1);
  assert.equal('email' in pub.comments[0], false, 'email is never public');
  assert.equal((await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c, 1);
  assert.equal((await call('GET', '/v1/admin/comments?status=pending', { auth: env.ADMIN_TOKEN, origin: null })).json.comments.length, 0);
});

test('a new comment returns its manage token once, and only a hash is stored', async () => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ email: 'asha@example.com' }) });
  assert.equal(r.status, 201);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(r.json.id, r.json.comment.id, 'the response carries the new row id');
  const pubText = JSON.stringify((await call('GET', '/v1/posts/hello-post')).json);
  assert.equal(pubText.includes(r.json.token), false, 'the token is never in the public list');
  for (const word of ['manage_hash', 'prev_body', 'email']) assert.equal(pubText.includes(word), false, `${word} is never public`);
  const stored = env.DB.raw.prepare('SELECT manage_hash FROM comments WHERE id = ?').get(r.json.id).manage_hash;
  assert.equal(stored.length, 64);
  assert.notEqual(stored, r.json.token);
  assert.equal(stored, createHash('sha256').update(r.json.token).digest('hex'), 'only the SHA-256 of the token is stored');

  // a held comment gets an id and a token too, so the browser can keep the token even though no comment is shown yet
  const held = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: RUDE, cid: CID2 }) });
  assert.equal(held.json.status, 'pending');
  assert.equal(held.json.comment, null);
  assert.equal(typeof held.json.id, 'number');
  assert.match(held.json.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(held.json.token, r.json.token, 'every comment gets its own token');
  assert.equal(env.DB.raw.prepare('SELECT manage_hash FROM comments WHERE id = ?').get(held.json.id).manage_hash.length, 64);

  // a duplicate inserts nothing, so it must not hand out an id or a token
  const dup = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ email: 'asha@example.com' }) });
  assert.equal(dup.json.status, 'duplicate');
  assert.equal('id' in dup.json, false);
  assert.equal('token' in dup.json, false);
  // a bot post pretends to work and also gets nothing
  const bot = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ website: 'http://bot' }) });
  assert.equal('id' in bot.json, false);
  assert.equal('token' in bot.json, false);
});

test('public comments carry likes, and edited and deleted markers only when true', async () => {
  const p = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'A reply here', parent: p.json.id }) });
  const top = (await call('GET', '/v1/posts/hello-post')).json.comments[0];
  for (const c of [top, top.replies[0]]) {
    assert.equal(c.likes, 0);
    assert.equal('edited' in c, false);
    assert.equal('deleted' in c, false);
  }
  // edited shows the time of the edit; the reason and the old text never appear
  env.DB.raw.prepare('UPDATE comments SET edited_at = 1234567890123, likes = 3, prev_body = ? WHERE id = ?').run('old text', p.json.id);
  const edited = (await call('GET', '/v1/posts/hello-post')).json.comments[0];
  assert.equal(edited.edited, 1234567890123);
  assert.equal(edited.likes, 3);
  assert.equal(JSON.stringify(edited).includes('old text'), false);
});

test('a deleted comment that still has replies is public as a blank tombstone', async () => {
  const p = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'A reply here', parent: p.json.id }) });
  const t = Date.now();
  env.DB.raw.prepare("UPDATE comments SET status = 'deleted', name = '', body = '', email = NULL, manage_hash = NULL, prev_body = NULL, ip_hash = NULL, cid = NULL, flag = NULL, edited_at = NULL, likes = 0, created = ? WHERE id = ?").run(t, p.json.id);
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  assert.equal(pub.comments.length, 1);
  assert.deepEqual({ ...pub.comments[0], replies: undefined }, { id: p.json.id, name: '', body: 'This comment was deleted.', at: t, deleted: true, likes: 0, replies: undefined });
  assert.equal(pub.comments[0].replies.length, 1, 'the replies stay visible under the tombstone');
  assert.equal(pub.comments[0].replies[0].body, 'A reply here');
});

test('a flagged comment is held, shows the reason to the moderator only, then can be approved', async () => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: RUDE, email: 'asha@example.com' }) });
  assert.equal(r.status, 202);
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.comment, null);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0, 'held comments are invisible');
  assert.equal((await call('GET', '/v1/admin/comments')).status, 401);
  assert.equal((await call('GET', '/v1/admin/comments', { auth: 'wrong-token-wrong-token' })).status, 401);
  const list = await call('GET', '/v1/admin/comments?status=pending', { auth: env.ADMIN_TOKEN, origin: null });
  assert.equal(list.json.comments.length, 1);
  assert.match(list.json.comments[0].flag, /word:/);
  const id = list.json.comments[0].id;
  const ap = await call('POST', `/v1/admin/comments/${id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  assert.equal(ap.json.stats.c, 1);
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  assert.equal(pub.comments.length, 1);
  assert.equal(JSON.stringify(pub).includes('flag'), false, 'the reason is never public');
});

test('names are screened too, and so are phone numbers and shouting', async () => {
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ name: 'idiot man' }) })).json.status, 'pending');
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Call me on 0712 345 678 please' }) })).json.status, 'pending');
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'THIS IS A VERY LONG MESSAGE WRITTEN IN CAPITALS' }) })).json.status, 'pending');
});

test('AUTO_APPROVE=false holds every comment again', async () => {
  env.AUTO_APPROVE = 'false';
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  assert.equal(r.json.status, 'pending');
  const list = await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null });
  assert.match(list.json.comments[0].flag, /auto-approve-off/);
});

test('a visitor whose earlier comment was marked as spam is held from then on', async () => {
  const first = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  await call('POST', `/v1/admin/comments/${first.json.comment.id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'spam' } });
  const again = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'A perfectly polite second comment.' }) });
  assert.equal(again.json.status, 'pending');
  const list = await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null });
  assert.match(list.json.comments[0].flag, /earlier-spam/);
});

test('replies work on a published comment and nest one level', async () => {
  const p = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  const reply = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'A reply here', parent: p.json.comment.id }) });
  assert.equal(reply.json.status, 'approved');
  assert.equal(reply.json.comment.parent, p.json.comment.id);
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  assert.equal(pub.comments.length, 1);
  assert.equal(pub.comments[0].replies.length, 1);
  assert.equal(pub.stats.c, 2);
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Nested too deep', parent: reply.json.comment.id }) })).status, 400);
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Reply to nothing', parent: 999 }) })).status, 400);
});

test('a reply to a held comment is refused until the parent is approved', async () => {
  await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: RUDE }) });
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'A reply here', parent: 1 }) })).status, 400);
});

test('team replies: admin only, badge shown, names that look like the team are held', async () => {
  const p = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  const noAuth = await call('POST', '/v1/admin/reply', { body: { parent: p.json.comment.id, body: 'Thanks' }, origin: null });
  assert.equal(noAuth.status, 401);
  const r = await call('POST', '/v1/admin/reply', { auth: env.ADMIN_TOKEN, origin: null, body: { parent: p.json.comment.id, body: 'Thanks for the love' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.comment.team, true);
  assert.equal(r.json.stats.c, 2);
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  assert.equal(pub.comments[0].replies[0].team, true);
  assert.equal(pub.comments[0].replies[0].name, 'Mayobe Bros Team');
  assert.equal('team' in pub.comments[0], false, 'ordinary comments carry no badge');
  assert.equal((await call('POST', '/v1/admin/reply', { auth: env.ADMIN_TOKEN, origin: null, body: { parent: 999, body: 'Thanks' } })).status, 400);
  const fake = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ name: 'Mayobe Bros Moderator', body: 'Send your bank details', cid: CID2, ip: '8.8.8.8' }), ip: '8.8.8.8' });
  assert.equal(fake.json.status, 'pending');
  const held = await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null });
  assert.match(held.json.comments[0].flag, /impersonation/);
  const sneaky = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ name: 'M a y o b e  B r o s', body: 'Please trust me', cid: 'qqqqqqqqqqqqqqqqqq56', ip: '7.7.7.7' }), ip: '7.7.7.7' });
  assert.equal(sneaky.json.status, 'pending');
});

test('spam and delete adjust the count and hide replies', async () => {
  const p = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Reply text', parent: p.json.comment.id }) });
  assert.equal((await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c, 2);
  const r = await call('POST', `/v1/admin/comments/${p.json.comment.id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'delete' } });
  assert.equal(r.json.stats.c, 0);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0);
  const q = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Another one here', cid: CID2, ip: '9.9.9.9' }), ip: '9.9.9.9' });
  assert.equal((await call('POST', `/v1/admin/comments/${q.json.comment.id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'spam' } })).json.stats.c, 0);
});

test('validation: links, names, length, email, honeypot, speed', async () => {
  for (const body of ['visit https://spam.example now', 'see www.spam.com', 'join t.me/spamchannel', 'my site is spam.xyz']) {
    assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body }) })).status, 400, body);
  }
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ name: 'A' }) })).status, 400);
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'x'.repeat(1501) }) })).status, 400);
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ email: 'not-an-email' }) })).status, 400);
  const bot = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ website: 'http://bot' }) });
  const fast = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ ts: Date.now() - 300 }) });
  assert.equal(bot.status, 202);
  assert.equal(fast.status, 202);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0, 'bot posts are silently dropped');
  assert.equal((await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null })).json.comments.length, 0);
});

test('rate limit and duplicate protection', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: `Comment number ${i} here` }) })).status, 201);
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'One more comment' }) })).status, 429);
  env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123' };
  await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  const again = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  assert.equal(again.json.status, 'duplicate');
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 1, 'duplicate within 10 minutes is ignored');
});

test('admin routes reject missing/short tokens even if ADMIN_TOKEN is unset', async () => {
  env.ADMIN_TOKEN = '';
  assert.equal((await call('GET', '/v1/admin/comments', { auth: '', origin: null })).status, 401);
  env.ADMIN_TOKEN = 'short';
  assert.equal((await call('GET', '/v1/admin/comments', { auth: 'short', origin: null })).status, 401);
});

test('bad JSON and oversize bodies', async () => {
  const res = await worker.fetch(new Request('https://api.test/v1/posts/hello-post/react', { method: 'POST', headers: { Origin: ORIGIN }, body: '{nope' }), env, { waitUntil() {} });
  assert.equal(res.status, 400);
  const big = await worker.fetch(new Request('https://api.test/v1/posts/hello-post/react', { method: 'POST', headers: { Origin: ORIGIN }, body: JSON.stringify({ x: 'y'.repeat(5000) }) }), env, { waitUntil() {} });
  assert.equal(big.status, 413);
});

/* ---------------------------------------------------------------- edit endpoint */
const mk = async (over = {}, ip = '1.1.1.1') => (await call('POST', '/v1/posts/hello-post/comments', { body: comment(over), ip })).json;
const edit = (id, token, body, opts = {}) => call('POST', `/v1/comments/${id}/edit`, { body: { token, body }, ...opts });
const rawRow = (id) => env.DB.raw.prepare('SELECT * FROM comments WHERE id = ?').get(id);

test('edit: owner can change an approved comment within 30 minutes', async () => {
  const a = await mk();
  const before = (await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c;
  const r = await edit(a.id, a.token, 'Thanks, this helped me even more.');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.status, 'approved');
  assert.equal(r.json.comment.id, a.id);
  assert.equal(r.json.comment.body, 'Thanks, this helped me even more.');
  assert.equal(typeof r.json.comment.edited, 'number');
  assert.equal(r.json.stats.c, before);
  const pub = (await call('GET', '/v1/posts/hello-post')).json.comments[0];
  assert.equal(pub.body, 'Thanks, this helped me even more.');
  assert.equal(typeof pub.edited, 'number');
  assert.equal(rawRow(a.id).prev_body, 'Thanks, this helped me a lot.');
  assert.equal(JSON.stringify(r.json).includes('prev_body'), false);
});

test("edit: wrong token, other comment's token, unknown id and junk all give the same 404", async () => {
  const a = await mk();
  const b = await mk({ body: 'A second comment here', cid: CID2 }, '2.2.2.2');
  const bodies = new Set();
  for (const tok of ['x'.repeat(32), b.token, '', '💥', null, 12345, { a: 1 }]) {
    const r = await edit(a.id, tok, 'Changed text that is fine');
    assert.equal(r.status, 404, String(tok));
    bodies.add(JSON.stringify(r.json));
  }
  for (const id of [999, 0]) {
    const r = await edit(id, a.token, 'Changed text that is fine');
    assert.equal(r.status, 404, String(id));
    bodies.add(JSON.stringify(r.json));
  }
  assert.equal(bodies.size, 1, 'every probe gets the identical answer');
  // an oversize token is refused before it is read, never a 500
  const big = await edit(a.id, 'x'.repeat(10000), 'Changed text that is fine');
  assert.ok([400, 413].includes(big.status), String(big.status));
  // non-numeric and negative ids fall through to the generic 404
  for (const id of ['abc', '-1', encodeURIComponent('1; DROP')]) assert.equal((await edit(id, a.token, 'Changed text that is fine')).status, 404, id);
  // nothing was written by any of it
  assert.equal(rawRow(a.id).prev_body, null);
  assert.equal(rawRow(a.id).edited_at, null);
  // a missing token key, and a body that is not an object
  assert.equal((await call('POST', `/v1/comments/${a.id}/edit`, { body: { body: 'Changed text that is fine' } })).status, 404);
});

test('edit: refused after 30 minutes, with a reply, with a pending reply, and on a held comment', async () => {
  const old = await mk();
  env.DB.raw.exec('UPDATE comments SET created = created - 1860000 WHERE id = ' + old.id);
  const late = await edit(old.id, old.token, 'Too late to change this');
  assert.equal(late.status, 409);
  assert.equal(late.json.error, 'The 30 minutes for editing have passed.');

  const p = await mk({ body: 'A parent comment here', cid: CID2 }, '2.2.2.2');
  await mk({ body: 'A reply to it here', parent: p.id, cid: 'qqqqqqqqqqqqqqqqqq56' }, '3.3.3.3');
  const withReply = await edit(p.id, p.token, 'Changing after a reply');
  assert.equal(withReply.status, 409);
  assert.equal(withReply.json.error, 'This comment has a reply, so it can no longer be edited.');

  const p2 = await mk({ body: 'Another parent comment', cid: 'wwwwwwwwwwwwwwwwww78' }, '4.4.4.4');
  const rep = await mk({ body: 'A reply that is held', parent: p2.id, cid: 'eeeeeeeeeeeeeeeeee90' }, '5.5.5.5');
  env.DB.raw.exec("UPDATE comments SET status = 'pending' WHERE id = " + rep.id);
  assert.equal((await edit(p2.id, p2.token, 'Changing after pending reply')).status, 409);

  const held = await mk({ body: RUDE, cid: 'rrrrrrrrrrrrrrrrrr12' }, '6.6.6.6');
  const h = await edit(held.id, held.token, 'Now I am polite and calm');
  assert.equal(h.status, 409);
  assert.equal(h.json.error, 'This comment is waiting for review, so it cannot be edited. You can still delete it.');
});

test('edit: the screen runs again and a flagged edit is held', async () => {
  const a = await mk();
  assert.equal((await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c, 1);
  const r = await edit(a.id, a.token, RUDE);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.stats.c, 0);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0);
  const list = (await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null })).json.comments;
  assert.equal(list.length, 1);
  assert.match(list[0].flag, /word:/);
  assert.equal(list[0].prev_body, 'Thanks, this helped me a lot.');
  const ok = await call('POST', `/v1/admin/comments/${a.id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  assert.equal(ok.json.stats.c, 1);
});

test('edit: links and short text are refused; an unchanged or whitespace-only change is a no-op', async () => {
  const a = await mk();
  assert.equal((await edit(a.id, a.token, 'see www.x.com')).status, 400);
  assert.equal((await edit(a.id, a.token, 'ok')).status, 400);
  assert.equal((await edit(a.id, a.token, 'x'.repeat(1501))).status, 400);
  for (const text of ['Thanks, this helped me a lot.', '  Thanks, this helped me a lot.\r\n\r\n\r\n  ', '   ']) {
    const r = await edit(a.id, a.token, text);
    if (text.trim()) {
      assert.equal(r.status, 200);
      assert.equal(r.json.status, 'approved');
      assert.equal(r.json.comment.body, 'Thanks, this helped me a lot.');
    } else assert.equal(r.status, 400, 'whitespace only is too short');
    const row = rawRow(a.id);
    assert.equal(row.edited_at, null);
    assert.equal(row.prev_body, null);
  }
});

test('edit: needs our Origin and is rate limited', async () => {
  assert.equal((await edit(1, 'x'.repeat(32), 'Some new text', { origin: null })).status, 403);
  const made = [];
  for (let i = 0; i < 3; i++) made.push(await mk({ body: `Comment number ${i} here`, cid: `cid${i}cid${i}cid${i}cid${i}` }, `10.0.0.${i}`));
  let last;
  for (let i = 0; i < 20; i++) {
    last = await edit(made[i % 3].id, made[i % 3].token, `Edited text number ${i} ok`, { ip: '9.9.9.9' });
    assert.equal(last.status, 200, `edit ${i + 1}`);
  }
  const over = await edit(made[0].id, made[0].token, 'The twenty-first edit', { ip: '9.9.9.9' });
  assert.equal(over.status, 429);
});

test('edit: the per-comment limit stops the 11th edit of one comment', async () => {
  const a = await mk();
  for (let i = 0; i < 10; i++) assert.equal((await edit(a.id, a.token, `Edit number ${i} text`, { ip: `8.8.8.${i}` })).status, 200, `edit ${i + 1}`);
  assert.equal((await edit(a.id, a.token, 'Edit number eleven', { ip: '8.8.8.99' })).status, 429);
});

test('edit: AUTO_APPROVE=false holds every edit', async () => {
  const a = await mk();
  env.AUTO_APPROVE = 'false';
  const r = await edit(a.id, a.token, 'A perfectly clean edit');
  assert.equal(r.json.status, 'pending');
  assert.match((await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null })).json.comments[0].flag, /auto-approve-off/);
});

test('edit: a visitor with an earlier spam comment is held', async () => {
  const bad = await mk({ body: 'Buy my stuff now please', cid: CID2 }, '2.2.2.2');
  await call('POST', `/v1/admin/comments/${bad.id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'spam' } });
  const a = await mk({ body: 'A normal comment here' }, '7.7.7.7');
  assert.equal(a.status, 'approved');
  env.DB.raw.exec("UPDATE comments SET cid = '" + CID2 + "' WHERE id = " + a.id); // same visitor as the spam comment
  const r = await edit(a.id, a.token, 'A normal edited comment');
  assert.equal(r.json.status, 'pending');
  assert.match((await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null })).json.comments[0].flag, /earlier-spam/);
});

/* ------------------------------------------------ edit: races, window setting, boundaries */
// Runs `hook` right after the "does it have a reply" check, i.e. between the checks and the write.
function afterReplyCheck(fn) {
  let ran = false;
  const hook = () => { if (!ran) { ran = true; fn(); } };
  const real = env.DB;
  const wrap = (st, sql) => ({
    bind: (...a) => wrap(st.bind(...a), sql),
    first: async () => { const r = await st.first(); if (sql.includes('FROM comments WHERE parent_id = ? AND status IN')) hook(); return r; },
    all: () => st.all(),
    run: () => st.run(),
    _exec: () => st._exec(),
  });
  env.DB = { ...real, prepare: (sql) => wrap(real.prepare(sql), sql), batch: (l) => real.batch(l) };
}
const approvedCount = () => env.DB.raw.prepare("SELECT COUNT(*) AS n FROM comments WHERE slug = 'hello-post' AND status = 'approved'").get().n;
const statCount = () => env.DB.raw.prepare("SELECT comments FROM post_stats WHERE slug = 'hello-post'").get().comments;

test('edit: concurrent edits (one flagged, one clean) leave the count equal to the approved rows', async () => {
  for (const order of [0, 1]) {
    env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN };
    const a = await mk();
    await mk({ body: 'Another approved one', cid: CID2 }, '2.2.2.2');
    const jobs = [edit(a.id, a.token, RUDE), edit(a.id, a.token, 'A clean and kind edit')];
    if (order) jobs.reverse();
    const out = await Promise.all(jobs);
    for (const r of out) assert.ok([200, 404, 409].includes(r.status), String(r.status));
    assert.equal(statCount(), approvedCount(), `count matches approved rows (order ${order})`);
  }
});

test('edit: a comment that became spam between the checks cannot be revived or counted', async () => {
  const a = await mk();
  afterReplyCheck(() => env.DB.raw.exec(`UPDATE comments SET status = 'spam' WHERE id = ${a.id}; UPDATE post_stats SET comments = 0 WHERE slug = 'hello-post'`));
  const r = await edit(a.id, a.token, RUDE);
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'That comment could not be found.');
  assert.equal(rawRow(a.id).status, 'spam');
  assert.equal(rawRow(a.id).body, 'Thanks, this helped me a lot.');
  assert.equal(statCount(), 0, 'the count is not lowered for a row that did not change');
});

test('edit: a reply that arrives before the write blocks the edit', async () => {
  const a = await mk();
  afterReplyCheck(() => env.DB.raw.exec(`INSERT INTO comments(slug, parent_id, name, body, status, created, cid) VALUES('hello-post', ${a.id}, 'Sam', 'A quick reply', 'approved', ${Date.now()}, 'zzzzzzzzzzzzzzzzzz99'); UPDATE post_stats SET comments = comments + 1`));
  const r = await edit(a.id, a.token, RUDE);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'This comment has a reply, so it can no longer be edited.');
  assert.equal(rawRow(a.id).body, 'Thanks, this helped me a lot.');
  assert.equal(statCount(), 2);
});

test('edit: EDIT_WINDOW_MINUTES sets the window and the message', async () => {
  env.EDIT_WINDOW_MINUTES = '5';
  const a = await mk();
  env.DB.raw.exec(`UPDATE comments SET created = created - ${4 * 60000} WHERE id = ${a.id}`);
  assert.equal((await edit(a.id, a.token, 'Edited at four minutes')).status, 200);
  env.DB.raw.exec(`UPDATE comments SET created = created - ${2 * 60000} WHERE id = ${a.id}`);
  const late = await edit(a.id, a.token, 'Edited at six minutes');
  assert.equal(late.status, 409);
  assert.equal(late.json.error, 'The 5 minutes for editing have passed.');
  env.EDIT_WINDOW_MINUTES = 'junk';
  const b = await mk({ body: 'Another comment here', cid: CID2 }, '2.2.2.2');
  env.DB.raw.exec(`UPDATE comments SET created = created - ${29 * 60000} WHERE id = ${b.id}`);
  assert.equal((await edit(b.id, b.token, 'Edited at 29 minutes')).status, 200, 'a bad setting falls back to 30');
});

test('edit: window boundary at 29 and 31 minutes', async () => {
  const a = await mk();
  const b = await mk({ body: 'Another comment here', cid: CID2 }, '2.2.2.2');
  env.DB.raw.exec(`UPDATE comments SET created = created - ${29 * 60000} WHERE id = ${a.id}`);
  env.DB.raw.exec(`UPDATE comments SET created = created - ${31 * 60000} WHERE id = ${b.id}`);
  assert.equal((await edit(a.id, a.token, 'Edited at 29 minutes')).status, 200);
  assert.equal((await edit(b.id, b.token, 'Edited at 31 minutes')).status, 409);
});

test('edit: a team reply and a spam-marked comment give the same generic 404', async () => {
  const a = await mk();
  const s = await mk({ body: 'A comment marked spam', cid: CID2 }, '2.2.2.2');
  await call('POST', `/v1/admin/comments/${s.id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'spam' } });
  const t = await call('POST', '/v1/admin/reply', { auth: env.ADMIN_TOKEN, origin: null, body: { parent: a.id, body: 'Thanks from the team' } });
  const probe = await edit(a.id, 'x'.repeat(32), 'Whatever text here');
  const team = await edit(t.json.comment.id, a.token, 'Whatever text here');
  const spam = await edit(s.id, s.token, 'Whatever text here');
  assert.equal(team.status, 404);
  assert.equal(spam.status, 404);
  assert.equal(JSON.stringify(team.json), JSON.stringify(probe.json));
  assert.equal(JSON.stringify(spam.json), JSON.stringify(probe.json));
});

/* ---------------------------------------------------------------- delete endpoint */
const del = (id, token, opts = {}) => call('POST', `/v1/comments/${id}/delete`, { body: { token }, ...opts });
const GENERIC = 'That comment could not be found.';
const reply2 = (parent, over = {}, ip = '2.2.2.2') => mk({ body: 'A reply from someone', cid: CID2, parent, ...over }, ip);
const admin = (id, action) => call('POST', `/v1/admin/comments/${id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action } });

test('delete: a comment without replies is removed and counted down', async () => {
  const a = await mk();
  assert.equal(statCount(), 1);
  const r = await del(a.id, a.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.removed, 'deleted');
  assert.equal(r.json.stats.c, 0);
  assert.equal(rawRow(a.id), undefined);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0);
  assert.equal((await del(a.id, a.token)).status, 404, 'a second delete finds nothing');
});

test('delete: a comment with a reply becomes a blanked tombstone and the reply stays', async () => {
  const a = await mk({ email: 'asha@example.com' });
  env.DB.raw.prepare("UPDATE comments SET prev_body = 'old', edited_at = 5, likes = 2, flag = 'x' WHERE id = ?").run(a.id);
  env.DB.raw.prepare('INSERT INTO comment_likes(comment_id, voter, created) VALUES(?, ?, 1)').run(a.id, 'voter-one-voter-one');
  const rep = await reply2(a.id);
  assert.equal(statCount(), 2);
  const r = await del(a.id, a.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.removed, 'tombstone');
  assert.equal(r.json.stats.c, 1);
  const pub = (await call('GET', '/v1/posts/hello-post')).json.comments;
  assert.equal(pub.length, 1);
  assert.equal(pub[0].deleted, true);
  assert.equal(pub[0].name, '');
  assert.equal(pub[0].body, 'This comment was deleted.');
  assert.equal(pub[0].replies.length, 1);
  const raw = rawRow(a.id);
  assert.equal(raw.status, 'deleted');
  assert.equal(raw.name, '');
  assert.equal(raw.body, '');
  for (const f of ['email', 'manage_hash', 'prev_body', 'ip_hash', 'cid', 'flag', 'edited_at']) assert.equal(raw[f], null, f);
  assert.equal(raw.likes, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?').get(a.id).n, 0);
  assert.equal((await del(a.id, a.token)).status, 404, 'the tombstone cannot be deleted again');
  // deleting the last reply takes the tombstone with it
  const r2 = await del(rep.id, rep.token, { ip: '2.2.2.2' });
  assert.equal(r2.status, 200);
  assert.equal(rawRow(a.id), undefined);
  assert.equal(rawRow(rep.id), undefined);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0);
  assert.equal(statCount(), 0);
});

test('delete: a held comment can be deleted without changing the count; a spam-marked or team comment cannot', async () => {
  const ok = await mk({ body: 'A normal approved one' });
  const held = await mk({ body: RUDE, cid: CID2 }, '2.2.2.2');
  assert.equal(held.status, 'pending');
  const r = await del(held.id, held.token, { ip: '2.2.2.2' });
  assert.equal(r.status, 200);
  assert.equal(r.json.stats.c, 1);
  assert.equal(statCount(), 1);
  assert.equal(rawRow(held.id), undefined);

  const bad = await mk({ body: 'Something I will regret', cid: 'spammer-spammer-spammer1' }, '3.3.3.3');
  await admin(bad.id, 'spam');
  const s = await del(bad.id, bad.token, { ip: '3.3.3.3' });
  assert.equal(s.status, 404);
  assert.equal(s.json.error, GENERIC);
  assert.equal(rawRow(bad.id).status, 'spam');
  const next = await mk({ body: 'Another comment from the spammer', cid: 'spammer-spammer-spammer1' }, '3.3.3.3');
  assert.equal(next.status, 'pending');
  assert.match(env.DB.raw.prepare('SELECT flag FROM comments WHERE id = ?').get(next.id).flag, /earlier-spam/);

  const t = await call('POST', '/v1/admin/reply', { auth: env.ADMIN_TOKEN, origin: null, body: { parent: ok.id, body: 'Thanks from the team' } });
  const team = await del(t.json.comment.id, ok.token);
  assert.equal(team.status, 404);
  assert.equal(team.json.error, GENERIC);
  assert.ok(rawRow(t.json.comment.id));
  // an older comment with no hash cannot be deleted either
  env.DB.raw.prepare('UPDATE comments SET manage_hash = NULL WHERE id = ?').run(ok.id);
  assert.equal((await del(ok.id, ok.token)).status, 404);
});

test('delete: junk ids and tokens are 404, not 500; needs Origin; rate limited', async () => {
  const a = await mk();
  for (const id of ['abc', '-5', '0', '99999999999999999999', '1.5']) assert.equal((await del(id, a.token)).status, 404, id);
  for (const tok of ['', 'short', 'x'.repeat(3000), 'é'.repeat(40), null, 12345]) {
    const r = await call('POST', `/v1/comments/${a.id}/delete`, { body: { token: tok } });
    assert.equal(r.status, 404, String(tok).slice(0, 10));
    assert.equal(r.json.error, GENERIC);
  }
  assert.equal((await del(a.id, 'x'.repeat(10000))).status, 413, 'a huge body is refused by the size limit, not a 500');
  assert.equal((await call('POST', `/v1/comments/${a.id}/delete`, { body: {} })).status, 404);
  assert.equal((await del(a.id, 'x'.repeat(32))).json.error, GENERIC);
  assert.ok(rawRow(a.id), 'nothing was deleted');
  assert.equal((await del(a.id, a.token, { origin: null })).status, 403);
  let last;
  for (let i = 0; i < 20; i++) { last = await del(a.id, 'x'.repeat(32), { ip: '8.8.8.8' }); assert.equal(last.status, 404); }
  assert.equal((await del(a.id, 'x'.repeat(32), { ip: '8.8.8.8' })).status, 429);
});

test('admin: deleting or hiding the last reply removes an orphan tombstone', async () => {
  for (const action of ['spam', 'delete']) {
    env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN };
    const a = await mk();
    const r1 = await reply2(a.id);
    const r2 = await reply2(a.id, { body: 'A second reply' }, '3.3.3.3');
    await del(a.id, a.token);
    assert.equal(rawRow(a.id).status, 'deleted');
    await admin(r1.id, action);
    assert.equal(rawRow(a.id).status, 'deleted', `${action}: another reply remains`);
    await admin(r2.id, action);
    assert.equal(rawRow(a.id), undefined, `${action}: tombstone gone`);
    assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0);
    assert.equal(statCount(), 0);
  }
});

test('admin: approve refuses a deleted tombstone', async () => {
  const a = await mk();
  await reply2(a.id);
  await del(a.id, a.token);
  const r = await admin(a.id, 'approve');
  assert.equal(r.status, 409);
  assert.equal(rawRow(a.id).status, 'deleted');
  assert.equal(rawRow(a.id).body, '');
  assert.equal(statCount(), 1);
});

test('a deleted question with a team reply keeps the public shape qa-sync needs', async () => {
  const q = await mk({ body: 'How much does the bus cost?' });
  await call('POST', '/v1/admin/reply', { auth: env.ADMIN_TOKEN, origin: null, body: { parent: q.id, body: 'It costs TSh 600.' } });
  assert.equal((await del(q.id, q.token)).json.removed, 'tombstone');
  const top = (await call('GET', '/v1/posts/hello-post')).json.comments[0];
  assert.equal(top.name, '');
  assert.ok(top.body.length > 0);
  assert.equal(top.deleted, true);
  assert.equal(top.replies[0].team, true);
});

// Runs `fn` right after the owner check (the SELECT of the comment), before the "has replies" check and the write.
function afterOwnerRow(fn) {
  let ran = false;
  const real = env.DB;
  const wrap = (st, sql) => ({
    bind: (...a) => wrap(st.bind(...a), sql),
    first: async () => { const r = await st.first(); if (!ran && sql.includes('manage_hash FROM comments WHERE id = ?')) { ran = true; fn(); } return r; },
    all: () => st.all(), run: () => st.run(), _exec: () => st._exec(),
  });
  env.DB = { ...real, prepare: (sql) => wrap(real.prepare(sql), sql), batch: (l) => real.batch(l) };
}

test('delete: a comment that became spam between the checks is not removed and the count is not lowered', async () => {
  const a = await mk();
  afterOwnerRow(() => env.DB.raw.exec(`UPDATE comments SET status = 'spam' WHERE id = ${a.id}; UPDATE post_stats SET comments = 0 WHERE slug = 'hello-post'`));
  const r = await del(a.id, a.token);
  assert.equal(r.status, 404);
  assert.equal(r.json.error, GENERIC);
  assert.equal(rawRow(a.id).status, 'spam');
  assert.equal(statCount(), 0);
});

test('delete: a reply that arrives between the checks turns the removal into a tombstone', async () => {
  const a = await mk();
  env.DB.raw.prepare('INSERT INTO comment_likes(comment_id, voter, created) VALUES(?, ?, 1)').run(a.id, 'voter-one-voter-one');
  afterOwnerRow(() => env.DB.raw.exec(`INSERT INTO comments(slug, parent_id, name, body, status, created, cid) VALUES('hello-post', ${a.id}, 'Sam', 'A quick reply', 'approved', ${Date.now()}, 'zzzzzzzzzzzzzzzzzz99'); UPDATE post_stats SET comments = comments + 1`));
  const r = await del(a.id, a.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.removed, 'tombstone');
  assert.equal(rawRow(a.id).status, 'deleted');
  assert.equal(statCount(), 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?').get(a.id).n, 0);
});

test('delete: two deletes at once lower the count only once', async () => {
  const a = await mk();
  await mk({ body: 'Another approved one', cid: CID2 }, '2.2.2.2');
  const out = await Promise.all([del(a.id, a.token), del(a.id, a.token)]);
  assert.deepEqual(out.map((r) => r.status).sort(), [200, 404]);
  assert.equal(statCount(), 1);
  assert.equal(statCount(), approvedCount());
});
