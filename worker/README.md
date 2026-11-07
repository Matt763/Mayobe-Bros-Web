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

## Email budget

The free Resend plan allows 100 emails a day and 3,000 a month. The Worker keeps to 80 a day, split into slices per UTC day:
owner 10, commenter 25, contact 10, news 35. A full slice never borrows from another. Contact-form notices to the owner are capped at 7 a day
inside the owner slice (`ctday:` in `hits`), so a flood of contact messages leaves 3 owner emails for held-comment and question alerts; past 7
the form answers with the "please email us" message. Each visitor confirmation (the `contact` slice) is sent once a day per address.

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

## Email setup (owner checklist)

Nothing below has been run. Do the steps in order; each one is a single command or click. Run `wrangler` commands inside `worker/` with
`XDG_CONFIG_HOME=$HOME/.config` and `export PATH=$HOME/tools/node/bin:$PATH`.

0. Run a last review of the branch (ask your assistant) before deploying.
1. Confirm `OWNER_EMAIL`, `CONTACT_EMAIL`, `MAIL_FROM` and `MAIL_FROM_SUPPORT` in `wrangler.jsonc` use addresses on the Resend-verified domain `mayobebros.com`, and that `info@` is a mailbox you read.
2. Check the database: `npx wrangler d1 migrations list mayobe-engage --remote` must show 0001 to 0003 as applied. Then apply 0004, 0005 and 0006: `npx wrangler d1 migrations apply mayobe-engage --remote` (apply all three BEFORE deploying the Worker).
3. In Resend: Webhooks, Add endpoint `<worker URL>/v1/webhooks/resend`, events `email.bounced` and `email.complained`; copy the signing secret (`whsec_...`) for `RESEND_WEBHOOK_SECRET`; keep open and click tracking OFF for the domain. The endpoint can be created before the Worker is deployed; it only starts working after step 5.
4. Set the secrets (you paste the value when asked; never type it in a command line or share it): `npx wrangler secret put RESEND_API_KEY` and `npx wrangler secret put RESEND_WEBHOOK_SECRET`. The webhook secret is the one you copied in step 3. Secrets take effect without a new deploy.
5. Deploy: `npx wrangler deploy`
6. Live check on a test comment: edit it once and hide it once with `node scripts/comments.mjs spam <id>` (D1 `RETURNING` and `changes()` inside a batch were only proven on the local SQLite stand-in, so watch for errors), post a comment with the email box ticked and open the emailed link, and send the contact form once.
7. Send each template to your own Gmail (look at it on a phone), an Outlook and a Yahoo address: `read -rs RESEND_API_KEY; export RESEND_API_KEY` (paste the key, nothing is shown), then `node scripts/mail-test.mjs <template> <address> --yes`, and `unset RESEND_API_KEY` afterwards (`--list` shows the names; without `--yes` it refuses). This also confirms Resend's `reply_to` field (use `contact-owner`) The first live send confirms the exact error body and the `reply_to` field.
8. Rebuild with `node scripts/build.mjs`, stage files BY NAME (not `git add -A`: the stray `css/Mayobe AI` file and `.superpowers/` must not go in), commit, and push only when you decide to.

### Known limits

- The daily budget is 80 of Resend's free 100 a day (3,000 a month): owner 10, commenter 25, contact 10, news 35 (the news slice is unused until the newsletter exists). A full slice never borrows from another, so some emails are skipped on a busy day.
- Contact notices to you are capped at 7 a day inside the owner slice; the 8th visitor sees the "please email us" message. Each address gets one contact confirmation a day.
- Per-address limits (1 manage-link email a day, 1 reply notice a day per comment) treat Gmail dots and `+tags` as the same address. Other providers' aliases are not modelled; the 5 a day per IP limit is the backstop.
- Many Tanzanian readers share one mobile-network IP, so the per-IP limits can occasionally stop a genuine reader for the day.
- A reply notice takes its once-a-day slot before the suppression and budget checks, so a notice that could not be sent is not retried later.
- Admin "spam" on a comment removes its emailed and browser links; a restored comment does not get them back.
- Rate-limit records are deleted lazily, so they may outlive their expiry by a while.
- A retry of the contact form with an edited message but the same form-fill id can get a Resend 409 and then shows the email fallback.
- The newsletter (Phase 3) is not built: the newsletter templates exist but nothing sends them.
