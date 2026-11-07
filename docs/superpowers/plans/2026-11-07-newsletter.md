# Newsletter (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readers can subscribe from the footer with double opt-in, get a welcome email, one email per new article sent by a daily Cron Trigger, and can leave with one click; the owner can list, count, remove and dry-run from the terminal.

**Architecture:** New module `worker/src/newsletter.js` holds the newsletter routes and `runNewsletter()` (the cron job); shared helpers move out of `worker/src/index.js` into `worker/src/util.js` so both files use one copy. D1 migration `0007` adds subscribers, hashed tokens, a per-post record and a per-(post, subscriber) delivery log that is claimed before each send, so overlapping or retried runs never send twice. The site gets a footer form (`js/subscribe.js`) and a built `/newsletter/` page (`js/newsletter.js`) that calls the API only when a person presses a button.

**Tech Stack:** Cloudflare Worker (plain JS, no dependencies) with a Cron Trigger, D1/SQLite (Node `node:sqlite` shim in tests), Resend REST API through the existing `sendMail`, the static build (`scripts/build.mjs`, `scripts/lib/render.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-06-comment-controls-and-email-design.md` (section "Phase 3: newsletter", "Constraints", "Calls settled" items 4, 5, 6, 7). Depends on Plan 2 (`docs/superpowers/plans/2026-11-06-resend-email.md`): uses `sendMail`, `CAPS.news = 35`, `suppressed`, `hits`, the four newsletter templates in `worker/src/mail-templates.js` and the `/manage/` page pattern. Plan 2 must be live and checked by the owner before Phase 3 is deployed (item 7).

## Global Constraints

- Node: `export PATH=$HOME/tools/node/bin:$PATH`. Plain JS, no new dependencies. Full suite: `node --no-warnings --test scripts/tests/*.test.mjs` (record the green baseline before Task 1). Commits are local only, files staged by name, never `git add -A`, never push.
- Do not hand-edit generated files (CLAUDE.md list). Generated pages are rebuilt with `node scripts/build.mjs` and committed with the task that changed their source.
- Outward actions are not in this plan: `wrangler deploy`, remote migration, changing Worker variables, any real send. Task 6 ends with the owner's checklist.
- Mail: every newsletter message goes through `sendMail(env, ctx, msg)` with `kind: 'news'` (slice 35 a day, UTC day, never borrows). Idempotency keys: `nl-confirm-<subscriberId>-<utcDay>`, `nl-welcome-<subscriberId>`, `nl-post-<slug>-<subscriberId>`, `nl-bye-<subscriberId>`. Mail is sent inside `later()` / `ctx.waitUntil` after data is saved; a mail failure never changes an API answer.
- Templates are used as they are: `confirmSubscriptionEmail({ confirmUrl })`, `welcomeEmail({ unsubscribeUrl, latestPosts: [{ title, url, excerpt }] })`, `newPostEmail({ post: { title, url, excerpt, image, imageAlt, category }, unsubscribeUrl })`, `farewellEmail({ resubscribeUrl })`, each `(data, site)` with `site = siteOf(env)`. No visitor text goes into any newsletter email; the only visitor input is the address it is sent to.
- Links in email bodies are on `SITE_ORIGIN` only: confirm `https://mayobebros.com/newsletter/#c=<token>`, unsubscribe `https://mayobebros.com/newsletter/#u=<token>`, resubscribe `https://mayobebros.com/newsletter/`. The single exception is the `List-Unsubscribe` header, which must accept a POST and so points at the Worker: `<${API_ORIGIN}/v1/newsletter/one-click?t=<token>>` plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. It is a header, not a visible link.
- Tokens: `newToken()` (24 random bytes, base64url, 32 chars, `TOKEN_RE`); only `sha(token)` is stored; lookups are by hash with the hash always computed, as in `ownerRow`. Confirm tokens are one-time and expire after 7 days; unsubscribe tokens never expire and are deleted with the subscriber.
- Abuse limits (item 5, no Turnstile): honeypot `website` and minimum 2,500 ms since page load (pretend success, nothing stored or sent); sign-up 3 an hour per hashed IP (`nl:<ih>:<hour>`, the only case that answers 429); 1 confirmation per address per day (`nlem:<sha(canonicalEmail|HASH_SALT)[0..32]>:<day>`, silent); at most 8 confirmation emails a day in total (`nlconf:<day>`, silent), so a sign-up flood leaves at least 27 news units for the daily send.
- Uniform answers: `POST /v1/newsletter/subscribe` answers `200 {"ok":true}` for every valid address whatever its state (new, pending, active, unsubscribed, suppressed, limited); the database work and the mail happen inside `later()` after the answer is decided.
- Cron: `"triggers": { "crons": ["0,10,20,30,40,50 4 * * *"] }` (six runs, 07:00-07:50 in Tanzania; one expression = one of the Free plan's 5 Cron Triggers). On Workers Free every D1 query (a `db.batch` counts as one) and every fetch is a subrequest, 50 per invocation (checked 2026-11-07 at https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/d1/platform/limits/). Each run counts its own subrequests and stops with `stopped:'subrequests'` before a send it could not finish (ceiling 45, about 9 sends a run), so the six runs together can reach `CAPS.news` (35 a day), which still bounds the day. Sends one at a time with a 200 ms gap and at most `CAPS.news` Resend calls per run. Clean-up runs first, in its own try.
- `NEWSLETTER_SEND`: new-post emails go out only when it is exactly `"true"`; git ships `"false"`. Seeding and the daily clean-up run even when paused. `API_ORIGIN` (new var, `https://mayobe-engage.mattmclean763.workers.dev`) must be `https://` (or `http://127.0.0.1:` for dev-api); otherwise the run logs and sends nothing.
- Footer switch: `newsletterAction` in `site.config.json` is `""` (off, RSS button) or `"api"` (form posts to `${commentsApi}/v1/newsletter/subscribe`); any other value is a build error. Git keeps `""`; the owner sets `"api"` at deploy step (c). Local testing: `node scripts/build.mjs --api http://127.0.0.1:8787 --newsletter`.
- Policies must match real behaviour (CLAUDE.md): newsletter text appears in pages only inside `{{#newsletter}}...{{/newsletter}}`, which is kept only when the newsletter is on, and `/newsletter/` is built only then. Writing per `docs/writing-guide.md`: plain English, no hype, no promises of frequency beyond "one email when we publish a new article".

## Review Focus

1. `search.json` is unreachable, empty, truncated or a post was renamed (new slug, old date) on the first run or any later run: no old article is ever mass-mailed. (Task 3: seed guard + 7-day age guard tests)
2. A run that dies after Resend accepted a message, two runs that overlap, or a 429 halfway: no subscriber gets the same article twice, and the rest are sent the next day. (Task 3)
3. Someone probing whether an address is subscribed gets the same status, body and mail-free response timing for every state. (Task 1)
4. Link scanners and previewers (Outlook Safe Links, Gmail image/link prefetch) that GET the confirm, unsubscribe or one-click URLs never confirm or unsubscribe anyone. (Tasks 2, 5)
5. A subscriber who unsubscribes, complains or is removed by the owner while a send is in progress gets nothing more, and removal leaves no tokens, deliveries or address behind. (Tasks 2, 3, 4)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `worker/migrations/0007_newsletter.sql` (create) | `newsletter_subscribers`, `newsletter_tokens`, `newsletter_sent`, `newsletter_deliveries` |
| `worker/src/util.js` (create) | helpers moved from `index.js`: `enc, now, reply, fail, sha, ipHash, same, newToken, hit, readJson, siteOrigin, siteOf, canonicalEmail, utcDay, DAY_TTL, later, TOKEN_RE, SLUG_RE` |
| `worker/src/newsletter.js` (create) | `newsletterRoute`, `unsubscribeKit`, `runNewsletter`, `newsletterAdmin` |
| `worker/src/index.js` (modify) | imports from `util.js` (re-exports `canonicalEmail`), Origin-check exemption for one-click, delegates `/v1/newsletter/*` and `/v1/admin/newsletter*`, `scheduled()`, complaint hook in `resendWebhook` |
| `worker/wrangler.jsonc` (modify) | `triggers.crons`, vars `NEWSLETTER_SEND`, `API_ORIGIN` |
| `scripts/tests/newsletter.test.mjs` (create) | Worker routes, cron, admin |
| `scripts/newsletter.mjs` (create), `scripts/tests/newsletter-cli.test.mjs` (create) | owner CLI |
| `scripts/dev-api.mjs` (modify) | newsletter env, `POST /__dev/cron`, prints mail headers |
| `scripts/build.mjs`, `scripts/lib/render.mjs`, `js/subscribe.js` (create), `js/newsletter.js` (create), `js/site.js`, `content/pages/newsletter.html` (create), `css/style.css` | footer form, page, `{{#newsletter}}` |
| `scripts/tests/subscribe.test.mjs`, `scripts/tests/newsletter-page.test.mjs` (create), `scripts/tests/pages.test.mjs` (modify) | page-side tests |
| `content/pages/privacy-policy.html`, `terms-of-service.html`, `cookie-policy.html` (checked), `worker/README.md`, `CLAUDE.md`, the spec's status line | docs |

---

### Task 1: Migration 0007, shared helpers, subscribe and confirm

**Files:** Create `worker/migrations/0007_newsletter.sql`, `worker/src/util.js`, `worker/src/newsletter.js`, `scripts/tests/newsletter.test.mjs`. Modify `worker/src/index.js`.

**Interfaces:**
- Consumes: `sendMail`, `validEmail` (`mail.js`); `confirmSubscriptionEmail`, `welcomeEmail` (`mail-templates.js`).
- Produces:
  - `worker/src/util.js` exports exactly the helpers listed in the File Structure, unchanged in behaviour; `index.js` imports them and keeps `export { canonicalEmail }`.
  - `newsletterRoute(request, env, ctx, path, cors): Promise<Response|null>` (null = not a newsletter path). Routes: `POST /v1/newsletter/subscribe { email, website, ts }` -> `200 {ok:true}` | `400 {error, field:'email'}` | `429` | `503 {error:'The newsletter is not available right now.'}` when `RESEND_API_KEY` is missing (checked before anything is stored). `POST /v1/newsletter/confirm { token }` -> `200 {ok:true}` | `404 {error: NL_NOT_FOUND}` where `NL_NOT_FOUND = 'That link has expired or was already used.'`.
  - `unsubscribeKit(env, subscriberId): Promise<{ pageUrl: string, headers: { 'List-Unsubscribe': string, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } | {} }>`: inserts a new `unsub` token and returns the `/newsletter/#u=` URL and the two headers (empty headers when `API_ORIGIN` is invalid). Used by Task 3.
  - Migration SQL:

```sql
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,                 -- trimmed, lower case: where mail goes
  email_key TEXT NOT NULL UNIQUE,      -- canonicalEmail(email): one row per inbox
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','unsubscribed')),
  created INTEGER NOT NULL, confirmed INTEGER, unsubscribed INTEGER,
  farewell_sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nl_status ON newsletter_subscribers (status, confirmed);
CREATE TABLE IF NOT EXISTS newsletter_tokens (
  hash TEXT PRIMARY KEY, subscriber_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('confirm','unsub')), expires INTEGER, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nl_tokens_sub ON newsletter_tokens (subscriber_id);
-- one row per article the cron knows: seeded = recorded without sending; sent_at NULL = still being sent
CREATE TABLE IF NOT EXISTS newsletter_sent (
  slug TEXT PRIMARY KEY, title TEXT, queued_at INTEGER NOT NULL, sent_at INTEGER, seeded INTEGER NOT NULL DEFAULT 0
);
-- claimed before the Resend call, so a retry or an overlapping run never sends twice
CREATE TABLE IF NOT EXISTS newsletter_deliveries (
  slug TEXT NOT NULL, subscriber_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','sent','skipped','failed')), at INTEGER NOT NULL,
  PRIMARY KEY (slug, subscriber_id)
);
```

- [ ] **Step 1: Move the helpers** to `worker/src/util.js` and run the full suite: expect PASS with the baseline count (pure move, no behaviour change). Commit this alone: `refactor: share worker helpers in util.js`.
- [ ] **Step 2: Write failing tests** in `newsletter.test.mjs` (copy the fake `fetch`, `call()` and `flushMail` harness from `worker.test.mjs`; the `search.json` fixture has `s,t,u,e,c,d,i`):
  - `'subscribe gives the same 200 {ok:true} for a new, pending, active, unsubscribed, suppressed and already-mailed-today address'`: deep-equal status and body across all six; Resend calls: new 1, pending (after `DELETE FROM hits`, since the per-address key uses the real UTC day) 1, active 0, unsubscribed 1, suppressed 0, second same day 0.
  - `'the confirmation email carries no visitor text and a hashed one-time token'`: `to` is the address; subject is `Please confirm your Mayobe Bros subscription`; the html and text contain `https://mayobebros.com/newsletter/#c=` followed by 32 to 64 `[A-Za-z0-9_-]`; that token is not in `newsletter_tokens` but `sha(token)` is, with `kind='confirm'` and `expires = created + 7 days`; no `List-Unsubscribe` header.
  - `'Foo.Bar+news@gmail.com and foobar@googlemail.com are one subscriber'` (one row, `email_key='foobar@gmail.com'`, one confirmation that day).
  - `'4th sign-up from one IP in an hour is 429 and sends nothing'`; `'honeypot or ts under 2500 ms: 200 {ok:true}, no row, no mail'`; `'bad address: 400 field email'` (`'a@b'`, 255 chars, `"x@y.z\r\nBcc: v@w.x"`); `'no Origin or a foreign Origin: 403'`; `'no RESEND_API_KEY: 503 and no row'`; `'9th confirmation of the UTC day (9 different IPs and addresses) is not sent'`.
  - `'confirm: one press activates, deletes the token and sends one welcome'`: status `active`, `confirmed` set, the confirm token row gone; welcome subject `Welcome to the Mayobe Bros newsletter`, it lists at most 3 posts from the fixture (newest `d` first, none dated after today), its body links `/newsletter/#u=<token>` whose hash is a `kind='unsub'` row, and its headers are `List-Unsubscribe: <https://worker.test/v1/newsletter/one-click?t=<same token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (test env `API_ORIGIN='https://worker.test'`).
  - `'confirm: a second press, an expired token (created set 8 days back), a malformed token and an unknown token all give the same 404 body'`; `'confirm still answers 200 when Resend throws'`.
  - `'resubscribing after unsubscribe returns to pending, deletes the old tokens and sends a new confirmation'`.
- [ ] **Step 3: Run** `node --no-warnings --test scripts/tests/newsletter.test.mjs` - expect FAIL (module missing).
- [ ] **Step 4: Implement** the migration and `newsletterRoute` subscribe/confirm plus `unsubscribeKit` in `newsletter.js`; in `index.js` call `newsletterRoute` after the Origin check and before the 404. Subscribe: validate, IP limit, then `later()` does upsert-by-`email_key` (pending rows get the newly typed `email`; unsubscribed rows go back to pending and lose their tokens; active rows are left alone), the per-address and daily limits, a fresh confirm token (older confirm tokens for that subscriber deleted) and the send. `canonicalEmail` is used only for the key; mail goes to the address as typed.
- [ ] **Step 5: Run** the file and the full suite - expect PASS. **Step 6: Commit** (`0007_newsletter.sql`, `newsletter.js`, `index.js`, the test file).

---

### Task 2: Unsubscribe (button, one-click, complaints)

**Files:** Modify `worker/src/newsletter.js`, `worker/src/index.js` (`resendWebhook`, Origin exemption); tests in `scripts/tests/newsletter.test.mjs`.

**Interfaces:**
- Consumes: `unsubscribeKit` (Task 1), `farewellEmail`.
- Produces: `POST /v1/newsletter/unsubscribe { token }` (Origin checked, from the `/newsletter/` button) -> `200 {ok:true}` (also when already unsubscribed) | `404 {error: 'We could not find that request.'}`; sets `status='unsubscribed'`, `unsubscribed=now`, and sends `farewellEmail({ resubscribeUrl: '<origin>/newsletter/' })` once per row (compare-and-set on `farewell_sent`). `POST /v1/newsletter/one-click?t=<token>` (no Origin check, `application/x-www-form-urlencoded` body exactly `List-Unsubscribe=One-Click`, body read capped at 1 KB) -> `200 {ok:true}` for any token, valid or not; wrong body -> `400`; unsubscribes without a farewell. `GET /v1/newsletter/one-click?t=<token>` -> `303` to `<SITE_ORIGIN>/newsletter/#u=<token>` (only when `t` matches `TOKEN_RE`, else to `/newsletter/`) and changes nothing. A complaint event in `resendWebhook` also sets matching subscribers (by `email_key`) to `unsubscribed`. Both POST routes: 30 an hour per hashed IP (`nlu:<ih>:<hour>`) -> 429.

- [ ] **Step 1: Write failing tests:** `'the button unsubscribes once and sends one farewell; a second press is 200 with no second farewell'`; `'unknown and malformed tokens give the same 404'`; `'an unsubscribe token from the welcome still works after later emails made new ones'`; `'one-click POST without Origin and with the RFC 8058 body unsubscribes and sends no farewell'`; `'one-click with a wrong body is 400 and changes nothing; with an unknown token it is 200 and changes nothing'`; `'GET one-click redirects 303 to the page fragment and changes nothing'` (status stays `active`); `'a complained address is suppressed and its subscriber row becomes unsubscribed'` (reuse the signed-webhook helper from `worker.test.mjs`); `'the 31st unsubscribe call in an hour from one IP is 429'`; `'farewell still not resent after Resend fails the first time'` (at-most-once).
- [ ] **Step 2: Run** - expect FAIL. **Step 3: Implement** (exempt only the exact path `/v1/newsletter/one-click` from the Origin check in `index.js`; parse the form body with `URLSearchParams`).
- [ ] **Step 4: Run** the full suite - expect PASS. **Step 5: Commit.**

---

### Task 3: The daily sender (`runNewsletter`, seed, cron)

**Files:** Modify `worker/src/newsletter.js`, `worker/src/index.js` (`scheduled`), `worker/wrangler.jsonc`; tests in `scripts/tests/newsletter.test.mjs`.

**Interfaces:**
- Consumes: `unsubscribeKit` (Task 1), `newPostEmail`, `sendMail`, `takeBudget`/`CAPS` (read only).
- Produces: `runNewsletter(env, ctx, opts?: { now?: number, sleep?: (ms) => Promise<void>, mode?: 'send'|'dry'|'seed' }): Promise<Report>` where `Report = { paused: boolean, seeded: string[], tooOld: string[], posts: { slug: string, recipients: number, sent: number, skipped: number, failed: number }[], stopped: 'budget'|'rate'|'no-api-origin'|'no-list'|null, purged: number }`. It never throws (errors are logged and reported). `export default { fetch, scheduled(event, env, ctx) { ctx.waitUntil(runNewsletter(env, ctx)) } }`. `wrangler.jsonc`: `"triggers": { "crons": ["0 4 * * *"] }`, vars `"NEWSLETTER_SEND": "false"`, `"API_ORIGIN": "https://mayobe-engage.mattmclean763.workers.dev"`.
- Algorithm (the tests pin it): (1) fetch `${SITE_ORIGIN}/data/search.json`; keep entries with `s` matching `SLUG_RE`, `u` matching the `postMeta` path rule, `d` as `YYYY-MM-DD` and `d <= today`; a failed fetch, non-array or zero valid entries -> `stopped:'no-list'`, nothing written. (2) If `newsletter_sent` is empty: insert every valid slug with `seeded=1, sent_at=now`, send nothing, return (this runs in every mode except `dry`, also while paused). (3) Any unknown slug with `d` older than 7 days -> insert `seeded=1` (`tooOld`). (4) Stop here when `NEWSLETTER_SEND !== 'true'` (`paused:true`) or in `seed` mode. (5) Insert unknown fresh slugs with `queued_at=now, sent_at NULL`, oldest `d` first. (6) For each unfinished post, oldest first, take active subscribers with `confirmed <= queued_at` and no delivery row, in id order, in pages of 10; for each: claim with `INSERT OR IGNORE ... status 'claimed' RETURNING`, skip if not claimed, `unsubscribeKit`, `sendMail({ kind:'news', key:'nl-post-<slug>-<id>', headers, ...newPostEmail })`, then: ok -> `sent`; skipped `suppressed`/`bad-address` -> `skipped`; skipped `budget` -> delete the claim, `stopped:'budget'`, end the run; HTTP 429 -> delete the claim, `stopped:'rate'`, end; any other failure (5xx, thrown, timeout) -> `failed`, never retried; `await sleep(200)` between sends. (7) A post with no remaining recipients gets `sent_at=now`. (8) Clean-up: delete pending subscribers older than 7 days, expired confirm tokens, unsubscribed subscribers older than 30 days (with their tokens and deliveries), and delivery rows of posts finished more than 30 days ago; `purged` counts rows.
- `newPostEmail` data from the entry: `title: t`, `url: origin + u`, `excerpt: e`, `category: c`, `image: <origin>/assets/share/post-<s>.jpg` (the 1200 x 630 JPEG, never the WebP cover), `imageAlt: 'Cover picture for: ' + t`.

- [ ] **Step 1: Write failing tests** (call `runNewsletter` directly with a recording `sleep`; one test calls `worker.scheduled`):
  - `'the first run with an empty newsletter_sent seeds every listed post and sends nothing, even when paused'`.
  - `'no seed and no write when search.json fails, is not an array or has no valid entry; the next good run seeds'`.
  - `'after the seed, a new post goes once to each active subscriber confirmed before it was queued'` (pending, unsubscribed and later-confirmed subscribers get nothing; `sent_at` is set at the end).
  - `'each post email has the unsubscribe headers, a visible /newsletter/#u= link in html and text, Idempotency-Key nl-post-<slug>-<id>, and the share-card JPEG'`.
  - `'a post dated tomorrow is ignored; an unknown post dated 8 days ago (a renamed slug) is recorded as seeded and never emailed'`.
  - `'40 subscribers: today sends what is left of the 35 news units and stops with budget; the next UTC day sends the rest exactly once'` (pre-use 3 units with `takeBudget(env,'news')`; expect 32 then 8; `MAIL_TEST_DAY` for the day change).
  - `'two runs started together send each (post, subscriber) once'` (`Promise.all`, count Resend calls).
  - `'a left-over claimed row (crash after send) is not resent; 429 releases the claim and stops; 500 and a thrown fetch mark failed and are not retried'`.
  - `'a suppressed subscriber is marked skipped and not tried again'`; `'a subscriber unsubscribed between pages gets nothing'` (unsubscribe inside the fake `sleep`).
  - `'NEWSLETTER_SEND missing or "false": no post emails and no queued rows; API_ORIGIN missing or http://example.com: no sends, stopped no-api-origin'`.
  - `'sleep(200) is awaited between sends and a run makes at most 35 Resend calls'`.
  - `'clean-up removes old pending, expired confirm tokens and month-old unsubscribed rows with their tokens and deliveries'`.
  - `'scheduled() hands the run to ctx.waitUntil and does not throw when D1 throws'`.
  - `'mode dry writes nothing and calls Resend never, but reports what it would seed or send'` (row counts of all four tables equal before and after).
- [ ] **Step 2: Run** - expect FAIL. **Step 3: Implement** `runNewsletter` and `scheduled`, and the `wrangler.jsonc` changes (with a comment on each var).
- [ ] **Step 4: Run** the full suite - expect PASS. **Step 5: Commit.**

---

### Task 4: Owner tools (admin API, `scripts/newsletter.mjs`, dev-api)

**Files:** Modify `worker/src/newsletter.js`, `worker/src/index.js` (delegate inside the admin block), `scripts/dev-api.mjs`; create `scripts/newsletter.mjs`, `scripts/tests/newsletter-cli.test.mjs`; admin tests in `newsletter.test.mjs`.

**Interfaces:**
- Consumes: `runNewsletter` (Task 3), `isAdmin`.
- Produces: `newsletterAdmin(request, env, ctx, path, url, cors): Promise<Response|null>`, behind the existing `isAdmin` check: `GET /v1/admin/newsletter?status=active|pending|unsubscribed|all&limit=1..500` -> `{ subscribers: [{ id, email, status, created, confirmed, unsubscribed }] }` (never hashes or tokens); `GET /v1/admin/newsletter/count` -> `{ pending, active, unsubscribed, newsToday, newsCap: 35, paused, queue: [{ slug, sent, left }] }`; `POST /v1/admin/newsletter/remove { email }` -> `{ removed: 0|1 }` (by `email_key`; deletes the subscriber, its tokens and deliveries); `POST /v1/admin/newsletter/run { mode: 'dry'|'seed' }` -> the `Report` (no `send` mode: only the cron sends).
- CLI, same token handling and `safe()` output as `scripts/comments.mjs`: `node scripts/newsletter.mjs list [status] [--csv]`, `count`, `remove <email>`, `dry-run`, `seed`. Exit code 1 with a plain message on any HTTP error.
- dev-api: in `DEV_MAIL_LOG=1` mode also sets `API_ORIGIN='http://127.0.0.1:<port>'` and `NEWSLETTER_SEND='true'`, prints `List-Unsubscribe` headers in the `[mail]` block, and answers `POST /__dev/cron` itself (not the Worker) by awaiting `worker.scheduled({ cron: 'dev', scheduledTime: Date.now() }, env, ctx)` and printing the Report.

- [ ] **Step 1: Write failing tests:** `'admin newsletter routes are 401 without the token'`; `'list never contains hash or token fields and filters by status'`; `'remove by a different spelling of the address deletes the row, its tokens and its deliveries'`; `'count reports the queue and today's news units'`; `'run dry changes no row and calls Resend never; run seed on an empty table seeds'`. In `newsletter-cli.test.mjs` start the Worker in an `http` server on port 0 (as `dev-api.mjs` does), run the CLI with `MAYOBE_API` and `ADMIN_TOKEN` via `execFile`: `'list --csv prints a header line and one line per subscriber'`, `'remove prints removed 1, then removed 0'`, `'no token: exit 1 with the message'`, `'a subscriber email holding \u001b[31m prints without the escape'`.
- [ ] **Step 2: Run** - expect FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** both files and the full suite - expect PASS. Then a manual dev check: `DEV_MAIL_LOG=1 node --no-warnings scripts/dev-api.mjs`, subscribe with `curl` (Origin `http://127.0.0.1:8000`), confirm with the printed token, `curl -X POST http://127.0.0.1:8787/__dev/cron` twice (first seeds), remove one entry from a copy of the fixture to simulate a new post as the implementer sees fit, and read the printed mail. **Step 5: Commit.**

---

### Task 5: Footer form and the `/newsletter/` page

**Files:** Modify `scripts/build.mjs` (`--newsletter` flag, `newsletterAction` validation, skip `content/pages/newsletter.html` when off, `versions` map), `scripts/lib/render.mjs` (footer, `{{#newsletter}}`, page meta), `js/site.js` (remove the old `[data-newsletter]` `postForm` handler), `css/style.css`; create `js/subscribe.js`, `js/newsletter.js`, `content/pages/newsletter.html`, `scripts/tests/subscribe.test.mjs`, `scripts/tests/newsletter-page.test.mjs`; modify `scripts/tests/pages.test.mjs`.

**Interfaces:**
- Consumes: `POST /v1/newsletter/subscribe`, `/confirm`, `/unsubscribe` (Tasks 1, 2).
- Produces: `newsletterOn = !!api && config.newsletterAction === 'api'` (or `--newsletter` with `--api`). When on, the footer has `<form class="foot-form" action="/newsletter/" method="get" data-newsletter data-endpoint="<api>/v1/newsletter/subscribe">` with the email input, a visually hidden honeypot `<input name="website" tabindex="-1" autocomplete="off">` inside an `aria-hidden` wrapper, the submit button, `<p class="foot-status" role="status">`, and one line: "One email when we publish a new article. Stop any time. See our Privacy Policy." (linked); `js/subscribe.js` is loaded on every page. When off, the footer is unchanged (RSS button) and neither script nor page exists. `/newsletter/` page: `noindex`, `noReferrer`, no analytics beacon, not in any sitemap, loads `js/newsletter.js`; explains what is sent and how to stop; screens for `#c=` ("Confirm your subscription" / button "Confirm my subscription"), `#u=` ("Stop newsletter emails" / button "Unsubscribe"), no fragment (explanation, no button) and a malformed fragment. `{{#newsletter}}...{{/newsletter}}` and `{{^newsletter}}...{{/newsletter}}` work in `content/pages/*.html` like `{{#comments}}`.
- `js/subscribe.js` copy: success for every 200: "Almost done. If this address can get our emails, we have sent it a link to confirm. Please check your inbox and spam folder."; 429: "Too many tries. Please wait an hour and try again."; anything else: "Sorry, that did not go through. Please try again later, or follow us with RSS." (RSS linked to `/rss/`).

- [ ] **Step 1: Write failing tests:** `subscribe.test.mjs` (stub-browser harness like `contact.test.mjs`): `'nothing is fetched on load'`; `'a valid submit posts JSON {email, website:"", ts} once, disables the button while sending, shows the success text and clears the field'`; `'a bad address shows a message and fetches nothing'`; `'429 and 503 and a network error show their messages and re-enable the button'`; `'the file has no "already subscribed" wording'` (regex over the source). `newsletter-page.test.mjs` (harness like `manage.test.mjs`): `'nothing is fetched on load and the fragment leaves the address bar first'`; `'one press on Confirm makes one POST /v1/newsletter/confirm with the token'`; `'one press on Unsubscribe makes one POST /v1/newsletter/unsubscribe'`; `'404 shows the expired-or-used message with focus on the heading and no button'`; `'a network error keeps a Try again button'`; `'no or a malformed fragment wires no button'`. `pages.test.mjs`: with the committed config (off), `'no newsletter page, no subscribe script and no newsletter wording in the footer or privacy policy'`; plus a render-level test that calls `createRenderer` with `newsletterAction: 'api'` and an api URL and asserts the footer form attributes, the honeypot, the privacy section, and that the newsletter page meta is noindex, no-referrer and beacon-free.
- [ ] **Step 2: Run** - expect FAIL. **Step 3: Implement** (CSS: input and button at least 44 px tall in the footer, visible focus, unique `@keyframes` names if any; status text colour meets 4.5:1 on the footer background).
- [ ] **Step 4: Run** the tests and the full suite - expect PASS. **Step 5: Browser check:** `node scripts/build.mjs --api http://127.0.0.1:8787 --newsletter`, `DEV_MAIL_LOG=1 node --no-warnings scripts/dev-api.mjs`, `node scripts/serve.mjs`; subscribe from the footer, open the printed `/newsletter/#c=` link, press Confirm, open the welcome's `#u=` link, press Unsubscribe; screenshots at 360, 768, 1024, 1280 and 1600 px, light and dark, saved in `$HOME/.cache/mayobe-shots/`, and read them. Then rebuild **without** `--api`/`--newsletter` before committing. **Step 6: Commit** (sources, tests, regenerated pages).

---

### Task 6: Policies, docs and the owner's checklist

**Files:** `content/pages/privacy-policy.html` (a `{{#newsletter}}<h3>Newsletter</h3>...{{/newsletter}}` subsection in section 2: the address, sign-up time, confirmation time, status, hashed link codes and a per-article send record; double opt-in; Resend as processor in the United States; what is sent: one confirmation, one welcome, one email per new article, one goodbye after using the unsubscribe page; one-click unsubscribe; the one-way codes from IP and address kept about an hour and a day for limits; unconfirmed sign-ups deleted after 7 days, unsubscribed addresses after 30 days, complaints and bounces kept on the do-not-email list; how to ask for a copy or deletion. Also sections 4 "Who we share data with" and 6 "How long we keep data" inside the same conditional), `content/pages/terms-of-service.html` (one `{{#newsletter}}` sentence: free, can stop any time, no promise of how often), `content/pages/cookie-policy.html` (checked: no new storage key, so no change; say so in the report), `worker/README.md`, `CLAUDE.md`, the spec's status line.

- [ ] **Step 1: Failing check** in `pages.test.mjs` (render-level, newsletter on): the privacy page contains `Newsletter`, `7 days`, `30 days` and `Resend`; terms contain the newsletter sentence; with the newsletter off neither page contains `newsletter` (case-insensitive). Run - expect FAIL. **Step 2: Write the pages**, then run - expect PASS.
- [ ] **Step 3: Docs.** `CLAUDE.md`: replace the "the newsletter, Phase 3, is not built" wording in the Email section with a short Newsletter paragraph (where the code lives, `newsletterAction: "api"`, `NEWSLETTER_SEND`, `node scripts/newsletter.mjs`, the 35-a-day slice, policies change with the code); add `newsletter/` to the generated-files list. `worker/README.md`: a "Newsletter" section (routes, cron time, seed rule, 7-day age guard, at-most-once delivery, the CLI) and in "Known limits" the capacity sentence: "The news slice is 35 a day, so one article reaches at most about 27 to 35 subscribers a day (confirmations, welcomes and goodbyes use the same slice); a larger list takes several days or a paid Resend plan." (this replaces the spec's "about 80", because Calls settled item 6 gives the newsletter 35). Spec status line: Phase 3 implemented, pending deploy.
- [ ] **Step 4: Full verification:** `node --no-warnings --test scripts/tests/*.test.mjs`, `node scripts/build.mjs`, `node scripts/build.mjs --check`, `node --no-warnings --test scripts/tests/share.test.mjs`. Report what ran and what did not.
- [ ] **Step 5: Add to "Email setup (owner checklist)" in `worker/README.md`** (do not run any of it): (a) `npx wrangler d1 migrations apply mayobe-engage --remote` (applies 0007; check with `migrations list`); (b) confirm `API_ORIGIN` equals the deployed Worker URL, keep `NEWSLETTER_SEND` `"false"`, `npx wrangler deploy` (this also registers the cron; check it under Workers > mayobe-engage > Settings > Triggers); (c) `node scripts/newsletter.mjs seed` then `node scripts/newsletter.mjs dry-run` and read the report (no old article may be listed to send); (d) set `newsletterAction` to `"api"` in `site.config.json`, rebuild, stage by name, commit, push when you decide; (e) subscribe your own Gmail from the live footer, confirm, check the welcome, use Gmail's own Unsubscribe link and confirm the row is `unsubscribed` with `node scripts/newsletter.mjs list all`; subscribe again; (f) set `NEWSLETTER_SEND` to `"true"` in `wrangler.jsonc` and deploy (a change made only in the Cloudflare dashboard is overwritten by the next `wrangler deploy`); to pause, set it back to `"false"`. `node scripts/mail-test.mjs` already covers the four newsletter templates for a look on a phone; in this task change its sample URLs to the real shapes (`/newsletter/#c=sample`, `/newsletter/#u=sample`; today they show `#confirm=` and `/v1/newsletter/unsubscribe?t=`) and add `scripts/mail-test.mjs` to this task's commit.
- [ ] **Step 6: Commit.**
