// Tests the Worker against a real SQLite engine (Node's built-in node:sqlite) wrapped to look like Cloudflare D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';
import { takeBudget, sendMail } from '../../worker/src/mail.js';

const ORIGIN = 'https://mayobebros.com';
const CID = 'abcdefabcdefabcdef12';
const CID2 = 'zzzzzzzzzzzzzzzzzz34';
let env;
const realFetch = globalThis.fetch;
// Mail: every request to Resend is recorded in `sent`; `resendMode` can make it fail. Promises given to waitUntil are kept so a test can await them.
let sent = [];
let resendMode = 'ok';
let pendingMail = [];
test.before(() => {
  globalThis.fetch = async (u, init) => {
    if (String(u).endsWith('/data/search.json')) return new Response(JSON.stringify([{ s: 'hello-post', t: 'Hello Post Title', u: '/post/guides/hello-post/' }, { s: 'second-post', t: 'Second Post', u: '/post/second-post/' }]), { status: 200 });
    if (String(u) === 'https://api.resend.com/emails') {
      sent.push({ body: JSON.parse(init.body), raw: init.body, headers: init.headers });
      if (resendMode === 'throw') throw new Error('network down');
      if (resendMode === '500') return new Response('{"message":"boom"}', { status: 500 });
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
});
const EXPECT_HOSTILE = 10; // 4 approved hostile replies (a reply notice + a question alert each), 1 hostile reply held by the screen, 1 held top-level comment
const flushMail = async () => { while (pendingMail.length) await Promise.all(pendingMail.splice(0)); };
test.after(() => { globalThis.fetch = realFetch; });
test.afterEach(async () => { await flushMail(); }); // mail from one test must never leak into the next
test.beforeEach(() => { sent = []; resendMode = 'ok'; pendingMail = []; env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key' }; });

async function call(method, path, { body, origin = ORIGIN, auth, ip = '1.1.1.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: (p) => { pendingMail.push(p); } });
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

const NO_EDIT = 'Comment can no longer be edited.';
test('edit: refused after 30 minutes, with a reply, with a pending reply, and on a held comment', async () => {
  const old = await mk();
  env.DB.raw.exec('UPDATE comments SET created = created - 1860000 WHERE id = ' + old.id);
  const late = await edit(old.id, old.token, 'Too late to change this');
  assert.equal(late.status, 409);
  assert.equal(late.json.error, NO_EDIT);

  const p = await mk({ body: 'A parent comment here', cid: CID2 }, '2.2.2.2');
  await mk({ body: 'A reply to it here', parent: p.id, cid: 'qqqqqqqqqqqqqqqqqq56' }, '3.3.3.3');
  const withReply = await edit(p.id, p.token, 'Changing after a reply');
  assert.equal(withReply.status, 409);
  assert.equal(withReply.json.error, NO_EDIT);

  const p2 = await mk({ body: 'Another parent comment', cid: 'wwwwwwwwwwwwwwwwww78' }, '4.4.4.4');
  const rep = await mk({ body: 'A reply that is held', parent: p2.id, cid: 'eeeeeeeeeeeeeeeeee90' }, '5.5.5.5');
  env.DB.raw.exec("UPDATE comments SET status = 'pending' WHERE id = " + rep.id);
  const pendingReply = await edit(p2.id, p2.token, 'Changing after pending reply');
  assert.equal(pendingReply.status, 409);
  assert.equal(pendingReply.json.error, NO_EDIT);

  const held = await mk({ body: RUDE, cid: 'rrrrrrrrrrrrrrrrrr12' }, '6.6.6.6');
  const h = await edit(held.id, held.token, 'Now I am polite and calm');
  assert.equal(h.status, 409);
  assert.equal(h.json.error, NO_EDIT, 'the same words for a held comment, a reply and a late edit: nothing says why');
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

test('admin list shows the text before an edit', async () => {
  const a = await mk();
  const before = Date.now();
  assert.equal((await edit(a.id, a.token, RUDE)).json.status, 'pending');
  const row = (await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null })).json.comments[0];
  assert.equal(row.prev_body, 'Thanks, this helped me a lot.');
  assert.equal(typeof row.edited_at, 'number');
  assert.ok(row.edited_at >= before - 1000);
  // approved again: the public list shows only the "edited" time, never the old text or edited_at
  await admin(a.id, 'approve');
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  const raw = JSON.stringify(pub);
  assert.equal(raw.includes('prev_body'), false);
  assert.equal(raw.includes('edited_at'), false);
  assert.equal(raw.includes('Thanks, this helped'), false);
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
  assert.equal(r.json.error, 'Comment not found.');
  assert.equal(rawRow(a.id).status, 'spam');
  assert.equal(rawRow(a.id).body, 'Thanks, this helped me a lot.');
  assert.equal(statCount(), 0, 'the count is not lowered for a row that did not change');
});

test('edit: a reply that arrives before the write blocks the edit', async () => {
  const a = await mk();
  afterReplyCheck(() => env.DB.raw.exec(`INSERT INTO comments(slug, parent_id, name, body, status, created, cid) VALUES('hello-post', ${a.id}, 'Sam', 'A quick reply', 'approved', ${Date.now()}, 'zzzzzzzzzzzzzzzzzz99'); UPDATE post_stats SET comments = comments + 1`));
  const r = await edit(a.id, a.token, RUDE);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, NO_EDIT);
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
  assert.equal(late.json.error, NO_EDIT, 'the message never names the window');
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
const GENERIC = 'Comment not found.';
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

/* ---------------------------------------------------------------- admin actions: races and tombstones */
// Runs `fn` right after the admin route has read the comment, before it writes.
function afterAdminRead(fn) {
  let ran = false;
  const real = env.DB;
  const wrap = (st, sql) => ({
    bind: (...a) => wrap(st.bind(...a), sql),
    first: async () => { const r = await st.first(); if (!ran && sql.startsWith('SELECT id, slug, parent_id, status FROM comments')) { ran = true; fn(); } return r; },
    all: () => st.all(), run: () => st.run(), _exec: () => st._exec(),
  });
  env.DB = { ...real, prepare: (sql) => wrap(real.prepare(sql), sql), batch: (l) => real.batch(l) };
}

test('admin approve: an owner delete between the read and the write leaves no row and no extra count', async () => {
  const held = await mk({ body: RUDE });
  assert.equal(held.status, 'pending');
  afterAdminRead(() => env.DB.raw.prepare('DELETE FROM comments WHERE id = ?').run(held.id));
  const r = await admin(held.id, 'approve');
  assert.equal(r.status, 404);
  assert.equal(rawRow(held.id), undefined);
  assert.equal(statCount(), 0);
  assert.equal(statCount(), approvedCount());
});

test('admin spam and delete: an owner delete between the read and the write does not subtract twice', async () => {
  for (const action of ['spam', 'delete']) {
    env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN };
    const a = await mk();
    await mk({ body: 'Another approved one', cid: CID2 }, '2.2.2.2');
    assert.equal(statCount(), 2);
    afterAdminRead(() => env.DB.raw.exec(`DELETE FROM comments WHERE id = ${a.id}; UPDATE post_stats SET comments = comments - 1 WHERE slug = 'hello-post'`)); // what the owner delete does
    const r = await admin(a.id, action);
    assert.equal(r.status, 200);
    assert.equal(statCount(), 1, `${action}: the other comment is still counted`);
    assert.equal(statCount(), approvedCount());
  }
});

test('admin spam and delete count each approved comment in the thread exactly once', async () => {
  for (const action of ['spam', 'delete']) {
    env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN };
    const a = await mk();
    await reply2(a.id);
    await mk({ body: 'Unrelated approved one', cid: 'other-other-other-other' }, '4.4.4.4');
    assert.equal(statCount(), 3);
    assert.equal((await admin(a.id, action)).json.stats.c, 1, action);
    assert.equal(statCount(), approvedCount());
  }
});

test('admin spam on a tombstone leaves it deleted (and removes it once it is an orphan); approve then refuses it', async () => {
  const a = await mk();
  await reply2(a.id);
  await del(a.id, a.token);
  assert.equal(rawRow(a.id).status, 'deleted');
  const r = await admin(a.id, 'spam');
  assert.equal(r.status, 200);
  assert.equal(rawRow(a.id), undefined, 'the reply was hidden, so the tombstone has no reason to stay');
  assert.equal(statCount(), 0);
  // a tombstone that still has a live reply stays deleted when only the tombstone is acted on by approve
  const b = await mk({ body: 'Second thread here', cid: 'second-second-second1' }, '5.5.5.5');
  await reply2(b.id, { cid: 'replier-replier-replier' }, '6.6.6.6'); // a new visitor: CID2 was just marked as spam
  await del(b.id, b.token, { ip: '5.5.5.5' });
  const ap = await admin(b.id, 'approve');
  assert.equal(ap.status, 409);
  assert.equal(rawRow(b.id).status, 'deleted');
  assert.equal(rawRow(b.id).body, '');
  assert.equal(statCount(), 1);
});

test('admin delete of a tombstone removes it and its replies; delete also removes the like rows', async () => {
  const a = await mk();
  const rep = await reply2(a.id);
  const lk = env.DB.raw.prepare('INSERT INTO comment_likes(comment_id, voter, created) VALUES(?, ?, 1)');
  lk.run(a.id, 'voter-one-voter-one'); lk.run(rep.id, 'voter-two-voter-two');
  const other = await mk({ body: 'Unrelated approved one', cid: 'other-other-other-other' }, '4.4.4.4');
  lk.run(other.id, 'voter-one-voter-one');
  await del(a.id, a.token); // tombstone: its own likes go already
  const r = await admin(a.id, 'delete');
  assert.equal(r.status, 200);
  assert.equal(rawRow(a.id), undefined);
  assert.equal(rawRow(rep.id), undefined);
  const left = env.DB.raw.prepare('SELECT comment_id FROM comment_likes').all().map((x) => x.comment_id);
  assert.deepEqual(left, [other.id], 'only the unrelated comment keeps its like');
  assert.equal(statCount(), 1);
  // a live comment with a reply: both comments' likes go
  const b = await mk({ body: 'Third thread here', cid: 'third-third-third-third' }, '7.7.7.7');
  const rb = await reply2(b.id, {}, '8.8.8.8');
  lk.run(b.id, 'voter-three-voter-3'); lk.run(rb.id, 'voter-four-voter-44');
  await admin(b.id, 'delete');
  assert.deepEqual(env.DB.raw.prepare('SELECT comment_id FROM comment_likes').all().map((x) => x.comment_id), [other.id]);
});

/* ---------------------------------------------------------------- likes */
const like = (id, cid, on = true, opts = {}) => call('POST', `/v1/comments/${id}/like`, { body: { cid, on }, ...opts });
const likeRows = (id) => env.DB.raw.prepare('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?').get(id).n;
const likesCol = (id) => rawRow(id).likes;
const pubLikes = async (id) => (await call('GET', '/v1/posts/hello-post')).json.comments.find((c) => c.id === id).likes;

test('like: add, repeat, remove; counts per comment', async () => {
  const a = await mk();
  const b = await mk({ body: 'A second comment here', cid: CID2 }, '2.2.2.2');
  let r = await like(a.id, CID);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, likes: 1, liked: true });
  r = await like(a.id, CID2);
  assert.equal(r.json.likes, 2);
  r = await like(a.id, CID);
  assert.deepEqual(r.json, { ok: true, likes: 2, liked: true }, 'the same visitor twice does not double count');
  assert.equal(await pubLikes(a.id), 2);
  assert.equal(await pubLikes(b.id), 0, 'another comment is not affected');
  const mine = await call('GET', `/v1/posts/hello-post?cid=${CID}`);
  assert.deepEqual(mine.json.liked, [a.id]);
  assert.equal(mine.headers.get('cache-control'), 'no-cache');
  await like(b.id, CID2);
  assert.deepEqual((await call('GET', `/v1/posts/hello-post?cid=${CID2}`)).json.liked.sort(), [a.id, b.id].sort());
  assert.deepEqual((await call('GET', `/v1/posts/hello-post?cid=${CID}`)).json.liked, [a.id], 'not listed for the other visitor');
  for (const q of ['', '?cid=short', '?cid=%00%00']) assert.equal('liked' in (await call('GET', `/v1/posts/hello-post${q}`)).json, false, `no liked key for "${q}"`);
  r = await like(a.id, CID, false);
  assert.deepEqual(r.json, { ok: true, likes: 1, liked: false });
  r = await like(a.id, CID, false);
  assert.deepEqual(r.json, { ok: true, likes: 1, liked: false }, 'removing twice does not go lower');
  r = await like(a.id, CID2, false);
  assert.equal(r.json.likes, 0);
  r = await like(a.id, 'visitor-who-never-liked', false);
  assert.equal(r.json.likes, 0, 'never below 0');
  assert.equal(await pubLikes(a.id), 0);
  assert.equal(likesCol(a.id), likeRows(a.id));
});

test('like: only approved comments, valid visitor id, our Origin', async () => {
  const held = await mk({ body: RUDE });
  assert.equal(held.status, 'pending');
  assert.equal((await like(held.id, CID)).status, 404, 'held comment');
  const a = await mk({ body: 'A normal approved one', cid: CID2 }, '2.2.2.2');
  assert.equal((await like(a.id, 'short')).status, 400);
  assert.equal((await call('POST', `/v1/comments/${a.id}/like`, { body: { cid: CID } })).status, 400, 'on must be true or false');
  assert.equal((await like(a.id, CID, true, { origin: null })).status, 403);
  assert.equal((await like(a.id, CID, true, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await like(99999, CID)).status, 404);
  for (const id of ['abc', '-1', '0', '99999999999999999999999']) assert.equal((await like(id, CID)).status, 404, id);
  assert.equal(likeRows(a.id), 0);
  // spam, and a comment that a flagged edit moved back to pending
  const s = await mk({ body: 'Soon to be hidden', cid: 'spam-spam-spam-spam-1' }, '3.3.3.3');
  await like(s.id, CID);
  await admin(s.id, 'spam');
  assert.equal((await like(s.id, CID2)).status, 404);
  assert.equal((await like(s.id, CID, false)).status, 404, 'unlike on a hidden comment is the same 404');
  const e = await mk({ body: 'Edit me please', cid: 'edit-edit-edit-edit-1' }, '4.4.4.4');
  assert.equal((await edit(e.id, e.token, RUDE, { ip: '4.4.4.4' })).json.status, 'pending');
  assert.equal((await like(e.id, CID)).status, 404);
  assert.equal(likesCol(e.id), likeRows(e.id));
});

test('like: a tombstone cannot be liked', async () => {
  const a = await mk();
  await reply2(a.id);
  await del(a.id, a.token);
  assert.equal(rawRow(a.id).status, 'deleted');
  assert.equal((await like(a.id, CID)).status, 404);
  assert.equal(likeRows(a.id), 0);
  assert.equal(likesCol(a.id), 0);
});

test('like: a UNIQUE conflict from a double tap is not an error', async () => {
  const a = await mk();
  // the row exists but the counter was not moved yet (as if another tap was half way through)
  env.DB.raw.prepare('INSERT INTO comment_likes(comment_id, voter, created) VALUES(?, ?, 1)').run(a.id, CID);
  let r = await like(a.id, CID);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, likes: 1, liked: true }, 'the count agrees with the rows');
  assert.equal(likesCol(a.id), likeRows(a.id));
  // two taps at once
  const b = await mk({ body: 'Another approved one', cid: CID2 }, '2.2.2.2');
  const out = await Promise.all([like(b.id, CID, true, { ip: '5.5.5.5' }), like(b.id, CID, true, { ip: '5.5.5.5' })]);
  assert.deepEqual(out.map((x) => x.status), [200, 200]);
  assert.equal(likesCol(b.id), 1);
  assert.equal(likeRows(b.id), 1);
});

test('like: parallel on/off/on requests leave the counter equal to the rows', async () => {
  const a = await mk();
  for (let round = 0; round < 5; round++) {
    const out = await Promise.all([like(a.id, CID, true), like(a.id, CID, false), like(a.id, CID, true), like(a.id, CID2, true), like(a.id, CID2, false), like(a.id, CID, false)]);
    for (const x of out) assert.equal(x.status, 200);
    assert.equal(likesCol(a.id), likeRows(a.id), `round ${round}`);
  }
  // a race hook: the row is hidden between the check and the write
  const real = env.DB;
  let ran = false;
  const wrap = (st, sql) => ({
    bind: (...x) => wrap(st.bind(...x), sql),
    first: async () => { const r = await st.first(); if (!ran && sql.startsWith("SELECT id, slug FROM comments WHERE id = ? AND status = 'approved'")) { ran = true; real.raw.exec(`UPDATE comments SET status = 'spam' WHERE id = ${a.id}`); } return r; },
    all: () => st.all(), run: () => st.run(), _exec: () => st._exec(),
  });
  env.DB = { ...real, prepare: (sql) => wrap(real.prepare(sql), sql), batch: (l) => real.batch(l) };
  const before = { rows: likeRows(a.id), col: likesCol(a.id) };
  const r = await like(a.id, 'brand-new-visitor-id-1');
  assert.ok([404, 200].includes(r.status));
  assert.equal(likeRows(a.id), before.rows, 'no like row for a comment that was hidden meanwhile');
  assert.equal(likesCol(a.id), before.col);
});

test('like: deleting a comment removes its likes', async () => {
  const a = await mk();
  await like(a.id, CID); await like(a.id, CID2);
  assert.equal(likeRows(a.id), 2);
  assert.equal((await del(a.id, a.token)).json.removed, 'deleted');
  assert.equal(likeRows(a.id), 0);
  assert.equal((await like(a.id, CID)).status, 404);
  const b = await mk({ body: 'Second thread starter', cid: 'second-second-second-2' }, '3.3.3.3');
  await like(b.id, CID); await like(b.id, CID2);
  await reply2(b.id);
  assert.equal((await del(b.id, b.token, { ip: '3.3.3.3' })).json.removed, 'tombstone');
  assert.equal(likeRows(b.id), 0);
  assert.equal(likesCol(b.id), 0);
});

test('like: rate limited', async () => {
  const a = await mk();
  let last;
  for (let i = 0; i < 120; i++) { last = await like(a.id, CID, i % 2 === 0, { ip: '9.9.9.9' }); assert.equal(last.status, 200, `request ${i + 1}`); }
  last = await like(a.id, CID, true, { ip: '9.9.9.9' });
  assert.equal(last.status, 429);
  assert.equal((await like(a.id, CID, true, { ip: '8.8.8.8' })).status, 200, 'another visitor address is not limited');
});

/* ---------------------------------------------------------------- control characters */
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const hasCtrl = (row) => ['name', 'email', 'body', 'prev_body', 'flag'].some((k) => CTRL.test(String(row[k] ?? '')));

test('control characters are stripped from a new comment body and name; newlines stay', async () => {
  const a = await mk({ name: 'As\u001b[2Jha\u0007', body: 'Hello \u001b[31mred\u001b[0m \u001b]52;c;aGk=\u0007 next\u0085line\u009b end\ttab\u0000' });
  assert.equal(a.status, 'approved');
  const row = rawRow(a.id);
  assert.equal(hasCtrl(row), false);
  assert.equal(row.name, 'As[2Jha');
  assert.equal(row.body.includes('\n'), false);
  const ml = await mk({ body: 'First line here.\n\nSecond line\r\nthird line' }, '2.2.2.2');
  assert.equal(rawRow(ml.id).body, 'First line here.\n\nSecond line\nthird line');
});

test('a body made only of control characters is too short, not stored empty', async () => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: '\u001b\u0007\u0085\u009b\u0000\u001b' }) });
  assert.equal(r.status, 400);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  const n = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ name: '\u001b\u001b\u001b' }) });
  assert.equal(n.status, 400);
});

