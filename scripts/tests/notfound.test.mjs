// The 404 page (404.html): no hero, the old project's layout in this site's design, safe without JavaScript.
//   node --no-warnings --test scripts/tests/notfound.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRenderer } from '../lib/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

const CATS = [
  { slug: 'educational', name: 'Education', labels: [], empty: false, image: 'assets/posts/a.webp' },
  { slug: 'world-histories', name: 'World Histories', labels: [], empty: true, image: '' },
];
function render404(over = {}, categories = CATS) {
  const config = { ...SITE, ...over };
  return createRenderer({ config, categories, posts: [], pages: [], authors: [], versions: {} }).notFound();
}
const mainOf = (h) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
const ADDR = /\s(?:href|src|srcset|imagesrcset|action)="([^"]*)"/g;
const addresses = (h) => [...h.matchAll(ADDR)].map((m) => m[1]);
const openTag = (h, attr) => {
  const m = h.match(new RegExp(`<[a-z]+\\b[^>]*\\b${attr}\\b[^>]*>`));
  assert.ok(m, `no element carries ${attr}`);
  return m[0];
};

test('404: no hero, one h1, the big 404, noindex and no-referrer, header and footer stay', () => {
  const h = render404();
  assert.doesNotMatch(h, /class="hero[\s"]/);
  assert.doesNotMatch(h, /rel="preload" as="image"/);
  assert.doesNotMatch(h, /Error 404<\/p>/);
  assert.equal((h.match(/<h1\b/g) || []).length, 1);
  assert.match(h, /<h1 class="nf-title">Page not found<\/h1>/);
  assert.match(h, /class="nf-code"><span class="sr-only">Error <\/span>404/);
  assert.match(h, /<meta name="robots" content="noindex, follow">/);
  assert.match(h, /<meta name="referrer" content="no-referrer">/);
  assert.match(h, /<header class="site-header"/);
  assert.match(h, /<footer class="site-footer"/);
});

const POSTS = Array.from({ length: 12 }, (_, i) => ({
  slug: `p${i}`, title: `Post number ${i}`, excerpt: `Excerpt ${i}`, date: new Date(Date.UTC(2026, 0, i + 1)), updated: null,
  category: { slug: 'educational', name: 'Education', image: '' }, label: null, path: `/post/educational/p${i}/`, image: '', tags: [], readingMinutes: 3, text: '',
}));
const renderWith = (posts, over = {}) => createRenderer({ config: { ...SITE, ...over }, categories: CATS, posts, pages: [], authors: [], versions: {} }).notFound();

test('404: no search box and no category pills; a "Posts you may be interested in" section instead', () => {
  const h = render404();
  assert.doesNotMatch(mainOf(h), /nf-search|nf-links|Looking for something specific|Search articles/);
  assert.equal((mainOf(h).match(/<form\b/g) || []).length, 0);
  assert.match(h, /<h2 class="nf-more-title">Posts you may be interested in<\/h2>/);
});

