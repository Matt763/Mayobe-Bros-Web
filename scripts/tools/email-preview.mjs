#!/usr/bin/env node
// Renders every email template (worker/src/mail-templates.js) to HTML, plain text and PNG screenshots, so a person can
// look at them before anything is sent. Output goes to $HOME/.cache/mayobe-email-preview/ (never into the repo):
//   <name>.html, <name>.txt, <name>-375-light.png, <name>-375-dark.png, <name>-600-light.png, <name>-600-dark.png
// It also prints each template's HTML size in bytes and the contrast result for every pair in PAIRS.
//
// Usage: node scripts/tools/email-preview.mjs [--no-shots] [--only name,name] [--widths 375,600,720]
// Chromium is found like scripts/lib/share.mjs does (CHROME_BIN overrides). It is driven over the DevTools protocol
// with Node's own WebSocket, so dark mode is the real prefers-color-scheme media feature (Emulation.setEmulatedMedia),
// not --force-dark-mode. No npm packages are needed.
//
// The templates point the logo and post pictures at https://mayobebros.com/assets/...; for the screenshots only, those
// URLs are rewritten to the matching files in this repo's assets/ folder, so the preview works offline. The .html
// files written to the cache are the real output, unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../lib/share.mjs';
import { contrast, PAIRS } from '../../worker/src/mail-tokens.js';
import * as T from '../../worker/src/mail-templates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(os.homedir(), '.cache', 'mayobe-email-preview');
const SITE = { origin: 'https://mayobebros.com', logoUrl: 'https://mayobebros.com/assets/img/icon-192.png' };
const args = process.argv.slice(2);
const noShots = args.includes('--no-shots');
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
const only = opt('--only').split(',').filter(Boolean);
const WIDTHS = (opt('--widths') || '375,600').split(',').map(Number).filter((w) => w >= 200 && w <= 2000);

if (OUT.startsWith(ROOT + path.sep)) throw new Error('preview output must not be inside the repo');

/* ------------------------------------------------------------------ sample data (plain English, no real people) */
const P = (slug) => `https://mayobebros.com/post/${slug}/`;
const AJIRA = { title: 'Ajira Portal: How to Apply for Public Service Jobs Step by Step', url: P('ajira-portal-how-to-apply-public-service-jobs') };
const LONG_NAME = 'Neema Wilhelmina Mwakalinga-Kitwana from Mbeya Region, Southern Highlands';
const HOSTILE = '<script>alert("hi")</script> "Quotes" & \'apostrophes\'\r\nBcc: someone@example.com\n\n'
  + 'Hello, I read your guide on the Ajira Portal and I have a question about certified copies. '.repeat(3)
  + '\n\nMy certificates were certified two years ago. Do I need to certify them again before I upload them, or are the old stamps still accepted? '
  + 'I also want to ask whether a scanned colour copy is fine or whether it must be black and white. '.repeat(6)
  + '\n\nThank you for writing these guides. They are clear and easy to follow.';
const LONG_EXCERPT = 'What to prepare, how the Ajira Portal works and which mistakes get a government job application rejected. Plain steps for first-time applicants, '
  + 'with a checklist of documents, the order to fill the profile in, and what to do after you press send, including how to read the status messages.';
const LATEST = [
  { title: AJIRA.title, url: AJIRA.url, excerpt: 'What to prepare, how the Ajira Portal works and which mistakes get a government job application rejected.' },
  { title: 'How to Back Up Your Phone and Move to a New One', url: P('back-up-your-phone-and-move-to-a-new-phone'), excerpt: 'Save your photos, contacts and chats before you change phones, step by step, with free tools.' },
  { title: 'Branding Basics: Choosing a Name, a Logo and Colours', url: P('branding-basics-name-logo-colours'), excerpt: 'Simple, low-cost steps for a small business to look consistent and trustworthy.' },
];

