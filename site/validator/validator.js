import { validateSite, validateDocument, summarize } from '../lib/validator-core.js';
const $ = (id) => document.getElementById(id);
const el = (t, p = {}, ...k) => { const n = document.createElement(t); for (const [a, v] of Object.entries(p)) a === 'class' ? (n.className = v) : a === 'text' ? (n.textContent = v) : n.setAttribute(a, v); n.append(...k); return n; };

const BROKEN = { metadata: { description: 'broken sample' }, tools: [
  { name: 'front', function: { description: 'entry' }, instructions: 'x', tools: ['helper', 'missing_agent', 'http://peer.example/net'] },
  { name: 'helper', instructions: 'no function description', tools: ['front'] },
  { name: 'helper', function: { description: 'duplicate name' }, instructions: 'Authorization key sk-abcdefghijklmnopqrstuvwxyz012345', tools: [] },
] };

function section(file, issues) {
  const s = summarize(issues);
  const box = el('section', { class: 'slot' }, el('h3', {}, el('span', { text: file }), el('span', { class: 'muted small', text: `${s.error} errors, ${s.warn} warnings, ${s.info} notes` })));
  if (!issues.length) box.append(el('p', { class: 'pass', text: 'No issues.' }));
  const ul = el('ul', { class: 'plain' });
  for (const i of issues) ul.append(el('li', {}, el('span', { class: `badge ${i.level === 'error' ? 'error' : i.level === 'warn' ? 'consent' : ''}`, text: i.level.toUpperCase() }), el('code', { text: `${i.code} ${i.path}` }), el('div', { text: i.message })));
  box.append(ul);
  return box;
}
function show(files, issues) {
  const s = summarize(issues);
  $('summary').textContent = `${s.ok ? 'CONFORMS' : 'DOES NOT CONFORM'}: ${s.error} errors, ${s.warn} warnings, ${s.info} notes`;
  $('summary').className = s.ok ? 'pass' : 'fail';
  $('report').replaceChildren(...files.map((f) => section(f.file, f.issues)));
}
async function read(url) {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { text: new TextDecoder().decode(bytes), bytes, headers: r.headers };
}
async function site(url) {
  $('summary').textContent = 'Checking...';
  if (!/agent-manifest\.json$/.test(url)) url = url.replace(/\/?$/, '/') + 'agent-manifest.json';
  try { const rep = await validateSite(read, url, { checkCors: false }); show(rep.files, rep.issues); }
  catch (e) { $('summary').textContent = `Could not validate: ${e.message}`; $('summary').className = 'fail'; }
}
function doc(text, name) {
  let j; try { j = JSON.parse(text); } catch (e) { $('summary').textContent = `Not valid JSON: ${e.message}`; $('summary').className = 'fail'; $('report').replaceChildren(); return; }
  const r = validateDocument(j); show([{ file: `${name} (${r.kind})`, issues: r.issues }], r.issues);
}
$('url-form').addEventListener('submit', (e) => { e.preventDefault(); if ($('url').value.trim()) site($('url').value.trim()); });
$('own').addEventListener('click', () => site(new URL('../agent-manifest.json', location.href).href));
$('check').addEventListener('click', () => doc($('paste').value, 'pasted JSON'));
$('broken').addEventListener('click', () => { $('paste').value = JSON.stringify(BROKEN, null, 2); doc($('paste').value, 'broken example'); });
$('file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { const t = await f.text(); $('paste').value = t; doc(t, f.name); } });
