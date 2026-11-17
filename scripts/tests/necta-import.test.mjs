// Offline tests of the NECTA importer: parser, fetch layer, resumable run, status. Nothing here touches the network.
// Real pages from the recon (~/.cache/mb-recon/raw) are used when present; synthetic pages cover the same cases otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import * as P from '../lib/necta-parse.mjs';
import { checkUrl, createFetcher, RateLimiter, parseRetryAfter, cachePathFor, FetchError, StopError, HOSTS, USER_AGENT } from '../lib/necta-fetch.mjs';
import { examDef, EXAM_IDS } from '../lib/necta-exams.mjs';
import { runImport, statusLines, parseArgs, validateCentre, dropForeignTail } from '../necta-import.mjs';
import { learnMeta, packCentre, verifyCentre } from '../lib/results-pack.mjs';

const RAW = path.join(os.homedir(), '.cache', 'mb-recon', 'raw');
const real = (f) => (fs.existsSync(path.join(RAW, f)) ? P.decodeBuffer(fs.readFileSync(path.join(RAW, f))) : null);
const CACHE = path.join(os.homedir(), '.cache', 'mayobe-results-tests');
const tmp = (name) => { fs.mkdirSync(CACHE, { recursive: true }); return fs.mkdtempSync(path.join(CACHE, name + '-')); };

// ---- synthetic NECTA pages ----
const td = (t) => `<TD WIDTH="5%" VALIGN="MIDDLE"><FONT FACE="Arial" SIZE=1><P ALIGN="CENTER">${t}</FONT></TD>`;
const tr = (cells) => `<TR>${cells.map(td).join('')}</TR>`;
const table = (rowsArr) => `<TABLE BORDER CELLSPACING=2>${rowsArr.map(tr).join('\n')}</TABLE>`;

function secondaryPage({ heading, cands, summary = true, overall = true }) {
  return `<HTML><BODY><H3><P ALIGN="LEFT">${heading}\n</P></H3>
${summary ? table([['SEX', 'I', 'II', 'III', 'IV', '0'], ['F', '0', '0', '0', '1', '0'], ['T', '0', '0', '0', '1', '0']]) : ''}
${table([['CNO', 'SEX', 'AGGT', 'DIV', 'DETAILED SUBJECTS'], ...cands])}
${overall ? table([['EXAMINATION CENTRE RANKING'], ['EXAMINATION CENTRE REGION', 'DAR ES SALAAM']]) + table([['CODE', 'SUBJECT NAME', 'REG', 'REG/RANK', 'NAT/RANK'], ['011', 'CIVICS', '9', '3/10', '40/90']]) : ''}
</BODY></HTML>`;
}
const NAMES = ['JUMA HASSANI KIMARIO', 'ASHA SAIDI MBWANA', 'PETER JOHN MALLYA'];
const PREMS = ['20151557239', '20164817250', '20160504492'];
function pslePage({ year, withName, withPrem, extraTop = '' }) {
  const head = ['CAND. NO', ...(withPrem ? ['PREM NO'] : []), 'SEX', ...(withName ? ['CANDIDATE NAME'] : []), 'SUBJECTS'];
  const seq = (i) => (year === 2020 ? `00${i + 1}` : `000${i + 1}`);
  const sub = year === 2020
    ? ['Kiswahili - B, English - B, Maarifa - B, Hisabati - C, Science - C, Average Grade - B', 'Kiswahili - A, English - B, Maarifa - B, Hisabati - C, Science - C, Average Grade - B', '---']
    : ['Kiswahili - B, English - C, Maarifa - C, Hisabati - C, Science - B, Uraia - C, Average Grade - C', 'Kiswahili - A, English - B, Maarifa - B, Hisabati - C, Science - B, Uraia - B, Average Grade - B', 'ABS'];
  const body = NAMES.map((n, i) => [`PS0101001-${seq(i)}`, ...(withPrem ? [PREMS[i]] : []), i === 1 ? 'F' : 'M', ...(withName ? [n] : []), sub[i]]);
  return `<HTML><BODY>${extraTop}<H3><P>BANGATA PRIMARY SCHOOL - PS0101001\n</P></H3>
WALIOFANYA MTIHANI : 46 <br> WASTANI WA SHULE   : 167.0217 <br>
${table([['JINSI', 'A', 'B'], ['F', '1', '1']])}
${table([head, ...body])}
</BODY></HTML>`;
}

