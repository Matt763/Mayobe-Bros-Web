// Offline tests of the FTNA (Form Two) and SFNA (Standard Four) parsers, 2022 to 2025. Nothing here touches the network.
// The pages in fixtures/ftna-sfna/ are real onlinesys.necta.go.tz pages trimmed to about ten candidates, with every PREM number
// replaced by a made-up 99000000NNN (no real PREM number is in the repository; the pages have no candidate names). The summary and
// ranking tables are the real page's, so their totals are larger than the trimmed candidate list.
// FTNA_SFNA_RAW=<folder with raw pages> adds one check against real PREM numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/necta-parse.mjs';
import * as F from '../lib/necta-parse-ftna-sfna.mjs';
import { learnMeta, packCentre, verifyCentre } from '../lib/results-pack.mjs';
import { validateCentre } from '../necta-import.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ftna-sfna');
const fixture = (f) => P.decodeBuffer(fs.readFileSync(path.join(FIX, f)));
const premsOf = (html) => [...new Set(html.match(/\b\d{11,12}\b/g) || [])];
const SEC = { kind: 'secondary' };
const PRIM = { kind: 'primary' };

// ---------------------------------------------------------------- FTNA
test('FTNA index: the code comes from the link; the text may be NAME (2022, 2023, 2025) or CODE  NAME (2024)', () => {
  for (const y of [2022, 2023, 2024, 2025]) {
    const html = fixture(`ftna${y}_index.htm`);
    assert.equal(P.parseExamIndex(html).centres.length > 0, y === 2024, 'parseExamIndex only copes with 2024');
    const r = F.parseFtnaIndex(html);
    assert.deepEqual(r.issues, [], String(y));
    assert.equal(r.centres.length, y === 2022 || y === 2023 ? 3 : 5, String(y));
    assert.equal(r.centres.filter((c) => c.code.startsWith('P')).length, y === 2022 || y === 2023 ? 0 : 2, String(y), 'private centres appear from 2024');
    for (const c of r.centres) { assert.match(c.code, /^[SP]\d{4}$/); assert.equal(c.href, `results/${c.code}.htm`); assert.ok(c.name && !c.name.startsWith(c.code)); }
  }
  const r25 = F.parseFtnaIndex(fixture('ftna2025_index.htm'));
  assert.deepEqual(r25.centres.find((c) => c.code === 'P0110'), { code: 'P0110', name: 'ILBORU SECONDARY SCHOOL CENTRE', href: 'results/P0110.htm' });
  assert.equal(r25.centres.find((c) => c.code === 'S0101').name, 'AZANIA SECONDARY SCHOOL');
  // lower case links, a duplicate, and an empty name
  const odd = F.parseFtnaIndex('<a href="results\\s0101.htm"> A SCHOOL</a><a href="results/S0101.htm"> A SCHOOL</a><a href="results/S0102.htm"> </a><a href="x.htm">no</a>');
  assert.deepEqual(odd.centres.map((c) => c.code), ['S0101']);
  assert.equal(odd.issues.length, 2);
  assert.deepEqual(F.parseFtnaIndex('<html></html>').issues, ['no centres found']);
});