test('control characters cannot hide an abusive word from the screen', async () => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'You are an id\u001biot and a fool.' }) });
  assert.equal(r.status, 202);
  assert.equal(r.json.status, 'pending');
});

test('an email with a control character is refused', async () => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ email: 'a\u001b[2J@example.com' }) });
  assert.equal(r.status, 400);
});

test('an edit is cleaned the same way', async () => {
  const a = await mk();
  const r = await edit(a.id, a.token, 'Changed \u001b[31mtext\u001b[0m\u0085 here\u009b\nline two');
  assert.equal(r.status, 200);
  const row = rawRow(a.id);
  assert.equal(hasCtrl(row), false);
  assert.equal(row.body, 'Changed [31mtext[0m here\nline two');
  assert.equal(r.json.comment.body, row.body);
  const only = await edit(a.id, a.token, '\u001b\u0007\u0085');
  assert.equal(only.status, 400);
  assert.equal(rawRow(a.id).body, row.body);
});

/* ------------------------------------------------------------------ Task 4: comment emails */
import { looksLikeQuestion } from '../../worker/src/question.js';
import fs from 'node:fs';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const MAILBOX = 'asha@example.com';
const post = (body, ip = '1.1.1.1') => call('POST', '/v1/posts/hello-post/comments', { body, ip });
const mail = (to) => sent.filter((m) => m.body.to[0] === to);
const linkOf = (m) => (m.body.text.match(/https:\/\/mayobebros\.com\/manage\/#l=([A-Za-z0-9_-]+)/) || [])[1];
const unsubOf = (m) => (m.body.text.match(/https:\/\/mayobebros\.com\/manage\/#u=([A-Za-z0-9_-]+)/) || [])[1];
const exchange = (link, ip = '1.1.1.1') => call('POST', '/v1/manage/exchange', { body: { link }, ip });
// a confirmed commenter: comments with notify, opens the emailed link
async function confirmed(over = {}) {
  const r = await post(comment({ email: MAILBOX, notify: true, ...over }));
  await flushMail();
  const link = linkOf(sent.at(-1));
  const x = await exchange(link);
  sent = [];
  return { ...r.json, link, device: x.json.token };
}

test('question.js: English and Swahili questions are recognised, plain statements are not', () => {
  for (const q of ['Can I apply with a diploma', 'how long does it take', 'Thanks. When is the deadline', 'Is this free', 'Does it work', 'Nini kinahitajika', 'Vipi kuhusu ada', 'Je, naweza kujiunga', 'Ni wapi ofisi', 'Naweza kuomba mara ngapi', 'Inawezekana kujiunga leo', 'it works??', 'really?', 'Great post, where do I sign\nand when'])
    assert.equal(looksLikeQuestion(q), true, q);
  for (const s of ['Thanks, this helped me a lot.', 'Great article', 'Asante sana kwa makala hii', 'However it was useful', 'I did it yesterday'])
    assert.equal(looksLikeQuestion(s), false, s);
  assert.equal(looksLikeQuestion(null), false);
  assert.equal(looksLikeQuestion(undefined), false);
  assert.equal(looksLikeQuestion(42), false);
});

test('qa-sync imports looksLikeQuestion and no longer carries its own regex', () => {
  const src = fs.readFileSync(new URL('../qa-sync.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ looksLikeQuestion \} from '\.\.\/worker\/src\/question\.js'/);
  assert.doesNotMatch(src, /const QUESTION\s*=/);
});

test('ticking notify with an email sends one manage-link mail with no visitor text and no clear token stored', async () => {
  const r = await post(comment({ name: 'Secret Name Zed', body: 'Secret body words qwerty here.', email: MAILBOX, notify: true }));
  assert.equal(r.status, 201);
  await flushMail();
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.deepEqual(m.body.to, [MAILBOX]);
  const everything = `${m.body.subject}\n${m.body.html}\n${m.body.text}`;
  assert.equal(everything.includes('Secret Name Zed'), false);
  assert.equal(everything.includes('Secret body words'), false);
  assert.ok(everything.includes('Hello Post Title'), 'our own article title is used');
  assert.ok(m.body.text.includes('https://mayobebros.com/post/guides/hello-post/'), 'the real post URL from the site data');
  const tok = linkOf(m);
  assert.ok(tok && tok.length >= 32);
  assert.equal(m.headers['Idempotency-Key'], `link-${r.json.id}`);
  assert.ok(m.body.html.includes(`#l=${tok}`));
  const rows = env.DB.raw.prepare('SELECT * FROM manage_links').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hash, sha256(tok));
  assert.equal(rows[0].kind, 'link');
  assert.equal(rows[0].comment_id, r.json.id);
  assert.ok(Math.abs(rows[0].expires - (rows[0].created + 7 * 86400000)) < 1000);
  assert.equal(JSON.stringify(env.DB.raw.prepare('SELECT * FROM manage_links').all()).includes(tok), false);
  assert.equal(env.DB.raw.prepare('SELECT notify_wanted, notify_confirmed FROM comments WHERE id = ?').get(r.json.id).notify_wanted, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM hits WHERE k LIKE ?').get(`%${MAILBOX}%`).n, 0, 'no raw email in hits');
});

test('manage-link mail for an unknown post title falls back to fixed text', async () => {
  env.DB.raw.prepare('INSERT INTO posts(slug, created) VALUES(?, ?)').run('second-post', 1);
  const r = await call('POST', '/v1/posts/second-post/comments', { body: comment({ email: MAILBOX, notify: true }) });
  await flushMail();
  assert.equal(r.status, 201);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].body.text.includes('Second Post'));
});

test('no manage-link mail without notify, without an email, or for duplicate and bot posts', async () => {
  await post(comment({ email: MAILBOX }));
  await post(comment({ body: 'Another one here', notify: true }));
  await post(comment({ body: 'Third one here', email: '', notify: true }));
  await flushMail();
  assert.equal(sent.length, 0);
  await post(comment({ body: 'Real one', email: MAILBOX, notify: true }));
  await flushMail();
  assert.equal(sent.length, 1);
  await post(comment({ body: 'Real one', email: MAILBOX, notify: true })); // duplicate
  await post(comment({ body: 'Bot one', email: 'bot@example.com', notify: true, website: 'http://x' })); // bot
  await post(comment({ body: 'Fast one', email: 'fast@example.com', notify: true, ts: Date.now() })); // too fast
  await flushMail();
  assert.equal(sent.length, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM manage_links').get().n, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM comments WHERE notify_wanted = 1").get().n, 1);
});

test('notify must be exactly true, and a bad address is refused with no mail', async () => {
  await post(comment({ email: MAILBOX, notify: 'yes' }));
  await post(comment({ body: 'Second text', email: MAILBOX, notify: 1 }));
  await flushMail();
  assert.equal(sent.length, 0);
  const bad = await post(comment({ body: 'Third text', email: 'nope', notify: true }));
  assert.equal(bad.status, 400);
  await flushMail();
  assert.equal(sent.length, 0);
});

test('at most one manage-link mail per address per day, and five per IP per day; the comment is saved anyway', async () => {
  await post(comment({ email: MAILBOX, notify: true }), '2.2.2.2');
  const second = await post(comment({ body: 'Second note here', email: 'ASHA@example.com', notify: true }), '3.3.3.3');
  assert.equal(second.status, 201);
  await flushMail();
  assert.equal(sent.length, 1, 'the same address (any case) gets one a day');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 2);
  // per IP: six different addresses from one IP, only five mails
  env.DB.raw.exec('DELETE FROM hits');
  sent = [];
  for (let i = 0; i < 6; i++) {
    const r = await post(comment({ body: `Note number ${i}`, email: `u${i}@example.com`, notify: true, cid: `visitorid-${i}-abcdefghij` }), '4.4.4.4');
    if (r.status === 429) break;
  }
  await flushMail();
  assert.ok(sent.length <= 5, `sent ${sent.length}`);
  assert.equal(sent.length, 5);
});

test('exchange: a device token works for edit and delete, confirms notices, and the link is reusable until it expires', async () => {
  const r = await post(comment({ email: MAILBOX, notify: true }));
  await flushMail();
  const link = linkOf(sent[0]);
  const x = await exchange(link);
  assert.equal(x.status, 200);
  assert.equal(x.json.ok, true);
  assert.equal(x.json.id, r.json.id);
  assert.equal(x.json.slug, 'hello-post');
  assert.equal(x.json.path, '/post/guides/hello-post/'); // the real article address, from the site's own article list
  assert.match(x.json.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(x.json.token, link);
  assert.equal(env.DB.raw.prepare('SELECT notify_confirmed FROM comments WHERE id = ?').get(r.json.id).notify_confirmed, 1);
  const dev = env.DB.raw.prepare("SELECT * FROM manage_links WHERE kind = 'device'").get();
  assert.equal(dev.hash, sha256(x.json.token));
  assert.equal(dev.expires, null);
  // the second exchange gives a different device token, and both work
  const y = await exchange(link, '9.9.9.9');
  assert.equal(y.status, 200);
  assert.notEqual(y.json.token, x.json.token);
  const e = await call('POST', `/v1/comments/${r.json.id}/edit`, { body: { token: x.json.token, body: 'Edited from my phone' } });
  assert.equal(e.status, 200);
  assert.equal(e.json.comment.body, 'Edited from my phone');
  // a device token is for its own comment only
  const other = await post(comment({ body: 'Someone else here', cid: CID2 }), '5.5.5.5');
  assert.equal((await call('POST', `/v1/comments/${other.json.id}/delete`, { body: { token: x.json.token } })).status, 404);
  const d = await call('POST', `/v1/comments/${r.json.id}/delete`, { body: { token: y.json.token } });
  assert.equal(d.status, 200);
});

test('exchange: expired, unknown, deleted, malformed and wrong-kind links all give the one generic 404', async () => {
  const r = await post(comment({ email: MAILBOX, notify: true }));
  await flushMail();
  const link = linkOf(sent[0]);
  const generic = await exchange('x'.repeat(32));
  assert.equal(generic.status, 404);
  assert.equal(generic.json.error, 'Link is invalid or expired.');
  assert.deepEqual((await exchange('short')).json, generic.json);
  assert.deepEqual((await call('POST', '/v1/manage/exchange', { body: {} })).json, generic.json);
  assert.deepEqual((await call('POST', '/v1/manage/exchange', { body: { link: { a: 1 } } })).json, generic.json);
  // a device token is not a link
  const ok = await exchange(link);
  assert.deepEqual((await exchange(ok.json.token)).json, generic.json);
  // expired by raw DB
  env.DB.raw.prepare("UPDATE manage_links SET expires = ? WHERE kind = 'link'").run(Date.now() - 1);
  const ex = await exchange(link);
  assert.equal(ex.status, 404);
  assert.deepEqual(ex.json, generic.json);
  env.DB.raw.prepare("UPDATE manage_links SET expires = ? WHERE kind = 'link'").run(Date.now() + 100000);
  assert.equal((await exchange(link)).status, 200);
  // a deleted (here: spam) comment
  env.DB.raw.prepare("UPDATE comments SET status = 'spam' WHERE id = ?").run(r.json.id);
  assert.deepEqual((await exchange(link)).json, generic.json);
  env.DB.raw.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?").run(r.json.id);
  assert.deepEqual((await exchange(link)).json, generic.json);
  // origin rule
  assert.equal((await call('POST', '/v1/manage/exchange', { body: { link }, origin: 'https://evil.example' })).status, 403);
});

test('exchange does not confirm notices when the commenter did not ask for them', async () => {
  const r = await post(comment({ email: MAILBOX }));
  const link = 'L'.repeat(32);
  env.DB.raw.prepare("INSERT INTO manage_links(hash, comment_id, kind, expires, created) VALUES(?, ?, 'link', ?, ?)").run(sha256(link), r.json.id, Date.now() + 100000, Date.now());
  assert.equal((await exchange(link)).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT notify_confirmed FROM comments WHERE id = ?').get(r.json.id).notify_confirmed, 0);
});

test('exchange is rate limited per IP', async () => {
  let last;
  for (let i = 0; i < 40; i++) last = await exchange(`${'a'.repeat(31)}${i % 10}`, '8.8.8.8');
  assert.equal(last.status, 429);
});

test('reply notice: a reply to a confirmed commenter sends one escaped mail with an unsubscribe link', async () => {
  const a = await confirmed({ name: 'Asha Mwangi' });
  const rep = await post(comment({ name: 'Bob <b>Bold</b>', body: 'My <script>alert(1)</script> "answer" & more', cid: CID2, parent: a.id }), '6.6.6.6');
  assert.equal(rep.status, 201);
  await flushMail();
  const got = mail(MAILBOX);
  assert.equal(got.length, 1);
  const m = got[0];
  assert.equal(m.headers['Idempotency-Key'], `reply-${rep.json.id}`);
  assert.equal(m.body.html.includes('<script>'), false);
  assert.ok(m.body.html.includes('&lt;script&gt;'));
  assert.equal(m.body.html.includes('<b>Bold</b>'), false);
  assert.ok(m.body.text.includes('alert(1)'));
  assert.match(m.body.text, /Hi Asha,/);
  const u = unsubOf(m);
  assert.ok(u && u.length >= 32);
  assert.equal(env.DB.raw.prepare("SELECT kind FROM manage_links WHERE hash = ?").get(sha256(u)).kind, 'unsub');
  assert.equal(m.body.html.includes('Hello Post Title'), true);
});

test('reply notice: none for the same visitor, an unconfirmed parent, an unsubscribed one, or a suppressed address', async () => {
  // not confirmed (opted in, never opened the link)
  const p = await post(comment({ email: MAILBOX, notify: true, body: 'Parent A text' }));
  await flushMail(); sent = [];
  env.DB.raw.exec('DELETE FROM hits');
  await post(comment({ body: 'Reply to unconfirmed', cid: CID2, parent: p.json.id }), '6.6.6.6');
  await flushMail();
  assert.equal(sent.length, 0);
  // same cid as the parent
  const a = await confirmed({ body: 'Parent B text', cid: 'cidforparentbb-123456' });
  await post(comment({ body: 'My own followup', cid: 'cidforparentbb-123456', parent: a.id }), '7.7.7.7');
  await flushMail();
  assert.equal(mail(MAILBOX).length, 0);
  // suppressed
  env.DB.raw.prepare('INSERT INTO suppressed(email, reason, created) VALUES(?, ?, ?)').run(MAILBOX, 'bounce', 1);
  await post(comment({ body: 'Reply while suppressed', cid: CID2, parent: a.id }), '6.6.6.6');
  await flushMail();
  assert.equal(sent.length, 0);
  env.DB.raw.exec('DELETE FROM suppressed');
  env.DB.raw.exec('DELETE FROM hits'); // the suppressed try used up today's one notice for this comment
  // unsubscribe
  await post(comment({ body: 'Reply that sends', cid: CID2, parent: a.id }), '6.6.6.6');
  await flushMail();
  assert.equal(sent.length, 1);
  const u = unsubOf(sent[0]);
  const un = await call('POST', '/v1/notify/unsubscribe', { body: { token: u } });
  assert.equal(un.status, 200);
  const again = await call('POST', '/v1/notify/unsubscribe', { body: { token: u } });
  assert.equal(again.status, 200, 'idempotent');
  const flags = env.DB.raw.prepare('SELECT notify_wanted, notify_confirmed FROM comments WHERE id = ?').get(a.id);
  assert.deepEqual({ ...flags }, { notify_wanted: 0, notify_confirmed: 0 });
  env.DB.raw.exec('DELETE FROM hits');
  sent = [];
  await post(comment({ body: 'Reply after stop', cid: 'thirdvisitorid-123456', parent: a.id }), '6.6.6.6');
  await flushMail();
  assert.equal(sent.length, 0);
  // an unknown unsubscribe token is the generic 404
  const bad = await call('POST', '/v1/notify/unsubscribe', { body: { token: 'z'.repeat(32) } });
  assert.equal(bad.status, 404);
  assert.equal(bad.json.error, 'Link is invalid or expired.');
  assert.equal((await call('POST', '/v1/notify/unsubscribe', { body: {} })).status, 404);
});

test('reply notice: at most one a day per parent, each with its own working unsubscribe link', async () => {
  const a = await confirmed();
  await post(comment({ body: 'First reply here', cid: CID2, parent: a.id }), '6.6.6.6');
  await post(comment({ body: 'Second reply here', cid: 'thirdvisitorid-123456', parent: a.id }), '6.6.6.6');
  await flushMail();
  assert.equal(mail(MAILBOX).length, 1);
  // tomorrow a new one may go out, with a different unsubscribe token that also works
  env.DB.raw.exec('DELETE FROM hits');
  await post(comment({ body: 'Third reply here', cid: 'fourthvisitorid-12345', parent: a.id }), '6.6.6.6');
  await flushMail();
  const two = mail(MAILBOX);
  assert.equal(two.length, 2);
  assert.notEqual(unsubOf(two[0]), unsubOf(two[1]));
  assert.equal((await call('POST', '/v1/notify/unsubscribe', { body: { token: unsubOf(two[0]) } })).status, 200);
  assert.equal((await call('POST', '/v1/notify/unsubscribe', { body: { token: unsubOf(two[1]) } })).status, 200);
});

test('reply notice: team replies and admin approval of a pending reply also notify', async () => {
  const a = await confirmed();
  const t = await call('POST', '/v1/admin/reply', { body: { parent: a.id, body: 'Team answer <i>here</i>' }, auth: env.ADMIN_TOKEN, origin: null });
  assert.equal(t.status, 201);
  await flushMail();
  assert.equal(mail(MAILBOX).length, 1);
  assert.match(mail(MAILBOX)[0].body.subject, /team replied/i);
  assert.equal(mail(MAILBOX)[0].body.html.includes('<i>here</i>'), false);
  // a held reply, approved by the owner
  env.DB.raw.exec('DELETE FROM hits');
  sent = [];
  const held = await post(comment({ body: RUDE, cid: CID2, parent: a.id }), '6.6.6.6');
  assert.equal(held.json.status, 'pending');
  await flushMail();
  assert.equal(mail(MAILBOX).length, 0, 'a held reply is not announced');
  sent = [];
  const ap = await call('POST', `/v1/admin/comments/${held.json.id}`, { body: { action: 'approve' }, auth: env.ADMIN_TOKEN, origin: null });
  assert.equal(ap.status, 200);
  await flushMail();
  assert.equal(mail(MAILBOX).length, 1);
  // approving something already approved does not send again
  sent = [];
  env.DB.raw.exec('DELETE FROM hits');
  await call('POST', `/v1/admin/comments/${held.json.id}`, { body: { action: 'approve' }, auth: env.ADMIN_TOKEN, origin: null });
  await flushMail();
  assert.equal(sent.length, 0);
});

test('owner alerts: held comment with reasons, question, and nothing for an ordinary comment', async () => {
  env.OWNER_EMAIL = 'owner@example.org';
  await post(comment({ body: 'Thanks, this helped me a lot.' }));
  await flushMail();
  assert.equal(sent.length, 0);
  const q = await post(comment({ body: 'How long does it take to apply?', cid: CID2 }), '2.2.2.2');
  await flushMail();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ['owner@example.org']);
  assert.match(sent[0].body.subject, /question/i);
  assert.equal(sent[0].headers['Idempotency-Key'], `alert-${q.json.id}-question`);
  assert.ok(sent[0].body.text.includes('How long does it take'));
  sent = [];
  const h = await post(comment({ body: RUDE, cid: 'thirdvisitorid-123456' }), '3.3.3.3');
  await flushMail();
  assert.equal(h.json.status, 'pending');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.subject, /held/i);
  assert.equal(sent[0].headers['Idempotency-Key'], `alert-${h.json.id}-held`);
  assert.ok(/Reason/.test(sent[0].body.text));
  assert.ok(sent[0].body.text.includes(env.DB.raw.prepare('SELECT flag FROM comments WHERE id = ?').get(h.json.id).flag.split(', ')[0]));
  // duplicates and bots send nothing
  sent = [];
  await post(comment({ body: RUDE, cid: 'thirdvisitorid-123456' }), '3.3.3.3');
  await post(comment({ body: 'Why? bot', website: 'x' }), '3.3.3.3');
  await flushMail();
  assert.equal(sent.length, 0);
});

test('owner alerts: question alerts stop at 4 a day; the 9th comment is still saved and listed; held alerts and contact notices keep their own room', async () => {
  for (let i = 0; i < 9; i++) {
    const r = await post(comment({ body: `Is question number ${i} answered?`, cid: `visitorid-alert-${i}-123456` }), `7.7.7.${i}`);
    assert.equal(r.status, 201);
  }
  await flushMail();
  assert.equal(sent.filter((s) => /question/i.test(s.body.subject)).length, 4, 'only 4 question alerts');
  const list = await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null });
  assert.equal(list.status, 200);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM comments WHERE body LIKE 'Is question number%'").get().n, 9, 'all 9 saved');
  const before = sent.length;
  for (let i = 0; i < 7; i++) assert.equal((await contact({ email: `after${i}@example.com` })).status, 200, `contact ${i + 1}`);
  await flushMail();
  assert.ok(sent.length >= before + 7, 'contact notices still sent');
});

test('postMeta fallback: an unlisted article gives the post list address, never a made-up article URL', async () => {
  env.DB.raw.exec("INSERT OR IGNORE INTO posts(slug, created) VALUES('unlisted-post', 1)");
  const r = await call('POST', '/v1/posts/unlisted-post/comments', { body: comment({ body: 'Is this one listed?', email: MAILBOX, notify: true }), ip: '8.8.8.8' });
  await flushMail();
  const all = sent.map((s) => s.body.text).join('\n');
  assert.ok(all.includes('https://mayobebros.com/post/'), 'has the post list link');
  assert.equal(all.includes('/post/unlisted-post/'), false, 'no invented article URL');
});

test('owner alerts go to info@mayobebros.com when OWNER_EMAIL is not set', async () => {
  await post(comment({ body: 'Is this free?' }));
  await flushMail();
  assert.deepEqual(sent[0].body.to, ['info@mayobebros.com']);
});

test('hostile names and bodies never reach an email unescaped and never break the API', async () => {
  env.OWNER_EMAIL = 'owner@example.org';
  const a = await confirmed();
  const names = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "O'Brien\r\nBcc: evil@example", 'Lone \ud800 surrogate', 'N'.repeat(50)];
  let i = 0;
  for (const name of names) {
    env.DB.raw.exec('DELETE FROM hits');
    const bodyText = `<script>alert(1)</script> \ud83d lone "quote" 'q' & ${'long '.repeat(250)}?`;
    const r = await post(comment({ name, body: bodyText, cid: `hostile-visitor-${i++}-abcdef`, parent: a.id }), `10.0.0.${i}`);
    assert.ok([201, 202].includes(r.status), `${name}: ${r.status}`);
  }
  // a held, hostile top-level comment (owner alert) and a hostile email address
  env.DB.raw.exec('DELETE FROM hits');
  await post(comment({ name: '<b>x</b>y', body: `${RUDE} <script>1</script> ${'z'.repeat(1300)}`, cid: 'hostile-visitor-9-abcdefg' }), '10.1.1.1');
  await flushMail();
  assert.equal(sent.length, EXPECT_HOSTILE);
  for (const m of sent) {
    assert.equal(m.body.html.includes('<script>'), false);
    assert.equal(/<img[^>]*onerror/i.test(m.body.html), false);
    assert.equal(m.body.html.includes('<b>x</b>'), false);
    assert.equal(/[\r\n]/.test(m.body.subject), false);
    assert.doesNotThrow(() => JSON.parse(m.raw));
    assert.equal(m.raw.includes('\\ud800') || m.raw.includes('\\ud83d\\"'), false, 'no lone surrogate in the JSON');
  }
});

test('a failing mail service changes nothing in the API answer', async () => {
  const run = async (mode) => {
    resendMode = mode;
    sent = [];
    env = { ...env, DB: makeD1() };
    const r = await post(comment({ email: MAILBOX, notify: true, body: 'Is this free?' }));
    await flushMail();
    const { id, token, comment: c, ...rest } = r.json;
    return { status: r.status, rest, hasId: typeof id, hasToken: typeof token, name: c.name };
  };
  const good = await run('ok');
  assert.ok(sent.length > 0, 'a send was attempted');
  const thrown = await run('throw');
  assert.ok(sent.length > 0, 'a send was attempted while fetch threw');
  assert.deepEqual(thrown, good);
  const five = await run('500');
  assert.ok(sent.length > 0, 'a send was attempted while Resend answered 500');
  assert.deepEqual(five, good);
  assert.equal(good.status, 201);
});

test('without RESEND_API_KEY nothing is sent and comments still work', async () => {
  delete env.RESEND_API_KEY;
  const r = await post(comment({ email: MAILBOX, notify: true }));
  await flushMail();
  assert.equal(r.status, 201);
  assert.equal(sent.length, 0);
});

/* ------------------------------------------------------------------ Task 4 fix round */
test('one address in many spellings counts as one for the daily manage-link limit', async () => {
  const spellings = ['victim@gmail.com', 'victim+1@gmail.com', 'VICTIM+two@Gmail.com', 'v.i.c.t.i.m@gmail.com', 'victim@googlemail.com', ' victim+x@gmail.com. ', 'ｖictim@gmail.com'];
  let i = 0;
  for (const e of spellings) {
    const r = await post(comment({ body: `Alias try ${i}`, email: e.trim(), notify: true, cid: `aliasvisitor-${i}-abcdefgh` }), `20.0.0.${i++}`);
    assert.ok([201, 202].includes(r.status), `${e}: ${r.status}`);
  }
  await flushMail();
  assert.equal(sent.length, 1, 'all spellings are one inbox');
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM hits WHERE k LIKE 'mlem:%'").get().n, 1);
});

test('plus-tag is stripped for every domain; dots only matter for gmail; different people do not collide', async () => {
  const go = async (e, n) => { await post(comment({ body: `Distinct ${n}`, email: e, notify: true, cid: `distinctvis-${n}-abcdefghij` }), `21.0.0.${n}`); };
  await go('pat+a@example.com', 1);
  await go('pat+b@example.com', 2);   // same as the first
  await go('p.at@example.com', 3);    // dots count outside gmail: different
  await go('victim@gmail.com', 4);
  await go('victim2@gmail.com', 5);   // different person
  await go('victim@example.com', 6);  // same local part, other domain
  await flushMail();
  assert.deepEqual(sent.map((m) => m.body.to[0]).sort(), ['p.at@example.com', 'pat+a@example.com', 'victim2@gmail.com', 'victim@example.com', 'victim@gmail.com']);
});

test('a device token check also runs for a comment id that does not exist', async () => {
  const src = fs.readFileSync(new URL('../../worker/src/index.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function ownerRow'), src.indexOf('// A reply counts when'));
  assert.doesNotMatch(fn, /const device = row/, 'the device lookup must not depend on the comment row');
  const r = await call('POST', '/v1/comments/99999/edit', { body: { token: 'q'.repeat(32), body: 'x y z' } });
  assert.equal(r.status, 404);
});

test('a reply is announced once, only when approved from pending', async () => {
  const a = await confirmed();
  const held = await post(comment({ body: RUDE, cid: CID2, parent: a.id }), '6.6.6.6');
  const act = (id, action) => call('POST', `/v1/admin/comments/${id}`, { body: { action }, auth: env.ADMIN_TOKEN, origin: null });
  await act(held.json.id, 'approve'); await flushMail();
  assert.equal(mail(MAILBOX).length, 1);
  env.DB.raw.exec('DELETE FROM hits');
  await act(held.json.id, 'spam');
  await act(held.json.id, 'approve'); await flushMail();
  assert.equal(mail(MAILBOX).length, 1, 'spam then approve again does not announce twice');
  // a reply that was spam from the start, then approved: not announced
  sent = [];
  env.DB.raw.exec('DELETE FROM hits');
  const other = await post(comment({ body: 'Another normal reply', cid: 'othervisitor-12345678', parent: a.id }), '6.6.6.7');
  await flushMail();
  assert.equal(mail(MAILBOX).length, 1);
  sent = [];
  env.DB.raw.exec('DELETE FROM hits');
  await act(other.json.id, 'spam'); await act(other.json.id, 'approve'); await flushMail();
  assert.equal(sent.length, 0, 'an auto-approved reply is not announced again by admin approval');
  assert.equal(env.DB.raw.prepare('SELECT announced FROM comments WHERE id = ?').get(other.json.id).announced, 1);
});

test('manage_links rows go when a comment is deleted or hidden by the admin, and when a tombstone is purged', async () => {
  const count = () => env.DB.raw.prepare('SELECT COUNT(*) AS n FROM manage_links').get().n;
  const act = (id, action) => call('POST', `/v1/admin/comments/${id}`, { body: { action }, auth: env.ADMIN_TOKEN, origin: null });
  const a = await confirmed();
  const rep = await post(comment({ body: 'A reply to it', cid: CID2, parent: a.id }), '6.6.6.6');
  await flushMail();
  const ins = (cid, kind) => env.DB.raw.prepare("INSERT INTO manage_links(hash, comment_id, kind, expires, created) VALUES(?, ?, ?, NULL, 1)").run(`h${cid}${kind}${Math.random()}`, cid, kind);
  ins(rep.json.id, 'device');
  assert.ok(count() >= 3);
  await act(a.id, 'spam');
  assert.equal(count(), 0, 'spam removes the links of the comment and of its replies');
  const b = await confirmed({ cid: 'secondparent-1234567', body: 'Second parent text', email: 'bee@example.com' });
  ins(b.id, 'unsub');
  await act(b.id, 'delete');
  assert.equal(count(), 0, 'admin delete removes them');
  // a tombstone purged once its last reply is removed
  const c = await post(comment({ body: 'Third parent text', cid: 'thirdparent-12345678' }), '7.7.7.7');
  const r2 = await post(comment({ body: 'Child reply text', cid: 'childvisitor-12345678', parent: c.json.id }), '7.7.7.8');
  ins(c.json.id, 'device');
  await call('POST', `/v1/comments/${c.json.id}/delete`, { body: { token: c.json.token } });
  assert.equal(env.DB.raw.prepare("SELECT status FROM comments WHERE id = ?").get(c.json.id).status, 'deleted');
  ins(c.json.id, 'device');
  await act(r2.json.id, 'delete');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM comments WHERE id = ?').get(c.json.id).n, 0);
  assert.equal(count(), 0, 'purging the tombstone removes its links');
});

test('at most 20 device tokens per comment; the oldest go first', async () => {
  const r = await post(comment({ email: MAILBOX, notify: true }));
  await flushMail();
  const link = linkOf(sent[0]);
  const toks = [];
  for (let i = 0; i < 22; i++) {
    env.DB.raw.exec('DELETE FROM hits');
    const x = await exchange(link, `30.0.0.${i}`);
    assert.equal(x.status, 200);
    toks.push(x.json.token);
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM manage_links WHERE kind = 'device'").get().n, 20);
  assert.equal((await call('POST', `/v1/comments/${r.json.id}/edit`, { body: { token: toks[0], body: 'late edit text' } })).status, 404, 'the oldest is gone');
  assert.equal((await call('POST', `/v1/comments/${r.json.id}/edit`, { body: { token: toks[21], body: 'late edit text' } })).status, 200);
});

test('exchange and unsubscribe give the generic 404 for bad JSON, non-objects and oversize bodies', async () => {
  for (const path of ['/v1/manage/exchange', '/v1/notify/unsubscribe']) {
    for (const raw of ['{nope', '[1,2]', '"str"', 'null', JSON.stringify({ link: 'y'.repeat(5000), token: 'y'.repeat(5000) })]) {
      const res = await worker.fetch(new Request(`https://api.test${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '1.2.3.4' }, body: raw }), env, { waitUntil() {} });
      assert.equal(res.status, 404, `${path} ${raw.slice(0, 10)}`);
      assert.deepEqual(await res.json(), { error: 'Link is invalid or expired.' });
    }
  }
});

/* ------------------------------------------------------------------ Task 6: contact form */
const contactBody = (over = {}) => ({ name: 'Neema Joseph', email: 'neema@example.com', subject: 'A question about the site', message: 'Hello, I would like to ask how you choose your topics.', website: '', ts: Date.now() - 10000, ...over });
let ipN = 0;
const contact = (over = {}, ip) => call('POST', '/v1/contact', { body: contactBody(over), ip: ip || `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}` });

test('contact: happy path sends the owner notice then the fixed confirmation, with the right recipients, kinds and keys', async () => {
  const r = await contact();
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  await flushMail();
  assert.equal(sent.length, 2);
  const [own, ack] = sent;
  assert.deepEqual(own.body.to, ['info@mayobebros.com']);
  assert.equal(own.body.reply_to, 'neema@example.com');
  assert.match(own.body.subject, /^Contact form \(General question\): A question about the site/);
  assert.ok(own.body.html.includes('how you choose your topics'));
  assert.deepEqual(ack.body.to, ['neema@example.com']);
  assert.equal(ack.body.subject, 'We received your message');
  assert.equal(ack.body.reply_to, undefined);
  const id = own.headers['Idempotency-Key'].replace(/^contact-/, '');
  assert.match(own.headers['Idempotency-Key'], /^contact-[0-9a-f-]{36}$/);
  assert.equal(ack.headers['Idempotency-Key'], `contactack-${id}`);
  // nothing about the message is stored
  const dump = JSON.stringify(['comments', 'hits'].map((t) => env.DB.raw.prepare(`SELECT * FROM ${t}`).all()));
  for (const s of ['neema', 'Neema', 'choose your topics', 'A question about']) assert.equal(dump.includes(s), false, `${s} is not stored`);
});

test('contact: OWNER_EMAIL is used, a known type reaches the owner email, an unknown one becomes general', async () => {
  env.OWNER_EMAIL = 'boss@example.org';
  await contact({ type: 'advertising' });
  await contact({ type: '__proto__' });
  await flushMail();
  const owners = sent.filter((s) => s.body.to[0] === 'boss@example.org');
  assert.equal(owners.length, 2);
  assert.match(owners[0].body.subject, /\(Advertising\)/);
  assert.match(owners[1].body.subject, /\(General question\)/);
});

test('contact: a second message is a new message (fresh idempotency key)', async () => {
  await contact({ email: 'a1@example.com' });
  await contact({ email: 'a2@example.com' });
  await flushMail();
  const keys = sent.filter((s) => s.body.to[0] === 'info@mayobebros.com').map((s) => s.headers['Idempotency-Key']);
  assert.equal(new Set(keys).size, 2);
});

test('contact: validation matrix', async () => {
  const bad = async (over, re) => {
    const r = await contact(over);
    assert.equal(r.status, 400, JSON.stringify(over).slice(0, 80));
    if (re) assert.match(r.json.error, re);
  };
  await bad({ name: 'A' }, /name/i);
  await bad({ name: 'x'.repeat(51) }, /name/i);
  await bad({ name: '​\u0007 ' }, /name/i);
  await bad({ email: 'nope' }, /email/i);
  await bad({ email: 'a b@example.com' }, /email/i);
  await bad({ email: 'a@example.com\r\nBcc: x@evil.test' }, /email/i);
  await bad({ email: 'a​@example.com' }, /email/i);
  await bad({ email: `${'a'.repeat(250)}@example.com` }, /email/i);
  await bad({ email: '"a"@example.com' }, /email/i);
  await bad({ email: 42 }, /email/i);
  await bad({ subject: 'ab' }, /subject/i);
  await bad({ subject: 'x'.repeat(121) }, /subject/i);
  await bad({ message: 'too short' }, /short/i);
  await bad({ message: 'x'.repeat(3001) }, /long/i);
  await bad({ message: 12345 }, /short/i);
  assert.equal(sent.length, 0);
  // the edges are accepted
  assert.equal((await contact({ name: 'Al', subject: 'abc', message: '1234567890' })).status, 200);
  assert.equal((await contact({ name: 'x'.repeat(50), subject: 'x'.repeat(120), message: 'y'.repeat(3000), email: 'edge@example.com' })).status, 200);
  const big = await call('POST', '/v1/contact', { body: { ...contactBody(), message: 'q'.repeat(20000) } });
  assert.equal(big.status, 413);
  assert.equal((await call('POST', '/v1/contact', { body: null })).status, 400, 'not JSON');
});

test('contact: links in the message are allowed and arrive as inert text', async () => {
  const r = await contact({ message: 'Please read https://example.com/page?a=1&b=2 and tell me what you think.' });
  assert.equal(r.status, 200);
  await flushMail();
  const html = sent[0].body.html;
  assert.ok(!/href="https?:\/\/example\.com/.test(html), 'not a clickable link');
  assert.ok(html.includes('https://example.com/page?a=1&amp;b=2'));
});

test('contact: honeypot and a too-fast post are answered 200 with no mail and no count', async () => {
  const a = await contact({ website: 'http://spam.example' });
  const b = await contact({ ts: Date.now() - 500 });
  assert.deepEqual([a.status, a.json], [200, { ok: true }]);
  assert.deepEqual([b.status, b.json], [200, { ok: true }]);
  await flushMail();
  assert.equal(sent.length, 0);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM hits WHERE k LIKE 'ct%'").get().n, 0);
});

test('contact: 3 an hour per IP and 2 an hour per address (any spelling), keyed without the raw address', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await contact({ email: `p${i}@example.com` }, '9.9.9.9')).status, 200);
  const fourth = await contact({ email: 'p9@example.com' }, '9.9.9.9');
  assert.equal(fourth.status, 429);
  assert.equal(fourth.json.error, 'Too many attempts. Try again later.');
  const spellings = ['Pat@Gmail.com', 'p.a.t+x@gmail.com', 'pat@googlemail.com'];
  assert.equal((await contact({ email: spellings[0] })).status, 200);
  assert.equal((await contact({ email: spellings[1] })).status, 200);
  assert.equal((await contact({ email: spellings[2] })).status, 429);
  const keys = env.DB.raw.prepare('SELECT k FROM hits').all().map((h) => h.k).join('\n');
  assert.equal(/example\.com|gmail/i.test(keys), false, 'no raw address in hits');
  assert.equal(keys.includes('9.9.9.9'), false);
});

test('contact: at most 7 notices a day, so 3 owner units stay for comment alerts; commenter mail is untouched', async () => {
  for (let i = 0; i < 7; i++) assert.equal((await contact({ email: `flood${i}@example.com` })).status, 200, `message ${i + 1}`);
  await flushMail();
  const before = sent.length;
  const r = await contact({ email: 'late@example.com' });
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'Could not send. Email us at info@mayobebros.com.');
  await flushMail();
  assert.equal(sent.length, before, 'no mail was attempted for the 8th message');
  // a held comment still alerts the owner (owner slice), and a manage link still goes out (commenter slice)
  const held = await post(comment({ body: RUDE, cid: CID2, email: MAILBOX, notify: true }));
  assert.equal(held.status, 202);
  await flushMail();
  const after = sent.slice(before);
  assert.ok(after.some((s) => s.body.to[0] === 'info@mayobebros.com' && /held|review|comment/i.test(s.body.subject)), 'owner alert sent');
  assert.ok(after.some((s) => s.body.to[0] === MAILBOX), 'manage-link mail sent');
});

test('contact: an owner slice that is already full answers 503 and tries nothing', async () => {
  for (let i = 0; i < 24; i++) assert.equal(await takeBudget(env, 'owner'), true);
  const r = await contact();
  assert.equal(r.status, 503);
  await flushMail();
  assert.equal(sent.length, 0);
});

test('contact: owner mail failing (500, thrown fetch, no key) answers 503 and sends no confirmation', async () => {
  for (const mode of ['500', 'throw']) {
    resendMode = mode;
    sent = [];
    const r = await contact({ email: `m${mode}@example.com` });
    await flushMail();
    assert.equal(r.status, 503, mode);
    assert.match(r.json.error, /info@mayobebros\.com/);
    assert.ok(sent.every((s) => s.body.to[0] === 'info@mayobebros.com'), 'only the owner mail was tried');
  }
  resendMode = 'ok';
  sent = [];
  delete env.RESEND_API_KEY;
  const r = await contact({ email: 'nokey@example.com' });
  assert.equal(r.status, 503);
  assert.equal(sent.length, 0);
  env.CONTACT_EMAIL = 'help@example.org';
  assert.match((await contact({ email: 'nokey2@example.com' })).json.error, /help@example\.org/);
});

test('contact: a failing confirmation never changes the 200', async () => {
  const realF = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u) === 'https://api.resend.com/emails' && JSON.parse(init.body).subject === 'We received your message') throw new Error('down');
    return realF(u, init);
  };
  try {
    const r = await contact();
    await flushMail();
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
    assert.equal(sent.length, 1);
  } finally { globalThis.fetch = realF; }
});

test('contact: the confirmation to the unverified address contains none of the visitor\'s text', async () => {
  const name = 'Zanzibar Quokka', subject = 'Marmalade sandwiches', message = 'The purple elephant wishes to discuss <b>cheese</b> urgently.';
  await contact({ name, subject, message, email: 'unverified@example.com' });
  await flushMail();
  const ack = sent.find((s) => s.body.to[0] === 'unverified@example.com');
  assert.ok(ack);
  const all = JSON.stringify(ack.body);
  for (const s of ['Zanzibar', 'Quokka', 'Marmalade', 'purple elephant', 'cheese']) assert.equal(all.includes(s), false, s);
});

test('contact: hostile name, subject and message never break the headers, the JSON or the HTML', async () => {
  const name = 'Eve <script>alert(1)</script>\r\nBcc: x@evil.test';
  const subject = 'Hi\r\nBcc: evil@evil.test <img src=x onerror=alert(1)>';
  const message = `<script>alert("x")</script>\r\n\ud800 lone \udc00 surrogates \u001b[31m red & "quotes" 'single'\n${'z'.repeat(2800)}`;
  const r = await contact({ name, subject, message, email: 'eve@example.com' });
  assert.equal(r.status, 200);
  await flushMail();
  assert.equal(sent.length, 2);
  for (const s of sent) {
    assert.doesNotThrow(() => JSON.parse(s.raw));
    assert.equal(/<script|<img src=x|<b>/i.test(s.body.html), false, 'no raw tag in the HTML');
    assert.equal(/[\r\n]/.test(s.body.subject), false, 'one-line subject');
    assert.equal(s.raw.includes('\\ud800') || s.raw.includes('\ud800'), false, 'no lone surrogate on the wire');
    assert.equal(s.body.to.length, 1);
  }
  assert.equal(sent[0].body.reply_to, 'eve@example.com');
  assert.equal(sent[0].body.bcc, undefined);
});

test('contact: Origin is required and CORS answers only our site', async () => {
  assert.equal((await call('POST', '/v1/contact', { body: contactBody(), origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/v1/contact', { body: contactBody(), origin: null })).status, 403);
  const pre = await worker.fetch(new Request('https://api.test/v1/contact', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, {});
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  await flushMail();
  assert.equal(sent.length, 0);
});

test('contact: TURNSTILE_SECRET does not block the form (the page has no widget yet) and is not called', async () => {
  env.TURNSTILE_SECRET = 'secret';
  const realF = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async (u, init) => { if (String(u).includes('turnstile')) { asked++; return new Response(JSON.stringify({ success: false })); } return realF(u, init); };
  try {
    assert.equal((await contact()).status, 200);
    await flushMail();
    assert.equal(asked, 0);
    assert.equal(sent.length, 2);
  } finally { globalThis.fetch = realF; }
});

test('contact: validation errors name the field so the page can mark it', async () => {
  const cases = [[{ name: 'A' }, 'name'], [{ email: 'nope' }, 'email'], [{ subject: 'ab' }, 'subject'], [{ message: 'short' }, 'message']];
  for (const [over, field] of cases) {
    const r = await contact(over);
    assert.equal(r.status, 400);
    assert.equal(r.json.field, field);
  }
});

test('contact: the confirmation goes to one address once a day; the owner notice and the 200 are unchanged', async () => {
  assert.equal((await contact({ email: 'once@example.com' })).status, 200);
  assert.equal((await contact({ email: 'Once+again@example.com' })).status, 200);
  await flushMail();
  const owners = sent.filter((s) => s.body.to[0] === 'info@mayobebros.com');
  const acks = sent.filter((s) => s.body.subject === 'We received your message');
  assert.equal(owners.length, 2);
  assert.equal(acks.length, 1);
  assert.equal(/once/i.test(JSON.stringify(env.DB.raw.prepare('SELECT k FROM hits').all())), false, 'no raw address in hits');
});

test('contact: a browser id makes a retry use the same idempotency keys; a bad id is replaced', async () => {
  const id = 'abcd1234-abcd-1234-abcd-1234567890ab';
  await contact({ id, email: 'r1@example.com' });
  await contact({ id, email: 'r2@example.com' });
  await flushMail();
  const own = sent.filter((s) => s.body.to[0] === 'info@mayobebros.com').map((s) => s.headers['Idempotency-Key']);
  assert.deepEqual(own, [`contact-${id}`, `contact-${id}`]);
  assert.ok(sent.some((s) => s.headers['Idempotency-Key'] === `contactack-${id}`));
  sent = [];
  await contact({ id: 'short', email: 'r3@example.com' });
  await contact({ id: 'x'.repeat(65), email: 'r4@example.com' });
  await flushMail();
  for (const s of sent.filter((x) => x.body.to[0] === 'info@mayobebros.com')) assert.match(s.headers['Idempotency-Key'], /^contact-[0-9a-f-]{36}$/);
});

test('contact: 3,000 characters of quotes and line breaks arrive whole, escaped, in well-formed bodies', async () => {
  const msg = ('"\n').repeat(1000) + '<b>x</b>'.repeat(125) + 'END';
  const r = await contact({ message: msg.slice(0, 3000) });
  assert.equal(r.status, 200);
  await flushMail();
  const own = sent[0];
  assert.doesNotThrow(() => JSON.parse(own.raw));
  assert.ok(own.body.html.includes('&quot;'), 'quotes escaped');
  assert.ok(own.body.html.includes('&lt;b&gt;x&lt;/b&gt;'), 'tags escaped');
  assert.equal(own.body.html.includes('<b>x</b>'), false);
});

// ---- Resend webhook (Svix signature) ----
import { createHmac } from 'node:crypto';
const WH_KEY = Buffer.from('test-signing-key-0123456789abcdef');
const WH_SECRET = `whsec_${WH_KEY.toString('base64')}`;
const nowSec = () => Math.floor(Date.now() / 1000);
// Independent of the production code: the signature is computed here with Node's crypto.
const svixSig = (id, ts, raw, key = WH_KEY) => `v1,${createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')}`;
async function hook(payload, { id = 'msg_1', ts = String(nowSec()), sig, raw, headers = {}, method = 'POST', origin = null } = {}) {
  const text = raw ?? (typeof payload === 'string' ? payload : JSON.stringify(payload));
  const h = { 'CF-Connecting-IP': '9.9.9.9', ...headers };
  if (id !== null) h['svix-id'] = id;
  if (ts !== null) h['svix-timestamp'] = ts;
  const s = sig === undefined ? svixSig(id, ts, text) : sig;
  if (s !== null) h['svix-signature'] = s;
  if (origin) h.Origin = origin;
  const res = await worker.fetch(new Request('https://api.test/v1/webhooks/resend', { method, headers: h, body: method === 'POST' ? text : undefined }), env, { waitUntil: (p) => { pendingMail.push(p); } });
  const out = await res.text();
  return { status: res.status, json: out ? JSON.parse(out) : null };
}
const suppressedRows = () => env.DB.raw.prepare('SELECT email, reason FROM suppressed ORDER BY email').all().map((r) => ({ ...r }));
const bounce = (to, bt = { type: 'Permanent', subType: 'Suppressed' }) => ({ type: 'email.bounced', data: { to, ...(bt ? { bounce: bt } : {}) } });
const BAD = { error: 'Invalid webhook.' };

test('webhook: a signed permanent bounce suppresses the address and later mail to it is skipped', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  const r = await hook(bounce(['Gone@Example.com']));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.deepEqual(suppressedRows(), [{ email: 'gone@example.com', reason: 'bounce' }]);
  const m = await sendMail(env, { waitUntil() {} }, { kind: 'commenter', to: 'gone@example.com', subject: 's', html: '<p>x</p>', text: 'x', key: 'k1' });
  assert.equal(m.skipped, 'suppressed');
  assert.equal(sent.length, 0);
});

test('webhook: a complaint suppresses; a single string recipient works; several recipients all count; bad ones are ignored', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  assert.equal((await hook({ type: 'email.complained', data: { to: 'Spam@Example.com' } })).status, 200);
  assert.equal((await hook(bounce(['a@example.com', 'b@example.com', 'not an address', 'x\ny@example.com', 42, null, '']))).status, 200);
  assert.deepEqual(suppressedRows(), [
    { email: 'a@example.com', reason: 'bounce' },
    { email: 'b@example.com', reason: 'bounce' },
    { email: 'spam@example.com', reason: 'complaint' },
  ]);
});

test('webhook: suppresses exactly the reported address, not its canonical form', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  await hook(bounce(['first.last+tag@gmail.com']));
  assert.deepEqual(suppressedRows(), [{ email: 'first.last+tag@gmail.com', reason: 'bounce' }]);
});

test('webhook: at most 50 recipients per event', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  await hook(bounce(Array.from({ length: 80 }, (_, i) => `u${i}@example.com`)));
  assert.equal(suppressedRows().length, 50);
});

test('webhook: temporary and undetermined bounces do not suppress; a payload without bounce.type does', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  assert.equal((await hook(bounce(['t@example.com'], { type: 'Temporary', subType: 'MailboxFull' }))).status, 200);
  assert.equal((await hook(bounce(['u@example.com'], { type: 'Undetermined' }))).status, 200);
  assert.equal((await hook(bounce(['tr@example.com'], { type: 'Transient', subType: 'General' }))).status, 200);
  assert.deepEqual(suppressedRows(), []);
  assert.equal((await hook(bounce(['n@example.com'], null))).status, 200);
  assert.deepEqual(suppressedRows(), [{ email: 'n@example.com', reason: 'bounce' }]);
});

test('webhook: other events are acknowledged and change nothing', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  const r = await hook({ type: 'email.delivered', data: { to: ['d@example.com'] } });
  assert.deepEqual([r.status, r.json], [200, { ok: true }]);
  assert.deepEqual(suppressedRows(), []);
});

test('webhook: the same event twice is harmless', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  const p = bounce(['dup@example.com']);
  assert.equal((await hook(p)).status, 200);
  assert.equal((await hook(p)).status, 200);
  assert.equal(suppressedRows().length, 1);
});

test('webhook: wrong signature, wrong secret, tampered body: 400 and nothing stored', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  const p = bounce(['x@example.com']);
  const raw = JSON.stringify(p);
  const ts = String(nowSec());
  for (const o of [
    { sig: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    { sig: svixSig('msg_1', ts, raw, Buffer.from('another-key-entirely')), ts },
    { sig: svixSig('msg_1', ts, raw), raw: raw.replace('x@', 'y@'), ts },
    { sig: svixSig('msg_OTHER', ts, raw), ts },
    { sig: `v1,${createHmac('sha256', WH_KEY).update(`msg_1.${ts}.${raw}`).digest('base64')}x`, ts },
  ]) {
    const r = await hook(p, o);
    assert.deepEqual([r.status, r.json], [400, BAD]);
  }
  assert.deepEqual(suppressedRows(), []);
});

test('webhook: old, future, non-integer and missing timestamps and other missing headers: 400', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  const p = bounce(['x@example.com']);
  for (const o of [
    { ts: String(nowSec() - 301) },
    { ts: String(nowSec() + 301) },
    { ts: '12abc' },
    { ts: '1.5' },
    { ts: '' },
    { ts: null, sig: 'v1,x' },
    { id: null, sig: 'v1,x' },
    { sig: null },
    { sig: '' },
  ]) {
    const r = await hook(p, o);
    assert.deepEqual([r.status, r.json], [400, BAD], JSON.stringify(o));
  }
  assert.equal((await hook(p, { ts: String(nowSec() - 200) })).status, 200, 'inside the window');
});

test('webhook: a missing, empty or malformed secret fails closed', async () => {
  const p = bounce(['x@example.com']);
  const raw = JSON.stringify(p);
  for (const secret of [undefined, '', 'whsec_', 'whsec_!!!not-base64!!!', Buffer.from('k').toString('base64') /* no whsec_ prefix */, `whsec_${WH_KEY.toString('base64')}x`]) {
    env.RESEND_WEBHOOK_SECRET = secret;
    const r = await hook(p);
    assert.deepEqual([r.status, r.json], [400, BAD], String(secret));
  }
  // Even a signature made with an empty key does not pass when the secret is empty.
  env.RESEND_WEBHOOK_SECRET = 'whsec_';
  const ts = String(nowSec());
  const sig = `v1,${createHmac('sha256', Buffer.alloc(0)).update(`msg_1.${ts}.${raw}`).digest('base64')}`;
  assert.equal((await hook(p, { ts, sig })).status, 400);
  assert.deepEqual(suppressedRows(), []);
});

test('webhook: several signatures where one is valid pass; v2 only, or a v1 lookalike, is refused', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  const p = bounce(['multi@example.com']);
  const raw = JSON.stringify(p);
  const ts = String(nowSec());
  const good = svixSig('msg_1', ts, raw);
  const junk = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  assert.equal((await hook(p, { ts, sig: `${junk} ${good}` })).status, 200);
  assert.equal((await hook(p, { ts, sig: `v2,abc ${good} ${junk}` })).status, 200);
  assert.deepEqual(suppressedRows().length, 1);
  env.DB.raw.prepare('DELETE FROM suppressed').run();
  const v2 = `v2,${good.slice(3)}`;
  assert.equal((await hook(p, { ts, sig: v2 })).status, 400);
  assert.equal((await hook(p, { ts, sig: good.slice(3) })).status, 400, 'no version prefix');
  assert.equal((await hook(p, { ts, sig: `v1a,${good.slice(3)}` })).status, 400);
  assert.deepEqual(suppressedRows(), []);
});

