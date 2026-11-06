# Resend Email, Email Redesign and Contact Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The comments Worker sends email through Resend: comment manage links, reply notices, owner alerts, and a real contact form, all using a redesigned, legible, luxury-feeling email template set (including the newsletter templates that Plan 3 will send).

**Architecture:** `worker/src/mail.js` sends one message through Resend's REST API (plain `fetch`) with a per-kind daily budget and a suppression list; `worker/src/mail-templates.js` builds every email from one design system (table layout, inline styles, hex colours only) plus a plain-text part; routes in `worker/src/index.js` call `sendMail` inside `ctx.waitUntil` after the data is saved. A tiny built page `/manage/` turns an emailed link into the Phase 1 browser token. Tests use a fake `fetch`; a preview tool renders every template for a human to look at.

**Tech Stack:** Cloudflare Worker (plain JS, no dependencies), D1/SQLite, Resend REST API, headless Chromium (already installed) for previews.

**Spec:** `docs/superpowers/specs/2026-11-06-comment-controls-and-email-design.md` (Phase 2 and "Calls settled", items 2, 3, 5, 6, 7). Depends on Plan 1 (`docs/superpowers/plans/2026-11-06-comment-controls.md`) being merged: it uses `ownerRow`, `mb_own`, `manage_hash`, migration `0004`. Plan 3 (newsletter) comes later.

## Global Constraints

- Node: `export PATH=$HOME/tools/node/bin:$PATH`. Plain JS, no new dependencies. Tests: `node --no-warnings --test scripts/tests/*.test.mjs` (Plan 1 left the suite green; record the new baseline first).
- Resend call: `POST https://api.resend.com/emails`, headers `Authorization: Bearer <RESEND_API_KEY>`, `Content-Type: application/json`, and an explicit `User-Agent: mayobe-engage/1.0` (Resend answers 403 without one). Body fields `from, to, subject, html, text, reply_to, headers, tags`. Header `Idempotency-Key` on every send (<= 256 chars). Success body `{ "id": "..." }`. Resend's docs do not show the error body or confirm the `reply_to` spelling, so the owner's first live test must confirm both; the module must log the status and body of a failure (never the key).
- Missing `RESEND_API_KEY` = log once and skip; **no email failure may fail, delay or roll back a request**. Sends run in `ctx.waitUntil` after data is saved.
- Free plan: 100 emails a day, 3,000 a month. Daily budget 80, split by kind: `owner` 10, `commenter` 25, `contact` 10, `news` 35. A full slice never borrows from another. Day = UTC date.
- Senders: `MAIL_FROM` default `Mayobe Bros <info@mayobebros.com>`, `MAIL_FROM_SUPPORT` default `Mayobe Bros <support@mayobebros.com>`; `OWNER_EMAIL` var (default `info@mayobebros.com`). The domain is verified in the owner's Resend account (owner's statement, 2026-11-06). Secrets only in Worker secrets / `.dev.vars`: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`. Never read, print or copy values from the old project's `.env`.
- Every visitor-supplied value is HTML-escaped (`& < > " '`) before it enters HTML; CR/LF are removed from anything used in a subject or header.
- Email design (from research, 2026-11-06): 600 px table layout, all styles inline, `role="presentation"` on layout tables, `lang="en"`, one `<h1>`, `<title>`, hex colours only (no `rgba`, gradients, `box-shadow`, background images, SVG, web fonts, `@import`), body text 16 px / line-height 1.6, smallest text 12 px, one primary button 48 px tall plus the same link as text, buttons built as `bgcolor` cell + padded `<a>`, preheader 90 to 130 characters hidden with `display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0` as the first element in `<body>`, each HTML under 40,000 bytes, a hand-written plain-text part, `<meta name="color-scheme" content="light dark">` and `supported-color-schemes`, a `@media (prefers-color-scheme: dark)` override block.
- Colour tokens (light; ratio against its background is the minimum to keep): page `#f4f1ea`, card `#fffffe`; heading `#0f1c2e` (17.1), body `#374151` (10.3), muted `#4b5563` (7.6), eyebrow/gold text `#7a5c00` (6.3), link `#1d4f91` underlined (8.1), button navy `#0f1c2e` with `#ffffff` text (17.1); header `#0f1c2e` with white wordmark and gold hairline `#c9a000` (decorative only); footer bg `#0b1520`, footer text `#c3cbd8` (11.3), footer link `#e6c35c` underlined (10.8). Dark override: page `#0c121b`, card `#172131`, heading and body `#e8ebf0`, muted `#a9b3c2`, gold text `#e0b84a`, link `#8fb8ff`, button `#e0b84a` with `#0f1c2e` text (9.1). Fonts: headings `Georgia,'Times New Roman',Times,serif` 28 px (26 px mobile); body `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`. Spacing 8/16/24/32/48; card padding 40 (24 mobile). Gmail Android ignores `@media` and auto-inverts, so the **light palette must stand on its own**; the dark block is a bonus for Apple Mail.
- Writing: plain English, no hype, per `docs/writing-guide.md`; no income promises, no fake numbers.
- Outward actions are not in this plan: `wrangler secret put`, remote migration, `wrangler deploy`, setting up the Resend webhook, and any real send need the owner's approval (Task 8 ends with a checklist). Commits: local only, never push; stage files by name.
- Logo: use the site's own mark at a stable https URL on `https://mayobebros.com/assets/img/` (width/height attributes, alt text, `bgcolor` fallback cell and a text wordmark next to it). The implementer must look at the image with the Read tool before choosing how it sits on the navy header.

