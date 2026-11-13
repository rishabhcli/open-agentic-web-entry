#!/usr/bin/env node
// Headless run of the published network (no browser): node tools/run.mjs "30 min with Ana in London and me in Chicago" [--today 2026-11-12] [--trace]
import { createNodeRuntime } from './node-host.mjs';
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const today = flag('--today');
const trace = args.includes('--trace');
const text = args.filter((a) => !a.startsWith('--')).join(' ');
if (!text) { console.log('usage: node tools/run.mjs "<request>" [--today YYYY-MM-DD] [--trace]'); process.exit(2); }
const rt = createNodeRuntime();
const r = await rt.run({ request: text, ...(today ? { today } : {}) });
if (trace) for (const e of r.trace) console.log(`#${e.seq} ${e.type} ${e.from || ''}${e.to ? ' -> ' + e.to : ''}`);
if (!r.ok) { console.log(`STOPPED ${r.error.code}: ${r.error.message}`); process.exit(1); }
console.log(r.output.summary);
(r.output.slots || []).forEach((s, i) => { console.log(`\nOption ${i + 1} (${s.start_utc})`); for (const l of s.locals) console.log(`  ${l.name.padEnd(8)} ${l.city.padEnd(14)} ${l.weekday} ${l.date} ${l.start}-${l.end} ${l.zone} ${l.note}`); });
