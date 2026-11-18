/* Mayobe Bros: live suggestions under the school / centre search fields (phones and tablets).
   Added 2026-11-18, owner's request: on a small screen the list of centres is far below the fields (the tabs, two fields and the A to Z bar
   come first, and the keyboard covers the rest), so a reader who typed saw nothing happen. Now the best matches appear in a panel
   directly under the field being typed in, and a tap opens the centre.

   Loaded by js/results-app.js only when the screen is narrow (max-width 899.98px, the width below which the search bar does not stick);
   wide screens never download it. No dependencies, no storage, no cookies, no network: it works on the rows the app already holds.
   Pattern: WAI-ARIA Authoring Practices "combobox with listbox popup" (list autocomplete, focus stays in the input, the highlighted
   option is named by aria-activedescendant). Everything that comes from data is put in with textContent / DOM builders.

   The pure part (rankRows) is exported so scripts/tests/results-suggest.test.mjs can test it in Node; nothing runs on import. */

export const NARROW = '(max-width: 899.98px)';
export const SUGGEST_MAX = 6;   // options shown; "See all N" opens the full list
const ROOM_STEP = 24;           // px: a field already this close to the place under the header is not moved

/**
 * The best `limit` rows for what was typed, best first; rows of equal rank keep the list's own order.
 * toks: the typed name words (already norm()'d), codeQ: the typed centre number without spaces or capitals.
 * Rank (lower is better): the name starts with the first word 0, every word starts a word 1, a word only inside another 2;
 * for a number: the same code 0, starts with it 1, contains it 2. One pass, no sort of the whole list (6,000+ rows).
 */
export function rankRows(rows, toks, codeQ, limit = SUGGEST_MAX) {
  const best = []; // [score, index, row], at most `limit`, sorted
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let s = 0;
    if (toks.length) {
      const hay = ' ' + r.n;
      let wordStart = true;
      for (const t of toks) if (!hay.includes(' ' + t)) { wordStart = false; break; }
      s += r.n.startsWith(toks[0]) && wordStart ? 0 : wordStart ? 1 : 2;
    }
    if (codeQ) s += r.c === codeQ ? 0 : r.c.startsWith(codeQ) ? 1 : 2;
    if (best.length === limit && s >= best[limit - 1][0]) continue;
    let k = best.length;
    while (k > 0 && best[k - 1][0] > s) k--;
    best.splice(k, 0, [s, i, r]);
    if (best.length > limit) best.pop();
  }
  return best.map((b) => b[2]);
}

/**
 * o.fields   [{ key, el }]  the inputs that get suggestions (school name, centre number)
 * o.state()  { ready, result, toks, codeQ }  ready is false until the list has loaded, on another tab or in the centre view
 * o.pick(row), o.all()  open a centre / show the full list
 * o.h, o.icon, o.marked, o.fmt, o.listen, o.later, o.unit, o.units  helpers of the app (DOM builder, icons, highlight, number format, cleanup)
 */
