#!/usr/bin/env node
// Polite, resumable importer of NECTA exam results (onlinesys / matokeo / the maktaba.tetea.org mirror).
//   node scripts/necta-import.mjs --exam csee-2025 [--limit N] [--codes S0195,S5405] [--workers N] [--delay MS]
//                                  [--dry] [--reparse] [--retry-failed] [--work DIR] [--legacy DIR]
//   node scripts/necta-import.mjs --status [--exam csee-2025]
// Work folder (default ~/necta-work):
//   source/<cat>/<year>/...   raw pages, gzip, mirror of the URL path (each URL is requested at most once)
//   data/<cat>/<year>/<code>.json   one parsed centre (same shape as the Results project, no PREM, no names)
//   exams/<id>.json           centre list and counts (what scripts/results-data.mjs reads)
//   status/<id>.json          done / failed per exam; status/<id>.lock while a run is going
// Only for data NECTA publishes openly; nothing here stores a candidate's name or PREM number.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeBuffer, parseExamIndex, parseRegions, parseDistricts, parseSchools, parseSecondaryCentre, parsePsleSchool } from './lib/necta-parse.mjs';
import { parseFtnaIndex, parseFtnaCentre, parseSfnaRegions, parseSfnaDistricts, parseSfnaSchools, parseSfnaSchool } from './lib/necta-parse-ftna-sfna.mjs';
import { parseFtnaOldIndex, parseFtnaOldCentre, parseSfnaOldRegions, parseSfnaOldDistricts, parseSfnaOldSchools, parseSfnaOldSchool } from './lib/necta-parse-ftna-sfna-old.mjs';
import { parseDiplomaIndex, parseDiplomaCentre, parseQtPage } from './lib/necta-parse-diploma.mjs';
import { parseLegacyIndex, parseLegacyCentre } from './lib/necta-parse-legacy.mjs';
import { parsePsleOldSchools, parsePsleOldSchool } from './lib/necta-parse-psle-old.mjs';
import { createFetcher, FetchError, StopError, HOSTS, cachePathFor, writeFileAtomic } from './lib/necta-fetch.mjs';
import { examDef, EXAM_IDS, cnoPrefix } from './lib/necta-exams.mjs';

export const DEFAULT_WORK = path.join(os.homedir(), 'necta-work');
export const DEFAULT_LEGACY = '/run/media/mclean/New Volume/MY WEBSITE PROJECTS/Mayobe Results Website/source';
const CODE_OK = /^[A-Z]{1,2}\d{4,9}$/;

const today = () => new Date().toISOString().slice(0, 10);

