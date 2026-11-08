/* Mayobe Bros: the /newsletter/ page. It confirms a sign-up (#c=<code>) or stops the newsletter (#u=<code>) from the link in our email.
   Nothing is sent when the page opens: email scanners and link previewers open links too, so the API is called only when a person
   presses the button (the go function below). Nothing is stored in the browser.
   Every press ends in a sentence that says what happened: done, "Link is invalid or expired" (one wording for a wrong, old or used
   link, so the page never says whether an address is on the list), or "Could not confirm" with a Try again button. A request with no
   answer after 15 seconds counts as a failure. */
(function () {
  'use strict';

  var doc = document;
  var API = (doc.documentElement.getAttribute('data-api') || '').replace(/\/$/, '') + '/v1';
  var box = doc.querySelector('[data-newsletter-page]');
  if (!box || API === '/v1') return;
  var $ = function (s) { return box.querySelector(s); };
  var title = $('[data-nl-title]'), text = $('[data-nl-text]'), button = $('[data-nl-go]'), status = $('[data-nl-status]'), help = $('[data-nl-help]'), next = $('[data-next]');
  var WAIT_MS = 15000;

  // Read the code from the address bar once, then take it (and any query string) out of the address,
  // so it is not in history, the back button or a shared screenshot.
  var frag = String(location.hash || '');
  var m = /^#([cu])=([A-Za-z0-9_-]{32,64})$/.exec(frag);
  var kind = m ? m[1] : '';
  var secret = m ? m[2] : '';
  if (frag || location.search) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }

  // the card's picture: mail (waiting for a press), busy, ok (check mark), info (nothing to do / already used), err (could not reach)
  function state(s) { box.setAttribute('data-state', s); }
  function say(cls, msg) { status.className = 'form-status st-status' + (cls ? ' ' + cls : ''); status.textContent = msg; }
  function showNext() { if (next) next.hidden = false; }
  function idle(label) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
  // A final state: the sentence is announced in the status region, the button is gone, the latest articles appear,
  // and focus moves to the new heading (so it never falls back to the top of the page when the pressed button disappears).
  function outcome(st, cls, h, p, announce, opts) {
    opts = opts || {};
    title.textContent = h;
    text.textContent = p;
    button.hidden = true;
    idle('');
    if (help) help.hidden = !!opts.noHelp;
    state(st);
    say(cls, announce);
    showNext();
    title.focus();
  }
  function fail(code) {
    if (code === 404) {
      // the same title for both buttons and every cause; the sentence under it is general advice, true whatever the state of the address
      outcome('info', 'is-err', 'Link is invalid or expired', kind === 'u' ? 'If you already unsubscribed, you are all set.' : 'If you already confirmed, you are all set.', 'Link is invalid or expired.');
      return;
    }
    var what = kind === 'u' ? 'Could not unsubscribe' : 'Could not confirm';
    title.textContent = code === 429 ? 'Too many attempts' : what;
    text.textContent = code === 429 ? 'Try again later.' : 'Check your connection, then try again.';
    button.hidden = false;
    idle('Try again');
    state('err');
    say('is-err', code === 429 ? 'Too many attempts. Try again later.' : what + '. Try again.');
    button.focus();
  }
  function show(st, h, p, label) {
    title.textContent = h;
    text.textContent = p;
    state(st);
    if (label) { button.textContent = label; button.hidden = false; } else { button.hidden = true; showNext(); }
  }

  if (kind === 'c') show('mail', 'Confirm your subscription', 'Press the button to finish signing up.', 'Confirm subscription');
  else if (kind === 'u') show('mail', 'Stop newsletter emails', 'Press the button to stop receiving them.', 'Unsubscribe');
  else if (!frag) show('info', 'Open the email link', 'This page opens from the link in our email.');
  else show('info', 'Link is invalid or expired', 'Open the link from the email again.');

  // One POST that gives up after 15 seconds. The first answer wins: a late reply after the timeout is ignored.
  function post(url, body) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { if (ctl) ctl.abort(); reject(new Error('timeout')); }, WAIT_MS);
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), referrerPolicy: 'no-referrer', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { clearTimeout(timer); resolve(r); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  var busy = false;
  // The only place the API is called. It runs only from the button's click handler.
  function go() {
    if (!secret || busy) return; // used, missing or already waiting: nothing to send
    busy = true;
    var wait = kind === 'u' ? 'Unsubscribing...' : 'Confirming...';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = wait;
    state('busy');
    say('', wait);
    post(API + (kind === 'u' ? '/newsletter/unsubscribe' : '/newsletter/confirm'), { token: secret })
      .then(function (r) {
        busy = false;
        if (!r.ok) { fail(r.status); return; }
        secret = '';
        if (kind === 'u') outcome('ok', 'is-ok', 'You are unsubscribed', 'You will no longer get our newsletter.', 'You are unsubscribed.', { noHelp: true });
        else outcome('ok', 'is-ok', 'You are subscribed', 'A welcome email may arrive in a few minutes.', 'You are subscribed.', { noHelp: true });
      })
      .catch(function () { busy = false; fail(0); });
  }
  if (secret) button.addEventListener('click', go);
  // a new link pasted into the address bar of this open page (only the part after # changes, so the page does not reload by itself)
  window.addEventListener('hashchange', function () { if (location.hash) location.reload(); });
})();
