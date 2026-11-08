// Lints every email template (worker/src/mail-templates.js) against the email design rules in the Resend plan:
// structure, forbidden CSS, minimum sizes, token-only colours, WCAG contrast, preheader length, escaping of hostile
// visitor input, one primary button, and a clean plain-text part. Each builder runs with long hostile data and with
// short data, so the rules hold as copy gets longer or shorter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contrast, PAIRS, DECORATIVE, TOKEN_HEX, LIGHT, DARK } from '../../worker/src/mail-tokens.js';
import * as K from '../../worker/src/mail-tokens.js';
import * as T from '../../worker/src/mail-templates.js';

const SITE = { origin: 'https://mayobebros.com', assetOrigin: 'https://mayobebros.com', logoUrl: 'https://mayobebros.com/assets/email/logo.png' };
const ASSET = 'https://mayobebros.com';
const LOGO = `${ASSET}/assets/email/logo.png`;
// Pictures allowed per email: the logo everywhere; welcome adds a lead picture and two thumbnails, new article a hero.
const MAX_IMG = { welcomeEmail: 4, newPostEmail: 2 };
// Classes that only carry layout (padding, width, stacking): everything else must be restyled by the dark block.
// The card is 600 px with a 1 px border, so its inner width is 598; on phones (up to 620 px wide) it runs edge to edge.
const MAX_CELL = 598, PHONE_MAX = 620;
const MSO_DPI = '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->';
const LAYOUT_CLASSES = new Set(['mb-wrap', 'mb-outer', 'mb-foot', 'mb-footband', 'mb-dt', 'mb-dd', 'mb-h1']);

// Hostile pieces: markup, both quote kinds, an ampersand and a header-injection attempt.
const EVIL = `<script>alert(1)</script> "quoted" 'single' & <b>bold</b>\r\nBcc: x@y.z`;
const NAME = (`"Ann" <script>alert(1)</script> 'O'Neil' &\r\nBcc: x@y.z ` + 'n'.repeat(200)).slice(0, 120);
const MSG = (EVIL + '\n\n' + 'This is a long message line. '.repeat(80)).slice(0, 2000);
const U = (p) => `https://mayobebros.com/${p}?a=1&b=2`; // links are emitted normalised (new URL().href), so test URLs are already normal
const IMG = (kind, slug, v = '0123abcd') => `${'https://mayobebros.com'}/assets/email/${kind}-${slug}.jpg?v=${v}`;
const POSTS = [1, 2, 3].map((i) => ({
  title: `${EVIL} title ${i}`, url: U(`post/x/p${i}/`), excerpt: MSG.slice(0, 300), category: i === 2 ? 'Jobs and Internships' : EVIL,
  image: IMG('post', `p${i}`), thumb: IMG('thumb', `p${i}`), imageAlt: `${EVIL} alt ${i}`,
  ...(i === 2 ? { video: { image: IMG('video', `p${i}`, '89abcdef'), url: U(`post/x/p${i}/`) + '#video-1' } } : {}),
}));

const LONG = {
  manageLinkEmail: { name: NAME, commentExcerpt: MSG, postTitle: EVIL + ' ' + 'Long title '.repeat(10), postUrl: U('post/a/b/'), manageUrl: U('manage/') + '#tok', notifyWanted: true },
  replyNoticeEmail: { name: NAME, postTitle: EVIL, postUrl: U('post/a/b/'), replyAuthor: NAME, replyBody: MSG, unsubscribeUrl: U('v1/notify/unsubscribe'), isTeam: false },
  ownerAlertEmail: { reason: EVIL, postSlug: 'slug-' + EVIL, postUrl: U('post/a/b/'), commentId: 42, name: NAME, body: MSG, kind: 'held' },
  contactOwnerEmail: { name: NAME, email: 'ann.o+test@example.com', subject: EVIL + ' ' + 'subject '.repeat(30), message: MSG, type: 'technical', receivedAt: Date.UTC(2026, 10, 6, 14, 5) },
  contactVisitorEmail: { name: NAME, subject: EVIL + ' ' + 'subject '.repeat(30), type: 'general' },
  confirmSubscriptionEmail: { confirmUrl: U('newsletter/') + '#confirm' },
  welcomeEmail: { unsubscribeUrl: U('v1/newsletter/unsubscribe'), latestPosts: POSTS },
  newPostEmail: { post: { title: EVIL + ' ' + 'Long title '.repeat(12), url: U('post/x/y/'), excerpt: MSG.slice(0, 400), image: IMG('post', 'y'), imageAlt: EVIL, category: 'Educational', video: { image: IMG('video', 'y', '89abcdef'), url: U('post/x/y/') + '#video-1' } }, unsubscribeUrl: U('v1/newsletter/unsubscribe') },
  farewellEmail: { resubscribeUrl: U('newsletter/') },
};
const SHORT = {
  manageLinkEmail: { name: 'Jo', commentExcerpt: 'Nice.', postTitle: 'Loans', postUrl: 'https://mayobebros.com/post/a/', manageUrl: 'https://mayobebros.com/manage/#t', notifyWanted: false },
  replyNoticeEmail: { name: '', postTitle: 'Loans', postUrl: 'https://mayobebros.com/post/a/', replyAuthor: 'Mayobe Bros', replyBody: 'Yes.', unsubscribeUrl: 'https://mayobebros.com/u', isTeam: true },
  ownerAlertEmail: { reason: 'link', postSlug: 'a', postUrl: 'https://mayobebros.com/post/a/', commentId: 1, name: 'Jo', body: 'Hi?', kind: 'question' },
  contactOwnerEmail: { name: 'Jo', email: 'jo@example.com', subject: '', message: 'Hi', type: '', receivedAt: '2026-11-06T10:00:00Z' },
  contactVisitorEmail: { name: '', subject: '', type: 'technical' },
  confirmSubscriptionEmail: { confirmUrl: 'https://mayobebros.com/newsletter/#c' },
  welcomeEmail: { unsubscribeUrl: 'https://mayobebros.com/u', latestPosts: [{ title: 'Loans', url: 'https://mayobebros.com/post/a/', thumb: IMG('thumb', 'a') }] },
  newPostEmail: { post: { title: 'Loans', url: 'https://mayobebros.com/post/a/', excerpt: '', image: IMG('post', 'a') }, unsubscribeUrl: 'https://mayobebros.com/u' },
  farewellEmail: { resubscribeUrl: 'https://mayobebros.com/newsletter/' },
};
const BUILDERS = Object.keys(LONG);

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function dataUrls(v, key = '', out = []) {
  if (typeof v === 'string' && /url$/i.test(key)) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => dataUrls(x, key, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) dataUrls(x, k, out);
  return out;
}

