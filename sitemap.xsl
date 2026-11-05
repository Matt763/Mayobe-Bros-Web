<?xml version="1.0" encoding="UTF-8"?>
<!--
  Looks for sitemap.xml and every child sitemap (posts-sitemap1.xml, image-sitemap1.xml ...).
  Source file: scripts/tools/sitemap.xsl. The build copies it to /sitemap.xsl. Edit the source, not the copy.
  Colours and shapes follow css/style.css so the sitemap looks like the website. Search engines ignore this file and read the XML.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">

  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

  <!-- The XML holds absolute addresses (the standard needs that). For people the links open on the address they are viewing from,
       so they work on localhost and on the live site alike. Only addresses on the sitemap's own host are changed. -->
  <xsl:variable name="host" select="substring-before(substring-after((//sitemap:loc)[1], '://'), '/')"/>
  <xsl:template name="local">
    <xsl:param name="url"/>
    <xsl:choose>
      <xsl:when test="starts-with($url, 'http') and substring-before(substring-after($url, '://'), '/') = $host">
        <xsl:value-of select="concat('/', substring-after(substring-after($url, '://'), '/'))"/>
      </xsl:when>
      <xsl:otherwise><xsl:value-of select="$url"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- the note the build writes before the root element: type, part, of, start, prev, next -->
  <xsl:variable name="meta" select="string(/comment()[contains(., 'mb-sitemap')])"/>
  <xsl:variable name="type" select="substring-before(concat(substring-after($meta, 'type='), ' '), ' ')"/>
  <xsl:variable name="part" select="substring-before(concat(substring-after($meta, 'part='), ' '), ' ')"/>
  <xsl:variable name="parts" select="substring-before(concat(substring-after($meta, ' of='), ' '), ' ')"/>
  <xsl:variable name="start0" select="substring-before(concat(substring-after($meta, 'start='), ' '), ' ')"/>
  <xsl:variable name="start"><xsl:choose><xsl:when test="number($start0) &gt; 0"><xsl:value-of select="number($start0)"/></xsl:when><xsl:otherwise>1</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="prev" select="substring-before(concat(substring-after($meta, 'prev='), ' '), ' ')"/>
  <xsl:variable name="next" select="substring-before(concat(substring-after($meta, 'next='), ' '), ' ')"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>Sitemap | Mayobe Bros</title>
        <link rel="icon" href="/favicon.ico"/>
        <script>
          (function () {
            var r = document.documentElement;
            var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
            function saved() { try { var t = localStorage.getItem('theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } }
            function apply() {
              var m = saved();
              r.classList.toggle('dark', m === 'dark' || (m === 'auto' &amp;&amp; !!mq &amp;&amp; mq.matches));
              r.classList.toggle('light', m === 'light');
            }
            apply();
            if (mq &amp;&amp; mq.addEventListener) mq.addEventListener('change', apply);
            window.addEventListener('storage', function (e) { if (e.key === 'theme' || e.key === null) apply(); });
          })();
        </script>
        <style>
          /* Theme: the same three states as the site's theme button (saved in localStorage as "theme"): light, dark, or follow the device.
             The script at the top of the page sets the "dark" and "light" classes. Without scripts, the device setting decides. */
          :root {
            --bg: #f3f6fb; --surface: #ffffff; --surface-2: #e9eef7;
            --text: #0b1220; --text-2: #1b2434; --text-3: #364154;
            --line: #bcc6d8; --line-soft: #dde4ef;
            --link: #1e3a9e; --soft: #dfe9ff; --soft-text: #14296e;
            --ok: #0b5d1e; --warn: #8a4b00; --head-1: #070b14; --head-2: #1e3a9e;
            --pr-hi-bg: #d5f3df; --pr-hi: #0b5d1e; --pr-md-bg: #ffe9c7; --pr-md: #6b3b00;
            --shadow: 0 6px 16px -4px rgba(11,18,32,.14), 0 2px 6px rgba(11,18,32,.06);
            color-scheme: light;
          }
          :root.dark {
              --bg: #070b14; --surface: #0d1424; --surface-2: #16203a;
              --text: #f8fafc; --text-2: #e6ecf6; --text-3: #c5cfe2;
              --line: #3a4d78; --line-soft: #1f2d4d;
              --link: #8fb0ff; --soft: #16254d; --soft-text: #cfdcff;
              --ok: #6ee79a; --warn: #ffc277; --head-1: #070b14; --head-2: #14296e;
              --pr-hi-bg: #12351f; --pr-hi: #6ee79a; --pr-md-bg: #3a2a0e; --pr-md: #ffc277;
              --shadow: 0 6px 16px -4px rgba(0,0,0,.5);
              color-scheme: dark;
          }
          @media (prefers-color-scheme: dark) {
            :root:not(.light) {
              --bg: #070b14; --surface: #0d1424; --surface-2: #16203a;
              --text: #f8fafc; --text-2: #e6ecf6; --text-3: #c5cfe2;
              --line: #3a4d78; --line-soft: #1f2d4d;
              --link: #8fb0ff; --soft: #16254d; --soft-text: #cfdcff;
              --ok: #6ee79a; --warn: #ffc277; --head-1: #070b14; --head-2: #14296e;
              --pr-hi-bg: #12351f; --pr-hi: #6ee79a; --pr-md-bg: #3a2a0e; --pr-md: #ffc277;
              --shadow: 0 6px 16px -4px rgba(0,0,0,.5);
              color-scheme: dark;
            }
          }
          *, *::before, *::after { box-sizing: border-box; }
          html { -webkit-text-size-adjust: 100%; }
          body {
            margin: 0; background: var(--bg); color: var(--text);
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
            font-size: 16px; line-height: 1.55;
          }
          a { color: var(--link); text-underline-offset: 3px; }
          a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; border-radius: 4px; }
          .wrap { width: min(100% - 2rem, 78rem); margin-inline: auto; }

          /* top bar */
          .bar { background: var(--surface); border-bottom: 1px solid var(--line-soft); }
          .bar .wrap { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem 0; }
          .brand img { display: block; height: 2.6rem; width: auto; }
          .bar-links { display: flex; flex-wrap: wrap; gap: .5rem; }
          .pill { display: inline-flex; align-items: center; gap: .4rem; padding: .4rem .9rem; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--text); font-size: .9375rem; font-weight: 600; text-decoration: none; }
          .pill:hover { background: var(--soft); border-color: var(--link); color: var(--soft-text); }

          /* title band */
          .hero { background: linear-gradient(135deg, var(--head-1) 0%, var(--head-2) 100%); color: #fff; padding: clamp(2rem, 5vw, 3.5rem) 0; }
          .hero h1 { margin: 0 0 .4rem; font-size: clamp(1.8rem, 4vw, 2.75rem); line-height: 1.15; letter-spacing: -.01em; }
          .hero p { margin: 0; max-width: 46rem; color: #dbe5ff; font-size: 1.0625rem; }
          .crumbs { margin: 0 0 1rem; font-size: .9375rem; color: #c3d2ff; }
          .crumbs a { color: #fff; }

          main { padding: clamp(1.5rem, 4vw, 2.5rem) 0 3rem; }

          /* numbers */
          .stats { display: flex; flex-wrap: wrap; gap: .85rem; margin: 0 0 1.75rem; }
          .stat { min-width: 9.5rem; padding: 1rem 1.25rem; background: var(--surface); border: 1px solid var(--line-soft); border-radius: 14px; box-shadow: var(--shadow); }
          .stat b { display: block; font-size: 2rem; line-height: 1.1; color: var(--link); }
          .stat span { color: var(--text-3); font-size: .9375rem; font-weight: 600; }

          .sec-title { display: flex; align-items: center; gap: .6rem; margin: 0 0 1rem; font-size: 1.25rem; }
          .sec-title::before { content: ""; width: .7rem; height: .7rem; border-radius: 50%; background: var(--link); }

          /* tables */
          .table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line-soft); border-radius: 14px; box-shadow: var(--shadow); }
          table { width: 100%; border-collapse: collapse; min-width: 38rem; }
          th { padding: .8rem 1rem; background: var(--head-2); color: #fff; font-size: .8125rem; font-weight: 700; letter-spacing: .05em; text-align: left; text-transform: uppercase; white-space: nowrap; }
          th:first-child { border-top-left-radius: 13px; } th:last-child { border-top-right-radius: 13px; }
          td { padding: .75rem 1rem; border-top: 1px solid var(--line-soft); vertical-align: middle; font-size: .9375rem; color: var(--text-2); }
          tbody tr:hover td { background: var(--soft); }
          .n { width: 3.5rem; color: var(--text-3); font-variant-numeric: tabular-nums; }
          .loc { overflow-wrap: anywhere; font-weight: 600; }
          .title { display: block; margin: 0 0 .15rem; color: var(--text); font-weight: 700; }
          .date, .freq { white-space: nowrap; color: var(--text-3); }
          .pr { display: inline-block; min-width: 2.6rem; padding: .15rem .55rem; border-radius: 999px; background: var(--surface-2); color: var(--text-3); font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
          .pr.hi { background: var(--pr-hi-bg); color: var(--pr-hi); } .pr.md { background: var(--pr-md-bg); color: var(--pr-md); }

          /* pictures and videos */
          .thumbs { display: flex; align-items: center; gap: .35rem; }
          .thumb { display: block; width: 4.5rem; height: 3rem; border-radius: 8px; object-fit: cover; background: var(--surface-2); border: 1px solid var(--line-soft); }
          .more { color: var(--text-3); font-size: .8125rem; font-weight: 700; white-space: nowrap; }
          .tag { display: inline-block; margin-left: .4rem; padding: .05rem .5rem; border-radius: 999px; background: var(--soft); color: var(--soft-text); font-size: .75rem; font-weight: 700; vertical-align: middle; }

          /* the index: one card per sitemap file */
          .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
          .card { display: flex; flex-direction: column; gap: .5rem; height: 100%; padding: 1.1rem 1.2rem; background: var(--surface); border: 1px solid var(--line-soft); border-radius: 14px; box-shadow: var(--shadow); color: inherit; text-decoration: none; transition: border-color .2s, transform .25s; }
          .card:hover { border-color: var(--link); transform: translateY(-2px); }
          .card-top { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
          .kind { padding: .2rem .7rem; border-radius: 999px; background: var(--soft); color: var(--soft-text); font-size: .8125rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
          .card h3 { margin: 0; font-size: 1.125rem; color: var(--text); }
          .card p { margin: 0; color: var(--text-3); font-size: .9375rem; }
          .card .file { margin-top: auto; color: var(--link); font-size: .875rem; font-weight: 600; overflow-wrap: anywhere; }
          .card .date { font-size: .875rem; }

          .partno { display: inline-block; margin-left: .4rem; padding: .15rem .7rem; border-radius: 999px; background: rgba(255,255,255,.16); font-size: .5em; font-weight: 700; vertical-align: middle; white-space: nowrap; }
          .card .open { color: var(--text-3); font-size: .875rem; }
          .card:hover .open { color: var(--link); }
          .pager { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .75rem; margin: 1.25rem 0 0; }
          .note { margin: 1.75rem 0 0; padding: 1rem 1.25rem; background: var(--surface); border: 1px solid var(--line-soft); border-left: 4px solid var(--link); border-radius: 12px; color: var(--text-3); font-size: .9375rem; }
          footer { padding: 1.5rem 0 2.5rem; color: var(--text-3); font-size: .9375rem; text-align: center; }
          @media (max-width: 40rem) { .brand img { height: 2.2rem; } .stat { flex: 1 1 8rem; } }
          @media (prefers-reduced-motion: reduce) { .card { transition: none; } .card:hover { transform: none; } }
        </style>
      </head>
      <body>
        <div class="bar">
          <div class="wrap">
            <a class="brand" href="/" aria-label="Mayobe Bros home"><img src="/assets/img/logo-500.webp" alt="Mayobe Bros" height="42"/></a>
            <div class="bar-links">
              <a class="pill" href="/sitemap.xml">Sitemap index</a>
              <a class="pill" href="/sitemap/">Web page version</a>
              <a class="pill" href="/rss/">RSS feed</a>
              <a class="pill" href="/">Back to the site</a>
            </div>
          </div>
        </div>
        <xsl:apply-templates select="sitemap:sitemapindex"/>
        <xsl:apply-templates select="sitemap:urlset"/>
        <footer><div class="wrap">Mayobe Bros sitemap. Made for search engines; it is built again every time the site is published.</div></footer>
      </body>
    </html>
  </xsl:template>

  <!-- ===================== the index (sitemap.xml) ===================== -->
  <xsl:template match="sitemap:sitemapindex">
    <section class="hero">
      <div class="wrap">
        <p class="crumbs"><a href="/">Home</a> / Sitemap</p>
        <h1>Sitemap index</h1>
        <p>Every page that search engines may index, grouped by type. Each file below holds up to 200 addresses; a new numbered file is added when one fills up.</p>
      </div>
    </section>
    <main>
      <div class="wrap">
        <div class="stats">
          <div class="stat"><b><xsl:value-of select="count(sitemap:sitemap)"/></b><span>Sitemap files</span></div>
        </div>
        <h2 class="sec-title">Sitemap files</h2>
        <ul class="cards">
          <xsl:for-each select="sitemap:sitemap">
            <li>
              <a class="card">
                <xsl:attribute name="href"><xsl:call-template name="local"><xsl:with-param name="url" select="sitemap:loc"/></xsl:call-template></xsl:attribute>
                <span class="card-top">
                  <span class="kind">
                    <xsl:choose>
                      <xsl:when test="contains(sitemap:loc, 'posts-sitemap')">Posts</xsl:when>
                      <xsl:when test="contains(sitemap:loc, 'category-sitemap')">Categories</xsl:when>
                      <xsl:when test="contains(sitemap:loc, 'label-sitemap')">Labels</xsl:when>
                      <xsl:when test="contains(sitemap:loc, 'image-sitemap')">Images</xsl:when>
                      <xsl:when test="contains(sitemap:loc, 'video-sitemap')">Videos</xsl:when>
                      <xsl:when test="contains(sitemap:loc, 'pages-sitemap')">Pages</xsl:when>
                      <xsl:otherwise>Sitemap</xsl:otherwise>
                    </xsl:choose>
                  </span>
                  <span class="date"><xsl:value-of select="sitemap:lastmod"/></span>
                </span>
                <h3>
                  <xsl:choose>
                    <xsl:when test="contains(sitemap:loc, 'posts-sitemap')">All published articles</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'category-sitemap')">Category pages</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'label-sitemap')">Topic label pages</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'image-sitemap')">Pictures in the articles</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'video-sitemap')">Videos in the articles</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'pages-sitemap')">Home, lists, topics and authors</xsl:when>
                    <xsl:otherwise>Sitemap file</xsl:otherwise>
                  </xsl:choose>
                </h3>
                <p>
                  <xsl:choose>
                    <xsl:when test="contains(sitemap:loc, 'posts-sitemap')">Every article, with the date it was last changed.</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'category-sitemap')">One page for each topic area.</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'label-sitemap')">Label pages that have at least three articles.</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'image-sitemap')">Each article with its cover and body pictures.</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'video-sitemap')">Each article that has a video.</xsl:when>
                    <xsl:when test="contains(sitemap:loc, 'pages-sitemap')">The home page, article lists, tag pages and author pages.</xsl:when>
                  </xsl:choose>
                </p>
                <span class="file"><xsl:value-of select="sitemap:loc"/></span>
                <span class="open">Open this sitemap and see its addresses</span>
              </a>
            </li>
          </xsl:for-each>
        </ul>
        <p class="note">About, Contact, Work with us and the policy pages are left out on purpose. They are marked noindex.</p>
      </div>
    </main>
  </xsl:template>

  <!-- ===================== one child sitemap ===================== -->
  <xsl:template match="sitemap:urlset">
    <xsl:variable name="hasImages" select="count(sitemap:url/image:image) &gt; 0"/>
    <xsl:variable name="hasVideos" select="count(sitemap:url/video:video) &gt; 0"/>
    <section class="hero">
      <div class="wrap">
        <p class="crumbs"><a href="/">Home</a> / <a href="/sitemap.xml">Sitemap index</a> / This file</p>
        <h1>
          <xsl:choose>
            <xsl:when test="$type = 'posts'">Posts sitemap</xsl:when>
            <xsl:when test="$type = 'category'">Categories sitemap</xsl:when>
            <xsl:when test="$type = 'label'">Labels sitemap</xsl:when>
            <xsl:when test="$type = 'pages'">Pages sitemap</xsl:when>
            <xsl:when test="$hasImages">Image sitemap</xsl:when>
            <xsl:when test="$hasVideos">Video sitemap</xsl:when>
            <xsl:otherwise>Sitemap</xsl:otherwise>
          </xsl:choose>
          <xsl:if test="number($parts) &gt; 1"><xsl:text> </xsl:text><span class="partno">part <xsl:value-of select="$part"/> of <xsl:value-of select="$parts"/></span></xsl:if>
        </h1>
        <p>
          <xsl:choose>
            <xsl:when test="$type = 'posts'">Every article in this file. Select an address to open the article.</xsl:when>
            <xsl:when test="$type = 'category'">The category pages. Select an address to open it.</xsl:when>
            <xsl:when test="$type = 'label'">The topic label pages. Select an address to open it.</xsl:when>
            <xsl:when test="$type = 'pages'">The home page, article lists, tag pages and author pages. Select an address to open it.</xsl:when>
            <xsl:when test="$hasImages">Each article address with the pictures that belong to it.</xsl:when>
            <xsl:when test="$hasVideos">Each article address with the video that belongs to it.</xsl:when>
            <xsl:otherwise>Addresses that search engines may index, with the date each one last changed.</xsl:otherwise>
          </xsl:choose>
          <xsl:text> Addresses </xsl:text><xsl:value-of select="$start"/><xsl:text> to </xsl:text><xsl:value-of select="$start - 1 + count(sitemap:url)"/><xsl:text>.</xsl:text>
        </p>
      </div>
    </section>
    <main>
      <div class="wrap">
        <div class="stats">
          <div class="stat"><b><xsl:value-of select="count(sitemap:url)"/></b><span>Addresses</span></div>
          <xsl:if test="$hasImages"><div class="stat"><b><xsl:value-of select="count(sitemap:url/image:image)"/></b><span>Pictures</span></div></xsl:if>
          <xsl:if test="$hasVideos"><div class="stat"><b><xsl:value-of select="count(sitemap:url/video:video)"/></b><span>Videos</span></div></xsl:if>
        </div>
        <h2 class="sec-title">Addresses in this file</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <xsl:if test="$hasImages or $hasVideos"><th>Preview</th></xsl:if>
                <th>Address</th>
                <th>Last changed</th>
                <xsl:if test="not($hasImages) and not($hasVideos)"><th>Change</th><th>Priority</th></xsl:if>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sitemap:url">
                <tr>
                  <td class="n"><xsl:value-of select="$start - 1 + position()"/></td>
                  <xsl:if test="$hasImages or $hasVideos">
                    <td>
                      <div class="thumbs">
                        <xsl:if test="image:image[1]/image:loc">
                          <img class="thumb" alt="" loading="lazy" width="72" height="48"><xsl:attribute name="src"><xsl:call-template name="local"><xsl:with-param name="url" select="image:image[1]/image:loc"/></xsl:call-template></xsl:attribute></img>
                          <xsl:if test="count(image:image) &gt; 1"><span class="more">+<xsl:value-of select="count(image:image) - 1"/></span></xsl:if>
                        </xsl:if>
                        <xsl:if test="video:video[1]/video:thumbnail_loc">
                          <img class="thumb" alt="" loading="lazy" width="72" height="48"><xsl:attribute name="src"><xsl:call-template name="local"><xsl:with-param name="url" select="video:video[1]/video:thumbnail_loc"/></xsl:call-template></xsl:attribute></img>
                        </xsl:if>
                      </div>
                    </td>
                  </xsl:if>
                  <td class="loc">
                    <xsl:if test="image:image[1]/image:title"><span class="title"><xsl:value-of select="image:image[1]/image:title"/></span></xsl:if>
                    <xsl:if test="video:video[1]/video:title">
                      <span class="title"><xsl:value-of select="video:video[1]/video:title"/><span class="tag">Video</span></span>
                    </xsl:if>
                    <a><xsl:attribute name="href"><xsl:call-template name="local"><xsl:with-param name="url" select="sitemap:loc"/></xsl:call-template></xsl:attribute><xsl:value-of select="sitemap:loc"/></a>
                  </td>
                  <td class="date"><xsl:value-of select="sitemap:lastmod"/></td>
                  <xsl:if test="not($hasImages) and not($hasVideos)">
                    <td class="freq"><xsl:value-of select="sitemap:changefreq"/></td>
                    <td>
                      <xsl:choose>
                        <xsl:when test="sitemap:priority &gt;= 0.8"><span class="pr hi"><xsl:value-of select="sitemap:priority"/></span></xsl:when>
                        <xsl:when test="sitemap:priority &gt;= 0.5"><span class="pr md"><xsl:value-of select="sitemap:priority"/></span></xsl:when>
                        <xsl:otherwise><span class="pr"><xsl:value-of select="sitemap:priority"/></span></xsl:otherwise>
                      </xsl:choose>
                    </td>
                  </xsl:if>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
        </div>
        <xsl:if test="string($prev) or string($next)">
          <nav class="pager" aria-label="Sitemap files">
            <xsl:if test="string($prev)"><a class="pill" rel="prev" href="{$prev}">&#8592; Previous file</a></xsl:if>
            <xsl:if test="string($next)"><a class="pill" rel="next" href="{$next}">Next file &#8594;</a></xsl:if>
          </nav>
        </xsl:if>
        <p class="note">This is a list for search engines and for people. Select any address to open that page on the site. <a href="/sitemap.xml">Back to the sitemap index</a>.</p>
      </div>
    </main>
  </xsl:template>

</xsl:stylesheet>
