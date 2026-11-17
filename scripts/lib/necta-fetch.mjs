// Polite fetch layer for the NECTA results importer. No dependencies.
//  - https only, exact host allow-list, no credentials, no custom port
//  - redirects are followed by hand and only inside the same host (a redirect could leave the allow-list)
//  - response cap and timeout, no cookies (Node's fetch keeps none)
//  - one rate limiter per host, shared by all workers: request STARTS are spaced `spacingMs` apart
//  - 429, 5xx, timeouts and network errors back off (15 s, 30 s, 60 s, 120 s, Retry-After honoured) and slow every
//    worker of that host down; other 4xx answers are final
//  - a gzip-compressed raw cache on disk (atomic writes): a cached URL is never requested again
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const USER_AGENT = 'MayobeResultsImporter/1.0 (independent results index; polite)';
export const HOSTS = {
  'onlinesys.necta.go.tz': { workers: 2, spacingMs: 500 },
  'matokeo.necta.go.tz': { workers: 2, spacingMs: 500 },
  'maktaba.tetea.org': { workers: 1, spacingMs: 1000 },
};
export const MAX_BYTES = 8 * 1024 * 1024;
export const TIMEOUT_MS = 60000;
export const MAX_RETRIES = 4;
export const BACKOFF_MS = 15000;
const MAX_REDIRECTS = 3;
const MAX_WAIT_MS = 10 * 60 * 1000;

export class FetchError extends Error {
  constructor(message, { status = 0, retryable = false, url = '' } = {}) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.retryable = retryable;
    this.url = url;
  }
}
export class StopError extends Error {
  constructor() { super('stopped'); this.name = 'StopError'; }
}

/** The URL if it may be requested, otherwise a FetchError. */
export function checkUrl(url, hosts = HOSTS) {
  let u;
  try { u = new URL(url); } catch { throw new FetchError(`blocked URL: ${url}`, { url }); }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !Object.prototype.hasOwnProperty.call(hosts, u.hostname)) {
    throw new FetchError(`blocked URL: ${url}`, { url });
  }
  return u;
}

/** Retry-After as milliseconds (seconds or an HTTP date), or 0. */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, MAX_WAIT_MS);
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.min(Math.max(0, t - now), MAX_WAIT_MS) : 0;
}

/** Spaces request starts `spacingMs` apart across all callers. */
export class RateLimiter {
  constructor(spacingMs, { now = Date.now, sleep } = {}) {
    this.spacingMs = spacingMs;
    this.now = now;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.next = 0;
  }
  async acquire() {
    const t = Math.max(this.now(), this.next);
    this.next = t + this.spacingMs;
    const wait = t - this.now();
    if (wait > 0) await this.sleep(wait);
  }
  /** Nobody starts a request before `t`. */
  pauseUntil(t) { this.next = Math.max(this.next, t); }
}