// ---- parser ----
test('lowercase heading and candidate numbers come out in capitals', () => {
  const html = secondaryPage({ heading: 's5405 LOWER SECONDARY SCHOOL', cands: [['s5405/0001', 'F', '-', 'IV', "CIV - 'C' HIST - 'D'"], ['S5405/0002', 'M', '-', '0', "CIV - 'F'"]] });
  const r = P.parseSecondaryCentre(html, 'S5405');
  assert.equal(r.code, 'S5405');
  assert.equal(r.name, 'LOWER SECONDARY SCHOOL');
  assert.deepEqual(r.candidates.map((c) => c.cno), ['S5405/0001', 'S5405/0002']);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(P.parseSecondaryCentre(html, 's5405').issues, []); // expected code compared without case
  const p = P.parseSecondaryCentre(secondaryPage({ heading: 'p5980 SOME CENTRE', cands: [['p5980/0001', 'F', '-', 'IV', "CIV - 'C'"]] }), 'P5980');
  assert.equal(p.candidates.length, 1);
  assert.equal(p.candidates[0].cno, 'P5980/0001');
});

test('markers stay as published and unreadable subject cells keep only their text', () => {
  const html = secondaryPage({
    heading: 'S0001 A SCHOOL',
    cands: [
      ['S0001/0001', 'F', '-', 'ABS', "PHY - 'X' CHEM - 'X'"],
      ['S0001/0002', 'M', '*W', '*W', 'Results Withheld'],
      ['S0001/0003', 'M', '-', '-', '---'],
      ['S0001/0004', 'M', '32', 'IV', "CIV - 'F' B/KNOWL - "],
      ['S0001/0005', 'F', '-', '*R', "LIT ENG - 'I' GEO - 'F'"],
    ],
  });
  const r = P.parseSecondaryCentre(html, 'S0001');
  assert.equal(r.candidates.length, 5);
  assert.deepEqual(r.candidates.map((c) => c.div), ['ABS', '*W', '-', 'IV', '*R']);
  assert.deepEqual(r.candidates[0].subjects, [['PHY', 'X'], ['CHEM', 'X']]);
  assert.deepEqual(r.candidates[1].subjects, []);
  assert.equal(r.candidates[1].subjectsRaw, 'Results Withheld');
  assert.equal(r.candidates[2].subjectsRaw, '---');
  assert.deepEqual(r.candidates[3].subjects, [], 'a half-read cell is not turned into pairs');
  assert.equal(r.candidates[3].subjectsRaw, "CIV - 'F' B/KNOWL -");
  // and the packer keeps every one of them
  const rec = { kind: 'secondary', code: 'S0001', name: r.name, sourceUrl: 'x', summary: r.summary, overall: r.overall, facts: [], candidates: r.candidates };
  const meta = learnMeta({ exam: 'csee-2024', cat: 'csee', year: 2024, kind: 'secondary', verified: '2026-11-10' }, (fn) => fn(rec));
  assert.deepEqual(verifyCentre(rec, packCentre(rec, meta).text, meta), []);
});

test('pages without a summary or an overall block are fine', () => {
  const r = P.parseSecondaryCentre(secondaryPage({ heading: 'S0002 B SCHOOL', cands: [['S0002/0001', 'F', '-', 'IV', "CIV - 'C'"]], summary: false, overall: false }), 'S0002');
  assert.equal(r.summary, null);
  assert.deepEqual(r.overall, []);
  assert.equal(r.candidates.length, 1);
  assert.equal(P.parsePsleSchool('<HTML><H3>X - PS0000001</H3></HTML>', 'PS0000001').candidates.length, 0);
});

test('overall blocks are kept as published (centre ranking and subject grid)', () => {
  const r = P.parseSecondaryCentre(secondaryPage({ heading: 'S0003 C SCHOOL', cands: [['S0003/0001', 'F', '-', 'IV', "CIV - 'C'"]] }), 'S0003');
  assert.deepEqual(r.overall[0], { t: 'h', v: 'EXAMINATION CENTRE RANKING' });
  assert.deepEqual(r.overall[1], { t: 'kv', rows: [['EXAMINATION CENTRE REGION', 'DAR ES SALAAM']] });
  assert.deepEqual(r.overall[2].head.slice(-2), ['REG/RANK', 'NAT/RANK']);
  const sample = real('tt_csee21_s2476.htm');
  if (!sample) return;
  const s = P.parseSecondaryCentre(sample, 'S2476');
  assert.ok(s.candidates.length > 100 && s.overall.length >= 4 && s.summary);
  assert.equal(s.overall[0].v, 'EXAMINATION CENTRE RANKING');
});

