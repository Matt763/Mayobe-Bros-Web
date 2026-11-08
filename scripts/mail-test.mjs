#!/usr/bin/env node
// Owner-run: sends ONE built email template to ONE address through the real sendMail (Resend), to look at it in
// Gmail, Outlook and Yahoo on a phone. It also shows Resend's real error body if something is wrong.
//
//   RESEND_API_KEY=re_xxx node scripts/mail-test.mjs <template> <to> --yes [--pages-live]
//   node scripts/mail-test.mjs <template> --dry      prints the subject and text part; needs no key, sends nothing
//   node scripts/mail-test.mjs --list
//
// Nothing is sent without --yes. The key comes only from the environment and is never printed; neither is the body.
// Links are on https://mayobebros.com only. Article titles, links and pictures come from this build's data/search.json
// (the newest post, and the post with a video for new-post-video), so every article link is a real page. Templates whose
// buttons open /newsletter/ or /manage/ refuse without --pages-live: those pages are not live until they are pushed (try
// the flow locally with DEV_MAIL_REAL=1 instead, see worker/README.md). The daily budget and suppression list live in a
// throw-away in-memory database, so this does not touch the live one (it can still use up Resend's 100 a day).
import fs from 'node:fs';
import { makeD1 } from './lib/d1-shim.mjs';
import { sendMail } from '../worker/src/mail.js';
import * as T from '../worker/src/mail-templates.js';

const ORIGIN = 'https://mayobebros.com';
const SITE = { origin: ORIGIN, logoUrl: `${ORIGIN}/assets/email/logo.png` };
const HEX8 = /^[0-9a-f]{8}$/;
const today = new Date().toISOString().slice(0, 10);
const SEARCH = (() => { try { return JSON.parse(fs.readFileSync(new URL('../data/search.json', import.meta.url), 'utf8')); } catch { return []; } })()
  .filter((e) => e && typeof e.t === 'string' && typeof e.u === 'string' && /^\/post\/[a-z0-9/-]*$/.test(e.u) && typeof e.d === 'string' && e.d <= today)
  .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
// One search.json entry as the newsletter builds it (worker/src/newsletter.js emailPost).
const article = (e) => {
  if (!e) return { title: 'Mayobe Bros articles', url: `${ORIGIN}/post/`, excerpt: 'The latest articles on Mayobe Bros.' };
  const url = `${ORIGIN}${e.u}`;
  const pic = (kind, v) => `${ORIGIN}/assets/email/${kind}-${e.s}.jpg?v=${v}`;
  return {
    title: e.t, url, excerpt: e.e, category: e.c, imageAlt: e.a || e.t,
    image: HEX8.test(e.m) ? pic('post', e.m) : '', thumb: HEX8.test(e.m) ? pic('thumb', e.m) : '',
    video: HEX8.test(e.w) ? { image: pic('video', e.w), url: `${url}#video-1` } : null,
  };
};
const POST = article(SEARCH[0]);
const VIDEO_POST = article(SEARCH.find((e) => HEX8.test(e.w)));
const LATEST = SEARCH.slice(0, 3).map(article);

