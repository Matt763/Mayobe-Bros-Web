// "Most read": the Worker counts engaged reads in the background; the site shows only the order, never a number.
//   node --no-warnings --test scripts/tests/reads.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';
import { rank, purgeReads, looksLikeBot, looksTooBare, browserClass, WINDOW_DAYS, MIN_READS, MIN_POSTS, DAY_CAP, PER_NETWORK_ARTICLE } from '../../worker/src/reads.js';

const ORIGIN = 'https://mayobebros.com';
const ADMIN = 'a-very-long-admin-token-123';
const realFetch = globalThis.fetch;
const SLUGS = ['alpha-post', 'beta-post', 'gamma-post', 'delta-post', 'epsilon-post', 'zeta-post'];
let env;
test.before(() => {
  globalThis.fetch = async (u) => (String(u).endsWith('/data/search.json') ? new Response(JSON.stringify(SLUGS.map((s) => ({ s, t: s, u: `/post/guides/${s}/` })))) : new Response('{}', { status: 404 }));
});
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => { env = { DB: makeD1(), ADMIN_TOKEN: ADMIN, SITE_ORIGIN: ORIGIN, HASH_SALT: 'test-salt' }; });

async function call(method, path, { body, origin = ORIGIN, auth, ip = '1.1.1.1', ua = 'Mozilla/5.0 (Linux; Android 14; SM-A155F) Chrome/126 Mobile Safari/537.36' } = {}) {
  const headers = { 'CF-Connecting-IP': ip, 'User-Agent': ua };
  if (origin) headers.Origin = origin;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: () => {} });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const totals = () => Object.fromEntries(env.DB.raw.prepare('SELECT slug, SUM(n) AS n, SUM(n_pop) AS p FROM post_reads GROUP BY slug').all().map((r) => [r.slug, [r.n, r.p]]));
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const put = (slug, day, n, n_pop = 0) => env.DB.raw.prepare('INSERT INTO post_reads(slug, day, n, n_pop) VALUES(?, ?, ?, ?)').run(slug, day, n, n_pop);

test('a read is counted once per visitor per article per day, and the answer never says whether it counted', async () => {
  const a = await call('POST', '/v1/read', { body: { slug: 'alpha-post' } });
  assert.deepEqual([a.status, a.json], [200, { ok: true }]);
  const again = await call('POST', '/v1/read', { body: { slug: 'alpha-post' } });
  assert.deepEqual([again.status, again.json], [200, { ok: true }], 'a repeat looks the same');
  assert.deepEqual(totals(), { 'alpha-post': [1, 0] });
  await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ip: '2.2.2.2' });
  await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1' });
  await call('POST', '/v1/read', { body: { slug: 'beta-post' } });
  assert.deepEqual(totals(), { 'alpha-post': [3, 0], 'beta-post': [1, 0] }, 'another network, another browser and another article each count');
});

test('reads that arrive from /popular/ are remembered as such', async () => {
  await call('POST', '/v1/read', { body: { slug: 'alpha-post', p: 1 } });
  await call('POST', '/v1/read', { body: { slug: 'alpha-post', p: true }, ip: '3.3.3.3' });
  await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ip: '4.4.4.4' });
  assert.deepEqual(totals(), { 'alpha-post': [3, 2] });
});

test('bots, unknown articles, bad input and other sites are not counted', async () => {
  for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'HeadlessChrome/126', 'curl/8.5.0', 'python-requests/2.31', 'Lighthouse']) {
    assert.equal((await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ua })).status, 200);
  }
  assert.deepEqual(totals(), {}, 'bots leave no trace');
  assert.equal((await call('POST', '/v1/read', { body: { slug: 'no-such-post' } })).status, 404);
  assert.equal((await call('POST', '/v1/read', { body: { slug: 'Bad_Slug!' } })).status, 400);
  assert.equal((await call('POST', '/v1/read', { body: {} })).status, 400);
  assert.equal((await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, origin: null })).status, 403);
  assert.deepEqual(totals(), {});
  assert.equal(looksLikeBot('Mozilla/5.0 (Linux; Android 10; Cubot X30) Chrome/120 Mobile'), false, 'a phone brand with "bot" in its name is a reader');
});