const FTNA = {
  '2022': { file: 'ftna2022_S0101.htm', code: 'S0101', n: 9, abs: 'S0101/0248' },
  '2023': { file: 'ftna2023_S0101.htm', code: 'S0101', n: 9, abs: 'S0101/0102' },
  '2024': { file: 'ftna2024_S0101.htm', code: 'S0101', n: 9, abs: 'S0101/0001' },
  '2025': { file: 'ftna2025_S0101.htm', code: 'S0101', n: 9, ref: 'S0101/0049' },
};
for (const [year, w] of Object.entries(FTNA)) {
  test(`FTNA ${year}: heading, summary, ranking block and candidates`, () => {
    const html = fixture(w.file);
    const r = F.parseFtnaCentre(html, w.code);
    assert.deepEqual(r.issues, []);
    assert.deepEqual(Object.keys(r), ['code', 'name', 'summary', 'overall', 'candidates', 'issues'], 'same shape as parseSecondaryCentre');
    assert.equal(r.code, 'S0101');
    assert.equal(r.name, 'AZANIA SECONDARY SCHOOL', 'no leading "- "');
    assert.deepEqual(r.summary.head, ['SEX', 'I', 'II', 'III', 'IV', '0']);
    assert.equal(r.summary.rows.at(-1)[0], 'T');
    assert.equal(r.candidates.length, w.n);
    assert.deepEqual(r.overall.map((b) => b.t), ['h', 'kv', 'h', 'grid', 'h', 'grid'], 'ranking block as the CSEE parser reads it');
    assert.equal(r.overall[1].rows[0][0], 'EXAMINATION CENTRE REGION');
    assert.equal(r.overall[1].rows[0][1], 'DAR ES SALAAM');
    const parsed = r.candidates.filter((c) => c.subjects.length);
    assert.ok(parsed.length >= 7);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c), ['cno', 'sex', 'aggt', 'div', 'subjectsRaw', 'subjects']);
      assert.ok(c.cno.startsWith('S0101/'));
      assert.match(c.sex, /^[MF]$/);
    }
    const c1 = parsed[0];
    assert.match(c1.aggt, /^\d+$/);
    assert.match(c1.div, /^(I|II|III|IV|0|REFERRED)$/);
    assert.deepEqual(c1.subjects.slice(0, 2).map((s) => s[0]), ['CIV', 'HIST']);
    assert.ok(c1.subjects.every(([n, g]) => n && /^[A-F]$/.test(g)));
    assert.equal(c1.subjectsRaw, c1.subjects.map(([n, g]) => `${n} - '${g}'`).join(' '), 'the packer\'s form of the cell');
    assert.ok(!/-'/.test(c1.subjectsRaw), 'no compact CIV-\'C\' left');
    if (w.abs) {
      const a = r.candidates.find((c) => c.cno === w.abs);
      assert.deepEqual([a.aggt, a.div, a.subjectsRaw, a.subjects], ['-', '-', 'ABS', []]);
    }
    if (w.ref) {
      const a = r.candidates.find((c) => c.cno === w.ref);
      assert.equal(a.div, 'REFERRED');
      assert.ok(a.subjects.length > 5);
    }
    assert.equal(validateCentre(SEC, w.code, r), null);
  });
}

test('FTNA: the ranking block equals what parseSecondaryCentre reads from the same page, and the rows it misses are found', () => {
  for (const f of ['ftna2022_S0101.htm', 'ftna2025_S0101.htm', 'ftna2024_P0110.htm']) {
    const html = fixture(f);
    const mine = F.parseFtnaCentre(html);
    const old = P.parseSecondaryCentre(html);
    assert.deepEqual(mine.overall, old.overall, f);
    assert.equal(old.candidates.length, 0, 'parseSecondaryCentre finds no candidate rows (they have no <tr>)');
    assert.ok(mine.candidates.length >= 7);
  }
});

test('FTNA private centres: empty PReM, ranking in 2024 only, absentees kept', () => {
  const a = F.parseFtnaCentre(fixture('ftna2024_P0110.htm'), 'P0110');
  assert.deepEqual(a.issues, []);
  assert.equal(a.name, 'ILBORU SECONDARY SCHOOL CENTRE');
  assert.equal(a.candidates.length, 7);
  assert.equal(a.candidates.filter((c) => c.div === '-').length, 3);
  assert.equal(a.overall.length, 6);
  assert.deepEqual(a.candidates.find((c) => c.cno === 'P0110/0005').subjects.map((s) => s[0]), ['CIV', 'HIST', 'GEO', 'B/KNOWL', 'KISW', 'ENGL', 'BIO']);
  const b = F.parseFtnaCentre(fixture('ftna2025_P0110.htm'), 'P0110');
  assert.deepEqual(b.issues, []);
  assert.deepEqual(b.overall, [], 'no ranking block on this page');
  assert.equal(b.candidates.length, 6);
  assert.deepEqual(b.candidates.filter((c) => c.subjectsRaw === 'ABS').map((c) => c.cno), ['P0110/0004', 'P0110/0006'], 'the last row ends with the malformed </tr</tr>> and is still read');
});