/** Where a URL is kept: `<dir>/<relative path>.gz`, never outside `dir`. */
export function cachePathFor(dir, relative) {
  const clean = String(relative).replace(/\\/g, '/').replace(/^\/+/, '').replace(/[?#].*$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.')) throw new Error(`bad cache path: ${relative}`);
  return path.join(dir, ...parts) + '.gz';
}

let tmpCounter = 0;
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
export const writeFileAtomic = writeAtomic;

async function readCapped(res, maxBytes, url) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new FetchError(`response too large: ${url}`, { url });
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new FetchError(`response too large: ${url}`, { url }); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new FetchError(`response too large: ${url}`, { url });
  return buf;
}

export function createFetcher({
  userAgent = USER_AGENT, hosts = HOSTS, fetchImpl = globalThis.fetch, now = Date.now, sleep,
  maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS, maxRetries = MAX_RETRIES, backoffMs = BACKOFF_MS, spacing, onRetry, offline = false, fallback = null,
} = {}) {
  let stopped = false;
  const timers = new Set();
  const realSleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(() => { timers.delete(t); resolve(); }, ms);
    timers.add(t);
    t.resolveNow = resolve;
  });
  const doSleep = sleep || realSleep;
  const limiters = new Map();
  const limiterFor = (host) => {
    if (!limiters.has(host)) limiters.set(host, new RateLimiter(spacing ?? hosts[host].spacingMs, { now, sleep: doSleep }));
    return limiters.get(host);
  };
  const stats = { requests: 0, cached: 0, retries: 0, bytes: 0, byHost: {} };

  function stop() {
    stopped = true;
    for (const t of timers) { clearTimeout(t); t.resolveNow(); }
    timers.clear();
  }

  function readCache(cacheFile) {
    try {
      const raw = fs.readFileSync(cacheFile);
      if (!raw.length) return null;
      const buf = zlib.gunzipSync(raw);
      return buf.length ? buf : null;
    } catch { return null; }
  }

  /** One request with manual same-host redirects. Throws FetchError (retryable or not). */
  async function once(url) {
    let current = checkUrl(url, hosts);
    const origin = current.hostname;
    const limiter = limiterFor(origin);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (stopped) throw new StopError();
      await limiter.acquire();
      if (stopped) throw new StopError();
      const h = (stats.byHost[origin] ||= { requests: 0, first: 0, last: 0 });
      h.requests++; h.last = now(); h.first ||= h.last;
      stats.requests++;
      let res;
      try {
        res = await fetchImpl(current, {
          redirect: 'manual',
          headers: { 'User-Agent': userAgent, Accept: 'text/html' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new FetchError(`network error: ${e && e.name === 'TimeoutError' ? 'timeout' : (e && e.message) || 'failed'}`, { retryable: true, url: String(current) });
      }
      const status = res.status;
      if (status >= 300 && status < 400 && status !== 304) {
        const loc = res.headers.get('location');
        try { await res.arrayBuffer(); } catch { /* ignore */ }
        if (!loc) throw new FetchError(`redirect without Location (HTTP ${status})`, { status, url: String(current) });
        let next;
        try { next = new URL(loc, current); } catch { throw new FetchError('bad redirect', { status, url: String(current) }); }
        if (next.protocol !== 'https:' || next.hostname !== origin || next.port || next.username || next.password) {
          throw new FetchError(`redirect off-host refused (HTTP ${status})`, { status, url: String(current) });
        }
        current = next;
        continue;
      }
      if (status === 429 || status >= 500) {
        try { await res.arrayBuffer(); } catch { /* ignore */ }
        const err = new FetchError(`HTTP ${status}`, { status, retryable: true, url: String(current) });
        err.retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now());
        throw err;
      }
      if (status < 200 || status >= 300) {
        try { await res.arrayBuffer(); } catch { /* ignore */ }
        throw new FetchError(`HTTP ${status}`, { status, url: String(current) });
      }
      let buf;
      try { buf = await readCapped(res, maxBytes, String(current)); } catch (e) {
        if (e instanceof FetchError) throw e;
        throw new FetchError(`network error: ${(e && e.message) || 'read failed'}`, { retryable: true, url: String(current) });
      }
      if (!buf.length) throw new FetchError('empty response', { status, retryable: true, url: String(current) });
      // a 200 that is really a CDN error page or only blank lines (seen for CSEE 2020 S2744 and CSEE 2005 S0861) must not be kept in the
      // cache, or the importer would never ask for that page again: treat it as a failed try and let the retry logic ask again
      if (junkBody(buf)) throw new FetchError('error page or blank answer from the server', { status, retryable: true, url: String(current) });
      stats.bytes += buf.length;
      return buf;
    }
    throw new FetchError('too many redirects', { url });
  }

  /** The body of `url`, from the cache when it is there. `cacheFile` is where it is (or will be) kept. */
  async function get(url, cacheFile) {
    checkUrl(url, hosts);
    if (cacheFile) {
      const hit = readCache(cacheFile);
      if (hit) { stats.cached++; return { buf: hit, cached: true }; }
    }
    if (fallback) {
      const old = fallback(url);
      if (old && old.length) { stats.cached++; return { buf: old, cached: true }; }
    }
    if (offline) throw new FetchError(`not cached (offline): ${url}`, { url });
    if (stopped) throw new StopError();
    let last;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const buf = await once(url);
        if (cacheFile) writeAtomic(cacheFile, zlib.gzipSync(buf));
        return { buf, cached: false };
      } catch (e) {
        if (!(e instanceof FetchError) || !e.retryable) throw e;
        last = e;
        if (attempt === maxRetries) break;
        const delay = Math.max(backoffMs * 2 ** attempt, e.retryAfterMs || 0);
        stats.retries++;
        if (onRetry) onRetry({ url, attempt: attempt + 1, delayMs: delay, reason: e.message });
        limiterFor(new URL(url).hostname).pauseUntil(now() + delay); // every worker of this host waits
      }
    }
    throw last;
  }

  return { get, stop, stats, limiterFor, get stopped() { return stopped; } };
}

/** True for an answer that is blank, or the CDN's own "Gateway time-out / Website is offline" page, not a results page. */
export function junkBody(buf) {
  const head = Buffer.from(buf.subarray(0, 4096)).toString('latin1');
  if (!head.trim()) return true;
  return /<title>\s*Website is offline/i.test(head) || /CDN77 server haven't received a timely response/i.test(head);
}
