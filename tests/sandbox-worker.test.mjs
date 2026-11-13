// The Web Worker cannot run under node, so this drives sandbox-worker.js inside a vm with a fake worker scope.
// It proves the init/ready/call protocol and that network/storage globals are removed before the bundle loads.
// It does NOT prove browser isolation; see README "What was and was not tested".
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');

async function worker() {
  const posted = [];
  const g = { postMessage: (m) => posted.push(m), fetch: () => 'net', XMLHttpRequest: 1, WebSocket: 1, indexedDB: 1, navigator: {}, Worker: 1 };
  g.self = g;
  let src = '';
  g.Blob = class { constructor(parts) { this.code = parts[0]; } };
  g.URL = { createObjectURL: (b) => { src = b.code; return 'blob:test'; }, revokeObjectURL() {} };
  const ctx = vm.createContext(g);
  g.importScripts = () => vm.runInContext(src, ctx);
  vm.runInContext(await readFile(path.join(ROOT, 'runtime/sandbox-worker.js'), 'utf8'), ctx);
  return { g, posted, ctx };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('worker removes network and storage globals before loading the bundle, then serves tool calls', async () => {
  const { g, posted, ctx } = await worker();
  const probe = 'globalThis.agenticTools = { schemas: { probe: { description: "d" } }, tools: { probe: (a) => ({ fetch: typeof fetch, xhr: typeof XMLHttpRequest, ws: typeof WebSocket, idb: typeof indexedDB, echo: a.x }) } };';
  g.onmessage({ data: { type: 'init', code: probe } });
  assert.equal(posted[0].type, 'ready');
  assert.deepEqual(Object.keys(posted[0].schemas), ['probe']);
  g.onmessage({ data: { type: 'call', id: 7, name: 'probe', args: { x: 3 }, ctx: {} } });
  await tick();
  const res = posted.find((m) => m.type === 'result' && m.id === 7);
  assert.deepEqual(JSON.parse(JSON.stringify(res.value)), { fetch: 'undefined', xhr: 'undefined', ws: 'undefined', idb: 'undefined', echo: 3 });
  assert.equal(vm.runInContext('typeof importScripts', ctx), 'undefined', 'importScripts is removed after the bundle loads');
});

test('worker reports bundle errors and unknown tools instead of hanging', async () => {
  const a = await worker();
  a.g.onmessage({ data: { type: 'init', code: 'throw new Error("bad bundle")' } });
  assert.equal(a.posted[0].type, 'init-error');
  assert.match(a.posted[0].message, /bad bundle/);
  const b = await worker();
  b.g.onmessage({ data: { type: 'init', code: 'globalThis.agenticTools = { schemas: {}, tools: {} }' } });
  b.g.onmessage({ data: { type: 'call', id: 1, name: 'missing', args: {} } });
  await tick();
  assert.match(b.posted.find((m) => m.id === 1).error, /no tool "missing"/);
  const c = await worker();
  c.g.onmessage({ data: { type: 'init', code: 'var x = 1' } });
  assert.equal(c.posted[0].type, 'init-error');
});

test('the real bundles load in the worker scope and define their tools', async () => {
  for (const rel of ['coded-tools.js', 'sites/timezones/coded-tools.js', 'sites/holidays/coded-tools.js']) {
    const { g, posted } = await worker();
    g.onmessage({ data: { type: 'init', code: await readFile(path.join(ROOT, rel), 'utf8') } });
    assert.equal(posted[0].type, 'ready', rel);
    assert.ok(Object.keys(posted[0].schemas).length >= 1);
  }
});
