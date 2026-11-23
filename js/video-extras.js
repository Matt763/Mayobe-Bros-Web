/* Extras for the site's video players (Plyr). Loaded together with Plyr, only on pages that have a video (js/site.js, loadPlyr).
   It adds, for videos of our own and for YouTube alike:
     - a Shortcuts page in the settings menu, and the keys it lists (Space, K, J, L, arrows, M, F, C, 0 to 9, < >, ? ...);
     - touch gestures on the picture: double-tap left or right to jump 10 seconds, double-tap the middle for full screen,
       swipe sideways to move through the video, press and hold to play at double speed;
   and for YouTube only:
     - a "Subtitles" button that says what it is and lists the video's subtitle languages (best effort, see captions());
     - a Quality row in the settings menu (see quality(): YouTube retired the call that set a quality for embedded players,
       so the choice is made through the size the player is laid out at, and what YouTube really plays is read back and shown).
   Nothing here is stored (no cookies, no local storage) and nothing talks to a server of ours. Every gesture has a button
   or a key that does the same, and every motion stops under "reduce motion" (css/video-extras.css). Plain ES5, like js/site.js. */
(function () {
  'use strict';

  var doc = document;
  var mqCoarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  function coarse() { return !!(mqCoarse && mqCoarse.matches); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safe(fn) { try { return fn(); } catch (err) { return undefined; } }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') + m : String(m)) + ':' + (s < 10 ? '0' : '') + s;
  }
  var ICON_CC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>';
  var ICON_FWD = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>';

  /* ------------------------------------------------------------------ the on-picture note (and what a screen reader hears) */
  function makeHud(player) {
    var root = player.elements.container;
    var hud = el('div', 'vx-hud'), txt = el('span', 'vx-hud-text');
    hud.setAttribute('aria-hidden', 'true'); hud.appendChild(txt);
    var live = el('div', 'plyr__sr-only'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    root.appendChild(hud); root.appendChild(live);
    var timer = 0, flip = false;
    return function say(text, spoken) {
      txt.textContent = text;
      hud.classList.add('is-on');
      clearTimeout(timer);
      timer = setTimeout(function () { hud.classList.remove('is-on'); }, 1100);
      flip = !flip;
      live.textContent = (spoken || text) + (flip ? ' ' : ''); // a repeated sentence is announced again
    };
  }

  /* ------------------------------------------------------------------ the settings menu: our own rows and pages next to Plyr's */
  function menuOf(player) {
    var wrap = player.elements && player.elements.settings && player.elements.settings.menu;
    var popup = wrap && wrap.querySelector('.plyr__menu__container');
    var inner = popup && popup.firstElementChild;
    var home = inner && inner.querySelector('[id$="-home"]');
    var homeList = home && home.querySelector('[role="menu"]');
    if (!popup || !inner || !home || !homeList) return null;
    var prefix = home.id.replace(/-home$/, '');
    var root = player.elements.container;
    var api = { popup: popup, home: home };

    function show(panel, focusIn) {
      Array.prototype.forEach.call(inner.children, function (p) { p.hidden = p !== panel; });
      popup.style.setProperty('--vx-room', Math.max(140, root.clientHeight - 84) + 'px');
      if (focusIn) {
        var f = panel.querySelector('[aria-checked="true"]') || panel.querySelector('.vx-page-body button, [role="menu"] button, a[href]');
        if (f) f.focus({ preventScroll: true });
      }
    }
    api.show = show;
    api.showHome = function () { show(home, false); };
    // like Plyr's own panels, a closed menu opens at its first page again
    if (window.MutationObserver) new MutationObserver(function () { if (popup.hidden) api.showHome(); }).observe(popup, { attributes: true, attributeFilter: ['hidden'] });

    // a row on the first page; it opens the page that addPage() connects to it
    api.addRow = function (key, label, first) {
      var b = el('button', 'plyr__control plyr__control--forward');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.setAttribute('aria-haspopup', 'true'); b.setAttribute('data-vx', key);
      var span = el('span', '', label), value = el('span', 'plyr__menu__value');
      span.appendChild(value); b.appendChild(span);
      if (first && homeList.firstChild) homeList.insertBefore(b, homeList.firstChild); else homeList.appendChild(b);
      var r = { button: b, page: null, setValue: function (t) { value.textContent = t; }, hide: function (on) { b.hidden = !!on; } };
      b.addEventListener('click', function () { if (r.page) show(r.page, true); });
      b.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' && r.page) { e.preventDefault(); e.stopPropagation(); show(r.page, true); } });
      return r;
    };
    // a page: a back button and a body; `body` is a node
    api.addPage = function (key, title, body, row) {
      var page = el('div', 'vx-page'); page.id = prefix + '-vx-' + key; page.hidden = true;
      var back = el('button', 'plyr__control plyr__control--back');
      back.type = 'button';
      var t = el('span', '', title); t.setAttribute('aria-hidden', 'true');
      var sr = el('span', 'plyr__sr-only', 'Go back to previous menu');
      back.appendChild(t); back.appendChild(sr);
      var main = el('div', 'vx-page-body'); main.appendChild(body);
      page.appendChild(back); page.appendChild(main);
      inner.appendChild(page);
      if (row) row.page = page;
      function out() { show(home, false); if (row) row.button.focus({ preventScroll: true }); }
      back.addEventListener('click', out);
      page.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); out(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          var items = Array.prototype.slice.call(page.querySelectorAll('button:not([hidden])')), i = items.indexOf(doc.activeElement);
          if (items.length) { e.preventDefault(); e.stopPropagation(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus({ preventScroll: true }); }
        }
      });
      return page;
    };
    return api;
  }

  /* ------------------------------------------------------------------ keys */
  var KEYS = [
    ['Play or pause', ['Space', 'K']],
    ['Back or forward 5 seconds', ['←', '→']],
    ['Back or forward 10 seconds', ['J', 'L']],
    ['Volume up or down', ['↑', '↓']],
    ['Mute or unmute', ['M']],
    ['Full screen', ['F']],
    ['Subtitles on or off', ['C']],
    ['Jump to 0% to 90% of the video', ['0', '–', '9']],
    ['Start or end of the video', ['Home', 'End']],
    ['Slower or faster', ['<', '>']],
    ['One frame back or forward, while paused', [',', '.']],
    ['Show this list', ['?']]
  ];
  var TOUCH = [
    ['Tap', 'Play or pause'],
    ['Double-tap the left or right side', 'Back or forward 10 seconds. Tap again to keep going.'],
    ['Double-tap the middle', 'Full screen'],
    ['Swipe left or right', 'Move through the video'],
    ['Press and hold', 'Play at double speed while you hold'],
    ['In the small window', 'Drag it, pinch to change its size, double-tap to switch between small and large']
  ];

  function helpBody() {
    var body = el('div', 'vx-help');
    function keyboard() {
      var s = el('section', 'vx-help-group');
      s.appendChild(el('h4', '', 'Keyboard'));
      s.appendChild(el('p', 'vx-help-note', 'Click the video first, or tab to it.'));
      var dl = el('dl');
      KEYS.forEach(function (k) {
        dl.appendChild(el('dt', '', k[0]));
        var dd = el('dd');
        k[1].forEach(function (key) { dd.appendChild(key === '–' ? doc.createTextNode(' to ') : el('kbd', '', key)); });
        dl.appendChild(dd);
      });
      s.appendChild(dl);
      return s;
    }
    function touch() {
      var s = el('section', 'vx-help-group vx-help-touch');
      s.appendChild(el('h4', '', 'Touch'));
      var dl = el('dl');
      TOUCH.forEach(function (t) { dl.appendChild(el('dt', '', t[0])); dl.appendChild(el('dd', '', t[1])); });
      s.appendChild(dl);
      s.appendChild(el('p', 'vx-help-note', 'The buttons and the progress bar do the same, so a gesture is never the only way.'));
      return s;
    }
    if (coarse()) { body.appendChild(touch()); body.appendChild(keyboard()); } else { body.appendChild(keyboard()); body.appendChild(touch()); }
    return body;
  }

  /* ------------------------------------------------------------------ one place for what the keys and gestures do */
  function actions(player, say) {
    var a = {};
    a.toggle = function () { player.togglePlay(); };
    a.seekBy = function (sec, quiet) {
      var d = player.duration, t = player.currentTime || 0;
      if (!isFinite(t)) return;
      var n = clamp(t + sec, 0, isFinite(d) && d > 0 ? d : Infinity);
      player.currentTime = n;
      if (!quiet) say((sec < 0 ? '−' : '+') + Math.abs(sec) + ' s', (sec < 0 ? 'Back ' : 'Forward ') + Math.abs(sec) + ' seconds, at ' + fmt(n));
    };
    a.seekTo = function (sec) { var d = player.duration; if (!isFinite(d) || !d) return; player.currentTime = clamp(sec, 0, d); };
    a.volumeBy = function (dv) {
      if (dv > 0 && player.muted) player.muted = false;
      var v = clamp(Math.round(((player.muted ? 0 : player.volume) + dv) * 20) / 20, 0, 1);
      player.volume = v;
      say('Volume ' + Math.round(v * 100) + '%');
    };
    a.mute = function () { player.muted = !player.muted; say(player.muted ? 'Muted' : 'Sound on'); };
    a.fullscreen = function () { if (player.fullscreen && player.fullscreen.enabled) player.fullscreen.toggle(); };
    a.speedBy = function (dir) {
      var opts = (player.options && player.options.speed && player.options.speed.length ? player.options.speed : (player.config && player.config.speed && player.config.speed.options)) || [0.5, 1, 1.5, 2];
      var cur = player.speed || 1, i = 0, best = Infinity;
      opts.forEach(function (v, k) { var d = Math.abs(v - cur); if (d < best) { best = d; i = k; } });
      var n = opts[clamp(i + dir, 0, opts.length - 1)];
      if (n === cur) { say(n + '× speed'); return; }
      player.speed = n;
      say(n === 1 ? 'Normal speed' : n + '× speed');
    };
    a.frame = function (dir) { if (!player.paused) return; var t = player.currentTime || 0; player.currentTime = Math.max(0, t + dir / 30); };
    return a;
  }

  function bindKeys(player, act, say, extra) {
    var root = player.elements.container;
    root.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable) || (tag === 'INPUT' && t.type !== 'range')) return;
      var onRange = tag === 'INPUT', onButton = tag === 'BUTTON';
      var inMenu = !!(t && t.closest && t.closest('.plyr__menu__container, .video-cc-menu'));
      var k = e.key;
      function done() { e.preventDefault(); e.stopImmediatePropagation(); }
      if (k === '?' || ((k === 'h' || k === 'H') && !inMenu)) { done(); extra.help(); return; }
      if (inMenu) return; // the menus have their own keys (arrows, Enter, Escape)
      switch (k) {
        case ' ': if (onButton) return; done(); act.toggle(); break;
        case 'k': case 'K': done(); act.toggle(); break;
        case 'ArrowLeft': if (onRange) return; done(); act.seekBy(-5); break;
        case 'ArrowRight': if (onRange) return; done(); act.seekBy(5); break;
        case 'j': case 'J': done(); act.seekBy(-10); break;
        case 'l': case 'L': done(); act.seekBy(10); break;
        case 'ArrowUp': if (onRange) return; done(); act.volumeBy(0.1); break;
        case 'ArrowDown': if (onRange) return; done(); act.volumeBy(-0.1); break;
        case 'm': case 'M': done(); act.mute(); break;
        case 'f': case 'F': done(); act.fullscreen(); break;
        case 'c': case 'C': done(); extra.captions(); break;
        case 'Home': if (onRange) return; done(); act.seekTo(0); say('Start of the video'); break;
        case 'End': if (onRange) return; done(); act.seekTo((player.duration || 0) - 0.3); break;
        case '<': done(); act.speedBy(-1); break;
        case '>': done(); act.speedBy(1); break;
        case ',': done(); act.frame(-1); break;
        case '.': done(); act.frame(1); break;
        default:
          if (/^[0-9]$/.test(k) && !onRange) { done(); act.seekTo((player.duration || 0) * (+k) / 10); say(k === '0' ? 'Start of the video' : (+k * 10) + '% of the video'); }
      }
    }, true);
    // tell assistive technology which keys the buttons answer to
    [['[data-plyr="play"]', 'K Space'], ['[data-plyr="mute"]', 'M'], ['[data-plyr="fullscreen"]', 'F'], ['[data-plyr="captions"]', 'C'], ['.video-cc', 'C']].forEach(function (p) {
      Array.prototype.forEach.call(root.querySelectorAll(p[0]), function (b) { b.setAttribute('aria-keyshortcuts', p[1]); });
    });
  }

  /* ------------------------------------------------------------------ touch */
  var SIDE = 0.35; // the left and the right third of the picture
  function bindTouch(player, box, act, say) {
    var root = player.elements.container, wrap = player.elements.wrapper;
    if (!wrap || !window.PointerEvent) return;
    var seekL = seekBadge('l'), seekR = seekBadge('r'), scrubBox = el('div', 'vx-scrub'), scrubText = el('span', 'vx-scrub-text');
    scrubBox.setAttribute('aria-hidden', 'true'); scrubBox.appendChild(scrubText);
    root.appendChild(seekL.node); root.appendChild(seekR.node); root.appendChild(scrubBox);
    function seekBadge(side) {
      var node = el('div', 'vx-seek vx-seek--' + side), ico = el('span', 'vx-seek-ico'), text = el('span', 'vx-seek-text');
      node.setAttribute('aria-hidden', 'true'); ico.innerHTML = side === 'l' ? ICON_BACK : ICON_FWD;
      node.appendChild(ico); node.appendChild(text);
      var timer = 0;
      return { node: node, show: function (sec) { text.textContent = sec + ' seconds'; node.classList.add('is-on'); clearTimeout(timer); timer = setTimeout(function () { node.classList.remove('is-on'); }, 650); } };
    }
    function mini() { return box.classList.contains('is-mini'); }
    var st = null, lastTap = null, singleTimer = 0, chain = { side: '', until: 0, total: 0 }, lastTouchEnd = 0;
    var HOLD_MS = 480;

    function sideOf(x) { var r = wrap.getBoundingClientRect(), f = (x - r.left) / Math.max(1, r.width); return f < SIDE ? 'l' : f > 1 - SIDE ? 'r' : 'c'; }
    function seekTap(side) {
      var now = Date.now();
      if (chain.side !== side || now > chain.until) chain.total = 0;
      chain.side = side; chain.until = now + 700; chain.total += 10;
      act.seekBy(side === 'l' ? -10 : 10, true);
      (side === 'l' ? seekL : seekR).show(chain.total);
    }
    function clearHold() { if (st) { clearTimeout(st.holdTimer); } }
    function endHold() { if (st && st.mode === 'hold') { st.mode = 'done'; try { player.speed = st.prevSpeed || 1; } catch (err) { /* the speed stays */ } root.classList.remove('vx-holding'); } }
    function stop() { clearHold(); endHold(); scrubBox.classList.remove('is-on'); st = null; }

    wrap.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || mini()) return;
      if (st) { stop(); return; } // a second finger: leave it to the browser (page pinch zoom)
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, mode: 'pending', start: player.currentTime || 0, prevSpeed: 1, dt: 0, holdTimer: 0 };
      st.holdTimer = setTimeout(function () {
        if (!st || st.mode !== 'pending' || !player.playing) return;
        st.mode = 'hold'; st.prevSpeed = player.speed || 1;
        try { player.speed = 2; } catch (err) { /* this video cannot go faster */ }
        root.classList.add('vx-holding'); say('2× speed');
        if (navigator.vibrate) safe(function () { navigator.vibrate(8); });
      }, HOLD_MS);
    }, { passive: true });

    wrap.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (st.mode === 'pending') {
        if (Math.hypot(dx, dy) < 10) return;
        clearHold();
        var d = player.duration;
        if (Math.abs(dx) > Math.abs(dy) * 1.7 && isFinite(d) && d > 0) {
          st.mode = 'scrub'; st.width = Math.max(120, wrap.getBoundingClientRect().width);
          safe(function () { wrap.setPointerCapture(e.pointerId); });
          clearTimeout(singleTimer); lastTap = null;
        } else { st.mode = 'scroll'; return; } // vertical: the page scrolls
      }
      if (st.mode !== 'scrub') return;
      var dur = player.duration, span = clamp(dur, 30, 240); // across the whole picture: the whole video, or four minutes of a long one
      st.target = clamp(st.start + dx * (span / st.width), 0, dur);
      st.dt = st.target - st.start;
      scrubText.textContent = fmt(st.target) + '  (' + (st.dt < 0 ? '−' : '+') + fmt(Math.abs(st.dt)) + ')';
      scrubBox.classList.add('is-on');
    }, { passive: true });

    function release(e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st, cancelled = e.type === 'pointercancel';
      lastTouchEnd = Date.now();
      clearHold();
      if (s.mode === 'hold') { endHold(); st = null; return; }
      if (s.mode === 'scrub') {
        scrubBox.classList.remove('is-on'); st = null;
        if (!cancelled && s.target != null) { player.currentTime = s.target; say(fmt(s.target), 'At ' + fmt(s.target)); }
        return;
      }
      st = null;
      if (cancelled || s.mode !== 'pending') return;
      // a tap
      var side = sideOf(e.clientX), now = Date.now();
      if (side !== 'c' && now < chain.until && side === chain.side) { clearTimeout(singleTimer); lastTap = null; seekTap(side); return; } // keep jumping
      if (lastTap && now - lastTap.t < 290 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 44) {
        clearTimeout(singleTimer); lastTap = null;
        if (side === 'c') act.fullscreen(); else seekTap(side);
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      clearTimeout(singleTimer);
      singleTimer = setTimeout(function () { lastTap = null; act.toggle(); }, 270); // after the double-tap window, so a double-tap never blinks the video
    }
    wrap.addEventListener('pointerup', release, { passive: true });
    wrap.addEventListener('pointercancel', release, { passive: true });
    // the click that follows a touch is ours already: Plyr must not play or pause a second time
    wrap.addEventListener('click', function (e) {
      if (mini()) return;
      var touchClick = e.pointerType === 'touch' || e.pointerType === 'pen' || (!e.pointerType && Date.now() - lastTouchEnd < 700);
      if (touchClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    wrap.addEventListener('contextmenu', function (e) { if (st || Date.now() - lastTouchEnd < 700) e.preventDefault(); }); // the long press of a phone
    player.on('enterfullscreen', stop); player.on('exitfullscreen', stop);
  }

  /* ------------------------------------------------------------------ YouTube subtitles (the "Subtitles" button)
     YouTube's documented player API has no caption controls; its player does have a "captions" module whose track list can be read and
     switched with getOption / setOption (what its own menu uses). That part is not documented, so it is best effort: nothing is requested
     until the reader presses the button, a video with no tracks says so, and after a choice the player is asked what it is showing: if it did
     not take the language the menu says so instead of pretending. */
  function captions(player, yt, say) {
    var shell = player.elements.container, bar = shell.querySelector('.plyr__controls');
    if (typeof yt.loadModule !== 'function' || !bar || bar.querySelector('.video-cc')) return null;
    var tracks = null, chosen = '', last = '', loading = false, failed = false, verify = 0;
    var btn = el('button', 'plyr__controls__item plyr__control video-cc'), menu = el('div', 'video-cc-menu');
    btn.type = 'button'; btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'Subtitles and language'); btn.setAttribute('aria-keyshortcuts', 'C');
    btn.innerHTML = ICON_CC + '<span class="vx-label" aria-hidden="true">Subtitles</span><span class="vx-lang" aria-hidden="true"></span>';
    var tip = el('span', 'plyr__tooltip', 'Subtitles and language'); btn.appendChild(tip);
    var lang = btn.querySelector('.vx-lang');
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Subtitle language'); menu.hidden = true;
    var anchor = bar.querySelector('.plyr__menu');
    bar.insertBefore(btn, anchor || null);
    shell.appendChild(menu);

    function nameOf(code) {
      var found = (tracks || []).filter(function (t) { return t.languageCode === code; })[0];
      return found ? (found.displayName || found.languageName || code) : code;
    }
    function shortOf(code) { return String(code || '').split(/[-_]/)[0].toUpperCase().slice(0, 3); }
    function paint() {
      btn.classList.toggle('is-on', !!chosen);
      btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      lang.textContent = chosen ? shortOf(chosen) : '';
      tip.textContent = chosen ? 'Subtitles: ' + nameOf(chosen) : 'Subtitles and language';
    }
    function open(on) {
      if (on && !menu.hidden) return;
      menu.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) {
        draw();
        if (tracks === null && !loading) fetchTracks();
        var f = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
        if (f) f.focus({ preventScroll: true });
      }
    }
    function item(label, code, checked) {
      var b = el('button', 'video-cc-item', label);
      b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', checked ? 'true' : 'false');
      b.addEventListener('click', function () { choose(code); });
      return b;
    }
    function draw() {
      menu.textContent = '';
      menu.appendChild(el('p', 'video-cc-title', 'Subtitle language'));
      var list = el('div', 'video-cc-list');
      if (loading || tracks === null) list.appendChild(el('p', 'video-cc-note', 'Loading the languages...'));
      else if (!tracks.length) list.appendChild(el('p', 'video-cc-note', 'This video has no subtitles.'));
      else {
        list.appendChild(item('Off', '', chosen === ''));
        tracks.forEach(function (t) { list.appendChild(item(t.displayName || t.languageName || t.languageCode, t.languageCode, chosen === t.languageCode)); });
      }
      menu.appendChild(list);
      var foot = el('p', 'video-cc-help');
      foot.setAttribute('role', 'status');
      foot.textContent = failed ? 'Subtitles did not start. Try another language.' : (tracks && tracks.length ? 'Pick a language to show subtitles on the video.' : '');
      if (foot.textContent) menu.appendChild(foot);
    }
    function fetchTracks() {
      loading = true; draw();
      safe(function () { yt.loadModule('captions'); });
      var n = 0;
      (function poll() {
        var list = safe(function () { return yt.getOption('captions', 'tracklist'); });
        if (list && list.length) {
          tracks = list.filter(function (t) { return t && t.languageCode; });
          safe(function () { yt.unloadModule('captions'); }); chosen = ''; // loading the module turns subtitles on: they stay off until the reader chooses
          loading = false; paint(); if (!menu.hidden) draw(); return;
        }
        if (++n < 12) { setTimeout(poll, 400); return; }
        tracks = []; loading = false; safe(function () { yt.unloadModule('captions'); }); if (!menu.hidden) draw();
      })();
    }
    // after a choice, ask the player what it shows; a language it did not take is reported
    function check(code, tries) {
      clearTimeout(verify);
      verify = setTimeout(function () {
        if (chosen !== code) return;
        var cur = safe(function () { return yt.getOption('captions', 'track'); });
        if (cur && cur.languageCode === code) { failed = false; say('Subtitles: ' + nameOf(code)); if (!menu.hidden) draw(); return; }
        if (tries > 0) { if (tries === 6) safe(function () { yt.setOption('captions', 'track', { languageCode: code }); }); check(code, tries - 1); return; }
        failed = true; chosen = ''; safe(function () { yt.unloadModule('captions'); }); paint(); if (!menu.hidden) draw(); say('Subtitles did not start');
      }, 700);
    }
    function choose(code) {
      failed = false;
      chosen = code;
      if (!code) { safe(function () { yt.unloadModule('captions'); }); clearTimeout(verify); say('Subtitles off'); }
      else {
        last = code;
        safe(function () { yt.loadModule('captions'); });
        setTimeout(function () { safe(function () { yt.setOption('captions', 'track', { languageCode: code }); }); }, 350);
        check(code, 10);
      }
      paint(); draw(); open(false); btn.focus({ preventScroll: true });
    }
    function toggle() { // the C key
      if (chosen) { choose(''); return; }
      function go() {
        if (!tracks || !tracks.length) { say('No subtitles for this video'); return; }
        var want = last || String(doc.documentElement.lang || 'en').split('-')[0];
        var pick = tracks.filter(function (t) { return t.languageCode === want; })[0] || tracks.filter(function (t) { return /^en/.test(t.languageCode); })[0] || tracks[0];
        choose(pick.languageCode);
      }
      if (tracks !== null) { go(); return; }
      var wait = setInterval(function () { if (tracks !== null) { clearInterval(wait); go(); } }, 200);
      setTimeout(function () { clearInterval(wait); }, 6000);
      fetchTracks();
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(menu.hidden); });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); open(false); btn.focus({ preventScroll: true }); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var items = Array.prototype.slice.call(menu.querySelectorAll('button')), i = items.indexOf(doc.activeElement);
        if (items.length) { items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus({ preventScroll: true }); e.preventDefault(); }
      }
    });
    doc.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) open(false); });
    player.on('controlshidden', function () { if (!menu.hidden) open(false); });
    paint();
    return { toggle: toggle, open: open, isOn: function () { return !!chosen; }, state: function () { return { chosen: chosen, failed: failed, tracks: tracks }; } };
  }

  /* ------------------------------------------------------------------ YouTube quality
     YouTube retired setPlaybackQuality for embedded players (a no-op: checked 2026-11-22, asking for 144p, 720p, 1080p and "auto" all left the
     player where it was, also through the postMessage command and through loadVideoById's suggestedQuality). What still works is the one thing
     YouTube documents: the player picks a quality that fits the size it is shown at. So the iframe is laid out at the size of the level asked for
     (1920x1080 CSS pixels for 1080p, 1280x720 for 720p, 640x360 for 480p) and scaled back into the same box with a transform: the picture the
     reader sees keeps its size, and the player believes it is that big. Measured with a real embed at pixel ratios 1, 2 and 3: the three sizes gave
     hd1080, hd720 and large. YouTube does not go below 480p on a good connection and stops at 1080p in an embed, so those are the only levels
     offered, and only those the video has (getAvailableQualityLevels). A bigger layout takes effect at once; a smaller one needs the video to be
     loaded again at the same second (a short pause), as YouTube's own player keeps a high quality while it can. Whatever is asked, what the
     player really plays is read back (getPlaybackQuality) and shown, and a difference is said in plain words. Nothing is stored. */
  var LEVEL_H = { hd1080: 1080, hd720: 720, large: 480 }; // what each offered level is called
  var LEVEL_SIZE = { hd1080: 1080, hd720: 720, large: 360 }; // the layout height that makes the player pick it
  var LEVEL_RANK = { tiny: 1, small: 2, medium: 3, large: 4, hd720: 5, hd1080: 6, hd1440: 7, hd2160: 8, highres: 9 };
  var LEVEL_NAME = { tiny: '144p', small: '240p', medium: '360p', large: '480p', hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '2160p', highres: '4320p' };
  function quality(player, yt, menu, say) {
    if (!menu || typeof yt.getAvailableQualityLevels !== 'function' || typeof yt.loadVideoById !== 'function') return null;
    var root = player.elements.container, iframe = safe(function () { return yt.getIframe(); }) || root.querySelector('iframe');
    var wrapEl = iframe && iframe.parentNode;
    if (!iframe || !wrapEl) return null;
    var chosen = 'auto', now = '', offered = null, working = 0, verify = 0, note = null, ro = null;

    var body = el('div', 'vx-q'), list = el('div', 'vx-q-list');
    list.setAttribute('role', 'menu'); list.setAttribute('aria-label', 'Quality');
    note = el('p', 'vx-q-note'); note.setAttribute('role', 'status');
    body.appendChild(list); body.appendChild(note);
    var row = menu.addRow('quality', 'Quality', true);
    menu.addPage('quality', 'Quality', body, row);
    row.hide(true); // until the video has started and its levels are known

    function label(code) { return LEVEL_NAME[code] || ''; }
    function paintRow() { row.setValue(chosen === 'auto' ? 'Auto' + (now ? ' (' + label(now) + ')' : '') : label(chosen)); }
    function item(text, code, badge) {
      var b = el('button', 'plyr__control');
      b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', chosen === code ? 'true' : 'false'); b.value = code;
      var s = el('span', '', text);
      if (badge) { var v = el('span', 'plyr__menu__value'), g = el('span', 'plyr__badge', 'HD'); v.appendChild(g); s.appendChild(v); }
      b.appendChild(s);
      b.addEventListener('click', function () { pick(code); });
      return b;
    }
    function draw() {
      list.textContent = '';
      list.appendChild(item('Auto', 'auto', false));
      (offered || []).forEach(function (c) { list.appendChild(item(label(c), c, LEVEL_RANK[c] >= LEVEL_RANK.hd720)); });
      paintRow();
    }
    function setNote(text) { note.textContent = text; }

    // lay the player out at the size of a level, or back to normal, and keep it filling the picture whatever the size of the box
    function layout(code) {
      var h = code && LEVEL_SIZE[code];
      if (ro) { ro.disconnect(); ro = null; }
      if (!h) { iframe.classList.remove('vx-forced'); ['--vx-w', '--vx-h', '--vx-sx', '--vx-sy'].forEach(function (k) { iframe.style.removeProperty(k); }); return; }
      var w = Math.round(h * 16 / 9);
      function fit() {
        var r = wrapEl.getBoundingClientRect();
        iframe.style.setProperty('--vx-w', w + 'px'); iframe.style.setProperty('--vx-h', h + 'px');
        iframe.style.setProperty('--vx-sx', String(r.width / w)); iframe.style.setProperty('--vx-sy', String(r.height / h));
      }
      iframe.classList.add('vx-forced'); fit();
      if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe(wrapEl); }
    }
    function reload() { // the same video, the same second, the same state
      var id = safe(function () { return yt.getVideoData().video_id; }), t = safe(function () { return yt.getCurrentTime(); }) || 0;
      var wasPaused = player.paused;
      if (!id) return false;
      yt.loadVideoById({ videoId: id, startSeconds: t });
      if (wasPaused) {
        var n = 0;
        var wait = setInterval(function () { if (++n > 40) { clearInterval(wait); return; } if (safe(function () { return yt.getPlayerState(); }) === 1) { clearInterval(wait); safe(function () { yt.pauseVideo(); }); } }, 200);
      }
      return true;
    }
    function readNow() { var q = safe(function () { return yt.getPlaybackQuality(); }); if (q && q !== 'unknown' && q !== 'auto') now = q; paintRow(); return now; }
    function pick(code) {
      var token = ++working;
      var before = LEVEL_RANK[readNow()] || 0, target = LEVEL_RANK[code] || 0;
      chosen = code; draw();
      layout(code === 'auto' ? null : code);
      setNote('Changing the quality. The picture may pause for a moment.');
      var higher = code !== 'auto' && target > before;
      if (!higher) reload(); // a smaller size is only taken up when the video is loaded again
      clearTimeout(verify);
      var tries = 0;
      (function look() {
        verify = setTimeout(function () {
          if (token !== working) return;
          var cur = readNow(), rank = LEVEL_RANK[cur] || 0;
          if (code === 'auto') { setNote(cur ? 'Auto: playing at ' + label(cur) + ' now.' : 'Auto: YouTube picks the quality for your connection.'); return; }
          if (rank === target) { setNote('Playing at ' + label(cur) + ' now.'); say('Quality: ' + label(cur)); return; }
          if (++tries === 3 && higher) { reload(); } // a bigger size did not take: load the video again
          if (tries < 7) { look(); return; }
          setNote('You chose ' + label(code) + ', but YouTube is playing ' + (cur ? label(cur) : 'another quality') + '. It depends on the video and your connection.');
        }, tries ? 1400 : 1800);
      })();
    }
    // the list is known once the video has started
    function discover() {
      var n = 0;
      (function poll() {
        var all = safe(function () { return yt.getAvailableQualityLevels(); });
        if (all && all.length) {
          offered = ['hd1080', 'hd720', 'large'].filter(function (c) { return all.indexOf(c) !== -1; });
          if (offered.length > 1 || (offered.length === 1 && all.length > 2)) { draw(); row.hide(false); setNote('YouTube may play a lower quality when the connection is slow.'); readNow(); return; }
          return;
        }
        if (++n < 40) setTimeout(poll, 750);
      })();
    }
    safe(function () { yt.addEventListener('onPlaybackQualityChange', function () { readNow(); }); });
    player.once('playing', discover);
    if (player.playing) discover();
    return { pick: pick, state: function () { return { chosen: chosen, now: now, offered: offered }; } };
  }

  /* ------------------------------------------------------------------ put it together */
  function enhance(player, box, kind) {
    if (!player || !player.elements || !player.elements.container || player.__vx) return null;
    player.__vx = true;
    var root = player.elements.container;
    // the player takes the keys once it has the focus: a click on the picture or a Tab puts it there
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
    if (player.elements.wrapper) player.elements.wrapper.addEventListener('pointerdown', function () { root.focus({ preventScroll: true }); });
    var say = makeHud(player), act = actions(player, say);
    var menu = menuOf(player);
    var cc = null, row = null, helpPage = null;
    var extra = {
      help: function () {
        if (!menu || !helpPage) return;
        player.toggleControls(true);
        if (menu.popup.hidden && player.elements.buttons && player.elements.buttons.settings) player.elements.buttons.settings.click();
        menu.show(helpPage, true);
      },
      captions: function () {
        if (cc) { cc.toggle(); return; }
        var b = root.querySelector('[data-plyr="captions"]');
        if (b && !b.hidden && typeof player.toggleCaptions === 'function') { player.toggleCaptions(); say(player.captions && player.captions.active ? 'Subtitles on' : 'Subtitles off'); return; }
        say('No subtitles for this video');
      }
    };
    if (menu) {
      var holder = el('div');
      holder.appendChild(helpBody());
      row = menu.addRow('shortcuts', coarse() ? 'Gestures' : 'Shortcuts', false);
      row.setValue(coarse() ? '' : '?');
      helpPage = menu.addPage('shortcuts', coarse() ? 'Gestures and shortcuts' : 'Shortcuts and gestures', holder, row);
    }
    bindTouch(player, box, act, say);
    if (kind === 'file') {
      // the captions button of a file of our own gets the same words as the YouTube one
      var cb = root.querySelector('[data-plyr="captions"]');
      if (cb && !cb.querySelector('.vx-label')) { var lab = el('span', 'vx-label', 'Subtitles'); lab.setAttribute('aria-hidden', 'true'); cb.appendChild(lab); cb.classList.add('vx-hastext'); }
    }
    if (kind === 'youtube') {
      var yt = player.embed;
      if (yt) { cc = captions(player, yt, say); quality(player, yt, menu, say); }
    }
    bindKeys(player, act, say, extra);
    return { say: say, captions: cc };
  }

  window.MBVideo = { enhance: enhance };
})();
