// Every email the Worker sends, built from one small design system that copies the site (css/style.css): a white
// header with the colour wordmark and a green/blue bar, a white card with a thin border and 14 px corners on the
// site's cool grey, blue uppercase kickers, bold sans headings, royal blue pill buttons, a near-black footer, and the
// site's dark palette for clients that honour prefers-color-scheme. Pure functions: each builder takes (data, site)
// and returns { subject, html, text }. Rules (checked by scripts/tests/email-templates.test.mjs): 600 px table layout,
// inline styles plus one <style> block (mobile padding and the dark-mode override only), hex colours from
// mail-tokens.js only, system sans only, body 16 px / 1.6, nothing under 12 px, one button per email with the same
// link as text, a hidden 90-130 character preheader first in <body>, pictures only from our own /assets/email/ on
// https, and every visitor value escaped. Subjects never carry CR/LF.
// Every builder is total: any input (wrong types, lone surrogates, control characters, huge strings) gives valid
// output and never throws.
//
// Who sees visitor text: emails to an address nobody has verified yet (manage link, contact confirmation, newsletter)
// carry only fixed text and our own article titles, never a visitor's name, comment, subject or message, so the
// forms cannot be used to send someone else's words to a stranger. Reply notices go only to addresses confirmed by
// opening the manage link, so they show the reply. Owner emails show everything, escaped.

import { LIGHT as L, DARK as D, FONT_SANS } from './mail-tokens.js';