const SAMPLES = [
  ['manage-link', 'manageLinkEmail', { name: 'Amani', commentExcerpt: 'Thanks', postTitle: AJIRA.title, postUrl: AJIRA.url, manageUrl: 'https://mayobebros.com/manage/#l=3f9a2c71b0d84e56', notifyWanted: true }],
  ['manage-link-long-title', 'manageLinkEmail', { postTitle: 'Application Letter for a Job in Tanzania: How to Write One That Gets Read, With a Full Example and a Checklist', postUrl: P('application-letter-for-a-job-tanzania-how-to-write'), manageUrl: 'https://mayobebros.com/manage/#l=3f9a2c71b0d84e56', notifyWanted: false }],
  ['reply-notice', 'replyNoticeEmail', { name: 'Amani', postTitle: AJIRA.title, postUrl: AJIRA.url, replyAuthor: 'Baraka', replyBody: 'I had the same question last year. The portal accepted my older certified copies, but check the advert for each post, because some ask for copies certified recently.', unsubscribeUrl: 'https://mayobebros.com/v1/notify/unsubscribe?t=8c1d', isTeam: false }],
  ['reply-notice-team-long-name', 'replyNoticeEmail', { name: LONG_NAME, postTitle: AJIRA.title, postUrl: AJIRA.url, replyAuthor: 'Mayobe Bros', replyBody: 'Thank you for the question. Each advert lists what it needs. If the advert does not say, an older certified copy is usually fine, but read the advert first.\n\nWe have added a short note about this to the article.', unsubscribeUrl: 'https://mayobebros.com/v1/notify/unsubscribe?t=8c1d', isTeam: true }],
  ['owner-held', 'ownerAlertEmail', { kind: 'held', reason: 'contains a link', postSlug: 'ajira-portal-how-to-apply-public-service-jobs', postUrl: AJIRA.url, commentId: 1287, name: 'Juma', body: 'Good guide. I wrote more tips on my own blog, see example dot com slash ajira.' }],
  ['owner-question', 'ownerAlertEmail', { kind: 'question', reason: 'looks like a question', postSlug: 'ajira-portal-how-to-apply-public-service-jobs', postUrl: AJIRA.url, commentId: 1288, name: LONG_NAME, body: 'Do I need to certify my certificates again if they were certified two years ago?' }],
  ['owner-contact-failed', 'ownerAlertEmail', { kind: 'contact-failed', reason: 'Resend answered 500', email: 'reader.sample@example.com', name: 'Rehema', body: 'Hello, I would like to suggest an article about how to register a small business name. Thank you.' }],
  ['contact-owner', 'contactOwnerEmail', { name: 'Rehema', email: 'reader.sample@example.com', subject: 'Suggestion for an article', message: 'Hello,\n\nI would like to suggest an article about how to register a small business name with BRELA. Many of my friends are confused about the steps.\n\nThank you.', type: 'editorial', receivedAt: Date.UTC(2026, 10, 6, 9, 42) }],
  ['contact-owner-hostile', 'contactOwnerEmail', { name: LONG_NAME, email: 'neema.wilhelmina.mwakalinga.kitwana.long.address@example.com', subject: 'A very long subject line about certified copies, colour scans and what the Ajira Portal accepts in 2026 <b>bold</b>', message: HOSTILE, type: 'support', receivedAt: Date.UTC(2026, 10, 6, 17, 3) }],
  ['contact-visitor', 'contactVisitorEmail', { name: 'Rehema', subject: 'Suggestion', type: 'editorial' }],
  ['confirm-subscription', 'confirmSubscriptionEmail', { confirmUrl: 'https://mayobebros.com/newsletter/#confirm=7b2e' }],
  ['welcome', 'welcomeEmail', { unsubscribeUrl: 'https://mayobebros.com/v1/newsletter/unsubscribe?t=91aa', latestPosts: LATEST }],
  ['new-post', 'newPostEmail', { post: { ...AJIRA, excerpt: 'What to prepare, how the Ajira Portal works and which mistakes get a government job application rejected. Plain steps for first-time applicants.', image: 'https://mayobebros.com/assets/share/post-ajira-portal-how-to-apply-public-service-jobs.jpg', imageAlt: 'Hands typing on a white keyboard next to a laptop on a white desk', category: 'Jobs and internships' }, unsubscribeUrl: 'https://mayobebros.com/v1/newsletter/unsubscribe?t=91aa' }],
  ['new-post-long', 'newPostEmail', { post: { title: 'Application Letter for a Job in Tanzania: How to Write One That Gets Read, With a Full Example and a Checklist', url: P('application-letter-for-a-job-tanzania-how-to-write'), excerpt: LONG_EXCERPT, category: 'Jobs and internships' }, unsubscribeUrl: 'https://mayobebros.com/v1/newsletter/unsubscribe?t=91aa' }],
  ['farewell', 'farewellEmail', { resubscribeUrl: 'https://mayobebros.com/newsletter/' }],
].filter(([name]) => !only.length || only.includes(name));

