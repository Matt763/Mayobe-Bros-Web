/* Tables in articles: the sideways hint and the carousel of tables (js/tables.js, ":::carousel" in scripts/lib/markdown.mjs, added 2026-11-18).
   Pinned in the source and in the built post. Real-browser check: Chromium at 1280 x 900 (carousel on) and 390 x 844 (stacked groups that slide sideways). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const js = read('js/tables.js');
const css = read('css/style.css');
const block = css.slice(css.indexOf('Tables in articles: the sideways hint and the carousel'));

test('tables.js: no storage, no network, no native smooth scroll, no HTML from text', () => {
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(js, /behavior:\s*'smooth'|scrollIntoView|\.style\.[a-z]+\s*=/);
  assert.match(js, /MBMotion\.glide\(window\.MBMotion\.topOf\(root, 12\)\)/, 'the page moves only through the shared glide');
});

test('tables.js: large screens only, one group at a time, keyboard and announcements, reduced motion', () => {
  assert.match(js, /\(min-width: 64rem\)/);
  assert.match(js, /ArrowLeft/);
  assert.match(js, /ArrowRight/);
  assert.match(js, /aria-current/);
  assert.match(js, /role', 'status'/, 'the new group is announced');
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /hashchange/, 'a link to something inside a hidden group opens that group');
});

test('table css: the groups are stacked below 64rem and without script; chips and buttons only on large screens; unique keyframe; reduced motion', () => {
  assert.ok(block.length > 800);
  assert.equal((css.match(/@keyframes tbl-slide-in/g) || []).length, 1);
  const large = block.indexOf('@media (min-width: 64rem)');
  const hide = block.indexOf('html.js .article-content .tbl-carousel.is-on .tbl-slide { display: none; }');
  assert.ok(large > -1 && hide > large, 'hidden groups need html.js and .is-on inside the large-screen query: without script all of them show');
  assert.match(block, /@media \(max-width: 63\.99rem\) \{ \.tbl-chips, \.tbl-nav \{ display: none; \} \}/);
  assert.match(block, /prefers-reduced-motion: reduce\) \{ \.tbl-slide\.is-in \{ animation: none !important; \}/);
  assert.match(block, /\.tbl-chip \{[^}]*min-height: 2\.75rem/, 'touch targets above 44px');
  assert.match(block, /@media print \{[^@]*\.tbl-slide \{ display: block !important; \}/, 'a printed page has every group');
  assert.doesNotMatch(block, /(^|[\s,}])(html|body)\s*\{/m);
});

test('the post: every group is in the page text, each table scrolls in its own box, the script is loaded', () => {
  const html = read('post/educational/combination-na-aina-ya-kazi-utakayofanya/index.html');
  assert.equal((html.match(/class="tbl-slide"/g) || []).length, 14);
  assert.equal((html.match(/class="table-wrapper" role="region"/g) || []).length >= 14, true);
  assert.match(html, /<script src="[^"]*js\/tables\.js[^"]*" defer>/);
  const rows = (html.match(/<tr><td>\d+<\/td>/g) || []).length;
  assert.equal(rows, 192, 'every job row of the earlier tables is here');
  assert.doesNotMatch(html, /<tr><td><\/td><td><\/td>/, 'no empty rows');
});

test('pages without a table do not load tables.js', () => {
  assert.doesNotMatch(read('about/index.html'), /js\/tables\.js/);
});
