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
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  n.classes = new Set();
  n.classList = { add: (c) => n.classes.add(c), remove: (c) => n.classes.delete(c) };
  n.offsetWidth = 1;
  return n;
}

// The status text as a person sees it: its own text plus any link or text nodes added after it.
const shown = (s) => s.textContent + s.children.map((c) => c.textContent ?? c.text ?? '').join('');
const state = (t) => t.form.attrs['data-state'];

function setup({ fetchImpl = async () => ({ status: 200, body: { ok: true } }), email = 'neema@example.com', attrs = {} } = {}) {
  const log = [];
  const input = el({ name: 'email', value: email });
  const website = el({ name: 'website', value: '' });
  const status = el();
  const button = el();
  const label = el({ textContent: 'Subscribe' });
  const field = el();
  const panelForm = el();
  const panelDone = el({ attrs: { inert: '', 'aria-hidden': 'true' } });
  const title = el();
  const body = el();
  const again = el();
  const form = el({ hidden: true, attrs: { 'data-newsletter': '', 'data-endpoint': ENDPOINT, 'data-state': 'idle', ...attrs } });
  form.elements = { email: input, website };
  form.reset = () => { log.push(['reset']); input.value = ''; website.value = ''; };
  const nodes = { '.foot-status': status, 'button[type="submit"]': button, '.nl-btn-label': label, '.nl-field': field, '[data-nl-form]': panelForm, '[data-nl-done]': panelDone, '[data-nl-title]': title, '[data-nl-body]': body, '[data-nl-again]': again };
  form.querySelector = (s) => nodes[s] ?? null;
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
  return { log, input, website, status, button, label, field, panelForm, panelDone, title, body, again, form, submit };
}
const fetches = (t) => t.log.filter((l) => l[0] === 'fetch');

test('nothing is fetched on load, and the form (hidden in the HTML, so nothing is sent without JavaScript) is shown', () => {
  const t = setup();
  assert.equal(fetches(t).length, 0);
  assert.equal(typeof t.form.handlers.submit, 'function');
  assert.equal(t.form.hidden, false);
});

test('an empty submit shows a message and sends nothing', async () => {
  const t = setup({ email: '   ' });
  await t.submit();
  assert.equal(fetches(t).length, 0);
  assert.equal(shown(t.status), 'Email is required.');
  assert.ok(t.field.classes.has('is-nudge'), 'the field nudges');
  assert.equal(state(t), 'idle');
});

test('a valid submit posts JSON {email, website:"", ts} once, disables the button while sending, shows the success text and clears the field', async () => {
  let release;
  const t = setup({ fetchImpl: () => new Promise((r) => { release = () => r({ status: 200, body: { ok: true } }); }) });
  t.form.handlers.submit({ preventDefault() {} });
  assert.equal(t.button.disabled, true, 'disabled while sending');
  assert.equal(state(t), 'sending');
  assert.equal(t.label.textContent, 'Sending…');
  assert.match(t.status.className, /is-quiet/, 'the live region says it; the button shows it');
  assert.equal(t.button.attrs['aria-busy'], 'true');
  t.form.handlers.submit({ preventDefault() {} }); // a second press does nothing
  assert.equal(fetches(t).length, 1);
  const [, url, body, init] = fetches(t)[0];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(Object.keys(body).sort(), ['elapsed', 'email', 'website']);
  assert.equal(body.email, 'neema@example.com');
  assert.equal(body.website, '');
  // the server treats a missing elapsed time (or under 2.5 s) as a bot, so the time spent on the page must always be sent;
  // it is measured on the visitor's own clock only, so a phone clock set wrong cannot drop the sign-up
  assert.equal(body.elapsed, 9000, 'elapsed = ms since the page loaded');
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state(t), 'sent', 'the confirmation card is shown');
  assert.equal(shown(t.status), '', 'the card says it, not the live region');
  const said = t.body.textContent + t.body.children.map((c) => c.textContent ?? c.text ?? '').join('');
  assert.equal(said, 'If the address can receive email, a link is on its way:neema@example.comOpen it to finish.');
  assert.equal(t.body.children[0].tag, 'strong', 'the address is a text node inside <strong>, never HTML');
  assert.equal(t.body.children[0].textContent, 'neema@example.com');
  assert.equal('inert' in t.panelDone.attrs, false, 'the card can be reached');
  assert.equal('inert' in t.panelForm.attrs, true, 'the hidden form cannot be tabbed to');
  assert.ok(t.title.focused > 0, 'focus moves to the card heading');
  assert.equal(t.input.value, '', 'field cleared');
  assert.equal(t.button.disabled, false);
  assert.equal(t.label.textContent, 'Subscribe');
});

test('the honeypot value is sent as it is', async () => {
  const t = setup();
  t.website.value = 'http://spam.test';
  await t.submit();
  assert.equal(fetches(t)[0][2].website, 'http://spam.test');
  assert.equal(fetches(t)[0][2].elapsed, 9000);
});

test('a bad address shows a message and fetches nothing', async () => {
  for (const email of ['', 'nope', 'a@b', 'two words@example.com', `${'a'.repeat(250)}@example.com`]) {
    const t = setup({ email });
    await t.submit();
    assert.equal(fetches(t).length, 0, email);
    assert.equal(shown(t.status), email.trim() ? 'Email looks incorrect.' : 'Email is required.', email);
    assert.match(t.status.className, /is-err/);
    assert.equal(t.input.attrs['aria-invalid'], 'true');
    assert.ok(t.input.focused > 0, 'focus goes to the field');
  }
});

