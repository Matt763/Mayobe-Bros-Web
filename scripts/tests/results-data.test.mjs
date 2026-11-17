import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { learnMeta, packCentre, packList, finishMeta, metaKey, verifyCentre, verifyList, rawOf, CODEC_VERSION } from '../lib/results-pack.mjs';
import { decodeCentre, decodeHeader, decodeList, stats } from '../../js/results-codec.js';
import * as codec from '../../js/results-codec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = '/run/media/mclean/New Volume/MY WEBSITE PROJECTS/Mayobe Results Website';
const CACHE = path.join(os.homedir(), '.cache', 'mayobe-results-tests');

const cand = (cno, sex, aggt, div, subs) => ({
  cno, sex, aggt, div, subjects: subs, subjectsRaw: subs.map(([n, g]) => `${n} - '${g}'`).join(' '),
});
const secondary = () => ({
  exam: 'csee-2024', category: 'CSEE', year: 2024, kind: 'secondary', code: 'S0001', name: "MARY'S GIRLS SECONDARY SCHOOL",
  indexName: "MARY'S GIRLS", region: '', district: '', sourceUrl: 'https://onlinesys.necta.go.tz/results/2024/csee/results/s0001.htm',
  summary: { head: ['SEX', 'I', 'II'], rows: [['F', '1', '0'], ['T', '1', '0']] },
  overall: [
    { t: 'h', v: 'OVERALL' },
    { t: 'kv', rows: [['CANDIDATES', '3']] },
    { t: 'grid', head: ['NO', 'SUBJECT'], rows: [['1', 'PHY'], ['2', "B/KNOW'L"]] },
  ],
  facts: [['KEY', 'VALUE']], issues: [],
  candidates: [
    cand('S0001/0001', 'F', '17', 'I', [['PHY', 'A'], ['E/D/KIISLAMU', 'B'], ['LIT ENG', 'C']]),
    cand('S0001/0002', 'M', '-', '-', [['PHY', 'X']]),
    { cno: 'S0001/0003', sex: 'M', aggt: '*W', div: '*W', subjects: [], subjectsRaw: 'Results Withheld | for now' },
    { cno: 'S0001/0004', sex: 'F', aggt: '*R', div: '*R', subjects: [], subjectsRaw: '---' },
    cand('S0001/0005', 'F', '-', 'ABS', [['LIT ENG', 'I']]),
  ],
});
const SUBJ = ['Kiswahili', 'English', 'Maarifa', 'Hisabati', 'Science', 'Uraia', 'Average Grade'];
const prim = () => ({
  exam: 'psle-2023', category: 'PSLE', year: 2023, kind: 'primary', code: 'PS0101001', name: "ST. JOHN'S PRIMARY SCHOOL",
  indexName: "ST. JOHN'S PRIMARY SCHOOL", region: 'ARUSHA', district: 'ARUSHA', sourceUrl: 'https://onlinesys.necta.go.tz/results/2023/psle/results/shl_ps0101001.htm',
  summary: null, overall: [{ t: 'h', v: 'UFAULU' }, { t: 'grid', head: ['A'], rows: [['1']] }], facts: [], issues: [],
  candidates: [
    { cno: 'PS0101001-0001', prem: '20170391456', sex: 'M', subjects: SUBJ.map((n, i) => [n, 'BCADAXB'[i]]), subjectsRaw: SUBJ.map((n, i) => `${n} - ${'BCADAXB'[i]}`).join(', ') },
    { cno: 'PS0101001-0002', prem: '20170391457', sex: 'F', subjectsRaw: '*R', subjects: [] },
  ],
});

/** Learn, pack, prove and decode a set of sources the way scripts/results-data.mjs does. */
function build(sources, extra = {}) {
  const first = sources[0];
  const info = { exam: first.exam, cat: first.category.toLowerCase(), year: first.year, kind: first.kind, verified: '2026-11-09' };
  const meta = learnMeta(info, (fn) => { for (const s of sources) fn(s); });
  const files = sources.map((s) => ({ src: s, ...packCentre(s, meta) }));
  return { meta, files, one: files[0], decode: (i = 0) => decodeCentre(files[i].text, meta, sources[i].code.toUpperCase()), ...extra };
}
const proven = (b) => b.files.flatMap((f) => verifyCentre(f.src, f.text, b.meta));

test('the data version is 3 and a centre file has ten lines', () => {
  assert.equal(CODEC_VERSION, 3);
  assert.equal(codec.CODEC_VERSION, 3);
  const b = build([secondary()]);
  assert.equal(b.one.text.split('\n').length, 10);
  assert.equal(b.meta.v, 3);
});

test('secondary centre round-trips with markers, dash division, ABS, apostrophes, summary, overall and facts', () => {
  const src = secondary();
  const b = build([src]);
  assert.deepEqual(proven(b), []);
  const dec = b.decode();
  assert.equal(dec.name, "MARY'S GIRLS SECONDARY SCHOOL");
  assert.equal(dec.sourceUrl, src.sourceUrl);
  assert.equal(dec.candidates[0].cno, 'S0001/0001');
  assert.deepEqual(dec.candidates[0].subjects, [['PHY', 'A'], ['E/D/KIISLAMU', 'B'], ['LIT ENG', 'C']]);
  assert.equal(dec.candidates[0].aggt, '17');
  assert.equal(dec.candidates[1].div, '-');
  assert.equal(dec.candidates[1].aggt, '-');
  assert.equal(dec.candidates[2].note, 'Results Withheld | for now');
  assert.deepEqual(dec.candidates[2].subjects, []);
  assert.equal(dec.candidates[2].aggt, '*W');
  assert.equal(dec.candidates[3].div, '*R');
  assert.equal(dec.candidates[4].div, 'ABS');
  assert.ok(!('note' in dec.candidates[0]));
  assert.ok(!('grade' in dec.candidates[0]));
  assert.equal(dec.candidates[4].subjects[0][1], 'I');
  assert.deepEqual(dec.overall, src.overall);
  assert.deepEqual(dec.facts, src.facts);
  assert.deepEqual(dec.summary, src.summary);
  assert.deepEqual([b.one.stats.sMode, b.one.stats.oMode], ['j', 'j'], 'blocks the rows cannot predict are stored whole');
  assert.deepEqual(Object.keys(dec).sort(), ['candidates', 'code', 'facts', 'name', 'overall', 'sourceUrl', 'summary']);
});