test('webhook: oversize body is refused; malformed JSON with a valid signature is 400', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  const big = JSON.stringify({ type: 'email.delivered', pad: 'y'.repeat(70000) });
  assert.deepEqual([(await hook(big)).status, (await hook(big)).json], [400, BAD]);
  const cl = await hook(big, { headers: { 'content-length': '70000' } });
  assert.deepEqual([cl.status, cl.json], [400, BAD]);
  assert.deepEqual((await hook('{nope')).json, BAD);
});

test('webhook: no Origin is needed, a foreign Origin does not help or hurt, only the signature counts', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  assert.equal((await hook(bounce(['o1@example.com']), { origin: 'https://evil.example' })).status, 200);
  assert.equal((await hook(bounce(['o2@example.com']), { origin: ORIGIN })).status, 200);
  assert.equal((await hook(bounce(['o3@example.com']), { origin: ORIGIN, sig: 'v1,bad' })).status, 400);
  assert.equal(suppressedRows().length, 2);
});

test('webhook: GET is not the webhook; OPTIONS answers 204 without side effects; other POST routes still need an Origin', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  assert.equal((await hook(bounce(['g@example.com']), { method: 'GET' })).status, 404);
  const res = await worker.fetch(new Request('https://api.test/v1/webhooks/resend', { method: 'OPTIONS' }), env, { waitUntil() {} });
  assert.equal(res.status, 204);
  assert.equal((await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'like' }, origin: null })).status, 403);
  assert.deepEqual(suppressedRows(), []);
});

