// Helpers shared by index.js (comments, contact, email) and newsletter.js. Moved out of index.js unchanged.

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const MAX_BODY = 4000;

export const enc = new TextEncoder();
export const now = () => Date.now();

export function reply(body, status, cors, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache || 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...cors },
  });
}
export const fail = (msg, status, cors) => reply({ error: msg }, status, cors);

export async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// One visitor, however the address is written. An IPv6 visitor controls a whole /64 (2^64 addresses), so only the first four groups
// are used: rotating inside a /64 gives no new identity. IPv4 and anything else is used as it is.
export function visitorNet(raw) {
  const ip = String(raw || 'unknown').trim().toLowerCase();
  if (!ip.includes(':')) return ip;
  const v4tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip); // ::ffff:1.2.3.4 style: the IPv4 part is the identity
  if (v4tail && /^::ffff:$/.test(v4tail[1])) return v4tail[2];
  const [head, tail = null] = ip.split('::');
  const a = head ? head.split(':') : [];
  const z = tail === null ? [] : tail ? tail.split(':') : [];
  const groups = tail === null ? a : [...a, ...Array(Math.max(0, 8 - a.length - z.length)).fill('0'), ...z];
  return `v6:${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}`;
}
export async function ipHash(request, env) {
  const ip = visitorNet(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown');
  const day = new Date().toISOString().slice(0, 10);
  return (await sha(`${ip}|${env.HASH_SALT || 'mayobe'}|${day}`)).slice(0, 24); // rotates daily; raw IPs are never stored
}
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// A random secret for one comment: 24 random bytes as base64url (32 characters, no padding).
export async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function readJson(request, max = MAX_BODY) {
  // a body that announces itself as huge is refused before it is read (4 bytes per character is the most UTF-8 can use)
  const len = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(len) && len > max * 4) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  const text = await request.text();
  if (text.length > max) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object') throw 0;
    return v;
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
}

// Counts how often a key was used; returns false once the limit for the window is passed.
export async function hit(env, ctx, key, limit, ttlSec) {
  const row = await env.DB.prepare('INSERT INTO hits(k, n, expires) VALUES(?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(key, now() + ttlSec * 1000).first();
  if (Math.random() < 0.02 && ctx?.waitUntil) ctx.waitUntil(env.DB.prepare('DELETE FROM hits WHERE expires < ?').bind(now()).run());
  return (row?.n || 1) <= limit;
}

export const siteOrigin = (env) => String(env.SITE_ORIGIN || 'https://mayobebros.com').replace(/\/$/, '');
// What the email templates need: where links point, where pictures come from (always https: a loopback SITE_ORIGIN
// used for local testing still shows the published pictures) and the wordmark picture (assets/email/logo.png).
export const siteOf = (env) => {
  const origin = siteOrigin(env);
  const assetOrigin = /^https:\/\//.test(origin) ? origin : 'https://mayobebros.com';
  return { origin, assetOrigin, logoUrl: `${assetOrigin}/assets/email/logo.png` };
};
// One inbox, however it is spelled: NFKC, lower case, no trailing dot on the domain, no +tag, and for Gmail no dots and
// googlemail.com = gmail.com. Used ONLY for rate-limit keys; mail still goes to the address as typed.
export function canonicalEmail(raw) {
  const e = String(raw ?? '').normalize('NFKC').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1).replace(/\.+$/, '');
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}
export const utcDay = () => new Date().toISOString().slice(0, 10);
export const DAY_TTL = 90000; // a little over a day, in seconds

// Runs a mail job after the response is decided. Whatever happens inside, it never throws and never changes the answer.
// Nothing is created or counted when no mail key is set.
export function later(env, ctx, job) {
  if (!env.RESEND_API_KEY) return;
  const p = (async () => { try { await job(); } catch (err) { console.error('mail job failed', err && err.message ? err.message : err); } })();
  try { ctx?.waitUntil?.(p); } catch { /* nothing more to do */ }
}

// Cloudflare Turnstile. With no TURNSTILE_SECRET the check is off (true), so the Worker can be deployed before the site sends tokens.
// Fails closed when the secret is set: a missing token, a rejected token or an unreachable verifier all answer false.
export async function humanCheck(env, request, token) {
  if (!env.TURNSTILE_SECRET) return true;
  const t = typeof token === 'string' ? token.slice(0, 2048) : '';
  if (!t) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: t });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    const j = await r.json().catch(() => ({}));
    return j.success === true;
  } catch {
    return false;
  }
}
