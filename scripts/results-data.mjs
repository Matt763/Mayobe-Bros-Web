#!/usr/bin/env node
// Turns the parsed results (the Results project and the importer's work folder) into the compact v3 files the browser and the
// Worker fetch (results-data/<exam>/meta.json, list.json and one <lowercode>.txt per centre; git-ignored).
//   node scripts/results-data.mjs [--exam csee-2024[,psle-2021]] [--src <results-project-dir>] [--work <necta-work-dir>]
//                                 [--out results-data] [--dry]
// Two source roots are read: the Results project (the original five exams) and the importer's work folder
// (scripts/necta-import.mjs, default ~/necta-work). When both hold a centre, the work folder's file wins, so top-ups of missing
// centres replace nothing but the gap. Without --exam every exam found in either root is packed; an exam with no centre file yet
// is skipped. Partial exams are fine: only centres whose file exists are online (has = 1). Only finished *.json files are read
// (the importer writes *.tmp first). Every packed file is decoded again and compared with its source (name, URL, summary, overall
// blocks, facts and every candidate); any mismatch writes nothing and exits with 1. The format is "Data contract (v3)" in
// docs/superpowers/specs/2026-11-10-results-app-design.md; the decoder is js/results-codec.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeRegistry } from './lib/results-registry.mjs';
import { CODEC_VERSION, cleanName, derivedSummary, finishMeta, learnMeta, packCentre, packList, verifyCentre, verifyList } from './lib/results-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SRC = '/run/media/mclean/New Volume/MY WEBSITE PROJECTS/Mayobe Results Website';
const DEFAULT_WORK = path.join(os.homedir(), 'necta-work');

