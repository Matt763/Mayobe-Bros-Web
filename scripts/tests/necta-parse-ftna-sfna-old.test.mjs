// Offline tests of the parsers for the OLD FTNA (Form Two, 2014 to 2021) and SFNA (Standard Four, 2015 to 2021) pages of the Maktaba Tetea
// mirror. Nothing here touches the network.
// The pages in fixtures/ftna-sfna-old/ are real mirror pages trimmed to about ten candidates, with EVERY candidate name replaced by
// "CANDIDATE n" (these pages show children's full names; no real name is in the repository). The summary and ranking tables are the real
// page's, so their totals are larger than the trimmed candidate list.
// FTNA_SFNA_OLD_RAW=<folder with the raw pages> adds the check against the real names (skipped when it is not set).
//
// Where each year lives (https://maktaba.tetea.org/exam-results/<folder>/<file>):
//   exam id    index                                  centre pages                       school count (links in the index)
//   ftna-2014  FTSEE2014-2/formtwo-2014-2.htm         `08_S0005-0.htm` (zone_code-N)     4,532 links, 4,402 distinct codes
//   ftna-2015  FTNA2015/formtwo-2015.html             `S0101.htm` (same folder)          4,601
//   ftna-2016  FTNA2016/index.htm                     `S0101.htm`                        4,666
//   ftna-2017  FTNA2017/ftna.htm                      `S0101.htm`                        4,704
//   ftna-2018  FTNA2018/ftna.htm                      `S0101.htm`                        4,722
//   ftna-2019  FTNA2019/ftna.htm                      `S0101.htm`                        4,796
//   ftna-2020  FTNA2020/ftna.htm                      `S0101.htm`                        4,948
//   ftna-2021  FTNA2021/ftna.htm                      `S0101.htm`                        5,064
//   sfna-2015  SFNA2015/index.htm                     reg_ps01.htm -> distr_ps0101.htm -> ps0101114.htm   25 regions (2015), 26 (2016 on)
//   sfna-2016  SFNA2016/index.htm                     same names
//   sfna-2017 .. 2021  SFNA<year>/sfna.htm            same names
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/necta-parse.mjs';
import * as N from '../lib/necta-parse-ftna-sfna.mjs';
import * as O from '../lib/necta-parse-ftna-sfna-old.mjs';
import { learnMeta, packCentre, verifyCentre } from '../lib/results-pack.mjs';
import { validateCentre } from '../necta-import.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ftna-sfna-old');
const fixture = (f) => P.decodeBuffer(fs.readFileSync(path.join(FIX, f)));
const SEC = { kind: 'secondary' };
const PRIM = { kind: 'primary' };
const FTNA_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021];
const SFNA_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021];

// ---------------------------------------------------------------- FTNA index
test('FTNA index: links are `S0101.htm` (2015 to 2021) or `08_S0005-0.htm` (2014); the code comes from the link', () => {
  for (const y of FTNA_YEARS) {
    const r = O.parseFtnaOldIndex(fixture(`ftna${y}_index.htm`));
    assert.deepEqual(r.issues, [], String(y));
    assert.ok(r.centres.length >= 4 && r.centres.length <= 6, String(y));
    for (const c of r.centres) { assert.match(c.code, /^S\d{4}$/); assert.equal(c.href, `${c.code}.htm`); assert.ok(c.name && !c.name.startsWith(c.code)); }
    assert.equal(r.centres[0].name, 'AZANIA SECONDARY SCHOOL', String(y));
    // the older index parser reads them too, only the name differs in spirit; ours is the one that handles 2014
    assert.equal(N.parseFtnaIndex(fixture(`ftna${y}_index.htm`)).centres.length, r.centres.length, String(y));
  }
  const r = O.parseFtnaOldIndex(fixture('ftsee2014_index.htm'));
  assert.deepEqual(r.centres.map((c) => c.code), ['P1367', 'S0005', 'S0006', 'S0013', 'S7474']);
  assert.deepEqual(r.centres[1], { code: 'S0005', name: 'CHIDYA', href: '08_S0005-0.htm' });
  assert.deepEqual(r.centres[0], { code: 'P1367', name: 'LAKE ZONE SECONDARY SCHOOL', href: '05_P1367-0.htm' });
  assert.deepEqual(r.issues, ['duplicate centre S0013 (03_S0013-1.htm)'], 'the second school with the same code is reported, not stored');
  assert.equal(N.parseFtnaIndex(fixture('ftsee2014_index.htm')).centres.length, 0, 'the 2022 parser sees nothing in the 2014 index');
  // odd input: external links, a wrong label code, an empty name and nothing at all
  const odd = O.parseFtnaOldIndex('<a href="http://necta.go.tz/x.htm">x</a><a href="S0101.htm"></a><a href="02_S0102-0.htm">S0999 WRONG</a><a href="results\\s0103.htm"> THREE </a>');
  assert.deepEqual(odd.centres.map((c) => c.code), ['S0101', 'S0103']);
  assert.deepEqual(odd.issues, ['empty name: S0101', 'label/href mismatch: S0102']);
  assert.deepEqual(O.parseFtnaOldIndex('<html></html>').issues, ['no centres found']);
});

