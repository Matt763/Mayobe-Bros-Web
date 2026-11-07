# 404 Error Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `404.html` loses its hero and takes the old project's composition (big "404", round search badge, "Page not found", short text, a countdown card with a pulsing dot, "Go to homepage" and "Go back", then "Looking for something specific?" with category pills), drawn in this site's tokens inside the normal header and footer. The countdown is safe for accessibility, and a missing email-link page explains itself instead of sending the visitor away.

**Architecture:** `notFound()` in `scripts/lib/render.mjs` writes the whole page as plain HTML through `layout()`, so the header, footer, search dialog and dark mode stay as they are. Everything that needs JavaScript (the timer card, the email-link notice, "Go back") ships `hidden`. A new `js/notfound.js`, loaded only on this page and before `js/site.js`, reveals the right parts and runs the countdown. Styles are one `.nf-*` block in `css/style.css`.

**Tech Stack:** The static build (`scripts/build.mjs`, `scripts/lib/render.mjs`), plain ES5 browser JS in the style of `js/site.js`, hand-written CSS with the existing custom properties, `node:test` with a `node:vm` stub browser (pattern of `scripts/tests/newsletter-page.test.mjs`), the playwright-cli skill for the visual check.

**Spec:** The owner's request (verbatim): "the 404 error page it should not have a hero section it should appear the same way like on this previous project /run/media/mclean/New Volume/MY WEBSITE PROJECTS/Main.Mayobe.Bros". Also, following newsletter email links ended on this 404 page, so the page must be a clear, friendly, useful error page. The reference is `Main.Mayobe.Bros/src/pages/NotFoundPage.tsx`. It renders inside the old layout (`src/App.tsx`: `<Header />`, `<main>`, `<Footer />`), so the site header and footer stay. There is no separate design doc.

**Why the owner hit the 404:** the emails link to `https://mayobebros.com/newsletter/#c=…` / `#u=…` and `/manage/#l=…` / `#u=…`. Neither page exists on the live site: `main` has no `manage/` or `newsletter/`, and `/newsletter/` is built only when `newsletterAction` is `"api"`. This plan makes that dead end clear. The links themselves start working only when the branch is deployed.

## Global Constraints

