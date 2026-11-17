// Tells Bing, Yahoo, DuckDuckGo and Yandex about the results Worker's pages (the school pages, lists and hubs under /results/) with IndexNow,
// in waves, so a section of hundreds of thousands of addresses is announced a day at a time instead of all at once.
// Google does not use IndexNow: it finds these pages through /results/sitemap.xml (Search Console) and the links on the pages.
//
//   node scripts/indexnow-results.mjs --dry-run          show what the next wave would send (reads the LIVE sitemap, sends nothing)
//   node scripts/indexnow-results.mjs                     send the next wave (default 10,000 addresses, the most important first)
//   node scripts/indexnow-results.mjs --limit 5000        a smaller wave
//   node scripts/indexnow-results.mjs --status            how far each sitemap file is
//
// Run it only AFTER the Worker is deployed with RESULTS_INDEX = hubs or all, the site is pushed and the key file is published (see indexnow.mjs).
// It remembers, per sitemap file, its lastmod and how many of its addresses were sent (.indexnow-results-state.json): a file whose lastmod
// changed (new data) is sent again from its start. Order: year indexes, A to Z lists and hubs come first inside every file, school pages last,
// and the newest exam-years first.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = new Set(argv);
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const site = new URL(config.siteUrl);
const key = config.indexNowKey;
const STATE_FILE = path.join(ROOT, '.indexnow-results-state.json');
const limitAt = argv.indexOf('--limit');
const LIMIT = Math.min(10000, Math.max(1, limitAt >= 0 ? Number(argv[limitAt + 1]) || 10000 : 10000));

if (!/^[A-Za-z0-9-]{8,128}$/.test(key || '')) { console.error('No IndexNow key yet. Run: node scripts/indexnow.mjs --init (and publish the key file).'); process.exit(1); }
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { files: {} };
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n');

async function get(url) {
  if (new URL(url).host !== site.host) throw new Error(`refusing ${url}: not on ${site.host}`);
  const r = await fetch(url, { headers: { 'User-Agent': 'mayobebros-indexnow-results' } });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.text();
}
const locs = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>\\s*<loc>([^<]+)</loc>(?:\\s*<lastmod>([^<]+)</lastmod>)?`, 'g'))].map((m) => ({ loc: m[1].replace(/&amp;/g, '&'), lastmod: m[2] || '' }));

const indexUrl = `${site.origin}/results/sitemap.xml`;
let files;
try { files = locs(await get(indexUrl), 'sitemap'); } catch (e) { console.error(`Could not read ${indexUrl}: ${e.message}\nThe Worker must be deployed and RESULTS_INDEX must not be "off".`); process.exit(1); }
files.sort((a, b) => (/-(\d{4})-\d+\.xml$/.exec(b.loc) || [0, 0])[1] - (/-(\d{4})-\d+\.xml$/.exec(a.loc) || [0, 0])[1]); // newest exam-year first
console.log(`${files.length} sitemap files in ${indexUrl}`);

if (args.has('--status')) {
  let sent = 0, left = 0;
  for (const f of files) { const s = state.files[f.loc]; if (s && s.lastmod === f.lastmod) { sent += s.sent; if (s.sent < s.total) left += 1; } else left += 1; }
  console.log(`${sent} addresses sent; ${left} sitemap files not finished (or changed since).`);
  process.exit(0);
}

const wave = [];
const touched = [];
for (const f of files) {
  if (wave.length >= LIMIT) break;
  // a file whose lastmod changed starts again; a file that GREW (for example hubs -> all adds the school pages at its end, same lastmod) continues
  // from where it stopped, so every file is read again each run instead of trusting a stored total
  const s = state.files[f.loc] && state.files[f.loc].lastmod === f.lastmod ? state.files[f.loc] : { lastmod: f.lastmod, sent: 0, total: 0 };
  const urls = locs(await get(f.loc), 'url').map((x) => x.loc);
  s.total = urls.length;
  const take = urls.slice(s.sent, s.sent + (LIMIT - wave.length));
  if (!take.length) { state.files[f.loc] = s; continue; }
  wave.push(...take);
  touched.push({ f, s, took: take.length });
  state.files[f.loc] = s;
}
console.log(`Next wave: ${wave.length} addresses from ${touched.length} sitemap files.`);
wave.slice(0, 8).forEach((u) => console.log('  ' + u));
if (wave.length > 8) console.log(`  ... and ${wave.length - 8} more`);
if (!wave.length || args.has('--dry-run')) { if (args.has('--dry-run')) console.log('Dry run: nothing was sent, nothing was saved.'); process.exit(0); }
for (const u of wave) if (new URL(u).host !== site.host) { console.error(`Refusing to send ${u}: not on ${site.host}`); process.exit(1); }

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: site.host, key, keyLocation: `${site.origin}/${key}.txt`, urlList: wave }),
});
console.log(`IndexNow answered ${res.status}${res.headers.get('retry-after') ? ` (retry after ${res.headers.get('retry-after')}s)` : ''}`);
if (res.status !== 200 && res.status !== 202) {
  console.error('Not accepted. 403 = the key file is not published yet, 422 = an address does not match the host, 429 = too many requests: wait and run again later.');
  process.exit(1);
}
for (const t of touched) t.s.sent += t.took;
state.sent = new Date().toISOString();
save();
console.log('Saved to .indexnow-results-state.json. Run again tomorrow for the next wave.');
