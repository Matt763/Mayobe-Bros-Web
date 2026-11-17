// Results pages switch in place (js/results-app.js, "Switching between results pages"): the pure parts.
//   node --no-warnings --test scripts/tests/results-nav.test.mjs
// Covered here: which addresses and clicks are switched in place, the page store (one fetch per address, six pages kept, two prefetches at a
// time), the ticket that lets only the newest change finish, what is read from a fetched page (checked on the real built pages through a
// small stand-in for the DOM), which meta tags follow, what is stripped from fetched markup, and guards on the source. The part that
// touches a real page (fade, swap, glide, Back) was checked in a browser; see "Results pages switch in place" in CLAUDE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as app from '../../js/results-app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RES = path.join(ROOT, 'post/educational/results');
const POST = (slug) => `/post/educational/results/${slug}/`;
const here = (pathname = POST('necta-csee-results-2025'), base = '') => ({ origin: 'https://mayobebros.com', pathname, base });
const link = (href, extra = {}) => ({ href, ...extra });
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

/* ------------------------------------------------------------------ addresses */

test('matchResultsPost: only the results posts, with or without the closing slash or index.html, and the base path must agree', () => {
  assert.deepEqual(app.matchResultsPost(POST('necta-csee-results-2024')), { path: POST('necta-csee-results-2024'), slug: 'necta-csee-results-2024', cat: 'csee', year: 2024 });
  assert.equal(app.matchResultsPost('/post/educational/results/necta-psle-results-2012/index.html').path, POST('necta-psle-results-2012'));
  assert.equal(app.matchResultsPost('/post/educational/results/necta-dppee-results-2019/').cat, 'dppee');
  assert.equal(app.matchResultsPost('/post/educational/results/necta-qt-results-2019/').cat, 'qt');
  assert.equal(app.matchResultsPost('/site/post/educational/results/necta-csee-results-2024/', '/site').path, '/site/post/educational/results/necta-csee-results-2024/');
  assert.equal(app.matchResultsPost('/site/post/educational/results/necta-csee-results-2024/', '/site/').slug, 'necta-csee-results-2024');
  for (const no of [
    '/post/educational/results/necta-csee-results-2024',            // no closing slash: the host redirects, the router wants the canonical address
    '/post/educational/results/how-to-read-csee-results-divisions-points/',
    '/post/educational/results/necta-csee-results-24/',
    '/post/educational/results/necta-csee-results-2024/extra/',
    '/post/educational/necta-csee-results-2024/',
    '/category/educational/results/csee/',
    '/results/csee/p0101/2024/',                                    // a page made by the results Worker
    '/x/post/educational/results/necta-csee-results-2024/',         // another base path
    '/post/educational/results/necta-csee-results-2024/?x=1',       // a query is not part of a pathname
    '', null, undefined,
  ]) assert.equal(app.matchResultsPost(no), null, String(no));
  assert.equal(app.matchResultsPost('/post/educational/results/necta-csee-results-2024/', '/site'), null);
});

