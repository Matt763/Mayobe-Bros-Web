// The AI use policy: robots.txt tiers, /license.xml, the terms page, the Cloudflare rules in docs/, the feed (no full text) and the copy note.
//   node scripts/build.mjs && node --no-warnings --test scripts/tests/ai-policy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { TIER_A, TIER_B, NEVER_NAMED, CF_TIER_A, CF_TIER_B, CF_SOURCE_FOLDERS, cfUserAgentExpression, cfSourcesExpression, aiRobotsGroups, licenseXml } from '../lib/ai-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const config = JSON.parse(read('site.config.json'));
const built = fs.existsSync(path.join(ROOT, 'robots.txt'));
const skip = built ? false : 'run node scripts/build.mjs first';

// robots.txt -> groups of { agents, rules }; a User-agent line after a rule starts a new group (RFC 9309)
function groups(txt) {
  const out = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; out.push(cur); }
      cur.agents.push(m[2]);
      lastWasAgent = true;
    } else if (cur && ['allow', 'disallow', 'content-signal'].includes(k)) { cur.rules.push(`${k}: ${m[2]}`); lastWasAgent = false; }
  }
  return out;
}
const groupOf = (gs, agent) => gs.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));

test('robots.txt: tier A is allowed and repeats the closed folders, tier B is refused', { skip }, () => {
  if (!config.blockAiCrawlers) return;
  const gs = groups(read('robots.txt'));
  const star = groupOf(gs, '*');
  assert.ok(star.rules.includes('allow: /') && star.rules.includes('disallow: /results/data/'));
  assert.ok(star.rules.some((r) => /^content-signal: search=yes, ai-train=no$/.test(r)));
  const closed = star.rules.filter((r) => r.startsWith('disallow:') || (r.startsWith('allow:') && r !== 'allow: /'));
  assert.ok(closed.length >= 10);
  if (config.aiAnswers === 'allow') {
    for (const a of TIER_A) {
      const g = groupOf(gs, a);
      assert.ok(g, `${a} has its own group`);
      assert.ok(g.rules.includes('allow: /') && !g.rules.includes('disallow: /'), `${a} is allowed`);
      for (const c of closed) assert.ok(g.rules.includes(c), `${a} repeats "${c}" (a named group replaces "*")`);
    }
  }
  const refused = config.aiAnswers === 'allow' ? TIER_B : [...TIER_A, ...TIER_B];
  for (const b of refused) assert.ok(groupOf(gs, b)?.rules.includes('disallow: /'), `${b} is refused`);
  assert.ok(groupOf(gs, '__usage_ai-training')?.rules.includes('disallow: /'));
});

test('robots.txt never names a search, ads or link-preview crawler', { skip }, () => {
  const names = groups(read('robots.txt')).flatMap((g) => g.agents.map((a) => a.toLowerCase()));
  for (const n of NEVER_NAMED) assert.ok(!names.includes(n.toLowerCase()), `${n} must stay under "*"`);
  for (const bad of ['googlebot', 'bingbot', 'applebot', 'mediapartners-google', 'adsbot-google', 'duckduckbot', 'yandexbot']) assert.ok(!names.includes(bad), bad);
  assert.ok(!TIER_A.concat(TIER_B).some((t) => NEVER_NAMED.some((n) => n.toLowerCase() === t.toLowerCase())), 'the lists do not overlap');
  const txt = read('robots.txt');
  assert.match(txt, /^License: https:\/\/mayobebros\.com\/license\.xml$/m);
  assert.match(txt, /^Sitemap: https:\/\/mayobebros\.com\/sitemap\.xml$/m);
  assert.ok(!/Mediapartners-Google \(AdSense\) follow/.test(txt), 'the old wrong comment is gone');
});

