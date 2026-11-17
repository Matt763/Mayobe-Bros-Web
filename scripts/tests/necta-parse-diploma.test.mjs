// Offline tests of the diploma (DSEE, DPEE, DPPEE, DSPEE, DTE) and QT parsers. Nothing here touches the network.
// fixtures/diploma/: real NECTA pages trimmed to about ten candidates (the counts line is recomputed from the rows that were kept; the
// diploma pages have no candidate names, and the whole of dsee2016_502.htm is the real page). The QT fixtures are SCRUBBED: every
// name is replaced by "CANDIDATE n", only numbers, sex and remarks are the real ones.
// DIPLOMA_RAW=<folder>[:<folder>] (raw QT pages named qt*.htm / qt*.html) adds the privacy check against real names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/necta-parse.mjs';
import * as D from '../lib/necta-parse-diploma.mjs';
import { learnMeta, packCentre, verifyCentre } from '../lib/results-pack.mjs';
import { validateCentre } from '../necta-import.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'diploma');
const fixture = (f) => P.decodeBuffer(fs.readFileSync(path.join(FIX, f)));
const SEC = { kind: 'secondary' };
const KEYS = ['cno', 'sex', 'aggt', 'div', 'subjectsRaw', 'subjects'];

// ---------------------------------------------------------------- the index
const INDEXES = {
  'dsee2014_index.htm': { n: 8, href: (n) => `${n}.htm`, last: 'E0510' }, // lower-case tags, the mirror's dsee.htm
  'dsee2024_index.htm': { n: 8, href: (n) => `${n}.htm`, last: 'E0510' }, // unclosed anchors, letter bar
  'dsee2025_index.htm': { n: 8, href: (n) => `results/${n}.htm`, last: 'E0510' }, // onlinesys
  'dpee2026_index.htm': { n: 8, href: (n) => `results/${n}.htm`, last: 'E0516' }, // matokeo, well-formed
  'dspee2026_index.htm': { n: 3, href: (n) => `results/${n}.htm`, last: 'E0544' },
  'dte2019_index.htm': { n: 1, href: (n) => `${n}.htm`, last: 'E0502' },
};
for (const [f, w] of Object.entries(INDEXES)) {
  test(`diploma index ${f}: codes, names and links as published`, () => {
    const r = D.parseDiplomaIndex(fixture(f));
    assert.deepEqual(r.issues, []);
    assert.equal(r.centres.length, w.n);
    assert.deepEqual(Object.keys(r.centres[0]), ['code', 'name', 'href']);
    for (const c of r.centres) {
      assert.match(c.code, /^E0\d{3}$/);
      assert.equal(c.href, w.href(String(Number(c.code.slice(1)))), 'the link is as published');
      assert.ok(c.name && !/^\d/.test(c.name), 'the number is taken off the name');
    }
    assert.equal(r.centres.at(-1).code, w.last);
    assert.equal(r.centres[0].name.length > 5, true);
  });
}

test('diploma index: the centre code is the letter E and the link number padded to four digits', () => {
  assert.equal(D.diplomaCode('501'), 'E0501');
  assert.equal(D.diplomaCode(502), 'E0502');
  assert.equal(D.diplomaCode('E0526'), 'E0526');
  assert.equal(D.diplomaCode('1234'), 'E1234');
  const r = D.parseDiplomaIndex(fixture('dsee2024_index.htm'));
  assert.deepEqual(r.centres[0], { code: 'E0501', name: "BUTIMBA TEACHERS' COLLEGE", href: '501.htm' });
  assert.equal(r.centres[1].name, "KLERRUU TEACHERS' COLLEGE");
  assert.equal(P.parseExamIndex(fixture('dsee2024_index.htm')).centres.length, 0, 'parseExamIndex cannot read this index');
});

test('diploma index: letter links, other sites, duplicates, a wrong number and an empty name', () => {
  const r = D.parseDiplomaIndex(`<a href="index_a.htm">A</a><a href="http://x.org/501.htm">501 X</a><a href='results\\501.htm'>501  BUTIMBA   COLLEGE</a>
    <a href="501.htm">501 BUTIMBA COLLEGE</a><a href="502.htm">503 OTHER</a><a href="505.htm">505</a><a href="index.htm">ALL CENTRES</a>`);
  assert.deepEqual(r.centres, [{ code: 'E0501', name: 'BUTIMBA COLLEGE', href: 'results/501.htm' }, { code: 'E0505', name: '', href: '505.htm' }]);
  assert.deepEqual(r.issues, ['duplicate centre E0501', 'label/href mismatch: "503 OTHER" vs 502.htm', 'empty name: E0505']);
  assert.deepEqual(D.parseDiplomaIndex('<html></html>').issues, ['no centres found']);
});