test('missing summary, empty overall and facts, and an empty subject list', () => {
  const src = secondary();
  src.summary = null; src.overall = []; src.facts = [];
  src.candidates.push({ cno: 'S0001/0006', sex: 'F', aggt: '-', div: '0', subjects: [], subjectsRaw: '' });
  const b = build([src]);
  assert.deepEqual(proven(b), []);
  const dec = b.decode();
  assert.equal(dec.summary, null);
  assert.deepEqual(dec.overall, []);
  assert.deepEqual(dec.facts, []);
  assert.equal(dec.candidates[5].note, '');
  assert.deepEqual(dec.candidates[5].subjects, []);
  assert.equal(b.one.text.split('\n')[9], '');
});

test('names with semicolons, line-free text, tabs in notes, and a code that is not in capitals', () => {
  const src = secondary();
  src.name = 'HANDENI ISLAMIC SECONDARY SCHOOL DIV-I = 0; DIV-II = 0';
  src.sourceUrl = 'https://example.test/odd;file.htm';
  src.candidates[2].subjectsRaw = 'a\tb\tc';
  assert.deepEqual(proven(build([src])), []);
  const lower = secondary();
  lower.code = 's5405';
  lower.sourceUrl = lower.sourceUrl.replace('s0001', 's5405');
  lower.candidates.forEach((c) => { c.cno = c.cno.replace('S0001', 's5405'); });
  const b = build([lower]);
  assert.deepEqual(proven(b), []);
  assert.equal(b.decode().candidates[0].cno, 's5405/0001');
  assert.equal(decodeCentre(b.one.text, b.meta, 'S5405').code, 's5405', 'the header keeps the code as the source wrote it');
  const bad = secondary();
  bad.name = 'two\nlines';
  assert.throws(() => build([bad]), /line break/);
});

test('sequence numbers: 1..N without a gap cost nothing, gaps and odd numbers are kept', () => {
  const a = secondary();
  const b = build([a]);
  assert.equal(b.one.text.split('\n')[0].split(';')[0], '', 'no sequence text when it runs 1..N');
  const gap = secondary();
  gap.candidates[2].cno = 'S0001/0007';
  gap.candidates[3].cno = 'S0001/0008';
  gap.candidates[4].cno = 'S0001/0100';
  const g = build([gap]);
  assert.match(g.one.text.split(';')[0], /^r1-2,7-8,100$/);
  assert.deepEqual(proven(g), []);
  const odd = secondary();
  odd.candidates[1].cno = 'S0001/0002A';
  odd.candidates[4].cno = 'S0001/5';
  const o = build([odd]);
  assert.match(o.one.text.split(';')[0], /^l/);
  assert.deepEqual(proven(o), []);
  assert.deepEqual(o.decode().candidates.map((c) => c.cno), odd.candidates.map((c) => c.cno));
});

test('primary centre: grades, Average Grade, marker rows, no prem, dictionary codes', () => {
  const src = prim();
  const b = build([src]);
  assert.deepEqual(proven(b), []);
  assert.ok(!b.one.text.includes('20170391'));
  assert.ok(!JSON.stringify(b.meta).includes('20170391'));
  const dec = b.decode();
  assert.equal(dec.candidates[0].cno, 'PS0101001-0001');
  assert.equal(dec.candidates[0].grade, 'B');
  assert.equal(dec.candidates[0].subjects.length, 7);
  assert.equal(dec.candidates[0].subjects[6][0], 'Average Grade');
  assert.ok(!('div' in dec.candidates[0]));
  assert.equal(dec.candidates[1].note, '*R');
  assert.ok(!('grade' in dec.candidates[1]));
  assert.deepEqual(dec.overall, src.overall);
  assert.equal(b.meta.pd, 'BCADAXB');
  // a school with six subjects (some years have no Uraia) and a three-digit sequence
  const six = prim();
  six.candidates.forEach((c) => { c.cno = c.cno.replace(/-00/, '-0'); if (c.subjects.length) { c.subjects.splice(5, 1); c.subjectsRaw = rawOf(c.subjects, 'primary'); } });
  const s = build([six]);
  assert.equal(s.meta.sw, 3);
  assert.deepEqual(proven(s), []);
  assert.equal(s.decode().candidates[0].subjects.length, 6);
});

test('primary: a school that takes only part of the exam subject list (no TEHAMA) packs, proves and decodes with its own subjects', () => {
  const withIct = prim();
  withIct.candidates.forEach((c) => {
    if (!c.subjects.length) return;
    c.subjects.splice(6, 0, ['TEHAMA', 'C']);
    c.subjectsRaw = rawOf(c.subjects, 'primary');
  });
  const plain = prim();
  plain.code = 'PS0101002';
  plain.name = 'NO ICT PRIMARY SCHOOL';
  plain.sourceUrl = plain.sourceUrl.replace('0101001', '0101002');
  plain.candidates.forEach((c) => { c.cno = c.cno.replace('PS0101001', 'PS0101002'); });
  const b = build([withIct, plain]);
  assert.equal(b.meta.subjects.length, 8, 'the exam list is the fullest school list');
  assert.equal(b.meta.subjects[6], 'TEHAMA');
  assert.deepEqual(proven(b), [], 'both schools come back exactly as they were read');
  const a = b.decode(0);
  const c2 = b.decode(1);
  assert.equal(a.candidates[0].subjects.length, 8);
  assert.equal(c2.candidates[0].subjects.length, 7, 'no placeholder for a subject the school does not take');
  assert.ok(c2.candidates[0].subjects.every((x) => x[0] !== 'TEHAMA' && x[1] !== '.'));
  assert.equal(c2.candidates[0].grade, 'B');
  assert.ok(!b.files[1].text.split('\n')[4].includes('.'), 'the placeholder stays inside the dictionary');
  // a school whose list is NOT part of the fullest one is still refused
  const other = prim();
  other.candidates[0].subjects[1][0] = 'Other';
  other.candidates[0].subjectsRaw = rawOf(other.candidates[0].subjects, 'primary');
  assert.throws(() => build([withIct, other]), /fixed list/);
  // the order must agree and Average Grade must stay last
  const swapped = prim();
  swapped.candidates[0].subjects.reverse();
  swapped.candidates[0].subjectsRaw = rawOf(swapped.candidates[0].subjects, 'primary');
  assert.throws(() => build([withIct, swapped]), /fixed list/);
});