test('the one switch: with aiAnswers block, tier A is refused too and the licence permits search only', () => {
  const closed = ['Disallow: /content/'];
  const g = groups(aiRobotsGroups({ closed, answers: 'block' }).join('\n'));
  for (const a of TIER_A) assert.ok(groupOf(g, a)?.rules.includes('disallow: /'), a);
  assert.ok(!aiRobotsGroups({ closed, answers: 'block' }).some((l) => /^Allow: \/$/.test(l)));
  const abs = (p) => `https://mayobebros.com${p}`;
  const x = licenseXml({ abs, answers: 'block' });
  assert.match(x, /<permits type="usage">search<\/permits>/);
  assert.match(x, /<prohibits type="usage">ai-train ai-input ai-index<\/prohibits>/);
});

test('/license.xml is RSL: free for search and answers with attribution, training prohibited, a contact and the terms', { skip }, () => {
  if (!config.blockAiCrawlers) return;
  const x = read('license.xml');
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rsl xmlns="https:\/\/rslstandard\.org\/rsl">/);
  assert.match(x, /<permits type="usage">search ai-input ai-index<\/permits>/);
  assert.match(x, /<prohibits type="usage">ai-train<\/prohibits>/);
  assert.match(x, /<payment type="attribution"\/>/);
  assert.match(x, /<legal type="contact">https:\/\/mayobebros\.com\/contact\/<\/legal>/);
  assert.match(x, /<terms>https:\/\/mayobebros\.com\/ai-use-terms\/<\/terms>/);
  const tags = [...x.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)];
  const stack = [];
  for (const [, close, name, self] of tags) { if (self) continue; if (close) assert.equal(stack.pop(), name); else stack.push(name); }
  assert.equal(stack.length, 0, 'well formed');
  for (const f of ['index.html', 'contact/index.html']) assert.match(read(f), /<link rel="license" type="application\/rsl\+xml" href="\/license\.xml">/);
});

