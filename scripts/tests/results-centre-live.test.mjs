// A school page made by the results Worker holds two copies of some parts: the server's own figures (inside [data-rs-static], which the
// script removes once the live view is up) and the live view's template (<template data-rs-tpl>). The script fills the live copy, so every
// hook that exists in BOTH must be looked up inside the live copy (`$c`), never from the page root: a root lookup finds the static element
// first, fills it, and the fill disappears with it. That is how a school page once lost its division summary and its three
// "examination centre ... performance" tables as soon as the script ran.
// Also: the About block's bullet rule must never reach the "Other years" chips.
// Needs results-data/ and results-shell.html (run `node scripts/build.mjs` first); the page part is skipped when they are not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../../results-worker/src/index.js';
import { resetMemory } from '../../results-worker/src/data.js';
import { resetShell } from '../../results-worker/src/shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'results-data');
const SHELL = path.join(ROOT, 'results-shell.html');
const ready = fs.existsSync(path.join(DATA, 'registry.json')) && fs.existsSync(SHELL);
const skip = ready ? false : 'results-data/registry.json or results-shell.html is not on this computer';
const ORIGIN = 'https://mayobebros.com';
const registry = ready ? JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8')) : { exams: [] };
const shellText = ready ? fs.readFileSync(SHELL, 'utf8') : '';
const js = fs.readFileSync(path.join(ROOT, 'js/results-app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/results.css'), 'utf8');

const bucket = {
  async get(key) {
    const file = path.normalize(path.join(DATA, String(key)));
    if (!file.startsWith(DATA + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const text = fs.readFileSync(file, 'utf8');
    return { text: async () => text, httpEtag: '"t"' };
  },
  async head(key) { return (await this.get(key)) ? {} : null; },
};
const envFor = () => { resetMemory(); resetShell(); return { RESULTS: bucket, ORIGIN, RESULTS_INDEX: 'off', FETCH_SHELL: async () => new Response(shellText, { status: 200 }) }; };

/** The hooks the script looks up, and how: { 'summary': '$c', 'hero': '$' ... } read from the `const R = { ... }` block. */
function lookups() {
  const block = /const R = \{([\s\S]*?)\n  \};/.exec(js);
  assert.ok(block, 'the R block of js/results-app.js was not found');
  const map = {};
  for (const m of block[1].matchAll(/(\$c?)\('\[data-rs-([a-z-]+)\]'\)/g)) map[m[2]] = m[1];
  return map;
}
const hooksIn = (htmlText) => new Set([...htmlText.matchAll(/\sdata-rs-([a-z-]+)(?=[\s=>])/g)].map((m) => m[1]));

/** One centre of each exam-year (a few per exam family), as `{ id, cat, year, code }`. */
function sample() {
  const out = [];
  for (const e of registry.exams) {
    const files = fs.readdirSync(path.join(DATA, e.id)).filter((f) => f.endsWith('.txt')).sort();
    if (files.length) out.push({ id: e.id, cat: e.cat, year: e.year, code: files[Math.floor(files.length / 3)].slice(0, -4) });
  }
  // newest year of each exam, then at most two older ones: enough to cover every family and the older layouts
  const seen = new Map();
  return out.sort((a, b) => b.year - a.year).filter((s) => { const n = seen.get(s.cat) || 0; seen.set(s.cat, n + 1); return n < 3; });
}

test('the script looks up a centre view part inside the live copy when the server page holds the same hook', { skip }, async () => {
  const how = lookups();
  const env = envFor();
  let checked = 0;
  for (const s of sample()) {
    const r = await handle(new Request(`${ORIGIN}/results/${s.cat}/${s.code}/${s.year}/`), env, { waitUntil() {} });
    if (r.status !== 200) continue;
    const t = await r.text();
    const st = /<div class="rs-static" data-rs-static>([\s\S]*?)<template data-rs-tpl>/.exec(t);
    const tpl = /<template data-rs-tpl>([\s\S]*?)<\/template>/.exec(t);
    assert.ok(st && tpl, `${s.id} ${s.code}: the page has a static block and a template`);
    const inStatic = hooksIn(st[1]);
    const inTemplate = hooksIn(tpl[1]);
    for (const hook of inStatic) {
      if (!inTemplate.has(hook) || hook === 'static') continue;
      assert.equal(how[hook], '$c', `${s.id} ${s.code}: data-rs-${hook} is in the static block AND the template, so js/results-app.js must look it up with $c(...)`);
    }
    checked++;
  }
  assert.ok(checked >= 3, 'at least three centres were checked');
});

test('every centre view hook of the template is looked up inside the live copy', () => {
  const how = lookups();
  for (const hook of ['centre', 'cstate', 'cbody', 'result', 'facts', 'summary', 'ctools', 'cq', 'chips', 'legend', 'cstatus', 'cands', 'cempty', 'overall', 'source', 'back']) {
    assert.equal(how[hook], '$c', `data-rs-${hook} must be looked up with $c`);
  }
  assert.match(js, /const \$c = \(sel\) => \(liveMount \|\| root\)\.querySelector\(sel\);/);
  assert.match(js, /const mount = liveMount;/, 'bootCentre uses the live copy it made, not a lookup that could find another element');
});

test('a school page keeps its summary and overall performance tables in the HTML and in the live template', { skip }, async () => {
  const env = envFor();
  const r = await handle(new Request(`${ORIGIN}/results/csee/s1106/2025/`), env, { waitUntil() {} });
  if (r.status !== 200) return;
  const t = await r.text();
  const st = /<div class="rs-static" data-rs-static>([\s\S]*?)<template data-rs-tpl>/.exec(t)[1];
  assert.match(st, /DIVISION PERFORMANCE SUMMARY/);
  assert.match(st, /EXAMINATION CENTRE OVERALL PERFORMANCE/);
  assert.match(st, /EXAMINATION CENTRE DIVISION PERFORMANCE/);
  assert.match(st, /EXAMINATION CENTRE SUBJECTS PERFORMANCE/);
  const tpl = /<template data-rs-tpl>([\s\S]*?)<\/template>/.exec(t)[1];
  for (const hook of ['summary', 'overall', 'source', 'cands']) assert.ok(hooksIn(tpl).has(hook), `the template has data-rs-${hook}`);
});

test('the Other years chips are a row of pills, not the About block\'s bullet list', () => {
  const rule = /\.rs-about \.rs-years ul \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'css/results.css has a rule for .rs-about .rs-years ul (it must outweigh .rs-about ul)');
  assert.match(rule[1], /list-style:\s*none/);
  assert.match(rule[1], /padding:\s*0/);
  assert.match(rule[1], /display:\s*flex/);
});
