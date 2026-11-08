// js/manage.js runs here inside a tiny stub browser (no real DOM): it must never call the API on load, must remove the secret from the
// address before any request, and must never leave a live action button once the exchange has succeeded.
//   node --no-warnings --test scripts/tests/manage.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'js', 'manage.js'), 'utf8');
const TOKEN = 'A'.repeat(40);
const DEVICE = 'D'.repeat(40);

function el() {
  const n = { hidden: false, disabled: false, textContent: '', className: '', focused: 0, handlers: {}, attrs: {} };
  n.focus = () => { n.focused++; };
  n.addEventListener = (t, f) => { n.handlers[t] = f; };
  n.getAttribute = (k) => n.attrs[k] ?? null;
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  return n;
}

// fetchImpl(url, init) returns { status, body } or throws; storage: { fail: true } makes localStorage throw
// timers: pass { setTimeout, clearTimeout } to control the 15 s request timeout
function setup({ hash = `#l=${TOKEN}`, fetchImpl, storage = {}, preset, timers = {}, visibility } = {}) {
  const log = [];
  const nodes = { title: el(), text: el(), go: el(), status: el(), help: el(), next: el() };
  nodes.next.hidden = true;
  const box = el();
  box.querySelector = (s) => ({ '[data-manage-title]': nodes.title, '[data-manage-text]': nodes.text, '[data-manage-go]': nodes.go, '[data-manage-status]': nodes.status, '[data-manage-help]': nodes.help, '[data-next]': nodes.next })[s] || null;
  nodes.box = box;
  const store = new Map(preset ? [['mb_own', JSON.stringify(preset)]] : []);
  const localStorage = { getItem: (k) => { if (storage.fail) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; }, setItem: (k, v) => { if (storage.fail) throw new Error('blocked'); store.set(k, v); } };
  const location = { hash, pathname: '/manage/', search: '', assign: (u) => log.push(['assign', u]), reload() {} };
  const window = { addEventListener() {} };
  const ctx = {
    document: { visibilityState: visibility, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener(t) { delete this.listeners[t]; }, querySelector: (s) => (s === '[data-manage]' ? box : null), documentElement: { getAttribute: (k) => ({ 'data-api': 'https://api.test', 'data-base': '' })[k] ?? null } },
    location, window, localStorage,
    history: { replaceState: (...a) => log.push(['replaceState', a[2]]) },
    fetch: async (url, init) => {
      log.push(['fetch', url, init && init.body]);
      const r = await fetchImpl(url, init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
    },
    JSON, Object, Array, String, Number, Date, RegExp, Error,
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout, AbortController,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { log, nodes, store, location, doc: ctx.document };
}
const press = async (t) => { t.nodes.go.handlers.click(); await new Promise((r) => setTimeout(r, 20)); };
const exchangeOk = (extra = {}) => async (url) => (url.endsWith('/manage/exchange') ? { status: 200, body: { ok: true, id: 7, slug: 'hello-post', token: DEVICE, ...extra } } : { status: 404, body: [] });

test('nothing is fetched on load, and the secret leaves the address before any request', async () => {
  const t = setup({ fetchImpl: exchangeOk({ path: '/post/a/hello-post/' }) });
  assert.equal(t.log.filter((e) => e[0] === 'fetch').length, 0, 'no fetch on load');
  assert.deepEqual(t.log[0], ['replaceState', '/manage/']);
  assert.equal(t.nodes.go.hidden, false);
  await press(t);
  assert.ok(t.log.findIndex((e) => e[0] === 'replaceState') < t.log.findIndex((e) => e[0] === 'fetch'));
});

test('one press makes exactly one exchange call with the right body, stores the code and goes to the server path', async () => {
  const t = setup({ fetchImpl: exchangeOk({ path: '/post/a/hello-post/' }) });
  await press(t);
  const fetches = t.log.filter((e) => e[0] === 'fetch');
  assert.equal(fetches.length, 1, 'path from the server means no article-list lookup');
  assert.equal(fetches[0][1], 'https://api.test/v1/manage/exchange');
  assert.deepEqual(JSON.parse(fetches[0][2]), { link: TOKEN });
  assert.deepEqual(JSON.parse(t.store.get('mb_own')), { 7: DEVICE });
  assert.deepEqual(t.log.at(-1), ['assign', '/post/a/hello-post/#comment-7']);
  assert.equal(t.nodes.go.hidden, true);
});

test('a path with // or odd characters from the server is ignored and the article list is used', async () => {
  for (const bad of ['//evil.test/x/', '/post//x/', 'https://evil.test/post/x/', '/post/a/../b/', '/other/x/']) {
    const t = setup({ fetchImpl: async (url) => (url.endsWith('/manage/exchange') ? { status: 200, body: { ok: true, id: 7, slug: 'hello-post', token: DEVICE, path: bad } } : { status: 200, body: [{ s: 'hello-post', u: '/post/c/hello-post/' }] }) });
    await press(t);
    assert.deepEqual(t.log.at(-1), ['assign', '/post/c/hello-post/#comment-7'], bad);
  }
});

test('a failed lookup after success leaves no live button, announces it, and sends nothing again', async () => {
  for (const lookup of [async () => { throw new Error('offline'); }, async () => ({ status: 200, body: [] }), async () => ({ status: 500, body: undefined })]) {
    const t = setup({ fetchImpl: async (url, init) => (url.endsWith('/manage/exchange') ? { status: 200, body: { ok: true, id: 7, slug: 'hello-post', token: DEVICE } } : lookup(url, init)) });
    await press(t);
    assert.equal(t.nodes.go.hidden, true, 'button gone');
    assert.match(t.nodes.status.textContent, /^Your comment is ready\./);
    assert.equal(t.nodes.next.hidden, false, 'the latest articles and a link to all articles are shown');
    assert.ok(t.nodes.title.focused > 0, 'focus moved to the heading');
    assert.equal(t.log.filter((e) => e[0] === 'assign').length, 0);
    assert.ok(t.store.has('mb_own'), 'the code stays stored');
    // even a stray second click cannot send an empty link
    const before = t.log.filter((e) => e[0] === 'fetch').length;
    t.nodes.go.handlers.click(); await new Promise((r) => setTimeout(r, 10));
    assert.equal(t.log.filter((e) => e[0] === 'fetch').length, before);
  }
});

test('a storage failure shows the storage message, announced, with focus on the heading', async () => {
  const t = setup({ storage: { fail: true }, fetchImpl: exchangeOk({ path: '/post/a/hello-post/' }) });
  await press(t);
  assert.equal(t.nodes.title.textContent, 'Browser storage is blocked');
  assert.equal(t.nodes.status.textContent, "Browser storage is blocked.");
  assert.doesNotMatch(t.nodes.title.textContent + t.nodes.text.textContent + t.nodes.status.textContent, /code|token/i, 'no internals');
  assert.equal(t.nodes.go.hidden, true);
  assert.ok(t.nodes.title.focused > 0);
  assert.equal(t.log.filter((e) => e[0] === 'assign').length, 0);
});

test('expired links, stopped emails and network errors are announced; only a network error keeps a button', async () => {
  let t = setup({ fetchImpl: async () => ({ status: 404, body: { error: 'Link is invalid or expired.' } }) });
  await press(t);
  assert.equal(t.nodes.status.textContent, 'Link is invalid or expired.');
  assert.equal(t.nodes.go.hidden, true);
  assert.ok(t.nodes.title.focused > 0);
  t = setup({ hash: `#u=${TOKEN}`, fetchImpl: async () => ({ status: 200, body: { ok: true } }) });
  await press(t);
  assert.deepEqual(JSON.parse(t.log.find((e) => e[0] === 'fetch')[2]), { token: TOKEN });
  assert.match(t.nodes.status.textContent, /Reply emails stopped/);
  assert.equal(t.nodes.go.hidden, true);
  t = setup({ fetchImpl: async () => { throw new Error('offline'); } });
  await press(t);
  assert.equal(t.nodes.status.textContent, 'Something went wrong.');
  assert.equal(t.nodes.go.hidden, false);
  assert.equal(t.nodes.go.disabled, false);
  assert.ok(t.nodes.go.focused > 0, 'focus returns to the retry button');
});

test('the 60-entry cap drops the oldest other entry and keeps the one just added', async () => {
  const preset = {};
  for (let i = 100; i < 160; i++) preset[i] = 'x'.repeat(40);
  // the new comment has the LOWEST id: it must still survive
  const t = setup({ preset, fetchImpl: exchangeOk({ id: 5, path: '/post/a/hello-post/' }) });
  await press(t);
  const o = JSON.parse(t.store.get('mb_own'));
  assert.equal(Object.keys(o).length, 60);
  assert.equal(o[5], DEVICE);
  assert.equal(o[100], undefined, 'the oldest other entry went');
  assert.ok(o[101] && o[159]);
});

test('a missing or malformed fragment shows an explanation and wires no button', () => {
  for (const hash of ['', '#l=short', '#x=' + TOKEN]) {
    const t = setup({ hash, fetchImpl: exchangeOk() });
    assert.equal(t.nodes.go.hidden, true, hash);
    assert.equal(t.nodes.go.handlers.click, undefined, hash);
    assert.equal(t.log.filter((e) => e[0] === 'fetch').length, 0);
  }
});

test('a timeout shows the network text and Try again', async () => {
  const pending = [];
  const timers = { setTimeout: (f, ms) => { pending.push({ f, ms }); return pending.length; }, clearTimeout: (id) => { if (pending[id - 1]) pending[id - 1].f = null; } };
  const t = setup({ timers, fetchImpl: (_url, init) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); }) });
  t.nodes.go.handlers.click();
  assert.equal(t.nodes.go.disabled, true);
  assert.equal(t.nodes.go.attrs['aria-busy'], 'true');
  assert.equal(pending[0].ms, 15000);
  pending[0].f();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.nodes.status.textContent, 'Something went wrong.');
  assert.equal(t.nodes.go.textContent, 'Try again');
  assert.equal(t.nodes.go.hidden, false);
  assert.equal(t.nodes.go.disabled, false);
  assert.equal(t.nodes.go.attrs['aria-busy'], undefined);
  t.nodes.go.handlers.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.log.filter((e) => e[0] === 'fetch').length, 2, 'one press, one more POST');
});

