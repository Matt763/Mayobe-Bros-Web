// Offline tests of the parser for the older PSLE pages (2013 to 2019) of the Maktaba Tetea mirror. Nothing here touches the network.
// The pages in fixtures/psle-old/ are real pages with every candidate name replaced by CANDIDATE 1, CANDIDATE 2 ... and trimmed to
// ten candidates (school and district names are public; no candidate name or PREM number is in the repository).
// If you keep full raw pages somewhere, point PSLE_OLD_RAW at that folder (files shl*.htm) for one extra check against the real names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/necta-parse.mjs';
import * as O from '../lib/necta-parse-psle-old.mjs';
import { learnMeta, packCentre, verifyCentre } from '../lib/results-pack.mjs';
import { validateCentre } from '../necta-import.mjs';
import { examDef } from '../lib/necta-exams.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'psle-old');
const fixture = (f) => P.decodeBuffer(fs.readFileSync(path.join(FIX, f)));

const NAMES = ['ZEBEDAYO QWERTYUIOP NGOWI', 'ASIAMINA LKJHGFDSA KIMARO', 'HAMISI MNBVCXZ TEMBA'];
const PREMS = ['20151557239', '20164817250', '20160504492'];

// ---- what each year looks like ----
const STD = 'Kiswahili|English|Maarifa|Hisabati|Science|Average Grade';
const YEARS = {
  2013: { heading: 'P0101001', subjects: STD.replace('Average', 'Avarage'), facts: ['WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'NAFASI YA SHULE KIWILAYA', 'NAFASI YA SHULE KIMKOA', 'NAFASI YA SHULE KITAIFA'], sat: '55', avg: '86.2364' },
  2014: { heading: 'P0101001', subjects: STD, facts: ['WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'NAFASI YA SHULE KIWILAYA', 'NAFASI YA SHULE KIMKOA', 'NAFASI YA SHULE KITAIFA'], sat: '66', avg: '99.2879' },
  2015: { heading: 'P0101001', subjects: STD, facts: ['WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'NAFASI YA SHULE KIWILAYA', 'NAFASI YA SHULE KIMKOA', 'NAFASI YA SHULE KITAIFA'], sat: '42', avg: '183.9048' },
  2016: { heading: 'PS0101001', subjects: STD, facts: ['WALIOSAJILIWA', 'WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'KUNDI LA SHULE', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIWILAYA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIMKOA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KITAIFA'], sat: '52', avg: '159.0769' },
  2017: { heading: 'PS0101001', subjects: STD, facts: ['WALIOSAJILIWA', 'WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'KUNDI LA SHULE', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIWILAYA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIMKOA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KITAIFA'], sat: '62', avg: '115.6452' },
  2018: { heading: 'PS0101001', subjects: STD, facts: ['WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'KUNDI LA SHULE', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIWILAYA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIMKOA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KITAIFA'], sat: '48', avg: '167.1667' },
  2019: { heading: 'PS0101001', subjects: STD, facts: ['WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'KUNDI LA SHULE', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIHALMASHAURI', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIMKOA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KITAIFA'], sat: '43', avg: '172.3721', summary: true },
};

// ---- synthetic page for the cases the real pages do not show ----
const td = (t) => `<TD WIDTH="10%" VALIGN="MIDDLE"><FONT FACE="Arial" SIZE=1><P ALIGN="CENTER">${t}</FONT></TD>`;
const tr = (cells) => `<TR>${cells.map(td).join('')}</TR>`;
const table = (rowsArr) => `<TABLE BORDER CELLSPACING=2>\n${rowsArr.map(tr).join('\n')}\n</TABLE>`;
function oldPage({ heading = 'BANGATA PRIMARY SCHOOL - P0101001', withPrem = false, withName = true, extra = '', cnoPrefix = 'PS0101001', sexes = ['M', 'F', 'M'], subjects } = {}) {
  const head = ['CAND. NO', ...(withPrem ? ['PREM NO'] : []), 'SEX', ...(withName ? ['CANDIDATE NAME'] : []), 'SUBJECTS'];
  const sub = subjects || ['Kiswahili - B, English - C, Maarifa - C, Hisabati - C, Science - B, Average Grade - C', 'Kiswahili - A, English - B, Maarifa - B, Hisabati - C, Science - B, Average Grade - B', 'ABS'];
  const body = NAMES.map((n, i) => [`${cnoPrefix}-00${i + 1}`, ...(withPrem ? [PREMS[i]] : []), sexes[i], ...(withName ? [n] : []), sub[i]]);
  return `<HTML><BODY><H3><P ALIGN="LEFT">${heading}\n</P></H3>
<P>WALIOFANYA MTIHANI : 3 <br> WASTANI WA SHULE   : 150.5 <br>
NAFASI YA SHULE KIWILAYA: 4 kati ya 10 <br></P>
${table([head, ...body])}
${extra}
</BODY></HTML>`;
}

// ---- the walk ----
test('regions and districts of the older years are read by the existing parsers', () => {
  const r13 = P.parseRegions(fixture('psle2013_index.htm'));
  assert.equal(r13.length, 25);
  assert.deepEqual([r13[0].file, r13[0].name], ['reg_01.htm', 'ARUSHA']);
  assert.equal(r13.at(-1).name, 'SIMIYU');
  assert.equal(P.parseRegions(fixture('psle2014_index.htm')).length, 25);
  const r19 = P.parseRegions(fixture('psle2019_index.htm'));
  assert.equal(r19.length, 26);
  assert.equal(r19.at(-1).name, 'SONGWE');
  for (const f of ['psle2013_reg01.htm', 'psle2018_reg01.htm']) {
    const d = P.parseDistricts(fixture(f));
    assert.equal(d.length, 7, f);
    assert.deepEqual([d[0].file, d[0].name], ['distr_0101.htm', 'ARUSHA']);
  }
});

test('school links: shl_p<digits> (2013 to 2015) is read only by parsePsleOldSchools, which also reads shl_ps<digits>', () => {
  const d13 = fixture('psle2013_distr0101.htm');
  assert.equal(P.parseSchools(d13).length, 0, 'the existing parser does not see the P-only links');
  const s13 = O.parsePsleOldSchools(d13);
  assert.equal(s13.length, 9);
  assert.deepEqual(s13[0], { code: 'PS0101114', name: 'ALBEHIJE PRIMARY SCHOOL', href: 'shl_p0101114.htm', file: 'shl_p0101114.htm' });
  const d18 = fixture('psle2018_distr0101.htm');
  const s18 = O.parsePsleOldSchools(d18);
  assert.equal(s18.length, 9);
  assert.deepEqual(s18, P.parseSchools(d18), 'same result as parseSchools where that works');
  assert.deepEqual(O.parsePsleOldSchools('<A HREF="results/shl_P0101114.htm">X PRIMARY - P0101114</A><A HREF="shl_ps0202002.htm">Y - PS0202002</A><A HREF="x.htm">no</A>').map((s) => [s.code, s.href]), [['PS0101114', 'results/shl_P0101114.htm'], ['PS0202002', 'shl_ps0202002.htm']]);
});

test('codes are written PS<digits>', () => {
  assert.equal(O.normalisePsleCode('P0101001'), 'PS0101001');
  assert.equal(O.normalisePsleCode('ps0101001'), 'PS0101001');
  assert.equal(O.normalisePsleCode(' PS0101001 '), 'PS0101001');
  assert.equal(O.normalisePsleCode('S0101'), null);
  assert.equal(O.normalisePsleCode(''), null);
  assert.equal(O.normalisePsleCode(undefined), null);
});

// ---- one school page per year ----
for (const [year, want] of Object.entries(YEARS)) {
  test(`PSLE ${year}: code, facts, subjects and candidates (no name anywhere)`, () => {
    const html = fixture(`psle${year}_shl.htm`);
    const r = O.parsePsleOldSchool(html, 'PS0101001');
    assert.equal(r.code, 'PS0101001');
    assert.equal(r.name, 'BANGATA PRIMARY SCHOOL');
    assert.deepEqual(r.issues, []);
    assert.deepEqual(Object.keys(r), ['code', 'name', 'facts', 'summary', 'overall', 'candidates', 'issues'], 'same shape as parsePsleSchool');
    assert.deepEqual(r.facts.map((f) => f[0]), want.facts);
    const fact = Object.fromEntries(r.facts);
    assert.equal(fact['WALIOFANYA MTIHANI'], want.sat);
    assert.equal(fact['WASTANI WA SHULE'], want.avg);
    assert.ok(r.facts.every((f) => f.length === 2 && f[1]));
    assert.equal(r.candidates.length, 10);
    assert.deepEqual(r.candidates.map((c) => c.cno).slice(0, 3), ['PS0101001-001', 'PS0101001-002', 'PS0101001-003']);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c), ['cno', 'sex', 'subjectsRaw', 'subjects']);
      assert.match(c.sex, /^[MF]$/);
      assert.equal(c.subjects.map((s) => s[0]).join('|'), want.subjects);
      assert.ok(c.subjects.every(([, g]) => /^[A-EX]$/.test(g)), 'X = the paper was not sat (all X = absent)');
      assert.equal(c.subjectsRaw, c.subjects.map(([n, g]) => `${n} - ${g}`).join(', '), 'the cell can be rebuilt exactly');
    }
    if (want.summary) {
      assert.deepEqual(r.summary.head, ['JINSI', 'A', 'B', 'C', 'D', 'E']);
      assert.deepEqual(r.summary.rows.map((x) => x[0]), ['WASICHANA', 'WAVULANA', 'JUMLA']);
    } else assert.equal(r.summary, null);
    assert.deepEqual(r.overall, []);
    // the scrubbed name column (CANDIDATE n) must not reach the record
    assert.ok(!/CANDIDATE/.test(JSON.stringify(r)), 'the name column was read');
    assert.ok(/CANDIDATE 1\b/.test(html), 'the fixture still has the name column');
  });
}

test('the heading code may be given as P0101001, PS0101001 or lower case; a different school is reported', () => {
  const html = fixture('psle2013_shl.htm');
  for (const c of ['P0101001', 'PS0101001', 'p0101001', 'ps0101001', undefined]) assert.deepEqual(O.parsePsleOldSchool(html, c).issues, [], String(c));
  assert.deepEqual(O.parsePsleOldSchool(html, 'PS0202002').issues, ['heading code PS0101001 != PS0202002']);
  assert.deepEqual(O.parsePsleOldSchool(html, 'S5405').issues, ['heading code PS0101001 != S5405']);
});

test('2013 small school and the "Avarage Grade" spelling are kept as published', () => {
  const r = O.parsePsleOldSchool(fixture('psle2013_shl_small.htm'), 'P0101114');
  assert.equal(r.code, 'PS0101114');
  assert.equal(r.candidates.length, 7);
  assert.equal(r.candidates[0].subjects.at(-1)[0], 'Avarage Grade');
  assert.match(r.candidates[0].subjectsRaw, /Avarage Grade - [A-E]$/);
  assert.deepEqual(r.issues, []);
});

test('for 2016 to 2019 the candidates and the summary equal what parsePsleSchool returns; only the facts are richer', () => {
  for (const year of [2016, 2017, 2018, 2019]) {
    const html = fixture(`psle${year}_shl.htm`);
    const a = O.parsePsleOldSchool(html, 'PS0101001');
    const b = P.parsePsleSchool(html, 'PS0101001');
    assert.deepEqual([a.code, a.name, a.candidates, a.summary, a.overall, a.issues], [b.code, b.name, b.candidates, b.summary, b.overall, b.issues], String(year));
    for (const f of b.facts) assert.ok(a.facts.some((x) => x[0] === f[0] && x[1] === f[1]), `${year}: ${f[0]}`);
    assert.ok(a.facts.length > b.facts.length, String(year));
  }
});

test('for 2013 to 2015 parsePsleSchool finds no school heading, parsePsleOldSchool does (why this file exists)', () => {
  for (const year of [2013, 2014, 2015]) {
    const html = fixture(`psle${year}_shl.htm`);
    assert.match(P.parsePsleSchool(html, 'PS0101001').issues.join(), /no school heading/);
    assert.equal(O.parsePsleOldSchool(html, 'PS0101001').code, 'PS0101001');
  }
});

// ---- privacy ----
test('names and PREM numbers in any column order never reach the record, a note or the issues', () => {
  for (const withPrem of [false, true]) {
    for (const heading of ['BANGATA PRIMARY SCHOOL - P0101001', 'BANGATA PRIMARY SCHOOL - PS0101001']) {
      const r = O.parsePsleOldSchool(oldPage({ withPrem, heading }), 'PS0101001');
      assert.equal(r.candidates.length, 3);
      assert.deepEqual(r.candidates.map((c) => c.sex), ['M', 'F', 'M']);
      assert.deepEqual(r.candidates[2].subjects, []);
      assert.equal(r.candidates[2].subjectsRaw, 'ABS');
      const out = JSON.stringify(r);
      for (const n of [...NAMES, ...PREMS]) assert.ok(!out.includes(n), `${n} leaked`);
      for (const w of NAMES.flatMap((n) => n.split(' '))) assert.ok(!out.includes(w), `${w} leaked`);
    }
  }
});

test('the real layout with names put back in does not leak them either', () => {
  for (const year of Object.keys(YEARS)) {
    const html = fixture(`psle${year}_shl.htm`).replace(/CANDIDATE (\d+)\b/g, (_m, i) => `ZQ${'XJ'.repeat(+i)} MWAKYUSA${'W'.repeat(+i)}`);
    assert.ok(html.includes('MWAKYUSAW'));
    const r = O.parsePsleOldSchool(html, 'PS0101001');
    assert.equal(r.candidates.length, 10);
    assert.ok(!/ZQ|MWAKYUSA/.test(JSON.stringify(r)), `${year}: a name leaked`);
  }
});

test('rows that do not fit never put cell text into a note', () => {
  const html = oldPage({ withPrem: true }).replace('PS0101001-002', 'BROKEN');
  const r = O.parsePsleOldSchool(html, 'PS0101001');
  assert.equal(r.candidates.length, 2);
  assert.deepEqual(r.issues, ['skipped row 2']);
  const out = JSON.stringify(r);
  for (const n of [...NAMES, ...PREMS]) assert.ok(!out.includes(n));
});

test('a sex cell that holds anything but M or F is not copied', () => {
  const r = O.parsePsleOldSchool(oldPage({ sexes: ['M', NAMES[1], 'F'] }), 'PS0101001');
  assert.deepEqual(r.candidates.map((c) => c.sex), ['M', '', 'F']);
  assert.deepEqual(r.issues, ['unknown sex in row 2 (PS0101001-002)']);
  assert.ok(!JSON.stringify(r).includes(NAMES[1]));
});

test('a table after the candidates that holds names or numbers is dropped, others are kept', () => {
  const personal = table([['CANDIDATE NAME', 'MARKS'], [NAMES[0], '12']]);
  const personal2 = table([['X', 'Y'], ['row', PREMS[0]]]);
  const fine = table([['UFAULU WA MASOMO'], ['NAMBA', 'SOMO', 'WALIOFANYA'], ['1', 'KISWAHILI', '61']]);
  const r = O.parsePsleOldSchool(oldPage({ extra: personal + personal2 + fine }), 'PS0101001');
  assert.deepEqual(r.issues, ['skipped a table after the candidates', 'skipped a table after the candidates']);
  assert.deepEqual(r.overall, [{ t: 'h', v: 'UFAULU WA MASOMO' }, { t: 'grid', head: ['NAMBA', 'SOMO', 'WALIOFANYA'], rows: [['1', 'KISWAHILI', '61']] }]);
  const out = JSON.stringify(r);
  for (const n of [...NAMES, ...PREMS]) assert.ok(!out.includes(n));
});

test('only known "LABEL : value" lines become facts', () => {
  const html = oldPage().replace('<br></P>', `<br> JINA LA MWALIMU : ${NAMES[0]} <br> WALIOFANYA MTIHANI : 3 <br> NAFASI YA SHULE KIMKOA : ${PREMS[0]} ${'x'.repeat(80)} <br></P>`);
  const r = O.parsePsleOldSchool(html, 'PS0101001');
  assert.deepEqual(r.facts, [['WALIOFANYA MTIHANI', '3'], ['WASTANI WA SHULE', '150.5'], ['NAFASI YA SHULE KIWILAYA', '4 kati ya 10']]);
});

// ---- problems are reported, never thrown ----
test('problems are reported in issues and nothing throws', () => {
  const none = O.parsePsleOldSchool('', 'PS0101001');
  assert.deepEqual([none.code, none.candidates, none.facts, none.summary, none.overall], [null, [], [], null, []]);
  assert.deepEqual(none.issues, ['no school heading', 'no candidates found']);
  assert.deepEqual(O.parsePsleOldSchool('<HTML><H3>X - PS0000001</H3></HTML>', 'PS0000001').issues, ['no candidates found']);
  assert.deepEqual(O.parsePsleOldSchool('<HTML><H3>NOT A SCHOOL</H3></HTML>').issues, ['no school heading', 'no candidates found']);
  const noCols = O.parsePsleOldSchool(oldPage().replace('SUBJECTS', 'MARKS'), 'PS0101001');
  assert.ok(noCols.issues.includes('unknown candidate columns'));
  assert.equal(noCols.candidates.length, 0);
  const other = O.parsePsleOldSchool(oldPage({ cnoPrefix: 'PS0909090' }), 'PS0101001');
  assert.equal(other.candidates.length, 3);
  assert.match(other.issues.join(), /candidate number PS0909090-001 is not under PS0101001/);
  const dup = O.parsePsleOldSchool(oldPage().replace('PS0101001-002', 'PS0101001-001'), 'PS0101001');
  assert.equal(dup.candidates.length, 2);
  assert.deepEqual(dup.issues, ['duplicate candidate PS0101001-001']);
  const lowerP = O.parsePsleOldSchool(oldPage({ cnoPrefix: 'p0101001' }), 'PS0101001');
  assert.deepEqual(lowerP.candidates.map((c) => c.cno), ['PS0101001-001', 'PS0101001-002', 'PS0101001-003'], 'P0101001-001 style numbers are written PS...');
  assert.deepEqual(lowerP.issues, []);
});

test('subject cells that cannot be rebuilt keep only their text', () => {
  const r = O.parsePsleOldSchool(oldPage({ subjects: ['Kiswahili - B, English - -, Maarifa - C', 'Results Withheld', '---'] }), 'PS0101001');
  assert.deepEqual(r.candidates.map((c) => c.subjects), [[], [], []]);
  assert.deepEqual(r.candidates.map((c) => c.subjectsRaw), ['Kiswahili - B, English - -, Maarifa - C', 'Results Withheld', '---']);
});

// ---- what the importer and validateCentre do with it ----
test('validateCentre accepts every year, and the packer round-trips the records', () => {
  for (const year of [2013, 2016, 2019]) {
    const code = 'PS0101001';
    const r = O.parsePsleOldSchool(fixture(`psle${year}_shl.htm`), code);
    assert.equal(validateCentre(examDef('psle-2021'), code, r), null, String(year));
    const rec = { kind: 'primary', code, name: r.name, sourceUrl: `https://maktaba.tetea.org/exam-results/PSLE${year}/shl_ps0101001.htm`, summary: r.summary, overall: r.overall, facts: r.facts, candidates: r.candidates };
    const meta = learnMeta({ exam: `psle-${year}`, cat: 'psle', year, kind: 'primary', verified: '2026-11-10' }, (fn) => fn(rec));
    assert.deepEqual(meta.subjects, YEARS[year].subjects.split('|'));
    assert.deepEqual(verifyCentre(rec, packCentre(rec, meta).text, meta), [], String(year));
  }
});

// ---- real pages, when somebody keeps them ----
test('raw pages in PSLE_OLD_RAW (if any): not one candidate name word appears in the output', () => {
  const dir = process.env.PSLE_OLD_RAW || path.join(os.homedir(), '.cache', 'mb-recon', 'raw', 'psle-old');
  if (!fs.existsSync(dir)) return;
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^shl.*\.htm$/i.test(x))) {
    const html = P.decodeBuffer(fs.readFileSync(path.join(dir, f)));
    const t = P.tables(html).map(P.rows).find((x) => /^CAND/i.test(x[0][0]));
    if (!t) continue;
    const r = O.parsePsleOldSchool(html);
    assert.deepEqual(r.issues, [], f);
    assert.equal(r.candidates.length, t.length - 1, f);
    const out = JSON.stringify(r);
    const head = t[0].map((h) => h.toUpperCase());
    const nameCol = head.findIndex((h) => /NAME/.test(h));
    const premCol = head.findIndex((h) => /PREM/.test(h));
    for (const row of t.slice(1)) {
      if (nameCol >= 0) assert.ok(!out.includes(row[nameCol]), `${f}: a name leaked`);
      if (nameCol >= 0) for (const w of row[nameCol].split(' ').filter((x) => x.length > 3 && !r.name.includes(x))) assert.ok(!out.includes(w), `${f}: a name word leaked`);
      if (premCol >= 0) assert.ok(!out.includes(row[premCol]), `${f}: PREM leaked`);
    }
    checked++;
  }
  assert.ok(checked >= 0, 'nothing to check is fine');
});
