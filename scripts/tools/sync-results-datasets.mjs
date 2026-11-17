#!/usr/bin/env node
// Adds a `resultsData.datasets` entry to site.config.json for every exam folder in results-data/ that has no entry yet
// and that is at least 97% downloaded (the entry is what turns a results post from "being added" into the search app). Existing entries are never changed.
//   node scripts/tools/sync-results-datasets.mjs [--dry]
// `official` = NECTA's own results list for that exam (https://www.necta.go.tz/results/view/<exam>), or, for the 2026 diploma exams that
// only matokeo.necta.go.tz publishes, their index page. Remove an exam from `resultsData.unavailable` if it is there and now has data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry');
const cfgFile = path.join(ROOT, 'site.config.json');
let text = fs.readFileSync(cfgFile, 'utf8');
const cfg = JSON.parse(text);
const have = new Set(Object.keys(cfg.resultsData.datasets || {}));
const MATOKEO_ONLY = /^(dpee|dppee|dspee)-/;

const ids = fs.readdirSync(path.join(ROOT, 'results-data'))
  .filter((d) => /^[a-z]+-\d{4}$/.test(d) && fs.existsSync(path.join(ROOT, 'results-data', d, 'meta.json')) && !have.has(d))
  .filter((d) => {
    // a page backed by a handful of test centres would look broken: wait until at least 97% of the centres have their results
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'results-data', d, 'meta.json'), 'utf8'));
    // a centre whose page is blank at the source ("no candidates found") has nothing to download, so it counts as accounted for
    // (same rule as results-refresh.mjs; CSEE 2003 has 1,253 pages with results and 41 blank ones)
    let empty = 0;
    try { empty = Object.values(JSON.parse(fs.readFileSync(path.join(os.homedir(), 'necta-work', 'status', `${d}.json`), 'utf8')).failedList || {}).filter((v) => v && v.reason === 'no candidates found').length; } catch { /* no status file: no blank pages counted */ }
    const ok = m.total > 0 && (m.online + empty) / m.total >= 0.97;
    if (!ok) console.log(`skipped ${d}: ${m.online} of ${m.total} centres have results so far`);
    return ok;
  })
  .sort();
if (!ids.length) { console.log('Nothing to add.'); process.exit(0); }

const lines = ids.map((id) => {
  const [cat, year] = id.split('-');
  const official = MATOKEO_ONLY.test(id) ? `https://matokeo.necta.go.tz/results/${year}/${cat}/index.htm` : `https://www.necta.go.tz/results/view/${cat}`;
  return `      "${id}": { "official": "${official}" }`;
});
const open = text.indexOf('"datasets": {');
if (open < 0) throw new Error('No "datasets" block in site.config.json');
const close = text.indexOf('\n    }', open);
const before = text.slice(0, close).replace(/\s*$/, '');
text = `${before},\n${lines.join(',\n')}${text.slice(close)}`;
JSON.parse(text); // must still be valid
// exams that now have data are no longer "unavailable"
const un = cfg.resultsData.unavailable || [];
const stillUn = un.filter((id) => !ids.includes(id));
if (stillUn.length !== un.length) text = text.replace(/"unavailable": \[[^\]]*\]/, `"unavailable": [${stillUn.map((x) => `"${x}"`).join(', ')}]`);
JSON.parse(text);
console.log(`${dry ? 'Would add' : 'Added'} ${ids.length}: ${ids.join(', ')}`);
if (!dry) fs.writeFileSync(cfgFile, text);