function lint(out, data, { checkUrls = true, name = '' } = {}) {
  const errs = [];
  const { subject, html, text } = out;
  const n = (re) => (html.match(re) || []).length;
  // structure
  if (n(/<h1[\s>]/g) !== 1) errs.push(`h1 count ${n(/<h1[\s>]/g)}`);
  if (!/<html lang="en"/.test(html)) errs.push('no html lang');
  if (!/<title>[^<]+<\/title>/.test(html)) errs.push('no title');
  for (const t of html.match(/<table\b[^>]*>/g) || []) if (!/role="presentation"/.test(t)) errs.push('table without role: ' + t);
  // pictures: our own JPEG/PNG under /assets/email/ on the https asset origin, sized, block-level, no border, scalable
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  for (const t of imgs) {
    if (!/\salt="/.test(t) || !/\swidth="\d+"/.test(t) || !/\sheight="\d+"/.test(t)) errs.push('img attrs: ' + t);
    const src = decode((t.match(/\ssrc="([^"]*)"/) || [, ''])[1]);
    if (!src || T.ownImage(src, ASSET) !== src) errs.push('img src not ownImage: ' + src);
    if (!/^https:\/\/[^/]+\/assets\/email\/[a-z0-9-]+\.(jpg|png)(\?v=[0-9a-f]{8})?$/.test(src)) errs.push('img src shape: ' + src);
    const st = (t.match(/\sstyle="([^"]*)"/) || [, ''])[1];
    for (const rule of ['display:block', 'border:0', 'height:auto']) if (!st.includes(rule)) errs.push(`img without ${rule}: ${t}`);
    const w = Number((t.match(/\swidth="(\d+)"/) || [, 0])[1]);
    // fluid: width:100% up to a max-width between the width attribute (what Outlook desktop uses) and the widest the cell gets on a phone
    const mw = Number((st.match(/max-width:(\d+)px/) || [, 0])[1]);
    if (w > 200 && (!st.includes('width:100%') || mw < w || mw > PHONE_MAX)) errs.push(`img wider than 200 without width:100%;max-width:${w}-${PHONE_MAX}px: ${t}`);
    if (w > MAX_CELL) errs.push(`img width attribute ${w} wider than the card's inner width ${MAX_CELL}: ${t}`);
  }
  if (imgs.length > (MAX_IMG[name] || 1)) errs.push(`img count ${imgs.length} > ${MAX_IMG[name] || 1}`);
  // the first picture is the wordmark logo, once
  if (!imgs.length || !/\salt="Mayobe Bros"/.test(imgs[0]) || !imgs[0].includes(`src="${LOGO}`)) errs.push('first img is not the logo');
  if (n(/<img\b[^>]*\salt="Mayobe Bros"/g) !== 1) errs.push('logo count ' + n(/<img\b[^>]*\salt="Mayobe Bros"/g));
  // Outlook desktop on a high-DPI screen scales pictures unless the document says 96 pixels per inch
  if (!html.includes(MSO_DPI)) errs.push('no Outlook PixelsPerInch block');
  if (!/<html\b[^>]*\sxmlns:o="urn:schemas-microsoft-com:office:office"/.test(html)) errs.push('no xmlns:o on <html>');
  if (!html.includes('<meta name="color-scheme" content="light dark">')) errs.push('color-scheme meta');
  if (!html.includes('<meta name="supported-color-schemes" content="light dark">')) errs.push('supported-color-schemes meta');
  if (!/@media \(prefers-color-scheme: dark\)/.test(html)) errs.push('no dark block');
  if (n(/<style[\s>]/g) !== 1) errs.push('style blocks ' + n(/<style[\s>]/g));
  // forbidden
  const low = html.toLowerCase();
  for (const bad of ['rgba(', 'gradient', 'box-shadow', 'background-image', '<svg', '@import', '@font-face', '<script',
    'position:', 'filter:', '<video', '<iframe', 'georgia', 'times new roman']) if (low.includes(bad)) errs.push('forbidden ' + bad);
  const styleAttrs = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]);
  const styleBlock = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];
  for (const s of [...styleAttrs, styleBlock]) if (/url\(/i.test(s)) errs.push('url( in style');
  // fonts: system sans (or the monospace for owner commands); "serif" only as part of "sans-serif"
  for (const m of html.matchAll(/font-family:([^;"]*)/g)) if (/serif/i.test(m[1].replace(/sans-serif/gi, ''))) errs.push('serif font: ' + m[1]);
  // dark mode: every class that carries colour is restyled in the dark block
  const darkBlock = styleBlock.slice(Math.max(0, styleBlock.indexOf('@media (prefers-color-scheme: dark)')));
  const classes = new Set([...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  for (const c of classes) if (!LAYOUT_CLASSES.has(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(darkBlock)) errs.push('class not in the dark block: ' + c);
  // sizes
  for (const m of html.matchAll(/font-size:\s*([\d.]+)([a-z%]*)/g)) if (m[2] !== 'px' || Number(m[1]) < 12) errs.push('font-size ' + m[0]);
  const bytes = Buffer.byteLength(html);
  if (bytes >= 40000) errs.push('bytes ' + bytes);
  // colours: every hex in style attributes, bgcolor attributes and the style block is a token
  const colourText = [...styleAttrs, styleBlock, ...[...html.matchAll(/\sbgcolor="([^"]*)"/g)].map((m) => m[1])].join(' ');
  for (const m of colourText.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) if (!TOKEN_HEX.has(m[0].toLowerCase())) errs.push('colour not a token ' + m[0]);
  // preheader: first element after <body>, hidden, 90 to 130 characters
  const pre = html.match(/<body[^>]*>\s*<div style="([^"]*)">([\s\S]*?)<\/div>/);
  if (!pre) errs.push('no preheader first in body');
  else {
    for (const rule of ['display:none', 'max-height:0', 'overflow:hidden', 'mso-hide:all', 'opacity:0']) if (!pre[1].includes(rule)) errs.push('preheader missing ' + rule);
    const ptext = decode(pre[2].replace(/(&#847;|&zwnj;|&nbsp;)/g, '')).trim();
    if (ptext.length < 90 || ptext.length > 130) errs.push(`preheader length ${ptext.length}: ${ptext}`);
  }
  // safety
  if (/<script/i.test(html)) errs.push('raw script');
  if (html.includes('"quoted"') || html.includes("'single'") || html.includes("'O'Neil'")) errs.push('unescaped quotes from data');
  if (/[\r\n]/.test(subject)) errs.push('CR/LF in subject');
  if (!subject.trim() || subject.length > 150) errs.push('subject length ' + subject.length);
  if (text.includes('\r')) errs.push('CR in text');
  // primary action: exactly one bgcolor cell wrapping an <a>, 48 px tall, same URL as a text link and in text
  const buttons = [...html.matchAll(/<td\b([^>]*\bbgcolor="[^"]*"[^>]*)>\s*<a\b([^>]*)>/g)];
  if (buttons.length !== 1) errs.push('buttons ' + buttons.length);
  else {
    const td = buttons[0][1];
    const a = buttons[0][2];
    const href = (a.match(/href="([^"]*)"/) || [])[1];
    const st = (a.match(/style="([^"]*)"/) || [, ''])[1];
    const pad = st.match(/[;"]?padding:(\d+)px (\d+)px/);
    const lh = st.match(/line-height:(\d+)px/);
    if (!pad || !lh || 2 * Number(pad[1]) + Number(lh[1]) < 48) errs.push('button under 48px: ' + st);
    // Outlook (Word engine) ignores padding on an inline <a>: the cell must carry the same padding as mso-padding-alt.
    if (!pad || !td.includes(`mso-padding-alt:${pad[1]}px ${pad[2]}px`)) errs.push('button cell without matching mso-padding-alt: ' + td);
    if (!href) errs.push('button without href');
    else {
      if (html.split(`href="${href}"`).length - 1 < 2) errs.push('button URL not repeated as a text link');
      if (!text.includes(decode(href))) errs.push('button URL not in text');
    }
  }
  // plain text
  if (!text.trim()) errs.push('empty text');
  if (/<\/?[a-z][^>]*>/i.test(text)) errs.push('tag in text');
  if (checkUrls) for (const u of dataUrls(data)) if (!text.includes(u)) errs.push('url missing from text ' + u);
  // well-formed output: no lone surrogates, no control characters in the subject, none but \n and \t in text
  for (const [k, v] of Object.entries(out)) if (!v.isWellFormed()) errs.push(k + ' has a lone surrogate');
  if (/[\x00-\x1f\x7f\x85\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(subject)) errs.push('control character in subject');
  if (/[\x00-\x08\x0b-\x1f\x7f\x85\u202a-\u202e\u2066-\u2069]/.test(text)) errs.push('control character in text');
  return errs;
}

test('esc escapes the five HTML characters; oneLine removes line breaks and control characters', () => {
  assert.equal(T.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(T.esc(null), '');
  assert.equal(T.oneLine('a\r\nBcc: b\u2028c\n'), 'a Bcc: b c');
  assert.equal(T.oneLine('a\vb\0c\u0085d\u2029e\x7ff\x1bg\u202eh\u2066i'), 'a b c d e f g h i');
  assert.equal(T.esc('x\ud800y'), 'x\ufffdy');
  assert.equal(T.oneLine('x\udc00y'), 'x\ufffdy');
});

// Absurd and hostile values: lone surrogates, vertical tab, NUL, NEL, bidi overrides, huge strings, wrong types.
const WEIRD = ['\ud800', 'a\udc00b', '\v\0\u0085', '\u202eevil\u202c', 'x'.repeat(100000), '"\ud83d', 12345, null, undefined, {}, [], true, { toString: () => 'obj' }];
function weirdData(name, w) {
  const keys = Object.keys(LONG[name]);
  const d = Object.fromEntries(keys.map((k) => [k, w]));
  if (name === 'newPostEmail') d.post = Object.fromEntries(Object.keys(LONG.newPostEmail.post).map((k) => [k, w]));
  if (name === 'welcomeEmail' && typeof w === 'string') d.latestPosts = [{ title: w, url: w, excerpt: w }, w, null];
  return d;
}
for (const name of BUILDERS) {
  test(`${name} never throws and stays valid on lone surrogates, control characters, bidi overrides, huge and wrong-typed values`, () => {
    for (const w of WEIRD) {
      let out;
      assert.doesNotThrow(() => { out = T[name](weirdData(name, w), SITE); }, `${name} threw on ${typeof w === 'string' ? JSON.stringify(w.slice(0, 20)) : String(w)}`);
      assert.deepEqual(lint(out, {}, { checkUrls: false, name }), [], `${name} with ${typeof w === 'string' ? JSON.stringify(w.slice(0, 20)) : String(w)}`);
    }
    assert.doesNotThrow(() => T[name](undefined, SITE));
    assert.doesNotThrow(() => T[name](null));
  });
}

test('throwing getters and Proxies as data never make a builder throw', () => {
  const trap = () => new Proxy({}, { get() { throw new Error('trap'); }, has() { throw new Error('trap'); }, ownKeys() { throw new Error('trap'); } });
  const getterData = { get kind() { throw new Error('getter'); }, get name() { throw new Error('getter'); }, post: trap(), latestPosts: new Proxy([], { get() { throw new Error('trap'); } }), title: 'ok' };
  const badSite = { get origin() { throw new Error('getter'); } };
  for (const name of BUILDERS) {
    for (const data of [trap(), getterData]) {
      let out;
      assert.doesNotThrow(() => { out = T[name](data, SITE); }, name);
      assert.deepEqual(lint(out, {}, { checkUrls: false, name }), [], name);
    }
    assert.doesNotThrow(() => T[name](SHORT[name], badSite), name + ' with a throwing site');
    assert.doesNotThrow(() => T[name](SHORT[name], trap()), name + ' with a Proxy site');
  }
});

test('zero-width and direction marks are removed from owner-bound text', () => {
  const ZW = '​‌‍‎‏؜⁠﻿';
  const own = T.contactOwnerEmail({ ...SHORT.contactOwnerEmail, name: `Jo${ZW}x`, subject: `S${ZW}y`, message: `M${ZW}z` }, SITE);
  const al = T.ownerAlertEmail({ ...SHORT.ownerAlertEmail, name: `Jo${ZW}x`, body: `B${ZW}z`, reason: `R${ZW}q` }, SITE);
  for (const o of [own, al]) for (const part of [o.subject, o.html, o.text]) assert.ok(!/[​-‏؜⁠﻿]/.test(part), 'zero-width or direction mark left');
  assert.ok(own.text.includes('M z') || own.text.includes('Mz'));
});

test('a hostile visitor address cannot break the mailto button', () => {
  const email = 'a"b<c>\'d@x.y\r\nBcc: z@q.r\ud800 %0D%0A?cc=e@f.g&subject=x';
  const out = T.contactOwnerEmail({ ...SHORT.contactOwnerEmail, email, subject: 'Hi\ud800 "there"\r\nBcc: x@y.z' }, SITE);
  assert.deepEqual(lint(out, {}, { checkUrls: false }), []);
  const href = decode(out.html.match(/<td\b[^>]*bgcolor="[^"]*"[^>]*>\s*<a\b[^>]*href="([^"]*)"/)[1]);
  assert.match(href, /^mailto:[A-Za-z0-9@._+%-]+\?subject=[A-Za-z0-9%._~!*'()-]*$/);
  assert.ok(!/[\s"<>]/.test(href));
  assert.equal((href.match(/\?/g) || []).length, 1, 'only our own ?subject= query');
  assert.ok(!/&(cc|bcc|subject)=/i.test(href), 'no extra mailto fields from the address');
});

test('links that must be ours are dropped unless they are on the site origin', () => {
  const evil = ['https://evil.example/manage/#t', 'https://mayobebros.com.evil.example/', 'https://mayobebros.com@evil.example/', 'http://mayobebros.com/x', '//evil.example/',
    'https://mayobebros.com\\@evil.example/', // backslash: WHATWG reads it as a path, some linkifiers as userinfo
    'https://mayobebros。com/x', // ideographic full stop in the host
    'https://ｍａｙｏｂｅｂｒｏｓ.com/x', // fullwidth letters in the host
    'https://mayobebros.com/a b', 'https://mayobebros.com/é\u202e'];
  for (const u of evil) {
    const all = [
      T.manageLinkEmail({ ...SHORT.manageLinkEmail, manageUrl: u, postUrl: u }, SITE),
      T.replyNoticeEmail({ ...SHORT.replyNoticeEmail, postUrl: u, unsubscribeUrl: u }, SITE),
      T.ownerAlertEmail({ ...SHORT.ownerAlertEmail, postUrl: u }, SITE),
      T.confirmSubscriptionEmail({ confirmUrl: u }, SITE),
      T.welcomeEmail({ unsubscribeUrl: u, latestPosts: [{ title: 'T', url: u }] }, SITE),
      T.newPostEmail({ post: { title: 'T', url: u, image: u }, unsubscribeUrl: u }, SITE),
      T.farewellEmail({ resubscribeUrl: u }, SITE),
    ];
    for (const o of all) assert.ok(!o.html.includes(u) && !o.text.includes(u) && !o.html.includes('evil.example') && !o.text.includes('evil.example'), `${u} leaked`);
  }
  // A non-ASCII host is rejected outright, not mapped to our host by the URL parser.
  for (const u of evil.filter((x) => /^https:\/\/[^/]*[^\x00-\x7f]/.test(x))) {
    const o = T.confirmSubscriptionEmail({ confirmUrl: u }, SITE);
    assert.ok(!o.text.includes('mayobebros.com/x'), `${u} was mapped instead of rejected`);
  }
  // Scheme and host compare case-insensitively and are emitted normalised (lower case), for every link-bearing builder.
  for (const [u, want] of [['HTTPS://MAYOBEBROS.COM/x', 'https://mayobebros.com/x'], ['HTTPS://MayobeBros.com/newsletter/#c', 'https://mayobebros.com/newsletter/#c']]) {
    const outs = [
      T.manageLinkEmail({ ...SHORT.manageLinkEmail, manageUrl: u, postUrl: u }, SITE),
      T.replyNoticeEmail({ ...SHORT.replyNoticeEmail, postUrl: u, unsubscribeUrl: u }, SITE),
      T.ownerAlertEmail({ ...SHORT.ownerAlertEmail, postUrl: u }, SITE),
      T.confirmSubscriptionEmail({ confirmUrl: u }, SITE),
      T.welcomeEmail({ unsubscribeUrl: u, latestPosts: [{ title: 'T', url: u }] }, SITE),
      T.newPostEmail({ post: { title: 'T', url: u }, unsubscribeUrl: u }, SITE),
      T.farewellEmail({ resubscribeUrl: u }, SITE),
    ];
    for (const o of outs) {
      assert.ok(o.text.includes(want) && o.html.includes(`href="${want}"`), `${u} not emitted as ${want}`);
      assert.ok(!o.text.includes(u) && !o.html.includes(u), `${u} emitted raw`);
    }
  }
});

// Emails to addresses nobody has verified yet must not carry visitor free text (phishing / spam relay).
const MARK = { name: 'NAMEMARK Win a prize at evil.example', commentExcerpt: 'EXCERPTMARK visit evil.example', subject: 'SUBJECTMARK evil.example', message: 'MESSAGEMARK', email: 'EMAILMARK@evil.example', replyAuthor: 'AUTHORMARK', type: 'TYPEMARK' };
const leaks = (o) => ['NAMEMARK', 'EXCERPTMARK', 'SUBJECTMARK', 'MESSAGEMARK', 'EMAILMARK', 'AUTHORMARK', 'TYPEMARK', 'evil.example'].filter((m) => o.subject.includes(m) || o.html.includes(m) || o.text.includes(m));
test('manage link email (unverified address) shows no visitor name or comment text', () => {
  for (const notifyWanted of [true, false]) {
    const o = T.manageLinkEmail({ ...LONG.manageLinkEmail, name: MARK.name, commentExcerpt: MARK.commentExcerpt, postTitle: 'How to apply for a loan', notifyWanted }, SITE);
    assert.deepEqual(leaks(o), []);
    assert.match(o.text, /Hello,/);
    assert.match(o.text, /You asked for a link to manage a comment you left on/);
    assert.ok(o.html.includes('How to apply for a loan'));
  }
});
test('contact visitor email (unverified address) is fixed text: no name, subject or type echo', () => {
  const o = T.contactVisitorEmail({ name: MARK.name, subject: MARK.subject, type: MARK.type }, SITE);
  assert.deepEqual(leaks(o), []);
  assert.match(o.text, /Hello,/);
  assert.match(o.text, /Your message reached us\./);
  assert.match(o.text, /If it needs a reply, we will write to the address you gave us\./);
  assert.match(o.html, /If it needs a reply, we will write to the address you gave us\./);
});
test('newsletter emails never echo visitor fields even if a caller passes them', () => {
  for (const name of ['confirmSubscriptionEmail', 'welcomeEmail', 'newPostEmail', 'farewellEmail']) {
    assert.deepEqual(leaks(T[name]({ ...SHORT[name], ...MARK }, SITE)), [], name);
  }
});
test('owner emails keep the full escaped visitor content; reply notices keep the reply', () => {
  const own = T.contactOwnerEmail({ ...SHORT.contactOwnerEmail, name: 'NAMEMARK', subject: 'SUBJECTMARK', message: 'MESSAGEMARK <b>' }, SITE);
  for (const m of ['NAMEMARK', 'SUBJECTMARK', 'MESSAGEMARK &lt;b&gt;']) assert.ok(own.html.includes(m), m);
  const al = T.ownerAlertEmail({ ...SHORT.ownerAlertEmail, name: 'NAMEMARK', body: 'BODYMARK' }, SITE);
  assert.ok(al.html.includes('NAMEMARK') && al.html.includes('BODYMARK'));
  const rep = T.replyNoticeEmail({ ...SHORT.replyNoticeEmail, isTeam: false, replyAuthor: 'AUTHORMARK', replyBody: 'REPLYMARK' }, SITE);
  assert.ok(rep.html.includes('AUTHORMARK') && rep.html.includes('REPLYMARK') && rep.text.includes('REPLYMARK'));
});
test('contact-failed alert states facts and offers a reply to the visitor', () => {
  const o = T.ownerAlertEmail({ kind: 'contact-failed', reason: 'status=500', name: 'Jo', email: 'jo@example.com', body: 'My question' }, SITE);
  assert.match(o.text, /could not be emailed to you/);
  assert.match(o.html, /href="mailto:jo@example\.com\?subject=/);
  assert.ok(o.text.includes('My question'));
  assert.deepEqual(lint(o, {}, { checkUrls: false }), []);
});
test('a held comment with review links passes the same lint: one filled button, a quiet second one, both links in the text part', () => {
  const o = T.ownerAlertEmail({ ...SHORT.ownerAlertEmail, kind: 'held', approveUrl: `${SITE.origin}/manage/#r=1.a.x.${'A'.repeat(43)}`, ignoreUrl: `${SITE.origin}/manage/#r=1.i.x.${'A'.repeat(43)}` }, SITE);
  assert.deepEqual(lint(o, {}, { checkUrls: false }), []);
  assert.match(o.html, /Approve this comment/);
  assert.match(o.html, /class="mb-btn2-a"/);
  assert.ok(o.text.includes('#r=1.a.x.') && o.text.includes('#r=1.i.x.'));
  assert.ok(!/mb-btn2[^"]*"[^>]*bgcolor/.test(o.html), 'the quiet button has no fill');
});
test('no reply-time promises and no claims beyond site.config.json anywhere', () => {
  for (const name of BUILDERS) for (const data of [LONG[name], SHORT[name]]) {
    for (const kind of name === 'ownerAlertEmail' ? ['held', 'question', 'contact-failed'] : [undefined]) {
      for (const type of name.startsWith('contact') ? ['technical', 'support', 'general'] : [undefined]) {
        const o = T[name]({ ...data, ...(kind ? { kind } : {}), ...(type ? { type } : {}) }, SITE);
        const all = o.subject + o.html + o.text;
        for (const bad of [/24 hours/i, /working days/i, /business days/i, /checked against official sources/i, /student loans/i, /small business/i, /daily life/i, /expect a reply/i,
          /read every message/i, /will reply/i, /\bwithin\b[^.]{0,40}\b(hours?|days?|weeks?)\b/i, /we aim to/i]) {
          assert.ok(!bad.test(all), `${name} ${kind || type || ''}: ${bad}`);
        }
      }
    }
  }
  assert.match(T.farewellEmail(SHORT.farewellEmail, SITE).html, /Clear, honest guides on education, jobs, money and technology for readers in Tanzania\./);
});

test('contrast() follows WCAG relative luminance', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrast('#ffffff', '#ffffff') - 1) < 0.01);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.01);
});

test('every contrast pair in PAIRS meets its minimum, in light and dark', () => {
  for (const [fg, bg, min, label] of PAIRS) {
    assert.ok(TOKEN_HEX.has(fg) && TOKEN_HEX.has(bg), `${label}: colours must be tokens`);
    assert.ok([4.5, 3].includes(min), `${label}: min must be 4.5 or 3`);
    const r = contrast(fg, bg);
    assert.ok(r >= min, `${label}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
  }
  const labels = PAIRS.map((p) => p[3]).join(' | ');
  for (const mode of ['light', 'dark']) for (const role of ['heading', 'body', 'muted', 'kicker', 'link', 'button', 'logo alt', 'image alt']) {
    assert.ok(PAIRS.some((p) => p[3].startsWith(mode) && p[3].includes(role)), `missing ${mode} ${role} pair in: ${labels}`);
  }
  for (const role of ['footer text', 'footer link', 'wordmark']) assert.ok(PAIRS.some((p) => p[3].includes(role)), 'missing ' + role);
  assert.ok(DECORATIVE.length > 0 && DECORATIVE.every((d) => d.length === 3), 'decorative colours are listed with a reason');
  for (const mode of ['light', 'dark']) assert.ok(PAIRS.some((p) => p[3].startsWith(mode) && p[3].includes('link on quote')), `missing ${mode} link on quote pair`);
  assert.equal(LIGHT.page, '#f3f6fb');
  assert.equal(DARK.card, '#101a2e');
});

test('the body paragraph helper emits 16 px text at line-height 1.6', () => {
  const html = T.p('Hello');
  assert.match(html, /font-size:16px/);
  assert.match(html, /line-height:1\.6/);
});

for (const name of BUILDERS) {
  for (const [label, data] of [['long hostile', LONG[name]], ['short', SHORT[name]]]) {
    test(`${name} (${label} data) passes the email lint`, () => {
      const out = T[name](data, SITE);
      assert.deepEqual(Object.keys(out).sort(), ['html', 'subject', 'text']);
      assert.deepEqual(lint(out, data, { name }), []);
    });
  }
}

test('every email stays under 40,000 bytes even when every field is 5,000 characters that all need escaping', () => {
  const Q = '"'.repeat(5000);
  const QU = 'https://mayobebros.com/' + '"'.repeat(470);
  const worst = (v, key = '') => {
    if (typeof v === 'string') return /url$/i.test(key) ? QU : key === 'email' ? 'a@example.com' : Q;
    if (Array.isArray(v)) return v.map((x) => worst(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'image' ? 'https://mayobebros.com/a.jpg' : worst(x, k)]));
    return v;
  };
  for (const name of BUILDERS) {
    const { html } = T[name](worst(LONG[name]), SITE);
    assert.ok(Buffer.byteLength(html) < 40000, `${name}: ${Buffer.byteLength(html)} bytes`);
  }
  const odd = T.contactOwnerEmail({ ...worst(LONG.contactOwnerEmail), receivedAt: Q, type: Q }, SITE);
  assert.ok(Buffer.byteLength(odd.html) < 40000, `contact with odd receivedAt: ${Buffer.byteLength(odd.html)} bytes`);
  // Ordinary 5,000-character text fits whole; text that escapes to too many bytes is cut in HTML only.
  const whole = T.contactOwnerEmail({ ...SHORT.contactOwnerEmail, message: 'word '.repeat(1000) }, SITE);
  assert.ok(!/cut short/.test(whole.html));
  const cut = T.contactOwnerEmail({ ...SHORT.contactOwnerEmail, message: '"'.repeat(5000) }, SITE);
  assert.match(cut.html, /cut short/);
  assert.ok(cut.text.includes('"'.repeat(5000)));
});

test('a hostile name never reaches a header-bound string', () => {
  for (const name of BUILDERS) {
    const { subject } = T[name](LONG[name], SITE);
    assert.ok(!/\r|\n/.test(subject), name);
    assert.ok(!subject.includes('\r\nBcc:'), name);
  }
});

test('a javascript: URL in data never becomes a link', () => {
  const out = T.manageLinkEmail({ ...SHORT.manageLinkEmail, manageUrl: 'javascript:alert(1)', postUrl: 'javascript:alert(2)' }, SITE);
  assert.ok(!/javascript:/i.test(out.html) && !/javascript:/i.test(out.text));
});

test('contact visitor email never repeats the message; the owner email has it', () => {
  const vis = T.contactVisitorEmail({ name: 'Jo', subject: 'Login', type: 'technical', message: 'SECRET-BODY' }, SITE);
  assert.ok(!vis.html.includes('SECRET-BODY') && !vis.text.includes('SECRET-BODY'));
  const own = T.contactOwnerEmail({ ...SHORT.contactOwnerEmail, message: 'SECRET-BODY' }, SITE);
  assert.match(own.html, /SECRET-BODY/);
});

test('manage link email mentions reply notices only when they were asked for', () => {
  const yes = T.manageLinkEmail({ ...SHORT.manageLinkEmail, notifyWanted: true }, SITE);
  const no = T.manageLinkEmail({ ...SHORT.manageLinkEmail, notifyWanted: false }, SITE);
  assert.match(yes.text, /repl/i);
  assert.ok(!/reply notices/i.test(no.text));
  assert.match(yes.text, /7 days/);
});

test('line breaks in visitor text survive as <br> in HTML and as quoted lines in text', () => {
  const own = T.contactOwnerEmail({ ...SHORT.contactOwnerEmail, message: 'Line one\r\nLine two' }, SITE);
  assert.match(own.html, /Line one<br>Line two/);
  assert.match(own.text, /> Line one\n> Line two/);
  const rep = T.replyNoticeEmail({ ...SHORT.replyNoticeEmail, replyBody: 'A\nB' }, SITE);
  assert.match(rep.html, /A<br>B/);
});

test('owner alert subjects differ by kind and the visitor body is escaped', () => {
  const kinds = ['held', 'question', 'contact-failed'].map((kind) => T.ownerAlertEmail({ ...LONG.ownerAlertEmail, kind }, SITE));
  assert.equal(new Set(kinds.map((k) => k.subject)).size, 3);
  for (const k of kinds) assert.ok(k.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('a missing site argument falls back to the live origin and logo', () => {
  const out = T.farewellEmail(SHORT.farewellEmail);
  assert.ok(out.html.includes('src="https://mayobebros.com/assets/email/logo.png"'));
  assert.ok(out.html.includes('href="https://mayobebros.com/"'));
});

test('reply notice greets by the first word of the name, so a long name is never cut mid-word', () => {
  const r = T.replyNoticeEmail({ name: 'Neema Wilhelmina Mwakalinga-Kitwana from Mbeya Region, Southern Highlands', postTitle: 'Loans', postUrl: 'https://mayobebros.com/post/a/', replyBody: 'Yes.', unsubscribeUrl: 'https://mayobebros.com/u' }, SITE);
  assert.match(r.html, />Hi Neema,</);
  assert.ok(r.text.startsWith('NEW REPLY TO YOUR COMMENT\n\nHi Neema,'));
  assert.ok(!r.html.includes('…,'));
  assert.match(T.replyNoticeEmail({ name: '  ', replyBody: 'x' }, SITE).html, />Hello,</);
});

test('emails to the owner carry no team sign-off; reader emails do; owner commands are on their own line', () => {
  const held = T.ownerAlertEmail({ ...LONG.ownerAlertEmail, kind: 'held' }, SITE);
  const owner = [held, T.contactOwnerEmail(SHORT.contactOwnerEmail, SITE)];
  for (const o of owner) { assert.ok(!o.html.includes('>The Mayobe Bros team</p>')); assert.ok(!o.text.includes('\n\nThe Mayobe Bros team\n')); }
  assert.match(held.html, /node scripts\/comments\.mjs list<\/span><\/p>/);
  assert.ok(held.text.includes('\n\n    node scripts/comments.mjs list'));
  const reader = T.farewellEmail(SHORT.farewellEmail, SITE);
  assert.ok(reader.html.includes('>The Mayobe Bros team</p>') && reader.text.includes('The Mayobe Bros team'));
});

/* ------------------------------------------------------------------ site look (email redesign, Task 2) */

// The first `<selector> {` block in css/style.css, as { '--name': '#value' } (lower case).
function cssVars(css, selector) {
  const m = css.match(new RegExp(`^${selector.replace('.', '\\.')} \\{([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(m, `no ${selector} block in css/style.css`);
  return Object.fromEntries([...m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim().toLowerCase()]));
}
test('email tokens follow css/style.css', () => {
  const css = fs.readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
  const light = cssVars(css, ':root');
  const dark = cssVars(css, ':root.dark');
  for (const [v, k] of [['--btn-bg', 'button'], ['--link', 'link'], ['--text', 'heading'], ['--text-2', 'body'], ['--text-3', 'muted'], ['--line-soft', 'border'], ['--bg-alt', 'page'], ['--surface-2', 'imageBg']]) {
    assert.equal(LIGHT[k], light[v], `LIGHT.${k} should be ${v} (${light[v]})`);
  }
  for (const [v, k] of [['--btn-bg', 'button'], ['--btn-text', 'buttonText'], ['--link', 'link'], ['--surface', 'card'], ['--bg', 'page'], ['--text', 'heading'], ['--text-2', 'body'], ['--text-3', 'muted']]) {
    assert.equal(DARK[k], dark[v], `DARK.${k} should be ${v} (${dark[v]})`);
  }
  assert.equal('FONT_SERIF' in K, false, 'FONT_SERIF is gone');
  assert.equal(K.FONT_SANS, "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif");
});

test('resolveSite: https origins pass; http only for 127.0.0.1 or localhost with an optional port; pictures and logo always https', () => {
  const DEF = 'https://mayobebros.com';
  for (const bad of ['http://mayobebros.com', 'http://127.0.0.1.evil.example:8000', 'http://localhost.evil.example', 'http://127.0.0.2:8000', 'http://[::1]:8000',
    'http://0.0.0.0:8000', 'http://127.0.0.1:8000/path', 'http://127.0.0.1:999999', 'http://user@127.0.0.1:8000', 'javascript:alert(1)', 'ftp://127.0.0.1', '', null, 42]) {
    const r = T.resolveSite({ origin: bad });
    assert.equal(r.origin, DEF, `${bad} was accepted`);
    assert.equal(r.assetOrigin, DEF);
    assert.equal(r.logoUrl, `${DEF}/assets/email/logo.png`);
  }
  for (const good of ['http://127.0.0.1:8000', 'http://localhost', 'http://127.0.0.1:8000/', 'http://localhost:5173']) {
    const r = T.resolveSite({ origin: good });
    assert.equal(r.origin, good.replace(/\/$/, ''), `${good} was refused`);
    assert.ok(r.assetOrigin.startsWith('https://mayobebros.com'), 'pictures stay on https');
    assert.ok(r.logoUrl.startsWith('https://mayobebros.com/'), 'the logo stays on https');
  }
  const prod = T.resolveSite({ origin: 'https://example.org/' });
  assert.deepEqual(prod, { origin: 'https://example.org', assetOrigin: 'https://example.org', logoUrl: 'https://example.org/assets/email/logo.png' });
  assert.equal(T.resolveSite({ origin: 'http://127.0.0.1:8000', assetOrigin: 'https://cdn.example' }).assetOrigin, 'https://cdn.example');
  assert.equal(T.resolveSite({ origin: 'http://127.0.0.1:8000', assetOrigin: 'http://cdn.example' }).assetOrigin, DEF);
  // logoUrl: only one that ownImage accepts on the asset origin
  assert.equal(T.resolveSite({ ...SITE, logoUrl: `${DEF}/assets/email/logo.png?v=0123abcd` }).logoUrl, `${DEF}/assets/email/logo.png?v=0123abcd`);
  for (const bad of [`${DEF}/assets/img/icon-192.png`, 'https://evil.example/assets/email/logo.png', `http://mayobebros.com/assets/email/logo.png`, `${DEF}/assets/email/logo.svg`]) {
    assert.equal(T.resolveSite({ ...SITE, logoUrl: bad }).logoUrl, `${DEF}/assets/email/logo.png`, bad);
  }
  // never throws; idempotent
  assert.doesNotThrow(() => T.resolveSite(new Proxy({}, { get() { throw new Error('trap'); } })));
  assert.deepEqual(T.resolveSite(undefined), { origin: DEF, assetOrigin: DEF, logoUrl: `${DEF}/assets/email/logo.png` });
  const loop = T.resolveSite({ origin: 'http://localhost:8000' });
  assert.deepEqual(T.resolveSite(loop), loop);
  // with a loopback site every picture in a real email is still https on the asset origin
  const o = T.farewellEmail(SHORT.farewellEmail, { origin: 'http://127.0.0.1:8000' });
  for (const src of [...o.html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])) assert.ok(src.startsWith('https://mayobebros.com/assets/email/'), src);
});

test('ownImage accepts only our https /assets/email/ JPEG or PNG with an optional v=<8 hex>', () => {
  const ok = ['https://mayobebros.com/assets/email/post-a.jpg', 'https://mayobebros.com/assets/email/thumb-a-b.jpg?v=0123abcd', 'https://mayobebros.com/assets/email/logo.png', 'HTTPS://MAYOBEBROS.COM/assets/email/post-a.jpg'];
  for (const u of ok) assert.equal(T.ownImage(u, ASSET), u.replace('HTTPS://MAYOBEBROS.COM', 'https://mayobebros.com'), u);
  const bad = ['http://mayobebros.com/assets/email/post-a.jpg', 'https://evil.example/assets/email/post-a.jpg', 'https://mayobebros.com/assets/email/post-a.webp',
    'https://mayobebros.com/assets/email/post-a.svg', 'https://mayobebros.com/assets/email/post-a.gif', 'data:image/jpeg;base64,AA', '//evil.example/x.jpg',
    'https://mayobebros.com/assets/share/post-a.jpg', 'https://mayobebros.com/assets/email/post-a.jpg?v=1234567g', 'https://mayobebros.com/assets/email/post-a.jpg?t=abc',
    'https://mayobebros.com/assets/email/post-a.jpg?v=0123abcd&t=1', 'https://mayobebros.com/assets/email/post-a.jpg#x', 'https://u:p@mayobebros.com/assets/email/post-a.jpg',
    'https://mayobebros.com/assets/email/Post-A.JPG', 'https://mayobebros.com/assets/email/sub/post-a.jpg', 'https://mayobebros.com/assets/email/post a.jpg',
    'https://mayobebros.com\\@evil.example/assets/email/post-a.jpg', 'https://mayobebros。com/assets/email/post-a.jpg', `https://mayobebros.com/assets/email/${'a'.repeat(500)}.jpg`, '', null, 7, {}];
  for (const u of bad) assert.equal(T.ownImage(u, ASSET), '', String(u).slice(0, 80));
  assert.equal(T.ownImage('http://127.0.0.1:8000/assets/email/post-a.jpg', 'http://127.0.0.1:8000'), '', 'never an http asset origin');
});

test('a loopback site gets loopback links; a production site never emits an http link', () => {
  const url = 'http://127.0.0.1:8000/newsletter/#c=x';
  const loop = T.confirmSubscriptionEmail({ confirmUrl: url }, { origin: 'http://127.0.0.1:8000' });
  assert.ok(loop.html.includes(`href="${url}"`) && loop.text.includes(url), 'loopback link kept');
  assert.deepEqual(lint(loop, {}, { checkUrls: false, name: 'confirmSubscriptionEmail' }), []);
  const prod = T.confirmSubscriptionEmail({ confirmUrl: url }, SITE);
  assert.ok(!prod.html.includes('127.0.0.1') && !prod.text.includes('127.0.0.1'), 'loopback link reached a production email');
  for (const name of BUILDERS) for (const data of [LONG[name], SHORT[name], { ...SHORT[name], confirmUrl: url, manageUrl: url, postUrl: url, unsubscribeUrl: url, resubscribeUrl: url }]) {
    const o = T[name](data, SITE);
    assert.ok(!/(href|src)="http:/i.test(o.html), `${name}: http link in html`);
    assert.ok(!/http:\/\//i.test(o.text), `${name}: http link in text`);
  }
});

test('the header shows the wordmark logo with styled alt text and a link home; no serif font anywhere', () => {
  const o = T.farewellEmail(SHORT.farewellEmail, SITE);
  const m = o.html.match(/<a\b[^>]*href="https:\/\/mayobebros\.com\/"[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/);
  assert.ok(m, 'the logo is linked to the home page');
  const img = m[1];
  for (const a of ['width="212"', 'height="48"', 'alt="Mayobe Bros"', `src="${LOGO}"`]) assert.ok(img.includes(a), `${a} in ${img}`);
  for (const s of ['font-size:20px', 'font-weight:bold', `color:${LIGHT.logoAlt}`, 'display:block', 'border:0', 'height:auto', 'width:100%', 'max-width:212px']) assert.ok(img.includes(s), `${s} in ${img}`);
  assert.match(img, /class="[^"]*\bmb-logo\b/);
  assert.ok(o.html.includes(`.mb-logo{color:${DARK.logoAlt}!important}`), 'logo alt colour in dark mode');
  // the header row is white, the bar under it two equal cells, green then blue
  assert.match(o.html, new RegExp(`class="mb-head"[^>]*style="[^"]*background:${LIGHT.header}`));
  assert.match(o.html, new RegExp(`<td[^>]*width="50%"[^>]*bgcolor="${LIGHT.barGreen}"[^>]*>[^<]*</td>\\s*<td[^>]*width="50%"[^>]*bgcolor="${LIGHT.barBlue}"`));
  for (const name of BUILDERS) {
    const h = T[name](LONG[name], SITE).html;
    assert.ok(!/georgia|times new roman/i.test(h), name);
    for (const f of h.matchAll(/font-family:([^;"]*)/g)) assert.ok(!/serif/i.test(f[1].replace(/sans-serif/gi, '')), `${name}: ${f[1]}`);
  }
});

test('the shell and components use the site look: card, kicker, sans heading, pill button, quote rule, dark footer', () => {
  const o = T.replyNoticeEmail(LONG.replyNoticeEmail, SITE);
  const h = o.html;
  // card: white with a 1 px border and 14 px radius on the cool grey page
  assert.match(h, new RegExp(`class="mb-frame"[^>]*style="[^"]*background:${LIGHT.card};border:1px solid ${LIGHT.border};border-radius:14px;`));
  assert.match(h, new RegExp(`<body class="mb-page" style="[^"]*background:${LIGHT.page};`));
  // kicker: 13 px, bold, capitals, letter-spaced, blue
  const k = h.match(/<p class="mb-kicker" style="([^"]*)">([^<]*)<\/p>/);
  assert.ok(k, 'kicker');
  for (const s of ['font-size:13px', 'font-weight:bold', 'letter-spacing:1.5px', `color:${LIGHT.kicker}`]) assert.ok(k[1].includes(s), s);
  assert.equal(k[2], k[2].toUpperCase());
  assert.equal(typeof T.eyebrow, 'undefined', 'eyebrow was replaced by kicker');
  assert.equal(T.kicker('New reply').includes('NEW REPLY'), true);
  // heading: sans 28 / 1.25, 800, tight; 24 px on phones
  const h1 = h.match(/<h1\b[^>]*style="([^"]*)"/)[1];
  for (const s of ['font-size:28px', 'line-height:1.25', 'font-weight:800', 'letter-spacing:-0.3px', `color:${LIGHT.heading}`]) assert.ok(h1.includes(s), s);
  assert.ok(h.includes('.mb-h1{font-size:24px!important}'));
  // button: pill, site blue; light blue with dark text in dark mode
  const btn = h.match(/<td class="mb-btn"[^>]*style="([^"]*)">\s*<a class="mb-btn-a"[^>]*style="([^"]*)"/);
  assert.ok(btn, 'button');
  assert.ok(btn[1].includes(`background:${LIGHT.button}`) && btn[1].includes('border-radius:24px') && btn[2].includes('border-radius:24px') && btn[2].includes(`color:${LIGHT.buttonText}`));
  assert.ok(h.includes(`.mb-btn{background:${DARK.button}!important}`) && h.includes(`.mb-btn-a{color:${DARK.buttonText}!important}`));
  // quote: tinted block with a 4 px blue rule on the left
  assert.match(h, new RegExp(`class="mb-quote[^"]*"[^>]*style="[^"]*background:${LIGHT.quote};border-left:4px solid ${LIGHT.quoteRule};`));
  assert.ok(h.includes(`border-left-color:${DARK.quoteRule}!important`));
  // footer: near-black, bold sans name, slogan, why line, white underlined links
  assert.match(h, new RegExp(`bgcolor="${LIGHT.footer}"`));
  assert.match(h, new RegExp(`<p style="[^"]*font-weight:800;[^"]*color:${LIGHT.wordmark};">Mayobe`));
  assert.match(h, /Clear, honest guides on education, jobs, money and technology for readers in Tanzania\./);
  assert.match(h, new RegExp(`<a href="https://mayobebros\\.com/privacy-policy/" style="color:${LIGHT.footerLink};text-decoration:underline;">Privacy policy</a>`));
  // dark block: page, card, border, header and text colours all switch
  for (const s of [`.mb-page{background:${DARK.page}!important}`, `background:${DARK.card}!important`, `border-color:${DARK.border}!important`, `.mb-head{background:${DARK.header}!important}`,
    `.mb-heading{color:${DARK.heading}!important}`, `.mb-body{color:${DARK.body}!important}`, `.mb-muted{color:${DARK.muted}!important}`, `.mb-kicker{color:${DARK.kicker}!important}`, `.mb-link{color:${DARK.link}!important}`]) {
    assert.ok(h.includes(s), s);
  }
});

test('the confirm email says the button opens a page with one more button and offers the copy-the-link fallback', () => {
  const o = T.confirmSubscriptionEmail(SHORT.confirmSubscriptionEmail, SITE);
  for (const s of ['The button opens a page on our website. Press Confirm my subscription there to finish.',
    'If the page does not open, copy the link below into your browser. If it still does not work, reply to this email and tell us.']) {
    assert.ok(o.html.includes(s), 'html: ' + s);
    assert.ok(o.text.includes(s), 'text: ' + s);
  }
  // the link comes right after the copy-the-link sentence, in html and in text
  assert.match(o.html, /reply to this email and tell us\.<br><a class="mb-link" href="https:\/\/mayobebros\.com\/newsletter\/#c"/);
  assert.ok(o.text.indexOf('copy the link below') < o.text.indexOf('https://mayobebros.com/newsletter/#c'));
  assert.equal(o.subject, 'Please confirm your Mayobe Bros subscription');
});

test('siteOf(env) gives the templates an https asset origin and the assets/email logo, also for a loopback SITE_ORIGIN', async () => {
  const { siteOf } = await import('../../worker/src/util.js');
  assert.deepEqual(siteOf({}), { origin: 'https://mayobebros.com', assetOrigin: 'https://mayobebros.com', logoUrl: 'https://mayobebros.com/assets/email/logo.png' });
  assert.deepEqual(siteOf({ SITE_ORIGIN: 'https://example.org/' }), { origin: 'https://example.org', assetOrigin: 'https://example.org', logoUrl: 'https://example.org/assets/email/logo.png' });
  assert.deepEqual(siteOf({ SITE_ORIGIN: 'http://127.0.0.1:8000' }), { origin: 'http://127.0.0.1:8000', assetOrigin: 'https://mayobebros.com', logoUrl: 'https://mayobebros.com/assets/email/logo.png' });
  // and what the templates make of it
  for (const env of [{}, { SITE_ORIGIN: 'http://127.0.0.1:8000' }, { SITE_ORIGIN: 'https://example.org' }]) assert.deepEqual(T.resolveSite(siteOf(env)), siteOf(env));
});

/* ------------------------------------------------------------------ article pictures (email redesign, Task 3) */

const imgTags = (html) => html.match(/<img\b[^>]*>/g) || [];
const srcOf = (t) => decode((t.match(/\ssrc="([^"]*)"/) || [, ''])[1]);
const altOf = (t) => decode((t.match(/\salt="([^"]*)"/) || [, ''])[1]);
// [href, inner html] of every <a>
const anchors = (html) => [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], m[2]]);
const PIC_CASES = () => [
  ['welcomeEmail', LONG.welcomeEmail], ['welcomeEmail', SHORT.welcomeEmail], ['newPostEmail', LONG.newPostEmail], ['newPostEmail', SHORT.newPostEmail],
  ['newPostEmail', { ...LONG.newPostEmail, post: { ...LONG.newPostEmail.post, video: undefined } }],
  ['welcomeEmail', { ...LONG.welcomeEmail, latestPosts: [POSTS[1], POSTS[0], POSTS[2]] }],
];

test('with every <img> removed, the heading, every post title, the button label and every link stay in the html', () => {
  for (const [name, data] of PIC_CASES()) {
    const o = T[name](data, SITE);
    const bare = o.html.replace(/<img\b[^>]*>/g, '');
    const heading = (bare.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1].replace(/<[^>]*>/g, '').trim();
    const want = name === 'welcomeEmail' ? 'You are subscribed' : T.esc(T.oneLine(data.post.title)).slice(0, 40);
    assert.ok(heading && heading.startsWith(want), `${name}: heading "${heading.slice(0, 60)}" is not live text starting "${want}"`);
    const titles = name === 'welcomeEmail' ? data.latestPosts.map((x) => x.title) : [data.post.title];
    for (const t of titles) assert.ok(bare.includes(T.esc(T.oneLine(t)).slice(0, 40)), `${name}: title ${t.slice(0, 30)}`);
    const label = o.html.match(/<a class="mb-btn-a"[^>]*>([^<]*)<\/a>/)[1];
    assert.ok(bare.includes(`>${label}</a>`), `${name}: button label`);
    // every address that is linked anywhere is still linked with visible text once the pictures are gone
    for (const [href] of anchors(o.html)) {
      assert.ok(anchors(bare).some(([h, inner]) => h === href && inner.replace(/<[^>]*>/g, '').trim()), `${name}: ${href} has no text link`);
    }
  }
});

test('every linked picture has the same href as a text link in the same email', () => {
  for (const name of BUILDERS) for (const data of [LONG[name], SHORT[name]]) {
    const o = T[name](data, SITE);
    const a = anchors(o.html);
    for (const [href, inner] of a.filter(([, inner]) => /^\s*<img\b/.test(inner))) {
      if (/alt="Mayobe Bros"/.test(inner)) continue; // the logo links home; the footer has the text link
      assert.ok(a.some(([h, x]) => h === href && !/<img\b/.test(x) && x.replace(/<[^>]*>/g, '').trim()), `${name}: picture link ${href} without a text link`);
    }
    // every picture beyond the logo is inside a link
    const linked = a.flatMap(([, inner]) => imgTags(inner));
    for (const t of imgTags(o.html)) assert.ok(linked.includes(t), `${name}: picture not linked: ${t.slice(0, 80)}`);
  }
});

test('pictures are dropped unless ownImage accepts them', () => {
  const bad = ['http://mayobebros.com/assets/email/post-a.jpg', 'https://evil.example/assets/email/post-a.jpg', 'https://mayobebros.com/assets/email/post-a.webp',
    'https://mayobebros.com/assets/email/post-a.svg', 'https://mayobebros.com/assets/email/post-a.gif', 'data:image/jpeg;base64,AA', '//evil.example/x.jpg',
    'https://mayobebros.com/assets/share/post-a.jpg', 'https://mayobebros.com/assets/email/post-a.jpg?v=1234567g', 'https://mayobebros.com/assets/email/post-a.jpg?t=abc'];
  for (const u of bad) {
    const posts = [0, 1, 2].map((i) => ({ title: `T${i}`, url: `https://mayobebros.com/post/p${i}/`, image: u, thumb: u, video: { image: u, url: `https://mayobebros.com/post/p${i}/#video-1` } }));
    const outs = [
      T.welcomeEmail({ unsubscribeUrl: 'https://mayobebros.com/u', latestPosts: posts }, SITE),
      T.newPostEmail({ post: { ...posts[0] }, unsubscribeUrl: 'https://mayobebros.com/u' }, SITE),
      T.newPostEmail({ post: { ...posts[0], video: undefined } }, SITE),
    ];
    for (const o of outs) {
      assert.equal(imgTags(o.html).length, 1, `${u}: ${imgTags(o.html).slice(1).join(' ')}`);
      assert.ok(!o.html.includes('evil.example') && !o.html.includes('/assets/share/') && !o.html.includes('data:image'), u);
      assert.deepEqual(lint(o, {}, { checkUrls: false, name: o.subject.startsWith('New') ? 'newPostEmail' : 'welcomeEmail' }), [], u);
    }
  }
  // a video link that is not ours drops the video, and the post picture is used instead
  const o = T.newPostEmail({ post: { title: 'T', url: 'https://mayobebros.com/post/p/', image: IMG('post', 'p'), video: { image: IMG('video', 'p'), url: 'https://evil.example/#video-1' } } }, SITE);
  assert.deepEqual(imgTags(o.html).slice(1).map(srcOf), [IMG('post', 'p')]);
  assert.ok(!o.html.includes('evil.example') && !/Watch the video/.test(o.html + o.text));
});

test('a video post shows one hero, the video picture, links it to #video-1 and says Watch the video in html and text', () => {
  const o = T.newPostEmail(LONG.newPostEmail, SITE);
  const pics = imgTags(o.html).slice(1);
  assert.equal(pics.length, 1, 'one hero');
  const hero = pics[0];
  assert.equal(srcOf(hero), IMG('video', 'y', '89abcdef'));
  for (const a of ['width="598"', 'height="336"']) assert.ok(hero.includes(a), a);
  assert.ok(hero.includes('max-width:620px') && hero.includes('width:100%'));
  assert.ok(altOf(hero).startsWith('Watch the video: '), altOf(hero));
  const vurl = LONG.newPostEmail.post.video.url;
  const a = anchors(o.html);
  assert.ok(a.some(([h, inner]) => decode(h) === vurl && inner.includes(hero)), 'the hero links to #video-1');
  assert.ok(a.some(([h, inner]) => decode(h) === vurl && inner.trim() === 'Watch the video'), 'a text link Watch the video');
  assert.ok(o.text.includes(`Watch the video: ${vurl}`));
  // the hero sits above the card body, before the kicker and the heading, in a slot with a background colour
  assert.ok(o.html.indexOf(hero) < o.html.indexOf('class="mb-kicker"') && o.html.indexOf(hero) < o.html.indexOf('<h1'));
  assert.match(o.html, new RegExp(`<td class="mb-img"[^>]*style="[^"]*background:${LIGHT.imageBg}`));
  // without a video: the post picture, linked to the article, alt from the data, no "Watch the video"
  const plainPost = T.newPostEmail({ ...LONG.newPostEmail, post: { ...LONG.newPostEmail.post, video: undefined } }, SITE);
  const h2 = imgTags(plainPost.html)[1];
  assert.equal(srcOf(h2), IMG('post', 'y'));
  assert.ok(anchors(plainPost.html).some(([h, inner]) => decode(h) === LONG.newPostEmail.post.url && inner.includes(h2)));
  assert.ok(!/Watch the video/.test(plainPost.html + plainPost.text));
  assert.ok(altOf(h2).length <= 150 && altOf(h2).startsWith('<script>'), 'alt is the (escaped) data, cut to 150');
  // no picture at all: no hero, and nothing else changes
  const none = T.newPostEmail({ ...LONG.newPostEmail, post: { ...LONG.newPostEmail.post, video: undefined, image: undefined } }, SITE);
  assert.equal(imgTags(none.html).length, 1);
  assert.ok(!none.html.includes('class="mb-img"'));
  assert.equal(none.text, plainPost.text);
  assert.equal(none.html.replace(/<tr><td class="mb-img"[\s\S]*?<\/td><\/tr>\n?/, ''), none.html);
});

test('welcome shows one lead picture and at most two thumbnails, in the order given', () => {
  const o = T.welcomeEmail(LONG.welcomeEmail, SITE);
  const pics = imgTags(o.html).slice(1);
  // POSTS[0] is the lead (its large picture), then the thumbnails of POSTS[1] (a video post) and POSTS[2]
  assert.deepEqual(pics.map(srcOf), [IMG('post', 'p1'), IMG('thumb', 'p2'), IMG('thumb', 'p3')]);
  assert.ok(pics[0].includes('width="518"') && pics[0].includes('height="291"'));
  for (const t of pics.slice(1)) assert.ok(t.includes('width="112"') && t.includes('height="84"'));
  assert.match(o.html, /LATEST ARTICLES/);
  assert.equal((o.html.match(/<h2\b/g) || []).length, 1, 'one lead title');
  assert.equal((o.html.match(/<h3\b/g) || []).length, 2, 'two row titles');
  // titles in order, each picture linked to its title's address
  const at = POSTS.map((x) => o.html.indexOf(`>${T.esc(T.oneLine(x.title))}</a>`));
  assert.ok(at.every((x) => x > 0) && at[0] < at[1] && at[1] < at[2], 'order kept');
  for (const [i, t] of pics.entries()) {
    const href = anchors(o.html).find(([, inner]) => inner.includes(t))[0];
    assert.equal(decode(href), POSTS[i].url);
  }
  // the video post says so on its category line; the text part carries its video link
  assert.match(o.html, /JOBS AND INTERNSHIPS · VIDEO/);
  assert.ok(o.text.includes(`Watch the video: ${POSTS[1].video.url}`));
  // a video post in the lead shows the video picture
  const lead = T.welcomeEmail({ ...LONG.welcomeEmail, latestPosts: [POSTS[1], POSTS[0], POSTS[2]] }, SITE);
  assert.deepEqual(imgTags(lead.html).slice(1).map(srcOf), [IMG('video', 'p2', '89abcdef'), IMG('thumb', 'p1'), IMG('thumb', 'p3')]);
  assert.ok(altOf(imgTags(lead.html)[1]).startsWith('Watch the video: '));
  // more than three posts: still three; no posts: no list and only the logo
  const many = T.welcomeEmail({ ...LONG.welcomeEmail, latestPosts: [...POSTS, ...POSTS] }, SITE);
  assert.equal(imgTags(many.html).length, 4);
  const empty = T.welcomeEmail({ unsubscribeUrl: 'https://mayobebros.com/u', latestPosts: [] }, SITE);
  assert.equal(imgTags(empty.html).length, 1);
  assert.ok(!/LATEST ARTICLES/.test(empty.html));
  assert.deepEqual(lint(empty, {}, { name: 'welcomeEmail' }), []);
});

/* ------------------------------------------------------------------ review fixes after Tasks 2-3 */

test('picture width attributes equal the cell they sit in (Outlook desktop uses the attribute); CSS lets them fill a phone', () => {
  const hero = imgTags(T.newPostEmail(LONG.newPostEmail, SITE).html)[1];
  // the hero spans the card's inner width: 600 minus the 1 px border on each side; on a phone the card is up to 620 px wide
  for (const a of ['width="598"', 'height="336"', 'width:100%', 'max-width:620px']) assert.ok(hero.includes(a), `hero ${a}`);
  const w = T.welcomeEmail(LONG.welcomeEmail, SITE).html;
  const lead = imgTags(w)[1];
  // the lead sits in the card body: 598 minus 40 px padding each side = 518; phones pad 28 px, so up to 620 - 56 = 564
  for (const a of ['width="518"', 'height="291"', 'width:100%', 'max-width:564px']) assert.ok(lead.includes(a), `lead ${a}`);
  assert.ok(!/max-width:520px/.test(w), 'the old 520 px cap is gone');
  assert.match(w, /<td class="mb-card"[^>]*padding:40px;/);
  assert.match(w, /@media \(max-width:620px\)\{[^\n]*\.mb-card\{padding:28px 28px 32px!important\}/);
  assert.match(w, /@media \(max-width:620px\)\{[^\n]*\.mb-frame\{border-width:0 0 1px!important/);
  assert.match(w, /<td class="mb-frame"[^>]*border:1px solid/);
  // the head carries the Outlook 96 dpi block and the Office namespace
  assert.ok(w.indexOf(MSO_DPI) > w.indexOf('<head>') && w.indexOf(MSO_DPI) < w.indexOf('</head>'));
});

test('a thumbnail is named by the post title; the hero and the lead keep the cover description; wide pictures indent their alt text', () => {
  const o = T.welcomeEmail(LONG.welcomeEmail, SITE);
  const [lead, ...thumbs] = imgTags(o.html).slice(1);
  assert.equal(altOf(lead), T.oneLine(POSTS[0].imageAlt).slice(0, 150));
  thumbs.forEach((t, i) => assert.equal(altOf(t), T.oneLine(POSTS[i + 1].title).slice(0, 160)));
  const hero = imgTags(T.newPostEmail({ ...LONG.newPostEmail, post: { ...LONG.newPostEmail.post, video: undefined } }, SITE).html)[1];
  assert.equal(altOf(hero), T.oneLine(LONG.newPostEmail.post.imageAlt).slice(0, 150));
  // with pictures blocked the alt text of a wide picture does not touch the left edge
  for (const t of [lead, hero]) assert.match(t, /text-indent:\d+px/);
});

test('footer links are a different colour from the footer text, so they read as links, and keep their underline', () => {
  assert.notEqual(LIGHT.footerLink.toLowerCase(), LIGHT.footerText.toLowerCase());
  assert.ok(contrast(LIGHT.footerLink, LIGHT.footer) >= 7, 'at least 7:1 on the footer');
  const r = T.confirmSubscriptionEmail({ confirmUrl: 'https://mayobebros.com/newsletter/#c=x' }, SITE);
  const links = [...r.html.matchAll(/<a href="[^"]*" style="color:([^;]+);text-decoration:underline;">(Visit Mayobe Bros|Privacy policy|Contact us)<\/a>/g)];
  assert.equal(links.length, 3);
  for (const m of links) assert.equal(m[1].toLowerCase(), LIGHT.footerLink.toLowerCase());
});
