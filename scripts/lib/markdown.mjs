// A small, dependency-free Markdown -> HTML converter.
// Supports: headings, paragraphs, bold/italic/strike, links, images (with captions),
// ordered/unordered/nested lists, blockquotes, fenced code, tables, horizontal rules,
// hard line breaks and raw HTML (blocks and inline). Post authors are trusted, so raw HTML
// is passed through untouched.

export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Escapes text but keeps entities such as &amp; &copy; &#8212; intact.
const escText = (s) => s.replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => escText(s).replace(/"/g, '&quot;');

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A link or picture address from a post. javascript:, vbscript: and data: addresses (also when hidden with spaces, tabs, line breaks or control
// characters, which browsers ignore inside the scheme) become "#", so pasted or drafted text can never run script from a click.
const ENTITY = { colon: ':', tab: '\t', newline: '\n', nbsp: ' ', lpar: '(', rpar: ')', amp: '&', sol: '/', period: '.', num: '#', quest: '?', excl: '!', apos: "'", quot: '"' };
const decodeEntities = (t) => t.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,8}));?/g, (m, d, h, n) => {
  if (n) return ENTITY[n.toLowerCase()] ?? m;
  const cp = d ? Number(d) : parseInt(h, 16);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
});
// Entities are decoded first (the browser decodes them inside href, so "javascript&colon;" is javascript:). A scheme that is not
// http, https, mailto or tel is refused; relative paths, "#" and "?" addresses are kept.
const cleanUrl = (u) => {
  const url = u.startsWith('<') && u.endsWith('>') ? u.slice(1, -1) : u;
  let flat = url;
  for (let i = 0; i < 3; i++) flat = decodeEntities(flat);
  flat = flat.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(flat);
  return scheme && !/^(?:https?|mailto|tel)$/i.test(scheme[1]) ? '#' : url;
};
const isExternal = (u) => /^https?:\/\//i.test(u);

/* ---------------------------------------------------------------- inline */
export function inline(src) {
  const stash = [];
  const put = (html) => `\u0000${stash.push(html) - 1}\u0000`;

  // code spans
  src = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, code) => put(`<code>${escapeHtml(code.trim())}</code>`));
  // <https://autolinks>
  src = src.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, u) => put(`<a href="${attr(u)}" rel="noopener">${escText(u)}</a>`));
  // raw inline html tags are kept verbatim
  src = src.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, (m) => put(m));
  src = escText(src);

  // images
  src = src.replace(
    /!\[([^\]]*)\]\(\s*(<[^>]+>|(?:[^\s()]|\([^\s()]*\))*)(?:\s+"([^"]*)")?\s*\)/g,
    (_m, alt, url, title) =>
      put(`<img src="${attr(cleanUrl(url))}" alt="${attr(alt)}"${title ? ` title="${attr(title)}"` : ''} loading="lazy" decoding="async">`),
  );
  // links
  src = src.replace(
    /\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]+>|(?:[^\s()]|\([^\s()]*\))*)(?:\s+"([^"]*)")?\s*\)/g,
    (_m, text, url, title) => {
      const href = cleanUrl(url);
      const rel = isExternal(href) ? ' rel="noopener"' : '';
      return put(`<a href="${attr(href)}"${title ? ` title="${attr(title)}"` : ''}${rel}>${emphasis(text)}</a>`);
    },
  );
  // bare URLs
  src = src.replace(/(^|[\s(])(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g, (_m, pre, u) => `${pre}${put(`<a href="${attr(u)}" rel="noopener">${u}</a>`)}`);

  src = emphasis(src);
  src = src.replace(/(?: {2,}|\\)\n/g, '<br>\n');

  // restore (placeholders may be nested)
  for (let i = 0; i < 6 && /\u0000\d+\u0000/.test(src); i++) {
    src = src.replace(/\u0000(\d+)\u0000/g, (_m, n) => stash[Number(n)]);
  }
  return src;
}

function emphasis(s) {
  return s
    .replace(/\*\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])__([^\s_](?:[\s\S]*?[^\s_])?)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/\*([^\s*](?:[\s\S]*?[^\s*])?)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^\s_](?:[\s\S]*?[^\s_])?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([\s\S]+?)~~/g, '<del>$1</del>');
}

/* ----------------------------------------------------------------- blocks */
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HTML_BLOCK_RE =
  /^\s{0,3}<\/?(div|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|iframe|video|audio|source|section|aside|details|summary|ul|ol|li|p|h[1-6]|blockquote|pre|hr|img|picture|script|style|form|center|nav|header|footer|article|dl|dt|dd|button|svg)\b/i;