test('duplicate candidate numbers are reported and the page is refused', () => {
  const def = examDef('csee-2025');
  const r = P.parseSecondaryCentre(secondaryPage({ heading: 'S0004 D SCHOOL', cands: [['S0004/0001', 'F', '-', 'IV', "CIV - 'C'"], ['S0004/0001', 'M', '-', 'IV', "CIV - 'D'"]] }), 'S0004');
  assert.equal(r.candidates.length, 1);
  assert.match(r.issues.join(), /duplicate candidate S0004\/0001/);
  assert.match(validateCentre(def, 'S0004', r), /duplicate/);
  assert.match(validateCentre(def, 'S9999', P.parseSecondaryCentre(secondaryPage({ heading: 'S0004 D SCHOOL', cands: [['S0004/0001', 'F', '-', 'IV', "CIV - 'C'"]] }), 'S9999')), /heading code S0004 != S9999/);
  assert.match(validateCentre(def, 'S0005', { code: 'S0005', candidates: [{ cno: 'S0006/0001' }], issues: [] }), /does not start with S0005\//);
  assert.match(validateCentre(def, 'S0005', { code: 'S0005', candidates: [], issues: [] }), /no candidates/);
});

test('index links: results/, results\\ and flat, with letter-filter links ignored', () => {
  const a = (href, label) => `<TD><A HREF="${href}">${label}\n</A></TD>`;
  const html = `<HTML>${a('index.htm', 'ALL CENTRES')}${a('indexfiles\\index_a.htm', 'A')}${a('index_b.htm', 'B')}
    ${a('results/p0101.htm', 'P0101 AZANIA CENTRE')}${a('results\\s0101.htm', 'S0101 ABBEY SECONDARY SCHOOL')}${a('s5405.htm', 'S5405 LOWER SCHOOL')}${a('./p5980.htm', 'p5980 LOW CENTRE')}
    ${a('results/s0102.htm', 'S0101 WRONG LABEL')}${a('results/s0101.htm', 'S0101 DUPLICATE')}</HTML>`;
  const r = P.parseExamIndex(html);
  assert.deepEqual(r.centres.map((c) => [c.code, c.href]), [['P0101', 'results/p0101.htm'], ['S0101', 'results/s0101.htm'], ['S5405', 's5405.htm'], ['P5980', './p5980.htm']]);
  assert.equal(r.issues.length, 2);
  for (const [f, n] of [['csee2022_index.htm', 6233], ['tt_CSEE2021_csee.htm', 6061], ['tt_ACSEE2022_index.htm', 1088], ['acsee2025_index.htm', 1227]]) {
    const h = real(f);
    if (!h) continue;
    const x = P.parseExamIndex(h);
    assert.ok(Math.abs(x.centres.length - n) < 20 && x.issues.length === 0, f);
  }
});

test('PSLE chain links, with or without a folder', () => {
  const a = (href, label) => `<A HREF="${href}">${label}</A>`;
  assert.deepEqual(P.parseRegions(a('results/reg_01.htm', 'ARUSHA') + a('reg_02.htm', 'DAR ES SALAAM') + a('x.htm', 'no')).map((r) => [r.file, r.name]), [['reg_01.htm', 'ARUSHA'], ['reg_02.htm', 'DAR ES SALAAM']]);
  assert.deepEqual(P.parseDistricts(a('distr_0101.htm', 'ARUSHA') + a('results\\distr_0102.htm', 'ARUMERU')).map((r) => r.file), ['distr_0101.htm', 'distr_0102.htm']);
  const s = P.parseSchools(a('shl_ps0101114.htm', 'ALBEHIJE PRIMARY SCHOOL - PS0101114') + a('results/shl_ps0101128.htm', 'ARUSHA VICTORY - PS0101128'));
  assert.deepEqual(s.map((x) => [x.code, x.name]), [['PS0101114', 'ALBEHIJE PRIMARY SCHOOL'], ['PS0101128', 'ARUSHA VICTORY']]);
});

for (const year of [2020, 2021, 2022]) {
  test(`PSLE ${year} columns are read by header text; no name and no PREM number reach the output`, () => {
    const withName = year <= 2021;
    const withPrem = year >= 2021;
    const r = P.parsePsleSchool(pslePage({ year, withName, withPrem }), 'PS0101001');
    assert.equal(r.candidates.length, 3);
    assert.deepEqual(r.candidates.map((c) => c.sex), ['M', 'F', 'M']);
    assert.deepEqual(r.candidates.map((c) => Object.keys(c)), r.candidates.map(() => ['cno', 'sex', 'subjectsRaw', 'subjects']));
    assert.equal(r.candidates[0].cno, year === 2020 ? 'PS0101001-001' : 'PS0101001-0001');
    assert.equal(r.candidates[0].subjects.length, year === 2020 ? 6 : 7);
    assert.equal(r.candidates[0].subjects.at(-1)[0], 'Average Grade');
    assert.deepEqual(r.candidates[2].subjects, []);
    assert.equal(r.candidates[2].subjectsRaw, year === 2020 ? '---' : 'ABS');
    const out = JSON.stringify(r);
    for (const n of NAMES) assert.ok(!out.includes(n), `name ${n} leaked`);
    for (const n of PREMS) assert.ok(!out.includes(n), `PREM ${n} leaked`);
    assert.deepEqual(r.facts, [['WALIOFANYA MTIHANI', '46'], ['WASTANI WA SHULE', '167.0217']]);
  });
}

test('PSLE rows that do not fit never put cell text into a note', () => {
  const html = pslePage({ year: 2021, withName: true, withPrem: true }).replace('PS0101001-0002', 'BROKEN');
  const r = P.parsePsleSchool(html, 'PS0101001');
  assert.equal(r.candidates.length, 2);
  const out = JSON.stringify(r);
  assert.match(r.issues.join(), /skipped row 2/);
  for (const n of [...NAMES, ...PREMS]) assert.ok(!out.includes(n));
});

test('real PSLE pages (2020, 2021, 2022, 2025): no name or PREM number anywhere', () => {
  for (const [file, rows] of [['tt_psle20_shl.htm', 46], ['tt_psle21_shl.htm', 49], ['psle2022_shl_ps0101001.htm', 59], ['psle2025_shl_ps0101001.htm', 64]]) {
    const html = real(file);
    if (!html) continue;
    const r = P.parsePsleSchool(html, 'PS0101001');
    assert.equal(r.candidates.length, rows, file);
    assert.deepEqual(r.issues, [], file);
    const out = JSON.stringify(r);
    const table = P.tables(html).map(P.rows).find((x) => /^CAND/i.test(x[0][0]));
    const head = table[0].map((h) => h.toUpperCase());
    const nameCol = head.findIndex((h) => /NAME/.test(h));
    const premCol = head.findIndex((h) => /PREM/.test(h));
    for (const row of table.slice(1)) {
      if (nameCol >= 0) assert.ok(!out.includes(row[nameCol]), `${file}: name leaked`);
      if (premCol >= 0) assert.ok(!out.includes(row[premCol]), `${file}: PREM leaked`);
    }
  }
});

test('real secondary pages parse in every layout (lowercase-safe, old and new)', () => {
  for (const [file, code, min] of [['tt_csee21_p2265.htm', 'P2265', 10], ['tt_acsee22_s1375.htm', 'S1375', 300], ['csee2025_s2476.htm', 'S2476', 400], ['tt_csee20_s2476.htm', 'S2476', 400], ['csee2022_s2476.htm', 'S2476', 400], ['acsee2025_s1375.htm', 'S1375', 100]]) {
    const html = real(file);
    if (!html) continue;
    const r = P.parseSecondaryCentre(html, code);
    assert.ok(r.candidates.length >= min, `${file}: ${r.candidates.length}`);
    assert.equal(validateCentre(examDef('csee-2025'), code, r), null, file);
  }
});

// ---- fetch layer ----
const okPage = (body = '<HTML>ok</HTML>', init = {}) => new Response(body, { status: 200, ...init });
function fakeClock() {
  const c = { t: 1_000_000, now: () => c.t, sleeps: [] };
  c.sleep = async (ms) => { const wake = c.t + ms; c.sleeps.push(ms); await new Promise((r) => setImmediate(r)); c.t = Math.max(c.t, wake); }; // sleepers overlap, like real timers
  return c;
}

test('only https, only the three hosts, no port, no credentials', () => {
  for (const ok of ['https://onlinesys.necta.go.tz/results/2025/csee/index.htm', 'https://matokeo.necta.go.tz/', 'https://maktaba.tetea.org/exam-results/CSEE2021/csee.htm']) assert.doesNotThrow(() => checkUrl(ok), ok);
  for (const bad of ['http://onlinesys.necta.go.tz/x', 'https://example.com/x', 'https://onlinesys.necta.go.tz.evil.test/x', 'https://evil.test/onlinesys.necta.go.tz', 'https://user:pw@onlinesys.necta.go.tz/x', 'https://onlinesys.necta.go.tz:8443/x', 'file:///etc/passwd', 'not a url', 'https://www.necta.go.tz/results/view/csee']) {
    assert.throws(() => checkUrl(bad), FetchError, bad);
  }
  assert.deepEqual(Object.keys(HOSTS).sort(), ['maktaba.tetea.org', 'matokeo.necta.go.tz', 'onlinesys.necta.go.tz']);
});

test('defaults per host: NECTA 2 workers at 500 ms, the mirror 1 worker at 1000 ms', () => {
  assert.deepEqual(HOSTS['onlinesys.necta.go.tz'], { workers: 2, spacingMs: 500 });
  assert.deepEqual(HOSTS['matokeo.necta.go.tz'], { workers: 2, spacingMs: 500 });
  assert.deepEqual(HOSTS['maktaba.tetea.org'], { workers: 1, spacingMs: 1000 });
});

test('the request carries the importer user agent and nothing that is a cookie', async () => {
  const seen = [];
  const clock = fakeClock();
  const f = createFetcher({ fetchImpl: async (u, init) => { seen.push([String(u), init]); return okPage(); }, now: clock.now, sleep: clock.sleep });
  await f.get('https://onlinesys.necta.go.tz/a.htm', null);
  assert.equal(seen[0][1].headers['User-Agent'], USER_AGENT);
  assert.equal(seen[0][1].redirect, 'manual');
  assert.ok(!Object.keys(seen[0][1].headers).some((h) => /cookie/i.test(h)));
});

test('rate limiter spaces request starts across workers (fake clock)', async () => {
  const clock = fakeClock();
  const lim = new RateLimiter(500, { now: clock.now, sleep: clock.sleep });
  const starts = [];
  await Promise.all([1, 2, 3, 4, 5].map(async () => { await lim.acquire(); starts.push(clock.now()); }));
  starts.sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 500, `gap ${starts[i] - starts[i - 1]}`);
  lim.pauseUntil(clock.now() + 15000);
  const before = clock.now();
  await lim.acquire();
  assert.ok(clock.now() - before >= 15000);
});

