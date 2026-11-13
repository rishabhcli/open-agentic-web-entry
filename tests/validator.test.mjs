import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, validateSite } from '../lib/validator-core.js';
import { run } from '../tools/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const REF = path.join(here, 'fixtures/reference');
const BROKEN = path.join(here, 'fixtures/broken');
const sh = promisify(execFile);

async function cli(args) {
  const out = [];
  const code = await run(args, (s) => out.push(s));
  return { code, text: out.join('\n') };
}

test('reference sample sites from cognizant-ai-labs/agentic-web all conform', async () => {
  const dirs = (await readdir(REF, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.length >= 5, `expected 5 reference sample sites, found ${dirs.length}`);
  for (const d of dirs) {
    const r = await cli([path.join(REF, d)]);
    assert.equal(r.code, 0, `${d} should conform:\n${r.text}`);
    assert.match(r.text, /CONFORMS: 0 error/);
  }
});

test('Meeting Finder and both peer sites conform with no errors or warnings (strict)', async () => {
  for (const d of ['site', 'site/sites/timezones', 'site/sites/holidays']) {
    const r = await cli([path.join(ROOT, d), '--strict']);
    assert.equal(r.code, 0, `${d}:\n${r.text}`);
    assert.match(r.text, /SRI_OK/);
  }
});

test('every deliberately broken file is rejected with the expected error codes', async () => {
  const expected = JSON.parse(await readFile(path.join(BROKEN, 'expected.json'), 'utf8'));
  for (const [file, codes] of Object.entries(expected)) {
    const r = await cli([path.join(BROKEN, file)]);
    assert.equal(r.code, 1, `${file} must fail`);
    for (const c of codes) assert.ok(r.text.includes(c), `${file} should report ${c}\n${r.text}`);
  }
});

test('--json output is machine readable', async () => {
  const r = await cli([path.join(BROKEN, 'network-duplicate-agents.json'), '--json']);
  const j = JSON.parse(r.text);
  assert.equal(j.kind, 'network');
  assert.ok(j.issues.some((i) => i.code === 'DUPLICATE_AGENT' && i.level === 'error' && i.path.startsWith('$.tools[')));
});

test('usage error and missing file give exit code 2', async () => {
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(['/no/such/file.json'])).code, 2);
});

test('composition cycles and unreachable agents are reported as warnings', () => {
  const a = (name, tools) => ({ name, function: { description: 'd' }, instructions: 'i', tools });
  const { issues } = validateDocument({ metadata: { description: 'd' }, tools: [a('f', ['g']), a('g', ['f']), a('lonely', [])] }, { frontMan: 'f' });
  assert.ok(issues.some((i) => i.code === 'COMPOSITION_CYCLE'));
  assert.ok(issues.some((i) => i.code === 'UNREACHABLE_AGENT'));
  assert.ok(!issues.some((i) => i.level === 'error'));
});

test('front_man that is not an agent is an error', () => {
  const { issues } = validateDocument({ metadata: { description: 'd' }, tools: [{ name: 'a', function: { description: 'd' }, instructions: 'i' }] }, { kind: 'network', frontMan: 'b' });
  assert.ok(issues.some((i) => i.code === 'FRONT_MAN_MISSING'));
});

test('a wrong SRI digest in a copied site is caught', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maw-'));
  await cp(path.join(ROOT, 'site/sites/holidays'), dir, { recursive: true });
  const mf = path.join(dir, 'agent-manifest.json');
  const m = JSON.parse(await readFile(mf, 'utf8'));
  m.coded_tools.sri = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  await writeFile(mf, JSON.stringify(m));
  const r = await cli([dir]);
  assert.equal(r.code, 1);
  assert.match(r.text, /SRI_MISMATCH/);
});

test('validateSite works against an HTTP server and checks CORS headers', async () => {
  const { createServer } = await import('../tools/serve.mjs');
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/agent-manifest.json`;
  try {
    const out = await cli([url]);
    assert.equal(out.code, 0, out.text);
    assert.doesNotMatch(out.text, /NO_CORS/);
    const { stdout } = await sh(process.execPath, [path.join(ROOT, 'tools/validate.mjs'), url]);
    assert.match(stdout, /CONFORMS/);
  } finally { srv.close(); }
});
