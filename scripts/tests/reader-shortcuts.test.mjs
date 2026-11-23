// The in-site PDF reader: keyboard shortcuts, Backspace as one step back, the shortcuts and gestures list, and swipe to change page.
//   node --no-warnings --test scripts/tests/reader-shortcuts.test.mjs
// Source-level checks (the behaviour itself was driven in Chromium with real keys and real touch input, see the session report).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const js = read('js/papers-reader.js'), css = read('css/papers-reader.css');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '');
const method = (name, from = code) => { // text of one class method, from "  name(" to the next method at the same indent
  const i = from.indexOf(`\n  ${name}(`); assert.ok(i >= 0, `method ${name} exists`);
  const rest = from.slice(i + 1), j = rest.slice(2).search(/\n  [a-zA-Z]+\([^)]*\) \{/);
  return j < 0 ? rest : rest.slice(0, j + 2);
};

test('onKey: Escape and Backspace share one "one step back" path, in a fixed order', () => {
  const back = method('stepBack');
  const order = ['this.helpPanel.hidden', 'this.closeMenus()', 'this.printPanel.hidden', 'this.searchBar.hidden', 'this.thumbs.hidden', 'document.fullscreenElement', 'this.close()'].map((s) => back.indexOf(s));
  assert.ok(order.every((n) => n >= 0), 'every layer is handled: ' + order);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'list, menu, print, find bar, thumbnails, full screen, reader: in that order');
  const key = method('onKey');
  assert.match(key, /e\.key === 'Escape'\) \{[^}]*this\.stepBack\(\)/, 'Esc goes through stepBack');
  assert.match(key, /e\.key === 'Backspace'\) \{[\s\S]*?this\.stepBack\(\)/, 'Backspace goes through stepBack');
});

test('Backspace: never in a field, never with Ctrl, Alt or Meta, never repeated, always prevented', () => {
  const key = method('onKey');
  const iMod = key.indexOf('e.ctrlKey || e.metaKey || e.altKey'), iTyping = key.indexOf("const typing = t.matches?.('input, textarea, select, [contenteditable]')");
  const iBack = key.indexOf("e.key === 'Backspace'"), iMenu = key.indexOf('this.openMenu && this.openMenu.menu.contains(t)');
  assert.ok(iMod >= 0 && iTyping > iMod && iBack > iTyping, 'modifier guard, then the typing guard, then Backspace');
  assert.ok(iBack < iMenu, 'Backspace is handled before the menu keys so it can close a menu');
  const block = key.slice(iBack, key.indexOf('return;\n    }', iBack) + 12);
  assert.match(block, /if \(typing\) return;/);
  assert.match(block, /e\.preventDefault\(\)/);
  assert.match(block, /if \(!e\.repeat\) this\.stepBack\(\)/);
  assert.ok(!/history\.(back|go|pushState|replaceState)/.test(block), 'the history is left to close()');
});

test('keys: ? f n p j k w a are wired; page, find and page-box fields keep their letters', () => {
  const key = method('onKey');
  assert.match(key, /e\.key === '\?' \|\| \(e\.code === 'Slash' && e\.shiftKey\)/);
  assert.match(key, /case 'PageDown': case 'n': case 'N': case 'j': case 'J'/);
  assert.match(key, /case 'PageUp': case 'p': case 'P': case 'k': case 'K'/);
  assert.match(key, /case '0': case 'w': case 'W'/);
  assert.match(key, /case 'a': case 'A': e\.preventDefault\(\); this\.mode = 'page'/);
  assert.match(key, /case 'f': case 'F': .*toggleFullscreen/);
  for (const old of ["'g'", "'d'", "'t'", "'/'", "'+'", "'-'", "'Home'", "'End'", "' '"]) assert.ok(key.includes(`case ${old}`), `the old key ${old} is still there`);
  assert.ok(key.indexOf("if (typing) return;") < key.indexOf('switch (e.key)'), 'the typing guard comes before every letter shortcut');
  const doc = method('onDocKey');
  for (const k of ["'s'", "'p'", "'f' || k === 'g'"]) assert.ok(doc.includes(`k === ${k}`), `Ctrl+${k} is kept`);
});

