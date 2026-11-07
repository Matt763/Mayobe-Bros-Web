# Comment controls, Resend email and newsletter: design

Date: 2026-11-06. Status: Phase 1 (comment edit, delete and likes) and Phase 2 (email through Resend) are implemented on branch `comment-controls`, pending the owner's deploy (checklist: `worker/README.md`). Phase 3 (newsletter) is implemented on the same branch, pending the owner's deploy (go-live order: `worker/README.md`).

## Why

Readers who comment on mayobebros.com cannot fix a typo, take a comment back or like someone else's comment. Taking one back today means emailing the owner with the article link and the comment text (`content/pages/comment-policy.html`). The owner also wants the email the old React/Supabase project had, sent through Resend (`/run/media/mclean/New Volume/MY WEBSITE PROJECTS/Main.Mayobe.Bros`): contact-form mail, a newsletter with welcome, unsubscribe and new-post emails, and notices around comments.

## What exists now (facts, checked in this repo)

- Static site on GitHub Pages. The only backend is the Cloudflare Worker in `worker/` (plain JS, no dependencies, D1 database `mayobe-engage`, migrations `0001`..`0003`).
- No accounts. A commenter is a name, an optional email (never shown) and a random browser ID `cid` kept in localStorage as `mb_cid`.
- New comments are screened by `worker/src/moderation.js`. A clean one is published at once, a flagged one is held as `pending` until the owner approves it (`node scripts/comments.mjs`).
- Replies are one level deep. The owner replies as "Team" through the admin API.
- Contact form (`contactForm()` in `scripts/lib/render.mjs`) has `formAction: ""`, so `js/site.js` opens the visitor's mail app. Footer newsletter form is off (`newsletterAction: ""`, the footer shows "Follow with RSS" instead).
- Tests run the Worker against a real SQLite engine (`scripts/tests/worker.test.mjs`, `scripts/lib/d1-shim.mjs`).
- `content/qa.json` stores a plain-text copy of team-answered questions and the team's replies. It is written into the built post pages by `scripts/qa-sync.mjs` + build.

## Goals

1. A commenter can edit and delete their own comment, and anyone can like a comment, with no account.
2. The Worker sends email through Resend: comment notices, contact form, newsletter.
3. Everything stays honest and private: no secret in the repo, no personal data in emails to others, policy pages updated to match, AdSense rules respected (CLAUDE.md "Rules that protect AdSense approval").

## Non-goals

