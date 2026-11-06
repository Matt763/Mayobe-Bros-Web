// Tests the Resend mail core (worker/src/mail.js) with a fake fetch and the SQLite stand-in for D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMail, takeBudget, CAPS } from '../../worker/src/mail.js';
import { makeD1 } from '../lib/d1-shim.mjs';

const KEY = 're_SECRET_test_key_123456';
const realFetch = globalThis.fetch;
const realError = console.error;
let env, calls, logs, reply;
test.beforeEach(() => {
  env = { DB: makeD1(), RESEND_API_KEY: KEY };
  calls = []; logs = [];
  reply = () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return reply(); };
  console.error = (...a) => logs.push(a.map(String).join(' '));
});
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

const msg = (over = {}) => ({ kind: 'owner', to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', replyTo: 'r@example.com', key: 'k-1', ...over });
const ctx = { waitUntil() {} };

test('sends one message with the right headers and body', async () => {
  const r = await sendMail(env, ctx, msg({ tags: [{ name: 'a', value: 'b' }], headers: { 'X-Test': '1' } }));
  assert.deepEqual(r, { ok: true, id: 'msg_1', status: 200 });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['User-Agent'], 'mayobe-engage/1.0');
  assert.equal(init.headers['Idempotency-Key'], 'k-1');
  const b = JSON.parse(init.body);
  assert.equal(b.from, 'Mayobe Bros <info@mayobebros.com>');
  assert.deepEqual(b.to, ['a@example.com']);
  assert.equal(b.subject, 'Hi'); assert.equal(b.html, '<p>Hi</p>'); assert.equal(b.text, 'Hi');
  assert.equal(b.reply_to, 'r@example.com');
  assert.deepEqual(b.headers, { 'X-Test': '1' });
  assert.deepEqual(b.tags, [{ name: 'a', value: 'b' }]);
});

test('MAIL_FROM and MAIL_FROM_SUPPORT override the sender', async () => {
  env.MAIL_FROM = 'X <x@mayobebros.com>'; env.MAIL_FROM_SUPPORT = 'S <support@mayobebros.com>';
  await sendMail(env, ctx, msg());
  assert.equal(JSON.parse(calls[0].init.body).from, 'X <x@mayobebros.com>');
  await sendMail(env, ctx, msg({ key: 'k-2', from: 'support' }));
  assert.equal(JSON.parse(calls[1].init.body).from, 'S <support@mayobebros.com>');
});

test('no key = skipped, no fetch', async () => {
  delete env.RESEND_API_KEY;
  assert.deepEqual(await sendMail(env, ctx, msg()), { ok: false, skipped: 'no-key' });
  assert.equal(calls.length, 0);
});

test('budget: 11th owner mail in a day is skipped, commenter slice unaffected, next UTC day resets', async () => {
  assert.deepEqual(CAPS, { owner: 10, commenter: 25, contact: 10, news: 35 });
  env.MAIL_TEST_DAY = '2026-01-01';
  for (let i = 0; i < 10; i++) assert.equal((await sendMail(env, ctx, msg({ key: `o${i}` }))).ok, true);
  assert.deepEqual(await sendMail(env, ctx, msg({ key: 'o10' })), { ok: false, skipped: 'budget' });
  assert.equal(calls.length, 10);
  assert.equal((await sendMail(env, ctx, msg({ kind: 'commenter', key: 'c1' }))).ok, true);
  env.MAIL_TEST_DAY = '2026-01-02';
  assert.equal((await sendMail(env, ctx, msg({ key: 'o11' }))).ok, true);
});

test('concurrent sends cannot exceed a slice', async () => {
  const rs = await Promise.all(Array.from({ length: 15 }, (_, i) => sendMail(env, ctx, msg({ key: `p${i}` }))));
  assert.equal(calls.length, 10);
  assert.equal(rs.filter((r) => r.ok).length, 10);
  assert.equal(rs.filter((r) => r.skipped === 'budget').length, 5);
});

test('a suppressed address is never mailed (case-insensitive) and costs no budget', async () => {
  await env.DB.prepare('INSERT INTO suppressed(email, reason, created) VALUES(?, ?, ?)').bind('a@example.com', 'bounce', 1).run();
  assert.deepEqual(await sendMail(env, ctx, msg({ to: 'A@Example.COM' })), { ok: false, skipped: 'suppressed' });
  assert.equal(calls.length, 0);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS c FROM mail_budget').first().then((r) => r.c), 0);
});

test('429, 500, a thrown fetch and a non-JSON body all return ok:false and never throw; the failure is logged without the key', async () => {
  for (const make of [
    () => new Response('{"message":"slow down"}', { status: 429 }),
    () => new Response('boom ' + 'x'.repeat(1000), { status: 500 }),
    () => { throw new Error('network down'); },
    () => new Response('<html>not json</html>', { status: 200 }),
  ]) {
    reply = make; logs.length = 0;
    const r = await sendMail(env, ctx, msg({ key: 'f' + Math.random() }));
    assert.equal(r.ok, false);
    assert.ok(logs.length >= 1);
    assert.ok(!logs.join('\n').includes(KEY), 'key must not be logged');
    assert.ok(logs.join('\n').length < 700, 'response body is truncated');
  }
});

test('CR/LF in subject are stripped; in an address they are rejected', async () => {
  await sendMail(env, ctx, msg({ subject: 'Hello\r\nBcc: evil@x.com' }));
  assert.ok(!/[\r\n]/.test(JSON.parse(calls[0].init.body).subject));
  for (const to of ['a@example.com\r\nBcc: e@x.com', 'a@example.com\n', 'nope', 'a b@example.com', '']) {
    assert.deepEqual(await sendMail(env, ctx, msg({ to, key: 'z' + to.length })), { ok: false, skipped: 'bad-address' });
  }
  assert.equal(calls.length, 1);
});

test('a failed send gives its budget unit back, and never below 0', async () => {
  env.MAIL_TEST_DAY = '2026-02-02';
  reply = () => new Response('err', { status: 500 });
  for (let i = 0; i < 12; i++) assert.equal((await sendMail(env, ctx, msg({ key: `r${i}` }))).ok, false);
  assert.equal(calls.length, 12, 'failures never exhaust the slice');
  const row = await env.DB.prepare('SELECT n FROM mail_budget WHERE day = ? AND kind = ?').bind('2026-02-02', 'owner').first();
  assert.equal(row.n, 0);
  assert.equal(await takeBudget(env, 'owner'), true);
});
