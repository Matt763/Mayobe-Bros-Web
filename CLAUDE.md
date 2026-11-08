# Mayobe Bros: static site (instructions for Claude)

Plain HTML/CSS/JS site for https://mayobebros.com, hosted free on GitHub Pages. Posts are Markdown files. A
dependency-free Node script (`scripts/build.mjs`) turns them into the HTML pages that get committed and served.
Comments and reactions use a small Cloudflare Worker (`worker/`). There is no other backend.

Node may not be on PATH. If `node` is missing: `export PATH=$HOME/tools/node/bin:$PATH`.

## Publishing a post (the main job)

Read `docs/writing-guide.md` first. It is short and it is the quality bar: simple English, nothing invented,
facts verified against official sources, honest about what could not be confirmed. The site applies to Google
AdSense, so thin, copied, scaled or misleading content can get the whole site rejected.

1. Pick the topic. Do not repeat an existing post (check `content/posts/`). Research it with WebSearch/WebFetch and open every source you cite.
2. Write `content/posts/<slug>.md` (the slug is lowercase words and hyphens, and becomes the URL) with the front matter below, then the body: 1,200 to 2,200 words, `##` sections, short paragraphs, a "Common questions" section, "What to do next", and "Sources and further reading" with real links.
3. Save any image in `assets/posts/` (WebP, about 1400 px wide, under 250 KB), look at it, and write a literal `imageAlt`.
4. Run `node scripts/build.mjs`. Errors stop the build and say what to fix. Warnings (reading level, AI-sounding phrases, missing sources or alt text, income promises, process notes) must be fixed too, unless you can justify one. The build also draws the post's **link-preview picture** (`assets/share/post-<slug>.jpg`, see "Link previews" below): look at it with the Read tool, and if the subject is cut off add `imageFocus:` to the front matter and rebuild.
5. Check the page: `node scripts/serve.mjs` and open http://127.0.0.1:8000/.
6. **Only when the user asks to publish:** `git add -A && git commit -m "Publish: <title>" && git push`. It goes live within a minute or two. Never push without being asked.

```
---
title: Clear, specific title (under 70 characters)
date: YYYY-MM-DD
updated: YYYY-MM-DD        # only when you change a published post in a meaningful way
author: Mclean Mbaga       # must match an author in site.config.json
category: educational      # required; see content/categories.json
label: study-tips          # optional; must belong to that category
excerpt: 120-160 characters saying what the reader will learn. No hype.
image: assets/posts/<file>.webp
imageAlt: Literal description of the picture
imageFocus: 40             # optional, 0 to 100: how far down the cover the link-preview picture looks (0 top, 100 bottom)
emailImage: assets/img/topics/<file>.webp   # only when the cover cannot be used in email (e.g. it shows real logos); emailImageAlt: describes it
tags: [three, to, five]
featured: false            # true = "Editor's picks" and first on /popular/
aliases: [old-slug]        # only after renaming a post, so the old URL still works
draft: false               # true = not published
---
```

All categories and labels are shown, even before they have a post (`"showEmptyTopics": true` in `site.config.json`). An empty one sits under
"More" in the menu (or inline on very wide screens), its page says there are no articles yet and lists the latest posts, and it is `noindex` and
left out of the sitemap until its first post (then nothing needs changing). Label pages with fewer than 3 posts are also `noindex` and not in the
sitemap (thin pages). **Before applying to AdSense set `"showEmptyTopics": false`, rebuild and push**: Google's AdSense checks flag unfinished
or "coming soon" pages, and it is one line to turn them back on later.
To add a category or label, edit `content/categories.json`.
To unpublish a post, delete the file or set `draft: true`, then rebuild.

## Videos in a post
Every video on the site is played by Plyr (files in `vendor/plyr/`, loaded only on pages that have a video). Put one line on its
own in the post body:

```
::video[Caption that says what the video shows](assets/video/clip.mp4){poster=assets/posts/clip.webp captions=assets/video/clip.vtt}
::youtube[Caption](https://youtu.be/VIDEOID){poster=assets/posts/clip.webp}
```

