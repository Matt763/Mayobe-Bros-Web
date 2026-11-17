// Parsers for the OLD Maktaba Tetea mirror layouts of Tanzania's CSEE (2003-2015) and ACSEE (2005-2015) results.
// The new-style pages (2020 and later, and the table pages of 2019) are read by parseSecondaryCentre in necta-parse.mjs; this file does
// not change it. The one-line-total pages of 2016-2019 have the same layout as 2013-2015 and are read here too: parseSecondaryCentre
// takes the whole total line into the centre name on them and finds no summary.
//
// What the old pages look like (checked against one centre page of every year, see scripts/tests/necta-parse-legacy.test.mjs):
//  - the exam index is one long page of links (`p0104.html`, `./P0104.html`, `P0103.HTM`, `'p0101.htm'` with single quotes) and,
//    in some years, a row of letter links (`index_a.htm`) that must not be taken for centres;
//  - the centre heading is an <H3> that may hold the code first (`P0101 AZANIA SECONDARY SCHOOL CENTRE`) or after the words
//    `CSEE 2003 EXAMINATION RESULTS FOR`, and a second <H3> inside it with a one-line total (`DIV-I = 0  DIV-II = 0 ...  FLD = 14`);
//  - 2003 to 2007 candidate numbers are bare (`0002`); the centre code is put in front here, as the new pages write them;
//  - a CANDIDATE NAME column sits between SEX and AGGT in CSEE 2003-2007 and 2009-2011 and in ACSEE 2005-2007 and 2010-2012 (not in
//    CSEE 2008 and 2012-2015, ACSEE 2009 and 2013-2016): it is found by its header text and NEVER read, so a name cannot reach any
//    output (privacy decision of the owner);
//  - the subjects cell is `CIV-X GEO-D` (2003-2012), or `PHY - 'F' CHEM - 'D'` (2013 and later), with NECTA's own subject codes
//    (3 to 7 letters, `G/STUDIES`, `B/MATH`, `BASIC A`);
//  - failed candidates are `FLD` up to 2012 and `0` from 2013; this file writes `0` for both (option keepFld keeps `FLD`);
//  - CSEE 2014 and ACSEE 2015 use GPA and CLASS (DISTINCTION, MERIT, CREDIT, PASS, FAIL) in place of AGGT and DIV; they are
//    returned as written in `aggt` (the GPA) and `div` (the class), and `layout.aggtColumn` / `layout.divColumn` say so.
// Everything returned is plain data; nothing is ever markup.

import { text, tables, rows, parseSecondarySubjects, CODE_RE } from './necta-parse.mjs';

/** Same shape as the packer's rawOf for secondary exams: the one spelling a subjects cell is rebuilt from. */
const rawSecondary = (pairs) => pairs.map(([n, g]) => `${n} - '${g}'`).join(' ');

// ------------------------------------------------------------------ links and the exam index

const LINK_RE = /<A\s+[^>]*?HREF\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)(?:<\/A>|(?=<A\s)|(?=<\/TD))/gi;

/** Links with double, single or no quotes around the address. Backslashes become slashes. */
function links(html) {
  const out = [];
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(html))) out.push({ href: (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/\\/g, '/'), label: text(m[4]) });
  return out;
}

/** An address on this site (no scheme, no host). */
const isLocal = (href) => href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//');

/**
 * Exam index page -> { centres: [{code, name, href}], letterPages: [href], issues }.
 * Centre links: `p0101.htm`, `P0101.HTM`, `./p0101.html`, `results/p0101.htm`. Letter links: `index_a.htm`, `indexfiles/index_a.htm`.
 * `href` is as published (backslashes turned into slashes). A repeated centre is reported and kept once.
 */
