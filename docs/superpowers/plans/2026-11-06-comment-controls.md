# Comment Controls (edit, delete, like) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a commenter edit (30 minutes, until replied to) and delete their own comment, and let any visitor like a comment, with no accounts and no email.

**Architecture:** Each new comment gets a random manage token; the Worker stores only its SHA-256 hash, the browser keeps the token in localStorage (`mb_own`) and sends it in the JSON body to `/v1/comments/:id/edit` and `/delete`. Edits re-run the create-time screen. Deleting a comment that has replies turns it into a blanked tombstone; otherwise the row is removed. Likes are a `comment_likes` table plus a counter column. `js/engage.js` adds the buttons.

**Tech Stack:** Cloudflare Worker (plain JS, no dependencies), D1/SQLite, vanilla browser JS, hand-written CSS. Tests: `node --test` against `scripts/lib/d1-shim.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-06-comment-controls-and-email-design.md` (Phase 1 and "Calls settled after the builder check", items 1 and 7). Plans for Phase 2 (Resend, email templates, contact form) and Phase 3 (newsletter) come later, after Phase 1 is live and checked by the owner.

## Global Constraints

- Node is not on PATH: `export PATH=$HOME/tools/node/bin:$PATH`. Plain JS, **no new dependencies**, no build step for the Worker.
- Run tests with `node --no-warnings --test scripts/tests/worker.test.mjs scripts/tests/moderation.test.mjs` (baseline before this plan: 28 pass, 0 fail).
- Edit window: 30 minutes from `created` (`EDIT_WINDOW_MINUTES` env var may override, default 30). Edit allowed only on an `approved` comment that has no replies. A reply counts when its status is `approved` or `pending`.
- Token: 24 random bytes, base64url (32 characters, regex `^[A-Za-z0-9_-]{32,64}$`), returned **once** on creation, only its SHA-256 hex stored in `comments.manage_hash`. Sent in the JSON body, never in a URL. Compare with the existing constant-time `same()`.
- A wrong token, an unknown id, a comment with no `manage_hash`, a team comment, a `spam` or `deleted` comment all return the **same** `404` with `{"error":"That comment could not be found."}`. (A spam-marked comment cannot be self-deleted, or a spammer could erase the record that holds them for review.)
- Tombstone (public JSON): `{ id, name: "", body: "This comment was deleted.", at, deleted: true, likes: 0, replies: [...] }`. Database row after delete-with-replies: `status='deleted'`, `name=''`, `body=''`, and `email`, `manage_hash`, `prev_body`, `ip_hash`, `cid`, `flag`, `edited_at` all `NULL`, `likes=0`, its `comment_likes` rows removed. A tombstone is removed when its last reply (any status) is removed.
- `post_stats.comments` counts only `approved` rows. Every status change updates it in the same `env.DB.batch()` as the row change.
- Owner-facing outward actions (`wrangler deploy`, remote D1 migration, `git push`) are **not part of this plan**: stop and ask the owner. Commits: ask the owner once at the start whether local commits are allowed; if not, skip every "Commit" step and leave changes uncommitted. Never push.
- `scripts/comments.mjs` has uncommitted edits by the owner (the `STATIC_COPY_NOTE` lines). Edit on top of them; do not revert them.
- Generated files (`post/`, `index.html`, `data/`, etc.) are never hand-edited; rebuild with `node scripts/build.mjs`.
- CSS: every new `@keyframes` needs a unique name; `body`/`html` must keep no `transform`. Dark mode must work (use the existing CSS variables).
- Browser checks use `playwright-cli` (needs `PLAYWRIGHT_BROWSERS_PATH` and `--browser=chromium` on this machine; see memory note), screenshots go under `$HOME/.cache/`, never `/tmp`.

## Review Focus

