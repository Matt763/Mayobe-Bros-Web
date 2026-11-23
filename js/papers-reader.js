// In-site PDF reader (pdf.js 6.x, vendored).
//   import { openReader, closeReader } from '/js/papers-reader.js';
//   const r = openReader({ docs: [{ kind: 'paper', url: '/pdf/<id>.pdf' }, { kind: 'solution', url: '/pdf/<id>.pdf' }], index: 0, title: 'Physics 1', subtitle: 'CSEE 2016', trust: ['https://files.example'] });
//   await r.ready; r.close();
// Only .pdf URLs on this site (or on an origin listed in `trust`) are accepted. The Paper | Solution switch in the title bar swaps the document in place.
// Download hands the reader's own copy of the file to the browser (Ctrl/Cmd+S); Print draws the chosen pages at 150 dpi into a hidden sheet and calls
// window.print() (Ctrl/Cmd+P): nothing is sent anywhere.
// Tiny element builder (the same shape the rest of the site's scripts use).
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'hidden') el.hidden = true;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const BASE = new URL('../vendor/pdfjs/', import.meta.url);
const CSS_URL = new URL('../css/papers-reader.css', import.meta.url).href;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const ZOOM_MIN = 0.25, ZOOM_MAX = 5, FIT_WIDTH_MAX = 1.6;
const KEEP_CANVAS = 2;   // pages either side of the visible ones that keep their canvas (1 on phones: canvas memory)
const KEEP_TEXT = 6;     // ... and their text layer
const KIND_LABEL = { paper: 'Paper', solution: 'Solution', original: 'Original scan', syllabus: 'Syllabus' };
let TRUST = [];
const PREF_KEY = 'mayobebros-reader';

let libPromise = null, cssPromise = null, active = null;
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

