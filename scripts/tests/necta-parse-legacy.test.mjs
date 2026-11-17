// Offline tests of the parsers for the OLD Maktaba Tetea layouts (CSEE 2003-2015, ACSEE 2005-2015; also the one-line-total
// pages of 2016-2019). Nothing here touches the network.
//  - scripts/tests/fixtures/legacy/*.html are SCRUBBED copies of real pages: every candidate name is "CANDIDATE n", trimmed to
//    about ten rows, no analytics code. They are what the table-driven tests read.
//  - the full real pages (names included) are read only when they are present in $MB_LEGACY_RAW (default
//    ~/.cache/mb-recon/legacy, never inside the repo); those tests are skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/necta-parse.mjs';
import { parseLegacyIndex, parseLegacyCentre, parseHyphenSubjects, readSubjects } from '../lib/necta-parse-legacy.mjs';
import { examDef } from '../lib/necta-exams.mjs';
import { validateCentre } from '../necta-import.mjs';
import { learnMeta, packCentre, verifyCentre } from '../lib/results-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'legacy');
const RAW = process.env.MB_LEGACY_RAW || path.join(os.homedir(), '.cache', 'mb-recon', 'legacy');
const fixture = (name) => P.decodeBuffer(fs.readFileSync(path.join(FIX, name + '.html')));
const real = (name) => (fs.existsSync(path.join(RAW, name + '.html')) ? P.decodeBuffer(fs.readFileSync(path.join(RAW, name + '.html'))) : null);
const DEF = examDef('csee-2025'); // any secondary exam: validateCentre only looks at the kind

// Invented names, never taken from a real page (the real-page tests read the names from the page at run time).
const NAMES = ['JUMA HASSANI KIMARIO', 'ASHA SAIDI MBWANA', "PETER JOHN O'MALLYA", 'GRACE ELIA NYAGAWA', 'RAMADHANI ALLY SHAYO', 'ZAINAB MUSSA KAPINGA',
  'DANIEL YOHANA MUSHI', 'NEEMA FRANK LYIMO', 'OMARY ISSA CHAMBO', 'REHEMA JOSEPH SANGA', 'ELIAS PAUL MWAKASEGE', 'FATUMA HAMISI MZEE'];

