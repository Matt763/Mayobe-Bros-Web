// Pages made ahead of time (scripts/tools/results-prerender.mjs) are answered by the Worker exactly like pages it builds itself, a page that is
// not stored is still built, a sitemap is served from its file, and nothing about the stored copy can show a candidate number.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'results-data');
const haveData = fs.existsSync(path.join(DATA, 'registry.json')) && fs.existsSync(path.join(ROOT, 'results-shell.html')) && fs.existsSync(path.join(DATA, 'dte-2019', 'meta.json'));
const skip = haveData ? false : 'needs results-data/ and results-shell.html';

const out = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'mb-prerender-test-'));
if (haveData) execFileSync(process.execPath, [path.join(ROOT, 'scripts/tools/results-prerender.mjs'), '--out', out, '--exam', 'dte-2019'], { stdio: 'pipe' });
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const shell = haveData ? fs.readFileSync(path.join(ROOT, 'results-shell.html'), 'utf8') : '';
const bucket = (withPages) => ({
  async get(key) {
    for (const base of withPages ? [out, DATA] : [DATA]) {
      const f = path.join(base, key);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) { const b = fs.readFileSync(f); return { text: async () => b.toString('utf8'), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), httpEtag: '"x"' }; }
    }
    return null;
  },
});
const mkEnv = (withPages, over = {}) => ({ RESULTS: bucket(withPages), ORIGIN: 'https://mayobebros.com', RESULTS_INDEX: 'all', RESULTS_INDEX_FROM: '', FETCH_SHELL: async () => new Response(shell), ...over });
const get = async (p, env) => { const { handle } = await import('../../results-worker/src/index.js'); return handle(new Request('https://mayobebros.com' + p), env, { waitUntil() {} }); };

test('a stored page answers byte for byte like the page the Worker builds', { skip }, async () => {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); };
  walk(path.join(out, 'pages'));
  const pages = files.filter((f) => f.endsWith('index.json.gz')).map((f) => '/' + path.relative(path.join(out, 'pages'), path.dirname(f)).split(path.sep).join('/') + '/');
  assert.ok(pages.length >= 3, 'some pages were stored');
  for (const p of pages) {
    const a = await get(p, mkEnv(true)), b = await get(p, mkEnv(false));
    assert.equal(a.status, 200, p);
    assert.equal(await a.text(), await b.text(), p);
    assert.equal(a.headers.get('x-robots-tag'), b.headers.get('x-robots-tag'), p);
    assert.equal(a.headers.get('etag'), b.headers.get('etag'), p);
  }
});

test('the robots rule is decided when the page is answered, not when it is stored', { skip }, async () => {
  const p = '/results/dte/e0502/2019/';
  const all = await (await get(p, mkEnv(true))).text();
  const off = await get(p, mkEnv(true, { RESULTS_INDEX: 'off' }));
  assert.match(all, /name="robots" content="(index|noindex)/);
  assert.match(await off.text(), /name="robots" content="noindex, nofollow"/);
});

test('a page that is not stored is built the usual way; a missing page is still a 404', { skip }, async () => {
  fs.rmSync(path.join(out, 'pages/results/dte/2019'), { recursive: true, force: true });
  const a = await get('/results/dte/2019/', mkEnv(true));
  assert.equal(a.status, 200);
  assert.equal((await get('/results/dte/zz9999/2019/', mkEnv(true))).status, 404);
});

test('sitemaps are served from their stored file, and 404 while indexing is off', { skip }, async () => {
  const a = await get('/results/sitemap-schools.xml', mkEnv(true));
  assert.equal(a.status, 200);
  assert.match(await a.text(), /<sitemapindex/);
  assert.equal((await get('/results/sitemap-schools.xml', mkEnv(true, { RESULTS_INDEX: 'off' }))).status, 404);
});

test('a stored page holds no candidate number (no table of candidates, only the school figures)', { skip }, async () => {
  const zlib = await import('node:zlib');
  const f = path.join(out, 'pages/results/dte/e0502/2019/index.json.gz');
  const txt = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
  assert.doesNotMatch(txt.replace(/e\.g\. [A-Z0-9\/-]+/g, ''), /\b[A-Z]{1,2}\d{4,9}[-\/](?!(?:19|20)\d{2}\b)\d{3,4}\b/);
});
