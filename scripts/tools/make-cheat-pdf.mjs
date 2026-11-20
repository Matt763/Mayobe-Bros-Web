#!/usr/bin/env node
// Makes the GTA VI cheat codes PDF (assets/pdf/<out>.pdf) and its cover picture (assets/posts/<out>-cover.webp) from a data file.
//   node scripts/tools/make-cheat-pdf.mjs [--data scripts/tools/data/gta6-cheats.json] [--out gta-6-cheat-codes-guide] [--preview]
// The pages are A4 and drawn in code (a sunset cover with palm trees, a "start here" page, the table S/N | Cheat Code | PS5 | Xbox, a closing page).
// Each page carries the site's watermark (logo mark and domain, as a picture so it never pollutes the PDF's text) and its own footer, so the PDF
// stays ours when it is shared. Headless Chromium prints it (text stays real, selectable and searchable, so the in-site reader can find in it).
// No Rockstar logo, picture or font is used; the title is plain type. The data file holds only codes that were checked (see its "status" field).
// --preview also writes one PNG per page into ~/.cache/mb-cheat-pdf/ to look at before using the PDF.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findChrome, renderPng } from '../lib/share.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const dataFile = path.resolve(ROOT, opt('--data', 'scripts/tools/data/gta6-cheats.json'));
const outName = opt('--out', 'gta-6-cheat-codes-guide');
const preview = argv.includes('--preview');
const chrome = findChrome();
if (!chrome) { console.error('No Chromium found (set CHROME_BIN).'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SITE = 'mayobebros.com';
const SITE_URL = 'https://mayobebros.com/';
const niceDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-cheat-pdf-'));
const cache = path.join(os.homedir(), '.cache', 'mb-cheat-pdf');
fs.mkdirSync(cache, { recursive: true });
const fileUrl = (p) => `file://${p}`;
const LOGO = fileUrl(path.join(ROOT, 'assets/img/logo.png'));
const MARK = fileUrl(path.join(ROOT, 'scripts/tools/logo-mark-source.png'));

/* ---------------------------------------------------------------- button inputs */
const DPAD = { up: '↑', down: '↓', left: '←', right: '→' };
const PS_FACE = { triangle: ['△', 'ps-tri'], circle: ['○', 'ps-cir'], cross: ['✕', 'ps-crs'], square: ['□', 'ps-sqr'] };
const XB_FACE = { y: ['Y', 'xb-y'], b: ['B', 'xb-b'], a: ['A', 'xb-a'], x: ['X', 'xb-x'] };
function key(token) {
  const t = String(token).trim();
  const k = t.toLowerCase();
  if (DPAD[k]) return `<span class="kc kc-d" title="D-pad ${esc(t)}">${DPAD[k]}</span>`;
  if (PS_FACE[k]) return `<span class="kc kc-f ${PS_FACE[k][1]}" title="${esc(t)}">${PS_FACE[k][0]}</span>`;
  if (XB_FACE[k]) return `<span class="kc kc-f ${XB_FACE[k][1]}" title="Button ${esc(t)}">${XB_FACE[k][0]}</span>`;
  return `<span class="kc kc-s">${esc(t)}</span>`; // L1, R1, LB, RB, triggers, sticks and anything else, shown as its own name
}
const keys = (arr) => (arr || []).map(key).join('');
const hold = (arr, then) => `<div class="inp"><span class="hold">Hold</span>${keys(arr.slice(0, 1))}<span class="plus">then press</span>${keys(arr.slice(1, 2))}<span class="then">${then.length ? 'then' : ''}</span>${keys(then)}</div>`;
function input(arr) {
  if (!arr || !arr.length) return '<span class="none">Not confirmed</span>';
  // the first two tokens are the shoulder pair that starts every code (hold the first, press the second); the rest are the sequence
  if (data.entry === 'shoulder-pair' && arr.length > 2) return hold(arr, arr.slice(2));
  return `<div class="inp">${keys(arr)}</div>`;
}

/* ---------------------------------------------------------------- pieces */
function palm(x, y, s, flip, bend = 1) {
  const fr = (a, len, w, c) => `<path transform="rotate(${a})" d="M0 0 C ${len * 0.35} ${-w * 1.5} ${len * 0.75} ${-w * 1.1} ${len} ${w * c} C ${len * 0.7} ${-w * 0.25} ${len * 0.35} ${-w * 0.35} 0 0Z"/>`;
  const leaves = [[-172, 300, 60, 2.6], [-146, 360, 70, 2.2], [-118, 330, 62, 1.5], [-82, 300, 56, 1.2], [-52, 340, 62, 1.7], [-26, 380, 70, 2.4], [-4, 320, 60, 2.8], [16, 250, 48, 2.6], [-198, 250, 48, 2.6]];
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})" fill="#09021a">
<path d="M-18 0 C ${-60 * bend} -420 ${40 * bend} -840 ${150 * bend} -1130 L ${176 * bend} -1126 C ${64 * bend} -840 ${6 * bend} -420 ${28} 0Z"/>
<g transform="translate(${158 * bend} -1128)">${leaves.map((l) => fr(...l)).join('')}<circle r="20"/></g></g>`;
}
function skyline(y, color, seed) {
  let x = 0; let out = ''; let r = seed;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  while (x < 2100) { const w = 40 + rnd() * 90; const h = 40 + rnd() * 190; out += `<rect x="${x.toFixed(0)}" y="${(y - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/>`; x += w + 4 + rnd() * 14; }
  return `<g fill="${color}">${out}</g>`;
}
function coverArt() {
  const grid = [];
  for (let i = -14; i <= 14; i++) grid.push(`<line x1="${1050 + i * 70}" y1="1900" x2="${1050 + i * 640}" y2="2970"/>`);
  let yy = 1900; let gap = 18;
  while (yy < 2970) { grid.push(`<line x1="0" y1="${yy.toFixed(0)}" x2="2100" y2="${yy.toFixed(0)}"/>`); yy += gap; gap *= 1.32; }
  const slats = [0, 1, 2, 3, 4, 5].map((i) => `<rect x="500" y="${1385 + i * 62}" width="1100" height="${10 + i * 7}" fill="#1c0746"/>`).join('');
  const stars = Array.from({ length: 46 }, (_, i) => { const a = (i * 7919) % 2100; const b = (i * 104729) % 1000; return `<circle cx="${a}" cy="${120 + b}" r="${i % 5 === 0 ? 4 : 2.4}" opacity="${0.35 + (i % 4) * 0.15}"/>`; }).join('');
  return `<svg class="art" viewBox="0 0 2100 2970" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12042b"/><stop offset=".38" stop-color="#3b0f6e"/><stop offset=".6" stop-color="#b8226b"/><stop offset=".72" stop-color="#ff6a3d"/><stop offset=".78" stop-color="#ffc45a"/></linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe07a"/><stop offset=".5" stop-color="#ff8a4a"/><stop offset="1" stop-color="#ff2e93"/></linearGradient>
<linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0a52"/><stop offset="1" stop-color="#0a0220"/></linearGradient>
<linearGradient id="glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2e93" stop-opacity=".55"/><stop offset="1" stop-color="#ff2e93" stop-opacity="0"/></linearGradient>
<clipPath id="sunclip"><circle cx="1050" cy="1500" r="520"/></clipPath>
</defs>
<rect width="2100" height="2970" fill="url(#sky)"/>
<g fill="#fff">${stars}</g>
<circle cx="1050" cy="1500" r="700" fill="url(#glow)" opacity=".55"/>
<g clip-path="url(#sunclip)"><rect x="500" y="980" width="1100" height="1040" fill="url(#sun)"/>${slats}</g>
${skyline(1900, '#2b0a56', 7)}${skyline(1900, '#1b0640', 91)}
<rect y="1900" width="2100" height="1070" fill="url(#gnd)"/>
<g stroke="#ff4fa3" stroke-width="3" opacity=".7">${grid.join('')}</g>
<rect y="1900" width="2100" height="6" fill="#ffc45a" opacity=".9"/>
${palm(250, 2300, 1.15, false, 1)}${palm(1900, 2200, 1.0, true, 1)}${palm(60, 2050, 0.7, false, 0.8)}${palm(2060, 2000, 0.62, true, 0.9)}
<rect y="2300" width="2100" height="670" fill="#09021a" opacity=".55"/>
</svg>`;
}

