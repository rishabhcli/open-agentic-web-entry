import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeRuntime, fileFetcher, DEV_BASE } from '../tools/node-host.mjs';
import { resolveTemplate, lookup, checkPlan } from '../site/runtime/plan.js';
import { openAiRouter } from '../site/runtime/router-openai.js';
import { runSelfTest, CHECKS } from '../site/runtime/selftest.js';

const REQ = { request: '30 min with Ana in London, Ravi in Bengaluru and me in Chicago between Nov 16 and Nov 20', today: '2026-11-12' };
const strip = (r) => JSON.stringify(r.output);

test('end to end: published network runs with the built-in router and contacts exactly two peer sites', async () => {
  const urls = [];
  const rt = createNodeRuntime({ fetcher: fileFetcher({ log: (u) => urls.push(u) }) });
  const r = await rt.run(REQ, { sly: { private_note: 'secret-note' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.output.ok, true);
  assert.equal(r.output.slots.length, 5);
  assert.equal(r.stats.remoteCalls, 2);
  const peers = r.trace.filter((e) => e.type === 'peer-call');
  assert.deepEqual(peers.map((p) => p.to), ['timezone_desk', 'holiday_desk']);
  assert.ok(peers.every((p) => p.sly_fields_sent.length === 0), 'private context must not reach peers');
  assert.equal(r.trace.filter((e) => e.type === 'consent').length, 2);
  assert.ok(urls.some((u) => u.endsWith('/sites/timezones/agent-manifest.json')));
  assert.ok(urls.some((u) => u.endsWith('/sites/holidays/coded-tools.js')));
  assert.ok(!JSON.stringify(r.trace).includes('secret-note'));
});

test('determinism: two full runs produce identical output', async () => {
  const a = await createNodeRuntime().run(REQ);
  const b = await createNodeRuntime().run(REQ);
  assert.equal(strip(a), strip(b));
  assert.ok(a.output.summary.includes('Best slot'));
});

test('the page action show_result is called and receives the ranked slots', async () => {
  const { headlessUi } = await import('../tools/node-host.mjs');
  const ui = headlessUi();
  const r = await createNodeRuntime({ ui }).run(REQ);
  assert.equal(r.ok, true);
  assert.equal(ui.shown.slots.length, 5);
  assert.ok(r.trace.some((e) => e.type === 'action' && e.action === 'show_result' && e.status === 'succeeded'));
});

test('a visitor who denies consent stops the run; nothing is fetched from the peer', async () => {
  const urls = [];
  const rt = createNodeRuntime({ consent: async () => 'deny', fetcher: fileFetcher({ log: (u) => urls.push(u) }) });
  const r = await rt.run(REQ);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PEER_DENIED_USER');
  assert.ok(!urls.some((u) => u.includes('/sites/')));
});

test('"always" remembers consent per peer for the session', async () => {
  let asked = 0;
  const rt = createNodeRuntime({ consent: async () => { asked++; return 'always'; } });
  await rt.run(REQ); await rt.run(REQ);
  assert.equal(asked, 2, 'two peers asked once each, not again on the second run');
  rt.forgetConsent();
  await rt.run(REQ);
  assert.equal(asked, 4);
});

test('same-origin peers need no card only when askSameOrigin is turned off', async () => {
  let asked = 0;
  const rt = createNodeRuntime({ consent: async () => { asked++; return 'allow'; }, askSameOrigin: false });
  const r = await rt.run(REQ);
  assert.equal(r.ok, true);
  assert.equal(asked, 0);
});

test('unclear request: run completes and explains instead of failing', async () => {
  const r = await createNodeRuntime().run({ request: 'lunch sometime', today: '2026-11-12' });
  assert.equal(r.ok, true);
  assert.equal(r.output.ok, false);
  assert.match(r.output.summary, /Cannot rank slots yet/);
});

test('today is filled in from the clock when the visitor does not send it', async () => {
  const rt = createNodeRuntime({ clock: () => Date.parse('2026-11-12T15:00:00') });
  const r = await rt.run({ request: '30 min with Ana in London and me in Chicago next week' });
  assert.equal(r.output.slots[0].locals[0].date >= '2026-11-16', true);
});

test('callPeer on a site outside allowed_peers is refused with nothing sent', async () => {
  const urls = [];
  const rt = createNodeRuntime({ fetcher: fileFetcher({ log: (u) => urls.push(u) }) });
  const r = await rt.callPeer('https://evil.example/x/holiday_desk', {});
  assert.equal(r.error.code, 'PEER_DENIED_POLICY');
  assert.ok(!urls.some((u) => u.includes('evil.example')));
  const http = await rt.callPeer('http://evil.example/x/holiday_desk', {});
  assert.equal(http.error.code, 'HTTPS_REQUIRED');
});

test('the dev base URL in the manifests is remapped to the real serving base', async () => {
  const urls = [];
  const base = 'http://localhost:4321/';
  const inner = fileFetcher({ base: DEV_BASE, log: () => {} });
  const rt = createNodeRuntime({ base, fetcher: async (u) => { urls.push(u); return inner(u.replace(base, DEV_BASE)); } });
  const r = await rt.run(REQ);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(urls.every((u) => u.startsWith(base)), 'no request leaves the serving base');
});

test('LLM mode on the real network: the front agent drives agents, peers and the page through function calls', async () => {
  let step = 0;
  const seenTools = [];
  const router = {
    kind: 'fake', baseUrl: 'https://llm.test/v1', model: 'scripted',
    async chat({ messages, tools }) {
      step++;
      const last = (name) => { const m = [...messages].reverse().find((x) => x.role === 'tool' && x.__n === name); return m; };
      const toolMsgs = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
      const call = (name, args) => ({ content: null, tool_calls: [{ id: `c${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      seenTools.push(tools.map((t) => t.name));
      if (step === 1) return call('request_parser', { text: REQ.request, today: REQ.today });
      if (step === 2) return call('timezone_desk', { cities: toolMsgs[0].cities, on: toolMsgs[0].from });
      if (step === 3) return call('holiday_desk', { countries: toolMsgs[1].countries, from: toolMsgs[0].from, to: toolMsgs[0].to });
      if (step === 4) return call('slot_ranker', {});
      if (step === 5) return call('website_show_result', { from: 'slot_ranker' });
      return { content: 'Best option is in the list below.' };
    },
  };
  const { headlessUi } = await import('../tools/node-host.mjs');
  const ui = headlessUi();
  const rt = createNodeRuntime({ ui, router });
  const r = await rt.run({ request: REQ.request, today: REQ.today });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.output.answer, 'Best option is in the list below.');
  assert.ok(seenTools[0].includes('request_parser') && seenTools[0].includes('timezone_desk') && seenTools[0].includes('website_export_ics'));
  assert.equal(ui.shown.slots.length, 5);
  assert.equal(r.blackboard.slot_ranker.ok, true);
  assert.equal(r.stats.remoteCalls, 2);
});

test('LLM tool errors are reported back to the model and the run can recover; limits are fatal', async () => {
  let step = 0; const results = [];
  const router = { kind: 'fake', baseUrl: 'x', model: 'm', async chat({ messages }) { step++; const t = messages.filter((m) => m.role === 'tool'); if (t.length) results.push(JSON.parse(t[t.length - 1].content)); return step === 1 ? { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'website_export_ics', arguments: '{"slot_index":0}' } }] } : { content: 'ok' }; } };
  const r = await createNodeRuntime({ router, autoConfirm: false }).run({ request: 'x', today: '2026-11-12' });
  assert.equal(r.ok, true);
  assert.equal(results[0].status, 'cancelled', 'write without confirmation is cancelled and the model is told');
});

test('write action runs only after the visitor confirms and the .ics file is well formed', async () => {
  const { headlessUi } = await import('../tools/node-host.mjs');
  const ui = headlessUi();
  const rt = createNodeRuntime({ ui, autoConfirm: true });
  const r = await rt.run(REQ);
  const receipt = await rt.actions.call('export_ics', { slot_index: 0, title: 'Sync' }, { confirm: async () => true, context: { blackboard: r.blackboard } });
  assert.equal(receipt.status, 'succeeded');
  const f = ui.downloads[0];
  assert.match(f.file, /^meeting-\d{12}\.ics$/);
  assert.match(f.text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(f.text, /DTSTART:20261116T\d{6}Z\r\n/);
  assert.match(f.text, /SUMMARY:Sync\r\n/);
  assert.ok(f.text.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  const declined = await rt.actions.call('export_ics', { slot_index: 0 }, { confirm: async () => false, context: { blackboard: r.blackboard } });
  assert.equal(declined.status, 'cancelled');
});

test('plan templates: references, interpolation, no prototype access, bad references', () => {
  const scope = { input: { a: { b: [10, { c: 'x' }] } }, s: 'hi' };
  assert.equal(lookup('$input.a.b[1].c', scope), 'x');
  assert.deepEqual(resolveTemplate({ k: '$input.a.b[0]', t: 'v={{$s}}', lit: 'plain', gone: '$input.nope' }, scope), { k: 10, t: 'v=hi', lit: 'plain' });
  assert.equal(lookup('$input.constructor', scope), undefined);
  assert.equal(lookup('$input.__proto__', scope), undefined);
  assert.throws(() => lookup('$input.a(b)', scope));
  assert.ok(checkPlan({ steps: [{ call: 1 }] }, 'x').length > 0);
  assert.equal(checkPlan({ steps: [{ call: 'a', args: {} }] }, 'x').length, 0);
});

test('BYOK router: key only in the Authorization header of the router request; errors never echo it', async () => {
  const KEY = 'sk-unit-test-key-abcdefghijklmnop';
  let seen;
  const ok = openAiRouter({ baseUrl: 'https://r.test/v1/', model: 'm', getKey: () => KEY, fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) }; } });
  assert.equal((await ok.chat({ messages: [{ role: 'user', content: 'x' }], tools: [] })).content, 'hi');
  assert.equal(seen.url, 'https://r.test/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!seen.url.includes(KEY) && !seen.init.body.includes(KEY));
  assert.equal(seen.init.credentials, 'omit');
  const bad = openAiRouter({ baseUrl: 'https://r.test/v1', model: 'm', getKey: () => KEY, fetchImpl: async () => ({ ok: false, status: 401, text: async () => `bad key ${KEY}` }) });
  await assert.rejects(bad.chat({ messages: [], tools: [] }), (e) => e.code === 'ROUTER_ERROR' && !e.message.includes(KEY));
  assert.throws(() => openAiRouter({ baseUrl: 'http://example.com/v1', model: 'm' }), /HTTPS/);
  assert.throws(() => openAiRouter({ baseUrl: 'https://r.test/v1', model: '' }), /model/);
  const local = openAiRouter({ baseUrl: 'http://localhost:11434/v1', model: 'm', getKey: () => '', fetchImpl: async (u, i) => { seen = i; return { ok: true, json: async () => ({ choices: [{ message: { content: 'l' } }] }) }; } });
  assert.equal((await local.chat({ messages: [], tools: [] })).content, 'l');
  assert.equal(seen.headers.Authorization, undefined);
});

test('self-test: all section 6 checks pass against the real runtime', async () => {
  const rows = await runSelfTest();
  assert.equal(rows.length, CHECKS.length);
  assert.ok(rows.length >= 12);
  for (const r of rows) assert.ok(r.pass, `${r.id}: ${r.detail}`);
});