test('404: without JavaScript the nine newest posts are real cards, with a More articles link', () => {
  const h = renderWith(POSTS);
  const cards = mainOf(h).match(/<article class="card"/g) || [];
  assert.equal(cards.length, 9);
  assert.ok(h.indexOf('Post number 11') > -1 && h.indexOf('Post number 3<') > -1 && h.indexOf('Post number 2<') === -1, 'newest nine only');
  assert.ok(h.indexOf('Post number 11') < h.indexOf('Post number 10'), 'newest first');
  assert.match(h, /<a class="btn btn-outline" href="\/post\/">More articles/);
  assert.match(h, /data-nf-posts data-per="9"/);
  assert.doesNotMatch(h.match(/data-nf-grid[^>]*>/)[0], /data-reveal/);
  assert.ok(addresses(renderWith(POSTS, { basePath: '/repo' })).every((a) => /^(\/repo\/|https:\/\/|mailto:|#)/.test(a)));
});

test('404: every address is root-absolute, also under a basePath', () => {
  for (const a of addresses(render404())) assert.match(a, /^(\/(?!\/)|https:\/\/|mailto:|#)/, a);
  for (const a of addresses(render404({ basePath: '/repo' }))) assert.match(a, /^(\/repo\/|https:\/\/|mailto:|#)/, a);
});

test('404: without JavaScript nothing pretends to redirect', () => {
  const h = render404();
  for (const attr of ['data-nf-flow', 'data-nf-back']) assert.ok(openTag(h, attr).includes(' hidden'), `${attr} must start hidden`);
  assert.doesNotMatch(h, /http-equiv="refresh"/i);
  assert.match(h, /href="\/"[^>]*>[\s\S]*?Go to homepage/);
});

test('404: there is no countdown, no Stop button and no automatic redirect, in the page or in the script', () => {
  const h = render404();
  assert.doesNotMatch(h, /data-nf-timer|data-nf-stop|data-nf-count|data-nf-unit|nf-timer|Taking you to the home page/);
  assert.doesNotMatch(NF_SRC(), /location\.replace|location\.assign|location\.href\s*=|setInterval|setTimeout|clearInterval/);
  for (const o of [{}, { path: '/missing/' }, { reduce: true }]) {
    const t = setup(o);
    t.tick(30);
    assert.equal(replaces(t).length, 0, JSON.stringify(o));
    assert.equal(t.intervals(), 0, JSON.stringify(o));
  }
});

test('404: the email-link notice is generic and gives the contact address', () => {
  const main = mainOf(render404());
  assert.ok(main.includes('This email link is not working right now'));
  assert.ok(main.includes('Nothing has been changed'));
  assert.ok(main.includes(`href="mailto:${SITE.contact.general}"`));
  assert.doesNotMatch(main, /newsletter/i);
});

test('404: no ads, even with AdSense switched on', () => {
  const h = render404({ adsense: { client: 'ca-pub-1234567890123456', autoAds: true, sidebarSlot: '1234567890' } });
  assert.doesNotMatch(h, /data-ads="1"/);
  assert.doesNotMatch(h, /adsbygoogle|data-ad-box/);
});

// ---- js/notfound.js inside a tiny stub browser (countdown, Stop, email-link notice, Go back) ----
import vm from 'node:vm';

const NF_FILE = path.join(ROOT, 'js', 'notfound.js');
const NF_SRC = () => fs.readFileSync(NF_FILE, 'utf8');

function target() {
  const t = { handlers: {} };
  t.addEventListener = (type, f) => { (t.handlers[type] = t.handlers[type] || []).push(f); };
  t.removeEventListener = (type, f) => { t.handlers[type] = (t.handlers[type] || []).filter((g) => g !== f); };
  return t;
}
function el() {
  const n = target();
  Object.assign(n, { hidden: false, textContent: '', focused: 0, classes: new Set() });
  n.classList = { add: (c) => n.classes.add(c), contains: (c) => n.classes.has(c) };
  n.focus = () => { n.focused++; };
  return n;
}

function setup({ path: pathname = '/nope/', search = '', hash = '', base = '', reduce = false, navType = 'navigate', historyLength = 2, visibility = 'visible', active = null, markup = true } = {}) {
  const log = [];
  const names = ['box', 'timer', 'text', 'count', 'unit', 'stop', 'status', 'back', 'flow'];
  const nodes = Object.fromEntries(names.map((k) => [k, el()]));
  for (const k of ['timer', 'back', 'flow']) nodes[k].hidden = true;
  let statusText = '';
  nodes.status.writes = 0;
  Object.defineProperty(nodes.status, 'textContent', { get: () => statusText, set: (v) => { statusText = v; nodes.status.writes++; } });
  const sel = { '[data-nf-timer]': 'timer', '[data-nf-text]': 'text', '[data-nf-count]': 'count', '[data-nf-unit]': 'unit', '[data-nf-stop]': 'stop', '[data-nf-status]': 'status', '[data-nf-back]': 'back', '[data-nf-flow]': 'flow' };
  nodes.box.querySelector = (s) => nodes[sel[s]] || null;
  const doc = target();
  Object.assign(doc, {
    visibilityState: visibility,
    activeElement: active ? nodes[active] : null,
    querySelector: (s) => (markup && s === '[data-nf]' ? nodes.box : null),
    documentElement: { getAttribute: (k) => (k === 'data-base' ? base : null) },
  });
  const win = target();
  win.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q) });
  const timers = [];
  let live = null;
  const ctx = {
    document: doc,
    window: win,
    location: { pathname, search, hash, replace: (u) => log.push(['replace', u]) },
    history: { length: historyLength, back: () => log.push(['back']), replaceState: (s, t, u) => log.push(['replaceState', u]) },
    performance: { getEntriesByType: () => [{ type: navType }] },
    setInterval: (f, ms) => { assert.equal(ms, 1000); timers.push(f); live = f; return timers.length; },
    clearInterval: () => { live = null; },
  };
  vm.createContext(ctx);
  vm.runInContext(NF_SRC(), ctx);
  const fire = (t, type, ev = {}) => { for (const f of [...(t.handlers[type] || [])]) f(ev); };
  const tick = (n) => { for (let i = 0; i < n && live; i++) live(); };
  return { log, nodes, doc, win, fire, tick, intervals: () => timers.length };
}
const replaces = (t) => t.log.filter((x) => x[0] === 'replace');

test('email-link paths show the notice, drop the code first and never redirect', () => {
  const T = 'A'.repeat(32);
  const cases = [['/newsletter/', { hash: '#c=' + T }], ['/manage/', { hash: '#l=' + T }], ['/manage/x/', { search: '?t=1' }], ['/repo/newsletter/', { hash: '#u=x', base: '/repo' }]];
  for (const [p, o] of cases) {
    const t = setup({ path: p, ...o });
    assert.deepEqual(t.log[0], ['replaceState', p], p);
    assert.equal(t.nodes.flow.hidden, false, p);
    t.tick(20);
    assert.equal(replaces(t).length, 0, p);
  }
  const plain = setup({ path: '/newsletter' });
  assert.equal(plain.nodes.flow.hidden, false);
  assert.equal(plain.log.filter((x) => x[0] === 'replaceState').length, 0);
  const near = setup({ path: '/newsletters-old/' });
  assert.equal(near.nodes.flow.hidden, true);
});

test('Go back appears only when there is a page to go back to', () => {
  assert.equal(setup({ historyLength: 1 }).nodes.back.hidden, true);
  const t = setup({ historyLength: 2 });
  assert.equal(t.nodes.back.hidden, false);
  t.fire(t.nodes.back, 'click');
  assert.ok(t.log.some((x) => x[0] === 'back'));
});

test('without the 404 markup the script does nothing', () => {
  const t = setup({ markup: false });
  assert.deepEqual(t.log, []);
  assert.equal(t.intervals(), 0);
});

test('the script never fetches, stores or writes HTML', () => {
  assert.doesNotMatch(NF_SRC(), /\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|innerHTML|insertAdjacentHTML|document\.write/);
});

// ---- wiring: render and the built file ----
test('404: notfound.js loads before site.js and before the analytics beacon', () => {
  const h = render404({ analytics: { cloudflareToken: 'a'.repeat(32) } });
  const a = h.indexOf('js/notfound.js'), b = h.indexOf('js/site.js'), c = h.indexOf('src="https://static.cloudflareinsights.com');
  assert.ok(a > -1 && b > -1 && c > -1, 'all three scripts present');
  assert.ok(a < b && b < c, `order ${a} ${b} ${c}`);
});

test('other pages do not load notfound.js', () => {
  const r = createRenderer({ config: SITE, categories: CATS, posts: [], pages: [], authors: [], versions: {} });
  assert.doesNotMatch(r.home(), /notfound\.js/);
});

test('the built 404.html loads notfound.js with a version and is in no sitemap', () => {
  const f = path.join(ROOT, '404.html');
  assert.ok(fs.existsSync(f), 'run node scripts/build.mjs first');
  assert.ok(/js\/notfound\.js\?v=[a-f0-9]+/.test(fs.readFileSync(f, 'utf8')), '404.html has no versioned js/notfound.js: run node scripts/build.mjs first');
  const maps = fs.readdirSync(ROOT).filter((n) => n === 'sitemap.xml' || /-sitemap\d*\.xml$/.test(n));
  assert.ok(maps.length > 0);
  for (const m of maps) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, m), 'utf8'), /404/, m);
});

// ---- js/notfound-posts.js: random posts, nine per page, paginated in place ----
const NP_SRC = () => fs.readFileSync(path.join(ROOT, 'js', 'notfound-posts.js'), 'utf8');
function runPosts({ data, fail = false, base = '', random = () => 0.5, markup = true, motion = true } = {}) {
  const imgs = [];
  const link = { focused: 0, focus(o) { this.focused++; this.opts = o; } };
  const grid = { innerHTML: 'STATIC', querySelectorAll: () => imgs, querySelector: (s) => (s === 'a.card-link' ? link : null), children: ['c1', 'c2'] };
  const pager = Object.assign(target(), { innerHTML: '' });
  const all = { hidden: false };
  const title = { scrolled: 0, scrollIntoView() { this.scrolled++; }, getBoundingClientRect: () => ({ top: -400 }) };
  const log = [];
  const M = {
    leave: (box) => { log.push('leave'); assert.equal(box, grid); return Promise.resolve(); },
    enter: (nodes, box) => { log.push('enter'); assert.equal(box, grid); assert.equal(nodes, grid.children); },
    glide: (to, opts) => { log.push(['glide', to, opts]); return Promise.resolve('done'); },
    topOf: (el) => { assert.equal(el, title); return 1234; },
    headerBottom: () => 67,
  };
  const current = { focused: 0, offsetParent: {}, focus() { this.focused++; } };
  const status = { textContent: '' };
  const box = {
    getAttribute: (k) => (k === 'data-per' ? '9' : null),
    querySelector: (s) => ({ '[data-nf-grid]': grid, '[data-nf-pager]': pager, '[data-nf-all]': all, '.nf-more-title': title, '[data-nf-pager-status]': status }[s] || null),
    appendChild: () => {},
  };
  pager.querySelectorAll = (s) => (s === '.page-num.is-current' ? [{ offsetParent: null, focus() { hiddenFocused++; } }, current] : []);
  let hiddenFocused = 0;
  const doc = { querySelector: (s) => (markup && s === '[data-nf-posts]' ? box : null), documentElement: { getAttribute: () => base }, createElement: () => status };
  const fetched = [];
  const ctx = {
    document: doc,
    window: motion ? { fetch: true, MBMotion: M } : { fetch: true },
    fetch: (url) => { fetched.push(url); return fail ? Promise.reject(new Error('x')) : Promise.resolve({ ok: true, json: () => Promise.resolve(data) }); },
    Math: Object.assign(Object.create(Math), { random }),
    location: { pathname: '/nope/' },
    history: { replaceState() { throw new Error('address must not change'); }, pushState() { throw new Error('address must not change'); } },
  };
  vm.createContext(ctx);
  vm.runInContext(NP_SRC(), ctx);
  const click = (n, extra = {}) => {
    const a = { getAttribute: (k) => (k === 'data-page' ? String(n) : null) };
    let prevented = false;
    for (const f of pager.handlers.click || []) f({ target: { closest: () => a }, preventDefault: () => { prevented = true; }, ...extra });
    return prevented;
  };
  return { imgs, hidden: () => hiddenFocused, grid, link, log, pager, all, title, current, status, fetched, click, settle: () => new Promise((r) => setTimeout(r, 5)) };
}
const INDEX = Array.from({ length: 20 }, (_, i) => ({ t: `T${i} <b>`, u: `/post/c/s${i}/`, s: `s${i}`, e: `E${i}`, c: 'Cat', l: '', g: [], d: '2026-01-05', i: `/assets/posts/s${i}.webp`, x: '' }));

test('posts: the whole index is shuffled once and shown nine at a time with the site pagination bar', async () => {
  const t = runPosts({ data: INDEX });
  await t.settle();
  assert.deepEqual(t.fetched, ['/data/search.json']);
  assert.equal((t.grid.innerHTML.match(/<article class="card"/g) || []).length, 9);
  assert.match(t.pager.innerHTML, /<nav class="pagination" aria-label="Pagination">/);
  assert.match(t.pager.innerHTML, /page-btn page-prev is-disabled/);
  assert.match(t.pager.innerHTML, /class="page-num is-current"[^>]*>1</);
  assert.match(t.pager.innerHTML, /Page 1 of 3/);
  assert.equal(t.all.hidden, true);
  const shown = new Set([...t.grid.innerHTML.matchAll(/href="(\/post\/[^"]+)"/g)].map((m) => m[1]));
  assert.equal(shown.size, 9);
  assert.match(t.grid.innerHTML, /width="1400" height="800" loading="lazy"/);
});

test('posts: a different shuffle gives a different first page (Fisher-Yates over all posts)', async () => {
  const a = runPosts({ data: INDEX, random: () => 0 });
  const b = runPosts({ data: INDEX, random: () => 0.999 });
  await a.settle(); await b.settle();
  assert.notEqual(a.grid.innerHTML, b.grid.innerHTML);
});

test('posts: page numbers fade the cards out, swap, rise in, glide to the heading, announce, focus the first card, never touch the address', async () => {
  const t = runPosts({ data: INDEX });
  await t.settle();
  const first = t.grid.innerHTML;
  assert.equal(t.click(2), true, 'the link is not followed');
  await t.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(t.log)), ['leave', 'enter', ['glide', 1234, { covered: true }]]);
  assert.notEqual(t.grid.innerHTML, first);
  assert.equal((t.grid.innerHTML.match(/<article class="card"/g) || []).length, 9);
  assert.equal(t.status.textContent, 'Page 2 of 3');
  assert.equal(t.link.focused, 1, 'the first new card link takes focus');
  assert.equal(t.link.opts.preventScroll, true);
  assert.equal(t.current.focused, 0, 'not the page number');
  assert.equal(t.hidden(), 0);
  t.click(3);
  await t.settle();
  assert.equal((t.grid.innerHTML.match(/<article class="card"/g) || []).length, 2);
  assert.match(t.pager.innerHTML, /page-btn page-next is-disabled/);
  assert.equal(t.click(9), true);
  await t.settle();
  assert.equal(t.status.textContent, 'Page 3 of 3');
});

