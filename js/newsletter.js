/* Mayobe Bros: the /newsletter/ page. It confirms a sign-up (#c=<code>) or stops the newsletter (#u=<code>) from the link in our email.
   Nothing is sent when the page opens: email scanners and link previewers open links too, so the API is called only when a person
   presses the button (the go function below). Nothing is stored in the browser.
   Every press ends in a sentence that says what happened: done, already used or expired, or "could not reach our server" with a
   Try again button. A request with no answer after 15 seconds counts as "could not reach". */
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
  function say(cls, msg) { status.className = 'form-status' + (cls ? ' ' + cls : ''); status.textContent = msg; }
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
      if (kind === 'u') outcome('info', 'is-err', 'We could not find that subscription', 'The link may be old, or the address may already have been removed from our list. If you still get our emails, write to us and we will remove it.', 'We could not find that subscription.');
      else outcome('info', 'is-err', 'This link was already used or has expired', 'If you already pressed Confirm, you are subscribed and there is nothing more to do. If not, the link may be older than 7 days: sign up again with the form at the bottom of this page.', 'This link was already used or has expired.');
      return;
    }
    button.hidden = false;
    idle('Try again');
    state('err');
    say('is-err', code === 429 ? 'Too many tries. Please wait a little and press the button again.' : 'We could not reach our server. Check your connection, then press Try again.');
    button.focus();
  }
  function show(st, h, p, label) {
    title.textContent = h;
    text.textContent = p;
    state(st);
    if (label) { button.textContent = label; button.hidden = false; } else { button.hidden = true; showNext(); }
  }

  if (kind === 'c') show('mail', 'One last step: confirm your subscription', 'You opened the link from our email. Press the button to finish. We ask for this press so that email scanners cannot sign anyone up.', 'Confirm my subscription');
  else if (kind === 'u') show('mail', 'Stop newsletter emails', 'Press the button and we will stop sending you newsletter emails. Nothing happens until you press it.', 'Unsubscribe');
  else if (!frag) show('info', 'Open the link from your email', 'This page works with the link in an email from us. To sign up, use the form at the bottom of this page.');
  else show('info', 'This link does not look right', 'It may have been cut short when it was copied. Open the link from the email again, or copy the whole address.');

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
        if (kind === 'u') outcome('ok', 'is-ok', 'You are unsubscribed', 'Thank you for reading. We will not send you newsletter emails any more. If you change your mind, you can sign up again with the form at the bottom of this page.', 'You are unsubscribed from our newsletter.', { noHelp: true });
        else outcome('ok', 'is-ok', 'You are subscribed', 'Thank you. We will send you one email when we publish a new article, and every email has a link to stop. We are sending a welcome email with our latest articles. It can take a few minutes, and on a very busy day it may be skipped.', 'You are subscribed. Your subscription is confirmed.', { noHelp: true });
      })
      .catch(function () { busy = false; fail(0); });
  }
  if (secret) button.addEventListener('click', go);
  // a new link pasted into the address bar of this open page (only the part after # changes, so the page does not reload by itself)
  window.addEventListener('hashchange', function () { if (location.hash) location.reload(); });
})();