test('FTNA: wrong centre, wrong prefix, bad rows and missing columns are reported, never thrown', () => {
  const html = fixture('ftna2025_P0110.htm');
  assert.deepEqual(F.parseFtnaCentre(html, 'S0101').issues, ['heading code P0110 != S0101']);
  assert.deepEqual(F.parseFtnaCentre(html, 'p0110').issues, []);
  const bad = html.replace('P0110/0001', 'P0111/0001');
  assert.deepEqual(F.parseFtnaCentre(bad, 'P0110').issues, ['candidate number P0111/0001 is not under P0110']);
  assert.ok(validateCentre(SEC, 'P0110', F.parseFtnaCentre(bad, 'P0110')).includes('does not start with P0110/'));
  assert.match(F.parseFtnaCentre(html.replace('<h3', '<h4').replace('</h3>', '</h4>'), 'P0110').issues[0], /no centre heading/);
  assert.ok(F.parseFtnaCentre(html.replace('DETAILED SUBJECTS', 'SOMETHING'), 'P0110').issues.includes('unknown candidate columns'));
  assert.ok(F.parseFtnaCentre('<html></html>').issues.includes('no candidates found'));
  const sex = F.parseFtnaCentre(html.replace(/(P0110\/0001[\s\S]*?<font[^>]*>)F</, '$1Z<'), 'P0110');
  assert.ok(sex.issues.some((i) => /^unknown sex in row 1 \(P0110\/0001\)$/.test(i)));
  assert.equal(sex.candidates[0].sex, '');
  const dup = html.replace('P0110/0002', 'P0110/0001');
  assert.ok(F.parseFtnaCentre(dup, 'P0110').issues.includes('duplicate candidate P0110/0001'));
  const junk = html.replace("CIV-'F' HIST-'F' GEO-'D'", "CIV-'F' ??? GEO-'D'");
  assert.ok(F.parseFtnaCentre(junk, 'P0110').issues.some((i) => /^subjects not read in row 1/.test(i)));
});

test('FTNA subjects: spaces and dots in names; a cell with leftovers is not turned into pairs', () => {
  const ok = F.parseFtnaSubjects("CIV-'C' PHY EDU-'F' B/KEEPING-'F' F.ART-'C' E/D/KIISLAMU-'B'");
  assert.deepEqual(ok.pairs.map((p) => p[0]), ['CIV', 'PHY EDU', 'B/KEEPING', 'F.ART', 'E/D/KIISLAMU']);
  assert.equal(ok.raw, "CIV - 'C' PHY EDU - 'F' B/KEEPING - 'F' F.ART - 'C' E/D/KIISLAMU - 'B'");
  assert.deepEqual(F.parseFtnaSubjects("CIV-'C' garbage").pairs, []);
  assert.deepEqual(F.parseFtnaSubjects('ABS'), { pairs: [], raw: 'ABS' });
  assert.deepEqual(F.parseFtnaSubjects(''), { pairs: [], raw: '' });
});

