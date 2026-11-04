// Makes the web versions of the photographs used at the top of category and label pages.
//
//   node scripts/tools/make-topic-heroes.mjs [folder-with-originals]
//
// Reads  <folder>/<name>.jpg   (default folder: ../my-site-archive/photo-originals, next to this site, NOT published)
// Writes assets/img/topics/<name>-1280.webp, -2560.webp and -3840.webp (a width is skipped if the original is narrower).
// The page picks the right one for the screen (phones get the small file, 4K screens the big one), so a very large original
// (8K and above) costs nothing extra for visitors: it is only the source. Needs ffmpeg with WebP support.
// After running it, run `node scripts/build.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, '..', 'my-site-archive', 'photo-originals'));
const OUT = path.join(ROOT, 'assets', 'img', 'topics');
const WIDTHS = [[1280, 80], [2560, 76], [3840, 72]]; // [width, WebP quality]

if (!fs.existsSync(SRC)) { console.error(`No folder ${SRC}`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);

let total = 0;
for (const file of fs.readdirSync(SRC).sort()) {
  const m = /^([a-z0-9-]+)\.(jpe?g|png|webp)$/i.exec(file);
  if (!m) continue;
  const name = m[1].toLowerCase();
  const input = path.join(SRC, file);
  const [w, h] = probe(input);
  if (w < h) { console.log(`skip ${file}: portrait picture (${w}x${h})`); continue; }
  const made = [];
  for (const [width, q] of WIDTHS) {
    if (width > w) continue;
    const out = path.join(OUT, `${name}-${width}.webp`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', '-an', out]);
    const kb = Math.round(fs.statSync(out).size / 1024);
    total += kb;
    made.push(`${width}w ${kb}KB`);
  }
  if (!made.length) { // original smaller than the smallest size: keep it as the only size
    const out = path.join(OUT, `${name}-${w}.webp`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-c:v', 'libwebp', '-quality', '80', '-an', out]);
    made.push(`${w}w (original size)`);
  }
  console.log(`${name.padEnd(22)} original ${w}x${h}  ->  ${made.join(', ')}`);
}
console.log(`Done. ${Math.round(total / 1024 * 10) / 10} MB written to assets/img/topics/. Now run: node scripts/build.mjs`);