test('primary: a very large grade dictionary (three-character codes, 24,200 patterns) round-trips', () => {
  const src = prim();
  const L = 'ABCDE';
  src.candidates = Array.from({ length: 24200 }, (_, k) => {
    const g = Array.from({ length: 7 }, (_, j) => L[Math.floor(k / 5 ** j) % 5]);
    const subjects = SUBJ.map((n, i) => [n, g[i]]);
    return { cno: `PS0101001-${String(k + 1).padStart(5, '0')}`, sex: k % 2 ? 'M' : 'F', subjects, subjectsRaw: rawOf(subjects, 'primary') };
  });
  const b = build([src]);
  assert.ok(b.meta.pd.length / 7 >= 24200);
  assert.deepEqual(proven(b), []);
  const d = b.decode();
  assert.equal(d.candidates.length, 24200);
  assert.equal(d.candidates[24199].subjects.map((x) => x[1]).join(''), src.candidates[24199].subjects.map((x) => x[1]).join(''));
});

test('derived blocks: an exactly derivable overall costs no patches, a withheld candidate costs a few, anything else is stored whole', () => {
  // 1. a first pass learns the template and shows what the rows predict
  const skeleton = () => [
    { t: 'h', v: 'EXAMINATION CENTRE OVERALL PERFORMANCE' },
    { t: 'kv', rows: [['EXAMINATION CENTRE REGION', 'DAR ES SALAAM'], ['TOTAL PASSED CANDIDATES', '0'], ['EXAMINATION CENTRE GPA', '3.0000 GRADE C (GOOD)']] },
    { t: 'h', v: 'EXAMINATION CENTRE DIVISION PERFORMANCE' },
    { t: 'grid', head: ['REGIST', 'ABSENT', 'SAT', 'WITHHELD', 'NO-CA', 'CLEAN', 'DIV I', 'DIV II', 'DIV III', 'DIV IV', 'DIV 0'], rows: [[]] },
    { t: 'h', v: 'EXAMINATION CENTRE SUBJECTS PERFORMANCE' },
    { t: 'grid', head: ['CODE', 'SUBJECT NAME', 'REG', 'SAT', 'NO-CA', 'W/HD', 'CLEAN', 'PASS', 'GPA', 'COMPENTENCY LEVEL'], rows: [['011', 'PHYSICS', '1', '1', '0', '0', '1', '1', '1.0000', 'Grade A (Excellent)']] },
  ];
  const mk = () => {
    const s = secondary();
    s.overall = skeleton();
    s.summary = { head: ['SEX', 'I', 'II', 'III', 'IV', '0'], rows: [['F', '1', '0', '0', '0', '0'], ['M', '0', '0', '0', '0', '0'], ['T', '1', '0', '0', '0', '0']] };
    s.facts = [];
    return s;
  };
  const first = build([mk()]);
  const pred = decodeCentre(first.one.text, first.meta, 'S0001', { predictOnly: true });
  assert.ok(pred.o && pred.s, 'a template makes a prediction');
  // 2. the exact prediction is stored as a mode flag only
  const exact = mk();
  exact.overall = JSON.parse(JSON.stringify(pred.o));
  exact.summary = JSON.parse(JSON.stringify(pred.s));
  const e = build([exact]);
  assert.deepEqual(proven(e), []);
  assert.deepEqual([e.one.stats.sMode, e.one.stats.oMode, e.one.stats.patches], ['1', 'd', 0]);
  // 3. a withheld candidate changes some cells: patches, still exact
  const withheld = JSON.parse(JSON.stringify(exact));
  withheld.overall[3].rows[0][3] = '1';
  withheld.overall[5].rows[0][5] = '1';
  const w = build([withheld]);
  assert.deepEqual(proven(w), []);
  assert.equal(w.one.stats.oMode, 'd');
  assert.ok(w.one.stats.patches >= 2 && w.one.stats.patches <= 6, `patches ${w.one.stats.patches}`);
  assert.equal(w.decode().overall[3].rows[0][3], '1');
  // 4. a ranking block (a different shape) is kept whole
  const ranking = JSON.parse(JSON.stringify(exact));
  ranking.overall[0] = { t: 'h', v: 'EXAMINATION CENTRE RANKING' };
  ranking.overall[1].rows.push(['CENTRE CATEGORY', 'CENTRE WITH 40 CANDIDATES OR MORE'], ['CENTRE POSITION IN ITS CATEGORY (REGIONWIDE)', '41/135']);
  const r = build([exact, ranking]);
  assert.deepEqual(proven(r), []);
  assert.equal(r.files[1].stats.oMode, 'j');
  assert.deepEqual(r.decode(1).overall, ranking.overall);
});

test('primary derived blocks: average marks are stored as totals, level and school average follow', () => {
  const mk = () => {
    const p = prim();
    p.summary = { head: ['JINSI', 'A', 'B', 'C', 'D', 'E'], rows: [['WASICHANA', '0', '0', '0', '0', '0'], ['WAVULANA', '0', '1', '0', '0', '0'], ['JUMLA', '0', '1', '0', '0', '0']] };
    p.overall = [{ t: 'h', v: 'UFAULU' }, { t: 'grid', head: ['NAMBA', 'SOMO', 'WALIOSAJILIWA', 'WALIOFANYA', 'WALIOFUTIWA/SITISHIWA', 'WENYE MATOKEO', 'WALIOFAULU (GREDI A-C)', 'WASTANI WA ALAMA (/50)', 'KUNDI LA UMAHIRI'], rows: SUBJ.slice(0, 6).map((n, i) => [String(i + 1), n.toUpperCase(), '2', '1', '0', '1', '1', '33.0000', 'Daraja B (Nzuri Sana)']) }];
    p.facts = [['WALIOFANYA MTIHANI', '1'], ['WASTANI WA SHULE', '198.0000'], ['DARAJA', 'DARAJA C (NZURI)']];
    return p;
  };
  const b = build([mk()]);
  assert.deepEqual(proven(b), []);
  assert.deepEqual([b.one.stats.sMode, b.one.stats.oMode, b.one.stats.fMode], ['1', 'd', 'd']);
  assert.equal(b.decode().facts[1][1], '198.0000');
  assert.equal(b.one.text.split('\n')[7], '33,33,33,33,33,0', 'the marks totals; the subject with an X has no one with a result');
});