// ---------------------------------------------------------------- SFNA
test('SFNA walk: regions, districts and schools (no shl_ prefix, reg_ps / distr_ps names)', () => {
  const idx = fixture('sfna2025_index.htm');
  assert.equal(P.parseRegions(idx).length, 0, 'the existing parser sees nothing');
  const regs = F.parseSfnaRegions(idx);
  assert.deepEqual(regs[0], { href: 'results/reg_ps01.htm', file: 'reg_ps01.htm', name: 'ARUSHA' });
  assert.equal(regs.length, 4);
  assert.equal(F.parseSfnaRegions(fixture('sfna2022_index.htm')).length, 3);
  const dis = F.parseSfnaDistricts(fixture('sfna2025_region.htm'));
  assert.deepEqual(dis[0], { href: 'distr_ps0101.htm', file: 'distr_ps0101.htm', name: 'ARUSHA' });
  assert.equal(dis.length, 4);
  for (const f of ['sfna2025_district.htm', 'sfna2023_district.htm']) {
    assert.equal(P.parseSchools(fixture(f)).length, 0);
    const s = F.parseSfnaSchools(fixture(f));
    assert.equal(s.length, 6, f);
    assert.deepEqual(s[0], { code: 'PS0101114', name: 'ALBEHIJE PRIMARY SCHOOL', href: 'ps0101114.htm', file: 'ps0101114.htm' });
    assert.ok(s.every((x) => /^PS\d{7}$/.test(x.code)));
  }
  assert.deepEqual(F.parseSfnaSchools('<A HREF="ps0101114.htm">X - PS0101114</A><A HREF="reg_ps01.htm">R</A><A HREF="x.htm">n</A>').map((x) => x.name), ['X']);
});

const NEW = 'JIO & SANAA|HIST.TZ|KISWAHILI|ENGLISH|HISABATI|SAYANSI|AVERAGE GRADE';
const OLD = 'KISWAHILI|ENGLISH|MAARIFA YA JAMII|HISABATI|SAYANSI NA TEKNOLOJIA|URAIA NA MAADILI|AVERAGE GRADE';
const SFNA = {
  2022: { sat: '15', avg: '222.7333', rows: ['WAS', 'WAV', 'JUMLA'], names: OLD },
  2023: { sat: '20', avg: '265.55', names: OLD },
  2024: { sat: '9', avg: '227.2222', names: OLD },
  2025: { sat: '15', avg: '225.47', names: NEW },
};
for (const [year, w] of Object.entries(SFNA)) {
  test(`SFNA ${year}: heading, facts, grade table, subject table and candidates`, () => {
    const r = F.parseSfnaSchool(fixture(`sfna${year}_ps0101114.htm`), 'PS0101114');
    assert.deepEqual(r.issues, []);
    assert.deepEqual(Object.keys(r), ['code', 'name', 'facts', 'summary', 'overall', 'candidates', 'issues'], 'same shape as parsePsleSchool');
    assert.deepEqual([r.code, r.name], ['PS0101114', 'ALBEHIJE PRIMARY SCHOOL']);
    const facts = Object.fromEntries(r.facts);
    assert.equal(facts['WALIOFANYA MTIHANI'], w.sat);
    assert.equal(facts['WASTANI WA SHULE'], w.avg);
    assert.match(facts.DARAJA, /^DARAJA [A-E] \(/, 'same value as parsePsleSchool gives');
    assert.deepEqual(r.facts.map((f) => f[0]), ['WALIOFANYA MTIHANI', 'WASTANI WA SHULE', 'DARAJA']);
    assert.deepEqual(r.summary.head, ['JINSI', 'A', 'B', 'C', 'D', 'REFERRED']);
    assert.deepEqual(r.summary.rows.map((x) => x[0]), ['WAS', 'WAV', 'JUMLA']);
    assert.deepEqual(r.overall.map((b) => b.t), ['h', 'grid']);
    assert.equal(r.overall[1].head.length, 9);
    assert.equal(r.overall[1].rows.length, 6);
    assert.equal(r.overall[1].head[7], 'WASTANI WA ALAMA (/50)');
    assert.ok(r.candidates.length >= 8);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c), ['cno', 'sex', 'subjectsRaw', 'subjects']);
      assert.match(c.cno, /^PS0101114-\d{4}$/);
      assert.match(c.sex, /^[MF]$/);
      assert.equal(c.subjects.map((s) => s[0]).join('|'), w.names);
      assert.ok(c.subjects.every(([, g]) => /^[A-E]$/.test(g)));
      assert.equal(c.subjectsRaw, c.subjects.map(([n, g]) => `${n} - ${g}`).join(', '), 'the packer\'s form of the cell');
    }
    assert.equal(validateCentre(PRIM, 'PS0101114', r), null);
    // the same page by the PSLE parser: it already works for everything except the subjects cell
    const psle = P.parsePsleSchool(fixture(`sfna${year}_ps0101114.htm`), 'PS0101114');
    assert.deepEqual(psle.candidates.map((c) => c.cno), [], 'parsePsleSchool finds no rows: the table has <th> headers');
    assert.equal(psle.candidates.filter((c) => c.subjects.length).length, 0, 'parsePsleSchool cannot read the space-separated cell');
  });
}

