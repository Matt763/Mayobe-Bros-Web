# Reader growth plan for Mayobe Bros (written 2026-11-22)

Sources: three research reports (Google's own pages and staff statements, DataReportal and NECTA/TCU/HESLB pages, platform help pages) plus my own checks of the live site. Every item says how sure it is. Nothing here is a promise of traffic: a young site grows slowly, and Google decides what it indexes. Research gaps are listed at the end.

## 1. Where you stand
- Search Console: 31 pages indexed, 279 not (152 discovered not indexed, 26 crawled not indexed, **84 "blocked due to other 4xx"**, 11 soft 404). Web search, 3 months: 35 clicks, 992 impressions.
- The live sitemap holds 259 posts: about 150 real articles (135 of them dated November 2026) and 109 results-search posts with no article text. Plus about 590,000 school-result pages (indexable, in two sitemap indexes).
- AdSense: "Needs attention, Low value content". GA4 is working. Google's November core update started on 10 Nov and has no end date yet, so wait a week after it finishes before judging your numbers.
- My tests: 25 posts and about 60 school and hub pages all answered 200 to a Googlebot-style request. So the 84 "4xx" pages are not those; they are unknown.

## 2. What matters most, in order
1. **Find the 84 "4xx" URLs** (confidence high that this is worth doing). Google publishes no list of codes for that label. Google staff say CDN bot protection under heavy crawling can serve Googlebot 403, 404 or 410 (or a 200 "are you a bot" page). Check Cloudflare security events for Googlebot, and the results Worker's request count (Cloudflare's free Workers plan allows 100,000 requests a day, and errors lower the crawl rate of the whole host). Use Part G below.
2. **Make Google's picture of the site mostly your real articles** (confidence medium). Google staff said in July 2026 that when Google doubts a site's overall quality it crawls and indexes less, and that the fix is quality, not technical tricks. 590,000 table-style pages next to 150 articles is the biggest risk I can see. Google does not publish a safe ratio, and noindex does not save crawl time. The safest staged step: keep the pages live but list **only the best school pages** in sitemaps for now, link them from the results posts, and widen over time. You decide; this is the same choice as before (off, hubs only, all).
3. **Turn the 109 text-less results posts into real pages** (confidence medium). Add 150 to 250 words each (what the exam is, when results come out, how to read them, a link to the official NECTA page), or set them `noindex` until then.
4. **Link your best articles to each other** inside the text and from the home page (confidence medium; Google's own advice for faster discovery). Keep the main sitemap to canonical URLs with true `lastmod` dates (Google ignores `priority` and `changefreq`).
5. **Publish steadily, not in bursts** (my judgment, not a Google rule): 135 articles in one month looks like a batch. Aim for 3 to 5 good ones a week, each updated when facts change.
6. **Use "Request indexing" only on 5 to 10 flagship posts** (there is a quota and no guarantee).

## 3. Content calendar (Tanzania, from official dates where marked)
| When | Event | What to publish |
|---|---|---|
| Now to 27 Nov 2026 | CSEE exams (9 to 27 Nov) [official] | exam-week guides for parents and students |
| Early Dec | FTNA exams ended; Form One selection announced 4 Dec in 2025 [news] | "how to check Form One selection" explainer; update when TAMISEMI publishes |
| Early Jan 2027 | SFNA and FTNA results (10 Jan 2026 last year) [official list] | results guide, then how to read a school's grades |
| Late Jan 2027 | CSEE results (31 Jan 2026, 23 Jan 2025) [official list] | the biggest spike: prepare pages and a WhatsApp reminder in advance |
| Jun to Aug | HESLB application window (19 Jun to 31 Aug 2026) [official]; Form Five selection early June [news] | loan step-by-step, deadlines, mistakes to avoid |
| Early Jul | ACSEE results (6 Jul 2026) [official list] | results guide |
| Jul to Oct | TCU admission rounds (10 Jul to 10 Aug, 8 Sep, 6 Oct 2026) [official] | admission explainers |
| Early Nov | PSLE results (3 Nov 2026) [official list] | Standard Seven results and Form One next steps |
Always write "exam year" and "intake year" clearly: blogs mix "2026/2027". Dates marked [news] were not checked on the ministry notice, so confirm them before publishing.

## 4. Channels (one person, about 5 hours a week; my plan, untested)
- **Search (2 h):** one strong article or update a week, internal links, checking Search Console.
- **WhatsApp Channel (1 h):** 3 to 5 short posts a week, one image, one link each, with a UTM tag so GA4 shows it. Channels have no published post limit but Meta warns against low-quality updates. Do not buy followers or use number lists: WhatsApp bans bulk and automated messaging.
- **Facebook and Instagram (1 h):** carousels and short videos; put the link in the first comment or the profile (Meta has tested limiting link posts for Pages; reported, not official). Facebook and YouTube are about 38% of social referrals in Tanzania each (StatCounter, Oct 2026).
- **Newsletter (0.5 h):** you already have it. Put a free checklist PDF behind the sign-up, and a "tell me when results are out" option. Email and RSS survive platform blocks (X has been blocked on several networks since May 2025, and WhatsApp and others were restricted after October 2025, per NetBlocks and OONI).
- **YouTube (later):** Shorts do not carry clickable links in descriptions; use a channel link and end screens.
- **Skip:** Opera, Phoenix, UC, Yahoo, Apple News and paid "traffic" sellers (see the earlier notes). X is weak for links and blocked in places.
- **Web push** is possible (Android Chrome fine, iPhone only from the Home Screen) but Chrome removes permission from low-engagement sites that send too often. Consider it after January, not now.

## 5. What each side does
- **Claude Code (repo):** internal links, text for the results posts, `noindex` or sitemap changes, share cards for WhatsApp, newsletter placement, a results-day page, the Preferred sources link (done).
- **You:** the weekly posting routine, WhatsApp and Facebook, replying to comments, and asking TCRA whether the Tanzania news pages need a licence (the Daily News reported in October 2025 that online news providers do; educational content is said to be exempt). I am not a lawyer.
- **Extension:** read-only diagnostics in Part G.

## 6. Numbers to watch weekly
Indexed pages and the 4xx count (Search Console); clicks, impressions and average position; top 10 queries; GA4 users by source (Search, WhatsApp, Facebook, direct); newsletter sign-ups and unsubscribes; WhatsApp channel followers; Cloudflare Web Analytics visits (the all-visitor count, since GA4 counts only visitors who accept cookies). I found no credible growth rates for a new site at 3, 6 or 12 months, so set your own baseline this week.

## 7. Not verified
Swahili versus English search share and exact phrases (no data found); Tanzania YouTube, TikTok and WhatsApp user counts; whether a blog counts as a "publisher" for Facebook's link limit; official rules on staged rollout of programmatic pages; the ministry notices for school calendars; current status of platform blocks in Tanzania; the Cloudflare error codes for Worker limits.

## Part G: extension prompt (read only). Paste the Rules block from `docs/analytics-setup-prompt.md` first.
```
<goal>
Collect facts about why Google does not index many pages of https://mayobebros.com. Read only. Change nothing.
</goal>

<steps>
1. In Google Search Console (domain property mayobebros.com) open Indexing > Pages. For each reason (Blocked due to other 4xx issue, Soft 404, Discovered - currently not indexed, Crawled - currently not indexed, Page with redirect, Not found (404), Alternate page with proper canonical tag) open the reason and copy the first 10 example URLs shown, with the "Last crawled" date. Do not click "Validate fix".
2. For the first 3 "Blocked due to other 4xx issue" URLs, use URL inspection (not "Request indexing") and report: the page fetch status text, the crawl date, and the response code if shown.
3. Open Indexing > Sitemaps. For every submitted sitemap report: address, type, last read date, status, discovered pages.
4. Open Settings > Crawl stats. Report: total crawl requests, total download size, average response time for the last 90 days, the "By response" list with each code and its count, and the "Host status" lines.
5. Open https://dash.cloudflare.com (zone mayobebros.com). Open Security > Events. Filter for the last 7 days and for user agent containing "Googlebot". Report: the number of events, the actions taken (block, managed challenge, JS challenge, allow), and the rule names. Then open Workers & Pages, the Worker that serves /results/*, and report: the plan shown (Free or Paid), requests and errors for the last 7 days, and any error 1027 or 1102 counts.
6. Do not edit any rule, setting, route or Worker.
</steps>

<report>
One table per step, values exactly as shown, then three lines: which codes appear in Crawl stats, whether Googlebot is being challenged or blocked, and whether the Worker is on the Free plan.
</report>
```
