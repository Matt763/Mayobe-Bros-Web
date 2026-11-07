// Newsletter routes (Phase 3). Every message goes through sendMail with kind 'news'. No visitor text is ever put in an email:
// the only visitor input is the address the mail is sent to.
//
//   POST /v1/newsletter/subscribe   { email, website (honeypot), elapsed (ms on the page) }  -> 200 { ok: true } for every valid address, whatever its state
//   POST /v1/newsletter/confirm     { token }                          -> 200 { ok: true } | 404 (one answer for every bad token)
//   POST /v1/newsletter/unsubscribe { token }                          -> 200 { ok: true } (also when already unsubscribed) | 404; one farewell per row
//   POST /v1/newsletter/one-click?t=  body List-Unsubscribe=One-Click  -> 200 for any token (RFC 8058, no Origin check, no farewell) | 400 for a wrong body
//   GET  /v1/newsletter/one-click?t=                                   -> 303 to the /newsletter/ page; changes nothing (link scanners GET)
//   runNewsletter(env, ctx, opts)  the Cron Trigger job (six runs each morning): seed guard, one email per new article per subscriber, clean-up

import { sendMail, validEmail, CAPS } from './mail.js';
import { confirmSubscriptionEmail, welcomeEmail, farewellEmail, newPostEmail, oneLine } from './mail-templates.js';
import { SLUG_RE, TOKEN_RE, now, reply, fail, sha, ipHash, newToken, hit, readJson, siteOrigin, siteOf, canonicalEmail, utcDay, DAY_TTL, later } from './util.js';

export const NL_UNSUB_NOT_FOUND = 'We could not find that request.';
const ONE_CLICK_MAX = 1024;
export const NL_NOT_FOUND = 'That link has expired or was already used.';
const CONFIRM_DAYS = 7;
const MIN_FORM_MS = 2500;

function cleanAddress(raw) {
  const email = String(raw ?? '').trim();
  if (email.length > 254 || /\p{Cc}|\p{Cf}/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validEmail(email)) return null;
  return email.toLowerCase();
}
const apiOrigin = (env) => {
  const o = String(env.API_ORIGIN || '').replace(/\/+$/, '');
  return /^https:\/\/[^/\s]+$/.test(o) || /^http:\/\/127\.0\.0\.1:\d+$/.test(o) ? o : '';
};

