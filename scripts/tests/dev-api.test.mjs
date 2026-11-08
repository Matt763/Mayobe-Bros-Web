// Local real-mail mode of scripts/dev-api.mjs (DEV_MAIL_REAL=1) and the honest test sends of scripts/mail-test.mjs.
// No real email is sent: Resend is a fake http.Server on 127.0.0.1 (DEV_RESEND_URL), the key is a made-up one in a vars
// file under $HOME/.cache/mb-dev-api-test/, and a tiny static server plays the local site that serves data/search.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEV_API = path.join(ROOT, 'scripts', 'dev-api.mjs');
const MAIL_TEST = path.join(ROOT, 'scripts', 'mail-test.mjs');
const DIR = path.join(os.homedir(), '.cache', 'mb-dev-api-test');
const KEY = 're_test_123';
const ALLOWED = 'owner@example.com';
fs.mkdirSync(DIR, { recursive: true });
const VARS = path.join(DIR, 'with-key.vars');
const NO_KEY = path.join(DIR, 'no-key.vars');
fs.writeFileSync(VARS, `ADMIN_TOKEN=x\nRESEND_API_KEY=${KEY}\nHASH_SALT=y\n`);
fs.writeFileSync(NO_KEY, 'ADMIN_TOKEN=secret-admin-value-987\nRESEND_API_KEY=\n');
const SEARCH = fs.readFileSync(path.join(ROOT, 'data', 'search.json'));

const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
const portOf = (s) => s.address().port;
async function freePort() { const s = await listen(() => {}); const p = portOf(s); await new Promise((r) => s.close(r)); return p; }

// Fake Resend: records every request (headers and parsed body) and answers 200 with an id.
const resendCalls = [];
const resend = await listen((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
    resendCalls.push({ url: req.url, headers: req.headers, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `fake-${resendCalls.length}` }));
  });
});
const RESEND_URL = `http://127.0.0.1:${portOf(resend)}/emails`;
// The "local site": only /data/search.json.
const site = await listen((req, res) => {
  if (req.url.startsWith('/data/search.json')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(SEARCH); }
  res.writeHead(404); res.end();
});
const SITE = `http://127.0.0.1:${portOf(site)}`;
test.after(() => { resend.close(); site.close(); });

const procs = new Set();
test.afterEach(() => { for (const p of procs) p.kill(); procs.clear(); });
const BASE_ENV = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || '' };

