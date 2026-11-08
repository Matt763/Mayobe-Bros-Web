/* Mayobe Bros — the 404 page (404.html only, loaded before js/site.js so it runs before analytics).
   Without this file the page is complete. It adds:
   - on an email-link path (/newsletter/, /manage/): takes the link code out of the address first, then shows the notice;
   - "Go back" when there is a page to go back to.
   It never redirects, never fetches, never stores anything and shows only text that is already in the page. */
(function () {
  'use strict';

  var FLOW = /^\/(newsletter|manage)(\/|$)/;
  var doc = document;
  var box = doc.querySelector('[data-nf]');
  if (!box) return;
  var $ = function (name) { return box.querySelector('[data-nf-' + name + ']'); };

  var BASE = doc.documentElement.getAttribute('data-base') || '';
  var path = location.pathname || '/';
  var rel = BASE && (path === BASE || path.indexOf(BASE + '/') === 0) ? path.slice(BASE.length) || '/' : path;

  var back = $('back'), flow = $('flow');

  if (back && history.length > 1) {
    back.hidden = false;
    back.addEventListener('click', function () { history.back(); });
  }

  // Email links: the code leaves the address bar before anything else runs (GTM, the beacon, a Referer never see it).
  if (FLOW.test(rel)) {
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
    if (flow) flow.hidden = false;
  }
})();
