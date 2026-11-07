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
