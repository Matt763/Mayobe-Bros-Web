// The loading skeleton (scripts/lib/skeleton.mjs): shown while a page's stylesheet is on its way, never stuck, never in the way.
//   node --no-warnings --test scripts/tests/skeleton.test.mjs   (after `node scripts/build.mjs`)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { skeletonCss, skeletonScript, skeletonHtml } from '../lib/skeleton.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// the first real post page (old addresses are small redirect stubs)
const firstPost = () => {
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { const hit = walk(rel); if (hit) return hit; }
      else if (e.name === 'index.html' && read(rel).includes('<article class="post">')) return rel;
    }
    return null;
  };
  const hit = walk('post');
  if (!hit) throw new Error('no post page built');
  return hit;
};
const PAGES = ['index.html', firstPost(), 'category/educational/index.html'];

test('normal pages: skeleton first in <body>, then the stylesheet; nothing blocks the first paint in <head>', () => {
  for (const rel of PAGES) {
    const html = read(rel);
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    const body = html.slice(html.indexOf('<body'));
    assert.doesNotMatch(head, /<link rel="stylesheet"/, `${rel}: the stylesheet must not be in <head> (it would hold back the skeleton)`);
    assert.match(head, /<link rel="preload" as="style" href="\/css\/style\.css\?v=[0-9a-f]+">/, `${rel}: the stylesheet is preloaded so it still starts early`);
    assert.match(body, /^<body[^>]*>\n<div class="sk[ "][^>]*aria-hidden="true">/, `${rel}: the skeleton must be the first thing in <body>, aria-hidden`);
    assert.match(body, /<\/div>\n<link rel="stylesheet" href="\/css\/style\.css\?v=[0-9a-f]+">\n/, `${rel}: the stylesheet link follows the skeleton directly`);
    assert.equal((html.match(/class="sk[ "]/g) || []).length, 1, `${rel}: exactly one skeleton`);
  }
});

test('the skeleton has no text, no links and no images (nothing for search engines, screen readers or AdSense to read)', () => {
  for (const centered of [false, true]) {
    const html = skeletonHtml(centered);
    assert.equal(html.replace(/<[^>]*>/g, '').trim(), '');
    assert.doesNotMatch(html, /<(a|img|button|input|h\d|p)\b|href=|src=|alt=/);
  }
  assert.match(skeletonHtml(true), /class="sk sk-center"/);
});

test('status pages and redirect stubs are left alone (stylesheet in <head>, no skeleton)', () => {
  for (const rel of ['manage/index.html', 'newsletter/index.html']) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const html = read(rel);
    assert.doesNotMatch(html, /class="sk[ "]/, rel);
    assert.match(html.slice(0, html.indexOf('</head>')), /<link rel="stylesheet"/, rel);
  }
});

test('the Content-Security-Policy allows both inline head scripts by hash, and styles inline', () => {
  for (const rel of PAGES) {
    const html = read(rel);
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    const scripts = [...html.slice(0, html.indexOf('</head>')).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.includes(skeletonScript), `${rel}: the skeleton script is in <head>`);
    for (const s of scripts) {
      const hash = `'sha256-${crypto.createHash('sha256').update(s).digest('base64')}'`;
      assert.ok(csp.includes(hash), `${rel}: CSP is missing the hash of an inline script`);
    }
    assert.match(csp, /style-src 'self' 'unsafe-inline'/, `${rel}: inline <style> must stay allowed`);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/, `${rel}: no unsafe-inline for scripts`);
  }
});

test('CSS: hidden unless JavaScript is on, never blocks a click, only transform and opacity move, calm for reduced motion and print', () => {
  assert.match(skeletonCss, /\.sk\{display:none\}/, 'hidden by default (no JavaScript = no skeleton)');
  assert.match(skeletonCss, /html\.js \.sk\{[^}]*pointer-events:none[^}]*opacity:0[^}]*visibility:hidden/, 'invisible and click-through until shown');
  assert.match(skeletonCss, /html\.js\.sk-on \.sk\{[^}]*opacity:1;visibility:visible/);
  assert.match(skeletonCss, /@keyframes sk-sweep\{to\{transform:translateX\(100%\)\}\}/, 'the shimmer moves with transform only');
  assert.doesNotMatch(skeletonCss, /(background-position|height|width|left|top)\s*:[^;{}]*;?\s*\}\s*@keyframes|@keyframes[^{]+\{[^@]*(background-position|width|height|left|top)/);
  assert.match(skeletonCss, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none/);
  assert.match(skeletonCss, /@media print\{\.sk\{display:none!important\}\}/);
  assert.doesNotMatch(skeletonCss, /(^|\})\s*(html|body|:root)\s*\{[^}]*(transform|filter|contain|will-change)/, 'nothing on html or body (see CSS pitfalls)');
  assert.equal(read('css/style.css').includes('sk-sweep'), false, 'keyframe names must be unique across the site');
  assert.ok(skeletonCss.length < 4500, `the inline stylesheet is on every page: keep it small (${skeletonCss.length} bytes)`);
});