test('the fetcher keeps the host spacing between request starts', async () => {
  const clock = fakeClock();
  const starts = [];
  const f = createFetcher({ fetchImpl: async () => { starts.push(clock.now()); return okPage(); }, now: clock.now, sleep: clock.sleep });
  await Promise.all(['a', 'b', 'c', 'd'].map((x) => f.get(`https://maktaba.tetea.org/${x}.htm`, null)));
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 1000);
  assert.equal(f.stats.byHost['maktaba.tetea.org'].requests, 4);
});

test('a redirect off the host is refused; one inside the host is followed', async () => {
  const clock = fakeClock();
  const calls = [];
  const redirect = (to) => new Response(null, { status: 302, headers: { location: to } });
  const f = createFetcher({
    fetchImpl: async (u) => { calls.push(String(u)); const s = String(u); return s.endsWith('/off') ? redirect('https://example.com/x') : s.endsWith('/http') ? redirect('http://onlinesys.necta.go.tz/y') : s.endsWith('/in') ? redirect('/final.htm') : okPage('final'); },
    now: clock.now, sleep: clock.sleep,
  });
  await assert.rejects(f.get('https://onlinesys.necta.go.tz/off', null), /off-host refused/);
  await assert.rejects(f.get('https://onlinesys.necta.go.tz/http', null), /off-host refused/);
  assert.ok(!calls.some((c) => c.includes('example.com')), 'the other host was never contacted');
  assert.equal((await f.get('https://onlinesys.necta.go.tz/in', null)).buf.toString(), 'final');
});

