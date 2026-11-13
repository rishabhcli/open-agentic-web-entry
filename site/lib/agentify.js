// agentify.js: turn any web page into a spec-conforming agent site. Dependency-free ES module.
// Open Agentic Web MVP profile 0.2: site actions (name, purpose, JSON Schema, effect, handler),
// generated network + manifest, a postMessage bridge, and WebMCP registration when available.
// MIT License. https://github.com/rishabhcli/open-agentic-web-entry

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

/** Tiny JSON Schema subset check. Returns a list of problems (empty = valid). */
export function validateArgs(schema, value, path = 'args') {
  const bad = [];
  if (!schema || typeof schema !== 'object') return bad;
  const t = typeOf(value);
  if (schema.type) {
    const want = [].concat(schema.type);
    if (!want.some((w) => w === t || (w === 'number' && t === 'integer'))) { bad.push(`${path}: expected ${want.join('|')}, got ${t}`); return bad; }
  }
  if (schema.enum && !schema.enum.includes(value)) bad.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) bad.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) bad.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) bad.push(`${path}: too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) bad.push(`${path}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) bad.push(`${path}: does not match ${schema.pattern}`);
  }
  if (t === 'array' && schema.items) value.forEach((v, i) => bad.push(...validateArgs(schema.items, v, `${path}[${i}]`)));
  if (t === 'object') {
    for (const r of schema.required || []) if (!(r in value)) bad.push(`${path}.${r}: required`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) bad.push(...validateArgs(s, value[k], `${path}.${k}`));
    if (schema.additionalProperties === false) for (const k of Object.keys(value)) if (!(k in (schema.properties || {}))) bad.push(`${path}.${k}: unexpected property`);
  }
  return bad;
}

/**
 * @param {{name:string, description:string, frontAgent?:string, brand?:string, instructions?:string}} cfg
 */
export function agentify(cfg) {
  if (!cfg || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(cfg.name || '')) throw new Error('agentify: cfg.name must be a URL-safe network name');
  const registry = new Map();
  const front = cfg.frontAgent || `${cfg.name}_assistant`;
  const site = {
    name: cfg.name,
    action(name, def) {
      if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`agentify: action name "${name}" must be snake_case`);
      if (typeof def.handler !== 'function') throw new Error(`agentify: action "${name}" needs a handler`);
      const effect = def.effect || 'read';
      if (!['read', 'ui', 'write'].includes(effect)) throw new Error(`agentify: effect must be read, ui or write`);
      registry.set(name, { name, description: def.description || name, parameters: def.schema || { type: 'object', properties: {} }, effect, handler: def.handler });
      return site;
    },
    /** Public catalog (no handlers). */
    actions() {
      return [...registry.values()].map(({ handler, ...rest }) => ({ ...rest }));
    },
    has: (name) => registry.has(name),
    /**
     * Validate, confirm (writes only) and run an action. Never throws: returns a receipt.
     * status: succeeded | cancelled | rejected | error | unknown (timeout after a write began).
     */
    async call(name, args = {}, opts = {}) {
      const a = registry.get(name);
      const receipt = { action: name, effect: a?.effect, args, id: `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
      if (!a) return { ...receipt, status: 'rejected', reason: `unknown action "${name}"` };
      const problems = validateArgs(a.parameters, args);
      if (problems.length) return { ...receipt, status: 'rejected', reason: problems.join('; ') };
      if (a.effect === 'write') {
        const ok = typeof opts.confirm === 'function' ? await opts.confirm({ ...receipt, origin: opts.origin }) : false;
        if (!ok) return { ...receipt, status: 'cancelled', reason: 'the visitor did not confirm; nothing happened' };
      }
      let timer;
      try {
        const run = Promise.resolve(a.handler(args, { receipt, ...(opts.context || {}) }));
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { timeout: true })), opts.timeoutMs || 15000); });
        const result = await Promise.race([run, timeout]);
        return { ...receipt, status: 'succeeded', result };
      } catch (e) {
        if (e.timeout && a.effect === 'write') return { ...receipt, status: 'unknown', reason: 'timed out after a write began; outcome unknown, do not retry' };
        return { ...receipt, status: 'error', reason: String(e.message || e) };
      } finally { clearTimeout(timer); }
    },
    /** Resolved, data-only network definition with one front agent that may call every action. */
    network(extra = {}) {
      return {
        metadata: { description: cfg.description, ...(extra.metadata || {}) },
        tools: [{
          name: front,
          function: { description: cfg.description, parameters: { type: 'object', properties: { inquiry: { type: 'string', description: 'What the visitor wants.' } }, required: ['inquiry'] } },
          instructions: cfg.instructions || `You are the assistant for ${cfg.brand || cfg.name}. Use only the website_* tools for facts about this page. Never invent data.`,
          tools: [...registry.keys()].map((n) => `website_${n}`),
        }, ...(extra.tools || [])],
      };
    },
    /** agent-manifest.json for this site. `hocon` is where the network JSON is published. */
    manifest(opts = {}) {
      return {
        brand: cfg.brand || cfg.name,
        networks: [{ name: cfg.name, front_man: front, hocon: opts.hocon || `./${cfg.name}.network.json`, description: cfg.description, tags: ['agentified-website'] }],
        llm_router: opts.llm_router || { kind: 'byok-only', base_url: 'https://api.openai.com/v1', byok_router: 'https://api.openai.com/v1' },
        allowed_peers: opts.allowed_peers || [],
        peer_policy: opts.peer_policy || { mode: 'closed', deny_origins: [] },
        actions: { version: 1, agentTools: [...registry.keys()].map((n) => `website_${n}`) },
      };
    },
    /**
     * postMessage bridge. Other pages (iframe/popup/opener) send
     *   {type:'agentic-web/describe', id}  or  {type:'agentic-web/call', id, action, args}
     * and receive {type:'agentic-web/reply', id, ...}. Only listed origins are answered; writes need `confirm`.
     */
    listen({ origins = [], confirm, target = globalThis } = {}) {
      const on = async (ev) => {
        const m = ev.data;
        if (!m || typeof m !== 'object' || !String(m.type).startsWith('agentic-web/')) return;
        if (!origins.includes(ev.origin)) return; // fail closed: unknown origins get nothing
        const reply = (body) => ev.source?.postMessage({ type: 'agentic-web/reply', id: m.id, ...body }, ev.origin);
        if (m.type === 'agentic-web/describe') return reply({ name: cfg.name, actions: site.actions() });
        if (m.type === 'agentic-web/call') return reply(await site.call(String(m.action), m.args || {}, { confirm, origin: ev.origin }));
      };
      target.addEventListener('message', on);
      return () => target.removeEventListener('message', on);
    },
    /** Also expose read/ui actions through WebMCP (navigator.modelContext) when the browser has it. */
    registerWebMCP(nav = globalThis.navigator) {
      const mc = nav && nav.modelContext;
      if (!mc || typeof mc.registerTool !== 'function') return false;
      for (const a of site.actions().filter((x) => x.effect !== 'write')) {
        mc.registerTool({ name: a.name, description: a.description, inputSchema: a.parameters, execute: async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await site.call(a.name, args)) }] }) });
      }
      return true;
    },
  };
  return site;
}

export default agentify;
