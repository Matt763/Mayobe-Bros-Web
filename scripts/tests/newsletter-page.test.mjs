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
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  return n;
}

// timers: pass { setTimeout, clearTimeout } to control the 15 s request timeout; AbortController is the real one unless given
function setup({ hash = `#c=${TOKEN}`, search = '', fetchImpl = async () => ({ status: 200, body: { ok: true } }), timers = {} } = {}) {
  const log = [];
  const nodes = { title: el(), text: el(), go: el(), status: el(), help: el(), next: el() };
  nodes.go.hidden = true;
  nodes.next.hidden = true;
  const sel = { '[data-nl-title]': nodes.title, '[data-nl-text]': nodes.text, '[data-nl-go]': nodes.go, '[data-nl-status]': nodes.status, '[data-nl-help]': nodes.help, '[data-next]': nodes.next };
  const box = el();
  box.querySelector = (s) => sel[s] || null;
  nodes.box = box;
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
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout, AbortController: timers.AbortController || AbortController,
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
  assert.equal(t.nodes.title.textContent, 'One last step: confirm your subscription');
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
  assert.equal(t.nodes.title.textContent, 'You are subscribed');
  assert.match(t.nodes.text.textContent, /A welcome email with our latest articles is on its way\./);
  assert.match(t.nodes.status.textContent, /subscribed/i);
  assert.equal(t.nodes.box.attrs['data-state'], 'ok', 'the card shows the check mark');
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
  assert.equal(t.nodes.title.textContent, 'This link was already used or has expired');
  assert.match(t.nodes.status.textContent, /already used or has expired/);
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

test('the confirm screen says it is the last step and that the press stops email scanners', () => {
  const t = setup();
  assert.equal(t.nodes.title.textContent, 'One last step: confirm your subscription');
  assert.equal(t.nodes.text.textContent, 'You opened the link from our email. Press the button to finish. We ask for this press so that email scanners cannot sign anyone up.');
  assert.equal(t.nodes.go.textContent, 'Confirm my subscription');
  assert.equal(t.nodes.go.hidden, false);
});

test('next reads are hidden on load and shown after success, after 404 and on the no-fragment screen', async () => {
  const ok = setup();
  assert.equal(ok.nodes.next.hidden, true, 'hidden while the button waits');
  await press(ok);
  assert.equal(ok.nodes.next.hidden, false, 'after confirm');
  const un = setup({ hash: `#u=${TOKEN}` });
  assert.equal(un.nodes.next.hidden, true);
  await press(un);
  assert.equal(un.nodes.next.hidden, false, 'after unsubscribe');
  const gone = setup({ fetchImpl: async () => ({ status: 404, body: {} }) });
  await press(gone);
  assert.equal(gone.nodes.next.hidden, false, 'after 404');
  const err = setup({ fetchImpl: async () => { throw new Error('offline'); } });
  await press(err);
  assert.equal(err.nodes.next.hidden, true, 'not on a network error: the retry button stays the focus');
  for (const hash of ['', '#c=short']) assert.equal(setup({ hash }).nodes.next.hidden, false, `on "${hash}"`);
});

test('the 404 text tells someone who already confirmed that they are subscribed', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 404, body: {} }) });
  await press(t);
  assert.equal(t.nodes.text.textContent, 'If you already pressed Confirm, you are subscribed and there is nothing more to do. If not, the link may be older than 7 days: sign up again with the form at the bottom of this page.');
});

test('a request with no answer for 15 s shows the network text and Try again; one press makes exactly one more POST', async () => {
  const pending = [];
  const timers = { setTimeout: (f, ms) => { pending.push({ f, ms }); return pending.length; }, clearTimeout: (id) => { if (pending[id - 1]) pending[id - 1].f = null; } };
  // a fetch that never answers on its own; it rejects only when its signal is aborted
  const fetchImpl = (_url, init) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const t = setup({ fetchImpl, timers });
  t.nodes.go.handlers.click();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].ms, 15000);
  pending[0].f();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.nodes.status.textContent, 'We could not reach our server. Check your connection, then press Try again.');
  assert.equal(t.nodes.go.textContent, 'Try again');
  assert.equal(t.nodes.go.hidden, false);
  assert.equal(t.nodes.go.disabled, false);
  assert.equal(t.nodes.go.attrs['aria-busy'], undefined);
  assert.equal(fetches(t).length, 1);
  t.nodes.go.handlers.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fetches(t).length, 2, 'one press, one more POST');
});

test('while waiting the button is disabled and aria-busy', async () => {
  let answer;
  const t = setup({ fetchImpl: () => new Promise((res) => { answer = res; }) });
  t.nodes.go.handlers.click();
  assert.equal(t.nodes.go.disabled, true);
  assert.equal(t.nodes.go.attrs['aria-busy'], 'true');
  assert.equal(t.nodes.go.textContent, 'Confirming...');
  assert.equal(t.nodes.status.textContent, 'Confirming...');
  // a second press while waiting sends nothing
  t.nodes.go.handlers.click();
  assert.equal(fetches(t).length, 1);
  answer({ status: 200, body: { ok: true } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.nodes.go.attrs['aria-busy'], undefined);
  const u = setup({ hash: `#u=${TOKEN}`, fetchImpl: () => new Promise(() => {}) });
  u.nodes.go.handlers.click();
  assert.equal(u.nodes.go.textContent, 'Unsubscribing...');
});

test('the script has exactly one fetch call, reached only from the button', () => {
  assert.equal([...SRC.matchAll(/\bfetch\(/g)].length, 1);
  assert.match(SRC, /addEventListener\('click',\s*go\)/);
  assert.equal([...SRC.matchAll(/(?<!function )\bgo\(\)/g)].length, 0, 'go() is never called directly');
  assert.match(SRC, /history\.replaceState/);
});
