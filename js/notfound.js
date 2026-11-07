/* Mayobe Bros — the 404 page (404.html only, loaded before js/site.js so it runs before analytics).
   Without this file the page is complete. It adds:
   - on an email-link path (/newsletter/, /manage/): takes the link code out of the address first, then shows the notice; never redirects;
   - "Go back" when there is a page to go back to;
   - a 10 second countdown to the home page, only for a plain, visible, first visit with motion allowed. A Stop button,
     any key, pointer press or real pointer move, wheel, scroll, touch or focus, hiding the tab or leaving the page stops it for good (WCAG 2.2.1, 2.2.2).
   It never fetches, never stores anything and writes text only (textContent), so the address can never be injected. */
(function () {
  'use strict';

  var SECONDS = 10;
  var FLOW = /^\/(newsletter|manage)(\/|$)/;
  var doc = document;
  var box = doc.querySelector('[data-nf]');
  if (!box) return;
  var $ = function (name) { return box.querySelector('[data-nf-' + name + ']'); };

  var BASE = doc.documentElement.getAttribute('data-base') || '';
  var path = location.pathname || '/';
  var rel = BASE && (path === BASE || path.indexOf(BASE + '/') === 0) ? path.slice(BASE.length) || '/' : path;

  var timer = $('timer'), text = $('text'), count = $('count'), unit = $('unit'), stopBtn = $('stop'), status = $('status'), back = $('back'), flow = $('flow');

  function wireBack() {
    if (!back || !(history.length > 1)) return;
    back.hidden = false;
    back.addEventListener('click', function () { history.back(); });
  }

  // Email links: the code leaves the address bar before anything else runs (GTM, the beacon, a Referer never see it).
  if (FLOW.test(rel)) {
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
    if (flow) flow.hidden = false;
    wireBack();
    return;
  }

  wireBack();

  function navType() {
    try {
      var nav = performance.getEntriesByType('navigation');
      return nav && nav[0] && nav[0].type ? nav[0].type : 'navigate';
    } catch (e) { return 'navigate'; }
  }
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!timer || !count || reduce || location.search || location.hash || navType() !== 'navigate' || doc.visibilityState === 'hidden') return;

  var left = SECONDS;
  var id = null;
  var stopped = false;
  var CAPTURE = true;
  var PASSIVE = { capture: true, passive: true };
  var STOP_ON = ['keydown', 'pointerdown', 'wheel', 'focusin'];

  function show() {
    count.textContent = String(left);
    if (unit) unit.textContent = left === 1 ? 'second' : 'seconds';
  }
  // A mouse that only drifts a little (or a layout shift that repeats the pointer position) does not count; a real move does.
  var MOVE_PX = 12;
  var origin = null;
  function onMove(ev) {
    if (!ev || typeof ev.clientX !== 'number') return;
    if (!origin) { origin = { x: ev.clientX, y: ev.clientY }; return; }
    var dx = ev.clientX - origin.x, dy = ev.clientY - origin.y;
    if (dx * dx + dy * dy >= MOVE_PX * MOVE_PX) stop();
  }
  function onVisibility() { if (doc.visibilityState === 'hidden') stop(); }
  function onPageshow(ev) { if (ev && ev.persisted) stop(); }

  function listen(on) {
    var m = on ? 'addEventListener' : 'removeEventListener';
    for (var i = 0; i < STOP_ON.length; i++) doc[m](STOP_ON[i], stop, CAPTURE);
    doc[m]('touchstart', stop, PASSIVE);
    doc[m]('pointermove', onMove, PASSIVE);
    window[m]('scroll', stop, PASSIVE);
    doc[m]('visibilitychange', onVisibility);
    window[m]('pagehide', stop);
    window[m]('pageshow', onPageshow);
    if (stopBtn) stopBtn[m]('click', stop);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    var hadFocus = stopBtn && doc.activeElement === stopBtn;
    if (id !== null) clearInterval(id);
    id = null;
    listen(false);
    timer.classList.add('is-stopped');
    count.hidden = true;
    if (unit) unit.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
    if (text) text.textContent = 'Automatic redirect stopped. Choose where to go below.';
    if (status) status.textContent = 'Automatic redirect stopped.';
    if (hadFocus && text) text.focus();
  }

  function tick() {
    if (stopped) return;
    left -= 1;
    if (left > 0) { show(); return; }
    stopped = true;
    clearInterval(id);
    id = null;
    listen(false);
    location.replace(BASE + '/');
  }

  function start() {
    timer.hidden = false;
    show();
    if (status) status.textContent = 'This page will open the home page in ' + SECONDS + ' seconds. Press Stop to stay here.';
    listen(true);
    id = setInterval(tick, 1000);
  }

  start();
})();
