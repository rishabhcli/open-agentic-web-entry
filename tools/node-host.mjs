// Node host for the runtime: serves site files to the engine from disk (no HTTP server needed) and sandboxes
// coded-tool bundles in a node:vm context with no globals except the JS built-ins. Used by tests and tools/run.mjs.
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime, RuntimeError } from '../site/runtime/engine.js';
import { createSite } from '../site/actions.js';

export const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
export const DEV_BASE = 'http://127.0.0.1:8080/';

export async function createVmSandbox(code) {
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx, { timeout: 2000 });
  const t = vm.runInContext('agenticTools', ctx);
  if (!t || typeof t.tools !== 'object') throw new RuntimeError('CODED_TOOL_FAILED', 'bundle did not define agenticTools');
  const schemas = JSON.parse(vm.runInContext('JSON.stringify(agenticTools.schemas || {})', ctx));
  return {
    schemas,
    async call(name, args, c) {
      ctx.__n = name; ctx.__a = JSON.parse(JSON.stringify(args ?? {})); ctx.__c = c || {};
      const out = vm.runInContext('JSON.stringify(agenticTools.tools[__n](__a, __c))', ctx, { timeout: 3000 });
      return out === undefined ? undefined : JSON.parse(out);
    },
  };
}

/** Map `${base}...` URLs to files under siteDir; anything else is refused (no outside network in tests). */
export function fileFetcher({ base = DEV_BASE, siteDir = SITE_DIR, log } = {}) {
  return async (url) => {
    if (log) log(url);
    const u = new URL(url);
    if (!url.startsWith(base)) throw new RuntimeError('FETCH_FAILED', `GET ${url} failed (not served by the local file host)`);
    let rel = '/' + decodeURIComponent(u.pathname.slice(new URL(base).pathname.length));
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(siteDir, rel);
    if (!file.startsWith(siteDir)) throw new RuntimeError('FETCH_FAILED', 'path escape');
    try { const b = await readFile(file); return { text: b.toString('utf8'), bytes: new Uint8Array(b) }; }
    catch { throw new RuntimeError('FETCH_FAILED', `GET ${url} returned HTTP 404`); }
  };
}

export function headlessUi(state = {}) {
  const ui = { shown: null, downloads: [], getState: () => ({ request_text: state.text || '', router: 'local' }), showResult(r) { ui.shown = r; }, download(f, t) { ui.downloads.push({ file: f, text: t }); }, now: () => new Date(0).toISOString() };
  return ui;
}

export function createNodeRuntime(opts = {}) {
  const ui = opts.ui || headlessUi();
  return new Runtime({ actions: createSite(ui), confirm: async () => !!opts.autoConfirm, baseUrl: opts.base || DEV_BASE, fetcher: opts.fetcher || fileFetcher({ base: opts.base || DEV_BASE }), sandboxFactory: createVmSandbox, consent: opts.consent || (async () => 'allow'), ...opts });
}
