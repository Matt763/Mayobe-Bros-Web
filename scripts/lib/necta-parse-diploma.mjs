// Parsers for NECTA's teachers' college diploma pages and the Qualifying Test (QT) pages.
// Checked on 2026-11-10 against real pages (see scripts/tests/necta-parse-diploma.test.mjs and fixtures/diploma/).
//
// DIPLOMA EXAMS: DSEE (2014-2026), DPEE, DPPEE, DSPEE (2026), DTE (2019, 2020). One layout for all of them.
//  - The exam index is ONE flat page (`index.htm`, `dsee.htm` on the Maktaba mirror before 2020): a letter bar (`index_a.htm`, not
//    centres) and links whose text is `501 BUTIMBA TEACHERS' COLLEGE`. The link is `501.htm` (Maktaba) or `results/501.htm`
//    (onlinesys / matokeo). Letter links and anything else are ignored.
//  - CENTRE CODE RULE: candidate numbers read `E0501/0001`, so the centre code is the letter E and the link number padded to four
//    digits (501 -> E0501, 502 -> E0502). The page heading and the link text carry only the number (`501 BUTIMBA ...`).
//  - The centre heading is `<H3>501 NAME`, followed by a second `<H3>` with the counts line `DISTINCTION = 0; CREDITS = 28; PASS = 321;
//    SUPP = 2; FLD = 2;` (2014 has no semicolons). The first <H3> is not closed, so a heading ends at the next heading tag of any kind.
//    The counts line leaves out the ABS and *E rows. The <title> is not trusted (the 2019 page says 2023): the <H1> says `DSEE 2019
//    EXAMINATION RESULTS`.
//  - The table has CNO, SEX, AGGT, DIV, DETAILED SUBJECTS and no name column. It may end with </BODY> and no </TABLE>. The pages
//    fetched from matokeo.necta.go.tz in 2026 are well-formed (tbody, closed tags, extension <div>s at the end) and write the number as
//    `E0506-0001` with a hyphen and name the result columns GPA and CLASS instead of AGGT and DIV (DPEE, DPPEE, DSPEE 2026); the
//    others use `/`, AGGT and DIV (layout.aggtColumn and layout.divColumn say which). Numbers are returned with `/` (the secondary
//    form the packer and validateCentre expect); layout.cnoSeparator says what was published (opts.keepSeparator keeps it).
//  - AGGT is a GPA as published (` 3.0`, ` -`, ` *E`), DIV a word (DISTINCTION, CREDIT, PASS, SUPP, FAIL, ABS, `*E`, `-`), both kept
//    as published (trimmed). The subjects cell is `DEV. STUDIES - 'C'   COMM SKILLS - 'C'` (pairs); an absentee has the same with
//    every grade X; `---` is the cell of an `*E` row; a grade can be `' *R '` (not one character: the cell stays text, subjects []).
//  - summary = the counts line as one total row: { head: ['SEX', 'DISTINCTION', 'CREDITS', ...], rows: [['T', '0', '28', ...]] }.
//    There is no per-sex table. facts = [], overall = [] (a table after the candidates, if one ever appears, goes to overall).
//  - counts check: DISTINCTION, CREDITS (CREDIT rows), PASS, SUPP, FLD (FAIL rows) are compared with the rows read; a difference is
//    an issue (a truncated page shows up here).
//
// QT (Qualifying Test): ONE text page per year (<xmp> or <PRE>, form feeds) for ~850 to ~970 centres.
//  - Each page of text is one centre header + one table; a centre with more than about 43 candidates continues on the next page with the
//    same header (code, name, PASSED =, FAILED =), so pages of one centre are merged (by code; the repeated counts must agree).
//  - `QT 2023 RESULTS FOR : M0104 - BWIRU BOYS SECONDARY SCHOOL CENTRE` (the word CENTRE is sometimes missing), `PASSED = 3`,
//    `FAILED = 7` (ABSENT rows are not counted), then rows `0001  F  FULL NAME   PASSED`. Remarks: PASSED, FAILED, ABSENT, `*W` (2016)
//    and `*W Results Nullified, Irregularities` (2023).
//  - PRIVACY: the NAME COLUMN IS DROPPED at parse time. Nothing but the number, sex and remark of a row is ever stored, and no issue
//    message carries any text of a row.
//  - A row whose number has another centre's prefix (`M0823-0001` inside M0333, 2023) is kept apart in `foreign` and reported, because
//    the packer needs every number to start with the centre's own code.
// Everything returned is plain data; nothing is ever markup.