test('webhook: a valid secret of the wrong key (correct base64) is refused', async () => {
  env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('a-different-valid-key-000000000').toString('base64')}`;
  const r = await hook(bounce(['x@example.com']));
  assert.deepEqual([r.status, r.json], [400, BAD]);
  assert.deepEqual(suppressedRows(), []);
});

test('webhook: our own addresses are never suppressed, even mixed with a visitor; owner mail still sends', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  env.OWNER_EMAIL = 'Boss@Example.org';
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    assert.equal((await hook(bounce(['boss@example.org']))).status, 200);
    assert.deepEqual(suppressedRows(), []);
    assert.equal((await hook({ type: 'email.complained', data: { to: ['INFO@mayobebros.com', 'visitor@example.com', 'boss@example.org'] } })).status, 200);
  } finally { console.log = orig; }
  assert.deepEqual(suppressedRows(), [{ email: 'visitor@example.com', reason: 'complaint' }]);
  assert.ok(logs.some((l) => l.includes('owner address reported, not suppressed')));
  assert.equal(logs.some((l) => /@/.test(l)), false, 'no address in the log');
  const m = await sendMail(env, { waitUntil() {} }, { kind: 'owner', to: 'boss@example.org', subject: 's', html: '<p>x</p>', text: 'x', key: 'k-own' });
  assert.equal(m.ok, true);
});

test('webhook: the review addresses are never suppressed either (a spam report on an alert must not silence the alerts)', async () => {
  env.RESEND_WEBHOOK_SECRET = WH_SECRET;
  env.REVIEW_EMAILS = 'Reviewer@Example.org, second@example.org';
  const orig = console.log;
  console.log = () => {};
  try { assert.equal((await hook({ type: 'email.complained', data: { to: ['reviewer@example.org', 'second@example.org', 'visitor@example.com'] } })).status, 200); } finally { console.log = orig; }
  assert.deepEqual(suppressedRows(), [{ email: 'visitor@example.com', reason: 'complaint' }]);
});

test('mail: an owner-kind send skipped as suppressed logs one short line without the address', async () => {
  env.DB.raw.prepare("INSERT INTO suppressed(email, reason, created) VALUES('own@example.org','bounce',1)").run();
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const m = await sendMail(env, { waitUntil() {} }, { kind: 'owner', to: 'own@example.org', subject: 's', html: '<p>x</p>', text: 'x', key: 'k-o2' });
    assert.equal(m.skipped, 'suppressed');
    await sendMail(env, { waitUntil() {} }, { kind: 'commenter', to: 'own@example.org', subject: 's', html: '<p>x</p>', text: 'x', key: 'k-o3' });
  } finally { console.error = orig; }
  assert.equal(errs.length, 1);
  assert.equal(/own@example/.test(errs[0]), false);
});

/* ---------------------------------------------------------------- the words a visitor can read */
// Every error the page can show is short, plain and neutral: no limit, no cause, no internal word, no exclamation mark.
const BANNED = /server|api\b|json|token|visitor id|origin|status|http|several|hour|minutes|already|waiting for review|held|spam|screen|rule|exist|sorry|oops|!/i;
const plain = (msg, where) => {
  assert.equal(typeof msg, 'string', where);
  assert.match(msg, /^[A-Z][^.!?]*(\. [A-Z][^.!?]*)*\.$/, `${where}: ${msg}`);
  assert.doesNotMatch(msg, BANNED, `${where}: ${msg}`);
  assert.ok(msg.split(' ').length <= 8, `${where}: ${msg}`);
};

test('comment field errors name the field and the problem in a few words, with no numbers', async () => {
  const cases = [
    [{ name: '' }, 'Name is required.'],
    [{ name: 'A' }, 'Name is too short.'],
    [{ name: 'x'.repeat(51) }, 'Name is too long.'],
    [{ name: 'see www.example.com' }, 'Name cannot contain links.'],
    [{ body: '' }, 'Comment is required.'],
    [{ body: 'ab' }, 'Comment is too short.'],
    [{ body: 'x'.repeat(1501) }, 'Comment is too long.'],
    [{ body: 'visit www.example.com now' }, 'Comment cannot contain links.'],
    [{ email: 'nope' }, 'Email looks incorrect.'],
  ];
  for (const [over, expected] of cases) {
    const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment(over), ip: '8.8.8.8' });
    assert.equal(r.status, 400, JSON.stringify(over).slice(0, 40));
    assert.equal(r.json.error, expected);
    assert.doesNotMatch(r.json.error, /\d/);
  }
});

test('every refusal a visitor can reach uses one of a few neutral sentences', async () => {
  const seen = new Map();
  const note = (r, where) => { assert.ok(r.json && r.json.error, where); plain(r.json.error, where); seen.set(where, r.json.error); };
  note(await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: 'love' } }), 'bad reaction');
  note(await call('POST', '/v1/posts/hello-post/react', { body: { cid: 'short', type: 'like' } }), 'bad visitor id');
  note(await call('POST', '/v1/posts/not-a-real-post/react', { body: { cid: CID, type: 'like' } }), 'unknown post');
  note(await call('POST', '/v1/posts/hello-post/comments', { body: comment({ cid: 'x' }) }), 'comment without a good visitor id');
  note(await call('POST', '/v1/posts/hello-post/comments', { body: comment({ parent: 9999 }) }), 'reply to nothing');
  note(await call('POST', '/v1/comments/1/like', { body: { cid: CID, on: true } }), 'like on nothing');
  note(await call('POST', '/v1/comments/1/like', { body: { cid: CID } }), 'like without on');
  note(await call('POST', '/v1/comments/1/edit', { body: { token: 'x'.repeat(32), body: 'Some new text' } }), 'edit with a wrong token');
  note(await call('POST', '/v1/comments/1/delete', { body: { token: 'x'.repeat(32) } }), 'delete with a wrong token');
  note(await call('POST', '/v1/manage/exchange', { body: { link: 'x'.repeat(32) } }), 'a link that works for nothing');
  note(await call('POST', '/v1/review', { body: { r: '1.a.abc.' + 'x'.repeat(43) } }), 'a review link that works for nothing');
  note(await call('POST', '/v1/posts/hello-post/comments', { body: comment(), origin: 'https://evil.example' }), 'a foreign origin');
  // not JSON, and too large: the reader gets a short sentence, never the wording meant for a log
  for (const [raw, where] of [['{nope', 'not JSON'], ['x'.repeat(5000), 'too large']]) {
    const res = await worker.fetch(new Request('https://api.test/v1/posts/hello-post/comments', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '2.2.2.2' }, body: raw }), env, { waitUntil() {} });
    note({ json: await res.json() }, where);
  }
  assert.equal(seen.get('not JSON'), 'Could not send. Try again.');
  assert.equal(seen.get('too large'), 'Message is too long.');
  // the same words whatever the cause: an unknown link, a missing comment and a wrong token cannot be told apart
  assert.equal(seen.get('a link that works for nothing'), seen.get('a review link that works for nothing'));
  assert.equal(seen.get('edit with a wrong token'), seen.get('delete with a wrong token'));
  assert.equal(seen.get('edit with a wrong token'), seen.get('like on nothing'));
});

test('every limit says the same thing and names no number, window or rule', async () => {
  const limit = 'Too many attempts. Try again later.';
  let r;
  for (let i = 0; i < 61; i++) r = await call('POST', '/v1/posts/hello-post/react', { body: { cid: CID, type: i % 2 ? 'like' : 'sad' }, ip: '3.3.3.3' });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, limit);
  for (let i = 0; i < 6; i++) r = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: `Comment number ${i} here` }), ip: '4.4.4.4' });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, limit);
  // five held comments from one visitor, then a sixth: the same sentence, not "you have comments waiting for review"
  for (let i = 0; i < 5; i++) await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: RUDE + ' ' + i, cid: CID2 }), ip: `5.5.5.${i}` });
  r = await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: RUDE + ' again', cid: CID2 }), ip: '5.5.5.9' });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, limit);
  for (let i = 0; i < 31; i++) r = await call('POST', '/v1/notify/unsubscribe', { body: { token: 'z'.repeat(32) }, ip: '6.6.6.6' });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, limit);
});

test('a repeated comment gets no error text from the server: the page shows its own plain "Comment received."', async () => {
  const first = await call('POST', '/v1/posts/hello-post/comments', { body: comment(), ip: '7.7.7.7' });
  const again = await call('POST', '/v1/posts/hello-post/comments', { body: comment(), ip: '7.7.7.7' });
  assert.equal(first.json.status, 'approved');
  assert.equal(again.json.status, 'duplicate', 'the page maps this status to a neutral sentence');
  assert.equal(again.json.id, undefined);
  assert.equal(again.json.error, undefined);
});