Own videos: save them in `assets/video/` (MP4 H.264 or WebM, keep them small; the site is on free hosting) and give captions
(`.vtt`) when people speak. YouTube: the page shows only the poster and a play button; nothing is requested from YouTube until the reader
presses play, and then it uses `youtube-nocookie.com`. Never paste a raw YouTube `<iframe>` (it would load Google code on page load and
break the Cookie Policy). Once a video has been started and the reader scrolls past it, it keeps playing in a small corner window (the mini player, `miniPlayer()` in `js/site.js`, `.video-figure.is-mini` in `css/style.css`) with buttons to move it (drag, or arrow keys; double-click resets), make it smaller or larger, jump back to it and close it (which pauses it), plus a drag corner for the size. It also takes **touch and mouse gestures on the window itself** (one engine on the window, `js/site.js`, search "Gestures on the window itself"): drag from the picture, a quick flick glides to the nearest corner, two-finger pinch resizes (the picture stays under the fingers), double-tap switches small/large (no fullscreen), and a lone tap shows the controls without pausing (the play button does that). Every gesture has a one-tap button alternative (WCAG 2.5.1, 2.5.7): a size toggle (pinch, double-tap) and a "next corner" button (drag); on touch devices the buttons are 44 px, rest out of sight while playing, the +/- buttons, the move button and the resize corner are replaced by those two, and a tap on the picture brings them back. It works for YouTube too (Plyr's poster layer sits above the iframe, so touches reach the window). **Leaving the browser:** own video files get a "Pop out" button (native Picture-in-Picture, which keeps playing outside the browser); Media Session metadata is set on play and Chrome/Edge desktop pop out automatically when the tab is hidden (only for sites the reader allows); Safari and Firefox cannot be asked to, and iPhone does it from native fullscreen then Home. A YouTube embed cannot be popped out by a page, and YouTube's API policy forbids background-player tricks, so do not add any. Position and size are saved under `mayobebros-mini-player` the position and size are remembered in local storage under `mayobebros-mini-player` (listed in the Cookie Policy, keep both in step); this works for own files and YouTube alike and needs nothing per post. Videos need a useful caption, must be ours or properly licensed, and must not carry the article on their own:
the text must still stand without them.

## Listen to this article
Every post gets a Listen button next to the share buttons (`js/listen.js`). It reads the title, then every paragraph, heading and list
item, and stops before "Sources and further reading" (so keep that exact heading text for the sources list). It uses the reader's own
browser voices, highlights the sentence being read, auto-scrolls, and skips pictures, tables, code and videos. Nothing to do per post.
Write numbers and units the way people say them (`TSh 600`, `10 km`, `15%` are read correctly; unusual abbreviations are not).

## Pages and pagination
Every listing (all posts, popular, each category and label, each author) shows 15 posts per page (`postsPerPage` in `site.config.json`).
When there are more, a pagination bar appears under the grid with Newer, Older and page numbers (`/post/page/2/`, `/popular/page/2/`,
`/category/<slug>/page/2/`, `/author/<slug>/page/2/`). These pages are built automatically; nothing to do when you publish. Clicking a page number swaps only the cards and the number bar (`js/pager.js`, no page reload). On category and label pages, the label buttons, the menu and the category tiles also switch in place: the words and cards fade out, the hero picture cross-fades, the new content rises in. Without JavaScript all of these are normal links. The search page
shows 15 results at a time with a "Show more results" button.

**How a page change moves** (one shared module, `js/motion.js`, `window.MBMotion`, loaded first on every page; it also drives the 404 "Posts you may be interested in" pager, search "Show more results", home "Show more posts" and "Show more comments"):
- The old cards fade out (0.16 s). On a slow connection they stay, dimmed to half, while the pressed page number pulses; the grid is never blank.
- The page glides to the top of the list with its own eased scroll (`MBMotion.glide`, easeInOutCubic, 0.26 to 0.52 s, landing 16 px under the real bottom of the sticky header). At most 0.8 of a screen is shown moving: the farther part of a long trip is one jump while the cards are hidden. Any wheel, touch, pointer press or key stops the glide where it is. After a long frame (new cards being laid out, a slow phone) the glide goes on from where it was instead of leaping ahead (`MAX_STEP`, 34 ms of motion per frame), and it always ends within twice its duration. "Show more" only glides when the first new item starts in the lower 40% of the screen.
- The new cards rise in one after another (35 ms apart, the 7th and later together), and focus moves to the first new article (or result, or comment) without scrolling; the focus ring shows only after keyboard use. The page change is announced once (the page bar's `.pagination-note`, on the 404 its `[data-nf-pager-status]`).
- Back/Forward do not bounce: `js/pager.js` sets `history.scrollRestoration` to `manual` while it owns the history entries and back to `auto` on `pagehide`, so Back from an article still lands where the reader was. With reduced motion everything is instant (one jump, same focus and announcement).
- Values: `LEAVE_MS` (fade), `GAP` (landing gap), `STAGGER_CAP` and `MAX_STEP` are constants at the top of `js/motion.js`, the duration in `glideDuration()` and the 0.8 screen cap in `planGlide()` right below; the `mo-wait`, `mo-leave`, `mo-enter` keyframes are the "Motion for in-place page changes" block near the end of `css/style.css` (change both together). No storage, cookies or network: the Cookie Policy is not affected.
- Never use native smooth scrolling for these flows (`scrollIntoView({ behavior: 'smooth' })`, `scrollTo({ behavior })`, or `focus()` without `{ preventScroll: true }`): `html { scroll-behavior: smooth }` makes them race across a long page. Use `MBMotion.glide`. No same-document View Transitions here either: they freeze the page while it updates and cannot carry a scroll. `scripts/tests/motion.test.mjs` guards all of this.

Each post ends with a Previous / Next pair of picture cards (older and newer
article, with a thumbnail from their `image:`); the newest and oldest posts get an "All articles" card instead of a blank gap.

## The 404 page
Built by `notFound()` in `scripts/lib/render.mjs`. No hero: the old site's layout (big 404, round search badge, "Page not found", short text, countdown card, "Go to homepage" and "Go back") inside the normal header and footer. It is noindex, ad-free (`adKind: 'notfound'`), and every address is root-absolute, because GitHub Pages serves it at any missing path. There is no search box and no category links: under the buttons, "Posts you may be interested in" shows real posts. The page ships with the 9 newest as plain cards plus a "More articles" link to `/post/` (that is the no-JavaScript view). `js/notfound-posts.js` then loads `/data/search.json`, shuffles all posts once per page load (Fisher-Yates) and shows 9 at a time with the same `nav.pagination` bar as the listings, swapped in place with no reload and no change to the address; it announces "Page N of M" and keeps focus on the current page number. If the index cannot be loaded the 9 built-in posts stay.
`js/notfound.js` runs a 10 s countdown with a Stop button (no redirect with reduced motion, a query or fragment, reload, back/forward or a hidden tab; any key, pointer press, real pointer move (12 px or more), wheel, scroll, touch or focus, including a click on the pager, stops it for good). A Tab press is a key press, so it stops the countdown and announces "Automatic redirect stopped." in the status line; focus then goes to the next control as usual, so a keyboard user is never left waiting. On `/newsletter/` and `/manage/` it takes the link code out of the address and shows an email-link notice instead of a countdown. When a new page that email links open is added, add it to `FLOW` in `js/notfound.js`.

## Link previews (WhatsApp, Facebook, X, LinkedIn, Telegram, Slack, iMessage)
What an app shows when someone shares a link comes only from the `og:*` / `twitter:*` tags in `<head>` and the picture they point at. Every post
(also every category, every label and the home page) gets its own **1200 x 630 baseline JPEG under 190 KB** in `assets/share/`, drawn from the cover
by `scripts/tools/share-card.html` in headless Chromium and encoded by ffmpeg (`scripts/lib/share.mjs`, run by every `node scripts/build.mjs`; about a
second per new card, nothing for unchanged ones; hashes are kept in `.share-cards.json`). Do not point `og:image` at the WebP cover: WhatsApp,
Facebook and LinkedIn may not show WebP, and the covers come in different shapes that apps crop differently.
- The card has the cover, a navy shade, a category chip, the logo and the domain. The title is not on it: every app prints the title, description and domain under the picture.
- What WhatsApp prints under the picture (from its developer guide, checked 2026-11-04): `og:title` in bold on at most 2 lines and "without any branding" (so `og:title` is the plain title, never "Title | Mayobe Bros"); `og:description` on 1 to 2 lines, "80 characters will suffice" (about 90 fit on a phone; the rest is cut), so put the key point of the `excerpt:` first; the domain. Picture: absolute URL, under 600 KB, at least 300 px wide, no more than 4:1; the `<head>` tags must be inside the first 300 KB of the page. Our cards stay under 190 KB because older reports of WhatsApp skipping pictures above about 300 KB exist.
- If a post's subject is cut off (a face at the top, a product at the bottom), set `imageFocus:` in its front matter and rebuild; that is the only per-post control.
- Cards are regenerated when the cover, the category name, `imageFocus`, the template, the logo or the host changes. To redraw everything after a design change, delete `.share-cards.json` and rebuild.
- If Chromium or ffmpeg is missing the build only warns and the page falls back to the home card (a JPEG); `scripts/tests/share.test.mjs` fails until each post has its own card. `CHROME_BIN=/path/to/chrome` overrides the browser it looks for.
- `og:image` carries `?v=<hash>`, so an app that caches by address fetches the new card after a redesign. Apps cache previews: WhatsApp documents no cache time and has no refresh tool (not verified against any official source: reports say a link already sent keeps its old card, and a new chat or a link shared with a query string such as `?v=2` fetches a fresh one). Facebook and LinkedIn do have tools (Facebook Sharing Debugger, LinkedIn Post Inspector). Say this to the owner instead of promising that an old share will change.
- Tags per page: `og:site_name`, `og:locale`, `og:type`, `og:title`, `og:description`, `og:url`, `og:image` (+ `secure_url`, `type`, `width`, `height`, `alt`), `twitter:card=summary_large_image` with title, description, image and image alt, and `article:*` on posts. They sit near the top of `<head>` on purpose; keep them there.
- Check with `node --no-warnings --test scripts/tests/share.test.mjs` after a build.

## Search engines (Google, Bing, Yahoo, DuckDuckGo, Yandex)
Setup and steps are in `DEPLOY.md` and `docs/search-engines.md`. What the code already does, so do not undo it: one self-referencing absolute
canonical per page; `sitemap.xml` is an index of child sitemaps (`pages-`, `posts-`, `category-`, `label-`, `image-`, `video-sitemap1.xml`; a new number starts after `sitemapUrlsPerFile`, default 200, addresses) and lists only indexable pages (no noindex, no redirect stubs; About, Contact, Work with us and every policy page are noindex on purpose and not listed); `sitemap.xsl` (source `scripts/tools/sitemap.xsl`) only styles them for people, crawlers read the XML; redirect stubs for renamed posts have canonical +
instant meta refresh + a visible link (no noindex); titles stay near 60 characters (brand is added only when it fits; use `metaTitle:` for a
shorter search title) and every description is unique, 70 to 160 characters; Article, BreadcrumbList (posts), WebSite, Organization, ProfilePage
JSON-LD only, never FAQ/HowTo/SearchAction (retired by Google); `robots.txt` blocks AI-training bots, not search bots; no `Crawl-delay`.
After a push is live, notify Bing, Yahoo, DuckDuckGo and Yandex with `node scripts/indexnow.mjs` (use `--dry-run` first). Only run it when the
user asks: it contacts an outside service. Google is told through the sitemap in Search Console.

## Pictures
Use only pictures with a clear right to use: your own, properly licensed stock, or illustrations drawn in code (`scripts/tools/hero-art.html`).
Never use a picture that shows a real company logo, crest or badge, a real person's name, or a frame taken from someone else's video. Photoreal
AI pictures must not look like real news photos. Record where each used picture came from in `docs/image-sources.md`. Unused pictures do not
belong in `assets/` (everything there is public); old ones are in `../my-site-archive/`.

## Icons and the favicon
`node scripts/tools/make-icons.mjs` (needs ffmpeg) rebuilds `favicon.ico` (16, 32 and 48 px in one file), `assets/img/favicon-32.png`, `favicon-48.png`, `icon-192.png`, `icon-512.png` (the Organization logo in the JSON-LD) and `icon-180.png` (Apple touch icon, opaque white) from `scripts/tools/logo-mark-source.png`, cropping the mark tight so it fills about 95% of the canvas (readable at 16 px). Keep those URLs stable: Google asks for it. Google shows a favicon only after it has recrawled the home page (days to weeks, no guarantee): check `https://www.google.com/s2/favicons?domain=mayobebros.com`, verify the site in Search Console and Bing Webmaster Tools, run URL Inspection on the home page and "Request indexing". The home page also has `WebSite` and `Organization` JSON-LD with `@id`, `alternateName` and `sameAs` (only filled-in social links); never add `SearchAction`.
The home picture comes in three sizes (`hero-640.webp`, `hero-1080.webp`, `hero.webp`, served with `srcset`): re-make the two small ones with ffmpeg if `hero.webp` changes.

## PageSpeed "no data"
PageSpeed Insights shows two things: lab data (Lighthouse, works on this site) and field data from real Chrome visitors over 28 days (CrUX). "No data" is the field part: it needs enough Chrome traffic and cannot be forced from code. Test the exact origin `https://mayobebros.com/`. Cloudflare Web Analytics shows Core Web Vitals from the beacon already on every page.

## Table of contents and questions (what search engines can read)
- The post's "In this article" list and the legal pages' "On this page" list are plain HTML written at build time (`tocList()` in `scripts/lib/render.mjs`), never drawn by JavaScript. They link **every `##` and `###` heading** (the `###` questions nested under their `##`), and every heading has an `id`. That is what lets Google offer "jump to" links for a section; Google chooses whether to show them, and no markup can force it. `scripts/tests/pages.test.mjs` fails if a heading is missing from the list. Write each question in "Common questions" as a `###` heading with the answer in the paragraph right under it, so the question text is the heading a person searches for.
- Do not add FAQPage / QAPage JSON-LD: FAQ rich results are limited by Google to government and health sites (2023; some sources say removed in 2026), and QAPage is for pages where visitors write several answers. The visible headings and answers are what get indexed.
- **Reader questions answered in the comments** are loaded by JavaScript, which search engines may not wait for. `node scripts/qa-sync.mjs` saves every approved comment that is a question (a "?" or a question word, English or Swahili) and has a Team reply, plus those Team replies, into `content/qa.json`. The build writes them into the post's comment list as plain HTML (`staticComments()`), and `js/engage.js` replaces them with the live list once it loads. Praise with a thank-you reply is skipped. Workflow: reply with `node scripts/comments.mjs reply`, then `node scripts/qa-sync.mjs`, `node scripts/build.mjs`, push. Run the sync again after hiding or deleting a comment, because the saved copy stays in the page (and git history) until it is rewritten. Never edit `content/qa.json` by hand.

## Tags are topics
Every tag used by 2 or more posts becomes a topic page at `/tag/<tag>/` (built automatically; the home page shows the six biggest in "Topics from our tags"
and every tag chip on a post links to its page). The home page shows only those six cards and a "Browse all topics" button to `/tag/` (noindex, A to Z with counts); the post sidebar's Topics box starts with the article's own chips and a "More topics" button reveals the rest 12 at a time. A tag page is `noindex` and left out of the sitemap until 3 posts use the tag (thin pages are
bad for AdSense). So keep tags consistent: reuse the same spelling (`small business`, not `small businesses`), 3 to 5 per post, and only real topics.

## Updating an existing post
Change the text, set `updated:` to today, add a correction note at the top if the change is significant, rebuild.
Time-sensitive facts (fees, fares, deadlines, prices) must say when they were checked.

## Moderating comments
Comments publish at once unless the automatic screen (`worker/src/moderation.js`, English + Swahili lists in `worker/wordlists/`, see `worker/README.md`) flags them; flagged ones are held until approved. After editing a list run `node worker/build-wordlist.mjs`, the moderation tests, then `npx wrangler deploy` in `worker/` (wrangler login lives in `~/.config/.wrangler`: use `XDG_CONFIG_HOME=$HOME/.config`). Published comments can be hidden any time with `spam <id>`. Reply as the team (Team badge, admin only) with `node scripts/comments.mjs reply <id> "text"`; public commenters whose name looks like the team (mayobe, moderator, admin, team...) are held as `impersonation`. `node scripts/comments.mjs list` shows the held ones and why; `approve <id>`, `spam <id>` or
`delete <id>` act on them. Read each comment before approving. Approve only polite, on-topic comments with no
links or personal data, and apply `content/pages/comment-policy.html`. Needs the Worker deployed (`worker/README.md`)
and `.admin-token` (git-ignored) or `ADMIN_TOKEN`.
Readers can edit their own comment for 30 minutes (only while it has no reply; edits are re-checked) and delete it at any time; a deleted comment with replies stays as a "This comment was deleted." note. After a reader deletes a comment that was an answered question, run `node scripts/qa-sync.mjs`, then build and push, so the saved copy in `content/qa.json` is rewritten.

## Email (Resend, sent by the Worker)
Comment manage links, reply notices, owner alerts, the contact form and the newsletter (Phase 3, built; deploy is the owner's checklist in `worker/README.md`).
- Sending: `worker/src/mail.js` (`sendMail`, daily budget slices owner 10 / commenter 25 / contact 10 / news 35, suppression list). Templates: `worker/src/mail-templates.js` with colours in `mail-tokens.js`. Lint test: `scripts/tests/email-templates.test.mjs` (contrast, size, forbidden CSS, hostile input).
- Design: the emails follow the site (one calm card, navy header, the site's blue button). `mail-tokens.js` colours are tested against `css/style.css` by `scripts/tests/email-templates.test.mjs`, which also lints sizes, picture widths, alt text and forbidden CSS. Every email has the logo; the welcome (a lead card and three thumbnails) and the new-article email (a hero, or the video picture for a video post) have article pictures; the others only the logo. No tracking pixel and no open or click tracking: Resend tracking stays off.
- Pictures: made by `node scripts/build.mjs` into `assets/email/` (JPEG crops of the covers, `logo.png`, committed), hashes in the build manifest. A post can override its crop with `emailImage:` and `emailImageAlt:` in the front matter. `data/search.json` carries `m` (email picture), `w` (video flag) and `a` (alt) per post so the Worker needs no extra request. Pictures load from the live site: they appear in test sends only after `assets/email/` is pushed.
- Look at every template before changing one: `node scripts/tools/email-preview.mjs` (writes HTML, text and PNGs to `~/.cache/mayobe-email-preview/`, never into the repo).
- Rule: text typed by a visitor is never sent to an address that has not been confirmed. The manage-link mail and the contact confirmation carry fixed text only; owner-bound mail may carry escaped visitor text. Every link in an email is on our own origin.
- A failed or skipped email must never fail a request (`ctx.waitUntil`), except the contact form, which answers with the mailto fallback when the owner notice cannot be sent. Owner addresses are never suppressed.
- Policies (`content/pages/privacy-policy.html`, `comment-policy.html`, `contact.html`, `terms-of-service.html`) describe all of this: change them with the code.
- Newsletter: double opt-in sign-up, a welcome mail, one email per new article from a daily Cron Trigger, one-click unsubscribe. Code: `worker/src/newsletter.js`, `worker/migrations/0007_newsletter.sql`, `scripts/newsletter.mjs` (owner CLI: list, count, dry-run, seed, remove), `js/subscribe.js` (footer form), `js/newsletter.js` + `content/pages/newsletter.html` (the confirm/unsubscribe page, built only when on). The footer form, `/newsletter/` and every newsletter sentence in the policies (inside `{{#newsletter}}...{{/newsletter}}`) exist only when `newsletterAction` in `site.config.json` is `"api"` (git keeps `""`, the footer then shows the RSS button). Preview locally with `node scripts/build.mjs --api http://127.0.0.1:8787 --newsletter` (never commit that output). Article emails go out only when the Worker var `NEWSLETTER_SEND` is `"true"` (git ships `"false"`). They may use 25 of the 35-a-day news slice (10 are kept for confirmations, welcomes and goodbyes), so about 25 subscribers get an article per day, fewer when two articles come out the same day; a list of 60 gets one article within 3 days. `node scripts/newsletter.mjs count` shows what is still queued. Run `seed` and `dry-run` right before switching `NEWSLETTER_SEND` on. Never rename a post in its first week (subscribers would get it twice). Details and the go-live order: `worker/README.md`.
- Owner-run test send: `node scripts/mail-test.mjs <template> <to> --yes` (needs `RESEND_API_KEY` in the environment; never run it without the owner). Samples come from the real `data/search.json`. `--dry` prints the subject and text without a key. Templates whose links lead to `/manage/` or `/newsletter/` (`manage-link`, `reply-notice` and the five newsletter ones) refuse to send without `--pages-live`, the owner's word that those pages are live.
- Real mail on this computer: `DEV_MAIL_REAL=1 DEV_MAIL_ALLOW=<address> node --no-warnings scripts/dev-api.mjs` sends through Resend only to the listed addresses (key read from `worker/.dev.vars`, never printed); links open `http://127.0.0.1:8000`. Steps: "Try the newsletter with real mail on your computer" in `worker/README.md`. Never run it without the owner. Setup and limits: "Email setup (owner checklist)" at the end of `worker/README.md`.

## RSS feed
`feed.xml` is plain RSS 2.0 for feed readers (the W3C validator passes it). Browsers show it as code, and XSLT styling is being removed from Chrome on 2026-11-17,
so people are never sent to it: every visible "RSS feed" or "Follow with RSS" link goes to the page `/rss/` (copy button, what RSS is, how to follow,
latest articles, questions). Only `<link rel="alternate" type="application/rss+xml">` in `<head>` points at the feed, so readers still find it.
`feed.xml` carries a `text/css` stylesheet (`scripts/tools/feed.css`, built to `/feed.css`) so a person who opens it sees a readable page; CSS on XML is still supported.
Do not add XSLT or scripts to the feed. Do not link third-party reader services from the page unless the link format is verified.

## Do not hand-edit generated files
Generated on every build: `index.html`, `404.html`, `post/`, `category/`, `label/`, `tag/` (every tag page and the `/tag/` index of all topics), `data/tags.json` (read by the sidebar's "More topics" button), `popular/`, `search/`, `author/`,
every page folder from `content/pages/`, `sitemap.xml`, `*-sitemap<N>.xml`, `sitemap.xsl`, `feed.xml`, `feed.css`, `rss/`, `newsletter/` (only when the newsletter is on), `sitemap/`, `robots.txt`, `manifest.json`, `data/search.json`,
`assets/share/*.jpg` (link-preview pictures), `.share-cards.json`, `assets/email/*` (email pictures: `post-`, `thumb-`, `video-<slug>.jpg` and `logo.png`, drawn like the share cards by `scripts/lib/email-images.mjs` from `scripts/tools/email-card.html`; a post with a video gets its play-button picture from its own poster or cover, never a video frame; their versions go into `data/search.json` as `m`/`w`, the cover's alt as `a`), `.email-images.json`, `.build-manifest.json`. Change the sources and rebuild:

| To change | Edit |
| --- | --- |
| A post | `content/posts/<slug>.md` |
| About, Contact, Work with us, all policy pages | `content/pages/<slug>.html` |
| Categories, labels, category pictures | `content/categories.json` |
| Site name, URL, emails, author bio, AdSense id, comments API, social links | `site.config.json` |
| Look and feel | `css/style.css` |
| Share and social icons | real logo shapes in `BRANDS` in `scripts/lib/render.mjs`; brand colours (hover) in the last block of `css/style.css` (Facebook #0866FF, WhatsApp #25D366, LinkedIn #0A66C2, X black/white, Instagram gradient) |
| Behaviour (menu, search, theme, cookie notice, video player loader) | `js/site.js`; reactions and comments: `js/engage.js`; "Listen to this article": `js/listen.js`; 404 page countdown and email-link notice: `js/notfound.js`; random posts and their pager on the 404 page: `js/notfound-posts.js`; page-change motion (glide, fade, rise) for every pager and "Show more": `js/motion.js` |
| Home page "Discover more" section (reading paths, topic rail, tools) | reading paths: `homePaths` in `site.config.json` (title, sub, category for the picture, 2 to 4 post slugs each); everything else is computed from real content (topics with posts, shortest articles, common tags, newest article). Never label it "trending" or "popular": there are no visitor numbers. |
| Article sidebar (Read next, reading path, More like this (5), Topics, Follow, sticky progress + Listen, and one optional ad slot) | `postRail()` and `sidebarAd()` in `scripts/lib/render.mjs`, `.rail-*` at the end of `css/style.css`. Reading paths come from `homePaths` in `site.config.json`. Keep it to 5 or 6 modules, plain headings ("Read next", "Follow"), no ad-like boxes. The ad slot is written to the page only when `adsense.client`, `adsense.autoAds: true` and `adsense.sidebarSlot` (digits only) are all set; `js/site.js` shows it only after Accept and hides it if no ad comes back. Google allows only the label "Advertisements" or "Sponsored Links", does not want ad units loaded hidden (the box is shown first and removed on `data-ad-status="unfilled"`), and counts accidental clicks as a violation (keep 2rem of space around it, never sticky). |
| Author page (`/author/<slug>/`: profile card, topics, how articles are made, contact, article list) and the author box under each post | authors in `site.config.json` (`name`, `slug`, `role`, `email`, `bio`; optional `photo` + `photoAlt` for a real portrait; optional `social` with `facebook`, `twitter`, `instagram`, `linkedin` URLs, shown and sent as `sameAs` only when filled). Template: `authorPage()` and `authorAvatar()` in `scripts/lib/render.mjs`, `.ap-*` at the end of `css/style.css`. Every number on it (articles, topics, first and latest article, topic counts) is counted from the posts; the "How articles are made" list restates the Editorial Policy, so change both together. No stock or generated face: until the author adds a real photo they get a faceless black silhouette (`assets/img/avatar-man.svg`, or `avatar-woman.svg` when `"gender": "female"` is set in their `site.config.json` entry; anything else shows the man). Team replies in comments use the logo mark (`assets/img/icon-192.png`). The first section after the hero must keep the grid followed by `nav.pagination` (`js/pager.js` swaps them in place). |
| Hero pictures of company, legal and trust pages | `scripts/tools/hero-art.html`, `assets/img/heroes/`, `pageHeroes` in `site.config.json` (see `docs/hero-art.md`) |
| Video player (Plyr 3.8.5, MIT, hosted here, do not edit) | `vendor/plyr/` |
| Link-preview picture (look, size, quality budget) and tags | look: `scripts/tools/share-card.html`; drawing and budget: `scripts/lib/share.mjs`; tags: `head()` and `shareImage()` in `scripts/lib/render.mjs` |
| Page templates (header, footer, hero, post layout) | `scripts/lib/render.mjs` |
| Comments/reactions server | `worker/` |

Commands: `node scripts/build.mjs` (build) · `--check` (validate only) · `node scripts/serve.mjs` (preview) ·
`node --no-warnings --test scripts/tests/markdown.test.mjs scripts/tests/worker.test.mjs` (tests) ·
`node --no-warnings scripts/dev-api.mjs` (local fake comments API) · `node scripts/build.mjs --api http://127.0.0.1:8787` builds with comments on for local testing only; rebuild without `--api` before committing.

## CSS pitfalls found the hard way
- Give every `@keyframes` a unique name. A duplicate name silently replaces the first one (a copy of `page-in` once left a `transform` on `<body>`, which pinned
  every `position: fixed` thing, the Listen bar, the cookie notice and the back-to-top button, to the bottom of the whole page instead of the screen).
- `body` and `html` must never keep a `transform`, `filter`, `contain` or `will-change: transform` after load. Check with
  `getComputedStyle(document.body).transform === 'none'`. Not even for a moment: `body.is-leaving` (the old cross-page fade for browsers without
  native view transitions) once had a `translateY`, which threw a bottom-fixed box from 770 px to 8,918 px down during the fade; it is opacity only now,
  and `scripts/tests/motion.test.mjs` fails on any such rule for `html`, `body` or `:root`.
- The page-change states are keyframe **animations** (`mo-in`, `mo-out`, `mo-dim`), not transitions, so they beat the reveal styles without a specificity
  fight; they animate only `opacity` and `transform`. `html.mo-gliding` (present only while a glide runs) sets nothing but `scroll-behavior: auto` and
  `overflow-anchor: none`. Never animate `height` or `min-height` for a page change: it is a layout shift (CLS).

## Rules that protect AdSense approval
- Never invent statistics, quotes, people, reviews or personal stories. Never claim income, guarantees or "get rich" results.
- Never publish text you have not read and checked. AI help is fine for research and drafting; accuracy and honesty are the author's job.
- No fake pages, fake numbers, or placeholder content anywhere on the site. Keep legal pages in line with what the site really does (update `content/pages/*.html` when features change, for example if analytics or a newsletter is added).
- Do not turn on ads (`adsense.autoAds` in `site.config.json`) until AdSense has approved the site. The sidebar slot (`adsense.sidebarSlot`) stays empty until then too: never ship an empty "Advertisements" box.
- Never commit secrets (`.admin-token`, tokens, keys). Never put Supabase, Vercel or API keys into this repo.
