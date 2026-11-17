// PREM NO of PSLE and SFNA pupils, as NECTA printed it next to the candidate number (owner's decision, 2026-11-10: "do it the way NECTA did").
// NECTA's 2025 school pages have CAND. NO, PREM NO, SEX and SUBJECTS and no name column; older pages (2021 and before) also have a name.
// Only the CAND. NO and PREM NO columns are read, found by their header text. A name column is never read, so a name cannot reach the
// output. The values are kept apart from the results: one <lowercode>.pm file per school (see scripts/tools/results-prem.mjs), loaded by
// the interactive results page only (never by the Worker's pages meant for search engines).
//
//   packed text = 8 base-36 characters for every sequence number from 1 to the last one; a gap (no candidate, no PREM) is "00000000".
//   js/results-codec.js has the matching unpackPrem().
import { rows, tables, text } from './necta-parse.mjs';

const PREM_RE = /^\d{11}$/;                 // every PREM NO NECTA prints has 11 digits; anything else is left out and counted
const SLOT = 8;                              // 36 ** 8 = 2.8e12, above the largest 11-digit number

function columns(head) {
  const col = { cno: -1, prem: -1 };
  head.forEach((h, i) => {
    const t = String(h).toUpperCase();
    if (/NAME|JINA/.test(t) && !/PREM/.test(t)) return; // never read
    if (/PREM/.test(t) && col.prem < 0) col.prem = i;
    else if (/^CAND/.test(t) && col.cno < 0) col.cno = i;
  });
  return col;
}

/** { code, hasPrem, prem: Map(sequence number -> 11 digits), skipped } for one school page. */
export function extractPrem(html) {
  const h = /<H3[^>]*>([\s\S]*?)<\/H3>/i.exec(html) || /<H2[^>]*>([\s\S]*?)<\/H2>/i.exec(html);
  const m = h ? /(PS\d+)\s*$/i.exec(text(h[1])) : null;
  const out = { code: m ? m[1].toUpperCase() : null, hasPrem: false, prem: new Map(), skipped: 0 };
  for (const t of tables(html)) {
    const r = rows(t);
    if (!r.length || !/^CAND/i.test(r[0][0])) continue;
    const col = columns(r[0]);
    if (col.cno < 0 || col.prem < 0) return out;
    out.hasPrem = true;
    for (const row of r.slice(1)) {
      const cno = /^[A-Z]{1,2}\d+-(\d+)$/i.exec(row[col.cno] || '');
      if (!cno) continue;
      const v = row[col.prem] || '';
      if (PREM_RE.test(v)) out.prem.set(parseInt(cno[1], 10), v); else out.skipped++;
    }
    return out;
  }
  return out;
}

/** Map(sequence -> 11 digits) -> the text of a .pm file. */
export function packPrem(map) {
  let last = 0;
  for (const k of map.keys()) last = Math.max(last, k);
  let s = '';
  for (let i = 1; i <= last; i++) s += map.has(i) ? Number(map.get(i)).toString(36).padStart(SLOT, '0') : '0'.repeat(SLOT);
  return s;
}
