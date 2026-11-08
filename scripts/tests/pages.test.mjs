// Checks on the built post pages (run `node scripts/build.mjs` first).
//   node --no-warnings --test scripts/tests/pages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function postPages(dir = path.join(ROOT, 'post')) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...postPages(full));
    else if (entry.name === 'index.html') out.push(full);
  }
  return out;
}

// The "Keep reading" grid fades in when js/site.js sees 6% of it on screen. A grid that is taller than about
// 16 screens can never show 6% at once, so its cards stayed at opacity 0 (a blank section) until a reload restored
// the scroll position. It once listed every article on the site (126 cards, 22,000 to 63,000 px tall).
const MAX_KEEP_READING_CARDS = 6;

test('every "Keep reading" section is short enough to fade in', () => {
  const pages = postPages();
  assert.ok(pages.length > 0, 'no built post pages found: run node scripts/build.mjs first');
  let checked = 0;
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    const head = html.indexOf('<h2>Keep reading</h2>');
    if (head < 0) continue; // redirect stubs and one-post sites have no such section
    const end = html.indexOf('</section>', head);
    const cards = (html.slice(head, end).match(/<article class="card/g) || []).length;
    const rel = path.relative(ROOT, file);
    assert.ok(cards >= 1, `${rel}: "Keep reading" has no cards`);
    assert.ok(cards <= MAX_KEEP_READING_CARDS, `${rel}: "Keep reading" has ${cards} cards (at most ${MAX_KEEP_READING_CARDS})`);
    checked++;
  }
  assert.ok(checked > 0, 'no page had a "Keep reading" section');
});

// Search engines can only offer a "jump to" link for a heading that has an address and a plain link to it in the page.
// The contents list is written into the HTML at build time and must link every ## and ### heading of the article.
test('every ## and ### heading of a post is linked from its table of contents', () => {
  for (const file of postPages()) {
    const html = fs.readFileSync(file, 'utf8');
    const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>/);
    if (!toc) continue; // posts with fewer than 3 sections have no contents list
    const article = html.split('data-engage')[0];
    const links = new Set([...toc[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]));
    for (const [, id] of article.matchAll(/<h[23] id="([^"]+)"/g)) {
      assert.ok(links.has(id), `${path.relative(ROOT, file)}: heading #${id} is not in the table of contents`);
    }
  }
});

// The comment buttons (like, edit, delete) tell screen-reader users what happened through one polite live region,
// and move focus to the comments heading after a delete, so both must be in the page.
test('pages with comments have a live region and a focusable comments heading', () => {
  let checked = 0;
  for (const file of postPages()) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('data-comments')) continue;
    const rel = path.relative(ROOT, file);
    assert.ok(html.includes('data-comment-live'), `${rel}: no data-comment-live region`);
    assert.match(html, /<h2 id="comments-h" tabindex="-1">/, `${rel}: the comments heading must have tabindex="-1"`);
    checked++;
  }
  assert.ok(checked > 0, 'no built post page has comments: run node scripts/build.mjs');
});

// Comment emails: the "email me" checkbox on the form and the /manage/ page that turns an emailed link into the browser's edit token.
test('the comment form has the email-me checkbox, hidden until an email is typed', () => {
  let checked = 0;
  for (const file of postPages()) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('data-comments')) continue;
    const rel = path.relative(ROOT, file);
    assert.match(html, /<input[^>]*type="checkbox"[^>]*name="notify"|<input[^>]*name="notify"[^>]*type="checkbox"/, `${rel}: no notify checkbox`);
    assert.ok(html.includes('Email me a link to edit or delete this comment, and tell me when someone replies'), `${rel}: checkbox label text`);
    assert.match(html, /data-notify-row[^>]*\bhidden\b/, `${rel}: the checkbox row must start hidden`);
    assert.match(html, /only for this[^<]*never shown/i, `${rel}: hint that the address is used only for this`);
    assert.doesNotMatch(html.match(/<input[^>]*name="notify"[^>]*>/)[0], /\bchecked\b/, `${rel}: checkbox must be unchecked by default`);
    checked++;
  }
  assert.ok(checked > 0, 'no built post page has comments');
});

