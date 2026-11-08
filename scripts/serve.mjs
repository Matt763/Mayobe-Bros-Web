#!/usr/bin/env node
// Local preview server that behaves like GitHub Pages (folders serve index.html, unknown URLs get 404.html).
//   node scripts/serve.mjs [port]      then open http://127.0.0.1:8000/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.xsl': 'application/xslt+xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

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
    const file = hidden ? null : resolve(req.url);
    const target = file || path.join(ROOT, '404.html');
    res.writeHead(file ? 200 : 404, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(target).pipe(res);
  })
  .listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`Preview: http://${process.env.HOST || '127.0.0.1'}:${PORT}/  (Ctrl+C to stop; HOST=0.0.0.0 lets a phone on the same Wi-Fi open it)`));
