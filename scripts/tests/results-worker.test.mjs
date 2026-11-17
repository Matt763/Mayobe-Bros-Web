// The results Worker (results-worker/): every URL form, redirects and 404s, robots by the RESULTS_INDEX switch, titles and descriptions,
// sitemaps, escaping, and a CPU guard. A folder (results-data/) stands in for the R2 bucket; the page frame is the built results-shell.html.
// Skipped when the data folder or the shell is not on this computer. Run `node scripts/build.mjs` first (it writes the shell).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, parse, robotsFor } from '../../results-worker/src/index.js';
import { resetMemory } from '../../results-worker/src/data.js';
import { resetShell } from '../../results-worker/src/shell.js';
import { urlsOf } from '../../results-worker/src/sitemap.js';
import { getRegistry } from '../../results-worker/src/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'results-data');
const SHELL = path.join(ROOT, 'results-shell.html');
const ready = fs.existsSync(path.join(DATA, 'registry.json')) && fs.existsSync(SHELL);
const skip = ready ? false : 'results-data/registry.json or results-shell.html is not on this computer';
const ORIGIN = 'https://mayobebros.com';

function bucket(patch) {
  return {
    async get(key) {
      const file = path.normalize(path.join(DATA, String(key)));
      if (!file.startsWith(DATA + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
      let text = fs.readFileSync(file, 'utf8');
      if (patch) text = patch(key, text);
      return { text: async () => text, httpEtag: '"t"' };
    },
    async head(key) { return (await this.get(key)) ? {} : null; },
  };
}
const shellText = ready ? fs.readFileSync(SHELL, 'utf8') : '';
function envFor(mode, patch) {
  resetMemory(); resetShell();
  return { RESULTS: bucket(patch), ORIGIN, RESULTS_INDEX: mode, FETCH_SHELL: async () => new Response(shellText, { status: 200 }) };
}
const call = async (env, p, method = 'GET') => handle(new Request(ORIGIN + p, { method }), env, { waitUntil() {} });
const html = async (env, p) => { const r = await call(env, p); return { r, t: await r.text() }; };
const metaRobots = (t) => (/<meta name="robots" content="([^"]*)">/.exec(t) || [])[1];
const attr = (t, re) => (re.exec(t) || [])[1];
const mainOf = (t) => t.slice(t.indexOf('<main id="main">'), t.indexOf('</main>'));
const registry = ready ? JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8')) : { exams: [] };
const exam = (id) => registry.exams.find((e) => e.id === id);

/** A deterministic sample of `n` centre pages (cat/code/year) across all exams. */
function sample(n) {
  const out = [];
  const per = Math.ceil(n / registry.exams.length);
  for (const e of registry.exams) {
    const files = fs.readdirSync(path.join(DATA, e.id)).filter((f) => f.endsWith('.txt')).sort();
    const step = Math.max(1, Math.floor(files.length / per));
    for (let i = 0; i < files.length && out.filter((o) => o.id === e.id).length < per; i += step) out.push({ id: e.id, cat: e.cat, year: e.year, code: files[i].slice(0, -4) });
  }
  return out;
}

test('parse: every address form', { skip }, () => {
  assert.equal(parse('/results/csee/p0101/2024/').type, 'year');
  assert.equal(parse('/results/CSEE/P0101/2024').canonical, '/results/csee/p0101/2024/');
  assert.equal(parse('/results/csee/p0101/2024/index.html').canonical, '/results/csee/p0101/2024/');
  assert.equal(parse('/results/csee/p0101/').type, 'overview');
  assert.equal(parse('/results/csee/2024/').type, 'yearindex');
  assert.equal(parse('/results/csee/2024/b/').type, 'list');
  assert.equal(parse('/results/csee/2024/other/3/').page, 3);
  assert.equal(parse('/results/csee/2024/b/1/').canonical, '/results/csee/2024/b/');
  assert.equal(parse('/results/psle/2023/region/dar-es-salaam/').type, 'region');
  assert.equal(parse('/results/psle/2023/district/dar-es-salaam-ilala/2/').page, 2);
  assert.equal(parse('/results/csee/2024/region/x/'), null);
  assert.equal(parse('/results/csee/p0101/2024/extra/'), null);
  assert.equal(parse('/results/csee/p0101/20x4/'), null);
  assert.equal(parse('/results/unknown/p0101/'), null);
  assert.equal(parse('/other/'), null);
  assert.equal(parse('/results/csee/..%2f/'), null);
});

test('pages, redirects and 404s', { skip }, async () => {
  const env = envFor('all');
  let { r, t } = await html(env, '/results/csee/p0101/2024/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('cache-control'), /s-maxage=2592000/);
  assert.match(t, /<h1 class="rs-h1"/);
  assert.equal((t.match(/<h1\b/g) || []).length, 1);
  assert.ok(t.includes('data-rs-static'));
  assert.ok(t.includes('<template data-rs-tpl>'));
  assert.ok(t.includes('https://onlinesys.necta.go.tz/'), 'source link');
  assert.ok(t.includes('/contact/'), 'correction link');
  assert.match(t, /independent site/);
  assert.ok(/<script type="module" src="\/js\/results-app\.js/.test(t), 'the app script is on year pages');
  assert.ok(!t.includes('%%'), 'no token left');
  assert.ok(!t.includes('<!--app-js'), 'the shell note is removed');
  for (const [from, to, code] of [['/results/csee/P0101/2024/', '/results/csee/p0101/2024/', 301], ['/results/csee/p0101/2024', '/results/csee/p0101/2024/', 301], ['/results/csee/p0101', '/results/csee/p0101/', 301], ['/results/csee/2024/b/1/', '/results/csee/2024/b/', 301], ['/results/', '/category/educational/results/', 302], ['/results/CSEE/2024/B', '/results/csee/2024/b/', 301]]) {
    r = await call(env, from);
    assert.equal(r.status, code, from);
    assert.equal(r.headers.get('location'), to, from);
  }
  for (const p of ['/results/csee/p0101/1999/', '/results/csee/zz9999/2024/', '/results/csee/p0101/2024/x/', '/results/csee/2024/zz/', '/results/csee/2024/b/9999/', '/results/psle/2023/region/nowhere/', '/results/csee/2024/region/x/', '/results/nothing/', '/results/csee/zz9999/']) {
    ({ r, t } = await html(env, p));
    assert.equal(r.status, 404, p);
    assert.equal(metaRobots(t), 'noindex, nofollow', p);
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
    assert.ok(t.includes('<header') && t.includes('<footer'), '404 has the site frame: ' + p);
  }
  assert.equal((await call(env, '/results/csee/p0101/2024/', 'POST')).status, 405);
  assert.equal((await call(env, '/results/csee/p0101/2024/', 'HEAD')).status, 200);
});

test('overview, year index, A to Z with crawlable pager', { skip }, async () => {
  const env = envFor('all');
  let { r, t } = await html(env, '/results/csee/p0101/');
  assert.equal(r.status, 200);
  assert.ok(t.includes('/results/csee/p0101/2024/'));
  assert.ok(!/<script type="module" src="\/js\/results-app/.test(t), 'no app script on plain pages');
  ({ r, t } = await html(env, '/results/csee/2024/'));
  assert.equal(r.status, 200);
  ({ r, t } = await html(env, '/results/csee/2024/s/'));
  assert.equal(r.status, 200);
  assert.ok(t.includes('rel="next"'), 'page 1 links to page 2');
  assert.ok(t.includes('/results/csee/2024/s/2/'));
  ({ r, t } = await html(env, '/results/csee/2024/s/2/'));
  assert.equal(r.status, 200);
  assert.ok(t.includes('rel="prev"') && t.includes('/results/csee/2024/s/"') || t.includes('href="/results/csee/2024/s/"'));
  assert.ok(t.includes('/results/csee/2024/s/3/'));
  const rows = (t.match(/class="rs-row"/g) || []).length;
  assert.ok(rows > 0 && rows <= 200);
  assert.equal(attr(t, /<link rel="canonical" href="([^"]*)"/), ORIGIN + '/results/csee/2024/s/2/');
});

test('PSLE region and district hubs', { skip: skip || !exam('psle-2023') }, async () => {
  const env = envFor('all');
  let { r, t } = await html(env, '/results/psle/2023/');
  assert.equal(r.status, 200);
  const region = attr(t, /href="(\/results\/psle\/2023\/region\/[^"]+)"/);
  assert.ok(region, 'region links on the year index');
  ({ r, t } = await html(env, region));
  assert.equal(r.status, 200);
  const district = attr(t, /href="(\/results\/psle\/2023\/district\/[^"]+)"/);
  assert.ok(district);
  ({ r, t } = await html(env, district));
  assert.equal(r.status, 200);
  const school = attr(t, /class="rs-row" href="(\/results\/psle\/[^"]+)"/);
  assert.ok(school, 'schools link to their year page');
  ({ r, t } = await html(env, school));
  assert.equal(r.status, 200);
  assert.ok(/Average|grade/i.test(t));
});

test('robots follow the switch and the quality bar', { skip }, async () => {
  const thin = registry.exams.find((e) => e.thin);
  const thinCode = thin.thin.split(',')[0];
  const good = sample(20).find((s) => !registry.exams.find((e) => e.id === s.id).thin.split(',').includes(s.code));
  const urls = { year: `/results/${good.cat}/${good.code}/${good.year}/`, thinYear: `/results/${thin.cat}/${thinCode}/${thin.year}/`, overview: `/results/${good.cat}/${good.code}/`, list: '/results/csee/2024/a/', index: '/results/csee/2024/' };
  const want = {
    off: { year: 'noindex, nofollow', thinYear: 'noindex, nofollow', overview: 'noindex, nofollow', list: 'noindex, nofollow', index: 'noindex, nofollow' },
    hubs: { year: 'noindex, follow', thinYear: 'noindex, follow', overview: 'index', list: 'index', index: 'index' },
    all: { year: 'index', thinYear: 'noindex, follow', overview: 'index', list: 'index', index: 'index' },
  };
  for (const mode of ['off', 'hubs', 'all']) {
    const env = envFor(mode);
    for (const [k, p] of Object.entries(urls)) {
      const { r, t } = await html(env, p);
      assert.equal(r.status, 200, `${mode} ${p}`);
      const m = metaRobots(t), h = r.headers.get('x-robots-tag');
      if (want[mode][k] === 'index') {
        assert.match(m, /^index, follow/, `${mode} ${k}`);
        assert.equal(h, null, `${mode} ${k}: no noindex header`);
      } else {
        assert.equal(m, want[mode][k], `${mode} ${k}`);
        assert.equal(h, want[mode][k], `${mode} ${k} header`);
      }
    }
  }
  assert.equal(robotsFor('off', 'list', true), 'noindex, nofollow');
  assert.equal(robotsFor('all', 'year', false), 'noindex, follow');
  assert.equal(robotsFor('bogus', 'list', true), 'noindex, nofollow', 'an unknown value means off');
});

test('titles and descriptions: unique, within length, canonical self-referencing', { skip }, async () => {
  const env = envFor('all');
  const picks = sample(300);
  const urls = [];
  for (const p of picks) urls.push(`/results/${p.cat}/${p.code}/${p.year}/`);
  for (const p of picks.slice(0, 60)) urls.push(`/results/${p.cat}/${p.code}/`);
  for (const e of registry.exams) { urls.push(`/results/${e.cat}/${e.year}/`); for (const L of 'abcdefghijklmnopqrstuvwxyz') urls.push(`/results/${e.cat}/${e.year}/${L}/`); }
  const titles = new Map(), descs = new Map();
  let checked = 0;
  for (const p of [...new Set(urls)]) {
    const { r, t } = await html(env, p);
    if (r.status === 404) continue; // a letter with no centres
    assert.equal(r.status, 200, p);
    checked++;
    const plain = (x) => x.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const title = plain(attr(t, /<title>([^<]*)<\/title>/));
    const desc = plain(attr(t, /<meta name="description" content="([^"]*)">/));
    assert.ok(title.length >= 10 && title.length <= 100, `title length ${title.length}: ${title}`);
    assert.ok(desc.length >= 70 && desc.length <= 160, `description length ${desc.length} (${p}): ${desc}`);
    assert.ok(!titles.has(title), `duplicate title ${title} (${p} and ${titles.get(title)})`);
    assert.ok(!descs.has(desc), `duplicate description (${p} and ${descs.get(desc)})`);
    titles.set(title, p); descs.set(desc, p);
    assert.equal(attr(t, /<link rel="canonical" href="([^"]*)"/), ORIGIN + p, 'canonical');
    assert.equal(attr(t, /<meta property="og:url" content="([^"]*)"/), ORIGIN + p);
    assert.equal(plain(attr(t, /<meta property="og:title" content="([^"]*)"/)), title.replace(/ \| Mayobe Bros$/, ''));
    // JSON-LD: valid JSON, only WebPage and BreadcrumbList
    const ld = [...t.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(ld.map((x) => x['@type']), ['WebPage', 'BreadcrumbList'], p);
    // the page text: no inline style, no inline script or handler
    const main = mainOf(t);
    assert.ok(!/\sstyle=/i.test(main), 'style attribute in ' + p);
    assert.ok(!/<script/i.test(main), 'script in main ' + p);
    assert.ok(!/\son[a-z]+=/i.test(main), 'handler in ' + p);
    assert.equal((main.match(/<h1\b/g) || []).length, 1, 'one h1 ' + p);
  }
  assert.ok(checked > 300, `checked ${checked} pages`);
});

test('every link from a sampled year page resolves', { skip }, async () => {
  const env = envFor('all');
  for (const p of sample(40)) {
    const { t } = await html(env, `/results/${p.cat}/${p.code}/${p.year}/`);
    const links = [...mainOf(t).matchAll(/href="(\/results\/[^"]*)"/g)].map((m) => m[1]);
    assert.ok(links.length >= 2);
    for (const l of new Set(links)) assert.equal((await call(env, l)).status, 200, `${l} from ${p.code}`);
  }
});

test('hostile centre names are escaped everywhere', { skip }, async () => {
  const evil = '<img src=x onerror=alert(1)>"&\'</title><script>alert(2)</script>';
  const env = envFor('all', (key, text) => (key === 'csee-2024/p0101.txt' ? text.replace(/^([^;]*;)([0-9]+:)[^;]*;/, `$1$2${evil.replace(/;/g, '')};`) : text));
  const { t } = await html(env, '/results/csee/p0101/2024/');
  assert.ok(!t.toLowerCase().includes('<img src=x'), 'raw tag');
  assert.ok(!t.includes('<script>alert'), 'raw script');
  assert.ok(t.toLowerCase().includes('&lt;img src=x'), 'escaped, whatever the case the title-casing gave it');
  const ld = [...t.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => m[1]);
  for (const j of ld) { JSON.parse(j); assert.ok(!j.includes('<')); }
  const { t: o } = await html(env, '/results/csee/p0101/');
  assert.ok(!o.includes('<img src=x'));
});

test('sitemaps: limits, and the URL set is the indexable set', { skip }, async () => {
  const env = envFor('all');
  let { r, t } = await html(env, '/results/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /xml/);
  const parts = [...t.matchAll(/<loc>([^<]*)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)].map((m) => m[1].replace(ORIGIN, ''));
  assert.ok(parts.length >= registry.exams.length);
  const all = new Set();
  for (const p of parts) {
    ({ r, t } = await html(env, p));
    assert.equal(r.status, 200, p);
    const locs = [...t.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length > 0 && locs.length <= 10000, `${p}: ${locs.length}`);
    assert.ok(Buffer.byteLength(t) < 50 * 1024 * 1024);
    for (const l of locs) { assert.ok(l.startsWith(ORIGIN + '/results/'), l); assert.ok(!all.has(l), 'listed twice: ' + l); all.add(l); }
  }
  // no thin year page is listed; every sampled listed page is indexable; every sampled unlisted year page is not
  for (const e of registry.exams) for (const c of e.thin.split(',').filter(Boolean).slice(0, 5)) assert.ok(!all.has(`${ORIGIN}/results/${e.cat}/${c}/${e.year}/`), `thin page listed: ${c}`);
  const listed = [...all];
  for (let i = 0; i < listed.length; i += Math.ceil(listed.length / 120)) {
    const { r: rr, t: tt } = await html(env, listed[i].replace(ORIGIN, ''));
    assert.equal(rr.status, 200, listed[i]);
    assert.match(metaRobots(tt), /^index, follow/, listed[i]);
  }
  for (const p of sample(120)) {
    const u = `${ORIGIN}/results/${p.cat}/${p.code}/${p.year}/`;
    const { t: tt } = await html(env, u.replace(ORIGIN, ''));
    assert.equal(/^index/.test(metaRobots(tt)), all.has(u), `${u}: robots and sitemap agree`);
  }
  // an overview is listed once
  const ov = listed.filter((l) => /\/results\/[a-z]+\/[a-z]{1,2}\d+\/$/.test(l));
  assert.equal(new Set(ov).size, ov.length);
  // the set from urlsOf is what the parts hold
  const reg = await getRegistry(env);
  let n = 0;
  for (const e of reg.exams) n += (await urlsOf(env, reg, e, 'all')).length;
  assert.equal(n, all.size);
  // hubs mode lists no year page; off lists nothing
  const envH = envFor('hubs');
  const regH = await getRegistry(envH);
  for (const e of regH.exams) assert.ok(!(await urlsOf(envH, regH, e, 'hubs')).some((u) => /\/\d{4}\/$/.test(u) && /\/[a-z]{1,2}\d{3,9}\/\d{4}\/$/.test(u)));
  const envO = envFor('off');
  assert.equal((await call(envO, '/results/sitemap.xml')).status, 404);
  assert.equal((await call(envO, '/results/sitemap-csee-2024-1.xml')).status, 404);
  const regO = await getRegistry(envO);
  assert.equal((await urlsOf(envO, regO, regO.exams[0], 'off')).length, 0);
  assert.equal((await call(env, '/results/sitemap-csee-2024-99.xml')).status, 404);
});

test('data files are served from the Worker route', { skip }, async () => {
  const env = envFor('off');
  let r = await call(env, '/results/data/csee-2024/p0101.txt');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), fs.readFileSync(path.join(DATA, 'csee-2024/p0101.txt'), 'utf8'));
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await call(env, '/results/data/csee-2024/meta.json')).status, 200);
  assert.equal((await call(env, '/results/data/registry.json')).status, 200);
  for (const p of ['/results/data/..%2fsite.config.json', '/results/data/csee-2024/../../site.config.json', '/results/data/csee-2024/nothing.txt', '/results/data/other/meta.json', '/results/data/csee-2024/p0101.txt.bak']) assert.equal((await call(env, p)).status, 404, p);
});

