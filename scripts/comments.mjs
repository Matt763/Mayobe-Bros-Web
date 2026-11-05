#!/usr/bin/env node
// Moderate comments from the terminal. Needs the Worker to be deployed (see worker/README.md).
//
//   node scripts/comments.mjs list [pending|approved|spam]      show comments (default: pending)
//   node scripts/comments.mjs approve <id> [<id> ...]           publish comments
//   node scripts/comments.mjs spam <id> [<id> ...]              hide as spam (replies too)
//   node scripts/comments.mjs delete <id> [<id> ...]            remove for good (replies too)
//   node scripts/comments.mjs reply <id> "text" ["Name"]         publish a reply from the team under comment <id> (shows a Team badge)
//
// The admin token is read from the ADMIN_TOKEN environment variable, or from the file
// ".admin-token" in the project root (that file is git-ignored; never commit it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const api = (process.env.MAYOBE_API || cfg.commentsApi || '').replace(/\/$/, '');
let token = process.env.ADMIN_TOKEN || '';
if (!token && fs.existsSync(path.join(ROOT, '.admin-token'))) token = fs.readFileSync(path.join(ROOT, '.admin-token'), 'utf8').trim();

const [cmd = 'list', ...rest] = process.argv.slice(2);
if (!api) { console.error('No API address. Set "commentsApi" in site.config.json (or MAYOBE_API) after deploying the Worker.'); process.exit(1); }
if (!token) { console.error('No admin token. Set ADMIN_TOKEN, or save it in a file named .admin-token in the project root.'); process.exit(1); }

async function call(method, p, body) {
  const r = await fetch(`${api}/v1${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error || r.statusText}`);
  return j;
}

try {
  if (cmd === 'list') {
    const status = rest[0] || 'pending';
    const { comments } = await call('GET', `/admin/comments?status=${encodeURIComponent(status)}&limit=100`);
    if (!comments.length) console.log(`No ${status} comments.`);
    for (const c of comments) {
      console.log(`#${c.id}  [${c.status}]  ${new Date(c.created).toISOString().slice(0, 16).replace('T', ' ')}  on "${c.slug}"${c.parent_id ? `  (reply to #${c.parent_id})` : ''}`);
      console.log(`   ${c.name}${c.email ? ` <${c.email}>` : ''}: ${c.body.replace(/\n/g, ' ')}`);
      if (c.flag) console.log(`   held because: ${c.flag}`);
      console.log('');
    }
  } else if (['approve', 'spam', 'delete'].includes(cmd)) {
    if (!rest.length) throw new Error(`Give at least one comment id, e.g. "${cmd} 12".`);
    for (const id of rest) {
      const j = await call('POST', `/admin/comments/${Number(id)}`, { action: cmd });
      console.log(`#${id}: ${cmd} ok (post now has ${j.stats.c} approved comment${j.stats.c === 1 ? '' : 's'})`);
    }
  } else if (cmd === 'reply') {
    const [id, text, name] = rest;
    if (!id || !text) throw new Error('Usage: reply <comment id> "your reply" ["Display name"]');
    const j = await call('POST', '/admin/reply', { parent: Number(id), body: text, ...(name ? { name } : {}) });
    console.log(`#${j.comment.id}: team reply published under #${id} (post now has ${j.stats.c} comment${j.stats.c === 1 ? '' : 's'})`);
  } else throw new Error(`Unknown command "${cmd}". Use: list, approve, spam, delete, reply.`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
