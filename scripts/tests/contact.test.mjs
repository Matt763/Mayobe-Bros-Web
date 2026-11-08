// js/contact.js runs here inside a small stub browser, and the built /contact/ page is checked for the markup it needs.
//   node --no-warnings --test scripts/tests/contact.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'contact.js'), 'utf8');

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

function setup({ fetchImpl, values = {}, attrs = {}, createElement } = {}) {
  const log = [];
  const f = { name: el(), email: el(), subject: el(), message: el(), website: el() };
  Object.assign(f.name, { name: 'name', value: 'Neema Joseph' });
  Object.assign(f.email, { name: 'email', value: 'neema@example.com' });
  Object.assign(f.subject, { name: 'subject', value: 'A question' });
  Object.assign(f.message, { name: 'message', value: 'Hello, how do you choose topics?' });
  for (const [k, v] of Object.entries(values)) f[k].value = v;
  const notes = Object.fromEntries(['name', 'email', 'subject', 'message'].map((k) => [k, el({ hidden: true })]));
  const status = el();
  const button = el();
  const form = el({ attrs: { 'data-mail-api': '', 'data-endpoint': 'https://api.test/v1/contact', 'data-mailto': 'info@mayobebros.com', ...attrs } });
  form.elements = f;
  form.reset = () => { log.push(['reset']); for (const k of Object.keys(f)) f[k].value = ''; };
  form.querySelector = (s) => (s === '.form-status' ? status : s.startsWith('button') ? button : null);
  const ctx = {
    document: { getElementById: (id) => (id === 'contact-form' ? form : (id.match(/^cf-(\w+)-err$/) ? notes[id.match(/^cf-(\w+)-err$/)[1]] : null)), createElement: createElement || (() => el()), createTextNode: (t) => ({ text: t }) },
    fetch: async (url, init) => { log.push(['fetch', url, JSON.parse(init.body), init.headers]); const r = await fetchImpl(url, init); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } }; },
    Date, JSON, encodeURIComponent, Object,
  };
  vm.runInNewContext(SRC, ctx);
  const input = (name, value) => { f[name].value = value; form.handlers.input({ target: f[name] }); };
  const submit = async () => { form.handlers.submit({ preventDefault: () => log.push(['prevent']) }); await new Promise((r) => setTimeout(r, 20)); };
  return { f, notes, status, button, form, log, submit, input };
}

test('a valid form posts JSON with the honeypot and a page-load time, then shows the success text and focuses it', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 200, body: { ok: true } }) });
  await t.submit();
  const call = t.log.find((l) => l[0] === 'fetch');
  assert.equal(call[1], 'https://api.test/v1/contact');
  assert.deepEqual(Object.keys(call[2]).sort(), ['email', 'id', 'message', 'name', 'subject', 'ts', 'website']);
  assert.equal(call[2].website, '');
  assert.equal(typeof call[2].ts, 'number');
  assert.equal(call[3]['Content-Type'], 'application/json');
  assert.equal(t.status.textContent, 'Message sent.');
  assert.match(t.status.className, /is-ok/);
  assert.ok(t.status.focused > 0);
  assert.equal(t.button.disabled, false);
  assert.ok(t.log.some((l) => l[0] === 'reset'));
});

test('the button is disabled while sending, and a second press does nothing', async () => {
  let release;
  const t = setup({ fetchImpl: () => new Promise((r) => { release = () => r({ status: 200, body: { ok: true } }); }) });
  t.form.handlers.submit({ preventDefault() {} });
  assert.equal(t.button.disabled, true);
  t.form.handlers.submit({ preventDefault() {} });
  assert.equal(t.log.filter((l) => l[0] === 'fetch').length, 1);
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.button.disabled, false);
});

test('invalid fields stop the post, show a message next to each field and focus the first', async () => {
  const t = setup({ values: { name: 'A', email: 'nope', message: 'short' } });
  await t.submit();
  assert.equal(t.log.some((l) => l[0] === 'fetch'), false);
  for (const k of ['name', 'email', 'message']) { assert.equal(t.f[k].attrs['aria-invalid'], 'true'); assert.equal(t.notes[k].hidden, false); assert.ok(t.notes[k].textContent.length > 10); }
  assert.equal(t.notes.subject.hidden, true);
  assert.equal(t.f.name.focused, 1);
  assert.match(t.status.className, /is-err/);
  assert.equal(t.status.textContent, 'Some fields need attention.');
});