## Review Focus

1. A comment or name containing `<script>`, `"` quotes, `\r\n` or 5,000 characters can never break the HTML, a header or the subject. (Tasks 2, 4)
2. Resend down, key missing, 429 or a thrown `fetch` leaves the comment, contact message or reply saved and the HTTP response unchanged. (Tasks 1, 4, 6)
3. A stranger's address typed into the form receives at most one email a day and nothing more until the link is opened; opening a link twice, an expired link and a link for a deleted comment behave safely. (Task 4)
4. Budget slices cannot be exceeded by concurrent sends, and a contact flood cannot starve commenter mail. (Task 1)
5. Every template stays under the lint rules in dark and light (contrast, sizes, no forbidden CSS) as copy gets longer (long names, long subjects). (Task 2)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `worker/migrations/0005_mail.sql` (create) | `manage_links`, `mail_budget`, `suppressed`; `comments.notify_wanted`, `comments.notify_confirmed` |
| `worker/src/mail.js` (create) | `sendMail`, budget, suppression, Resend call |
| `worker/src/mail-tokens.js` (create) | colour/spacing tokens, `contrast()`, `PAIRS` (the contrast pairs the lint test checks) |
| `worker/src/mail-templates.js` (create) | shell and components, `esc`, `oneLine`, and every email: `manageLinkEmail`, `replyNoticeEmail`, `ownerAlertEmail`, `contactOwnerEmail`, `contactVisitorEmail`, `confirmSubscriptionEmail`, `welcomeEmail`, `newPostEmail`, `farewellEmail` |
| `worker/src/question.js` (create) | `looksLikeQuestion(text)` moved from `scripts/qa-sync.mjs` |
| `worker/src/index.js` (modify) | create route (checkbox, manage link mail, alerts), reply notices, `/v1/manage/exchange`, `/v1/notify/unsubscribe`, `/v1/contact`, `/v1/webhooks/resend` |
| `scripts/tests/mail.test.mjs`, `scripts/tests/email-templates.test.mjs` (create), `scripts/tests/worker.test.mjs` (modify) | tests |
| `scripts/tools/email-preview.mjs` (create) | renders every template to HTML and PNG (375 and 600 px, light and dark) |
| `scripts/mail-test.mjs` (create) | owner-run: send one template to one address |
| `scripts/lib/render.mjs`, `js/engage.js`, `js/site.js`, `js/manage.js` (create), `content/pages/manage.html` (create), `css/style.css` | checkbox, manage page, contact form endpoint |
| policies, `worker/README.md`, `worker/wrangler.jsonc`, `CLAUDE.md` | documentation and config |