test('inPlaceTarget: a plain left click on a link to another results post of this site, nothing else', () => {
  const to = app.inPlaceTarget(link('https://mayobebros.com/post/educational/results/necta-csee-results-2024/'), here(), plain);
  assert.equal(to.path, POST('necta-csee-results-2024'));
  assert.equal(to.year, 2024);
  assert.equal(to.search, '');
  // relative and root-relative addresses, a query and a hash travel with the target
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-acsee-results-2023/?centre=S0101#top'), here(), plain).search, '?centre=S0101');
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-acsee-results-2023/?centre=S0101#top'), here(), plain).hash, '#top');
  assert.equal(app.inPlaceTarget(link('../necta-csee-results-2023/'), here(), plain).path, POST('necta-csee-results-2023'));
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-psle-results-2023/index.html'), here(), plain).path, POST('necta-psle-results-2023'));
  // a hover or focus has no click: the same rules without the event
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-csee-results-2024/'), here(), null).year, 2024);
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-csee-results-2024/'), here()).year, 2024);

  const href = '/post/educational/results/necta-csee-results-2024/';
  for (const [why, ev] of [['middle button', { ...plain, button: 1 }], ['right button', { ...plain, button: 2 }], ['ctrl', { ...plain, ctrlKey: true }], ['meta', { ...plain, metaKey: true }],
    ['shift', { ...plain, shiftKey: true }], ['alt', { ...plain, altKey: true }], ['already handled', { ...plain, defaultPrevented: true }]]) {
    assert.equal(app.inPlaceTarget(link(href), here(), ev), null, why);
  }
  assert.equal(app.inPlaceTarget(link(href, { target: '_blank' }), here(), plain), null, 'new tab');
  assert.equal(app.inPlaceTarget(link(href, { target: '_top' }), here(), plain), null, 'another frame');
  assert.ok(app.inPlaceTarget(link(href, { target: '_self' }), here(), plain), '_self is the same window');
  assert.ok(app.inPlaceTarget(link(href, { target: '' }), here(), plain));
  assert.equal(app.inPlaceTarget(link(href, { download: '' }), here(), plain) !== null, true, 'an anchor without the attribute has download = ""');
  assert.equal(app.inPlaceTarget(link(href, { download: 'x.html' }), here(), plain), null, 'download');
  assert.equal(app.inPlaceTarget(link('https://evil.test/post/educational/results/necta-csee-results-2024/'), here(), plain), null, 'another site');
  assert.equal(app.inPlaceTarget(link('http://mayobebros.com/post/educational/results/necta-csee-results-2024/'), here(), plain), null, 'another scheme counts as another origin');
  assert.equal(app.inPlaceTarget(link('javascript:alert(1)'), here(), plain), null);
  assert.equal(app.inPlaceTarget(link('mailto:a@b.c'), here(), plain), null);
  assert.equal(app.inPlaceTarget(link('/about/'), here(), plain), null, 'not a results post');
  assert.equal(app.inPlaceTarget(link('/post/educational/results/how-to-read-csee-results-divisions-points/'), here(), plain), null, 'an article under Results');
  assert.equal(app.inPlaceTarget(link('/results/csee/p0101/2024/'), here(), plain), null, 'a Worker page');
  assert.equal(app.inPlaceTarget(link('/category/educational/results/csee/'), here(), plain), null, 'the sub-menu belongs to the pager');
  assert.equal(app.inPlaceTarget(link(''), here(), plain), null);
  assert.equal(app.inPlaceTarget(null, here(), plain), null);
  // the page's own address (also with a query, as the app writes ?centre=): the app handles it, not the switcher
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-csee-results-2025/'), here(), plain), null);
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-csee-results-2025/?centre=P0101'), here(), plain), null);
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-csee-results-2025/index.html'), here(), plain), null);
  // the base path
  assert.equal(app.inPlaceTarget(link('/site/post/educational/results/necta-csee-results-2024/'), here('/site/post/educational/results/necta-csee-results-2025/', '/site'), plain).path, '/site/post/educational/results/necta-csee-results-2024/');
  assert.equal(app.inPlaceTarget(link('/post/educational/results/necta-csee-results-2024/'), here('/site/post/educational/results/necta-csee-results-2025/', '/site'), plain), null);
});

/* ------------------------------------------------------------------ the page store */

const tick = () => new Promise((r) => setImmediate(r));
function controlled() {
  const calls = [];
  const waiting = new Map();
  const fetchText = (p) => new Promise((resolve, reject) => { calls.push(p); waiting.set(p, { resolve: (t) => resolve(t === undefined ? `<${p}>` : t), reject }); });
  return { calls, fetchText, resolve: (p, t) => waiting.get(p).resolve(t), reject: (p) => waiting.get(p).reject(new Error('down')) };
}

test('page store: one fetch per address, however many ask, and a kept page answers at once', async () => {
  const c = controlled();
  const store = app.createPageStore({ fetchText: c.fetchText });
  const a = store.load('/a/');
  const b = store.load('/a/');
  assert.equal(a, b, 'the same promise');
  await tick();
  assert.deepEqual(c.calls, ['/a/']);
  assert.equal(store.running(), 1);
  assert.equal(store.has('/a/'), false);
  c.resolve('/a/');
  assert.equal(await a, '</a/>');
  assert.equal(store.has('/a/'), true);
  assert.equal(store.running(), 0);
  assert.equal(await store.load('/a/'), '</a/>');
  assert.deepEqual(c.calls, ['/a/'], 'no second fetch');
});