// ---------------------------------------------------------------- one centre
const SHAPE = ['code', 'name', 'summary', 'overall', 'facts', 'candidates', 'issues', 'layout'];
const CENTRES = {
  'dsee2014_501.htm': { code: 'E0501', exam: 'DSEE', year: 2014, n: 9, counts: [0, 0, 8, 1, 0], sep: '/', cols: ['AGGT', 'DIV'] },
  'dsee2016_502.htm': { code: 'E0502', exam: 'DSEE', year: 2016, n: 4, counts: [0, 0, 4, 0, 0], sep: '/', cols: ['AGGT', 'DIV'] },
  'dsee2019_501.htm': { code: 'E0501', exam: 'DSEE', year: 2019, n: 10, counts: [0, 1, 6, 2, 1], sep: '/', cols: ['AGGT', 'DIV'] },
  'dsee2024_501.htm': { code: 'E0501', exam: 'DSEE', year: 2024, n: 10, counts: [0, 1, 4, 1, 1], sep: '/', cols: ['AGGT', 'DIV'] },
  'dsee2025_501.htm': { code: 'E0501', exam: 'DSEE', year: 2025, n: 8, counts: [0, 1, 3, 1, 1], sep: '/', cols: ['AGGT', 'DIV'], issues: ['special grade kept as text in row 7 (E0501/0110)'] },
  'dte2019_502.htm': { code: 'E0502', exam: 'DTE', year: 2019, n: 7, counts: [0, 1, 2, 4, 0], sep: '/', cols: ['AGGT', 'DIV'] },
  'dpee2026_506.htm': { code: 'E0506', exam: 'DPEE', year: 2026, n: 6, counts: [0, 4, 2, 0, 0], sep: '-', cols: ['GPA', 'CLASS'] },
  'dppee2026_504.htm': { code: 'E0504', exam: 'DPPEE', year: 2026, n: 6, counts: [1, 4, 1, 0, 0], sep: '-', cols: ['GPA', 'CLASS'] },
  'dspee2026_526.htm': { code: 'E0526', exam: 'DSPEE', year: 2026, n: 11, counts: [1, 5, 2, 0, 0], sep: '-', cols: ['GPA', 'CLASS'] },
};
for (const [f, w] of Object.entries(CENTRES)) {
  test(`diploma centre ${f}: heading, counts line, rows and the packer's subject form`, () => {
    const r = D.parseDiplomaCentre(fixture(f), w.code);
    assert.deepEqual(r.issues, w.issues || []);
    assert.deepEqual(Object.keys(r), SHAPE);
    assert.equal(r.code, w.code);
    assert.match(r.name, /TEACHERS' COLLEGE$/);
    assert.deepEqual(r.layout, { exam: w.exam, year: w.year, cnoSeparator: w.sep, aggtColumn: w.cols[0], divColumn: w.cols[1] });
    assert.deepEqual(r.summary.head, ['SEX', 'DISTINCTION', 'CREDITS', 'PASS', 'SUPP', 'FLD']);
    assert.deepEqual(r.summary.rows, [['T', ...w.counts.map(String)]]);
    assert.deepEqual(r.facts, []);
    assert.deepEqual(r.overall, []);
    assert.equal(r.candidates.length, w.n);
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c), KEYS);
      assert.match(c.cno, new RegExp(`^${w.code}/\\d{4}$`), 'always written with a slash');
      assert.match(c.sex, /^[MF]$/);
      assert.match(c.aggt, /^(\d\.\d|-|\*E)$/, 'the GPA as published');
      assert.match(c.div, /^(DISTINCTION|CREDIT|PASS|SUPP|FAIL|ABS|\*E|-)$/, 'the DIV word as published');
      if (c.subjects.length) {
        assert.ok(c.subjects.every(([n, g]) => n && /^[A-DFX]$/.test(g)));
        assert.equal(c.subjectsRaw, c.subjects.map(([n, g]) => `${n} - '${g}'`).join(' '), "the packer's rawOf form");
        assert.equal(new Set(c.subjects.map((s) => s[0])).size, c.subjects.length);
      }
    }
    assert.equal(validateCentre(SEC, w.code, r), null);
    assert.equal(r.candidates.filter((c) => c.subjects.length === 0).length, f === 'dsee2024_501.htm' ? 2 : f === 'dsee2025_501.htm' ? 1 : 0, 'only *E rows and the *R row are text');
  });
}

