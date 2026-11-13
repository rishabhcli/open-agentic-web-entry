// Meeting Finder page: wires the runtime to the UI. All dynamic text is set with textContent (peer output is untrusted).
import { boot, runSelfTest, openAiRouter } from './runtime/index.js';
import { createSite } from './actions.js';

const SVG = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); }
  for (const k of kids) n.append(k);
  return n;
};

// Static picture of the published graph. Positions only; behaviour comes from trace events.
const NODES = {
  visitor: { x: 10, y: 140, w: 70, h: 50, label: 'You' },
  meeting_coordinator: { x: 120, y: 140, w: 120, h: 50, label: 'meeting_coordinator' },
  request_parser: { x: 275, y: 40, w: 120, h: 40, label: 'request_parser' },
  page: { x: 275, y: 145, w: 120, h: 40, label: 'this page (actions)' },
  slot_ranker: { x: 275, y: 245, w: 120, h: 40, label: 'slot_ranker' },
  timezone_desk: { x: 440, y: 38, w: 140, h: 34, label: 'timezone_desk' },
  zone_resolver: { x: 440, y: 92, w: 140, h: 34, label: 'zone_resolver' },
  holiday_desk: { x: 440, y: 203, w: 140, h: 34, label: 'holiday_desk' },
  holiday_calendar: { x: 440, y: 257, w: 140, h: 34, label: 'holiday_calendar' },
};
const EDGES = [['visitor', 'meeting_coordinator'], ['meeting_coordinator', 'request_parser'], ['meeting_coordinator', 'page'], ['meeting_coordinator', 'slot_ranker'], ['meeting_coordinator', 'timezone_desk'], ['meeting_coordinator', 'holiday_desk'], ['timezone_desk', 'zone_resolver'], ['holiday_desk', 'holiday_calendar']];

