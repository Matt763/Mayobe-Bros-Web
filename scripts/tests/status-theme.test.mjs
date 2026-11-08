// The theme button on the pages that email links open (js/status-theme.js): the page follows the device first, one press always flips
// what the reader sees, a choice is stored only when it differs from the device, and it uses the same rule and key as js/site.js.
//   node --no-warnings --test scripts/tests/status-theme.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'status-theme.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

function setup({ deviceDark, stored = null, blocked = false, reduced = false, noButton = false }) {
  const classes = new Set();
  const root = { classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); }, add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  const btn = { attrs: {}, handlers: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.handlers[t] = f; } };
  const db = new Map(stored ? [['theme', stored]] : []);
  const listeners = [];
  const mq = { matches: deviceDark, addEventListener: (t, f) => listeners.push(f) };
  const ctx = {
    document: { documentElement: root, querySelectorAll: () => (noButton ? [] : [btn]) },
    window: { matchMedia: (q) => (/reduce/.test(q) ? { matches: reduced } : mq) },
    localStorage: {
      getItem: (k) => { if (blocked) throw new Error('blocked'); return db.get(k) ?? null; },
      setItem: (k, v) => { if (blocked) throw new Error('blocked'); db.set(k, v); },
      removeItem: (k) => { if (blocked) throw new Error('blocked'); db.delete(k); },
    },
    setTimeout, clearTimeout,
  };
  ctx.window.matchMedia.__ctx = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    btn, classes, dark: () => classes.has('dark'), press: () => btn.handlers.click(),
    stored: () => db.get('theme') ?? null,
    deviceChanges: (nowDark) => { mq.matches = nowDark; listeners.forEach((f) => f()); },
  };
}

test('with nothing stored the page follows the device, light or dark', () => {
  assert.equal(setup({ deviceDark: true }).dark(), true);
  assert.equal(setup({ deviceDark: false }).dark(), false);
});

test('one press always changes what the reader sees, on a light and on a dark device', () => {
  for (const deviceDark of [false, true]) {
    const t = setup({ deviceDark });
    const before = t.dark();
    t.press();
    assert.equal(t.dark(), !before, `device dark=${deviceDark}`);
    t.press();
    assert.equal(t.dark(), before);
  }
});

test('a choice is stored only when it differs from the device; flipping back clears it', () => {
  const t = setup({ deviceDark: false });
  assert.equal(t.stored(), null);
  t.press();
  assert.equal(t.stored(), 'dark');
  t.press();
  assert.equal(t.stored(), null);
  const d = setup({ deviceDark: true });
  d.press();
  assert.equal(d.stored(), 'light');
  assert.equal(d.classes.has('light'), true);
});

test('a stored choice wins over the device, and the label says what the next press does', () => {
  const t = setup({ deviceDark: true, stored: 'light' });
  assert.equal(t.dark(), false);
  assert.equal(t.btn.attrs['aria-label'], 'Switch to dark mode');
  t.press();
  assert.equal(t.dark(), true);
  assert.equal(t.btn.attrs['aria-label'], 'Switch to light mode');
});

test('while the reader has made no choice, a change of the device setting is followed live; after a choice it is not', () => {
  const t = setup({ deviceDark: false });
  t.deviceChanges(true);
  assert.equal(t.dark(), true);
  const c = setup({ deviceDark: false });
  c.press(); // dark, stored
  c.deviceChanges(false);
  assert.equal(c.dark(), true, 'the reader chose dark; the device change is ignored');
});

test('blocked storage does not break the button: the choice lasts while the page is open', () => {
  const t = setup({ deviceDark: false, blocked: true });
  assert.equal(t.dark(), false);
  t.press();
  assert.equal(t.dark(), true);
  t.press();
  assert.equal(t.dark(), false);
});

test('a page without the button does nothing', () => {
  const t = setup({ deviceDark: true, noButton: true });
  assert.equal(t.classes.size, 0);
});

test('it uses the same storage key and class names as js/site.js, which the inline script in <head> also reads', () => {
  const site = fs.readFileSync(path.join(ROOT, 'js', 'site.js'), 'utf8');
  for (const needle of ["store('theme'", "classList.toggle('dark'", "classList.toggle('light'", "'Switch to light mode'", "'Switch to dark mode'", 'theme-fade', 'prefers-color-scheme: dark']) {
    assert.ok(site.includes(needle), `site.js has ${needle}`);
    assert.ok(SRC.includes(needle.replace("store('theme'", "store('theme'")), `status-theme.js has ${needle}`);
  }
});

test('the status page styles use the theme variables: no hard-coded white card or page background that would hide light text in dark mode', () => {
  const start = CSS.indexOf('.page-status {');
  const block = CSS.slice(start, CSS.indexOf('@media (prefers-reduced-motion', start));
  assert.doesNotMatch(block, /background:\s*#fff\b/i, 'no white background in the status block');
  assert.match(block, /\.page-status \{[^}]*background: var\(--bg\)/);
  assert.match(block, /\.st-card \{[^}]*background: var\(--surface\)/);
  assert.match(block, /\.st-theme \{/);
  // the extra variables exist in the light block, the dark block and the device-dark block
  for (const v of ['--st-glow', '--st-badge', '--st-err-bg', '--st-card-shadow']) {
    assert.equal(CSS.split(`${v}:`).length - 1, 3, `${v} is defined for light, dark and device-dark`);
  }
});
