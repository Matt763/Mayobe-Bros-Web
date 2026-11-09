// The Popular page: ordered by what readers really open (counted privately by the Worker), never showing a number.
//   node --no-warnings --test scripts/tests/popular.test.mjs   (after `node scripts/build.mjs`)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { popularOrder, MOST_READ_MIN } from '../lib/popular.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slugs = fs.readdirSync(path.join(ROOT, 'content', 'posts')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
const P = (slug, featured = false) => ({ slug, featured });

test('before enough articles have enough reads, the page keeps editor\'s picks first, then the newest', () => {
  const posts = [P('new'), P('pick', true), P('old'), P('pick2', true)];
  for (const ranked of [[], undefined, null, ['new', 'old', 'pick'], ['ghost-1', 'ghost-2', 'ghost-3', 'ghost-4', 'ghost-5']]) {
    const r = popularOrder(posts, ranked);
    assert.equal(r.mostRead, false);
    assert.deepEqual(r.list.map((p) => p.slug), ['pick', 'pick2', 'new', 'old']);
  }
  assert.equal(MOST_READ_MIN, 5);
});

test('with enough reads the most-read articles come first, in their order, then picks, then the newest', () => {
  const posts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => P(s, s === 'g'));
  const r = popularOrder(posts, ['e', 'c', 'a', 'unknown', 'd', 'b', 'c']);
  assert.equal(r.mostRead, true);
  assert.deepEqual(r.list.map((p) => p.slug), ['e', 'c', 'a', 'd', 'b', 'g', 'f'], 'a repeated or unknown slug is ignored; nobody appears twice');
  assert.equal(r.list.length, posts.length);
});

test('the built Popular pages show no reader numbers, and no page shows the counter\'s internals', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'worker', 'scripts', 'content', 'vendor', 'assets'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.html')) out.push(p);
    }
    return out;
  };
  const files = walk(ROOT);
  assert.ok(files.length > 50);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /n_pop|post_reads|read_seen/, `${path.relative(ROOT, f)}: no internals`);
  const listing = files.filter((f) => /[\\/]popular[\\/]/.test(f));
  assert.ok(listing.length >= 1);
  for (const f of listing) {
    const text = fs.readFileSync(f, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
    assert.doesNotMatch(text, /\b\d[\d,.]*\s*(reads|readers|views|visitors|visits)\b/i, `${path.relative(ROOT, f)}: no reader or visitor numbers`);
    assert.doesNotMatch(text, /trending|most viewed|most visited|reads/i, `${path.relative(ROOT, f)}: no claim of numbers`);
  }
  const popular = fs.readFileSync(path.join(ROOT, 'popular', 'index.html'), 'utf8');
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'popular.json'), 'utf8'));
  const ready = Array.isArray(saved.ranked) && saved.ranked.length >= MOST_READ_MIN;
  assert.match(popular, ready ? /The articles our readers open most/ : /Editors' picks first, then the latest stories\./, 'the words match what the order really is');
});

test('content/popular.json keeps only the order: slugs of real articles, no numbers', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'popular.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['note', 'ranked', 'updated']);
  assert.ok(Array.isArray(saved.ranked) && saved.ranked.every((s) => typeof s === 'string' && slugs.includes(s)), 'every ranked slug is a real article');
  assert.ok(saved.ranked.length === 0 || saved.ranked.length >= MOST_READ_MIN, 'a short list would not be used by the page');
});

// --- scripts/popular-sync.mjs against a pretend Worker ---
async function sync({ answer, status = 200, flags = [], existing = null }) {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/admin/popular' && req.headers.authorization === 'Bearer test-token-123456789') {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer));
    } else { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"Unauthorized."}'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popular-sync-'));
  const file = path.join(dir, 'popular.json');
  if (existing) fs.writeFileSync(file, existing);
  const child = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts', 'popular-sync.mjs'), '--out', file, ...flags], { env: { ...process.env, MAYOBE_API: `http://127.0.0.1:${server.address().port}`, ADMIN_TOKEN: 'test-token-123456789' } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((r) => child.on('close', r));
  server.close();
  return { code, stdout, stderr, saved: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}
const rows = (list) => list.map((slug, i) => ({ slug, reads: 40 - i, days: 5, score: 30 - i }));

test('sync: saves only the order of real articles when the Worker says there are enough reads, and prints the numbers only to the terminal', async () => {
  const five = slugs.slice(0, 5);
  const r = await sync({ answer: { ready: true, ranked: [...five, 'not-a-real-article'], rows: rows([...five, 'not-a-real-article']) } });
  assert.equal(r.code, 0, r.stderr);
  const saved = JSON.parse(r.saved);
  assert.deepEqual(saved.ranked, five);
  assert.doesNotMatch(r.saved, /"reads"|"score"|"days"/);
  assert.match(r.stdout, /40 reads on\s+5 days/, 'the owner sees the numbers here');
});

test('sync: not enough reads saves an empty order (the page keeps editor\'s picks first); a dry run writes nothing', async () => {
  const two = slugs.slice(0, 2);
  const r = await sync({ answer: { ready: false, ranked: two, rows: rows(two) } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.saved).ranked, []);
  assert.match(r.stdout, /Not enough reads yet/);
  const dry = await sync({ answer: { ready: true, ranked: slugs.slice(0, 5), rows: rows(slugs.slice(0, 5)) }, flags: ['--dry'], existing: '{"keep":"me"}' });
  assert.equal(dry.code, 0);
  assert.equal(dry.saved, '{"keep":"me"}', 'dry run changes nothing');
});

test('sync: a failing or odd answer leaves the saved order untouched', async () => {
  const before = '{"ranked":["keep"]}';
  const down = await sync({ answer: { error: 'Unauthorized.' }, status: 500, existing: before });
  assert.notEqual(down.code, 0);
  assert.equal(down.saved, before);
  const odd = await sync({ answer: { hello: 'world' }, existing: before });
  assert.notEqual(odd.code, 0);
  assert.equal(odd.saved, before);
});

test('every built article loads js/reads.js, the home page and listings do not', () => {
  const articles = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (e.name === 'index.html' && fs.readFileSync(f, 'utf8').includes('<article class="post">')) articles.push(f); } };
  walk(path.join(ROOT, 'post'));
  assert.ok(articles.length > 50);
  for (const f of articles) assert.match(fs.readFileSync(f, 'utf8'), /<script src="\/js\/reads\.js\?v=[0-9a-f]+" defer><\/script>/, path.relative(ROOT, f));
  for (const rel of ['index.html', 'popular/index.html', 'post/index.html', 'about/index.html']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, rel), 'utf8'), /reads\.js/, rel);
});
