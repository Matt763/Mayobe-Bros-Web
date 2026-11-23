#!/usr/bin/env node
// Local preview server that behaves like GitHub Pages (folders serve index.html, unknown URLs get 404.html).
//   node scripts/serve.mjs [port]      then open http://127.0.0.1:8000/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.xsl': 'application/xslt+xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8', '.pdf': 'application/pdf', '.pfb': 'application/octet-stream',
};

/* /results/* is answered by the results Worker's own code (results-worker/), with a folder standing in for the R2 bucket:
   the same pages, redirects, 404s and sitemaps that Cloudflare will serve, read from results-data/. Cache headers are ignored here. */
const DATA = path.join(ROOT, 'results-data');
const fsBucket = {
  async get(key) {
    const file = path.normalize(path.join(DATA, String(key)));
    if (!file.startsWith(DATA + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return { text: async () => fs.readFileSync(file, 'utf8'), httpEtag: `"${fs.statSync(file).mtimeMs.toString(36)}"` };
  },
  async head(key) { return (await this.get(key)) ? {} : null; },
};
function indexMode() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8')).resultsData?.index || 'off'; } catch { return 'off'; }
}
let worker = null;
async function serveResults(req, res) {
  worker = worker || (await import('../results-worker/src/index.js'));
  const origin = `http://${req.headers.host}`;
  const out = await worker.handle(new Request(origin + req.url, { method: req.method }), { RESULTS: fsBucket, ORIGIN: origin, RESULTS_INDEX: indexMode() }, { waitUntil() {} });
  const headers = Object.fromEntries(out.headers);
  headers['cache-control'] = 'no-cache';
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}

function resolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const file = path.normalize(path.join(ROOT, p));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    const idx = path.join(file, 'index.html');
    return fs.existsSync(idx) ? idx : null;
  }
  return fs.existsSync(file) ? file : null;
}

/* /pdf/<16 hex>.pdf: until the owner moves the past papers into this project (see content/papers-manifest.json), the preview reads them from the
   owner's separate papers project, read-only, with byte ranges like a real host. Nothing is copied. PAPERS_SRC overrides the folder. */
const PAPERS_SRC = process.env.PAPERS_SRC || '/run/media/mclean/New Volume/MY WEBSITE PROJECTS/Mayobe Results Website';
function servePdf(req, res, id) {
  const own = path.join(ROOT, 'pdf', `${id}.pdf`), other = path.join(PAPERS_SRC, 'public/pdf', `${id}.pdf`);
  // PAPERS_PDF_DIR: a folder of already compressed copies (same file names, see scripts/tools/compress-papers.mjs); a file found there wins
  const packed = process.env.PAPERS_PDF_DIR ? path.join(process.env.PAPERS_PDF_DIR, `${id}.pdf`) : '';
  const file = packed && fs.existsSync(packed) ? packed : fs.existsSync(own) ? own : fs.existsSync(other) ? other : null;
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  const size = fs.statSync(file).size, range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  const head = { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' };
  if (range && (range[1] || range[2])) {
    let a = range[1] === '' ? size - Number(range[2]) : Number(range[1]), b = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (!(a >= 0 && a <= b && a < size)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 });
    fs.createReadStream(file, { start: a, end: b }).pipe(res);
    return;
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    // never expose source/config folders from the preview
    // (any dot-file such as .admin-token, plus worker/ with its keys, docs/ and the build files)
    const pathOnly = req.url.split('?')[0];
    let decoded = pathOnly;
    try { decoded = decodeURIComponent(pathOnly); } catch { /* resolve() refuses it */ }
    const hostOk = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host || '') || !!process.env.HOST;
    const hidden = !hostOk
      || /(^|\/)\.(?!well-known(\/|$))/.test(decoded)
      || /^\/(content|scripts|node_modules|worker|docs)(\/|$)/.test(decoded)
      || /^\/(site\.config\.json|package\.json|package-lock\.json)$/.test(decoded);
    const pdfId = !hidden && /^\/pdf\/([0-9a-f]{16})\.pdf$/.exec(decoded);
    if (pdfId) { servePdf(req, res, pdfId[1]); return; }
    if (!hidden && (decoded === '/results' || decoded.startsWith('/results/'))) {
      serveResults(req, res).catch((err) => { console.error(err); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Results preview error: ' + err.message); });
      return;
    }
    const file = hidden ? null : resolve(req.url);
    const target = file || path.join(ROOT, '404.html');
    const type = TYPES[path.extname(target)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding' };
    // Compress text the way Cloudflare does in production (brotli, else gzip), so the sizes seen here are the sizes visitors download.
    const accept = String(req.headers['accept-encoding'] || '');
    const text = /^(text\/|application\/(json|xml|xslt\+xml)|image\/svg)/.test(type);
    const enc = !text ? '' : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : '';
    if (enc) {
      headers['Content-Encoding'] = enc;
      res.writeHead(file ? 200 : 404, headers);
      const z = enc === 'br' ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.createGzip({ level: 6 });
      fs.createReadStream(target).pipe(z).pipe(res);
      return;
    }
    res.writeHead(file ? 200 : 404, headers);
    fs.createReadStream(target).pipe(res);
  })
  .listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`Preview: http://${process.env.HOST || '127.0.0.1'}:${PORT}/  (Ctrl+C to stop; HOST=0.0.0.0 lets a phone on the same Wi-Fi open it)`));