const CHEATS = data.cheats || [];
const ROWS_PER_PAGE = data.rowsPerPage || 9;
const chunks = [];
{
  // a row that is taller (a long description or unlock line) counts as more than one, so a page never overflows
  let cur = []; let load = 0;
  for (const c of CHEATS) {
    const w = 1 + (String(c.effect || '').length > 70 ? 0.35 : 0) + (String(c.unlock || '').length > 70 ? 0.3 : 0) + ((c.ps5 || []).length > 9 || (c.xbox || []).length > 9 ? 0.35 : 0);
    if (load + w > ROWS_PER_PAGE && cur.length) { chunks.push(cur); cur = []; load = 0; }
    cur.push(c); load += w;
  }
  if (cur.length) chunks.push(cur);
}
const PAGE_COUNT = 2 + chunks.length + 1; // cover, start here, table pages, closing page
let pageNo = 2; // the cover is page 1
const pageShell = (inner, cls = '') => {
  const n = pageNo++;
  return `<section class="page ${cls}">${inner}<div class="wm" aria-hidden="true"></div>${`
<header class="hd"><img class="hd-logo" src="${LOGO}" alt="Mayobe Bros"><span class="hd-title">${esc(data.title)}</span></header>
<footer class="ft"><span class="ft-l"><a href="${SITE_URL}">${SITE}</a> &nbsp;·&nbsp; Unofficial fan guide. Not made, checked or endorsed by Rockstar Games, Take-Two Interactive, Sony or Microsoft.</span><span class="ft-r">Page ${n} of ${PAGE_COUNT}</span></footer>`}</section>`;
};

