/* The "Other years" chips in the hero of a results page, on phones (2026-11-11).
   Under 40rem only the nearest eight years show and a button opens the rest. Every year must stay in the page's HTML as a plain link (search engines,
   no JavaScript, wide screens), the button must be made by the script, the fold must be CSS under the phone media query, and the change must be
   animated with Web Animations on height, opacity and transform only, with reduced motion instant. Real-browser check: Chromium at 320, 390, 768, 844. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const app = read('js/results-app.js');
const css = read('css/results.css');
const fn = (() => { const i = app.indexOf('function setupYears('); return app.slice(i, app.indexOf('\n}\n', i) + 3); })();

test('years: every year is a plain link in the built page and the button is not in the HTML', () => {
  const f = path.join(ROOT, 'post/educational/results/necta-csee-results-2025/index.html');
  if (!fs.existsSync(f)) return;
  const html = fs.readFileSync(f, 'utf8');
  const nav = html.slice(html.indexOf('data-rs-years'), html.indexOf('</nav>', html.indexOf('data-rs-years')));
  assert.ok((nav.match(/<a class="rs-chip rs-chip--dark"/g) || []).length >= 12, 'all the other years are links');
  assert.doesNotMatch(nav, /hidden|display:\s*none|rs-years-more|rs-year-extra/, 'nothing is hidden or marked in the HTML');
});

test('years: the fold is CSS under the phone query and only while collapsed', () => {
  assert.match(css, /@media \(max-width: 40rem\) \{\s*\.rs-hero \.rs-years\[data-years-state="collapsed"\] \.rs-year-extra \{ display: none; \}/);
  assert.match(css, /\.rs-years-more \{ display: none; \}/, 'the button is hidden on wider screens');
  assert.doesNotMatch(css.replace(/@media \(max-width: 40rem\) \{[\s\S]*?\n\}\n/g, ''), /rs-year-extra \{ display: none/, 'no rule outside the phone query hides a year');
});

test('years: the script makes the button, folds from the 9th chip and keeps the links in the page', () => {
  assert.match(fn, /const YEARS_SHOWN = 8|YEARS_SHOWN \+ 4/);
  assert.match(app, /const YEARS_SHOWN = 8;/);
  assert.match(fn, /h\('button', \{ type: 'button', class: 'rs-years-more'/);
  assert.match(fn, /'aria-controls'/);
  assert.match(fn, /'aria-expanded'/);
  assert.doesNotMatch(fn, /\.remove\(\)|innerHTML|\.hidden\s*=/, 'chips are never removed from the page');
});

test('years: animated with Web Animations on height, opacity and transform; reduced motion is instant; the page glides, never browser smooth scroll', () => {
  assert.match(fn, /ul\.animate\(\[\{ height:/);
  assert.match(fn, /opacity: 0, transform: 'translateY\(16px\) scale\(0\.92\)'/);
  assert.match(fn, /reduced\(\) \|\| typeof ul\.animate !== 'function'/);
  assert.match(fn, /m\.glide\(/);
  assert.doesNotMatch(fn, /behavior: 'smooth'|scrollIntoView|\.scrollTo\(/);
  assert.match(fn, /if \(busy\) return;/, 'a press during the change is ignored');
  assert.match(fn, /window\.setTimeout\(done, \d+\)/, 'a lost finish event cannot leave the list clipped');
  assert.doesNotMatch(fn, /localStorage|sessionStorage|document\.cookie/);
});

test('years: the app starts it on every results page, also one with no data, and takes it down with the app', () => {
  assert.match(app, /const years = setupYears\(root\);[\s\S]{0,120}handle\.destroy = years\.destroy;[\s\S]{0,80}state === 'nodata'/);
  assert.match(app, /for \(const off of undo\.splice\(0\)\) off\(\);\s*years\.destroy\(\);/);
});

test('hero: the main title is larger on phones and tablets (clamp from 2rem, 1.65rem for a centre name)', () => {
  assert.match(css, /\.rs-hero \.rs-h1 \{ font-size: clamp\(2rem, 1\.2rem \+ 4\.2vw, 2\.8rem\); \}/);
  assert.match(css, /\.rs-hero \.rs-h1:has\(\.rs-h1-code\) \{ font-size: clamp\(1\.65rem, 0\.9rem \+ 4vw, 2\.5rem\); \}/);
});
