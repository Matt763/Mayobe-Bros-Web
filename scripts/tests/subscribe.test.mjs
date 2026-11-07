// js/subscribe.js (the footer newsletter form) runs here inside a small stub browser.
//   node --no-warnings --test scripts/tests/subscribe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'subscribe.js'), 'utf8');
const ENDPOINT = 'https://api.test/v1/newsletter/subscribe';
const LOADED_AT = 1_800_000_000_000;

function el(extra = {}) {
  const n = { hidden: false, disabled: false, textContent: '', className: '', focused: 0, value: '', attrs: {}, children: [], handlers: {}, ...extra };
  n.focus = () => { n.focused++; };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k] ?? null;
  n.hasAttribute = (k) => k in n.attrs;
  n.addEventListener = (t, f) => { n.handlers[t] = f; };
  n.appendChild = (c) => { n.children.push(c); return c; };
  return n;
}

// The status text as a person sees it: its own text plus any link or text nodes added after it.
const shown = (s) => s.textContent + s.children.map((c) => c.textContent ?? c.text ?? '').join('');

function setup({ fetchImpl = async () => ({ status: 200, body: { ok: true } }), email = 'neema@example.com', attrs = {} } = {}) {
  const log = [];
  const input = el({ name: 'email', value: email });
  const website = el({ name: 'website', value: '' });
  const status = el();
  const button = el();
  const form = el({ attrs: { 'data-newsletter': '', 'data-endpoint': ENDPOINT, ...attrs } });
  form.elements = { email: input, website };
  form.reset = () => { log.push(['reset']); input.value = ''; website.value = ''; };
  form.querySelector = (s) => (s === '.foot-status' ? status : s.startsWith('button') ? button : null);
  let clock = LOADED_AT;
  const ctx = {
    document: {
      querySelectorAll: (s) => (s === 'form[data-newsletter]' ? [form] : []),
      documentElement: { getAttribute: (k) => ({ 'data-base': '' })[k] ?? null },
      createElement: (tag) => el({ tag }),
      createTextNode: (t) => ({ text: t }),
    },
    fetch: async (url, init) => {
      log.push(['fetch', url, JSON.parse(init.body), init]);
      const r = await fetchImpl(url, init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
    },
    Date: { now: () => clock },
    setTimeout: (f) => f(), // the live region's short pause runs at once here
    JSON, Object, String, Number, RegExp, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  clock = LOADED_AT + 9000; // the visitor types for a while before pressing Subscribe
  const submit = async () => { form.handlers.submit({ preventDefault: () => log.push(['prevent']) }); await new Promise((r) => setTimeout(r, 20)); };
  return { log, input, website, status, button, form, submit };
}
const fetches = (t) => t.log.filter((l) => l[0] === 'fetch');

test('nothing is fetched on load', () => {
  const t = setup();
  assert.equal(fetches(t).length, 0);
  assert.equal(typeof t.form.handlers.submit, 'function');
});

test('a valid submit posts JSON {email, website:"", ts} once, disables the button while sending, shows the success text and clears the field', async () => {
  let release;
  const t = setup({ fetchImpl: () => new Promise((r) => { release = () => r({ status: 200, body: { ok: true } }); }) });
  t.form.handlers.submit({ preventDefault() {} });
  assert.equal(t.button.disabled, true, 'disabled while sending');
  t.form.handlers.submit({ preventDefault() {} }); // a second press does nothing
  assert.equal(fetches(t).length, 1);
  const [, url, body, init] = fetches(t)[0];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(Object.keys(body).sort(), ['email', 'ts', 'website']);
  assert.equal(body.email, 'neema@example.com');
  assert.equal(body.website, '');
  // ruling R1: the server treats a missing or zero ts as a bot, so the page-load time must always be sent
  assert.equal(body.ts, LOADED_AT, 'ts is the time the page loaded, in ms');
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(shown(t.status), 'Almost done. If this address can get our emails, we have sent it a link to confirm. Please check your inbox and spam folder.');
  assert.match(t.status.className, /is-ok/);
  assert.equal(t.input.value, '', 'field cleared');
  assert.equal(t.button.disabled, false);
});

test('the honeypot value is sent as it is', async () => {
  const t = setup();
  t.website.value = 'http://spam.test';
  await t.submit();
  assert.equal(fetches(t)[0][2].website, 'http://spam.test');
  assert.equal(fetches(t)[0][2].ts, LOADED_AT);
});

test('a bad address shows a message and fetches nothing', async () => {
  for (const email of ['', 'nope', 'a@b', 'two words@example.com', `${'a'.repeat(250)}@example.com`]) {
    const t = setup({ email });
    await t.submit();
    assert.equal(fetches(t).length, 0, email);
    assert.match(shown(t.status), /email address that looks right/, email);
    assert.match(t.status.className, /is-err/);
    assert.equal(t.input.attrs['aria-invalid'], 'true');
    assert.ok(t.input.focused > 0, 'focus goes to the field');
  }
});

test('429 and 503 and a network error show their messages and re-enable the button', async () => {
  let t = setup({ fetchImpl: async () => ({ status: 429, body: { error: 'x' } }) });
  await t.submit();
  assert.equal(shown(t.status), 'Too many tries. Please wait an hour and try again.');
  assert.equal(t.button.disabled, false);
  assert.equal(t.input.value, 'neema@example.com', 'the address is kept');
  const generic = 'Sorry, that did not go through. Please try again later, or follow us with RSS.';
  for (const fetchImpl of [async () => ({ status: 503, body: { error: 'x' } }), async () => { throw new Error('offline'); }, async () => ({ status: 500, body: undefined })]) {
    t = setup({ fetchImpl });
    await t.submit();
    assert.equal(shown(t.status), generic);
    const link = t.status.children.find((c) => c.tag === 'a');
    assert.ok(link, 'RSS is a link');
    assert.equal(link.href, '/rss/');
    assert.match(t.status.className, /is-err/);
    assert.equal(t.button.disabled, false);
  }
});

test('a 400 naming the email field asks for a better address', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 400, body: { error: 'That email address does not look right.', field: 'email' } }) });
  await t.submit();
  assert.match(shown(t.status), /email address that looks right/);
  assert.equal(t.input.attrs['aria-invalid'], 'true');
});

test('without an endpoint the script does nothing', () => {
  const t = setup({ attrs: { 'data-endpoint': '' } });
  assert.equal(t.form.handlers.submit, undefined);
});

test('the file has no "already subscribed" wording', () => {
  assert.doesNotMatch(SRC, /already (subscribed|on the list|signed)/i);
  assert.doesNotMatch(SRC, /you are subscribed/i);
});
