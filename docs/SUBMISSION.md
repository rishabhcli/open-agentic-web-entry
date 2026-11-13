# Devpost submission pack (drafted from verified repo facts only)

Deadline: Mon Jan 11 2027, 8:00 AM PST (16:00 UTC). Replace every `<...>` placeholder; nothing else needs inventing.

## Project name
Meeting Finder: an open agentic website, with `agentify.js` and a conformance validator

## Tagline (one line)
Agents that run in your browser, ask before calling other agent sites, and find meeting times across time zones and public holidays; plus two reusable tools for the agentic web.

## Text description (paste into "What it does" / project story)

**The problem.** Scheduling across time zones is routine and error-prone: people forget that two countries change clocks on different dates, or that a day is a public holiday for one attendee. It is also a good fit for the open agentic web, because the pieces (time zones, holidays, ranking) are naturally separate services.

**What it does.** Meeting Finder is a static website whose agent network runs entirely in the visitor's browser. The visitor types something like "30 min with Ana in London, Ravi in Bengaluru and me in Chicago between Nov 16 and Nov 20". The `meeting_coordinator` network parses the request, then asks two other agent sites, a Time Zone Desk and a Holiday Desk. Each is a separate site with its own manifest and network, loaded into the visitor's browser after the visitor approves it on a consent card that shows the origin and what will be sent. The coordinator then ranks slots by how close each time is to the middle of everyone's working day, skips weekends and public holidays in each person's country, and widens working hours transparently when nobody can meet inside them. Each slot can be exported as an `.ics` file after an explicit confirmation.

**It works with no API key.** The default router is built-in and deterministic, so the same request always gives the same answer. An optional "AI model" panel lets a visitor bring an OpenAI-compatible endpoint and key; the front agent then drives the same agents and tools with an LLM. The key stays in the browser, is sent only to the router the visitor chose, and never goes to peer sites, prompts, traces or manifests.

**See how it works.** A "How this works" panel shows the agent graph lighting up as agents run and a live list of every message between agents, tools, peers and the page. A Self-test tab runs 13 checks from section 6 of the specification against the real runtime: invalid network rejected, cycle stopped, over-budget stopped, denied origin and denied consent, exact network-name resolution, bad digest refused, private context absent at the peer by default and passed only when named, key never reaching a peer, missing key error, unknown-outcome writes, and writes without confirmation.

**Tools shared with the community (same repo, MIT).**
- `agentify.js` (8 KB, no dependencies): turns any page into a profile-conforming agent site. Typed page actions with effects (`read`, `ui`, `write`), generated network and manifest, argument validation, confirmation-gated writes, a `postMessage` bridge that answers only listed origins, and WebMCP registration when the browser supports it.
- A conformance validator, as a Node CLI (`node tools/validate.mjs <url|file|dir>`) and as a static web page: checks manifests, networks, `links.json`, SRI digests and CORS headers and reports precise errors with paths. It accepts the five sample sites copied from the reference repo and rejects 18 deliberately broken files.
- A headless host (`tools/run.mjs`, `tools/node-host.mjs`) that runs a published network from the command line, used by the tests.

## How it conforms to the specification (exact paths, relative to the site root)

| Requirement | Path |
| --- | --- |
| Public conforming `.json` (manifest) | `agent-manifest.json` |
| Resolved agent network | `meeting_coordinator.network.json` (front agent `meeting_coordinator`) |
| Peer-link map | `links.json` |
| Runtime that runs the network in the browser | `runtime/index.js` (with `engine.js`, `plan.js`, `router-openai.js`, `sandbox.js`, `sandbox-worker.js`) |
| User interface | `index.html` |
| LLM and key settings (optional) | "AI model" tab on `index.html` |
| Peer agent sites it calls | `sites/timezones/agent-manifest.json` (network `timezone_desk`), `sites/holidays/agent-manifest.json` (network `holiday_desk`) |
| Called by other agentic websites | `meeting_coordinator` listed in `agent-manifest.json` under `linking.exports`; other sites reference `<SITE BASE>meeting_coordinator` |
| Validator page | `validator/index.html` |

Site base: `<PUBLIC SITE URL>` (the folder that holds `agent-manifest.json`).

## What is original and what is reused

- **Original (written for this challenge):** the runtime, deterministic agent plans, coded-tool bundles, all UI, `agentify.js`, the validator, the build/serve/run tools and the tests.
- **Followed, not copied:** the MVP Profile 0.2 specification from `cognizant-ai-labs/agentic-web`.
- **Reused:** five sample site JSON files copied unmodified from that repository (Apache-2.0) and used only as validator test inputs in `tests/fixtures/reference/`. The reference runtime (nsDeploy) was not used.
- **Data:** the city list is a small bundled sample mapped to real IANA zone ids. Holiday dates are computed from rules (US federal; England and Wales bank holidays), not from a dataset.

## AI assistance statement
Built with AI coding assistance (Claude Code) by Rishabh Bansal. The assistant wrote most of the code and tests; Rishabh directed the design and is responsible for the submission.

## Honest limitations
- Verified by 60 automated tests and jsdom, not by a broad browser matrix. Real-browser behaviour (the Web Worker sandbox, layout, dialogs, the CSP) was not exercised by the author of the code; `<DID YOU SMOKE TEST? state browser and date>`.
- The optional key panel has been tested only against fake endpoints, not a live provider. Some providers block browser CORS.
- Holidays: US federal and England and Wales only. Weekends are Saturday and Sunday for everyone. The city list is a sample.
- MCP and cross-site action transport are not implemented. The demo peer sites share the site's origin, so cross-origin CORS behaviour of peers was not exercised against a real second origin.
- The coded-tool sandbox is defence in depth (globals removed, SRI checked), not a proven isolation boundary.
- Tab-scoped: nothing runs after the page closes.

## Built with (Devpost tags)
javascript, html, css, web-workers, node.js, json-schema, webmcp, agentic-web, open-source

## Mozilla Otari fields
Not used: the Otari email and "problem faced" fields do not apply. (The key panel accepts any OpenAI-compatible endpoint but was not tested with Otari.)

## Checklist for the parent agent (things only a human or the browser can provide)

1. Create the public GitHub repo, push this folder (MIT licence is included). Repo URL: `<REPO URL>`
2. Publish `site/` on a static host (for example GitHub Pages serving the `site/` folder or a `gh-pages` branch).
3. Before publishing run `node tools/build.mjs --base <PUBLIC SITE URL>/` (trailing slash), commit the rewritten JSON, then publish.
4. After publishing run `node tools/validate.mjs <PUBLIC SITE URL>/agent-manifest.json`. It must print `CONFORMS` with zero errors and no NO_CORS warning.
5. Open the live site in a normal browser: submit the first example, approve both consent cards, check the graph turns green, run the Self-test tab (13 PASS), open `validator/`.
6. Record the video (see `docs/DEMO_SCRIPT.md`): Rishabh speaking in his own voice, under 2:00, uploaded as a public YouTube video. Video URL: `<YOUTUBE URL>`
7. Screenshots (at least two; suggested four): the results with ranked slots; the Agent graph tab after a run; the Messages tab; the validator page showing a broken example.
8. Fill the Devpost form from this file: description, built-with tags, site URL, repo URL, video URL, screenshots. Mark the "tools shared with the community" in the description (`agentify.js` and the validator).
9. Update the "Honest limitations" browser line with what was actually smoke tested.
