# Comments and reactions API (Cloudflare Worker + D1)

This small API stores comments and the four reactions (Like, Amazed, Sad, Angry). It is free at this
site's size (Cloudflare Workers Free: 100,000 requests a day; D1 Free: 5 GB, 5 million row reads a day).
Comments publish at once when they pass an automatic screen (English + Swahili abusive words, scam lines, phone numbers and emails, shouting). A comment the screen flags is held, and nothing flagged appears until you approve it.

## One-time setup (about 10 minutes)

Run these in the project folder. You need a free Cloudflare account. (Node must be on your PATH:
`export PATH=$HOME/tools/node/bin:$PATH`.)

```bash
cd worker
npx wrangler login                              # opens a browser once to sign in
npx wrangler d1 create mayobe-engage            # prints a database_id
#   -> paste that id into wrangler.jsonc (replace REPLACE_WITH_ID_PRINTED_BY_wrangler_d1_create)
npx wrangler d1 migrations apply mayobe-engage --remote   # applies every file in migrations/
openssl rand -hex 24 | tee ../.admin-token | npx wrangler secret put ADMIN_TOKEN   # the moderation password
openssl rand -hex 24 | npx wrangler secret put HASH_SALT
npx wrangler deploy                             # prints https://mayobe-engage.<your-subdomain>.workers.dev
```

The first `wrangler deploy` may ask you to choose a `workers.dev` subdomain. Choose any name.

Then, in the project root:

1. Put the printed address in `site.config.json`: `"commentsApi": "https://mayobe-engage.<your-subdomain>.workers.dev"`
2. `node scripts/build.mjs` and push. Comments and reactions are now live on every post.

`.admin-token` is git-ignored. Keep it private.

## The automatic screen (English + Swahili)

`worker/src/moderation.js` decides, for every new comment, publish now or hold for review. It never deletes. It checks the name and the text for:
abusive words and phrases in English and Swahili (including Sheng and Tanzanian slang), scam and advert lines, phone numbers, email addresses,
text in capital letters, a flood of one character, and letters of two alphabets mixed in one word. It sees through `sh1t`, `f@ck`, `fuuuck`,
`f u c k`, `f.u.c.k`, `f*ck`, accents and look-alike Cyrillic letters, and it ignores Markdown bold. It matches whole words, so "assess" or
"class" are not flagged, and it accepts English endings (-s, -ing) and Swahili prefixes (m-, wa-, ki-, vi-, u-).
A visitor whose earlier comment you marked as spam is held from then on, and the screen fails closed (if it ever errors, the comment is held).
`node scripts/comments.mjs list` shows each held comment and why it was held.

**The lists** are in `worker/wordlists/`: `english.json`, `swahili.json`, `extra.json` (each has `words`, `stems`, `phrases`, `scam`, plus `sources`
and `notes`) and `exclude.json`. After editing any of them run `node worker/build-wordlist.mjs` (it writes `worker/src/wordlist.js`, which the tests
check is up to date) and deploy again. **A false alarm** (an honest comment was held) is fixed by adding the word or phrase to `exclude.json`;
**a miss** is fixed by adding it to `extra.json`. Run `node --no-warnings --test scripts/tests/moderation.test.mjs` after any change.
The lists were compiled from open sources (LDNOOBW, other open profanity lists, Wiktionary, Kenyan NCIC hate-speech list, a Tanzanian forum dataset
and academic papers on Swahili slang); the source URLs and licences are in the `sources` field of each JSON file. The Swahili list is from published
sources and a model's knowledge, not from a native-speaker review: read `notes` in `swahili.json` for the entries that are least sure, and ask a
Swahili speaker to check it when you can.

**Turn it off:** set `"AUTO_APPROVE": "false"` under `vars` in `wrangler.jsonc` and run `npx wrangler deploy`. Every comment is then held again.
**Remove a published comment** at once with `node scripts/comments.mjs spam <id>` (hides it and its replies) or `delete <id>`.

## Moderating (from the terminal)

```bash
node scripts/comments.mjs list              # comments waiting for review
node scripts/comments.mjs approve 3 4       # publish
node scripts/comments.mjs spam 5            # hide
node scripts/comments.mjs delete 6          # remove
node scripts/comments.mjs reply 1 "Thanks for the love"   # publish a reply from the team under comment 1 (shows a Team badge)
```

## Edit, delete and like (readers, no accounts)

