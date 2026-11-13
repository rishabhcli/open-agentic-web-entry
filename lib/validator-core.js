// Conformance validator core for the Open Agentic Web MVP profile 0.2.
// Isomorphic ES module: runs in node (tools/validate.mjs) and in the browser (site/validator/).
// Checks only what the profile text says (sections 2, 3.1, 3.3, 4); it is not an official test suite.

const err = (code, path, message) => ({ level: 'error', code, path, message });
const warn = (code, path, message) => ({ level: 'warn', code, path, message });
const info = (code, path, message) => ({ level: 'info', code, path, message });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SRI_RE = /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const EXTERNAL_PREFIX = /^(website|tool)_[A-Za-z0-9_]+$/;

function parseHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

/** HTTPS is required except for loopback development hosts (section 3.3). */
function httpsIssue(path, u) {
  if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) {
    return err('HTTPS_REQUIRED', path, `"${u.href}" uses http: production deployments MUST use HTTPS (only loopback hosts may use http).`);
  }
  return null;
}

const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'looks like an API key (sk-...)'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/, 'contains a Bearer token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'looks like an AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'looks like a GitHub token'],
];
const SECRET_KEY_RE = /^(api[_-]?key|apikey|authorization|secret|password|access[_-]?token|bearer)$/i;

function scanSecretsAndSubstitutions(node, path, out) {
  if (typeof node === 'string') {
    for (const [re, why] of SECRET_PATTERNS) {
      if (re.test(node)) out.push(err('SECRET_IN_DOCUMENT', path, `Value ${why}. Keys MUST NOT appear in manifests or network definitions (section 4).`));
    }
    if (/\$\{\??[A-Za-z_][^}]*\}/.test(node)) {
      out.push(err('UNRESOLVED_SUBSTITUTION', path, 'Contains a ${...} substitution. Published networks MUST be fully resolved (section 2).'));
    }
    if (/^file:\/\//i.test(node) || /^\/(Users|home|var|etc|tmp)\//.test(node) || /^[A-Za-z]:\\/.test(node)) {
      out.push(warn('LOCAL_PATH', path, 'Looks like a publisher-only filesystem path; published networks MUST NOT depend on those.'));
    }
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => scanSecretsAndSubstitutions(v, `${path}[${i}]`, out));
  } else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (SECRET_KEY_RE.test(k) && typeof v === 'string' && v.trim() !== '') {
        out.push(err('SECRET_IN_DOCUMENT', `${path}.${k}`, `Field "${k}" holds a non-empty string; credentials MUST NOT be published.`));
      }
      if (k === 'include' || k === '#include') {
        out.push(err('UNRESOLVED_INCLUDE', `${path}.${k}`, 'HOCON include left in a published document (section 2).'));
      }
      scanSecretsAndSubstitutions(v, `${path}.${k}`, out);
    }
  }
}

function checkSchema(schema, path, out) {
  if (!isObj(schema)) { out.push(err('SCHEMA_NOT_OBJECT', path, 'Invocation schema must be a JSON Schema object.')); return; }
  if (schema.type !== undefined && schema.type !== 'object') out.push(warn('SCHEMA_TYPE', `${path}.type`, `Top-level parameter schema should have type "object" (found ${JSON.stringify(schema.type)}).`));
  if (schema.properties !== undefined && !isObj(schema.properties)) out.push(err('SCHEMA_PROPERTIES', `${path}.properties`, '"properties" must be an object.'));
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || !schema.required.every(isStr)) out.push(err('SCHEMA_REQUIRED', `${path}.required`, '"required" must be an array of property names.'));
    else if (isObj(schema.properties)) {
      for (const r of schema.required) if (!(r in schema.properties)) out.push(warn('SCHEMA_REQUIRED_UNKNOWN', `${path}.required`, `Required property "${r}" is not declared in "properties".`));
    }
  }
}

