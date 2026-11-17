// Parsers for NECTA's FTNA (Form Two) and SFNA (Standard Four) pages on onlinesys.necta.go.tz, 2022 to 2025.
// Checked on 2026-11-10 against real pages (FTNA 2022 to 2025, a private centre in 2024 and 2025; SFNA 2022 to 2025),
// see scripts/tests/fixtures/ftna-sfna/. Both records have exactly the shape of the existing parsers, so buildRecord,
// validateCentre and the packer take them: FTNA like parseSecondaryCentre, SFNA like parsePsleSchool.
//
// FTNA (exam id ftna-<year>; secondary kind, candidate numbers S0101/0001)
//  - The walk is ONE flat index (`ftna.htm`, links `results/S0101.htm`, `results/P0110.htm`) -> centre pages. P is a private centre.
//    The link text is the name only (2022, 2023, 2025) or `CODE  NAME` (2024); parseFtnaIndex reads the code from the link and
//    drops a leading code from the text. parseExamIndex does NOT work on 2022, 2023 and 2025 (no code in the text).
//  - The centre page is the new-style CSEE page, with two differences that break parseSecondaryCentre: the heading reads
//    `S0101 - NAME` (the CSEE name would keep a leading "- "), and every candidate row after the header has NO opening <tr>
//    (`</tr><td>...`), so the shared rows() sees the header only. Rows are therefore cut at </tr> here.
//  - Columns CNO, PReM NO, SEX, AGGT, DIV, DETAILED SUBJECTS. PReM NO (11 or 12 digits, empty for private centres) is never read.
//  - The cell reads `CIV-'C' HIST-'B' ...` (no spaces around the dash). The packer rebuilds a cell as `CIV - 'C' HIST - 'B'`, so
//    subjectsRaw is written in that form (same words and letters, only the spaces around the dash differ).
//  - Absent candidates: `ABS` with empty AGGT and DIV. Kept as a marker row: aggt '-', div '-', subjectsRaw 'ABS', subjects [].
//    DIV can also be REFERRED (a division word the packer already stores as an exception).
//  - The "EXAMINATION CENTRE RANKING" block (region, passed, centre GPA, division table, subject table) goes to `overall` exactly
//    as the CSEE parser does it (same kv/grid blocks, which is what the packer's secondary template expects). Private centres
//    carry it in 2024 and not in 2025; a page without it just has overall [].
//  - No `facts` (like parseSecondaryCentre).
//
// SFNA (exam id sfna-<year>; primary kind, candidate numbers PS0101114-0001)
//  - The walk is index (`sfna.htm`, links `results/reg_ps01.htm`) -> `distr_ps0101.htm` -> `ps0101114.htm` (NO shl_ prefix).
//    parseRegions, parseDistricts and parseSchools read none of these; parseSfnaRegions/Districts/Schools do.
//  - The header lines (sat, school average, DARAJA) become `facts` exactly like parsePsleSchool (same labels, same values, so the
//    packer's lf/level table works unchanged). The grade table JINSI x A..D, REFERRED (rows WAS = girls, WAV = boys, JUMLA)
//    is `summary`; the "UFAULU WA MASOMO KATIKA MAKUNDI YA UMAHIRI" table is `overall` (same 9 columns as PSLE; its first column
//    holds a subject code like A06 instead of 1, 2, 3, which the packer stores as patches).
//  - The SUBJECTS cell is `JIO & SANAA - B HIST.TZ - B ... AVERAGE GRADE - B` (spaces, not commas). subjectsRaw is written in the
//    packer's form (`name - G, name - G`). 2025 names: JIO & SANAA, HIST.TZ, KISWAHILI, ENGLISH, HISABATI, SAYANSI; 2022 to 2024:
//    KISWAHILI, ENGLISH, MAARIFA YA JAMII, HISABATI, SAYANSI NA TEKNOLOJIA, URAIA NA MAADILI. The last pair is AVERAGE GRADE.
//  - The AVERAGE GRADE can be the word REFERRED (several letters; the packer takes one character). Default (opts.referred 'note'):
//    such a row is kept as a marker row whose note is the published text, so the app shows it unchanged and the packer needs no
//    change. opts.referred 'code' writes the average as 'R' instead (all grades stay searchable, but the app must explain R).
//
// Privacy (owner's decision): PREM NO and any NAME column are recognised by their header and never read, so they cannot reach the
// record, an issue message or a fixture. The output is plain data, never markup.
import { anchors, tables, text } from './necta-parse.mjs';