test('next reads appear after reply emails are stopped', async () => {
  const t = setup({ hash: `#u=${TOKEN}`, fetchImpl: async () => ({ status: 200, body: { ok: true } }) });
  assert.equal(t.nodes.next.hidden, true, 'hidden while the button waits');
  await press(t);
  assert.match(t.nodes.title.textContent, /Reply emails stopped/);
  assert.equal(t.nodes.next.hidden, false);
  assert.equal(t.nodes.box.attrs['data-state'], 'ok');
  const gone = setup({ fetchImpl: async () => ({ status: 404, body: {} }) });
  await press(gone);
  assert.equal(gone.nodes.next.hidden, false, 'after a 404');
  assert.equal(setup({ hash: '', fetchImpl: exchangeOk() }).nodes.next.hidden, false, 'on the no-link screen');
});

// ---- the team's Approve / Ignore link (#r=). Approve waits for a press (a mail scanner that runs JavaScript must never publish a held
// comment); Ignore changes nothing, so it answers at once.
const SIG = 'S'.repeat(43);
const REVIEW = (a) => `12.${a}.abc123.${SIG}`;
const reviewOk = (result, extra = {}) => async (url) => (url.endsWith('/review') ? { status: 200, body: { ok: true, result, id: 12, path: '/post/a/hello-post/', ...extra } } : { status: 404, body: [] });
const settle = () => new Promise((r) => setTimeout(r, 30));

