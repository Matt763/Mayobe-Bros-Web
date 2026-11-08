// The approve / ignore buttons of the held-comment email, and the "approved by Admin" mark on a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';
import { reviewToken, checkReviewToken, reviewLinks, REVIEW_DAYS } from '../../worker/src/review.js';
import { ownerAlertEmail } from '../../worker/src/mail-templates.js';

const ORIGIN = 'https://mayobebros.com';
const SECRET = 'a-long-review-secret-for-tests-123';
const RUDE = 'You are an idiot and a fool, mjinga wewe.';
const realFetch = globalThis.fetch;
let env, sent, pending;

test.before(() => {
  globalThis.fetch = async (u, init) => {
    if (String(u).endsWith('/data/search.json')) return new Response(JSON.stringify([{ s: 'hello-post', t: 'Hello Post Title', u: '/post/guides/hello-post/' }]), { status: 200 });
    if (String(u) === 'https://api.resend.com/emails') { sent.push({ body: JSON.parse(init.body), headers: init.headers }); return new Response(JSON.stringify({ id: `m${sent.length}` }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
});
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => {
  sent = []; pending = [];
  env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key', REVIEW_SECRET: SECRET, REVIEW_EMAILS: 'mclean@mayobebros.com, MbagaMclean@gmail.com' };
});
test.afterEach(async () => { while (pending.length) await Promise.all(pending.splice(0)); });
const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)); };