test('SFNA REFERRED average: a marker row by default, or the letter R on request', () => {
  for (const [file, code, year] of [['sfna2022_ps0101001_referred.htm', 'PS0101001', 2022], ['sfna2025_ps0101001_referred.htm', 'PS0101001', 2025]]) {
    const html = fixture(file);
    assert.match(html, /AVERAGE GRADE - REFERRED/);
    const note = F.parseSfnaSchool(html, code);
    const marks = note.candidates.filter((c) => !c.subjects.length);
    assert.ok(marks.length >= 1, String(year));
    assert.ok(marks.every((c) => /AVERAGE GRADE - REFERRED$/.test(c.subjectsRaw)));
    assert.ok(marks.every((c) => !c.subjectsRaw.includes(', ')), 'the published text, unchanged');
    assert.deepEqual(note.issues, []);
    const coded = F.parseSfnaSchool(html, code, { referred: 'code' });
    assert.deepEqual(coded.issues, []);
    assert.equal(coded.candidates.filter((c) => !c.subjects.length).length, 0);
    const r = coded.candidates.filter((c) => c.subjects.at(-1)[1] === 'R');
    assert.equal(r.length, marks.length);
    assert.ok(r.every((c) => /AVERAGE GRADE - R$/.test(c.subjectsRaw)));
    assert.deepEqual(note.summary, coded.summary);
  }
});

test('SFNA subjects: names with & . and spaces; anything else stays text', () => {
  assert.deepEqual(F.parseSfnaSubjects('JIO & SANAA - B HIST.TZ - C AVERAGE GRADE - REFERRED'), [['JIO & SANAA', 'B'], ['HIST.TZ', 'C'], ['AVERAGE GRADE', 'REFERRED']]);
  assert.deepEqual(F.parseSfnaSubjects('ABS'), []);
  assert.deepEqual(F.parseSfnaSubjects('KISWAHILI - A and then something'), []);
  assert.deepEqual(F.parseSfnaSubjects(''), []);
});

test('SFNA: wrong school, wrong prefix, bad rows and missing columns are reported', () => {
  const html = fixture('sfna2025_ps0101114.htm');
  assert.deepEqual(F.parseSfnaSchool(html, 'PS0202002').issues, ['heading code PS0101114 != PS0202002']);
  assert.deepEqual(F.parseSfnaSchool(html, 'ps0101114').issues, []);
  const bad = F.parseSfnaSchool(html.replace('PS0101114-0001', 'PS0999999-0001'), 'PS0101114');
  assert.deepEqual(bad.issues, ['candidate number PS0999999-0001 is not under PS0101114']);
  assert.ok(validateCentre(PRIM, 'PS0101114', bad).includes('does not start with PS0101114-'));
  assert.ok(F.parseSfnaSchool(html.replace('SUBJECTS', 'THINGS'), 'PS0101114').issues.includes('unknown candidate columns'));
  assert.ok(F.parseSfnaSchool('<html></html>').issues.includes('no candidates found'));
  assert.ok(F.parseSfnaSchool(html.replace('KISWAHILI - B', 'KISWAHILI ?? B'), 'PS0101114').issues.some((i) => /^subjects not read in row \d+ \(PS0101114-\d{4}\)$/.test(i)));
  const ab = F.parseSfnaSchool(html.replace(/(PS0101114-0002.*?<td>)[^<]*/s, '$1ABS'), 'PS0101114');
  assert.deepEqual(ab.issues, []);
  assert.deepEqual([ab.candidates[1].subjectsRaw, ab.candidates[1].subjects], ['ABS', []]);
});