function drawGraph() {
  const g = $('graph');
  g.replaceChildren();
  const mk = (t, a) => { const n = document.createElementNS(SVG, t); for (const [k, v] of Object.entries(a || {})) n.setAttribute(k, v); return n; };
  const defs = mk('defs'); const m = mk('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  m.append(mk('path', { d: 'M0 0L10 5L0 10z' })); defs.append(m); g.append(defs);
  const frame = (x, y, w, h, cls, cap) => { g.append(mk('rect', { x, y, width: w, height: h, rx: 10, class: `site ${cls}` })); const t = mk('text', { x: x + 8, y: y + 12, class: 'cap' }); t.textContent = cap; g.append(t); };
  frame(100, 8, 310, 314, '', 'This site (home): your browser runs these agents');
  frame(425, 8, 170, 134, 'peer', 'Peer site: Time Zone Desk');
  frame(425, 173, 170, 134, 'peer', 'Peer site: Holiday Desk');
  for (const [a, b] of EDGES) {
    const A = NODES[a], B = NODES[b];
    const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2;
    const horiz = x2 > x1 + 4;
    const p = horiz ? mk('line', { x1, y1, x2: x2 - 2, y2 }) : mk('line', { x1: A.x + A.w / 2, y1: A.y + A.h, x2: B.x + B.w / 2, y2: B.y - 2 });
    p.setAttribute('class', 'edge'); p.setAttribute('id', `e-${a}-${b}`); g.append(p);
  }
  for (const [id, n] of Object.entries(NODES)) {
    const grp = mk('g', { class: 'node', id: `n-${id}` });
    grp.append(mk('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 8, class: 'box' }));
    const t = mk('text', { x: n.x + n.w / 2, y: n.y + n.h / 2 }); t.textContent = n.label; grp.append(t);
    g.append(grp);
  }
}
const mark = (id, cls, clear) => { const n = document.getElementById(`n-${id}`) || document.getElementById(`e-${id}`); if (!n) return; if (clear) n.classList.remove(...clear); n.classList.add(cls); };
function graphEvent(ev) {
  const rm = ['active', 'done', 'fail'];
  if (ev.type === 'agent-call') { mark(ev.to, 'active', rm); mark(`${ev.from}-${ev.to}`, 'active', rm); }
  else if (ev.type === 'agent-result') { mark(ev.from, 'done', rm); mark(`${ev.to}-${ev.from}`, 'done', rm); }
  else if (ev.type === 'action') { mark('page', ev.status === 'succeeded' ? 'done' : 'fail', rm); mark(`${ev.from}-page`, 'done', rm); }
  else if (ev.type === 'peer-denied' || ev.type === 'error') { /* shown in log and result */ }
}

export async function mount(opts = {}) {
  drawGraph();
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  let lastBoard = null;
  let byokKey = '';
  const decisions = new Map();

  // ---------- dialog ----------
  const dlg = $('dlg');
  function ask({ title, body, detail, buttons, cancelValue }) {
    return new Promise((resolve) => {
      $('dlg-title').textContent = title; $('dlg-body').textContent = body; $('dlg-detail').textContent = detail || ''; $('dlg-detail').hidden = !detail;
      const box = $('dlg-buttons'); box.replaceChildren();
      const done = (v) => { dlg.removeEventListener('cancel', onCancel); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); resolve(v); };
      const onCancel = (e) => { e.preventDefault(); done(cancelValue); };
      dlg.addEventListener('cancel', onCancel);
      for (const b of buttons) { const btn = el('button', { type: 'button', class: b.primary ? 'primary' : '', text: b.label }); btn.addEventListener('click', () => done(b.value)); box.append(btn); }
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      box.firstChild.focus();
    });
  }
  const consent = (r) => ask({
    title: 'Allow this agent site to run?', cancelValue: 'deny',
    body: `"${r.label}" at ${r.origin} wants to run its agent network inside your browser for ${r.from}. Its files are fetched without your cookies. Your API key (if any) is never sent to it.`,
    detail: `Network: ${r.network}\nSite: ${r.base}\nRequest sent (first 140 chars): ${r.preview}`,
    buttons: [{ label: 'Deny', value: 'deny' }, { label: 'Allow once', value: 'allow', primary: true }, { label: 'Allow for this session', value: 'always' }],
  });
  const confirm = (r) => ask({
    title: 'Confirm: write to your device', cancelValue: false,
    body: `The agent wants to run "${r.action}" (effect: ${r.effect}) on ${r.origin || 'this page'}. Nothing happens unless you confirm.`,
    detail: JSON.stringify(r.args, null, 2),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Download file', value: true, primary: true }],
  });

  // ---------- messages ----------
  let seen = 0;
  const logEl = $('log');
  const LABEL = { 'agent-call': 'call', 'agent-result': 'result', 'tool-call': 'tool', 'tool-result': 'tool result', 'peer-call': 'peer', consent: 'consent', 'peer-denied': 'denied', confirm: 'confirm', action: 'action', 'llm-request': 'llm', error: 'error', 'tool-error': 'tool error', 'run-start': 'start', 'run-end': 'end' };
  function logEvent(ev) {
    $('log-empty').hidden = true;
    const { seq, t, type, run, ...rest } = ev;
    const who = rest.from || rest.agent ? `${rest.from || rest.agent}${rest.to ? ' \u2192 ' + rest.to : ''}` : (rest.to || rest.action || rest.network || '');
    const head = el('div', {}, el('span', { class: 't', text: `#${seq} +${t}ms` }), el('span', { class: `badge ${type}`, text: LABEL[type] || type }), el('span', { text: who }));
    const det = el('details', {}, el('summary', { text: 'details' }), el('pre', { text: JSON.stringify(rest, null, 2) }));
    logEl.append(el('li', {}, head, det));
    $('log-empty').hidden = true;
    logEl.scrollTop = logEl.scrollHeight;
    $('graph-log').append(el('li', { text: `${LABEL[type] || type} ${who}` }));
    seen++;
    graphEvent(ev);
    if (type === 'consent') { decisions.set(rest.base, rest.decision); renderPeers(); }
  }

  const ui = {
    getState: () => ({ request_text: $('request').value, router: runtime.routerInfo().label }),
    showResult: (r) => renderResult(r),
    download: (name, text, type) => {
      const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
      const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    now: () => new Date().toISOString(),
  };
  const site = createSite(ui);
  site.registerWebMCP();
  const runtime = opts.runtime || boot({ baseUrl: opts.baseUrl, fetcher: opts.fetcher, sandboxFactory: opts.sandboxFactory || undefined, actions: site, consent, confirm, onTrace: logEvent, askSameOrigin: true });
  if (opts.runtime) { runtime.actions = site; runtime.consent = consent; runtime.confirm = confirm; runtime.onTrace = logEvent; }
  let manifest;
  try { manifest = (await runtime.loadHome()).manifest; }
  catch (e) { $('status').textContent = `Could not load this site's manifest: ${e.message}`; }

  // ---------- tabs ----------
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const select = (t, focus) => { for (const x of tabs) { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; $(x.getAttribute('aria-controls')).hidden = !on; } if (focus) t.focus(); };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); } if (e.key === 'Home') select(tabs[0], true); if (e.key === 'End') select(tabs[tabs.length - 1], true); });
  });

  // ---------- results ----------
  function renderResult(r) {
    const box = $('result'); box.replaceChildren();
    if (!r) return;
    const parts = [];
    parts.push(el('p', { class: r.ok ? '' : 'note', text: r.summary || 'No summary.' }));
    if (r.participants && r.ok) {
      (r.slots || []).forEach((s, i) => {
        const tbl = el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['Person', 'City', 'Local time', 'Note'].map((h) => el('th', { text: h })))));
        const body = el('tbody');
        for (const l of s.locals) body.append(el('tr', {}, el('td', { text: l.name }), el('td', { text: l.city }), el('td', { text: `${l.weekday} ${l.date} ${l.start}-${l.end} ${l.zone}` }), el('td', { text: l.note })));
        tbl.append(body);
        const exp = el('button', { type: 'button', class: 'chip', 'aria-label': `Export option ${i + 1} as a calendar file`, text: 'Export .ics' });
        exp.addEventListener('click', async () => {
          const res = await site.call('export_ics', { slot_index: i, title: 'Meeting' }, { confirm, origin: location.origin, context: { blackboard: lastBoard } });
          $('status').textContent = res.status === 'succeeded' ? `Saved ${res.result.file}` : `Export ${res.status}: ${res.reason || ''}`;
        });
        parts.push(el('article', { class: `slot${i === 0 ? ' best' : ''}` }, el('h3', {}, el('span', { text: `Option ${i + 1}` }), ...(i === 0 ? [el('span', { class: 'tag-best', text: 'best' })] : []), el('span', { class: 'muted small', text: `${s.start_utc.replace('T', ' ').slice(0, 16)} UTC` }), exp), tbl));
      });
    }
    box.append(...parts);
  }

  function renderPeers() {
    const ul = $('peer-list'); ul.replaceChildren();
    for (const raw of (manifest && manifest.allowed_peers) || []) {
      const u = runtime._mapUrl(raw);
      const d = decisions.get(u);
      ul.append(el('li', { text: `${u}  \u2014 ${d === 'always' ? 'allowed for this session' : d === 'allow' ? 'allowed once' : d === 'deny' ? 'denied' : 'not contacted yet'}` }));
    }
    if (!ul.children.length) ul.append(el('li', { class: 'muted', text: 'No peers declared.' }));
  }
  renderPeers();

  // ---------- run ----------
  async function runRequest(text) {
    const go = $('go'); const status = $('status');
    if (!text.trim()) { status.textContent = 'Type a request first.'; $('request').focus(); return null; }
    go.disabled = true; status.textContent = 'Running agents...'; $('result').replaceChildren();
    drawGraph(); $('graph-log').replaceChildren();
    const res = await runtime.run({ request: text }, { sly: { private_note: $('sly').value } });
    go.disabled = false;
    lastBoard = res.blackboard;
    if (res.ok) {
      const out = res.output || {};
      const ranked = res.blackboard && res.blackboard.slot_ranker;
      if (ranked) renderResult(ranked.ok ? { ...ranked, summary: out.answer || ranked.summary } : ranked);
      else renderResult({ ok: false, summary: out.answer || out.summary || 'Done.' });
      status.textContent = `Done in ${res.stats.ms} ms: ${res.stats.agentCalls} agent calls, ${res.stats.remoteCalls} peer sites.`;
    } else {
      const box = $('result'); box.replaceChildren(el('div', { class: 'alert', role: 'alert' }, el('strong', { text: `Stopped (${res.error.code}). ` }), el('span', { text: res.error.message })));
      status.textContent = 'The run was stopped. Nothing was guessed.';
    }
    return res;
  }
  $('ask-form').addEventListener('submit', (e) => { e.preventDefault(); runRequest($('request').value); });
  document.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => { $('request').value = b.dataset.example; $('request').focus(); }));
  $('clear-log').addEventListener('click', () => { logEl.replaceChildren(); $('log-empty').hidden = false; });

  // ---------- peers tab ----------
  $('ask-same').addEventListener('change', (e) => { runtime.askSameOrigin = e.target.checked; });
  $('forget').addEventListener('click', () => { runtime.forgetConsent(); decisions.clear(); renderPeers(); });
  const tryPeer = async (url) => { $('try-out').textContent = 'Working...'; const r = await runtime.callPeer(url, {}); $('try-out').textContent = r.ok ? 'It ran (unexpected).' : `${r.error.code}: ${r.error.message}`; };
  $('try-evil').addEventListener('click', () => tryPeer('https://evil.example/x/holiday_desk'));
  $('try-missing').addEventListener('click', () => tryPeer(`${runtime.baseUrl}sites/holidays/holiday_desk_missing`));

  // ---------- model tab ----------
  const form = $('model-form');
  const setFields = () => { $('byok-fields').hidden = form.elements.router.value !== 'openai'; };
  form.addEventListener('change', setFields);
  $('preset-ollama').addEventListener('click', () => { $('base').value = 'http://localhost:11434/v1'; $('model').focus(); });
  $('delete-key').addEventListener('click', () => { if (storage) storage.removeItem('maw.byok'); byokKey = ''; $('key').value = ''; runtime.setRouter(null); form.elements.router.value = 'local'; setFields(); $('model-status').textContent = 'Saved key deleted. Using the built-in router.'; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const st = $('model-status');
    if (form.elements.router.value === 'local') { runtime.setRouter(null); st.textContent = 'Using the built-in deterministic router.'; return; }
    try {
      if ($('key').value) byokKey = $('key').value;
      const router = openAiRouter({ baseUrl: $('base').value.trim(), model: $('model').value.trim(), getKey: () => byokKey });
      runtime.setRouter(router);
      if ($('remember').checked && storage) storage.setItem('maw.byok', JSON.stringify({ baseUrl: router.baseUrl, model: router.model, key: byokKey })); else if (storage) storage.removeItem('maw.byok');
      $('key').value = '';
      st.textContent = `The front agent now uses ${router.baseUrl} / ${router.model}. Key ${byokKey ? 'held in memory only' + ($('remember').checked ? ' and saved on this device' : '') : 'not set (fine for local servers)'}.`;
    } catch (err) { st.textContent = err.message; }
  });
  try {
    const saved = storage && JSON.parse(storage.getItem('maw.byok') || 'null');
    if (saved && saved.baseUrl) { $('base').value = saved.baseUrl; $('model').value = saved.model || ''; byokKey = saved.key || ''; $('remember').checked = true; form.elements.router.value = 'openai'; setFields(); runtime.setRouter(openAiRouter({ baseUrl: saved.baseUrl, model: saved.model, getKey: () => byokKey })); $('model-status').textContent = 'Restored your saved router settings.'; }
  } catch { /* ignore corrupt storage */ }

  // ---------- self-test ----------
  $('run-test').addEventListener('click', async () => {
    const tb = $('test-table').querySelector('tbody'); tb.replaceChildren(); $('test-table').hidden = false; $('test-status').textContent = 'Running...';
    const rows = await runSelfTest((r) => tb.append(el('tr', {}, el('td', { class: r.pass ? 'pass' : 'fail', text: r.pass ? 'PASS' : 'FAIL' }), el('td', { text: `${r.title} (spec ${r.spec})` }), el('td', { text: r.detail || '' }))));
    $('test-status').textContent = `${rows.filter((r) => r.pass).length} of ${rows.length} checks passed.`;
  });

  return { runtime, runRequest, site, select };
}

if (typeof window !== 'undefined' && !window.__MAW_NO_AUTOSTART) mount();
