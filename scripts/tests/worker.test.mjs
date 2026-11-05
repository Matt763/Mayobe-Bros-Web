// Tests the Worker against a real SQLite engine (Node's built-in node:sqlite) wrapped to look like Cloudflare D1.
import test from 'node:test';
import assert from 'node:assert/strict';
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
