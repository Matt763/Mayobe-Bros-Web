/* Mayobe Bros: the /newsletter/ page. It confirms a sign-up (#c=<code>) or stops the newsletter (#u=<code>) from the link in our email.
   Nothing is sent when the page opens: email scanners and link previewers open links too, so the API is called only when a person
   presses the button (the go function below). Nothing is stored in the browser. */
(function () {
  'use strict';

  var doc = document;
  var API = (doc.documentElement.getAttribute('data-api') || '').replace(/\/$/, '') + '/v1';
  var box = doc.querySelector('[data-newsletter-page]');
  if (!box || API === '/v1') return;
  var $ = function (s) { return box.querySelector(s); };
  var title = $('[data-nl-title]'), text = $('[data-nl-text]'), button = $('[data-nl-go]'), status = $('[data-nl-status]'), help = $('[data-nl-help]'), home = $('[data-nl-home]');

  // Read the code from the address bar once, then take it (and any query string) out of the address,
  // so it is not in history, the back button or a shared screenshot.
  var frag = String(location.hash || '');
  var m = /^#([cu])=([A-Za-z0-9_-]{32,64})$/.exec(frag);
  var kind = m ? m[1] : '';
  var secret = m ? m[2] : '';
  if (frag || location.search) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }

  function say(cls, msg) { status.className = 'form-status' + (cls ? ' ' + cls : ''); status.textContent = msg; }
  // A final state: the sentence is announced in the status region, the button is gone, and focus moves to the new heading.
  function outcome(cls, h, p, announce, opts) {
    opts = opts || {};
    title.textContent = h;
    text.textContent = p;
    button.hidden = true;
    if (help) help.hidden = !!opts.noHelp;
    if (home) home.hidden = !opts.home;
    say(cls, announce);
    title.focus();
  }
  function fail(code) {
    if (code === 404) {
      if (kind === 'u') outcome('is-err', 'We could not find that subscription', 'The link may be old, or the address may already have been removed from our list. If you still get our emails, write to us and we will remove it.', 'We could not find that subscription.');
      else outcome('is-err', 'This link has expired or was already used', 'A confirmation link works once, for 7 days. If you are not getting our emails, sign up again with the form at the bottom of this page.', 'This link has expired or was already used.');
      return;
    }
    button.hidden = false; button.disabled = false;
    button.textContent = 'Try again';
    say('is-err', code === 429 ? 'Too many tries. Please wait a little and press the button again.' : 'We could not reach our server. Please check your connection and try again.');
    button.focus();
  }
  function show(h, p, label) {
    title.textContent = h;
    text.textContent = p;
    if (label) { button.textContent = label; button.hidden = false; } else button.hidden = true;
  }

  if (kind === 'c') show('Confirm your subscription', 'Press the button to start getting one email when we publish a new article. Nothing happens until you press it.', 'Confirm my subscription');
  else if (kind === 'u') show('Stop newsletter emails', 'Press the button and we will stop sending you newsletter emails. Nothing happens until you press it.', 'Unsubscribe');
  else if (!frag) show('Open the link from your email', 'This page works with the link in an email from us. To sign up, use the form at the bottom of this page.');
  else show('This link does not look right', 'It may have been cut short when it was copied. Open the link from the email again, or copy the whole address.');

  // The only place the API is called. It runs only from the button's click handler.
  function go() {
    if (!secret) return; // used or missing: nothing to send
    button.disabled = true;
    say('', kind === 'u' ? 'Unsubscribing…' : 'Confirming…');
    fetch(API + (kind === 'u' ? '/newsletter/unsubscribe' : '/newsletter/confirm'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: secret }), referrerPolicy: 'no-referrer', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) { fail(r.status); return; }
        secret = '';
        if (kind === 'u') outcome('is-ok', 'You are unsubscribed', 'We will not send you newsletter emails any more. If you change your mind, you can sign up again with the form at the bottom of this page.', 'You are unsubscribed from our newsletter.', { noHelp: true, home: true });
        else outcome('is-ok', 'Your subscription is confirmed', 'Thank you. You will get one email when we publish a new article. Every email has a link to stop them.', 'Your subscription is confirmed.', { noHelp: true, home: true });
      })
      .catch(function () { fail(0); });
  }
  if (secret) button.addEventListener('click', go);
  // a new link pasted into the address bar of this open page (only the part after # changes, so the page does not reload by itself)
  window.addEventListener('hashchange', function () { if (location.hash) location.reload(); });
})();
