// Sitemaps of the indexable pages. A page is listed exactly when index.js would send it without noindex (isIndexable below).
import { getCodes, getList, examsOf } from './data.js';
import { P } from './render.js';
import { PER_PAGE, esc } from './util.js';

export const URLS_PER_FILE = 10_000;

/** The one rule that decides robots and sitemaps. mode: off | hubs | all. */
export function isIndexable(mode, kind, ok) {
  if (!ok || mode === 'off') return false;
  if (kind === 'year') return mode === 'all';
  return kind === 'list' || kind === 'hub' || kind === 'overview' || kind === 'yearindex';
}
export const normMode = (v) => (v === 'hubs' || v === 'all' ? v : 'off');
/** RESULTS_INDEX_FROM: the first exam year that may be indexed (0 or empty = every year). A roll-out knob: start with the newest years, then lower it. */
export const normFrom = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1980 && n <= 2100 ? n : 2100; // a value that is set but wrong means "no year": it fails closed, like an unknown RESULTS_INDEX
};

/** Every indexable address of one exam-year, in a fixed order. */
export async function urlsOf(env, reg, exam, mode, from = 0, group = 'all') {
  // group: 'schools' = the pages of single schools (each year, and the all-years page); 'hubs' = year index, A to Z and region lists; 'all' = both.
  const wantSchools = group !== 'hubs', wantHubs = group !== 'schools';
  if (mode === 'off' || exam.year < from) return [];
  const list = await getList(env, exam, { keep: false }); // the sitemap walks every exam: no list is kept in memory afterwards
  const out = [];
  if (wantHubs && isIndexable(mode, 'yearindex', true)) out.push(P.yearIndex(exam.cat, exam.year));
  if (wantHubs && isIndexable(mode, 'list', true)) {
    for (const [L, rows] of [...list.letters.entries()].sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0] < b[0] ? -1 : 1))) {
      const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
      for (let n = 1; n <= pages; n++) out.push(P.list(exam.cat, exam.year, L, n));
    }
  }
  if (wantHubs && exam.kind === 'primary' && list.regions && isIndexable(mode, 'hub', true)) { // region and district hubs of PSLE and SFNA; the address carries the exam, so the two never share a URL
    for (const R of [...list.regions.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
      out.push(P.region(exam.cat, exam.year, R.slug));
      for (const D of [...R.districts.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
        const pages = Math.max(1, Math.ceil(D.rows.length / PER_PAGE));
        for (let n = 1; n <= pages; n++) out.push(P.district(exam.cat, exam.year, D.slug, n));
      }
    }
  }
  if (wantSchools && isIndexable(mode, 'overview', true)) {
    // an overview is listed once, with the newest year the centre has results for
    const later = new Set();
    for (const e of examsOf(reg, exam.cat)) {
      if (e.year <= exam.year) continue;
      for (const c of await getCodes(env, e)) later.add(c);
    }
    // the overview shows the figures of the centre's newest year, so it follows that year's bar: a centre too small to index there is not listed
    for (const r of list.rows) if (!later.has(r.c) && !exam.thinSet.has(r.c)) out.push(P.overview(exam.cat, r.c));
  }
  if (wantSchools && isIndexable(mode, 'year', true)) {
    for (const r of list.rows) if (!exam.thinSet.has(r.c)) out.push(P.year(exam.cat, r.c, exam.year));
  }
  return out;
}

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** The child file name: sitemap-<cat>-<year>-<n>.xml (everything), sitemap-schools-... (single schools only) or sitemap-hubs-... (lists only). */
export const partName = (group, exam, i) => `sitemap-${group === 'all' ? '' : group + '-'}${exam.cat}-${exam.year}-${i}.xml`;

export async function sitemapIndex(env, reg, mode, origin, from = 0, group = 'all') {
  const items = [];
  for (const exam of reg.exams) {
    const n = Math.ceil((await urlsOf(env, reg, exam, mode, from, group)).length / URLS_PER_FILE);
    for (let i = 1; i <= n; i++) items.push(`  <sitemap><loc>${esc(`${origin}/results/${partName(group, exam, i)}`)}</loc><lastmod>${esc(exam.verified)}</lastmod></sitemap>`);
  }
  return `${XML}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`;
}

/** The part file, or null when the exam or the part does not exist. */
export async function sitemapPart(env, reg, mode, origin, id, n, from = 0, group = 'all') {
  const exam = reg.byId.get(id);
  if (!exam) return null;
  const all = await urlsOf(env, reg, exam, mode, from, group);
  const slice = all.slice((n - 1) * URLS_PER_FILE, n * URLS_PER_FILE);
  if (!slice.length) return null;
  return `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${slice.map((p) => `  <url><loc>${esc(origin + p)}</loc><lastmod>${esc(exam.verified)}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}