---

### Task 1: Mail core (send, budget, suppression)

**Files:** Create `worker/migrations/0005_mail.sql`, `worker/src/mail.js`, `scripts/tests/mail.test.mjs`.

**Interfaces:**
- Produces: `sendMail(env, ctx, msg): Promise<{ ok: boolean, skipped?: 'no-key'|'budget'|'suppressed'|'bad-address', id?: string, status?: number }>` where `msg = { kind: 'owner'|'commenter'|'contact'|'news', to: string, subject: string, html: string, text: string, replyTo?: string, from?: string, headers?: Record<string,string>, tags?: {name,value}[], key: string }` (`key` = idempotency key). It never throws. Constant `CAPS = { owner: 10, commenter: 25, contact: 10, news: 35 }`. `async function takeBudget(env, kind): Promise<boolean>`.
- Migration `0005`: `mail_budget(day TEXT, kind TEXT, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, kind))`; `suppressed(email TEXT PRIMARY KEY, reason TEXT, created INTEGER)` (lowercased address); `manage_links(hash TEXT PRIMARY KEY, comment_id INTEGER NOT NULL, kind TEXT NOT NULL, expires INTEGER, created INTEGER NOT NULL)` with an index on `comment_id`; `ALTER TABLE comments ADD COLUMN notify_wanted INTEGER NOT NULL DEFAULT 0` and `notify_confirmed INTEGER NOT NULL DEFAULT 0`.

- [ ] **Step 1: Write failing tests** in `mail.test.mjs` with a fake `globalThis.fetch` recording requests: `'sends one message with the right headers and body'` (URL, `Authorization: Bearer <key>`, `User-Agent` present, `Idempotency-Key` equals `key`, JSON has `from,to,subject,html,text,reply_to`, default `from` is `Mayobe Bros <info@mayobebros.com>`); `'no key = skipped, no fetch'`; `'budget: 11th owner mail in a day is skipped, commenter slice unaffected, next UTC day resets'` (use a `now` seam or set `mail_budget.day` rows); `'concurrent sends cannot exceed a slice'` (`Promise.all` of 15 owner sends → exactly 10 fetches); `'a suppressed address is never mailed'`; `'429, 500, a thrown fetch and a non-JSON body all return ok:false and never throw, and the failure is logged without the key'` (spy on `console.error`; assert the key string is absent); `'CR/LF in subject or address are rejected or stripped'`; `'a failed send gives its budget unit back'`.
- [ ] **Step 2: Run** `node --no-warnings --test scripts/tests/mail.test.mjs` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the migration and `mail.js` (budget taken with one atomic `INSERT ... ON CONFLICT DO UPDATE SET n = n + 1 WHERE n < cap RETURNING n`-style statement, or take-then-check-then-refund; the test for concurrency decides). Add a `.dev.vars.example` line list in `worker/README.md` later (Task 8).
- [ ] **Step 4: Run** — expect PASS. **Step 5: Commit** (stage the three files by name).

---

### Task 2: Email design system and every template

**Files:** Create `worker/src/mail-tokens.js`, `worker/src/mail-templates.js`, `scripts/tests/email-templates.test.mjs`.