test('statistics come from the header alone', () => {
  const b = build([secondary()]);
  const h = decodeHeader(b.one.text);
  assert.equal(h.n, 5);
  assert.equal(h.absent, 1);
  assert.deepEqual(h.byGroup, [[1, 0, 0, 0, 0], [0, 0, 0, 0, 0]]);
  const s = stats(h, 'secondary');
  assert.equal(s.sat, 4);
  assert.equal(s.passed, 1);
  assert.equal(s.passRate, 0.25);
  assert.deepEqual(s.total, [1, 0, 0, 0, 0]);
  assert.equal(stats({ n: 2, absent: 2, byGroup: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] }, 'secondary').passRate, null);
  const p = build([prim()]);
  const ph = decodeHeader(p.one.text);
  assert.equal(ph.n, 2);
  assert.deepEqual(stats(ph, 'primary').groups, [0, 1, 0, 0, 0]);
  assert.ok(!('passRate' in stats(ph, 'primary')));
  // the header decode does not read any other line
  assert.deepEqual(decodeHeader(b.one.text.split('\n').slice(0, 2).join('\n')), h);
});

test('packer refuses what it cannot keep', () => {
  const badRaw = secondary();
  badRaw.candidates[0].subjectsRaw = 'something else';
  const b = build([badRaw]);
  assert.ok(verifyCentre(badRaw, b.one.text, b.meta).some((x) => /subjectsRaw/.test(x)));
  const wrongCode = secondary();
  wrongCode.candidates[0].cno = 'S0002/0001';
  const keptAsPublished = build([wrongCode]);
  assert.deepEqual(proven(keptAsPublished), [], 'a number that is not under the centre code is kept whole');
  assert.equal(keptAsPublished.decode().candidates[0].cno, 'S0002/0001');
  const odd = prim();
  odd.candidates[0].subjects[1][0] = 'Other';
  odd.candidates[0].subjectsRaw = rawOf(odd.candidates[0].subjects, 'primary');
  assert.throws(() => build([prim(), odd]), /fixed list/);
  const longGrade = secondary();
  longGrade.candidates[0].subjects[0][1] = 'AB';
  longGrade.candidates[0].subjectsRaw = rawOf(longGrade.candidates[0].subjects, 'secondary');
  assert.throws(() => build([longGrade]), /grade/);
  const cycle = secondary();
  cycle.candidates.push(cand('S0001/0006', 'F', '-', '0', [['LIT ENG', 'C'], ['PHY', 'C']]));
  const cyc = build([cycle]);
  assert.deepEqual(proven(cyc), [], 'conflicting subject orders no longer stop the pack: the odd row is kept as written');
  assert.equal(cyc.one.text.split('\n').length, 11);
  const sex = secondary();
  sex.candidates[0].sex = 'X';
  assert.throws(() => build([sex]), /sex/);
});

test('a one-character corruption of a centre file is caught', () => {
  const src = secondary();
  const b = build([src]);
  assert.deepEqual(verifyCentre(src, b.one.text, b.meta), []);
  const lines = b.one.text.split('\n');
  const flip = (ch) => (ch === 'A' ? 'B' : 'A');
  const g = lines[4];
  const i = [...g].findIndex((c) => /[A-Z]/.test(c));
  for (const [line, text] of [[4, g.slice(0, i) + flip(g[i]) + g.slice(i + 1)], [1, lines[1].replace('F', 'M')], [3, lines[3].slice(1) + lines[3][0]]]) {
    const copy = [...lines];
    copy[line] = text;
    assert.ok(verifyCentre(src, copy.join('\n'), b.meta).length > 0, `line ${line}`);
  }
  assert.ok(verifyCentre(src, b.one.text.replace('MARY', 'MORY'), b.meta).length > 0 || !b.one.text.includes('MARY'));
  assert.ok(verifyCentre(src, b.one.text.slice(0, -3), b.meta).length > 0, 'a cut file');
});

test('list: sorted, has follows the files, region and district, delta codes, missing centres', () => {
  const rows = [['S0002', 'B SECONDARY SCHOOL', 1], ['S0001', 'A SECONDARY SCHOOL', 1], ['P0101', 'C CENTRE', 0], ['s5405', 'LOWER', 1]];
  const has = (c) => c !== 'P0101';
  const list = packList('secondary', rows, has);
  assert.deepEqual(decodeList(list, 'secondary').map((r) => r[0]), ['P0101', 'S0001', 'S0002', 's5405']);
  assert.deepEqual(decodeList(list, 'secondary').map((r) => r[2]), [0, 1, 1, 1]);
  assert.equal(decodeList(list, 'secondary')[0].length, 3);
  assert.deepEqual(verifyList('secondary', rows, list, has), []);
  const geo = [['PS0101001', 'ONE PRIMARY SCHOOL', 1, 'ARUSHA', 'ARUSHA'], ['PS0101002', 'TWO PRIMARY SCHOOL', 1, 'ARUSHA', 'MERU'], ['PS0201001', 'THREE', 0, 'DODOMA', 'DODOMA']];
  const gl = packList('primary', geo, (c) => c !== 'PS0201001');
  assert.deepEqual(decodeList(gl, 'primary'), geo);
  // almost nothing online: the present centres are listed instead of the missing ones, and an empty list works
  const few = packList('secondary', Array.from({ length: 50 }, (_, i) => ['S' + String(i).padStart(4, '0'), 'N' + i, 0]), (c) => c === 'S0007');
  assert.ok('y' in few && !('z' in few));
  assert.deepEqual(decodeList(few, 'secondary').filter((r) => r[2]).map((r) => r[0]), ['S0007']);
  assert.deepEqual(decodeList(packList('secondary', [], () => true), 'secondary'), []);
  assert.throws(() => packList('secondary', [['S1', 'a\nb', 1]], () => true), /single line/);
});

