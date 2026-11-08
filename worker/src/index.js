// Mayobe Bros comments + reactions API.  Cloudflare Worker + D1 (SQLite).  No dependencies.
//
//   GET  /v1/stats?slugs=a,b,c              counts for many posts at once (browser-cached 10 s)
//   GET  /v1/posts/:slug[?offset=N]         approved comments, newest conversation first, 20 conversations a page (`more` + `next` when another page exists; + a blank "deleted" placeholder for a deleted comment that has replies) + counts (always fresh)
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
//   POST /v1/review                         { r }                 the approve / ignore button of the held-comment email (r = signed token from a /manage/#r= link) -> { ok, result: approved|already|kept, id, path }
//   POST /v1/manage/exchange                { link }              swap the token from an emailed manage link (kept in the page's #l= fragment) for a device token -> { ok, id, slug, path?, token }
//   POST /v1/notify/unsubscribe             { token }             stop reply emails for the comment that owns this (#u=) token
//   POST /v1/webhooks/resend                Resend bounce/complaint events (Svix-signed; no Origin check, the signature is the proof). Adds the addresses to `suppressed`.
//
// Email (worker/src/mail.js, mail-templates.js): the create route also takes `notify: true` with an email address. That sends one
// "manage link" mail (fixed text and our own article title only: the address is unverified). Opening its link confirms the address, and
// only then do reply notices go out. A held comment, or a new question, also alerts OWNER_EMAIL. Mail is sent inside ctx.waitUntil after
// the data is saved and can never change an API answer.
//
// A comment is screened automatically (worker/src/moderation.js: English + Swahili abusive words, scam lines, contact details,
// shouting). A clean comment is published at once ("approved"); a flagged one is held as "pending" until the owner approves it.
// Set the variable AUTO_APPROVE to "false" to hold every comment again (for example during a spam wave).

import { screen, looksLikeTeam } from './moderation.js';
import { looksLikeQuestion } from './question.js';
import { SLUG_RE, TOKEN_RE, enc, now, reply, fail, sha, ipHash, same, newToken, hit, readJson, siteOrigin, siteOf, canonicalEmail, utcDay, DAY_TTL, later } from './util.js';
import { newsletterRoute, newsletterAdmin, runNewsletter } from './newsletter.js';
import { sendMail, validEmail } from './mail.js';
import { checkReviewToken, reviewLinks } from './review.js';
import { manageLinkEmail, replyNoticeEmail, ownerAlertEmail, contactOwnerEmail, contactVisitorEmail, CONTACT_TYPES } from './mail-templates.js';

export { canonicalEmail };
export const REACTIONS = ['like', 'amazed', 'sad', 'angry'];
const COL = { like: 'r_like', amazed: 'r_amazed', sad: 'r_sad', angry: 'r_angry' };
const CID_RE = /^[A-Za-z0-9-]{16,64}$/;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|info|biz|xyz|top|click|link|ru|cn|co\.tz|go\.tz|tk|ml|ga|cf|gq)\b|t\.me\/|bit\.ly)/i;
const COMMENT_PAGE = 20; // conversations per GET /v1/posts/:slug
const LINK_DAYS = 7; // an emailed manage link works for this long
// Words the visitor sees. One neutral wording per class of problem, so an answer never says which check failed or whether anything exists.
const NOT_FOUND = 'Comment not found.'; // the one answer for a wrong token, a missing comment, a team comment and so on, so nothing can be probed
const LINK_BAD = 'Link is invalid or expired.'; // the one answer for every emailed link that cannot be used (wrong, expired, used, removed)
const TRY_LATER = 'Too many attempts. Try again later.'; // the one answer for every limit, so no limit is named
const NOT_SENT = 'Could not send. Try again.';
const NO_EDIT = 'Comment can no longer be edited.'; // pending, has a reply, or past the edit window: one answer for all three


