#!/usr/bin/env node
// Makes the school pages of the results Worker AHEAD OF TIME, so the Worker only hands over a finished file (no building on Cloudflare's
// free 10 ms of processing). It runs the Worker's own code (results-worker/src/index.js) on this computer for every address in the
// sitemaps, and writes one gzip file per page: first line = JSON with status and headers, then the HTML.
//   node scripts/tools/results-prerender.mjs --sample 300            measure only: renders a spread of pages, prints sizes and speed, writes nothing
//   node scripts/tools/results-prerender.mjs --out DIR [--exam csee-2025,psle-2024] [--limit N]
// Files are named like the R2 objects the Worker reads: <out>/pages/<path of the page>index.gz  (e.g. pages/results/csee/s0107/2025/index.gz).
// Needs results-data/ and results-shell.html (run node scripts/build.mjs first). Nothing is uploaded here (see scripts/tools/r2-rclone-upload.mjs).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'results-data');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const sample = Number(opt('--sample') || 0);
const outDir = opt('--out');
const only = (opt('--exam') || '').split(',').filter(Boolean);
const limit = Number(opt('--limit') || 0);
if (!sample && !outDir) { console.error('Give --sample N (measure) or --out DIR (write).'); process.exit(1); }

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const ORIGIN = 'https://mayobebros.com';
const fsBucket = {
  async get(key) {
    const file = path.normalize(path.join(DATA, String(key)));
    if (!file.startsWith(DATA + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return { text: async () => fs.readFileSync(file, 'utf8'), httpEtag: `"x"` };
  },
  async head(key) { return (await this.get(key)) ? {} : null; },
};
const shellText = fs.readFileSync(path.join(ROOT, 'results-shell.html'), 'utf8');
const env = { RESULTS: fsBucket, ORIGIN, RESULTS_INDEX: config.resultsData?.index || 'all', RESULTS_INDEX_FROM: '', FETCH_SHELL: async () => new Response(shellText, { status: 200 }) };

const worker = await import('../../results-worker/src/index.js');
const data = await import('../../results-worker/src/data.js');
const sm = await import('../../results-worker/src/sitemap.js');

const reg = await data.getRegistry(env);
const mode = sm.normMode(env.RESULTS_INDEX);
const exams = reg.exams.filter((e) => !only.length || only.includes(e.id));
// What is stored per page is the page object the Worker builds (title, description, JSON-LD, the page's own HTML, robots facts), NOT the whole
// document: the Worker puts the site's header and footer round it when it answers, so a change to the header or footer needs no new run, and
// a page is a few KB instead of 56 KB. Robots rules come from the Worker's variables at answer time (RESULTS_INDEX, RESULTS_INDEX_FROM).
const gzip = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
let n = 0, ok = 0, bad = 0, raw = 0, gz = 0, ms = 0;
const sizes = [];
const bad_ = [];
const seen = new Set();
function save(p, buf) {
  const file = path.join(outDir, worker.storedKey(p));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}
async function onePage(p, write) {
  if (seen.has(p)) return;
  seen.add(p);
  const t0 = process.hrtime.bigint();
  const got = await worker.buildPage(env, p);
  ms += Number(process.hrtime.bigint() - t0) / 1e6;
  n++;
  if (!got) { bad++; if (bad_.length < 10) bad_.push(p); return; }
  const json = JSON.stringify({ page: got.page });
  const buf = zlib.gzipSync(Buffer.from(json), { level: 9 });
  ok++; raw += Buffer.byteLength(json); gz += buf.length; sizes.push(buf.length);
  if (write) save(p, buf);
}

/** Every address worth having ready: all the sitemap addresses, plus the pages of centres too small to be indexed (they are linked from the lists). */
async function addressesOf(e) {
  const urls = await sm.urlsOf(env, reg, e, mode, 0, 'all');
  const list = await data.getList(env, e, { keep: false });
  const later = new Set();
  for (const x of data.examsOf(reg, e.cat)) if (x.year > e.year) for (const c of await data.getCodes(env, x)) later.add(c);
  for (const r of list.rows) {
    urls.push(`/results/${e.cat}/${r.c}/${e.year}/`);
    if (!later.has(r.c)) urls.push(`/results/${e.cat}/${r.c}/`);
  }
  return urls;
}

if (sample) {
  const all = [];
  for (const e of exams) {
    const urls = await addressesOf(e);
    const step = Math.max(1, Math.floor(urls.length / Math.max(1, Math.ceil(sample / exams.length))));
    for (let i = 0; i < urls.length; i += step) all.push(urls[i]);
    data.resetMemory();
  }
  for (const p of all.slice(0, sample * 2)) await onePage(p, false);
} else {
  for (const e of exams) {
    const urls = await addressesOf(e);
    let done = 0;
    for (const p of urls) { if (limit && done >= limit) break; await onePage(p, true); done++; }
    console.log(`${e.id}: ${done} pages (${ok} stored so far, ${bad} not built)`);
    data.resetMemory();
  }
  // the sitemaps (an index needs far more than 10 ms to work out, so they are made here too)
  const maps = [];
  for (const g of ['schools', 'hubs', 'all']) {
    maps.push(g === 'all' ? '/results/sitemap.xml' : `/results/sitemap-${g}.xml`);
    for (const e of exams) {
      const count = (await sm.urlsOf(env, reg, e, mode, 0, g)).length;
      for (let i = 1; i <= Math.ceil(count / sm.URLS_PER_FILE); i++) maps.push(`/results/${sm.partName(g, e, i)}`);
      data.resetMemory();
    }
  }
  let made = 0;
  for (const p of maps) {
    const res = await worker.handle(new Request(ORIGIN + p), env, { waitUntil() {} });
    if (res.status !== 200) { console.log(`sitemap ${p}: ${res.status}`); continue; }
    save(p, gzip({ xml: await res.text(), modified: new Date().toISOString().slice(0, 10) }));
    made++;
  }
  console.log(`sitemaps stored: ${made} of ${maps.length}`);
}
sizes.sort((a, b) => a - b);
const q = (f) => sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * f))] || 0;
console.log(JSON.stringify({ pages: n, ok, notBuilt: bad, jsonKB: Math.round(raw / 1024), gzipKB: Math.round(gz / 1024), avgGzKB: +(gz / Math.max(1, ok) / 1024).toFixed(2), p99GzKB: +(q(0.99) / 1024).toFixed(2), maxGzKB: +(q(1) / 1024).toFixed(2), msPerPage: +(ms / Math.max(1, n)).toFixed(2) }));
if (bad_.length) console.log('not built:', bad_.join('\n  '));
