// Lints every email template (worker/src/mail-templates.js) against the email design rules in the Resend plan:
// structure, forbidden CSS, minimum sizes, token-only colours, WCAG contrast, preheader length, escaping of hostile
// visitor input, one primary button, and a clean plain-text part. Each builder runs with long hostile data and with
// short data, so the rules hold as copy gets longer or shorter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, PAIRS, DECORATIVE, TOKEN_HEX, LIGHT, DARK } from '../../worker/src/mail-tokens.js';
import * as T from '../../worker/src/mail-templates.js';

const SITE = { origin: 'https://mayobebros.com', logoUrl: 'https://mayobebros.com/assets/img/icon-192.png' };

// Hostile pieces: markup, both quote kinds, an ampersand and a header-injection attempt.
const EVIL = `<script>alert(1)</script> "quoted" 'single' & <b>bold</b>\r\nBcc: x@y.z`;
const NAME = (`"Ann" <script>alert(1)</script> 'O'Neil' &\r\nBcc: x@y.z ` + 'n'.repeat(200)).slice(0, 120);
const MSG = (EVIL + '\n\n' + 'This is a long message line. '.repeat(80)).slice(0, 2000);
const U = (p) => `https://mayobebros.com/${p}?a=1&b=2`; // links are emitted normalised (new URL().href), so test URLs are already normal
const POSTS = [1, 2, 3].map((i) => ({ title: `${EVIL} title ${i}`, url: U(`post/x/p${i}/`), excerpt: MSG.slice(0, 300) }));

const LONG = {
  manageLinkEmail: { name: NAME, commentExcerpt: MSG, postTitle: EVIL + ' ' + 'Long title '.repeat(10), postUrl: U('post/a/b/'), manageUrl: U('manage/') + '#tok', notifyWanted: true },
  replyNoticeEmail: { name: NAME, postTitle: EVIL, postUrl: U('post/a/b/'), replyAuthor: NAME, replyBody: MSG, unsubscribeUrl: U('v1/notify/unsubscribe'), isTeam: false },
  ownerAlertEmail: { reason: EVIL, postSlug: 'slug-' + EVIL, postUrl: U('post/a/b/'), commentId: 42, name: NAME, body: MSG, kind: 'held' },
  contactOwnerEmail: { name: NAME, email: 'ann.o+test@example.com', subject: EVIL + ' ' + 'subject '.repeat(30), message: MSG, type: 'technical', receivedAt: Date.UTC(2026, 10, 6, 14, 5) },
  contactVisitorEmail: { name: NAME, subject: EVIL + ' ' + 'subject '.repeat(30), type: 'general' },
  confirmSubscriptionEmail: { confirmUrl: U('newsletter/') + '#confirm' },
  welcomeEmail: { unsubscribeUrl: U('v1/newsletter/unsubscribe'), latestPosts: POSTS },
  newPostEmail: { post: { title: EVIL + ' ' + 'Long title '.repeat(12), url: U('post/x/y/'), excerpt: MSG.slice(0, 400), image: 'https://mayobebros.com/assets/share/post-y.jpg', imageAlt: EVIL, category: 'Educational' }, unsubscribeUrl: U('v1/newsletter/unsubscribe') },
  farewellEmail: { resubscribeUrl: U('newsletter/') },
};
const SHORT = {
  manageLinkEmail: { name: 'Jo', commentExcerpt: 'Nice.', postTitle: 'Loans', postUrl: 'https://mayobebros.com/post/a/', manageUrl: 'https://mayobebros.com/manage/#t', notifyWanted: false },
  replyNoticeEmail: { name: '', postTitle: 'Loans', postUrl: 'https://mayobebros.com/post/a/', replyAuthor: 'Mayobe Bros', replyBody: 'Yes.', unsubscribeUrl: 'https://mayobebros.com/u', isTeam: true },
  ownerAlertEmail: { reason: 'link', postSlug: 'a', postUrl: 'https://mayobebros.com/post/a/', commentId: 1, name: 'Jo', body: 'Hi?', kind: 'question' },
  contactOwnerEmail: { name: 'Jo', email: 'jo@example.com', subject: '', message: 'Hi', type: '', receivedAt: '2026-11-06T10:00:00Z' },
  contactVisitorEmail: { name: '', subject: '', type: 'technical' },
  confirmSubscriptionEmail: { confirmUrl: 'https://mayobebros.com/newsletter/#c' },
  welcomeEmail: { unsubscribeUrl: 'https://mayobebros.com/u', latestPosts: [] },
  newPostEmail: { post: { title: 'Loans', url: 'https://mayobebros.com/post/a/', excerpt: '' }, unsubscribeUrl: 'https://mayobebros.com/u' },
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

function lint(out, data, { checkUrls = true } = {}) {
  const errs = [];
  const { subject, html, text } = out;
  const n = (re) => (html.match(re) || []).length;
  // structure
  if (n(/<h1[\s>]/g) !== 1) errs.push(`h1 count ${n(/<h1[\s>]/g)}`);
  if (!/<html lang="en"/.test(html)) errs.push('no html lang');
  if (!/<title>[^<]+<\/title>/.test(html)) errs.push('no title');
  for (const t of html.match(/<table\b[^>]*>/g) || []) if (!/role="presentation"/.test(t)) errs.push('table without role: ' + t);
  for (const t of html.match(/<img\b[^>]*>/g) || []) if (!/\salt="/.test(t) || !/\swidth="\d+"/.test(t) || !/\sheight="\d+"/.test(t)) errs.push('img attrs: ' + t);
  if (!html.includes('<meta name="color-scheme" content="light dark">')) errs.push('color-scheme meta');
  if (!html.includes('<meta name="supported-color-schemes" content="light dark">')) errs.push('supported-color-schemes meta');
  if (!/@media \(prefers-color-scheme: dark\)/.test(html)) errs.push('no dark block');
  if (n(/<style[\s>]/g) !== 1) errs.push('style blocks ' + n(/<style[\s>]/g));
  // forbidden
  const low = html.toLowerCase();
  for (const bad of ['rgba(', 'gradient', 'box-shadow', 'background-image', '<svg', '@import', '@font-face', '<script']) if (low.includes(bad)) errs.push('forbidden ' + bad);
  const styleAttrs = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]);
  const styleBlock = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];
  for (const s of [...styleAttrs, styleBlock]) if (/url\(/i.test(s)) errs.push('url( in style');
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
      assert.deepEqual(lint(out, {}, { checkUrls: false }), [], `${name} with ${typeof w === 'string' ? JSON.stringify(w.slice(0, 20)) : String(w)}`);
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
      assert.deepEqual(lint(out, {}, { checkUrls: false }), [], name);
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
  for (const mode of ['light', 'dark']) for (const role of ['heading', 'body', 'muted', 'gold', 'link', 'button']) {
    assert.ok(PAIRS.some((p) => p[3].startsWith(mode) && p[3].includes(role)), `missing ${mode} ${role} pair in: ${labels}`);
  }
  for (const role of ['footer text', 'footer link', 'wordmark']) assert.ok(PAIRS.some((p) => p[3].includes(role)), 'missing ' + role);
  assert.ok(DECORATIVE.length > 0 && DECORATIVE.every((d) => d.length === 3), 'decorative colours are listed with a reason');
  assert.equal(LIGHT.page, '#f4f1ea');
  assert.equal(DARK.card, '#172131');
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
      assert.deepEqual(lint(out, data), []);
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
  assert.match(out.html, /https:\/\/mayobebros\.com\/assets\/img\/icon-192\.png/);
});