test('/manage/ does not load the analytics beacon, other pages do', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'manage', 'index.html'), 'utf8'), /cloudflareinsights/, 'manage page must not load the beacon');
  assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /cloudflareinsights/, 'home page still loads it');
});

test('/manage/ is noindex, no-referrer, has one button, and calls the API only from a click', () => {
  const file = path.join(ROOT, 'manage', 'index.html');
  assert.ok(fs.existsSync(file), 'manage/index.html missing: run node scripts/build.mjs');
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<button[^>]*data-manage-go/);
  assert.match(html, /js\/manage\.js/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[^<]*fetch\(/, 'no inline fetch on the page');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8') + [...fs.readdirSync(ROOT)].filter((f) => /sitemap\d*\.xml$/.test(f)).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join(''), /\/manage\//, 'manage must not be in the sitemaps');
  const js = fs.readFileSync(path.join(ROOT, 'js', 'manage.js'), 'utf8');
  // every network call must sit inside a function that only a click handler reaches: the one call site is "go()", wired to the button
  const calls = [...js.matchAll(/\bfetch\(/g)].length;
  assert.equal(calls, 1, 'exactly one fetch call in manage.js');
  assert.match(js, /addEventListener\('click',\s*go\)|addEventListener\("click",\s*go\)/, 'the button click must run go()');
  // The one exception is the team's Ignore link (#r=...i...): it changes nothing, so it answers at once. Approve, like every other link
  // on this page, waits for a press (a mail scanner that runs JavaScript must never publish a held comment).
  const direct = [...js.matchAll(/^.*(?<!function )\bgo\(\).*$/gm)].map((m) => m[0]);
  assert.equal(direct.length, 2, 'go() is called directly only for the Ignore link');
  assert.ok(direct.every((l) => /visibilityState/.test(l)), 'only behind the visibility check');
  assert.match(js, /if \(kind === 'r' && secret\.charAt\(secret\.indexOf\('\.'\) \+ 1\) === 'i'\) \{\n\s*var runReview/, 'and only for the Ignore action');
  assert.match(js, /history\.replaceState/);
  const footer = html.split('<footer')[1] || '';
  assert.doesNotMatch(footer, /href="[^"]*\/manage\/"/, 'not linked from the footer');
});

// The newsletter: the footer form, the /newsletter/ page and every newsletter sentence exist only when it is switched on
// ("newsletterAction": "api" with a comments API, or the --newsletter build flag). These checks render pages directly, so they do
// not depend on how the tree was last built.
import { createRenderer, newsletterOn, newsletterSetting } from '../lib/render.mjs';
import { parseFrontMatter } from '../lib/frontmatter.mjs';

function renderWith(over = {}) {
  // The "off" state is tested whatever site.config.json says (it is "api" once the newsletter is live): a test turns it on by passing newsletterAction.
  const config = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8')), newsletterAction: '', ...over };
  const on = newsletterOn(config);
  const dir = path.join(ROOT, 'content', 'pages');
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => {
    const { data, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { slug: f.replace(/\.html$/, ''), title: String(data.title), heading: data.heading || '', subtitle: data.subtitle || '', description: String(data.description || ''), kind: data.kind || 'legal', menu: false, order: Number(data.order ?? 50), hero: data.hero || '', updated: null, html: body };
  }).filter((p) => p.slug !== 'newsletter' || on);
  const R = createRenderer({ config, categories: [], posts: [], pages, authors: [], versions: {} });
  return { R, pages, on, page: (slug) => { const pg = pages.find((p) => p.slug === slug); return pg ? R.staticPage(pg) : null; } };
}
const footerOf = (html) => html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));