test('meta key is the first 10 hex of the sha1 of meta and list without the key', () => {
  const b = build([secondary()]);
  const list = packList('secondary', [['S0001', 'A', 1]], () => true);
  const meta = finishMeta({ ...b.meta }, list, 1, 1);
  assert.match(meta.key, /^[0-9a-f]{10}$/);
  const { key, ...rest } = meta;
  assert.equal(key, createHash('sha1').update(JSON.stringify(rest)).update(JSON.stringify(list)).digest('hex').slice(0, 10));
  assert.equal(metaKey(meta, list), key);
  assert.equal(meta.total, 1);
  assert.equal(meta.online, 1);
  const other = finishMeta({ ...b.meta, verified: '2026-11-10' }, list, 1, 1);
  assert.notEqual(other.key, key);
  const other2 = finishMeta({ ...b.meta }, packList('secondary', [['S0001', 'B', 1]], () => true), 1, 1);
  assert.notEqual(other2.key, key);
});

test('decoder is strict about the version', () => {
  const b = build([secondary()]);
  assert.throws(() => decodeCentre(b.one.text, { ...b.meta, v: 2 }, 'S0001'), /version/);
});

test('the decoder has no Node or DOM dependency (it must run in a Worker)', () => {
  const code = fs.readFileSync(path.join(ROOT, 'js/results-codec.js'), 'utf8');
  assert.doesNotMatch(code, /\bimport\s|require\(|process\.|Buffer|document\.|window\.|fetch\(/);
});

function spawnPack(src, work, out, extra = []) {
  return spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts/results-data.mjs'), '--src', src, '--work', work, '--out', out, ...extra], { encoding: 'utf8' });
}
const readCentre = (out, exam, code) => {
  const dir = path.join(out, exam);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  return { meta, dec: decodeCentre(fs.readFileSync(path.join(dir, code.toLowerCase() + '.txt'), 'utf8'), meta, code.toUpperCase()) };
};

test('command line writes v3 files, deletes old v2 ones, skips unchanged files, and fails on a bad source', () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const base = fs.mkdtempSync(path.join(CACHE, 'cli-'));
  try {
    const src = path.join(base, 'src');
    const s = secondary();
    const put = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true }); fs.writeFileSync(path.join(src, rel), JSON.stringify(obj)); };
    put('public/data/examinations.json', { exams: [{ id: 'csee-2024', category: 'CSEE', year: 2024, kind: 'secondary', verified: '2026-11-09' }] });
    put('public/data/csee/2024/centres.json', { v: 1, meta: { total: 2 }, rows: [['S0001', 'MARYS', 1], ['S5405', 'LOWER', 1]] });
    put('data/centres/csee/2024/s0001.json', s);
    const out = path.join(base, 'out');
    // old v2 files must go
    fs.mkdirSync(path.join(out, 'csee-2024'), { recursive: true });
    fs.writeFileSync(path.join(out, 'csee-2024/index.json'), '{}');
    fs.writeFileSync(path.join(out, 'csee-2024/s0001.json'), '{}');
    const run = (extra = []) => spawnPack(src, path.join(base, 'no-work'), out, extra);
    const r1 = run();
    assert.equal(r1.status, 0, r1.stderr + r1.stdout);
    assert.match(r1.stdout, /no data \(1\): S5405/);
    assert.match(r1.stdout, /brotli-9/);
    assert.match(r1.stdout, /largest s0001\.txt/);
    assert.deepEqual(fs.readdirSync(path.join(out, 'csee-2024')).sort(), ['list.json', 'meta.json', 's0001.txt']);
    const { meta, dec } = readCentre(out, 'csee-2024', 'S0001');
    assert.equal(meta.online, 1);
    assert.equal(meta.total, 2);
    assert.equal(meta.verified, '2026-11-09');
    assert.match(meta.key, /^[0-9a-f]{10}$/);
    const list = decodeList(JSON.parse(fs.readFileSync(path.join(out, 'csee-2024/list.json'), 'utf8')), 'secondary');
    assert.deepEqual(list.map((r) => r[2]), [1, 0]);
    assert.equal(dec.candidates.length, 5);
    assert.match(run().stdout, /written 0/);
    // a source row the packer cannot keep stops the run and leaves the previous output untouched
    const before = fs.readdirSync(path.join(out, 'csee-2024')).sort().map((f) => [f, fs.readFileSync(path.join(out, 'csee-2024', f), 'utf8')]);
    s.candidates[0].subjectsRaw = 'tampered';
    put('data/centres/csee/2024/s0001.json', s);
    const r3 = run();
    assert.notEqual(r3.status, 0);
    assert.match(r3.stderr, /subjectsRaw|nothing was written/);
    const after = fs.readdirSync(path.join(out, 'csee-2024')).sort().map((f) => [f, fs.readFileSync(path.join(out, 'csee-2024', f), 'utf8')]);
    assert.deepEqual(after, before);
    // a failure in a fresh output folder writes nothing at all
    const fresh = spawnPack(src, path.join(base, 'no-work'), path.join(base, 'fresh'));
    assert.notEqual(fresh.status, 0);
    assert.equal(fs.existsSync(path.join(base, 'fresh')), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('command line reads the work folder too: top-ups win, partial and new exams work, *.tmp is ignored, --exam takes a list', () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const base = fs.mkdtempSync(path.join(CACHE, 'work-'));
  try {
    const src = path.join(base, 'src');
    const work = path.join(base, 'work');
    const put = (root, rel, obj, raw) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), raw ?? JSON.stringify(obj)); };
    const s = secondary();
    put(src, 'public/data/examinations.json', { exams: [{ id: 'csee-2024', category: 'CSEE', year: 2024, kind: 'secondary', verified: '2026-11-09' }] });
    put(src, 'public/data/csee/2024/centres.json', { v: 1, meta: { total: 2 }, rows: [['S0001', 'MARYS', 1], ['S5405', 'LOWER', 0]] });
    put(src, 'data/centres/csee/2024/s0001.json', s);
    // work folder: a top-up of the missing lowercase centre, a newer file for S0001, a whole new exam, a half-written file,
    // a finished file the exam list does not know yet, and an exam with no centre yet
    const top = { ...secondary(), code: 'S5405', name: 'LOWER SCHOOL', sourceUrl: 'https://example.test/s5405.htm', candidates: [cand('S5405/0001', 'F', '-', 'IV', [['PHY', 'C']])] };
    const newer = { ...secondary(), name: 'MARYS NEWER' };
    put(work, 'data/csee/2024/s5405.json', top);
    put(work, 'data/csee/2024/s0001.json', newer);
    put(work, 'data/csee/2024/s9999.json.4242.tmp', null, '{"half":');
    put(work, 'exams/csee-2024.json', { id: 'csee-2024', category: 'CSEE', year: 2024, kind: 'secondary', importedAt: '2026-11-12', centres: [{ code: 'S0001', name: 'MARYS', region: '', district: '', imported: true }, { code: 'S5405', name: 'LOWER', region: '', district: '', imported: true }] });
    const p = { ...prim(), exam: 'psle-2021', year: 2021 };
    put(work, 'data/psle/2021/ps0101001.json', p);
    const extra = { ...prim(), exam: 'psle-2021', year: 2021, code: 'PS0101002', indexName: 'EXTRA PRIMARY SCHOOL', name: 'EXTRA PRIMARY SCHOOL' };
    extra.candidates = extra.candidates.map((c) => ({ ...c, cno: c.cno.replace('PS0101001', 'PS0101002') }));
    put(work, 'data/psle/2021/ps0101002.json', extra);
    put(work, 'exams/psle-2021.json', { id: 'psle-2021', category: 'PSLE', year: 2021, kind: 'primary', importedAt: '2026-11-12', centres: [{ code: 'PS0101001', name: "ST. JOHN'S PRIMARY SCHOOL", region: 'ARUSHA', district: 'ARUSHA', imported: true }, { code: 'PS0101009', name: 'LATER PRIMARY SCHOOL', region: 'ARUSHA', district: 'MERU', imported: false }] });
    put(work, 'exams/psle-2020.json', { id: 'psle-2020', category: 'PSLE', year: 2020, kind: 'primary', importedAt: '2026-11-12', centres: [{ code: 'PS0101001', name: 'X', region: '', district: '', imported: false }] });
    const out = path.join(base, 'out');
    const run = (extra2) => spawnPack(src, work, out, extra2);
    const r = run([]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /psle-2020: no centre files yet, skipped/);
    const { meta, dec } = readCentre(out, 'csee-2024', 'S0001');
    assert.equal(meta.verified, '2026-11-12');
    assert.equal(meta.online, 2);
    assert.equal(dec.name, 'MARYS NEWER', 'the work folder wins');
    assert.equal(readCentre(out, 'csee-2024', 'S5405').dec.candidates.length, 1);
    assert.deepEqual(fs.readdirSync(path.join(out, 'csee-2024')).sort(), ['list.json', 'meta.json', 's0001.txt', 's5405.txt']);
    const pl = decodeList(JSON.parse(fs.readFileSync(path.join(out, 'psle-2021/list.json'), 'utf8')), 'primary');
    assert.deepEqual(pl.map((x) => [x[0], x[2]]), [['PS0101001', 1], ['PS0101002', 1], ['PS0101009', 0]]);
    assert.equal(pl[0][3], 'ARUSHA');
    assert.match(r.stdout, /1 centre file\(s\) were not in the list/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'psle-2021/meta.json'), 'utf8')).online, 2);
    // --exam with a list, and an unknown one is an error
    fs.rmSync(out, { recursive: true });
    assert.equal(run(['--exam', 'psle-2021', '--dry']).status, 0);
    assert.equal(fs.existsSync(out), false);
    assert.match(run(['--exam', 'csee-2024,psle-2021', '--dry']).stdout, /csee-2024[\s\S]*psle-2021/);
    const bad = run(['--exam', 'csee-1999']);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /No exam csee-1999/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('real centres round-trip with their derived blocks', { skip: !fs.existsSync(SRC) && 'Results project folder not found' }, () => {
  const picks = [['csee', '2024', ['p0101', 's2476', 's0108']], ['csee', '2023', ['s2405', 'p0101']], ['acsee', '2024', ['p0101', 's0101']], ['psle', '2023', ['ps0101001', 'ps0206126']]];
  for (const [cat, year, codes] of picks) {
    const srcs = codes.map((code) => JSON.parse(fs.readFileSync(path.join(SRC, 'data/centres', cat, year, code + '.json'), 'utf8')));
    const b = build(srcs);
    assert.deepEqual(proven(b), [], `${cat} ${year}`);
    // most overall blocks are worked out from the rows
    assert.ok(b.files.some((f) => f.stats.oMode === 'd' || f.stats.oMode === ''), `${cat} ${year} derived`);
    assert.ok(b.files.every((f) => f.stats.sMode === '1' || f.stats.sMode === '0' || f.stats.sMode === 'j'));
    for (const f of b.files) assert.ok(Buffer.byteLength(f.text) < Buffer.byteLength(JSON.stringify(f.src)) / 3, 'much smaller than the source');
  }
});

