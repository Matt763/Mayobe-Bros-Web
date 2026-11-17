// The results app: its pure search and address helpers (js/results-app.js) and the static shell (scripts/lib/results-app.mjs).
//   node --no-warnings --test scripts/tests/results-app.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as app from '../../js/results-app.js';
import { resultsAppHtml, examFromPost } from '../lib/results-app.mjs';
import { escapeHtml } from '../lib/markdown.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('norm: capitals, accents, apostrophes and punctuation', () => {
  assert.equal(app.norm("  MARY'S  Girls "), 'marys girls');
  assert.equal(app.norm('St. Mary’s'), 'st marys');
  assert.equal(app.norm('École'), 'ecole');
  assert.equal(app.norm('P0101/0001'), 'p0101 0001');
  assert.equal(app.norm(null), '');
  assert.deepEqual(app.tokens('marys  girls'), ['marys', 'girls']);
});

test('"marys" finds MARY\'S, and every word must match', () => {
  const rows = app.prepRows([['S1', "MARY'S GIRLS SECONDARY", 1], ['S2', 'MARY HILL', 1], ['S3', 'ST MARYS BOYS', 1]]);
  const hit = (q) => app.baseFilter(rows, { q, code: '', cand: '', letter: '' }).map((r) => r.code);
  assert.deepEqual(hit('marys'), ['S1', 'S3']);
  assert.deepEqual(hit('mary girls'), ['S1']);
  assert.deepEqual(hit('zzz'), []);
  assert.deepEqual(hit(''), ['S1', 'S2', 'S3']);
});

test('prepRows: region and district are searchable, letters are filed', () => {
  const rows = app.prepRows([['PS0101001', 'BANGATA PRIMARY SCHOOL', 1, 'ARUSHA', 'MERU'], ['PS1', '12 STAR', 0]]);
  assert.equal(rows[0].L, 'B');
  assert.equal(rows[1].L, '#');
  assert.equal(rows[1].has, false);
  assert.equal(app.baseFilter(rows, { q: 'meru', code: '', cand: '', letter: '' }).length, 1);
  assert.equal(app.letterCounts(rows).B, 1);
  assert.equal(app.letterCounts(rows)['#'], 1);
});

test('candidate numbers: code, sequence, leading zeros, year tail', () => {
  assert.deepEqual(app.parseCandidate('P0101'), { code: 'P0101', seq: null });
  assert.deepEqual(app.parseCandidate('p0101/0001'), { code: 'P0101', seq: '0001' });
  assert.deepEqual(app.parseCandidate('S0134-0001/2023'), { code: 'S0134', seq: '0001' });
  assert.deepEqual(app.parseCandidate('P0101 0001'), { code: 'P0101', seq: '0001' });
  assert.deepEqual(app.parseCandidate('PS0101114-0'), { code: 'PS0101114', seq: '0' });
  assert.deepEqual(app.parseCandidate('P0101/'), { code: 'P0101', seq: null });
  assert.equal(app.parseCandidate('azania'), null);
  assert.equal(app.parseCandidate(''), null);
  assert.ok(app.sameSeq('0001', '1'));
  assert.ok(!app.sameSeq('0001', '2'));
  assert.equal(app.seqOf('P0101/0001'), '0001');
  assert.equal(app.seqOf('PS0101114-0042'), '0042');
});

test('candidate field: a sequence picks one centre, a bare code is a prefix', () => {
  const rows = app.prepRows([['P0101', 'A', 1], ['P0104', 'B', 1], ['P01', 'C', 1]]);
  const f = (cand) => app.baseFilter(rows, { q: '', code: '', cand, letter: '' }).map((r) => r.code);
  assert.deepEqual(f('P0101/0001'), ['P0101']);
  assert.deepEqual(f('P010'), ['P0101', 'P0104']);
  assert.deepEqual(f('p0104'), ['P0104']);
});

