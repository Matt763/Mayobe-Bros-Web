// The contents list on phones and tablets (below 1180px): a bar that sticks under the header once the reader scrolls to it,
// with the list dropping over the article as a panel. Large screens keep the open card beside the article.
//   node --no-warnings --test scripts/tests/toc.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const SITE = fs.readFileSync(path.join(ROOT, 'js', 'site.js'), 'utf8');
const LISTEN = fs.readFileSync(path.join(ROOT, 'js', 'listen.js'), 'utf8');

const start = CSS.indexOf('/* Phones and tablets (below 1180px)');
const BLOCK_CSS = CSS.slice(start, CSS.indexOf('/* Large displays', start));

function postPages() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html') out.push(p);
    }
  };
  walk(path.join(ROOT, 'post'));
  return out;
}

test('every post with a contents list carries the bar markup (label, section name, list)', () => {
  let checked = 0;
  for (const file of postPages()) {
    const html = fs.readFileSync(file, 'utf8');
    const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>/);
    if (!toc) continue;
    checked++;
    const rel = path.relative(ROOT, file);
    assert.match(toc[0], /<details open data-toc-details>/, `${rel}: details must start open (large screens); site.js folds it on small ones`);
    assert.match(toc[0], /<span class="toc-label">In this article<\/span>/, `${rel}: the label text "In this article" must stay in the summary`);
    assert.match(toc[0], /<span class="toc-now" data-toc-now aria-hidden="true" hidden><\/span>/, `${rel}: the section name slot is missing`);
    assert.match(toc[0], /<\/summary><ol>/, `${rel}: the list must follow the summary directly (the panel rule is "details > ol")`);
  }
  assert.ok(checked > 0, 'no post had a contents list');
});

test('small-screen bar: every rule needs JavaScript (html.js) and sits inside the below-1180px media query', () => {
  assert.ok(start > 0 && BLOCK_CSS.length > 200, 'the "Phones and tablets" block is missing from css/style.css');
  const media = BLOCK_CSS.match(/@media \(max-width: 1179\.98px\) \{([\s\S]*?)\n\}\n/);
  assert.ok(media, 'the rules must live in @media (max-width: 1179.98px), so the card beside the article is untouched');
  for (const rule of media[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('/*'))) {
    assert.match(rule, /^html\.js /, `without JavaScript the list must stay an open card, so this rule needs html.js: ${rule.slice(0, 70)}`);
  }
});

