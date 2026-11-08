# Smooth Pagination Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every in-place page change on the site works the same way: page numbers on lists, the 404 "Posts you may be interested in" pager, search "Show more results", home "Show more posts" and "Show more comments". Each one fades out, glides the page smoothly to the new content (no blur, no sudden jump), and lets the new cards rise in one after another. It stays fast, accessible and stable (no CLS).

**Architecture:** One small shared script, `js/motion.js`, exposes `window.MBMotion`. It holds the pure math (easing, duration, trip plan), a custom `requestAnimationFrame` scroll glide that the reader can interrupt, and three CSS-class states (`mo-wait`, `mo-leave`, `mo-enter`) drawn by keyframes in `css/style.css`. `js/pager.js`, `js/notfound-posts.js`, `js/site.js` and `js/engage.js` call it instead of native smooth scrolling. If it is missing, each one falls back to an instant swap.

**Tech Stack:** Plain ES5 browser JS (IIFE, `'use strict'`, the style of `js/site.js`), hand-written CSS with the existing tokens (`--ease`), the static build (`scripts/build.mjs`, `scripts/lib/render.mjs`), `node:test` with a `node:vm` stub browser (pattern of `scripts/tests/notfound.test.mjs`), and the playwright-cli skill with Chromium for frame-by-frame checks.

**Spec:** The owner's request (verbatim): "in whole website on pagenation create a beautifull smooth animation scroll, after a user has clicked a button it takes a user suddenly but i want you now to create these smooth animation styles to enable users feel luxurious pagenation change without been skipped as current how it works, use ultrathink, subagents and go online for best way to do this task." There is no separate design doc. The measurements and research below are the design input.

## What happens today (measured 2026-11-07, Chromium, `node scripts/serve.mjs`)

Clicking "Older" with the pager at the bottom of `/post/`, sampled every animation frame:
- 0 to 240 ms: the cards fade out in place. The pager highlights the new number at once and pulses.
- About 240 ms: the cards are swapped. Then `grid.scrollIntoView({ behavior: 'smooth' })` hands the scroll to the browser. Desktop (1280 x 800) travels 2,390 px in about 840 ms, with a peak of **11.9 px/ms**. Phone (390 x 800) travels 7,660 px in about 1,470 ms, with a peak of **22 px/ms** (1,100 px between two samples). This velocity spike is the "sudden" feeling. The new cards finish their entrance (0.55 s) before the top of the list arrives, so the reader sees a blur of finished cards.
- Where it lands: the grid top ends 182 px from the top of the viewport. That is 26 px under the 156 px desktop header, but **115 px of empty space** under the 67 px phone header, because `html { scroll-padding-top }` uses the fixed `--header-h: 9.875rem`.
- Focus stays on "Older" at the bottom of the page, now off-screen. The page text is announced twice: once by the `.pagination-note` live region and once by `announce()`.
- The `min-height` animation does nothing when both pages have 15 cards.
- Back after that: the browser first restores the old scroll position (680 to 1,798 px, smooth, because `html { scroll-behavior: smooth }`), then pager.js scrolls back to 680 px. That is a **1,100 px yo-yo**.
- 404 pager (`js/notfound-posts.js`): the cards are replaced with **no fade at all**, then a native smooth scroll of 1,245 px in about 550 ms. Focus goes to the current page number, which ends up off-screen.
- Search "Show more results": the results appear with no entrance. `firstNew.focus({ preventScroll: false })` lets the browser scroll. In Chrome, `focus()` on an off-screen link with `scroll-behavior: smooth` made a native smooth scroll of 0 to 5,962 px in about 600 ms.
- "Show more comments" (`js/engage.js`) re-renders the whole list, so every existing comment replays its `rise` animation (flash).
- A programmatic focus after a mouse click does not show the focus ring (`:focus-visible` false). After a keypress it does. So moving focus to a card shows no ring to mouse users.

## Research and decisions (sources opened 2026-11-07)

