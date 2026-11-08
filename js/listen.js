/* Mayobe Bros: "Listen to this article".
   Reads the article aloud with the voices already on the reader's device (no audio files, nothing is sent to us).
   It starts with the title, then reads every paragraph, heading and list item to the end of the article.

   Built to stay smooth on weak phones:
   - speech is cut into short sentences and queued a few ahead, so the voice never has a gap or cuts off
     (long texts make some browser voices stop after about 15 seconds);
   - the spoken sentence is shown with the CSS Custom Highlight API, which paints without touching the page's HTML;
   - the progress bar moves with one CSS transform transition per sentence (no JavaScript on every frame);
   - auto-scroll is one lightweight animation frame loop that glides toward the spoken sentence, and it
     steps aside the moment the reader scrolls on their own.
   Plain ES2015, no dependencies. If the browser has no speech support the Listen button simply stays hidden. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var btn = doc.querySelector('[data-listen]');
  var player = doc.querySelector('[data-listen-player]');
  var article = doc.getElementById('article');
  var titleEl = doc.querySelector('.hero-post .hero-title') || doc.querySelector('h1');
  if (!btn || !player || !article || !titleEl) return;
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;

  var synth = window.speechSynthesis;
  var q = function (sel, ctx) { return (ctx || player).querySelector(sel); };
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduceMotion = function () { return !!(mqReduce && mqReduce.matches); };

  var els = {
    fill: q('[data-lp-fill]'), track: q('[data-lp-track]'), label: q('[data-lp-label]'), sub: q('[data-lp-sub]'),
    speed: q('[data-lp-speed]'), follow: q('[data-lp="follow"]'), settings: q('[data-lp="settings"]'),
    panel: q('[data-lp-settings]'), voice: q('[data-lp-voice]'), status: q('[data-lp-status]'),
    btnLabel: q('[data-listen-label]', btn), btnTime: q('[data-listen-time]', btn),
    header: doc.querySelector('.site-header'),
  };

  /* ------------------------------------------------------------ settings */
  var RATES = [0.8, 1, 1.25, 1.5, 1.75];
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } }
  var rate = parseFloat(load('mayobebros-listen-rate')) || 1;
  if (RATES.indexOf(rate) < 0) rate = 1;
  var voice = null;
  var follow = true;

  /* ------------------------------------------------------- voice choice */
  function score(v) {
    var n = v.name || '', s = 0;
    if (/natural|neural/i.test(n)) s += 60;
    if (/online/i.test(n)) s += 15;
    if (/premium|enhanced|siri/i.test(n)) s += 45;
    if (/google/i.test(n)) s += 30;
    if (/espeak|festival|mbrola|flite/i.test(n)) s -= 60;
    if (v.localService) s += 6;
    if (v['default']) s += 3;
    var l = (v.lang || '').replace('_', '-');
    if (/^en-GB/i.test(l)) s += 12; else if (/^en-US/i.test(l)) s += 10; else if (/^en-ZA/i.test(l)) s += 8; else if (/^en-AU/i.test(l)) s += 6; else if (/^en/i.test(l)) s += 4;
    return s;
  }
  function englishVoices() {
    var all = synth.getVoices() || [];
    var en = all.filter(function (v) { return /^en([-_]|$)/i.test(v.lang || ''); });
    return (en.length ? en : all).slice().sort(function (a, b) { return score(b) - score(a); });
  }
  function fillVoices() {
    var list = englishVoices();
    els.voice.textContent = '';
    list.forEach(function (v, i) {
      var o = doc.createElement('option');
      o.value = v.voiceURI || v.name;
      o.textContent = v.name + ' (' + v.lang + ')' + (i === 0 ? ' · recommended' : '');
      els.voice.appendChild(o);
    });
    var saved = load('mayobebros-listen-voice');
    var chosen = null;
    list.forEach(function (v) { if (saved && (v.voiceURI === saved || v.name === saved)) chosen = v; });
    voice = chosen || list[0] || null;
    if (voice) els.voice.value = voice.voiceURI || voice.name;
  }
  fillVoices();
  if (synth.addEventListener) synth.addEventListener('voiceschanged', fillVoices);
  else synth.onvoiceschanged = fillVoices;

  /* ------------------------------------------------- text to be spoken */
  // Things that should not be read: pictures, tables, code, videos, footnote numbers.
  var NOT_READ = 'p,ul,ol,li,blockquote,h2,h3,h4,h5,h6,figure,table,pre,sup,script,style,iframe,video,button,select,.sr-only,[data-no-listen],.video-figure,.video-embed';
  var STOP_AT = /^(sources|further reading|references)\b/i;

  function speakable(t) {
    t = t.replace(/[\u00a0\u200b\u00ad]/g, ' ').replace(/\s+/g, ' ').trim();
    var money = '([\\d][\\d,]*(?:\\.\\d+)?)(\\s(?:million|billion|trillion|thousand))?';
    t = t.replace(new RegExp('\\b(?:TSh|TZS|Tsh)\\.?\\s?' + money + '\\s*(to|and|-|\u2013)\\s*(?:(?:TSh|TZS|Tsh)\\.?\\s?)?' + money, 'g'),
      function (m, a, am, w, b, bm) { return a + (am || '') + ' ' + (/[-\u2013]/.test(w) ? 'to' : w) + ' ' + b + (bm || '') + ' Tanzanian shillings'; });
    t = t.replace(new RegExp('\\b(?:TSh|TZS|Tsh)\\.?\\s?' + money, 'g'), function (m, a, am) { return a + (am || '') + ' Tanzanian shillings'; });
    t = t.replace(new RegExp('\\$\\s?' + money, 'g'), function (m, a, am) { return a + (am || '') + ' dollars'; });
    t = t.replace(/(\d)\s?%/g, '$1 percent')
      .replace(/\b(\d+(?:\.\d+)?)\s?km\/h\b/gi, '$1 kilometres per hour')
      .replace(/\b(\d+(?:\.\d+)?)\s?km\b/gi, '$1 kilometres')
      .replace(/\b(\d+(?:\.\d+)?)\s?kg\b/gi, '$1 kilograms')
      .replace(/\b(\d+(?:\.\d+)?)\s?GB\b/g, '$1 gigabytes')
      .replace(/\b(\d+(?:\.\d+)?)\s?MB\b/g, '$1 megabytes')
      .replace(/\b(\d{4})\/(\d{4})\b/g, '$1 to $2')
      .replace(/\be\.g\./gi, 'for example')
      .replace(/\bi\.e\./gi, 'that is')
      .replace(/\betc\./gi, 'et cetera')
      .replace(/\bvs\.?(?=\s)/gi, 'versus')
      .replace(/\bapprox\./gi, 'approximately')
      .replace(/\s[\u2014\u2013]\s/g, ', ')
      .replace(/[\u2014]/g, ', ')
      .replace(/\s&\s/g, ' and ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s+/g, ' ').trim();
    if (t && !/[.!?\u2026:;]["'\u201d\u2019)\]]*$/.test(t)) t += '.';
    return t;
  }

  var ABBR = /(?:\b(?:e\.g|i\.e|etc|vs|approx|No|Nos|Mr|Mrs|Ms|Dr|St|Prof|Inc|Ltd|Co|U\.S|a\.m|p\.m|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|\b[A-Z])\.$/;
  var MAX = 190; // longest piece handed to the voice, in characters

  function cutPoint(raw, s, e) {
    var hay = raw.slice(s + 50, e);
    var k = Math.max(hay.lastIndexOf(', '), hay.lastIndexOf('; '), hay.lastIndexOf(': '), hay.lastIndexOf(') '));
    if (k >= 0) return s + 50 + k + 1;
    k = hay.lastIndexOf(' ');
    return k >= 0 ? s + 50 + k : e;
  }

  // Split one block's raw text into sentences with their start/end offsets in that text.
  function sentencesOf(raw) {
    var out = [], re = /(?:[^.!?]|[.!?]+(?![.!?"'\u201d\u2019)\]]*(?:\s|$)))+[.!?]*["'\u201d\u2019)\]]*/g, m, pend = null;
    while ((m = re.exec(raw))) {
      if (!m[0]) { re.lastIndex++; continue; }
      var s = m.index, e = m.index + m[0].length;
      if (pend) { s = pend.s; pend = null; }
      var piece = raw.slice(s, e).trim();
      if (ABBR.test(piece) && e < raw.length) { pend = { s: s }; continue; }
      out.push({ s: s, e: e });
    }
    if (pend) out.push({ s: pend.s, e: raw.length });
    var res = [];
    out.forEach(function (o) {
      var s = o.s, e = o.e;
      while (/\s/.test(raw.charAt(s)) && s < e) s++;
      while (e > s && /\s/.test(raw.charAt(e - 1))) e--;
      while (e - s > MAX) {
        var c = cutPoint(raw, s, s + MAX);
        res.push({ s: s, e: c });
        s = c;
        while (/\s/.test(raw.charAt(s)) && s < e) s++;
      }
      if (e > s) res.push({ s: s, e: e });
    });
    return res;
  }

  var G = [];       // blocks (title, headings, paragraphs, list items)
  var S = [];       // sentences, in reading order
  var cum = [];     // spoken characters before each sentence
  var tot = 0;
  var built = false;

  function textNodesOf(block) {
    var nodes = [], raw = '';
    var tw = doc.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return n.matches(NOT_READ) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return n.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    }, false);
    var n;
    while ((n = tw.nextNode())) { nodes.push({ n: n, a: raw.length, b: raw.length + n.nodeValue.length }); raw += n.nodeValue; }
    return { nodes: nodes, raw: raw };
  }

  function build() {
    if (built) return;
    built = true;
    var title = (titleEl.textContent || '').replace(/\s+/g, ' ').trim();
    G.push({ el: titleEl, kind: 'title', nodes: null, raw: title, name: title });
    var blocks = article.querySelectorAll('p, h2, h3, h4, li, blockquote');
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.closest('figure, table, pre, .video-figure, .video-embed, [data-no-listen]')) continue;
      var isHead = /^H[2-4]$/.test(b.tagName);
      if (isHead && STOP_AT.test((b.textContent || '').trim())) break;
      var t = textNodesOf(b);
      if (!/[A-Za-z0-9]/.test(t.raw)) continue;
      G.push({ el: b, kind: isHead ? 'head' : 'text', nodes: t.nodes, raw: t.raw, name: isHead ? t.raw.replace(/\s+/g, ' ').trim() : '' });
    }
    G.forEach(function (g, gi) {
      g.first = S.length;
      var parts = g.kind === 'title' ? [{ s: 0, e: g.raw.length }] : sentencesOf(g.raw);
      parts.forEach(function (p) {
        var text = speakable(g.raw.slice(p.s, p.e));
        if (!/[A-Za-z0-9]/.test(text)) return;
        S.push({ g: gi, s: p.s, e: p.e, text: text, len: text.length, range: null });
      });
    });
    var run = 0;
    S.forEach(function (s, i) { cum[i] = run; run += s.len; });
    cum[S.length] = run;
    tot = run || 1;
  }

  function rangeFor(sen) {
    var g = G[sen.g];
    if (!g.nodes || !g.nodes.length) return null;
    if (sen.range) return sen.range;
    var sn = null, so = 0, en = null, eo = 0;
    for (var k = 0; k < g.nodes.length; k++) {
      var nd = g.nodes[k];
      if (sn === null && sen.s < nd.b) { sn = nd.n; so = sen.s - nd.a; }
      if (sen.e <= nd.b) { en = nd.n; eo = sen.e - nd.a; break; }
    }
    if (!sn || !en) return null;
    var r = doc.createRange();
    try { r.setStart(sn, so); r.setEnd(en, eo); } catch (err) { return null; }
    sen.range = r;
    return r;
  }

  /* --------------------------------------------------------- state & UI */
  var state = 'idle'; // idle | playing | paused | ended | error
  var active = -1, nextIdx = 0, queued = 0, gen = 0, refs = [];
  var cps = 14; // spoken characters per second at normal speed; learned while reading
  var tStart = {}, stall = 0, startWatch = 0, errRun = 0, resumeAt = 0;
  var HL = !!(window.CSS && CSS.highlights && window.Highlight);
  var hl = HL ? new Highlight() : null;
  var curEl = null;

  function say(msg) { els.status.textContent = msg; }
  function minutes(chars) { return chars / (cps * rate) / 60; }
  function nice(min) { return min < 1 ? 'less than a minute' : 'about ' + Math.round(min) + ' min'; }

  function paintState() {
    player.setAttribute('data-state', state);
    var playing = state === 'playing';
    btn.setAttribute('aria-pressed', state === 'idle' ? 'false' : 'true');
    btn.setAttribute('data-state', state);
    els.btnLabel.textContent = state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : state === 'ended' ? 'Listen again' : 'Listen';
    q('[data-lp="toggle"]').setAttribute('aria-label', playing ? 'Pause' : state === 'ended' ? 'Listen again' : 'Play');
    var px = doc.querySelector('[data-listen-proxy] span');
    if (px) px.textContent = playing ? 'Pause' : state === 'paused' ? 'Resume' : state === 'ended' ? 'Listen again' : 'Listen to this article';
  }
  function paintSub() {
    var left = state === 'ended' ? 'Finished' : nice(minutes(tot - (cum[Math.max(0, active)] || 0))) + ' left';
    els.sub.textContent = left + ' · ' + rate + '×';
    els.speed.textContent = rate + '×';
  }

  function setBar(frac, ms) {
    var f = els.fill;
    f.style.transition = ms ? 'transform ' + Math.round(ms) + 'ms linear' : 'none';
    f.style.transform = 'scaleX(' + Math.max(0, Math.min(1, frac)).toFixed(4) + ')';
    els.track.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  }
  function freezeBar() {
    var m = /matrix\(([^,]+)/.exec(getComputedStyle(els.fill).transform || '');
    if (m) { els.fill.style.transition = 'none'; els.fill.style.transform = 'scaleX(' + parseFloat(m[1]) + ')'; }
  }

  function markBlock(el) {
    if (el === curEl) return;
    if (curEl) curEl.classList.remove('is-reading');
    if (el) el.classList.add('is-reading');
    curEl = el;
  }
  function clearMarks() {
    markBlock(null);
    if (HL) { hl.clear(); CSS.highlights['delete']('mb-reading'); }
  }

  /* --------------------------------------------------------- auto-scroll */
  var scrollTarget = 0, scrollPos = 0, scrollRaf = 0, scrollLast = 0, lastWrite = 0;
  function maxScroll() { return Math.max(0, root.scrollHeight - window.innerHeight); }
  function tick(now) {
    var dt = Math.min(64, now - scrollLast) / 1000;
    scrollLast = now;
    scrollPos += (scrollTarget - scrollPos) * (1 - Math.exp(-dt / 0.2));
    if (Math.abs(scrollTarget - scrollPos) < 0.5) { scrollPos = scrollTarget; window.scrollTo(0, scrollPos); lastWrite = now; scrollRaf = 0; return; }
    window.scrollTo(0, scrollPos);
    lastWrite = now;
    scrollRaf = requestAnimationFrame(tick);
  }
  function glideTo(y) {
    scrollTarget = Math.max(0, Math.min(maxScroll(), y));
    if (reduceMotion() || doc.hidden) { window.scrollTo(0, scrollTarget); scrollPos = scrollTarget; return; }
    if (!scrollRaf) { scrollPos = window.pageYOffset; scrollLast = performance.now(); scrollRaf = requestAnimationFrame(tick); }
  }
  function stopGlide() { if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; } }

  function followTo(sen) {
    var rc = null, r = sen.g !== undefined && rangeFor(sen);
    if (r) { var rs = r.getClientRects(); rc = rs.length ? rs[0] : r.getBoundingClientRect(); }
    else rc = G[sen.g].el.getBoundingClientRect();
    var hh = els.header ? els.header.getBoundingClientRect().height : 0;
    var pr = player.getBoundingClientRect();
    var usable = window.innerHeight - hh - Math.max(player.offsetHeight, window.innerHeight - pr.top) - 24; // the bar may sit above the cookie notice
    var anchor = hh + Math.max(40, usable * 0.3);
    var y = window.pageYOffset + rc.top - anchor;
    if (Math.abs(y - (scrollRaf ? scrollTarget : window.pageYOffset)) < 6) return;
    glideTo(y);
  }

  function setFollow(on, why) {
    follow = on;
    els.follow.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) { stopGlide(); if (why) say('Auto-scroll is off. Press the arrows button to follow the reading again.'); }
    else if (active >= 0 && state !== 'idle') followTo(S[active]);
  }
  // Scrolling by hand always wins over auto-scroll.
  function userScrolled(e) {
    if (state === 'idle' || !follow) return;
    if (e && e.target && e.target.closest && e.target.closest('[data-listen-player]')) return;
    setFollow(false, true);
  }
  window.addEventListener('wheel', userScrolled, { passive: true });
  window.addEventListener('touchmove', userScrolled, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown| )$/.test(e.key) && !/^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test((e.target || {}).tagName || '')) userScrolled(e);
  });
  window.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && e.clientX >= root.clientWidth) userScrolled(e); }, { passive: true });
  window.addEventListener('scroll', function () {
    if (state === 'idle' || !follow || scrollRaf) return;
    if (performance.now() - lastWrite > 250 && Math.abs(window.pageYOffset - scrollPos) > 3) setFollow(false, true);
  }, { passive: true });

  /* ------------------------------------------------------ what is active */
  function activate(i, jump) {
    if (i === active && !jump) return;
    active = i;
    var sen = S[i], g = G[sen.g];
    markBlock(g.el);
    if (HL) {
      hl.clear();
      var r = g.kind === 'title' ? null : rangeFor(sen);
      if (r) { hl.add(r); CSS.highlights.set('mb-reading', hl); }
    }
    els.label.textContent = g.kind === 'title' ? 'Reading the title' : sectionOf(sen.g);
    if (jump) setBar(cum[i] / tot, 0);
    paintSub();
    if (follow && g.kind !== 'title') followTo(sen);
  }
  // One CSS transition per sentence: the bar glides to the end of the sentence being spoken, with no per-frame JavaScript.
  function runBar(i) { setBar(cum[i + 1] / tot, S[i].len / (cps * rate) * 1000); }
  function sectionOf(gi) {
    for (var k = gi; k >= 0; k--) if (G[k].kind === 'head') return G[k].name;
    return 'Introduction';
  }

  /* ------------------------------------------------------------- speaking */
  function makeUtterance(i) {
    var u = new SpeechSynthesisUtterance(S[i].text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = root.lang || 'en';
    u.rate = rate; u.pitch = 1; u.volume = 1;
    u._g = gen; u._i = i;
    u.onstart = function () {
      if (u._g !== gen) return;
      clearTimeout(startWatch);
      errRun = 0;
      tStart[i] = performance.now();
      activate(i);
      runBar(i);
      armStall(i);
    };
    u.onend = function () {
      if (u._g !== gen) return;
      queued--;
      var took = performance.now() - (tStart[i] || performance.now());
      if (took > 500 && took < 60000) { var sp = S[i].len / (took / 1000) / rate; if (sp > 5 && sp < 45) cps = cps * 0.7 + sp * 0.3; }
      if (i + 1 < S.length) { tStart[i + 1] = performance.now(); activate(i + 1); runBar(i + 1); }
      if (i >= S.length - 1) finish(); else pump();
    };
    u.onerror = function (ev) {
      if (u._g !== gen) return;
      var why = ev && ev.error;
      if (why === 'interrupted' || why === 'canceled') return;
      queued--;
      if (why === 'not-allowed') { fail('Sound is blocked. Press play again.', true); return; }
      errRun++;
      if (errRun >= 3 || why === 'synthesis-unavailable' || why === 'language-unavailable' || why === 'voice-unavailable') { fail('Could not play audio. Try another voice.'); return; }
      if (i >= S.length - 1) finish(); else pump();
    };
    refs.push(u);
    if (refs.length > 8) refs.shift();
    return u;
  }
  function pump() {
    while (state === 'playing' && queued < 3 && nextIdx < S.length) {
      var u = makeUtterance(nextIdx++);
      queued++;
      synth.speak(u);
    }
  }
  function armStall(i) {
    clearTimeout(stall);
    var ms = S[i].len / (cps * rate) * 1000 * 2.5 + 7000;
    stall = setTimeout(function () { if (state === 'playing' && active === i) restartAt(i, false); }, ms);
  }

  function restartAt(i, userAction) {
    i = Math.max(0, Math.min(S.length - 1, i));
    gen++; queued = 0; nextIdx = i; errRun = 0;
    clearTimeout(stall); clearTimeout(startWatch);
    var busy = synth.speaking || synth.pending;
    if (busy) synth.cancel();
    state = 'playing';
    paintState();
    activate(i, true);
    var myGen = gen;
    var go = function () {
      if (myGen !== gen || state !== 'playing') return;
      pump();
      startWatch = setTimeout(function () {
        if (myGen === gen && state === 'playing' && !tStart[i]) fail('Audio did not start. Press play to try again.');
      }, 6000);
    };
    tStart = {};
    // Browsers drop a speak() that comes right after cancel(), so wait a moment only when something was playing.
    if (busy) setTimeout(go, 70); else go();
    keepAwake(true);
    say(userAction === false ? '' : 'Reading');
  }

  function pause() {
    if (state !== 'playing') return;
    resumeAt = Math.max(0, active);
    state = 'paused';
    gen++; queued = 0;
    clearTimeout(stall); clearTimeout(startWatch);
    synth.cancel();
    freezeBar();
    stopGlide();
    keepAwake(false);
    paintState(); paintSub(); say('Paused');
  }
  function resume() { if (state === 'paused') restartAt(resumeAt, true); }
  function finish() {
    clearTimeout(stall);
    state = 'ended';
    gen++; queued = 0;
    clearMarks();
    setBar(1, 0);
    els.label.textContent = 'Finished reading';
    keepAwake(false);
    paintState(); paintSub(); say('Finished reading the article');
  }
  function fail(msg, canRetry) {
    gen++; queued = 0;
    clearTimeout(stall); clearTimeout(startWatch);
    try { synth.cancel(); } catch (e) { /* ignore */ }
    state = canRetry ? 'paused' : 'error';
    resumeAt = Math.max(0, active);
    keepAwake(false);
    paintState();
    els.label.textContent = msg;
    say(msg);
  }
  function stop() {
    gen++; queued = 0;
    clearTimeout(stall); clearTimeout(startWatch);
    try { synth.cancel(); } catch (e) { /* ignore */ }
    stopGlide();
    clearMarks();
    state = 'idle'; active = -1;
    keepAwake(false);
    player.classList.remove('is-open');
    doc.body.classList.remove('has-player');
    root.classList.remove('is-listening');
    els.panel.classList.remove('is-open'); els.settings.setAttribute('aria-expanded', 'false');
    paintState(); setBar(0, 0); say('Stopped');
  }
  function start() {
    build();
    if (!S.length) return;
    Array.prototype.forEach.call(doc.querySelectorAll('video, audio'), function (m) { try { m.pause(); } catch (e) { /* ignore */ } });
    root.classList.add('is-listening');
    doc.body.classList.add('has-player');
    player.classList.add('is-open');
    follow = true; els.follow.setAttribute('aria-pressed', 'true');
    setBar(0, 0);
    restartAt(0, true);
  }

  /* ---------------------------------------- stay clear of the cookie notice */
  function cookieGap() {
    var ck = doc.querySelector('.cookie');
    root.style.setProperty('--cookie-h', ck ? Math.ceil(ck.getBoundingClientRect().height) + 'px' : '0px');
  }
  if (window.MutationObserver) new MutationObserver(cookieGap).observe(doc.body, { childList: true });
  window.addEventListener('resize', cookieGap);
  cookieGap();

  /* ------------------------------------------------ keep the screen awake */
  var lock = null;
  function keepAwake(on) {
    try {
      if (on && navigator.wakeLock && !lock) {
        navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); })['catch'](function () {});
      } else if (!on && lock) { lock.release(); lock = null; }
    } catch (e) { /* not supported */ }
  }

  /* ------------------------------------------------------------- controls */
  function toggle() {
    if (state === 'idle' || state === 'ended' || state === 'error') start();
    else if (state === 'playing') pause();
    else resume();
  }
  function jumpBlock(delta) {
    if (state === 'idle' || active < 0) return;
    var gi = S[active].g, cur = G[gi], target;
    if (delta > 0) target = gi + 1;
    else target = (active > cur.first || performance.now() - (tStart[active] || 0) > 2500) ? gi : gi - 1;
    target = Math.max(0, Math.min(G.length - 1, target));
    var idx = G[target].first;
    if (idx >= S.length) return;
    setFollow(true);
    restartAt(idx, true);
  }

  btn.hidden = false;
  btn.addEventListener('click', toggle);
  // the same reader can be started from the sidebar card
  var proxy = doc.querySelector('[data-listen-proxy]');
  if (proxy) { proxy.hidden = false; proxy.addEventListener('click', toggle); }
  player.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-lp]') : null;
    if (b) {
      var act = b.getAttribute('data-lp');
      if (act === 'toggle') toggle();
      else if (act === 'prev') jumpBlock(-1);
      else if (act === 'next') jumpBlock(1);
      else if (act === 'close') stop();
      else if (act === 'follow') setFollow(!follow, false);
      else if (act === 'speed') {
        rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
        save('mayobebros-listen-rate', String(rate));
        paintSub();
        if (state === 'playing') restartAt(Math.max(0, active), false);
      } else if (act === 'settings') {
        var open = els.panel.classList.toggle('is-open');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      return;
    }
    var tr = e.target.closest ? e.target.closest('[data-lp-track]') : null;
    if (tr && state !== 'idle') {
      var rc = tr.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width)), goal = f * tot, k = 0;
      while (k < S.length - 1 && cum[k + 1] <= goal) k++;
      setFollow(true);
      restartAt(k, true);
    }
  });
  player.addEventListener('keydown', function (e) { if (e.key === 'Escape') { stop(); btn.focus(); } });
  els.voice.addEventListener('change', function () {
    var v = (synth.getVoices() || []).filter(function (x) { return (x.voiceURI || x.name) === els.voice.value; })[0];
    if (!v) return;
    voice = v;
    save('mayobebros-listen-voice', v.voiceURI || v.name);
    if (state === 'playing') restartAt(Math.max(0, active), false);
  });

  // Never talk over a video, and never keep talking after the page is left.
  doc.addEventListener('play', function (e) { if (e.target && /^(VIDEO|AUDIO)$/.test(e.target.tagName) && state === 'playing') pause(); }, true);
  window.addEventListener('pagehide', function () { try { synth.cancel(); } catch (e) { /* ignore */ } keepAwake(false); });
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) return;
    if (state === 'playing') { keepAwake(true); if (follow && active >= 0) followTo(S[active]); }
  });
  window.addEventListener('resize', function () { if (state === 'playing' && follow && active >= 0) followTo(S[active]); });

  // Listening time on the button, before anyone presses it.
  var words = (article.textContent || '').trim().split(/\s+/).length;
  els.btnTime.textContent = ' · ' + Math.max(1, Math.round(words / (170 * rate))) + ' min';
  els.speed.textContent = rate + '\u00d7';
  paintState();
})();
