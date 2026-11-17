#!/usr/bin/env node
// Uploads the exam RESULTS data (results-data/<exam>/*, git-ignored) to the Cloudflare R2 bucket the results Worker reads
// (mayobe-results-data), through wrangler. Past-papers PDFs are NOT touched (owner, 2026-11-14: "only upload exam results").
//   node scripts/tools/r2-upload-results.mjs [--exam csee-2003,psle-2021] [--dry] [--concurrency 20] [--chunk 1000]
// - Which exams: every exam in site.config.json resultsData.datasets that has a results-data folder (a partial test folder is skipped).
// - Resumable: ~/necta-work/r2-uploaded.json keeps, per exam, the data key (meta.json "key") and how many chunks are done. Start it again
//   and it goes on; an exam is uploaded again only when its key changed (a re-pack, new centres).
// - registry.json is uploaded LAST, filtered to the exams that finished, so the Worker never lists an exam whose files are not all there.
// - Speed: Cloudflare's API lets wrangler put about 4 objects per second for long runs, so 500,000 files take a day and a half. Run it
//   detached (scripts/tools/r2-upload-detached.sh). Needs wrangler's login (~/.config/.wrangler) and NODE_OPTIONS=--dns-result-order=ipv4first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'results-data');
const STATE = path.join(os.homedir(), 'necta-work', 'r2-uploaded.json');
const BUCKET = 'mayobe-results-data';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const dry = process.argv.includes('--dry');
const conc = Number(arg('--concurrency', 3));
const chunkSize = Number(arg('--chunk', 250));
const only = arg('--exam', '') ? String(arg('--exam')).split(',') : null;
const TYPES = { json: 'application/json', txt: 'text/plain; charset=utf-8', pm: 'application/octet-stream' };
const log = (m) => console.log(`${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${m}`);

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const wanted = Object.keys(cfg.resultsData.datasets || {}).filter((id) => fs.existsSync(path.join(DATA, id, 'meta.json')) && (!only || only.includes(id)));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const state = readJson(STATE, {});
const save = () => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); const t = `${STATE}.tmp`; fs.writeFileSync(t, JSON.stringify(state)); fs.renameSync(t, STATE); };

function put(list, type) {
  const tmp = path.join(os.tmpdir(), `r2put-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(list));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync('npx', ['wrangler', 'r2', 'bulk', 'put', BUCKET, '--remote', '--filename', tmp, '--content-type', type, '--cache-control', 'public, max-age=3600', '--concurrency', String(conc)],
      { cwd: path.join(ROOT, 'results-worker'), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first', XDG_CONFIG_HOME: path.join(os.homedir(), '.config') }, maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 0 && /100%/.test(r.stdout + r.stderr)) { fs.rmSync(tmp, { force: true }); return true; }
    log(`  attempt ${attempt} failed (exit ${r.status}): ${String(r.stderr || r.stdout).split('\n').filter((l) => /ERROR|error|429|rate/i.test(l)).slice(0, 2).join(' | ')}`);
    spawnSync('sleep', ['60']);
  }
  fs.rmSync(tmp, { force: true });
  return false;
}

// smaller exams first, so many finish early
const size = (id) => fs.readdirSync(path.join(DATA, id)).length;
const order = wanted.map((id) => ({ id, n: size(id) })).sort((a, b) => a.n - b.n);
log(`${order.length} exams, ${order.reduce((s, x) => s + x.n, 0)} files; ${dry ? 'DRY RUN' : 'uploading'}`);
const finished = new Set(Object.entries(state).filter(([, s]) => s.complete).map(([id]) => id));

for (const { id, n } of order) {
  const key = readJson(path.join(DATA, id, 'meta.json'), {}).key || '';
  if (!key) { log(`${id}: meta.json has no key, skipped`); continue; }
  if (state[id]?.key === key && state[id].complete) { finished.add(id); continue; }
  if (state[id]?.key !== key) state[id] = { key, files: n, chunks: 0, complete: false };
  finished.delete(id);
  const files = fs.readdirSync(path.join(DATA, id)).sort();
  const chunks = [];
  for (let i = 0; i < files.length; i += chunkSize) chunks.push(files.slice(i, i + chunkSize));
  log(`${id}: ${n} files in ${chunks.length} chunk(s), ${state[id].chunks} already done`);
  let ok = true;
  for (let c = state[id].chunks; c < chunks.length; c++) {
    const byType = {};
    for (const f of chunks[c]) { const t = TYPES[f.split('.').pop()]; if (!t) { log(`  unknown file type ${f}, skipped`); continue; } (byType[t] ||= []).push({ key: `${id}/${f}`, file: path.join(DATA, id, f) }); }
    if (!dry) for (const [t, list] of Object.entries(byType)) { if (!put(list, t)) ok = false; }
    if (!ok) break;
    state[id].chunks = c + 1; if (!dry) save();
  }
  if (ok) { state[id].complete = true; finished.add(id); if (!dry) save(); log(`${id}: done`); } else log(`${id}: NOT complete, will be tried again on the next run`);
}

// registry last, only with the exams that are fully in the bucket
const reg = readJson(path.join(DATA, 'registry.json'), null);
if (reg && !dry) {
  const filtered = { ...reg, exams: reg.exams.filter((e) => finished.has(e.id)) };
  const tmp = path.join(os.tmpdir(), 'registry-upload.json');
  fs.writeFileSync(tmp, JSON.stringify(filtered));
  const r = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/registry.json`, '--remote', '--file', tmp, '--content-type', 'application/json', '--cache-control', 'public, max-age=300'],
    { cwd: path.join(ROOT, 'results-worker'), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first', XDG_CONFIG_HOME: path.join(os.homedir(), '.config') } });
  log(r.status === 0 ? `registry.json uploaded with ${filtered.exams.length} of ${reg.exams.length} exams` : `registry.json FAILED: ${String(r.stderr).slice(0, 200)}`);
}
log(`finished: ${finished.size} of ${order.length} exams complete in the bucket`);
// exit 1 while anything is missing, so the systemd service (mayobe-r2-upload.service, Restart=on-failure) starts it again; 0 only when all is in the bucket
if (!dry && finished.size < order.length) process.exit(1);
