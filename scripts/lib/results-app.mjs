// The static shell of the results app (the body of the nine NECTA results posts). Pure: no file or network access.
// js/results-app.js boots from the data-* attributes and the data-rs-* hooks written here and fills in the lists.
// Everything inserted is escaped with ctx.e; there is no inline script and no style="" attribute (the page's CSP forbids both).
//
//   resultsAppHtml(post, ctx) -> string for inside <main id="main">
//   post: { slug, title? }  (the slug is necta-<csee|acsee|psle>-results-<year>)
//   ctx:  { u, e, config?, dataset, siblings, crumbs, official, verified, cacheKey, path? }
//     u(path)      adds the site's base path to an address ('/privacy-policy/')
//     e(text)      HTML escape
//     dataset      { total, online, verified, subjects? } or null (no data for this exam: an honest statement instead of the app)
//     siblings     [{ label, href, current, hasData? }] the results posts of the same exam (hasData:false = no data, left out of "years on this site")
//     crumbs       [{ name, href }] Home / Results / CSEE / 2024 (the last one is the current page)
//     official     the official NECTA address, or null
//     verified     the date the data was checked, 'YYYY-MM-DD'
//     cacheKey     short string added as ?v= to the data requests
//     path         the page's own address (data-path); defaults to /post/educational/results/<slug>/

import { profileOf } from '../../js/results-app.js';
import { LEVELS } from '../../results-worker/src/util.js';

const EXAMS = {
  csee: { name: 'Certificate of Secondary Education Examination', kind: 'secondary' },
  acsee: { name: 'Advanced Certificate of Secondary Education Examination', kind: 'secondary' },
  psle: { name: 'Primary School Leaving Examination', kind: 'primary' },
  ftna: { name: 'Form Two National Assessment', kind: 'secondary' },
  sfna: { name: 'Standard Four National Assessment', kind: 'primary' },
  dsee: { name: 'Diploma in Secondary Education Examinations', kind: 'secondary' },
  dpee: { name: 'Teachers college diploma examination (DPEE)', kind: 'secondary' },
  dppee: { name: 'Teachers college diploma examination (DPPEE)', kind: 'secondary' },
  dspee: { name: 'Teachers college diploma examination (DSPEE)', kind: 'secondary' },
  dte: { name: 'Diploma in Technical Education', kind: 'secondary' },
  qt: { name: 'Qualifying Test', kind: 'secondary' },
};
const OFFICIAL_FALLBACK = 'https://onlinesys.necta.go.tz/';

