#!/usr/bin/env node
// Runs the comments/reactions Worker locally with an in-memory database, for trying the site without Cloudflare.
//   node --no-warnings scripts/dev-api.mjs [port] [site-origin ...]
// Data disappears when you stop it. Moderation token for testing: dev-admin-token-1234
import http from 'node:http';
import worker from '../worker/src/index.js';
import { makeD1 } from './lib/d1-shim.mjs';

const port = Number(process.argv[2] || 8787);
const sites = process.argv.slice(3).length ? process.argv.slice(3) : ['http://127.0.0.1:8000'];
const env = { DB: makeD1(), ADMIN_TOKEN: 'dev-admin-token-1234', HASH_SALT: 'dev', ALLOWED_ORIGINS: sites.join(','), SITE_ORIGIN: sites[0] };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, { waitUntil() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`Dev API on http://127.0.0.1:${port}  (allowed sites: ${sites.join(', ')})`));
