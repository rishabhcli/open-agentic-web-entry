# Meeting Finder: an open agentic website, plus `agentify.js` and a conformance validator

Entry to the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/) (Cognizant, Devpost).
It targets the **MVP Profile 0.2** specification in
[cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md).

> Built with AI coding assistance (Claude Code) by Rishabh Bansal. The design, review and testing decisions are his;
> most of the code was written by the assistant. See [What was and was not tested](#what-was-and-was-not-tested).

Three things ship in this repo:

1. **Meeting Finder** (`site/`): a static website whose agents run in the visitor's browser. You describe a meeting in
   plain English ("30 min with Ana in London, Ravi in Bengaluru and me in Chicago next week"). The coordinator agent
   parses it, then, after you approve each one, loads **two other agent sites** (a Time Zone Desk and a Holiday Desk)
   into your browser, and ranks slots by how close each time is to the middle of everyone's working day, skipping
   weekends and public holidays in each person's country. It works with **no API key**.
2. **`lib/agentify.js`** (8 KB, no dependencies): turns any web page into a profile-conforming agent site. Register
   page capabilities as typed actions; it generates the network and manifest, validates arguments, gates writes behind
   confirmation, and offers a `postMessage` bridge and WebMCP registration.
3. **A conformance validator**: `node tools/validate.mjs <url|file|dir>` and a static page (`site/validator/`) that
   check an `agent-manifest.json`, a network definition, `links.json`, the coded-tool digest and CORS headers, and
   report precise errors with paths.

## Run it

Developed and tested on Node 24 (should work on Node 20+). No build step, no runtime dependencies (`jsdom` is a dev dependency used only by tests).

```sh
node tools/serve.mjs 8080          # then open http://127.0.0.1:8080/
node tools/run.mjs "30 min with Ana in London and me in Chicago between Dec 1 and Dec 4" --today 2026-11-12 --trace
node tools/validate.mjs site       # validate this site (manifest, networks, links, SRI)
npm install && npm test            # 60 tests
```

Any port works (`node tools/serve.mjs 3000`): the manifests use `http://127.0.0.1:8080/` as a development base and the
runtime remaps it to wherever the site is actually served. **Before publishing**, make the URLs absolute and recompute
digests:

```sh
node tools/build.mjs --base https://YOUR-USER.github.io/YOUR-REPO/
```

## Where the required pieces are

| Challenge requirement | File |
| --- | --- |
| Public conforming `.json` describing an agent network | `site/agent-manifest.json` (manifest) and `site/meeting_coordinator.network.json` (resolved network) |
| `runtime` file that runs the network in the browser | `site/runtime/index.js` (entry), `engine.js`, `plan.js`, `router-openai.js`, `sandbox.js`, `sandbox-worker.js` |
| Interface for users or agents to interact | `site/index.html` + `site/app.js` (users); `site/actions.js` registered through `agentify.js` (agents on the page); the published network URL (other sites) |
| Optional interface to configure LLMs and keys | "AI model" tab on the page |
| Interacts with the website, other agentic websites, and can be called by them | Page actions `website_*`; peers `site/sites/timezones/`, `site/sites/holidays/`; `meeting_coordinator` is exported in `manifest.linking.exports` and listed in `links.json` |

Peer sites published in this repo (each a complete agent site with its own manifest, network, `links.json` and coded-tool bundle):

- `site/sites/timezones/` network `timezone_desk` (agents `timezone_desk`, `zone_resolver`)
- `site/sites/holidays/` network `holiday_desk` (agents `holiday_desk`, `holiday_calendar`)

## How it follows the specification

| Spec section | What this implementation does |
| --- | --- |
| 2 Common representation | Resolved, data-only JSON networks with `metadata`, agents under `tools`, `function.description`, `function.parameters` (JSON Schema), `instructions`, `tools`. No includes, substitutions or keys. |
| 2.1 Private context | `metadata.sly_data_allow.downstream/upstream` name the only fields that may cross to or from peers. Default is none. |
| 2.1 External capabilities | Peer networks by absolute URL, page actions (`website_*`, name + purpose + schema + effect + handler), coded tools (`tool_*`). MCP descriptors are **not** supported; the runtime fails closed with a visible error. |
| 3.1 Parse and validate | Manifest and network are validated (same code as the validator) before any agent runs; executable `class` definitions are rejected. |
| 3.1 Bound execution | Depth 5, 24 agent calls, 4 remote calls, 60 s by default; a network can lower them via `metadata.limits`, never exceed the runtime maximums. Cycles are stopped. |
| 3.1 Outcomes | Write actions require runtime-owned confirmation; a timeout after a write starts is reported as `unknown` and never retried by the runtime. |
| 3.2 Loading a peer | Exact-name resolution through the peer's `agent-manifest.json`; no fallback to another network. Policy check (`peer_policy`, `allowed_peers`), then a consent card naming origin, network and the first 140 characters sent, before any contact. "Allow for this session" is per peer base. Every hop repeats the checks. Peer files are fetched with `credentials: 'omit'` and no referrer. |
| 3.3 Public files | `agent-manifest.json`, resolved network JSON, `links.json`, optional coded-tool bundle with `sri` digest. |
| 4 Pluggable inference | Default router is a built-in deterministic one. BYOK: any OpenAI-compatible `/chat/completions` endpoint (HTTPS, or localhost). The key is attached only to that request; the router is chosen by the top site, and a peer manifest's `llm_router` is ignored. |
| 5 Security | Peer networks are treated as untrusted: all peer output is rendered with `textContent`; coded tools run in a Web Worker with network and storage globals removed, after SRI verification. |
| 6 Interoperability checks | The **Self-test** tab runs 13 of them against the real runtime and in-memory fake sites (invalid network, cycle, over-budget, denied origin, denied consent, exact name, bad SRI, private context default and allow-list, BYOK key never reaches a peer or a trace, missing key, unknown outcome, write without confirmation). |

### Extensions beyond the profile text (clearly labelled)

- **`execution` + `plan` on an agent**: a small declarative plan (`steps` with `call`/`each`, `return` template, `$input`,
  `$ctx.<agent>`) lets agents run **deterministically with no LLM**. It is data, interpreted by the runtime with a strict
  path grammar (no `eval`). When a BYOK router is active, the front agent switches to an LLM tool-calling loop that uses the
  same tools; leaf agents marked `"execution": "deterministic"` keep running their plans.
- **`coded_tools`** in the manifest (`module`, `sri`): the profile's optional coded-tool bundle. Bundles here are classic
  scripts that assign `globalThis.agenticTools = { schemas, tools }`.

## `agentify.js` in 10 lines

```js
import { agentify } from './lib/agentify.js';
const site = agentify({ name: 'my_shop', brand: 'My Shop', description: 'Answers questions about the shop.' });
site.action('get_hours', { description: 'Opening hours', effect: 'read',
  schema: { type: 'object', properties: { day: { type: 'string', enum: ['mon', 'tue'] } }, required: ['day'] },
  handler: ({ day }) => ({ day, open: '9-5' }) });
site.action('place_order', { description: 'Place an order', effect: 'write', schema: {/*...*/}, handler: () => ({ ok: true }) });
site.network();            // resolved network JSON with a front agent that can call website_get_hours, website_place_order
site.manifest();           // agent-manifest.json
await site.call('place_order', { qty: 1 }, { confirm: async (receipt) => window.confirm(receipt.action) });
site.listen({ origins: ['https://friend.example'] });   // postMessage bridge, other origins get no reply
site.registerWebMCP();     // read/ui actions only, when navigator.modelContext exists
```

Effects are `read`, `ui` (reversible page change) and `write` (needs confirmation; fails closed without it). `call` never
throws and returns a receipt with `status`: `succeeded`, `cancelled`, `rejected`, `error` or `unknown`.

## Validator

```sh
node tools/validate.mjs https://example.com/agent-manifest.json   # whole site, with CORS check
node tools/validate.mjs ./site                                      # directory
node tools/validate.mjs some.network.json --json                    # one document, machine-readable
node tools/validate.mjs site --strict                               # warnings fail too
```

Exit code `0` conforms, `1` errors, `2` usage. Checked: manifest shape, unique valid network names, `front_man` exists in
the network, `hocon` is a relative path or http(s) URL (not a local path, warns on `.hocon`), HTTPS except loopback, unique
agent names, `function.description`, JSON Schema shape, tool references (agent, peer URL ending in a network name,
`website_*`/`tool_*`, MCP descriptor), unreachable agents, composition cycles, unresolved `${...}` and includes, secrets
(`sk-...`, Bearer tokens, `api_key` fields), `links.json` shape, SRI digest vs the actual bundle, CORS header.

Tested against the five sample sites copied unmodified from the reference repo (`tests/fixtures/reference/`, Apache-2.0,
see `NOTICE.txt` there) and 18 deliberately broken files in `tests/fixtures/broken/` (each listed with its expected error
codes in `expected.json`). It encodes the checks I could derive from the specification text; it is not an official test
suite and cannot prove a runtime conforms.

## Privacy and keys

- No key is ever stored server-side; there is no server. A pasted key lives in a JS variable and is cleared from the input
  after Apply. It is written to `localStorage` **only** if you tick "Remember on this device", and "Delete saved key" removes it.
- The key goes only to the Base URL you entered, in an `Authorization` header. It is never in a URL, prompt, trace,
  manifest or peer request (checked by the Self-test and `tests/runtime.test.mjs`).
- Other scripts on the same origin could read a `localStorage` key. The page ships a restrictive Content-Security-Policy
  `<meta>`, no third-party scripts, fonts or CDNs.

## What was and was not tested

Tested (60 automated tests, `node --test`, run on macOS with Node 24):

- Validator: reference samples, 18 broken files, CLI exit codes and `--json`, an SRI mismatch, a live HTTP server and CORS.
- Tools: US and England/Wales holidays against known dates (2022 to 2027), time-zone offsets across DST gaps, request
  parsing, ranking, transparent hour widening, byte-identical determinism over repeated runs.
- Runtime: full headless runs over the real site files; consent allow/deny/session; policy denial; private context;
  LLM mode with a scripted fake router driving the real network; write confirmation and `.ics` output; `build --base`.
- UI under **jsdom** (not a real browser): consent cards, results, graph state, message log, BYOK key handling, a11y basics.
- The Web Worker sandbox **protocol** under a fake worker scope in `node:vm`.

Not tested, and stated plainly:

- **No real browser run was done by the code author.** Layout, the real `Worker`, dialog focus behaviour, dark mode and
  the CSP in Chrome/Safari/Firefox still need a manual smoke test.
- No call to any real LLM provider (OpenAI, Otari, Ollama, etc.). The BYOK path is tested against fake endpoints only.
  Providers that block browser CORS will not work from a static site.
- Cross-origin peers on a different real origin; the demo peers share this site's origin (consent is still asked).
- The sandbox is defence in depth (globals removed, SRI checked), not a proven isolation boundary.

## Known limits

- The city list is a small bundled **sample** (67 cities plus a few aliases); any IANA zone id also works. Unknown cities are reported, not guessed.
- Holiday calendars exist only for the **US (federal)** and **England and Wales (standard bank holidays)**, computed from
  rules; one-off royal-event holidays are excluded. Other countries are reported as unchecked.
- Weekends are Saturday and Sunday for everyone; half-day holidays and regional holidays are not modelled.
- MCP, authenticated MCP and cross-site action transport are not implemented. The profile calls MCP the baseline for
  grounded capabilities; this project grounds capabilities in coded tools and page actions instead.
- Tab-scoped by design: nothing runs after the page closes.

## Layout

```
site/                 everything hosted statically
  index.html app.js styles.css actions.js ics.js
  agent-manifest.json meeting_coordinator.network.json links.json coded-tools.js
  runtime/            engine, plan, routers, sandbox, selftest, index.js
  sites/timezones/    peer agent site     sites/holidays/   peer agent site
  validator/          validator page
  lib/                copies of lib/ (tools/sync.mjs keeps them identical; a test checks)
lib/                  agentify.js, validator-core.js (sources of truth)
tools/                validate.mjs serve.mjs run.mjs build.mjs sync.mjs node-host.mjs
tests/                *.test.mjs and fixtures/
docs/                 DEMO_SCRIPT.md SUBMISSION.md
```

## Credits and licence

MIT, see `LICENSE`. The runtime, tools, UI and validator are original work written for this challenge. The only reused
material is the specification (followed, not copied) and sample files from
[cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web) (Apache-2.0) used as validator test
inputs. The reference runtime (nsDeploy) was not used or copied.
