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
  var human = typeof window !== 'undefined' && window.MBTurnstile ? window.MBTurnstile.attach(form) : null; // null when the page has no Turnstile key
  var sending = false;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // field: [fewest characters, most characters, label]. The message names the field and the problem, in a few words (see problem()).
  var RULES = {
    name: [2, 50, 'Name'],
    email: [0, 254, 'Email'],
    subject: [3, 120, 'Subject'],
    message: [10, 3000, 'Message']
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
  // '' when the value is fine, otherwise a short sentence ("Name is required.", "Email looks incorrect.", "Message is too short.")
  function problem(k, v) {
    var r = RULES[k];
    if (!v) return r[2] + ' is required.';
    if (k === 'email') return v.length <= r[1] && EMAIL_RE.test(v) ? '' : 'Email looks incorrect.';
    if (v.length < r[0]) return r[2] + ' is too short.';
    return v.length > r[1] ? r[2] + ' is too long.' : '';
  }
  function valid(k, v) { return !problem(k, v); }
  // One random id per form fill. The server uses it to recognise a retry of the same message, so a retry after a timeout is not delivered twice.
  function newId() {
    var out = '';
    try {
      var a = new Uint8Array(16);
      window.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) out += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    } catch (e) { out = ''; }
    while (out.length < 32) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
  var formId = newId();
  // encodeURIComponent throws on a lone surrogate half: swap each one for U+FFFD first (real pairs stay)
  function wellFormed(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xDC00 && str.charCodeAt(i + 1) <= 0xDFFF) { out += str.charAt(i) + str.charAt(i + 1); i++; }
      else if (c >= 0xD800 && c <= 0xDFFF) out += '�';
      else out += str.charAt(i);
    }
    return out;
  }
  // Encodes text for a mailto link but stops once about `max` encoded characters are used, so the link stays short enough for mail apps.
  var NOTE = '\n\n(message shortened)';
  function encodeLimited(text, max) {
    var out = '', i = 0, cut = false;
    while (i < text.length) {
      var cp = text.charCodeAt(i) >= 0xD800 && text.charCodeAt(i) <= 0xDBFF ? 2 : 1;
      var piece = encodeURIComponent(text.substr(i, cp));
      if (out.length + piece.length > max) { cut = true; break; }
      out += piece;
      i += cp;
    }
    return cut ? out + encodeURIComponent(NOTE) : out;
  }
  function plainFallback() {
    status.className = 'form-status is-err';
    status.textContent = 'Message not sent. Email us at ' + mailto + '.';
  }
  // The address itself is the link: it opens the visitor's mail app with the message already filled in.
  function fallback(f, lead) {
    var text = 'Name: ' + wellFormed(f.name.value.trim()) + '\nEmail: ' + wellFormed(f.email.value.trim()) + '\n\n' + wellFormed(f.message.value.trim());
    var href = 'mailto:' + mailto + '?subject=' + encodeURIComponent(wellFormed(f.subject.value.trim()).slice(0, 120)) + '&body=' + encodeLimited(text, 1800);
    var a = doc.createElement('a');
    a.href = href;
    a.textContent = mailto;
    status.className = 'form-status is-err';
    status.textContent = lead || 'Message not sent. Email us at ';
    status.appendChild(a);
    status.appendChild(doc.createTextNode('.'));
  }
  function showFallback(f, lead) {
    try { fallback(f, lead); } catch (e) { plainFallback(); }
    try { status.focus(); } catch (e) { /* nothing to do */ }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    var f = form.elements, first = null;
    Object.keys(RULES).forEach(function (k) {
      var why = problem(k, f[k].value.trim());
      fieldError(k, why);
      if (why && !first) first = f[k];
    });
    if (first) { setStatus('err', 'Some fields need attention.'); first.focus(); return; }
    var payload = { name: f.name.value.trim(), email: f.email.value.trim(), subject: f.subject.value.trim(), message: f.message.value.trim(), website: f.website ? f.website.value : '', ts: loaded, id: formId };
    sending = true;
    button.disabled = true;
    setStatus('', 'Sending…');
    var handle = function (r) {
      if (r.ok && r.body.ok) {
        form.reset();
        loaded = Date.now();
        formId = newId();
        setStatus('ok', 'Message sent.');
        status.focus();
      } else if (r.status === 400 && r.body.field && RULES[r.body.field] && r.body.error) {
        fieldError(r.body.field, r.body.error);
        setStatus('err', 'Invalid input.');
        f[r.body.field].focus();
      } else if (r.status === 400 && r.body.field === 'check') {
        setStatus('err', 'Complete the security check.');
        status.focus();
      } else if (r.status === 429) {
        showFallback(f, 'Too many attempts. Email us at ');
      } else {
        showFallback(f);
      }
    };
    var send = function (tt) {
      if (tt) payload.tt = tt;
      return fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    };
    (human ? human.token().then(send) : send(''))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, body: j || {} }; });
      })
      .then(handle)
      .catch(function () { showFallback(f); })
      .then(function () { if (human) human.reset(); sending = false; button.disabled = false; });
  });
  form.addEventListener('input', function (e) {
    var k = e.target && e.target.name;
    if (RULES[k] && e.target.getAttribute('aria-invalid') === 'true' && valid(k, e.target.value.trim())) fieldError(k, '');
  });
})();