- Node: `export PATH=$HOME/tools/node/bin:$PATH`. Plain JS, no new dependencies. Full suite: `node --no-warnings --test scripts/tests/*.test.mjs`. Record the green baseline before Task 1, after a plain `node scripts/build.mjs`.
- The working tree holds a local test build (`--api http://127.0.0.1:8787 --newsletter`): every generated page is modified, and `newsletter/` and `css/Mayobe AI` are untracked. Always rebuild with plain `node scripts/build.mjs` before testing or committing. That removes `newsletter/` through `.build-manifest.json`. Never stage `css/Mayobe AI` or `newsletter/`, and never use `git add -A`. Stage sources and tests by name, plus the regenerated tracked pages (the `style.css?v=` hash changes on every page). Commits are local only, never push.
- Generated files are never hand-edited (CLAUDE.md list; `404.html` is generated).
- No hero: no `<section class="hero`, no hero `<img>`, no `rel="preload" as="image"`, no "Error 404" kicker. The `heroFor('404')` call goes away.
- GitHub Pages serves `404.html` at whatever missing address was asked for (`/post/a/b/c/`, `/x%20y`). Every `href`, `src`, `srcset` and `action` in the page must be root-absolute through `u()`, so `basePath` keeps working. No relative paths.
- Keep `noindex, follow` (`noindex: true`), `adKind: 'notfound'` (in `NO_AD_PAGES`; `layout()` marks only `post` pages for ads), title "Page not found", the current description, and the canonical `/404.html`. Add `noReferrer: true`. Keep the analytics beacon, but `js/notfound.js` must load before `js/site.js` and before the beacon (see Task 2).
- Without JavaScript the page is complete: heading, text, "Go to homepage", the search form and the pills. No `<meta http-equiv="refresh">` (WCAG failure F41).
- Countdown: `SECONDS = 10`, ticks every 1000 ms, then `location.replace(BASE + '/')`. `replace`, not `assign`, so Back never lands on the 404 and bounces again. It runs only when all of these hold: JavaScript is on, `prefers-reduced-motion` is not `reduce`, the address has no query and no fragment, the navigation type is `navigate` (or the API is missing), the tab is visible, and the path is not an email-link path. A visible "Stop, stay on this page" button turns it off (WCAG 2.2.1, and 3.2.5 at AAA). The countdown also stops for good on any `keydown`, `pointerdown`, `wheel`, `touchstart` or `focusin`, on `visibilitychange` to hidden, on `pagehide`, and on a `pageshow` with `persisted`. The live region speaks once at the start and once on stop, never on each tick. Stopping the countdown also stops the pulsing dot (WCAG 2.2.2).
- Email-link paths: the path after `BASE` matches `/^\/(newsletter|manage)(\/|$)/`. These pages never redirect. If there is a query or fragment, the script first calls `history.replaceState(null, '', location.pathname)`, before anything else runs, so the link code never reaches GTM, the beacon or a Referer. Then it shows the notice.
- Copy (plain English, sentence case to match the site). Code: `<span class="sr-only">Error </span>404`. H1: "Page not found". Text: "We could not find the page you are looking for. It may have moved or been removed, or the address may be wrong." Timer: "Taking you to the home page in" / N / "seconds" ("second" at 1) / button "Stop, stay on this page". Stopped: "Automatic redirect stopped. Choose where to go below." Status at start: "This page will open the home page in 10 seconds. Press Stop to stay here." Status on stop: "Automatic redirect stopped." Notice title (`h2`): "This email link is not working right now". Notice text: "You opened a link from one of our emails, but the page it opens is not available at the moment. Nothing has been changed. Please try the link in the email again later. If it still does not work, email us at {config.contact.general} and tell us what you were trying to do." (mailto link). Buttons: "Go to homepage", "Go back". Section `h2`: "Looking for something specific?". Search: sr-only label "Search {config.name}", placeholder "Search articles", button "Search". Pills: each category's `name`, then "Popular posts", then "All posts".
- No newsletter wording in the page (CLAUDE.md: do not mention a newsletter until it exists). No latest-posts grid and no invented content. Pills come only from `categories` with `!c.empty`.
- CSS pitfalls: every new `@keyframes` name is unique (`nf-dot-pulse`; `pulse` is taken). The dot animates `opacity` only. Nothing puts a `transform`, `filter`, `contain` or `will-change` on `body` or `html`. Targets are at least 44 px tall.

## Review Focus