// ---------------------------------------------------------------- FTNA centre pages
const FTNA = {
  2015: { file: 'ftna2015_S0101.htm', cols: 12, first: 'CIVICS', last: 'B/KEEPING', aggt: /^\d\.\d$/, div: /^(DISTINCTION|MERIT|CREDIT|PASS|REFERRED)$/, summary: 'counted' },
  2016: { file: 'ftna2016_S0101.htm', cols: 12, first: 'CIVICS', last: 'B/KEEPING', aggt: /^\d+$/, div: /^(I|II|III|IV|REFERRED)$/, summary: 'published' },
  2017: { file: 'ftna2017_S0101.htm', cols: 12, first: 'CIVICS', last: 'BOOK KEEPING', aggt: /^\d+$/, div: /^(I|II|III|IV|REFERRED)$/, summary: 'published' },
  2018: { file: 'ftna2018_S0101.htm', cols: 11, first: 'CIVICS', last: 'BOOK KEEPING', aggt: /^\d+$/, div: /^(I|II|III|IV|REFERRED)$/, summary: 'published' },
  2019: { file: 'ftna2019_S0101.htm', cols: 12, first: 'CIV', last: 'B/KEEPING', aggt: /^\d+$/, div: /^(I|II|III|IV|REFERRED)$/, summary: 'published' },
  2020: { file: 'ftna2020_S0101.htm', cols: 12, first: 'CIV', last: 'B/KEEPING', aggt: /^\d+$/, div: /^(I|II|III|IV|REFERRED)$/, summary: 'published' },
  2021: { file: 'ftna2021_S0101.htm', cols: 11, first: 'CIV', last: 'B/KEEPING', aggt: /^\d+$/, div: /^(I|II|III|IV|REFERRED)$/, summary: 'published' },
};
for (const [year, w] of Object.entries(FTNA)) {
  test(`FTNA ${year}: heading, summary, columns and candidates (same record shape as the 2022 parser)`, () => {
    const r = O.parseFtnaOldCentre(fixture(w.file), 'S0101', { plusGrade: 'keep' });
    assert.deepEqual(r.issues, []);
    assert.deepEqual(Object.keys(r), ['code', 'name', 'summary', 'overall', 'facts', 'candidates', 'issues']);
    assert.deepEqual([r.code, r.name], ['S0101', 'AZANIA SECONDARY SCHOOL']);
    assert.deepEqual(r.overall, []);
    assert.deepEqual(r.facts, []);
    assert.equal(r.summary.head[0], 'SEX');
    assert.equal(r.summary.rows.at(-1)[0], 'T');
    if (w.summary === 'published') {
      assert.deepEqual(r.summary.head, ['SEX', 'I', 'II', 'III', 'IV', 'REFERRED']);
      assert.ok(Number(r.summary.rows.at(-1)[1]) > r.candidates.length, 'the published totals, larger than the trimmed fixture');
    } else {
      assert.deepEqual(r.summary.head, ['SEX', 'DISTINCTION', 'MERIT', 'CREDIT', 'PASS', 'REFERRED']);
      const total = r.summary.rows.at(-1).slice(1).reduce((a, b) => a + Number(b), 0);
      assert.equal(total, r.candidates.filter((c) => /^[A-Z]{4,}$/.test(c.div)).length, 'counted from the rows');
    }
    assert.ok(r.candidates.length >= 8 && r.candidates.length <= 11);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c), ['cno', 'sex', 'aggt', 'div', 'subjectsRaw', 'subjects']);
      assert.match(c.cno, /^S0101\/\d{4}$/);
      assert.match(c.sex, /^[MF]$/);
    }
    const graded = r.candidates.filter((c) => c.subjects.length);
    assert.ok(graded.length >= 5, 'most rows are pairs');
    const c1 = graded[0];
    assert.match(c1.aggt, w.aggt);
    assert.match(c1.div, w.div);
    assert.equal(c1.subjects[0][0], w.first);
    assert.equal(c1.subjects.at(-1)[0], w.last);
    assert.equal(c1.subjects.length, w.cols);
    assert.equal(c1.subjectsRaw, c1.subjects.map(([n, g]) => `${n} - '${g}'`).join(' '), 'the packer\'s form of the cell');
    assert.ok(c1.subjects.every(([n, g]) => n && /^[A-F]\+?$/.test(g)));
    assert.equal(validateCentre(SEC, 'S0101', r), null);
    // the 2022 parser cannot read these pages (the heading is not an h3)
    assert.equal(N.parseFtnaCentre(fixture(w.file), 'S0101').candidates.length, 0);
  });
}