function origins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://mayobebros.com,https://www.mayobebros.com').split(',').map((s) => s.trim()).filter(Boolean);
}
function corsFor(request, env) {
  const o = request.headers.get('Origin');
  if (!o || !origins(env).includes(o)) return {};
  return { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };
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
  // a device token (from the emailed manage link) is the same kind of secret, kept hashed in manage_links; it is looked up by its hash
  // The lookup runs every time, with the id bound even when no such comment exists, so timing does not reveal which ids exist.
  const device = await env.DB.prepare("SELECT 1 AS ok FROM manage_links WHERE hash = ? AND comment_id = ? AND kind = 'device'").bind(givenHash, Number.isSafeInteger(id) ? id : 0).first();
  if (!row || !TOKEN_RE.test(given) || !((row.manage_hash && match) || device) || !['approved', 'pending'].includes(row.status)) return null;
  const { manage_hash, ...own } = row; // the hash never leaves this function
  return own;
}
// A reply counts when it is approved or still waiting for review.
async function hasReplies(env, id) {
  return !!(await env.DB.prepare("SELECT 1 AS ok FROM comments WHERE parent_id = ? AND status IN ('approved', 'pending') LIMIT 1").bind(id).first());
}
// Removes a deleted-comment tombstone once no approved or pending reply is left under it. One statement, so it is safe if two run together.
async function purgeIfOrphan(env, parentId) {
  if (!parentId) return;
  await env.DB.prepare("DELETE FROM comments WHERE id = ? AND status = 'deleted' AND NOT EXISTS (SELECT 1 FROM comments WHERE parent_id = ? AND status IN ('approved', 'pending'))").bind(parentId, parentId).run();
  await dropLinks(env, parentId); // links of a comment that no longer exists
}
// Removes the emailed links and device tokens of comments that are gone (no row left in comments).
async function dropLinks(env, id) {
  await env.DB.prepare('DELETE FROM manage_links WHERE comment_id = ? AND NOT EXISTS (SELECT 1 FROM comments WHERE id = ?)').bind(id, id).run();
}
// Cleans a comment's name and text the way they are stored, and checks length and links. Shared by the create and edit routes.
// Returns { name, body } or { error } (a message for a 400).
// The two cleaners are shared by comments and the contact form, so both strip the same characters.
const cleanName = (raw) => String(raw || '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}]+/gu, '').replace(/\s+/g, ' ').trim(); // stored exactly as it was checked: no invisible characters
const cleanText = (raw) => String(raw || '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').replace(/\n{3,}/g, '\n\n').trim(); // no control characters (terminal escapes) are stored; newlines stay
// "Name is required." / "Name is too short." / "Name is too long." (or '' when the length is fine): short, names the field, no numbers.
const lengthError = (label, value, min, max) => (!value ? `${label} is required.` : value.length < min ? `${label} is too short.` : value.length > max ? `${label} is too long.` : '');
function cleanComment(rawName, rawBody) {
  const name = cleanName(rawName);
  const body = cleanText(rawBody);
  const bad = lengthError('Name', name, 2, 50) || lengthError('Comment', body, 3, 1500);
  if (bad) return { error: bad };
  if (LINK_RE.test(name)) return { error: 'Name cannot contain links.' };
  if (LINK_RE.test(body)) return { error: 'Comment cannot contain links.' };
  return { name, body };
}
// The contact form: same cleaning, other limits, and links are allowed (the owner email shows them as plain text). Returns { name, email, subject, message, type } or { error, field } (the page marks that field).
function cleanContact(b) {
  const name = cleanName(b.name);
  const subject = cleanName(String(b.subject ?? '').replace(/[\r\n\t]+/g, ' ')); // one line: no line breaks, no invisible characters
  const message = cleanText(b.message);
  const email = String(b.email ?? '').trim();
  const nameBad = lengthError('Name', name, 2, 50);
  if (nameBad) return { error: nameBad, field: 'name' };
  if (email.length > 254 || /\p{Cc}|\p{Cf}/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validEmail(email)) return { error: email ? 'Email looks incorrect.' : 'Email is required.', field: 'email' };
  const subjectBad = lengthError('Subject', subject, 3, 120);
  if (subjectBad) return { error: subjectBad, field: 'subject' };
  const messageBad = lengthError('Message', message, 10, 3000);
  if (messageBad) return { error: messageBad, field: 'message' };
  return { name, email, subject, message, type: typeof b.type === 'string' && Object.hasOwn(CONTACT_TYPES, b.type) ? b.type : 'general' };
}
// Both sides are hashed first, so the comparison always runs over 64 equal characters and the token's length is not leaked.
async function isAdmin(request, env) {
  const t = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16) return false;
  return same(await sha(t), await sha(env.ADMIN_TOKEN));
}