test('one network cannot inflate the ranking: a changing User-Agent is not a new visitor, and one network adds only a few visitors per article per day', async () => {
  for (let i = 0; i < 60; i++) await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ua: `Mozilla/5.0 (Linux; Android 14; Variant${i}) Chrome/${100 + i} Mobile Safari/537.36` });
  assert.deepEqual(totals(), { 'alpha-post': [1, 0] }, 'sixty made-up agents of the same kind are one visitor');
  const kinds = ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit Safari/604.1', 'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/126 Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64) Gecko/20100101 Firefox/126.0', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126 Safari/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15 Version/17'];
  for (const ua of kinds) await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ua });
  assert.equal(totals()['alpha-post'][0], PER_NETWORK_ARTICLE, 'at most a few visitors per network per article per day');
});

test('scripts with no real browser name, and a Worker with no secret, count nothing', async () => {
  for (const ua of ['', 'x', 'Mozilla']) await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ua });
  assert.deepEqual(totals(), {});
  assert.equal(looksTooBare(''), true);
  assert.equal(looksTooBare('Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537.36'), false);
  env = { ...env, HASH_SALT: undefined };
  await call('POST', '/v1/read', { body: { slug: 'alpha-post' } });
  assert.deepEqual(totals(), {}, 'without HASH_SALT the visitor code could be guessed, so nothing is counted');
  assert.equal(browserClass('Mozilla/5.0 (Linux; Android 14; SM-A155F) Chrome/126 Mobile Safari/537.36'), 'android-chrome');
  assert.equal(browserClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit Safari/604.1'), 'ios-safari');
});

test('nothing that identifies a visitor is stored', async () => {
  await call('POST', '/v1/read', { body: { slug: 'alpha-post' }, ip: '203.0.113.77', ua: 'Mozilla/5.0 UniqueAgentString Chrome/126' });
  const seen = JSON.stringify(env.DB.raw.prepare('SELECT * FROM read_seen').all());
  assert.doesNotMatch(seen, /203\.0\.113\.77|UniqueAgentString|Mozilla/);
  assert.match(env.DB.raw.prepare('SELECT vh FROM read_seen').get().vh, /^[0-9a-f]{16}$/);
  const other = JSON.stringify(env.DB.raw.prepare('SELECT * FROM post_reads').all());
  assert.doesNotMatch(other, /203\.0\.113\.77|UniqueAgentString/);
});

test('ranking: needs real evidence (reads on more than one day), cold start stays quiet, order follows recent reads', () => {
  const at = Date.parse('2026-11-09T12:00:00Z');
  const D = (n) => new Date(at - n * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(rank([], at), { ready: false, ranked: [], rows: [] });
  // 40 reads on a single day is not enough evidence; 8 reads over three days is
  let r = rank([{ slug: 'one-day', day: D(1), n: 40, n_pop: 0 }, { slug: 'steady', day: D(0), n: 3, n_pop: 0 }, { slug: 'steady', day: D(1), n: 3, n_pop: 0 }, { slug: 'steady', day: D(2), n: 2, n_pop: 0 }], at);
  assert.deepEqual(r.ranked, ['steady']);
  assert.equal(r.ready, false, `"most read" needs ${MIN_POSTS} eligible articles first`);
  // five eligible articles: ready, ordered by recent reads
  const rows = [];
  const add = (slug, perDay) => perDay.forEach((n, i) => rows.push({ slug, day: D(i), n, n_pop: 0 }));
  add('hot-now', [9, 8, 6]);
  add('steady-a', [4, 4, 4]);
  add('older-but-big', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 6]);
  add('small', [3, 3, 3]);
  add('tiny', [2, 2, 2, 2]);
  r = rank(rows, at);
  assert.equal(r.ready, true);
  assert.equal(r.ranked[0], 'hot-now');
  assert.ok(r.ranked.indexOf('steady-a') < r.ranked.indexOf('older-but-big'), 'recent reads outweigh old ones (7-day half-life)');
  assert.ok(r.ranked.indexOf('small') < r.ranked.indexOf('tiny'));
  assert.ok(r.rows.every((x) => x.reads >= MIN_READS && x.days >= 3));
});

