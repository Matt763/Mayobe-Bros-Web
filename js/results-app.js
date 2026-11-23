/* Mayobe Bros: the results app on the NECTA results posts (CSEE, ACSEE, PSLE).
   One module, no dependencies, no storage, no cookies. It boots from the data-* attributes of the root element (div.rs[data-rs])
   that scripts/lib/results-app.mjs writes, loads <data-base>/<exam>/list.json (the centre list) and, when a centre is opened,
   <data-base>/<exam>/meta.json plus <data-base>/<exam>/<lowercode>.txt (decoded by js/results-codec.js, data contract v3). Everything that comes from data is put in the page with
   textContent / DOM builders, never as HTML.

   Two views live on the one address of the post:
     exam view    ?q=&code=&cand=&letter=&p=     name / number / candidate search, A to Z, 200 centres a page
     centre view  ?centre=P0101&cq=&grade=&cno=  one centre: summary, candidate search, grade chips, table, result card
   Opening and closing a centre and page numbers use pushState; typing uses replaceState; Back restores the list, the filters and the
   scroll place. Other query parameters are never touched. Motion goes through window.MBMotion (js/motion.js) when it is there.

   Another year or exam (a link to a sibling results post) is switched in place, like the list pages of the blog: the page is fetched,
   only the app (the .rs element) is swapped, the old app is torn down (start() returns { destroy }) and a new one is started on the
   new element; the header, footer and cookie notice never move. See "Switching between results pages" below.

   The pure helpers (norm, tokens, parseCandidate, pagerWindow, readRoute, buildSearch, baseFilter, filterCandidates, matchResultsPost,
   createPageStore, readResultsPage ...) are exported so that scripts/tests/results-app.test.mjs and results-nav.test.mjs can test them
   in Node; nothing runs on import without a document. */

const OWNED = ['q', 'code', 'cand', 'letter', 'p', 'centre', 'cq', 'grade', 'cno'];
const PAGE = 200;          // centres on one page (two columns of 100)
const CHUNK = 120;         // candidate rows added at a time
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const NOT_GRADED = 'Not graded';
const CODE_RE = /^[a-z]{1,2}\d{3,9}$/i;
const ORDER = { secondary: ['I', 'II', 'III', 'IV', '0', 'ABS'], primary: ['A', 'B', 'C', 'D', 'E'] };

/* ------------------------------------------------------------------ what each exam is called and how its results read
   Pure data and functions; also used by scripts/lib/results-app.mjs and the Worker's pages (results-worker/src/render.js). */
const CLASS_WORDS = ['DISTINCTION', 'MERIT', 'CREDIT', 'PASS', 'FAIL'];
const DIPLOMA = { unit: 'college', cno: 'E0501/0001', code: 'E0501', name: 'Butimba', gpa: true, words: ['DISTINCTION', 'CREDIT', 'PASS', 'SUPP', 'FAIL'], pass: 3 };

export const PROFILES = {
  csee: { unit: 'centre', cno: 'P0134/0001', code: 'P0134', name: 'Moshi', gpaYears: [2014] },
  acsee: { unit: 'centre', cno: 'S0101/0001', code: 'S0101', name: 'Moshi', gpaYears: [2015] },
  ftna: { unit: 'centre', cno: 'S0101/0001', code: 'S0101', name: 'Moshi', words: ['I', 'II', 'III', 'IV', '0', 'REFERRED'] },
  qt: { unit: 'centre', cno: 'M0104/0001', code: 'M0104', name: 'Bwiru', noSubjects: true, words: ['PASSED', 'FAILED'], pass: 1 },
  psle: { unit: 'school', cno: 'PS0101114-0001', code: 'PS0101114', name: 'Albehije' },
  sfna: { unit: 'school', cno: 'PS0101114-0001', code: 'PS0101114', name: 'Albehije' },
  dsee: DIPLOMA, dpee: DIPLOMA, dppee: DIPLOMA, dspee: DIPLOMA, dte: DIPLOMA,
};

const ROMAN = ['I', 'II', 'III', 'IV', '0'];

/**
 * The reading of one exam-year. `meta` (meta.json of the exam, or null before it is loaded) says whether the aggregate is a GPA
 * (meta.gs) and which result words the data uses (meta.dw); without it the exam and year decide. `kind` is 'secondary' or 'primary'.
 */
export function profileOf(cat, meta, kind, year) {
  const base = PROFILES[cat] || PROFILES.csee;
  const primary = kind === 'primary';
  const classYear = !meta && (base.gpaYears || []).includes(Number(year));
  const words = meta ? (meta.dw || ROMAN) : classYear ? CLASS_WORDS : base.words || ROMAN;
  const roman = words[0] === 'I';
  const gpa = meta ? !!meta.gs : !!base.gpa || classYear;
  const noSubjects = !primary && (!!base.noSubjects || !!(meta && meta.subjects && meta.subjects.length === 0));
  const unit = base.unit;
  const diploma = unit === 'college';
  // what the result column is called: Division (I to IV), Class (distinction, merit ...), Result (anything else)
  const divName = primary ? 'Average grade' : roman ? 'Division' : diploma || noSubjects ? 'Result' : 'Class';
  return {
    cat, kind, unit, units: unit + 's', primary,
    cno: base.cno, code: base.code, name: base.name,
    gpa, noSubjects, words, roman,
    pass: meta && meta.dp !== undefined ? meta.dp : (roman ? 4 : base.pass !== undefined ? base.pass : 4),
    aggtHead: gpa ? 'GPA' : 'AGGT', aggtName: gpa ? 'GPA' : 'Aggregate', aggtShort: gpa ? 'GPA' : 'Aggt',
    divHead: primary ? 'AVERAGE GRADE' : roman ? 'DIV' : divName === 'Class' ? 'CLASS' : 'RESULT',
    divName, divShort: primary ? 'Average grade' : roman ? 'Div' : divName,
    findBy: primary ? 'school' : diploma ? 'college' : 'school or centre',
    nameLabel: primary ? 'School name' : diploma ? 'College name' : 'School or centre name',
    codeLabel: primary ? 'School number' : diploma ? 'College number' : 'Centre number',
  };
}

/** The label on a filter button: "Div I", "Grade B", and the plain word for anything else ("DISTINCTION", "REFERRED"). */
export const chipLabel = (key, prof) => (prof.primary ? (/^[A-E]$/.test(key) ? 'Grade ' + key : key) : (prof.roman && /^(I|II|III|IV|0)$/.test(key) ? 'Div ' + key : key));

/** NECTA spells the last subject of the old primary pages "Avarage Grade"; it is shown spelled correctly. */
export const subjectLabel = (name) => String(name).replace(/^avarage(?= grade$)/i, (m) => (m === m.toUpperCase() ? 'AVERAGE' : m[0] === 'A' ? 'Average' : 'average'));

/** Plain-word meaning of the result words and codes NECTA prints, for the "What the marks mean" box. */
export const WORD_NOTES = {
  ABS: 'Shown by NECTA for candidates marked absent.',
  ABSENT: 'The candidate did not sit the test.',
  '0': 'Division Zero.',
  DISTINCTION: 'The highest class NECTA gives.',
  MERIT: 'A class between distinction and credit.',
  CREDIT: 'A pass with credit.',
  PASS: 'A pass.',
  FAIL: 'The candidate did not pass.',
  FAILED: 'The candidate did not pass.',
  SUPP: 'Short for supplementary, as NECTA prints it.',
  PASSED: 'The candidate passed.',
  REFERRED: 'Shown by NECTA for candidates it referred. The line NECTA printed is shown as published.',
  Referred: 'Shown by NECTA for pupils it referred. The line NECTA printed is shown as published.',
};
/** A code with a star (*W, *R, E*) is NECTA’s own; the line printed beside it is shown as published. */
export const CODE_NOTE = 'A NECTA code. The line printed with it is shown as published.';

/* ------------------------------------------------------------------ pure helpers */

const MARKS = /[̀-ͯ]/g;
const APOS = /['’‘`´ʼ]/g;

/** Lower case, NFKC, accents and apostrophes removed, other punctuation read as a space ("marys" finds "MARY'S"). Digits are kept as they are. */
export function norm(s) {
  return String(s == null ? '' : s).normalize('NFKC').normalize('NFD').replace(MARKS, '').toLowerCase()
    .replace(APOS, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export const tokens = (s) => norm(s).split(' ').filter(Boolean);
/** Every word typed must appear somewhere in the text (partial words count). */
export const matchAll = (hay, toks) => toks.every((t) => hay.includes(t));
/** A centre code typed without spaces or capitals. */
export const normCode = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
/** The letter a centre is filed under in the A to Z bar. */
export function letterOf(name) {
  const m = /[A-Za-z0-9]/.exec(String(name));
  return m && /[A-Za-z]/.test(m[0]) ? m[0].toUpperCase() : '#';
}

/**
 * "P0101" -> {code:"P0101", seq:null}; "P0101/0001", "p0101-0001", "P0101 0001/2024" -> {code:"P0101", seq:"0001"};
 * "PS0101114-0" -> {code:"PS0101114", seq:"0"}. Anything else is null. The sequence stays a string, so leading zeros survive.
 */
export function parseCandidate(q) {
  const m = /^([a-z]{1,2}\d{3,9})(?:(?:\s*[\/-]\s*|\s+)(\d{0,5}))?(?:\s*[\/-]\s*(?:19|20)\d\d)?$/i.exec(String(q == null ? '' : q).normalize('NFKC').trim());
  if (!m) return null;
  return { code: m[1].toUpperCase(), seq: m[2] ? m[2] : null };
}

/** Page numbers to show in the bar: first, last and two either side of the current one; 'gap' marks a break. */
export function pagerWindow(cur, total) {
  const want = new Set([1, total, cur - 2, cur - 1, cur, cur + 1, cur + 2].filter((n) => n >= 1 && n <= total));
  const out = [];
  let last = 0;
  for (const n of [...want].sort((a, b) => a - b)) {
    if (n - last > 1) out.push('gap');
    out.push(n);
    last = n;
  }
  return out;
}
/** Which search tab an exam-view address opens: the candidate tab when it carries `cand`, otherwise the school tab. */
export const tabOf = (route) => (route && route.cand ? 'cand' : 'name');
/** The fields that filter the list: only the active tab's (the other tab keeps what was typed, but does not filter). */
export function activeFilter(ex, tab) {
  return tab === 'cand' ? { q: '', code: '', cand: ex.cand || '', letter: '' } : { q: ex.q || '', code: ex.code || '', cand: '', letter: ex.letter || '' };
}
/** The address parameters of the exam view: only the active tab's (buildSearch drops empty ones). */
export function examParams(ex, tab) {
  const p = ex.p > 1 ? ex.p : '';
  return tab === 'cand' ? { cand: ex.cand, p } : { q: ex.q, code: ex.code, letter: ex.letter, p };
}
/** Takes an address route into the typed values: the active tab's fields come from the address, the other tab's stay as they were. */
export function adoptExam(ex, route) {
  const tab = tabOf(route);
  return { tab, ex: tab === 'cand' ? { ...ex, cand: route.cand, p: route.p } : { ...ex, q: route.q, code: route.code, letter: route.letter, p: route.p } };
}
export const pageCount = (n, per = PAGE) => Math.max(1, Math.ceil(n / per));
export const clampPage = (p, pages) => Math.max(1, Math.min(pages, Number.isFinite(p) ? Math.floor(p) : 1));

/** The index rows, with the strings the search needs worked out once. */
export function prepRows(rows) {
  return rows.map((r) => {
    const [code, name, has, region = '', district = ''] = r;
    return { code, name, has: !!has, region, district, c: code.toLowerCase(), n: norm(name + ' ' + region + ' ' + district), L: letterOf(name) };
  });
}

/** AND across the three fields (the letter is applied separately so the A to Z counts stay right). */
export function baseFilter(rows, f) {
  const toks = tokens(f.q);
  const codeQ = normCode(f.code);
  const cn = parseCandidate(f.cand);
  const candQ = cn ? '' : normCode(f.cand);
  const cnCode = cn ? cn.code.toLowerCase() : '';
  return rows.filter((r) => {
    if (toks.length && !matchAll(r.n, toks)) return false;
    if (codeQ && !r.c.includes(codeQ)) return false;
    if (cn && (cn.seq !== null ? r.c !== cnCode : !r.c.startsWith(cnCode))) return false;
    if (candQ && !r.c.includes(candQ)) return false;
    return true;
  });
}
export function letterCounts(rows) {
  const counts = { '#': 0 };
  for (const l of LETTERS) counts[l] = 0;
  for (const r of rows) counts[r.L]++;
  return counts;
}

/** norm() for one character, without trimming or collapsing, so positions can be mapped back to the original text. */
function normChar(ch) {
  return ch.normalize('NFKC').normalize('NFD').replace(MARKS, '').toLowerCase().replace(APOS, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s/g, ' ');
}

/** Marks of the words in a text, as [start, end) ranges of the original text; works on the same rules as norm(). */
export function highlightRanges(text, toks) {
  text = String(text);
  if (!toks.length) return [];
  let flat = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const piece = normChar(text[i]);
    for (const ch of piece) { flat += ch; map.push(i); }
  }
  const raw = [];
  for (const t of toks) {
    if (!t) continue;
    let at = flat.indexOf(t);
    while (at !== -1) { raw.push([map[at], map[at + t.length - 1] + 1]); at = flat.indexOf(t, at + t.length); }
  }
  raw.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push(r.slice());
  }
  return out;
}

/** Candidate records ready to search: the group key (division or average grade), a search string and the sequence part. */
export function gradeKey(c, kind, prof) {
  if (kind === 'primary') {
    if (c.note) return /referred\s*$/i.test(c.note) ? 'Referred' : NOT_GRADED; // SFNA: the line NECTA printed ends with REFERRED
    return c.grade ? String(c.grade) : NOT_GRADED;
  }
  if (prof && prof.noSubjects) return c.div ? String(c.div) : NOT_GRADED; // QT: the result is the whole answer; a note rides along
  if (c.note === 'ABS') return 'ABS'; // FTNA absentees
  if (c.note) return NOT_GRADED;
  return c.div ? String(c.div) : NOT_GRADED;
}
export function prepCandidates(list, kind, prof) {
  return list.map((c) => ({
    c,
    key: gradeKey(c, kind, prof),
    seq: seqOf(c.cno),
    h: norm([c.cno, c.sex, c.aggt, c.div, c.grade, c.note, (c.subjects || []).map((s) => s[0] + ' ' + s[1]).join(' ')].filter(Boolean).join(' ')),
  }));
}
export const seqOf = (cno) => String(cno).split(/[\/-]/).pop();
export function sameSeq(a, b) {
  const x = String(a), y = String(b);
  if (x === y) return true;
  return /^\d+$/.test(x) && /^\d+$/.test(y) && x.replace(/^0+/, '') === y.replace(/^0+/, '') && x.length <= 5 && y.length <= 5;
}
/** Group keys in the order they are shown: the usual order first, then the rest A to Z, "Not graded" last. */
export function groupOrder(keys, kind, prof) {
  const base = prof ? (prof.primary ? [...ORDER.primary, 'Referred'] : [...prof.words, 'ABS', 'ABSENT']) : ORDER[kind] || [];
  const rank = (k) => (k === NOT_GRADED ? 1e6 : base.indexOf(k) >= 0 ? base.indexOf(k) : 1000);
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
export function filterCandidates(items, { cq = '', grade = '' } = {}) {
  const toks = tokens(cq);
  return items.filter((it) => (!grade || it.key === grade) && (!toks.length || matchAll(it.h, toks)));
}
export const groupCounts = (items) => items.reduce((m, it) => m.set(it.key, (m.get(it.key) || 0) + 1), new Map());

/** Only https addresses on necta.go.tz (or a subdomain) may become a link; anything else is shown as plain text. */
export function safeNectaUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && (x.hostname === 'necta.go.tz' || x.hostname.endsWith('.necta.go.tz')) ? x.href : '';
  } catch { return ''; }
}
/** The page a centre's figures were copied from: NECTA's own site, the Maktaba Tetea copy of it, or the Internet Archive's saved copy of a page NECTA no longer serves (https only, exact hosts). */
export function safeSourceUrl(u) {
  const n = safeNectaUrl(u);
  if (n) return n;
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && (x.hostname === 'maktaba.tetea.org' || x.hostname === 'web.archive.org') ? x.href : '';
  } catch { return ''; }
}
/** Back may be used to close a centre only when the entry before it was made by this same document (a reload loses that). */
export const backIsSafe = (state, doc) => !!(state && state.from === 'list' && state.doc === doc);
/** The part of the address the router cares about; a change of the hash alone is not a new route. */
export const routeKey = (loc) => loc.pathname + loc.search;

