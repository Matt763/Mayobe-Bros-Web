/* Live suggestions under the school / centre search fields on phones and tablets (js/results-suggest.js, added 2026-11-18).
   The ranking is tested in Node; the rest is pinned in the source (roles, keyboard, focus, motion, loading only on a narrow screen).
   Real-browser check: Chromium at 390 x 520 (a phone with the keyboard open), 360 x 480, 768 x 600, 844 x 390 and 1280 x 800, light and dark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepRows } from '../../js/results-app.js';
import { rankRows, SUGGEST_MAX, NARROW } from '../../js/results-suggest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const mod = read('js/results-suggest.js');
const app = read('js/results-app.js');
const css = read('css/results.css');

const rows = prepRows([
  ['P0001', 'PRIMARY SCHOOL ONE', 1, 'Dodoma', 'Kondoa'],
  ['P0002', "ST. MARY'S MPANDA", 1, 'Katavi', 'Mpanda'],
  ['P0003', 'MERU PRIMARY', 1, 'Arusha', 'Meru'],
  ['P0004', 'MARY NAGU', 1, 'Manyara', 'Hanang'],
  ['P0005', 'ST MARYS JUNIOR', 0, 'Mwanza', 'Ilemela'],
  ['S0106', 'DUNG\'UNYI SEMINARY', 1, 'Mara', 'Musoma'],
  ['S0105', 'CHIDYA', 1, 'Mtwara', 'Masasi'],
  ['S0104', 'BWIRU BOYS', 1, 'Mwanza', 'Ilemela'],
]);
const names = (list) => list.map((r) => r.name);

test('rankRows: a name that starts with the word comes before a word inside the name, then before a word only inside another word', () => {
  const out = names(rankRows(rows, ['mary'], '', 10));
  assert.equal(out[0], 'MARY NAGU', 'starts with the typed word');
  assert.ok(out.indexOf("ST. MARY'S MPANDA") < out.indexOf('MERU PRIMARY'), 'a word start beats a match in the middle of a word');
  assert.deepEqual(out.slice(0, 5), ['MARY NAGU', "ST. MARY'S MPANDA", 'ST MARYS JUNIOR', 'PRIMARY SCHOOL ONE', 'MERU PRIMARY'], 'equal rank keeps the list order');
});

test('rankRows: apostrophes are ignored like in the list ("marys" finds MARY\'S)', () => {
  assert.ok(names(rankRows(rows, ['marys'], '', 10)).includes("ST. MARY'S MPANDA"));
});

test('rankRows: at most `limit` rows, equal rank keeps the list order, and nothing is invented', () => {
  const many = prepRows(Array.from({ length: 500 }, (_, i) => [`P${String(i).padStart(4, '0')}`, `SCHOOL ${i}`, 1, 'R', 'D']));
  const out = rankRows(many, ['school'], '', SUGGEST_MAX);
  assert.equal(out.length, SUGGEST_MAX);
  assert.deepEqual(out.map((r) => r.code), many.slice(0, SUGGEST_MAX).map((r) => r.code), 'ties keep the order of the list');
  assert.deepEqual(rankRows(many, ['nothing'], '', 6).length, 6, 'rows are given already filtered: the ranking never drops one');
  assert.deepEqual(rankRows([], ['x'], '', 6), []);
});

test('rankRows: a centre number ranks the exact code first, then codes that start with it', () => {
  const out = rankRows(rows, [], 's010', 10).map((r) => r.code);
  assert.deepEqual(out.slice(0, 3), ['S0106', 'S0105', 'S0104'], 'same rank keeps the list order');
  assert.equal(rankRows(rows, [], 's0105', 3)[0].code, 'S0105', 'the exact code comes first');
});

test('suggestions load only on a narrow screen, on demand, and the page does not glide away from the field while they show', () => {
  assert.equal(NARROW, '(max-width: 899.98px)', 'the width below which the search bar does not stick');
  assert.match(app, /import\('\.\/results-suggest\.js' \+ ver\)/, 'a dynamic import: wide screens never download it');
  assert.match(app, /matchMedia\('\(max-width: 899\.98px\)'\)/);
  assert.match(app, /updateExam\(\{ follow: !sugOn\(\) \}\)/, 'no glide to the list while the panel is showing');
  assert.match(app, /sug\.update\(\)/, 'the panel follows every change of the list');
  assert.match(app, /!\(sug && sug\.isOpen\(\)\)/, 'Escape closes the panel first and clears the field only on the next press');
  assert.match(app, /undo\.push\(\(\) => sug && sug\.destroy\(\)\)/, 'switching to another results page tears it down');
  assert.doesNotMatch(app, /location\.assign/);
});

test('suggestions follow the combobox pattern: roles, active option, keyboard, focus stays in the field', () => {
  for (const a of ["'role', 'combobox'", "'aria-autocomplete', 'list'", "'aria-haspopup', 'listbox'", "'aria-controls'", "'aria-expanded'", "'aria-activedescendant'", "role: 'listbox'", "role: 'option'"]) assert.ok(mod.includes(a), a);
  for (const k of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) assert.ok(mod.includes(`'${k}'`), k);
  assert.doesNotMatch(mod, /'Home'|'End'/, 'Home and End keep editing the text (APG: an editable combobox)');
  assert.match(mod, /MIN = \{ name: 2, code: 1 \}/, 'one letter matches most centres: suggestions start at two');
  assert.match(mod, /'mousedown', \(e\) => \{ if \(p\.panel && p\.panel\.contains\(e\.target\)\) e\.preventDefault\(\)/, 'a tap on the panel must not blur the field (the keyboard would drop)');
  assert.match(mod, /enterkeyhint/);
  assert.match(mod, /No ' \+ o\.unit \+ ' matches/, 'an empty state with a plain sentence');
});

test('suggestions stay within the site rules: no storage, no network, no HTML from data, our own scroll', () => {
  assert.doesNotMatch(mod, /localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/);
  assert.doesNotMatch(mod, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(mod, /behavior:\s*'smooth'|scrollIntoView|\.style\.[a-z]+\s*=|setAttribute\('style'/, 'custom properties through setProperty only (the page policy blocks style attributes)');
  assert.match(mod, /mb\.glide\(to, \{ keepOnKeys: true \}\)/);
  assert.match(mod, /visualViewport/, 'the room above the on-screen keyboard');
});

test('suggestions css: only under 900px, its own keyframe name, reduced motion, readable targets, dark mode', () => {
  const block = css.slice(css.indexOf('live suggestions under the search fields'));
  assert.ok(block.length > 500);
  assert.match(block, /@keyframes rs-sug-in/);
  assert.equal((css.match(/@keyframes rs-sug-in/g) || []).length, 1, 'a keyframe name must be unique');
  assert.match(block, /@media \(min-width: 900px\) \{ \.rs-sug \{ display: none !important; \} \}/);
  assert.match(block, /prefers-reduced-motion: reduce\) \{ \.rs-sug\.is-in \{ animation: none; \}/);
  assert.match(block, /\.rs-sug-opt \{[^}]*min-height: 60px/, 'a tap target above 44px');
  assert.match(block, /touch-action: manipulation/);
  assert.match(block, /\.rs-sug-all \{[^}]*position: sticky; bottom: 0/, 'the "See all" line stays in view while the options scroll');
  assert.match(block, /:root\.dark \.rs-sug/);
  assert.doesNotMatch(block, /(^|[\s,}])(html|body)\s*[{,]/m);
  assert.doesNotMatch(block, /animation:[^;]*(height|top|left)/);
});