test('ranking: one huge day is capped, /popular/ reads count half, reads older than the window do not count', () => {
  const at = Date.parse('2026-11-09T12:00:00Z');
  const D = (n) => new Date(at - n * 86400000).toISOString().slice(0, 10);
  const capped = rank([{ slug: 'viral', day: D(0), n: 5000, n_pop: 0 }, { slug: 'viral', day: D(1), n: 5000, n_pop: 0 }, { slug: 'viral', day: D(2), n: 5000, n_pop: 0 }], at).rows[0];
  assert.ok(capped.score <= DAY_CAP * 3, `score ${capped.score} must not exceed three capped days`);
  const real = rank([{ slug: 'real', day: D(0), n: 10, n_pop: 0 }, { slug: 'real', day: D(1), n: 10, n_pop: 0 }, { slug: 'real', day: D(2), n: 10, n_pop: 0 }, { slug: 'looped', day: D(0), n: 10, n_pop: 10 }, { slug: 'looped', day: D(1), n: 10, n_pop: 10 }, { slug: 'looped', day: D(2), n: 10, n_pop: 10 }], at);
  const by = Object.fromEntries(real.rows.map((x) => [x.slug, x.score]));
  assert.ok(by.real > by.looped * 1.9, 'reads that came from the Popular page itself weigh half');
  const old = rank([{ slug: 'ancient', day: D(WINDOW_DAYS), n: 50, n_pop: 0 }, { slug: 'ancient', day: D(WINDOW_DAYS + 3), n: 50, n_pop: 0 }, { slug: 'ancient', day: D(WINDOW_DAYS + 4), n: 50, n_pop: 0 }], at);
  assert.deepEqual(old.ranked, []);
  assert.ok(MIN_READS >= 8);
});

test('GET /v1/admin/popular is for the owner only; the numbers are not public', async () => {
  const day = daysAgo(0);
  for (const s of SLUGS.slice(0, 5)) { put(s, day, 4); put(s, daysAgo(1), 3); put(s, daysAgo(2), 3); }
  assert.equal((await call('GET', '/v1/admin/popular')).status, 401);
  assert.equal((await call('GET', '/v1/admin/popular', { auth: 'wrong-token-wrong-token' })).status, 401);
  const ok = await call('GET', '/v1/admin/popular', { auth: ADMIN });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ready, true);
  assert.equal(ok.json.ranked.length, 5);
  assert.ok(ok.json.rows[0].reads >= 10);
  // nothing public mentions reads: stats and posts answers keep their old shape
  assert.deepEqual(Object.keys((await call('GET', '/v1/stats?slugs=alpha-post')).json['alpha-post']).sort(), ['c', 'r']);
});

test('the clean-up deletes visitor codes older than yesterday and daily totals after sixty', async () => {
  const at = Date.parse('2026-11-09T04:00:00Z');
  const D = (n) => new Date(at - n * 86400000).toISOString().slice(0, 10);
  const seen = env.DB.raw.prepare('INSERT INTO read_seen(day, slug, vh) VALUES(?, ?, ?)');
  for (const n of [0, 1, 2, 3, 10]) seen.run(D(n), 'alpha-post', `code${n}`);
  for (const n of [0, 30, 59, 60, 61, 90]) put('alpha-post', D(n), 1);
  await purgeReads(env, at);
  assert.deepEqual(env.DB.raw.prepare('SELECT day FROM read_seen ORDER BY day').all().map((r) => r.day), [D(1), D(0)], 'only yesterday and today are kept');
  assert.deepEqual(env.DB.raw.prepare('SELECT day FROM post_reads ORDER BY day').all().map((r) => r.day), [D(60), D(59), D(30), D(0)]);
});
