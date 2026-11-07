// Checks on the email pictures (assets/email/*, drawn by scripts/lib/email-images.mjs). Run `node scripts/build.mjs` first.
//   node --no-warnings --test scripts/tests/email-images.test.mjs
// The Worker reads `m`, `w` and `a` from data/search.json and builds the picture addresses from them, so every `m` and `w`
// must point at a real file of the exact size, and the files must stay small (email is often read on mobile data).
// Note: the last test runs `node scripts/build.mjs` (plain, no --api) to prove a second build draws nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EMAIL_DIR, EMAIL_SIZES, EMAIL_BUDGETS, emailRel, emailAlt } from '../lib/email-images.mjs';
import { findChrome } from '../lib/share.mjs';
import { parseFrontMatter } from '../lib/frontmatter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, EMAIL_DIR);
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR) : [];
const SKIP = !files.length && !findChrome() ? 'assets/email is empty and no Chromium was found: email pictures cannot be drawn on this machine' : false;
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/search.json'), 'utf8'));
const VIDEO_POST = 'how-to-find-an-internship-in-tanzania-real-or-fake';

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

test('a = imageAlt from the front matter, one line, at most 150 characters', () => {
  const bySlug = new Map(index.map((e) => [e.s, e]));
  let n = 0;
  for (const p of postsFromSource()) {
    const e = bySlug.get(p.slug);
    if (!e) continue; // samples left out by --no-samples
    const alt = p.data.imageAlt ? String(p.data.imageAlt) : '';
    if (!alt) { assert.equal(e.a, undefined, `${p.slug}: no imageAlt, so no a`); continue; }
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

test('a second build draws 0 email pictures and 0 share pictures', { skip: SKIP }, () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  const out = `${r.stdout}\n${r.stderr}`;
  assert.doesNotMatch(out, /drawing/, out.split('\n').filter((l) => /drawing/.test(l)).join('\n'));
});
