// Small helpers shared by the Worker modules. No dependencies.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const NEEDS = /[&<>"']/;
const NEEDS_G = /[&<>"']/g;

/** HTML escape for text and attribute values. Everything that comes from data or from the address goes through this. */
export function esc(s) {
  s = s == null ? '' : String(s);
  return NEEDS.test(s) ? s.replace(NEEDS_G, (c) => MAP[c]) : s;
}

export const fmt = (n) => Number(n).toLocaleString('en');

/** Whole percent (rounded) of part/whole, or null when whole is 0. */
export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Percentage with one decimal for the year table. */
export const pct1 = (part, whole) => (whole > 0 ? (Math.round((part / whole) * 1000) / 10).toFixed(1) : null);

/** Lower case words and hyphens, for region and district addresses. */
export function slug(s) {
  return String(s).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The letter a centre is filed under in the A to Z lists (same rule as js/results-app.js). */
export function letterOf(name) {
  const m = /[A-Za-z0-9]/.exec(String(name));
  return m && /[A-Za-z]/.test(m[0]) ? m[0].toUpperCase() : '#';
}
export const letterSlug = (L) => (L === '#' ? 'other' : L.toLowerCase());
export const slugLetter = (s) => (s === 'other' ? '#' : /^[a-z]$/.test(s) ? s.toUpperCase() : null);

export const EXAMS = {
  csee: { name: 'Certificate of Secondary Education Examination', short: 'CSEE', kind: 'secondary' },
  acsee: { name: 'Advanced Certificate of Secondary Education Examination', short: 'ACSEE', kind: 'secondary' },
  psle: { name: 'Primary School Leaving Examination', short: 'PSLE', kind: 'primary' },
  ftna: { name: 'Form Two National Assessment', short: 'FTNA', kind: 'secondary' },
  sfna: { name: 'Standard Four National Assessment', short: 'SFNA', kind: 'primary' },
  dsee: { name: 'Diploma in Secondary Education Examinations', short: 'DSEE', kind: 'secondary' },
  dpee: { name: 'Teachers college diploma examination (DPEE)', short: 'DPEE', kind: 'secondary' },
  dppee: { name: 'Teachers college diploma examination (DPPEE)', short: 'DPPEE', kind: 'secondary' },
  dspee: { name: 'Teachers college diploma examination (DSPEE)', short: 'DSPEE', kind: 'secondary' },
  dte: { name: 'Diploma in Technical Education', short: 'DTE', kind: 'secondary' },
  qt: { name: 'Qualifying Test', short: 'QT', kind: 'secondary' },
};

export const PER_PAGE = 200;
export const MIN_SAT = 20;

/**
 * How each exam is called by the people who search for it (research 2026-11-17, docs in ~/necta-work/recon/seo/02-keywords-tanzania.md):
 *   plain  the level in the words used in a description ("Form Four (CSEE)"),
 *   h1     the same for a heading,
 *   tail   what follows "Results <year>:" in a title, first choice (the exam's level in plain words plus the acronym),
 *   lite   the shorter tail used when the first one does not fit (null = skip that step),
 *   sw     the Swahili words people search with, written as one phrase in the page text (null = none known for this exam).
 * QT, DSEE and DTE always carry a second word because the bare acronym means something else to other people. NECTA publishes no long form
 * for DPEE, DPPEE, DSPEE or DTE, so none is printed here.
 */
const TEACHERS = (x) => ({ plain: `Teachers’ Exam (${x})`, h1: `Teachers’ Exam (${x})`, tail: `Teachers’ Exam ${x}`, lite: null, sw: 'matokeo ya ualimu' });
export const LEVELS = {
  csee: { plain: 'Form Four (CSEE)', h1: 'Form Four (CSEE)', tail: 'Form Four CSEE', lite: 'Form Four', sw: 'matokeo ya kidato cha nne' },
  acsee: { plain: 'Form Six (ACSEE)', h1: 'Form Six (ACSEE)', tail: 'Form Six ACSEE', lite: 'Form Six', sw: 'matokeo ya kidato cha sita' },
  ftna: { plain: 'Form Two (FTNA)', h1: 'Form Two (FTNA)', tail: 'Form Two FTNA', lite: 'Form Two', sw: 'matokeo ya kidato cha pili' },
  psle: { plain: 'Standard Seven (PSLE)', h1: 'Standard Seven (PSLE)', tail: 'Darasa la Saba PSLE', lite: 'Darasa la Saba', sw: 'matokeo ya darasa la saba' },
  sfna: { plain: 'Standard Four (SFNA)', h1: 'Standard Four (SFNA)', tail: 'Darasa la Nne SFNA', lite: 'Darasa la Nne', sw: 'matokeo ya darasa la nne' },
  qt: { plain: 'Qualifying Test (QT)', h1: 'Qualifying Test (QT)', tail: 'NECTA QT', lite: null, sw: 'matokeo ya mtihani wa maarifa (QT)' },
  dsee: TEACHERS('DSEE'),
  dpee: TEACHERS('DPEE'),
  dppee: TEACHERS('DPPEE'),
  dspee: TEACHERS('DSPEE'),
  dte: { plain: 'DTE', h1: 'DTE', tail: 'NECTA DTE', lite: null, sw: null },
};

/** Advance widths of the printable ASCII characters in Arial, in 1/1000 em (measured from Liberation Sans, which has Arial's metrics). */
const ARIAL = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
/** The width of a title in pixels at Google's desktop size (Arial 20 px). An estimate: Google publishes no limit, it cuts to the device width. */
export function titleWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c <= 126 ? ARIAL[c - 32] : c === 0x2019 || c === 0x2018 ? 222 : 600; // other letters: about a capital's width
  }
  return Math.round((w * 20) / 1000);
}
/** Titles that fit this width in full are shown whole (measured on the real names: see the SEO notes). */
export const TITLE_PX = 580;

/** Fast 32-bit hash (FNV-1a) for cache keys. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
