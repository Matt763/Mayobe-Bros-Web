// The words a visitor reads (errors, hints, status lines) follow one house style: short, plain, no blame, no internals.
//   node --no-warnings --test scripts/tests/messages.test.mjs
// This scans every quoted sentence in the page scripts and the Worker for words that do not belong in front of a visitor.
// The per-file tests (contact, subscribe, manage, newsletter-page, worker) check the exact sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['js/engage.js', 'js/manage.js', 'js/newsletter.js', 'js/subscribe.js', 'js/contact.js', 'js/site.js', 'js/listen.js', 'js/notfound.js', 'js/notfound-posts.js', 'js/pager.js'];
// not a message to the visitor: text put into the body of a mail the visitor sends, and the cookie notice
const OK = [/message shortened/, /We use browser storage/];

// every single-quoted string of two or more words, with comments taken out
function sentences(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  return [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]).filter((t) => t.length >= 8 && / /.test(t));
}

test('no visitor sentence in the page scripts says Sorry, Oops, Please, an exclamation or a technical word', () => {
  const bad = /\bsorry\b|\boops\b|\bplease\b|[a-z]!(\s|$)|\bserver\b|\bAPI\b|JSON|network error|timeout|\bHTTP\b|\bstatus code\b|\btoken\b/i;
  for (const f of FILES) {
    for (const t of sentences(f)) {
      if (OK.some((re) => re.test(t))) continue;
      assert.doesNotMatch(t, bad, `${f}: ${t.slice(0, 120)}`);
    }
  }
});

test('the Worker never answers with the words of the old long messages', () => {
  for (const f of ['worker/src/index.js', 'worker/src/newsletter.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/fail\(\s*[`'"]([^`'"]+)[`'"]/g)) {
      const t = m[1];
      if (/^(Unauthorized|No such comment|Unknown action|Not found|Invalid webhook|Bad request|mode must be|Give the address|The reply must be|You can only reply to a published comment|That comment was deleted by its author and cannot)/.test(t)) continue; // owner-only routes and mail-provider calls
      assert.doesNotMatch(t, /\bplease\b|\bsorry\b|several|already|minutes|waiting for review|visitor id|Unknown|!/i, `${f}: ${t}`);
    }
  }
});