// Resend webhooks are signed with Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`, keyed with the base64-decoded part of
// RESEND_WEBHOOK_SECRET ("whsec_<base64>"). The header holds space-separated "v1,<base64>" entries; any one may match. Every failure
// (also a missing or broken secret: fail closed) returns the same answer, so nothing says which check failed.
const WEBHOOK_MAX = 64 * 1024;
async function svixValid(request, env, raw) {
  const secret = String(env.RESEND_WEBHOOK_SECRET || '');
  if (!secret.startsWith('whsec_')) return false;
  const id = request.headers.get('svix-id') || '';
  const ts = request.headers.get('svix-timestamp') || '';
  const sigs = request.headers.get('svix-signature') || '';
  if (!id || id.length > 256 || !/^\d{1,12}$/.test(ts) || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  let keyBytes;
  try {
    keyBytes = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (!keyBytes.length) return false;
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${ts}.${raw}`)));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  const expected = btoa(bin);
  let ok = false;
  for (const entry of sigs.split(' ')) if (entry.startsWith('v1,') && same(entry.slice(3), expected)) ok = true;
  return ok;
}
async function resendWebhook(request, env, cors) {
  const bad = () => fail('Invalid webhook.', 400, cors);
  // Too big is answered like every other failure. The body is read with request.text() and signed as received; a BOM or invalid UTF-8
  // would only make verification fail, which is failing closed.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > WEBHOOK_MAX) return bad();
  const raw = await request.text();
  if (raw.length > WEBHOOK_MAX) return bad();
  if (!(await svixValid(request, env, raw))) return bad();
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return bad();
  }
  const reason = ev?.type === 'email.bounced' ? 'bounce' : ev?.type === 'email.complained' ? 'complaint' : null;
  if (!reason) return reply({ ok: true }, 200, cors);
  // Only a permanent bounce suppresses (Resend: data.bounce.type "Permanent"); Temporary/Undetermined do not. A payload without the field suppresses.
  const bt = ev.data?.bounce?.type;
  if (reason === 'bounce' && bt !== undefined && bt !== null && String(bt).toLowerCase() !== 'permanent') return reply({ ok: true }, 200, cors);
  const to = ev.data?.to;
  const list = (Array.isArray(to) ? to : [to]).filter((a) => typeof a === 'string').slice(0, 50);
  // Our own mailboxes are never suppressed: that would silently switch off owner alerts and contact notices.
  const own = new Set([...reviewRecipients(env), env.OWNER_EMAIL, env.CONTACT_EMAIL, 'info@mayobebros.com', 'support@mayobebros.com', ...[env.MAIL_FROM, env.MAIL_FROM_SUPPORT].map((f) => /<([^<>]+)>/.exec(String(f || ''))?.[1] || f)]
    .map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
  let n = 0;
  let ownerSeen = false;
  for (const a of list) {
    if (!validEmail(a)) continue;
    if (own.has(a.trim().toLowerCase())) { ownerSeen = true; continue; }
    await env.DB.prepare('INSERT OR IGNORE INTO suppressed(email, reason, created) VALUES(?, ?, ?)').bind(a.trim().toLowerCase(), reason, now()).run();
    n++;
    // A complaint also ends the subscription (no farewell: they asked not to hear from us).
    if (reason === 'complaint') await env.DB.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed = ? WHERE email_key = ? AND status != 'unsubscribed'").bind(now(), canonicalEmail(a)).run();
  }
  if (ownerSeen) console.log('resend webhook: owner address reported, not suppressed');
  console.log(`resend webhook: ${reason}, ${n} address(es)`);
  return reply({ ok: true }, 200, cors);
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

// Title and address of one of OUR articles, from the site's own list; '' and the post list address (/post/) if it is not listed (real article URLs include the category, so a made-up one would 404).
// Never taken from visitor input: this is what goes into emails to addresses nobody has verified.
async function postMeta(env, slug) {
  const fallback = { title: '', path: '/post/', found: false };
  try {
    const r = await fetch(`${siteOrigin(env)}/data/search.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return fallback;
    const list = await r.json();
    const p = Array.isArray(list) ? list.find((x) => x && x.s === slug) : null;
    if (!p) return fallback;
    const ok = typeof p.u === 'string' && /^\/post\/[a-z0-9/-]*$/.test(p.u) && p.u.length <= 300 && !p.u.includes('//');
    return { title: typeof p.t === 'string' ? p.t.slice(0, 200) : '', path: ok ? p.u : fallback.path, found: ok };
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ email */
async function addLink(env, kind, commentId, expires) {
  const token = await newToken();
  await env.DB.prepare('INSERT INTO manage_links(hash, comment_id, kind, expires, created) VALUES(?, ?, ?, ?, ?)').bind(await sha(token), commentId, kind, expires, now()).run();
  if (kind === 'device') { // keep the newest 20 per comment
    await env.DB.prepare("DELETE FROM manage_links WHERE kind = 'device' AND comment_id = ? AND hash NOT IN (SELECT hash FROM manage_links WHERE kind = 'device' AND comment_id = ? ORDER BY created DESC, rowid DESC LIMIT 20)").bind(commentId, commentId).run();
  }
  return token; // the clear token exists only here, long enough to be put in the email
}

// The "manage your comment" mail. The address is unverified, so it carries our article title and fixed text only.
async function mailManageLink(env, ctx, c) {
  const day = utcDay();
  if (!(await hit(env, ctx, `mlip:${c.ih}:${day}`, 5, DAY_TTL))) return; // at most 5 a day per IP
  if (!(await hit(env, ctx, `mlem:${(await sha(`${canonicalEmail(c.email)}|${env.HASH_SALT || 'mayobe'}`)).slice(0, 32)}:${day}`, 1, DAY_TTL))) return; // 1 a day per address, never the raw address
  const meta = await postMeta(env, c.slug);
  const origin = siteOrigin(env);
  const token = await addLink(env, 'link', c.id, now() + LINK_DAYS * 86400000);
  const m = manageLinkEmail({ postTitle: meta.title, postUrl: `${origin}${meta.path}`, manageUrl: `${origin}/manage/#l=${token}`, notifyWanted: true }, siteOf(env));
  await sendMail(env, ctx, { kind: 'commenter', to: c.email, ...m, key: `link-${c.id}` });
}

// A new approved reply: tell the parent's author, only if they confirmed the address by opening the manage link.
async function mailReplyNotice(env, ctx, r) {
  const parent = r.parent_id ? await env.DB.prepare('SELECT id, slug, name, email, cid, status, notify_confirmed FROM comments WHERE id = ?').bind(r.parent_id).first() : null;
  if (!parent || parent.status !== 'approved' || !parent.notify_confirmed || !parent.email) return;
  if (!r.team && r.cid && r.cid === parent.cid) return; // never tell people about their own follow-up
  // Announce each reply once: compare-and-set, so approve/spam/approve or a double click can never send twice.
  if (!(await env.DB.prepare('UPDATE comments SET announced = 1 WHERE id = ? AND announced = 0 RETURNING id').bind(r.id).first())) return;
  // One a day per parent comment. This slot is taken before the suppression and budget checks in sendMail on purpose:
  // a recipient who cannot be mailed now is still not mailed a burst later, which protects them.
  if (!(await hit(env, ctx, `rn:${parent.id}:${utcDay()}`, 1, DAY_TTL))) return;
  const meta = await postMeta(env, parent.slug);
  const origin = siteOrigin(env);
  const unsub = await addLink(env, 'unsub', parent.id, null); // a new one for every notice; all of them work
  const m = replyNoticeEmail({ postTitle: meta.title, postUrl: `${origin}${meta.path}#comments`, unsubscribeUrl: `${origin}/manage/#u=${unsub}`, name: parent.name, isTeam: !!r.team, replyAuthor: r.name, replyBody: r.body }, siteOf(env));
  await sendMail(env, ctx, { kind: 'commenter', to: parent.email, ...m, key: `reply-${r.id}` });
}

// Alerts to the owner (full content; the template escapes it).
// Who gets the "comment held" alert: REVIEW_EMAILS (comma separated, at most 3 valid addresses) when set, otherwise OWNER_EMAIL.
function reviewRecipients(env) {
  const list = String(env.REVIEW_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => validEmail(x));
  const uniq = [...new Set(list)].slice(0, 3);
  return uniq.length ? uniq : [env.OWNER_EMAIL || 'info@mayobebros.com'];
}
async function mailOwner(env, ctx, kind, c, reason) {
  // Held alerts get 6 a day (12 of the 24 daily owner units with two review addresses), question alerts 4, contact notices 7: 23 in all. The comment is saved either way; `node scripts/comments.mjs list` shows everything.
  // held alerts (6 a day, each to every review address) and question alerts (4 a day) count separately, so harmless questions can never silence a held-comment alert
  if (!(await hit(env, ctx, `${kind === 'held' ? 'ohday' : 'oqday'}:${utcDay()}`, kind === 'held' ? 6 : 4, DAY_TTL))) return;
  const meta = await postMeta(env, c.slug);
  const origin = siteOrigin(env);
  // Held comments carry two buttons (approve, ignore) when REVIEW_SECRET is set. Each link is signed for this one comment and expires in 7 days.
  const links = kind === 'held' ? await reviewLinks(env, c.id, origin) : null;
  const m = ownerAlertEmail({ kind, postUrl: `${origin}${meta.path}`, postSlug: c.slug, commentId: c.id, name: c.name, body: c.body, reason, ...(links || {}) }, siteOf(env));
  const to = kind === 'held' ? reviewRecipients(env) : [env.OWNER_EMAIL || 'info@mayobebros.com'];
  await Promise.all(to.map((addr, i) => sendMail(env, ctx, { kind: 'owner', to: addr, ...m, key: i === 0 ? `alert-${c.id}-${kind}` : `alert-${c.id}-${kind}-${i}` })));
}

// Publishes a held (or hidden) comment by hand and marks it "approved by Admin". Returns 'approved' | 'already' | 'deleted' | 'missing'.
async function approveHeld(env, ctx, row) {
  if (row.status === 'deleted') return 'deleted';
  if (row.status === 'approved') return 'already';
  const done = await env.DB.batch([
    env.DB.prepare("UPDATE comments SET status = 'approved', approved_by = 'admin', approved_at = ? WHERE id = ? AND status = ? AND status IN ('pending', 'spam') RETURNING id").bind(now(), row.id, row.status),
    env.DB.prepare('UPDATE post_stats SET comments = comments + 1 WHERE slug = ? AND changes() > 0').bind(row.slug), // must stay right after the row statement
  ]);
  if (!(done[0]?.results || []).length) return 'missing'; // it changed or was deleted while we looked
  if (row.parent_id && row.status === 'pending') { // a held reply is now public: tell the person it answers
    const rep = await env.DB.prepare('SELECT id, parent_id, name, body, team, cid FROM comments WHERE id = ?').bind(row.id).first();
    if (rep) later(env, ctx, () => mailReplyNotice(env, ctx, rep));
  }
  return 'approved';
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

  if (method === 'POST' && path === '/v1/webhooks/resend') return resendWebhook(request, env, cors);

  // (The one-click unsubscribe is exempt: a mail app posts it, so it has no Origin; it only ever unsubscribes.)
  // Browsers always send Origin on cross-site POSTs. Refuse any that is not our site.
  if (method === 'POST' && !path.startsWith('/v1/admin/') && path !== '/v1/newsletter/one-click') {
    const o = request.headers.get('Origin');
    if (!o || !origins(env).includes(o)) return fail(NOT_SENT, 403, cors);
  }

  const nl = await newsletterRoute(request, env, ctx, path, cors);
  if (nl) return nl;

  // The approve / ignore buttons of the held-comment email. The signed token is the proof (no admin token in a link); a page
  // button sends it. Approve publishes the comment and marks it "approved by Admin"; ignore changes nothing (it stays held).
  if (method === 'POST' && path === '/v1/review') {
    const b = await readJson(request);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `review:${ih}`, 60, 3600))) return fail(TRY_LATER, 429, cors);
    const t = await checkReviewToken(env, b.r);
    if (!t) return fail(LINK_BAD, 404, cors);
    const row = await env.DB.prepare('SELECT id, slug, parent_id, status FROM comments WHERE id = ?').bind(t.id).first();
    if (!row) return fail(LINK_BAD, 404, cors);
    const where = async () => ({ path: (await postMeta(env, row.slug)).path, slug: row.slug });
    if (t.action === 'ignore') return reply({ ok: true, result: row.status === 'approved' ? 'already' : row.status === 'pending' ? 'kept' : row.status, id: row.id, ...(await where()) }, 200, cors);
    if (row.status !== 'pending' && row.status !== 'approved') return fail(LINK_BAD, 404, cors); // a comment already hidden as spam is not brought back by an old email
    const r = await approveHeld(env, ctx, row);
    if (r === 'deleted') return fail('Comment was deleted by its author.', 409, cors);
    if (r === 'missing') return fail(LINK_BAD, 404, cors);
    return reply({ ok: true, result: r, id: row.id, ...(await where()), stats: await getStats(env, row.slug) }, 200, cors);
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
    if (!(await slugKnown(env, slug))) return fail('Article not found.', 404, cors);
    // Conversations (a comment with its replies) come newest first, COMMENT_PAGE at a time: ?offset=N asks for the next page. A post with
    // thousands of comments never sends them all at once, and the newest are never cut off. `more` says whether another page exists.
    const offset = Math.min(100000, Math.max(0, Math.floor(Number(url.searchParams.get('offset'))) || 0));
    const COLS = 'id, parent_id, name, body, created, team, likes, edited_at, status, approved_by';
    const topRows = ((await env.DB.prepare(`SELECT ${COLS} FROM comments WHERE slug = ? AND parent_id IS NULL AND status IN ('approved', 'deleted') ORDER BY created DESC, id DESC LIMIT ? OFFSET ?`).bind(slug, COMMENT_PAGE + 1, offset).all()).results || []);
    const more = topRows.length > COMMENT_PAGE;
    const pageRows = topRows.slice(0, COMMENT_PAGE);
    const replyRows = pageRows.length
      ? ((await env.DB.prepare(`SELECT ${COLS} FROM comments WHERE slug = ? AND parent_id IN (${pageRows.map(() => '?').join(',')}) AND status IN ('approved', 'deleted') ORDER BY created ASC, id ASC LIMIT 1000`).bind(slug, ...pageRows.map((c) => c.id)).all()).results || [])
      : [];
    // a deleted comment that still has replies stays as a blank tombstone (its text and name were erased when it was deleted)
    const pub = (c) => c.status === 'deleted'
      ? { id: c.id, name: '', body: 'This comment was deleted.', at: c.created, deleted: true, likes: 0 }
      : { id: c.id, name: c.name, body: c.body, at: c.created, likes: c.likes || 0, ...(c.edited_at ? { edited: c.edited_at } : {}), ...(c.team ? { team: true } : {}), ...(c.approved_by ? { ab: 1 } : {}) };
    const tops = pageRows.map((c) => ({ ...pub(c), replies: [] }));
    const byId = Object.fromEntries(tops.map((c) => [c.id, c]));
    for (const c of replyRows) if (byId[c.parent_id]) byId[c.parent_id].replies.push(pub(c));
    // with a valid visitor id, also say which of these comments that visitor liked (the key is absent without one)
    const cid = url.searchParams.get('cid') || '';
    const liked = CID_RE.test(cid)
      ? ((await env.DB.prepare("SELECT l.comment_id AS id FROM comment_likes l JOIN comments c ON c.id = l.comment_id WHERE l.voter = ? AND c.slug = ? AND c.status = 'approved'").bind(cid, slug).all()).results || []).map((r) => r.id)
      : null;
    // always revalidate: a visitor who just reacted or whose comment was just approved must see it on reload
    return reply({ stats: await getStats(env, slug), comments: tops, ...(more ? { more: true, next: offset + pageRows.length } : {}), ...(liked ? { liked } : {}) }, 200, cors, 'no-cache');
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
    if (type !== null && !REACTIONS.includes(type)) return fail('Could not save reaction. Try again.', 400, cors);
    if (!CID_RE.test(String(b.cid || ''))) return fail('Could not save reaction. Try again.', 400, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `r:${ih}:${Math.floor(now() / 600000)}`, 60, 700))) return fail(TRY_LATER, 429, cors);
    if (!(await slugKnown(env, slug))) return fail('Article not found.', 404, cors);
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
      if (!j.success) return fail('Complete the security check.', 400, cors);
    }
    const email = String(b.email || '').trim().slice(0, 120);
    const clean = cleanComment(b.name, b.body);
    if (clean.error) return fail(clean.error, 400, cors);
    const { name, body } = clean;
    if (email && (/\p{Cc}|\p{Cf}/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return fail('Email looks incorrect.', 400, cors);
    if (!CID_RE.test(String(b.cid || ''))) return fail(NOT_SENT, 400, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `c:${ih}:${Math.floor(now() / 3600000)}`, 5, 3700))) return fail(TRY_LATER, 429, cors);
    if (!(await slugKnown(env, slug))) return fail('Article not found.', 404, cors);
    let parent = null;
    if (b.parent) {
      parent = Number(b.parent);
      const p = Number.isInteger(parent) ? await env.DB.prepare("SELECT id FROM comments WHERE id = ? AND slug = ? AND status = 'approved' AND parent_id IS NULL").bind(parent, slug).first() : null;
      if (!p) return fail('Could not post reply.', 400, cors);
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
      if (reasons.length && (pending?.n || 0) >= 5) return fail(TRY_LATER, 429, cors);
      status = reasons.length ? 'pending' : 'approved';
      const t = now();
      const wantsMail = b.notify === true && !!email; // "email me about replies" counts only with an address
      token = await newToken(); // shown to the commenter once, in this response; only its hash is stored
      const row = await env.DB.prepare('INSERT INTO comments(slug, parent_id, name, email, body, status, created, ip_hash, cid, flag, manage_hash, notify_wanted) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(slug, parent, name, email || null, body, status, t, ih, b.cid, reasons.length ? reasons.join(', ').slice(0, 300) : null, await sha(token), wantsMail ? 1 : 0).first();
      newId = row.id;
      if (status === 'approved') {
        await env.DB.prepare('UPDATE post_stats SET comments = comments + 1 WHERE slug = ?').bind(slug).run();
        shown = { id: row.id, name, body, at: t, parent };
      }
      // Mail, after the data is saved. Only for a row that was really inserted (not a duplicate or a bot post).
      const saved = { id: row.id, slug, name, body, cid: b.cid, parent_id: parent, team: 0 };
      if (wantsMail) later(env, ctx, () => mailManageLink(env, ctx, { id: row.id, slug, email, ih }));
      if (status === 'approved' && parent) later(env, ctx, () => mailReplyNotice(env, ctx, saved));
      if (status === 'pending') later(env, ctx, () => mailOwner(env, ctx, 'held', saved, reasons.join(', ')));
      else if (looksLikeQuestion(body)) later(env, ctx, () => mailOwner(env, ctx, 'question', saved, ''));
    }
    // id and token only for a row that was really inserted (approved or held), so the browser can keep the token even when no comment is shown yet
    return reply({ ok: true, status, comment: shown, ...(newId ? { id: newId, token } : {}) }, status === 'approved' ? 201 : 202, cors);
  }

  if (method === 'POST' && path === '/v1/contact') {
    const b = await readJson(request, 14000); // 3,000 characters can double when quotes and line breaks are escaped
    // bots: a filled hidden field or a form sent faster than a person can type. Pretend it worked; nothing is sent.
    if (b.website || (Number(b.ts) && now() - Number(b.ts) < 2500)) return reply({ ok: true }, 200, cors);
    // No Turnstile check here on purpose: js/contact.js does not load the widget yet, so asking for a token would reject every message.
    // Add it back together with the widget in the page.
    const c = cleanContact(b);
    if (c.error) return reply({ error: c.error, field: c.field }, 400, cors);
    const ih = await ipHash(request, env);
    const hour = Math.floor(now() / 3600000);
    if (!(await hit(env, ctx, `ct:${ih}:${hour}`, 3, 3700))) return fail(TRY_LATER, 429, cors);
    // the key holds a hash of the address, never the address itself
    if (!(await hit(env, ctx, `cte:${(await sha(`${canonicalEmail(c.email)}|${env.HASH_SALT || 'mayobe'}`)).slice(0, 32)}:${hour}`, 2, 3700))) return fail(TRY_LATER, 429, cors);
    // at most 7 contact notices a day, so a flood leaves 3 of the owner's 10 daily units for held-comment and question alerts
    const tooMany = !(await hit(env, ctx, `ctday:${utcDay()}`, 7, DAY_TTL));
    const general = env.CONTACT_EMAIL || 'info@mayobebros.com';
    const down = () => fail(`Could not send. Email us at ${general}.`, 503, cors);
    if (tooMany || !env.RESEND_API_KEY) return down();
    // the page sends one id per form fill, so a retry after a timeout reuses the same keys and cannot be delivered twice; without a good id a fresh one is made
    const id = typeof b.id === 'string' && CID_RE.test(b.id) ? b.id : crypto.randomUUID();
    let owner;
    try {
      const m = contactOwnerEmail({ name: c.name, email: c.email, subject: c.subject, message: c.message, type: c.type, receivedAt: now() }, siteOf(env));
      owner = await sendMail(env, ctx, { kind: 'owner', to: env.OWNER_EMAIL || 'info@mayobebros.com', replyTo: c.email, ...m, key: `contact-${id}` });
    } catch (err) {
      console.error('contact mail failed', err && err.message ? err.message : err);
    }
    if (!owner || !owner.ok) { console.error('contact message could not be emailed to the owner'); return down(); }
    // the visitor's confirmation goes to an address nobody has verified: fixed text only, best effort, after the owner has the message
    later(env, ctx, async () => {
      // one confirmation per address a day: the address is unverified, so a stranger's inbox is never filled through this form
      if (!(await hit(env, ctx, `ctack:${(await sha(`${canonicalEmail(c.email)}|${env.HASH_SALT || 'mayobe'}`)).slice(0, 32)}:${utcDay()}`, 1, DAY_TTL))) return;
      const v = contactVisitorEmail({}, siteOf(env));
      await sendMail(env, ctx, { kind: 'contact', to: c.email, ...v, key: `contactack-${id}` });
    });
    return reply({ ok: true }, 200, cors);
  }

  if (method === 'POST' && path === '/v1/manage/exchange') {
    const b = await readJson(request).catch(() => null);
    if (!b || Array.isArray(b)) return fail(LINK_BAD, 404, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `mx:${ih}:${Math.floor(now() / 3600000)}`, 30, 3700))) return fail(TRY_LATER, 429, cors);
    if (typeof b.link !== 'string' || !TOKEN_RE.test(b.link)) return fail(LINK_BAD, 404, cors);
    const link = await env.DB.prepare("SELECT comment_id FROM manage_links WHERE hash = ? AND kind = 'link' AND expires > ?").bind(await sha(b.link), now()).first();
    const row = link ? await env.DB.prepare("SELECT id, slug, status, notify_wanted FROM comments WHERE id = ?").bind(link.comment_id).first() : null;
    if (!row || !['approved', 'pending'].includes(row.status)) return fail(LINK_BAD, 404, cors);
    const device = await addLink(env, 'device', row.id, null);
    if (row.notify_wanted) await env.DB.prepare('UPDATE comments SET notify_confirmed = 1 WHERE id = ? AND notify_wanted = 1').bind(row.id).run(); // opening the link proves the address is read by the commenter
    const meta = await postMeta(env, row.slug); // the real article address (it includes the category); absent when the list cannot be read
    return reply({ ok: true, id: row.id, slug: row.slug, ...(meta.found ? { path: meta.path } : {}), token: device }, 200, cors);
  }

  if (method === 'POST' && path === '/v1/notify/unsubscribe') {
    const b = await readJson(request).catch(() => null);
    if (!b || Array.isArray(b)) return fail(LINK_BAD, 404, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `un:${ih}:${Math.floor(now() / 3600000)}`, 30, 3700))) return fail(TRY_LATER, 429, cors);
    if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) return fail(LINK_BAD, 404, cors);
    const link = await env.DB.prepare("SELECT comment_id FROM manage_links WHERE hash = ? AND kind = 'unsub'").bind(await sha(b.token)).first();
    const row = link ? await env.DB.prepare('SELECT id FROM comments WHERE id = ?').bind(link.comment_id).first() : null;
    if (!row) return fail(LINK_BAD, 404, cors);
    await env.DB.prepare('UPDATE comments SET notify_wanted = 0, notify_confirmed = 0 WHERE id = ?').bind(row.id).run();
    return reply({ ok: true }, 200, cors);
  }

  if ((m = path.match(/^\/v1\/comments\/(\d+)\/edit$/)) && method === 'POST') {
    const id = Number(m[1]);
    const b = await readJson(request);
    if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) return fail(NOT_FOUND, 404, cors);
    const ih = await ipHash(request, env);
    const hour = Math.floor(now() / 3600000);
    if (!(await hit(env, ctx, `ed:${ih}:${hour}`, 20, 3700))) return fail(TRY_LATER, 429, cors);
    const row = await ownerRow(env, id, b.token);
    if (!row) return fail(NOT_FOUND, 404, cors);
    // counted per comment only once the owner is proven, so strangers guessing ids cannot lock the owner out
    if (!(await hit(env, ctx, `edc:${id}:${hour}`, 10, 3700))) return fail(TRY_LATER, 429, cors);
    if (row.status !== 'approved') return fail(NO_EDIT, 409, cors);
    if (await hasReplies(env, id)) return fail(NO_EDIT, 409, cors);
    const windowMin = Number(env.EDIT_WINDOW_MINUTES) > 0 ? Number(env.EDIT_WINDOW_MINUTES) : 30;
    if (now() - row.created > windowMin * 60000) return fail(NO_EDIT, 409, cors);
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
    // The write is conditional, so a request that raced with a spam/delete, a new reply or another edit changes nothing:
    // it only applies while the row is still approved and has no reply, and the count is lowered only if that row changed.
    const st = [env.DB.prepare("UPDATE comments SET body = ?, prev_body = ?, edited_at = ?, status = ?, flag = ?, approved_by = NULL, approved_at = NULL WHERE id = ? AND status = 'approved' AND NOT EXISTS (SELECT 1 FROM comments WHERE parent_id = ? AND status IN ('approved', 'pending')) RETURNING id")
      .bind(clean.body, row.body, t, status, reasons.length ? reasons.join(', ').slice(0, 300) : null, id, id)];
    if (status === 'pending') st.push(env.DB.prepare('UPDATE post_stats SET comments = MAX(0, comments - 1) WHERE slug = ? AND changes() > 0').bind(row.slug));
    const done = await env.DB.batch(st);
    if (!(done[0]?.results || []).length) {
      if (await hasReplies(env, id)) return fail(NO_EDIT, 409, cors);
      return fail(NOT_FOUND, 404, cors);
    }
    return reply({ ok: true, status, comment: shown(t), stats: await getStats(env, row.slug) }, 200, cors);
  }

  if ((m = path.match(/^\/v1\/comments\/(\d+)\/delete$/)) && method === 'POST') {
    const id = Number(m[1]);
    const b = await readJson(request);
    if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) return fail(NOT_FOUND, 404, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `del:${ih}:${Math.floor(now() / 3600000)}`, 20, 3700))) return fail(TRY_LATER, 429, cors);
    // Each write only applies while the row is still in the status that was read (and still has / has no replies), and the count is lowered
    // only if that row really changed. If another request got there first, read again; after three tries answer the generic 404.
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await ownerRow(env, id, b.token); // approved or pending only, so a spam, deleted or team comment is the generic 404
      if (!row) return fail(NOT_FOUND, 404, cors);
      const replies = await hasReplies(env, id);
      const anyReply = "EXISTS (SELECT 1 FROM comments WHERE parent_id = ? AND status IN ('approved', 'pending'))";
      const st = [replies
        ? env.DB.prepare(`UPDATE comments SET status = 'deleted', name = '', body = '', email = NULL, manage_hash = NULL, prev_body = NULL, ip_hash = NULL, cid = NULL, flag = NULL, edited_at = NULL, likes = 0 WHERE id = ? AND status = ? AND ${anyReply} RETURNING id`).bind(id, row.status, id)
        : env.DB.prepare(`DELETE FROM comments WHERE id = ? AND status = ? AND NOT ${anyReply} RETURNING id`).bind(id, row.status, id)];
      if (row.status === 'approved') st.push(env.DB.prepare('UPDATE post_stats SET comments = MAX(0, comments - 1) WHERE slug = ? AND changes() > 0').bind(row.slug)); // must stay right after the row statement
      st.push(replies
        ? env.DB.prepare("DELETE FROM comment_likes WHERE comment_id = ? AND EXISTS (SELECT 1 FROM comments WHERE id = ? AND status = 'deleted')").bind(id, id)
        : env.DB.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND NOT EXISTS (SELECT 1 FROM comments WHERE id = ?)').bind(id, id));
      const done = await env.DB.batch(st);
      if (!(done[0]?.results || []).length) continue;
      await purgeIfOrphan(env, row.parent_id);
      await env.DB.prepare('DELETE FROM manage_links WHERE comment_id = ?').bind(id).run(); // its emailed links and device tokens are of no use now
      return reply({ ok: true, removed: replies ? 'tombstone' : 'deleted', stats: await getStats(env, row.slug) }, 200, cors);
    }
    return fail(NOT_FOUND, 404, cors);
  }

  if ((m = path.match(/^\/v1\/comments\/(\d+)\/like$/)) && method === 'POST') {
    const id = Number(m[1]);
    const b = await readJson(request);
    if (!CID_RE.test(String(b.cid || ''))) return fail('Could not save like. Try again.', 400, cors);
    if (typeof b.on !== 'boolean') return fail('Could not save like. Try again.', 400, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `l:${ih}:${Math.floor(now() / 600000)}`, 120, 700))) return fail(TRY_LATER, 429, cors);
    const row = Number.isSafeInteger(id) && id > 0 ? await env.DB.prepare("SELECT id, slug FROM comments WHERE id = ? AND status = 'approved'").bind(id).first() : null;
    if (!row) return fail(NOT_FOUND, 404, cors);
    // Every statement only applies while the comment is still approved. The like row is added with INSERT OR IGNORE (a double tap or a second tab is
    // "already liked", never an error), and the counter is then set from the rows themselves, so it equals the number of rows after any interleaving.
    const approved = "EXISTS (SELECT 1 FROM comments WHERE id = ? AND status = 'approved')";
    await env.DB.batch([
      b.on
        ? env.DB.prepare(`INSERT OR IGNORE INTO comment_likes(comment_id, voter, created) SELECT ?, ?, ? WHERE ${approved}`).bind(id, b.cid, now(), id)
        : env.DB.prepare(`DELETE FROM comment_likes WHERE comment_id = ? AND voter = ? AND ${approved}`).bind(id, b.cid, id),
      env.DB.prepare("UPDATE comments SET likes = (SELECT COUNT(*) FROM comment_likes WHERE comment_id = ?) WHERE id = ? AND status = 'approved'").bind(id, id),
    ]);
    const now2 = await env.DB.prepare("SELECT likes FROM comments WHERE id = ? AND status = 'approved'").bind(id).first();
    if (!now2) return fail(NOT_FOUND, 404, cors); // hidden or deleted while we worked
    return reply({ ok: true, likes: now2.likes, liked: b.on }, 200, cors);
  }

  /* ------------------------------------------------------------- moderation */
  if (path.startsWith('/v1/admin/')) {
    // 60 admin requests per 10 minutes per visitor: enough for the command line, too few to guess a token
    if (!(await hit(env, ctx, `adm:${await ipHash(request, env)}`, 60, 600))) return fail(TRY_LATER, 429, cors);
    if (!(await isAdmin(request, env))) return fail('Unauthorized.', 401, cors);
    const nla = await newsletterAdmin(request, env, ctx, path, url, cors);
    if (nla) return nla;
    if (method === 'GET' && path === '/v1/admin/comments') {
      const status = ['pending', 'approved', 'spam'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const rows = await env.DB.prepare('SELECT id, slug, parent_id, name, email, body, prev_body, edited_at, status, created, flag FROM comments WHERE status = ? ORDER BY created DESC LIMIT ?').bind(status, limit).all();
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
      later(env, ctx, () => mailReplyNotice(env, ctx, { id: row.id, parent_id: parent.id, name, body, team: 1, cid: 'team' }));
      return reply({ ok: true, comment: { id: row.id, name, body, at: t, parent: parent.id, team: true }, stats: await getStats(env, parent.slug) }, 201, cors);
    }
    if ((m = path.match(/^\/v1\/admin\/comments\/(\d+)$/)) && method === 'POST') {
      const id = Number(m[1]);
      const b = await readJson(request);
      const row = await env.DB.prepare('SELECT id, slug, parent_id, status FROM comments WHERE id = ?').bind(id).first();
      if (!row) return fail('No such comment.', 404, cors);
      // Every write below only touches rows that are still in the state it expects, and the count moves by the number of rows that really
      // changed (changes() of the statement just before), so a request that races with an owner delete cannot count twice.
      const minusChanged = env.DB.prepare('UPDATE post_stats SET comments = MAX(0, comments - changes()) WHERE slug = ? AND changes() > 0').bind(row.slug);
      if (b.action === 'approve') {
        const r = await approveHeld(env, ctx, row);
        if (r === 'deleted') return fail('That comment was deleted by its author and cannot be approved.', 409, cors);
        if (r === 'missing') return fail('No such comment.', 404, cors);
      } else if (b.action === 'spam') {
        await env.DB.batch([
          env.DB.prepare("UPDATE comments SET status = 'spam' WHERE (id = ? OR parent_id = ?) AND status = 'approved'").bind(id, id),
          minusChanged,
          env.DB.prepare("UPDATE comments SET status = 'spam' WHERE (id = ? OR parent_id = ?) AND status NOT IN ('approved', 'spam', 'deleted')").bind(id, id), // a tombstone stays a tombstone
        ]);
        await env.DB.prepare('DELETE FROM manage_links WHERE comment_id IN (SELECT id FROM comments WHERE id = ? OR parent_id = ?)').bind(id, id).run(); // hidden comments cannot be managed or announced
        await purgeIfOrphan(env, row.id); // a tombstone whose replies were just hidden
        await purgeIfOrphan(env, row.parent_id);
      } else if (b.action === 'delete') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM manage_links WHERE comment_id IN (SELECT id FROM comments WHERE id = ? OR parent_id = ?)').bind(id, id),
          env.DB.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE id = ? OR parent_id = ?)').bind(id, id),
          env.DB.prepare("DELETE FROM comments WHERE (id = ? OR parent_id = ?) AND status = 'approved'").bind(id, id),
          minusChanged,
          env.DB.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id),
        ]);
        await purgeIfOrphan(env, row.parent_id);
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
      // readJson's own messages (413 too big, 400 not readable) are plain-English for the logs only: the visitor gets a short neutral line
      if (err && err.status) return fail(err.status === 413 ? 'Message is too long.' : NOT_SENT, err.status, cors);
      console.error('engage error', err && err.stack ? err.stack : err);
      return fail('Something went wrong. Try again.', 500, cors);
    }
  },
  // Cron Trigger (wrangler.jsonc "triggers"): the daily newsletter run. runNewsletter never throws.
  scheduled(event, env, ctx) {
    ctx.waitUntil(runNewsletter(env, ctx));
  },
};
