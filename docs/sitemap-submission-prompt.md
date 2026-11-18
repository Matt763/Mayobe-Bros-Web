# Prompt for the Claude browser extension: submit the Mayobe Bros sitemaps

Copy everything under the line into the extension.

---

You are helping the owner of https://mayobebros.com submit sitemaps to search engines. Work only in the accounts the owner is already signed in to. Do not change any other setting, do not remove sites or sitemaps, and do not enter passwords or verification codes yourself: if a sign-in or verification step appears, stop and ask me. After every submission, read back the status shown on the page and report it to me.

## Search engines (do them in this order)

1. **Google Search Console** (https://search.google.com/search-console): property `https://mayobebros.com` (or the domain property `mayobebros.com`). Go to Indexing > Sitemaps.
2. **Bing Webmaster Tools** (https://www.bing.com/webmasters): site `https://mayobebros.com`. Go to Sitemaps > Submit sitemap. Bing also feeds Yahoo, DuckDuckGo and Ecosia, so nothing extra is needed for them.
3. **Yandex Webmaster** (https://webmaster.yandex.com): site `mayobebros.com` (it is already verified by the file `yandex_66d6f591f2987283.html`). Go to Indexing > Sitemap files > Add.

## Stage 1: submit now

Submit this one address in each search engine. It is a sitemap index, so the child files are found by themselves:

- https://mayobebros.com/sitemap.xml

Its children (for checking that they were read; do NOT submit them one by one unless an engine refuses the index):

- https://mayobebros.com/pages-sitemap1.xml
- https://mayobebros.com/posts-sitemap1.xml
- https://mayobebros.com/posts-sitemap2.xml
- https://mayobebros.com/category-sitemap1.xml
- https://mayobebros.com/label-sitemap1.xml
- https://mayobebros.com/image-sitemap1.xml
- https://mayobebros.com/image-sitemap2.xml
- https://mayobebros.com/video-sitemap1.xml

(The owner's build writes `posts-sitemap3.xml` and `image-sitemap3.xml` only when the lists grow past 200 addresses per file; use the list that https://mayobebros.com/sitemap.xml shows on the day.)

Expected result: status "Success" (Google) or "Processed" (Bing, Yandex). Report the number of pages each engine discovered.

## Stage 2: DO NOT submit yet

These two sitemap indexes belong to the school result pages (about 590,000 addresses):

- https://mayobebros.com/results/sitemap-schools.xml
- https://mayobebros.com/results/sitemap-hubs.xml

Do not submit them until the owner tells you that the Results Worker runs on the Cloudflare **Workers Paid** plan. First open both addresses in a browser tab: they must show XML (a list of `<sitemap>` entries), not the text "error code: 1102" or a 503 page. If either shows an error, stop and tell the owner. Do not submit `https://mayobebros.com/results/sitemap.xml` (it repeats both).

## Report

Give me a table: search engine, sitemap address, status shown, pages discovered, any error text exactly as shown.
