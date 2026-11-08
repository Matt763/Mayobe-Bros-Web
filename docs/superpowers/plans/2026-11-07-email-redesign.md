# Email Redesign (site look, article pictures, no dead-end links) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every email looks like mayobebros.com (white and royal blue, the colour wordmark, sans headings, pill buttons, the site's cards, its dark mode); the welcome and new-article emails show article pictures and a video thumbnail; and every link in an email lands on a page that answers the click, also when the owner tests the flow locally with real mail.

**Architecture:** The build draws small email JPEGs per post (`assets/email/`, Chromium + ffmpeg like the share cards, hash-cached) and adds three short fields to `data/search.json`, which the Worker already reads, so no new subrequest is spent. `worker/src/mail-tokens.js` and `mail-templates.js` get a new palette and components copied from `css/style.css` (a test keeps them in step); the lint test is extended, never loosened. `scripts/dev-api.mjs` gains a guarded real-mail mode whose links point at the local site, and the `/newsletter/` and `/manage/` pages get clear states with next steps.

**Tech Stack:** Plain Node (no new dependencies), Cloudflare Worker JS, headless Chromium + ffmpeg (already used by `scripts/lib/share.mjs`), Resend REST API, the static build (`scripts/build.mjs`, `scripts/lib/render.mjs`).

**Spec:** No separate design doc. The owner's words (2026-11-07, after receiving the real welcome and confirmation emails): "1. add posts images and video thumbnails in the email address to attract the user 2. the template used is quite different from how the site look like fix it and redesign it well as well to have a good visibility to users. 3. when users click on the links subscribe button and/or click the url provided it takes user to a 404 mayobe bros page which is an error it should provide back a feedback for confirmation upon the request user expect after a click." The 404 page itself has its own plan; not here. Builds on `docs/superpowers/plans/2026-11-07-newsletter.md` (templates, `runNewsletter`, `/newsletter/` page).