// ---------------------------------------------------------------- privacy
const ALL = fs.readdirSync(FIX).filter((f) => /\.htm$/.test(f));
test('privacy: no PREM number (or any run of 9+ digits) reaches any output, issue message or fixture value', () => {
  let seen = 0;
  for (const f of ALL) {
    const html = fixture(f);
    const prems = premsOf(html);
    seen += prems.length;
    const out = JSON.stringify([
      /^ftna\d+_index/.test(f) ? F.parseFtnaIndex(html) : null,
      /^ftna\d+_[SP]/.test(f) ? F.parseFtnaCentre(html) : null,
      /_ps\d+/.test(f) ? [F.parseSfnaSchool(html), F.parseSfnaSchool(html, undefined, { referred: 'code' })] : null,
      F.parseSfnaRegions(html), F.parseSfnaDistricts(html), F.parseSfnaSchools(html),
    ]);
    for (const p of prems) assert.ok(!out.includes(p), `${f}: PREM ${p} in the output`);
    assert.ok(!/\d{9,}/.test(out), `${f}: a long number in the output`);
  }
  assert.ok(seen > 40, 'the fixtures do carry PREM-like numbers (made up), so this test can fail');
});

test('privacy: a real-looking PREM and a name column are skipped, also when they are in a different column order', () => {
  const page = (cols, rowsOf) => `<html><body><h3>S0101 - A SCHOOL</h3><table><tr><td>SEX</td><td>I</td></tr><tr><td>M</td><td>1</td></tr></table>
<table><tr>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>${rowsOf.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
  const html = page(['CNO', 'CANDIDATE NAME', 'PReM NO', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'],
    [['S0101/0001', 'JOHN QWERTY DOE', '20181234567', 'M', '9', 'I', "CIV-'A' HIST-'B'"], ['S0101/0002', 'ASHA ASDFG MOSHI', '201812345678', 'F', '', '', 'ABS']]);
  const r = F.parseFtnaCentre(html, 'S0101');
  assert.deepEqual(r.issues, []);
  const out = JSON.stringify(r);
  for (const bad of ['JOHN', 'DOE', 'ASHA', 'MOSHI', '20181234567', '201812345678']) assert.ok(!out.includes(bad), bad);
  assert.equal(r.candidates.length, 2);
  // a table after the candidates that holds a name column is dropped whole
  const withNames = html.replace('</body>', '<table><tr><td>CANDIDATE NAME</td><td>X</td></tr><tr><td>JOHN DOE</td><td>1</td></tr></table></body>');
  const r2 = F.parseFtnaCentre(withNames, 'S0101');
  assert.deepEqual(r2.issues, ['skipped a table after the candidates']);
  assert.ok(!JSON.stringify(r2).includes('JOHN'));
  // an issue note never carries another cell of the row (here the PREM is where the number should be)
  const swapped = F.parseFtnaCentre(page(['CNO', 'PReM NO', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'], [['20181234567', 'S0101/0001', 'M', '9', 'I', "CIV-'A'"]]), 'S0101');
  assert.ok(swapped.issues.includes('skipped row 1'));
  assert.ok(!JSON.stringify(swapped).includes('20181234567'));
  const sf = F.parseSfnaSchool(`<html><h3>X PRIMARY - PS0101001</h3><table><tr><th>CAND. NO</th><th>PREM NO</th><th>CANDIDATE NAME</th><th>SEX</th><th>SUBJECTS</th></tr>
<tr><td>PS0101001-0001</td><td>20221234567</td><td>JOHN QWERTY DOE</td><td>M</td><td>KISWAHILI - A AVERAGE GRADE - A</td></tr></table></html>`, 'PS0101001');
  assert.deepEqual(sf.issues, []);
  assert.deepEqual(sf.candidates, [{ cno: 'PS0101001-0001', sex: 'M', subjectsRaw: 'KISWAHILI - A, AVERAGE GRADE - A', subjects: [['KISWAHILI', 'A'], ['AVERAGE GRADE', 'A']] }]);
});

test('raw pages in FTNA_SFNA_RAW (if any): not one real PREM number appears in any output', () => {
  const dir = process.env.FTNA_SFNA_RAW;
  if (!dir || !fs.existsSync(dir)) return;
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^(sample|x)_.*\.htm$/i.test(x))) {
    const html = P.decodeBuffer(fs.readFileSync(path.join(dir, f)));
    const prems = premsOf(html);
    const out = JSON.stringify(/ftna/.test(f) ? F.parseFtnaCentre(html) : F.parseSfnaSchool(html, undefined, { referred: 'code' }));
    for (const p of prems) assert.ok(!out.includes(p), `${f}: ${p}`);
    if (prems.length) checked++;
  }
  assert.ok(checked > 0);
});

// ---------------------------------------------------------------- the packer takes the records
const url = (year, cat, file) => `https://onlinesys.necta.go.tz/results/${year}/${cat}/${file}`;
function prove(sources, info) {
  const meta = learnMeta({ verified: '2026-11-10', ...info }, (fn) => { for (const s of sources) fn(s); });
  const out = sources.map((s) => ({ s, p: packCentre(s, meta) }));
  for (const { s, p } of out) assert.deepEqual(verifyCentre(s, p.text, meta), [], `${info.exam} ${s.code}`);
  return { meta, out };
}

test('the packer takes FTNA records of every year unchanged (learnMeta, packCentre, verifyCentre)', () => {
  for (const [year, files] of [[2022, ['ftna2022_S0101.htm']], [2023, ['ftna2023_S0101.htm']], [2024, ['ftna2024_S0101.htm', 'ftna2024_P0110.htm']], [2025, ['ftna2025_S0101.htm', 'ftna2025_P0110.htm']]]) {
    const sources = files.map((f) => {
      const code = f.match(/_([SP]\d{4})/)[1];
      const r = F.parseFtnaCentre(fixture(f), code);
      assert.equal(validateCentre(SEC, code, r), null);
      return { exam: `ftna-${year}`, category: 'FTNA', year, kind: 'secondary', code, name: r.name, sourceUrl: url(year, 'ftna', `results/${code}.htm`), summary: r.summary, overall: r.overall, facts: [], candidates: r.candidates };
    });
    const { meta } = prove(sources, { exam: `ftna-${year}`, cat: 'ftna', year, kind: 'secondary' });
    assert.ok(meta.subjects.includes('CIV') && meta.subjects.includes('B/MATH'), String(year));
    assert.equal(meta.rule, 7, 'the best seven subjects add up to the aggregate, as in CSEE');
  }
});

test('the packer takes SFNA records of every year unchanged, with REFERRED as a note or as R', () => {
  for (const [year, file, code] of [[2022, 'sfna2022_ps0101114.htm', 'PS0101114'], [2023, 'sfna2023_ps0101114.htm', 'PS0101114'], [2024, 'sfna2024_ps0101114.htm', 'PS0101114'], [2025, 'sfna2025_ps0101114.htm', 'PS0101114'], [2022, 'sfna2022_ps0101001_referred.htm', 'PS0101001'], [2025, 'sfna2025_ps0101001_referred.htm', 'PS0101001']]) {
    for (const referred of ['note', 'code']) {
      const r = F.parseSfnaSchool(fixture(file), code, { referred });
      assert.equal(validateCentre(PRIM, code, r), null);
      const src = { exam: `sfna-${year}`, category: 'SFNA', year, kind: 'primary', code, name: r.name, region: 'ARUSHA', district: 'ARUSHA', sourceUrl: url(year, 'sfna', `results/${code.toLowerCase()}.htm`), summary: r.summary, overall: r.overall, facts: r.facts, candidates: r.candidates };
      const { meta } = prove([src], { exam: `sfna-${year}`, cat: 'sfna', year, kind: 'primary' });
      assert.equal(meta.subjects.at(-1), 'AVERAGE GRADE', `${file} ${referred}`);
      assert.equal(meta.subjects.length, 7);
    }
  }
});
