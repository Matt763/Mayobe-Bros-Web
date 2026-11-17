// Parsers for the older Maktaba Tetea mirror of NECTA's PSLE (Standard Seven) pages, 2013 to 2019.
// The recent pages (2020 to 2025) are read by parsePsleSchool in necta-parse.mjs; this file covers what is different before them.
// Checked against real pages on 2026-11-10 (one or two schools per year, see scripts/tests/fixtures/psle-old/):
//  - The walk is the same as 2020 and 2021: index (psle.htm, 2014: psle2014.htm) -> reg_NN.htm -> distr_NNNN.htm -> shl_<code>.htm,
//    every link in the same folder. parseRegions and parseDistricts already read these pages. parseSchools does NOT read 2013 to 2015,
//    because there the file is shl_p0101114.htm and the label ends "- P0101114" (one letter P, no S); parsePsleOldSchools reads both
//    spellings and is a drop-in replacement for parseSchools in every PSLE year.
//  - 2013 to 2015 print the school code as P0101001 in the heading while the candidate numbers are PS0101001-001. Every code that
//    comes out of this file is written PS<digits>, so the heading code, the list code and the candidate-number prefix agree.
//  - The lines under the heading (registered, sat, average, school group, three ranks) are kept as facts, label and value as published.
//    The division table (JINSI, A to E) exists on some 2019 pages only; it is kept as the summary like parsePsleSchool does.
//  - Privacy (owner's decision): the CANDIDATE NAME and PREM NO columns are recognised by their header text and never read, so a
//    child's name or PREM number cannot reach the record, a note or a message. A table after the candidate table that looks personal
//    is dropped whole.
// The output is plain data, never markup. The record has the same shape as parsePsleSchool returns, so buildRecord, validateCentre
// and the packer take it unchanged.
import { anchors, rows, tables, text, parsePrimarySubjects } from './necta-parse.mjs';

/** PS0101001, P0101001 or ps0101001 -> PS0101001 (null for anything else). */
export function normalisePsleCode(code) {
  const m = /^PS?(\d{4,9})$/i.exec(String(code == null ? '' : code).trim());
  return m ? `PS${m[1]}` : null;
}

/**
 * School links of a PSLE district page: `shl_ps0101114.htm` (2016 and later, and 2013 to 2015 pages that already use PS) or
 * `shl_p0101114.htm` (2013 to 2015). Same shape as parseSchools: { code, name, href, file }, with code in capitals and written PS<digits>;
 * `file` is the file name as linked, so the page can still be fetched.
 */
export function parsePsleOldSchools(html) {
  const out = [];
  for (const a of anchors(html)) {
    const m = /(?:^|\/)shl_(ps?\d+)\.htm$/i.exec(a.href);
    if (!m) continue;
    const code = normalisePsleCode(m[1]);
    const name = a.label.replace(/\s*-\s*PS?\d+\s*$/i, '').trim();
    if (code && name) out.push({ code, name, href: a.href, file: `shl_${m[1].toLowerCase()}.htm` });
  }
  return out;
}

const FACT_LABEL = /^(WALIOSAJILIWA|WALIOFANYA MTIHANI|WASTANI WA SHULE|KUNDI LA SHULE|NAFASI YA SHULE(?: KWENYE KUNDI LAKE)?(?: [A-Z]+)?)$/;
const FACT_VALUE = /^[A-Za-z0-9][A-Za-z0-9 .,()/%+-]{0,59}$/;

/** The "LABEL : value" lines between the school heading and the first table, in the order published. Only known labels are kept. */
function factsOf(html) {
  const start = html.search(/<\/H3>/i);
  const end = html.search(/<TABLE\b/i);
  const region = html.slice(start < 0 ? 0 : start + 5, end < 0 ? undefined : end);
  const facts = [];
  const seen = new Set();
  for (const piece of region.split(/<br\s*\/?>/i)) {
    const m = /^([A-Z][A-Z ]+?)\s*:\s*(.+)$/.exec(text(piece));
    if (!m) continue;
    const label = m[1].replace(/\s+/g, ' ').trim();
    const value = m[2].trim();
    if (!FACT_LABEL.test(label) || !FACT_VALUE.test(value) || seen.has(label)) continue;
    seen.add(label);
    facts.push([label, value]);
  }
  return facts;
}