/* ---------------- loading of pdf.js and the stylesheet ---------------- */
function modernOK() {
  return typeof Promise.withResolvers === 'function' && typeof Map.prototype.getOrInsertComputed === 'function';
}
function loadLib() {
  if (!libPromise) {
    const dir = modernOK() ? BASE : new URL('legacy/', BASE);
    libPromise = import(new URL('pdf.min.mjs', dir).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', dir).href;
      return lib;
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}
function loadCSS() {
  if (!cssPromise) {
    cssPromise = new Promise((resolve) => {
      const have = [...document.styleSheets].some((s) => s.href === CSS_URL);
      if (have) return resolve();
      const link = h('link', { rel: 'stylesheet', href: CSS_URL });
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => { cssPromise = null; link.remove(); resolve(); }, { once: true });
      setTimeout(resolve, 4000);
      document.head.append(link);
    });
  }
  return cssPromise;
}

/** Same-origin http(s) URL whose path ends in .pdf, else null. */
function safeUrl(url) {
  try {
    const u = new URL(String(url), location.href);
    if ((u.origin !== location.origin && !TRUST.includes(u.origin)) || !/^https?:$/.test(u.protocol)) return null;
    if (!/\.pdf$/i.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}

/* ---------------- icons (static SVG markup, no inline styles) ---------------- */
const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  prev: '<path d="M18 15l-6-6-6 6"/>',
  next: '<path d="M6 9l6 6 6-6"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  fitw: '<path d="M4 6v12M20 6v12M8 12h8M8 12l2.5-2.5M8 12l2.5 2.5M16 12l-2.5-2.5M16 12l-2.5 2.5"/>',
  fitp: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  thumbs: '<rect x="3.5" y="4" width="7" height="7" rx="1.2"/><rect x="13.5" y="4" width="7" height="7" rx="1.2"/><rect x="3.5" y="14" width="7" height="6" rx="1.2"/><rect x="13.5" y="14" width="7" height="6" rx="1.2"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  more: '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  caret: '<path d="M7 10l5 5 5-5"/>',
  warn: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.2v.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  download: '<path d="M12 4v11M7.5 10.8 12 15.3l4.5-4.5M5 19.5h14"/>',
  print: '<path d="M7 9V3.8h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.2H7z"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.5-2.8 4.2M12 17.6v.01"/>',
};

/* What the help panel lists. In a key cell " | " separates alternatives and " + " joins keys pressed together. Keep it in step with onKey(), onDocKey() and setupPointers(). */
const HELP_KEYS = [
  ['N | J | Page Down', 'Next page'],
  ['P | K | Page Up', 'Previous page'],
  ['← | →', 'Previous or next page (when the page is not zoomed in sideways)'],
  ['Home | End', 'First or last page'],
  ['G', 'Go to a page number'],
  ['Space | Shift + Space', 'Scroll down or up one screen'],
  ['↑ | ↓', 'Scroll a little'],
  ['+ | −', 'Zoom in or out'],
  ['W | 0', 'Fit the page width'],
  ['A', 'Fit the whole page'],
  ['/ | Ctrl + F', 'Find in the document'],
  ['Enter | Shift + Enter', 'Next or previous match while finding'],
  ['T', 'Page thumbnails'],
  ['D', 'Dark reading mode'],
  ['F', 'Full screen'],
  ['Ctrl + S', 'Download the PDF'],
  ['Ctrl + P', 'Print'],
  ['?', 'Show or hide this list'],
  ['Esc | Backspace', 'Go back one step: close this list, a menu or the search bar, and last of all the reader'],
];
const HELP_TOUCH = [
  ['Pinch with two fingers', 'Zoom in or out'],
  ['Double-tap', 'Zoom to the page width, or to twice that. Double-tap again to go back'],
  ['Swipe left or right', 'Next or previous page. It works in the Fit page view, or with a quick flick, and not while the page is zoomed in sideways'],
  ['Tap the page', 'Show or hide the top and bottom bars (phones and tablets)'],
  ['Drag with one finger', 'Scroll, or move around a zoomed page'],
  ['Ctrl + mouse wheel', 'Zoom in or out'],
];
const HELP_NOTE = 'Every gesture also has a button. Previous, Next, the zoom buttons, Fit width and Fit page do the same.';
// the keys each control answers to, for screen readers (aria-keyshortcuts)
const KEYSHORTCUTS = { close: 'Escape Backspace', thumbs: 'T', prev: 'PageUp P K', next: 'PageDown N J', zoomIn: '+', zoomOut: '-', fitWidth: 'W 0', fitPage: 'A', search: '/ Control+F', download: 'Control+S', print: 'Control+P', dark: 'D', fullscreen: 'F', help: '?' };
// swipe to change page: how far, how clearly sideways, how fast
const SWIPE_LOCK = 10, SWIPE_FAR = 56, SWIPE_FLICK_DIST = 48, SWIPE_FLICK_SPEED = 0.55, SWIPE_ANGLE = 1.8, SWIPE_NUDGE_MAX = 44;
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}
const btn = (act, label, ic, extra = {}) =>
  h('button', { type: 'button', class: 'ppr__btn' + (extra.cls ? ' ' + extra.cls : ''), 'data-act': act, 'aria-label': label, title: extra.title ?? label, ...extra.attrs }, icon(ic));

/* ---------------- public API ---------------- */
export function closeReader() { if (active) active.close(); }

export function openReader({ docs = [], index = 0, title = 'Document', subtitle = '', trust = [], onClose } = {}) {
  TRUST = trust.map((t) => { try { return new URL(t, location.href).origin; } catch { return ''; } }).filter(Boolean);
  const list = docs.map((d) => ({ kind: String(d.kind || ''), href: safeUrl(d.url) })).filter((d) => d.href);
  if (!list.length) throw new TypeError('openReader: only .pdf URLs on this site (or a trusted host) can be opened');
  const at = Math.max(0, Math.min(list.length - 1, index | 0));
  const href = list[at].href, kind = list[at].kind;
  let opener = document.activeElement;
  let pushed = false;
  if (active) { opener = active.opener || opener; pushed = active.pushed; active.pushed = false; active.close({ restoreFocus: false, silent: true }); }
  const r = new Reader({ href, docs: list, docIndex: at, title: String(title), subtitle: String(subtitle || ''), kind, onClose, opener, pushed });
  active = r;
  r.ready.catch(() => {}); // callers may ignore ready; never surface as an unhandled rejection
  return { close: () => r.close(), ready: r.ready };
}

/* ---------------- the reader ---------------- */
class Reader {
  constructor(o) {
    Object.assign(this, o);
    this.ac = new AbortController();
    this.pages = [];
    this.zoom = 1; this.mode = 'width';
    this.current = 1;
    this.closed = false;
    this.renderQueue = new Set();
    this.search = { q: '', matches: [], cur: -1, token: 0 };
    this.textCache = new Map();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
    this.maxPixels = this.phone ? 4194304 : 16777216;
    this.keepCanvas = this.phone ? 1 : KEEP_CANVAS;
    let dark = false; try { dark = localStorage.getItem(PREF_KEY) === '1'; } catch {}
    this.dark = dark;
    const ready = defer();
    this.ready = ready.promise; this._ready = ready;
    this.build();
    this.mount();
    this.load();
  }

  /* ----- DOM ----- */
  build() {
    const id = 'ppr-' + Math.random().toString(36).slice(2, 8);
    this.ids = { title: id + '-t', pages: id + '-p', search: id + '-s', thumbs: id + '-th', more: id + '-m', zoom: id + '-z', print: id + '-pr', help: id + '-hp' };
    const kindLabel = KIND_LABEL[this.kind];
    this.pageInput = h('input', { class: 'ppr__pagein num', type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'go', 'aria-label': 'Page number', value: '1', 'data-role': 'pagein' });
    this.pageCount = h('span', { class: 'ppr__pagecount num', 'aria-hidden': 'true' }, '/ –');
    this.zoomLabel = h('span', { class: 'num' }, '100%');
    const zoomItems = [['fitWidth', 'Fit width'], ['fitPage', 'Fit page']].map(([a, l]) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': 'false', class: 'ppr__mi', 'data-act': a }, l))
      .concat([0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': 'false', class: 'ppr__mi num', 'data-act': 'zoomTo', 'data-zoom': z }, Math.round(z * 100) + '%')));
    this.zoomMenu = h('div', { class: 'ppr__menu ppr__menu--zoom', role: 'menu', id: this.ids.zoom, 'aria-label': 'Zoom', hidden: true }, zoomItems);
    const mi = (act, label, ic, extra = {}) => h('button', { type: 'button', class: 'ppr__mi', role: extra.role || 'menuitem', 'data-act': act, ...extra.attrs }, icon(ic), h('span', null, label));
    this.moreMenu = h('div', { class: 'ppr__menu ppr__menu--more', role: 'menu', id: this.ids.more, 'aria-label': 'More options', hidden: true },
      mi('thumbs', 'Page thumbnails', 'thumbs', { role: 'menuitemcheckbox', attrs: { 'aria-checked': 'false' } }),
      mi('fitWidth', 'Fit width', 'fitw', { role: 'menuitemradio', attrs: { 'aria-checked': 'false' } }),
      mi('fitPage', 'Fit page', 'fitp', { role: 'menuitemradio', attrs: { 'aria-checked': 'false' } }),
      mi('download', 'Download PDF', 'download'),
      mi('print', 'Print…', 'print'),
      mi('dark', 'Dark reading mode', 'moon', { role: 'menuitemcheckbox', attrs: { 'aria-checked': 'false' } }),
      mi('fullscreen', 'Full screen', 'full', { role: 'menuitemcheckbox', attrs: { 'aria-checked': 'false', 'data-needs': 'fs' } }),
      mi('help', 'Shortcuts and gestures', 'help', { attrs: { 'aria-haspopup': 'dialog' } }));

    const pageGroup = (cls) => h('div', { class: 'ppr__group ppr__pager ' + cls },
      btn('prev', 'Previous page', 'prev', { title: 'Previous page (P)' }),
      h('label', { class: 'ppr__pagebox' }, cls === 'is-top' ? this.pageInput : this.pageInput2 = this.pageInput.cloneNode(), cls === 'is-top' ? this.pageCount : this.pageCount2 = this.pageCount.cloneNode(true)),
      btn('next', 'Next page', 'next', { title: 'Next page (N)' }));
    const zoomGroup = (cls) => h('div', { class: 'ppr__group ppr__zoom ' + cls },
      btn('zoomOut', 'Zoom out', 'minus', { title: 'Zoom out (−)' }),
      cls === 'is-top'
        ? h('button', { type: 'button', class: 'ppr__btn ppr__pct', 'data-act': 'zoomMenu', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': this.ids.zoom, 'aria-label': 'Zoom level', title: 'Zoom level' }, this.zoomLabel, icon('caret'))
        : (this.zoomLabel2 = h('span', { class: 'ppr__pct2 num', 'aria-hidden': 'true' }, '100%')),
      btn('zoomIn', 'Zoom in', 'plus', { title: 'Zoom in (+)' }));

    this.titleEl = h('div', { class: 'ppr__titles' },
      h('div', { class: 'ppr__titlerow' },
        h('h2', { class: 'ppr__title', id: this.ids.title }, this.title),
        this.docs.length > 1
          ? h('div', { class: 'ppr__kinds', role: 'group', 'aria-label': 'Which document' }, this.docs.map((d, i) => h('button', { type: 'button', class: 'ppr__kind', 'data-act': 'kind', 'data-i': i, 'aria-pressed': String(i === this.docIndex) }, KIND_LABEL[d.kind] || 'Document')))
          : (kindLabel ? h('span', { class: 'ppr__chip ppr__chip--' + this.kind }, kindLabel) : null)),
      this.subtitle ? h('p', { class: 'ppr__sub' }, this.subtitle) : null);

    this.bar = h('header', { class: 'ppr__bar' },
      btn('close', 'Close reader', 'back', { cls: 'ppr__back', title: 'Close reader (Esc or Backspace)' }),
      this.titleEl,
      h('div', { class: 'ppr__tools' },
        btn('thumbs', 'Page thumbnails', 'thumbs', { cls: 'is-wide', title: 'Page thumbnails (T)', attrs: { 'aria-pressed': 'false', 'aria-controls': this.ids.thumbs } }),
        h('span', { class: 'ppr__sep is-wide', 'aria-hidden': 'true' }),
        pageGroup('is-top'),
        h('span', { class: 'ppr__sep is-wide', 'aria-hidden': 'true' }),
        h('div', { class: 'ppr__menuwrap is-wide' }, zoomGroup('is-top'), this.zoomMenu),
        btn('fitWidth', 'Fit width', 'fitw', { cls: 'is-wide', title: 'Fit width (W)', attrs: { 'aria-pressed': 'false' } }),
        btn('fitPage', 'Fit page', 'fitp', { cls: 'is-wide', title: 'Fit page (A)', attrs: { 'aria-pressed': 'false' } }),
        h('span', { class: 'ppr__sep is-wide', 'aria-hidden': 'true' }),
        btn('search', 'Search in document', 'search', { title: 'Search (/)', attrs: { 'aria-expanded': 'false', 'aria-controls': this.ids.search } }),
        btn('download', 'Download PDF', 'download', { cls: 'is-wide', title: 'Download (Ctrl+S)' }),
        btn('print', 'Print', 'print', { cls: 'is-wide', title: 'Print (Ctrl+P)', attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': this.ids.print } }),
        btn('dark', 'Dark reading mode', 'moon', { cls: 'is-wide', title: 'Dark reading mode (D)', attrs: { 'aria-pressed': 'false' } }),
        btn('fullscreen', 'Full screen', 'full', { cls: 'is-wide', title: 'Full screen (F)', attrs: { 'aria-pressed': 'false', 'data-needs': 'fs' } }),
        btn('help', 'Shortcuts and gestures', 'help', { cls: 'is-wide', title: 'Shortcuts and gestures (?)', attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': this.ids.help } }),
        h('div', { class: 'ppr__menuwrap is-narrow' },
          btn('more', 'More options', 'more', { attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': this.ids.more } }),
          this.moreMenu)));

    this.progress = h('div', { class: 'ppr__progress', 'aria-hidden': 'true' }, this.progressFill = h('div', { class: 'ppr__progressfill' }));

    this.searchInput = h('input', { class: 'ppr__searchin', type: 'search', placeholder: 'Find in document', 'aria-label': 'Find in document', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'data-role': 'search' });
    this.searchCount = h('span', { class: 'ppr__searchcount num', role: 'status', 'aria-live': 'polite' });
    this.searchBar = h('div', { class: 'ppr__search', id: this.ids.search, role: 'search', hidden: true },
      icon('search'), this.searchInput, this.searchCount,
      btn('searchPrev', 'Previous match', 'up', { title: 'Previous match (Shift+Enter)' }),
      btn('searchNext', 'Next match', 'down', { title: 'Next match (Enter)' }),
      btn('searchClose', 'Close search', 'close'));

    this.buildPrintPanel();
    this.buildHelpPanel();

    this.thumbList = h('ol', { class: 'ppr__thumblist' });
    this.thumbs = h('nav', { class: 'ppr__thumbs', id: this.ids.thumbs, 'aria-label': 'Page thumbnails', hidden: true }, this.thumbList);
    this.scrim = h('div', { class: 'ppr__scrim', 'data-act': 'thumbs', hidden: true });

    this.pagesEl = h('div', { class: 'ppr__pages', id: this.ids.pages });
    this.view = h('div', { class: 'ppr__view', tabindex: '0', role: 'document', 'aria-label': 'Document pages', 'aria-describedby': this.ids.title }, this.pagesEl);
    this.stateEl = h('div', { class: 'ppr__state', role: 'status' });
    this.body = h('div', { class: 'ppr__body' }, this.thumbs, this.scrim, this.view, this.stateEl);

    this.pagebar = h('footer', { class: 'ppr__pagebar' }, pageGroup('is-bottom'), zoomGroup('is-bottom'));
    this.toast = h('div', { class: 'ppr__toast', role: 'status', 'aria-live': 'polite' });
    this.live = h('div', { class: 'ppr__sr', 'aria-live': 'polite' });

    this.flip = h('div', { class: 'ppr__flip', 'aria-hidden': 'true' });
    this.root = h('div', { class: 'ppr', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': this.ids.title },
      this.bar, this.progress, this.searchBar, this.printPanel, this.helpPanel, this.body, this.pagebar, this.flip, this.toast, this.live);
    // the keys each control answers to, read out by screen readers
    for (const b of this.root.querySelectorAll('button[data-act]')) { const k = KEYSHORTCUTS[b.dataset.act]; if (k) b.setAttribute('aria-keyshortcuts', k); }
    if (!document.fullscreenEnabled || !this.root.requestFullscreen) this.root.querySelectorAll('[data-needs="fs"]').forEach((e) => e.remove());
    this.root.classList.toggle('ppr--dark', this.dark);
  }

  async mount() {
    const sig = { signal: this.ac.signal };
    // modal plumbing: inert siblings, scroll lock
    this.inerted = [];
    for (const el of document.body.children) if (!el.inert && el !== this.root) { el.inert = true; this.inerted.push(el); }
    const de = document.documentElement;
    this.prevOverflow = [de.style.overflow, document.body.style.overflow];
    de.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
    this.root.classList.add('ppr--pre');
    this.root.hidden = true; // until the stylesheet is in: on a slow phone connection the bare buttons and icons must never show
    document.body.append(this.root);
    // history entry so the phone back gesture closes the reader instead of leaving the page
    if (!this.pushed) try { history.pushState({ ...(history.state || {}), pdfReader: true }, ''); this.pushed = true; } catch {}
    addEventListener('popstate', () => { if (!this.closed) { this.pushed = false; this.close(); } }, sig);

    this.root.addEventListener('click', (e) => this.onClick(e), sig);
    // on document, not the root: a hidden focused control can drop focus to <body>
    document.addEventListener('keydown', (e) => { if (e.target === document.body || this.root.contains(e.target)) this.onKey(e); }, sig);
    document.addEventListener('keydown', (e) => this.onDocKey(e), { ...sig, capture: true });
    document.addEventListener('focusin', (e) => { if (!this.root.contains(e.target)) this.focusFirst(); }, sig);
    document.addEventListener('pointerdown', (e) => this.onOutsidePointer(e), sig);
    document.addEventListener('fullscreenchange', () => this.sync(), sig);
    for (const inp of [this.pageInput, this.pageInput2]) {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.jumpFrom(inp); } }, sig);
      inp.addEventListener('change', () => this.jumpFrom(inp), sig);
      inp.addEventListener('focus', () => inp.select(), sig);
      inp.addEventListener('blur', () => { inp.value = String(this.current); }, sig);
    }
    let st;
    this.searchInput.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => this.runSearch(this.searchInput.value), 180); }, sig);
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(st); if (this.searchInput.value !== this.search.q) this.runSearch(this.searchInput.value).then(() => this.stepMatch(0)); else this.stepMatch(e.shiftKey ? -1 : 1); }
    }, sig);
    this.view.addEventListener('scroll', () => { this.chromeOnScroll(); this.onScroll(); }, { ...sig, passive: true });
    this.view.addEventListener('click', (e) => this.chromeOnTap(e), sig);
    this.view.addEventListener('wheel', (e) => this.onWheel(e), { ...sig, passive: false });
    this.setupPointers(sig);
    // phones: the on-screen keyboard shrinks only the visual viewport, so the reader is fitted to it (the page box and the find bar stay above the keys)
    const vv = window.visualViewport;
    if (vv) {
      const fitVV = () => {
        const on = this.chromeNarrow() && Math.abs(vv.scale - 1) < 0.02 && vv.height < innerHeight - 80;
        if (on) { this.root.style.setProperty('--r-vt', `${Math.round(vv.offsetTop)}px`); this.root.style.setProperty('--r-vh', `${Math.round(vv.height)}px`); }
        else { this.root.style.removeProperty('--r-vt'); this.root.style.removeProperty('--r-vh'); }
        this.root.classList.toggle('has-kbd', on);
        this.onResize();
      };
      vv.addEventListener('resize', fitVV, sig); vv.addEventListener('scroll', fitVV, sig);
    }
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.view); this.ro.observe(this.bar);
    this.io = new IntersectionObserver((es) => this.onIntersect(es), { root: this.view, rootMargin: '150% 0px' });

    await loadCSS();
    if (this.closed) return;
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.remove('ppr--pre'));
    this.sync();
    this.measureChrome();
    this.view.focus({ preventScroll: true, focusVisible: false });
  }

  /* ----- loading ----- */
  async load(password) {
    this.setState('loading');
    this.progress.classList.remove('is-done');
    this.progress.classList.add('is-indeterminate');
    this.setProgress(0);
    let lib;
    try { lib = this.lib = await loadLib(); } catch (err) { return this.fail(err); }
    if (this.closed) return;
    this.CSS_UNITS = lib.PixelsPerInch?.PDF_TO_CSS_UNITS || 96 / 72;
    const task = this.task = lib.getDocument({
      url: this.href, password,
      wasmUrl: new URL('wasm/', BASE).href,
      standardFontDataUrl: new URL('standard_fonts/', BASE).href,
      withCredentials: false, enableXfa: false, disableWorkerRendering: true,
      verbosity: lib.VerbosityLevel?.ERRORS ?? 0,
    });
    task.onProgress = ({ loaded, total }) => { if (total > 0) { this.progress.classList.remove('is-indeterminate'); this.setProgress(loaded / total); } };
    let doc;
    try { doc = await task.promise; } catch (err) { if (!this.closed) this.fail(err); return; }
    if (this.closed) { doc.destroy(); return; }
    this.doc = doc;
    try {
      const all = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
      if (this.closed) return;
      this.pages = all.map((pg, i) => { const v = pg.getViewport({ scale: 1 }); return { num: i + 1, pg, w: v.width, h: v.height }; });
    } catch (err) { return this.fail(err); }
    this.setProgress(1);
    this.progress.classList.add('is-done');
    this.buildPages();
    this.setState(null);
    this.pageCount.textContent = this.pageCount2.textContent = `/ ${doc.numPages}`;
    this.fit(true);
    this.sync();
    this.announce(`${this.title} opened, ${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}`);
    const first = this.pages[0];
    first.firstPaint = defer();
    this.schedule();
    await Promise.race([first.firstPaint.promise, new Promise((r) => setTimeout(r, 8000))]);
    if (!this.closed) this._ready.resolve({ numPages: doc.numPages });
  }

  /* the Paper | Solution switch: the same reader, another document (pages, thumbnails and search start again) */
  switchTo(i) {
    const d = this.docs[i];
    if (!d || i === this.docIndex || this.closed) return;
    this.docIndex = i; this.href = d.href; this.kind = d.kind;
    this.view.classList.add('is-swapping');
    setTimeout(() => {
      if (this.closed) return;
      this.resetDoc();
      this.root.querySelectorAll('[data-act="kind"]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === i)));
      this.load().finally(() => requestAnimationFrame(() => this.view.classList.remove('is-swapping')));
    }, this.reduced ? 0 : 140);
    this.announce(`Showing the ${(KIND_LABEL[d.kind] || 'document').toLowerCase()}`);
  }
  resetDoc() {
    this.search = { q: '', matches: [], cur: -1, token: (this.search?.token || 0) + 1 };
    this.searchInput.value = ''; this.searchCount.textContent = '';
    for (const p of this.pages) { p.task?.cancel(); p.textLayer?.cancel?.(); if (p.canvas) p.canvas.width = p.canvas.height = 0; }
    this.io?.disconnect(); this.tio?.disconnect(); this.tio = null; this.thumbQueue = null; this.thumbBusy = false;
    this.io = new IntersectionObserver((es) => this.onIntersect(es), { root: this.view, rootMargin: '150% 0px' });
    this.task?.destroy().catch?.(() => {});
    this.doc = null; this.pages = []; this._ref = null; this.current = 1; this.textCache.clear();
    this.pagesEl.textContent = ''; this.thumbList.textContent = '';
    this.view.scrollTop = 0; this.view.scrollLeft = 0;
    if (!this.thumbs.hidden) this.toggleThumbs(true);
  }

  fail(err) {
    const name = err?.name || '';
    console.warn('[papers-reader]', name, err?.message);
    this.progress.classList.add('is-done');
    if (name === 'PasswordException') {
      this.setState('password', err.code === 2 ? 'That password is not correct. Try again.' : null);
      return;
    }
    let msg = 'Check your connection and try again.';
    if (name === 'InvalidPDFException') msg = 'This file is damaged or is not a PDF.';
    else if (name === 'ResponseException' || /Missing PDF|Unexpected server response/i.test(err?.message || '')) msg = err?.status === 404 ? 'This document could not be found.' : 'The server could not send this document. Try again in a moment.';
    this.setState('error', msg);
    this._ready.reject(err instanceof Error ? err : new Error(String(err)));
  }

  setState(kind, msg) {
    const s = this.stateEl; s.textContent = ''; s.className = 'ppr__state';
    this.root.classList.toggle('is-loading', kind === 'loading');
    if (!kind) { s.hidden = true; return; }
    s.hidden = false; s.classList.add('is-' + kind);
    if (kind === 'loading') {
      s.append(h('div', { class: 'ppr__skel', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')), h('p', { class: 'ppr__sr' }, 'Loading document…'));
    } else if (kind === 'error') {
      s.append(h('div', { class: 'ppr__card' }, icon('warn'), h('h3', null, 'We couldn’t open this document'), h('p', null, msg),
        h('button', { type: 'button', class: 'ppr__cta', 'data-act': 'retry' }, 'Retry')));
      s.querySelector('button').focus();
    } else if (kind === 'password') {
      const inp = h('input', { type: 'password', class: 'ppr__pw', 'aria-label': 'Document password', autocomplete: 'off', required: true });
      const form = h('form', { class: 'ppr__card', novalidate: true }, icon('lock'), h('h3', null, 'This document is password-protected'),
        h('p', null, msg || 'Enter the password to view it, or close the reader.'), inp,
        h('div', { class: 'ppr__row' }, h('button', { type: 'submit', class: 'ppr__cta' }, 'Unlock'), h('button', { type: 'button', class: 'ppr__cta ppr__cta--ghost', 'data-act': 'close' }, 'Close')));
      form.addEventListener('submit', (e) => { e.preventDefault(); if (inp.value) { this.task?.destroy(); this.load(inp.value); } });
      s.append(form);
      inp.focus();
    }
  }
  setProgress(f) { this.progressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`; }

  buildPages() {
    const frag = document.createDocumentFragment(), tfrag = document.createDocumentFragment();
    for (const p of this.pages) {
      p.el = h('div', { class: 'ppr__page is-empty', 'data-page': p.num, role: 'group', 'aria-label': `Page ${p.num} of ${this.pages.length}` });
      p.textReady = defer();
      frag.append(p.el);
      this.io.observe(p.el);
      p.thumb = h('button', { type: 'button', class: 'ppr__thumb', 'data-act': 'goto', 'data-page': p.num, 'aria-label': `Page ${p.num}` },
        p.thumbBox = h('span', { class: 'ppr__thumbimg is-empty' }), h('span', { class: 'ppr__thumbnum num', 'aria-hidden': 'true' }, String(p.num)));
      const ratio = p.h / p.w;
      p.thumbBox.style.aspectRatio = `${p.w} / ${p.h}`;
      if (ratio < 1) p.thumbBox.classList.add('is-landscape');
      tfrag.append(h('li', null, p.thumb));
    }
    this.pagesEl.append(frag);
    this.thumbList.append(tfrag);
  }

  /* ----- layout & zoom ----- */
  availSize() {
    const cs = getComputedStyle(this.pagesEl);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { w: Math.max(120, this.view.clientWidth - padX), h: Math.max(120, this.view.clientHeight - padY) };
  }
  refPage() {
    // the most common page size, so one landscape page does not shrink every portrait page
    if (!this._ref) {
      const count = new Map();
      for (const p of this.pages) { const k = `${Math.round(p.w)}x${Math.round(p.h)}`; count.set(k, (count.get(k) || 0) + 1); }
      const best = [...count].sort((a, b) => b[1] - a[1])[0][0];
      this._ref = this.pages.find((p) => `${Math.round(p.w)}x${Math.round(p.h)}` === best);
    }
    return this._ref;
  }
  fitZoom(mode) {
    if (!this.pages.length) return 1;
    const ref = mode === 'page' ? this.pages[this.current - 1] : this.refPage();
    const { w, h: hh } = this.availSize();
    const zw = w / (ref.w * this.CSS_UNITS);
    if (mode === 'page') return Math.min(zw, hh / (ref.h * this.CSS_UNITS));
    return Math.min(zw, FIT_WIDTH_MAX);
  }
  fit(initial = false) {
    if (this.mode === 'width' || this.mode === 'page') this.setZoom(this.fitZoom(this.mode), { keepMode: true, initial });
  }
  setZoom(z, { anchor, keepMode = false, initial = false } = {}) {
    if (!this.pages.length) return;
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    if (!keepMode) this.mode = 'custom';
    if (Math.abs(z - this.zoom) < 1e-4 && !initial) { this.sync(); return; }
    // remember which point of which page sits under the anchor
    const v = this.view;
    const ax = anchor ? anchor.x : v.clientWidth / 2, ay = anchor ? anchor.y : 0;
    let ref = null;
    if (!initial) {
      const y = v.scrollTop + ay, x = v.scrollLeft + ax;
      const p = this.pageAtY(y);
      if (p) ref = { p, fy: (y - p.el.offsetTop) / p.el.offsetHeight, fx: (x - p.el.offsetLeft) / p.el.offsetWidth };
    }
    this.zoom = z;
    const s = z * this.CSS_UNITS;
    this.pagesEl.style.setProperty('--total-scale-factor', s);
    for (const p of this.pages) { p.el.style.width = `${Math.floor(p.w * s)}px`; p.el.style.height = `${Math.floor(p.h * s)}px`; }
    if (ref) {
      v.scrollTop = ref.p.el.offsetTop + ref.fy * ref.p.el.offsetHeight - ay;
      v.scrollLeft = this.mode === 'custom' ? ref.p.el.offsetLeft + ref.fx * ref.p.el.offsetWidth - ax : 0;
    }
    this.sync();
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => this.schedule(), initial ? 0 : 140);
  }
  stepZoom(dir, anchor) {
    const z = this.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.01) ?? ZOOM_MAX : [...ZOOM_STEPS].reverse().find((s) => s < z * 0.99) ?? ZOOM_MIN;
    this.setZoom(next, { anchor });
  }
  // the floating bars on phones are measured, not guessed: the page padding, the find panel and the drawer all follow their real height
  measureChrome() {
    const set = (n, v) => { if (this.root.style.getPropertyValue(n) !== v) this.root.style.setProperty(n, v); };
    if (!this.chromeNarrow()) { this.root.style.removeProperty('--r-bar-h'); this.root.style.removeProperty('--r-pb-h'); return; }
    const bh = this.bar.offsetHeight, ph = this.pagebar.offsetHeight;
    if (bh) set('--r-bar-h', bh + 'px');
    if (ph) set('--r-pb-h', ph + 'px');
  }
  onResize() {
    cancelAnimationFrame(this.resizeRaf);
    this.resizeRaf = requestAnimationFrame(() => { this.measureChrome(); if (this.pages.length && this.mode !== 'custom') this.fit(); this.syncPan(); });
  }

  /* ----- page tracking ----- */
  pageAtY(y) {
    const ps = this.pages; if (!ps.length || !ps[0].el) return null;
    let lo = 0, hi = ps.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid].el.offsetTop <= y) lo = mid; else hi = mid - 1; }
    return ps[lo];
  }
  /* Phones and tablets: the bars slide away while the reader scrolls down and come back on a small scroll up, a tap on the page, or when a panel is open. */
  chromeNarrow() { return !!(window.matchMedia && window.matchMedia('(max-width: 1023.98px)').matches); }
  chromeLocked() {
    return !!(this.openMenu || !this.searchBar.hidden || !this.printPanel.hidden || !this.helpPanel.hidden || !this.thumbs.hidden || this.root.classList.contains('is-loading') || this.root.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName));
  }
  chromeShow(on) { this.root.classList.toggle('is-immersive', !on); }
  chromeOnScroll() {
    const top = this.view.scrollTop, last = this.lastTop ?? top;
    this.lastTop = top;
    if (!this.chromeNarrow()) { if (this.root.classList.contains('is-immersive')) this.chromeShow(true); return; }
    const d = top - last;
    if (Date.now() < (this.jumpUntil || 0)) { this.chromeAcc = 0; return; } // a jump the reader asked for (Next, page box, thumbnail): the bars stay
    if (this.chromeLocked() || top < 48 || top + this.view.clientHeight >= this.view.scrollHeight - 48) { this.chromeAcc = 0; return this.chromeShow(true); }
    if (Math.abs(d) > 120) return; // a jump (page box, thumbnail, find): leave the bars as they are
    this.chromeAcc = (Math.sign(d) === Math.sign(this.chromeAcc || 0) ? this.chromeAcc : 0) + d;
    if (this.chromeAcc > 14) this.chromeShow(false);
    else if (this.chromeAcc < -10) this.chromeShow(true);
  }
  chromeOnTap(e) {
    if (!this.chromeNarrow() || this.chromeLocked()) return;
    if (e.target.closest('a, button, input') || String(window.getSelection?.() || '')) return; // a tap on text counts too: only a real selection or a control is left alone
    if (Date.now() - (this.lastGesture || 0) < 400) return; // end of a pinch or a double-tap
    // wait a moment: a second tap means zoom, and the bars must not flicker for it
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => { if (!this.closed && !this.chromeLocked()) this.chromeShow(this.root.classList.contains('is-immersive')); }, 300);
  }
  onScroll() {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      const p = this.pageAtY(this.view.scrollTop + this.view.clientHeight * 0.35);
      if (p && p.num !== this.current) { this.current = p.num; this.syncPage(); this.schedule(); }
    });
  }
  goTo(n, { focus = false } = {}) {
    if (!this.pages.length) return;
    n = Math.max(1, Math.min(this.pages.length, n | 0));
    const p = this.pages[n - 1];
    const pad = parseFloat(getComputedStyle(this.pagesEl).paddingTop) || 0;
    this.jumpUntil = Date.now() + 800; this.chromeShow(true);
    this.glideTo(Math.max(0, p.el.offsetTop - Math.min(pad, 12)));
    this.current = n; this.syncPage(); this.schedule();
    if (focus) this.view.focus({ preventScroll: true });
  }
  /* an eased scroll (easeInOutCubic, 0.22 to 0.42 s) for short trips; a long trip is one jump. Any wheel, touch or key press stops it where it is. */
  glideTo(top) {
    const v = this.view, from = v.scrollTop, dist = top - from;
    cancelAnimationFrame(this.glideRaf);
    if (this.reduced || Math.abs(dist) < 2 || Math.abs(dist) > v.clientHeight * 3) { v.scrollTop = top; return; }
    const dur = Math.min(420, 220 + Math.abs(dist) * 0.12), t0 = performance.now();
    const stop = () => { cancelAnimationFrame(this.glideRaf); v.removeEventListener('wheel', stop); v.removeEventListener('touchstart', stop); };
    v.addEventListener('wheel', stop, { passive: true, once: true }); v.addEventListener('touchstart', stop, { passive: true, once: true });
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      v.scrollTop = from + dist * e;
      if (k < 1) this.glideRaf = requestAnimationFrame(step); else stop();
    };
    this.glideRaf = requestAnimationFrame(step);
  }
  jumpFrom(inp) {
    const n = parseInt(inp.value, 10);
    if (Number.isFinite(n)) { this.goTo(n); this.announce(`Page ${this.current} of ${this.pages.length}`); }
    inp.value = String(this.current);
  }

  /* ----- rendering ----- */
  onIntersect(entries) {
    for (const e of entries) {
      const p = this.pages[+e.target.dataset.page - 1];
      if (p) p.visible = e.isIntersecting;
    }
    this.schedule();
  }
  schedule() {
    if (this.closed || this.schedRaf) return;
    this.schedRaf = requestAnimationFrame(() => { this.schedRaf = 0; this.pump(); });
  }
  pump() {
    if (this.closed || !this.doc) return;
    const visible = this.pages.filter((p) => p.visible);
    const lo = Math.min(...visible.map((p) => p.num), this.current), hi = Math.max(...visible.map((p) => p.num), this.current);
    for (const p of this.pages) {
      const near = p.num >= lo - this.keepCanvas && p.num <= hi + this.keepCanvas;
      if (!p.visible && p.task) { p.task.cancel(); p.task = null; }
      if (!near && p.canvas) this.freeCanvas(p);
      if (!(p.num >= lo - KEEP_TEXT && p.num <= hi + KEEP_TEXT) && p.textLayer) this.freeText(p);
    }
    const want = visible.filter((p) => p.renderedZoom !== this.zoom && !p.task)
      .sort((a, b) => Math.abs(a.num - this.current) - Math.abs(b.num - this.current));
    let running = this.pages.filter((p) => p.task).length;
    for (const p of want) { if (running >= 2) break; running++; this.renderPage(p); }
  }
  async renderPage(p) {
    const zoom = this.zoom;
    const vp = p.pg.getViewport({ scale: zoom * this.CSS_UNITS });
    let os = Math.min(window.devicePixelRatio || 1, 2);
    if (vp.width * vp.height * os * os > this.maxPixels) os = Math.sqrt(this.maxPixels / (vp.width * vp.height));
    const canvas = document.createElement('canvas');
    canvas.className = 'ppr__canvas';
    canvas.width = Math.floor(vp.width * os); canvas.height = Math.floor(vp.height * os);
    canvas.setAttribute('aria-hidden', 'true');
    const task = p.task = p.pg.render({ canvas, viewport: vp, transform: os !== 1 ? [os, 0, 0, os, 0, 0] : null });
    try {
      await task.promise;
    } catch (err) {
      canvas.width = canvas.height = 0;
      if (p.task === task) p.task = null;
      if (err?.name !== 'RenderingCancelledException' && !this.closed) { console.warn('[papers-reader] render', p.num, err?.message); p.el.classList.add('is-failed'); }
      this.schedule();
      return;
    }
    if (p.task === task) p.task = null;
    if (this.closed) { canvas.width = canvas.height = 0; return; }
    const old = p.canvas;
    p.canvas = canvas; p.renderedZoom = zoom;
    if (old) { old.replaceWith(canvas); old.width = old.height = 0; }
    else {
      p.el.prepend(canvas);
      p.el.classList.remove('is-empty', 'is-failed');
      if (!this.reduced) { canvas.classList.add('is-in'); requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.remove('is-in'))); }
    }
    p.firstPaint?.resolve();
    this.ensureText(p, vp);
    this.schedule();
  }
  async ensureText(p, vp) {
    if (p.textLayer) { p.textLayer.update({ viewport: vp }); return; }
    if (p.textPending) return;
    p.textPending = true;
    let tc;
    try { tc = await this.getText(p.num); } catch { p.textPending = false; return; }
    p.textPending = false;
    if (this.closed || !p.canvas || p.textLayer) return;
    const div = h('div', { class: 'textLayer' });
    const tl = p.textLayer = new this.lib.TextLayer({ textContentSource: tc, container: div, viewport: p.pg.getViewport({ scale: this.zoom * this.CSS_UNITS }) });
    p.textDiv = div;
    p.el.append(div);
    try { await tl.render(); } catch { return; }
    if (p.textLayer !== tl || this.closed) return;
    p.index ||= this.pageIndex(tc);
    this.paintHighlights(p);
    p.textReady.resolve();
  }
  freeCanvas(p) { p.canvas.width = p.canvas.height = 0; p.canvas.remove(); p.canvas = null; p.renderedZoom = 0; p.el.classList.add('is-empty'); }
  freeText(p) {
    p.textLayer.cancel?.(); p.textLayer = null; p.textDiv?.remove(); p.textDiv = null;
    p.textReady = defer();
  }
  getText(num) {
    if (!this.textCache.has(num)) {
      const pr = this.pages[num - 1].pg.getTextContent().then((tc) => tc);
      pr.catch(() => this.textCache.delete(num));
      this.textCache.set(num, pr);
    }
    return this.textCache.get(num);
  }

  /* ----- thumbnails ----- */
  toggleThumbs(force) {
    const open = force ?? this.thumbs.hidden;
    this.thumbs.hidden = !open;
    this.scrim.hidden = !open;
    this.root.classList.toggle('has-thumbs', open);
    if (open) {
      if (!this.tio) {
        this.tio = new IntersectionObserver((es) => {
          for (const e of es) if (e.isIntersecting) { this.thumbQueue.add(this.pages[+e.target.dataset.page - 1]); }
          this.pumpThumbs();
        }, { root: this.thumbs, rootMargin: '200px 0px' });
        this.thumbQueue = new Set();
        for (const p of this.pages) this.tio.observe(p.thumb);
      }
      requestAnimationFrame(() => {
        this.pages[this.current - 1]?.thumb.scrollIntoView({ block: 'nearest' });
        if (this.isNarrow()) this.pages[this.current - 1]?.thumb.focus({ preventScroll: true });
      });
    }
    this.sync();
  }
  async pumpThumbs() {
    if (this.thumbBusy || this.closed) return;
    this.thumbBusy = true;
    while (this.thumbQueue.size && !this.closed) {
      const p = this.thumbQueue.values().next().value; this.thumbQueue.delete(p);
      if (p.thumbDone) continue;
      p.thumbDone = true;
      const box = p.thumbBox.getBoundingClientRect();
      const os = Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.pg.getViewport({ scale: (box.width || 120) / p.w });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width * os); c.height = Math.floor(vp.height * os);
      try { await p.pg.render({ canvas: c, viewport: vp, transform: os !== 1 ? [os, 0, 0, os, 0, 0] : null }).promise; } catch { p.thumbDone = false; continue; }
      if (this.closed) break;
      p.thumbBox.append(c); p.thumbBox.classList.remove('is-empty');
    }
    this.thumbBusy = false;
  }

  /* ----- search ----- */
  toggleSearch(force) {
    const open = force ?? this.searchBar.hidden;
    if (open && !this.printPanel.hidden && !this.printing) this.togglePrint(false, { restore: false }); // the panels sit in the same corner
    if (open && !this.helpPanel.hidden) this.toggleHelp(false, { restore: false });
    this.searchBar.hidden = !open;
    this.root.classList.toggle('has-search', open);
    if (open) { this.searchInput.focus(); this.searchInput.select(); }
    else { this.clearHighlights(); this.search = { q: '', matches: [], cur: -1, token: this.search.token + 1 }; this.searchCount.textContent = ''; this.view.focus({ preventScroll: true }); }
    this.sync();
  }
  pageIndex(tc) {
    // joined text of the page; items map 1:1 to TextLayer.textDivs (items without .str are markers)
    const strs = [], starts = [];
    let text = '';
    for (const it of tc.items) {
      if (it.str === undefined) continue;
      starts.push(text.length); strs.push(it.str);
      text += it.str;
      if (it.hasEOL) text += ' ';
    }
    return { strs, starts, text: text.toLowerCase() };
  }
  async runSearch(raw) {
    const q = raw.trim().replace(/\s+/g, ' ');
    const token = ++this.search.token;
    this.clearHighlights();
    this.search.q = raw; this.search.matches = []; this.search.cur = -1;
    if (q.length < 2 || !this.doc) { this.searchCount.textContent = q.length ? 'Type 2+ letters' : ''; this.syncSearch(); return; }
    const re = new RegExp(q.toLowerCase().split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
    this.searchCount.textContent = 'Searching…';
    const matches = [];
    for (const p of this.pages) {
      let tc; try { tc = await this.getText(p.num); } catch { continue; }
      if (token !== this.search.token) return;
      p.index ||= this.pageIndex(tc);
      re.lastIndex = 0;
      let m; while ((m = re.exec(p.index.text))) { if (!m[0].length) { re.lastIndex++; continue; } matches.push({ page: p.num, start: m.index, end: m.index + m[0].length }); }
    }
    if (token !== this.search.token) return;
    this.search.matches = matches;
    // first match at or after the current page
    const i = matches.findIndex((m) => m.page >= this.current);
    this.search.cur = matches.length ? (i < 0 ? 0 : i) : -1;
    for (const p of this.pages) if (p.textDiv) this.paintHighlights(p);
    this.syncSearch();
    if (matches.length) this.showMatch(false);
    this.announce(matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : 'No matches');
  }
  syncSearch() {
    const { matches, cur, q } = this.search;
    if (q.trim().length >= 2) this.searchCount.textContent = matches.length ? `${cur + 1} of ${matches.length}` : 'No results';
    this.searchBar.querySelectorAll('[data-act="searchPrev"],[data-act="searchNext"]').forEach((b) => { b.disabled = !matches.length; });
  }
  stepMatch(d) {
    const n = this.search.matches.length; if (!n) return;
    this.search.cur = (this.search.cur + d + n) % n;
    this.syncSearch();
    this.showMatch(true);
  }
  async showMatch(announce) {
    const m = this.search.matches[this.search.cur]; if (!m) return;
    const p = this.pages[m.page - 1];
    const cur = this.view.querySelector('mark.is-current'); cur?.classList.remove('is-current');
    const rectIn = () => p.el.querySelector(`mark[data-m="${this.search.cur}"]`);
    let mark = p.textDiv && rectIn();
    if (!mark) { this.goTo(m.page); const want = this.search.cur; await p.textReady.promise; if (want !== this.search.cur) return; mark = rectIn(); }
    if (!mark) return;
    this.view.querySelectorAll('mark.is-current').forEach((x) => x.classList.remove('is-current'));
    p.el.querySelectorAll(`mark[data-m="${this.search.cur}"]`).forEach((x) => x.classList.add('is-current'));
    const vr = this.view.getBoundingClientRect(), mr = mark.getBoundingClientRect();
    if (mr.top < vr.top + 40 || mr.bottom > vr.bottom - 40) this.view.scrollTop += mr.top - vr.top - vr.height * 0.3;
    if (mr.left < vr.left || mr.right > vr.right) this.view.scrollLeft += mr.left - vr.left - vr.width * 0.3;
    if (announce) this.announce(`Match ${this.search.cur + 1} of ${this.search.matches.length}, page ${m.page}`);
  }
  paintHighlights(p) {
    if (!p.textDiv || !p.textLayer) return;
    this.unpaint(p);
    const { matches } = this.search; if (!matches.length) return;
    const idx = p.index; if (!idx) return;
    const divs = p.textLayer.textDivs;
    const per = new Map(); // div index -> [[s,e,mi]]
    matches.forEach((m, mi) => {
      if (m.page !== p.num) return;
      for (let i = 0; i < idx.strs.length; i++) {
        const s = idx.starts[i], e = s + idx.strs[i].length;
        if (e <= m.start) continue; if (s >= m.end) break;
        const a = Math.max(m.start, s) - s, b = Math.min(m.end, e) - s;
        if (b > a) { if (!per.has(i)) per.set(i, []); per.get(i).push([a, b, mi]); }
      }
    });
    p.painted = [];
    for (const [i, ranges] of per) {
      const div = divs[i]; if (!div) continue;
      const str = idx.strs[i]; div.textContent = '';
      let pos = 0;
      for (const [a, b, mi] of ranges) {
        if (a > pos) div.append(str.slice(pos, a));
        div.append(h('mark', { class: 'ppr__hl' + (mi === this.search.cur ? ' is-current' : ''), 'data-m': mi }, str.slice(a, b)));
        pos = b;
      }
      if (pos < str.length) div.append(str.slice(pos));
      p.painted.push(i);
    }
  }
  unpaint(p) {
    if (!p.painted || !p.textLayer) return;
    const divs = p.textLayer.textDivs;
    for (const i of p.painted) if (divs[i]) divs[i].textContent = p.index.strs[i];
    p.painted = null;
  }
  clearHighlights() { for (const p of this.pages) this.unpaint(p); }

  /* ----- input ----- */
  zoomedIn() { return this.zoom > this.fitZoom('width') * 1.02; }
  isNarrow() { return !matchMedia('(min-width: 1024px)').matches; }
  onClick(e) {
    const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
    const act = t.dataset.act;
    const inMenu = t.closest('.ppr__menu');
    if (inMenu && act !== 'more' && act !== 'zoomMenu') this.closeMenus(true);
    switch (act) {
      case 'close': return this.close();
      case 'prev': return this.goTo(this.current - 1);
      case 'next': return this.goTo(this.current + 1);
      case 'zoomIn': return this.stepZoom(1);
      case 'zoomOut': return this.stepZoom(-1);
      case 'zoomTo': return this.setZoom(+t.dataset.zoom);
      case 'fitWidth': this.mode = 'width'; return this.fit();
      case 'fitPage': this.mode = 'page'; this.fit(); return this.goTo(this.current);
      case 'dark': return this.toggleDark();
      case 'thumbs': return this.toggleThumbs();
      case 'fullscreen': return this.toggleFullscreen();
      case 'search': return this.toggleSearch();
      case 'searchClose': return this.toggleSearch(false);
      case 'searchNext': return this.stepMatch(1);
      case 'searchPrev': return this.stepMatch(-1);
      case 'retry': this.task?.destroy(); return this.load();
      case 'kind': return this.switchTo(+t.dataset.i);
      case 'download': return this.download();
      case 'print': return this.togglePrint();
      case 'printGo': return this.startPrint();
      case 'printCancel': return this.cancelPrint();
      case 'goto': this.goTo(+t.dataset.page); if (this.isNarrow()) { this.toggleThumbs(false); this.view.focus({ preventScroll: true }); } return;
      case 'help': return this.toggleHelp(true);
      case 'helpClose': return this.toggleHelp(false);
      case 'more': return this.toggleMenu(t, this.moreMenu);
      case 'zoomMenu': return this.toggleMenu(t, this.zoomMenu);
    }
  }
  toggleMenu(button, menu) {
    const open = menu.hidden;
    this.closeMenus(false);
    if (!open) return;
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    this.openMenu = { button, menu };
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.ppr__mi')).focus();
  }
  closeMenus(restore = true) {
    if (!this.openMenu) return false;
    const { button, menu } = this.openMenu;
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    this.openMenu = null;
    if (restore) button.focus();
    return true;
  }
  onOutsidePointer(e) {
    if (this.openMenu && !this.openMenu.menu.contains(e.target) && !this.openMenu.button.contains(e.target)) this.closeMenus(false);
    if (!this.printPanel.hidden && !this.printing && !this.printPanel.contains(e.target) && !e.target.closest('[data-act="print"]')) this.togglePrint(false, { restore: false });
    if (!this.helpPanel.hidden && !this.helpPanel.contains(e.target) && !e.target.closest('[data-act="help"]')) this.toggleHelp(false, { restore: false });
  }
  onDocKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); e.stopPropagation(); this.download(); }
    else if (k === 'p') { e.preventDefault(); e.stopPropagation(); this.togglePrint(true); }
    else if (k === 'f' || k === 'g') { e.preventDefault(); e.stopPropagation(); if (this.searchBar.hidden) this.toggleSearch(true); else if (k === 'g') this.stepMatch(e.shiftKey ? -1 : 1); else this.searchInput.focus(); }
    else if (k === '=' || k === '+') { e.preventDefault(); this.stepZoom(1); }
    else if (k === '-') { e.preventDefault(); this.stepZoom(-1); }
    else if (k === '0') { e.preventDefault(); this.mode = 'width'; this.fit(); }
  }
  onKey(e) {
    if (e.key === 'Tab') return this.trapTab(e);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return this.stepBack(); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing = t.matches?.('input, textarea, select, [contenteditable]'); // in a field every key belongs to the field: Backspace keeps deleting letters
    if (e.key === 'Backspace') { // one step back, like Esc; never while typing, and holding the key does not close several layers
      if (typing) return;
      e.preventDefault();
      if (!e.repeat) this.stepBack();
      return;
    }
    if (this.openMenu && this.openMenu.menu.contains(t)) return this.menuKey(e);
    if (typing) return;
    const help = e.key === '?' || (e.code === 'Slash' && e.shiftKey);
    if (!this.helpPanel.hidden && this.helpPanel.contains(t)) { // the list is open and has the focus: its own scrolling keys work, and ? closes it
      if (help && !e.repeat) { e.preventDefault(); this.toggleHelp(false); }
      return;
    }
    if (help) { e.preventDefault(); if (!e.repeat) this.toggleHelp(); return; }
    const onButton = t.matches?.('button');
    const v = this.view;
    const hScroll = v.scrollWidth > v.clientWidth + 1;
    switch (e.key) {
      case 'ArrowRight': if (hScroll && this.zoomedIn()) return; e.preventDefault(); return this.goTo(this.current + 1);
      case 'ArrowLeft': if (hScroll && this.zoomedIn()) return; e.preventDefault(); return this.goTo(this.current - 1);
      case 'ArrowDown': if (t === v) return; e.preventDefault(); return v.scrollBy(0, 60);
      case 'ArrowUp': if (t === v) return; e.preventDefault(); return v.scrollBy(0, -60);
      case 'PageDown': case 'n': case 'N': case 'j': case 'J': e.preventDefault(); return this.goTo(this.current + 1);
      case 'PageUp': case 'p': case 'P': case 'k': case 'K': e.preventDefault(); return this.goTo(this.current - 1);
      case 'Home': e.preventDefault(); return this.goTo(1);
      case 'End': e.preventDefault(); return this.goTo(this.pages.length);
      case '+': case '=': e.preventDefault(); return this.stepZoom(1);
      case '-': case '_': e.preventDefault(); return this.stepZoom(-1);
      case '0': case 'w': case 'W': e.preventDefault(); this.mode = 'width'; return this.fit();
      case 'a': case 'A': e.preventDefault(); this.mode = 'page'; this.fit(); return this.goTo(this.current);
      case 'f': case 'F': e.preventDefault(); if (!e.repeat) this.toggleFullscreen(); return;
      case 'g': case 'G': e.preventDefault(); { const inp = this.isNarrow() ? this.pageInput2 : this.pageInput; inp.focus(); } return;
      case '/': e.preventDefault(); return this.toggleSearch(true);
      case 'd': case 'D': e.preventDefault(); return this.toggleDark();
      case 't': case 'T': e.preventDefault(); return this.toggleThumbs();
      case ' ': if (onButton) return; e.preventDefault(); return v.scrollBy(0, (e.shiftKey ? -1 : 1) * v.clientHeight * 0.85);
    }
  }
  menuKey(e) {
    const items = [...this.openMenu.menu.querySelectorAll('.ppr__mi')];
    const i = items.indexOf(document.activeElement);
    const go = (j) => { e.preventDefault(); items[(j + items.length) % items.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(items.length - 1);
  }
  focusables(scope = this.root) {
    return [...scope.querySelectorAll('button, input, [tabindex="0"], select, textarea')]
      .filter((el) => !el.disabled && !el.closest('[hidden]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  focusFirst() { (this.focusables()[0] || this.view).focus(); }
  trapTab(e) {
    const scope = this.helpPanel.hidden ? this.root : this.helpPanel; // while the list is open, Tab stays inside it
    const f = this.focusables(scope); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!this.helpPanel.hidden && !scope.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (!this.helpPanel.hidden && document.activeElement === scope) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = this.view.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.setZoom(this.zoom * Math.exp(-delta * 0.0025), { anchor: { x: e.clientX - r.left, y: e.clientY - r.top } });
  }
  setupPointers(sig) {
    const v = this.view, pts = new Map();
    let pinch = null, tap = null, moved = false, swipe = null;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    v.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = pts.size > 1;
      // one finger down may become a page swipe (decided once it has moved a little); a second finger makes it a pinch instead
      this.endSwipe(swipe, false); swipe = null;
      if (pts.size === 1) swipe = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: 'pending', trail: [{ t: e.timeStamp, x: e.clientX }] };
      if (pts.size === 2) {
        const r = v.getBoundingClientRect(), m = mid();
        pinch = { d0: dist(), f: 1, ax: m.x - r.left, ay: m.y - r.top };
        this.pagesEl.style.transformOrigin = `${v.scrollLeft + pinch.ax}px ${v.scrollTop + pinch.ay}px`;
      }
    }, sig);
    v.addEventListener('pointermove', (e) => {
      const pt = pts.get(e.pointerId); if (!pt) return;
      if (Math.hypot(pt.x - e.clientX, pt.y - e.clientY) > 10) moved = true;
      pt.x = e.clientX; pt.y = e.clientY;
      if (swipe && swipe.id === e.pointerId && pts.size === 1) {
        const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
        if (swipe.mode === 'pending' && Math.hypot(dx, dy) >= SWIPE_LOCK) {
          // clearly sideways, a page that cannot move sideways itself, and no text being selected: else it is an ordinary scroll
          swipe.mode = Math.abs(dx) > Math.abs(dy) * SWIPE_ANGLE && this.swipeOK() ? 'swipe' : 'off';
          if (swipe.mode === 'swipe') this.pagesEl.classList.add('is-swiping');
        }
        if (swipe.mode === 'swipe') {
          swipe.trail.push({ t: e.timeStamp, x: e.clientX }); if (swipe.trail.length > 8) swipe.trail.shift();
          if (!this.reduced) this.pagesEl.style.setProperty('--ppr-swipe', `${Math.max(-SWIPE_NUDGE_MAX, Math.min(SWIPE_NUDGE_MAX, dx * 0.3)).toFixed(1)}px`);
        }
      }
      if (pinch && pts.size === 2) {
        pinch.f = Math.max(ZOOM_MIN / this.zoom, Math.min(ZOOM_MAX / this.zoom, dist() / pinch.d0));
        this.pagesEl.style.transform = `scale(${pinch.f})`;
      }
    }, sig);
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (swipe && swipe.id === e.pointerId) { const s = swipe; swipe = null; this.endSwipe(s, e.type === 'pointerup', e); }
      if (pinch && pts.size < 2) {
        const { f, ax, ay } = pinch; pinch = null;
        this.pagesEl.style.transform = ''; this.pagesEl.style.transformOrigin = '';
        if (Math.abs(f - 1) > 0.02) this.setZoom(this.zoom * f, { anchor: { x: ax, y: ay } });
        tap = null; this.lastGesture = Date.now(); clearTimeout(this.tapTimer); return;
      }
      if (e.type === 'pointerup' && !moved && pts.size === 0) {
        const now = performance.now();
        if (tap && now - tap.t < 320 && Math.hypot(tap.x - e.clientX, tap.y - e.clientY) < 30) {
          this.lastGesture = Date.now(); clearTimeout(this.tapTimer);
          const r = v.getBoundingClientRect(), fitW = this.fitZoom('width');
          const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
          if (this.zoom > fitW * 1.3) { this.mode = 'width'; this.setZoom(fitW, { anchor, keepMode: true }); } else this.setZoom(Math.min(ZOOM_MAX, fitW * 2), { anchor });
          tap = null;
        } else tap = { t: now, x: e.clientX, y: e.clientY };
      }
    };
    v.addEventListener('pointerup', end, sig);
    v.addEventListener('pointercancel', end, sig);
  }

  /* ----- swipe left or right: next or previous page ----- */
  swipeOK() {
    const v = this.view;
    return this.pages.length > 1 && !this.root.classList.contains('is-loading') && v.scrollWidth <= v.clientWidth + 1 && !String(window.getSelection?.() || '');
  }
  // the finger lifted (commit = true) or the touch was taken away: settle the nudge, and turn the page when it was a clear swipe
  endSwipe(s, commit, e) {
    if (!s || s.mode !== 'swipe') return;
    const el = this.pagesEl;
    el.classList.remove('is-swiping');
    if (!this.reduced) { el.classList.add('is-swipe-back'); el.style.setProperty('--ppr-swipe', '0px'); clearTimeout(this.swipeTimer); this.swipeTimer = setTimeout(() => { el.classList.remove('is-swipe-back'); el.style.removeProperty('--ppr-swipe'); }, 260); }
    if (!commit || !e) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0, last = s.trail[s.trail.length - 1];
    const ref = s.trail.find((q) => last.t - q.t <= 120) || s.trail[0];
    const speed = last.t > ref.t ? (last.x - ref.x) / (last.t - ref.t) : 0; // px per ms over the last 120 ms
    const straight = Math.abs(dy) <= Math.abs(dx) * 0.6;
    const far = this.mode === 'page' && Math.abs(dx) >= Math.max(SWIPE_FAR, this.view.clientWidth * 0.12); // 56 px on a phone, more on a wide screen
    const flick = Math.abs(dx) >= SWIPE_FLICK_DIST && Math.abs(speed) >= SWIPE_FLICK_SPEED && e.timeStamp - last.t < 120 && Math.sign(speed) === Math.sign(dx);
    if (!straight || !(far || flick)) return;
    this.lastGesture = Date.now(); clearTimeout(this.tapTimer);
    const dir = dx < 0 ? 1 : -1, n = this.current + dir;
    if (n < 1 || n > this.pages.length) { this.flipChip(n < 1 ? 'First page' : 'Last page', dir); return; }
    this.goTo(n);
    this.flipChip(`Page ${n} of ${this.pages.length}`, dir);
    this.announce(`Page ${n} of ${this.pages.length}`);
  }
  // a small chip that shows the page just reached (transform and opacity only; under reduced motion it simply shows and goes)
  flipChip(text, dir) {
    const c = this.flip;
    c.textContent = text;
    c.style.setProperty('--ppr-dir', String(dir));
    c.classList.remove('is-on'); void c.offsetWidth; c.classList.add('is-on');
    clearTimeout(this.flipTimer); this.flipTimer = setTimeout(() => c.classList.remove('is-on'), 1000);
  }

  /* ----- download and print ----- */
  fileName() {
    const kind = { paper: 'Question paper', solution: 'Solution', original: 'Original scan', syllabus: 'Syllabus' }[this.kind] || '';
    const name = [this.subtitle, this.title, kind].filter(Boolean).join(' - ');
    const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim();
    return `${clean || 'document'}.pdf`;
  }
  async download() {
    if (!this.doc) { this.say('The document is still loading.'); return; }
    this.say('Preparing the download…');
    let blob = null;
    try { blob = new Blob([await this.doc.getData()], { type: 'application/pdf' }); } catch { /* the document's own copy was not available: fetch it again */ }
    if (!blob) {
      try {
        const r = await fetch(this.href, { credentials: 'omit' });
        if (!r.ok) throw new Error(String(r.status));
        blob = new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
      } catch { this.say('The download did not work. Check your connection and try again.'); return; }
    }
    if (this.closed) return;
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: this.fileName(), class: 'ppr__sr', tabindex: '-1' });
    this.root.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    this.say('Download started');
  }

  /* ----- shortcuts and gestures panel ----- */
  buildHelpPanel() {
    const keyCell = (spec) => {
      const out = [];
      spec.split(' | ').forEach((alt, i) => {
        if (i) out.push(h('span', { class: 'ppr__helpor' }, 'or'));
        alt.split(' + ').forEach((k, j) => { if (j) out.push(h('span', { class: 'ppr__helpplus' }, '+')); out.push(h('kbd', null, k)); });
      });
      return out;
    };
    const group = (id, title, rows, keys) => h('section', { class: 'ppr__helpgroup', 'aria-labelledby': this.ids.help + '-' + id },
      h('h4', { class: 'ppr__helpgh', id: this.ids.help + '-' + id }, title),
      h('dl', { class: 'ppr__helplist' }, rows.map(([a, b]) => h('div', { class: 'ppr__helprow' }, h('dt', null, keys ? keyCell(a) : a), h('dd', null, b)))));
    const keyboard = group('k', 'Keyboard', HELP_KEYS, true);
    const touch = group('t', 'Touch and mouse', HELP_TOUCH, false);
    const touchFirst = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); // the group that fits the device comes first; both stay readable
    this.helpBody = h('div', { class: 'ppr__helpbody', tabindex: '0', role: 'region', 'aria-label': 'Shortcuts and gestures list' },
      touchFirst ? [touch, keyboard] : [keyboard, touch], h('p', { class: 'ppr__helpnote' }, HELP_NOTE));
    this.helpPanel = h('section', { class: 'ppr__help', id: this.ids.help, role: 'dialog', 'aria-labelledby': this.ids.help + '-h', tabindex: '-1', hidden: true },
      h('div', { class: 'ppr__helphead' }, h('h3', { class: 'ppr__helph', id: this.ids.help + '-h' }, 'Shortcuts and gestures'), btn('helpClose', 'Close the list', 'close', { title: 'Close (Esc)' })),
      this.helpBody);
  }
  toggleHelp(force, { restore = true } = {}) {
    const open = force ?? this.helpPanel.hidden;
    if (open === !this.helpPanel.hidden) return;
    if (open) {
      const was = document.activeElement;
      this.helpFrom = was && was !== document.body && this.root.contains(was) ? was : null;
      this.closeMenus(false);
      if (!this.printPanel.hidden && !this.printing) this.togglePrint(false, { restore: false });
      if (!this.searchBar.hidden) this.toggleSearch(false);
      this.helpPanel.hidden = false;
      this.helpBody.scrollTop = 0;
      this.sync();
      this.helpPanel.focus({ preventScroll: true });
    } else {
      this.helpPanel.hidden = true;
      this.sync();
      if (restore) {
        const from = this.helpFrom; this.helpFrom = null;
        const b = [...this.root.querySelectorAll('.ppr__btn[data-act="help"], .ppr__btn[data-act="more"]')].find((x) => x.getClientRects().length);
        (from && from.isConnected && from.getClientRects().length ? from : b || this.view).focus({ preventScroll: true });
      }
    }
  }
  /* one step back, the same for Esc and Backspace: the list, a menu, the print panel, the find bar, the thumbnails drawer (narrow screens), full screen, and last of all the reader */
  stepBack() {
    if (!this.helpPanel.hidden) return this.toggleHelp(false);
    if (this.closeMenus()) return;
    if (!this.printPanel.hidden) return this.printing ? this.cancelPrint() : this.togglePrint(false);
    if (!this.searchBar.hidden) return this.toggleSearch(false);
    if (!this.thumbs.hidden && this.isNarrow()) { this.toggleThumbs(false); this.view.focus({ preventScroll: true }); return; }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    return this.close();
  }

  buildPrintPanel() {
    const group = this.ids.print + '-r';
    const opt = (value, label, extra) => h('label', { class: 'ppr__opt' }, h('input', { type: 'radio', name: group, value, checked: value === 'all' }), h('span', null, label), extra);
    this.optAll = h('span', null, 'All pages');
    this.optPage = h('span', null, 'This page only');
    this.rangeInput = h('input', { type: 'text', class: 'ppr__rangein num', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', placeholder: '1-3, 5', 'aria-label': 'Pages to print, for example 1-3, 5' });
    this.printMsg = h('p', { class: 'ppr__printmsg', role: 'status', 'aria-live': 'polite' });
    this.printForm = h('form', { class: 'ppr__printform', novalidate: true },
      h('fieldset', { class: 'ppr__opts' }, h('legend', { class: 'ppr__sr' }, 'Pages to print'),
        h('label', { class: 'ppr__opt' }, h('input', { type: 'radio', name: group, value: 'all', checked: true }), this.optAll),
        h('label', { class: 'ppr__opt' }, h('input', { type: 'radio', name: group, value: 'page' }), this.optPage),
        h('label', { class: 'ppr__opt' }, h('input', { type: 'radio', name: group, value: 'range' }), h('span', null, 'Pages'), this.rangeInput)),
      this.printMsg,
      h('p', { class: 'ppr__printnote' }, 'This opens your browser’s print window. Choose “Save as PDF” there to keep a copy.'),
      h('div', { class: 'ppr__row' }, h('button', { type: 'submit', class: 'ppr__cta' }, 'Print'), h('button', { type: 'button', class: 'ppr__cta ppr__cta--ghost', 'data-act': 'printClose' }, 'Cancel')));
    this.printBusyText = h('p', { class: 'ppr__busytext num', role: 'status', 'aria-live': 'polite' });
    this.printFill = h('i');
    this.printBusy = h('div', { class: 'ppr__printbusy', hidden: true }, this.printBusyText, h('div', { class: 'ppr__meter', 'aria-hidden': 'true' }, this.printFill),
      h('div', { class: 'ppr__row' }, h('button', { type: 'button', class: 'ppr__cta ppr__cta--ghost', 'data-act': 'printCancel' }, 'Cancel')));
    this.printPanel = h('div', { class: 'ppr__print', id: this.ids.print, role: 'dialog', 'aria-labelledby': this.ids.print + '-h', hidden: true },
      h('h3', { class: 'ppr__printh', id: this.ids.print + '-h' }, 'Print'), this.printForm, this.printBusy);
    this.rangeInput.addEventListener('focus', () => { this.printForm.elements[group].value = 'range'; });
    this.rangeInput.addEventListener('input', () => { this.printForm.elements[group].value = 'range'; this.printMsg.textContent = ''; });
    this.printForm.addEventListener('submit', (e) => { e.preventDefault(); this.startPrint(); });
    this.printGroup = group;
  }
  togglePrint(force, { restore = true } = {}) {
    const open = force ?? this.printPanel.hidden;
    if (open === !this.printPanel.hidden) { if (open) this.printForm.elements[this.printGroup].value && this.printPanel.querySelector('input:checked')?.focus(); return; }
    if (open) {
      if (!this.doc) { this.say('The document is still loading.'); return; }
      this.closeMenus(false);
      if (!this.helpPanel.hidden) this.toggleHelp(false, { restore: false });
      if (!this.searchBar.hidden) this.toggleSearch(false);
      const n = this.pages.length;
      this.optAll.textContent = `All pages (${n})`;
      this.optPage.textContent = `This page only (page ${this.current})`;
      this.printMsg.textContent = ''; this.rangeInput.value = '';
      this.printForm.elements[this.printGroup].value = 'all';
      this.printForm.hidden = false; this.printBusy.hidden = true;
      this.printPanel.hidden = false;
      this.sync();
      this.printPanel.querySelector('input:checked')?.focus();
    } else {
      this.printPanel.hidden = true;
      this.sync();
      if (restore) { const b = [...this.root.querySelectorAll('.ppr__btn[data-act="print"]')].find((x) => x.getClientRects().length); (b || this.view).focus({ preventScroll: true }); }
    }
  }
  /** "1-3, 5, 8-" -> [1, 2, 3, 5, 8, ...]; null (with a message) when something is not a page of this document. */
  printPages() {
    const n = this.pages.length;
    const mode = this.printForm.elements[this.printGroup].value;
    if (mode === 'all') return Array.from({ length: n }, (_, i) => i + 1);
    if (mode === 'page') return [this.current];
    const out = new Set();
    for (const part of this.rangeInput.value.split(/[\s,;]+/).filter(Boolean)) {
      const m = /^(\d*)-(\d*)$/.exec(part) || /^(\d+)$/.exec(part);
      if (!m) { this.printMsg.textContent = `Use page numbers like 1-3, 5 (this document has ${n}).`; return null; }
      const a = m[1] === '' ? 1 : +m[1], b = m.length > 2 ? (m[2] === '' ? n : +m[2]) : a;
      if (!a || a > n || b > n || b < a) { this.printMsg.textContent = `Pages must be between 1 and ${n}.`; return null; }
      for (let i = a; i <= b; i++) out.add(i);
    }
    if (!out.size) { this.printMsg.textContent = `Type the pages to print, for example 1-3, 5.`; return null; }
    return [...out].sort((x, y) => x - y);
  }
  async renderForPrint(num) {
    const pg = this.pages[num - 1].pg;
    const base = pg.getViewport({ scale: 1 });
    const scale = Math.min((this.phone ? 110 : 150) / 72, 3600 / Math.max(base.width, base.height)); // about 150 dpi (110 on a phone: memory), never more than 3,600 px on the long side
    const vp = pg.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    try {
      await pg.render({ canvas, viewport: vp, intent: 'print', background: '#ffffff' }).promise;
      // a data: address, not a blob: one: the page's policy lets pictures come from data: and this site only
      return { url: canvas.toDataURL('image/jpeg', 0.92), land: base.width > base.height };
    } finally { canvas.width = canvas.height = 0; }
  }
  cancelPrint() { if (this.printing) this.printing.cancel = true; else this.togglePrint(false); }
  cleanupPrint() {
    const j = this.printJob; if (!j) return;
    this.printJob = null; clearTimeout(j.timer);
    j.wrap.remove();
  }
  async startPrint() {
    if (this.printing || !this.doc) return;
    const nums = this.printPages();
    if (!nums) { this.rangeInput.focus(); return; }
    this.cleanupPrint();
    const job = this.printing = { cancel: false };
    this.printForm.hidden = true; this.printBusy.hidden = false;
    this.printFill.style.transform = 'scaleX(0)';
    const wrap = h('div', { class: 'ppr-print', 'aria-hidden': 'true' });
    const stop = () => job.cancel || this.closed;
    let ok = false;
    try {
      for (let i = 0; i < nums.length; i++) {
        if (stop()) return;
        this.printBusyText.textContent = `Preparing page ${i + 1} of ${nums.length}…`;
        this.printFill.style.transform = `scaleX(${(i / nums.length).toFixed(3)})`;
        const { url, land } = await this.renderForPrint(nums[i]);
        wrap.append(h('div', { class: 'ppr-print__page' + (land ? ' is-land' : '') }, h('img', { src: url, alt: '' })));
      }
      if (stop()) return;
      this.printFill.style.transform = 'scaleX(1)';
      this.printBusyText.textContent = 'Opening the print window…';
      document.body.append(wrap);
      await Promise.all([...wrap.querySelectorAll('img')].map((im) => im.decode().catch(() => {})));
      if (stop()) return;
      const j = this.printJob = { wrap, timer: 0 };
      addEventListener('afterprint', () => { if (this.printJob === j) this.cleanupPrint(); }, { once: true });
      j.timer = setTimeout(() => { if (this.printJob === j) this.cleanupPrint(); }, 10 * 60 * 1000); // a browser that never says "afterprint"
      ok = true;
      this.togglePrint(false, { restore: false });
      await new Promise((r) => requestAnimationFrame(() => r()));
      window.print();
    } catch (err) {
      console.warn('[papers-reader] print', err?.message);
      this.printMsg.textContent = 'Printing did not work. Try fewer pages, or download the PDF and print it from there.';
      this.printForm.hidden = false; this.printBusy.hidden = true;
    } finally {
      this.printing = null;
      if (!ok) {
        wrap.remove();
        if (!this.closed) { this.printBusy.hidden = true; this.printForm.hidden = false; if (job.cancel) this.togglePrint(false); }
      }
    }
  }

  /* ----- toggles ----- */
  toggleDark() {
    this.dark = !this.dark;
    this.root.classList.toggle('ppr--dark', this.dark);
    try { localStorage.setItem(PREF_KEY, this.dark ? '1' : '0'); } catch {}
    this.sync();
    this.say(this.dark ? 'Dark reading mode on' : 'Dark reading mode off');
  }
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.root.requestFullscreen?.().catch(() => this.say('Full screen is not available here.'));
  }

  /* ----- state sync ----- */
  sync() {
    const set = (act, attr, val) => this.root.querySelectorAll(`[data-act="${act}"]`).forEach((b) => b.setAttribute(b.getAttribute('role')?.startsWith('menuitem') ? 'aria-checked' : attr, String(val)));
    set('dark', 'aria-pressed', this.dark);
    set('thumbs', 'aria-pressed', !this.thumbs.hidden);
    set('fullscreen', 'aria-pressed', !!document.fullscreenElement);
    set('fitWidth', 'aria-pressed', this.mode === 'width');
    set('fitPage', 'aria-pressed', this.mode === 'page');
    this.root.querySelector('[data-act="search"]')?.setAttribute('aria-expanded', String(!this.searchBar.hidden));
    this.root.querySelectorAll('[data-act="print"]').forEach((b) => { if (b.matches('.ppr__btn')) b.setAttribute('aria-expanded', String(!this.printPanel.hidden)); });
    this.root.querySelectorAll('.ppr__btn[data-act="help"]').forEach((b) => b.setAttribute('aria-expanded', String(!this.helpPanel.hidden)));
    this.root.querySelectorAll('[data-act="download"], [data-act="print"]').forEach((b) => { b.disabled = !this.doc; });
    this.zoomMenu.querySelectorAll('[data-act="zoomTo"]').forEach((b) => b.setAttribute('aria-checked', String(this.mode === 'custom' && Math.abs(+b.dataset.zoom - this.zoom) < 0.005)));
    const pct = Math.round(this.zoom * 100) + '%';
    this.zoomLabel.textContent = pct; if (this.zoomLabel2) this.zoomLabel2.textContent = pct;
    this.root.querySelectorAll('[data-act="zoomOut"]').forEach((b) => { b.disabled = this.zoom <= ZOOM_MIN + 1e-3; });
    this.root.querySelectorAll('[data-act="zoomIn"]').forEach((b) => { b.disabled = this.zoom >= ZOOM_MAX - 1e-3; });
    this.syncPan();
    this.syncPage();
  }
  // the page can move sideways only when it is wider than the screen; then (and only then) the browser may take a sideways drag, otherwise the swipe is ours
  syncPan() { this.view.classList.toggle('can-pan-x', this.view.scrollWidth > this.view.clientWidth + 1); }
  syncPage() {
    const n = this.pages.length;
    for (const inp of [this.pageInput, this.pageInput2]) if (document.activeElement !== inp) inp.value = n ? String(this.current) : '–';
    this.root.querySelectorAll('[data-act="prev"]').forEach((b) => { b.disabled = !n || this.current <= 1; });
    this.root.querySelectorAll('[data-act="next"]').forEach((b) => { b.disabled = !n || this.current >= n; });
    if (n) this.view.setAttribute('aria-label', `Document pages, page ${this.current} of ${n}`);
    const prev = this.thumbList.querySelector('[aria-current]'); prev?.removeAttribute('aria-current');
    this.pages[this.current - 1]?.thumb?.setAttribute('aria-current', 'page');
  }
  announce(msg) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = msg; }, 30); }
  say(msg) {
    this.toast.textContent = msg; this.toast.classList.add('is-on');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toast.classList.remove('is-on'), 2600);
  }

  /* ----- teardown ----- */
  close({ restoreFocus = true, silent = false } = {}) {
    if (this.closed) return;
    this.closed = true;
    if (active === this) active = null;
    this.ac.abort();
    this.io?.disconnect(); this.tio?.disconnect(); this.ro?.disconnect();
    cancelAnimationFrame(this.schedRaf); cancelAnimationFrame(this.scrollRaf); cancelAnimationFrame(this.resizeRaf);
    clearTimeout(this.zoomTimer); clearTimeout(this.toastTimer); clearTimeout(this.swipeTimer); clearTimeout(this.flipTimer); cancelAnimationFrame(this.glideRaf);
    for (const p of this.pages) {
      p.task?.cancel(); p.textLayer?.cancel?.();
      if (p.canvas) { p.canvas.width = p.canvas.height = 0; }
      p.thumbBox?.querySelectorAll('canvas').forEach((c) => { c.width = c.height = 0; });
    }
    if (this.printing) this.printing.cancel = true;
    this.task?.destroy().catch?.(() => {}); // destroys the document and its worker
    this.lib?.TextLayer?.cleanup?.();
    this.doc = null; this.pages = []; this.textCache.clear();
    this._ready.reject(Object.assign(new Error('Reader closed'), { name: 'AbortError' }));
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    for (const el of this.inerted) el.inert = false;
    const de = document.documentElement;
    de.style.overflow = this.prevOverflow[0]; document.body.style.overflow = this.prevOverflow[1];
    if (this.pushed && history.state?.pdfReader) { this.pushed = false; try { history.back(); } catch {} }
    const root = this.root;
    const remove = () => root.remove();
    if (this.reduced || silent) remove();
    else { root.classList.add('ppr--out'); setTimeout(remove, 200); }
    if (restoreFocus && this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    try { this.onClose?.(); } catch (err) { console.error(err); }
  }
}