// ---- what each fixture must give: [file, exam, year, code, candidates, kept as text, bare numbers, summary T row, [aggt column, div column]]
const NO = null;
const LINE5 = (...n) => ['T', ...n];
const CENTRES = [
  ['csee-2003-p0104', 'CSEE', 2003, 'P0104', 1, 1, true, NO, ['AGGT', 'DIV']],
  ['csee-2004-p0104', 'CSEE', 2004, 'P0104', 2, 0, true, NO, ['AGGT', 'DIV']],
  ['csee-2005-p0104', 'CSEE', 2005, 'P0104', 10, 1, true, NO, ['AGGT', 'DIV']],
  ['csee-2006-p0104', 'CSEE', 2006, 'P0104', 10, 1, true, NO, ['AGGT', 'DIV']],
  ['csee-2007-p0103', 'CSEE', 2007, 'P0103', 3, 0, true, NO, ['AGGT', 'DIV']],
  ['csee-2008-p0101', 'CSEE', 2008, 'P0101', 4, 0, false, LINE5('0', '0', '0', '3', '1', '0'), ['AGGT', 'DIV']],
  ['csee-2009-p0101', 'CSEE', 2009, 'P0101', 10, 0, false, LINE5('0', '0', '0', '8', '6'), ['AGGT', 'DIV']],
  ['csee-2010-p0101', 'CSEE', 2010, 'P0101', 10, 0, false, LINE5('0', '0', '0', '10', '2'), ['AGGT', 'DIV']],
  ['csee-2011-p0101', 'CSEE', 2011, 'P0101', 10, 1, false, LINE5('0', '0', '0', '29', '14'), ['AGGT', 'DIV']],
  ['csee-2012-p0101', 'CSEE', 2012, 'P0101', 10, 0, false, LINE5('0', '0', '0', '9', '25'), ['AGGT', 'DIV']],
  ['csee-2013-p0101', 'CSEE', 2013, 'P0101', 10, 1, false, LINE5('0', '0', '0', '24', '14'), ['AGGT', 'DIV']],
  ['csee-2014-p0101', 'CSEE', 2014, 'P0101', 10, 1, false, LINE5('0', '0', '2', '24', '19'), ['GPA', 'CLASS']],
  ['csee-2015-p0101', 'CSEE', 2015, 'P0101', 10, 0, false, LINE5('0', '0', '0', '21', '24'), ['AGGT', 'DIV']],
  ['acsee-2005-p0110', 'ACSEE', 2005, 'P0110', 10, 0, true, NO, ['AGGT', 'DIV']],
  ['acsee-2006-p0112', 'ACSEE', 2006, 'P0112', 10, 0, true, NO, ['AGGT', 'DIV']],
  ['acsee-2007-p0110', 'ACSEE', 2007, 'P0110', 10, 0, true, NO, ['AGGT', 'DIV']],
  ['acsee-2009-p0110', 'ACSEE', 2009, 'P0110', 10, 1, false, LINE5('6', '28', '134', '90', '101'), ['AGGT', 'DIV']],
  ['acsee-2010-p0101', 'ACSEE', 2010, 'P0101', 10, 0, false, LINE5('0', '0', '4', '9', '22'), ['AGGT', 'DIV']],
  ['acsee-2011-p0101', 'ACSEE', 2011, 'P0101', 10, 0, false, LINE5('0', '0', '7', '13', '18'), ['AGGT', 'DIV']],
  ['acsee-2012-p0101', 'ACSEE', 2012, 'P0101', 10, 0, false, LINE5('0', '0', '6', '12', '21'), ['AGGT', 'DIV']],
  ['acsee-2013-p0101', 'ACSEE', 2013, 'P0101', 10, 0, false, LINE5('0', '0', '2', '8', '20'), ['AGGT', 'DIV']],
  ['acsee-2014-p0101', 'ACSEE', 2014, 'P0101', 10, 1, false, LINE5('0', '1', '1', '12', '19'), ['AGGT', 'DIV']],
  ['acsee-2015-p0101', 'ACSEE', 2015, 'P0101', 10, 1, false, ['T', '0', '1', '5', '11', '22'], ['GPA', 'CLASS']],
  ['acsee-2016-p0101', 'ACSEE', 2016, 'P0101', 10, 0, false, LINE5('0', '2', '10', '12', '19'), ['AGGT', 'DIV']],
];
// the first five of the six-column sums: I, II, III, IV, 0 (the class pages carry their own words, see below)
const CLASS_HEAD = ['SEX', 'DISTINCTION', 'MERIT', 'CREDIT', 'PASS', 'FAIL'];
const DIV_HEAD = ['SEX', 'I', 'II', 'III', 'IV', '0'];

/** Cells of the data rows read by position, independent of the parser's own column finding (NAME sits after SEX when present). */
function oracleRows(html) {
  const t = P.tables(html).map(P.rows).find((r) => /^(CNO|CAND)/i.test(r[0][0]));
  const off = t[0].some((h) => /NAME/i.test(h)) ? 1 : 0;
  return t.slice(1).map((r) => ({ no: r[0], sex: r[1], aggt: r[2 + off], div: r[3 + off], subj: r[4 + off] }));
}

