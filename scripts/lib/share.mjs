// Share pictures: the image that WhatsApp, Facebook, X, LinkedIn, Telegram, Slack and iMessage show when a link is shared.
//
// Every post (and each category, label and the home page) gets its own 1200 x 630 JPEG in assets/share/, drawn from the cover
// picture by scripts/tools/share-card.html in headless Chromium and saved by ffmpeg. Why a separate JPEG and not the cover itself:
//   * the covers are WebP, and WhatsApp, Facebook and LinkedIn do not reliably show a WebP link picture;
//   * covers have many shapes (3:2, 16:9, 4:3); the apps crop each differently, so the subject may be cut off;
//   * WhatsApp drops pictures that are too heavy (it is picky above about 300 KB), so every card is kept under SHARE_BUDGET.
// scripts/build.mjs calls makeShareCards() on every build. It only redraws a card when something it depends on changed (the cover,
// the category name, the focus point, the template, the logo). Without Chromium or ffmpeg nothing breaks: the build warns, keeps the
// cards it already has, and a page without a card falls back to the brand picture (always a JPEG).
//
// The result of every card is remembered in .share-cards.json (a hash of its inputs) so a normal build costs milliseconds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SHARE_W = 1200;
export const SHARE_H = 630;
export const SHARE_DIR = 'assets/share';
export const SHARE_BUDGET = 190 * 1024; // bytes; WhatsApp is reliable well below ~300 KB
const VERSION = 1; // raise to redraw every card after a change that the file hashes below cannot see
const MANIFEST = '.share-cards.json';
const TEMPLATE = 'scripts/tools/share-card.html';
const LOGO = 'assets/img/logo.png';
const QUALITIES = [2, 3, 4, 5, 6, 7, 9, 11, 14]; // ffmpeg -q:v: 2 is best, higher is smaller; the first one that fits the budget wins

export const shareRel = (id) => `${SHARE_DIR}/${id}.jpg`;

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const fileSha = (abs) => (fs.existsSync(abs) ? sha(fs.readFileSync(abs)) : '');

