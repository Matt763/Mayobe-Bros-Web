// The sub-menu under the hero of the Results label (All | CSEE | ACSEE | PSLE | Guides) and the results portal card of each exam page.
// Run after `node scripts/build.mjs`:   node --no-warnings --test scripts/tests/results-sections.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const page = (slug) => read(`category/educational/results/${slug ? slug + '/' : ''}index.html`);
const CSS = read('css/style.css');
const PAGER = read('js/pager.js');

const NAMES = ['All', 'NECTA CSEE Results', 'NECTA ACSEE Results', 'NECTA PSLE Results', 'NECTA FTNA Results', 'NECTA SFNA Results', 'NECTA DSEE Results', 'NECTA DPEE Results', 'NECTA DPPEE Results', 'NECTA DSPEE Results', 'NECTA DTE Results', 'NECTA QT Results', 'Results Guides'];
const SECTIONS = ['csee', 'acsee', 'psle', 'ftna', 'sfna', 'dsee', 'dpee', 'dppee', 'dspee', 'dte', 'qt', 'guides'];
const EXAMS = ['csee', 'acsee', 'psle'];

const categories = JSON.parse(read('content/categories.json'));
const results = categories.find((c) => c.slug === 'educational').labels.find((l) => l.slug === 'results');
const portals = JSON.parse(read('content/portals.json'));

