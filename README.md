# Mayobe Bros: static website

The Mayobe Bros blog as a plain **HTML, CSS and JavaScript** site for **GitHub Pages**. No database, no framework, no
`npm install`. Posts are Markdown files; one small Node script turns them into fast, search-friendly pages.

| Read this | When |
| --- | --- |
| `DEPLOY.md` | Putting the site live on mayobebros.com (GitHub, Spaceship DNS, Cloudflare, Search Console, AdSense) |
| `CLAUDE.md` | Publishing, updating and moderating (also the instructions Claude follows in this folder) |
| `docs/writing-guide.md` | The standard every post must meet |
| `worker/README.md` | Comments and reactions server (Cloudflare, free) |

## Everyday use

```bash
export PATH=$HOME/tools/node/bin:$PATH     # only if `node` is not found
node scripts/build.mjs                     # validate + build (prints errors and quality warnings)
node scripts/serve.mjs                     # preview at http://127.0.0.1:8000/
git add -A && git commit -m "Publish: <title>" && git push     # goes live in about a minute
```

A post is `content/posts/<slug>.md` with a short header (see `CLAUDE.md`). Delete the file to unpublish.

## What the site has

Light by default and follows the device's dark/light setting (or a visitor's choice) · full-width layout with a photo hero on
every menu page · instant search (`/` or `Ctrl+K`) · table of contents, reading progress, share buttons, "Listen to this article" (voice, highlighted sentence, auto-scroll) · Plyr video player · smooth
page, scroll and button animations (all off for visitors who prefer reduced motion) · emoji reactions (Like, Amazed, Sad,
Angry) and moderated comments with counts on every card and post (needs the Worker) · About, Contact, Work with us and
eight policy pages · RSS, XML sitemap, schema.org data, a branded 1200 x 630 JPEG link-preview picture for every post (WhatsApp, Facebook, X, LinkedIn, Telegram) · AdSense-ready (ads off until approval).

## Layout of the folder

`content/` posts, pages, categories (**source**) · `site.config.json` settings (**source**) · `css/`, `js/` (**source**) ·
`scripts/` generator, templates, tests · `worker/` comments server · everything else is **generated** by the build and committed
because GitHub Pages serves it (`index.html`, `post/`, `category/`, `sitemap.xml`, …). Do not edit generated files by hand.

## Tests

```bash
node --no-warnings --test scripts/tests/markdown.test.mjs scripts/tests/worker.test.mjs
```
