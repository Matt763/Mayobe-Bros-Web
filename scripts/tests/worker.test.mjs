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

test('comments are held for review, then approved, then counted', async () => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  assert.equal(r.status, 202);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0, 'pending comments are invisible');
  assert.equal((await call('GET', '/v1/admin/comments')).status, 401);
  assert.equal((await call('GET', '/v1/admin/comments', { auth: 'wrong-token-wrong-token' })).status, 401);
  const list = await call('GET', '/v1/admin/comments?status=pending', { auth: env.ADMIN_TOKEN, origin: null });
  assert.equal(list.json.comments.length, 1);
  const id = list.json.comments[0].id;
  const ap = await call('POST', `/v1/admin/comments/${id}`, { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  assert.equal(ap.json.stats.c, 1);
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  assert.equal(pub.comments.length, 1);
  assert.equal(pub.comments[0].name, 'Asha');
  assert.equal('email' in pub.comments[0], false, 'email is never public');
  assert.equal((await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c, 1);
});

test('replies need an approved parent and nest one level', async () => {
  await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'A reply here', parent: 1 }) })).status, 400, 'parent not approved yet');
  await call('POST', '/v1/admin/comments/1', { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'A reply here', parent: 1 }) })).status, 202);
  await call('POST', '/v1/admin/comments/2', { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  const pub = (await call('GET', '/v1/posts/hello-post')).json;
  assert.equal(pub.comments.length, 1);
  assert.equal(pub.comments[0].replies.length, 1);
  assert.equal(pub.stats.c, 2);
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Nested too deep', parent: 2 }) })).status, 400);
});

test('spam and delete adjust the count and hide replies', async () => {
  await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  await call('POST', '/v1/admin/comments/1', { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Reply text', parent: 1 }) });
  await call('POST', '/v1/admin/comments/2', { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  assert.equal((await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c, 2);
  const r = await call('POST', '/v1/admin/comments/1', { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'delete' } });
  assert.equal(r.json.stats.c, 0);
  assert.equal((await call('GET', '/v1/posts/hello-post')).json.comments.length, 0);
  await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'Another one here', cid: CID2, ip: '9.9.9.9' }), ip: '9.9.9.9' });
  await call('POST', '/v1/admin/comments/3', { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'approve' } });
  assert.equal((await call('POST', '/v1/admin/comments/3', { auth: env.ADMIN_TOKEN, origin: null, body: { action: 'spam' } })).json.stats.c, 0);
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
  assert.equal((await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null })).json.comments.length, 0, 'bot posts are silently dropped');
});

test('rate limit and duplicate protection', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: `Comment number ${i} here` }) })).status, 202);
  assert.equal((await call('POST', '/v1/posts/hello-post/comments', { body: comment({ body: 'One more comment' }) })).status, 429);
  env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123' };
  await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  await call('POST', '/v1/posts/hello-post/comments', { body: comment() });
  assert.equal((await call('GET', '/v1/admin/comments', { auth: env.ADMIN_TOKEN, origin: null })).json.comments.length, 1, 'duplicate within 10 minutes is ignored');
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