1. A screen-reader user in browse mode, where arrow keys never reach the page, has 10 seconds. Only Tab, a virtual click on Stop or leaving the tab stops the timer, so Stop must be the first control in `<main>` and the single start announcement must name it. (Task 1: `'the Stop button is the first control in <main>'`; Task 2: `'the live status is written once at the start, never on each tick'`)
2. A visitor who presses Back after the redirect, or reloads the 404, is not sent home again. (Task 2: `'reload, back/forward and a page restored from the back/forward cache: no countdown'`, plus the `replace` assertion)
3. An email link to a missing page (`/newsletter/#c=<code>`, `/manage/#l=<code>`) never leaks the code to GTM, the beacon or a Referer, and is never redirected. (Task 1: no-referrer; Task 2: replaceState-first test and script-order test)
4. The 404 served at a deep or odd path, or under a `basePath`, still loads its CSS, JS and logo, and every link works. (Task 1: basePath test; Task 3: `/post/a/b/c/` check)
5. A broken link opened in a background tab, or someone typing in the search box, is never redirected unseen or mid-typing. (Task 2: `'a tab that starts hidden never counts down; hiding the tab stops it'` and the any-interaction test)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/lib/render.mjs` (modify `notFound()` ~L970-995, `layout()` ~L328-353) | 404 markup; `meta.notFound` loads `js/notfound.js` before `js/site.js` |
| `css/style.css` (modify: delete the unused `.notfound*` rules ~L642-645, replace the `/* 404 page */` block ~L899-903) | the `.nf-*` styles |
| `js/notfound.js` (create) | email-link notice, "Go back", countdown and Stop |
| `scripts/build.mjs` (modify the `versions` map ~L292) | `?v=` hash for `js/notfound.js` |
| `scripts/tests/notfound.test.mjs` (create) | render checks, stub-browser checks, one built-file check |
| `CLAUDE.md` (modify) | short "The 404 page" section and the Behaviour row |
| `404.html` and every generated page (rebuilt) | new markup; the `style.css?v=` hash changes everywhere |

---

### Task 1: The page without JavaScript (markup, CSS, render tests)

**Files:** Modify `scripts/lib/render.mjs` (`notFound()`), `css/style.css`. Create `scripts/tests/notfound.test.mjs`.

**Interfaces:**
- Consumes: `layout`, `u`, `e`, `icon` (`'search'`, `'home'`, `'arrowLeft'`), `categories`, `config.contact.general`, `config.name` in `render.mjs`.
- Produces: `notFound(): string` (same name, same place in the returned object). Meta: `{ title: 'Page not found', description: 'The page you were looking for could not be found.', path: '/404.html', noindex: true, noReferrer: true, adKind: 'notfound' }`, with no `preload`. The DOM contract below is what Task 2 uses. Hooks are `data-nf-*`, and states start as shown:

```html
<section class="nf" data-nf><div class="wrap nf-in">
  <p class="nf-code"><span class="sr-only">Error </span>404</p>
  <span class="nf-badge" aria-hidden="true"><!-- icon('search', 44) --></span>
  <h1 class="nf-title">Page not found</h1>
  <p class="nf-text">…</p>
  <div class="nf-card nf-timer" data-nf-timer hidden>
    <p class="nf-timer-head"><span class="nf-dot" aria-hidden="true"></span><span data-nf-text tabindex="-1">Taking you to the home page in</span></p>
    <p class="nf-count" data-nf-count></p>
    <p class="nf-unit" data-nf-unit>seconds</p>
    <button class="btn btn-outline btn-sm" type="button" data-nf-stop>Stop, stay on this page</button>
  </div>
  <div class="nf-card nf-flow" data-nf-flow hidden><h2 class="nf-card-title">…</h2><p>…</p></div>
  <p class="sr-only" role="status" data-nf-status></p>
  <div class="nf-actions"><a class="btn btn-primary btn-lg" href="/"><!-- home icon --> Go to homepage</a><button class="btn btn-outline btn-lg" type="button" data-nf-back hidden><!-- arrowLeft --> Go back</button></div>
  <div class="nf-more"><h2 class="nf-more-title">Looking for something specific?</h2>
    <form class="nf-search" action="/search/" method="get" role="search">…label for="nf-q", input id="nf-q" name="q" type="search"…</form>
    <ul class="nf-links"><li><a class="chip" href="/category/<slug>/">Name</a></li>…<li>…/popular/…</li><li>…/post/…</li></ul>
  </div>