const statusBadge = (s) => `<span class="st st-${esc(String(s || '').toLowerCase().replace(/\s+/g, '-'))}">${esc(s)}</span>`;
const cover = () => `<section class="page cover">${coverArt()}
<div class="cv-top"><span class="cv-chip"><img src="${LOGO}" alt="Mayobe Bros"></span><span class="cv-site">${SITE}</span></div>
<div class="cv-title"><p class="cv-kicker">${esc(data.cover?.kicker || 'Unofficial player\'s guide')}</p><h1><span class="cv-gta">GTA VI</span><span class="cv-sub">${esc(data.cover?.line || 'Cheat Codes')}</span></h1>
<p class="cv-tag">${esc(data.cover?.tagline || '')}</p></div>
<div class="cv-panel"><div><b>Platforms</b><span>PS5 &nbsp;·&nbsp; Xbox Series X|S</span></div><div><b>Checked</b><span>${esc(niceDate(data.checked))}</span></div><div><b>Cheats listed</b><span>${CHEATS.length}</span></div></div>
<p class="cv-fine">Unofficial fan guide by Mayobe Bros. Not made, checked or endorsed by Rockstar Games or Take-Two Interactive. Grand Theft Auto is a trademark of its owner. Prepared for personal use.</p>
<div class="wm" aria-hidden="true"></div></section>`;

const legend = () => `<div class="legend">
<div class="lg"><h3>Controller buttons</h3>
<table class="lgt"><thead><tr><th></th><th>PS5</th><th>Xbox Series X|S</th></tr></thead><tbody>
<tr><td>Left shoulder</td><td>${key('L1')}</td><td>${key('LB')}</td></tr>
<tr><td>Right shoulder</td><td>${key('R1')}</td><td>${key('RB')}</td></tr>
<tr><td>D-pad</td><td colspan="2">${keys(['Up', 'Down', 'Left', 'Right'])}</td></tr>
<tr><td>Face buttons</td><td>${keys(['Triangle', 'Circle', 'Cross', 'Square'])}</td><td>${keys(['Y', 'B', 'A', 'X'])}</td></tr>
</tbody></table></div></div>`;