test('newsletterAction must be "" or "api"; the --newsletter flag turns it on', () => {
  assert.deepEqual(newsletterSetting('', false), { action: '' });
  assert.deepEqual(newsletterSetting(undefined, false), { action: '' });
  assert.deepEqual(newsletterSetting('api', false), { action: 'api' });
  assert.deepEqual(newsletterSetting('', true), { action: 'api' });
  for (const bad of ['https://example.com/subscribe', 'API', true, 'on']) assert.match(newsletterSetting(bad, false).error, /newsletterAction/);
  assert.equal(newsletterOn({ commentsApi: 'https://api.test', newsletterAction: 'api' }), true);
  assert.equal(newsletterOn({ commentsApi: '', newsletterAction: 'api' }), false, 'no API, no newsletter');
  assert.equal(newsletterOn({ commentsApi: 'https://api.test', newsletterAction: '' }), false);
});

test('with the newsletter off: no newsletter page, no subscribe script and no newsletter wording in the footer or privacy policy', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  assert.ok(['', 'api'].includes(committed.newsletterAction), 'newsletterAction is "" (off) or "api" (live since 2026-11-08)');
  const { page, on, pages } = renderWith();
  assert.equal(on, false);
  assert.equal(pages.some((p) => p.slug === 'newsletter'), false, 'the page is not built');
  const privacy = page('privacy-policy');
  const footer = footerOf(privacy);
  assert.doesNotMatch(privacy, /subscribe\.js|newsletter\.js/);
  assert.doesNotMatch(footer, /newsletter|data-endpoint|foot-form/i);
  assert.match(footer, /Follow with RSS/);
  assert.match(footer, /<h2>Learn something useful every week<\/h2>/, 'the RSS-only footer keeps its heading');
  assert.doesNotMatch(privacy.slice(privacy.indexOf('<main'), privacy.indexOf('</main>')), /newsletter/i);
});