// --- the controller (inline script), run against small stand-ins for the page and the clock ---
function setup() {
  const classes = new Set();
  const handlers = { doc: {}, win: {} };
  const timers = [];
  let now = 0;
  const sk = { parentNode: { removeChild: () => { sk.removed = true; } }, removed: false };
  const ctx = {
    document: {
      documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } },
      addEventListener: (t, f) => { handlers.doc[t] = f; },
      querySelector: (s) => (s === '.sk' && !sk.removed ? sk : null),
    },
    addEventListener: (t, f) => { handlers.win[t] = f; },
    setTimeout: (f, ms) => { timers.push({ f, at: now + ms, id: timers.length + 1 }); return timers.length; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.dead = true; },
  };
  vm.createContext(ctx);
  vm.runInContext(skeletonScript, ctx);
  return {
    classes, sk, handlers,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((t) => !t.dead && !t.done && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.done = true; now = next.at; next.f();
      }
      now = end;
    },
    sheetLoaded: (type = 'load') => handlers.doc[type]({ target: { tagName: 'LINK', rel: 'stylesheet' } }),
  };
}

test('a page that loads within 250 ms never shows the skeleton', () => {
  const s = setup();
  s.advance(120);
  s.sheetLoaded();
  s.advance(1000);
  assert.equal(s.classes.has('sk-on'), false, 'never switched on');
  assert.equal(s.sk.removed, true, 'and the element is cleared away');
});

test('a slow page shows it after 250 ms and fades it out the moment the stylesheet arrives', () => {
  const s = setup();
  s.advance(249);
  assert.equal(s.classes.has('sk-on'), false);
  s.advance(2);
  assert.equal(s.classes.has('sk-on'), true);
  s.advance(2000);
  assert.equal(s.classes.has('sk-on'), true, 'still waiting');
  s.sheetLoaded();
  s.advance(151);
  assert.equal(s.classes.has('sk-on'), false, 'fade-out starts a moment after, once the page is parsed');
  assert.equal(s.sk.removed, false, 'the element stays for the fade');
  s.advance(701);
  assert.equal(s.sk.removed, true);
});

test('every way out works: stylesheet error, document parsed, window load, back-forward restore, and a 20 s limit', () => {
  const ways = {
    'stylesheet error': (s) => { s.sheetLoaded('error'); s.advance(151); },
    'DOMContentLoaded': (s) => s.handlers.doc.DOMContentLoaded(),
    'window load': (s) => s.handlers.win.load(),
    'pageshow from the back-forward cache': (s) => s.handlers.win.pageshow({ persisted: true }),
    '20 second limit': (s) => s.advance(20000),
  };
  for (const [name, go] of Object.entries(ways)) {
    const s = setup();
    s.advance(300);
    assert.equal(s.classes.has('sk-on'), true, name);
    go(s);
    assert.equal(s.classes.has('sk-on'), false, `${name}: must switch it off`);
    s.advance(800);
    assert.equal(s.sk.removed, true, `${name}: must remove it`);
  }
});

test('other loads (pictures, scripts) and a normal pageshow do not end it early; a second exit is harmless', () => {
  const s = setup();
  s.advance(300);
  s.handlers.doc.load({ target: { tagName: 'IMG', rel: '' } });
  s.handlers.doc.load({ target: { tagName: 'SCRIPT', rel: '' } });
  s.handlers.win.pageshow({ persisted: false });
  assert.equal(s.classes.has('sk-on'), true);
  s.sheetLoaded();
  s.sheetLoaded();
  s.handlers.win.load();
  s.advance(5000);
  assert.equal(s.sk.removed, true);
});

test('a script error cannot break the page (the controller swallows it)', () => {
  assert.doesNotThrow(() => vm.runInContext(skeletonScript, vm.createContext({})));
});