export function parseLegacyIndex(html) {
  const centres = [];
  const letterPages = [];
  const issues = [];
  const seen = new Set();
  const seenLetter = new Set();
  for (const a of links(html)) {
    if (!isLocal(a.href)) continue;
    const file = a.href.split(/[?#]/)[0];
    const letter = /^(?:\.?\/)?(?:indexfiles\/)?index_[a-z]\.html?$/i.test(file);
    if (letter) {
      const k = file.toLowerCase();
      if (!seenLetter.has(k)) { seenLetter.add(k); letterPages.push(a.href); }
      continue;
    }
    const m = /^(?:\.?\/)?(?:results\/)?([a-z]{1,2}\d{4,9})\.html?$/i.exec(file);
    if (!m) continue;
    const hrefCode = m[1].toUpperCase();
    const parts = a.label.split(' ');
    const code = (parts.shift() || '').toUpperCase();
    const name = parts.join(' ').trim();
    if (!CODE_RE.test(code) || code !== hrefCode) { issues.push(`label/href mismatch: "${a.label}" vs ${a.href}`); continue; }
    if (seen.has(code)) { issues.push(`duplicate centre ${code}`); continue; }
    if (!name) issues.push(`empty name: ${code}`); // the centre is kept: its own page has the name
    seen.add(code);
    centres.push({ code, name, href: a.href });
  }
  return { centres, letterPages, issues };
}

// ------------------------------------------------------------------ subjects

// One `NAME-G` item: a name of capitals, digits, spaces and / . & ( ) +, a hyphen, one grade letter, then a space or the end.
const HYPHEN_ITEM = /\s*([A-Z0-9][A-Z0-9 /.&()+']*?)\s*-\s*([A-Z])(?=\s|$)/iy;

/** `CIV-X GEO-D`, `G/STUDIES-S`, `BASIC A-F` -> [[name, grade]]. [] unless the whole cell is read. */
export function parseHyphenSubjects(s) {
  const out = [];
  let pos = 0;
  while (pos < s.length) {
    HYPHEN_ITEM.lastIndex = pos;
    const m = HYPHEN_ITEM.exec(s);
    if (!m) return [];
    out.push([m[1].trim(), m[2].toUpperCase()]);
    pos = HYPHEN_ITEM.lastIndex;
  }
  return out;
}

/**
 * One DETAILED SUBJECTS cell -> { subjects, raw }.
 * Pairs are given only when the whole cell is read AND no subject code is repeated (a repeated code, such as `ENG` twice in CSEE 2003,
 * cannot be told apart, and the packer needs one place per subject); then `raw` is the one spelling the packer rebuilds from the
 * pairs (`CIV - 'X' GEO - 'D'`). Otherwise subjects is [] and raw is the cell as published (`---`, `Results Withheld`, `CIV-F B/KNOWL -`,
 * a grade such as `B+`).
 */
export function readSubjects(cell) {
  const pairs = cell.includes("'") ? parseSecondarySubjects(cell) : parseHyphenSubjects(cell);
  if (!pairs.length || new Set(pairs.map((p) => p[0])).size !== pairs.length) return { subjects: [], raw: cell };
  return { subjects: pairs, raw: rawSecondary(pairs) };
}

// ------------------------------------------------------------------ one centre page

/** Sections published after the candidate table (none seen in the old years), kept as published like parseSecondaryCentre. */
function blocksFromRows(r) {
  const out = [];
  let rest = r;
  while (rest.length && rest[0].length === 1) { if (rest[0][0]) out.push({ t: 'h', v: rest[0][0] }); rest = rest.slice(1); }
  if (!rest.length) return out;
  if (rest.every((x) => x.length === 2)) out.push({ t: 'kv', rows: rest });
  else out.push({ t: 'grid', head: rest[0], rows: rest.slice(1) });
  return out;
}

/** Only a candidate number's own text may go into a note, never another cell of the row. */
const rowNote = (row, n) => (/^(?:[A-Za-z]{1,2}\d{4,9}[/-])?\d{1,5}$/.test(row[0] || '') ? `row ${n} (${row[0].toUpperCase()})` : `row ${n}`);

/**
 * Which header text means which column. A name column and a PREM column are recognised only to be skipped.
 * AGGT or GPA, DIV or CLASS: the two result columns have different names in CSEE 2014 and ACSEE 2015.
 */
function legacyColumns(head) {
  const col = { cno: -1, sex: -1, aggt: -1, div: -1, subjects: -1 };
  head.forEach((h, i) => {
    const t = h.toUpperCase().trim();
    if (/PREM/.test(t) || /NAME|JINA/.test(t)) return; // never read
    if (/^(CNO|CAND)/.test(t) && col.cno < 0) col.cno = i;
    else if (/^SEX/.test(t) && col.sex < 0) col.sex = i;
    else if (/^(AGG|GPA|POINT)/.test(t) && col.aggt < 0) col.aggt = i;
    else if (/^(DIV|CLASS)/.test(t) && col.div < 0) col.div = i;
    else if (/SUBJECT/.test(t) && col.subjects < 0) col.subjects = i;
  });
  return col;
}

/**
 * The first heading that starts with a centre code. Old pages nest a second <H3> (the one-line total) inside the first and
 * close it with the wrong tag, so a heading ends at the next heading tag of any kind.
 */
function findHeading(page) {
  const re = /<H([1-4])\b[^>]*>([\s\S]*?)(?=<\/H[1-6]>|<H[1-6]\b|$)/gi;
  let m;
  while ((m = re.exec(page))) {
    const t = text(m[2]);
    const h = /^(?:.*?\bRESULTS\s+FOR\s+)?([A-Z]{1,2}\d{4,9})(?:\s+(.*))?$/i.exec(t);
    if (h) return { code: h[1].toUpperCase(), name: (h[2] || '').trim(), at: m.index };
  }
  return null;
}

/** `DIV-I = 0  DIV-II = 0  DIV-IV = 29  FLD = 14` or `DISTINCTION = 0; MERIT = 1 ...` -> a one-row summary, or null. */
function summaryFromLine(region, keepFld) {
  const heads = [];
  const nums = [];
  const re = /\b([A-Z][A-Z0-9-]*)\s*=\s*(\d{1,6})\b/gi;
  let m;
  while ((m = re.exec(region))) {
    let label = m[1].toUpperCase();
    const d = /^DIV-(0|I{1,3}|IV)$/.exec(label);
    if (d) label = d[1];
    else if (label === 'FLD' && !keepFld) label = '0';
    heads.push(label);
    nums.push(m[2]);
  }
  if (heads.length < 4 || new Set(heads).size !== heads.length) return null;
  return { head: ['SEX', ...heads], rows: [['T', ...nums]] };
}

/**
 * CSEE / ACSEE centre page in an old layout.
 * -> { code, name, summary, overall, facts, candidates: [{cno, sex, aggt, div, subjectsRaw, subjects}], issues, layout }
 *  - summary is the SEX table when the page has one ({head, rows}); otherwise the one-line total as a single `T` row
 *    (head `SEX, I, II, III, IV, 0`, or `SEX, DISTINCTION, MERIT, CREDIT, PASS, FAIL`); null when the page has neither;
 *  - facts is always []; layout says what was found: { summaryKind: 'table'|'line'|null, bareNumbers, aggtColumn, divColumn, exam, year };
 *  - the candidate NAME column and any PREM column are never read.
 */
export function parseLegacyCentre(html, expectCode, opts = {}) {
  const issues = [];
  const keepFld = !!opts.keepFld;
  const at = html.search(/<BODY/i);
  const page = at >= 0 ? html.slice(at) : html;
  const heading = findHeading(page);
  const code = heading ? heading.code : null;
  const want = expectCode ? String(expectCode).toUpperCase() : code;
  if (!code) issues.push('no centre heading');
  else if (expectCode && code !== want) issues.push(`heading code ${code} != ${want}`);

  const layout = { summaryKind: null, bareNumbers: false, aggtColumn: null, divColumn: null, exam: null, year: null };
  const ey = /\b(A?CSEE)\s+(\d{4})\b/i.exec(text(page.slice(0, (heading ? heading.at : 0) + 400)));
  if (ey) { layout.exam = ey[1].toUpperCase(); layout.year = Number(ey[2]); }

  let summary = null;
  const firstTable = page.search(/<TABLE\b/i);
  if (heading && firstTable > heading.at) {
    summary = summaryFromLine(text(page.slice(heading.at, firstTable)), keepFld);
    if (summary) layout.summaryKind = 'line';
  }

  const candidates = [];
  const overall = [];
  const seen = new Set();
  let afterCand = false;
  let n = 0;
  for (const t of tables(page)) {
    const r = rows(t);
    if (!r.length) continue;
    if (afterCand) { overall.push(...blocksFromRows(r)); continue; }
    if (/^SEX$/i.test(r[0][0]) && layout.summaryKind !== 'table') { summary = { head: r[0], rows: r.slice(1) }; layout.summaryKind = 'table'; continue; }
    if (!r[0].some((h) => /^(CNO|CAND)/i.test(h))) continue; // the number column need not be the first
    afterCand = true;
    const head = r[0];
    const col = legacyColumns(head);
    if (Object.values(col).some((i) => i < 0)) { issues.push('unknown candidate columns'); continue; }
    layout.aggtColumn = head[col.aggt].toUpperCase();
    layout.divColumn = head[col.div].toUpperCase();
    for (const row of r.slice(1)) {
      n++;
      const cell = (i) => row[i] || '';
      const m = /^(?:([A-Z]{1,2}\d{4,9})([/-]))?(\d{1,5})$/i.exec(cell(col.cno));
      if (row.length !== head.length || !m || (!m[1] && !want)) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
      if (!m[1]) layout.bareNumbers = true;
      const cno = (m[1] ? m[1] + m[2] + m[3] : `${want}/${m[3]}`).toUpperCase();
      const sex = cell(col.sex).toUpperCase();
      const aggt = cell(col.aggt).toUpperCase();
      let div = cell(col.div).toUpperCase();
      if (div === 'FLD' && !keepFld) div = '0';
      if (!/^[FM]$/.test(sex) || !/^(-|\*[A-Z0-9]{1,3}|\d{1,3}(\.\d{1,3})?)$/.test(aggt) || !/^[A-Z0-9*-]{1,12}$/.test(div)) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
      if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
      seen.add(cno);
      const s = readSubjects(cell(col.subjects));
      candidates.push({ cno, sex, aggt, div, subjectsRaw: s.raw, subjects: s.subjects });
    }
  }
  if (!candidates.length) issues.push('no candidates found');
  return { code, name: heading ? heading.name : '', summary, overall, facts: [], candidates, issues, layout };
}
