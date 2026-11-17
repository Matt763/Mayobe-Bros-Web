// results-data/registry.json: which exam-years exist, for the Worker (results-worker/) that renders the indexable pages.
//   { v: 1, exams: [{ id, cat, year, kind, verified, total, online, key, src, thin }] }
// `thin` lists (comma separated, lower case) the centres that have a file but fewer than MIN_SAT candidates who sat: the Worker keeps
// their year page out of search engines and out of the sitemaps without reading every file. `src` is the host of the source address.
import fs from 'node:fs';
import path from 'node:path';
import { decodeHeader } from '../../js/results-codec.js';

export const MIN_SAT = 20;

export function buildRegistry(dir) {
  const exams = [];
  for (const id of fs.readdirSync(dir).sort()) {
    const m = /^(csee|acsee|psle|ftna|sfna|dsee|dpee|dppee|dspee|dte|qt)-(\d{4})$/.exec(id);
    const metaFile = path.join(dir, id, 'meta.json');
    if (!m || !fs.existsSync(metaFile)) continue;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const thin = [];
    for (const f of fs.readdirSync(path.join(dir, id))) {
      if (!f.endsWith('.txt')) continue;
      const h = decodeHeader(fs.readFileSync(path.join(dir, id, f), 'utf8'));
      if (h.n - h.absent < MIN_SAT) thin.push(f.slice(0, -4));
    }
    let src = '';
    try { src = new URL(String(meta.ut).replace('{c}', 'x')).hostname; } catch { /* no template */ }
    exams.push({ id, cat: m[1], year: Number(m[2]), kind: meta.kind, verified: meta.verified, total: meta.total, online: meta.online, key: meta.key, src, thin: thin.sort().join(',') });
  }
  return { v: 1, exams };
}

export function writeRegistry(dir) {
  const text = JSON.stringify(buildRegistry(dir));
  const file = path.join(dir, 'registry.json');
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  if (old !== text) fs.writeFileSync(file, text);
  return text.length;
}
