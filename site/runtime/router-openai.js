// Pluggable inference (spec section 4): an OpenAI-compatible chat-completions router for BYOK.
// The key is read through getKey() at request time and is attached ONLY to the request sent to the selected
// router base URL. It is never placed in URLs, prompts, traces, manifests or peer requests.
import { RuntimeError } from './engine.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function openAiRouter({ baseUrl, model, getKey, fetchImpl, timeoutMs = 60000 }) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new RuntimeError('ROUTER_CONFIG', 'Router base URL is not a valid URL.'); }
  if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) throw new RuntimeError('ROUTER_CONFIG', 'Router URL must be HTTPS (plain http is allowed only for localhost).');
  if (!model || !String(model).trim()) throw new RuntimeError('ROUTER_CONFIG', 'Enter a model name.');
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    kind: 'openai', baseUrl: baseUrl.replace(/\/+$/, ''), model,
    async chat({ messages, tools }) {
      const key = getKey ? getKey() : '';
      if (!key && !LOOPBACK.has(u.hostname)) throw new RuntimeError('KEY_REQUIRED', 'This router needs an API key. Paste one under "AI model settings", or switch back to the built-in deterministic router.');
      const body = { model, messages, ...(tools && tools.length ? { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}) };
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers.Authorization = `Bearer ${key}`;
      let res;
      try {
        res = await (fetchImpl || fetch)(endpoint, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw new RuntimeError('ROUTER_UNREACHABLE', `Could not reach ${u.origin}: ${e.name === 'TimeoutError' ? 'timed out' : 'network or CORS error'}. Some providers block direct browser calls (CORS); try a CORS-enabled router or a local server.`);
      }
      if (!res.ok) {
        let detail = ''; try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        throw new RuntimeError('ROUTER_ERROR', `Router returned HTTP ${res.status}. ${detail.replace(/(sk-|Bearer\s+)[A-Za-z0-9_-]+/g, '$1***')}`);
      }
      let data;
      try { data = await res.json(); } catch { throw new RuntimeError('ROUTER_ERROR', 'Router response was not JSON.'); }
      const m = data && data.choices && data.choices[0] && data.choices[0].message;
      if (!m) throw new RuntimeError('ROUTER_ERROR', 'Router response had no choices[0].message.');
      return { content: m.content, tool_calls: m.tool_calls };
    },
  };
}