/** The address state. Only the keys this app owns are read or written; every other parameter is kept as it is. */
export function readRoute(search, kind) {
  const p = new URLSearchParams(search);
  const get = (k, max = 80) => (p.get(k) || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const centre = get('centre', 12);
  if (centre && CODE_RE.test(centre)) {
    const g = get('grade', 20);
    return { view: 'centre', centre: centre.toUpperCase(), cq: get('cq'), grade: g === 'none' ? NOT_GRADED : g, cno: get('cno', 16).replace(/[^\w\/ -]/g, ''), kind };
  }
  const letter = get('letter', 1).toUpperCase();
  return { view: 'exam', q: get('q'), code: get('code'), cand: get('cand'), letter: LETTERS.includes(letter) || letter === '#' ? letter : '', p: Math.max(1, parseInt(p.get('p'), 10) || 1) };
}
export function buildSearch(current, owned) {
  const p = new URLSearchParams(current);
  for (const k of OWNED) p.delete(k);
  for (const k of OWNED) {
    const v = owned[k];
    if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

/* ------------------------------------------------------ switching between results pages: the pure parts */

const RESULTS_POST = /^(.*)\/post\/educational\/results\/(necta-([a-z]{2,8})-results-(\d{4}))\/(?:index\.html)?$/;
const trimBase = (b) => String(b || '').replace(/\/+$/, '');

/** '/post/educational/results/necta-csee-results-2024/' -> { path, slug, cat, year }; any other address is null. `base` is the site's base path ('' on mayobebros.com). */
export function matchResultsPost(pathname, base = '') {
  const m = RESULTS_POST.exec(String(pathname == null ? '' : pathname));
  if (!m || m[1] !== trimBase(base)) return null;
  return { path: `${m[1]}/post/educational/results/${m[2]}/`, slug: m[2], cat: m[3], year: Number(m[4]) };
}

/**
 * Whether a click on a link is switched in place, and to where. `link`: { href, target?, download? }; `here`: { origin, pathname, base };
 * `ev` (optional, left out for hover and focus): { button, metaKey, ctrlKey, shiftKey, altKey, defaultPrevented }.
 * Only a plain left click on a link to ANOTHER results post of this same site qualifies: new tab, new window, download and the page's own
 * address are left to the browser. Returns { path, search, hash, slug, cat, year } or null.
 */
export function inPlaceTarget(link, here, ev) {
  if (ev && (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)) return null;
  if (!link || !link.href || link.download) return null;
  if (link.target && link.target !== '_self') return null;
  let u;
  try { u = new URL(String(link.href), here.origin + here.pathname); } catch { return null; }
  if (u.origin !== here.origin) return null;
  const to = matchResultsPost(u.pathname, here.base);
  if (!to) return null;
  const now = matchResultsPost(here.pathname, here.base);
  if (now && now.path === to.path) return null;
  return { ...to, search: u.search, hash: u.hash };
}

/**
 * The pages already fetched (kept as text; at most `max`, the least recently used leaves first) and the ones on their way. A page is fetched
 * once however many callers ask. `prefetch` (hover, focus) never has more than `maxPrefetch` fetches running and skips what is here already.
 */
export function createPageStore({ fetchText, max = 6, maxPrefetch = 2 }) {
  const done = new Map();
  const flying = new Map();
  let prefetching = 0;
  const keep = (path, text) => {
    done.delete(path);
    done.set(path, text);
    while (done.size > max) done.delete(done.keys().next().value);
  };
  function load(path) {
    if (done.has(path)) { const t = done.get(path); keep(path, t); return Promise.resolve(t); }
    if (flying.has(path)) return flying.get(path);
    const p = Promise.resolve().then(() => fetchText(path)).then((t) => { keep(path, t); return t; });
    flying.set(path, p);
    const forget = () => { if (flying.get(path) === p) flying.delete(path); };
    p.then(forget, forget);
    return p;
  }
  function prefetch(path) {
    if (done.has(path) || flying.has(path) || prefetching >= maxPrefetch) return false;
    prefetching++;
    const end = () => { prefetching--; };
    load(path).then(end, end);
    return true;
  }
  return { load, prefetch, has: (path) => done.has(path), size: () => done.size, running: () => flying.size, prefetching: () => prefetching };
}

/** Only the newest change may finish: begin() makes every earlier ticket stale, cancel() makes all of them stale. */
export function createRunner() {
  let n = 0;
  return {
    begin() { const id = ++n; return { id, current: () => id === n }; },
    cancel() { n++; },
  };
}

/** The tags the browser must not take from a fetched page into this one, and the attributes that could run script. */
export const UNSAFE_TAGS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'style', 'base', 'meta', 'noscript'];
export function unsafeAttr(name, value) {
  const n = String(name).toLowerCase();
  if (n.startsWith('on') || n === 'style' || n === 'srcdoc' || n === 'formaction') return true;
  if (['href', 'src', 'action', 'xlink:href', 'poster', 'data'].includes(n)) return /^[\s\u0000- ]*(javascript|vbscript|data):/i.test(String(value));
  return false;
}

/** Which <meta> tags follow the page: the description, robots, og:*, article:* and twitter:*. Everything else (viewport, theme colour ...) stays. */
export function metaKey(m) {
  const p = (m && m.property) || '';
  const n = (m && m.name) || '';
  if (/^(og|article):/.test(p)) return 'p:' + p;
  if (n === 'description' || n === 'robots' || /^twitter:/.test(n)) return 'n:' + n;
  return '';
}
/** What to do to the meta tags of the page on screen so that they match the next page: { set, add, remove } (keys from metaKey). */
export function planHeadSync(current, next) {
  const have = new Map();
  for (const m of current) { const k = metaKey(m); if (k && !have.has(k)) have.set(k, m); }
  const want = new Map();
  for (const m of next) { const k = metaKey(m); if (k && !want.has(k)) want.set(k, m); }
  const plan = { set: [], add: [], remove: [] };
  for (const [k, m] of want) {
    if (!have.has(k)) plan.add.push({ key: k, name: m.name || '', property: m.property || '', content: m.content });
    else if (have.get(k).content !== m.content) plan.set.push({ key: k, content: m.content });
  }
  for (const k of have.keys()) if (!want.has(k)) plan.remove.push(k);
  return plan;
}

const safeHttp = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };

/**
 * Reads a fetched results page (a parsed document, or anything with the same few DOM calls) into plain data, or says why it cannot be used.
 * The page must be one of our own app pages: main#main holds one div[data-rs] that is not a Worker page (no data-mode), its state is ready
 * or nodata, data-path is the address that was asked for, and the hero and title are there (the stage too, when it is ready).
 * Nothing here touches the page on screen; the caller imports the root node and applies the head.
 */
export function readResultsPage(doc, wantPath) {
  const fail = (reason) => ({ ok: false, reason });
  const root = doc.querySelector('main#main > [data-rs]');
  if (!root) return fail('no app');
  const d = root.dataset || {};
  if (d.mode) return fail('page from the results Worker');
  if (d.state !== 'ready' && d.state !== 'nodata') return fail('unknown state');
  if (!d.exam || !d.cat || !/^\d{4}$/.test(String(d.year || '')) || !d.kind) return fail('missing data attributes');
  if (d.path !== wantPath) return fail('another address');
  const titleEl = root.querySelector('[data-rs-title]');
  if (!root.querySelector('[data-rs-hero]') || !titleEl) return fail('no hero');
  if (d.state === 'ready' && !root.querySelector('[data-rs-stage]')) return fail('no stage');
  if (d.state === 'nodata' && !root.querySelector('.rs-statement')) return fail('no statement');
  const t = doc.querySelector('title');
  const title = t ? String(t.textContent || '').replace(/\s+/g, ' ').trim() : '';
  if (!title) return fail('no title');
  const canon = doc.querySelector('link[rel="canonical"]');
  const canonical = canon ? canon.getAttribute('href') || '' : '';
  const metas = [...doc.querySelectorAll('meta')].map((m) => ({ name: m.getAttribute('name') || '', property: m.getAttribute('property') || '', content: m.getAttribute('content') == null ? '' : m.getAttribute('content') }));
  const lang = doc.documentElement ? doc.documentElement.getAttribute('lang') || '' : '';
  const stat = d.state === 'ready' ? [root.querySelector('[data-rs-stats] dd'), root.querySelector('[data-rs-stats] dt')] : [];
  const lead = root.querySelector('[data-rs-lead]');
  const h1 = String(titleEl.textContent || '').replace(/\s+/g, ' ').trim();
  const said = stat[0] && stat[1] ? `${String(stat[0].textContent).trim()} ${String(stat[1].textContent).trim().toLowerCase()}.` : lead ? String(lead.textContent || '').replace(/\s+/g, ' ').trim() : '';
  return {
    ok: true,
    root,
    state: d.state,
    title,
    heading: h1,
    said,
    canonical: safeHttp(canonical) ? canonical : '',
    metas,
    ld: [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => String(s.textContent || '')),
    lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : '',
  };
}

/* -------------------------------------------------------------------------- DOM */

const SVGS = {
  search: '<path d="M11 19a8 8 0 1 1 5.3-14 8 8 0 0 1-5.3 14Zm10 2-4.3-4.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  external: '<path d="M14 4h6v6m0-6L10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  empty: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8.5 11h5"/>',
  warn: '<path d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.01"/>',
  // Lucide school icon (lucide.dev, ISC licence)
  school: '<path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M18 5v16"/><path d="m4 6 7.106-3.553a2 2 0 0 1 1.788 0L20 6"/><path d="m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11"/><path d="M6 5v16"/><circle cx="12" cy="9" r="2"/>',
};
const iconCache = {};
function icon(name, cls) {
  let proto = iconCache[name];
  if (!proto) {
    const t = document.createElement('template');
    t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + SVGS[name] + '</svg>';
    proto = iconCache[name] = t.content.firstChild;
  }
  const n = proto.cloneNode(true);
  n.setAttribute('class', 'rs-ico' + (cls ? ' ' + cls : ''));
  return n;
}

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function marked(text, toks) {
  const frag = document.createDocumentFragment();
  const ranges = highlightRanges(text, toks);
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) frag.append(text.slice(pos, s));
    frag.append(h('mark', null, text.slice(s, e)));
    pos = e;
  }
  if (pos < text.length || !ranges.length) frag.append(text.slice(pos));
  return frag;
}