test('the terms page exists, is in the footer, says how to ask, and the Terms of Service points to it', { skip }, () => {
  const p = read('ai-use-terms/index.html');
  assert.match(p, /<meta name="robots" content="noindex/);
  assert.match(p, /href="\/contact\/"/);
  assert.match(p, /16 November 2026/);
  assert.match(p, /written permission|agree in writing/);
  assert.match(read('index.html'), /href="\/ai-use-terms\/"/, 'footer link');
  assert.match(read('terms-of-service/index.html'), /href="\/ai-use-terms\/"/);
});

test('the Cloudflare rules in docs/ai-bot-policy.md are the ones the code makes, and cannot match a search, ads or preview crawler', () => {
  const doc = read('docs/ai-bot-policy.md');
  const r1 = cfSourcesExpression(), r2 = cfUserAgentExpression(CF_TIER_B), r3 = cfUserAgentExpression(CF_TIER_A);
  for (const r of [r1, r2, r3]) { assert.ok(doc.includes(r), `docs/ai-bot-policy.md holds the rule: ${r.slice(0, 60)}...`); assert.ok(r.length < 4096); }
  assert.ok(!CF_SOURCE_FOLDERS.some((f) => /results-shell/.test(f)) && !r1.includes('results-shell'), 'the results Worker needs /results-shell.html');
  const allowed = [
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot-Image/1.0', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
    'Mediapartners-Google', 'Mozilla/5.0 (compatible; Mediapartners-Google/2.1; +http://www.google.com/bot.html)', 'AdsBot-Google (+http://www.google.com/adsbot.html)', 'Google-Display-Ads-Bot', 'APIs-Google (+https://developers.google.com/webmasters/APIs-Google.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'WhatsApp/2.23.20.0 A', 'Twitterbot/1.0', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'TelegramBot (like TwitterBot)', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'curl/8.5.0', '',
  ];
  const matches = (ua, list) => list.some((n) => ua.toLowerCase().includes(n));
  for (const ua of allowed) { assert.ok(!matches(ua, CF_TIER_B), `tier B rule must not match: ${ua}`); assert.ok(!matches(ua, CF_TIER_A), `tier A rule must not match: ${ua}`); }
  for (const ua of TIER_A) assert.ok(!matches(ua, CF_TIER_B), `${ua} is tier A, not tier B`);
  for (const n of [...CF_TIER_A, ...CF_TIER_B]) {
    assert.ok(n.length >= 5, `${n}: too short to be safe`);
    assert.ok(!/^(bot|crawler|spider|compatible|mozilla|google|bing|apple|meta|claude|openai|amazon|java|python)$/.test(n), n);
  }
  for (const a of ['GPTBot/1.3', 'ClaudeBot/1.0', 'CCBot/2.0', 'Bytespider', 'Amazonbot/0.1', 'meta-externalagent/1.1']) assert.ok(matches(a, CF_TIER_B), a);
  for (const a of ['ChatGPT-User/1.0', 'PerplexityBot/1.0', 'Claude-User/1.0']) assert.ok(matches(a, CF_TIER_A), a);
});

test('the feed carries a summary and a link, not the article', { skip }, () => {
  const feed = read('feed.xml');
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.ok(items.length > 5);
  for (const it of items) {
    const link = /<link>([^<]+)<\/link>/.exec(it)[1];
    const body = /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/.exec(it)[1];
    assert.ok(body.includes(`<a href="${link}">Read the full article`), `${link}: a link back`);
    assert.ok(!/<h[1-6]|<img|<ul|<table/.test(body), `${link}: no article markup`);
    assert.ok(body.length < 1000, `${link}: short`);
  }
  assert.match(read('rss/index.html'), /Does the feed have the whole article\?[\s\S]{0,40}<p>No\./);
});

/* ------------------------------------------------------------------ js/copy-note.js, run against a small fake page */
const COPY_SRC = read('js/copy-note.js');
function fakePage({ mode = 'attribute', min = '160' } = {}) {
  const matchesSel = (n, sel) => sel.split(',').map((s) => s.trim()).some((s) => (s.startsWith('.') ? n.classes?.has(s.slice(1)) : s.startsWith('[') ? Object.hasOwn(n.attrs || {}, s.slice(1, -1)) : n.tag === s));
  const node = (tag, parent, classes = [], at = {}) => ({
    nodeType: 1, tag, parentNode: parent, classes: new Set(classes), attrs: at,
    closest(sel) { for (let c = this; c; c = c.parentNode) if (matchesSel(c, sel)) return c; return null; },
    contains(o) { for (let c = o; c; c = c.parentNode) if (c === this) return true; return false; },
    classList: { add() {}, remove() {} },
  });
  const body = node('body', null);
  const article = node('div', body, ['article-content']);
  const para = node('p', article);
  const table = node('table', article);
  const cell = node('td', table);
  const field = node('textarea', body);
  const outside = node('p', body);
  const listeners = {};
  const added = [];
  const doc = {
    body: Object.assign(body, { appendChild: (n) => added.push(n) }),
    currentScript: { getAttribute: (k) => ({ 'data-copy-mode': mode, 'data-copy-min': min })[k] },
    addEventListener: (t, f) => { listeners[t] = f; },
    querySelector: () => ({ href: 'https://mayobebros.com/post/x/' }),
    createElement: () => { const n = { classList: { add() {}, remove() {} }, setAttribute() {}, set textContent(v) { this.text = v; }, get textContent() { return this.text; } }; added.push(n); return n; },
  };
  let selection = { isCollapsed: true, rangeCount: 0 };
  const win = { getSelection: () => selection, requestAnimationFrame: (f) => f() };
  vm.runInNewContext(COPY_SRC, { window: win, document: doc, location: { origin: 'https://mayobebros.com', pathname: '/post/x/' }, setTimeout, clearTimeout, parseInt, String });
  const select = (start, end, text) => { selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ startContainer: start, endContainer: end }), toString: () => text }; };
  const copy = (target, clipboard) => {
    const set = {}; let prevented = false;
    listeners.copy({ target, clipboardData: clipboard || { setData: (t, v) => { set[t] = v; } }, preventDefault: () => { prevented = true; } });
    return { set, prevented, note: added.find((n) => n.text)?.text };
  };
  return { select, copy, nodes: { article, para, cell, field, outside }, hasListener: () => typeof listeners.copy === 'function' };
}
const LONG = 'The quick brown fox jumps over the lazy dog and keeps running through the long grass until the river. '.repeat(3);

