// HTML templates for every page type. Pure functions: data in, HTML string out.
import { escapeHtml as e, addHeadingIds } from './markdown.mjs';

/* ------------------------------------------------------------------ icons */
const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  rxLike: '<path d="M12 20.2S4.6 15.9 4.6 10.2A4.2 4.2 0 0 1 12 7.7a4.2 4.2 0 0 1 7.4 2.5c0 5.7-7.4 10-7.4 10Z"/>',
  rxAmazed: '<path d="M10.5 6.5c.5 4 2 5.5 6 6-4 .5-5.5 2-6 6-.5-4-2-5.5-6-6 4-.5 5.5-2 6-6Z"/><path d="M18.5 3.5v4M16.5 5.5h4"/>',
  rxSad: '<path d="M12 3.8c3.2 3.9 5.4 6.8 5.4 9.8a5.4 5.4 0 0 1-10.8 0c0-3 2.2-5.9 5.4-9.8Z"/><path d="M9.6 14.6a2.6 2.6 0 0 0 1.9 1.9"/>',
  rxAngry: '<path d="M12 20.8c-3.7 0-6.2-2.5-6.2-5.9 0-2.5 1.5-4.2 2.9-5.7.4 1.5 1.3 2.3 2.3 2.6C11 8.4 11.7 5.7 13.8 3.2c.2 2.9 3.5 4.8 4.3 8 .9 4.2-1.7 9.6-6.1 9.6Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  twitter: '<path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
  trendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  skipBack: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
  skipForward: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  chevronsDown: '<path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
};

const BRANDS = {
  facebook: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  whatsapp: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z',
  linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  instagram: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
};
// real logo shapes (Simple Icons, CC0) for the sharing and social buttons; filled, so they can take the brand colour on hover
export function brandIcon(name, size = 18) {
  return `<svg class="icon icon-brand" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${BRANDS[name] || ''}"/></svg>`;
}