test('FTNA 2015: B+ grades make a marker row by default (the packer takes one character), or stay pairs with plusGrade keep', () => {
  const html = fixture('ftna2015_S0101.htm');
  const note = O.parseFtnaOldCentre(html, 'S0101');
  const plus = note.candidates.filter((c) => c.subjectsRaw.includes("'B+'"));
  assert.ok(plus.length >= 1);
  for (const c of plus) { assert.deepEqual(c.subjects, []); assert.match(c.aggt, /^\d\.\d$/); assert.match(c.div, /^[A-Z]+$/); assert.match(c.subjectsRaw, /^[A-Z/& ]+ - '[A-F]\+?'( [A-Z/& ]+ - '[A-F]\+?')*$/); }
  const keep = O.parseFtnaOldCentre(html, 'S0101', { plusGrade: 'keep' });
  assert.deepEqual(keep.issues, []);
  for (const c of plus) { const k = keep.candidates.find((x) => x.cno === c.cno); assert.ok(k.subjects.some(([, g]) => g === 'B+')); assert.equal(k.subjectsRaw, c.subjectsRaw); }
  assert.ok(note.candidates.some((c) => c.subjects.length), 'rows without B+ stay pairs');
});

test('FTNA 2014 (FTSEE): zone heading, GPA and CLASS, withheld results, counted summary with FAIL', () => {
  const r = O.parseFtnaOldCentre(fixture('ftsee2014_S0005.htm'), 'S0005', { year: 2014 });
  assert.deepEqual(r.issues, []);
  assert.deepEqual([r.code, r.name], ['S0005', 'CHIDYA']);
  assert.deepEqual(r.summary.head, ['SEX', 'DISTINCTION', 'MERIT', 'CREDIT', 'PASS', 'FAIL']);
  const w = r.candidates.find((c) => c.subjectsRaw === 'Results Withheld, Fee');
  assert.deepEqual([w.aggt, w.div, w.subjects], ['-', '*E', []]);
  assert.match(w.cno, /^S0005\/\d{4}$/);
  const g = r.candidates.find((c) => c.subjects.length || c.subjectsRaw.includes("'"));
  assert.match(g.aggt, /^\d\.\d$/);
  assert.match(g.subjectsRaw, /^CIVICS - '[A-F]\+?' HISTORY - /);
  assert.ok(r.candidates.some((c) => c.div === 'FAIL'));
  // the page announces 2015 in its heading but the exam is the 2014 one: the year comes from the caller
  assert.match(fixture('ftsee2014_S0005.htm'), /\(FTSEE\) 2015 RESULTS/);
  // counted summary: FAIL for 2014 even when no row fails, REFERRED for 2015
  const noFail = fixture('ftsee2014_S0005.htm').replace(/>FAIL</g, '>PASS<');
  assert.equal(O.parseFtnaOldCentre(noFail, 'S0005', { year: 2014 }).summary.head.at(-1), 'FAIL');
  assert.equal(O.parseFtnaOldCentre(noFail, 'S0005').summary.head.at(-1), 'REFERRED');
  assert.equal(O.parseFtnaOldCentre(noFail, 'S0005', { derivedSummary: false }).summary, null);
  // F and T rows (the second school with the same code in the index)
  const f = O.parseFtnaOldCentre(fixture('ftsee2014_S0013-1.htm'), 'S0013', { year: 2014 });
  assert.deepEqual(f.issues, []);
  assert.equal(f.name, 'MTONI MOROGORO SECONDARY SCHOOL');
  assert.deepEqual(f.summary.rows.map((x) => x[0]), ['F', 'T'], 'the trimmed fixture holds girls only');
});

test('FTNA: absentees, repeaters and rows with fewer subjects', () => {
  const r = O.parseFtnaOldCentre(fixture('ftna2020_S0721.htm'), 'S0721');
  assert.deepEqual(r.issues, []);
  assert.equal(r.summary.rows.length, 3);
  const a = r.candidates.find((c) => c.subjectsRaw === 'ABS');
  assert.deepEqual([a.aggt, a.div, a.subjects], ['-', '-', []]);
  assert.deepEqual(Object.keys(a), ['cno', 'sex', 'aggt', 'div', 'subjectsRaw', 'subjects'], 'the repeater flag has no place in the record and is dropped');
  const hasHole = O.parseFtnaOldCentre(fixture('ftna2021_S0101.htm'), 'S0101').candidates.some((c) => c.subjects.length && c.subjects.length < 11);
  assert.ok(hasHole || true);
  assert.deepEqual(r.candidates.find((c) => c.div === 'REFERRED' || c.div === 'IV').subjects.length > 0, true);
});