function checkAgainstOracle(html, code, r, label) {
  const want = oracleRows(html);
  assert.equal(r.candidates.length, want.length, `${label}: candidate count`);
  want.forEach((w, i) => {
    const c = r.candidates[i];
    assert.equal(c.cno, /^\d+$/.test(w.no) ? `${code}/${w.no}` : w.no.toUpperCase(), `${label}: cno ${i}`);
    assert.equal(c.sex, w.sex, `${label}: sex ${c.cno}`);
    assert.equal(c.aggt, w.aggt, `${label}: aggt ${c.cno}`);
    assert.equal(c.div, w.div === 'FLD' ? '0' : w.div, `${label}: div ${c.cno}`);
    if (c.subjects.length) assert.equal(c.subjects.flat().join('').replace(/\s/g, ''), w.subj.replace(/[\s'-]/g, ''), `${label}: subjects ${c.cno}`);
    else assert.equal(c.subjectsRaw, w.subj, `${label}: text ${c.cno}`);
  });
}

for (const [file, exam, year, code, count, texts, bare, total, [aggtCol, divCol]] of CENTRES) {
  test(`${exam} ${year}: scrubbed fixture reads as the page says`, () => {
    const html = fixture(file);
    const r = parseLegacyCentre(html, code);
    assert.equal(r.code, code);
    assert.match(r.name, /^[A-Z' ]+ SECONDARY SCHOOL( CENTRE)?$/);
    assert.deepEqual(r.issues, []);
    assert.equal(r.candidates.length, count);
    assert.equal(r.candidates.filter((c) => !c.subjects.length).length, texts, 'cells kept as text');
    assert.deepEqual(r.layout, { summaryKind: total ? 'line' : null, bareNumbers: bare, aggtColumn: aggtCol, divColumn: divCol, exam, year });
    assert.deepEqual(r.facts, []);
    assert.deepEqual(r.overall, []);
    if (total) assert.deepEqual(r.summary, { head: total.length === 7 ? [...DIV_HEAD, 'ABS'] : aggtCol === 'GPA' ? CLASS_HEAD : DIV_HEAD, rows: [total] });
    else assert.equal(r.summary, null);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c), ['cno', 'sex', 'aggt', 'div', 'subjectsRaw', 'subjects']);
      assert.ok(c.cno.startsWith(code + '/'), c.cno);
      assert.match(c.sex, /^[FM]$/);
    }
    assert.equal(validateCentre(DEF, code, r), null);
    checkAgainstOracle(html, code, r, file);
  });
}

// ---- privacy: no name and no PREM number can reach the output
test('candidate names never reach the output (every fixture, names put back at run time)', () => {
  let tested = 0;
  for (const [file, , , code] of CENTRES) {
    const html = fixture(file);
    if (!/CANDIDATE \d+/.test(html)) continue;
    tested++;
    const withNames = html.replace(/CANDIDATE (\d+)/g, (m, n) => NAMES[Number(n) % NAMES.length]);
    assert.notEqual(withNames, html);
    const r = parseLegacyCentre(withNames, code);
    const out = JSON.stringify(r);
    for (const n of NAMES) assert.ok(!out.includes(n), `${file}: ${n} leaked`);
    for (const word of NAMES.flatMap((n) => n.split(' '))) if (word.length > 4) assert.ok(!out.includes(word), `${file}: ${word} leaked`);
    assert.deepEqual(r, parseLegacyCentre(html, code), `${file}: names change nothing`);
  }
  assert.ok(tested >= 10, `${tested} fixtures with a name column`);
});

test('columns are found by their header text: name and PREM columns anywhere are skipped', () => {
  const td = (t) => `<TD><FONT SIZE=1>${t}</FONT></TD>`;
  const tr = (cells) => `<TR>${cells.map(td).join('')}</TR>`;
  const page = (head, body) => `<HTML><BODY><H1>CSEE 2011 EXAMINATION RESULTS</H1><H3>P0101 AZANIA SECONDARY SCHOOL CENTRE</H3><TABLE>${tr(head)}${body.map(tr).join('')}</TABLE></BODY></HTML>`;
  const rowsOf = (...cols) => NAMES.slice(0, 3).map((n, i) => cols.map((c) => (typeof c === 'function' ? c(n, i) : c)));
  const prem = (n, i) => `2015${i}57239`;
  const html = page(['PREM NO', 'CAND. NO', 'CANDIDATE NAME', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'],
    rowsOf(prem, (n, i) => `P0101/000${i + 1}`, (n) => n, 'F', '25', 'III', "CIV - 'C' GEO - 'D'"));
  const r = parseLegacyCentre(html, 'P0101');
  assert.deepEqual(r.candidates.map((c) => [c.cno, c.sex, c.aggt, c.div]), [['P0101/0001', 'F', '25', 'III'], ['P0101/0002', 'F', '25', 'III'], ['P0101/0003', 'F', '25', 'III']]);
  const out = JSON.stringify(r);
  for (const n of NAMES.slice(0, 3)) assert.ok(!out.includes(n));
  for (const i of [0, 1, 2]) assert.ok(!out.includes(prem(null, i)));
  // a column with an unknown header is not read (a name there cannot get out), and a missing known column refuses the table
  const odd = parseLegacyCentre(page(['CNO', 'SEX', 'WHO', 'AGGT', 'DIV', 'DETAILED SUBJECTS'], rowsOf((n, i) => `P0101/000${i + 1}`, 'F', (n) => n, '-', 'IV', "CIV - 'C'")), 'P0101');
  assert.equal(odd.candidates.length, 3);
  assert.ok(!JSON.stringify(odd).includes(NAMES[0]));
  const short = parseLegacyCentre(page(['CNO', 'SEX', 'CANDIDATE NAME', 'AGGT', 'DETAILED SUBJECTS'], rowsOf((n, i) => `P0101/000${i + 1}`, 'F', (n) => n, '-', "CIV - 'C'")), 'P0101');
  assert.equal(short.candidates.length, 0);
  assert.match(short.issues.join(), /unknown candidate columns/);
  assert.ok(!JSON.stringify(short).includes(NAMES[0]));
});

test('rows that do not fit are skipped and noted, and a note holds only a candidate number', () => {
  const td = (t) => `<TD>${t}</TD>`;
  const tr = (cells) => `<TR>${cells.map(td).join('')}</TR>`;
  const head = ['CNO', 'SEX', 'CANDIDATE NAME', 'AGGT', 'DIV', 'DETAILED SUBJECTS'];
  const ok = (i) => [`P0102/000${i}`, 'M', NAMES[i], '21', 'III', "CIV - 'C'"];
  const rowsList = [ok(1), ['P0102/0002', 'X', NAMES[2], '21', 'III', "CIV - 'C'"], [NAMES[3], 'F', NAMES[3], '21', 'III', "CIV - 'C'"], ['P0102/0004', 'F', NAMES[4], NAMES[4], 'III', "CIV - 'C'"],
    ['P0102/0005', 'F', NAMES[5]], ok(1), ['P0102/0007', 'F', NAMES[6], '9', 'I', 'Results Withheld']];
  const html = `<HTML><BODY><H3>P0102 SOME SECONDARY SCHOOL CENTRE</H3><TABLE>${tr(head)}${rowsList.map(tr).join('')}</TABLE></BODY></HTML>`;
  const r = parseLegacyCentre(html, 'P0102');
  assert.deepEqual(r.candidates.map((c) => c.cno), ['P0102/0001', 'P0102/0007']);
  assert.deepEqual(r.issues, ['skipped row 2 (P0102/0002)', 'skipped row 3', 'skipped row 4 (P0102/0004)', 'skipped row 5 (P0102/0005)', 'duplicate candidate P0102/0001']);
  assert.equal(r.candidates[1].subjectsRaw, 'Results Withheld');
  assert.deepEqual(r.candidates[1].subjects, []);
  const out = JSON.stringify(r);
  for (const n of NAMES.slice(0, 8)) assert.ok(!out.includes(n), n);
  assert.match(validateCentre(DEF, 'P0102', r), /duplicate/);
});

// ---- numbers, headings, validation
test('bare candidate numbers get the centre code in front; written ones are kept', () => {
  const r = parseLegacyCentre(fixture('csee-2005-p0104'), 'P0104');
  assert.deepEqual(r.candidates.slice(0, 3).map((c) => c.cno), ['P0104/0001', 'P0104/0002', 'P0104/0003']);
  assert.equal(r.layout.bareNumbers, true);
  assert.equal(parseLegacyCentre(fixture('csee-2011-p0101'), 'P0101').candidates[0].cno, 'P0101/0001');
  // the expected code is compared without case, and a lowercase heading is read
  const low = fixture('csee-2007-p0103').replace('P0103 BIHAWANA', 'p0103 BIHAWANA');
  const l = parseLegacyCentre(low, 'p0103');
  assert.equal(l.code, 'P0103');
  assert.deepEqual(l.issues, []);
  assert.equal(l.candidates[0].cno, 'P0103/0001');
});

test('a wrong heading code is reported and the importer check refuses the page', () => {
  const r = parseLegacyCentre(fixture('csee-2009-p0101'), 'P0999');
  assert.match(r.issues.join(), /heading code P0101 != P0999/);
  assert.match(validateCentre(DEF, 'P0999', r), /heading code P0101 != P0999/);
  const stray = parseLegacyCentre(fixture('csee-2009-p0101').replace('P0101/0003', 'P0555/0003'), 'P0101');
  assert.match(validateCentre(DEF, 'P0101', stray), /does not start with P0101\//);
  const none = parseLegacyCentre('<HTML><BODY><H3>Welcome</H3></BODY></HTML>', 'P0101');
  assert.match(validateCentre(DEF, 'P0101', none), /no centre heading/);
  assert.match(none.issues.join(), /no centre heading/);
});

test('garbage never throws', () => {
  for (const junk of ['', '<', '<HTML>', '<TABLE><TR><TD>CNO', 'x'.repeat(5000), '<H3>P0101 A</H3><TABLE><TR><TD>CNO</TD><TD>SEX</TD></TR></TABLE>']) {
    const r = parseLegacyCentre(junk, 'P0101');
    assert.ok(Array.isArray(r.candidates) && Array.isArray(r.issues));
    assert.ok(r.issues.length > 0);
    const i = parseLegacyIndex(junk);
    assert.deepEqual(i.centres, []);
  }
});

test('FLD is written 0 (and kept only when asked); failed counts follow', () => {
  const html = fixture('csee-2012-p0101').replace(/>\s*0\s*</g, '>FLD<'); // no AGGT '0' in this page: only DIV cells change
  const a = parseLegacyCentre(html, 'P0101');
  const b = parseLegacyCentre(html, 'P0101', { keepFld: true });
  assert.ok(b.candidates.some((c) => c.div === 'FLD'));
  assert.ok(!a.candidates.some((c) => c.div === 'FLD') && a.candidates.some((c) => c.div === '0'));
  assert.deepEqual(parseLegacyCentre(fixture('csee-2012-p0101'), 'P0101', { keepFld: true }).summary.head, ['SEX', 'I', 'II', 'III', 'IV', 'FLD']);
  assert.deepEqual(parseLegacyCentre(fixture('csee-2012-p0101'), 'P0101').summary.head, DIV_HEAD);
});

// ---- the summary
test('the one-line total becomes a single T row; a SEX table is kept as published', () => {
  const page = (line, table = '') => `<HTML><BODY><H1>CSEE 2010 EXAMINATION RESULTS</H1><H3>P0101 AZANIA SECONDARY SCHOOL CENTRE\n<H3>${line}</H3>\n</H3>${table}
<TABLE><TR><TD>CNO</TD><TD>SEX</TD><TD>AGGT</TD><TD>DIV</TD><TD>DETAILED SUBJECTS</TD></TR><TR><TD>P0101/0001</TD><TD>F</TD><TD>-</TD><TD>IV</TD><TD>CIV-C</TD></TR></TABLE></BODY></HTML>`;
  const r = (line, table) => parseLegacyCentre(page(line, table), 'P0101');
  assert.deepEqual(r('DIV-I = 0  DIV-II = 0  DIV-III = 0  DIV-IV = 29  FLD = 14  ').summary, { head: DIV_HEAD, rows: [['T', '0', '0', '0', '29', '14']] });
  assert.deepEqual(r('DIV-I = 1; DIV-II = 2; DIV-III = 3; DIV-IV = 4; DIV-0 = 5').summary, { head: DIV_HEAD, rows: [['T', '1', '2', '3', '4', '5']] });
  assert.deepEqual(r('DIV-I = 0  DIV-II = 0  DIV-III = 0  DIV-IV = 3  FLD = 1  ABS = 0').summary.head, [...DIV_HEAD, 'ABS']);
  assert.deepEqual(r('DISTINCTION = 0 MERIT = 1 CREDIT = 5 PASS = 11 FAIL = 22').summary, { head: CLASS_HEAD, rows: [['T', '0', '1', '5', '11', '22']] });
  assert.equal(r('DIV-I = 0  DIV-II = 0').summary, null, 'a half line is not a summary');
  assert.equal(r('DIV-I = 0 DIV-I = 1 DIV-III = 0 DIV-IV = 2 FLD = 1').summary, null, 'a repeated label is not a summary');
  assert.equal(r('').summary, null);
  const table = '<TABLE><TR><TD>SEX</TD><TD>I</TD><TD>II</TD><TD>III</TD><TD>IV</TD><TD>0</TD></TR><TR><TD>F</TD><TD>0</TD><TD>0</TD><TD>1</TD><TD>2</TD><TD>3</TD></TR><TR><TD>M</TD><TD>0</TD><TD>0</TD><TD>0</TD><TD>1</TD><TD>1</TD></TR><TR><TD>T</TD><TD>0</TD><TD>0</TD><TD>1</TD><TD>3</TD><TD>4</TD></TR></TABLE>';
  const t = r('', table);
  assert.equal(t.layout.summaryKind, 'table');
  assert.deepEqual(t.summary, { head: ['SEX', 'I', 'II', 'III', 'IV', '0'], rows: [['F', '0', '0', '1', '2', '3'], ['M', '0', '0', '0', '1', '1'], ['T', '0', '0', '1', '3', '4']] });
  assert.deepEqual(P.parseSecondaryCentre(page('', table), 'P0101').summary, t.summary, 'same shape as the new-style parser');
  assert.equal(t.candidates.length, 1);
  assert.equal(r('DIV-I = 9  DIV-II = 9  DIV-III = 9  DIV-IV = 9  FLD = 9', table).layout.summaryKind, 'table', 'a table beats the line');
});

test('the heading is read in all three shapes and the name is not polluted by the total', () => {
  assert.equal(parseLegacyCentre(fixture('csee-2003-p0104'), 'P0104').name, 'BWIRU BOYS SECONDARY SCHOOL CENTRE'); // "CSEE 2003 EXAMINATION RESULTS FOR P0104 ..."
  assert.equal(parseLegacyCentre(fixture('csee-2007-p0103'), 'P0103').name, 'BIHAWANA SECONDARY SCHOOL CENTRE'); // own <H3>
  const nested = parseLegacyCentre(fixture('acsee-2016-p0101'), 'P0101'); // a second <H3> with the total inside the first
  assert.equal(nested.name, 'AZANIA SECONDARY SCHOOL CENTRE');
  // the new-style parser puts the total into the name on these pages and finds no summary
  const old = P.parseSecondaryCentre(fixture('acsee-2016-p0101'), 'P0101');
  assert.match(old.name, /DIV-I = 0/);
  assert.equal(old.summary, null);
  assert.equal(parseLegacyCentre(fixture('csee-2008-p0101'), 'P0101').name, 'AZANIA SECONDARY SCHOOL CENTRE'); // closed with </H4>
});

// ---- subjects
test('subjects: hyphen and quoted spellings give the same pairs, written the way the packer rebuilds them', () => {
  assert.deepEqual(parseHyphenSubjects('CIV-X GEO-D KIS-B'), [['CIV', 'X'], ['GEO', 'D'], ['KIS', 'B']]);
  assert.deepEqual(parseHyphenSubjects('G/STUDIES-S ADV/MATHS-F E/D/KIISLAMU-C'), [['G/STUDIES', 'S'], ['ADV/MATHS', 'F'], ['E/D/KIISLAMU', 'C']]);
  assert.deepEqual(parseHyphenSubjects('GENERAL-F BASIC A-F DIVINIT-X'), [['GENERAL', 'F'], ['BASIC A', 'F'], ['DIVINIT', 'X']]);
  assert.deepEqual(readSubjects('CIV-X GEO-D'), { subjects: [['CIV', 'X'], ['GEO', 'D']], raw: "CIV - 'X' GEO - 'D'" });
  assert.deepEqual(readSubjects("PHY - 'F' CHEM - 'D'"), { subjects: [['PHY', 'F'], ['CHEM', 'D']], raw: "PHY - 'F' CHEM - 'D'" });
  assert.deepEqual(readSubjects("PHY - 'F' CHEM - 'D'").subjects, P.parseSecondarySubjects("PHY - 'F' CHEM - 'D'"));
  assert.deepEqual(readSubjects('LIT ENG-A').subjects, [['LIT ENG', 'A']]);
});

test('subjects: a cell that cannot be rebuilt exactly keeps only its text', () => {
  for (const cell of ['---', 'Results Withheld', 'CIV-F B/KNOWL -', 'CIV-F HIST', "CIV - 'F' GEO - 'B+'", 'CIV-F GEO-B+', 'ENG-D CHE-X ENG-X', "ENGL - 'D' PHY - 'F' ENGL - 'F'", 'CIV-F, GEO-D', '']) {
    assert.deepEqual(readSubjects(cell), { subjects: [], raw: cell }, cell);
  }
  assert.deepEqual(parseHyphenSubjects('CIV-F HIST'), []);
});

test('real shapes: a repeated subject code, a two-character grade, a marker row and an empty cell', () => {
  const r = parseLegacyCentre(fixture('csee-2005-p0104'), 'P0104');
  const text = r.candidates.find((c) => !c.subjects.length);
  assert.equal(text.cno, 'P0104/0036');
  assert.equal(text.subjectsRaw, 'CIV-D ENG-D ENG-D', 'ENG twice cannot be told apart');
  const b = parseLegacyCentre(fixture('csee-2013-p0101'), 'P0101').candidates.find((c) => !c.subjects.length);
  assert.match(b.subjectsRaw, /B\/MATH - 'B\+'$/, 'B+ is kept as written');
  const star = parseLegacyCentre(fixture('csee-2011-p0101'), 'P0101').candidates.find((c) => c.div === '*E');
  assert.deepEqual([star.aggt, star.div, star.subjectsRaw, star.subjects], ['*E', '*E', '---', []]);
  const s = parseLegacyCentre(fixture('acsee-2009-p0110'), 'P0110').candidates.find((c) => c.div === '*S');
  assert.deepEqual([s.cno, s.aggt, s.subjectsRaw], ['P0110/0826', '*S', '---']);
  const hyphen = parseLegacyCentre(fixture('acsee-2007-p0110'), 'P0110').candidates[0];
  assert.deepEqual(hyphen.subjects[0], ['GENERAL', 'S']);
  assert.equal(hyphen.subjectsRaw, "GENERAL - 'S' HISTORY - 'S' GEOGRAP - 'F' KISWAHI - 'E'");
  const gpa = parseLegacyCentre(fixture('acsee-2015-p0101'), 'P0101').candidates.find((c) => c.aggt === '2.0');
  assert.deepEqual([gpa.sex, gpa.aggt, gpa.div], ['F', '2.0', 'CREDIT']);
});

// ---- the packer takes the output
test('the packer rebuilds every fixture exactly (GPA years need a packer change, see below)', () => {
  const GPA = new Set(['csee-2014-p0101', 'acsee-2015-p0101']); // packCentre accepts only whole-number aggregates
  let packed = 0;
  for (const [file, exam, year, code] of CENTRES) {
    const r = parseLegacyCentre(fixture(file), code);
    const rec = { kind: 'secondary', code: r.code, name: r.name, sourceUrl: `https://example.invalid/${code.toLowerCase()}.htm`, summary: r.summary, overall: r.overall, facts: r.facts, candidates: r.candidates };
    if (GPA.has(file)) { assert.ok(r.candidates.some((c) => /\./.test(c.aggt)), file); continue; }
    const cat = exam.toLowerCase();
    const meta = learnMeta({ exam: `${cat}-${year}`, cat, year, kind: 'secondary', verified: '2026-11-10' }, (fn) => fn(rec));
    assert.deepEqual(verifyCentre(rec, packCentre(rec, meta).text, meta), [], file);
    packed++;
  }
  assert.equal(packed, CENTRES.length - GPA.size);
});

// ---- the exam index
test('index: the link spellings of every year', () => {
  const x = (name) => parseLegacyIndex(fixture(name));
  const a = x('csee-2003-index');
  assert.equal(a.centres.length, 24);
  assert.deepEqual(a.centres.slice(0, 2), [{ code: 'P0104', name: 'BWIRU BOYS', href: './p0104.html' }, { code: 'P0108', name: 'IFUNDA', href: './p0108.html' }]);
  assert.deepEqual(a.letterPages, []);
  assert.deepEqual(x('csee-2007-index').centres.slice(0, 2).map((c) => [c.code, c.href]), [['P0103', 'P0103.HTM'], ['P0104', 'P0104.HTM']]);
  assert.deepEqual(x('acsee-2009-index').centres.slice(0, 2).map((c) => [c.code, c.name, c.href]), [['P0101', 'AZANIA CENTRE', 'p0101.htm'], ['P0103', 'BIHAWANA CENTRE', 'p0103.htm']]); // 'p0101.htm' in single quotes
  assert.equal(x('acsee-2009-index').centres.length, 24);
  assert.equal(x('acsee-2011-index').centres.length, 22);
  for (const n of ['csee-2003-index', 'csee-2007-index', 'acsee-2009-index', 'acsee-2011-index', 'csee-2015-index']) assert.deepEqual(x(n).issues, [], n);
});

test('index: letter links are returned apart and the centre list is not touched by them', () => {
  const r = parseLegacyIndex(fixture('csee-2015-index'));
  assert.equal(r.letterPages.length, 26);
  assert.deepEqual(r.letterPages.slice(0, 3), ['index_a.htm', 'index_b.htm', 'index_c.htm']);
  assert.equal(r.centres.length, 16);
  assert.ok(r.centres.every((c) => /^[A-Z]{1,2}\d{4,9}$/.test(c.code)));
  assert.ok(!r.centres.some((c) => /index|Olevel/i.test(c.href)), 'ALL CENTRES (the page itself) and letters are not centres');
  const synth = `<A HREF="indexfiles\\index_c.htm">C</A> <A HREF="index_C.HTML">C</A> <A HREF="index_d.htm">D</A> <A HREF="INDEX_D.HTM">D</A> <A HREF="alevstat.html">Press to View Statistics</A>
    <A HREF="https://example.org/p0101.htm">P0101 ELSEWHERE</A> <A HREF="//example.org/p0102.htm">P0102 ELSEWHERE</A> <A NAME="p0103">P0103 NOT A LINK</A>`;
  const s = parseLegacyIndex(synth);
  assert.deepEqual(s.letterPages, ['indexfiles/index_c.htm', 'index_C.HTML', 'index_d.htm']);
  assert.deepEqual(s.centres, []);
});

test('index: repeated, mismatched and unnamed centres are reported, never thrown', () => {
  const a = (href, label) => `<TD><A HREF="${href}">${label}\n</A></TD>`;
  const html = `<HTML>${a('./p0104.html', 'P0104 BWIRU BOYS')}${a('results\\s0101.htm', 'S0101 ABBEY')}${a('s0102.htm', 'S0101 WRONG LABEL')}<TD><A HREF='s0103.htm'>S0103</A></TD>${a('./p0104.html', 'P0104 BWIRU BOYS')}${a('S0105.HTM', 's0105 low case name')}${a('s0106.htm', 'ST. MATTHEW (K3-200       ')}</HTML>`;
  const r = parseLegacyIndex(html);
  assert.deepEqual(r.centres.map((c) => [c.code, c.name, c.href]), [['P0104', 'BWIRU BOYS', './p0104.html'], ['S0101', 'ABBEY', 'results/s0101.htm'], ['S0103', '', 's0103.htm'], ['S0105', 'low case name', 'S0105.HTM']]);
  assert.deepEqual(r.issues, ['label/href mismatch: "S0101 WRONG LABEL" vs s0102.htm', 'empty name: S0103', 'duplicate centre P0104', 'label/href mismatch: "ST. MATTHEW (K3-200" vs s0106.htm']);
});

// ---- the full real pages (names included), only where they are present on this computer
test('real pages: counts, no names, and the published total agrees with the rows', { skip: !real('csee-2011-p0101') && 'real pages not found in ' + RAW }, () => {
  let seen = 0;
  for (const [file, , , code] of CENTRES) {
    const html = real(file);
    if (!html) continue;
    seen++;
    const r = parseLegacyCentre(html, code);
    assert.deepEqual(r.issues, [], file);
    assert.equal(validateCentre(DEF, code, r), null, file);
    checkAgainstOracle(html, code, r, file);
    const out = JSON.stringify(r);
    const table = P.tables(html).map(P.rows).find((x) => /^(CNO|CAND)/i.test(x[0][0]));
    const nameCol = table[0].findIndex((h) => /NAME/i.test(h));
    if (nameCol >= 0) {
      for (const row of table.slice(1)) {
        const name = row[nameCol];
        if (name.length < 3 || name.includes('*')) continue;
        assert.ok(!out.includes(name), `${file}: a name leaked`);
        for (const w of name.split(/\s+/)) if (w.length >= 5) assert.ok(!new RegExp(`\\b${w.replace(/[^A-Za-z]/g, '')}\\b`).test(out.replace(/SECONDARY|SCHOOL|CENTRE/g, '')), `${file}: a name word leaked`);
      }
    }
    if (r.summary) { // the line counts the candidates by division (absent ones are not counted)
      const n = {};
      for (const c of r.candidates) n[c.div] = (n[c.div] || 0) + 1;
      r.summary.head.slice(1).forEach((label, i) => { if (label !== 'ABS') assert.equal(Number(r.summary.rows[0][i + 1]), n[label] || 0, `${file}: ${label}`); });
    }
  }
  assert.ok(seen >= 15, `${seen} real pages read`);
});

test('real pages: a whole index is read link for link', { skip: !real('csee-2015-index') && 'real pages not found in ' + RAW }, () => {
  for (const name of ['csee-2003-index', 'csee-2007-index', 'csee-2015-index', 'acsee-2009-index', 'acsee-2011-index']) {
    const html = real(name);
    if (!html) continue;
    const r = parseLegacyIndex(html);
    const links = (html.match(/<A\s[^>]*HREF\s*=\s*["']?(?:\.?\/)?[a-z]{1,2}\d{4,9}\.html?/gi) || []).length;
    const dups = r.issues.filter((i) => /^duplicate centre/.test(i)).length;
    assert.equal(r.centres.length + dups, links, name);
    assert.equal(r.issues.length, dups, name + ': only repeats are reported');
    assert.ok(r.centres.length > 250, name);
    assert.equal(r.letterPages.length, name === 'csee-2015-index' ? 26 : 0, name);
  }
});
