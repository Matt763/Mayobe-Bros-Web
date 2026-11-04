// Checks on the link-preview ("share") pictures and the Open Graph / X card tags (run `node scripts/build.mjs` first).
//   node --no-warnings --test scripts/tests/share.test.mjs
// What WhatsApp, Facebook, X and LinkedIn show when a link is shared comes only from these tags and the picture they point at.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARE_BUDGET, SHARE_DIR, SHARE_W, SHARE_H } from '../lib/share.mjs';
import { parseFrontMatter } from '../lib/frontmatter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE = config.siteUrl.replace(/\/$/, '');

function htmlPages(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlPages(full, out);
    else if (entry.name === 'index.html') out.push(full);
  }
  return out;
}
const meta = (html, attr, name) => {
  const m = new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
};
// JPEG size and kind from the file itself: do not trust the tags
function jpegInfo(file) {
  const b = fs.readFileSync(file);
  assert.ok(b[0] === 0xff && b[1] === 0xd8, `${file} is not a JPEG`);
  for (let i = 2; i < b.length; ) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { progressive: m === 0xc2, h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), bytes: b.length };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`no frame header in ${file}`);
}

const pages = htmlPages(ROOT).filter((f) => !f.includes(`${path.sep}content${path.sep}`) && !f.includes(`${path.sep}vendor${path.sep}`) && !f.includes(`${path.sep}scripts${path.sep}`) && !f.includes(`${path.sep}worker${path.sep}`) && !f.includes(`${path.sep}docs${path.sep}`));

test('built pages exist', () => {
  assert.ok(pages.length > 10, 'no built pages found: run node scripts/build.mjs first');
});

test('every page points og:image and twitter:image at a real, small, baseline 1200x630 JPEG', () => {
  const seen = new Set();
  let checked = 0;
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    if (!/<meta property="og:title"/.test(html)) continue; // redirect stubs have no preview tags
    const rel = path.relative(ROOT, file);
    const og = meta(html, 'property', 'og:image');
    assert.ok(og, `${rel}: no og:image`);
    assert.ok(og.startsWith(`${SITE}/`), `${rel}: og:image must be an absolute address on ${SITE} (got ${og})`);
    assert.equal(meta(html, 'name', 'twitter:image'), og, `${rel}: twitter:image differs from og:image`);
    assert.equal(meta(html, 'property', 'og:image:secure_url'), og, `${rel}: og:image:secure_url differs`);
    assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image', `${rel}: twitter:card`);
    const pathname = new URL(og).pathname;
    assert.match(pathname, /\.jpe?g$/i, `${rel}: og:image is not a JPEG (${pathname}); WhatsApp and Facebook may not show WebP`);
    assert.equal(meta(html, 'property', 'og:image:type'), 'image/jpeg', `${rel}: og:image:type`);
    const file2 = path.join(ROOT, decodeURIComponent(pathname));
    assert.ok(fs.existsSync(file2), `${rel}: ${pathname} does not exist`);
    if (seen.has(file2)) { checked++; continue; }
    seen.add(file2);
    const info = jpegInfo(file2);
    assert.equal(info.w, Number(meta(html, 'property', 'og:image:width')), `${rel}: og:image:width does not match the file`);
    assert.equal(info.h, Number(meta(html, 'property', 'og:image:height')), `${rel}: og:image:height does not match the file`);
    assert.ok(info.w >= 600 && info.h >= 315, `${rel}: share picture ${info.w}x${info.h} is below the 600x315 minimum`);
    assert.ok(!info.progressive, `${rel}: ${pathname} is a progressive JPEG; some apps show nothing for those`);
    assert.ok(info.bytes <= 300 * 1024, `${rel}: ${pathname} is ${Math.round(info.bytes / 1024)} KB; WhatsApp drops pictures above about 300 KB`);
    checked++;
  }
  assert.ok(checked > 10, 'checked too few pages');
});

test('every post has a card of its own, at the exact size, within the byte budget', () => {
  const posts = pages.filter((f) => f.includes(`${path.sep}post${path.sep}`));
  let cards = 0;
  for (const file of posts) {
    const html = fs.readFileSync(file, 'utf8');
    if (meta(html, 'property', 'og:type') !== 'article') continue; // not a post (listing pages, redirect stubs)
    const rel = path.relative(ROOT, file);
    const og = new URL(meta(html, 'property', 'og:image')).pathname;
    assert.match(og, new RegExp(`^/${SHARE_DIR}/post-[a-z0-9-]+\\.jpg$`), `${rel}: falls back to a shared picture instead of its own card (${og}); run node scripts/build.mjs on a machine with Chromium and ffmpeg`);
    const info = jpegInfo(path.join(ROOT, og));
    assert.equal(`${info.w}x${info.h}`, `${SHARE_W}x${SHARE_H}`, `${rel}: card size`);
    assert.ok(info.bytes <= SHARE_BUDGET + 4096, `${rel}: card is ${Math.round(info.bytes / 1024)} KB (budget ${Math.round(SHARE_BUDGET / 1024)} KB)`);
    cards++;
  }
  assert.ok(cards > 0, 'no article pages found');
});

test('article pages carry the full set of preview tags', () => {
  // og:image:alt describes the cover, so it is only there when the post has an imageAlt (a post without a cover must not invent one)
  const dir = path.join(ROOT, 'content', 'posts');
  const noAlt = fs.readdirSync(dir).filter((f) => /\.(md|markdown|html)$/i.test(f)).map((f) => parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8')).data).filter((d) => d.draft !== true && !d.imageAlt).length;
  let missingAlt = 0;
  let n = 0;
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    if (meta(html, 'property', 'og:type') !== 'article' || /http-equiv="refresh"/.test(html)) continue; // redirect stubs only carry the short set
    const rel = path.relative(ROOT, file);
    const title = meta(html, 'property', 'og:title');
    const desc = meta(html, 'property', 'og:description');
    assert.ok(title && title.length <= 100, `${rel}: og:title missing or very long`);
    assert.ok(desc && desc.length >= 50 && desc.length <= 200, `${rel}: og:description should be 50 to 200 characters (is ${desc ? desc.length : 0})`);
    assert.equal(meta(html, 'property', 'og:url'), html.match(/<link rel="canonical" href="([^"]+)"/)[1], `${rel}: og:url must equal the canonical address`);
    assert.ok(meta(html, 'property', 'og:site_name'), `${rel}: og:site_name`);
    assert.ok(meta(html, 'property', 'article:published_time'), `${rel}: article:published_time`);
    assert.ok(meta(html, 'property', 'article:modified_time'), `${rel}: article:modified_time`);
    const alt = meta(html, 'property', 'og:image:alt');
    if (alt === null) missingAlt++;
    else assert.ok(alt.length >= 10, `${rel}: og:image:alt is too short to describe a picture`);
    assert.equal(meta(html, 'name', 'twitter:image:alt'), alt, `${rel}: twitter:image:alt differs from og:image:alt`);
    n++;
  }
  assert.ok(n > 0, 'no article pages found');
  assert.equal(missingAlt, noAlt, 'a post that has an imageAlt lost its og:image:alt (or one without it got an invented one)');
});

test('the preview tags come early in <head>, before the icons and long scripts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ogAt = html.indexOf('<meta property="og:image"');
  assert.ok(ogAt > 0, 'home page has no og:image');
  // apps that read only the first part of a page must still reach the picture; 4 KB is far inside any limit
  assert.ok(ogAt < 4096, `og:image starts ${ogAt} bytes into the page (keep it under 4096)`);
});
