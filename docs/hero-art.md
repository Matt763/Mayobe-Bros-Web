# Hero pictures for the company, legal and trust pages

The pictures in `assets/img/heroes/*.webp` (About, Contact, Work with us, the author page, Search and the seven policy pages) are drawn in
code from the brand colours by `scripts/tools/hero-art.html`. There are no photographs and nothing is copied from anywhere.

- See one: open `scripts/tools/hero-art.html?scene=privacy-policy` in a browser (`?scene=list` shows the names).
- Change the look or the little icons: edit the `SCENES` table at the top of that file (big icon, two accent colours, five small card icons).
- Re-make the files: screenshot each scene at 1920x1080 (for example with Playwright) and convert with
  `cwebp -q 84 -m 6 -sharp_yuv scene.png -o assets/img/heroes/<scene>.webp`. Each file is about 45 KB.
- Which page uses which picture: `pageHeroes` in `site.config.json` (key = page slug, `author/<slug>` for author pages, `search`).
  A page without an entry gets a photo from the post pictures instead.
