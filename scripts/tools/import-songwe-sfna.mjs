// Imports the Songwe-region schools of SFNA 2016 to 2021 that the normal importer refuses.
//
// Why they are refused: the Maktaba mirror files these schools under their NEW code (PS31xxxxx) but the page itself prints the
// FORMER code (PS10xxxxx, Mbeya region) in its heading, so "heading code != code" stops the importer. Districts were also renumbered
// (PS3103001 is PS1006001), so no code rule can map them. This tool therefore accepts a page ONLY when
//   1. the school name in the page heading equals the name the mirror's own index gives that code for that year, AND
//   2. it equals the name NECTA's own 2022 results give that code (results-data/sfna-2022/list.json), allowing only the
//      wording differences "ENGLISH MEDIUM" and "PRE &" (checked by hand on 2018 and 2021),
//   3. the page has candidates, no duplicate numbers, every number under the one former code printed in the heading, and that
//      former code is used by no other accepted school of the year.
// Candidate numbers stay as the page published them (former code prefix). No name of a pupil is read (the parser never does).
// Anything that fails a check stays "not on this site". Raw pages come from the importer's cache (~/necta-work/source): no network.
//
//   node scripts/tools/import-songwe-sfna.mjs            (dry run: prints what would be accepted and why the rest is refused)
//   node scripts/tools/import-songwe-sfna.mjs --write    (writes ~/necta-work/data/sfna/<year>/<code>.json and updates the exam files)
//   --years 2018,2021   limit the years
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseSfnaOldSchool } from '../lib/necta-parse-ftna-sfna-old.mjs';
import { buildRecord } from '../necta-import.mjs';
import { decodeList } from '../../js/results-codec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = path.join(os.homedir(), 'necta-work');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const yi = args.indexOf('--years');
const YEARS = (yi >= 0 ? args[yi + 1].split(',') : ['2016', '2017', '2018', '2019', '2020', '2021']).map(Number);

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
/** The comparison form: only the two known wording differences are forgiven. */
const key = (s) => norm(s).replace(/\bENGLISH MEDIUM\b/g, '').replace(/\bPRE & PRIMARY\b/g, 'PRIMARY').replace(/\s+/g, ' ').trim();

const list22 = decodeList(JSON.parse(fs.readFileSync(path.join(ROOT, 'results-data/sfna-2022/list.json'), 'utf8')), 'primary');
const name22 = new Map(list22.map((r) => [r[0], r[1]]));

let totalAccepted = 0;
for (const year of YEARS) {
  const id = `sfna-${year}`;
  const exFile = path.join(WORK, 'exams', `${id}.json`);
  const ex = JSON.parse(fs.readFileSync(exFile, 'utf8'));
  const dataDir = path.join(WORK, 'data', 'sfna', String(year));
  const srcDir = path.join(WORK, 'source', 'sfna', String(year));
  const todo = ex.centres.filter((c) => /^PS31/.test(c.code) && !fs.existsSync(path.join(dataDir, c.code.toLowerCase() + '.json')));
  const accepted = [];
  const refused = {};
  const usedOld = new Map();
  const why = (r) => { refused[r] = (refused[r] || 0) + 1; };
  for (const c of todo) {
    const f = path.join(srcDir, c.code.toLowerCase() + '.htm.gz');
    if (!fs.existsSync(f)) { why('page not in the cache'); continue; }
    const html = zlib.gunzipSync(fs.readFileSync(f)).toString('latin1');
    let rec = parseSfnaOldSchool(html, null);
    if (rec.code && !rec.candidates.length) {
      // SFNA 2021 pages of these schools print the number without its dash (PS10020010001): when a number is exactly the printed code
      // followed by four digits, the dash is put back, nothing else changes
      const fixed = html.replace(new RegExp(`<td>(${rec.code})(\\d{4})</td>`, 'gi'), '<td>$1-$2</td>');
      if (fixed !== html) rec = parseSfnaOldSchool(fixed, null);
    }
    if (!rec.code || !rec.name) { why('no heading'); continue; }
    if (!rec.candidates.length) { why('no candidates'); continue; }
    if (rec.code === c.code) { why('heading already equals the code (normal importer handles it)'); continue; }
    if (key(rec.name) !== key(c.name)) { why('heading name differs from the mirror index name'); continue; }
    const n22 = name22.get(c.code);
    if (!n22) { why('code not in NECTA 2022'); continue; }
    if (key(rec.name) !== key(n22)) { why('heading name differs from NECTA 2022 name for this code'); continue; }
    const bad = rec.issues.filter((i) => !/^heading code /.test(i));
    if (bad.length) { why('parser notes: ' + bad[0].slice(0, 40)); continue; }
    const prefix = rec.code + '-';
    if (!rec.candidates.every((x) => x.cno.startsWith(prefix))) { why('candidate numbers not all under the printed code'); continue; }
    if (new Set(rec.candidates.map((x) => x.cno)).size !== rec.candidates.length) { why('duplicate candidate numbers'); continue; }
    if (usedOld.has(rec.code)) { why('former code claimed twice'); continue; }
    usedOld.set(rec.code, c.code);
    rec.issues = [...rec.issues.filter((i) => !/^heading code /.test(i)), `filed under ${c.code} by the source; the page prints the former code ${rec.code}, and the school name matches NECTA's 2022 name for ${c.code}`];
    accepted.push({ c, rec });
  }
  console.log(`${id}: ${todo.length} Songwe pages to look at, ${accepted.length} accepted, refused:`, JSON.stringify(refused));
  totalAccepted += accepted.length;
  if (!WRITE || !accepted.length) continue;
  fs.mkdirSync(dataDir, { recursive: true });
  const url = (code) => `https://maktaba.tetea.org/exam-results/SFNA${year}/${code.toLowerCase()}.htm`;
  for (const { c, rec } of accepted) {
    const out = buildRecord({ id, category: 'SFNA', year, kind: 'primary', source: 'maktaba' }, c, rec, url(c.code));
    out.formerCode = rec.code;
    fs.writeFileSync(path.join(dataDir, c.code.toLowerCase() + '.json'), JSON.stringify(out));
  }
  const ok = new Set(accepted.map((a) => a.c.code));
  for (const c of ex.centres) if (ok.has(c.code)) c.imported = true;
  ex.stats.importedCentres = ex.centres.filter((c) => c.imported).length;
  ex.status = ex.stats.importedCentres === ex.stats.centres ? 'verified' : 'partial';
  ex.issues = (ex.issues || []).filter((i) => !ok.has(String(i).split(':')[0]));
  fs.writeFileSync(exFile, JSON.stringify(ex));
  const stFile = path.join(WORK, 'status', `${id}.json`);
  const st = JSON.parse(fs.readFileSync(stFile, 'utf8'));
  for (const code of ok) delete st.failedList[code];
  st.failed = Object.keys(st.failedList).length;
  st.done = ex.stats.importedCentres;
  fs.writeFileSync(stFile, JSON.stringify(st));
}
console.log(WRITE ? `written: ${totalAccepted} schools` : `dry run: ${totalAccepted} schools would be written (add --write)`);
