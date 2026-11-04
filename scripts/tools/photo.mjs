#!/usr/bin/env node
// Finds and prepares a picture that the site may legally use, for a post cover.
//
//   node scripts/tools/photo.mjs search "kilimanjaro sunrise"            list candidates (Openverse + Wikimedia Commons)
//   node scripts/tools/photo.mjs get ov:<id>  <post-slug>                 download, shrink to a small WebP, print the front matter lines
//   node scripts/tools/photo.mjs get wc:"File:Name.jpg" <post-slug>
//
// Only pictures with a licence that allows commercial use WITHOUT share-alike are offered: CC0, public domain, CC BY.
// (CC BY-SA, NC, ND, GFDL and "fair use" are rejected.) The WebP goes to assets/posts/<post-slug>.webp, 1400 px wide at most,
// aiming for under 220 KB. A small JPEG preview is written to ~/.cache/mb-photo-preview/<post-slug>.jpg so you can LOOK at the picture
// before you use it (open it with the Read tool). Nothing is written to the post: copy the printed lines into its front matter and
// write your own literal `imageAlt`.
// Needs ffmpeg with WebP support and internet access.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'assets', 'posts');
const PREVIEW = path.join(os.homedir(), '.cache', 'mb-photo-preview');
const UA = 'MayobeBrosSite/1.0 (https://mayobebros.com; mbagamclean@gmail.com) photo-tool';
const MAX_KB = 220;

const [cmd, a1, a2] = process.argv.slice(2);
const getJson = async (url) => {
  for (let i = 0; i < 3; i++) {
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); } catch (err) { if (i === 2) throw err; await new Promise((ok) => setTimeout(ok, 1000)); continue; }
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
    throw new Error(`${r.status} for ${url}`);
  }
  throw new Error('too many retries: ' + url);
};
const ovLicense = (x) => (x.license === 'pdm' ? 'Public domain' : x.license === 'cc0' ? 'CC0' : `CC ${String(x.license).toUpperCase()}${x.license_version ? ' ' + x.license_version : ''}`);
const okLicense = (name) => /^(cc0|pdm|public domain|cc by( |-|$)|cc-by)/i.test(String(name).trim()) && !/-sa\b|\bsa\b|nc|nd|gfdl|fair/i.test(String(name));

async function openverse(q) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm,by&category=photograph&aspect_ratio=wide&size=large&page_size=20`;
  const j = await getJson(url);
  return (j.results || []).map((x) => ({
    id: `ov:${x.id}`, title: x.title, creator: x.creator, license: ovLicense(x),
    source: x.source || x.provider, w: x.width, h: x.height, landing: x.foreign_landing_url,
  }));
}
async function commons(q) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=1400&format=json&origin=*`;
  const j = await getJson(url);
  return Object.values(j.query?.pages || {}).map((p) => {
    const i = p.imageinfo?.[0]; const m = i?.extmetadata || {};
    return { id: `wc:${p.title}`, title: (m.ObjectName?.value || p.title).replace(/<[^>]+>/g, ''), creator: (m.Artist?.value || '').replace(/<[^>]+>/g, '').trim(), license: m.LicenseShortName?.value || '', source: 'Wikimedia Commons', w: i?.width, h: i?.height, landing: i?.descriptionurl, direct: i?.thumburl || i?.url };
  });
}

if (cmd === 'search') {
  if (!a1) { console.error('usage: search "<query>"'); process.exit(1); }
  const rows = [];
  try { rows.push(...await openverse(a1)); } catch (e) { console.error('openverse:', e.message, e.cause?.code || ''); }
  try { rows.push(...await commons(a1)); } catch (e) { console.error('commons:', e.message, e.cause?.code || ''); }
  const good = rows.filter((r) => okLicense(r.license) && r.w >= 1400 && r.w / r.h >= 1.3);
  if (!good.length) console.log('No usable candidates. Try other words (a place, an object, a activity), not an abstract idea.');
  good.slice(0, 20).forEach((r) => console.log(`${r.id}\n   ${String(r.title).slice(0, 80)} | by ${String(r.creator || 'unknown').slice(0, 40)} | ${r.license} | ${r.source} | ${r.w}x${r.h}\n   ${r.landing}`));
  process.exit(0);
}

