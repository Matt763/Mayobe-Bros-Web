// Parsers for the OLD layouts of NECTA's FTNA (Form Two, called FTSEE in 2014) and SFNA (Standard Four) results, 2014 to 2021.
// Only the Maktaba Tetea mirror (https://maktaba.tetea.org/exam-results/...) still serves these years. The records have exactly the shape
// of the 2022 to 2025 parsers (necta-parse-ftna-sfna.mjs), so buildRecord, validateCentre and the packer treat old and new years alike.
// Checked on 2026-11-10 against real pages (see scripts/tests/necta-parse-ftna-sfna-old.test.mjs and fixtures/ftna-sfna-old/).
//
// FTNA / FTSEE (exam ids ftna-2014 .. ftna-2021; secondary kind, candidate numbers S0101/0001)
//  - Walk: ONE flat index per year, then centre pages in the same folder (see the table in the test file). 2014 (the UPDATED set, folder
//    FTSEE2014-2, file formtwo-2014-2.htm) links `08_S0005-0.htm`; 2015 to 2021 link `S0101.htm`. In 2014 128 centre codes appear twice
//    (`03_S0013-0.htm` and `03_S0013-1.htm` are two different schools under one code, both with candidate numbers from 0001): only the first
//    can be stored under that code; parseFtnaOldIndex keeps it and reports the others as `duplicate centre`.
//  - Page: a flat table without the 2022 columns. The heading is a <th> "CENTRE: S0101 - NAME" (not an <h3>); the header is a block of
//    rows with ONE LETTER PER ROW (vertical text) for every subject column; the subject name is read down the column (blank = space, trailing
//    "." padding dropped). Columns: CNO (4 digits, no centre prefix: the centre code and "/" are put in front), R (repeater flag), NAME OF
//    CANDIDATE, SEX, one cell per subject, then PTS and DIVISION (2016 to 2021) or GPA and CLASS (2014, 2015).
//  - Subject names are kept as written in each year's header (CIVICS and CIV, B/KNOWL, E/D/KIISLAMU ... differ between years; the packer
//    learns the list per exam). Empty cells are skipped. subjectsRaw is the packer's form `CIVICS - 'B' HISTORY - 'A'`.
//  - Marker rows (nothing invented): `Absent` + `ABS` -> aggt '-', div '-', subjectsRaw 'ABS' (like 2022 to 2025); `Results Withheld, Fee` + `*E`
//    -> aggt '-', div '*E', subjectsRaw the published text. Only a short list of known words is copied into a marker; any other text is not
//    copied (a shifted column could hold a name) and is reported.
//  - Grades: 2014 and 2015 use A, B+, B, C, D, E, F. The packer takes one character per grade, so by default (opts.plusGrade 'note') a row that
//    holds a grade of two characters becomes a marker row: aggt and div as published, subjectsRaw the grades as published, subjects []. With
//    opts.plusGrade 'keep' the pairs are kept (B+ stays B+) for a packer that can store them.
//  - aggt = PTS as published, or the GPA string as published (one decimal); div = the DIVISION or CLASS word as published.
//  - summary: 2016 to 2021 publish the division table (SEX x I..IV, REFERRED); it is kept as published with TOT written T. 2014 and 2015
//    publish only a grade summary (A..F counts), which is not a division table. Their summary is COUNTED from the published rows (class words
//    DISTINCTION, MERIT, CREDIT, PASS and FAIL or REFERRED; F, M, T rows) so it has the same shape as every other year (opts.derivedSummary false = null).
//  - Dropped, and why: the repeater flag (the record has no place for it and the packer would not store it); the per-grade-by-subject block
//    at the end (counts that can be recounted from the rows; the packer's `overall` template is the 2022 "EXAMINATION CENTRE RANKING" and this
//    block does not fit it); the NAME column (privacy).
//
// SFNA (exam ids sfna-2015 .. sfna-2021; primary kind, candidate numbers PS0101114-001)
//  - Walk: index (2015, 2016: index.htm, 2017 to 2021: sfna.htm; links `reg_ps01.htm`) -> `distr_ps0101.htm` -> `ps0101114.htm`: the same
//    names as 2022 to 2025, so parseSfnaRegions / parseSfnaDistricts / parseSfnaSchools already read every year (tested), and the mirror keeps
//    every file in the same folder. parseSfnaOld* below are those functions, re-exported under the old-years names.
//  - School page: header lines (WALIOSAJILIWA when published, WALIOFANYA MTIHANI, WASTANI WA SHULE, KUNDI LA SHULE and three NAFASI lines)
//    become `facts` as published, never recomputed. 2015 has no group line and the ranks read `NAFASI YA SHULE KIWILAYA`, `KIMKOA`, `KITAIFA`;
//    2016 to 2021 rank "kwenye kundi lake" (within the school's size group). No DARAJA line exists in these years.
//  - Candidate table: CAND. NO (2015, 2016) or NA. MWANAFUNZI (2017 on), SEX/JINSI, name (never read), SUBJECTS/MASOMO and a separate
//    AVERAGE GRADE column. The SUBJECTS cell is `Kiswahili - A English - B ...` (mixed case; the last subject differs by year) and the average
//    sits in its own cell, so the two letters seen at the end of a 2016 row are the LAST SUBJECT's grade and the AVERAGE GRADE. The parser appends
//    the average as the last pair `AVERAGE GRADE`, as the 2022 to 2025 parser does. 2021 numbers have four digits, earlier years three.
//  - Summary: 2019 to 2021 `JINSI x A..D, REFERRED` (rows WAS = girls, WAV = boys, JUMLA) as published; 2017 and 2018 publish the same table
//    turned round (grades in rows; written here as WAS/WAV/JUMLA rows like the others); 2015 and 2016 have none (null).
//  - `Absent` rows: marker row with the published text. REFERRED as average: marker row (default) or R (opts.referred 'code'), as in 2022 to 2025.
//
// Privacy (owner's decision): name columns and PREM columns are found by their header text and never read, so a child's name cannot reach a
// record, an issue message or a fixture. The output is plain data, never markup.
import { anchors, text } from './necta-parse.mjs';
import { parseSfnaRegions, parseSfnaDistricts, parseSfnaSchools, parseSfnaSubjects } from './necta-parse-ftna-sfna.mjs';
import { normalisePsleCode } from './necta-parse-psle-old.mjs';

