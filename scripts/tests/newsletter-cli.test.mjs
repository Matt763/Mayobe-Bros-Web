// The owner CLI (scripts/newsletter.mjs) against the real Worker code on a local http server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../worker/src/index.js';
import { makeD1 } from '../lib/d1-shim.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'newsletter.mjs');
const TOKEN = 'cli-test-admin-token-1234';
const env = { DB: makeD1(), ADMIN_TOKEN: TOKEN, HASH_SALT: 'x', ALLOWED_ORIGINS: 'https://mayobebros.com', SITE_ORIGIN: 'https://mayobebros.com' };
let server, base;
const realFetch = globalThis.fetch;
const LIST = [{ s: 'old-one', t: 'Old', u: '/post/old-one/', e: 'x', c: 'Educational', d: '2026-01-01', i: '/a.webp' }];
test.before(async () => {
  globalThis.fetch = (u, init) => String(u).endsWith('/data/search.json') ? Promise.resolve(new Response(JSON.stringify(LIST))) : realFetch(u, init);
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(`${base}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {} });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { globalThis.fetch = realFetch; server.close(); });

const reset = () => { for (const t of ['newsletter_tokens', 'newsletter_deliveries', 'newsletter_sent', 'newsletter_subscribers']) env.DB.raw.exec(`DELETE FROM ${t}`); };
const total = (t) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
test.beforeEach(reset);
const add = (email, status = 'active') => env.DB.raw.prepare('INSERT INTO newsletter_subscribers(email, email_key, status, created, confirmed) VALUES(?, ?, ?, ?, ?)').run(email, email.toLowerCase(), status, Date.UTC(2026, 10, 1), status === 'pending' ? null : Date.UTC(2026, 10, 2));
const cli = (args, { token = TOKEN } = {}) => new Promise((ok) => {
  const e = { ...process.env, MAYOBE_API: base, ADMIN_TOKEN: token, ADMIN_TOKEN_FILE: path.join(path.dirname(CLI), 'no-such-token-file') };
  if (!token) delete e.ADMIN_TOKEN;
  execFile(process.execPath, [CLI, ...args], { env: e, cwd: path.dirname(CLI) }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, stdout, stderr }));
});

test('list --csv prints a header line and one line per subscriber', async () => {
  add('one@example.com'); add('two@example.com'); add('=cmd@example.com');
  const r = await cli(['list', 'active', '--csv']);
  assert.equal(r.code, 0);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], 'id,email,status,created,confirmed,unsubscribed');
  assert.equal(lines.length, 4);
  assert.ok(lines.some((l) => l.includes(',one@example.com,active,2026-11-01,2026-11-02,')));
  assert.ok(lines.some((l) => l.includes(",'=cmd@example.com,")), 'formula-looking address is defused');
});

test('list --csv exports every row, past the 500 a single call returns', async () => {
  env.DB.raw.exec('BEGIN');
  for (let i = 0; i < 503; i++) add(`bulk${i}@example.com`);
  env.DB.raw.exec('COMMIT');
  const r = await cli(['list', 'active', '--csv']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim().split('\n').length, 504);
  assert.equal(new Set(r.stdout.trim().split('\n').map((l) => l.split(',')[1])).size, 504);
});

test('remove without --yes refuses and deletes nothing; with --yes prints removed 1, then removed 0', async () => {
  add('one@example.com');
  const no = await cli(['remove', 'one@example.com']);
  assert.equal(no.code, 1);
  assert.match(no.stderr, /--yes/);
  assert.equal(total('newsletter_subscribers'), 1);
  assert.match((await cli(['remove', 'ONE@example.com', '--yes'])).stdout, /removed 1/);
  assert.match((await cli(['remove', 'one@example.com', '--yes'])).stdout, /removed 0/);
  assert.equal(total('newsletter_subscribers'), 0);
});

test('count and dry-run work; seed writes, dry-run does not', async () => {
  add('a@example.com'); add('b@example.com'); add('c@example.com', 'pending');
  const c = await cli(['count']);
  assert.equal(c.code, 0);
  assert.match(c.stdout, /active 2, waiting to confirm 1/);
  assert.match(c.stdout, /of 35 \(article emails stop at 25/);
  const d = await cli(['dry-run']);
  assert.equal(d.code, 0);
  assert.match(d.stdout, /seeded: old-one/);
  assert.equal(total('newsletter_sent'), 0, 'dry-run wrote nothing');
  assert.match((await cli(['seed'])).stdout, /seeded: old-one/);
  assert.equal(total('newsletter_sent'), 1);
});

test('no token: exit 1 with the message; a wrong token is a 401', async () => {
  const r = await cli(['count'], { token: '' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No admin token/);
  add('keep@example.com');
  const bad = await cli(['remove', 'keep@example.com', '--yes'], { token: 'wrong-token-wrong-token' });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /401/);
  assert.equal(total('newsletter_subscribers'), 1, 'a rejected remove changed nothing');
  assert.equal((await cli(['seed'], { token: 'wrong-token-wrong-token' })).code, 1);
  assert.equal(total('newsletter_sent'), 0, 'a rejected seed changed nothing');
});

test('a non-https API address is refused (the token would travel in clear), except localhost', async () => {
  const run = (api) => new Promise((ok) => execFile(process.execPath, [CLI, 'count'], { env: { ...process.env, MAYOBE_API: api, ADMIN_TOKEN: TOKEN, ADMIN_TOKEN_FILE: 'none' } }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, stdout, stderr })));
  const r = await run('http://example.com');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /https/);
  assert.equal((await run(base)).code, 0, 'http://127.0.0.1 is allowed');
});

test('a subscriber email holding \\u001b[31m prints without the escape', async () => {
  add('evil\u001b[31m@example.com', 'pending');
  for (const args of [['list', 'pending'], ['list', 'pending', '--csv']]) {
    const r = await cli(args);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('evil'));
    assert.ok(!r.stdout.includes('\u001b'));
  }
});
