// The AI use policy of the site in one place (owner's rule, 2026-11-16):
//   AI search and answer tools (tier A) may read the site to answer a user only if they show "Mayobe Bros" as the source with a working
//   link to the article, and send readers to the article for more. Everything else (training, datasets, copying, unknown AI agents:
//   tier B) is refused unless the Mayobe Bros Team agrees in writing.
// robots.txt can only allow or refuse a bot, so the conditions live on /ai-use-terms/ and in /license.xml (RSL 1.0, payment type
// "attribution"). The Cloudflare rules (docs/ai-bot-policy.md) are what really refuses a bot that ignores robots.txt.
// Used by scripts/lib/render.mjs (robots.txt), scripts/build.mjs (license.xml) and scripts/tests/ai-policy.test.mjs.

/** The day the terms took effect. The terms page, license.xml and the robots.txt comment all carry it. */
export const AI_TERMS_DATE = '2026-11-16';

/** Tier A: AI search and answer fetchers whose products show source links to the user (vendor documents, checked 2026-11-16). */
export const TIER_A = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'DuckAssistBot', 'MistralAI-User', 'Meta-WebIndexer'];

/** Tier B: AI training crawlers, and AI fetchers with no documented source links. robots.txt tokens, spelled as the vendors spell them. */
export const TIER_B = [
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Google-Extended', 'GoogleOther', 'Applebot-Extended', 'meta-externalagent', 'Meta-ExternalFetcher',
  'Amazonbot', 'Amzn-SearchBot', 'Amzn-User', 'MistralAI-Training', 'MistralAI-Index', 'CCBot', 'Bytespider', 'Diffbot', 'omgili', 'omgilibot',
  'ImagesiftBot', 'cohere-ai', 'cohere-training-data-crawler', 'Timpibot', 'YouBot',
];

/**
 * Never named in robots.txt or in a Cloudflare rule: they must keep working (search, AdSense, link previews). A named group would also
 * replace the "*" rules for that bot, so leaving them out is what keeps them under "*".
 */
export const NEVER_NAMED = ['Googlebot', 'Googlebot-Image', 'Googlebot-News', 'Googlebot-Video', 'Google-InspectionTool', 'Mediapartners-Google', 'AdsBot-Google', 'AdsBot-Google-Mobile', 'APIs-Google', 'Google-Display-Ads-Bot', 'bingbot', 'BingPreview', 'DuckDuckBot', 'YandexBot', 'Applebot', 'facebookexternalhit', 'WhatsApp', 'Twitterbot', 'LinkedInBot', 'TelegramBot', 'Slackbot'];

/** User-Agent substrings the Cloudflare tier B rule matches (lower case). Named vendor products only: never a word like "bot" or "compatible". */
export const CF_TIER_B = [
  'gptbot', 'claudebot', 'anthropic-ai', 'claude-web', 'ccbot', 'bytespider', 'meta-externalagent', 'meta-externalads', 'amazonbot', 'diffbot', 'cohere-ai',
  'cohere-training-data-crawler', 'imagesiftbot', 'omgili', 'timpibot', 'facebookbot', 'ai2bot', 'google-cloudvertexbot', 'aihitbot', 'bedrockbot', 'brightbot',
  'deepseekbot', 'erniebot', 'icc-crawler', 'kimibot', 'moonshotbot', 'qwenbot', 'tiktokspider', 'yibot', 'laiondownloader', 'img2dataset', 'crawl4ai',
  'friendlycrawler', 'velenpublicwebcrawler', 'webzio-extended',
];

/** The same for tier A (the draft "one switch" rule: turn it on and tier A is refused too). */
export const CF_TIER_A = ['oai-searchbot', 'chatgpt-user', 'claude-searchbot', 'claude-user', 'perplexitybot', 'perplexity-user', 'duckassistbot', 'mistralai-user', 'meta-webindexer', 'meta-externalfetcher', 'amzn-searchbot', 'amzn-user'];

