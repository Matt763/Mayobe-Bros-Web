#!/usr/bin/env node
// ACSEE 2004 school results from the Internet Archive's saved copy of NECTA's own 2004 pages (NECTA and the Maktaba mirror no longer
// have this year; checked 2026-11-14, report in ~/necta-work/recon/acsee-2004 notes). Resumable, 1 request per second, raw pages are kept.
//   node scripts/tools/import-acsee-2004-wayback.mjs [--limit N] [--dry]
// Writes the same files as scripts/necta-import.mjs, so `node scripts/results-data.mjs --exam acsee-2004` packs it:
//   ~/necta-work/data/acsee/2004/<code>.json, exams/acsee-2004.json, status/acsee-2004.json  (raw pages: ~/necta-work/wayback/acsee-2004/raw/)
// Only the school pages' CNO, SEX, AGGT, DIV and subject grades are read; the candidate NAME column is never parsed, stored or sent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeBuffer } from '../lib/necta-parse.mjs';
import { parseLegacyCentre } from '../lib/necta-parse-legacy.mjs';

const WORK = path.join(os.homedir(), 'necta-work');
const RAW = path.join(WORK, 'wayback', 'acsee-2004', 'raw');
const DATA = path.join(WORK, 'data', 'acsee', '2004');
const INDEX_URL = 'https://web.archive.org/web/20041010104217id_/http://www.necta.go.tz:80/ALEVEL.HTM';
const TEMPLATE = (code) => `https://web.archive.org/web/2004/http://www.necta.go.tz/alevel/${code.toLowerCase()}.htm`;
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || (process.argv.includes('--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : 0)) || 0;
const dry = process.argv.includes('--dry');
const UA = 'Mozilla/5.0 (compatible; results-archive-import)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const wait = Math.max(0, last + 1000 - Date.now()); if (wait) await sleep(wait); last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (res.status === 200) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(5000 * (i + 1)); }
  }
  return undefined; // gave up: not the same as a 404
}
const writeJson = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const t = `${file}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(obj)); fs.renameSync(t, file); };
const today = () => new Date().toISOString().slice(0, 10);

// 1. the index: every centre link (the ranking page P0001 is not a centre)
fs.mkdirSync(RAW, { recursive: true });
const idxFile = path.join(RAW, '_index.htm');
if (!fs.existsSync(idxFile)) { const b = await get(INDEX_URL); if (!b) { console.error('Could not fetch the index'); process.exit(1); } fs.writeFileSync(idxFile, b); }
const idxHtml = decodeBuffer(fs.readFileSync(idxFile));
const centres = new Map();
for (const m of idxHtml.matchAll(/alevel\/([SP]\d{4})\.HTM"[^>]*>\s*\1\s+([^<]*?)\s*</gi)) centres.set(m[1].toUpperCase(), m[2].replace(/\s+/g, ' ').trim());
centres.delete('P0001');
console.log(`${centres.size} centres in the index`);

// 2. which capture to ask for: the earliest 200-answer capture of each school page in 2004 (Wayback's list; falls back to "nearest to 2004")
const capFile = path.join(RAW, '_captures.txt');
if (!fs.existsSync(capFile)) {
  const u = 'https://web.archive.org/cdx/search/cdx?url=necta.go.tz/alevel/*&from=200408&to=200412&filter=statuscode:200&output=txt&fl=timestamp,original&limit=3000';
  const b = await get(u, 8);
  if (b) fs.writeFileSync(capFile, b);
}
const caps = new Map(); // CODE -> { ts, original }
if (fs.existsSync(capFile)) {
  for (const line of fs.readFileSync(capFile, 'utf8').split('\n')) {
    const m = /^(\d{14}) (\S+\/alevel\/([SP]\d{4})\.HTM)$/i.exec(line.trim()); if (!m) continue;
    const code = m[3].toUpperCase();
    if (!caps.has(code) || m[1] < caps.get(code).ts) caps.set(code, { ts: m[1], original: m[2] });
  }
}
console.log(`${caps.size} archived school pages found by Wayback's list`);