const DEFAULT_ORIGIN = 'https://mayobebros.com';
const LOGO_PATH = '/assets/email/logo.png';
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
// paragraph separators, no bidi overrides or isolates (they can disguise text): each becomes a space. Zero-width
// characters and direction marks (U+200B-U+200F, U+061C, U+2060, U+FEFF) are removed.
const ONE_LINE_BAD = /[\x00-\x1f\x7f\x85\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;
const INVISIBLE = /[​-‏؜⁠﻿]/g;
export function oneLine(s) { return str(s).replace(INVISIBLE, '').replace(ONE_LINE_BAD, ' ').replace(/[ ]{2,}/g, ' ').trim(); }
const cut = (v, n) => (v.length > n ? str(v.slice(0, n - 1)).trimEnd() + '…' : v); // str() repairs a pair split by slice
const clip = (s, n) => cut(oneLine(s), n);
// Text that may span lines (comments, replies, messages): line breaks become \n, other control and bidi characters a
// space, zero-width characters and direction marks are removed.
const normText = (s) => str(s).replace(INVISIBLE, '').replace(/\r\n?|\u2028|\u2029|\x85/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ');
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
// Every link we write points at our own site. Rejected before parsing: more than 500 characters, any backslash,
// whitespace or control character, a scheme other than http(s), or any non-ASCII character in the host part
// (ideographic full stops and fullwidth letters are mapped by the URL parser but read differently by some
// linkifiers). After parsing, the origin must equal the site origin and there must be no user:password. The PARSED
// href is returned, so scheme and host come out lower case and the path is percent-encoded.
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const ownUrl = (u, origin, fallback) => {
  const s = str(u).trim();
  if (!s || s.length > 500 || /[\\\s\x00-\x1f\x7f]/.test(s) || !/^https?:\/\//i.test(s)) return fallback;
  const host = s.slice(s.indexOf('//') + 2).split(/[/?#]/)[0];
  if (!host || /[^\x21-\x7e]/.test(host)) return fallback;
  let x;
  try { x = new URL(s); } catch { return fallback; }
  if (x.origin !== originOf(origin) || x.username || x.password || x.href.length > 2000) return fallback;
  return x.href;
};
// An https origin as given (a path is dropped), or ''. Same pre-checks as ownUrl: length, no backslash, whitespace or
// control character, ASCII host, no user:password.
const httpsOrigin = (v) => {
  const s = str(v).trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(s) || s.length > 200 || /[\\\s\x00-\x1f\x7f]/.test(s)) return '';
  const host = s.slice(8).split(/[/?#]/)[0];
  if (!host || /[^\x21-\x7e]/.test(host) || host.includes('@')) return '';
  return originOf(s);
};
// Local testing only (scripts/dev-api.mjs): http is accepted for exactly 127.0.0.1 or localhost with an optional port
// and nothing after it, so a loopback link can never come from a production setting by accident.
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;
const loopbackOrigin = (v) => {
  const s = str(v).trim().replace(/\/+$/, '');
  return LOOPBACK.test(s) ? originOf(s) : '';
};

// Our own email picture, or ''. Only https on the asset origin, a path /assets/email/<lower-case name>.jpg|png, no
// query or only v=<8 lowercase hex> (the build's content hash, never a per-reader value), no fragment, no
// user:password, at most 500 characters. Returned rebuilt from the parsed parts, so it is always in normal form.
const IMAGE_PATH = /^\/assets\/email\/[a-z0-9-]+\.(jpg|png)$/;
export function ownImage(u, assetOrigin) {
  try {
    const s = str(u).trim();
    const base = httpsOrigin(assetOrigin);
    if (!base || !s || s.length > 500 || /[\\\s\x00-\x1f\x7f]/.test(s) || !/^https:\/\//i.test(s)) return '';
    const host = s.slice(8).split(/[/?#]/)[0];
    if (!host || /[^\x21-\x7e]/.test(host)) return '';
    const x = new URL(s);
    if (x.protocol !== 'https:' || x.origin !== base || x.username || x.password || x.hash || s.includes('#')) return '';
    if (!IMAGE_PATH.test(x.pathname) || !(x.search === '' || /^\?v=[0-9a-f]{8}$/.test(x.search))) return '';
    return `${x.origin}${x.pathname}${x.search}`;
  } catch { return ''; }
}

// Where links point (origin), where pictures come from (assetOrigin, always https) and the wordmark picture.
// origin: an https origin, or a loopback http origin for local testing, else the live site. assetOrigin: site.assetOrigin
// if https, else origin if https, else the live site, so a loopback run still shows the published pictures.
export function resolveSite(site) {
  let o = '', a = '', logo = '';
  try { o = site?.origin; } catch { /* a hostile site object: use the defaults */ }
  try { a = site?.assetOrigin; } catch { /* as above */ }
  try { logo = site?.logoUrl; } catch { /* as above */ }
  const origin = httpsOrigin(o) || loopbackOrigin(o) || DEFAULT_ORIGIN;
  const assetOrigin = httpsOrigin(a) || httpsOrigin(origin) || DEFAULT_ORIGIN;
  const logoUrl = ownImage(logo, assetOrigin) || `${assetOrigin}${LOGO_PATH}`;
  return { origin, assetOrigin, logoUrl };
}
// Copies the fields a builder needs once, at the top. A field whose getter (or Proxy trap) throws becomes undefined,
// so no later read can throw.
function pick(d, keys) {
  const out = {};
  let ok = false;
  try { ok = !!d && typeof d === 'object'; } catch { ok = false; }
  for (const k of keys) { try { out[k] = ok ? d[k] : undefined; } catch { out[k] = undefined; } }
  return out;
}
const asList = (v) => { try { return Array.isArray(v) ? Array.from(v).slice(0, 20) : []; } catch { return []; } };

/* ------------------------------------------------------------------ components */
const SANS = `font-family:${FONT_SANS};`;

export function p(html, { muted = false, size = 16, mb = 16 } = {}) {
  const cls = muted ? 'mb-muted' : 'mb-body';
  return `<p class="${cls}" style="margin:0 0 ${mb}px;${SANS}font-size:${size}px;line-height:1.6;color:${muted ? L.muted : L.body};">${html}</p>`;
}
// The site's headings: system sans, extra bold, slightly tight. 24 px on phones (CSS below).
export function h1(html) {
  return `<h1 class="mb-h1 mb-heading" style="margin:0 0 20px;${SANS}font-size:28px;line-height:1.25;font-weight:800;letter-spacing:-0.3px;color:${L.heading};">${html}</h1>`;
}
// Small blue label above the heading, like the site's .kicker. Typed in capitals here (no text-transform), letter-spaced.
export function kicker(text) {
  return `<p class="mb-kicker" style="margin:0 0 12px;${SANS}font-size:13px;line-height:1.5;font-weight:bold;letter-spacing:1.5px;color:${L.kicker};">${esc(str(text).toUpperCase())}</p>`;
}
export function link(url, label, extra = '') {
  return `<a class="mb-link" href="${esc(url)}" style="color:${L.link};text-decoration:underline;${extra}">${label}</a>`;
}
// The one primary button, a royal blue pill like the site's .btn-primary: a bgcolor cell wrapping a padded link,
// 14 + 20 + 14 = 48 px tall. Outlook's Word engine ignores padding on the inline <a> (and the radius), so the cell
// carries the same padding as mso-padding-alt and Outlook shows a square button of the same size.
export function button(url, label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:28px 0 16px;"><tr><td class="mb-btn" bgcolor="${L.button}" style="background:${L.button};border-radius:24px;mso-padding-alt:14px 32px;">`
    + `<a class="mb-btn-a" href="${esc(url)}" style="display:inline-block;padding:14px 32px;${SANS}font-size:16px;line-height:20px;font-weight:bold;color:${L.buttonText};text-decoration:none;border-radius:24px;">${esc(label)}</a>`
    + '</td></tr></table>';
}
// A quiet second button for the other choice (an outlined pill, no fill), used only where one email offers two actions.
// It has no background colour on purpose: the lint test counts filled buttons, and an email has one primary action.
export function secondaryButton(url, label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td class="mb-btn2" style="border:2px solid ${L.link};border-radius:24px;mso-padding-alt:12px 30px;">`
    + `<a class="mb-btn2-a" href="${esc(url)}" style="display:inline-block;padding:12px 30px;${SANS}font-size:16px;line-height:20px;font-weight:bold;color:${L.link};text-decoration:none;border-radius:24px;">${esc(label)}</a>`
    + '</td></tr></table>';
}
// The same address as a plain text link under the button, for clients that hide or break buttons. `lead` replaces
// the default sentence (fixed text only, never visitor text).
function fallback(url, shown, lead, mb = 24) {
  const l = lead || (url.startsWith('mailto:') ? 'Or write to:' : 'If the button does not work, open this link:');
  return p(`${esc(l)}<br>${link(url, esc(shown || url), 'word-break:break-all;')}`, { muted: true, size: 14, mb });
}
// Quoted visitor text (a reply, a message): a tinted block with a 4 px blue rule on the left.
export function quote(html, cite = '') {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td class="mb-quote mb-body" bgcolor="${L.quote}" style="background:${L.quote};border-left:4px solid ${L.quoteRule};border-radius:0 8px 8px 0;padding:16px 20px;${SANS}font-size:16px;line-height:1.6;color:${L.body};word-break:break-word;">`
    + (cite ? `<p class="mb-muted" style="margin:0 0 8px;${SANS}font-size:14px;line-height:1.5;font-weight:bold;color:${L.muted};">${cite}</p>` : '')
    + html + '</td></tr></table>';
}
// A command the owner types, set apart in a monospace face so it reads as something to copy, not as prose.
const FONT_MONO = "Menlo,Consolas,'Courier New',monospace";
export function code(text) {
  return `<span class="mb-quote mb-heading" style="background:${L.quote};padding:4px 8px;border-radius:6px;font-family:${FONT_MONO};font-size:14px;color:${L.heading};white-space:nowrap;">${esc(text)}</span>`;
}
export function hairline(mb = 24) {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 ${mb}px;"><tr><td class="mb-rule" style="border-top:1px solid ${L.rule};height:1px;line-height:1px;">&nbsp;</td></tr></table>`;
}
// Label / value rows (owner emails). Values arrive already escaped. The label sits 2 px lower than the value so the
// 14 px label and the 16 px value share a baseline; on phones the label stacks above the value (CSS below).
function details(rows) {
  const tr = rows.filter(([, v]) => v).map(([k, v]) => `<tr><td class="mb-muted mb-rule mb-dt" width="112" style="padding:10px 16px 8px 0;border-top:1px solid ${L.rule};width:112px;vertical-align:top;${SANS}font-size:14px;line-height:1.6;font-weight:bold;color:${L.muted};">${esc(k)}</td>`
    + `<td class="mb-body mb-rule mb-dd" style="padding:8px 0;border-top:1px solid ${L.rule};vertical-align:top;${SANS}font-size:16px;line-height:1.6;color:${L.body};word-break:break-word;">${v}</td></tr>`).join('');
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${tr}</table>`;
}
const signoff = () => p('The Mayobe Bros team', { mb: 0 });

// An article picture, linked. src must already have passed ownImage. The slot keeps a tinted background and the alt
// text is styled, so with pictures blocked (Outlook desktop by default, data-saver apps) the box still reads as a
// labelled picture. w and h are what Outlook desktop shows (it uses the attributes), so w must equal the width of the
// cell the picture sits in. Wider than 200 px: fluid, width:100% up to `max` (the widest that cell gets on a phone), and
// the alt text is indented so a blocked picture's label does not touch the left edge.
// Cell widths: the card is 600 px with a 1 px border (inner 598); its body is padded 40 px (518). Phones (max-width
// 620 px, see CSS) drop the border and pad the body 28 px, so the hero can reach 620 px and the body 564 px.
const HERO = { w: 598, h: 336, max: 620 };
const LEAD = { w: 518, h: 291, max: 564 };
function picture(src, w, h, alt, href, radius = 0, max = w) {
  const size = w > 200 ? `width:100%;max-width:${max}px;text-indent:12px;` : `width:${w}px;`;
  return `<a href="${esc(href)}" style="display:block;text-decoration:none;"><img class="mb-img" src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" style="display:block;border:0;${size}height:auto;${radius ? `border-radius:${radius}px;` : ''}background:${L.imageBg};${SANS}font-size:14px;line-height:1.5;color:${L.imageAlt};"></a>`;
}
// A small blue category line above an article title (the site's card kicker).
const catLine = (text, mb = 8) => `<p class="mb-kicker" style="margin:0 0 ${mb}px;${SANS}font-size:12px;line-height:1.5;font-weight:bold;letter-spacing:1.2px;color:${L.kicker};">${esc(str(text).toUpperCase())}</p>`;
// An article title as a link in live text: heading colour, no underline, like the titles on the site's cards.
const titleLink = (tag, url, title, size, mb) => `<${tag} class="mb-heading" style="margin:0 0 ${mb}px;${SANS}font-size:${size}px;line-height:1.3;font-weight:800;letter-spacing:-0.2px;color:${L.heading};"><a class="mb-heading" href="${esc(url)}" style="color:${L.heading};text-decoration:none;">${esc(title)}</a></${tag}>`;

// The site's near-black footer: the name in bold sans ("Bros" in the light blue of the site's hero title), the
// slogan, why this email came, then each link on its own line, white and underlined.
export function footer(why, links) {
  const ln = links.map(([label, url]) => `<p style="margin:0 0 10px;${SANS}font-size:14px;line-height:1.6;"><a href="${esc(url)}" style="color:${L.footerLink};text-decoration:underline;">${esc(label)}</a></p>`).join('');
  return `<p style="margin:0 0 8px;${SANS}font-size:20px;line-height:1.3;font-weight:800;letter-spacing:-0.2px;color:${L.wordmark};">Mayobe <span style="color:${L.footerAccent};">Bros</span></p>`
    + `<p style="margin:0 0 20px;${SANS}font-size:14px;line-height:1.6;color:${L.footerText};">${SLOGAN}</p>`
    + `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="border-top:1px solid ${L.footerRule};height:1px;line-height:1px;">&nbsp;</td></tr></table>`
    + `<p style="margin:0 0 16px;${SANS}font-size:14px;line-height:1.6;color:${L.footerText};">${esc(why)}</p>` + ln;
}

const PREHEADER_FILL = '&#847;&zwnj;&nbsp;'.repeat(30);
const CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
@media (max-width:620px){.mb-wrap{width:100%!important}.mb-outer{padding:0 0 24px!important}.mb-frame{border-width:0 0 1px!important;border-radius:0!important}.mb-head,.mb-card{border-radius:0!important}.mb-footband{padding:0!important}.mb-head{padding:12px 28px 12px 8px!important}.mb-card{padding:28px 28px 32px!important}.mb-foot{padding:32px 28px 40px!important}.mb-h1{font-size:24px!important}.mb-dt,.mb-dd{display:block!important;width:auto!important}.mb-dt{padding:12px 0 0!important}.mb-dd{border-top:0!important;padding:0 0 12px!important}}
@media (prefers-color-scheme: dark){.mb-page{background:${D.page}!important}.mb-frame{background:${D.card}!important;border-color:${D.border}!important}.mb-head{background:${D.header}!important}.mb-card{background:${D.card}!important}.mb-heading{color:${D.heading}!important}.mb-body{color:${D.body}!important}.mb-muted{color:${D.muted}!important}.mb-kicker{color:${D.kicker}!important}.mb-link{color:${D.link}!important}.mb-btn{background:${D.button}!important}.mb-btn-a{color:${D.buttonText}!important}.mb-btn2{border-color:${D.link}!important}.mb-btn2-a{color:${D.link}!important}.mb-quote{background:${D.quote}!important;border-left-color:${D.quoteRule}!important}.mb-rule{border-color:${D.rule}!important}.mb-logo{color:${D.logoAlt}!important}.mb-img{background:${D.imageBg}!important;color:${D.imageAlt}!important}}`;

// Layout: the page colour, then one 600 px column holding the card (white header with the linked wordmark, the
// green/blue bar, the body), then a full-width near-black footer band like the site's. On phones the card runs edge to
// edge (the mail app adds its own margin) so lines stay long enough to read. The logo PNG carries a white plate with
// about 21 px of white on each side at display size, so the header is padded 20 px less on the left: the letters of
// the wordmark then line up with the text below. The header cell has no bgcolor attribute on purpose: a bgcolor cell
// directly followed by <a> is the lint's button signature.
export function shell({ title, preheader, bodyHtml, footerHtml, site, heroHtml = '' }) {
  const s = resolveSite(site);
  const bar = (c) => `<td width="50%" height="4" bgcolor="${c}" style="background:${c};height:4px;line-height:4px;mso-line-height-rule:exactly;">&nbsp;</td>`;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>${CSS}</style>
</head>
<body class="mb-page" style="margin:0;padding:0;background:${L.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">${esc(preheader)}${PREHEADER_FILL}</div>
<table role="presentation" class="mb-page" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${L.page}" style="background:${L.page};">
<tr><td class="mb-outer" align="center" style="padding:32px 16px 40px;">
<table role="presentation" class="mb-wrap" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
<tr><td class="mb-frame" bgcolor="${L.card}" style="background:${L.card};border:1px solid ${L.border};border-radius:14px;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
<tr><td class="mb-head" style="background:${L.header};border-radius:13px 13px 0 0;padding:24px 40px 20px 20px;">
<a href="${esc(`${s.origin}/`)}" style="display:inline-block;text-decoration:none;"><img class="mb-logo" src="${esc(s.logoUrl)}" width="212" height="48" alt="${NAME}" style="display:block;border:0;width:100%;max-width:212px;height:auto;${SANS}font-size:20px;line-height:1.2;font-weight:bold;color:${L.logoAlt};"></a>
</td></tr>
<tr><td><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>${bar(L.barGreen)}${bar(L.barBlue)}</tr></table></td></tr>
${heroHtml ? `<tr><td class="mb-img" style="background:${L.imageBg};">${heroHtml}</td></tr>\n` : ''}<tr><td class="mb-card" bgcolor="${L.card}" style="background:${L.card};border-radius:0 0 13px 13px;padding:40px;word-break:break-word;">
${bodyHtml}
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
<tr><td class="mb-footband" bgcolor="${L.footer}" align="center" style="background:${L.footer};border-top:1px solid ${L.footerRule};padding:0 16px;">
<table role="presentation" class="mb-wrap" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
<tr><td class="mb-foot" style="padding:40px 40px 48px;">
${footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Plain-text part: hand-written lines, then the same footer facts.
function textPart(lines, why, links, origin) {
  const body = lines.filter((l) => l !== null && l !== undefined).join('\n\n');
  return `${body}\n\n--\n${NAME}\n${origin}\n\n${why}\n${links.map(([label, url]) => `${label}: ${url}`).join('\n')}\n`;
}
const quoteText = (s) => plain(s).trim().split('\n').map((l) => `> ${l}`).join('\n');

// signoff: false for emails to the owner (a team signature on a note to ourselves reads oddly).
function build({ site, subject, title, preheader, kickerText, heading, html, text, buttonUrl, buttonShown, buttonLabel, fallbackLead, secondary, why, links, signoff: sign = true, heroHtml = '' }) {
  const s = resolveSite(site);
  const last = !html.after && !sign; // nothing under the link: no extra space above the card's own bottom padding
  const bodyHtml = kicker(kickerText) + h1(heading) + html.before + button(buttonUrl, buttonLabel) + (secondary ? secondaryButton(secondary.url, secondary.label) : '') + fallback(buttonUrl, buttonShown, fallbackLead, last ? 0 : 24) + (html.after || '') + (sign ? hairline() + signoff() : '');
  const textLines = [heading.text, ...text.before, `${buttonLabel}:\n${buttonUrl}`, secondary ? `${secondary.label}:\n${secondary.url}` : null, ...(text.after || []), sign ? 'The Mayobe Bros team' : null];
  return {
    subject: clip(subject, 140),
    html: shell({ title: title || clip(subject, 140), preheader: clip(preheader, 130), bodyHtml, footerHtml: footer(why, links), site: s, heroHtml }),
    text: textPart(textLines.map((l) => (typeof l === 'string' ? l : l?.text)), why, links, s.origin),
  };
}
const H = (htmlStr, textStr) => Object.assign(String(htmlStr), { text: textStr });
const commonLinks = (o) => [['Visit Mayobe Bros', `${o}/`], ['Privacy policy', `${o}/privacy-policy/`], ['Contact us', `${o}/contact/`]];
// mailto: only plain address characters stay as they are; everything else is percent-encoded so it cannot add a
// header field, a second address or a query to the link.
// encodeURIComponent leaves ! ' ( ) * ~ as they are, so those are encoded by hand (input is already well-formed).
const pct = (s) => encodeURIComponent(s).replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const mailto = (addr, subject) => `mailto:${oneLine(addr).replace(/[^A-Za-z0-9@._+-]/gu, pct)}?subject=${pct(clip(subject, 120))}`;

/* ------------------------------------------------------------------ comment emails */

// Sent to an address that has not been verified: only our article title and fixed text. data.name and
// data.commentExcerpt are accepted for compatibility and deliberately not shown.
export function manageLinkEmail(data, site) {
  const d = pick(data, ['manageUrl', 'postUrl', 'postTitle', 'notifyWanted']);
  const { origin } = resolveSite(site);
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
    kickerText: 'Your comment', heading: H('Edit or delete your comment', 'EDIT OR DELETE YOUR COMMENT'),
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
  const d = pick(data, ['postUrl', 'unsubscribeUrl', 'postTitle', 'name', 'isTeam', 'replyAuthor', 'replyBody']);
  const { origin } = resolveSite(site);
  const postUrl = ownUrl(d.postUrl, origin, `${origin}/`);
  const unsub = ownUrl(d.unsubscribeUrl, origin, `${origin}/contact/`);
  const title = clip(d.postTitle, 160) || 'an article';
  // Greet by the first word of the name: a long full name cut at 60 characters ended mid-word ("Sout…,").
  const first = clip(oneLine(d.name).split(' ')[0], 30);
  const greet = first ? `Hi ${first},` : 'Hello,';
  const who = d.isTeam ? 'The Mayobe Bros team' : (clip(d.replyAuthor, 60) || 'A reader');
  return build({
    site, subject: d.isTeam ? 'The Mayobe Bros team replied to your comment' : 'New reply to your comment on Mayobe Bros',
    preheader: d.isTeam
      ? 'The Mayobe Bros team replied to the comment you left on our site. Read the reply here, or open the article to answer.'
      : 'Someone replied to the comment you left on Mayobe Bros. Read the reply here, or open the article to answer it.',
    kickerText: 'New reply', heading: H(d.isTeam ? 'The team replied to your comment' : 'New reply to your comment', d.isTeam ? 'THE TEAM REPLIED TO YOUR COMMENT' : 'NEW REPLY TO YOUR COMMENT'),
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
    kicker: 'Moderation', heading: 'A comment is waiting for review',
    lead: (hasEmail, review) => review
      ? 'The automatic screen held this comment, so it is not on the site yet. Read it below, then press Approve to publish it, or Ignore to leave it hidden. The buttons work for 7 days.'
      : 'The automatic screen held this comment, so it is not on the site yet. To approve or remove it, run this on your computer:',
    command: 'node scripts/comments.mjs list',
  },
  question: {
    subject: (d) => `New reader question on ${clip(d.postSlug, 80) || 'an article'}`,
    preheader: 'A reader asked a question in the comments. The question and a link to the article are inside, ready for a reply.',
    kicker: 'Reader question', heading: 'A reader asked a question',
    lead: () => 'This comment looks like a question. After you reply as the team, run this so the answer is saved into the page:',
    command: 'node scripts/qa-sync.mjs',
  },
  'contact-failed': {
    subject: () => 'A contact message could not be emailed to you',
    preheader: 'A message sent through the contact form could not be emailed to you. What the visitor wrote and their address are inside.',
    kicker: 'Delivery problem', heading: 'A contact message did not reach you',
    lead: (hasEmail) => `A message sent through the contact form could not be emailed to you. What the visitor wrote is below.${hasEmail ? ' To answer, reply to the address shown.' : ''}`,
  },
};

// Owner only: full content, escaped. data.email is used by kind 'contact-failed' (the visitor's address).
export function ownerAlertEmail(data, site) {
  const d = pick(data, ['kind', 'postUrl', 'email', 'reason', 'postSlug', 'commentId', 'name', 'body', 'approveUrl', 'ignoreUrl']);
  const { origin } = resolveSite(site);
  const kind = typeof d.kind === 'string' && Object.prototype.hasOwnProperty.call(ALERTS, d.kind) ? d.kind : 'held';
  const a = ALERTS[kind];
  const postUrl = ownUrl(d.postUrl, origin, '');
  const email = kind === 'contact-failed' ? clip(d.email, 254) : '';
  const approveUrl = kind === 'held' ? ownUrl(d.approveUrl, origin, '') : '';
  const ignoreUrl = kind === 'held' ? ownUrl(d.ignoreUrl, origin, '') : '';
  const review = !!(approveUrl && ignoreUrl);
  const cmd = review ? '' : a.command;
  const lead = a.lead(!!email, review);
  const rows = [['Reason', clip(d.reason, 300)], ['Article', clip(d.postSlug, 200)], ['Comment ID', clip(d.commentId, 20)], ['Name', clip(d.name, 120)], ['Email', email]];
  const body = clipText(d.body, TEXT_MAX);
  // A held comment with review links: the primary button approves it, the quiet one leaves it held. Both open our own /manage/ page.
  const btn = review ? { buttonUrl: approveUrl, buttonLabel: 'Approve this comment', secondary: { url: ignoreUrl, label: 'Ignore' },
      fallbackLead: 'If the buttons do not work, open this link to approve the comment:' }
    : email ? { buttonUrl: mailto(email, 'Re: your message to Mayobe Bros'), buttonShown: email, buttonLabel: 'Reply to the visitor' }
    : { buttonUrl: postUrl || `${origin}/`, buttonLabel: postUrl ? 'Open the article' : 'Open the website' };
  return build({
    site, subject: a.subject(d), preheader: a.preheader, kickerText: a.kicker, heading: H(esc(a.heading), a.heading.toUpperCase()),
    signoff: false,
    html: { before: p(esc(lead), { mb: cmd ? 8 : 16 }) + (cmd ? `<p style="margin:0 0 24px;line-height:2;">${code(cmd)}</p>` : '') + details(rows.map(([k, v]) => [k, esc(v)])) + (body ? quote(longHtml(body), 'What they wrote:') : '') },
    text: {
      before: [cmd ? `${lead}\n\n    ${cmd}` : lead, rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${plain(v)}`).join('\n') || null,
        body ? `What they wrote:\n${quoteText(body)}` : null, postUrl && email ? `Article: ${postUrl}` : null],
    },
    ...btn,
    why: 'You got this alert because this address is set to receive comment alerts for the Mayobe Bros comments Worker.',
    links: [['Visit Mayobe Bros', `${origin}/`], ['Comment policy', `${origin}/comment-policy/`]],
  });
}

/* ------------------------------------------------------------------ contact form */

export const CONTACT_TYPES = {
  general: 'General question', support: 'Technical support', technical: 'Technical issue', advertising: 'Advertising',
  editorial: 'Editorial feedback', partnership: 'Partnership', press: 'Press and media', other: 'Other',
};
const typeLabel = (t) => (typeof t === 'string' && Object.prototype.hasOwnProperty.call(CONTACT_TYPES, t) ? CONTACT_TYPES[t] : (oneLine(t) ? 'Other' : 'General question'));
const when = (v) => {
  try {
    if (v === undefined || v === null || v === '') return '';
    const t = typeof v === 'number' || v instanceof Date ? new Date(v) : new Date(str(v));
    return Number.isNaN(t.getTime()) ? clip(v, 40) : t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  } catch { return clip(v, 40); }
};

// Owner only: the full message, escaped. reply_to is set to the visitor by the sender (Task 6).
export function contactOwnerEmail(data, site) {
  const d = pick(data, ['subject', 'type', 'email', 'name', 'receivedAt', 'message']);
  const { origin } = resolveSite(site);
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
    kickerText: `Contact form · ${type}`, heading: H('New message from the contact form', 'NEW MESSAGE FROM THE CONTACT FORM'),
    html: {
      before: p(esc(lead)) + details(rows.map(([k, v]) => [k, esc(v)])) + quote(longHtml(message), 'Message:'),
      after: p(esc(tip), { muted: true }),
    },
    text: { before: [lead, rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${plain(v)}`).join('\n'), `Message:\n${quoteText(message)}`], after: [tip] },
    buttonUrl: mailto(email, `Re: ${clip(d.subject, 100) || 'Your message to Mayobe Bros'}`), buttonShown: email || '(no address)', buttonLabel: 'Reply to this message', signoff: false,
    why: 'You got this email because someone sent a message through the contact form on mayobebros.com.',
    links: [['Visit Mayobe Bros', `${origin}/`], ['Contact page', `${origin}/contact/`]],
  });
}

// Sent to an address that has not been verified: fixed text only. No name, subject, type or message is echoed.
export function contactVisitorEmail(data, site) {
  const { origin } = resolveSite(site);
  const lines = [
    'Hello,',
    'Your message reached us. If it needs a reply, we will write to the address you gave us.',
    'Emails sometimes land in the spam folder, so please check there too.',
  ];
  const privacy = 'For your privacy, this email does not repeat your message.';
  const wait = 'You are welcome to read our latest articles.';
  return build({
    site, subject: 'We received your message',
    preheader: 'Thank you for writing to Mayobe Bros. Your message reached us. If it needs a reply, we will write to the address you gave.',
    kickerText: 'Message received', heading: H('Thank you for your message', 'THANK YOU FOR YOUR MESSAGE'),
    html: { before: lines.map((l) => p(esc(l))).join('') + p(esc(privacy), { muted: true }) + p(esc(wait)) },
    text: { before: [...lines, privacy, wait] },
    buttonUrl: `${origin}/post/`, buttonLabel: 'Read the latest articles',
    why: 'You got this email because this address was entered in the contact form on mayobebros.com. If that was not you, you can ignore it.',
    links: commonLinks(origin),
  });
}

/* ------------------------------------------------------------------ newsletter (sent by Plan 3; never visitor text) */

// One article for the newsletter emails, cleaned: links must be ours (ownUrl), pictures our own email JPEGs (ownImage).
// video = { image, url } survives only when both pass; a video post without a usable video picture is shown as a
// normal post. alt: one line, at most 150 characters, else the title.
function cleanPost(item, origin, assetOrigin, titleMax) {
  const x = pick(item, ['title', 'url', 'excerpt', 'category', 'image', 'thumb', 'imageAlt', 'video']);
  const v = pick(x.video, ['image', 'url']);
  const title = clip(x.title, titleMax);
  const vImage = ownImage(v.image, assetOrigin);
  const vUrl = ownUrl(v.url, origin, '');
  return {
    title, url: ownUrl(x.url, origin, ''), category: clip(x.category, 40),
    image: ownImage(x.image, assetOrigin), thumb: ownImage(x.thumb, assetOrigin),
    alt: clip(x.imageAlt, 150) || title,
    video: vImage && vUrl ? { image: vImage, url: vUrl, alt: clip(`Watch the video: ${title}`, 150) } : null,
    rawExcerpt: x.excerpt,
  };
}
const watchLink = (url) => p(link(url, 'Watch the video', 'font-weight:bold;'), { mb: 16 });

export function confirmSubscriptionEmail(data, site) {
  const d = pick(data, ['confirmUrl']);
  const { origin } = resolveSite(site);
  const url = ownUrl(d.confirmUrl, origin, `${origin}/`);
  const a = 'Someone, we hope you, asked to get new Mayobe Bros articles by email at this address.';
  // The button opens /newsletter/, where one more press confirms (so mail scanners that open links sign nobody up).
  const how = 'The button opens a page on our website. Press Confirm my subscription there to finish.';
  const copy = 'If the page does not open, copy the link below into your browser. If it still does not work, reply to this email and tell us.';
  const b = 'We will not send you any newsletter email until you confirm. If you did not ask for this, ignore this email and nothing more will be sent.';
  return build({
    site, subject: 'Please confirm your Mayobe Bros subscription',
    preheader: 'Please confirm that you want new Mayobe Bros articles by email. Nothing will be sent until you press the button.',
    kickerText: 'Newsletter', heading: H('Confirm your subscription', 'CONFIRM YOUR SUBSCRIPTION'),
    html: { before: p(esc(a)) + p(esc(how)), after: p(esc(b), { muted: true }) },
    text: { before: [a, how, copy], after: [b] },
    buttonUrl: url, buttonLabel: 'Confirm my subscription', fallbackLead: copy,
    why: 'You got this email because this address was entered in the newsletter form on mayobebros.com.',
    links: commonLinks(origin),
  });
}

// latestPosts = [{ title, url, excerpt?, category?, image?, thumb?, imageAlt?, video?: { image, url } }] from the site's
// own data (search.json, newest first); at most 3 are shown: the first as a lead card with its large picture (or the
// video picture, linked to the video), the next two as rows with a 112 x 84 thumbnail. Every title is a live-text link
// and every picture links to an address that also has a text link, so the email works with pictures blocked.
export function welcomeEmail(data, site) {
  const d = pick(data, ['unsubscribeUrl', 'latestPosts']);
  const { origin, assetOrigin } = resolveSite(site);
  const unsub = ownUrl(d.unsubscribeUrl, origin, `${origin}/contact/`);
  const posts = asList(d.latestPosts)
    .map((item) => cleanPost(item, origin, assetOrigin, 160))
    .map((x) => ({ ...x, excerpt: clip(x.rawExcerpt, 220) }))
    .filter((x) => x.title && x.url).slice(0, 3);
  const cat = (x) => [x.category, x.video ? 'Video' : ''].filter(Boolean).join(' · ');
  const leadHtml = (x) => {
    const pic = x.video ? picture(x.video.image, LEAD.w, LEAD.h, x.video.alt, x.video.url, 10, LEAD.max) : x.image ? picture(x.image, LEAD.w, LEAD.h, x.alt, x.url, 10, LEAD.max) : '';
    return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">`
      + (pic ? `<tr><td style="padding:0 0 18px;">${pic}</td></tr>` : '')
      + '<tr><td>' + (cat(x) ? catLine(cat(x)) : '') + titleLink('h2', x.url, x.title, 22, 8)
      + (x.excerpt ? p(esc(x.excerpt), { muted: true, size: 15, mb: x.video ? 8 : 16 }) : '') + (x.video ? watchLink(x.video.url) : '') + '</td></tr></table>';
  };
  const rowHtml = (x) => `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>`
    + (x.thumb ? `<td class="mb-rule" width="128" style="width:128px;padding:16px 16px 16px 0;border-top:1px solid ${L.rule};vertical-align:top;">${picture(x.thumb, 112, 84, x.title, x.url, 8)}</td>` : '')
    + `<td class="mb-rule" style="padding:16px 0;border-top:1px solid ${L.rule};vertical-align:top;">${cat(x) ? catLine(cat(x), 6) : ''}${titleLink('h3', x.url, x.title, 17, 0)}</td></tr></table>`;
  const a = 'Thank you for confirming. When we publish a new article, we will send you one short email about it.';
  const b = 'We write clear, honest guides on education, jobs, money and technology for readers in Tanzania.';
  const c = 'You can stop at any time with the unsubscribe link at the bottom of every email.';
  const list = posts.length ? kicker('Latest articles') + leadHtml(posts[0]) + posts.slice(1).map(rowHtml).join('') + (posts.length > 1 ? hairline(8) : '') : '';
  return build({
    site, subject: 'Welcome to the Mayobe Bros newsletter',
    preheader: 'You are now subscribed to Mayobe Bros. We will email you when a new article is published, and you can stop any time.',
    kickerText: 'Welcome', heading: H('You are subscribed', 'YOU ARE SUBSCRIBED'),
    html: { before: p(esc(a)) + p(esc(b), { mb: posts.length ? 32 : 16 }) + list, after: p(esc(c), { muted: true }) },
    text: { before: [a, b, posts.length ? 'Latest articles:\n\n' + posts.map((x) => `${plain(x.title)}\n${x.url}${x.video ? `\nWatch the video: ${x.video.url}` : ''}`).join('\n\n') : null], after: [c] },
    buttonUrl: `${origin}/post/`, buttonLabel: 'Read the latest articles',
    why: 'You got this email because you confirmed a subscription to new articles from mayobebros.com.',
    links: [['Unsubscribe', unsub], ...commonLinks(origin)],
  });
}

// post = { title, url, excerpt?, category?, image?, imageAlt?, video?: { image, url } }. image and video.image are our
// own email JPEGs (ownImage: https, /assets/email/, v=<hash>), never the share card. The picture is a full-bleed hero
// above the card body (598 x 336, up to 620 px wide on a phone), linked to the article; for a video post it is the video picture (our cover with a
// play disc drawn in), linked to the video on the article page, with a "Watch the video" text link as well.
export function newPostEmail(data, site) {
  const d = pick(data, ['post', 'unsubscribeUrl']);
  const { origin, assetOrigin } = resolveSite(site);
  const post = cleanPost(d.post, origin, assetOrigin, 200);
  const url = post.url || `${origin}/`;
  const unsub = ownUrl(d.unsubscribeUrl, origin, `${origin}/contact/`);
  const title = post.title || 'A new article';
  const excerpt = clip(post.rawExcerpt, 400);
  const v = post.video;
  const heroHtml = v ? picture(v.image, HERO.w, HERO.h, clip(`Watch the video: ${title}`, 150), v.url, 0, HERO.max) : post.image ? picture(post.image, HERO.w, HERO.h, post.alt || title, url, 0, HERO.max) : '';
  const pre = clip(post.rawExcerpt, 130);
  const c = 'You can stop these emails at any time with the unsubscribe link below.';
  return build({
    site, subject: `New article: ${clip(post.title, 110) || 'Mayobe Bros'}`,
    preheader: pre.length >= 90 ? pre : 'A new article is on Mayobe Bros. Read the short summary here, then open the full article when you are ready.',
    kickerText: post.category ? `New article · ${post.category}` : 'New article', heading: H(esc(title), plain(title)), heroHtml,
    html: {
      before: (excerpt ? p(esc(excerpt)) : '') + (v ? watchLink(v.url) : ''),
      after: p(esc(c), { muted: true }),
    },
    text: { before: [excerpt ? plain(excerpt) : null, v ? `Watch the video: ${v.url}` : null], after: [c] },
    buttonUrl: url, buttonLabel: 'Read the article',
    why: 'You got this email because you subscribed to new articles from mayobebros.com.',
    links: [['Unsubscribe', unsub], ...commonLinks(origin)],
  });
}

export function farewellEmail(data, site) {
  const d = pick(data, ['resubscribeUrl']);
  const { origin } = resolveSite(site);
  const url = ownUrl(d.resubscribeUrl, origin, `${origin}/`);
  const a = 'We have removed this address from our newsletter list. This is the last newsletter email we will send to it.';
  const b = 'If you unsubscribed by mistake, you can subscribe again with the button below. Thank you for reading Mayobe Bros.';
  return build({
    site, subject: 'You have unsubscribed from Mayobe Bros',
    preheader: 'You have been unsubscribed from the Mayobe Bros newsletter. This is the last newsletter email we will send to you.',
    kickerText: 'Newsletter', heading: H('You are unsubscribed', 'YOU ARE UNSUBSCRIBED'),
    html: { before: p(esc(a)) + p(esc(b)) },
    text: { before: [a, b] },
    buttonUrl: url, buttonLabel: 'Subscribe again',
    why: 'You got this email to confirm that this address was unsubscribed from the Mayobe Bros newsletter.',
    links: commonLinks(origin),
  });
}
