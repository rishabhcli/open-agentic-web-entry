#!/usr/bin/env node
// node tools/build.mjs [--base https://you.github.io/repo/]
// 1) recomputes the sha256 SRI digest of every coded-tools.js into its manifest
// 2) optionally rewrites the development base (http://127.0.0.1:8080/) to your public site base in all published JSON,
//    so peer URLs are absolute as the profile requires. Also copies lib/ into site/lib/ (same as tools/sync.mjs).
import { readFile, writeFile, readdir, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DEV = 'http://127.0.0.1:8080/';

export async function sync() {
  await mkdir(path.join(SITE, 'lib'), { recursive: true });
  for (const f of ['agentify.js', 'validator-core.js']) await copyFile(path.join(ROOT, 'lib', f), path.join(SITE, 'lib', f));
}
async function* walk(d) { for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'lib') yield* walk(p); } else yield p; } }

export async function build({ base } = {}) {
  await sync();
  let digests = 0, rewritten = 0;
  for await (const f of walk(SITE)) {
    if (!f.endsWith('.json')) continue;
    let text = await readFile(f, 'utf8');
    const j = JSON.parse(text);
    if (j.coded_tools && j.coded_tools.module) {
      const bundle = await readFile(path.join(path.dirname(f), j.coded_tools.module));
      j.coded_tools.sri = `sha256-${createHash('sha256').update(bundle).digest('base64')}`;
      digests++;
    }
    let out = JSON.stringify(j, null, 2) + '\n';
    if (base) { const b = base.endsWith('/') ? base : base + '/'; const before = out; out = out.split(DEV).join(b); if (before !== out) rewritten++; }
    if (out !== text) await writeFile(f, out);
  }
  return { digests, rewritten };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--base');
  build({ base: i > 0 ? process.argv[i + 1] : undefined }).then((r) => console.log(`SRI digests updated: ${r.digests}; files with base rewritten: ${r.rewritten}`));
}