/** Which header text means which column. Name and PREM columns are recognised only to be skipped. */
function columnsOf(head) {
  const col = { cno: -1, sex: -1, subjects: -1 };
  head.forEach((h, i) => {
    const t = h.toUpperCase();
    if (/PREM/.test(t) || /NAME|JINA/.test(t)) return; // never read
    if (/^CAND/.test(t) && col.cno < 0) col.cno = i;
    else if (/^(SEX|JINSI)/.test(t) && col.sex < 0) col.sex = i;
    else if (/^(SUBJECT|SOMO|MASOMO)/.test(t) && col.subjects < 0) col.subjects = i;
  });
  return col;
}

/** Only a candidate number's own text may go into a note, never another cell of the row. */
const rowNote = (row, n) => (/^[A-Za-z]{1,2}\d{4,9}[/-]\d{1,5}$/.test(row[0] || '') ? `row ${n} (${row[0].toUpperCase()})` : `row ${n}`);

/** A table that holds names, PREM numbers or candidate numbers must not be kept as a block. */
function looksPersonal(r) {
  return r.some((row, i) => (i === 0 && row.some((c) => /NAME|JINA|PREM|^CAND/i.test(c))) || row.some((c) => /^\d{9,}$/.test(c) || /^PS?\d{4,9}-\d+$/i.test(c)));
}

/** Sections published after the candidate table, kept as published (same blocks as parsePsleSchool). */
function blocksFromRows(r) {
  const out = [];
  let rest = r;
  while (rest.length && rest[0].length === 1) { if (rest[0][0]) out.push({ t: 'h', v: rest[0][0] }); rest = rest.slice(1); }
  if (!rest.length) return out;
  if (rest.every((x) => x.length === 2)) out.push({ t: 'kv', rows: rest });
  else out.push({ t: 'grid', head: rest[0], rows: rest.slice(1) });
  return out;
}

/**
 * PSLE school page, 2013 to 2019 (it reads 2020 and later pages too, but parsePsleSchool is the one for those).
 * Candidates carry cno, sex, subjectsRaw and subjects (pairs when the cell can be rebuilt exactly, else []); never a name or a PREM number.
 * `expectCode` may be written P0101001 or PS0101001. Problems go into `issues`; nothing throws.
 */
export function parsePsleOldSchool(html, expectCode) {
  const issues = [];
  const h = /<H3[^>]*>([\s\S]*?)<\/H3>/i.exec(html);
  const heading = h ? text(h[1]) : '';
  const m = /^(.*?)\s*-\s*(PS?\d+)$/i.exec(heading);
  const code = m ? normalisePsleCode(m[2]) : null;
  const name = m ? m[1] : heading;
  const want = expectCode ? normalisePsleCode(expectCode) : null;
  if (!code) issues.push('no school heading');
  else if (expectCode && code !== want) issues.push(`heading code ${code} != ${want || String(expectCode).toUpperCase()}`);
  const facts = factsOf(html);
  let summary = null;
  const candidates = [];
  const overall = [];
  let afterCand = false;
  const seen = new Set();
  let n = 0;
  for (const t of tables(html)) {
    const r = rows(t);
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
        const mc = /^PS?(\d+)-(\d+)$/i.exec(cell(col.cno));
        if (row.length < r[0].length - 1 || !mc) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
        const cno = `PS${mc[1]}-${mc[2]}`;
        if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
        seen.add(cno);
        if (code && !cno.startsWith(`${code}-`)) issues.push(`candidate number ${cno} is not under ${code}`);
        const sex = cell(col.sex).toUpperCase();
        if (!/^[MF]$/.test(sex)) issues.push(`unknown sex in ${rowNote(row, n)}`);
        const raw = cell(col.subjects);
        // a sex cell that is not M or F is not copied (it could hold anything); the packer then stops on the empty value
        candidates.push({ cno, sex: /^[MF]$/.test(sex) ? sex : '', subjectsRaw: raw, subjects: parsePrimarySubjects(raw) });
      }
    }
  }
  if (!candidates.length) issues.push('no candidates found');
  return { code, name, facts, summary, overall, candidates, issues };
}
