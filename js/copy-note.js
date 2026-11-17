/* Mayobe Bros: a long copy from an article carries a link back.
   Only text inside the article body (.article-content) is touched, and only a copy of MIN characters or more: a name, a number, a short
   quote or a web address is never changed. Form fields, code and tables are left alone. Text selection itself stays on (turning it off
   blocks no scraper, and breaks Find in page, Speak Selection and screen reader line reading).
   Mode (data-copy-mode on this script, from "copyGuard" in site.config.json):
     attribute  the whole copy is kept and a link to the article is added
     limit      only the first MIN characters are copied, plus the link
   Stores nothing. If anything goes wrong the browser copies as usual. */
(function () {
  'use strict';
  try {
    if (!window.getSelection || !document.addEventListener) return;

    var script = document.currentScript;
    var MODE = (script && script.getAttribute('data-copy-mode')) === 'limit' ? 'limit' : 'attribute';
    var MIN = parseInt(script && script.getAttribute('data-copy-min'), 10);
    if (!(MIN >= 40)) MIN = 160;
    var BODY = '.article-content';
    var SKIP = 'pre, code, table, input, textarea, select, [contenteditable], [data-copy-ok]';
    var note = null;
    var timer = 0;

    function elOf(n) { while (n && n.nodeType !== 1) n = n.parentNode; return n; }

    function say(msg) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'copy-note';
        note.setAttribute('role', 'status');
        note.setAttribute('aria-live', 'polite');
        document.body.appendChild(note);
      }
      note.textContent = msg;
      // a frame later, so the change of text is announced and the fade plays
      window.requestAnimationFrame(function () { note.classList.add('is-on'); });
      clearTimeout(timer);
      timer = setTimeout(function () { note.classList.remove('is-on'); }, 5000);
    }

    function pageUrl() {
      var c = document.querySelector('link[rel="canonical"]');
      return (c && c.href) || (location.origin + location.pathname);
    }

    function onCopy(e) {
      try {
        var cd = e.clipboardData;
        var sel = window.getSelection();
        if (!cd || !cd.setData || !sel || sel.isCollapsed || !sel.rangeCount) return;
        var t = e.target && e.target.closest ? e.target : null;
        if (t && t.closest('input, textarea, select, [contenteditable]')) return;

        var text = String(sel);
        if (text.length < MIN) return;

        var r = sel.getRangeAt(0);
        var a = elOf(r.startContainer), b = elOf(r.endContainer);
        if (!a || !b || !a.closest) return;
        var box = a.closest(BODY);
        if (!box || !box.contains(b)) return; // it started or ended outside the article text
        if (a.closest(SKIP) || b.closest(SKIP)) return;

        var url = pageUrl();
        var out, msg;
        if (MODE === 'limit') {
          out = text.slice(0, MIN).replace(/\s+\S*$/, '') + ' ...\n\nRead the full article: ' + url;
          msg = 'Long copies are shortened. A link to this article is added.';
        } else {
          out = text + '\n\nRead more at ' + url;
          msg = 'Copied with a link to this article.';
        }
        cd.setData('text/plain', out); // plain text only: bold, links and lists are not kept
        e.preventDefault();            // only after setData worked: an error above leaves the normal copy alone
        say(msg);                      // shown only when the clipboard really was changed
      } catch (err) { /* never break the page: the browser copies as usual */ }
    }

    document.addEventListener('copy', onCopy);
  } catch (err) { /* nothing to do */ }
}());
