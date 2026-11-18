// mayobe-results: renders the indexable results pages on mayobebros.com/results/* from the files in R2.
// handle(request, env, ctx) is the whole Worker; tests and scripts/serve.mjs call it directly with a stand-in for env.RESULTS.
//   env.RESULTS        R2 bucket binding (objects named like the files in results-data/)
//   env.ORIGIN         https://mayobebros.com (where results-shell.html is fetched and what absolute addresses start with)
//   env.RESULTS_INDEX  off | hubs | all   (anything else means off)
//   env.RESULTS_INDEX_FROM  first exam year that may be indexed (empty = all years); older years stay noindex and out of the sitemaps
import { getCentreText, getList, getMeta, getRegistry, examsOf, hasCentre, headerName, decodeCentre, decodeHeader, nameCount } from './data.js';
import { districtPage, listPage, notFoundPage, overviewPage, regionPage, yearIndexPage, yearPage, P } from './render.js';
import { fillShell, getShell } from './shell.js';
import { isIndexable, normFrom, normMode, sitemapIndex, sitemapPart } from './sitemap.js';
import { EXAMS, PER_PAGE, hash, letterOf, slugLetter } from './util.js';

const CACHE_OK = 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400';
const CACHE_404 = 'public, max-age=60, s-maxage=600';
const CACHE_REDIRECT = 'public, max-age=3600, s-maxage=86400';
const CODE_RE = /^[a-z]{1,2}\d{3,9}$/;
const DATA_RE = /^(?:registry\.json|(?:csee|acsee|psle|ftna|sfna|dsee|dpee|dppee|dspee|dte|qt)-\d{4}\/(?:meta\.json|list\.json|[a-z0-9]+\.(?:txt|pm)))$/;
// Bump when a title, description or page template changes in a way the cached pages (kept 30 days at the edge) must not hide.
const CODE_V = '4';

export function robotsFor(mode, kind, ok) {
  mode = normMode(mode);
  if (mode === 'off' || kind === 'notfound') return 'noindex, nofollow';
  return isIndexable(mode, kind, ok) ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow';
}

