#!/usr/bin/env node
// Static site generator for Mayobe Bros. No dependencies; needs Node 18+.
//
//   node scripts/build.mjs               build the whole site into the repo root
//   node scripts/build.mjs --check       validate content only, write nothing
//   node scripts/build.mjs --no-samples  leave out posts marked `sample: true`
//   node scripts/build.mjs --api <url>   override commentsApi (for local testing only)
//
// Sources:  site.config.json · content/categories.json · content/posts/*.md · content/pages/*.html
// Output:   index.html, post/, category/, label/, popular/, search/, author/, <page>/, 404.html,
//           sitemap.xml, feed.xml, robots.txt, manifest.json, data/search.json, assets/share/*.jpg (link-preview pictures,
//           see scripts/lib/share.mjs; needs Chromium and ffmpeg, otherwise it only warns)
// Every generated file is recorded in .build-manifest.json so removed posts are cleaned up.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFrontMatter } from './lib/frontmatter.mjs';
import { markdown, addHeadingIds, plainText, slugify } from './lib/markdown.mjs';
import { createRenderer } from './lib/render.mjs';
import { lintPost } from './lib/lint.mjs';
import { makeShareCards } from './lib/share.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = new Set(argv);
const CHECK_ONLY = args.has('--check');
const NO_SAMPLES = args.has('--no-samples');
const API_OVERRIDE = argv.includes('--api') ? argv[argv.indexOf('--api') + 1] : null;

