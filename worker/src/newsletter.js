// Newsletter routes (Phase 3). Every message goes through sendMail with kind 'news'. No visitor text is ever put in an email:
// the only visitor input is the address the mail is sent to.
//
//   POST /v1/newsletter/subscribe   { email, website (honeypot), ts }  -> 200 { ok: true } for every valid address, whatever its state
//   POST /v1/newsletter/confirm     { token }                          -> 200 { ok: true } | 404 (one answer for every bad token)
//   POST /v1/newsletter/unsubscribe { token }                          -> 200 { ok: true } (also when already unsubscribed) | 404; one farewell per row
//   POST /v1/newsletter/one-click?t=  body List-Unsubscribe=One-Click  -> 200 for any token (RFC 8058, no Origin check, no farewell) | 400 for a wrong body
//   GET  /v1/newsletter/one-click?t=                                   -> 303 to the /newsletter/ page; changes nothing (link scanners GET)
//   runNewsletter(env, ctx, opts)  the daily Cron Trigger job: seed guard, one email per new article per subscriber, clean-up

import { sendMail, validEmail, CAPS } from './mail.js';
import { confirmSubscriptionEmail, welcomeEmail, farewellEmail, newPostEmail } from './mail-templates.js';
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

// A new unsubscribe token for one subscriber (only its hash is stored; it never expires). Returns the page link for the mail body and,
// when API_ORIGIN is valid, the two headers that let a mail app unsubscribe with one POST.
export async function unsubscribeKit(env, subscriberId) {
  const token = await newToken();
  await env.DB.prepare("INSERT INTO newsletter_tokens(hash, subscriber_id, kind, expires, created) VALUES(?, ?, 'unsub', NULL, ?)").bind(await sha(token), subscriberId, now()).run();
  const api = apiOrigin(env);
  return {
    pageUrl: `${siteOrigin(env)}/newsletter/#u=${token}`,
    headers: api ? { 'List-Unsubscribe': `<${api}/v1/newsletter/one-click?t=${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
  };
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

// Up to 3 of the newest articles already published, from the site's own list (empty when the list cannot be read).
async function latestPosts(env) {
  try {
    const r = await fetch(`${siteOrigin(env)}/data/search.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return [];
    const list = await r.json();
    const today = utcDay();
    const origin = siteOrigin(env);
    return (Array.isArray(list) ? list : [])
      .filter((p) => p && typeof p.t === 'string' && typeof p.u === 'string' && /^\/post\/[a-z0-9/-]*$/.test(p.u) && !p.u.includes('//') && typeof p.d === 'string' && p.d <= today)
      .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
      .slice(0, 3)
      .map((p) => ({ title: p.t, url: `${origin}${p.u}`, excerpt: typeof p.e === 'string' ? p.e : '' }));
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
    if (b.website || !(Number(b.ts) > 0) || now() - Number(b.ts) < MIN_FORM_MS) return reply({ ok: true }, 200, cors);
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
  const origin = siteOrigin(env);
  const title = str(p.t, 200);
  return newPostEmail({
    post: { title, url: `${origin}${p.u}`, excerpt: str(p.e, 400), category: str(p.c, 40), image: `${origin}/assets/share/post-${p.s}.jpg`, imageAlt: `Cover picture for: ${title}` },
    unsubscribeUrl,
  }, siteOf(env));
}

// Deletes what is no longer needed; returns the number of rows removed.
async function cleanUp(env, t) {
  const n = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).run())?.meta?.changes || 0;
  // pending rows older than 7 days with no live confirm token (a row revived by a new sign-up keeps its old `created` but has a fresh token)
  const stalePending = "SELECT id FROM newsletter_subscribers s WHERE s.status = 'pending' AND s.created < ? AND NOT EXISTS (SELECT 1 FROM newsletter_tokens k WHERE k.subscriber_id = s.id AND k.kind = 'confirm' AND k.expires > ?)";
  const gone = "SELECT id FROM newsletter_subscribers WHERE status = 'unsubscribed' AND unsubscribed < ?";
  const pc = t - PENDING_DAYS * D;
  const gc = t - GONE_DAYS * D;
  let purged = 0;
  purged += await n(`DELETE FROM newsletter_tokens WHERE subscriber_id IN (${stalePending})`, pc, t);
  purged += await n(`DELETE FROM newsletter_subscribers WHERE id IN (${stalePending})`, pc, t);
  purged += await n("DELETE FROM newsletter_tokens WHERE kind = 'confirm' AND expires < ?", t);
  purged += await n(`DELETE FROM newsletter_tokens WHERE subscriber_id IN (${gone})`, gc);
  purged += await n(`DELETE FROM newsletter_deliveries WHERE subscriber_id IN (${gone})`, gc);
  purged += await n(`DELETE FROM newsletter_subscribers WHERE id IN (${gone})`, gc);
  purged += await n('DELETE FROM newsletter_deliveries WHERE slug IN (SELECT slug FROM newsletter_sent WHERE sent_at IS NOT NULL AND sent_at < ?)', t - DELIVERY_DAYS * D);
  return purged;
}