test('small-screen bar: sticks under the real header height, below the header, and the panel never moves the text', () => {
  assert.match(BLOCK_CSS, /html\.js \.post-toc \{ position: sticky; top: calc\(var\(--header-real, [^)]+\) \+ 0\.5rem\); z-index: 35;/);
  const header = CSS.match(/\.site-header \{[^}]*z-index: (\d+)/);
  assert.ok(header && Number(header[1]) > 35, 'the header (and its menus) must stay above the contents bar');
  // the panel is absolutely positioned, so opening or closing it cannot push the article up or down
  assert.match(BLOCK_CSS, /html\.js \.toc details > ol \{ position: absolute;/);
  assert.match(BLOCK_CSS, /overflow-y: auto; overscroll-behavior: contain;/);
  assert.match(BLOCK_CSS, /var\(--cookie-h, 0px\)/, 'the panel must stay clear of the cookie notice');
  // hidden until site.js has decided open or folded, so it never flashes open on a phone
  assert.match(BLOCK_CSS, /html\.js \.toc details:not\(\[data-ready\]\) > ol \{ display: none; \}/);
  assert.match(BLOCK_CSS, /html\.js \.post-layout \{ display: block; \}/, 'sticky needs a block parent that spans the whole article');
  // only opacity and transform animate; nothing on html or body
  assert.doesNotMatch(BLOCK_CSS, /(^|\n)\s*(html|body|:root)\s*\{[^}]*transform/);
  assert.match(CSS, /\.article-content h2, \.article-content h3 \{ scroll-margin-top: calc\(var\(--header-h\) \+ 1rem\); \}/, 'headings must keep clearing the header and the bar');
});

test('site.js keeps the bar in step with the page, without native smooth scrolling', () => {
  assert.match(SITE, /setProperty\('--header-real'/);
  assert.match(SITE, /classList\.toggle\('is-stuck'/);
  assert.match(SITE, /classList\.toggle\('is-past'/);
  assert.match(SITE, /data-toc-now/);
  const tocPart = SITE.slice(SITE.indexOf('Contents list: the link of the section'), SITE.indexOf('var update = function'));
  assert.doesNotMatch(tocPart, /scrollIntoView|behavior:\s*['"]smooth/, 'page movement stays native anchor jumps (see "Never use native smooth scrolling")');
  const detailsPart = SITE.slice(SITE.indexOf('/* The contents list. On large screens'), SITE.indexOf('/* Home page topic rail'));
  assert.doesNotMatch(detailsPart, /scrollIntoView|scrollTo\(/);
  // Listen scrolls to the sentence being read: it has to leave room for the bar too
  assert.match(LISTEN, /post-toc\.is-stuck:not\(\.is-past\)/);
});

// --- the open / fold behaviour (the last block of js/site.js), run against small stand-ins for the page ---
const BLOCK_JS = SITE.slice(SITE.indexOf('/* The contents list. On large screens'), SITE.indexOf('/* Home page topic rail'));

function setup({ narrow }) {
  const handlers = {};
  const docHandlers = {};
  const inside = { id: 'inside' };
  const summary = { focused: false, focus() { this.focused = true; } };
  const current = { offsetTop: 300, offsetHeight: 40 };
  const list = { scrollTop: 99, clientHeight: 200, querySelector: (s) => (s === 'a.is-current' ? current : null) };
  const d = {
    open: true, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener: (t, f) => { handlers[t] = f; },
    querySelector: (s) => (s === ':scope > ol' ? list : s === 'summary' ? summary : null),
    contains: (n) => n === inside,
  };
  const mq = { matches: narrow, addEventListener: (t, f) => { mq.change = f; } };
  const ctx = { document: { querySelector: () => d, addEventListener: (t, f) => { docHandlers[t] = f; } }, window: { matchMedia: () => mq } };
  vm.createContext(ctx);
  vm.runInContext(BLOCK_JS, ctx);
  const link = { closest: (s) => (s === 'ol a' ? {} : null) };
  const other = { closest: () => null };
  return {
    d, list, summary, mq, inside,
    clickLink: () => handlers.click({ target: link }),
    clickOther: () => handlers.click({ target: other }),
    pointerdown: (target) => docHandlers.pointerdown({ target }),
    key: (key) => handlers.keydown({ key }),
    toggle: () => handlers.toggle(),
    cross: (matches) => { mq.matches = matches; mq.change(); },
  };
}

test('phones and tablets start folded, large screens start open, and the CSS is told it can show the panel', () => {
  const s = setup({ narrow: true });
  assert.equal(s.d.open, false);
  assert.ok('data-ready' in s.d.attrs);
  assert.equal(setup({ narrow: false }).d.open, true);
});

test('choosing a section, tapping outside and Escape fold the panel (small screens only)', () => {
  let s = setup({ narrow: true });
  s.d.open = true; s.clickLink();
  assert.equal(s.d.open, false, 'a chosen section closes the panel');
  s.d.open = true; s.clickOther();
  assert.equal(s.d.open, true, 'a tap on the bar itself must not close it');
  s.pointerdown(s.inside);
  assert.equal(s.d.open, true, 'a tap inside the contents list keeps it open');
  s.pointerdown({ id: 'article text' });
  assert.equal(s.d.open, false, 'a tap outside closes it');
  s.d.open = true; s.key('a');
  assert.equal(s.d.open, true);
  s.key('Escape');
  assert.equal(s.d.open, false);
  assert.equal(s.summary.focused, true, 'focus goes back to the bar');

  s = setup({ narrow: false });
  s.clickLink(); s.pointerdown({ id: 'article text' }); s.key('Escape');
  assert.equal(s.d.open, true, 'the card beside the article on a large screen is never folded by these');
});

test('turning a tablet across the 1180px line switches between card and bar', () => {
  const s = setup({ narrow: true });
  s.cross(false);
  assert.equal(s.d.open, true);
  s.cross(true);
  assert.equal(s.d.open, false);
});

test('opening the panel scrolls the list to the section being read', () => {
  const s = setup({ narrow: true });
  s.d.open = true; s.toggle();
  assert.equal(s.list.scrollTop, 300 - 100 + 20);
  s.d.open = false; s.list.scrollTop = 7; s.toggle();
  assert.equal(s.list.scrollTop, 7, 'nothing moves while folded');
});
