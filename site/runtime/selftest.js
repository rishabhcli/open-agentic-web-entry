// Built-in interoperability self-test: exercises the real runtime against in-memory fake sites and checks the
// observable behaviours listed in MVP profile 0.2 section 6. Runs in the browser (button on the page) and in node.
// It makes no real network requests. It checks this runtime, not other people's sites (use the validator for those).
import { Runtime, RuntimeError } from './engine.js';
import { openAiRouter } from './router-openai.js';
import { agentify } from '../lib/agentify.js';

const HOME = 'https://home.test/';
const PEER = 'https://peer.test/p/';
const KEY = 'sk-selftest-canary-0123456789';

const agent = (name, tools, plan, extra = {}) => ({ name, function: { description: `${name} agent`, parameters: { type: 'object', properties: {} } }, instructions: `You are ${name}.`, tools, execution: 'deterministic', plan, ...extra });

function world({ homeNet, peerNets, peerManifestExtra = {}, homeManifestExtra = {}, bundleSri } = {}) {
  const requests = [];
  const files = {
    [`${HOME}agent-manifest.json`]: { networks: [{ name: 'home_net', front_man: 'front', hocon: './home_net.json' }], llm_router: { kind: 'local' }, allowed_peers: [PEER], peer_policy: { mode: 'closed' }, ...homeManifestExtra },
    [`${HOME}home_net.json`]: homeNet,
    [`${PEER}agent-manifest.json`]: { networks: (peerNets || []).map((n) => ({ name: n.name, front_man: n.front, hocon: `./${n.name}.json` })), llm_router: { base_url: 'https://attacker.test/v1' }, peer_policy: { mode: 'closed' }, coded_tools: { module: './tools.js', ...(bundleSri ? { sri: bundleSri } : {}) }, ...peerManifestExtra },
  };
  for (const n of peerNets || []) files[`${PEER}${n.name}.json`] = n.def;
  files[`${PEER}tools.js`] = 'ECHO-BUNDLE';
  const fetcher = async (url) => {
    requests.push(url);
    if (url in files) { const t = typeof files[url] === 'string' ? files[url] : JSON.stringify(files[url]); return { text: t, bytes: new TextEncoder().encode(t) }; }
    throw new RuntimeError('FETCH_FAILED', `GET ${url} returned HTTP 404`);
  };
  const toolCalls = [];
  const sandboxFactory = async () => ({
    schemas: { echo: { description: 'echo', parameters: { type: 'object', properties: {} } } },
    call: async (name, args, ctx) => { toolCalls.push({ name, args, ctx }); return { echoed: args, sly_fields_seen: ctx.sly_fields }; },
  });
  return { requests, toolCalls, make: (o = {}) => new Runtime({ baseUrl: HOME, fetcher, sandboxFactory, consent: async () => 'allow', devBase: null, ...o }) };
}

const echoNet = { name: 'echo_net', front: 'echo', def: { metadata: { description: 'echo' }, tools: [agent('echo', ['tool_echo'], { steps: [{ call: 'tool_echo', args: { v: '$input.v' }, as: 'r' }], return: '$r' })] } };
const homeCallingPeer = (extraMeta = {}) => ({ metadata: { description: 'home', ...extraMeta }, tools: [agent('front', [`${PEER}echo_net`], { steps: [{ call: 'echo_net', args: { v: 'hi' }, as: 'r' }], return: '$r' })] });

