// Newsletter routes (Phase 3). Every message goes through sendMail with kind 'news'. No visitor text is ever put in an email:
// the only visitor input is the address the mail is sent to.
//
//   POST /v1/newsletter/subscribe   { email, website (honeypot), ts }  -> 200 { ok: true } for every valid address, whatever its state
//   POST /v1/newsletter/confirm     { token }                          -> 200 { ok: true } | 404 (one answer for every bad token)
//   POST /v1/newsletter/unsubscribe { token }                          -> 200 { ok: true } (also when already unsubscribed) | 404; one farewell per row
//   POST /v1/newsletter/one-click?t=  body List-Unsubscribe=One-Click  -> 200 for any token (RFC 8058, no Origin check, no farewell) | 400 for a wrong body
//   GET  /v1/newsletter/one-click?t=                                   -> 303 to the /newsletter/ page; changes nothing (link scanners GET)

import { sendMail, validEmail } from './mail.js';
import { confirmSubscriptionEmail, welcomeEmail, farewellEmail } from './mail-templates.js';
import { TOKEN_RE, now, reply, fail, sha, ipHash, newToken, hit, readJson, siteOrigin, siteOf, canonicalEmail, utcDay, DAY_TTL, later } from './util.js';

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
  return { found: true, changed: !!changed, id: tok.subscriber_id };
}

// At most one farewell per row: the flag is taken before the mail is sent, so a failed send is never retried.
async function sendFarewell(env, ctx, id) {
  const claimed = await env.DB.prepare('UPDATE newsletter_subscribers SET farewell_sent = 1 WHERE id = ? AND farewell_sent = 0 RETURNING email').bind(id).first();
  if (!claimed) return;
  const m = farewellEmail({ resubscribeUrl: `${siteOrigin(env)}/newsletter/` }, siteOf(env));
  await sendMail(env, ctx, { kind: 'news', to: claimed.email, ...m, key: `nl-bye-${id}` });
}

const unsubLimit = async (request, env, ctx) => hit(env, ctx, `nlu:${await ipHash(request, env)}:${Math.floor(now() / 3600000)}`, 30, 3700);

export async function newsletterRoute(request, env, ctx, path, cors) {
  if (path === '/v1/newsletter/one-click' && request.method === 'GET') {
    const t = new URL(request.url).searchParams.get('t') || '';
    const to = `${siteOrigin(env)}/newsletter/${TOKEN_RE.test(t) ? `#u=${t}` : ''}`;
    return new Response(null, { status: 303, headers: { ...cors, Location: to, 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') return null;

  if (path === '/v1/newsletter/one-click') {
    if (!(await unsubLimit(request, env, ctx))) return fail('Too many requests. Please try again later.', 429, cors);
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