test('CPU guard: the largest centre renders fast', { skip: skip || !fs.existsSync(path.join(DATA, 'csee-2024/s2476.txt')) }, async () => {
  const env = envFor('all');
  const p = '/results/csee/s2476/2024/';
  const first = await html(env, p); // warm: registry, meta, shell
  assert.equal(first.r.status, 200);
  assert.equal((first.t.match(/<tr role="row" data-seq/g) || []).length, 0, 'no candidate row is in the page (the list arrives by script)');
  assert.ok(first.t.length < 120 * 1024, `the page is small: ${first.t.length} bytes`);
  const N = 30;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) await call(env, p);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`# render of csee-2024 s2476 (929 candidates): ${ms.toFixed(1)} ms average over ${N} runs, ${(first.t.length / 1024).toFixed(0)} KB of HTML`);
  assert.ok(ms < 40, `rendering took ${ms} ms`); // generous: shared CI machines; the real figure is printed above
});

test('the blog side: shell tokens, robots.txt, and nothing links to the Worker while the switch is off', { skip: skip || false }, () => {
  for (const t of ['%%TITLEFULL%%', '%%TITLE%%', '%%DESC%%', '%%PATH%%', '%%ROBOTS%%', '%%JSONLD%%', '%%APPJS%%', '%%MAIN%%', '%%OGIMG%%']) assert.ok(shellText.includes(t), t);
  assert.match(shellText, /<!--og-image:https:\/\/[^>]*\/assets\/share\/site\.jpg[^>]*-->/, 'the default picture is kept for pages with no card of their own');
  assert.ok(shellText.includes('<!--app-js:<script type="module" src="/js/results-app.js'), 'the app script tag is kept for the Worker');
  assert.ok(!/<meta name="robots"/.test(shellText), 'the Worker writes the robots tag');
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /Disallow: \/results-shell\.html/);
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  assert.ok(['off', 'hubs', 'all'].includes(config.resultsData.index));
  assert.equal(typeof config.resultsData.pages, 'boolean');
  // a sitemap index may not list another index, so the root sitemap never lists the Worker's; robots.txt names it when the pages may be indexed
  assert.ok(!fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').includes('/results/sitemap.xml'), 'the root sitemap does not list the Worker sitemap');
  const live = config.resultsData.pages && config.resultsData.index !== 'off';
  assert.equal(robots.includes('Sitemap: https://mayobebros.com/results/sitemap-schools.xml'), !!live, 'robots.txt names the school sitemap exactly when its pages may be indexed');
  assert.equal(robots.includes('Sitemap: https://mayobebros.com/results/sitemap-hubs.xml'), !!live, 'robots.txt names the list sitemap exactly when its pages may be indexed');
  assert.ok(!robots.includes('Sitemap: https://mayobebros.com/results/sitemap.xml'), 'the combined Worker sitemap repeats the two others and is not named');
  if (!config.resultsData.pages) {
    const post = fs.readFileSync(path.join(ROOT, 'post/educational/results/necta-csee-results-2024/index.html'), 'utf8');
    assert.ok(!post.includes('data-pages') && !post.includes('rs-browse'), 'no links to the Worker pages while "pages" is false');
  }
  for (const f of ['sitemap.xml', 'feed.xml', 'data/search.json']) assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('results-shell'), `${f} does not mention the shell`);
});

