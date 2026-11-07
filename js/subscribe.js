/* Mayobe Bros: the newsletter form in the footer. It sends the address to the comments service, which emails a link to confirm.
   The answer is the same for every address, whatever its state, so the page never reveals whether it is on the list.
   Nothing is sent when the page opens, and nothing is stored in the browser. */
(function () {
  'use strict';

  var doc = document;
  var loaded = Date.now(); // the page-load time: the server ignores sign-ups sent too soon after it (most bots), so it is always sent
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var BAD = 'Please enter an email address that looks right, like you@example.com.';
  var base = doc.documentElement.getAttribute('data-base') || '';

  function wire(form) {
    var endpoint = form.getAttribute('data-endpoint') || '';
    if (!endpoint) return;
    var input = form.elements.email;
    var trap = form.elements.website;
    var status = form.querySelector('.foot-status');
    var button = form.querySelector('button[type="submit"]');
    var sending = false;
    var said = 0;

    // One live region (role="status"): it is emptied first and filled a moment later, so the same sentence twice is still read out.
    function say(kind, text, rss) {
      status.className = 'foot-status' + (kind ? ' is-' + kind : '');
      status.textContent = '';
      var mine = ++said;
      setTimeout(function () {
        if (mine !== said) return; // a newer message replaced this one
        status.textContent = text;
        if (rss) {
          var a = doc.createElement('a');
          a.href = base + '/rss/';
          a.textContent = 'RSS';
          status.appendChild(a);
          status.appendChild(doc.createTextNode('.'));
        }
      }, 60);
    }
    function badAddress() {
      input.setAttribute('aria-invalid', 'true');
      say('err', BAD);
      input.focus();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;
      var email = String(input.value || '').trim();
      if (!email || email.length > 254 || !EMAIL_RE.test(email)) { badAddress(); return; }
      input.setAttribute('aria-invalid', 'false');
      sending = true;
      button.disabled = true;
      say('', 'Sending…');
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email, website: trap ? String(trap.value || '') : '', ts: loaded }),
        credentials: 'omit'
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, body: j || {} }; });
        })
        .then(function (r) {
          if (r.ok) {
            form.reset();
            say('ok', 'Almost done. If this address can get our emails, we have sent it a link to confirm. Please check your inbox and spam folder.');
          } else if (r.status === 429) {
            say('err', 'Too many tries. Please wait an hour and try again.');
          } else if (r.status === 400 && r.body.field === 'email') {
            badAddress();
          } else {
            say('err', 'Sorry, that did not go through. Please try again later, or follow us with ', true);
          }
        })
        .catch(function () { say('err', 'Sorry, that did not go through. Please try again later, or follow us with ', true); })
        .then(function () { sending = false; button.disabled = false; });
    });
    input.addEventListener('input', function () {
      if (input.getAttribute('aria-invalid') === 'true' && EMAIL_RE.test(String(input.value || '').trim())) input.setAttribute('aria-invalid', 'false');
    });
  }

  var forms = doc.querySelectorAll('form[data-newsletter]');
  for (var i = 0; i < forms.length; i++) wire(forms[i]);
})();
