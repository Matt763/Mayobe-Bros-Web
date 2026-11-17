# mayobe-results: the indexable results pages

A Cloudflare Worker on `mayobebros.com/results/*`. It renders the centre pages, centre overviews, A to Z lists, PSLE and SFNA region and
district hubs and the sitemaps from the files in the R2 bucket `mayobe-results-data`, and serves the same files to the browser app
at `/results/data/...`. The rest of the blog stays on GitHub Pages. Design: "Addendum 2026-11-10 (later)" in
`docs/superpowers/specs/2026-11-10-results-app-design.md`. Nothing here has been deployed or tested against a real Cloudflare
account: the code runs in Node with a folder standing in for R2 (`scripts/tests/results-worker.test.mjs`, `node scripts/serve.mjs`).

## Plans
Use **Workers Paid ($5 a month)** for production. The free plan has 10 ms of CPU per request and 100,000 requests a day shared with
crawlers and with the app's data downloads. A cold render of the largest centre (929 candidates) takes about 5 to 6 ms of plain
Node time here, but a first A to Z list also decodes a centre list of thousands of rows, so keep headroom. Pages are cached at the edge
for 30 days (`s-maxage`), so most requests never reach the code.

## Deploy (in this order)
1. Build the data on your computer: `node scripts/results-data.mjs` (it also writes `results-data/registry.json`, the list of exam-years the Worker needs).
2. Create the bucket (once): `npx wrangler r2 bucket create mayobe-results-data` (run in `results-worker/`, with `NODE_OPTIONS=--dns-result-order=ipv4first` and `XDG_CONFIG_HOME=$HOME/.config` as for the comments Worker).
3. Upload `results-data/` so the object names match the folder (`registry.json`, `csee-2024/meta.json`, `csee-2024/p0101.txt`, ...). Many small files: use rclone with an R2 remote (S3 API token from the Cloudflare dashboard, R2 > Manage API tokens):
   `rclone sync results-data/ r2:mayobe-results-data --progress --transfers 32 --checkers 32 --exclude ".*"`
   (`rclone config`: type s3, provider Cloudflare, endpoint `https://<account id>.r2.cloudflarestorage.com`.) Upload `registry.json` last: the Worker only knows about an exam-year once it is listed there.
4. Push the blog (it now contains `results-shell.html`, which the Worker fetches from `https://mayobebros.com/results-shell.html`). Check that address in a browser. If you set `resultsData.base` to `"/results/data"` in `site.config.json` the exam pages read their data from the Worker route too (no separate public bucket, no CORS).
5. Deploy: `cd results-worker && npx wrangler deploy`. `wrangler.jsonc` attaches the routes `mayobebros.com/results/*` and `mayobebros.com/results` (the zone must be on Cloudflare, already the case) and starts with `RESULTS_INDEX = "off"`.
6. Look at `https://mayobebros.com/results/csee/p0101/2024/`, `/results/csee/p0101/`, `/results/csee/2024/a/`, `/results/psle/2023/` and a wrong address (a real 404 with the site frame). With `off` every page says `noindex, nofollow` (meta tag and `X-Robots-Tag`) and the sitemaps answer 404.
7. In `site.config.json` set `"resultsData": { "pages": true }`, rebuild, push: the exam pages then link every centre to its Worker page.

## Turning indexing on (the owner decides)
Search engines see these pages only when `RESULTS_INDEX` is not `off`. Google's AdSense reviewers also see every indexable page; a section this size is judged as a whole (Google's scaled-content rules), so roll it out in waves and watch Search Console.
- `hubs`: centre overviews, A to Z lists, the year index and the PSLE and SFNA region and district hubs are indexable; centre-year pages stay `noindex, follow`.
- `all`: everything is indexable that passes the quality bar (a centre-year page needs at least 20 candidates who sat; the rest stay noindex and out of the sitemaps).
- `RESULTS_INDEX_FROM`: the first exam year that may be indexed (empty = all). Older years stay `noindex, follow` and out of the sitemaps. Suggested order: `hubs`; then `all` with `RESULTS_INDEX_FROM=2023`; then lower the year step by step while the Page indexing report stays healthy.
To change it: edit `RESULTS_INDEX` (and `RESULTS_INDEX_FROM`) in `wrangler.jsonc`, and `resultsData.index` in `site.config.json` (keep `index` the same in both: the blog uses its copy for the "Browse A to Z" links and for the `Sitemap:` line in robots.txt), run `wrangler deploy`, rebuild and push the blog. Cache keys include both switches, so old pages are not served with old robots rules.
Then, in Google Search Console and Bing Webmaster Tools, submit `https://mayobebros.com/sitemap.xml`, `https://mayobebros.com/results/sitemap-schools.xml` (every single school page) and `https://mayobebros.com/results/sitemap-hubs.xml` (year, A to Z and region lists). A sitemap index may not list another index, so the blog's sitemap does not list the Worker's; robots.txt names the two Worker indexes. `/results/sitemap.xml` holds both and is kept for tools, not submitted. For Bing also run `node scripts/indexnow-results.mjs --dry-run` and then once a day without `--dry-run` (10,000 addresses a wave).
What search engines get on a school page: its title ("Name, NECTA CSEE Results 2025 | Mayobe Bros"), a description built from its figures, its summary and subject table. **Never** a candidate number: the candidate list is fetched by the page's script from `/results/data/...`, which robots.txt closes to crawlers (and which sends `noindex`). `scripts/tests/results-seo.test.mjs` decodes real centres and fails if one number is in a page.

## New or changed data
Upload the changed files, then `registry.json` last. The cache key contains a signature of every exam's data key, so every page is rendered again after the registry changes (the Worker re-reads the registry every 5 minutes). Nothing to purge by hand. After a site deploy that changes the header or footer the shell signature changes in the same way.

## What to watch
Workers dashboard: requests, errors, CPU time (p99 should stay far under 30 s and, on the free plan, under 10 ms), R2 operations. Search Console: Pages report (soft 404, "crawled, not indexed" for these pages is normal at first), Crawl stats.

## Roll back
Remove the routes (Workers > mayobe-results > Settings > Domains and routes, or delete the `routes` block and redeploy): `/results/*` then answers from GitHub Pages with the site's normal 404. Set `resultsData.pages` back to `false` and push, so the exam pages stop linking to them. Nothing else depends on the Worker. `wrangler delete` removes it completely.

## Notes
- Caching uses the Cache API (`caches.default`) in code. Cloudflare's separate "Workers Cache" feature (`"cache": {"enabled": true}`) is documented as following the Worker rather than a zone, but its page does not say whether it works with route-attached Workers, so it is not enabled here.
- A Worker cannot fetch a path on its own route, so the shell is fetched from `/results-shell.html`, which the route does not match.
- Query strings are ignored (the cache key and the page are the same); the app may add `?cq=&grade=&cno=` on centre pages.
- English only; no candidate names or PREM numbers exist in the data. Pages carry `BreadcrumbList` and `WebPage` JSON-LD only.