// template name -> [builder, sample data, mail kind, links to /newsletter/ or /manage/]
const TEMPLATES = {
  'manage-link': ['manageLinkEmail', { postTitle: POST.title, postUrl: POST.url, manageUrl: `${ORIGIN}/manage/#l=sampletoken`, notifyWanted: true }, 'commenter', true],
  'reply-notice': ['replyNoticeEmail', { name: 'Amani', postTitle: POST.title, postUrl: `${POST.url}#comments`, replyAuthor: 'Mayobe Bros', replyBody: 'This is a sample reply. Nothing here is real.', unsubscribeUrl: `${ORIGIN}/manage/#u=sampletoken`, isTeam: true }, 'commenter', true],
  'owner-held': ['ownerAlertEmail', { kind: 'held', reason: 'contains a link', postSlug: 'sample', postUrl: POST.url, commentId: 1, name: 'Sample', body: 'This is a sample held comment.' }, 'owner', false],
  'owner-question': ['ownerAlertEmail', { kind: 'question', reason: 'looks like a question', postSlug: 'sample', postUrl: POST.url, commentId: 2, name: 'Sample', body: 'Is this a sample question?' }, 'owner', false],
  'owner-contact-failed': ['ownerAlertEmail', { kind: 'contact-failed', reason: 'sample', email: 'sample@example.com', name: 'Sample', body: 'This is a sample message.' }, 'owner', false],
  'contact-owner': ['contactOwnerEmail', { name: 'Sample', email: 'sample@example.com', subject: 'Sample subject', message: 'This is a sample contact message.', type: 'editorial', receivedAt: Date.now() }, 'contact', false],
  'contact-visitor': ['contactVisitorEmail', { name: 'Sample', subject: 'Sample', type: 'editorial' }, 'contact', false],
  'confirm-subscription': ['confirmSubscriptionEmail', { confirmUrl: `${ORIGIN}/newsletter/#c=sample` }, 'news', true],
  'welcome': ['welcomeEmail', { unsubscribeUrl: `${ORIGIN}/newsletter/#u=sample`, latestPosts: LATEST }, 'news', true],
  'new-post': ['newPostEmail', { post: POST, unsubscribeUrl: `${ORIGIN}/newsletter/#u=sample` }, 'news', true],
  'new-post-video': ['newPostEmail', { post: VIDEO_POST, unsubscribeUrl: `${ORIGIN}/newsletter/#u=sample` }, 'news', true],
  'farewell': ['farewellEmail', { resubscribeUrl: `${ORIGIN}/newsletter/` }, 'news', true],
};

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [name, to] = args.filter((a) => !a.startsWith('--'));
const usage = 'Usage: RESEND_API_KEY=... node scripts/mail-test.mjs <template> <to> --yes [--pages-live]\n       node scripts/mail-test.mjs <template> --dry\n       node scripts/mail-test.mjs --list';

if (flags.includes('--list')) { console.log(Object.keys(TEMPLATES).join('\n')); process.exit(0); }
if (!name || !TEMPLATES[name] || (!to && !flags.includes('--dry'))) { console.error(usage); process.exit(2); }

const [builder, data, kind, pageLinks] = TEMPLATES[name];
const built = T[builder](data, SITE);
if (flags.includes('--dry')) {
  console.log(`subject: [TEST] ${built.subject}\n\n${built.text}`);
  process.exit(0);
}
if (pageLinks && !flags.includes('--pages-live')) {
  console.error('This email links to /newsletter/ or /manage/, which are not on the live site until they are pushed. Use --pages-live once they are, or try the flow locally with DEV_MAIL_REAL=1 (worker/README.md).');
  process.exit(1);
}
if (!flags.includes('--yes')) {
  console.error(`Refusing to send. This would send the "${name}" sample email to ${to} through Resend. Add --yes to do it.`);
  process.exit(2);
}

const env = { DB: makeD1(), RESEND_API_KEY: process.env.RESEND_API_KEY || '', MAIL_FROM: process.env.MAIL_FROM, MAIL_FROM_SUPPORT: process.env.MAIL_FROM_SUPPORT };
// contact-owner carries a reply_to, which also checks Resend's field name
const r = await sendMail(env, { waitUntil() {} }, { kind, to, subject: `[TEST] ${built.subject}`, html: built.html, text: built.text, replyTo: name === 'contact-owner' ? 'sample@example.com' : undefined, key: `mail-test-${name}-${Date.now()}` });
if (r.ok) console.log(`sent: template=${name} status=${r.status} id=${r.id || '(none)'}`);
else console.log(`not sent: template=${name} ${r.skipped ? `skipped=${r.skipped}` : `status=${r.status ?? 'none'} (see the error line above)`}`);
process.exitCode = r.ok ? 0 : 1;
