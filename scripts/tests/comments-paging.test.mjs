// A post with a thousand comments: the Worker sends newest conversations first, 20 a page, and never cuts the newest off.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';

const ORIGIN = 'https://mayobebros.com';
const realFetch = globalThis.fetch;
let env;
test.before(() => {
  globalThis.fetch = async (u) => (String(u).endsWith('/data/search.json')
    ? new Response(JSON.stringify([{ s: 'hello-post', t: 'Hello', u: '/post/hello-post/' }]), { status: 200 })
    : new Response('{}', { status: 404 }));
});
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => { env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN }; });
const get = async (q = '') => {
  const res = await worker.fetch(new Request(`https://api.test/v1/posts/hello-post${q}`, { headers: { Origin: ORIGIN } }), env, { waitUntil() {} });
  return res.json();
};
const seed = (n, { replyEvery = 0 } = {}) => {
  env.DB.raw.exec("INSERT OR IGNORE INTO posts(slug, created) VALUES('hello-post', 1)");
  const ins = env.DB.raw.prepare("INSERT INTO comments(slug, parent_id, name, body, status, created, cid, team) VALUES('hello-post', ?, ?, ?, 'approved', ?, 'c', 0)");
  for (let i = 1; i <= n; i++) {
    const r = ins.run(null, `User ${i}`, `Comment number ${i}`, 1000 + i);
    if (replyEvery && i % replyEvery === 0) ins.run(Number(r.lastInsertRowid), 'Replier', `Reply to ${i}`, 5000 + i);
  }
};

test('1,200 comments: pages of 20, newest first, no overlap, the last page says there is no more', async () => {
  seed(1200);
  const seen = [];
  let q = '', pages = 0;
  for (;;) {
    const j = await get(q);
    pages++;
    assert.ok(j.comments.length <= 20);
    seen.push(...j.comments.map((c) => c.at));
    if (!j.more) { assert.equal(j.next, undefined); break; }
    assert.equal(j.next, seen.length);
    q = `?offset=${j.next}`;
    assert.ok(pages < 100);
  }
  assert.equal(pages, 60);
  assert.equal(seen.length, 1200);
  assert.equal(new Set(seen).size, 1200, 'no comment twice');
  assert.deepEqual(seen, [...seen].sort((a, b) => b - a), 'newest first across pages');
  assert.equal(seen[0], 2200, 'the very newest comment is on page 1 (it used to be cut off after 500)');
});

test('replies travel with their conversation and are oldest first; the response stays small', async () => {
  seed(60, { replyEvery: 3 });
  const first = await get();
  assert.equal(first.comments.length, 20);
  assert.equal(first.more, true);
  const withReply = first.comments.filter((c) => c.replies.length);
  assert.ok(withReply.length >= 6);
  for (const c of withReply) { assert.equal(c.replies.length, 1); assert.match(c.replies[0].body, /^Reply to /); }
  assert.ok(JSON.stringify(first).length < 20000, 'a page is a few KB, not the whole thread');
});

test('a bad or huge offset is harmless', async () => {
  seed(5);
  for (const q of ['?offset=-5', '?offset=abc', '?offset=99999999999', '?offset=1.9']) {
    const j = await get(q);
    assert.ok(Array.isArray(j.comments), q);
  }
  assert.equal((await get('?offset=-5')).comments.length, 5);
  assert.equal((await get('?offset=99999999999')).comments.length, 0);
});

test('a deleted comment with replies stays as a tombstone inside its page', async () => {
  seed(3, { replyEvery: 1 });
  env.DB.raw.prepare("UPDATE comments SET status = 'deleted', name = '', body = '' WHERE id = 1").run();
  const j = await get();
  const t = j.comments.find((c) => c.deleted);
  assert.ok(t && t.replies.length === 1 && t.body === 'This comment was deleted.');
});