import { text, tables, rows, parseSecondarySubjects } from './necta-parse.mjs';

// ------------------------------------------------------------------ shared small helpers

const CNO_RE = /^([A-Z]{1,2}\d{4,9})([/-])(\d{1,5})$/i;

/** Only a candidate number's own text may go into a note, never another cell of the row. */
const rowNote = (row, n) => (/^[A-Za-z]{1,2}\d{4,9}[/-]\d{1,5}$/.test(row[0] || '') ? `row ${n} (${row[0].toUpperCase()})` : `row ${n}`);

/** The code in the candidate numbers for a college number: the letter E and the number padded to four digits (501 -> E0501). */
export function diplomaCode(num) {
  return 'E' + String(num).replace(/^E/i, '').padStart(4, '0');
}

const LINK_RE = /<A\s+[^>]*?HREF\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)(?:<\/A>|(?=<A\s)|(?=<\/TD))/gi;

function links(html) {
  const out = [];
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(html))) out.push({ href: (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/\\/g, '/'), label: text(m[4]) });
  return out;
}

// ------------------------------------------------------------------ the index

/**
 * Diploma exam index -> { centres: [{ code, name, href }], issues }.
 * `code` is the one in the candidate numbers (E0501 for the link 501.htm); `href` is as published (`501.htm`, `results/501.htm`).
 * Letter links (`index_a.htm`), other pages and links to other sites are ignored. A repeated centre is reported and kept once.
 */