1. Two quick taps of Like (or two tabs) must not double count or return 500: a UNIQUE conflict is treated as "already liked". (Task 4)
2. Token or id input that is junk (empty, 10,000 characters, unicode, `"abc"` as id, negative id) returns the generic 404/400, never 500. (Tasks 2, 3)
3. Editing to identical text, or to text that differs only by whitespace, is a harmless no-op and does not reset the 30-minute window or write `prev_body`. (Task 2)
4. A deleted question that already has a Team reply must not break `scripts/qa-sync.mjs` or the built page (`name` is empty, `body` is the placeholder). (Tasks 1, 3)
5. A cached old `js/engage.js` talking to the new Worker still renders (new JSON fields are additive; a tombstone has a non-empty `body`). (Task 1)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `worker/migrations/0004_comment_controls.sql` (create) | new columns and `comment_likes` table |
| `worker/src/index.js` (modify) | token on create, new public shape, `edit`/`delete`/`like` routes, orphan-tombstone purge, admin list fields |
| `scripts/tests/worker.test.mjs` (modify) | tests for all of the above |
| `scripts/qa-sync.mjs` (modify) | skip tombstones |
| `scripts/comments.mjs` (modify) | show edit info to the moderator |
| `js/engage.js` (modify) | own-comment storage, Like/Edit/Delete UI |
| `css/style.css` (modify, append) | `.comment-tools`, `.comment-tool`, `.comment-like`, `.comment-edit`, `.comment-confirm`, `.is-deleted` |
| `scripts/lib/render.mjs` (modify, `engageBlock` ~line 1079) | a live-region element in the comments section |
| `content/pages/comment-policy.html`, `privacy-policy.html`, `cookie-policy.html`, `worker/README.md`, `CLAUDE.md` (modify) | documentation kept in line with behaviour |

---

### Task 1: Migration, token on create, new public shape

**Files:**
- Create: `worker/migrations/0004_comment_controls.sql`
- Modify: `worker/src/index.js` (comment create route ~181-231; public list route ~138-150; header comment ~1-14)
- Modify: `scripts/qa-sync.mjs:42-46`
- Test: `scripts/tests/worker.test.mjs`

