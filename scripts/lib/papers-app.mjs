// The body of an "Examination Past Papers" post (front matter `app: papers`): hero with the year's cover, three counts, a quick filter and one
// card per subject with a View paper / View solution button for every paper. Pure: no file or network access, everything inserted is escaped.
// The page is plain HTML made from content/papers-manifest.json, so search engines and readers without script see every subject and paper;
// js/papers-app.js adds the filter, the entrance motion and the reader (js/papers-reader.js). No inline script and no style="" attribute (the page's CSP).
//
//   papersAppHtml(post, ctx) -> string for inside <main id="main">
//   post: { slug, app: { cat, year, dataset: { subjects, nSubjects, papers, solutions } }, title }
//   ctx:  { u, e, image, imageAlt, siblings: [{ year, href }], labelHref, pdfBase, trust }

export const EXAMS = {
  csee: { abbr: 'CSEE', name: 'Certificate of Secondary Education Examination', who: 'Form Four', group: 'olevel' },
  acsee: { abbr: 'ACSEE', name: 'Advanced Certificate of Secondary Education Examination', who: 'Form Six', group: 'alevel' },
  psle: { abbr: 'PSLE', name: 'Primary School Leaving Examination', who: 'Standard Seven', group: 'primary' },
  ftna: { abbr: 'FTNA', name: 'Form Two National Assessment', who: 'Form Two', group: 'olevel' },
  // Qualifying Test: NECTA's test for private candidates, listed under O-Level in the search bar (owner's request 2026-11-12)
  qt: { abbr: 'QT', name: 'Qualifying Test', who: 'Private candidates', group: 'olevel' },
  // Teachers Education: the three teacher-college examinations NECTA sets (group "teachers"); names as printed on the papers and on NECTA's lists
  gatce: { abbr: 'GATCE', name: 'Grade A Teacher Certificate Examination', who: 'Teachers Education', group: 'teachers' },
  dsee: { abbr: 'DSEE', name: 'Diploma in Secondary Education Examination', who: 'Teachers Education', group: 'teachers' },
  dtee: { abbr: 'DTEE', name: 'Diploma in Technical Education Examination', who: 'Teachers Education', group: 'teachers' },
};
// Groups of exams in the search bar's Level list (owner's request 2026-11-12: make Primary, O-Level and A-Level clear): every exam sits under one heading,
// and the group itself can be chosen ("All O-Level"). The group's id is also a valid `state.level` in js/papers-core.js.
export const GROUPS = { primary: 'Primary Level', olevel: 'O-Level', alevel: 'A-Level', teachers: 'Teachers Education' };
// The search bar (Level list and the order of results within a year) follows school order, like the owner's papers project; Teachers Education comes last.
export const SEARCH_ORDER = ['psle', 'ftna', 'csee', 'qt', 'acsee', 'gatce', 'dsee', 'dtee'];

const svg = (inner, cls = 'pp-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
// Lucide-style icons (lucide.dev, ISC licence), drawn inline: one stroke weight, one 24 x 24 grid
const I = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
  atom: '<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
  flask: '<path d="M9 3h6M10 3v6L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9V3"/><path d="M7.5 15h9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 4 13c0-6 6-9 15-9 0 9-3 15-9 15"/><path d="M4 20c2-5 5-8 9-10"/>',
  landmark: '<path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M2 10l10-6 10 6z"/>',
  lang: '<path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 3-2.6 6.3-7 8M13 21l4.2-10L21.5 21M14.7 17.5h5"/>',
  scale: '<path d="M12 3v18M6 21h12M5 7h14M5 7l-3 8a4 4 0 0 0 6 0zM19 7l-3 8a4 4 0 0 0 6 0z"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 8.4A6 6 0 1 1 8.4 15.5M7 9h4M9 7v4"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5.7 5.5 5.5 0 0 0 2 8.5C2 14 12 21 12 21s5.2-3.6 7-7z"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.4-.6-.6-2.4z"/>',
  home: '<path d="M3 11 12 3l9 8M5 10v10h14V10M10 20v-6h4v6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.01"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h5"/>',
};
export const ic = (n, cls) => svg(I[n] || I.book, cls);

