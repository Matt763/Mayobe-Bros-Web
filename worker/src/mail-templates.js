// Every email the Worker sends, built from one small design system. Pure functions: each builder takes (data, site)
// and returns { subject, html, text }. Rules (checked by scripts/tests/email-templates.test.mjs): 600 px table layout,
// inline styles plus one <style> block (mobile padding and the dark-mode override only), hex colours from
// mail-tokens.js only, body 16 px / 1.6, nothing under 12 px, one button per email with the same link as text, a
// hidden 90-130 character preheader first in <body>, and every visitor value escaped. Subjects never carry CR/LF.
// Every builder is total: any input (wrong types, lone surrogates, control characters, huge strings) gives valid
// output and never throws.
//
// Who sees visitor text: emails to an address nobody has verified yet (manage link, contact confirmation, newsletter)
// carry only fixed text and our own article titles, never a visitor's name, comment, subject or message, so the
// forms cannot be used to send someone else's words to a stranger. Reply notices go only to addresses confirmed by
// opening the manage link, so they show the reply. Owner emails show everything, escaped.

import { LIGHT as L, DARK as D, FONT_SERIF, FONT_SANS } from './mail-tokens.js';

const DEFAULT_SITE = { origin: 'https://mayobebros.com', logoUrl: 'https://mayobebros.com/assets/img/icon-192.png' };
const NAME = 'Mayobe Bros';
// The site's own slogan, from site.config.json. Do not add claims here that the site does not make.
const SLOGAN = 'Clear, honest guides on education, jobs, money and technology for readers in Tanzania.';

