# AI bot policy: how it works and what to do in Cloudflare

Written 2026-11-16 (owner's rule). Research behind it: robots.txt and AI crawler lists, Cloudflare Free plan, copy deterrence and licence
standards, all opened and read on that day. Nothing here is legal advice.

## The rule

AI products may read the site to answer their users **only if** they show "Mayobe Bros" as the source with a working link to the article, and
send readers to the article for more. Training on the content, building datasets, republishing and unknown AI agents need the Mayobe Bros
Team's written permission (Contact page). Anything that ignores this must not read the site or train on it.

## What the repo does (all built by `node scripts/build.mjs`)

| Where | What | Who can really be stopped by it |
| --- | --- | --- |
| `robots.txt` (`robots()` in `scripts/lib/render.mjs`, lists in `scripts/lib/ai-policy.mjs`) | Tier A groups (AI search and answer tools) allowed under the terms; tier B groups (training crawlers, dataset builders, fetchers with no documented source links) refused; `License:` line; `Content-Signal: search=yes, ai-train=no`; the `__usage_ai-training` group | Bots that obey robots.txt. The user-triggered fetchers (ChatGPT-User, Perplexity-User, Meta-ExternalFetcher, Amzn-User) say they may ignore it |
| `/license.xml` (RSL 1.0, `licenseXml()`) | Free use for search and answers, **payment type "attribution"** (visible credit and a working link), training prohibited | Nobody is known to read it yet. It is the machine-readable form of the terms |
| `/ai-use-terms/` (`content/pages/ai-use-terms.html`, footer "Legal and trust") | The public terms, dated 2026-11-16, how to ask for permission | Evidence of what you granted and refused |
| `<link rel="license">` in every page `<head>` | Points to `/license.xml` | Same as above |
| `feed.xml` | Title, summary and a link only (was the full text) | Scrapers that read the feed |
| `js/copy-note.js` + `copyGuard` in `site.config.json` | A copy of 160 characters or more from an article body gets a link to the article added and a small note; short copies, forms, code and tables are untouched | Casual copy and paste only |

Switches in `site.config.json` (rebuild after changing):

- `"blockAiCrawlers": false` removes every AI rule, the `License:` line, `/license.xml` and the `<link rel="license">`.
- `"aiAnswers": "block"` also refuses tier A (the one switch: no AI at all) and makes `/license.xml` permit search only.
- `"copyGuard": { "mode": "attribute" | "limit" | "off", "minChars": 160 }`. `limit` copies only the first `minChars` characters plus the link. Turning text selection off is **not** offered: it stops no scraper and breaks Find in page, iOS Speak Selection and VoiceOver line reading.

Not shipped on purpose: TDMRep (`tdm-reservation: 1` is a blanket reservation that would contradict "answers allowed", and the spec says to use one technique), `llms.txt` (Google says it does not use it), IETF AIPREF `Content-Usage` (unfinished drafts, no reader). Add them later if the owner wants them.

## Honest limits

- No AI company is bound by robots.txt, the licence file or the terms page. robots.txt cannot say "allowed if you credit us"; the conditions live in the terms and in `/license.xml`.
- Only the Cloudflare rules below actually refuse a request. Spoofed user agents still get through, and so do browser-based agents that look like a person.
- Vendors document source links for PerplexityBot, Perplexity-User, DuckAssistBot, MistralAI-User and Meta-WebIndexer. For Claude-SearchBot and Claude-User only the product pages say citations are shown. For OAI-SearchBot and ChatGPT-User no page could be opened (OpenAI returned 403 to the research agent). They are in tier A because the owner approved it; move any of them to tier B in `ai-policy.mjs` if you disagree.
- Google-Extended stays blocked, and it controls both Gemini training and Gemini grounding, so the site is not a Gemini answer source. Google AI Overviews and AI Mode are fed by Googlebot and cannot be refused without leaving search.
- The repository is **public** and `/content/posts/<slug>.md` is served by GitHub Pages (HTTP 200 on 2026-11-16). The Cloudflare Rule 1 below hides the source folders from everyone on the live domain, but the same Markdown stays readable on GitHub. The real fix is a private source repository that publishes only the built output (this needs a separate decision and a paid GitHub plan or another host).

## Cloudflare steps (owner, by hand; free plan; nothing here is done yet)

Rule changes take effect within seconds and can be switched off in a minute. Do them in this order.

1. **Check Cloudflare's own AI settings first.** dash.cloudflare.com > mayobebros.com > Security > Settings > filter "Bot traffic" > "AI Crawler and Agent access policies" (the names from Cloudflare's docs, 2026-11-16). Wanted: Search = Allow, Agent = Allow, Training = Allow or "Disallow AI Training". **Never "Block" and never "Block on pages with ads"**: Cloudflare says those also block Googlebot, Bingbot and Applebot. Leave "Bot Preference Sync" off (it would put Cloudflare's own text in front of ours). Leave Bot Fight Mode and Hotlink Protection off. Write down what you see.
2. Security > Security rules > Create rule > Custom rules. The free plan allows 5. Create these three, **in this order**, action **Block**. Cloudflare's free Block shows its standard 403 page; a custom message needs the Pro plan (see below).
3. **Test before it is live.** Add `and http.request.uri.query contains "wafprobe=1"` to the end of the expression (wrap the rule in brackets first), Deploy, test with curl (below), then remove the extra clause.
4. Check Googlebot and AdSense after each change: Search Console > URL Inspection > the home page and one post > Test live URL; Security > Analytics > Events (filter Action "Block") must never show Googlebot, bingbot, Mediapartners-Google, AdsBot, facebookexternalhit, WhatsApp, Twitterbot or LinkedInBot; `curl -I https://mayobebros.com/ads.txt` must stay 200.

### Rule 1: "Source files" (everyone, including verified bots)

```
(starts_with(lower(http.request.uri.path), "/content/") or starts_with(lower(http.request.uri.path), "/scripts/") or starts_with(lower(http.request.uri.path), "/worker/") or starts_with(lower(http.request.uri.path), "/results-worker/") or starts_with(lower(http.request.uri.path), "/docs/") or starts_with(lower(http.request.uri.path), "/.github/") or starts_with(lower(http.request.uri.path), "/.claude/") or starts_with(lower(http.request.uri.path), "/.superpowers/")) or lower(http.request.uri.path) in {"/claude.md" "/deploy.md" "/readme.md" "/site.config.json" "/package.json" "/package-lock.json" "/.gitignore" "/cname" "/.build-manifest.json" "/.share-cards.json" "/.email-images.json"}
```

Never add `/results-shell.html`: the results Worker fetches it.

### Rule 2: "AI training crawlers (tier B)"

```
lower(http.user_agent) contains "gptbot" or lower(http.user_agent) contains "claudebot" or lower(http.user_agent) contains "anthropic-ai" or lower(http.user_agent) contains "claude-web" or lower(http.user_agent) contains "ccbot" or lower(http.user_agent) contains "bytespider" or lower(http.user_agent) contains "meta-externalagent" or lower(http.user_agent) contains "meta-externalads" or lower(http.user_agent) contains "amazonbot" or lower(http.user_agent) contains "diffbot" or lower(http.user_agent) contains "cohere-ai" or lower(http.user_agent) contains "cohere-training-data-crawler" or lower(http.user_agent) contains "imagesiftbot" or lower(http.user_agent) contains "omgili" or lower(http.user_agent) contains "timpibot" or lower(http.user_agent) contains "facebookbot" or lower(http.user_agent) contains "ai2bot" or lower(http.user_agent) contains "google-cloudvertexbot" or lower(http.user_agent) contains "aihitbot" or lower(http.user_agent) contains "bedrockbot" or lower(http.user_agent) contains "brightbot" or lower(http.user_agent) contains "deepseekbot" or lower(http.user_agent) contains "erniebot" or lower(http.user_agent) contains "icc-crawler" or lower(http.user_agent) contains "kimibot" or lower(http.user_agent) contains "moonshotbot" or lower(http.user_agent) contains "qwenbot" or lower(http.user_agent) contains "tiktokspider" or lower(http.user_agent) contains "yibot" or lower(http.user_agent) contains "laiondownloader" or lower(http.user_agent) contains "img2dataset" or lower(http.user_agent) contains "crawl4ai" or lower(http.user_agent) contains "friendlycrawler" or lower(http.user_agent) contains "velenpublicwebcrawler" or lower(http.user_agent) contains "webzio-extended"
```

Each clause is a named vendor product, so it cannot match Googlebot, Bingbot, AdSense, Applebot or the link-preview bots. Never add a word such as `bot`, `crawler`, `compatible`, `google`, `apple` or `mozilla`. Do not put Cloudflare's "skip verified bots first" rule above this one: it would also skip verified GPTBot and ClaudeBot. The last 17 names come from a community list (ai-robots-txt), not from vendor pages: delete any line you do not want.

### Rule 3: "AI search and assistants (tier A, switch)", save as Draft

```
lower(http.user_agent) contains "oai-searchbot" or lower(http.user_agent) contains "chatgpt-user" or lower(http.user_agent) contains "claude-searchbot" or lower(http.user_agent) contains "claude-user" or lower(http.user_agent) contains "perplexitybot" or lower(http.user_agent) contains "perplexity-user" or lower(http.user_agent) contains "duckassistbot" or lower(http.user_agent) contains "mistralai-user" or lower(http.user_agent) contains "meta-webindexer" or lower(http.user_agent) contains "meta-externalfetcher" or lower(http.user_agent) contains "amzn-searchbot" or lower(http.user_agent) contains "amzn-user"
```

Keep it as a draft. Deploying it refuses tier A as well (the Cloudflare side of `"aiAnswers": "block"`; change both together). It never matches Applebot, Googlebot, bingbot, DuckDuckBot or the AdSense and social bots.

### Test with curl (after step 3, with the `wafprobe` clause in place)

```
curl -sS -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot" "https://mayobebros.com/?wafprobe=1"   # expect 403
curl -sS -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "https://mayobebros.com/?wafprobe=1"                                  # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0 (compatible; Mediapartners-Google/2.1; +http://www.google.com/bot.html)" "https://mayobebros.com/?wafprobe=1"                         # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" "https://mayobebros.com/?wafprobe=1"   # expect 200 while Rule 3 is a draft
curl -sS -o /dev/null -w "%{http_code}\n" https://mayobebros.com/CLAUDE.md                                                                                                                     # expect 403 once Rule 1 is live
```

`/robots.txt`, `/ads.txt`, `/sitemap.xml`, `/feed.xml`, `/data/search.json`, a post page and `/results/...` must stay 200.

### Rollback

Security > Security rules > open the rule > switch it off, or delete it. Each rule is independent.

### The message for blocked agents (Pro plan only)

On the free plan a blocked agent sees Cloudflare's own 403 page, not our words. Our words are in `robots.txt`, the terms page and `/license.xml`, which is where a crawler operator looks. On the Pro plan (about 20 US dollars a month billed yearly) the Block action can return status 403 with this text (under 2 KB):

```
Access denied. Mayobebros.com does not allow AI training, scraping or copying of its content without permission. To ask for permission, contact the Mayobe Bros Team through https://mayobebros.com/contact/ and tell us who you are and how you want to use the content.
```

## After the site is pushed

1. Take a Wayback Machine snapshot of `/ai-use-terms/` (web.archive.org/save/...) so the date is on record.
2. Wait 24 hours: OpenAI, Perplexity, Meta and Amazon re-read robots.txt about daily, DuckDuckGo within 72 hours.
3. Keep server evidence: Cloudflare Security > Analytics > Events (31 days on free) shows which agents were refused.
4. Monitoring for copiers: search a distinctive sentence of each new article in quotes; Google Alerts on it; DMCA removal requests go to Google, Bing and the host of the copying site (Google's copyright removal form needs the original URL, the copy URL and a signed statement).