export function icon(name, size = 20, cls = '') {
  return `<svg class="icon${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

export const REACTIONS = [
  ['like', 'rxLike', 'Like'],
  ['amazed', 'rxAmazed', 'Amazed'],
  ['sad', 'rxSad', 'Sad'],
  ['angry', 'rxAngry', 'Angry'],
];

const LABEL_HEADINGS = (label, cat) => [
  { heading: `Inside ${label}`, sub: `The stories shaping ${cat}, picked for curious minds` },
  { heading: `${label} Spotlight`, sub: `Deep dives and fresh angles from ${cat}` },
  { heading: `Fresh from ${label}`, sub: `What is new and what matters in ${cat}` },
  { heading: `${label} in Focus`, sub: `Essential reads for everyone following ${cat}` },
];

const BOT_RULES = ['GPTBot', 'CCBot', 'anthropic-ai', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'meta-externalagent', 'cohere-ai', 'Diffbot', 'omgilibot', 'ImagesiftBot'];
const NO_AD_PAGES = new Set(['legal', 'search', 'notfound']);

// The newsletter switch. "newsletterAction" in site.config.json is "" (off: the footer shows the RSS button) or "api" (the footer form
// posts to the comments API); `node scripts/build.mjs --newsletter` turns it on for one build. Any other value is a build error.
export function newsletterSetting(action, flag = false) {
  const a = action === undefined || action === null ? '' : action;
  if (a !== '' && a !== 'api') return { error: '"newsletterAction" must be "" (off) or "api" (the footer form posts to the comments API)' };
  return { action: flag ? 'api' : a };
}
// On only when there is a comments API to post to.
export const newsletterOn = (config) => !!(config.commentsApi || '').trim() && config.newsletterAction === 'api';

export function createRenderer(ctx) {
  const { config, categories, posts, pages, authors, versions, heroSets = {}, shareCards = new Map(), qa = {} } = ctx;
  const base = (config.basePath || '').replace(/\/$/, '');
  const siteUrl = config.siteUrl.replace(/\/$/, '');
  const api = (config.commentsApi || '').replace(/\/$/, '');
  const newsletter = newsletterOn(config);
  const adsenseId = (config.adsense?.client || '').trim();
  const cfToken = /^[a-f0-9]{32}$/.test(config.analytics?.cloudflareToken || '') ? config.analytics.cloudflareToken : ''; // Cloudflare Web Analytics: no cookies, so it loads for every visitor
  const gtmId = /^GTM-[A-Z0-9]{4,12}$/.test(config.analytics?.gtmId || '') ? config.analytics.gtmId : '';

  const u = (p) => `${base}${p}`;
  const abs = (p) => `${siteUrl}${base}${p}`;
  const assetUrl = (p) => `${u('/' + p)}${versions[p] ? `?v=${versions[p]}` : ''}`;
  const resolveImage = (src) => {
    if (!src) return '';
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src;
    return u(src.startsWith('/') ? src : '/' + src);
  };
  const absImage = (src) => {
    const r = resolveImage(src);
    return /^https?:/i.test(r) ? r : `${siteUrl}${r}`;
  };
  const fmtDate = (d, long = false) => d.toLocaleDateString('en-US', { year: 'numeric', month: long ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' });
  const timeTag = (d, long) => `<time datetime="${d.toISOString()}">${fmtDate(d, long)}</time>`;
  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  const nameParts = () => {
    const w = config.name.trim().split(/\s+/);
    return w.length > 1 ? [w.slice(0, -1).join(' '), w[w.length - 1]] : [config.name, ''];
  };
  // Tags: a tag used by 2 or more articles becomes a topic page at /tag/<slug>/; one used by 3 or more is also indexable and in the sitemap.
  const tagSlug = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const tagMap = new Map();
  posts.forEach((x) => x.tags.forEach((t) => { const k = tagSlug(t); if (!k) return; const cur = tagMap.get(k) || { slug: k, name: t, list: [] }; if (!cur.list.includes(x)) cur.list.push(x); tagMap.set(k, cur); }));
  const tagTopics = [...tagMap.values()].filter((t) => t.list.length >= 2).sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  const tagHref = (t) => (tagMap.get(tagSlug(t))?.list.length >= 2 ? u(`/tag/${tagSlug(t)}/`) : u(`/search/?q=${encodeURIComponent(t)}`));
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

  // Pool of local pictures for hero banners (never hot-linked)
  const pool = [...new Set([...categories.map((c) => c.image), ...posts.map((p) => p.image)].filter((x) => x && !/^https?:/i.test(x)))];
  const heroFor = (key, preferred) => resolveImage(preferred || config.pageHeroes?.[key] || (pool.length ? pool[hash(key) % pool.length] : config.heroImage));
  const fallbackImage = (p) => resolveImage(p?.image || p?.category?.image || config.heroImage);
  const authorOf = (name) => authors.find((a) => a.name === name) || null;

  /* ------------------------------------------------------------- <head> */
  // The picture apps show when a link is shared. It is always a 1200 x 630 JPEG from assets/share/ (see scripts/lib/share.mjs): never the
  // WebP cover, which WhatsApp and others may not show. The "?v=" part changes when the picture is redrawn, so apps that cache by
  // address fetch the new one. Pages without a card of their own (about, search, ...) share the home card; if no card could be drawn,
  // the brand JPEG from site.config.json "ogImage" is used.
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  function shareImage(share, alt) {
    const own = shareCards.get(share);
    const card = own || shareCards.get('site');
    if (card) return { url: absImage(`/${card.rel}?v=${card.v}`), w: card.w, h: card.h, type: 'image/jpeg', alt: own ? alt : '' };
    const src = config.ogImage || config.logo;
    return { url: absImage(src), w: 1200, h: 630, type: MIME[(src.split('.').pop() || '').toLowerCase()] || 'image/jpeg', alt: '' };
  }

  // <title> gets the brand when it still fits in search results; og:title and twitter:title never do: WhatsApp's own guide says the title
  // must be "without any branding" (the app prints the domain under it), and it shows at most 2 lines, so the brand would only push words out.
  function head({ title, description, path, share = '', imageAlt = '', type = 'website', jsonLd = [], noindex = false, article = null, preload = '', noReferrer = false }) {
    // the brand is added only when the whole title still fits in search results (about 60 characters)
    const branded = `${title} | ${config.name}`;
    const fullTitle = title === config.title || branded.length > 62 ? title : branded;
    const url = abs(path);
    const si = shareImage(share, imageAlt);
    const img = si.url;
    const robots = noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
    const ogSize = `\n<meta property="og:image:secure_url" content="${img}">\n<meta property="og:image:type" content="${si.type}">\n<meta property="og:image:width" content="${si.w}">\n<meta property="og:image:height" content="${si.h}">${si.alt ? `\n<meta property="og:image:alt" content="${e(si.alt)}">` : ''}`;
    const art = article
      ? `
<meta property="article:published_time" content="${article.published}">
<meta property="article:modified_time" content="${article.modified}">
<meta property="article:section" content="${e(article.section)}">
<meta property="article:author" content="${e(article.authorUrl || article.author)}">${article.tags.map((t) => `\n<meta property="article:tag" content="${e(t)}">`).join('')}`
      : '';
    return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="content-language" content="${config.language}">
<title>${e(fullTitle)}</title>
<meta name="description" content="${e(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="${robots}">${noReferrer ? '\n<meta name="referrer" content="no-referrer">' : ''}
<meta name="author" content="${e(config.author)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#070b14" media="(prefers-color-scheme: dark)">${config.verification?.yandex ? `\n<meta name="yandex-verification" content="${e(config.verification.yandex)}">` : ''}${adsenseId ? `\n<meta name="google-adsense-account" content="${e(adsenseId)}">` : ''}${config.verification?.google ? `\n<meta name="google-site-verification" content="${e(config.verification.google)}">` : ''}${config.verification?.bing ? `\n<meta name="msvalidate.01" content="${e(config.verification.bing)}">` : ''}
<link rel="icon" href="${u('/favicon.ico')}" sizes="16x16 32x32 48x48">
<link rel="icon" href="${u('/assets/img/favicon-48.png')}" type="image/png" sizes="48x48">
<link rel="icon" href="${u('/assets/img/favicon-32.png')}" type="image/png" sizes="32x32">
<link rel="icon" href="${u('/assets/img/icon-192.png')}" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${u('/assets/img/icon-180.png')}">
<link rel="manifest" href="${u('/manifest.json')}">
<link rel="alternate" type="application/rss+xml" title="${e(config.name)} RSS Feed" href="${u('/feed.xml')}">
<meta property="og:site_name" content="${e(config.name)}">
<meta property="og:locale" content="en_US">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">${ogSize}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${img}">${si.alt ? `\n<meta name="twitter:image:alt" content="${e(si.alt)}">` : ''}${art}${preload ? `\n<link rel="preload" as="image" href="${preload}"${topicSet(preload) ? ` imagesrcset="${topicSet(preload)}" imagesizes="100vw"` : ''} fetchpriority="high">` : ''}${api ? `\n<link rel="preconnect" href="${new URL(api).origin}" crossorigin>` : ''}
<script>(function(){var d=document.documentElement,t=null;d.classList.add('js');try{t=localStorage.getItem('theme')}catch(e){}if(t==='dark')d.classList.add('dark');else if(t==='light')d.classList.add('light');else if(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark')})();</script>
<link rel="stylesheet" href="${assetUrl('css/style.css')}">${jsonLd.map((j) => `\n<script type="application/ld+json">${json(j)}</script>`).join('')}`;
  }

  /* ------------------------------------------------------------- header */
  function header(cur = {}) {
    const active = (cond) => (cond ? ' is-active' : '');
    const menuPages = pages.filter((p) => p.menu);
    const catItem = (c) => {
      const isCat = cur.cat === c.slug;
      const link = `<a class="nav-link${active(isCat)}" href="${u(`/category/${c.slug}/`)}"${isCat ? ' aria-current="page"' : ''}>${e(c.name)}${c.labels.length ? icon('chevronDown', 13, 'nav-caret') : ''}</a>`;
      if (!c.labels.length) return `<div class="nav-item">${link}</div>`;
      return `<div class="nav-item has-sub">${link}<div class="submenu">${c.labels.map((l) => `<a href="${u(`/category/${c.slug}/${l.slug}/`)}">${e(l.name)}</a>`).join('')}</div></div>`;
    };
    // Categories that have no post yet sit under "More". On very wide screens there is room, so they show inline instead.
    const emptyCats = categories.filter((c) => c.empty);
    const moreOn = emptyCats.some((c) => cur.cat === c.slug);
    const more = emptyCats.length
      ? `<div class="nav-item has-sub nav-more"><button class="nav-link${active(moreOn)}" type="button" aria-haspopup="true">More${icon('chevronDown', 13, 'nav-caret')}</button><div class="submenu">${emptyCats.map((c) => `<a href="${u(`/category/${c.slug}/`)}">${e(c.name)}</a>`).join('')}</div></div>`
      : '';
    const dropdown = categories.map((c) => (c.empty ? catItem(c).replace('class="nav-item', 'class="nav-item nav-empty') : catItem(c))).join('') + more;
    const drawerCats = categories
      .map((c) => {
        const link = `<a class="drawer-link${active(cur.cat === c.slug)}" href="${u(`/category/${c.slug}/`)}">${e(c.name)}</a>`;
        if (!c.labels.length) return `<div>${link}</div>`;
        return `<details class="drawer-group"${cur.cat === c.slug ? ' open' : ''}><summary>${e(c.name)}${icon('chevronDown', 15, 'drawer-caret')}</summary><div class="drawer-sub"><a href="${u(`/category/${c.slug}/`)}">All ${e(c.name)}</a>${c.labels.map((l) => `<a href="${u(`/category/${c.slug}/${l.slug}/`)}">${e(l.name)}</a>`).join('')}</div></details>`;
      })
      .join('');
    const brand = `<img src="${resolveImage(config.logoSmall || config.logo)}" alt="${e(config.name)}" width="246" height="48">`;
    return `<a class="skip-link" href="#main">Skip to content</a>
<div class="read-progress" aria-hidden="true"><span></span></div>
<header class="site-header" id="top">
  <div class="wrap">
    <div class="header-top">
      <a class="brand" href="${u('/')}" aria-label="${e(config.name)} home">${brand}</a>
      <div class="header-actions">
        <button class="icon-btn" type="button" data-search-open aria-label="Search" aria-haspopup="dialog">${icon('search')}</button>
        <button class="icon-btn theme-btn" type="button" data-theme-toggle aria-label="Theme: follows your device. Click to change.">${icon('monitor', 20, 'i-auto')}${icon('sun', 20, 'i-sun')}${icon('moon', 20, 'i-moon')}</button>
        <button class="icon-btn menu-btn" type="button" data-drawer-open aria-label="Open menu" aria-controls="drawer" aria-expanded="false">${icon('menu', 24)}</button>
      </div>
    </div>
    <nav class="header-nav" aria-label="Primary">
      <div class="nav-item"><a class="nav-link${active(cur.type === 'home')}" href="${u('/')}">Home</a></div>
      ${dropdown}
    </nav>
  </div>
</header>
<div class="drawer-backdrop" data-drawer-close></div>
<aside class="drawer" id="drawer" aria-label="Navigation menu" aria-hidden="true">
  <div class="drawer-head">
    <a href="${u('/')}"><img src="${resolveImage(config.logoSmall || config.logo)}" alt="${e(config.name)}" width="154" height="30"></a>
    <button class="icon-btn" type="button" data-drawer-close aria-label="Close menu">${icon('x')}</button>
  </div>
  <nav class="drawer-nav" aria-label="Mobile">
    <a class="drawer-link${active(cur.type === 'home')}" href="${u('/')}">${icon('home', 18)} Home</a>
    <p class="drawer-title">Categories</p>
    ${drawerCats}
  </nav>
</aside>`;
  }

  const SEARCH_MODAL = () => `<div class="search-modal" id="search-modal" role="dialog" aria-modal="true" aria-label="Search" hidden>
  <div class="search-backdrop" data-search-close></div>
  <div class="search-panel">
    <form class="search-form" action="${u('/search/')}" method="get" role="search">
      ${icon('search', 22)}
      <input type="search" name="q" id="search-input" placeholder="Search articles…" autocomplete="off" aria-label="Search articles">
      <button type="button" class="search-esc" data-search-close aria-label="Close search">Esc</button>
    </form>
    <div class="search-results" id="search-results" aria-live="polite"></div>
  </div>
</div>`;

  /* ------------------------------------------------------------- footer */
  function footer() {
    const socials = [['facebook', 'Facebook'], ['twitter', 'X'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['whatsapp', 'WhatsApp Channel']].filter(([k]) => config.social?.[k]);
    const li = (href, label) => `<li><a class="foot-link" href="${href}">${e(label)}</a></li>`;
    const legal = pages.filter((p) => p.kind === 'legal');
    const company = [['About us', '/about/'], ['Contact', '/contact/'], ['Work with us', '/advertise/'], ...authors.map((a) => [`${a.name} (author)`, `/author/${a.slug}/`])];
    // the newsletter form: hidden in the HTML and shown by js/subscribe.js, which sends it. Without JavaScript nothing can be sent
    // (no address in a URL or a log); the <noscript> line after it offers RSS instead.
    const cta = newsletter
      ? `<form class="foot-form" action="${u('/newsletter/')}" method="get" data-newsletter data-endpoint="${e(api)}/v1/newsletter/subscribe" novalidate hidden>
          <label class="sr-only" for="foot-email">Email address</label>
          <input id="foot-email" type="email" name="email" required maxlength="254" placeholder="Your email address" autocomplete="email" aria-describedby="foot-note">
          <div class="hp" aria-hidden="true"><label>Leave this field empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <button class="btn btn-primary" type="submit">Subscribe ${icon('arrowRight', 16)}</button>
          <p class="foot-status" role="status"></p>
          <p class="foot-form-note" id="foot-note">One email when we publish a new article. Stop any time. See our <a href="${u('/privacy-policy/#newsletter')}">Privacy Policy</a>.</p>
        </form>
        <noscript><p class="foot-form-note foot-nojs">Email sign-up needs JavaScript. You can follow new articles with RSS instead.</p><a class="btn btn-primary btn-lg" href="${u('/rss/')}">${icon('rss', 18)} Follow with RSS</a></noscript>`
      : `<a class="btn btn-primary btn-lg" href="${u('/rss/')}">${icon('rss', 18)} Follow with RSS</a>`;
    return `<footer class="site-footer">
  <div class="foot-cta">
    <div class="wrap foot-cta-in">
      <div>
        <h2>${newsletter ? 'Get new articles by email' : 'Learn something useful every week'}</h2>
        <p>Clear, honest guides on education, money, business and technology in Tanzania. No spam, no paywall.</p>
      </div>
      <div class="foot-cta-act">${cta}</div>
    </div>
  </div>
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a href="${u('/')}" aria-label="${e(config.name)} home"><img class="foot-logo" src="${resolveImage(config.logoSmall || config.logo)}" alt="${e(config.name)}" width="246" height="48" loading="lazy"></a>
        <p class="foot-text">${e(config.footerText || '')}</p>
        <ul class="foot-contact">
          <li>${icon('mail', 17)} <a href="mailto:${e(config.contact.general)}">${e(config.contact.general)}</a></li>
          <li>${icon('mapPin', 17)} <span>Tanzania</span></li>
        </ul>
        ${socials.length ? `<div class="foot-social">${socials.map(([k, l]) => `<a href="${e(config.social[k])}" target="_blank" rel="noopener noreferrer" aria-label="${l}" class="brand-${k === 'twitter' ? 'x' : k}">${brandIcon(k === 'twitter' ? 'x' : k, 18)}</a>`).join('')}</div>` : ''}
      </div>
      <nav aria-labelledby="fh-explore"><h2 class="foot-title" id="fh-explore">Explore</h2><ul class="foot-list">${categories.map((c) => li(u(`/category/${c.slug}/`), c.name)).join('')}${li(u('/popular/'), 'Popular posts')}${li(u('/post/'), 'All posts')}${li(u('/label/'), 'Topics')}</ul></nav>
      <nav aria-labelledby="fh-company"><h2 class="foot-title" id="fh-company">Company</h2><ul class="foot-list">${company.map(([l, h]) => li(u(h), l)).join('')}${li(u('/search/'), 'Search')}${li(u('/rss/'), 'RSS feed')}${li(u('/sitemap/'), 'Sitemap')}</ul></nav>
      <nav aria-labelledby="fh-legal"><h2 class="foot-title" id="fh-legal">Legal and trust</h2><ul class="foot-list">${legal.map((p) => li(u(`/${p.slug}/`), p.title)).join('')}</ul></nav>
    </div>
    <div class="foot-bottom">
      <p>${e(config.footerCopyright || `© ${new Date().getFullYear()} ${config.name}. All rights reserved.`)}</p>
      <p class="foot-note">Content is for information only and is not professional advice. <a href="${u('/terms-of-service/')}">Terms</a> · <a href="${u('/privacy-policy/')}">Privacy</a> · <button type="button" class="linklike" data-cookie-settings>Cookie choices</button></p>
      <a class="foot-top" href="#top" aria-label="Back to top">${icon('arrowUp', 18)}</a>
    </div>
  </div>
</footer>`;
  }

  /* ------------------------------------------------------------- layout */
  function layout(meta, cur, body) {
    const ads = adsenseId && config.adsense?.autoAds && !NO_AD_PAGES.has(meta.adKind || '') && meta.adKind === 'post';
    return `<!doctype html>
<html lang="${config.language}" data-base="${base}"${api ? ` data-api="${e(api)}"` : ''}${config.turnstileSiteKey ? ` data-turnstile="${e(config.turnstileSiteKey)}"` : ''}${adsenseId ? ` data-adsense="${e(adsenseId)}"` : ''}${gtmId ? ` data-gtm="${e(gtmId)}"` : ''}>
<head>
${head(meta)}
</head>
<body class="${meta.bodyClass || ''}"${ads ? ' data-ads="1"' : ''}>
${header(cur)}
<main id="main">
${body}
</main>
${footer()}
${SEARCH_MODAL()}
<script src="${assetUrl('js/site.js')}" defer></script>${meta.listen ? `\n<script src="${assetUrl('js/listen.js')}" defer></script>` : ''}${body.includes('class="pagination"') || body.includes('hero-listing') ? `\n<script src="${assetUrl('js/pager.js')}" defer></script>` : ''}${api ? `\n<script src="${assetUrl('js/engage.js')}" defer></script>` : ''}${api && meta.contact ? `\n<script src="${assetUrl('js/contact.js')}" defer></script>` : ''}${api && meta.manage ? `\n<script src="${assetUrl('js/manage.js')}" defer></script>` : ''}${newsletter ? `\n<script src="${assetUrl('js/subscribe.js')}" defer></script>` : ''}${newsletter && meta.newsletterPage ? `\n<script src="${assetUrl('js/newsletter.js')}" defer></script>` : ''}${cfToken && !meta.manage && !meta.newsletterPage ?`\n<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${cfToken}"}'></script>` : ''}
</body>
</html>
`;
  }

  /* --------------------------------------------------------------- hero */
  // Topic photographs come in several widths (see scripts/tools/make-topic-heroes.mjs); the browser picks the one that suits the screen.
  // the home picture comes in three widths so a phone does not download the 1920 px file
  const HOME_HERO = '/assets/img/hero.webp';
  const homeSet = (src) => (src === HOME_HERO || src === u(HOME_HERO) ? [[640, '/assets/img/hero-640.webp'], [1080, '/assets/img/hero-1080.webp'], [1920, HOME_HERO]].map(([w, f]) => `${u(f)} ${w}w`).join(', ') : '');
  const topicSet = (src) => {
    if (homeSet(src)) return homeSet(src);
    const m = /\/assets\/img\/topics\/([a-z0-9-]+)-(\d+)\.webp$/.exec(src || '');
    const widths = m && heroSets[m[1]];
    return widths ? widths.map((w) => `${u(`/assets/img/topics/${m[1]}-${w}.webp`)} ${w}w`).join(', ') : '';
  };
  const smallTopic = (src) => (/\/assets\/img\/topics\/[a-z0-9-]+-\d+\.webp$/.test(src || '') ? src.replace(/-\d+\.webp$/, '-1280.webp') : src);

  function hero({ image, title, sub = '', crumbs = null, extra = '', kind = 'page', h1 = true, kicker = '', alt = '', titleAttrs = '' }) {
    const tag = h1 ? 'h1' : 'h2';
    return `<section class="hero hero-${kind}${/\/img\/heroes\//.test(image) ? ' hero-art' : ''}">
  <img class="hero-img" src="${image}"${topicSet(image) ? ` srcset="${topicSet(image)}" sizes="100vw"` : ''} alt="${e(alt)}" fetchpriority="high" decoding="async">
  <div class="hero-scrim" aria-hidden="true"></div>
  <div class="hero-inner wrap">
    ${crumbs ? breadcrumbs(crumbs) : ''}
    ${kicker ? `<p class="hero-kicker">${kicker}</p>` : ''}
    <${tag} class="hero-title"${titleAttrs}>${title}</${tag}>
    ${sub ? `<p class="hero-sub">${e(sub)}</p>` : ''}
    ${extra}
  </div>
</section>`;
  }

  const breadcrumbs = (items) =>
    `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items
      .map((it, i) => (i === items.length - 1 ? `<li aria-current="page">${e(it[0])}</li>` : `<li><a href="${it[1]}">${e(it[0])}</a></li>`))
      .join('')}</ol></nav>`;

  /* -------------------------------------------------------------- cards */
  const stats = (p) =>
    api
      ? `<div class="card-stats" data-stats="${p.slug}" hidden><span class="stat" title="Comments">${icon('message', 15)}<b data-s="c">0</b></span><span class="stat" title="Reactions">${icon('smile', 15)}<b data-s="r">0</b></span></div>`
      : '';

  function card(p, i = 0, size = 'normal', h = 'h3') {
    const href = u(p.path);
    const img = fallbackImage(p);
    if (size === 'horizontal') {
      return `<article class="card card-h">
  <div class="card-thumb"><img src="${img}" alt="" width="${p.imageW || 1400}" height="${p.imageH || 800}" loading="lazy" decoding="async"></div>
  <div class="card-body">
    <span class="card-cat">${e(p.category.name)}</span>
    <${h} class="card-title"><a class="card-link" href="${href}">${e(p.title)}</a></${h}>
    <div class="card-meta">${timeTag(p.date)}${stats(p)}</div>
  </div>
</article>`;
    }
    const small = size === 'small';
    return `<article class="card${small ? ' card-sm' : ''}">
  <div class="card-media"><img class="lazyfade" src="${img}" alt="" width="${p.imageW || 1400}" height="${p.imageH || 800}" loading="lazy" decoding="async"><span class="badge">${e(p.category.name)}</span></div>
  <div class="card-body">
    <${h} class="card-title"><a class="card-link" href="${href}">${e(p.title)}</a></${h}>
    ${small ? '' : `<p class="card-excerpt">${e(p.excerpt)}</p>`}
    <div class="card-meta">${timeTag(p.date)}<span class="meta-item">${icon('clock', 15)} ${p.readingMinutes} min read</span>${stats(p)}</div>
  </div>
</article>`;
  }

  const grid = (items, size = 'normal', cls = '', h = 'h3') =>
    `<div class="grid${size === 'small' ? ' grid-small' : ''}${size === 'horizontal' ? ' grid-h' : ''}${cls ? ' ' + cls : ''}" data-reveal-stagger>${items.map((p, i) => card(p, i, size, h)).join('')}</div>`;

  function catTile(c, i) {
    return `<a class="cat-tile" href="${u(`/category/${c.slug}/`)}">
  <img class="lazyfade" src="${smallTopic(resolveImage(c.image)) || resolveImage(config.heroImage)}" alt="" width="1280" height="853" loading="lazy" decoding="async">
  <div class="cat-tile-body">
    <h3>${e(c.name)}</h3>
    <p>${e(c.description)}</p>${c.empty ? '<span class="tile-soon">First article coming soon</span>' : ''}
    <span class="cat-tile-cta">Explore ${icon('arrowRight', 14)}</span>
  </div>
</a>`;
  }

  const sectionHead = (title, linkText, linkHref, kicker = '') =>
    `<div class="section-head">
  <div>${kicker}<h2>${e(title)}</h2></div>
  ${linkHref ? `<a class="more-link" href="${linkHref}">${e(linkText)} ${icon('arrowRight', 16)}</a>` : ''}
</div>`;

  const perPage = Number(config.postsPerPage) || 15;
  // Page numbers to show around the current page. `reach` = how many neighbours on each side. A gap of exactly one page is
  // filled with that page instead of "..." (an ellipsis that hides one number looks silly).
  const pageItems = (cur, total, reach) => {
    const show = new Set([1, total]);
    for (let n = cur - reach; n <= cur + reach; n++) if (n >= 1 && n <= total) show.add(n);
    const arr = [...show].sort((x, y) => x - y);
    const out = [];
    arr.forEach((n, i) => {
      if (i) {
        const gap = n - arr[i - 1];
        if (gap === 2) out.push(arr[i - 1] + 1);
        else if (gap > 2) out.push('…');
      }
      out.push(n);
    });
    return out;
  };
  // info = { count: total articles, perPage }
  const pagination = (current, total, hrefFor, info = null) => {
    if (total <= 1) return '';
    const list = (reach, cls) =>
      `<ul class="page-list ${cls}">${pageItems(current, total, reach)
        .map((n) => (n === '…' ? '<li class="page-gap" aria-hidden="true">…</li>' : `<li><a class="page-num${n === current ? ' is-current' : ''}" href="${hrefFor(n)}" aria-label="Page ${n}"${n === current ? ' aria-current="page"' : ''}>${n}</a></li>`))
        .join('')}</ul>`;
    const prev = current > 1
      ? `<a class="page-btn page-prev" href="${hrefFor(current - 1)}" rel="prev">${icon('arrowLeft', 18)}<span>Newer</span></a>`
      : `<span class="page-btn page-prev is-disabled" aria-disabled="true">${icon('arrowLeft', 18)}<span>Newer</span></span>`;
    const next = current < total
      ? `<a class="page-btn page-next" href="${hrefFor(current + 1)}" rel="next"><span>Older</span>${icon('arrowRight', 18)}</a>`
      : `<span class="page-btn page-next is-disabled" aria-disabled="true"><span>Older</span>${icon('arrowRight', 18)}</span>`;
    let note = `Page ${current} of ${total}`;
    if (info && info.count) {
      const from = (current - 1) * info.perPage + 1;
      const to = Math.min(current * info.perPage, info.count);
      note += ` · Articles ${from} to ${to} of ${info.count}`;
    }
    return `<nav class="pagination" aria-label="Pagination">
  <div class="pagination-bar">
    ${prev}
    ${list(2, 'page-list-full')}
    ${list(1, 'page-list-compact')}
    ${next}
  </div>
  <p class="pagination-note" role="status" aria-live="polite">${note}</p>
</nav>`;
  };

  // names a search engine may use for the site, and the profiles that are really ours (only filled-in links are sent)
  const altNames = [config.name.replace(/\s+/g, ''), new URL(config.siteUrl).host].filter((n) => n && n !== config.name);
  const sameAs = Object.values(config.social || {}).filter((v) => /^https:\/\//.test(v || ''));
  const orgJson = () => ({ '@type': 'Organization', '@id': abs('/') + '#organization', name: config.name, alternateName: altNames, url: abs('/'), logo: { '@type': 'ImageObject', url: absImage(config.orgLogo || config.logo), width: 512, height: 512 }, ...(sameAs.length ? { sameAs } : {}) });

  /* --------------------------------------------------------------- home */
  /* ------------------------------------------- "Discover more" section on the home page
     Everything here is computed from real content: reading paths you choose in site.config.json (homePaths), topics that have
     articles, the shortest articles, the commonest tags and the newest article. Nothing is invented or counted from visitors. */
  function discover() {
    const bySlug = new Map(posts.map((x) => [x.slug, x]));
    const paths = (config.homePaths || [])
      .map((hp) => ({ ...hp, list: (hp.posts || []).map((sl) => bySlug.get(sl)).filter(Boolean), cat: categories.find((c) => c.slug === hp.category) }))
      .filter((hp) => hp.list.length >= 2)
      .slice(0, 3);
    // topics that really have articles: labels, and categories that have no labels
    const topics = [];
    for (const c of categories) {
      const inCat = posts.filter((x) => x.category.slug === c.slug);
      if (!inCat.length) continue;
      const labelled = c.labels.map((l) => ({ l, n: inCat.filter((x) => x.label?.slug === l.slug).length })).filter((x) => x.n);
      if (labelled.length) labelled.forEach(({ l, n }) => topics.push({ name: l.name, parent: c.name, n, href: u(`/category/${c.slug}/${l.slug}/`), image: l.image || c.image }));
      else topics.push({ name: c.name, parent: 'Category', n: inCat.length, href: u(`/category/${c.slug}/`), image: c.image });
    }
    const quick = [...posts].sort((a, b) => a.readingMinutes - b.readingMinutes || b.date - a.date).slice(0, 3);
    const tagCount = new Map();
    posts.forEach((x) => x.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
    const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7).map((x) => x[0]);
    const newest = posts[0];
    if (!paths.length && topics.length < 3) return '';
    const thumb = (src) => smallTopic(resolveImage(src)) || resolveImage(config.heroImage);

    const pathTile = (hp, i) => `<article class="dsc-path" style="--tone:${['#2f6bff', '#2dd4bf', '#f5b042'][i % 3]}">
      <img class="dsc-path-img lazyfade" src="${thumb(hp.cat?.image)}" alt="" width="1280" height="853" loading="lazy" decoding="async">
      <div class="dsc-path-body">
        <p class="dsc-path-kicker"><span class="dsc-num" aria-hidden="true">${i + 1}</span> ${e(hp.kicker || 'Reading path')}</p>
        <h3>${e(hp.title)}</h3>
        ${hp.sub ? `<p class="dsc-path-sub">${e(hp.sub)}</p>` : ''}
        <ol class="dsc-steps">${hp.list.map((x) => `<li><a href="${u(x.path)}"><span class="dsc-step-title">${e(x.title)}</span><span class="dsc-step-meta">${x.readingMinutes} min read</span></a></li>`).join('')}</ol>
      </div>
    </article>`;
    const topicCard = (t) => `<li class="dsc-topic"><a href="${t.href}">
        <img class="lazyfade" src="${thumb(t.image)}" alt="" width="1280" height="853" loading="lazy" decoding="async">
        <span class="dsc-topic-shade" aria-hidden="true"></span>
        <span class="dsc-topic-body"><span class="dsc-topic-parent">${e(t.parent)}</span><strong>${e(t.name)}</strong><span class="dsc-topic-n">${t.n} ${t.n === 1 ? 'article' : 'articles'} ${icon('arrowRight', 14)}</span></span>
      </a></li>`;

    return `<section class="section dsc" aria-labelledby="dsc-h" data-reveal>
  <div class="dsc-bg" aria-hidden="true"></div>
  <div class="wrap dsc-wrap">
    <div class="dsc-head">
      <span class="dsc-kicker">${icon('star', 15)} Discover more</span>
      <h2 id="dsc-h">More from ${e(config.name)}, your way</h2>
      <p>Follow a short reading path, jump into a topic, or find something quick to read or listen to.</p>
    </div>
    ${paths.length ? `<div class="dsc-paths" data-reveal-stagger>${paths.map(pathTile).join('')}</div>` : ''}
    ${topics.length >= 3 ? `<div class="dsc-rail-block">
      <div class="dsc-rail-head"><h3>Jump into a topic</h3>
        <div class="dsc-rail-btns" hidden><button type="button" class="dsc-rail-btn" data-rail="-1" aria-label="Scroll topics back">${icon('arrowLeft', 18)}</button><button type="button" class="dsc-rail-btn" data-rail="1" aria-label="Scroll topics forward">${icon('arrowRight', 18)}</button></div>
      </div>
      <ul class="dsc-rail" data-rail-list role="list" aria-label="Topics with articles" tabindex="0">${topics.map(topicCard).join('')}</ul>
    </div>` : ''}
    <div class="dsc-tools" data-reveal-stagger>
      <div class="dsc-tool">
        <h3>${icon('clock', 18)} Short on time?</h3>
        <ul class="dsc-quick">${quick.map((x) => `<li><a href="${u(x.path)}"><span>${e(x.title)}</span><em>${x.readingMinutes} min</em></a></li>`).join('')}</ul>
      </div>
      <div class="dsc-tool dsc-listen">
        <h3>${icon('headphones', 18)} Prefer to listen?</h3>
        <p>Every article has a <strong>Listen</strong> button. It reads the article aloud, highlights each sentence and scrolls with you, so your eyes can rest.</p>
        ${newest ? `<a class="dsc-btn" href="${u(newest.path)}">${icon('play', 16)} Try it on our newest article</a>` : ''}
      </div>
      <div class="dsc-tool">
        <h3>${icon('search', 18)} Looking for something?</h3>
        <form class="dsc-search" action="${u('/search/')}" method="get" role="search">
          <label class="sr-only" for="dsc-q">Search ${e(config.name)}</label>
          <input id="dsc-q" name="q" type="search" placeholder="Try: student loan" autocomplete="off">
          <button type="submit" aria-label="Search">${icon('search', 18)}</button>
        </form>
        ${tags.length ? `<p class="dsc-try">Common topics in our articles:</p><div class="dsc-tags">${tags.map((t) => `<a href="${tagHref(t)}">${e(t)}</a>`).join('')}</div>` : ''}
        <a class="dsc-rss" href="${u('/rss/')}">${icon('rss', 16)} Follow with RSS</a>
      </div>
    </div>
  </div>
</section>`;
  }

  /* ----------------------------------------------------------- tag topic pages */
  function tagPage(t, list, pageNo, pageCount, total) {
    const root = `/tag/${t.slug}/`;
    const hrefFor = (n) => u(n === 1 ? root : `${root}page/${n}/`);
    const title = `${t.name}`;
    const desc = `Articles about ${t.name} on ${config.name}: ${t.list.slice(0, 2).map((x) => x.title).join('; ')}.`;
    const related = tagTopics.filter((x) => x.slug !== t.slug && x.list.some((p) => t.list.includes(p))).slice(0, 8);
    const chips = related.length ? `<div class="chips hero-chips" role="list">${related.map((r) => `<a role="listitem" class="chip" href="${u(`/tag/${r.slug}/`)}">${e(r.name)}</a>`).join('')}</div>` : '';
    return listingShell(
      { title: pageNo > 1 ? `${title}, page ${pageNo}` : `${title}: articles and guides`, description: describe(desc, `Plain-English guides for readers in Tanzania.`, pageNo), noindex: total < 3, path: pageNo === 1 ? root : `${root}page/${pageNo}/`, adKind: 'category', jsonLd: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url: abs(root) }] },
      {},
      { image: heroFor(`tag/${t.slug}`), kind: 'listing', title: e(t.name), sub: `${total} articles tagged "${t.name}".`, extra: chips ? `<div class="hero-foot">${chips}</div>` : '' },
      `${grid(list, 'normal', '', 'h2')}${pagination(pageNo, pageCount, hrefFor, { count: total, perPage })}`,
    );
  }

  // Home page: the commonest tags as topics, each with its articles
  function tagTopicsSection() {
    const top = tagTopics.slice(0, 6);
    if (top.length < 3) return '';
    return `<section class="section" aria-labelledby="tt-h" data-reveal>
  <div class="wrap">
    <div class="center-head"><h2 id="tt-h">Topics from our tags</h2><p>The subjects our articles come back to. Choose one to see everything we have on it.</p></div>
    <div class="tt-grid" data-reveal-stagger>${top.map((t, i) => `<article class="tt-card" style="--tone:${['#2f6bff', '#2dd4bf', '#f5b042', '#a78bfa', '#4ade80', '#f472b6'][i % 6]}">
      <header><span class="tt-ico">${icon('tag', 18)}</span><h3><a href="${u(`/tag/${t.slug}/`)}">${e(t.name)}</a></h3><span class="tt-n">${t.list.length}</span></header>
      <ul>${t.list.slice(0, 3).map((x) => `<li><a href="${u(x.path)}">${e(x.title)}</a></li>`).join('')}</ul>
      <a class="tt-more" href="${u(`/tag/${t.slug}/`)}">All ${t.list.length} articles ${icon('arrowRight', 15)}</a>
    </article>`).join('')}</div>
    ${tagTopics.length > top.length ? `<p class="tt-all"><a class="btn btn-outline" href="${u('/tag/')}">Browse all ${tagTopics.length} topics ${icon('arrowRight', 16)}</a></p>` : ''}
  </div>
</section>`;
  }

  function home() {
    const recent = posts.slice(0, config.homeRecentCount);
    const picks = posts.filter((p) => p.featured).slice(0, 4);
    const used = new Set([...recent, ...picks].map((p) => p.slug));
    const more = posts.filter((p) => !used.has(p.slug)).slice(0, 3);
    const spotlights = [];
    for (const c of categories.slice(0, 6)) {
      const withPosts = c.labels.map((l) => ({ l, list: posts.filter((p) => p.category.slug === c.slug && p.label?.slug === l.slug) })).filter((x) => x.list.length);
      if (!withPosts.length) continue;
      withPosts.sort((a, b) => b.list.length - a.list.length);
      spotlights.push({ category: c, label: withPosts[0].l, posts: withPosts[0].list.slice(0, 3) });
    }
    const [first, last] = nameParts();
    const heroImg = resolveImage(config.heroImage);
    const hero0 = hero({
      kind: 'home',
      image: heroImg,
      kicker: `<span class="pulse"></span>${e(config.heroBadge)}`,
      title: `${e(first)}${last ? ` <span>${e(last)}</span>` : ''}`,
      sub: config.slogan,
      extra: `<div class="hero-cta">
        <a class="btn btn-primary btn-lg" href="${u('/post/')}">${icon('list', 18)} Read the latest</a>
        <a class="btn btn-glass btn-lg" href="${u('/popular/')}">${icon('trendingUp', 18)} Popular posts</a>
      </div>`,
    });
    const body = `${hero0}
<section class="section" id="latest" data-reveal>
  <div class="wrap">
    ${sectionHead('Latest posts', 'View all', u('/post/'))}
    ${recent.length ? grid(recent) : '<p class="empty">No posts published yet.</p>'}
    ${posts.length > recent.length ? `<div class="more-posts">
      <button class="btn btn-outline btn-lg" type="button" data-more-posts data-step="6" hidden>${icon('arrowRight', 18)} <span>Show ${Math.min(6, Math.min(perPage, posts.length) - recent.length)} more posts</span></button>
      <a class="btn btn-outline btn-lg more-posts-link" href="${u('/post/')}">View all ${posts.length} posts ${icon('arrowRight', 18)}</a>
    </div>` : ''}
  </div>
</section>
${picks.length ? `<section class="section section-alt" data-reveal>
  <div class="wrap">
    ${sectionHead("Editor's picks", 'See all', u('/popular/'), `<span class="kicker">${icon('star', 16)} Hand-picked</span>`)}
    ${grid(picks, 'small')}
  </div>
</section>` : ''}
<section class="section" data-reveal>
  <div class="wrap">
    <div class="center-head"><h2>Explore our categories</h2><p>Pick a topic and keep reading.</p></div>
    <div class="grid grid-tiles" data-reveal-stagger>${categories.map(catTile).join('')}</div>
  </div>
</section>
${spotlights.map((s, i) => {
  const h = LABEL_HEADINGS(s.label.name, s.category.name)[i % 4];
  return `<section class="section${i % 2 === 0 ? ' section-alt' : ''}" data-reveal>
  <div class="wrap">
    <div class="section-head section-head-end">
      <div>
        <div class="kicker-row"><span class="kicker">${icon('tag', 14)} ${e(s.label.name)}</span><span class="slash">/</span><span class="kicker-cat">${e(s.category.name)}</span></div>
        <h2>${e(h.heading)}</h2>
        <p class="section-sub">${e(h.sub)}</p>
      </div>
      <a class="more-link" href="${u(`/category/${s.category.slug}/${s.label.slug}/`)}">See all in ${e(s.label.name)} ${icon('arrowRight', 16)}</a>
    </div>
    ${grid(s.posts)}
  </div>
</section>`;
}).join('\n')}
${more.length ? `<section class="section" data-reveal>
  <div class="wrap">
    ${sectionHead('More to read', 'All posts', u('/post/'), `<span class="kicker kicker-green">${icon('zap', 16)} Keep going</span>`)}
    ${grid(more, 'horizontal')}
  </div>
</section>` : ''}
${tagTopicsSection()}
${discover()}`;
    return layout(
      {
        title: config.title,
        description: config.description,
        path: '/',
        preload: heroImg,
        adKind: 'home',
        jsonLd: [{ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', '@id': abs('/') + '#website', name: config.name, alternateName: altNames, url: abs('/'), description: config.description, publisher: { '@id': abs('/') + '#organization' }, inLanguage: config.language }, orgJson()] }],
        bodyClass: 'page-home',
      },
      { type: 'home' },
      body,
    );
  }

  /* -------------------------------------------------- listings & indexes */
  function listingShell(meta, cur, heroOpts, inner) {
    return layout({ ...meta, preload: heroOpts.image }, cur, `${hero(heroOpts)}<section class="section"><div class="wrap">${inner}</div></section>`);
  }

  function category(c, label, pageNo, pageCount, list, total) {
    const root = label ? `/category/${c.slug}/${label.slug}/` : `/category/${c.slug}/`;
    const hrefFor = (n) => u(n === 1 ? root : `${root}page/${n}/`);
    const chips = c.labels.length
      ? `<div class="chips hero-chips" role="list"><a role="listitem" class="chip${label ? '' : ' is-active'}" href="${u(`/category/${c.slug}/`)}">All</a>${c.labels.map((l) => `<a role="listitem" class="chip${label?.slug === l.slug ? ' is-active' : ''}" href="${u(`/category/${c.slug}/${l.slug}/`)}">${e(l.name)}</a>`).join('')}</div>`
      : '';
    const crumbs = [['Home', u('/')], ['Categories', u('/category/')]];
    if (label) crumbs.push([c.name, u(`/category/${c.slug}/`)], [label.name, '']);
    else crumbs.push([c.name, '']);
    const title = label ? `${label.name} in ${c.name}` : c.name;
    const desc = (label ? label.description : c.description) || c.description || `Browse ${title} articles on ${config.name}.`;
    const img = heroFor(label ? `${c.slug}/${label.slug}` : c.slug, (label && label.image) || c.image);
    const countLine = `<p class="hero-count">${total ? `${total} ${total === 1 ? 'article' : 'articles'}` : 'No articles yet'}</p>`;
    return listingShell(
      { title: pageNo > 1 ? `${title}, page ${pageNo}` : title, description: describe(desc, `Browse ${title} articles on ${config.name}: plain-English guides for readers in Tanzania.`, pageNo), noindex: !total || (!!label && total < 3), path: pageNo === 1 ? root : `${root}page/${pageNo}/`, adKind: 'category', share: label ? `label-${c.slug}-${label.slug}` : `category-${c.slug}`, jsonLd: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url: abs(root) }] },
      { type: 'category', cat: c.slug },
      { image: img, kind: 'listing', title: e(label ? label.name : c.name), sub: desc, extra: `<div class="hero-foot">${countLine}${chips}</div>` },
      list.length
        ? `${grid(list, 'normal', '', 'h2')}${pagination(pageNo, pageCount, hrefFor, { count: total, perPage })}`
        : `<div class="empty-cat"><h2>No articles in ${e(title)} yet</h2><p>We only publish a topic when an article has been researched and checked. Until the first one is ready, here are our latest articles.</p></div>${sectionHead('Latest articles', 'All posts', u('/post/'))}${grid(posts.slice(0, 6))}`,
    );
  }

  function categoriesIndex() {
    return listingShell(
      { title: 'Categories', description: describe(`Browse all content categories on ${config.name}.`, 'Pick a topic to see every article in it, from education and business to technology and news.', 1), path: '/category/', adKind: 'category' },
      { type: 'category' },
      { image: heroFor('categories'), kind: 'listing', title: 'Categories', sub: 'Choose a topic to see every article in it.' },
      `<div class="grid grid-tiles" data-reveal-stagger>${categories.map(catTile).join('')}</div>`,
    );
  }

  // every tag topic on one page (noindex: it is a directory for readers, like the sitemap page); also the no-JavaScript fallback of the sidebar's "More topics"
  function tagsIndex() {
    const byLetter = new Map();
    for (const t of [...tagTopics].sort((a, b) => a.name.localeCompare(b.name))) {
      const k = (t.name[0] || '#').toUpperCase();
      if (!byLetter.has(k)) byLetter.set(k, []);
      byLetter.get(k).push(t);
    }
    return listingShell(
      { title: 'All topics', description: describe(`Every topic on ${config.name}, from A to Z, with the number of articles in each.`, 'Choose a topic to see all the articles we have on it.', 1), path: '/tag/', noindex: true, adKind: 'category' },
      {},
      { image: heroFor('topics'), kind: 'listing', title: 'All topics', sub: `${tagTopics.length} topics from our tags, from A to Z, with the number of articles in each.` },
      `<div class="label-groups">${[...byLetter].map(([k, list]) => `<div class="label-group"><h2>${e(k)}</h2><div class="chips">${list.map((t) => `<a class="chip" href="${u(`/tag/${t.slug}/`)}">${e(t.name)} <span class="chip-count">${t.list.length}</span></a>`).join('')}</div></div>`).join('') || '<p class="empty">No topics yet.</p>'}</div>`,
    );
  }
  // [name, slug, number of articles] for the sidebar's "More topics" button, most covered first
  const tagsJson = () => tagTopics.map((t) => [t.name, t.slug, t.list.length]);

  function labelsIndex() {
    return listingShell(
      { title: 'Topics', description: describe(`Browse every topic on ${config.name}.`, 'Every category and label, with the number of articles in each.', 1), path: '/label/', adKind: 'category' },
      {},
      { image: heroFor('topics'), kind: 'listing', title: 'Topics', sub: 'Every label across every category, with the number of articles in each.' },
      `<div class="label-groups">${categories
        .filter((c) => c.labels.length)
        .map((c) => `<div class="label-group"><h2><a href="${u(`/category/${c.slug}/`)}">${e(c.name)}</a></h2><div class="chips">${c.labels.map((l) => `<a class="chip" href="${u(`/category/${c.slug}/${l.slug}/`)}">${e(l.name)} <span class="chip-count">${posts.filter((p) => p.category.slug === c.slug && p.label?.slug === l.slug).length}</span></a>`).join('')}</div></div>`)
        .join('') || '<p class="empty">No labels yet.</p>'}</div>`,
    );
  }

  // keeps a description 70 to 160 characters, and different on page 2, 3 and so on
  const describe = (d, more, pageNo) => {
    let t = String(d || '').trim();
    if (t.length < 90 && more) t = `${t.replace(/\s*$/, '')} ${more}`;
    if (pageNo > 1) t = `${t.slice(0, 140)} Page ${pageNo}.`;
    return t.length > 160 ? `${t.slice(0, 157).replace(/\s+\S*$/, '')}...` : t;
  };

  function postsDirectory(pageNo, pageCount, list, total = list.length) {
    const hrefFor = (n) => u(n === 1 ? '/post/' : `/post/page/${n}/`);
    return listingShell(
      { title: pageNo > 1 ? `All posts, page ${pageNo}` : 'All posts', description: describe(`Browse every article on ${config.name}, newest first.`, 'Guides on education, jobs, money and technology for readers in Tanzania.', pageNo), path: pageNo === 1 ? '/post/' : `/post/page/${pageNo}/`, adKind: 'category' },
      {},
      { image: heroFor('all-posts'), title: 'All posts', sub: `Every article on ${config.name}, newest first.` },
      `${list.length ? grid(list, 'normal', '', 'h2') : '<p class="empty">No posts published yet.</p>'}${pagination(pageNo, pageCount, hrefFor, { count: total, perPage })}`,
    );
  }

  function popular(pageNo = 1, pageCount = 1, list = null, total = 0) {
    list = list || [...posts.filter((p) => p.featured), ...posts.filter((p) => !p.featured)].slice(0, perPage);
    total = total || list.length;
    const hrefFor = (n) => u(n === 1 ? '/popular/' : `/popular/page/${n}/`);
    return listingShell(
      { title: pageNo > 1 ? `Popular posts, page ${pageNo}` : 'Popular posts', description: describe(`Our editors' picks and most useful articles on ${config.name}.`, 'Plain-English guides for readers in Tanzania.', pageNo), noindex: !posts.some((x) => x.featured), path: pageNo === 1 ? '/popular/' : `/popular/page/${pageNo}/`, adKind: 'category' },
      { type: 'popular' },
      { image: heroFor('popular'), title: 'Popular posts', sub: "Editors' picks first, then the latest stories." },
      `${list.length ? grid(list, 'normal', '', 'h2') : '<p class="empty">No posts published yet.</p>'}${pagination(pageNo, pageCount, hrefFor, { count: total, perPage })}`,
    );
  }

  function searchPage() {
    return layout(
      { title: 'Search', description: `Search articles on ${config.name}.`, path: '/search/', noindex: true, adKind: 'search', preload: heroFor('search') },
      {},
      `${hero({ image: heroFor('search'), title: 'Search', sub: `Find articles on ${config.name}.` })}
<section class="section"><div class="wrap wrap-narrow">
    <form class="search-big" action="${u('/search/')}" method="get" role="search">
      ${icon('search', 22)}
      <input type="search" name="q" id="search-page-input" placeholder="Search articles…" autocomplete="off" aria-label="Search articles">
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <p class="search-count" id="search-page-count" role="status" aria-live="polite"></p>
    <div id="search-page-results" class="result-list"></div>
    <noscript><p class="empty">Search needs JavaScript. You can still browse by <a href="${u('/category/')}">category</a> or see <a href="${u('/post/')}">all posts</a>.</p></noscript>
</div></section>`,
    );
  }

  /* ------------------------------------------------------------ authors */
  // The round portrait: the real photo when the author has one ("photo" in site.config.json), otherwise a faceless black silhouette (man or woman, from "gender" in site.config.json). Never a stock or generated face.
  const authorAvatar = (a, cls = '') => `<span class="ap-ring${cls ? ' ' + cls : ''}">${a.photo
    ? `<img class="ap-avatar ap-photo" src="${resolveImage(a.photo)}" alt="${e(a.photoAlt || `Portrait of ${a.name}`)}" width="256" height="256" decoding="async">`
    : `<img class="ap-avatar ap-photo ap-default" src="${u(a.gender === 'female' ? '/assets/img/avatar-woman.svg' : '/assets/img/avatar-man.svg')}" alt="" width="256" height="256" decoding="async">`}</span>`;
  const SOCIAL_LABEL = { facebook: 'Facebook', twitter: 'X', instagram: 'Instagram', linkedin: 'LinkedIn' };
  const authorSocials = (a) => Object.keys(SOCIAL_LABEL).map((k) => [k, String((a.social || {})[k] || '').trim()]).filter(([, v]) => /^https?:\/\//i.test(v));
  const listText = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || '');

  function authorPage(a, list, pageNo = 1, pageCount = 1, total = list.length) {
    const hrefFor = (n) => u(n === 1 ? `/author/${a.slug}/` : `/author/${a.slug}/page/${n}/`);
    // everything below is counted from the real articles; nothing here is typed in by hand
    const all = posts.filter((x) => x.author === a.name);
    const byCat = new Map();
    all.forEach((x) => { const cur = byCat.get(x.category.slug) || { c: x.category, n: 0 }; cur.n += 1; byCat.set(x.category.slug, cur); });
    const cats = [...byCat.values()].sort((x, y) => y.n - x.n || x.c.name.localeCompare(y.c.name));
    const tagCount = new Map();
    all.forEach((x) => x.tags.forEach((t) => { const k = tagSlug(t); const cur = tagCount.get(k) || { name: t, n: 0 }; cur.n += 1; tagCount.set(k, cur); }));
    const topTags = [...tagCount.values()].filter((t) => t.n >= 2).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name)).slice(0, 8);
    const newest = all[0]?.date, oldest = all[all.length - 1]?.date;
    const roleTitle = String(a.role || '').split(',')[0].trim();
    const first = a.name.trim().split(/\s+/)[0];
    const mail = a.email || config.contact.general;
    const socials = authorSocials(a);
    const bio = String(a.bio).split(/\n{2,}/).map((t) => `<p>${e(t.trim())}</p>`).join('');
    const stat = (label, value) => `<div class="ap-stat"><dt>${label}</dt><dd>${value}</dd></div>`;
    const how = [
      'Official and primary sources come first.',
      'Every article ends with the sources that were used.',
      'Nothing is invented: no made-up quotes, people, studies or statistics.',
      'Mistakes are corrected openly, with a note at the top of the article when the change is big.',
      'Software, including AI tools, may help with research and editing. A person checks the facts and is accountable for every article.',
    ];
    const body = `${hero({ image: heroFor(`author/${a.slug}`), title: e(a.name), sub: a.role || '', kicker: 'Author', kind: 'page' })}
<section class="section ap-section"><div class="wrap">
  <div class="ap-card" data-reveal>
    ${authorAvatar(a)}
    <div class="ap-main">
      ${a.role ? `<p class="ap-eyebrow">${e(a.role)}</p>` : ''}
      <h2 class="ap-name">About ${e(a.name)}</h2>
      <div class="ap-bio">${bio}</div>
      <div class="ap-actions">
        <a class="btn btn-primary" href="mailto:${e(mail)}">${icon('mail', 18)} Email ${e(first)}</a>
        <a class="btn btn-outline" href="#articles">Read the articles ${icon('arrowRight', 16)}</a>
        ${socials.length ? `<span class="ap-social">${socials.map(([k, v]) => `<a class="share-btn brand-${k === 'twitter' ? 'x' : k}" href="${e(v)}" target="_blank" rel="me noopener noreferrer" aria-label="${e(a.name)} on ${SOCIAL_LABEL[k]}">${brandIcon(k === 'twitter' ? 'x' : k, 18)}</a>`).join('')}</span>` : ''}
      </div>
    </div>
    <dl class="ap-stats">
      ${stat('Articles', all.length)}
      ${stat('Topics', cats.length)}
      ${oldest ? stat('First article', timeTag(oldest, false)) : ''}
      ${newest ? stat('Latest article', timeTag(newest, false)) : ''}
    </dl>
  </div>

  <div class="ap-trio" data-reveal-stagger>
    <section class="ap-box" aria-labelledby="ap-t1">
      <span class="ap-box-ico" aria-hidden="true">${icon('tag', 22)}</span>
      <h2 id="ap-t1">Topics covered</h2>
      ${cats.length ? `<ul class="ap-topics">${cats.map(({ c, n }) => `<li><a href="${u(`/category/${c.slug}/`)}"><span>${e(c.name)}</span><b>${n} ${n === 1 ? 'article' : 'articles'}</b></a></li>`).join('')}</ul>` : '<p class="empty">No articles yet.</p>'}
      ${topTags.length ? `<div class="chips">${topTags.map((t) => `<a class="chip" href="${tagHref(t.name)}">${e(t.name)}</a>`).join('')}</div>` : ''}
    </section>
    <section class="ap-box" aria-labelledby="ap-t2">
      <span class="ap-box-ico" aria-hidden="true">${icon('shield', 22)}</span>
      <h2 id="ap-t2">How articles are made</h2>
      <ul class="ap-checks">${how.map((t) => `<li>${icon('check', 18)}<span>${e(t)}</span></li>`).join('')}</ul>
      <p class="ap-links"><a href="${u('/editorial-policy/')}">Editorial Policy</a> <a href="${u('/fact-checking-policy/')}">Fact-Checking Policy</a></p>
    </section>
    <section class="ap-box" aria-labelledby="ap-t3">
      <span class="ap-box-ico" aria-hidden="true">${icon('message', 22)}</span>
      <h2 id="ap-t3">Contact and corrections</h2>
      <p>Questions, ideas and corrections are welcome. For a correction, send the article link, what is wrong and, if you can, a source.</p>
      <p class="ap-mail"><a href="mailto:${e(mail)}">${icon('mail', 17)} ${e(mail)}</a></p>
      <p class="ap-links"><a href="mailto:${e(mail)}?subject=${encodeURIComponent(`Correction for ${config.name}`)}">Report a correction</a> <a href="${u('/contact/')}">Contact page</a> <a href="${u('/rss/')}">RSS feed</a></p>
    </section>
  </div>

  <div class="ap-list-head" id="articles">
    <div><p class="ap-eyebrow">Newest first</p><h2>Articles by ${e(a.name)}</h2></div>
    <p class="ap-count">${total} ${total === 1 ? 'article' : 'articles'}</p>
  </div>
  ${list.length ? grid(list, 'normal', '', 'h3') : '<p class="empty">No posts yet.</p>'}
  ${pagination(pageNo, pageCount, hrefFor, { count: total, perPage })}
</div></section>`;
    const topicNames = cats.map((x) => x.c.name.toLowerCase());
    const desc = `${a.name}${a.role ? `, ${a.role}` : ''}. ${all.length} ${all.length === 1 ? 'article' : 'articles'} on ${listText(topicNames)}, checked against official sources where they exist.`;
    const person = {
      '@type': 'Person',
      '@id': `${abs(`/author/${a.slug}/`)}#person`,
      name: a.name,
      ...(roleTitle ? { jobTitle: roleTitle } : {}),
      description: String(a.bio).replace(/\s+/g, ' ').trim(),
      url: abs(`/author/${a.slug}/`),
      ...(a.photo ? { image: absImage(a.photo) } : {}),
      worksFor: { '@type': 'Organization', name: config.name, url: abs('/') },
      ...(cats.length ? { knowsAbout: cats.map((x) => x.c.name) } : {}),
      ...(socials.length ? { sameAs: socials.map(([, v]) => v) } : {}),
    };
    return layout(
      { title: pageNo > 1 ? `${a.name}, page ${pageNo}` : `${a.name}${roleTitle ? `, ${roleTitle}` : ''}`, preload: heroFor(`author/${a.slug}`), description: describe(desc, '', pageNo), path: pageNo === 1 ? `/author/${a.slug}/` : `/author/${a.slug}/page/${pageNo}/`, adKind: 'author', jsonLd: [{ '@context': 'https://schema.org', '@type': 'ProfilePage', mainEntity: person }] },
      {},
      body,
    );
  }

  /* ------------------------------------------------------- static pages */
  function contactForm() {
    const c = config.contact;
    const endpoint = api ? `${api}/v1/contact` : c.formAction || ''; // with the comments service on, the form sends email through it
    const field = (id, label, input, hint = '') => `<div class="field"><label for="cf-${id}">${label}</label>${input}<p class="field-err" id="cf-${id}-err" hidden></p>${hint}</div>`;
    return `<form class="form" id="contact-form" action="${e(c.formAction || '#')}" method="post" novalidate data-mailto="${e(c.general)}" data-endpoint="${e(endpoint)}"${api ? ' data-mail-api' : ''}>
  <div class="form-row">
    ${field('name', 'Your name', '<input id="cf-name" name="name" type="text" autocomplete="name" required maxlength="50" placeholder="Your name" aria-describedby="cf-name-err">')}
    ${field('email', 'Your email', '<input id="cf-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" aria-describedby="cf-email-err">')}
  </div>
  ${field('subject', 'Subject', '<input id="cf-subject" name="subject" type="text" required maxlength="120" placeholder="How can we help?" aria-describedby="cf-subject-err">')}
  ${field('message', 'Message', '<textarea id="cf-message" name="message" rows="6" required maxlength="3000" placeholder="Write your message here" aria-describedby="cf-message-err"></textarea>')}
  ${endpoint ? '<div class="hp" aria-hidden="true"><label>Leave this field empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' : ''}
  <button class="btn btn-primary btn-lg" type="submit">Send message ${icon('arrowRight', 18)}</button>
  <p class="form-status" role="status" aria-live="polite" tabindex="-1"></p>
  <noscript><p>This form needs JavaScript. Please email us at <a href="mailto:${e(c.general)}">${e(c.general)}</a>.</p></noscript>
</form>`;
  }

  function staticPage(pg) {
    // {{#comments}}...{{/comments}} is kept only when the comments server is switched on; {{^comments}}...{{/comments}} only when it is not
    const fill = (h) =>
      h
        .replace(/\{\{#comments\}\}([\s\S]*?)\{\{\/comments\}\}/g, (_m, t) => (api ? t : ''))
        .replace(/\{\{\^comments\}\}([\s\S]*?)\{\{\/comments\}\}/g, (_m, t) => (api ? '' : t))
        // {{#newsletter}}...{{/newsletter}} only when the newsletter is on (newsletterAction "api" with a comments API); {{^newsletter}} when it is not
        .replace(/\{\{#newsletter\}\}([\s\S]*?)\{\{\/newsletter\}\}/g, (_m, t) => (newsletter ? t : ''))
        .replace(/\{\{\^newsletter\}\}([\s\S]*?)\{\{\/newsletter\}\}/g, (_m, t) => (newsletter ? '' : t))
        .replace(/\{\{#cfanalytics\}\}([\s\S]*?)\{\{\/cfanalytics\}\}/g, (_m, t) => (cfToken ? t : ''))
        .replace(/\{\{\^cfanalytics\}\}([\s\S]*?)\{\{\/cfanalytics\}\}/g, (_m, t) => (cfToken ? '' : t))
        .replace(/\{\{#analytics\}\}([\s\S]*?)\{\{\/analytics\}\}/g, (_m, t) => (gtmId ? t : ''))
        .replace(/\{\{\^analytics\}\}([\s\S]*?)\{\{\/analytics\}\}/g, (_m, t) => (gtmId ? '' : t))
        .replace(/\{\{base\}\}/g, base)
        .replace(/\{\{contact-form\}\}/g, contactForm())
        .replace(/\{\{email:(general|support|executive)\}\}/g, (_m, k) => `<a href="mailto:${config.contact[k]}">${config.contact[k]}</a>`)
        .replace(/\{\{mail:(general|support|executive)\}\}/g, (_m, k) => config.contact[k])
        .replace(/\{\{site-name\}\}/g, e(config.name))
        .replace(/\{\{site-url\}\}/g, e(siteUrl))
        .replace(/\{\{updated\}\}/g, fmtDate(pg.updated || new Date(), true));
    const withIds = addHeadingIds(fill(pg.html));
    const isDoc = pg.kind === 'legal';
    const toc = withIds.toc.filter((t) => t.level === 2 || t.level === 3);
    const rail = pages.filter((p) => p.kind === 'legal' && p.slug !== pg.slug);
    const inner = isDoc
      ? `<div class="doc wrap">
  <aside class="doc-toc" aria-label="On this page">${toc.filter((t) => t.level === 2).length > 2 ? `<p class="aside-title">On this page</p>${tocList(toc)}` : ''}</aside>
  <div class="prose-page">
    ${pg.updatedLabel ? '' : `<p class="doc-updated">Last updated: ${fmtDate(pg.updated || new Date(), true)}</p>`}
${withIds.html}
  </div>
  <aside class="doc-rail" aria-label="Related pages"><p class="aside-title">Other policies</p><ul>${rail.map((p) => `<li><a href="${u(`/${p.slug}/`)}">${e(p.title)}</a></li>`).join('')}</ul><div class="aside-box"><strong>Questions?</strong><p>Email <a href="mailto:${e(config.contact.general)}">${e(config.contact.general)}</a></p></div></aside>
</div>`
      : `<div class="wrap"><div class="prose-page prose-wide">
${withIds.html}
</div></div>`;
    const body = `${hero({ image: heroFor(pg.slug, pg.hero), title: e(pg.heading || pg.title), sub: pg.subtitle })}
<section class="section">${inner}</section>`;
    return layout(
      { title: pg.title, description: pg.description, path: `/${pg.slug}/`, noindex: true, noReferrer: pg.slug === 'manage' || pg.slug === 'newsletter', bodyClass: pg.slug === 'manage' || pg.slug === 'newsletter' ? 'page-manage' : '', manage: pg.slug === 'manage', newsletterPage: pg.slug === 'newsletter', contact: pg.slug === 'contact', adKind: isDoc ? 'legal' : 'page', preload: heroFor(pg.slug, pg.hero), jsonLd: [{ '@context': 'https://schema.org', '@type': pg.slug === 'about' ? 'AboutPage' : pg.slug === 'contact' ? 'ContactPage' : 'WebPage', name: pg.title, description: pg.description, url: abs(`/${pg.slug}/`) }] },
      { page: pg.slug },
      body,
    );
  }

  /* The 404 page: no hero. Everything that needs JavaScript (the countdown card, the email-link notice, "Go back") ships hidden;
     js/notfound.js reveals the right parts. Every address goes through u(), because GitHub Pages serves this file at any missing path. */
  function notFound() {
    const mail = config.contact?.general || '';
    const pills = [
      ...categories.filter((c) => !c.empty).map((c) => [u(`/category/${c.slug}/`), c.name]),
      [u('/popular/'), 'Popular posts'],
      [u('/post/'), 'All posts'],
    ];
    return layout(
      { title: 'Page not found', description: 'The page you were looking for could not be found.', path: '/404.html', noindex: true, noReferrer: true, adKind: 'notfound' },
      {},
      `<section class="nf" data-nf><div class="wrap nf-in">
  <p class="nf-code"><span class="sr-only">Error </span>404</p>
  <span class="nf-badge" aria-hidden="true">${icon('search', 44)}</span>
  <h1 class="nf-title">Page not found</h1>
  <p class="nf-text">We could not find the page you are looking for. It may have moved or been removed, or the address may be wrong.</p>
  <div class="nf-card nf-timer" data-nf-timer hidden>
    <p class="nf-timer-head"><span class="nf-dot" aria-hidden="true"></span><span data-nf-text tabindex="-1">Taking you to the home page in</span></p>
    <p class="nf-count" data-nf-count></p>
    <p class="nf-unit" data-nf-unit>seconds</p>
    <button class="btn btn-outline btn-sm" type="button" data-nf-stop>Stop, stay on this page</button>
  </div>
  <div class="nf-card nf-flow" data-nf-flow hidden>
    <h2 class="nf-card-title">This email link is not working right now</h2>
    <p>You opened a link from one of our emails, but the page it opens is not available at the moment. Nothing has been changed. Please try the link in the email again later. If it still does not work, email us at <a href="mailto:${e(mail)}">${e(mail)}</a> and tell us what you were trying to do.</p>
  </div>
  <p class="sr-only" role="status" data-nf-status></p>
  <div class="nf-actions"><a class="btn btn-primary btn-lg" href="${u('/')}">${icon('home', 18)} Go to homepage</a><button class="btn btn-outline btn-lg" type="button" data-nf-back hidden>${icon('arrowLeft', 18)} Go back</button></div>
  <div class="nf-more">
    <h2 class="nf-more-title">Looking for something specific?</h2>
    <form class="nf-search" action="${u('/search/')}" method="get" role="search">
      <label class="sr-only" for="nf-q">Search ${e(config.name)}</label>
      <input id="nf-q" name="q" type="search" placeholder="Search articles" autocomplete="off">
      <button class="btn btn-primary" type="submit">${icon('search', 18)} Search</button>
    </form>
    <ul class="nf-links">${pills.map(([href, name]) => `<li><a class="chip" href="${href}">${e(name)}</a></li>`).join('')}</ul>
  </div>
</div></section>`,
    );
  }

  /* The "Listen" player bar. It stays hidden until the reader presses Listen; js/listen.js drives it. */
  function listenPlayer() {
    const b = (act, label, inner, cls = '') => `<button class="pl-btn${cls ? ' ' + cls : ''}" type="button" data-lp="${act}" aria-label="${label}">${inner}</button>`;
    return `<section class="player" id="listen-player" data-listen-player data-state="idle" aria-label="Listen to this article">
  <div class="player-track" data-lp-track role="progressbar" aria-label="Listening progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="player-fill" data-lp-fill></span></div>
  <div class="player-body">
    <div class="player-info">
      <span class="eq eq-lg" aria-hidden="true"><i></i><i></i><i></i></span>
      <div class="player-text"><p class="player-label" data-lp-label>Ready</p><p class="player-sub" data-lp-sub></p></div>
    </div>
    <div class="player-controls">
      ${b('prev', 'Previous paragraph', icon('skipBack', 20))}
      ${b('toggle', 'Play or pause', `${icon('play', 22, 'i-play')}${icon('pause', 22, 'i-pause')}`, 'pl-play')}
      ${b('next', 'Next paragraph', icon('skipForward', 20))}
      <button class="pl-btn pl-speed" type="button" data-lp="speed" aria-label="Reading speed"><span data-lp-speed>1×</span></button>
      <button class="pl-btn" type="button" data-lp="follow" aria-pressed="true" aria-label="Auto-scroll with the reading" title="Auto-scroll">${icon('chevronsDown', 20)}</button>
      <button class="pl-btn" type="button" data-lp="settings" aria-expanded="false" aria-controls="listen-settings" aria-label="Voice settings">${icon('sliders', 20)}</button>
      ${b('close', 'Stop listening and close the player', icon('x', 20))}
    </div>
  </div>
  <div class="player-settings" id="listen-settings" data-lp-settings>
    <label for="listen-voice">Voice</label>
    <select id="listen-voice" data-lp-voice></select>
    <p class="player-hint">Voices come from your device and browser, so they differ between phones and computers. The first one in the list is the one we think sounds best.</p>
  </div>
  <p class="sr-only" role="status" aria-live="polite" data-lp-status></p>
</section>`;
  }

  /* Previous / next article cards: the other article's picture, with its title over a dark gradient so the words stay readable. */
  function postNav(older, newer) {
    const card = (x, dir) => {
      const label = dir === 'prev' ? `${icon('arrowLeft', 16)} Previous<span class="pn-long"> article</span>` : `Next<span class="pn-long"> article</span> ${icon('arrowRight', 16)}`;
      if (!x) {
        return `<a class="pn pn-${dir} pn-all" href="${u('/post/')}">
  <img class="pn-img" src="${resolveImage(config.heroImage)}" alt="" width="1400" height="800" loading="lazy" decoding="async">
  <span class="pn-shade" aria-hidden="true"></span>
  <span class="pn-body"><span class="pn-dir">${dir === 'prev' ? icon('arrowLeft', 16) : ''} All articles ${dir === 'next' ? icon('arrowRight', 16) : ''}</span><strong class="pn-title">${dir === 'prev' ? 'That is our oldest article' : 'You have read our newest article'}</strong><span class="pn-meta">Browse everything on ${e(config.name)}</span></span>
</a>`;
      }
      return `<a class="pn pn-${dir}" href="${u(x.path)}" rel="${dir}">
  <img class="pn-img" src="${fallbackImage(x)}" alt="" width="${x.imageW || 1400}" height="${x.imageH || 800}" loading="lazy" decoding="async">
  <span class="pn-shade" aria-hidden="true"></span>
  <span class="pn-body"><span class="pn-dir">${label}</span><strong class="pn-title">${e(x.title)}</strong><span class="pn-meta">${e(x.category.name)} · ${x.readingMinutes} min read</span></span>
</a>`;
    };
    return `<nav class="post-nav" aria-label="Previous and next articles">${card(older, 'prev')}${card(newer, 'next')}</nav>`;
  }

  /* --------------------------------------------------------------- post */
  function shareBar(p, label = 'Share', cls = '') {
    const url = abs(p.path);
    const q = encodeURIComponent;
    const links = [
      ['facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`],
      ['x', 'X', `https://x.com/intent/tweet?url=${q(url)}&text=${q(p.title)}`],
      // only the address: WhatsApp then shows the picture card (picture, bold title, description, domain) with the link under it,
      // so a title in the message text would only repeat what the card already says
      ['whatsapp', 'WhatsApp', `https://wa.me/?text=${q(url)}`],
      ['linkedin', 'LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${q(url)}`],
    ];
    return `<div class="share${cls ? ' ' + cls : ''}" data-share data-url="${url}" data-title="${e(p.title)}">
  <span class="share-label">${icon('share', 17)} ${label}</span>
  ${links.map(([ic, name, href]) => `<a class="share-btn brand-${ic}" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Share on ${name}">${brandIcon(ic, 18)}</a>`).join('')}
  <button class="share-btn" type="button" data-copy-link aria-label="Copy link">${icon('link', 18)}</button>
  <button class="share-btn" type="button" data-native-share aria-label="Share" hidden>${icon('share', 18)}</button>
  <span class="share-note" role="status" aria-live="polite"></span>
</div>`;
  }

  // The table of contents: every ## and ### heading as a plain link to its id, with the ### questions nested under their ## section.
  // It is real HTML in the page (not drawn by JavaScript), so search engines see each heading's address and can offer it as a "jump to" link.
  const tocList = (items) => {
    const top = [];
    for (const t of items) {
      if (t.level === 3 && top.length) top[top.length - 1].kids.push(t);
      else top.push({ ...t, kids: [] });
    }
    const link = (t) => `<a href="#${t.id}">${e(t.text)}</a>`;
    return `<ol>${top.map((t) => `<li>${link(t)}${t.kids.length ? `<ol>${t.kids.map((k) => `<li>${link(k)}</li>`).join('')}</ol>` : ''}</li>`).join('')}</ol>`;
  };

  // Questions readers asked in the comments that the team answered (content/qa.json, refreshed with `node scripts/qa-sync.mjs`).
  // Written into the page as plain HTML so search engines can read them; js/engage.js replaces this list with the live one.
  const staticComments = (slug) => {
    const items = qa[slug] || [];
    if (!items.length) return '';
    const day = (ms) => fmtDate(new Date(ms));
    const node = (c, team) => `<article class="comment${team ? ' is-team' : ''}" id="comment-${c.id}"><span class="avatar" aria-hidden="true">${team ? `<img class="avatar-logo" src="${u('/assets/img/icon-192.png')}" alt="" width="96" height="96">` : e((c.name[0] || '?').toUpperCase())}</span><div><div class="comment-head"><span class="comment-name">${e(c.name)}</span>${team ? `<span class="team-badge">Team</span>` : ''}<time class="comment-time" datetime="${new Date(c.at).toISOString()}">${day(c.at)}</time></div><p class="comment-body">${e(c.body)}</p></div></article>`;
    return items.map((c) => `<article class="comment" id="comment-${c.id}"><span class="avatar" aria-hidden="true">${e((c.name[0] || '?').toUpperCase())}</span><div><div class="comment-head"><span class="comment-name">${e(c.name)}</span><time class="comment-time" datetime="${new Date(c.at).toISOString()}">${day(c.at)}</time></div><p class="comment-body">${e(c.body)}</p></div><div class="comment-replies">${c.replies.map((r) => node(r, true)).join('')}</div></article>`).join('');
  };

  const engageBlock = (p) =>
    !api
      ? ''
      : `<section class="engage" data-engage data-slug="${p.slug}" aria-labelledby="react-h">
  <div class="engage-head">
    <h2 id="react-h">How did this post make you feel?</h2>
    <p class="engage-total" data-total aria-live="polite"></p>
  </div>
  <div class="reactions" role="group" aria-label="Reactions">
    ${REACTIONS.map(([k, ic, label]) => `<button class="reaction" type="button" data-r="${k}" aria-pressed="false" aria-label="${label}"><span class="medal">${icon(ic, 26)}</span><span class="lbl">${label}</span><b class="n" aria-live="polite">0</b></button>`).join('')}
  </div>
  <p class="engage-note" role="status"></p>
</section>
<section class="comments" id="comments" data-comments data-slug="${p.slug}" aria-labelledby="comments-h">
  <h2 id="comments-h" tabindex="-1">Comments <span class="count" data-comment-count>(0)</span></h2>
  <p class="sr-only" role="status" data-comment-live></p>
  <form class="comment-form" novalidate>
    <div class="form-row">
      <div class="field"><label for="cm-name">Name</label><input id="cm-name" name="name" type="text" maxlength="50" autocomplete="nickname" required placeholder="Your name"></div>
      <div class="field"><label for="cm-email">Email <span class="opt">(optional, never shown)</span></label><input id="cm-email" name="email" type="email" maxlength="120" autocomplete="email" placeholder="you@example.com"></div>
    </div>
    <div class="field"><label for="cm-body">Your comment</label><textarea id="cm-body" name="body" rows="4" maxlength="1500" required placeholder="Share your thoughts, question or experience"></textarea></div>
    <p class="sr-only" role="status" data-notify-live></p>
    <div class="notify-row" data-notify-row hidden>
      <input id="cm-notify" class="notify-box" type="checkbox" name="notify" value="1" aria-describedby="cm-notify-hint">
      <label for="cm-notify">Email me a link to edit or delete this comment, and tell me when someone replies</label>
      <p id="cm-notify-hint" class="notify-hint">We use your address only for this and it is never shown. Reply emails come at most once a day for each comment, and each one has a link to stop them.</p>
    </div>
    <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <input type="hidden" name="parent" value="">
    ${config.turnstileSiteKey ? '<div class="cf-turnstile-slot" data-turnstile-slot></div>' : ''}
    <div class="comment-actions"><button class="btn btn-primary" type="submit">Post comment ${icon('arrowRight', 16)}</button><button class="btn btn-outline" type="button" data-cancel-reply hidden>Cancel reply</button></div>
    <p class="form-status" role="status" aria-live="polite"></p>
  </form>
  <div class="comment-list" data-comment-list>${staticComments(p.slug)}</div>
</section>`;

  // The one ad slot in the article sidebar. Nothing is written to the page until ads are really switched on
  // (adsense.client + adsense.autoAds + adsense.sidebarSlot in site.config.json), so there is never an empty "advertisement" box.
  // js/site.js turns it on only for readers who pressed Accept, and hides it again if no ad comes back.
  // Google's rules: the label may only say "Advertisements" or "Sponsored Links"; the unit must not start hidden.
  function sidebarAd() {
    const slot = String(config.adsense?.sidebarSlot || '').trim();
    if (!adsenseId || !config.adsense?.autoAds || !/^\d{6,20}$/.test(slot)) return '';
    return `<section class="rail-mod rail-ad" data-ad-box aria-label="Advertisements">
      <p class="ad-label">Advertisements</p>
      <ins class="adsbygoogle" style="display:block" data-ad-client="${e(adsenseId)}" data-ad-slot="${e(slot)}" data-ad-format="rectangle" data-full-width-responsive="false"></ins>
    </section>`;
  }

  /* ------------------------------------------------------ the sidebar of an article page
     Six modules (five on most articles, plus one ad slot once ads are on), each in its own style; everything is real (related articles, the reading path this article belongs to, topics that
     have posts, this article's own tags). The last module stays in view while you read: your progress and the Listen button. */
  function postRail(p, upNext, latest) {
    const mods = [];
    if (upNext) {
      mods.push(`<section class="rail-mod rail-next" aria-labelledby="rn-h"><a href="${u(upNext.path)}">
        <img src="${fallbackImage(upNext)}" alt="" width="${upNext.imageW || 1400}" height="${upNext.imageH || 800}" loading="lazy" decoding="async">
        <span class="rn-shade" aria-hidden="true"></span>
        <span class="rn-body"><span class="rn-kicker" id="rn-h">${icon('arrowRight', 14)} Read next</span><strong>${e(upNext.title)}</strong><span class="rn-meta">${e(upNext.category.name)} · ${upNext.readingMinutes} min read</span></span>
      </a></section>`);
    }
    // the reading path (set in site.config.json, homePaths) that contains this article
    const hp = (config.homePaths || []).find((x) => (x.posts || []).includes(p.slug));
    const steps = hp ? hp.posts.map((sl) => posts.find((x) => x.slug === sl)).filter(Boolean) : [];
    if (hp && steps.length >= 2) {
      const at = steps.findIndex((x) => x.slug === p.slug) + 1;
      mods.push(`<section class="rail-mod rail-path" aria-labelledby="rp-h">
        <p class="rail-eyebrow">${icon('list', 14)} Reading path · step ${at} of ${steps.length}</p>
        <h2 class="rail-title" id="rp-h">${e(hp.title)}</h2>
        <ol>${steps.map((x, i) => (x.slug === p.slug ? `<li class="is-here" aria-current="step"><span class="rp-n">${i + 1}</span><span class="rp-t">${e(x.title)}<em>You are here</em></span></li>` : `<li><a href="${u(x.path)}"><span class="rp-n">${i + 1}</span><span class="rp-t">${e(x.title)}<em>${x.readingMinutes} min read</em></span></a></li>`)).join('')}</ol>
      </section>`);
    }
    if (latest.length) {
      mods.push(`<section class="rail-mod rail-latest" aria-labelledby="rl-h"><h2 class="rail-title" id="rl-h">More like this</h2><ul class="rail-list">${latest.map((x) => `<li><a href="${u(x.path)}"><img src="${fallbackImage(x)}" alt="" width="96" height="64" loading="lazy" decoding="async"><span class="rl-body"><span class="rl-t">${e(x.title)}</span><em>${x.readingMinutes} min read</em></span></a></li>`).join('')}</ul></section>`);
    }
    const ad = sidebarAd();
    if (ad) mods.push(ad);
    // topics: this article's category and label first, then its tags (six chips at most)
    const chipList = [
      [p.category.name, u(`/category/${p.category.slug}/`)],
      ...(p.label ? [[p.label.name, u(`/category/${p.category.slug}/${p.label.slug}/`)]] : []),
      ...p.tags.map((t) => [t, tagHref(t)]),
    ].slice(0, 6);
    // "More topics" reveals the rest of the tag topics 12 at a time (js/site.js, list from /data/tags.json); without JavaScript it is a link to /tag/
    const more = tagTopics.length ? `<div class="rail-more" data-more-tags="${u('/data/tags.json')}" data-base="${u('/tag/')}" data-step="12"><button class="rail-more-btn" type="button" hidden>${icon('plus', 15)} <span>More topics</span></button><a class="rail-more-link" href="${u('/tag/')}">All topics ${icon('arrowRight', 14)}</a><span class="sr-only" role="status" aria-live="polite"></span></div>` : '';
    mods.push(`<section class="rail-mod rail-tags" aria-labelledby="rg-h"><h2 class="rail-title" id="rg-h">${icon('tag', 16)} Topics</h2><div class="chips" data-tag-chips>${chipList.map(([n, h]) => `<a class="chip" href="${h}">${e(n)}</a>`).join('')}</div>${more}</section>`);
    mods.push(`<section class="rail-mod rail-follow" aria-labelledby="rf-h">
      <h2 class="rail-title" id="rf-h">Follow</h2>
      <a class="rf-rss" href="${u('/rss/')}">${icon('rss', 18)} <span>Follow with RSS<small>New articles in your feed reader</small></span></a>
      ${config.social?.whatsapp ? `<a class="rf-rss" href="${e(config.social.whatsapp)}" target="_blank" rel="noopener noreferrer">${brandIcon('whatsapp', 18)} <span>WhatsApp Channel<small>Get a message when we publish</small></span></a>` : ''}
    </section>`);
    mods.push(`<section class="rail-mod rail-stick" aria-label="Your reading progress" data-rail-progress data-min="${p.readingMinutes}">
      <div class="rs-ring" style="--p:0" aria-hidden="true"><span data-rs-pct>0%</span></div>
      <div class="rs-text"><p class="rs-title">Your progress</p><p class="rs-sub" data-rs-left role="status" aria-live="off">${p.readingMinutes} min read</p></div>
      <button class="rs-listen" type="button" data-listen-proxy hidden>${icon('headphones', 17)} <span>Listen</span></button>
    </section>`);
    return `<aside class="post-rail" aria-label="More from ${e(config.name)}">\n      ${mods.join('\n      ')}\n    </aside>`;
  }

  function post(p, idx) {
    const related = posts
      .filter((x) => x.slug !== p.slug)
      .map((x) => ({ x, s: (x.category.slug === p.category.slug ? 3 : 0) + (x.label && x.label.slug === p.label?.slug ? 2 : 0) + x.tags.filter((t) => p.tags.includes(t)).length }))
      .sort((a, b) => b.s - a.s || b.x.date - a.x.date)
      .map((r) => r.x);
    const ranked = related;
    const newer = idx > 0 ? posts[idx - 1] : null;
    const older = idx < posts.length - 1 ? posts[idx + 1] : null;
    const crumbs = [['Home', u('/')], [p.category.name, u(`/category/${p.category.slug}/`)]];
    if (p.label) crumbs.push([p.label.name, u(`/category/${p.category.slug}/${p.label.slug}/`)]);
    crumbs.push([p.title, '']);
    const tocItems = p.toc.filter((t) => t.level === 2 || t.level === 3);
    const toc = p.toc.filter((t) => t.level === 2).length >= 3 ? `<nav class="toc" aria-label="Table of contents"><details open data-toc-details><summary class="aside-title">${icon('list', 16)} In this article</summary>${tocList(tocItems)}</details></nav>` : '';
    const author = authorOf(p.author);
    const authorName = author ? `<a href="${u(`/author/${author.slug}/`)}" rel="author">${e(p.author)}</a>` : `<span>${e(p.author)}</span>`;
    const latest = posts.filter((x) => x.slug !== p.slug).slice(0, 4);
    const body = `<article class="post">
  ${hero({
    kind: 'post',
    image: resolveImage(p.image || p.category.image || config.heroImage),
    alt: p.imageAlt || '',
    title: e(p.title),
    sub: p.excerpt,
    extra: `<div class="post-chips">
      <a class="badge badge-link" href="${u(`/category/${p.category.slug}/`)}">${e(p.category.name)}</a>
      ${p.label ? `<a class="badge badge-soft" href="${u(`/category/${p.category.slug}/${p.label.slug}/`)}">${e(p.label.name)}</a>` : ''}
    </div>
    <div class="post-meta">
      <span class="meta-item">${icon('user', 16)} ${authorName}</span>
      <span class="meta-item">${icon('calendar', 16)} ${timeTag(p.date, true)}</span>
      ${p.updated && p.updated > p.date ? `<span class="meta-item">Updated ${timeTag(p.updated, true)}</span>` : ''}
      ${api ? `<a class="meta-item meta-link" href="#comments">${icon('message', 16)} <span data-comment-count-link>Comments</span></a>` : ''}
    </div>`,
  })}
  <div class="post-crumbs wrap">${breadcrumbs(crumbs)}</div>
  <div class="post-layout wrap">
    <aside class="post-toc">${toc}</aside>
    <div class="post-main">
      <div class="post-tools">
        ${shareBar(p)}
        <button class="listen-btn" type="button" data-listen hidden aria-pressed="false" aria-controls="listen-player" title="Listen to this article">
          <span class="listen-ico">${icon('headphones', 20, 'i-head')}<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></span>
          <span class="listen-text"><span data-listen-label>Listen</span><span class="listen-long"> to this article</span><span class="listen-time" data-listen-time></span></span>
        </button>
      </div>
      <div class="article-content" id="article">
${p.html}
      </div>
      <div class="post-end">
      ${p.imageCredit ? `<p class="image-credit">${icon('image', 15)} ${e(p.imageCredit)}${p.imageSource ? ` · <a href="${e(p.imageSource)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</p>` : ''}
      ${p.tags.length ? `<div class="post-tags"><span>${icon('tag', 16)} Tags</span>${p.tags.map((t) => `<a class="chip" href="${tagHref(t)}">${e(t)}</a>`).join('')}</div>` : ''}
      ${engageBlock(p)}
        ${shareBar(p, 'Found this useful? Share it', 'share-end')}
      ${author ? `<div class="author-box">${authorAvatar(author, 'ap-sm')}<div><p class="author-name">Written by <a href="${u(`/author/${author.slug}/`)}">${e(author.name)}</a>${author.role ? `<span class="author-role">${e(author.role)}</span>` : ''}</p><p>${e(author.bio)}</p><a class="author-more" href="${u(`/author/${author.slug}/`)}">All articles by ${e(author.name)} ${icon('arrowRight', 15)}</a></div></div>` : ''}
      <p class="post-disclaimer">This article is for general information only. Check the official sources linked above before you make decisions about money, health, study or work. Spotted a mistake? <a href="mailto:${e(config.contact.general)}?subject=Correction:%20${encodeURIComponent(p.title)}">Tell us</a> and we will fix it. See our <a href="${u('/editorial-policy/')}">Editorial Policy</a>.</p>
        ${postNav(older, newer)}
      </div>
    </div>
    ${postRail(p, ranked[0], ranked.slice(1, 6))}
  </div>
</article>
${related.length ? `<section class="section section-alt">
  <div class="wrap">
    ${sectionHead('Keep reading', 'All posts', u('/post/'))}
    ${grid(related.slice(0, 3))}
  </div>
</section>` : ''}
${listenPlayer()}
<button class="to-top" type="button" data-to-top aria-label="Back to top" hidden>${icon('arrowUp', 20)}</button>`;
    const published = p.date.toISOString();
    const modified = (p.updated || p.date).toISOString();
    return layout(
      {
        title: p.metaTitle || p.title,
        description: p.metaDescription || p.excerpt,
        path: p.path,
        share: `post-${p.slug}`,
        imageAlt: p.imageAlt,
        type: 'article',
        adKind: 'post',
        preload: resolveImage(p.image || p.category.image || config.heroImage),
        article: { published, modified, section: p.category.name, author: p.author, authorUrl: author ? abs(`/author/${author.slug}/`) : '', tags: p.tags },
        bodyClass: 'page-post',
        listen: true,
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: p.title,
            description: p.excerpt,
            image: [p.image ? absImage(p.image) : absImage(config.orgLogo || config.logo)],
            datePublished: published,
            dateModified: modified,
            author: { '@type': 'Person', name: p.author, ...(author ? { '@id': `${abs(`/author/${author.slug}/`)}#person`, url: abs(`/author/${author.slug}/`) } : {}) },
            publisher: orgJson(),
            mainEntityOfPage: { '@type': 'WebPage', '@id': abs(p.path) },
            articleSection: p.category.name,
            keywords: p.tags.join(', ') || undefined,
            wordCount: p.words,
            inLanguage: config.language,
          },
          { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: c[1] ? `${siteUrl}${c[1]}` : abs(p.path) })) },
        ],
      },
      { type: 'post', cat: p.category.slug },
      body,
    );
  }

  // Tiny redirect page so an old/alternate URL keeps working (GitHub Pages has no server redirects).
  // The stub also carries the preview tags of the post it points to: an app that does not follow meta refreshes (WhatsApp, for one) would
  // otherwise show a bare "Redirecting" card when someone shares an old address.
  function aliasStub(fromPath, toPath, title, p = null) {
    const to = abs(toPath);
    const si = p ? shareImage(`post-${p.slug}`, p.imageAlt) : null;
    const og = si
      ? `
<meta property="og:site_name" content="${e(config.name)}"><meta property="og:type" content="article"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(p.metaDescription || p.excerpt)}"><meta property="og:url" content="${to}">
<meta property="og:image" content="${si.url}"><meta property="og:image:secure_url" content="${si.url}"><meta property="og:image:type" content="${si.type}"><meta property="og:image:width" content="${si.w}"><meta property="og:image:height" content="${si.h}">${si.alt ? `<meta property="og:image:alt" content="${e(si.alt)}">` : ''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${si.url}">`
      : '';
    return `<!doctype html>
<html lang="${config.language}"><head><meta charset="utf-8"><title>${e(title)}</title>${og}
<link rel="canonical" href="${to}">
<meta http-equiv="refresh" content="0; url=${u(toPath)}"><meta name="viewport" content="width=device-width, initial-scale=1">
<script>location.replace(${JSON.stringify(u(toPath))}+location.search+location.hash)</script></head>
<body><p>This page has moved to <a href="${u(toPath)}">${e(title)}</a>.</p></body></html>
`;
  }

  /* ------------------------------------------------------- xml & friends */
  const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // sitemap.xml is an index. It lists child sitemaps by type (pages, posts, categories, labels, images, videos), and each child holds at most
  // `sitemapUrlsPerFile` addresses (default 200). When a type grows past that, the next file appears on its own: posts-sitemap2.xml, and so on.
  // Company and legal pages are noindex on purpose, so they are left out. People get the same lists as ordinary web pages under /sitemap/
  // (sitemapHtml below), because browsers are dropping the XSLT that styled the XML.
  function sitemapData() {
    const perFile = Math.max(1, Number(config.sitemapUrlsPerFile) || 200);
    const day = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
    const newest = posts[0]?.updated || posts[0]?.date || new Date();
    const when = (p) => p.updated || p.date;
    const url = (loc, lastmod, changefreq, priority, extra = '', info = {}) =>
      ({ loc, lastmod, info, xml: `  <url><loc>${xml(loc)}</loc><lastmod>${day(lastmod)}</lastmod>${changefreq ? `<changefreq>${changefreq}</changefreq><priority>${priority}</priority>` : ''}${extra}</url>` });

    const pageUrls = [url(abs('/'), newest, 'daily', '1.0', '', { title: 'Home' }), url(abs('/post/'), newest, 'daily', '0.8', '', { title: 'All posts' })];
    if (posts.some((x) => x.featured)) pageUrls.push(url(abs('/popular/'), newest, 'weekly', '0.6', '', { title: 'Popular posts' }));
    pageUrls.push(url(abs('/category/'), newest, 'weekly', '0.6', '', { title: 'Categories' }), url(abs('/label/'), newest, 'weekly', '0.4', '', { title: 'Topics' }));
    for (const t of tagTopics) if (t.list.length >= 3) pageUrls.push(url(abs(`/tag/${t.slug}/`), when(t.list[0]), 'weekly', '0.5', '', { title: `Tag: ${t.name || t.slug}` }));
    for (const a of authors) pageUrls.push(url(abs(`/author/${a.slug}/`), newest, 'monthly', '0.4', '', { title: `Author: ${a.name}` }));

    const postUrls = posts.map((p) => url(abs(p.path), when(p), 'monthly', '0.9', '', { title: p.title, note: p.category.name }));

    const categoryUrls = [];
    const labelUrls = [];
    for (const c of categories.filter((x) => !x.empty)) {
      const latest = posts.find((p) => p.category.slug === c.slug);
      categoryUrls.push(url(abs(`/category/${c.slug}/`), latest ? when(latest) : newest, 'weekly', '0.8', '', { title: c.name }));
      for (const l of c.labels) {
        const mine = posts.filter((x) => x.category.slug === c.slug && x.label?.slug === l.slug);
        if (mine.length >= 3) labelUrls.push(url(abs(`/category/${c.slug}/${l.slug}/`), when(mine[0]), 'weekly', '0.6', '', { title: `${l.name} in ${c.name}` }));
      }
    }

    // pictures: the cover and every picture inside the article, on the article's address
    const imageUrls = [];
    for (const p of posts) {
      const srcs = new Map();
      if (p.image) srcs.set(absImage(p.image), p.imageAlt || p.title);
      for (const m of p.html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"[^>]*>/gi)) {
        const src = /^https?:\/\//i.test(m[1]) ? m[1] : m[1].startsWith('/') ? `${siteUrl}${m[1]}` : '';
        if (!src || srcs.has(src)) continue;
        const alt = /\salt="([^"]*)"/i.exec(m[0]);
        srcs.set(src, (alt && alt[1].trim()) || p.title);
      }
      if (!srcs.size) continue;
      const extra = [...srcs].slice(0, 1000).map(([loc, title]) => `\n    <image:image><image:loc>${xml(loc)}</image:loc><image:title>${xml(String(title).slice(0, 200))}</image:title></image:image>`).join('');
      imageUrls.push(url(abs(p.path), when(p), '', '', `${extra}\n  `, { title: p.title, thumb: [...srcs.keys()][0], note: `${srcs.size} ${srcs.size === 1 ? 'picture' : 'pictures'}` }));
    }

    // videos: own files and YouTube videos named with ::video and ::youtube lines
    const videoUrls = [];
    for (const p of posts) {
      for (const v of p.videos || []) {
        const yt = v.kind === 'youtube' ? /(?:youtu\.be\/|[?&]v=|\/embed\/)([A-Za-z0-9_-]{11})/.exec(v.src) : null;
        if (v.kind === 'youtube' && !yt) continue;
        const thumb = absImage(v.poster || p.image);
        if (!thumb) continue;
        const target = yt ? `<video:player_loc>https://www.youtube.com/embed/${yt[1]}</video:player_loc>` : `<video:content_loc>${xml(/^https?:\/\//i.test(v.src) ? v.src : abs(`/${v.src.replace(/^\//, '')}`))}</video:content_loc>`;
        const title = (v.caption || p.title).slice(0, 100);
        const desc = (v.caption || p.excerpt || p.title).slice(0, 2000);
        videoUrls.push(url(abs(p.path), when(p), '', '', `\n    <video:video><video:thumbnail_loc>${xml(thumb)}</video:thumbnail_loc><video:title>${xml(title)}</video:title><video:description>${xml(desc)}</video:description>${target}</video:video>\n  `, { title: p.title, thumb, note: title }));
      }
    }

    const groups = [
      { type: 'pages', stem: 'pages-sitemap', name: 'Pages', title: 'Home, lists, topics and authors', blurb: 'The home page, article lists, tag pages and author pages.', list: pageUrls },
      { type: 'posts', stem: 'posts-sitemap', name: 'Posts', title: 'All published articles', blurb: 'Every article, with the date it was last changed.', list: postUrls },
      { type: 'category', stem: 'category-sitemap', name: 'Categories', title: 'Category pages', blurb: 'One page for each topic area.', list: categoryUrls },
      { type: 'label', stem: 'label-sitemap', name: 'Labels', title: 'Topic label pages', blurb: 'Label pages that have at least three articles.', list: labelUrls },
      { type: 'image', stem: 'image-sitemap', name: 'Images', title: 'Pictures in the articles', blurb: 'Each article with its cover and body pictures.', list: imageUrls },
      { type: 'video', stem: 'video-sitemap', name: 'Videos', title: 'Videos in the articles', blurb: 'Each article that has a video.', list: videoUrls },
    ].filter((g) => g.list.length);
    // every file of every type: its name, its position and the addresses in it
    const parts = [];
    for (const g of groups) {
      const total = Math.ceil(g.list.length / perFile);
      for (let i = 0; i < g.list.length; i += perFile) parts.push({ g, n: i / perFile + 1, total, start: i + 1, items: g.list.slice(i, i + perFile) });
    }
    return { day, parts, NS: { image: ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"', video: ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"' } };
  }

  function sitemaps() {
    const { day, parts, NS } = sitemapData();
    const head = `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="${u('/sitemap.xsl')}"?>\n`;
    const files = new Map();
    const index = [];
    for (const { g, n, total, start, items } of parts) {
      const name = `${g.stem}${n}.xml`;
      // a note for the styled view (sitemap.xsl): which type, which part, the number of its first address and the neighbouring files
      const note = `<!-- mb-sitemap type=${g.type} part=${n} of=${total} start=${start}${n > 1 ? ` prev=${u(`/${g.stem}${n - 1}.xml`)}` : ''}${n < total ? ` next=${u(`/${g.stem}${n + 1}.xml`)}` : ''} -->\n`;
      files.set(name, `${head}${note}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${NS[g.type] || ''}>\n${items.map((x) => x.xml).join('\n')}\n</urlset>\n`);
      const last = items.reduce((a, x) => (x.lastmod > a ? x.lastmod : a), items[0].lastmod);
      index.push(`  <sitemap><loc>${xml(abs(`/${name}`))}</loc><lastmod>${day(last)}</lastmod></sitemap>`);
    }
    files.set('sitemap.xml', `${head}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${index.join('\n')}\n</sitemapindex>\n`);
    return files;
  }

  // The same lists as ordinary web pages for people: /sitemap/ (the index), then /sitemap/posts-1/, /sitemap/posts-2/ and so on.
  // They are noindex (search engines read the XML), and they work in every browser.
  function sitemapHtml() {
    const { day, parts } = sitemapData();
    const out = new Map();
    const local = (s) => (String(s).startsWith(siteUrl) ? String(s).slice(siteUrl.length) : s);
    const pathOf = ({ g, n }) => `/sitemap/${g.type}-${n}/`;
    const image = heroFor('sitemap');
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    const cards = parts.map((pt) => {
      const last = pt.items.reduce((a, x) => (x.lastmod > a ? x.lastmod : a), pt.items[0].lastmod);
      return `<li><a class="sm-card" href="${u(pathOf(pt))}">
  <span class="sm-kind">${e(pt.g.name)}${pt.total > 1 ? ` &middot; part ${pt.n}` : ''}</span>
  <h2>${e(pt.g.title)}</h2>
  <p>${e(pt.g.blurb)}</p>
  <span class="sm-meta">${count(pt.items.length, 'address', 'addresses')} &middot; changed ${day(last)}</span>
  <span class="sm-open">Open the list ${icon('arrowRight', 16)}</span>
</a></li>`;
    });
    out.set('/sitemap/', layout(
      { title: 'Sitemap', description: describe(`A complete index of every article and page on ${config.name}, grouped by type.`, 'Open a list, then choose any article.', 1), path: '/sitemap/', noindex: true, adKind: 'page', preload: image },
      {},
      `${hero({ image, title: 'Sitemap', sub: `Every article and page on ${config.name}, grouped by type. Open a list, then choose any address.`, crumbs: [['Home', u('/')], ['Sitemap', '']] })}
<section class="section"><div class="wrap">
  <ul class="sm-grid">${cards.join('')}</ul>
  <p class="sm-note">Search engines read the XML version, <a href="${u('/sitemap.xml')}">sitemap.xml</a>. About, Contact, Work with us and the policy pages are not listed.</p>
</div></section>`,
    ));

    for (const pt of parts) {
      const { g, n, total, start, items } = pt;
      const label = total > 1 ? `${g.name} sitemap, part ${n} of ${total}` : `${g.name} sitemap`;
      const rows = items.map((x, k) => `<tr>
  <td class="sm-n">${start + k}</td>
  <td class="sm-t">${x.info.thumb ? `<img class="sm-thumb" src="${e(local(x.info.thumb))}" alt="" width="72" height="48" loading="lazy" decoding="async">` : ''}<span class="sm-tt"><a href="${local(x.loc)}">${e(x.info.title)}</a>${x.info.note ? `<small>${e(x.info.note)}</small>` : ''}</span></td>
  <td class="sm-d">${day(x.lastmod)}</td>
</tr>`).join('');
      const prev = n > 1 ? `<a class="btn btn-outline" rel="prev" href="${u(pathOf({ g, n: n - 1 }))}">${icon('arrowLeft', 16)} Previous list</a>` : '<span></span>';
      const next = n < total ? `<a class="btn btn-outline" rel="next" href="${u(pathOf({ g, n: n + 1 }))}">Next list ${icon('arrowRight', 16)}</a>` : '<span></span>';
      out.set(pathOf(pt), layout(
        { title: label, description: describe(`${g.blurb} Addresses ${start} to ${start + items.length - 1} on ${config.name}.`, 'Choose any address to open it.', 1), path: pathOf(pt), noindex: true, adKind: 'page', preload: image },
        {},
        `${hero({ image, title: e(label), sub: `${g.blurb} Addresses ${start} to ${start + items.length - 1}. Choose any address to open it.`, crumbs: [['Home', u('/')], ['Sitemap', u('/sitemap/')], [g.name, '']] })}
<section class="section"><div class="wrap">
  <div class="sm-table-wrap"><table class="sm-table">
    <caption class="sr-only">${e(label)}</caption>
    <thead><tr><th scope="col">#</th><th scope="col">${g.type === 'posts' ? 'Article' : 'Page'}</th><th scope="col">Last changed</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <nav class="sm-pager" aria-label="Sitemap lists">${prev}<a class="btn btn-outline" href="${u('/sitemap/')}">All lists</a>${next}</nav>
</div></section>`,
      ));
    }
    return out;
  }

  // /rss/ is the page people open. feed.xml itself is plain XML for feed readers (browsers show it as code), so no visible link points at it.
  function rssPage() {
    const feedUrl = abs('/feed.xml');
    const latest = posts.slice(0, 5);
    const image = heroFor('rss');
    const faq = [
      ['Does it cost anything, and do I need an account?', 'No. The feed is free and you do not need to sign up with us. Some reader apps ask you to make an account with them, which is their rule, not ours.'],
      ['Do you know who follows the feed?', `No. Your reader asks our site for the feed file, in the same way a browser asks for a web page. We do not collect names or email addresses through the feed. Our hosting provider handles technical data as described in the <a href="${u('/privacy-policy/')}">Privacy Policy</a>.`],
      ['How do I stop following?', 'Remove the feed from your reader app. Nothing else is needed.'],
      ['Does the feed have the whole article?', `Yes. Each item carries the full article text, so you can read it in your reader. The articles on the website have the pictures, the videos and the "Listen to this article" button.`],
    ];
    return layout(
      { title: 'Follow with RSS', description: describe(`Get new ${config.name} articles in your feed reader. Copy the feed address, paste it into a reader and read for free.`, 'No account or email needed.', 1), path: '/rss/', noindex: true, adKind: 'page', preload: image },
      {},
      `${hero({ image, title: 'Follow with RSS', sub: 'New articles in the app you choose. No account and no email needed.', crumbs: [['Home', u('/')], ['Follow with RSS', '']] })}
<section class="section"><div class="wrap wrap-narrow">
  <div class="rss-box">
    <h2 class="rss-h">${icon('rss', 22)} Your feed address</h2>
    <p>Copy this address and paste it into a feed reader.</p>
    <div class="rss-copy">
      <input id="rss-url" class="rss-url" type="text" readonly value="${e(feedUrl)}" aria-label="Feed address" spellcheck="false" autocomplete="off">
      <button class="btn btn-primary" type="button" data-copy="#rss-url" hidden>Copy address</button>
    </div>
    <p class="rss-status" role="status" aria-live="polite"></p>
    <p class="rss-raw">The feed file itself is plain XML made for apps, so it looks technical in a browser. <a href="${u('/feed.xml')}">Open the feed file</a> if you want to see it.</p>
  </div>
  <div class="prose-page">
    <h2>What is RSS?</h2>
    <p>RSS is a simple way to get the new articles of a website in one place. You choose an app, add the feed address once, and the app shows new articles when we publish them. You do not need to visit the site to check.</p>
    <h2>How to follow in three steps</h2>
    <ol>
      <li><strong>Pick a feed reader.</strong> Examples are Feedly, Inoreader, NetNewsWire and Thunderbird. We have no link with these apps and do not endorse them.</li>
      <li><strong>Copy the address above.</strong> Press the Copy address button.</li>
      <li><strong>Add it in your reader.</strong> Look for "Add feed", "Add subscription" or a plus button, and paste the address.</li>
    </ol>
    <h2>The latest articles in the feed</h2>
    <ul class="rss-latest">${latest.map((p) => `<li><a href="${u(p.path)}">${e(p.title)}</a> <span class="rss-date">${timeTag(p.date)}</span></li>`).join('')}</ul>
    <h2>Common questions</h2>
  </div>
  <div class="faq">${faq.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${a}</p></details>`).join('')}</div>
</div></section>`,
    );
  }

  function feed() {
    const items = posts.slice(0, 30);
    const absolutize = (h) => h.replace(/(href|src)="(\/(?!\/)[^"]*)"/g, (_m, a, p) => `${a}="${siteUrl}${p}"`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/css" href="${u('/feed.css')}"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>${xml(config.name)}</title>
  <link>${abs('/')}</link>
  <description>${xml(config.description)}</description>
  <language>${config.language}</language>
  <lastBuildDate>${(items[0]?.date || new Date()).toUTCString()}</lastBuildDate>
  <atom:link href="${abs('/feed.xml')}" rel="self" type="application/rss+xml"/>
${items.map((p) => `  <item>
    <title>${xml(p.title)}</title>
    <link>${abs(p.path)}</link>
    <guid isPermaLink="true">${abs(p.path)}</guid>
    <pubDate>${p.date.toUTCString()}</pubDate>
    <dc:creator>${xml(p.author)}</dc:creator>
    <category>${xml(p.category.name)}</category>
    <description>${xml(p.excerpt)}</description>
    <content:encoded><![CDATA[${absolutize(p.html).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></content:encoded>
  </item>`).join('\n')}
</channel>
</rss>
`;
  }

  function robots() {
    const lines = [
      'User-agent: *',
      'Allow: /',
      '# Site sources and notes are not for search results',
      'Disallow: /content/',
      'Disallow: /scripts/',
      'Disallow: /worker/',
      'Disallow: /docs/',
      'Disallow: /CLAUDE.md',
      'Disallow: /DEPLOY.md',
      'Disallow: /README.md',
      'Disallow: /site.config.json',
      '',
      '# Googlebot, Bingbot (also feeds Yahoo and DuckDuckGo), YandexBot and Mediapartners-Google (AdSense) follow the rules above.',
      `Sitemap: ${abs('/sitemap.xml')}`,
    ];
    if (config.blockAiCrawlers) {
      lines.push('', '# AI training crawlers (set "blockAiCrawlers": false in site.config.json to allow). Search crawlers are not affected.');
      for (const b of BOT_RULES) lines.push(`User-agent: ${b}`, 'Disallow: /', '');
      lines.push('# Generic "do not use for AI training" signal announced by Microsoft and Google', 'User-agent: __usage_ai-training', 'Disallow: /', '');
    }
    return lines.join('\n').replace(/\n+$/, '\n');
  }

  function manifest() {
    return (
      JSON.stringify(
        {
          name: config.name,
          short_name: config.name.replace(/\s+/g, ''),
          description: config.slogan,
          start_url: u('/'),
          scope: u('/'),
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: config.themeColor,
          icons: [
            { src: u('/assets/img/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: u('/assets/img/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
          ],
          categories: ['news', 'education', 'lifestyle'],
        },
        null,
        2,
      ) + '\n'
    );
  }

  function searchIndex() {
    return (
      JSON.stringify(
        posts.map((p) => ({ t: p.title, u: u(p.path), s: p.slug, e: p.excerpt, c: p.category.name, l: p.label?.name || '', g: p.tags, d: p.date.toISOString().slice(0, 10), i: resolveImage(p.image) || '', x: p.text.slice(0, 700) })),
      ) + '\n'
    );
  }

  return { rssPage, sitemapHtml, tagTopics, tagsIndex, tagsJson, tagPage, home, category, categoriesIndex, labelsIndex, postsDirectory, popular, searchPage, staticPage, authorPage, notFound, post, aliasStub, sitemaps, feed, robots, manifest, searchIndex, helpers: { u, abs } };
}