**Interfaces:**
- Consumes: nothing from earlier tasks (pure functions).
- Produces: `esc(s)`, `oneLine(s)`; `contrast(fgHex, bgHex): number`; `PAIRS: Array<[fg, bg, min, label]>`; each template builder returns `{ subject: string, html: string, text: string }` and takes `(data, site)` where `site = { origin: 'https://mayobebros.com', logoUrl: string }`:
  - `manageLinkEmail({ name, commentExcerpt, postTitle, postUrl, manageUrl, notifyWanted })`
  - `replyNoticeEmail({ name, postTitle, postUrl, replyAuthor, replyBody, unsubscribeUrl, isTeam })`
  - `ownerAlertEmail({ reason, postSlug, postUrl, commentId, name, body, kind: 'held'|'question'|'contact-failed' })`
  - `contactOwnerEmail({ name, email, subject, message, type, receivedAt })`
  - `contactVisitorEmail({ name, subject, type })` (no copy of the message; says when to expect a reply as "within 2 to 3 working days", technical issues "within 24 hours", matching the old project)
  - `confirmSubscriptionEmail({ confirmUrl })`, `welcomeEmail({ unsubscribeUrl, latestPosts })`, `newPostEmail({ post, unsubscribeUrl })`, `farewellEmail({ resubscribeUrl })` (used by Plan 3)

- [ ] **Step 1: Read** `docs/writing-guide.md` and look at the logo files (`assets/img/icon-192.png`, `logo.png`) with the Read tool; decide how the mark sits on the navy header (white tile behind a dark mark if the mark is dark). Note the decision in the report.
- [ ] **Step 2: Write failing tests** in `email-templates.test.mjs`, run for **every** builder with long, hostile sample data (a 120-character name, `<script>alert(1)</script>`, quotes, `\r\nBcc: x@y.z`, a 2,000-character message):
  - structure: exactly one `<h1`; `<html lang="en"`; a `<title>`; every `<table` has `role="presentation"`; every `<img` has `alt`, `width`, `height`; both color-scheme metas; a `prefers-color-scheme: dark` block;
  - forbidden: `rgba(`, `gradient`, `box-shadow`, `background-image`, `<svg`, `@import`, `@font-face`, `url(` inside any `style` attribute or block, `<script`;
  - sizes: every `font-size:NNpx` is >= 12; `Buffer.byteLength(html)` < 40,000; body paragraph helper emits 16 px;
  - colours: every `#hex` colour used in HTML is in the token set (light or dark); every `[fg,bg,min]` in `PAIRS` has `contrast(fg,bg) >= min` (4.5 normal text, 3 for 24 px+ headings and 14 px bold+, UI/decor excluded and listed as such);
  - preheader: first element after `<body>` is hidden and its text is 90 to 130 characters;
  - safety: output contains no raw `<script`, no unescaped `"` inside attribute values from data, `subject` and `text` contain no CR/LF except line breaks inside `text`; the hostile `\r\nBcc:` never appears in a header-bound string;
  - primary action: HTML has exactly one button (a `bgcolor` cell wrapping an `<a>` with `padding` giving >= 48 px height) and the same URL appears as a text link and in `text`;
  - plain text: `text` is non-empty, contains no HTML tags, and includes every URL in `data`.
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement** `mail-tokens.js` (tokens above, `contrast` per WCAG relative luminance, `PAIRS` covering heading/body/muted/gold/link/button/footer and header wordmark in both modes) and `mail-templates.js`: shared `shell({ title, preheader, bodyHtml, footerHtml })`, components `h1`, `eyebrow` (letter-spaced capitals typed directly, 12 px, gold `#7a5c00`), `p`, `button`, `quote` (comment excerpt block with left hairline), `hairline`, `footer` (14 px, underlined links each on its own line, with "Why you got this" sentence). Luxury cues from research: whitespace, one gold accent, 1 px rules, serif heading over sans body, one button per email, flat fills. Copy for each email per the spec and old project's intent, in plain English.
- [ ] **Step 5: Run** — expect PASS. **Step 6: Commit.**

---

### Task 3: Preview tool and the owner's look-and-fix pass

**Files:** Create `scripts/tools/email-preview.mjs`; output under `$HOME/.cache/mayobe-email-preview/` (not in the repo).

