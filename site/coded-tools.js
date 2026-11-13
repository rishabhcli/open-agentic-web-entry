// Coded-tool bundle for the "meeting_coordinator" network (Meeting Finder). Pure, deterministic functions:
// the same input always yields the same output. No network, no DOM, no clock (the caller passes `today`).
(function (g) {
  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const isoOf = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const addDays = (iso, n) => isoOf(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
  const wdayOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

  // ---------- parse_request ----------
  const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const to24 = (h, m, ap) => { h = +h; if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } return h + (m ? +m / 60 : 0); };

  function parse_request(args) {
    const { text, today } = args || {};
    if (typeof text !== 'string' || !text.trim()) return { ok: false, problems: ['Describe the meeting, for example: "30 minutes with Ana in London and me in Chicago next week".'] };
    if (!validDate(today)) return { ok: false, problems: ['parse_request needs today as YYYY-MM-DD'] };
    const assumptions = [], problems = [];
    let work = text;

    // participants: "<Name|me|I> in <City or IANA zone>"
    const CITY = "([A-Z][A-Za-z.'\\u00C0-\\u017F-]*(?:\\s+[A-Z][A-Za-z.'\\u00C0-\\u017F-]*){0,2}|[A-Za-z_]+\\/[A-Za-z_\\/+-]+)";
    const re = new RegExp("\\b([A-Z][a-z'\\u2019-]+|[Mm]e|I)\\s+(?:in|from|at)\\s+" + CITY, 'g');
    const participants = [];
    for (const m of work.matchAll(re)) {
      let name = m[1];
      if (/^(me|i)$/i.test(name)) name = 'You';
      const city = m[2].trim().replace(/[.,]+$/, '').replace(/\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?$/, '').replace(/\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Next|This|Tomorrow|Today)$/, '');
      if (!participants.some((p) => p.name === name && p.city === city)) participants.push({ name, city });
    }
    if (participants.length < 2) problems.push('Name at least two people with their city, like "Ana in London and me in Chicago".');
    const names = participants.map((p) => p.name);
    if (new Set(names).size !== names.length) problems.push('Each person should appear once (found a repeated name).');
    if (participants.length > 8) problems.push('At most 8 people are supported.');
    const organizer = (participants.find((p) => p.name === 'You') || participants[0] || {}).name;

    // duration
    let duration = 30;
    const dm = text.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)\b/i);
    if (/\bhalf an hour\b/i.test(text)) duration = 30;
    else if (/\b(an|one)\s+hour\b/i.test(text)) duration = 60;
    else if (dm) duration = Math.round(+dm[1] * (/^h/i.test(dm[2]) ? 60 : 1));
    else assumptions.push('No duration given: assumed 30 minutes.');
    if (duration < 15 || duration > 240) { problems.push('Duration must be between 15 and 240 minutes.'); duration = Math.min(240, Math.max(15, duration)); }

    // hours
    let hours = { start: 9, end: 18 };
    const h1 = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|\u2013|to|and|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const h2 = text.match(/hours?\s*(?:of\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:-|\u2013|to|and)\s*(\d{1,2})(?::(\d{2}))?/i);
    if (h1) hours = { start: to24(h1[1], h1[2], h1[3]), end: to24(h1[4], h1[5], h1[6]) };
    else if (h2) hours = { start: to24(h2[1], h2[2]), end: to24(h2[3], h2[4]) };
    else assumptions.push('No working hours given: assumed 09:00 to 18:00 local time for everyone.');
    if (!(hours.start >= 0 && hours.end <= 24 && hours.end - hours.start >= duration / 60)) { problems.push('Working hours must leave room for the meeting.'); hours = { start: 9, end: 18 }; }

    // dates
    const year = +today.slice(0, 4);
    const mk = (mi, d) => { let y = year; let s = `${y}-${pad(mi + 1)}-${pad(d)}`; if (s < today) { y += 1; s = `${y}-${pad(mi + 1)}-${pad(d)}`; } return validDate(s) ? s : null; };
    let from = null, to = null;
    const isos = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    const mr = text.match(new RegExp('\\b' + MON_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|\\u2013|to|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?::|am|pm))', 'i'));
    const mds = [...text.matchAll(new RegExp('\\b' + MON_RE + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?::|am|pm|min))', 'gi'))];
    if (isos.length >= 1 && isos.every(validDate)) { from = isos[0]; to = isos[1] || isos[0]; }
    else if (mr) { const mi = MONTHS.indexOf(mr[1].slice(0, 3).toLowerCase()); from = mk(mi, +mr[2]); to = from && mk(mi, +mr[3]); if (to && to < from) to = null; }
    else if (mds.length) { const f = mds[0]; from = mk(MONTHS.indexOf(f[1].slice(0, 3).toLowerCase()), +f[2]); const l = mds[1] || f; to = mk(MONTHS.indexOf(l[1].slice(0, 3).toLowerCase()), +l[2]); }
    else if (/\bnext week\b/i.test(text)) { const w = wdayOf(today); const delta = ((8 - w) % 7) || 7; from = addDays(today, delta); to = addDays(from, 4); assumptions.push(`"next week" read as Monday ${from} to Friday ${to}.`); }
    else if (/\bthis week\b/i.test(text)) { from = today; const w = wdayOf(today); to = addDays(today, w >= 1 && w <= 5 ? 5 - w : 0); assumptions.push(`"this week" read as ${from} to ${to}.`); }
    else if (/\btomorrow\b/i.test(text)) { from = to = addDays(today, 1); }
    else if (/\btoday\b/i.test(text)) { from = to = today; }
    else { from = addDays(today, 1); to = addDays(from, 6); assumptions.push(`No dates given: searching the next 7 days (${from} to ${to}).`); }
    if (!from || !to || to < from) { problems.push('Could not read the date range. Use "Nov 16 to Nov 20" or "2026-11-16 to 2026-11-20".'); from = from || addDays(today, 1); to = to && to >= from ? to : addDays(from, 6); }
    if (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z') > 30 * 86400000) { problems.push('Date range is limited to 31 days.'); to = addDays(from, 30); }

    return { ok: problems.length === 0, participants, organizer, cities: participants.map((p) => p.city), from, to, duration_minutes: duration, hours, assumptions, problems };
  }

  // ---------- rank_slots ----------
  const fmts = {};
  function lp(iana, ms) {
    const f = fmts[iana] || (fmts[iana] = new Intl.DateTimeFormat('en-US', { timeZone: iana, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }));
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, wd: o.weekday };
  }
  const abbrFmts = {};
  function abbr(iana, ms) {
    const f = abbrFmts[iana] || (abbrFmts[iana] = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'short' }));
    return f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName').value;
  }
  const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

  function search(people, holSet, p, hours) {
    const step = 30 * 60000, dur = p.duration_minutes * 60000;
    const orgIana = people.find((x) => x.name === p.organizer).iana;
    const t0 = Date.parse(p.from + 'T00:00:00Z') - 15 * 3600000, t1 = Date.parse(p.to + 'T00:00:00Z') + 39 * 3600000;
    const hs = Math.round(hours.start * 60), he = Math.round(hours.end * 60);
    const found = [], why = {};
    for (const x of people) why[x.name] = { weekend: 0, holiday: 0, hours: 0 };
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const o = lp(orgIana, t);
      if (o.date < p.from || o.date > p.to) continue;
      let ok = true; const locals = [];
      for (const x of people) {
        const a = lp(x.iana, t), b = lp(x.iana, t + dur);
        let bad = null;
        if (a.wd === 'Sat' || a.wd === 'Sun') bad = 'weekend';
        else if ((holSet[x.country] || {})[a.date]) bad = 'holiday';
        else if (a.date !== b.date || a.min < hs || a.min + p.duration_minutes > he) bad = 'hours';
        if (bad) { why[x.name][bad]++; ok = false; } else locals.push({ x, a });
      }
      if (!ok) continue;
      const pain = locals.map(({ a }) => { const mid = a.min + p.duration_minutes / 2; const c = (hs + he) / 2; const half = (he - hs) / 2; return Math.pow(Math.abs(mid - c) / half, 2); });
      const score = Math.round((pain.reduce((s, v) => s + v, 0) / pain.length + Math.max(...pain) * 0.5) * 10000) / 10000;
      found.push({
        start_utc: new Date(t).toISOString(), end_utc: new Date(t + dur).toISOString(), score,
        locals: locals.map(({ x, a }, i) => ({
          name: x.name, city: x.city, iana: x.iana, date: a.date, weekday: a.wd, start: hm(a.min), end: hm(a.min + p.duration_minutes), zone: abbr(x.iana, t),
          note: a.min < hs + 60 ? 'early in the day' : a.min + p.duration_minutes > he - 60 ? 'late in the day' : '',
        })),
      });
    }
    found.sort((a, b) => a.score - b.score || (a.start_utc < b.start_utc ? -1 : 1));
    // at most 2 per organizer day first, then fill
    const perDay = {}, top = [], rest = [];
    for (const s of found) { const d = s.locals.find((l) => l.name === p.organizer).date; perDay[d] = (perDay[d] || 0) + 1; (perDay[d] <= 2 ? top : rest).push(s); }
    return { slots: top.concat(rest).slice(0, p.top || 5), why, candidates: found.length };
  }

  function rank_slots(args) {
    const { parsed, zones, holidays, overrides } = args || {};
    if (!parsed || !parsed.ok) return { ok: false, slots: [], summary: `Cannot rank slots yet. ${(parsed && parsed.problems || ['The request was not understood.']).join(' ')}`, problems: parsed ? parsed.problems : ['no parsed request'] };
    if (!zones || !Array.isArray(zones.resolved)) return { ok: false, slots: [], summary: 'Time zones were not resolved.', problems: ['no zone data'] };
    if (zones.unknown && zones.unknown.length) return { ok: false, slots: [], summary: `Unknown place(s): ${zones.unknown.join(', ')}. Use a city from the sample list or an IANA zone id like "Europe/Paris".`, problems: ['unknown cities'] };
    const p = { ...parsed, ...(overrides || {}) };
    if (overrides && overrides.hours) p.hours = overrides.hours;
    const byCity = new Map(zones.resolved.map((r) => [r.input, r]));
    const people = parsed.participants.map((x) => { const r = byCity.get(x.city); return r ? { name: x.name, city: x.city, iana: r.iana, country: r.country } : null; });
    if (people.some((x) => !x)) return { ok: false, slots: [], summary: 'Some participants have no resolved time zone.', problems: ['zone mismatch'] };
    const holSet = {}, excluded = [];
    for (const [cc, list] of Object.entries((holidays && holidays.holidays) || {})) {
      holSet[cc] = {};
      for (const h of list) { holSet[cc][h.date] = h.name; excluded.push({ date: h.date, country: cc, name: h.name, who: people.filter((x) => x.country === cc).map((x) => x.name) }); }
    }
    const noCal = [...new Set(people.filter((x) => !x.country || !holSet[x.country]).map((x) => `${x.country || 'unknown country'} (${x.city})`))];
    let r = search(people, holSet, p, p.hours), relaxed = null;
    if (!r.slots.length && !(overrides && overrides.no_relax)) {
      const wide = { start: Math.max(0, p.hours.start - 2), end: Math.min(24, p.hours.end + 2) };
      const r2 = search(people, holSet, p, wide);
      if (r2.slots.length) { r = r2; relaxed = { from: p.hours, to: wide }; }
    }
    const out = { ok: r.slots.length > 0, duration_minutes: p.duration_minutes, from: p.from, to: p.to, hours: relaxed ? relaxed.to : p.hours, relaxed, participants: people, slots: r.slots, excluded_days: excluded.sort((a, b) => (a.date < b.date ? -1 : 1)), holiday_calendar_missing: noCal, blockers: r.slots.length ? undefined : r.why };
    out.summary = format_summary({ result: out }).summary;
    return out;
  }

  // ---------- format_summary ----------
  function format_summary(args) {
    const r = args && args.result;
    if (!r) return { summary: 'No result to summarise.' };
    if (!r.slots || !r.slots.length) {
      const b = r.blockers ? Object.entries(r.blockers).map(([n, c]) => `${n}: ${c.hours} slots outside hours, ${c.weekend} on weekends, ${c.holiday} on holidays`).join('; ') : '';
      return { summary: r.summary && !r.ok && !r.blockers ? r.summary : `No ${r.duration_minutes}-minute slot works for everyone between ${r.from} and ${r.to}${b ? ` (${b})` : ''}. Try more dates or wider hours.` };
    }
    const s = r.slots[0];
    const lines = [`Best slot: ${s.locals.map((l) => `${l.name} ${l.weekday} ${l.date} ${l.start}-${l.end} ${l.zone} (${l.city})`).join('; ')}.`];
    if (r.relaxed) lines.push(`No slot fit ${r.relaxed.from.start}:00-${r.relaxed.from.end}:00, so working hours were widened to ${r.relaxed.to.start}:00-${r.relaxed.to.end}:00.`);
    lines.push(`${r.slots.length} option${r.slots.length > 1 ? 's' : ''} ranked by how close each time is to the middle of everyone's working day.`);
    if (r.excluded_days && r.excluded_days.length) lines.push(`Public holidays skipped: ${r.excluded_days.map((h) => `${h.date} ${h.name} (${h.country})`).join(', ')}.`);
    if (r.holiday_calendar_missing && r.holiday_calendar_missing.length) lines.push(`No holiday calendar for ${r.holiday_calendar_missing.join(', ')}: holidays there were not checked.`);
    lines.push('Weekends are Saturday and Sunday for everyone.');
    return { summary: lines.join(' ') };
  }

  g.agenticTools = {
    schemas: {
      parse_request: { description: 'Read a plain-English meeting request into people, cities, duration, dates and working hours.', parameters: { type: 'object', properties: { text: { type: 'string' }, today: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['text', 'today'] } },
      rank_slots: { description: 'Rank meeting slots that work for everyone.', parameters: { type: 'object', properties: { parsed: { type: 'object' }, zones: { type: 'object' }, holidays: { type: 'object' }, overrides: { type: 'object' } }, required: ['parsed', 'zones'] } },
      format_summary: { description: 'Plain-English summary of a ranked result.', parameters: { type: 'object', properties: { result: { type: 'object' } }, required: ['result'] } },
    },
    tools: { parse_request, rank_slots, format_summary },
  };
})(globalThis);
