/* Mayobe Bros: the contact form when the mail service is on. It sends the message to the comments service, which emails it to us.
   Without JavaScript, or when the send fails, the form falls back to a prefilled email in the visitor's own mail app. */
(function () {
  'use strict';

  var doc = document;
  var form = doc.getElementById('contact-form');
  if (!form || !form.hasAttribute('data-mail-api')) return;
  var endpoint = form.getAttribute('data-endpoint') || '';
  var mailto = form.getAttribute('data-mailto') || '';
  if (!endpoint) return;
  var status = form.querySelector('.form-status');
  var button = form.querySelector('button[type="submit"]');
  var loaded = Date.now();
  var sending = false;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var RULES = {
    name: [2, 50, 'Please enter your name (2 to 50 characters).'],
    email: [0, 254, 'Please enter an email address that looks right, like you@example.com.'],
    subject: [3, 120, 'Please enter a subject (3 to 120 characters).'],
    message: [10, 3000, 'Please write a message of 10 to 3,000 characters.']
  };

  function setStatus(kind, text) {
    status.className = 'form-status' + (kind ? ' is-' + kind : '');
    status.textContent = text;
  }
  function fieldError(k, text) {
    var input = form.elements[k], note = doc.getElementById('cf-' + k + '-err');
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (note) { note.textContent = text || ''; note.hidden = !text; }
  }
  function valid(k, v) {
    var r = RULES[k];
    if (k === 'email') return v.length <= r[1] && EMAIL_RE.test(v);
    return v.length >= r[0] && v.length <= r[1];
  }
  function fallback(f) {
    var body = 'Name: ' + f.name.value.trim() + '\nEmail: ' + f.email.value.trim() + '\n\n' + f.message.value.trim();
    var href = 'mailto:' + mailto + '?subject=' + encodeURIComponent(f.subject.value.trim()) + '&body=' + encodeURIComponent(body);
    status.className = 'form-status is-err';
    status.textContent = 'Sorry, we could not send your message from this page. ';
    var a = doc.createElement('a');
    a.href = href;
    a.textContent = 'Send it from your own email app instead';
    status.appendChild(a);
    status.appendChild(doc.createTextNode(' (it opens with your message filled in), or write to ' + mailto + '.'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    var f = form.elements, first = null;
    Object.keys(RULES).forEach(function (k) {
      var ok = valid(k, f[k].value.trim());
      fieldError(k, ok ? '' : RULES[k][2]);
      if (!ok && !first) first = f[k];
    });
    if (first) { setStatus('err', 'Please check the highlighted fields.'); first.focus(); return; }
    var payload = { name: f.name.value.trim(), email: f.email.value.trim(), subject: f.subject.value.trim(), message: f.message.value.trim(), website: f.website ? f.website.value : '', ts: loaded };
    sending = true;
    button.disabled = true;
    setStatus('', 'Sending…');
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, body: j || {} }; });
      })
      .then(function (r) {
        if (r.ok && r.body.ok) {
          form.reset();
          loaded = Date.now();
          setStatus('ok', 'Thank you. Your message was sent. If it needs a reply, we will write to the address you gave.');
          status.focus();
        } else if (r.status === 400 && r.body.error) {
          setStatus('err', r.body.error);
          status.focus();
        } else if (r.status === 429) {
          setStatus('err', 'You have sent several messages already. Please try again later, or email us at ' + mailto + '.');
          status.focus();
        } else {
          fallback(f);
          status.focus();
        }
      }, function () { fallback(f); status.focus(); })
      .then(function () { sending = false; button.disabled = false; });
  });
  form.addEventListener('input', function (e) {
    var k = e.target && e.target.name;
    if (RULES[k] && e.target.getAttribute('aria-invalid') === 'true' && valid(k, e.target.value.trim())) fieldError(k, '');
  });
})();