// Starts dev-api.mjs; resolves when it listens (or exits). out() is everything it printed on stdout and stderr.
async function startApi(extraEnv) {
  const port = await freePort();
  const p = spawn(process.execPath, ['--no-warnings', DEV_API, String(port), SITE], { env: { ...BASE_ENV, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.add(p);
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((resolve) => p.on('exit', (code) => resolve(code)));
  await Promise.race([exited, waitFor(() => out.includes('Dev API on'))]);
  return { port, out: () => out, exited, stop: async () => { p.kill(); await exited; } };
}
// The exit code, or 'still running' after a few seconds (so a script that ignores a refusal fails the test, not hangs it).
const exitOf = (api, ms = 5000) => Promise.race([api.exited, new Promise((r) => setTimeout(() => r('still running'), ms))]);
async function waitFor(cond, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
}
const realEnv = (more = {}) => ({ DEV_MAIL_REAL: '1', DEV_MAIL_ALLOW: ALLOWED, DEV_VARS_FILE: VARS, DEV_RESEND_URL: RESEND_URL, ...more });
const subscribe = (api, email) => fetch(`http://127.0.0.1:${api.port}/v1/newsletter/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify({ email, website: '', elapsed: 3000 }),
});
// One sign-up in a fresh run; resolves with the request the fake Resend got (or null) and the run's output.
async function signUpOnce(email, env = realEnv()) {
  const before = resendCalls.length;
  const api = await startApi(env);
  const r = await subscribe(api, email);
  assert.equal(r.status, 200);
  await waitFor(() => resendCalls.length > before || /\[mail\] not sent|\[\/mail\]/.test(api.out()));
  await waitFor(() => resendCalls.length > before, 300); // a forward may land just after the [mail] block is printed
  const out = api.out();
  await api.stop();
  return { call: resendCalls.length > before ? resendCalls[resendCalls.length - 1] : null, n: resendCalls.length - before, out };
}

test('DEV_MAIL_REAL without DEV_MAIL_ALLOW exits 1 and forwards nothing', async () => {
  const before = resendCalls.length;
  const api = await startApi(realEnv({ DEV_MAIL_ALLOW: '' }));
  assert.equal(await exitOf(api), 1);
  assert.match(api.out(), /DEV_MAIL_ALLOW/);
  assert.ok(!api.out().includes('Dev API on'));
  assert.equal(resendCalls.length, before);
  // and the forward address may only be Resend or loopback; both modes at once is refused too
  const foreign = await startApi(realEnv({ DEV_RESEND_URL: 'https://evil.example/emails' }));
  assert.equal(await exitOf(foreign), 1);
  const both = await startApi(realEnv({ DEV_MAIL_LOG: '1' }));
  assert.equal(await exitOf(both), 1);
  assert.match(both.out(), /not both/);
});

test('DEV_MAIL_REAL without a key line exits 1 and the message does not contain the file contents', async () => {
  for (const file of [NO_KEY, path.join(DIR, 'missing.vars')]) {
    const api = await startApi(realEnv({ DEV_VARS_FILE: file }));
    assert.equal(await exitOf(api), 1);
    assert.match(api.out(), /RESEND_API_KEY= line/);
    assert.ok(!api.out().includes('secret-admin-value-987'), 'file contents printed');
    assert.ok(!api.out().includes('Dev API on'));
  }
});

test('an allowed sign-up is forwarded once with the key, a dev- Idempotency-Key and links to the local site', async () => {
  const { call, n, out } = await signUpOnce(ALLOWED);
  assert.equal(n, 1, out);
  assert.equal(call.url, '/emails');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.match(call.headers['idempotency-key'], /^dev-[0-9a-z]+-nl-confirm-1-/);
  assert.deepEqual(call.body.to, [ALLOWED]);
  assert.ok(call.body.html.includes(`${SITE}/newsletter/#c=`), 'button opens the local site');
  assert.ok(call.body.text.includes(`${SITE}/newsletter/#c=`));
  assert.ok(call.body.html.includes('src="https://mayobebros.com/assets/email/logo.png"'), 'logo from the live site, on https');
  assert.ok(!/src="http:/.test(call.body.html), 'no http picture');
  assert.match(out, /REAL MAIL ON: only to owner@example\.com\. Links open http:\/\/127\.0\.0\.1:\d+\. Do not use your mail app's own Unsubscribe button/);
  assert.match(out, /\[mail\] to=owner@example\.com subject="Please confirm your Mayobe Bros subscription"/);
});

test('an address not in DEV_MAIL_ALLOW is printed but not forwarded', async () => {
  const { n, out } = await signUpOnce('stranger@example.com');
  assert.equal(n, 0);
  assert.match(out, /\[mail\] to=stranger@example\.com/);
  assert.match(out, /\[mail\] not sent \(not in DEV_MAIL_ALLOW\)/);
});

test('the key never appears in stdout or stderr', async () => {
  const a = await signUpOnce(ALLOWED);
  const b = await signUpOnce('stranger@example.com');
  for (const out of [a.out, b.out]) {
    assert.ok(!out.includes(KEY), 'key printed');
    assert.ok(!/authorization/i.test(out), 'Authorization printed');
  }
});

test('two runs give subscriber 1 different Idempotency-Keys', async () => {
  const a = await signUpOnce(ALLOWED);
  await new Promise((r) => setTimeout(r, 5)); // the run prefix is the start time in ms
  const b = await signUpOnce(ALLOWED);
  for (const x of [a, b]) assert.match(x.call.headers['idempotency-key'], /^dev-[0-9a-z]+-nl-confirm-1-/);
  assert.notEqual(a.call.headers['idempotency-key'], b.call.headers['idempotency-key']);
  // the part after the prefix is the Worker's own key, unchanged
  const tail = (k) => k.replace(/^dev-[0-9a-z]+-/, '');
  assert.equal(tail(a.call.headers['idempotency-key']), tail(b.call.headers['idempotency-key']));
});

test('DEV_MAIL_LOG=1 still fakes the send and forwards nothing', async () => {
  // the same vars file and forward address are present, but the log mode ignores them
  const { n, out } = await signUpOnce(ALLOWED, { DEV_MAIL_LOG: '1', DEV_VARS_FILE: VARS, DEV_RESEND_URL: RESEND_URL });
  assert.equal(n, 0);
  assert.match(out, /\[mail\] to=owner@example\.com/);
  assert.ok(!out.includes('REAL MAIL ON'));
  assert.ok(!out.includes(KEY));
});

/* ------------------------------------------------------------------ scripts/mail-test.mjs */

const runMailTest = (args) => new Promise((resolve) => {
  execFile(process.execPath, ['--no-warnings', MAIL_TEST, ...args], { env: BASE_ENV, cwd: ROOT }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
});

test('mail-test refuses /newsletter/ and /manage/ templates without --pages-live', async () => {
  for (const name of ['manage-link', 'reply-notice', 'confirm-subscription', 'welcome', 'new-post', 'new-post-video', 'farewell']) {
    const r = await runMailTest([name, 'owner@example.com', '--yes']);
    assert.equal(r.code, 1, name);
    assert.match(r.stderr, /This email links to \/newsletter\/ or \/manage\/, which are not on the live site until they are pushed\. Use --pages-live once they are, or try the flow locally with DEV_MAIL_REAL=1 \(worker\/README\.md\)\./, name);
    assert.ok(!/sent:/.test(r.stdout), name);
  }
  // with --pages-live it gets past the guard and stops at the missing key (nothing sent)
  const r = await runMailTest(['welcome', 'owner@example.com', '--yes', '--pages-live']);
  assert.ok(!r.stderr.includes('This email links to'));
  assert.match(r.stdout, /not sent: template=welcome skipped=no-key/);
});

test('mail-test --dry new-post links an article path that is in search.json', async () => {
  const paths = new Set(JSON.parse(SEARCH).map((e) => e.u));
  for (const name of ['new-post', 'new-post-video', 'welcome']) {
    const r = await runMailTest([name, '--dry']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^subject: [A-Z]/);
    assert.doesNotMatch(r.stdout, /\[\s*test\s*\]/i, `${name}: no test label in the subject or text`);
    const links = [...r.stdout.matchAll(/https:\/\/mayobebros\.com(\/post\/[a-z0-9/-]+\/)/g)].map((m) => m[1]).filter((u) => u !== '/post/');
    assert.ok(links.length, `${name}: no article link`);
    for (const u of links) assert.ok(paths.has(u), `${name}: ${u} is not in search.json`);
  }
  const v = await runMailTest(['new-post-video', '--dry']);
  assert.match(v.stdout, /Watch the video: https:\/\/mayobebros\.com\/post\/[a-z0-9/-]+\/#video-1/);
  // the old wrong path is gone
  assert.ok(!(await runMailTest(['new-post', '--dry'])).stdout.includes('/post/ajira-portal-how-to-apply-public-service-jobs/'));
});