test('pager window and page clamp', () => {
  assert.deepEqual(app.pagerWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(app.pagerWindow(1, 33), [1, 2, 3, 'gap', 33]);
  assert.deepEqual(app.pagerWindow(17, 33), [1, 'gap', 15, 16, 17, 18, 19, 'gap', 33]);
  assert.deepEqual(app.pagerWindow(33, 33), [1, 'gap', 31, 32, 33]);
  assert.equal(app.pageCount(0), 1);
  assert.equal(app.pageCount(200), 1);
  assert.equal(app.pageCount(201), 2);
  assert.equal(app.clampPage(99, 5), 5);
  assert.equal(app.clampPage(-3, 5), 1);
  assert.equal(app.clampPage(NaN, 5), 1);
});

test('address: reads its own keys, keeps every other parameter, writes in a fixed order', () => {
  const r = app.readRoute('?utm=1&q=moshi&letter=m&p=3&cand=P0101%2F0001');
  assert.deepEqual(r, { view: 'exam', q: 'moshi', code: '', cand: 'P0101/0001', letter: 'M', p: 3 });
  const c = app.readRoute('?centre=p0101&cq=0001&grade=none&cno=0003&utm=1', 'secondary');
  assert.equal(c.view, 'centre');
  assert.equal(c.centre, 'P0101');
  assert.equal(c.grade, 'Not graded');
  assert.equal(c.cno, '0003');
  assert.equal(app.readRoute('?centre=<script>').view, 'exam');
  assert.equal(app.readRoute('?p=-5&letter=%3C').p, 1);
  assert.equal(app.readRoute('?letter=%3C').letter, '');
  assert.equal(app.buildSearch('?utm=1&q=old&centre=P1&cno=2', { q: 'new', p: 2 }), '?utm=1&q=new&p=2');
  assert.equal(app.buildSearch('?utm=1&q=old', {}), '?utm=1');
  assert.equal(app.buildSearch('?q=old', { q: '' }), '');
});

test('highlight ranges follow the same rules as the search', () => {
  assert.deepEqual(app.highlightRanges("MARY'S GIRLS", ['marys']), [[0, 6]]);
  assert.deepEqual(app.highlightRanges('P0101/0001', ['0001']), [[6, 10]]);
  assert.deepEqual(app.highlightRanges('ABC', []), []);
  assert.deepEqual(app.highlightRanges('MOSHI CENTRE', ['mo', 'oshi']), [[0, 5]]);
});

test('candidates: groups, order, filters', () => {
  const list = [
    { cno: 'P0101/0001', sex: 'F', aggt: '-', div: 'IV', subjects: [['PHY', 'F'], ['CHEM', 'C']] },
    { cno: 'P0101/0002', sex: 'M', aggt: '20', div: 'II', subjects: [['PHY', 'B']] },
    { cno: 'P0101/0003', sex: 'M', aggt: '-', div: 'ABS', subjects: [] },
    { cno: 'P0101/0004', sex: 'F', aggt: '-', div: '', subjects: [], note: '*W' },
  ];
  const items = app.prepCandidates(list, 'secondary');
  assert.deepEqual(items.map((i) => i.key), ['IV', 'II', 'ABS', 'Not graded']);
  assert.deepEqual(app.groupOrder(app.groupCounts(items).keys(), 'secondary'), ['II', 'IV', 'ABS', 'Not graded']);
  assert.equal(app.filterCandidates(items, { cq: '0002' }).length, 1);
  assert.equal(app.filterCandidates(items, { cq: 'phy' }).length, 2);
  assert.equal(app.filterCandidates(items, { grade: 'Not graded' })[0].c.note, '*W');
  assert.equal(app.filterCandidates(items, { cq: 'phy', grade: 'II' }).length, 1);
  const kids = app.prepCandidates([{ cno: 'PS1-0001', sex: 'F', grade: 'B', subjects: [['Kiswahili', 'B']] }], 'primary');
  assert.equal(kids[0].key, 'B');
  assert.deepEqual(app.groupOrder(['C', 'A', 'Not graded', 'B'], 'primary'), ['A', 'B', 'C', 'Not graded']);
});

/* ---- the static shell ---- */

const ctx = (over = {}) => ({
  u: (p) => p, e: escapeHtml,
  dataset: { total: 6536, online: 6534, verified: '2026-11-09' }, verified: '2026-11-09', cacheKey: 'k1',
  siblings: [{ label: '2025', href: '/a/', current: false, hasData: false }, { label: '2024', href: '/b/', current: true }, { label: '2023', href: '/c/', current: false }],
  crumbs: [{ name: 'Home', href: '/' }, { name: 'Results', href: '/r/' }, { name: 'CSEE', href: '/r/csee/' }, { name: '2024', href: '#' }],
  official: 'https://onlinesys.necta.go.tz/results/2024/csee/index.htm', ...over,
});
const shell = (slug, over) => resultsAppHtml({ slug }, ctx(over));

test('shell: root contract, one h1, no inline script, no style attribute, no blog classes', () => {
  const html = shell('necta-csee-results-2024');
  assert.match(html, /^<div class="rs" data-rs data-state="ready" data-exam="csee-2024" data-cat="csee" data-year="2024" data-kind="secondary" data-base="\/results-data" data-path="[^"]+"/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.doesNotMatch(html, /<script|\sstyle=|\son[a-z]+=/i);
  assert.doesNotMatch(html, /class="([^"]* )?(hero|pagination|wrap|section|post)[ "]/);
  assert.doesNotMatch(html, /<article/);
  assert.ok(!/data-cookie-settings/.test(html), 'the site footer carries the cookie button');
  assert.match(html, /<noscript>/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /6,536/);
  assert.match(html, /not run or endorsed by NECTA|not run, approved or endorsed by NECTA/);
  assert.match(html, /2026-11-09/);
});

test('shell: every input has a real label, ids are unique', () => {
  for (const slug of ['necta-csee-results-2024', 'necta-psle-results-2023']) {
    const html = shell(slug);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${slug}`);
    const inputs = [...html.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(inputs.length, 4);
    for (const id of inputs) assert.match(html, new RegExp(`<label for="${id}">`), `no label for ${id}`);
  }
});

test('shell: PSLE says schools and school number, secondary says centres', () => {
  const p = shell('necta-psle-results-2023', { dataset: { total: 18316, online: 18299, verified: '2026-11-09' } });
  assert.match(p, /School name/);
  assert.match(p, /School number/);
  assert.match(p, /data-kind="primary"/);
  assert.match(p, /Swahili/);
  assert.doesNotMatch(p, /Centre number/);
  const s = shell('necta-csee-results-2024');
  assert.match(s, /School or centre name/);
  assert.match(s, /Centre number/);
  assert.match(s, /Candidate number/);
  assert.doesNotMatch(s, /School number/);
});

test('shell: other years list leaves out the current year', () => {
  const html = shell('necta-csee-results-2024');
  const years = html.match(/<nav class="rs-years"[\s\S]*?<\/nav>/)[0];
  assert.match(years, /2025/);
  assert.match(years, /2023/);
  assert.doesNotMatch(years, />2024</);
});

test('shell: no data means an honest statement, the official link, no list and no tools', () => {
  const siblings = [{ label: '2025', href: '/a/', current: true }, { label: '2024', href: '/b/', current: false }, { label: '2023', href: '/c/', current: false }];
  const html = shell('necta-csee-results-2025', { dataset: null, official: null, siblings });
  assert.match(html, /data-state="nodata"/);
  assert.match(html, /not on this site/);
  assert.match(html, /https:\/\/onlinesys\.necta\.go\.tz\//);
  assert.doesNotMatch(html, /data-rs-list|data-rs-az|<input|data-rs-stage/);
  assert.doesNotMatch(html, /coming soon/i);
  assert.match(html, /Results we do have for CSEE: <a href="\/b\/">2024<\/a>, <a href="\/c\/">2023<\/a>/);
  assert.ok(!/data-cookie-settings/.test(html), 'the site footer carries the cookie button');
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
});

test('shell: pending data says it is being added, keeps the official link, is not a coming-soon page, and unavailable stays plain', () => {
  const siblings = [{ label: '2012', href: '/a/', current: true }, { label: '2020', href: '/b/', current: false }];
  const html = shell('necta-psle-results-2012', { dataset: null, pending: true, official: null, siblings });
  assert.match(html, /data-state="nodata" data-pending="1"/);
  assert.match(html, /being added/);
  assert.doesNotMatch(html, /not on this site|coming soon/i);
  assert.match(html, /https:\/\/onlinesys\.necta\.go\.tz\//);
  assert.match(html, /We are preparing the PSLE 2012 schools/);
  assert.doesNotMatch(html, /data-rs-list|<input|data-rs-stage/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  const plain = shell('necta-psle-results-2012', { dataset: null, pending: false, official: null, siblings });
  assert.match(plain, /not on this site/);
  assert.doesNotMatch(plain, /data-pending/);
});

test('shell: everything from the context is escaped', () => {
  const html = shell('necta-csee-results-2024', { verified: '"><img src=x>', official: 'https://x.test/"><b>', crumbs: [{ name: '<b>Home</b>', href: '/"x' }, { name: '2024', href: '#' }], siblings: [{ label: '<i>25</i>', href: '/a"b', current: false }] });
  assert.doesNotMatch(html, /<img src=x>|<b>Home|<i>25<\/i>|"><b>/);
  assert.throws(() => resultsAppHtml({ slug: 'some-other-post' }, ctx()));
  assert.equal(examFromPost({ slug: 'necta-acsee-results-2023' }).CAT, 'ACSEE');
});

test('shell: every results post builds', () => {
  for (const c of ['csee', 'acsee', 'psle']) for (const y of [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2010, 2003]) assert.ok(shell(`necta-${c}-results-${y}`).includes(`data-exam="${c}-${y}"`));
});

/* ---- the files ---- */

test('css: every selector sits under .rs or starts with .rs-, no bare element rules, unique rs- keyframes, no style leaks', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/results.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  const selectors = [...blocks.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((s) => !/^(from|to|\d+%)/.test(s));
  assert.ok(selectors.length > 100);
  for (const sel of selectors) for (const part of sel.split(/,(?![^(]*\))/)) {
    const p = part.trim();
    if (!p) continue;
    assert.match(p, /^(:where\(\.rs\)|a\.rs-|html:not\(\.js\) \.rs-|:root(\.dark|:not\(\.light\))? \.rs|:root(\.dark|:not\(\.light\))? \.rs-|\.rs)/, `selector outside .rs: ${p}`);
  }
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.ok(names.every((n) => n.startsWith('rs-')));
  assert.equal(new Set(names).size, names.length);
  assert.doesNotMatch(css, /\bscroll-behavior:\s*smooth/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@font-face/); // same system fonts as the rest of the site
  for (const m of css.matchAll(/animation:[^;]*?\b([\w-]+)\b[^;]*;/g)) void m;
  const anim = css.match(/@keyframes rs-shimmer\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(anim, /width|height|margin|top|left/);
});

test('js: no inline markup from data, no timers that navigate, no native smooth scroll, visitor words follow the house style', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/results-app.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1').replace(/^const APOS = .*$/m, '');
  assert.doesNotMatch(code, /\.innerHTML\s*=(?!=)(?![^;]*['"`]<svg)/);
  assert.doesNotMatch(code, /insertAdjacentHTML|document\.write|eval\(|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(code, /behavior:\s*['"]smooth|scrollIntoView|location\.assign|location\.href\s*=/);
  assert.doesNotMatch(code, /e\.key === ['"]\/['"]/);
  const bad = /\bsorry\b|\boops\b|\bplease\b|[a-z]!(\s|$)|\bserver\b|\bAPI\b|JSON|network error|timeout|\bHTTP\b|\bstatus code\b|\btoken\b/i;
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) if (m[1].length >= 8 && / /.test(m[1])) assert.doesNotMatch(m[1], bad, m[1]);
  for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) if (!/\.json/.test(m[1])) assert.doesNotMatch(m[1], bad, m[1]);
});

/* ---- review fixes ---- */

test('source links: only https on necta.go.tz', () => {
  assert.equal(app.safeNectaUrl('https://onlinesys.necta.go.tz/results/2024/csee/results/p0101.htm'), 'https://onlinesys.necta.go.tz/results/2024/csee/results/p0101.htm');
  assert.equal(app.safeNectaUrl('https://necta.go.tz/'), 'https://necta.go.tz/');
  for (const bad of ['javascript:alert(1)', 'http://necta.go.tz/', 'https://evil.test/necta.go.tz', 'https://necta.go.tz.evil.test/', 'https://notnecta.go.tz/', 'data:text/html,x', '', null, 'not a url']) assert.equal(app.safeNectaUrl(bad), '', String(bad));
});

test('back is used to close a centre only when this document made the entry before it', () => {
  assert.ok(app.backIsSafe({ from: 'list', doc: 'a' }, 'a'));
  assert.ok(!app.backIsSafe({ from: 'list', doc: 'a' }, 'b'), 'after a reload the document id changes');
  assert.ok(!app.backIsSafe(null, 'a'));
  assert.ok(!app.backIsSafe({ rs: 1, doc: 'a' }, 'a'));
});

test('the router ignores a change of the hash alone (skip link)', () => {
  assert.equal(app.routeKey({ pathname: '/p/', search: '?q=a', hash: '#main' }), app.routeKey({ pathname: '/p/', search: '?q=a', hash: '' }));
  assert.notEqual(app.routeKey({ pathname: '/p/', search: '?q=a' }), app.routeKey({ pathname: '/p/', search: '?q=b' }));
});

test('shell: the data address comes from the renderer, with a base-path fallback', () => {
  assert.match(shell('necta-csee-results-2024', { dataBase: 'https://data.example.test/rd' }), /data-base="https:\/\/data\.example\.test\/rd"/);
  assert.match(shell('necta-csee-results-2024', { u: (p) => '/site' + p }), /data-base="\/site\/results-data"/);
  assert.match(shell('necta-csee-results-2024', { dataBase: '"><x' }), /data-base="&quot;&gt;&lt;x"/);
});

test('js: a stale fade never changes the view, Enter flushes the search, the codec carries the data key, Not graded has real text', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/results-app.js'), 'utf8');
  assert.match(src, /async function swap\(no, animate[\s\S]*?if \(no !== routeNo\) return false;[\s\S]*?change\(\);/);
  assert.match(src, /if \(el === inputs\.cand\) runExam\.now\(\)/);
  assert.match(src, /import\('\.\/results-codec\.js' \+ ver\)/);
  // data contract v3: the list for the exam page, meta.json plus one text file for a centre (never the list), no v2 names left
  assert.match(src, /\/list\.json\$\{ver\}/);
  assert.match(src, /\/meta\.json\$\{ver\}/);
  assert.match(src, /\/\$\{key\}\.txt\$\{ver\}/);
  assert.match(src, /codec\.decodeList\(/);
  assert.match(src, /codec\.decodeCentre\(text, meta, /);
  assert.doesNotMatch(src, /index\.json|\.json\$\{ver\}`, true/);
  assert.doesNotMatch(src.slice(src.indexOf('async function loadCentre'), src.indexOf('/* ---- small pieces')), /loadIndex\(\)/);
  assert.match(src, /class: 'rs-sr' \}, NOT_GRADED/);
  assert.doesNotMatch(src, /setAttribute\('aria-label', NOT_GRADED\)/);
  assert.match(src, /cell\('rs-c rs-c-div', P\.divShort, pill\)/);
  assert.match(src, /cell\('rs-c rs-c-div', 'Average grade', pill\)/);
});

test('css: breadcrumbs reach 44px on touch and the ghost button hover keeps its contrast', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/results.css'), 'utf8');
  assert.match(css, /@media \(pointer: coarse\) \{[^@]*\.rs-crumbs a \{[^}]*min-height: 44px/);
  assert.match(css, /\.rs-btn--ghost:hover \{[^}]*color: var\(--rs-fill-strong\)/);
});

/* ---- the other examinations: words, columns, examples ---- */

test('profileOf: GPA, class words, results, units and examples per exam', () => {
  const p = (cat, kind, meta, year) => app.profileOf(cat, meta || null, kind || 'secondary', year);
  const csee = p('csee');
  assert.deepEqual([csee.unit, csee.aggtHead, csee.divHead, csee.divName, csee.roman, csee.cno], ['centre', 'AGGT', 'DIV', 'Division', true, 'P0134/0001']);
  const c14 = p('csee', 'secondary', null, 2014);
  assert.deepEqual([c14.gpa, c14.aggtHead, c14.divHead, c14.divName, c14.words[0]], [true, 'GPA', 'CLASS', 'Class', 'DISTINCTION']);
  assert.equal(p('acsee', 'secondary', null, 2015).aggtHead, 'GPA');
  assert.equal(p('acsee', 'secondary', null, 2016).aggtHead, 'AGGT');
  assert.equal(p('csee', 'secondary', { gs: 10, dw: ['DISTINCTION', 'MERIT', 'CREDIT', 'PASS', 'FAIL'], dp: 4 }, 2025).aggtName, 'GPA', 'meta decides when it is there');
  for (const cat of ['dsee', 'dpee', 'dppee', 'dspee', 'dte']) {
    const d = p(cat);
    assert.deepEqual([d.unit, d.gpa, d.divName, d.divHead, d.cno, d.codeLabel], ['college', true, 'Result', 'RESULT', 'E0501/0001', 'College number'], cat);
  }
  const qt = p('qt');
  assert.deepEqual([qt.unit, qt.noSubjects, qt.divName, qt.cno, qt.words], ['centre', true, 'Result', 'M0104/0001', ['PASSED', 'FAILED']]);
  const ftna = p('ftna');
  assert.deepEqual([ftna.cno, ftna.roman, ftna.words.includes('REFERRED')], ['S0101/0001', true, true]);
  const sfna = p('sfna', 'primary');
  assert.deepEqual([sfna.unit, sfna.units, sfna.divName, sfna.cno, sfna.nameLabel], ['school', 'schools', 'Average grade', 'PS0101114-0001', 'School name']);
  assert.equal(p('psle', 'primary').cno, 'PS0101114-0001');
});

test('result keys: QT results, FTNA absentees, SFNA referred, and chip labels', () => {
  const qt = app.profileOf('qt', null, 'secondary');
  assert.equal(app.gradeKey({ cno: 'M0104/0001', sex: 'F', aggt: '-', div: 'PASSED', note: '' }, 'secondary', qt), 'PASSED');
  assert.equal(app.gradeKey({ cno: 'M0104/0002', sex: 'F', aggt: '-', div: '*W', note: 'Results held back' }, 'secondary', qt), '*W');
  assert.equal(app.gradeKey({ cno: 'S0101/0001', sex: 'F', aggt: '-', div: '-', note: 'ABS', subjects: [] }, 'secondary', app.profileOf('ftna', null, 'secondary')), 'ABS');
  assert.equal(app.gradeKey({ cno: 'S0101/0002', sex: 'F', aggt: '*W', div: '*W', note: 'Results Nullified' }, 'secondary', app.profileOf('ftna', null, 'secondary')), 'Not graded');
  assert.equal(app.gradeKey({ cno: 'PS1-0001', sex: 'F', note: 'KISWAHILI - D AVERAGE GRADE - REFERRED' }, 'primary'), 'Referred');
  assert.equal(app.gradeKey({ cno: 'PS1-0002', sex: 'F', note: '*R' }, 'primary'), 'Not graded');
  const ftna = app.profileOf('ftna', null, 'secondary');
  assert.deepEqual(app.groupOrder(['REFERRED', '0', 'ABS', 'II', 'Not graded'], 'secondary', ftna), ['II', '0', 'REFERRED', 'ABS', 'Not graded']);
  assert.deepEqual(app.groupOrder(['Referred', 'B', 'A'], 'primary', app.profileOf('sfna', null, 'primary')), ['A', 'B', 'Referred']);
  assert.equal(app.chipLabel('II', ftna), 'Div II');
  assert.equal(app.chipLabel('REFERRED', ftna), 'REFERRED');
  assert.equal(app.chipLabel('PASS', app.profileOf('dsee', null, 'secondary')), 'PASS');
  assert.equal(app.chipLabel('B', app.profileOf('psle', null, 'primary')), 'Grade B');
  assert.equal(app.chipLabel('Referred', app.profileOf('sfna', null, 'primary')), 'Referred');
});

test('NECTA’s "Avarage Grade" is shown as Average Grade', () => {
  assert.equal(app.subjectLabel('Avarage Grade'), 'Average Grade');
  assert.equal(app.subjectLabel('AVARAGE GRADE'), 'AVERAGE GRADE');
  assert.equal(app.subjectLabel('Kiswahili'), 'Kiswahili');
});

test('candidate numbers with a dash or a slash are read for every exam', () => {
  for (const [q, code, seq] of [['E0501/0001', 'E0501', '0001'], ['e0501-0001', 'E0501', '0001'], ['M0104 0007', 'M0104', '0007'], ['S0101/0001/2025', 'S0101', '0001'], ['PS0101114-0001', 'PS0101114', '0001'], ['ps0101114/0001', 'PS0101114', '0001']]) {
    assert.deepEqual(app.parseCandidate(q), { code, seq }, q);
  }
  assert.equal(app.seqOf('E0501-0001'), '0001');
  assert.equal(app.seqOf('E0501/0001'), '0001');
});

test('shell: each exam shows its own units, placeholders and reading notes', () => {
  const expect = {
    'necta-dsee-results-2025': [/College name/, /e\.g\. E0501\/0001/, /<strong>GPA<\/strong>/, /Butimba/],
    'necta-dte-results-2019': [/College number/, /e\.g\. E0501/],
    'necta-qt-results-2023': [/Centre number/, /e\.g\. M0104\/0001/, /<strong>PASSED<\/strong> or <strong>FAILED<\/strong>/, /lists no subject grades/],
    'necta-ftna-results-2025': [/e\.g\. S0101\/0001/, /REFERRED/],
    'necta-sfna-results-2025': [/School name/, /e\.g\. PS0101114-0001/, /marked Referred/],
    'necta-csee-results-2014': [/<strong>GPA<\/strong>/, /<strong>Class<\/strong>: DISTINCTION, MERIT, CREDIT, PASS, FAIL/],
    'necta-acsee-results-2015': [/<strong>GPA<\/strong>/],
    'necta-csee-results-2025': [/<strong>Aggt<\/strong>/, /<strong>Div<\/strong>/, /e\.g\. P0134\/0001/],
  };
  for (const [slug, res] of Object.entries(expect)) {
    const html = shell(slug);
    for (const re of res) assert.match(html, re, `${slug} ${re}`);
    assert.doesNotMatch(html, /<script|\sstyle=/i, slug);
  }
  assert.doesNotMatch(shell('necta-qt-results-2023'), /Aggt|DETAILED/);
  assert.doesNotMatch(shell('necta-dsee-results-2025'), /centres listed/i);
});

/* ---- statistic cards, search tabs, centre rows ---- */

test('statCardsHtml: icon cards, dl semantics, date numerals, no icon still renders, escaped', async () => {
  const { statCardsHtml, centreRowHtml } = await import('../lib/results-app.mjs');
  const html = statCardsHtml([{ label: 'Centres listed', value: '6,536', icon: 'school' }, { label: 'Last verified', value: '2026-11-10', icon: 'calendar-check' }, { label: '<b>x</b>', value: '1' }, null], escapeHtml, ' data-rs-stats');
  assert.match(html, /^<dl class="rs-stats" data-rs-stats>/);
  assert.equal((html.match(/<div class="rs-stat/g) || []).length, 3);
  assert.match(html, /<dt><span class="rs-stat-ico" aria-hidden="true"><svg[^>]*stroke-width="2"/);
  assert.match(html, /<div class="rs-stat rs-stat--date"><dt>[\s\S]*?<dd>2026-11-10<\/dd>/);
  assert.match(html, /<div class="rs-stat"><dt><span class="rs-stat-label">&lt;b&gt;x&lt;\/b&gt;<\/span><\/dt><dd>1<\/dd>/);
  assert.doesNotMatch(html, /<span class="rs-stat-ico"[^>]*><\/span>|\sstyle=|<script/);
  const row = centreRowHtml({ href: '/r/p0101/2024/', code: 'P0101', name: 'A <i>B</i>', meta: 'CSEE 2024' }, escapeHtml);
  assert.match(row, /^<li><a class="rs-row" href="\/r\/p0101\/2024\/"><span class="rs-row-ico" aria-hidden="true"><svg/);
  assert.match(row, /rs-row-code rs-mono">P0101<\/span><span class="rs-row-name">A &lt;i&gt;B&lt;\/i&gt;<small>CSEE 2024<\/small><\/span><svg class="rs-ico rs-row-go"/);
  const quiet = centreRowHtml({ code: 'P1', name: 'Q', meta: 'No results on this site' }, escapeHtml);
  assert.match(quiet, /^<li><div class="rs-row is-muted"><span class="rs-row-ico"/);
  assert.doesNotMatch(quiet, /<a |rs-row-go/);
});

test('shell: stat cards follow the data (unit word, no third card without a date) and the tabs are real tabs', () => {
  const html = shell('necta-psle-results-2023', { dataset: { total: 18316, online: 18299 }, verified: '' });
  assert.match(html, /<dl class="rs-stats" data-rs-stats>/);
  assert.match(html, /<dt>[\s\S]*?Schools listed<\/span><\/dt><dd>18,316<\/dd>/);
  assert.equal((html.match(/class="rs-stat[ "]/g) || []).length, 2);
  const full = shell('necta-dsee-results-2020');
  assert.match(full, /Colleges listed/);
  assert.equal((full.match(/class="rs-stat[ "]/g) || []).length, 3);
  assert.match(full, /Search by <\/span><span class="rs-tab-what">college</);
  assert.match(shell('necta-csee-results-2024'), /rs-tab-what">school or centre</);
  const h = shell('necta-csee-results-2024');
  assert.match(h, /role="tablist"/);
  assert.equal((h.match(/role="tab"\s/g) || []).length, 2);
  assert.equal((h.match(/role="tabpanel"/g) || []).length, 2);
  assert.match(h, /id="rs-tab-name" aria-selected="true" aria-controls="rs-pane-name" tabindex="0"/);
  assert.match(h, /id="rs-tab-cand" aria-selected="false" aria-controls="rs-pane-cand" tabindex="-1"/);
  assert.match(h, /id="rs-pane-name" aria-labelledby="rs-tab-name"/);
  assert.match(h, /id="rs-pane-cand" aria-labelledby="rs-tab-cand"/);
  // the A to Z bar belongs to the school tab, the candidate field to the other
  const name = h.slice(h.indexOf('id="rs-pane-name"'), h.indexOf('id="rs-pane-cand"'));
  assert.match(name, /data-rs-in="q"[\s\S]*data-rs-in="code"[\s\S]*data-rs-az/);
  assert.doesNotMatch(name, /data-rs-in="cand"/);
  assert.match(h.slice(h.indexOf('id="rs-pane-cand"')), /data-rs-in="cand"/);
  assert.match(h, /rs-skel rs-skel--ico/);
});

test('tabs: the active tab alone filters and writes the address; the other keeps its values', () => {
  const ex = { q: 'moshi', code: 'P01', cand: 'P0101/0001', letter: 'M', p: 3 };
  assert.deepEqual(app.activeFilter(ex, 'name'), { q: 'moshi', code: 'P01', cand: '', letter: 'M' });
  assert.deepEqual(app.activeFilter(ex, 'cand'), { q: '', code: '', cand: 'P0101/0001', letter: '' });
  assert.deepEqual(app.examParams(ex, 'name'), { q: 'moshi', code: 'P01', letter: 'M', p: 3 });
  assert.deepEqual(app.examParams(ex, 'cand'), { cand: 'P0101/0001', p: 3 });
  assert.equal(app.buildSearch('?utm=1', app.examParams(ex, 'cand')), '?utm=1&cand=P0101%2F0001&p=3');
  assert.equal(app.buildSearch('', app.examParams({ ...ex, p: 1 }, 'name')), '?q=moshi&code=P01&letter=M');
  assert.equal(app.tabOf(app.readRoute('?cand=P0101')), 'cand');
  assert.equal(app.tabOf(app.readRoute('?q=moshi')), 'name');
  assert.equal(app.tabOf(app.readRoute('?q=moshi&cand=P0101')), 'cand');
  assert.equal(app.tabOf(app.readRoute('')), 'name');
  const a = app.adoptExam(ex, app.readRoute('?cand=P0104'));
  assert.equal(a.tab, 'cand');
  assert.deepEqual([a.ex.cand, a.ex.q, a.ex.letter, a.ex.p], ['P0104', 'moshi', 'M', 1]);
  const back = app.adoptExam(a.ex, app.readRoute('?q=a&letter=B'));
  assert.deepEqual([back.tab, back.ex.q, back.ex.letter, back.ex.cand], ['name', 'a', 'B', 'P0104']);
  // filtering: the candidate tab filters by centre-code prefix, the school tab ignores the candidate field
  const rows = app.prepRows([['P0101', 'AZANIA', 1], ['P0104', 'BWIRU', 1], ['P0201', 'MOSHI', 1]]);
  assert.deepEqual(app.baseFilter(rows, app.activeFilter({ q: 'moshi', cand: 'P010' }, 'cand')).map((r) => r.code), ['P0101', 'P0104']);
  assert.deepEqual(app.baseFilter(rows, app.activeFilter({ q: 'moshi', cand: 'P010' }, 'name')).map((r) => r.code), ['P0201']);
});

test('js: tab keys, roving tabindex, no timers that navigate; css: tabs, pill, stacked panes, row icon, reduced motion', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/results-app.js'), 'utf8');
  assert.match(src, /ArrowRight: i \+ 1, ArrowLeft: i - 1, Home: 0, End: tabEls\.length - 1/);
  assert.match(src, /b\.tabIndex = on \? 0 : -1/);
  assert.match(src, /b\.setAttribute\('aria-selected', String\(on\)\)/);
  assert.match(src, /h\('span', \{ class: 'rs-row-ico', 'aria-hidden': 'true' \}, icon\('school'\)\)/);
  const css = fs.readFileSync(path.join(ROOT, 'css/results.css'), 'utf8');
  assert.match(css, /html:not\(\.js\) \.rs-tabs \{ display: none; \}/, 'without script both panels stay visible and the tab strip is hidden');
  assert.match(css, /\.rs-tabs\.is-ready \.rs-tab-pill \{ transition: transform/);
  assert.match(css, /\.rs-tabs\[data-tab="cand"\] \.rs-tab-pill \{ transform: translateX\(100%\)/);
  assert.match(css, /\.rs \.rs-pane\[hidden\] \{ display: block !important; visibility: hidden/);
  assert.match(css, /@keyframes rs-pane-in \{ from \{ opacity: 0; transform: translateY\(6px\); \} to \{ opacity: 1; transform: none; \} \}/);
  assert.match(css, /\.rs-row-ico \{[^}]*width: var\(--ico\); height: var\(--ico\)/);
  assert.match(css, /\.rs-row:not\(:has\(\.rs-row-ico\)\)/, 'a Worker row without the icon still lays out');
  assert.match(css, /\.rs-skel-row \{ height: 64px/);
  assert.match(css, /\.rs-stat:hover \{ transform: translateY\(-2px\)/);
  assert.match(css, /@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\)/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.rs-stat[^{]*\{[^}]*cursor:\s*pointer/);
});