/** Rows of a table cut at <tr> OR </tr> (FTNA rows have no opening <tr>, and the last one can end `</tr</tr>>`), cells are <td> or <th>. */
function rowsAny(tableHtml) {
  const out = [];
  for (const chunk of tableHtml.split(/<TR\b[^>]*>|<\/TR\b[^>]*>?/i)) {
    if (!/<T[DH]\b/i.test(chunk)) continue;
    const cells = [];
    const re = /<T[DH]\b[^>]*>([\s\S]*?)(?=<T[DH]\b|$)/gi;
    let m;
    while ((m = re.exec(chunk))) cells.push(text(m[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}

/** Sections published after the candidate table, kept as published (same blocks as the CSEE and PSLE parsers). */
function blocksFromRows(r) {
  const out = [];
  let rest = r;
  while (rest.length && rest[0].length === 1) { if (rest[0][0]) out.push({ t: 'h', v: rest[0][0] }); rest = rest.slice(1); }
  if (!rest.length) return out;
  if (rest.every((x) => x.length === 2)) out.push({ t: 'kv', rows: rest });
  else out.push({ t: 'grid', head: rest[0], rows: rest.slice(1) });
  return out;
}

/** A table that holds names, PREM numbers or candidate numbers must not be kept as a block. */
function looksPersonal(r) {
  return r.some((row, i) => (i === 0 && row.some((c) => /^(CANDIDATE NAME|CANDIDATE|NAME|JINA|JINA LA .*|.*PREM.*|CAND\.? ?.*|CNO)$/i.test(c))) || row.some((c) => /^\d{9,}$/.test(c) || /^[A-Z]{1,2}\d{4,9}[/-]\d+$/i.test(c)));
}

/** Only a candidate number's own text may go into a note, never another cell of the row. */
const rowNote = (row, n) => (/^[A-Za-z]{1,2}\d{4,9}[/-]\d{1,5}$/.test(row[0] || '') ? `row ${n} (${row[0].toUpperCase()})` : `row ${n}`);

const headingOf = (html) => { const h = /<H3[^>]*>([\s\S]*?)<\/H3>/i.exec(html); return h ? text(h[1]) : ''; };

/** Which header text means which column. Name and PREM columns are recognised only to be skipped. */
function columnsOf(head) {
  const col = { cno: -1, sex: -1, aggt: -1, div: -1, subjects: -1 };
  head.forEach((h, i) => {
    const t = h.toUpperCase();
    if (/PREM/.test(t) || /NAME|JINA/.test(t) && !/SUBJECT/.test(t)) return; // never read
    if (/^(CNO|CAND)/.test(t) && col.cno < 0) col.cno = i;
    else if (/^(SEX|JINSI)/.test(t) && col.sex < 0) col.sex = i;
    else if (/^AGG/.test(t) && col.aggt < 0) col.aggt = i;
    else if (/^DIV/.test(t) && col.div < 0) col.div = i;
    else if (/^(DETAILED|SUBJECT|SOMO|MASOMO)/.test(t) && col.subjects < 0) col.subjects = i;
  });
  return col;
}

// ------------------------------------------------------------------------------------------ FTNA

/** FTNA index -> { centres: [{ code, name, href }], issues }. The code comes from the link, a leading code in the text is dropped. */
export function parseFtnaIndex(html) {
  const centres = [];
  const seen = new Set();
  const issues = [];
  for (const a of anchors(html)) {
    const m = /^(?:\.?\/)?(?:results\/)?([a-z]{1,2}\d{4,9})\.htm$/i.exec(a.href);
    if (!m) continue;
    const code = m[1].toUpperCase();
    let name = a.label;
    if (name.toUpperCase().startsWith(code + ' ')) name = name.slice(code.length).trim();
    if (!name) { issues.push(`empty name: ${code}`); continue; }
    if (seen.has(code)) { issues.push(`duplicate centre ${code}`); continue; }
    seen.add(code);
    centres.push({ code, name, href: a.href });
  }
  if (!centres.length) issues.push('no centres found');
  return { centres, issues };
}

/** `CIV-'C' HIST-'B'` -> { pairs, raw } where raw is the packer's form `CIV - 'C' HIST - 'B'`; pairs is [] unless nothing was left over. */
export function parseFtnaSubjects(s) {
  const pairs = [];
  const re = /([A-Z0-9][A-Z0-9 /.&()+-]*?)\s*-\s*'([^'\s])'/gi;
  let m;
  while ((m = re.exec(s))) pairs.push([m[1].trim(), m[2].trim()]);
  const compact = pairs.map(([n, g]) => `${n}-'${g}'`).join(' ');
  const ok = pairs.length && compact === s.replace(/\s+/g, ' ').trim().replace(/\s*-\s*'/g, "-'");
  return ok ? { pairs, raw: pairs.map(([n, g]) => `${n} - '${g}'`).join(' ') } : { pairs: [], raw: s };
}

/** FTNA centre page -> the record parseSecondaryCentre returns. Nothing throws; problems go to `issues`. */
export function parseFtnaCentre(html, expectCode) {
  const issues = [];
  const heading = headingOf(html);
  const m = /^([A-Z]{1,2}\d{4,9})\s*(?:-\s*)?(.*)$/i.exec(heading);
  const code = m ? m[1].toUpperCase() : null;
  const want = expectCode ? String(expectCode).toUpperCase() : null;
  if (!code) issues.push('no centre heading');
  else if (want && code !== want) issues.push(`heading code ${code} != ${want}`);
  let summary = null;
  const candidates = [];
  const overall = [];
  let afterCand = false;
  const seen = new Set();
  let n = 0;
  for (const t of tables(html)) {
    const r = rowsAny(t);
    if (!r.length) continue;
    if (afterCand) {
      if (looksPersonal(r)) issues.push('skipped a table after the candidates');
      else overall.push(...blocksFromRows(r));
      continue;
    }
    if (/^SEX$/i.test(r[0][0]) && !summary) summary = { head: r[0], rows: r.slice(1) };
    if (/^CNO$/i.test(r[0][0])) {
      afterCand = true;
      const col = columnsOf(r[0]);
      if ([col.cno, col.sex, col.aggt, col.div, col.subjects].some((i) => i < 0)) { issues.push('unknown candidate columns'); continue; }
      for (const row of r.slice(1)) {
        n++;
        const cell = (i) => row[i] || '';
        const mc = /^([A-Z]{1,2}\d{4,9})\/(\d+)$/i.exec(cell(col.cno));
        if (row.length < r[0].length - 1 || !mc) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
        const cno = `${mc[1].toUpperCase()}/${mc[2]}`;
        if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
        seen.add(cno);
        const pre = (code || want || '') + '/';
        if (pre !== '/' && !cno.startsWith(pre)) issues.push(`candidate number ${cno} is not under ${pre.slice(0, -1)}`);
        const sex = cell(col.sex).toUpperCase();
        if (!/^[MF]$/.test(sex)) issues.push(`unknown sex in ${rowNote(row, n)}`);
        const raw = cell(col.subjects);
        const aggt = cell(col.aggt) || '-';
        const div = cell(col.div) || '-';
        const sub = parseFtnaSubjects(raw);
        if (!sub.pairs.length && !/^ABS$/i.test(raw)) issues.push(`subjects not read in ${rowNote(row, n)}`);
        // a sex cell that is not M or F is not copied; the packer then stops on the empty value
        candidates.push({ cno, sex: /^[MF]$/.test(sex) ? sex : '', aggt, div, subjectsRaw: sub.raw, subjects: sub.pairs });
      }
    }
  }
  if (!candidates.length) issues.push('no candidates found');
  return { code, name: m ? m[2].trim() : '', summary, overall, candidates, issues };
}

// ------------------------------------------------------------------------------------------ SFNA

export function parseSfnaRegions(html) {
  return anchors(html).map((a) => { const m = /(?:^|\/)(reg_ps\d+)\.htm$/i.exec(a.href); return m && { href: a.href, file: m[1].toLowerCase() + '.htm', name: a.label }; }).filter(Boolean);
}
export function parseSfnaDistricts(html) {
  return anchors(html).map((a) => { const m = /(?:^|\/)(distr_ps\d+)\.htm$/i.exec(a.href); return m && { href: a.href, file: m[1].toLowerCase() + '.htm', name: a.label }; }).filter(Boolean);
}
/** District page -> schools { code, name, href, file } (same shape as parseSchools; the file is `ps0101114.htm`, no shl_). */
export function parseSfnaSchools(html) {
  const out = [];
  for (const a of anchors(html)) {
    const m = /(?:^|\/)(ps\d{4,9})\.htm$/i.exec(a.href);
    if (!m) continue;
    const name = a.label.replace(/\s*-\s*PS\d+\s*$/i, '').trim();
    if (name) out.push({ code: m[1].toUpperCase(), name, href: a.href, file: m[1].toLowerCase() + '.htm' });
  }
  return out;
}

/**
 * `JIO & SANAA - B HIST.TZ - B ... AVERAGE GRADE - REFERRED` -> pairs (the grade of a pair is one letter, or the word REFERRED), or []
 * when the text is not exactly a run of `name - grade` pairs.
 */
export function parseSfnaSubjects(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  const pairs = [];
  const re = /(\S.*?) - (REFERRED|[A-Z])(?= \S|$)/g;
  let m;
  while ((m = re.exec(t))) pairs.push([m[1].trim(), m[2]]);
  const plain = pairs.every(([n]) => /^[A-Za-z0-9][A-Za-z0-9 &./()+,:'-]*$/.test(n));
  return pairs.length && plain && pairs.map(([n, g]) => `${n} - ${g}`).join(' ') === t ? pairs : [];
}

const FACT_NOTE = /^[A-Za-z0-9][A-Za-z0-9 .,()/%+-]{0,59}$/;

/**
 * SFNA school page -> the record parsePsleSchool returns (code, name, facts, summary, overall, candidates, issues).
 * opts.referred: 'note' (default) keeps a candidate whose AVERAGE GRADE is REFERRED as a marker row with the published text;
 * 'code' writes that average as 'R'.
 */
export function parseSfnaSchool(html, expectCode, opts = {}) {
  const referred = opts.referred === 'code' ? 'code' : 'note';
  const issues = [];
  const heading = headingOf(html);
  const m = /^(.*?)\s*-\s*(PS\d+)$/i.exec(heading);
  const code = m ? m[2].toUpperCase() : null;
  const name = m ? m[1] : heading;
  const want = expectCode ? String(expectCode).toUpperCase() : null;
  if (!code) issues.push('no school heading');
  else if (want && code !== want) issues.push(`heading code ${code} != ${want}`);

  // the lines above the grade table; only the part before it is searched
  const top = html.slice(0, Math.max(0, html.search(/MADARAJA YA UFAULU|<TABLE CLASS|CAND\. NO/i)) || undefined);
  const facts = [];
  const sat = /WALIOFANYA MTIHANI\s*:\s*(\d+)/i.exec(top); if (sat) facts.push(['WALIOFANYA MTIHANI', sat[1]]);
  const avg = /WASTANI WA SHULE\s*:\s*([\d.]+)/i.exec(top); if (avg) facts.push(['WASTANI WA SHULE', avg[1]]);
  const dar = /DARAJA\s+([A-E][^<]*)/i.exec(top);
  if (dar) { const v = text(dar[0]); if (FACT_NOTE.test(v)) facts.push(['DARAJA', v]); }

  let summary = null;
  const candidates = [];
  const overall = [];
  let afterCand = false;
  const seen = new Set();
  let n = 0;
  for (const t of tables(html)) {
    const r = rowsAny(t);
    if (!r.length) continue;
    if (afterCand) {
      if (looksPersonal(r)) issues.push('skipped a table after the candidates');
      else overall.push(...blocksFromRows(r));
      continue;
    }
    if (/^JINSI$/i.test(r[0][0]) && !summary) summary = { head: r[0], rows: r.slice(1) };
    if (/^CAND/i.test(r[0][0])) {
      afterCand = true;
      const col = columnsOf(r[0]);
      if (col.cno < 0 || col.sex < 0 || col.subjects < 0) { issues.push('unknown candidate columns'); continue; }
      for (const row of r.slice(1)) {
        n++;
        const cell = (i) => row[i] || '';
        const mc = /^(PS\d+)-(\d+)$/i.exec(cell(col.cno));
        if (row.length < r[0].length - 1 || !mc) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
        const cno = `${mc[1].toUpperCase()}-${mc[2]}`;
        if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
        seen.add(cno);
        const pre = (code || want || '') + '-';
        if (pre !== '-' && !cno.startsWith(pre)) issues.push(`candidate number ${cno} is not under ${pre.slice(0, -1)}`);
        const sex = cell(col.sex).toUpperCase();
        if (!/^[MF]$/.test(sex)) issues.push(`unknown sex in ${rowNote(row, n)}`);
        const pub = cell(col.subjects).replace(/\s+/g, ' ').trim();
        let pairs = parseSfnaSubjects(pub);
        let raw = pub;
        if (pairs.length) {
          if (!/AVERAGE/i.test(pairs[pairs.length - 1][0])) issues.push(`no average grade in ${rowNote(row, n)}`);
          const last = pairs[pairs.length - 1];
          if (last[1] === 'REFERRED') {
            if (referred === 'code') { last[1] = 'R'; raw = pairs.map(([a, b]) => `${a} - ${b}`).join(', '); } // R = REFERRED
            else pairs = []; // marker row: the published text is the note
          } else raw = pairs.map(([a, b]) => `${a} - ${b}`).join(', ');
          if (pairs.some(([, g]) => g === 'REFERRED')) { issues.push(`REFERRED outside the average in ${rowNote(row, n)}`); pairs = []; raw = pub; }
        } else if (pub && !/^(ABS|\*[A-Z]+|-+)$/i.test(pub)) issues.push(`subjects not read in ${rowNote(row, n)}`);
        candidates.push({ cno, sex: /^[MF]$/.test(sex) ? sex : '', subjectsRaw: raw, subjects: pairs });
      }
    }
  }
  if (!candidates.length) issues.push('no candidates found');
  return { code, name, facts, summary, overall, candidates, issues };
}
