/* Mayobe Bros: Cloudflare Turnstile for the sign-up and contact forms (the comment form loads its own, js/engage.js).
   Only on pages built with a Turnstile site key (data-turnstile on <html>). Cloudflare's script is requested only when a reader
   starts to use a form (focus or press inside it), never when the page opens. The widget is hidden unless Cloudflare needs the reader
   to do something. window.MBTurnstile.attach(form) returns { token(): Promise<string>, reset() }; the string is empty when no
   token could be had, and the server then answers "Complete the security check.". */
(function (root) {
  'use strict';
  var doc = root.document;
  if (!doc) return;
  var KEY = doc.documentElement.getAttribute('data-turnstile') || '';
  var loading = null;

  function api() {
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = function () { resolve(root.turnstile); };
      s.onerror = function () { loading = null; reject(new Error('blocked')); };
      doc.head.appendChild(s);
    });
    return loading;
  }

  function attach(form) {
    if (!KEY || !form) return null;
    var id = null, token = '', failed = false, started = false, waiting = [];
    function settle(t) { token = t; waiting.splice(0).forEach(function (f) { f(t); }); }
    function start() {
      if (started) return;
      started = true;
      var slot = doc.createElement('div');
      slot.className = 'cf-turnstile-slot';
      form.appendChild(slot);
      api().then(function (ts) {
        id = ts.render(slot, {
          sitekey: KEY,
          appearance: 'interaction-only',
          callback: function (t) { failed = false; settle(t); },
          'error-callback': function () { failed = true; settle(''); },
          'expired-callback': function () { token = ''; },
          'timeout-callback': function () { token = ''; }
        });
      }, function () { failed = true; settle(''); });
    }
    form.addEventListener('focusin', start, { once: true });
    form.addEventListener('pointerdown', start, { once: true });
    return {
      token: function () {
        start();
        if (token) return Promise.resolve(token);
        if (failed && id !== null && root.turnstile) { failed = false; try { root.turnstile.reset(id); } catch (e) { /* the wait below ends */ } }
        return new Promise(function (resolve) {
          waiting.push(resolve);
          setTimeout(function () { resolve(''); }, 15000);
        });
      },
      reset: function () {
        token = '';
        if (id !== null && root.turnstile) { try { root.turnstile.reset(id); } catch (e) { /* nothing to do */ } }
      }
    };
  }

  root.MBTurnstile = { attach: attach };
})(window);
