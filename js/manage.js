/* Mayobe Bros — the /manage/ page. It turns the link in a comment email into this browser's edit/delete code,
   or stops reply emails. Nothing is sent when the page opens: email scanners and link previewers open links too,
   so the API is called only when a person presses the button (the go function below). Every press ends in a sentence that says
   what happened; a request with no answer after 15 seconds counts as "could not reach", with a Try again button. */
(function () {
  'use strict';

  var doc = document;
  var API = (doc.documentElement.getAttribute('data-api') || '').replace(/\/$/, '') + '/v1';
  var box = doc.querySelector('[data-manage]');
  if (!box || API === '/v1') return;
  var $ = function (s) { return box.querySelector(s); };
  var title = $('[data-manage-title]'), text = $('[data-manage-text]'), button = $('[data-manage-go]'), status = $('[data-manage-status]'), help = $('[data-manage-help]'), next = $('[data-next]');
  var WAIT_MS = 15000;

  // Read the secret from the address bar once, then take it out of the address (and so out of history and the back button).
  var frag = String(location.hash || '');
  var m = /^#([lu])=([A-Za-z0-9_-]{32,64})$/.exec(frag);
  var kind = m ? m[1] : '';
  var secret = m ? m[2] : '';
  if (frag) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }

  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var OWN_KEY = 'mb_own', OWN_MAX = 60;
  // the same storage format as js/engage.js: { "<comment id>": "<code>" }, at most 60 (lowest ids dropped)
  function ownSet(id, token) {
    try {
      var o = null;
      try { o = JSON.parse(localStorage.getItem(OWN_KEY) || 'null'); } catch (e) { o = null; }
      if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
      o[String(id)] = token;
      // at most 60: drop the oldest OTHER entries (lowest ids), never the one just added
      var keys = Object.keys(o).filter(function (k) { return k !== String(id); }).sort(function (a, b) { return Number(a) - Number(b); });
      while (keys.length + 1 > OWN_MAX) delete o[keys.shift()];
      localStorage.setItem(OWN_KEY, JSON.stringify(o));
      return true;
    } catch (e) { return false; }
  }

  // the card's picture: mail (waiting for a press), busy, ok (check mark), info (nothing to do / expired), err (could not reach)
  function state(s) { box.setAttribute('data-state', s); }
  function say(cls, msg) { status.className = 'form-status' + (cls ? ' ' + cls : ''); status.textContent = msg; }
  function showNext() { if (next) next.hidden = false; }
  function idle(label) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
  // A final state: the sentence is announced in the status region, the action button is gone, the latest articles appear (opts.next),
  // and focus moves to the new heading (so it never falls back to the top of the page when the pressed button disappears).
  function outcome(cls, h, p, announce, opts) {
    opts = opts || {};
    title.textContent = h;
    text.textContent = p;
    button.hidden = true;
    idle('');
    help.hidden = !!opts.noHelp;
    state(cls === 'is-ok' ? 'ok' : opts.next ? 'info' : 'err');
    say(cls, announce);
    if (opts.next) showNext();
    title.focus();
  }
  function fail(code) {
    if (code === 404) {
      if (kind === 'u') outcome('is-err', 'We could not find that request', 'The link may be old, or the emails for this comment may already be stopped.', 'We could not find that request.', { next: true });
      else outcome('is-err', 'This link has expired or was removed', 'Links in our emails work for 7 days. If you still want to edit or delete your comment, write to us and we will help.', 'This link has expired or was removed.', { next: true });
      return;
    }
    button.hidden = false;
    idle('Try again');
    state('err');
    say('is-err', code === 429 ? 'Too many tries. Please wait a little and press the button again.' : 'We could not reach the comments service. Check your connection, then press Try again.');
    button.focus();
  }
  function show(st, h, p, label) {
    title.textContent = h;
    text.textContent = p;
    state(st);
    if (label) { button.textContent = label; button.hidden = false; } else { button.hidden = true; showNext(); }
  }

  if (kind === 'l') show('mail', 'Open your comment', 'Press the button to let this browser edit or delete the comment you wrote. Nothing happens until you press it.', 'Open my comment');
  else if (kind === 'u') show('mail', 'Stop reply emails', 'Press the button and we will stop sending you emails about replies to this comment. Your comment stays on the site.', 'Stop reply emails');
  else if (!frag) show('info', 'Open the link from your email', 'This page works with the link in an email from us. If you came here without one, there is nothing to do.');
  else { show('info', 'This link does not look right', 'It may have been cut short when it was copied. Open the link from the email again, or copy the whole address.'); help.hidden = false; }

  // The only network helper. Both calls are made by the go function, which only the button's click handler runs.
  // It gives up after 15 seconds (the first answer wins: a late reply after the timeout is ignored).
  function call(url, init) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) init.signal = ctl.signal;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { if (ctl) ctl.abort(); reject(new Error('timeout')); }, WAIT_MS);
      fetch(url, init)
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, ok: r.ok, j: j || {} }; }); })
        .then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  var PATH_RE = /^\/post\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*\/$/;
  var FALLBACK = ['This browser can now edit your comment', 'Open the article you wrote it on and find your comment: the Edit and Delete buttons are under it.', 'This browser can now edit your comment. Open the article and find your comment.'];

  var busy = false;
  // The only place the API is called. It runs only from the button's click handler.
  function go() {
    if (!secret || busy) return; // used, missing or already waiting: nothing to send
    busy = true;
    var sent = secret;
    var wait = kind === 'u' ? 'Stopping reply emails...' : 'Opening your comment...';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = wait;
    state('busy');
    say('', wait);
    var stored = false;
    var endpoint = kind === 'u' ? '/notify/unsubscribe' : '/manage/exchange';
    var body = kind === 'u' ? { token: sent } : { link: sent };
    call(API + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), referrerPolicy: 'no-referrer', credentials: 'omit' })
      .then(function (r) {
        busy = false;
        if (!r.ok) { fail(r.status); return; }
        if (kind === 'u') {
          secret = '';
          outcome('is-ok', 'Reply emails stopped', 'We will not email you about replies to this comment any more. You can still read replies on the article.', 'Reply emails stopped. You can still read replies on the article.', { noHelp: true, next: true });
          return;
        }
        var j = r.j || {};
        if (j.id == null || !/^\d+$/.test(String(j.id)) || typeof j.token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(j.token) || typeof j.slug !== 'string' || !SLUG_RE.test(j.slug)) { fail(404); return; }
        if (!ownSet(j.id, j.token)) {
          secret = '';
          outcome('is-err', 'This browser cannot save the code', 'Your browser is blocking storage for this site, so it cannot remember that the comment is yours. Allow site data for this page and open the link again.', 'This browser cannot save the code. Allow site data for this page and open the link again.');
          return;
        }
        // From here the code is stored. The button never comes back: pressing it again would send nothing useful.
        stored = true;
        secret = '';
        button.hidden = true;
        idle('');
        var base = doc.documentElement.getAttribute('data-base') || '';
        var go2 = function (path) { say('is-ok', 'Taking you to your comment...'); title.focus(); location.assign(base + path + '#comment-' + j.id); };
        if (typeof j.path === 'string' && j.path.length <= 300 && PATH_RE.test(j.path)) { go2(j.path); return; }
        // the server could not say where the article is: look the slug up in the site's own article list
        return call(base + '/data/search.json', { credentials: 'omit' }).then(function (l) {
          var list = Array.isArray(l.j) ? l.j : [];
          for (var i = 0; i < list.length; i++) if (list[i] && list[i].s === j.slug && typeof list[i].u === 'string' && list[i].u.length <= 300 && PATH_RE.test(list[i].u)) { go2(list[i].u); return; }
          outcome('is-ok', FALLBACK[0], FALLBACK[1], FALLBACK[2], { noHelp: true, next: true });
        });
      })
      .catch(function () {
        busy = false;
        if (stored) outcome('is-ok', FALLBACK[0], FALLBACK[1], FALLBACK[2], { noHelp: true, next: true });
        else fail(0);
      });
  }
  if (secret) button.addEventListener('click', go);
  // a new link pasted into the address bar of this open page (only the part after # changes, so the page does not reload by itself)
  window.addEventListener('hashchange', function () { if (location.hash) location.reload(); });
})();
