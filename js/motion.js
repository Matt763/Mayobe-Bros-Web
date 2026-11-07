/* Mayobe Bros: shared motion for in-place page changes (page numbers, "Show more", the 404 pager).
   window.MBMotion holds:
     - the math: easeInOutCubic, glideDuration (260 to 520 ms, longer for longer trips), planGlide;
     - glide(): a scroll that follows easeInOutCubic frame by frame instead of the browser's own smooth scroll, which has no
       duration or easing and can race across a long page. Only 0.8 of a screen is ever shown moving; when the caller says the
       cards are hidden ("covered"), the rest of the trip is one jump. A wheel, touch, pointer press or key stops it where it is;
     - three CSS states drawn by keyframes in css/style.css: mo-wait (slow load: dim), mo-leave (fade out), mo-enter (rise in,
       one after the other).
   With prefers-reduced-motion everything is instant: one jump, no classes. No storage, no network, no HTML written.
   Plain ES5, no dependencies. Every browser API is read when it is called, so the tests can stand in for the browser. */
(function () {
  'use strict';

  var LEAVE_MS = 160;      // fade-out, matches .mo-leave in css/style.css
  var ENTER_FALLBACK = 1000; // remove mo-enter even if animationend never comes
  var GAP = 16;            // landing distance under the sticky header, px
  var STAGGER_CAP = 6;     // items after the 7th rise together
  var STOP_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  var active = null;       // the glide in flight: { stop: function (result) }

  function easeInOutCubic(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function glideDuration(distance) {
    var d = Math.abs(distance);
    if (d < 2) return 0;
    return Math.min(520, Math.max(260, Math.round(180 + 0.42 * d)));
  }

  function planGlide(from, to, viewportH, covered) {
    var max = Math.round(0.8 * viewportH);
    var jumpTo = null;
    if (covered && Math.abs(from - to) > max) jumpTo = to + (from > to ? 1 : -1) * max;
    var start = jumpTo === null ? from : jumpTo;
    return { jumpTo: jumpTo, start: start, to: to, duration: glideDuration(to - start) };
  }

  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function headerBottom() {
    var h = document.querySelector('.site-header');
    if (!h) return 0;
    return Math.max(0, Math.round(h.getBoundingClientRect().bottom));
  }

  function topOf(el, gap) {
    if (gap === undefined) gap = GAP;
    var y = window.scrollY || window.pageYOffset || 0;
    return Math.max(0, Math.round(el.getBoundingClientRect().top + y - headerBottom() - gap));
  }

  function glide(to, opts) {
    var covered = !!(opts && opts.covered);
    if (active) active.stop('cancelled');
    var from = window.scrollY || window.pageYOffset || 0;
    var viewportH = window.innerHeight || 0;
    var maxY = Math.max(0, (document.documentElement.scrollHeight || 0) - viewportH);
    to = Math.max(0, Math.min(maxY, Math.round(to)));
    if (Math.abs(to - from) < 2) return Promise.resolve('none');
    if (prefersReduced()) {
      window.scrollTo(0, to);
      return Promise.resolve('instant');
    }

    var plan = planGlide(from, to, viewportH, covered);
    var root = document.documentElement;
    var settled = false;
    var resolveFn;
    var promise = new Promise(function (resolve) { resolveFn = resolve; });
    var onInput = function () { stop('cancelled'); };
    var listenOpts = { capture: true, passive: true };
    var me = { stop: stop };

    function stop(result) {
      if (settled) return;
      settled = true;
      if (active === me) active = null;
      root.classList.remove('mo-gliding');
      for (var i = 0; i < STOP_EVENTS.length; i++) window.removeEventListener(STOP_EVENTS[i], onInput, listenOpts);
      resolveFn(result);
    }

    active = me;
    root.classList.add('mo-gliding');
    for (var i = 0; i < STOP_EVENTS.length; i++) window.addEventListener(STOP_EVENTS[i], onInput, listenOpts);
    if (plan.jumpTo !== null) window.scrollTo(0, plan.jumpTo);

    var t0 = null;
    function frame(ts) {
      if (settled) return;
      if (t0 === null) t0 = ts;
      var p = plan.duration ? Math.min(1, (ts - t0) / plan.duration) : 1;
      var y = plan.start + (plan.to - plan.start) * easeInOutCubic(p);
      window.scrollTo(0, p >= 1 ? plan.to : Math.round(y));
      if (p >= 1) stop('done');
      else window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
    return promise;
  }

  function wait(box, on) {
    if (box) box.classList.toggle('mo-wait', !!on);
  }

  function leave(box) {
    if (prefersReduced()) {
      box.classList.remove('mo-wait');
      return Promise.resolve();
    }
    var first = box.firstElementChild;
    var from = first ? window.getComputedStyle(first).opacity : '1';
    box.style.setProperty('--mo-from', from || '1');
    box.classList.remove('mo-wait');
    box.classList.add('mo-leave');
    return new Promise(function (resolve) { window.setTimeout(resolve, LEAVE_MS); });
  }

  function enter(nodes, box) {
    if (box) {
      box.classList.remove('mo-leave', 'mo-wait');
      box.style.removeProperty('--mo-from');
    }
    if (prefersReduced() || !nodes) return;
    var pending = [];
    function finish(item) {
      if (item.done) return;
      item.done = true;
      item.node.classList.remove('mo-enter');
      item.node.style.removeProperty('--mo-i');
      item.node.removeEventListener('animationend', item.onEnd);
    }
    for (var i = 0; i < nodes.length; i++) {
      (function (node, index) {
        var item = { node: node, done: false, onEnd: null };
        item.onEnd = function (e) { if (e && e.animationName === 'mo-in') finish(item); };
        node.style.setProperty('--mo-i', String(Math.min(index, STAGGER_CAP)));
        node.classList.add('mo-enter');
        node.addEventListener('animationend', item.onEnd);
        pending.push(item);
      })(nodes[i], i);
    }
    window.setTimeout(function () { for (var j = 0; j < pending.length; j++) finish(pending[j]); }, ENTER_FALLBACK);
  }

  window.MBMotion = {
    LEAVE_MS: LEAVE_MS,
    GAP: GAP,
    easeInOutCubic: easeInOutCubic,
    glideDuration: glideDuration,
    planGlide: planGlide,
    prefersReduced: prefersReduced,
    headerBottom: headerBottom,
    topOf: topOf,
    glide: glide,
    wait: wait,
    leave: leave,
    enter: enter
  };
})();