export const parseSfnaOldRegions = parseSfnaRegions;
export const parseSfnaOldDistricts = parseSfnaDistricts;
export const parseSfnaOldSchools = parseSfnaSchools;

/** Rows of the whole page, cut at <tr> or </tr>; cells are <td> or <th>. A cell with colspan is one cell (its text only). */
function rowsAny(html) {
  const out = [];
  for (const chunk of html.split(/<TR\b[^>]*>|<\/TR\b[^>]*>?/i)) {
    if (!/<T[DH]\b/i.test(chunk)) continue;
    const cells = [];
    const re = /<T[DH]\b[^>]*>([\s\S]*?)(?=<T[DH]\b|$)/gi;
    let m;
    while ((m = re.exec(chunk))) cells.push(text(m[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}

/** Only a candidate number's own text may go into a note, never another cell of the row. */
const rowNote = (row, n) => (/^(?:[A-Za-z]{1,2}\d{4,9}[/-])?\d{1,5}$/.test(row[0] || '') ? `row ${n} (${String(row[0]).toUpperCase()})` : `row ${n}`);

/** Words that may be copied from a marker row. Anything else could be a shifted name and is not copied. */
const MARKER_TEXT = /^(ABS|ABSENT|CANCELLED|CANCELED|NULLIFIED|INCOMPLETE|NO RESULTS?|RESULTS? WITHHELD(?:, (?:FEE|FEES|FEE BALANCE|INCOMPLETE|ABSCONDED|DEBT))?)$/i;
const MARKER_CODE = /^(\*[A-Z0-9]{1,3}|ABS)$/i;

// ------------------------------------------------------------------------------------------ FTNA

/**
 * FTNA / FTSEE index -> { centres: [{ code, name, href }], issues }.
 * Links: `S0101.htm` (2015 to 2021) or `08_S0005-0.htm` (2014: zone number, code, -0 or -1). The text is the name, or `CODE NAME` in 2014; a leading code is dropped.
 * A code that is linked twice is kept once (the first) and reported.
 */
export function parseFtnaOldIndex(html) {
  const centres = [];
  const seen = new Set();
  const issues = [];
  for (const a of anchors(html)) {
    const m = /^(?:\.?\/)?(?:results\/)?(?:\d{2}_)?([a-z]{1,2}\d{4,9})(?:-\d)?\.html?$/i.exec(a.href);
    if (!m) continue;
    const code = m[1].toUpperCase();
    let name = a.label;
    const lead = /^([A-Z]{1,2}\d{4,9})\s+(.*)$/i.exec(name);
    if (lead && lead[1].toUpperCase() === code) name = lead[2].trim();
    else if (lead) { issues.push(`label/href mismatch: ${code}`); continue; }
    if (seen.has(code)) { issues.push(`duplicate centre ${code} (${a.href})`); continue; }
    seen.add(code);
    if (!name) issues.push(`empty name: ${code}`); // kept: the centre page has the name
    centres.push({ code, name, href: a.href });
  }
  if (!centres.length) issues.push('no centres found');
  return { centres, issues };
}

/** The name written down one header column: letters from the vertical rows, blank = space, trailing dots dropped. */
function columnName(headRows, j) {
  const s = headRows.map((r) => (r[j] === '' ? ' ' : r[j])).join('').replace(/\s+/g, ' ').trim();
  return s.replace(/[.\s]+$/, '');
}

const GRADE_OK = /^[A-Z]\+?$/;

/**
 * FTNA / FTSEE centre page -> { code, name, summary, overall, facts, candidates, issues }.
 * opts.plusGrade 'note' (default) | 'keep'; opts.derivedSummary (default true); opts.year (2014 counts FAIL, other years REFERRED unless FAIL is seen) or opts.failWord for a counted summary.
 */
export function parseFtnaOldCentre(html, expectCode, opts = {}) {
  const keepPlus = opts.plusGrade === 'keep';
  const issues = [];
  const want = expectCode ? String(expectCode).toUpperCase() : null;
  const hm = /CENTRE:\s*([A-Z]{1,2}\d{4,9})\s*-\s*([^<\r\n]*)/i.exec(html);
  const code = hm ? hm[1].toUpperCase() : null;
  const name = hm ? text(hm[2]) : '';
  if (!code) issues.push('no centre heading');
  else if (want && code !== want) issues.push(`heading code ${code} != ${want}`);

  const rows = rowsAny(html);
  const k = rows.findIndex((r) => r[0] === 'CNO');
  if (k < 0) { issues.push('no candidate table'); return { code, name, summary: null, overall: [], facts: [], candidates: [], issues }; }
  const w = rows[k].length;
  let s = k;
  while (s > 0 && rows[s - 1].length === w && rows[s - 1][0] === '') s--;
  const headRows = rows.slice(s, k + 1);
  const head = [];
  for (let j = 0; j < w; j++) head.push(columnName(headRows, j).toUpperCase());
  const col = { cno: 0, sex: -1, aggt: -1, div: -1 };
  head.forEach((h, j) => {
    if (/NAME|JINA|PREM/.test(h)) return; // never read
    if (/^SEX$/.test(h)) col.sex = j;
    else if (/^(PTS|GPA|POINTS?)$/.test(h)) col.aggt = j;
    else if (/^(DIVISION|CLASS)$/.test(h)) col.div = j;
  });
  if (head[0] !== 'CNO' || col.sex < 0 || col.aggt < 0 || col.div < 0 || col.aggt > col.div) { issues.push('unknown candidate columns'); return { code, name, summary: null, overall: [], facts: [], candidates: [], issues }; }
  const subjCols = [];
  for (let j = col.sex + 1; j < col.aggt; j++) {
    const nm = head[j] ? columnName(headRows, j) : '';
    if (!nm) { issues.push(`unnamed subject column ${j}`); continue; }
    if (subjCols.some((c) => c.name === nm)) { issues.push(`repeated subject column ${nm}`); continue; }
    subjCols.push({ j, name: nm });
  }
  // a column whose header is not a subject (the repeater flag, the name) lies before SEX, so everything between SEX and the result columns is a subject

  // the division table published above the candidates (2016 to 2021)
  let summary = null;
  const si = rows.findIndex((r, i) => i < s && r[0] === 'SEX' && r.length === 2);
  if (si >= 0 && rows[si + 1]) {
    const words = rows[si + 1];
    const body = [];
    for (let i = si + 2; i < s && ['F', 'M', 'TOT', 'T'].includes(rows[i][0]) && rows[i].length === words.length + 1; i++) body.push([rows[i][0] === 'TOT' ? 'T' : rows[i][0], ...rows[i].slice(1)]);
    if (body.length) summary = { head: ['SEX', ...words], rows: body };
    else issues.push('division table not read');
  }

  const candidates = [];
  const seen = new Set();
  let n = 0;
  let end = k + 1;
  for (; end < rows.length; end++) {
    const row = rows[end];
    if (row[0] === '') break; // the grade-by-subject block starts with an empty cell
    n++;
    const note = rowNote(row, n);
    const mc = /^(\d{3,5})$/.exec(row[0]);
    if (!mc || row.length < 5) { issues.push(`skipped ${note}`); continue; }
    const pre = code || want;
    if (!pre) { issues.push(`skipped ${note}`); continue; }
    const cno = `${pre}/${mc[1]}`;
    if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
    seen.add(cno);
    const sex = (row[col.sex] || '').toUpperCase();
    if (!/^[MF]$/.test(sex)) issues.push(`unknown sex in ${note}`);
    const sx = /^[MF]$/.test(sex) ? sex : '';
    if (row.length < w) {
      // marker row: [cno, R, name, sex, text, code] with the text cells merged
      const msg = row[col.sex + 1] || '';
      const cd = row[col.sex + 2] || '';
      if (/^(ABS|ABSENT)$/i.test(msg) || /^ABS$/i.test(cd)) { candidates.push({ cno, sex: sx, aggt: '-', div: '-', subjectsRaw: 'ABS', subjects: [] }); continue; }
      if (MARKER_TEXT.test(msg) && (!cd || MARKER_CODE.test(cd))) { candidates.push({ cno, sex: sx, aggt: '-', div: cd.toUpperCase() || '-', subjectsRaw: msg, subjects: [] }); continue; }
      issues.push(`row not read: ${note}`);
      candidates.push({ cno, sex: sx, aggt: '-', div: '-', subjectsRaw: '', subjects: [] });
      continue;
    }
    const aggt = row[col.aggt] || '-';
    const div = row[col.div] || '-';
    const pairs = [];
    let bad = false;
    for (const c of subjCols) {
      const g = (row[c.j] || '').toUpperCase();
      if (!g) continue;
      if (!GRADE_OK.test(g)) { bad = true; issues.push(`grade not read in ${note}`); break; }
      pairs.push([c.name, g]);
    }
    if (bad) { candidates.push({ cno, sex: sx, aggt, div, subjectsRaw: '', subjects: [] }); continue; }
    if (!pairs.length) issues.push(`no subjects in ${note}`);
    const raw = pairs.map(([a, b]) => `${a} - '${b}'`).join(' ');
    const plus = pairs.some(([, g]) => g.length !== 1);
    candidates.push({ cno, sex: sx, aggt, div, subjectsRaw: raw, subjects: plus && !keepPlus ? [] : pairs });
  }
  if (!candidates.length) issues.push('no candidates found');

  if (!summary && opts.derivedSummary !== false && candidates.length) summary = countedSummary(candidates, opts);
  return { code, name, summary, overall: [], facts: [], candidates, issues };
}

/** Class totals counted from the published rows (2014, 2015 publish only a grade summary). Same shape as a division table. */
function countedSummary(candidates, opts) {
  const words = ['DISTINCTION', 'MERIT', 'CREDIT', 'PASS'];
  const seen = new Set(candidates.map((c) => c.div));
  const failWord = opts.failWord || (opts.year === 2014 ? 'FAIL' : null);
  const fail = failWord ? [failWord] : [...(seen.has('FAIL') ? ['FAIL'] : []), ...(seen.has('REFERRED') || !seen.has('FAIL') ? ['REFERRED'] : [])];
  words.push(...fail);
  const sexes = ['F', 'M'].filter((x) => candidates.some((c) => c.sex === x));
  const row = (label, list) => [label, ...words.map((wd) => String(list.filter((c) => c.div === wd).length))];
  return { head: ['SEX', ...words], rows: [...sexes.map((x) => row(x, candidates.filter((c) => c.sex === x))), row('T', candidates)] };
}

// ------------------------------------------------------------------------------------------ SFNA

const FACT_LABEL = /^(WALIOSAJILIWA|WALIOFANYA MTIHANI|WASTANI WA SHULE|KUNDI LA SHULE|NAFASI YA SHULE[A-Z /]*)$/;
const FACT_VALUE = /^[A-Za-z0-9][A-Za-z0-9 .,()/%+-]{0,59}$/;

/** The "LABEL : value" lines between the school heading and the candidate table, in the order published; only known labels are kept. */
function sfnaFacts(html) {
  const a = html.search(/<\/H3>/i);
  const b = html.search(/<TH[^>]*>\s*(?:CAND\.?\s*NO|NA\.\s*MWANAFUNZI)/i);
  const region = html.slice(a < 0 ? 0 : a + 5, b < 0 ? undefined : b).replace(/<\/?(?:table|tr|td|th)\b[^>]*>/gi, '<br>');
  const facts = [];
  const seen = new Set();
  for (const piece of region.split(/<br\s*\/?>/i)) {
    const m = /^([A-Z][A-Z /]+?)\s*:\s*(.+)$/.exec(text(piece));
    if (!m) continue;
    const label = m[1].replace(/\s+/g, ' ').trim();
    const value = m[2].trim();
    if (!FACT_LABEL.test(label) || !FACT_VALUE.test(value) || seen.has(label)) continue;
    seen.add(label);
    facts.push([label, value]);
  }
  return facts;
}

/** A table that holds names, PREM numbers or candidate numbers must not be kept as a block. */
function looksPersonal(r) {
  return r.some((row, i) => (i === 0 && row.some((c) => /NAME|JINA|PREM|^CAND|MWANAFUNZI/i.test(c))) || row.some((c) => /^\d{9,}$/.test(c) || /^PS?\d{4,9}-\d+$/i.test(c)));
}

/** The grade table above the candidates: the 2019 to 2021 layout (as published) or the turned-round 2017, 2018 layout. */
function sfnaSummary(rows, upTo, issues) {
  for (let i = 0; i < upTo; i++) {
    const r = rows[i];
    // 2019 to 2021: ["JINSI", "GREDI YA JUMLA YA ALAMA"], [A, B, C, D, REFERRED], [WAS, ...], [WAV, ...], [JUMLA, ...]
    if (r[0] === 'JINSI' && r.length === 2 && rows[i + 1]) {
      const words = rows[i + 1];
      const body = [];
      for (let j = i + 2; j < upTo && /^(WAS|WAV|JUMLA)$/.test(rows[j][0]) && rows[j].length === words.length + 1; j++) body.push(rows[j]);
      if (body.length) return { head: ['JINSI', ...words], rows: body };
      issues.push('grade table not read');
      return null;
    }
    // 2017, 2018: ["GREDI YA JUMLA YA ALAMA", "JINSI", "JUMLA"], ["WAS.", "WAV."], [A, 10, 6, 16] ...
    if (/^GREDI YA/i.test(r[0]) && r.length === 3 && rows[i + 1] && rows[i + 1].length === 2) {
      const body = [];
      for (let j = i + 2; j < upTo && /^([A-Z]|REFERRED)$/.test(rows[j][0]) && rows[j].length === 4; j++) body.push(rows[j]);
      if (!body.length) { issues.push('grade table not read'); return null; }
      const colRow = (x, label) => [label, ...body.map((b) => b[x])];
      return { head: ['JINSI', ...body.map((b) => b[0])], rows: [colRow(1, 'WAS'), colRow(2, 'WAV'), colRow(3, 'JUMLA')] };
    }
  }
  return null;
}

/**
 * SFNA school page, 2015 to 2021 -> the record parseSfnaSchool / parsePsleOldSchool return (code, name, facts, summary, overall, candidates, issues).
 * opts.referred 'note' (default) | 'code': an AVERAGE GRADE that is the word REFERRED becomes a marker row with the published text, or the letter R.
 */
export function parseSfnaOldSchool(html, expectCode, opts = {}) {
  const referred = opts.referred === 'code' ? 'code' : 'note';
  const issues = [];
  const h = /<H3[^>]*>([\s\S]*?)<\/H3>/i.exec(html);
  const heading = h ? text(h[1]) : '';
  const m = /^(.*?)\s*-\s*(PS?\d+)$/i.exec(heading);
  const code = m ? normalisePsleCode(m[2]) : null;
  const name = m ? m[1] : heading;
  const want = expectCode ? normalisePsleCode(expectCode) : null;
  if (!code) issues.push('no school heading');
  else if (expectCode && code !== want) issues.push(`heading code ${code} != ${want || String(expectCode).toUpperCase()}`);

  const facts = sfnaFacts(html);
  const rows = rowsAny(html);
  const k = rows.findIndex((r) => /^(CAND\.?\s*NO|NA\.\s*MWANAFUNZI)$/i.test(r[0]));
  const candidates = [];
  const overall = [];
  let summary = null;
  if (k < 0) issues.push('no candidate table');
  else {
    summary = sfnaSummary(rows, k, issues);
    const headRow = rows[k];
    const col = { cno: 0, sex: -1, subjects: -1, avg: -1 };
    headRow.forEach((c, j) => {
      const t = c.toUpperCase();
      if (/PREM/.test(t) || /NAME|JINA/.test(t)) return; // never read
      if (/^(SEX|JINSI)$/.test(t) && col.sex < 0) col.sex = j;
      else if (/^(SUBJECTS?|SOMO|MASOMO)$/.test(t) && col.subjects < 0) col.subjects = j;
      else if (/AVERAGE|GREDI/.test(t) && col.avg < 0) col.avg = j;
    });
    if (col.sex < 0 || col.subjects < 0 || col.avg < 0) issues.push('unknown candidate columns');
    else {
      const seen = new Set();
      let n = 0;
      let i = k + 1;
      for (; i < rows.length; i++) {
        const row = rows[i];
        if (!/^PS?\d+-\d+$/i.test(row[0] || '')) break;
        n++;
        const note = rowNote(row, n);
        const mc = /^PS?(\d+)-(\d+)$/i.exec(row[0]);
        if (row.length < headRow.length - 1) { issues.push(`skipped ${note}`); continue; }
        const cno = `PS${mc[1]}-${mc[2]}`;
        if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
        seen.add(cno);
        if (code && !cno.startsWith(`${code}-`)) issues.push(`candidate number ${cno} is not under ${code}`);
        const sex = (row[col.sex] || '').toUpperCase();
        if (!/^[MF]$/.test(sex)) issues.push(`unknown sex in ${note}`);
        const sx = /^[MF]$/.test(sex) ? sex : '';
        const pub = (row[col.subjects] || '').replace(/\s+/g, ' ').trim();
        const avg = (row.length >= headRow.length ? row[col.avg] || '' : '').trim().toUpperCase();
        let pairs = [];
        let raw = '';
        if (avg) {
          pairs = parseSfnaSubjects(`${pub} AVERAGE GRADE - ${avg}`);
          raw = pairs.map(([a, b]) => `${a} - ${b}`).join(', ');
          if (pairs.length && pairs.slice(0, -1).some(([, g]) => g === 'REFERRED')) { issues.push(`REFERRED outside the average in ${note}`); pairs = []; }
          if (!pairs.length) { issues.push(`subjects not read in ${note}`); raw = ''; }
          else if (pairs.at(-1)[1] === 'REFERRED') {
            if (referred === 'code') { pairs.at(-1)[1] = 'R'; raw = pairs.map(([a, b]) => `${a} - ${b}`).join(', '); }
            else { raw = `${pub} AVERAGE GRADE - REFERRED`; pairs = []; } // marker row: the published text is the note
          }
        } else if (MARKER_TEXT.test(pub)) raw = pub; // Absent
        else issues.push(`subjects not read in ${note}`);
        candidates.push({ cno, sex: sx, subjectsRaw: raw, subjects: pairs });
      }
      // what follows the candidates (none seen so far) is kept as published unless it looks personal
      const rest = rows.slice(i);
      if (rest.length) {
        if (looksPersonal(rest)) issues.push('skipped a table after the candidates');
        else {
          let r = rest;
          while (r.length && r[0].length === 1) { if (r[0][0]) overall.push({ t: 'h', v: r[0][0] }); r = r.slice(1); }
          if (r.length) overall.push(r.every((x) => x.length === 2) ? { t: 'kv', rows: r } : { t: 'grid', head: r[0], rows: r.slice(1) });
        }
      }
    }
  }
  if (!candidates.length) issues.push('no candidates found');
  return { code, name, facts, summary, overall, candidates, issues };
}
