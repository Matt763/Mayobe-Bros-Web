// The results search pages (front matter `app: results`): only the site navbar of the blog, the app's own markup, no article furniture.
//   node --no-warnings --test scripts/tests/results-app-page.test.mjs   (after `node scripts/build.mjs`)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const config = JSON.parse(read('site.config.json'));
const DATASETS = Object.keys(config.resultsData.datasets);
// only the years that have a post: years with no data online have no post (their files wait in ../my-site-archive/pending-results-posts)
const EXAMS = ['csee', 'acsee', 'psle'].flatMap((c) => Array.from({ length: 23 }, (_, i) => String(2025 - i)).filter((y) => fs.existsSync(path.join(ROOT, `content/posts/necta-${c}-results-${y}.md`))).map((y) => ({ id: `${c}-${y}`, cat: c, year: y, slug: `necta-${c}-results-${y}`, file: `post/educational/results/necta-${c}-results-${y}/index.html` })));
const page = (x) => read(x.file);

test('all the CSEE, ACSEE and PSLE results posts that exist are search pages, flagged in front matter and built', () => {
  for (const x of EXAMS) {
    assert.match(read(`content/posts/${x.slug}.md`), /^app: results$/m, `${x.slug}: app: results`);
    assert.ok(fs.existsSync(path.join(ROOT, x.file)), `${x.file} built`);
  }
});

test('the navbar and the real footer stay; no rail, article, comments, share or listen', () => {
  for (const x of EXAMS) {
    const h = page(x);
    assert.match(h, /<header class="site-header"/, `${x.id}: navbar`);
    assert.match(h, /<footer class="site-footer"/, `${x.id}: the real footer`);
    for (const gone of ['class="post-rail"', '<article class="post"', 'data-comments', 'data-engage', 'data-listen', 'class="post-nav"', 'class="to-top"', 'id="listen-player"']) assert.ok(!h.includes(gone), `${x.id}: ${gone} must not be on a results page`);
    for (const js of ['engage.js', 'listen.js', 'reads.js', 'pager.js', 'turnstile.js']) assert.ok(!h.includes(`/js/${js}`), `${x.id}: ${js} not loaded`);
  }
});

test('the app root carries its data attributes, one h1, labelled fields, the cookie button, and loads its own module and stylesheet', () => {
  for (const x of EXAMS) {
    const h = page(x);
    assert.equal((h.match(/<h1\b/g) || []).length, 1, `${x.id}: exactly one h1`);
    assert.match(h, new RegExp(`<div class="rs"[^>]*data-exam="${x.id}"`), `${x.id}: data-exam`);
    assert.match(h, /data-cat="(csee|acsee|psle)"/);
    assert.match(h, /data-cookie-settings/, `${x.id}: the visitor can still change cookie choices (footer)`);
    assert.match(h, /<script type="module" src="[^"]*\/js\/results-app\.js/, `${x.id}: module script`);
    const main = h.indexOf('<link rel="stylesheet" href="/css/style.css'), extra = h.indexOf('/css/results.css');
    assert.ok(main > -1 && extra > main, `${x.id}: results.css comes after style.css, both in <body>`);
    assert.ok(h.indexOf('<body') < main, `${x.id}: stylesheets are in the body (skeleton rule)`);
    assert.ok(!/<link rel="stylesheet"/.test(h.split('</head>')[0].replace(/<script>[\s\S]*?<\/script>/g, '')), `${x.id}: no stylesheet in <head>`);
    const app = h.slice(h.indexOf('<div class="rs"'), h.indexOf('</main>'));
    for (const m of app.matchAll(/<input\b[^>]*\sid="([^"]+)"/g)) assert.match(app, new RegExp(`<label[^>]*for="${m[1]}"`), `${x.id}: label for #${m[1]}`);
    assert.ok(!/<[^>]+\sstyle=/.test(h.split('<body')[1]), `${x.id}: no style attributes (CSP)`);
  }
});

