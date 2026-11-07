/* Mayobe Bros — site behaviour. Plain JavaScript, no dependencies.
   The site is fully readable without this file. It adds: theme choice, the mobile menu, search,
   the cookie notice, sharing, the Plyr video player, form handling and smooth motion.
   ("Listen to this article" lives in js/listen.js.) */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var BASE = root.getAttribute('data-base') || '';
  var $ = function (sel, ctx) { return (ctx || doc).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); };
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  root.classList.add('js-ready');

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* storage may be blocked */ }
    return null;
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------------------------------------------------------------- theme
     Three states: auto (follow the device, the default), light, dark.
     "auto" stores nothing, so the site always starts exactly as the device is set. */
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function mode() { var t = store('theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }
  function applyTheme() {
    var m = mode();
    var dark = m === 'dark' || (m === 'auto' && mq && mq.matches);
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', m === 'light');
    var names = { auto: 'Theme: follows your device', light: 'Theme: light', dark: 'Theme: dark' };
    var next = { auto: 'light', light: 'dark', dark: 'device setting' };
    $$('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-label', names[m] + '. Click to switch to ' + next[m] + '.');
      b.setAttribute('title', names[m]);
    });
  }
  applyTheme();
  $$('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var m = mode();
      store('theme', m === 'auto' ? 'light' : m === 'light' ? 'dark' : null);
      applyTheme();
    });
  });
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (mode() === 'auto') applyTheme(); });

  /* ------------------------------------------------------ header and focus */
  var header = $('.site-header');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  function trapTab(container, e) {
    if (e.key !== 'Tab') return;
    var items = $$(FOCUSABLE, container).filter(function (n) { return n.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------------------------------------------------------- mobile drawer */
  var drawer = $('#drawer');
  var backdrop = $('.drawer-backdrop');
  var drawerOpener = null;
  function setDrawer(open) {
    if (!drawer) return;
    drawer.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    $$('[data-drawer-open]').forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    doc.body.classList.toggle('no-scroll', open);
    if (open) { var c = $('[data-drawer-close]', drawer); if (c) c.focus(); }
    else if (drawerOpener) { drawerOpener.focus(); drawerOpener = null; }
  }
  $$('[data-drawer-open]').forEach(function (b) { b.addEventListener('click', function () { drawerOpener = b; setDrawer(true); }); });
  $$('[data-drawer-close]').forEach(function (b) { b.addEventListener('click', function () { setDrawer(false); }); });
  if (drawer) {
    drawer.addEventListener('keydown', function (e) { trapTab(drawer, e); });
    window.matchMedia('(min-width: 1280px)').addEventListener('change', function (e) { if (e.matches) setDrawer(false); });
  }

  /* --------------------------------------------------------------- search */
  var index = null;
  var indexPromise = null;
  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (!indexPromise) {
      indexPromise = fetch(BASE + '/data/search.json')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { index = d; return d; });
      indexPromise.catch(function () { indexPromise = null; });
    }
    return indexPromise;
  }
  function tokens(q) { return q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function search(q, limit) {
    var terms = tokens(q);
    if (!terms.length || !index) return [];
    var out = [];
    index.forEach(function (p) {
      var title = p.t.toLowerCase(), tags = (p.g || []).join(' ').toLowerCase();
      var cat = (p.c + ' ' + p.l).toLowerCase(), ex = (p.e || '').toLowerCase(), body = (p.x || '').toLowerCase();
      var score = 0;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i], s = 0;
        if (title.indexOf(t) > -1) s += 6 + (title.indexOf(t) === 0 ? 3 : 0);
        if (tags.indexOf(t) > -1) s += 4;
        if (cat.indexOf(t) > -1) s += 3;
        if (ex.indexOf(t) > -1) s += 2;
        if (body.indexOf(t) > -1) s += 1;
        if (!s) return;
        score += s;
      }
      out.push({ p: p, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score || (a.p.d < b.p.d ? 1 : -1); });
    return out.slice(0, limit).map(function (x) { return x.p; });
  }
  function highlight(text, terms) {
    var frag = doc.createDocumentFragment();
    if (!terms.length) { frag.appendChild(doc.createTextNode(text)); return frag; }
    var re = new RegExp('(' + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'ig');
    text.split(re).forEach(function (part, i) {
      if (i % 2) frag.appendChild(el('mark', '', part)); else if (part) frag.appendChild(doc.createTextNode(part));
    });
    return frag;
  }
  function resultNode(p, terms) {
    var a = el('a', 'result');
    a.href = p.u;
    if (p.i) { var img = el('img'); img.src = p.i; img.alt = ''; img.loading = 'lazy'; a.appendChild(img); }
    var body = el('div', 'result-body');
    body.appendChild(el('div', 'result-cat', p.c + (p.l ? ' · ' + p.l : '')));
    var title = el('div', 'result-title'); title.appendChild(highlight(p.t, terms)); body.appendChild(title);
    if (p.e) { var ex = el('div', 'result-ex'); ex.appendChild(highlight(p.e, terms)); body.appendChild(ex); }
    a.appendChild(body);
    return a;
  }

  var modal = $('#search-modal');
  var input = $('#search-input');
  var results = $('#search-results');
  var searchOpener = null;
  var timer = null;
  function renderModal() {
    var q = input.value.trim();
    results.textContent = '';
    if (!index) { results.appendChild(el('p', 'search-hint', 'Loading…')); return; }
    var terms = tokens(q);
    var list = terms.length ? search(q, 6) : index.slice(0, 5);
    if (!terms.length) results.appendChild(el('p', 'search-hint', 'Latest articles. Start typing to search ' + index.length + ' posts.'));
    if (!list.length) { results.appendChild(el('p', 'search-hint', 'No articles found for “' + q + '”.')); return; }
    list.forEach(function (p) { results.appendChild(resultNode(p, terms)); });
    if (terms.length) {
      var all = el('a', 'search-all', 'See all results for “' + q + '”');
      all.href = BASE + '/search/?q=' + encodeURIComponent(q);
      results.appendChild(all);
    }
  }
  function openSearch() {
    if (!modal) return;
    searchOpener = doc.activeElement;
    modal.hidden = false;
    doc.body.classList.add('no-scroll');
    input.focus();
    renderModal();
    loadIndex().then(renderModal).catch(function () {
      results.textContent = '';
      results.appendChild(el('p', 'search-hint', 'Search is unavailable right now.'));
    });
  }
  function closeSearch() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    doc.body.classList.remove('no-scroll');
    if (searchOpener && searchOpener.focus) searchOpener.focus();
  }
  if (modal) {
    $$('[data-search-open]').forEach(function (b) { b.addEventListener('click', openSearch); });
    $$('[data-search-close]').forEach(function (b) { b.addEventListener('click', closeSearch); });
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(renderModal, 80); });
    modal.addEventListener('keydown', function (e) {
      trapTab(modal, e);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var items = $$('.result, .search-all', results);
        if (!items.length) return;
        e.preventDefault();
        var i = items.indexOf(doc.activeElement);
        if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
        else if (i <= 0) input.focus(); else items[i - 1].focus();
      }
    });
  }
  doc.addEventListener('keydown', function (e) {
    var tag = (doc.activeElement && doc.activeElement.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (doc.activeElement && doc.activeElement.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (modal) { if (modal.hidden) openSearch(); else closeSearch(); } }
    else if (e.key === '/' && !typing && modal) { e.preventDefault(); openSearch(); }
    else if (e.key === 'Escape') { closeSearch(); setDrawer(false); }
  });

  var pageInput = $('#search-page-input');
  if (pageInput) {
    var pageResults = $('#search-page-results');
    var pageCount = $('#search-page-count');
    var runPage = function () {
      var q = pageInput.value.trim();
      pageResults.textContent = '';
      if (!q) { pageCount.textContent = 'Type something to search.'; return; }
      loadIndex().then(function () {
        var list = search(q, 100);
        var terms = tokens(q);
        pageCount.textContent = list.length ? list.length + (list.length === 1 ? ' result' : ' results') + ' for “' + q + '”' : 'No articles found for “' + q + '”. Try a different word.';
        // 15 results at a time; a button shows the next 15
        var shown = 0, BATCH = 15, more = null;
        var showNext = function () {
          if (more) { more.remove(); more = null; }
          var firstNew = null;
          list.slice(shown, shown + BATCH).forEach(function (p) { var n = resultNode(p, terms); if (!firstNew) firstNew = n; pageResults.appendChild(n); });
          if (shown && firstNew) firstNew.focus({ preventScroll: false }); // keyboard users land on the first new result
          shown = Math.min(list.length, shown + BATCH);
          if (shown < list.length) {
            more = el('button', 'btn btn-outline search-more', 'Show more results (' + (list.length - shown) + ' left)');
            more.type = 'button';
            more.addEventListener('click', showNext);
            pageResults.appendChild(more);
          }
        };
        showNext();
      }).catch(function () { pageCount.textContent = 'Search is unavailable right now.'; });
    };
    pageInput.value = new URLSearchParams(location.search).get('q') || '';
    runPage();
    pageInput.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = pageInput.value.trim();
      history.replaceState(null, '', BASE + '/search/' + (q ? '?q=' + encodeURIComponent(q) : ''));
      runPage();
    });
  }

  /* -------------------------------------------------------- reveal motion */
  var revealEls = $$('[data-reveal], [data-reveal-stagger]');
  if (revealEls.length && 'IntersectionObserver' in window && !reduceMotion) {
    revealEls.forEach(function (n) {
      $$(':scope > *', n).forEach(function (c, i) { c.style.setProperty('--i', Math.min(i, 8)); });
      if (n.getBoundingClientRect().top < window.innerHeight * 0.92) n.classList.add('is-visible');
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
    // threshold 0, not a share of the element: a block taller than about 16 screens can never show 6% of itself at once,
    // so it stayed at opacity 0 (a blank section until a reload restored the scroll position).
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    revealEls.forEach(function (n) { if (!n.classList.contains('is-visible')) io.observe(n); });
  } else {
    root.classList.remove('js-ready');
  }
  // fade pictures in as they finish loading
  $$('img.lazyfade').forEach(function (img) {
    var done = function () { img.classList.add('is-loaded'); };
    if (img.complete) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); }
  });

  /* --------------------------------------- button press ripple + page fades */
  doc.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('.btn');
    if (!b || reduceMotion) return;
    var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
    var s = el('span', 'ripple');
    s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d / 2) + 'px';
    s.style.top = (e.clientY - r.top - d / 2) + 'px';
    b.appendChild(s);
    setTimeout(function () { s.remove(); }, 650);
  });
  var nativeTransitions = 'PageSwapEvent' in window; // browsers with built-in cross-page transitions
  function internalLink(a) {
    if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download')) return false;
    var u = new URL(a.href, location.href);
    return u.origin === location.origin && !(u.pathname === location.pathname && u.search === location.search) && !/\.(xml|json|txt|pdf)$/i.test(u.pathname);
  }
  var prefetched = {};
  function prefetch(a) {
    if (!internalLink(a) || prefetched[a.href] || a.closest('.pagination')) return; // the pager script fetches those itself
    prefetched[a.href] = 1;
    var l = el('link'); l.rel = 'prefetch'; l.href = a.href; doc.head.appendChild(l);
  }
  doc.addEventListener('pointerenter', function (e) { var a = e.target.closest && e.target.closest('a'); if (a) prefetch(a); }, true);
  doc.addEventListener('touchstart', function (e) { var a = e.target.closest && e.target.closest('a'); if (a) prefetch(a); }, { passive: true, capture: true });
  if (!nativeTransitions && !reduceMotion) {
    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a');
      if (!internalLink(a) || (a.hash && a.pathname === location.pathname)) return;
      e.preventDefault();
      doc.body.classList.add('is-leaving');
      setTimeout(function () { location.href = a.href; }, 180);
    });
    window.addEventListener('pageshow', function () { doc.body.classList.remove('is-leaving'); });
  }

  /* ----------------------------------------------- cookie notice and ads */
  var CONSENT = 'mayobebros-cookie-consent';
  function loadAds() {
    var id = root.getAttribute('data-adsense');
    if (!id || !doc.body.hasAttribute('data-ads') || store(CONSENT) !== 'accepted' || window.__mbAds) return;
    window.__mbAds = true;
    var s = el('script'); s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(id);
    s.onerror = function () { adSlots(false); }; // blocked by the browser or an ad blocker: no empty "Advertisements" box
    doc.head.appendChild(s);
    adSlots(true);
  }
  /* Google Tag Manager (analytics): loaded only after the reader pressed Accept, on every page. */
  function loadTags() {
    var id = root.getAttribute('data-gtm');
    if (!id || store(CONSENT) !== 'accepted' || window.__mbGtm) return;
    window.__mbGtm = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = el('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id);
    doc.head.appendChild(s);
  }
  /* The labelled ad slot in the article sidebar (only in the page when ads are switched on in site.config.json).
     It is shown only after the reader pressed Accept. Google does not run an ad request for a unit that is hidden when it
     asks, so the box is shown first and taken away again when no ad comes back (data-ad-status="unfilled", a blocker, or a timeout). */
  function adSlots(on) {
    $$('[data-ad-box]').forEach(function (box) {
      var ins = $('ins.adsbygoogle', box);
      if (!on || !ins) { box.classList.remove('is-on'); return; }
      if (box.__mbAd) { box.classList.add('is-on'); return; }
      box.__mbAd = true;
      box.classList.add('is-on');
      var settle = function () {
        var st = ins.getAttribute('data-ad-status');
        if (st === 'unfilled') box.classList.remove('is-on'); else if (st) box.classList.add('is-on');
      };
      if (window.MutationObserver) new MutationObserver(settle).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
      setTimeout(function () { if (!ins.getAttribute('data-ad-status')) box.classList.remove('is-on'); }, 9000);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (err) { box.classList.remove('is-on'); }
    });
  }
  // Small line icons (stroke only, drawn for this page); the markup is static, so it is safe to insert as HTML.
  var SVG = function (paths, w) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + '</svg>'; };
  var IC_COOKIE = SVG('<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01M16 15.5v.01M12 12v.01M11 17v.01M7 14v.01"/>');
  var IC_X = SVG('<path d="M18 6 6 18M6 6l12 12"/>', 2.2);
  var IC_SHIELD = SVG('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>');
  function showCookieNotice(focus) {
    if ($('.cookie')) return;
    var wrap = el('div', 'cookie');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-labelledby', 'cookie-h');
    wrap.innerHTML =
      '<div class="cookie-card">' +
        '<div class="cookie-ico" aria-hidden="true">' + IC_COOKIE + '</div>' +
        '<div class="cookie-main">' +
          '<div class="cookie-top"><h2 id="cookie-h">Your privacy choices</h2>' +
            '<button class="cookie-x" type="button" data-consent="rejected" aria-label="Reject and close">' + IC_X + '</button></div>' +
          '<p>We use browser storage to remember your choices, such as dark mode, and, when ads are switched on, cookies for advertising. You can say no. Read our ' +
            '<a data-path="/cookie-policy/">Cookie Policy</a> and <a data-path="/privacy-policy/">Privacy Policy</a>.</p>' +
          '<div class="cookie-foot">' +
            '<span class="cookie-note">' + IC_SHIELD + '<span>Change this any time from the footer.</span></span>' +
            '<div class="cookie-actions">' +
              '<button class="cookie-btn cookie-reject" type="button" data-consent="rejected">Reject</button>' +
              '<button class="cookie-btn cookie-accept" type="button" data-consent="accepted">Accept</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    $$('a[data-path]', wrap).forEach(function (a) { a.href = BASE + a.getAttribute('data-path'); a.removeAttribute('data-path'); });
    doc.body.appendChild(wrap);
    var card = $('.cookie-card', wrap);
    var closing = false;
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-consent]');
      if (!b || closing) return;
      closing = true;
      var value = b.getAttribute('data-consent');
      store(CONSENT, value);
      $$('button', wrap).forEach(function (x) { x.disabled = true; });
      // the choice takes effect at once; the card slides away and is then removed
      if (value === 'rejected') adSlots(false);
      loadAds();
      loadTags();
      wrap.classList.add('is-leaving');
      var gone = false, end = function () { if (!gone) { gone = true; wrap.remove(); } };
      card.addEventListener('animationend', function (ev) { if (ev.target === card) end(); });
      setTimeout(end, 700);
    });
    if (focus) { wrap.tabIndex = -1; wrap.focus({ preventScroll: true }); } // opened by the reader from the footer: start reading from the notice
  }
  if (!store(CONSENT)) setTimeout(function () { if (!store(CONSENT)) showCookieNotice(); }, 1200);
  $$('[data-cookie-settings]').forEach(function (b) { b.addEventListener('click', function () { store(CONSENT, null); showCookieNotice(true); }); });
  loadAds();
  loadTags();

  /* ---------------------------------------------------------------- share */
  $$('[data-share]').forEach(function (box) {
    var url = box.getAttribute('data-url');
    var title = box.getAttribute('data-title');
    var note = $('.share-note', box);
    var say = function (msg) { if (note) { note.textContent = msg; setTimeout(function () { note.textContent = ''; }, 2400); } };
    var native = $('[data-native-share]', box);
    if (native && navigator.share) {
      native.hidden = false;
      native.addEventListener('click', function () { navigator.share({ title: title, url: url }).catch(function () {}); });
    }
    var copy = $('[data-copy-link]', box);
    if (copy) copy.addEventListener('click', function () {
      var done = function () { say('Link copied'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { say('Copy failed'); });
      else {
        var t = el('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'; doc.body.appendChild(t); t.select();
        try { doc.execCommand('copy'); done(); } catch (e) { say('Copy failed'); }
        t.remove();
      }
    });
  });

  /* --------------------------------------- post page: progress, top, TOC */
  var article = $('#article');
  if (article) {
    var bar = $('.read-progress span');
    var toTop = $('[data-to-top]');
    var railEl = $('[data-rail-progress]');
    var rail = railEl ? { ring: $('.rs-ring', railEl), pct: $('[data-rs-pct]', railEl), left: $('[data-rs-left]', railEl), min: Number(railEl.getAttribute('data-min')) || 1 } : null;
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = article.getBoundingClientRect();
      var total = r.height - window.innerHeight * 0.6;
      var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
      if (bar) bar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
      if (rail) { var pc = Math.round(p * 100); rail.ring.style.setProperty('--p', pc); rail.pct.textContent = pc + '%'; var left = Math.ceil(rail.min * (1 - p)); rail.left.textContent = pc >= 98 ? 'Finished reading' : left <= 1 ? 'Less than a minute left' : 'About ' + left + ' min left'; }
      if (toTop) toTop.hidden = window.scrollY < 700;
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    update();
    if (toTop) toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); });

    var tocLinks = $$('.toc a');
    if (tocLinks.length && 'IntersectionObserver' in window) {
      var map = {};
      tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
      var heads = $$('h2[id], h3[id]', article).filter(function (h) { return map[h.id]; });
      var tio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { tocLinks.forEach(function (a) { a.classList.remove('is-current'); }); map[en.target.id].classList.add('is-current'); }
        });
      }, { rootMargin: '-15% 0px -75% 0px' });
      heads.forEach(function (h) { tio.observe(h); });
    }
  }

  /* ----------------------------------------------- video player (Plyr)
     Plyr is the site's player for every video. Its files live in /vendor/plyr/ (served from this site, not a CDN) and are
     only loaded on pages that contain a video. YouTube videos do not touch YouTube until the reader presses play, and then
     use the no-cookie address. */
  var plyrLoad = null;
  function loadPlyr() {
    if (plyrLoad) return plyrLoad;
    plyrLoad = new Promise(function (resolve, reject) {
      var dir = BASE + '/vendor/plyr/', v = '?v=3.8.5';
      var css = doc.createElement('link');
      css.rel = 'stylesheet'; css.href = dir + 'plyr.css' + v;
      doc.head.appendChild(css);
      var js = doc.createElement('script');
      js.src = dir + 'plyr.min.js' + v; js.async = true;
      js.onload = function () { resolve(window.Plyr); };
      js.onerror = function () { plyrLoad = null; reject(new Error('Plyr did not load')); };
      doc.head.appendChild(js);
    });
    return plyrLoad;
  }
  function plyrOptions(extra) {
    var o = {
      iconUrl: BASE + '/vendor/plyr/plyr.svg',
      blankVideo: '',
      controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
      settings: ['captions', 'quality', 'speed'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      resetOnEnd: true,
      youtube: { noCookie: true, rel: 0, showinfo: 0, iv_load_policy: 3, modestbranding: 1 }
    };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }
  /* Mini player: once a video has been started and the reader scrolls past it, it keeps playing in a small window in the corner
     (like picture-in-picture, and it works for YouTube too). It goes back into the article when the reader scrolls up to it,
     the video ends, or the reader presses the close button (which also pauses it). The article keeps its space, so nothing jumps. */
  var MINI_KEY = 'mayobebros-mini-player';
  var MINI_ICONS = {
    move: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/></svg>',
    smaller: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    larger: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    pop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/></svg>',
    size: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/></svg>',
    toCorner: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="12" y="12" width="6" height="6" rx="1"/></svg>',
    corner: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M20 4 4 20"/><path d="M20 12 12 20"/></svg>'
  };
  function miniPlayer(box, player) {
    var root = player && player.elements && player.elements.container;
    if (!box || !root || !('IntersectionObserver' in window)) return;
    var started = false, dismissed = false, mini = false, full = false;
    var MARGIN = 8, MIN_W = 208;
    var custom = null; // {l, t, w} in pixels once the reader has moved or resized the window; null = the default corner
    try { var saved = JSON.parse(store(MINI_KEY) || 'null'); if (saved && isFinite(saved.l) && isFinite(saved.t) && isFinite(saved.w)) custom = { l: +saved.l, t: +saved.t, w: +saved.w }; } catch (err) { custom = null; }
    // room to keep clear on phones with a notch or a home bar (env(safe-area-inset-*) read through a hidden probe)
    var probe = el('div'); probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    doc.body.appendChild(probe);
    function insets() { var s = getComputedStyle(probe); return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 }; }
    function maxW() { var i = insets(); return Math.max(MIN_W, Math.min(doc.documentElement.clientWidth - 2 * MARGIN - i.l - i.r, 960)); }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function save() { if (custom) store(MINI_KEY, JSON.stringify({ l: Math.round(custom.l), t: Math.round(custom.t), w: Math.round(custom.w) })); else store(MINI_KEY, null); }
    function clear() { ['left', 'top', 'right', 'bottom', 'width'].forEach(function (k) { root.style[k] = ''; }); }
    // put the window where `custom` says, keeping all of it on the screen
    function place() {
      if (!custom) { clear(); return; }
      var vw = doc.documentElement.clientWidth, vh = window.innerHeight;
      custom.w = clamp(custom.w, MIN_W, maxW());
      root.style.width = custom.w + 'px';
      var h = root.getBoundingClientRect().height;
      var i = insets();
      custom.l = clamp(custom.l, MARGIN + i.l, Math.max(MARGIN + i.l, vw - custom.w - MARGIN - i.r));
      custom.t = clamp(custom.t, MARGIN + i.t, Math.max(MARGIN + i.t, vh - h - MARGIN - i.b));
      root.style.left = custom.l + 'px'; root.style.top = custom.t + 'px';
      root.style.right = 'auto'; root.style.bottom = 'auto';
    }
    function current() { var r = root.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, r: r.right, b: r.bottom }; }
    // change the width and keep the bottom-right corner where it is
    function resizeTo(w) {
      var c = current();
      custom = { l: c.r - w, t: c.t, w: w };
      place();
      var r = root.getBoundingClientRect();
      custom.l = c.r - r.width; custom.t = c.b - r.height; custom.w = r.width;
      place(); save();
    }

    var tools = el('div', 'video-mini-tools');
    function tool(label, icon, fn, cls) {
      var b = el('button', 'video-mini-btn' + (cls ? ' ' + cls : ''));
      b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.innerHTML = icon;
      if (fn) b.addEventListener('click', fn);
      tools.appendChild(b);
      return b;
    }
    var grip = tool('Move the video: drag it, or use the arrow keys. Double-click to put it back in the corner.', MINI_ICONS.move, null, 'video-mini-grip');
    tool('Make the video smaller', MINI_ICONS.smaller, function () { resizeTo(current().w * 0.85); }, 'video-mini-smaller');
    tool('Make the video larger', MINI_ICONS.larger, function () { resizeTo(current().w * 1.2); }, 'video-mini-larger');
    // the one-tap versions of the gestures (WCAG 2.5.1 and 2.5.7: pinch, double-tap and dragging each need a way that is not a gesture)
    tool('Switch between a small and a large video', MINI_ICONS.size, function () { toggleSize(); }, 'video-mini-size');
    tool('Move the video to the next corner', MINI_ICONS.toCorner, function () { nextCorner(); }, 'video-mini-corner');
    tool('Back to the video in the article', MINI_ICONS.back, function () { box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); });
    tool('Close the mini player and pause', MINI_ICONS.close, function () { player.pause(); dismissed = true; set(false); });
    /* Native Picture-in-Picture (own video files only): the browser or the system draws the video in its own always-on-top window, so it
       keeps playing when the reader switches tab or app. A page cannot do that itself, and a YouTube embed cannot be popped out. */
    var vid = player.isHTML5 && player.media && player.media.tagName === 'VIDEO' ? player.media : null;
    var pipOn = false;
    function pipOK(v) {
      if (v.disablePictureInPicture) return false;
      if (doc.pictureInPictureEnabled && v.requestPictureInPicture) return true;
      return !!(v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture'));
    }
    function togglePip() {
      try {
        if (doc.pictureInPictureElement === vid) { doc.exitPictureInPicture(); return; }
        if (doc.pictureInPictureEnabled && vid.requestPictureInPicture) { vid.requestPictureInPicture()['catch'](function () { /* refused: no gesture, or another window is open */ }); return; }
        if (vid.webkitSetPresentationMode) vid.webkitSetPresentationMode(vid.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture'); // iPhone, iPad, older Safari
      } catch (err) { /* not available right now */ }
    }
    if (vid && pipOK(vid)) {
      tool('Pop the video out. It keeps playing when you leave the browser.', MINI_ICONS.pop, togglePip, 'video-mini-pop');
      var pipChange = function (on) { if (on === pipOn) return; pipOn = on; if (on) set(false); else { io.unobserve(box); io.observe(box); } }; // the picture is in the other window: dock ours
      vid.addEventListener('enterpictureinpicture', function () { pipChange(true); });
      vid.addEventListener('leavepictureinpicture', function () { pipChange(false); });
      vid.addEventListener('webkitpresentationmodechanged', function () { pipChange(vid.webkitPresentationMode === 'picture-in-picture'); });
      // lock-screen / notification card, and Chrome and Edge on desktop pop the video out by themselves when the tab is hidden
      // (only for sites the reader allows; Safari and Firefox cannot be asked to, so the button is the dependable way there)
      var ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
      var capEl = box.querySelector('figcaption');
      var arm = function () {
        if (!ms) return;
        try { ms.metadata = new MediaMetadata({ title: ((capEl && capEl.textContent) || doc.title).trim().slice(0, 120), artist: 'Mayobe Bros', artwork: [{ src: location.origin + BASE + '/assets/img/icon-512.png', sizes: '512x512', type: 'image/png' }] }); } catch (err) { /* no metadata */ }
        try { ms.setActionHandler('enterpictureinpicture', function () { if (vid.paused || doc.pictureInPictureElement) return undefined; return vid.requestPictureInPicture(); }); } catch (err) { /* action not supported here */ }
        try { ms.setActionHandler('seekbackward', function () { player.rewind(10); }); ms.setActionHandler('seekforward', function () { player.forward(10); }); } catch (err) { /* not supported */ }
      };
      var disarm = function () { if (!ms) return; try { ms.setActionHandler('enterpictureinpicture', null); } catch (err) { /* not supported */ } };
      vid.addEventListener('play', arm); vid.addEventListener('pause', disarm); vid.addEventListener('ended', disarm);
    }
    var handle = el('button', 'video-mini-resize');
    handle.type = 'button'; handle.setAttribute('aria-label', 'Resize the video: drag this corner'); handle.title = 'Drag to resize'; handle.innerHTML = MINI_ICONS.corner;
    root.appendChild(tools); root.appendChild(handle);
    // the player's own shortcuts (double-click for fullscreen, arrow keys to seek) must not fire from these controls
    [tools, handle].forEach(function (n) { ['dblclick', 'keydown', 'keyup'].forEach(function (t) { n.addEventListener(t, function (e) { e.stopPropagation(); }); }); });

    // drag the window by the move button
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      var c = current(), sx = e.clientX, sy = e.clientY;
      custom = { l: c.l, t: c.t, w: c.w };
      root.classList.add('is-dragging');
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      function move(ev) { custom.l = c.l + ev.clientX - sx; custom.t = c.t + ev.clientY - sy; place(); }
      function up() { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); root.classList.remove('is-dragging'); save(); }
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 80 : 24, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      var c = current(); custom = { l: c.l + d[0], t: c.t + d[1], w: c.w }; place(); save();
    });
    grip.addEventListener('dblclick', function () { custom = null; place(); save(); });
    // drag the top-left corner to change the size
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      var c = current();
      root.classList.add('is-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      function move(ev) {
        var w = clamp(c.r - ev.clientX, MIN_W, maxW());
        custom = { l: c.r - w, t: c.t, w: w }; place();
        var r = root.getBoundingClientRect();
        custom.l = c.r - r.width; custom.t = c.b - r.height; place();
      }
      function up() { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); root.classList.remove('is-dragging'); save(); }
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
    /* Gestures on the window itself, with a finger or a mouse. One pointer: drag (after a few pixels, so a tap is still a tap) and a quick
       flick glides to the nearest corner. Two fingers: pinch to resize, with the picture staying under the fingers. Double-tap: small
       and large. A tap on the picture shows the controls; the play button starts and stops it, so a slip while dragging never pauses.
       Every gesture has a one-finger alternative (the buttons). The controls, the tool buttons and the corner handle keep their own input. */
    var TOOLS = '.plyr__controls, .video-mini-tools, .video-mini-resize';
    var pts = {}, g = null, lastType = 'mouse', swallow = false, lastTap = null, raf = 0, uiTimer = 0, tapTimer = 0;
    function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; place(); }); }
    function capture(id) { if (pts[id] && pts[id].type === 'touch') return; try { root.setPointerCapture(id); } catch (err) { /* the pointer is already gone */ } }
    function swallowClick() { swallow = true; setTimeout(function () { swallow = false; }, 350); } // the click that follows a drag or a double-tap is not a tap
    function showUi() {
      root.classList.add('mini-ui');
      clearTimeout(uiTimer);
      uiTimer = setTimeout(function () { root.classList.remove('mini-ui'); }, 3200);
    }
    function wDefault() { var vw = doc.documentElement.clientWidth; return vw <= 640 ? Math.min(240, Math.round(vw * 0.62)) : Math.min(352, vw - 2 * MARGIN); }
    function wLarge() { var vw = doc.documentElement.clientWidth; return Math.min(maxW(), vw <= 640 ? vw - 2 * MARGIN : 560); }
    function glide(fn) { // run a change of place or size with a short, smooth transition
      if (reduceMotion) { fn(); return; }
      root.classList.add('is-gliding'); fn();
      setTimeout(function () { root.classList.remove('is-gliding'); }, 460);
    }
    function toggleSize() {
      var c = current(), target = c.w < (wDefault() + wLarge()) / 2 + 1 ? wLarge() : wDefault();
      glide(function () { custom = { l: c.l + (c.w - target) / 2, t: c.t, w: target }; place(); save(); });
    }
    var TOP_ROOM = 56; // room below the site header
    function nextCorner() { // clockwise: top left, top right, bottom right, bottom left
      var c = current(), vw = doc.documentElement.clientWidth, vh = window.innerHeight, i = insets(), h = c.b - c.t;
      var left = MARGIN + i.l, right = vw - c.w - MARGIN - i.r, top = MARGIN + i.t + TOP_ROOM, bottom = vh - h - MARGIN - i.b;
      var corners = [], seen = {}; // a full-width window has the same spot on the left and the right: go through distinct places only
      [[left, top], [right, top], [right, bottom], [left, bottom]].forEach(function (p) { var k = Math.round(p[0]) + ',' + Math.round(p[1]); if (!seen[k]) { seen[k] = 1; corners.push(p); } });
      var best = 0, bd = Infinity;
      corners.forEach(function (p, k) { var d = Math.hypot(p[0] - c.l, p[1] - c.t); if (d < bd) { bd = d; best = k; } });
      var n = corners[(best + 1) % corners.length];
      glide(function () { custom = { w: c.w, l: n[0], t: n[1] }; place(); save(); });
    }
    function startPinch() {
      clearTimeout(tapTimer);
      var ids = Object.keys(pts).slice(0, 2), a = pts[ids[0]], b = pts[ids[1]], r = current();
      g = { mode: 'pinch', ids: ids, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, r0: r };
      root.classList.add('is-dragging'); ids.forEach(function (id) { capture(+id); });
    }
    function pinchMove() {
      var a = pts[g.ids[0]], b = pts[g.ids[1]];
      if (!a || !b) return;
      var d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, h0 = g.r0.b - g.r0.t;
      var w = clamp(g.r0.w * d / g.d0, MIN_W, maxW()), s = w / g.r0.w;
      var fx = (g.m0.x - g.r0.l) / g.r0.w, fy = (g.m0.y - g.r0.t) / h0; // the spot under the fingers stays under the fingers
      custom = { w: w, l: m.x - fx * w, t: m.y - fy * h0 * s };
      schedule();
    }
    function finish(e, fling) {
      var tr = g && g.trail, c = current(); // measured before anything else changes
      root.classList.remove('is-dragging');
      swallowClick();
      g = null;
      if (fling && tr && tr.length > 1) { // a quick flick glides to the corner it was thrown towards
        var last = tr[tr.length - 1], first = tr[Math.max(0, tr.length - 4)], dt = Math.max(1, last.t - first.t);
        var vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
        if (Math.hypot(vx, vy) > 0.55 && e.timeStamp - last.t < 90) {
          var vw = doc.documentElement.clientWidth, vh = window.innerHeight, i = insets();
          var cx = c.l + c.w / 2 + vx * 200, cy = c.t + (c.b - c.t) / 2 + vy * 200;
          glide(function () {
            custom = { w: c.w, l: cx < vw / 2 ? MARGIN + i.l : vw - c.w - MARGIN - i.r, t: cy < vh / 2 ? MARGIN + i.t + TOP_ROOM : vh - (c.b - c.t) - MARGIN - i.b }; 
            place();
          });
        }
      }
      save();
    }
    root.addEventListener('pointerdown', function (e) {
      lastType = e.pointerType || 'mouse';
      if (!mini || (lastType === 'mouse' && e.button !== 0) || e.target.closest(TOOLS)) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY, type: lastType };
      var n = Object.keys(pts).length;
      if (n === 1) g = { mode: 'pending', id: e.pointerId, sx: e.clientX, sy: e.clientY, c: current(), trail: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] };
      else if (n === 2) startPinch();
    });
    root.addEventListener('pointermove', function (e) {
      var p = pts[e.pointerId];
      if (!p || !g) return;
      p.x = e.clientX; p.y = e.clientY;
      if (g.mode === 'pinch') { pinchMove(); return; }
      if (g.id !== e.pointerId) return;
      if (g.mode === 'pending') {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < (lastType === 'mouse' ? 4 : 8)) return;
        g.mode = 'drag'; custom = { l: g.c.l, t: g.c.t, w: g.c.w };
        root.classList.add('is-dragging'); capture(e.pointerId);
      }
      custom.l = g.c.l + e.clientX - g.sx; custom.t = g.c.t + e.clientY - g.sy;
      g.trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY }); if (g.trail.length > 8) g.trail.shift();
      schedule();
    });
    function release(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      if (!g) return;
      var left = Object.keys(pts), cancelled = e.type === 'pointercancel';
      if (g.mode === 'pinch') {
        if (left.length === 1) { var q = pts[left[0]]; g = { mode: 'drag', id: +left[0], sx: q.x, sy: q.y, c: current(), trail: [{ t: e.timeStamp, x: q.x, y: q.y }] }; custom = { l: g.c.l, t: g.c.t, w: g.c.w }; } // one finger stays: keep moving with it
        else if (!left.length) finish(e, false);
        return;
      }
      if (g.id !== e.pointerId) return;
      if (g.mode === 'drag') { finish(e, !cancelled); return; }
      g = null; // a tap
      if (cancelled || lastType === 'mouse') return;
      if (lastTap && e.timeStamp - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) { // second tap: change the size
        lastTap = null; clearTimeout(tapTimer); swallowClick(); toggleSize();
      } else {
        lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        // a lone tap shows or hides the controls, but only after the double-tap window has passed: the buttons must not appear under a second tap
        clearTimeout(tapTimer);
        tapTimer = setTimeout(function () {
          if (typeof player.toggleControls === 'function') player.toggleControls(root.classList.contains('plyr--hide-controls'));
          showUi();
        }, 330);
      }
    }
    ['gesturestart', 'gesturechange'].forEach(function (t) { root.addEventListener(t, function (e) { if (mini) e.preventDefault(); }); }); // Safari's own pinch zoom
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    // clicks that end a drag or a double-tap are dropped; with a finger, a tap on the picture shows or hides the controls instead of pausing
    root.addEventListener('click', function (e) {
      if (!mini || e.target.closest(TOOLS)) return;
      if (swallow) { e.stopPropagation(); e.preventDefault(); return; }
      if (lastType !== 'mouse') { e.stopPropagation(); e.preventDefault(); } // a tap with a finger never starts or stops the video
    }, true);
    root.addEventListener('dblclick', function (e) { if (mini && lastType !== 'mouse' && !e.target.closest(TOOLS)) e.stopPropagation(); }, true); // no fullscreen from a double-tap: it changes the size
    window.addEventListener('resize', function () { if (mini && custom) place(); });

    root.addEventListener('animationend', function (e) { if (e.target === root && mini) root.classList.add('is-settled'); }); // the entrance plays once, never again after a drag
    function set(on) {
      if (on === mini) return;
      if (on) {
        root.classList.remove('is-settled');
        box.style.minHeight = box.offsetHeight + 'px';
        box.classList.add('is-mini');
        root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Mini video player');
        place();
      } else {
        box.classList.remove('is-mini'); box.style.minHeight = '';
        root.removeAttribute('role'); root.removeAttribute('aria-label');
        clear();
      }
      mini = on;
    }
    var io = new IntersectionObserver(function (entries) {
      var r = entries[entries.length - 1].intersectionRatio;
      if (r >= 0.5) { dismissed = false; set(false); }
      else if (r < 0.15 && started && !dismissed && !full && !pipOn) set(true);
    }, { threshold: [0, 0.15, 0.5] });
    io.observe(box);
    player.on('play', function () { started = true; });
    player.on('ended', function () { started = false; set(false); });
    player.on('enterfullscreen', function () { full = true; set(false); });
    player.on('exitfullscreen', function () { full = false; io.unobserve(box); io.observe(box); }); // look at the position again
  }
  var plain = $$('video').filter(function (v) { return !v.closest('.plyr') && !v.hasAttribute('data-no-plyr'); });
  var embeds = $$('[data-video-embed]');
  if (plain.length || embeds.length) {
    loadPlyr().then(function (Plyr) {
      plain.forEach(function (v) {
        v.removeAttribute('width'); v.removeAttribute('height');
        var pl = new Plyr(v, plyrOptions({ ratio: '16:9', fullscreen: { enabled: true, fallback: true, iosNative: true } })); // iosNative: on iPhone the system player can pop the video out when the reader leaves
        miniPlayer(v.closest('.video-figure'), pl);
      });
      embeds.forEach(function (box) {
        var go = box.querySelector('.video-load');
        if (!go) return;
        go.addEventListener('click', function () {
          var holder = el('div', 'plyr__video-embed');
          holder.setAttribute('data-plyr-provider', box.getAttribute('data-provider') || 'youtube');
          holder.setAttribute('data-plyr-embed-id', box.getAttribute('data-embed-id'));
          go.replaceWith(holder);
          var player = new Plyr(holder, plyrOptions({ title: box.getAttribute('data-title') || '' }));
          miniPlayer(box, player);
          player.once('ready', function () { player.play(); });
        });
      });
    })['catch'](function () { /* the browser's own controls stay in place */ });
  }

  /* ------------------------------------------- sidebar: "More topics" reveals the other tag topics 12 at a time */
  $$('[data-more-tags]').forEach(function (box) {
    var btn = $('.rail-more-btn', box), link = $('.rail-more-link', box), say = $('[role="status"]', box), chips = $('[data-tag-chips]', box.parentNode);
    if (!btn || !chips) return;
    var base = box.getAttribute('data-base') || '/tag/', step = Number(box.getAttribute('data-step')) || 12;
    var queue = null, busy = false;
    btn.hidden = false; if (link) link.hidden = true; // the plain link stays for readers without JavaScript
    function label(left) { $('span', btn).textContent = left ? 'More topics (' + left + ' left)' : 'More topics'; }
    function finish() { btn.hidden = true; if (link) link.hidden = false; }
    function reveal() {
      var batch = queue.splice(0, step);
      batch.forEach(function (t, i) {
        var a = el('a', 'chip chip-new'); a.href = base + t[1] + '/';
        a.style.setProperty('--i', i);
        a.appendChild(doc.createTextNode(t[0] + ' '));
        a.appendChild(el('span', 'chip-count', String(t[2])));
        chips.appendChild(a);
      });
      if (say) say.textContent = batch.length + ' more topics added.';
      $$('.chip-new', chips).forEach(function (c) { c.classList.add('is-seen'); });
      if (queue.length) label(queue.length); else finish();
      busy = false; btn.removeAttribute('aria-busy');
    }
    btn.addEventListener('click', function () {
      if (busy) return;
      if (queue) { busy = true; reveal(); return; }
      busy = true; btn.setAttribute('aria-busy', 'true');
      fetch(box.getAttribute('data-more-tags')).then(function (r) { if (!r.ok) throw new Error('topics'); return r.json(); }).then(function (all) {
        var have = {}; $$('a.chip', chips).forEach(function (a) { have[a.getAttribute('href')] = 1; });
        queue = all.filter(function (t) { return !have[base + t[1] + '/']; });
        if (!queue.length) { finish(); busy = false; return; }
        reveal();
      })['catch'](function () { busy = false; btn.removeAttribute('aria-busy'); if (link) { link.hidden = false; } btn.hidden = true; }); // could not load the list: fall back to the page of all topics
    });
  });

  /* ------------------------------------------------- copy the feed address (/rss/) */
  $$('[data-copy]').forEach(function (btn) {
    var src = $(btn.getAttribute('data-copy'));
    if (!src) return;
    btn.hidden = false; // without JavaScript the address can still be selected by hand
    src.addEventListener('focus', function () { src.select(); });
    btn.addEventListener('click', function () {
      var status = $('.rss-status');
      function done(ok) {
        if (status) status.textContent = ok ? 'Copied. Now paste it into your feed reader.' : 'Could not copy by itself. Select the address and copy it.';
        if (!ok) { src.focus(); src.select(); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(src.value).then(function () { done(true); }, function () { done(false); });
      else { src.select(); var ok = false; try { ok = doc.execCommand('copy'); } catch (err) { ok = false; } done(ok); }
    });
  });

  /* ---------------------------------------------------------------- forms */
  function postForm(form, statusEl, okMessage) {
    statusEl.className = statusEl.className.replace(/\bis-(ok|err)\b/g, '').trim();
    statusEl.textContent = 'Sending…';
    return fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); form.reset(); statusEl.classList.add('is-ok'); statusEl.textContent = okMessage; })
      .catch(function () { statusEl.classList.add('is-err'); statusEl.textContent = 'Sorry, that did not go through. Please try again, or email us directly.'; });
  }
  var cf = $('#contact-form');
  // with the mail service on, js/contact.js sends the message (data-mail-api); this handler is the mailto form and the old plain form post
  if (cf && !cf.hasAttribute('data-mail-api')) {
    var cfStatus = $('.form-status', cf);
    cf.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = cf.elements, bad = null;
      ['name', 'email', 'subject', 'message'].forEach(function (k) {
        var v = f[k].value.trim();
        var ok = !!v && (k !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
        f[k].setAttribute('aria-invalid', ok ? 'false' : 'true');
        if (!ok && !bad) bad = f[k];
      });
      cfStatus.className = 'form-status';
      if (bad) { cfStatus.classList.add('is-err'); cfStatus.textContent = 'Please complete every field with a valid email address.'; bad.focus(); return; }
      if (cf.getAttribute('data-endpoint')) { postForm(cf, cfStatus, 'Thank you! Your message has been sent.'); return; }
      var to = cf.getAttribute('data-mailto');
      var body = 'Name: ' + f.name.value.trim() + '\nEmail: ' + f.email.value.trim() + '\n\n' + f.message.value.trim();
      cfStatus.classList.add('is-ok');
      cfStatus.textContent = 'Opening your email app…';
      location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(f.subject.value.trim()) + '&body=' + encodeURIComponent(body);
    });
  }
  $$('[data-newsletter]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      postForm(form, $('.foot-status', form), 'You are subscribed. Thank you!');
    });
  });
})();


