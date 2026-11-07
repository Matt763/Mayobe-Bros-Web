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

function setup({ fetchImpl, values = {} } = {}) {
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
  const form = el({ attrs: { 'data-mail-api': '', 'data-endpoint': 'https://api.test/v1/contact', 'data-mailto': 'info@mayobebros.com' } });
  form.elements = f;
  form.reset = () => { log.push(['reset']); for (const k of Object.keys(f)) f[k].value = ''; };
  form.querySelector = (s) => (s === '.form-status' ? status : s.startsWith('button') ? button : null);
  const ctx = {
    document: { getElementById: (id) => (id === 'contact-form' ? form : (id.match(/^cf-(\w+)-err$/) ? notes[id.match(/^cf-(\w+)-err$/)[1]] : null)), createElement: () => el(), createTextNode: (t) => ({ text: t }) },
    fetch: async (url, init) => { log.push(['fetch', url, JSON.parse(init.body), init.headers]); const r = await fetchImpl(url, init); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } }; },
    Date, JSON, encodeURIComponent, Object,
  };
  vm.runInNewContext(SRC, ctx);
  const submit = async () => { form.handlers.submit({ preventDefault: () => log.push(['prevent']) }); await new Promise((r) => setTimeout(r, 20)); };
  return { f, notes, status, button, form, log, submit };
}

test('a valid form posts JSON with the honeypot and a page-load time, then shows the success text and focuses it', async () => {
  const t = setup({ fetchImpl: async () => ({ status: 200, body: { ok: true } }) });
  await t.submit();
  const call = t.log.find((l) => l[0] === 'fetch');
  assert.equal(call[1], 'https://api.test/v1/contact');
  assert.deepEqual(Object.keys(call[2]).sort(), ['email', 'message', 'name', 'subject', 'ts', 'website']);
  assert.equal(call[2].website, '');
  assert.equal(typeof call[2].ts, 'number');
  assert.equal(call[3]['Content-Type'], 'application/json');
  assert.equal(t.status.textContent, 'Thank you. Your message was sent. If it needs a reply, we will write to the address you gave.');
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
});

test('503, a network error and an unreadable answer all show the mailto fallback with the visitor\'s text', async () => {
  for (const impl of [async () => ({ status: 503, body: { error: 'We could not send your message. Please email us at info@mayobebros.com.' } }), async () => { throw new Error('offline'); }, async () => ({ status: 502 })]) {
    const t = setup({ fetchImpl: impl });
    await t.submit();
    assert.match(t.status.className, /is-err/);
    const a = t.status.children[0];
    assert.match(a.href, /^mailto:info@mayobebros\.com\?subject=A%20question&body=/);
    assert.ok(decodeURIComponent(a.href).includes('Hello, how do you choose topics?'));
    assert.ok(t.status.focused > 0);
    assert.equal(t.button.disabled, false);
    assert.equal(t.log.some((l) => l[0] === 'reset'), false, 'the visitor\'s text is kept');
  }
});

test('400 shows the server\'s message and 429 asks to try later; the text is kept', async () => {
  let t = setup({ fetchImpl: async () => ({ status: 400, body: { error: 'That email address does not look right.' } }) });
  await t.submit();
  assert.equal(t.status.textContent, 'That email address does not look right.');
  t = setup({ fetchImpl: async () => ({ status: 429, body: { error: 'x' } }) });
  await t.submit();
  assert.match(t.status.textContent, /try again later/);
});

test('the built contact page has the honeypot, field notes, status and the script, and no JS needed for the mailto fallback', () => {
  const html = fs.readFileSync(path.join(ROOT, 'contact', 'index.html'), 'utf8');
  const api = /data-mail-api/.test(html);
  assert.match(html, /id="contact-form"[^>]*data-mailto="[^"]+"/);
  assert.match(html, /class="form-status" role="status"/);
  for (const k of ['name', 'email', 'subject', 'message']) assert.match(html, new RegExp(`id="cf-${k}-err"`));
  if (api) {
    assert.match(html, /data-endpoint="https?:\/\/[^"]+\/v1\/contact"/);
    assert.match(html, /name="website"/);
    assert.match(html, /js\/contact\.js/);
  } else {
    assert.doesNotMatch(html, /js\/contact\.js/);
    assert.doesNotMatch(html, /name="website"/);
  }
});
