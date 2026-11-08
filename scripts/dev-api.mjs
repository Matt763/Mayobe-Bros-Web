#!/usr/bin/env node
// Runs the comments/reactions Worker locally with an in-memory database, for trying the site without Cloudflare.
//   node --no-warnings scripts/dev-api.mjs [port] [site-origin ...]
// Data disappears when you stop it. Moderation token for testing: dev-admin-token-1234
// DEV_MAIL_LOG=1 node --no-warnings scripts/dev-api.mjs   also switches mail on with a fake Resend: nothing is sent, and every
//   message the Worker would send is printed (to, subject, text part) so the emailed links can be copied. Default behaviour is unchanged.
//   The email templates only accept https links, so in this mode the Worker is told the site is https://mayobebros.com; the printed text
//   has that address swapped for the local site (the first site-origin argument), and the article list is read from ./data/search.json.
//   In this mode the newsletter is also on: API_ORIGIN and NEWSLETTER_SEND are set, the [mail] block prints the List-Unsubscribe headers, and
//   POST /__dev/cron (answered here, not by the Worker) runs the daily newsletter job once and prints its report. The first call seeds.
//
// DEV_MAIL_REAL=1 DEV_MAIL_ALLOW=you@example.com node --no-warnings scripts/dev-api.mjs [port] [site-origin]
//   sends REAL email through Resend, for the owner to try the whole flow on a phone. Only to the addresses in DEV_MAIL_ALLOW
//   (comma-separated); any other recipient is printed as "not sent" and answered with a fake 200. SITE_ORIGIN is the first
//   site-origin (default http://127.0.0.1:8000, run `node scripts/serve.mjs`), so the emailed buttons open the LOCAL site, and
//   search.json is read from it; pictures still come from https://mayobebros.com/assets/email/. The key is read from the
//   RESEND_API_KEY= line of worker/.dev.vars (DEV_VARS_FILE overrides) and is never printed. Every Idempotency-Key gets a
//   per-run prefix, because the in-memory database starts its ids again at 1 and Resend answers 409 to a reused key with
//   another body. DEV_RESEND_URL (tests only) may point the forward at http://127.0.0.1:<port>/. POST /__dev/cron works here too.
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import worker from '../worker/src/index.js';
import { makeD1 } from './lib/d1-shim.mjs';

const port = Number(process.argv[2] || 8787);
const sites = process.argv.slice(3).length ? process.argv.slice(3) : ['http://127.0.0.1:8000'];
const env = { DB: makeD1(), ADMIN_TOKEN: 'dev-admin-token-1234', REVIEW_SECRET: 'dev-review-secret-for-local-tests-only', REVIEW_EMAILS: 'review@example.test', HASH_SALT: 'dev', ALLOWED_ORIGINS: sites.join(','), SITE_ORIGIN: sites[0] };
const LOG = process.env.DEV_MAIL_LOG === '1';
const REAL = process.env.DEV_MAIL_REAL === '1';
const RESEND = 'https://api.resend.com/emails';
const die = (msg) => { console.error(msg); process.exit(1); };
const realFetch = globalThis.fetch;
const urlOf = (url) => String(url instanceof Request ? url.url : url);
// The [mail] block: to, subject, headers and the text part. Never the Authorization header or the key.
function printMail(m, text) {
  const hdr = m.headers && typeof m.headers === 'object' ? Object.entries(m.headers).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n' : '';
  console.log(`[mail] to=${[].concat(m.to || []).join(',')} subject=${JSON.stringify(m.subject || '')}\n${hdr}${text}\n[/mail]`);
}
const fake200 = (id) => new Response(JSON.stringify({ id }), { status: 200, headers: { 'Content-Type': 'application/json' } });

if (LOG && REAL) die('Use DEV_MAIL_LOG=1 (prints mail, sends nothing) or DEV_MAIL_REAL=1 (sends real mail), not both.');

