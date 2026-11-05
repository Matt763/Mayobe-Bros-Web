# Going live on mayobebros.com (GitHub Pages + Spaceship + Cloudflare)

Do the steps in this order. Steps 1 to 3 take the site live. Step 4 turns on comments and reactions. Steps 5 and 6 are Google.
Times and costs: GitHub Pages and Cloudflare Workers/D1 are free at this site's size.

> Safe order for a site that is already live on Vercel: put the files on GitHub first (step 1), check them at the
> `github.io` address, verify the domain (step 2), and only then switch DNS (step 3). The old site keeps working until step 3.

## 1. Put the site on GitHub

1. On github.com create a **public** repository, for example `mayobebros-site` (GitHub Free needs a public repo for Pages). No README, no licence.
2. In this folder:
   ```bash
   cd "/run/media/mclean/New Volume/my-site"
   git init -b main
   git add -A
   git commit -m "Mayobe Bros static site"
   git remote add origin https://github.com/<your-username>/mayobebros-site.git
   git push -u origin main
   ```
   `.gitignore` already keeps secrets out (`.admin-token`, `.env`). The repository is about 35 MB. The folder `worker/`, `scripts/` and `content/` are public too, which is fine, because they contain no secrets.
3. Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
4. After a minute the site opens at `https://<your-username>.github.io/mayobebros-site/`. (Its links will look odd there because it is built for the real domain. Check the real domain after step 3.)

## 2. Verify the domain with GitHub (prevents domain takeover)

1. GitHub profile photo → **Settings → Pages → Add a domain** → `mayobebros.com`.
2. GitHub shows a TXT record named `_github-pages-challenge-<username>` with a value.
3. In Spaceship (below) add that TXT record. Back on GitHub choose *Continue verifying → Verify*. Keep the record permanently.

## 3. Point the domain at GitHub (Spaceship DNS)

The repository already contains a `CNAME` file with `mayobebros.com`.

In Spaceship: **Domain list → mayobebros.com → Advanced DNS Manager → DNS records → Custom records**. The domain must use Spaceship's default nameservers.

1. **Take a screenshot of the current records first.**
2. Lower the TTL of the current records to the shortest option a day before, if you can.
3. **Delete** the Vercel records: the `A` record on `@` (usually `76.76.21.21`), the `www` CNAME (`cname.vercel-dns.com`), and any `AAAA` or `ALIAS` record on `@`.
4. **Add four `A` records**, Host `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
5. Optional, **four `AAAA` records**, Host `@`: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`.
6. **Add a `CNAME`**, Host `www`, value `<your-username>.github.io` (no trailing dot, no repository name).
7. **Do not touch** MX, TXT (SPF, DKIM, DMARC) or any other mail record, so `info@mayobebros.com` keeps working.
8. Back in repository **Settings → Pages**: custom domain `mayobebros.com`. When GitHub shows the DNS check as green, tick **Enforce HTTPS** (the certificate can take from a few minutes up to an hour).
9. Test `https://mayobebros.com/`, `https://www.mayobebros.com/` (redirects to the first), a post address, and send and receive a test email. Keep the Vercel project for a few days, then remove the domain from Vercel.

Check from a terminal: `dig mayobebros.com A +short` should list the four GitHub addresses.
Old post addresses keep working: renamed posts redirect to their new address, and `/post/<category>/<slug>/` redirects to the full address.

## 4. Turn on comments and reactions (Cloudflare, about 10 minutes)

Follow `worker/README.md`. In short: `wrangler login`, create the D1 database, apply the migration, set two secrets,
`wrangler deploy`, then paste the printed address into `commentsApi` in `site.config.json`, run `node scripts/build.mjs`, commit and push.
Until you do this, comments and reactions are hidden (the site never shows a broken box).

## 5. Search engines (Google, Bing, Yahoo, DuckDuckGo, Yandex)

Full explanation and the reasons are in `docs/search-engines.md`. In short, after the site is live:

1. **Google Search Console**: add the *Domain* property `mayobebros.com`, verify with the DNS TXT record (Spaceship), submit `sitemap.xml`,
   then URL Inspection > Request indexing for the home page and two posts. `sitemap.xml` is an index of `pages-`, `posts-`, `category-`, `label-`, `image-` and `video-sitemap1.xml` (the number goes up after 200 addresses per file, `sitemapUrlsPerFile` in `site.config.json`). Submit only `sitemap.xml`; Google finds the rest. If Google still lists old sitemap names from the previous host, they now exist again, so leave them.
2. **Bing Webmaster Tools** (Yahoo and DuckDuckGo get their results from Bing): import from Search Console, or verify with the meta tag by putting its
   value in `site.config.json` > `verification.bing`, then rebuild and push. Submit `sitemap.xml`.
3. **Yandex Webmaster**: add `https://mayobebros.com` (the verification file and tag are already in place), submit `sitemap.xml`.
4. **IndexNow**: after each push has gone live run `node scripts/indexnow.mjs` (it sends only new, changed or removed pages to Bing, Yandex and the
   others). The key file is already in the site root.

## 6. Google AdSense

Do not apply until the checklist is done:

- [ ] The site is live on `https://mayobebros.com` with HTTPS and has been for at least a few days.
- [ ] `"showEmptyTopics": false` in `site.config.json` (hides the "coming soon" categories and labels), rebuilt and pushed.
- [ ] Fill `docs/image-sources.md` and replace any picture you cannot prove you may use.
- [ ] 20 to 30 original posts. There are 17 now. Keep adding useful posts (use `docs/writing-guide.md`).
- [ ] Your real author name and bio are in `site.config.json`. Read the About page and the policy pages and correct anything that is not true for you.
- [ ] You own, or are licensed to use, every picture. (The 183 pictures came from your old Supabase storage; see the notes in the hand-off message.)
- [ ] Comments are on and you are moderating them.

Then in AdSense: *Sites → Add site → mayobebros.com*. Verification is already in place (`ads.txt` with your publisher ID and the
`google-adsense-account` meta tag). When AdSense approves the site, set `"autoAds": true` in `site.config.json`, rebuild and push.
Ads then load only after a visitor accepts cookies, and only on article pages.

**The labelled ad in the article sidebar** (optional, after approval): in AdSense go to *Ads → By ad unit → Display ads*, make a unit called
"Article sidebar" (responsive), and copy only the number from `data-ad-slot="1234567890"` into `"sidebarSlot"` in `site.config.json`. Rebuild and push.
Until both `"autoAds": true` and a `sidebarSlot` are set, nothing about the ad is in the page: no empty box, no "Advertisements" label. When on, it shows
only to visitors who pressed Accept, sits between "More like this" and "Topics" with a small "Advertisements" label (Google allows only that word or
"Sponsored Links"), and disappears again if no ad comes back or an ad blocker stops it. Do not make it sticky or put buttons next to it: Google counts
accidental clicks as a violation. Leave Google's own *Auto ads* off for the sidebar area if they place a second ad next to it (AdSense → Sites → Ads → Auto ads). For visitors in the EEA, UK and Switzerland, set up Google's
*Privacy & messaging* consent message in AdSense, as the Privacy Policy promises. The site's own banner has Accept and Reject with equal weight; Google's certified message is required for visitors in the EEA, UK and Switzerland before personalised ads.
- Tanzania's Personal Data Protection Act requires organisations that handle personal data to register with the Personal Data Protection Commission. Check whether this applies to you and add your registration details to the Privacy Policy if it does.

## Safety notes

- The old project folder (`Main.Mayobe.Bros`) contains a `.env` file with live keys (Supabase service role, Anthropic, GitHub, Vercel, Resend, Pesapal) and its `README.md` shows an admin email and password. **Rotate or delete those keys and change that password** now that the old site is being retired. Never copy that `.env` into this repository.
- Back up comments from time to time: `npx wrangler d1 export mayobe-engage --remote --output backup.sql` (from `worker/`).