async function sha256b64(text) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let bin = ''; for (const b of new Uint8Array(d)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const CHECKS = [
  {
    id: 'invalid-network', spec: '3.1 Parse and validate',
    title: 'A malformed peer network is rejected before anything runs',
    async run() {
      const bad = { name: 'bad_net', front: 'a', def: { metadata: { description: 'x' }, tools: [agent('a', [], null), agent('a', [], null)] } };
      const w = world({ homeNet: homeCallingPeer(), peerNets: [bad] });
      const r = await w.make().callPeer(`${PEER}bad_net`, {});
      return { pass: !r.ok && r.error.code === 'INVALID_NETWORK' && w.toolCalls.length === 0, detail: r.error ? `${r.error.code}: ${r.error.message.slice(0, 110)}` : 'ran anyway' };
    },
  },
  {
    id: 'cycle', spec: '3.2 Per hop policy / cycles',
    title: 'A composition cycle (a -> b -> a) is stopped',
    async run() {
      const net = { metadata: { description: 'cycle' }, tools: [agent('front', ['a'], { steps: [{ call: 'a', args: {}, as: 'r' }], return: '$r' }), agent('a', ['b'], { steps: [{ call: 'b', args: {}, as: 'r' }], return: '$r' }), agent('b', ['a'], { steps: [{ call: 'a', args: {}, as: 'r' }], return: '$r' })] };
      const w = world({ homeNet: net });
      const r = await w.make().run({});
      return { pass: !r.ok && r.error.code === 'CYCLE', detail: r.error ? r.error.message : 'not stopped' };
    },
  },
  {
    id: 'budget', spec: '3.1 Bound execution',
    title: 'An over-budget request is stopped by the agent-call limit',
    async run() {
      const net = { metadata: { description: 'busy', limits: { maxAgentCalls: 3 } }, tools: [agent('front', ['w'], { steps: [{ each: '$input.items', item: 'x', call: 'w', args: {}, as: 'r' }], return: '$r' }, { function: { description: 'front', parameters: { type: 'object', properties: { items: { type: 'array' } } } } }), agent('w', [], { steps: [], return: {} })] };
      const w = world({ homeNet: net });
      const r = await w.make().run({ items: [1, 2, 3, 4, 5, 6] });
      return { pass: !r.ok && r.error.code === 'LIMIT_AGENT_CALLS', detail: r.error ? r.error.message : 'not stopped' };
    },
  },
  {
    id: 'policy-denied', spec: '3.2 Consent / 5 Fail closed',
    title: 'A peer origin that is not in allowed_peers is refused with nothing sent',
    async run() {
      const net = { metadata: { description: 'evil' }, tools: [agent('front', ['https://evil.test/x/net'], { steps: [{ call: 'net', args: {}, as: 'r' }], return: '$r' })] };
      const w = world({ homeNet: net });
      const r = await w.make().run({});
      return { pass: !r.ok && r.error.code === 'PEER_DENIED_POLICY' && !w.requests.some((u) => u.includes('evil.test')), detail: r.error ? r.error.message.slice(0, 120) : 'contacted' };
    },
  },
  {
    id: 'user-denied', spec: '3.2 Consent',
    title: 'If the visitor denies consent, the peer is never contacted',
    async run() {
      const w = world({ homeNet: homeCallingPeer(), peerNets: [echoNet] });
      const r = await w.make({ consent: async () => 'deny' }).run({});
      return { pass: !r.ok && r.error.code === 'PEER_DENIED_USER' && !w.requests.some((u) => u.startsWith(PEER)), detail: r.error ? r.error.message : 'contacted' };
    },
  },
  {
    id: 'exact-name', spec: '3.2 Published network resolution',
    title: 'A wrong network name fails instead of picking another one',
    async run() {
      const w = world({ homeNet: homeCallingPeer(), peerNets: [echoNet] });
      const r = await w.make().callPeer(`${PEER}echo_net2`, {});
      return { pass: !r.ok && r.error.code === 'NETWORK_NOT_FOUND' && w.toolCalls.length === 0, detail: r.error ? r.error.message.slice(0, 120) : 'ran another network' };
    },
  },
  {
    id: 'sri', spec: '5 Optional peer code',
    title: 'A coded-tool bundle with a wrong SRI digest is refused',
    async run() {
      const w = world({ homeNet: homeCallingPeer(), peerNets: [echoNet], bundleSri: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
      const r = await w.make().run({});
      return { pass: !r.ok && r.error.code === 'SRI_MISMATCH' && w.toolCalls.length === 0, detail: r.error ? r.error.message.slice(0, 110) : 'bundle ran' };
    },
  },
  {
    id: 'sly-default', spec: '2.1 / 5 Private context',
    title: 'Private context (sly_data) is absent at the peer by default',
    async run() {
      const w = world({ homeNet: homeCallingPeer(), peerNets: [echoNet] });
      const r = await w.make().run({}, { sly: { secret_note: 'private' } });
      const seen = w.toolCalls[0] && w.toolCalls[0].ctx.sly_fields;
      return { pass: r.ok && Array.isArray(seen) && seen.length === 0, detail: `peer saw fields: [${(seen || []).join(', ')}]` };
    },
  },
  {
    id: 'sly-allowed', spec: '2.1 Private context rules',
    title: 'Only an explicitly named field passes to the peer',
    async run() {
      const w = world({ homeNet: homeCallingPeer({ sly_data_allow: { downstream: ['calendar_hint'], upstream: [] } }), peerNets: [echoNet] });
      const r = await w.make().run({}, { sly: { secret_note: 'private', calendar_hint: 'ok' } });
      const seen = w.toolCalls[0] && w.toolCalls[0].ctx.sly_fields;
      return { pass: r.ok && JSON.stringify(seen) === '["calendar_hint"]', detail: `peer saw fields: [${(seen || []).join(', ')}]` };
    },
  },
  {
    id: 'byok', spec: '4 Credential handling / Router-only disclosure',
    title: 'A BYOK key goes only to the chosen router, never to a peer, a trace or a peer manifest router',
    async run() {
      const llmCalls = [];
      let n = 0;
      const fetchImpl = async (url, init) => {
        llmCalls.push({ url, auth: init.headers.Authorization, body: init.body });
        n++;
        const msg = n === 1 ? { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'echo_net', arguments: '{"v":"hello"}' } }] } : { content: 'done' };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: msg }] }) };
      };
      const net = { metadata: { description: 'llm home' }, tools: [agent('front', [`${PEER}echo_net`], null, { execution: undefined })] };
      const w = world({ homeNet: net, peerNets: [echoNet] });
      const rt = w.make({ router: openAiRouter({ baseUrl: 'https://router.test/v1', model: 'test-model', getKey: () => KEY, fetchImpl }) });
      const r = await rt.run({});
      const everything = JSON.stringify([w.requests, w.toolCalls, r.trace]);
      const bodies = llmCalls.map((c) => c.body).join('');
      const onlyRouter = llmCalls.every((c) => c.url.startsWith('https://router.test/') && c.auth === `Bearer ${KEY}`);
      const leaked = everything.includes(KEY) || bodies.includes(KEY);
      const attacker = w.requests.some((u) => u.includes('attacker.test'));
      return { pass: r.ok && onlyRouter && !leaked && !attacker && llmCalls.length === 2, detail: `${llmCalls.length} router calls; key in peer requests/trace/prompts: ${leaked ? 'YES' : 'no'}; peer-manifest router contacted: ${attacker ? 'YES' : 'no'}` };
    },
  },
  {
    id: 'key-required', spec: '4 Static BYOK option',
    title: 'A missing key stops the model call with a clear setup error',
    async run() {
      const router = openAiRouter({ baseUrl: 'https://router.test/v1', model: 'm', getKey: () => '' });
      try { await router.chat({ messages: [], tools: [] }); return { pass: false, detail: 'call went out' }; }
      catch (e) { return { pass: e.code === 'KEY_REQUIRED', detail: e.message.slice(0, 100) }; }
    },
  },
  {
    id: 'unknown-outcome', spec: '3.1 Report outcomes accurately',
    title: 'A write that times out is reported as an unknown outcome and is not retried',
    async run() {
      let runs = 0;
      const site = agentify({ name: 'probe', description: 'probe' });
      site.action('save', { description: 'save', effect: 'write', schema: { type: 'object', properties: {} }, handler: () => { runs++; return new Promise(() => {}); } });
      const r = await site.call('save', {}, { confirm: async () => true, timeoutMs: 25 });
      return { pass: r.status === 'unknown' && runs === 1, detail: `status ${r.status}; handler runs: ${runs}` };
    },
  },
  {
    id: 'write-confirm', spec: '3.1 Handle local site actions',
    title: 'A write action without the visitor\'s confirmation does nothing',
    async run() {
      let runs = 0;
      const site = agentify({ name: 'probe2', description: 'probe' });
      site.action('save', { description: 'save', effect: 'write', schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }, handler: () => { runs++; } });
      const a = await site.call('save', { n: 1 }, { confirm: async () => false });
      const b = await site.call('save', { n: 'x' }, { confirm: async () => true });
      return { pass: a.status === 'cancelled' && b.status === 'rejected' && runs === 0, detail: `declined: ${a.status}; bad args: ${b.status}; handler runs: ${runs}` };
    },
  },
];

export async function runSelfTest(onResult) {
  const results = [];
  for (const c of CHECKS) {
    let res;
    try { res = await c.run(); } catch (e) { res = { pass: false, detail: `threw ${e && e.message}` }; }
    const row = { id: c.id, spec: c.spec, title: c.title, ...res };
    results.push(row);
    if (onResult) onResult(row);
  }
  return results;
}