function writeJson(file, obj) { writeFileAtomic(file, JSON.stringify(obj)); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

/** New-style pages parse with parseSecondaryCentre; pages whose division totals are one text line (ACSEE 2016 to 2019, some CSEE) put that line
 *  into the centre name and give no summary, so those go to the legacy parser, which reads them correctly. */
export function parseSecondaryAuto(html, code) {
  const a = parseSecondaryCentre(html, code);
  if (a.summary && !/DIV-/.test(a.name || '')) return a;
  const b = parseLegacyCentre(html, code);
  return b.candidates.length ? b : a;
}

/** Why a parsed page may not become a record, or null. */
export function validateCentre(def, expectCode, rec) {
  if (!rec.code) return 'no centre heading';
  if (rec.code !== expectCode) return `heading code ${rec.code} != ${expectCode}`;
  if (!rec.candidates.length) return 'no candidates found';
  const dup = rec.issues.filter((i) => i.startsWith('duplicate candidate')).length;
  if (dup) return `${dup} duplicate candidate number(s)`;
  const prefix = cnoPrefix(def, expectCode);
  const wrong = rec.candidates.find((c) => !c.cno.startsWith(prefix));
  if (wrong) return `candidate number ${wrong.cno} does not start with ${prefix}`;
  return null;
}

/**
 * A few source pages (PSLE 2017: PS0904084, PS1608018) end with the candidates of ANOTHER school that has no page of its own. The
 * school's own candidates are complete (001 to the last one, in order), so they are kept and the foreign tail is dropped, with a note in
 * `issues` saying how many and which school. Only a tail is dropped: a foreign number in the middle, or no own candidate at all, is still
 * an error. No candidate is ever moved to another school and no school name is made up for the dropped ones.
 */
export function dropForeignTail(def, expectCode, rec) {
  if (!rec || !rec.candidates || !rec.candidates.length) return rec;
  const prefix = cnoPrefix(def, expectCode);
  const own = (c) => c.cno.startsWith(prefix);
  let last = -1;
  rec.candidates.forEach((c, i) => { if (own(c)) last = i; });
  if (last < 0 || last === rec.candidates.length - 1) return rec;
  const tail = rec.candidates.slice(last + 1);
  if (tail.some(own)) return rec;
  const others = [...new Set(tail.map((c) => c.cno.replace(/[-/][^-/]*$/, '')))];
  rec.candidates = rec.candidates.slice(0, last + 1);
  rec.issues = [...(rec.issues || []), `dropped ${tail.length} candidate(s) numbered for another school (${others.join(', ')}) at the end of this page`];
  return rec;
}

export function buildRecord(def, c, rec, url) {
  return {
    exam: def.id, category: def.category, year: def.year, kind: def.kind, code: c.code,
    name: rec.name || c.name, indexName: c.name, region: c.region || '', district: c.district || '',
    sourceUrl: url, source: def.source,
    summary: rec.summary, overall: rec.overall || [], facts: rec.facts || [], candidates: rec.candidates, issues: rec.issues,
  };
}

/** Raw files the Results project already holds (index, region, district pages), read-only. */
function legacyReader(def, legacyDir) {
  if (!legacyDir) return null;
  return (url) => {
    try {
      const name = new URL(url).pathname.split('/').pop();
      const sub = name === def.indexName ? '' : /^reg_/i.test(name) ? 'regions/' : /^distr_/i.test(name) ? 'districts/' : 'centres/';
      return fs.readFileSync(path.join(legacyDir, def.category, String(def.year), sub, name));
    } catch { return null; }
  };
}

function lockFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, String(process.pid), { flag: 'wx' }); return; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const pid = Number(fs.readFileSync(file, 'utf8'));
  let alive = false;
  try { process.kill(pid, 0); alive = pid !== process.pid; } catch { alive = false; }
  if (alive) throw new Error(`Another import of this exam is running (pid ${pid}). Remove ${file} if it is not.`);
  fs.writeFileSync(file, String(process.pid));
}

/**
 * Run one exam. `opts`: exam, workDir, legacyDir, limit, codes[], workers, delay, dry, reparse, retryFailed,
 * and for tests fetchImpl, now, sleep, log, control ({stop}), backoffMs.
 */
