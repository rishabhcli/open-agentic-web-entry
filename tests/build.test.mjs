import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sh = promisify(execFile);
const BASE = 'https://example.github.io/open-agentic-web-entry/';

test('tools/build.mjs --base rewrites peer URLs to absolute public URLs; the copy still validates and runs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'maw-build-'));
  for (const d of ['lib', 'tools', 'site']) await cp(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
  const { stdout } = await sh(process.execPath, [path.join(tmp, 'tools/build.mjs'), '--base', BASE]);
  assert.match(stdout, /SRI digests updated: 3/);
  const net = JSON.parse(await readFile(path.join(tmp, 'site/meeting_coordinator.network.json'), 'utf8'));
  const refs = net.tools[0].tools.filter((t) => t.startsWith('http'));
  assert.deepEqual(refs, [`${BASE}sites/timezones/timezone_desk`, `${BASE}sites/holidays/holiday_desk`]);
  const man = JSON.parse(await readFile(path.join(tmp, 'site/agent-manifest.json'), 'utf8'));
  assert.deepEqual(man.allowed_peers, [`${BASE}sites/timezones/`, `${BASE}sites/holidays/`]);
  assert.ok(!(await readFile(path.join(tmp, 'site/agent-manifest.json'), 'utf8')).includes('127.0.0.1'));
  const v = await sh(process.execPath, [path.join(tmp, 'tools/validate.mjs'), path.join(tmp, 'site'), '--strict']);
  assert.match(v.stdout, /CONFORMS/);
  const host = await import(pathToFileURL(path.join(tmp, 'tools/node-host.mjs')).href);
  const rt = host.createNodeRuntime({ base: BASE, fetcher: host.fileFetcher({ base: BASE, siteDir: path.join(tmp, 'site') }), devBase: null });
  const r = await rt.run({ request: '30 min with Ana in London and me in Chicago between Dec 1 and Dec 4', today: '2026-11-12' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.stats.remoteCalls, 2);
});

test('build is idempotent on the repo itself: SRI digests in site/ already match the bundles', async () => {
  const before = await readFile(path.join(ROOT, 'site/agent-manifest.json'), 'utf8');
  const { build } = await import('../tools/build.mjs');
  await build();
  assert.equal(await readFile(path.join(ROOT, 'site/agent-manifest.json'), 'utf8'), before);
});