/* ---------------------------------------------------------------- other examinations (added 2026-11-10)
   Scrubbed fixtures of NECTA's pages go through the parsers and then the packer, the proof and the decoder. */
const FIX = path.join(ROOT, 'scripts/tests/fixtures');
const fx = (d, f) => fs.readFileSync(path.join(FIX, d, f), 'utf8');
const wrap = (r, cat, kind, year) => ({ exam: `${cat}-${year}`, category: cat.toUpperCase(), year, kind, sourceUrl: `https://example.test/${r.code.toLowerCase()}.htm`, indexName: r.name, region: '', district: '', issues: [], ...r });

async function fixtureGroups() {
  const L = await import('../lib/necta-parse-legacy.mjs');
  const D = await import('../lib/necta-parse-diploma.mjs');
  const F = await import('../lib/necta-parse-ftna-sfna.mjs');
  const O = await import('../lib/necta-parse-psle-old.mjs');
  const g = new Map();
  const add = (k, s) => g.set(k, [...(g.get(k) || []), s]);
  for (const f of fs.readdirSync(path.join(FIX, 'legacy'))) {
    const m = /^(a?csee)-(\d+)-(p\d+)\./.exec(f);
    if (m) add(`${m[1]}-${m[2]}`, wrap(L.parseLegacyCentre(fx('legacy', f), m[3].toUpperCase()), m[1], 'secondary', +m[2]));
  }
  for (const f of fs.readdirSync(path.join(FIX, 'diploma'))) {
    const m = /^(dsee|dpee|dppee|dspee|dte|qt)(\d+)_(?!index)/.exec(f);
    if (!m) continue;
    const r = m[1] === 'qt' ? D.parseQtPage(fx('diploma', f)) : D.parseDiplomaCentre(fx('diploma', f));
    for (const c of r.centres || [r]) add(`${m[1]}-${m[2]}`, wrap(c, m[1], 'secondary', +m[2]));
  }
  for (const f of fs.readdirSync(path.join(FIX, 'ftna-sfna'))) {
    const m = /^(ftna|sfna)(\d+)_(?!index|district|region)/.exec(f);
    if (!m) continue;
    const r = m[1] === 'ftna' ? F.parseFtnaCentre(fx('ftna-sfna', f)) : F.parseSfnaSchool(fx('ftna-sfna', f), undefined, /referred/.test(f) ? { referred: 'note' } : {});
    add(`${m[1]}-${m[2]}`, wrap(r, m[1], m[1] === 'sfna' ? 'primary' : 'secondary', +m[2]));
  }
  for (const f of fs.readdirSync(path.join(FIX, 'psle-old'))) {
    const m = /^psle(\d+)_shl/.exec(f);
    if (m) add(`psle-${m[1]}`, wrap(O.parsePsleOldSchool(fx('psle-old', f)), 'psle', 'primary', +m[1]));
  }
  return g;
}