const RESERVED_TOP = new Set(['post', 'category', 'label', 'popular', 'search', 'data', 'assets', 'css', 'js', 'content', 'scripts', 'worker', 'vendor', 'tag', 'author', '404', 'index', 'feed', 'sitemap']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const errors = [];
const warnings = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch (err) {
    console.error(`Cannot read ${file}: ${err.message}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------- image dimensions */
function imageSize(rel) {
  if (!rel || /^(https?:)?\/\//.test(rel)) return null;
  const f = path.join(ROOT, rel.replace(/^\//, ''));
  if (!fs.existsSync(f)) return null;
  const b = fs.readFileSync(f);
  try {
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const t = b.toString('ascii', 12, 16);
      if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
      if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    }
    if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i < b.length; ) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return null;
}

/* ----------------------------------------------------------------- config */
const DEFAULTS = {
  language: 'en',
  themeColor: '#1e40af',
  basePath: '',
  postsPerPage: 15,
  homeRecentCount: 6,
  author: 'Mayobe Bros',
  heroBadge: 'Knowledge & Insights',
  footerText: 'Clear, honest guides on education, money, business and technology in Tanzania.',
  contact: { general: '', support: '', executive: '', formAction: '' },
  social: {},
  authors: [],
  pageHeroes: {},
  adsense: { client: '', autoAds: false, sidebarSlot: '' },
  commentsApi: '',
  turnstileSiteKey: '',
  blockAiCrawlers: true,
};
const userConfig = readJson('site.config.json');
const config = { ...DEFAULTS, ...userConfig, contact: { ...DEFAULTS.contact, ...userConfig.contact }, adsense: { ...DEFAULTS.adsense, ...userConfig.adsense } };
if (API_OVERRIDE !== null) config.commentsApi = API_OVERRIDE;
if (!config.siteUrl || !/^https?:\/\//.test(config.siteUrl)) fail('site.config.json', '"siteUrl" must be a full URL such as https://mayobebros.com');
if (config.basePath && !/^\/[^/].*[^/]$|^\/[^/]$/.test(config.basePath)) fail('site.config.json', '"basePath" must be empty or look like "/repo-name" (leading slash, no trailing slash)');
if (config.commentsApi && !/^https?:\/\//.test(config.commentsApi)) fail('site.config.json', '"commentsApi" must be a full URL or empty');
if (config.adsense.sidebarSlot && !/^\d{6,20}$/.test(String(config.adsense.sidebarSlot).trim())) warn('site.config.json', '"adsense.sidebarSlot" should be only the numbers of the ad unit (data-ad-slot), for example "1234567890"; the sidebar ad is left out until it is');
const authors = (config.authors || []).map((a) => ({ ...a, slug: a.slug || slugify(a.name) }));

/* ------------------------------------------------------------- categories */
const allCategories = readJson('content/categories.json');
const catSlugs = new Set();
for (const c of allCategories) {
  c.labels = c.labels || [];
  if (!c.name || !c.slug) fail('content/categories.json', `every category needs a name and slug (${JSON.stringify(c).slice(0, 60)})`);
  if (c.slug && !SLUG_RE.test(c.slug)) fail('content/categories.json', `category slug "${c.slug}" must be lowercase letters, numbers and hyphens`);
  if (c.slug === 'page') fail('content/categories.json', 'category slug "page" is reserved');
  if (catSlugs.has(c.slug)) fail('content/categories.json', `duplicate category slug "${c.slug}"`);
  catSlugs.add(c.slug);
  const ls = new Set();
  for (const l of c.labels) {
    if (!l.name || !l.slug || !SLUG_RE.test(l.slug)) fail('content/categories.json', `label in "${c.slug}" needs a name and a valid slug (${l.slug})`);
    if (l.slug === 'page') fail('content/categories.json', 'label slug "page" is reserved');
    if (ls.has(l.slug)) fail('content/categories.json', `duplicate label "${l.slug}" in "${c.slug}"`);
    ls.add(l.slug);
  }
}

/* ------------------------------------------------------------------ posts */
function parseDate(value, where, field = 'date') {
  if (!value) return null;
  const s = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) {
    fail(where, `"${field}: ${s}" is not a valid date (use YYYY-MM-DD)`);
    return null;
  }
  return d;
}

// Markdown refers to pictures as `assets/posts/x.webp`; make those absolute (and add width/height so the page does not jump).
const BASE = (config.basePath || '').replace(/\/$/, '');
function localizeHtml(html) {
  html = html.replace(/<img\b([^>]*?)\ssrc="(?!https?:|\/\/|data:|\/)([^"]+)"([^>]*)>/gi, (m, pre, src, post) => {
    const s = imageSize(src);
    const dims = s && !/\swidth=/.test(pre + post) ? ` width="${s.w}" height="${s.h}"` : '';
    return `<img${pre} src="${BASE}/${src}"${dims}${post}>`;
  });
  if (BASE) html = html.replace(/\b(href|src|poster)="\/(?!\/)/g, `$1="${BASE}/`);
  return html;
}

const postsDir = path.join(ROOT, 'content/posts');
const postFiles = fs.existsSync(postsDir) ? fs.readdirSync(postsDir).filter((f) => /\.(md|markdown|html)$/i.test(f)).sort() : [];
const posts = [];
const seen = new Map();
let drafts = 0;
let skippedSamples = 0;
const now = Date.now();

for (const file of postFiles) {
  const where = `content/posts/${file}`;
  const { data, body } = parseFrontMatter(fs.readFileSync(path.join(postsDir, file), 'utf8'));
  if (data.draft === true) {
    drafts++;
    continue;
  }
  if (NO_SAMPLES && data.sample === true) {
    skippedSamples++;
    continue;
  }
  const slug = String(data.slug || file.replace(/\.[^.]+$/, ''));
  if (!SLUG_RE.test(slug)) fail(where, `slug "${slug}" must be lowercase letters, numbers and hyphens`);
  if (seen.has(slug)) fail(where, `slug "${slug}" is already used by ${seen.get(slug)}`);
  seen.set(slug, file);
  if (!data.title) fail(where, 'missing "title"');
  if (!data.date) fail(where, 'missing "date" (YYYY-MM-DD)');
  if (!data.category) fail(where, 'missing "category"');
  const cat = allCategories.find((c) => c.slug === data.category);
  if (data.category && !cat) fail(where, `unknown category "${data.category}". Known: ${[...catSlugs].join(', ')}`);
  let label = null;
  if (data.label) {
    label = cat?.labels.find((l) => l.slug === data.label) || null;
    if (cat && !label) fail(where, `unknown label "${data.label}" in category "${cat.slug}". Known: ${cat.labels.map((l) => l.slug).join(', ') || '(none)'}`);
  }
  const date = parseDate(data.date, where);
  const updated = parseDate(data.updated, where, 'updated');
  if (date && date.getTime() > now + 86400000) warn(where, `date ${data.date} is in the future; it is still published by this build`);

  let html = /\.html$/i.test(file) ? body : markdown(body);
  html = html.replace(/<(\/?)h1\b/gi, '<$1h2'); // the page title is the only <h1>
  const withIds = addHeadingIds(html);
  withIds.html = localizeHtml(withIds.html);
  const text = plainText(withIds.html);
  const words = text ? text.split(/\s+/).length : 0;
  let excerpt = data.excerpt ? String(data.excerpt) : '';
  if (!excerpt) {
    excerpt = text.length > 155 ? `${text.slice(0, 155).replace(/\s+\S*$/, '')}…` : text;
    warn(where, 'no "excerpt"; using the first sentence of the post');
  } else if (excerpt.length > 190) warn(where, `excerpt is ${excerpt.length} characters; search engines cut it near 160`);
  if (!data.image) warn(where, 'no "image"; the category picture is shown instead');
  else if (/^\/?assets\//.test(String(data.image)) && !fs.existsSync(path.join(ROOT, String(data.image).replace(/^\//, '')))) fail(where, `image file not found: ${data.image}`);
  if (!cat || !date) continue;
  const tags = Array.isArray(data.tags) ? data.tags : data.tags ? String(data.tags).split(',').map((t) => t.trim()).filter(Boolean) : [];
  const size = imageSize(data.image ? String(data.image) : '');
  // imageFocus: 0 to 100, how far down the cover the link-preview picture looks (0 = top edge, 100 = bottom edge; default 40)
  let imageFocus;
  if (data.imageFocus !== undefined && data.imageFocus !== '') {
    imageFocus = Number(data.imageFocus);
    if (!Number.isFinite(imageFocus) || imageFocus < 0 || imageFocus > 100) {
      warn(where, `"imageFocus: ${data.imageFocus}" must be a number from 0 to 100; using the default`);
      imageFocus = undefined;
    }
  }
  const post = {
    slug, file,
    title: String(data.title || ''),
    date, updated, category: cat, label, excerpt,
    image: data.image ? String(data.image) : '',
    imageAlt: data.imageAlt ? String(data.imageAlt) : '',
    imageCredit: data.imageCredit ? String(data.imageCredit) : '',
    imageSource: /^https?:\/\//.test(String(data.imageSource || '')) ? String(data.imageSource) : '',
    imageW: size?.w, imageH: size?.h, imageFocus,
    author: data.author ? String(data.author) : config.author,
    featured: data.featured === true,
    tags,
    aliases: Array.isArray(data.aliases) ? data.aliases.map(String) : data.aliases ? [String(data.aliases)] : [],
    metaTitle: data.metaTitle ? String(data.metaTitle) : '',
    metaDescription: data.metaDescription ? String(data.metaDescription) : '',
    sample: data.sample === true,
    html: withIds.html, toc: withIds.toc, text, words,
    videos: [...body.matchAll(/^\s{0,3}::(video|youtube)\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/gm)].map((m) => ({ kind: m[1], caption: m[2].trim(), src: m[3], poster: /(?:^|\s)poster=(\S+)/.exec(m[4] || '')?.[1] || '' })),
    readingMinutes: Math.max(1, Math.round(words / 200)),
    path: `/post/${cat.slug}/${label ? `${label.slug}/` : ''}${slug}/`,
  };
  for (const m of lintPost(post)) warn(where, m);
  posts.push(post);
}
posts.sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));

// Every category is shown. A category with no posts yet is marked `empty`: its page tells readers so, lists the latest
// articles instead, is kept out of search engines and the sitemap, and appears under "More" in the menu.
// Labels are shown too, whether or not they have posts yet.
const SHOW_EMPTY = config.showEmptyTopics !== false; // false = hide categories and labels until their first post
const categories = allCategories.map((c) => {
  const has = posts.some((p) => p.category.slug === c.slug);
  // every label is kept; `empty` marks the ones that have no post yet (their page says so, is noindex and stays out of the sitemap)
  return { ...c, empty: !has, labels: c.labels.map((l) => ({ ...l, empty: !posts.some((p) => p.category.slug === c.slug && p.label?.slug === l.slug) })).filter((l) => SHOW_EMPTY || !l.empty) };
}).filter((c) => SHOW_EMPTY || !c.empty);

/* ------------------------------------------------------------------ pages */
const pagesDir = path.join(ROOT, 'content/pages');
const pageFiles = fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter((f) => /\.(html|md)$/i.test(f)).sort() : [];
const pages = [];
for (const file of pageFiles) {
  const where = `content/pages/${file}`;
  const { data, body } = parseFrontMatter(fs.readFileSync(path.join(pagesDir, file), 'utf8'));
  const slug = String(data.slug || file.replace(/\.[^.]+$/, ''));
  if (!SLUG_RE.test(slug)) fail(where, `page slug "${slug}" is not valid`);
  if (RESERVED_TOP.has(slug)) fail(where, `page slug "${slug}" collides with a reserved folder`);
  if (!data.title) fail(where, 'missing "title"');
  if (!data.description) warn(where, 'missing "description"');
  pages.push({
    slug,
    title: String(data.title || slug),
    heading: data.heading ? String(data.heading) : '',
    subtitle: data.subtitle ? String(data.subtitle) : '',
    description: String(data.description || data.title || ''),
    kind: data.kind ? String(data.kind) : 'legal',
    menu: data.menu === true,
    order: Number(data.order ?? 50),
    hero: data.hero ? String(data.hero) : '',
    updated: parseDate(data.updated, where, 'updated'),
    html: /\.md$/i.test(file) ? markdown(body) : body,
  });
}
pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
for (const a of authors) if (!a.name || !a.bio) fail('site.config.json', `each author needs "name" and "bio" (${a.name || '?'})`);
for (const p of posts) if (p.author !== config.author && !authors.some((a) => a.name === p.author)) warn(`content/posts/${p.file}`, `author "${p.author}" has no entry in site.config.json "authors" (no author page or bio)`);

if (errors.length) {
  console.error(`\n✖ ${errors.length} problem${errors.length > 1 ? 's' : ''} found. Nothing was built.\n`);
  for (const m of errors) console.error(`  • ${m}`);
  if (warnings.length) console.error(`\n  (${warnings.length} warning${warnings.length > 1 ? 's' : ''} not shown until errors are fixed)`);
  process.exit(1);
}

/* ------------------------------------------------------------------ build */
const hashFile = (f) => (fs.existsSync(path.join(ROOT, f)) ? crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 8) : '');
const versions = { 'css/style.css': hashFile('css/style.css'), 'js/site.js': hashFile('js/site.js'), 'js/engage.js': hashFile('js/engage.js'), 'js/listen.js': hashFile('js/listen.js'), 'js/pager.js': hashFile('js/pager.js') };
// Topic photographs: assets/img/topics/<name>-<width>.webp -> { name: [1280, 2560, 3840] }
const heroSets = {};
const topicsDir = path.join(ROOT, 'assets/img/topics');
if (fs.existsSync(topicsDir)) {
  for (const f of fs.readdirSync(topicsDir)) {
    const m = /^([a-z0-9-]+)-(\d+)\.webp$/.exec(f);
    if (m) (heroSets[m[1]] = heroSets[m[1]] || []).push(Number(m[2]));
  }
  for (const k of Object.keys(heroSets)) heroSets[k].sort((a, b) => a - b);
}