const startPage = () => pageShell(`<div class="sp">
<p class="eyebrow">Start here</p><h2>${esc(data.start?.heading || 'How to use this guide')}</h2>
${(data.start?.paragraphs || []).map((p) => `<p class="lead">${esc(p)}</p>`).join('')}
${legend()}
<div class="cards">${(data.start?.cards || []).map((c) => `<div class="card"><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div>`).join('')}</div>
<div class="howchecked"><h3>How this list was checked</h3><p>${esc(data.start?.checked || '')}</p>
<p class="small">Status labels: ${statusBadge('Reported')} the same input is printed by several outlets, but Rockstar has not published it and we could not see it confirmed independently. ${statusBadge('Not confirmed')} the cheat is named in the game's list, but no reliable input has been found yet.</p></div></div>`, 'light');

const rowHtml = (c, i, base) => `<tr><td class="sn">${base + i + 1}</td>
<td class="nm"><div class="nm-t">${esc(c.name)} ${statusBadge(c.status)}</div><div class="nm-d">${esc(c.effect)}</div>${c.unlock ? `<div class="nm-u"><b>Unlock:</b> ${esc(c.unlock)}</div>` : ''}</td>
<td class="pl">${input(c.ps5)}</td><td class="pl">${input(c.xbox)}</td></tr>`;
function tablePages() {
  let base = 0;
  return chunks.map((rows, pi) => {
    const html = pageShell(`<div class="tp"><p class="eyebrow">${pi === 0 ? 'The list' : 'The list, continued'}</p><h2>${esc(data.table?.heading || 'Cheat codes for PS5 and Xbox')}</h2>
${pi === 0 && data.table?.note ? `<p class="lead tn">${esc(data.table.note)}</p>` : ''}
<table class="cheats"><thead><tr><th class="sn">S/N</th><th class="nm">Cheat Code</th><th class="pl">PS5</th><th class="pl">Xbox</th></tr></thead><tbody>
${rows.map((c, i) => rowHtml(c, i, base)).join('\n')}
</tbody></table></div>`, 'light');
    base += rows.length;
    return html;
  }).join('\n');
}

const closingPage = () => pageShell(`<div class="sp">
<p class="eyebrow">Before you go</p><h2>${esc(data.closing?.heading || 'Not confirmed yet, and staying safe')}</h2>
${(data.unconfirmed || []).length ? `<div class="howchecked"><h3>Claimed by some sites, not confirmed</h3><p class="small">${esc(data.closing?.unconfirmedNote || '')}</p>
<ul class="ul">${data.unconfirmed.map((u) => `<li><b>${esc(u.name)}</b> — ${esc(u.why)}</li>`).join('')}</ul></div>` : ''}
<div class="cards">${(data.closing?.cards || []).map((c) => `<div class="card"><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div>`).join('')}</div>
<div class="cta"><img src="${MARK}" alt=""><div><h3>More GTA VI guides on ${SITE}</h3><p>Release date, story, console storage, scams and more, in plain English. <a href="${esc(data.pageUrl || SITE_URL)}">${esc((data.pageUrl || SITE_URL).replace(/^https?:\/\//, ''))}</a></p></div></div>
</div>`, 'light');

