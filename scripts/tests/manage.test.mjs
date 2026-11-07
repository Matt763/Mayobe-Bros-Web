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
  return n;
}

// fetchImpl(url, init) returns { status, body } or throws; storage: { fail: true } makes localStorage throw
function setup({ hash = `#l=${TOKEN}`, fetchImpl, storage = {}, preset } = {}) {
  const log = [];
  const nodes = { title: el(), text: el(), go: el(), status: el(), help: el(), home: el() };
  nodes.home.hidden = true;
  const box = { querySelector: (s) => ({ '[data-manage-title]': nodes.title, '[data-manage-text]': nodes.text, '[data-manage-go]': nodes.go, '[data-manage-status]': nodes.status, '[data-manage-help]': nodes.help, '[data-manage-home]': nodes.home })[s] || null };
  const store = new Map(preset ? [['mb_own', JSON.stringify(preset)]] : []);
  const localStorage = { getItem: (k) => { if (storage.fail) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; }, setItem: (k, v) => { if (storage.fail) throw new Error('blocked'); store.set(k, v); } };
  const location = { hash, pathname: '/manage/', search: '', assign: (u) => log.push(['assign', u]), reload() {} };
  const window = { addEventListener() {} };
  const ctx = {
    document: { querySelector: (s) => (s === '[data-manage]' ? box : null), documentElement: { getAttribute: (k) => ({ 'data-api': 'https://api.test', 'data-base': '' })[k] ?? null } },
    location, window, localStorage,
    history: { replaceState: (...a) => log.push(['replaceState', a[2]]) },
    fetch: async (url, init) => {
      log.push(['fetch', url, init && init.body]);
      const r = await fetchImpl(url, init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
    },
    JSON, Object, Array, String, Number, Date, RegExp, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { log, nodes, store, location };
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
    assert.match(t.nodes.status.textContent, /This browser can now edit your comment/);
    assert.equal(t.nodes.home.hidden, false, 'a link to all articles is shown');
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
  assert.match(t.nodes.title.textContent, /cannot save the code/);
  assert.match(t.nodes.status.textContent, /cannot save the code/);
  assert.equal(t.nodes.go.hidden, true);
  assert.ok(t.nodes.title.focused > 0);
  assert.equal(t.log.filter((e) => e[0] === 'assign').length, 0);
});

test('expired links, stopped emails and network errors are announced; only a network error keeps a button', async () => {
  let t = setup({ fetchImpl: async () => ({ status: 404, body: { error: 'That comment could not be found.' } }) });
  await press(t);
  assert.match(t.nodes.status.textContent, /expired or was removed/);
  assert.equal(t.nodes.go.hidden, true);
  assert.ok(t.nodes.title.focused > 0);
  t = setup({ hash: `#u=${TOKEN}`, fetchImpl: async () => ({ status: 200, body: { ok: true } }) });
  await press(t);
  assert.deepEqual(JSON.parse(t.log.find((e) => e[0] === 'fetch')[2]), { token: TOKEN });
  assert.match(t.nodes.status.textContent, /Reply emails stopped/);
  assert.equal(t.nodes.go.hidden, true);
  t = setup({ fetchImpl: async () => { throw new Error('offline'); } });
  await press(t);
  assert.match(t.nodes.status.textContent, /could not reach/);
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
