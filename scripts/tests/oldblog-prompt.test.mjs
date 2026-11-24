// The sign-up modal for readers who arrive from the old blog (mbagamc.blogspot.com): template on articles only, recognition of those
// readers, the rules of js/oldblog-prompt.js (never on arrival, once per visit, a date stored only after the reader acts, no history
// tricks, a real modal: native <dialog> + showModal, Escape through the cancel event, an animated exit before close(), a fallback,
// a sheet that follows a finger on phones, reduced motion), the Cookie Policy lines, the #subscribe anchor and the hooks in js/subscribe.js.
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
    assert.match(tpl, /<dialog class="obp" aria-modal="true" aria-labelledby="obp-title" aria-describedby="obp-text" data-obp>/, `${rel}: a native dialog, named and described`);
    assert.match(tpl, /id="obp-title" tabindex="-1"/, `${rel}: the heading can take the focus`);
    assert.match(tpl, /id="obp-text"/);
    assert.match(tpl, /data-obp-scrim/, `${rel}: the dimmed page is its own element`);
    assert.match(tpl, /data-obp-card/);
    assert.match(tpl, /data-obp-drag/, `${rel}: a part a finger can pull on a phone`);
    assert.match(tpl, /data-obp-later/);
    assert.match(tpl, /class="obp-glow" aria-hidden="true"/, `${rel}: the decoration is hidden from screen readers`);
    assert.match(tpl, /class="obp-x" type="button" data-obp-close aria-label="Close"/, `${rel}: a close button`);
    assert.doesNotMatch(tpl, /\sstyle=/, `${rel}: no style attributes (the page's policy blocks them)`);
    assert.doesNotMatch(tpl, /<script/i);
    assert.doesNotMatch(tpl, /data-obp-live/, `${rel}: no extra announcement (the dialog's own name and the moved focus are read out)`);
    assert.equal((html.match(/id="obp-email"/g) || []).length, 1, `${rel}: ids appear once`);
    assert.equal((html.match(/id="obp-title"/g) || []).length, 1, `${rel}: ids appear once`);
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

