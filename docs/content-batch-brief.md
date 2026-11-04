# Brief for a batch of new posts (read after `docs/writing-guide.md` and `CLAUDE.md`; those rules win if anything here seems to clash)

The site is Mayobe Bros (https://mayobebros.com), an English-language blog for readers in Tanzania, applying for Google AdSense. We are filling every
category and label with useful, evergreen articles. One careless or invented fact can sink the whole site, so accuracy beats speed and beats word count.

## What a good post here is
- It answers one real question people type into Google or ask each other (a real need, not a keyword). The answer comes first, then the detail.
- It is still true and useful in two years (evergreen). Anything that can change (fees, deadlines, cut-offs, prices, versions, laws) says "As checked in
  November 2026" and points to the official page for the current figure.
- 1,300 to 2,000 words of real substance. Plain English, reading grade 8 or lower (the build checks this). Short paragraphs. Phone-friendly.
- It has a Tanzanian angle where one is true and useful. For world-history and gaming posts, a local angle is optional; never force one.

## Tone: warm, human, never invented
The owner wants posts that touch the reader: inspiring, emotional, focused, heartfelt, as the topic suits. You get one tone per post (given in your plan).
Do it with craft, not with made-up material:
- Speak to the reader's real situation with "you": the waiting, the worry, the hope, the first-time nerves, the pride of a small step. Name the feeling
  plainly in one or two sentences, then help.
- Use plain hypotheticals clearly marked as examples ("Say you are a Form Six leaver...", "Imagine you have TSh 300,000..."). Check the arithmetic.
- NEVER invent a person, a quote, a testimonial, a "real story", a statistic, a study or a personal experience ("I visited", "a student told us"). The
  build and AdSense both punish this. A real, sourced historical fact can carry emotion by itself: tell it simply and truthfully.
- Open with a short, warm line that fits the reader, then get to the point within the first 3 sentences. Close "What to do next" with one honest sentence of
  encouragement. Do not preach, do not hype, do not promise results.
- Obey the banned-phrase list in the writing guide. At most 3 em dashes in the whole post (use none if you can).

## Structure that search engines and readers both like
- Title: the main question or task in natural words, under 70 characters (add `metaTitle:` of at most 60 characters if the title is longer). No clickbait that the
  text does not deliver ("You won't believe"). Eye-catching comes from a clear promise that the post keeps ("What the numbers mean, and what to do next").
- `excerpt:` 120 to 160 characters, unique, says what the reader will learn.
- First section `## The short answer` (or `## Key points`): a direct answer of 40 to 60 words, then 3 to 6 bullets. This is what featured snippets use.
- Main sections as `##` headings, many phrased the way people ask ("How do I...", "What is...", "How much does ... cost"). Use numbered steps for
  processes, a bullet list for sets, a Markdown table for comparisons. Add real numbers only if verified.
- `## Common questions` with 3 to 5 `###` questions and short direct answers (do not add FAQ markup; the site emits none on purpose).
- `## What to do next` with 2 to 4 concrete steps.
- `## Sources and further reading` with 3 to 6 links you really opened, in the format `- [Page title, Organisation](https://...)`. Prefer official and primary sources.
- 2 to 4 internal links to other Mayobe Bros posts that truly help (check `ls content/posts/` just before you finish: other agents are adding posts now). Use
  `/post/<category>/<label>/<slug>/` (omit the label part if the post has none). Only link to posts that exist.

## Front matter (exact)
```
---
title: ...
date: 2026-11-04
author: Mclean Mbaga
category: <slug>
label: <slug>            (omit the line for categories without labels)
excerpt: ...
image: assets/posts/<slug>.webp
imageAlt: Literal description of what the picture shows (under 125 characters)
imageCredit: (printed by the photo tool)
imageSource: (printed by the photo tool)
tags: [3 to 5 lowercase tags]
---
```
- Filename and URL: `content/posts/<slug>.md`, lowercase words and hyphens, no dates in the slug, the main phrase in it. The `image` file is named exactly `<slug>.webp`.
- Tags: run `grep -h '^tags:' content/posts/*.md | tr -d '[]' | tr ',' '\n' | sed 's/^tags: *//; s/^ *//' | sort | uniq -c | sort -rn | head -60`
  first and REUSE existing spellings. Lowercase, singular where it is natural ("student loan"), real topics only. Every tag that two posts share becomes a topic page.
- No `featured`, no `draft` line (the post is published), no `aliases`.

## One cover picture per post, and it must be RELEVANT
The owner's rule: relevant images only. A pretty but unrelated picture is a failure.
1. Decide what a reader would literally expect to see for this topic: the place, object or activity itself (a lecture hall, a laptop with a spreadsheet, a smartphone,
   a market stall, Mount Kilimanjaro, a padlock on a keyboard, a chicken coop, a chessboard). Abstract ideas ("success", "growth") are not subjects: pick the concrete scene.
2. `node scripts/tools/photo.mjs search "<2 or 3 plain words>"` (try several short queries; a long sentence finds nothing). It lists only pictures whose licence allows
   commercial use without share-alike (CC0, public domain, CC BY).
3. `node scripts/tools/photo.mjs get <id> <post-slug>` downloads and shrinks it to a small WebP (about 1400 px wide, under 220 KB) and prints the front matter lines.
4. LOOK at the preview file it names (open the .jpg with the Read tool). Keep the picture only if ALL are true: it clearly shows the post's subject; it is sharp and
   modern-looking; no watermark, no visible brand logos or readable personal data; no identifiable person shown in a sensitive or negative context; it is not an
   old black-and-white or low-quality scan (unless the post is about that history); it does not give a false impression of what the post covers.
5. If it fails, search again (at least 5 different queries) and `get` another into the same slug (it overwrites). If nothing relevant exists, leave out the `image`
   lines (the category picture is shown instead) and say so in your report. Never use an irrelevant filler.
6. Write your own literal `imageAlt`. Copy `imageCredit` and `imageSource` exactly as printed (they show a credit line under the article and are needed for CC BY).
7. Do not add inline images unless very useful; if you do, they follow the same rules and must be in `assets/posts/` as WebP under 150 KB.

## Optional video (about half of the posts, only when it truly helps)
- Embed with a line on its own: `::youtube[Caption saying what the video shows](https://youtu.be/VIDEOID){poster=assets/posts/<slug>.webp}` (the poster is the post's own cover).
  Never paste an iframe. The page loads nothing from YouTube until the reader presses play.
- Find candidates with WebSearch. Prefer official or credible channels: government bodies, universities, the product maker, recognised educators.
- Run `node scripts/tools/yt-check.mjs <url>`. It must print `200 OK`, and its real title and channel must match your caption. If you cannot confirm what the video
  contains from its title, channel and description page, do not use it.
- The article must stand on its own without the video. Never embed music videos, pirated uploads, re-uploads of news clips, or anything with a doubtful licence.

## Safety and policy (AdSense and other ad networks, Google Search spam policies)
- Nothing about gambling or betting, adult content, weapons, drugs, hate or harassment, miracle cures, get-rich schemes, fake documents, cracks, piracy, cheating in
  exams, hacking other people's systems, or paying for jobs or admissions.
- No medical, legal or investment advice as such: describe, cite official guidance, and say to ask a qualified person.
- Cyber-security posts are defensive only (protect your accounts, spot scams, safe settings). No attack steps.
- Games posts: use official publisher or platform pages; mention age ratings; no piracy, no loot-box or betting promotion.
- History posts: neutral, sourced, respectful; separate fact from interpretation; no glorifying violence.
- Never copy wording from another site. Facts are free, your sentences must be yours. Do not paraphrase one source line by line.
- Do not write about real private people. Public figures only in a sourced, factual way.
- Never write that a post was "AI-generated" or about how it was made. Never leave notes to the editor inside a post.

## Rules for working in the shared folder (several agents are writing at the same time)
- Create only: `content/posts/<your-slugs>.md` and `assets/posts/<your-slugs>.webp`. Do not edit any other file, site code, config or categories.
- Check your work with `node scripts/build.mjs --check` (writes nothing). Do NOT run `node scripts/build.mjs` without `--check`, and never run git commands.
  The check prints warnings for every post on the site; fix every warning that names one of YOUR files (reading level, AI phrases, income wording, alt text,
  length, percentages without sources) and ignore other files' warnings.
- Run `node scripts/tools/check-sources.mjs <your-slugs>`. Replace or remove any BROKEN link. BLOCKED means the site refuses robots: open it yourself with WebFetch to confirm.
  A single timeout may be network noise: retry once before you drop a source.
- Node may need: `export PATH=$HOME/tools/node/bin:$PATH`.

## Your report (short)
A table with one row per post: slug, words, tone, cover (what it shows, licence), video (title and channel, or none), and below it: facts you could not confirm and softened or
removed, any post you did not finish and why, and questions for the owner. Do not paste the posts into the report.
