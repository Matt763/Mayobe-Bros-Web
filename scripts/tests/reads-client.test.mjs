// js/reads.js: an article counts as read only after 20 s in front of the reader AND 40% scrolled; nothing is stored; privacy signals are respected.
//   node --no-warnings --test scripts/tests/reads-client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'js', 'reads.js'), 'utf8');

function setup({ api = 'https://api.test', slug = 'my-post', gpc = false, dnt = null, referrer = '', hidden = false, prerendering = false, articleTop = 800, articleHeight = 4000, noArticle = false } = {}) {
  let now = 1_000_000;
  const timers = [];
  const handlers = { doc: {}, win: {} };
  const sent = [];
  const state = { hidden, prerendering, top: articleTop, innerHeight: 800 };
  const article = { getBoundingClientRect: () => ({ top: state.top, height: articleHeight }) };
  const holder = { getAttribute: (k) => (k === 'data-slug' ? slug : null) };
  const stored = [];
  const ctx = {
    document: {
      documentElement: { getAttribute: (k) => (k === 'data-api' ? api : null) },
      getElementById: (id) => (id === 'article' && !noArticle ? article : null),
      querySelector: (q) => (q === '[data-engage][data-slug]' ? holder : null),
      addEventListener: (t, f) => { handlers.doc[t] = f; },
      get hidden() { return state.hidden; },
      get prerendering() { return state.prerendering; },
      referrer,
      set cookie(v) { stored.push(['cookie', v]); },
    },
    window: {
      navigator: { globalPrivacyControl: gpc, doNotTrack: dnt },
      location: { origin: 'https://mayobebros.com' },
      get innerHeight() { return state.innerHeight; },
      addEventListener: (t, f) => { handlers.win[t] = f; },
      fetch: undefined,
      localStorage: { setItem: (...a) => stored.push(['local', ...a]) },
      sessionStorage: { setItem: (...a) => stored.push(['session', ...a]) },
    },
    URL,
    Date: { now: () => now },
    setInterval: (f, ms) => { timers.push({ f, every: ms, next: now + ms }); return timers.length; },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].dead = true; },
    fetch: (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve({}); },
  };
  ctx.window.fetch = ctx.fetch;
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    sent, stored, state, handlers,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const t = timers.filter((x) => !x.dead && x.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!t) break;
        now = t.next; t.next += t.every; t.f();
      }
      now = end;
    },
    scrollTo(top) { state.top = top; if (handlers.win.scroll) handlers.win.scroll(); },
    setHidden(v) { state.hidden = v; handlers.doc.visibilitychange(); },
  };
}

// the bottom edge of the screen has moved this share of the way through a 4000-px article that starts 800 px down
const at = (share) => 800 - share * 4000; // top of the article (negative once scrolled): innerHeight 800 - top = seen

test('20 seconds on screen and 40% scrolled: one read is sent, as a plain-text POST to the Worker', () => {
  const s = setup();
  s.advance(21000);
  assert.equal(s.sent.length, 0, 'time alone is not a read');
  s.scrollTo(at(0.5));
  s.advance(1000);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].url, 'https://api.test/v1/read');
  assert.deepEqual(s.sent[0].body, { slug: 'my-post', p: 0 });
  assert.equal(s.sent[0].init.method, 'POST');
  assert.equal(s.sent[0].init.headers['Content-Type'], 'text/plain;charset=UTF-8', 'a simple request: no preflight');
  assert.equal(s.sent[0].init.keepalive, true);
  assert.equal(s.sent[0].init.credentials, 'omit');
  s.advance(60000);
  assert.equal(s.sent.length, 1, 'only once per page view');
});

test('scrolling alone is not a read either: it takes 20 seconds', () => {
  const s = setup();
  s.scrollTo(at(1));
  s.advance(15000);
  assert.equal(s.sent.length, 0);
  s.advance(6000);
  assert.equal(s.sent.length, 1);
});

test('time spent with the tab hidden does not count', () => {
  const s = setup();
  s.scrollTo(at(0.6));
  s.advance(10000);
  s.setHidden(true);
  s.advance(120000);
  assert.equal(s.sent.length, 0, 'two minutes in the background is not reading');
  s.setHidden(false);
  s.advance(9000);
  assert.equal(s.sent.length, 0, 'only 19 seconds in front of the reader so far');
  s.advance(2000);
  assert.equal(s.sent.length, 1);
});

test('a page that is only being prerendered or loaded hidden does not count until it is shown', () => {
  const s = setup({ prerendering: true });
  s.scrollTo(at(0.6));
  s.advance(60000);
  assert.equal(s.sent.length, 0);
  s.state.prerendering = false;
  s.handlers.doc.prerenderingchange();
  s.advance(21000);
  assert.equal(s.sent.length, 1);
  const bg = setup({ hidden: true });
  bg.scrollTo(at(0.6));
  bg.advance(60000);
  assert.equal(bg.sent.length, 0);
});

test('a short article that fits on the screen counts after 20 seconds (it is all in view)', () => {
  const s = setup({ articleTop: 200, articleHeight: 500 });
  s.advance(21000);
  assert.equal(s.sent.length, 1);
});

test('a reader who came from the Popular page is flagged, so that page cannot feed itself', () => {
  for (const [referrer, flag] of [['https://mayobebros.com/popular/', 1], ['https://mayobebros.com/popular/page/2/', 1], ['https://mayobebros.com/post/', 0], ['https://www.google.com/popular/', 0], ['', 0], ['not a url', 0]]) {
    const s = setup({ referrer });
    s.scrollTo(at(0.5));
    s.advance(21000);
    assert.equal(s.sent[0].body.p, flag, referrer || '(none)');
  }
});

test('privacy signals and missing pieces: nothing is sent, nothing is stored', () => {
  for (const opts of [{ gpc: true }, { dnt: '1' }, { api: '' }, { slug: 'Bad Slug' }, { noArticle: true }]) {
    const s = setup(opts);
    s.scrollTo(at(1));
    s.advance(60000);
    assert.equal(s.sent.length, 0, JSON.stringify(opts));
  }
  const s = setup();
  s.scrollTo(at(1));
  s.advance(60000);
  assert.deepEqual(s.stored, [], 'no cookie, no local or session storage');
  assert.doesNotMatch(SRC, /localStorage|sessionStorage|document\.cookie/);
});

test('a failing request is ignored (the page never notices)', async () => {
  const s = setup();
  s.scrollTo(at(1));
  assert.doesNotThrow(() => s.advance(21000));
});

test('a tab that sleeps or sits idle cannot bank time: each look counts at most 2.5 seconds', () => {
  const s = setup();
  s.scrollTo(at(0.6));
  s.advance(3000);
  assert.equal(s.sent.length, 0);
  // the clock jumps by an hour between two looks (a laptop lid closed and opened)
  const jump = setup();
  jump.scrollTo(at(0.6));
  jump.advance(1000);
  jump.advance(3600000);
  assert.equal(jump.sent.length, 1, 'the hour is spread over looks, each capped; the page was open for it, so it ends up counted');
});