/* ---------------------------------------------------------------- styles */
const CSS = `
@page { size: 210mm 297mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html { font-family: 'Lato', 'Liberation Sans', 'DejaVu Sans', sans-serif; font-size: 10pt; color: #1b1033; line-height: 1.42; }
a { color: inherit; text-decoration: none; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; background: #fff8f1; }
.page:last-child { page-break-after: auto; break-after: auto; }
.wm { position: absolute; inset: 0; z-index: 30; pointer-events: none; background: url("%WM%") 0 0 / 74mm 74mm repeat; opacity: .13; }
.cover .wm { opacity: .12; }
/* cover */
.cover { background: #12042b; color: #fff; }
.art { position: absolute; inset: 0; width: 100%; height: 100%; }
.cv-top { position: absolute; left: 14mm; right: 14mm; top: 12mm; display: flex; justify-content: space-between; align-items: center; z-index: 2; }
.cv-chip { background: #fff; border-radius: 999px; padding: 2.2mm 6mm; display: inline-flex; box-shadow: 0 2mm 6mm rgba(0,0,0,.35); }
.cv-chip img { height: 8.5mm; display: block; }
.cv-site { font-weight: 800; letter-spacing: .22em; font-size: 9.5pt; text-transform: uppercase; color: #ffe9cf; }
.cv-title { position: absolute; left: 14mm; right: 14mm; top: 44mm; z-index: 2; }
.cv-kicker { font-weight: 800; letter-spacing: .34em; text-transform: uppercase; font-size: 10.5pt; color: #ffc45a; }
.cv-title h1 { margin-top: 4mm; line-height: .9; font-weight: 900; text-transform: uppercase; }
.cv-gta { display: block; font-size: 82pt; letter-spacing: .02em; color: #fff; }
.cv-sub { display: block; margin-top: 3mm; font-size: 33pt; letter-spacing: .12em; color: #ff8fc3; }
.cv-tag { margin-top: 7mm; max-width: 118mm; font-size: 12.5pt; font-weight: 600; color: #ffe9cf; }
.cv-panel { position: absolute; left: 14mm; right: 14mm; bottom: 31mm; z-index: 2; display: grid; grid-template-columns: 1.2fr 1fr .8fr; gap: 0; background: rgba(12,3,32,.78); border: .35mm solid rgba(255,196,90,.7); border-radius: 4mm; }
.cv-panel div { padding: 4mm 5mm; border-right: .3mm solid rgba(255,196,90,.35); }
.cv-panel div:last-child { border-right: 0; }
.cv-panel b { display: block; font-size: 7.5pt; letter-spacing: .22em; text-transform: uppercase; color: #ffc45a; font-weight: 800; }
.cv-panel span { display: block; margin-top: 1mm; font-size: 12pt; font-weight: 800; color: #fff; }
.cv-fine { position: absolute; left: 14mm; right: 14mm; bottom: 12mm; z-index: 2; font-size: 7.4pt; color: #f1d8c4; line-height: 1.45; }
/* interior frame */
.hd { position: absolute; left: 0; right: 0; top: 0; height: 17mm; padding: 0 14mm; display: flex; align-items: center; justify-content: space-between; background: linear-gradient(100deg, #12042b 0%, #3b0f6e 55%, #b8226b 100%); border-bottom: 1.2mm solid #ff8a3c; z-index: 5; }
.hd-logo { height: 7mm; background: #fff; border-radius: 999px; padding: 1.2mm 3.4mm; }
.hd-title { color: #ffe9cf; font-weight: 900; letter-spacing: .26em; font-size: 8.5pt; text-transform: uppercase; }
.ft { position: absolute; left: 14mm; right: 14mm; bottom: 8mm; display: flex; justify-content: space-between; gap: 6mm; font-size: 7.4pt; color: #5b4a78; border-top: .3mm solid #e4cdb9; padding-top: 2.4mm; z-index: 5; }
.ft a { font-weight: 800; color: #b8226b; }
.ft-r { white-space: nowrap; font-weight: 700; }
/* text pages */
.sp, .tp { position: absolute; left: 14mm; right: 14mm; top: 26mm; bottom: 18mm; z-index: 4; }
.eyebrow { font-weight: 900; letter-spacing: .3em; text-transform: uppercase; font-size: 8pt; color: #c2255c; }
h2 { margin-top: 1.5mm; font-size: 23pt; line-height: 1.12; font-weight: 900; color: #1b0b3a; }
h3 { font-size: 11.5pt; font-weight: 900; color: #1b0b3a; }
.lead { margin-top: 3.5mm; font-size: 10.6pt; color: #2b1d47; }
.lead.tn { margin-top: 2.5mm; margin-bottom: 3mm; font-size: 9.2pt; color: #4a3a66; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 5mm; }
.card { background: #fff; border: .3mm solid #ecd5c1; border-left: 1.4mm solid #ff6a3d; border-radius: 2.4mm; padding: 3.6mm 4.4mm; }
.card p { margin-top: 1.2mm; font-size: 9.2pt; color: #3a2b57; }
.howchecked { margin-top: 5mm; background: #fff; border: .3mm solid #ecd5c1; border-left: 1.4mm solid #7b2ff7; border-radius: 2.4mm; padding: 4mm 5mm; }
.howchecked p { margin-top: 1.4mm; font-size: 9.2pt; color: #3a2b57; }
.howchecked .small { font-size: 8.4pt; }
.ul { margin-top: 2mm; padding-left: 4mm; font-size: 9pt; color: #3a2b57; }
.ul li { margin-top: 1mm; }
.cta { margin-top: 6mm; display: flex; gap: 5mm; align-items: center; background: linear-gradient(100deg, #12042b, #3b0f6e 60%, #b8226b); color: #fff; border-radius: 3mm; padding: 5mm 6mm; }
.cta img { width: 17mm; height: 17mm; background: #fff; border-radius: 50%; padding: 2mm; }
.cta h3 { color: #ffc45a; }
.cta p { margin-top: 1mm; font-size: 9.2pt; color: #ffe9cf; }
.cta a { font-weight: 800; color: #fff; text-decoration: underline; }
/* legend */
.legend { margin-top: 5mm; }
.lg h3 { margin-bottom: 2mm; }
.lgt { width: 100%; border-collapse: collapse; background: #fff; border: .3mm solid #ecd5c1; border-radius: 2mm; font-size: 9pt; }
.lgt th, .lgt td { padding: 2mm 3mm; border-bottom: .25mm solid #f0e0d2; text-align: left; vertical-align: middle; }
.lgt th { font-size: 7.6pt; letter-spacing: .16em; text-transform: uppercase; color: #6a5a85; }
.lgt td:first-child { font-weight: 800; color: #2b1d47; width: 32%; }
/* the table */
table.cheats { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 2mm; border: .3mm solid #e1c9b4; border-radius: 3mm; overflow: hidden; background: #fff; }
table.cheats th { background: linear-gradient(100deg, #12042b, #3b0f6e 70%, #6d1f7a); color: #fff; font-size: 8.2pt; letter-spacing: .2em; text-transform: uppercase; font-weight: 900; padding: 3mm 3mm; text-align: left; }
table.cheats td { padding: 2.9mm 3mm; vertical-align: middle; border-bottom: .25mm solid #f0e0d2; }
table.cheats tbody tr:nth-child(even) td { background: #fff6ee; }
table.cheats tbody tr:last-child td { border-bottom: 0; }
td.sn, th.sn { width: 12mm; text-align: center; font-weight: 900; color: #c2255c; }
td.nm, th.nm { width: 62mm; }
.nm-t { font-weight: 900; font-size: 10.4pt; color: #1b0b3a; }
.nm-d { margin-top: .8mm; font-size: 8.6pt; color: #3a2b57; }
.nm-u { margin-top: .8mm; font-size: 8pt; color: #6a5a85; }
.nm-u b { color: #c2255c; }
.st { display: inline-block; margin-left: 1.5mm; padding: .35mm 2mm; border-radius: 99px; font-size: 6.4pt; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; vertical-align: .5mm; }
.st-verified { background: #d8f5e4; color: #0b5d1e; border: .25mm solid #7fcf9d; }
.st-not-confirmed { background: #ece6f5; color: #4a3a66; border: .25mm solid #b9a9d6; }
.st-reported { background: #fff0c8; color: #7a4b00; border: .25mm solid #e6bb55; }
.inp { display: flex; flex-wrap: wrap; align-items: center; gap: 1.1mm; }
.inp .hold, .inp .plus, .inp .then { font-size: 7pt; color: #6a5a85; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.none { font-size: 8.4pt; color: #8a7aa3; font-style: italic; }
.kc { display: inline-flex; align-items: center; justify-content: center; min-width: 6.6mm; height: 6.6mm; padding: 0 1.4mm; border-radius: 1.6mm; font-family: 'DejaVu Sans', 'Lato', sans-serif; font-weight: 700; font-size: 8.4pt; line-height: 1; border: .3mm solid #2b1d47; background: #f5edff; color: #1b0b3a; }
.kc-d { background: #1b0b3a; color: #ffe9cf; border-color: #1b0b3a; font-size: 9.2pt; }
.kc-s { background: #3b0f6e; color: #fff; border-color: #3b0f6e; font-size: 7.6pt; letter-spacing: .04em; }
.kc-f { border-radius: 50%; width: 6.6mm; padding: 0; color: #fff; border: 0; }
.ps-tri { background: #1fb88a; } .ps-cir { background: #e0483f; } .ps-crs { background: #3b82f6; } .ps-sqr { background: #d85fb8; }
.xb-y { background: #d9a400; } .xb-b { background: #d0342c; } .xb-a { background: #2f9e44; } .xb-x { background: #2563eb; }
`;