test('posts: fast clicks: the last page asked for wins', async () => {
  const t = runPosts({ data: INDEX });
  await t.settle();
  t.click(2);
  t.click(3);
  await t.settle();
  assert.match(t.pager.innerHTML, /Page 3 of 3/);
  assert.equal(t.status.textContent, 'Page 3 of 3');
  assert.ok(t.log.filter((x) => x === 'leave').length <= 2);
});

test('posts: without MBMotion the swap is instant and the heading is scrolled into view', async () => {
  const t = runPosts({ data: INDEX, motion: false });
  await t.settle();
  const first = t.grid.innerHTML;
  t.click(2);
  assert.notEqual(t.grid.innerHTML, first);
  assert.ok(t.title.scrolled >= 1);
  assert.equal(t.link.focused, 1);
  assert.equal(t.status.textContent, 'Page 2 of 3');
});

test('posts: local() accepts one leading slash only (no //, no backslash, no scheme)', () => {
  const src = NP_SRC();
  const m = src.match(/function local\(s\) \{[^\n]*\}/);
  assert.ok(m);
  const local = new Function(m[0] + '; return local;')();
  assert.equal(local('/post/a/'), '/post/a/');
  for (const bad of ['//evil.example/x', '/\\evil.example/x', '\\evil', 'https://evil.example', 'javascript:alert(1)', 'post/a/', '', null, 5]) assert.equal(local(bad), '', String(bad));
});