/** Paths that are the site's sources, not pages: blocked for everyone at the edge (Rule 1). Never /results-shell.html: the results Worker fetches it. */
export const CF_SOURCE_FOLDERS = ['/content/', '/scripts/', '/worker/', '/results-worker/', '/docs/', '/.github/', '/.claude/', '/.superpowers/'];
export const CF_SOURCE_FILES = ['/claude.md', '/deploy.md', '/readme.md', '/site.config.json', '/package.json', '/package-lock.json', '/.gitignore', '/cname', '/.build-manifest.json', '/.share-cards.json', '/.email-images.json'];

/** A Cloudflare custom-rule expression: the User-Agent contains any of the names. */
export const cfUserAgentExpression = (names) => names.map((n) => `lower(http.user_agent) contains "${n}"`).join(' or ');

/** Rule 1 of docs/ai-bot-policy.md. */
export const cfSourcesExpression = () =>
  `(${CF_SOURCE_FOLDERS.map((p) => `starts_with(lower(http.request.uri.path), "${p}")`).join(' or ')}) or lower(http.request.uri.path) in {${CF_SOURCE_FILES.map((p) => `"${p}"`).join(' ')}}`;

const group = (agents, rules) => [...agents.map((a) => `User-agent: ${a}`), ...rules, ''];

/**
 * The AI part of robots.txt. `closed` is the list of rules every group must repeat: a bot with its own group ignores the "*" group, so
 * a tier A bot would otherwise be allowed to read /results/data/ (candidate files) and the site's source folders.
 * answers: 'allow' (tier A allowed under the terms) or 'block' (tier A refused too: the one switch).
 */
export function aiRobotsGroups({ closed, answers = 'allow' }) {
  const lines = [];
  const blockA = answers === 'block';
  if (!blockA) {
    lines.push(
      '# Tier A: AI search and answer tools. Allowed ONLY under the AI Use Terms: show "Mayobe Bros" as the source with a working link to the',
      '# article, and send readers to the article for more. A robots.txt file cannot state conditions; the terms and /license.xml do.',
      '# The rules of the first group are repeated on purpose: a named group replaces "*".',
      ...group(TIER_A, ['Content-Signal: search=yes, ai-train=no', 'Allow: /', ...closed]),
    );
  }
  lines.push(
    blockA
      ? '# Tier A and tier B: AI crawlers, AI search tools and AI agents are refused. Ask the Mayobe Bros Team for permission: /contact/'
      : '# Tier B: AI training crawlers, dataset builders and AI fetchers with no documented source links. Refused unless the Mayobe Bros Team agrees in writing: /contact/',
    ...group(blockA ? [...TIER_A, ...TIER_B] : TIER_B, ['Disallow: /']),
    '# Shared "do not use for AI training" preference (IETF draft). Anthropic honours it now; others announced support for 2027.',
    ...group(['__usage_ai-training'], ['Disallow: /']),
  );
  return lines;
}

/**
 * /license.xml in RSL 1.0 (rslstandard.org): free use for search and for answering a user, but only with visible credit and a working
 * link (payment type "attribution"); training is prohibited. answers 'block' permits search only.
 */
export function licenseXml({ abs, answers = 'allow' }) {
  const contact = abs('/contact/');
  const usage = answers === 'block' ? 'search' : 'search ai-input ai-index';
  const no = answers === 'block' ? 'ai-train ai-input ai-index' : 'ai-train';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content url="/">
    <license>
      <!-- Allowed: web search${answers === 'block' ? '' : ', and use of the content as input or in a retrieval index to answer a user'}. -->
      <permits type="usage">${usage}</permits>
      <!-- Not allowed: ${no.replace(/ /g, ', ')}. Ask the Mayobe Bros Team first. -->
      <prohibits type="usage">${no}</prohibits>
      <!-- Free, but the licensee must show visible credit and a working link to the original page. -->
      <payment type="attribution"/>
      <legal type="contact">${contact}</legal>
    </license>
    <copyright type="organization" contactUrl="${contact}">Mayobe Bros</copyright>
    <terms>${abs('/ai-use-terms/')}</terms>
  </content>
</rsl>
`;
}