const VOID_TAGS = new Set(['hr', 'img', 'source', 'br']);
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (l) => /^\s*$/.test(l);
const indentOf = (l) => l.match(/^ */)[0].length;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

// Video lines:   ::video[Caption](assets/video/clip.mp4){poster=assets/posts/clip.webp captions=assets/video/clip.vtt}
//                ::youtube[Caption](https://youtu.be/VIDEOID){poster=assets/posts/clip.webp}
// Every video is played by Plyr (see js/site.js). YouTube is only contacted after the reader presses play.
const MEDIA_RE = /^\s{0,3}::(video|youtube)\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/;
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg', mov: 'video/quicktime' };
const absPath = (u) => (/^(https?:)?\/\//i.test(u) || u.startsWith('/') ? u : `/${u}`);

let videoCount = 0; // numbers the video figures of one document (id="video-1", ...): emails link to /post/.../#video-1

function renderMedia(m) {
  const [, kind, caption, src, optText = ''] = m;
  const opts = {};
  for (const mm of optText.matchAll(/([a-z]+)=("[^"]*"|\S+)/gi)) opts[mm[1].toLowerCase()] = mm[2].replace(/^"|"$/g, '');
  const cap = caption.trim();
  const figcap = cap ? `\n<figcaption>${inline(cap)}</figcaption>` : '';
  const poster = opts.poster ? absPath(opts.poster) : '';
  if (kind === 'youtube') {
    const id = (src.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/) || src.match(/^([A-Za-z0-9_-]{11})$/) || [])[1];
    if (!id) return `<p><em>[video link not understood: ${escapeHtml(src)}]</em></p>`;
    const label = cap || 'this video';
    return `<figure class="video-figure video-embed" id="video-${++videoCount}" data-video-embed data-provider="youtube" data-embed-id="${id}" data-title="${attr(cap)}">
<button class="video-load" type="button" aria-label="Play video: ${attr(label)}">${poster ? `<img src="${attr(poster)}" alt="" loading="lazy" decoding="async">` : ''}<span class="video-load-play" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg></span><span class="video-load-note">Press play to watch. The video comes from YouTube, which is only contacted after you press play.</span></button>${figcap}
</figure>`;
  }
  const ext = (src.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const type = MIME[ext] || 'video/mp4';
  const track = opts.captions ? `<track kind="captions" srclang="${attr(opts.lang || 'en')}" label="${attr(opts.label || 'English')}" src="${attr(absPath(opts.captions))}" default>` : '';
  return `<figure class="video-figure" id="video-${++videoCount}">
<video controls playsinline preload="none"${poster ? ` poster="${attr(poster)}"` : ''}${cap ? ` aria-label="${attr(cap)}"` : ''}><source src="${attr(absPath(src))}" type="${type}">${track}Your browser cannot play this video. <a href="${attr(absPath(src))}">Download it</a>.</video>${figcap}
</figure>`;
}

function startsBlock(line, next) {
  if (MEDIA_RE.test(line)) return true;
  if (FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || /^\s{0,3}>/.test(line)) return true;
  if (/^\s{0,3}(?:[-*+]|1[.)])\s+\S/.test(line)) return true;
  if (HTML_BLOCK_RE.test(line)) return true;
  if (line.includes('|') && next !== undefined && next.includes('-') && TABLE_SEP_RE.test(next)) return true;
  return false;
}

function renderList(lines, start) {
  const first = lines[start].match(LIST_RE);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const block = [];
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) {
      // blank lines continue the list only if the next non-blank line is an item or indented
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && (indentOf(lines[j]) > base || (LIST_RE.test(lines[j]) && indentOf(lines[j]) === base))) {
        block.push(l);
        i++;
        continue;
      }
      break;
    }
    const lm = l.match(LIST_RE);
    if (lm && lm[1].length === base && /\d/.test(lm[2]) !== ordered) break;
    if (indentOf(l) < base) break;
    if (indentOf(l) === base && !lm) break;
    block.push(l);
    i++;
  }
  // split into top-level items
  const items = [];
  let cur = null;
  for (const l of block) {
    const lm = l.match(LIST_RE);
    if (lm && lm[1].length === base) {
      cur = { first: lm[3], rest: [] };
      items.push(cur);
    } else if (cur) cur.rest.push(l);
  }
  const html = items
    .map((it) => {
      const nonBlank = it.rest.filter((x) => !isBlank(x));
      const cut = nonBlank.length ? Math.min(...nonBlank.map(indentOf)) : 0;
      const body = [it.first, ...it.rest.map((x) => (isBlank(x) ? '' : x.slice(Math.min(cut, indentOf(x)))))];
      let inner = blocks(body);
      const single = inner.match(/^<p>([\s\S]*)<\/p>$/);
      if (single && !/<\/p>/.test(single[1])) inner = single[1];
      // tight item followed by a nested list: keep the first line as plain text, not a <p>
      else if (!it.rest.some(isBlank)) inner = inner.replace(/^<p>([\s\S]*?)<\/p>\n(?=<(?:ul|ol)\b)/, '$1\n');
      return `<li>${inner}</li>`;
    })
    .join('\n');
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  return { html: `<${tag}${startAttr}>\n${html}\n</${tag}>`, next: i };
}

