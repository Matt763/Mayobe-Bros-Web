#!/usr/bin/env node
// Rebuilds every icon from the logo mark in scripts/tools/logo-mark-source.png (needs ffmpeg).
//   node scripts/tools/make-icons.mjs
// The mark is cropped tight (it fills about 95% of the canvas) so it stays readable at 16 px in a browser tab and in search results.
// Writes: favicon.ico (16, 32 and 48 px in one file), assets/img/favicon-32.png, favicon-48.png, icon-192.png, icon-512.png (the
// Organization logo in the structured data) and icon-180.png (Apple touch icon: opaque white, because iOS paints transparency black).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'scripts/tools/logo-mark-source.png');
const img = (n) => join(root, 'assets/img', n);
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

// 1. where the mark is: the box that holds every pixel that is not transparent
const probe = spawnSync('ffmpeg', ['-hide_banner', '-i', src, '-vf', 'format=rgba,alphaextract,format=gray,cropdetect=limit=8:round=2:skip=0:reset=1', '-frames:v', '2', '-f', 'null', '-'], { encoding: 'utf8' });
const m = /crop=(\d+):(\d+):(\d+):(\d+)/g; let box; for (let r; (r = m.exec(probe.stderr));) box = r.slice(1).map(Number);
if (!box) { console.error('Could not measure the logo (is ffmpeg installed?)'); process.exit(1); }
const [w, h, x, y] = box;
const side = Math.round(Math.max(w, h) * 1.055); // about 5% of empty space in total: the mark fills 95% of the canvas
const dir = mkdtempSync(join(tmpdir(), 'icons-'));
const base = join(dir, 'mark.png');
ff('-i', src, '-vf', `crop=${w}:${h}:${x}:${y},pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`, base);
const size = (px, out) => ff('-i', base, '-vf', `scale=${px}:${px}:flags=lanczos,format=rgba`, '-compression_level', '100', '-pred', 'mixed', '-frames:v', '1', out);

size(512, img('icon-512.png'));
size(192, img('icon-192.png'));
size(48, img('favicon-48.png'));
size(32, img('favicon-32.png'));
const s16 = join(dir, '16.png'); size(16, s16);
// the Apple touch icon sits on opaque white with room around the mark
ff('-f', 'lavfi', '-i', 'color=c=white:s=180x180', '-i', base, '-filter_complex', '[1]scale=136:136:flags=lanczos[m];[0][m]overlay=(W-w)/2:(H-h)/2,format=rgb24', '-frames:v', '1', img('icon-180.png'));
// one .ico that holds 16, 32 and 48 px
ff('-i', s16, '-i', img('favicon-32.png'), '-i', img('favicon-48.png'), '-map', '0', '-map', '1', '-map', '2', '-c', 'png', join(root, 'favicon.ico'));
rmSync(dir, { recursive: true, force: true });
console.log(`mark ${w}x${h} cropped to a ${side}px square; icons written`);
