// The site's page frame (header, footer, styles) comes from results-shell.html, which `node scripts/build.mjs` writes into the blog.
// The Worker fetches it from the origin (a path the Worker route does not match), keeps it in memory for a few minutes and fills the tokens.
import { esc, hash } from './util.js';

const TTL = 300_000;
let memo = null; // { t, text, v }

/** { text, v } or null when the origin cannot be reached. v is a short signature that goes into cache keys. */
export async function getShell(env, now = Date.now()) {
  if (memo && now - memo.t < TTL) return memo;
  try {
    const f = env.FETCH_SHELL || fetch;
    const r = await f(`${String(env.ORIGIN || 'https://mayobebros.com').replace(/\/$/, '')}/results-shell.html`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) throw new Error('shell ' + r.status);
    const raw = await r.text();
    if (!raw.includes('%%MAIN%%')) throw new Error('shell has no %%MAIN%%');
    const appJs = appScriptTag(raw);
    const ogImage = (/<!--og-image:(.*?)-->/.exec(raw) || [])[1] || '';
    const text = raw.replace(/<!--app-js:.*?-->\n?/, '').replace(/<!--og-image:.*?-->\n?/, '');
    memo = { t: now, text, appJs, ogImage, v: hash(raw) };
    return memo;
  } catch {
    return memo; // an older copy is better than none
  }
}
export function resetShell() { memo = null; }

/**
 * Tokens: %%TITLEFULL%% (the <title>), %%TITLE%% (share titles), %%DESC%%, %%PATH%% (canonical path), %%ROBOTS%% (the whole meta tag),
 * %%JSONLD%% (script tags), %%APPJS%% (the module script, only on pages that run the app), %%OGIMG%% and %%OGALT%% (the link-preview picture: the exam-year's
 * cover card, or the site card when the shell has no better one, and what it shows) and %%MAIN%%.
 * All of them are filled in ONE pass over the shell, so text put into one (a name with "%%MAIN%%" in it) is never read as another token.
 */
export function fillShell(shell, page) {
  const values = {
    TITLEFULL: esc(page.titleFull),
    TITLE: esc(page.title),
    DESC: esc(page.description),
    PATH: esc(page.path),
    ROBOTS: `<meta name="robots" content="${esc(page.robots)}">`,
    JSONLD: page.jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n'),
    APPJS: page.app ? shell.appJs : '',
    OGIMG: esc(page.image || shell.ogImage || ''),
    OGALT: esc(page.imageAlt || 'Mayobe Bros: NECTA results by school'),
    MAIN: page.main,
  };
  return shell.text.replace(/%%([A-Z]+)%%/g, (m, k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m));
}

/** The module script tag is written in the shell as a comment-free token; this finds its address for the pages that need it. */
export function appScriptTag(shellText) {
  const m = /<!--app-js:(.*?)-->/.exec(shellText);
  return m ? m[1] : '';
}