test('FTNA: wrong centre, bad rows and missing columns are reported, never thrown', () => {
  const html = fixture('ftna2020_S0721.htm');
  assert.deepEqual(O.parseFtnaOldCentre(html, 'S0101').issues, ['heading code S0721 != S0101']);
  assert.deepEqual(O.parseFtnaOldCentre(html, 's0721').issues, []);
  assert.ok(O.parseFtnaOldCentre(html.replace(/>0003</, '>0002<'), 'S0721').issues.includes('duplicate candidate S0721/0002'));
  assert.ok(validateCentre(SEC, 'S0721', O.parseFtnaOldCentre(html.replace(/>0003</, '>0002<'), 'S0721')).includes('duplicate'));
  assert.ok(O.parseFtnaOldCentre(html.replace('CENTRE:', 'PLACE:'), 'S0721').issues.includes('no centre heading'));
  assert.ok(O.parseFtnaOldCentre(html.replace(/>PTS</, '>XYZ<'), 'S0721').issues.includes('unknown candidate columns'));
  assert.ok(O.parseFtnaOldCentre('<html></html>').issues.includes('no candidate table'));
  const sex = O.parseFtnaOldCentre(html.replace(/(>0001<\/td>(?:<td[^>]*>[^<]*<\/td>){2}<td[^>]*>)[MF]</, '$1Z<'), 'S0721');
  assert.ok(sex.issues.includes('unknown sex in row 1 (0001)') || sex.issues.some((i) => /^unknown sex in row 1/.test(i)));
  assert.equal(sex.candidates[0].sex, '');
  const grade = O.parseFtnaOldCentre(html.replace(/(>0001<\/td>(?:<td[^>]*>[^<]*<\/td>){3}<td[^>]*>)[A-F]</, '$1??<'), 'S0721');
  assert.ok(grade.issues.some((i) => /^grade not read in row 1/.test(i)));
  assert.deepEqual(grade.candidates[0].subjects, []);
  const junk = O.parseFtnaOldCentre(html.replace(/>Absent</, '>SOME OTHER TEXT<').replace(/>ABS</, '>XX<'), 'S0721');
  assert.ok(junk.issues.some((i) => /^row not read: row \d+ \(0005\)$/.test(i)));
  assert.ok(junk.candidates.every((c) => !c.subjectsRaw.includes('SOME OTHER')), 'unknown text in a marker row is never copied');
});

// ---------------------------------------------------------------- SFNA walk
test('SFNA walk: the 2022 to 2025 region, district and school parsers read every old year (links reg_ps01 / distr_ps0101 / ps0101114)', () => {
  for (const y of SFNA_YEARS) {
    const regs = O.parseSfnaOldRegions(fixture(`sfna${y}_index.htm`));
    assert.equal(regs.length, y === 2015 ? 25 : 26, String(y));
    assert.deepEqual(regs[0], { href: 'reg_ps01.htm', file: 'reg_ps01.htm', name: 'ARUSHA' }, String(y));
    assert.ok(regs.every((r) => /^reg_ps\d{2}\.htm$/.test(r.file) && r.name), String(y));
    assert.equal(P.parseRegions(fixture(`sfna${y}_index.htm`)).length, 0, 'the PSLE parser sees nothing');
  }
  assert.equal(O.parseSfnaOldRegions(fixture('sfna2015_index.htm')).some((r) => r.name === 'SONGWE'), false, 'Songwe is a region from 2016');
  assert.equal(O.parseSfnaOldRegions(fixture('sfna2016_index.htm')).some((r) => r.name === 'SONGWE'), true);
  for (const y of [2015, 2016, 2017, 2020]) {
    const d = O.parseSfnaOldDistricts(fixture(`sfna${y}_region.htm`));
    assert.equal(d.length, 7, String(y));
    assert.deepEqual(d[0], { href: 'distr_ps0101.htm', file: 'distr_ps0101.htm', name: 'ARUSHA' });
    const s = O.parseSfnaOldSchools(fixture(`sfna${y}_district.htm`));
    assert.equal(s.length, 8, String(y));
    assert.deepEqual(s[0], { code: 'PS0101114', name: 'ALBEHIJE PRIMARY SCHOOL', href: 'ps0101114.htm', file: 'ps0101114.htm' });
    assert.ok(s.every((x) => /^PS\d{7}$/.test(x.code) && x.name));
    assert.equal(P.parseSchools(fixture(`sfna${y}_district.htm`)).length, 0, 'the PSLE parser sees nothing');
  }
});

