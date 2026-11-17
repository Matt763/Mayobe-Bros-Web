// Fast upload of results-data/ to the R2 bucket with rclone (S3 API token, remote "r2"). Replaces r2-upload-results.mjs (wrangler, ~4 objects/s).
// - Which exams: every exam in site.config.json resultsData.datasets that has results-data/<exam>/meta.json (partial exams are not in datasets).
// - Skips files already in the bucket (--checksum: single-part ETag = md5). Safe to run again after more exams are packed.
// - registry.json goes LAST, filtered to the exams that are in the bucket (the Worker never lists an exam whose files are not all there).
// Run detached: bash scripts/tools/r2-rclone-detached.sh run|status|stop
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'results-data');
const RCLONE = path.join(os.homedir(), 'tools', 'rclone');
const BUCKET = 'r2:mayobe-results-data';
const log = (m) => console.log(`${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${m}`);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const exams = Object.keys(cfg.resultsData.datasets || {}).filter((id) => fs.existsSync(path.join(DATA, id, 'meta.json'))).sort();
const list = path.join(os.tmpdir(), 'r2-rclone-include.txt');
fs.writeFileSync(list, exams.map((id) => `/${id}/**`).join('\n') + '\n');
log(`${exams.length} exams to sync`);
const r = spawnSync(RCLONE, ['copy', DATA, BUCKET, '--include-from', list, '--checksum', '--transfers', '32', '--checkers', '32', '--s3-upload-concurrency', '4',
  '--retries', '5', '--low-level-retries', '20', '--stats', '60s', '--stats-one-line', '-v', '--s3-no-check-bucket'], { stdio: 'inherit' });
if (r.status !== 0) { log(`rclone exit ${r.status}: registry NOT uploaded`); process.exit(1); }
const reg = JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8'));
const done = new Set(exams);
const filtered = { ...reg, exams: reg.exams.filter((e) => done.has(e.id)) };
const tmp = path.join(os.tmpdir(), 'registry-upload.json');
fs.writeFileSync(tmp, JSON.stringify(filtered));
const g = spawnSync(RCLONE, ['copyto', tmp, `${BUCKET}/registry.json`, '--header-upload', 'Cache-Control: public, max-age=300', '--header-upload', 'Content-Type: application/json', '--s3-no-check-bucket'], { stdio: 'inherit' });
log(g.status === 0 ? `registry.json uploaded with ${filtered.exams.length} of ${reg.exams.length} exams` : 'registry.json FAILED');
process.exit(g.status === 0 ? 0 : 1);
