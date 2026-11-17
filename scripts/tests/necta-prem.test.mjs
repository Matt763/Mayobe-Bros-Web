/* PREM numbers of PSLE and SFNA pupils (owner's decision, 2026-11-10: "do it the way NECTA did").
   NECTA's 2025 school pages print PREM NO next to the candidate number and no name column; older pages (2021 and before) also print
   the pupil's name. We copy the PREM number only. The extractor reads the CAND. NO and PREM NO columns by their header text; a name
   column is never read, so a name cannot reach the output. Real data sits in a separate <code>.pm file per school. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPrem, packPrem } from '../lib/necta-prem.mjs';
import { unpackPrem } from '../../js/results-codec.js';

const cell = (t) => `<TD WIDTH="10%" VALIGN="MIDDLE"><FONT FACE="Arial" SIZE=1><P ALIGN="CENTER">${t}</FONT></TD>`;
const head = (cols) => `<TR>${cols.map((c) => `<TD><B><FONT FACE="Courier" SIZE=2><P ALIGN="CENTER">${c}</B></FONT></TD>`).join('')}</TR>`;
const page = (cols, data) => `<HTML><BODY><H3>LOMUHONG PRIMARY SCHOOL - PS2101114</H3>
<TABLE><TR><TD>JINSI</TD><TD>A</TD></TR></TABLE>
<TABLE>${head(cols)}${data.map((r) => `<TR>${r.map(cell).join('')}</TR>`).join('')}</TABLE></BODY></HTML>`;

test('2025 layout: CAND. NO, PREM NO, SEX, SUBJECTS', () => {
  const html = page(['CAND. NO', 'PREM NO', 'SEX', 'SUBJECTS'], [
    ['PS2101114-0001', '20154827800', 'M', 'Kiswahili - C'],
    ['PS2101114-0003', '20151391202', 'F', 'Kiswahili - B'],
  ]);
  const r = extractPrem(html);
  assert.equal(r.code, 'PS2101114');
  assert.equal(r.hasPrem, true);
  assert.deepEqual([...r.prem], [[1, '20154827800'], [3, '20151391202']]);
});

test('2021 layout with a name column: the name is never read, the PREM number is', () => {
  const html = page(['CAND. NO', 'PREM NO', 'SEX', 'CANDIDATE NAME', 'SUBJECTS'], [
    ['PS2101114-0001', '20154827800', 'M', 'ABINERI JOHN BANGA', 'Kiswahili - D'],
    ['PS2101114-0002', '20151391202', 'M', 'BARAKA SAMWEL GISHINDE', 'Kiswahili - C'],
  ]);
  const r = extractPrem(html);
  assert.deepEqual([...r.prem.values()], ['20154827800', '20151391202']);
  const everything = JSON.stringify({ ...r, prem: [...r.prem] }) + packPrem(r.prem);
  for (const word of ['ABINERI', 'BANGA', 'BARAKA', 'GISHINDE']) assert.ok(!everything.includes(word), `no ${word}`);
});

test('a page without a PREM column has none, and odd values are left out and counted', () => {
  const none = extractPrem(page(['CAND. NO', 'SEX', 'SUBJECTS'], [['PS2101114-0001', 'M', 'Kiswahili - C']]));
  assert.equal(none.hasPrem, false);
  assert.equal(none.prem.size, 0);
  const odd = extractPrem(page(['CAND. NO', 'PREM NO', 'SEX', 'SUBJECTS'], [
    ['PS2101114-0001', '20154827800', 'M', 'x'], ['PS2101114-0002', '', 'M', 'x'], ['PS2101114-0003', '123', 'M', 'x'], ['PS2101114-0004', '2015482780A', 'F', 'x'],
  ]));
  assert.deepEqual([...odd.prem.keys()], [1]);
  assert.equal(odd.skipped, 3);
});

test('packing: 8 base-36 characters per sequence number, a gap is zeros, and it unpacks to the same 11 digits', () => {
  const m = new Map([[1, '20154827800'], [3, '20151391202'], [5, '99999999999']]);
  const s = packPrem(m);
  assert.equal(s.length, 8 * 5);
  assert.match(s, /^[0-9a-z]+$/);
  assert.equal(unpackPrem(s, '0001'), '20154827800');
  assert.equal(unpackPrem(s, '0002'), '', 'a gap has no number');
  assert.equal(unpackPrem(s, '0003'), '20151391202');
  assert.equal(unpackPrem(s, '0005'), '99999999999');
  assert.equal(unpackPrem(s, '0006'), '', 'beyond the end');
  assert.equal(unpackPrem('', '0001'), '');
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the numbers are loaded by the interactive page only, never by the Worker pages for search engines', () => {
  const app = read('js/results-app.js');
  assert.match(app, /if \(meta\.pm && !SSR\)/, 'not in SSR (centre mode) pages');
  for (const f of fs.readdirSync(path.join(ROOT, 'results-worker/src')).filter((x) => x.endsWith('.js'))) {
    assert.doesNotMatch(read(`results-worker/src/${f}`), /prem|\.pm\b|unpackPrem/i, `results-worker/src/${f} must not know about PREM numbers`);
  }
});

test('the main parsers still never read a PREM or name column', () => {
  for (const f of ['necta-parse.mjs', 'necta-parse-legacy.mjs', 'necta-parse-psle-old.mjs', 'necta-parse-ftna-sfna.mjs', 'necta-parse-diploma.mjs']) {
    assert.match(read(`scripts/lib/${f}`), /\/PREM\/\.test\(t\)[^\n]*(never read|return)/, `${f} skips the PREM column`);
  }
});

test('the extractor and the tool never read a name column', () => {
  const lib = read('scripts/lib/necta-prem.mjs');
  assert.match(lib, /NAME\|JINA[^\n]*return; \/\/ never read/);
  assert.doesNotMatch(read('scripts/tools/results-prem.mjs'), /candidate name/i);
});

test('the privacy policy says what is shown and how to have a number hidden', () => {
  const p = read('content/pages/privacy-policy.html');
  assert.match(p, /PREM number that NECTA printed next to the candidate number/);
  assert.match(p, /write to us at \{\{email:general\}\}/);
  assert.doesNotMatch(p, /we leave out the pupils' PREM numbers/);
});

test('the results page offers to hide a number (note shown only when numbers are on screen)', () => {
  const shell = read('scripts/lib/results-app.mjs');
  assert.match(shell, /data-rs-premnote hidden>[\s\S]*Names are not copied\. To have a number hidden/);
  assert.match(read('js/results-app.js'), /premNote\.hidden = !hasPrem/);
});