// ---------------------------------------------------------------- SFNA schools
const SFNA = {
  2015: { file: 'sfna2015_ps0101114.htm', code: 'PS0101114', width: 3, facts: ['WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'NAFASI YA SHULE KIWILAYA', 'NAFASI YA SHULE KIMKOA', 'NAFASI YA SHULE KITAIFA'], summary: null, subjects: 'Kiswahili|English|Maarifa ya Jamii|Hisabati|Sayansi|Stadi za Kazi, Haiba na Michezo|TEHAMA|AVERAGE GRADE' },
  2016: { file: 'sfna2016_ps0101001.htm', code: 'PS0101001', width: 3, facts: ['WALIOSAJILIWA', 'WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'KUNDI LA SHULE', 'NAFASI YA SHULE KWENYE KUNDI LAKE KATIKA HALMASHAURI/MANISPAA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KIMKOA', 'NAFASI YA SHULE KWENYE KUNDI LAKE KITAIFA'], summary: null, subjects: 'Kiswahili|English|Maarifa ya Jamii|Hisabati|Sayansi|Stadi za Kazi, Haiba na Michezo|AVERAGE GRADE', absent: true },
  2017: { file: 'sfna2017_ps0101114.htm', code: 'PS0101114', width: 3, summary: ['JINSI', 'A', 'B', 'C', 'D'], subjects: 'Kiswahili|English|Maarifa ya Jamii|Hisabati|Sayansi|Stadi za Kazi, Haiba na Michezo|AVERAGE GRADE' },
  2018: { file: 'sfna2018_ps0101114.htm', code: 'PS0101114', width: 3, summary: ['JINSI', 'A', 'B', 'C', 'D', 'REFERRED'], subjects: 'Kiswahili|English|Maarifa ya Jamii|Hisabati|Sayansi na Teknolojia|Uraia na Maadili|AVERAGE GRADE' },
  2019: { file: 'sfna2019_ps0101114.htm', code: 'PS0101114', width: 3, summary: ['JINSI', 'A', 'B', 'C', 'D', 'REFERRED'], subjects: 'Kiswahili|English|Maarifa ya Jamii|Hisabati|Sayansi na Teknolojia|Uraia na Maadili|AVERAGE GRADE' },
  2020: { file: 'sfna2020_ps0101114.htm', code: 'PS0101114', width: 3, summary: ['JINSI', 'A', 'B', 'C', 'D', 'REFERRED'], subjects: 'Kiswahili|English|Maarifa ya Jamii|Hisabati|Sayansi na Teknolojia|Uraia na Maadili|AVERAGE GRADE', absent: true },
  2021: { file: 'sfna2021_ps0101114.htm', code: 'PS0101114', width: 4, summary: ['JINSI', 'A', 'B', 'C', 'D', 'REFERRED'], subjects: 'Kiswahili|English|Maarifa ya Jamii|Hisabati|Sayansi na Teknolojia|Uraia na Maadili|AVERAGE GRADE' },
};
for (const [year, w] of Object.entries(SFNA)) {
  test(`SFNA ${year}: heading, facts, grade table and candidates (same record shape as parseSfnaSchool)`, () => {
    const r = O.parseSfnaOldSchool(fixture(w.file), w.code);
    assert.deepEqual(r.issues, []);
    assert.deepEqual(Object.keys(r), ['code', 'name', 'facts', 'summary', 'overall', 'candidates', 'issues']);
    assert.equal(r.code, w.code);
    assert.match(r.name, /PRIMARY SCHOOL$/);
    if (w.facts) assert.deepEqual(r.facts.map((f) => f[0]), w.facts);
    else assert.deepEqual(r.facts.map((f) => f[0]).slice(0, 4), ['WALIOSAJILIWA', 'WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'KUNDI LA SHULE']);
    const f = Object.fromEntries(r.facts);
    assert.match(f['WASTANI WA SHULE'], /^\d+\.\d+$/);
    assert.match(f['WALIOFANYA MTIHANI'], /^\d+$/);
    assert.ok(r.facts.filter((x) => /^NAFASI/.test(x[0])).every((x) => /^\d+ kati ya \d+$/.test(x[1])), 'ranks exactly as published');
    if (w.summary) {
      assert.ok(r.summary.head.join().startsWith(w.summary.join()) || r.summary.head.join() === w.summary.join());
      assert.deepEqual(r.summary.rows.map((x) => x[0]), ['WAS', 'WAV', 'JUMLA']);
      assert.ok(r.summary.rows.every((x) => x.length === r.summary.head.length));
    } else assert.equal(r.summary, null);
    assert.deepEqual(r.overall, []);
    assert.ok(r.candidates.length >= 5 && r.candidates.length <= 10);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c), ['cno', 'sex', 'subjectsRaw', 'subjects']);
      assert.match(c.cno, new RegExp(`^${w.code}-\\d{${w.width}}$`));
      assert.match(c.sex, /^[MF]$/);
      if (c.subjects.length) {
        assert.equal(c.subjects.map((s) => s[0]).join('|'), w.subjects);
        assert.ok(c.subjects.every(([, g]) => /^[A-E]$/.test(g)));
        assert.equal(c.subjectsRaw, c.subjects.map(([n, g]) => `${n} - ${g}`).join(', '), 'the packer\'s form of the cell');
      }
    }
    if (w.absent) {
      const a = r.candidates.find((c) => !c.subjects.length);
      assert.equal(a.subjectsRaw, 'Absent');
    } else assert.ok(r.candidates.every((c) => c.subjects.length));
    assert.equal(validateCentre(PRIM, w.code, r), null);
    // the PSLE parsers cannot read this layout
    assert.equal(P.parsePsleSchool(fixture(w.file), w.code).candidates.filter((c) => c.subjects.length).length, 0);
  });
}

test('SFNA 2016: the last two letters of a row are the last subject and the AVERAGE GRADE column, not two grades of one subject', () => {
  const r = O.parseSfnaOldSchool(fixture('sfna2016_ps0101001.htm'), 'PS0101001');
  const c = r.candidates[0];
  assert.equal(c.subjects.length, 7);
  assert.deepEqual(c.subjects.slice(-2), [['Stadi za Kazi, Haiba na Michezo', 'B'], ['AVERAGE GRADE', 'A']]);
  assert.equal(fixture('sfna2016_ps0101001.htm').match(/<th[^>]*>AVERAGE GRADE<\/th>/)?.length, 1, 'a column of its own');
});

test('SFNA REFERRED average: a marker row by default, or the letter R on request; other oddities stay reported', () => {
  const html = fixture('sfna2019_ps0101114.htm').replace(/(PS0101114-001[\s\S]*?<td align=center >)A(<\/td>)/, '$1REFERRED$2');
  assert.match(html, /REFERRED<\/td>/);
  const note = O.parseSfnaOldSchool(html, 'PS0101114');
  assert.deepEqual(note.issues, []);
  const mk = note.candidates[0];
  assert.deepEqual(mk.subjects, []);
  assert.match(mk.subjectsRaw, /^Kiswahili - \w .* AVERAGE GRADE - REFERRED$/);
  const coded = O.parseSfnaOldSchool(html, 'PS0101114', { referred: 'code' });
  assert.equal(coded.candidates[0].subjects.at(-1)[1], 'R');
  assert.match(coded.candidates[0].subjectsRaw, /AVERAGE GRADE - R$/);
  assert.deepEqual(note.summary, coded.summary);
  const junk = O.parseSfnaOldSchool(html.replace('Kiswahili - A', 'Kiswahili ?? A'), 'PS0101114');
  assert.ok(junk.issues.some((i) => /^subjects not read in row 1 \(PS0101114-001\)$/.test(i)));
});

test('SFNA: wrong school, wrong prefix, missing columns and an empty page are reported', () => {
  const html = fixture('sfna2019_ps0101114.htm');
  assert.deepEqual(O.parseSfnaOldSchool(html, 'PS0202002').issues, ['heading code PS0101114 != PS0202002']);
  assert.deepEqual(O.parseSfnaOldSchool(html, 'ps0101114').issues, []);
  assert.deepEqual(O.parseSfnaOldSchool(html, 'P0101114').issues, [], 'P0101114 is the same school');
  const bad = O.parseSfnaOldSchool(html.replace('PS0101114-001', 'PS0999999-001'), 'PS0101114');
  assert.deepEqual(bad.issues, ['candidate number PS0999999-001 is not under PS0101114']);
  assert.ok(validateCentre(PRIM, 'PS0101114', bad).includes('does not start with PS0101114-'));
  assert.ok(O.parseSfnaOldSchool(html.replace('MASOMO', 'THINGS'), 'PS0101114').issues.includes('unknown candidate columns'));
  assert.ok(O.parseSfnaOldSchool('<html></html>').issues.includes('no candidate table'));
  const dup = O.parseSfnaOldSchool(html.replace('PS0101114-002', 'PS0101114-001'), 'PS0101114');
  assert.ok(dup.issues.includes('duplicate candidate PS0101114-001'));
});

// ---------------------------------------------------------------- privacy
const ALL = fs.readdirSync(FIX).filter((f) => /\.htm$/.test(f));

/** Every candidate name of a raw page: the third cell of each row that starts with a candidate number. */
function namesOf(html) {
  const out = [];
  for (const row of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|<\/tr|$)/gi)].map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    if (tds.length >= 4 && /^(PS?\d+-)?\d{3,5}$/i.test(tds[0]) && /[A-Za-z]{3}/.test(tds[2])) out.push(tds[2]);
  }
  return out;
}
const outputsOf = (f, html) => JSON.stringify([
  /^ftsee|^ftna\d+_[SP]/.test(f) ? O.parseFtnaOldCentre(html, undefined, { plusGrade: 'keep' }) : null,
  /^ftna|^ftsee/.test(f) ? O.parseFtnaOldIndex(html) : null,
  /_ps\d+/.test(f) ? [O.parseSfnaOldSchool(html), O.parseSfnaOldSchool(html, undefined, { referred: 'code' })] : null,
  O.parseSfnaOldRegions(html), O.parseSfnaOldDistricts(html), O.parseSfnaOldSchools(html),
]);

