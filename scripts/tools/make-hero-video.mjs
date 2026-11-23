#!/usr/bin/env node
/* Turns ONE source video into the small web versions the home page hero plays.
 *
 *   node scripts/tools/make-hero-video.mjs /path/to/source.mp4 [--force]
 *
 * Needs ffmpeg and cwebp (both found on PATH). Writes into assets/video/home/ and assets/img/:
 *   mayobebros-240.mp4 / .webm   426 px wide, 12.5 frames a second: 2G, Save-Data, the weakest phones (about 0.1 to 0.2 MB)
 *   mayobebros-360.mp4 / .webm   640 px wide: 3G and weak devices
 *   mayobebros-480.mp4 / .webm   854 px wide
 *   mayobebros-720.mp4 / .webm   1280 px wide, for most screens
 *   mayobebros-1080.mp4 / .webm  1920 px wide, for large screens
 * js/hero-video.js chooses ONE of them from the network, the device and the screen, and steps down by itself if playback stalls.
 *   assets/img/hero.webp, hero-1080.webp, hero-640.webp   the still shown first (and when the video does not play)
 *
 * What it does to every version (see docs/hero-video.md for the research behind each choice):
 *  - no sound track (a muted background clip must not carry audio bytes);
 *  - the last second dissolves into the first, so the loop has no visible jump;
 *  - H.264 (plays everywhere) and VP9 WebM (about 30 to 40% smaller in browsers that have it);
 *  - MP4 "faststart" (play begins before the whole file arrives);
 *  - the poster is frame 1 of the loop, so the picture does not change when the video fades in.
 * The source is never copied into the repository (it is large and public files here are served to everyone). A hash of the
 * source plus the settings is kept in assets/video/home/.hero-video.json, so running it again with the same file does nothing.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'assets/video/home');
const BASE = 'mayobebros';
const FADE = 1; // seconds of dissolve that close the loop
const TIERS = [
  // width, frame rate (null = keep the source's), H.264 profile and crf, VP9 crf (lower = better picture, bigger file), H.264 peak rate
  { w: 426, fps: 12.5, name: '240', profile: 'baseline', x264: 30, vp9: 41, maxrate: '260k' },
  { w: 640, fps: null, name: '360', profile: 'main', x264: 29, vp9: 38, maxrate: '520k' },
  { w: 854, fps: null, name: '480', profile: 'main', x264: 27, vp9: 36, maxrate: '900k' },
  { w: 1280, fps: null, name: '720', profile: 'main', x264: 25, vp9: 34, maxrate: '1800k' },
  { w: 1920, fps: null, name: '1080', profile: 'main', x264: 24, vp9: 33, maxrate: '3200k' },
];
const POSTERS = [[640, 'hero-640.webp'], [1080, 'hero-1080.webp'], [1920, 'hero.webp']];

const args = process.argv.slice(2);
const force = args.includes('--force');
const src = args.find((a) => !a.startsWith('--'));
if (!src || !existsSync(src)) {
  console.error('Usage: node scripts/tools/make-hero-video.mjs /path/to/source.mp4 [--force]');
  process.exit(1);
}
const run = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString();

const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-show_entries', 'format=duration', '-of', 'json', src]));
const dur = parseFloat(probe.format.duration);
const srcW = probe.streams[0].width;
if (!(dur > FADE * 4)) throw new Error('The video is too short to loop.');

const srcHash = createHash('sha256').update(readFileSync(src)).digest('hex');
const stampFile = join(OUT, '.hero-video.json');
mkdirSync(OUT, { recursive: true });
const prev = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : {};
const tierHash = (t) => createHash('sha256').update(srcHash).update(JSON.stringify([t, FADE, 4])).digest('hex');
const posterHash = createHash('sha256').update(srcHash).update(JSON.stringify([POSTERS, FADE, 4])).digest('hex');

// the loop: play from FADE to the end, while the last FADE seconds dissolve into the first FADE seconds;
// when it starts again at FADE the picture continues exactly where the dissolve ended
const loop = (w) =>
  `[0:v]split=2[a][b];[a]trim=start=${FADE},setpts=PTS-STARTPTS[v1];[b]trim=end=${FADE},setpts=PTS-STARTPTS[v2];` +
  `[v1][v2]xfade=transition=fade:duration=${FADE}:offset=${(dur - 2 * FADE).toFixed(3)},scale=${Math.min(w, srcW)}:-2:flags=lanczos,format=yuv420p[vv]`;

const sizes = {};
const tierStamps = {};
for (const t of TIERS) {
  const mp4 = join(OUT, `${BASE}-${t.name}.mp4`);
  const webm = join(OUT, `${BASE}-${t.name}.webm`);
  const h = tierHash(t);
  tierStamps[t.name] = h;
  if (!force && prev.tiers?.[t.name] === h && existsSync(mp4) && existsSync(webm)) {
    console.log(`${t.name}p is up to date`);
  } else {
    const chain = (w) => `${loop(w)};[vv]${t.fps ? `fps=${t.fps}` : 'null'}[v]`;
    console.log(`${t.name}p H.264 ...`);
    run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-filter_complex', chain(t.w), '-map', '[v]', '-an', '-c:v', 'libx264', '-profile:v', t.profile, '-preset', 'slow',
      '-crf', String(t.x264), '-maxrate', t.maxrate, '-bufsize', `${parseInt(t.maxrate, 10) * 2}k`, '-g', '50', '-tag:v', 'avc1', '-movflags', '+faststart', mp4]);
    console.log(`${t.name}p VP9 ...`);
    run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-filter_complex', chain(t.w), '-map', '[v]', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(t.vp9),
      '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-g', '250', webm]);
  }
  sizes[t.name] = { mp4: statSync(mp4).size, webm: statSync(webm).size };
}

// the still: first frame of the loop (source time = FADE)
if (force || prev.poster !== posterHash) {
  const tmp = mkdtempSync(join(tmpdir(), 'hero-poster-'));
  try {
    const png = join(tmp, 'frame.png');
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(FADE), '-i', src, '-frames:v', '1', png]);
    for (const [w, file] of POSTERS) {
      const scaled = join(tmp, `f${w}.png`);
      run('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `scale=${Math.min(w, srcW)}:-2:flags=lanczos`, scaled]);
      run('cwebp', ['-q', w >= 1920 ? '80' : '78', '-m', '6', scaled, '-o', join(root, 'assets/img', file)]);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
for (const [, file] of POSTERS) sizes[file] = statSync(join(root, 'assets/img', file)).size;

writeFileSync(stampFile, JSON.stringify({ tiers: tierStamps, poster: posterHash, seconds: +(dur - FADE).toFixed(2), sizes }, null, 2) + '\n');
console.log('Loop length:', (dur - FADE).toFixed(2), 's');
for (const [k, v] of Object.entries(sizes)) console.log(' ', k, typeof v === 'number' ? `${(v / 1024).toFixed(0)} KB` : `mp4 ${(v.mp4 / 1024).toFixed(0)} KB, webm ${(v.webm / 1024).toFixed(0)} KB`);
