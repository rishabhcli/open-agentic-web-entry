// Browser sandbox for coded-tool bundles: a dedicated Web Worker with network and storage APIs removed
// before the bundle runs. The runtime verifies the SRI digest first. This is defence in depth, not a proof of
// isolation: pair it with a restrictive Content-Security-Policy (see README).
import { RuntimeError } from './engine.js';

export async function createWorkerSandbox(code, { workerUrl = new URL('./sandbox-worker.js', import.meta.url).href, timeoutMs = 8000 } = {}) {
  const worker = new Worker(workerUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') resolve(m.schemas);
      else if (m.type === 'init-error') reject(new RuntimeError('CODED_TOOL_FAILED', `Bundle failed to load: ${m.message}`));
      else if (m.type === 'result') { const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error)) : p.resolve(m.value); } }
    };
    worker.onerror = (e) => reject(new RuntimeError('CODED_TOOL_FAILED', `Worker error: ${e.message}`));
  });
  worker.postMessage({ type: 'init', code });
  const schemas = await ready;
  return {
    schemas,
    call(name, args, ctx) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); worker.terminate(); reject(new Error(`tool "${name}" timed out after ${timeoutMs} ms`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ type: 'call', id, name, args, ctx });
      });
    },
    terminate() { worker.terminate(); },
  };
}
