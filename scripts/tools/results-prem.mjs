#!/usr/bin/env node
// Writes the PREM NO files of a primary exam (PSLE, SFNA) next to its results data, from the raw school pages the importer kept.
//   node scripts/tools/results-prem.mjs psle-2025 [--work ~/necta-work] [--out results-data] [--dry]
// Reads ~/necta-work/source/<cat>/<year>/**/shl_<code>.htm.gz, takes only the CAND. NO and PREM NO columns (a name column is never read,
// see scripts/lib/necta-prem.mjs) and writes results-data/<exam>/<code>.pm for every school whose results file is there. Then it checks every
// pupil of the packed school against its PREM number and, when at least 98% have one, sets "pm": 1 in meta.json: that flag is what makes the
// results page load the files. Run it again after `node scripts/results-data.mjs` (which rewrites meta.json) and after new pages arrive.
// NECTA's 2025 pages carry PREM NO and no name; the 2021 pages also carry a name, which stays unread. Upload the .pm files with the rest of
// results-data (R2). The Worker's pages for search engines never load them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeBuffer } from '../lib/necta-parse.mjs';
import { extractPrem, packPrem } from '../lib/necta-prem.mjs';
import { decodeCentre, unpackPrem } from '../../js/results-codec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const exam = argv.find((a) => /^[a-z]+-\d{4}$/.test(a));
if (!exam) { console.error('usage: node scripts/tools/results-prem.mjs <exam>, for example psle-2025'); process.exit(2); }
const dry = argv.includes('--dry');
const work = path.resolve(opt('--work', path.join(os.homedir(), 'necta-work')));
const out = path.resolve(opt('--out', path.join(ROOT, 'results-data')));
const [cat, year] = exam.split('-');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (/^shl_.*\.htm\.gz$/i.test(e.name)) yield p;
  }
}

const srcDir = path.join(work, 'source', cat, year);
const dataDir = path.join(out, exam);
if (!fs.existsSync(srcDir)) { console.error(`no raw pages in ${srcDir}`); process.exit(1); }
if (!fs.existsSync(path.join(dataDir, 'meta.json'))) { console.error(`${exam} is not packed yet: run node scripts/results-data.mjs --exam ${exam}`); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));

let pages = 0, withPrem = 0, noColumn = 0, noCentre = 0, pupils = 0, covered = 0, skipped = 0, written = 0;
for (const file of walk(srcDir)) {
  pages++;
  const key = /^shl_(.*)\.htm\.gz$/i.exec(path.basename(file))[1].toLowerCase();
  const centreFile = path.join(dataDir, `${key}.txt`);
  if (!fs.existsSync(centreFile)) { noCentre++; continue; }
  const r = extractPrem(decodeBuffer(zlib.gunzipSync(fs.readFileSync(file))));
  skipped += r.skipped;
  if (!r.hasPrem) { noColumn++; continue; }
  withPrem++;
  const packed = packPrem(r.prem);
  const rec = decodeCentre(fs.readFileSync(centreFile, 'utf8'), meta, key.toUpperCase());
  for (const c of rec.candidates) { pupils++; if (unpackPrem(packed, String(c.cno).split(/[\/-]/).pop())) covered++; }
  if (!dry) { fs.writeFileSync(path.join(dataDir, `${key}.pm`), packed); written++; }
}
const pct = pupils ? (100 * covered) / pupils : 0;
// all or nothing per year: the page asks for a .pm file for every school it opens, so the switch goes on only when nearly every packed
// school has one (PSLE 2023 has raw pages for 17 of 18,316 schools: it stays without PREM numbers, like PSLE 2013 to 2020)
const packedSchools = fs.readdirSync(dataDir).filter((f) => f.endsWith('.txt')).length;
const schoolPct = packedSchools ? (100 * withPrem) / packedSchools : 0;
console.log(`${exam}: ${pages} raw pages, ${noCentre} not in the results data, ${noColumn} without a PREM column, ${withPrem} with PREM NO`);
console.log(`${pupils} pupils in those schools, ${covered} with a number (${pct.toFixed(2)}%), ${skipped} odd values left out, ${written} files written${dry ? ' (dry run)' : ''}`);
if (!dry && withPrem && pct >= 98 && schoolPct >= 95) {
  meta.pm = 1;
  fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(meta));
  console.log('meta.json: pm = 1 (the results page will load the PREM files)');
} else if (!dry) {
  // a year that does not qualify has no PREM numbers at all: drop the switch and any partial files so the page never asks for them
  for (const f of fs.readdirSync(dataDir)) if (f.endsWith('.pm')) fs.unlinkSync(path.join(dataDir, f));
  if (meta.pm) { delete meta.pm; fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(meta)); }
  console.log(`no PREM numbers for ${exam}: ${pct.toFixed(2)}% of the pupils and ${schoolPct.toFixed(1)}% of the schools have one (needs 98% and 95%); the page shows the results without a PREM column`);
}
