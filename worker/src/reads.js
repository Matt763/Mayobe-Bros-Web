// "Most read": counts engaged reads in the background so the Popular page can be ordered by what readers really open.
// The numbers never leave the Worker except to the owner (GET /v1/admin/popular); the public site only ever shows the ORDER.
//
// What counts as a read (decided by js/reads.js in the browser): the article was on screen for at least 20 seconds and the reader
// scrolled at least 40% of it. Here, a visitor counts once per article per UTC day. The visitor is a salted hash of (article, network,
// browser, HASH_SALT, day): it changes every day, is kept two days at most, and is not stored with anything else.
//
// Ranking (best practice for low traffic: decayed volume with a minimum amount of evidence, not a ratio that lets 3 reads beat 40):
//   S = sum over the last 28 days of min(reads that day, 10) x 0.5^(age in days / 7)        (a read from /popular/ counts half)
//   an article is eligible with at least 8 reads on at least 3 different days; eligible ones are ordered by S - sqrt(S),
//   a cautious score that needs more evidence to climb. The page shows "most read" only when MIN_POSTS articles are eligible.
import { now, sha, utcDay } from './util.js';

export const WINDOW_DAYS = 28;
export const HALF_LIFE_DAYS = 7;
export const DAY_CAP = 10; // one article cannot gain more than this many reads on one day (one busy day or one share cannot decide the page)
export const MIN_READS = 8;
export const MIN_DAYS = 3;
export const MIN_POSTS = 5;
export const SEEN_KEEP_DAYS = 1; // visitor codes older than yesterday go (each code is only useful on its own day)
export const PER_NETWORK_ARTICLE = 4; // distinct visitors one network can add to one article in a day (a household or an office can share an address)
export const READS_KEEP_DAYS = 60;

const BOT_RE = /(?:google|bing|yandex|baidu|ahrefs|semrush|duckduck|apple|petal|dot|twitter|linkedin|slack|telegram|discord|whatsapp|facebook)\w*bot|\bbot\b|\+https?:|spider|crawl|slurp|headless|lighthouse|pagespeed|phantomjs|python-|curl\/|wget\/|axios|node-fetch|go-http|java\//i;
export const looksLikeBot = (ua) => BOT_RE.test(String(ua || ''));

const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);

// Only the kind of browser matters here (system + browser family), not the exact string: a script that changes its User-Agent on every request
// must not become a new "visitor" each time.
export function browserClass(ua) {
  const u = String(ua || '').toLowerCase();
  const os = /android/.test(u) ? 'android' : /iphone|ipad|ipod/.test(u) ? 'ios' : /windows/.test(u) ? 'windows' : /mac os|macintosh/.test(u) ? 'mac' : /cros/.test(u) ? 'cros' : /linux/.test(u) ? 'linux' : 'other';
  const br = /edg\//.test(u) ? 'edge' : /opr\/|opera/.test(u) ? 'opera' : /firefox|fxios/.test(u) ? 'firefox' : /samsungbrowser/.test(u) ? 'samsung' : /chrome|crios|chromium/.test(u) ? 'chrome' : /safari/.test(u) ? 'safari' : 'other';
  return `${os}-${br}`;
}
// A browser always names itself; an empty or tiny User-Agent is a script.
export const looksTooBare = (ua) => String(ua || '').trim().length < 20;

// One visitor, one article, one day -> a short code. Same network and same kind of browser on the same day give the same code (so a reload does not count twice).
export async function readerCode(env, slug, net, ua, day = utcDay()) {
  return (await sha(`${slug}|${net}|${browserClass(ua)}|${env.HASH_SALT}|${day}`)).slice(0, 16);
}

// Has this visitor already been counted for this article today?
export async function alreadyCounted(env, slug, code, day = utcDay()) {
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM read_seen WHERE day = ? AND slug = ? AND vh = ?').bind(day, slug, code).first());
}

// Adds one read unless this visitor already counted today. The total is raised only while no code exists for the visitor yet; the code is saved right after.
export async function countRead(env, slug, code, fromPopular, day = utcDay()) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO post_reads(slug, day, n, n_pop) SELECT ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM read_seen WHERE day = ? AND slug = ? AND vh = ?) ON CONFLICT(slug, day) DO UPDATE SET n = n + 1, n_pop = n_pop + excluded.n_pop').bind(slug, day, fromPopular ? 1 : 0, day, slug, code),
    env.DB.prepare('INSERT OR IGNORE INTO read_seen(day, slug, vh) VALUES(?, ?, ?)').bind(day, slug, code),
  ]);
}

// Pure: rows are { slug, day, n, n_pop }. Returns { ready, ranked: [slug...], rows: [{ slug, reads, days, score }] } (the numbers are for the owner only).
export function rank(rows, at = now()) {
  const today = dayString(at);
  const bySlug = new Map();
  for (const r of rows) {
    const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.day}T00:00:00Z`)) / 86400000);
    if (!(age >= 0 && age < WINDOW_DAYS)) continue;
    const effective = Math.max(0, (r.n || 0) - 0.5 * (r.n_pop || 0));
    const e = bySlug.get(r.slug) || { slug: r.slug, reads: 0, days: 0, score: 0 };
    e.reads += r.n || 0;
    if ((r.n || 0) > 0) e.days += 1;
    e.score += Math.min(effective, DAY_CAP) * Math.pow(0.5, age / HALF_LIFE_DAYS);
    bySlug.set(r.slug, e);
  }
  const eligible = [...bySlug.values()].filter((e) => e.reads >= MIN_READS && e.days >= MIN_DAYS);
  for (const e of eligible) e.bound = e.score - Math.sqrt(e.score);
  eligible.sort((a, b) => b.bound - a.bound || b.score - a.score || (a.slug < b.slug ? -1 : 1));
  return {
    ready: eligible.length >= MIN_POSTS,
    ranked: eligible.map((e) => e.slug),
    rows: eligible.map((e) => ({ slug: e.slug, reads: e.reads, days: e.days, score: Math.round(e.score * 100) / 100 })),
  };
}

export async function popularNow(env, at = now()) {
  const since = dayString(at - (WINDOW_DAYS - 1) * 86400000);
  const rows = await env.DB.prepare('SELECT slug, day, n, n_pop FROM post_reads WHERE day >= ?').bind(since).all();
  return rank(rows.results || [], at);
}

// Daily clean-up (the cron trigger calls it): the visitor codes after two days, the daily totals after sixty.
export async function purgeReads(env, at = now()) {
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM read_seen WHERE day < ?').bind(dayString(at - SEEN_KEEP_DAYS * 86400000)),
      env.DB.prepare('DELETE FROM post_reads WHERE day < ?').bind(dayString(at - READS_KEEP_DAYS * 86400000)),
    ]);
  } catch (err) {
    console.error('reads purge failed', err && err.message ? err.message : err);
  }
}
