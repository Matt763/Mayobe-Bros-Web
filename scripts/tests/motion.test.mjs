// js/motion.js (window.MBMotion): the shared glide and page-change states, its CSS and its script tag.
//   node --no-warnings --test scripts/tests/motion.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRenderer } from '../lib/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_PATH = path.join(ROOT, 'js', 'motion.js');
const SRC = () => fs.readFileSync(SRC_PATH, 'utf8');
const CSS = () => fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

function classList() {
  const s = new Set();
  return {
    add: (...c) => c.forEach((x) => s.add(x)),
    remove: (...c) => c.forEach((x) => s.delete(x)),
    contains: (c) => s.has(c),
    toggle: (c, force) => { const on = force === undefined ? !s.has(c) : !!force; if (on) s.add(c); else s.delete(c); return on; },
    get size() { return s.size; },
    list: () => [...s],
  };
}
function el({ top = 0, opacity = '1', children = [] } = {}) {
  const props = {};
  const handlers = {};
  return {
    classList: classList(),
    style: {
      setProperty: (k, v) => { props[k] = String(v); },
      removeProperty: (k) => { delete props[k]; },
      getPropertyValue: (k) => (k in props ? props[k] : ''),
    },
    props,
    handlers,
    computed: { opacity },
    firstElementChild: children[0] || null,
    getBoundingClientRect: () => ({ top, bottom: top + 100 }),
    addEventListener: (t, f) => { (handlers[t] = handlers[t] || []).push(f); },
    removeEventListener: (t, f) => { handlers[t] = (handlers[t] || []).filter((g) => g !== f); },
  };
}

function load({ reduce = false, scrollY = 0, innerHeight = 800, scrollHeight = 10000, header = 67 } = {}) {
  const calls = [];
  const stamps = [];
  let raf = [];
  let now = 1000;
  let frameT = null;
  const winListeners = {};
  const timers = [];
  const html = classList();
  const headerEl = header === null ? null : { getBoundingClientRect: () => ({ top: header - 67, bottom: header }) };
  const ctx = {
    innerHeight,
    scrollY,
    matchMedia: (q) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)', media: q }),
    scrollTo(x, y) { calls.push(y); stamps.push(frameT); ctx.scrollY = y; },
    requestAnimationFrame(cb) { raf.push(cb); return raf.length; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms) { const t = { fn, ms, done: false }; timers.push(t); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].done = true; },
    getComputedStyle: (e) => e.computed || { opacity: '1' },
    addEventListener(type, fn, opts) { (winListeners[type] = winListeners[type] || []).push({ fn, opts }); },
    removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter((l) => l.fn !== fn); },
    document: {
      documentElement: { classList: html, scrollHeight },
      querySelector: (s) => (s === '.site-header' ? headerEl : null),
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC(), ctx);
  const frames = (n, step = 16) => {
    for (let i = 0; i < n; i++) {
      const q = raf;
      raf = [];
      frameT = now;
      q.forEach((cb) => cb(now));
      frameT = null;
      now += step;
    }
  };
  const fire = (type) => (winListeners[type] || []).slice().forEach((l) => l.fn({ type }));
  const listeners = () => Object.values(winListeners).reduce((n, a) => n + a.length, 0);
  const runTimers = (ms) => timers.filter((t) => !t.done && (ms === undefined || t.ms === ms)).forEach((t) => { t.done = true; t.fn(); });
  return { M: ctx.MBMotion, ctx, calls, stamps, frames, fire, listeners, html, timers, runTimers, rafQueued: () => raf.length, winListeners };
}

test('easing: 0 at 0, 1 at 1, 0.5 in the middle, never backwards', () => {
  const { M } = load();
  assert.equal(M.easeInOutCubic(0), 0);
  assert.equal(M.easeInOutCubic(0.5), 0.5);
  assert.equal(M.easeInOutCubic(1), 1);
  assert.equal(M.easeInOutCubic(0.25), 0.0625);
  assert.equal(M.easeInOutCubic(-1), 0);
  assert.equal(M.easeInOutCubic(2), 1);
  let prev = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const v = M.easeInOutCubic(i / 100);
    assert.ok(v >= prev, `went backwards at ${i / 100}`);
    prev = v;
  }
});

