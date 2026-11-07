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

test('404: pills are the categories with posts, then Popular posts and All posts', () => {
  const h = render404();
  const ul = h.match(/<ul class="nf-links">([\s\S]*?)<\/ul>/);
  assert.ok(ul, 'no nf-links list');
  assert.deepEqual(addresses(ul[1]), ['/category/educational/', '/popular/', '/post/']);
  assert.ok(ul[1].includes('>Education<'));
});

test('404: every address is root-absolute, also under a basePath', () => {
  for (const a of addresses(render404())) assert.match(a, /^(\/(?!\/)|https:\/\/|mailto:|#)/, a);
  for (const a of addresses(render404({ basePath: '/repo' }))) assert.match(a, /^(\/repo\/|https:\/\/|mailto:|#)/, a);
});

test('404: without JavaScript nothing pretends to redirect', () => {
  const h = render404();
  for (const attr of ['data-nf-timer', 'data-nf-flow', 'data-nf-back']) assert.ok(openTag(h, attr).includes(' hidden'), `${attr} must start hidden`);
  assert.doesNotMatch(h, /http-equiv="refresh"/i);
  assert.match(h, /<form class="nf-search" action="\/search\/" method="get" role="search">/);
  assert.match(h, /href="\/"[^>]*>[\s\S]*?Go to homepage/);
});

test('the Stop button is the first control in <main>', () => {
  const first = mainOf(render404()).match(/<(a|button|input|select|textarea)\b[^>]*>/);
  assert.ok(first, 'no control in <main>');
  assert.match(first[0], /data-nf-stop/);
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

test('a plain missing page counts down from 10 and replaces the location with the home page', () => {
  const t = setup();
  assert.equal(t.nodes.timer.hidden, false);
  assert.equal(t.nodes.count.textContent, '10');
  t.tick(9);
  assert.equal(t.nodes.count.textContent, '1');
  assert.equal(t.nodes.unit.textContent, 'second');
  assert.equal(replaces(t).length, 0);
  t.tick(1);
  assert.deepEqual(replaces(t), [['replace', '/']]);
});

test('the live status is written once at the start, never on each tick', () => {
  const t = setup();
  t.tick(5);
  assert.equal(t.nodes.status.writes, 1);
  assert.match(t.nodes.status.textContent, /home page in 10 seconds\. Press Stop/);
});

test('Stop, a key, a pointer, a wheel, a touch or focus stops it for good', () => {
  const cases = [['stop', 'click'], ['doc', 'keydown'], ['doc', 'pointerdown'], ['doc', 'wheel'], ['doc', 'touchstart'], ['doc', 'focusin']];
  for (const [where, type] of cases) {
    const t = setup(where === 'stop' ? { active: 'stop' } : {});
    t.fire(where === 'stop' ? t.nodes.stop : t.doc, type);
    t.tick(20);
    assert.equal(replaces(t).length, 0, type);
    assert.ok(t.nodes.timer.classList.contains('is-stopped'), type);
    assert.ok(t.nodes.stop.hidden && t.nodes.count.hidden && t.nodes.unit.hidden, type);
    assert.equal(t.nodes.status.textContent, 'Automatic redirect stopped.', type);
    assert.match(t.nodes.text.textContent, /^Automatic redirect stopped\. Choose where to go below\.$/, type);
    if (where === 'stop') assert.equal(t.nodes.text.focused, 1);
  }
});

test('a tab that starts hidden never counts down; hiding the tab stops it', () => {
  const h = setup({ visibility: 'hidden' });
  assert.equal(h.nodes.timer.hidden, true);
  assert.equal(h.intervals(), 0);
  const t = setup();
  t.doc.visibilityState = 'hidden';
  t.fire(t.doc, 'visibilitychange');
  t.tick(20);
  assert.equal(replaces(t).length, 0);
});

test('reduced motion, a query string or a fragment: no countdown', () => {
  for (const o of [{ reduce: true }, { search: '?fbclid=x' }, { hash: '#part' }]) {
    const t = setup(o);
    assert.equal(t.nodes.timer.hidden, true, JSON.stringify(o));
    assert.equal(t.intervals(), 0, JSON.stringify(o));
    t.tick(20);
    assert.equal(replaces(t).length, 0);
  }
});

test('reload, back/forward and a page restored from the back/forward cache: no countdown', () => {
  for (const navType of ['reload', 'back_forward']) {
    const t = setup({ navType });
    assert.equal(t.nodes.timer.hidden, true, navType);
    assert.equal(t.intervals(), 0, navType);
  }
  const t = setup();
  t.fire(t.win, 'pageshow', { persisted: true });
  t.tick(20);
  assert.equal(replaces(t).length, 0);
  const p = setup();
  p.fire(p.win, 'pagehide', {});
  p.tick(20);
  assert.equal(replaces(p).length, 0);
});

test('email-link paths show the notice, drop the code first and never redirect', () => {
  const T = 'A'.repeat(32);
  const cases = [['/newsletter/', { hash: '#c=' + T }], ['/manage/', { hash: '#l=' + T }], ['/manage/x/', { search: '?t=1' }], ['/repo/newsletter/', { hash: '#u=x', base: '/repo' }]];
  for (const [p, o] of cases) {
    const t = setup({ path: p, ...o });
    assert.deepEqual(t.log[0], ['replaceState', p], p);
    assert.equal(t.nodes.flow.hidden, false, p);
    assert.equal(t.nodes.timer.hidden, true, p);
    t.tick(20);
    assert.equal(replaces(t).length, 0, p);
  }
  const plain = setup({ path: '/newsletter' });
  assert.equal(plain.nodes.flow.hidden, false);
  assert.equal(plain.log.filter((x) => x[0] === 'replaceState').length, 0);
  const near = setup({ path: '/newsletters-old/' });
  assert.equal(near.nodes.flow.hidden, true);
  assert.equal(near.nodes.timer.hidden, false);
});

test('under a basePath the redirect goes to the base home', () => {
  const t = setup({ base: '/repo', path: '/repo/nope/' });
  t.tick(10);
  assert.deepEqual(replaces(t), [['replace', '/repo/']]);
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
  const a = h.indexOf('js/notfound.js'), b = h.indexOf('js/site.js'), c = h.indexOf('cloudflareinsights');
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
