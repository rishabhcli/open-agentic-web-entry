// Coded-tool bundle for the "holiday_desk" network (optional coded-tool mechanism, spec section 3.3).
// Pure functions only: no network, no DOM. Runs inside an isolated sandbox (Web Worker in the browser).
// Holiday dates are COMPUTED from statutory rules, not looked up in a dataset.
(function (g) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const nth = (y, m, wd, n) => 1 + ((wd - dow(y, m, 1) + 7) % 7) + (n - 1) * 7;
  const last = (y, m, wd) => { const ld = new Date(Date.UTC(y, m, 0)).getUTCDate(); return ld - ((dow(y, m, ld) - wd + 7) % 7); };
  const add = (y, m, d, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
  function easter(y) { // anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), gg = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - gg + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return [y, mo, da];
  }

  // United States federal holidays (5 U.S.C. 6103). Weekend dates are observed on Friday / Monday.
  function usYear(y) {
    const out = [];
    const fixed = (m, d, name) => {
      const w = dow(y, m, d);
      if (w === 6) { const [yy, mm, dd] = add(y, m, d, -1); out.push({ date: iso(yy, mm, dd), name: `${name} (observed)` }); }
      else if (w === 0) { const [yy, mm, dd] = add(y, m, d, 1); out.push({ date: iso(yy, mm, dd), name: `${name} (observed)` }); }
      else out.push({ date: iso(y, m, d), name });
    };
    fixed(1, 1, "New Year's Day");
    out.push({ date: iso(y, 1, nth(y, 1, 1, 3)), name: 'Martin Luther King Jr. Day' });
    out.push({ date: iso(y, 2, nth(y, 2, 1, 3)), name: "Washington's Birthday" });
    out.push({ date: iso(y, 5, last(y, 5, 1)), name: 'Memorial Day' });
    if (y >= 2021) fixed(6, 19, 'Juneteenth National Independence Day');
    fixed(7, 4, 'Independence Day');
    out.push({ date: iso(y, 9, nth(y, 9, 1, 1)), name: 'Labor Day' });
    out.push({ date: iso(y, 10, nth(y, 10, 1, 2)), name: 'Columbus Day' });
    fixed(11, 11, 'Veterans Day');
    out.push({ date: iso(y, 11, nth(y, 11, 4, 4)), name: 'Thanksgiving Day' });
    fixed(12, 25, 'Christmas Day');
    return out;
  }

  // England and Wales bank holidays, standard recurring set (one-off royal-event holidays are NOT included).
  function gbYear(y) {
    const out = [];
    const w1 = dow(y, 1, 1);
    out.push({ date: w1 === 6 ? iso(...add(y, 1, 1, 2)) : w1 === 0 ? iso(...add(y, 1, 1, 1)) : iso(y, 1, 1), name: w1 === 6 || w1 === 0 ? "New Year's Day (substitute)" : "New Year's Day" });
    const [ey, em, ed] = easter(y);
    out.push({ date: iso(...add(ey, em, ed, -2)), name: 'Good Friday' });
    out.push({ date: iso(...add(ey, em, ed, 1)), name: 'Easter Monday' });
    out.push({ date: iso(y, 5, nth(y, 5, 1, 1)), name: 'Early May bank holiday' });
    out.push({ date: iso(y, 5, last(y, 5, 1)), name: 'Spring bank holiday' });
    out.push({ date: iso(y, 8, last(y, 8, 1)), name: 'Summer bank holiday' });
    const c = dow(y, 12, 25);
    let C = 25, B = 26;
    if (c === 6) { C = 27; B = 28; } else if (c === 0) { C = 27; B = 26; } else if (c === 5) { B = 28; }
    out.push({ date: iso(y, 12, C), name: C === 25 ? 'Christmas Day' : 'Christmas Day (substitute)' });
    out.push({ date: iso(y, 12, B), name: B === 26 ? 'Boxing Day' : 'Boxing Day (substitute)' });
    return out;
  }

  const CALENDARS = {
    US: { label: 'United States (federal)', year: usYear, basis: '5 U.S.C. 6103, computed' },
    GB: { label: 'England and Wales (bank holidays)', year: gbYear, basis: 'standard recurring bank holidays, computed; one-off royal-event holidays excluded' },
  };

  const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

  function holidays_between(args) {
    const { countries, from, to } = args || {};
    if (!Array.isArray(countries) || !validDate(from) || !validDate(to)) return { ok: false, error: 'holidays_between needs countries[] and from/to as YYYY-MM-DD' };
    if (from > to) return { ok: false, error: 'from is after to' };
    const y0 = +from.slice(0, 4) - 1, y1 = +to.slice(0, 4) + 1;
    if (y1 - y0 > 6) return { ok: false, error: 'range too long (max 5 years)' };
    const holidays = {}, unsupported = [], basis = {};
    for (const raw of [...new Set(countries.map((c) => String(c).toUpperCase()))]) {
      const cal = CALENDARS[raw];
      if (!cal) { unsupported.push(raw); continue; }
      const list = [];
      for (let y = y0; y <= y1; y++) for (const h of cal.year(y)) if (h.date >= from && h.date <= to) list.push(h);
      list.sort((a, b) => (a.date < b.date ? -1 : 1));
      holidays[raw] = list;
      basis[raw] = cal.basis;
    }
    return { ok: true, holidays, unsupported, supported: Object.keys(CALENDARS), basis };
  }

  g.agenticTools = {
    schemas: {
      holidays_between: {
        description: 'Public holidays per country between two dates (US federal and England/Wales bank holidays, computed from rules).',
        parameters: { type: 'object', properties: { countries: { type: 'array', items: { type: 'string' } }, from: { type: 'string' }, to: { type: 'string' } }, required: ['countries', 'from', 'to'] },
      },
    },
    tools: { holidays_between },
  };
})(globalThis);
