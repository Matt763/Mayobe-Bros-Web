/* Mayobe Bros: tables in articles (loaded only on pages that have one).
   1. A table wider than the screen scrolls sideways inside its own box (.table-wrapper, set up by the build). This script adds a short hint
      above such a table ("Swipe sideways to see the whole table"), only while the table really overflows, and keeps it right on resize.
   2. A carousel of tables (<section data-tbl-carousel>, written from ":::carousel" in a post): without script, or below 64rem, the groups are simply
      stacked, each table scrolling sideways. On a large screen this script shows ONE group at a time with Previous / Next buttons, a chip for each
      group and the arrow keys; every group stays in the page text for readers, search engines and the Listen button.
   No storage, no cookies, no network. Motion: opacity only (a fade), off under prefers-reduced-motion; the page moves only through MBMotion.glide. */
(function () {
  'use strict';
  var LARGE = '(min-width: 64rem)';
  var reduced = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  /* ---- 1. the sideways hint ---- */
  function hints() {
    var wraps = document.querySelectorAll('.article-content .table-wrapper');
    var list = [];
    Array.prototype.forEach.call(wraps, function (w) {
      var hint = w.previousElementSibling && w.previousElementSibling.classList.contains('table-hint') ? w.previousElementSibling : null;
      if (!hint) {
        hint = document.createElement('p');
        hint.className = 'table-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.hidden = true;
        hint.textContent = 'Swipe sideways to see the whole table';
        w.parentNode.insertBefore(hint, w);
      }
      list.push([w, hint]);
    });
    function check() { list.forEach(function (p) { p[1].hidden = !(p[0].scrollWidth > p[0].clientWidth + 2); }); }
    check();
    var t = 0;
    window.addEventListener('resize', function () { window.clearTimeout(t); t = window.setTimeout(check, 120); });
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { window.clearTimeout(t); t = window.setTimeout(check, 60); }); list.forEach(function (p) { ro.observe(p[0]); }); }
  }

  /* ---- 2. the carousel ---- */
  function carousel(root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll(':scope > .tbl-slide'));
    if (slides.length < 2) return;
    var mq = window.matchMedia(LARGE);
    var built = false, ui = null, cur = 0;

    function build() {
      built = true;
      var bar = document.createElement('div');
      bar.className = 'tbl-chips';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Choose a group');
      var chips = slides.map(function (sl, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tbl-chip';
        b.textContent = sl.getAttribute('data-title') || String(i + 1);
        b.addEventListener('click', function () { go(i, true); });
        bar.appendChild(b);
        return b;
      });
      var nav = document.createElement('div');
      nav.className = 'tbl-nav';
      var prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'tbl-btn tbl-prev';
      var next = document.createElement('button');
      next.type = 'button';
      next.className = 'tbl-btn tbl-next';
      var count = document.createElement('span');
      count.className = 'tbl-count';
      count.setAttribute('aria-hidden', 'true');
      nav.appendChild(prev); nav.appendChild(count); nav.appendChild(next);
      var live = document.createElement('p');
      live.className = 'sr-only';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      prev.addEventListener('click', function () { go(cur - 1, true); });
      next.addEventListener('click', function () { go(cur + 1, true); });
      root.addEventListener('keydown', function (e) {
        if (!root.classList.contains('is-on') || !(e.target.closest && e.target.closest('.tbl-chips, .tbl-nav'))) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        var to = (cur + (e.key === 'ArrowRight' ? 1 : -1) + slides.length) % slides.length;
        go(to, false);
        if (e.target.classList.contains('tbl-chip')) chips[to].focus({ preventScroll: true });
      });
      root.insertBefore(bar, root.firstChild);
      root.appendChild(nav);
      root.appendChild(live);
      ui = { bar: bar, chips: chips, prev: prev, next: next, count: count, live: live };
    }

    function title(i) { return slides[i].getAttribute('data-title') || ''; }

    function go(i, bring) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      var changed = i !== cur;
      cur = i;
      slides.forEach(function (sl, k) {
        var on = k === i;
        sl.classList.toggle('is-active', on);
        sl.classList.remove('is-in');
        if (on && changed && !reduced()) { void sl.offsetWidth; sl.classList.add('is-in'); }
      });
      if (!ui) return;
      ui.chips.forEach(function (b, k) { if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      // keep the chosen chip in the middle of the sliding row (the row's own scroll, never the page's)
      var chip = ui.chips[i], row = ui.bar;
      if (row.scrollWidth > row.clientWidth) row.scrollTo({ left: Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2), behavior: 'instant' });
      ui.prev.disabled = i === 0;
      ui.next.disabled = i === slides.length - 1;
      ui.prev.textContent = '← ' + (i > 0 ? title(i - 1) : 'Previous');
      ui.next.textContent = (i < slides.length - 1 ? title(i + 1) : 'Next') + ' →';
      ui.prev.setAttribute('aria-label', i > 0 ? 'Previous group: ' + title(i - 1) : 'Previous group');
      ui.next.setAttribute('aria-label', i < slides.length - 1 ? 'Next group: ' + title(i + 1) : 'Next group');
      ui.count.textContent = (i + 1) + ' of ' + slides.length;
      if (changed) ui.live.textContent = title(i) + ', group ' + (i + 1) + ' of ' + slides.length + '.';
      // keep the top of the carousel in view after a press at the bottom (our own eased scroll, never the browser's smooth scroll)
      if (bring && changed && window.MBMotion) {
        var top = root.getBoundingClientRect().top;
        var head = document.querySelector('.site-header');
        var under = head ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 0;
        if (top < under) window.MBMotion.glide(window.MBMotion.topOf(root, 12));
      }
    }

    function sync() {
      if (mq.matches) {
        if (!built) build();
        root.classList.add('is-on');
        go(cur, false);
      } else {
        root.classList.remove('is-on');
        slides.forEach(function (sl) { sl.classList.remove('is-active', 'is-in'); });
      }
    }

    // a link to something inside a hidden group (the address bar, a contents link) opens that group first
    function reveal() {
      if (!mq.matches || !location.hash) return;
      var id = decodeURIComponent(location.hash.slice(1));
      var el = id && document.getElementById(id);
      if (!el || !root.contains(el)) return;
      var k = slides.findIndex(function (sl) { return sl === el || sl.contains(el); });
      if (k >= 0 && k !== cur) {
        go(k, false);
        // instant, never the browser's smooth scroll (the page has html { scroll-behavior: smooth })
        window.scrollTo({ top: window.MBMotion ? window.MBMotion.topOf(el, 12) : 0, left: 0, behavior: 'instant' });
      }
    }

    if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
    window.addEventListener('hashchange', reveal);
    sync();
    reveal();
  }

  function init() {
    hints();
    Array.prototype.forEach.call(document.querySelectorAll('[data-tbl-carousel]'), carousel);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
