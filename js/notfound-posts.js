/* Mayobe Bros — "Posts you may be interested in" on the 404 page (404.html only).
   The page ships with the nine newest posts and a "More articles" link. When /data/search.json loads, every published post is shuffled
   once (Fisher-Yates) and shown nine at a time with the same pagination bar as the site's lists, changed in place: no reload, and the
   address never changes (this file is served at any missing address). If the list cannot be loaded, the built-in posts stay.
   The values come from our own search index and are escaped before they are written. */
(function () {
  'use strict';

  var doc = document;
  var box = doc.querySelector('[data-nf-posts]');
  if (!box || !window.fetch) return;
  var grid = box.querySelector('[data-nf-grid]');
  var pager = box.querySelector('[data-nf-pager]');
  var all = box.querySelector('[data-nf-all]');
  if (!grid || !pager) return;

  var BASE = doc.documentElement.getAttribute('data-base') || '';
  var PER = parseInt(box.getAttribute('data-per'), 10) || 9;
  var ICON = {
    left: '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
    right: '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var list = [];
  var page = 1;
  var total = 1;
  var status = box.querySelector('[data-nf-pager-status]');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // only addresses on this site, never javascript: or another origin
  function local(s) { return typeof s === 'string' && /^\/(?!\/)/.test(s) ? s : ''; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function dateText(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
  }

  function card(p) {
    var img = local(p.i);
    var date = dateText(p.d);
    return '<article class="card"><div class="card-media">' +
      (img ? '<img class="lazyfade" src="' + esc(img) + '" alt="" width="1400" height="800" loading="lazy" decoding="async">' : '') +
      '<span class="badge">' + esc(p.c) + '</span></div><div class="card-body">' +
      '<h3 class="card-title"><a class="card-link" href="' + esc(local(p.u)) + '">' + esc(p.t) + '</a></h3>' +
      '<p class="card-excerpt">' + esc(p.e) + '</p>' +
      '<div class="card-meta">' + (date ? '<time datetime="' + esc(p.d) + '">' + esc(date) + '</time>' : '') + '</div></div></article>';
  }

  function items(cur, reach) {
    var show = {}, arr = [], out = [], n, i;
    show[1] = show[total] = true;
    for (n = cur - reach; n <= cur + reach; n++) if (n >= 1 && n <= total) show[n] = true;
    for (n in show) arr.push(+n);
    arr.sort(function (x, y) { return x - y; });
    for (i = 0; i < arr.length; i++) {
      if (i) { var gap = arr[i] - arr[i - 1]; if (gap === 2) out.push(arr[i - 1] + 1); else if (gap > 2) out.push('…'); }
      out.push(arr[i]);
    }
    return out;
  }
  function href(n) { return BASE + (n > 1 ? '/post/page/' + n + '/' : '/post/'); }
  function numbers(reach, cls) {
    return '<ul class="page-list ' + cls + '">' + items(page, reach).map(function (n) {
      if (n === '…') return '<li class="page-gap" aria-hidden="true">…</li>';
      var cur = n === page;
      return '<li><a class="page-num' + (cur ? ' is-current' : '') + '" href="' + href(n) + '" data-page="' + n + '" aria-label="Page ' + n + '"' + (cur ? ' aria-current="page"' : '') + '>' + n + '</a></li>';
    }).join('') + '</ul>';
  }
  function bar() {
    var prev = page > 1
      ? '<a class="page-btn page-prev" href="' + href(page - 1) + '" data-page="' + (page - 1) + '" rel="prev">' + ICON.left + '<span>Newer</span></a>'
      : '<span class="page-btn page-prev is-disabled" aria-disabled="true">' + ICON.left + '<span>Newer</span></span>';
    var next = page < total
      ? '<a class="page-btn page-next" href="' + href(page + 1) + '" data-page="' + (page + 1) + '" rel="next"><span>Older</span>' + ICON.right + '</a>'
      : '<span class="page-btn page-next is-disabled" aria-disabled="true"><span>Older</span>' + ICON.right + '</span>';
    var from = (page - 1) * PER + 1, to = Math.min(page * PER, list.length);
    return '<nav class="pagination" aria-label="Pagination"><div class="pagination-bar">' + prev + numbers(2, 'page-list-full') + numbers(1, 'page-list-compact') + next + '</div>' +
      '<p class="pagination-note">Page ' + page + ' of ' + total + ' · Articles ' + from + ' to ' + to + ' of ' + list.length + '</p></nav>';
  }

  // the live region ships empty in the page (a region inserted already filled is often not read); only its text changes
  function announce(text) { if (status) status.textContent = text; }

  function lazy() {
    var imgs = grid.querySelectorAll ? grid.querySelectorAll('img.lazyfade') : [];
    Array.prototype.forEach.call(imgs, function (img) {
      var done = function () { img.classList.add('is-loaded'); };
      if (img.complete) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); }
    });
  }

  function draw() {
    grid.innerHTML = list.slice((page - 1) * PER, page * PER).map(card).join('');
    pager.innerHTML = total > 1 ? bar() : '';
    lazy();
  }

  // the full and the compact number lists both hold the current page; only one of them is shown
  function visible(nodes) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].offsetParent !== null) return nodes[i];
    return nodes[0] || null;
  }
  function go(n, userMoved) {
    if (n < 1 || n > total || n === page) return;
    page = n;
    draw();
    announce('Page ' + page + ' of ' + total);
    if (userMoved) {
      var keep = visible(pager.querySelectorAll('.page-num.is-current'));
      var top = box.querySelector('.nf-more-title');
      if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start' });
      if (keep && keep.focus) keep.focus({ preventScroll: true });
    }
  }

  pager.addEventListener('click', function (ev) {
    var t = ev.target;
    var a = t && t.closest ? t.closest('a[data-page]') : null;
    if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button > 0) return;
    ev.preventDefault();
    go(parseInt(a.getAttribute('data-page'), 10), true);
  });

  fetch(BASE + '/data/search.json')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      if (!Array.isArray(d)) return;
      var ok = d.filter(function (p) { return p && p.t && local(p.u); });
      if (!ok.length) return;
      list = shuffle(ok.slice());
      total = Math.max(1, Math.ceil(list.length / PER));
      if (all) all.hidden = true;
      draw();
    })
    ['catch'](function () { /* the nine built-in posts stay */ });
})();