test('page store: keeps the last six pages, the least recently used leaves first', async () => {
  const store = app.createPageStore({ fetchText: async (p) => `<${p}>` });
  for (let i = 1; i <= 6; i++) await store.load(`/p${i}/`);
  assert.equal(store.size(), 6);
  await store.load('/p1/');                  // used again: now the newest
  await store.load('/p7/');                  // the oldest is /p2/
  assert.equal(store.size(), 6);
  assert.equal(store.has('/p2/'), false);
  for (const k of ['/p1/', '/p3/', '/p4/', '/p5/', '/p6/', '/p7/']) assert.ok(store.has(k), k);
  await store.load('/p8/');
  assert.equal(store.has('/p3/'), false);
  assert.equal(store.size(), 6);
  const small = app.createPageStore({ fetchText: async (p) => p, max: 2 });
  for (const k of ['/x/', '/y/', '/z/']) await small.load(k);
  assert.equal(small.size(), 2);
});

test('page store: prefetch runs at most two fetches, skips what is here or on its way, and frees its place when a fetch ends or fails', async () => {
  const c = controlled();
  const store = app.createPageStore({ fetchText: c.fetchText });
  assert.equal(store.prefetch('/a/'), true);
  assert.equal(store.prefetch('/a/'), false, 'already on its way');
  assert.equal(store.prefetch('/b/'), true);
  assert.equal(store.prefetch('/c/'), false, 'two already running');
  assert.equal(store.prefetching(), 2);
  await tick();
  assert.deepEqual(c.calls, ['/a/', '/b/']);
  c.resolve('/a/');
  await tick();
  assert.equal(store.prefetching(), 1);
  assert.equal(store.prefetch('/a/'), false, 'kept');
  assert.equal(store.prefetch('/c/'), true);
  c.reject('/b/');
  await tick();
  assert.equal(store.prefetching(), 1, 'the failed fetch gave its place back (and /c/ holds one)');
  assert.equal(store.has('/b/'), false, 'a failure is not kept');
  // a click on an address that is being prefetched joins that fetch
  const joined = store.load('/c/');
  await tick();
  assert.deepEqual(c.calls, ['/a/', '/b/', '/c/']);
  c.resolve('/c/');
  assert.equal(await joined, '</c/>');
  // a failed address can be asked for again
  const again = store.load('/b/');
  await tick();
  assert.equal(c.calls.filter((x) => x === '/b/').length, 2);
  c.resolve('/b/');
  assert.equal(await again, '</b/>');
});

test('page store: a click is not limited by the prefetch limit, and a failed load rejects every waiter', async () => {
  const c = controlled();
  const store = app.createPageStore({ fetchText: c.fetchText });
  store.prefetch('/a/');
  store.prefetch('/b/');
  const click = store.load('/c/');
  const click2 = store.load('/c/');
  await tick();
  assert.deepEqual(c.calls, ['/a/', '/b/', '/c/']);
  c.reject('/c/');
  await assert.rejects(click, /down/);
  await assert.rejects(click2, /down/);
  assert.equal(store.running(), 2);
});

/* ------------------------------------------------------------------ only the newest change finishes */

test('runner: a new ticket makes the earlier ones stale, cancel makes every ticket stale', () => {
  const r = app.createRunner();
  const a = r.begin();
  assert.equal(a.current(), true);
  const b = r.begin();
  assert.equal(a.current(), false, 'the second click ends the first');
  assert.equal(b.current(), true);
  r.cancel();
  assert.equal(b.current(), false, 'Back to the page on screen ends the change that was on its way');
  const c = r.begin();
  assert.equal(c.current(), true);
  assert.equal(b.current(), false);
  assert.notEqual(a.id, b.id);
});

