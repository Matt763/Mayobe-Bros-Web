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
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (e) { if (e.matches) setDrawer(false); });
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
  function showCookieNotice() {
    if ($('.cookie')) return;
    var wrap = el('div', 'cookie');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Cookie notice');
    var link = function (href, text) { var a = el('a', '', text); a.href = BASE + href; return a; };
    var p = el('p');
    p.appendChild(doc.createTextNode('We use browser storage to remember your choices, such as dark mode, and, when ads are switched on, cookies for advertising. You can say no. Read our '));
    p.appendChild(link('/cookie-policy/', 'Cookie Policy'));
    p.appendChild(doc.createTextNode(' and '));
    p.appendChild(link('/privacy-policy/', 'Privacy Policy'));
    p.appendChild(doc.createTextNode('.'));
    var button = function (cls, value, text) { var b = el('button', 'btn ' + cls, text); b.type = 'button'; b.setAttribute('data-consent', value); return b; };
    var actions = el('div', 'cookie-actions');
    // Reject and Accept look exactly alike: refusing must be as easy and as visible as accepting
    actions.appendChild(button('btn-primary', 'rejected', 'Reject'));
    actions.appendChild(button('btn-primary', 'accepted', 'Accept'));
    var body = el('div', 'cookie-body');
    body.appendChild(el('h2', '', 'Your privacy choices'));
    body.appendChild(p);
    body.appendChild(actions);
    var card = el('div', 'cookie-card');
    card.appendChild(body);
    wrap.appendChild(card);
    doc.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-consent]');
      if (!b) return;
      store(CONSENT, b.getAttribute('data-consent'));
      wrap.remove();
      if (b.getAttribute('data-consent') === 'rejected') adSlots(false);
      loadAds();
    });
  }
  if (!store(CONSENT)) setTimeout(function () { if (!store(CONSENT)) showCookieNotice(); }, 1500);
  $$('[data-cookie-settings]').forEach(function (b) { b.addEventListener('click', function () { store(CONSENT, null); showCookieNotice(); }); });
  loadAds();

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
  var plain = $$('video').filter(function (v) { return !v.closest('.plyr') && !v.hasAttribute('data-no-plyr'); });
  var embeds = $$('[data-video-embed]');
  if (plain.length || embeds.length) {
    loadPlyr().then(function (Plyr) {
      plain.forEach(function (v) {
        v.removeAttribute('width'); v.removeAttribute('height');
        new Plyr(v, plyrOptions({ ratio: '16:9' }));
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
          player.once('ready', function () { player.play(); });
        });
      });
    })['catch'](function () { /* the browser's own controls stay in place */ });
  }

  /* ---------------------------------------------------------------- forms */
  function postForm(form, statusEl, okMessage) {
    statusEl.className = statusEl.className.replace(/\bis-(ok|err)\b/g, '').trim();
    statusEl.textContent = 'Sending…';
    return fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); form.reset(); statusEl.classList.add('is-ok'); statusEl.textContent = okMessage; })
      .catch(function () { statusEl.classList.add('is-err'); statusEl.textContent = 'Sorry, that did not go through. Please try again, or email us directly.'; });
  }
  var cf = $('#contact-form');
  if (cf) {
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
