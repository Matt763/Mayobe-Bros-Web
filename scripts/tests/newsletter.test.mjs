// Newsletter Worker routes (subscribe, confirm) against the SQLite-backed D1 shim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { canonicalEmail } from '../../worker/src/util.js';
import worker from '../../worker/src/index.js';
import { unsubscribeKit, runNewsletter } from '../../worker/src/newsletter.js';
import { takeBudget } from '../../worker/src/mail.js';
import { makeD1 } from '../lib/d1-shim.mjs';

const ORIGIN = 'https://mayobebros.com';
const realFetch = globalThis.fetch;
const FIXTURE = [
  { s: 'old-one', t: 'Old One', u: '/post/old-one/', e: 'Old excerpt', c: 'Educational', d: '2026-01-01', i: '/assets/posts/a.webp', m: '0a0a0a0a', a: 'Alt old' },
  { s: 'new-one', t: 'New One', u: '/post/new-one/', e: 'New excerpt', c: 'Educational', d: '2026-10-30', i: '/assets/posts/b.webp', m: '0b0b0b0b', a: 'Alt new' },
  { s: 'mid-one', t: 'Mid One', u: '/post/mid-one/', e: 'Mid excerpt', c: 'Jobs and Internships', d: '2026-06-01', i: '/assets/posts/c.webp', m: '0c0c0c0c', w: '1c1c1c1c', a: 'Alt mid' },
  { s: 'older-one', t: 'Older One', u: '/post/older-one/', e: 'Older excerpt', c: 'Educational', d: '2026-03-01', i: '/assets/posts/d.webp', m: '0d0d0d0d', a: 'Alt older' },
  { s: 'future-one', t: 'Future One', u: '/post/future-one/', e: 'Future excerpt', c: 'Educational', d: '2999-01-01', i: '/assets/posts/e.webp', m: '0e0e0e0e', a: 'Alt future' },
];
let env;
let sent = [];
let resendMode = 'ok';
let pendingMail = [];
let searchList = FIXTURE; // what /data/search.json answers
let searchMode = 'ok'; // 'ok' | 'fail' (HTTP 500) | 'throw'
let resendFn = null; // optional (callNumber, body) => Response, or throws; replaces the default 200
let onFetch = null; // optional hook called for every fetch (counts subrequests)
test.before(() => {
  globalThis.fetch = async (u, init) => {
    if (onFetch) onFetch(String(u));
    if (String(u).endsWith('/data/search.json')) {
      if (searchMode === 'throw') throw new Error('site down');
      if (searchMode === 'fail') return new Response('oops', { status: 500 });
      return new Response(JSON.stringify(searchList), { status: 200 });
    }
    if (String(u) === 'https://api.resend.com/emails') {
      sent.push({ body: JSON.parse(init.body), headers: init.headers });
      if (resendFn) return resendFn(sent.length, JSON.parse(init.body));
      if (resendMode === 'throw') throw new Error('network down');
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
});
test.after(() => { globalThis.fetch = realFetch; });
const flushMail = async () => { while (pendingMail.length) await Promise.all(pendingMail.splice(0)); };
test.afterEach(flushMail);
test.beforeEach(() => { sent = []; resendMode = 'ok'; pendingMail = []; searchList = FIXTURE; searchMode = 'ok'; resendFn = null; onFetch = null; env = { DB: makeD1(), SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key', API_ORIGIN: 'https://worker.test' }; });

async function call(path, { body, origin = ORIGIN, ip = '1.1.1.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) }), env, { waitUntil: (p) => { pendingMail.push(p); } });
  const text = await res.text();
  await flushMail();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const sub = (email, over = {}, opts = {}) => call('/v1/newsletter/subscribe', { body: { email, website: '', elapsed: 10000, ...over }, ...opts });
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

test('a second sign-up for the same inbox key mails the stored address, never the typed variant', async () => {
  await sub('Victim@corp.com', {}, { ip: '2.2.2.2' });
  sent = [];
  env.DB.raw.prepare('DELETE FROM hits').run(); // lift the one-a-day limit so the variant is tried
  await sub('victim+x@corp.com', {}, { ip: '3.3.3.3' });
  assert.ok(sent.every((m) => [].concat(m.body.to).every((a) => a === 'victim@corp.com')), JSON.stringify(sent.map((m) => m.body.to)));
  const r = rows('SELECT email FROM newsletter_subscribers');
  assert.deepEqual(r.map((x) => x.email), ['victim@corp.com']);
});

test('with TURNSTILE_SECRET set, sign-up needs a verified token (fails closed); without it none is needed', async () => {
  env.TURNSTILE_SECRET = 'secret';
  const prev = globalThis.fetch;
  let verdict = true;
  globalThis.fetch = async (u, init) => String(u).includes('turnstile') ? new Response(JSON.stringify({ success: verdict })) : prev(u, init);
  try {
    let r = await sub('a1@example.com');
    assert.equal(r.status, 400); assert.equal(r.json.field, 'check');
    r = await sub('a2@example.com', { tt: 'tok' });
    assert.equal(r.status, 200);
    verdict = false;
    assert.equal((await sub('a3@example.com', { tt: 'tok' })).status, 400);
    assert.equal(rows("SELECT 1 FROM newsletter_subscribers WHERE email LIKE 'a3@%'").length, 0, 'nothing stored when the check fails');
  } finally { globalThis.fetch = prev; delete env.TURNSTILE_SECRET; }
  assert.equal((await sub('a4@example.com')).status, 200);
});

test('4th sign-up from one IP in an hour is 429 and sends nothing', async () => {
  for (let i = 1; i <= 3; i++) assert.equal((await sub(`p${i}@example.com`)).status, 200);
  const before = sent.length;
  const r = await sub('p4@example.com');
  assert.equal(r.status, 429);
  assert.equal(sent.length, before);
  assert.equal(rows("SELECT 1 FROM newsletter_subscribers WHERE email = 'p4@example.com'").length, 0);
});

// `elapsed` is the time the visitor spent on the page (measured by the browser), so a phone clock set wrong does not matter
test('honeypot, or elapsed missing, not a number or under 2500 ms: 200 {ok:true}, no row, no mail', async () => {
  for (const over of [{ website: 'http://bot' }, { elapsed: 500 }, { elapsed: 2499 }, { elapsed: undefined }, { elapsed: 'abc' }, { elapsed: null }, { elapsed: -9000 }, { elapsed: undefined, ts: Date.now() - 10000 }]) {
    const r = await sub('bot@example.com', over);
    assert.deepEqual(r, { status: 200, json: { ok: true } });
  }
  assert.equal(rows('SELECT 1 FROM newsletter_subscribers').length, 0);
  assert.equal(sent.length, 0);
});

test('elapsed of exactly 2500 ms, or a numeric string, is a person', async () => {
  for (const [i, elapsed] of [[1, 2500], [2, '4000']]) {
    const r = await sub(`slow${i}@example.com`, { elapsed });
    assert.deepEqual(r, { status: 200, json: { ok: true } });
    await flushMail();
    assert.equal(rows(`SELECT 1 FROM newsletter_subscribers WHERE email = 'slow${i}@example.com'`).length, 1, String(elapsed));
  }
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
  assert.equal(r.json.error, 'Could not subscribe. Try again later.');
  assert.equal(rows('SELECT 1 FROM newsletter_subscribers').length, 0);
});

test('9th confirmation of the UTC day (9 different IPs and addresses) is not sent', async () => {
  for (let i = 1; i <= 9; i++) assert.equal((await sub(`d${i}@example.com`, {}, { ip: `4.0.0.${i}` })).status, 200);
  assert.equal(sent.length, 8);
  assert.equal(rows('SELECT 1 FROM newsletter_subscribers').length, 9);
  const ninth = rows("SELECT id FROM newsletter_subscribers WHERE email = 'd9@example.com'")[0].id;
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE subscriber_id = ?', ninth).length, 0, 'the 9th row got no confirm token');
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
  for (const r of results) assert.deepEqual(r, { status: 404, json: { error: 'Link is invalid or expired.' } });
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

// ---- Task 2: unsubscribe ----
const UNSUB = 'You have unsubscribed from Mayobe Bros';
const farewells = () => sent.filter((m) => m.body.subject === UNSUB);
async function active(email = 'leaver@example.com') {
  await confirmed(email);
  const u = tokenFrom(sent[0], 'newsletter/#u=');
  sent.length = 0;
  return u;
}
async function oneClick(t, { body = 'List-Unsubscribe=One-Click', ip = '1.1.1.1', method = 'POST' } = {}) {
  const res = await worker.fetch(new Request(`https://api.test/v1/newsletter/one-click?t=${t}`, { method, headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/x-www-form-urlencoded' }, body: method === 'POST' ? body : undefined, redirect: 'manual' }), env, { waitUntil: (p) => { pendingMail.push(p); } });
  const text = await res.text();
  await flushMail();
  return { status: res.status, location: res.headers.get('Location'), json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}
const statusOf = () => rows('SELECT status, unsubscribed, farewell_sent FROM newsletter_subscribers')[0];

test('the button unsubscribes once and sends one farewell; a second press is 200 with no second farewell', async () => {
  const u = await active();
  const r = await call('/v1/newsletter/unsubscribe', { body: { token: u } });
  assert.deepEqual(r, { status: 200, json: { ok: true } });
  const s = statusOf();
  assert.equal(s.status, 'unsubscribed');
  assert.ok(s.unsubscribed > 0);
  assert.equal(farewells().length, 1);
  assert.deepEqual(farewells()[0].body.to, ['leaver@example.com']);
  assert.match(farewells()[0].body.html, /https:\/\/mayobebros\.com\/newsletter\/"/);
  const again = await call('/v1/newsletter/unsubscribe', { body: { token: u } });
  assert.deepEqual(again, { status: 200, json: { ok: true } });
  assert.equal(farewells().length, 1);
});

test('unknown and malformed tokens give the same 404', async () => {
  await active();
  const bad = [await call('/v1/newsletter/unsubscribe', { body: { token: 'A'.repeat(32) } }), await call('/v1/newsletter/unsubscribe', { body: { token: 'short' } }), await call('/v1/newsletter/unsubscribe', { body: {} }), await call('/v1/newsletter/unsubscribe', { body: { token: 5 } })];
  for (const r of bad) assert.deepEqual(r, { status: 404, json: { error: 'Link is invalid or expired.' } });
  assert.equal(statusOf().status, 'active');
});

test('the unsubscribe button needs the site Origin', async () => {
  const u = await active();
  const r = await call('/v1/newsletter/unsubscribe', { body: { token: u }, origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(statusOf().status, 'active');
});

test('an unsubscribe token from the welcome still works after later emails made new ones', async () => {
  const u = await active();
  const id = rows('SELECT id FROM newsletter_subscribers')[0].id;
  await unsubscribeKit(env, id);
  await unsubscribeKit(env, id);
  assert.equal(rows("SELECT 1 FROM newsletter_tokens WHERE kind = 'unsub'").length, 3);
  assert.deepEqual(await call('/v1/newsletter/unsubscribe', { body: { token: u } }), { status: 200, json: { ok: true } });
  assert.equal(statusOf().status, 'unsubscribed');
});

test('one-click POST without Origin and with the RFC 8058 body unsubscribes and sends no farewell', async () => {
  const u = await active();
  const r = await oneClick(u);
  assert.deepEqual(r, { status: 200, location: null, json: { ok: true } });
  assert.equal(statusOf().status, 'unsubscribed');
  assert.equal(sent.length, 0);
});

test('one-click with a wrong body is 400 and changes nothing; with an unknown token it is 200 and changes nothing', async () => {
  const u = await active();
  for (const body of ['', 'List-Unsubscribe=Other', 'List-Unsubscribe=One-Click&x=1', 'x'.repeat(2000)]) assert.equal((await oneClick(u, { body })).status, 400, body.slice(0, 20));
  assert.equal(statusOf().status, 'active');
  assert.equal((await oneClick('A'.repeat(32))).status, 200);
  assert.equal((await oneClick('short')).status, 200);
  assert.equal(statusOf().status, 'active');
});

test('GET one-click redirects 303 to the page fragment and changes nothing', async () => {
  const u = await active();
  const r = await oneClick(u, { method: 'GET' });
  assert.equal(r.status, 303);
  assert.equal(r.location, `https://mayobebros.com/newsletter/#u=${u}`);
  assert.equal(statusOf().status, 'active');
  const odd = await oneClick('<bad>', { method: 'GET' });
  assert.equal(odd.status, 303);
  assert.equal(odd.location, 'https://mayobebros.com/newsletter/');
  assert.equal(statusOf().status, 'active');
});

const WH_KEY = Buffer.from('test-signing-key-0123456789abcdef');
async function complaint(to, type = 'email.complained') {
  env.RESEND_WEBHOOK_SECRET = `whsec_${WH_KEY.toString('base64')}`;
  const raw = JSON.stringify({ type, data: { to } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v1,${createHmac('sha256', WH_KEY).update(`msg_1.${ts}.${raw}`).digest('base64')}`;
  const res = await worker.fetch(new Request('https://api.test/v1/webhooks/resend', { method: 'POST', headers: { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sig }, body: raw }), env, { waitUntil: (p) => { pendingMail.push(p); } });
  await flushMail();
  return res.status;
}

test('a complained address is suppressed and its subscriber row becomes unsubscribed', async () => {
  await active('Foo.Bar+x@gmail.com');
  assert.equal(await complaint(['foobar@googlemail.com', 'Foo.Bar+x@gmail.com']), 200);
  assert.equal(statusOf().status, 'unsubscribed');
  assert.equal(sent.length, 0, 'no farewell to someone who complained');
  assert.equal(rows('SELECT 1 FROM suppressed WHERE email = ?', 'foo.bar+x@gmail.com').length, 1);
});

test('a bounce suppresses but does not touch the subscriber row', async () => {
  await active('b@example.com');
  assert.equal(await complaint(['b@example.com'], 'email.bounced'), 200);
  assert.equal(statusOf().status, 'active');
});

test('the 31st unsubscribe button call in an hour from one IP is 429', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await call('/v1/newsletter/unsubscribe', { body: { token: 'A'.repeat(32) }, ip: '8.0.0.1' })).status, 404);
  assert.equal((await call('/v1/newsletter/unsubscribe', { body: { token: 'A'.repeat(32) }, ip: '8.0.0.1' })).status, 429);
  assert.equal((await call('/v1/newsletter/unsubscribe', { body: { token: 'A'.repeat(32) }, ip: '8.0.0.2' })).status, 404);
});

test('one-click POST is not limited per IP (mail providers share addresses): the 41st from one IP still unsubscribes', async () => {
  const u = await active();
  for (let i = 0; i < 40; i++) assert.equal((await oneClick('A'.repeat(32), { ip: '8.0.0.9' })).status, 200);
  assert.deepEqual(await oneClick(u, { ip: '8.0.0.9' }), { status: 200, location: null, json: { ok: true } });
  assert.equal(statusOf().status, 'unsubscribed');
});

test('a complaint for an owner address leaves the owner subscriber row untouched', async () => {
  env.OWNER_EMAIL = 'info@mayobebros.com';
  env.DB.raw.prepare("INSERT INTO newsletter_subscribers(email, email_key, status, created, confirmed) VALUES('info@mayobebros.com', 'info@mayobebros.com', 'active', 1, 2)").run();
  assert.equal(await complaint(['info@mayobebros.com', 'INFO@mayobebros.com']), 200);
  assert.deepEqual({ ...rows('SELECT status, unsubscribed, confirmed FROM newsletter_subscribers')[0] }, { status: 'active', unsubscribed: null, confirmed: 2 });
  assert.equal(rows('SELECT 1 FROM suppressed').length, 0);
});

test('farewell still not resent after Resend fails the first time', async () => {
  const u = await active();
  resendMode = 'throw';
  assert.deepEqual(await call('/v1/newsletter/unsubscribe', { body: { token: u } }), { status: 200, json: { ok: true } });
  assert.equal(farewells().length, 1);
  assert.equal(statusOf().farewell_sent, 1);
  resendMode = 'ok';
  await call('/v1/newsletter/unsubscribe', { body: { token: u } });
  assert.equal(farewells().length, 1, 'at most once');
});

// ---- Task 3: the daily sender ----
const dayOf = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const entry = (s, d, over = {}) => ({ s, t: `Title ${s}`, u: `/post/educational/${s}/`, e: `Excerpt for ${s}`, c: 'Educational', d, i: `/assets/posts/${s}.webp`, m: '5eed5eed', a: `Alt for ${s}`, ...over });
const OLD_LIST = [entry('first-post', dayOf(-40)), entry('second-post', dayOf(-3))];
let sleeps = [];
let sleepHook = null;
const recSleep = async (ms) => { sleeps.push(ms); if (sleepHook) await sleepHook(sleeps.length); };
const cronCtx = () => ({ waitUntil: (p) => { pendingMail.push(p); } });
async function run(opts = {}) {
  const r = await runNewsletter(env, cronCtx(), { sleep: recSleep, ...opts });
  await flushMail();
  return r;
}
// Runs again while a run stops at the subrequest ceiling (as the six cron runs of a morning would); returns the last report.
async function runAll(opts = {}) {
  let r;
  for (let i = 0; i < 20; i++) { r = await run(opts); if (r.stopped !== 'subrequests') return r; }
  throw new Error('runAll did not finish');
}
function addSub(email, { status = 'active', confirmed = Date.now() - 86400000, created = Date.now() - 2 * 86400000, unsubscribed = null } = {}) {
  return Number(env.DB.raw.prepare('INSERT INTO newsletter_subscribers(email, email_key, status, created, confirmed, unsubscribed) VALUES(?, ?, ?, ?, ?, ?)')
    .run(email, email, status, created, status === 'pending' ? null : confirmed, unsubscribed).lastInsertRowid);
}
const postMails = () => sent.filter((m) => m.body.subject.startsWith('New article:'));
const to = (m) => m.body.to[0];
async function seeded(list = OLD_LIST) {
  searchList = list;
  const r = await run();
  assert.equal(sent.length, 0);
  return r;
}
const count = (t) => rows(`SELECT COUNT(*) AS n FROM ${t}`)[0].n;
function sendOn() { env.NEWSLETTER_SEND = 'true'; sleeps = []; sleepHook = null; }

test('the first run with an empty newsletter_sent seeds every listed post and sends nothing, even when paused', async () => {
  for (const flag of ['false', 'true', undefined]) {
    env = { DB: makeD1(), SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key', API_ORIGIN: 'https://worker.test', NEWSLETTER_SEND: flag };
    sent = [];
    addSub('a@example.com');
    searchList = [...OLD_LIST, entry('today-post', dayOf(0))];
    const r = await run();
    assert.deepEqual([...r.seeded].sort(), ['first-post', 'second-post', 'today-post'], String(flag));
    assert.equal(sent.length, 0);
    const s = rows('SELECT * FROM newsletter_sent');
    assert.equal(s.length, 3);
    for (const x of s) { assert.equal(x.seeded, 1); assert.ok(x.sent_at > 0); }
    assert.equal(count('newsletter_deliveries'), 0);
    const again = await run(); // the next day: nothing is new
    assert.deepEqual(again.seeded, []);
    assert.equal(sent.length, 0);
  }
});

test('no seed and no write when search.json fails, is not an array or has no valid entry; the next good run seeds', async () => {
  sendOn();
  addSub('a@example.com');
  const cases = [
    ['fail', OLD_LIST], ['throw', OLD_LIST], ['ok', { posts: OLD_LIST }], ['ok', []], ['ok', null],
    ['ok', [entry('Bad Slug', dayOf(-2)), entry('evil', dayOf(-2), { u: 'https://evil.example/x' }), entry('dbl', dayOf(-2), { u: '/post//x/' }), entry('later', dayOf(2)), entry('nodate', '2026-1-1'), null, 7]],
  ];
  for (const [mode, list] of cases) {
    searchMode = mode; searchList = list;
    const r = await run();
    assert.equal(r.stopped, 'no-list', `${mode} ${JSON.stringify(list)?.slice(0, 40)}`);
    assert.equal(count('newsletter_sent'), 0);
    assert.equal(count('newsletter_deliveries'), 0);
    assert.equal(sent.length, 0);
  }
  searchMode = 'ok'; searchList = OLD_LIST;
  const r = await run();
  assert.equal(r.stopped, null);
  assert.deepEqual([...r.seeded].sort(), ['first-post', 'second-post']);
  assert.equal(sent.length, 0);
});

test('after the seed, a new post goes once to each active subscriber confirmed before it was queued', async () => {
  await seeded();
  sendOn();
  const a = addSub('a@example.com');
  addSub('pending@example.com', { status: 'pending' });
  addSub('gone@example.com', { status: 'unsubscribed', unsubscribed: Date.now() - 1000 });
  addSub('late@example.com', { confirmed: Date.now() + 3600000 }); // confirmed after the post was queued
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  const r = await run();
  assert.equal(r.stopped, null);
  assert.deepEqual(postMails().map(to), ['a@example.com']);
  assert.deepEqual(r.posts, [{ slug: 'fresh-post', recipients: 1, sent: 1, skipped: 0, failed: 0 }]);
  const row = rows("SELECT * FROM newsletter_sent WHERE slug = 'fresh-post'")[0];
  assert.equal(row.seeded, 0);
  assert.ok(row.sent_at >= row.queued_at);
  assert.deepEqual(rows('SELECT subscriber_id, status FROM newsletter_deliveries').map((x) => ({ ...x })), [{ subscriber_id: a, status: 'sent' }]);
  await run();
  assert.equal(postMails().length, 1, 'a second run sends nothing');
});

test('each post email has the unsubscribe headers, a visible /newsletter/#u= link in html and text, Idempotency-Key nl-post-<slug>-<id>, and the email picture', async () => {
  await seeded();
  sendOn();
  const id = addSub('reader@example.com');
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0), { t: 'Fresh & New', e: 'What the reader learns.' })];
  await run();
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.headers['Idempotency-Key'], `nl-post-fresh-post-${id}`);
  assert.equal(m.body.subject, 'New article: Fresh & New');
  assert.deepEqual(m.body.to, ['reader@example.com']);
  const u = tokenFrom(m, 'newsletter/#u=');
  assert.match(u, /^[A-Za-z0-9_-]{32,64}$/);
  assert.ok(m.body.text.includes(`https://mayobebros.com/newsletter/#u=${u}`));
  assert.equal(m.body.headers['List-Unsubscribe'], `<https://worker.test/v1/newsletter/one-click?t=${u}>`);
  assert.equal(m.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(rows('SELECT subscriber_id, kind FROM newsletter_tokens WHERE hash = ?', sha(u))[0].subscriber_id, id);
  assert.ok(m.body.html.includes('src="https://mayobebros.com/assets/email/post-fresh-post.jpg?v=5eed5eed"'));
  assert.equal(m.body.html.includes('.webp'), false, 'never the WebP cover');
  assert.ok(m.body.html.includes('alt="Alt for fresh-post"'));
  assert.ok(m.body.html.includes('https://mayobebros.com/post/educational/fresh-post/'));
  assert.ok(m.body.html.includes('What the reader learns.'));
});

// every "Unsubscribe" link in the footer of a real newsletter email is the reader's own page link (never the /contact/ the template falls back to),
// it is the same one the header and the plain text carry, and using it really unsubscribes that reader
const unsubAnchors = (html) => [...html.matchAll(/<a href="([^"]*)"[^>]*>Unsubscribe<\/a>/g)].map((m) => m[1]);
test('the footer Unsubscribe link in the welcome and in an article email is the real one and it works', async () => {
  const { r } = await confirmed('real-link@example.com');
  assert.equal(r.status, 200);
  const welcome = sent[0];
  const wu = tokenFrom(welcome, 'newsletter/#u=');
  assert.deepEqual(unsubAnchors(welcome.body.html), [`https://mayobebros.com/newsletter/#u=${wu}`], 'welcome: one Unsubscribe link, the real one');
  assert.ok(welcome.body.text.includes(`Unsubscribe: https://mayobebros.com/newsletter/#u=${wu}`));
  assert.equal(welcome.body.headers['List-Unsubscribe'], `<https://worker.test/v1/newsletter/one-click?t=${wu}>`);
  assert.equal(welcome.body.html.includes('/contact/#u='), false);
  // the token in that link unsubscribes this reader, once
  const out = await call('/v1/newsletter/unsubscribe', { body: { token: wu } });
  assert.equal(out.status, 200);
  assert.equal(rows("SELECT status FROM newsletter_subscribers WHERE email = 'real-link@example.com'")[0].status, 'unsubscribed');
});

test('an article email carries the real Unsubscribe link in the footer and the plain text, and its token belongs to that reader', async () => {
  await seeded();
  sendOn();
  const id = addSub('footer-link@example.com');
  searchList = [...OLD_LIST, entry('footer-post', dayOf(0), { t: 'Footer Post', e: 'Short excerpt.' })];
  await run();
  assert.equal(sent.length, 1);
  const m = sent[0];
  const u = tokenFrom(m, 'newsletter/#u=');
  assert.deepEqual(unsubAnchors(m.body.html), [`https://mayobebros.com/newsletter/#u=${u}`]);
  assert.ok(m.body.text.includes(`Unsubscribe: https://mayobebros.com/newsletter/#u=${u}`));
  assert.equal(rows('SELECT subscriber_id FROM newsletter_tokens WHERE hash = ?', sha(u))[0].subscriber_id, id);
});

test('a post dated tomorrow is ignored; an unknown post dated 8 days ago (a renamed slug) is recorded as seeded and never emailed', async () => {
  await seeded();
  sendOn();
  addSub('a@example.com');
  searchList = [...OLD_LIST, entry('tomorrow-post', dayOf(1)), entry('renamed-post', dayOf(-8)), entry('week-post', dayOf(-6))];
  const r = await run();
  assert.deepEqual(r.tooOld, ['renamed-post']);
  assert.equal(rows("SELECT seeded FROM newsletter_sent WHERE slug = 'renamed-post'")[0].seeded, 1);
  assert.equal(rows("SELECT 1 FROM newsletter_sent WHERE slug = 'tomorrow-post'").length, 0);
  assert.deepEqual(postMails().map((m) => m.body.subject), ['New article: Title week-post'], 'only the post from within the last 7 days');
  await run();
  assert.equal(postMails().length, 1);
});

test('40 subscribers: today sends what is left of the 25 article units (35 minus a reserve of 10) and stops with budget; the next UTC day sends the rest exactly once', async () => {
  await seeded();
  sendOn();
  env.MAIL_TEST_DAY = '2030-01-01';
  for (let i = 1; i <= 40; i++) addSub(`s${i}@example.com`);
  for (let i = 0; i < 3; i++) assert.equal(await takeBudget(env, 'news'), true);
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  const r1 = await runAll();
  assert.equal(r1.stopped, 'budget');
  assert.equal(postMails().length, 22);
  assert.equal(rows("SELECT sent_at FROM newsletter_sent WHERE slug = 'fresh-post'")[0].sent_at, null, 'not finished yet');
  assert.equal(rows("SELECT 1 FROM newsletter_deliveries WHERE status = 'claimed'").length, 0, 'the claim of the refused send was released');
  const again = await run(); // the same day: nothing left in the slice
  assert.equal(again.stopped, 'budget');
  assert.equal(postMails().length, 22);
  env.MAIL_TEST_DAY = '2030-01-02';
  const r2 = await runAll();
  assert.equal(r2.stopped, null);
  assert.equal(postMails().length, 40);
  assert.equal(rows("SELECT n FROM mail_budget WHERE day = '2030-01-02' AND kind = 'news'")[0].n, 18);
  assert.equal(new Set(postMails().map(to)).size, 40, 'each subscriber once');
  assert.ok(rows("SELECT sent_at FROM newsletter_sent WHERE slug = 'fresh-post'")[0].sent_at > 0);
});

test('two runs started together send each (post, subscriber) once', async () => {
  await seeded();
  sendOn();
  for (let i = 1; i <= 12; i++) addSub(`t${i}@example.com`);
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0)), entry('other-post', dayOf(-1))];
  await Promise.all([runAll(), runAll(), runAll()]);
  assert.equal(postMails().length, 24);
  assert.equal(new Set(postMails().map((m) => m.headers['Idempotency-Key'])).size, 24);
  assert.equal(rows("SELECT COUNT(*) AS n FROM newsletter_deliveries WHERE status = 'sent'")[0].n, 24);
});

test('a left-over claimed row (crash after send) is not resent; 429 releases the claim and stops; 500 and a thrown fetch mark failed and are not retried', async () => {
  await seeded();
  sendOn();
  const ids = [1, 2, 3, 4].map((i) => addSub(`c${i}@example.com`));
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  // a run that crashed after Resend took the message for c1: the post is queued and c1's claim is left behind
  env.DB.raw.prepare("INSERT INTO newsletter_sent(slug, title, queued_at, sent_at, seeded) VALUES('fresh-post', 'x', ?, NULL, 0)").run(Date.now());
  env.DB.raw.prepare("INSERT INTO newsletter_deliveries(slug, subscriber_id, status, at) VALUES('fresh-post', ?, 'claimed', 1)").run(ids[0]);
  resendFn = () => new Response('{"message":"slow down"}', { status: 429 });
  const r1 = await run();
  assert.equal(r1.stopped, 'rate');
  assert.deepEqual(sent.map(to), ['c2@example.com']);
  assert.equal(rows('SELECT 1 FROM newsletter_deliveries WHERE subscriber_id = ?', ids[1]).length, 0, '429 released the claim');
  sent = [];
  resendFn = (n) => { if (n === 1) return new Response('{}', { status: 500 }); if (n === 2) throw new Error('timeout'); return new Response('{"id":"m"}', { status: 200 }); };
  const r2 = await run();
  assert.equal(r2.stopped, null);
  assert.deepEqual(sent.map(to), ['c2@example.com', 'c3@example.com', 'c4@example.com']);
  assert.deepEqual(r2.posts, [{ slug: 'fresh-post', recipients: 3, sent: 1, skipped: 0, failed: 2 }]);
  const st = Object.fromEntries(rows('SELECT subscriber_id, status FROM newsletter_deliveries').map((x) => [x.subscriber_id, x.status]));
  assert.deepEqual(st, { [ids[0]]: 'claimed', [ids[1]]: 'failed', [ids[2]]: 'failed', [ids[3]]: 'sent' });
  sent = [];
  await run();
  assert.equal(sent.length, 0, 'failed sends are never retried and c1 is never resent');
});

test('a suppressed subscriber is marked skipped and not tried again', async () => {
  await seeded();
  sendOn();
  const id = addSub('blocked@example.com');
  addSub('ok@example.com');
  env.DB.raw.exec("INSERT INTO suppressed(email, reason, created) VALUES('blocked@example.com', 'bounce', 1)");
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  const r = await run();
  assert.deepEqual(postMails().map(to), ['ok@example.com']);
  assert.equal(r.posts[0].skipped, 1);
  assert.equal(rows('SELECT status FROM newsletter_deliveries WHERE subscriber_id = ?', id)[0].status, 'skipped');
  await run();
  assert.equal(sent.length, 1);
});

test('a subscriber unsubscribed between pages gets nothing', async () => {
  await seeded();
  sendOn();
  const ids = [];
  for (let i = 1; i <= 15; i++) ids.push(addSub(`u${i}@example.com`));
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  sleepHook = (n) => {
    if (n === 2) env.DB.raw.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed = ? WHERE id = ?").run(Date.now(), ids[4]); // same page, not yet sent
    if (n === 7) env.DB.raw.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed = ? WHERE id = ?").run(Date.now(), ids[12]); // on the second page, read after this
  };
  await runAll();
  const got = postMails().map(to);
  assert.equal(got.length, 13);
  assert.equal(got.includes('u5@example.com'), false);
  assert.equal(got.includes('u13@example.com'), false);
  assert.equal(rows('SELECT 1 FROM newsletter_deliveries WHERE subscriber_id IN (?, ?)', ids[4], ids[12]).length, 0);
});

test('NEWSLETTER_SEND missing or "false": no post emails and no queued rows; API_ORIGIN missing or http://example.com: no sends, stopped no-api-origin', async () => {
  await seeded();
  addSub('a@example.com');
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  for (const flag of [undefined, 'false', 'TRUE', '1']) {
    env.NEWSLETTER_SEND = flag;
    const r = await run();
    assert.equal(r.paused, true, String(flag));
    assert.equal(sent.length, 0);
    assert.equal(rows("SELECT 1 FROM newsletter_sent WHERE slug = 'fresh-post'").length, 0);
  }
  env.NEWSLETTER_SEND = 'true';
  for (const api of [undefined, '', 'http://example.com', 'https://', 'ftp://x.test']) {
    env.API_ORIGIN = api;
    const r = await run();
    assert.equal(r.paused, false);
    assert.equal(r.stopped, 'no-api-origin', String(api));
    assert.equal(sent.length, 0);
    assert.equal(rows("SELECT 1 FROM newsletter_sent WHERE slug = 'fresh-post'").length, 0);
  }
  env.API_ORIGIN = 'https://worker.test';
  const r = await run({ mode: 'seed' });
  assert.equal(sent.length, 0, 'seed mode never sends');
  assert.equal(r.stopped, null);
  await run();
  assert.equal(postMails().length, 0, 'seed recorded the recent post as handled');
});

test('sleep(200) is awaited between sends and a run makes at most 25 Resend calls (the article share of the news slice)', async () => {
  await seeded();
  sendOn();
  for (let i = 1; i <= 50; i++) addSub(`z${i}@example.com`);
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  let inSleep = false;
  let overlap = 0;
  sleepHook = async () => { inSleep = true; await new Promise((r) => setTimeout(r, 3)); inSleep = false; };
  resendFn = () => { if (inSleep) overlap++; return new Response('{}', { status: 500 }); }; // 500 gives the budget unit back, so only the call cap stops it
  const r = await run({ subrequestLimit: 10000 }); // lift the platform ceiling to reach the per-run call cap
  assert.equal(sent.length, 25);
  assert.equal(r.stopped, 'budget');
  assert.equal(overlap, 0, 'no send while a sleep is still running');
  assert.deepEqual(sleeps, Array(24).fill(200));
});

test('clean-up removes old pending, expired confirm tokens and month-old unsubscribed rows with their tokens and deliveries', async () => {
  await seeded();
  const D = 86400000;
  const t = Date.now();
  const tok = (sid, kind, expires) => env.DB.raw.prepare('INSERT INTO newsletter_tokens(hash, subscriber_id, kind, expires, created) VALUES(?, ?, ?, ?, ?)').run(`h${Math.random()}`, sid, kind, expires, t - 8 * D);
  const del = (slug, sid) => env.DB.raw.prepare("INSERT INTO newsletter_deliveries(slug, subscriber_id, status, at) VALUES(?, ?, 'sent', 1)").run(slug, sid);
  const oldPending = addSub('oldpending@example.com', { status: 'pending', created: t - 8 * D });
  tok(oldPending, 'confirm', t - D);
  const revived = addSub('revived@example.com', { status: 'pending', created: t - 60 * D }); // signed up again today: a live confirm token
  tok(revived, 'confirm', t + 6 * D);
  const newPending = addSub('newpending@example.com', { status: 'pending', created: t - D });
  tok(newPending, 'confirm', t - 1000); // expired token on a recent row: only the token goes
  const oldGone = addSub('oldgone@example.com', { status: 'unsubscribed', unsubscribed: t - 31 * D });
  tok(oldGone, 'unsub', null);
  del('first-post', oldGone);
  const recentGone = addSub('recentgone@example.com', { status: 'unsubscribed', unsubscribed: t - 10 * D });
  tok(recentGone, 'unsub', null);
  const keeper = addSub('keeper@example.com');
  tok(keeper, 'unsub', null);
  env.DB.raw.prepare("INSERT INTO newsletter_sent(slug, title, queued_at, sent_at, seeded) VALUES('done-long-ago', 'x', ?, ?, 0), ('done-lately', 'y', ?, ?, 0)").run(t - 40 * D, t - 31 * D, t - 6 * D, t - 5 * D);
  del('done-long-ago', keeper);
  del('done-lately', keeper);
  const r = await run(); // paused: clean-up still runs
  assert.equal(r.paused, true);
  const left = rows('SELECT email FROM newsletter_subscribers ORDER BY id').map((x) => x.email);
  assert.deepEqual(left, ['revived@example.com', 'newpending@example.com', 'recentgone@example.com', 'keeper@example.com']);
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE subscriber_id IN (?, ?, ?)', oldPending, newPending, oldGone).length, 0);
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE subscriber_id IN (?, ?, ?)', revived, recentGone, keeper).length, 3);
  assert.deepEqual(rows('SELECT slug FROM newsletter_deliveries').map((x) => x.slug), ['done-lately']);
  // rows: 2 subscribers, 3 tokens (old pending, new pending, old unsubscribed), 2 deliveries
  assert.equal(r.purged, 7);
  assert.equal(rows("SELECT 1 FROM newsletter_sent WHERE slug = 'done-long-ago'").length, 1, 'the per-post record stays, so it is never sent again');
});

test('scheduled() hands the run to ctx.waitUntil and does not throw when D1 throws', async () => {
  const handed = [];
  const broken = { ...env, NEWSLETTER_SEND: 'true', DB: { prepare() { throw new Error('D1 down'); }, batch() { throw new Error('D1 down'); } } };
  const origErr = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => worker.scheduled({ cron: '0 4 * * *', scheduledTime: Date.now() }, broken, { waitUntil: (p) => handed.push(p) }));
    assert.equal(handed.length, 1);
    const r = await handed[0];
    assert.equal(typeof r, 'object');
    assert.equal(sent.length, 0);
  } finally { console.error = origErr; }
});

test('mode dry writes nothing and calls Resend never, but reports what it would seed or send', async () => {
  sendOn();
  addSub('a@example.com');
  addSub('b@example.com');
  searchList = OLD_LIST;
  const tables = ['newsletter_subscribers', 'newsletter_tokens', 'newsletter_sent', 'newsletter_deliveries'];
  const snap = () => tables.map(count).join(',') + `|${count('mail_budget')}`;
  let before = snap();
  const first = await run({ mode: 'dry' });
  assert.deepEqual([...first.seeded].sort(), ['first-post', 'second-post']);
  assert.equal(snap(), before);
  await run(); // the real seed
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0)), entry('renamed-post', dayOf(-9))];
  addSub('old@example.com', { status: 'pending', created: Date.now() - 30 * 86400000 }); // clean-up would remove it
  before = snap();
  const r = await run({ mode: 'dry' });
  assert.equal(snap(), before);
  assert.equal(sent.length, 0);
  assert.deepEqual(r.tooOld, ['renamed-post']);
  assert.deepEqual(r.posts, [{ slug: 'fresh-post', recipients: 2, sent: 0, skipped: 0, failed: 0 }]);
  assert.deepEqual(sleeps, []);
});

// ---- Task 3 fix round 1: the Free plan's 50 subrequests per invocation ----
// env.DB wrapper that counts D1 calls (each first/all/run, each batch) plus every fetch, and throws like D1 does past `limit`.
function limitedDB(limit, { failAt = null } = {}) {
  const base = env.DB;
  const c = { n: 0, over: false, d1: 0 };
  const tick = () => {
    c.n++; c.d1++;
    if (failAt !== null && c.d1 === failAt) throw new Error('D1_ERROR: injected');
    if (c.n > limit) { c.over = true; throw new Error('Too many API requests by single worker invocation.'); }
  };
  const wrap = (st) => ({ inner: st, bind: (...a) => wrap(st.bind(...a)), first: (...a) => { tick(); return st.first(...a); }, all: (...a) => { tick(); return st.all(...a); }, run: (...a) => { tick(); return st.run(...a); } });
  onFetch = () => { c.n++; if (c.n > limit) { c.over = true; throw new Error('Too many subrequests.'); } };
  return { db: { prepare: (sql) => wrap(base.prepare(sql)), batch: (l) => { tick(); return base.batch(l.map((x) => x.inner || x)); }, raw: base.raw }, c, base };
}
// every row still 'claimed' must belong to a mail Resend was actually given (a crash after the send), never to an unsent one
function noUnsentClaims() {
  const keys = new Set(sent.map((m) => m.headers['Idempotency-Key']));
  for (const r of rows("SELECT slug, subscriber_id FROM newsletter_deliveries WHERE status = 'claimed'")) assert.ok(keys.has(`nl-post-${r.slug}-${r.subscriber_id}`), `claimed but unsent: ${r.slug} ${r.subscriber_id}`);
}

test('under a D1 + fetch wrapper that throws past 50 calls, each run stops cleanly with subrequests, leaves no unsent claim, and later runs finish everyone once', async () => {
  await seeded();
  sendOn();
  for (let i = 1; i <= 30; i++) addSub(`w${i}@example.com`);
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0)), entry('other-post', dayOf(-1))];
  let r;
  let runs = 0;
  do {
    const { db, c, base } = limitedDB(50);
    env.DB = db;
    r = await run();
    env.DB = base; onFetch = null;
    runs++;
    assert.equal(c.over, false, `run ${runs} went over 50 (${c.n})`);
    assert.ok(c.n <= 45, `run ${runs} used ${c.n}`);
    noUnsentClaims();
    assert.ok(r.stopped === 'subrequests' || r.stopped === 'budget' || r.stopped === null, String(r.stopped));
    if (r.stopped === 'subrequests') assert.ok(r.posts.reduce((n, p) => n + p.sent, 0) >= 9, `a full run sends at least 9 (run ${runs}: ${JSON.stringify(r.posts)})`);
  } while (r.stopped === 'subrequests' && runs < 20);
  assert.equal(r.stopped, 'budget', 'the 25 article units end the day');
  assert.ok(runs >= 3 && runs <= 6, `25 sends took ${runs} runs (the cron fires 6 times)`);
  assert.equal(postMails().length, 25);
  assert.equal(new Set(postMails().map((m) => m.headers['Idempotency-Key'])).size, 25, 'nobody gets the same post twice');
  env.MAIL_TEST_DAY = dayOf(1);
  await runAll();
  assert.equal(postMails().length, 50);
  env.MAIL_TEST_DAY = dayOf(2);
  await runAll();
  assert.equal(postMails().length, 60);
  assert.equal(new Set(postMails().map((m) => m.headers['Idempotency-Key'])).size, 60);
  assert.equal(rows("SELECT 1 FROM newsletter_sent WHERE sent_at IS NULL").length, 0);
});

test('a D1 error at any point of a run leaves no claimed-but-unsent row, clean-up still runs, and the next run sends each subscriber once', async () => {
  const origErr = console.error;
  for (let k = 1; k <= 22; k++) {
    env = { DB: makeD1(), SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key', API_ORIGIN: 'https://worker.test' };
    sent = [];
    await seeded();
    sendOn();
    for (let i = 1; i <= 4; i++) addSub(`k${i}@example.com`);
    addSub('stale@example.com', { status: 'pending', created: Date.now() - 9 * 86400000 });
    searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
    const { db, base } = limitedDB(1000, { failAt: k });
    env.DB = db;
    console.error = () => {};
    let r;
    try { r = await run(); } finally { console.error = origErr; env.DB = base; onFetch = null; }
    assert.equal(typeof r, 'object', `k=${k}`);
    noUnsentClaims();
    if (k > 1) assert.equal(rows("SELECT 1 FROM newsletter_subscribers WHERE email = 'stale@example.com'").length, 0, `clean-up ran (k=${k})`);
    await runAll();
    noUnsentClaims();
    const got = postMails().map(to).sort();
    assert.equal(new Set(got).size, got.length, `nobody twice (k=${k})`);
    // a mail whose 'sent' mark failed stays claimed (sent once, never again); everyone else got exactly one
    assert.deepEqual(got, ['k1@example.com', 'k2@example.com', 'k3@example.com', 'k4@example.com'], `k=${k}`);
  }
});

test('a D1 error inside sendMail is reported as a local error, logged as such, and the claim is released', async () => {
  await seeded();
  sendOn();
  addSub('a@example.com');
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  const base = env.DB;
  env.DB = { prepare: (sql) => (sql.includes('mail_budget') ? { bind: () => ({ first: async () => { throw new Error('D1_ERROR: budget table'); } }) } : base.prepare(sql)), batch: (l) => base.batch(l), raw: base.raw };
  const logs = [];
  const origErr = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  let r;
  try { r = await run(); } finally { console.error = origErr; env.DB = base; }
  assert.equal(r.stopped, 'error');
  assert.equal(sent.length, 0);
  assert.equal(rows('SELECT 1 FROM newsletter_deliveries').length, 0, 'the claim was released');
  assert.ok(logs.some((l) => l.includes('local error before sending') && l.includes('budget table')), logs.join('\n'));
  await run();
  assert.equal(postMails().length, 1);
});

test('a queued post that leaves the list is not sent; after 7 days it is closed, and when it reappears nothing is sent', async () => {
  await seeded();
  sendOn();
  addSub('a@example.com', { confirmed: Date.now() - 3 * 86400000 });
  const D = 86400000;
  // queued two hours ago, nothing sent yet (as if the budget ran out), then unpublished
  env.DB.raw.prepare("INSERT INTO newsletter_sent(slug, title, queued_at, sent_at, seeded) VALUES('gone-post', 'x', ?, NULL, 0)").run(Date.now() - 2 * 3600000);
  searchList = OLD_LIST;
  await run({ now: Date.now() + 6 * D });
  assert.equal(sent.length, 0);
  assert.equal(rows("SELECT sent_at FROM newsletter_sent WHERE slug = 'gone-post'")[0].sent_at, null, 'still open at +6 days');
  await run({ now: Date.now() + 8 * D });
  assert.ok(rows("SELECT sent_at FROM newsletter_sent WHERE slug = 'gone-post'")[0].sent_at > 0, 'closed at +8 days');
  searchList = [...OLD_LIST, entry('gone-post', dayOf(0))];
  const r = await run();
  assert.equal(sent.length, 0, 'reappearing sends nothing');
  assert.deepEqual(r.posts, []);
});

test('sendMail with suppressionChecked skips its own suppressed query (the caller checked it in the claim)', async () => {
  let suppressedQueries = 0;
  const base = env.DB;
  const db = { prepare: (sql) => { if (sql.includes('FROM suppressed')) suppressedQueries++; return base.prepare(sql); } };
  const { sendMail } = await import('../../worker/src/mail.js');
  const r = await sendMail({ ...env, DB: db }, null, { kind: 'news', to: 'x@example.com', subject: 's', html: 'h', text: 't', key: 'k1', suppressionChecked: true });
  assert.equal(r.ok, true);
  assert.equal(suppressedQueries, 0);
  await sendMail({ ...env, DB: db }, null, { kind: 'news', to: 'x@example.com', subject: 's', html: 'h', text: 't', key: 'k2' });
  assert.equal(suppressedQueries, 1);
});

test('a low ceiling is honoured inside a page too: every run stays under it and the rest go out in later runs', async () => {
  await seeded();
  sendOn();
  for (let i = 1; i <= 12; i++) addSub(`l${i}@example.com`);
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  for (let runs = 0; runs < 20; runs++) {
    const { db, c, base } = limitedDB(20);
    env.DB = db;
    const r = await run({ subrequestLimit: 20 });
    env.DB = base; onFetch = null;
    assert.equal(c.over, false, `went over 20 (${c.n})`);
    noUnsentClaims();
    if (r.stopped !== 'subrequests') break;
  }
  assert.equal(postMails().length, 12);
  assert.equal(new Set(postMails().map(to)).size, 12);
});

test('an address suppressed after the page was read is not claimed or sent', async () => {
  await seeded();
  sendOn();
  addSub('first@example.com');
  const id = addSub('bounced-now@example.com');
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  sleepHook = () => { env.DB.raw.exec("INSERT OR IGNORE INTO suppressed(email, reason, created) VALUES('bounced-now@example.com', 'bounce', 1)"); };
  await run();
  assert.deepEqual(postMails().map(to), ['first@example.com']);
  assert.equal(rows('SELECT 1 FROM newsletter_deliveries WHERE subscriber_id = ?', id).length, 0);
  await run();
  assert.equal(postMails().length, 1, 'never sent later either');
});

// ---- Task 4: owner tools ----
const ADMIN = 'admin-token-for-tests-1234';
async function admin(path, { method = 'GET', body, token = ADMIN } = {}) {
  env.ADMIN_TOKEN = ADMIN;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: (p) => { pendingMail.push(p); } });
  const text = await res.text();
  await flushMail();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('admin newsletter routes are 401 without the token', async () => {
  addSub('victim@example.com');
  const snap = () => JSON.stringify(['newsletter_sent', 'newsletter_subscribers', 'newsletter_tokens'].map((t) => rows(`SELECT * FROM ${t}`)));
  const before = snap();
  searchList = OLD_LIST;
  for (const [m, p] of [['GET', '/v1/admin/newsletter'], ['GET', '/v1/admin/newsletter/count'], ['POST', '/v1/admin/newsletter/remove'], ['POST', '/v1/admin/newsletter/run']]) {
    assert.equal((await admin(p, { method: m, body: m === 'POST' ? { email: 'a@b.co', mode: 'seed' } : undefined, token: null })).status, 401, p);
    assert.equal((await admin(p, { method: m, body: m === 'POST' ? { email: 'victim@example.com', mode: 'seed' } : undefined, token: 'wrong-token-wrong-token' })).status, 401, p);
  }
  assert.equal(snap(), before, 'rejected remove and run changed nothing');
});

test('list never contains hash or token fields and filters by status', async () => {
  addSub('a@example.com'); addSub('b@example.com', { status: 'pending' }); addSub('c@example.com', { status: 'unsubscribed', unsubscribed: Date.now() });
  const firstId = rows('SELECT id FROM newsletter_subscribers ORDER BY id LIMIT 1')[0].id;
  await unsubscribeKit(env, firstId);
  const all = await admin('/v1/admin/newsletter?status=all');
  assert.equal(all.json.subscribers.length, 3);
  for (const s of all.json.subscribers) assert.deepEqual(Object.keys(s).sort(), ['confirmed', 'created', 'email', 'id', 'status', 'unsubscribed']);
  assert.ok(!/hash|token|email_key/i.test(JSON.stringify(all.json)));
  assert.deepEqual((await admin('/v1/admin/newsletter?status=pending')).json.subscribers.map((s) => s.email), ['b@example.com']);
  assert.deepEqual((await admin('/v1/admin/newsletter?status=active&limit=1')).json.subscribers.map((s) => s.email), ['a@example.com']);
});

test('list takes an offset so every row can be reached', async () => {
  for (let i = 0; i < 5; i++) addSub(`o${i}@example.com`);
  const a = (await admin('/v1/admin/newsletter?status=all&limit=2')).json.subscribers;
  const b = (await admin('/v1/admin/newsletter?status=all&limit=2&offset=2')).json.subscribers;
  const c = (await admin('/v1/admin/newsletter?status=all&limit=2&offset=4')).json.subscribers;
  assert.deepEqual([a.length, b.length, c.length], [2, 2, 1]);
  assert.equal(new Set([...a, ...b, ...c].map((x) => x.id)).size, 5);
});

test('remove by a different spelling of the address deletes the row, its tokens and its deliveries', async () => {
  const id = addSub('jo.hn@gmail.com');
  const other = addSub('keep@example.com');
  await unsubscribeKit(env, id); await unsubscribeKit(env, other);
  env.DB.raw.exec(`INSERT INTO newsletter_deliveries(slug, subscriber_id, status, at) VALUES('x', ${id}, 'sent', 1), ('x', ${other}, 'sent', 1)`);
  env.DB.raw.prepare('UPDATE newsletter_subscribers SET email_key = ? WHERE id = ?').run(canonicalEmail('jo.hn@gmail.com'), id);
  const r = await admin('/v1/admin/newsletter/remove', { method: 'POST', body: { email: ' John+news@GMAIL.com ' } });
  assert.deepEqual(r.json, { removed: 1 });
  assert.equal(rows('SELECT 1 FROM newsletter_subscribers WHERE id = ?', id).length, 0);
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE subscriber_id = ?', id).length, 0);
  assert.equal(rows('SELECT 1 FROM newsletter_deliveries WHERE subscriber_id = ?', id).length, 0);
  assert.equal(rows('SELECT 1 FROM newsletter_tokens WHERE subscriber_id = ?', other).length, 1, 'others untouched');
  assert.equal(rows('SELECT 1 FROM newsletter_deliveries WHERE subscriber_id = ?', other).length, 1);
  assert.deepEqual((await admin('/v1/admin/newsletter/remove', { method: 'POST', body: { email: 'John@gmail.com' } })).json, { removed: 0 });
  assert.equal((await admin('/v1/admin/newsletter/remove', { method: 'POST', body: { email: 'nope' } })).status, 400);
});

test("count reports the queue and today's news units", async () => {
  await seeded();
  sendOn();
  for (let i = 1; i <= 3; i++) addSub(`q${i}@example.com`);
  addSub('p@example.com', { status: 'pending' });
  let c = (await admin('/v1/admin/newsletter/count')).json;
  assert.deepEqual({ pending: c.pending, active: c.active, unsubscribed: c.unsubscribed, newsToday: c.newsToday, newsCap: c.newsCap, articleCap: c.articleCap, paused: c.paused, queue: c.queue }, { pending: 1, active: 3, unsubscribed: 0, newsToday: 0, newsCap: 35, articleCap: 25, paused: false, queue: [] });
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  await run({ subrequestLimit: 14 }); // a short run: at least one sent, not all
  c = (await admin('/v1/admin/newsletter/count')).json;
  const n = postMails().length;
  assert.ok(n >= 1 && n < 3, `sent ${n}`);
  assert.equal(c.newsToday, n);
  assert.deepEqual(c.queue, [{ slug: 'fresh-post', sent: n, left: 3 - n }]);
  addSub('late@example.com', { confirmed: Date.now() + 3600000 }); // joined after the article was queued: the run never mails them
  c = (await admin('/v1/admin/newsletter/count')).json;
  assert.deepEqual(c.queue, [{ slug: 'fresh-post', sent: n, left: 3 - n }], 'a later subscriber is not counted as still to send');
  env.NEWSLETTER_SEND = 'false';
  assert.equal((await admin('/v1/admin/newsletter/count')).json.paused, true);
});

test('run dry changes no row and calls Resend never; run seed on an empty table seeds', async () => {
  searchList = OLD_LIST;
  addSub('a@example.com');
  const snap = () => JSON.stringify(['newsletter_sent', 'newsletter_deliveries', 'newsletter_subscribers', 'newsletter_tokens', 'mail_budget'].map((t) => rows(`SELECT * FROM ${t}`)));
  const before = snap();
  const d = await admin('/v1/admin/newsletter/run', { method: 'POST', body: { mode: 'dry' } });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.seeded, ['first-post', 'second-post']);
  assert.equal(snap(), before);
  assert.equal(sent.length, 0);
  const s = await admin('/v1/admin/newsletter/run', { method: 'POST', body: { mode: 'seed' } });
  assert.deepEqual(s.json.seeded, ['first-post', 'second-post']);
  assert.equal(count('newsletter_sent'), 2);
  assert.equal(sent.length, 0);
  assert.equal((await admin('/v1/admin/newsletter/run', { method: 'POST', body: { mode: 'send' } })).status, 400);
});

// ---- final review fixes ----
test('article sends leave 10 news units for confirmations, welcomes and goodbyes; a confirmation can still use the full slice', async () => {
  await seeded();
  sendOn();
  env.MAIL_TEST_DAY = '2030-02-01';
  for (let i = 1; i <= 30; i++) addSub(`r${i}@example.com`);
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0))];
  const r = await runAll();
  assert.equal(r.stopped, 'budget');
  assert.equal(postMails().length, 25);
  assert.equal(rows("SELECT n FROM mail_budget WHERE day = '2030-02-01' AND kind = 'news'")[0].n, 25);
  for (let i = 0; i < 9; i++) assert.equal(await takeBudget(env, 'news'), true, `reserve unit ${i + 1}`);
  sent = [];
  await sub('late-signup@example.com', {}, { ip: '9.9.9.9' }); // the 35th unit
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.subject, 'Please confirm your Mayobe Bros subscription');
  assert.equal(await takeBudget(env, 'news'), false, 'the slice is full at 35');
});

test('seed records every listed post not yet recorded, also those from the last 7 days and while paused', async () => {
  await seeded();
  addSub('a@example.com');
  env.NEWSLETTER_SEND = 'false';
  searchList = [...OLD_LIST, entry('yesterday-post', dayOf(-1)), entry('today-post', dayOf(0)), entry('old-renamed', dayOf(-20)), entry('tomorrow-post', dayOf(1))];
  const r = await run({ mode: 'seed' });
  assert.deepEqual([...r.seeded].sort(), ['today-post', 'yesterday-post']);
  assert.deepEqual(r.tooOld, ['old-renamed']);
  const got = Object.fromEntries(rows('SELECT slug, seeded, sent_at FROM newsletter_sent').map((x) => [x.slug, x.seeded === 1 && x.sent_at > 0]));
  assert.deepEqual(got, { 'first-post': true, 'second-post': true, 'yesterday-post': true, 'today-post': true, 'old-renamed': true });
  sendOn();
  const after = await run();
  assert.equal(sent.length, 0, 'switching sending on after seed sends no earlier article');
  assert.deepEqual(after.posts, []);
});

test('dry run checks the subrequest ceiling before each count', async () => {
  await seeded();
  sendOn();
  addSub('a@example.com');
  searchList = [...OLD_LIST, entry('p-one', dayOf(0)), entry('p-two', dayOf(-1)), entry('p-three', dayOf(-2))];
  const r = await run({ mode: 'dry', subrequestLimit: 4 }); // list fetch + state read + 2 counts
  assert.equal(r.stopped, 'subrequests');
  assert.equal(r.posts.length, 2);
});

/* ------------------------------------------------------------------ article pictures (email redesign, Task 3) */
const imgSrcs = (html) => [...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)].map((x) => x[1].replace(/&amp;/g, '&'));
const imgAlts = (html) => [...html.matchAll(/<img\b[^>]*\salt="([^"]*)"/g)].map((x) => x[1]);
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const LOGO_SRC = 'https://mayobebros.com/assets/email/logo.png';

test('new-post email shows the assets/email picture with the post alt text, never the share card', async () => {
  await seeded();
  sendOn();
  addSub('reader@example.com');
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0), { m: '0a1b2c3d', a: 'A "desk" & <laptop>' })];
  await run();
  const m = postMails()[0].body;
  assert.deepEqual(imgSrcs(m.html), [LOGO_SRC, 'https://mayobebros.com/assets/email/post-fresh-post.jpg?v=0a1b2c3d']);
  assert.equal(imgAlts(m.html)[1], 'A &quot;desk&quot; &amp; &lt;laptop&gt;');
  assert.equal(m.html.includes('/assets/share/'), false);
  assert.equal(m.text.includes('/assets/share/'), false);
  // the picture links to the article
  assert.match(m.html, /<a\b[^>]*href="https:\/\/mayobebros\.com\/post\/educational\/fresh-post\/"[^>]*>\s*<img\b[^>]*post-fresh-post\.jpg/);
});

