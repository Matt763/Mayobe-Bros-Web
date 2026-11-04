// Checks on the built post pages (run `node scripts/build.mjs` first).
//   node --no-warnings --test scripts/tests/pages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function postPages(dir = path.join(ROOT, 'post')) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...postPages(full));
    else if (entry.name === 'index.html') out.push(full);
  }
  return out;
}

// The "Keep reading" grid fades in when js/site.js sees 6% of it on screen. A grid that is taller than about
// 16 screens can never show 6% at once, so its cards stayed at opacity 0 (a blank section) until a reload restored
// the scroll position. It once listed every article on the site (126 cards, 22,000 to 63,000 px tall).
const MAX_KEEP_READING_CARDS = 6;

test('every "Keep reading" section is short enough to fade in', () => {
  const pages = postPages();
  assert.ok(pages.length > 0, 'no built post pages found: run node scripts/build.mjs first');
  let checked = 0;
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    const head = html.indexOf('<h2>Keep reading</h2>');
    if (head < 0) continue; // redirect stubs and one-post sites have no such section
    const end = html.indexOf('</section>', head);
    const cards = (html.slice(head, end).match(/<article class="card/g) || []).length;
    const rel = path.relative(ROOT, file);
    assert.ok(cards >= 1, `${rel}: "Keep reading" has no cards`);
    assert.ok(cards <= MAX_KEEP_READING_CARDS, `${rel}: "Keep reading" has ${cards} cards (at most ${MAX_KEEP_READING_CARDS})`);
    checked++;
  }
  assert.ok(checked > 0, 'no page had a "Keep reading" section');
});