Every new comment gets a secret "manage token" (24 random bytes, shown once in the reply to the visitor's browser, which keeps it). The Worker stores only its SHA-256 hash, so
nobody, including you, can read it back. The token goes in the JSON body, never in the address. All three routes need our `Origin` and are rate limited.

```text
POST /v1/comments/12/edit    {"token":"<token>","body":"New text of the comment"}
POST /v1/comments/12/delete  {"token":"<token>"}
POST /v1/comments/12/like    {"cid":"<visitor id>","on":true}      (on:false removes the like)
GET  /v1/posts/<slug>?cid=<visitor id>      also returns "liked": the ids of comments this visitor liked
```

- **Edit rule:** a reader can change their own comment for 30 minutes after posting, and only while it is published and has no reply (a published or waiting reply both count).
  The window is `EDIT_WINDOW_MINUTES` (a variable under `vars` in `wrangler.jsonc`; leave it out for 30). The new text goes through the same automatic screen as a new comment,
  so a flagged edit is held until you approve it. Leading and trailing spaces, tabs and runs of three or more newlines are tidied before the new text is compared with the old, so text that differs only by that changes nothing and does not restart the window.
- **Delete:** a comment with no replies is removed. A comment with replies stays as a blank "tombstone" so the replies keep their place: the public sees "This comment was deleted.",
  and the name, email, text, token hash and visitor hashes are erased. The tombstone disappears when its last reply is removed. A comment you marked as spam cannot be deleted by its author.
- **Wrong token, unknown id, team comment, spam or deleted comment:** all give the same `404` ("That comment could not be found."), so nothing can be probed.
- **Likes:** one per visitor id per comment; liking twice is not an error and does not count twice.
- **Old text of an edit (`prev_body`):** kept only so you can see what was changed. `node scripts/comments.mjs list` prints it under the comment as "edited; before the edit: ...".
  It is never sent to the public, and it is erased when the comment is deleted (by the reader or by you).

**Rollout for comment controls** (the email work adds migrations 0005 and 0006: for the full order see "Email setup (owner checklist)" at the end; apply every pending migration before deploying) (each step is yours to run; nothing here is automatic):

```bash
cd worker
npx wrangler d1 migrations apply mayobe-engage --remote   # 1. applies 0004_comment_controls.sql (new columns and the likes table); with the email work this also applies 0005 and 0006
npx wrangler deploy                                       # 2. deploys the new Worker
cd .. && node scripts/build.mjs                           # 3. rebuild the site, then commit and push
```

The migration only adds columns and a table, so the old Worker keeps working until step 2, and the old site keeps working with the new Worker until step 3.
**After the first real deploy, test one edit and one hide on the live Worker** (post a comment, edit it, then `node scripts/comments.mjs spam <id>` and check the count). The tests prove
the logic on a local SQLite copy of D1; D1's `RETURNING` and `changes()` inside `batch()` were only proven there, not on Cloudflare itself.

## What protects the site from spam

The automatic screen above (flagged comments are held until approved) · links are refused · a hidden field and a minimum
typing time catch bots · limits per hashed IP (5 comments an hour, 60 reactions per 10 minutes) · at most
5 unreviewed comments per visitor · only real posts (checked against `/data/search.json`) can receive
comments · requests are accepted only from `mayobebros.com`. Raw IP addresses are never stored.

Optional: add Cloudflare Turnstile (free). Create a widget in the Cloudflare dashboard, run
`npx wrangler secret put TURNSTILE_SECRET`, and put the site key in `site.config.json` as `turnstileSiteKey`.
If you do, mention Cloudflare Turnstile in the Privacy Policy. The contact form (`/v1/contact`) does not check Turnstile yet, because `js/contact.js` does not load the widget; add both together.

## Approve or ignore a held comment from your email

When the automatic screen holds a comment, an email goes to every address in `REVIEW_EMAILS` (`wrangler.jsonc`: `mclean@mayobebros.com` and `mbagamclean@gmail.com`, at most 3). It shows the comment and two buttons:
- **Approve this comment** publishes it at once. It then shows a green double check and the line "Approved by Admin Mayobe Bros" under the text (migration 0008 stores who approved it; the same mark appears when you approve with `node scripts/comments.mjs approve <id>`). A comment the screen published by itself has no mark, and a reader who edits an approved comment loses it.
- **Ignore** changes nothing: the comment stays hidden and the Approve button keeps working for 7 days. It is how you tell the team "I saw it".

How it works: each button is a link to `https://mayobebros.com/manage/#r=<id>.<a|i>.<expiry>.<signature>`. The signature is an HMAC made with the secret `REVIEW_SECRET`, so a link cannot be made for another comment or action and stops working after 7 days. The part after `#` never reaches a server by itself; the page sends it to `POST /v1/review` and says what happened. The page answers as soon as it opens (this is the one `/manage/` link that does), because the click on the email button is your click. It waits while the tab is hidden. If a mail scanner that runs JavaScript ever opens the links, a comment could be approved without you: hide it again with `node scripts/comments.mjs spam <id>`. Without `REVIEW_SECRET` the email has no buttons and shows the old terminal command. Without `REVIEW_EMAILS` it goes to `OWNER_EMAIL` only.

Set it up: `npx wrangler d1 migrations apply mayobe-engage --remote` (applies 0008), then make a secret of at least 16 random characters and store it with `npx wrangler secret put REVIEW_SECRET` (paste it when asked; do not put it in a file or a chat), then `npx wrangler deploy`. The `/manage/` page must be live with the new `js/manage.js` (push the site). Test with `node scripts/mail-test.mjs owner-held <address> --yes`: its buttons are samples and say "not valid" on purpose; for a real test, post a rude comment on a test article and press the buttons in the email.

## Email budget

The free Resend plan allows 100 emails a day and 3,000 a month. The Worker keeps to 94 a day, split into slices per UTC day:
owner 24, commenter 25, contact 10, news 35. A full slice never borrows from another. Contact-form notices to the owner are capped at 7 a day
inside the owner slice (`ctday:` in `hits`), so a flood of contact messages leaves 17 owner emails for comment alerts (at most 8 alerts a day, `oaday:` in `hits`; a held comment is mailed to every `REVIEW_EMAILS` address, so it costs one email each); past 7
the form answers with the "please email us" message. Each visitor confirmation (the `contact` slice) is sent once a day per address.
Comment alerts to the owner (held comments and questions) are capped at 3 a day (`oaday:` in `hits`), which with the 7 contact notices makes the 10 owner units. After 3 alerts the comments are still saved; you can see every one with `node scripts/comments.mjs list`.

## Bounces and complaints (Resend webhook)

Resend tells the Worker when an address bounces or marks a mail as spam, and the Worker stops mailing it (table `suppressed`).
1. Resend dashboard -> Webhooks -> Add endpoint: `<worker URL>/v1/webhooks/resend`, events `email.bounced` and `email.complained`.
2. Copy the signing secret (`whsec_...`) and run `npx wrangler secret put RESEND_WEBHOOK_SECRET`.

Every request is checked with the Svix signature (headers `svix-id`, `svix-timestamp`, `svix-signature`, 5-minute window). Without the secret
the endpoint refuses everything. Only permanent bounces and complaints suppress; transient and undetermined bounces do not. Our own addresses (`OWNER_EMAIL`, `CONTACT_EMAIL`, the sender addresses) are never suppressed.
Keep **click and open tracking OFF** for this domain in Resend: manage links carry their token in the URL fragment (`#l=`, `#u=`) and
tracking wrappers can break or leak them.

### Recover a wrongly suppressed address

```
npx wrangler d1 execute mayobe-engage --remote --command "DELETE FROM suppressed WHERE email='<address>'"
```

Removing an address from Resend's own suppression list in its dashboard does not clear this local table; do both.

## Backups

```bash
npx wrangler d1 export mayobe-engage --remote --output ../backup-comments.sql
```

## Local tests

`node --no-warnings --test scripts/tests/worker.test.mjs` runs the API against a real SQLite engine, with no
Cloudflare account needed.

## Newsletter

Code: `src/newsletter.js` (routes, the daily sender, the admin API), tables in `migrations/0007_newsletter.sql`, owner tool `scripts/newsletter.mjs`.
The footer form and the `/newsletter/` page exist only when `newsletterAction` in `site.config.json` is `"api"` (git keeps `""`).

Routes (all under `/v1/newsletter/`): `subscribe` (answers 200 for every valid address whatever its state; 400 for an address that does not
look right, 429 after 3 sign-ups in an hour from one IP, 503 while `RESEND_API_KEY` is not set), `confirm` and `unsubscribe` (the buttons on the
`/newsletter/` page; links in emails use `#c=<token>` and `#u=<token>` so nothing happens until a person presses a button), `one-click`
(POST for the `List-Unsubscribe` header, GET only redirects to the page and changes nothing). Admin routes are under `/v1/admin/newsletter*`.

Sending: one Cron Trigger expression, `0,10,20,30,40,50 4 * * *` (six runs each morning, 04:00 to 04:50 UTC, which is 07:00 to 07:50 in
Tanzania). Why six: on Workers Free every D1 query and every fetch is a subrequest and a run may make 50, so a run stops at 45 and sends
about 9 emails. Six runs reach the 25 article emails a day (see Known limits). If the cron were cut to one run, the limit would be about 9 emails a day.

Rules the sender follows:
- Variables in `wrangler.jsonc`: `NEWSLETTER_SEND` is `"false"` in git; article emails go out only when it is exactly `"true"`. `API_ORIGIN` is this Worker's own https address (used only in the `List-Unsubscribe` header); if it is missing or not https, nothing is sent.
- First run seeding: when the table of handled articles is empty, every article in the live `data/search.json` is recorded as handled and nothing is sent, even if sending is on. `node scripts/newsletter.mjs seed` records every listed article that is not recorded yet, also those from the last 7 days and also while sending is off, so none of them is ever emailed; run it (then `dry-run`) right before switching sending on. If that list was incomplete on the first run, articles from the last 7 days that were missing are sent on the next good run.
- Age guard: an article not seen before whose date is more than 7 days old is recorded and never emailed (a renamed old post cannot be mass-mailed). So do not rename a post in its first week after publishing, or subscribers get it twice (the new slug looks like a new article). Posts renamed later are safe.
- At most once: each (article, subscriber) pair is claimed in the database before Resend is called, so overlapping runs, retries and crashes never send an article twice. A failed send is not retried. A subscriber who unsubscribes during a run gets nothing more.
- Clean-up runs every day, also while sending is off: unconfirmed sign-ups older than 7 days, expired confirm links, subscribers unsubscribed more than 30 days (with their tokens and send records) and old send records.
- Watch the first live runs: Workers > mayobe-engage > Logs shows one `newsletter:` summary line per run. Look for `exceededCpu` in the run status (Free plan: 10 ms CPU per cron run). If it appears, tell your assistant; the fix is fewer sends per run.

Owner commands (need the admin token; they change nothing unless said):
```
node scripts/newsletter.mjs list [active|pending|unsubscribed|all] [--csv]
node scripts/newsletter.mjs count      # totals, today's news units (articles stop at 25 of 35), articles still being sent
node scripts/newsletter.mjs dry-run    # what the next run would do; no writes, no mail
node scripts/newsletter.mjs seed       # record every listed article not yet recorded (also this week's) as handled; sends nothing
node scripts/newsletter.mjs remove <email> --yes   # deletes one address with its tokens and send record
```
Local preview: `node --no-warnings scripts/dev-api.mjs` and `node scripts/build.mjs --api http://127.0.0.1:8787 --newsletter` (the dev API prints mail headers and has `POST /__dev/cron`).

### Try the newsletter with real mail on your computer

`DEV_MAIL_REAL=1` makes the local dev API send real emails through Resend, only to addresses you list, so you can see the confirmation, welcome and goodbye in your own mail app before anything is deployed.

1. Put your Resend key in `worker/.dev.vars` (git-ignored) as a line `RESEND_API_KEY=...`. The script reads it from that file, never from the command line, and never prints it. It refuses to start without the key or without an allow-list.
2. Build and serve the site: `node scripts/build.mjs --api http://127.0.0.1:8787 --newsletter`, then `node scripts/serve.mjs` (port 8000).
3. Start the API: `DEV_MAIL_REAL=1 DEV_MAIL_ALLOW=you@example.com node --no-warnings scripts/dev-api.mjs` (several addresses are comma separated). Read the `REAL MAIL ON` line it prints. Any recipient not on the list is skipped with `[mail] not sent (not in DEV_MAIL_ALLOW)`.
4. Subscribe from the footer of `http://127.0.0.1:8000/` with an address on the list. Links in these emails open `http://127.0.0.1:8000`, so open the email on the same computer.
5. Pictures load from the live site (`https://mayobebros.com/assets/email/`). They are already published there (commit 3cd434ab is on main). An email shows a picture only when the live `data/search.json` has the `m` and `w` fields for that article, and the live file does not have them until this branch is pushed. Until then the emails stay text-only, with tinted boxes and their descriptions, which is also a free check of how the email looks with images blocked.
6. Unsubscribe with the link in the email footer, not with the mail app's own Unsubscribe button: that button posts to the Worker address, which is not running locally.
7. Rebuild without `--api` and `--newsletter` when you are done, and never commit that local build.

## Email setup (owner checklist)

Nothing below has been run. Do the steps in order; each one is a single command or click. Run `wrangler` commands inside `worker/` with
`XDG_CONFIG_HOME=$HOME/.config` and `export PATH=$HOME/tools/node/bin:$PATH`.

0. Run a last review of the branch (ask your assistant) before deploying.
1. Confirm `OWNER_EMAIL`, `CONTACT_EMAIL`, `MAIL_FROM` and `MAIL_FROM_SUPPORT` in `wrangler.jsonc` use addresses on the Resend-verified domain `mayobebros.com`, and that `info@` is a mailbox you read.
2. Check the database: `npx wrangler d1 migrations list mayobe-engage --remote` must show 0001 to 0003 as applied. Then apply 0004, 0005 and 0006 (and 0008 if you want the Approve / Ignore buttons, see "Approve or ignore a held comment from your email"): `npx wrangler d1 migrations apply mayobe-engage --remote` (apply all three BEFORE deploying the Worker).
3. In Resend: Webhooks, Add endpoint `<worker URL>/v1/webhooks/resend`, events `email.bounced` and `email.complained`; copy the signing secret (`whsec_...`) for `RESEND_WEBHOOK_SECRET`; keep open and click tracking OFF for the domain. The endpoint can be created before the Worker is deployed; it only starts working after step 5.
4. Set the secrets (you paste the value when asked; never type it in a command line or share it): `npx wrangler secret put RESEND_API_KEY` and `npx wrangler secret put RESEND_WEBHOOK_SECRET`. The webhook secret is the one you copied in step 3. Secrets take effect without a new deploy.
5. Deploy: `npx wrangler deploy`
6. Live check on a test comment, before the push: edit it once and hide it once with `node scripts/comments.mjs spam <id>` (D1 `RETURNING` and `changes()` inside a batch were only proven on the local SQLite stand-in, so watch for errors). The live site does not have the email checkbox, the `/manage/` page or the new contact form until step 8.
7. Send the five templates that do not contain a link to a page the live site lacks yet (`owner-held`, `owner-question`, `owner-contact-failed`, `contact-owner`, `contact-visitor`; the comment-manage ones wait for step 9a) to your own Gmail (look at it on a phone), an Outlook and a Yahoo address: `read -rs RESEND_API_KEY; export RESEND_API_KEY` (paste the key, nothing is shown), then `node scripts/mail-test.mjs <template> <address> --yes`, and `unset RESEND_API_KEY` afterwards (`--list` shows the names; without `--yes` it refuses). For the `contact-owner` test email, press Reply in your mail app and confirm the reply goes to `sample@example.com`: that proves Resend honoured `reply_to`. The first live send also shows Resend's real error body in the Worker log if something is rejected.
8. Rebuild with `node scripts/build.mjs`, stage files BY NAME (not `git add -A`: the stray `css/Mayobe AI` file and `.superpowers/` must not go in), commit, and push only when you decide to. Wait for the site to go live. The email pictures in `assets/email/` are already live (published to main as 3cd434ab); this push publishes the `m` and `w` fields in `data/search.json` that switch pictures on in the emails.
9. After the push, test the real site: post a comment with the email box ticked, open the emailed link, press the button on the `/manage/` page, and send the contact form once.
9a. Now that `/manage/` is live, send the two templates whose links lead to it: `node scripts/mail-test.mjs manage-link <address> --yes --pages-live` and the same for `reply-notice` (key as in step 7). `--pages-live` is your word that the page the email links to is on the live site; without it, `mail-test.mjs` refuses to send these templates, so a real-looking link never leads to a 404.

### Newsletter go-live (after the nine steps above work)

Nothing below has been run. Order matters; the newsletter sends nothing until the last step.

10. Apply migration 0007 BEFORE deploying: `npx wrangler d1 migrations apply mayobe-engage --remote` (check with `migrations list`).
11. Confirm `API_ORIGIN` in `wrangler.jsonc` equals the deployed Worker address and `NEWSLETTER_SEND` is `"false"`, then `npx wrangler deploy`. This also registers the cron: check Workers > mayobe-engage > Settings > Triggers shows `0,10,20,30,40,50 4 * * *`. Do steps 12 and 13 in the same sitting. Until step 13 is live, do not sign up by hand or send newsletter test emails: their links lead to /newsletter/, which is not on the live site yet. Sign-ups work from now on, even before the footer form exists: confirmation, welcome and goodbye emails go out once the Worker is deployed, while `NEWSLETTER_SEND` is `"false"`. Only article emails wait for step 15.
12. Run `node scripts/newsletter.mjs seed`, then `node scripts/newsletter.mjs dry-run` and read the report: no old article may be listed to send. Check that the `seeded` line of the first seed lists every article on the site (127 on 2026-11-07; count them in `data/search.json`). If it does not, do not switch sending on before 2026-11-12 (110 articles are dated 2026-11-04 and count as new until then).
13. Set `"newsletterAction": "api"` in `site.config.json`, run `node scripts/build.mjs`, stage files by name, commit, and push when you decide.
14. Test with your own Gmail: subscribe from the live footer, confirm, check the welcome mail, use Gmail's own Unsubscribe link, and check `node scripts/newsletter.mjs list all` shows the row as `unsubscribed`. Then subscribe again. To see the five newsletter templates on a phone, once step 13 is live (`/newsletter/` exists): `node scripts/mail-test.mjs <confirm-subscription|welcome|new-post|new-post-video|farewell> <address> --yes --pages-live` (key as in step 7). `node scripts/mail-test.mjs <template> --dry` prints the subject and text part without a key or an address.
15. Last: right before, run `node scripts/newsletter.mjs seed` and `node scripts/newsletter.mjs dry-run` again (articles published since step 12 are then recorded as handled; the dry run must list no article to send). Then set `NEWSLETTER_SEND` to `"true"` in `wrangler.jsonc` and run `npx wrangler deploy` (a change made only in the Cloudflare dashboard is overwritten by the next deploy). The next morning's runs send the first article published after that. To pause, set it back to `"false"` and deploy.

### Known limits

- The daily budget is 80 of Resend's free 100 a day (3,000 a month): owner 10, commenter 25, contact 10, news 35 (the news slice is used by the newsletter: confirmations, welcomes, goodbyes and article emails). A full slice never borrows from another, so some emails are skipped on a busy day.
- Contact notices to you are capped at 7 a day inside the owner slice; the 8th visitor sees the "please email us" message. Each address gets one contact confirmation a day.
- Per-address limits (1 manage-link email a day, 1 reply notice a day per comment) treat Gmail dots and `+tags` as the same address. Other providers' aliases are not modelled; the 5 a day per IP limit is the backstop.
- Many Tanzanian readers share one mobile-network IP, so the per-IP limits can occasionally stop a genuine reader for the day.
- A reply notice takes its once-a-day slot before the suppression and budget checks, so a notice that could not be sent is not retried later.
- Admin "spam" on a comment removes its emailed and browser links; a restored comment does not get them back.
- Rate-limit records are deleted lazily, so they may outlive their expiry by a while.
- A retry of the contact form with an edited message but the same form-fill id can get a Resend 409 and then shows the email fallback.
- Someone rotating IPs can fill the 25 a day commenter slice with manage-link emails, which also stops reply notices for that day. Accepted: the per-address and per-IP limits are the backstop.
- The news slice is 35 a day. Article emails stop at 25 so that 10 stay for confirmations, welcomes and goodbyes (the cron runs at the start of the UTC day, so otherwise a backlog would use the whole slice each morning). So about 25 subscribers get an article per day: 25 divided by the articles published that day, per subscriber (two articles the same day reach about 12 subscribers a day each). A list of 60 gets one article within 3 days; a larger list takes longer or needs a paid Resend plan. If subscribers times articles per day stays above 25, the queue keeps growing: watch `node scripts/newsletter.mjs count`. (The design spec's "about 80 subscribers" was wrong.)
- Sign-up limits: 3 sign-ups an hour from one IP (the 4th gets a 429 "try again later"), one confirmation email per address per UTC day, and at most 8 confirmation emails a day in total. A confirmation that hits a limit, the do-not-email list or a full news slice is not sent and not retried; the person can sign up again the next day.
- On the Free plan each cron run can make 50 subrequests (every D1 query and every fetch counts), so a run sends about 9 emails. The six morning runs together can reach the 25. The owner `dry-run` makes one count per queued article (at most a week of articles) and also stops at the ceiling.
- The Free plan allows 10 ms of CPU per cron run. Building up to 9 emails per run may come close; I/O waits do not count. Watch the first live runs (see Newsletter).