test('each field error names the field and the problem in a few words, and never gives the limits', async () => {
  const t = setup({ values: { name: 'A', email: 'nope', subject: '', message: 'short' } });
  await t.submit();
  assert.deepEqual(
    ['name', 'email', 'subject', 'message'].map((k) => t.notes[k].textContent),
    ['Name is too short.', 'Email looks incorrect.', 'Subject is required.', 'Message is too short.'],
  );
  const long = setup({ values: { name: 'N'.repeat(51), email: '', subject: 'S'.repeat(121), message: 'M'.repeat(3001) } });
  await long.submit();
  assert.deepEqual(
    ['name', 'email', 'subject', 'message'].map((k) => long.notes[k].textContent),
    ['Name is too long.', 'Email is required.', 'Subject is too long.', 'Message is too long.'],
  );
  for (const k of ['name', 'email', 'subject', 'message']) {
    const words = long.notes[k].textContent.split(' ').length;
    assert.ok(words <= 6, `${k}: ${words} words`);
    assert.doesNotMatch(long.notes[k].textContent, /\d|@|example/, 'no numbers or examples in a field error');
  }
});

test('503, a network error and an unreadable answer all show the mailto fallback with the visitor\'s text', async () => {
  for (const impl of [async () => ({ status: 503, body: { error: 'Could not send. Email us at info@mayobebros.com.' } }), async () => { throw new Error('offline'); }, async () => ({ status: 502 })]) {
    const t = setup({ fetchImpl: impl });
    await t.submit();
    assert.match(t.status.className, /is-err/);
    const a = t.status.children[0];
    assert.match(a.href, /^mailto:info@mayobebros\.com\?subject=A%20question&body=/);
    assert.ok(decodeURIComponent(a.href).includes('Hello, how do you choose topics?'));
    assert.ok(t.status.focused > 0);
    assert.equal(t.status.textContent, 'Could not send. Try again, or email ');
    assert.equal(a.textContent, 'info@mayobebros.com', 'the address is the link');
    assert.equal(t.status.children[1].text, '.');
    assert.equal(t.button.disabled, false);
    assert.equal(t.log.some((l) => l[0] === 'reset'), false, 'the visitor\'s text is kept');
  }
});

test('429 says to try later and still offers the mailto link; the text is kept', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 429, body: { error: 'x' } }) });
  await t.submit();
  assert.equal(t.status.textContent, 'Too many attempts. Try again later, or email ');
  assert.match(t.status.children[0].href, /^mailto:/);
  assert.equal(t.log.some((l) => l[0] === 'reset'), false);
});

const bodyOf = (href) => decodeURIComponent(href.split('&body=')[1]);

test('every send carries one random id per form fill; a retry after a failure keeps it, a new message gets a new one', async () => {
  let n = 0;
  const t = setup({ fetchImpl: async () => (++n === 1 ? { status: 503, body: {} } : { status: 200, body: { ok: true } }) });
  await t.submit();
  await t.submit();
  const ids = t.log.filter((l) => l[0] === 'fetch').map((l) => l[2].id);
  assert.match(ids[0], /^[A-Za-z0-9-]{16,64}$/);
  assert.equal(ids[1], ids[0], 'same id on retry');
  t.f.message.value = 'Hello, how do you choose topics?';
  t.f.name.value = 'Neema Joseph'; t.f.email.value = 'neema@example.com'; t.f.subject.value = 'A question';
  await t.submit();
  const ids2 = t.log.filter((l) => l[0] === 'fetch').map((l) => l[2].id);
  assert.notEqual(ids2[2], ids[0], 'a new id after a successful send');
});

