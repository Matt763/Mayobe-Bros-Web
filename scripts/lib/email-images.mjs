// Email pictures: the small JPEGs (and the logo PNG) that the welcome and new-article emails show.
//
// Per published post, assets/email/ gets:
//   post-<slug>.jpg   1200 x 675, the cover (shown at most 600 x 338 in an email)
//   thumb-<slug>.jpg  224 x 168, cropped and scaled by ffmpeg from the same shot (shown 112 x 84)
//   video-<slug>.jpg  1200 x 675, only for a post with a video: our own cover (the declared poster, else the cover) with a play
//                     button drawn in. Never a frame of someone else's video.
// and once: logo.png  424 x 96, the wordmark on an opaque white rounded plate (shown 212 x 48), a palette PNG.
// Drawn by scripts/tools/email-card.html in headless Chromium and encoded by ffmpeg, like the share cards (scripts/lib/share.mjs).
// Each file is redrawn only when what it depends on changes (the cover, imageFocus, the template, the logo); hashes are kept in
// .email-images.json. The first 8 hex of a post's hash go into data/search.json as `m` (post- and thumb-) and `w` (video-), so the
// Worker can add `?v=<hash>` to the address and mail apps that cache by address fetch a new picture after a change.
// Without Chromium or ffmpeg (or with --check) nothing is drawn: the build warns, keeps the files it has, and a post whose files are
// missing simply gets no `m`/`w` (its emails show live text only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findChrome, runs, renderPng, encodeJpeg, QUALITIES } from './share.mjs';

export const EMAIL_DIR = 'assets/email';
export const EMAIL_SIZES = { post: [1200, 675], video: [1200, 675], thumb: [224, 168], logo: [424, 96] };
// Bytes. The plan allowed 100 KB for post-/video-; 90 KB is used so a welcome email (logo + lead + two thumbnails) stays far
// under its 170 KB picture budget on mobile data.
export const EMAIL_BUDGETS = { post: 90 * 1024, video: 90 * 1024, thumb: 20 * 1024, logo: 24 * 1024 };
const VERSION = 1; // raise to redraw every email picture after a change the file hashes cannot see
const MANIFEST = '.email-images.json';
const TEMPLATE = 'scripts/tools/email-card.html';
const LOGO = 'assets/img/logo.png';
const THUMB_VF = 'crop=900:675,scale=224:168:flags=lanczos'; // the middle 4:3 of the 16:9 shot
// part of every hash: changing a size, a budget, the quality ladder or the thumbnail crop redraws everything once
const SETTINGS = JSON.stringify([EMAIL_SIZES, EMAIL_BUDGETS, QUALITIES, THUMB_VF]);

/** Path of an email picture relative to the site root: emailRel('logo') or emailRel('post' | 'thumb' | 'video', slug). */
export const emailRel = (kind, slug) => (kind === 'logo' ? `${EMAIL_DIR}/logo.png` : `${EMAIL_DIR}/${kind}-${slug}.jpg`);