test('every scrubbed fixture of every family packs, proves and decodes (legacy, diploma, QT, FTNA, SFNA, old PSLE)', async () => {
  const groups = await fixtureGroups();
  assert.ok(groups.size >= 40, `${groups.size} exam-years`);
  for (const [id, srcs] of groups) {
    const b = build(srcs);
    assert.deepEqual(proven(b), [], id);
    b.files.forEach((f, i) => assert.equal(decodeCentre(f.text, b.meta, srcs[i].code.toUpperCase()).candidates.length, srcs[i].candidates.length, id));
  }
});

test('GPA is stored in tenths and read back as published; class and result words are kept as written', async () => {
  const groups = await fixtureGroups();
  for (const id of ['csee-2014', 'acsee-2015', 'dsee-2025', 'dpee-2026', 'dte-2019']) {
    const srcs = groups.get(id);
    const b = build(srcs);
    assert.equal(b.meta.gs, 10, id);
    assert.deepEqual(proven(b), [], id);
    const dec = b.decode();
    const gpa = srcs[0].candidates.find((c) => /^\d\.\d$/.test(c.aggt));
    assert.equal(dec.candidates.find((c) => c.cno === gpa.cno).aggt, gpa.aggt);
    assert.ok(b.meta.dw.every((w) => /^[A-Z]+$/.test(w)) && !b.meta.dw.includes('I'), `${id} result words`);
    assert.ok(b.meta.dp >= 3 && b.meta.dp <= 4);
    // the header counts follow the words, and a pass is the leading ones
    const s = stats(decodeHeader(b.one.text), 'secondary', b.meta);
    assert.equal(s.total.length, b.meta.dw.length);
    assert.equal(s.passed, s.total.slice(0, b.meta.dp).reduce((a, c) => a + c, 0));
  }
});

test('GPA edge cases: a value that is not one decimal, a star code and a dash survive as exceptions', () => {
  const src = secondary();
  src.candidates = [
    cand('S0001/0001', 'F', '2.9', 'CREDIT', [['PHY', 'A']]),
    cand('S0001/0002', 'M', '3', 'PASS', [['PHY', 'B']]),
    cand('S0001/0003', 'M', '*E', '*E', [['PHY', 'C']]),
    cand('S0001/0004', 'F', '-', 'ABS', [['PHY', 'X']]),
    cand('S0001/0005', 'F', '4.0', 'DISTINCTION', [['PHY', 'A']]),
  ];
  src.summary = { head: ['SEX', 'DISTINCTION', 'CREDITS', 'PASS', 'SUPP', 'FLD'], rows: [['T', '1', '1', '1', '0', '0']] };
  src.overall = []; src.facts = [];
  const b = build([src]);
  assert.equal(b.meta.gs, 10);
  assert.deepEqual(proven(b), []);
  assert.deepEqual(b.decode().candidates.map((c) => c.aggt), ['2.9', '3', '*E', '-', '4.0']);
  assert.equal(b.one.stats.sMode, '2', 'a one-row total summary is worked out from the counts');
  assert.deepEqual(decodeHeader(b.one.text).byGroup[0].slice(0, 3), [1, 1, 0]);
  assert.equal(decodeHeader(b.one.text).absent, 1);
});

