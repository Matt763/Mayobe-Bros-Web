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

## Stage 2: submit now (the school result pages are live)

Since 2026-11-18 the Results Worker serves ready-made pages, so these two sitemap indexes work on the free Cloudflare plan. They hold about 590,000 school page addresses in 245 child files (children are named `sitemap-schools-<exam>-<year>-<n>.xml` and `sitemap-hubs-...xml`; they are found by themselves from the index):

- https://mayobebros.com/results/sitemap-schools.xml (137 child files)
- https://mayobebros.com/results/sitemap-hubs.xml (108 child files)

Before submitting, open each address in a browser tab: it must show XML (a list of `<sitemap>` entries), not the text "error code: 1102" or a 503 page. If either shows an error, stop and tell me. Do not submit `https://mayobebros.com/results/sitemap.xml` (it repeats both). Submit the two as separate sitemaps in each search engine, so each gets its own report.

Expected: Google may show "Couldn't fetch" for a minute on big indexes, then "Success"; report what it shows and do not resubmit more than once. Discovery of 590,000 addresses takes days: do not worry if "Discovered pages" starts low. Do NOT use "Request indexing" on school pages, and do not submit any individual school address. Yandex: if it refuses the size, submit only `sitemap-hubs.xml` and tell me.

## Stage 3: look, then report (change nothing)

- Google Search Console > Indexing > Pages: note the counts for "Indexed", "Crawled - currently not indexed" and "Discovered - currently not indexed", and the sample reasons listed.
- Google Search Console > URL inspection: inspect `https://mayobebros.com/post/educational/results/necta-csee-results-2025/` and `https://mayobebros.com/results/csee/s0107/2025/`; report "URL is on Google" or not, the canonical Google chose, and whether "Crawl allowed" and "Indexing allowed" say Yes.
- Bing Webmaster Tools > Sitemaps: report the status of all submitted sitemaps.

## Report

Give me a table: search engine, sitemap address, status shown, pages discovered, any error text exactly as shown.
