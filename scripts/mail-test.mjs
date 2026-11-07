#!/usr/bin/env node
// Owner-run: sends ONE built email template to ONE address through the real sendMail (Resend), to look at it in
// Gmail, Outlook and Yahoo on a phone. It also shows Resend's real error body if something is wrong.
//
//   RESEND_API_KEY=re_xxx node scripts/mail-test.mjs <template> <to> --yes
//   node scripts/mail-test.mjs --list
//
// Nothing is sent without --yes. The key comes only from the environment and is never printed; neither is the body.
// The message uses fixed sample text and links on https://mayobebros.com only. The daily budget and suppression list
// live in a throw-away in-memory database, so this does not touch the live one (it can still use up Resend's 100 a day).
import { makeD1 } from './lib/d1-shim.mjs';
import { sendMail } from '../worker/src/mail.js';
import * as T from '../worker/src/mail-templates.js';

const ORIGIN = 'https://mayobebros.com';
const SITE = { origin: ORIGIN, logoUrl: `${ORIGIN}/assets/img/icon-192.png` };
const POST = { title: 'Ajira Portal: How to Apply for Public Service Jobs Step by Step', url: `${ORIGIN}/post/ajira-portal-how-to-apply-public-service-jobs/` };
const NEWS_POST = { ...POST, excerpt: 'What to prepare, how the Ajira Portal works and which mistakes get a job application rejected.', category: 'Jobs and internships' };

// template name -> [builder, sample data, mail kind, sender]
const TEMPLATES = {
  'manage-link': ['manageLinkEmail', { postTitle: POST.title, postUrl: POST.url, manageUrl: `${ORIGIN}/manage/#l=sampletoken`, notifyWanted: true }, 'commenter'],
  'reply-notice': ['replyNoticeEmail', { name: 'Amani', postTitle: POST.title, postUrl: POST.url, replyAuthor: 'Mayobe Bros', replyBody: 'This is a sample reply. Nothing here is real.', unsubscribeUrl: `${ORIGIN}/manage/#u=sampletoken`, isTeam: true }, 'commenter'],
  'owner-held': ['ownerAlertEmail', { kind: 'held', reason: 'contains a link', postSlug: 'sample', postUrl: POST.url, commentId: 1, name: 'Sample', body: 'This is a sample held comment.' }, 'owner'],
  'owner-question': ['ownerAlertEmail', { kind: 'question', reason: 'looks like a question', postSlug: 'sample', postUrl: POST.url, commentId: 2, name: 'Sample', body: 'Is this a sample question?' }, 'owner'],
  'owner-contact-failed': ['ownerAlertEmail', { kind: 'contact-failed', reason: 'sample', email: 'sample@example.com', name: 'Sample', body: 'This is a sample message.' }, 'owner'],
  'contact-owner': ['contactOwnerEmail', { name: 'Sample', email: 'sample@example.com', subject: 'Sample subject', message: 'This is a sample contact message.', type: 'editorial', receivedAt: Date.now() }, 'contact'],
  'contact-visitor': ['contactVisitorEmail', { name: 'Sample', subject: 'Sample', type: 'editorial' }, 'contact'],
  'confirm-subscription': ['confirmSubscriptionEmail', { confirmUrl: `${ORIGIN}/newsletter/#confirm=sample` }, 'news'],
  'welcome': ['welcomeEmail', { unsubscribeUrl: `${ORIGIN}/v1/newsletter/unsubscribe?t=sample`, latestPosts: [NEWS_POST] }, 'news'],
  'new-post': ['newPostEmail', { post: NEWS_POST, unsubscribeUrl: `${ORIGIN}/v1/newsletter/unsubscribe?t=sample` }, 'news'],
  'farewell': ['farewellEmail', { resubscribeUrl: `${ORIGIN}/newsletter/` }, 'news'],
};

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [name, to] = args.filter((a) => !a.startsWith('--'));

if (flags.includes('--list')) { console.log(Object.keys(TEMPLATES).join('\n')); process.exit(0); }
if (!name || !to || !TEMPLATES[name]) {
  console.error('Usage: RESEND_API_KEY=... node scripts/mail-test.mjs <template> <to> --yes\n       node scripts/mail-test.mjs --list');
  process.exit(2);
}
if (!flags.includes('--yes')) {
  console.error(`Refusing to send. This would send the "${name}" sample email to ${to} through Resend. Add --yes to do it.`);
  process.exit(2);
}

const [builder, data, kind] = TEMPLATES[name];
const built = T[builder](data, SITE);
const env = { DB: makeD1(), RESEND_API_KEY: process.env.RESEND_API_KEY || '', MAIL_FROM: process.env.MAIL_FROM, MAIL_FROM_SUPPORT: process.env.MAIL_FROM_SUPPORT };
// contact-owner carries a reply_to, which also checks Resend's field name
const r = await sendMail(env, { waitUntil() {} }, { kind, to, subject: `[TEST] ${built.subject}`, html: built.html, text: built.text, replyTo: name === 'contact-owner' ? 'sample@example.com' : undefined, key: `mail-test-${name}-${Date.now()}` });
if (r.ok) console.log(`sent: template=${name} status=${r.status} id=${r.id || '(none)'}`);
else console.log(`not sent: template=${name} ${r.skipped ? `skipped=${r.skipped}` : `status=${r.status ?? 'none'} (see the error line above)`}`);
process.exitCode = r.ok ? 0 : 1;