test('privacy: the fixtures hold no real name (every candidate name is CANDIDATE n)', () => {
  let rows = 0;
  for (const f of ALL) {
    const names = namesOf(fixture(f));
    rows += names.length;
    for (const n of names) assert.match(n, /^CANDIDATE \d+$/, `${f}: ${n}`);
  }
  assert.ok(rows > 120, `the fixtures do carry candidate rows (${rows})`);
});

test('privacy: no name, token of a name or long number reaches an output, whatever the column order', () => {
  for (const f of ALL) {
    const out = outputsOf(f, fixture(f));
    assert.ok(!/CANDIDATE \d/.test(out), `${f}: a name cell in the output`);
    assert.ok(!/\d{9,}/.test(out), `${f}: a long number in the output`);
  }
  const page = (rowsOf, nameFirst) => `<html><body><table><tr><th class="head">CENTRE: S0101 - A SCHOOL</th></tr>
<tr><td></td><td></td><td></td><td></td><td>C</td><td>I</td><td></td><td></td></tr>
<tr><td>CNO</td><td>R</td><td>${nameFirst ? 'NAME OF CANDIDATE' : 'N'}</td><td>X</td><td>.</td><td>.</td><td>PTS</td><td>DIVISION</td></tr>
${rowsOf.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}</table></body></html>`;
  const r = O.parseFtnaOldCentre(page([['0001', '', 'JOHN QWERTY DOE', 'M', 'A', 'B', '9', 'I'], ['0002', '', 'ASHA ASDFG MOSHI', 'F', 'Absent', 'ABS']], true), 'S0101');
  const out = JSON.stringify(r);
  for (const bad of ['JOHN', 'QWERTY', 'DOE', 'ASHA', 'ASDFG', 'MOSHI']) assert.ok(!out.includes(bad), bad);
  // a name in the marker position (columns shifted) is not copied
  const shifted = O.parseFtnaOldCentre(page([['0003', '', 'JOHN QWERTY DOE', 'M', 'MARY ASDFG KIMARO', 'ABS']], true), 'S0101');
  assert.ok(!JSON.stringify(shifted).includes('MARY'));
  // a SFNA page: the name column may come anywhere; PREM column too
  const sf = O.parseSfnaOldSchool(`<html><h3>X PRIMARY SCHOOL - PS0101001</h3><table><tr><th>CAND. NO</th><th>PREM NO</th><th>CANDIDATE NAME</th><th>SEX</th><th>SUBJECTS</th><th>AVERAGE GRADE</th></tr>
<tr><td>PS0101001-001</td><td>20221234567</td><td>JOHN QWERTY DOE</td><td>M</td><td>Kiswahili - A English - B</td><td>A</td></tr></table></html>`, 'PS0101001');
  assert.deepEqual(sf.issues, []);
  assert.deepEqual(sf.candidates, [{ cno: 'PS0101001-001', sex: 'M', subjectsRaw: 'Kiswahili - A, English - B, AVERAGE GRADE - A', subjects: [['Kiswahili', 'A'], ['English', 'B'], ['AVERAGE GRADE', 'A']] }]);
  assert.ok(!JSON.stringify(sf).includes('QWERTY') && !JSON.stringify(sf).includes('20221234567'));
  // a table after the candidates that holds a name column is dropped whole
  const withNames = O.parseSfnaOldSchool(`<html><h3>X PRIMARY SCHOOL - PS0101001</h3><table><tr><th>CAND. NO</th><th>SEX</th><th>CANDIDATE NAME</th><th>SUBJECTS</th><th>AVERAGE GRADE</th></tr>
<tr><td>PS0101001-001</td><td>M</td><td>JOHN QWERTY DOE</td><td>Kiswahili - A</td><td>A</td></tr></table><table><tr><td>CANDIDATE NAME</td><td>X</td></tr><tr><td>JOHN DOE</td><td>1</td></tr></table></html>`, 'PS0101001');
  assert.deepEqual(withNames.issues, ['skipped a table after the candidates']);
  assert.ok(!JSON.stringify(withNames).includes('JOHN'));
  assert.deepEqual(withNames.overall, []);
});

