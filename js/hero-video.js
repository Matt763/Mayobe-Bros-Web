/* Home page hero video. Loaded only on the home page (config heroVideo). Plain ES5, no storage, no cookies, no third party.
   The page already shows the first frame as a picture, so this only has to start the clip as early as it safely can and keep it smooth:
   - it picks ONE size and ONE format from the network, the device and the screen, and downloads nothing else. Files are made by
     scripts/tools/make-hero-video.mjs: mayobebros-240|360|480|720|1080 .webm / .mp4 (240 is about 0.1 MB, so even a 2G line gets moving
     pictures; Save-Data gets 360 at most);
   - weak phones (2 GB of memory or 2 cores) get H.264 (every phone decodes it in hardware) and nothing above 480;
   - while it plays it watches itself: two stalls in 12 seconds, or a quarter of the frames dropped twice in a row, and it steps down to
     the next smaller file by itself; if even the smallest cannot play smoothly it stops and the picture stays (never a spinner);
   - reduced motion: nothing starts. It pauses when the hero is off screen or the tab is hidden, and the reader has a pause button (WCAG 2.2.2);
   - if the browser refuses to autoplay (for example iPhone Low Power Mode), the picture stays and one touch tries again. */
(function () {
  'use strict';
  var video = document.querySelector('video[data-hero-video]');
  if (!video) return;
  var hero = video.closest('.hero');
  var toggle = hero && hero.querySelector('[data-hero-video-toggle]');
  var base = video.getAttribute('data-hero-video');
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var nav = navigator;
  var conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
  var TIERS = [240, 360, 480, 720, 1080];
  var tier = 0, type = 'mp4';
  var started = false, userPaused = false, inView = true, played = false, gaveUp = false;
  var stalls = [], lastQ = null, bad = 0, qTimer = 0, startTimer = 0;

  if (mq && mq.matches) return;

  var apple = /iP(hone|ad|od)/.test(nav.userAgent) || /^((?!chrome|android|crios|fxios).)*safari/i.test(nav.userAgent);
  var weak = (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2);
  var webm = !!(video.canPlayType && video.canPlayType('video/webm; codecs="vp9"')) && !apple;

  // First guess: the smallest of what the screen needs, what the network allows and what the device can decode smoothly.
  function firstTier() {
    var w = hero.clientWidth || window.innerWidth, h = hero.clientHeight || window.innerHeight;
    var need = Math.max(h, w * 9 / 16) * Math.min(window.devicePixelRatio || 1, 1.5); // pixels of picture the box really shows (it is cropped to fill)
    var t = need <= 270 ? 0 : need <= 400 ? 1 : need <= 560 ? 2 : need <= 860 ? 3 : 4;
    var et = conn.effectiveType, dl = conn.downlink, rtt = conn.rtt;
    var cap = 4;
    if (et === 'slow-2g' || et === '2g' || (dl && dl < 0.8)) cap = 0;
    else if (conn.saveData || et === '3g' || (dl && dl < 2) || (rtt && rtt > 700)) cap = 1;
    else if ((dl && dl < 5) || !('downlink' in conn) || w < 768) cap = 3; // slowish, unknown (iPhone, Safari) or a phone-size box: 720 is plenty
    if (weak) cap = Math.min(cap, 2);
    return Math.min(t, cap);
  }
  // Format: WebM (VP9) is about half the size of MP4. Tiny pictures cost nothing to decode, so the two smallest sizes use it wherever it exists;
  // bigger ones use H.264 on weak devices and Apple's browsers (hardware decoding on every version).
  function pickType(t) {
    if (!webm) return 'mp4';
    if (t <= 1) return 'webm';
    return weak ? 'mp4' : 'webm';
  }

  function mark(on) { hero.classList.toggle('is-video-playing', on); }
  function setButton(paused) {
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
    toggle.setAttribute('aria-label', paused ? 'Play the background video' : 'Pause the background video');
  }
  function attempt() {
    var p;
    try { p = video.play(); } catch (err) { return; }
    if (p && p.then) {
      p.then(function () { /* 'playing' shows it */ }, function (err) {
        if (err && err.name === 'AbortError') return; // a newer load replaced it
        // not allowed to autoplay: keep the picture, try once more on the first touch or key
        var again = function () {
          document.removeEventListener('touchstart', again, true); document.removeEventListener('pointerdown', again, true); document.removeEventListener('keydown', again, true);
          if (!userPaused && !gaveUp) { try { video.play(); } catch (e2) { /* stays a picture */ } }
        };
        document.addEventListener('touchstart', again, true); document.addEventListener('pointerdown', again, true); document.addEventListener('keydown', again, true);
      });
    }
  }
  function shouldPlay() { return started && !gaveUp && !userPaused && inView && !document.hidden && !(mq && mq.matches); }
  function sync() {
    if (!started) return;
    if (shouldPlay()) { if (video.paused) attempt(); } else if (!video.paused) video.pause();
  }

  function load(i, t) {
    tier = i; type = t;
    played = false; stalls = []; lastQ = null; bad = 0;
    mark(false); // the picture shows while the new file loads
    video.setAttribute('data-hero-tier', TIERS[tier] + '.' + type); // also lets a test see which file was chosen
    video.src = base + '-' + TIERS[tier] + '.' + type;
    attempt();
    clearTimeout(startTimer);
    // a file that has not started in 10 seconds is too big for this line: go straight to the small one
    startTimer = setTimeout(function () { if (!played && video.readyState < 3) stepDown('start'); }, 10000); // (readyState 3+ = it has the data and was only not allowed to start)
  }
  function giveUp() {
    gaveUp = true; clearTimeout(startTimer); clearInterval(qTimer);
    video.pause(); video.removeAttribute('src'); try { video.load(); } catch (e) { /* nothing to load */ }
    mark(false); if (toggle) toggle.hidden = true;
  }
  // why: 'start' (never began), 'stall' (network) or 'cpu' (dropped frames)
  function stepDown(why) {
    if (gaveUp) return;
    if (tier === 0) { if (why !== 'start') giveUp(); return; }
    var next = why === 'start' ? Math.min(tier - 1, 1) : tier - 1;
    var t = pickType(next);
    if (why === 'cpu' && webm) { t = 'mp4'; webm = false; } // software decoding is the likely problem: use the hardware decoder
    load(next, t);
  }

  video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true;
  video.addEventListener('playing', function () {
    played = true; clearTimeout(startTimer);
    mark(true); if (toggle) { toggle.hidden = false; setButton(userPaused); }
  });
  video.addEventListener('waiting', function () {
    if (!played || video.seeking || userPaused) return;
    var now = Date.now();
    stalls.push(now);
    stalls = stalls.filter(function (t) { return now - t < 12000; });
    if (stalls.length >= 2) stepDown('stall');
  });
  video.addEventListener('error', function () {
    // a file that cannot be played: the other format once, then the smaller sizes, then the picture
    if (type === 'webm' && !video.getAttribute('data-fallback')) { video.setAttribute('data-fallback', '1'); webm = false; load(tier, 'mp4'); return; }
    stepDown('start');
  });

  // dropped frames: measured every 3 seconds while it plays
  qTimer = setInterval(function () {
    if (!played || video.paused || document.hidden || !video.getVideoPlaybackQuality) return;
    var q = video.getVideoPlaybackQuality();
    if (lastQ) {
      var total = q.totalVideoFrames - lastQ.total, drop = q.droppedVideoFrames - lastQ.drop;
      if (total >= 30 && drop / total > 0.25) { bad++; if (bad >= 2) { bad = 0; stepDown('cpu'); return; } } else bad = 0;
    }
    lastQ = { total: q.totalVideoFrames, drop: q.droppedVideoFrames };
  }, 3000);

  if (toggle) {
    toggle.addEventListener('click', function () {
      userPaused = !userPaused;
      setButton(userPaused);
      if (userPaused) video.pause(); else attempt();
    });
  }
  document.addEventListener('visibilitychange', sync);
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (mq.matches) { video.pause(); mark(false); if (toggle) toggle.hidden = true; } else if (!gaveUp) { if (played && toggle) toggle.hidden = false; mark(played); sync(); } });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { inView = entries[entries.length - 1].isIntersecting; sync(); }, { threshold: 0.05 }).observe(hero);
  }

  video.preload = 'auto';
  started = true;
  var first = firstTier();
  load(first, pickType(first));
})();
