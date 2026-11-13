import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { Runtime } from '../site/runtime/engine.js';
import { fileFetcher, createVmSandbox } from '../tools/node-host.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');

async function page() {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8080/', pretendToBeVisual: true });
  const w = dom.window;
  globalThis.document = w.document; globalThis.location = w.location;
  w.HTMLAnchorElement.prototype.click = function () { (w.__downloads ||= []).push(this.getAttribute('download')); };
  const { mount } = await import('../site/app.js');
  const runtime = new Runtime({ baseUrl: 'http://127.0.0.1:8080/', fetcher: fileFetcher(), sandboxFactory: createVmSandbox });
  const app = await mount({ runtime, storage: w.localStorage });
  const clickDialog = async (label) => { for (let i = 0; i < 100; i++) { if (w.document.getElementById('dlg').hasAttribute('open')) break; await new Promise((r) => setTimeout(r, 5)); } const b = [...w.document.querySelectorAll('#dlg-buttons button')].find((x) => x.textContent === label); assert.ok(b, `dialog button ${label}`); b.click(); };
  return { w, app, runtime, d: w.document, clickDialog };
}

test('page: request -> two consent cards -> ranked slots, graph and message log update', async () => {
  const { w, d, clickDialog } = await page();
  d.getElementById('request').value = '30 min with Ana in London and me in Chicago between Dec 1 and Dec 4';
  const done = new Promise((r) => { const iv = setInterval(() => { if (d.getElementById('status').textContent.startsWith('Done')) { clearInterval(iv); r(); } }, 10); });
  d.getElementById('ask-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await clickDialog('Allow once');
  await clickDialog('Allow for this session');
  await done;
  assert.equal(d.querySelectorAll('#result article.slot').length, 5);
  assert.ok(d.querySelector('#result .slot.best'));
  assert.match(d.querySelector('#result').textContent, /Option 1/);
  assert.ok(d.querySelectorAll('#log li').length > 15);
  for (const id of ['meeting_coordinator', 'request_parser', 'timezone_desk', 'zone_resolver', 'holiday_desk', 'holiday_calendar', 'slot_ranker', 'page']) assert.ok(d.getElementById(`n-${id}`).classList.contains('done'), `${id} should be done`);
  assert.match(d.getElementById('peer-list').textContent, /allowed once/);
  assert.match(d.getElementById('peer-list').textContent, /allowed for this session/);
});

test('page: denying a card stops the run with a visible alert', async () => {
  const { w, d, clickDialog } = await page();
  d.getElementById('request').value = '30 min with Ana in London and me in Chicago between Dec 1 and Dec 4';
  d.getElementById('ask-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await clickDialog('Deny');
  for (let i = 0; i < 100 && !d.querySelector('#result [role=alert]'); i++) await new Promise((r) => setTimeout(r, 10));
  assert.match(d.querySelector('#result [role=alert]').textContent, /PEER_DENIED_USER/);
});

test('page: empty request shows a hint; examples fill the box', async () => {
  const { w, d } = await page();
  d.getElementById('ask-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.match(d.getElementById('status').textContent, /Type a request first/);
  d.querySelector('[data-example]').click();
  assert.match(d.getElementById('request').value, /Ana in London/);
});

test('page: .ics export asks for confirmation and cancel does nothing', async () => {
  const { w, d, app, clickDialog } = await page();
  d.getElementById('request').value = '30 min with Ana in London and me in Chicago between Dec 1 and Dec 4';
  const p = app.runRequest(d.getElementById('request').value);
  await clickDialog('Allow for this session'); await clickDialog('Allow for this session');
  await p;
  d.querySelector('#result .slot button').click();
  await clickDialog('Cancel');
  await new Promise((r) => setTimeout(r, 20));
  assert.match(d.getElementById('status').textContent, /cancelled/);
  assert.equal((w.__downloads || []).length, 0);
  d.querySelector('#result .slot button').click();
  await clickDialog('Download file');
  await new Promise((r) => setTimeout(r, 20));
  assert.match(d.getElementById('status').textContent, /Saved meeting-\d+\.ics/);
  assert.equal(w.__downloads.length, 1);
});

test('page: BYOK key is held in memory, cleared from the input, and saved only when "Remember" is ticked', async () => {
  const { w, d } = await page();
  const form = d.getElementById('model-form');
  form.elements.router.value = 'openai'; form.dispatchEvent(new w.Event('change'));
  assert.equal(d.getElementById('byok-fields').hidden, false);
  d.getElementById('model').value = 'm1'; d.getElementById('key').value = 'sk-ui-test-key-abcdefghijklmnop';
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  assert.equal(d.getElementById('key').value, '');
  assert.equal(w.localStorage.getItem('maw.byok'), null);
  assert.ok(!d.body.textContent.includes('sk-ui-test-key'));
  d.getElementById('remember').checked = true;
  d.getElementById('key').value = 'sk-ui-test-key-abcdefghijklmnop';
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  assert.match(w.localStorage.getItem('maw.byok'), /sk-ui-test-key/);
  d.getElementById('delete-key').click();
  assert.equal(w.localStorage.getItem('maw.byok'), null);
  assert.equal(form.elements.router.value, 'local');
  assert.ok(!d.body.textContent.includes('sk-ui-test-key'));
});

test('page: self-test button fills a table with all passes', async () => {
  const { w, d } = await page();
  d.getElementById('run-test').click();
  for (let i = 0; i < 200 && !/checks passed/.test(d.getElementById('test-status').textContent); i++) await new Promise((r) => setTimeout(r, 10));
  const rows = [...d.querySelectorAll('#test-table tbody tr')];
  assert.ok(rows.length >= 12);
  assert.ok(rows.every((r) => r.firstChild.textContent === 'PASS'));
  assert.match(d.getElementById('test-status').textContent, /(\d+) of \1 checks passed/);
});

test('page: accessibility basics (labels, landmarks, tab roles, live regions, no inline scripts or styles)', async () => {
  const { d } = await page();
  assert.ok(d.querySelector('main') && d.querySelector('header') && d.querySelector('footer'));
  assert.equal(d.documentElement.lang, 'en');
  for (const input of d.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')) assert.ok(d.querySelector(`label[for="${input.id}"]`), `label for #${input.id}`);
  assert.equal(d.querySelectorAll('[role=tab]').length, 5);
  for (const t of d.querySelectorAll('[role=tab]')) assert.ok(d.getElementById(t.getAttribute('aria-controls')));
  assert.ok(d.querySelector('[role=status][aria-live=polite]'));
  assert.equal(d.querySelectorAll('script:not([src])').length, 0);
  assert.equal(d.querySelectorAll('[style]').length, 0);
  assert.match(html, /Content-Security-Policy/);
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\//i.test(html.replace(/<meta[^>]*Content-Security[^>]*>/, '').replace(/https:\/\/api\.openai\.com\/v1/g, '')), 'no external hosts or CDNs referenced in index.html');
});