**Interfaces:**
- Produces (used by Tasks 2-6): `async function newToken(): Promise<string>` (24 random bytes, base64url, no padding); `async function ownerRow(env, id, token): Promise<Row|null>` returns the comment row (`id, slug, parent_id, status, created, body, cid, ip_hash, name`) only when `token` matches `manage_hash` in constant time and status is `approved` or `pending`, else `null`; constant `TOKEN_RE`; constant `NOT_FOUND = 'That comment could not be found.'`; helper `hasReplies(env, id): Promise<boolean>`.
- Produces: create response `{ ok, status, comment, id, token }` where `id` (the new row's id) and `token` are present for a newly inserted comment (approved or pending, so the browser can store the token even when `comment` is null) and absent for `duplicate` and bot responses. Public comment object gains `likes: number`, optional `edited: <ms>`, optional `deleted: true`.

- [ ] **Step 1: Write failing tests** in `scripts/tests/worker.test.mjs`:
  - `'a new comment returns its manage token once, and only a hash is stored'`: post a clean comment; assert `r.json.token` matches `/^[A-Za-z0-9_-]{32,}$/`; `GET /v1/posts/hello-post` JSON contains neither the token nor the strings `manage_hash`, `prev_body`, `email`; `env.DB.raw.prepare('SELECT manage_hash FROM comments WHERE id=?').get(id).manage_hash` has length 64 and differs from the token; a held (RUDE) comment also returns a numeric `id` and a token even though `comment` is null; a `duplicate` response has neither `id` nor `token`.
  - `'public comments carry likes, and edited and deleted markers only when true'`: fresh comment has `likes === 0` and no `edited` or `deleted` keys.
- [ ] **Step 2: Run** `node --no-warnings --test scripts/tests/worker.test.mjs` — expect the two new tests FAIL (`token` undefined).
- [ ] **Step 3: Create the migration:** `ALTER TABLE comments ADD COLUMN manage_hash TEXT; ... edited_at INTEGER; ... prev_body TEXT; ... likes INTEGER NOT NULL DEFAULT 0;` then `CREATE TABLE IF NOT EXISTS comment_likes (comment_id INTEGER NOT NULL, voter TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (comment_id, voter));` and `CREATE INDEX IF NOT EXISTS idx_comment_likes_voter ON comment_likes (voter);`. Add the same "Apply with `npx wrangler d1 migrations apply mayobe-engage --remote`" header comment the other migrations have.
- [ ] **Step 4: Implement** `newToken`, `TOKEN_RE`, `NOT_FOUND`, `ownerRow`, `hasReplies` in `worker/src/index.js` (use `crypto.getRandomValues`, the existing `sha()` and `same()`; `ownerRow` must still hash the supplied token when the id does not exist so timing does not reveal existence). In the create route generate the token before the INSERT, store `sha(token)` in `manage_hash` (add the column to the INSERT), and return `token` in the response. In the public list route change the query to `status IN ('approved','deleted')`, select `likes, edited_at, status` too, and extend `pub()` per the Global Constraints tombstone shape (tombstones also carry `at` and their replies). Update the file's header comment with the three new routes (written in later tasks) so documentation lands once.
- [ ] **Step 5: qa-sync guard.** In `scripts/qa-sync.mjs` add `.filter((c) => !c.deleted)` before the existing `.filter((c) => !c.team && c.replies.length)` at line ~46, with a one-line comment (a deleted question is never published as a Q&A).
- [ ] **Step 6: Run** the full command from Global Constraints — expect 30 pass, 0 fail.
- [ ] **Step 7: Commit** (if allowed): `git add worker/migrations/0004_comment_controls.sql worker/src/index.js scripts/qa-sync.mjs scripts/tests/worker.test.mjs && git commit -m "Comments: manage token on create, likes/edited/deleted fields"`.

---

### Task 2: Edit endpoint

**Files:**
- Modify: `worker/src/index.js` (new route after the comment-create route)
- Test: `scripts/tests/worker.test.mjs`

**Interfaces:**
- Consumes: `ownerRow`, `hasReplies`, `NOT_FOUND`, `TOKEN_RE` (Task 1); existing `readJson`, `hit`, `ipHash`, `screen`, `LINK_RE`, `fail`, `reply`, `getStats`.
- Produces: `POST /v1/comments/:id/edit` body `{ token, body }` → `200 { ok: true, status: 'approved'|'pending', comment: { id, body, edited } , stats }` ; errors: `404 NOT_FOUND`, `409` (`'This comment is waiting for review, so it cannot be edited. You can still delete it.'`, `'This comment has a reply, so it can no longer be edited.'`, `'The 30 minutes for editing have passed.'`), `400` same wording as create for length and links, `429` when limited.

- [ ] **Step 1: Write failing tests:**
  - `'edit: owner can change an approved comment within 30 minutes'`: create, edit with token; response `status:'approved'`, `comment.edited` is a number; public GET shows new body and `edited`; `prev_body` in the raw row equals the old body; `stats.c` unchanged.
  - `'edit: wrong token, other comment's token, unknown id and junk all give the same 404'`: loop over `[ 'x'.repeat(32), tokenOfComment2, '', 'x'.repeat(10000), '💥', null ]` for comment 1 and ids `[999, -1, 'abc', '1; DROP']`: every status is 404 (or 400 for an oversize body) and the 404 bodies are identical; none is 500.
  - `'edit: refused after 30 minutes, with a reply, with a pending reply, and on a held comment'`: use `env.DB.raw.exec('UPDATE comments SET created = created - 1860000 WHERE id = 1')` for the window; a reply via the API for "with a reply"; a reply made while the parent is approved and then set `pending` through `env.DB.raw` for the pending-reply case; a RUDE comment for the held case. Each returns 409.
  - `'edit: the screen runs again and a flagged edit is held'`: edit to `RUDE` → `200`, `status:'pending'`, public GET no longer lists it, `stats.c` decreases by one, admin list shows the comment with `flag` matching `/word:/` and `prev_body` equal to the old text; the owner can then approve it and the count goes back up.
  - `'edit: links and short text are refused; an unchanged or whitespace-only change is a no-op'`: `'see www.x.com'` → 400; `'ok'` → 400; same text → 200 with no change to `edited_at` (still NULL) and `prev_body` still NULL; text plus trailing spaces/newlines → same.
  - `'edit: needs our Origin and is rate limited'`: no Origin → 403; the 21st edit within an hour from one IP → 429.
  - `'edit: AUTO_APPROVE=false holds every edit'` and `'edit: a visitor with an earlier spam comment is held'`.
- [ ] **Step 2: Run** the worker tests — expect the new tests FAIL (404 route not found).
- [ ] **Step 3: Implement the route.** Order: id parse (`/^\/v1\/comments\/(\d+)\/edit$/`; a non-numeric id never matches and falls through to the existing generic 404), `readJson`, token regex check (else `NOT_FOUND`), rate limits via `hit` (`ed:<ihash>:<hour>` limit 20, `edc:<id>:<hour>` limit 10), `ownerRow`, status/window/replies checks, same normalization and validation as create (factor the shared name/body normalization and length/link checks into one helper used by both routes), no-op detection on the normalized text, then the screen (reasons from `screen(name + "\n" + body)`, `earlier-spam` for the row's `cid`/`ip_hash`, `auto-approve-off`). One `env.DB.batch()` updates `body`, `prev_body` (old body), `edited_at`, `status` (`pending` + `flag` when held) and `post_stats.comments` (−1 when it becomes pending).
- [ ] **Step 4: Run** the worker tests — expect all pass.
- [ ] **Step 5: Commit** (if allowed): `git commit -am "Comments: edit endpoint with re-screening"` (stage only the two files).

---

### Task 3: Delete endpoint and orphan-tombstone purge

**Files:**
- Modify: `worker/src/index.js` (new route; admin `delete`/`spam` actions ~264-276; admin row select ~257)
- Test: `scripts/tests/worker.test.mjs`

**Interfaces:**
- Consumes: `ownerRow`, `hasReplies`, `NOT_FOUND` (Task 1).
- Produces: `POST /v1/comments/:id/delete` body `{ token }` → `200 { ok: true, removed: 'tombstone'|'deleted', stats }`; helper `purgeIfOrphan(env, parentId): Promise<void>` (deletes the parent row if its status is `deleted` and no `approved`/`pending` reply remains); used by this route and by the admin `spam`/`delete` actions for replies.

- [ ] **Step 1: Write failing tests:**
  - `'delete: a comment without replies is removed, counted down, and its likes go'`: create, like it, delete with token → 200, raw row absent, `comment_likes` rows for it absent, `stats.c` 0. (Like route arrives in Task 4: write this assertion block in Task 4's test and keep this test without likes.)
  - `'delete: a comment with a reply becomes a blanked tombstone and the reply stays'`: public GET shows `{deleted:true, name:'', body:'This comment was deleted.'}` with one reply; raw row has all fields in the Global Constraints list blank or NULL; `stats.c` is 1; deleting the reply (owner token) removes the tombstone too (row absent, public list empty, `stats.c` 0).
  - `'delete: a held comment can be deleted without changing the count; a spam-marked or team comment cannot'`: pending → 200, count 0 still; after admin `spam` → 404 and the visitor's next comment is still held as `earlier-spam`; team reply → 404.
  - `'delete: junk ids and tokens are 404, not 500; needs Origin; rate limited'` (21st delete within an hour → 429).
  - `'admin: deleting or hiding the last reply removes an orphan tombstone'`.
  - `'a deleted question with a team reply does not break qa-sync input'`: assert the public JSON shape only (`name === ''`, non-empty `body`, `deleted === true`, `replies[0].team === true`).
- [ ] **Step 2: Run** — expect the new tests FAIL.
- [ ] **Step 3: Implement** the route (same guard order as edit; allowed statuses `approved` and `pending` only). One `env.DB.batch()` for the chosen branch (tombstone UPDATE or DELETE + `DELETE FROM comment_likes WHERE comment_id=?`, plus the `post_stats` −1 when the status was `approved`), then `purgeIfOrphan` for a reply's parent. In the admin route add `parent_id` to the row select and call `purgeIfOrphan(env, row.parent_id)` after `spam`/`delete` when the row is a reply.
- [ ] **Step 4: Run** the worker tests — expect all pass.
- [ ] **Step 5: Commit** (if allowed): `git commit -am "Comments: owner delete with tombstones"` (two files).

---

### Task 4: Like endpoint

**Files:**
- Modify: `worker/src/index.js` (new route; public list route accepts `?cid=` and returns `liked`)
- Test: `scripts/tests/worker.test.mjs`

**Interfaces:**
- Produces: `POST /v1/comments/:id/like` body `{ cid, on: boolean }` → `200 { ok: true, likes: number, liked: boolean }`; `404 NOT_FOUND` unless the comment is `approved`; `400` for a bad `cid`; `429` when limited (120 likes per hashed IP per 10 minutes). `GET /v1/posts/:slug?cid=<cid>` adds `liked: number[]` (ids of this post's comments liked by that visitor); without a valid `cid` the key is absent.

- [ ] **Step 1: Write failing tests:**
  - `'like: add, repeat, remove; counts per comment'`: two visitors like; same visitor twice does not double count; removing lowers it; never below 0; public GET `likes` matches; `GET ...?cid=` lists the id for the liker and not for the other visitor.
  - `'like: only approved comments, valid visitor id, our Origin'` (held comment → 404, `cid:'short'` → 400, no Origin → 403).
  - `'like: a UNIQUE conflict from a double tap is not an error'`: insert the `comment_likes` row directly with `env.DB.raw` and set `likes` unchanged, then call like `on:true` → 200 with a consistent count (no 500). Also two `Promise.all` calls return 200 and `likes` ends at 1.
  - `'like: deleting a comment removes its likes'` (the assertion block deferred from Task 3).
  - `'like: rate limited'` (121st within the window → 429).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the route: validate, rate limit with `hit(env, ctx, 'l:<ihash>:<10-minute bucket>', 120, 700)`, look up the approved comment, read the existing row; `on:true` and not liked → one `batch()` of `INSERT INTO comment_likes` + `UPDATE comments SET likes = likes + 1`; catch an error whose message includes `UNIQUE` and answer as "already liked"; `on:false` and liked → `DELETE` + `UPDATE ... MAX(0, likes - 1)`. Extend the public list route per the interface.
- [ ] **Step 4: Run** the full test command — expect all pass.
- [ ] **Step 5: Commit** (if allowed): `git commit -am "Comments: likes"` (two files).

---

### Task 5: Moderator view and Worker docs

**Files:**
- Modify: `worker/src/index.js` (admin list select ~239), `scripts/comments.mjs` (list printing ~38-43), `worker/README.md`
- Test: `scripts/tests/worker.test.mjs`

**Interfaces:**
- Produces: admin `GET /v1/admin/comments` rows gain `prev_body` and `edited_at`; `node scripts/comments.mjs list` prints `   edited; before the edit: <text>` under any row that has `prev_body`.

- [ ] **Step 1: Write failing test** `'admin list shows the text before an edit'`: edit a comment into a held one (as in Task 2) and assert the admin list row has `prev_body` equal to the old text and numeric `edited_at`; the public GET still never contains `prev_body`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the select change and the two lines in `comments.mjs` (keep the existing `STATIC_COPY_NOTE` code; add one more line to its end-of-run note: "Comments that readers delete themselves also stay in the saved copy until you run qa-sync").
- [ ] **Step 4: Update `worker/README.md`:** new routes with example bodies, the 30-minute rule, tombstones, the `prev_body` retention (erased on delete), the migration `0004` command, and the rollout order (apply migration, deploy Worker, then rebuild and push the site).
- [ ] **Step 5: Run** the full test command — expect all pass. **Commit** (if allowed): `git add worker/src/index.js scripts/comments.mjs scripts/tests/worker.test.mjs worker/README.md && git commit -m "Comments: moderator sees edits; README"`. Note: this commit also contains the owner's earlier uncommitted `comments.mjs` lines; mention that in the message body.

---

### Task 6: Page — Like, Edit and Delete buttons

**Files:**
- Modify: `js/engage.js` (`commentNode` ~196-233, `renderComments`, `refresh`, create handler ~296-315), `css/style.css` (append after the comment rules, near line 540, and one `@media (pointer: coarse)` block), `scripts/lib/render.mjs` (`engageBlock`, add `<p class="sr-only" role="status" data-comment-live></p>` inside `.comments`)
- Test: browser run (no unit test framework exists for `js/`); add `scripts/tests/pages.test.mjs` assertion that a built post page contains `data-comment-live`.

**Interfaces:**
- Consumes: Worker routes from Tasks 1-4 and the public shape (`likes`, `edited`, `deleted`, `liked[]`).
- Produces (inside `engage.js`): `ownGet(id): string|null`, `ownSet(id, token)`, `ownDrop(id)` over localStorage key `mb_own` (JSON object `{ "<id>": "<token>" }`, at most 60 entries, oldest dropped); `startEdit(c, node)`, `askDelete(c, node)`, `toggleLike(c, btn)`; the page tells the reader about outcomes through `[data-comment-live]`.

- [ ] **Step 1: Failing test:** in `scripts/tests/pages.test.mjs` add an assertion that the built `post/<first-slug>/index.html` contains `data-comment-live` (when comments are on). Run `node scripts/build.mjs && node --no-warnings --test scripts/tests/pages.test.mjs` — expect FAIL.
- [ ] **Step 2: Markup:** add the live-region element in `engageBlock`; rebuild; the test passes.
- [ ] **Step 3: Own-comment storage and create flow.** After a successful POST that returns `token`, call `ownSet(j.id, j.token)` (the create response has a top-level `id` even for a held comment; see Task 1).
- [ ] **Step 4: Render tools in `commentNode`.** Row `.comment-tools` after the body: a Like button (`aria-pressed`, label `Like this comment, N likes`, shows the count when above 0, optimistic update, revert and announce on error), Reply (top level only, as now), and for comments with a stored token: **Edit** (only when `c.at` is under 30 minutes old and the comment has no replies) and **Delete** (always). A tombstone (`c.deleted`) renders the placeholder text in `.is-deleted` style with its replies below and no tools. An edited comment shows a muted `edited` label next to the time.
- [ ] **Step 5: Edit flow.** `startEdit` swaps the body for a `div.field` with a labelled textarea (`maxlength=1500`, current text), **Save** and **Cancel** buttons and a `role="status"` line; focus moves to the textarea; Escape cancels; Save posts `{token, body}`, then re-renders via `refresh()`; a held result shows "Your edit needs a quick check by our team. The comment is hidden until it is approved."; errors from the server appear in the status line. After Save or Cancel focus returns to the comment's Edit button, or to the comment itself if the button is gone.
- [ ] **Step 6: Delete flow.** `askDelete` shows an inline confirm row ("Delete this comment? It cannot be undone." with **Delete** and **Keep it**), focus on **Keep it**; confirming posts `{token}`, calls `ownDrop`, announces "Comment deleted." through `[data-comment-live]`, calls `refresh()` and moves focus to the `#comments-h` heading (give it `tabindex="-1"` in `engageBlock`).
- [ ] **Step 7: CSS.** Style `.comment-tools` (flex, wrap, 0.25rem 1rem gap), `.comment-tool` (text button like `.comment-reply`: link colour, underline, min-height 1.75rem; min-height 2.75rem under `@media (pointer: coarse)`), `.comment-like` (pressed state uses `var(--btn-bg)`/`var(--btn-text)` pair, never colour alone: the label also changes), `.comment-edit` (reuses `.field textarea`), `.comment-confirm` (bordered row, uses `var(--line)`), `.comment.is-deleted .comment-body { font-style: italic; color: var(--text-3) }`, `.comment-edited` (`var(--text-3)`, 0.9375rem). New keyframes, if any, must have unique names. Check contrast of `var(--text-3)` on `var(--bg-alt)` in light and dark.
- [ ] **Step 8: Verify in a real browser.** Terminal A: `node --no-warnings scripts/dev-api.mjs`. Terminal B: `node scripts/build.mjs --api http://127.0.0.1:8787 && node scripts/serve.mjs`. With `playwright-cli` open `http://127.0.0.1:8000/post/<a-slug>/` and walk: post a comment, edit it, flag-edit it, like and unlike, reply from a second browser context and confirm Edit disappears, delete a comment with a reply (tombstone), delete the reply (tombstone gone). Take screenshots at widths 360, 414, 768, 1024, 1440, in light and dark, into `$HOME/.cache/mayobe-shots/`; read them. Check keyboard-only operation and that tool buttons are not hover-only. Check `getComputedStyle(document.body).transform === 'none'`.
- [ ] **Step 9: Restore the real build:** `node scripts/build.mjs` (without `--api`), then `git status` to confirm no unintended generated changes remain beyond the expected ones.
- [ ] **Step 10: Commit** (if allowed): stage `js/engage.js css/style.css scripts/lib/render.mjs scripts/tests/pages.test.mjs` plus the rebuilt generated pages; `git commit -m "Comments: like, edit and delete on the page"`.

---

### Task 7: Policies, CLAUDE.md and final verification

**Files:**
- Modify: `content/pages/comment-policy.html` (section "Remove your comment" ~41-42, rules list ~12-15), `content/pages/privacy-policy.html` (Comments paragraph ~15, retention ~59-60, rights ~66), `content/pages/cookie-policy.html` (storage table ~16), `CLAUDE.md` (Moderating comments, Rules), `docs/superpowers/specs/2026-11-06-comment-controls-and-email-design.md` (status line only)

**Interfaces:** none.

- [ ] **Step 1: comment-policy.** Say in plain words: you can edit your own comment for 30 minutes (not after a reply), delete it any time from the browser where you posted it, edits are checked again, edited comments say "edited", a deleted comment with replies leaves a short "deleted" note, emailing remains the way when you changed browser. Keep everything inside `{{#comments}}...{{/comments}}`.
- [ ] **Step 2: privacy-policy.** Add: a secret kept in the browser proves the comment is yours and only a one-way hash of it is stored; likes store the comment, the visitor ID and time; the text before an edit is kept for moderation and erased when the comment is deleted; deleting blanks name, text, email and IP code.
- [ ] **Step 3: cookie-policy.** Add a table row for `mb_own` (Local storage; the secrets that let you edit or delete your own comments; created when you comment; until you clear it or delete the comment), inside `{{#comments}}`.
- [ ] **Step 4: CLAUDE.md.** In "Moderating comments" add two sentences: readers edit/delete their own comments (30 minutes, tombstones), and after a reader deletes an answered question run `node scripts/qa-sync.mjs`, build and push. Do not otherwise restructure the file.
- [ ] **Step 5: Full verification.** Run, in order, and read each result: `node --no-warnings --test scripts/tests/markdown.test.mjs scripts/tests/worker.test.mjs scripts/tests/moderation.test.mjs scripts/tests/pages.test.mjs scripts/tests/share.test.mjs` (all pass), `node scripts/build.mjs` (no errors; read every warning), `node scripts/build.mjs --check`. Confirm `git diff --stat` shows only intended files. Report anything not run.
- [ ] **Step 6: Stop and report to the owner,** with this deploy checklist (do not run it): (1) `cd worker && XDG_CONFIG_HOME=$HOME/.config npx wrangler d1 migrations apply mayobe-engage --remote`; (2) `npx wrangler deploy`; (3) rebuild, then `git push`; (4) check the live site; Phase 2 starts only after the owner confirms.
- [ ] **Step 7: Commit** (if allowed): `git commit -m "Comments: policies and docs for self-service edit and delete"`.
