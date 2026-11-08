/* Mayobe Bros: the newsletter form in the footer. It sends the address to the comments service, which emails a link to confirm.
   The answer is the same for every address, whatever its state, so the page never reveals whether it is on the list.
   Nothing is sent when the page opens, and nothing is stored in the browser.
   The form moves through three states, written to its data-state attribute (css/style.css draws them): idle, sending, sent.
   "sent" fades a "Check your inbox" card in over the form; "Use a different address" brings the form back. */
(function () {
  'use strict';

  var doc = document;
  // the page-load time. Each sign-up sends how long the visitor has been on the page (ms, on this device's own clock only):
  // the server ignores sign-ups sent in under 2.5 seconds (most bots), so it is always sent.
  // performance.now() never jumps when the device clock is changed; Date.now() is the fallback for very old browsers.
  var clock = function () { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); };
  var loaded = clock();
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var BAD = 'Email looks incorrect.';
  var EMPTY = 'Email is required.';
  var base = doc.documentElement.getAttribute('data-base') || '';
  // A one-letter slip in a big provider's name is the most common reason a confirmation never arrives, so it is offered back once.
  var COMMON = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];

  // true when a and b differ by one inserted, missing or changed letter, or two letters swapped
  function near(a, b) {
    if (a === b) return false;
    var la = a.length, lb = b.length, i = 0;
    if (Math.abs(la - lb) > 1) return false;
    while (i < la && i < lb && a.charAt(i) === b.charAt(i)) i++;
    if (la === lb) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true; // one letter changed
      return a.charAt(i) === b.charAt(i + 1) && a.charAt(i + 1) === b.charAt(i) && a.slice(i + 2) === b.slice(i + 2); // two swapped
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  function suggestion(email) {
    var at = email.lastIndexOf('@');
    if (at < 1) return '';
    var domain = email.slice(at + 1).toLowerCase();
    for (var i = 0; i < COMMON.length; i++) if (near(domain, COMMON[i])) return email.slice(0, at + 1) + COMMON[i];
    return '';
  }

  function wire(form) {
    var endpoint = form.getAttribute('data-endpoint') || '';
    if (!endpoint) return;
    var q = function (s) { return form.querySelector(s); };
    var input = form.elements.email;
    var trap = form.elements.website;
    var human = typeof window !== 'undefined' && window.MBTurnstile ? window.MBTurnstile.attach(form) : null; // null when the page has no Turnstile key
    var status = q('.foot-status');
    var button = q('button[type="submit"]');
    var label = q('.nl-btn-label');
    var field = q('.nl-field');
    var panelForm = q('[data-nl-form]');
    var panelDone = q('[data-nl-done]');
    var title = q('[data-nl-title]');
    var body = q('[data-nl-body]');
    var again = q('[data-nl-again]');
    var sending = false;
    var said = 0;
    var warned = ''; // the address a "did you mean" hint was shown for; sending the same one again sends it as typed

    function setState(s) { form.setAttribute('data-state', s); }
    function setLabel(t) { if (label) label.textContent = t; }

    // One live region (role="status"): it is emptied first and filled a moment later, so the same sentence twice is still read out.
    // kind: '' (plain), 'quiet' (read out only, not drawn), 'err', 'warn'. `extra` adds a link (RSS) or a button (use the suggestion) after the sentence.
    function say(kind, text, extra) {
      status.className = 'foot-status nl-status' + (kind ? ' is-' + kind : '');
      status.textContent = '';
      var mine = ++said;
      setTimeout(function () {
        if (mine !== said) return; // a newer message replaced this one
        status.textContent = text;
        if (extra === 'rss') {
          var a = doc.createElement('a');
          a.href = base + '/rss/';
          a.textContent = 'RSS';
          status.appendChild(a);
          status.appendChild(doc.createTextNode('.'));
        } else if (extra && extra.use) {
          status.appendChild(doc.createTextNode(' '));
          var b = doc.createElement('button');
          b.type = 'button';
          b.className = 'nl-link';
          b.textContent = 'Yes, use it';
          b.addEventListener('click', function () { input.value = extra.use; warned = ''; submit(); });
          status.appendChild(b);
        }
      }, 60);
    }
    // a short sideways nudge on the field (transform only; the stylesheet drops it for reduced motion)
    function nudge() {
      if (!field || !field.classList) return;
      field.classList.remove('is-nudge');
      void field.offsetWidth; // restart the animation when it is hit twice in a row
      field.classList.add('is-nudge');
    }
    function badAddress(empty) {
      input.setAttribute('aria-invalid', 'true');
      say('err', empty ? EMPTY : BAD);
      nudge();
      input.focus();
    }
    function showDone(email) {
      if (body) {
        // the same short sentences in the footer and in the sidebar; they keep the "if the address can receive email" hedge,
        // because a mail can be delayed, skipped or blocked and the page must not promise it
        body.textContent = 'If the address can receive email, a link is on its way:';
        var strong = doc.createElement('strong');
        strong.textContent = email; // text only, never HTML; it sits on its own line so it is never cut in the middle
        body.appendChild(strong);
        body.appendChild(doc.createTextNode('Open it to finish.'));
      }
      if (panelDone) { panelDone.removeAttribute('inert'); panelDone.removeAttribute('aria-hidden'); }
      if (panelForm) { panelForm.setAttribute('inert', ''); panelForm.setAttribute('aria-hidden', 'true'); }
      setState('sent');
      // the pressed button is gone, so focus moves to the new heading (read out by screen readers) without scrolling the page
      if (title) title.focus({ preventScroll: true });
    }
    function showForm() {
      if (panelForm) { panelForm.removeAttribute('inert'); panelForm.removeAttribute('aria-hidden'); }
      if (panelDone) { panelDone.setAttribute('inert', ''); panelDone.setAttribute('aria-hidden', 'true'); }
      setState('idle');
      say('', '');
      input.focus({ preventScroll: true });
    }

    function submit() {
      if (sending) return;
      var email = String(input.value || '').trim();
      if (!email || email.length > 254 || !EMAIL_RE.test(email)) { warned = ''; badAddress(!email); return; }
      var hint = suggestion(email);
      if (hint && warned !== email) { // ask once; pressing Subscribe again with the same address sends it as typed
        warned = email;
        input.setAttribute('aria-invalid', 'false');
        say('warn', 'Did you mean ' + hint + '?', { use: hint });
        nudge();
        input.focus();
        return;
      }
      warned = '';
      input.setAttribute('aria-invalid', 'false');
      sending = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      setState('sending');
      setLabel('Sending…');
      say('quiet', 'Sending…'); // read out by screen readers; the button already says it on screen
      var send = function (tt) {
        var payload = { email: email, website: trap ? String(trap.value || '') : '', elapsed: Math.max(0, Math.round(clock() - loaded)) };
        if (tt) payload.tt = tt;
        return fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'omit'
        });
      };
      (human ? human.token().then(send) : send(''))
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, body: j || {} }; });
        })
        .then(function (r) {
          if (r.ok) {
            form.reset();
            say('', ''); // the card says it; focus moves to it
            showDone(email);
          } else if (r.status === 429) {
            setState('idle');
            say('err', 'Too many attempts. Try again later.');
          } else if (r.status === 400 && r.body.field === 'check') {
            setState('idle');
            say('err', 'Complete the security check.');
          } else if (r.status === 400 && r.body.field === 'email') {
            setState('idle');
            badAddress();
          } else {
            setState('idle');
            say('err', 'Something went wrong. Use ', 'rss');
          }
        })
        .catch(function () { setState('idle'); say('err', 'Something went wrong. Use ', 'rss'); })
        .then(function () { if (human) human.reset(); sending = false; button.disabled = false; button.removeAttribute('aria-busy'); setLabel('Subscribe'); });
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    if (again) again.addEventListener('click', showForm);
    form.hidden = false; // the form is hidden in the HTML so that nothing can be sent without this script
    input.addEventListener('input', function () {
      if (input.getAttribute('aria-invalid') === 'true' && EMAIL_RE.test(String(input.value || '').trim())) input.setAttribute('aria-invalid', 'false');
    });
  }

  var forms = doc.querySelectorAll('form[data-newsletter]');
  for (var i = 0; i < forms.length; i++) wire(forms[i]);
})();
