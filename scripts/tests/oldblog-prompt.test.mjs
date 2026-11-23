// The sign-up box for readers who arrive from the old blog (mbagamc.blogspot.com): template on articles only, recognition of those
// readers, the rules of js/oldblog-prompt.js (never on arrival, once per visit, a date stored only after the reader acts, no history
// tricks, no modal), the Cookie Policy lines, the #subscribe anchor and the hooks in js/subscribe.js.
//   node --no-warnings --test scripts/tests/oldblog-prompt.test.mjs        (run `node scripts/build.mjs` first)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SITE = read('js/site.js');
const PROMPT = read('js/oldblog-prompt.js');
const SUB = read('js/subscribe.js');
const CSS = read('css/style.css');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

function pages(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html') out.push(p);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

test('every ordinary article carries one inert template with the sign-up form; no other page does', () => {
  let articles = 0;
  for (const file of pages('post')) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const n = (html.match(/<template data-oldblog-prompt\b/g) || []).length;
    const isApp = /data-rs\b|data-papers\b|class="rs\b|class="pp-/.test(html) && !/class="article-content"/.test(html);
    if (isApp) { assert.equal(n, 0, `${rel}: results and past-paper pages are not articles`); continue; }
    if (!/class="article-content"/.test(html)) continue;
    articles++;
    assert.equal(n, 1, `${rel}: one template`);
    const tpl = html.match(/<template data-oldblog-prompt[\s\S]*?<\/template>/)[0];
    assert.match(tpl, /data-src="\/js\/oldblog-prompt\.js"/, `${rel}: points at the script`);
    assert.match(tpl, /<form class="foot-form nl-form nl-mini"[^>]*data-newsletter/, `${rel}: the ordinary sign-up form`);
    assert.match(tpl, /id="obp-email"/);
    assert.match(tpl, /data-obp-close/, `${rel}: a close button`);
    assert.doesNotMatch(tpl, /\sstyle=/, `${rel}: no style attributes (the page's policy blocks them)`);
    assert.doesNotMatch(tpl, /<script/i);
    assert.equal((html.match(/id="obp-email"/g) || []).length, 1, `${rel}: ids appear once`);
  }
  assert.ok(articles > 20, `checked ${articles} articles`);
  for (const f of ['index.html', 'about/index.html', 'popular/index.html', '404.html']) {
    if (fs.existsSync(path.join(ROOT, f))) assert.doesNotMatch(read(f), /data-oldblog-prompt/, `${f}: not an article`);
  }
});

test('the footer sign-up band has the #subscribe anchor the old blog links to', () => {
  const home = read('index.html');
  assert.equal((home.match(/id="subscribe"/g) || []).length, 1);
  assert.match(home, /<div class="foot-cta" id="subscribe">/);
  assert.ok(fs.existsSync(path.join(ROOT, 'js/oldblog-prompt.js')));
});