test('429 and 503 and a network error show their messages and re-enable the button', async () => {
  let t = setup({ fetchImpl: async () => ({ status: 429, body: { error: 'x' } }) });
  await t.submit();
  assert.equal(shown(t.status), 'Too many attempts. Try again later.');
  assert.equal(state(t), 'idle');
  assert.equal(t.button.disabled, false);
  assert.equal(t.input.value, 'neema@example.com', 'the address is kept');
  const generic = 'Could not subscribe. Try again later, or use RSS.';
  for (const fetchImpl of [async () => ({ status: 503, body: { error: 'x' } }), async () => { throw new Error('offline'); }, async () => ({ status: 500, body: undefined })]) {
    t = setup({ fetchImpl });
    await t.submit();
    assert.equal(shown(t.status), generic);
    const link = t.status.children.find((c) => c.tag === 'a');
    assert.ok(link, 'RSS is a link');
    assert.equal(link.href, '/rss/');
    assert.match(t.status.className, /is-err/);
    assert.equal(state(t), 'idle');
    assert.equal(t.button.disabled, false);
  }
});

test('a 400 naming the email field asks for a better address', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 400, body: { error: 'Email looks incorrect.', field: 'email' } }) });
  await t.submit();
  assert.equal(shown(t.status), 'Email looks incorrect.');
  assert.equal(t.input.attrs['aria-invalid'], 'true');
});

test('a slip in a big provider name is offered back once; pressing Subscribe again sends the address as typed', async () => {
  const t = setup({ email: 'neema@gmial.com' });
  await t.submit();
  assert.equal(fetches(t).length, 0, 'nothing sent on the first press');
  assert.equal(shown(t.status), 'Did you mean neema@gmail.com? Yes, use it');
  assert.match(t.status.className, /is-warn/);
  assert.equal(t.status.children.find((c) => c.tag === 'button').type, 'button');
  assert.equal(state(t), 'idle');
  await t.submit();
  assert.equal(fetches(t).length, 1, 'the second press sends it');
  assert.equal(fetches(t)[0][2].email, 'neema@gmial.com');
});

test('"Yes, use it" puts the suggestion in the field and sends it', async () => {
  const t = setup({ email: 'neema@gmail.con' });
  await t.submit();
  t.status.children.find((c) => c.tag === 'button').handlers.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fetches(t).length, 1);
  assert.equal(fetches(t)[0][2].email, 'neema@gmail.com');
});

test('only near-misses of common providers are questioned: real and unrelated domains go straight through', async () => {
  for (const email of ['a@gmail.com', 'a@yahoo.co.uk', 'a@gmx.com', 'a@company.co.tz', 'a@outlook.com', 'a@mail.ru']) {
    const t = setup({ email });
    await t.submit();
    assert.equal(fetches(t).length, 1, email);
  }
  for (const [typed, hint] of [['a@gnail.com', 'a@gmail.com'], ['a@hotmial.com', 'a@hotmail.com'], ['a@yaho.com', 'a@yahoo.com'], ['a@outlok.com', 'a@outlook.com'], ['a@gmail.co', 'a@gmail.com'], ['a@icloud.cm', 'a@icloud.com']]) {
    const t = setup({ email: typed });
    await t.submit();
    assert.equal(fetches(t).length, 0, typed);
    assert.equal(shown(t.status), `Did you mean ${hint}? Yes, use it`, typed);
  }
});

test('the sidebar version (nl-mini) says the same short sentences and keeps the hedge and the address as text', async () => {
  const t = setup({ email: 'neema@example.com', attrs: {} });
  t.form.className = 'foot-form nl-form nl-mini';
  await t.submit();
  const said = t.body.textContent + t.body.children.map((c) => c.textContent ?? c.text ?? '').join('');
  assert.equal(said, 'If the address can receive email, a link is on its way:neema@example.comOpen it to finish.');
  assert.equal(t.body.children[0].tag, 'strong');
});

test('no message names a limit, a server or a reason: only the short wordings', async () => {
  const seen = new Set();
  for (const fetchImpl of [async () => ({ status: 429, body: { error: 'You have tried several times already.' } }), async () => ({ status: 503, body: { error: 'The newsletter is not available right now.' } }), async () => { throw new Error('Failed to fetch'); }]) {
    const t = setup({ fetchImpl });
    await t.submit();
    seen.add(shown(t.status));
  }
  assert.deepEqual([...seen].sort(), ['Could not subscribe. Try again later, or use RSS.', 'Too many attempts. Try again later.']);
  for (const m of seen) assert.doesNotMatch(m, /hour|server|network|several|Sorry|!/i, m);
});

test('"Use a different address" brings the form back, focuses the field and hides the card', async () => {
  const t = setup();
  await t.submit();
  assert.equal(state(t), 'sent');
  const before = t.input.focused;
  t.again.handlers.click();
  assert.equal(state(t), 'idle');
  assert.ok(t.input.focused > before, 'focus returns to the field');
  assert.equal('inert' in t.panelForm.attrs, false);
  assert.equal('inert' in t.panelDone.attrs, true);
});

test('without an endpoint the script does nothing', () => {
  const t = setup({ attrs: { 'data-endpoint': '' } });
  assert.equal(t.form.handlers.submit, undefined);
  assert.equal(t.form.hidden, true, 'stays hidden');
});

test('the file has no "already subscribed" wording', () => {
  assert.doesNotMatch(SRC, /already (subscribed|on the list|signed)/i);
  assert.doesNotMatch(SRC, /you are subscribed/i);
});