test('posts: a modified click is left to the browser; titles are escaped; under a basePath the index is fetched from the base', async () => {
  const t = runPosts({ data: INDEX, base: '/repo' });
  await t.settle();
  assert.deepEqual(t.fetched, ['/repo/data/search.json']);
  assert.doesNotMatch(t.grid.innerHTML, /<b>/);
  assert.equal(t.click(2, { ctrlKey: true }), false);
  assert.match(t.pager.innerHTML, /Page 1 of 3/);
});

test('posts: if the index cannot be loaded, or has nothing usable, the built-in posts stay', async () => {
  const f = runPosts({ fail: true });
  await f.settle();
  assert.equal(f.grid.innerHTML, 'STATIC');
  assert.equal(f.all.hidden, false);
  const bad = runPosts({ data: [{ t: 'x', u: 'https://evil.example/' }, { t: 'y', u: '//evil.example/' }] });
  await bad.settle();
  assert.equal(bad.grid.innerHTML, 'STATIC');
  const none = runPosts({ markup: false });
  assert.deepEqual(none.fetched, []);
});

test('posts: the script is loaded on the 404 and nowhere else', () => {
  assert.match(render404(), /js\/notfound-posts\.js/);
  const r = createRenderer({ config: SITE, categories: CATS, posts: [], pages: [], authors: [], versions: {} });
  assert.doesNotMatch(r.home(), /notfound-posts\.js/);
});