test('runner: a change that was overtaken while it waited does nothing when its fetch ends', async () => {
  const r = app.createRunner();
  const c = controlled();
  const store = app.createPageStore({ fetchText: c.fetchText });
  const applied = [];
  async function go(path) {
    const ticket = r.begin();
    const text = await store.load(path);
    if (!ticket.current()) return;
    applied.push(text);
  }
  const first = go('/2024/');
  const second = go('/2023/');
  await tick();
  c.resolve('/2023/');
  c.resolve('/2024/');
  await Promise.all([first, second]);
  assert.deepEqual(applied, ['</2023/>']);
});

/* ------------------------------------------------------------------ fetched markup */

test('fetched markup: the unsafe tags and attributes', () => {
  for (const t of ['script', 'iframe', 'object', 'embed', 'link', 'style', 'base', 'meta', 'noscript']) assert.ok(app.UNSAFE_TAGS.includes(t), t);
  for (const t of ['a', 'form', 'input', 'button', 'svg', 'path', 'table', 'dl', 'nav', 'section', 'div']) assert.ok(!app.UNSAFE_TAGS.includes(t), t + ' is part of the app');
  for (const [n, v] of [['onclick', 'x()'], ['onerror', ''], ['ONLOAD', 'x'], ['style', 'color:red'], ['srcdoc', '<p>'], ['formaction', '/x'], ['href', 'javascript:alert(1)'],
    ['href', '  JaVaScRiPt:alert(1)'], ['href', '\u0001javascript:alert(1)'], ['src', 'data:text/html,x'], ['xlink:href', 'vbscript:x'], ['action', 'javascript:x'], ['poster', 'data:image/png;base64,AA']]) {
    assert.equal(app.unsafeAttr(n, v), true, `${n}=${v}`);
  }
  for (const [n, v] of [['href', '/post/educational/results/necta-csee-results-2024/'], ['href', 'https://onlinesys.necta.go.tz/'], ['class', 'rs-chip'], ['data-rs', ''], ['data-path', '/post/x/'],
    ['aria-busy', 'true'], ['target', '_blank'], ['rel', 'noopener noreferrer'], ['id', 'rs-q-name'], ['placeholder', 'e.g. data:']]) {
    assert.equal(app.unsafeAttr(n, v), false, `${n}=${v}`);
  }
});

/* ------------------------------------------------------------------ the head of the page */

test('head: which meta tags follow the page', () => {
  const keys = (m) => app.metaKey(m);
  assert.equal(keys({ name: 'description', content: 'x' }), 'n:description');
  assert.equal(keys({ name: 'robots', content: 'x' }), 'n:robots');
  assert.equal(keys({ name: 'twitter:title', content: 'x' }), 'n:twitter:title');
  assert.equal(keys({ property: 'og:image:alt', content: 'x' }), 'p:og:image:alt');
  assert.equal(keys({ property: 'article:published_time', content: 'x' }), 'p:article:published_time');
  for (const m of [{ name: 'viewport' }, { name: 'author' }, { name: 'theme-color' }, { name: 'color-scheme' }, { name: 'referrer' }, { name: 'google-adsense-account' }, { name: 'yandex-verification' }, { property: 'fb:app_id' }, {}, null]) assert.equal(keys(m), '', JSON.stringify(m));
});

test('head: the plan sets what changed, adds what is new, removes what is gone, and leaves everything else alone', () => {
  const m = (k, v, prop) => (prop ? { property: k, content: v } : { name: k, content: v });
  const current = [m('viewport', 'width=device-width'), m('description', 'old'), m('robots', 'index, follow'), m('og:title', 'A', true), m('og:image', 'a.jpg', true), m('twitter:title', 'A'), m('og:image:alt', 'alt', true), m('author', 'x')];
  const next = [m('viewport', 'other'), m('description', 'new'), m('robots', 'noindex, follow'), m('og:title', 'A', true), m('og:image', 'b.jpg', true), m('twitter:title', 'A'), m('og:locale', 'en_US', true), m('author', 'y')];
  const plan = app.planHeadSync(current, next);
  assert.deepEqual(plan.set, [{ key: 'n:description', content: 'new' }, { key: 'n:robots', content: 'noindex, follow' }, { key: 'p:og:image', content: 'b.jpg' }]);
  assert.deepEqual(plan.add, [{ key: 'p:og:locale', name: '', property: 'og:locale', content: 'en_US' }]);
  assert.deepEqual(plan.remove, ['p:og:image:alt']);
  assert.deepEqual(app.planHeadSync(current, current), { set: [], add: [], remove: [] });
});

