#!/usr/bin/env node
// Newsletter tools for the owner. Needs the Worker to be deployed (see worker/README.md).
//
//   node scripts/newsletter.mjs list [active|pending|unsubscribed|all] [--csv]   subscribers (default: active)
//   node scripts/newsletter.mjs count                                          totals, today's news units, posts still being sent
//   node scripts/newsletter.mjs remove <email>                                 delete one address with its tokens and send log
//   node scripts/newsletter.mjs dry-run                                        what the next run would do; changes nothing, sends nothing
//   node scripts/newsletter.mjs seed                                           record the posts now listed as already handled (sends nothing)
//
// Sending is done only by the daily Cron Trigger. The admin token is read as in scripts/comments.mjs
// (ADMIN_TOKEN, or the git-ignored file ".admin-token").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const api = (process.env.MAYOBE_API || cfg.commentsApi || '').replace(/\/$/, '');
let token = process.env.ADMIN_TOKEN || '';
const tokenFile = process.env.ADMIN_TOKEN_FILE || path.join(ROOT, '.admin-token'); // (the override exists for the tests)
if (!token && fs.existsSync(tokenFile)) token = fs.readFileSync(tokenFile, 'utf8').trim();

const safe = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, ' '); // addresses are typed by visitors: no terminal escape sequences reach the screen
const args = process.argv.slice(2);
const csv = args.includes('--csv');
const [cmd = 'list', ...rest] = args.filter((a) => a !== '--csv');
if (!api) { console.error('No API address. Set "commentsApi" in site.config.json (or MAYOBE_API) after deploying the Worker.'); process.exit(1); }
if (!token) { console.error('No admin token. Set ADMIN_TOKEN, or save it in a file named .admin-token in the project root.'); process.exit(1); }

async function call(method, p, body) {
  const r = await fetch(`${api}/v1${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${safe(j.error || r.statusText)}`);
  return j;
}
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const csvCell = (s) => { let v = safe(s); if (/^[=+\-@]/.test(v)) v = `'${v}`; return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v; }; // a spreadsheet must not run an address as a formula

function show(r) {
  console.log(`mode: ${safe(r.paused ? 'paused (NEWSLETTER_SEND is not "true")' : 'sending on')}`);
  console.log(`articles to send: ${(r.posts || []).map((p) => `${safe(p.slug)} (${safe(p.recipients)} recipients)`).join(', ') || 'none'}`);
  console.log(`seeded: ${safe((r.seeded || []).length ? [].concat(r.seeded).join(', ') : 'none')}`);
  console.log(`too old, recorded and never emailed: ${safe((r.tooOld || []).join(', ') || 'none')}`);
  if (r.stopped) console.log(`stopped: ${safe(r.stopped)}`);
}

try {
  if (cmd === 'list') {
    const status = rest[0] || 'active';
    const { subscribers } = await call('GET', `/admin/newsletter?status=${encodeURIComponent(status)}&limit=500`);
    if (csv) {
      console.log('id,email,status,created,confirmed,unsubscribed');
      for (const s of subscribers) console.log([s.id, s.email, s.status, day(s.created), day(s.confirmed), day(s.unsubscribed)].map(csvCell).join(','));
    } else {
      if (!subscribers.length) console.log(`No ${safe(status)} subscribers.`);
      for (const s of subscribers) console.log(`#${safe(s.id)}  [${safe(s.status)}]  ${safe(s.email)}  signed up ${day(s.created)}${s.confirmed ? `  confirmed ${day(s.confirmed)}` : ''}${s.unsubscribed ? `  left ${day(s.unsubscribed)}` : ''}`);
    }
  } else if (cmd === 'count') {
    const c = await call('GET', '/admin/newsletter/count');
    console.log(`active ${safe(c.active)}, waiting to confirm ${safe(c.pending)}, unsubscribed ${safe(c.unsubscribed)}`);
    console.log(`news mail units used today (UTC): ${safe(c.newsToday)} of ${safe(c.newsCap)}`);
    console.log(c.paused ? 'sending of new-article emails is paused (NEWSLETTER_SEND is not "true")' : 'sending of new-article emails is on');
    if (!c.queue.length) console.log('no article is being sent now');
    for (const q of c.queue) console.log(`being sent: ${safe(q.slug)}  sent ${safe(q.sent)}, still to send ${safe(q.left)}`);
  } else if (cmd === 'remove') {
    if (!rest[0]) throw new Error('Usage: remove <email>');
    const j = await call('POST', '/admin/newsletter/remove', { email: rest[0] });
    console.log(`removed ${safe(j.removed)}`);
  } else if (cmd === 'dry-run' || cmd === 'seed') {
    show(await call('POST', '/admin/newsletter/run', { mode: cmd === 'seed' ? 'seed' : 'dry' }));
  } else throw new Error(`Unknown command "${safe(cmd)}". Use: list, count, remove, dry-run, seed.`);
} catch (err) {
  console.error(`✖ ${safe(err.message)}`);
  process.exit(1);
}