// 3. each school
const failed = {};
const have = (c) => fs.existsSync(path.join(DATA, `${c.toLowerCase()}.json`));
const todo = [...centres.keys()].filter((c) => !have(c));
const run = limit ? todo.slice(0, limit) : todo;
let ok = 0;
const mismatch = [];
for (const [i, code] of run.entries()) {
  const cap = caps.get(code);
  const url = cap ? `https://web.archive.org/web/${cap.ts}id_/${cap.original.replace(/^https?:\/\/(www\.)?necta\.go\.tz(:80)?/, 'http://www.necta.go.tz:80')}` : `https://web.archive.org/web/2004id_/http://www.necta.go.tz:80/alevel/${code}.HTM`;
  const rawFile = path.join(RAW, `${code}.htm`);
  let buf = fs.existsSync(rawFile) ? fs.readFileSync(rawFile) : await get(url);
  const fail = (reason, permanent) => { failed[code] = { url, reason, permanent: !!permanent, at: today() }; };
  if (buf === null) { fail('not archived (HTTP 404)', true); continue; }
  if (buf === undefined) { fail('no answer from the Internet Archive'); continue; }
  if (!fs.existsSync(rawFile)) fs.writeFileSync(rawFile, buf);
  const html = decodeBuffer(buf);
  if (!/ACSEE\s*2004/i.test(html)) { fail('the archived page is not the ACSEE 2004 page', true); continue; }
  const rec = parseLegacyCentre(html, code);
  const dup = (rec.issues || []).filter((x) => x.startsWith('duplicate candidate')).length;
  if (rec.code !== code) { fail(`heading code ${rec.code} != ${code}`, true); continue; }
  if (!rec.candidates.length) { fail('no candidates found', true); continue; }
  if (dup) { fail(`${dup} duplicate candidate number(s)`, true); continue; }
  const bad = rec.candidates.find((c) => !c.cno.startsWith(`${code}/`));
  if (bad) { fail(`candidate number ${bad.cno} does not start with ${code}/`, true); continue; }
  // the page's own division totals must agree with its rows; a difference is written into issues, never hidden
  const issues = [...(rec.issues || [])];
  const tot = rec.summary?.rows?.find((r) => r[0] === 'T');
  if (tot && rec.summary.head) {
    for (const [k, h] of rec.summary.head.entries()) {
      if (!/^(I|II|III|IV)$/.test(h)) continue;
      const n = rec.candidates.filter((c) => c.div === h).length;
      if (String(n) !== String(tot[k])) { issues.push(`division ${h}: the page says ${tot[k]}, the rows show ${n}`); mismatch.push(code); }
    }
  }
  if (!dry) writeJson(path.join(DATA, `${code.toLowerCase()}.json`), {
    exam: 'acsee-2004', category: 'ACSEE', year: 2004, kind: 'secondary', code, name: rec.name || centres.get(code), indexName: centres.get(code), region: '', district: '',
    sourceUrl: TEMPLATE(code), source: 'wayback', summary: rec.summary, overall: rec.overall || [], facts: rec.facts || [], candidates: rec.candidates, issues,
  });
  ok++;
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${run.length} processed (${ok} ok, ${Object.keys(failed).length} failed)`);
}

// 4. status files (same shape as the importer's)
const done = [...centres.keys()].filter(have).length;
const failedList = {}; for (const [c, f] of Object.entries(failed)) if (!have(c)) failedList[c] = f;
if (!dry && !limit) {
  writeJson(path.join(WORK, 'status', 'acsee-2004.json'), { id: 'acsee-2004', host: 'web.archive.org', updated: new Date().toISOString(), total: centres.size, done, failed: Object.keys(failedList).length, failedList, lastRun: { finished: new Date().toISOString(), ok, failed: Object.keys(failedList).length } });
  writeJson(path.join(WORK, 'exams', 'acsee-2004.json'), {
    id: 'acsee-2004', category: 'ACSEE', year: 2004, kind: 'secondary', sourceUrl: INDEX_URL, source: 'wayback', popular: false, importedAt: today(),
    status: done === centres.size ? 'verified' : done ? 'partial' : 'index-only', stats: { centres: centres.size, importedCentres: done },
    centres: [...centres.entries()].map(([code, name]) => ({ code, name, region: '', district: '', imported: have(code) })),
    issues: Object.entries(failedList).map(([c, f]) => `${c}: ${f.reason} (${f.url})`),
  });
}
console.log(`done: ${done}/${centres.size} centres have data, ${Object.keys(failedList).length} failed${mismatch.length ? `, ${mismatch.length} with a division total that differs from the rows (${mismatch.join(', ')})` : ''}`);
for (const [c, f] of Object.entries(failedList)) console.log(`  ${c}: ${f.reason}`);