test('subjects in conflicting orders: the common order is kept, the others are stored as written', () => {
  const src = secondary();
  src.summary = null; src.overall = []; src.facts = [];
  src.candidates = [
    cand('S0001/0001', 'F', '-', '0', [['AAA', 'A'], ['BBB', 'B'], ['CCC', 'C']]),
    cand('S0001/0002', 'F', '-', '0', [['AAA', 'A'], ['BBB', 'B'], ['CCC', 'C']]),
    cand('S0001/0003', 'M', '-', '0', [['CCC', 'D'], ['AAA', 'E']]),
    cand('S0001/0004', 'M', '-', '0', [['BBB', 'F'], ['AAA', 'A']]),
    cand('S0001/0005', 'M', '-', '0', [['AAA', 'A'], ['BBB', 'B'], ['CCC', 'C']]),
  ];
  const b = build([src]);
  assert.deepEqual(b.meta.subjects.slice(0, 3), ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(proven(b), []);
  const lines = b.one.text.split('\n');
  assert.equal(lines.length, 11);
  assert.equal(lines[10].split('\x1f').length, 2, 'two odd rows');
  assert.deepEqual(b.decode().candidates[3].subjects, [['BBB', 'F'], ['AAA', 'A']]);
  // an older file with ten lines still decodes
  const old = build([secondary()]);
  assert.equal(old.one.text.split('\n').length, 10);
});

test('candidate numbers are kept as published: other separators, mixed and foreign numbers', () => {
  const src = secondary();
  src.candidates = [cand('S0001-0001', 'F', '-', '0', [['PHY', 'A']]), cand('S0001-0002', 'M', '-', '0', [['PHY', 'B']])];
  src.summary = null; src.overall = []; src.facts = [];
  const hy = build([src]);
  assert.deepEqual(proven(hy), []);
  assert.deepEqual(hy.decode().candidates.map((c) => c.cno), ['S0001-0001', 'S0001-0002']);
  assert.equal(hy.one.text.split('\n')[0].split(';')[9], '-');
  const mixed = secondary();
  mixed.summary = null; mixed.overall = []; mixed.facts = [];
  mixed.candidates[1].cno = 'S0001-0002';
  const mx = build([mixed]);
  assert.deepEqual(proven(mx), []);
  assert.equal(mx.decode().candidates[1].cno, 'S0001-0002');
  assert.equal(mx.one.text.split('\n')[0].split(';')[9], '*');
});

test('QT: no subjects at all, results as marker rows, the star note kept', async () => {
  const groups = await fixtureGroups();
  const srcs = groups.get('qt-2023');
  const b = build(srcs);
  assert.deepEqual(b.meta.subjects, []);
  assert.deepEqual(b.meta.dw, ['PASSED', 'FAILED']);
  assert.equal(b.meta.dp, 1);
  assert.deepEqual(proven(b), []);
  const s = stats(decodeHeader(b.one.text), 'secondary', b.meta);
  const sum = srcs[0].summary.rows[0];
  assert.equal(s.total[0], +sum[1]);
  assert.equal(s.total[1], +sum[2]);
  const star = secondary();
  star.summary = null; star.overall = []; star.facts = [];
  star.candidates = [{ cno: 'S0001/0001', sex: 'F', aggt: '-', div: 'PASSED', subjects: [], subjectsRaw: '' }, { cno: 'S0001/0002', sex: 'M', aggt: '-', div: '*W', subjects: [], subjectsRaw: 'Results Withheld, see the office' }, { cno: 'S0001/0003', sex: 'M', aggt: '-', div: 'ABSENT', subjects: [], subjectsRaw: '' }];
  const sb = build([star]);
  assert.deepEqual(proven(sb), []);
  assert.equal(sb.decode().candidates[1].note, 'Results Withheld, see the office');
  assert.equal(decodeHeader(sb.one.text).absent, 1, 'ABSENT counts as absent');
});

test('FTNA: referred candidates are counted and absentees (ABS in the subjects cell) are absent', async () => {
  const groups = await fixtureGroups();
  const srcs = groups.get('ftna-2025');
  const b = build(srcs);
  assert.deepEqual(proven(b), []);
  const i = srcs.findIndex((s) => s.candidates.some((c) => c.subjectsRaw === 'ABS'));
  assert.ok(i >= 0);
  assert.equal(decodeHeader(b.files[i].text).absent, srcs[i].candidates.filter((c) => c.subjectsRaw === 'ABS').length);
  const f22 = build(groups.get('ftna-2022'));
  assert.deepEqual(proven(f22), []);
});

test('SFNA and old PSLE: referred pupils are marker rows, the 2013 spelling is kept in the data', async () => {
  const groups = await fixtureGroups();
  const sf = build(groups.get('sfna-2022'));
  assert.deepEqual(proven(sf), []);
  const notes = sf.files.flatMap((f) => decodeCentre(f.text, sf.meta, f.src.code.toUpperCase()).candidates.filter((c) => c.note));
  assert.ok(notes.some((c) => /REFERRED$/.test(c.note)));
  const old = build(groups.get('psle-2013'));
  assert.deepEqual(proven(old), []);
  assert.ok(old.meta.subjects.includes('Avarage Grade'), 'the data keeps NECTA’s spelling; the page shows Average Grade');
});

test('the files of an exam packed before these changes decode the same', () => {
  const dir = path.join(ROOT, 'results-data');
  if (!fs.existsSync(dir)) return;
  const exams = ['csee-2025', 'acsee-2024', 'psle-2023'].filter((x) => fs.existsSync(path.join(dir, x, 'meta.json'))); // the exams that were packed before the format grew
  for (const id of exams) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8'));
    if (meta.v !== 3) continue;
    const f = fs.readdirSync(path.join(dir, id)).find((x) => /\.txt$/.test(x));
    const d = decodeCentre(fs.readFileSync(path.join(dir, id, f), 'utf8'), meta, f.slice(0, -4).toUpperCase());
    assert.ok(d.candidates.length > 0 && d.name, id);
    assert.ok(!('dw' in meta) && !('gs' in meta), 'these exams use the plain I to IV words');
  }
});

test('more than 62 subjects: places are written with two digits and everything still round-trips', () => {
  const names = Array.from({ length: 70 }, (_, i) => `SUBJ${String(i).padStart(2, '0')}`);
  const src = secondary();
  src.summary = null; src.overall = []; src.facts = [];
  src.candidates = [
    cand('S0001/0001', 'F', '-', '0', [[names[0], 'A'], [names[65], 'B'], [names[69], 'C']]),
    cand('S0001/0002', 'M', '-', '0', names.slice(0, 70).map((n, i) => [n, 'ABCD'[i % 4]])),
    cand('S0001/0003', 'M', '-', '0', [[names[69], 'A'], [names[1], 'B']]),
  ];
  const b = build([src]);
  assert.equal(b.meta.sd, 2);
  assert.deepEqual(proven(b), []);
  assert.equal(b.decode().candidates[2].subjects[0][0], names[69]);
});