test('duration grows with distance and stays between 260 and 520 ms', () => {
  const { M } = load();
  const cases = [[0, 0], [1, 0], [100, 260], [400, 348], [640, 449], [2000, 520], [-640, 449]];
  for (const [d, ms] of cases) assert.equal(M.glideDuration(d), ms, `glideDuration(${d})`);
});

test('plan: a covered long trip jumps the hidden part and glides at most 0.8 of a screen', () => {
  const { M } = load();
  assert.deepEqual({ ...M.planGlide(8000, 600, 800, true) }, { jumpTo: 1240, start: 1240, to: 600, duration: 449 });
  assert.equal(M.planGlide(0, 3000, 800, true).jumpTo, 2360);
  assert.deepEqual({ ...M.planGlide(8000, 600, 800, false) }, { jumpTo: null, start: 8000, to: 600, duration: 520 });
  assert.deepEqual({ ...M.planGlide(900, 600, 800, true) }, { jumpTo: null, start: 900, to: 600, duration: 306 });
  assert.equal(M.planGlide(600, 601, 800, true).duration, 0);
});

test('topOf puts an element 16 px under the bottom of the sticky header', () => {
  assert.equal(load({ scrollY: 1000, header: 67 }).M.topOf(el({ top: 500 })), 1417);
  assert.equal(load({ scrollY: 1000, header: null }).M.topOf(el({ top: 500 })), 1484);
  assert.equal(load({ scrollY: 0, header: 67 }).M.topOf(el({ top: 20 })), 0);
  assert.equal(load({ header: null }).M.headerBottom(), 0);
  assert.equal(load({ header: 67 }).M.headerBottom(), 67);
  assert.equal(load().M.GAP, 16);
});

test('glide follows the curve, ends exactly on the target, and tidies up', async () => {
  const t = load({ scrollY: 900 });
  const p = t.M.glide(600);
  assert.ok(t.html.contains('mo-gliding'), 'mo-gliding while gliding');
  assert.ok(t.listeners() > 0, 'listens for interruptions');
  t.frames(30, 17);
  const ys = t.calls;
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] <= ys[i - 1], `went backwards at call ${i}`);
  const t0 = t.stamps[0];
  const mid = t.stamps.indexOf(t0 + 153);
  assert.ok(mid > -1, 'a frame at t0 + 153 ms');
  assert.ok(Math.abs(ys[mid] - 750) <= 1, `half way is ${ys[mid]}`);
  assert.equal(ys[ys.length - 1], 600);
  assert.equal(await p, 'done');
  assert.ok(!t.html.contains('mo-gliding'), 'class removed');
  assert.equal(t.listeners(), 0);
});

test('a covered glide jumps once first, then glides', async () => {
  const t = load({ scrollY: 8000 });
  const p = t.M.glide(600, { covered: true });
  assert.deepEqual([...t.calls], [1240]);
  assert.equal(t.stamps[0], null, 'the jump happens before any frame');
  t.frames(40, 16);
  for (const y of t.calls.slice(1)) assert.ok(y >= 600 && y <= 1240, `out of range: ${y}`);
  assert.equal(t.calls[t.calls.length - 1], 600);
  assert.equal(await p, 'done');
});

test('a wheel, touch, pointer press or key stops the glide where it is', async () => {
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    const t = load({ scrollY: 0 });
    const p = t.M.glide(600);
    const reg = t.winListeners[type] || [];
    assert.equal(reg.length, 1, `listens for ${type}`);
    assert.equal(reg[0].opts.capture, true, `${type} capture`);
    assert.equal(reg[0].opts.passive, true, `${type} passive`);
    t.frames(3);
    const before = t.calls.length;
    t.fire(type);
    t.frames(10);
    assert.equal(t.calls.length, before, `no scroll after ${type}`);
    assert.equal(await p, 'cancelled');
    assert.ok(!t.html.contains('mo-gliding'), `class gone after ${type}`);
    assert.equal(t.listeners(), 0, `no listeners after ${type}`);
  }
});

