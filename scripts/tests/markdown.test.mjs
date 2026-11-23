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

test('javascript:, vbscript: and data: addresses in links and pictures become "#", even when disguised', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>']) {
    assert.match(markdown(`[x](${bad})`), /<a href="#"/, bad);
    assert.match(markdown(`![x](${bad})`), /<img src="#"/, bad);
  }
  // a tab inside the scheme turns into spaces, which stops it being a link at all
  assert.doesNotMatch(markdown('[x](java\tscript:alert(1))'), /(href|src)="[^"]*script:/i);
  assert.match(markdown('[ok](https://example.com/a?b=c)'), /<a href="https:\/\/example\.com\/a\?b=c"/);
  assert.match(markdown('[ok](/post/a/)'), /<a href="\/post\/a\/"/);
  assert.match(markdown('[mail](mailto:info@example.com)'), /href="mailto:info@example\.com"/);
});

test('raw script, iframe and event attributes in a post are neutralised; harmless raw tags stay', () => {
  assert.doesNotMatch(markdown('hello <script>alert(1)</script>'), /<script/i);
  assert.doesNotMatch(markdown('<iframe src="https://evil.example"></iframe>'), /<iframe/i);
  assert.doesNotMatch(markdown('<img src=x onerror=alert(1)>'), /onerror/i);
  assert.doesNotMatch(markdown('<b onclick="x()">bold</b>'), /onclick/i);
  assert.doesNotMatch(markdown('<svg onload=alert(1)>'), /<svg/i);
  assert.match(markdown('Press <kbd>Ctrl</kbd> and <b>bold</b><br>text'), /<kbd>Ctrl<\/kbd>.*<b>bold<\/b><br>/);
});

test('carousel of tables: every #### starts a slide, each table keeps its sideways-scroll box, and a plain stack is the fallback', () => {
  const html = markdown([
    ':::carousel[Jobs by group]',
    '#### First group',
    '',
    '| No. | Job |',
    '|---|---|',
    '| 1 | Nurse |',
    '',
    '#### Second group & more',
    '',
    '| No. | Job |',
    '|---|---|',
    '| 2 | Engineer |',
    ':::',
    '',
    'After.',
  ].join('\n'));
  assert.match(html, /<section class="tbl-carousel" id="tbl-carousel-1" aria-roledescription="carousel" aria-label="Jobs by group" data-tbl-carousel>/);
  assert.equal((html.match(/class="tbl-slide"/g) || []).length, 2);
  assert.match(html, /aria-label="1 of 2: First group"/);
  assert.match(html, /aria-label="2 of 2: Second group &amp; more"/);
  assert.equal((html.match(/class="table-wrapper" role="region" aria-label="[^"]+: table" tabindex="0"/g) || []).length, 2, 'each table box is named after its group and can be focused to scroll');
  assert.match(html, /<h4 class="tbl-slide-title">First group<\/h4>/, 'h4: never in the contents list');
  assert.match(html, /<\/section>\n<p>After\.<\/p>/);
  // no #### inside: nothing to slide, so the content is left as it is
  assert.doesNotMatch(markdown(':::carousel[x]\nplain text\n:::'), /tbl-carousel/);
});

test('a video poster button has no explanatory sentence and no raw <svg> (the owner does not want "Press play to watch..." on any video)', () => {
  const html = markdown('::youtube[How it works](https://youtu.be/dQw4w9WgXcQ){poster=assets/posts/x.webp}');
  assert.match(html, /<button class="video-load"[^>]*aria-label="Play video: How it works"/, 'the button is still named for screen readers');
  assert.doesNotMatch(html, /Press play|only contacted|video-load-note/i);
  // the play triangle is drawn with CSS: neutralise() turns a raw <svg> into visible text on the poster
  assert.doesNotMatch(html, /<svg|&lt;svg/i);
  assert.match(html, /<span class="video-load-play" aria-hidden="true"><\/span>/);
});

test('a ::video line with sources= gives every file a size (Plyr shows a Quality row)', () => {
  const html = markdown('::video[Clip](assets/video/a-720.mp4){size=720 sources="assets/video/a-480.mp4:480 assets/video/a-1080.mp4:1080"}');
  assert.match(html, /<source src="\/assets\/video\/a-720\.mp4" type="video\/mp4" size="720">/);
  assert.match(html, /<source src="\/assets\/video\/a-480\.mp4" type="video\/mp4" size="480">/);
  assert.match(html, /size="1080"/);
});
