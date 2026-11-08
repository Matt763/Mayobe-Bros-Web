/* Mayobe Bros: moving around the lists without reloading the page.
   Two kinds of change, both with a fade and no page reload:
     A. Page numbers (Newer, Older, 1 2 3...): the old cards stay (dimmed if the page is slow) until the new page is here, then fade
        out; only the cards and the page-number bar are swapped, the page glides to the top of the list (js/motion.js, window.MBMotion:
        the far part of a long trip is one jump while the cards are hidden), the new cards rise in one after the other and keyboard
        focus moves to the first new article.
     B. Another category or label (the label buttons in the big picture, the menu, the category tiles): the title, the description,
        the buttons and the content fade out; the picture at the top cross-fades into the next one; then the new text and cards rise in.
   In both cases the address bar, page title and Back / Forward buttons follow, and the header and footer never move or flash.
   Without JavaScript, or if anything goes wrong, the links are ordinary links and the browser simply loads the page.
   Plain ES2015, no dependencies. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var main = doc.getElementById('main');
  if (!main || !window.fetch || !window.DOMParser || !window.history || !history.pushState) return;
  var BASE = root.getAttribute('data-base') || '';

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var animated = function () { return root.classList.contains('js-ready') && !(mqReduce && mqReduce.matches); };
  var LEAVE_MS = 240; // category / label switch: the words and content fade out (main.is-switching)
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  /* ----------------------------------------------------- the parts of a list page */
  function partsOf(d) {
    var m = d.getElementById('main');
    var hero = m && m.querySelector(':scope > .hero');
    var sec = hero && hero.nextElementSibling;
    var wrap = sec && sec.classList.contains('section') ? sec.querySelector(':scope > .wrap') : null;
    var nav = wrap && wrap.querySelector('nav.pagination');
    var grid = nav && nav.previousElementSibling && nav.previousElementSibling.classList.contains('grid') ? nav.previousElementSibling : null;
    return { hero: hero, wrap: wrap, nav: nav, grid: grid, title: hero ? (hero.querySelector('.hero-title') || {}).textContent : '' };
  }
  var here = partsOf(doc);
  if (!here.hero || !here.wrap) return; // not a list page
  var isTopicPage = !!here.hero.classList.contains('hero-listing');

  /* ------------------------------------------------------------- fetching */
  var cache = {};
  var ready = {}; // pages already here: no slow-load dim for them
  function load(href) {
    if (!cache[href]) {
      var p = new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error('timeout')); }, 12000);
        fetch(href, { credentials: 'same-origin' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then(function (html) { clearTimeout(timer); ready[href] = true; resolve(new DOMParser().parseFromString(html, 'text/html')); },
            function (err) { clearTimeout(timer); reject(err); });
      });
      p['catch'](function () { delete cache[href]; delete ready[href]; });
      cache[href] = p;
    }
    return cache[href];
  }

  /* Which links are changed in place:
     - page numbers and Newer / Older, on any list;
     - on a category / label page: every link to another category or label (buttons in the picture, menu, drawer, tiles). */
  function swappable(a) {
    if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download')) return null;
    var u;
    try { u = new URL(a.href, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin || u.hash && u.pathname === location.pathname) return null;
    if (a.closest('nav.pagination') && a.matches('a.page-num, a.page-btn')) return 'page';
    if (isTopicPage && u.pathname.indexOf(BASE + '/category/') === 0) return 'section';
    return null;
  }
  function warm(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (swappable(a)) load(a.href)['catch'](function () {});
  }
  ['pointerenter', 'focusin', 'touchstart'].forEach(function (ev) { doc.addEventListener(ev, warm, { capture: true, passive: true }); });
  // quietly fetch the next page once the browser is idle, so "Older" feels instant
  (window.requestIdleCallback || function (f) { return setTimeout(f, 1500); })(function () {
    var n = here.nav && here.nav.querySelector('a.page-next');
    if (n) load(n.href)['catch'](function () {});
  });

  /* ---------------------------------------------------------- small helpers */
  function numberOf(a) { return parseInt(a.textContent, 10); }
  function keyOf(a) {
    if (a.classList.contains('page-prev')) return 'prev';
    if (a.classList.contains('page-next')) return 'next';
    return numberOf(a);
  }
  // Move the highlighted page number at once, before the new page has arrived.
  function markPage(nav, key) {
    var cur = nav.querySelector('.page-num.is-current');
    var curN = cur ? numberOf(cur) : 0;
    var target = key === 'prev' ? curN - 1 : key === 'next' ? curN + 1 : key;
    each(nav.querySelectorAll('.page-num'), function (a) {
      var on = numberOf(a) === target;
      a.classList.toggle('is-current', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  // Light up the chosen label button at once.
  function markChip(a) {
    var chips = a.closest('.chips');
    if (!chips) return;
    each(chips.querySelectorAll('.chip'), function (c) { c.classList.toggle('is-active', c === a); });
  }
  // The pages come from this very site, but incoming markup is still stripped of scripts and event attributes before use.
  function clean(node) {
    var copy = node.cloneNode(true);
    each(copy.querySelectorAll('script, iframe, object, embed, link, style'), function (n) { n.remove(); });
    each(copy.querySelectorAll('*'), function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (at) {
        if (/^on/i.test(at.name) || /^\s*javascript:/i.test(at.value)) n.removeAttribute(at.name);
      });
    });
    return copy;
  }
  function fill(target, source) {
    target.textContent = '';
    each(clean(source).childNodes, function (n) { target.appendChild(doc.importNode(n, true)); });
  }
  function prepImages(scope) {
    each(scope.querySelectorAll('img.lazyfade'), function (img) {
      var done = function () { img.classList.add('is-loaded'); };
      if (img.complete) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); }
    });
  }
  function headSync(next) {
    if (next.title) doc.title = next.title;
    [['link[rel="canonical"]', 'href'], ['meta[property="og:url"]', 'content'], ['meta[name="description"]', 'content'], ['meta[name="robots"]', 'content'],
      ['meta[property="og:title"]', 'content'], ['meta[property="og:description"]', 'content'], ['meta[name="twitter:title"]', 'content'], ['meta[name="twitter:description"]', 'content']]
      .forEach(function (p) {
        var a = doc.querySelector(p[0]), b = next.querySelector(p[0]);
        if (a && b) a.setAttribute(p[1], b.getAttribute(p[1]));
      });
  }
  // the menu and the phone drawer show which category is open
  function menuSync(next) {
    [['.header-nav .nav-link', '.header-nav .nav-link'], ['.drawer-nav .drawer-link', '.drawer-nav .drawer-link']].forEach(function (p) {
      var a = doc.querySelectorAll(p[0]), b = next.querySelectorAll(p[1]);
      if (a.length !== b.length) return;
      each(a, function (el, i) {
        el.classList.toggle('is-active', b[i].classList.contains('is-active'));
        if (b[i].hasAttribute('aria-current')) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      });
    });
  }
  var status = null;
  function announce(text) {
    if (!status) { status = doc.createElement('p'); status.className = 'sr-only'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); main.appendChild(status); }
    status.textContent = text;
  }

  /* ------------------------------------------------------------ the change */
  var busy = false, queued = null;
  var shownPath = location.pathname; // the address of what is on screen (during Back / Forward the address bar is already the new one)
  var strip = function (p) { return p.replace(/page\/\d+\/$/, ''); };
  var motion = function () { return window.MBMotion || null; }; // js/motion.js (loaded first); without it every change is instant
  // the heading right above the cards (author pages, section heads), else the grid itself: where a new page starts
  function listTopOf(grid) {
    var prev = grid.previousElementSibling;
    return prev && prev.matches('.ap-list-head, .section-head') ? prev : grid;
  }
  function headerBottom() {
    var m = motion();
    if (m) return m.headerBottom();
    var h = doc.querySelector('.site-header');
    return h ? Math.max(0, Math.round(h.getBoundingClientRect().bottom)) : 0;
  }
  // While pager.js owns the history entries the browser must not restore the scroll position itself (that caused a
  // Back "yo-yo"). It is handed back on pagehide, so a normal Back from an article still lands where the reader was.
  function ownScroll() { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; }
  window.addEventListener('pagehide', function () { if ('scrollRestoration' in history) history.scrollRestoration = 'auto'; });
  window.addEventListener('pageshow', function () { if (history.state && history.state.mbPager) ownScroll(); });

  // the cheap header and the pressed button stay until the glide has ended, unless another change has started
  function settle() {
    if (busy) return;
    root.classList.remove('is-paging');
    each(doc.querySelectorAll('.page-num.is-pressed, .page-btn.is-pressed'), function (a) { a.classList.remove('is-pressed'); });
  }

  function go(href, key, push, chip) {
    if (new URL(href, location.href).origin !== location.origin) { location.href = href; return; } // only ever fetch our own pages
    if (busy) { queued = { href: href, key: key, push: push, chip: chip }; return; }
    if (push && href === location.href) { settle(); return; }
    busy = true;
    root.classList.add('is-paging');
    here = partsOf(doc);
    var target = new URL(href, location.href);
    var kindPage = !!(here.nav && here.grid && strip(target.pathname) === strip(shownPath)); // same list, another page number
    if (kindPage && (key == null || key === 'section')) { var pm = /page\/(\d+)\/$/.exec(target.pathname); key = pm ? Number(pm[1]) : 1; }
    var fail = function () { location.href = href; }; // anything unexpected: do a normal page load
    var m = motion();
    if (kindPage) {
      // the old cards stay (dimmed if the page is slow) until the new page is here; only then do they fade out
      var grid = here.grid;
      markPage(here.nav, key);
      here.nav.classList.add('is-loading');
      grid.setAttribute('aria-busy', 'true');
      if (m && !ready[href]) m.wait(grid, true);
      load(href).then(function (next) {
        return (m ? m.leave(grid) : Promise.resolve()).then(function () { return next; });
      }).then(function (next) { swap(next, href, key, push, chip); })['catch'](fail);
      return;
    }
    if (chip) markChip(chip);
    var leave = new Promise(function (resolve) {
      if (!animated()) { resolve(); return; }
      main.classList.add('is-switching');
      setTimeout(resolve, LEAVE_MS);
    });
    Promise.all([load(href), leave]).then(function (r) { swap(r[0], href, key, push, chip); })['catch'](fail);
  }

  function finish(moved) {
    busy = false;
    main.classList.remove('is-switching');
    var p = partsOf(doc);
    if (p.nav) p.nav.classList.remove('is-loading');
    if (p.grid) p.grid.removeAttribute('aria-busy');
    Promise.resolve(moved).then(settle, settle);
    if (queued) { var q = queued; queued = null; go(q.href, q.key, q.push, q.chip); }
  }

  function swap(next, href, key, push, chip) {
    var n = partsOf(next);
    if (!n.hero || !n.wrap) throw new Error('unexpected page');
    var cur = partsOf(doc);
    var sameList = cur.nav && cur.grid && n.nav && n.grid && n.title === cur.title;
    if (!sameList && !(n.hero.classList.contains('hero-listing') && cur.hero.classList.contains('hero-listing'))) throw new Error('not the same kind of page');

    // address bar, title and canonical address follow the page
    if (push) {
      ownScroll();
      if (!(history.state && history.state.mbPager)) history.replaceState({ mbPager: true }, '', location.href);
      history.pushState({ mbPager: true }, '', href);
    }
    shownPath = new URL(href, location.href).pathname;
    headSync(next);
    menuSync(next);

    var fx = animated();
    finish(sameList ? swapPage(cur, n, push, fx) : swapSection(cur, n, chip, fx));
  }

  // A. same list, other page number: only the cards and the number bar change, all in this one task (no layout shift)
  function swapPage(cur, n, push, fx) {
    var m = motion();
    var grid = cur.grid, nav = cur.nav;
    var listTop = listTopOf(grid);
    var wasAbove = listTop.getBoundingClientRect().top < headerBottom();
    var target = m ? m.topOf(listTop) : 0; // read before the swap, while the old cards still hold the page

    fill(grid, n.grid); // the grid keeps is-visible, so the reveal system leaves the new cards alone
    grid.classList.add('is-visible');
    prepImages(grid);
    if (m) m.enter(grid.children, grid); else grid.classList.remove('mo-wait');
    doc.dispatchEvent(new CustomEvent('mb:content', { detail: { root: grid } })); // lets js/engage.js fill in comment counts

    // the page-number bar: the highlighted number pops, changed numbers fade in; the note (role="status") says the page once
    var bar = nav.querySelector('.pagination-bar'), note = nav.querySelector('.pagination-note');
    var nextBar = n.nav.querySelector('.pagination-bar'), nextNote = n.nav.querySelector('.pagination-note');
    if (bar && nextBar) fill(bar, nextBar);
    if (note && nextNote) note.textContent = nextNote.textContent;
    if (fx) { nav.classList.add('is-updating'); setTimeout(function () { nav.classList.remove('is-updating'); }, 800); }

    // focus follows the reader to the first new article, when the change came from the page-number bar
    var ae = doc.activeElement;
    if (push && (!ae || ae === doc.body || !doc.body.contains(ae) || nav.contains(ae))) {
      var first = grid.querySelector('a.card-link');
      if (first) first.focus({ preventScroll: true });
    }

    // bring the top of the list into view: the cards are hidden at this moment, so the far part of the trip is one jump
    if (!wasAbove) return null;
    if (m) return m.glide(target, { covered: true });
    listTop.scrollIntoView({ block: 'start' });
    return null;
  }

  // B. another category or label: the picture cross-fades, the text and the content are replaced
  function swapSection(cur, n, chip, fx) {
    var m = motion();
    var hero = cur.hero, inner = hero.querySelector('.hero-inner'), wrap = cur.wrap;
    var nextInner = n.hero.querySelector('.hero-inner');

    // the picture: the new one fades in on top of the old one, which is then removed
    var oldImg = hero.querySelector('.hero-img'), newSrc = n.hero.querySelector('.hero-img');
    if (oldImg && newSrc && (newSrc.getAttribute('src') !== oldImg.getAttribute('src'))) {
      var img = doc.importNode(newSrc, true);
      img.removeAttribute('fetchpriority');
      img.style.animation = 'none';
      if (fx) { img.style.opacity = '0'; img.style.transition = 'opacity 0.7s ease'; }
      oldImg.parentNode.insertBefore(img, oldImg.nextSibling);
      var shown = function () {
        if (!img.parentNode) return;
        void img.offsetWidth;
        img.style.opacity = '1';
        setTimeout(function () { if (oldImg.parentNode) oldImg.remove(); img.style.transition = ''; img.style.animation = ''; }, fx ? 760 : 0);
      };
      var decoded = img.decode ? img.decode()['catch'](function () {}) : Promise.resolve();
      Promise.race([decoded, new Promise(function (r) { setTimeout(r, 1500); })]).then(shown);
    }

    // the words and buttons in the picture, then the content below it
    var farDown = window.scrollY > hero.offsetHeight; // read before the swap
    main.classList.remove('is-switching');
    fill(inner, nextInner);
    fill(wrap, n.wrap);
    each(wrap.children, function (c, i) { if (!c.classList.contains('grid')) { c.style.setProperty('--i', Math.min(i, 6)); c.classList.add('is-new'); } });
    var grid = wrap.querySelector(':scope > .grid');
    if (grid) {
      grid.classList.add('is-visible');
      prepImages(grid);
      if (m) m.enter(grid.children, grid);
    }
    if (fx) setTimeout(function () { each(wrap.querySelectorAll('.is-new'), function (c) { c.classList.remove('is-new'); }); }, 1200);
    doc.dispatchEvent(new CustomEvent('mb:content', { detail: { root: wrap } })); // lets js/engage.js fill in comment counts

    // keep keyboard focus on the button that was chosen
    var title = (inner.querySelector('.hero-title') || {}).textContent || '';
    if (chip) {
      var again = inner.querySelector('.chip[href="' + chip.getAttribute('href') + '"]');
      if (again && (doc.activeElement === doc.body || !doc.body.contains(doc.activeElement) || chip === doc.activeElement)) again.focus({ preventScroll: true });
    }
    var drawerClose = doc.querySelector('.drawer[aria-hidden="false"] [data-drawer-close]');
    if (drawerClose) drawerClose.click(); // the phone menu closes after a choice
    announce(title + '. ' + ((inner.querySelector('.hero-count') || {}).textContent || ''));

    // if the reader had scrolled far down, bring them back to the top of the new page (the content is hidden: covered)
    if (!farDown) return null;
    if (m) return m.glide(0, { covered: true });
    hero.scrollIntoView({ block: 'start' });
    return null;
  }

  /* ------------------------------------------------------------- the events */
  // captured first, so the site's own "fade before leaving" fallback in js/site.js does not take over these clicks
  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let "open in new tab" work
    var a = e.target.closest ? e.target.closest('a') : null;
    var kind = swappable(a);
    if (!kind) return;
    e.preventDefault();
    if (a.classList.contains('is-current')) return;
    if (kind === 'page') { a.classList.add('is-pressed'); go(a.href, keyOf(a), true, null); }
    else go(a.href, 'section', true, a.classList.contains('chip') ? a : null);
  }, true);
  // Back and Forward move through the pages the reader already opened, also without a reload
  window.addEventListener('popstate', function () {
    if (history.state && history.state.mbPager) go(location.href, 'section', false, null);
  });
})();