/* ------------------------------------------------------------------ text helpers */
// Any value to a well-formed string: lone surrogates become U+FFFD, so encodeURIComponent and the mail API never throw.
function wellFormed(s) {
  if (typeof s.toWellFormed === 'function') return s.toWellFormed();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
    else if (c >= 0xd800 && c <= 0xdfff) out += '\ufffd';
    else out += s[i];
  }
  return out;
}
function str(v) {
  if (v === null || v === undefined) return '';
  let s;
  try { s = String(v); } catch { return ''; }
  return wellFormed(s);
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) { return str(s).replace(/[&<>"']/g, (c) => ESC[c]); }
// For anything that ends up in a subject, header or single line: no control characters (C0, DEL, NEL), no line or
// paragraph separators, no bidi overrides or isolates (they can disguise text). Each becomes a space.
const ONE_LINE_BAD = /[\x00-\x1f\x7f\x85\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;
export function oneLine(s) { return str(s).replace(ONE_LINE_BAD, ' ').replace(/[ ]{2,}/g, ' ').trim(); }
const cut = (v, n) => (v.length > n ? str(v.slice(0, n - 1)).trimEnd() + '…' : v); // str() repairs a pair split by slice
const clip = (s, n) => cut(oneLine(s), n);
// Text that may span lines (comments, replies, messages): line breaks become \n, other control and bidi characters a space.
const normText = (s) => str(s).replace(/\r\n?|\u2028|\u2029|\x85/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ');
const clipText = (s, n) => cut(normText(s).replace(/\n{3,}/g, '\n\n').trim(), n);
// Visitor text for the plain-text part: < > become look-alike angle quotes so the text part never holds anything tag-like.
const plain = (s) => normText(s).replace(/</g, '‹').replace(/>/g, '›');
const plainLine = (s, n = 200) => plain(clip(s, n));
// Visitor text for HTML that may span lines.
const multi = (s) => esc(normText(s).trim()).replace(/\n/g, '<br>');
// A long visitor text (message, comment) keeps up to TEXT_MAX characters. In HTML its escaped form may use at most
// HTML_BUDGET bytes, so the email stays under 40,000 bytes even when every character needs escaping; ordinary text
// of 5,000 characters fits whole. When it is cut, the HTML says so and the plain-text part still has all of it.
const TEXT_MAX = 5000, HTML_BUDGET = 14000;
const bytes = (s) => new TextEncoder().encode(s).length;
const longHtml = (s) => {
  const full = clipText(s, TEXT_MAX);
  let part = full;
  while (part.length > 1 && bytes(multi(part)) > HTML_BUDGET) part = clipText(part, Math.floor(part.length * 0.8));
  return multi(part) + (part !== full ? '<br><br><em>This text was cut short here. The plain-text version of this email has all of it.</em>' : '');
};
// Every link we write points at our own site: same scheme and host as the site origin (compared by the URL parser, so
// case-insensitively), at most 500 characters, no spaces or control characters. Anything else uses the fallback.
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const ownUrl = (u, origin, fallback) => {
  const s = str(u).trim();
  if (!s || s.length > 500 || /[\x00-\x20\x7f]/.test(s) || !/^https?:\/\//i.test(s)) return fallback;
  return originOf(s) !== '' && originOf(s) === originOf(origin) ? s : fallback;
};
const siteOf = (site) => {
  const o = str(site?.origin).trim().replace(/\/+$/, '');
  const origin = /^https:\/\//i.test(o) && originOf(o) && o.length <= 200 && !/[\x00-\x20\x7f]/.test(o) ? originOf(o) : DEFAULT_SITE.origin;
  const logo = str(site?.logoUrl).trim();
  const logoUrl = /^https:\/\//i.test(logo) && originOf(logo) && logo.length <= 500 && !/[\x00-\x20\x7f]/.test(logo) ? logo : DEFAULT_SITE.logoUrl;
  return { origin, logoUrl };
};
const obj = (d) => (d && typeof d === 'object' ? d : {});

/* ------------------------------------------------------------------ components */
const SANS = `font-family:${FONT_SANS};`;
const SERIF = `font-family:${FONT_SERIF};`;

export function p(html, { muted = false, size = 16, mb = 16 } = {}) {
  const cls = muted ? 'mb-muted' : 'mb-body';
  return `<p class="${cls}" style="margin:0 0 ${mb}px;${SANS}font-size:${size}px;line-height:1.6;color:${muted ? L.muted : L.body};">${html}</p>`;
}
export function h1(html) {
  return `<h1 class="mb-h1 mb-heading" style="margin:0 0 24px;${SERIF}font-size:28px;line-height:1.3;font-weight:normal;color:${L.heading};">${html}</h1>`;
}
// Small label above the heading. Typed in capitals here (no text-transform), letter-spaced, dark gold.
export function eyebrow(text) {
  return `<p class="mb-gold" style="margin:0 0 16px;${SANS}font-size:12px;line-height:1.5;font-weight:bold;letter-spacing:2px;color:${L.gold};">${esc(str(text).toUpperCase())}</p>`;
}
export function link(url, label, extra = '') {
  return `<a class="mb-link" href="${esc(url)}" style="color:${L.link};text-decoration:underline;${extra}">${label}</a>`;
}
// The one primary button: a bgcolor cell wrapping a padded link, 14 + 20 + 14 = 48 px tall. Outlook's Word engine
// ignores padding on the inline <a>, so the cell carries the same padding as mso-padding-alt.
export function button(url, label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td class="mb-btn" bgcolor="${L.button}" style="background:${L.button};border-radius:4px;mso-padding-alt:14px 32px;">`
    + `<a class="mb-btn-a" href="${esc(url)}" style="display:inline-block;padding:14px 32px;${SANS}font-size:16px;line-height:20px;font-weight:bold;color:${L.buttonText};text-decoration:none;border-radius:4px;">${esc(label)}</a>`
    + '</td></tr></table>';
}
// The same address as a plain text link under the button, for clients that hide or break buttons.
function fallback(url, shown) {
  const lead = url.startsWith('mailto:') ? 'Or write to:' : 'If the button does not work, open this link:';
  return p(`${lead}<br>${link(url, esc(shown || url), 'word-break:break-all;')}`, { muted: true, size: 14, mb: 24 });
}
// Quoted visitor text (a reply, a message) with a thin gold rule on the left.
export function quote(html, cite = '') {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td class="mb-quote mb-body" bgcolor="${L.quote}" style="background:${L.quote};border-left:2px solid ${L.gold};padding:16px 24px;${SANS}font-size:16px;line-height:1.6;color:${L.body};word-break:break-word;">`
    + (cite ? `<p class="mb-muted" style="margin:0 0 8px;${SANS}font-size:14px;line-height:1.5;font-weight:bold;color:${L.muted};">${cite}</p>` : '')
    + html + '</td></tr></table>';
}
export function hairline(mb = 24) {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 ${mb}px;"><tr><td class="mb-rule" style="border-top:1px solid ${L.rule};height:1px;line-height:1px;">&nbsp;</td></tr></table>`;
}
// Label / value rows (owner emails). Values arrive already escaped.
function details(rows) {
  const tr = rows.filter(([, v]) => v).map(([k, v]) => `<tr><td class="mb-muted mb-rule" style="padding:8px 16px 8px 0;border-top:1px solid ${L.rule};width:112px;vertical-align:top;${SANS}font-size:14px;line-height:1.6;font-weight:bold;color:${L.muted};">${esc(k)}</td>`
    + `<td class="mb-body mb-rule" style="padding:8px 0;border-top:1px solid ${L.rule};vertical-align:top;${SANS}font-size:16px;line-height:1.6;color:${L.body};word-break:break-word;">${v}</td></tr>`).join('');
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${tr}</table>`;
}
const signoff = () => p('The Mayobe Bros team', { mb: 0 });

// Quiet dark footer: wordmark, the site's slogan, why this email came, then each link on its own line.
export function footer(why, links) {
  const ln = links.map(([label, url]) => `<p style="margin:0 0 8px;${SANS}font-size:14px;line-height:1.6;"><a href="${esc(url)}" style="color:${L.footerLink};text-decoration:underline;">${esc(label)}</a></p>`).join('');
  return `<p style="margin:0 0 8px;${SERIF}font-size:18px;line-height:1.3;color:${L.wordmark};">${NAME}</p>`
    + `<p style="margin:0 0 16px;${SANS}font-size:14px;line-height:1.6;color:${L.footerText};">${SLOGAN}</p>`
    + `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="border-top:1px solid ${L.footerRule};height:1px;line-height:1px;">&nbsp;</td></tr></table>`
    + `<p style="margin:0 0 16px;${SANS}font-size:14px;line-height:1.6;color:${L.footerText};">${esc(why)}</p>` + ln;
}

const PREHEADER_FILL = '&#847;&zwnj;&nbsp;'.repeat(30);
const CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
@media (max-width:620px){.mb-wrap{width:100%!important}.mb-outer{padding:0!important}.mb-card{padding:32px 24px!important}.mb-head{padding:20px 24px!important}.mb-foot{padding:32px 24px!important}.mb-h1{font-size:26px!important}}
@media (prefers-color-scheme: dark){.mb-page{background:${D.page}!important}.mb-card{background:${D.card}!important}.mb-heading{color:${D.heading}!important}.mb-body{color:${D.body}!important}.mb-muted{color:${D.muted}!important}.mb-gold{color:${D.gold}!important}.mb-link{color:${D.link}!important}.mb-btn{background:${D.button}!important}.mb-btn-a{color:${D.buttonText}!important}.mb-quote{background:${D.quote}!important;border-left-color:${D.gold}!important}.mb-rule{border-color:${D.rule}!important}}`;

export function shell({ title, preheader, bodyHtml, footerHtml, site }) {
  const s = siteOf(site);
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body class="mb-page" style="margin:0;padding:0;background:${L.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">${esc(preheader)}${PREHEADER_FILL}</div>
<table role="presentation" class="mb-page" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${L.page}" style="background:${L.page};"><tr><td class="mb-outer" align="center" style="padding:32px 16px;">
<table role="presentation" class="mb-wrap" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
<tr><td class="mb-head" bgcolor="${L.header}" style="background:${L.header};padding:24px 40px;border-bottom:2px solid ${L.hairline};">
<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
<td bgcolor="${L.tile}" width="44" height="44" align="center" valign="middle" style="background:${L.tile};width:44px;height:44px;border-radius:6px;"><img src="${esc(s.logoUrl)}" width="34" height="34" alt="" style="display:block;border:0;width:34px;height:34px;"></td>
<td style="padding:0 0 0 16px;${SERIF}font-size:22px;line-height:1.2;letter-spacing:0.5px;color:${L.wordmark};">${NAME}</td>
</tr></table>
</td></tr>
<tr><td class="mb-card" bgcolor="${L.card}" style="background:${L.card};padding:40px;word-break:break-word;">
${bodyHtml}
</td></tr>
<tr><td class="mb-foot" bgcolor="${L.footer}" style="background:${L.footer};padding:32px 40px;">
${footerHtml}
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

// Plain-text part: hand-written lines, then the same footer facts.
function textPart(lines, why, links, origin) {
  const body = lines.filter((l) => l !== null && l !== undefined).join('\n\n');
  return `${body}\n\n--\n${NAME}\n${origin}\n\n${why}\n${links.map(([label, url]) => `${label}: ${url}`).join('\n')}\n`;
}
const quoteText = (s) => plain(s).trim().split('\n').map((l) => `> ${l}`).join('\n');

function build({ site, subject, title, preheader, eyebrowText, heading, html, text, buttonUrl, buttonShown, buttonLabel, why, links }) {
  const s = siteOf(site);
  const bodyHtml = eyebrow(eyebrowText) + h1(heading) + html.before + button(buttonUrl, buttonLabel) + fallback(buttonUrl, buttonShown) + (html.after || '') + hairline() + signoff();
  const textLines = [heading.text, ...text.before, `${buttonLabel}:\n${buttonUrl}`, ...(text.after || []), 'The Mayobe Bros team'];
  return {
    subject: clip(subject, 140),
    html: shell({ title: title || clip(subject, 140), preheader: clip(preheader, 130), bodyHtml, footerHtml: footer(why, links), site: s }),
    text: textPart(textLines.map((l) => (typeof l === 'string' ? l : l?.text)), why, links, s.origin),
  };
}
const H = (htmlStr, textStr) => Object.assign(String(htmlStr), { text: textStr });
const commonLinks = (o) => [['Visit Mayobe Bros', `${o}/`], ['Privacy policy', `${o}/privacy-policy/`], ['Contact us', `${o}/contact/`]];
// mailto: only plain address characters stay as they are; everything else is percent-encoded so it cannot add a
// header field, a second address or a query to the link.
// encodeURIComponent leaves ! ' ( ) * ~ as they are, so those are encoded by hand (input is already well-formed).
const pct = (s) => encodeURIComponent(s).replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const mailto = (addr, subject) => `mailto:${oneLine(addr).replace(/[^A-Za-z0-9@._+-]/g, pct)}?subject=${pct(clip(subject, 120))}`;

/* ------------------------------------------------------------------ comment emails */

// Sent to an address that has not been verified: only our article title and fixed text. data.name and
// data.commentExcerpt are accepted for compatibility and deliberately not shown.
export function manageLinkEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const manageUrl = ownUrl(d.manageUrl, origin, `${origin}/`);
  const postUrl = ownUrl(d.postUrl, origin, `${origin}/`);
  const title = clip(d.postTitle, 160) || 'an article';
  const notice = d.notifyWanted
    ? 'You also asked us to tell you about replies. Opening the link turns that on. We send at most one email a day for this comment, and every one has a link to stop them.'
    : null;
  const ignore = 'If you did not comment on Mayobe Bros, you can ignore this email. We send nothing more about this comment unless the link is opened.';
  const how = 'The button opens a page where you can change your comment or delete it. The link works for 7 days, on this device or another one. Please do not forward this email: anyone with the link can change this comment.';
  return build({
    site, subject: 'Your link to edit or delete your comment',
    preheader: 'Use the link inside to edit or delete the comment you left on Mayobe Bros. It works for 7 days on any device.',
    eyebrowText: 'Your comment', heading: H('Edit or delete your comment', 'EDIT OR DELETE YOUR COMMENT'),
    html: {
      before: p('Hello,') + p(`You asked for a link to manage a comment you left on ${link(postUrl, esc(title))}.`) + p(esc(how)),
      after: (notice ? p(esc(notice)) : '') + p(esc(ignore), { muted: true }),
    },
    text: { before: ['Hello,', `You asked for a link to manage a comment you left on "${plain(title)}":\n${postUrl}`, how.replace('The button opens', 'The link below opens')], after: [notice, ignore] },
    buttonUrl: manageUrl, buttonLabel: 'Manage my comment',
    why: 'You got this email because this address was typed into the comment form on mayobebros.com with a request for a link to manage the comment.',
    links: [['Comment policy', `${origin}/comment-policy/`], ...commonLinks(origin)],
  });
}

// Sent only to addresses confirmed by opening the manage link, so the reply (escaped) is shown.
export function replyNoticeEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const postUrl = ownUrl(d.postUrl, origin, `${origin}/`);
  const unsub = ownUrl(d.unsubscribeUrl, origin, `${origin}/contact/`);
  const title = clip(d.postTitle, 160) || 'an article';
  const greet = oneLine(d.name) ? `Hi ${clip(d.name, 60)},` : 'Hello,';
  const who = d.isTeam ? 'The Mayobe Bros team' : (clip(d.replyAuthor, 60) || 'A reader');
  return build({
    site, subject: d.isTeam ? 'The Mayobe Bros team replied to your comment' : 'New reply to your comment on Mayobe Bros',
    preheader: d.isTeam
      ? 'The Mayobe Bros team replied to the comment you left on our site. Read the reply here, or open the article to answer.'
      : 'Someone replied to the comment you left on Mayobe Bros. Read the reply here, or open the article to answer it.',
    eyebrowText: 'New reply', heading: H(d.isTeam ? 'The team replied to your comment' : 'New reply to your comment', d.isTeam ? 'THE TEAM REPLIED TO YOUR COMMENT' : 'NEW REPLY TO YOUR COMMENT'),
    html: {
      before: p(esc(greet)) + p(`${esc(who)} replied to your comment on ${link(postUrl, esc(title))}:`)
        + quote(multi(clipText(d.replyBody, 1200)), `${esc(who)} wrote:`),
      after: p('We send at most one of these emails a day for each comment. To stop them, use the link at the bottom of this email.', { muted: true }),
    },
    text: {
      before: [plain(greet), `${plain(who)} replied to your comment on "${plain(title)}":`, quoteText(clipText(d.replyBody, 1200))],
      after: ['We send at most one of these emails a day for each comment. To stop them, use the "Stop reply emails" link below.'],
    },
    buttonUrl: postUrl, buttonLabel: 'Read the reply',
    why: 'You got this email because you asked to hear about replies to your comment on mayobebros.com.',
    links: [['Stop reply emails', unsub], ...commonLinks(origin)],
  });
}

const ALERTS = {
  held: {
    subject: (d) => `Comment held for review (#${clip(d.commentId, 20)})`,
    preheader: 'A new comment was held by the automatic screen and is waiting for you. The reason and the full text are inside.',
    eyebrow: 'Moderation', heading: 'A comment is waiting for review',
    lead: () => 'The automatic screen held this comment, so it is not on the site yet. To approve or remove it, run node scripts/comments.mjs list on your computer.',
  },
  question: {
    subject: (d) => `New reader question on ${clip(d.postSlug, 80) || 'an article'}`,
    preheader: 'A reader asked a question in the comments. The question and a link to the article are inside, ready for a reply.',
    eyebrow: 'Reader question', heading: 'A reader asked a question',
    lead: () => 'This comment looks like a question. After you reply as the team, run node scripts/qa-sync.mjs so the answer is saved into the page.',
  },
  'contact-failed': {
    subject: () => 'A contact message could not be emailed to you',
    preheader: 'A message sent through the contact form could not be emailed to you. What the visitor wrote and their address are inside.',
    eyebrow: 'Delivery problem', heading: 'A contact message did not reach you',
    lead: (hasEmail) => `A message sent through the contact form could not be emailed to you. What the visitor wrote is below.${hasEmail ? ' To answer, reply to the address shown.' : ''}`,
  },
};

// Owner only: full content, escaped. data.email is used by kind 'contact-failed' (the visitor's address).
export function ownerAlertEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const kind = Object.prototype.hasOwnProperty.call(ALERTS, d.kind) ? d.kind : 'held';
  const a = ALERTS[kind];
  const postUrl = ownUrl(d.postUrl, origin, '');
  const email = kind === 'contact-failed' ? clip(d.email, 254) : '';
  const lead = a.lead(!!email);
  const rows = [['Reason', clip(d.reason, 300)], ['Article', clip(d.postSlug, 200)], ['Comment ID', clip(d.commentId, 20)], ['Name', clip(d.name, 120)], ['Email', email]];
  const body = clipText(d.body, TEXT_MAX);
  const btn = email ? { buttonUrl: mailto(email, 'Re: your message to Mayobe Bros'), buttonShown: email, buttonLabel: 'Reply to the visitor' }
    : { buttonUrl: postUrl || `${origin}/`, buttonLabel: postUrl ? 'Open the article' : 'Open the website' };
  return build({
    site, subject: a.subject(d), preheader: a.preheader, eyebrowText: a.eyebrow, heading: H(esc(a.heading), a.heading.toUpperCase()),
    html: { before: p(esc(lead)) + details(rows.map(([k, v]) => [k, esc(v)])) + (body ? quote(longHtml(body), 'What they wrote:') : '') },
    text: {
      before: [lead, rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${plain(v)}`).join('\n') || null,
        body ? `What they wrote:\n${quoteText(body)}` : null, postUrl && email ? `Article: ${postUrl}` : null],
    },
    ...btn,
    why: 'You got this alert because this address is set as OWNER_EMAIL for the Mayobe Bros comments Worker.',
    links: [['Visit Mayobe Bros', `${origin}/`], ['Comment policy', `${origin}/comment-policy/`]],
  });
}

/* ------------------------------------------------------------------ contact form */

const CONTACT_TYPES = {
  general: 'General question', support: 'Technical support', technical: 'Technical issue', advertising: 'Advertising',
  editorial: 'Editorial feedback', partnership: 'Partnership', press: 'Press and media', other: 'Other',
};
const typeLabel = (t) => (typeof t === 'string' && Object.prototype.hasOwnProperty.call(CONTACT_TYPES, t) ? CONTACT_TYPES[t] : (oneLine(t) ? 'Other' : 'General question'));
const when = (v) => {
  if (v === undefined || v === null || v === '') return '';
  const t = typeof v === 'number' || v instanceof Date ? new Date(v) : new Date(str(v));
  return Number.isNaN(t.getTime()) ? clip(v, 40) : t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
};

// Owner only: the full message, escaped. reply_to is set to the visitor by the sender (Task 6).
export function contactOwnerEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const subj = clip(d.subject, 120) || '(no subject)';
  const type = typeLabel(d.type);
  const email = clip(d.email, 254);
  const rows = [['Name', clip(d.name, 120)], ['Email', email], ['Subject', subj], ['Type', type], ['Received', when(d.receivedAt)]];
  const lead = 'Someone sent a message through the contact form. Their details and message are below.';
  const tip = 'Pressing Reply in your mail app also works: the reply goes straight to the visitor.';
  const message = clipText(d.message, TEXT_MAX);
  return build({
    site, subject: `Contact form (${type}): ${clip(d.subject, 90) || '(no subject)'}`,
    preheader: 'Someone sent a message through the contact form on mayobebros.com. Press Reply in your mail app to answer them.',
    eyebrowText: `Contact form · ${type}`, heading: H('New message from the contact form', 'NEW MESSAGE FROM THE CONTACT FORM'),
    html: {
      before: p(esc(lead)) + details(rows.map(([k, v]) => [k, esc(v)])) + quote(longHtml(message), 'Message:'),
      after: p(esc(tip), { muted: true }),
    },
    text: { before: [lead, rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${plain(v)}`).join('\n'), `Message:\n${quoteText(message)}`], after: [tip] },
    buttonUrl: mailto(email, `Re: ${clip(d.subject, 100) || 'Your message to Mayobe Bros'}`), buttonShown: email || '(no address)', buttonLabel: 'Reply to this message',
    why: 'You got this email because someone sent a message through the contact form on mayobebros.com.',
    links: [['Visit Mayobe Bros', `${origin}/`], ['Contact page', `${origin}/contact/`]],
  });
}

// Sent to an address that has not been verified: fixed text only. No name, subject, type or message is echoed.
export function contactVisitorEmail(data, site) {
  const { origin } = siteOf(site);
  const lines = [
    'Hello,',
    'Your message reached us.',
    'We read every message and will reply to the address you gave us. If you do not see our reply, please check your spam folder.',
  ];
  const privacy = 'For your privacy, this email does not repeat your message.';
  const wait = 'While you wait, you are welcome to read our latest articles.';
  return build({
    site, subject: 'We received your message',
    preheader: 'Thank you for writing to Mayobe Bros. Your message reached us, and we will reply to the address you gave us.',
    eyebrowText: 'Message received', heading: H('Thank you for your message', 'THANK YOU FOR YOUR MESSAGE'),
    html: { before: lines.map((l) => p(esc(l))).join('') + p(esc(privacy), { muted: true }) + p(esc(wait)) },
    text: { before: [...lines, privacy, wait] },
    buttonUrl: `${origin}/post/`, buttonLabel: 'Read the latest articles',
    why: 'You got this email because this address was entered in the contact form on mayobebros.com. If that was not you, you can ignore it.',
    links: commonLinks(origin),
  });
}

/* ------------------------------------------------------------------ newsletter (sent by Plan 3; never visitor text) */

export function confirmSubscriptionEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const url = ownUrl(d.confirmUrl, origin, `${origin}/`);
  const a = 'Someone, we hope you, asked to get new Mayobe Bros articles by email at this address. Press the button to confirm.';
  const b = 'We will not send you any newsletter email until you confirm. If you did not ask for this, ignore this email and nothing more will be sent.';
  return build({
    site, subject: 'Please confirm your Mayobe Bros subscription',
    preheader: 'Please confirm that you want new Mayobe Bros articles by email. Nothing will be sent until you press the button.',
    eyebrowText: 'Newsletter', heading: H('Confirm your subscription', 'CONFIRM YOUR SUBSCRIPTION'),
    html: { before: p(esc(a)), after: p(esc(b), { muted: true }) },
    text: { before: [a], after: [b] },
    buttonUrl: url, buttonLabel: 'Confirm my subscription',
    why: 'You got this email because this address was entered in the newsletter form on mayobebros.com.',
    links: commonLinks(origin),
  });
}

// latestPosts = [{ title, url, excerpt? }] from the site's own data (search.json); at most 3 are shown.
export function welcomeEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const unsub = ownUrl(d.unsubscribeUrl, origin, `${origin}/contact/`);
  const posts = (Array.isArray(d.latestPosts) ? d.latestPosts : [])
    .map((x) => ({ title: clip(x?.title, 160), url: ownUrl(x?.url, origin, ''), excerpt: clip(x?.excerpt, 220) }))
    .filter((x) => x.title && x.url).slice(0, 3);
  const a = 'Thank you for confirming. When we publish a new article, we will send you one short email about it.';
  const b = 'We write clear, honest guides on education, jobs, money and technology for readers in Tanzania.';
  const c = 'You can stop at any time with the unsubscribe link at the bottom of every email.';
  const list = posts.length
    ? p('<strong>Recent articles</strong>', { mb: 8 }) + `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">`
      + posts.map((x) => `<tr><td class="mb-rule" style="padding:16px 0;border-top:1px solid ${L.rule};">`
        + `<p style="margin:0 0 8px;${SERIF}font-size:18px;line-height:1.4;">${link(x.url, esc(x.title))}</p>`
        + (x.excerpt ? p(esc(x.excerpt), { muted: true, size: 15, mb: 0 }) : '') + '</td></tr>').join('') + '</table>'
    : '';
  return build({
    site, subject: 'Welcome to the Mayobe Bros newsletter',
    preheader: 'You are now subscribed to Mayobe Bros. We will email you when a new article is published, and you can stop any time.',
    eyebrowText: 'Welcome', heading: H('You are subscribed', 'YOU ARE SUBSCRIBED'),
    html: { before: p(esc(a)) + p(esc(b)) + list, after: p(esc(c), { muted: true }) },
    text: { before: [a, b, posts.length ? 'Recent articles:\n\n' + posts.map((x) => `${plain(x.title)}\n${x.url}`).join('\n\n') : null], after: [c] },
    buttonUrl: `${origin}/post/`, buttonLabel: 'Read the latest articles',
    why: 'You got this email because you confirmed a subscription to new articles from mayobebros.com.',
    links: [['Unsubscribe', unsub], ...commonLinks(origin)],
  });
}

// post = { title, url, excerpt?, image? (same-origin https URL of the 1200 x 630 share card), imageAlt?, category? }
export function newPostEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const post = obj(d.post);
  const url = ownUrl(post.url, origin, `${origin}/`);
  const unsub = ownUrl(d.unsubscribeUrl, origin, `${origin}/contact/`);
  const title = clip(post.title, 200) || 'A new article';
  const excerpt = clip(post.excerpt, 400);
  const image = ownUrl(post.image, origin, '');
  const pre = clip(post.excerpt, 130);
  const c = 'You can stop these emails at any time with the unsubscribe link below.';
  return build({
    site, subject: `New article: ${clip(post.title, 110) || 'Mayobe Bros'}`,
    preheader: pre.length >= 90 ? pre : 'A new article is on Mayobe Bros. Read the short summary here, then open the full article when you are ready.',
    eyebrowText: oneLine(post.category) ? `New article · ${clip(post.category, 40)}` : 'New article', heading: H(esc(title), plain(title)),
    html: {
      before: (image ? `<img src="${esc(image)}" width="520" height="273" alt="${esc(clip(post.imageAlt, 200))}" style="display:block;border:0;width:100%;max-width:520px;height:auto;margin:0 0 24px;">` : '')
        + (excerpt ? p(esc(excerpt)) : ''),
      after: p(esc(c), { muted: true }),
    },
    text: { before: [excerpt ? plain(excerpt) : null], after: [c] },
    buttonUrl: url, buttonLabel: 'Read the article',
    why: 'You got this email because you subscribed to new articles from mayobebros.com.',
    links: [['Unsubscribe', unsub], ...commonLinks(origin)],
  });
}

export function farewellEmail(data, site) {
  const d = obj(data);
  const { origin } = siteOf(site);
  const url = ownUrl(d.resubscribeUrl, origin, `${origin}/`);
  const a = 'We have removed this address from our newsletter list. This is the last newsletter email we will send to it.';
  const b = 'If you unsubscribed by mistake, you can subscribe again with the button below. Thank you for reading Mayobe Bros.';
  return build({
    site, subject: 'You have unsubscribed from Mayobe Bros',
    preheader: 'You have been unsubscribed from the Mayobe Bros newsletter. This is the last newsletter email we will send to you.',
    eyebrowText: 'Newsletter', heading: H('You are unsubscribed', 'YOU ARE UNSUBSCRIBED'),
    html: { before: p(esc(a)) + p(esc(b)) },
    text: { before: [a, b] },
    buttonUrl: url, buttonLabel: 'Subscribe again',
    why: 'You got this email to confirm that this address was unsubscribed from the Mayobe Bros newsletter.',
    links: commonLinks(origin),
  });
}