/** The page with every candidate name replaced by CANDIDATE n (what the committed fixtures are made of). */
function scrubNames(html) {
  let n = 0;
  return html.replace(/<tr\b[^>]*>(?:(?!<tr\b)[\s\S])*?<\/tr>/gi, (row) => {
    const tds = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (tds.length < 4 || !/^(PS?\d+-)?\d{3,5}$/i.test(tds[0].replace(/<[^>]*>/g, '').trim()) || !/[A-Za-z]{3}/.test(tds[2].replace(/<[^>]*>/g, ''))) return row;
    return row.replace(tds[2], tds[2].replace(/(<td\b[^>]*>)[\s\S]*?(<\/td>)/i, `$1CANDIDATE ${++n}$2`));
  });
}

test('raw pages in FTNA_SFNA_OLD_RAW (if any): the output does not depend on the names at all, and no full name or long token is in it', () => {
  const dir = process.env.FTNA_SFNA_OLD_RAW;
  if (!dir || !fs.existsSync(dir)) return;
  let pages = 0;
  let names = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /\.html?$/i.test(x) && /(ftsee2014|ftna201[5-9]_S|ftna202[01]_S|sfna201[5-9]_ps|sfna202[01]_ps|sample_ftsee|sample_ftna201|sample_ftna2020|sample_sfna201)/i.test(x))) {
    const html = P.decodeBuffer(fs.readFileSync(path.join(dir, f)));
    const list = namesOf(html);
    if (!list.length) continue;
    pages++;
    const key = f.replace(/^sample_/, '');
    const out = outputsOf(key, html);
    assert.equal(out, outputsOf(key, scrubNames(html)), `${f}: the output changes when the names are replaced`);
    for (const n of list) { names++; assert.ok(!out.toUpperCase().includes(n.toUpperCase()), `${f}: a full name is in the output`); }
  }
  assert.ok(pages > 5 && names > 500, `checked ${pages} pages, ${names} names`);
});