/** Validate a resolved network definition (the data-only JSON artifact). */
export function validateNetwork(net, opts = {}) {
  const out = [];
  if (!isObj(net)) return [err('NETWORK_NOT_OBJECT', '$', 'A network definition must be a JSON object.')];
  if (net.metadata === undefined) out.push(warn('NO_METADATA', '$.metadata', 'Add metadata.description: a network needs a short description (section 2.1).'));
  else if (!isObj(net.metadata) || !isStr(net.metadata.description)) out.push(warn('NO_DESCRIPTION', '$.metadata.description', 'metadata.description should be a non-empty string.'));
  if (!Array.isArray(net.tools) || net.tools.length === 0) {
    out.push(err('NO_AGENTS', '$.tools', 'A network needs a non-empty "tools" array holding its agent definitions.'));
    return out;
  }
  const names = new Map();
  net.tools.forEach((t, i) => {
    const p = `$.tools[${i}]`;
    if (!isObj(t)) { out.push(err('AGENT_NOT_OBJECT', p, 'Agent definition must be an object.')); return; }
    if (!isStr(t.name)) { out.push(err('AGENT_NO_NAME', `${p}.name`, 'Every agent needs a unique non-empty "name".')); return; }
    if (names.has(t.name)) out.push(err('DUPLICATE_AGENT', `${p}.name`, `Agent name "${t.name}" is already used at $.tools[${names.get(t.name)}].`));
    else names.set(t.name, i);
  });
  const edges = new Map();
  net.tools.forEach((t, i) => {
    if (!isObj(t) || !isStr(t.name)) return;
    const p = `$.tools[${i}]`;
    const label = `agent "${t.name}"`;
    if (!isObj(t.function) || !isStr(t.function.description)) {
      out.push(err('AGENT_NO_FUNCTION_DESCRIPTION', `${p}.function.description`, `${label} needs function.description so callers can decide when to use it (section 2.1).`));
    }
    if (isObj(t.function) && t.function.parameters !== undefined) checkSchema(t.function.parameters, `${p}.function.parameters`, out);
    if (!isStr(t.instructions) && t.class === undefined) out.push(warn('AGENT_NO_INSTRUCTIONS', `${p}.instructions`, `${label} has no instructions; an LLM-backed agent needs them (section 2.1).`));
    if (t.class !== undefined) out.push(warn('CODED_TOOL_CLASS', `${p}.class`, `${label} references a coded tool class. Server-side classes are not portable; a runtime may reject them (section 3.1).`));
    const refs = [];
    if (t.tools !== undefined && !Array.isArray(t.tools)) out.push(err('TOOLS_NOT_ARRAY', `${p}.tools`, '"tools" must be an array of agent names, peer-network URLs or MCP descriptors.'));
    (Array.isArray(t.tools) ? t.tools : []).forEach((ref, j) => {
      const rp = `${p}.tools[${j}]`;
      if (typeof ref === 'string') {
        if (/^https?:\/\//i.test(ref)) {
          const u = parseHttpUrl(ref);
          if (!u) out.push(err('BAD_PEER_URL', rp, `"${ref}" is not a valid URL.`));
          else {
            const h = httpsIssue(rp, u); if (h) out.push(h);
            if (u.pathname.replace(/\/+$/, '').split('/').pop() === '') out.push(err('PEER_URL_NO_NETWORK', rp, 'A peer-network URL must end with the published network name (section 3.2 step 1).'));
          }
        } else if (names.has(ref)) {
          refs.push(ref);
          if (ref === t.name) out.push(warn('SELF_REFERENCE', rp, `${label} lists itself as a tool.`));
        } else if (EXTERNAL_PREFIX.test(ref)) {
          out.push(info('EXTERNAL_CAPABILITY', rp, `"${ref}" is a site action or coded tool; it must be registered by the runtime or declared in the manifest.`));
        } else {
          out.push(err('UNKNOWN_AGENT_REFERENCE', rp, `${label} references "${ref}", which is not an agent in this network, a peer URL, or a website_*/tool_* capability.`));
        }
      } else if (isObj(ref)) {
        if (!parseHttpUrl(ref.url || '')) out.push(err('MCP_NO_URL', `${rp}.url`, 'An MCP descriptor needs an http(s) "url".'));
        else { const h = httpsIssue(`${rp}.url`, parseHttpUrl(ref.url)); if (h) out.push(h); }
        if (ref.tools !== undefined && !(Array.isArray(ref.tools) && ref.tools.every(isStr))) out.push(err('MCP_TOOLS', `${rp}.tools`, 'MCP "tools" must be an array of tool-name strings.'));
      } else {
        out.push(err('BAD_TOOL_REFERENCE', rp, 'Tool reference must be a string or an MCP descriptor object.'));
      }
    });
    edges.set(t.name, refs);
  });
  // front agent, reachability, cycles
  if (opts.frontMan !== undefined) {
    if (!names.has(opts.frontMan)) out.push(err('FRONT_MAN_MISSING', '$.tools', `Manifest front_man "${opts.frontMan}" is not an agent in this network (agents: ${[...names.keys()].join(', ')}).`));
    else {
      const seen = new Set([opts.frontMan]); const stack = [opts.frontMan];
      while (stack.length) for (const n of edges.get(stack.pop()) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
      for (const n of names.keys()) if (!seen.has(n)) out.push(warn('UNREACHABLE_AGENT', `$.tools`, `Agent "${n}" cannot be reached from the front agent "${opts.frontMan}".`));
    }
  }
  const state = new Map();
  const walk = (n, trail) => {
    state.set(n, 1);
    for (const m of edges.get(n) || []) {
      if (state.get(m) === 1) { out.push(warn('COMPOSITION_CYCLE', '$.tools', `Composition cycle ${[...trail.slice(trail.indexOf(m)), n, m].join(' -> ')}. A runtime must stop it (section 3.2).`)); }
      else if (!state.has(m)) walk(m, [...trail, n]);
    }
    state.set(n, 2);
  };
  for (const n of names.keys()) if (!state.has(n)) walk(n, []);
  scanSecretsAndSubstitutions(net, '$', out);
  return dedupe(out);
}

/** Validate agent-manifest.json. */
export function validateManifest(man, opts = {}) {
  const out = [];
  if (!isObj(man)) return [err('MANIFEST_NOT_OBJECT', '$', 'agent-manifest.json must be a JSON object.')];
  if (!Array.isArray(man.networks) || man.networks.length === 0) {
    out.push(err('NO_NETWORKS', '$.networks', 'The manifest needs a non-empty "networks" array (section 3.3).'));
  } else {
    const seen = new Set();
    man.networks.forEach((n, i) => {
      const p = `$.networks[${i}]`;
      if (!isObj(n)) { out.push(err('NETWORK_ENTRY_NOT_OBJECT', p, 'Network entry must be an object.')); return; }
      if (!isStr(n.name)) out.push(err('NETWORK_NO_NAME', `${p}.name`, 'Each network entry needs a "name".'));
      else {
        if (!NAME_RE.test(n.name)) out.push(err('NETWORK_NAME_INVALID', `${p}.name`, `"${n.name}" must be usable as the last path segment of a peer URL (letters, digits, _ . -).`));
        if (seen.has(n.name)) out.push(err('DUPLICATE_NETWORK', `${p}.name`, `Network "${n.name}" is listed twice; resolution requires an exact unique match.`));
        seen.add(n.name);
      }
      if (!isStr(n.front_man)) out.push(err('NETWORK_NO_FRONT_MAN', `${p}.front_man`, 'Each network entry needs "front_man", the name of its public entry agent.'));
      if (!isStr(n.hocon)) out.push(err('NETWORK_NO_HOCON', `${p}.hocon`, 'Each network entry needs "hocon", the relative path or URL of the resolved network definition.'));
      else {
        if (/^file:/i.test(n.hocon) || /^\/(Users|home|var|tmp)\//.test(n.hocon) || /^[A-Za-z]:\\/.test(n.hocon)) out.push(err('HOCON_LOCAL_PATH', `${p}.hocon`, 'hocon must be a relative path or http(s) URL, not a local filesystem path.'));
        else if (/^https?:/i.test(n.hocon)) { const u = parseHttpUrl(n.hocon); if (!u) out.push(err('HOCON_BAD_URL', `${p}.hocon`, 'hocon is not a valid URL.')); else { const h = httpsIssue(`${p}.hocon`, u); if (h) out.push(h); } }
        if (/\.hocon$/i.test(n.hocon)) out.push(warn('HOCON_NOT_JSON', `${p}.hocon`, 'Browsers load JSON. Publish the resolved network as .json (section 2.2).'));
      }
    });
  }
  if (man.llm_router === undefined) out.push(warn('NO_LLM_ROUTER', '$.llm_router', 'Top-site LLM router metadata is expected (section 3.3). Add llm_router.base_url (or a documented local router).'));
  else if (!isObj(man.llm_router)) out.push(err('LLM_ROUTER_TYPE', '$.llm_router', 'llm_router must be an object.'));
  else {
    const r = man.llm_router;
    if (r.base_url !== undefined) { const u = parseHttpUrl(String(r.base_url)); if (!u) out.push(err('ROUTER_BAD_URL', '$.llm_router.base_url', 'base_url must be an http(s) URL.')); else { const h = httpsIssue('$.llm_router.base_url', u); if (h) out.push(h); } }
    else if (!r.kind && !r.mock) out.push(warn('ROUTER_NO_BASE_URL', '$.llm_router.base_url', 'No base_url or kind declared for the default router.'));
  }
  if (man.allowed_peers !== undefined) {
    if (!Array.isArray(man.allowed_peers) || !man.allowed_peers.every(isStr)) out.push(err('ALLOWED_PEERS_TYPE', '$.allowed_peers', 'allowed_peers must be an array of origin or site-base strings.'));
    else man.allowed_peers.forEach((a, i) => {
      if (/^https?:/i.test(a)) { const u = parseHttpUrl(a); if (!u) out.push(err('ALLOWED_PEER_BAD', `$.allowed_peers[${i}]`, `"${a}" is not a valid URL.`)); else { const h = httpsIssue(`$.allowed_peers[${i}]`, u); if (h) out.push(h); } }
    });
  }
  if (man.peer_policy === undefined) out.push(warn('NO_PEER_POLICY', '$.peer_policy', 'Declare peer_policy.mode ("open" or "closed") so callers know which peer origins may be contacted.'));
  else if (!isObj(man.peer_policy)) out.push(err('PEER_POLICY_TYPE', '$.peer_policy', 'peer_policy must be an object.'));
  else if (!['open', 'closed'].includes(man.peer_policy.mode)) out.push(warn('PEER_POLICY_MODE', '$.peer_policy.mode', `Unknown mode ${JSON.stringify(man.peer_policy.mode)}; the reference runtime knows "open" and "closed".`));
  if (man.coded_tools !== undefined) {
    const c = man.coded_tools;
    if (!isObj(c) || !isStr(c.module)) out.push(err('CODED_TOOLS_MODULE', '$.coded_tools.module', 'coded_tools needs a "module" path to a self-contained script.'));
    else if (c.sri !== undefined && !SRI_RE.test(String(c.sri))) out.push(err('CODED_TOOLS_SRI', '$.coded_tools.sri', 'sri must look like sha256-<base64>.'));
    else if (c.sri === undefined) out.push(warn('CODED_TOOLS_NO_SRI', '$.coded_tools.sri', 'No SRI digest: the runtime cannot verify the bundle before running it (optional, but recommended).'));
  }
  if (man.actions !== undefined && !isObj(man.actions)) out.push(err('ACTIONS_TYPE', '$.actions', 'actions must be an object.'));
  scanSecretsAndSubstitutions(man, '$', out);
  return dedupe(out);
}

/** Validate links.json (peer-network link map, section 3.3). */
export function validateLinks(links) {
  const out = [];
  if (!isObj(links)) return [err('LINKS_NOT_OBJECT', '$', 'links.json must be a JSON object.')];
  if (links.version !== 1) out.push(err('LINKS_VERSION', '$.version', 'links.json "version" must be 1.'));
  if (!isObj(links.networks)) { out.push(err('LINKS_NETWORKS', '$.networks', '"networks" must be an object mapping network names to link maps.')); return out; }
  for (const [net, map] of Object.entries(links.networks)) {
    if (!isObj(map)) { out.push(err('LINKS_ENTRY', `$.networks.${net}`, 'Each entry must be an object of symbolic name -> peer-network URL.')); continue; }
    for (const [sym, url] of Object.entries(map)) {
      const u = typeof url === 'string' ? parseHttpUrl(url) : null;
      if (!u) out.push(err('LINKS_BAD_URL', `$.networks.${net}.${sym}`, `"${url}" is not an http(s) URL.`));
      else { const h = httpsIssue(`$.networks.${net}.${sym}`, u); if (h) out.push(h); }
    }
  }
  return out;
}

export function detectKind(doc) {
  if (!isObj(doc)) return 'unknown';
  if (Array.isArray(doc.tools)) return 'network';
  if (Array.isArray(doc.networks)) return 'manifest';
  if (isObj(doc.networks) && 'version' in doc) return 'links';
  if (isObj(doc.networks)) return 'links';
  return 'unknown';
}

export function validateDocument(doc, opts = {}) {
  const kind = opts.kind || detectKind(doc);
  if (kind === 'manifest') return { kind, issues: validateManifest(doc, opts) };
  if (kind === 'network') return { kind, issues: validateNetwork(doc, opts) };
  if (kind === 'links') return { kind, issues: validateLinks(doc) };
  return { kind, issues: [err('UNKNOWN_KIND', '$', 'Not recognised as an agent-manifest.json (has "networks" array), a network definition (has "tools" array) or links.json.')] };
}

async function sha(algo, bytes) {
  const d = await globalThis.crypto.subtle.digest(`SHA-${algo}`, bytes);
  let bin = ''; for (const b of new Uint8Array(d)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Validate a whole published site: manifest + every network + links.json + coded-tool digest + CORS.
 * `read(url)` must resolve {text, bytes?, headers: {get(name)}} or throw.
 */
export async function validateSite(read, manifestUrl, opts = {}) {
  const report = { manifestUrl, files: [], issues: [] };
  const add = (file, issues) => { report.files.push({ file, issues }); report.issues.push(...issues.map((i) => ({ ...i, file }))); };
  let res;
  try { res = await read(manifestUrl); } catch (e) { add(manifestUrl, [err('FETCH_FAILED', '$', `Could not fetch manifest: ${e.message}`)]); return finish(report); }
  let man;
  try { man = JSON.parse(res.text); } catch (e) { add(manifestUrl, [err('INVALID_JSON', '$', `Manifest is not valid JSON: ${e.message}`)]); return finish(report); }
  const mu = parseHttpUrl(manifestUrl);
  const mIssues = validateManifest(man, opts);
  if (mu) { const h = httpsIssue('manifest URL', mu); if (h) mIssues.push(h); }
  corsCheck(res, manifestUrl, mIssues, opts);
  add(manifestUrl, mIssues);
  for (const [i, n] of (Array.isArray(man.networks) ? man.networks : []).entries()) {
    if (!isObj(n) || !isStr(n.hocon)) continue;
    const nu = new URL(n.hocon, manifestUrl).href;
    try {
      const r = await read(nu);
      let net;
      try { net = JSON.parse(r.text); } catch (e) { add(nu, [err('INVALID_JSON', '$', `Network "${n.name}" is not valid JSON: ${e.message}`)]); continue; }
      const issues = validateNetwork(net, { frontMan: n.front_man });
      corsCheck(r, nu, issues, opts);
      add(nu, issues);
    } catch (e) { add(nu, [err('FETCH_FAILED', `$.networks[${i}].hocon`, `Could not fetch network definition: ${e.message}`)]); }
  }
  const lu = new URL('links.json', manifestUrl).href;
  try { const r = await read(lu); try { add(lu, validateLinks(JSON.parse(r.text))); } catch (e) { add(lu, [err('INVALID_JSON', '$', e.message)]); } }
  catch { report.files.push({ file: lu, issues: [info('NO_LINKS', '$', 'No links.json published (optional).')] }); }
  if (isObj(man.coded_tools) && isStr(man.coded_tools.module)) {
    const cu = new URL(man.coded_tools.module, manifestUrl).href;
    try {
      const r = await read(cu);
      const issues = [];
      if (SRI_RE.test(String(man.coded_tools.sri || ''))) {
        const [algo, want] = man.coded_tools.sri.split('-');
        const got = await sha(algo.slice(3), r.bytes || new TextEncoder().encode(r.text));
        if (got !== want) issues.push(err('SRI_MISMATCH', '$.coded_tools.sri', `Digest in manifest does not match the fetched bundle (a runtime MUST reject it). Expected ${algo}-${got}.`));
        else issues.push(info('SRI_OK', '$.coded_tools.sri', 'Bundle digest matches the manifest.'));
      }
      add(cu, issues);
    } catch (e) { add(cu, [err('FETCH_FAILED', '$.coded_tools.module', `Could not fetch coded-tool bundle: ${e.message}`)]); }
  }
  return finish(report);
}

function corsCheck(res, url, issues, opts) {
  if (!opts.checkCors || !res.headers) return;
  const v = res.headers.get('access-control-allow-origin');
  if (!v) issues.push(warn('NO_CORS', '$', `${url} sends no Access-Control-Allow-Origin header; browsers on other origins cannot load it (section 3.4).`));
}

function finish(report) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const i of report.issues) c[i.level]++;
  report.counts = c;
  report.ok = c.error === 0;
  return report;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((i) => { const k = `${i.code}|${i.path}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function summarize(issues) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const i of issues) c[i.level]++;
  return { ...c, ok: c.error === 0 };
}

export function formatIssues(issues) {
  const tag = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };
  return issues.map((i) => `  ${tag[i.level]} ${i.code} at ${i.path}\n         ${i.message}`).join('\n');
}
