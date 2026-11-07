import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, addHeadingIds, plainText, slugify } from '../lib/markdown.mjs';
import { parseFrontMatter } from '../lib/frontmatter.mjs';

test('paragraphs and inline formatting', () => {
  assert.equal(markdown('Hello **bold** and *it* and `code`.'), '<p>Hello <strong>bold</strong> and <em>it</em> and <code>code</code>.</p>');
  assert.equal(markdown('a\n\nb'), '<p>a</p>\n<p>b</p>');
});

test('escapes text but keeps entities and raw inline html', () => {
  assert.equal(markdown('5 < 6 & AT&amp;T <b>x</b>'), '<p>5 &lt; 6 &amp; AT&amp;T <b>x</b></p>');
});

test('headings', () => {
  assert.equal(markdown('## Hi there ##'), '<h2>Hi there</h2>');
  assert.equal(markdown('# One\n\n### Three'), '<h1>One</h1>\n<h3>Three</h3>');
});

test('links and images', () => {
  assert.equal(markdown('[site](https://x.com/a_b_c "T")'), '<p><a href="https://x.com/a_b_c" title="T" rel="noopener">site</a></p>');
  assert.equal(markdown('[home](/about/)'), '<p><a href="/about/">home</a></p>');
  assert.match(markdown('![alt text](https://x.com/i.jpg)'), /<img src="https:\/\/x\.com\/i\.jpg" alt="alt text" loading="lazy"/);
  assert.match(markdown('![alt](a.jpg "A caption")'), /<figure><img .*<figcaption>A caption<\/figcaption><\/figure>/);
});

test('urls with underscores are not mangled by emphasis', () => {
  assert.match(markdown('See https://example.com/a_b_c now'), /href="https:\/\/example\.com\/a_b_c"/);
});

test('lists, nested lists and ordered lists', () => {
  assert.equal(markdown('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(markdown('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  const nested = markdown('- a\n  - b\n  - c\n- d');
  assert.match(nested, /<li>a\n<ul>\n<li>b<\/li>\n<li>c<\/li>\n<\/ul><\/li>/);
  assert.match(nested, /<li>d<\/li>/);
  assert.match(markdown('3. x\n4. y'), /<ol start="3">/);
});

test('blockquote, hr, fenced code', () => {
  assert.equal(markdown('> quote'), '<blockquote>\n<p>quote</p>\n</blockquote>');
  assert.equal(markdown('---'), '<hr>');
  assert.equal(markdown('```js\nif (a < b) {}\n```'), '<pre><code class="language-js">if (a &lt; b) {}</code></pre>');
});

test('tables', () => {
  const html = markdown('| A | B |\n|---|:-:|\n| 1 | 2 |');
  assert.match(html, /<th>A<\/th><th style="text-align:center">B<\/th>/);
  assert.match(html, /<td>1<\/td><td style="text-align:center">2<\/td>/);
});

test('raw html blocks pass through, even across blank lines', () => {
  const html = markdown('<div class="callout callout-info">\n\n<p>Note</p>\n\n</div>\n\nAfter');
  assert.match(html, /^<div class="callout callout-info">/);
  assert.match(html, /<p>Note<\/p>[\s\S]*<\/div>\n<p>After<\/p>$/);
});

test('hard line breaks and a paragraph stopping at a list', () => {
  assert.equal(markdown('a  \nb'), '<p>a<br>\nb</p>');
  assert.equal(markdown('intro\n- x'), '<p>intro</p>\n<ul>\n<li>x</li>\n</ul>');
});

test('heading ids and table of contents', () => {
  const { html, toc } = addHeadingIds('<h2>Why it works</h2><h3>Why it works</h3><h2 id="keep">Keep</h2>');
  assert.deepEqual(toc.map((t) => t.id), ['why-it-works', 'why-it-works-2', 'keep']);
  assert.match(html, /<h2 id="why-it-works">/);
});

test('plainText and slugify', () => {
  assert.equal(plainText('<p>Hi &amp; <b>bye</b></p>'), 'Hi & bye');
  assert.equal(slugify('Café & Crème 2026!'), 'cafe-and-creme-2026');
});

test('front matter', () => {
  const { data, body } = parseFrontMatter('---\ntitle: "Top 10: AI"\nfeatured: true\ntags: [a, "b c", d]\ndate: 2026-11-03\n---\nBody');
  assert.equal(data.title, 'Top 10: AI');
  assert.equal(data.featured, true);
  assert.deepEqual(data.tags, ['a', 'b c', 'd']);
  assert.equal(data.date, '2026-11-03');
  assert.equal(body, 'Body');
  assert.deepEqual(parseFrontMatter('no front matter').data, {});
});

test('video lines become Plyr-ready markup', () => {
  const v = markdown('::video[A clip](assets/video/a.mp4){poster=assets/posts/a.webp captions=assets/video/a.vtt}');
  assert.match(v, /<figure class="video-figure" id="video-1">\n<video controls playsinline preload="none" poster="\/assets\/posts\/a\.webp"/);
  assert.match(v, /<source src="\/assets\/video\/a\.mp4" type="video\/mp4">/);
  assert.match(v, /<track kind="captions" srclang="en" label="English" src="\/assets\/video\/a\.vtt" default>/);
  assert.match(v, /<figcaption>A clip<\/figcaption>/);
  const y = markdown('Before\n::youtube[How it works](https://youtu.be/dQw4w9WgXcQ)\nAfter');
  assert.match(y, /data-video-embed data-provider="youtube" data-embed-id="dQw4w9WgXcQ"/);
  assert.doesNotMatch(y, /<iframe|youtube\.com|ytimg/);
  assert.match(y, /<p>Before<\/p>/);
  assert.match(y, /<p>After<\/p>/);
  assert.match(markdown('::youtube[x](nonsense)'), /video link not understood/);
});

test('video figures get id video-1 and video-2 in body order', () => {
  const html = markdown('Intro\n\n::youtube[First](https://youtu.be/dQw4w9WgXcQ)\n\nMiddle\n\n::video[Second](assets/video/b.mp4)\n\nEnd');
  const ids = [...html.matchAll(/<figure class="video-figure[^"]*" id="(video-\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['video-1', 'video-2']);
  assert.ok(html.indexOf('First') < html.indexOf('Second'), 'body order kept');
  // the count starts again for every document
  assert.match(markdown('::video[Only](assets/video/c.mp4)'), /id="video-1"/);
  assert.doesNotMatch(markdown('::video[Only](assets/video/c.mp4)'), /id="video-2"/);
});