/** The first local picture path of a list (no URLs, no data:), without a leading slash; '' when there is none. */
export const localPath = (...c) => (c.find((x) => x && !/^(https?:)?\/\//i.test(x) && !String(x).startsWith('data:')) || '').replace(/^\//, '');

/**
 * What the email pictures of one post are drawn from (used by scripts/build.mjs and the tests).
 *   source:      emailImage when set (a cover that cannot be used in email, e.g. one showing real logos), else the cover,
 *                else the category picture, else the home picture.
 *   videoSource: only for a post with a video: the same emailImage when set, else the declared poster (local files only; a remote
 *                poster such as a YouTube thumbnail is skipped), else the cover. Never a frame of someone else's video.
 *   focus:       imageFocus, which belongs to the cover, so it is dropped when emailImage is used.
 */
export function emailSpec({ slug, image = '', emailImage = '', focus, videos = [], categoryImage = '', heroImage = '' }) {
  const source = emailImage ? localPath(emailImage, categoryImage, heroImage) : localPath(image, categoryImage, heroImage);
  const videoSource = videos.length ? (emailImage ? source : localPath(videos[0].poster, image, categoryImage, heroImage)) : '';
  return { slug, source, ...(!emailImage && Number.isFinite(focus) ? { focus } : {}), ...(videoSource ? { videoSource } : {}) };
}

/** imageAlt as one line of at most 150 characters (cut at a word, marked with an ellipsis), for data/search.json `a`. */
export function emailAlt(alt) {
  const s = String(alt || '').replace(/\s+/g, ' ').trim();
  if (s.length <= 150) return s;
  const cut = s.slice(0, 149);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 100 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const fileSha = (abs) => (fs.existsSync(abs) ? sha(fs.readFileSync(abs)) : '');
const kb = (n) => `${Math.round(n / 1024)} KB`;

function templateUrl(root, params) {
  return `${pathToFileURL(path.join(root, TEMPLATE)).href}?${new URLSearchParams(params)}`;
}

/** One 1200 x 675 shot -> post- (or video-) JPEG, and thumb- from the same PNG when withThumb. */
function drawPost({ root, chrome, tmp, slug, source, focus, play }) {
  const [w, h] = EMAIL_SIZES.post;
  const png = path.join(tmp, `${play ? 'video' : 'post'}-${slug}.png`);
  const params = { img: pathToFileURL(path.join(root, source)).href, w, h, play: play ? 1 : 0 };
  if (Number.isFinite(focus)) params.fy = focus;
  try {
    renderPng({ chrome, url: templateUrl(root, params), w, h, png });
    const kind = play ? 'video' : 'post';
    const main = encodeJpeg(png, path.join(root, emailRel(kind, slug)), EMAIL_BUDGETS[kind]);
    const thumb = play ? null : encodeJpeg(png, path.join(root, emailRel('thumb', slug)), EMAIL_BUDGETS.thumb, THUMB_VF);
    return { main, thumb };
  } finally {
    fs.rmSync(png, { force: true });
  }
}

function drawLogo({ root, chrome, tmp }) {
  const [w, h] = EMAIL_SIZES.logo;
  const png = path.join(tmp, 'logo-shot.png');
  const out = path.join(root, emailRel('logo'));
  try {
    renderPng({ chrome, url: templateUrl(root, { logo: 1, w, h }), w, h, png, transparent: true });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // palette PNG: far smaller than RGBA; one reserved transparent entry for the rounded corners
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'split[a][b];[a]palettegen=max_colors=128:reserve_transparent=1:stats_mode=single[p];[b][p]paletteuse=dither=none:alpha_threshold=128', '-frames:v', '1', '-pix_fmt', 'pal8', out], { stdio: 'pipe', timeout: 30000 });
    return { bytes: fs.statSync(out).size };
  } finally {
    fs.rmSync(png, { force: true });
  }
}

/**
 * Make sure every published post has up-to-date email pictures, and the logo exists.
 *   specs: [{ slug, source, focus?, videoSource? }]   source / videoSource: paths relative to root; videoSource only for a post with a video
 *   opts:  { root, dryRun, force, chrome }             dryRun: draw nothing, delete nothing, write no manifest;
 *                                                      chrome: browser path ('' = none; tests), default findChrome()
 * Returns { images: Map(slug -> { m?, w? }), warnings, made, pruned }. `m` is set when post- and thumb- exist on disk, `w` when
 * video- exists (even if stale, so an email can always point at a real file).
 */
export function makeEmailImages(specs, { root, dryRun = false, force = false, chrome: chromeBin }) {
  const warnings = [];
  const images = new Map();
  const manifestPath = path.join(root, MANIFEST);
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).images || {};
  } catch { /* first run */ }
  const next = {};
  const base = sha(`${VERSION}|${SETTINGS}|${fileSha(path.join(root, TEMPLATE))}`);
  const exists = (rel) => fs.existsSync(path.join(root, rel));
  const todo = []; // { key, kind: 'post' | 'video' | 'logo', slug?, source?, focus?, hash }

  // the logo
  const logoHash = sha(`${base}|logo|${fileSha(path.join(root, LOGO))}`);
  if (exists(emailRel('logo')) && !force && previous.logo?.hash === logoHash) next.logo = previous.logo;
  else todo.push({ key: 'logo', kind: 'logo', hash: logoHash });

  for (const spec of specs) {
    const entry = {};
    const jobs = [['post', spec.source, `post:${spec.slug}`, [emailRel('post', spec.slug), emailRel('thumb', spec.slug)], 'm']];
    if (spec.videoSource) jobs.push(['video', spec.videoSource, `video:${spec.slug}`, [emailRel('video', spec.slug)], 'w']);
    for (const [kind, source, key, rels, field] of jobs) {
      const srcAbs = source ? path.join(root, source) : '';
      const have = rels.every(exists);
      if (!srcAbs || !fs.existsSync(srcAbs)) {
        warnings.push(`email picture "${kind}-${spec.slug}": cover not found (${source || 'none'})`);
        if (have && previous[key]) { next[key] = previous[key]; entry[field] = previous[key].hash.slice(0, 8); }
        continue;
      }
      const hash = sha(`${base}|${kind}|${fileSha(srcAbs)}|${spec.focus ?? ''}`);
      if (have && !force && previous[key]?.hash === hash) next[key] = previous[key];
      else todo.push({ key, kind, slug: spec.slug, source, focus: spec.focus, hash, have, field });
      if (next[key]) next[key] = { ...next[key], source }; // what it was drawn from, so a test can prove a blocked cover is not used
      if (have) entry[field] = (previous[key]?.hash || hash).slice(0, 8);
    }
    images.set(spec.slug, entry);
  }

  let made = 0;
  if (todo.length) {
    const chrome = dryRun ? '' : chromeBin ?? findChrome();
    const haveFfmpeg = dryRun ? false : runs('ffmpeg', ['-version']);
    if (dryRun || !chrome || !haveFfmpeg) {
      const why = dryRun ? '--check writes nothing' : !chrome ? 'no Chromium or Chrome was found (set CHROME_BIN, or install one with Playwright)' : 'ffmpeg was not found';
      warnings.push(`${todo.length} email picture${todo.length > 1 ? 's are' : ' is'} missing or out of date, and ${why}. Emails about these posts show text only until you run "node scripts/build.mjs" on a machine that has both. Missing: ${todo.slice(0, 6).map((t) => (t.kind === 'logo' ? 'logo' : `${t.kind}-${t.slug}`)).join(', ')}${todo.length > 6 ? ', ...' : ''}`);
      for (const t of todo) if (t.have && previous[t.key]) next[t.key] = previous[t.key];
      if (!next.logo && previous.logo && exists(emailRel('logo'))) next.logo = previous.logo;
    } else {
      const tmp = path.join(os.homedir(), '.cache', 'mb-email-images'); // not /tmp: it is small on this machine
      fs.mkdirSync(tmp, { recursive: true });
      console.log(`  drawing ${todo.length} email picture${todo.length > 1 ? 's' : ''} (about a second each)...`);
      for (const t of todo) {
        const name = t.kind === 'logo' ? 'logo' : `${t.kind}-${t.slug}`;
        try {
          if (t.kind === 'logo') {
            const r = drawLogo({ root, chrome, tmp });
            next.logo = { hash: t.hash, bytes: r.bytes };
            if (r.bytes > EMAIL_BUDGETS.logo) warnings.push(`email logo is ${kb(r.bytes)} (limit ${kb(EMAIL_BUDGETS.logo)})`);
          } else {
            const r = drawPost({ root, chrome, tmp, slug: t.slug, source: t.source, focus: t.focus, play: t.kind === 'video' });
            next[t.key] = { hash: t.hash, source: t.source, bytes: r.main.bytes, quality: r.main.quality, ...(r.thumb ? { thumbBytes: r.thumb.bytes, thumbQuality: r.thumb.quality } : {}) };
            images.get(t.slug)[t.field] = t.hash.slice(0, 8);
            if (r.main.bytes > EMAIL_BUDGETS[t.kind]) warnings.push(`email picture "${name}" is ${kb(r.main.bytes)} even at the lowest quality (limit ${kb(EMAIL_BUDGETS[t.kind])}): try a simpler cover`);
            if (r.thumb && r.thumb.bytes > EMAIL_BUDGETS.thumb) warnings.push(`email picture "thumb-${t.slug}" is ${kb(r.thumb.bytes)} (limit ${kb(EMAIL_BUDGETS.thumb)})`);
          }
          made++;
        } catch (err) {
          warnings.push(`email picture "${name}" was not made: ${err.message}`);
          if (t.have && previous[t.key]) next[t.key] = previous[t.key];
        }
      }
    }
  }

  // files of posts that no longer exist (or that lost their video)
  let pruned = 0;
  const dir = path.join(root, EMAIL_DIR);
  if (fs.existsSync(dir)) {
    const keep = new Set(['logo.png']);
    for (const s of specs) {
      keep.add(`post-${s.slug}.jpg`);
      keep.add(`thumb-${s.slug}.jpg`);
      if (s.videoSource) keep.add(`video-${s.slug}.jpg`);
    }
    for (const f of fs.readdirSync(dir)) {
      if (keep.has(f)) continue;
      pruned++;
      if (!dryRun) fs.rmSync(path.join(dir, f));
    }
  }
  if (!dryRun) {
    const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
    fs.writeFileSync(manifestPath, JSON.stringify({ note: 'Hashes of what each assets/email/* picture was drawn from. Written by scripts/build.mjs. Do not edit.', images: sorted }, null, 1) + '\n');
  }
  return { images, warnings, made, pruned };
}