export async function runImport(opts) {
  const def = examDef(opts.exam);
  const log = opts.log || ((m) => console.log(m));
  const work = opts.workDir || DEFAULT_WORK;
  const host = HOSTS[def.host];
  const workers = Math.max(1, Math.min(4, opts.workers ?? host.workers));
  const spacing = opts.delay ?? host.spacingMs;
  const srcDir = path.join(work, 'source', def.cat, String(def.year));
  const dataDir = path.join(work, 'data', def.cat, String(def.year));
  const statusFile = path.join(work, 'status', `${def.id}.json`);
  const lock = path.join(work, 'status', `${def.id}.lock`);
  const started = Date.now();
  const startedIso = new Date().toISOString();

  const fetcher = createFetcher({
    fetchImpl: opts.fetchImpl, now: opts.now, sleep: opts.sleep, spacing, backoffMs: opts.backoffMs,
    offline: !!opts.dry, fallback: legacyReader(def, opts.legacyDir === undefined ? DEFAULT_LEGACY : opts.legacyDir),
    onRetry: (r) => log(`  retry ${r.attempt} in ${Math.round(r.delayMs / 1000)}s (${r.reason}): ${r.url}`),
  });
  if (opts.control) opts.control.stop = () => fetcher.stop();

  const relOf = (url) => {
    const u = new URL(url);
    const base = new URL(def.indexUrl).pathname.replace(/[^/]*$/, '');
    return u.pathname.startsWith(base) ? u.pathname.slice(base.length) : '_other' + u.pathname;
  };
  const cacheFile = (url) => cachePathFor(srcDir, relOf(url));
  const page = async (url) => decodeBuffer((await fetcher.get(url, cacheFile(url))).buf);

  if (!opts.dry) lockFile(lock);
  const release = () => { if (!opts.dry) try { fs.unlinkSync(lock); } catch { /* gone */ } };
  try {
    log(`\n== ${def.id} (${def.host}) ==`);
    // 1. the list of centres, from cached or fetched index pages
    const issues = [];
    let list = [];
    try {
      if (def.family === 'qt') {
        // the whole year is one page: parse every centre now; the loop below only writes them (no further requests)
        const q = parseQtPage(await page(def.indexUrl));
        issues.push(...q.issues);
        list = q.centres.map((c) => ({ code: c.code, name: c.name, region: '', district: '', url: def.indexUrl, rec: c }));
      } else if (def.kind === 'secondary') {
        const r = (def.family === 'ftna' ? (def.oldNational ? parseFtnaOldIndex : parseFtnaIndex) : def.family === 'diploma' ? parseDiplomaIndex : def.legacy ? parseLegacyIndex : parseExamIndex)(await page(def.indexUrl));
        issues.push(...r.issues);
        list = r.centres.map((c) => ({ code: c.code, name: c.name, region: '', district: '', url: new URL(c.href, def.indexUrl).href }));
      } else {
        const seen = new Set();
        const root = await page(def.indexUrl);
        const [regionsOf, districtsOf, schoolsOf] = def.family === 'sfna' ? (def.oldNational ? [parseSfnaOldRegions, parseSfnaOldDistricts, parseSfnaOldSchools] : [parseSfnaRegions, parseSfnaDistricts, parseSfnaSchools]) : [parseRegions, parseDistricts, def.oldPsle ? parsePsleOldSchools : parseSchools];
        for (const reg of regionsOf(root)) {
          const regUrl = new URL(reg.href, def.indexUrl).href;
          for (const d of districtsOf(await page(regUrl))) {
            const dUrl = new URL(d.href, regUrl).href;
            for (const s of schoolsOf(await page(dUrl))) {
              if (seen.has(s.code)) { issues.push(`duplicate school ${s.code}`); continue; }
              seen.add(s.code);
              list.push({ code: s.code, name: s.name, region: reg.name, district: d.name, url: new URL(s.href, dUrl).href });
            }
          }
          if (opts.progressRegions) log(`  region ${reg.name}: ${list.length} schools so far`);
        }
      }
    } catch (e) {
      if (e instanceof StopError) { log('Stopped while reading the index; run again to resume.'); return { stopped: true, def }; }
      if (opts.dry && e instanceof FetchError) { log(`Index is not cached yet; a real run would request ${def.indexUrl} first.`); return { dry: true, def, indexCached: false }; }
      throw e;
    }
    if (!list.length) throw new Error(`${def.id}: the index produced 0 centres`);
    log(`  ${list.length} centres in the index${issues.length ? ` (${issues.length} index notes)` : ''}`);

    const prior = readJson(statusFile, {});
    const failedMap = { ...(prior.failedList || {}) };
    const have = (code) => fs.existsSync(path.join(dataDir, code.toLowerCase() + '.json'));

    // 2. what to fetch
    let todo;
    if (opts.codes && opts.codes.length) {
      const want = new Set(opts.codes.map((c) => c.toUpperCase()));
      todo = list.filter((c) => want.has(c.code));
      for (const code of want) if (!list.some((c) => c.code === code)) issues.push(`${code}: not in the index of ${def.id}`);
    } else {
      todo = list.filter((c) => (opts.reparse || !have(c.code)) && (opts.retryFailed || !(failedMap[c.code] && failedMap[c.code].permanent)));
    }
    const pending = todo.length;
    if (opts.limit) todo = todo.slice(0, opts.limit);

    if (opts.dry) {
      const cachedPages = todo.filter((c) => fs.existsSync(cacheFile(c.url))).length;
      log(`  dry run: ${list.filter((c) => have(c.code)).length} centres already have data; ${pending} left to do, ${todo.length} selected, ${cachedPages} of those already in the raw cache`);
      return { dry: true, def, total: list.length, pending, selected: todo.length, cachedPages };
    }

    // 3. fetch and parse
    const run = { ok: 0, failed: 0, processed: 0, notes: 0 };
    const parse = def.family === 'diploma' ? parseDiplomaCentre : def.family === 'ftna' ? (def.oldNational ? (h, c) => parseFtnaOldCentre(h, c, { year: def.year }) : parseFtnaCentre) : def.family === 'sfna' ? (def.oldNational ? parseSfnaOldSchool : parseSfnaSchool) : def.kind === 'secondary' ? (def.legacy ? parseLegacyCentre : parseSecondaryAuto) : def.oldPsle ? parsePsleOldSchool : parsePsleSchool;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !fetcher.stopped) {
        const c = todo[next++];
        try {
          const rec = c.rec || parse(decodeBuffer((await fetcher.get(c.url, cacheFile(c.url))).buf), c.code);
          dropForeignTail(def, c.code, rec);
          const bad = validateCentre(def, c.code, rec);
          if (bad) throw new FetchError(bad, { url: c.url });
          writeJson(path.join(dataDir, c.code.toLowerCase() + '.json'), buildRecord(def, c, rec, c.url));
          delete failedMap[c.code];
          run.ok++;
          if (rec.issues.length) { run.notes++; issues.push(`${c.code}: ${rec.issues.length} parse note(s)`); }
        } catch (e) {
          if (e instanceof StopError) break;
          const reason = e && e.message ? e.message : String(e);
          const permanent = e instanceof FetchError && e.status >= 400 && e.status < 500 && e.status !== 429;
          failedMap[c.code] = { url: c.url, reason, permanent, at: today() };
          run.failed++;
          log(`  FAIL ${c.code}: ${reason}`);
        }
        run.processed++;
        if (run.processed % 100 === 0) {
          const secs = (Date.now() - started) / 1000;
          log(`  ${run.processed}/${todo.length} processed (${run.ok} ok, ${run.failed} failed, ${fetcher.stats.requests} requests, ${(fetcher.stats.requests / Math.max(secs, 1)).toFixed(2)} req/s)`);
          saveStatus(false);
        }
      }
    };

    const finishFiles = () => {
      const imported = list.filter((c) => have(c.code));
      return imported.length;
    };
    function saveStatus(final) {
      const done = finishFiles();
      const secs = (Date.now() - started) / 1000;
      const failedList = {};
      for (const [code, f] of Object.entries(failedMap)) if (!have(code)) failedList[code] = f;
      writeJson(statusFile, {
        id: def.id, host: def.host, updated: new Date().toISOString(), total: list.length, done,
        failed: Object.keys(failedList).length, failedList,
        lastRun: {
          started: startedIso, finished: final ? new Date().toISOString() : null, ok: run.ok, failed: run.failed,
          requests: fetcher.stats.requests, cached: fetcher.stats.cached, retries: fetcher.stats.retries, bytes: fetcher.stats.bytes,
          seconds: Math.round(secs), reqPerSecond: Number((fetcher.stats.requests / Math.max(secs, 1)).toFixed(2)),
          stopped: final ? fetcher.stopped : false,
        },
      });
      return done;
    }
    function saveExam(done) {
      const failedNow = Object.entries(failedMap).filter(([code]) => !have(code));
      const all = issues.concat(failedNow.map(([code, f]) => `${code}: ${f.reason} (${f.url})`));
      writeJson(path.join(work, 'exams', `${def.id}.json`), {
        id: def.id, category: def.category, year: def.year, kind: def.kind, sourceUrl: def.indexUrl, source: def.source, popular: false,
        importedAt: today(), status: done === list.length ? 'verified' : done ? 'partial' : 'index-only',
        stats: { centres: list.length, importedCentres: done },
        centres: list.map((c) => ({ code: c.code, name: c.name, region: c.region, district: c.district, imported: have(c.code) })),
        issues: all.slice(0, 500),
      });
    }

    log(`  fetching ${todo.length} of ${pending} pending centres with ${workers} worker(s), one request start every ${spacing} ms`);
    await Promise.all(Array.from({ length: workers }, worker));
    const done = saveStatus(true);
    saveExam(done);
    const secs = Math.max((Date.now() - started) / 1000, 0.001);
    log(`  done: ${run.ok} written, ${run.failed} failed, ${run.notes} with parse notes; ${done}/${list.length} centres have data`);
    log(`  requests ${fetcher.stats.requests} (${(fetcher.stats.requests / secs).toFixed(2)}/s), from cache ${fetcher.stats.cached}, retries ${fetcher.stats.retries}, ${(fetcher.stats.bytes / 1048576).toFixed(1)} MB`);
    if (fetcher.stopped) log('  stopped early: run the same command again to resume');
    return { def, ok: run.ok, failed: run.failed, done, total: list.length, stopped: fetcher.stopped, stats: fetcher.stats, seconds: secs };
  } finally { release(); }
}