if (cmd === 'get') {
  if (!a1 || !a2 || !/^[a-z0-9-]+$/.test(a2)) { console.error('usage: get <ov:id|wc:File:Name.jpg> <post-slug>'); process.exit(1); }
  let r, direct;
  if (a1.startsWith('ov:')) {
    const x = await getJson(`https://api.openverse.org/v1/images/${a1.slice(3)}/`);
    r = { creator: x.creator, license: ovLicense(x), source: x.source || x.provider, landing: x.foreign_landing_url, title: x.title };
    direct = x.url;
  } else if (a1.startsWith('wc:')) {
    const t = a1.slice(3);
    const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(t)}&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=2000&format=json&origin=*`);
    const p = Object.values(j.query.pages)[0]; const i = p.imageinfo?.[0]; const m = i?.extmetadata || {};
    if (!i) throw new Error('file not found on Commons');
    r = { creator: (m.Artist?.value || '').replace(/<[^>]+>/g, '').trim(), license: m.LicenseShortName?.value || '', source: 'Wikimedia Commons', landing: i.descriptionurl, title: t };
    direct = i.thumburl || i.url;
  } else { console.error('id must start with ov: or wc:'); process.exit(1); }
  if (!okLicense(r.license)) { console.error(`Refused: licence "${r.license}" is not allowed (need CC0, public domain or CC BY).`); process.exit(2); }

  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PREVIEW, { recursive: true });
  const tmp = path.join(os.tmpdir(), `mbphoto-${process.pid}.img`);
  const res = await fetch(direct, { headers: { 'User-Agent': UA } });
  if (!res.ok) { console.error(`download failed: ${res.status}`); process.exit(3); }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) { console.error('file too large'); process.exit(3); }
  fs.writeFileSync(tmp, buf);
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', tmp]).toString().trim().split(',').map(Number);
  if (!(dims[0] >= 1000 && dims[0] / dims[1] >= 1.3)) { fs.unlinkSync(tmp); console.error(`Refused: ${dims.join('x')} is too small or not landscape.`); process.exit(2); }
  const out = path.join(OUT, `${a2}.webp`);
  let kb = 0, q = 80;
  for (; q >= 50; q -= 8) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-vf', `scale='min(1400,iw)':-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', '-an', out]);
    kb = Math.round(fs.statSync(out).size / 1024);
    if (kb <= MAX_KB) break;
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', out, '-vf', 'scale=800:-2', '-q:v', '4', path.join(PREVIEW, `${a2}.jpg`)]);
  fs.unlinkSync(tmp);
  const creator = (r.creator || '').replace(/\s+/g, ' ').slice(0, 80);
  const credit = `Photo: ${creator ? creator + ', ' : ''}${r.license}${/commons/i.test(r.source) ? ', via Wikimedia Commons' : r.source ? `, via ${r.source}` : ''}`;
  console.log(`Saved assets/posts/${a2}.webp  (${kb} KB, quality ${q}, original ${dims.join('x')})`);
  console.log(`LOOK at it before use: ${path.join(PREVIEW, a2 + '.jpg')}${kb > MAX_KB ? `\nWARNING: ${kb} KB is over ${MAX_KB} KB; pick a simpler picture.` : ''}`);
  console.log(`\nimage: assets/posts/${a2}.webp\nimageCredit: ${credit}\nimageSource: ${r.landing}`);
  process.exit(0);
}

console.error('usage:\n  node scripts/tools/photo.mjs search "<query>"\n  node scripts/tools/photo.mjs get <ov:id|wc:File:Name.jpg> <post-slug>');
process.exit(1);
