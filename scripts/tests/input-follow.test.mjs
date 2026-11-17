/* A search bar that sticks to the screen must bring the reader to the new results.
   Bug (2026-11-10): scrolled down near the footer, the reader typed in the sticky search bar. The list got shorter, the browser clamped
   the scroll position to the new end of the page (the footer), and nothing took the reader to the results. These tests pin the fix in the
   source: every user-driven change goes through followResults(), which holds the page height, glides (js/motion.js) to the top of the
   results under the header and the bar, and never takes focus from the field. Real-browser check: Chromium at 1440 x 1000. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const app = read('js/results-app.js');

test('results app: followResults glides to the results with typing allowed and never takes focus', () => {
  assert.match(app, /function followResults\(/);
  const body = app.slice(app.indexOf('function followResults('));
  const fn = body.slice(0, body.indexOf('\n  }\n') + 4);
  assert.match(fn, /mb\.glide\(mb\.topOf\(top, mb\.GAP \+ stickyTop\(bar\)\), \{ covered: true, keepOnKeys: true \}\)/, 'one eased glide under the header and the bar; typing must not stop it');
  assert.match(fn, /getBoundingClientRect\(\)\.top < under/, 'nothing moves when the top of the results is already on screen');
  assert.doesNotMatch(fn, /\.focus\(/, 'focus stays in the field');
  assert.doesNotMatch(fn, /behavior: 'smooth'/, 'never the browser smooth scroll');
});

test('results app: every user-driven change of the list follows the results', () => {
  assert.match(app, /function updateExam\(\{[^}]*follow = false/);
  assert.match(app, /function updateCentre\(\{[^}]*follow = false/);
  assert.match(app, /followResults\(run, \{ top: R\.status, bar: R\.tools \}\)/, 'the school list follows its status line under the sticky bar');
  assert.match(app, /followResults\(run, \{ top: R\.cstatus, bar: R\.ctools \}\)/, 'the candidate table follows its status line under the sticky bar');
  // typing (both searches), A to Z, the tabs, Clear, division buttons
  assert.match(app, /runExam = SSR \? null : debounce\(\(\) => \{[^}]*updateExam\(\{ follow: true \}\)/);
  assert.match(app, /runCentre = debounce\(\(\) => \{[^}]*updateCentre\(\{ announceIt: true, follow: true \}\)/);
  assert.match(app, /S\.ex\.letter = b\.dataset\.l;\s*updateExam\(\{ follow: true \}\)/);
  assert.match(app, /S\.ce\.grade = b\.dataset\.g;\s*updateCentre\(\{ announceIt: true, follow: true \}\)/);
  assert.match(app, /updateExam\(\{ resetPage: true, writeUrl: true, announceIt: false, follow: true \}\)/, 'switching the tab');
  const clearAll = app.slice(app.indexOf('function clearAll()'), app.indexOf('function clearAll()') + 400);
  assert.match(clearAll, /updateExam\(\{ follow: true \}\)/);
  const reset = app.slice(app.indexOf('function resetCentreFilters('), app.indexOf('function resetCentreFilters(') + 300);
  assert.match(reset, /updateCentre\(\{ follow: true \}\)/);
});

test('results app: a route, Back or restore never triggers the follow (those places handle the scroll themselves)', () => {
  for (const m of app.matchAll(/updateExam\(\{[^}]*writeUrl: false[^}]*\}\)/g)) assert.doesNotMatch(m[0], /follow/);
  for (const m of app.matchAll(/updateCentre\(\{[^}]*writeUrl: false[^}]*\}\)/g)) assert.doesNotMatch(m[0], /follow/);
});

test('motion.js: keepOnKeys is an option of glide', () => {
  assert.match(read('js/motion.js'), /keepOnKeys/);
});

test('contact form: fields and the status line are focused without the browser scroll, then glided to when off screen', () => {
  const src = read('js/contact.js');
  assert.match(src, /function bring\(el\)/);
  assert.match(src, /focus\(\{ preventScroll: true \}\)/);
  assert.match(src, /M\.glide\(M\.topOf\(el, 96\)\)/);
  assert.doesNotMatch(src.replace(/\{ preventScroll: true \}/g, ''), /\b(status|first|f\[r\.body\.field\])\.focus\(\)/, 'no bare focus() that makes the page jump');
});

test('comment form: no browser smooth scroll; the reply form and a new comment come in with the shared glide', () => {
  const src = read('js/engage.js');
  assert.doesNotMatch(src, /behavior: 'smooth'/);
  assert.match(src, /function centreIn\(node, covered\)/);
  assert.match(src, /centreIn\(form, false\)/);
  assert.match(src, /centreIn\(node, true\)/);
});

test('header search: a new search starts at its first result', () => {
  const src = read('js/site.js');
  const fn = src.slice(src.indexOf('function renderModal()'), src.indexOf('function openSearch()'));
  assert.match(fn, /results\.scrollTop = 0/);
});