test('copy note: a long copy from the article gets a link back and a status note', () => {
  const p = fakePage();
  assert.ok(p.hasListener());
  p.select(p.nodes.para, p.nodes.para, LONG);
  const r = p.copy(p.nodes.para);
  assert.equal(r.prevented, true);
  assert.equal(r.set['text/plain'], `${LONG}\n\nRead more at https://mayobebros.com/post/x/`);
  assert.match(r.note, /^Copied with a link to this article\.$/);
});

test('copy note: short copies, other places, tables, code and form fields are never touched', () => {
  const p = fakePage();
  const untouched = (r) => assert.ok(!r.prevented && !r.set['text/plain']);
  p.select(p.nodes.para, p.nodes.para, 'a short quote'); untouched(p.copy(p.nodes.para));
  p.select(p.nodes.outside, p.nodes.outside, LONG); untouched(p.copy(p.nodes.outside));
  p.select(p.nodes.para, p.nodes.outside, LONG); untouched(p.copy(p.nodes.para)); // ends outside the article
  p.select(p.nodes.cell, p.nodes.cell, LONG); untouched(p.copy(p.nodes.cell));
  p.select(p.nodes.field, p.nodes.field, LONG); untouched(p.copy(p.nodes.field));
  p.select(p.nodes.para, p.nodes.para, LONG); untouched(p.copy(p.nodes.field)); // the event came from a field
});

test('copy note: limit mode keeps only the start and the link; a broken clipboard leaves the normal copy alone', () => {
  const p = fakePage({ mode: 'limit', min: '100' });
  p.select(p.nodes.para, p.nodes.para, LONG);
  const r = p.copy(p.nodes.para);
  assert.equal(r.prevented, true);
  assert.ok(r.set['text/plain'].length < 100 + 80, 'shortened');
  assert.ok(r.set['text/plain'].startsWith('The quick brown fox') && r.set['text/plain'].endsWith('Read the full article: https://mayobebros.com/post/x/'));
  assert.match(r.note, /^Long copies are shortened\./);
  const q = fakePage();
  q.select(q.nodes.para, q.nodes.para, LONG);
  let r2;
  assert.doesNotThrow(() => { r2 = q.copy(q.nodes.para, { setData() { throw new Error('denied'); } }); });
  assert.equal(r2.prevented, false, 'the browser copies as usual');
  assert.equal(r2.note, undefined, 'and no note is shown');
});

test('copy note: no way to select or copy text is switched off, and nothing is stored', () => {
  assert.ok(!/selectstart|contextmenu|user-select|dragstart|localStorage|sessionStorage|document\.cookie/.test(COPY_SRC.replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.ok(!/user-select\s*:\s*none/.test(read('css/style.css').split('\n').filter((l) => /article-content/.test(l)).join('\n')), 'the article text stays selectable');
  assert.match(read('css/style.css'), /\.copy-note\.is-on/);
  assert.match(read('css/style.css'), /prefers-reduced-motion: reduce\) \{ \.copy-note/);
  if (!built) return;
  const post = read('post/educational/study-tips/10-proven-techniques-to-study-effectively-for-students/index.html');
  assert.match(post, /<script src="\/js\/copy-note\.js[^"]*" defer data-copy-mode="attribute" data-copy-min="160"><\/script>/);
  assert.ok(!/copy-note\.js/.test(read('index.html')), 'only article pages load it');
});