/* ------------------------------------------------------------------ Chromium over the DevTools protocol */
async function startChrome(bin) {
  const profile = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'mb-email-chrome-'));
  const proc = spawn(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Chromium did not start')), 20000);
    proc.stderr.on('data', (c) => { buf += c; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`Chromium exited (${code})`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), waiters = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) for (const w of waiters.slice()) if (w.method === m.method && w.sessionId === m.sessionId) { waiters.splice(waiters.indexOf(w), 1); w.res(m.params); }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const once = (method, sessionId) => new Promise((res) => waiters.push({ method, sessionId, res }));
  const close = () => { try { ws.close(); } catch { /* closing anyway */ } proc.kill(); fs.rmSync(profile, { recursive: true, force: true }); };
  return { send, once, close };
}

async function shoot(cdp, file, png, width, dark) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 500 });
  await s('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  await s('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  const { result } = await s('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true });
  const height = Math.max(400, Math.min(Number(result.value) || 800, 8000));
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(png, Buffer.from(data, 'base64'));
  // A page wider than the viewport means something overflows on a phone.
  const { result: w } = await s('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth', returnByValue: true });
  await cdp.send('Target.closeTarget', { targetId });
  return { height, overflow: Number(w.value) > width ? Number(w.value) : 0 };
}

/* ------------------------------------------------------------------ run */
fs.mkdirSync(OUT, { recursive: true });
const localAssets = (html) => html.replace(/https:\/\/mayobebros\.com\/(assets\/[A-Za-z0-9/._-]+)/g, (m, rel) => {
  const f = path.join(ROOT, rel);
  return fs.existsSync(f) ? pathToFileURL(f).href : m;
});

console.log('Contrast pairs (WCAG):');
let failed = 0;
for (const [fg, bg, min, label] of PAIRS) {
  const r = contrast(fg, bg);
  if (r < min) failed++;
  console.log(`  ${r >= min ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)} >= ${min}  ${fg} on ${bg}  ${label}`);
}
console.log(failed ? `  ${failed} pair(s) FAIL` : `  all ${PAIRS.length} pairs pass`);

const bin = noShots ? '' : findChrome();
if (!noShots && !bin) console.warn('No Chromium found (set CHROME_BIN, or install one with Playwright): writing HTML and text only.');
const cdp = bin ? await startChrome(bin) : null;
const shotDir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'mb-email-render-'));

console.log('\nTemplates:');
try {
  for (const [name, builder, data] of SAMPLES) {
    const out = T[builder](data, SITE);
    fs.writeFileSync(path.join(OUT, `${name}.html`), out.html);
    fs.writeFileSync(path.join(OUT, `${name}.txt`), `Subject: ${out.subject}\n\n${out.text}`);
    const size = Buffer.byteLength(out.html);
    let note = '';
    if (cdp) {
      const render = path.join(shotDir, `${name}.html`);
      fs.writeFileSync(render, localAssets(out.html));
      const notes = [];
      for (const width of WIDTHS) for (const dark of [false, true]) {
        const r = await shoot(cdp, render, path.join(OUT, `${name}-${width}-${dark ? 'dark' : 'light'}.png`), width, dark);
        if (r.overflow) notes.push(`OVERFLOW ${width}px -> ${r.overflow}px`);
      }
      note = notes.length ? '  ' + notes.join(', ') : '';
    }
    console.log(`  ${name.padEnd(30)} ${String(size).padStart(6)} bytes ${size < 40000 ? '' : 'OVER 40,000'}${note}`);
    console.log(`    subject: ${out.subject}`);
  }
} finally {
  cdp?.close();
  fs.rmSync(shotDir, { recursive: true, force: true });
}
console.log(`\nWritten to ${OUT}`);
if (failed) process.exitCode = 1;
