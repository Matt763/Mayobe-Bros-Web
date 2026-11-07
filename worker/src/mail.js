// Sends email through Resend's REST API (plain fetch, no SDK). sendMail never throws: a mail problem must never
// fail, delay or roll back the request that asked for it. Run it inside ctx.waitUntil after the data is saved.

const API = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Mayobe Bros <info@mayobebros.com>';
const DEFAULT_FROM_SUPPORT = 'Mayobe Bros <support@mayobebros.com>';
// Free plan: 100 a day. 80 are used, split by kind; a full slice never borrows from another.
export const CAPS = { owner: 10, commenter: 25, contact: 10, news: 35 };
const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\.]{2,}$/;

const warnedNoKey = new WeakSet(); // log the missing key once per env (per isolate in production)
const TIMEOUT_MS = 10000;
const TAG_RE = /^[A-Za-z0-9_-]{1,256}$/;
// env.MAIL_TEST_DAY (optional, tests only) replaces today's UTC date so a day rollover can be tested.
const today = (env) => env.MAIL_TEST_DAY || new Date().toISOString().slice(0, 10);

// One atomic statement: the row is created or raised by one only while n < cap, and RETURNING gives a row only
// when a unit was taken. No read-then-write, so parallel sends cannot pass the cap.
export async function takeBudget(env, kind, day = today(env)) {
  const cap = CAPS[kind];
  if (!cap) return false;
  const row = await env.DB.prepare('INSERT INTO mail_budget(day, kind, n) VALUES(?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n')
    .bind(day, kind, cap).first();
  return !!row;
}
async function giveBack(env, kind, day) {
  try { await env.DB.prepare('UPDATE mail_budget SET n = n - 1 WHERE day = ? AND kind = ? AND n > 0').bind(day, kind).run(); } catch { /* the unit is simply lost until tomorrow */ }
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
export const validEmail = (s) => { const v = String(s ?? '').trim().toLowerCase(); return v.length > 0 && v.length <= 254 && !/[\r\n]/.test(String(s)) && EMAIL_RE.test(v); };
const logFail = (what, status, bodyText) => console.error(`mail: ${what}${status ? ` status=${status}` : ''}${bodyText ? ` body=${String(bodyText).slice(0, 300)}` : ''}`);

// Resolves to { ok, skipped?, id?, status? }; skipped is 'no-key' (no API key, or no idempotency key on the message),
// 'bad-address', 'suppressed' or 'budget'. A skipped or failed send never throws.
export async function sendMail(env, ctx, msg) {
  try {
    if (!env.RESEND_API_KEY) {
      if (!warnedNoKey.has(env)) { warnedNoKey.add(env); console.error('mail: RESEND_API_KEY is not set; email is switched off'); }
      return { ok: false, skipped: 'no-key' };
    }
    const to = String(msg?.to ?? '').trim().toLowerCase();
    if (!to || to.length > 254 || /[\r\n]/.test(String(msg.to)) || !EMAIL_RE.test(to)) return { ok: false, skipped: 'bad-address' };
    if (await env.DB.prepare('SELECT 1 AS x FROM suppressed WHERE email = ?').bind(to).first()) {
      if (msg.kind === 'owner') console.error('mail: an owner-kind message was skipped because its address is on the suppressed list');
      return { ok: false, skipped: 'suppressed' };
    }

    if (typeof msg.key !== 'string' || !msg.key.trim()) { logFail('message has no idempotency key; not sent'); return { ok: false, skipped: 'no-key' }; }

    const day = today(env);
    if (!(await takeBudget(env, msg.kind, day))) return { ok: false, skipped: 'budget' };

    const from = msg.from === 'support' ? (env.MAIL_FROM_SUPPORT || DEFAULT_FROM_SUPPORT) : oneLine(msg.from) || env.MAIL_FROM || DEFAULT_FROM;
    const body = { from, to: [to], subject: oneLine(msg.subject), html: msg.html, text: msg.text };
    if (msg.replyTo && validEmail(msg.replyTo)) body.reply_to = oneLine(msg.replyTo);
    if (msg.headers && typeof msg.headers === 'object') {
      const h = {};
      for (const [k, v] of Object.entries(msg.headers)) if (typeof v === 'string' && oneLine(k)) h[oneLine(k)] = oneLine(v);
      if (Object.keys(h).length) body.headers = h;
    }
    if (Array.isArray(msg.tags)) {
      const t = msg.tags.filter((x) => x && typeof x.name === 'string' && typeof x.value === 'string' && TAG_RE.test(x.name) && TAG_RE.test(x.value)).map((x) => ({ name: x.name, value: x.value }));
      if (t.length) body.tags = t;
    }

    let res, text = '';
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'User-Agent': 'mayobe-engage/1.0',
          'Idempotency-Key': msg.key.slice(0, 256),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS), // a hung connection must not hold waitUntil open
      });
      text = await res.text();
    } catch (e) {
      logFail(`fetch failed or timed out (${oneLine(e?.name)} ${oneLine(e?.message).slice(0, 100)})`);
      await giveBack(env, msg.kind, day);
      return { ok: false };
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) {
      logFail('send failed', res.status, text);
      if (res.status === 429 || res.status >= 500) await giveBack(env, msg.kind, day); // a retry can work; a permanent 4xx keeps its unit
      return { ok: false, status: res.status };
    }
    // 2xx means Resend took it. Without an id we still call it sent: a retry under a new key could duplicate the mail.
    if (!json?.id) logFail('sent, but the reply had no id', res.status, text);
    return { ok: true, id: json?.id ? String(json.id) : undefined, status: res.status };
  } catch (e) {
    try { logFail(`error (${oneLine(e?.message).slice(0, 100)})`); } catch { /* nothing more to do */ }
    return { ok: false };
  }
}