test('a video post (w) gets the video picture linked to #video-1; no a gives the title as alt', async () => {
  await seeded();
  sendOn();
  addSub('reader@example.com');
  searchList = [...OLD_LIST, entry('video-post', dayOf(0), { m: '0a1b2c3d', w: 'abcdef01', a: undefined, t: 'Video & Talk' })];
  await run();
  const m = postMails()[0].body;
  assert.deepEqual(imgSrcs(m.html), [LOGO_SRC, 'https://mayobebros.com/assets/email/video-video-post.jpg?v=abcdef01']);
  assert.equal(imgAlts(m.html)[1], 'Watch the video: Video &amp; Talk');
  assert.match(m.html, /<a\b[^>]*href="https:\/\/mayobebros\.com\/post\/educational\/video-post\/#video-1"[^>]*>\s*<img\b/);
  assert.ok(m.text.includes('Watch the video: https://mayobebros.com/post/educational/video-post/#video-1'));
  // without a, the post picture's alt is the title
  sent = [];
  searchList = [...OLD_LIST, entry('plain-post', dayOf(0), { a: undefined, t: 'Plain & Simple' })];
  await run();
  assert.equal(imgAlts(postMails()[0].body.html)[1], 'Plain &amp; Simple');
});

test('malformed m or w (a path, upper case, 9 characters, a number) gives no picture; a hostile a is escaped and cut to 150 characters', async () => {
  await seeded();
  sendOn();
  addSub('reader@example.com');
  const bad = ['../../x', '0A1B2C3D', '0a1b2c3d9', 12345678, '/assets/share/post-x.jpg', '0a1b2c3', '', null, { v: '0a1b2c3d' }];
  searchList = [...OLD_LIST, ...bad.map((v, i) => entry(`bad-${i}`, dayOf(0), { m: v, w: v }))];
  await runAll();
  assert.equal(postMails().length, bad.length);
  for (const x of postMails()) assert.deepEqual(imgSrcs(x.body.html), [LOGO_SRC], x.body.subject);
  // hostile alt text
  sent = [];
  const hostile = '<img src=x onerror=alert(1)> "q" \r\n‮' + 'long '.repeat(80);
  searchList = [...OLD_LIST, entry('alt-post', dayOf(0), { a: hostile })];
  await run();
  const h = postMails()[0].body.html;
  assert.equal(imgSrcs(h).length, 2);
  const alt = imgAlts(h)[1];
  assert.ok(!/[<>"\r\n‮]/.test(alt), alt.slice(0, 60));
  assert.ok(unesc(alt).length <= 150, String(unesc(alt).length));
  assert.ok(unesc(alt).startsWith('<img src=x onerror=alert(1)> "q"'));
  assert.equal(h.includes('<img src=x'), false);
  // an a that is not a string is ignored (the title is used)
  sent = [];
  searchList = [...OLD_LIST, entry('alt-obj', dayOf(0), { a: { toString: () => 'EVIL' } })];
  await run();
  assert.equal(imgAlts(postMails()[0].body.html)[1], 'Title alt-obj');
});

test('welcome uses lead picture and thumbnails from search.json, newest first', async () => {
  await confirmed();
  const m = sent[0].body;
  // new-one (2026-10-30) leads with its large picture; mid-one (a video post) and older-one follow as thumbnails
  assert.deepEqual(imgSrcs(m.html), [LOGO_SRC, 'https://mayobebros.com/assets/email/post-new-one.jpg?v=0b0b0b0b',
    'https://mayobebros.com/assets/email/thumb-mid-one.jpg?v=0c0c0c0c', 'https://mayobebros.com/assets/email/thumb-older-one.jpg?v=0d0d0d0d']);
  assert.deepEqual(imgAlts(m.html).slice(1), ['Alt new', 'Mid One', 'Older One'], 'the lead keeps the cover alt; thumbnails are named by their title');
  assert.match(m.html, /JOBS AND INTERNSHIPS · VIDEO/);
  assert.ok(m.text.includes('Watch the video: https://mayobebros.com/post/mid-one/#video-1'));
  assert.equal(m.html.includes('old-one.jpg'), false);
  assert.equal(m.html.includes('/assets/share/'), false);
});

test('picture addresses are identical for two subscribers and contain no token', async () => {
  await seeded();
  sendOn();
  addSub('one@example.com');
  addSub('two@example.com');
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0), { w: 'abcdef01' })];
  await run();
  const [a, b] = postMails().map((x) => x.body);
  assert.ok(a && b);
  assert.deepEqual(imgSrcs(a.html), imgSrcs(b.html));
  for (const x of [a, b]) {
    const tok = tokenFrom({ body: x }, 'newsletter/#u=');
    for (const src of imgSrcs(x.html)) {
      assert.ok(!src.includes(tok) && !/one@|two@|example\.com/.test(src), src);
      assert.match(src, /^https:\/\/mayobebros\.com\/assets\/email\/[a-z0-9-]+\.(jpg|png)(\?v=[0-9a-f]{8})?$/);
    }
  }
});