test('js/site.js recognises old-blog readers by the tag or the blog address only, and remembers it for the visit only', () => {
  const block = SITE.slice(SITE.indexOf('readers who arrive from the old blog'), SITE.indexOf('/* ---------------------------------------------------------------- share */'));
  assert.ok(block.length > 200);
  assert.match(block, /utm_source=oldblog/);
  const re = new RegExp(block.match(/came = \/(.+?)\/i\.test\(new URL/)[1], 'i');
  for (const ok of ['mbagamc.blogspot.com', 'MBAGAMC.blogspot.com', 'mbagamc.blogspot.co.uk', 'mbagamc.blogspot.com.ng', 'mbagamc.blogspot.de']) assert.match(ok, re, ok);
  for (const bad of ['mbagamc.blogspot.com.evil.com', 'evilmbagamc.blogspot.com', 'xmbagamc.blogspot.com', 'blogspot.com', 'mbagamc.blogspot.com.example', 'example.com', 'mbagamc.blogspot.']) assert.doesNotMatch(bad, re, bad);
  assert.match(block, /sessionStorage/);
  assert.doesNotMatch(block, /localStorage|store\(/, 'session storage only');
  assert.match(block, /note === 'shown'/, 'no script load once the box was shown in this visit');
  assert.match(block, /data-src/);
});

test('js/oldblog-prompt.js follows the rules: after reading, once, dismissible, no history tricks, no modal, nothing stored before an action', () => {
  const src = code(PROMPT);
  assert.match(src, /NEED_MS = 20000/);
  assert.match(src, /NEED_DEPTH = 0\.4/);
  assert.match(src, /closed: 14, subscribed: 365/);
  for (const bad of [/history\.(push|replace)State/, /beforeunload/, /unload\b/, /\balert\(|\bconfirm\(|\bprompt\(/, /document\.cookie/, /showModal|<dialog|aria-modal/, /\.style\./, /innerHTML/, /location\.(href|assign|replace)/, /fetch\(|XMLHttpRequest|sendBeacon/]) {
    assert.doesNotMatch(src, bad, `must not contain ${bad}`);
  }
  // storage: one local key, written only by remember(), which only the close and sign-up paths call
  assert.equal((src.match(/localStorage\.setItem/g) || []).length, 1);
  assert.equal((src.match(/remember\('/g) || []).length, 2); // 'closed' (close button) and 'subscribed' (a sign-up from any form)
  // it opens only through show(), which is reached from the 1 s check (after the engagement test) and the pointer leaving after it
  assert.equal((src.match(/\bshow\(\)/g) || []).length, 3);
  assert.match(src, /engaged\(\) && !busy\(\)/);
  assert.match(src, /depth >= NEED_DEPTH && visibleMs >= NEED_MS && !busy\(\)/);
  // the keyboard focus is never moved into the box; it is only given back if it was inside when the box closed
  assert.doesNotMatch(src, /box\.focus|\.obp.*\.focus\(/);
  assert.match(src, /Escape/);
  assert.match(src, /e\.defaultPrevented/, 'an Escape meant for a menu does not count as dismissing the box');
  assert.match(src, /box\.contains\(a\)/);
  assert.match(src, /classList\.add\('is-open'\)/);
  for (const w of ['.cookie:not(.is-leaving)', 'no-scroll', '.player.is-open', '.video-figure.is-mini']) assert.ok(src.includes(w), `waits for ${w}`);
});

// run the script against a small fake page: it must stay quiet when the reader closed it recently or signed up, and start watching otherwise
function run({ stored, template = true, article = true }) {
  const timers = []; const listeners = {}; const docListeners = {};
  const tplEl = { content: { cloneNode: () => ({ querySelector: () => null }) } };
  const el = { getBoundingClientRect: () => ({ top: 0, height: 1000 }) };
  const document = {
    hidden: false, activeElement: null,
    querySelector: (s) => (/template/.test(s) ? (template ? tplEl : null) : /post-end/.test(s) ? el : null),
    getElementById: () => (article ? el : null),
    addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
    documentElement: { addEventListener: () => {} },
    body: { classList: { contains: () => false }, appendChild() {} },
  };
  const window = {
    document, innerHeight: 800,
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    setInterval: (f, ms) => { timers.push(ms); return 1; }, clearInterval() {}, setTimeout: () => 1,
    requestAnimationFrame: (f) => f(), matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => (stored === undefined ? null : JSON.stringify(stored)), setItem() {} },
    sessionStorage: { setItem() {} },
  };
  vm.runInNewContext(PROMPT, { window, document, Date, JSON, Math });
  return { timers, docListeners, listeners };
}
test('the box starts watching only when the reader has not recently closed it or signed up', () => {
  const day = 86400000; const now = Date.now();
  assert.deepEqual(run({}).timers, [1000], 'nothing stored: it watches');
  assert.deepEqual(run({ stored: { s: 'closed', t: now - 15 * day } }).timers, [1000], 'closed 15 days ago: it may come back');
  assert.deepEqual(run({ stored: { s: 'closed', t: now - 2 * day } }).timers, [], 'closed 2 days ago: it stays away');
  assert.deepEqual(run({ stored: { s: 'subscribed', t: now - 200 * day } }).timers, [], 'signed up 200 days ago: it stays away');
  assert.deepEqual(run({ stored: { s: 'subscribed', t: now - 400 * day } }).timers, [1000], 'signed up over a year ago');
  assert.deepEqual(run({ stored: { s: 'x', t: 'garbage' } }).timers, [1000], 'a damaged value counts as nothing');
  assert.deepEqual(run({ template: false }).timers, [], 'no template: nothing');
  assert.deepEqual(run({ article: false }).timers, [], 'not an article: nothing');
  assert.ok(run({}).docListeners['mb:subscribed'], 'it hears a sign-up from any form');
});

test('js/subscribe.js lets the box wire its own copy of the form, once, and announces a sign-up without the address', () => {
  assert.match(SUB, /window\.MBNewsletter = \{ wire: wire \}/);
  assert.match(SUB, /form\.__mbWired/);
  assert.match(SUB, /new CustomEvent\('mb:subscribed'\)/);
  assert.doesNotMatch(SUB, /CustomEvent\('mb:subscribed',\s*\{\s*detail/, 'the address is never passed on');
});

test('the Cookie Policy lists both keys, and the built page shows them', () => {
  const page = read('content/pages/cookie-policy.html');
  assert.match(page, /mayobebros-from-oldblog[\s\S]*Session storage/);
  assert.match(page, /mayobebros-oldblog-prompt[\s\S]*Local storage/);
  assert.match(page, /\{\{#newsletter\}\}<tr><td><code>mayobebros-from-oldblog/);
  const built = read('cookie-policy/index.html');
  assert.match(built, /mayobebros-from-oldblog/);
  assert.match(built, /mayobebros-oldblog-prompt/);
  // every key the scripts write is in the policy
  assert.match(PROMPT, /'mayobebros-from-oldblog'/);
  assert.match(PROMPT, /'mayobebros-oldblog-prompt'/);
  assert.match(SITE, /'mayobebros-from-oldblog'/);
});

test('the box is a corner card or bottom sheet that sits under the cookie notice and the menus, and respects reduced motion and print', () => {
  const start = CSS.indexOf('/* The sign-up box for readers who arrive from the old blog');
  assert.ok(start > 0);
  const css = CSS.slice(start);
  assert.match(css, /\.obp \{ position: fixed; z-index: 54;/);
  assert.doesNotMatch(css, /backdrop-filter|::backdrop|\.obp-scrim/, 'no wall behind it');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.obp/);
  assert.match(css, /@media print \{ \.obp \{ display: none !important; \} \}/);
  assert.match(css, /\.obp-x \{[^}]*width: 2\.75rem; height: 2\.75rem/, 'a 44 px close button');
  // layers: the cookie notice (80), the search (70) and the Listen player (70) are above; the drawer backdrop (55) is above
  assert.match(CSS, /\.cookie \{ position: fixed;[^}]*z-index: 80/);
  assert.match(CSS, /\.drawer-backdrop \{ position: fixed; inset: 0; z-index: 55/);
});
