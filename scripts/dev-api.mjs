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
import fs from 'node:fs';
import http from 'node:http';
import worker from '../worker/src/index.js';
import { makeD1 } from './lib/d1-shim.mjs';

const port = Number(process.argv[2] || 8787);
const sites = process.argv.slice(3).length ? process.argv.slice(3) : ['http://127.0.0.1:8000'];
const env = { DB: makeD1(), ADMIN_TOKEN: 'dev-admin-token-1234', HASH_SALT: 'dev', ALLOWED_ORIGINS: sites.join(','), SITE_ORIGIN: sites[0] };

if (process.env.DEV_MAIL_LOG === '1') {
  env.RESEND_API_KEY = 'dev';
  env.SITE_ORIGIN = 'https://mayobebros.com';
  env.API_ORIGIN = `http://127.0.0.1:${port}`;
  env.NEWSLETTER_SEND = 'true';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url instanceof Request ? url.url : url);
    if (target === 'https://mayobebros.com/data/search.json') return new Response(fs.readFileSync(new URL('../data/search.json', import.meta.url)), { headers: { 'Content-Type': 'application/json' } });
    if (!target.startsWith('https://api.resend.com/')) return realFetch(url, init);
    let m = {};
    try { m = JSON.parse(init.body || '{}'); } catch { /* not JSON */ }
    const hdr = m.headers && typeof m.headers === 'object' ? Object.entries(m.headers).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n' : '';
    console.log(`[mail] to=${[].concat(m.to || []).join(',')} subject=${JSON.stringify(m.subject || '')}\n${hdr}${String(m.text || '').replaceAll('https://mayobebros.com', sites[0])}\n[/mail]`);
    return new Response(JSON.stringify({ id: `dev-${Date.now()}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__dev/cron') {
    if (process.env.DEV_MAIL_LOG !== '1') { res.writeHead(404); return res.end('Only with DEV_MAIL_LOG=1'); }
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
}).listen(port, '127.0.0.1', () => console.log(`Dev API on http://127.0.0.1:${port}  (allowed sites: ${sites.join(', ')})`));