// Link-preview pictures (what WhatsApp, Facebook, X, LinkedIn, Telegram show): one JPEG per post, category and label, plus the home page.
const localCover = (...c) => (c.find((x) => x && !/^(https?:)?\/\//i.test(x) && !x.startsWith('data:')) || '').replace(/^\//, '');
const shareSpecs = [{ id: 'site', source: localCover(config.heroImage, config.logo), chip: config.heroBadge || '', focus: Number.isFinite(Number(config.shareFocus)) ? Number(config.shareFocus) : 22 }];
for (const c of categories) {
  shareSpecs.push({ id: `category-${c.slug}`, source: localCover(c.image, config.heroImage), chip: c.name });
  for (const l of c.labels) shareSpecs.push({ id: `label-${c.slug}-${l.slug}`, source: localCover(l.image, c.image, config.heroImage), chip: l.name });
}
for (const p of posts) shareSpecs.push({ id: `post-${p.slug}`, source: localCover(p.image, p.category.image, config.heroImage), chip: p.category.name, focus: p.imageFocus });
const share = makeShareCards(shareSpecs.filter((s) => s.source), { root: ROOT, host: new URL(config.siteUrl).host, dryRun: CHECK_ONLY });
for (const m of share.warnings) warn('share pictures', m);

const R = createRenderer({ config, categories, posts, pages, authors, versions, heroSets, shareCards: share.cards });

const out = new Map();
const emit = (relPath, content) => out.set(relPath, content);
const pageFile = (urlPath) => (urlPath === '/' ? 'index.html' : `${urlPath.replace(/^\//, '')}index.html`);
const chunk = (arr, n) => {
  const r = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r.length ? r : [[]];
};
const per = Number(config.postsPerPage) || 15;

emit('index.html', R.home());
emit('404.html', R.notFound());
emit(pageFile('/category/'), R.categoriesIndex());
emit(pageFile('/label/'), R.labelsIndex());
emit(pageFile('/search/'), R.searchPage());

const dirPages = chunk(posts, per);
dirPages.forEach((list, i) => emit(pageFile(i === 0 ? '/post/' : `/post/page/${i + 1}/`), R.postsDirectory(i + 1, dirPages.length, list, posts.length)));

const popularAll = [...posts.filter((p) => p.featured), ...posts.filter((p) => !p.featured)];
const popularPages = chunk(popularAll, per);
popularPages.forEach((list, i) => emit(pageFile(i === 0 ? '/popular/' : `/popular/page/${i + 1}/`), R.popular(i + 1, popularPages.length, list, popularAll.length)));

for (const c of categories) {
  const inCat = posts.filter((p) => p.category.slug === c.slug);
  const cp = chunk(inCat, per);
  cp.forEach((list, i) => emit(pageFile(i === 0 ? `/category/${c.slug}/` : `/category/${c.slug}/page/${i + 1}/`), R.category(c, null, i + 1, cp.length, list, inCat.length)));
  if (!cp.length) emit(pageFile(`/category/${c.slug}/`), R.category(c, null, 1, 1, [], 0));
  for (const l of c.labels) {
    const inLabel = inCat.filter((p) => p.label?.slug === l.slug);
    const lp = chunk(inLabel, per);
    lp.forEach((list, i) => emit(pageFile(i === 0 ? `/category/${c.slug}/${l.slug}/` : `/category/${c.slug}/${l.slug}/page/${i + 1}/`), R.category(c, l, i + 1, lp.length, list, inLabel.length)));
  }
}
posts.forEach((p, i) => {
  emit(pageFile(p.path), R.post(p, i));
  // posts inside a label are also reachable at /post/<category>/<slug>/ (the old site used both forms)
  if (p.label) emit(pageFile(`/post/${p.category.slug}/${p.slug}/`), R.aliasStub(`/post/${p.category.slug}/${p.slug}/`, p.path, p.title, p));
  // old addresses (after a slug change) keep working
  for (const a of p.aliases) {
    if (!SLUG_RE.test(a)) continue;
    emit(pageFile(`/post/${p.category.slug}/${a}/`), R.aliasStub(`/post/${p.category.slug}/${a}/`, p.path, p.title, p));
    if (p.label) emit(pageFile(`/post/${p.category.slug}/${p.label.slug}/${a}/`), R.aliasStub(`/post/${p.category.slug}/${p.label.slug}/${a}/`, p.path, p.title, p));
  }
});
for (const pg of pages) emit(pageFile(`/${pg.slug}/`), R.staticPage(pg));
for (const t of R.tagTopics) {
  const tp = chunk(t.list, per);
  tp.forEach((list, i) => emit(pageFile(i === 0 ? `/tag/${t.slug}/` : `/tag/${t.slug}/page/${i + 1}/`), R.tagPage(t, list, i + 1, tp.length, t.list.length)));
}
for (const a of authors) {
  const mine = posts.filter((p) => p.author === a.name);
  const ap = chunk(mine, per);
  ap.forEach((list, i) => emit(pageFile(i === 0 ? `/author/${a.slug}/` : `/author/${a.slug}/page/${i + 1}/`), R.authorPage(a, list, i + 1, ap.length, mine.length)));
}

for (const [name, content] of R.sitemaps()) emit(name, content);
for (const [urlPath, html] of R.sitemapHtml()) emit(pageFile(urlPath), html);
emit('sitemap.xsl', fs.readFileSync(path.join(ROOT, 'scripts/tools/sitemap.xsl'), 'utf8'));
emit('feed.xml', R.feed());
emit('feed.css', fs.readFileSync(path.join(ROOT, 'scripts/tools/feed.css'), 'utf8').replace(/\{\{name\}\}/g, config.name).replace(/\{\{rss-page\}\}/g, R.helpers.abs('/rss/')));
emit(pageFile('/rss/'), R.rssPage());
emit('robots.txt', R.robots());
emit('manifest.json', R.manifest());
emit('data/search.json', R.searchIndex());

if (CHECK_ONLY) {
  report(0, 0);
  console.log('\n(--check: nothing written)');
  process.exit(0);
}

/* ------------------------------------------------------- write + cleanup */
const MANIFEST = '.build-manifest.json';
const inRoot = (p) => {
  const abs = path.resolve(ROOT, p);
  return abs.startsWith(ROOT + path.sep) ? abs : null;
};
let written = 0;
for (const [relPath, content] of out) {
  const abs = inRoot(relPath);
  if (!abs) throw new Error(`refusing to write outside the project: ${relPath}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== content) {
    fs.writeFileSync(abs, content);
    written++;
  }
}

let removed = 0;
const manifestPath = path.join(ROOT, MANIFEST);
if (fs.existsSync(manifestPath)) {
  let previous = [];
  try {
    previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files || [];
  } catch {}
  for (const relPath of previous) {
    if (out.has(relPath)) continue;
    const abs = inRoot(relPath);
    if (abs && fs.existsSync(abs)) {
      fs.rmSync(abs);
      removed++;
      for (let dir = path.dirname(abs); dir !== ROOT && fs.existsSync(dir) && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir);
    }
  }
}
fs.writeFileSync(manifestPath, JSON.stringify({ note: 'Files generated by scripts/build.mjs. Do not edit by hand.', files: [...out.keys()].sort() }, null, 1) + '\n');

report(written, removed);

function report(w, r) {
  for (const m of warnings) console.warn(`  ! ${m}`);
  const sampleCount = posts.filter((p) => p.sample).length;
  console.log(
    `\n✔ ${posts.length} post${posts.length === 1 ? '' : 's'}${sampleCount ? ` (${sampleCount} sample)` : ''}, ${categories.length} categories shown, ${pages.length} pages → ${out.size} files` +
      `${CHECK_ONLY ? '' : ` (${w} written, ${r} removed)`}` +
      `${drafts ? ` · ${drafts} draft${drafts > 1 ? 's' : ''} skipped` : ''}${skippedSamples ? ` · ${skippedSamples} sample${skippedSamples > 1 ? 's' : ''} left out` : ''}` +
      `${config.commentsApi ? '' : '\n  (comments and reactions are OFF: set "commentsApi" in site.config.json once the Worker is deployed)'}`,
  );
}