**Interfaces:** Consumes every builder from Task 2. Produces `node scripts/tools/email-preview.mjs` which writes `<name>.html` and `<name>-{375,600}-{light,dark}.png` for all templates, and prints each template's byte size and the contrast table result.

- [ ] **Step 1: Implement** the tool with headless Chromium (find it like `scripts/lib/share.mjs` does; `CHROME_BIN` override) using `emulateMedia`-equivalent flags for dark (`--force-dark-mode` is not the same as the media feature: prefer a tiny Playwright script with `page.emulateMedia({ colorScheme: 'dark' })`; if Playwright is not importable from the project, use `playwright-cli`).
- [ ] **Step 2: Run it and look at every PNG** with the Read tool (all 9 templates, 375 and 600 px, light and dark = 36 images; sample at least the manage link, reply notice, contact owner and new-post email in full detail). Fix anything cramped, clipped, too faint or off-brand in `mail-templates.js`; re-run the Task 2 tests.
- [ ] **Step 3: Write the findings** into the report: what was changed from the old project's design and why (the old gold-on-white and 25 to 40% white-on-navy text failed contrast; 9 to 11 px labels removed; rgba and gradients removed). Say what could not be verified here (Outlook Word engine, Gmail Android auto-inversion, Samsung Mail, spam placement) and that the owner should send the real test mails (Task 8).
- [ ] **Step 4: Commit** (the tool and any template fixes).

---

### Task 4: Comment emails (checkbox, manage link, reply notices, owner alerts, unsubscribe)

**Files:** Modify `worker/src/index.js`; create `worker/src/question.js`; modify `scripts/qa-sync.mjs` (import `looksLikeQuestion`); tests in `scripts/tests/worker.test.mjs` (fake `globalThis.fetch` for `api.resend.com`).

**Interfaces:**
- Consumes: `sendMail` (Task 1), templates (Task 2), Plan 1's `ownerRow`, `newToken`, `sha`, `hit`.
- Produces: create route accepts `notify: boolean` (only used when `email` is valid). `ownerRow` also accepts a **device token**: a row in `manage_links` with `kind='device'` for that comment (no expiry). `POST /v1/manage/exchange { link }` -> `200 { ok, id, slug, token }` (a new device token for that comment; the `link` row `kind='link'` must exist, not be expired (7 days) and its comment must still be `approved` or `pending`; reusable until it expires; also sets `notify_confirmed = 1` when `notify_wanted = 1`); unknown/expired/other -> the same 404 body as Plan 1. `POST /v1/notify/unsubscribe { token }` -> `200` and sets `notify_wanted = 0, notify_confirmed = 0` for that comment (token = `manage_links.kind='unsub'`, stored hashed, no expiry). `looksLikeQuestion(text): boolean`.

- [ ] **Step 1: Write failing tests:** (a) ticking `notify` with an email stores `notify_wanted=1` and sends exactly one email (`manageLinkEmail`) to that address, with a link containing `#` and a 32+ character token that is **not** stored in clear (only `sha(token)` in `manage_links`); no email is sent when `notify` is false, when the email is empty, or when the comment is a duplicate/bot post; (b) at most one manage-link email per address per day and per IP per day (second request: comment still saved, no second email); (c) `exchange` happy path stores a device token that `ownerRow` accepts for edit/delete and gives `notify_confirmed=1`; reusing the link within 7 days works; after `created + 7d` (set via raw DB) it 404s; a link for a deleted comment 404s; (d) reply notice: a new approved reply to a parent with `notify_confirmed=1` sends one email with the reply text escaped and an unsubscribe URL; none when the replier has the same `cid` as the parent, when not confirmed, after `unsubscribe`, to a suppressed address, or twice for the same parent in a day; the team reply route (`/v1/admin/reply`) and admin `approve` of a pending reply also notify; (e) owner alert: a held comment sends `ownerAlertEmail` with its reasons to `OWNER_EMAIL`; an approved comment that `looksLikeQuestion` sends a `question` alert; ordinary approved comments send nothing; (f) hostile name/body text never appears unescaped in any sent HTML (assert against the captured fetch bodies); (g) when `fetch` throws or returns 500 the comment API response is identical to the success case; (h) `question.js` unit tests reuse the cases implied by the regex in `scripts/qa-sync.mjs`, and `qa-sync.mjs` now imports it.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement** the routes and hooks (all sends via `ctx.waitUntil(sendMail(...))` after the data is committed; per-address and per-IP daily limits via `hit`; the unsubscribe token is created with the first notice mail and stored in `manage_links`).
- [ ] **Step 4: Run** the whole suite — expect PASS. **Step 5: Commit.**

