/* Mayobe Bros: moving around the lists without reloading the page.
   Two kinds of change, both with a fade and no page reload:
     A. Page numbers (Newer, Older, 1 2 3...): the old cards fade out, only the cards and the page-number bar are swapped, and the new
        cards slide in one after the other.
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
  var LEAVE_MS = 240;
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
  function load(href) {
    if (!cache[href]) {
      var p = new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error('timeout')); }, 12000);
        fetch(href, { credentials: 'same-origin' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then(function (html) { clearTimeout(timer); resolve(new DOMParser().parseFromString(html, 'text/html')); },
            function (err) { clearTimeout(timer); reject(err); });
      });
      p['catch'](function () { delete cache[href]; });
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

  function go(href, key, push, chip) {
    if (new URL(href, location.href).origin !== location.origin) { location.href = href; return; } // only ever fetch our own pages
    if (busy) { queued = { href: href, key: key, push: push, chip: chip }; return; }
    if (push && href === location.href) return;
    busy = true;
    root.classList.add('is-paging');
    here = partsOf(doc);
    var target = new URL(href, location.href);
    var kindPage = !!(here.nav && here.grid && strip(target.pathname) === strip(shownPath)); // same list, another page number
    if (kindPage && (key == null || key === 'section')) { var pm = /page\/(\d+)\/$/.exec(target.pathname); key = pm ? Number(pm[1]) : 1; }
    if (kindPage) {
      markPage(here.nav, key);
      here.nav.classList.add('is-loading');
      here.grid.setAttribute('aria-busy', 'true');
    } else if (chip) markChip(chip);
    var leave = new Promise(function (resolve) {
      if (!animated()) { resolve(); return; }
      if (kindPage) here.grid.classList.add('is-leaving'); else main.classList.add('is-switching');
      setTimeout(resolve, LEAVE_MS);
    });
    Promise.all([load(href), leave]).then(function (r) {
      swap(r[0], href, key, push, chip);
    })['catch'](function () {
      location.href = href; // anything unexpected: do a normal page load
    });
  }

  function finish() {
    busy = false;
    main.classList.remove('is-switching');
    setTimeout(function () { if (!busy) root.classList.remove('is-paging'); }, 1100); // keep the cheap header until the glide has ended
    var p = partsOf(doc);
    if (p.nav) p.nav.classList.remove('is-loading');
    if (p.grid) p.grid.removeAttribute('aria-busy');
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
      if (!(history.state && history.state.mbPager)) history.replaceState({ mbPager: true }, '', location.href);
      history.pushState({ mbPager: true }, '', href);
    }
    shownPath = new URL(href, location.href).pathname;
    headSync(next);
    menuSync(next);

    var fx = animated();
    if (sameList) swapPage(cur, n, key, fx); else swapSection(cur, n, next, chip, fx);
    finish();
  }

  // A. same list, other page number: only the cards and the number bar change
  function swapPage(cur, n, key, fx) {
    var grid = cur.grid, nav = cur.nav;
    var oldH = grid.offsetHeight;
    grid.classList.remove('is-visible', 'is-leaving', 'is-entering');
    fill(grid, n.grid);
    each(grid.children, function (c, i) { c.style.setProperty('--i', Math.min(i, 8)); });
    prepImages(grid);
    if (fx) {
      grid.style.minHeight = oldH + 'px'; // the page eases to its new height instead of jumping
      void grid.offsetHeight; // the new cards start hidden...
      grid.classList.add('is-entering', 'is-visible'); // ...and then fade in one by one
      grid.style.transition = 'min-height 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
      grid.style.minHeight = '0px';
      setTimeout(function () { grid.classList.remove('is-entering'); grid.style.transition = ''; grid.style.minHeight = ''; }, 1000);
    } else {
      grid.classList.add('is-visible');
    }
    doc.dispatchEvent(new CustomEvent('mb:content', { detail: { root: grid } })); // lets js/engage.js fill in comment counts

    // the page-number bar: the highlighted number pops, changed numbers fade in
    var bar = nav.querySelector('.pagination-bar'), note = nav.querySelector('.pagination-note');
    var nextBar = n.nav.querySelector('.pagination-bar'), nextNote = n.nav.querySelector('.pagination-note');
    if (bar && nextBar) fill(bar, nextBar);
    if (note && nextNote) note.textContent = nextNote.textContent;
    if (fx) { nav.classList.add('is-updating'); setTimeout(function () { nav.classList.remove('is-updating'); }, 800); }

    // bring the top of the list into view, then keep keyboard focus where the reader was
    var hh = (doc.querySelector('.site-header') || { getBoundingClientRect: function () { return { height: 0 }; } }).getBoundingClientRect().height;
    grid.style.scrollMarginTop = '1rem';
    if (grid.getBoundingClientRect().top < hh + 8) grid.scrollIntoView({ behavior: fx ? 'smooth' : 'auto', block: 'start' });
    var keep = null;
    if (key === 'prev' || key === 'next') keep = nav.querySelector('a.page-' + key);
    else if (typeof key === 'number') keep = nav.querySelector('.page-num[aria-label="Page ' + key + '"]');
    keep = keep || nav.querySelector('.page-num.is-current');
    if (keep && doc.activeElement && (doc.activeElement === doc.body || !doc.body.contains(doc.activeElement) || nav.contains(doc.activeElement))) keep.focus({ preventScroll: true });
    announce((nav.querySelector('.pagination-note') || {}).textContent || '');
  }

  // B. another category or label: the picture cross-fades, the text and the content are replaced
  function swapSection(cur, n, next, chip, fx) {
    var hero = cur.hero, inner = hero.querySelector('.hero-inner'), wrap = cur.wrap;
    var nextInner = n.hero.querySelector('.hero-inner');
    var oldH = wrap.offsetHeight;

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
    main.classList.remove('is-switching');
    fill(inner, nextInner);
    fill(wrap, n.wrap);
    each(wrap.children, function (c, i) { c.style.setProperty('--i', Math.min(i, 6)); if (!c.classList.contains('grid')) c.classList.add('is-new'); });
    var grid = wrap.querySelector(':scope > .grid');
    if (grid) {
      grid.classList.remove('is-visible', 'is-leaving', 'is-entering');
      each(grid.children, function (c, i) { c.style.setProperty('--i', Math.min(i, 8)); });
      prepImages(grid);
    }
    if (fx) {
      wrap.style.minHeight = oldH + 'px'; // the page eases to its new height instead of jumping
      void wrap.offsetHeight;
      if (grid) grid.classList.add('is-entering', 'is-visible');
      wrap.style.transition = 'min-height 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
      wrap.style.minHeight = '0px';
      setTimeout(function () { wrap.style.transition = ''; wrap.style.minHeight = ''; if (grid) grid.classList.remove('is-entering'); each(wrap.querySelectorAll('.is-new'), function (c) { c.classList.remove('is-new'); }); }, 1200);
    } else if (grid) grid.classList.add('is-visible');
    doc.dispatchEvent(new CustomEvent('mb:content', { detail: { root: wrap } })); // lets js/engage.js fill in comment counts

    // if the reader had scrolled far down, bring them back to the start of the new list
    var hh = (doc.querySelector('.site-header') || { getBoundingClientRect: function () { return { height: 0 }; } }).getBoundingClientRect().height;
    if (wrap.getBoundingClientRect().top < hh - 40 && window.scrollY > hero.offsetHeight) window.scrollTo({ top: Math.max(0, hero.offsetTop), behavior: fx ? 'smooth' : 'auto' });

    // keep keyboard focus on the button that was chosen
    var title = (inner.querySelector('.hero-title') || {}).textContent || '';
    if (chip) {
      var again = inner.querySelector('.chip[href="' + chip.getAttribute('href') + '"]');
      if (again && (doc.activeElement === doc.body || !doc.body.contains(doc.activeElement) || chip === doc.activeElement)) again.focus({ preventScroll: true });
    }
    var drawerClose = doc.querySelector('.drawer[aria-hidden="false"] [data-drawer-close]');
    if (drawerClose) drawerClose.click(); // the phone menu closes after a choice
    announce(title + '. ' + ((inner.querySelector('.hero-count') || {}).textContent || ''));
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
    if (kind === 'page') go(a.href, keyOf(a), true, null);
    else go(a.href, 'section', true, a.classList.contains('chip') ? a : null);
  }, true);
  // Back and Forward move through the pages the reader already opened, also without a reload
  window.addEventListener('popstate', function () {
    if (history.state && history.state.mbPager) go(location.href, 'section', false, null);
  });
})();