test('diploma centre: names, spellings and markers differ by year and are kept as published', () => {
  const y14 = D.parseDiplomaCentre(fixture('dsee2014_501.htm'));
  assert.deepEqual(y14.summary.rows[0].slice(0, 2), ['T', '0'], 'no semicolons in the 2014 counts line');
  assert.equal(y14.candidates[0].aggt, '3.0');
  const y19 = D.parseDiplomaCentre(fixture('dsee2019_501.htm'));
  assert.ok(y19.candidates[0].subjects.some(([n]) => n === 'DEVELOPMENT STUDIES'), 'long names in 2019');
  const y24 = D.parseDiplomaCentre(fixture('dsee2024_501.htm'));
  assert.ok(y24.candidates[0].subjects.some(([n]) => n === 'DEV. STUDIES'), 'short names in 2024');
  assert.ok(y24.candidates[0].subjects.some(([n]) => n === 'INF & COMM. TECH. (ICT)'));
  const e = y24.candidates.filter((c) => c.div === '*E');
  assert.equal(e.length, 2);
  assert.deepEqual([e[0].aggt, e[0].subjectsRaw, e[0].subjects], ['*E', '---', []]);
  const abs = y24.candidates.find((c) => c.div === 'ABS');
  assert.equal(abs.aggt, '-');
  assert.ok(abs.subjects.length > 3 && abs.subjects.every(([, g]) => g === 'X'), 'an absentee has every grade X');
  const fail = y24.candidates.find((c) => c.div === 'FAIL');
  assert.equal(fail.aggt, '-', 'a failed candidate has no GPA');
  const y16 = D.parseDiplomaCentre(fixture('dsee2016_502.htm'), '502');
  assert.equal(y16.candidates[0].aggt, '-', 'PASS with no GPA (supplementary candidates)');
  assert.equal(y16.code, 'E0502', 'the bare number is accepted as expectCode');
  const y25 = D.parseDiplomaCentre(fixture('dsee2025_501.htm'), 'E0501');
  const star = y25.candidates.find((c) => /\*R/.test(c.subjectsRaw));
  assert.deepEqual([star.aggt, star.div, star.subjects], ['-', '-', []], "a ' *R ' grade keeps the row as text");
  assert.match(star.subjectsRaw, /CHEMISTRY - ' \*R ' BIOLOGY - ' \*R '/);
  assert.deepEqual(y25.issues, ['special grade kept as text in row 7 (E0501/0110)'], 'one note, for the *R row; the counts line agrees with the rows');
  const dp = D.parseDiplomaCentre(fixture('dspee2026_526.htm'));
  assert.ok(dp.candidates.some((c) => c.div === 'ABS' && c.subjects.every(([, g]) => g === 'X')));
  assert.ok(dp.candidates.some((c) => c.subjects[0]?.[0] === 'UALIMU') && dp.candidates.some((c) => c.subjects[0]?.[0] === 'EDUCATION'), 'Swahili and English sets');
});

test('diploma centre: keepSeparator keeps the published hyphen; sortSubjects puts every row in one order', () => {
  const html = fixture('dpee2026_506.htm');
  assert.match(D.parseDiplomaCentre(html, 'E0506', { keepSeparator: true }).candidates[0].cno, /^E0506-0001$/);
  assert.match(D.parseDiplomaCentre(html, 'E0506').candidates[0].cno, /^E0506\/0001$/);
  const orderOf = (r, a, b) => r.candidates.map((c) => c.subjects.map((s) => s[0])).filter((n) => n.includes(a) && n.includes(b)).map((n) => n.indexOf(a) < n.indexOf(b));
  const A = 'MBINU ZA UFUNDISHAJI KWA WANAFUNZI WENYE ULEMAVU WA AKILI';
  const B = 'MBINU ZA UFUNDISHAJI WA KISWAHILI';
  const html2 = fixture('dspee2026_526.htm');
  const pub = orderOf(D.parseDiplomaCentre(html2), A, B);
  assert.ok(pub.includes(true) && pub.includes(false), 'the fixture holds both orders, as the real page does');
  const sorted = D.parseDiplomaCentre(html2, undefined, { sortSubjects: true });
  assert.equal(new Set(orderOf(sorted, A, B)).size, 1);
  for (const c of sorted.candidates.filter((x) => x.subjects.length)) {
    const names = c.subjects.map((s) => s[0]);
    assert.deepEqual(names, [...names].sort());
    assert.equal(c.subjectsRaw, c.subjects.map(([n, g]) => `${n} - '${g}'`).join(' '));
  }
  assert.deepEqual(sorted.issues, []);
});