test('resume: a cached page is not requested again, even by a new fetcher', async () => {
  const dir = tmp('cache');
  try {
    const clock = fakeClock();
    let n = 0;
    const make = () => createFetcher({ fetchImpl: async () => { n++; return okPage('body ' + n); }, now: clock.now, sleep: clock.sleep });
    const file = cachePathFor(dir, 'results/p0101.htm');
    assert.ok(file.endsWith('results/p0101.htm.gz'));
    const a = await make().get('https://onlinesys.necta.go.tz/x/p0101.htm', file);
    assert.equal(a.cached, false);
    assert.equal(zlib.gunzipSync(fs.readFileSync(file)).toString(), 'body 1');
    const b = await make().get('https://onlinesys.necta.go.tz/x/p0101.htm', file);
    assert.equal(b.cached, true);
    assert.equal(b.buf.toString(), 'body 1');
    assert.equal(n, 1);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((x) => x.endsWith('.tmp')), []);
    assert.throws(() => cachePathFor(dir, '../outside.htm'), /bad cache path/);
    // a corrupt cache file is fetched again instead of crashing
    fs.writeFileSync(file, 'not gzip');
    assert.equal((await make().get('https://onlinesys.necta.go.tz/x/p0101.htm', file)).cached, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('5xx and 429 back off 15 s, 30 s, 60 s, 120 s, honour Retry-After, then give up', async () => {
  const clock = fakeClock();
  let n = 0;
  const f = createFetcher({ fetchImpl: async () => { n++; return new Response('x', { status: 503 }); }, now: clock.now, sleep: clock.sleep, spacing: 0 });
  await assert.rejects(f.get('https://onlinesys.necta.go.tz/a.htm', null), /HTTP 503/);
  assert.equal(n, 5, 'one try and four retries');
  assert.deepEqual(clock.sleeps.filter((s) => s >= 1000), [15000, 30000, 60000, 120000]);
  // Retry-After wins when it is longer; a good answer ends it
  const c2 = fakeClock();
  const answers = [new Response('x', { status: 429, headers: { 'retry-after': '90' } }), okPage('fine')];
  const f2 = createFetcher({ fetchImpl: async () => answers.shift(), now: c2.now, sleep: c2.sleep, spacing: 0 });
  assert.equal((await f2.get('https://onlinesys.necta.go.tz/a.htm', null)).buf.toString(), 'fine');
  assert.deepEqual(c2.sleeps.filter((s) => s >= 1000), [90000]);
  assert.equal(parseRetryAfter('120'), 120000);
  assert.equal(parseRetryAfter('garbage'), 0);
  assert.ok(parseRetryAfter(new Date(Date.now() + 30000).toUTCString()) > 20000);
});

test('a network error is retried; a 404 is final; a huge answer is refused', async () => {
  const clock = fakeClock();
  let n = 0;
  const f = createFetcher({
    fetchImpl: async (u) => {
      n++;
      if (String(u).endsWith('/net')) { if (n < 3) throw new TypeError('fetch failed'); return okPage('later'); }
      if (String(u).endsWith('/missing')) return new Response('no', { status: 404 });
      return new Response('x'.repeat(2000), { status: 200 });
    },
    now: clock.now, sleep: clock.sleep, spacing: 0, maxBytes: 1000,
  });
  assert.equal((await f.get('https://onlinesys.necta.go.tz/net', null)).buf.toString(), 'later');
  n = 0;
  const err = await f.get('https://onlinesys.necta.go.tz/missing', null).catch((e) => e);
  assert.equal(err.status, 404);
  assert.equal(err.retryable, false);
  assert.equal(n, 1);
  await assert.rejects(f.get('https://onlinesys.necta.go.tz/big', null), /too large/);
});

test('stop() ends a wait and refuses new requests', async () => {
  const f = createFetcher({ fetchImpl: async () => new Response('x', { status: 503 }), spacing: 0, backoffMs: 60000 });
  const p = f.get('https://onlinesys.necta.go.tz/a.htm', null);
  await new Promise((r) => setTimeout(r, 30));
  f.stop();
  await assert.rejects(p, StopError);
  await assert.rejects(f.get('https://onlinesys.necta.go.tz/b.htm', null), StopError);
});

// ---- the whole run, offline ----
function fakeSite(files, log) {
  return async (url) => {
    const u = String(url);
    log.push(u);
    const hit = files[u];
    if (hit === undefined) return new Response('not found', { status: 404 });
    if (hit instanceof Response) return hit.clone();
    return new Response(hit, { status: 200 });
  };
}
const link = (href, label) => `<TD><A HREF="${href}">${label}\n</A></TD>`;

test('a run writes centres, resumes without asking again, sends bad pages to the issues, and reports status', async () => {
  const work = tmp('run');
  try {
    const base = 'https://onlinesys.necta.go.tz/results/2025/csee/';
    const good = (code, rows = 2) => secondaryPage({ heading: `${code} ${code} SECONDARY SCHOOL`, cands: Array.from({ length: rows }, (_, i) => [`${code}/000${i + 1}`, 'F', '-', 'IV', "CIV - 'C' HIST - 'D'"]) });
    const files = {
      [base + 'index.htm']: `<HTML>${link('results\\p0101.htm', 'P0101 AZANIA CENTRE')}${link('results\\s5405.htm', 'S5405 LOWER SCHOOL')}${link('results\\s0001.htm', 'S0001 MISSING SCHOOL')}${link('results\\s0002.htm', 'S0002 BROKEN SCHOOL')}${link('results\\s0003.htm', 'S0003 DUPLICATE SCHOOL')}</HTML>`,
      [base + 'results/p0101.htm']: good('P0101'),
      [base + 'results/s5405.htm']: secondaryPage({ heading: 's5405 LOWER SECONDARY SCHOOL', cands: [['s5405/0001', 'F', '-', 'IV', "CIV - 'C'"]] }),
      [base + 'results/s0002.htm']: '<HTML><BODY>nothing useful</BODY></HTML>',
      [base + 'results/s0003.htm']: secondaryPage({ heading: 'S0003 DUP SCHOOL', cands: [['S0003/0001', 'F', '-', 'IV', "CIV - 'C'"], ['S0003/0001', 'F', '-', 'IV', "CIV - 'D'"]] }),
    };
    const log = [];
    const base_opts = { exam: 'csee-2025', workDir: work, legacyDir: null, delay: 0, workers: 2, fetchImpl: fakeSite(files, log), log: () => {} };
    const r = await runImport({ ...base_opts, limit: 2 });
    assert.equal(r.ok, 2);
    assert.deepEqual(fs.readdirSync(path.join(work, 'data/csee/2025')).sort(), ['p0101.json', 's5405.json']);
    const rec = JSON.parse(fs.readFileSync(path.join(work, 'data/csee/2025/s5405.json'), 'utf8'));
    assert.equal(rec.code, 'S5405');
    assert.equal(rec.candidates[0].cno, 'S5405/0001');
    assert.equal(rec.source, 'necta');
    assert.equal(rec.sourceUrl, base + 'results/s5405.htm');
    assert.equal(rec.indexName, 'LOWER SCHOOL');
    assert.ok(!('prem' in rec.candidates[0]));
    assert.equal(fs.existsSync(path.join(work, 'source/csee/2025/results/s5405.htm.gz')), true);

    const before = log.length;
    const r2 = await runImport(base_opts); // the rest
    assert.equal(r2.ok, 0);
    assert.equal(r2.failed, 3);
    assert.equal(log.slice(before).filter((u) => u.endsWith('index.htm')).length, 0, 'the index came from the cache');
    const total = log.length;
    const r3 = await runImport(base_opts);
    // 404 is permanent and skipped; the two unparseable pages come from the cache without a request
    assert.equal(log.length, total, 'nothing was requested again');
    assert.equal(r3.failed, 2);

    const st = JSON.parse(fs.readFileSync(path.join(work, 'status/csee-2025.json'), 'utf8'));
    assert.equal(st.total, 5);
    assert.equal(st.done, 2);
    assert.equal(st.failed, 3);
    assert.match(st.failedList.S0001.reason, /404/);
    assert.equal(st.failedList.S0001.permanent, true);
    assert.match(st.failedList.S0002.reason, /no centre heading/);
    assert.match(st.failedList.S0003.reason, /duplicate/);
    assert.equal(st.failedList.S0003.url, base + 'results/s0003.htm');
    const exam = JSON.parse(fs.readFileSync(path.join(work, 'exams/csee-2025.json'), 'utf8'));
    assert.equal(exam.status, 'partial');
    assert.equal(exam.stats.importedCentres, 2);
    assert.equal(exam.centres.length, 5);
    assert.deepEqual(exam.centres.filter((c) => c.imported).map((c) => c.code).sort(), ['P0101', 'S5405']);
    assert.ok(exam.issues.some((i) => i.startsWith('S0002:') && i.includes('results/s0002.htm')));
    const lines = statusLines(work);
    assert.match(lines[0], /^csee-2025\s+done 2\/5\s+failed 3 \(1 permanent\)/);
    assert.deepEqual(statusLines(path.join(work, 'nowhere')), ['No import has been run yet.']);
    assert.equal(fs.existsSync(path.join(work, 'status/csee-2025.lock')), false);

    // a page that was fixed upstream: --codes asks only for that one and overrides the permanent mark
    files[base + 'results/s0001.htm'] = good('S0001', 3);
    const log2 = log.length;
    const r4 = await runImport({ ...base_opts, codes: ['s0001'] });
    assert.equal(r4.ok, 1);
    assert.equal(log.length - log2, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(work, 'data/csee/2025/s0001.json'), 'utf8')).candidates.length, 3);
    assert.match(statusLines(work, 'csee-2025')[0], /done 3\/5/);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('--dry reads nothing from the network and writes nothing', async () => {
  const work = tmp('dry');
  try {
    const log = [];
    const r = await runImport({ exam: 'csee-2025', workDir: work, legacyDir: null, dry: true, fetchImpl: fakeSite({}, log), log: () => {} });
    assert.equal(r.indexCached, false);
    assert.equal(log.length, 0);
    assert.deepEqual(fs.readdirSync(work), []);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('PSLE walk on the mirror (flat links) and on NECTA (results/ links), without names or PREM numbers', async () => {
  for (const exam of ['psle-2021', 'psle-2025']) {
    const work = tmp('psle');
    try {
      const def = examDef(exam);
      const pre = def.host === 'maktaba.tetea.org' ? '' : 'results/';
      const regs = `${link(pre + 'reg_01.htm', 'ARUSHA')}${link(pre + 'reg_02.htm', 'DAR ES SALAAM')}`;
      const files = {
        [def.indexUrl]: `<HTML>${regs}</HTML>`,
        [def.baseDir + pre + 'reg_01.htm']: `<HTML>${link('distr_0101.htm', 'ARUSHA')}</HTML>`,
        [def.baseDir + pre + 'reg_02.htm']: `<HTML>${link('distr_0201.htm', 'ILALA')}</HTML>`,
        [def.baseDir + pre + 'distr_0101.htm']: `<HTML>${link('shl_ps0101001.htm', 'BANGATA PRIMARY SCHOOL - PS0101001')}${link('shl_ps0101002.htm', 'KIMANDOLU PRIMARY SCHOOL - PS0101002')}</HTML>`,
        [def.baseDir + pre + 'distr_0201.htm']: `<HTML>${link('shl_ps0201001.htm', 'ILALA PRIMARY SCHOOL - PS0201001')}${link('shl_ps0101001.htm', 'BANGATA PRIMARY SCHOOL - PS0101001')}</HTML>`,
        [def.baseDir + pre + 'shl_ps0101001.htm']: pslePage({ year: exam === 'psle-2021' ? 2021 : 2025, withName: exam === 'psle-2021', withPrem: true }),
        [def.baseDir + pre + 'shl_ps0201001.htm']: pslePage({ year: 2025, withName: false, withPrem: true }).replace(/PS0101001/g, 'PS0201001'),
      };
      const log = [];
      const r = await runImport({ exam, workDir: work, legacyDir: null, delay: 0, fetchImpl: fakeSite(files, log), log: () => {} });
      assert.equal(r.ok, 2);
      assert.equal(r.failed, 1); // ps0101002 is not on the fake site
      const ex = JSON.parse(fs.readFileSync(path.join(work, 'exams', exam + '.json'), 'utf8'));
      assert.equal(ex.centres.length, 3);
      assert.deepEqual(ex.centres.map((c) => [c.code, c.region, c.district, c.imported]), [['PS0101001', 'ARUSHA', 'ARUSHA', true], ['PS0101002', 'ARUSHA', 'ARUSHA', false], ['PS0201001', 'DAR ES SALAAM', 'ILALA', true]]);
      assert.ok(ex.issues.some((i) => i.includes('duplicate school PS0101001')));
      const out = fs.readFileSync(path.join(work, 'data/psle', String(def.year), 'ps0101001.json'), 'utf8');
      for (const n of [...NAMES, ...PREMS]) assert.ok(!out.includes(n));
      const rec = JSON.parse(out);
      assert.equal(rec.region, 'ARUSHA');
      assert.equal(rec.source, def.source);
      assert.equal(rec.sourceUrl, def.baseDir + pre + 'shl_ps0101001.htm');
      // the whole work folder (raw pages included) holds no name or PREM that the parser dropped... raw pages are the
      // published source, so only the parsed data is checked
      for (const f of fs.readdirSync(path.join(work, 'data/psle', String(def.year)))) {
        const t = fs.readFileSync(path.join(work, 'data/psle', String(def.year), f), 'utf8');
        for (const n of [...NAMES, ...PREMS]) assert.ok(!t.includes(n));
      }
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  }
});

test('exam table, command line options and the results-data packer reading the work folder', () => {
  assert.equal(examDef('csee-2021').indexUrl, 'https://maktaba.tetea.org/exam-results/CSEE2021/csee.htm');
  assert.equal(examDef('csee-2022').indexUrl, 'https://onlinesys.necta.go.tz/results/2022/csee/index.htm');
  assert.equal(examDef('acsee-2022').indexUrl, 'https://maktaba.tetea.org/exam-results/ACSEE2022/index.htm');
  assert.equal(examDef('psle-2020').indexUrl, 'https://maktaba.tetea.org/exam-results/PSLE2020/psle.htm');
  assert.equal(examDef('psle-2025').indexUrl, 'https://onlinesys.necta.go.tz/results/2025/psle/psle.htm');
  assert.equal(examDef('acsee-2026').host, 'matokeo.necta.go.tz');
  assert.equal(examDef('psle-2026').indexUrl, 'https://matokeo.necta.go.tz/results/2026/psle/psle.htm');
  assert.throws(() => examDef('csee-1999'), /Unknown exam/);
  assert.ok(EXAM_IDS.includes('psle-2023'));
  const o = parseArgs(['--exam', 'csee-2023', '--codes', 's0195,S5405', '--limit', '5', '--workers', '1', '--delay', '800', '--dry']);
  assert.deepEqual([o.exam, o.codes, o.limit, o.workers, o.delay, o.dry], ['csee-2023', ['S0195', 'S5405'], 5, 1, 800, true]);
  assert.throws(() => parseArgs(['--codes', 'x;y']), /Bad centre code/);
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
});

test('dropForeignTail keeps a school\'s own candidates and drops another school\'s numbers appended at the end', () => {
  const def = examDef('psle-2017');
  const mk = (nos) => ({ code: 'PS0904084', candidates: nos.map((cno) => ({ cno })), issues: [] });
  const r = dropForeignTail(def, 'PS0904084', mk(['PS0904084-001', 'PS0904084-002', 'PS0904102-001', 'PS0904102-002', 'PS0904102-003']));
  assert.deepEqual(r.candidates.map((c) => c.cno), ['PS0904084-001', 'PS0904084-002']);
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0], /dropped 3 candidate\(s\).*PS0904102/);
  assert.equal(validateCentre(def, 'PS0904084', r), null);
  // a foreign number in the middle, no own candidate, or nothing foreign: untouched (and still an error where it was one)
  const mid = dropForeignTail(def, 'PS0904084', mk(['PS0904084-001', 'PS0904102-001', 'PS0904084-002']));
  assert.equal(mid.candidates.length, 3);
  assert.ok(validateCentre(def, 'PS0904084', mid).includes('does not start with'));
  const none = dropForeignTail(def, 'PS0904084', mk(['PS0904102-001']));
  assert.equal(none.candidates.length, 1);
  const clean = dropForeignTail(def, 'PS0904084', mk(['PS0904084-001']));
  assert.deepEqual(clean.issues, []);
});

test('junkBody spots blank answers and the CDN error page, never a real results page', async () => {
  const { junkBody } = await import('../lib/necta-fetch.mjs');
  assert.equal(junkBody(Buffer.from('\n\n\n\n\n\n')), true);
  assert.equal(junkBody(Buffer.from('<!DOCTYPE html><head><title>Website is offline - Gateway time-out</title></head>')), true);
  assert.equal(junkBody(Buffer.from('<HTML><BODY><H3>CSEE 2003 EXAMINATION RESULTS FOR P0507</H3><TABLE></TABLE></BODY></HTML>')), false);
});
