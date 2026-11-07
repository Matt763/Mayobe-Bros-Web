// Checks on the built post pages (run `node scripts/build.mjs` first).
//   node --no-warnings --test scripts/tests/pages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function postPages(dir = path.join(ROOT, 'post')) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...postPages(full));
    else if (entry.name === 'index.html') out.push(full);
  }
  return out;
}

// The "Keep reading" grid fades in when js/site.js sees 6% of it on screen. A grid that is taller than about
// 16 screens can never show 6% at once, so its cards stayed at opacity 0 (a blank section) until a reload restored
// the scroll position. It once listed every article on the site (126 cards, 22,000 to 63,000 px tall).
const MAX_KEEP_READING_CARDS = 6;

test('every "Keep reading" section is short enough to fade in', () => {
  const pages = postPages();
  assert.ok(pages.length > 0, 'no built post pages found: run node scripts/build.mjs first');
  let checked = 0;
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    const head = html.indexOf('<h2>Keep reading</h2>');
    if (head < 0) continue; // redirect stubs and one-post sites have no such section
    const end = html.indexOf('</section>', head);
    const cards = (html.slice(head, end).match(/<article class="card/g) || []).length;
    const rel = path.relative(ROOT, file);
    assert.ok(cards >= 1, `${rel}: "Keep reading" has no cards`);
    assert.ok(cards <= MAX_KEEP_READING_CARDS, `${rel}: "Keep reading" has ${cards} cards (at most ${MAX_KEEP_READING_CARDS})`);
    checked++;
  }
  assert.ok(checked > 0, 'no page had a "Keep reading" section');
});

// Search engines can only offer a "jump to" link for a heading that has an address and a plain link to it in the page.
// The contents list is written into the HTML at build time and must link every ## and ### heading of the article.
test('every ## and ### heading of a post is linked from its table of contents', () => {
  for (const file of postPages()) {
    const html = fs.readFileSync(file, 'utf8');
    const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>/);
    if (!toc) continue; // posts with fewer than 3 sections have no contents list
    const article = html.split('data-engage')[0];
    const links = new Set([...toc[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]));
    for (const [, id] of article.matchAll(/<h[23] id="([^"]+)"/g)) {
      assert.ok(links.has(id), `${path.relative(ROOT, file)}: heading #${id} is not in the table of contents`);
    }
  }
});

// The comment buttons (like, edit, delete) tell screen-reader users what happened through one polite live region,
// and move focus to the comments heading after a delete, so both must be in the page.
test('pages with comments have a live region and a focusable comments heading', () => {
  let checked = 0;
  for (const file of postPages()) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('data-comments')) continue;
    const rel = path.relative(ROOT, file);
    assert.ok(html.includes('data-comment-live'), `${rel}: no data-comment-live region`);
    assert.match(html, /<h2 id="comments-h" tabindex="-1">/, `${rel}: the comments heading must have tabindex="-1"`);
    checked++;
  }
  assert.ok(checked > 0, 'no built post page has comments: run node scripts/build.mjs');
});

// Comment emails: the "email me" checkbox on the form and the /manage/ page that turns an emailed link into the browser's edit token.
test('the comment form has the email-me checkbox, hidden until an email is typed', () => {
  let checked = 0;
  for (const file of postPages()) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('data-comments')) continue;
    const rel = path.relative(ROOT, file);
    assert.match(html, /<input[^>]*type="checkbox"[^>]*name="notify"|<input[^>]*name="notify"[^>]*type="checkbox"/, `${rel}: no notify checkbox`);
    assert.ok(html.includes('Email me a link to edit or delete this comment, and tell me when someone replies'), `${rel}: checkbox label text`);
    assert.match(html, /data-notify-row[^>]*\bhidden\b/, `${rel}: the checkbox row must start hidden`);
    assert.match(html, /only for this[^<]*never shown/i, `${rel}: hint that the address is used only for this`);
    assert.doesNotMatch(html.match(/<input[^>]*name="notify"[^>]*>/)[0], /\bchecked\b/, `${rel}: checkbox must be unchecked by default`);
    checked++;
  }
  assert.ok(checked > 0, 'no built post page has comments');
});

test('/manage/ does not load the analytics beacon, other pages do', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'manage', 'index.html'), 'utf8'), /cloudflareinsights/, 'manage page must not load the beacon');
  assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /cloudflareinsights/, 'home page still loads it');
});

test('/manage/ is noindex, no-referrer, has one button, and calls the API only from a click', () => {
  const file = path.join(ROOT, 'manage', 'index.html');
  assert.ok(fs.existsSync(file), 'manage/index.html missing: run node scripts/build.mjs');
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<button[^>]*data-manage-go/);
  assert.match(html, /js\/manage\.js/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[^<]*fetch\(/, 'no inline fetch on the page');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8') + [...fs.readdirSync(ROOT)].filter((f) => /sitemap\d*\.xml$/.test(f)).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join(''), /\/manage\//, 'manage must not be in the sitemaps');
  const js = fs.readFileSync(path.join(ROOT, 'js', 'manage.js'), 'utf8');
  // every network call must sit inside a function that only a click handler reaches: the one call site is "go()", wired to the button
  const calls = [...js.matchAll(/\bfetch\(/g)].length;
  assert.equal(calls, 1, 'exactly one fetch call in manage.js');
  assert.match(js, /addEventListener\('click',\s*go\)|addEventListener\("click",\s*go\)/, 'the button click must run go()');
  assert.equal([...js.matchAll(/(?<!function )\bgo\(\)/g)].length, 0, 'go() must never be called directly');
  assert.match(js, /history\.replaceState/);
  const footer = html.split('<footer')[1] || '';
  assert.doesNotMatch(footer, /href="[^"]*\/manage\/"/, 'not linked from the footer');
});