/* ------------------------------------------------------------------ every exam family reads right */
const FAMILIES = [
  // id, centre, unit, header cells, must appear, must not appear, pass wording
  { id: 'csee-2024', code: 's3763', unit: 'centre', head: ['CNO', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'], has: [/divisions I to IV/, /DIVISION PERFORMANCE SUMMARY/], not: [/schools?\b.*PSLE/] },
  { id: 'csee-2014', code: 'p0104', unit: 'centre', head: ['CNO', 'SEX', 'GPA', 'CLASS', 'DETAILED SUBJECTS'], has: [/DISTINCTION, MERIT, CREDIT or PASS/, /CLASS SUMMARY/], not: [/divisions I to IV/, /DIVISION PERFORMANCE/, />AGGT</] },
  { id: 'acsee-2015', code: 's1032', unit: 'centre', head: ['CNO', 'SEX', 'GPA', 'CLASS', 'DETAILED SUBJECTS'], has: [/CLASS SUMMARY/], not: [/divisions I to IV/, />AGGT</] },
  { id: 'ftna-2025', code: 's2360', unit: 'centre', head: ['CNO', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'], has: [/divisions I to IV/, /REFERRED/, /not counted as passed/], not: [/\bcolleges?\b/] },
  { id: 'dsee-2024', code: 'e0588', unit: 'college', head: ['CNO', 'SEX', 'GPA', 'RESULT', 'DETAILED SUBJECTS'], has: [/DISTINCTION, CREDIT or PASS/, /RESULT SUMMARY/, /SUPP/], not: [/divisions I to IV/, /DIVISION PERFORMANCE/, /[ >]centres?[ .<s]/, />AGGT</] },
  { id: 'qt-2023', code: 'm1645', unit: 'centre', head: ['CNO', 'SEX', 'RESULT'], has: [/PASSED/, /FAILED/, /no subject grades/, /sat the test/], not: [/divisions I to IV/, /DETAILED SUBJECTS/, /AGGT/, />GPA</] },
  { id: 'sfna-2025', code: 'ps0101128', unit: 'school', head: ['CAND. NO', 'SEX', 'AVERAGE GRADE', 'SUBJECTS'], has: [/average grade A, B or C/, /MADARAJA YA UFAULU WA UJUMLA/, /lang="sw"/, /not counted as graded/], not: [/Avarage/i, /[ >]centres?[ .<s]/, /AGGT/] },
  { id: 'psle-2023', code: 'ps1903060', unit: 'school', head: ['CAND. NO', 'SEX', 'AVERAGE GRADE', 'SUBJECTS'], has: [/average grade A, B or C/, /lang="sw"/], not: [/Avarage/i, /[ >]centres?[ .<s]/, /AGGT/, /divisions I to IV/] },
];

test('every exam family: unit word, column headers, result words and pass wording', { skip: skip || !FAMILIES.every((f) => exam(f.id)) }, async () => {
  const env = envFor('all');
  for (const f of FAMILIES) {
    const cat = f.id.split('-')[0], year = f.id.split('-')[1];
    const p = `/results/${cat}/${f.code}/${year}/`;
    const { r, t } = await html(env, p);
    assert.equal(r.status, 200, p);
    const m = mainOf(t).replace(/<template[\s\S]*?<\/template>/g, '');
    assert.ok(!/<table class="rs-table rs-cands"/.test(m), `${f.id}: no candidate table in the HTML`);
    assert.ok(m.includes('data-rs-cands-hold'), `${f.id}: the place for the list`);
    const title = attr(t, /<title>([^<]*)<\/title>/), desc = attr(t, /<meta name="description" content="([^"]*)">/);
    for (const re of f.has) assert.match(m, re, `${f.id}: ${re}`);
    for (const re of f.not) assert.doesNotMatch(m, re, `${f.id}: ${re}`);
    assert.match(m, new RegExp(`Search all ${cat.toUpperCase()} ${year} ${f.unit}s`), `${f.id} unit word in links`);
    // percentages in the title, description and hero come from one calculation
    const pct = (/(\d+)% of/.exec(desc) || [])[1];
    assert.ok(pct, `${f.id}: the description carries the share`);
    assert.ok(m.includes(`<dd>${pct}%</dd>`), `${f.id}: hero share ${pct}% matches the description`);
    assert.doesNotMatch(title + desc, /best school|ranking|top \d/i);
  }
});

test('pass counts follow the family (what is not a pass is not counted)', { skip: skip || !exam('ftna-2025') || !exam('dsee-2024') || !exam('qt-2023') || !exam('sfna-2025') }, async () => {
  const env = envFor('all');
  const share = async (p) => { const { t } = await html(env, p); return /<dt>(?:<span class="rs-stat-ico"[^>]*>[\s\S]*?<\/span>)?(?:<span class="rs-stat-label">)?(?:Passed|In divisions I to IV|Grade A to C)(?:<\/span>)?<\/dt><dd>(\d+)%<\/dd>/.exec(t)[1]; };
  assert.equal(await share('/results/ftna/s2360/2025/'), '91'); // 143 in divisions I to IV of 158 who sat; 15 REFERRED are not passes
  assert.equal(await share('/results/dsee/e0588/2024/'), '88'); // DISTINCTION, CREDIT, PASS = 35 of 40; SUPP is not a pass
  assert.equal(await share('/results/qt/m1645/2023/'), '67'); // 6 PASSED of 9 who sat; 5 ABSENT
  assert.equal(await share('/results/sfna/ps0101128/2025/'), '100');
  const { t } = await html(env, '/results/ftna/s2360/2025/');
  assert.match(t, /158 sat/); assert.match(t, /143 \(91%\)/);
});

test('overview: years that read differently get tables of their own', { skip: skip || !exam('csee-2014') }, async () => {
  const env = envFor('all');
  const { r, t } = await html(env, '/results/csee/p0104/');
  assert.equal(r.status, 200);
  const tables = mainOf(t).match(/<table class="rs-table rs-years-table"/g) || [];
  assert.ok(tables.length >= 2, `years that read differently (classes in 2014, divisions later, older layouts) get their own tables, found ${tables.length}`);
  assert.match(t, /DISTINCTION/); assert.match(t, /<th scope="col" class="rs-c">IV<\/th>/);
  const dsee = await html(env, '/results/dsee/e0588/');
  assert.equal((mainOf(dsee.t).match(/<table class="rs-table rs-years-table"/g) || []).length, 1);
  assert.doesNotMatch(mainOf(dsee.t), /divisions I to IV/);
});

test('region and district hubs: PSLE and SFNA, with addresses that never collide', { skip: skip || !exam('sfna-2025') || !exam('psle-2025') }, async () => {
  assert.equal(parse('/results/sfna/2025/region/arusha/').type, 'region');
  assert.equal(parse('/results/sfna/2025/region/arusha/').cat, 'sfna');
  assert.equal(parse('/results/psle/2025/district/arusha-arusha/2/').cat, 'psle');
  assert.equal(parse('/results/ftna/2025/region/arusha/'), null, 'secondary exams have no hubs');
  const env = envFor('all');
  let { r, t } = await html(env, '/results/sfna/2025/');
  const region = attr(t, /href="(\/results\/sfna\/2025\/region\/[^"]+)"/);
  assert.ok(region, 'regions on the SFNA year index');
  ({ r, t } = await html(env, region));
  assert.equal(r.status, 200);
  assert.match(attr(t, /<title>([^<]*)<\/title>/), /SFNA 2025/);
  assert.doesNotMatch(mainOf(t), /PSLE/);
  const district = attr(t, /href="(\/results\/sfna\/2025\/district\/[^"]+)"/);
  ({ r, t } = await html(env, district));
  assert.equal(r.status, 200);
  assert.match(mainOf(t), /schools/);
  // the same slug under the other exam is another page with another title
  const { t: tp } = await html(env, region.replace('/sfna/', '/psle/'));
  assert.notEqual(attr(tp, /<link rel="canonical" href="([^"]*)"/), attr(t, /<link rel="canonical" href="([^"]*)"/));
  // sitemaps list every hub once, under its own exam
  const reg = await getRegistry(env);
  const seen = new Set();
  for (const e of reg.exams.filter((x) => x.cat === 'psle' || x.cat === 'sfna')) {
    for (const u of await urlsOf(env, reg, e, 'all')) {
      assert.ok(!seen.has(u), 'listed twice: ' + u);
      seen.add(u);
      if (/\/(region|district)\//.test(u)) assert.ok(u.startsWith(`/results/${e.cat}/${e.year}/`), u);
    }
  }
  assert.ok([...seen].some((u) => u.startsWith('/results/sfna/2025/region/')));
  assert.ok([...seen].some((u) => u.startsWith('/results/psle/2025/region/')));
});

test('every family: titles up to 100, descriptions 70 to 160, unique, one table per page kind', { skip }, async () => {
  const env = envFor('all');
  const titles = new Map(), descs = new Map(), done = new Set();
  for (const e of registry.exams) {
    const files = fs.readdirSync(path.join(DATA, e.id)).filter((f) => f.endsWith('.txt')).sort();
    for (const f of [files[0], files[Math.floor(files.length / 2)], files[files.length - 1]]) {
      const p = `/results/${e.cat}/${f.slice(0, -4)}/${e.year}/`;
      if (done.has(p)) continue;
      done.add(p);
      const { r, t } = await html(env, p);
      assert.equal(r.status, 200, p);
      const plain = (x) => x.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const title = plain(attr(t, /<og:title|<meta property="og:title" content="([^"]*)"/));
      const desc = plain(attr(t, /<meta name="description" content="([^"]*)">/));
      assert.ok(title.length <= 100, `${p} title ${title.length}: ${title}`);
      assert.ok(desc.length >= 70 && desc.length <= 160, `${p} description ${desc.length}: ${desc}`);
      assert.ok(!titles.has(title) && !descs.has(desc), `${p} duplicates ${titles.get(title) || descs.get(desc)}`);
      titles.set(title, p); descs.set(desc, p);
      assert.ok(!/undefined|NaN|\[object/.test(mainOf(t)), `${p} has a stray value`);
    }
  }
});
