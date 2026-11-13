import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVmSandbox } from '../tools/node-host.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const load = async (rel) => createVmSandbox(await readFile(path.join(ROOT, rel), 'utf8'));
const hol = await load('sites/holidays/coded-tools.js');
const tz = await load('sites/timezones/coded-tools.js');
const sched = await load('coded-tools.js');
const dates = (r, cc) => r.holidays[cc].map((h) => h.date);

test('US federal holidays 2025 match the published statutory calendar', async () => {
  const r = await hol.call('holidays_between', { countries: ['US'], from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(dates(r, 'US'), ['2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-12-25']);
});

test('US 2026: Saturday July 4 is observed on Friday July 3', async () => {
  const r = await hol.call('holidays_between', { countries: ['US'], from: '2026-06-01', to: '2026-07-31' });
  assert.deepEqual(r.holidays.US.map((h) => [h.date, h.name]), [['2026-06-19', 'Juneteenth National Independence Day'], ['2026-07-03', 'Independence Day (observed)']]);
});

test('GB (England and Wales) 2025 and 2026 bank holidays', async () => {
  const a = await hol.call('holidays_between', { countries: ['GB'], from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(dates(a, 'GB'), ['2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26']);
  const b = await hol.call('holidays_between', { countries: ['GB'], from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(dates(b, 'GB'), ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
});

test('GB Christmas substitutes: 2027 (Sat) -> Mon 27 and Tue 28; 2022 (Sun) -> Mon 26 and Tue 27', async () => {
  assert.deepEqual(dates(await hol.call('holidays_between', { countries: ['GB'], from: '2027-12-20', to: '2027-12-31' }), 'GB'), ['2027-12-27', '2027-12-28']);
  assert.deepEqual(dates(await hol.call('holidays_between', { countries: ['GB'], from: '2022-12-20', to: '2022-12-31' }), 'GB'), ['2022-12-26', '2022-12-27']);
});

test('holiday tool reports unsupported countries and bad input instead of guessing', async () => {
  const r = await hol.call('holidays_between', { countries: ['IN', 'us'], from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(r.unsupported, ['IN']);
  assert.deepEqual(dates(r, 'US'), ['2026-11-11', '2026-11-26']);
  assert.equal((await hol.call('holidays_between', { countries: ['US'], from: 'x', to: 'y' })).ok, false);
  assert.equal((await hol.call('holidays_between', { from: '2026-01-01', to: '2026-01-02' })).ok, false);
});

test('time zones: sample cities, aliases, IANA ids, DST-dependent offsets', async () => {
  const r = await tz.call('resolve_cities', { cities: ['Chicago', 'bangalore', 'São Paulo', 'Europe/Paris', 'Atlantis'], on: '2026-01-15' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ['Atlantis']);
  const by = Object.fromEntries(r.resolved.map((x) => [x.input, x]));
  assert.equal(by.Chicago.utc_offset_minutes, -360);
  assert.equal(by.bangalore.city, 'Bengaluru');
  assert.equal(by.bangalore.utc_offset_minutes, 330);
  assert.equal(by['São Paulo'].iana, 'America/Sao_Paulo');
  assert.equal(by['Europe/Paris'].country, null);
  const summer = await tz.call('resolve_cities', { cities: ['Chicago', 'London'], on: '2026-07-15' });
  assert.deepEqual(summer.resolved.map((x) => x.utc_offset_minutes), [-300, 60]);
  // US DST started 2026-03-08, UK on 2026-03-29: the gap is 4h in between, 5h otherwise
  const gap = await tz.call('resolve_cities', { cities: ['Chicago', 'London'], on: '2026-03-15' });
  assert.deepEqual(gap.resolved.map((x) => x.utc_offset_minutes), [-300, 0]);
});

const P = (text, today = '2026-11-12') => sched.call('parse_request', { text, today });

test('parse_request: people, duration, ISO and month-day ranges, hours', async () => {
  const r = await P('30 min with Ana in London, Ravi in Bengaluru and me in Chicago between Nov 16 and Nov 20');
  assert.equal(r.ok, true);
  assert.deepEqual(r.participants, [{ name: 'Ana', city: 'London' }, { name: 'Ravi', city: 'Bengaluru' }, { name: 'You', city: 'Chicago' }]);
  assert.equal(r.organizer, 'You');
  assert.equal(r.duration_minutes, 30);
  assert.deepEqual([r.from, r.to], ['2026-11-16', '2026-11-20']);
  assert.deepEqual(r.hours, { start: 9, end: 18 });
  const r2 = await P('1 hour with Sam in New York and Lee in Hong Kong 2026-12-01 to 2026-12-04, working hours 8-20');
  assert.deepEqual(r2.participants.map((p) => p.city), ['New York', 'Hong Kong']);
  assert.equal(r2.duration_minutes, 60);
  assert.deepEqual([r2.from, r2.to, r2.hours.start, r2.hours.end], ['2026-12-01', '2026-12-04', 8, 20]);
  const r3 = await P('45 minutes with Kim in Tokyo and I in Berlin Dec 3-5 9am-5pm');
  assert.deepEqual([r3.from, r3.to, r3.hours.start, r3.hours.end, r3.duration_minutes], ['2026-12-03', '2026-12-05', 9, 17, 45]);
});

test('parse_request: relative dates are resolved from the supplied today (2026-11-12 is a Thursday)', async () => {
  const r = await P('with Ana in London and me in Chicago next week');
  assert.deepEqual([r.from, r.to], ['2026-11-16', '2026-11-20']);
  assert.ok(r.assumptions.some((a) => /next week/.test(a)));
  const t = await P('30 min with Ana in London and me in Chicago tomorrow');
  assert.deepEqual([t.from, t.to], ['2026-11-13', '2026-11-13']);
  const y = await P('with Ana in London and me in Chicago Jan 4 to Jan 8');
  assert.deepEqual([y.from, y.to], ['2027-01-04', '2027-01-08']);
});

test('parse_request: unclear requests produce problems, never guesses', async () => {
  const r = await P('lunch sometime');
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /at least two people/.test(p)));
  assert.equal((await P('')).ok, false);
  assert.equal((await sched.call('parse_request', { text: 'x' })).ok, false);
  const long = await P('9 hours with Ana in London and me in Chicago');
  assert.equal(long.ok, false);
});

async function plan(text, today = '2026-11-12', overrides) {
  const parsed = await P(text, today);
  const zones = await tz.call('resolve_cities', { cities: parsed.cities, on: parsed.from });
  const holidays = await hol.call('holidays_between', { countries: zones.countries, from: parsed.from, to: parsed.to });
  return sched.call('rank_slots', { parsed, zones, holidays, overrides });
}

test('rank_slots: Chicago + London, first week of Dec 2026, every slot is inside both working days', async () => {
  const r = await plan('30 min with Ana in London and me in Chicago between Dec 1 and Dec 4');
  assert.equal(r.ok, true);
  assert.equal(r.relaxed, null);
  for (const s of r.slots) for (const l of s.locals) {
    assert.ok(l.start >= '09:00' && l.end <= '18:00', `${l.name} ${l.start}-${l.end}`);
    assert.ok(!['Sat', 'Sun'].includes(l.weekday));
  }
  assert.equal(r.slots[0].locals.find((l) => l.name === 'Ana').start, '16:00'); // balanced: London 16:00 = Chicago 10:00 (6h apart in December)
});

test('rank_slots skips public holidays per person (US Thanksgiving, GB Christmas)', async () => {
  const a = await plan('30 min with Ana in New York and me in Chicago Nov 26 to Nov 27');
  assert.ok(a.slots.every((s) => s.locals.every((l) => l.date !== '2026-11-26')));
  assert.ok(a.excluded_days.some((h) => h.date === '2026-11-26' && h.country === 'US'));
  const b = await plan('30 min with Ana in London and Tom in Dublin Dec 25 to Dec 25', '2026-11-12');
  assert.equal(b.ok, false);
  assert.match(b.summary, /No 30-minute slot/);
});

test('rank_slots honours DST differences between countries', async () => {
  const mar = await plan('30 min with Ana in London and me in Chicago on Mar 10', '2026-03-01');
  const bestMar = mar.slots[0].locals.find((l) => l.name === 'Ana').start;
  const feb = await plan('30 min with Ana in London and me in Chicago on Feb 10', '2026-02-01');
  const bestFeb = feb.slots[0].locals.find((l) => l.name === 'Ana').start;
  // 6h apart in Feb: best London 16:00. On Mar 10 the US is already on DST (5h apart) and the 15:30/16:00 tie goes to the earlier slot
  assert.equal(bestFeb, '16:00');
  assert.equal(bestMar, '15:30');
});

test('rank_slots widens hours transparently when nothing fits, and says so', async () => {
  const r = await plan('30 min with Ana in London, Ravi in Bengaluru and me in Chicago between Nov 16 and Nov 20');
  assert.equal(r.ok, true);
  assert.deepEqual(r.relaxed.from, { start: 9, end: 18 });
  assert.deepEqual(r.relaxed.to, { start: 7, end: 20 });
  assert.match(r.summary, /working hours were widened/);
  const strict = await plan('30 min with Ana in London, Ravi in Bengaluru and me in Chicago between Nov 16 and Nov 20', '2026-11-12', { no_relax: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.blockers.Ravi.hours > 0);
});

test('rank_slots refuses unknown cities and unparsed requests with a clear message', async () => {
  const r = await plan('30 min with Ana in Atlantis and me in Chicago Nov 16');
  assert.equal(r.ok, false);
  assert.match(r.summary, /Unknown place/);
  const bad = await plan('hello');
  assert.equal(bad.ok, false);
});

test('determinism: the same input gives byte-identical output, 5 times', async () => {
  const text = '45 min with Priya in New York, Tom in London and Dana in Dublin between 2026-12-21 and 2026-12-31';
  const first = JSON.stringify(await plan(text));
  for (let i = 0; i < 4; i++) assert.equal(JSON.stringify(await plan(text)), first);
});
