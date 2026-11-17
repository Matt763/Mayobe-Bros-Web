// The main navigation opens a Results sub-menu beside "Results" (desktop flyout) and as a nested accordion in the phone/tablet drawer.
// Needs a built site (node scripts/build.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cats = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/categories.json'), 'utf8'));
const results = cats.find((c) => c.slug === 'educational').labels.find((l) => l.slug === 'results');
const sectionHrefs = results.sections.map((s) => `/category/educational/results/${s.slug}/`);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('the dropdown has a flyout with "All Results" and every section, wired to an arrow button', () => {
  const fly = /<div class="sub-fly">([\s\S]*?)<\/div><\/div>/.exec(html);
  assert.ok(fly, 'a .sub-fly block exists');
  const id = /aria-controls="([^"]+)"/.exec(fly[1])[1];
  assert.match(fly[1], new RegExp(`<div class="flyout" id="${id}">`));
  assert.match(fly[1], /<button class="sub-fly-btn" type="button" aria-expanded="false"/);
  const hrefs = [...fly[1].split('class="flyout"')[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['/category/educational/results/', ...sectionHrefs]);
  assert.equal(results.sections.length, sectionHrefs.length);
});

test('the phone and tablet drawer has the same sections as a nested accordion', () => {
  const sub = /<details class="drawer-subgroup">([\s\S]*?)<\/details>/.exec(html);
  assert.ok(sub, 'a nested drawer group exists');
  const hrefs = [...sub[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['/category/educational/results/', ...sectionHrefs]);
});

test('the flyout opens on hover, focus and its button, and closes on Escape (styles and script)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  assert.match(css, /\.sub-fly:hover \.flyout, \.sub-fly:focus-within \.flyout, \.sub-fly\.is-open \.flyout \{[^}]*visibility: visible/);
  const js = fs.readFileSync(path.join(ROOT, 'js/site.js'), 'utf8');
  assert.match(js, /\.sub-fly-btn/);
  assert.match(js, /e\.key !== 'Escape'/);
});