function renderTable(lines, start) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : ''));
  let i = start + 2;
  const rows = [];
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
  const al = (n) => (aligns[n] ? ` style="text-align:${aligns[n]}"` : '');
  const th = head.map((c, n) => `<th${al(n)}>${inline(c)}</th>`).join('');
  const body = rows.map((r) => `<tr>${head.map((_c, n) => `<td${al(n)}>${inline(r[n] ?? '')}</td>`).join('')}</tr>`).join('\n');
  return { html: `<div class="table-wrapper"><table class="editor-table">\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`, next: i };
}

export function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    let m;
    // fenced code
    if ((m = line.match(FENCE_RE))) {
      const [, fence, lang] = m;
      const close = new RegExp(`^\\s{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      const buf = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = line.match(MEDIA_RE))) {
      out.push(renderMedia(m));
      i++;
      continue;
    }
    if ((m = line.match(HEADING_RE))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      out.push(`<blockquote>\n${blocks(buf)}\n</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_SEP_RE.test(lines[i + 1])) {
      const t = renderTable(lines, i);
      out.push(t.html);
      i = t.next;
      continue;
    }
    if (LIST_RE.test(line)) {
      const l = renderList(lines, i);
      out.push(l.html);
      i = l.next;
      continue;
    }
    if ((m = line.match(HTML_BLOCK_RE))) {
      const tag = m[1].toLowerCase();
      const buf = [];
      if (VOID_TAGS.has(tag) || /^\s*<\//.test(line)) {
        while (i < lines.length && !isBlank(lines[i])) buf.push(lines[i++]);
      } else {
        const open = new RegExp(`<${tag}(?:\\s|>|/)`, 'gi');
        const close = new RegExp(`</${tag}\\s*>`, 'gi');
        let depth = 0;
        while (i < lines.length) {
          const l = lines[i++];
          buf.push(l);
          depth += (l.match(open) || []).length - (l.match(close) || []).length;
          if (depth <= 0) break;
        }
      }
      out.push(buf.join('\n'));
      continue;
    }
    // paragraph
    const buf = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) buf.push(lines[i++]);
    const text = buf.map((s) => s.replace(/^\s+/, '')).join('\n');
    const img = text.match(/^!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)$/);
    if (img && img[3]) {
      out.push(
        `<figure><img src="${attr(img[2])}" alt="${attr(img[1])}" loading="lazy" decoding="async"><figcaption>${escText(img[3])}</figcaption></figure>`,
      );
    } else {
      out.push(`<p>${inline(text)}</p>`);
    }
  }
  return out.join('\n');
}

export function markdown(src) {
  videoCount = 0;
  return neutralise(blocks(String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')));
}

// Raw HTML is allowed in a post (<b>, <br>, <kbd>), but never anything that runs or loads code: script, iframe, object, embed, base, meta, link,
// form, svg and math tags become visible text, and on...= event attributes are dropped. (The Content-Security-Policy in every page is the
// second lock: even a missed case cannot run inline script.)
function neutralise(html) {
  return html
    .replace(/<\s*(script|iframe|object|embed|base|meta|link|form|svg|math|style)\b/gi, '&lt;$1')
    .replace(/(<[a-z][^>]*?)[\s/]+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1');
}

/* ------------------------------------------------- headings / contents */
export function plainText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

// Adds ids to h2/h3 headings (when missing) and returns the table of contents.
export function addHeadingIds(html) {
  const toc = [];
  const used = new Set();
  const out = html.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs, inner) => {
    const text = plainText(inner);
    let id = (attrs.match(/\sid="([^"]+)"/) || [])[1];
    if (!id) {
      const base = slugify(text) || 'section';
      id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      attrs = `${attrs} id="${id}"`;
    }
    used.add(id);
    toc.push({ level: Number(tag[1]), id, text });
    return `<${tag}${attrs}>${inner}</${tag}>`;
  });
  return { html: out, toc };
}
