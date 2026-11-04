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
break the Cookie Policy). Videos need a useful caption, must be ours or properly licensed, and must not carry the article on their own:
the text must still stand without them.

## Listen to this article
Every post gets a Listen button next to the share buttons (`js/listen.js`). It reads the title, then every paragraph, heading and list
item, and stops before "Sources and further reading" (so keep that exact heading text for the sources list). It uses the reader's own
browser voices, highlights the sentence being read, auto-scrolls, and skips pictures, tables, code and videos. Nothing to do per post.
Write numbers and units the way people say them (`TSh 600`, `10 km`, `15%` are read correctly; unusual abbreviations are not).

## Pages and pagination
Every listing (all posts, popular, each category and label, each author) shows 15 posts per page (`postsPerPage` in `site.config.json`).
When there are more, a pagination bar appears under the grid with Newer, Older and page numbers (`/post/page/2/`, `/popular/page/2/`,
`/category/<slug>/page/2/`, `/author/<slug>/page/2/`). These pages are built automatically; nothing to do when you publish. Clicking a page number swaps only the cards and the number bar with a fade (`js/pager.js`, no page reload, Back/Forward work). On category and label pages, the label buttons, the menu and the category tiles also switch in place: the words and cards fade out, the hero picture cross-fades, the new content rises in. Without JavaScript all of these are normal links. The search page
shows 15 results at a time with a "Show more results" button. Each post ends with a Previous / Next pair of picture cards (older and newer
article, with a thumbnail from their `image:`); the newest and oldest posts get an "All articles" card instead of a blank gap.

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
canonical per page; `sitemap.xml` lists only indexable pages (no noindex, no redirect stubs); redirect stubs for renamed posts have canonical +
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

## Tags are topics
Every tag used by 2 or more posts becomes a topic page at `/tag/<tag>/` (built automatically; the home page shows the six biggest in "Topics from our tags"
and every tag chip on a post links to its page). A tag page is `noindex` and left out of the sitemap until 3 posts use the tag (thin pages are
bad for AdSense). So keep tags consistent: reuse the same spelling (`small business`, not `small businesses`), 3 to 5 per post, and only real topics.

## Updating an existing post
Change the text, set `updated:` to today, add a correction note at the top if the change is significant, rebuild.
Time-sensitive facts (fees, fares, deadlines, prices) must say when they were checked.

## Moderating comments
Comments are held until approved. `node scripts/comments.mjs list` shows them; `approve <id>`, `spam <id>` or
`delete <id>` act on them. Read each comment before approving. Approve only polite, on-topic comments with no
links or personal data, and apply `content/pages/comment-policy.html`. Needs the Worker deployed (`worker/README.md`)
and `.admin-token` (git-ignored) or `ADMIN_TOKEN`.

## Do not hand-edit generated files
Generated on every build: `index.html`, `404.html`, `post/`, `category/`, `label/`, `popular/`, `search/`, `author/`,
every page folder from `content/pages/`, `sitemap.xml`, `feed.xml`, `robots.txt`, `manifest.json`, `data/search.json`,
`assets/share/*.jpg` (link-preview pictures), `.share-cards.json`, `.build-manifest.json`. Change the sources and rebuild:

| To change | Edit |
| --- | --- |
| A post | `content/posts/<slug>.md` |
| About, Contact, Work with us, all policy pages | `content/pages/<slug>.html` |
| Categories, labels, category pictures | `content/categories.json` |
| Site name, URL, emails, author bio, AdSense id, comments API, social links | `site.config.json` |
| Look and feel | `css/style.css` |
| Share and social icons | real logo shapes in `BRANDS` in `scripts/lib/render.mjs`; brand colours (hover) in the last block of `css/style.css` (Facebook #0866FF, WhatsApp #25D366, LinkedIn #0A66C2, X black/white, Instagram gradient) |
| Behaviour (menu, search, theme, cookie notice, video player loader) | `js/site.js`; reactions and comments: `js/engage.js`; "Listen to this article": `js/listen.js` |
| Home page "Discover more" section (reading paths, topic rail, tools) | reading paths: `homePaths` in `site.config.json` (title, sub, category for the picture, 2 to 4 post slugs each); everything else is computed from real content (topics with posts, shortest articles, common tags, newest article). Never label it "trending" or "popular": there are no visitor numbers. |
| Article sidebar (Read next, reading path, More like this (5), Topics, Follow, sticky progress + Listen, and one optional ad slot) | `postRail()` and `sidebarAd()` in `scripts/lib/render.mjs`, `.rail-*` at the end of `css/style.css`. Reading paths come from `homePaths` in `site.config.json`. Keep it to 5 or 6 modules, plain headings ("Read next", "Follow"), no ad-like boxes. The ad slot is written to the page only when `adsense.client`, `adsense.autoAds: true` and `adsense.sidebarSlot` (digits only) are all set; `js/site.js` shows it only after Accept and hides it if no ad comes back. Google allows only the label "Advertisements" or "Sponsored Links", does not want ad units loaded hidden (the box is shown first and removed on `data-ad-status="unfilled"`), and counts accidental clicks as a violation (keep 2rem of space around it, never sticky). |
| Author page (`/author/<slug>/`: profile card, topics, how articles are made, contact, article list) and the author box under each post | authors in `site.config.json` (`name`, `slug`, `role`, `email`, `bio`; optional `photo` + `photoAlt` for a real portrait; optional `social` with `facebook`, `twitter`, `instagram`, `linkedin` URLs, shown and sent as `sameAs` only when filled). Template: `authorPage()` and `authorAvatar()` in `scripts/lib/render.mjs`, `.ap-*` at the end of `css/style.css`. Every number on it (articles, topics, first and latest article, topic counts) is counted from the posts; the "How articles are made" list restates the Editorial Policy, so change both together. No stock or generated face: initials until the author adds a real photo. The first section after the hero must keep the grid followed by `nav.pagination` (`js/pager.js` swaps them in place). |
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
  `getComputedStyle(document.body).transform === 'none'`.

## Rules that protect AdSense approval
- Never invent statistics, quotes, people, reviews or personal stories. Never claim income, guarantees or "get rich" results.
- Never publish text you have not read and checked. AI help is fine for research and drafting; accuracy and honesty are the author's job.
- No fake pages, fake numbers, or placeholder content anywhere on the site. Keep legal pages in line with what the site really does (update `content/pages/*.html` when features change, for example if analytics or a newsletter is added).
- Do not turn on ads (`adsense.autoAds` in `site.config.json`) until AdSense has approved the site. The sidebar slot (`adsense.sidebarSlot`) stays empty until then too: never ship an empty "Advertisements" box.
- Never commit secrets (`.admin-token`, tokens, keys). Never put Supabase, Vercel or API keys into this repo.
