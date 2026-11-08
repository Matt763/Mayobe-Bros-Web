/* Mayobe Bros: the theme button on the pages that email links open (/manage/ and /newsletter/). These pages do not load js/site.js, so
   this small file repeats its theme rule; keep the two in step (scripts/tests/status-theme.test.mjs checks that they agree).
   The page starts in the device's setting (the inline script in <head> sets the class, and the CSS follows prefers-color-scheme even
   without it). One press always flips what you see now. A choice is stored under "theme" (the key the whole site uses) only when it
   differs from the device, so a reader who never presses, or flips back to what the device says, has nothing stored and the page keeps
   following the device, also when the device changes while the page is open. */
(function () {
  'use strict';

  var root = document.documentElement;
  var buttons = document.querySelectorAll('[data-theme-toggle]');
  if (!buttons.length) return;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* storage may be blocked: the choice then lasts until the page closes */ }
    return null;
  }

  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var held = null; // the choice while storage is blocked
  var deviceDark = function () { return !!(mq && mq.matches); };
  function mode() {
    var t = store('theme') || held;
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
  function isDark() { var m = mode(); return m === 'dark' || (m === 'auto' && deviceDark()); }

  function apply() {
    var m = mode();
    var dark = isDark();
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', m === 'light');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      buttons[i].setAttribute('title', dark ? 'Light mode' : 'Dark mode');
    }
  }
  apply();

  var fadeTimer = 0;
  function press() {
    var target = isDark() ? 'light' : 'dark';
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm) {
      root.classList.add('theme-fade');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(function () { root.classList.remove('theme-fade'); }, 450);
    }
    var keep = (target === 'dark') === deviceDark() ? null : target;
    held = keep;
    store('theme', keep);
    apply();
  }
  for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener('click', press);

  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (mode() === 'auto') apply(); });
})();