const baseHeaders = (type, cache) => ({ 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Content-Language': 'en' });

function redirect(to, status = 301) {
  return new Response(null, { status, headers: { Location: to, 'Cache-Control': CACHE_REDIRECT, 'X-Robots-Tag': 'noindex' } });
}

function textResponse(body, type, status, cache, robots, modified) {
  const h = baseHeaders(type, cache);
  if (robots) h['X-Robots-Tag'] = robots;
  const t = modified ? Date.parse(`${modified}T00:00:00Z`) : NaN;
  if (!Number.isNaN(t)) {
    h['Last-Modified'] = new Date(t).toUTCString();
    // The validator is the ETag, built from the page itself (so it changes with the robots rule, the title or the data). A crawler that asks
    // "same as before?" gets a cheap 304 only when the page really is the same; a date alone could keep an old noindex alive after a roll-out.
    h.ETag = `W/"${hash(String(body))}-${String(body).length.toString(36)}"`;
  }
  return new Response(body, { status, headers: h });
}

/** 304 when the crawler's If-None-Match names this page's ETag. (If-Modified-Since is deliberately not used: see textResponse.) */
function notModified(request, res) {
  const etag = res.headers.get('ETag');
  const inm = request.headers.get('If-None-Match');
  if (res.status !== 200 || !etag || !inm) return res;
  if (!inm.split(',').some((x) => x.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))) return res;
  const h = new Headers(res.headers);
  h.delete('Content-Length');
  return new Response(null, { status: 304, headers: h });
}

/** Turn the address into a route, or null. Segments are matched in lower case; `canonical` is the one address a page lives at. */
export function parse(pathname) {
  let segs = pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  if (segs[segs.length - 1] === 'index.html') segs.pop();
  if (segs[0] !== 'results') return null;
  segs = segs.slice(1);
  const slash = (a) => '/results/' + a.join('/') + (a.length ? '/' : '');
  const n = segs.length;
  const [a, b, c, d, e] = segs;
  if (n === 0) return { type: 'home', canonical: '/results/' };
  if (n === 1 && a === 'sitemap.xml') return { type: 'sitemap-index', group: 'all', canonical: '/results/sitemap.xml', file: true };
  // the school sitemap (every single school page) and the hub sitemap (year index, A to Z and region lists) are separate, so each is reported on its own
  if (n === 1 && (a === 'sitemap-schools.xml' || a === 'sitemap-hubs.xml')) return { type: 'sitemap-index', group: a.slice(8, -4), canonical: '/results/' + a, file: true };
  if (n === 1) { const m = /^sitemap-(?:(schools|hubs)-)?(csee|acsee|psle|ftna|sfna|dsee|dpee|dppee|dspee|dte|qt)-(\d{4})-(\d+)\.xml$/.exec(a); if (m) return { type: 'sitemap-part', group: m[1] || 'all', id: `${m[2]}-${m[3]}`, part: Number(m[4]), canonical: '/results/' + a, file: true }; }
  if (a === 'data') return { type: 'data', key: segs.slice(1).join('/'), file: true, canonical: pathname };
  if (!EXAMS[a]) return null;
  if (n === 2 && /^\d{4}$/.test(b)) return { type: 'yearindex', cat: a, year: Number(b), canonical: slash(segs) };
  if (n === 2 && CODE_RE.test(b)) return { type: 'overview', cat: a, code: b, canonical: slash(segs) };
  if (n === 3 && CODE_RE.test(b) && /^\d{4}$/.test(c)) return { type: 'year', cat: a, code: b, year: Number(c), canonical: slash(segs) };
  if (/^\d{4}$/.test(b)) {
    const year = Number(b);
    if ((n === 3 || n === 4) && slugLetter(c)) {
      const page = n === 4 ? (/^\d+$/.test(d) ? Number(d) : 0) : 1;
      if (!page) return null;
      return { type: 'list', cat: a, year, letter: slugLetter(c), page, canonical: slash(page === 1 ? segs.slice(0, 3) : segs) };
    }
    if (EXAMS[a].kind === 'primary' && (c === 'region' || c === 'district') && d && /^[a-z0-9-]+$/.test(d)) {
      if (c === 'region' && n === 4) return { type: 'region', cat: a, year, slug: d, canonical: slash(segs) };
      if (c === 'district' && (n === 4 || n === 5)) {
        const page = n === 5 ? (/^\d+$/.test(e) ? Number(e) : 0) : 1;
        if (!page) return null;
        return { type: 'district', cat: a, year, slug: d, page, canonical: slash(page === 1 ? segs.slice(0, 4) : segs) };
      }
    }
  }
  return null;
}

export async function handle(request, env, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const url = new URL(request.url);
  const mode = normMode(env.RESULTS_INDEX);
  const from = normFrom(env.RESULTS_INDEX_FROM);
  const origin = String(env.ORIGIN || 'https://mayobebros.com').replace(/\/$/, '');
  const route = parse(url.pathname);

  if (!route) return notFound(env, mode, origin, ctx);
  if (route.type === 'home') return redirect(P.results(), 302);
  if (route.type === 'data') return dataResponse(env, route.key);
  if (!route.file && url.pathname !== route.canonical) return redirect(route.canonical);
  if (route.file && route.type !== 'data' && url.pathname !== route.canonical) return redirect(route.canonical);

  // Pages made ahead of time (scripts/tools/results-prerender.mjs, objects pages/...): no registry, no data and no building, so the work per
  // request is small enough for the free plan's 10 ms. A stored page is served as it is; only a page that is not stored is built here.
  const stored = await fromStore(env, route);
  if (stored) {
    if (stored.kind === 'file') {
      if (mode === 'off') return textResponse('Not found', 'text/plain; charset=utf-8', 404, CACHE_404, 'noindex, nofollow');
      return notModified(request, textResponse(stored.body, 'application/xml; charset=utf-8', 200, CACHE_STORED, 'noindex', stored.modified));
    }
    const shell = await getShell(env);
    if (!shell) return textResponse('This page is not available right now. Try again in a minute.', 'text/plain; charset=utf-8', 503, 'no-store', 'noindex');
    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    const key = new Request(`${origin}${route.canonical}?__rp=${hash(`${CODE_V}|${shell.v}|${mode}|${from}`)}`);
    if (cache) { const hit = await cache.match(key); if (hit) return notModified(request, hit); }
    const res = pageResponse(env, shell, route, stored.page, mode, from, origin, CACHE_STORED);
    if (cache && request.method === 'GET') { const put = cache.put(key, res.clone()); if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put; }
    return notModified(request, res);
  }

  const [shell, reg] = await Promise.all([getShell(env), getRegistry(env)]);
  const tag = hash(`${CODE_V}|${shell ? shell.v : 'x'}|${reg.dv}|${mode}|${from}`);
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(`${origin}${route.canonical}?__rc=${tag}`);
  if (cache && shell) { const hit = await cache.match(key); if (hit) return notModified(request, hit); }

  let res;
  if (route.type === 'sitemap-index' || route.type === 'sitemap-part') {
    if (mode === 'off') return textResponse('Not found', 'text/plain; charset=utf-8', 404, CACHE_404, 'noindex, nofollow');
    const xml = route.type === 'sitemap-index' ? await sitemapIndex(env, reg, mode, origin, from, route.group) : await sitemapPart(env, reg, mode, origin, route.id, route.part, from, route.group);
    res = xml ? textResponse(xml, 'application/xml; charset=utf-8', 200, CACHE_OK, 'noindex') : textResponse('Not found', 'text/plain; charset=utf-8', 404, CACHE_404, 'noindex, nofollow');
  } else {
    if (!shell) return textResponse('This page is not available right now. Try again in a minute.', 'text/plain; charset=utf-8', 503, 'no-store', 'noindex');
    const page = await build(env, reg, route, origin);
    if (!page) return notFound(env, mode, origin, ctx, shell);
    res = pageResponse(env, shell, route, page, mode, from, origin, CACHE_OK);
  }
  if (cache && res.status === 200 && request.method === 'GET') {
    const put = cache.put(key, res.clone());
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return notModified(request, res);
}

/** The finished response of a page object (what build() returns) inside the shell. Shared by the page built here and the stored one. */
function pageResponse(env, shell, route, page, mode, from, origin, cacheControl) {
  const robots = robotsFor(mode, page.kind, page.ok && !(page.year < from));
  const html = fillShell(shell, { ...page, titleFull: page.titleFull || (page.title.length + 14 <= 62 ? `${page.title} | Mayobe Bros` : page.title), robots, path: page.path, image: shareImageOf(route, page, origin), imageAlt: shareAltOf(route, page) });
  return textResponse(html, 'text/html; charset=utf-8', 200, cacheControl, robots.startsWith('index') ? '' : robots, page.modified);
}

// A stored page is a gzip JSON file: { page } (the object build() returns) or { xml, modified } for a sitemap. Missing, unreadable or without
// gzip support in the stand-in bucket (tests): null, and the page is built the usual way.
const CACHE_STORED = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';
export const storedKey = (canonical) => `pages${canonical}${canonical.endsWith('/') ? 'index' : ''}.json.gz`;
async function fromStore(env, route) {
  if (route.type === 'home' || route.type === 'data' || !env.RESULTS || typeof env.RESULTS.get !== 'function') return null;
  try {
    const o = await env.RESULTS.get(storedKey(route.canonical));
    if (!o || typeof o.arrayBuffer !== 'function') return null;
    const text = await new Response(new Blob([await o.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const j = JSON.parse(text);
    if (j && j.xml) return { kind: 'file', body: j.xml, modified: j.modified };
    return j && j.page && typeof j.page.main === 'string' ? { kind: 'page', page: j.page } : null;
  } catch { return null; }
}

/** The page object of an address (what is stored ahead of time), or null. Used by scripts/tools/results-prerender.mjs. */
export async function buildPage(env, pathname) {
  const route = parse(pathname);
  if (!route || route.file || route.type === 'home' || pathname !== route.canonical) return null;
  const reg = await getRegistry(env);
  const origin = String(env.ORIGIN || 'https://mayobebros.com').replace(/\/$/, '');
  const page = await build(env, reg, route, origin);
  return page ? { route, page } : null;
}

/** The link-preview picture of a page: the cover card of its exam-year's post (WhatsApp, Facebook, X), or null for the site card. */
function shareImageOf(route, page, origin) {
  const year = route.year || (route.type === 'overview' ? page.year : 0); // a school's all-years page shows the card of its newest year
  return route.cat && year ? `${origin}/assets/share/post-necta-${route.cat}-results-${year}.jpg` : null;
}

/** What that picture shows, in words: the exam-year's share card (cover, category chip, logo and web address). */
function shareAltOf(route, page) {
  const year = route.year || (route.type === 'overview' ? page.year : 0);
  return route.cat && year ? `Share card for NECTA ${route.cat.toUpperCase()} ${year} results on Mayobe Bros` : '';
}

async function notFound(env, mode, origin, ctx, shellIn) {
  const shell = shellIn || await getShell(env);
  if (!shell) return textResponse('Page not found', 'text/plain; charset=utf-8', 404, CACHE_404, 'noindex, nofollow');
  const page = notFoundPage();
  const html = fillShell(shell, { ...page, titleFull: `${page.title} | Mayobe Bros`, robots: 'noindex, nofollow', path: '/results/' });
  return textResponse(html, 'text/html; charset=utf-8', 404, CACHE_404, 'noindex, nofollow');
}

async function dataResponse(env, key) {
  if (!DATA_RE.test(key)) return textResponse('Not found', 'text/plain; charset=utf-8', 404, CACHE_404, 'noindex');
  const o = await env.RESULTS.get(key);
  if (!o) return textResponse('Not found', 'text/plain; charset=utf-8', 404, CACHE_404, 'noindex');
  const h = baseHeaders(key.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'public, max-age=3600, s-maxage=86400');
  h['X-Robots-Tag'] = 'noindex';
  if (o.httpEtag) h.ETag = o.httpEtag;
  return new Response(await o.text(), { status: 200, headers: h });
}

/** Reads what the route needs and builds the page object, or returns null for "no such page". */
async function build(env, reg, r, origin) {
  if (r.type === 'year') {
    const exam = reg.byId.get(`${r.cat}-${r.year}`);
    if (!exam) return null;
    const text = await getCentreText(env, exam, r.code);
    if (text === null) return null;
    const meta = await getMeta(env, exam);
    const rec = decodeCentre(text, meta, r.code.toUpperCase());
    const header = decodeHeader(text);
    const list = await getList(env, exam);
    const listed = list.byCode.get(r.code);
    const row = exam.kind === 'primary' ? listed : null;
    // the list holds the name as the exam's index prints it (the same for every centre of the exam), so that is what is compared
    const sameName = nameCount(list, listed ? listed.name : rec.name) > 1;
    const other = examsOf(reg, r.cat).filter((e) => e.year !== r.year);
    const have = await Promise.all(other.map((e) => hasCentre(env, e, r.code)));
    const others = other.filter((_, i) => have[i]).map((e) => ({ year: e.year }));
    return yearPage({ origin, exam, meta, rec, header, row, others, verified: meta.verified, hasLetter: letterOf(rec.name), sameName });
  }
  if (r.type === 'overview') {
    const exams = examsOf(reg, r.cat);
    const years = (await Promise.all(exams.map(async (exam) => {
      const text = await getCentreText(env, exam, r.code);
      if (text === null) return null;
      const meta = await getMeta(env, exam);
      return { exam, meta, name: headerName(text, meta), header: decodeHeader(text), verified: meta.verified };
    }))).filter(Boolean);
    if (!years.length) return null;
    const latestList = await getList(env, years[0].exam);
    const listedLatest = latestList.byCode.get(r.code);
    return overviewPage({ origin, cat: r.cat, code: r.code, years, sameName: nameCount(latestList, listedLatest ? listedLatest.name : years[0].name) > 1 });
  }
  const exam = reg.byId.get(`${r.cat}-${r.year}`);
  if (!exam) return null;
  const list = await getList(env, exam);
  const verified = exam.verified;
  const counts = new Map([...list.letters.entries()].map(([L, rows]) => [L, rows.length]));
  if (r.type === 'yearindex') return list.rows.length ? yearIndexPage({ origin, exam, counts, regions: list.regions, total: list.rows.length, verified }) : null;
  if (r.type === 'list') {
    const rows = list.letters.get(r.letter);
    if (!rows || (r.page - 1) * PER_PAGE >= rows.length) return null;
    return listPage({ origin, exam, letter: r.letter, page: r.page, rows: rows.slice((r.page - 1) * PER_PAGE, r.page * PER_PAGE), total: rows.length, counts, verified });
  }
  if (!list.regions) return null;
  if (r.type === 'region') { const region = list.regions.get(r.slug); return region ? regionPage({ origin, exam, region, verified }) : null; }
  if (r.type === 'district') {
    let found = null;
    for (const R of list.regions.values()) if (R.districts.has(r.slug)) { found = R.districts.get(r.slug); break; }
    if (!found || (r.page - 1) * PER_PAGE >= found.rows.length) return null;
    return districtPage({ origin, exam, district: found, page: r.page, verified });
  }
  return null;
}

export default { fetch: (request, env, ctx) => handle(request, env, ctx) };