test('a new glide cancels the one in flight', async () => {
  const t = load({ scrollY: 0 });
  const p1 = t.M.glide(100);
  t.frames(2);
  const p2 = t.M.glide(300);
  assert.equal(await p1, 'cancelled');
  t.frames(60);
  assert.equal(t.calls[t.calls.length - 1], 300);
  assert.equal(await p2, 'done');
  assert.ok(!t.html.contains('mo-gliding'));
  assert.equal(t.listeners(), 0);
});

test('the target is clamped to the page', async () => {
  const a = load({ scrollY: 300, scrollHeight: 2000, innerHeight: 800 });
  const pa = a.M.glide(5000);
  a.frames(60);
  assert.equal(a.calls[a.calls.length - 1], 1200);
  assert.equal(await pa, 'done');
  const b = load({ scrollY: 300, scrollHeight: 2000, innerHeight: 800 });
  const pb = b.M.glide(-50);
  b.frames(60);
  assert.equal(b.calls[b.calls.length - 1], 0);
  assert.equal(await pb, 'done');
  const c = load({ scrollY: 600 });
  assert.equal(await c.M.glide(601), 'none');
  assert.equal(c.calls.length, 0);
  assert.ok(!c.html.contains('mo-gliding'));
});

test('reduced motion: one instant jump, no frames, no classes', async () => {
  const t = load({ reduce: true, scrollY: 0 });
  assert.equal(t.M.prefersReduced(), true);
  const p = t.M.glide(600);
  assert.deepEqual([...t.calls], [600]);
  assert.equal(t.rafQueued(), 0);
  assert.ok(!t.html.contains('mo-gliding'));
  assert.equal(await p, 'instant');
  assert.equal(t.listeners(), 0);

  const box = el({ children: [el()] });
  box.classList.add('mo-wait');
  await t.M.leave(box);
  assert.equal(box.classList.size, 0, 'no class after leave');
  assert.equal(t.timers.length, 0, 'no timer');
  const a = el();
  const b = el();
  t.M.enter([a, b], box);
  assert.equal(a.classList.size + b.classList.size, 0);
  assert.equal(load().M.prefersReduced(), false);
});

test('leave fades out in 160 ms, starting from where a slow-load dim left it', async () => {
  const t = load();
  assert.equal(t.M.LEAVE_MS, 160);
  const box = el({ children: [el({ opacity: '0.5' })] });
  t.M.wait(box, true);
  assert.ok(box.classList.contains('mo-wait'));
  let done = false;
  const p = t.M.leave(box).then(() => { done = true; });
  assert.ok(box.classList.contains('mo-leave'));
  assert.ok(!box.classList.contains('mo-wait'));
  assert.equal(box.style.getPropertyValue('--mo-from'), '0.5');
  assert.equal(t.timers.length, 1);
  assert.equal(t.timers[0].ms, 160);
  await Promise.resolve();
  assert.equal(done, false, 'waits for the timer');
  t.runTimers(160);
  await p;
  assert.equal(done, true);
  const w = el();
  t.M.wait(w, true);
  t.M.wait(w, false);
  assert.ok(!w.classList.contains('mo-wait'));
});

test('enter staggers new items, capped at the 7th, and cleans up', () => {
  const t = load();
  const box = el();
  box.classList.add('mo-leave', 'mo-wait');
  box.style.setProperty('--mo-from', '0.5');
  const nodes = Array.from({ length: 9 }, () => el());
  t.M.enter(nodes, box);
  assert.deepEqual(nodes.map((n) => n.style.getPropertyValue('--mo-i')), ['0', '1', '2', '3', '4', '5', '6', '6', '6']);
  assert.ok(nodes.every((n) => n.classList.contains('mo-enter')));
  assert.ok(!box.classList.contains('mo-leave') && !box.classList.contains('mo-wait'));
  assert.equal(box.style.getPropertyValue('--mo-from'), '');
  (nodes[0].handlers.animationend || []).slice().forEach((f) => f({ animationName: 'other' }));
  assert.ok(nodes[0].classList.contains('mo-enter'), 'another animation does not end it');
  (nodes[0].handlers.animationend || []).slice().forEach((f) => f({ animationName: 'mo-in' }));
  assert.ok(!nodes[0].classList.contains('mo-enter'));
  assert.ok(nodes[1].classList.contains('mo-enter'));
  t.runTimers(1000);
  assert.ok(nodes.every((n) => !n.classList.contains('mo-enter')));
  assert.ok(nodes.every((n) => (n.handlers.animationend || []).length === 0), 'listeners removed');
});

