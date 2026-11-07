// Newsletter Worker routes (subscribe, confirm) against the SQLite-backed D1 shim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';

const ORIGIN = 'https://mayobebros.com';
const realFetch = globalThis.fetch;
const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURE = [
  { s: 'old-one', t: 'Old One', u: '/post/old-one/', e: 'Old excerpt', c: 'Educational', d: '2026-01-01', i: '/assets/posts/a.webp' },
  { s: 'new-one', t: 'New One', u: '/post/new-one/', e: 'New excerpt', c: 'Educational', d: '2026-10-30', i: '/assets/posts/b.webp' },
  { s: 'mid-one', t: 'Mid One', u: '/post/mid-one/', e: 'Mid excerpt', c: 'Educational', d: '2026-06-01', i: '/assets/posts/c.webp' },
  { s: 'older-one', t: 'Older One', u: '/post/older-one/', e: 'Older excerpt', c: 'Educational', d: '2026-03-01', i: '/assets/posts/d.webp' },
  { s: 'future-one', t: 'Future One', u: '/post/future-one/', e: 'Future excerpt', c: 'Educational', d: '2999-01-01', i: '/assets/posts/e.webp' },
];
let env;
let sent = [];
let resendMode = 'ok';
let pendingMail = [];
test.before(() => {
  globalThis.fetch = async (u, init) => {
    if (String(u).endsWith('/data/search.json')) return new Response(JSON.stringify(FIXTURE), { status: 200 });
    if (String(u) === 'https://api.resend.com/emails') {
      sent.push({ body: JSON.parse(init.body), headers: init.headers });
      if (resendMode === 'throw') throw new Error('network down');
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
});
test.after(() => { globalThis.fetch = realFetch; });
const flushMail = async () => { while (pendingMail.length) await Promise.all(pendingMail.splice(0)); };
test.afterEach(flushMail);
test.beforeEach(() => { sent = []; resendMode = 'ok'; pendingMail = []; env = { DB: makeD1(), SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key', API_ORIGIN: 'https://worker.test' }; });

async function call(path, { body, origin = ORIGIN, ip = '1.1.1.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) }), env, { waitUntil: (p) => { pendingMail.push(p); } });
  const text = await res.text();
  await flushMail();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const sub = (email, over = {}, opts = {}) => call('/v1/newsletter/subscribe', { body: { email, website: '', ts: Date.now() - 10000, ...over }, ...opts });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const rows = (sql, ...a) => env.DB.raw.prepare(sql).all(...a);
const tokenFrom = (msg, mark) => new RegExp(`${mark.replace('/', '\\/')}([A-Za-z0-9_-]{32,64})`).exec(msg.body.html)?.[1];

test('subscribe gives the same 200 {ok:true} for a new, pending, active, unsubscribed, suppressed and already-mailed-today address', async () => {
  const out = [];
  const count = () => sent.length;
  let before = count();
  out.push(await sub('new@example.com', {}, { ip: '2.0.0.1' }));
  assert.equal(count() - before, 1, 'new');
  env.DB.raw.exec('DELETE FROM hits');
  before = count();
  out.push(await sub('new@example.com', {}, { ip: '2.0.0.2' }));
  assert.equal(count() - before, 1, 'pending');
  env.DB.raw.exec("UPDATE newsletter_subscribers SET status = 'active', confirmed = 1");
  env.DB.raw.exec('DELETE FROM hits');
  before = count();
  out.push(await sub('new@example.com', {}, { ip: '2.0.0.3' }));
  assert.equal(count() - before, 0, 'active');
  env.DB.raw.exec("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed = 1");
  env.DB.raw.exec('DELETE FROM hits');
  before = count();
  out.push(await sub('new@example.com', {}, { ip: '2.0.0.4' }));
  assert.equal(count() - before, 1, 'unsubscribed');
  env.DB.raw.exec("INSERT INTO suppressed(email, reason, created) VALUES('bounced@example.com', 'bounce', 1)");
  before = count();
  out.push(await sub('bounced@example.com', {}, { ip: '2.0.0.5' }));
  assert.equal(count() - before, 0, 'suppressed');
  before = count();
  out.push(await sub('bounced@example.com', {}, { ip: '2.0.0.6' }));
  out.push(await sub('new@example.com', {}, { ip: '2.0.0.7' })); // mailed already today (per-address key is still set)
  assert.equal(count() - before, 0, 'second the same day');
  for (const r of out) assert.deepEqual(r, { status: 200, json: { ok: true } });
});

test('the confirmation email carries no visitor text and a hashed one-time token', async () => {
  await sub('Reader@Example.com');
  assert.equal(sent.length, 1);
  const m = sent[0].body;
  assert.deepEqual(m.to, ['reader@example.com']);
  assert.equal(m.subject, 'Please confirm your Mayobe Bros subscription');
  assert.match(m.html, /https:\/\/mayobebros\.com\/newsletter\/#c=[A-Za-z0-9_-]{32,64}/);
  assert.match(m.text, /https:\/\/mayobebros\.com\/newsletter\/#c=[A-Za-z0-9_-]{32,64}/);
  const token = tokenFrom(sent[0], 'newsletter/#c=');
  assert.match(token, /^[A-Za-z0-9_-]{32,64}$/);
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE hash = ?', token).length, 0, 'the clear token is not stored');
  const row = rows('SELECT * FROM newsletter_tokens WHERE hash = ?', sha(token))[0];
  assert.equal(row.kind, 'confirm');
  assert.equal(row.expires, row.created + 7 * 86400000);
  assert.equal(JSON.stringify(sent[0].body.headers || {}).includes('List-Unsubscribe'), false);
  assert.equal(m.html.includes('Reader'), false, 'the typed address is not echoed into the body');
});

test('Foo.Bar+news@gmail.com and foobar@googlemail.com are one subscriber', async () => {
  await sub('Foo.Bar+news@gmail.com', {}, { ip: '3.0.0.1' });
  await sub('foobar@googlemail.com', {}, { ip: '3.0.0.2' });
  const r = rows('SELECT email, email_key FROM newsletter_subscribers');
  assert.equal(r.length, 1);
  assert.equal(r[0].email_key, 'foobar@gmail.com');
  assert.equal(sent.length, 1);
});

test('4th sign-up from one IP in an hour is 429 and sends nothing', async () => {
  for (let i = 1; i <= 3; i++) assert.equal((await sub(`p${i}@example.com`)).status, 200);
  const before = sent.length;
  const r = await sub('p4@example.com');
  assert.equal(r.status, 429);
  assert.equal(sent.length, before);
  assert.equal(rows("SELECT 1 FROM newsletter_subscribers WHERE email = 'p4@example.com'").length, 0);
});

test('honeypot or ts under 2500 ms: 200 {ok:true}, no row, no mail', async () => {
  for (const over of [{ website: 'http://bot' }, { ts: Date.now() - 500 }, { ts: undefined }]) {
    const r = await sub('bot@example.com', over);
    assert.deepEqual(r, { status: 200, json: { ok: true } });
  }
  assert.equal(rows('SELECT 1 FROM newsletter_subscribers').length, 0);
  assert.equal(sent.length, 0);
});

test('bad address: 400 field email', async () => {
  for (const e of ['a@b', `${'x'.repeat(250)}@y.zz`, 'x@y.z\r\nBcc: v@w.x', '', 'no at sign']) {
    const r = await sub(e);
    assert.equal(r.status, 400, JSON.stringify(e));
    assert.equal(r.json.field, 'email');
  }
  assert.equal(sent.length, 0);
});

test('no Origin or a foreign Origin: 403', async () => {
  assert.equal((await sub('a@example.com', {}, { origin: null })).status, 403);
  assert.equal((await sub('a@example.com', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/v1/newsletter/confirm', { body: { token: 'x'.repeat(32) }, origin: null })).status, 403);
});

test('no RESEND_API_KEY: 503 and no row', async () => {
  delete env.RESEND_API_KEY;
  const r = await sub('a@example.com');
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'The newsletter is not available right now.');
  assert.equal(rows('SELECT 1 FROM newsletter_subscribers').length, 0);
});

test('9th confirmation of the UTC day (9 different IPs and addresses) is not sent', async () => {
  for (let i = 1; i <= 9; i++) assert.equal((await sub(`d${i}@example.com`, {}, { ip: `4.0.0.${i}` })).status, 200);
  assert.equal(sent.length, 8);
  assert.equal(rows('SELECT 1 FROM newsletter_subscribers').length, 9);
});

async function confirmed(email = 'welcome@example.com') {
  await sub(email);
  const token = tokenFrom(sent[0], 'newsletter/#c=');
  sent.length = 0;
  const r = await call('/v1/newsletter/confirm', { body: { token } });
  return { token, r };
}

test('confirm: one press activates, deletes the token and sends one welcome', async () => {
  const { token, r } = await confirmed();
  assert.deepEqual(r, { status: 200, json: { ok: true } });
  const s = rows('SELECT * FROM newsletter_subscribers')[0];
  assert.equal(s.status, 'active');
  assert.ok(s.confirmed > 0);
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE hash = ?', sha(token)).length, 0);
  assert.equal(sent.length, 1);
  const m = sent[0].body;
  assert.equal(m.subject, 'Welcome to the Mayobe Bros newsletter');
  assert.deepEqual(m.to, ['welcome@example.com']);
  const titles = ['New One', 'Mid One', 'Older One'];
  const at = titles.map((t) => m.html.indexOf(t));
  assert.ok(at.every((x) => x > 0) && at[0] < at[1] && at[1] < at[2], 'three newest first');
  assert.equal(m.html.includes('Old One'), false);
  assert.equal(m.html.includes('Future One'), false, 'nothing dated after today');
  const u = tokenFrom(sent[0], 'newsletter/#u=');
  assert.match(u, /^[A-Za-z0-9_-]{32,64}$/);
  assert.equal(rows("SELECT kind, expires FROM newsletter_tokens WHERE hash = ?", sha(u))[0].kind, 'unsub');
  assert.equal(m.headers['List-Unsubscribe'], `<https://worker.test/v1/newsletter/one-click?t=${u}>`);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(TODAY);
});

test('confirm: a second press, an expired token (created set 8 days back), a malformed token and an unknown token all give the same 404 body', async () => {
  const { token } = await confirmed();
  const again = await call('/v1/newsletter/confirm', { body: { token } });
  await sub('late@example.com', {}, { ip: '5.0.0.1' });
  const late = tokenFrom(sent.at(-1), 'newsletter/#c=');
  const old = Date.now() - 8 * 86400000;
  env.DB.raw.prepare('UPDATE newsletter_tokens SET created = ?, expires = ? WHERE hash = ?').run(old, old + 7 * 86400000, sha(late));
  const results = [again,
    await call('/v1/newsletter/confirm', { body: { token: late } }),
    await call('/v1/newsletter/confirm', { body: { token: 'short' } }),
    await call('/v1/newsletter/confirm', { body: { token: 'A'.repeat(32) } }),
    await call('/v1/newsletter/confirm', { body: {} })];
  for (const r of results) assert.deepEqual(r, { status: 404, json: { error: 'That link has expired or was already used.' } });
  assert.equal(rows("SELECT status FROM newsletter_subscribers WHERE email = 'late@example.com'")[0].status, 'pending');
});

test('confirm still answers 200 when Resend throws', async () => {
  await sub('boom@example.com');
  const token = tokenFrom(sent[0], 'newsletter/#c=');
  resendMode = 'throw';
  const r = await call('/v1/newsletter/confirm', { body: { token } });
  assert.deepEqual(r, { status: 200, json: { ok: true } });
  assert.equal(rows('SELECT status FROM newsletter_subscribers')[0].status, 'active');
});

test('resubscribing after unsubscribe returns to pending, deletes the old tokens and sends a new confirmation', async () => {
  await confirmed('back@example.com');
  const id = rows('SELECT id FROM newsletter_subscribers')[0].id;
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE subscriber_id = ? AND kind = ?', id, 'unsub').length, 1);
  env.DB.raw.exec("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed = 5");
  env.DB.raw.exec('DELETE FROM hits');
  sent.length = 0;
  const r = await sub('back@example.com', {}, { ip: '6.0.0.1' });
  assert.deepEqual(r, { status: 200, json: { ok: true } });
  const s = rows('SELECT * FROM newsletter_subscribers')[0];
  assert.equal(s.status, 'pending');
  assert.equal(s.unsubscribed, null);
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE subscriber_id = ? AND kind = ?', id, 'unsub').length, 0, 'old unsubscribe links are gone');
  assert.equal(rows("SELECT 1 FROM newsletter_tokens WHERE subscriber_id = ? AND kind = 'confirm'", id).length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.subject, 'Please confirm your Mayobe Bros subscription');
});
