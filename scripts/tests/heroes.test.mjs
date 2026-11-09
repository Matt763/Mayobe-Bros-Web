// Every hero (the big picture and title at the top of a page) looks the same: picture, title, line of text. No "Home / ..." breadcrumb pill in it.
// An article keeps its breadcrumb, but below the hero (and as BreadcrumbList data), not inside it.
//   node --no-warnings --test scripts/tests/heroes.test.mjs   (after `node scripts/build.mjs`)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pages = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'worker', 'scripts', 'content', 'vendor', 'assets', 'data'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) pages.push(p);
  }
};
walk(ROOT);

test('no hero on any page holds a breadcrumb (RSS, sitemap and every other page look alike)', () => {
  let heroes = 0;
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<section class="hero [^"]*">([\s\S]*?)<\/section>/g)) {
      heroes++;
      assert.doesNotMatch(m[1], /class="breadcrumbs"|aria-label="Breadcrumb"/, `${path.relative(ROOT, f)}: breadcrumb inside the hero`);
    }
  }
  assert.ok(heroes > 100, `looked at ${heroes} heroes`);
  for (const rel of ['rss/index.html', 'sitemap/index.html']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, rel), 'utf8'), /class="breadcrumbs"/, rel);
});

test('an article still has its breadcrumb, below the hero, and the same trail as data', () => {
  const post = pages.find((f) => fs.readFileSync(f, 'utf8').includes('<article class="post">'));
  const html = fs.readFileSync(post, 'utf8');
  assert.match(html, /<div class="post-crumbs wrap"><nav class="breadcrumbs"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
});