const fmt = (n) => Number(n).toLocaleString('en');
const motion = () => (typeof window !== 'undefined' ? window.MBMotion : undefined);
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/* ---------------------------------------------------------------------- the app */

/* ---------------------------------------------------------------------- the "Other years" chips on phones */

/* On a phone the hero shows the nearest years only (two rows of four) and a button that opens the rest. Every year stays in the page's HTML as a plain link
   (search engines and no-JavaScript visitors see all of them; the button itself is made here, so without a script there is nothing to press).
   The chips that wait are marked .rs-year-extra and hidden by css/results.css only under 40rem while the state is "collapsed", so a wider screen always shows them all.
   Opening: the list grows to its full height while the new chips rise in one after another (height, opacity and transform only, Web Animations,
   no storage). Closing: the extra chips fade and the list folds up. With reduced motion the change is instant. If the button would end up below the
   screen, the page glides (MBMotion.glide) just far enough to keep it in view. A press while the change is running is ignored (it lasts about 0.6 s). */
const YEARS_SHOWN = 8;
const YEARS_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
let yearsUid = 0;

function setupYears(root) {
  const none = { destroy() {} };
  const nav = root.querySelector('.rs-hero [data-rs-years]');
  const ul = nav ? nav.querySelector('ul') : null;
  const items = ul ? [...ul.children] : [];
  if (!nav || !ul || items.length < YEARS_SHOWN + 4) return none; // fewer years than that: nothing to fold
  const extra = items.slice(YEARS_SHOWN);
  for (const li of extra) li.classList.add('rs-year-extra');
  if (!ul.id) ul.id = 'rs-years-list-' + (++yearsUid);
  const text = h('span', { class: 'rs-years-more-t' });
  const btn = h('button', { type: 'button', class: 'rs-years-more', 'aria-controls': ul.id }, text, icon('chevron', 'rs-years-more-ico'));
  nav.append(btn);
  let open = false;
  let busy = null; // { anims, timer } while a change is running
  const label = () => {
    text.textContent = open ? 'Show fewer years' : `Show ${extra.length} more years`;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const state = (o) => { nav.dataset.yearsState = o ? 'open' : 'collapsed'; };
  state(false);
  label();

  const finish = (next) => {
    if (!busy) return;
    window.clearTimeout(busy.timer);
    const anims = busy.anims;
    busy = null;
    state(next); // the end state first, then the animations are taken away: no frame between the two
    for (const a of anims) { try { a.cancel(); } catch (err) { /* already gone */ } }
    nav.classList.remove('is-moving');
  };

  const onClick = () => {
    if (busy) return;
    const next = !open;
    const m = motion();
    if (reduced() || typeof ul.animate !== 'function') { open = next; state(next); label(); return; }
    const h0 = ul.getBoundingClientRect().height;
    const b0 = btn.getBoundingClientRect();
    const anims = [];
    nav.classList.add('is-moving');
    if (next) {
      state(true);
      const h1 = ul.getBoundingClientRect().height;
      anims.push(ul.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 620, easing: YEARS_EASE }));
      extra.forEach((li, i) => anims.push(li.animate(
        [{ opacity: 0, transform: 'translateY(16px) scale(0.92)' }, { opacity: 1, transform: 'none' }],
        { duration: 520, delay: 90 + Math.min(i, 10) * 34, easing: YEARS_EASE, fill: 'backwards' })));
      const room = window.innerHeight - 16;
      const bottomAfter = b0.bottom + (h1 - h0);
      if (m && typeof m.glide === 'function' && bottomAfter > room) m.glide(Math.round((window.scrollY || window.pageYOffset || 0) + bottomAfter - room), {});
    } else {
      state(false);
      const hc = ul.getBoundingClientRect().height;
      state(true);
      anims.push(ul.animate([{ height: h0 + 'px' }, { height: hc + 'px' }], { duration: 460, easing: YEARS_EASE, fill: 'forwards' }));
      extra.forEach((li, i) => anims.push(li.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(0.96)' }],
        { duration: 200, delay: Math.min(extra.length - 1 - i, 10) * 14, easing: 'ease-in', fill: 'forwards' })));
    }
    open = next;
    label();
    const done = () => finish(next);
    busy = { anims, timer: window.setTimeout(done, 1400) };
    anims[0].finished.then(done, done);
  };
  btn.addEventListener('click', onClick);
  return {
    destroy() {
      if (busy) finish(open);
      btn.removeEventListener('click', onClick);
    },
  };
}

/* One id per document (not per app): history entries made by an earlier app in this same document (before the reader switched to another
   year in place) are still ours, so Back can close a centre. After a reload the id changes and Back is never used to close. */
const DOC = Math.random().toString(36).slice(2);

/**
 * Starts the app on `root` (div.rs[data-rs]) and returns { destroy }. destroy() removes every window listener the app added, aborts its
 * fetches, clears its timers and makes every async step that is still running give up, so a new app can be started on a new root.
 * opts.restoreY: scroll place to put back once the list is drawn (Back / Forward to a page that was left).
 */