test('the list: opens with ?, from a toolbar button and from More; Esc and Close shut it; a labelled dialog with a real list', () => {
  assert.match(js, /btn\('help', 'Shortcuts and gestures', 'help', \{ cls: 'is-wide', title: 'Shortcuts and gestures \(\?\)'/, 'toolbar button on wide screens');
  assert.match(js, /mi\('help', 'Shortcuts and gestures', 'help'/, 'More menu item on narrow screens');
  assert.match(code, /case 'help': return this\.toggleHelp\(true\)/);
  assert.match(code, /case 'helpClose': return this\.toggleHelp\(false\)/);
  const build = method('buildHelpPanel');
  assert.match(build, /role: 'dialog'/); assert.match(build, /'aria-labelledby'/);
  assert.match(build, /h\('dl'/); assert.match(build, /h\('kbd'/); assert.match(build, /\(pointer: coarse\)/, 'the group that fits the device comes first');
  assert.match(build, /'Keyboard'/); assert.match(build, /'Touch and mouse'/);
  assert.ok(!/style\s*:/.test(build), 'no inline style attribute');
  const open = method('toggleHelp');
  assert.match(open, /this\.helpPanel\.focus\(/, 'focus moves in');
  assert.match(open, /this\.helpFrom/, 'and comes back');
  assert.match(method('trapTab'), /this\.helpPanel\.hidden \? this\.root : this\.helpPanel/, 'Tab stays inside the list while it is open');
  assert.match(method('onOutsidePointer'), /helpPanel/);
  assert.match(method('chromeLocked'), /this\.helpPanel\.hidden/, 'the bars stay while the list is open');
  // opening search or print closes the list: they sit in the same corner
  assert.match(method('toggleSearch'), /this\.toggleHelp\(false/); assert.match(method('togglePrint'), /this\.toggleHelp\(false/);
});

test('every key the reader answers to is in the list, in aria-keyshortcuts and in the button titles', () => {
  const lists = js.slice(js.indexOf('const HELP_KEYS'), js.indexOf('const HELP_NOTE'));
  for (const k of ['N | J | Page Down', 'P | K | Page Up', 'Home | End', 'G', 'Space | Shift + Space', 'W | 0', 'A', '/ | Ctrl + F', 'T', 'D', 'F', 'Ctrl + S', 'Ctrl + P', '?', 'Esc | Backspace']) assert.ok(lists.includes(`['${k}'`), `list has ${k}`);
  const map = js.match(/const KEYSHORTCUTS = \{([^}]*)\}/)[1];
  for (const a of ['close', 'thumbs', 'prev', 'next', 'zoomIn', 'zoomOut', 'fitWidth', 'fitPage', 'search', 'download', 'print', 'dark', 'fullscreen', 'help']) assert.match(map, new RegExp(`\\b${a}:`), `aria-keyshortcuts for ${a}`);
  assert.match(map, /close: 'Escape Backspace'/);
  assert.match(code, /for \(const b of this\.root\.querySelectorAll\('button\[data-act\]'\)\) \{ const k = KEYSHORTCUTS\[b\.dataset\.act\]; if \(k\) b\.setAttribute\('aria-keyshortcuts', k\)/);
  assert.match(js, /title: 'Close reader \(Esc or Backspace\)'/);
  for (const t of ['Page thumbnails (T)', 'Previous page (P)', 'Next page (N)', 'Fit width (W)', 'Fit page (A)', 'Full screen (F)', 'Dark reading mode (D)', 'Shortcuts and gestures (?)']) assert.ok(js.includes(`'${t}'`), `title ${t}`);
});

test('swipe: only on a page that cannot move sideways, clearly sideways, far in Fit page or a quick flick; nothing is cancelled; reduced motion has no lean', () => {
  const swipe = method('endSwipe'), ok = method('swipeOK'), ptr = method('setupPointers');
  assert.match(ok, /v\.scrollWidth <= v\.clientWidth \+ 1/, 'no sideways room left to the browser');
  assert.match(ok, /getSelection/, 'not while text is being selected');
  assert.match(ptr, /Math\.abs\(dx\) > Math\.abs\(dy\) \* SWIPE_ANGLE && this\.swipeOK\(\)/);
  assert.match(swipe, /this\.mode === 'page' && Math\.abs\(dx\) >= Math\.max\(SWIPE_FAR/);
  assert.match(swipe, /Math\.abs\(speed\) >= SWIPE_FLICK_SPEED/);
  assert.match(swipe, /Math\.abs\(dy\) <= Math\.abs\(dx\) \* 0\.6/);
  assert.match(swipe, /this\.goTo\(n\)/, 'the existing eased page change');
  assert.ok(!/preventDefault/.test(ptr), 'no event is cancelled: scrolling and selection are left alone');
  assert.match(ptr, /if \(!this\.reduced\) this\.pagesEl\.style\.setProperty\('--ppr-swipe'/);
  assert.match(swipe, /if \(!this\.reduced\) \{ el\.classList\.add\('is-swipe-back'\)/);
  assert.match(css, /\.ppr__view \{[^}]*touch-action: pan-y;/);
  assert.match(css, /\.ppr__view\.can-pan-x \{ touch-action: pan-x pan-y; \}/);
  assert.match(code, /syncPan\(\) \{ this\.view\.classList\.toggle\('can-pan-x'/);
  assert.match(css, /@keyframes ppr-flip/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.ppr__flip\.is-on \{ opacity: 1; \}/);
  assert.ok(!/(^|[^-\w])(width|height|top|left)\s*:[^;{}]*;[^}]*}\s*to\b/.test(css.slice(css.indexOf('@keyframes ppr-flip'))), 'the chip moves with transform and opacity only');
});

test('the list and the chip: light and dark colours, 44 px close button, nothing new stored or fetched, words in the house style', () => {
  for (const sel of ['.ppr--dark .ppr__help', '.ppr--dark .ppr__help kbd', '.ppr--dark .ppr__helpgh', '.ppr--dark .ppr__flip']) assert.ok(css.includes(sel), sel);
  assert.match(css, /\.ppr__btn \{[^}]*width: 44px; height: 44px/, 'the close button is a .ppr__btn: 44 px');
  assert.match(css, /@media \(max-width: 1023\.98px\) \{\s*\.ppr__help \{ left: 8px; right: 8px/, 'the list fits a phone');
  assert.equal((code.match(/localStorage\.setItem/g) || []).length, 1, 'still one stored setting (dark mode)');
  assert.ok(!/sessionStorage|document\.cookie|indexedDB|beforeunload|replaceState/.test(code));
  assert.equal((code.match(/history\.pushState/g) || []).length, 1, 'the one history entry the reader already owned');
  assert.equal((code.match(/\bfetch\(/g) || []).length, 1, 'the one existing fetch (download fallback)');
  const words = [...(js.slice(js.indexOf('const HELP_KEYS'), js.indexOf('const KEYSHORTCUTS')).matchAll(/'((?:[^'\\\n]|\\.)*)'/g)), ...method('endSwipe').matchAll(/'((?:[^'\\\n]|\\.)*)'/g), ...method('flipChip').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]);
  const bad = /\bsorry\b|\boops\b|\bplease\b|[a-z]!(\s|$)|\bserver\b|\bAPI\b|JSON|network error|timeout|\bHTTP\b|\bstatus code\b|\btoken\b/i;
  for (const t of words) assert.doesNotMatch(t, bad, t);
  assert.ok(/Every gesture also has a button/.test(js), 'the list says each gesture has a button');
});
