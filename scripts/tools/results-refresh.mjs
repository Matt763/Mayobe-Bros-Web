#!/usr/bin/env node
// One command after (or during) the crawls: packs every imported exam that is at least 97% downloaded and not packed yet, adds its
// `resultsData.datasets` entry, and rebuilds. Reads ~/necta-work (read-only), writes results-data/ (git-ignored) and site.config.json.
//   node scripts/tools/results-refresh.mjs [--repack] [--no-build]   (--repack also re-packs exams that already have a results-data folder; --no-build stops before the site build)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repack = process.argv.includes('--repack');
const statusDir = path.join(os.homedir(), 'necta-work', 'status');
const ids = [];
for (const f of fs.readdirSync(statusDir).filter((x) => x.endsWith('.json'))) {
  const s = JSON.parse(fs.readFileSync(path.join(statusDir, f), 'utf8'));
  // a centre whose page is blank at the source ("no candidates found", the same blank table when asked again) is accounted for: there is
  // nothing to download for it. CSEE 2003 has 41 of them (1,253 of 1,294 pages hold results), which kept it just under 97% for days.
  const empty = Object.values(s.failedList || {}).filter((v) => v && v.reason === 'no candidates found').length;
  const ready = s.total > 40 ? (s.done + empty) / s.total >= 0.97 : s.total > 0 && s.done === s.total;
  const folder = path.join(ROOT, 'results-data', s.id);
  // stale: packed while the download was still going (or before a retry filled gaps), so fewer centre files than the importer now holds
  const packed = fs.existsSync(path.join(folder, 'meta.json')) ? fs.readdirSync(folder).filter((x) => x.endsWith('.txt')).length : -1;
  if (ready && (repack || packed < 0 || packed < s.done)) ids.push(s.id);
}
const run = (args) => execFileSync(process.execPath, ['--no-warnings', ...args], { cwd: ROOT, stdio: 'inherit' });
// one exam at a time: an exam the packer refuses (it writes nothing for it) must not block the others
const refused = [];
if (ids.length) {
  console.log(`Packing ${ids.length}: ${ids.join(', ')}`);
  for (const id of ids) { try { run(['scripts/results-data.mjs', '--exam', id]); } catch { refused.push(id); console.log(`NOT PACKED: ${id} (see the message above; the other exams go on)`); } }
} else console.log('Nothing new to pack.');
// PSLE and SFNA: results-data.mjs rewrites meta.json, which drops the "pm": 1 switch of the PREM files, so (re)write them for every
// primary exam that is packed and whose raw pages are on disk (scripts/tools/results-prem.mjs; a year with no raw pages is skipped).
for (const id of fs.readdirSync(path.join(ROOT, 'results-data')).filter((x) => /^(psle|sfna)-\d{4}$/.test(x))) {
  const [cat, year] = id.split('-');
  if (!fs.existsSync(path.join(os.homedir(), 'necta-work', 'source', cat, year))) continue;
  try { run(['scripts/tools/results-prem.mjs', id]); } catch { console.log(`PREM files of ${id}: skipped (no school pages with a PREM column, or the tool failed)`); }
}
if (refused.length) console.log(`Packer refused: ${refused.join(', ')}`);
run(['scripts/tools/sync-results-datasets.mjs']);
if (process.argv.includes('--no-build')) console.log('Skipped the build (--no-build): run node scripts/build.mjs next.'); else run(['scripts/build.mjs']);