/* On phones and tablets the contents list starts folded so the article is not pushed down the page. */
(() => {
  const d = document.querySelector('[data-toc-details]');
  if (d && window.matchMedia('(max-width: 1179px)').matches) d.open = false;
})();


/* Home page topic rail: back / forward buttons for the scrolling row of topics (without JavaScript the row simply scrolls by touch or scrollbar). */
(() => {
  var list = document.querySelector('[data-rail-list]');
  if (!list) return;
  var box = list.closest('.dsc-rail-block'), btns = box && box.querySelector('.dsc-rail-btns');
  if (!btns) return;
  var back = btns.querySelector('[data-rail="-1"]'), fwd = btns.querySelector('[data-rail="1"]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var update = function () {
    var max = list.scrollWidth - list.clientWidth;
    btns.hidden = max < 8;
    back.disabled = list.scrollLeft < 4;
    fwd.disabled = list.scrollLeft > max - 4;
  };
  [back, fwd].forEach(function (b) {
    b.addEventListener('click', function () {
      var step = Math.max(240, list.clientWidth * 0.8) * Number(b.getAttribute('data-rail'));
      list.scrollBy({ left: step, behavior: reduce ? 'auto' : 'smooth' });
    });
  });
  var tick = false;
  list.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(function () { tick = false; update(); }); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();


/* Home page, "Latest posts": a button that fades in 6 more posts without leaving the page. The posts come from the paginated
   /post/ list; when they are used up, the button turns into a link to the full list. Without JavaScript only the link shows. */
(() => {
  var sec = document.getElementById('latest');
  var btn = sec && sec.querySelector('[data-more-posts]');
  var link = sec && sec.querySelector('.more-posts-link');
  var grid = sec && sec.querySelector('.grid');
  if (!btn || !link || !grid || !window.fetch || !window.DOMParser) return;
  var STEP = Number(btn.getAttribute('data-step')) || 6, pool = null, label = btn.querySelector('span');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  btn.hidden = false; link.hidden = true;
  var hrefOf = function (card) { var a = card.querySelector('a.card-link'); return a ? a.getAttribute('href') : ''; };
  var setLabel = function () {
    if (!pool.length) { btn.hidden = true; link.hidden = false; return; }
    label.textContent = 'Show ' + Math.min(STEP, pool.length) + ' more posts';
  };
  var getPool = function () {
    if (pool) return Promise.resolve(pool);
    return fetch(link.href, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (html) {
      var d = new DOMParser().parseFromString(html, 'text/html');
      var shown = Array.prototype.map.call(grid.children, hrefOf);
      pool = Array.prototype.filter.call(d.querySelectorAll('main .grid > article'), function (c) { return shown.indexOf(hrefOf(c)) < 0; });
      return pool;
    });
  };
  btn.addEventListener('click', function () {
    if (btn.disabled) return;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    getPool().then(function (list) {
      var batch = list.splice(0, STEP), first = null;
      batch.forEach(function (c, i) {
        var n = document.importNode(c, true);
        Array.prototype.forEach.call(n.querySelectorAll('script, iframe, object, embed, link, style'), function (x) { x.remove(); });
        n.style.setProperty('--i', i);
        if (!reduce) n.classList.add('is-new');
        Array.prototype.forEach.call(n.querySelectorAll('img.lazyfade'), function (img) { img.classList.add('is-loaded'); });
        grid.appendChild(n);
        if (!first) first = n;
      });
      setLabel();
      document.dispatchEvent(new CustomEvent('mb:content', { detail: { root: grid } })); // fills in comment counts when they are on
      if (first) { var a = first.querySelector('a.card-link'); if (a) a.focus({ preventScroll: true }); first.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' }); }
      if (!reduce) setTimeout(function () { Array.prototype.forEach.call(grid.querySelectorAll('.is-new'), function (x) { x.classList.remove('is-new'); }); }, 1400);
    })['catch'](function () { location.href = link.href; }).then(function () { btn.disabled = false; btn.removeAttribute('aria-busy'); });
  });
})();