// A new unsubscribe token for one subscriber (only its hash is stored; it never expires). `insert` is the statement that stores it,
// so the daily sender can put it in one batch with its claim. Returns the page link for the mail body and, when API_ORIGIN is valid,
// the two headers that let a mail app unsubscribe with one POST.
async function unsubscribeParts(env, subscriberId) {
  const token = await newToken();
  const api = apiOrigin(env);
  return {
    insert: env.DB.prepare("INSERT INTO newsletter_tokens(hash, subscriber_id, kind, expires, created) VALUES(?, ?, 'unsub', NULL, ?)").bind(await sha(token), subscriberId, now()),
    pageUrl: `${siteOrigin(env)}/newsletter/#u=${token}`,
    headers: api ? { 'List-Unsubscribe': `<${api}/v1/newsletter/one-click?t=${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
  };
}
export async function unsubscribeKit(env, subscriberId) {
  const { insert, pageUrl, headers } = await unsubscribeParts(env, subscriberId);
  await insert.run();
  return { pageUrl, headers };
}

// Creates or revives the subscriber row and sends the confirmation, unless a limit says no. Runs after the answer is decided.
async function startSubscription(env, ctx, address) {
  const key = canonicalEmail(address);
  const t = now();
  await env.DB.prepare("INSERT INTO newsletter_subscribers(email, email_key, status, created) VALUES(?, ?, 'pending', ?) ON CONFLICT(email_key) DO NOTHING").bind(address, key, t).run();
  const row = await env.DB.prepare('SELECT id, status FROM newsletter_subscribers WHERE email_key = ?').bind(key).first();
  if (!row || row.status === 'active') return; // already subscribed: the same answer, no mail
  if (row.status === 'unsubscribed') {
    await env.DB.batch([
      env.DB.prepare("UPDATE newsletter_subscribers SET status = 'pending', email = ?, confirmed = NULL, unsubscribed = NULL, farewell_sent = 0 WHERE id = ? AND status = 'unsubscribed'").bind(address, row.id),
      env.DB.prepare('DELETE FROM newsletter_tokens WHERE subscriber_id = ?').bind(row.id),
    ]);
  } else {
    await env.DB.prepare("UPDATE newsletter_subscribers SET email = ? WHERE id = ? AND status = 'pending'").bind(address, row.id).run();
  }
  const day = utcDay();
  if (!(await hit(env, ctx, `nlem:${(await sha(`${key}|${env.HASH_SALT || 'mayobe'}`)).slice(0, 32)}:${day}`, 1, DAY_TTL))) return; // 1 a day per address
  if (!(await hit(env, ctx, `nlconf:${day}`, 8, DAY_TTL))) return; // 8 a day in total, so a flood leaves the news slice for articles
  const token = await newToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM newsletter_tokens WHERE subscriber_id = ? AND kind = 'confirm'").bind(row.id),
    env.DB.prepare("INSERT INTO newsletter_tokens(hash, subscriber_id, kind, expires, created) VALUES(?, ?, 'confirm', ?, ?)").bind(await sha(token), row.id, t + CONFIRM_DAYS * 86400000, t),
  ]);
  const m = confirmSubscriptionEmail({ confirmUrl: `${siteOrigin(env)}/newsletter/#c=${token}` }, siteOf(env));
  await sendMail(env, ctx, { kind: 'news', to: address, ...m, key: `nl-confirm-${row.id}-${day}` });
}

// One search.json entry as the data the newsletter templates take. Pictures come from the build's own email JPEGs
// (assets/email/, drawn by scripts/lib/email-images.mjs) on the https asset origin, never the share card or the WebP
// cover: post-<s>.jpg and thumb-<s>.jpg only when m (their content hash) is 8 lowercase hex, video-<s>.jpg only when w
// is. The hash is the same for every reader, so no address carries anything personal. All of it comes from the one
// search.json fetch already made: no extra subrequest. The templates check every address again (ownImage).
const HASH_RE = /^[0-9a-f]{8}$/;
function emailPost(env, p) {
  const { origin, assetOrigin } = siteOf(env);
  const title = str(p.t, 200);
  const url = `${origin}${p.u}`;
  const slug = typeof p.s === 'string' && p.s.length <= 140 && SLUG_RE.test(p.s) ? p.s : '';
  const m = slug && typeof p.m === 'string' && HASH_RE.test(p.m) ? p.m : '';
  const w = slug && typeof p.w === 'string' && HASH_RE.test(p.w) ? p.w : '';
  const alt = typeof p.a === 'string' ? oneLine(p.a.slice(0, 600)).slice(0, 150) : '';
  return {
    title, url, excerpt: str(p.e, 400), category: str(p.c, 40),
    image: m ? `${assetOrigin}/assets/email/post-${slug}.jpg?v=${m}` : '',
    thumb: m ? `${assetOrigin}/assets/email/thumb-${slug}.jpg?v=${m}` : '',
    imageAlt: alt || title,
    video: w ? { image: `${assetOrigin}/assets/email/video-${slug}.jpg?v=${w}`, url: `${url}#video-1` } : null,
  };
}

// Up to 3 of the newest articles already published, from the site's own list (empty when the list cannot be read).
async function latestPosts(env) {
  try {
    const r = await fetch(`${siteOrigin(env)}/data/search.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return [];
    const list = await r.json();
    const today = utcDay();
    return (Array.isArray(list) ? list : [])
      .filter((p) => p && typeof p.t === 'string' && typeof p.u === 'string' && /^\/post\/[a-z0-9/-]*$/.test(p.u) && !p.u.includes('//') && typeof p.d === 'string' && p.d <= today)
      .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
      .slice(0, 3)
      .map((p) => emailPost(env, p));
  } catch {
    return [];
  }
}

async function sendWelcome(env, ctx, id, address) {
  const kit = await unsubscribeKit(env, id);
  const m = welcomeEmail({ unsubscribeUrl: kit.pageUrl, latestPosts: await latestPosts(env) }, siteOf(env));
  await sendMail(env, ctx, { kind: 'news', to: address, ...m, headers: kit.headers, key: `nl-welcome-${id}` });
}

// Marks the owner of an unsubscribe token as unsubscribed. Returns the subscriber when this call made the change, else null.
async function unsubscribeByToken(env, given) {
  const givenHash = await sha(given); // always computed, so the time taken does not say whether the token has the right shape
  if (!TOKEN_RE.test(given)) return null;
  const tok = await env.DB.prepare("SELECT subscriber_id FROM newsletter_tokens WHERE hash = ? AND kind = 'unsub'").bind(givenHash).first();
  if (!tok) return null;
  const changed = await env.DB.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed = ? WHERE id = ? AND status != 'unsubscribed' RETURNING id").bind(now(), tok.subscriber_id).first();
  return { changed: !!changed, id: tok.subscriber_id };
}

// At most one farewell per row: the flag is taken before the mail is sent, so a failed send is never retried.
async function sendFarewell(env, ctx, id) {
  const claimed = await env.DB.prepare('UPDATE newsletter_subscribers SET farewell_sent = 1 WHERE id = ? AND farewell_sent = 0 RETURNING email').bind(id).first();
  if (!claimed) return;
  const m = farewellEmail({ resubscribeUrl: `${siteOrigin(env)}/newsletter/` }, siteOf(env));
  await sendMail(env, ctx, { kind: 'news', to: claimed.email, ...m, key: `nl-bye-${id}` });
}

// Only the button route is limited per IP. The one-click POST is not: it comes from mail providers (Gmail, Yahoo, Outlook) whose
// few shared IPs act for millions of readers, so a per-IP limit would answer 429 and the unsubscribe would fail. The token is the
// secret (24 random bytes, only its hash stored), so guessing is pointless, and each call costs one hash and one indexed lookup.
const unsubLimit = async (request, env, ctx) => hit(env, ctx, `nlu:${await ipHash(request, env)}:${Math.floor(now() / 3600000)}`, 30, 3700);

export async function newsletterRoute(request, env, ctx, path, cors) {
  if (path === '/v1/newsletter/one-click' && request.method === 'GET') {
    const t = new URL(request.url).searchParams.get('t') || '';
    const to = `${siteOrigin(env)}/newsletter/${TOKEN_RE.test(t) ? `#u=${t}` : ''}`;
    return new Response(null, { status: 303, headers: { ...cors, Location: to, 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') return null;

  if (path === '/v1/newsletter/one-click') {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > ONE_CLICK_MAX) return fail('Bad request.', 400, cors);
    const raw = await request.text().catch(() => null);
    if (raw === null || raw.length > ONE_CLICK_MAX) return fail('Bad request.', 400, cors);
    const p = new URLSearchParams(raw);
    if ([...p].length !== 1 || p.get('List-Unsubscribe') !== 'One-Click') return fail('Bad request.', 400, cors);
    await unsubscribeByToken(env, new URL(request.url).searchParams.get('t') || ''); // same answer for any token
    return reply({ ok: true }, 200, cors);
  }

  if (path === '/v1/newsletter/unsubscribe') {
    if (!(await unsubLimit(request, env, ctx))) return fail('Too many requests. Please try again later.', 429, cors);
    const b = await readJson(request).catch(() => null);
    const r = b && !Array.isArray(b) ? await unsubscribeByToken(env, typeof b.token === 'string' ? b.token : '') : (await sha(''), null);
    if (!r) return fail(NL_UNSUB_NOT_FOUND, 404, cors);
    if (r.changed) later(env, ctx, () => sendFarewell(env, ctx, r.id));
    return reply({ ok: true }, 200, cors);
  }

  if (path === '/v1/newsletter/subscribe') {
    const b = await readJson(request);
    // bots: a filled hidden field or a form sent faster than a person can type. Pretend it worked; nothing is stored or sent.
    // `elapsed` is measured by the browser (ms since the page loaded), so a visitor's clock that is set wrong does not matter.
    const elapsed = typeof b.elapsed === 'number' || (typeof b.elapsed === 'string' && b.elapsed.trim() !== '') ? Number(b.elapsed) : NaN;
    if (b.website || !Number.isFinite(elapsed) || elapsed < MIN_FORM_MS) return reply({ ok: true }, 200, cors);
    if (!env.RESEND_API_KEY) return fail('The newsletter is not available right now.', 503, cors); // before anything is stored
    const address = cleanAddress(b.email);
    if (!address) return reply({ error: 'That email address does not look right.', field: 'email' }, 400, cors);
    const ih = await ipHash(request, env);
    if (!(await hit(env, ctx, `nl:${ih}:${Math.floor(now() / 3600000)}`, 3, 3700))) return fail('You have tried several times already. Please try again later.', 429, cors);
    later(env, ctx, () => startSubscription(env, ctx, address));
    return reply({ ok: true }, 200, cors);
  }

  if (path === '/v1/newsletter/confirm') {
    const b = await readJson(request).catch(() => null);
    if (!b || Array.isArray(b)) return fail(NL_NOT_FOUND, 404, cors);
    const given = typeof b.token === 'string' ? b.token : '';
    const givenHash = await sha(given); // always computed, so the time taken does not say whether the token has the right shape
    if (!TOKEN_RE.test(given)) return fail(NL_NOT_FOUND, 404, cors);
    // one atomic claim: only one request can take the token, and an expired one is never taken
    const claimed = await env.DB.prepare("DELETE FROM newsletter_tokens WHERE hash = ? AND kind = 'confirm' AND expires > ? RETURNING subscriber_id").bind(givenHash, now()).first();
    const sub = claimed ? await env.DB.prepare("UPDATE newsletter_subscribers SET status = 'active', confirmed = ? WHERE id = ? AND status = 'pending' RETURNING id, email").bind(now(), claimed.subscriber_id).first() : null;
    if (!sub) return fail(NL_NOT_FOUND, 404, cors);
    await env.DB.prepare("DELETE FROM newsletter_tokens WHERE subscriber_id = ? AND kind = 'confirm'").bind(sub.id).run();
    later(env, ctx, () => sendWelcome(env, ctx, sub.id, sub.email));
    return reply({ ok: true }, 200, cors);
  }

  return null;
}

/* ------------------------------------------------------------------ the daily sender (Cron Trigger) */
const D = 86400000;
const FRESH_DAYS = 7; // an unknown post dated earlier than this is recorded, never emailed (renamed slug, a list that was down for a while)
const PAGE = 10;
const GAP_MS = 200; // 5 sends a second, under Resend's limit
const PENDING_DAYS = 7;
const GONE_DAYS = 30;
const DELIVERY_DAYS = 30;
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const POST_PATH_RE = /^\/post\/[a-z0-9/-]*$/; // the same rule as postMeta in index.js
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The site's own list of published posts, cleaned: null when it cannot be read or has no usable entry.
async function publishedPosts(env, today) {
  try {
    const r = await fetch(`${siteOrigin(env)}/data/search.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return null;
    const list = await r.json();
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    const out = list.filter((p) => p && typeof p.s === 'string' && p.s.length <= 140 && SLUG_RE.test(p.s)
      && typeof p.u === 'string' && p.u.length <= 300 && POST_PATH_RE.test(p.u) && !p.u.includes('//')
      && typeof p.d === 'string' && DATE_RE.test(p.d) && p.d <= today
      && !seen.has(p.s) && seen.add(p.s));
    out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.s < b.s ? -1 : 1)); // oldest first
    return out.length ? out : null;
  } catch {
    return null;
  }
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
function postMail(env, p, unsubscribeUrl) {
  return newPostEmail({ post: emailPost(env, p), unsubscribeUrl }, siteOf(env));
}

// Free plan: 50 subrequests per invocation, and every D1 query (a db.batch counts as one) and every fetch is one
// (developers.cloudflare.com/workers/platform/limits/ and /d1/platform/limits/, checked 2026-11-07). The run counts its own and stops
// at this ceiling, leaving room to spare. A send costs at most SEND_COST: claim+token batch, takeBudget, the Resend fetch, giveBack
// (only after a 429/5xx/timeout), mark or release, and the post's closing update. About 9 sends fit in one run, so the cron fires six
// times in the sending window (wrangler.jsonc) and ARTICLE_CAP (25 of the 35-a-day news slice) still bounds the day: about 25
// subscribers per article per day.
const SUBREQUEST_CEILING = 45;
// Article emails stop when the day's news slice reaches CAPS.news - NEWS_RESERVE (25 of 35). The cron runs at the start of the UTC
// budget day, so without a reserve a backlog would use the whole slice every morning and no confirmation, welcome or goodbye could go
// out for the rest of the day. Those still use the full slice.
export const NEWS_RESERVE = 10;
export const ARTICLE_CAP = CAPS.news - NEWS_RESERVE;
const SEND_COST = 6;

// env.DB with a counter: each first/all/run and each batch adds one.
function metered(db, meter) {
  const wrap = (st) => ({
    inner: st,
    bind: (...a) => wrap(st.bind(...a)),
    first: (...a) => { meter.n++; return st.first(...a); },
    all: (...a) => { meter.n++; return st.all(...a); },
    run: (...a) => { meter.n++; return st.run(...a); },
  });
  return { prepare: (sql) => wrap(db.prepare(sql)), batch: (list) => { meter.n++; return db.batch(list.map((x) => x.inner || x)); } };
}

// Deletes what is no longer needed, in one batch; returns the number of rows removed.
async function cleanUp(env, t) {
  // pending rows older than 7 days with no live confirm token (a row revived by a new sign-up keeps its old `created` but has a fresh token)
  const stalePending = "SELECT id FROM newsletter_subscribers s WHERE s.status = 'pending' AND s.created < ?1 AND NOT EXISTS (SELECT 1 FROM newsletter_tokens k WHERE k.subscriber_id = s.id AND k.kind = 'confirm' AND k.expires > ?2)";
  const gone = "SELECT id FROM newsletter_subscribers WHERE status = 'unsubscribed' AND unsubscribed < ?1";
  const pc = t - PENDING_DAYS * D;
  const gc = t - GONE_DAYS * D;
  const q = (sql, ...a) => env.DB.prepare(`${sql} RETURNING 1`).bind(...a);
  const out = await env.DB.batch([
    q(`DELETE FROM newsletter_tokens WHERE subscriber_id IN (${stalePending})`, pc, t),
    q(`DELETE FROM newsletter_subscribers WHERE id IN (${stalePending})`, pc, t),
    q("DELETE FROM newsletter_tokens WHERE kind = 'confirm' AND expires < ?1", t),
    q(`DELETE FROM newsletter_tokens WHERE subscriber_id IN (${gone})`, gc),
    q(`DELETE FROM newsletter_deliveries WHERE subscriber_id IN (${gone})`, gc),
    q(`DELETE FROM newsletter_subscribers WHERE id IN (${gone})`, gc),
    // newsletter_sent itself is never purged: it is what stops a post from being sent again
    q('DELETE FROM newsletter_deliveries WHERE slug IN (SELECT slug FROM newsletter_sent WHERE sent_at IS NOT NULL AND sent_at < ?1)', t - DELIVERY_DAYS * D),
  ]);
  return out.reduce((n, r) => n + (r?.results?.length || 0), 0);
}

// The cron job (several runs a day). Seeds on the first run (nothing old is ever mass-mailed), records old unknown posts without sending,
// then sends each new post once per subscriber: every send is claimed in newsletter_deliveries first, so an overlapping run or a crash
// never sends twice. mode 'dry' writes nothing and sends nothing; 'seed' records posts and cleans up but sends nothing. Never throws.
// opts.subrequestLimit replaces SUBREQUEST_CEILING (tests only).
export async function runNewsletter(env, ctx, opts = {}) {
  const report = { paused: env.NEWSLETTER_SEND !== 'true', seeded: [], tooOld: [], posts: [], stopped: null, purged: 0 };
  const mode = opts.mode === 'dry' || opts.mode === 'seed' ? opts.mode : 'send';
  const dry = mode === 'dry';
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const meter = { n: 0, limit: Number.isFinite(opts.subrequestLimit) ? opts.subrequestLimit : SUBREQUEST_CEILING };
  const t = Number.isFinite(opts.now) ? opts.now : now();
  let menv = env;
  try {
    menv = { ...env, DB: metered(env.DB, meter) };
  } catch (err) {
    console.error('newsletter: no database', err && err.message ? err.message : err);
    return report;
  }
  // clean-up first and on its own, so a failure later in the run can never skip it
  if (!dry) {
    try { report.purged = await cleanUp(menv, t); } catch (err) { console.error('newsletter clean-up failed', err && err.message ? err.message : err); }
  }
  try {
    meter.n++; // the list fetch
    const list = await publishedPosts(env, dayStr(t));
    if (!list) {
      report.stopped = 'no-list';
      console.error('newsletter: the post list could not be read or had no valid entry; nothing recorded or sent');
    } else {
      await sendRun(menv, ctx, report, list, { t, dry, mode, sleep, meter });
    }
  } catch (err) {
    if (!report.stopped) report.stopped = 'error';
    console.error('newsletter run failed', err && err.message ? err.message : err);
  }
  console.log(`newsletter: ${JSON.stringify({ mode, ...report, seeded: report.seeded.length, subrequests: meter.n })}`);
  return report;
}

const insertSent = (DB, p, t, seeded) => DB.prepare('INSERT OR IGNORE INTO newsletter_sent(slug, title, queued_at, sent_at, seeded) VALUES(?, ?, ?, ?, ?)').bind(p.s, str(p.t, 200), t, seeded ? t : null, seeded ? 1 : 0);

async function sendRun(env, ctx, report, list, { t, dry, mode, sleep, meter }) {
  const DB = env.DB;
  const known = new Map((await DB.prepare('SELECT slug, queued_at, sent_at, seeded FROM newsletter_sent').all()).results.map((r) => [r.slug, r]));
  // (2) first run ever: record every listed post as already handled, send nothing. If that first list is valid but partial (a build
  // that wrote only some posts), the missing ones count as new on the next good run; the 7-day rule below limits that to last week's posts.
  if (!known.size) {
    report.seeded = list.map((p) => p.s);
    if (!dry) await DB.batch(list.map((p) => insertSent(DB, p, t, true)));
    return;
  }
  const freshFrom = dayStr(t - FRESH_DAYS * D);
  const unknown = list.filter((p) => !known.has(p.s));
  // (3) an unknown post older than 7 days (a renamed slug, or a list that was down) is recorded and never emailed. A post renamed within
  // 7 days of its date is NOT caught (search.json carries no aliases): it would be sent again under the new slug. Do not rename a post in
  // its first week.
  const old = unknown.filter((p) => p.d < freshFrom);
  report.tooOld = old.map((p) => p.s);
  const fresh = unknown.filter((p) => p.d >= freshFrom);
  const bySlug = new Map(list.map((p) => [p.s, p]));
  const writes = old.map((p) => insertSent(DB, p, t, true));
  // seed (the owner, right before switching sending on): every listed post not yet recorded counts as handled, also last week's
  if (mode === 'seed') {
    for (const p of fresh) writes.push(insertSent(DB, p, t, true));
    report.seeded = fresh.map((p) => p.s);
  }
  // (4)
  const sending = mode !== 'seed' && (!report.paused || dry); // dry reports what it would send even while paused
  if (sending && !dry) {
    if (!apiOrigin(env)) report.stopped = 'no-api-origin';
    else if (!env.RESEND_API_KEY) report.stopped = 'no-key';
  }
  const queueing = sending && !report.stopped;
  if (queueing) {
    // (5) queue new posts. A queued post that has left the list (unpublished) is not sent; after 7 days it is closed so it cannot come back.
    for (const p of fresh) writes.push(insertSent(DB, p, t, false));
    for (const r of known.values()) if (r.sent_at === null && !bySlug.has(r.slug) && r.queued_at < t - FRESH_DAYS * D) writes.push(DB.prepare('UPDATE newsletter_sent SET sent_at = ? WHERE slug = ? AND sent_at IS NULL').bind(t, r.slug));
  }
  if (writes.length && !dry) await DB.batch(writes);
  if (report.stopped) { console.error(`newsletter: ${report.stopped === 'no-key' ? 'RESEND_API_KEY is not set' : 'API_ORIGIN is missing or not https'}; nothing sent`); return; }
  if (!queueing) return;

  // From the snapshot (no second read). A run started at the same moment may have queued the same slug a few ms apart; harmless.
  const queue = [...[...known.values()].filter((r) => r.sent_at === null && !r.seeded), ...fresh.map((p) => ({ slug: p.s, queued_at: t }))];
  const todo = queue.filter((r) => bySlug.has(r.slug)).sort((a, b) => {
    const x = bySlug.get(a.slug), y = bySlug.get(b.slug);
    return x.d < y.d ? -1 : x.d > y.d ? 1 : a.slug < b.slug ? -1 : 1;
  });

  const eligible = "FROM newsletter_subscribers s WHERE s.status = 'active' AND s.confirmed <= ? AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.slug = ? AND d.subscriber_id = s.id)";
  const room = (cost) => meter.n + cost <= meter.limit;
  let calls = 0; // Resend calls in this run: at most ARTICLE_CAP, whatever happens to the budget (a 429 or 5xx gives its unit back)
  for (const row of todo) {
    const p = bySlug.get(row.slug);
    const stat = { slug: p.s, recipients: 0, sent: 0, skipped: 0, failed: 0 };
    report.posts.push(stat);
    if (dry) {
      if (!room(1)) { report.posts.pop(); report.stopped = 'subrequests'; return; } // a week of posts at most, but keep the run under the limit
      stat.recipients = (await DB.prepare(`SELECT COUNT(*) AS n ${eligible}`).bind(row.queued_at, p.s).first())?.n || 0;
      continue;
    }
    let after = 0;
    for (;;) {
      if (!room(1 + SEND_COST)) { report.stopped = 'subrequests'; return; }
      // one read per page: who is left, and whether the address is on the do-not-email list
      const page = (await DB.prepare(`SELECT s.id, s.email, EXISTS (SELECT 1 FROM suppressed x WHERE x.email = s.email) AS sup ${eligible} AND s.id > ? ORDER BY s.id LIMIT ${PAGE}`).bind(row.queued_at, p.s, after).all()).results;
      if (!page.length) break;
      for (const s of page) {
        if (s.sup) {
          if (!room(2)) { report.stopped = 'subrequests'; return; }
          after = s.id;
          await DB.prepare("INSERT OR IGNORE INTO newsletter_deliveries(slug, subscriber_id, status, at) VALUES(?, ?, 'skipped', ?)").bind(p.s, s.id, now()).run();
          stat.recipients++; stat.skipped++;
          continue;
        }
        if (calls >= ARTICLE_CAP) { report.stopped = 'budget'; return; }
        if (!room(SEND_COST)) { report.stopped = 'subrequests'; return; }
        after = s.id;
        if (calls > 0) await sleep(GAP_MS);
        // One batch: the claim (which re-checks that the subscriber is still active and not suppressed, so someone who left since the
        // page was read gets nothing) and the unsubscribe token for this email. If the claim is lost to another run the token row is
        // simply never mailed; it is deleted with the subscriber.
        const kit = await unsubscribeParts(env, s.id);
        const [claim] = await DB.batch([
          DB.prepare("INSERT OR IGNORE INTO newsletter_deliveries(slug, subscriber_id, status, at) SELECT ?, s.id, 'claimed', ? FROM newsletter_subscribers s WHERE s.id = ? AND s.status = 'active' AND NOT EXISTS (SELECT 1 FROM suppressed x WHERE x.email = s.email) RETURNING subscriber_id").bind(p.s, now(), s.id),
          kit.insert,
        ]);
        if (!claim?.results?.length) continue;
        stat.recipients++;
        const release = () => DB.prepare("DELETE FROM newsletter_deliveries WHERE slug = ? AND subscriber_id = ? AND status = 'claimed'").bind(p.s, s.id).run();
        const mark = (status) => DB.prepare('UPDATE newsletter_deliveries SET status = ?, at = ? WHERE slug = ? AND subscriber_id = ?').bind(status, now(), p.s, s.id).run();
        let res;
        try {
          const m = postMail(env, p, kit.pageUrl);
          meter.n++; // the Resend fetch
          res = await sendMail(env, ctx, { kind: 'news', to: s.email, ...m, headers: kit.headers, key: `nl-post-${p.s}-${s.id}`, suppressionChecked: true, budgetLimit: ARTICLE_CAP });
        } catch (err) {
          await release(); // nothing reached Resend
          throw err;
        }
        // nothing reached Resend: give the claim back and end the run
        if (res.error === 'local') { await release(); report.stopped = 'error'; return; }
        if (res.skipped === 'budget') { await release(); report.stopped = 'budget'; return; }
        if (res.skipped === 'bad-address' || res.skipped === 'suppressed') { stat.skipped++; await mark('skipped'); continue; }
        if (res.skipped) { await release(); report.stopped = 'no-key'; return; }
        calls++;
        if (res.ok) { stat.sent++; await mark('sent'); continue; }
        if (res.status === 429) { await release(); report.stopped = 'rate'; return; }
        stat.failed++; await mark('failed'); // 5xx, thrown, timed out: Resend may have taken it, so never retried
      }
    }
    // (7) nobody left for this post
    await DB.prepare('UPDATE newsletter_sent SET sent_at = ? WHERE slug = ? AND sent_at IS NULL').bind(now(), p.s).run();
  }
}

// ---- owner tools (behind isAdmin in index.js) ----
// Few D1 calls each: the Free plan allows 50 per invocation, and a db.batch counts as one.
const NL_STATUSES = ['active', 'pending', 'unsubscribed'];
export async function newsletterAdmin(request, env, ctx, path, url, cors) {
  const method = request.method;
  if (!path.startsWith('/v1/admin/newsletter')) return null;
  const DB = env.DB;
  if (method === 'GET' && path === '/v1/admin/newsletter') {
    const s = url.searchParams.get('status');
    const status = NL_STATUSES.includes(s) ? s : s === 'all' || !s ? 'all' : 'active';
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
    const where = status === 'all' ? '' : 'WHERE status = ?';
    const stmt = DB.prepare(`SELECT id, email, status, created, confirmed, unsubscribed FROM newsletter_subscribers ${where} ORDER BY id DESC LIMIT ? OFFSET ?`);
    const rows = await (status === 'all' ? stmt.bind(limit, offset) : stmt.bind(status, limit, offset)).all();
    return reply({ subscribers: rows.results || [] }, 200, cors);
  }
  if (method === 'GET' && path === '/v1/admin/newsletter/count') {
    const [byStatus, budget, queue] = await DB.batch([
      DB.prepare('SELECT status, COUNT(*) AS n FROM newsletter_subscribers GROUP BY status'),
      DB.prepare("SELECT n FROM mail_budget WHERE day = ? AND kind = 'news'").bind(utcDay()),
      DB.prepare(`SELECT n.slug AS slug,
        (SELECT COUNT(*) FROM newsletter_deliveries d WHERE d.slug = n.slug AND d.status IN ('claimed','sent')) AS sent,
        (SELECT COUNT(*) FROM newsletter_subscribers s WHERE s.status = 'active' AND s.confirmed <= n.queued_at AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.slug = n.slug AND d.subscriber_id = s.id)) AS left
        FROM newsletter_sent n WHERE n.sent_at IS NULL AND n.seeded = 0 ORDER BY n.queued_at LIMIT 50`),
    ]);
    const c = Object.fromEntries((byStatus.results || []).map((r) => [r.status, r.n]));
    return reply({
      pending: c.pending || 0, active: c.active || 0, unsubscribed: c.unsubscribed || 0,
      newsToday: budget.results?.[0]?.n || 0, newsCap: CAPS.news, articleCap: ARTICLE_CAP, paused: env.NEWSLETTER_SEND !== 'true',
      queue: (queue.results || []).map((r) => ({ slug: r.slug, sent: r.sent, left: r.left })),
    }, 200, cors);
  }
  if (method === 'POST' && path === '/v1/admin/newsletter/remove') {
    const b = await readJson(request);
    const email = String(b?.email ?? '').trim();
    if (!email || email.length > 254 || !validEmail(email)) return fail('Give the address to remove.', 400, cors);
    const key = canonicalEmail(email);
    const out = await DB.batch([
      DB.prepare('DELETE FROM newsletter_tokens WHERE subscriber_id IN (SELECT id FROM newsletter_subscribers WHERE email_key = ?)').bind(key),
      DB.prepare('DELETE FROM newsletter_deliveries WHERE subscriber_id IN (SELECT id FROM newsletter_subscribers WHERE email_key = ?)').bind(key),
      DB.prepare('DELETE FROM newsletter_subscribers WHERE email_key = ? RETURNING id').bind(key),
    ]);
    return reply({ removed: (out[2].results || []).length ? 1 : 0 }, 200, cors);
  }
  if (method === 'POST' && path === '/v1/admin/newsletter/run') {
    const b = await readJson(request);
    if (!b || (b.mode !== 'dry' && b.mode !== 'seed')) return fail('mode must be "dry" or "seed".', 400, cors);
    return reply(await runNewsletter(env, ctx, { mode: b.mode }), 200, cors);
  }
  return null;
}
