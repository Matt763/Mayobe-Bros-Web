// Parsers for NECTA results HTML (onlinesys.necta.go.tz, matokeo.necta.go.tz and the maktaba.tetea.org mirror).
// Ported from the Results project's parse.js, with these changes:
//  - codes and candidate numbers are matched without regard to case and always returned in capitals
//    (NECTA publishes a few as `s5405` and `p5980/0001`);
//  - index links may be `results/<code>.htm`, `results\<code>.htm` or the flat `<code>.htm` of the mirror;
//  - PSLE tables are read by the TEXT of their column headers; the candidate NAME column and the PREM NO column
//    are never read, so they cannot reach any output (privacy decision of the owner);
//  - a subjects cell that cannot be rebuilt exactly from the pairs found keeps only its raw text (subjects = []).
// The tolerant tokenizer stays: the output is plain data, never markup.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeBuffer(buf) {
  return new TextDecoder('windows-1252').decode(buf).replace(/^﻿/, '');
}

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip tags and entities, collapse whitespace. The result is inert text. */
export function text(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function anchors(html) {
  const out = [];
  const re = /<A\s+[^>]*?HREF\s*=\s*"?([^">\s]+)"?[^>]*>([\s\S]*?)(?:<\/A>|(?=<A\s)|(?=<\/TD))/gi;
  let m;
  while ((m = re.exec(html))) out.push({ href: m[1].replace(/\\/g, '/'), label: text(m[2]) });
  return out;
}

