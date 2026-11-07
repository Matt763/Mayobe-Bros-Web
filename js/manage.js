/* Mayobe Bros — the /manage/ page. It turns the link in a comment email into this browser's edit/delete code,
   or stops reply emails. Nothing is sent when the page opens: email scanners and link previewers open links too,
   so the API is called only when a person presses the button (the go function below). */
(function () {
  'use strict';

  var doc = document;
  var API = (doc.documentElement.getAttribute('data-api') || '').replace(/\/$/, '') + '/v1';
  var box = doc.querySelector('[data-manage]');
  if (!box || API === '/v1') return;
  var $ = function (s) { return box.querySelector(s); };
  var title = $('[data-manage-title]'), text = $('[data-manage-text]'), button = $('[data-manage-go]'), status = $('[data-manage-status]'), help = $('[data-manage-help]');

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
      var keys = Object.keys(o).sort(function (a, b) { return Number(a) - Number(b); });
      while (keys.length > OWN_MAX) delete o[keys.shift()];
      localStorage.setItem(OWN_KEY, JSON.stringify(o));
      return true;
    } catch (e) { return false; }
  }

  function say(cls, msg) { status.className = 'form-status' + (cls ? ' ' + cls : ''); status.textContent = msg; }
  function show(h, p, label) {
    title.textContent = h;
    text.textContent = p;
    if (label) { button.textContent = label; button.hidden = false; } else button.hidden = true;
  }
  function fail(code) {
    button.hidden = false; button.disabled = false;
    button.textContent = 'Try again';
    if (code === 404) { button.hidden = true; show(kind === 'u' ? 'We could not find that request' : 'This link has expired or was removed', kind === 'u' ? 'The link may be old, or the emails for this comment may already be stopped.' : 'Links in our emails work for 7 days. If you still want to edit or delete your comment, write to us and we will help.'); say('is-err', ''); help.hidden = false; }
    else if (code === 429) say('is-err', 'Too many tries. Please wait a little and press the button again.');
    else say('is-err', 'We could not reach the comments service. Please check your connection and try again.');
  }

  if (kind === 'l') show('Open your comment', 'Press the button to let this browser edit or delete the comment you wrote. Nothing happens until you press it.', 'Open my comment');
  else if (kind === 'u') show('Stop reply emails', 'Press the button and we will stop sending you emails about replies to this comment. Your comment stays on the site.', 'Stop reply emails');
  else if (!frag) show('Open the link from your email', 'This page works with the link in an email from us. If you came here without one, there is nothing to do.');
  else { show('This link does not look right', 'It may have been cut short when it was copied. Open the link from the email again, or copy the whole address.'); help.hidden = false; }

  // The only network helper. Both calls are made by the go function, which only the button's click handler runs.
  function call(url, init) {
    return fetch(url, init).then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, ok: r.ok, j: j || {} }; }); });
  }

  // The only place the API is called. It runs only from the button's click handler.
  function go() {
    button.disabled = true;
    say('', kind === 'u' ? 'Stopping reply emails…' : 'Opening your comment…');
    var path = kind === 'u' ? '/notify/unsubscribe' : '/manage/exchange';
    var body = kind === 'u' ? { token: secret } : { link: secret };
    call(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), referrerPolicy: 'no-referrer', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) { fail(r.status); return; }
        if (kind === 'u') {
          show('Reply emails stopped', 'We will not email you about replies to this comment any more. You can still read replies on the article.');
          say('is-ok', ''); help.hidden = true; secret = '';
          return;
        }
        var j = r.j || {};
        if (j.id == null || !/^\d+$/.test(String(j.id)) || typeof j.token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(j.token) || typeof j.slug !== 'string' || !SLUG_RE.test(j.slug)) { fail(404); return; }
        if (!ownSet(j.id, j.token)) { button.hidden = true; show('This browser cannot save the code', 'Your browser is blocking storage for this site, so it cannot remember that the comment is yours. Allow site data for this page and open the link again.'); say('is-err', ''); help.hidden = false; return; }
        secret = '';
        button.hidden = true;
        say('is-ok', 'Taking you to your comment…');
        // article addresses include the category (/post/<category>/<slug>/), so look the slug up in the site's own article list
        return call(doc.documentElement.getAttribute('data-base') + '/data/search.json', { credentials: 'omit' }).then(function (l) {
          var list = Array.isArray(l.j) ? l.j : [], path = '';
          for (var i = 0; i < list.length; i++) if (list[i] && list[i].s === j.slug && typeof list[i].u === 'string' && /^\/post\/[a-z0-9]+(?:[a-z0-9/-]*[a-z0-9])?\/$/.test(list[i].u)) { path = list[i].u; break; }
          if (!path) { say('', ''); show('This browser can now edit your comment', 'Open the article you wrote it on and use the Edit or Delete button under your comment.'); help.hidden = true; return; }
          location.assign(doc.documentElement.getAttribute('data-base') + path + '#comment-' + j.id);
        });
      })
      .catch(function () { fail(0); });
  }
  if (secret) button.addEventListener('click', go);
  // a new link pasted into the address bar of this open page (only the part after # changes, so the page does not reload by itself)
  window.addEventListener('hashchange', function () { if (location.hash) location.reload(); });
})();