export function createSuggest(o) {
  const mq = window.matchMedia(NARROW);
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const motion = () => window.MBMotion;
  const vv = window.visualViewport || null;
  const panels = o.fields.map((f) => ({ key: f.key, el: f.el, field: f.el.closest('.rs-field'), box: f.el.closest('.rs-box'), panel: null, list: null, head: null, empty: null, opts: [], rows: [], active: -1, open: false, placed: false }));
  let cur = null; // the panel that is open

  const idOf = (p) => 'rs-sug-' + p.key;
  /* A name needs two letters: one letter matches three quarters of all centres, which is no help (the list below still follows). A number needs one. */
  const MIN = { name: 2, code: 1 };
  const enough = (p) => p.el.value.replace(/[^\p{L}\p{N}]/gu, '').length >= (MIN[p.key] || 1);
  const focusedPanel = () => panels.find((p) => p.el === document.activeElement) || null;

  function build(p) {
    if (p.panel) return;
    p.head = o.h('p', { class: 'rs-sug-head', 'aria-hidden': 'true' });
    p.list = o.h('ul', { class: 'rs-sug-list', role: 'listbox', id: idOf(p), 'aria-label': 'Matching ' + o.units });
    p.empty = o.h('p', { class: 'rs-sug-empty', hidden: true });
    p.panel = o.h('div', { class: 'rs-sug', hidden: true }, p.head, p.list, p.empty);
    p.field.append(p.panel);
  }

  /* the input announces itself as a combobox only while suggestions can appear (narrow screens, school tab) */
  function arm(on) {
    for (const p of panels) {
      const el = p.el;
      if (on) {
        el.setAttribute('role', 'combobox');
        el.setAttribute('aria-autocomplete', 'list');
        el.setAttribute('aria-haspopup', 'listbox');
        el.setAttribute('aria-controls', idOf(p));
        el.setAttribute('aria-expanded', p.open ? 'true' : 'false');
        el.setAttribute('enterkeyhint', 'search');
      } else {
        for (const a of ['role', 'aria-autocomplete', 'aria-haspopup', 'aria-controls', 'aria-expanded', 'aria-activedescendant', 'enterkeyhint']) el.removeAttribute(a);
      }
    }
  }

  function close() {
    for (const p of panels) {
      if (!p.open && (!p.panel || p.panel.hidden)) continue;
      p.open = false;
      p.active = -1;
      p.placed = false;
      if (p.panel) { p.panel.hidden = true; for (const li of p.opts) li.setAttribute('aria-selected', 'false'); }
      if (mq.matches) p.el.setAttribute('aria-expanded', 'false');
      p.el.removeAttribute('aria-activedescendant');
    }
    cur = null;
  }

  /* room between the field and the bottom of what is really visible (the on-screen keyboard and the cookie notice take their part) */
  function fit(p) {
    if (!p.panel) return;
    const top = vv ? vv.offsetTop : 0;
    let bottom = top + (vv ? vv.height : window.innerHeight);
    const cookie = document.querySelector('.cookie-card');
    if (cookie && cookie.getClientRects().length) bottom = Math.min(bottom, cookie.getBoundingClientRect().top);
    const room = Math.floor(bottom - p.field.getBoundingClientRect().bottom - 16);
    p.panel.style.setProperty('--rs-sug-room', Math.max(0, room) + 'px');
    return room;
  }

  /* Bring the field up under the header the first time the panel opens (our own eased scroll, never the browser's smooth one): the tabs and the
     label above it are of no use while typing, and every pixel gained shows more of the matches. Once per time the panel opens. */
  function place(p) {
    fit(p);
    if (p.placed) return;
    p.placed = true;
    const mb = motion();
    if (!mb) return;
    const to = mb.topOf(p.field, 8);
    if (Math.abs(to - (window.scrollY || 0)) < ROOM_STEP) return;
    const done = () => { if (cur === p) fit(p); };
    const g = mb.glide(to, { keepOnKeys: true });
    if (g && g.then) g.then(done, done); else done();
  }

  function row(p, r, toks, codeT, i) {
    const meta = [[r.region, r.district].filter(Boolean).join(' · '), r.has ? '' : 'No results on this site'].filter(Boolean).join(' · ');
    const li = o.h('li', { class: 'rs-sug-opt' + (r.has ? '' : ' is-muted'), role: 'option', id: idOf(p) + '-' + i, 'aria-selected': 'false', 'aria-disabled': r.has ? null : 'true', 'data-i': String(i) },
      o.h('span', { class: 'rs-sug-ico', 'aria-hidden': 'true' }, o.icon('school')),
      o.h('span', { class: 'rs-sug-body' },
        o.h('span', { class: 'rs-sug-code rs-mono' }, o.marked(r.code, codeT)),
        o.h('span', { class: 'rs-sug-name' }, o.marked(r.name, toks)),
        meta ? o.h('small', { class: 'rs-sug-meta' }, meta) : null),
      r.has ? o.icon('arrow', 'rs-sug-go') : null);
    return li;
  }

  function render(p) {
    const st = o.state();
    const f = st.ready ? st : null;
    if (!f) return close();
    build(p);
    const value = p.el.value.trim();
    const total = f.result.length;
    const shown = rankRows(f.result, f.toks, f.codeQ);
    // the options that can be chosen: centres with results, then "See all"
    p.rows = shown;
    p.list.replaceChildren();
    p.opts = [];
    const codeT = f.codeQ ? [f.codeQ] : [];
    if (!total) {
      p.head.hidden = true;
      p.list.hidden = true;
      p.empty.hidden = false;
      p.empty.replaceChildren(o.h('strong', null, 'No ' + o.unit + ' matches “' + value + '”'), ' Check the spelling or type fewer words.');
    } else {
      p.empty.hidden = true;
      p.list.hidden = false;
      p.head.hidden = false;
      p.head.textContent = total > shown.length ? 'Best ' + o.fmt(shown.length) + ' of ' + o.fmt(total) + ' ' + o.units : o.fmt(total) + ' ' + (total === 1 ? o.unit : o.units);
      shown.forEach((r, i) => { const li = row(p, r, f.toks, codeT, i); p.list.append(li); if (r.has) p.opts.push(li); });
      if (total > shown.length) {
        const all = o.h('li', { class: 'rs-sug-opt rs-sug-all', role: 'option', id: idOf(p) + '-all', 'aria-selected': 'false', 'data-all': '1' },
          o.h('span', { class: 'rs-sug-allt' }, 'See all ' + o.fmt(total) + ' ' + o.units), o.icon('arrow', 'rs-sug-go'));
        p.list.append(all);
        p.opts.push(all);
      }
    }
    const wasOpen = p.open;
    p.open = true;
    p.active = -1;
    p.el.removeAttribute('aria-activedescendant');
    p.el.setAttribute('aria-expanded', total ? 'true' : 'false');
    p.panel.hidden = false;
    p.panel.scrollTop = 0;
    if (!wasOpen && !reduced()) { p.panel.classList.remove('is-in'); void p.panel.offsetWidth; p.panel.classList.add('is-in'); }
    cur = p;
    place(p);
  }

  /** Called by the app after the list changed, and on focus: shows, refreshes or closes the panel of the field being typed in. */
  function update() {
    if (!mq.matches) return close();
    const p = focusedPanel();
    if (!p || !enough(p)) return close();
    const st = o.state();
    if (!st.ready) return close();
    for (const q of panels) if (q !== p && q.open) close();
    render(p);
  }

  function setActive(p, i) {
    p.active = i;
    p.opts.forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    if (i < 0) { p.el.removeAttribute('aria-activedescendant'); return; }
    const li = p.opts[i];
    p.el.setAttribute('aria-activedescendant', li.id);
    // keep it clear of the sticky heading and the sticky "See all" line
    const pr = p.panel.getBoundingClientRect();
    const lr = li.getBoundingClientRect();
    const head = p.head.hidden ? 0 : p.head.offsetHeight;
    const foot = p.list.querySelector('.rs-sug-all');
    const bottomPad = foot && foot !== li ? foot.offsetHeight : 0;
    if (lr.top < pr.top + head) p.panel.scrollTop -= pr.top + head - lr.top;
    else if (lr.bottom > pr.bottom - bottomPad) p.panel.scrollTop += lr.bottom - (pr.bottom - bottomPad);
  }

  function choose(p, li) {
    if (!li || li.getAttribute('aria-disabled') === 'true') return;
    if (li.dataset.all) { close(); p.el.blur(); o.all(); return; }
    const r = p.rows[Number(li.dataset.i)];
    if (!r || !r.has) return;
    close();
    p.el.blur();
    o.pick(r);
  }

  for (const p of panels) {
    o.listen(p.el, 'focus', () => { if (enough(p)) update(); });
    o.listen(p.el, 'blur', () => { o.later(() => { if (!panels.some((x) => x.el === document.activeElement)) close(); }, 0); });
    o.listen(p.el, 'keydown', (e) => {
      if (!mq.matches) return;
      const n = p.opts.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!p.open) { update(); if (!p.open) return; }
        if (!n) return;
        e.preventDefault();
        const to = e.key === 'ArrowDown' ? (p.active + 1) % n : (p.active <= 0 ? n - 1 : p.active - 1);
        setActive(p, to);
      } else if (e.key === 'Enter') {
        // the phone keyboard's search key: a highlighted option opens, otherwise the full list is shown
        if (p.open && p.active >= 0) choose(p, p.opts[p.active]);
        else if (p.el.value.trim()) { close(); p.el.blur(); o.all(); }
      } else if (e.key === 'Escape') {
        if (p.open) { e.preventDefault(); close(); }
      }
    });
    // a tap on the panel must not take focus from the field (the keyboard would drop and the tap would miss)
    o.listen(p.field, 'mousedown', (e) => { if (p.panel && p.panel.contains(e.target)) e.preventDefault(); });
    o.listen(p.field, 'click', (e) => {
      if (!p.panel || !p.panel.contains(e.target)) return;
      choose(p, e.target.closest('[role="option"]'));
    });
    o.listen(p.field, 'mousemove', (e) => {
      const li = p.panel && p.panel.contains(e.target) ? e.target.closest('[role="option"]') : null;
      const i = li ? p.opts.indexOf(li) : -1;
      if (i >= 0 && i !== p.active) setActive(p, i);
    });
  }
  // a tap anywhere else closes it (the field may still hold focus)
  o.listen(document, 'pointerdown', (e) => { if (cur && !cur.field.contains(e.target)) close(); }, true);
  // the keyboard opening or closing, or the page moving, changes the room
  // one refit per frame (it reads the layout)
  let framed = false;
  const refit = () => { if (!cur || framed) return; framed = true; window.requestAnimationFrame(() => { framed = false; if (cur) fit(cur); }); };
  if (vv) { o.listen(vv, 'resize', refit); o.listen(vv, 'scroll', refit); }
  o.listen(window, 'scroll', refit, { passive: true });
  const onMq = () => { arm(mq.matches); if (!mq.matches) close(); };
  if (mq.addEventListener) o.listen(mq, 'change', onMq); else if (mq.addListener) { mq.addListener(onMq); }
  arm(mq.matches);

  return {
    update,
    close,
    isOpen: () => !!cur,
    /** True while a reader is typing in a field that shows suggestions: the page must stay with the field (the app does not glide to the list). */
    active: () => { const p = focusedPanel(); return mq.matches && !!p && enough(p); },
    destroy() { close(); arm(false); for (const p of panels) if (p.panel) p.panel.remove(); },
  };
}
