// Declarative agent "plan" interpreter helpers. A plan is DATA inside an agent definition:
//   "plan": { "steps": [ {"call": "agent_or_tool", "args": {...}, "as": "name"},
//                         {"each": "$list", "item": "x", "call": "...", "args": {...}, "as": "name"} ],
//             "return": <template> }
// Templates: a string that starts with "$" is replaced by the referenced value ($input.a.b, $ctx.agent, $step.x[0]);
// "{{path}}" inside longer strings is interpolated; objects and arrays are resolved recursively.
// Nothing here evaluates code: references are looked up with a strict path grammar.

const PATH_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)$/;

export function lookup(ref, scope) {
  const m = PATH_RE.exec(ref);
  if (!m) throw new Error(`bad reference "${ref}"`);
  let cur = scope[m[1]];
  const parts = m[2].match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) || [];
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    const key = p[0] === '.' ? p.slice(1) : Number(p.slice(1, -1));
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    cur = Object.prototype.hasOwnProperty.call(Object(cur), key) ? cur[key] : undefined;
  }
  return cur;
}

export function resolveTemplate(t, scope) {
  if (typeof t === 'string') {
    if (t.startsWith('$')) return lookup(t, scope);
    return t.replace(/\{\{\s*(\$[^}]+?)\s*\}\}/g, (_, r) => { const v = lookup(r, scope); return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); });
  }
  if (Array.isArray(t)) return t.map((x) => resolveTemplate(x, scope));
  if (t && typeof t === 'object') return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, resolveTemplate(v, scope)]).filter(([, v]) => v !== undefined));
  return t;
}

/** Static check used by the runtime before executing: returns a list of problems. */
export function checkPlan(plan, agentName) {
  const bad = [];
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return [`agent "${agentName}": plan.steps must be an array`];
  if (plan.steps.length > 12) bad.push(`agent "${agentName}": plan has more than 12 steps`);
  plan.steps.forEach((s, i) => {
    if (!s || typeof s.call !== 'string') bad.push(`agent "${agentName}" step ${i}: "call" must be a string`);
    if (s && s.each !== undefined && typeof s.each !== 'string') bad.push(`agent "${agentName}" step ${i}: "each" must be a reference string`);
    if (s && s.each !== undefined && !/^[A-Za-z_]\w*$/.test(s.item || '')) bad.push(`agent "${agentName}" step ${i}: "each" needs an "item" name`);
    if (s && s.as !== undefined && !/^[A-Za-z_]\w*$/.test(s.as)) bad.push(`agent "${agentName}" step ${i}: bad "as" name`);
  });
  return bad;
}