**What was found (2026-11-07):**
- The email look is the old React project's brand (`Main.Mayobe.Bros/server/utils/resend.ts`: navy `#0f1c2e`, gold `#c9a000`, Georgia), not the current site. The site: white header with the full-colour wordmark (`assets/img/logo.png`, green "Mayobe", blue "Bros"), system sans at weight 800 to 900 with tight letter-spacing, royal blue `#1e3a9e` pill buttons (`border-radius: 999px`), white cards with a 1 px `#dde4ef` border, 14 px radius and a 16:9 picture, blue uppercase kickers, cool grey `#f3f6fb` sections, a near-black `#060a14` footer, and dark mode `#070b14` / `#101a2e` with light-blue `#8ab6ff` buttons. The emails instead have a navy header bar with a small mark on a white tile and a Georgia wordmark, a gold rule, gold eyebrows, Georgia regular headings, a square navy button (gold in dark mode), warm paper `#f4f1ea` around the card, text-only article lists and gold footer links.
- The new-article email already shows a picture, but it is the share card (logo, chip and domain baked in), so the brand repeats inside the picture.
- Links go to `https://mayobebros.com/newsletter/#c=` / `#u=` and `/manage/#l=`. Live today: `/newsletter/` 404, `/manage/` 404 (not pushed; the newsletter page is built only when `newsletterAction` is `"api"`). `scripts/mail-test.mjs` also uses a wrong article path (`/post/ajira-portal-how-to-apply-public-service-jobs/`, live 404; the real one is `/post/jobs-and-internships/ajira-portal-how-to-apply-public-service-jobs/`). `worker/README.md` step 7 sends every template before the pages exist (step 8), and step 11 deploys the Worker before the page is pushed (step 13).
- Only `content/posts/how-to-find-an-internship-in-tanzania-real-or-fake.md` has a video (`::youtube[...]{poster=assets/posts/how-to-find-an-internship-in-tanzania-real-or-fake.webp}`, a government office's video, so no frame of it may be used; the poster is our own cover).

## Global Constraints

- Node: `export PATH=$HOME/tools/node/bin:$PATH`. No new dependencies. Full suite: `node scripts/build.mjs && node --no-warnings --test scripts/tests/*.test.mjs` (record the green baseline before Task 1). Commits local only, files staged by name (never `git add -A`), never push, never `wrangler deploy`, never a real send (the only real sends are in the final owner check). Scratch and screenshots under `$HOME/.cache/`, never `/tmp`.
- Generated files are never hand-edited; rebuild with `node scripts/build.mjs` (without `--api`/`--newsletter`) and commit the regenerated output with the task that changed its source.
- Every existing email rule stays and is only extended: 600 px table layout, `role="presentation"`, one `<style>` block, hex colours from `mail-tokens.js` only, body 16 px / 1.6, nothing under 12 px, exactly one 48 px button whose URL is repeated as a text link and in the text part, preheader 90 to 130 characters, HTML under 40,000 bytes (far under Gmail's ~102 KB clip), no visitor free text to unverified addresses, builders never throw. In the lint a `bgcolor` attribute directly followed by `<a>` is the button signature, so image slots set their colour with `style="background:..."` only.
- Fonts: system sans only, `FONT_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif"` (the site's stack minus `ui-sans-serif`/`system-ui`), plus the existing monospace for owner commands. No Georgia, no web fonts, no `@font-face`.
- Pictures in email: JPEG (baseline) or PNG only, never WebP/AVIF/GIF/SVG; always `https://` on the asset origin (`https://mayobebros.com` in production) under `/assets/email/`, query only `v=<8 lowercase hex>`; every `<img>` has `alt`, numeric `width` and `height`, and `display:block;border:0;height:auto` (plus `width:100%;max-width:<width>px` when wider than 200). Never a third-party host, never a YouTube thumbnail or any frame from someone else's video, never a per-reader value in an image URL (no tracking; Resend open and click tracking stay off). Play buttons are baked into the JPEG, never CSS overlays.
- Sizes and budgets (file, display): `post-<slug>.jpg` and `video-<slug>.jpg` 1200 x 675 shown at most 600 x 338, at most 100 KB; `thumb-<slug>.jpg` 224 x 168 shown 112 x 84, at most 20 KB; `logo.png` 424 x 96 shown 212 x 48, at most 24 KB. Picture weight per email: welcome at most 170 KB (logo 24 + lead 100 + two thumbnails 40 = 164 worst case), new article at most 130 KB.
- Which emails get pictures: welcome (one lead card with a picture, up to two rows with thumbnails) and new article (one hero, the video picture when the post has a video). Confirm, goodbye, manage-link, reply notice, owner and contact emails carry the logo only.
- Links: same-origin only, as today. `http://` is accepted only for a loopback site origin matching `^http://(127\.0\.0\.1|localhost)(:\d{1,5})?$`; production origins stay https-only; images and the logo are always https even when links are loopback.
- The newsletter's safety logic is not touched: `publishedPosts`, the seed rule, the 7-day age guard, claims, budgets, `SEND_COST` and `SUBREQUEST_CEILING`. Only the mapping from a `search.json` entry to template data changes. Image data costs zero subrequests.
- Real mail from a local run only with `DEV_MAIL_REAL=1` and a non-empty `DEV_MAIL_ALLOW`; the key is read from `worker/.dev.vars` and never printed or logged. Implementer subagents never start real-mail mode.
- Copy follows `docs/writing-guide.md`: plain English, no hype, no promise of reply times or frequency; never "trending" or "popular". Policies change with behaviour (CLAUDE.md).
- CSS: every new `@keyframes` name is unique; `body`/`html` never keep a transform after load.

## Review Focus

1. Pictures blocked (Outlook desktop blocks them by default, data-saver mail apps) or slow on mobile data: the email still says everything in live text (heading, every title, button, links), and blocked slots keep their size with readable alt text. (Task 3: `'with every <img> removed...'`; Task 6 no-image renders)
2. `search.json` built without Chromium (no `m`), or carrying a hostile or malformed `m`, `w` or `a`: no broken, foreign or tracking image, alt escaped and cut. (Task 3)
3. Dark mode in clients that invert by themselves (Gmail iOS full inversion, Gmail Android partial) as well as those that honour `prefers-color-scheme` (Apple Mail): the logo stays readable because its white plate is baked into the PNG. (Task 1 `'logo.png has an opaque white plate'`; Task 6 dark renders)
4. Local real-mail mode misused: a stranger's address, the key printed, a restart reusing Idempotency-Keys (Resend answers 409 to a reused key with a different body), or a loopback origin reaching production output. (Task 4; Task 2 `resolveSite` test)
5. A reader who presses the confirm link twice, on a slow connection, offline, or after 7 days: never a dead end, always a sentence that says what happened and where to go next. (Task 5)

---

## Design references

Surveyed 2026-11-07; techniques adapted, no markup or branding copied.

1. **Cerberus fluid single column** (Ted Goas, MIT; github.com/TedGoas/Cerberus): one 600 px column that scales down without media queries, images with a `width` attribute plus `width:100%;max-width` so Outlook does not blow up 2x files (Litmus retina guide). Adopted for every template; our shell is already of this kind. If any snippet is ever pasted from Cerberus, keep its MIT notice in a comment.
2. **Postmark transactional pattern** (ActiveCampaign/postmark-templates, MIT; Postmark's transactional best-practices guide): brand header, one purpose, say why the email came, short links on their own line, a plain-text twin. Adopted for confirm, goodbye, manage-link, reply, owner and contact emails: logo only, one button, no article pictures.
3. **Editorial "lead story + short list"** (single column is the norm for publication newsletters per Omnisend and Designmodo; Really Good Emails praises skimmable sections): the welcome email gets one large card (the site's `.card`) and up to two compact rows (the site's `.card-h` with a 112 x 84 thumbnail). One large picture keeps the weight low on mobile data.
4. **Linked video poster with a baked-in play button**: `<video>` works in about 24% of clients and Gmail replaces the tags (caniemail, html-video); CSS-positioned play icons break in Outlook. Adopted: a JPEG with the play disc drawn in, linked to the article's `#video-1`, with a live-text "Watch the video" link.
5. **Images-off first** (Litmus image-blocking guide: Outlook desktop off by default; live text, bulletproof buttons, styled alt text, a background colour behind image slots). Adopted in the lint and in every component.

Not adopted: react-email (MIT, but it would add React and a build step to a dependency-free Worker); the look of any named brand (Stripe, NYT, Morning Brew, Substack): only the general patterns above.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/lib/share.mjs` (modify) | export `renderPng` and `encodeJpeg` (shared with email pictures); share-card output unchanged |
| `scripts/lib/email-images.mjs`, `scripts/tools/email-card.html` (create) | draw `assets/email/*` with a hash manifest `.email-images.json` |
| `scripts/build.mjs`, `scripts/lib/render.mjs`, `scripts/lib/markdown.mjs` (modify) | call the email step, add `m`/`w`/`a` to `search.json`, `id="video-<n>"` on video figures, `{{latest-posts:N}}` |
| `worker/src/mail-tokens.js`, `worker/src/mail-templates.js` (modify) | site palette, components, pictures, `resolveSite`, `ownImage` |
| `worker/src/util.js`, `worker/src/newsletter.js` (modify) | `siteOf(env)` with `assetOrigin`; `emailPost()` mapping |
| `scripts/dev-api.mjs`, `scripts/mail-test.mjs`, `worker/.dev.vars.example` (modify) | real-mail mode; real sample data; `--pages-live`, `--dry` |
| `js/newsletter.js`, `js/manage.js`, `content/pages/newsletter.html`, `content/pages/manage.html`, `css/style.css` (modify) | page states and next steps |
| `scripts/tools/email-preview.mjs` (modify) | 360/600, light/dark, `--no-images`, picture weight |
| tests: `email-images.test.mjs`, `dev-api.test.mjs` (create); `email-templates`, `newsletter`, `markdown`, `newsletter-page`, `manage`, `pages` (modify) | |
| `content/pages/privacy-policy.html`, `content/pages/newsletter.html`, `worker/README.md`, `CLAUDE.md`, `docs/image-sources.md` | docs and policies |

---

### Task 1: Email pictures at build time

**Files:** Create `scripts/lib/email-images.mjs`, `scripts/tools/email-card.html`, `scripts/tests/email-images.test.mjs`. Modify `scripts/lib/share.mjs`, `scripts/build.mjs`, `scripts/lib/render.mjs` (`searchIndex`, `createRenderer` args), `scripts/lib/markdown.mjs` (video figures), `scripts/tests/markdown.test.mjs`, `CLAUDE.md` (generated-files list: `assets/email/*`, `.email-images.json`).

**Interfaces:**
- Consumes: `findChrome()` and the quality ladder in `share.mjs`; each post's `image`, `imageFocus`, `imageAlt`, `videos[0].poster`.
- Produces:
  - `share.mjs`: `renderPng({ chrome, url, w, h, png, transparent = false }): void` and `encodeJpeg(png, out, budget, vf = ''): { bytes, quality }` (baseline, 4:2:0, optimal Huffman, the existing `QUALITIES` ladder; `vf` is an ffmpeg filter such as `crop=900:675,scale=224:168`). `drawCard` uses both; share hashes and output are unchanged.
  - `email-images.mjs`: `EMAIL_DIR = 'assets/email'`; `EMAIL_SIZES = { post: [1200, 675], video: [1200, 675], thumb: [224, 168], logo: [424, 96] }`; `EMAIL_BUDGETS = { post: 102400, video: 102400, thumb: 20480, logo: 24576 }`; `emailRel(kind, slug?)` -> `assets/email/logo.png` or `assets/email/<kind>-<slug>.jpg`; `makeEmailImages(specs, { root, dryRun = false, force = false }): { images: Map<slug, { m: string, w?: string }>, warnings: string[], made: number, pruned: number }` with `specs = [{ slug, source, focus?, videoSource? }]`. Per post one Chromium shot at 1200 x 675 gives `post-` and, by ffmpeg crop+scale from the same PNG, `thumb-`; posts with a video get a second shot with `play=1` (`video-`, from `videoSource` = the declared poster, else the cover). The logo is drawn when `logo.png` or the template changes (transparent PNG, white rounded plate, wordmark at 72 px high, palette PNG). `m`/`w` = first 8 hex of the input hash. Without Chromium or ffmpeg, or with `--check`: warn, draw nothing, and leave `m`/`w` out for posts whose files are missing. Files of deleted posts are pruned.
  - `email-card.html?img=<file URL>&fy=<0-100>&w=&h=&play=0|1&logo=0|1`: cover with `object-fit: cover` at `50% fy%`; `play=1` adds a centred white disc (about 128 px at 1200 wide) with a `#0b1220` triangle and a soft dark vignette; no text in any picture.
  - `search.json` entries gain `m` (8 hex: `post-` and `thumb-` exist), `w` (8 hex: `video-` exists) and `a` (the post's `imageAlt`, one line, at most 150 characters), each only when present.
  - `markdown.mjs`: video figures carry `id="video-1"`, `id="video-2"`, ... in body order.

- [ ] **Step 1: Write failing tests.** `email-images.test.mjs` (runs after a build, reuses the `jpegInfo` approach of `share.test.mjs`; skips with a message when `assets/email` is empty and no Chromium is found): `'every post in search.json with m has post- and thumb- files of the exact size, baseline, within budget'`; `'the video post has w and a 1200x675 video- file within budget; posts without a video have no w'` (assert `w` present for `how-to-find-an-internship-in-tanzania-real-or-fake`); `'logo.png is 424x96 and at most 24 KB, with an opaque white plate'` (ffmpeg reads the pixel at 212,48 as `ffffffff` rgba); `'a = imageAlt from the front matter, one line, at most 150 characters'`; `'no file in assets/email belongs to a post that does not exist'`; `'worst-case picture weight: logo + largest post + two largest thumbs <= 170 KB; logo + largest post or video <= 130 KB'`; `'a second build draws 0 email pictures and 0 share pictures'` (spawn the build, its output has no `drawing` line). `markdown.test.mjs`: `'video figures get id video-1 and video-2 in body order'`.
- [ ] **Step 2: Run** `node --no-warnings --test scripts/tests/email-images.test.mjs scripts/tests/markdown.test.mjs` - expect FAIL.
- [ ] **Step 3: Implement** the share refactor first and run `node --no-warnings --test scripts/tests/share.test.mjs` (PASS, `.share-cards.json` unchanged by `git diff`), then `email-images.mjs`, the template, the build call (after the share step, before `createRenderer`; pass `emailImages` to the renderer), the `searchIndex` fields, the video ids, and the CLAUDE.md line.
- [ ] **Step 4: Run** `node scripts/build.mjs` (first run draws about 130 pictures, a few minutes), look at three `post-`, two `thumb-`, the `video-` and `logo.png` files with the Read tool, then the two test files and the full suite - expect PASS.
- [ ] **Step 5: Commit** (sources, tests, `assets/email/`, `.email-images.json`, `data/search.json`, the regenerated post page with video ids).

---

### Task 2: Site look for every email (tokens, shell, components)

**Files:** Modify `worker/src/mail-tokens.js`, `worker/src/mail-templates.js`, `scripts/tests/email-templates.test.mjs`, `worker/src/util.js` (`siteOf`).

**Interfaces:**
- Consumes: `assets/email/logo.png` (Task 1).
- Produces:
  - `mail-tokens.js` `LIGHT`: `page #f3f6fb, card #fffffe, border #dde4ef, heading #0b1220, body #1b2434, muted #364154, kicker #1e3a9e, link #1e3a9e, button #1e3a9e, buttonText #ffffff, quote #f3f6fb, quoteRule #1e3a9e, rule #dde4ef, header #ffffff, logoAlt #1e3a9e, barGreen #3f9b4d, barBlue #1e3a9e, imageBg #e9eef7, imageAlt #364154, footer #060a14, footerText #d3dcee, footerLink #ffffff, footerRule #1f2d4d, wordmark #ffffff`. `DARK`: `page #070b14, card #101a2e, border #1f2d4d, heading #f8fafc, body #e6ecf6, muted #c5cfe2, kicker #a8c8ff, link #a8c8ff, button #8ab6ff, buttonText #04112b, quote #182545, quoteRule #8ab6ff, rule #1f2d4d, header #101a2e, logoAlt #a8c8ff, imageBg #182545, imageAlt #c5cfe2`. `FONT_SERIF` removed. `PAIRS` covers heading, body, muted, kicker, link, button, logo alt on header, image alt on image slot, link on quote, in light and dark, plus footer text, footer link and wordmark (all at 4.5; checked 2026-11-07: lowest is 8.37). `DECORATIVE` lists border, rules, the green/blue bar, quote rules and page colours.
  - `mail-templates.js`: `export function resolveSite(site): { origin, assetOrigin, logoUrl }` (origin: https as today, or loopback http per the Global Constraints, else `https://mayobebros.com`; `assetOrigin`: `site.assetOrigin` if https, else `origin` if https, else `https://mayobebros.com`; `logoUrl`: must pass `ownImage` on `assetOrigin`, else `${assetOrigin}/assets/email/logo.png`). `export function ownImage(u, assetOrigin): string` (`''` unless https, same origin, path `^/assets/email/[a-z0-9-]+\.(jpg|png)$`, query empty or `v=[0-9a-f]{8}`, no user/password, at most 500 characters). `ownUrl` compares against `resolveSite().origin`, so loopback links work only for a loopback site.
  - Shell: white header row with the linked wordmark `<img width="212" height="48" alt="Mayobe Bros">` (styled alt: bold 20 px `logoAlt`), under it a 4 px bar of two equal cells `barGreen`/`barBlue`; card `card` with a 1 px `border` and 14 px radius; footer `#060a14` with a bold sans "Mayobe Bros", the slogan, the why line and white underlined links. `kicker(text)` replaces `eyebrow` (13 px, bold, uppercase typed in capitals, letter-spacing 1.5 px, `kicker`); `h1` sans 28 px / 1.25, weight 800, letter-spacing -0.3 px (24 px under 620 px); button `button`/`buttonText`, `border-radius:24px`, still 14 + 20 + 14 px with matching `mso-padding-alt`; quote block `quote` with a 4 px `quoteRule` left border. The dark block overrides every new class.
  - `util.js`: `siteOf(env)` -> `{ origin, assetOrigin, logoUrl }` with `assetOrigin` = `siteOrigin(env)` when https, else `https://mayobebros.com`, and `logoUrl = ${assetOrigin}/assets/email/logo.png`.

- [ ] **Step 1: Write failing tests** in `email-templates.test.mjs`. Extend `lint()`: every `<img>` rule from the Global Constraints (src via `ownImage`, extension, `display:block`, `border:0`, `height:auto`, `max-width` when width > 200); forbidden adds `position:`, `filter:`, `<video`, `<iframe`, `georgia`, `times new roman` (not `serif`: the sans stack ends in `sans-serif`); at most one `<img>` (the logo) for every builder except `welcomeEmail` (at most 4) and `newPostEmail` (at most 2). New tests: `'email tokens follow css/style.css'` (parse `:root` and `:root.dark` in `css/style.css`: light `--btn-bg`=button, `--link`=link, `--text`=heading, `--text-2`=body, `--text-3`=muted, `--line-soft`=border, `--bg-alt`=page, `--surface-2`=imageBg; dark `--btn-bg`, `--btn-text`=buttonText, `--link`, `--surface`=card, `--bg`=page, `--text`, `--text-2`, `--text-3`); `'resolveSite: https origins pass; http only for 127.0.0.1 or localhost with an optional port; pictures and logo always https'` (reject `http://mayobebros.com`, `http://127.0.0.1.evil.example:8000`, `http://localhost.evil.example`, `http://127.0.0.2:8000`, `http://[::1]:8000`, `http://0.0.0.0:8000`, `http://127.0.0.1:8000/path`; accept `http://127.0.0.1:8000` and `http://localhost`; with a loopback origin, `assetOrigin` and `logoUrl` start `https://mayobebros.com/`); `'a loopback site gets loopback links; a production site never emits an http link'` (confirm email with site `http://127.0.0.1:8000` and confirmUrl `http://127.0.0.1:8000/newsletter/#c=x` keeps it; the same URL with the production site falls back); `'the header shows the wordmark logo with styled alt text and a link home; no serif font anywhere'`; `'the confirm email says the button opens a page with one more button and offers the copy-the-link fallback'` (html and text contain "The button opens a page on our website. Press Confirm my subscription there to finish." and "If the page does not open, copy the link below into your browser. If it still does not work, reply to this email and tell us."). Update existing: role list `gold` -> `kicker` plus `logo alt` and `image alt`; `LIGHT.page === '#f3f6fb'`, `DARK.card === '#101a2e'`; the missing-site test expects `https://mayobebros.com/assets/email/logo.png`.
- [ ] **Step 2: Run** `node --no-warnings --test scripts/tests/email-templates.test.mjs` - expect FAIL.
- [ ] **Step 3: Implement** tokens, `resolveSite`, `ownImage`, shell, components and the confirm copy; `util.js` `siteOf`. Template subjects and preheaders stay as they are.
- [ ] **Step 4: Run** the file, `newsletter.test.mjs`, `worker.test.mjs`, `mail.test.mjs` and the full suite - expect PASS (only assertions on the old logo path or old copy may need updating; say which in the report). Run `node scripts/tools/email-preview.mjs --widths 360,600` and read `confirm-subscription-360-light.png` and `-600-dark.png`.
- [ ] **Step 5: Commit.**

---

### Task 3: Article pictures in the welcome and new-article emails

**Files:** Modify `worker/src/mail-templates.js` (`welcomeEmail`, `newPostEmail`), `worker/src/newsletter.js` (`latestPosts`, `postMail`), `scripts/tests/email-templates.test.mjs`, `scripts/tests/newsletter.test.mjs` (fixture entries gain `m`, `w`, `a`; the share-card assertions at about lines 508-510 are replaced).

**Interfaces:**
- Consumes: `search.json` fields `m`, `w`, `a` (Task 1); `resolveSite`, `ownImage`, components (Task 2); `siteOf(env).assetOrigin`.
- Produces:
  - `newsletter.js`: `const HASH_RE = /^[0-9a-f]{8}$/` and `function emailPost(env, p): { title, url, excerpt, category, image, thumb, imageAlt, video }` used by both `latestPosts` and `postMail`: `image = ${asset}/assets/email/post-${s}.jpg?v=${m}` and `thumb = .../thumb-${s}.jpg?v=${m}` only when `m` matches; `video = { image: .../video-${s}.jpg?v=${w}, url: ${origin}${u}#video-1 }` only when `w` matches; `imageAlt` = `a` (string, one line, cut to 150) or the title. `s` and `u` are already validated by the existing filters.
  - `newPostEmail({ post: { title, url, excerpt?, category?, image?, imageAlt?, video?: { image, url } }, unsubscribeUrl }, site)`: a full-bleed hero row above the card body (`width="600" height="338"`, linked to `post.url`, slot background `imageBg`); with `video` the hero is `video.image`, linked to `video.url`, alt `Watch the video: <title>`, and a text link "Watch the video" under the excerpt (also in the text part as `Watch the video: <url>`). No `image` and no `video`: no hero, nothing else changes.
  - `welcomeEmail({ unsubscribeUrl, latestPosts: [{ title, url, excerpt?, category?, image?, thumb?, imageAlt?, video? }] }, site)`: kicker "Latest articles", then the first post as a lead card (picture `width="520" height="293"` or the video picture, kicker-style category line, `<h2>` title link, excerpt), then up to two rows (`thumb` 112 x 84 left, category, `<h3>` title link right; the category line ends in " · Video" when the post has a video). Titles stay links in live text; each picture links to the same URL as its title.

- [ ] **Step 1: Write failing tests.** `email-templates.test.mjs` (LONG/SHORT data gain `image`, `thumb`, `video` with real `/assets/email/` URLs): `'with every <img> removed, the heading, every post title, the button label and every link stay in the html'`; `'every linked picture has the same href as a text link in the same email'`; `'pictures are dropped unless ownImage accepts them'` (each of `http://mayobebros.com/assets/email/post-a.jpg`, `https://evil.example/assets/email/post-a.jpg`, `https://mayobebros.com/assets/email/post-a.webp`, `.svg`, `.gif`, `data:image/jpeg;base64,AA`, `//evil.example/x.jpg`, `https://mayobebros.com/assets/share/post-a.jpg`, `...post-a.jpg?v=1234567g`, `...post-a.jpg?t=abc`: no `<img>` beyond the logo); `'a video post shows one hero, the video picture, links it to #video-1 and says Watch the video in html and text'`; `'welcome shows one lead picture and at most two thumbnails, in the order given'`. `newsletter.test.mjs`: `'new-post email shows the assets/email picture with the post alt text, never the share card'` (`src="https://mayobebros.com/assets/email/post-fresh-post.jpg?v=<m>"`, `alt` = fixture `a` escaped, no `/assets/share/`); `'malformed m or w (a path, upper case, 9 characters, a number) gives no picture; a hostile a is escaped and cut to 150 characters'`; `'welcome uses lead picture and thumbnails from search.json, newest first'`; `'picture addresses are identical for two subscribers and contain no token'`; `'with SITE_ORIGIN http://127.0.0.1:8000, links use it and pictures stay on https://mayobebros.com'`; `'image fields cost no subrequest: with subrequestLimit 20 the same number of emails go out with and without m, w and a'`.
- [ ] **Step 2: Run** both files - expect FAIL.
- [ ] **Step 3: Implement** `emailPost`, the two builders and their text parts. `publishedPosts`, `sendRun` and the seed and age guards are not edited (the diff of those functions must be empty).
- [ ] **Step 4: Run** both files and the full suite - expect PASS; `email-preview` shows `welcome` and `new-post` under 40,000 bytes.
- [ ] **Step 5: Commit.**

---

### Task 4: Local real-mail mode and honest test sends

**Files:** Modify `scripts/dev-api.mjs`, `scripts/mail-test.mjs`, `worker/.dev.vars.example` (comment only); create `scripts/tests/dev-api.test.mjs`.

**Interfaces:**
- Consumes: loopback support in `resolveSite` (Task 2); pictures (Task 3).
- Produces:
  - `DEV_MAIL_REAL=1 DEV_MAIL_ALLOW=a@x.y[,b@x.y] node --no-warnings scripts/dev-api.mjs [port] [site-origin]`: `SITE_ORIGIN` = the first site origin (default `http://127.0.0.1:8000`, so emailed buttons open the local site and `search.json` is read from it), `API_ORIGIN = http://127.0.0.1:<port>`, `NEWSLETTER_SEND = 'true'`; `RESEND_API_KEY` read from the `RESEND_API_KEY=` line of `DEV_VARS_FILE` (default `worker/.dev.vars`). The Resend call is forwarded to `DEV_RESEND_URL` (default `https://api.resend.com/emails`; only that URL or `^http://127\.0\.0\.1:\d+/` is accepted) with `Idempotency-Key` rewritten to `dev-<base36 start time>-<original key>` (cut to 256), because the in-memory database restarts its ids and Resend answers 409 `invalid_idempotent_request` to a reused key with another body. A recipient not in `DEV_MAIL_ALLOW` is printed as `[mail] not sent (not in DEV_MAIL_ALLOW)` and answered with a fake 200. Every message still prints its `[mail]` block (to, subject, headers, text), never `Authorization`. Refuses to start (exit 1, a plain message) without `DEV_MAIL_ALLOW` or without a key line, or with `DEV_MAIL_LOG=1` set too. Startup line: `REAL MAIL ON: only to <list>. Links open <site>. Do not use your mail app's own Unsubscribe button (it cannot reach this computer).` `DEV_MAIL_LOG=1` behaves exactly as today.
  - `mail-test.mjs`: sample article, image and video data from `data/search.json` (newest post, and the post with `w` for a new template name `new-post-video`), so every article link is a real path; `logoUrl` from the new default; `--dry` prints subject and text without a key and sends nothing; templates whose links lead to `/manage/` or `/newsletter/` (`manage-link`, `reply-notice`, `confirm-subscription`, `welcome`, `new-post`, `new-post-video`, `farewell`) refuse without `--pages-live`, checked before the key (exit 1: "This email links to /newsletter/ or /manage/, which are not on the live site until they are pushed. Use --pages-live once they are, or try the flow locally with DEV_MAIL_REAL=1 (worker/README.md).").
  - `.dev.vars.example`: the RESEND line says the key is used locally only by `DEV_MAIL_REAL=1`, which sends only to `DEV_MAIL_ALLOW` and makes its own idempotency keys.

- [ ] **Step 1: Write failing tests** in `dev-api.test.mjs` (spawn `dev-api.mjs` on port 0-picked free ports with a vars file under `$HOME/.cache/mb-dev-api-test/`, a fake Resend `http.Server`, and a tiny static server for `search.json`): `'DEV_MAIL_REAL without DEV_MAIL_ALLOW exits 1 and forwards nothing'`; `'DEV_MAIL_REAL without a key line exits 1 and the message does not contain the file contents'`; `'an allowed sign-up is forwarded once with the key, a dev- Idempotency-Key and links to the local site'` (the static server is passed as the site-origin argument; POST subscribe with that `Origin` and `elapsed: 3000`; the fake Resend sees `Authorization: Bearer re_test_123`, `Idempotency-Key` matching `^dev-[0-9a-z]+-nl-confirm-1-`, html with `<site origin>/newsletter/#c=`, logo on `https://mayobebros.com/assets/email/logo.png`); `'an address not in DEV_MAIL_ALLOW is printed but not forwarded'`; `'the key never appears in stdout or stderr'`; `'two runs give subscriber 1 different Idempotency-Keys'`; `'DEV_MAIL_LOG=1 still fakes the send and forwards nothing'`. mail-test (via `execFile`, no key): `'mail-test refuses /newsletter/ and /manage/ templates without --pages-live'`; `'mail-test --dry new-post links an article path that is in search.json'`.
- [ ] **Step 2: Run** `node --no-warnings --test scripts/tests/dev-api.test.mjs` - expect FAIL.
- [ ] **Step 3: Implement** (all real-mail logic stays in `dev-api.mjs`; `worker/src/mail.js` is not changed).
- [ ] **Step 4: Run** the file and the full suite - expect PASS. Do not run real-mail mode. **Step 5: Commit.**

---

### Task 5: Every click gets an answer on `/newsletter/` and `/manage/`

**Files:** Modify `js/newsletter.js`, `js/manage.js`, `content/pages/newsletter.html`, `content/pages/manage.html`, `scripts/lib/render.mjs` (`staticPage`: `{{latest-posts:N}}`), `css/style.css`, `scripts/tests/newsletter-page.test.mjs`, `scripts/tests/manage.test.mjs`, `scripts/tests/pages.test.mjs`.

**Interfaces:**
- Consumes: the existing confirm/unsubscribe/manage API answers (200, 404, 429, network error); `card(p, i, 'horizontal', 'h3')` in `render.mjs`.
- Produces: `{{latest-posts:N}}` (N 1 to 6) renders `<section class="next-reads" data-next hidden aria-labelledby="next-reads-h"><h2 id="next-reads-h">Read our latest articles</h2>` + N horizontal cards of the newest posts + a "See all articles" link; build error for any other N. Both pages place it inside their card. Fetch timeout 15,000 ms (`AbortController`); while waiting the button is disabled with `aria-busy="true"` and reads "Confirming..." / "Unsubscribing..." (unique keyframes `nl-wait` if animated). States and copy (`/newsletter/`):
  - `#c=` on load: heading "One last step: confirm your subscription"; text "You opened the link from our email. Press the button to finish. We ask for this press so that email scanners cannot sign anyone up."; button "Confirm my subscription".
  - Confirm 200: "You are subscribed"; "Thank you. We will send you one email when we publish a new article, and every email has a link to stop. A welcome email with our latest articles is on its way."; next reads shown, focus on the heading.
  - Confirm 404: "This link was already used or has expired"; "If you already pressed Confirm, you are subscribed and there is nothing more to do. If not, the link may be older than 7 days: sign up again with the form at the bottom of this page."; next reads shown.
  - Network error or timeout: status "We could not reach our server. Check your connection, then press Try again." with the button "Try again" (one more POST per press); 429 keeps today's text.
  - Unsubscribe 200: "You are unsubscribed" with today's text; next reads shown. No fragment and malformed fragment: today's texts, next reads shown.
  - `/manage/`: the same timeout, busy state and network text ("We could not reach the comments service. Check your connection, then press Try again."); next reads shown after "Reply emails stopped", after a 404 and on the no-link screen.

- [ ] **Step 1: Write failing tests.** `newsletter-page.test.mjs`: `'the confirm screen says it is the last step and that the press stops email scanners'`; `'next reads are hidden on load and shown after success, after 404 and on the no-fragment screen'`; `'the 404 text tells someone who already confirmed that they are subscribed'`; `'a request with no answer for 15 s shows the network text and Try again; one press makes exactly one more POST'` (stub `AbortController`/timers); `'while waiting the button is disabled and aria-busy'`. `manage.test.mjs`: `'a timeout shows the network text and Try again'`; `'next reads appear after reply emails are stopped'`. `pages.test.mjs`: `'{{latest-posts:3}} renders the 3 newest posts as horizontal cards with real links on /manage/ and, with the newsletter on, on /newsletter/'` and `'{{latest-posts:9}} is a build error'`.
- [ ] **Step 2: Run** the three files - expect FAIL.
- [ ] **Step 3: Implement.** CSS for `.next-reads` reuses `.card-h`; status colours meet 4.5:1 in light and dark.
- [ ] **Step 4: Run** the files and the full suite - expect PASS. Browser check: `node scripts/build.mjs --api http://127.0.0.1:8787 --newsletter`, `DEV_MAIL_LOG=1 node --no-warnings scripts/dev-api.mjs`, `node scripts/serve.mjs`; sign up, open the printed `#c=` link, confirm, open it again (404 state), stop the dev API and press a button (network state); screenshots at 360 and 1280, light and dark, in `$HOME/.cache/mayobe-shots/`, read them. Rebuild without `--api`/`--newsletter`. **Step 5: Commit** (sources, tests, regenerated pages).

---

### Task 6: Visual verification of every email

**Files:** Modify `scripts/tools/email-preview.mjs` (no test file: this task is the check).

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: default widths `360,600`; `--no-images` also renders `<name>-<w>-<light|dark>-noimg.png` with every picture source pointed at a missing file (Chromium then shows the alt text in the sized slot, as a blocked client does); samples use real data from `data/search.json` and `assets/email/` (newest post; the video post for `new-post-video`; a welcome with three posts; a post without `m` for `new-post-no-image`); each line prints HTML bytes and picture bytes (sum of the local files it references) and exits 1 when a welcome is over 170 KB or a new-article email over 130 KB of pictures.

- [ ] **Step 1: Extend the script** and run `node scripts/tools/email-preview.mjs --no-images`. Expected: all contrast pairs pass, no `OVERFLOW`, no budget failure, every template under 40,000 bytes.
- [ ] **Step 2: Read every PNG** of `confirm-subscription`, `welcome`, `new-post`, `new-post-video`, `new-post-no-image`, `farewell`, `manage-link`, `reply-notice`, `owner-held`, `contact-owner` at 360 and 600, light and dark, with and without images. Each must show: the colour wordmark (on its white plate in dark), the green/blue bar, blue kicker, bold sans heading, blue pill button (light blue with dark text in dark mode), white card with a thin border on `#f3f6fb`, dark footer with white links; pictures not cropped badly (else set `imageFocus` in the post and rebuild); no-image renders still read fully with tinted slots and alt text; 360 px has no clipped text and thumbnails sit left of the titles. Fix what fails in the owning task's files and repeat.
- [ ] **Step 3: Commit** the script with a one-line summary of what was checked.

---

### Task 7: Policies, docs and the go-live order

**Files:** `content/pages/privacy-policy.html` (inside `{{#newsletter}}`), `content/pages/newsletter.html` ("What we send"), `worker/README.md`, `CLAUDE.md` (Email section), `docs/image-sources.md`, `scripts/tests/pages.test.mjs`.

- [ ] **Step 1: Failing check** in `pages.test.mjs` (render-level, newsletter on): the privacy page contains "pictures" and "GitHub Pages" in the newsletter section and the sentence "We do not count who opens our emails or clicks their links."; the newsletter page lists "a picture" in what the article email contains; with the newsletter off neither text appears. Run - expect FAIL.
- [ ] **Step 2: Write the pages.** Privacy, newsletter section: "Our emails show pictures from our own website. Your email app, or your email provider for you (Gmail and Apple Mail fetch pictures through their own servers), downloads them from our host, GitHub Pages, like any page of our site. The picture addresses are the same for every reader. We do not count who opens our emails or clicks their links." Newsletter page: "one email when we publish a new article, with its title, a picture, a short summary and a link". Run - expect PASS; rebuild.
- [ ] **Step 3: Docs.** `worker/README.md`: (a) a "Try the newsletter with real mail on your computer" section for `DEV_MAIL_REAL` (commands as in the final check below, the allowlist, the key file, that links open `http://127.0.0.1:8000` so the email must be opened on the same computer, that pictures load from the live site and show as boxes until `assets/email/` is pushed, not to use the mail app's own Unsubscribe button); (b) fix the order: step 7 sends only `owner-*`, `contact-owner` and `contact-visitor`; a new step after 9 sends `manage-link` and `reply-notice` with `--pages-live`; step 11 says "Do steps 12 and 13 in the same sitting. Until step 13 is live, do not sign up by hand or send newsletter test emails: their links lead to /newsletter/, which is not on the live site yet."; step 14 uses `mail-test.mjs ... --pages-live` for the five newsletter templates; note that the first push from this branch also publishes `assets/email/`. `CLAUDE.md` Email section: email design follows the site (tokens tested against `css/style.css`), pictures come from `assets/email/` made by the build, which emails have pictures, `--pages-live`, real-mail mode. `docs/image-sources.md`: email pictures are crops of the covers already listed there, the logo plate is from `assets/img/logo.png`.
- [ ] **Step 4: Full verification:** `node scripts/build.mjs`, `node scripts/build.mjs --check`, `node --no-warnings --test scripts/tests/*.test.mjs`. Report what ran and what did not. **Step 5: Commit.**

---

## Final check (controller with the owner; not for an implementer subagent)

Real mail, about six emails from the Resend account (free plan 100 a day). The owner runs or approves each step.

1. All tasks committed and the suite green. `node scripts/build.mjs --api http://127.0.0.1:8787 --newsletter`, then `node scripts/serve.mjs` (port 8000).
2. Owner starts `DEV_MAIL_REAL=1 DEV_MAIL_ALLOW=<owner's address> node --no-warnings scripts/dev-api.mjs` and reads the REAL MAIL ON line.
3. On the same computer, open `http://127.0.0.1:8000/`, subscribe with that address in the footer: "Almost done..." appears.
4. In the mail app on this computer (light, then dark if available, and on the phone just to look): the confirmation looks like the site; press the button: the local page says "One last step"; press Confirm: "You are subscribed" with three latest articles.
5. The welcome email: lead card and thumbnails. Until the owner chooses to push `assets/email/`, pictures show as tinted boxes with their descriptions (that is the images-blocked check). After a push, the same email shows the pictures.
6. Open the confirm link again: "This link was already used or has expired" with the "If you already pressed Confirm..." sentence and the latest articles.
7. Press Unsubscribe in the welcome's footer link: the local page, then "You are unsubscribed", then the goodbye email.
8. New-article look (after `assets/email/` is live): `node scripts/mail-test.mjs new-post <address> --yes --pages-live` and `new-post-video` (key via `read -rs RESEND_API_KEY; export RESEND_API_KEY`, then `unset RESEND_API_KEY`).
9. Stop both servers, rebuild without `--api`/`--newsletter`, check `git status` shows no generated change, and write down what the owner saw.

## Open decisions

1. Email pictures for all posts (about 130 x up to 120 KB in git, a few minutes once) rather than only recent posts: chosen for no stale-image cases.
2. `m`/`w`/`a` in `search.json` (about 10 KB more for the search page, zero Worker subrequests) rather than a separate `data/email.json` (one more subrequest per run): chosen.
3. Alt text of a linked picture is the literal `imageAlt` (the title link next to it names the destination); video pictures use "Watch the video: <title>".
4. Whether to push `assets/email/` before the owner's real-mail check, so pictures show (owner's call).
5. Go-live: reordered README plus the `--pages-live` guard, rather than a third `newsletterAction: "page"` state that would remove the short window between Worker deploy and page push.
6. Card colour stays `#fffffe` (inherited from the current tokens) rather than the site's `#ffffff`.
7. A video post's new-article email shows only the video picture, not the cover as well (one picture, lighter).

## Sources (checked 2026-11-07)

- caniemail: WebP https://www.caniemail.com/features/image-webp/ (Gmail converts to JPG), AVIF https://www.caniemail.com/features/image-avif/ (about 66%, tested 2023), `<video>` https://www.caniemail.com/features/html-video/ (about 24%, Gmail replaces the tags), `prefers-color-scheme` https://www.caniemail.com/features/css-at-media-prefers-color-scheme/ (about 42%, tested 2023).
- Litmus: retina images https://www.litmus.com/blog/understanding-retina-images-in-html-email/ ; image blocking https://www.litmus.com/blog/the-ultimate-guide-to-email-image-blocking (Outlook desktop off by default; live text, styled alt).
- Gmail clipping at about 102 KB of HTML (not published by Google): https://www.emailonacid.com/blog/article/email-development/gmail-email-clipping/ ; Gmail image proxy: https://www.suped.com/learn/email-deliverability/why-are-images-not-showing-in-gmail-webmail-but-are-showing-in-the-gmail-mobile-app
- Apple Mail Privacy Protection (remote content through relays): https://www.apple.com/legal/privacy/data/en/mail-privacy-protection/
- Dark mode (Gmail iOS full inversion, transparent logos can vanish): https://www.mailmodo.com/guides/dark-mode-email/ , https://help.brevo.com/hc/en-us/articles/15417444091538
- Resend idempotency (24 hours, 409 `invalid_idempotent_request`, 256 characters): https://resend.com/docs/dashboard/emails/idempotency-keys ; tracking off by default, pixel for opens: https://resend.com/docs/dashboard/domains/tracking
- Patterns: Cerberus (MIT) https://github.com/TedGoas/Cerberus ; Postmark templates (MIT) https://github.com/ActiveCampaign/postmark-templates and guide https://postmarkapp.com/guides/transactional-email-best-practices ; react-email (MIT) https://github.com/resend/react-email ; single column https://www.omnisend.com/blog/email-newsletter-design ; Really Good Emails newsletter examples https://reallygoodemails.com/school/newsletter-examples