export function parseDiplomaIndex(html) {
  const centres = [];
  const issues = [];
  const seen = new Set();
  for (const a of links(html)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(a.href) || a.href.startsWith('//')) continue;
    const file = a.href.split(/[?#]/)[0];
    const m = /^(?:\.?\/)?(?:results\/)?(\d{3,4})\.html?$/i.exec(file);
    if (!m) continue;
    const code = diplomaCode(m[1]);
    const l = /^(\d{3,4})(?:\s+(.*))?$/.exec(a.label);
    if (!l || Number(l[1]) !== Number(m[1])) { issues.push(`label/href mismatch: "${a.label}" vs ${a.href}`); continue; }
    if (seen.has(code)) { issues.push(`duplicate centre ${code}`); continue; }
    const name = (l[2] || '').trim();
    if (!name) issues.push(`empty name: ${code}`); // the centre is kept: its own page has the name
    seen.add(code);
    centres.push({ code, name, href: a.href });
  }
  if (!centres.length) issues.push('no centres found');
  return { centres, issues };
}

// ------------------------------------------------------------------ one diploma centre page

/** `CIV - 'C' ...` -> pairs, or [] unless the whole cell is read and no subject name is repeated (the packer needs one place per subject). */
export function readDiplomaSubjects(cell, sort = false) {
  if (!cell.includes("'")) return { subjects: [], raw: cell };
  const pairs = parseSecondarySubjects(cell);
  if (!pairs.length || new Set(pairs.map((p) => p[0])).size !== pairs.length) return { subjects: [], raw: cell };
  if (sort) pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { subjects: pairs, raw: pairs.map(([n, g]) => `${n} - '${g}'`).join(' ') };
}

/** Which header text means which column. A name or PREM column would be recognised only to be skipped. */
function columnsOf(head) {
  const col = { cno: -1, sex: -1, aggt: -1, div: -1, subjects: -1 };
  head.forEach((h, i) => {
    const t = h.toUpperCase().trim();
    if (/PREM/.test(t) || (/NAME|JINA/.test(t) && !/SUBJECT/.test(t))) return; // never read
    if (/^(CNO|CAND)/.test(t) && col.cno < 0) col.cno = i;
    else if (/^SEX/.test(t) && col.sex < 0) col.sex = i;
    else if (/^(AGG|GPA)/.test(t) && col.aggt < 0) col.aggt = i;
    else if (/^(DIV|CLASS)/.test(t) && col.div < 0) col.div = i;
    else if (/SUBJECT/.test(t) && col.subjects < 0) col.subjects = i;
  });
  return col;
}

/** The first heading that starts with a college number. The first <H3> is not closed on the real pages, so a heading ends at the next heading tag. */
function findHeading(page) {
  const re = /<H([1-4])\b[^>]*>([\s\S]*?)(?=<\/H[1-6]>|<H[1-6]\b|$)/gi;
  let m;
  while ((m = re.exec(page))) {
    const t = text(m[2]);
    const h = /^(\d{3,4})\s+(.+)$/.exec(t);
    if (h) return { num: h[1], name: h[2].trim(), at: m.index };
  }
  return null;
}

/** `DISTINCTION = 0; CREDITS = 28; ...` -> { head: ['SEX', labels], rows: [['T', numbers]] } or null. */
function countsLine(region) {
  const heads = [];
  const nums = [];
  const re = /\b([A-Z][A-Z0-9-]*)\s*=\s*(\d{1,6})\b/gi;
  let m;
  while ((m = re.exec(region))) { heads.push(m[1].toUpperCase()); nums.push(m[2]); }
  if (heads.length < 2 || new Set(heads).size !== heads.length) return null;
  return { head: ['SEX', ...heads], rows: [['T', ...nums]] };
}

/** The word the DIV column uses for each label of the counts line (the line says CREDITS and FLD, the rows say CREDIT and FAIL). */
const LABEL_TO_DIV = { CREDITS: 'CREDIT', FLD: 'FAIL' };

/** Sections published after the candidate table (none seen), kept as published like the other parsers. */
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

/**
 * Diploma centre page -> { code, name, summary, overall, facts, candidates: [{cno, sex, aggt, div, subjectsRaw, subjects}], issues, layout }.
 * expectCode is the code of the index (E0501) or the bare number (501). layout = { exam, year, cnoSeparator, aggtColumn, divColumn }.
 * opts.keepSeparator: keep the published `-` in the candidate numbers (default: they are written with `/`).
 * opts.sortSubjects: write every row's subjects in alphabetical order of their names (subjectsRaw too). DSPEE 2026 lists the two
 *   specialisation subjects of a student in no fixed order, and the packer needs ONE order for the whole exam; this gives one.
 * A row that is not a candidate is skipped with a note; nothing throws.
 */
export function parseDiplomaCentre(html, expectCode, opts = {}) {
  const issues = [];
  const at = html.search(/<BODY/i);
  const page = at >= 0 ? html.slice(at) : html;
  const heading = findHeading(page);
  const code = heading ? diplomaCode(heading.num) : null;
  const want = expectCode ? (/^\d{3,4}$/.test(String(expectCode)) ? diplomaCode(expectCode) : String(expectCode).toUpperCase()) : null;
  if (!code) issues.push('no centre heading');
  else if (want && code !== want) issues.push(`heading code ${code} != ${want}`);

  const layout = { exam: null, year: null, cnoSeparator: null, aggtColumn: null, divColumn: null };
  const ey = /\b([A-Z]{3,6})\s+(\d{4})\s+EXAMINATION\s+RESULTS\b/i.exec(text(page.slice(0, (heading ? heading.at : 0) + 20)));
  if (ey) { layout.exam = ey[1].toUpperCase(); layout.year = Number(ey[2]); }

  const firstTable = page.search(/<TABLE\b/i);
  const summary = heading && firstTable > heading.at ? countsLine(text(page.slice(heading.at, firstTable))) : null;

  const candidates = [];
  const overall = [];
  const seen = new Set();
  const byDiv = new Map();
  let afterCand = false;
  let n = 0;
  for (const t of tables(page)) {
    const r = rows(t);
    if (!r.length) continue;
    if (afterCand) {
      if (looksPersonal(r)) issues.push('skipped a table after the candidates');
      else overall.push(...blocksFromRows(r));
      continue;
    }
    if (!r[0].some((h) => /^(CNO|CAND)/i.test(h))) continue;
    afterCand = true;
    const head = r[0];
    const col = columnsOf(head);
    if (Object.values(col).some((i) => i < 0)) { issues.push('unknown candidate columns'); continue; }
    layout.aggtColumn = head[col.aggt].toUpperCase();
    layout.divColumn = head[col.div].toUpperCase();
    const pre = (code || want || '') + '/';
    for (const row of r.slice(1)) {
      n++;
      const cell = (i) => row[i] || '';
      const m = CNO_RE.exec(cell(col.cno));
      if (row.length !== head.length || !m) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
      if (!layout.cnoSeparator) layout.cnoSeparator = m[2];
      const cno = `${m[1].toUpperCase()}${opts.keepSeparator ? m[2] : '/'}${m[3]}`;
      const key = `${m[1].toUpperCase()}/${m[3]}`;
      if (seen.has(key)) { issues.push(`duplicate candidate ${key}`); continue; }
      seen.add(key);
      if (pre !== '/' && !key.startsWith(pre)) issues.push(`candidate number ${key} is not under ${pre.slice(0, -1)}`);
      const sex = cell(col.sex).toUpperCase();
      if (!/^[MF]$/.test(sex)) issues.push(`unknown sex in ${rowNote(row, n)}`);
      const aggt = cell(col.aggt) || '-';
      const div = cell(col.div) || '-';
      if (!/^(-|\*[A-Z0-9]{1,3}|\d{1,2}(\.\d{1,3})?)$/.test(aggt)) issues.push(`unknown aggregate in ${rowNote(row, n)}`);
      if (!/^(-|[A-Z*][A-Z0-9*.-]{0,15})$/i.test(div)) issues.push(`unknown division in ${rowNote(row, n)}`);
      byDiv.set(div, (byDiv.get(div) || 0) + 1);
      const raw = cell(col.subjects);
      const s = readDiplomaSubjects(raw, !!opts.sortSubjects);
      if (!s.subjects.length && raw && !/^-+$/.test(raw)) {
        issues.push(/'\s*\*[A-Z]\s*'/.test(raw) ? `special grade kept as text in ${rowNote(row, n)}` : `subjects not read in ${rowNote(row, n)}`);
      }
      candidates.push({ cno, sex: /^[MF]$/.test(sex) ? sex : '', aggt, div, subjectsRaw: s.raw, subjects: s.subjects });
    }
  }
  if (!candidates.length) issues.push('no candidates found');

  // the counts line against the rows (it leaves out ABS and *E rows)
  if (summary && candidates.length) {
    summary.head.slice(1).forEach((label, i) => {
      const word = LABEL_TO_DIV[label] || label;
      const have = byDiv.get(word) || 0;
      const said = Number(summary.rows[0][i + 1]);
      if (have !== said) issues.push(`count ${label} = ${said} but ${have} rows`);
    });
  }
  return { code, name: heading ? heading.name : '', summary, overall, facts: [], candidates, issues, layout };
}

// ------------------------------------------------------------------ QT

const QT_HEADING = /\bRESULTS\s+FOR\s*:\s*([A-Z]{1,2}\d{4,9})\s*-\s*(.*?)\s*$/i;
const QT_COUNT = /^\s*([A-Z][A-Z ]{1,20}?)\s*=\s*(\d{1,6})\s*$/;
const QT_COLUMNS = /^\s*CNO\b.*\bREMARKS?\b/i;
const QT_ROW = /^\s*(?:([A-Z]{1,2}\d{4,9})[-/])?(\d{1,5})\s+([MF])(?:\s+(.*?))?\s*$/;
const QT_REMARK = /(?:^|\s)(PASSED|FAILED|ABSENT|\*[A-Z]\b.*?)\s*$/;
const QT_KNOWN = /NATIONAL EXAMINATIONS COUNCIL|RESULTS SUMMARY|^\s*-{3,}\s*$|Page\s*:\s*\d+\s*$/i;

const decodeBasic = (s) => s.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'").replace(/&apos;/gi, "'");

/**
 * The whole QT page -> { year, centres: [{ code, name, summary, overall, facts, candidates, foreign, issues }], issues }.
 *  - candidates: { cno: 'M0104/0001', sex, aggt: '-', div: 'PASSED' | 'FAILED' | 'ABSENT' | '*W', subjectsRaw: '' (or the text after `*W`), subjects: [] };
 *    the NAME of a candidate is never read into any value;
 *  - summary: { head: ['SEX', 'PASSED', 'FAILED'], rows: [['T', '3', '7']] } as published (ABSENT is not counted on the page);
 *  - foreign: rows whose own prefix is another centre's code, { cno, sex, div } (kept apart, see the top of the file);
 *  - the PASSED and FAILED counts are compared with the rows of all pages of the centre; a difference is an issue.
 * The text is read line by line, so a 2 MB page is never split into an array of lines.
 */
export function parseQtPage(html) {
  const issues = [];
  const centres = [];
  const byCode = new Map();
  const state = { year: null };
  let cur = null; // the centre being read
  let lastCode = null;
  let inRows = false;
  let pageCounts = null;
  let first = true; // first page of the centre: its counts are the reference
  let lineNo = 0;
  // at most 5 notes about lines nobody recognised per centre (a page that is not a QT page would otherwise fill the list)
  const unknownLine = () => { cur.unk = (cur.unk || 0) + 1; if (cur.unk <= 5) cur.issues.push(`unrecognised line ${lineNo}`); else if (cur.unk === 6) cur.issues.push('more unrecognised lines'); };

  const finish = (c) => {
    if (!c) return;
    const sum = c.counts || {};
    for (const label of Object.keys(sum)) {
      if (label !== 'PASSED' && label !== 'FAILED') continue;
      const have = c.tally[label] || 0;
      if (have !== sum[label]) c.issues.push(`count ${label} = ${sum[label]} but ${have} rows`);
    }
    c.summary = Object.keys(sum).length ? { head: ['SEX', ...Object.keys(sum)], rows: [['T', ...Object.values(sum).map(String)]] } : null;
    if (!c.summary) c.issues.push('no counts found');
    if (!c.candidates.length && !c.foreign.length) c.issues.push('no candidates found');
    delete c.counts; delete c.tally;
  };

  const startCentre = (code, name) => {
    let c = byCode.get(code);
    if (c) {
      if (lastCode !== code) c.issues.push(`centre ${code} appears again after another centre`);
      first = false;
    } else {
      c = { code, name, summary: null, overall: [], facts: [], candidates: [], foreign: [], issues: [], counts: null, tally: {}, seen: new Set(), unk: 0 };
      byCode.set(code, c);
      centres.push(c);
      first = true;
    }
    cur = c;
    lastCode = code;
    inRows = false;
    pageCounts = {};
  };

  let pos = 0;
  const len = html.length;
  while (pos <= len) {
    let end = html.indexOf('\n', pos);
    if (end < 0) end = len;
    const line = html.slice(pos, end).replace(/[\r\f]/g, ' ');
    pos = end + 1;
    lineNo++;
    if (!line.trim()) continue;

    const h = QT_HEADING.exec(line);
    if (h) { // the start of a page of text (the first page of a centre, or the next page of the same one)
      const y = /\bQT\s+(\d{4})\b/i.exec(line);
      if (y && !state.year) state.year = Number(y[1]);
      startCentre(h[1].toUpperCase(), decodeBasic(h[2]).replace(/\s+/g, ' '));
      continue;
    }
    if (!cur) continue; // text before the first centre
    if (QT_COLUMNS.test(line)) {
      inRows = true;
      // the counts of this page: the first page sets them, later pages must repeat them
      if (first) cur.counts = pageCounts;
      else if (cur.counts) {
        for (const k of new Set([...Object.keys(cur.counts), ...Object.keys(pageCounts)])) {
          if (cur.counts[k] !== pageCounts[k]) { cur.issues.push(`the counts on a later page of ${cur.code} differ`); break; }
        }
      }
      continue;
    }
    if (!inRows) {
      const c = QT_COUNT.exec(line);
      if (c) { pageCounts[c[1].replace(/\s+/g, ' ').toUpperCase()] = Number(c[2]); continue; }
      if (QT_KNOWN.test(line)) continue;
      if (line.includes('<')) continue;
      unknownLine();
      continue;
    }
    // inside the table
    const m = QT_ROW.exec(line);
    if (m) {
      const num = m[2].padStart(4, '0');
      const own = m[1] ? m[1].toUpperCase() : cur.code;
      const rest = m[4] || '';
      const rm = QT_REMARK.exec(rest);
      let div = '-';
      let extra = '';
      if (rm) {
        const r = rm[1].trim();
        if (r.startsWith('*')) { const parts = /^(\*[A-Z])\b\s*(.*)$/.exec(r); div = parts[1]; extra = parts[2].replace(/\s+/g, ' ').trim(); } else div = r;
      }
      const cno = `${own}/${num}`;
      if (!rm) cur.issues.push(`no remark in ${cno}`);
      if (own !== cur.code) {
        cur.foreign.push({ cno, sex: m[3], div });
        cur.issues.push(`candidate number ${cno} is listed under ${cur.code} and kept apart`);
      } else if (cur.seen.has(cno)) {
        cur.issues.push(`duplicate candidate ${cno}`);
        continue;
      } else {
        cur.seen.add(cno);
        cur.candidates.push({ cno, sex: m[3], aggt: '-', div, subjectsRaw: extra, subjects: [] });
      }
      if (div === 'PASSED' || div === 'FAILED') cur.tally[div] = (cur.tally[div] || 0) + 1;
      continue;
    }
    if (QT_KNOWN.test(line) || line.includes('<')) continue; // the next page's date line, or the end (</xmp>, </PRE>, the mirror's footer)
    unknownLine();
  }

  for (const c of centres) { finish(c); delete c.seen; delete c.unk; }
  if (!centres.length) issues.push('no centres found');
  return { year: state.year, centres, issues };
}
