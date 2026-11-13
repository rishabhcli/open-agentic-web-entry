// Public entry of the browser runtime (the "runtime file" referenced by agent-manifest.json).
//   import { boot } from './runtime/index.js';
//   const rt = boot({ actions, consent, confirm, onTrace });  const result = await rt.run({ request: '...' });
import { Runtime, RuntimeError, DEFAULT_LIMITS, MAX_LIMITS } from './engine.js';
import { openAiRouter } from './router-openai.js';
import { createWorkerSandbox } from './sandbox.js';

export { Runtime, RuntimeError, DEFAULT_LIMITS, MAX_LIMITS, openAiRouter, createWorkerSandbox };
export { runSelfTest, CHECKS } from './selftest.js';

export function boot(opts = {}) {
  const o = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  return new Runtime({ baseUrl: new URL('../', import.meta.url).href, sandboxFactory: (code) => createWorkerSandbox(code), ...o });
}
