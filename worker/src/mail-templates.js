// Every email the Worker sends, built from one small design system. Pure functions: each builder takes (data, site)
// and returns { subject, html, text }. Rules (checked by scripts/tests/email-templates.test.mjs): 600 px table layout,
// inline styles plus one <style> block (mobile padding and the dark-mode override only), hex colours from
// mail-tokens.js only, body 16 px / 1.6, nothing under 12 px, one button per email with the same link as text, a
// hidden 90-130 character preheader first in <body>, and every visitor value escaped. Subjects never carry CR/LF.

import { LIGHT as L, DARK as D, FONT_SERIF, FONT_SANS } from './mail-tokens.js';

const DEFAULT_SITE = { origin: 'https://mayobebros.com', logoUrl: 'https://mayobebros.com/assets/img/icon-192.png' };
const NAME = 'Mayobe Bros';

/* ------------------------------------------------------------------ text helpers */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]); }
// For anything that ends up in a subject or header: no CR, LF or Unicode line breaks.
export function oneLine(s) { return String(s ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim(); }
const clip = (s, n) => { const v = oneLine(s); return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v; };
// Same for text that may span lines (comments, replies, messages): line breaks kept, at most one blank line in a row.
const clipText = (s, n) => { const v = String(s ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v; };
// Visitor text for the plain-text part: keep line breaks, drop CR, and turn < > into look-alike angle quotes so the
// text part never contains anything a client could read as a tag.
const plain = (s) => String(s ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n').replace(/</g, '‹').replace(/>/g, '›');
const plainLine = (s, n = 200) => plain(clip(s, n));
// Visitor text for HTML that may span lines.
const multi = (s) => esc(String(s ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n').trim()).replace(/\n/g, '<br>');
// A long visitor text (message, comment) keeps up to TEXT_MAX characters. In HTML its escaped form may use at most
// HTML_BUDGET bytes, so the email stays under 40,000 bytes even when every character needs escaping; ordinary text
// of 5,000 characters fits whole. When it is cut, the HTML says so and the plain-text part still has all of it.
const TEXT_MAX = 5000, HTML_BUDGET = 14000;
const bytes = (s) => new TextEncoder().encode(s).length;
const longHtml = (s) => {
  const full = clipText(s, TEXT_MAX);
  let cut = full;
  while (cut.length > 1 && bytes(multi(cut)) > HTML_BUDGET) cut = clipText(cut, Math.floor(cut.length * 0.8));
  return multi(cut) + (cut !== full ? '<br><br><em>This text was cut short here. The plain-text version of this email has all of it.</em>' : '');
};
// Only http(s) and mailto links up to 500 characters (ours are far shorter) are ever written; anything else (javascript:, data:, spaces,
// control characters) uses the fallback.
const safeUrl = (u, fallback) => {
  const s = String(u ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(s) && s.length <= 500 && !/[\x00-\x20\x7f]/.test(s) ? s : fallback;
};
const siteOf = (site) => {
  const origin = safeUrl(site?.origin, DEFAULT_SITE.origin).replace(/\/+$/, '');
  const logoUrl = /^https:\/\//.test(String(site?.logoUrl ?? '')) ? safeUrl(site.logoUrl, DEFAULT_SITE.logoUrl) : DEFAULT_SITE.logoUrl;
  return { origin, logoUrl };
};
const greet = (name) => (oneLine(name) ? `Hi ${clip(name, 60)},` : 'Hello,');

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
  return `<p class="mb-gold" style="margin:0 0 16px;${SANS}font-size:12px;line-height:1.5;font-weight:bold;letter-spacing:2px;color:${L.gold};">${esc(String(text).toUpperCase())}</p>`;
}
export function link(url, label, extra = '') {
  return `<a class="mb-link" href="${esc(url)}" style="color:${L.link};text-decoration:underline;${extra}">${label}</a>`;
}
// The one primary button: a bgcolor cell wrapping a padded link, 14 + 20 + 14 = 48 px tall.
export function button(url, label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td class="mb-btn" bgcolor="${L.button}" style="background:${L.button};border-radius:4px;">`
    + `<a class="mb-btn-a" href="${esc(url)}" style="display:inline-block;padding:14px 32px;${SANS}font-size:16px;line-height:20px;font-weight:bold;color:${L.buttonText};text-decoration:none;border-radius:4px;">${esc(label)}</a>`
    + '</td></tr></table>';
}
// The same address as a plain text link under the button, for clients that hide or break buttons.
function fallback(url) {
  const shown = url.startsWith('mailto:') ? esc(decodeURIComponent(url.slice(7).split('?')[0])) : esc(url);
  const lead = url.startsWith('mailto:') ? 'Or write to:' : 'If the button does not work, open this link:';
  return p(`${lead}<br>${link(url, shown, 'word-break:break-all;')}`, { muted: true, size: 14, mb: 24 });
}
// Quoted visitor text (a comment, a reply, a message) with a thin gold rule on the left.
export function quote(html, cite = '') {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td class="mb-quote mb-body" bgcolor="${L.quote}" style="background:${L.quote};border-left:2px solid ${L.gold};padding:16px 24px;${SANS}font-size:16px;line-height:1.6;color:${L.body};word-break:break-word;">`
    + (cite ? `<p class="mb-muted" style="margin:0 0 8px;${SANS}font-size:14px;line-height:1.5;font-weight:bold;color:${L.muted};">${cite}</p>` : '')
    + html + '</td></tr></table>';
}
export function hairline(mb = 24) {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 ${mb}px;"><tr><td class="mb-rule" style="border-top:1px solid ${L.rule};height:1px;line-height:1px;">&nbsp;</td></tr></table>`;
}
// Label / value rows (owner emails).
function details(rows) {
  const tr = rows.filter(([, v]) => v).map(([k, v]) => `<tr><td class="mb-muted mb-rule" style="padding:8px 16px 8px 0;border-top:1px solid ${L.rule};width:112px;vertical-align:top;${SANS}font-size:14px;line-height:1.6;font-weight:bold;color:${L.muted};">${esc(k)}</td>`
    + `<td class="mb-body mb-rule" style="padding:8px 0;border-top:1px solid ${L.rule};vertical-align:top;${SANS}font-size:16px;line-height:1.6;color:${L.body};word-break:break-word;">${v}</td></tr>`).join('');
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${tr}</table>`;
}
const signoff = () => p('The Mayobe Bros team', { mb: 0 });

// Quiet dark footer: wordmark, one line about the site, why this email came, then each link on its own line.
export function footer(why, links) {
  const ln = links.map(([label, url]) => `<p style="margin:0 0 8px;${SANS}font-size:14px;line-height:1.6;"><a href="${esc(url)}" style="color:${L.footerLink};text-decoration:underline;">${esc(label)}</a></p>`).join('');
  return `<p style="margin:0 0 8px;${SERIF}font-size:18px;line-height:1.3;color:${L.wordmark};">${NAME}</p>`
    + `<p style="margin:0 0 16px;${SANS}font-size:14px;line-height:1.6;color:${L.footerText};">Plain-English guides for readers in Tanzania, checked against official sources.</p>`
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
const quoteText = (s) => plain(String(s ?? '').trim()).split('\n').map((l) => `> ${l}`).join('\n');

function build({ site, subject, title, preheader, eyebrowText, heading, html, text, buttonUrl, buttonLabel, why, links }) {
  const s = siteOf(site);
  const bodyHtml = eyebrow(eyebrowText) + h1(heading) + html.before + button(buttonUrl, buttonLabel) + fallback(buttonUrl) + (html.after || '') + hairline() + signoff();
  const textLines = [heading.text, ...text.before, `${buttonLabel}:\n${buttonUrl}`, ...(text.after || []), 'The Mayobe Bros team'];
  return {
    subject: clip(subject, 140),
    html: shell({ title: title || oneLine(subject), preheader, bodyHtml, footerHtml: footer(why, links), site: s }),
    text: textPart(textLines.map((l) => (typeof l === 'string' ? l : l?.text)), why, links, s.origin),
  };
}
const H = (htmlStr, textStr) => Object.assign(String(htmlStr), { text: textStr });
const commonLinks = (o) => [['Visit Mayobe Bros', `${o}/`], ['Privacy policy', `${o}/privacy-policy/`], ['Contact us', `${o}/contact/`]];

/* ------------------------------------------------------------------ comment emails */

export function manageLinkEmail(d, site) {
  const { origin } = siteOf(site);
  const manageUrl = safeUrl(d.manageUrl, `${origin}/`);
  const postUrl = safeUrl(d.postUrl, `${origin}/`);
  const title = clip(d.postTitle, 160) || 'an article';
  const notice = d.notifyWanted
    ? 'You also asked us to tell you about replies. Opening the link turns that on. We send at most one email a day for this comment, and every one has a link to stop them.'
    : null;
  const ignore = 'If you did not comment on Mayobe Bros, you can ignore this email. We send nothing more about this comment unless the link is opened.';
  return build({
    site, subject: 'Your link to edit or delete your comment',
    preheader: 'Use the link inside to edit or delete the comment you left on Mayobe Bros. It works for 7 days on any device.',
    eyebrowText: 'Your comment', heading: H('Edit or delete your comment', 'EDIT OR DELETE YOUR COMMENT'),
    html: {
      before: p(esc(greet(d.name))) + p(`Thank you for commenting on ${link(postUrl, esc(title))}. This is the comment you left:`)
        + quote(multi(clipText(d.commentExcerpt, 600)))
        + p('The button opens a page where you can change your comment or delete it. The link works for 7 days, on this device or another one. Please do not forward this email: anyone with the link can change this comment.'),
      after: (notice ? p(esc(notice)) : '') + p(esc(ignore), { muted: true }),
    },
    text: {
      before: [greet(plainLine(d.name, 60)), `Thank you for commenting on "${plainLine(title)}":\n${postUrl}`, 'This is the comment you left:', quoteText(clipText(d.commentExcerpt, 600)),
        'The link below opens a page where you can change your comment or delete it. It works for 7 days, on this device or another one. Please do not forward this email: anyone with the link can change this comment.'],
      after: [notice, ignore],
    },
    buttonUrl: manageUrl, buttonLabel: 'Manage my comment',
    why: 'You got this email because this address was typed into the comment form on mayobebros.com with a request for a link to manage the comment.',
    links: [['Comment policy', `${origin}/comment-policy/`], ...commonLinks(origin)],
  });
}

export function replyNoticeEmail(d, site) {
  const { origin } = siteOf(site);
  const postUrl = safeUrl(d.postUrl, `${origin}/`);
  const unsub = safeUrl(d.unsubscribeUrl, `${origin}/contact/`);
  const title = clip(d.postTitle, 160) || 'an article';
  const who = d.isTeam ? 'The Mayobe Bros team' : (clip(d.replyAuthor, 60) || 'A reader');
  return build({
    site, subject: d.isTeam ? 'The Mayobe Bros team replied to your comment' : 'New reply to your comment on Mayobe Bros',
    preheader: d.isTeam
      ? 'The Mayobe Bros team replied to the comment you left on our site. Read the reply here, or open the article to answer.'
      : 'Someone replied to the comment you left on Mayobe Bros. Read the reply here, or open the article to answer it.',
    eyebrowText: 'New reply', heading: H(d.isTeam ? 'The team replied to your comment' : 'New reply to your comment', d.isTeam ? 'THE TEAM REPLIED TO YOUR COMMENT' : 'NEW REPLY TO YOUR COMMENT'),
    html: {
      before: p(esc(greet(d.name))) + p(`${esc(who)} replied to your comment on ${link(postUrl, esc(title))}:`)
        + quote(multi(clipText(d.replyBody, 1200)), `${esc(who)} wrote:`),
      after: p('We send at most one of these emails a day for each comment. To stop them, use the link at the bottom of this email.', { muted: true }),
    },
    text: {
      before: [greet(plainLine(d.name, 60)), `${plainLine(who, 60)} replied to your comment on "${plainLine(title)}":`, quoteText(clipText(d.replyBody, 1200))],
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
    lead: 'The automatic screen held this comment, so it is not on the site yet. To approve or remove it, run node scripts/comments.mjs list on your computer.',
  },
  question: {
    subject: (d) => `New reader question on ${clip(d.postSlug, 80) || 'an article'}`,
    preheader: 'A reader asked a question in the comments. The question and a link to the article are inside, ready for a reply.',
    eyebrow: 'Reader question', heading: 'A reader asked a question',
    lead: 'This comment looks like a question. After you reply as the team, run node scripts/qa-sync.mjs so the answer is saved into the page.',
  },
  'contact-failed': {
    subject: () => 'A contact form email could not be sent',
    preheader: 'An email from the contact form could not be sent. The reason Resend gave is inside so you can check what went wrong.',
    eyebrow: 'Delivery problem', heading: 'A contact form email was not sent',
    lead: 'The Worker tried to send an email for the contact form and it failed. The visitor’s message is not stored on the site, so check the Resend dashboard for the details.',
  },
};

export function ownerAlertEmail(d, site) {
  const { origin } = siteOf(site);
  const a = ALERTS[d.kind] || ALERTS.held;
  const hasPost = safeUrl(d.postUrl, '') !== '';
  const postUrl = safeUrl(d.postUrl, `${origin}/`);
  const rows = [['Reason', esc(clip(d.reason, 300))], ['Article', esc(clip(d.postSlug, 200))], ['Comment ID', esc(clip(d.commentId, 20))], ['Name', esc(clip(d.name, 120))]];
  const textRows = [['Reason', d.reason, 300], ['Article', d.postSlug, 200], ['Comment ID', d.commentId, 20], ['Name', d.name, 120]]
    .filter(([, v]) => oneLine(v)).map(([k, v, n]) => `${k}: ${plainLine(v, n)}`).join('\n');
  const body = String(d.body ?? '').trim();
  return build({
    site, subject: a.subject(d), preheader: a.preheader, eyebrowText: a.eyebrow, heading: H(esc(a.heading), a.heading.toUpperCase()),
    html: { before: p(esc(a.lead)) + details(rows) + (body ? quote(longHtml(body), 'What they wrote:') : '') },
    text: { before: [a.lead, textRows || null, body ? `What they wrote:\n${quoteText(clipText(body, 5000))}` : null, hasPost ? `Article: ${postUrl}` : null] },
    buttonUrl: postUrl, buttonLabel: hasPost ? 'Open the article' : 'Open the website',
    why: 'You got this alert because this address is set as OWNER_EMAIL for the Mayobe Bros comments Worker.',
    links: [['Visit Mayobe Bros', `${origin}/`], ['Comment policy', `${origin}/comment-policy/`]],
  });
}

/* ------------------------------------------------------------------ contact form */

const CONTACT_TYPES = {
  general: 'General question', support: 'Technical support', technical: 'Technical issue', advertising: 'Advertising',
  editorial: 'Editorial feedback', partnership: 'Partnership', press: 'Press and media', other: 'Other',
};
const typeLabel = (t) => CONTACT_TYPES[t] || (oneLine(t) ? 'Other' : 'General question');
const isUrgent = (t) => t === 'technical' || t === 'support';
// Only plain address characters stay as they are; anything else is percent-encoded so it cannot break the mailto.
const mailto = (addr, subject) => `mailto:${oneLine(addr).replace(/[^A-Za-z0-9@._+-]/g, (c) => encodeURIComponent(c))}?subject=${encodeURIComponent(subject)}`;
const when = (v) => {
  if (v === undefined || v === null || v === '') return '';
  const t = typeof v === 'number' || v instanceof Date ? new Date(v) : new Date(String(v));
  return Number.isNaN(t.getTime()) ? clip(v, 40) : t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
};

export function contactOwnerEmail(d, site) {
  const { origin } = siteOf(site);
  const subj = clip(d.subject, 120) || '(no subject)';
  const type = typeLabel(d.type);
  const reply = mailto(d.email, `Re: ${clip(d.subject, 100) || 'Your message to Mayobe Bros'}`);
  const rows = [['Name', esc(clip(d.name, 120))], ['Email', esc(clip(d.email, 254))], ['Subject', esc(subj)], ['Type', esc(type)], ['Received', esc(when(d.receivedAt))]];
  const textRows = [['Name', clip(d.name, 120)], ['Email', clip(d.email, 254)], ['Subject', subj], ['Type', type], ['Received', when(d.receivedAt)]]
    .filter(([, v]) => v).map(([k, v]) => `${k}: ${plain(v)}`).join('\n');
  const lead = isUrgent(d.type)
    ? 'Someone sent a message through the contact form. It is marked as a technical problem, so the visitor was told to expect a reply within 24 hours.'
    : 'Someone sent a message through the contact form. The visitor was told to expect a reply within 2 to 3 working days.';
  return build({
    site, subject: `Contact form (${type}): ${clip(d.subject, 90) || '(no subject)'}`,
    preheader: 'Someone sent a message through the contact form on mayobebros.com. Press Reply in your mail app to answer them.',
    eyebrowText: `Contact form · ${type}`, heading: H('New message from the contact form', 'NEW MESSAGE FROM THE CONTACT FORM'),
    html: {
      before: p(esc(lead)) + details(rows) + quote(longHtml(d.message), 'Message:'),
      after: p('Pressing Reply in your mail app also works: the reply goes straight to the visitor.', { muted: true }),
    },
    text: { before: [lead, textRows, `Message:\n${quoteText(clipText(d.message, 5000))}`], after: ['Pressing Reply in your mail app also works: the reply goes straight to the visitor.'] },
    buttonUrl: reply, buttonLabel: 'Reply to this message',
    why: 'You got this email because someone sent a message through the contact form on mayobebros.com.',
    links: [['Visit Mayobe Bros', `${origin}/`], ['Contact page', `${origin}/contact/`]],
  });
}

export function contactVisitorEmail(d, site) {
  const { origin } = siteOf(site);
  const subj = clip(d.subject, 120);
  const time = isUrgent(d.type) ? 'within 24 hours' : 'within 2 to 3 working days';
  const timeLine = isUrgent(d.type)
    ? `Because this is about a technical problem, we aim to reply ${time}.`
    : `You can expect a reply ${time}.`;
  const about = subj ? `Your message about "${subj}" reached us. We read every message.` : 'Your message reached us. We read every message.';
  const spam = 'We will reply to the address this email was sent to. If you do not see our reply, please check your spam folder.';
  const privacy = 'For your privacy, this email does not repeat your message.';
  return build({
    site, subject: 'We received your message',
    preheader: 'Thank you for writing to Mayobe Bros. Your message reached us, and this email says when you can expect a reply.',
    eyebrowText: 'Message received', heading: H('Thank you for your message', 'THANK YOU FOR YOUR MESSAGE'),
    html: { before: p(esc(greet(d.name))) + p(esc(about)) + p(`<strong>${esc(timeLine)}</strong>`) + p(esc(spam)) + p(esc(privacy), { muted: true }) + p('While you wait, you are welcome to read our latest articles.') },
    text: { before: [greet(plainLine(d.name, 60)), plain(about), timeLine, spam, privacy, 'While you wait, you are welcome to read our latest articles.'] },
    buttonUrl: `${origin}/post/`, buttonLabel: 'Read the latest articles',
    why: 'You got this email because this address was entered in the contact form on mayobebros.com. If that was not you, you can ignore it.',
    links: commonLinks(origin),
  });
}

/* ------------------------------------------------------------------ newsletter (sent by Plan 3) */

export function confirmSubscriptionEmail(d, site) {
  const { origin } = siteOf(site);
  const url = safeUrl(d.confirmUrl, `${origin}/`);
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

export function welcomeEmail(d, site) {
  const { origin } = siteOf(site);
  const unsub = safeUrl(d.unsubscribeUrl, `${origin}/contact/`);
  const posts = (Array.isArray(d.latestPosts) ? d.latestPosts : [])
    .map((x) => ({ title: clip(x?.title, 160), url: safeUrl(x?.url, ''), excerpt: clip(x?.excerpt, 220) }))
    .filter((x) => x.title && x.url).slice(0, 3);
  const a = 'Thank you for confirming. When we publish a new article, we will send you one short email about it.';
  const b = 'Our articles are plain-English guides on student loans, careers, small business, technology and daily life in Tanzania, checked against official sources.';
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

// post = { title, url, excerpt?, image? (absolute https URL of the 1200 x 630 share card), imageAlt?, category? }
export function newPostEmail(d, site) {
  const { origin } = siteOf(site);
  const post = d.post || {};
  const url = safeUrl(post.url, `${origin}/`);
  const unsub = safeUrl(d.unsubscribeUrl, `${origin}/contact/`);
  const title = clip(post.title, 200) || 'A new article';
  const excerpt = clip(post.excerpt, 400);
  const image = /^https:\/\//.test(String(post.image ?? '')) ? safeUrl(post.image, '') : '';
  const pre = clip(post.excerpt, 130);
  const c = 'You can stop these emails at any time with the unsubscribe link below.';
  return build({
    site, subject: `New article: ${clip(post.title, 110) || 'Mayobe Bros'}`,
    preheader: pre.length >= 90 ? pre : 'A new article is on Mayobe Bros. Read the short summary here, then open the full article when you are ready.',
    eyebrowText: post.category ? `New article · ${clip(post.category, 40)}` : 'New article', heading: H(esc(title), plain(title)),
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

export function farewellEmail(d, site) {
  const { origin } = siteOf(site);
  const url = safeUrl(d.resubscribeUrl, `${origin}/`);
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