- **Custom glide, not native smooth scroll.** `ScrollToOptions` has no duration or easing, and long native smooth scrolls run either very fast or very long ([WICG: extending ScrollOptions with duration](https://discourse.wicg.io/t/extending-scrolloptions-to-include-duration/4303); the same thread warns that very fast scrolling can approach the three-flashes threshold). `behavior: 'auto'` follows CSS `scroll-behavior` ([MDN scrollTo](https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollTo)), so while gliding, `html.mo-gliding` forces `scroll-behavior: auto` and the glide calls the two-argument `scrollTo(0, y)` (no reliance on the `'instant'` value).
- **Timing.** Most UI motion belongs in 100 to 500 ms, with about 400 ms for big moves across large screens, and "At 500ms, animations start to feel like a real drag" ([NN/g, Animation duration](https://www.nngroup.com/articles/animation-duration/)). Exits are shorter than entrances. Easing is `easeInOutCubic`: `x < 0.5 ? 4x³ : 1 − (−2x + 2)³ / 2` ([easings.net source](https://github.com/ai/easings.net/blob/master/src/easings/easingsFunctions.ts)). Its peak speed is 3 times the average, so the visible part of a trip is capped at 0.8 of a screen. Anything farther is jumped while the cards are invisible ("covered").
- **CLS.** Shifts within 500 ms of a discrete input are excluded (`hadRecentInput`). New elements and `transform` animations do not count, but scrolls are not "recent input" ([web.dev CLS](https://web.dev/articles/cls)). So: animate only `opacity` and `transform`, do the swap in one task, and drop the `min-height` height animation.
- **INP.** It measures only until the next paint after the handlers run ([web.dev INP](https://web.dev/articles/inp)). The click handler only toggles classes. Fetching, parsing and swapping happen later. Animations use compositor-friendly properties and no `will-change` ([web.dev animations guide](https://web.dev/articles/animations-guide)).
- **No same-document View Transitions for these swaps.** They are Baseline since Firefox 144 and Safari 18 ([web.dev, Oct 2025](https://web.dev/blog/web-platform-10-2025); [Chrome: view transitions in 2025](https://developer.chrome.com/blog/view-transitions-in-2025)). But the snapshot fills the viewport, the page is frozen while the update callback runs, and network work must happen before the call ([Chrome: same-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)). A glide cannot run inside it. The existing cross-document `@view-transition { navigation: auto; }` stays for normal page loads and the no-JS path.
- **Focus.** Moving focus to the top of the new list is "a reasonable approach". It keeps keyboard and screen-reader users from going backwards, and the focus target needs a name ([tempertemper, 2025](https://www.tempertemper.net/blog/should-pagination-take-you-to-a-new-page)). eBay keeps focus on the control but does not scroll the page ([eBay pagination accessibility](https://opensource.ebay.com/evo-web/components/pagination/accessibility)). Here the viewport moves, so focus follows it to the first new card link (its name is the article title). The existing `.pagination-note` live region says the page number once.
- **Reduced motion.** WCAG 2.3.3 (AAA) says interaction-triggered motion can be turned off, and C39 is the `prefers-reduced-motion` technique ([W3C Understanding 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)). Reduced motion means an instant swap, one instant jump if one is needed, and the same focus and announcement.
- **Scroll anchoring and restoration.** `overflow-anchor` is now Baseline 2026 ([MDN overflow-anchor](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor)), so the glide switches anchoring off while it runs. `history.scrollRestoration` belongs to the active session history entry (HTML spec, History interface). Measured in Chromium: entries created by `pushState` copy it. pager.js sets it to `manual` while it owns the entries and back to `auto` on `pagehide` ([MDN scrollRestoration](https://developer.mozilla.org/en-US/docs/Web/API/History/scrollRestoration)).
- **iOS Safari.** Writing the scroll position during momentum scrolling has a long bug history ([WebKit 187449](https://bugs.webkit.org/show_bug.cgi?id=187449); [WebKit 262287](https://bugs.webkit.org/show_bug.cgi?id=262287), a render failure after interrupting momentum, fixed 2026-02-25). The glide starts only after a tap or click, and any `touchstart` stops it.
- **Not used:** `interpolate-size` (Chromium-only in [Chrome's docs](https://developer.chrome.com/docs/css-ui/animate-to-height-auto)), FLIP (cards are replaced, not reordered), libraries. How big editorial sites (Apple Newsroom, NYT, Stripe) animate their lists could not be confirmed from first-party sources, so nothing here relies on it.

## Global Constraints

- Node: `export PATH=$HOME/tools/node/bin:$PATH`. No new dependencies, no library. Full suite: `node --no-warnings --test scripts/tests/*.test.mjs`. Record the green baseline after a plain `node scripts/build.mjs`, before Task 1.
- The working tree holds a local test build (`--api … --newsletter`). Every generated page is modified, and `newsletter/` and `css/Mayobe AI` are untracked. Rebuild with plain `node scripts/build.mjs` before testing or committing. Never stage `css/Mayobe AI` or `newsletter/`, and never `git add -A`. Stage sources and tests by name, plus the regenerated tracked pages (the `?v=` hashes change everywhere). Commits stay local; never push.
- Generated files are never hand-edited (see the CLAUDE.md list).
- Motion values (all in `js/motion.js` constants and `css/style.css`): `LEAVE_MS = 160`; enter `400 ms` with `var(--ease)`; stagger `35 ms`, index capped at `6`; glide `easeInOutCubic`, duration `clamp(round(180 + 0.42·|d|), 260, 520)` ms and `0` when `|d| < 2`; visible trip at most `round(0.8 × innerHeight)` (the rest is jumped only when the caller says `covered`); landing `16 px` under the real bottom of `.site-header`; slow-load dim to opacity `0.5` after a `150 ms` delay; the glide stops on `wheel`, `touchstart`, `pointerdown` and `keydown`.
- Never use native smooth scrolling in these flows. `html { scroll-behavior: smooth }` makes every `scrollTo`, `scrollIntoView` and `focus()` without `preventScroll` smooth. Every `focus()` in these flows passes `{ preventScroll: true }`.
- CSS: keyframe names are unique (`mo-in`, `mo-out`, `mo-dim`). Animate only `opacity` and `transform`. No `will-change`. The only new class on `<html>` is `mo-gliding`, and it sets only `scroll-behavior: auto !important; overflow-anchor: none`. Nothing puts a `transform`, `filter`, `contain` or `will-change` on `html` or `body`.
- The three states are CSS **animations**, not transitions. Animation values beat the reveal system's normal declarations (`.js-ready [data-reveal-stagger] > *`) with no specificity fight. `mo-out` starts from `var(--mo-from, 1)`, so a dimmed card does not flash back to full opacity.
- No storage, no cookies, no network in `js/motion.js` (the Cookie Policy stays as it is). No `innerHTML`.
- Without JavaScript the links stay plain links (unchanged). Without `window.MBMotion`, each consumer swaps instantly and uses `el.scrollIntoView({ block: 'start' })`.
- One announcement per change. pager.js page swaps rely on the existing `.pagination-note` (`role="status"`). The 404 keeps `[data-nf-pager-status]`.

## Review Focus

1. Fast repeated clicks, or a click while a glide runs: the last request wins. The grid is never half-swapped. No `mo-leave`, `mo-wait`, `mo-gliding`, `is-paging` or `is-pressed` class is left behind, and a new glide cancels the running one. (Task 1: `'a new glide cancels the one in flight'`; Task 2 browser case `fast-clicks`; Task 3: `'posts: fast clicks: the last page asked for wins'`)
2. Back/Forward: no yo-yo and no double scroll. A cross-document Back from a post to `/post/page/2/` still restores the reader's position. (Task 2 cases `post-back` and `post-article-back`)
3. Reduced motion, keyboard and screen reader: instant swap, focus on the first new card (ring only after keyboard use), one announcement, focus never left off-screen in the pager. (Task 1: `'reduced motion: …'`; Task 4 cases `reduced` and `keyboard`)
4. CLS and INP on a weak phone: layout shift without recent input stays under 0.01. With the CPU throttled 4 times the click's Event Timing duration stays under 100 ms. On a slow connection the old cards stay (dimmed), never a blank grid. (Task 2 case `post-slow`; Task 4 `layout-shift` and `inp` checks)
5. Touch and iOS Safari: a finger on the screen during the glide stops it where it is. Scroll anchoring does not fight the glide. The toolbar resize does not leave the list under the header. (Task 1: `'a wheel, touch, pointer press or key stops the glide where it is'`; Task 4 case `touch`; owner check on a real iPhone, listed in Task 4)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `js/motion.js` (create) | `window.MBMotion`: math, glide, wait/leave/enter states |
| `css/style.css` (modify: new block at the end; delete the two `[data-reveal-stagger].is-leaving/.is-entering` rules ~L1146-1150) | `mo-*` states, keyframes, `html.mo-gliding`, `.is-pressed`, reduced-motion switch |
| `scripts/lib/render.mjs` (`layout()` ~L343) | `js/motion.js` script tag on every page, first |
| `scripts/build.mjs` (`versions` ~L302) | `?v=` hash for `js/motion.js` |
| `js/pager.js` (modify) | lists: wait, leave, swap, covered glide, focus, scroll restoration; category/label switch glides to the page top |
| `js/notfound-posts.js` (modify) | 404 pager: leave, swap, enter, glide, focus |
| `js/site.js` (modify `showNext` ~L226 and the "Latest posts" block ~L987) | search "Show more results" and home "Show more posts" |
| `js/engage.js` (modify `renderComments` ~L414) | "Show more comments" appends only the new batch, then glides |
| `scripts/tests/motion.test.mjs` (create) | module unit tests, CSS checks, render check, source guards |
| `scripts/tests/notfound.test.mjs` (modify the posts tests ~L295-420) | the 404 pager with the motion stub |
| `CLAUDE.md` (modify) | "Pages and pagination", CSS pitfalls, Behaviour row |

---

### Task 1: `js/motion.js`, its CSS and its tests

**Files:** Create `js/motion.js`, `scripts/tests/motion.test.mjs`. Modify `css/style.css` (end of file), `scripts/lib/render.mjs` (`layout()`), `scripts/build.mjs` (`versions`).

**Interfaces:**
- Consumes: nothing.
- Produces: `window.MBMotion` (ES5 IIFE, reads `window`, `document`, `setTimeout`, `requestAnimationFrame` and `getComputedStyle` at call time):
  - `easeInOutCubic(t: number): number`, with `t` clamped to [0, 1].
  - `glideDuration(distance: number): number`, from the formula in Global Constraints.
  - `planGlide(from: number, to: number, viewportH: number, covered: boolean): { jumpTo: number|null, start: number, to: number, duration: number }`. With `max = round(0.8·viewportH)`, `jumpTo = to + sign(from − to)·max` only when `covered && |from − to| > max`. `start = jumpTo ?? from`. `duration = glideDuration(to − start)`.
  - `prefersReduced(): boolean`, which reads `matchMedia('(prefers-reduced-motion: reduce)')` on every call.
  - `headerBottom(): number`: `max(0, round(.site-header bottom))`, or 0 when the header is missing.
  - `topOf(el: Element, gap = 16): number`: `max(0, round(rect.top + scrollY − headerBottom() − gap))`.
  - `glide(to: number, opts?: { covered?: boolean }): Promise<'done'|'cancelled'|'instant'|'none'>`. It clamps `to` to `[0, scrollHeight − innerHeight]`, reading the geometry once at the start. It resolves `'none'` when the trip is under 2 px. With reduced motion it makes one `scrollTo(0, to)` and resolves `'instant'`. Otherwise it adds `mo-gliding` to `<html>`, makes the cover jump if planned, then uses rAF frames (`t0` = the first frame's timestamp) and `scrollTo(0, round(y))`. It listens for `wheel`, `touchstart`, `pointerdown` and `keydown` on `window` (capture, passive). A later `glide()` cancels this one. Every exit removes the class and the listeners.
  - `wait(box: Element, on: boolean): void`: toggles `mo-wait`.
  - `leave(box: Element): Promise<void>`. Without reduced motion it sets `--mo-from` on `box` from the first child's computed opacity, swaps `mo-wait` for `mo-leave` and resolves after `LEAVE_MS`. With reduced motion it removes `mo-wait` and resolves at once.
  - `enter(nodes: ArrayLike<Element>, box?: Element): void`. It removes `mo-leave`, `mo-wait` and `--mo-from` from `box`. Without reduced motion, each node gets `--mo-i = min(i, 6)` and `mo-enter`, which is removed on that node's `animationend` for `mo-in` or after a 1000 ms fallback.
  - Constants on the object: `LEAVE_MS`, `GAP` (16).
- CSS (end of `css/style.css`, one commented block): `html.mo-gliding { scroll-behavior: auto !important; overflow-anchor: none; }` · `.mo-wait > * { animation: mo-dim 0.3s ease 0.15s both; }` · `.mo-leave > * { animation: mo-out 0.16s ease-in both; }` · `.mo-enter { animation: mo-in 0.4s var(--ease) both; animation-delay: calc(var(--mo-i, 0) * 35ms); }` · `@keyframes mo-dim { to { opacity: 0.5; } }` · `@keyframes mo-out { from { opacity: var(--mo-from, 1); } to { opacity: 0; transform: translateY(-10px); } }` · `@keyframes mo-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }` · `.page-num.is-pressed, .page-btn.is-pressed { transform: scale(0.96); }` · `@media (prefers-reduced-motion: reduce) { .mo-wait > *, .mo-leave > *, .mo-enter { animation: none !important; } }`.
- `layout()`: `<script src="${assetUrl('js/motion.js')}" defer></script>` is the first script tag on every page (before `js/notfound.js`, `js/site.js` and the rest). `versions['js/motion.js'] = hashFile('js/motion.js')`.

- [ ] **Step 1: Write the failing tests** in `scripts/tests/motion.test.mjs`. `load({ reduce = false, scrollY = 0, innerHeight = 800, scrollHeight = 10000, header = 67 })` runs the source in `vm` with `ctx.window = ctx`. It returns `{ M, calls /* scrollTo ys */, frames(n, step = 16), fire(type), listeners(), html /* classList stub */, timers }`. rAF is queued and `frames()` calls each callback with an increasing timestamp. `fire` calls the window listeners registered for that type.
  - `'easing: 0 at 0, 1 at 1, 0.5 in the middle, never backwards'`: exact values at 0, 0.5 and 1. `easeInOutCubic(0.25) === 0.0625`. `(-1) → 0` and `(2) → 1`. Non-decreasing over 101 samples.
  - `'duration grows with distance and stays between 260 and 520 ms'`: `glideDuration` of `0 → 0`, `1 → 0`, `100 → 260`, `400 → 348`, `640 → 449`, `2000 → 520`, `-640 → 449`.
  - `'plan: a covered long trip jumps the hidden part and glides at most 0.8 of a screen'`: `planGlide(8000, 600, 800, true)` deep-equals `{ jumpTo: 1240, start: 1240, to: 600, duration: 449 }`. `planGlide(0, 3000, 800, true).jumpTo === 2360`. `planGlide(8000, 600, 800, false)` deep-equals `{ jumpTo: null, start: 8000, to: 600, duration: 520 }`. `planGlide(900, 600, 800, true)` deep-equals `{ jumpTo: null, start: 900, to: 600, duration: 306 }`. `planGlide(600, 601, 800, true).duration === 0`.
  - `'topOf puts an element 16 px under the bottom of the sticky header'`: with scrollY 1000, header 67 and element top 500, the result is `1417`. Without a header it is `1484`. A result below 0 gives `0`.
  - `'glide follows the curve, ends exactly on the target, and tidies up'`: from 900 to 600 (duration 306) with `frames(30, 17)`, the scroll positions are non-increasing, the frame at t0 + 153 ms is within 1 px of `750`, and the last one is `600`. `html` has `mo-gliding` during the glide and not after. It resolves `'done'` and `listeners()` is `0` afterwards.
  - `'a covered glide jumps once first, then glides'`: from 8000, `glide(600, { covered: true })` makes its first scroll call at `1240` before any frame. Every later value is in [600, 1240].
  - `'a wheel, touch, pointer press or key stops the glide where it is'`: for each event type, run 3 frames, fire the event, then run 10 frames. No scroll call happens after the event, it resolves `'cancelled'`, the class is gone and there are no listeners.
  - `'a new glide cancels the one in flight'`: `p1 = glide(100)`, 2 frames, `glide(300)`. `await p1 === 'cancelled'` and the final position is `300`.
  - `'the target is clamped to the page'`: with scrollHeight 2000 and innerHeight 800, `glide(5000)` ends at `1200` and `glide(-50)` ends at `0`.
  - `'reduced motion: one instant jump, no frames, no classes'`: `glide(600)` makes exactly one scroll call (`600`), queues no rAF, adds no `mo-gliding` and resolves `'instant'`. `leave(box)` resolves without a class or a timer. `enter([a, b])` adds no class.
  - `'leave fades out in 160 ms, starting from where a slow-load dim left it'`: for a box with `mo-wait` whose first child's computed opacity is `'0.5'`, after `leave(box)` the box has `mo-leave` and not `mo-wait`, `--mo-from` is `'0.5'`, and the promise resolves after the 160 ms timer.
  - `'enter staggers new items, capped at the 7th, and cleans up'`: with 9 nodes, `--mo-i` is `[0,1,2,3,4,5,6,6,6]`, every node has `mo-enter`, and the box loses `mo-leave` and `mo-wait`. An `animationend` (`animationName: 'mo-in'`) removes the class from that node, and the 1000 ms timer removes it from the rest.
  - `'the module never stores, fetches or writes HTML'`: the source has no match for `/localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|innerHTML|will-change|willChange/`.
  - `'style.css: unique keyframes, the motion block and its reduced-motion switch'`: `@keyframes mo-in `, `mo-out ` and `mo-dim ` each appear exactly once. `grep`-style, there are no duplicate `@keyframes` names in the file. The `html.mo-gliding` rule contains `scroll-behavior: auto !important` and `overflow-anchor: none`. There is a `prefers-reduced-motion: reduce` rule that sets `.mo-enter` to `animation: none`.
  - `'every page loads js/motion.js first'`: in `createRenderer(...).home()`, `.searchPage()` and `.notFound()` (the render404 pattern of `notfound.test.mjs`), `indexOf('js/motion.js')` is greater than -1 and smaller than the indexes of `js/site.js` and (404) `js/notfound.js`.
  - `'built pages carry a versioned motion.js'`: `index.html` and `post/index.html` match `/js\/motion\.js\?v=[a-f0-9]+/`. Fail with "run node scripts/build.mjs first" if they are missing.
- [ ] **Step 2: Run** `node --no-warnings --test scripts/tests/motion.test.mjs`. Expect FAIL: `js/motion.js` is missing.
- [ ] **Step 3: Implement** `js/motion.js` to the Interfaces block, add the CSS block, the script tag and the `versions` entry.
- [ ] **Step 4: Run** the file, then a plain `node scripts/build.mjs`, the file again, and `grep -o "@keyframes [a-z0-9-]*" css/style.css | sort | uniq -d`. Expect PASS and empty output.
- [ ] **Step 5: Commit** `js/motion.js`, `css/style.css`, `scripts/lib/render.mjs`, `scripts/build.mjs` and `scripts/tests/motion.test.mjs`, plus the regenerated pages. Message: `Motion: shared glide and page-change states (js/motion.js)`.

---

### Task 2: Lists (`js/pager.js`)

**Files:** Modify `js/pager.js` and `css/style.css` (delete the `.js-ready [data-reveal-stagger].is-leaving > *` and `.is-entering > *` rules). Add source guards to `scripts/tests/motion.test.mjs`. The browser check lives at `$HOME/.cache/mb-shots/motion/check.js` (never in the repo, never `/tmp`).

**Interfaces:**
- Consumes: `MBMotion.wait`, `leave`, `enter`, `glide`, `topOf` and `headerBottom` from Task 1.
- Produces: the behaviour below. There is no new public API.
  - Page number, Newer or Older. On click: `markPage`, the clicked control gets `is-pressed`, the nav gets `is-loading`, the grid gets `aria-busy` and `M.wait(grid, true)`. Then `load(href)` and `M.leave(grid)`, so the leave starts only when the page is there and the old cards stay, dimmed, while it loads. Then the swap, all in one task, in this order:
    1. Read `listTop` (the `.ap-list-head` or `.section-head` right before the grid, else the grid), its top, and `target = M.topOf(listTop)`.
    2. `fill(grid, n.grid)`, keeping `is-visible`.
    3. `M.enter(grid.children, grid)`.
    4. Bar and note update as now.
    5. Focus `grid.querySelector('a.card-link')` with `preventScroll`, only when the change came from a click or key in the pager (`push` and the focus was in the nav, on `body`, or detached).
    6. If `listTop` was above `M.headerBottom()`, call `M.glide(target, { covered: true })`. `is-paging` and `is-pressed` are removed when the glide settles (if not busy).
  - No `announce()` for page swaps, no `min-height` lock or transition, no `--i`, no `is-leaving`/`is-entering`, no `scrollIntoView`.
  - Category or label switch: the hero cross-fade, `main.is-switching` and `.is-new` stay as they are. When `scrollY > hero.offsetHeight`, call `M.glide(0, { covered: true })` instead of `window.scrollTo({ … smooth })`. The grid cards use `M.enter`. The `wrap` `min-height` lock and transition go away, as they do on page swaps (CLS).
  - Scroll restoration: set `history.scrollRestoration = 'manual'` just before the first `replaceState`/`pushState`. On `pagehide` set `'auto'`. On `pageshow`, when `history.state && history.state.mbPager`, set `'manual'` again.
  - Without `window.MBMotion`: an instant swap, then `listTop.scrollIntoView({ block: 'start' })` when it was above the header.

- [ ] **Step 1: Write the browser check (red).** Write `$HOME/.cache/mb-shots/motion/check.js`, a playwright-cli `run-code` script with `CASES` and `WIDTHS` constants at the top. It returns JSON; save it with `--raw run-code … > out.json`. For each width (390 and 1280, height 800) it uses a fresh context. It scrolls with `scrollBehavior` forced to `auto` so the pager sits 200 px above the bottom, then clicks with `page.mouse.click` on the element's box (not `locator.click`, which scrolls by itself). It records `{ t, y, listTop, headerBottom, op0, active }` every rAF for 2 s. It installs a `layout-shift` observer that sums entries with `!hadRecentInput`. Cases and assertions:
  - `post-older` on `/post/` with "Older":
    - (a) At most one sample has `|Δy|/Δt > 5` px/ms (the jump), and in that sample no old card is left and every new card in the viewport has opacity `< 0.3` (nothing readable is skipped).
    - (b) Every other sample has `|Δy|/Δt ≤ 5`.
    - (c) The glide lasts 250 to 560 ms.
    - (d) Finally `|listTop − (headerBottom + 16)| ≤ 2`.
    - (e) `document.activeElement` is the grid's first `a.card-link`, the URL is `/post/page/2/` and the note starts with `Page 2 of`.
    - (f) There are no `pageerror` events, `getComputedStyle(document.body).transform === 'none'`, and `<html>` has no `mo-gliding`.
    - (g) The shift sum is `< 0.01`.
  - `post-back`: after `post-older`, `page.goBack()`. `y` never increases by more than 2 px between samples (no yo-yo), the URL is `/post/` and the first card is in view.
  - `post-article-back`: after `post-older`, click the first card (a real page load), then `goBack()`. The URL is `/post/page/2/` and `scrollY` is within 50 px of its value before the click.
  - `post-slow`: route `**/post/page/2/` with a 1500 ms delay. At 600 ms the old cards are still there with opacity in [0.4, 0.6] and the current number has `is-loading`. After arrival, (a) to (e) hold.
  - `fast-clicks`: "Older", then "3" within 100 ms. The final URL is `/post/page/3/`, the first card's `href` equals the first card `href` in the built `post/page/3/index.html` (fetched with `page.request`), and no `mo-*`, `is-paging` or `is-pressed` class is left after 2 s.
  - `label-switch`: `/category/educational/`, scroll to the pager, click a header menu link to another category (at 1280). After the jump no sample is over 5 px/ms, and it ends at `scrollY === 0`.
  - Run it now (`export PATH=$HOME/tools/node/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright`, `cd $HOME/.cache/mb-shots/motion`, `playwright-cli open --browser=chromium`). Expect FAIL on today's code: (b) about 22 px/ms at 390, (d) 182 instead of 83 px at 390, (e) focus on "Older", `post-back` yo-yo, `post-slow` cards at opacity 0. Keep `before.json`.
- [ ] **Step 2: Add the source guard** `'pager.js: shared motion, no native smooth scroll, restoration handed back on pagehide'` to `motion.test.mjs`. `js/pager.js` matches `/MBMotion/`, `/scrollRestoration = 'manual'/` and `/pagehide[\s\S]{0,200}scrollRestoration = 'auto'/`. It has no match for `/scrollIntoView\(\{ behavior|behavior: fx \? 'smooth'|minHeight|is-entering|announce\(\(nav/`. Run it and expect FAIL.
- [ ] **Step 3: Implement** the Interfaces behaviour in `js/pager.js`. Add a `ready[href]` flag in `load()` for the slow-path check. Delete the two CSS rules.
- [ ] **Step 4: Run** `motion.test.mjs`, a plain build, the full suite and `check.js` (all cases, both widths). Expect PASS. Save `after.json`.
- [ ] **Step 5: Commit** `js/pager.js`, `css/style.css` and `scripts/tests/motion.test.mjs`, plus the regenerated pages. Message: `Pagination: soft glide to the list, cards rise in, focus follows, no Back yo-yo`.

---

### Task 3: The 404 pager, "Show more results", "Show more posts", "Show more comments"

**Files:** Modify `js/notfound-posts.js`, `js/site.js` (`showNext` in the search page block, and the "Latest posts" button block) and `js/engage.js` (`renderComments` and its Show more button). Modify `scripts/tests/notfound.test.mjs` and add source guards to `scripts/tests/motion.test.mjs`.

**Interfaces:**
- Consumes: `MBMotion` from Task 1.
- Produces:
  - `notfound-posts.js` `go(n, userMoved)`. While busy, remember only the latest `n`. The clicked link gets `is-pressed`. Then `M.leave(grid)`, `draw()`, `M.enter(grid.children, grid)`, `announce('Page n of total')`, and focus `grid.querySelector('a.card-link')` with `preventScroll` when `userMoved`. When `.nf-more-title` is above `M.headerBottom()`, call `M.glide(M.topOf(title), { covered: true })`. Without `MBMotion`: today's instant path, with the same focus target.
  - "Show more" rule, shared by search, home and comments. Append the new batch, call `M.enter(batch)` (comments keep their own `rise` instead), and focus the first new item with `preventScroll`. If its top is below `0.6 × innerHeight`, call `M.glide(M.topOf(first))` (not covered). The focus target is the first new item: `a.result` for search, `a.card-link` for home, the `.comment` article (already `tabIndex = -1`) for comments. Home drops `scrollIntoView({ behavior … 'nearest' })` and keeps its `.is-new` entrance.
  - "Show more comments" appends `commentNode(c, true)` for the next `COMMENT_BATCH` items before the button and updates or removes the button. It no longer calls `renderComments(allComments)`, so existing comments do not replay their animation. Other refreshes still call `renderComments`.
  - The sidebar "More topics" button stays unchanged (no scroll, already animated).

- [ ] **Step 1: Write the failing tests.** In `notfound.test.mjs`, extend `runPosts` with `motion = true`. That adds `window.MBMotion`, a fake recording `leave`, `enter`, `glide` (args) and `topOf` (returns `1234`), with `headerBottom()` returning `67`. `title.getBoundingClientRect` returns `{ top: -400 }`. `grid.querySelector('a.card-link')` returns a node with a focus counter, and `grid.children` is a list.
  - Replace `'posts: page numbers change the cards in place, announce, move focus, and never touch the address'`. After `click(2)` and `settle()`, the motion log is `['leave', 'enter', ['glide', 1234, { covered: true }]]` in that order, the grid changed to 9 cards, status is `'Page 2 of 3'`, the first card link has `focused === 1`, the current page number has `focused === 0`, and the address APIs are never called.
  - `'posts: fast clicks: the last page asked for wins'`: `click(2)` then `click(3)` before settling. After settling the pager shows `Page 3 of 3`, the status is `'Page 3 of 3'` and `leave` was called at most twice.
  - `'posts: without MBMotion the swap is instant and the heading is scrolled into view'`: with `motion: false`, the grid changes synchronously on `click(2)`, `title.scrolled >= 1` and the first card link is focused.
  - In `motion.test.mjs`, `'Show more buttons use the shared glide and never scroll by focus'`: `js/site.js` has no match for `/focus\(\{ preventScroll: false \}\)|scrollIntoView\(\{ behavior: reduce/` and matches `/MBMotion/`. In `js/engage.js`, the `comments-more` click handler (the text between `'comments-more'` and the next `list.appendChild`) has no `renderComments(` call, and the file matches `/MBMotion/`.
- [ ] **Step 2: Run** both files. Expect FAIL.
- [ ] **Step 3: Implement** the three consumers to the Interfaces block.
- [ ] **Step 4: Run** both files, a plain build and the full suite. Expect PASS.
- [ ] **Step 5: Commit** `js/notfound-posts.js`, `js/site.js`, `js/engage.js`, `scripts/tests/notfound.test.mjs` and `scripts/tests/motion.test.mjs`, plus the regenerated pages. Message: `Motion: the 404 pager and every Show more button glide and rise the same way`.

---

### Task 4: Browser verification matrix

**Files:** No source changes unless a check fails. Scratch files only go in `$HOME/.cache/mb-shots/motion/`.

**Interfaces:**
- Consumes: `check.js` from Task 2, the plain build, and `node scripts/serve.mjs` (start it in the background if `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/post/` is not `200`).
- Produces: `matrix.json`, frame CSVs, screenshots and a pass/fail list in the task report.

- [ ] **Step 1: Extend `check.js`** with these cases, each with the Task 2 assertions (a) to (g) where they apply:
  - `nf-pager`: `/nope-xyz/`. Click Stop first, then "Older" in the 404 pager. The target is `.nf-more-title`.
  - `search-more`: `/search/?q=tanzania` (31 results), "Show more results". The new results have `mo-enter` during their entrance, the first new result is focused, and if it started below 60% of the viewport it ends at `headerBottom + 16 ± 2`.
  - `home-more`: `/`, "Show 6 more posts". Same rule, and the first new `a.card-link` is focused.
  - `reduced` (context `reducedMotion: 'reduce'`): "Older" on `/post/`. Exactly one scroll change, no element ever has `mo-enter` or `mo-leave`, then (d) and (e).
  - `keyboard`: focus "Older", press Enter. (a) to (e) hold, and the first card link matches `:focus-visible`.
  - `touch` (context `hasTouch: true, isMobile: true`, 390 px): tap "Older", then `page.touchscreen.tap` mid-glide (at about 300 ms). After the tap `y` changes by at most 2 px for 500 ms, and `<html>` loses `mo-gliding`.
  - `inp` (CDP `Emulation.setCPUThrottlingRate { rate: 4 }`): an Event Timing observer (`type: 'event', durationThreshold: 16, buffered: true`) gives a largest `click`/`pointerup` duration below 100 ms for "Older" on `/post/`.
  - Comments: only if the local fake API holds 11 or more conversations (`node --no-warnings scripts/dev-api.mjs` and a `--api http://127.0.0.1:8787` build). "Show more comments" adds 10, the first ten keep their nodes (same `id`s, no replayed animation) and the first new comment is focused. Afterwards rebuild with plain `node scripts/build.mjs`.
- [ ] **Step 2: Run the matrix.** Widths 360, 768 and 1280 (height 800). Run `post-older`, `post-back`, `post-slow`, `fast-clicks`, `nf-pager`, `search-more` and `home-more` in `colorScheme` `light`, then `post-older` and `nf-pager` again in `dark`. Write `matrix.json`, plus one CSV per case and width (`t,y,listTop,headerBottom,op0`) to show there is no sudden jump. Every assertion must pass.
- [ ] **Step 3: Frame sequences.** In separate runs (screenshots slow the page, so they prove the look, not the timing), take `post-older-<w>-<theme>-<ms>.png` at 0, 120, 300, 500 and 800 ms after the click for 360 and 1280 in light and dark. Read every file with the Read tool. Expected: the old cards fade; then the list top glides into place under the header with the cards rising; the header never blurs or flickers; nothing overlaps the header; there is no horizontal scroll (`scrollWidth <= innerWidth`).
- [ ] **Step 4: Fix and repeat.** For any failure, fix the code, re-run `motion.test.mjs` and `notfound.test.mjs`, rebuild plain and re-run the failing case. Commit fixes only (`Motion: fixes from the browser check`). Delete any `.playwright-cli/` folder created inside the repo.
- [ ] **Step 5: Report what was not verified here.** Only Chromium is installed, so Firefox and Safari are untested. Installing them (`npx playwright install webkit firefox`, about 200 MB) needs the owner's approval. Give the owner a 1-minute iPhone check: on `/post/` tap "Older" at the bottom. Expect one soft glide with cards rising. A flick during the glide stops it, and Back does not bounce.

---

### Task 5: Docs

**Files:** Modify `CLAUDE.md`.

**Interfaces:**
- Consumes: names and values from Tasks 1 to 3.
- Produces: documentation only.

- [ ] **Step 1: Rewrite the motion sentences in "Pages and pagination"** (keep the rest). A page change works like this:
  - The old cards fade (0.16 s), and on a slow connection they stay, dimmed, while the page number pulses.
  - The page glides to the top of the list with a custom eased scroll of at most 0.52 s. The farther part of a long trip is jumped while the cards are hidden, and any wheel, touch or key stops it.
  - The new cards rise in one after another, and focus moves to the first new article.
  - Back/Forward behave the same (pager.js sets `history.scrollRestoration` to `manual` and back to `auto` on `pagehide`). Reduced motion swaps instantly.
  - One shared module, `js/motion.js` (`window.MBMotion`), also drives the 404 posts pager, search "Show more results", home "Show more posts" and "Show more comments".
  - Never use native smooth scrolling (`scrollIntoView({ behavior: 'smooth' })`, or `focus()` without `preventScroll`) for these; use `MBMotion.glide`.
  - No same-document View Transitions here (they freeze the page and cannot carry a scroll).
- [ ] **Step 2: Add to "CSS pitfalls":** the motion states are keyframe animations (`mo-in`, `mo-out`, `mo-dim`) so they beat the reveal styles. `html.mo-gliding` only sets `scroll-behavior` and `overflow-anchor`. Never animate `height` for page changes (CLS).
- [ ] **Step 3: Extend the "Behaviour" row** of the "Do not hand-edit" table with `page-change motion (glide, fade, rise): js/motion.js`.
- [ ] **Step 4: Verify:** the full suite, `node scripts/build.mjs --check` and `node --no-warnings --test scripts/tests/share.test.mjs`. Report what ran and its result.
- [ ] **Step 5: Commit** `CLAUDE.md`. Message: `Docs: smooth pagination motion`.
