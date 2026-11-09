/* Mayobe Bros — tells the Worker that an article was really read, so the Popular page can be ordered by what readers open.
   A read is counted once per page view, only when the article has been on screen for 20 seconds AND the reader has scrolled
   40% of it. Nothing is stored in the browser, no cookie is set, and nothing is sent that names the reader: just the article's
   address name (and a flag when the reader came from the Popular page). A browser that asks not to be tracked
   (Global Privacy Control, Do Not Track) is never counted. The numbers are never shown on the site. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var api = (root.getAttribute('data-api') || '').replace(/\/$/, '');
  var article = doc.getElementById('article');
  var holder = doc.querySelector('[data-engage][data-slug]');
  if (!api || !article || !holder || !window.fetch) return;
  var slug = holder.getAttribute('data-slug') || '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return;
  var nav = window.navigator || {};
  if (nav.globalPrivacyControl === true || nav.doNotTrack === '1') return;

  var NEED_MS = 20000;
  var NEED_SCROLL = 0.4;
  var onScreen = 0; // milliseconds the page has really been in front of the reader
  var since = 0; // when the current stretch started (0 = not in front of the reader now)
  var deepest = 0; // how far down the article the reader has been, 0 to 1
  var done = false;
  var tick = 0;

  var shown = function () { return !doc.hidden && !doc.prerendering; };
  var measure = function () {
    var r = article.getBoundingClientRect();
    if (r.height <= 0) return;
    var seen = (window.innerHeight - r.top) / r.height; // the bottom edge of the screen, as a share of the article
    if (seen > deepest) deepest = seen;
  };
  var send = function () {
    done = true;
    clearInterval(tick);
    var fromPopular = 0;
    try {
      var ref = new URL(doc.referrer);
      if (ref.origin === window.location.origin && /^\/popular\//.test(ref.pathname)) fromPopular = 1;
    } catch (e) { /* no referrer */ }
    // text/plain keeps this a "simple" request (no preflight); the Worker reads the body as JSON either way
    fetch(api + '/v1/read', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ slug: slug, p: fromPopular }), keepalive: true, credentials: 'omit' }).catch(function () { /* a lost count is fine */ });
  };
  var check = function () {
    if (done) return;
    var now = Date.now();
    if (since) { onScreen += Math.min(now - since, 2500); since = now; } // a sleeping or idle tab cannot bank hours at once
    measure();
    if (onScreen >= NEED_MS && deepest >= NEED_SCROLL) send();
  };
  var sync = function () {
    if (done) return;
    var now = Date.now();
    if (shown()) { if (!since) since = now; }
    else if (since) { onScreen += now - since; since = 0; }
  };

  doc.addEventListener('visibilitychange', sync);
  doc.addEventListener('prerenderingchange', sync);
  window.addEventListener('scroll', function () { if (!done) measure(); }, { passive: true });
  sync();
  tick = setInterval(check, 1000);
})();