const svg = (inner, cls = 'rs-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
const ICON = {
  search: svg('<path d="M11 19a8 8 0 1 1 5.3-14 8 8 0 0 1-5.3 14Zm10 2-4.3-4.3"/>', 'rs-ico rs-ico-lead'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  external: svg('<path d="M14 4h6v6m0-6L10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  back: svg('<path d="M19 12H5m6-6-6 6 6 6"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.01"/>', 'rs-ico rs-ico-info'),
  // Lucide-style icons (lucide.dev, ISC licence), drawn inline: one stroke weight (2), one 24x24 grid, currentColor.
  idcard: svg('<path d="M16 10h2M16 14h2M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>', 'rs-ico rs-ico-tab'),
  searchTab: svg('<path d="M11 19a8 8 0 1 1 5.3-14 8 8 0 0 1-5.3 14Zm10 2-4.3-4.3"/>', 'rs-ico rs-ico-tab'),
};
const SCHOOL = '<path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M18 5v16"/><path d="m4 6 7.106-3.553a2 2 0 0 1 1.788 0L20 6"/><path d="m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11"/><path d="M6 5v16"/><circle cx="12" cy="9" r="2"/>';
const STAT_ICONS = {
  school: svg(SCHOOL, 'rs-ico'),
  'file-check': svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>', 'rs-ico'),
  'calendar-check': svg('<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>', 'rs-ico'),
};
const ROW_ARROW = svg('<path d="M5 12h14m-6-6 6 6-6 6"/>', 'rs-ico rs-row-go');

/**
 * The statistic cards of the hero. items: [{ label, value, icon? }] (icon: 'school' | 'file-check' | 'calendar-check'; left out = no icon).
 * `attrs` is written on the <dl> (the app uses ' data-rs-stats'). A value that looks like 2026-11-10 gets the smaller date numerals.
 * Markup (also what the Worker should write): <dl class="rs-stats"><div class="rs-stat"><dt><span class="rs-stat-ico" aria-hidden="true">SVG</span><span class="rs-stat-label">Label</span></dt><dd>Value</dd></div>...</dl>
 * The icon span is optional: a card without it still renders well.
 */
export function statCardsHtml(items, e, attrs = '') {
  const cards = (items || []).filter(Boolean).map(({ label, value, icon }) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const ic = icon && STAT_ICONS[icon] ? `<span class="rs-stat-ico" aria-hidden="true">${STAT_ICONS[icon]}</span>` : '';
    return `<div class="rs-stat${date ? ' rs-stat--date' : ''}"><dt>${ic}<span class="rs-stat-label">${e(label)}</span></dt><dd>${e(value)}</dd></div>`;
  });
  return `<dl class="rs-stats"${attrs}>${cards.join('')}</dl>`;
}

/**
 * One centre in a list. { href?, code, name, meta, muted? }; without href (or muted) it is a quiet non-link row (no results here).
 * Markup: <li><a class="rs-row" href><span class="rs-row-ico" aria-hidden="true">SVG</span><span class="rs-row-code rs-mono">CODE</span><span class="rs-row-name">NAME<small>META</small></span>ARROW</a></li>
 * A muted row is <li><div class="rs-row is-muted">...same, no arrow...</div></li>. Extra attributes for the link go in `attrs`.
 */
export function centreRowHtml({ href, code, name, meta, muted, attrs = '' }, e) {
  const inner = `<span class="rs-row-ico" aria-hidden="true">${svg(SCHOOL, 'rs-ico')}</span><span class="rs-row-code rs-mono">${e(code)}</span><span class="rs-row-name">${e(name)}${meta ? `<small>${e(meta)}</small>` : ''}</span>`;
  return muted || !href ? `<li><div class="rs-row is-muted">${inner}</div></li>` : `<li><a class="rs-row" href="${e(href)}"${attrs}>${inner}${ROW_ARROW}</a></li>`;
}

export function examFromPost(post) {
  const m = /necta-(csee|acsee|psle|ftna|sfna|dsee|dpee|dppee|dspee|dte|qt)-results-(\d{4})/.exec(String(post && post.slug));
  if (!m) throw new Error(`resultsAppHtml: not a results post: ${post && post.slug}`);
  const cat = m[1];
  return { cat, year: Number(m[2]), id: `${cat}-${m[2]}`, kind: EXAMS[cat].kind, name: EXAMS[cat].name, CAT: cat.toUpperCase() };
}


/**
 * The search-result description of a results post (the page that holds the search): what a visitor can do here, with the real count of
 * schools. Written once per exam-year from the dataset, so every post has its own (the counts differ) and no placeholder text is ever shown.
 * `ds` is the dataset ({ online, total }); returns '' when the exam has no data (the caller keeps the post's own excerpt).
 */
export function resultsPostDescription(post, ds) {
  if (!ds) return '';
  const x = examFromPost(post);
  const prof = profileFor(x, null);
  const unit = prof.unit, n = Number(ds.online || ds.total || 0);
  if (!n) return '';
  const person = x.kind === 'primary' ? 'pupil' : 'candidate';
  const level = LEVELS[x.cat].plain;
  const first = `Search ${x.year} ${level} results by ${unit} name, ${unit} number or ${person} number.`;
  const many = n === 1 ? `the ${unit}` : `any of ${num(n)} ${unit}s`;
  const second = `See how ${many} performed, free on Mayobe Bros.`;
  const d = `${first} ${second}`;
  if (d.length <= 160) return d;
  const short = `${first} See how ${many} performed.`;
  return short.length <= 160 ? short : `Search ${x.year} ${LEVELS[x.cat].tail} results by ${unit} name or number. See how any of ${num(n)} ${unit}s performed.`;
}

/**
 * The search-result title of a results post (the page that holds the search). The visible heading keeps the owner's "NECTA CSEE RESULTS 2025 | MAYOBE BROS";
 * the title that search engines and link previews show leads with the words people type (research 2026-11-17: Swahili leads for the
 * national exam names, English for "results by school"). Returns '' when the exam has no data, so the post keeps its own title.
 */
const SW_HEAD = { csee: 'Kidato cha Nne', acsee: 'Kidato cha Sita', ftna: 'Kidato cha Pili', psle: 'Darasa la Saba', sfna: 'Darasa la Nne' };
export function resultsPostTitle(post, ds) {
  if (!ds) return '';
  const x = examFromPost(post);
  const unit = profileFor(x, null).unit, Unit = unit[0].toUpperCase() + unit.slice(1);
  if (SW_HEAD[x.cat]) return `Matokeo ya ${SW_HEAD[x.cat]} ${x.year}: ${x.CAT} Results by School`; // NECTA says "centre"; people search for "school"
  if (x.cat === 'qt') return `NECTA QT Results ${x.year}: Qualifying Test by ${Unit}`;
  if (x.cat === 'dte') return `NECTA DTE Results ${x.year}: Search by ${Unit}`;
  return `Matokeo ya Ualimu ${x.year}: ${x.CAT} Results by ${Unit}`; // DSEE, DPEE, DPPEE, DSPEE
}

/** The reading of the exam (words, columns, examples); `meta` is meta.json or any object with gs / dw / dp / subjects. */
function profileFor(x, meta) {
  return x.prof || profileOf(x.cat, meta || null, x.kind, x.year);
}

const num = (n) => Number(n).toLocaleString('en');

/** The "How to read the results" list items for this exam. */
function howToRead(x, prof, e) {
  const sepEx = e(prof.cno);
  if (x.kind === 'primary') {
    const referred = x.cat === 'sfna';
    return `<li><strong>Candidate number</strong>: the school number, a dash and the pupil&rsquo;s own number, for example ${sepEx}.</li>
<li><strong>Subjects</strong>: each subject with the grade NECTA gave, from A to E. Column names are kept as NECTA wrote them, in Swahili.</li>
<li><strong>Average grade</strong>: the overall grade NECTA gave the pupil.${referred ? ' Pupils NECTA referred are marked Referred, with the line NECTA printed.' : ''}</li>
<li>Pupils&rsquo; personal PREM numbers are not shown.</li>`;
  }
  const num1 = `<li><strong>Candidate number</strong>: the ${prof.unit} number, a slash and the candidate&rsquo;s own number, for example ${sepEx}.</li>`;
  if (prof.noSubjects) {
    return `${num1}
<li><strong>Result</strong>: ${prof.words.map((w) => `<strong>${e(w)}</strong>`).join(' or ')}, as NECTA published it. A candidate who did not sit the test is shown as absent. A code with a star is NECTA&rsquo;s own, shown with the line printed beside it.</li>
<li>This test lists no subject grades.</li>`;
  }
  const agg = prof.gpa
    ? '<li><strong>GPA</strong>: the grade point average NECTA published, with one decimal. A dash means no GPA was published for that candidate.</li>'
    : '<li><strong>Aggt</strong>: the aggregate, the total NECTA published. A dash means no total was published for that candidate.</li>';
  const div = prof.roman
    ? `<li><strong>Div</strong>: the division, I to IV, or 0.${prof.words.includes('REFERRED') ? ' Candidates NECTA referred are marked REFERRED.' : ''}</li>`
    : `<li><strong>${e(prof.divName)}</strong>: ${prof.words.map((w) => e(w)).join(', ')}, as NECTA published it.</li>`;
  return `${num1}
${agg}
${div}
<li><strong>Subjects</strong>: each subject with the grade for it.</li>`;
}

export function centreSectionHtml(x, { e, path, officialLink, contactHref = '/contact/' }) {
  const primary = x.kind === 'primary';
  const prof = profileFor(x);
  const unit = prof.unit;
  const units = `${unit}s`;
  return `<section class="rs-centre" data-rs-centre hidden>
<div class="rs-wrap" data-rs-cstate hidden></div>
<div data-rs-cbody hidden>
<div class="rs-wrap rs-cintro">
<div data-rs-result></div>
<div class="rs-kpis" data-rs-facts hidden></div>
<div data-rs-summary hidden></div>
<div class="rs-legend" data-rs-legend hidden></div>
</div>
<div class="rs-tools rs-tools--centre" data-rs-ctools><div class="rs-wrap">
<div class="rs-tools-form rs-tools-form--single">
<div class="rs-field"><label for="rs-q-cn">Search candidates</label><div class="rs-box">${ICON.search}<input class="rs-input" id="rs-q-cn" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${e(`e.g. ${prof.cno}`)}" data-rs-cq><button class="rs-clear" type="button" aria-label="Clear candidate search" data-visible="false">${ICON.x}</button></div></div>
<div class="rs-filter-row" hidden><span class="rs-label" id="rs-lbl-grade">${e(prof.divName)}</span><div class="rs-chips" data-rs-chips role="group" aria-labelledby="rs-lbl-grade"></div></div>
</div>
</div></div>
<div class="rs-wrap rs-cmain">
<div class="rs-status" data-rs-cstatus></div>
<div data-rs-cands></div>
<div class="rs-empty" data-rs-cempty hidden>${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8.5 11h5"/>', 'rs-ico')}<h3>No candidate matches</h3><p>Check the candidate number or clear the search. Numbers keep their leading zeros.</p><button type="button" class="rs-btn" data-rs-creset>Clear search</button></div>
<section class="rs-overall" data-rs-overall hidden aria-label="Overall performance of the ${unit}"></section>
<div class="rs-source" data-rs-source></div>
<p class="rs-disclaimer">${ICON.info}<span>Mayobe Bros is an independent site. It is not run, approved or endorsed by NECTA. If a result here differs from NECTA&rsquo;s website, NECTA&rsquo;s published result is the correct one. See the ${officialLink}.</span></p>
<p class="rs-disclaimer" data-rs-premnote hidden>${ICON.info}<span>PREM numbers are shown as NECTA printed them next to each candidate number. Names are not copied. To have a number hidden, <a href="${e(contactHref)}">contact us</a>.</span></p>
<p class="rs-backrow"><a class="rs-btn rs-btn--ghost" href="${e(path)}" data-rs-back>${ICON.back}Back to all ${e(x.CAT)} ${x.year} ${units}</a></p>
</div>
</div>
</section>`;
}

/** "Browse A to Z": plain links to the Worker's lists, so search engines and people without scripts can reach every ${unit}. */
function browseHtml(x, ctx, units, e) {
  const letters = ctx.browse;
  if (!ctx.pagesBase || !letters) return '';
  const items = Object.entries(letters).filter(([, n]) => n > 0).sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0] < b[0] ? -1 : 1));
  if (!items.length) return '';
  const base = `${ctx.pagesBase}/${x.cat}/${x.year}`;
  return `<nav class="rs-browse" aria-labelledby="rs-browse-h"><h2 id="rs-browse-h">Browse ${e(units)} A to Z</h2><ul class="rs-azlist">${items.map(([L, n]) => `<li><a class="rs-az-btn" href="${e(`${base}/${L === '#' ? 'other' : L.toLowerCase()}/`)}">${L === '#' ? '0-9' : L}<small>${num(n)}</small></a></li>`).join('')}</ul><p class="rs-small"><a href="${e(`${base}/`)}">All ${e(x.CAT)} ${x.year} ${e(units)} by letter${x.kind === 'primary' ? ' and region' : ''}</a></p></nav>
`;
}