test('js/oldblog-prompt.js follows the rules: after reading, once, dismissible, no history tricks, nothing stored before an action', () => {
  const src = code(PROMPT);
  assert.match(src, /NEED_MS = 20000/);
  assert.match(src, /NEED_DEPTH = 0\.4/);
  assert.match(src, /closed: 14, subscribed: 365/);
  for (const bad of [/history\.(push|replace)State/, /beforeunload/, /unload\b/, /\balert\(|\bconfirm\(|\bprompt\(/, /document\.cookie/, /innerHTML|outerHTML|insertAdjacentHTML/, /location\.(href|assign|replace)/, /fetch\(|XMLHttpRequest|sendBeacon/, /eval\(|new Function/]) {
    assert.doesNotMatch(src, bad, `must not contain ${bad}`);
  }
  // no inline style written: only custom properties go through the style object (the page's policy and this site's rule)
  assert.doesNotMatch(src, /\.style\.(?!setProperty|removeProperty|getPropertyValue)/, 'only style.setProperty / removeProperty / getPropertyValue');
  assert.doesNotMatch(src, /setAttribute\('style'|cssText/);
  // storage: one local key, written only by remember(), which only the close and sign-up paths call
  assert.equal((src.match(/localStorage\.setItem/g) || []).length, 1);
  assert.equal((src.match(/remember\('/g) || []).length, 2); // 'closed' (every way of leaving) and 'subscribed' (a sign-up from any form)
  assert.match(src, /if \(!done\) remember\('closed'\)/, 'leaving after a sign-up does not replace the year-long note');
  // it opens only through show(), which is reached from the 1 s check (after the engagement test) and the pointer leaving after it
  assert.equal((src.match(/\bshow\(\)/g) || []).length, 3);
  assert.match(src, /engaged\(\) && !busy\(\)/);
  assert.match(src, /depth >= NEED_DEPTH && visibleMs >= NEED_MS && !busy\(\)/);
  for (const w of ['.cookie:not(.is-leaving)', 'no-scroll', '.player.is-open', '.video-figure.is-mini']) assert.ok(src.includes(w), `waits for ${w}`);
});

test('the modal is a native dialog opened with showModal, with a fallback, a heading that takes the focus, and focus and scroll put back', () => {
  const src = code(PROMPT);
  assert.match(src, /d\.showModal\(\)/);
  assert.match(src, /typeof d\.showModal !== 'function'/, 'a browser without showModal gets the fallback');
  assert.match(src, /is-fallback/);
  assert.match(src, /setAttribute\('role', 'dialog'\)/);
  assert.match(src, /makeInert\(true\)/, 'fallback: the rest of the page is made inert by hand');
  assert.match(src, /makeInert\(false\)/);
  assert.match(src, /k !== 'Tab'/, 'fallback: Tab is kept inside');
  // the heading takes the focus, never the field (no on-screen keyboard on a phone)
  assert.match(src, /querySelector\('\.obp-title'\)/);
  assert.match(src, /h\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(src, /elements\.email|#obp-email|\.focus\(\)\s*;?\s*\/\/ field/);
  // focus goes back to what had it, and the scroll place is kept (never by smooth scrolling: the site's html has scroll-behavior: smooth)
  assert.match(src, /back\.focus\(\{ preventScroll: true \}\)/);
  assert.match(src, /behavior: 'instant'/);
  // scroll lock by a class on the body (the same overflow rule as body.no-scroll), put back on every way out
  assert.match(src, /classList\.add\('obp-lock'\)/);
  assert.match(src, /classList\.remove\('obp-lock'\)/);
  // the on-screen keyboard: the dialog is sized to the visible part of the window
  assert.match(src, /visualViewport/);
  assert.match(src, /--obp-vh/);
});

test('every way out is one animated exit; close() is called only after it, and rapid or repeated closes cannot get stuck', () => {
  const src = code(PROMPT);
  // Escape and the phone's back gesture arrive as the cancel event: the default is stopped so the exit animation still plays
  assert.match(src, /addEventListener\('cancel', function \(e\) \{ e\.preventDefault\(\); close\(\); \}\)/);
  assert.match(src, /k === 'Escape'/);
  assert.match(src, /e\.preventDefault\(\); close\(\); return;/, 'Escape on the keyboard also takes the animated way');
  // the scrim and the buttons all call the same close()
  assert.match(src, /data-obp-close/);
  assert.match(src, /e\.target === scrim/);
  // re-entry guard, and the dialog is closed only inside finish(), which runs after the exit animation (with a timer as a backstop)
  assert.match(src, /if \(!dlg \|\| closing\) return;/);
  assert.equal((src.match(/\.close\(\)/g) || []).length, 1, 'one native close(), inside finish()');
  assert.match(src, /function finish\(\) \{[\s\S]*?d\.close\(\)/);
  assert.match(src, /last\.onfinish = finish/);
  assert.match(src, /win\.setTimeout\(finish, 900\)/);
  // the exit starts from where the card is now (a close during the entrance does not jump), and running animations are cancelled first
  assert.match(src, /getComputedStyle\(card\)/);
  assert.match(src, /stopAnims\(\)/);
  // the browser closing it on its own (a second Escape during the exit) is cleaned up at once
  assert.match(src, /addEventListener\('close', function \(\) \{ if \(dlg === d\) finish\(\); \}\)/);
  // a click that began on the card and ended on the dimmed page (a text selection) is not a tap on the scrim
  assert.match(src, /downOnScrim/);
});

test('motion: Web Animations on transform and opacity only, springs with a fallback, a quick fade for reduced motion, a sheet that follows a finger', () => {
  const src = code(PROMPT);
  // only these properties are animated from the script
  const props = new Set();
  for (const m of src.matchAll(/\{ (opacity|transform)[:,]/g)) props.add(m[1]);
  for (const m of src.matchAll(/\{ transform: /g)) props.add('transform');
  assert.deepEqual([...props].sort(), ['opacity', 'transform']);
  assert.doesNotMatch(src, /\b(width|height|top|left|margin|padding|filter)\s*:\s*\[/, 'no layout property is animated');
  assert.match(src, /SPRING_CARD = 'linear\(/);
  assert.match(src, /SPRING_SHEET = 'linear\(/);
  assert.match(src, /CSS\.supports\('animation-timing-function', 'linear\(0, 1\)'\)/, 'springs only where linear() exists');
  assert.match(src, /cubic-bezier\(\.2, 1\.12, \.3, 1\)/, 'and a cubic-bezier with a small overshoot elsewhere');
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /if \(quiet\) return;/, 'reduced motion: the entrance stops after the fades (no spring, no stagger)');
  assert.match(src, /if \(calm\(\)\) return;/, 'reduced motion: the spring back is instant');
  // the exit is shorter than the entrance (about 55 to 60%)
  const enter = Number(src.match(/duration: phone \? 620 : 640/) ? 640 : 0);
  const leave = Number((src.match(/play\(card, \[\{ transform: from \}, \{ transform: 'translate3d\(0, 14px, 0\) scale\(\.96\)' \}\], \{ duration: (\d+)/) || [])[1]);
  assert.ok(enter && leave && leave / enter > 0.5 && leave / enter < 0.62, `exit ${leave} ms vs entrance ${enter} ms`);
  // the sheet follows a finger: pointer events on the handle and the heading, capture, rubber band, speed from the event's own time, a third of the sheet
  assert.match(src, /data-obp-drag/);
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) assert.ok(src.includes(`'${ev}'`), ev);
  assert.match(src, /setPointerCapture/);
  assert.match(src, /function rubber\(/);
  assert.match(src, /e\.timeStamp/);
  assert.match(src, /h \* 0\.35/);
  assert.match(src, /--obp-dy/);
  assert.match(src, /--obp-fade/, 'the dimmed page fades with the pull');
  // a weak device, or slow frames after the entrance, drops the blur
  assert.match(src, /function weak\(\)/);
  assert.match(src, /deviceMemory/);
  assert.match(src, /is-lite/);
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

test('the modal CSS: full-screen dialog frame, sheet below 40rem and card above, safe areas, unique obp- keyframes on transform and opacity only, reduced motion, print', () => {
  const start = CSS.indexOf('/* The sign-up modal for readers who arrive from the old blog');
  assert.ok(start > 0);
  const end = CSS.indexOf('/* Picture credit in an article', start);
  const css = CSS.slice(start, end);
  assert.match(css, /dialog\.obp \{ position: fixed; top: var\(--obp-vt, 0px\); left: 0;[^}]*height: var\(--obp-vh, 100%\);[^}]*container: obp \/ size; \}/);
  assert.match(css, /dialog\.obp:not\(\[open\]\) \{ display: none; \}/);
  assert.match(css, /dialog\.obp::backdrop \{ background: transparent; \}/);
  assert.doesNotMatch(css, /\.obp \{ position: fixed; z-index: 54/, 'no layer number: the top layer is above everything');
  // sheet and card
  assert.match(css, /place-items: end center/);
  assert.match(css, /@media \(min-width: 40rem\) \{[\s\S]*?place-items: center;/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.obp-grab \{[^}]*touch-action: none/);
  assert.match(css, /\.obp-scrim \{[^}]*touch-action: none/);
  assert.match(css, /\.obp-body \{[^}]*overscroll-behavior: contain/);
  // colours come from the site's tokens (light and dark), never a fixed white card
  assert.match(css, /\.obp-card \{[^}]*background: var\(--surface\)[^}]*color: var\(--text\)/);
  assert.doesNotMatch(css.replace(/rgba\(7, 13, 43[^)]*\)/g, ''), /#fff\b|#ffffff|background: white/i, 'no hard-coded white');
  // scroll lock without a jump
  assert.match(css, /body\.obp-lock \{ overflow: hidden; \}/);
  assert.match(css, /:root:has\(body\.obp-lock\) \{ scrollbar-gutter: stable; \}/);
  // touch targets and rings
  assert.match(css, /\.obp-x \{[^}]*width: 2\.75rem; height: 2\.75rem/, 'a 44 px close button');
  assert.match(css, /\.obp-later \{[^}]*min-height: 2\.75rem/);
  assert.match(css, /\.obp-x:focus-visible/);
  assert.match(css, /\.obp-later:focus-visible/);
  // keyframes: all prefixed obp-, unique across every stylesheet, and only transform and opacity inside them
  const names = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 4);
  for (const n of names) assert.match(n, /^obp-/, `${n} starts with obp-`);
  const all = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'css')).filter((x) => x.endsWith('.css'))) for (const m of read('css/' + f).matchAll(/@keyframes ([\w-]+)/g)) all.push(m[1]);
  for (const n of names) assert.equal(all.filter((x) => x === n).length, 1, `${n} is defined once in all of css/`);
  for (const m of css.matchAll(/@keyframes obp-[\w-]+ \{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const decls = [...m[1].matchAll(/([\w-]+)\s*:/g)].map((d) => d[1]).filter((d) => !/^\d/.test(d));
    for (const d of decls) assert.ok(['transform', 'opacity'].includes(d), `${d} inside an obp- keyframe`);
  }
  assert.doesNotMatch(css, /transition:[^;}]*\b(height|width|top|left|margin|padding)\b/, 'no layout property is animated');
  // no transform, filter or will-change on html or body for this modal
  assert.doesNotMatch(css, /(^|\n)(html|body)(\.[\w-]+)?\s*\{[^}]*(transform|filter|will-change)/, 'html and body never carry a transform');
  // the blur: a lighter way out for people who ask for less transparency and for weak devices
  assert.match(css, /\.obp\.is-lite \.obp-scrim \{[^}]*backdrop-filter: none/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  // short windows and the on-screen keyboard: container queries on the dialog's own (visible) height
  assert.match(css, /@container obp \(max-height: 36rem\)/);
  assert.match(css, /@container obp \(max-height: 30rem\)/);
  // reduced motion: the decoration goes
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.obp-glow i, \.obp-glow b \{ display: none; \}/);
  assert.match(css, /\.obp-badge, \.obp-badge::before \{ animation: none; \}/);
  assert.match(css, /@media print \{ \.obp \{ display: none !important; \} \}/);
  // the cookie notice is still a normal-layer box at 80; the script waits while it is on screen
  assert.match(CSS, /\.cookie \{ position: fixed;[^}]*z-index: 80/);
});
