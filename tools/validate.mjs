#!/usr/bin/env node
// Usage: node tools/validate.mjs <url|file|dir> [--json] [--strict] [--cors]
// - agent-manifest.json (file or URL): validates the whole site (manifest, networks, links.json, coded tools).
// - a network .json or links.json: validates that single document.
// Exit code: 0 conformant, 1 errors found (or warnings with --strict), 2 usage.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateSite, validateDocument, detectKind, summarize, formatIssues } from '../lib/validator-core.js';

async function read(u) {
  if (u.startsWith('file:')) {
    const b = await readFile(fileURLToPath(u));
    return { text: b.toString('utf8'), bytes: new Uint8Array(b), headers: { get: () => null } };
  }
  const ctl = AbortSignal.timeout(15000);
  const r = await fetch(u, { signal: ctl, headers: { Origin: 'https://example-caller.invalid' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  return { text: new TextDecoder().decode(b), bytes: b, headers: r.headers };
}

export async function run(argv, log = console.log) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  if (args.length !== 1) { log('usage: node tools/validate.mjs <url|file|dir> [--json] [--strict] [--cors]'); return 2; }
  let target = args[0];
  const isUrl = /^https?:\/\//i.test(target);
  let url;
  if (isUrl) url = target;
  else {
    let p = path.resolve(target);
    try { if ((await stat(p)).isDirectory()) p = path.join(p, 'agent-manifest.json'); } catch { log(`not found: ${target}`); return 2; }
    url = pathToFileURL(p).href;
  }
  const opts = { checkCors: flags.has('--cors') || isUrl };
  let first;
  try { first = await read(url.endsWith('/') ? url + 'agent-manifest.json' : url); } catch (e) {
    if (isUrl && !/\.json$/i.test(url)) { url = url.replace(/\/?$/, '/') + 'agent-manifest.json'; try { first = await read(url); } catch (e2) { log(`could not fetch ${url}: ${e2.message}`); return 2; } }
    else { log(`could not read ${url}: ${e.message}`); return 2; }
  }
  if (url.endsWith('/')) url += 'agent-manifest.json';
  let doc;
  try { doc = JSON.parse(first.text); } catch (e) { log(`ERROR INVALID_JSON: ${e.message}`); return 1; }
  const kind = detectKind(doc);
  let issues; let report = null;
  if (kind === 'manifest') {
    report = await validateSite(read, url, opts);
    issues = report.issues;
    if (flags.has('--json')) log(JSON.stringify(report, null, 2));
    else {
      log(`Validating site manifest ${url}`);
      for (const f of report.files) { const s = summarize(f.issues); log(`\n${f.file}  [${s.error} error, ${s.warn} warn, ${s.info} info]`); if (f.issues.length) log(formatIssues(f.issues)); }
    }
  } else {
    const r = validateDocument(doc, opts);
    issues = r.issues;
    if (flags.has('--json')) log(JSON.stringify({ kind: r.kind, issues }, null, 2));
    else { log(`Validating ${r.kind} ${url}`); if (issues.length) log(formatIssues(issues)); }
  }
  const s = summarize(issues);
  if (!flags.has('--json')) log(`\n${s.ok && !(flags.has('--strict') && s.warn) ? 'CONFORMS' : 'DOES NOT CONFORM'}: ${s.error} error(s), ${s.warn} warning(s), ${s.info} note(s)`);
  return s.error > 0 || (flags.has('--strict') && s.warn > 0) ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run(process.argv.slice(2)).then((c) => process.exit(c));
}