test('the module never stores, fetches or writes HTML', () => {
  assert.doesNotMatch(SRC(), /localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|innerHTML|will-change|willChange/);
});

test('style.css: unique keyframes, the motion block and its reduced-motion switch', () => {
  const css = CSS();
  for (const k of ['mo-in', 'mo-out', 'mo-dim']) assert.equal(css.split(`@keyframes ${k} `).length - 1, 1, `@keyframes ${k} once`);
  const names = [...css.matchAll(/@keyframes ([a-z0-9-]+)/g)].map((m) => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dup, [], 'duplicate @keyframes names');
  const g = css.match(/html\.mo-gliding\s*\{([^}]*)\}/);
  assert.ok(g, 'html.mo-gliding rule');
  assert.match(g[1], /scroll-behavior:\s*auto !important/);
  assert.match(g[1], /overflow-anchor:\s*none/);
  assert.doesNotMatch(g[1], /transform|filter|contain|will-change/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^{}]*\.mo-enter[^{}]*\{\s*animation:\s*none/);
  assert.match(css, /\.mo-enter\s*\{[^}]*animation:\s*mo-in 0\.4s var\(--ease\) both;[^}]*animation-delay:\s*calc\(var\(--mo-i, 0\) \* 35ms\)/);
  assert.match(css, /\.mo-leave > \*\s*\{\s*animation:\s*mo-out 0\.16s ease-in both;/);
  assert.match(css, /\.mo-wait > \*\s*\{\s*animation:\s*mo-dim 0\.3s ease 0\.15s both;/);
});

test('every page loads js/motion.js first', () => {
  const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const cats = [{ slug: 'educational', name: 'Education', labels: [], empty: false, image: 'assets/posts/a.webp' }];
  const r = createRenderer({ config: SITE, categories: cats, posts: [], pages: [], authors: [], versions: {} });
  for (const [name, h] of [['home', r.home()], ['search', r.searchPage()], ['404', r.notFound()]]) {
    const m = h.indexOf('js/motion.js');
    assert.ok(m > -1, `${name}: loads js/motion.js`);
    assert.ok(m < h.indexOf('js/site.js'), `${name}: before site.js`);
    const firstScript = h.search(/<script src=/);
    assert.match(h.slice(firstScript), /^<script src="[^"]*\/js\/motion\.js/, `${name}: first script tag`);
    if (name === '404') assert.ok(m < h.indexOf('js/notfound.js'), '404: before notfound.js');
  }
});

test('built pages carry a versioned motion.js', () => {
  for (const f of ['index.html', 'post/index.html']) {
    const p = path.join(ROOT, f);
    assert.ok(fs.existsSync(p), `${f} is missing: run node scripts/build.mjs first`);
    assert.ok(/js\/motion\.js\?v=[a-f0-9]+/.test(fs.readFileSync(p, 'utf8')), `${f} has no versioned js/motion.js: run node scripts/build.mjs first`);
  }
});

test('pager.js: shared motion, no native smooth scroll, restoration handed back on pagehide', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'pager.js'), 'utf8');
  assert.match(src, /MBMotion/);
  assert.match(src, /scrollRestoration = 'manual'/);
  assert.match(src, /pagehide[\s\S]{0,200}scrollRestoration = 'auto'/);
  assert.doesNotMatch(src, /scrollIntoView\(\{ behavior|behavior: fx \? 'smooth'|minHeight|is-entering|announce\(\(nav/);
});
