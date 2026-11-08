// The theme toggle (js/site.js): ONE press must always change what the reader sees. It used to cycle device > light > dark, so the first
// press did nothing visible whenever the device already matched ("light" on a light device), and people pressed twice.
//   node --no-warnings --test scripts/tests/theme.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'js', 'site.js'), 'utf8');
const BLOCK = SRC.slice(SRC.indexOf('/* ---------------------------------------------------------------- theme'), SRC.indexOf('/* ------------------------------------------------------ header and focus */'));

function setup({ deviceDark, stored = null, reduced = false }) {
  const classes = new Set();
  const root = { classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); }, add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  const btn = { attrs: {}, handlers: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.handlers[t] = f; } };
  const db = new Map(stored ? [['theme', stored]] : []);
  const mq = { matches: deviceDark, addEventListener() {} };
  const ctx = {
    root, window: { matchMedia: (q) => (/reduce/.test(q) ? { matches: reduced } : mq) },
    $$: () => [btn], store: (k, v) => { if (v === undefined) return db.get(k) ?? null; if (v === null) db.delete(k); else db.set(k, v); return null; },
    setTimeout, clearTimeout, console,
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK, ctx);
  const dark = () => classes.has('dark');
  return { btn, dark, press: () => btn.handlers.click(), stored: () => db.get('theme') ?? null, classes };
}

test('one press flips what is shown, for every starting point', () => {
  for (const deviceDark of [false, true]) for (const stored of [null, 'light', 'dark']) {
    const t = setup({ deviceDark, stored });
    const before = t.dark();
    t.press();
    assert.notEqual(t.dark(), before, `device ${deviceDark ? 'dark' : 'light'}, stored ${stored}: the first press must change the theme`);
    t.press();
    assert.equal(t.dark(), before, 'the second press goes back');
  }
});

test('nothing is stored while the choice matches the device; a different choice is remembered', () => {
  const t = setup({ deviceDark: false });
  assert.equal(t.stored(), null);
  t.press(); // light device > dark
  assert.equal(t.stored(), 'dark');
  t.press(); // back to what the device says
  assert.equal(t.stored(), null, 'back on the device setting: nothing stored');
  const d = setup({ deviceDark: true });
  d.press();
  assert.equal(d.stored(), 'light');
  d.press();
  assert.equal(d.stored(), null);
});

test('the label always names what the next press does', () => {
  const t = setup({ deviceDark: false });
  assert.equal(t.btn.attrs['aria-label'], 'Switch to dark mode');
  t.press();
  assert.equal(t.btn.attrs['aria-label'], 'Switch to light mode');
});

test('the colour fade is skipped for readers who ask for less motion', () => {
  const calm = setup({ deviceDark: false, reduced: true });
  calm.press();
  assert.equal(calm.classes.has('theme-fade'), false);
  const normal = setup({ deviceDark: false });
  normal.press();
  assert.equal(normal.classes.has('theme-fade'), true);
});

test('the stylesheet shows the sun in light mode and the moon in dark mode, never the old three-step device icon', () => {
  const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.theme-btn \.i-auto, \.theme-btn \.i-moon \{ display: none; \}/);
  assert.match(css, /html\.dark \.theme-btn \.i-moon \{ display: block; \}/);
  assert.match(css, /html\.theme-fade/);
});