test('diploma centre: the counts line is checked against the rows, and every other problem is reported, never thrown', () => {
  const html = fixture('dsee2024_501.htm');
  assert.deepEqual(D.parseDiplomaCentre(html, 'E0502').issues, ['heading code E0501 != E0502']);
  assert.deepEqual(D.parseDiplomaCentre(html, 'e0501').issues, []);
  assert.deepEqual(D.parseDiplomaCentre(html.replace(/PASS = \d+/, 'PASS = 99'), 'E0501').issues, ['count PASS = 99 but 4 rows']);
  assert.deepEqual(D.parseDiplomaCentre(html.replace(/FLD = \d+/, 'FLD = 0'), 'E0501').issues, ['count FLD = 0 but 1 rows']);
  const bad = html.replace('E0501/0001', 'E0502/0001');
  assert.deepEqual(D.parseDiplomaCentre(bad, 'E0501').issues, ['candidate number E0502/0001 is not under E0501']);
  assert.ok(validateCentre(SEC, 'E0501', D.parseDiplomaCentre(bad, 'E0501')).includes('does not start with E0501/'));
  assert.ok(D.parseDiplomaCentre(html.replace('DETAILED SUBJECTS', 'THINGS'), 'E0501').issues.includes('unknown candidate columns'));
  const dup = D.parseDiplomaCentre(html.replace('E0501/0002', 'E0501/0001'), 'E0501');
  assert.ok(dup.issues.includes('duplicate candidate E0501/0001'));
  assert.ok(validateCentre(SEC, 'E0501', dup).includes('duplicate'));
  const junk = D.parseDiplomaCentre(html.replace("COMM SKILLS - 'C'", 'COMM SKILLS ??'), 'E0501');
  assert.ok(junk.issues.some((i) => /^subjects not read in row \d+ \(E0501\/\d{4}\)$/.test(i)));
  assert.ok(junk.candidates.some((c) => c.subjects.length === 0 && /\?\?/.test(c.subjectsRaw)), 'the cell stays as text');
  const twice = D.parseDiplomaCentre(html.replace("COMM SKILLS - 'C'", "BTP - 'C' COMM SKILLS - 'C'"), 'E0501');
  assert.ok(twice.issues.some((i) => /^subjects not read in row/.test(i)), 'a repeated subject name is kept as text');
  const sex = D.parseDiplomaCentre(html.replace(/(E0501\/0001[\s\S]*?<P[^>]*>)F</, '$1Z<'), 'E0501');
  assert.ok(sex.issues.includes('unknown sex in row 1 (E0501/0001)'));
  assert.equal(sex.candidates[0].sex, '');
  const gpa = D.parseDiplomaCentre(html.replace(' 3.0<', ' 3,0<'), 'E0501');
  assert.ok(gpa.issues.includes('unknown aggregate in row 1 (E0501/0001)'));
  // a page cut in the middle of a row (the real samples are cut like this) loses only that row
  const cut = html.slice(0, html.indexOf('E0501/0078') + 40);
  const r = D.parseDiplomaCentre(cut, 'E0501');
  assert.equal(r.candidates.length, 7);
  assert.ok(r.issues.includes('skipped row 8 (E0501/0078)'));
  const none = D.parseDiplomaCentre('<html></html>');
  assert.deepEqual(none.issues, ['no centre heading', 'no candidates found']);
  assert.equal(none.code, null);
});

