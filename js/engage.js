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
  // the id if this browser already has one; never creates it (page load must not store anything)
  function cidIfAny() {
    var v = store('mb_cid');
    return v && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : '';
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

  /* Comments this browser wrote: { "<id>": "<manage token>" }, at most 60 (the lowest ids, the oldest, are dropped).
     The token is the only proof of ownership. It stays in this browser, goes only in a request body, and is never shown or logged. */
  var OWN_KEY = 'mb_own', OWN_MAX = 60, EDIT_MS = 30 * 60000;
  function ownAll() {
    var o = null;
    try { o = JSON.parse(store(OWN_KEY) || 'null'); } catch (e) { o = null; }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  }
  function ownGet(id) { var t = ownAll()[String(id)]; return typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t) ? t : null; }
  function ownSave(o) { store(OWN_KEY, JSON.stringify(o)); }
  function ownSet(id, token) {
    if (id == null || typeof token !== 'string') return;
    var o = ownAll();
    o[String(id)] = token;
    var keys = Object.keys(o).sort(function (a, b) { return Number(a) - Number(b); });
    while (keys.length > OWN_MAX) delete o[keys.shift()];
    ownSave(o);
  }
  function ownDrop(id) { var o = ownAll(); if (String(id) in o) { delete o[String(id)]; ownSave(o); } }
  // one polite message for screen readers about what a comment button just did
  function liveSay(text) {
    var n = $('[data-comment-live]', cbox);
    if (!n) return;
    n.textContent = '';
    setTimeout(function () { n.textContent = text; }, 60);
  }
  var likedIds = {}, likePending = {};
  var HEART = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  function tool(cls, text) { var b = el('button', 'comment-tool ' + cls, text); b.type = 'button'; return b; }
  function paintLike(btn, c) {
    var on = !!likedIds[c.id], n = c.likes || 0;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', 'Like this comment, ' + plural(n, 'like', 'likes'));
    btn.classList.toggle('is-on', on);
    btn.textContent = '';
    btn.insertAdjacentHTML('afterbegin', HEART);
    btn.appendChild(el('span', 'comment-like-text', on ? 'Liked' : 'Like'));
    if (n > 0) btn.appendChild(el('span', 'comment-like-n', String(n)));
  }
  function toggleLike(c, btn) {
    if (likePending[c.id]) return; // one request per comment at a time
    likePending[c.id] = true;
    var want = !likedIds[c.id], was = !want, wasN = c.likes || 0;
    likedIds[c.id] = want; c.likes = Math.max(0, wasN + (want ? 1 : -1));
    paintLike(btn, c);
    post('/comments/' + c.id + '/like', { cid: cid(), on: want }).then(function (j) {
      if (j && typeof j.likes === 'number') c.likes = j.likes;
      if (j && typeof j.liked === 'boolean') likedIds[c.id] = j.liked;
      paintLike(btn, c);
    }).catch(function (err) {
      likedIds[c.id] = was; c.likes = wasN;
      paintLike(btn, c);
      liveSay(err.message || 'Your like could not be saved. Please try again.');
    }).then(function () { delete likePending[c.id]; });
  }
  function focusAfter(id, sel) {
    var n = doc.getElementById('comment-' + id);
    if (!n) { var h = doc.getElementById('comments-h'); if (h) h.focus(); return; }
    var b = sel ? $(sel, n) : null;
    (b || n).focus({ preventScroll: false });
  }
  function startEdit(c, node) {
    var main = $('.comment-main', node), body = $('.comment-body', main), tools = $('.comment-tools', main);
    if ($('.comment-edit', main)) return;
    var box = el('div', 'comment-edit field');
    var lab = el('label', null, 'Edit your comment'); lab.setAttribute('for', 'ce-' + c.id);
    var ta = el('textarea'); ta.id = 'ce-' + c.id; ta.maxLength = 1500; ta.rows = 4; ta.value = c.body;
    var row = el('div', 'comment-actions');
    var save = el('button', 'btn btn-primary', 'Save'); save.type = 'button';
    var cancel = el('button', 'btn btn-outline', 'Cancel'); cancel.type = 'button';
    var st = el('p', 'form-status'); st.setAttribute('role', 'status');
    row.appendChild(save); row.appendChild(cancel);
    box.appendChild(lab); box.appendChild(ta); box.appendChild(row); box.appendChild(st);
    body.hidden = true; tools.hidden = true;
    main.insertBefore(box, tools);
    ta.focus();
    function close() { box.remove(); body.hidden = false; tools.hidden = false; }
    function back() { close(); focusAfter(c.id, '.comment-edit-btn'); }
    cancel.addEventListener('click', back);
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); back(); } });
    save.addEventListener('click', function () {
      var text = ta.value.trim();
      if (text.length < 3) { st.className = 'form-status is-err'; st.textContent = 'Please write your comment.'; ta.focus(); return; }
      if (/(https?:\/\/|www\.)/i.test(text)) { st.className = 'form-status is-err'; st.textContent = 'Links are not allowed in comments.'; ta.focus(); return; }
      var token = ownGet(c.id);
      if (!token) { st.className = 'form-status is-err'; st.textContent = 'This browser can no longer edit this comment.'; return; }
      save.disabled = true; cancel.disabled = true;
      st.className = 'form-status'; st.textContent = 'Saving…';
      post('/comments/' + c.id + '/edit', { token: token, body: text }).then(function (j) {
        if (j && j.status === 'pending') {
          // hidden until approved: say so in place of the comment, because the comment is no longer in the public list
          var msg = 'Your edit needs a quick check by our team. The comment is hidden until it is approved.';
          close();
          body.hidden = true; tools.hidden = true;
          try { sessionStorage.removeItem('mb_stats'); } catch (e) {}
          var note = el('p', 'form-status is-ok', msg);
          main.insertBefore(note, tools);
          node.tabIndex = -1; node.focus();
          liveSay(msg);
          return;
        }
        try { sessionStorage.removeItem('mb_stats'); } catch (e) {}
        liveSay('Comment updated.');
        return refresh().then(function () { focusAfter(c.id, '.comment-edit-btn'); });
      }).catch(function (err) {
        if (err.status === 404) ownDrop(c.id);
        st.className = 'form-status is-err'; st.textContent = err.message;
        save.disabled = false; cancel.disabled = false;
        ta.focus();
      });
    });
  }
  function askDelete(c, node) {
    var main = $('.comment-main', node);
    if ($('.comment-confirm', main)) return;
    var tools = $('.comment-tools', main);
    var box = el('div', 'comment-confirm');
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Delete this comment?');
    var q = el('p', null, 'Delete this comment? It cannot be undone.');
    var row = el('div', 'comment-actions');
    var yes = el('button', 'btn btn-outline', 'Delete'); yes.type = 'button';
    var keep = el('button', 'btn btn-primary', 'Keep it'); keep.type = 'button';
    var st = el('p', 'form-status'); st.setAttribute('role', 'status');
    row.appendChild(yes); row.appendChild(keep);
    box.appendChild(q); box.appendChild(row); box.appendChild(st);
    main.insertBefore(box, tools.nextSibling);
    keep.focus();
    function back() { box.remove(); focusAfter(c.id, '.comment-delete-btn'); }
    keep.addEventListener('click', back);
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); back(); } });
    yes.addEventListener('click', function () {
      var token = ownGet(c.id);
      if (!token) { st.className = 'form-status is-err'; st.textContent = 'This browser can no longer delete this comment.'; return; }
      yes.disabled = true; keep.disabled = true;
      st.className = 'form-status'; st.textContent = 'Deleting…';
      post('/comments/' + c.id + '/delete', { token: token }).then(function () {
        ownDrop(c.id);
        try { sessionStorage.removeItem('mb_stats'); } catch (e) {}
        liveSay('Comment deleted.');
        return refresh().then(function () { var h = doc.getElementById('comments-h'); if (h) h.focus(); });
      }).catch(function (err) {
        if (err.status === 404) ownDrop(c.id);
        st.className = 'form-status is-err'; st.textContent = err.message;
        yes.disabled = false; keep.disabled = false;
        keep.focus();
      });
    });
  }
  function commentNode(c, canReply) {
    var wrap = el('article', 'comment');
    wrap.id = 'comment-' + c.id;
    wrap.tabIndex = -1; // so focus can return to the comment itself when a button is gone
    var gone = !!c.deleted;
    if (gone) wrap.classList.add('is-deleted');
    var av = el('span', 'avatar', c.team || gone ? '' : (c.name[0] || '?').toUpperCase());
    if (c.team) { var logo = el('img', 'avatar-logo'); logo.src = '/assets/img/icon-192.png'; logo.alt = ''; logo.width = 96; logo.height = 96; av.appendChild(logo); }
    else if (gone) { av.classList.add('avatar-gone'); }
    else { av.style.background = 'hsl(' + hue(c.name) + ' 55% 22%)'; av.style.color = '#fff'; }
    av.setAttribute('aria-hidden', 'true');
    var main = el('div', 'comment-main');
    var head = el('div', 'comment-head');
    if (!gone) head.appendChild(el('span', 'comment-name', c.name));
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
    if (c.edited && !gone) { var ed = el('span', 'comment-edited', 'edited'); ed.title = 'Edited ' + ago(c.edited); head.appendChild(ed); }
    main.appendChild(head);
    main.appendChild(el('p', 'comment-body', c.body)); // text only, never HTML
    var hasReplies = !!(c.replies && c.replies.length);
    if (!gone) {
      var tools = el('div', 'comment-tools');
      var lk = tool('comment-like', '');
      paintLike(lk, c);
      lk.addEventListener('click', function () { toggleLike(c, lk); });
      tools.appendChild(lk);
      if (canReply) {
        var r = tool('comment-reply-btn', 'Reply');
        r.addEventListener('click', function () { startReply(c); });
        tools.appendChild(r);
      }
      if (!c.team && ownGet(c.id)) {
        if (!hasReplies && Date.now() - c.at < EDIT_MS) {
          var eb = tool('comment-edit-btn', 'Edit');
          eb.addEventListener('click', function () { startEdit(c, wrap); });
          tools.appendChild(eb);
        }
        var db = tool('comment-delete-btn', 'Delete');
        db.addEventListener('click', function () { askDelete(c, wrap); });
        tools.appendChild(db);
      }
      main.appendChild(tools);
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
    return call('/posts/' + slug + (cidIfAny() ? '?cid=' + encodeURIComponent(cidIfAny()) : '')).then(function (j) {
      likedIds = {};
      (j.liked || []).forEach(function (id) { likedIds[id] = true; });
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
    // the "email me" box shows only while the email field holds an address that looks right, and is sent only then
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var notifyRow = $('[data-notify-row]', form);
    var syncNotify = function () {
      if (!notifyRow) return;
      var ok = EMAIL_RE.test(form.elements.email.value.trim());
      notifyRow.hidden = !ok;
      if (!ok) form.elements.notify.checked = false;
    };
    if (notifyRow) { form.elements.email.addEventListener('input', syncNotify); form.elements.email.addEventListener('change', syncNotify); syncNotify(); }
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
      var wantsMail = !!(notifyRow && !notifyRow.hidden && f.notify.checked && EMAIL_RE.test(email));
      if (wantsMail) payload.notify = true;
      var mailNote = wantsMail ? ' If the address is right, you will get an email shortly. Check your spam folder too.' : '';
      if (TURNSTILE && window.turnstile && widget) payload.tt = window.turnstile.getResponse(widget);
      submit.disabled = true;
      setStatus('', 'Sending…');
      post('/posts/' + slug + '/comments', payload).then(function (j) {
        try { sessionStorage.removeItem('mb_stats'); } catch (e) {}
        if (j && j.id != null && j.token) ownSet(j.id, j.token); // lets this browser edit or delete the comment later
        f.body.value = ''; f.parent.value = ''; $('[data-cancel-reply]', form).hidden = true;
        if (f.notify) f.notify.checked = false;
        if (j && j.status === 'approved' && j.comment) {
          setStatus('is-ok', 'Thank you! Your comment is now live.' + mailNote);
          shownTop = Math.max(shownTop, COMMENT_BATCH);
          refresh().then(function () {
            var node = doc.getElementById('comment-' + j.comment.id);
            if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        } else if (j && j.status === 'duplicate') {
          setStatus('is-ok', 'You already sent this comment.');
        } else {
          setStatus('is-ok', 'Thank you! Your comment needs a quick check by our team and will appear once it is approved.' + mailNote);
        }
        if (TURNSTILE && window.turnstile && widget) window.turnstile.reset(widget);
      }).catch(function (err) {
        setStatus('is-err', err.message);
      }).then(function () { submit.disabled = false; });
    });
  }

  /* load on screen, and when the comments come into view */
  if (box && cidIfAny()) call('/posts/' + slug + '/mine?cid=' + encodeURIComponent(cidIfAny())).then(function (j) { confirmed = j.reaction; if (!touched) { mine = j.reaction; showMine(); } else sync(); }).catch(function () {});
  var started = false;
  var start = function () { if (!started) { started = true; refresh(); } };
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '600px 0px' });
    io.observe(box || cbox);
  } else start();
  // the "comments" link in the post header needs the count straight away
  if ($('[data-comment-count-link]')) start();
})();
