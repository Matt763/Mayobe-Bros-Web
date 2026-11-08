// Signed "approve" and "ignore" links for the held-comment email. The link holds the comment id, the action, an expiry and an
// HMAC-SHA256 signature made with the Worker secret REVIEW_SECRET, so nobody can make one for another comment or action.
// Nothing is stored. The token travels in the #fragment of a /manage/ link, so it is never sent to a server by opening the link.

import { enc, same } from './util.js';

export const REVIEW_DAYS = 7;
export const REVIEW_TOKEN_RE = /^(\d{1,9})\.([ai])\.([a-z0-9]{1,10})\.([A-Za-z0-9_-]{43})$/;
const ACTION = { approve: 'a', ignore: 'i' };
const NAME = { a: 'approve', i: 'ignore' };

const b64url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
async function sign(secret, id, code, exp) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`review|${id}|${code}|${exp}`))));
}

/** A token for `action` ('approve' | 'ignore') on comment `id`, or '' when there is no secret or the input is wrong. */
export async function reviewToken(env, id, action, nowMs = Date.now()) {
  const secret = env?.REVIEW_SECRET;
  const code = ACTION[action];
  if (typeof secret !== 'string' || secret.length < 16 || !code || !Number.isSafeInteger(id) || id < 1 || id > 999999999) return '';
  const exp = Math.floor(nowMs / 1000) + REVIEW_DAYS * 86400;
  return `${id}.${code}.${exp.toString(36)}.${await sign(secret, id, code, exp)}`;
}

/** { id, action } for a token that is well formed, correctly signed and not expired; otherwise null. */
export async function checkReviewToken(env, token, nowMs = Date.now()) {
  const secret = env?.REVIEW_SECRET;
  if (typeof secret !== 'string' || secret.length < 16 || typeof token !== 'string') return null;
  const m = REVIEW_TOKEN_RE.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  const exp = parseInt(m[3], 36);
  const want = await sign(secret, id, m[2], exp);
  if (!same(want, m[4])) return null;
  if (!(exp * 1000 > nowMs)) return null;
  return { id, action: NAME[m[2]] };
}

/** The two links for the email, or null when review links are switched off (no REVIEW_SECRET). */
export async function reviewLinks(env, id, origin) {
  const [a, i] = [await reviewToken(env, id, 'approve'), await reviewToken(env, id, 'ignore')];
  if (!a || !i) return null;
  return { approveUrl: `${origin}/manage/#r=${a}`, ignoreUrl: `${origin}/manage/#r=${i}` };
}