- User accounts, passwords, password reset codes. (The old project's account emails are not ported: this site has no accounts.)
- Editing or deleting other people's comments from the page. The owner keeps using `scripts/comments.mjs`.
- Paid services or new npm dependencies. Resend's free plan (100 emails a day, 3,000 a month, checked 2026-11-06) is the budget.
- Rich text or links in comments. Links stay refused.

## Anti-goals (a failure even if it "works")

- Anyone can edit or delete someone else's comment, or learn it from a numeric id.
- An edit lets a clean comment turn into abuse or spam without being screened.
- The site can be used to send email to a stranger's address, or to drain the free quota.
- A failed email makes a comment, a contact message or a signup fail or vanish.
- A deleted comment's text or name stays in the database.
- Email text from a visitor is put into HTML unescaped (the old project did this).

## Decisions made by the owner (2026-11-06)

- Scope: comments emails, contact form and the newsletter ("everything the old site did").
- Resend: domain `mayobebros.com` is already verified in the owner's Resend account. Sender addresses used by the old project: `Mayobe Bros <info@mayobebros.com>` and `support@mayobebros.com`.
- Edit window: 30 minutes.

## Build order (three phases, each releasable on its own)

### Phase 1: edit, delete, like (no email needed)

Calls below are the builder's starting point, not a final API. All are `POST` with the existing Origin check, JSON bodies, and the existing per-hashed-IP rate limits.

- **Ownership.** `POST /v1/posts/:slug/comments` also returns a `token` once (at least 128 random bits, base64url). The Worker stores only its SHA-256 (`manage_hash`) on the comment. The browser keeps `{commentId: token}` in localStorage key `mb_own`. Tokens go in the JSON body or `Authorization` header, never in a URL. Compare with a constant-time check. A wrong token and a missing comment give the same 404.
- **Edit** `POST /v1/comments/:id/edit {token, body}`: allowed for 30 minutes after creation and only while the comment has no replies. Runs the exact create-time screen (`screen`, `LINK_RE`, length rules). If flagged, the comment goes back to `pending`, is hidden from the public list, and the owner sees `flag` plus the previous text (`prev_body`). Sets `edited_at`; the public list shows "edited". The edit limit counts per `cid` and hashed IP.
- **Delete** `POST /v1/comments/:id/delete {token}`: any time. A comment with replies becomes a tombstone ("This comment was deleted"): `body`, `name`, `email`, `manage_hash`, `prev_body`, `ip_hash`, `cid` are blanked and `status` becomes `deleted`; the tombstone is purged when its last reply is gone. A comment with no replies is removed from the table. `post_stats.comments` is adjusted in the same `batch()` (transaction).
- **Like** `POST /v1/comments/:id/like {cid, on: true|false}`: table `comment_likes(comment_id, voter, created)` with `UNIQUE(comment_id, voter)`, `voter` = cid. Counter `comments.likes`, updated in the same `batch()`. The list response includes `likes` per comment, and `GET /v1/posts/:slug/mine` (or a sibling) tells the browser which comments this visitor liked. No likes on pending, deleted or team-deleted comments.
- **Page.** `js/engage.js` `commentNode()` adds Like, and, for comments whose token is in `mb_own`, Edit and Delete. Edit is an inline textarea with Save and Cancel; Delete asks to confirm. Accessible: real buttons, 24 px minimum targets, `role="status"` messages, focus moves to the Save/Edit button after edit, to the next comment or the list after delete, and returns to the invoker when a dialog closes. Matches the site's existing CSS (`css/style.css`, unique `@keyframes` names).
- **Migration `0004`** adds `manage_hash`, `edited_at`, `prev_body`, `likes` and the `comment_likes` table. Existing comments have no `manage_hash`, so they cannot be self-edited (the owner can still delete them).
- **Tests** extend `scripts/tests/worker.test.mjs`: wrong token, other post, outside the window, with replies, flagged edit goes to pending, tombstone blanks personal fields, stats stay correct, like dedupe, rate limits.
- **Docs.** Update `comment-policy.html` ("Remove your comment" becomes self-service, email remains as fallback), `privacy-policy.html` (token hash, likes, `prev_body` kept for moderation and erased on delete), `cookie-policy.html` (new `mb_own` localStorage key), `worker/README.md`, CLAUDE.md pointer.
- **Known gap, stated in the UI copy and README.** A team-answered question is also copied into `content/qa.json` and the built page. A self-delete removes it from the live list but not from that saved copy until the owner runs `node scripts/qa-sync.mjs`, builds and pushes. The Worker's delete response and `scripts/comments.mjs` print this reminder. Editing is blocked once a comment has a reply, so a saved question cannot drift from its answer.

### Phase 2: Resend core, comment emails, contact form

- **Sending.** One module `worker/src/mail.js`, plain `fetch` to `https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>`, `Content-Type: application/json` and an explicit `User-Agent` (Resend returns 403 without one). Fields: `from`, `to`, `subject`, `html`, `text` (always a plain-text part), `reply_to`, `headers`, `tags`. `Idempotency-Key` on every send (for example `comment-<id>-<kind>`). If the key is missing the module logs and skips; it never throws into a request. Sent inside `ctx.waitUntil` after the data is saved. Error bodies and the `reply_to` field name are not shown in Resend's docs, so the first live test confirms them.
- **Secrets and config.** `RESEND_API_KEY` is a Worker secret (`wrangler secret put`), `.dev.vars` for local runs (already git-ignored). Variables in `wrangler.jsonc`: `MAIL_FROM`, `MAIL_FROM_SUPPORT`, `OWNER_EMAIL` (where alerts go). No key is ever written to a file in the repo.
- **Templates.** Ported from the old `server/utils/resend.ts` (navy `#0f1c2e`, gold `#c9a000`, Georgia headings, 600 px table with inline styles, hidden preheader), rewritten as pure functions in `worker/src/mail-templates.js`. Every visitor-supplied value is HTML-escaped; names and subjects have CR/LF removed. Logo points at the site's own logo URL on `mayobebros.com`. The old broken parts (unescaped input, `Math.random` codes, in-memory rate limit, hard-coded secret fallback) are not copied.
- **Daily budget.** A D1 counter caps sends at a fixed number a day (default 80, under Resend's 100/day free limit). Owner alerts and commenter-requested mail are sent first; newsletter mail uses what is left. At the cap the Worker skips and records that it did.
- **Comment emails (only when the commenter typed an email).**
  1. *Manage link.* After a comment is saved the commenter can ask for a link; the site never sends mail to an address on its own at posting time. The form's email field gets a checkbox "Email me a link to edit or delete this comment, and tell me when someone replies" (off by default). When ticked, the Worker emails one message with a link `https://mayobebros.com/manage/#<token>` (fragment, so it is not sent to servers or in Referer). Link tokens are random, stored hashed, reusable until they expire in 7 days, and the manage page works only for that comment. Limits: one such email per address per day, per IP, per day.
  2. *Reply notice.* If ticked, the commenter gets one email when the team or anyone replies, with the reply escaped and an unsubscribe link. At most one per comment per day.
  3. *Owner alert.* The owner gets an email for a new comment that is held for review (reason shown) and for new reader questions. Plain list, no HTML from the visitor.
  The manage page (`/manage/`, a built page, `noindex`) lets the commenter edit or delete from any device using the link, without `mb_own`. Same server rules as Phase 1.
- **Contact form.** `POST /v1/contact {name, email, subject, message, type}` replaces mailto when the endpoint is set (`contact.formAction`). Honeypot + minimum time + Turnstile if enabled + per-IP and per-address limits. The owner gets a notice with `reply_to` set to the visitor; the visitor gets a short confirmation. If email fails the form says so and the visitor still sees the mailto fallback. Contact messages are not kept in the database beyond a short delivery log (id, time, status), because the email itself is the record.
- **Bounces and complaints.** `POST /v1/webhooks/resend` verifies the Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) against the raw body with the signing secret `RESEND_WEBHOOK_SECRET`; on `email.bounced` / `email.complained` the address goes to a `suppressed` table and is never mailed again.
- **Policy pages.** `privacy-policy.html`: Resend as an email processor, what is sent and when; contact form data; reply-notice opt-in; retention. `comment-policy.html`, `cookie-policy.html` unchanged beyond Phase 1 unless a new storage key appears. The build's `{{#comments}}` conditionals are respected.

### Phase 3: newsletter

- **Sign up** `POST /v1/newsletter/subscribe {email}` from the footer form (`newsletterAction` set). Double opt-in: a confirmation email with a one-time link; the address is not subscribed until clicked. Per-IP and per-address limits; one confirmation per address per day.
- **Welcome** after confirmation. **Unsubscribe** by a link in every email (random per-subscriber token, hashed in D1) that works with one click; a farewell email is optional and sent once. Every newsletter message has `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers and a visible footer link. A `/newsletter/` built page explains it and holds the confirm/unsubscribe screens (`noindex`).
- **New-post email.** A Cloudflare Cron Trigger runs once a day, reads `/data/search.json` on the live site, and emails subscribers about posts it has not sent yet (tracked in `newsletter_sent(slug)`). Sends in small batches below Resend's 10 requests a second, stops at the daily budget and continues the next day. A Worker variable `NEWSLETTER_SEND=false` pauses sending without a deploy of code. The owner can also run a dry run from `scripts/newsletter.mjs`.
- **Capacity limit, to tell the owner plainly.** The free plan allows 100 emails a day. Each subscriber is one email, so a post email reaches at most about 27 to 35 subscribers a day (the news slice is 35 a day and confirmations, welcomes and goodbyes share it; the earlier figure of about 80 was wrong) and larger lists take several days or need a paid plan.
- **Legal.** `privacy-policy.html` lists newsletter data and Resend; `terms`/`cookie` pages checked. The site's AdSense rules apply: no income promises or fake numbers in emails.
- **Subscriber export and delete.** `scripts/newsletter.mjs list|remove <email>` (admin token) for requests under privacy law.

## Constraints

- Plain JS, no new dependencies; Cloudflare Workers + D1 free tier; Node 24 portable at `~/tools/node`.
- Do not hand-edit generated files (CLAUDE.md list); pages come from `scripts/lib/render.mjs` and `content/pages/`.
- Never commit secrets (`.admin-token`, `.dev.vars`, API keys). Do not print the old project's `.env`.
- Nothing outward-facing happens without the owner: `wrangler deploy`, `wrangler secret put`, D1 remote migrations, the first live Resend send, `git push`.

## Left to the builder

File and function names, exact SQL, email wording (plain English, the site's writing guide), CSS details, the order of tests inside each phase, and the exact daily budget number (default 80).

## Builder's calls (marked so the owner can change them)

- Edit locked once a comment has a reply (a Remark42 rule) so questions and answers stay consistent.
- Delete is allowed any time; tombstone only while replies exist (Isso model).
- Email actions are opt-in by a checkbox on the form; the site never emails an address just because it was typed.
- Daily send budget of 80, leaving room under the free 100.
- Newsletter is double opt-in and sent by a daily Cron Trigger rather than by hand.

## Calls settled after the builder check (all marked as the builder's calls, change any of them)

1. **Held comments.** Only an `approved` comment can be edited by its author. A `pending` comment can be deleted (hard delete) but not edited, so rewording until the screen passes is impossible. A comment counts as "having replies" when any non-deleted reply (approved or pending) exists. A comment hidden by an edit that was flagged stays `pending` until the owner decides; its author sees "waiting for review" and can still delete it.
2. **Manage link.** The emailed link carries a random token in the URL fragment. `/manage/` exchanges it with one `POST` for that comment's normal manage token (stored in `mb_own` on that device) and the link keeps working for 7 days, not single-use, because it controls only one comment and the fragment never reaches a server log. Link tokens are stored hashed in a `manage_links` table. Limit: one link email per address per day and per IP per day.
3. **Typed emails are verified before more mail.** Ticking "email me" sends exactly one email, the manage link. Reply notices start only after the commenter opens that link (this is the confirmation), and each notice carries an unsubscribe link. A stranger's address can therefore receive at most one email a day from one comment, and nothing after that unless they confirm.
4. **Newsletter first run.** At deploy, `newsletter_sent` is seeded with every existing post, so only posts published after launch are emailed. The cron reads `/data/search.json` (it has slug `s`, title `t`, excerpt `e`, date `d`, image `i`; it lists published posts only; posts dated in the future are skipped by comparing `d` to today).
5. **Turnstile is not set up** (`turnstileSiteKey` is empty in `site.config.json`). The first version does not enable it. Contact and newsletter endpoints rely on the honeypot, the minimum typing time and tight per-IP and per-address limits (contact: 3 an hour per IP, newsletter sign-up: 3 an hour per IP, one confirmation per address per day). Turning Turnstile on later is the documented option if abuse appears; it would need one line in the privacy policy.
6. **Daily budget order.** Reserved slices of the 80 a day: owner alerts 10, commenter manage links and reply notices 25, contact confirmations 10, newsletter the rest. A slice that is full does not use another slice, so a contact flood cannot starve commenter mail.
7. **Deploys, one phase at a time.** For each phase: tests, then the owner approves, then (a) apply the additive D1 migration remotely, (b) deploy the Worker, (c) rebuild and push the site. Migrations only add columns and tables, so the old page keeps working against the new Worker and the new page is pushed last. Rollback is redeploying the previous Worker version (`wrangler rollback`); the extra columns can stay. The owner checks Phase 1 live before Phase 2 starts, and Phase 2 before Phase 3.

## How it will be checked

`node --no-warnings --test scripts/tests/worker.test.mjs scripts/tests/moderation.test.mjs` plus new tests per phase, with Resend replaced by a fake `fetch` in tests; `node scripts/build.mjs`; the page rendered and looked at in a real browser at five widths; one live test email only after the owner approves the deploy. Anything not run is reported as not run.