test('datasets: indexable, in the posts sitemap, WebPage data; no dataset: noindex and out of the sitemap', () => {
  const sm = fs.readdirSync(ROOT).filter((f) => /^posts-sitemap\d*\.xml$/.test(f)).map(read).join('\n');
  for (const x of EXAMS) {
    const h = page(x);
    const has = DATASETS.includes(x.id);
    const url = `/post/educational/results/${x.slug}/`;
    assert.equal(/<meta name="robots" content="noindex/.test(h), !has, `${x.id}: robots`);
    assert.equal(sm.includes(url), has, `${x.id}: sitemap`);
    assert.match(h, new RegExp(`<link rel="canonical" href="[^"]*${url}">`), `${x.id}: canonical is the page itself`);
    assert.match(h, /"@type":"WebPage"/);
    assert.ok(!h.includes('"@type":"Article"'), `${x.id}: not an Article`);
    assert.ok(!h.includes('property="article:'), `${x.id}: no article:* tags`);
    // a post with data is titled with the words people type (Swahili level first, "Results by School"); the heading on the page stays NECTA CSEE RESULTS 2025 | MAYOBE BROS
    if (has) assert.match(h, /<title>Matokeo ya (Kidato cha Nne|Kidato cha Sita|Darasa la Saba) \d{4}: (CSEE|ACSEE|PSLE) Results by School<\/title>/);
    else assert.match(h, /<title>NECTA (CSEE|ACSEE|PSLE) RESULTS \d{4} \| MAYOBE BROS<\/title>/);
    if (!has) assert.ok(!/class="rs-row/.test(h), `${x.id}: no list without data`);
  }
});

test('content security policy: scripts from the site only, the data origin only when it is another host', () => {
  const h = page(EXAMS[1]);
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(h)[1].replace(/&#39;/g, "'");
  assert.match(csp, /script-src 'self'/);
  assert.ok(!/script-src[^;]*unsafe/.test(csp), 'no unsafe script');
  assert.match(csp, /font-src 'self'/);
  if (config.resultsData.base.startsWith('/')) assert.ok(!/connect-src[^;]*onlinesys/.test(csp));
});

test('home and feed: a results post is not offered as a quick read and has text in the feed', () => {
  const home = read('index.html');
  const quick = /<ul class="dsc-quick">([\s\S]*?)<\/ul>/.exec(home);
  if (quick) assert.ok(!/results-20\d\d/.test(quick[1]), 'quick reads');
  const feed = read('feed.xml');
  assert.ok(!/<content:encoded><!\[CDATA\[\]\]><\/content:encoded>/.test(feed), 'no empty feed items');
});

test('a cover made from a credited photograph prints its credit on the page (CC BY needs it); other covers print none', () => {
  let credited = 0;
  for (const x of EXAMS) {
    const src = read(`content/posts/${x.slug}.md`);
    const credit = (/^imageCredit: (.+)$/m.exec(src) || [])[1] || '';
    const h = page(x);
    if (/Photo:/i.test(credit)) {
      credited++;
      const who = credit.replace(/^Cover drawn by Mayobe Bros\.\s*/, '').replace(/^Photo:\s*/i, '').split(/\.\s+The NECTA/)[0].replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      assert.ok(h.includes('data-rs-credit'), `${x.id}: credit line present`);
      assert.ok(h.includes(who.slice(0, 40)), `${x.id}: credit names the photographer`);
    } else assert.ok(!h.includes('data-rs-credit'), `${x.id}: no credit line without a photo`);
  }
  assert.ok(credited > 0, 'some covers are credited photographs (the loop above checks each one)');
});

test('the hero has no "independent guide" note (owner, 2026-11-10); the statement stays lower on every page', () => {
  for (const x of EXAMS) {
    const h = page(x);
    assert.ok(!/class="rs-hero-note"/.test(h), `${x.id}: no hero note`);
    assert.ok(!/An independent guide\. Not run or endorsed by NECTA/.test(h), `${x.id}: the old hero sentence is gone`);
    assert.match(h, /independent site\. It is not run, approved or endorsed by NECTA/, `${x.id}: the statement is still on the page`);
  }
});