// The daily job. Seeds on the first run (nothing old is ever mass-mailed), records old unknown posts without sending, then sends each
// new post once per subscriber: every send is claimed in newsletter_deliveries first, so an overlapping run or a crash never sends twice.
// mode 'dry' writes nothing and sends nothing; 'seed' records posts and cleans up but sends nothing. Never throws.
export async function runNewsletter(env, ctx, opts = {}) {
  const report = { paused: env.NEWSLETTER_SEND !== 'true', seeded: [], tooOld: [], posts: [], stopped: null, purged: 0 };
  const mode = opts.mode === 'dry' || opts.mode === 'seed' ? opts.mode : 'send';
  const dry = mode === 'dry';
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  try {
    const t = Number.isFinite(opts.now) ? opts.now : now();
    const list = await publishedPosts(env, dayStr(t));
    if (!list) {
      report.stopped = 'no-list';
      console.error('newsletter: the post list could not be read or had no valid entry; nothing recorded or sent');
    } else {
      await sendRun(env, ctx, report, list, { t, dry, mode, sleep });
    }
    if (!dry) report.purged = await cleanUp(env, t);
  } catch (err) {
    console.error('newsletter run failed', err && err.message ? err.message : err);
  }
  console.log(`newsletter: ${JSON.stringify({ mode, ...report, seeded: report.seeded.length })}`);
  return report;
}