export function rows(tableHtml) {
  const out = [];
  for (const tr of tableHtml.split(/<TR\b[^>]*>/i).slice(1)) {
    const cells = [];
    const re = /<TD\b[^>]*>([\s\S]*?)(?=<TD\b|<\/TR|$)/gi;
    let m;
    while ((m = re.exec(tr))) cells.push(text(m[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}

export function tables(html) {
  // NECTA sometimes writes `<TABLE ... <TR>` without the closing `>`; take attributes up to the first tag/bracket.
  return html.split(/<TABLE\b/i).slice(1).map((chunk) => {
    const k = chunk.search(/[<>]/);
    const body = k < 0 ? '' : chunk[k] === '>' ? chunk.slice(k + 1) : chunk.slice(k);
    return body.split(/<\/TABLE>/i)[0];
  });
}

/** Sections published after the candidate table (centre overall performance, centre ranking), kept as published. */
function blocksFromRows(r) {
  const out = [];
  let rest = r;
  while (rest.length && rest[0].length === 1) { if (rest[0][0]) out.push({ t: 'h', v: rest[0][0] }); rest = rest.slice(1); }
  if (!rest.length) return out;
  if (rest.every((x) => x.length === 2)) out.push({ t: 'kv', rows: rest });
  else out.push({ t: 'grid', head: rest[0], rows: rest.slice(1) });
  return out;
}

export const CODE_RE = /^[A-Z]{1,2}\d{4,9}$/;

/** Only a candidate number's own text may go into a note, never another cell of the row. */
const rowNote = (row, n) => (/^[A-Za-z]{1,2}\d{4,9}[/-]\d{1,5}$/.test(row[0] || '') ? `row ${n} (${row[0].toUpperCase()})` : `row ${n}`);

/** CSEE/ACSEE index page -> centres. `href` is as published (backslashes turned into slashes). */
export function parseExamIndex(html) {
  const centres = [];
  const seen = new Set();
  const issues = [];
  for (const a of anchors(html)) {
    const m = /^(?:\.?\/)?(?:results\/)?([a-z]{1,2}\d{4,9})\.htm$/i.exec(a.href);
    if (!m) continue;
    const hrefCode = m[1].toUpperCase();
    const parts = a.label.split(' ');
    const code = (parts.shift() || '').toUpperCase();
    const name = parts.join(' ').trim();
    if (!CODE_RE.test(code) || code !== hrefCode) { issues.push(`label/href mismatch: "${a.label}" vs ${a.href}`); continue; }
    if (!name) { issues.push(`empty name: ${code}`); continue; }
    if (seen.has(code)) { issues.push(`duplicate centre ${code}`); continue; }
    seen.add(code);
    centres.push({ code, name, href: a.href });
  }
  return { centres, issues };
}

/** PSLE hierarchy pages. Links may carry a folder prefix (`results/reg_01.htm`) or none (`reg_01.htm`). */
export function parseRegions(html) {
  return anchors(html).map((a) => { const m = /(?:^|\/)(reg_\d+)\.htm$/i.exec(a.href); return m && { href: a.href, file: m[1].toLowerCase() + '.htm', name: a.label }; }).filter(Boolean);
}
export function parseDistricts(html) {
  return anchors(html).map((a) => { const m = /(?:^|\/)(distr_\d+)\.htm$/i.exec(a.href); return m && { href: a.href, file: m[1].toLowerCase() + '.htm', name: a.label }; }).filter(Boolean);
}
export function parseSchools(html) {
  const out = [];
  for (const a of anchors(html)) {
    const m = /(?:^|\/)shl_(ps\d+)\.htm$/i.exec(a.href);
    if (!m) continue;
    const code = m[1].toUpperCase();
    const label = a.label.replace(/\s*-\s*PS\d+\s*$/i, '').trim();
    if (label) out.push({ code, name: label, href: a.href, file: `shl_${m[1].toLowerCase()}.htm` });
  }
  return out;
}

/** How the packer (scripts/lib/results-pack.mjs rawOf) rebuilds a cell from its pairs. */
const rawSecondary = (pairs) => pairs.map(([n, g]) => `${n} - '${g}'`).join(' ');
const rawPrimary = (pairs) => pairs.map(([n, g]) => `${n} - ${g}`).join(', ');

export function parseSecondarySubjects(s) {
  const out = [];
  const re = /([A-Z0-9][A-Z0-9 /.&()+-]*?)\s*-\s*'([^'\s])'/gi;
  let m;
  while ((m = re.exec(s))) out.push([m[1].trim(), m[2].trim()]);
  return out.length && rawSecondary(out) === s ? out : [];
}

export function parsePrimarySubjects(s) {
  const out = [];
  for (const part of s.split(',')) {
    const p = /^(.*?)\s+-\s+([A-Z])$/i.exec(part.trim());
    if (p) out.push([p[1].trim(), p[2].toUpperCase()]);
  }
  return out.length && rawPrimary(out) === s ? out : [];
}

const headingOf = (html) => { const h = /<H3[^>]*>([\s\S]*?)<\/H3>/i.exec(html); return h ? text(h[1]) : ''; };

/** CSEE/ACSEE centre page. */
export function parseSecondaryCentre(html, expectCode) {
  const issues = [];
  const heading = headingOf(html);
  const m = /^([A-Z]{1,2}\d{4,9})\s+(.*)$/i.exec(heading);
  const code = m ? m[1].toUpperCase() : null;
  if (!code) issues.push('no centre heading');
  else if (expectCode && code !== String(expectCode).toUpperCase()) issues.push(`heading code ${code} != ${String(expectCode).toUpperCase()}`);
  let summary = null;
  const candidates = [];
  const overall = [];
  let afterCand = false;
  const seen = new Set();
  let n = 0;
  for (const t of tables(html)) {
    const r = rows(t);
    if (!r.length) continue;
    if (afterCand) { overall.push(...blocksFromRows(r)); continue; }
    if (/^SEX$/i.test(r[0][0]) && !summary) summary = { head: r[0], rows: r.slice(1) };
    if (/^CNO$/i.test(r[0][0])) {
      afterCand = true;
      for (const row of r.slice(1)) {
        n++;
        if (row.length < 5 || !/^[A-Z]{1,2}\d{4,9}[/-]\d+$/i.test(row[0])) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
        const cno = row[0].toUpperCase();
        if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
        seen.add(cno);
        candidates.push({ cno, sex: row[1], aggt: row[2], div: row[3], subjectsRaw: row[4], subjects: parseSecondarySubjects(row[4]) });
      }
    }
  }
  if (!candidates.length) issues.push('no candidates found');
  return { code, name: m ? m[2] : '', summary, overall, candidates, issues };
}

/** Which header text means which column. Name and PREM columns are recognised only to be skipped. */
function psleColumns(head) {
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

/** PSLE school page. Candidates carry cno, sex, subjectsRaw and subjects; never a name or a PREM number. */
export function parsePsleSchool(html, expectCode) {
  const issues = [];
  const heading = headingOf(html);
  const m = /^(.*?)\s*-\s*(PS\d+)$/i.exec(heading);
  const code = m ? m[2].toUpperCase() : null;
  const name = m ? m[1] : heading;
  if (!code) issues.push('no school heading');
  else if (expectCode && code !== String(expectCode).toUpperCase()) issues.push(`heading code ${code} != ${String(expectCode).toUpperCase()}`);
  const facts = [];
  const sat = /WALIOFANYA MTIHANI\s*:\s*(\d+)/i.exec(html); if (sat) facts.push(['WALIOFANYA MTIHANI', sat[1]]);
  const avg = /WASTANI WA SHULE\s*:\s*([\d.]+)/i.exec(html); if (avg) facts.push(['WASTANI WA SHULE', avg[1]]);
  const dar = /DARAJA\s+([A-E][^<]*)/i.exec(html); if (dar) facts.push(['DARAJA', text(dar[0])]);
  let summary = null;
  const candidates = [];
  const overall = [];
  let afterCand = false;
  const seen = new Set();
  let n = 0;
  for (const t of tables(html)) {
    const r = rows(t);
    if (!r.length) continue;
    if (afterCand) { overall.push(...blocksFromRows(r)); continue; }
    if (/^JINSI$/i.test(r[0][0]) && !summary) summary = { head: r[0], rows: r.slice(1) };
    if (/^CAND/i.test(r[0][0])) {
      afterCand = true;
      const col = psleColumns(r[0]);
      if (col.cno < 0 || col.sex < 0 || col.subjects < 0) { issues.push('unknown candidate columns'); continue; }
      for (const row of r.slice(1)) {
        n++;
        const cell = (i) => row[i] || '';
        if (row.length < r[0].length - 1 || !/^PS\d+-\d+$/i.test(cell(col.cno))) { issues.push(`skipped ${rowNote(row, n)}`); continue; }
        const cno = cell(col.cno).toUpperCase();
        if (seen.has(cno)) { issues.push(`duplicate candidate ${cno}`); continue; }
        seen.add(cno);
        const raw = cell(col.subjects);
        candidates.push({ cno, sex: cell(col.sex), subjectsRaw: raw, subjects: parsePrimarySubjects(raw) });
      }
    }
  }
  if (!candidates.length) issues.push('no candidates found');
  return { code, name, facts, summary, overall, candidates, issues };
}