test('a lone surrogate does not break the fallback: it is replaced, and the button works again', async () => {
  const t = setup({ fetchImpl: async () => { throw new Error('offline'); }, values: { message: 'Hello \ud800 lone \udc00 pair \ud83d\ude00 ok' } });
  await t.submit();
  const a = t.status.children[0];
  assert.ok(a && a.href.startsWith('mailto:'), 'a mailto link was made');
  assert.ok(a.href.includes('%EF%BF%BD'), 'U+FFFD in place of the lone surrogates');
  assert.ok(a.href.includes('%F0%9F%98%80'), 'a real emoji pair is kept');
  assert.equal(t.button.disabled, false);
});

test('a huge non-ASCII message gives a short mailto link with a note', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 503, body: {} }), values: { message: '\u0645'.repeat(3000) } });
  await t.submit();
  const href = t.status.children[0].href;
  assert.ok(href.split('&body=')[1].length <= 1900, `encoded body is ${href.split('&body=')[1].length}`);
  assert.ok(bodyOf(href).includes('(message shortened, please paste the rest)'));
  assert.equal(t.button.disabled, false);
});

test('even if building the fallback throws, the button is enabled again and the user sees a plain message', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 503, body: {} }), createElement: () => { throw new Error('boom'); } });
  await t.submit();
  assert.equal(t.button.disabled, false);
  assert.notEqual(t.status.textContent, 'Sending…');
  assert.equal(t.status.textContent, 'Could not send. Email us at info@mayobebros.com.');
});

test('only a 400 that names a field is a field error; any other failure shows the fallback', async () => {
  let t = setup({ fetchImpl: async () => ({ status: 400, body: { error: 'Email looks incorrect.', field: 'email' } }) });
  await t.submit();
  assert.equal(t.f.email.attrs['aria-invalid'], 'true');
  assert.equal(t.notes.email.textContent, 'Email looks incorrect.');
  assert.equal(t.status.textContent, 'One field needs attention.');
  assert.equal(t.f.email.focused, 1);
  assert.equal(t.status.children.length, 0, 'no fallback link');
  for (const resp of [{ status: 400, body: { error: 'Complete the security check.' } }, { status: 403, body: { error: 'Could not send. Try again.' } }, { status: 413, body: {} }, { status: 500, body: {} }, { status: 200, body: {} }]) {
    t = setup({ fetchImpl: async () => resp });
    await t.submit();
    assert.ok(t.status.children[0] && t.status.children[0].href.startsWith('mailto:'), `fallback for ${resp.status} ${JSON.stringify(resp.body)}`);
    assert.equal(t.button.disabled, false);
  }
});

test('typing in a field that is marked wrong clears the mark once it is valid', async () => {
  const t = setup({ values: { name: 'A' } });
  await t.submit();
  assert.equal(t.f.name.attrs['aria-invalid'], 'true');
  t.input('name', 'A');
  assert.equal(t.f.name.attrs['aria-invalid'], 'true', 'still too short');
  t.input('name', 'Asha');
  assert.equal(t.f.name.attrs['aria-invalid'], 'false');
  assert.equal(t.notes.name.hidden, true);
});

test('without an endpoint the script does nothing', () => {
  const t = setup({ attrs: { 'data-endpoint': '' } });
  assert.equal(t.form.handlers.submit, undefined);
});

test('built contact page: markup agrees with the build mode, and render.mjs has both branches', () => {
  const html = fs.readFileSync(path.join(ROOT, 'contact', 'index.html'), 'utf8');
  const on = /data-mail-api/.test(html);
  assert.match(html, /id="contact-form"[^>]*data-mailto="[^"]+"/);
  assert.match(html, /class="form-status" role="status"/);
  for (const k of ['name', 'email', 'subject', 'message']) assert.match(html, new RegExp(`id="cf-${k}-err"`));
  assert.equal(/name="website"/.test(html), on, 'honeypot only with the mail API');
  assert.equal(/js\/contact\.js/.test(html), on, 'script only with the mail API');
  assert.equal(/data-endpoint="[^"]*\/v1\/contact"/.test(html), on, 'mail endpoint only with the mail API');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'render.mjs'), 'utf8');
  assert.match(src, /api \? `\$\{api\}\/v1\/contact` : c\.formAction \|\| ''/, 'endpoint with and without the API');
  assert.match(src, /endpoint \? '<div class="hp"/, 'honeypot is conditional');
  assert.match(src, /api && meta\.contact/, 'script is conditional');
});