async function call(method, path, { body, origin = ORIGIN, auth, ip = '1.1.1.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: (p) => { pending.push(p); } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const held = async (over = {}) => {
  const r = await call('POST', '/v1/posts/hello-post/comments', { body: { name: 'Asha', body: RUDE, cid: 'abcdefabcdefabcdef12', ts: Date.now() - 10000, ...over }, ip: '3.3.3.3' });
  await flush();
  return r;
};
const listed = async () => (await call('GET', '/v1/posts/hello-post')).json.comments;
const tokenFrom = (url) => decodeURIComponent(String(url).split('#r=')[1]);

test('a token works for its comment and action only, expires after 7 days, and a changed character breaks it', async () => {
  const t = await reviewToken(env, 42, 'approve');
  assert.deepEqual(await checkReviewToken(env, t), { id: 42, action: 'approve' });
  assert.deepEqual(await checkReviewToken(env, await reviewToken(env, 42, 'ignore')), { id: 42, action: 'ignore' });
  const [id, a, exp, sig] = t.split('.');
  assert.equal(await checkReviewToken(env, [43, a, exp, sig].join('.')), null, 'another comment');
  assert.equal(await checkReviewToken(env, [id, 'i', exp, sig].join('.')), null, 'another action');
  assert.equal(await checkReviewToken(env, [id, a, (parseInt(exp, 36) + 1).toString(36), sig].join('.')), null, 'a longer life');
  assert.equal(await checkReviewToken(env, [id, a, exp, sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')].join('.')), null, 'a changed signature');
  assert.equal(await checkReviewToken({ REVIEW_SECRET: 'some-other-secret-value-1234' }, t), null, 'another secret');
  const later = Date.now() + (REVIEW_DAYS * 86400 + 5) * 1000;
  assert.equal(await checkReviewToken(env, t, later), null, 'expired');
  assert.ok(await checkReviewToken(env, t, Date.now() + (REVIEW_DAYS * 86400 - 60) * 1000), 'still valid a minute before the end');
});

test('without REVIEW_SECRET (or with a short one) no token and no links are made', async () => {
  for (const REVIEW_SECRET of [undefined, '', 'short']) {
    assert.equal(await reviewToken({ REVIEW_SECRET }, 1, 'approve'), '');
    assert.equal(await reviewLinks({ REVIEW_SECRET }, 1, ORIGIN), null);
    assert.equal(await checkReviewToken({ REVIEW_SECRET }, '1.a.zzzzzz.' + 'A'.repeat(43)), null);
  }
  assert.equal(await reviewToken(env, 0, 'approve'), '');
  assert.equal(await reviewToken(env, 1, 'delete'), '', 'only approve and ignore exist');
});

test('a held comment is mailed to both review addresses, each with an Approve and an Ignore link on our own /manage/ page', async () => {
  const h = await held();
  assert.equal(h.json.status, 'pending');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((s) => s.body.to[0]).sort(), ['mbagamclean@gmail.com', 'mclean@mayobebros.com']);
  assert.notEqual(sent[0].headers['Idempotency-Key'], sent[1].headers['Idempotency-Key']);
  for (const s of sent) {
    const links = [...s.body.text.matchAll(/https:\/\/mayobebros\.com\/manage\/#r=[A-Za-z0-9._-]+/g)].map((m) => m[0]);
    assert.equal(links.length, 2, 'approve + ignore in the text part');
    assert.deepEqual(await checkReviewToken(env, tokenFrom(links[0])), { id: h.json.id, action: 'approve' });
    assert.deepEqual(await checkReviewToken(env, tokenFrom(links[1])), { id: h.json.id, action: 'ignore' });
    assert.match(s.body.html, />Approve this comment</);
    assert.match(s.body.html, />Ignore</);
    assert.ok(!/node scripts\/comments\.mjs/.test(s.body.text), 'no command when the buttons exist');
  }
});

test('without REVIEW_SECRET the held alert still goes out, with the old command and no links', async () => {
  delete env.REVIEW_SECRET;
  await held();
  assert.equal(sent.length, 2);
  for (const s of sent) { assert.ok(s.body.text.includes('node scripts/comments.mjs list')); assert.ok(!s.body.text.includes('#r=')); }
});

test('without REVIEW_EMAILS the alert goes to OWNER_EMAIL only', async () => {
  delete env.REVIEW_EMAILS; env.OWNER_EMAIL = 'owner@example.org';
  await held();
  assert.deepEqual(sent.map((s) => s.body.to[0]), ['owner@example.org']);
});

test('pressing Approve publishes the comment, counts it, and marks it "approved by Admin"', async () => {
  const h = await held();
  assert.deepEqual(await listed(), [], 'hidden before');
  const t = await reviewToken(env, h.json.id, 'approve');
  const r = await call('POST', '/v1/review', { body: { r: t } });
  assert.equal(r.status, 200);
  assert.equal(r.json.result, 'approved');
  assert.equal(r.json.path, '/post/guides/hello-post/');
  const c = await listed();
  assert.equal(c.length, 1);
  assert.equal(c[0].ab, 1, 'the mark is public');
  assert.equal((await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c, 1);
  const again = await call('POST', '/v1/review', { body: { r: t } });
  assert.equal(again.json.result, 'already', 'a second press is harmless');
  assert.equal((await call('GET', '/v1/stats?slugs=hello-post')).json['hello-post'].c, 1, 'counted once');
});

test('pressing Ignore changes nothing: the comment stays hidden and can still be approved later', async () => {
  const h = await held();
  const r = await call('POST', '/v1/review', { body: { r: await reviewToken(env, h.json.id, 'ignore') } });
  assert.equal(r.status, 200);
  assert.equal(r.json.result, 'kept');
  assert.deepEqual(await listed(), []);
  assert.equal((await call('POST', '/v1/review', { body: { r: await reviewToken(env, h.json.id, 'approve') } })).json.result, 'approved');
});

test('a bad, expired, unsigned or foreign link is refused and approves nothing', async () => {
  const h = await held();
  const t = await reviewToken(env, h.json.id, 'approve');
  const bad = [t.slice(0, -2) + 'xx', 'garbage', '', t.replace(/^\d+/, '9999'), await reviewToken({ REVIEW_SECRET: 'another-secret-value-12345' }, h.json.id, 'approve')];
  for (const r of bad) assert.equal((await call('POST', '/v1/review', { body: { r } })).status, 404, String(r).slice(0, 20));
  assert.equal((await call('POST', '/v1/review', { body: {} })).status, 404);
  assert.equal((await call('POST', '/v1/review', { body: { r: t }, origin: 'https://evil.example' })).status, 403, 'a page on another site cannot press it');
  assert.equal((await call('POST', '/v1/review', { body: { r: t }, origin: null })).status, 403);
  assert.deepEqual(await listed(), []);
  delete env.REVIEW_SECRET;
  assert.equal((await call('POST', '/v1/review', { body: { r: t } })).status, 404, 'no secret: every link is dead');
});

test('a comment its author deleted cannot be approved; a missing one answers 404', async () => {
  const h = await held();
  env.DB.raw.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?").run(h.json.id);
  assert.equal((await call('POST', '/v1/review', { body: { r: await reviewToken(env, h.json.id, 'approve') } })).status, 409);
  assert.equal((await call('POST', '/v1/review', { body: { r: await reviewToken(env, 777, 'approve') } })).status, 404);
});

test('a comment approved by hand through the admin API gets the mark too; a clean comment and an edited one do not', async () => {
  const h = await held();
  await call('POST', `/v1/admin/comments/${h.json.id}`, { body: { action: 'approve' }, auth: env.ADMIN_TOKEN, origin: null });
  assert.equal((await listed())[0].ab, 1);
  const clean = await call('POST', '/v1/posts/hello-post/comments', { body: { name: 'Neema', body: 'Thank you, very useful.', cid: 'zzzzzzzzzzzzzzzzzz34', ts: Date.now() - 10000 }, ip: '4.4.4.4' });
  assert.equal(clean.json.status, 'approved');
  const cs = await listed();
  assert.equal(cs.find((c) => c.id === clean.json.id).ab, undefined, 'the automatic screen does not earn the mark');
  const ed = await call('POST', `/v1/comments/${clean.json.id}/edit`, { body: { token: clean.json.token, body: 'Thank you, very useful indeed.' } });
  assert.equal(ed.status, 200);
  // an admin-approved comment that its author edits is a new text nobody approved
  env.DB.raw.prepare("UPDATE comments SET manage_hash = (SELECT manage_hash FROM comments WHERE id = ?) WHERE id = ?").run(clean.json.id, h.json.id);
  env.DB.raw.prepare("UPDATE comments SET approved_by = 'admin' WHERE id = ?").run(clean.json.id);
  const ed2 = await call('POST', `/v1/comments/${clean.json.id}/edit`, { body: { token: clean.json.token, body: 'Thank you, very useful again.' } });
  assert.equal(ed2.status, 200);
  assert.equal(env.DB.raw.prepare('SELECT approved_by FROM comments WHERE id = ?').get(clean.json.id).approved_by, null);
});

test('the email shows Approve as the one filled button and Ignore as a quiet outlined one; hostile link values are dropped', () => {
  const ok = ownerAlertEmail({ kind: 'held', commentId: 5, postSlug: 'a', body: 'text', name: 'Jo', reason: 'link', approveUrl: `${ORIGIN}/manage/#r=1.a.x.${'A'.repeat(43)}`, ignoreUrl: `${ORIGIN}/manage/#r=1.i.x.${'A'.repeat(43)}` }, { origin: ORIGIN });
  assert.equal((ok.html.match(/bgcolor="/g) || []).length >= 1, true);
  assert.match(ok.html, /class="mb-btn2-a"[^>]*>Ignore</);
  assert.match(ok.html, /mb-btn2\{border-color/, 'dark mode restyles it');
  assert.ok(ok.text.includes('Approve this comment:') && ok.text.includes('Ignore:'));
  const evil = ownerAlertEmail({ kind: 'held', commentId: 5, body: 't', approveUrl: 'https://evil.example/x', ignoreUrl: 'javascript:alert(1)' }, { origin: ORIGIN });
  assert.ok(!evil.html.includes('evil.example') && !evil.html.includes('javascript:'));
  assert.ok(evil.text.includes('node scripts/comments.mjs list'), 'falls back to the command');
  const q = ownerAlertEmail({ kind: 'question', body: 't', approveUrl: `${ORIGIN}/manage/#r=1`, ignoreUrl: `${ORIGIN}/manage/#r=2` }, { origin: ORIGIN });
  assert.ok(!q.html.includes('#r='), 'only a held comment has review buttons');
});