test('posts: the live region ships empty in the page, and the script only sets its text', () => {
  const h = renderWith(POSTS);
  assert.match(h, /<p class="sr-only" role="status" aria-live="polite" data-nf-pager-status><\/p>/);
  assert.doesNotMatch(NP_SRC(), /createElement|appendChild/);
});

test('posts: nine or fewer posts make one page and no pager bar', async () => {
  const t = runPosts({ data: INDEX.slice(0, 9) });
  await t.settle();
  assert.equal((t.grid.innerHTML.match(/<article class="card"/g) || []).length, 9);
  assert.equal(t.pager.innerHTML, '');
  const ten = runPosts({ data: INDEX.slice(0, 10) });
  await ten.settle();
  assert.match(ten.pager.innerHTML, /Page 1 of 2/);
});

test('posts: hostile index values are escaped or dropped (quote in title, javascript: image, bad date)', async () => {
  const bad = { t: 'He said "hi" & <script>x</script>', u: '/post/c/ok/', e: `it's <i>`, c: '"><img src=x>', d: '2026-13-99', i: 'javascript:alert(1)' };
  const proto = { t: 'proto image', u: '/post/c/two/', e: 'e', c: 'c', d: 'not a date', i: '//evil.example/x.webp' };
  const t = runPosts({ data: [bad, proto] });
  await t.settle();
  const h = t.grid.innerHTML;
  assert.doesNotMatch(h, /<script|<i>|<b>|<img src=x/);
  assert.match(h, /He said &quot;hi&quot; &amp; &lt;script&gt;/);
  assert.doesNotMatch(h, /javascript:|evil\.example/);
  assert.doesNotMatch(h, /<img/);
  assert.doesNotMatch(h, /<time|undefined/);
  assert.match(h, /href="\/post\/c\/ok\/"/);
});

test('posts: pictures fade in when loaded or failed, and at once when already complete', async () => {
  const mk = (complete) => { const i = { complete, classes: new Set(), handlers: {}, classList: { add(c) { i.classes.add(c); } }, addEventListener(type, f) { i.handlers[type] = f; } }; return i; };
  const t = runPosts({ data: INDEX });
  await t.settle();
  const done = mk(true), late = mk(false), broken = mk(false);
  t.imgs.push(done, late, broken);
  t.click(2);
  await t.settle();
  assert.ok(done.classes.has('is-loaded'));
  assert.ok(!late.classes.has('is-loaded'));
  late.handlers.load();
  broken.handlers.error();
  assert.ok(late.classes.has('is-loaded') && broken.classes.has('is-loaded'));
});

