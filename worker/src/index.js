// Mayobe Bros comments + reactions API.  Cloudflare Worker + D1 (SQLite).  No dependencies.
//
//   GET  /v1/stats?slugs=a,b,c              counts for many posts at once (browser-cached 10 s)
//   GET  /v1/posts/:slug                    approved comments (+ a blank "deleted" placeholder for a deleted comment that has replies) + counts (always fresh)
//   GET  /v1/posts/:slug/mine?cid=<id>      this visitor's own reaction (never cached)
//   POST /v1/posts/:slug/react              { cid, type: "like"|"amazed"|"sad"|"angry"|null }
//   POST /v1/posts/:slug/comments           { name, email?, body, parent?, cid, website (honeypot), ts }  -> { ok, status, comment, id, token }
//                                           `token` is the commenter's secret to edit or delete this comment; it is shown once (only its SHA-256 is stored)
//   POST /v1/comments/:id/edit              { token, body }       change your own comment: within 30 minutes, until it has a reply; the screen runs again
//   POST /v1/comments/:id/delete            { token }             delete your own comment (a comment with replies stays as "This comment was deleted.")
//   POST /v1/comments/:id/like              { cid, on: true|false }  like or unlike any published comment, once per visitor
//   GET  /v1/admin/comments?status=pending  (Authorization: Bearer ADMIN_TOKEN)
//   POST /v1/admin/comments/:id             { action: "approve" | "spam" | "delete" }
//   POST /v1/admin/reply                    { parent, body, name? }  a published reply from the team (shows a Team badge)
//
// A comment is screened automatically (worker/src/moderation.js: English + Swahili abusive words, scam lines, contact details,
// shouting). A clean comment is published at once ("approved"); a flagged one is held as "pending" until the owner approves it.
// Set the variable AUTO_APPROVE to "false" to hold every comment again (for example during a spam wave).

import { screen, looksLikeTeam } from './moderation.js';

export const REACTIONS = ['like', 'amazed', 'sad', 'angry'];
const COL = { like: 'r_like', amazed: 'r_amazed', sad: 'r_sad', angry: 'r_angry' };
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CID_RE = /^[A-Za-z0-9-]{16,64}$/;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|info|biz|xyz|top|click|link|ru|cn|co\.tz|go\.tz|tk|ml|ga|cf|gq)\b|t\.me\/|bit\.ly)/i;
const MAX_BODY = 4000;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const NOT_FOUND = 'That comment could not be found.'; // the one answer for a wrong token, a missing comment, a team comment and so on, so nothing can be probed

const enc = new TextEncoder();
const now = () => Date.now();

function origins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://mayobebros.com,https://www.mayobebros.com').split(',').map((s) => s.trim()).filter(Boolean);
}
function corsFor(request, env) {
  const o = request.headers.get('Origin');
  if (!o || !origins(env).includes(o)) return {};
  return { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };
}
function reply(body, status, cors, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache || 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors },
  });
}
const fail = (msg, status, cors) => reply({ error: msg }, status, cors);

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function ipHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  return (await sha(`${ip}|${env.HASH_SALT || 'mayobe'}|${day}`)).slice(0, 24); // rotates daily; raw IPs are never stored
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// A random secret for one comment: 24 random bytes as base64url (32 characters, no padding).
async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// The comment with this id, only if `token` is its owner's token and it is still approved or pending; otherwise null.
// The supplied token is hashed even when the id does not exist, so the time taken does not reveal whether a comment exists.
async function ownerRow(env, id, token) {
  const given = typeof token === 'string' ? token : '';
  const givenHash = await sha(given);
  const row = Number.isInteger(id) && id > 0
    ? await env.DB.prepare('SELECT id, slug, parent_id, status, created, body, cid, ip_hash, name, edited_at, manage_hash FROM comments WHERE id = ?').bind(id).first()
    : null;
  const match = same(givenHash, row?.manage_hash || '0'.repeat(64)); // a comment with no hash (older, or from the team) is compared with zeros and never matches
  if (!row || !row.manage_hash || !match || !TOKEN_RE.test(given) || !['approved', 'pending'].includes(row.status)) return null;
  const { manage_hash, ...own } = row; // the hash never leaves this function
  return own;
}
// A reply counts when it is approved or still waiting for review.
async function hasReplies(env, id) {
  return !!(await env.DB.prepare("SELECT 1 AS ok FROM comments WHERE parent_id = ? AND status IN ('approved', 'pending') LIMIT 1").bind(id).first());
}
// Cleans a comment's name and text the way they are stored, and checks length and links. Shared by the create and edit routes.
// Returns { name, body } or { error } (a message for a 400).
function cleanComment(rawName, rawBody) {
  const name = String(rawName || '').normalize('NFKC').replace(/\p{Cf}+/gu, '').replace(/\s+/g, ' ').trim(); // stored exactly as it was checked: no invisible characters
  const body = String(rawBody || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (name.length < 2 || name.length > 50) return { error: 'Please enter your name (2 to 50 characters).' };
  if (body.length < 3) return { error: 'Your comment is too short.' };
  if (body.length > 1500) return { error: 'Your comment is too long (1,500 characters at most).' };
  if (LINK_RE.test(body) || LINK_RE.test(name)) return { error: 'Links are not allowed in comments.' };
  return { name, body };
}
function isAdmin(request, env) {
  const t = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return !!env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 16 && same(t, env.ADMIN_TOKEN);
}
async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object') throw 0;
    return v;
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
}