function start(root, opts = {}) {
  const handle = { destroy() {} };
  const years = setupYears(root); // also on a page with no data: it lists the other years
  handle.destroy = years.destroy;
  if (root.dataset.state === 'nodata') return handle;
  let dead = false;
  let routeNo = 0;          // the route being shown; destroy() moves it on, so every step still waiting finds itself out of date
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timers = new Set();
  const undo = [];
  const later = (fn, ms) => {
    const id = window.setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms);
    timers.add(id);
    return id;
  };
  const unlater = (id) => { window.clearTimeout(id); timers.delete(id); };
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); undo.push(() => target.removeEventListener(type, fn, o)); };
  function destroy() {
    if (dead) return;
    dead = true;
    routeNo += 1;
    if (ac) ac.abort();
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    for (const off of undo.splice(0)) off();
    years.destroy();
  }
  handle.destroy = destroy;
  /* "Centre mode": a page the results Worker made (/results/<cat>/<code>/<year>/) holds the centre's performance (summary, subjects, facts) as plain HTML
     for search engines, and NO candidate list: candidate numbers and individual results are never in that HTML. Here the script fetches the
     centre file and swaps in the interactive view (search, division chips, phone cards, the candidate table). If the file cannot be read the
     page says so and offers a retry; the performance stays. The Worker owns the title, canonical and robots of these
     pages, so none of them is touched; the address keeps its path and only ?cq=&grade=&cno= are written. */
  const SSR = root.dataset.mode === 'centre';
  let liveMount = null; // the live copy of the centre view (centre mode only), made from the template
  if (SSR) {
    const tpl = root.querySelector('template[data-rs-tpl]');
    const st = root.querySelector('[data-rs-static]');
    if (!tpl || !st || !root.dataset.centre) return handle;
    liveMount = document.createElement('div');
    liveMount.setAttribute('data-rs-mount', '');
    liveMount.hidden = true;
    liveMount.append(tpl.content.cloneNode(true));
    st.after(liveMount);
  }
  const cfg = {
    exam: root.dataset.exam, cat: root.dataset.cat, year: Number(root.dataset.year), kind: root.dataset.kind === 'primary' ? 'primary' : 'secondary',
    base: (root.dataset.base || '/results-data').replace(/\/$/, ''),
  };
  const primary = cfg.kind === 'primary';
  const CAT = cfg.cat.toUpperCase();
  let P = profileOf(cfg.cat, null, cfg.kind, cfg.year); // refined with meta.json when a centre loads
  const unit = P.unit;
  const units = P.units;
  const $ = (sel, scope) => (scope || root).querySelector(sel);
  const $$ = (sel, scope) => [...(scope || root).querySelectorAll(sel)];

  // The centre view's own parts are looked up inside the live copy first. In centre mode the server's static block (removed once the live
  // view is up) carries elements with the same data-rs-summary / -overall / -source / -facts hooks, and it comes first in the page:
  // a lookup from the root would pick those, fill them, and the fill would vanish with them (the division summary and the overall
  // performance tables were missing for exactly that reason).
  const $c = (sel) => (liveMount || root).querySelector(sel);
  const R = {
    hero: $('[data-rs-hero]'), crumbs: $('[data-rs-crumbs]'), eyebrow: $('[data-rs-eyebrow]'), title: $('[data-rs-title]'), lead: $('[data-rs-lead]'),
    stats: $('[data-rs-stats]'), years: $('[data-rs-years]'),
    stage: $('[data-rs-stage]'), exam: $('[data-rs-exam]'), centre: $c('[data-rs-centre]'), live: $('[data-rs-live]'),
    tools: $('[data-rs-tools]'), az: $('[data-rs-az]'), status: $('[data-rs-status]'), cpanel: $('[data-rs-cpanel]'), list: $('[data-rs-list]'),
    form: $('[data-rs-form]'), tabs: $('[data-rs-tabs]'),
    cstate: $c('[data-rs-cstate]'), cbody: $c('[data-rs-cbody]'), result: $c('[data-rs-result]'), facts: $c('[data-rs-facts]'), summary: $c('[data-rs-summary]'),
    ctools: $c('[data-rs-ctools]'), cq: $c('[data-rs-cq]'), chips: $c('[data-rs-chips]'), legend: $c('[data-rs-legend]'), cstatus: $c('[data-rs-cstatus]'),
    cands: $c('[data-rs-cands]'), cempty: $c('[data-rs-cempty]'), overall: $c('[data-rs-overall]'), source: $c('[data-rs-source]'), back: $c('[data-rs-back]'),
  };
  const inputs = { q: $('[data-rs-in="q"]'), code: $('[data-rs-in="code"]'), cand: $('[data-rs-in="cand"]') };
  const verified = root.dataset.verified || '';
  const ver = root.dataset.v ? '?v=' + encodeURIComponent(root.dataset.v) : '';

  const tabEls = R.tabs ? $$('[data-rs-tab]', R.tabs) : [];
  const paneEls = R.tabs ? $$('[data-rs-pane]') : [];
  const S = { view: 'exam', tab: 'name', ex: { q: '', code: '', cand: '', letter: '', p: 1 }, ce: { code: '', cq: '', grade: '', cno: '' } };
  let rows = null;            // prepared index rows
  let result = [];            // centres after all filters
  let lastOpened = '';
  let busy = false;
  let lastRoute = routeKey(location);
  const original = { title: document.title, robots: null, robotsMeta: null, heroEyebrow: R.eyebrow.textContent, heroTitle: R.title.textContent, heroLead: R.lead.textContent, crumbs: R.crumbs ? [...R.crumbs.children].map((li) => li.cloneNode(true)) : [] };

  /* ---- loading ---- */
  const cache = new Map();
  function getFile(url, asText) {
    if (!cache.has(url)) {
      const p = fetch(url, ac ? { credentials: 'same-origin', signal: ac.signal } : { credentials: 'same-origin' }).then((r) => {
        if (!r.ok) { const e = new Error('status ' + r.status); e.status = r.status; throw e; }
        return asText ? r.text() : r.json();
      });
      p.catch(() => cache.delete(url));
      cache.set(url, p);
    }
    return cache.get(url);
  }
  const getJSON = (url) => getFile(url, false);
  let indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = Promise.all([getJSON(`${cfg.base}/${cfg.exam}/list.json${ver}`), import('./results-codec.js' + ver)]).then(([j, codec]) => { rows = prepRows(codec.decodeList(j, cfg.kind)); return rows; });
      indexPromise.catch(() => { indexPromise = null; });
    }
    return indexPromise;
  }
  const decoded = new Map();
  async function loadCentre(code) {
    const key = code.toLowerCase();
    if (decoded.has(key)) return decoded.get(key);
    // a centre needs only its own file and the small meta.json, never the list
    const [text, meta, codec] = await Promise.all([getFile(`${cfg.base}/${cfg.exam}/${key}.txt${ver}`, true), getJSON(`${cfg.base}/${cfg.exam}/meta.json${ver}`), import('./results-codec.js' + ver)]);
    const rec = codec.decodeCentre(text, meta, key.toUpperCase());
    P = profileOf(cfg.cat, meta, cfg.kind, cfg.year);
    // PSLE and SFNA: the PREM NO NECTA printed next to each candidate number (owner's decision, 2026-11-10; no names are ever copied).
    // They sit in their own <code>.pm file, switched on by "pm": 1 in meta.json, and are loaded by this page only, never on the Worker's
    // pages for search engines (SSR). If the file cannot be read, the table simply has no PREM column.
    if (meta.pm && !SSR) {
      try {
        const packed = (await getFile(`${cfg.base}/${cfg.exam}/${key}.pm${ver}`, true)).trim();
        if (packed) rec.premBy = (seq) => codec.unpackPrem(packed, seq);
      } catch { /* no PREM column */ }
    }
    decoded.set(key, rec);
    return rec;
  }

  /* ---- small pieces ---- */
  let liveTimer = 0;
  function announce(text, now) {
    unlater(liveTimer);
    const put = () => { R.live.textContent = ''; later(() => { R.live.textContent = text; }, 30); };
    if (now) put(); else liveTimer = later(put, 600);
  }
  function emptyState(ic, title, text, btnLabel, onClick, isError) {
    return h('div', { class: 'rs-empty' + (isError ? ' rs-empty--error' : ''), role: isError ? 'alert' : null },
      icon(ic), h('h3', null, title), h('p', null, text), btnLabel ? h('button', { type: 'button', class: 'rs-btn', onclick: onClick }, btnLabel) : null);
  }
  const stickyTop = (el) => (el && getComputedStyle(el).position === 'sticky' ? Math.round(el.getBoundingClientRect().height) : 0);
  function glideTo(el, extra) {
    const mb = motion();
    if (!el) return Promise.resolve();
    const gap = (mb ? mb.GAP : 16) + (extra || 0);
    // a page change may still be rising in (a transform on an ancestor): aim for where the element will rest
    let shift = 0;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== 'none') shift += new DOMMatrix(t).m42;
    }
    if (mb) return mb.glide(mb.topOf(el, gap) - Math.round(shift), { covered: true });
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - gap), behavior: 'instant' });
    return Promise.resolve();
  }
  const jump = (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  function focusQuiet(el) { if (el) { if (!el.hasAttribute('tabindex') && !/^(a|button|input)$/i.test(el.tagName)) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } }

  /* Keep the reader with the results. The search bar sticks to the screen, so a reader can be far below the top of the list when a search,
     a letter, a tab or a filter changes what it shows. A shorter list also makes the whole page shorter and the browser drops the reader
     at the footer (it never glided to the new results: the bug of 2026-11-10). followResults() runs the change and then glides
     (js/motion.js) to the top of the new results, just under the header and the bar. The jump to the shorter page and the first step of
     the glide happen in the same task, so nothing is painted in between. The glide goes on while the reader types, and focus never leaves
     the field. When the top of the results is already on screen, nothing moves. */
  function followResults(change, { top, bar }) {
    const mb = motion();
    const head = document.querySelector('.site-header');
    const under = (head ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 0) + stickyTop(bar);
    const needs = !!top && !top.hidden && top.getClientRects().length > 0 && top.getBoundingClientRect().top < under + 4;
    change();
    if (!needs) return;
    if (mb) mb.glide(mb.topOf(top, mb.GAP + stickyTop(bar)), { covered: true, keepOnKeys: true });
    else window.scrollTo({ top: Math.max(0, Math.round(top.getBoundingClientRect().top + window.scrollY - under - 16)), left: 0, behavior: 'instant' });
  }

  /* ---- address ---- */
  const hrefFor = (owned) => location.pathname + buildSearch(location.search, owned) + location.hash;
  const examOwned = () => examParams(S.ex, S.tab);
  const centreOwned = () => ({ ...(SSR ? {} : { centre: S.ce.code }), cq: S.ce.cq, grade: S.ce.grade === NOT_GRADED ? 'none' : S.ce.grade, cno: S.ce.cno });
  const stateNow = () => Object.assign({}, history.state, { rs: 1, doc: DOC });
  // Typing and filters write the address with replaceState. That must not count as a new page in Google Analytics (its tag counts every
  // replaceState), so MBMotion.replaceQuiet is used; without it the plain call is the fallback.
  function replaceUrl() {
    const url = hrefFor(S.view === 'centre' ? centreOwned() : examOwned());
    if (window.MBMotion && window.MBMotion.replaceQuiet) window.MBMotion.replaceQuiet(stateNow(), '', url); else history.replaceState(stateNow(), '', url);
    lastRoute = routeKey(location);
  }
  function pushUrl(owned, extra) {
    history.replaceState(Object.assign(stateNow(), { y: window.scrollY }), '', location.href);
    history.pushState(Object.assign({ rs: 1, doc: DOC }, extra), '', hrefFor(owned));
    lastRoute = routeKey(location);
  }
  const centreHref = (code, cno) => hrefFor({ centre: code, cno: cno || '' });

  /* ================================================================== EXAM VIEW */

  const filterNow = () => activeFilter(S.ex, S.tab);
  const anyFilter = () => { const f = filterNow(); return !!(f.q || f.code || f.cand || f.letter); };
  function readInputs() { for (const [k, el] of Object.entries(inputs)) S.ex[k] = el.value.replace(/\s+/g, ' ').trim(); }
  function syncInputs() { for (const [k, el] of Object.entries(inputs)) { if (el.value.replace(/\s+/g, ' ').trim() !== S.ex[k]) el.value = S.ex[k]; syncClear(el); } }
  function syncClear(el) { const b = el.closest('.rs-field') && el.closest('.rs-field').querySelector('.rs-clear'); if (b) b.dataset.visible = String(!!el.value); }

  function updateExam({ resetPage = true, writeUrl = true, announceIt = true, follow = false } = {}) {
    if (!rows) return;
    const run = () => {
      if (resetPage) S.ex.p = 1;
      const f = filterNow();
      const base = baseFilter(rows, f);
      result = f.letter ? base.filter((r) => r.L === f.letter) : base;
      // the A to Z bar always shows the school tab's own filter, so it is right (and the bar the right height) when that tab is opened
      const nameBase = S.tab === 'name' ? base : baseFilter(rows, activeFilter(S.ex, 'name'));
      renderAz(letterCounts(nameBase), nameBase.length);
      renderList();
      renderCpanel();
      if (sug) sug.update();
      if (writeUrl) replaceUrl();
      if (announceIt && anyFilter()) announce(result.length ? `${fmt(result.length)} ${result.length === 1 ? unit : units} found.` : `No ${units} found.`);
    };
    if (follow) followResults(run, { top: R.status, bar: R.tools }); else run();
  }

  /* A to Z */
  function renderAz(counts, total) {
    if (!R.az.dataset.ready) {
      const letters = ['', ...LETTERS, ...(rows.some((r) => r.L === '#') ? ['#'] : [])];
      R.az.replaceChildren(...letters.map((l) => h('button', { type: 'button', class: 'rs-az-btn' + (l ? '' : ' rs-az-all'), 'data-l': l, 'aria-pressed': 'false', tabindex: '-1' }, l || 'ALL')));
      R.az.dataset.ready = '1';
      R.az.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        S.ex.letter = b.dataset.l;
        updateExam({ follow: true });
      });
      R.az.addEventListener('keydown', (e) => {
        const btns = $$('button:not(:disabled)', R.az);
        const i = btns.indexOf(document.activeElement);
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 }[e.key];
        if (to === undefined || i < 0) return;
        e.preventDefault();
        const t = btns[Math.max(0, Math.min(btns.length - 1, to))];
        btns.forEach((b) => { b.tabIndex = -1; });
        t.tabIndex = 0;
        t.focus();
      });
    }
    let roving = null;
    R.az.removeAttribute('aria-busy');
    for (const b of $$('button', R.az)) {
      const l = b.dataset.l;
      const n = l ? counts[l] : total;
      b.disabled = !!l && n === 0 && S.ex.letter !== l;
      b.setAttribute('aria-pressed', String(l === S.ex.letter));
      b.setAttribute('aria-label', l ? `${cap(units)} starting with ${l === '#' ? 'a number' : l}: ${fmt(n)}` : `All ${units}: ${fmt(n)}`);
      b.tabIndex = -1;
      if (l === S.ex.letter) roving = b;
    }
    (roving || R.az.querySelector('button')).tabIndex = 0;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* the list */
  function rowEl(r, toks, codeT, keep) {
    const meta = [`${CAT} ${cfg.year}`, [r.region, r.district].filter(Boolean).join(' · '), r.has ? '' : 'No results on this site'].filter(Boolean).join(' · ');
    const body = [
      h('span', { class: 'rs-row-ico', 'aria-hidden': 'true' }, icon('school')),
      h('span', { class: 'rs-row-code rs-mono' }, marked(r.code, codeT)),
      h('span', { class: 'rs-row-name' }, marked(r.name, toks), h('small', null, meta)),
    ];
    if (!r.has) return h('li', null, h('div', { class: 'rs-row is-muted' }, ...body));
    // when the results Worker's pages exist (data-pages), a centre is a real page of its own: a plain link, no in-page view
    if (root.dataset.pages) return h('li', null, h('a', { class: 'rs-row', href: `${root.dataset.pages.replace(/\/$/, '')}/${cfg.cat}/${r.c}/${cfg.year}/` }, ...body, icon('arrow', 'rs-row-go')));
    const href = location.pathname + '?' + keep + (keep ? '&' : '') + 'centre=' + encodeURIComponent(r.code);
    return h('li', null, h('a', { class: 'rs-row', href, 'data-code': r.code }, ...body, icon('arrow', 'rs-row-go')));
  }

  function renderList({ keepFocus = false } = {}) {
    const total = result.length;
    const pages = pageCount(total);
    S.ex.p = clampPage(S.ex.p, pages);
    const start = (S.ex.p - 1) * PAGE;
    const slice = result.slice(start, start + PAGE);
    R.list.removeAttribute('aria-busy');
    R.status.replaceChildren();
    if (!total) {
      R.list.replaceChildren(emptyState('empty', `No ${units} match your search`,
        anyFilter() ? 'Try fewer words, check the number, or clear the filters. Search is partial and ignores capitals.' : `This examination has no ${units}.`,
        anyFilter() ? 'Clear all filters' : null, clearAll));
      R.status.append(h('span', null, h('strong', null, '0'), ` ${units} found`));
      return;
    }
    const toks = tokens(filterNow().q);
    const codeT = [normCode(filterNow().code)].filter(Boolean);
    const keepParams = new URLSearchParams(location.search);
    for (const k of OWNED) keepParams.delete(k);
    const keep = keepParams.toString();
    const half = Math.ceil(slice.length / 2);
    const cols = h('div', { class: 'rs-cols' });
    for (const part of [slice.slice(0, half), slice.slice(half)]) {
      if (!part.length) continue;
      cols.append(h('ul', { class: 'rs-rows', role: 'list' }, part.map((r) => rowEl(r, toks, codeT, keep))));
    }
    const frag = document.createDocumentFragment();
    frag.append(cols);
    if (pages > 1) frag.append(pagerEl(pages));
    R.list.replaceChildren(frag);
    R.status.append(
      h('span', null, 'Showing ', h('strong', null, `${fmt(start + 1)}–${fmt(start + slice.length)}`), ' of ', h('strong', null, fmt(total)), total === 1 ? ` ${unit}` : ` ${units}`, pages > 1 ? ` · Page ${S.ex.p} of ${pages}` : ''),
      ...(anyFilter() ? [h('button', { type: 'button', class: 'rs-btn rs-btn--ghost', onclick: clearAll }, 'Clear all')] : []));
    if (keepFocus) focusQuiet($('a.rs-row', R.list));
  }

  function pagerEl(pages) {
    const btn = (label, n, o = {}) => h('button', { type: 'button', class: 'rs-chip rs-page', 'aria-current': o.current ? 'page' : null, 'aria-label': o.aria || `Page ${n}`, disabled: o.disabled, onclick: () => goPage(n) }, label);
    const nav = h('nav', { class: 'rs-pager', 'aria-label': `Pages of ${units}` }, btn('Previous', S.ex.p - 1, { disabled: S.ex.p === 1, aria: 'Previous page' }));
    for (const n of pagerWindow(S.ex.p, pages)) {
      nav.append(n === 'gap' ? h('span', { class: 'rs-gap', 'aria-hidden': 'true' }, '…') : btn(String(n), n, { current: n === S.ex.p }));
    }
    nav.append(btn('Next', S.ex.p + 1, { disabled: S.ex.p === pages, aria: 'Next page' }));
    return nav;
  }

  async function goPage(n) {
    if (busy || n === S.ex.p) return;
    busy = true;
    const mb = motion();
    try {
      if (mb) await mb.leave(R.list);
      if (dead) return;
      S.ex.p = n;
      pushUrl(examOwned(), { from: 'list' });
      renderList();
      const rowsNow = $$('li', R.list).slice(0, 20);
      if (mb) mb.enter(rowsNow, R.list);
      announce(`Page ${S.ex.p} of ${pageCount(result.length)}.`, true);
      focusQuiet($('a.rs-row', R.list));
      await glideTo(R.status, stickyTop(R.tools));
    } finally { busy = false; }
  }

  function clearAll() {
    if (S.tab === 'cand') S.ex.cand = ''; else Object.assign(S.ex, { q: '', code: '', letter: '' });
    syncInputs();
    updateExam({ follow: true });
    focusQuiet(S.tab === 'cand' ? inputs.cand : inputs.q);
  }

  /* candidate number in the exam view: an explicit way in, no automatic jump */
  function renderCpanel() {
    const cn = S.tab === 'cand' ? parseCandidate(S.ex.cand) : null;
    R.cpanel.replaceChildren();
    R.cpanel.hidden = true;
    if (!cn || cn.seq === null) return;
    const r = rows.find((x) => x.c === cn.code.toLowerCase());
    const sep = primary ? '-' : '/';
    const full = cn.code + sep + cn.seq;
    if (!r) { R.cpanel.append(h('p', { class: 'rs-found rs-found--miss' }, `There is no ${unit} ${cn.code} in ${CAT} ${cfg.year}.`)); R.cpanel.hidden = false; return; }
    if (!r.has) { R.cpanel.append(h('p', { class: 'rs-found rs-found--miss' }, `Results for ${r.name} (${r.code}) are not on this site.`)); R.cpanel.hidden = false; return; }
    const href = centreHref(r.code, cn.seq);
    R.cpanel.append(h('div', { class: 'rs-found' },
      h('span', null, h('strong', { class: 'rs-mono' }, full), ' at ', r.name),
      h('a', { class: 'rs-btn', href, 'data-open': cn.seq, 'data-code': r.code }, 'Open result', icon('arrow'))));
    R.cpanel.hidden = false;
  }

  /* ================================================================== VIEW SWITCH, HERO, META */

  function setMeta(on, rec) {
    let m = document.querySelector('meta[name="robots"]');
    if (on) {
      if (!m) { m = h('meta', { name: 'robots', content: '' }); document.head.append(m); original.robotsMeta = m; }
      else if (original.robots === null) original.robots = m.getAttribute('content');
      m.setAttribute('content', 'noindex, follow');
      document.title = `${rec ? rec.code + ' ' + rec.name : S.ce.code}: ${CAT} ${cfg.year} results | Mayobe Bros`;
    } else {
      if (original.robotsMeta) { original.robotsMeta.remove(); original.robotsMeta = null; }
      else if (m && original.robots !== null) m.setAttribute('content', original.robots);
      original.robots = null;
      document.title = original.title;
    }
  }

  // the exam label is a pill made of the text itself, so it is only as wide as its words on every line (css: "Hero text on phones and tablets")
  function setEyebrow(text) {
    let t = R.eyebrow.querySelector('.rs-eyebrow-t');
    if (!t) { t = h('span', { class: 'rs-eyebrow-t' }); R.eyebrow.replaceChildren(t); }
    t.textContent = text;
  }

  function setHero(mode, rec) {
    if (mode === 'centre') {
      const row0 = rows && rows.find((r) => r.c === S.ce.code.toLowerCase());
      const name = rec ? rec.name : (row0 && row0.name) || '';
      setEyebrow(`${CAT} ${cfg.year} examination results`);
      // The centre number is its own span so that phones and tablets can show it as a small label above the name (css: "Hero text on phones and tablets"); the words in the heading stay exactly "CODE NAME" (or "NAME - CODE")
      const codeEl = h('span', { class: 'rs-h1-code' }, S.ce.code);
      const nameEl = name ? h('span', { class: 'rs-h1-name' }, name) : null;
      R.title.replaceChildren(...(primary
        ? [nameEl, nameEl ? ' ' : null, nameEl ? h('span', { class: 'rs-h1-sep', 'aria-hidden': 'true' }, '- ') : null, codeEl]
        : [codeEl, nameEl ? ' ' : null, nameEl]).filter((x) => x != null));
      const bits = [];
      if (rec) bits.push(`${fmt(rec.candidates.length)} ${rec.candidates.length === 1 ? 'candidate' : 'candidates'} listed`);
      if (row0 && row0.region) bits.push([row0.region, row0.district].filter(Boolean).join(', '));
      if (verified) bits.push(`last verified ${verified}`);
      // each fact is one piece that never breaks in the middle (a date used to split after "2026-"); the dots are hidden on phones, where the facts stack
      R.lead.replaceChildren(...bits.flatMap((b, i) => [i ? h('span', { class: 'rs-lead-dot', 'aria-hidden': 'true' }, ' · ') : null, h('span', { class: 'rs-lead-bit' }, b)]).filter((x) => x != null));
      R.stats.hidden = true;
      if (R.years) R.years.hidden = true;
      if (R.crumbs) {
        const items = original.crumbs.map((li) => li.cloneNode(true));
        const cur = items[items.length - 1];
        const year = cur.textContent.trim();
        cur.replaceChildren(h('a', { href: hrefFor({}), 'data-rs-close': '' }, year));
        items.push(h('li', null, h('span', { 'aria-current': 'page' }, S.ce.code)));
        R.crumbs.replaceChildren(...items);
      }
    } else {
      setEyebrow(original.heroEyebrow);
      R.title.textContent = original.heroTitle;
      R.lead.textContent = original.heroLead;
      R.stats.hidden = false;
      if (R.years) R.years.hidden = false;
      if (R.crumbs) R.crumbs.replaceChildren(...original.crumbs.map((li) => li.cloneNode(true)));
    }
  }

  /** Fade the old view out, run `change`, rise the new one in. */
  async function swap(no, animate, change, risers) {
    const mb = motion();
    if (animate && mb) await mb.leave(R.stage);
    if (no !== routeNo) return false; // another route took over while the fade ran: it settles the stage
    change();
    if (mb) mb.enter(animate ? [R.hero.querySelector('.rs-wrap')].concat(risers || []) : [], R.stage);
    return true;
  }
  /** Take the fade classes off the stage when a route needs no swap (or a swap was overtaken). */
  function settleStage() { const mb = motion(); if (mb) mb.enter([], R.stage); }

  /* ---- the two search tabs: school or centre (name, number, A to Z) and candidate number. Each keeps what was typed in it; only the
     active one filters the list and writes the address. Without tabs (Worker pages, no script) every field simply stays visible. ---- */
  function showTab(t, { rise = false } = {}) {
    S.tab = t;
    if (!R.tabs) return;
    R.tabs.dataset.tab = t;
    for (const b of tabEls) { const on = b.dataset.rsTab === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    for (const p of paneEls) {
      const on = p.dataset.rsPane === t;
      p.hidden = !on;
      p.classList.remove('is-in');
      if (on && rise) { void p.offsetWidth; p.classList.add('is-in'); later(() => p.classList.remove('is-in'), 400); }
    }
  }
  function adoptTab(route) { const a = adoptExam(S.ex, route); S.ex = a.ex; showTab(a.tab); }
  function pickTab(t, focus) {
    if (S.view !== 'exam' || t === S.tab) { if (focus) { const b = tabEls.find((x) => x.dataset.rsTab === t); if (b) b.focus(); } return; }
    readInputs();
    if (sug) sug.close();
    showTab(t, { rise: true });
    if (focus) { const b = tabEls.find((x) => x.dataset.rsTab === t); if (b) b.focus(); }
    S.ex.p = 1;
    updateExam({ resetPage: true, writeUrl: true, announceIt: false, follow: true });
  }
  if (R.tabs) {
    showTab(S.tab);
    listen(R.tabs, 'click', (e) => { const b = e.target.closest('[data-rs-tab]'); if (b) pickTab(b.dataset.rsTab, false); });
    listen(R.tabs, 'keydown', (e) => {
      const i = tabEls.indexOf(document.activeElement);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabEls.length - 1 }[e.key];
      if (to === undefined || i < 0) return;
      e.preventDefault();
      pickTab(tabEls[(to + tabEls.length) % tabEls.length].dataset.rsTab, true);
    });
    // the pill must not slide on the first paint (an address with ?cand= opens the second tab at once)
    later(() => R.tabs.classList.add('is-ready'), 60);
  }

  /* ================================================================== ROUTING */

  async function applyRoute({ animate = true, restoreY = null, focusRow = false } = {}) {
    if (dead) return;
    const no = ++routeNo;
    lastRoute = routeKey(location);
    const route = readRoute(location.search, cfg.kind);
    if (route.view === 'centre') { if (sug) sug.close(); return showCentre(route, no, animate); }
    // exam view
    adoptTab(route);
    const wasCentre = S.view === 'centre';
    if (!wasCentre) { setMeta(false); settleStage(); }
    if (wasCentre) {
      const done = await swap(no, animate, () => {
        S.view = 'exam';
        R.centre.hidden = true;
        R.exam.hidden = false;
        setMeta(false);
        setHero('exam');
      }, [R.exam]);
      if (!done) return;
    }
    syncInputs();
    try { await loadIndex(); } catch { if (no === routeNo) listError(); return; }
    if (no !== routeNo) return;
    updateExam({ resetPage: false, writeUrl: false, announceIt: false });
    if (restoreY !== null) jump(restoreY);
    if (wasCentre && focusRow && lastOpened) { const a = $(`a.rs-row[data-code="${lastOpened}"]`, R.list); if (a) focusQuiet(a); }
  }
  function listError() {
    R.list.removeAttribute('aria-busy');
    R.status.replaceChildren();
    R.list.replaceChildren(emptyState('warn', `Could not load the ${unit} list`, 'Check your connection, then try again.', 'Try again', () => { R.list.setAttribute('aria-busy', 'true'); applyRoute({ animate: false }); }, true));
  }

  /* ================================================================== CENTRE VIEW */

  let C = null; // the centre on screen: { rec, items, filtered, shown }

  function centreState(node) { R.cstate.replaceChildren(node); R.cstate.hidden = false; R.cbody.hidden = true; }

  async function showCentre(route, no, animate) {
    const prevView = S.view;
    S.ce = { code: route.centre, cq: route.cq, grade: route.grade, cno: route.cno };
    const codeLow = S.ce.code.toLowerCase();
    // the list is needed for the name and to know whether results exist
    const goingIn = prevView !== 'centre';
    const enterNow = () => {
      S.view = 'centre';
      R.exam.hidden = true;
      R.centre.hidden = false;
      C = null;
    };
    if (goingIn) {
      // wait for the index only when it is not here yet; the fade runs meanwhile
      const pre = rows ? null : loadIndex().catch(() => null);
      const done = await swap(no, animate, () => { enterNow(); setMeta(true); }, [R.centre]);
      if (!done) return;
      if (pre) await pre;
    } else { setMeta(true); settleStage(); }
    if (no !== routeNo) return;
    centreState(skeletonCentre());
    setHero('centre');
    try { await loadIndex(); } catch { if (no === routeNo) centreState(emptyState('warn', 'Could not load this page', 'Check your connection, then try again.', 'Try again', () => applyRoute({ animate: false }), true)); return; }
    if (no !== routeNo) return;
    setHero('centre');
    const row = rows.find((r) => r.c === codeLow);
    if (!row) { centreState(missing(`This ${unit} is not on this site`, `Check the ${unit} number, or go back to the list.`)); focusQuiet(R.title); return; }
    if (!row.has) { centreState(missing(`Results for this ${unit} are not on this site`, 'You can still find it in the list, and the official NECTA site has the full results.')); focusQuiet(R.title); return; }
    let rec;
    try { rec = await loadCentre(S.ce.code); }
    catch (err) {
      if (no !== routeNo) return;
      if (err && err.status === 404) centreState(missing(`This ${unit} is not on this site`, `Check the ${unit} number, or go back to the list.`));
      else centreState(emptyState('warn', 'Could not load this page', 'Check your connection, then try again.', 'Try again', () => applyRoute({ animate: false }), true));
      focusQuiet(R.title);
      return;
    }
    if (no !== routeNo) return;
    setMeta(true, rec);
    setHero('centre', rec);
    renderCentre(rec);
    R.cstate.hidden = true;
    R.cstate.replaceChildren();
    R.cbody.hidden = false;
    if (goingIn || animate) {
      if (S.ce.cno) { const card = $('.rs-result', R.result); if (card) { await glideTo(card); focusQuiet(card); } }
      else { await glideTo(R.hero); focusQuiet(R.title); }
    }
  }

  function missing(title, text) {
    return h('div', { class: 'rs-empty', role: 'status' }, icon('empty'), h('h3', null, title), h('p', null, text),
      h('a', { class: 'rs-btn', href: hrefFor(examOwned()), 'data-rs-close': '' }, icon('back'), `Back to all ${units}`));
  }
  function skeletonCentre() {
    return h('div', { class: 'rs-skel-block', 'aria-hidden': 'true' }, h('span', { class: 'rs-skel rs-skel--box' }), h('span', { class: 'rs-skel rs-skel--line' }), h('span', { class: 'rs-skel rs-skel--line rs-skel--short' }));
  }

  function renderCentre(rec) {
    const items = prepCandidates(rec.candidates, cfg.kind, P);
    let hasPrem = false;
    if (rec.premBy) for (const it of items) { const p = rec.premBy(it.seq); if (p) { it.prem = p; it.h += ` ${p}`; hasPrem = true; } }
    C = { rec, items, filtered: items, shown: CHUNK, hasPrem };
    const premNote = $('[data-rs-premnote]');
    if (premNote) premNote.hidden = !hasPrem;
    const sw = primary ? { lang: 'sw' } : {};
    // facts
    R.facts.replaceChildren(...(rec.facts || []).map(([k, v]) => h('div', { class: 'rs-kpi', ...sw }, h('span', null, k), h('strong', null, v))));
    R.facts.hidden = !(rec.facts || []).length;
    // summary
    R.summary.replaceChildren();
    if (rec.summary) {
      R.summary.append(tableWrap(h('table', { class: 'rs-table rs-summary-table', ...sw },
        h('caption', null, primary ? 'MADARAJA YA UFAULU WA UJUMLA' : P.roman ? 'DIVISION PERFORMANCE SUMMARY' : `${P.divName.toUpperCase()} SUMMARY`),
        h('thead', null, h('tr', null, rec.summary.head.map((x, i) => h('th', { scope: 'col', class: i ? 'rs-c' : null }, x)))),
        h('tbody', null, rec.summary.rows.map((r) => h('tr', null, r.map((x, i) => (i ? h('td', { class: 'rs-c' }, x) : h('th', { scope: 'row' }, x))))))), primary ? 'Summary of grades' : `${P.divName} summary`));
    }
    R.summary.hidden = !rec.summary;
    // overall
    renderOverall(rec);
    // source
    R.source.replaceChildren(
      h('span', null, `Values are shown as NECTA published them${primary ? (hasPrem ? '; pupils’ names are not copied' : '; pupils’ personal numbers are not copied') : ''}.`));
    // tools
    R.cq.value = S.ce.cq;
    syncClear(R.cq);
    const counts = groupCounts(items);
    if (S.ce.grade && !counts.has(S.ce.grade)) S.ce.grade = '';
    renderChips(counts);
    renderLegend(counts, items);
    R.cq.placeholder = `Candidate${hasPrem ? ' or PREM' : ''} number, e.g. ${items[0] ? items[0].c.cno : P.cno}`;
    renderResultCard();
    updateCentre({ resetShown: true, writeUrl: false });
  }

  function tableWrap(table, label) {
    return h('div', { class: 'rs-tablewrap', role: 'region', tabindex: '0', 'aria-label': label }, table);
  }

  function renderOverall(rec) {
    R.overall.replaceChildren();
    const sw = primary ? { lang: 'sw' } : {};
    let label = 'Overall performance';
    const num = (x) => /^[\d.,+-]+$/.test(x);
    for (let b of rec.overall || []) {
      if (b.t === 'h') { label = b.v; R.overall.append(h('h3', { class: 'rs-h-sm', ...sw }, b.v)); }
      else if (b.t === 'kv') {
        R.overall.append(tableWrap(h('table', { class: 'rs-table rs-kv', ...sw }, h('tbody', null, b.rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v))))), label));
      } else if (b.t === 'grid') {
        const numeric = b.head.map((_, i) => i > 0 && b.rows.every((r) => num(r[i] == null ? '' : r[i])));
        b = { head: b.head, rows: b.rows.map((r) => r.map((x) => (typeof x === 'string' ? subjectLabel(x) : x))) };
        R.overall.append(tableWrap(h('table', { class: 'rs-table', ...sw },
          h('thead', null, h('tr', null, b.head.map((x, i) => h('th', { scope: 'col', class: numeric[i] ? 'rs-c' : null }, x)))),
          h('tbody', null, b.rows.map((r) => h('tr', null, r.map((x, i) => h('td', { class: numeric[i] ? 'rs-c' : null }, x)))))), label));
      }
    }
    R.overall.hidden = !(rec.overall || []).length;
  }

  function renderChips(counts) {
    const keys = groupOrder(counts.keys(), cfg.kind, P);
    R.chips.replaceChildren();
    const lbl = $('#rs-lbl-grade');
    if (lbl) lbl.textContent = P.divName;
    const row = R.chips.closest('.rs-filter-row');
    if (keys.length < 2) { if (row) row.hidden = true; return; }
    if (row) row.hidden = false;
    const mk = (key, label, n) => h('button', { type: 'button', class: 'rs-chip', 'data-g': key, 'aria-pressed': String(key === S.ce.grade) }, label, h('span', { class: 'rs-count' }, fmt(n)));
    R.chips.append(mk('', 'All', C.items.length), ...keys.map((k) => mk(k, k === NOT_GRADED ? k : chipLabel(k, P), counts.get(k))));
  }

  function renderLegend(counts, items) {
    const lines = [];
    if (counts.has(NOT_GRADED)) lines.push([NOT_GRADED, 'NECTA printed a note instead of grades for these candidates. The note is shown in the table as published.']);
    for (const k of groupOrder(counts.keys(), cfg.kind, P)) {
      if (k === NOT_GRADED) continue;
      if (WORD_NOTES[k] && !(P.roman && /^(I|II|III|IV)$/.test(k)) && (P.roman || !/^[A-E]$/.test(k))) lines.push([k, WORD_NOTES[k]]);
      else if (/\*/.test(k)) lines.push([k, CODE_NOTE]);
    }
    if (primary && C.hasPrem) lines.push(['PREM NO', 'The pupil’s registration number, as NECTA printed it next to the candidate number.']);
    if (!primary && !P.noSubjects && items.some((it) => it.c.aggt === '-')) lines.push(['-', `A dash in the ${P.gpa ? 'GPA' : 'aggregate'} column means NECTA published no ${P.gpa ? 'GPA' : 'total'} for that candidate.`]);
    R.legend.replaceChildren();
    R.legend.hidden = !lines.length;
    if (!lines.length) return;
    R.legend.append(h('h3', { class: 'rs-legend-h' }, 'What the marks mean'), h('dl', null, lines.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))));
  }

  function updateCentre({ resetShown = true, writeUrl = true, announceIt = false, follow = false } = {}) {
    if (!C) return;
    const run = () => {
      if (resetShown) C.shown = CHUNK;
      C.filtered = filterCandidates(C.items, S.ce);
      renderCands();
      for (const b of $$('button', R.chips)) b.setAttribute('aria-pressed', String(b.dataset.g === S.ce.grade));
      syncClear(R.cq);
      if (writeUrl) replaceUrl();
      if (announceIt) announce(`${fmt(C.filtered.length)} of ${fmt(C.items.length)} candidates.`);
    };
    if (follow) followResults(run, { top: R.cstatus, bar: R.ctools }); else run();
  }

  function renderCands() {
    const toks = tokens(S.ce.cq);
    const n = C.filtered.length;
    const shown = Math.min(C.shown, n);
    R.cstatus.replaceChildren(h('span', null, h('strong', null, fmt(n)), ` of ${fmt(C.items.length)} candidates`, shown < n ? `, showing the first ${fmt(shown)}` : ''),
      ...(S.ce.cq || S.ce.grade ? [h('button', { type: 'button', class: 'rs-btn rs-btn--ghost', onclick: () => resetCentreFilters(true) }, 'Clear search')] : []));
    R.cempty.hidden = n > 0;
    R.cands.hidden = n === 0;
    if (!n) { R.cands.replaceChildren(); return; }
    const tbody = h('tbody', { role: 'rowgroup' });
    const table = h('table', { class: 'rs-table rs-cands', role: 'table' },
      h('caption', { class: 'rs-sr' }, `Candidate results for ${C.rec.code}`),
      candHead(), tbody);
    R.cands.replaceChildren(h('div', { class: 'rs-tablewrap rs-tablewrap--cands' }, table));
    C.tbody = tbody;
    C.toks = toks;
    appendRows(0, shown);
    moreButton();
  }

  function candHead() {
    // PSLE and SFNA with PREM numbers: NECTA's own order, CAND. NO, PREM NO, SEX, then the grades
    const prem = primary && C.hasPrem;
    const heads = primary ? (prem ? ['CAND. NO', 'PREM NO', 'SEX', P.divHead, 'SUBJECTS'] : ['CAND. NO', 'SEX', P.divHead, 'SUBJECTS']) : P.noSubjects ? ['CNO', 'SEX', P.divHead] : ['CNO', 'SEX', P.aggtHead, P.divHead, 'DETAILED SUBJECTS'];
    const centred = (i) => i === 1 || (!primary && (P.noSubjects ? i === 2 : i === 2 || i === 3)) || (primary && (i === 2 || (prem && i === 3)));
    return h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, heads.map((x, i) => h('th', { scope: 'col', role: 'columnheader', class: centred(i) ? 'rs-c' : null }, x))));
  }

  function candRow(it, toks) {
    const c = it.c;
    const cell = (cls, label, ...kids) => h('td', { class: cls, role: 'cell', 'data-l': label }, ...kids);
    const pill = it.key === NOT_GRADED
      ? h('span', { class: 'rs-div', 'data-k': 'none' }, h('span', { 'aria-hidden': 'true' }, '–'), h('span', { class: 'rs-sr' }, NOT_GRADED))
      : h('span', { class: 'rs-div', 'data-k': it.key }, it.key);
    const resultCell = P.noSubjects && c.note ? h('span', null, pill, ' ', h('span', { class: 'rs-note' }, c.note)) : pill;
    const subj = c.note ? h('span', { class: 'rs-note' }, c.note)
      : h('span', { class: 'rs-grades' }, (c.subjects || []).filter((s) => !(primary && /^av[ae]rage grade$/i.test(s[0]))).map(([n, g]) => h('span', { class: 'rs-g' }, h('i', null, subjectLabel(n)), h('b', null, g))));
    const tr = h('tr', { role: 'row', 'data-seq': it.seq });
    if (primary) {
      tr.append(cell('rs-c-cno rs-mono', null, marked(c.cno, toks)));
      if (C.hasPrem) { tr.classList.add('has-prem'); tr.append(cell('rs-c rs-c-prem rs-mono', 'PREM NO', it.prem ? marked(it.prem, toks) : '-')); }
      tr.append(cell('rs-c rs-c-sex', 'Sex', c.sex), cell('rs-c rs-c-div', 'Average grade', pill), cell('rs-c-subj', null, subj));
    }
    else if (P.noSubjects) tr.append(cell('rs-c-cno rs-mono', null, marked(c.cno, toks)), cell('rs-c rs-c-sex', 'Sex', c.sex), cell('rs-c rs-c-div', P.divShort, resultCell));
    else tr.append(cell('rs-c-cno rs-mono', null, marked(c.cno, toks)), cell('rs-c rs-c-sex', 'Sex', c.sex), cell('rs-c rs-c-aggt', P.aggtShort, c.aggt || '-'), cell('rs-c rs-c-div', P.divShort, pill), cell('rs-c-subj', null, subj));
    if (S.ce.cno && sameSeq(it.seq, seqOf(S.ce.cno))) tr.classList.add('is-target');
    // the way into the pop-up without a gesture (touch screens show this button; a double tap on a phone does the same)
    rowItem.set(tr, it);
    if (tr.firstElementChild) tr.firstElementChild.append(' ', h('button', { type: 'button', class: 'rs-view', 'aria-label': `Open the result of ${c.cno}`, onclick: (ev) => { ev.stopPropagation(); openSheet(it, tr); } }, icon('maximize')));
    return tr;
  }

  /* ---- the candidate pop-up -------------------------------------------------------------------------------------------------------
     A double tap on a candidate (phones only; the small button in the row does the same for everyone with a touch screen) opens a focused
     view of that one result as a bottom sheet: it slides up over a blurred, dimmed page. It closes with the X, the Close button, a tap on the
     dead zone around it, Escape, or a swipe down. Focus goes into the sheet and comes back to the row. All motion is CSS transitions on
     opacity and transform (css/results.css, .rs-sheet), switched off by prefers-reduced-motion. */
  const rowItem = new WeakMap();
  let sheet = null;
  const isPhone = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 600);
  function openSheet(it, from) {
    if (sheet || !it || dead) return;
    const c = it.c;
    const el = document.createElement('div');
    const closeBtn = h('button', { type: 'button', class: 'rs-sheet-x', 'aria-label': 'Close', onclick: () => closeSheet() }, icon('x'));
    const badge = it.key === NOT_GRADED ? '–' : it.key;
    const facts = [];
    if (it.prem) facts.push(['PREM NO', h('span', { class: 'rs-mono' }, it.prem)]);
    facts.push(['Sex', c.sex || '–']);
    if (!primary && !P.noSubjects) facts.push([P.aggtName, c.aggt || '-']);
    const subjects = c.note ? [] : (c.subjects || []).filter((s) => !(primary && /^av[ae]rage grade$/i.test(s[0])));
    const panel = h('div', { class: 'rs-sheet-panel' },
      h('div', { class: 'rs-sheet-drag' },
        h('span', { class: 'rs-sheet-grab', 'aria-hidden': 'true' }),
        h('div', { class: 'rs-sheet-head' },
          h('div', null,
            h('p', { class: 'rs-sheet-eyebrow' }, 'Candidate result'),
            h('h2', { class: 'rs-sheet-title rs-mono', id: 'rs-sheet-t' }, c.cno),
            h('p', { class: 'rs-sheet-where' }, `${R.title.textContent} · ${CAT} ${cfg.year}`)),
          closeBtn)),
      h('div', { class: 'rs-sheet-body' },
        h('div', { class: 'rs-sheet-hero', 'data-k': it.key === NOT_GRADED ? 'none' : '' },
          h('span', { class: 'rs-sheet-badge', 'aria-hidden': 'true' }, badge),
          h('div', null, h('p', { class: 'rs-sheet-label' }, 'Overall result'), h('p', { class: 'rs-sheet-big' }, it.key === NOT_GRADED ? NOT_GRADED : /^([IV]+|0|[A-E])$/.test(it.key) ? `${P.divName} ${it.key}` : it.key), h('p', { class: 'rs-sheet-sub' }, 'As NECTA published it'))),
        h('dl', { class: 'rs-sheet-facts' }, facts.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
        c.note ? h('p', { class: 'rs-sheet-note' }, c.note) : null,
        subjects.length ? h('ul', { class: 'rs-sheet-subj' }, subjects.map(([n, g], i) => { const li = h('li', null, h('span', null, subjectLabel(n)), h('b', null, g)); li.style.setProperty('--i', String(i)); return li; })) : null), // CSSOM, not a style attribute: the page's policy does not allow inline style attributes : null),
      h('div', { class: 'rs-sheet-foot' },
        h('button', { type: 'button', class: 'rs-btn rs-sheet-close', onclick: () => closeSheet() }, 'Close'),
        h('p', null, 'Tap outside or swipe down to close')));
    const back = h('div', { class: 'rs-sheet-back', 'aria-hidden': 'true' });
    el.className = 'rs-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'rs-sheet-t');
    if (primary) el.setAttribute('lang', 'en');
    el.append(back, panel);
    root.append(el);
    document.body.classList.add('no-scroll');
    sheet = { el, panel, back, from, closeBtn, timer: 0 };
    // the dead zone: a tap that starts and ends on the dimmed page outside the sheet closes it
    let downOnBack = false;
    back.addEventListener('pointerdown', () => { downOnBack = true; });
    back.addEventListener('pointerup', () => { if (downOnBack) closeSheet(); downOnBack = false; });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      const f = [...panel.querySelectorAll('button')].filter((b) => !b.disabled);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    });
    wireSheetDrag(sheet);
    void el.offsetWidth; // the closed state is painted first, so the open state can transition from it
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => { if (sheet && sheet.el === el) el.classList.add('is-open'); }));
    window.setTimeout(() => { if (sheet && sheet.el === el) closeBtn.focus({ preventScroll: true }); }, 60);
    announce(`Result of ${c.cno}.`, true);
  }
  function closeSheet(instant) {
    const s = sheet;
    if (!s) return;
    sheet = null;
    window.clearTimeout(s.timer);
    document.body.classList.remove('no-scroll');
    const done = () => { s.el.remove(); if (s.from && s.from.isConnected && !instant) focusQuiet(s.from); };
    if (instant || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    s.el.classList.remove('is-open');
    s.el.classList.add('is-out');
    s.panel.style.transform = '';
    s.timer = window.setTimeout(done, 300);
  }
  /* swipe down from the handle or the heading to close: the sheet follows the finger, and either leaves or springs back */
  function wireSheetDrag(s) {
    const zone = s.panel.querySelector('.rs-sheet-drag');
    let y0 = 0, t0 = 0, dy = 0, id = null;
    zone.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      id = e.pointerId; y0 = e.clientY; t0 = e.timeStamp; dy = 0;
      zone.setPointerCapture(id);
      s.panel.style.transition = 'none';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - y0);
      s.panel.style.transform = `translateY(${dy}px)`;
      s.back.style.opacity = String(Math.max(0.15, 1 - dy / 420));
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      s.panel.style.transition = '';
      s.back.style.opacity = '';
      const fast = dy / Math.max(1, e.timeStamp - t0) > 0.6;
      if (dy > 110 || (fast && dy > 30)) closeSheet(); else s.panel.style.transform = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
  undo.push(() => closeSheet(true));
  // the double tap (phones): two quick taps on the same candidate, close together
  let lastTap = { tr: null, t: 0, x: 0, y: 0 };
  listen(R.cands, 'pointerup', (e) => {
    if (e.pointerType !== 'touch' || !isPhone() || sheet || e.target.closest('button, a')) return;
    const tr = e.target.closest('tr[data-seq]');
    if (!tr || !rowItem.has(tr)) return;
    if (lastTap.tr === tr && e.timeStamp - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = { tr: null, t: 0, x: 0, y: 0 };
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges(); // a double tap also selects a word: leave nothing highlighted behind the sheet
      openSheet(rowItem.get(tr), tr);
      return;
    }
    lastTap = { tr, t: e.timeStamp, x: e.clientX, y: e.clientY };
  });

  function appendRows(from, to) {
    const frag = document.createDocumentFragment();
    const made = [];
    for (let i = from; i < to; i++) { const tr = candRow(C.filtered[i], C.toks); made.push(tr); frag.append(tr); }
    C.tbody.append(frag);
    return made;
  }

  function moreButton() {
    const old = $('.rs-more', R.cands);
    if (old) old.remove();
    const left = C.filtered.length - Math.min(C.shown, C.filtered.length);
    if (left <= 0) return;
    R.cands.append(h('div', { class: 'rs-more' }, h('button', { type: 'button', class: 'rs-btn rs-btn--ghost', onclick: showMore }, `Show ${fmt(Math.min(CHUNK, left))} more`, h('span', { class: 'rs-more-left' }, ` (${fmt(left)} left)`))));
  }
  function showMore() {
    const from = Math.min(C.shown, C.filtered.length);
    C.shown = from + CHUNK;
    const to = Math.min(C.shown, C.filtered.length);
    const made = appendRows(from, to);
    const mb = motion();
    if (mb) mb.enter(made.slice(0, 12));
    moreButton();
    announce(`Showing ${fmt(to)} of ${fmt(C.filtered.length)} candidates.`, true);
    const first = made[0];
    if (first) { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
  }

  function resetCentreFilters(focusField) {
    S.ce.cq = '';
    S.ce.grade = '';
    R.cq.value = '';
    updateCentre({ follow: true });
    if (focusField) focusQuiet(R.cq);
  }

  /* the "Your result" card */
  function renderResultCard() {
    R.result.replaceChildren();
    if (!S.ce.cno) return;
    const seq = seqOf(S.ce.cno);
    const it = C.items.find((x) => sameSeq(x.seq, seq));
    if (!it) {
      R.result.append(h('p', { class: 'rs-found rs-found--miss', role: 'status' }, h('strong', { class: 'rs-mono' }, S.ce.cno), ' was not found in this ' + unit + '. Check the number, or search the list below.'));
      return;
    }
    const c = it.c;
    const dl = h('dl', null,
      it.prem ? h('div', null, h('dt', null, 'PREM NO'), h('dd', { class: 'rs-mono' }, it.prem)) : null,
      h('div', null, h('dt', null, 'Sex'), h('dd', null, c.sex || '–')),
      primary || P.noSubjects ? null : h('div', null, h('dt', null, P.aggtName), h('dd', null, c.aggt || '-')),
      h('div', null, h('dt', null, P.divName), h('dd', null, it.key)));
    const list = P.noSubjects && !c.note ? null : c.note ? h('p', { class: 'rs-note-text' }, c.note)
      : h('ul', { class: 'rs-subj-list' }, (c.subjects || []).map(([n, g]) => h('li', null, h('span', null, subjectLabel(n)), h('b', null, g))));
    R.result.append(h('section', { class: 'rs-result', 'aria-label': 'Your result', tabindex: '-1' },
      h('span', { class: 'rs-eyebrow' }, 'Your result'), h('h2', { class: 'rs-mono' }, c.cno), h('p', { class: 'rs-result-where' }, `${R.title.textContent} \u00b7 ${CAT} ${cfg.year}`), dl, list,
      h('button', { type: 'button', class: 'rs-btn rs-btn--ghost', onclick: showInList }, 'Show in full list')));
  }
  function showInList() {
    if (S.ce.cq || S.ce.grade) resetCentreFilters(false);
    const seq = seqOf(S.ce.cno);
    const idx = C.filtered.findIndex((x) => sameSeq(x.seq, seq));
    if (idx < 0) return;
    if (idx >= C.shown) { C.shown = Math.ceil((idx + 1) / CHUNK) * CHUNK; updateCentre({ resetShown: false, writeUrl: false }); }
    const tr = $('tr.is-target', R.cands);
    if (tr) { glideTo(tr, stickyTop(R.ctools)).then(() => focusQuiet(tr)); }
  }

  /* ================================================================== WIRING */

  function wireField(el, onChange, onEnter) {
    const field = el.closest('.rs-field');
    const clear = field && field.querySelector('.rs-clear');
    el.addEventListener('input', onChange);
    if (clear) clear.addEventListener('click', () => { el.value = ''; onChange(true); el.focus(); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.value && !(sug && sug.isOpen())) { e.preventDefault(); el.value = ''; onChange(true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (onEnter) onEnter(); }
    });
  }
  const debounce = (fn, ms) => { let t = 0; const d = (...a) => { unlater(t); t = later(() => fn(...a), ms); }; d.now = (...a) => { unlater(t); fn(...a); }; return d; };

  /* Live suggestions under the school and centre-number fields on phones and tablets (js/results-suggest.js, loaded only on a narrow screen):
     the best matches appear right under the field being typed in. While they show, the page stays with the field instead of gliding down
     to the list below. */
  let sug = null;
  const sugOn = () => !!sug && sug.active();
  function loadSuggest() {
    if (SSR || sug || dead || loadSuggest.asked) return;
    loadSuggest.asked = true;
    import('./results-suggest.js' + ver).then((m) => {
      if (dead) return;
      sug = m.createSuggest({
        fields: [{ key: 'name', el: inputs.q }, { key: 'code', el: inputs.code }].filter((f) => f.el),
        state: () => {
          const f = filterNow();
          return { ready: !!rows && S.view === 'exam' && S.tab === 'name', result, toks: tokens(f.q), codeQ: normCode(f.code) };
        },
        pick: (r) => {
          if (root.dataset.pages) { // the centre has a page of its own: a normal link
            const a = h('a', { href: `${root.dataset.pages.replace(/\/$/, '')}/${cfg.cat}/${r.c}/${cfg.year}/`, hidden: true });
            root.append(a);
            try { a.click(); } finally { a.remove(); }
          } else openCentre(r.code);
        },
        all: () => { glideTo(R.status, stickyTop(R.tools)); },
        h, icon, marked, fmt, unit, units, listen, later,
      });
      undo.push(() => sug && sug.destroy());
      sug.update();
    }).catch(() => { /* no suggestions: the list below still works */ });
  }
  if (!SSR && window.matchMedia) {
    const narrow = window.matchMedia('(max-width: 899.98px)');
    if (narrow.matches) loadSuggest();
    else if (narrow.addEventListener) listen(narrow, 'change', () => { if (narrow.matches) loadSuggest(); });
  }

  const runExam = SSR ? null : debounce(() => { readInputs(); for (const el of Object.values(inputs)) syncClear(el); updateExam({ follow: !sugOn() }); }, 110);
  if (!SSR) for (const el of Object.values(inputs)) wireField(el, (immediate) => { for (const e2 of Object.values(inputs)) syncClear(e2); if (immediate === true) runExam.now(); else runExam(); }, () => {
    if (el === inputs.cand) runExam.now(); // a paste or an edit followed at once by Enter: settle the search first
    const a = $('a[data-open]', R.cpanel);
    if (a && el === inputs.cand) openCentre(a.dataset.code, a.dataset.open);
  });
  if (R.form) R.form.addEventListener('submit', (e) => e.preventDefault());

  const runCentre = debounce(() => { S.ce.cq = R.cq.value.replace(/\s+/g, ' ').trim(); updateCentre({ announceIt: true, follow: true }); }, 90);
  wireField(R.cq, (immediate) => { syncClear(R.cq); if (immediate === true) runCentre.now(); else runCentre(); }, null);
  R.chips.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.ce.grade = b.dataset.g;
    updateCentre({ announceIt: true, follow: true });
  });
  const resetBtn = $('[data-rs-creset]');
  if (resetBtn) resetBtn.addEventListener('click', () => resetCentreFilters(true));

  if (SSR) { bootCentre(); return handle; }

  /* centre mode: swap the server-rendered figures (summary, subjects) for the interactive view, which adds the candidate list */
  async function bootCentre() {
    const code = root.dataset.centre;
    const route = readRoute('?centre=' + encodeURIComponent(code) + '&' + location.search.slice(1), cfg.kind);
    if (route.view !== 'centre') return;
    S.view = 'centre';
    S.ce = { code: route.centre, cq: route.cq, grade: route.grade, cno: route.cno };
    const note = $('[data-rs-cands-note]');
    if (note) note.hidden = false; // the page ships it hidden: readers without script get the noscript text instead of a "Loading" that never ends
    let rec;
    // The page holds no candidate list (candidate numbers are not meant for search engines): it arrives here. If it cannot, say so and offer a retry.
    try { rec = await loadCentre(code); } catch {
      if (note && !root.dataset.live) {
        note.textContent = `The ${primary ? 'pupils’' : 'candidates’'} list is not available right now. `;
        const again = h('button', { type: 'button', class: 'rs-btn rs-btn--ghost', 'data-rs-retry': '' }, 'Try again');
        again.addEventListener('click', () => { again.remove(); note.textContent = `Loading the ${primary ? 'pupils' : 'candidates'}…`; bootCentre(); });
        note.append(again);
      }
      return;
    }
    const st = $('[data-rs-static]');
    const mount = liveMount;
    if (!st || !mount) return;
    // keep the row that is at the top of the screen where it is
    let anchor = null, top = 0;
    const box = st.getBoundingClientRect();
    if (box.top < 0 && box.bottom > 0) {
      for (const tr of $$('tr[data-seq]', st)) { const r = tr.getBoundingClientRect(); if (r.bottom > 0) { anchor = tr.dataset.seq; top = r.top; break; } }
    }
    const hadFocus = st.contains(document.activeElement);
    renderCentre(rec);
    R.cstate.hidden = true;
    R.cstate.replaceChildren();
    R.cbody.hidden = false;
    R.centre.hidden = false;
    mount.hidden = false;
    st.remove();
    root.dataset.live = '1';
    if (anchor !== null) {
      const tr = $$('tr[data-seq]', R.cands).find((x) => x.dataset.seq === anchor);
      if (tr) window.scrollTo({ top: Math.max(0, window.scrollY + tr.getBoundingClientRect().top - top), left: 0, behavior: 'instant' });
    }
    if (hadFocus) focusQuiet(R.cands.querySelector('tr') || R.centre);
  }

  // opening and closing a centre
  function openCentre(code, cno) {
    lastOpened = code;
    pushUrl({ centre: code, cno: cno || '' }, { from: 'list' });
    applyRoute({ animate: true });
  }
  function closeCentre() {
    if (backIsSafe(history.state, DOC)) { history.back(); return; }
    // the entry before this one was not made by this page (a reload, a shared link): go to the list ourselves
    history.pushState({ rs: 1, doc: DOC }, '', hrefFor(examOwned()));
    lastRoute = routeKey(location);
    applyRoute({ animate: true, restoreY: null, focusRow: true }).then(() => { if (S.view === 'exam') glideTo(R.status, stickyTop(R.tools)); });
  }
  listen(root, 'click', (e) => {
    if (!plainClick(e)) return;
    const close = e.target.closest('[data-rs-close]');
    if (close) { e.preventDefault(); closeCentre(); return; }
    const a = e.target.closest('a[data-code]');
    if (a && root.contains(a)) { e.preventDefault(); openCentre(a.dataset.code, a.dataset.open || ''); }
  });
  listen(R.back, 'click', (e) => { if (plainClick(e)) { e.preventDefault(); closeCentre(); } });
  // a Back or Forward to another results page is the switcher's business (see createSwitcher); this app only follows its own address
  const PAGE_PATH = location.pathname;
  listen(window, 'popstate', (e) => {
    if (location.pathname !== PAGE_PATH) return;
    if (routeKey(location) === lastRoute) return; // the skip link or a hash change: not a new route
    const y = e.state && typeof e.state.y === 'number' ? e.state.y : null;
    applyRoute({ animate: true, restoreY: y, focusRow: true });
  });

  // first paint: the address says which view
  readInputsFromUrl();
  function readInputsFromUrl() {
    const route = readRoute(location.search, cfg.kind);
    if (route.view === 'exam') { adoptTab(route); syncInputs(); }
  }
  applyRoute({ animate: false, restoreY: typeof opts.restoreY === 'number' ? opts.restoreY : null }).then(() => {
    // anything typed while the list was loading
    if (!dead && S.view === 'exam' && rows) { const before = JSON.stringify(S.ex); readInputs(); if (JSON.stringify(S.ex) !== before) updateExam({ resetPage: true, writeUrl: true, announceIt: false }); }
  });
  return handle;
}

