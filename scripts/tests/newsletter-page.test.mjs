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
  assert.equal(t.nodes.title.textContent, 'Confirm your subscription');
  assert.equal(t.nodes.go.textContent, 'Confirm subscription');
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
  assert.equal(t.nodes.text.textContent, 'A welcome email may arrive in a few minutes.', 'a hedge: the welcome email can be delayed or skipped');
  assert.match(t.nodes.status.textContent, /^You are subscribed\.$/);
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

test('404 shows the one link message, the same for Confirm and Unsubscribe, with focus on the heading and no button', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 404, body: { error: 'x' } }) });
  await press(t);
  assert.equal(t.nodes.title.textContent, 'Link is invalid or expired');
  assert.equal(t.nodes.status.textContent, 'Link is invalid or expired.');
  assert.equal(t.nodes.go.hidden, true);
  assert.ok(t.nodes.title.focused > 0);
  const u = setup({ hash: `#u=${TOKEN}`, fetchImpl: async () => ({ status: 404, body: { error: 'x' } }) });
  await press(u);
  assert.equal(u.nodes.title.textContent, 'Link is invalid or expired', 'one wording whatever the cause, so nothing says whether an address is on the list');
  assert.equal(u.nodes.status.textContent, 'Link is invalid or expired.');
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
  assert.equal(setup({ hash: '#c=short' }).nodes.title.textContent, 'Link is invalid or expired');
});

test('the confirm screen asks for one press (nothing is sent before it, so link scanners cannot sign anyone up) in a short title and one sentence', () => {
  const t = setup();
  assert.equal(t.nodes.title.textContent, 'Confirm your subscription');
  assert.equal(t.nodes.text.textContent, 'Press the button to finish signing up.');
  assert.equal(t.nodes.go.textContent, 'Confirm subscription');
  assert.equal(t.nodes.go.hidden, false);
  assert.equal(fetches(t).length, 0);
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

test('the 404 sentence is general advice that is the same for every cause (it never says whether the address is on the list)', async () => {
  const bodies = new Set();
  for (const body of [{}, { error: 'Link is invalid or expired.' }, { error: 'something else' }]) {
    const t = setup({ fetchImpl: async () => ({ status: 404, body }) });
    await press(t);
    bodies.add(t.nodes.title.textContent + '|' + t.nodes.text.textContent);
  }
  assert.equal(bodies.size, 1);
  assert.equal([...bodies][0], 'Link is invalid or expired|');
  const u = setup({ hash: `#u=${TOKEN}`, fetchImpl: async () => ({ status: 404, body: {} }) });
  await press(u);
  assert.equal(u.nodes.text.textContent, '');
});

test('every title is five words or fewer and a 429 or a network failure names the action', async () => {
  const titles = new Set();
  for (const hash of ['', '#c=short', `#c=${TOKEN}`, `#u=${TOKEN}`]) titles.add(setup({ hash }).nodes.title.textContent);
  const busy = setup({ fetchImpl: async () => ({ status: 429, body: {} }) });
  await press(busy);
  assert.equal(busy.nodes.title.textContent, 'Too many attempts');
  assert.equal(busy.nodes.status.textContent, 'Too many attempts. Try again later.');
  const down = setup({ hash: `#u=${TOKEN}`, fetchImpl: async () => { throw new Error('offline'); } });
  await press(down);
  assert.equal(down.nodes.title.textContent, 'Could not unsubscribe');
  assert.equal(down.nodes.status.textContent, 'Something went wrong.');
  assert.equal(down.nodes.text.textContent, 'Connection failed.');
  for (const n of [busy, down]) titles.add(n.nodes.title.textContent);
  for (const h of titles) assert.ok(h.split(' ').length <= 5, h);
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
  assert.equal(t.nodes.status.textContent, 'Something went wrong.');
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

test('the status line keeps its st-status class when the script rewrites it (the stylesheet hides it in the ok, info and busy states)', () => {
  assert.match(fs.readFileSync(new URL('../../js/newsletter.js', import.meta.url), 'utf8'), /status\.className = 'form-status st-status'/);
});