// the front matter of every post, read straight from the source files
const posts = fs.readdirSync(path.join(ROOT, 'content/posts')).filter((f) => f.endsWith('.md')).map((f) => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(read(`content/posts/${f}`))[1];
  const get = (k) => (new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(fm) || [])[1] || '';
  const sections = get('section').replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  return { slug: f.replace(/\.md$/, ''), label: get('label'), sections, draft: get('draft') === 'true' };
}).filter((p) => !p.draft);
const cardLinks = (html) => [...html.matchAll(/<a class="card-link" href="[^"]*\/([a-z0-9-]+)\/">/g)].map((m) => m[1]);
const wrapOf = (html) => /<section class="section"><div class="wrap">([\s\S]*?)<\/div><\/section>/.exec(html)[1];

test('the sections are the thirteen items (All, eight NECTA exams, Guides), in that order', () => {
  assert.deepEqual(['All', ...results.sections.map((s) => s.name)], NAMES);
  assert.deepEqual(results.sections.map((s) => s.slug), SECTIONS);
});

test('the sub-menu sits right after the hero, in the body, centred, on the Results page and on every section page', () => {
  for (const slug of ['', ...SECTIONS]) {
    const html = page(slug);
    assert.match(html, /<\/section><section class="section"><div class="wrap"><nav class="subnav" aria-label="Results sections">/, `${slug || 'results'}: the sub-menu must be the first thing in the body after the hero`);
    const nav = /<nav class="subnav"[\s\S]*?<\/nav>/.exec(html)[0];
    const items = [...nav.matchAll(/<a class="subnav-link[^"]*" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    assert.equal(items.length, 13, `${slug || 'results'}: thirteen items`);
    // the exam letters sit in their own span (.sn-key) inside the long name: read the text with the tags taken out
    const names = items.map((m) => (/<span class="sn-full">((?:(?!<\/span><span class="sn-short").)*)<\/span>/.exec(m[2]) || /<span>([^<]*)<\/span>/.exec(m[2]))[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&'));
    assert.deepEqual(names, NAMES, `${slug || 'results'}: names and order`);
    assert.deepEqual(items.map((m) => m[1]), ['/category/educational/results/', ...SECTIONS.map((s) => `/category/educational/results/${s}/`)], `${slug || 'results'}: real addresses`);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1, `${slug || 'results'}: exactly one open item`);
    const open = /<a class="subnav-link is-active" href="([^"]+)" aria-current="page">/.exec(nav)[1];
    assert.equal(open, slug ? `/category/educational/results/${slug}/` : '/category/educational/results/', `${slug || 'results'}: the open item is this page`);
    // phones: every long name has a short one, so thirteen items wrap in a few rows
    for (const m of items.slice(1)) {
      assert.match(m[2], /<span class="sn-short"><span class="sn-key">[^<]+<\/span><\/span>/, `short name for ${m[1]}`);
      assert.match(m[2], /<span class="sn-aux">NECTA<\/span> <span class="sn-key">[^<]+<\/span>|<span class="sn-aux">Results<\/span> <span class="sn-key">Guides<\/span>/, `the exam letters are marked for ${m[1]}`);
    }
  }
});

test('the sub-menu is plain navigation, not a tab widget (each item is another page)', () => {
  for (const slug of ['', ...SECTIONS]) {
    const nav = /<nav class="subnav"[\s\S]*?<\/nav>/.exec(page(slug))[0];
    assert.doesNotMatch(nav, /role="tab|role="tablist|href="#"/, 'no tab roles and no dead links');
  }
});

test('every one of the thirteen pages has its own hero picture, and the pictures differ', () => {
  const srcs = new Set();
  for (const slug of ['', ...SECTIONS]) {
    const hero = /<section class="hero hero-listing[^"]*">([\s\S]*?)<\/section>/.exec(page(slug))[1];
    const src = /<img class="hero-img" src="([^"]+)"/.exec(hero)[1];
    srcs.add(src.replace(/\?.*$/, ''));
    if (slug) assert.match(src, /\/assets\/img\/heroes\/results-[a-z]+\.webp/, `${slug}: a drawn picture made for this section`);
    assert.ok(fs.existsSync(path.join(ROOT, src.replace(/^\//, '').replace(/\?.*$/, ''))), `${slug}: ${src} exists`);
  }
  assert.equal(srcs.size, 13, 'thirteen different pictures');
  for (const s of results.sections) {
    const kb = fs.statSync(path.join(ROOT, s.image)).size / 1024;
    assert.ok(kb < 130, `${s.image} is ${Math.round(kb)} KB; keep a hero light for slow phones`);
  }
});

test('ALL lists every article labelled Results; Results Guides lists the guides; the exam pages list their own', () => {
  const inLabel = posts.filter((p) => p.label === 'results');
  assert.ok(inLabel.length >= 8);
  const allCards = cardLinks(page(''));
  assert.equal(allCards.length, Math.min(15, inLabel.length), 'ALL shows one page (15) of the Results articles; the rest are on page 2');
  assert.ok(allCards.every((c) => inLabel.some((p) => p.slug === c)), 'ALL lists only Results articles');
  for (const s of SECTIONS) {
    let want = inLabel.filter((p) => p.sections.includes(s)).map((p) => p.slug);
    // 15 cards per page: the exam pages show the 15 newest years (2025 to 2011) on page 1 and the rest on page 2
    if (want.length > 15) want = want.sort((a, b) => Number(b.slice(-4)) - Number(a.slice(-4))).slice(0, 15);
    assert.deepEqual(cardLinks(page(s)).sort(), want.sort(), s);
  }
  assert.ok(posts.filter((p) => p.sections.includes('guides')).length >= 8, 'the current Results articles are the guides');
});

// the years that have a post (2025 down): a year with no data online has no post, its files wait in ../my-site-archive/pending-results-posts
const yearsOf = (s) => Array.from({ length: 24 }, (_, i) => String(2026 - i)).filter((y) => fs.existsSync(path.join(ROOT, `content/posts/necta-${s}-results-${y}.md`)));
test('each exam page lists all its NECTA results posts (newest first, 15 on the first page), no portal card, and each post has its own picture', () => {
  const covers = new Set();
  for (const s of EXAMS) {
    const html = page(s);
    assert.doesNotMatch(html, /class="portal"|data-portal=/, `${s}: the old "check your results" card is gone`);
    assert.equal(portals[`results/${s}`], undefined, `${s}: no portals.json entry`);
    assert.deepEqual(cardLinks(html), yearsOf(s).slice(0, 15).map((y) => `necta-${s}-results-${y}`), `${s}: first page, newest year first`);
    if (yearsOf(s).length > 15) assert.deepEqual(cardLinks(read(`category/educational/results/${s}/page/2/index.html`)), yearsOf(s).slice(15).map((y) => `necta-${s}-results-${y}`), `${s}: second page`);
    else assert.equal(fs.existsSync(path.join(ROOT, `category/educational/results/${s}/page/2/index.html`)), false, `${s}: no second page (15 posts or fewer)`);
    for (const y of yearsOf(s)) {
      const slug = `necta-${s}-results-${y}`;
      const src = read(`content/posts/${slug}.md`);
      assert.match(src, new RegExp(`^title: NECTA ${s.toUpperCase()} RESULTS ${y} \\| MAYOBE BROS$`, 'm'), `${slug}: the heading is written as the owner asked`);
      assert.match(src, new RegExp(`^section: \\[${s}\\]$`, 'm'));
      assert.match(src, /^imageAlt: .{20,}$/m, `${slug}: a literal picture description`);
      const img = (/^image: (.+)$/m.exec(src) || [])[1];
      assert.ok(img && fs.existsSync(path.join(ROOT, img)), `${slug}: ${img} exists`);
      assert.ok(fs.statSync(path.join(ROOT, img)).size < 250 * 1024, `${slug}: cover under 250 KB`);
      covers.add(img);
      // the page: one h1 with the full heading, the brand is not repeated in <title>, and link previews drop the brand
      const post = read(`post/educational/results/${slug}/index.html`);
      const h = `NECTA ${s.toUpperCase()} RESULTS ${y}`;
      const SW = { csee: 'Kidato cha Nne', acsee: 'Kidato cha Sita', psle: 'Darasa la Saba' }[s];
      // the title search engines and link previews show leads with the words people type; the heading on the page is the owner's wording
      assert.match(post, new RegExp(`<title>Matokeo ya ${SW} ${y}: ${s.toUpperCase()} Results by School</title>`), `${slug}: <title> is the search title`);
      assert.match(post, new RegExp(`<meta property="og:title" content="Matokeo ya ${SW} ${y}: ${s.toUpperCase()} Results by School">`), `${slug}: og:title is the same, without a brand`);
      assert.ok(src.includes(`title: ${h} | MAYOBE BROS`), `${slug}: the post's own heading is kept in the file`);
      assert.equal((post.match(/<h1\b/g) || []).length, 1);
    }
  }
  assert.equal(covers.size, EXAMS.reduce((n, s) => n + yearsOf(s).length, 0), 'every post has a different picture');
});

test('portal text follows the AdSense rules: nothing invented, no hype, no "coming soon"', () => {
  for (const [key, p] of Object.entries(portals)) {
    const text = JSON.stringify(p);
    assert.doesNotMatch(text, /coming soon|guarantee|100% pass|get rich/i, key);
    assert.doesNotMatch(text, /[!]/, `${key}: no exclamation marks`);
    assert.doesNotMatch(text, /\b(please|sorry)\b/i, `${key}: no "please" or "sorry"`);
    for (const q of p.faq || []) {
      assert.ok(q.q.endsWith('?'), `${key}: "${q.q}" is a question`);
      const words = q.a.split(/\s+/).length;
      assert.ok(words >= 15 && words <= 90, `${key}: "${q.q}" answer is ${words} words`);
      assert.ok(q.source && /^https:\/\//.test(q.source.url), `${key}: "${q.q}" cites a source`);
    }
  }
  for (const slug of ['', ...SECTIONS]) {
    const html = page(slug);
    assert.doesNotMatch(wrapOf(html), /coming soon/i, slug);
    assert.doesNotMatch(html, /"@type":"FAQPage"|"@type":"HowTo"/, `${slug}: no FAQ or HowTo structured data (Google retired it)`);
  }
});

test('section pages are indexable (each has three posts) and are in the sitemap; the page has one h1 and a sane title', () => {
  const sitemap = read('label-sitemap1.xml');
  for (const s of EXAMS) {
    const html = page(s);
    assert.match(html, /<meta name="robots" content="index, follow/, `${s} is indexable`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://mayobebros\\.com/category/educational/results/${s}/">`));
    assert.ok(sitemap.includes(`https://mayobebros.com/category/educational/results/${s}/`), `${s} is in the sitemap`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${s}: one h1`);
    const title = /<title>([^<]+)<\/title>/.exec(html)[1];
    assert.ok(title.length <= 62, `${s}: title "${title}" fits a search result`);
    const desc = /<meta name="description" content="([^"]+)"/.exec(html)[1];
    assert.ok(desc.length >= 70 && desc.length <= 160, `${s}: description is ${desc.length} characters`);
  }
  // the share picture of each section exists (link previews)
  for (const s of SECTIONS) assert.ok(fs.existsSync(path.join(ROOT, `assets/share/label-educational-results-${s}.jpg`)), `share picture for ${s}`);
});

test('the pager switches the sub-menu in place and keeps it still while the content changes', () => {
  assert.match(PAGER, /\.subnav-link/);
  assert.match(PAGER, /closest\('\.chips, \.subnav'\)/, 'a click on the sub-menu is changed in place');
  assert.match(PAGER, /classList\.contains\('subnav'\)/, 'the sub-menu does not get the rise-in animation');
  assert.match(CSS, /main\.is-switching \.hero-listing \+ \.section > \.wrap > \*:not\(\.subnav\)/, 'the sub-menu does not fade out while the content changes');
});

test('the sub-menu CSS: centred, 44px targets, no dot, phones switch to short names', () => {
  const block = CSS.slice(CSS.indexOf('/* ======================================================= sub-menu under the hero'), CSS.indexOf('/* ======================================================= the "check your results" card'));
  assert.match(block, /\.subnav \{[^}]*justify-content: center/);
  assert.match(block, /\.subnav-list \{[^}]*justify-content: center/);
  assert.match(block, /\.subnav-link \{[^}]*min-height: 2\.75rem/);
  assert.doesNotMatch(block, /::before/, 'no dot before the names');
  assert.match(block, /@media \(max-width: 40rem\), \(max-height: 30rem\) and \(orientation: landscape\) \{[^}]*\.sn-full \{ display: none; \}/); // phones and landscape phones
  assert.doesNotMatch(block, /overflow-x: ?(auto|scroll)/, 'no hidden sideways scrolling: everything is visible');
});
