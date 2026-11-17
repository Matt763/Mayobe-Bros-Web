// Reads the results files from the R2 bucket (binding env.RESULTS; the objects have the same names as the folder results-data/).
// Everything read is kept in memory for the life of the isolate, keyed by the exam's `key` from registry.json, so changed data is
// never mixed with old data. The registry itself is re-read after REGISTRY_TTL.
import { decodeCentre, decodeHeader, decodeList, stats } from '../../js/results-codec.js';
import { letterOf, letterSlug, slug } from './util.js';

const REGISTRY_TTL = 300_000;
let regMemo = null; // { t, reg, dv }
const metaMemo = new Map();
const listMemo = new Map();

export async function getText(env, key) {
  const o = await env.RESULTS.get(key);
  return o ? o.text() : null;
}

/** { exams: [...], byId, dv } where dv is a short signature of all data keys (part of every page's cache key). */
export async function getRegistry(env, now = Date.now()) {
  if (regMemo && now - regMemo.t < REGISTRY_TTL) return regMemo.reg;
  const text = await getText(env, 'registry.json');
  let exams = [];
  if (text) {
    try { const j = JSON.parse(text); if (j && j.v === 1 && Array.isArray(j.exams)) exams = j.exams; } catch { exams = []; }
  }
  for (const e of exams) e.thinSet = new Set(e.thin ? e.thin.split(',') : []);
  const reg = { exams, byId: new Map(exams.map((e) => [e.id, e])), dv: exams.map((e) => e.id + e.key).join('|') };
  regMemo = { t: now, reg };
  return reg;
}
export function resetMemory() { regMemo = null; metaMemo.clear(); listMemo.clear(); codeMemo.clear(); }

export const examsOf = (reg, cat) => reg.exams.filter((e) => e.cat === cat).sort((a, b) => b.year - a.year);

export async function getMeta(env, exam) {
  const k = exam.id + ':' + exam.key;
  if (!metaMemo.has(k)) {
    const text = await getText(env, `${exam.id}/meta.json`);
    metaMemo.set(k, text ? JSON.parse(text) : null);
  }
  return metaMemo.get(k);
}

/**
 * The centre list of an exam-year, only centres with results here, plus the indexes the list pages need:
 * rows (sorted by code), byCode, letters (letter -> rows sorted by name), regions (primary only).
 * `keep: false` (the sitemap code, which walks every exam) decodes without remembering the result, so the isolate never holds every list at once.
 */
export async function getList(env, exam, { keep = true } = {}) {
  const k = exam.id + ':' + exam.key;
  if (listMemo.has(k)) return listMemo.get(k);
  const text = await getText(env, `${exam.id}/list.json`);
  const all = text ? decodeList(JSON.parse(text), exam.kind) : [];
  const rows = [];
  for (const r of all) if (r[2]) rows.push({ code: r[0], c: r[0].toLowerCase(), name: r[1], region: r[3] || '', district: r[4] || '' });
  const byCode = new Map(rows.map((r) => [r.c, r]));
  const letters = new Map();
  for (const r of rows) {
    const L = letterOf(r.name);
    if (!letters.has(L)) letters.set(L, []);
    letters.get(L).push(r);
  }
  for (const arr of letters.values()) arr.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.c < b.c ? -1 : 1));
  let regions = null;
  if (exam.kind === 'primary') {
    regions = new Map();
    for (const r of rows) {
      if (!r.region) continue;
      const rs = slug(r.region);
      if (!regions.has(rs)) regions.set(rs, { slug: rs, name: r.region, districts: new Map(), count: 0 });
      const R = regions.get(rs);
      R.count++;
      const ds = rs + '-' + slug(r.district || 'unknown');
      if (!R.districts.has(ds)) R.districts.set(ds, { slug: ds, name: r.district || 'Unknown', region: R, rows: [] });
      R.districts.get(ds).rows.push(r);
    }
    for (const R of regions.values()) for (const D of R.districts.values()) D.rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.c < b.c ? -1 : 1));
  }
  const list = { rows, byCode, letters, regions };
  if (keep) listMemo.set(k, list);
  return list;
}

/** A name compared without case, spacing or punctuation. */
export const nameKey = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How many centres of the list share this name (one pass over the list, remembered on it): such a page needs its centre number in its title. */
export function nameCount(list, name) {
  if (!list.dupNames) {
    list.dupNames = new Map();
    for (const r of list.rows) { const n = nameKey(r.name); list.dupNames.set(n, (list.dupNames.get(n) || 0) + 1); }
  }
  return list.dupNames.get(nameKey(name)) || 0;
}

/** The codes of the centres that have results in an exam-year, as a small Set (for "does a newer year have this centre"). */
const codeMemo = new Map();
export async function getCodes(env, exam) {
  const k = exam.id + ':' + exam.key;
  if (!codeMemo.has(k)) codeMemo.set(k, new Set((await getList(env, exam, { keep: false })).rows.map((r) => r.c)));
  return codeMemo.get(k);
}

/** The text of one centre file, or null. Codes are lower case. */
export const getCentreText = (env, exam, code) => getText(env, `${exam.id}/${code}.txt`);

/** Does the centre have a file for this exam-year? (head when the binding has it: no body is read) */
export async function hasCentre(env, exam, code) {
  const key = `${exam.id}/${code}.txt`;
  if (typeof env.RESULTS.head === 'function') return !!(await env.RESULTS.head(key));
  return !!(await env.RESULTS.get(key));
}

/** Name of a centre from the first line of its file (the same rule as decodeCentre), without decoding any row. */
export function headerName(text, meta) {
  const f = text.slice(0, text.indexOf('\n')).split(';');
  const ci = f[1].indexOf(':');
  return f[1].slice(ci + 1).replace(/\x01/g, ';') + meta.nc[+f[1].slice(0, ci)];
}

export { decodeCentre, decodeHeader, stats, letterSlug };