/* ------------------------------------------------------------------ reading a fetched page */

// A stand-in for the parsed document: it answers the few calls readResultsPage makes, from the real built page text.
const unent = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrsOf = (s) => { const o = {}; for (const m of s.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) o[m[1]] = m[2] === undefined ? '' : unent(m[2]); return o; };
const camel = (k) => k.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function fakeDoc(html) {
  const mainAt = html.indexOf('<main id="main">');
  const mainEnd = html.indexOf('</main>');
  const main = mainAt >= 0 && mainEnd > mainAt ? html.slice(mainAt + 16, mainEnd) : '';
  const head = html.slice(0, mainAt >= 0 ? mainAt : html.length);
  const text = (s) => unent(s.replace(/<[^>]*>/g, ''));
  const rootTag = /<div class="rs" data-rs([^>]*)>/.exec(main);
  const el = (attrs, inner) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), textContent: text(inner || ''), dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [camel(k), v])) });
  const rootEl = rootTag ? (() => {
    const attrs = attrsOf('data-rs' + rootTag[1]);
    const o = el(attrs, '');
    o.querySelector = (sel) => {
      const pick = (re) => { const m = re.exec(main); return m ? el(attrsOf(m[1]), m[2]) : null; };
      switch (sel) {
        case '[data-rs-title]': return pick(/<h1([^>]*data-rs-title[^>]*)>([\s\S]*?)<\/h1>/);
        case '[data-rs-lead]': return pick(/<p([^>]*data-rs-lead[^>]*)>([\s\S]*?)<\/p>/);
        case '[data-rs-hero]': return /<section class="rs-hero" data-rs-hero/.test(main) ? el({}, '') : null;
        case '[data-rs-stage]': return /<div class="rs-stage" data-rs-stage/.test(main) ? el({}, '') : null;
        case '.rs-statement': return /<section class="rs-statement"/.test(main) ? el({}, '') : null;
        case '[data-rs-stats] dd': { const m = /<dl class="rs-stats" data-rs-stats>[\s\S]*?<dd>([\s\S]*?)<\/dd>/.exec(main); return m ? el({}, m[1]) : null; }
        case '[data-rs-stats] dt': { const m = /<dl class="rs-stats" data-rs-stats>[\s\S]*?<dt>([\s\S]*?)<\/dt>/.exec(main); return m ? el({}, m[1]) : null; }
        default: throw new Error('the stand-in does not know ' + sel);
      }
    };
    return o;
  })() : null;
  return {
    documentElement: { getAttribute: (k) => (k === 'lang' ? (/<html[^>]*\slang="([^"]*)"/.exec(html) || [])[1] || null : null) },
    querySelector(sel) {
      if (sel === 'main#main > [data-rs]') return rootEl;
      if (sel === 'title') { const m = /<title>([\s\S]*?)<\/title>/.exec(head); return m ? el({}, m[1]) : null; }
      if (sel === 'link[rel="canonical"]') { const m = /<link rel="canonical" href="([^"]*)">/.exec(head); return m ? el({ href: unent(m[1]) }, '') : null; }
      throw new Error('the stand-in does not know ' + sel);
    },
    querySelectorAll(sel) {
      if (sel === 'meta') return [...head.matchAll(/<meta\s+([^>]*?)>/g)].map((m) => el(attrsOf(m[1]), ''));
      if (sel === 'script[type="application/ld+json"]') return [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => ({ textContent: unent(m[1]) }));
      throw new Error('the stand-in does not know ' + sel);
    },
  };
}
const built = (slug) => { const f = path.join(RES, slug, 'index.html'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const resultsSlugs = () => fs.readdirSync(RES).filter((s) => /^necta-[a-z]+-results-\d{4}$/.test(s) && fs.existsSync(path.join(RES, s, 'index.html')));

test('readResultsPage: a built page with data, and one without', () => {
  const html = built('necta-csee-results-2025');
  assert.ok(html, 'build the site first: node scripts/build.mjs');
  const page = app.readResultsPage(fakeDoc(html), POST('necta-csee-results-2025'));
  assert.equal(page.ok, true, page.reason);
  assert.equal(page.state, 'ready');
  assert.equal(page.heading, 'CSEE Examination Results 2025');
  assert.match(page.title, /^(NECTA CSEE RESULTS 2025|Matokeo ya Kidato cha Nne 2025: CSEE Results by School)/);
  assert.equal(page.canonical, 'https://mayobebros.com/post/educational/results/necta-csee-results-2025/');
  assert.match(page.said, /^[\d,]+ centres listed\.$/);
  assert.equal(page.lang, 'en');
  assert.equal(page.ld.length, 2);
  for (const j of page.ld) JSON.parse(j);
  const keys = new Set(page.metas.map(app.metaKey).filter(Boolean));
  for (const k of ['n:description', 'n:robots', 'p:og:title', 'p:og:description', 'p:og:url', 'p:og:image', 'p:og:image:alt', 'n:twitter:title', 'n:twitter:image']) assert.ok(keys.has(k), k);
  assert.ok(page.metas.find((m) => m.property === 'og:image').content.includes('post-necta-csee-results-2025.jpg'));
  assert.equal(page.root.dataset.exam, 'csee-2025');

  // QT 2015 is not online (NECTA has no QT results before 2016), so it stays a no-data page; if it ever gets data, pick another exam-year that has none
  const nodata = built('necta-qt-results-2015');
  assert.ok(nodata);
  const n = app.readResultsPage(fakeDoc(nodata), POST('necta-qt-results-2015'));
  assert.equal(n.ok, true, n.reason);
  assert.equal(n.state, 'nodata');
  assert.match(n.said, /QT 2015 results are (being added to|not on) this site\.$/);
  assert.equal(n.metas.find((m) => m.name === 'robots').content, 'noindex, follow');
});

test('readResultsPage: refuses a page that is not one of our app pages, or not the one that was asked for', () => {
  const html = built('necta-csee-results-2025');
  const want = POST('necta-csee-results-2025');
  const refuse = (h, wantPath = want) => app.readResultsPage(fakeDoc(h), wantPath);
  assert.equal(refuse(html, POST('necta-csee-results-2024')).ok, false, 'the data-path says another page');
  assert.match(refuse(html, POST('necta-csee-results-2024')).reason, /another address/);
  assert.match(refuse('<html><head><title>x</title></head><body><main id="main"><p>hello</p></main></body></html>').reason, /no app/);
  assert.match(refuse(html.replace('<div class="rs" data-rs ', '<div class="rs" data-rs data-mode="centre" ')).reason, /Worker/);
  assert.match(refuse(html.replace('data-state="ready"', 'data-state="weird"')).reason, /state/);
  assert.match(refuse(html.replace(' data-exam="csee-2025"', '')).reason, /attributes/);
  assert.match(refuse(html.replace('data-year="2025"', 'data-year="20x5"')).reason, /attributes/);
  assert.match(refuse(html.replace(' data-rs-hero', '')).reason, /hero/);
  assert.match(refuse(html.replace(' data-rs-title', '')).reason, /hero/);
  assert.match(refuse(html.replace('data-rs-stage', 'x')).reason, /stage/);
  assert.match(refuse(html.replace(/<title>[^<]*<\/title>/, '<title></title>')).reason, /title/);
  const nodata = built('necta-qt-results-2015');
  assert.match(refuse(nodata.replace('class="rs-statement"', 'class="x"'), POST('necta-qt-results-2015')).reason, /statement/);
  // a hostile canonical is dropped, not applied
  const evil = refuse(html.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="javascript:alert(1)">'));
  assert.equal(evil.ok, true);
  assert.equal(evil.canonical, '');
  const lang = refuse(html.replace('<html lang="en"', '<html lang="x y z"'));
  assert.equal(lang.lang, '');
});

test('every built results page reads, and every link in it to a sibling year switches in place to a page that reads too', () => {
  const slugs = resultsSlugs();
  assert.ok(slugs.length >= 70, `only ${slugs.length} results pages are built`);
  let links = 0;
  for (const slug of slugs) {
    const html = built(slug);
    const mine = POST(slug);
    const page = app.readResultsPage(fakeDoc(html), mine);
    assert.equal(page.ok, true, `${slug}: ${page.reason}`);
    assert.equal(page.canonical, `https://mayobebros.com${mine}`, slug);
    const main = html.slice(html.indexOf('<main id="main">'), html.indexOf('</main>'));
    const hrefs = [...main.matchAll(/<a class="rs-chip rs-chip--dark" href="([^"]+)"/g)].map((m) => m[1])
      .concat([...main.matchAll(/<p>Results we do have for [A-Z]+: ([\s\S]*?)<\/p>/g)].flatMap((m) => [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1])));
    for (const href of hrefs) {
      const to = app.inPlaceTarget(link(href), here(mine), plain);
      assert.ok(to, `${slug}: ${href} is not switched in place`);
      assert.notEqual(to.path, mine, `${slug} links to itself`);
      const target = built(to.slug);
      assert.ok(target, `${slug}: ${href} is not a built page`);
      assert.equal(app.readResultsPage(fakeDoc(target), to.path).ok, true, `${slug} -> ${to.slug}`);
      links++;
    }
  }
  assert.ok(links > 500, `${links} links checked`);
  // the Worker's pages (data-mode) are never read as app pages
  const w = fs.readFileSync(path.join(ROOT, 'results-worker/src/render.js'), 'utf8');
  assert.match(w, /data-rs data-mode="centre"/);
});

/* ------------------------------------------------------------------ the source */

const src = read('js/results-app.js');
const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
const between = (a, b) => body.slice(body.indexOf(a), body.indexOf(b));
// assert.match / doesNotMatch with a short message: the code being searched is large and would fill the screen on a failure
const has = (code, re, why) => assert.ok(re.test(code), why || `missing ${re}`);
const lacks = (code, re, why) => assert.ok(!re.test(code), why || `found ${re}`);

test('source: the app tears itself down (every window listener goes through listen(), timers through later(), fetches carry the abort signal)', () => {
  const appCode = between('function start(root, opts', 'const FETCH_MS');
  assert.ok(appCode.length > 1000);
  lacks(appCode, /window\.addEventListener|document\.addEventListener/, 'a window or document listener the teardown would miss');
  assert.doesNotMatch(appCode.replace(/const later = [\s\S]*?\n  \};\n/, ''), /[^.\w]setTimeout\(/, 'a bare timer');
  has(appCode, /listen\(window, 'popstate'/);
  has(appCode, /listen\(root, 'click'/);
  has(appCode, /function destroy\(\) \{[\s\S]*?dead = true;[\s\S]*?routeNo \+= 1;[\s\S]*?ac\.abort\(\);[\s\S]*?clearTimeout[\s\S]*?undo\.splice\(0\)/);
  has(appCode, /signal: ac\.signal/);
  has(appCode, /handle\.destroy = destroy/);
  has(appCode, /if \(root\.dataset\.state === 'nodata'\) return handle;/);
  has(appCode, /if \(SSR\) \{ bootCentre\(\); return handle; \}/);
  has(appCode, /return handle;\n\}\s*$/);
  // the app never handles a Back or Forward to another page: that belongs to the switcher
  has(appCode, /listen\(window, 'popstate', \(e\) => \{\s*if \(location\.pathname !== PAGE_PATH\) return;/);
  // a step that was waiting while the app was destroyed does not carry on
  has(appCode, /if \(mb\) await mb\.leave\(R\.list\);\s*if \(dead\) return;/);
  has(appCode, /async function applyRoute\([^)]*\) \{\s*if \(dead\) return;/);
  // the document id lives in the module, so history entries made before a switch are still this document's
  has(body, /^const DOC = Math\.random/m);
  lacks(appCode, /const DOC =/);
});

test('source: the switcher checks and cleans the page before the old app is touched, pushes history once, and falls back to a normal load', () => {
  const sw = between('function createSwitcher', "if (typeof document !== 'undefined')");
  assert.ok(sw.length > 2000);
  assert.equal((sw.match(/history\.pushState\(/g) || []).length, 1);
  has(sw, /if \(push\) \{[\s\S]*?history\.replaceState\([\s\S]*?\{ y: window\.scrollY \}[\s\S]*?history\.pushState\(\{ rsNav: 1 \}, '', href\);/);
  has(sw, /readResultsPage\(new DOMParser\(\)\.parseFromString\(text, 'text\/html'\), to\.path\);\s*if \(!page\.ok\) throw/);
  assert.ok(sw.indexOf('readResultsPage(') < sw.indexOf('m.leave(b)'), 'checked before anything fades');
  assert.ok(sw.indexOf('doc.importNode(page.root, true)') < sw.indexOf('cleanTree(fresh)'));
  assert.ok(sw.indexOf('cleanTree(fresh)') < sw.indexOf('old.replaceWith(fresh)'), 'cleaned before it is in the document');
  assert.ok(sw.indexOf('app.destroy()') < sw.indexOf('old.replaceWith(fresh)'));
  assert.ok(sw.indexOf('old.replaceWith(fresh)') < sw.indexOf('app = start(fresh'));
  has(sw, /m\.glide\(m\.topOf\(hero, 0\), \{ covered: true \}\)/);
  has(sw, /h1\.focus\(\{ preventScroll: true \}\)/);
  has(sw, /credentials: 'same-origin'/);
  has(sw, /end\.origin !== location\.origin/);
  has(sw, /catch \{\s*if \(!ticket\.current\(\)\) return;\s*runner\.cancel\(\);\s*plainNavigation\(href, push\);/);
  has(sw, /if \(!push\) \{ location\.reload\(\); return; \}/);
  has(sw, /doc\.addEventListener\('click', \(e\) => \{\s*if \(bypass\) return;/);
  has(sw, /\}, true\);/, 'the click is captured first');
  has(sw, /if \(waitingFor === to\.path\) return;/);
  has(sw, /navigator\.connection && navigator\.connection\.saveData/);
  // the head
  has(sw, /doc\.title = page\.title/);
  has(sw, /planHeadSync\(/);
  has(sw, /el\.setAttribute\('content', x\.content\)|setAttribute\('content', x\.content\)/);
  // no markup is written as text
  lacks(body, /\.innerHTML\s*=(?!=)(?![^;]*['"`]<svg)|insertAdjacentHTML|document\.write|outerHTML\s*=/);
  // boot: Worker pages (data-mode) and browsers without the pieces keep plain links
  has(body, /root\.dataset\.mode === 'centre' \|\| !inMain \|\| !window\.fetch \|\| !window\.DOMParser/);
  has(body, /createSwitcher\(root\)/);
});

test('source: motion goes through MBMotion (leave, enter, glide), nothing scrolls natively, nothing sits on html or body', () => {
  const sw = between('function createSwitcher', "if (typeof document !== 'undefined')");
  for (const call of ['m.wait(b, true)', 'm.leave(b)', 'm.enter(boxesOf(fresh)', 'm.glide(']) assert.ok(sw.includes(call), call);
  lacks(body, /behavior:\s*['"]smooth|scrollIntoView|\.scrollTo\(\{[^}]*behavior:\s*['"](?!instant)/);
  has(sw, /html\.classList\.add\('is-paging'\)/);
  has(sw, /html\.classList\.remove\('is-paging'\)/);
  const css = read('css/results.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.ok(names.every((n) => n.startsWith('rs-')) && new Set(names).size === names.length);
  has(css, /\.rs-chip--dark\.is-pending \{[^}]*background: #2f55d4/);
  lacks(css, /(^|\n)\s*(html|body)\s*\{/);
});

test('source: the sub-menu pills on the Results pages still belong to pager.js, not to the switcher', () => {
  const pager = read('js/pager.js');
  has(pager, /isTopicPage && u\.pathname\.indexOf\(BASE \+ '\/category\/'\) === 0\) return 'section'/);
  // a sub-menu link is /category/educational/results/<section>/, which never matches a results post
  for (const s of ['', 'csee', 'acsee', 'psle', 'ftna', 'sfna', 'dsee', 'dpee', 'dppee', 'dspee', 'dte', 'qt', 'guides']) {
    assert.equal(app.matchResultsPost(`/category/educational/results/${s ? s + '/' : ''}`), null, s);
  }
});