function args(argv) {
  const o = { exam: null, src: DEFAULT_SRC, work: DEFAULT_WORK, out: path.join(ROOT, 'results-data'), dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') o.dry = true;
    else if (a === '--exam') o.exam = (o.exam || []).concat(String(argv[++i]).split(',').map((x) => x.trim()).filter(Boolean));
    else if (a === '--work') o.work = path.resolve(argv[++i]);
    else if (a === '--src') o.src = path.resolve(argv[++i]);
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

function writeIfChanged(file, text) {
  try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch { /* new file */ }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

/** Every exam either root knows. */
function findExams(opts) {
  const found = new Map();
  const exFile = path.join(opts.src, 'public/data/examinations.json');
  if (exists(exFile)) {
    for (const e of readJson(exFile).exams) found.set(e.id, { id: e.id, category: e.category, year: e.year, kind: e.kind, verified: e.verified, fromSrc: true, workExam: null });
  }
  const wDir = path.join(opts.work, 'exams');
  if (fs.existsSync(wDir)) {
    for (const f of fs.readdirSync(wDir).filter((x) => x.endsWith('.json')).sort()) {
      let w;
      try { w = readJson(path.join(wDir, f)); } catch { continue; } // being rewritten right now: the next run sees it
      const cur = found.get(w.id);
      if (cur) { cur.workExam = w; if (w.importedAt > cur.verified) cur.verified = w.importedAt; } // the later date: a top-up is newer
      else found.set(w.id, { id: w.id, category: w.category, year: w.year, kind: w.kind, verified: w.importedAt, fromSrc: false, workExam: w });
    }
  }
  return found;
}

/** Centre list rows [code, name, has, region, district] from the Results project, then the work folder's list on top. */
function mergedList(opts, ex, cat, year) {
  const byCode = new Map();
  const listFile = path.join(opts.src, 'public/data', cat, year, 'centres.json');
  if (ex.fromSrc && exists(listFile)) {
    const listed = readJson(listFile);
    if (listed.meta.total !== listed.rows.length) throw new Error(`${ex.id}: index says ${listed.meta.total} rows, has ${listed.rows.length}`);
    for (const r of listed.rows) byCode.set(r[0].toUpperCase(), [r[0], cleanName(r[1]), ...r.slice(2)]);
  }
  if (ex.workExam) for (const c of ex.workExam.centres) byCode.set(c.code.toUpperCase(), [c.code.toUpperCase(), cleanName(c.name), c.imported ? 1 : 0, c.region || '', c.district || '']);
  return byCode;
}

const sizes = (text) => {
  const b = Buffer.from(text);
  return [b.length, zlib.gzipSync(b, { level: 9 }).length, zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length];
};

/** Packs and proves one exam in memory. Returns a plan, or null after reporting the problems. */
function plan(opts, ex) {
  const cat = ex.category.toLowerCase();
  const year = String(ex.year);
  const byCode = mergedList(opts, ex, cat, year);
  const sources = new Map(); // file name -> path; the work folder is read last so its files win
  for (const root of [path.join(opts.src, 'data/centres', cat, year), path.join(opts.work, 'data', cat, year)]) {
    if (!fs.existsSync(root)) continue;
    for (const f of fs.readdirSync(root)) if (/\.json$/.test(f)) sources.set(f, path.join(root, f));
  }
  const files = [...sources.keys()].sort();
  if (!files.length) { console.log(`\n${ex.id}: no centre files yet, skipped`); return null; }
  const info = { exam: ex.id, cat, year: ex.year, kind: ex.kind, verified: ex.verified };
  const parse = (f) => {
    const j = readJson(sources.get(f));
    if (f !== j.code.toLowerCase() + '.json') throw new Error(`${ex.id}/${f}: code ${j.code} does not match the file name`);
    j.name = cleanName(j.name);
    if (!j.summary) { const d = derivedSummary(j); if (d) j.summary = d; }
    if (j.indexName) j.indexName = cleanName(j.indexName);
    return j;
  };
  const meta = learnMeta(info, (fn) => { for (const f of files) fn(parse(f)); });

  const texts = new Map();
  const rows = new Map(byCode);
  let cands = 0, bad = 0, notListed = 0;
  const total = { raw: 0, gz: 0, br: 0 };
  let largest = { f: '', b: 0 };
  for (const f of files) {
    const src = parse(f);
    const { text } = packCentre(src, meta);
    const wrong = verifyCentre(src, text, meta);
    if (wrong.length) { bad += wrong.length; for (const w of wrong.slice(0, 5)) console.error(`MISMATCH ${ex.id}: ${w}`); continue; }
    texts.set(f.slice(0, -5) + '.txt', text);
    const s = sizes(text);
    total.raw += s[0]; total.gz += s[1]; total.br += s[2];
    if (s[0] > largest.b) largest = { f: f.slice(0, -5) + '.txt', b: s[0], gz: s[1], br: s[2] };
    cands += src.candidates.length;
    if (!rows.has(src.code.toUpperCase())) { rows.set(src.code.toUpperCase(), [src.code.toUpperCase(), src.indexName || src.name, 1, src.region || '', src.district || '']); notListed++; }
  }
  if (bad) return { failed: bad };

  // `has` comes from what was really packed
  const listRows = [...rows.values()];
  const has = (code) => texts.has(code.toLowerCase() + '.txt');
  const list = packList(ex.kind, listRows, has);
  const online = listRows.filter((r) => has(r[0])).length;
  finishMeta(meta, list, listRows.length, online);
  const problems = verifyList(ex.kind, listRows, list, has);
  if (online !== files.length) problems.push(`${online} online centres but ${files.length} files`);
  if (problems.length) { for (const p of problems.slice(0, 8)) console.error(`MISMATCH ${ex.id}: ${p}`); return { failed: problems.length }; }
  const metaText = JSON.stringify(meta);
  const listText = JSON.stringify(list);
  for (const t of [metaText, listText]) { const s = sizes(t); total.raw += s[0]; total.gz += s[1]; total.br += s[2]; }
  return { ex, meta, metaText, listText, texts, total, largest, cands, files: files.length, notListed, listRows };
}

function run(opts) {
  const found = findExams(opts);
  let wanted = [...found.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (opts.exam) {
    const missing = opts.exam.filter((id) => !found.has(id));
    if (missing.length) throw new Error(`No exam ${missing.join(', ')} in the sources`);
    wanted = opts.exam.map((id) => found.get(id));
  }
  if (!wanted.length) throw new Error('No exams found in the sources');
  let problems = 0;
  const plans = []; // everything is built and verified in memory first; nothing is written unless all of it is fine
  for (const ex of wanted) {
    let p;
    try { p = plan(opts, ex); } catch (e) { console.error(`${ex.id}: ${e.message}`); problems++; continue; }
    if (p && p.failed) problems += p.failed;
    else if (p) plans.push(p);
  }
  if (problems) {
    console.error(`\n${problems} problem(s): nothing was written.`);
    return problems;
  }

  const grand = { raw: 0, gz: 0, br: 0, files: 0, cands: 0 };
  for (const p of plans) {
    const outDir = path.join(opts.out, p.ex.id);
    let written = 0;
    if (!opts.dry) {
      fs.mkdirSync(outDir, { recursive: true });
      for (const [f, text] of p.texts) if (writeIfChanged(path.join(outDir, f), text)) written++;
      if (writeIfChanged(path.join(outDir, 'list.json'), p.listText)) written++;
      for (const f of fs.readdirSync(outDir)) { // old v2 files, centres that left the source, leftovers of an interrupted write
        if (f === 'meta.json' || f === 'list.json' || p.texts.has(f)) continue;
        if (/^[a-z0-9]+\.(json|txt)$/i.test(f) || /\.tmp$/.test(f)) fs.unlinkSync(path.join(outDir, f));
      }
      if (writeIfChanged(path.join(outDir, 'meta.json'), p.metaText)) written++; // last: it carries the key
    }
    const missing = p.listRows.filter((r) => !p.texts.has(r[0].toLowerCase() + '.txt')).map((r) => r[0]).sort();
    console.log(`\n${p.ex.id} (${p.ex.kind}, verified ${p.ex.verified}, key ${p.meta.key})${opts.dry ? ' [dry run]' : ''}`);
    console.log(`  centres listed ${p.meta.total}, with data ${p.meta.online}, files ${p.files + 2}, written ${written}, candidates ${p.cands}${p.notListed ? `, ${p.notListed} centre file(s) were not in the list and were added from their own file` : ''}`);
    console.log(`  subjects (${p.meta.subjects.length}): ${p.meta.subjects.join(', ')}`);
    console.log(`  size raw ${mb(p.total.raw)}, gzip-9 ${mb(p.total.gz)}, brotli-9 ${mb(p.total.br)}; largest ${p.largest.f} ${p.largest.b} B (gzip ${p.largest.gz}, brotli ${p.largest.br})`);
    console.log(`  no data (${missing.length}): ${missing.length ? missing.slice(0, 40).join(', ') + (missing.length > 40 ? `, and ${missing.length - 40} more` : '') : 'none'}`);
    console.log('  mismatches: 0');
    grand.raw += p.total.raw; grand.gz += p.total.gz; grand.br += p.total.br; grand.files += p.files + 2; grand.cands += p.cands;
  }
  if (!opts.dry) console.log(`\nregistry.json: ${writeRegistry(opts.out)} bytes (exam list for the Worker)`);
  console.log(`\nTotal: ${grand.files} files, ${grand.cands} candidates, raw ${mb(grand.raw)}, gzip-9 ${mb(grand.gz)}, brotli-9 ${mb(grand.br)} (data format v${CODEC_VERSION})`);
  return 0;
}

let code;
try { code = run(args(process.argv.slice(2))) ? 1 : 0; } catch (e) { console.error(e.message); code = 1; }
if (code) console.error('\nFAILED: see the lines above.');
process.exit(code);