/* ---------------------------------------------------------------- build */
function wmPng() {
  // one tile, drawn once: the logo mark and the domain, tilted. It is a picture, so the PDF's text stays clean.
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
.t{width:560px;height:560px;position:relative;overflow:hidden}
.i{position:absolute;left:50%;top:50%;width:560px;transform:translate(-50%,-50%) rotate(-28deg);display:flex;flex-direction:column;align-items:center;gap:10px}
.i img{width:120px;height:120px}.i b{font:900 40px/1 Lato,Arial,sans-serif;letter-spacing:.06em;color:#3b2a70}</style>
<div class="t"><div class="i"><img src="${MARK}"><b>${SITE}</b></div></div>`;
  const htmlPath = path.join(tmp, 'wm.html'); const png = path.join(tmp, 'wm.png');
  fs.writeFileSync(htmlPath, html);
  renderPng({ chrome, url: fileUrl(htmlPath), w: 560, h: 560, png, transparent: true });
  return png;
}

const wm = wmPng();
const body = [cover(), startPage(), tablePages(), closingPage()].join('\n');
const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(data.title)}: PS5 and Xbox cheat list | Mayobe Bros</title>
<meta name="author" content="Mayobe Bros"><meta name="description" content="${esc(data.description || '')}"><style>${CSS.replace('%WM%', fileUrl(wm))}</style></head><body>${body}</body></html>`;
const htmlFile = path.join(tmp, 'guide.html');
fs.writeFileSync(htmlFile, doc);

const outDir = path.join(ROOT, 'assets/pdf');
fs.mkdirSync(outDir, { recursive: true });
const pdf = path.join(outDir, `${outName}.pdf`);
execFileSync(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=8000', `--print-to-pdf=${pdf}`, fileUrl(htmlFile)], { stdio: 'pipe', timeout: 120000 });
const bytes = fs.readFileSync(pdf);
const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g) || []).length;
console.log(`PDF: ${path.relative(ROOT, pdf)}  ${(bytes.length / 1024).toFixed(0)} KB  ${pages} pages (expected ${PAGE_COUNT})`);
if (pages !== PAGE_COUNT) { console.error('Page count differs from the design: a page overflowed. Shorten the long rows or lower "rowsPerPage" in the data file.'); process.exitCode = 1; }

// the cover as a picture (for the post and the PDF card): the first page only
const coverHtml = path.join(tmp, 'cover.html');
fs.writeFileSync(coverHtml, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS.replace('%WM%', fileUrl(wm))} html,body{background:#12042b} .page{page-break-after:auto}</style></head><body>${cover()}</body></html>`);
const coverPng = path.join(cache, `${outName}-cover.png`);
renderPng({ chrome, url: fileUrl(coverHtml), w: 794, h: 1123, png: coverPng });
const coverWebp = path.join(ROOT, 'assets/posts', `${outName}-cover.webp`);
execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '640', '0', coverPng, '-o', coverWebp]);
console.log(`Cover: ${path.relative(ROOT, coverWebp)}  ${(fs.statSync(coverWebp).size / 1024).toFixed(0)} KB`);

if (preview) {
  // one tall picture of the whole document, cut into pages with PIL, for looking at
  const tall = path.join(cache, `${outName}-all.png`);
  renderPng({ chrome, url: fileUrl(htmlFile), w: 794, h: 1123 * PAGE_COUNT, png: tall });
  execFileSync('python3', ['-c', `from PIL import Image
im = Image.open(${JSON.stringify(tall)}); h = im.height // ${PAGE_COUNT}
for i in range(${PAGE_COUNT}): im.crop((0, i*h, im.width, (i+1)*h)).save(${JSON.stringify(path.join(cache, `${outName}-p`))} + str(i+1) + '.png')`]);
  console.log(`Previews: ${cache}/${outName}-p1.png ... p${PAGE_COUNT}.png`);
}