if (LOG) {
  env.RESEND_API_KEY = 'dev';
  env.SITE_ORIGIN = 'https://mayobebros.com';
  env.API_ORIGIN = `http://127.0.0.1:${port}`;
  env.NEWSLETTER_SEND = 'true';
  globalThis.fetch = async (url, init = {}) => {
    const target = urlOf(url);
    if (target === 'https://mayobebros.com/data/search.json') return new Response(fs.readFileSync(new URL('../data/search.json', import.meta.url)), { headers: { 'Content-Type': 'application/json' } });
    if (!target.startsWith('https://api.resend.com/')) return realFetch(url, init);
    let m = {};
    try { m = JSON.parse(init.body || '{}'); } catch { /* not JSON */ }
    printMail(m, String(m.text || '').replaceAll('https://mayobebros.com', sites[0]));
    return fake200(`dev-${Date.now()}`);
  };
}

if (REAL) {
  const allow = String(process.env.DEV_MAIL_ALLOW || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allow.length) die('DEV_MAIL_REAL=1 needs DEV_MAIL_ALLOW=you@example.com (the only addresses real mail may go to). Nothing was started.');
  const varsFile = process.env.DEV_VARS_FILE || fileURLToPath(new URL('../worker/.dev.vars', import.meta.url));
  let key = '';
  try {
    const line = fs.readFileSync(varsFile, 'utf8').split(/\r?\n/).find((l) => /^\s*RESEND_API_KEY\s*=/.test(l));
    key = line ? line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2').trim() : '';
  } catch { key = ''; }
  // The message names the file only: never its contents.
  if (!key) die(`DEV_MAIL_REAL=1 needs a RESEND_API_KEY= line with a value in ${varsFile}. Nothing was started.`);
  const resendUrl = process.env.DEV_RESEND_URL || RESEND;
  if (resendUrl !== RESEND && !/^http:\/\/127\.0\.0\.1:\d+\//.test(resendUrl)) die(`DEV_RESEND_URL must be ${RESEND} or http://127.0.0.1:<port>/... Nothing was started.`);
  env.RESEND_API_KEY = key;
  env.API_ORIGIN = `http://127.0.0.1:${port}`;
  env.NEWSLETTER_SEND = 'true';
  const run = Date.now().toString(36);
  globalThis.fetch = async (url, init = {}) => {
    const target = urlOf(url);
    if (!target.startsWith('https://api.resend.com/')) return realFetch(url, init);
    let m = {};
    try { m = JSON.parse(init.body || '{}'); } catch { /* not JSON */ }
    printMail(m, String(m.text || ''));
    const to = [].concat(m.to || [], m.cc || [], m.bcc || []).map((s) => String(s).trim().toLowerCase());
    if (!to.length || target !== RESEND || to.some((a) => !allow.includes(a))) {
      console.log('[mail] not sent (not in DEV_MAIL_ALLOW)');
      return fake200(`dev-not-sent-${Date.now()}`);
    }
    const headers = new Headers(init.headers || {});
    headers.set('Idempotency-Key', `dev-${run}-${headers.get('Idempotency-Key') || Date.now()}`.slice(0, 256));
    const r = await realFetch(resendUrl, { ...init, headers });
    console.log(`[mail] forwarded to Resend: status ${r.status}`);
    return r;
  };
  console.log(`REAL MAIL ON: only to ${allow.join(', ')}. Links open ${sites[0]}. Do not use your mail app's own Unsubscribe button (it cannot reach this computer).`);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__dev/cron') {
    if (!LOG && !REAL) { res.writeHead(404); return res.end('Only with DEV_MAIL_LOG=1 or DEV_MAIL_REAL=1'); }
    try {
      const pending = [];
      await worker.scheduled({ cron: 'dev', scheduledTime: Date.now() }, env, { waitUntil: (p) => pending.push(p) });
      const reports = await Promise.all(pending);
      const report = reports.find((r) => r && typeof r === 'object' && 'paused' in r) ?? null;
      console.log(`[cron] ${JSON.stringify(report)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(report));
    } catch (err) {
      console.error('[cron] failed', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, { waitUntil() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
server.listen(port, '127.0.0.1', () => console.log(`Dev API on http://127.0.0.1:${port}  (allowed sites: ${sites.join(', ')})`));
