// Fixes from the security review of 2026-11-08: IPv6 identities, admin-token comparison and throttle, huge bodies, held-alert room,
// a pending newsletter address, emoji in an address.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';
import { visitorNet } from '../../worker/src/util.js';
import { contactOwnerEmail } from '../../worker/src/mail-templates.js';

const ORIGIN = 'https://mayobebros.com';
const realFetch = globalThis.fetch;
let env, sent, pending;
test.before(() => {
  globalThis.fetch = async (u, init) => {
    if (String(u).endsWith('/data/search.json')) return new Response(JSON.stringify([{ s: 'hello-post', t: 'Hello', u: '/post/hello-post/' }]), { status: 200 });
    if (String(u) === 'https://api.resend.com/emails') { sent.push({ body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: `m${sent.length}` }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
});
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => { sent = []; pending = []; env = { DB: makeD1(), ADMIN_TOKEN: 'a-very-long-admin-token-123', SITE_ORIGIN: ORIGIN, RESEND_API_KEY: 're_test_key', REVIEW_EMAILS: 'a@example.org,b@example.org' }; });
test.afterEach(async () => { while (pending.length) await Promise.all(pending.splice(0)); });
const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
async function call(method, path, { body, headers = {}, origin = ORIGIN, ip = '1.1.1.1' } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (origin) h.Origin = origin;
  if (body) h['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: (p) => { pending.push(p); } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('an IPv6 visitor is one identity per /64, however the address is written; IPv4 and mapped IPv4 are themselves', () => {
  const a = visitorNet('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
  assert.equal(visitorNet('2001:DB8:1:2:1111:2222:3333:4444'), a, 'rotating the last 64 bits gives nothing new');
  assert.equal(visitorNet('2001:db8:1:2::1'), a, 'the short form is the same network');
  assert.equal(visitorNet('2001:0db8:0001:0002:0000:0000:0000:0001'), a);
  assert.notEqual(visitorNet('2001:db8:1:3::1'), a, 'another /64 is another visitor');
  assert.equal(visitorNet('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(visitorNet('203.0.113.9'), '203.0.113.9');
  assert.match(visitorNet('::1'), /^v6:0000:0000:0000:0000$/);
  assert.equal(visitorNet(''), 'unknown');
});

test('the comment rate limit follows the /64, not the single IPv6 address', async () => {
  env.DB.raw.exec("INSERT OR IGNORE INTO posts(slug, created) VALUES('hello-post', 1)");
  let blocked = 0;
  for (let i = 0; i < 12; i++) {
    const r = await call('POST', '/v1/posts/hello-post/comments', { body: { name: 'Asha', body: `Thank you, number ${i} was useful to me.`, cid: `cid-rotating-ipv6-${String(i).padStart(4, '0')}-xyz`, ts: Date.now() - 20000 }, ip: `2001:db8:5:5:${(i + 1).toString(16)}:${i}::${i + 1}` });
    if (r.status === 429) blocked++;
  }
  assert.ok(blocked > 0, 'twelve comments from one /64 hit the limit');
});

test('admin: a wrong token of any length is refused, the right one works, and guessing is throttled', async () => {
  const get = (token, ip = '9.9.9.9') => call('GET', '/v1/admin/comments?status=pending', { headers: token ? { Authorization: `Bearer ${token}` } : {}, origin: null, ip });
  assert.equal((await get('x')).status, 401);
  assert.equal((await get('a-very-long-admin-token-123-and-more')).status, 401);
  assert.equal((await get(env.ADMIN_TOKEN)).status, 200);
  let limited = 0;
  for (let i = 0; i < 70; i++) if ((await get(`guess-${i}-aaaaaaaaaaaaaaaaaaaa`, '7.7.7.7')).status === 429) limited++;
  assert.ok(limited > 0, 'a flood of guesses from one visitor is throttled');
  assert.equal((await get(env.ADMIN_TOKEN, '8.8.8.8')).status, 200, 'another visitor is not affected');
});

test('a body that announces itself as huge is refused before it is read', async () => {
  const r = await call('POST', '/v1/review', { body: { r: 'x' }, headers: { 'Content-Length': '5000000' } });
  assert.equal(r.status, 413);
});

test('question alerts cannot use up the held-comment alerts', async () => {
  env.DB.raw.exec("INSERT OR IGNORE INTO posts(slug, created) VALUES('hello-post', 1)");
  env.REVIEW_SECRET = 'a-long-review-secret-for-tests-123';
  for (let i = 0; i < 6; i++) await call('POST', '/v1/posts/hello-post/comments', { body: { name: 'Asha', body: `Is question number ${i} answered?`, cid: `cid-question-${i}-aaaaaaaaaaaa`, ts: Date.now() - 20000 }, ip: `10.1.1.${i}` });
  await flush();
  assert.equal(sent.filter((s) => /question/i.test(s.body.subject)).length, 4, 'questions stop at 4');
  sent = [];
  const held = await call('POST', '/v1/posts/hello-post/comments', { body: { name: 'Asha', body: 'You are an idiot and a fool, mjinga wewe.', cid: 'cid-held-after-questions-1', ts: Date.now() - 20000 }, ip: '10.2.2.2' });
  await flush();
  assert.equal(held.json.status, 'pending');
  assert.equal(sent.filter((s) => /held/i.test(s.body.subject)).length, 2, 'the held alert still reaches both review addresses');
});

test('a second sign-up for the same inbox does not change the address a pending confirmation goes to', async () => {
  env.NEWSLETTER_SEND = 'false';
  const sub = (email, ip) => call('POST', '/v1/newsletter/subscribe', { body: { email, website: '', elapsed: 9000 }, ip });
  assert.equal((await sub('victim@gmail.com', '3.3.3.1')).status, 200);
  await sub('v.ictim+other@gmail.com', '3.3.3.2');
  const rows = env.DB.raw.prepare('SELECT email FROM newsletter_subscribers').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'victim@gmail.com');
});

test('an emoji in the visitor address no longer breaks the contact email', () => {
  const m = contactOwnerEmail({ name: 'Jo', email: '😀@example.com', subject: 'Hi there', message: 'A message long enough.', type: 'general' }, { origin: ORIGIN });
  assert.ok(m.html.includes('mailto:'));
  assert.ok(!/URIError/.test(m.html));
});
