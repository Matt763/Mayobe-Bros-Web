/* Mayobe Bros: the email sign-up box for readers who arrive from the old blog (mbagamc.blogspot.com).
   js/site.js loads this file only when the reader came from the old blog (a utm_source=oldblog tag, or the blog's address as referrer) and
   the page is an article that carries the <template data-oldblog-prompt>. It never opens on arrival. It opens once per visit, when the
   reader has really read the article: the end of the text has been on screen, at least 40% of the text was scrolled past and the page has
   been in view for 20 seconds. On a computer it also opens when the pointer heads for the tabs or the address bar after at least 40% of the
   text was scrolled past and 20 seconds in view (the end of the text need not have been reached: this is the reader who is leaving).
   It is a box in the corner (a sheet at the bottom of a phone), not a wall: the page behind stays usable, the keyboard focus is not taken,
   Escape and the Close button shut it. After Close it stays away for 14 days, after a sign-up for a year. In local storage only a date is
   kept, and only after the reader acts (the note that the reader came from the old blog lives in session storage, written by js/site.js).
   The sign-up is the ordinary form (js/subscribe.js): the address is sent only when the reader presses Subscribe.
   It waits while the cookie notice, a menu, the Listen player, the small video window or a text field being typed in is on screen. */
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

  var shown = false;   // the box has been put on the page (once per visit)
  var box = null;
  var back = null;     // what had the keyboard focus when the box opened
  var visibleMs = 0;
  var depth = 0;       // how much of the article text has passed the bottom of the screen (0 to 1)
  var endSeen = false;
  var timer = 0;

  // a sign-up from any form on the page (footer, sidebar or this box) means the reader is already on the list
  doc.addEventListener('mb:subscribed', function () {
    remember('subscribed');
    track('subscribed');
    if (box) box.setAttribute('data-done', '');
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

  // something else needs the bottom of the screen or the reader's attention: wait
  function busy() {
    var a = doc.activeElement;
    var typing = !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !(box && box.contains(a));
    return !!(typing || doc.hidden ||
      doc.querySelector('.cookie:not(.is-leaving)') || doc.body.classList.contains('no-scroll') ||
      doc.querySelector('.player.is-open') || doc.querySelector('.video-figure.is-mini'));
  }

  function show() {
    if (shown || !win.MBNewsletter) return;
    var frag = tpl.content.cloneNode(true);
    box = frag.querySelector('.obp');
    var form = frag.querySelector('form[data-newsletter]');
    if (!box || !form) return;
    shown = true;
    stop();
    try { win.sessionStorage.setItem(NOTE, 'shown'); } catch (e) { /* storage may be blocked */ }
    back = doc.activeElement;
    doc.body.appendChild(frag);
    win.MBNewsletter.wire(form);
    var live = box.querySelector('[data-obp-live]');
    // a frame later, so the box slides in from its resting place; the line is read out by screen readers (the focus is not moved)
    win.requestAnimationFrame(function () {
      win.requestAnimationFrame(function () {
        box.classList.add('is-open');
        if (live) live.textContent = 'Email sign-up box opened at the bottom of the page.';
      });
    });
    var closers = box.querySelectorAll('[data-obp-close]');
    for (var i = 0; i < closers.length; i++) closers[i].addEventListener('click', function () { close(); });
    track('shown');
  }

  function close() {
    if (!box || box.classList.contains('is-closing')) return;
    var b = box;
    if (!b.hasAttribute('data-done')) remember('closed');
    track(b.hasAttribute('data-done') ? 'closed_after_signup' : 'closed');
    var hadFocus = b.contains(doc.activeElement);
    b.classList.remove('is-open');
    b.classList.add('is-closing');
    if (hadFocus && back && back !== doc.body && doc.contains(back) && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* nothing to restore */ } }
    win.setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 600);
    box = null;
  }

  // Escape closes the box only when it is meant for the box: the focus is inside it, or nowhere in particular (the page itself). An Escape
  // pressed inside a menu, the contents panel or a field closes that, and must not count as the reader dismissing the box.
  doc.addEventListener('keydown', function (e) {
    if (!(e.key === 'Escape' || e.keyCode === 27) || e.defaultPrevented || !box || !box.classList.contains('is-open') || doc.body.classList.contains('no-scroll')) return;
    var a = doc.activeElement;
    if (!a || a === doc.body || a === doc.documentElement || box.contains(a)) close();
  });

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
