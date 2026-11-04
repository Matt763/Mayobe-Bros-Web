#!/usr/bin/env node
// Opens every external link in posts and reports the ones that do not answer.
//   node scripts/tools/check-sources.mjs <slug> [<slug> ...]     (slug = file name without .md)
//   node scripts/tools/check-sources.mjs --all
// OK = answered 2xx. BLOCKED = the site refuses robots (401/403/429/999): check by hand, not proof of a problem.
// BROKEN = 404/410/5xx or no such host: fix or remove that source. Reads only; changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'posts');
const args = process.argv.slice(2);
const files = args.includes('--all') ? fs.readdirSync(DIR).filter((f) => f.endsWith('.md')) : args.map((a) => a.replace(/\.md$/, '') + '.md');
const jobs = [];
for (const f of files) {
  if (!fs.existsSync(path.join(DIR, f))) { console.log(`MISSING FILE  ${f}`); continue; }
  const t = fs.readFileSync(path.join(DIR, f), 'utf8');
  const urls = new Set([...t.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).filter((u) => !/mayobebros\.com/.test(u)));
  for (const u of urls) jobs.push([f, u]);
}
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
let bad = 0, blocked = 0, ok = 0;
async function check([f, u]) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (r.ok) { ok++; return; }
    if ([401, 403, 429, 999].includes(r.status)) { blocked++; console.log(`BLOCKED ${r.status}  ${f}  ${u}`); return; }
    bad++; console.log(`BROKEN  ${r.status}  ${f}  ${u}`);
  } catch (e) { bad++; console.log(`BROKEN  ${(e.cause && e.cause.code) || e.message}  ${f}  ${u}`); }
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await check(queue.shift()); }));
console.log(`${jobs.length} links in ${files.length} posts: ${ok} OK, ${blocked} blocked (check by hand), ${bad} broken`);
process.exit(bad ? 1 : 0);