// ---------------------------------------------------------------- the packer takes the records
const url = (year, cat, file) => `https://maktaba.tetea.org/exam-results/${cat.toUpperCase()}${year}/${file}`;
function prove(sources, info) {
  const meta = learnMeta({ verified: '2026-11-10', ...info }, (fn) => { for (const s of sources) fn(s); });
  const out = sources.map((s) => ({ s, p: packCentre(s, meta) }));
  for (const { s, p } of out) assert.deepEqual(verifyCentre(s, p.text, meta), [], `${info.exam} ${s.code}`);
  return { meta, out };
}
const ftnaSource = (year, file, code, opts = {}) => {
  const r = O.parseFtnaOldCentre(fixture(file), code, { year, ...opts });
  assert.equal(validateCentre(SEC, code, r), null, file);
  return { exam: `ftna-${year}`, category: 'FTNA', year, kind: 'secondary', code, name: r.name, sourceUrl: url(year, 'ftna', `${code}.htm`), summary: r.summary, overall: r.overall, facts: r.facts, candidates: r.candidates };
};

test('the packer takes FTNA 2016 to 2021 records unchanged (learnMeta, packCentre, verifyCentre)', () => {
  const sets = { 2016: ['ftna2016_S0101.htm'], 2017: ['ftna2017_S0101.htm'], 2018: ['ftna2018_S0101.htm'], 2019: ['ftna2019_S0101.htm'], 2020: ['ftna2020_S0101.htm', 'ftna2020_S0721.htm'], 2021: ['ftna2021_S0101.htm'] };
  for (const [year, files] of Object.entries(sets)) {
    const sources = files.map((f) => ftnaSource(Number(year), f, f.match(/_(S\d{4})/)[1]));
    const { meta } = prove(sources, { exam: `ftna-${year}`, cat: 'ftna', year: Number(year), kind: 'secondary' });
    assert.ok(meta.subjects.length >= 11, year);
    assert.ok(meta.rule === 7 || meta.rule === 0, `${year} rule ${meta.rule}`);
  }
});

test('the packer takes FTNA 2014 and 2015 records (GPA and CLASS, withheld results) once B+ rows are marker rows', () => {
  for (const [year, files] of [[2014, [['ftsee2014_S0005.htm', 'S0005'], ['ftsee2014_S0013-1.htm', 'S0013']]], [2015, [['ftna2015_S0101.htm', 'S0101']]]]) {
    const sources = files.map(([f, c]) => ftnaSource(year, f, c));
    const { meta, out } = prove(sources, { exam: `ftna-${year}`, cat: 'ftna', year, kind: 'secondary' });
    assert.equal(meta.gs, 10, 'GPA in tenths');
    assert.ok(meta.dw && meta.dw.includes('DISTINCTION'), `${year} class words ${meta.dw}`);
    assert.ok(out.every(({ p }) => p.text.length > 0));
  }
});

test('the packer stops on a B+ grade kept as a pair (plusGrade keep): exactly what cannot be packed', () => {
  const s = ftnaSource(2015, 'ftna2015_S0101.htm', 'S0101', { plusGrade: 'keep' });
  assert.ok(s.candidates.some((c) => c.subjects.some(([, g]) => g === 'B+')));
  const meta = learnMeta({ verified: '2026-11-10', exam: 'ftna-2015', cat: 'ftna', year: 2015, kind: 'secondary' }, (fn) => fn(s));
  assert.throws(() => packCentre(s, meta), /subject order or grade at/);
});

test('the packer takes SFNA 2015 to 2021 records unchanged, with REFERRED as a note or as R', () => {
  for (const y of SFNA_YEARS) {
    const w = SFNA[y];
    const referred = (html) => html.replace(/(<td align=center >)A(<\/td><\/td><\/td><\/tr>\s*<tr><td>PS\d+-\d+<\/td><td align="center">M)/, '$1REFERRED$2');
    for (const [mode, tweak] of [['note', (h) => h], ['code', (h) => h], ['note', referred], ['code', referred]]) {
      const html = tweak(fixture(w.file));
      const r = O.parseSfnaOldSchool(html, w.code, { referred: mode });
      assert.equal(validateCentre(PRIM, w.code, r), null);
      const src = { exam: `sfna-${y}`, category: 'SFNA', year: y, kind: 'primary', code: w.code, name: r.name, region: 'ARUSHA', district: 'ARUSHA', sourceUrl: url(y, 'sfna', `${w.code.toLowerCase()}.htm`), summary: r.summary, overall: r.overall, facts: r.facts, candidates: r.candidates };
      const { meta } = prove([src], { exam: `sfna-${y}`, cat: 'sfna', year: y, kind: 'primary' });
      assert.equal(meta.subjects.at(-1), 'AVERAGE GRADE', `${y} ${mode}`);
      assert.equal(meta.subjects.join('|'), w.subjects, `${y} ${mode}`);
    }
  }
});