</div></section>
```

- [ ] **Step 1: Write the failing tests** in `scripts/tests/notfound.test.mjs`, rendering directly so they do not depend on the last build:

```js
const CATS = [
  { slug: 'educational', name: 'Education', labels: [], empty: false, image: 'assets/posts/a.webp' },
  { slug: 'world-histories', name: 'World Histories', labels: [], empty: true, image: '' },
];
function render404(over = {}, categories = CATS) {
  const config = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8')), ...over };
  return createRenderer({ config, categories, posts: [], pages: [], authors: [], versions: {} }).notFound();
}
const mainOf = (h) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
const ADDR = /\s(?:href|src|srcset|imagesrcset|action)="([^"]*)"/g;
```
  - `'404: no hero, one h1, the big 404, noindex and no-referrer, header and footer stay'`: no match for `/class="hero[\s"]/`, `/rel="preload" as="image"/` or `/Error 404<\/p>/`. Exactly one `<h1\b`, matching `<h1 class="nf-title">Page not found</h1>`. Matches `class="nf-code"><span class="sr-only">Error </span>404`, `<meta name="robots" content="noindex, follow">`, `<meta name="referrer" content="no-referrer">`, `<header class="site-header"` and `<footer class="site-footer"`.
  - `'404: pills are the categories with posts, then Popular posts and All posts'`: the hrefs inside `<ul class="nf-links">…</ul>` deep-equal `['/category/educational/', '/popular/', '/post/']`, and the text includes `>Education<`.
  - `'404: every address is root-absolute, also under a basePath'`: every `ADDR` value in `render404()` matches `/^(\/(?!\/)|https:\/\/|mailto:|#)/`. Every value in `render404({ basePath: '/repo' })` matches `/^(\/repo\/|https:\/\/|mailto:|#)/`.
  - `'404: without JavaScript nothing pretends to redirect'`: the opening tags carrying `data-nf-timer`, `data-nf-flow` and `data-nf-back` each contain ` hidden`. No match for `/http-equiv="refresh"/i`. Matches `<form class="nf-search" action="/search/" method="get" role="search">` and `href="/"[^>]*>[\s\S]*?Go to homepage`.
  - `'the Stop button is the first control in <main>'`: `mainOf(h).match(/<(a|button|input|select|textarea)\b[^>]*>/)[0]` matches `/data-nf-stop/`.
  - `'404: the email-link notice is generic and gives the contact address'`: `main` includes `This email link is not working right now`, `Nothing has been changed` and `href="mailto:<config.contact.general>"`, with no match for `/newsletter/i`.
  - `'404: no ads, even with AdSense switched on'`: with `{ adsense: { client: 'ca-pub-1234567890123456', autoAds: true, sidebarSlot: '1234567890' } }`, no match for `/data-ads="1"/` or `/adsbygoogle|data-ad-box/`.
- [ ] **Step 2: Run** `node --no-warnings --test scripts/tests/notfound.test.mjs`. Expect FAIL: the hero is still there and `nf-title` is missing.
- [ ] **Step 3: Rewrite `notFound()`** to the contract above with the copy from Global Constraints. Build the pills from `categories.filter((c) => !c.empty)`. Drop `catTile`, `grid` and `sectionHead` from this page, and drop the latest-posts section.
- [ ] **Step 4: CSS.** Delete the unused `.notfound`, `.notfound-code`, `.notfound h1` and `.notfound p` rules (first check that `grep -rn "notfound" js scripts/lib` shows only the `adKind` uses). Replace the `/* 404 page */` block with these sizes, which map from the Tailwind classes:
  - `.nf`: `background: linear-gradient(135deg, var(--bg-alt), var(--bg))`, `min-height: calc(100svh - var(--header-h))`, flex with centred items, `padding-block: clamp(2.5rem, 7vw, 5rem)`.
  - `.nf-in`: `max-width: 42rem; text-align: center`.
  - `.nf-code`: `clamp(4.5rem, 18vw, 8rem)`, weight 900, `line-height: 1`, `color: var(--link)`.
  - `.nf-badge`: round, `clamp(4rem, 10vw, 5rem)` square, `background: var(--soft)`, `color: var(--link)`, `margin: 0.75rem 0 1.25rem`.
  - `.nf-title`: `clamp(1.5rem, 4vw, 2.25rem)`, weight 900.
  - `.nf-text`: `color: var(--text-2); max-width: 28rem; margin: 0.75rem auto 2rem`.
  - `.nf-card`: `var(--surface)`, `1px solid var(--line-soft)`, `var(--radius-lg)`, `var(--shadow-lg)`, padding `clamp(1.5rem, 4vw, 2rem)`, `margin-bottom: 2rem`.
  - `.nf-timer-head`: inline-flex, gap `0.6rem`, weight 600.
  - `.nf-dot`: `0.75rem` round, `var(--btn-bg)`, `animation: nf-dot-pulse 2s ease-in-out infinite`, with `@keyframes nf-dot-pulse { 50% { opacity: 0.35; } }`. `.nf-timer.is-stopped .nf-dot` and the `prefers-reduced-motion: reduce` rule both set `animation: none`.
  - `.nf-count`: `clamp(2.25rem, 7vw, 3rem)`, weight 900, `var(--link)`, `font-variant-numeric: tabular-nums`.
  - `.nf-unit`: `var(--text-3)`, `0.9375rem`, margin-bottom `1rem`.
  - `.nf-actions`: flex-wrap, centred, gap `0.75rem 1rem`. At `max-width: 520px` the buttons are `width: 100%` (the old design stacks them on phones).
  - `.nf-more`: margin-top `clamp(2rem, 5vw, 3rem)`, padding-top `clamp(1.5rem, 4vw, 2rem)`, `border-top: 1px solid var(--line-soft)`.
  - `.nf-more-title`: `1rem`, weight 600, `var(--text-2)`.
  - `.nf-search`: keep the existing rules, with `margin: 1rem auto 1.25rem`.
  - `.nf-links`: flex-wrap, centred, gap `0.6rem`. `.nf-links .chip { min-height: 44px; }`.
- [ ] **Step 5: Run** the file and `grep -o "@keyframes [a-z0-9-]*" css/style.css | sort | uniq -d`. Expect PASS and empty output.
- [ ] **Step 6: Commit.** Run `node scripts/build.mjs` (plain) and the full suite (baseline + 7 passing). Stage `scripts/lib/render.mjs`, `css/style.css` and `scripts/tests/notfound.test.mjs` by name, plus the regenerated tracked pages. Message: `404 page: old layout without a hero, in the site's own design`.

---

### Task 2: `js/notfound.js` (countdown, Stop, email-link notice, Go back)

**Files:** Create `js/notfound.js`. Modify `scripts/lib/render.mjs` (`notFound()` meta gets `notFound: true`; `layout()`), `scripts/build.mjs` (`versions`). Add tests to `scripts/tests/notfound.test.mjs`.

**Interfaces:**
- Consumes: the Task 1 DOM contract, and `<html data-base>`.
- Produces: in `layout()`, when `meta.notFound`, `<script src="${assetUrl('js/notfound.js')}" defer></script>` comes before the `js/site.js` tag. Deferred and module scripts run in document order, so it runs before GTM (inserted by `site.js`) and before the beacon. `versions['js/notfound.js'] = hashFile('js/notfound.js')`. In `js/notfound.js`, an ES5 IIFE with `'use strict'`: `var SECONDS = 10`, `var FLOW = /^\/(newsletter|manage)(\/|$)/`, plus internal `start()` and `stop()`. `stop()` is idempotent: it clears the interval, removes the listeners, adds `is-stopped` to the timer card, hides `data-nf-count`, `data-nf-unit` and `data-nf-stop`, sets `data-nf-text` to the stopped copy, writes the stop status, and focuses `data-nf-text` if `document.activeElement` was the Stop button. The script never fetches, never stores anything, and never writes HTML (`textContent` only, so the path can never be injected).

- [ ] **Step 1: Write the failing tests.** Build a stub browser in the style of `newsletter-page.test.mjs`. `setup({ path = '/nope/', search = '', hash = '', base = '', reduce = false, navType = 'navigate', historyLength = 2, visibility = 'visible', active = null })` returns `{ log, nodes, fire(target, type, ev), tick(n) }`.
  - Nodes `box, timer, text, count, unit, stop, status, back, flow` are plain objects with `hidden`, `textContent`, `classList` (`add`, `contains`), `focus()` counter and `addEventListener`. `nodes.status` counts writes through a `textContent` setter.
  - `document`: `querySelector('[data-nf]')` returns `box`, and `box.querySelector('[data-nf-…]')` returns the node. It also has `addEventListener`, `removeEventListener`, `visibilityState`, `activeElement` and `documentElement.getAttribute('data-base')`.
  - `location`: `{ pathname, search, hash, replace: (u) => log.push(['replace', u]) }`.
  - `history`: `{ length, back: () => log.push(['back']), replaceState: (s, t, u) => log.push(['replaceState', u]) }`.
  - `window`: `{ matchMedia: (q) => ({ matches: reduce && /reduce/.test(q) }), addEventListener }`.
  - `performance`: `{ getEntriesByType: () => [{ type: navType }] }`.
  - Fake `setInterval`/`clearInterval`: assert the delay is `1000`. `tick(n)` calls the live callback n times.
  - Tests:
    - `'a plain missing page counts down from 10 and replaces the location with the home page'`: `timer.hidden === false` and `count.textContent === '10'`. After `tick(9)`: count `'1'`, unit `'second'`, no `replace`. After `tick(1)`: exactly one `['replace', '/']`.
    - `'the live status is written once at the start, never on each tick'`: after `tick(5)`, status writes `=== 1` and the text matches `/home page in 10 seconds\. Press Stop/`.
    - `'Stop, a key, a pointer, a wheel, a touch or focus stops it for good'`: for each of `stop click`, `keydown`, `pointerdown`, `wheel`, `touchstart`, `focusin` (document) run `tick(20)`. Expect no `replace`, `timer.classList.contains('is-stopped')`, `stop.hidden && count.hidden && unit.hidden`, and status `'Automatic redirect stopped.'`. For the click with `active: 'stop'` (so `document.activeElement` is `nodes.stop`), also expect `text.focused === 1`.
    - `'a tab that starts hidden never counts down; hiding the tab stops it'`: with `visibility: 'hidden'`, `timer.hidden` stays true. With a visible tab, setting it to hidden and firing `visibilitychange` then `tick(20)` gives no `replace`.
    - `'reduced motion, a query string or a fragment: no countdown'`: for `reduce: true`, `search: '?fbclid=x'` and `hash: '#part'`, `timer.hidden === true`, no interval is registered and there is no `replace`.
    - `'reload, back/forward and a page restored from the back/forward cache: no countdown'`: for `navType: 'reload'` and `'back_forward'`, the countdown is not started. For a running countdown, `fire(window, 'pageshow', { persisted: true })` then `tick(20)` gives no `replace`.
    - `'email-link paths show the notice, drop the code first and never redirect'`: each pair is `[path, fragment or query]`. For `['/newsletter/', '#c=' + 'A'.repeat(32)]`, `['/manage/', '#l=' + 'A'.repeat(32)]`, `['/manage/x/', '?t=1']` and `['/repo/newsletter/', '#u=x']` with `base: '/repo'`: `log[0]` deep-equals `['replaceState', path]`, `flow.hidden === false`, `timer.hidden === true`, and after `tick(20)` there is no `replace`. `'/newsletter'` with no hash shows the notice with no `replaceState`. `'/newsletters-old/'` counts down (boundary).
    - `'under a basePath the redirect goes to the base home'`: with `base: '/repo'` and `path: '/repo/nope/'`, `tick(10)` gives `['replace', '/repo/']`.
    - `'Go back appears only when there is a page to go back to'`: `historyLength: 1` leaves `back.hidden === true`. With `2` it is `false`, and a click logs `['back']`.
    - `'without the 404 markup the script does nothing'`: `querySelector` returns null. Expect no throw and an empty log.
    - `'the script never fetches, stores or writes HTML'`: the source has no match for `/\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|innerHTML|insertAdjacentHTML|document\.write/`.
  - Render and built-file tests:
    - `'404: notfound.js loads before site.js and before the analytics beacon'`: with `analytics: { cloudflareToken: 'a'.repeat(32) }`, `indexOf('js/notfound.js') < indexOf('js/site.js') < indexOf('cloudflareinsights')`.
    - `'other pages do not load notfound.js'`: `R.home()` has no match for `notfound\.js`.
    - `'the built 404.html loads notfound.js with a version and is in no sitemap'`: `404.html` matches `/js\/notfound\.js\?v=[a-f0-9]+/`, and `sitemap.xml` plus every `*-sitemap*.xml` has no match for `/404/`. Fail with "run node scripts/build.mjs first" if the file is missing.
- [ ] **Step 2: Run** the file. Expect FAIL: `js/notfound.js` is missing.
- [ ] **Step 3: Implement `js/notfound.js`.** Order on load:
  1. Find `[data-nf]`, or return.
  2. `BASE` from `data-base`. `rel` is `pathname` without a leading `BASE`.
  3. If `FLOW.test(rel)`: call `replaceState` when there is a search or hash, show `data-nf-flow`, wire Go back, return.
  4. Wire Go back: `history.length > 1` shows it, and a click calls `history.back()`.
  5. Return unless every countdown condition in Global Constraints holds.
  6. `start()`: show the card, set the count and unit, write the start status once, add the stop listeners (document, capture, `touchstart` passive), and start the 1000 ms interval.
- [ ] **Step 4: Wire it in:** `notFound: true` in the `notFound()` meta, the script tag in `layout()`, and the `versions` entry in `build.mjs`.
- [ ] **Step 5: Run** the file, then a plain `node scripts/build.mjs`, then the full suite. Expect PASS.
- [ ] **Step 6: Commit** `js/notfound.js`, `scripts/lib/render.mjs`, `scripts/build.mjs` and `scripts/tests/notfound.test.mjs`, plus the regenerated pages. Message: `404 page: accessible countdown with Stop, email-link notice, Go back`.

---

### Task 3: Visual and behaviour check in a real browser

**Files:** No source changes unless a check fails. Scratch files go only in `$HOME/.cache/mb-shots/404/` (never `/tmp`, never the repo).

**Interfaces:**
- Consumes: the built `404.html` from Tasks 1 and 2, and `scripts/serve.mjs`. It serves `404.html` with status 404 for any missing path. `content/`, `scripts/` and config files are also answered with the 404.
- Produces: screenshots and a short pass/fail list in the task report.

- [ ] **Step 1: Server.** `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/nope/` gives `404`, and `curl -s http://127.0.0.1:8000/nope/ | grep -c 'data-nf'` gives `1`. `curl … /newsletter/` gives `404` (the plain build removed the leftover folder). If nothing is listening, start `node scripts/serve.mjs` in the background.
- [ ] **Step 2: Browser.** Use the playwright-cli skill: `export PATH=$HOME/tools/node/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright`, `cd $HOME/.cache/mb-shots/404`, `playwright-cli open --browser=chromium`. Use `run-code --filename=…` scripts with a fresh context per case, and hardcode paths (there is no `process`).
- [ ] **Step 3: Screenshots** at widths 360, 768 and 1280, each with `colorScheme` `light` and `dark`, named `<w>-<theme>-<state>.png`:
  - `timer`: `/nope/`, taken about 1 s after load.
  - `stopped`: after clicking Stop.
  - `flow`: `/newsletter/#c=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.
  - Also at 360 light: `nojs` (context `javaScriptEnabled: false`) and `reduced` (`reducedMotion: 'reduce'`).
  - Read every file with the Read tool.
- [ ] **Step 4: Checks.** Each must print its expected value:
  - The composition order is 404, badge, title, text, card, buttons, rule, "Looking for something specific?", search, pills. It is centred, no wider than about 42rem, and has the site header and footer.
  - No horizontal scroll: `document.documentElement.scrollWidth <= innerWidth`.
  - `getComputedStyle(document.body).transform === 'none'`.
  - No console errors or `pageerror`.
  - At `flow`, `page.url()` ends with `/newsletter/` (the code is gone), the notice is shown and there is no timer. At 12 s the URL is unchanged.
  - Untouched `/nope/`: about 10.5 s after load the URL is `http://127.0.0.1:8000/`. Then `goto('/about/')`, `goto('/nope/')`, wait 11 s, `goBack()`: the URL is `/about/` (no bounce).
  - `/nope/?x=1`, `nojs` and `reduced`: no timer is visible and the URL is unchanged at 12 s. In `nojs`, Go back is not visible.
  - `/post/a/b/c/` is styled (`getComputedStyle(document.querySelector('.nf-badge')).borderRadius === '50%'`) and the logo `naturalWidth > 0`.
  - Keyboard: Tab once on `/nope/`. The card shows the stopped text and the focus ring is visible on the skip link.
  - Pills and buttons have `getBoundingClientRect().height >= 44`.
- [ ] **Step 5: Fix and repeat.** For any failure, fix CSS or JS, re-run `scripts/tests/notfound.test.mjs`, rebuild plain and take the screenshots again. Commit fixes only (`404 page: fixes from the browser check`). Delete any `.playwright-cli/` folder created inside the repo.

---

### Task 4: Docs

**Files:** Modify `CLAUDE.md`.

**Interfaces:**
- Consumes: the names from Tasks 1 and 2.
- Produces: documentation only.

- [ ] **Step 1: Add a "## The 404 page" section** after "Pages and pagination" (five or six lines). It is built by `notFound()` in `scripts/lib/render.mjs`, has no hero, and follows the old site's layout inside the normal header and footer. It is noindex, ad-free (`adKind: 'notfound'`), and every address is root-absolute because GitHub Pages serves it at any missing path. `js/notfound.js` (10 s countdown with Stop; no redirect with reduced motion, a query or fragment, reload, back/forward or a hidden tab) shows an email-link notice instead on `/newsletter/` and `/manage/`, after taking the link code out of the address. When a new page that email links open is added, add it to `FLOW` in `js/notfound.js`. Pills come from categories with posts.
- [ ] **Step 2: Extend the "Behaviour" row** of the "Do not hand-edit" table with `404 page countdown and email-link notice: js/notfound.js`.
- [ ] **Step 3: Verify:** full suite, `node scripts/build.mjs --check` and `node --no-warnings --test scripts/tests/share.test.mjs`. Report what ran and its result.
- [ ] **Step 4: Commit** `CLAUDE.md`. Message: `Docs: the 404 page`.
