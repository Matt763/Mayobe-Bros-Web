# Search engines: what to do once, and what happens every time you publish

Checked online on 2026-11-03 against Google Search Central, Bing's and Microsoft's webmaster posts, IndexNow, Yandex Webmaster help,
DuckDuckGo's and Yahoo's help pages. Where a source could not be read, the text says so.

## Who gets your pages from where
- **Google**: its own crawler. Uses `sitemap.xml`. Does **not** use IndexNow.
- **Bing**: its own crawler. Uses `sitemap.xml` and IndexNow.
- **Yahoo Search**: shows Bing's index. There is no separate submission; Yahoo's own help says to submit through Bing Webmaster Tools.
- **DuckDuckGo**: "largely sources from Bing" (its own help page), plus its own crawler DuckDuckBot. There is no webmaster tool and no
  submission form. Being in Bing is the route.
- **Yandex**: its own crawler. Uses `sitemap.xml` (XML or TXT only, not RSS) and IndexNow. In Tanzania Yandex has about 0.04% of searches
  (Statcounter, Oct 2026), so expect almost no visitors from it; the setup is cheap, so it is done anyway.

## One-time steps (after the site is live on https://mayobebros.com, see DEPLOY.md steps 1 to 3)
1. **Choose one address and keep it**: `mayobebros.com` (the `CNAME` file, canonical tags, sitemap and IndexNow all use it). GitHub redirects
   `www.` to it when both DNS names are set. Tick "Enforce HTTPS" in the repository's Pages settings.
2. **Google Search Console**: add the *Domain* property `mayobebros.com` and verify with the DNS TXT record Google shows (Spaceship DNS). Then
   Sitemaps > add `sitemap.xml`. Use URL Inspection > Request indexing for the home page and your best two posts.
3. **Bing Webmaster Tools** (this also covers Yahoo and DuckDuckGo): sign in, either *Import from Google Search Console* (verifies at once and
   copies the sitemap) or add the site and verify with the meta tag: paste the content value into `"verification": { "bing": "..." }` in
   `site.config.json`, rebuild and push. Submit `sitemap.xml`. Use URL Inspection on the home page.
4. **Yandex Webmaster**: add exactly `https://mayobebros.com`. The verification file and meta tag are already on the site; keep both forever
   (Yandex re-checks). Indexing > Sitemap files > add `https://mayobebros.com/sitemap.xml`. Region: leave it unset or choose "No region".
5. **IndexNow**: the key and its file are already made (`site.config.json` > `indexNowKey`, and `<key>.txt` in the site root). Make sure that
   file is published; `https://mayobebros.com/<key>.txt` must show the key.
6. **AdSense**: only after the checklist in DEPLOY.md step 6 (including `"showEmptyTopics": false`).

## Every time you publish
1. Build, check, commit and push (see CLAUDE.md). Wait about two minutes for GitHub Pages.
2. `node scripts/indexnow.mjs --dry-run`, then `node scripts/indexnow.mjs`. It sends only new, changed or removed addresses.
3. Google finds new posts through the sitemap on its own; for an important post use URL Inspection > Request indexing.

## Facts worth remembering
- Google ignores `changefreq` and `priority` and uses `lastmod` only if it is honest. Set `updated:` in a post only when you really changed it.
- Google retired FAQ, HowTo and sitelinks-search-box rich results, so the site does not add that markup. A visible "Common questions" section is
  still good content.
- Google treats an instant meta refresh (`content="0; url=..."`) like a permanent redirect; Bing's old guidance says the same; Yandex treats a
  refresh as temporary, so each redirect stub also has a canonical to the new address. Keep the stubs for at least a year.
- Blocking `Google-Extended` or other AI-training bots does not affect search ranking. Do not block `Googlebot`, `Bingbot`, `YandexBot`,
  `DuckDuckBot` or `Mediapartners-Google` (AdSense).
- Do not set `Crawl-delay`: Bing honours it and crawls less; Yandex ignores it.
- Bing's 2026 guidelines say large amounts of content with no editorial review may be left out, and ban text written to trigger AI citations.
  The writing guide already prevents both.
- Core Web Vitals targets: LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less. The site loads one CSS file, deferred JavaScript and system
  fonts. The big hero pictures are the main weight: keep each under about 250 KB.
