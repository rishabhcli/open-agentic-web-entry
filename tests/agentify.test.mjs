import test from 'node:test';
import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { agentify, validateArgs } from '../lib/agentify.js';
import { validateDocument } from '../lib/validator-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('agentify.js is dependency-free and under 10 KB; site/lib copies are in sync', async () => {
  const size = (await stat(path.join(ROOT, 'lib/agentify.js'))).size;
  assert.ok(size < 10240, `agentify.js is ${size} bytes`);
  const src = await readFile(path.join(ROOT, 'lib/agentify.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'no imports');
  for (const f of ['agentify.js', 'validator-core.js']) assert.equal(await readFile(path.join(ROOT, 'site/lib', f), 'utf8'), await readFile(path.join(ROOT, 'lib', f), 'utf8'), `${f} out of sync: run node tools/sync.mjs`);
});

const make = () => {
  const log = [];
  const s = agentify({ name: 'my_shop', brand: 'My Shop', description: 'Answers questions about the shop.' });
  s.action('get_hours', { description: 'Opening hours', effect: 'read', schema: { type: 'object', properties: { day: { type: 'string', enum: ['mon', 'tue'] } }, required: ['day'] }, handler: ({ day }) => ({ day, open: '9-5' }) });
  s.action('place_order', { description: 'Order', effect: 'write', schema: { type: 'object', properties: { qty: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['qty'] }, handler: ({ qty }) => { log.push(qty); return { ok: true }; } });
  return { s, log };
};

test('generated network and manifest pass the conformance validator', () => {
  const { s } = make();
  const net = validateDocument(s.network(), { frontMan: 'my_shop_assistant', kind: 'network' });
  assert.deepEqual(net.issues.filter((i) => i.level !== 'info'), []);
  const man = validateDocument(s.manifest());
  assert.deepEqual(man.issues.filter((i) => i.level === 'error'), []);
  assert.equal(s.manifest().networks[0].front_man, 'my_shop_assistant');
  assert.deepEqual(s.network().tools[0].tools, ['website_get_hours', 'website_place_order']);
});

test('call: validates arguments, never throws, returns receipts', async () => {
  const { s } = make();
  assert.equal((await s.call('get_hours', { day: 'mon' })).result.open, '9-5');
  const bad = await s.call('get_hours', { day: 'sun' });
  assert.equal(bad.status, 'rejected');
  assert.match(bad.reason, /one of mon, tue/);
  assert.equal((await s.call('nope', {})).status, 'rejected');
  assert.equal((await s.call('get_hours', {})).status, 'rejected');
});

test('write actions need confirmation: no confirm callback means nothing happens', async () => {
  const { s, log } = make();
  assert.equal((await s.call('place_order', { qty: 2 })).status, 'cancelled');
  assert.equal((await s.call('place_order', { qty: 2 }, { confirm: async () => false })).status, 'cancelled');
  assert.equal((await s.call('place_order', { qty: 9 }, { confirm: async () => true })).status, 'rejected');
  assert.equal(log.length, 0);
  const seen = [];
  assert.equal((await s.call('place_order', { qty: 2 }, { confirm: async (r) => { seen.push(r); return true; }, origin: 'https://caller.test' })).status, 'succeeded');
  assert.deepEqual(log, [2]);
  assert.equal(seen[0].origin, 'https://caller.test');
});

test('handler errors become error receipts; invalid registration throws early', async () => {
  const s = agentify({ name: 'x', description: 'd' });
  s.action('boom', { description: 'b', handler: () => { throw new Error('kaput'); } });
  const r = await s.call('boom', {});
  assert.equal(r.status, 'error'); assert.equal(r.reason, 'kaput');
  assert.throws(() => s.action('Bad-Name', { handler() {} }));
  assert.throws(() => s.action('ok_name', {}));
  assert.throws(() => agentify({ name: 'bad name' }));
  assert.throws(() => s.action('z', { handler() {}, effect: 'nuke' }));
});

test('validateArgs covers the JSON Schema subset', () => {
  const sch = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'array', items: { type: 'integer' } }, b: { type: 'string', minLength: 2, pattern: '^x' } } };
  assert.deepEqual(validateArgs(sch, { a: [1, 2], b: 'xy' }), []);
  assert.equal(validateArgs(sch, { a: [1, 'z'] }).length, 1);
  assert.equal(validateArgs(sch, { a: [], b: 'y' }).length, 2);
  assert.equal(validateArgs(sch, { a: [], c: 1 }).length, 1);
  assert.equal(validateArgs(sch, 'str').length, 1);
});

test('postMessage bridge in jsdom: answers allowed origins only, fails closed otherwise', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
  const { s } = make();
  const stop = s.listen({ origins: ['https://friend.test'], confirm: async () => false, target: dom.window });
  const replies = [];
  const src = { postMessage: (m, o) => replies.push([m, o]) };
  const send = (origin, data) => { dom.window.dispatchEvent(Object.assign(new dom.window.Event('message'), { data, origin, source: src })); return new Promise((r) => setTimeout(r, 15)); };
  await send('https://friend.test', { type: 'agentic-web/describe', id: 1 });
  await send('https://friend.test', { type: 'agentic-web/call', id: 2, action: 'get_hours', args: { day: 'tue' } });
  await send('https://friend.test', { type: 'agentic-web/call', id: 3, action: 'place_order', args: { qty: 1 } });
  await send('https://evil.test', { type: 'agentic-web/call', id: 4, action: 'get_hours', args: { day: 'tue' } });
  await send('https://friend.test', { type: 'other', id: 5 });
  assert.equal(replies.length, 3, 'evil origin and unrelated messages get no reply');
  assert.deepEqual(replies[0][0].actions.map((a) => a.name), ['get_hours', 'place_order']);
  assert.ok(!('handler' in replies[0][0].actions[0]));
  assert.equal(replies[1][0].result.open, '9-5');
  assert.equal(replies[2][0].status, 'cancelled');
  assert.equal(replies[1][1], 'https://friend.test');
  stop();
  await send('https://friend.test', { type: 'agentic-web/describe', id: 6 });
  assert.equal(replies.length, 3);
});

test('WebMCP registration is feature-detected and never exposes write actions', async () => {
  const { s } = make();
  assert.equal(s.registerWebMCP({}), false);
  const tools = [];
  assert.equal(s.registerWebMCP({ modelContext: { registerTool: (t) => tools.push(t) } }), true);
  assert.deepEqual(tools.map((t) => t.name), ['get_hours']);
  const out = await tools[0].execute({ day: 'mon' });
  assert.match(out.content[0].text, /"open":"9-5"/);
});
