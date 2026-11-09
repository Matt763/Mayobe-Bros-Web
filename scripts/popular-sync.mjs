#!/usr/bin/env node
// Saves the order of the Popular page: the articles readers open most.
//
//   node scripts/popular-sync.mjs            ask the Worker for the order and write content/popular.json
//   node scripts/popular-sync.mjs --dry      show it (with the numbers, in this terminal only) and write nothing
//
// The Worker counts engaged reads in the background (see worker/src/reads.js). Only the ORDER is saved in content/popular.json, which is
// published with the site: never the numbers. They are printed here for the owner and nowhere else. Until enough articles have enough
// reads ("ready": false) the file keeps an empty list and the page stays as it was (editor's picks first). Run it before a build you
// are going to publish, then `node scripts/build.mjs`. Never edit content/popular.json by hand.
//
// Needs the admin token like scripts/comments.mjs (ADMIN_TOKEN, or the git-ignored file .admin-token).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? path.resolve(args[outIdx + 1] || '') : path.join(ROOT, 'content', 'popular.json');
const api = (process.env.MAYOBE_API || cfg.commentsApi || '').replace(/\/$/, '');
let token = process.env.ADMIN_TOKEN || '';
if (!token && fs.existsSync(path.join(ROOT, '.admin-token'))) token = fs.readFileSync(path.join(ROOT, '.admin-token'), 'utf8').trim();
const safe = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, ' ');

if (!api) { console.error('No API address. Set "commentsApi" in site.config.json (or MAYOBE_API).'); process.exit(1); }
if (!token) { console.error('No admin token. Set ADMIN_TOKEN, or save it in a file named .admin-token in the project root.'); process.exit(1); }

let data;
try {
  const r = await fetch(`${api}/v1/admin/popular`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${safe(data.error || r.statusText)}`);
} catch (err) {
  console.error(`Could not read the order: ${safe(err.message)}. content/popular.json was not changed.`);
  process.exit(1);
}
if (!Array.isArray(data.ranked) || !Array.isArray(data.rows)) { console.error('The Worker answered in a shape this script does not know. content/popular.json was not changed.'); process.exit(1); }

const posts = new Set(fs.readdirSync(path.join(ROOT, 'content', 'posts')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')));
const ranked = data.ranked.filter((s) => typeof s === 'string' && posts.has(s));
const ready = data.ready === true && ranked.length >= 5;

console.log(ready ? `Most read: ${ranked.length} articles have enough reads (the page will use this order).` : `Not enough reads yet (${data.ranked.length} article${data.ranked.length === 1 ? '' : 's'} qualif${data.ranked.length === 1 ? 'ies' : 'y'}, 5 needed): the page keeps editor's picks first.`);
for (const row of data.rows.slice(0, 20)) console.log(`  ${String(row.reads).padStart(5)} reads on ${String(row.days).padStart(2)} days  score ${String(row.score).padStart(6)}  ${safe(row.slug)}`);

if (dry) { console.log('Dry run: nothing was written.'); process.exit(0); }
const file = { note: 'Order of the Popular page, written by scripts/popular-sync.mjs. Only the order is kept, never the numbers. Do not edit by hand.', updated: new Date().toISOString().slice(0, 10), ranked: ready ? ranked : [] };
fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
console.log(`Saved ${path.relative(ROOT, out)}.`);
