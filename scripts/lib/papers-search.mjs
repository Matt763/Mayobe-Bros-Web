// The search bar under the hero of the "Examination Past Papers" label page (and its exam sections): Level | Subject | Year | Search, with the
// best five matches listed just below it as you type. Plain HTML made at build time; js/papers-search.js adds the behaviour (and loads
// data/papers-index.json, written by scripts/build.mjs, the first time the reader of the page touches the bar). Nothing is inserted unescaped.
//
//   papersSearchHtml({ u, e, indexUrl, pdfBase, trust, postPath, levels, groups }) -> string
//   levels: [{ id, name, group? }]   groups: { groupId: "Heading" }   postPath: '/post/.../necta-{exam}-past-papers-{year}/' (the two words in braces are filled in by the script)
// The subject list is a child of the card (not of the field) so that it can be as wide as the card: a long subject name never wraps in a narrow strip
// (css/papers-search.css places it in the grid, under the subject field). On small screens the fields stack as Level, Year, Subject.
// There is no Search button (the search is live and Enter sends it); a Clear button takes its place and opens only while something is typed, chosen or being chosen (.is-dirty).
// Level and Year are drawn by the site's own list (a button that opens a listbox, see js/papers-search.js), not by the browser's picker: in the Level list the
// heading of a group (O-Level) is a choice itself, which a native list cannot do. The choices are written here too, so the first paint is already right.
import { ic } from './papers-app.mjs';
import { levelChoices } from '../../js/papers-core.js';

const optionHtml = (key, c, i, selected, e) => `<li id="pps-${key}-list-${i}" role="option" class="pps-option pps-lv pps-lv--${c.cls}" data-v="${e(c.value)}" aria-selected="${selected}"><span>${e(c.label)}</span></li>`;
export function levelOptionsHtml(levels, groups, e) {
  return levelChoices(levels, groups, null).map((c, i) => optionHtml('level', c, i, i === 0, e)).join('');
}
const selectHtml = (key, label, first, items) => `<div class="pps-field pps-field--${key}"><label class="pps-label" id="pps-${key}-l" for="pps-${key}">${label}</label><span class="pps-select" data-pps-select="${key}"><button type="button" class="pps-control pps-selbtn" id="pps-${key}" data-pps-sel-btn role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="pps-${key}-list" aria-labelledby="pps-${key}-l pps-${key}"><span class="pps-selname" data-pps-sel-name>${first}</span></button>${ic('chevron', 'pps-ico pps-ico--caret')}<ul class="pps-options pps-sel-list" id="pps-${key}-list" data-pps-sel-list role="listbox" aria-labelledby="pps-${key}-l" hidden>${items}</ul></span></div>`;

export function papersSearchHtml({ u, e, indexUrl, pdfBase, trust = [], postPath, levels, groups = {} }) {
  return `<section class="pps" data-pps data-index="${e(indexUrl)}" data-pdf-base="${e(pdfBase)}" data-trust="${e(trust.join(' '))}" data-post="${e(postPath)}" aria-labelledby="pps-h">
<h2 class="pps-sr" id="pps-h">Find a past paper</h2>
<form class="pps-form" data-pps-form role="search" aria-labelledby="pps-h" novalidate>
<div class="pps-card">
${selectHtml('level', 'Level', 'All levels', levelOptionsHtml(levels, groups, e))}
${selectHtml('year', 'Year', 'All years', optionHtml('year', { value: '', label: 'All years', cls: 'all' }, 0, true, e))}
<div class="pps-field pps-field--subject"><label class="pps-label" for="pps-subject">Subject</label><div class="pps-combo" data-pps-combo>${ic('search', 'pps-ico pps-ico--lead')}<input class="pps-control pps-input" id="pps-subject" data-pps-subject type="text" role="combobox" aria-expanded="false" aria-controls="pps-subject-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Any subject, e.g. Physics"><button type="button" class="pps-clear" data-pps-clear aria-label="Clear subject" hidden>${ic('x', 'pps-ico')}</button></div></div>
<div class="pps-clearwrap" data-pps-clearwrap><div><button type="button" class="pps-clearall" data-pps-clearall aria-label="Clear level, year and subject">${ic('x', 'pps-ico')}<span>Clear</span></button></div></div>
<ul class="pps-options pps-subject-list" id="pps-subject-list" data-pps-options role="listbox" aria-label="Subjects" hidden></ul>
</div>
</form>
<p class="pps-sr" role="status" aria-live="polite" data-pps-live></p>
<div class="pps-out" data-pps-out hidden>
<div class="pps-out-in" data-pps-out-in>
<p class="pps-count" role="status" aria-live="polite" data-pps-count></p>
<ol class="pps-results" data-pps-results aria-label="Matching past papers"></ol>
<div class="pps-empty" data-pps-empty hidden></div>
<div class="pps-error" data-pps-error hidden><p>The past papers could not be loaded.</p><button type="button" class="pps-btn pps-btn--line" data-pps-retry>Try again</button></div>
<div class="pps-foot"><button type="button" class="pps-more" data-pps-more hidden>Show 5 more</button></div>
</div>
</div>
</section>`;
}