// Counts how often a key was used; returns false once the limit for the window is passed.
async function hit(env, ctx, key, limit, ttlSec) {
  const row = await env.DB.prepare('INSERT INTO hits(k, n, expires) VALUES(?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(key, now() + ttlSec * 1000).first();
  if (Math.random() < 0.02 && ctx?.waitUntil) ctx.waitUntil(env.DB.prepare('DELETE FROM hits WHERE expires < ?').bind(now()).run());
  return (row?.n || 1) <= limit;
}

// A slug is valid if it is already known, or if the live site lists it (checked once, then remembered).
async function slugKnown(env, slug) {
  if (!SLUG_RE.test(slug) || slug.length > 140) return false;
  if (await env.DB.prepare('SELECT 1 AS ok FROM posts WHERE slug = ?').bind(slug).first()) return true;
  const origin = String(env.SITE_ORIGIN || 'https://mayobebros.com').replace(/\/$/, '');
  let list;
  try {
    const r = await fetch(`${origin}/data/search.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return false;
    list = await r.json();
  } catch {
    return false;
  }
  if (!Array.isArray(list) || !list.some((p) => p && p.s === slug)) return false;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO posts(slug, created) VALUES(?, ?)').bind(slug, now()),
    env.DB.prepare('INSERT OR IGNORE INTO post_stats(slug) VALUES(?)').bind(slug),
  ]);
  return true;
}

const statsOf = (r) => ({ c: r?.comments || 0, r: { like: r?.r_like || 0, amazed: r?.r_amazed || 0, sad: r?.r_sad || 0, angry: r?.r_angry || 0 } });
const STAT_COLS = 'slug, comments, r_like, r_amazed, r_sad, r_angry';

async function getStats(env, slug) {
  return statsOf(await env.DB.prepare(`SELECT ${STAT_COLS} FROM post_stats WHERE slug = ?`).bind(slug).first());
}

/* ------------------------------------------------------------------ routes */
async function handle(request, env, ctx) {
  const cors = corsFor(request, env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (path === '/' || path === '/v1') return reply({ ok: true, service: 'mayobe-bros-engage' }, 200, cors, 'public, max-age=300');

  // Browsers always send Origin on cross-site POSTs. Refuse any that is not our site.
  if (method === 'POST' && !path.startsWith('/v1/admin/')) {
    const o = request.headers.get('Origin');
    if (!o || !origins(env).includes(o)) return fail('Origin not allowed.', 403, cors);
  }

  let m;
  if (method === 'GET' && path === '/v1/stats') {
    const slugs = (url.searchParams.get('slugs') || '').split(',').map((s) => s.trim()).filter((s) => SLUG_RE.test(s)).slice(0, 60);
    const out = {};
    if (slugs.length) {
      const rows = await env.DB.prepare(`SELECT ${STAT_COLS} FROM post_stats WHERE slug IN (${slugs.map(() => '?').join(',')})`).bind(...slugs).all();
      const by = Object.fromEntries((rows.results || []).map((r) => [r.slug, r]));
      for (const s of slugs) out[s] = statsOf(by[s]);
    }
    return reply(out, 200, cors, 'public, max-age=10');
  }

  if ((m = path.match(/^\/v1\/posts\/([^/]+)$/)) && method === 'GET') {
    const slug = m[1];
    if (!(await slugKnown(env, slug))) return fail('Unknown post.', 404, cors);
    const rows = await env.DB.prepare("SELECT id, parent_id, name, body, created, team, likes, edited_at, status FROM comments WHERE slug = ? AND status IN ('approved', 'deleted') ORDER BY created ASC LIMIT 500").bind(slug).all();
    const all = rows.results || [];
    // a deleted comment that still has replies stays as a blank tombstone (its text and name were erased when it was deleted)
    const pub = (c) => c.status === 'deleted'
      ? { id: c.id, name: '', body: 'This comment was deleted.', at: c.created, deleted: true, likes: 0 }
      : { id: c.id, name: c.name, body: c.body, at: c.created, likes: c.likes || 0, ...(c.edited_at ? { edited: c.edited_at } : {}), ...(c.team ? { team: true } : {}) };
    const tops = all.filter((c) => !c.parent_id).map((c) => ({ ...pub(c), replies: [] }));
    const byId = Object.fromEntries(tops.map((c) => [c.id, c]));
    for (const c of all) if (c.parent_id && byId[c.parent_id]) byId[c.parent_id].replies.push(pub(c));
    tops.reverse(); // newest conversation first, replies oldest first
    // always revalidate: a visitor who just reacted or whose comment was just approved must see it on reload
    return reply({ stats: await getStats(env, slug), comments: tops }, 200, cors, 'no-cache');
  }

  if ((m = path.match(/^\/v1\/posts\/([^/]+)\/mine$/)) && method === 'GET') {
    const cid = url.searchParams.get('cid') || '';
    if (!CID_RE.test(cid)) return reply({ reaction: null }, 200, cors);
    const row = await env.DB.prepare('SELECT type FROM reactions WHERE slug = ? AND cid = ?').bind(m[1], cid).first();
    return reply({ reaction: row?.type || null }, 200, cors);
  }

  if ((m = path.match(/^\/v1\/posts\/([^/]+)\/react$/)) && method === 'POST') {
    const slug = m[1];
    const b = await readJson(request);
    const type = b.type === null || b.type === undefined ? null : String(b.type);
    if (type !== null && !REACTIONS.includes(type)) return fail('Unknown reaction.', 400, cors);
    if (!CID_RE.test(String(b.cid || ''))) return fail('Missing visitor id.', 400, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `r:${ih}:${Math.floor(now() / 600000)}`, 60, 700))) return fail('Too many reactions. Please wait a few minutes.', 429, cors);
    if (!(await slugKnown(env, slug))) return fail('Unknown post.', 404, cors);
    const old = (await env.DB.prepare('SELECT type FROM reactions WHERE slug = ? AND cid = ?').bind(slug, b.cid).first())?.type || null;
    if (old !== type) {
      const st = [];
      if (old) st.push(env.DB.prepare(`UPDATE post_stats SET ${COL[old]} = MAX(0, ${COL[old]} - 1) WHERE slug = ?`).bind(slug));
      if (type) {
        st.push(env.DB.prepare('INSERT INTO reactions(slug, cid, type, created) VALUES(?, ?, ?, ?) ON CONFLICT(slug, cid) DO UPDATE SET type = excluded.type, created = excluded.created').bind(slug, b.cid, type, now()));
        st.push(env.DB.prepare(`UPDATE post_stats SET ${COL[type]} = ${COL[type]} + 1 WHERE slug = ?`).bind(slug));
      } else st.push(env.DB.prepare('DELETE FROM reactions WHERE slug = ? AND cid = ?').bind(slug, b.cid));
      await env.DB.batch(st);
    }
    return reply({ stats: await getStats(env, slug), reaction: type }, 200, cors);
  }

  if ((m = path.match(/^\/v1\/posts\/([^/]+)\/comments$/)) && method === 'POST') {
    const slug = m[1];
    const b = await readJson(request);
    // bots: a filled hidden field or a form submitted faster than a person can type. Pretend it worked.
    if (b.website || (Number(b.ts) && now() - Number(b.ts) < 2500)) return reply({ ok: true, status: 'pending' }, 202, cors);
    if (env.TURNSTILE_SECRET) {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(b.tt || '') }) });
      const j = await r.json().catch(() => ({}));
      if (!j.success) return fail('Please complete the security check and try again.', 400, cors);
    }
    const email = String(b.email || '').trim().slice(0, 120);
    const clean = cleanComment(b.name, b.body);
    if (clean.error) return fail(clean.error, 400, cors);
    const { name, body } = clean;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email address does not look right.', 400, cors);
    if (!CID_RE.test(String(b.cid || ''))) return fail('Missing visitor id.', 400, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `c:${ih}:${Math.floor(now() / 3600000)}`, 5, 3700))) return fail('You have posted several comments already. Please try again later.', 429, cors);
    if (!(await slugKnown(env, slug))) return fail('Unknown post.', 404, cors);
    let parent = null;
    if (b.parent) {
      parent = Number(b.parent);
      const p = Number.isInteger(parent) ? await env.DB.prepare("SELECT id FROM comments WHERE id = ? AND slug = ? AND status = 'approved' AND parent_id IS NULL").bind(parent, slug).first() : null;
      if (!p) return fail('You can only reply to an approved comment.', 400, cors);
    }
    const dup = await env.DB.prepare('SELECT 1 AS ok FROM comments WHERE slug = ? AND cid = ? AND body = ? AND created > ?').bind(slug, b.cid, body, now() - 600000).first();
    let status = dup ? 'duplicate' : 'pending';
    let shown = null;
    let newId = null;
    let token = null;
    if (!dup) {
      // automatic screen: flagged text, a visitor who was marked as spam before, or AUTO_APPROVE=false -> hold for review
      let reasons;
      try { reasons = [...screen(`${name}\n${body}`).reasons]; } catch (err) { console.error('screen failed', err && err.stack ? err.stack : err); reasons = ['screen-error']; } // fail closed: if the check breaks, hold the comment
      if (String(env.AUTO_APPROVE).toLowerCase() === 'false') reasons.push('auto-approve-off');
      if (looksLikeTeam(name)) reasons.push('impersonation'); // only the admin reply route may use a name that looks like the team
      if ((await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE (cid = ? OR ip_hash = ?) AND status = 'spam'").bind(b.cid, ih).first())?.n) reasons.push('earlier-spam');
      const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE cid = ? AND status = 'pending'").bind(b.cid).first();
      if (reasons.length && (pending?.n || 0) >= 5) return fail('You already have several comments waiting for review.', 429, cors);
      status = reasons.length ? 'pending' : 'approved';
      const t = now();
      token = await newToken(); // shown to the commenter once, in this response; only its hash is stored
      const row = await env.DB.prepare('INSERT INTO comments(slug, parent_id, name, email, body, status, created, ip_hash, cid, flag, manage_hash) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(slug, parent, name, email || null, body, status, t, ih, b.cid, reasons.length ? reasons.join(', ').slice(0, 300) : null, await sha(token)).first();
      newId = row.id;
      if (status === 'approved') {
        await env.DB.prepare('UPDATE post_stats SET comments = comments + 1 WHERE slug = ?').bind(slug).run();
        shown = { id: row.id, name, body, at: t, parent };
      }
    }
    // id and token only for a row that was really inserted (approved or held), so the browser can keep the token even when no comment is shown yet
    return reply({ ok: true, status, comment: shown, ...(newId ? { id: newId, token } : {}) }, status === 'approved' ? 201 : 202, cors);
  }

  if ((m = path.match(/^\/v1\/comments\/(\d+)\/edit$/)) && method === 'POST') {
    const id = Number(m[1]);
    const b = await readJson(request);
    if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) return fail(NOT_FOUND, 404, cors);
    const ih = await ipHash(request, env);
    const hour = Math.floor(now() / 3600000);
    if (!(await hit(env, ctx, `ed:${ih}:${hour}`, 20, 3700))) return fail('You have edited several comments already. Please try again later.', 429, cors);
    const row = await ownerRow(env, id, b.token);
    if (!row) return fail(NOT_FOUND, 404, cors);
    // counted per comment only once the owner is proven, so strangers guessing ids cannot lock the owner out
    if (!(await hit(env, ctx, `edc:${id}:${hour}`, 10, 3700))) return fail('You have edited this comment several times already. Please try again later.', 429, cors);
    if (row.status !== 'approved') return fail('This comment is waiting for review, so it cannot be edited. You can still delete it.', 409, cors);
    if (await hasReplies(env, id)) return fail('This comment has a reply, so it can no longer be edited.', 409, cors);
    if (now() - row.created > 30 * 60000) return fail('The 30 minutes for editing have passed.', 409, cors);
    const clean = cleanComment(row.name, b.body);
    if (clean.error) return fail(clean.error, 400, cors);
    const shown = (edited) => ({ id, body: clean.body, ...(edited ? { edited } : {}) });
    if (clean.body === row.body) return reply({ ok: true, status: 'approved', comment: shown(row.edited_at), stats: await getStats(env, row.slug) }, 200, cors); // nothing changed: write nothing
    let reasons;
    try { reasons = [...screen(`${row.name}\n${clean.body}`).reasons]; } catch (err) { console.error('screen failed', err && err.stack ? err.stack : err); reasons = ['screen-error']; }
    if (String(env.AUTO_APPROVE).toLowerCase() === 'false') reasons.push('auto-approve-off');
    if ((await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE (cid = ? OR ip_hash = ?) AND status = 'spam'").bind(row.cid, row.ip_hash).first())?.n) reasons.push('earlier-spam');
    const status = reasons.length ? 'pending' : 'approved';
    const t = now();
    const st = [env.DB.prepare('UPDATE comments SET body = ?, prev_body = ?, edited_at = ?, status = ?, flag = ? WHERE id = ?')
      .bind(clean.body, row.body, t, status, reasons.length ? reasons.join(', ').slice(0, 300) : null, id)];
    if (status === 'pending') st.push(env.DB.prepare('UPDATE post_stats SET comments = MAX(0, comments - 1) WHERE slug = ?').bind(row.slug));
    await env.DB.batch(st);
    return reply({ ok: true, status, comment: shown(t), stats: await getStats(env, row.slug) }, 200, cors);
  }

  /* ------------------------------------------------------------- moderation */
  if (path.startsWith('/v1/admin/')) {
    if (!isAdmin(request, env)) return fail('Unauthorized.', 401, cors);
    if (method === 'GET' && path === '/v1/admin/comments') {
      const status = ['pending', 'approved', 'spam'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const rows = await env.DB.prepare('SELECT id, slug, parent_id, name, email, body, prev_body, status, created, flag FROM comments WHERE status = ? ORDER BY created DESC LIMIT ?').bind(status, limit).all();
      return reply({ comments: rows.results || [] }, 200, cors);
    }
    if (method === 'POST' && path === '/v1/admin/reply') {
      const b = await readJson(request);
      const body = String(b.body || '').replace(/\r\n?/g, '\n').trim();
      const name = String(b.name || 'Mayobe Bros Team').replace(/\s+/g, ' ').trim().slice(0, 50);
      if (body.length < 2 || body.length > 1500) return fail('The reply must be 2 to 1,500 characters.', 400, cors);
      const parent = await env.DB.prepare("SELECT id, slug FROM comments WHERE id = ? AND status = 'approved' AND parent_id IS NULL").bind(Number(b.parent)).first();
      if (!parent) return fail('You can only reply to a published comment.', 400, cors);
      const t = now();
      const row = await env.DB.prepare("INSERT INTO comments(slug, parent_id, name, email, body, status, created, ip_hash, cid, team, flag) VALUES(?, ?, ?, NULL, ?, 'approved', ?, NULL, 'team', 1, NULL) RETURNING id").bind(parent.slug, parent.id, name, body, t).first();
      await env.DB.prepare('UPDATE post_stats SET comments = comments + 1 WHERE slug = ?').bind(parent.slug).run();
      return reply({ ok: true, comment: { id: row.id, name, body, at: t, parent: parent.id, team: true }, stats: await getStats(env, parent.slug) }, 201, cors);
    }
    if ((m = path.match(/^\/v1\/admin\/comments\/(\d+)$/)) && method === 'POST') {
      const id = Number(m[1]);
      const b = await readJson(request);
      const row = await env.DB.prepare('SELECT id, slug, status FROM comments WHERE id = ?').bind(id).first();
      if (!row) return fail('No such comment.', 404, cors);
      const bump = (slug, d) => env.DB.prepare('UPDATE post_stats SET comments = MAX(0, comments + ?) WHERE slug = ?').bind(d, slug);
      if (b.action === 'approve') {
        const st = [env.DB.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").bind(id)];
        if (row.status !== 'approved') st.push(bump(row.slug, 1));
        await env.DB.batch(st);
      } else if (b.action === 'spam') {
        const gone = (await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE (id = ? OR parent_id = ?) AND status = 'approved'").bind(id, id).first())?.n || 0;
        const st = [];
        if (gone) st.push(bump(row.slug, -gone));
        st.push(env.DB.prepare("UPDATE comments SET status = 'spam' WHERE id = ? OR parent_id = ?").bind(id, id));
        await env.DB.batch(st);
      } else if (b.action === 'delete') {
        const gone = (await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE (id = ? OR parent_id = ?) AND status = 'approved'").bind(id, id).first())?.n || 0;
        const st = [];
        if (gone) st.push(bump(row.slug, -gone));
        st.push(env.DB.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id));
        await env.DB.batch(st);
      } else return fail('Unknown action.', 400, cors);
      return reply({ ok: true, stats: await getStats(env, row.slug) }, 200, cors);
    }
  }

  return fail('Not found.', 404, cors);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      const cors = corsFor(request, env);
      if (err && err.status) return fail(err.message, err.status, cors);
      console.error('engage error', err && err.stack ? err.stack : err);
      return fail('Something went wrong. Please try again.', 500, cors);
    }
  },
};
