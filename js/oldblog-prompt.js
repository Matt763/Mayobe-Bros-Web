/* Mayobe Bros: the email sign-up modal for readers who arrive from the old blog (mbagamc.blogspot.com).
   js/site.js loads this file only when the reader came from the old blog (a utm_source=oldblog tag, or the blog's address as referrer) and
   the page is an article that carries the <template data-oldblog-prompt>. It never opens on arrival. It opens once per visit, when the
   reader has really read the article: the end of the text has been on screen, at least 40% of the text was scrolled past and the page has
   been in view for 20 seconds. On a computer it also opens when the pointer heads for the tabs or the address bar after at least 40% of the
   text was scrolled past and 20 seconds in view (the end of the text need not have been reached: this is the reader who is leaving).
   It is a real modal (changed 2026-11-24, owner's request): a native <dialog> opened with showModal(), so the page behind is inert, the
   browser keeps the focus inside and Escape asks to close it. Close, Not now, a tap on the dimmed page and Escape all leave the same way;
   on a phone the sheet also follows a finger pulled down by its handle or heading (a flick or a long pull closes it, a short pull springs
   back). Where showModal is missing the box is a dialog with aria-modal, the rest of the page is made inert by hand and Tab is kept inside.
   Motion is Web Animations on transform and opacity only; with reduced motion it is a quick fade.
   After Close it stays away for 14 days, after a sign-up for a year. In local storage only a date is kept, and only after the reader acts
   (the note that the reader came from the old blog lives in session storage, written by js/site.js).
   The sign-up is the ordinary form (js/subscribe.js): the address is sent only when the reader presses Subscribe.
   It waits while the cookie notice, a menu, the Listen player, the small video window or a text field being typed in is on screen.
   No history tricks: nothing is pushed or replaced, and nothing runs when the reader leaves the page. */
