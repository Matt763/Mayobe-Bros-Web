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

test('remove prints removed 1, then removed 0', async () => {
  assert.match((await cli(['remove', 'ONE@example.com'])).stdout, /removed 1/);
  assert.match((await cli(['remove', 'one@example.com'])).stdout, /removed 0/);
});

test('count and dry-run work', async () => {
  const c = await cli(['count']);
  assert.equal(c.code, 0);
  assert.match(c.stdout, /active 2/);
  const d = await cli(['dry-run']);
  assert.equal(d.code, 0);
  assert.match(d.stdout, /seeded: old-one/);
  assert.match((await cli(['seed'])).stdout, /seeded: old-one/);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM newsletter_sent').get().n, 1, 'dry-run wrote nothing, seed wrote one row');
});

test('no token: exit 1 with the message', async () => {
  const r = await cli(['count'], { token: '' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No admin token/);
  const bad = await cli(['count'], { token: 'wrong-token-wrong-token' });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /401/);
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
