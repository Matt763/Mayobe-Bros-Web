// Sends email through Resend's REST API (plain fetch, no SDK). sendMail never throws: a mail problem must never
// fail, delay or roll back the request that asked for it. Run it inside ctx.waitUntil after the data is saved.

const API = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Mayobe Bros <info@mayobebros.com>';
const DEFAULT_FROM_SUPPORT = 'Mayobe Bros <support@mayobebros.com>';
// Free plan: 100 a day. 80 are used, split by kind; a full slice never borrows from another.
export const CAPS = { owner: 10, commenter: 25, contact: 10, news: 35 };
const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\.]{2,}$/;

let warnedNoKey = false;
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
const logFail = (what, status, bodyText) => console.error(`mail: ${what}${status ? ` status=${status}` : ''}${bodyText ? ` body=${String(bodyText).slice(0, 300)}` : ''}`);

export async function sendMail(env, ctx, msg) {
  try {
    if (!env.RESEND_API_KEY) {
      if (!warnedNoKey) { warnedNoKey = true; console.error('mail: RESEND_API_KEY is not set; email is switched off'); }
      return { ok: false, skipped: 'no-key' };
    }
    const to = String(msg?.to ?? '').trim().toLowerCase();
    if (!to || to.length > 254 || /[\r\n]/.test(String(msg.to)) || !EMAIL_RE.test(to)) return { ok: false, skipped: 'bad-address' };
    if (await env.DB.prepare('SELECT 1 AS x FROM suppressed WHERE email = ?').bind(to).first()) return { ok: false, skipped: 'suppressed' };

    const day = today(env);
    if (!(await takeBudget(env, msg.kind, day))) return { ok: false, skipped: 'budget' };

    const from = msg.from === 'support' ? (env.MAIL_FROM_SUPPORT || DEFAULT_FROM_SUPPORT) : oneLine(msg.from) || env.MAIL_FROM || DEFAULT_FROM;
    const body = { from, to: [to], subject: oneLine(msg.subject), html: msg.html, text: msg.text };
    if (msg.replyTo) body.reply_to = oneLine(msg.replyTo);
    if (msg.headers) body.headers = msg.headers;
    if (msg.tags) body.tags = msg.tags;

    let res, text = '';
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'User-Agent': 'mayobe-engage/1.0',
          'Idempotency-Key': String(msg.key || '').slice(0, 256),
        },
        body: JSON.stringify(body),
      });
      text = await res.text();
    } catch (e) {
      logFail(`fetch failed (${oneLine(e?.message).slice(0, 100)})`);
      await giveBack(env, msg.kind, day);
      return { ok: false };
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !json?.id) {
      logFail(res.ok ? 'unexpected reply' : 'send failed', res.status, text);
      await giveBack(env, msg.kind, day);
      return { ok: false, status: res.status };
    }
    return { ok: true, id: String(json.id), status: res.status };
  } catch (e) {
    try { logFail(`error (${oneLine(e?.message).slice(0, 100)})`); } catch { /* nothing more to do */ }
    return { ok: false };
  }
}