/* ======================================================= switching between results pages: the part that touches the page */

const FETCH_MS = 12000;

/** Takes the unsafe tags and attributes out of a node that came from a fetched page (a copy that is not in the document yet). */
function cleanTree(el) {
  for (const n of el.querySelectorAll(UNSAFE_TAGS.join(','))) n.remove();
  for (const n of [el, ...el.querySelectorAll('*')]) {
    for (const at of [...n.attributes]) if (unsafeAttr(at.name, at.value)) n.removeAttribute(at.name);
  }
}

/**
 * A click on another year or exam (a link to a sibling results post inside the app) changes only the app, not the page:
 *   1. the target is fetched (a hover or focus on the link fetched it already, when that was quick enough);
 *   2. what is on screen stays, dimmed if the fetch is slow, until the page is here and checked (readResultsPage);
 *   3. it fades out (MBMotion.leave), the old app is destroyed, the new .rs element takes its place, the head (title, canonical, description,
 *      robots, og:*, twitter:*, JSON-LD, lang) and the address follow, a new app starts on it, and the hero and the app rise in;
 *   4. the page glides to the top of the hero (MBMotion.glide), focus goes to the new heading when it was in the old app, one sentence is announced.
 * Back and Forward do the same without a new history entry and put the scroll place back. Anything that goes wrong (no network, a bad answer,
 * a page that is not one of ours, an error while starting) is a normal page load of the address, so nothing is ever stuck. A second click
 * ends the first one; a click on the address already being fetched is ignored. The Worker's centre pages (data-mode) keep normal links.
 */