/** The lines `--status` prints. */
export function statusLines(work, id) {
  const dir = path.join(work, 'status');
  const ids = id ? [id] : (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : []);
  if (!ids.length) return ['No import has been run yet.'];
  return ids.map((x) => {
    const s = readJson(path.join(dir, `${x}.json`));
    if (!s) return `${x.padEnd(11)} not started`;
    const perm = Object.values(s.failedList || {}).filter((f) => f.permanent).length;
    return `${x.padEnd(11)} done ${s.done}/${s.total}  failed ${s.failed}${perm ? ` (${perm} permanent)` : ''}  updated ${s.updated}${s.lastRun && s.lastRun.stopped ? '  [stopped early]' : ''}`;
  });
}

export function parseArgs(argv) {
  const o = { exam: null, limit: 0, codes: [], workers: null, delay: null, dry: false, status: false, reparse: false, retryFailed: false, workDir: DEFAULT_WORK, legacyDir: DEFAULT_LEGACY };
  const need = (i, name) => { if (i >= argv.length) throw new Error(`${name} needs a value`); return argv[i]; };
  const num = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--exam') o.exam = need(++i, a);
    else if (a === '--limit') o.limit = num(need(++i, a), a);
    else if (a === '--workers') o.workers = num(need(++i, a), a);
    else if (a === '--delay') o.delay = num(need(++i, a), a);
    else if (a === '--codes') o.codes = need(++i, a).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--work') o.workDir = path.resolve(need(++i, a));
    else if (a === '--legacy') o.legacyDir = need(++i, a) === 'none' ? null : path.resolve(argv[i]);
    else if (a === '--dry') o.dry = true;
    else if (a === '--status') o.status = true;
    else if (a === '--reparse') o.reparse = true;
    else if (a === '--retry-failed') o.retryFailed = true;
    else throw new Error(`Unknown option ${a}`);
  }
  for (const c of o.codes) if (!CODE_OK.test(c)) throw new Error(`Bad centre code ${c}`);
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.status) { for (const l of statusLines(o.workDir, o.exam)) console.log(l); return 0; }
  if (!o.exam) throw new Error(`--exam is required. Known: ${EXAM_IDS.join(', ')}`);
  examDef(o.exam);
  const control = {};
  let signals = 0;
  const onSignal = (name) => {
    signals++;
    if (signals > 1) { console.error('Second signal: exiting now.'); process.exit(130); }
    console.error(`\n${name}: finishing the requests in flight, then saving the status...`);
    if (control.stop) control.stop();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  const r = await runImport({ ...o, progressRegions: true, control });
  return r && r.stopped ? 130 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
