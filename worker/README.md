# Comments and reactions API (Cloudflare Worker + D1)

This small API stores comments and the four reactions (Like, Amazed, Sad, Angry). It is free at this
site's size (Cloudflare Workers Free: 100,000 requests a day; D1 Free: 5 GB, 5 million row reads a day).
Every comment is held for review. Nothing appears on the site until you approve it.

## One-time setup (about 10 minutes)

Run these in the project folder. You need a free Cloudflare account. (Node must be on your PATH:
`export PATH=$HOME/tools/node/bin:$PATH`.)

```bash
cd worker
npx wrangler login                              # opens a browser once to sign in
npx wrangler d1 create mayobe-engage            # prints a database_id
#   -> paste that id into wrangler.jsonc (replace REPLACE_WITH_ID_PRINTED_BY_wrangler_d1_create)
npx wrangler d1 migrations apply mayobe-engage --remote
openssl rand -hex 24 | tee ../.admin-token | npx wrangler secret put ADMIN_TOKEN   # the moderation password
openssl rand -hex 24 | npx wrangler secret put HASH_SALT
npx wrangler deploy                             # prints https://mayobe-engage.<your-subdomain>.workers.dev
```

The first `wrangler deploy` may ask you to choose a `workers.dev` subdomain. Choose any name.

Then, in the project root:

1. Put the printed address in `site.config.json`: `"commentsApi": "https://mayobe-engage.<your-subdomain>.workers.dev"`
2. `node scripts/build.mjs` and push. Comments and reactions are now live on every post.

`.admin-token` is git-ignored. Keep it private.

## Moderating (from the terminal)

```bash
node scripts/comments.mjs list              # comments waiting for review
node scripts/comments.mjs approve 3 4       # publish
node scripts/comments.mjs spam 5            # hide
node scripts/comments.mjs delete 6          # remove
```

## What protects the site from spam

Pre-moderation (nothing is public until approved) · links are refused · a hidden field and a minimum
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