---

### Task 5: Page — checkbox and `/manage/`

**Files:** Modify `scripts/lib/render.mjs` (`engageBlock` checkbox), `js/engage.js` (send `notify`; hide the checkbox until an email is typed), create `content/pages/manage.html` and `js/manage.js`, modify `css/style.css`; modify `scripts/build.mjs` only if new static page registration is needed (follow how other `content/pages/*.html` are registered; the page is `noindex` and not in the sitemap).

**Interfaces:** Consumes `POST /v1/manage/exchange` and `POST /v1/notify/unsubscribe`. `/manage/` reads `#l=<link>` or `#u=<unsubscribe token>` from the URL fragment, calls the API, stores `{id: deviceToken}` in `mb_own` (Plan 1's `ownSet` logic, duplicated minimally in `manage.js` or shared via a tiny exported helper), clears the fragment with `history.replaceState`, then shows "Taking you to your comment..." and navigates to `/post/<slug>/#comment-<id>`; errors show a plain message and a link to the contact page. The page has `<meta name="referrer" content="no-referrer">`.

- [ ] **Step 1: Failing check:** a `pages.test.mjs` assertion that the built `/manage/index.html` exists, is `noindex`, has `no-referrer`, and that post pages contain the checkbox markup (`name="notify"`) with label text "Email me a link to edit or delete this comment, and tell me when the team replies" and a hint that the address is used only for this.
- [ ] **Step 2: Implement** markup, `manage.js`, CSS (checkbox row >= 24 px target; visible focus). **Step 3: Verify in a browser** against `scripts/dev-api.mjs` with a fake Resend (`globalThis.fetch` stub in dev-api when `RESEND_API_KEY` is `dev`): tick the box, capture the "sent" link from the dev log, open `/manage/#l=...`, confirm the redirect and that Edit/Delete appear; screenshots at 5 widths, light and dark, in `$HOME/.cache/mayobe-shots/`; read them.
- [ ] **Step 4: Commit** (generated pages included).

---

### Task 6: Contact form through Resend

**Files:** Modify `worker/src/index.js`, `scripts/lib/render.mjs` (`contactForm()`: `data-endpoint` = `<commentsApi>/v1/contact` when the API is on), `js/site.js` (~line 896-916: POST JSON to the endpoint; keep the mailto fallback on failure), tests in `worker.test.mjs`.

**Interfaces:** `POST /v1/contact { name, email, subject, message, type?, website, ts }` -> `200 { ok: true }` / `400` validation / `429`. Limits: 3 per hour per hashed IP, 2 per hour per address; honeypot `website` and minimum typing time like comments (pretend success); links in the message are allowed (a real person may paste a link) but the message is capped at 3,000 characters; name 2 to 50, subject 3 to 120. Sends `contactOwnerEmail` (kind `owner`, `reply_to` = visitor) and `contactVisitorEmail` (kind `contact`). If the owner mail cannot be sent (no key, budget, error) the response is `503 { error: 'We could not send your message. Please email us at <address>.' }` so the form shows the mailto fallback; if only the confirmation fails the response is still `200`. Messages are not stored; a `mail_budget`-style tiny log is enough.

- [ ] **Step 1: Failing tests** for happy path, validation, hostile text escaped in both emails, honeypot/fast post silently dropped with no mail, limits, budget slice isolation (a contact flood to the `owner` cap does not stop `commenter` mail), owner-mail failure -> 503, confirmation failure -> 200. **Step 2: Implement.** **Step 3: Browser check** of the form on `/contact/` against `dev-api` (success, validation error, 503 fallback) at 3 widths. **Step 4: Commit.**

---

### Task 7: Bounce and complaint webhook

**Files:** Modify `worker/src/index.js`; tests in `worker.test.mjs`.

**Interfaces:** `POST /v1/webhooks/resend` (exempt from the Origin check, like `/v1/admin/`) verifies Svix headers `svix-id`, `svix-timestamp`, `svix-signature` against the raw body with `RESEND_WEBHOOK_SECRET` (`whsec_<base64>`): signed content `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the base64-decoded secret, compared in constant time against each space-separated `v1,<base64>` signature; timestamp within 5 minutes; failure -> `400`. On `email.bounced` and `email.complained` insert every recipient into `suppressed`. Other events -> `200` ignored.

- [ ] **Step 1: Failing tests** with a signature computed in the test: valid bounce suppresses; complaint suppresses; wrong signature, old timestamp, missing headers and a tampered body -> 400; unknown event -> 200 and no change; multiple signatures in the header where one is valid -> accepted. **Step 2: Implement** (the signing algorithm is documented by Svix; the implementer must open `https://docs.svix.com/receiving/verifying-payloads/how-manual` and Resend's `https://resend.com/docs/webhooks/verify-webhooks-requests` and note in the report anything that differs). **Step 3: Run suite. Step 4: Commit.**

---

### Task 8: Policies, config, docs, verification

**Files:** `content/pages/privacy-policy.html` (Resend as processor, what is emailed and when, contact form data and retention, the reply-notice opt-in, bounces), `content/pages/comment-policy.html` (the checkbox and the manage link), `content/pages/contact.html` (form now sends email; mailto stays as a fallback), `content/pages/cookie-policy.html` (no change unless a new storage key appears), `worker/wrangler.jsonc` (vars `MAIL_FROM`, `MAIL_FROM_SUPPORT`, `OWNER_EMAIL` and the secrets comment), `worker/README.md`, `CLAUDE.md` (a short "Email" section: where templates live, the lint test, the preview tool, budgets, the setup checklist), `.gitignore` check for `.dev.vars*`, `scripts/mail-test.mjs`.

- [ ] **Step 1:** Update the pages and docs (keep inside the `{{#comments}}` conditionals the site uses). **Step 2:** `scripts/mail-test.mjs <template> <to>`: sends one built template through `sendMail` using `RESEND_API_KEY` from the environment; refuses to run without `--yes`; prints status only. Do **not** run it.
- [ ] **Step 3: Full verification:** the full test suite, `node scripts/build.mjs`, `node scripts/build.mjs --check`, the preview tool one more time, and the browser checks from Tasks 5 and 6 on the built site. Report what ran and what did not.
- [ ] **Step 4: Report the owner's checklist (do not run it):** (1) confirm `OWNER_EMAIL`; (2) `wrangler secret put RESEND_API_KEY` (the owner pastes it; never echo it) and `RESEND_WEBHOOK_SECRET`; (3) apply migrations `0004` and `0005` remotely; (4) `wrangler deploy`; (5) in Resend add the webhook URL `<worker>/v1/webhooks/resend` for `email.bounced` and `email.complained` and copy its signing secret; (6) run `scripts/mail-test.mjs` for each template to the owner's own Gmail, an Outlook address and a Yahoo address and look at them on a phone (this also confirms Resend's `reply_to` field and the error body); (7) rebuild and `git push`; (8) post a test comment with the box ticked.
- [ ] **Step 5: Commit.**