async function sendRun(env, ctx, report, list, { t, dry, mode, sleep }) {
  const DB = env.DB;
  // (2) first run ever: record every listed post as already handled, send nothing
  const any = await DB.prepare('SELECT 1 AS x FROM newsletter_sent LIMIT 1').first();
  if (!any) {
    report.seeded = list.map((p) => p.s);
    if (!dry) await DB.batch(list.map((p) => DB.prepare('INSERT OR IGNORE INTO newsletter_sent(slug, title, queued_at, sent_at, seeded) VALUES(?, ?, ?, ?, 1)').bind(p.s, str(p.t, 200), t, t)));
    return;
  }
  const known = new Map((await DB.prepare('SELECT slug, queued_at, sent_at, seeded FROM newsletter_sent').all()).results.map((r) => [r.slug, r]));
  const freshFrom = dayStr(t - FRESH_DAYS * D);
  const unknown = list.filter((p) => !known.has(p.s));
  // (3) an unknown post older than 7 days (a renamed slug, or a list that was down) is recorded and never emailed
  const old = unknown.filter((p) => p.d < freshFrom);
  report.tooOld = old.map((p) => p.s);
  if (old.length && !dry) await DB.batch(old.map((p) => DB.prepare('INSERT OR IGNORE INTO newsletter_sent(slug, title, queued_at, sent_at, seeded) VALUES(?, ?, ?, ?, 1)').bind(p.s, str(p.t, 200), t, t)));
  // (4)
  if (mode === 'seed') return;
  if (report.paused && !dry) return;
  if (!apiOrigin(env)) { report.stopped = 'no-api-origin'; console.error('newsletter: API_ORIGIN is missing or not https; nothing sent'); return; }
  if (!env.RESEND_API_KEY && !dry) { report.stopped = 'no-key'; console.error('newsletter: RESEND_API_KEY is not set; nothing sent'); return; }
  // (5) queue new posts, oldest first
  const fresh = unknown.filter((p) => p.d >= freshFrom);
  if (fresh.length && !dry) await DB.batch(fresh.map((p) => DB.prepare('INSERT OR IGNORE INTO newsletter_sent(slug, title, queued_at, sent_at, seeded) VALUES(?, ?, ?, NULL, 0)').bind(p.s, str(p.t, 200), t)));
  const bySlug = new Map(list.map((p) => [p.s, p]));
  const queue = dry
    ? [...[...known.values()].filter((r) => r.sent_at === null && !r.seeded), ...fresh.map((p) => ({ slug: p.s, queued_at: t }))]
    : (await DB.prepare('SELECT slug, queued_at FROM newsletter_sent WHERE sent_at IS NULL AND seeded = 0').all()).results;
  const todo = queue.filter((r) => bySlug.has(r.slug)).sort((a, b) => {
    const x = bySlug.get(a.slug), y = bySlug.get(b.slug);
    return x.d < y.d ? -1 : x.d > y.d ? 1 : a.slug < b.slug ? -1 : 1;
  });
  // A queued post that has left the list (unpublished) is not sent; after 7 days it is closed so it cannot come back to life.
  if (!dry) for (const r of queue) if (!bySlug.has(r.slug) && r.queued_at < t - FRESH_DAYS * D) await DB.prepare('UPDATE newsletter_sent SET sent_at = ? WHERE slug = ? AND sent_at IS NULL').bind(t, r.slug).run();

  const eligible = "FROM newsletter_subscribers s WHERE s.status = 'active' AND s.confirmed <= ? AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.slug = ? AND d.subscriber_id = s.id)";
  let calls = 0; // Resend calls in this run: at most CAPS.news, whatever happens to the budget (a 429 or 5xx gives its unit back)
  for (const row of todo) {
    const p = bySlug.get(row.slug);
    const stat = { slug: p.s, recipients: (await DB.prepare(`SELECT COUNT(*) AS n ${eligible}`).bind(row.queued_at, p.s).first())?.n || 0, sent: 0, skipped: 0, failed: 0 };
    report.posts.push(stat);
    if (dry) continue;
    let after = 0;
    for (;;) {
      const page = (await DB.prepare(`SELECT s.id, s.email ${eligible} AND s.id > ? ORDER BY s.id LIMIT ${PAGE}`).bind(row.queued_at, p.s, after).all()).results;
      if (!page.length) break;
      for (const s of page) {
        after = s.id;
        if (calls >= CAPS.news) { report.stopped = 'budget'; return; }
        if (calls > 0) await sleep(GAP_MS);
        // the claim re-checks the subscriber, so someone who left since the page was read gets nothing
        const claimed = await DB.prepare("INSERT OR IGNORE INTO newsletter_deliveries(slug, subscriber_id, status, at) SELECT ?, id, 'claimed', ? FROM newsletter_subscribers WHERE id = ? AND status = 'active' RETURNING subscriber_id")
          .bind(p.s, now(), s.id).first();
        if (!claimed) continue;
        const kit = await unsubscribeKit(env, s.id);
        const m = postMail(env, p, kit.pageUrl);
        const res = await sendMail(env, ctx, { kind: 'news', to: s.email, ...m, headers: kit.headers, key: `nl-post-${p.s}-${s.id}` });
        const mark = (status) => DB.prepare('UPDATE newsletter_deliveries SET status = ?, at = ? WHERE slug = ? AND subscriber_id = ?').bind(status, now(), p.s, s.id).run();
        const release = () => DB.prepare("DELETE FROM newsletter_deliveries WHERE slug = ? AND subscriber_id = ? AND status = 'claimed'").bind(p.s, s.id).run();
        if (res.ok) { calls++; stat.sent++; await mark('sent'); continue; }
        if (res.skipped === 'suppressed' || res.skipped === 'bad-address') { stat.skipped++; await mark('skipped'); continue; }
        if (res.skipped === 'budget') { await release(); report.stopped = 'budget'; return; }
        if (res.skipped) { await release(); report.stopped = 'no-key'; return; } // no key: nothing reached Resend
        calls++;
        if (res.status === 429) { await release(); report.stopped = 'rate'; return; }
        stat.failed++; await mark('failed'); // 5xx, thrown, timed out: Resend may have taken it, so never retried
      }
    }
    // (7) nobody left for this post
    await DB.prepare('UPDATE newsletter_sent SET sent_at = ? WHERE slug = ? AND sent_at IS NULL').bind(now(), p.s).run();
  }
}