test('review link, Approve: nothing is sent on load; the secret leaves the address; ONE press makes one call with the whole token', async () => {
  const t = setup({ hash: `#r=${REVIEW('a')}`, fetchImpl: reviewOk('approved') });
  await settle();
  assert.deepEqual(t.log[0], ['replaceState', '/manage/']);
  assert.equal(t.log.filter((e) => e[0] === 'fetch').length, 0, 'a scanner that only opens the page approves nothing');
  assert.equal(t.nodes.title.textContent, 'Approve this comment?');
  assert.equal(t.nodes.go.textContent, 'Approve');
  assert.equal(t.nodes.go.hidden, false);
  await press(t);
  const f = t.log.filter((e) => e[0] === 'fetch');
  assert.equal(f.length, 1);
  assert.equal(f[0][1], 'https://api.test/v1/review');
  assert.deepEqual(JSON.parse(f[0][2]), { r: REVIEW('a') });
  assert.equal(t.nodes.title.textContent, 'Comment approved');
  assert.equal(t.nodes.text.textContent, 'It is now visible to readers.');
  assert.equal(t.nodes.go.textContent, 'View the comment');
  t.nodes.go.handlers.click();
  assert.deepEqual(t.log.at(-1), ['assign', '/post/a/hello-post/#comment-12']);
});

