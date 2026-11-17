// Pure HTML builders for the indexable results pages. No fetches here: index.js reads the data and passes it in.
// Every page function returns { kind, ok, title, description, path, jsonld, main, app?, status? }:
//   kind  year | overview | list | hub | yearindex | notfound   (index.js turns kind + ok + RESULTS_INDEX into robots rules)
//   ok    the page passes the quality bar (a year page needs MIN_SAT candidates who sat); false = never indexable
// Text is English only. Names and cells come from the data and are always escaped. No inline style, no inline script.
import { centreSectionHtml, statCardsHtml, centreRowHtml } from '../../scripts/lib/results-app.mjs';
import { EXAMS, LEVELS, MIN_SAT, PER_PAGE, TITLE_PX, esc, fmt, hash, letterSlug, pct, pct1, titleWidth } from './util.js';
import { stats } from '../../js/results-codec.js';
import { PROFILES, profileOf, subjectLabel } from '../../js/results-app.js';
import { displayName } from './names.js';

export const SITE = 'Mayobe Bros';
const INDEPENDENT = 'Mayobe Bros is an independent site. It is not run, approved or endorsed by the National Examinations Council of Tanzania (NECTA).';
const NECTA_HOME = 'https://onlinesys.necta.go.tz/';

/* ------------------------------------------------------------------ addresses */
export const P = {
  results: () => '/category/educational/results/',
  post: (cat, year) => `/post/educational/results/necta-${cat}-results-${year}/`,
  overview: (cat, code) => `/results/${cat}/${code}/`,
  year: (cat, code, year) => `/results/${cat}/${code}/${year}/`,
  yearIndex: (cat, year) => `/results/${cat}/${year}/`,
  list: (cat, year, letter, page) => `/results/${cat}/${year}/${letterSlug(letter)}/${page > 1 ? page + '/' : ''}`,
  region: (cat, year, slug) => `/results/${cat}/${year}/region/${slug}/`,
  district: (cat, year, slug, page) => `/results/${cat}/${year}/district/${slug}/${page > 1 ? page + '/' : ''}`,
};

/* ------------------------------------------------------------------ small pieces */
const unitOf = (cat) => (PROFILES[cat] || PROFILES.csee).unit; // centre, school or college
const peopleOf = (kind) => (kind === 'primary' ? 'pupils' : 'candidates');
const listOr = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}` : a.join(''));
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);

/**
 * What counts as passed, per family, from the exam's own meta (the same reading as the interactive view).
 *   primary   PSLE: average grade A to C of the pupils graded; SFNA: the same, and pupils NECTA referred are not graded
 *   QT        PASSED
 *   classic   divisions I to IV (CSEE, ACSEE, FTNA; REFERRED is not a pass)
 *   others    the leading result words (meta.dp of them): DISTINCTION, CREDIT, PASS ... (diploma exams, CSEE 2014, ACSEE 2015)
 * Returns the figures and the wording for titles, leads and notes. A share is null when nobody can be counted.
 */
function passInfo(cat, kind, meta, header) {
  const prof = profileOf(cat, meta, kind, null);
  const st = stats(header, kind, meta);
  const sat = st.sat;
  let good, den, tag, phrase, label, groupWord;
  if (kind === 'primary') {
    const g = st.groups;
    const referred = cat === 'sfna' ? g[4] || 0 : 0;
    den = cat === 'sfna' ? sum(g.slice(0, 4)) : sum(g);
    good = sum(g.slice(0, 3));
    tag = 'grade A to C'; phrase = 'with average grade A, B or C'; label = 'Grade A to C'; groupWord = 'grade';
    return { prof, st, sat, good, den, p: pct(good, den), p1: pct1(good, den), tag, phrase, label, groupWord, referred, graded: den };
  }
  good = st.passed; den = sat;
  if (prof.noSubjects) { tag = 'passed'; phrase = 'passed'; label = 'Passed'; groupWord = 'result'; }
  else if (prof.roman) {
    const w = prof.words.slice(0, prof.pass);
    tag = 'pass'; phrase = w.length === 4 ? 'in divisions I to IV' : `in division ${listOr(w)}`; label = w.length === 4 ? 'In divisions I to IV' : 'Passed'; groupWord = 'division';
  } else { tag = 'pass'; phrase = `with ${listOr(prof.words.slice(0, prof.pass))}`; label = 'Passed'; groupWord = 'result'; }
  return { prof, st, sat, good, den, p: pct(good, den), p1: pct1(good, den), tag, phrase, label, groupWord, referred: 0, graded: den };
}
/** "12 (60%) passed (DISTINCTION, CREDIT or PASS)": the share sentence part, per family. */
function shareClause(pi, cat) {
  const { prof, good, p } = pi;
  if (p === null) return '';
  if (prof.primary) return `${fmt(good)} (${p}%) of ${fmt(pi.graded)} graded pupils have average grade A, B or C${pi.referred ? `; ${fmt(pi.referred)} pupils were referred and are not counted as graded` : ''}`;
  if (prof.noSubjects) return `${fmt(good)} (${p}%) passed`;
  if (prof.roman) return `${fmt(good)} (${p}%) are ${pi.phrase}`;
  return `${fmt(good)} (${p}%) passed (${pi.phrase.replace('with ', '')})`;
}
const countsWord = (prof) => (prof.primary ? 'grade counts' : prof.noSubjects ? 'passed and failed counts' : prof.roman ? 'division counts' : 'result counts');
const upper = (s) => s.toUpperCase();
const ARROW = '<svg class="rs-ico rs-row-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

/** The first text that fits in max characters; the last one is the fallback. */
function fit(options, max) {
  for (const o of options) if (o.length <= max) return o;
  return options[options.length - 1];
}
/** The first title that fits the width Google shows (about 580 px on a computer); the last one is used when none fits. */
function fitPx(options) {
  const list = options.filter(Boolean);
  for (const o of list) if (titleWidth(o) <= TITLE_PX) return o;
  return list[list.length - 1];
}
/** The ladder of one school-page title: the level in plain words first, then shorter forms. The school's name is never shortened. */
function yearTitles(shown, cat, year) {
  const L = LEVELS[cat], CAT = upper(cat);
  return [`${shown} Results ${year}: ${L.tail}`, L.lite ? `${shown} Results ${year}: ${L.lite}` : null, `${shown} ${CAT} Results ${year}`, `${shown} ${CAT} ${year}`];
}
/** The ladder of one school's all-years title. It never matches a year page's title: it carries the span of years, or "by Year" for a single year. */
function overviewTitles(shown, cat, span) {
  const L = LEVELS[cat], CAT = upper(cat);
  const when = span ? `Results ${span}` : 'Results by Year';
  return [`${shown} ${when}: ${L.tail}`, L.lite ? `${shown} ${when}: ${L.lite}` : null, `${shown} ${CAT} ${when}`, span ? `${shown} ${CAT} ${span}` : `${shown} ${CAT} by Year`];
}
/** Description between 70 and 160 characters: sentences are dropped from the end until it fits. */
function describe(sentences, fallback) {
  const list = sentences.filter(Boolean);
  while (list.length > 2 && list.join(' ').length > 160) list.splice(list.length - 2, 1);
  if (list.length > 1 && list.join(' ').length > 160) list.pop();
  let d = list.join(' ');
  if (d.length > 160) d = fallback && fallback.length <= 160 ? fallback : d.slice(0, 157).replace(/\s+\S*$/, '') + '...';
  if (d.length < 70) d = `${d} Independent guide, not run by NECTA.`.slice(0, 160);
  return d;
}

function crumbsHtml() { return ''; } // no visible breadcrumb line in the hero (owner's request, 2026-11-10); the BreadcrumbList data is kept

function hero({ crumbs, eyebrow, h1, lead, stats: st }) { // no note line in the hero (owner's request, 2026-11-10): every page states that the site is independent lower down
  const dl = st && st.length ? statCardsHtml(st.map(([k, v]) => ({ label: k, value: v })), esc) : '';
  return `<section class="rs-hero" data-rs-hero><div class="rs-wrap">