function createSwitcher(first) {
  const doc = document;
  const html = doc.documentElement;
  const main = first.parentElement;
  const base = trimBase(html.getAttribute('data-base'));
  const mb = () => window.MBMotion;
  let root = first;
  let app = start(root);
  const nowPath = () => { const m = matchResultsPost(location.pathname, base); return m ? m.path : location.pathname; };
  let shown = nowPath();        // the address of the app on screen (during Back / Forward the address bar is already the new one)
  const runner = createRunner();
  let waitingFor = '';          // the address being fetched for a click
  let bypass = false;           // true while a plain navigation is started from here, so this script does not meet its own click
  const lastY = new Map();      // where each page was left

  const fetchText = async (path) => {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), FETCH_MS);
    try {
      const r = await fetch(path, { credentials: 'same-origin', signal: ctl.signal, headers: { Accept: 'text/html' } });
      if (!r.ok) throw new Error('bad status ' + r.status);
      const end = new URL(r.url || path, location.href);
      if (end.origin !== location.origin || !matchResultsPost(end.pathname, base)) throw new Error('left the site');
      if (!/html/i.test(r.headers.get('content-type') || '')) throw new Error('not a page');
      return await r.text();
    } finally { window.clearTimeout(t); }
  };
  const store = createPageStore({ fetchText });

  const live = doc.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  main.append(live);
  let sayTimer = 0;
  function say(text) {
    window.clearTimeout(sayTimer);
    live.textContent = '';
    sayTimer = window.setTimeout(() => { live.textContent = text; }, 30);
  }

  // the two blocks that fade out and rise in: the words of the hero, and the app (or the "not on this site" panel)
  const boxesOf = (r) => [r.querySelector(':scope > [data-rs-hero]'), r.querySelector(':scope > .rs-stage, :scope > .rs-statement')].filter(Boolean);
  const here = () => ({ origin: location.origin, pathname: shown, base });

  function clearPending() {
    for (const a of root.querySelectorAll('.is-pending')) a.classList.remove('is-pending');
    root.removeAttribute('aria-busy');
  }
  /** Puts the page on screen back as it was: nothing is left dimmed, faded or marked. */
  function settle() {
    waitingFor = '';
    clearPending();
    const m = mb();
    if (m) for (const b of boxesOf(root)) m.enter([], b);
    html.classList.remove('is-paging');
  }

  function plainNavigation(href, push) {
    if (!push) { location.reload(); return; }
    bypass = true;
    const a = doc.createElement('a');
    a.href = href;
    a.hidden = true;
    doc.body.append(a);
    try { a.click(); } finally { bypass = false; a.remove(); }
  }

  function applyHead(page) {
    doc.title = page.title;
    if (page.lang && html.getAttribute('lang') !== page.lang) html.setAttribute('lang', page.lang);
    const canon = doc.head.querySelector('link[rel="canonical"]');
    if (canon && page.canonical) canon.setAttribute('href', page.canonical);
    const have = [...doc.head.querySelectorAll('meta')];
    const read = (el) => ({ name: el.getAttribute('name') || '', property: el.getAttribute('property') || '', content: el.getAttribute('content') == null ? '' : el.getAttribute('content') });
    const plan = planHeadSync(have.map(read), page.metas);
    const byKey = new Map();
    for (const el of have) { const k = metaKey(read(el)); if (k && !byKey.has(k)) byKey.set(k, el); }
    for (const x of plan.set) byKey.get(x.key).setAttribute('content', x.content);
    for (const k of plan.remove) byKey.get(k).remove();
    for (const x of plan.add) {
      const el = doc.createElement('meta');
      el.setAttribute(x.property ? 'property' : 'name', x.property || x.name);
      el.setAttribute('content', x.content);
      doc.head.append(el);
    }
    const ld = [...doc.head.querySelectorAll('script[type="application/ld+json"]')];
    if (ld.length === page.ld.length) {
      ld.forEach((el, i) => { try { JSON.parse(page.ld[i]); el.textContent = page.ld[i]; } catch { /* the old data stays */ } });
    }
  }

  /** The synchronous part: from here on the new page is on screen. Returns the scroll's promise. */
  function swapIn(page, to, href, push, restoreY) {
    const m = mb();
    const old = root;
    const heldFocus = old.contains(doc.activeElement);
    const fresh = doc.importNode(page.root, true); // a copy made in this document, from the parsed page of this same site
    cleanTree(fresh);
    lastY.set(shown, window.scrollY);
    if (push) {
      history.replaceState(Object.assign({}, history.state, { y: window.scrollY }), '', location.href);
      history.pushState({ rsNav: 1 }, '', href);
    }
    if (m) m.glide(window.scrollY); // ends a glide the old app still has running, so it cannot carry on over the new page
    app.destroy();
    applyHead(page);
    old.replaceWith(fresh);
    root = fresh;
    shown = to.path;
    waitingFor = '';
    app = start(fresh, { restoreY });

    if (m) m.enter(boxesOf(fresh).map((b) => b.firstElementChild).filter(Boolean), null);
    const h1 = fresh.querySelector('[data-rs-title]');
    if (heldFocus && h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    say(heldFocus ? page.said : `${page.heading}. ${page.said}`);

    if (restoreY !== null) {
      if (page.state === 'nodata') window.scrollTo({ top: restoreY, left: 0, behavior: 'instant' });
      return Promise.resolve();
    }
    const hero = fresh.querySelector('[data-rs-hero]');
    if (m) return m.glide(m.topOf(hero, 0), { covered: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return Promise.resolve();
  }

  async function go(to, { push, restoreY = null, link = null }) {
    const ticket = runner.begin();
    const m = mb();
    const href = to.path + to.search + to.hash;
    waitingFor = to.path;
    clearPending();
    if (link) link.classList.add('is-pending');
    root.setAttribute('aria-busy', 'true');
    html.classList.add('is-paging');
    const old = boxesOf(root);
    if (m && !store.has(to.path)) for (const b of old) m.wait(b, true);
    try {
      const text = await store.load(to.path);
      if (!ticket.current()) return;
      const page = readResultsPage(new DOMParser().parseFromString(text, 'text/html'), to.path);
      if (!page.ok) throw new Error(page.reason);
      if (m) await Promise.all(old.map((b) => m.leave(b)));
      if (!ticket.current()) return;
      const moved = swapIn(page, to, href, push, restoreY);
      const done = () => { if (ticket.current()) html.classList.remove('is-paging'); };
      Promise.resolve(moved).then(done, done);
    } catch {
      if (!ticket.current()) return;
      runner.cancel();
      plainNavigation(href, push);
    }
  }

  // captured first on the document, so that the site's own "fade before leaving" fallback (js/site.js) does not take over these clicks
  doc.addEventListener('click', (e) => {
    if (bypass) return;
    const a = e.target.closest ? e.target.closest('a') : null;
    if (!a || !root.contains(a)) return;
    const to = inPlaceTarget(a, here(), e);
    if (!to) return;
    e.preventDefault();
    if (waitingFor === to.path) return;
    go(to, { push: true, link: a });
  }, true);

  // a hover, a focus or a touch fetches the page a little ahead (never more than two at once; the last six are kept)
  const quiet = () => !!(navigator.connection && navigator.connection.saveData);
  const warm = (e) => {
    if (quiet()) return;
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !root.contains(a)) return;
    const to = inPlaceTarget(a, here(), null);
    if (to) store.prefetch(to.path);
  };
  for (const ev of ['pointerenter', 'focusin', 'touchstart']) doc.addEventListener(ev, warm, { capture: true, passive: true });

  window.addEventListener('popstate', (e) => {
    const to = matchResultsPost(location.pathname, base);
    if (to && to.path === shown) { if (waitingFor) { runner.cancel(); settle(); } return; } // the same page: the app follows its own address
    if (!to) { runner.cancel(); location.reload(); return; }
    const y = e.state && typeof e.state.y === 'number' ? e.state.y : lastY.has(to.path) ? lastY.get(to.path) : null;
    go({ ...to, search: location.search, hash: location.hash }, { push: false, restoreY: y });
  });

  // this script puts the scroll place back itself, so the browser must not (it would race the list being drawn)
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
    window.addEventListener('pagehide', () => { history.scrollRestoration = 'auto'; });
    window.addEventListener('pageshow', () => { history.scrollRestoration = 'manual'; });
  }
}

if (typeof document !== 'undefined') {
  const boot = () => {
    const root = document.querySelector('[data-rs]');
    if (!root) return;
    const inMain = root.parentElement && root.parentElement.id === 'main';
    if (root.dataset.mode === 'centre' || !inMain || !window.fetch || !window.DOMParser || !window.AbortController || !(window.history && history.pushState)) { start(root); return; }
    createSwitcher(root);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}