function runs(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/** Path of a Chromium / Chrome that can draw a page to a PNG, or '' when there is none. CHROME_BIN overrides. */
export function findChrome() {
  const home = os.homedir();
  const found = [];
  if (process.env.CHROME_BIN) found.push(process.env.CHROME_BIN);
  const pw = path.join(home, '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).sort().reverse()) {
      if (d.startsWith('chromium_headless_shell-')) found.push(path.join(pw, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
      else if (d.startsWith('chromium-')) found.push(path.join(pw, d, 'chrome-linux64', 'chrome'));
    }
  }
  found.push('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome');
  return found.find((c) => (path.isAbsolute(c) ? fs.existsSync(c) : runs(c, ['--version']))) || '';
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b[0] !== 0x89 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * Draw one card. Returns { bytes, quality }. Throws with a readable message when a step fails.
 * spec: { id, source (path relative to root), chip, focus (0-100, how far down the cover to look) }
 */
function drawCard({ root, chrome, spec, host, tmp }) {
  const png = path.join(tmp, `${spec.id}.png`);
  const out = path.join(root, shareRel(spec.id));
  const q = new URLSearchParams({ img: pathToFileURL(path.join(root, spec.source)).href, cat: spec.chip || '', host });
  if (Number.isFinite(spec.focus)) q.set('fy', String(spec.focus));
  const url = `${pathToFileURL(path.join(root, TEMPLATE)).href}?${q}`;
  try {
    // --no-sandbox: the browser only opens our own template and the site's own pictures from disk, and its sandbox needs privileges
    // that are not always there (containers, some Linux setups)
    execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${SHARE_W},${SHARE_H}`, '--virtual-time-budget=6000', `--screenshot=${png}`, url], { stdio: 'pipe', timeout: 60000 });
  } catch (err) {
    throw new Error(`Chromium could not draw the card (${String(err.stderr || err.message).split('\n')[0].slice(0, 160)})`);
  }
  try {
    const size = fs.existsSync(png) ? pngSize(png) : null;
    if (!size) throw new Error('Chromium wrote no picture');
    if (size.w !== SHARE_W || size.h !== SHARE_H) throw new Error(`card came out ${size.w}x${size.h}, expected ${SHARE_W}x${SHARE_H}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let best = null;
    for (const quality of QUALITIES) {
      // baseline JPEG, 4:2:0, optimised Huffman tables: the most widely understood kind
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-q:v', String(quality), '-pix_fmt', 'yuvj420p', '-huffman', 'optimal', '-frames:v', '1', out], { stdio: 'pipe', timeout: 30000 });
      best = { bytes: fs.statSync(out).size, quality };
      if (best.bytes <= SHARE_BUDGET) break;
    }
    return best;
  } finally {
    fs.rmSync(png, { force: true });
  }
}

/**
 * Make sure every spec has an up-to-date card in assets/share/.
 *   specs: [{ id, source, chip, focus }]   (id = file name without .jpg)
 *   opts:  { root, host, dryRun }          dryRun: draw nothing and delete nothing, only report
 * Returns { cards: Map(id -> { rel, v, bytes, w, h }), warnings: [string], made: number, pruned: number }.
 * A card exists in the map when its file is on disk (even if stale), so the page can always point at a real JPEG.
 */
export function makeShareCards(specs, { root, host, dryRun = false, force = false }) {
  const warnings = [];
  const cards = new Map();
  const manifestPath = path.join(root, MANIFEST);
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).cards || {};
  } catch { /* first run */ }
  const next = {};
  const base = sha(`${VERSION}|${host}|${fileSha(path.join(root, TEMPLATE))}|${fileSha(path.join(root, LOGO))}`);
  const todo = [];
  for (const spec of specs) {
    const srcAbs = path.join(root, spec.source);
    if (!fs.existsSync(srcAbs)) {
      warnings.push(`share picture "${spec.id}": cover not found (${spec.source})`);
      continue;
    }
    const hash = sha(`${base}|${fileSha(srcAbs)}|${spec.chip || ''}|${spec.focus ?? ''}`);
    const out = path.join(root, shareRel(spec.id));
    const have = fs.existsSync(out);
    if (have && !force && previous[spec.id]?.hash === hash) next[spec.id] = previous[spec.id];
    else todo.push({ spec, hash, have });
    if (have) cards.set(spec.id, { rel: shareRel(spec.id), v: (previous[spec.id]?.hash || hash).slice(0, 8), bytes: fs.statSync(out).size, w: SHARE_W, h: SHARE_H });
    if (have && next[spec.id]?.bytes > SHARE_BUDGET) warnings.push(`share picture "${spec.id}" is ${Math.round(next[spec.id].bytes / 1024)} KB (limit ${Math.round(SHARE_BUDGET / 1024)} KB): WhatsApp may skip it; try a simpler cover`);
  }

  let made = 0;
  if (todo.length) {
    const chrome = dryRun ? '' : findChrome();
    const haveFfmpeg = dryRun ? false : runs('ffmpeg', ['-version']);
    if (dryRun || !chrome || !haveFfmpeg) {
      const why = dryRun ? '--check writes nothing' : !chrome ? 'no Chromium or Chrome was found (set CHROME_BIN, or install one with Playwright)' : 'ffmpeg was not found';
      warnings.push(`${todo.length} share picture${todo.length > 1 ? 's are' : ' is'} missing or out of date, and ${why}. Links shared on WhatsApp and other apps will show the brand picture until you run "node scripts/build.mjs" on a machine that has both. Missing: ${todo.slice(0, 6).map((t) => t.spec.id).join(', ')}${todo.length > 6 ? ', ...' : ''}`);
      for (const t of todo) if (t.have && previous[t.spec.id]) next[t.spec.id] = previous[t.spec.id];
    } else {
      const tmp = path.join(os.homedir(), '.cache', 'mb-share-cards'); // not /tmp: it is small on this machine
      fs.mkdirSync(tmp, { recursive: true });
      console.log(`  drawing ${todo.length} share picture${todo.length > 1 ? 's' : ''} (about a second each)...`);
      for (const t of todo) {
        try {
          const r = drawCard({ root, chrome, spec: t.spec, host, tmp });
          next[t.spec.id] = { hash: t.hash, bytes: r.bytes, quality: r.quality };
          cards.set(t.spec.id, { rel: shareRel(t.spec.id), v: t.hash.slice(0, 8), bytes: r.bytes, w: SHARE_W, h: SHARE_H });
          if (r.bytes > SHARE_BUDGET) warnings.push(`share picture "${t.spec.id}" is ${Math.round(r.bytes / 1024)} KB even at the lowest quality (limit ${Math.round(SHARE_BUDGET / 1024)} KB): try a simpler cover`);
          made++;
        } catch (err) {
          warnings.push(`share picture "${t.spec.id}" was not made: ${err.message}`);
          if (t.have && previous[t.spec.id]) next[t.spec.id] = previous[t.spec.id];
        }
      }
    }
  }

  // cards of posts and pages that no longer exist
  let pruned = 0;
  const dir = path.join(root, SHARE_DIR);
  if (fs.existsSync(dir)) {
    const ids = new Set(specs.map((s) => s.id));
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jpg') || ids.has(f.slice(0, -4))) continue;
      pruned++;
      if (!dryRun) fs.rmSync(path.join(dir, f));
    }
  }
  if (!dryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify({ note: 'Hashes of what each assets/share/*.jpg was drawn from. Written by scripts/build.mjs. Do not edit.', cards: next }, null, 1) + '\n');
  }
  return { cards, warnings, made, pruned };
}
