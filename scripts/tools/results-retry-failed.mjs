#!/usr/bin/env node
// Asks again for the centres that failed to download, and only those. Reads ~/necta-work/status/*.json (read-only except through the importer),
// picks the failures that can change, and runs scripts/necta-import.mjs --codes ... for each exam. One importer per host at a time
// (maktaba.tetea.org and onlinesys.necta.go.tz run side by side, 1 request per second each, as in the queues).
//   node scripts/tools/results-retry-failed.mjs [--404] [--exam csee-2021,psle-2018] [--dry]
// Retried: network errors, 5xx, blank or CDN error answers, pages that did not parse, and numbers from another school at the end of a page.
// Not retried: "no candidates found" (the source page itself is empty: checked live for CSEE 2003 and ACSEE 2007, the same blank page comes back)
// and, unless --404 is given, pages the server said do not exist (404 again after every retry so far).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const statusDir = path.join(os.homedir(), 'necta-work', 'status');
const argv = process.argv.slice(2);
const withNotFound = argv.includes('--404');
const dry = argv.includes('--dry');
const only = argv.includes('--exam') ? new Set(argv[argv.indexOf('--exam') + 1].split(',')) : null;

const queues = { maktaba: [], onlinesys: [] };
for (const f of fs.readdirSync(statusDir).filter((x) => x.endsWith('.json')).sort()) {
  const s = JSON.parse(fs.readFileSync(path.join(statusDir, f), 'utf8'));
  if (only && !only.has(s.id)) continue;
  const codes = Object.entries(s.failedList || {})
    .filter(([, v]) => !/no candidates found/.test(v.reason) && (withNotFound || !/HTTP 404/.test(v.reason)))
    .map(([c]) => c);
  if (codes.length) queues[/maktaba/.test(s.host) ? 'maktaba' : 'onlinesys'].push({ id: s.id, codes });
}
for (const [host, list] of Object.entries(queues)) console.log(`${host}: ${list.map((x) => `${x.id} (${x.codes.length})`).join(', ') || 'nothing to retry'}`);
if (dry) process.exit(0);

const runHost = (host, list) => new Promise((resolve) => {
  let i = 0;
  const next = () => {
    if (i >= list.length) return resolve();
    const { id, codes } = list[i++];
    console.log(`[${host}] ${id}: ${codes.length} centre(s)`);
    const p = spawn(process.execPath, ['--no-warnings', 'scripts/necta-import.mjs', '--exam', id, '--codes', codes.join(','), '--workers', '1', '--delay', '1000', '--retry-failed'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter((l) => /FAIL|done:/.test(l)).map((l) => `[${host}] ${l.trim()}\n`).join('')));
    p.on('close', next);
  };
  next();
});
await Promise.all(Object.entries(queues).map(([h, l]) => runHost(h, l)));
console.log('retry finished');
