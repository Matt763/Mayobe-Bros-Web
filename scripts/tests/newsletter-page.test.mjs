// js/newsletter.js (the /newsletter/ page) runs here inside a tiny stub browser: it must never call the API on load, must take the
// link code out of the address before any request, and must call the API only when a person presses the button.
//   node --no-warnings --test scripts/tests/newsletter-page.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'js', 'newsletter.js'), 'utf8');
const TOKEN = 'A'.repeat(32);

function el() {
  const n = { hidden: false, disabled: false, textContent: '', className: '', focused: 0, handlers: {}, attrs: {} };
  n.focus = () => { n.focused++; };
  n.addEventListener = (t, f) => { n.handlers[t] = f; };
  n.getAttribute = (k) => n.attrs[k] ?? null;
  return n;
}

function setup({ hash = `#c=${TOKEN}`, search = '', fetchImpl = async () => ({ status: 200, body: { ok: true } }) } = {}) {
  const log = [];
  const nodes = { title: el(), text: el(), go: el(), status: el(), help: el(), home: el() };
  nodes.go.hidden = true;
  nodes.home.hidden = true;
  const sel = { '[data-nl-title]': nodes.title, '[data-nl-text]': nodes.text, '[data-nl-go]': nodes.go, '[data-nl-status]': nodes.status, '[data-nl-help]': nodes.help, '[data-nl-home]': nodes.home };
  const box = { querySelector: (s) => sel[s] || null };
  const location = { hash, pathname: '/newsletter/', search, reload: () => log.push(['reload']) };
  const ctx = {
    document: { querySelector: (s) => (s === '[data-newsletter-page]' ? box : null), documentElement: { getAttribute: (k) => ({ 'data-api': 'https://api.test', 'data-base': '' })[k] ?? null } },
    location,
    window: { addEventListener() {} },
    history: { replaceState: (...a) => log.push(['replaceState', a[2]]) },
    fetch: async (url, init) => {
      log.push(['fetch', url, init && init.body, init]);
      const r = await fetchImpl(url, init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
    },
    JSON, Object, String, Number, RegExp, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { log, nodes };
}
const press = async (t) => { t.nodes.go.handlers.click(); await new Promise((r) => setTimeout(r, 20)); };
const fetches = (t) => t.log.filter((e) => e[0] === 'fetch');

test('nothing is fetched on load and the fragment leaves the address bar first', async () => {
  for (const hash of [`#c=${TOKEN}`, `#u=${TOKEN}`]) {
    const t = setup({ hash, search: '?email=a%40b.test&website=' });
    assert.equal(fetches(t).length, 0, 'no fetch on load');
    assert.deepEqual(t.log[0], ['replaceState', '/newsletter/'], 'fragment and any query removed');
    assert.equal(t.nodes.go.hidden, false);
    await press(t);
    assert.ok(t.log.findIndex((e) => e[0] === 'replaceState') < t.log.findIndex((e) => e[0] === 'fetch'));
  }
});

test('one press on Confirm makes one POST /v1/newsletter/confirm with the token', async () => {
  const t = setup();
  assert.equal(t.nodes.title.textContent, 'Confirm your subscription');
  assert.equal(t.nodes.go.textContent, 'Confirm my subscription');
  await press(t);
  assert.equal(fetches(t).length, 1);
  const [, url, body, init] = fetches(t)[0];
  assert.equal(url, 'https://api.test/v1/newsletter/confirm');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(body), { token: TOKEN });
  assert.equal(t.nodes.go.hidden, true, 'no button after success');
  assert.ok(t.nodes.title.focused > 0, 'focus on the new heading');
  assert.match(t.nodes.status.textContent, /confirmed/i);
  // a stray second click sends nothing
  t.nodes.go.handlers.click(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(fetches(t).length, 1);
});

test('one press on Unsubscribe makes one POST /v1/newsletter/unsubscribe', async () => {
  const t = setup({ hash: `#u=${TOKEN}` });
  assert.equal(t.nodes.title.textContent, 'Stop newsletter emails');
  assert.equal(t.nodes.go.textContent, 'Unsubscribe');
  await press(t);
  assert.equal(fetches(t).length, 1);
  assert.equal(fetches(t)[0][1], 'https://api.test/v1/newsletter/unsubscribe');
  assert.deepEqual(JSON.parse(fetches(t)[0][2]), { token: TOKEN });
  assert.equal(t.nodes.go.hidden, true);
  assert.match(t.nodes.status.textContent, /unsubscribed/i);
  assert.ok(t.nodes.title.focused > 0);
});

test('404 shows the expired-or-used message with focus on the heading and no button', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 404, body: { error: 'x' } }) });
  await press(t);
  assert.match(t.nodes.title.textContent, /expired or was already used/);
  assert.match(t.nodes.status.textContent, /expired or was already used/);
  assert.equal(t.nodes.go.hidden, true);
  assert.ok(t.nodes.title.focused > 0);
  const u = setup({ hash: `#u=${TOKEN}`, fetchImpl: async () => ({ status: 404, body: { error: 'x' } }) });
  await press(u);
  assert.match(u.nodes.title.textContent, /could not find/i);
  assert.equal(u.nodes.go.hidden, true);
});

test('a network error keeps a Try again button', async () => {
  for (const fetchImpl of [async () => { throw new Error('offline'); }, async () => ({ status: 503, body: undefined }), async () => ({ status: 429, body: {} })]) {
    const t = setup({ fetchImpl });
    await press(t);
    assert.equal(t.nodes.go.hidden, false);
    assert.equal(t.nodes.go.disabled, false);
    assert.equal(t.nodes.go.textContent, 'Try again');
    assert.match(t.nodes.status.className, /is-err/);
    assert.ok(t.nodes.go.focused > 0, 'focus returns to the retry button');
    // the retry sends the same token once more
    await press(t);
    assert.equal(fetches(t).length, 2);
    assert.deepEqual(JSON.parse(fetches(t)[1][2]), { token: TOKEN });
  }
});

test('no or a malformed fragment wires no button', () => {
  for (const hash of ['', '#c=short', '#x=' + TOKEN, `#c=${TOKEN}!`, `#u=${'A'.repeat(65)}`, `#c=${TOKEN}&u=${TOKEN}`]) {
    const t = setup({ hash });
    assert.equal(t.nodes.go.hidden, true, hash);
    assert.equal(t.nodes.go.handlers.click, undefined, hash);
    assert.equal(fetches(t).length, 0);
    assert.ok(t.nodes.title.textContent.length > 0);
  }
  assert.match(setup({ hash: '#c=short' }).nodes.title.textContent, /does not look right/);
});

test('the script has exactly one fetch call, reached only from the button', () => {
  assert.equal([...SRC.matchAll(/\bfetch\(/g)].length, 1);
  assert.match(SRC, /addEventListener\('click',\s*go\)/);
  assert.equal([...SRC.matchAll(/(?<!function )\bgo\(\)/g)].length, 0, 'go() is never called directly');
  assert.match(SRC, /history\.replaceState/);
});
