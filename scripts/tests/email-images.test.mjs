// Checks on the email pictures (assets/email/*, drawn by scripts/lib/email-images.mjs). Run `node scripts/build.mjs` first.
//   node --no-warnings --test scripts/tests/email-images.test.mjs
// The Worker reads `m`, `w` and `a` from data/search.json and builds the picture addresses from them, so every `m` and `w`
// must point at a real file of the exact size, and the files must stay small (email is often read on mobile data).
// Nothing here rebuilds the site: "up to date" is proved with makeEmailImages(..., { dryRun: true }), which writes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EMAIL_DIR, EMAIL_SIZES, EMAIL_BUDGETS, emailRel, emailAlt, emailSpec, makeEmailImages } from '../lib/email-images.mjs';
import { findChrome } from '../lib/share.mjs';
import { parseFrontMatter } from '../lib/frontmatter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, EMAIL_DIR);
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR) : [];
const SKIP = !files.length && !findChrome() ? 'assets/email is empty and no Chromium was found: email pictures cannot be drawn on this machine' : false;
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/search.json'), 'utf8'));
const VIDEO_POST = 'how-to-find-an-internship-in-tanzania-real-or-fake';
// Covers that must never reach an email (they show real company logos; see CLAUDE.md "Pictures"). slug -> blocked cover
const BLOCKED_COVERS = { 'freelancing-online-from-tanzania-platforms-fees-scams': 'assets/posts/e1503bfa79d9.webp' };
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const catsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/categories.json'), 'utf8'));
const categoryImage = new Map((Array.isArray(catsRaw) ? catsRaw : catsRaw.categories).map((c) => [c.slug, c.image]));
const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.email-images.json'), 'utf8')).images;

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
function checkJpeg(rel, kind) {
  const abs = path.join(ROOT, rel);
  assert.ok(fs.existsSync(abs), `${rel} is missing`);
  const info = jpegInfo(abs);
  assert.equal(`${info.w}x${info.h}`, EMAIL_SIZES[kind].join('x'), `${rel}: size`);
  assert.ok(!info.progressive, `${rel} is progressive; some mail apps show nothing for those`);
  assert.ok(info.bytes <= EMAIL_BUDGETS[kind], `${rel} is ${info.bytes} bytes (budget ${EMAIL_BUDGETS[kind]})`);
  return info.bytes;
}
function postsFromSource() {
  const dir = path.join(ROOT, 'content/posts');
  return fs.readdirSync(dir).filter((f) => /\.(md|markdown|html)$/i.test(f)).map((f) => {
    const { data, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { slug: String(data.slug || f.replace(/\.[^.]+$/, '')), data, body };
  }).filter((p) => p.data.draft !== true);
}
const size = (rel) => fs.statSync(path.join(ROOT, rel)).size;

test('every post in search.json with m has post- and thumb- files of the exact size, baseline, within budget', { skip: SKIP }, () => {
  let n = 0;
  for (const e of index) {
    if (e.m === undefined) continue;
    assert.match(e.m, /^[0-9a-f]{8}$/, `${e.s}: m must be 8 lowercase hex`);
    checkJpeg(emailRel('post', e.s), 'post');
    checkJpeg(emailRel('thumb', e.s), 'thumb');
    n++;
  }
  assert.equal(n, index.length, 'every published post should have email pictures after a build with Chromium and ffmpeg');
});

test('the video post has w and a 1200x675 video- file within budget; posts without a video have no w', { skip: SKIP }, () => {
  const withVideo = new Set(postsFromSource().filter((p) => /^\s{0,3}::(video|youtube)\[/m.test(p.body)).map((p) => p.slug));
  assert.ok(withVideo.has(VIDEO_POST), 'the internship post should still have its video');
  for (const e of index) {
    if (withVideo.has(e.s)) {
      assert.match(e.w || '', /^[0-9a-f]{8}$/, `${e.s}: has a video, so it needs w`);
      checkJpeg(emailRel('video', e.s), 'video');
    } else {
      assert.equal(e.w, undefined, `${e.s}: has no video, so no w`);
      assert.ok(!fs.existsSync(path.join(ROOT, emailRel('video', e.s))), `${e.s}: a video- picture without a video`);
    }
  }
});

test('logo.png is 424x96 and at most 24 KB, with an opaque white plate', { skip: SKIP }, () => {
  const abs = path.join(ROOT, emailRel('logo'));
  const b = fs.readFileSync(abs);
  assert.equal(b.toString('ascii', 1, 4), 'PNG');
  assert.equal(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, EMAIL_SIZES.logo.join('x'));
  assert.ok(b.length <= EMAIL_BUDGETS.logo, `logo.png is ${b.length} bytes`);
  const px = (x, y) => execFileSync('ffmpeg', ['-v', 'error', '-i', abs, '-vf', `crop=1:1:${x}:${y},format=rgba`, '-f', 'rawvideo', '-'], { timeout: 15000 }).toString('hex');
  // (212,48) is inside the 72 px wordmark (the round mark), so the plate is read in the 12 px margin above it
  assert.equal(px(212, 5), 'ffffffff', 'the plate around the wordmark must be opaque white (dark-mode inversion keeps it readable)');
  assert.equal(px(212, 48).slice(6), 'ff', 'the middle of the logo is opaque');
  assert.equal(px(8, 48), 'ffffffff', 'the plate reaches the left edge');
  assert.equal(px(0, 0).slice(6), '00', 'the rounded corner is transparent');
});

test('a = imageAlt (emailImageAlt when emailImage is set) from the front matter, one line, at most 150 characters', () => {
  const bySlug = new Map(index.map((e) => [e.s, e]));
  let n = 0;
  for (const p of postsFromSource()) {
    const e = bySlug.get(p.slug);
    if (!e) continue; // samples left out by --no-samples
    // a post with emailImage describes that picture (emailImageAlt), never its own cover
    const alt = String((p.data.emailImage ? p.data.emailImageAlt : p.data.imageAlt) || '');
    if (!alt) { assert.equal(e.a, undefined, `${p.slug}: no alt for the email picture, so no a`); continue; }
    assert.equal(e.a, emailAlt(alt), `${p.slug}: a`);
    assert.ok(e.a.length <= 150 && !/[\r\n\t]/.test(e.a), `${p.slug}: a must be one line, at most 150 characters`);
    n++;
  }
  assert.ok(n > 10, 'too few posts with imageAlt');
  assert.equal(emailAlt('  two\n lines  '), 'two lines');
  const long = emailAlt('word '.repeat(60));
  assert.ok(long.length <= 150 && long.endsWith('…'), 'a long alt is cut at a word and marked');
});

test('no file in assets/email belongs to a post that does not exist', { skip: SKIP }, () => {
  const slugs = new Set(postsFromSource().map((p) => p.slug));
  for (const f of files) {
    if (f === 'logo.png') continue;
    const m = /^(post|thumb|video)-([a-z0-9-]+)\.jpg$/.exec(f);
    assert.ok(m, `unexpected file assets/email/${f}`);
    assert.ok(slugs.has(m[2]), `assets/email/${f} belongs to no post`);
  }
});

test('worst-case picture weight: logo + largest post + two largest thumbs <= 170 KB; logo + largest post or video <= 130 KB', { skip: SKIP }, () => {
  const logo = size(emailRel('logo'));
  const kind = (k) => files.filter((f) => f.startsWith(`${k}-`)).map((f) => fs.statSync(path.join(DIR, f)).size).sort((a, b) => b - a);
  const posts = kind('post');
  const thumbs = kind('thumb');
  const videos = kind('video');
  assert.ok(posts.length && thumbs.length >= 2, 'no email pictures found');
  const welcome = logo + posts[0] + thumbs[0] + thumbs[1];
  assert.ok(welcome <= 170 * 1024, `welcome email worst case is ${Math.round(welcome / 1024)} KB`);
  const article = logo + Math.max(posts[0], videos[0] || 0);
  assert.ok(article <= 130 * 1024, `new-article email worst case is ${Math.round(article / 1024)} KB`);
});

// The specs the build makes, rebuilt from the sources (same helper as scripts/build.mjs)
function specsFromSource() {
  return postsFromSource().map((p) => {
    const f = Number(p.data.imageFocus);
    const focus = p.data.imageFocus !== undefined && p.data.imageFocus !== '' && Number.isFinite(f) && f >= 0 && f <= 100 ? f : undefined;
    const videos = [...p.body.matchAll(/^\s{0,3}::(video|youtube)\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/gm)].map((m) => ({ poster: /(?:^|\s)poster=(\S+)/.exec(m[4] || '')?.[1] || '' }));
    return emailSpec({ slug: p.slug, image: p.data.image ? String(p.data.image) : '', emailImage: p.data.emailImage ? String(p.data.emailImage) : '', focus, videos, categoryImage: categoryImage.get(String(p.data.category)), heroImage: config.heroImage });
  });
}

test('everything is up to date after a build: a dry run finds nothing to draw and nothing to prune', { skip: SKIP }, () => {
  const r = makeEmailImages(specsFromSource(), { root: ROOT, dryRun: true });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.made, 0);
  assert.equal(r.pruned, 0);
});

test('a post on the blocked-covers list never gets its own cover in email', () => {
  const specs = new Map(specsFromSource().map((s) => [s.slug, s]));
  const posts = new Map(postsFromSource().map((p) => [p.slug, p]));
  for (const [slug, cover] of Object.entries(BLOCKED_COVERS)) {
    const p = posts.get(slug);
    if (!p) continue; // post removed
    if (String(p.data.image || '').replace(/^\//, '') !== cover) continue; // cover replaced at the source
    assert.ok(p.data.emailImage, `${slug}: set emailImage: (its cover shows real company logos)`);
    const spec = specs.get(slug);
    assert.notEqual(spec.source, cover, `${slug}: email picture drawn from the blocked cover`);
    assert.notEqual(spec.videoSource, cover, `${slug}: video picture drawn from the blocked cover`);
    if (!SKIP) assert.notEqual(manifest()[`post:${slug}`]?.source, cover, `${slug}: assets/email/post-${slug}.jpg was drawn from the blocked cover`);
    assert.doesNotMatch(index.find((e) => e.s === slug)?.a || '', /logo/i, `${slug}: a describes the logos of the blocked cover`);
  }
});

test('emailSpec: video pictures come from a local poster or our own cover, never a remote frame; emailImage wins over the cover', () => {
  const base = { slug: 'x', image: '/assets/posts/x.webp', categoryImage: 'assets/img/topics/c.webp', heroImage: 'assets/img/hero.webp' };
  assert.equal(emailSpec({ ...base, videos: [] }).videoSource, undefined);
  assert.equal(emailSpec({ ...base, videos: [{ poster: '' }] }).videoSource, 'assets/posts/x.webp');
  assert.equal(emailSpec({ ...base, videos: [{ poster: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' }] }).videoSource, 'assets/posts/x.webp');
  assert.equal(emailSpec({ ...base, videos: [{ poster: 'assets/posts/p.webp' }] }).videoSource, 'assets/posts/p.webp');
  assert.equal(emailSpec({ ...base, image: 'https://example.com/a.jpg', videos: [{ poster: '' }] }).videoSource, 'assets/img/topics/c.webp');
  const o = emailSpec({ ...base, emailImage: 'assets/img/topics/e.webp', focus: 20, videos: [{ poster: 'assets/posts/x.webp' }] });
  assert.equal(o.source, 'assets/img/topics/e.webp');
  assert.equal(o.videoSource, 'assets/img/topics/e.webp', 'the override also replaces a poster');
  assert.equal(o.focus, undefined, 'imageFocus belongs to the cover, not to emailImage');
});

test('without Chromium or ffmpeg: one warning, nothing drawn, existing pictures and their m kept', () => {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'mb-email-test-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts/tools'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/tools/email-card.html'), path.join(root, 'scripts/tools/email-card.html'));
    fs.mkdirSync(path.join(root, 'assets/posts'), { recursive: true });
    fs.mkdirSync(path.join(root, EMAIL_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets/posts/a.webp'), 'cover a v2');
    fs.writeFileSync(path.join(root, 'assets/posts/b.webp'), 'cover b');
    for (const f of ['post-a.jpg', 'thumb-a.jpg', 'logo.png']) fs.writeFileSync(path.join(root, EMAIL_DIR, f), 'old');
    fs.writeFileSync(path.join(root, '.email-images.json'), JSON.stringify({ images: { 'post:a': { hash: 'abcdef0123456789', bytes: 3 } } }));
    const specs = [{ slug: 'a', source: 'assets/posts/a.webp' }, { slug: 'b', source: 'assets/posts/b.webp' }];
    const r = makeEmailImages(specs, { root, chrome: '' });
    assert.equal(r.made, 0);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /no Chromium/);
    assert.deepEqual(r.images.get('a'), { m: 'abcdef01' }, 'a stale picture keeps its old version');
    assert.deepEqual(r.images.get('b'), {}, 'a post without pictures gets no m');
    for (const f of ['post-a.jpg', 'thumb-a.jpg', 'logo.png']) assert.equal(fs.readFileSync(path.join(root, EMAIL_DIR, f), 'utf8'), 'old', `${f} kept`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.email-images.json'), 'utf8')).images['post:a'].hash, 'abcdef0123456789');
    const d = makeEmailImages(specs, { root, dryRun: true });
    assert.equal(d.made, 0);
    assert.match(d.warnings[0], /--check writes nothing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