test('with SITE_ORIGIN http://127.0.0.1:8000, links use it and pictures stay on https://mayobebros.com', async () => {
  env.SITE_ORIGIN = 'http://127.0.0.1:8000';
  await seeded();
  sendOn();
  addSub('reader@example.com');
  searchList = [...OLD_LIST, entry('fresh-post', dayOf(0), { w: 'abcdef01' })];
  await run();
  const m = postMails()[0].body;
  for (const src of imgSrcs(m.html)) assert.ok(src.startsWith('https://mayobebros.com/assets/email/'), src);
  assert.ok(m.html.includes('href="http://127.0.0.1:8000/post/educational/fresh-post/"'));
  assert.ok(m.html.includes('href="http://127.0.0.1:8000/post/educational/fresh-post/#video-1"'));
  assert.ok(m.text.includes('http://127.0.0.1:8000/newsletter/#u='));
  // the welcome too
  sent = [];
  searchList = FIXTURE;
  await confirmed('local@example.com');
  const w = sent[0].body;
  for (const src of imgSrcs(w.html)) assert.ok(src.startsWith('https://mayobebros.com/assets/email/'), src);
  assert.ok(w.html.includes('href="http://127.0.0.1:8000/post/new-one/"'));
});

test('image fields cost no subrequest: with subrequestLimit 20 the same number of emails go out with and without m, w and a', async () => {
  const perRun = async (fields) => {
    env = { DB: makeD1(), SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key', API_ORIGIN: 'https://worker.test' };
    sent = [];
    await seeded();
    sendOn();
    for (let i = 1; i <= 12; i++) addSub(`s${i}@example.com`);
    const strip = (e) => { const { m, w, a, ...rest } = e; return rest; };
    searchList = [...OLD_LIST, entry('fresh-post', dayOf(0), fields ? { w: 'abcdef01' } : {})].map((e) => (fields ? e : strip(e)));
    const counts = [];
    for (let runs = 0; runs < 20; runs++) {
      const before = postMails().length;
      const { db, c, base } = limitedDB(20);
      env.DB = db;
      const r = await run({ subrequestLimit: 20 });
      env.DB = base; onFetch = null;
      assert.equal(c.over, false);
      counts.push(postMails().length - before);
      if (r.stopped !== 'subrequests') break;
    }
    return counts;
  };
  const withFields = await perRun(true);
  const without = await perRun(false);
  assert.deepEqual(withFields, without);
  assert.equal(withFields.reduce((a, b) => a + b, 0), 12);
  assert.ok(withFields[0] > 0);
});
