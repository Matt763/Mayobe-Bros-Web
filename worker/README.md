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

## What protects the site from spam

The automatic screen above (flagged comments are held until approved) · links are refused · a hidden field and a minimum
typing time catch bots · limits per hashed IP (5 comments an hour, 60 reactions per 10 minutes) · at most
5 unreviewed comments per visitor · only real posts (checked against `/data/search.json`) can receive
comments · requests are accepted only from `mayobebros.com`. Raw IP addresses are never stored.

Optional: add Cloudflare Turnstile (free). Create a widget in the Cloudflare dashboard, run
`npx wrangler secret put TURNSTILE_SECRET`, and put the site key in `site.config.json` as `turnstileSiteKey`.
If you do, mention Cloudflare Turnstile in the Privacy Policy.

## Backups

```bash
npx wrangler d1 export mayobe-engage --remote --output ../backup-comments.sql
```

## Local tests

`node --no-warnings --test scripts/tests/worker.test.mjs` runs the API against a real SQLite engine, with no
Cloudflare account needed.
