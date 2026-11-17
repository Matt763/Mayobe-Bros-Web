/* The phone menu icons, the search overlay animation and the candidate pop-up (2026-11-11). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const home = read('index.html');
const drawer = /<aside class="drawer"[\s\S]*?<\/aside>/.exec(home)[0];

test('phone menu: every category row has an icon that says what it is (a gamepad for video games, a chip for technology)', () => {
  const src = read('scripts/lib/render.mjs');
  assert.match(src, /'video-games-updates': 'gamepad'/);
  assert.match(src, /'technology-solutions': 'cpu'/);
  const rows = [...drawer.matchAll(/<(?:a|summary) class="drawer-row[^"]*"[^>]*>([\s\S]*?)<\/(?:a|summary)>/g)];
  assert.ok(rows.length >= 8, 'Home and the categories');
  for (const r of rows) assert.match(r[1], /<span class="drawer-ico" aria-hidden="true"><svg/, 'an icon tile in every row');
  assert.ok(drawer.includes('M17.32 5H6.68'), 'the gamepad drawing');
  assert.ok(drawer.includes('<rect width="16" height="16" x="4" y="4" rx="2"/>'), 'the chip drawing');
  // no two categories share an icon
  const icons = [...drawer.matchAll(/<span class="drawer-ico" aria-hidden="true">(<svg[\s\S]*?<\/svg>)/g)].map((m) => m[1]).slice(1);
  assert.equal(new Set(icons).size, icons.length, 'each category has its own icon');
});

test('phone menu: every sub-menu row has a small icon', () => {
  const flat = drawer.replace(/<div class="drawer-sub2">[\s\S]*?<\/div>/g, ''); // the Results sections inside the nested group have no icon on purpose
  const subs = [...flat.matchAll(/<div class="drawer-sub">([\s\S]*?)<\/div><\/details>/g)].map((m) => m[1]);
  assert.ok(subs.length >= 3);
  for (const s of subs) {
    const links = (s.match(/<a href=/g) || []).length;
    const withIcon = (s.match(/<a href="[^"]+"><span class="drawer-subico"/g) || []).length;
    assert.ok(links > 0 && withIcon === links, 'an icon on every link of the group');
  }
  assert.match(drawer, /<summary><span class="drawer-subico" aria-hidden="true"><svg[\s\S]*?<span class="drawer-label">Results<\/span>/, 'the Results group has one too');
});

test('search overlay: opens and closes with transitions, the menu hands over to it, and results rise in', () => {
  const js = read('js/site.js');
  assert.match(js, /modal\.classList\.add\('is-open'\)/);
  assert.match(js, /modal\.classList\.add\('is-closing'\)/);
  assert.match(js, /--so/, 'the panel grows out of the button that was pressed');
  assert.match(js, /riseOnce/);
  assert.match(js, /\$\$\('\.drawer \[data-search-open\]'\)/);
  const css = read('css/style.css');
  assert.match(css, /\.search-modal\.is-open \.search-panel \{ opacity: 1; transform: none; \}/);
  assert.match(css, /\.search-modal\.is-closing \.search-panel/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.search-backdrop, \.search-panel \{ transition: none; \}/);
  assert.doesNotMatch(js, /modal\.hidden = true;\s*\n\s*doc\.body/, 'closing is not instant any more');
});

test('candidate pop-up: a double tap on phones, a button on touch screens, four ways out, nothing inline', () => {
  const js = read('js/results-app.js');
  assert.match(js, /function openSheet\(it, from\)/);
  assert.match(js, /e\.pointerType !== 'touch' \|\| !isPhone\(\)/, 'touch only, phones only');
  assert.match(js, /Math\.min\(window\.screen\.width, window\.screen\.height\) < 600/);
  assert.match(js, /e\.timeStamp - lastTap\.t < 320/);
  assert.match(js, /class: 'rs-view'/, 'the button that does not need the gesture');
  assert.match(js, /rs-sheet-back/);
  assert.match(js, /e\.key === 'Escape'/);
  assert.match(js, /wireSheetDrag/);
  assert.match(js, /role', 'dialog'/);
  assert.match(js, /aria-modal/);
  assert.match(js, /undo\.push\(\(\) => closeSheet\(true\)\)/, 'a page switch takes the sheet down');
  const body = js.slice(js.indexOf('function openSheet('), js.indexOf('function closeSheet('));
  assert.doesNotMatch(body, /\{ style:/, 'no style attribute: the page policy blocks inline styles');
  const css = read('css/results.css');
  assert.match(css, /\.rs-sheet\.is-open \.rs-sheet-panel \{ transform: none; \}/);
  assert.match(css, /\.rs-sheet\.is-out/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.rs-view \{ display: inline-grid/);
  assert.match(css, /touch-action: manipulation/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.rs-sheet-back, \.rs-sheet-panel, \.rs-sheet-subj li \{ transition: none; \}/);
});
