// Tells search engines that pages are new, changed or gone, using the free IndexNow standard
// (Bing, and through it Yahoo and DuckDuckGo; also Yandex, Naver, Seznam, Yep). Google does not use IndexNow:
// for Google use the sitemap in Search Console.
//
//   node scripts/indexnow.mjs --init       make the key and its file (once; local only, sends nothing)
//   node scripts/indexnow.mjs --dry-run    show which addresses would be sent
//   node scripts/indexnow.mjs              send the new, changed and removed addresses
//   node scripts/indexnow.mjs --all        send every indexable address again (use rarely)
//
// Run it only AFTER the site is live and the new files are published (a minute or two after `git push`).
// It remembers what it sent in .indexnow-state.json, so unchanged pages are never sent twice.
// Rules of the service: send only new, changed or deleted addresses, and not the same address again within minutes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const CONFIG_FILE = path.join(ROOT, 'site.config.json');
const STATE_FILE = path.join(ROOT, '.indexnow-state.json');
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const site = new URL(config.siteUrl);
const base = (config.basePath || '').replace(/\/$/, '');

if (args.has('--init')) {
  if (config.indexNowKey) {
    console.log(`A key already exists (${config.indexNowKey}). Nothing changed.`);
    process.exit(0);
  }
  const key = crypto.randomBytes(16).toString('hex');
  const text = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/"indexNowKey": ""/, `"indexNowKey": "${key}"`);
  fs.writeFileSync(CONFIG_FILE, text);
  fs.writeFileSync(path.join(ROOT, `${key}.txt`), key);
  console.log(`Key created: ${key}\nFile written: ${key}.txt (it must be published at ${site.origin}${base}/${key}.txt)\nCommit and push both files, then run this script again.`);
  process.exit(0);
}

const key = config.indexNowKey;
if (!/^[A-Za-z0-9-]{8,128}$/.test(key || '')) {
  console.error('No valid key yet. Run: node scripts/indexnow.mjs --init');
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, `${key}.txt`)) || fs.readFileSync(path.join(ROOT, `${key}.txt`), 'utf8').trim() !== key) {
  console.error(`The key file ${key}.txt is missing or does not contain the key.`);
  process.exit(1);
}

const abs = (p) => `${site.origin}${base}${p}`;
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { urls: {} };

// Every address that should be known: the pages in the sitemap, plus the old addresses that now redirect.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.build-manifest.json'), 'utf8')).files.filter((f) => f.endsWith('.html'));
const fileToUrl = (f) => (f === 'index.html' ? '/' : `/${f.replace(/index\.html$/, '')}`);
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const inSitemap = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
const now = {};
for (const f of manifest) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const url = abs(fileToUrl(f));
  const stub = /http-equiv="refresh"/.test(html);
  if (!inSitemap.has(url) && !stub) continue; // noindex pages (search, 404, empty topics) are not sent
  now[url] = crypto.createHash('sha1').update(html).digest('hex').slice(0, 16);
}

const all = args.has('--all');
const changed = Object.keys(now).filter((u) => all || state.urls[u] !== now[u]);
const removed = Object.keys(state.urls).filter((u) => !(u in now));
const list = [...new Set([...changed, ...removed])];

console.log(`${changed.length} new or changed, ${removed.length} removed, ${Object.keys(now).length - changed.length} unchanged (not sent).`);
list.slice(0, 15).forEach((u) => console.log('  ' + u));
if (list.length > 15) console.log(`  ... and ${list.length - 15} more`);
if (!list.length || args.has('--dry-run')) {
  if (args.has('--dry-run')) console.log('Dry run: nothing was sent.');
  process.exit(0);
}

let failed = false;
for (let i = 0; i < list.length; i += 10000) {
  const body = { host: site.host, key, keyLocation: `${site.origin}${base}/${key}.txt`, urlList: list.slice(i, i + 10000) };
  const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  console.log(`IndexNow answered ${res.status}${res.headers.get('retry-after') ? ` (retry after ${res.headers.get('retry-after')}s)` : ''}`);
  if (res.status !== 200 && res.status !== 202) { failed = true; console.error('Not accepted. 403 = key file not found yet (publish it first), 422 = address does not match the host, 429 = too many requests, wait and retry.'); }
}
if (!failed) {
  state.urls = now;
  state.sent = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n');
  console.log('Done. Saved to .indexnow-state.json.');
}
process.exit(failed ? 1 : 0);