export function resultsAppHtml(post, ctx) {
  const { u, e } = ctx;
  const x = examFromPost(post);
  const primary = x.kind === 'primary';
  const ds = ctx.dataset || null;
  const prof = profileFor(x, ds && (ds.gs || ds.dw || ds.dp !== undefined) ? ds : null);
  const unit = prof.unit;
  const units = `${unit}s`;
  const official = ctx.official || OFFICIAL_FALLBACK;
  const verified = ctx.verified || (ds && ds.verified) || '';
  const path = ctx.path || (post.path || u(`/post/educational/results/${post.slug}/`));
  const siblings = (ctx.siblings || []).filter((s) => !s.current);
  const withData = siblings.filter((s) => s.hasData !== false);
  const crumbs = (ctx.crumbs && ctx.crumbs.length ? ctx.crumbs : [{ name: 'Home', href: u('/') }, { name: x.CAT, href: path }, { name: String(x.year), href: path }]);
  const title = `${x.CAT} Examination Results ${x.year}`;
  // a year NECTA no longer publishes is read from the Internet Archive's saved copy of NECTA's page: say so, do not call it NECTA's own site
  const officialLabel = ctx.dataset?.archive ? 'Internet Archive copy of NECTA&rsquo;s results page' : 'official NECTA results website';
  const officialLink = `<a href="${e(official)}" rel="noopener noreferrer" target="_blank">${officialLabel}<span class="rs-sr"> (opens in a new tab)</span></a>`;

  const creditHtml = ctx.imageCredit && /Photo:/i.test(String(ctx.imageCredit)) ? `<p class="rs-small rs-credit" data-rs-credit>Picture credit: ${e(String(ctx.imageCredit).replace(/^Cover drawn by Mayobe Bros\.\s*/, '').replace(/^Photo:\s*/i, ''))}</p>` : '';

  const crumbsHtml = ''; // no breadcrumb line in the hero (owner's request, 2026-11-10); the data stays for the Worker's BreadcrumbList

  const yearsHtml = siblings.length
    ? `<nav class="rs-years" aria-label="Other years" data-rs-years><span class="rs-years-l">Other years</span><ul>${siblings.map((s) => `<li><a class="rs-chip rs-chip--dark" href="${e(s.href)}">${e(s.label)}</a></li>`).join('')}</ul></nav>`
    : '';

  const statsHtml = ds
    ? statCardsHtml([
      { label: `${units[0].toUpperCase() + units.slice(1)} listed`, value: num(ds.total) },
      { label: 'With results here', value: num(ds.online) },
      verified ? { label: 'Last verified', value: verified } : null,
    ], e, ' data-rs-stats')
    : '<dl class="rs-stats" data-rs-stats hidden></dl>';

  // No "independent guide" note in the hero (owner's request, 2026-11-10): the statement stays lower on every page (About these results, the page disclaimer, the no-data statement).
  const pending = !ds && !!ctx.pending; // the data is being prepared (a download is running); otherwise it is simply not on this site
  const lead = ds
    ? `Search and browse ${LEVELS[x.cat].plain} ${units} and candidate results across Tanzania${LEVELS[x.cat].sw ? ` (${LEVELS[x.cat].sw} ${x.year})` : ''}.`
    : pending ? `The ${x.CAT} ${x.year} results are being added to this site.` : `The ${x.CAT} ${x.year} results are not on this site.`;

  const hero = `<section class="rs-hero" data-rs-hero><div class="rs-wrap">
<p class="rs-eyebrow" data-rs-eyebrow><span class="rs-eyebrow-t">${e(x.name)}</span></p>
<h1 class="rs-h1" data-rs-title>${e(title)}</h1>
<p class="rs-lead" data-rs-lead>${e(lead)}</p>
${statsHtml}
${yearsHtml}
</div></section>`;


  const root = (inner, state) => `<div class="rs" data-rs data-state="${state}" data-exam="${e(x.id)}" data-cat="${e(x.cat)}" data-year="${x.year}" data-kind="${x.kind}" data-base="${e(ctx.dataBase || u('/results-data'))}" data-path="${e(path)}" data-verified="${e(verified)}" data-v="${e(ctx.cacheKey || '')}"${ctx.pagesBase ? ` data-pages="${e(ctx.pagesBase)}"` : ''}>
${inner}
</div>`;

  /* ---- no data for this exam ---- */
  if (!ds) {
    const have = withData.length
      ? `<p>Results we do have for ${x.CAT}: ${withData.map((s) => `<a href="${e(s.href)}">${e(s.label)}</a>`).join(', ')}.</p>`
      : '';
    return root(`${hero}
<section class="rs-statement"><div class="rs-wrap"><div class="rs-card rs-card--pad">
<h2>${pending ? 'These results are being added' : 'These results are not on this site'}</h2>
${pending
    ? `<p>We are preparing the ${e(x.CAT)} ${x.year} ${units} and candidate results for Mayobe Bros. The ${unit} list and the candidate search will appear on this page when the data is ready. Until then, the results are published by the National Examinations Council of Tanzania (NECTA) on its own website.</p>`
    : `<p>We could not find the ${e(x.CAT)} ${x.year} candidate results online, so there is no ${unit} list or candidate search here. The National Examinations Council of Tanzania (NECTA) is the official source for exam results.</p>`}
<p><a class="rs-btn" href="${e(official)}" rel="noopener noreferrer" target="_blank">Open the official NECTA results${ICON.external}<span class="rs-sr"> (opens in a new tab)</span></a></p>
${have}
<p class="rs-small">Mayobe Bros is an independent site. It is not run, approved or endorsed by NECTA.</p>
${creditHtml}
</div></div></section>`, 'nodata').replace('data-state="nodata"', `data-state="nodata"${pending ? ' data-pending="1"' : ''}`);
  }

  /* ---- the app ---- */
  const field = (id, label, placeholder, key) => `<div class="rs-field"><label for="${id}">${e(label)}</label><div class="rs-box">${ICON.search}<input class="rs-input" id="${id}" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${e(placeholder)}" data-rs-in="${key}"><button class="rs-clear" type="button" aria-label="Clear ${e(label.toLowerCase())}" data-visible="false">${ICON.x}</button></div></div>`;
  const cphold = `e.g. ${prof.cno}`;
  const skelRow = '<div class="rs-skel-row"><span class="rs-skel rs-skel--ico"></span><span class="rs-skel rs-skel--code"></span><span class="rs-skel rs-skel--line"></span></div>';
  const skel = (n) => Array.from({ length: n }, () => skelRow).join('');
  const azSkel = Array.from({ length: 27 }, () => '<span class="rs-skel rs-skel--az"></span>').join('');

  const exam = `<section class="rs-exam" data-rs-exam>
<div class="rs-tools" data-rs-tools><div class="rs-wrap">
<div class="rs-panel">
<div class="rs-tabs" role="tablist" aria-label="How to search" data-rs-tabs data-tab="name">
<button type="button" role="tab" class="rs-tab" id="rs-tab-name" aria-selected="true" aria-controls="rs-pane-name" tabindex="0" data-rs-tab="name">${ICON.searchTab}<span><span class="rs-tab-by">Search by </span><span class="rs-tab-what">${e(prof.findBy)}</span></span></button>
<button type="button" role="tab" class="rs-tab" id="rs-tab-cand" aria-selected="false" aria-controls="rs-pane-cand" tabindex="-1" data-rs-tab="cand">${ICON.idcard}<span><span class="rs-tab-by">Search by </span><span class="rs-tab-what">candidate number</span></span></button>
<span class="rs-tab-pill" aria-hidden="true"></span>
</div>
<form class="rs-tools-form" data-rs-form role="search" aria-label="Search ${e(x.CAT)} ${x.year}" autocomplete="off">
<div class="rs-panes">
<div class="rs-pane" role="tabpanel" id="rs-pane-name" aria-labelledby="rs-tab-name" data-rs-pane="name">
<div class="rs-pane-fields">
${field('rs-q-name', prof.nameLabel, `e.g. ${prof.name}`, 'q')}
${field('rs-q-code', prof.codeLabel, `e.g. ${prof.code}`, 'code')}
</div>
<div class="rs-az" data-rs-az role="group" aria-label="Filter ${units} by first letter" aria-busy="true">${azSkel}</div>
</div>
<div class="rs-pane" role="tabpanel" id="rs-pane-cand" aria-labelledby="rs-tab-cand" data-rs-pane="cand">
<div class="rs-pane-fields rs-pane-fields--one">
${field('rs-q-cand', 'Candidate number', cphold, 'cand')}
</div>
<p class="rs-hint">Type the full number, for example ${e(prof.cno)}, then press Enter or choose Open result.</p>
</div>
</div>
</form>
</div>
</div></div>
<div class="rs-wrap rs-main">
<div class="rs-status" data-rs-status></div>
<div data-rs-cpanel hidden></div>
<div class="rs-list" data-rs-list aria-busy="true"><div class="rs-skel-only" aria-hidden="true"><div class="rs-cols"><div class="rs-rows">${skel(6)}</div><div class="rs-rows rs-rows--second">${skel(6)}</div></div></div><noscript><p class="rs-empty-static">Search needs JavaScript. You can read the full results on the ${officialLink}.</p></noscript></div>
${browseHtml(x, ctx, units, e)}<section class="rs-about" aria-labelledby="rs-about-h">
<h2 id="rs-about-h">About these results</h2>
<p>This page lists the ${units} in the ${e(x.CAT)} ${x.year} results from the National Examinations Council of Tanzania (NECTA): ${num(ds.total)} ${units} in all, and ${num(ds.online)} of them with results on this site. Open a ${unit} to see how its candidates did, or type a candidate number to go straight to one result.${ds.online < ds.total ? ` The other ${units} are listed, but their results are not on this site.` : ''}</p>
<p>The information is copied from ${ctx.dataset?.archive ? 'the Internet Archive&rsquo;s saved copy of NECTA&rsquo;s own results pages for this year (NECTA&rsquo;s website no longer has them),' : ctx.dataset?.mirror ? 'the Maktaba Tetea copy of NECTA&rsquo;s public results (we could not find this year on NECTA&rsquo;s own results site),' : 'NECTA&rsquo;s public results website'}${verified ? ` and was last checked on ${e(verified)}` : ''}. Mayobe Bros is an independent site. It is not run, approved or endorsed by NECTA. If anything here differs from NECTA, the result published by NECTA is the correct one, so check important results on the ${officialLink}.</p>
<h3>How to read the results</h3>
<ul>
${howToRead(x, prof, e)}
</ul>
${creditHtml}
</section>
</div>
</section>`;

  const centre = centreSectionHtml(x, { e, path, officialLink });

  return root(`${hero}
<div class="rs-stage" data-rs-stage>
${exam}
${centre}
</div>
<p class="rs-sr" role="status" aria-live="polite" aria-atomic="true" data-rs-live></p>`, 'ready');
}