(function () {
  'use strict';

  var doc = document;
  var win = window;
  var NOTE = 'mayobebros-from-oldblog';   // session storage, written by js/site.js; set to "shown" here
  var KEY = 'mayobebros-oldblog-prompt';  // local storage: { s: 'closed' | 'subscribed', t: time }
  var DAYS = { closed: 14, subscribed: 365 };
  var NEED_MS = 20000;   // the page must have been in view this long
  var NEED_DEPTH = 0.4;  // and this much of the article text scrolled past
  var EDGE = 20;         // computer: how close to the top edge of the window counts as "leaving"
  // damped springs (the same curves as the old-blog snippet); a browser without linear() gets a cubic-bezier with a small overshoot
  var SPRING_CARD = 'linear(0, .024, .087, .175, .276, .382, .488, .587, .678, .759, .828, .886, .933, .97, .998, 1.018, 1.032, 1.041, 1.045, 1.046, 1.045, 1.041, 1.037, 1.033, 1.028, 1.023, 1.018, 1.014, 1.011, 1.007, 1.005, 1.003, 1.001, 1, .999, .998, 1)';
  var SPRING_SHEET = 'linear(0, .04, .135, .258, .388, .512, .624, .721, .801, .864, .913, .949, .975, .993, 1.004, 1.011, 1.014, 1.015, 1.015, 1.013, 1.011, 1.009, 1.007, 1.006, 1.004, 1.003, 1.002, 1.001, 1)';
  var SETTLE = 'cubic-bezier(.22, 1, .36, 1)';
  var LEAVE = 'cubic-bezier(.4, 0, .9, .6)';

  var tpl = doc.querySelector('template[data-oldblog-prompt]');
  var article = doc.getElementById('article');
  var end = doc.querySelector('.post-end');
  if (!tpl || !tpl.content || !article || !end || !win.addEventListener) return;

  function remembered() {
    var v = null;
    try { v = JSON.parse(win.localStorage.getItem(KEY) || 'null'); } catch (e) { v = null; }
    if (!v || !DAYS[v.s] || typeof v.t !== 'number') return false;
    return new Date().getTime() - v.t < DAYS[v.s] * 86400000;
  }
  function remember(s) {
    try { win.localStorage.setItem(KEY, JSON.stringify({ s: s, t: new Date().getTime() })); } catch (e) { /* storage may be blocked */ }
  }
  // measured in the site's own analytics only when the reader pressed Accept (the data layer exists only then); no address or name is passed
  function track(step) {
    try { if (win.dataLayer) win.dataLayer.push({ event: 'oldblog_prompt', oldblog_step: step }); } catch (e) { /* analytics is optional */ }
  }

  var shown = false;   // the modal has been put on the page (once per visit)
  var dlg = null;      // the <dialog> while it is on the page
  var card = null;
  var scrim = null;
  var closing = false;
  var modal = false;   // true when showModal() worked (the browser holds the focus and makes the page inert)
  var back = null;     // what had the keyboard focus when the modal opened
  var backY = 0;       // where the page was scrolled to
  var anims = [];      // the Web Animations running now (entrance, exit, spring back)
  var visibleMs = 0;
  var depth = 0;       // how much of the article text has passed the bottom of the screen (0 to 1)
  var endSeen = false;
  var timer = 0;
  var hidden = [];     // fallback only: [element, old aria-hidden, was inert] of the parts of the page made inert by hand

  // a sign-up from any form on the page (footer, sidebar or this box) means the reader is already on the list
  doc.addEventListener('mb:subscribed', function () {
    remember('subscribed');
    track('subscribed');
    if (dlg) {
      dlg.setAttribute('data-done', '');
      var later = dlg.querySelector('[data-obp-later]');
      if (later) later.textContent = 'Back to the article';
    }
    if (!shown) { shown = true; stop(); }
  });

  if (remembered()) return;

  function stop() { win.clearInterval(timer); }

  function measure() {
    var r = article.getBoundingClientRect();
    var read = (win.innerHeight - r.top) / (r.height || 1);
    if (read > depth) depth = Math.min(1, read);
    if (end.getBoundingClientRect().top < win.innerHeight) endSeen = true;
  }
  var pending = false;
  win.addEventListener('scroll', function () {
    if (pending || shown) return;
    pending = true;
    win.requestAnimationFrame(function () { pending = false; measure(); });
  }, false);

  function engaged() { return endSeen && depth >= NEED_DEPTH && visibleMs >= NEED_MS; }

  // something else needs the screen or the reader's attention: wait
  function busy() {
    var a = doc.activeElement;
    var typing = !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    return !!(typing || doc.hidden ||
      doc.querySelector('.cookie:not(.is-leaving)') || doc.body.classList.contains('no-scroll') ||
      doc.querySelector('.player.is-open') || doc.querySelector('.video-figure.is-mini'));
  }

  function sheet() { return !!win.matchMedia && win.matchMedia('(max-width: 39.99rem)').matches; }
  function calm() { return !!win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function spring(curve) {
    var ok = win.CSS && win.CSS.supports && win.CSS.supports('animation-timing-function', 'linear(0, 1)');
    return ok ? curve : 'cubic-bezier(.2, 1.12, .3, 1)';
  }
  function play(el, frames, options) {
    var a = el.animate(frames, options);
    anims.push(a);
    return a;
  }
  function stopAnims() {
    for (var i = 0; i < anims.length; i++) { try { anims[i].cancel(); } catch (e) { /* already gone */ } }
    anims = [];
  }

  /* ---------------------------------------------------------------- opening */
  function show() {
    if (shown || !win.MBNewsletter) return;
    var frag = tpl.content.cloneNode(true);
    var d = frag.querySelector('dialog.obp');
    var form = frag.querySelector('form[data-newsletter]');
    if (!d || !form) return;
    shown = true;
    stop();
    try { win.sessionStorage.setItem(NOTE, 'shown'); } catch (e) { /* storage may be blocked */ }
    back = doc.activeElement;
    backY = win.pageYOffset;
    doc.body.appendChild(frag);
    dlg = d;
    card = d.querySelector('[data-obp-card]');
    scrim = d.querySelector('[data-obp-scrim]');
    win.MBNewsletter.wire(form);
    doc.body.classList.add('obp-lock');
    try {
      if (typeof d.showModal !== 'function') throw new Error('no showModal');
      d.showModal();
      modal = true;
    } catch (e) {
      modal = false;
      d.classList.add('is-fallback');
      d.setAttribute('role', 'dialog');
      d.setAttribute('open', '');
      makeInert(true);
    }
    if (weak()) d.classList.add('is-lite');
    wire();
    fit();
    // the heading takes the focus: it is read out with the description, and on a phone no keyboard opens
    var h = d.querySelector('.obp-title');
    if (h && h.focus) h.focus({ preventScroll: true });
    if (card && card.animate) { enter(); guard(); }
    track('shown');
  }

  // the blurred page behind is the only costly layer: a device that reports little memory (or Save-Data) never gets it, and one whose frames
  // after the entrance are slow loses it (the tint gets deeper instead)
  function weak() {
    var n = win.navigator || {};
    return (n.deviceMemory && n.deviceMemory <= 2) || !!(n.connection && n.connection.saveData);
  }
  function guard() {
    var t0 = win.performance.now(), last = 0, count = 0, sum = 0;
    function tick(now) {
      if (!dlg || closing) return;
      if (now - t0 > 550) {
        if (last) { count++; sum += now - last; }
        last = now;
        if (count >= 12) { if (sum / count > 26) dlg.classList.add('is-lite'); return; }
      }
      win.requestAnimationFrame(tick);
    }
    win.requestAnimationFrame(tick);
  }

  function enter() {
    var phone = sheet();
    var quiet = calm();
    play(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: quiet ? 150 : 420, easing: SETTLE, fill: 'backwards' });
    play(card, [{ opacity: 0 }, { opacity: 1 }], { duration: quiet ? 150 : phone ? 90 : 240, easing: 'ease-out', fill: 'backwards' }); // a sheet rises from below the screen, so it only needs a hint of a fade
    if (quiet) return;
    play(card, { transform: phone ? ['translate3d(0, 100%, 0)', 'translate3d(0, 0, 0)'] : ['translate3d(0, 28px, 0) scale(.94)', 'translate3d(0, 0, 0) scale(1)'] },
      { duration: phone ? 620 : 640, easing: spring(phone ? SPRING_SHEET : SPRING_CARD), fill: 'backwards' });
    var kids = dlg.querySelectorAll('.obp-top, .obp-title, .obp-text, form[data-newsletter], .obp-later');
    for (var i = 0; i < kids.length; i++) {
      play(kids[i], [{ opacity: 0, transform: 'translate3d(0, 14px, 0)' }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
        { duration: 520, delay: 170 + i * 60, easing: SETTLE, fill: 'backwards' });
    }
  }

  /* ---------------------------------------------------------------- closing */
  // what the reader did is written once: Close, Not now, the dimmed page and Escape all come here
  function close(flick) {
    if (!dlg || closing) return;
    closing = true;
    var done = dlg.hasAttribute('data-done');
    if (!done) remember('closed');
    track(done ? 'closed_after_signup' : 'closed');
    if (!card || !card.animate) { finish(); return; }
    var phone = sheet();
    var cs = win.getComputedStyle(card);
    var from = cs.transform === 'none' ? 'translate3d(0, 0, 0)' : cs.transform; // where the card is now, if it is still arriving
    var fromOpacity = cs.opacity;
    var fromScrim = win.getComputedStyle(scrim).opacity;
    stopAnims();
    var last;
    if (calm()) {
      play(scrim, [{ opacity: fromScrim }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'both' });
      last = play(card, [{ opacity: fromOpacity }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'both' });
    } else if (phone) {
      var ms = flick ? flick.ms : 340;
      play(scrim, [{ opacity: fromScrim }, { opacity: 0 }], { duration: Math.round(ms * 0.9), easing: 'ease-out', fill: 'both' });
      last = play(card, [{ transform: from }, { transform: 'translate3d(0, ' + (card.offsetHeight + 24) + 'px, 0)' }], { duration: ms, easing: flick ? flick.easing : LEAVE, fill: 'both' });
    } else {
      play(scrim, [{ opacity: fromScrim }, { opacity: 0 }], { duration: 250, easing: 'ease-out', fill: 'both' });
      play(card, [{ opacity: fromOpacity }, { opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'both' });
      last = play(card, [{ transform: from }, { transform: 'translate3d(0, 14px, 0) scale(.96)' }], { duration: 360, easing: LEAVE, fill: 'both' });
    }
    last.onfinish = finish;
    win.setTimeout(finish, 900); // a tab in the background does not run animations
  }

  function finish() {
    var d = dlg;
    if (!d) return;
    dlg = null; card = null; scrim = null;
    stopAnims();
    unwatch();
    try { if (modal && d.open) d.close(); } catch (e) { /* already closed */ }
    if (d.parentNode) d.parentNode.removeChild(d);
    doc.body.classList.remove('obp-lock');
    if (!modal) makeInert(false);
    closing = false;
    // the browser gives the focus back by itself; this also covers the fallback, and never scrolls
    if (back && back !== doc.body && doc.contains(back) && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* nothing to restore */ } }
    if (Math.abs(win.pageYOffset - backY) > 1) win.scrollTo({ top: backY, left: 0, behavior: 'instant' });
  }

  /* ------------------------------------------- listeners that live as long as the modal */
  var downOnScrim = false;
  function wire() {
    var d = dlg;
    var closers = d.querySelectorAll('[data-obp-close]');
    for (var i = 0; i < closers.length; i++) closers[i].addEventListener('click', function () { close(); });
    // a tap on the dimmed page closes it (only when the press began there too, so a text selection that ends outside does not)
    d.addEventListener('pointerdown', function (e) { downOnScrim = e.target === scrim || e.target === d; });
    d.addEventListener('click', function (e) { if (downOnScrim && (e.target === scrim || e.target === d)) close(); downOnScrim = false; });
    // Escape and the phone's back gesture both ask to close: the answer is the same animated exit
    d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    // the browser closed it by itself (a second Escape pressed during the exit): clean up at once
    d.addEventListener('close', function () { if (dlg === d) finish(); });
    d.addEventListener('keydown', onKey);
    if (card && card.animate) drag();
    var vv = win.visualViewport;
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
  }
  function unwatch() {
    var vv = win.visualViewport;
    if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
  }

  function onKey(e) {
    var k = e.key;
    if (k === 'Escape' || e.keyCode === 27) { e.preventDefault(); close(); return; }
    // the page's own shortcut for search must not open a panel behind the modal
    if ((k === 'k' || k === 'K') && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); return; }
    if (modal || k !== 'Tab') return;
    var items = [].filter.call(dlg.querySelectorAll('a[href], button, input:not([type="hidden"]), [tabindex="0"]'), function (el) {
      return !el.disabled && !el.closest('[inert]') && el.offsetParent !== null && el.tabIndex >= 0;
    });
    if (!items.length) return;
    var first = items[0], lastItem = items[items.length - 1];
    if (e.shiftKey && (doc.activeElement === first || doc.activeElement === dlg.querySelector('.obp-title'))) { e.preventDefault(); lastItem.focus(); }
    else if (!e.shiftKey && doc.activeElement === lastItem) { e.preventDefault(); first.focus(); }
  }

  // without showModal the rest of the page is made inert by hand and put back after
  function makeInert(on) {
    var i;
    if (on) {
      var kids = doc.body.children;
      for (i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c === dlg || /^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(c.tagName)) continue;
        hidden.push([c, c.getAttribute('aria-hidden'), c.hasAttribute('inert')]);
        c.setAttribute('aria-hidden', 'true');
        c.setAttribute('inert', '');
      }
    } else {
      for (i = 0; i < hidden.length; i++) {
        var h = hidden[i];
        if (h[1] === null) h[0].removeAttribute('aria-hidden'); else h[0].setAttribute('aria-hidden', h[1]);
        if (!h[2]) h[0].removeAttribute('inert');
      }
      hidden = [];
    }
  }

  // the on-screen keyboard: the dialog is sized to the part of the window that can be seen, so the sheet stays above the keys
  function fit() {
    if (!dlg) return;
    var vv = win.visualViewport;
    var keys = vv && vv.scale < 1.05 && win.innerHeight - vv.height > 120;
    if (keys) { dlg.style.setProperty('--obp-vh', Math.round(vv.height) + 'px'); dlg.style.setProperty('--obp-vt', Math.round(vv.offsetTop) + 'px'); }
    else { dlg.style.removeProperty('--obp-vh'); dlg.style.removeProperty('--obp-vt'); }
  }

  /* ----------------------------------------------- the sheet follows a finger (phones) */
  // The handle and the heading take the drag. Pulling up meets rubber-band resistance. On release a quick flick down, or a pull of more
  // than a third of the sheet, closes it; anything less springs back. The dimmed page fades with the pull. Close stays the one-tap way.
  function rubber(x) { return (x * 0.55 * 90) / (90 + x * 0.55); }
  function drag() {
    var zones = dlg.querySelectorAll('[data-obp-drag]');
    var g = null;
    function move(e) {
      if (!g || e.pointerId !== g.id) return;
      var raw = g.base + e.clientY - g.y0;
      var dy = raw < 0 ? -rubber(-raw) : raw;
      var now = e.timeStamp; // the time of the touch itself, not of this handler, so a busy page does not slow the measured speed
      g.dy = dy;
      g.pts.push([now, e.clientY]);
      while (g.pts.length > 2 && now - g.pts[0][0] > 100) g.pts.shift();
      card.style.setProperty('--obp-dy', dy.toFixed(1) + 'px');
      dlg.style.setProperty('--obp-fade', (1 - Math.max(0, Math.min(1, dy / (card.offsetHeight || 1))) * 0.9).toFixed(3));
    }
    function up(e) {
      if (!g || e.pointerId !== g.id) return;
      var s = g;
      g = null;
      s.pts.push([e.timeStamp, e.clientY]); // a finger that rested before letting go is not a flick
      while (s.pts.length > 2 && e.timeStamp - s.pts[0][0] > 100) s.pts.shift();
      var a = s.pts[0], b = s.pts[s.pts.length - 1];
      var v = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0; // px per ms, down is positive
      var h = card.offsetHeight || 1;
      if (e.type !== 'pointercancel' && s.dy > 8 && (v > 0.4 || s.dy > h * 0.35)) {
        var ms = Math.max(170, Math.min(340, Math.round((h - s.dy) / Math.max(v, 0.9))));
        close({ ms: ms, easing: 'cubic-bezier(.2, .6, .4, 1)' });
      } else {
        // let go: the sheet springs back from where the finger left it
        card.style.setProperty('--obp-dy', '0px');
        dlg.style.removeProperty('--obp-fade');
        if (calm()) return;
        play(card, [{ transform: 'translate3d(0, ' + s.dy.toFixed(1) + 'px, 0)' }, { transform: 'translate3d(0, 0, 0)' }], { duration: 480, easing: spring(SPRING_SHEET) });
        play(scrim, [{ opacity: (1 - Math.max(0, Math.min(1, s.dy / h)) * 0.9).toFixed(3) }, { opacity: 1 }], { duration: 300, easing: SETTLE });
      }
    }
    function down(e) {
      if (g || closing || !sheet() || (e.button && e.button !== 0) || e.isPrimary === false) return;
      // grabbed while still arriving: stop where it is and carry on from there
      var base = 0;
      if (anims.length) {
        var m = /matrix\(([^)]+)\)/.exec(win.getComputedStyle(card).transform);
        base = m ? parseFloat(m[1].split(',')[5]) || 0 : 0;
        stopAnims();
        card.style.setProperty('--obp-dy', base + 'px');
      } else base = parseFloat(card.style.getPropertyValue('--obp-dy')) || 0;
      g = { id: e.pointerId, y0: e.clientY, base: base, dy: base, pts: [[e.timeStamp, e.clientY]] };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* the move events still arrive */ }
    }
    for (var i = 0; i < zones.length; i++) {
      zones[i].addEventListener('pointerdown', down);
      zones[i].addEventListener('pointermove', move);
      zones[i].addEventListener('pointerup', up);
      zones[i].addEventListener('pointercancel', up);
    }
  }

  /* ---------------------------------------------------------------- when to open */
  timer = win.setInterval(function () {
    if (shown) return;
    if (!doc.hidden) visibleMs += 1000;
    measure();
    if (engaged() && !busy()) show();
  }, 1000);

  // computer: the pointer leaves through the top edge after the reader has read most of the article
  var fine = win.matchMedia ? win.matchMedia('(hover: hover) and (pointer: fine)').matches : false;
  if (fine) {
    doc.documentElement.addEventListener('mouseleave', function (e) {
      if (shown || e.clientY > EDGE) return;
      measure(); // the last second of scrolling counts
      if (depth >= NEED_DEPTH && visibleMs >= NEED_MS && !busy()) show();
    });
  }
})();
