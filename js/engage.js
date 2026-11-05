/* Mayobe Bros — reactions, comments and counts. Talks to the Cloudflare Worker in /worker.
   Everything here is progressive: if the API is unreachable the articles are still fully readable. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var API = (root.getAttribute('data-api') || '').replace(/\/$/, '') + '/v1';
  if (API === '/v1') return;
  var TURNSTILE = root.getAttribute('data-turnstile') || '';
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var pageLoaded = Date.now();

  function store(k, v, session) {
    try {
      var s = session ? sessionStorage : localStorage;
      if (v === undefined) return s.getItem(k);
      s.setItem(k, v);
    } catch (e) { /* blocked */ }
    return null;
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // a random id kept in this browser, so one visitor = one reaction per post. It is not tied to a person.
  function cid() {
    var v = store('mb_cid');
    if (!v || !/^[A-Za-z0-9-]{16,64}$/.test(v)) {
      v = window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
      store('mb_cid', v);
    }
    return v;
  }
  function call(path, opts) {
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function post(path, body) {
    return call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
  var total = function (s) { return s.r.like + s.r.amazed + s.r.sad + s.r.angry; };

  /* ----------------------------------------------- counts on listing cards */
  // Also runs again for cards that js/pager.js slides in when the reader changes page without a reload.
  function cardStats(scope) {
    var cardBoxes = $$('[data-stats]', scope);
    if (!cardBoxes.length) return;
    var slugs = [];
    cardBoxes.forEach(function (b) { var s = b.getAttribute('data-stats'); if (slugs.indexOf(s) < 0) slugs.push(s); });
    var paint = function (map) {
      cardBoxes.forEach(function (b) {
        var st = map[b.getAttribute('data-stats')];
        if (!st) return;
        $('[data-s="c"]', b).textContent = st.c;
        $('[data-s="r"]', b).textContent = total(st);
        b.hidden = false;
      });
    };
    var cached = null;
    try { cached = JSON.parse(store('mb_stats', undefined, true) || 'null'); } catch (e) { cached = null; }
    var fresh = cached && Date.now() - cached.t < 60000;
    if (fresh && slugs.every(function (s) { return cached.d[s]; })) { paint(cached.d); return; }
    var jobs = [];
    for (var i = 0; i < slugs.length; i += 50) jobs.push(call('/stats?slugs=' + slugs.slice(i, i + 50).join(',')));
    Promise.all(jobs).then(function (parts) {
      var all = fresh ? cached.d : {};
      parts.forEach(function (p) { for (var k in p) all[k] = p[k]; });
      store('mb_stats', JSON.stringify({ t: fresh ? cached.t : Date.now(), d: all }), true);
      paint(all);
    }).catch(function () { /* counts stay hidden */ });
  }
  cardStats(doc);
  doc.addEventListener('mb:content', function (e) { cardStats(e.detail && e.detail.root ? e.detail.root : doc); });

  /* ----------------------------------------------------------- post page */
  var box = $('[data-engage]');
  var cbox = $('[data-comments]');
  if (!box && !cbox) return;
  var slug = (box || cbox).getAttribute('data-slug');

  var buttons = box ? $$('.reaction', box) : [];
  var note = box ? $('.engage-note', box) : null;
  var mine = null;      // what the screen shows (changes the instant the reader taps)
  var confirmed = null; // what the server has; the two meet again after each round trip
  var syncing = false, touched = false;

  function showStats(st) {
    buttons.forEach(function (b) { $('.n', b).textContent = st.r[b.getAttribute('data-r')]; });
    paintTotal();
    var link = $('[data-comment-count-link]');
    if (link) link.textContent = plural(st.c, 'comment', 'comments');
    var h = $('[data-comment-count]');
    if (h) h.textContent = '(' + st.c + ')';
  }
  function paintTotal() {
    var tot = $('[data-total]');
    if (!tot) return;
    var sum = buttons.reduce(function (n, b) { return n + (Number($('.n', b).textContent) || 0); }, 0);
    tot.textContent = sum ? plural(sum, 'reaction', 'reactions') : 'Be the first to react';
  }
  function showMine() {
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-r') === mine ? 'true' : 'false'); });
  }
  function say(text, bad) { if (note) { note.textContent = text; note.style.color = bad ? 'var(--err)' : ''; } }

  // a few particles leave the icon in the mood's own direction: hearts and stars spread, tears fall, embers rise
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BURST = {
    like: { n: 8, from: 0, to: 360, min: 30, max: 46, star: false },
    amazed: { n: 9, from: 0, to: 360, min: 34, max: 54, star: true },
    sad: { n: 6, from: 60, to: 120, min: 26, max: 44, star: false },
    angry: { n: 7, from: 235, to: 305, min: 30, max: 50, star: false }
  };
  function burst(btn, type) {
    var cfg = BURST[type], medal = $('.medal', btn);
    if (calm || !cfg || !medal) return;
    $$('.rx-dot', medal).forEach(function (d) { d.remove(); });
    for (var i = 0; i < cfg.n; i++) {
      var ang = (cfg.from + (cfg.to - cfg.from) * (i + Math.random() * 0.7) / cfg.n) * Math.PI / 180;
      var dist = cfg.min + Math.random() * (cfg.max - cfg.min);
      var dot = el('i', 'rx-dot' + (cfg.star ? ' is-star' : ''));
      dot.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      dot.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      dot.style.setProperty('--s', (5 + Math.random() * 4).toFixed(1) + 'px');
      dot.style.setProperty('--d', (i * 22) + 'ms');
      dot.setAttribute('aria-hidden', 'true');
      medal.appendChild(dot);
    }
    setTimeout(function () { $$('.rx-dot', medal).forEach(function (d) { d.remove(); }); }, 1500);
  }
  var THANKS = {
    like: 'Glad you liked it.',
    amazed: 'Glad it surprised you.',
    sad: 'Sorry this one made you feel sad.',
    angry: 'We hear you. Tell us what bothered you in the comments.'
  };

  // Send the reader's latest choice. Taps are never ignored while a request is on its way: the screen changes at once, and
  // only the newest choice is sent when the previous round trip ends (so ten quick taps cost two requests, not ten).
  function sync() {
    if (syncing || mine === confirmed) return;
    syncing = true;
    var target = mine;
    post('/posts/' + slug + '/react', { cid: cid(), type: target }).then(function (j) {
      confirmed = target;
      try { sessionStorage.removeItem('mb_stats'); } catch (e) {}
      if (mine === target) { showStats(j.stats); say(target ? THANKS[target] : 'Reaction removed.'); } // a newer tap is waiting: do not repaint older numbers
    }).catch(function (err) {
      mine = confirmed; showMine(); refresh(); say(err.message, true); // go back to what the server has
    }).then(function () { syncing = false; sync(); });
  }
  buttons.forEach(function (b) {
    // pressed look on the first touch, not after the finger lifts (iOS Safari only paints :active with a touch listener)
    var press = function (on) { b.classList.toggle('is-press', on); };
    b.addEventListener('pointerdown', function () { press(true); });
    ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(function (t) { b.addEventListener(t, function () { press(false); }); });
    b.addEventListener('click', function () {
      var type = b.getAttribute('data-r');
      var next = mine === type ? null : type;
      var before = mine;
      touched = true;
      // update the screen at once, then confirm with the server
      var counter = $('.n', b);
      if (before) { var o = buttons.filter(function (x) { return x.getAttribute('data-r') === before; })[0]; if (o) $('.n', o).textContent = Math.max(0, Number($('.n', o).textContent) - 1); }
      if (next) counter.textContent = Number(counter.textContent) + 1;
      mine = next; showMine(); paintTotal();
      b.classList.remove('is-pop'); void b.offsetWidth; if (next) { b.classList.add('is-pop'); burst(b, next); }
      counter.classList.remove('is-bump'); void counter.offsetWidth; counter.classList.add('is-bump');
      if (next && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* not allowed here */ } } // a light tap on phones that support it
      say(next ? THANKS[next] : 'Reaction removed.');
      sync();
    });
  });

  /* ------------------------------------------------------------- comments */
  var list = cbox ? $('[data-comment-list]', cbox) : null;
  var form = cbox ? $('.comment-form', cbox) : null;

  function ago(ms) {
    var s = Math.round((ms - Date.now()) / 1000), abs = Math.abs(s);
    var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
    var units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) if (abs >= units[i][1]) return rtf ? rtf.format(Math.round(s / units[i][1]), units[i][0]) : new Date(ms).toDateString();
    return 'just now';
  }
  function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; }
  function commentNode(c, canReply) {
    var wrap = el('article', 'comment');
    wrap.id = 'comment-' + c.id;
    var av = el('span', 'avatar', (c.name[0] || '?').toUpperCase());
    av.style.background = 'hsl(' + hue(c.name) + ' 55% 22%)';
    av.style.color = '#fff';
    av.setAttribute('aria-hidden', 'true');
    var main = el('div');
    var head = el('div', 'comment-head');
    head.appendChild(el('span', 'comment-name', c.name));
    if (c.team) {
      var badge = el('span', 'team-badge');
      badge.title = 'Written by the Mayobe Bros team';
      badge.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';
      badge.appendChild(doc.createTextNode('Team'));
      head.appendChild(badge);
      wrap.classList.add('is-team');
    }
    var t = el('time', 'comment-time', ago(c.at));
    t.setAttribute('datetime', new Date(c.at).toISOString());
    head.appendChild(t);
    main.appendChild(head);
    main.appendChild(el('p', 'comment-body', c.body)); // text only, never HTML
    if (canReply) {
      var r = el('button', 'comment-reply', 'Reply');
      r.type = 'button';
      r.addEventListener('click', function () { startReply(c); });
      main.appendChild(r);
    }
    wrap.appendChild(av);
    wrap.appendChild(main);
    if (c.replies && c.replies.length) {
      var rep = el('div', 'comment-replies');
      c.replies.forEach(function (x) { rep.appendChild(commentNode(x, false)); });
      wrap.appendChild(rep);
    }
    return wrap;
  }
  // Comments appear 10 conversations at a time (a conversation = a comment with its replies); a button shows the next 10.
  var COMMENT_BATCH = 10, shownTop = COMMENT_BATCH, allComments = [];
  function renderComments(items) {
    if (!list) return;
    allComments = items;
    list.textContent = '';
    if (!items.length) { list.appendChild(el('p', 'comment-empty', 'No comments yet. Be the first to share your thoughts.')); return; }
    items.slice(0, shownTop).forEach(function (c) { list.appendChild(commentNode(c, true)); });
    if (items.length > shownTop) {
      var left = items.slice(shownTop).reduce(function (n, c) { return n + 1 + (c.replies ? c.replies.length : 0); }, 0);
      var more = el('button', 'btn btn-outline comments-more', 'Show more comments (' + left + ' left)');
      more.type = 'button';
      more.addEventListener('click', function () { shownTop += COMMENT_BATCH; renderComments(allComments); });
      list.appendChild(more);
    }
  }
  function startReply(c) {
    form.elements.parent.value = c.id;
    var cancel = $('[data-cancel-reply]', form);
    cancel.hidden = false;
    var s = $('.form-status', form);
    s.className = 'form-status'; s.textContent = 'Replying to ' + c.name + '.';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.body.focus({ preventScroll: true });
  }
  function refresh() {
    return call('/posts/' + slug).then(function (j) {
      showStats(j.stats);
      renderComments(j.comments);
    }).catch(function () {
      if (list && !list.children.length) list.appendChild(el('p', 'comment-empty', 'Comments could not be loaded right now. Please refresh in a moment.'));
    });
  }

  var widget = null;
  function loadTurnstile() {
    if (!TURNSTILE || widget !== null) return;
    widget = false;
    var s = el('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = function () { widget = window.turnstile.render($('[data-turnstile-slot]', form), { sitekey: TURNSTILE }); };
    doc.head.appendChild(s);
  }

  if (form) {
    var status = $('.form-status', form);
    var submit = $('button[type="submit"]', form);
    var setStatus = function (cls, text) { status.className = 'form-status' + (cls ? ' ' + cls : ''); status.textContent = text; };
    ['focusin'].forEach(function (ev) { form.addEventListener(ev, loadTurnstile, { once: true }); });
    $('[data-cancel-reply]', form).addEventListener('click', function () { form.elements.parent.value = ''; this.hidden = true; setStatus('', ''); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var name = f.name.value.trim(), body = f.body.value.trim(), email = f.email.value.trim();
      [f.name, f.body].forEach(function (x) { x.setAttribute('aria-invalid', x.value.trim().length < (x === f.name ? 2 : 3) ? 'true' : 'false'); });
      if (name.length < 2) { setStatus('is-err', 'Please enter your name.'); f.name.focus(); return; }
      if (body.length < 3) { setStatus('is-err', 'Please write your comment.'); f.body.focus(); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('is-err', 'That email address does not look right.'); f.email.focus(); return; }
      if (/(https?:\/\/|www\.)/i.test(body)) { setStatus('is-err', 'Links are not allowed in comments.'); f.body.focus(); return; }
      var payload = { name: name, email: email, body: body, parent: f.parent.value || null, cid: cid(), website: f.website.value, ts: pageLoaded };
      if (TURNSTILE && window.turnstile && widget) payload.tt = window.turnstile.getResponse(widget);
      submit.disabled = true;
      setStatus('', 'Sending…');
      post('/posts/' + slug + '/comments', payload).then(function (j) {
        try { sessionStorage.removeItem('mb_stats'); } catch (e) {}
        f.body.value = ''; f.parent.value = ''; $('[data-cancel-reply]', form).hidden = true;
        if (j && j.status === 'approved' && j.comment) {
          setStatus('is-ok', 'Thank you! Your comment is now live.');
          shownTop = Math.max(shownTop, COMMENT_BATCH);
          refresh().then(function () {
            var node = doc.getElementById('comment-' + j.comment.id);
            if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        } else if (j && j.status === 'duplicate') {
          setStatus('is-ok', 'You already sent this comment.');
        } else {
          setStatus('is-ok', 'Thank you! Your comment needs a quick check by our team and will appear once it is approved.');
        }
        if (TURNSTILE && window.turnstile && widget) window.turnstile.reset(widget);
      }).catch(function (err) {
        setStatus('is-err', err.message);
      }).then(function () { submit.disabled = false; });
    });
  }

  /* load on screen, and when the comments come into view */
  if (box) call('/posts/' + slug + '/mine?cid=' + encodeURIComponent(cid())).then(function (j) { confirmed = j.reaction; if (!touched) { mine = j.reaction; showMine(); } else sync(); }).catch(function () {});
  var started = false;
  var start = function () { if (!started) { started = true; refresh(); } };
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '600px 0px' });
    io.observe(box || cbox);
  } else start();
  // the "comments" link in the post header needs the count straight away
  if ($('[data-comment-count-link]')) start();
})();
