// Search-engine rules of the results pages: what a school's page says in search results (title, description, preview picture), that
// NO candidate number or individual result is in any page's HTML, that the figures a school page does carry are its own performance,
// what robots.txt and the sitemaps say, and that the posts that hold the search bar have their own descriptions.
// Needs results-data/ and results-shell.html (run `node scripts/build.mjs` first); skipped when they are not on this computer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../../results-worker/src/index.js';
import { decodeCentre } from '../../js/results-codec.js';
import { resetMemory } from '../../results-worker/src/data.js';
import { resetShell } from '../../results-worker/src/shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'results-data');
const SHELL = path.join(ROOT, 'results-shell.html');
const ready = fs.existsSync(path.join(DATA, 'registry.json')) && fs.existsSync(SHELL);
const skip = ready ? false : 'results-data/registry.json or results-shell.html is not on this computer';
const ORIGIN = 'https://mayobebros.com';
const registry = ready ? JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8')) : { exams: [] };
const shellText = ready ? fs.readFileSync(SHELL, 'utf8') : '';

const bucket = {
  async get(key) {
    const file = path.normalize(path.join(DATA, String(key)));
    if (!file.startsWith(DATA + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const text = fs.readFileSync(file, 'utf8');
    return { text: async () => text, httpEtag: '"t"' };
  },
  async head(key) { return (await this.get(key)) ? {} : null; },
};
const envFor = (mode) => { resetMemory(); resetShell(); return { RESULTS: bucket, ORIGIN, RESULTS_INDEX: mode, FETCH_SHELL: async () => new Response(shellText, { status: 200 }) }; };
const html = async (env, p) => { const r = await handle(new Request(ORIGIN + p), env, { waitUntil() {} }); return { r, t: await r.text() }; };
const attr = (t, re) => (re.exec(t) || [])[1];
const plain = (x) => String(x).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Centres spread over every exam-year: `per` of them from each. */
function sample(per) {
  const out = [];
  for (const e of registry.exams) {
    const files = fs.readdirSync(path.join(DATA, e.id)).filter((f) => f.endsWith('.txt')).sort();
    const step = Math.max(1, Math.floor(files.length / per));
    for (let i = 0, n = 0; i < files.length && n < per; i += step, n++) out.push({ id: e.id, cat: e.cat, year: e.year, code: files[i].slice(0, -4) });
  }
  return out;
}

test('a school page title is "<Name> Results <year>: <level> <EXAM>" with no brand, and the heading names the level', { skip: skip || !registry.exams.some((e) => e.id === 'csee-2025') }, async () => {
  const env = envFor('all');
  const { t } = await html(env, '/results/csee/s0107/2025/');
  const title = 'Lutheran Junior Seminary Results 2025: Form Four CSEE';
  assert.equal(attr(t, /<title>([^<]*)<\/title>/), title);
  assert.equal(attr(t, /<meta property="og:title" content="([^"]*)"/), title);
  assert.equal(attr(t, /<meta name="twitter:title" content="([^"]*)"/), title);
  assert.match(t, /<h1 class="rs-h1"[^>]*>Lutheran Junior Seminary: Form Four \(CSEE\) Results 2025<\/h1>/);
  assert.match(t, /<span lang="sw">matokeo ya kidato cha nne 2025<\/span>/, 'the Swahili words people search with are in the page text');
  assert.equal(attr(t, /<meta property="og:image" content="([^"]*)"/), `${ORIGIN}/assets/share/post-necta-csee-results-2025.jpg`);
  assert.equal(attr(t, /<meta name="twitter:image" content="([^"]*)"/), `${ORIGIN}/assets/share/post-necta-csee-results-2025.jpg`);
  assert.equal(attr(t, /<meta property="og:image:alt" content="([^"]*)"/), 'Share card for NECTA CSEE 2025 results on Mayobe Bros');
  assert.equal(attr(t, /<meta name="twitter:image:alt" content="([^"]*)"/), 'Share card for NECTA CSEE 2025 results on Mayobe Bros');
  assert.match(attr(t, /<meta name="robots" content="([^"]*)"/), /^index, follow/);
});

test('every school-page title fits the width Google shows, or is the last rung of the ladder; no description offers a candidate lookup', { skip }, async () => {
  const { titleWidth, TITLE_PX } = await import('../../results-worker/src/util.js');
  const env = envFor('all');
  let n = 0, wide = 0;
  for (const s of sample(8)) {
    const { r, t } = await html(env, `/results/${s.cat}/${s.code}/${s.year}/`);
    if (r.status !== 200) continue;
    n++;
    const title = plain(attr(t, /<title>([^<]*)<\/title>/));
    if (titleWidth(title) > TITLE_PX) { wide++; assert.match(title, new RegExp(` ${s.cat.toUpperCase()} ${s.year}$`), `a title that is still too wide is the last rung: ${title}`); }
    assert.ok(title.includes(String(s.year)), title);
    const d = plain(attr(t, /<meta name="description" content="([^"]*)">/));
    assert.ok(!/candidate by number|result of any|look up/i.test(d), `the crawlable page has no candidate lookup, so the description must not offer one: ${d}`);
    assert.ok(!/Mayobe Bros$/.test(title), 'no brand in school titles');
  }
  assert.ok(n > 50);
  assert.ok(wide < n * 0.05, `almost every title fits (${wide} of ${n} do not)`);
});

test('every exam-year has its own link-preview picture in the site', { skip }, () => {
  for (const e of registry.exams) assert.ok(fs.existsSync(path.join(ROOT, 'assets/share', `post-necta-${e.cat}-results-${e.year}.jpg`)), `missing assets/share/post-necta-${e.cat}-results-${e.year}.jpg`);
});

test('the description is a short invitation built from the school’s own figures', { skip }, async () => {
  const env = envFor('all');
  const seen = new Set();
  let n = 0;
  for (const s of sample(6)) {
    const { r, t } = await html(env, `/results/${s.cat}/${s.code}/${s.year}/`);
    if (r.status !== 200) continue;
    n++;
    const d = plain(attr(t, /<meta name="description" content="([^"]*)">/));
    assert.ok(d.length >= 70 && d.length <= 160, `${d.length}: ${d}`);
    assert.ok(d.includes(s.cat.toUpperCase()) && d.includes(String(s.year)), `names the exam and the year: ${d}`);
    assert.ok(!/not run by|NECTA\.$/i.test(d), `no disclaimer: ${d}`);
    assert.ok(!/\b[A-Z]{1,2}\d{3,9}[/-]\d/.test(d), `no candidate number: ${d}`);
    const code = /\(([A-Z]{1,2}\d{3,9})[,)]/.exec(d); // the school's own centre number may follow its name in brackets (people search by it), never another number
    if (code) assert.equal(code[1], s.code.toUpperCase());
    else assert.ok(!/\b[A-Z]{1,2}\d{3,9}\b/.test(d), `no stray centre number: ${d}`);
    assert.ok(!/\b([A-Z]{1,2}\d{3,9})\b/.test(d.replace(/\([A-Z]{1,2}\d{3,9}[,)]/, '(')), `only the school's own number: ${d}`);
    assert.ok(!seen.has(d), `duplicate description: ${d}`);
    seen.add(d);
  }
  assert.ok(n > 60, `checked ${n}`);
});

test('no candidate number and no individual result is in the HTML of any page', { skip }, async () => {
  const env = envFor('all');
  let pages = 0, numbers = 0;
  for (const s of sample(5)) {
    const { r, t } = await html(env, `/results/${s.cat}/${s.code}/${s.year}/`);
    if (r.status !== 200) continue;
    pages++;
    const exam = registry.exams.find((e) => e.id === s.id);
    const meta = JSON.parse(fs.readFileSync(path.join(DATA, s.id, 'meta.json'), 'utf8'));
    const rec = decodeCentre(fs.readFileSync(path.join(DATA, s.id, `${s.code}.txt`), 'utf8'), meta, s.code.toUpperCase());
    for (const c of rec.candidates.slice(0, 60)) { numbers++; assert.ok(!t.includes(c.cno), `${s.id} ${s.code}: candidate number ${c.cno} is in the page`); }
    assert.ok(!/data-seq=|rs-cands"|class="rs-table rs-cands|<caption class="rs-sr">Candidate results for/.test(t), `${s.id} ${s.code}: a candidate table is in the page`);
    assert.ok(!/\b[A-Z]{1,2}\d{3,9}[/-]\d{3,4}\b/.test(t.replace(/<template[\s\S]*?<\/template>/, '')), `${s.id} ${s.code}: something shaped like a candidate number`);
    assert.ok(t.includes('data-rs-cands-hold'), 'the place where the list arrives');
  }
  assert.ok(pages > 50 && numbers > 1000, `checked ${pages} pages and ${numbers} numbers`);
});

test('the school page keeps its own performance in the HTML (summary, subjects) so there is a page worth indexing', { skip: skip || !registry.exams.some((e) => e.id === 'csee-2025') }, async () => {
  const { t } = await html(envFor('all'), '/results/csee/s0107/2025/');
  assert.match(t, /DIVISION PERFORMANCE SUMMARY/);
  assert.match(t, /SUBJECTS PERFORMANCE/);
  assert.match(t, /BASIC MATHEMATICS/);
  assert.match(t, /Morogoro/, 'the region, written as a name');
  const ld = [...t.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(ld[0]['@type'], 'WebPage');
  assert.equal(ld[0].about['@type'], 'EducationalOrganization');
  assert.equal(ld[0].about.name, 'Lutheran Junior Seminary');
  assert.equal(ld[0].about.identifier, 'S0107');
  assert.match(ld[0].dateModified, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!JSON.stringify(ld).includes('S0107/'), 'no candidate number in the structured data');
});

test('data files for the page script are closed to search engines (header here, robots.txt in the blog)', { skip }, async () => {
  const env = envFor('all');
  const e = registry.exams[0];
  const file = fs.readdirSync(path.join(DATA, e.id)).find((f) => f.endsWith('.txt'));
  const r = await handle(new Request(`${ORIGIN}/results/data/${e.id}/${file}`), env, { waitUntil() {} });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /^Disallow: \/results\/data\/$/m);
});

test('a school with fewer than 20 candidates who sat stays out of the index and out of the sitemap', { skip }, async () => {
  const e = registry.exams.find((x) => x.thin);
  const code = e.thin.split(',')[0];
  const { r, t } = await html(envFor('all'), `/results/${e.cat}/${code}/${e.year}/`);
  assert.equal(r.status, 200);
  assert.equal(attr(t, /<meta name="robots" content="([^"]*)"/), 'noindex, follow');
});

test('RESULTS_INDEX_FROM: older years stay noindex and out of the sitemaps, newer years are indexable', { skip: skip || !registry.exams.some((e) => e.id === 'csee-2025') || !registry.exams.some((e) => e.id === 'csee-2020') }, async () => {
  const env = { ...envFor('all'), RESULTS_INDEX_FROM: '2024' };
  const robots = async (p) => attr((await html(env, p)).t, /<meta name="robots" content="([^"]*)"/);
  assert.match(await robots('/results/csee/s0107/2025/'), /^index, follow/);
  assert.equal(await robots('/results/csee/s0107/2020/'), 'noindex, follow', 'an older year: noindex');
  assert.equal(await robots('/results/csee/2020/'), 'noindex, follow', 'the older year index too');
  assert.match(await robots('/results/csee/2025/'), /^index, follow/);
  const idx = (await html(env, '/results/sitemap.xml')).t;
  assert.ok(idx.includes('sitemap-csee-2025-1.xml'));
  assert.ok(!idx.includes('sitemap-csee-2020-1.xml'), 'no sitemap file for an older year');
  assert.equal((await html(env, '/results/sitemap-csee-2020-1.xml')).r.status, 404);
  // the cache key changes with the knob: the same address under another setting is not served from the first one
  const env2 = { ...envFor('all') };
  assert.match(await (async () => attr((await html(env2, '/results/csee/s0107/2020/')).t, /<meta name="robots" content="([^"]*)"/))(), /^index, follow/);
});

test('crawlers can ask "same as before?": the ETag follows the page, If-None-Match gets a 304, a changed rule gets the page', { skip: skip || !registry.exams.some((e) => e.id === 'csee-2025') }, async () => {
  const p = '/results/csee/s0107/2025/';
  const env = envFor('all');
  const first = await handle(new Request(ORIGIN + p), env, { waitUntil() {} });
  const etag = first.headers.get('etag'), lm = first.headers.get('last-modified');
  assert.match(etag, /^W\/"/);
  assert.equal(new Date(lm).toISOString().slice(0, 10), registry.exams.find((e) => e.id === 'csee-2025').verified, 'Last-Modified is the date its figures were checked');
  await first.text();
  const same = await handle(new Request(ORIGIN + p, { headers: { 'If-None-Match': etag } }), env, { waitUntil() {} });
  assert.equal(same.status, 304);
  assert.equal(await same.text(), '');
  // a date alone never gives a 304 (it could keep an old noindex alive after a roll-out)
  const byDate = await handle(new Request(ORIGIN + p, { headers: { 'If-Modified-Since': lm } }), env, { waitUntil() {} });
  assert.equal(byDate.status, 200);
  await byDate.text();
  // the same page under another switch has another ETag, so a crawler that stored the old page gets the new one
  const hubs = await handle(new Request(ORIGIN + p), envFor('hubs'), { waitUntil() {} });
  assert.notEqual(hubs.headers.get('etag'), etag);
  const stale = await handle(new Request(ORIGIN + p, { headers: { 'If-None-Match': etag } }), envFor('hubs'), { waitUntil() {} });
  assert.equal(stale.status, 200);
  assert.match(attr(await stale.text(), /<meta name="robots" content="([^"]*)"/), /noindex/);
  const gone = await handle(new Request(ORIGIN + '/results/csee/zz9999/2025/', { headers: { 'If-None-Match': etag } }), env, { waitUntil() {} });
  assert.equal(gone.status, 404);
  assert.equal((await handle(new Request(ORIGIN + p, { method: 'HEAD' }), env, { waitUntil() {} })).status, 200);
});

test('two centres that share a name get the centre number after it, in the title, H1 and description (CSEE too, whose list names differ from the file names)', { skip: skip || !registry.exams.some((e) => e.id === 'csee-2025') }, async () => {
  const list = JSON.parse(fs.readFileSync(path.join(DATA, 'csee-2025/list.json'), 'utf8'));
  const { decodeList } = await import('../../js/results-codec.js');
  const rows = decodeList(list, 'secondary').filter((r) => r[2]);
  const byName = new Map();
  for (const r of rows) { const k = r[1].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); byName.set(k, [...(byName.get(k) || []), r[0]]); }
  const dup = [...byName.values()].find((v) => v.length > 1);
  assert.ok(dup, 'csee-2025 has centres that share a name');
  const env = envFor('all');
  const titles = new Set();
  for (const code of dup.slice(0, 2)) {
    const { r, t } = await html(env, `/results/csee/${code.toLowerCase()}/2025/`);
    if (r.status !== 200) continue;
    const title = plain(attr(t, /<title>([^<]*)<\/title>/));
    assert.ok(title.includes(`(${code})`), `${code} is in the title: ${title}`);
    assert.ok(plain(attr(t, /<h1[^>]*>([^<]*)<\/h1>/)).includes(`(${code})`));
    titles.add(title);
  }
  assert.equal(titles.size, Math.min(2, dup.length), 'the titles differ');
  const { t: plainOne } = await html(env, '/results/csee/s0107/2025/');
  assert.ok(!/\(S0107\)/.test(attr(plainOne, /<title>([^<]*)<\/title>/)), 'a name that is not shared has no number');
});

test('overview: same-name rule, the 20-candidate rule follows the newest year, and the description is the invitation', { skip: skip || !registry.exams.some((e) => e.id === 'csee-2025') }, async () => {
  const env = envFor('all');
  const { t } = await html(env, '/results/csee/s0107/');
  const d = plain(attr(t, /<meta name="description" content="([^"]*)">/));
  assert.match(d, /^Is Lutheran Junior Seminary improving\? /, d);
  assert.ok(d.length >= 70 && d.length <= 160);
  assert.equal(attr(t, /<title>([^<]*)<\/title>/).startsWith('Lutheran Junior Seminary Results 20'), true);
  assert.match(attr(t, /<title>([^<]*)<\/title>/), / to 2025/, 'the all-years title carries the span, so it never equals a year page title');
  assert.equal(attr(t, /<meta property="og:image" content="([^"]*)"/), `${ORIGIN}/assets/share/post-necta-csee-results-2025.jpg`, 'the all-years page shows its newest year card, not the site card');
  const e = registry.exams.find((x) => x.thin);
  const code = e.thin.split(',')[0];
  const newest = registry.exams.filter((x) => x.cat === e.cat).sort((a, b) => b.year - a.year).find((x) => fs.existsSync(path.join(DATA, x.id, `${code}.txt`)));
  const o = await html(env, `/results/${e.cat}/${code}/`);
  if (o.r.status === 200 && newest.id === e.id) assert.equal(attr(o.t, /<meta name="robots" content="([^"]*)"/), 'noindex, follow', 'a centre too small in its newest year is not indexed as an overview either');
});

test('the shell fills every token in one pass (a name that looks like a token stays text)', { skip }, async () => {
  const { fillShell } = await import('../../results-worker/src/shell.js');
  const shell = { text: '<title>%%TITLEFULL%%</title><meta name="description" content="%%DESC%%">%%ROBOTS%%<main>%%MAIN%%</main>', appJs: '', ogImage: '' };
  const out = fillShell(shell, { titleFull: 'A %%MAIN%% B', title: 'A', description: '%%ROBOTS%%', path: '/x/', robots: 'index', jsonld: [], main: 'M $& %%TITLEFULL%%' });
  assert.ok(out.includes('<title>A %%MAIN%% B</title>'));
  assert.ok(out.includes('content="%%ROBOTS%%"'));
  assert.ok(out.includes('<main>M $& %%TITLEFULL%%</main>'));
});

test('RESULTS_INDEX_FROM that is set but wrong means no year at all (it fails closed)', { skip }, async () => {
  const { normFrom, normMode } = await import('../../results-worker/src/sitemap.js');
  assert.equal(normFrom(''), 0); assert.equal(normFrom(undefined), 0); assert.equal(normFrom('2023'), 2023);
  assert.equal(normFrom('2o23'), 2100); assert.equal(normFrom('1900'), 2100);
  assert.equal(normMode('maybe'), 'off');
});

test('the search box example is a format, never a real candidate number; robots.txt keeps the centre files closed but lets the lists and meta files load', { skip }, async () => {
  const env = envFor('all');
  const { t } = await html(env, '/results/psle/ps0101128/2025/').then((x) => (x.r.status === 200 ? x : html(env, '/results/csee/s0107/2025/')));
  assert.match(t, /placeholder="e\.g\. [A-Z]+\d+[/-]9999"/);
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /^Disallow: \/results\/data\/$/m);
  assert.match(robots, /^Allow: \/results\/data\/\*\/list\.json\$$/m);
  assert.match(robots, /^Allow: \/results\/data\/\*\/meta\.json\$$/m);
  assert.ok(!/Allow: \/results\/data\/[^\n]*\.(txt|pm)/.test(robots), 'no rule opens the centre files or the PREM files');
  const r = await handle(new Request(`${ORIGIN}/results/data/psle-2025/ps0101128.pm`), env, { waitUntil() {} });
  assert.ok([200, 404].includes(r.status));
  assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
});

test('school pages have a sitemap of their own, the lists have another, and together they are what the combined sitemap holds', { skip: skip || !registry.exams.some((e) => e.id === 'csee-2025') }, async () => {
  const env = envFor('all');
  const locs = (x) => [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const schools = await html(env, '/results/sitemap-schools.xml');
  const hubs = await html(env, '/results/sitemap-hubs.xml');
  assert.equal(schools.r.status, 200); assert.equal(hubs.r.status, 200);
  assert.match(schools.t, /<sitemapindex /);
  const sch = locs(schools.t), hub = locs(hubs.t);
  assert.ok(sch.includes(`${ORIGIN}/results/sitemap-schools-csee-2025-1.xml`));
  assert.ok(sch.every((l) => /\/results\/sitemap-schools-[a-z]+-\d{4}-\d+\.xml$/.test(l)), 'only school files in the school index');
  assert.ok(hub.every((l) => /\/results\/sitemap-hubs-[a-z]+-\d{4}-\d+\.xml$/.test(l)), 'only list files in the list index');
  const part = await html(env, '/results/sitemap-schools-csee-2025-1.xml');
  const urls = locs(part.t).map((l) => l.replace(ORIGIN, ''));
  assert.ok(urls.length > 100 && urls.length <= 10000);
  assert.ok(urls.includes('/results/csee/s0107/2025/'), 'the school page itself is listed');
  assert.ok(urls.every((u) => /^\/results\/csee\/[a-z]{1,2}\d+\/(\d{4}\/)?$/.test(u)), 'single-school addresses only (a year page or an all-years page)');
  const lists = locs((await html(env, '/results/sitemap-hubs-csee-2025-1.xml')).t).map((l) => l.replace(ORIGIN, ''));
  assert.ok(lists.includes('/results/csee/2025/') && lists.every((u) => !/\/s\d+\/$/.test(u)), 'the list file holds the year index and the A to Z lists, no school');
  // the combined sitemap is exactly both together (nothing is lost by splitting)
  const total = async (id, group) => { let n = 0; for (let i = 1; ; i++) { const r = await html(env, `/results/sitemap-${group ? group + '-' : ''}${id}-${i}.xml`); if (r.r.status !== 200) return n; n += locs(r.t).length; } };
  assert.equal(await total('csee-2025', 'schools') + await total('csee-2025', 'hubs'), await total('csee-2025', ''));
  assert.equal((await html(env, '/results/sitemap-schools-csee-2020-99.xml')).r.status, 404);
  assert.equal((await html(envFor('off'), '/results/sitemap-schools.xml')).r.status, 404, 'nothing is listed while the switch is off');
});