// a subject name -> an icon (a few plain keywords; everything else gets the open book)
const SUBJECT_ICONS = [
  [/math|hisabati|arithmetic/i, 'calc'], [/physic|fizikia/i, 'atom'], [/chem|kemia/i, 'flask'], [/biolog|science|sayansi|baiolojia|health/i, 'leaf'],
  [/geograph|jiografia|maarifa/i, 'globe'], [/histor|historia/i, 'landmark'], [/english|kiswahili|french|arabic|language|literature|fasihi|lugha/i, 'lang'],
  [/civic|uraia|maadili|social/i, 'scale'], [/commerce|book keeping|bookkeeping|account|econom|biashara|business/i, 'coins'], [/computer|information|ict|tehama|software/i, 'monitor'],
  [/agricultur|kilimo|food|nutrition|domestic|home/i, 'leaf'], [/bible|islam|religion|divinity|dini|elimu ya dini|christian/i, 'heart'], [/technical|engineer|drawing|wood|electric|mechanic|fundi|building|welding/i, 'tools'],
];
const iconFor = (name) => (SUBJECT_ICONS.find(([re]) => re.test(name)) || [0, 'book'])[1];
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function papersAppHtml(post, ctx) {
  const { u, e } = ctx;
  const a = post.app, ex = EXAMS[a.cat], ds = a.dataset;
  const title = `NECTA ${ex.abbr} Past Papers ${a.year}`;
  const sols = ds.solutions;
  const lead = `${plural(ds.papers, 'question paper', 'question papers')} from the ${ex.name} (${ex.who}) set by NECTA in ${a.year}, across ${plural(ds.nSubjects, 'subject', 'subjects')}${sols ? `. ${plural(sols, 'has', 'have')} a worked solution` : '. None has a published solution yet'}. Every paper opens in the reader on this page.`;
  const stats = [['Subjects', ds.nSubjects], ['Papers', ds.papers], ['Solutions', sols]]
    .map(([l, v]) => `<div class="pp-stat"><dt>${l}</dt><dd>${v.toLocaleString('en-US')}</dd></div>`).join('');

  // the closest years of the same exam (like the owner's papers site): up to 8, newest first
  const sib = (ctx.siblings || []).filter((s) => s.year !== a.year).sort((x, y) => Math.abs(x.year - a.year) - Math.abs(y.year - a.year) || y.year - x.year).slice(0, 8).sort((x, y) => y.year - x.year);
  const years = sib.length
    ? `<nav class="pp-years" aria-label="Other ${e(ex.abbr)} years"><span class="pp-years-l">Other ${e(ex.abbr)} years</span><ul>${sib.map((s) => `<li><a class="pp-chip-link" href="${e(s.href)}">${s.year}</a></li>`).join('')}</ul></nav>`
    : '';

  const hero = `<section class="pp-hero" data-pp-hero>
<img class="pp-hero-bg" src="${e(ctx.image)}" alt="" width="1400" height="788" loading="lazy" decoding="async" fetchpriority="low">
<div class="pp-wrap pp-hero-grid">
<div class="pp-hero-copy">
<p class="pp-eyebrow"><span>${e(ex.name)}</span></p>
<h1 class="pp-h1" data-pp-title>${e(title)}</h1>
<p class="pp-lead">${e(lead)}</p>
<dl class="pp-stats" aria-label="What is on this page">${stats}</dl>
${years}
</div>
<figure class="pp-cover" data-pp-cover><img class="pp-cover-img" src="${e(ctx.image)}" width="1400" height="788" alt="${e(ctx.imageAlt || title)}" decoding="async" fetchpriority="high"></figure>
</div>
</section>`;

  const btnPaper = `<button type="button" class="pp-btn pp-btn--fill" data-act="open" data-kind="paper">${ic('eye', 'pp-ico pp-ico--btn')}<span>View paper</span></button>`;
  const btnSol = `<button type="button" class="pp-btn pp-btn--line" data-act="open" data-kind="solution">${ic('check', 'pp-ico pp-ico--btn')}<span>View solution</span></button>`;
  const btnOrig = `<button type="button" class="pp-btn pp-btn--line" data-act="open" data-kind="original">${ic('doc', 'pp-ico pp-ico--btn')}<span>Original scan</span></button>`;

  const cards = ds.subjects.map(([name, items], si) => {
    const hasSol = items.some((it) => it[3]);
    const rows = items.map(([chip, paper, pages, sol, solPages, orig]) => {
      const attrs = `data-t="${e(`${name} · ${chip}`)}"${paper ? ` data-p="${e(paper)}"` : ''}${sol ? ` data-s="${e(sol)}"` : ''}${orig ? ` data-o="${e(orig)}"` : ''}`;
      const meta = [paper && pages ? plural(pages, 'page', 'pages') : '', orig ? 'retyped' : ''].filter(Boolean).join(' · ');
      return `<li class="pp-row" ${attrs}><div class="pp-row-name"><span class="pp-chip">${e(chip)}</span>${meta ? `<span class="pp-meta">${e(meta)}</span>` : ''}</div><div class="pp-actions">${paper ? btnPaper : '<span class="pp-none">Paper not available</span>'}${sol ? btnSol : '<span class="pp-none">No solution available</span>'}${orig ? btnOrig : ''}</div></li>`;
    }).join('');
    return `<li class="pp-card" data-name="${e(name.toLowerCase())}" data-sol="${hasSol ? 1 : 0}" id="s-${e(slugOf(name))}"><div class="pp-card-head"><span class="pp-subject-ico">${ic(iconFor(name))}</span><h2 class="pp-card-title">${e(name)}</h2><span class="pp-count">${plural(items.length, 'paper', 'papers')}</span></div><ul class="pp-rows">${rows}</ul></li>`;
  }).join('\n');

  const tools = `<div class="pp-tools" data-pp-tools hidden>
<label class="pp-search"><span class="pp-sr">Find a subject</span>${ic('search', 'pp-ico pp-ico--lead')}<input type="search" data-pp-q placeholder="Find a subject, e.g. Physics" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="button" class="pp-clear" data-pp-clear aria-label="Clear" hidden>${ic('x')}</button></label>
<div class="pp-seg" role="group" aria-label="Show"><button type="button" class="pp-seg-btn" data-pp-filter="all" aria-pressed="true">All subjects</button><button type="button" class="pp-seg-btn" data-pp-filter="sol" aria-pressed="false">With solutions</button><span class="pp-seg-pill" aria-hidden="true"></span></div>
<p class="pp-status" role="status" aria-live="polite" data-pp-status></p>
</div>`;

  return `<div class="pp" data-pp data-exam="${e(a.exam)}" data-pdf-base="${e(ctx.pdfBase)}" data-trust="${e((ctx.trust || []).join(' '))}" data-ctx="${e(`NECTA ${ex.abbr} ${a.year}`)}">
${hero}
<section class="pp-body"><div class="pp-wrap">
<noscript><p class="pp-noscript">Turn on JavaScript to read the papers on this page.</p></noscript>
${tools}
<ul class="pp-grid" data-pp-grid>
${cards}
</ul>
<p class="pp-empty" data-pp-empty hidden>No subject matches. Try a shorter word.</p>
<p class="pp-back"><a class="pp-back-link" href="${e(ctx.labelHref)}">${ic('arrow', 'pp-ico')}All examination past papers</a></p>
</div></section>
</div>`;
}