test('review link, Ignore answers at once (it changes nothing); Approve answers a second press, an expired link and a deleted comment in clear words', async () => {
  let t = setup({ hash: `#r=${REVIEW('i')}`, fetchImpl: reviewOk('kept') });
  await settle();
  assert.equal(t.nodes.title.textContent, 'Comment left hidden');
  t = setup({ hash: `#r=${REVIEW('a')}`, fetchImpl: reviewOk('already') });
  await press(t);
  assert.equal(t.nodes.title.textContent, 'Already approved');
  t = setup({ hash: `#r=${REVIEW('a')}`, fetchImpl: async () => ({ status: 404, body: { error: 'x' } }) });
  await press(t);
  assert.equal(t.nodes.title.textContent, 'Link is invalid or expired');
  assert.doesNotMatch(t.nodes.text.textContent, /node |scripts\/|comments\.mjs/, 'no command line on a public page');
  assert.equal(t.nodes.go.hidden, true);
  t = setup({ hash: `#r=${REVIEW('a')}`, fetchImpl: async () => ({ status: 409, body: { error: 'x' } }) });
  await press(t);
  assert.equal(t.nodes.title.textContent, 'Comment was deleted');
});

test('review link: a network failure offers Try again, and the second press works', async () => {
  let n = 0;
  const t = setup({ hash: `#r=${REVIEW('a')}`, fetchImpl: async (u) => { if (n++ === 0) throw new Error('offline'); return reviewOk('approved')(u); } });
  await press(t);
  assert.equal(t.nodes.go.textContent, 'Try again');
  assert.equal(t.nodes.go.hidden, false);
  await press(t);
  assert.equal(t.nodes.title.textContent, 'Comment approved');
});

test('review link, Ignore: a hidden tab waits until it is shown; a cut-short or foreign token never calls the API', async () => {
  const t = setup({ hash: `#r=${REVIEW('i')}`, fetchImpl: reviewOk('kept'), visibility: 'hidden' });
  await settle();
  assert.equal(t.log.filter((e) => e[0] === 'fetch').length, 0, 'nothing while hidden');
  t.doc.visibilityState = 'visible';
  t.doc.listeners.visibilitychange();
  await settle();
  assert.equal(t.log.filter((e) => e[0] === 'fetch').length, 1);
  for (const hash of [`#r=${REVIEW('a').slice(0, -3)}`, '#r=12.x.abc.' + SIG, '#r=../etc']) {
    const b = setup({ hash, fetchImpl: reviewOk('approved') });
    await settle();
    assert.equal(b.log.filter((e) => e[0] === 'fetch').length, 0, hash);
  }
});

test('the status line keeps its st-status class when the script rewrites it (the stylesheet hides it in the ok, info and busy states)', () => {
  assert.match(SRC, /status\.className = 'form-status st-status'/);
});

test('a network error changes the heading and the sentence too, so the page never keeps saying "Opening your comment..."', async () => {
  const t = setup({ fetchImpl: async () => { throw new Error('offline'); } });
  await press(t);
  assert.equal(t.nodes.title.textContent, 'Could not open comment');
  assert.equal(t.nodes.text.textContent, 'Connection failed.');
  assert.equal(t.nodes.go.textContent, 'Try again');
});

test('every page heading is five words or fewer, and a 429 uses the one limit wording', async () => {
  const seen = new Set();
  for (const hash of ['', '#x=' + TOKEN, `#l=${TOKEN}`, `#u=${TOKEN}`, `#r=${REVIEW('a')}`, `#r=${REVIEW('i')}`]) {
    const t = setup({ hash, fetchImpl: async () => ({ status: 429, body: { error: 'x' } }) });
    seen.add(t.nodes.title.textContent);
    await settle();
    if (t.nodes.go.handlers.click) await press(t);
    if (t.nodes.go.handlers.click) { assert.equal(t.nodes.status.textContent, 'Too many attempts. Try again later.', hash); assert.equal(t.nodes.title.textContent, 'Too many attempts'); }
    seen.add(t.nodes.title.textContent);
  }
  for (const h of seen) assert.ok(h.split(' ').length <= 5, h);
});