test('with the newsletter on: footer form, honeypot, privacy link, and a noindex, no-referrer, beacon-free /newsletter/ page', () => {
  const { page, on } = renderWith({ newsletterAction: 'api', commentsApi: 'https://api.test/', analytics: { cloudflareToken: 'a'.repeat(32) } });
  assert.equal(on, true);
  const about = page('about');
  const footer = footerOf(about);
  const form = footer.match(/<form[^>]*>/)[0];
  assert.match(form, /class="foot-form nl-form"/);
  assert.match(form, /data-state="idle"/);
  assert.match(form, /action="\/newsletter\/"/);
  assert.match(form, /method="get"/);
  assert.match(form, /data-newsletter/);
  assert.match(form, /data-endpoint="https:\/\/api\.test\/v1\/newsletter\/subscribe"/);
  assert.match(footer, /<input[^>]*type="email"[^>]*name="email"[^>]*required/);
  assert.match(footer, /<div[^>]*aria-hidden="true"[^>]*>[\s\S]*?<input[^>]*name="website"[^>]*tabindex="-1"[^>]*autocomplete="off"/);
  assert.match(footer, /<p class="foot-status nl-status" id="foot-status" role="status"/);
  assert.match(footer, /<div class="nl-panel nl-panel-done" data-nl-done inert aria-hidden="true">/, 'the confirmation card starts out of reach');
  assert.match(footer, /<input[^>]*type="email"[^>]*inputmode="email"[^>]*autocapitalize="none"[^>]*spellcheck="false"/);
  assert.match(footer, /One email when we publish a new article\. Stop any time\. See our <a href="\/privacy-policy\/[^"]*">Privacy Policy<\/a>\./);
  assert.doesNotMatch(footer, /Follow with RSS<\/a>\s*<\/div>/, 'the RSS button is replaced by the form');
  // no promise of how often: the heading over the form names no frequency
  assert.match(footer, /<h2>Get new articles by email<\/h2>/);
  assert.doesNotMatch(footer, /every week|weekly|daily/i);
  // without JavaScript nothing is sent: the form starts hidden (js/subscribe.js shows it) and a <noscript> line outside it offers RSS
  assert.match(form, /\shidden[\s>]/, 'the form starts hidden');
  assert.match(footer, /<input[^>]*name="email"[^>]*\brequired\b/);
  const ns = footer.match(/<noscript>[\s\S]*?<\/noscript>/);
  assert.ok(ns, 'a noscript fallback');
  assert.match(ns[0], /href="\/rss\/"/);
  assert.ok(footer.indexOf('</form>') < footer.indexOf('<noscript>'), 'the noscript line is outside the hidden form');
  const privacy = page('privacy-policy');
  assert.match(privacy, /If JavaScript is switched off, the form is not shown and nothing is sent/, 'the privacy policy describes the no-JavaScript case as built');
  assert.doesNotMatch(privacy, /puts the address you typed in the page address/);
  const nlSrc = fs.readFileSync(path.join(ROOT, 'content', 'pages', 'newsletter.html'), 'utf8');
  assert.doesNotMatch(nlSrc, /\{\{\^newsletter\}\}/, 'the page is built only when the newsletter is on, so no off branch');
  assert.doesNotMatch(nlSrc, /Gmail|how often/);
  assert.match(about, /js\/subscribe\.js/, 'subscribe.js on every page');
  assert.doesNotMatch(about, /js\/newsletter\.js/);
  assert.match(about, /cloudflareinsights/, 'other pages keep the beacon');

  const nl = page('newsletter');
  assert.ok(nl, 'the newsletter page is built');
  assert.match(nl, /<meta name="robots" content="noindex/);
  assert.match(nl, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(nl, /cloudflareinsights/, 'no analytics beacon');
  assert.match(nl, /js\/newsletter\.js/);
  assert.match(nl, /data-newsletter-page/);
  assert.match(nl, /<button[^>]*data-nl-go[^>]*hidden/);
  assert.doesNotMatch(nl, /<script(?![^>]*\bsrc=)[^>]*>[^<]*fetch\(/, 'no inline fetch');
  assert.doesNotMatch(nl, /\{\{[#^/]?newsletter\}\}/, 'no template tags left');
});

test('privacy policy and terms describe the newsletter only when it is on', () => {
  const body = (h) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
  const on = renderWith({ newsletterAction: 'api', commentsApi: 'https://api.test/' });
  const privacy = body(on.page('privacy-policy'));
  assert.match(privacy, /<h3 id="newsletter">Newsletter<\/h3>/);
  for (const w of ['7 days', '30 days', 'Resend', 'JavaScript']) assert.ok(privacy.includes(w), w);
  assert.match(body(on.page('terms-of-service')), /The newsletter is free/);
  assert.match(footerOf(on.page('about')), /href="\/privacy-policy\/#newsletter"/);
  const off = renderWith();
  for (const slug of ['privacy-policy', 'terms-of-service', 'cookie-policy']) assert.doesNotMatch(body(off.page(slug)), /newsletter/i, slug);
});

test('{{#newsletter}} and {{^newsletter}} work in content pages', () => {
  const pg = { slug: 'x-test', title: 'X', heading: '', subtitle: '', description: 'x', kind: 'wide', menu: false, order: 1, hero: '', updated: null, html: '<p>{{#newsletter}}NL-ON{{/newsletter}}{{^newsletter}}NL-OFF{{/newsletter}}</p>' };
  const on = renderWith({ newsletterAction: 'api' }).R.staticPage(pg);
  const off = renderWith().R.staticPage(pg);
  assert.ok(on.includes('NL-ON') && !on.includes('NL-OFF'));
  assert.ok(off.includes('NL-OFF') && !off.includes('NL-ON'));
});

test('the newsletter page and both scripts are never in a sitemap', () => {
  const { R } = renderWith({ newsletterAction: 'api' });
  for (const [, xml] of R.sitemaps()) assert.doesNotMatch(xml, /\/newsletter\//);
});

// {{latest-posts:N}} is still a building block (the newest articles as horizontal cards, hidden until a page script shows them), but the
// pages that confirm something from an email (/manage/, /newsletter/) no longer use it: they are bare status pages.
const newest = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'search.json'), 'utf8'));
const nextReads = (html) => { const m = html.match(/<section class="next-reads"[^>]*>[\s\S]*?<\/section>/); return m ? m[0] : ''; };
const fakePosts = (list) => list.map((x) => ({ slug: x.s, path: x.u, title: x.t, category: { name: x.c, slug: 'c' }, label: null, date: new Date(x.d), image: x.i, excerpt: x.e, readingMinutes: 3, tags: x.g, featured: false, text: '' }));

test('{{latest-posts:3}} renders the 3 newest posts as horizontal cards with real links', () => {
  const want = newest().slice(0, 3).map((x) => x.u);
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const R = createRenderer({ config, categories: [], posts: fakePosts(newest()), pages: [], authors: [], versions: {} });
  const sec = nextReads(R.staticPage({ slug: 'x-test', title: 'X', heading: '', subtitle: '', description: 'x', kind: 'wide', menu: false, order: 1, hero: '', updated: null, html: '<p>a</p>{{latest-posts:3}}' }));
  assert.match(sec, /^<section class="next-reads" data-next hidden aria-labelledby="next-reads-h"><h2 id="next-reads-h">Read our latest articles<\/h2>/);
  assert.equal((sec.match(/<article class="card card-h">/g) || []).length, 3);
  assert.deepEqual([...sec.matchAll(/class="card-link" href="([^"]+)"/g)].map((m) => m[1]), want);
  assert.match(sec, /href="\/post\/"[^>]*>See all articles</);
  for (const u of want) assert.ok(fs.existsSync(path.join(ROOT, u, 'index.html')), `${u} is a real page`);
});

// What an email link opens: only the purpose. No navigation, no hero, no article list, no footer, no cookie notice, no search, always light.
function statusHtml(slug) {
  const config = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8')), newsletterAction: 'api', commentsApi: 'https://api.test/' };
  const dir = path.join(ROOT, 'content', 'pages');
  const { data, body } = parseFrontMatter(fs.readFileSync(path.join(dir, `${slug}.html`), 'utf8'));
  const pg = { slug, title: String(data.title), heading: data.heading || '', subtitle: data.subtitle || '', description: String(data.description || ''), kind: data.kind, menu: false, order: Number(data.order ?? 90), hero: data.hero || '', updated: null, html: body };
  const R = createRenderer({ config, categories: [], posts: fakePosts(newest()), pages: [pg], authors: [], versions: {} });
  return { pg, html: R.staticPage(pg) };
}
test('/manage/ and /newsletter/ are bare status pages: logo, one card, a quiet line of links, nothing else', () => {
  for (const slug of ['manage', 'newsletter']) {
    const { pg, html } = statusHtml(slug);
    assert.equal(pg.kind, 'status', slug);
    assert.match(html, /<body class="page-status">/, slug);
    assert.match(html, /<meta name="robots" content="noindex/, slug);
    assert.match(html, /<meta name="referrer" content="no-referrer">/, slug);
    assert.match(html, /<meta name="color-scheme" content="light">/, `${slug}: always light`);
    assert.doesNotMatch(html, /prefers-color-scheme: dark|localStorage\.getItem\('theme'\)/, `${slug}: no theme switching`);
    assert.match(html, /<a class="st-logo"[^>]*><img src="[^"]*logo[^"]*" alt="Mayobe Bros"/, slug);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${slug}: one h1`);
    assert.match(html, /<section class="st-card"/, slug);
    for (const bad of ['<header', 'site-header', 'class="hero', 'hero-img', '<footer', 'foot-cta', 'next-reads', 'data-next', 'search-modal', 'class="cookie', 'js/site.js', 'js/motion.js', 'data-cookie-settings', 'cloudflareinsights']) {
      assert.ok(!html.includes(bad), `${slug}: must not contain ${bad}`);
    }
    assert.match(html, /<p class="st-links">/, slug);
    assert.match(html, new RegExp(`js/${slug === 'manage' ? 'manage' : 'newsletter'}\\.js`), `${slug}: its own script`);
    assert.equal((html.match(/<script src=/g) || []).length, 1, `${slug}: that is the only script`);
  }
  // every state the script can show has its picture
  const { html } = statusHtml('manage');
  for (const i of ['st-i-mail', 'st-i-ok', 'st-i-info', 'st-i-err', 'st-spin']) assert.ok(html.includes(i), i);
  assert.match(html, /data-state="mail"/);
  assert.match(html, /role="status" aria-live="polite" data-manage-status/);
});

test('{{latest-posts:9}} is a build error', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const R = createRenderer({ config, categories: [], posts: fakePosts(newest()), pages: [], authors: [], versions: {} });
  const pg = (n) => ({ slug: 'x-test', title: 'X', heading: '', subtitle: '', description: 'x', kind: 'wide', menu: false, order: 1, hero: '', updated: null, html: `<p>a</p>{{latest-posts:${n}}}` });
  for (const n of [0, 7, 9, 'x', '']) assert.throws(() => R.staticPage(pg(n)), /latest-posts/, String(n));
  assert.equal((R.staticPage(pg(6)).match(/<article class="card card-h">/g) || []).length, 6);
});

test('the privacy and newsletter pages say how email pictures load and that opens and clicks are not counted', () => {
  const body = (h) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
  const on = renderWith({ newsletterAction: 'api', commentsApi: 'https://api.test/' });
  const privacy = body(on.page('privacy-policy'));
  const news = privacy.slice(privacy.indexOf('<h3 id="newsletter">'));
  assert.match(news, /pictures/);
  assert.match(news, /GitHub Pages/);
  assert.match(news, /We do not count who opens our emails or clicks their links\./);
  const off = renderWith({ commentsApi: 'https://api.test/' });
  const offPrivacy = body(off.page('privacy-policy'));
  assert.doesNotMatch(offPrivacy, /Our emails show pictures/);
  assert.match(offPrivacy, /We do not count who opens our emails/, 'the logo sentence stays with the comment emails');
});

// The mini sign-up in the article sidebar: same script and states as the footer form, ids that never repeat on the page.
test('every article has a mini sign-up in its sidebar next to the footer form, with unique ids, after Read next and before More like this', () => {
  const newestPost = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'search.json'), 'utf8'))[0].u;
  const html = fs.readFileSync(path.join(ROOT, newestPost, 'index.html'), 'utf8');
  const rail = html.slice(html.indexOf('<aside class="post-rail"'), html.indexOf('</aside>', html.indexOf('<aside class="post-rail"')));
  assert.match(rail, /<section class="rail-mod rail-news" aria-labelledby="rnw-h">/);
  assert.match(rail, /<form class="foot-form nl-form nl-mini"[^>]*data-newsletter[^>]*data-state="idle"[^>]*novalidate hidden>/);
  assert.match(rail, /<input id="rail-email" type="email"[^>]*aria-describedby="rail-status rail-note"/);
  assert.match(rail, /<p class="foot-status nl-status" id="rail-status" role="status">/);
  assert.match(rail, /<div class="nl-panel nl-panel-done" data-nl-done inert aria-hidden="true">/);
  assert.equal((html.match(/<form[^>]*data-newsletter/g) || []).length, 2, 'the footer form and the sidebar form');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'no id twice on the page');
  const at = (s) => rail.indexOf(s);
  assert.ok(at('rail-news') > at('rail-next') && at('rail-news') < at('rail-latest'), 'after Read next, before More like this');
  assert.ok(!/<noscript>/.test(rail), 'no second noscript line: the Follow module already offers RSS');
});

// Content-Security-Policy (a <meta> tag: GitHub Pages cannot send headers) and the referrer policy.
import { createHash } from 'node:crypto';
const cspOf = (html) => { const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/); return m ? m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&') : ''; };
const directive = (csp, name) => (csp.split('; ').find((d) => d.startsWith(`${name} `)) || '').split(' ').slice(1);
const inlineHashes = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);

test('every page ships a policy that allows its one inline script by hash and never allows inline or eval script', () => {
  const newestPost = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'search.json'), 'utf8'))[0].u;
  for (const file of ['index.html', `${newestPost.slice(1)}index.html`, 'post/index.html', 'search/index.html', 'contact/index.html', 'manage/index.html', 'newsletter/index.html', '404.html']) {
    const f = path.join(ROOT, file);
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    const csp = cspOf(html);
    assert.ok(csp, `${file}: has a policy`);
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<script'), `${file}: the policy comes before every script`);
    const script = directive(csp, 'script-src');
    for (const h of inlineHashes(html)) assert.ok(script.includes(h), `${file}: the inline script's hash is in script-src`);
    assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"), `${file}: no unsafe-inline or unsafe-eval for scripts`);
    assert.deepEqual(directive(csp, 'object-src'), ["'none'"]);
    assert.deepEqual(directive(csp, 'base-uri'), ["'self'"]);
    assert.deepEqual(directive(csp, 'form-action'), ["'self'"]);
    assert.ok(directive(csp, 'default-src').join() === "'self'", `${file}: default-src is self`);
    assert.ok(!/\*\s|\s\*(;|$)/.test(csp.replace(/https:\/\/\*\./g, '')), `${file}: no bare wildcard source`);
  }
});

test('the bare email-link pages get the tightest policy: no third parties at all, no frames', () => {
  for (const file of ['manage/index.html', 'newsletter/index.html']) {
    const f = path.join(ROOT, file);
    if (!fs.existsSync(f)) continue;
    const csp = cspOf(fs.readFileSync(f, 'utf8'));
    assert.deepEqual(directive(csp, 'frame-src'), ["'none'"], file);
    for (const d of ['script-src', 'connect-src', 'img-src']) assert.ok(directive(csp, d).every((x) => !/youtube|google|cloudflareinsights|doubleclick/.test(x)), `${file} ${d}`);
  }
});

test('the policy follows site.config.json: AdSense hosts only when ads are on, Turnstile only with a key', () => {
  const policy = (over) => cspOf(renderWith(over).page('about'));
  const off = policy({ adsense: { client: 'ca-pub-1', autoAds: false, sidebarSlot: '' } });
  assert.ok(!/googlesyndication|adtrafficquality/.test(off), 'ads off: no ad hosts');
  const on = policy({ adsense: { client: 'ca-pub-1', autoAds: true, sidebarSlot: '' } });
  assert.match(on, /script-src[^;]*pagead2\.googlesyndication\.com/);
  assert.match(on, /frame-src[^;]*googleads\.g\.doubleclick\.net/);
  assert.ok(!/challenges\.cloudflare\.com/.test(off));
  assert.match(policy({ turnstileSiteKey: '0x4AAAAAAAAAAAAAAAAAAAAA' }), /script-src[^;]*challenges\.cloudflare\.com/);
  assert.match(policy({ commentsApi: 'https://api.test/' }), /connect-src[^;]*https:\/\/api\.test/);
  assert.ok(!/googletagmanager/.test(policy({ analytics: { gtmId: '', cloudflareToken: '' } })), 'no Tag Manager host without a container id');
});

test('pages set a referrer policy unless they set their own (no-referrer on the email-link pages)', () => {
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(home, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  const manage = fs.readFileSync(path.join(ROOT, 'manage', 'index.html'), 'utf8');
  assert.match(manage, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(manage, /strict-origin-when-cross-origin/);
});