<p class="rs-eyebrow" data-rs-eyebrow><span class="rs-eyebrow-t">${esc(eyebrow)}</span></p>
<h1 class="rs-h1" data-rs-title>${esc(h1)}</h1>
<p class="rs-lead" data-rs-lead>${esc(lead)}</p>
${dl}
</div></section>`;
}

function jsonld({ origin, path, title, description, crumbs, about, modified }) {
  const url = origin + path;
  return [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url, inLanguage: 'en', ...(modified ? { dateModified: modified } : {}), ...(about ? { about } : {}), isPartOf: { '@type': 'WebSite', name: SITE, url: origin + '/' } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.href ? origin + c.href : url })) },
  ];
}

const homeCrumbs = () => [{ name: 'Home', href: '/' }, { name: 'Results', href: P.results() }];

function safeSource(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:') return { href: '', mirror: false, archive: false };
    const necta = x.hostname === 'necta.go.tz' || x.hostname.endsWith('.necta.go.tz');
    const mirror = x.hostname === 'maktaba.tetea.org';
    const archive = x.hostname === 'web.archive.org'; // the Internet Archive's saved copy of a NECTA page (ACSEE 2004)
    return { href: necta || mirror || archive ? x.href : '', mirror, archive };
  } catch { return { href: '', mirror: false, archive: false }; }
}

/** The source line used on year pages (same wording as the interactive view). */
function sourceHtml(rec, x) {
  return `<div class="rs-source" data-rs-source><span>Values are shown as NECTA published them${x.kind === 'primary' ? '; pupils’ personal numbers are not copied' : ''}.</span></div>`;
}

function pagerHtml(cur, total, hrefOf, label) {
  if (total <= 1) return '';
  const want = new Set([1, total, cur - 2, cur - 1, cur, cur + 1, cur + 2].filter((n) => n >= 1 && n <= total));
  const parts = [];
  let last = 0;
  for (const n of [...want].sort((a, b) => a - b)) {
    if (n - last > 1) parts.push('<span class="rs-gap" aria-hidden="true">…</span>');
    parts.push(n === cur
      ? `<span class="rs-chip rs-page" aria-current="page">${n}</span>`
      : `<a class="rs-chip rs-page" href="${esc(hrefOf(n))}"${n === cur - 1 ? ' rel="prev"' : n === cur + 1 ? ' rel="next"' : ''}>${n}</a>`);
    last = n;
  }
  const prev = cur > 1 ? `<a class="rs-chip rs-page" rel="prev" href="${esc(hrefOf(cur - 1))}">Previous</a>` : '';
  const next = cur < total ? `<a class="rs-chip rs-page" rel="next" href="${esc(hrefOf(cur + 1))}">Next</a>` : '';
  return `<nav class="rs-pager" aria-label="${esc(label)}">${prev}${parts.join('')}${next}</nav>`;
}

function wrap(inner, attrs = '') {
  return `<div class="rs" data-rs-page${attrs}>\n${inner}\n</div>`;
}

const DIV_NOTE = 'Divisions run from I (highest) to IV. Division 0 is below Division IV. NECTA works out the division from the points of a candidate’s best subjects: a better grade gives fewer points, so a smaller total is better. A dash in the Aggt column means NECTA published no total for that candidate.';
const GRADE_NOTE = 'Each pupil has an average grade from A (highest) to E (lowest), as NECTA published it. Subject names in the table are kept as NECTA wrote them, in Swahili.';

/** How to read the table, for the family of the exam. */
function readNote(prof, cat) {
  if (prof.primary) return cat === 'sfna'
    ? 'Each pupil has an average grade from A (highest) to D, as NECTA published it. Pupils NECTA referred are marked Referred, with the line NECTA printed, and are not counted as graded. Subject names in the table are kept as NECTA wrote them, in Swahili.'
    : GRADE_NOTE;
  if (prof.noSubjects) return 'Each candidate has one result, PASSED or FAILED, as NECTA published it. A candidate who did not sit the test is shown as ABSENT. This test lists no subject grades.';
  if (prof.roman) return cat === 'ftna' ? `${DIV_NOTE} Candidates NECTA referred are marked REFERRED; they are not counted as passed.` : DIV_NOTE;
  return `The ${prof.aggtName === 'GPA' ? 'GPA is the grade point average' : 'aggregate is the total'} NECTA published, with one decimal. The result is NECTA’s own word (${prof.words.join(', ')}), shown as published. A dash means NECTA published no ${prof.gpa ? 'GPA' : 'total'} for that candidate.`;
}

function rowsList(rows, cat, year, withPlace) {
  const half = Math.ceil(rows.length / 2);
  const col = (part) => (part.length ? `<ul class="rs-rows" role="list">${part.map((r) => centreRowHtml({ href: P.year(cat, r.c, year), code: r.code, name: displayName(r.name), meta: [upper(cat) + ' ' + year, withPlace ? [r.region, r.district].filter(Boolean).join(' · ') : ''].filter(Boolean).join(' · ') }, esc)).join('')}</ul>` : '');
  return `<div class="rs-cols">${col(rows.slice(0, half))}${col(rows.slice(half))}</div>`;
}

/* ------------------------------------------------------------------ centre-year page */
function gridTable(b, sw) {
  const num = (v) => /^[\d.,+-]+$/.test(v);
  const numeric = b.head.map((_, i) => i > 0 && b.rows.every((r) => num(r[i] == null ? '' : r[i])));
  return `<div class="rs-tablewrap" role="region" tabindex="0" aria-label="Overall performance"><table class="rs-table"${sw}><thead><tr>${b.head.map((x, i) => `<th scope="col"${numeric[i] ? ' class="rs-c"' : ''}>${esc(x)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((x, i) => `<td${numeric[i] ? ' class="rs-c"' : ''}>${esc(typeof x === 'string' ? subjectLabel(x) : x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** The region of a centre: PSLE and SFNA have it in the list, the other exams print it in the centre's overall block. */
function placeOf(rec, row) {
  if (row && (row.region || row.district)) return [row.region, row.district].filter(Boolean).map(displayName).join(', ');
  for (const b of rec.overall || []) {
    if (b.t !== 'kv') continue;
    for (const [k, v] of b.rows) if (/\bregion\b/i.test(k) && v && String(v).length < 40) return displayName(v);
  }
  return '';
}

/** Picks one of the variants the same way every time for the same page (no random wording between renders). */
const pick = (list, seed) => list[hash(String(seed)).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % list.length];

/**
 * The search-result text of a centre page. Written to be worth a click and to say only what the page really holds: the school's own
 * figures, as NECTA published them. No candidate number, no name, no code, no disclaimer (the page carries the disclaimer).
 */
function centreDescription({ dn, CAT, year, sat, p, pi, primary, hasSubjects, hasOthers, code, place, hasCode, seed }) {
  const count = countsWord(pi.prof);
  const people = primary ? 'pupils' : 'candidates';
  const level = LEVELS[CAT.toLowerCase()].plain;
  const exam = `${year} ${level}`;
  const share = p === null ? '' : primary
    ? `${p}% of ${fmt(pi.graded)} graded ${pi.graded === 1 ? 'pupil' : 'pupils'} scored average grade A, B or C`
    : `${p}% of ${fmt(sat)} ${sat === 1 ? 'candidate' : 'candidates'} passed`;
  const sent = share || `${fmt(sat)} ${sat === 1 ? people.slice(0, -1) : people} sat the examination`;
  const cap1 = (x) => x[0].toUpperCase() + x.slice(1);
  // what the page really holds, and nothing it does not: the figures, the counts, the subjects and the other years (never a candidate)
  const holds = [count, hasSubjects ? 'subject results' : '', hasOthers ? 'other years' : ''].filter(Boolean);
  const list = holds.length > 1 ? `${holds.slice(0, -1).join(', ')} and ${holds[holds.length - 1]}` : holds[0];
  const hooks = [
    `How did ${dn} do in the ${exam} exam? ${cap1(sent)}.`,
    `${dn}${hasCode ? (place ? `, ${place}` : '') : place ? ` (${code}, ${place})` : ` (${code})`}: ${exam} results. ${cap1(sent)}.`,
    `See how ${dn} performed in the ${exam} exam: ${sent}.`,
  ];
  const tails = [`See the ${list}.`, `Open the ${list}.`];
  const hook = pick(hooks, seed);
  const tail = hook.startsWith('See') ? tails[1] : pick(tails, seed + 'x'); // two "See" in a row read badly
  const brief = `${hook} See the ${count}.`;
  const short = `${dn} ${CAT} ${year} results (${LEVELS[CAT.toLowerCase()].tail.replace(/ [A-Z]+$/, '')}): ${sent}.`;
  const options = [`${hook} ${tail}`, `${hook} ${tails[0]}`, brief, `${hooks[0]} ${tails[0]}`, `${hooks[0]} See the ${count}.`, hooks[0], hook, short, `${dn} ${CAT} ${year} results: ${sent}.`];
  let d = options.find((o) => o.length >= 70 && o.length <= 160);
  if (!d) d = options.find((o) => o.length <= 160) || short.slice(0, 157).replace(/\s+\S*$/, '') + '...';
  if (d.length < 70) d = `${d} Independent site, not NECTA.`.slice(0, 160);
  return d;
}

export function yearPage({ origin, exam, meta, rec, header, row, others, verified, hasLetter, sameName = false }) {
  const cat = exam.cat, year = exam.year, kind = exam.kind, primary = kind === 'primary';
  const CAT = upper(cat);
  const code = rec.code.toLowerCase(), CODE = rec.code.toUpperCase();
  const pi = passInfo(cat, kind, meta, header);
  const prof = pi.prof, st = pi.st;
  const sat = st.sat, good = pi.good, p = pi.p;
  const people = peopleOf(kind);
  const unit = prof.unit;
  const name = rec.name;
  const dn = displayName(name);
  const place = placeOf(rec, row);
  // two centres of one exam-year can share a name: the centre number then follows the name, so no two pages have the same title
  const shown = sameName ? `${dn} (${CODE})` : dn;

  // Title (research 2026-11-17): "<Name> Results 2025: Form Four CSEE". The school and "results <year>" come first, because that is how people
  // search ("kibaha secondary school results 2025"); the level in plain words and the acronym follow, where a cut costs least. A ladder of
  // shorter forms keeps every title inside the width Google shows. No brand (the site name is shown by the search engine) and the name is
  // never shortened. Share titles are the same text.
  const L = LEVELS[cat];
  const head = fitPx(yearTitles(shown, cat, year));
  const title = head;
  const titleFull = head;
  const h1 = `${shown}: ${L.h1} Results ${year}`;
  const hasSubjects = (rec.overall || []).some((b) => b.t === 'grid');
  const description = centreDescription({ dn: shown, CAT, year, sat, p, pi, primary, hasSubjects, hasOthers: others.length > 0, code: CODE, place, hasCode: sameName, seed: `${cat}${code}${year}` });
  const path = P.year(cat, code, year);
  const crumbs = [...homeCrumbs(), { name: `${CAT} ${year}`, href: P.post(cat, year) }, { name: dn, href: '' }];
  const lead = `${CODE}${place ? `, ${place}` : ''}. ${fmt(st.n)} ${people} listed, ${fmt(sat)} sat the ${prof.noSubjects ? 'test' : 'examination'}${p === null ? '' : ` and ${shareClause(pi, cat)}`}.`;
  const sw = primary ? ' lang="sw"' : '';

  const facts = rec.facts && rec.facts.length ? `<div class="rs-kpis" data-rs-facts>${rec.facts.map(([k, v]) => `<div class="rs-kpi"${sw}><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>` : '';
  const caption = primary ? 'MADARAJA YA UFAULU WA UJUMLA' : prof.roman ? 'DIVISION PERFORMANCE SUMMARY' : `${prof.divName.toUpperCase()} SUMMARY`;
  const summary = rec.summary ? `<div data-rs-summary><div class="rs-tablewrap"><table class="rs-table rs-summary-table"${sw}><caption>${caption}</caption><thead><tr>${rec.summary.head.map((x, i) => `<th scope="col"${i ? ' class="rs-c"' : ''}>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rec.summary.rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td class="rs-c">${esc(x)}</td>` : `<th scope="row">${esc(x)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div></div>` : '';

  let overall = '';
  if (rec.overall && rec.overall.length) {
    const parts = [];
    for (const b of rec.overall) {
      if (b.t === 'h') parts.push(`<h3 class="rs-h-sm"${sw}>${esc(b.v)}</h3>`);
      else if (b.t === 'kv') parts.push(`<div class="rs-tablewrap" role="region" tabindex="0" aria-label="Overall performance"><table class="rs-table rs-kv"${sw}><tbody>${b.rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`);
      else if (b.t === 'grid') parts.push(gridTable(b, sw));
    }
    overall = `<section class="rs-overall" data-rs-overall aria-label="Overall performance of the ${unit}">${parts.join('')}</section>`;
  }

  const yearLinks = others.length
    ? `<nav class="rs-years rs-years--light" aria-label="Other years of this ${unit}"><span class="rs-years-l">Other years</span><ul>${others.map((o) => `<li><a class="rs-chip" href="${esc(P.year(cat, code, o.year))}">${o.year}</a></li>`).join('')}</ul></nav>`
    : '';

  // What search engines get is the school's own performance: its figures, its subjects, its divisions or grades. The list of candidates
  // is NOT in this HTML (candidate numbers and individual results are never meant to be indexed). The page's script fetches the centre
  // file and fills the place below; the data address is closed to crawlers in robots.txt and sends noindex.
  const data = `<div class="rs-static" data-rs-static>
<div class="rs-wrap rs-cintro">${facts}${summary}</div>
<div class="rs-wrap rs-cmain">
<h2 class="rs-sr">How ${esc(dn)} performed</h2>
${overall}
<section class="rs-cands-hold" data-rs-cands-hold aria-labelledby="rs-ch-${esc(code)}">
<h2 class="rs-h-sm" id="rs-ch-${esc(code)}">${primary ? 'Pupils’ results' : 'Candidate results'}</h2>
<p class="rs-cands-note" data-rs-cands-note role="status" hidden>Loading the ${primary ? 'pupils' : 'candidates'}…</p>
<noscript><p class="rs-cands-note">The ${primary ? 'pupils’' : 'candidates’'} results need JavaScript. You can also check them on the <a href="${esc(NECTA_HOME)}" rel="noopener noreferrer" target="_blank">official NECTA results website</a>.</p></noscript>
</section>
<div class="rs-source" data-rs-source><span>Values are shown as NECTA published them${primary ? '; pupils’ personal numbers are not copied' : ''}.</span></div>
</div>
</div>`;

  // the example in the search box ("e.g. P0134/9999") shows the format only: it is never a real candidate number
  const exampleCno = prof.cno.replace(/\d+$/, (m) => '9'.repeat(m.length));
  const x = { cat, year, kind, prof: { ...prof, cno: exampleCno } };
  const shareText = p === null ? '' : `, and ${shareClause(pi, cat)}${primary ? '' : `. That share is the pass rate used on this site: ${people} who passed divided by ${people} who sat`}`;
  const about = `<section class="rs-about rs-about--page"><div class="rs-wrap">
<h2>About this page</h2>
<p>This page shows the ${esc(L.h1)} results of ${esc(dn)} (centre ${esc(CODE)}${place ? `, ${esc(place)}` : ''}) for ${year}${L.sw ? ` (in Swahili, <span lang="sw">${esc(L.sw)} ${year}</span>)` : ''}, as NECTA published them: ${fmt(st.n)} ${people} listed, ${fmt(sat)} of them sat the ${prof.noSubjects ? 'test' : 'examination'}${shareText}.</p>
<h3>How to read the figures</h3>
<p>${readNote(prof, cat)}</p>
<h3>Source, date and corrections</h3>
<p>${safeSource(rec.sourceUrl).archive ? 'The figures were copied from the Internet Archive’s saved copy of the results page that NECTA published' : safeSource(rec.sourceUrl).mirror ? 'The figures were copied from Maktaba Tetea’s copy of the results that NECTA published' : 'The figures were copied from the results that NECTA published'}${verified ? ` and were last checked on ${esc(verified)}` : ''}. ${INDEPENDENT} If something here differs from NECTA, the result published by NECTA is the correct one: check it on the <a href="${esc(NECTA_HOME)}" rel="noopener noreferrer" target="_blank">official NECTA results website</a>. To ask for a correction or for a ${unit} to be removed, use the <a href="/contact/">contact page</a>.</p>
${yearLinks}
<ul class="rs-linkrow">
<li><a href="${esc(P.overview(cat, code))}">All years of ${esc(dn)}</a></li>
<li><a href="${esc(P.post(cat, year))}">Search all ${esc(CAT)} ${year} ${unit}s</a></li>
${hasLetter ? `<li><a href="${esc(P.list(cat, year, hasLetter, 1))}">${esc(CAT)} ${year} ${unit}s starting with ${hasLetter === '#' ? 'a number' : esc(hasLetter)}</a></li>` : ''}
</ul>
</div></section>`;

  const main = `<div class="rs" data-rs data-mode="centre" data-state="ready" data-exam="${esc(exam.id)}" data-cat="${esc(cat)}" data-year="${year}" data-kind="${kind}" data-base="/results/data" data-path="${esc(P.post(cat, year))}" data-verified="${esc(verified)}" data-v="${esc(exam.key)}" data-centre="${esc(CODE)}">
${hero({ crumbs, eyebrow: `${EXAMS[cat].name} ${year}`, h1, lead, stats: [[`${cap(people)} listed`, fmt(st.n)], ['Sat', fmt(sat)], [pi.label, p === null ? '-' : p + '%'], ['Last verified', verified]] })}
<div class="rs-stage" data-rs-stage>
${data}
<template data-rs-tpl>${centreSectionHtml({ ...x, CAT }, { e: esc, path: P.post(cat, year), officialLink: `<a href="${esc(NECTA_HOME)}" rel="noopener noreferrer" target="_blank">official NECTA results website<span class="rs-sr"> (opens in a new tab)</span></a>` })}</template>
${about}
</div>
<p class="rs-sr" role="status" aria-live="polite" aria-atomic="true" data-rs-live></p>
</div>`;
  const school = { '@type': 'EducationalOrganization', name: dn, identifier: CODE, ...(place ? { address: { '@type': 'PostalAddress', addressRegion: place, addressCountry: 'TZ' } } : {}) };
  return { kind: 'year', ok: sat >= MIN_SAT, title, titleFull, description, path, jsonld: jsonld({ origin, path, title: titleFull, description, crumbs, about: school, modified: verified }), main, app: true, status: 200, modified: verified, year: year };
}

/* ------------------------------------------------------------------ centre overview (all years) */
/** Column words of one year's counts: the exam's own words (divisions, grades, results), in header order. */
function groupHeads(cat, kind, meta) {
  if (kind === 'primary') return cat === 'sfna' ? ['A', 'B', 'C', 'D', 'Referred'] : ['A', 'B', 'C', 'D', 'E'];
  return profileOf(cat, meta, kind, null).words;
}

export function overviewPage({ origin, cat, code, years, sameName = false }) {
  // years: [{ exam, meta, name, header, verified }] newest first, at least one
  const kind = years[0].exam.kind, primary = kind === 'primary';
  const CAT = upper(cat), CODE = code.toUpperCase(), unit = unitOf(cat), people = peopleOf(kind);
  const latest = years[0];
  const name = latest.name;
  const dn = displayName(name);
  const shown = sameName ? `${dn} (${CODE})` : dn; // another centre of the newest year shares the name: the number follows it
  const rows = years.map((y) => {
    const pi = passInfo(cat, kind, y.meta, y.header);
    const heads = groupHeads(cat, kind, y.meta);
    return { year: y.exam.year, pi, s: pi.st, heads, sig: heads.join('|') + '|' + pi.label, good: pi.good, p: pi.p1, verified: y.verified };
  });
  const span = years.length > 1 ? `${rows[rows.length - 1].year} to ${rows[0].year}` : String(rows[0].year);
  const prof0 = rows[0].pi.prof;
  // one school, every year: its title differs from the year pages ("... Results 2025") so the two never compete as duplicates
  const title = fitPx(overviewTitles(shown, cat, years.length > 1 ? span : ''));
  const titleFull = title;
  const h1 = years.length > 1 ? `${shown}: ${LEVELS[cat].h1} Results ${span}` : `${shown}: ${LEVELS[cat].h1} Results by Year`;
  const shareWord = primary ? 'the share with grade A to C' : prof0.noSubjects ? 'the share who passed' : prof0.roman ? 'the share in divisions I to IV' : 'the share who passed';
  const lastLine = `Open any year for the full performance.`;
  const askLine = years.length === 1
    ? `Check ${shown} in the ${rows[0].year} ${LEVELS[cat].plain}: ${people} who sat, ${countsWord(prof0)} and ${shareWord}.`
    : `Is ${shown} improving? ${LEVELS[cat].plain} results for ${years.length} years (${span}), with pass rate and the change each year.`;
  const description = [`${askLine} ${lastLine}`, askLine, `${shown} ${CAT} results by year: ${people}, ${countsWord(prof0)} and pass share. Free on Mayobe Bros.`].find((d) => d.length >= 70 && d.length <= 160)
    || `${shown} ${CAT} results by year. Free on Mayobe Bros.`.padEnd(70, ' ').trim();
  const path = P.overview(cat, code);
  const crumbs = [...homeCrumbs(), { name: dn, href: '' }];

  // years that read differently (for example CSEE 2014 in classes and CSEE 2019 in divisions) get a table of their own
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.sig === r.sig) last.rows.push(r); else groups.push({ sig: r.sig, rows: [r] });
  }
  const tables = groups.map((g) => {
    const first = g.rows[0], gp = first.pi;
    const head = ['Year', cap(people) + ' sat', ...first.heads, gp.label, 'Change'];
    const body = g.rows.map((r, i) => {
      const prev = g.rows[i + 1];
      let change = '';
      if (prev && r.p !== null && prev.p !== null) {
        const d = Math.round((Number(r.p) - Number(prev.p)) * 10) / 10;
        change = d === 0 ? 'No change' : `${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(1)} points`;
      }
      const cells = first.heads.map((_, k) => r.s.total[k] || 0);
      return `<tr><th scope="row"><a href="${esc(P.year(cat, code, r.year))}">${r.year}</a></th><td class="rs-c">${fmt(r.s.sat)}</td>${cells.map((g2) => `<td class="rs-c">${fmt(g2)}</td>`).join('')}<td class="rs-c">${r.p === null ? '-' : r.p + '%'}</td><td class="rs-c">${change || '-'}</td></tr>`;
    }).join('');
    const label = groups.length > 1 ? `${g.rows[g.rows.length - 1].year}${g.rows.length > 1 ? ` to ${g.rows[0].year}` : ''}` : '';
    return `${label ? `<h3>${esc(label)}</h3>` : ''}<div class="rs-tablewrap" role="region" tabindex="0" aria-label="Results of ${esc(CODE)} by year${label ? ' ' + esc(label) : ''}"><table class="rs-table rs-years-table"><caption class="rs-sr">${esc(dn)} ${esc(CAT)} results by year${label ? ' ' + esc(label) : ''}</caption><thead><tr>${head.map((x, i) => `<th scope="col"${i ? ' class="rs-c"' : ''}>${esc(x)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  }).join('\n');
  const shareNotes = [...new Set(groups.map((g) => {
    const gp = g.rows[0].pi, l = gp.label;
    return primary
      ? `Counts are pupils per average grade. “${l}” is pupils with average grade A, B or C divided by pupils with a grade${cat === 'sfna' ? ' (referred pupils are not counted)' : ''}.`
      : gp.prof.noSubjects ? `Counts are candidates per result. “${l}” is candidates who passed divided by candidates who sat.`
      : gp.prof.roman ? `Counts are candidates per division. “${l}” is candidates in divisions I to IV divided by candidates who sat.`
      : `Counts are candidates per result (${gp.prof.words.join(', ')}). “${l}” is candidates with ${listOr(gp.prof.words.slice(0, gp.prof.pass))} divided by candidates who sat.`;
  }))];
  const verified = rows[0].verified;
  const modified = rows.map((r) => r.verified).filter(Boolean).sort().pop() || verified; // the newest check of any year
  const main = wrap(`${hero({ crumbs, eyebrow: `${EXAMS[cat].name}`, h1, lead: `${CODE}. Results for ${years.length === 1 ? 'one year' : years.length + ' years'} on this site: ${span}.`, stats: [['Years on this site', String(years.length)], ['Latest year', String(rows[0].year)], ['Last verified', verified]] })}
<section class="rs-main"><div class="rs-wrap">
<h2>Results by year</h2>
${tables}
<p class="rs-small rs-note-line">${shareNotes.join(' ')} “Change” is the difference from the year before, in percentage points. Open a year for the full ${primary ? 'table of pupils' : 'candidate table'}.</p>
<h3>About these figures</h3>
<p>${[...new Set(groups.map((g) => readNote(g.rows[0].pi.prof, cat)))].join(' ')}</p>
<p>${INDEPENDENT} The figures were copied from the results NECTA published and checked on ${esc(verified)}. If something differs from NECTA, NECTA’s published result is the correct one (<a href="${esc(NECTA_HOME)}" rel="noopener noreferrer" target="_blank">official NECTA results website</a>). To ask for a correction or for a ${unit} to be removed, use the <a href="/contact/">contact page</a>.</p>
<ul class="rs-linkrow"><li><a href="${esc(P.post(cat, rows[0].year))}">Search all ${esc(CAT)} ${rows[0].year} ${unit}s</a></li></ul>
</div></section>`);
  return { kind: 'overview', ok: rows[0].s.sat >= MIN_SAT, title, titleFull, description, path, jsonld: jsonld({ origin, path, title: titleFull, description, crumbs, about: { '@type': 'EducationalOrganization', name: dn, identifier: CODE }, modified }), main, status: 200, modified, year: rows[0].year };
}

/* ------------------------------------------------------------------ A to Z list pages */
function letterBar(exam, counts, current) {
  const items = [...counts.entries()].sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0] < b[0] ? -1 : 1));
  return `<nav class="rs-az rs-az--links" aria-label="Filter ${unitOf(exam.cat)}s by first letter"><ul class="rs-azlist">${items.map(([L, n]) => `<li><a class="rs-az-btn" href="${esc(P.list(exam.cat, exam.year, L, 1))}"${L === current ? ' aria-current="page"' : ''}>${L === '#' ? '0-9' : L}<small>${fmt(n)}</small></a></li>`).join('')}</ul></nav>`;
}

export function listPage({ origin, exam, letter, page, rows, total, counts, verified, region }) {
  // rows: the slice for this page; total: all rows of this letter; counts: Map letter -> n
  const cat = exam.cat, year = exam.year, kind = exam.kind, CAT = upper(cat), unit = unitOf(cat);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const lname = letter === '#' ? 'a number' : letter;
  const first = rows[0], last = rows[rows.length - 1];
  const title = fit([`${CAT} ${year} ${unit}s starting with ${lname === 'a number' ? 'a number' : letter}${page > 1 ? `, page ${page}` : ''}: codes and results`, `${CAT} ${year} ${unit}s: ${lname === 'a number' ? 'numbers' : letter}${page > 1 ? ` page ${page}` : ''}`], 70);
  const description = describe([
    `Find your ${unit}: ${fmt(total)} ${CAT} ${year} ${unit}s starting with ${lname}${page > 1 ? ` (page ${page} of ${pages})` : ''}, from ${displayName(first.name)} to ${displayName(last.name)}.`,
    `Open one to see how it performed.`,
  ], `${CAT} ${year} ${unit}s starting with ${lname}: ${fmt(total)} in all. Open one to see its results.`);
  const path = P.list(cat, year, letter, page);
  const crumbs = [...homeCrumbs(), { name: `${CAT} ${year}`, href: P.yearIndex(cat, year) }, { name: letter === '#' ? 'Numbers' : letter, href: '' }];
  const main = wrap(`${hero({ crumbs, eyebrow: `${EXAMS[cat].name} ${year}`, h1: `${CAT} ${year} ${unit}s starting with ${lname}`, lead: `${fmt(total)} ${unit}s${pages > 1 ? `, page ${page} of ${pages}` : ''}. Open one to see its results.`, stats: [] })}
<section class="rs-main"><div class="rs-wrap">
${letterBar(exam, counts, letter)}
<p class="rs-status"><span>Showing <strong>${fmt((page - 1) * PER_PAGE + 1)}–${fmt((page - 1) * PER_PAGE + rows.length)}</strong> of <strong>${fmt(total)}</strong> ${unit}s</span></p>
${rowsList(rows, cat, year, kind === 'primary')}
${pagerHtml(page, pages, (n) => P.list(cat, year, letter, n), 'Pages')}
<p class="rs-small rs-note-line">${INDEPENDENT} The ${unit} names and numbers are those in NECTA’s published ${esc(CAT)} ${year} results, checked on ${esc(verified)}. <a href="${esc(P.post(cat, year))}">Search all ${esc(CAT)} ${year} ${unit}s</a> by name or number.</p>
</div></section>`);
  return { kind: 'list', ok: true, title, description, path, jsonld: jsonld({ origin, path, title, description, crumbs }), main, status: 200, modified: verified, year: year };
}

/* ------------------------------------------------------------------ exam-year index (letters, and regions for PSLE) */
export function yearIndexPage({ origin, exam, counts, regions, total, verified }) {
  const cat = exam.cat, year = exam.year, CAT = upper(cat), unit = unitOf(cat);
  const title = fitPx([`${LEVELS[cat].tail} ${year} Results by ${cap(unit)}: A to Z${regions ? ' and Region' : ''}`, `${CAT} ${year} ${unit}s A to Z${regions ? ' and by region' : ''}`]);
  const description = describe([
    `Browse ${fmt(total)} ${CAT} ${year} ${unit}s with results on this site, by first letter${regions ? ' or by region and district' : ''}.`,
    `Open any ${unit} to see how it performed: ${exam.kind === 'primary' ? 'grades' : ['csee', 'acsee', 'ftna'].includes(cat) ? 'divisions' : 'results'} and ${exam.kind === 'primary' ? 'pupils' : 'candidates'} who sat.`,
  ], `Browse ${CAT} ${year} ${unit}s by first letter and open any one to see its results.`);
  const path = P.yearIndex(cat, year);
  const crumbs = [...homeCrumbs(), { name: `${CAT} ${year}`, href: '' }];
  const reg = regions
    ? `<h2>By region</h2><ul class="rs-chiplist">${[...regions.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map((r) => `<li><a class="rs-chip" href="${esc(P.region(cat, year, r.slug))}">${esc(r.name)}<span class="rs-count">${fmt(r.count)}</span></a></li>`).join('')}</ul>`
    : '';
  const main = wrap(`${hero({ crumbs, eyebrow: EXAMS[cat].name, h1: `${CAT} ${year} ${unit}s`, lead: `${fmt(total)} ${unit}s with results on this site.`, stats: [] })}
<section class="rs-main"><div class="rs-wrap">
<h2>By first letter</h2>
${letterBar(exam, counts, null)}
${reg}
<p class="rs-small rs-note-line">${INDEPENDENT} Checked on ${esc(verified)}. <a href="${esc(P.post(cat, year))}">Search by name or number</a>.</p>
</div></section>`);
  return { kind: 'yearindex', ok: true, title, description, path, jsonld: jsonld({ origin, path, title, description, crumbs }), main, status: 200, modified: verified, year: year };
}

/* ------------------------------------------------------------------ region and district hubs (PSLE and SFNA) */
export function regionPage({ origin, exam, region, verified }) {
  const year = exam.year, cat = exam.cat, CAT = upper(cat), unit = unitOf(cat);
  const ds = [...region.districts.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  const title = `${region.name} region ${CAT} ${year}: districts and ${unit}s`;
  const description = describe([
    `${fmt(region.count)} ${CAT} ${year} ${unit}s with results in ${region.name} region, in ${ds.length} ${ds.length === 1 ? 'district' : 'districts'}.`,
    `Open a district to find your ${unit} and its results.`,
  ]);
  const path = P.region(cat, year, region.slug);
  const crumbs = [...homeCrumbs(), { name: `${CAT} ${year}`, href: P.yearIndex(cat, year) }, { name: region.name, href: '' }];
  const main = wrap(`${hero({ crumbs, eyebrow: `${EXAMS[cat].name} ${year}`, h1: `${region.name} region: ${CAT} ${year}`, lead: `${fmt(region.count)} ${unit}s in ${ds.length} ${ds.length === 1 ? 'district' : 'districts'}.`, stats: [] })}
<section class="rs-main"><div class="rs-wrap">
<h2>Districts</h2>
<ul class="rs-chiplist">${ds.map((d) => `<li><a class="rs-chip" href="${esc(P.district(cat, year, d.slug, 1))}">${esc(d.name)}<span class="rs-count">${fmt(d.rows.length)}</span></a></li>`).join('')}</ul>
<p class="rs-small rs-note-line">${INDEPENDENT} Region and district are as NECTA lists them; checked on ${esc(verified)}.</p>
</div></section>`);
  return { kind: 'hub', ok: true, title, description, path, jsonld: jsonld({ origin, path, title, description, crumbs }), main, status: 200, modified: verified, year: year };
}

export function districtPage({ origin, exam, district, page, verified }) {
  const year = exam.year, cat = exam.cat, CAT = upper(cat), unit = unitOf(cat), region = district.region;
  const total = district.rows.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = district.rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const title = fit([`${district.name} district, ${region.name}: ${CAT} ${year} ${unit}s${page > 1 ? `, page ${page}` : ''}`, `${district.name}, ${region.name}: ${CAT} ${year}${page > 1 ? ` page ${page}` : ''}`], 70);
  const description = describe([
    `${fmt(total)} ${CAT} ${year} ${unit}s with results in ${district.name} district, ${region.name} region${page > 1 ? ` (page ${page} of ${pages})` : ''}.`,
    `Open a ${unit} to see its grades.`,
  ]);
  const path = P.district(cat, year, district.slug, page);
  const crumbs = [...homeCrumbs(), { name: `${CAT} ${year}`, href: P.yearIndex(cat, year) }, { name: region.name, href: P.region(cat, year, region.slug) }, { name: district.name, href: '' }];
  const main = wrap(`${hero({ crumbs, eyebrow: `${EXAMS[cat].name} ${year}`, h1: `${district.name} district, ${region.name}: ${CAT} ${year}`, lead: `${fmt(total)} ${unit}s${pages > 1 ? `, page ${page} of ${pages}` : ''}.`, stats: [] })}
<section class="rs-main"><div class="rs-wrap">
${rowsList(rows, cat, year, false)}
${pagerHtml(page, pages, (n) => P.district(cat, year, district.slug, n), 'Pages')}
<p class="rs-small rs-note-line">${INDEPENDENT} Checked on ${esc(verified)}.</p>
</div></section>`);
  return { kind: 'hub', ok: true, title, description, path, jsonld: jsonld({ origin, path, title, description, crumbs }), main, status: 200, modified: verified, year: year };
}

/* ------------------------------------------------------------------ not found */
export function notFoundPage() {
  const main = wrap(`<section class="rs-statement"><div class="rs-wrap"><div class="rs-card rs-card--pad">
<h1 class="rs-h1-plain">Page not found</h1>
<p>There is no results page at this address. The centre number or the year may be wrong, or the results are not on this site.</p>
<p><a class="rs-btn" href="${esc(P.results())}">Go to Results</a></p>
<p class="rs-small">${INDEPENDENT}</p>
</div></div></section>`);
  return { kind: 'notfound', ok: false, title: 'Page not found', description: 'There is no results page at this address.', path: '/results/', jsonld: [], main, status: 404 };
}
