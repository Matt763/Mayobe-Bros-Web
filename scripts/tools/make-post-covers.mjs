#!/usr/bin/env node
// Draws the covers of posts that have no photograph (scripts/tools/post-cover-art.html) with headless Chromium and writes
// assets/posts/<slug>.webp (1400 x 788, under 250 KB). Nothing is downloaded and nothing is sent anywhere.
//   node scripts/tools/make-post-covers.mjs                 every scene
//   node scripts/tools/make-post-covers.mjs <slug> [<slug>]  only these
//   --png-only   leave the PNG previews in ~/.cache/mb-cover-preview/ and write no WebP
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome, renderPng } from '../lib/share.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = path.join(ROOT, 'scripts', 'tools', 'post-cover-art.html');
const PREVIEW = path.join(os.homedir(), '.cache', 'mb-cover-preview');
const SLUGS = [
  'hacked-facebook-account-what-to-do',
  'how-tanganyika-won-independence',
  'keeping-children-safe-online-parents-guide',
  'sell-on-jiji-tanzania-rules-safe-deals-ad-limits',
  'sim-swap-fraud-what-to-do',
];
const args = process.argv.slice(2);
const pngOnly = args.includes('--png-only');
const want = args.filter((a) => !a.startsWith('--'));
const slugs = want.length ? want : SLUGS;
for (const s of slugs) if (!SLUGS.includes(s)) { console.error(`unknown scene: ${s}`); process.exit(2); }

const chrome = findChrome();
if (!chrome) { console.error('no Chromium found (set CHROME_BIN)'); process.exit(1); }
fs.mkdirSync(PREVIEW, { recursive: true });
for (const slug of slugs) {
  const png = path.join(PREVIEW, `${slug}.png`);
  const url = pathToFileURL(ART).href + `?scene=${encodeURIComponent(slug)}`;
  renderPng({ chrome, url, w: 1400, h: 788, png });
  if (pngOnly) { console.log(`${slug}: preview ${png}`); continue; }
  const out = path.join(ROOT, 'assets', 'posts', `${slug}.webp`);
  let q = 86;
  for (; q >= 60; q -= 6) {
    execFileSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', png, '-o', out], { stdio: 'pipe' });
    if (fs.statSync(out).size <= 240 * 1024) break;
  }
  console.log(`${slug}: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB, quality ${q})`);
}