test('diploma centre: a name or PREM column is never read, and a table after the candidates that holds them is dropped', () => {
  const page = (cols, rowsOf, extra = '') => `<html><body><H1> DSEE 2024 EXAMINATION RESULTS</H1><H3>501 A COLLEGE<H3>PASS = 1; </H3></H3>
<table>${`<tr>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>`}${rowsOf.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>${extra}</body></html>`;
  const html = page(['CNO', 'CANDIDATE NAME', 'PREM NO', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'],
    [['E0501/0001', 'JOHN QWERTY DOE', '20181234567', 'M', '3.0', 'PASS', "BTP - 'B'"]],
    '<table><tr><td>CANDIDATE NAME</td><td>X</td></tr><tr><td>JOHN DOE</td><td>1</td></tr></table>');
  const r = D.parseDiplomaCentre(html, 'E0501');
  assert.deepEqual(r.issues, ['skipped a table after the candidates']);
  assert.equal(r.candidates.length, 1);
  const out = JSON.stringify(r);
  for (const bad of ['JOHN', 'DOE', 'QWERTY', '20181234567']) assert.ok(!out.includes(bad), bad);
  // an issue note never carries another cell of the row (here the PREM is where the number should be)
  const swapped = D.parseDiplomaCentre(page(['CNO', 'PREM NO', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'], [['20181234567', 'E0501/0001', 'M', '3.0', 'PASS', "BTP - 'B'"]]), 'E0501');
  assert.ok(swapped.issues.includes('skipped row 1'));
  assert.ok(!JSON.stringify(swapped).includes('20181234567'));
});

test('diploma centre: a 600 KB page with 3,000 rows is read quickly', () => {
  const row = (i) => `<TR><TD>E0501/${String(i).padStart(4, '0')}</TD><TD>M</TD><TD> 3.0</TD><TD>PASS</TD><TD>DEV. STUDIES - 'C'   COMM SKILLS - 'C'   BTP - 'B'   FOUNDATIONS OF EDUCATION - 'C'   CURRICULUM AND TEACHING - 'C'</TD></TR>\n`;
  let html = `<HTML><BODY><H1> DSEE 2024 EXAMINATION RESULTS</H1><H3>501 A COLLEGE\n<H3>PASS = 3000;  </H3>\n<TABLE><TR><TD>CNO</TD><TD>SEX</TD><TD>AGGT</TD><TD>DIV</TD><TD>DETAILED SUBJECTS</TD></TR>\n`;
  for (let i = 1; i <= 3000; i++) html += row(i);
  html += '</BODY>';
  const t = Date.now();
  const r = D.parseDiplomaCentre(html, 'E0501');
  assert.equal(r.candidates.length, 3000);
  assert.deepEqual(r.issues, []);
  assert.ok(Date.now() - t < 3000);
});

// ---------------------------------------------------------------- the packer
const srcOf = (r, cat, year, tenths = false) => ({
  exam: `${cat}-${year}`, category: cat.toUpperCase(), year, kind: 'secondary', code: r.code, name: r.name,
  sourceUrl: `https://onlinesys.necta.go.tz/results/${year}/${cat}/results/${r.code.slice(2)}.htm`, summary: r.summary, overall: r.overall, facts: r.facts,
  candidates: tenths ? r.candidates.map((c) => ({ ...c, aggt: /^\d\.\d$/.test(c.aggt) ? String(Math.round(parseFloat(c.aggt) * 10)) : c.aggt })) : r.candidates,
});
const PACK = [['dsee2014_501.htm', 'dsee', 2014], ['dsee2016_502.htm', 'dsee', 2016], ['dsee2019_501.htm', 'dsee', 2019], ['dsee2024_501.htm', 'dsee', 2024], ['dsee2025_501.htm', 'dsee', 2025],
  ['dte2019_502.htm', 'dte', 2019], ['dpee2026_506.htm', 'dpee', 2026], ['dppee2026_504.htm', 'dppee', 2026], ['dspee2026_526.htm', 'dspee', 2026]];
const infoOf = (cat, year) => ({ exam: `${cat}-${year}`, cat, year, kind: 'secondary', verified: '2026-11-10' });

test("the packer today: what it takes from a diploma record and the one thing it cannot (a GPA like 2.9 as the aggregate)", () => {
  for (const [f, cat, year] of PACK) {
    const rec = D.parseDiplomaCentre(fixture(f));
    // as published order, GPA as published
    const src = srcOf(rec, cat, year);
    let meta;
    try { meta = learnMeta(infoOf(cat, year), (fn) => fn(src)); } catch (e) {
      assert.match(e.message, /conflicting orders/, `${f}: only DSPEE's free order may stop learnMeta`);
      assert.equal(cat, 'dspee');
      meta = null;
    }
    if (meta) {
      assert.ok(meta.subjects.length >= 1);
      let outcome;
      try { const p = packCentre(src, meta); outcome = verifyCentre(src, p.text, meta); } catch (e) { outcome = e.message; }
      if (typeof outcome === 'string') assert.match(outcome, /^E0\d{3}\/\d{4}: aggregate "\d\.\d"$/, f);
      else assert.deepEqual(outcome, [], f);
    }
    // what-if: the GPA stored in tenths ("2.9" -> "29"), subjects in one order: everything else is accepted and decodes back identical
    const rec2 = D.parseDiplomaCentre(fixture(f), undefined, { sortSubjects: cat === 'dspee' });
    const s2 = srcOf(rec2, cat, year, true);
    const meta2 = learnMeta(infoOf(cat, year), (fn) => fn(s2));
    const p2 = packCentre(s2, meta2);
    assert.deepEqual(verifyCentre(s2, p2.text, meta2), [], `${f} (GPA in tenths)`);
  }
});

test('QT records are accepted by the packer as they are (every row is a marker row: number, sex, remark)', () => {
  const page = D.parseQtPage(fixture('qt2023_scrubbed.htm'));
  const srcs = page.centres.map((c) => ({ exam: 'qt-2023', category: 'QT', year: 2023, kind: 'secondary', code: c.code, name: c.name, sourceUrl: `https://maktaba.tetea.org/exam-results/QT2023/qt2023.htm#${c.code.toLowerCase()}`, summary: c.summary, overall: c.overall, facts: c.facts, candidates: c.candidates }));
  for (const c of page.centres) assert.equal(validateCentre(SEC, c.code, { ...c, issues: c.issues }), null, c.code);
  const meta = learnMeta({ exam: 'qt-2023', cat: 'qt', year: 2023, kind: 'secondary', verified: '2026-11-10' }, (fn) => srcs.forEach(fn));
  assert.deepEqual(meta.subjects, []);
  for (const s of srcs) {
    const p = packCentre(s, meta);
    assert.deepEqual(verifyCentre(s, p.text, meta), [], s.code);
  }
});

// ---------------------------------------------------------------- QT
test('QT 2023 (xmp): centres, counts line, remarks, a centre on two pages, a number of another centre, *W with its reason', () => {
  const r = D.parseQtPage(fixture('qt2023_scrubbed.htm'));
  assert.equal(r.year, 2023);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.centres.map((c) => c.code), ['M0104', 'M0333', 'M0110'], 'the two pages of M0333 are one centre');
  const [a, b, c] = r.centres;
  assert.deepEqual(Object.keys(a), ['code', 'name', 'summary', 'overall', 'facts', 'candidates', 'foreign', 'issues']);
  assert.equal(a.name, 'BWIRU BOYS SECONDARY SCHOOL CENTRE');
  assert.deepEqual(a.summary, { head: ['SEX', 'PASSED', 'FAILED'], rows: [['T', '3', '7']] });
  assert.deepEqual(a.issues, []);
  assert.equal(a.candidates.length, 10);
  assert.deepEqual(a.candidates[0], { cno: 'M0104/0001', sex: 'F', aggt: '-', div: 'PASSED', subjectsRaw: '', subjects: [] });
  for (const x of r.centres.flatMap((k) => k.candidates)) {
    assert.deepEqual(Object.keys(x), KEYS);
    assert.match(x.cno, /^M\d{4}\/\d{4}$/);
    assert.match(x.sex, /^[MF]$/);
    assert.match(x.div, /^(PASSED|FAILED|ABSENT|\*W)$/);
    assert.equal(x.aggt, '-');
  }
  // M0333: two pages, 10 + 5 rows, the repeated counts agree, M0823-0001 is another centre's number
  assert.equal(b.candidates.length, 15);
  assert.deepEqual(b.summary.rows, [['T', '9', '3']]);
  assert.deepEqual(b.foreign, [{ cno: 'M0823/0001', sex: 'M', div: 'ABSENT' }]);
  assert.deepEqual(b.issues, ['candidate number M0823/0001 is listed under M0333 and kept apart']);
  assert.ok(!b.candidates.some((x) => x.cno.startsWith('M0823')));
  const w = b.candidates.find((x) => x.div === '*W');
  assert.deepEqual(w, { cno: 'M0333/0010', sex: 'F', aggt: '-', div: '*W', subjectsRaw: 'Results Nullified, Irregularities', subjects: [] });
  assert.equal(b.candidates.at(-1).cno, 'M0333/0063');
  assert.equal(c.candidates.filter((x) => x.div === 'ABSENT').length, 4, 'ABSENT rows are kept (the page does not count them)');
  assert.deepEqual(c.issues, []);
  // the packer-side check of the old rule: nothing but validateCentre-clean records
  for (const k of r.centres) assert.equal(validateCentre(SEC, k.code, { ...k }), null);
});

test('QT 2016 (PRE, plain *W) and the centre name without the word CENTRE', () => {
  const r = D.parseQtPage(fixture('qt2016_scrubbed.htm'));
  assert.equal(r.year, 2016);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.centres.map((c) => [c.code, c.name, c.candidates.length]), [['M0537', "ST.PAUL'S SECONDARY SCHOOL CENTRE", 12], ['M0254', 'WAL UL ASR GIRLS SEC CENTRE', 6]]);
  const w = r.centres[0].candidates.filter((x) => x.div === '*W');
  assert.ok(w.length >= 8);
  assert.ok(w.every((x) => x.subjectsRaw === ''));
  assert.deepEqual(r.centres[0].summary.rows, [['T', '0', '1']]);
  assert.deepEqual(r.centres.flatMap((c) => c.issues), []);
});

test('QT: counts that do not match, a missing remark, odd lines, a repeated centre and a repeated number are reported without any row text', () => {
  const html = fixture('qt2023_scrubbed.htm');
  const wrong = D.parseQtPage(html.replace('PASSED =    3', 'PASSED =    4'));
  assert.deepEqual(wrong.centres[0].issues, ['count PASSED = 4 but 3 rows']);
  const later = D.parseQtPage(html.replace(/(M0333[\s\S]*?M0333[\s\S]*?FAILED =\s*)3/, '$14'));
  assert.ok(later.centres[1].issues.includes('the counts on a later page of M0333 differ'));
  const norem = D.parseQtPage(html.replace('  0001  F  CANDIDATE 1                   PASSED  ', '  0001  F  CANDIDATE 1                           '));
  assert.ok(norem.centres[0].issues.includes('no remark in M0104/0001'));
  assert.equal(norem.centres[0].candidates[0].div, '-');
  const odd = D.parseQtPage(html.replace('  0002  F  CANDIDATE 2', '  A STRAY LINE WITH WORDS\r\n  0002  F  CANDIDATE 2'));
  assert.ok(odd.centres[0].issues.some((i) => /^unrecognised line \d+$/.test(i)));
  assert.ok(!JSON.stringify(odd).includes('STRAY'));
  const dup = D.parseQtPage(html.replace('  0003  F  CANDIDATE 3', '  0001  F  CANDIDATE 3'));
  assert.ok(dup.centres[0].issues.includes('duplicate candidate M0104/0001'));
  assert.ok(validateCentre(SEC, 'M0104', dup.centres[0]).includes('duplicate'));
  const m0333 = html.indexOf('M0333');
  const page2 = html.slice(html.lastIndexOf('\f', m0333) - 2, html.indexOf('\f', m0333 + 2000) > 0 ? html.indexOf('\f', m0333 + 2000) - 2 : undefined);
  const again = D.parseQtPage(html.replace(/(<\/xmp>[\s\S]*)$/, '') + page2.replace(/M0333/g, 'M0104') + '</xmp>');
  assert.ok(again.centres[0].issues.some((i) => /^centre M0104 appears again after another centre$/.test(i)), again.centres.map((c) => c.issues).join('|'));
  assert.deepEqual(D.parseQtPage('<html>nothing</html>'), { year: null, centres: [], issues: ['no centres found'] });
  // a page cut in the middle of a row (the big pages are fetched in parts) is reported, not thrown
  const cut = D.parseQtPage(html.slice(0, html.indexOf('0004  F') + 12));
  assert.equal(cut.centres[0].candidates.length, 4);
  assert.ok(cut.centres[0].issues.includes('no remark in M0104/0004'));
});

test('QT privacy: a name is dropped at parse time and appears nowhere in the output, not even in an issue', () => {
  const rowsTxt = [
    ['0001', 'F', 'ZEBEDAYO QWERTYUIOP MKONGWE', 'PASSED'],
    ['0002', 'M', 'ASHA ASDFGHJKL', 'FAILED'],
    ['0003', 'M', 'PASSED MAMBO WA', 'ABSENT'], // a name that is also a word on the page
    ['0004', 'F', 'LONGNAMEWITHOUTREMARK QWERTY', ''],
    ['0005', 'F', 'JOHN-PAUL O\'NEIL', '*W Results Nullified, Irregularities'],
  ];
  const page = `<xmp>\r\n  \fJanuary 22, 2024     NATIONAL EXAMINATIONS COUNCIL OF TANZANIA             Page : 1\r\n            QT 2023 RESULTS FOR : M0104 - BWIRU BOYS SECONDARY SCHOOL CENTRE    \r\n           RESULTS SUMMARY\r\n           PASSED =    2\r\n           FAILED =    1\r\n           -------------\r\n   CNO           NAMES OF CANDIDATES         REMARKS \r\n  \r\n`
    + rowsTxt.map(([n, s, name, rem]) => `  ${n}  ${s}  ${name.padEnd(36)}${rem}  \r\n`).join('') + '  UNEXPECTED NAME CONTINUATION\r\n</xmp>';
  const r = D.parseQtPage(page);
  const out = JSON.stringify(r);
  for (const bad of ['ZEBEDAYO', 'QWERTYUIOP', 'MKONGWE', 'ASDFGHJKL', 'MAMBO', 'LONGNAME', 'NEIL', 'JOHN-PAUL', 'CONTINUATION', 'UNEXPECTED']) assert.ok(!out.includes(bad), bad);
  assert.equal(r.centres[0].candidates.length, 5);
  assert.deepEqual(r.centres[0].candidates.map((c) => c.div), ['PASSED', 'FAILED', 'ABSENT', '-', '*W']);
  assert.equal(r.centres[0].candidates[4].subjectsRaw, 'Results Nullified, Irregularities');
  assert.ok(r.centres[0].issues.includes('no remark in M0104/0004'));
  assert.ok(r.centres[0].issues.some((i) => /^unrecognised line \d+$/.test(i)));
});

const ISSUE_OK = [/^candidate number M\d{4}\/\d{4} is listed under M\d{4} and kept apart$/, /^no remark in M\d{4}\/\d{4}$/, /^count (PASSED|FAILED) = \d+ but \d+ rows$/, /^unrecognised line \d+$/, /^more unrecognised lines$/,
  /^the counts on a later page of M\d{4} differ$/, /^centre M\d{4} appears again after another centre$/, /^duplicate candidate M\d{4}\/\d{4}$/, /^no counts found$/, /^no candidates found$/];
const REMARK_NOTES = new Set(['', 'Results Nullified, Irregularities']);

test('raw QT pages in DIPLOMA_RAW (if any): not one candidate name, and nothing but numbers, sex and remarks per row', () => {
  const dirs = (process.env.DIPLOMA_RAW || '').split(':').filter((d) => d && fs.existsSync(d));
  if (!dirs.length) return;
  let files = 0;
  let names = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((x) => /^qt.*\.html?$/i.test(x))) {
      const html = P.decodeBuffer(fs.readFileSync(path.join(dir, f)));
      const r = D.parseQtPage(html);
      const out = JSON.stringify(r);
      // names read independently of the parser: the text between the sex and the remark
      const nameRe = /^\s*(?:[A-Z]\d{4}-)?\d{4,5}\s+[MF]\s+(.*?)\s+(?:PASSED|FAILED|ABSENT|\*[A-Z]\b.*?)\s*$/gm;
      const vocab = new Set();
      for (const m of html.matchAll(/RESULTS\s+FOR\s*:.*$/gm)) for (const w of m[0].match(/[A-Z][A-Z'.-]*/g) || []) vocab.add(w);
      const outWords = new Set(out.match(/[A-Z][A-Z'.-]{4,}/g) || []);
      let leaked = 0;
      for (const m of html.matchAll(nameRe)) {
        names++;
        for (const t of m[1].match(/[A-Z][A-Z'-]{4,}/g) || []) if (!vocab.has(t) && outWords.has(t)) leaked++;
      }
      assert.equal(leaked, 0, `${f}: name words in the output`);
      // the shape of everything that is returned
      for (const c of r.centres) {
        assert.match(c.code, /^M\d{4}$/);
        for (const x of c.candidates) {
          assert.deepEqual(Object.keys(x), KEYS);
          assert.match(x.cno, /^M\d{4}\/\d{4}$/);
          assert.match(x.sex, /^[MF]$/);
          assert.match(x.div, /^(PASSED|FAILED|ABSENT|\*W|-)$/);
          assert.ok(REMARK_NOTES.has(x.subjectsRaw), `${f}: ${x.cno}`);
        }
        for (const i of c.issues) assert.ok(ISSUE_OK.some((re) => re.test(i)), `${f}: ${i}`);
      }
      for (const i of r.issues) assert.ok(ISSUE_OK.some((re) => re.test(i)) || i === 'no centres found', i);
      // every row of the page is accounted for
      const rowLines = (html.match(/^\s*(?:[A-Z]\d{4}-)?\d{1,5}\s+[MF](?:\s|$)/gm) || []).length;
      const got = r.centres.reduce((a, c) => a + c.candidates.length + c.foreign.length, 0);
      const dups = r.centres.reduce((a, c) => a + c.issues.filter((i) => i.startsWith('duplicate')).length, 0);
      assert.equal(got + dups, rowLines, `${f}: rows read`);
      files++;
    }
  }
  assert.ok(files > 0);
  assert.ok(names > 100, 'the real names were found, so this test can fail');
});
