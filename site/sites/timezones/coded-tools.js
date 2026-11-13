// Coded-tool bundle for the "timezone_desk" network. Pure functions, no network or DOM access.
// SAMPLE DATA: the city table below is a small hand-written list of well-known cities mapped to real IANA
// zone ids. It is not exhaustive. Any valid IANA zone id (for example "America/Chicago") also works.
(function (g) {
  // [display name, IANA zone, ISO country, aliases...]
  const CITIES = [
    ['Chicago', 'America/Chicago', 'US'], ['Urbana', 'America/Chicago', 'US', 'Champaign', 'Urbana-Champaign'],
    ['New York', 'America/New_York', 'US', 'NYC'], ['Boston', 'America/New_York', 'US'], ['Washington', 'America/New_York', 'US', 'Washington DC'],
    ['Atlanta', 'America/New_York', 'US'], ['Miami', 'America/New_York', 'US'], ['Austin', 'America/Chicago', 'US'], ['Dallas', 'America/Chicago', 'US'],
    ['Denver', 'America/Denver', 'US'], ['Phoenix', 'America/Phoenix', 'US'], ['Los Angeles', 'America/Los_Angeles', 'US', 'LA'],
    ['San Francisco', 'America/Los_Angeles', 'US', 'SF'], ['Fremont', 'America/Los_Angeles', 'US'], ['Seattle', 'America/Los_Angeles', 'US'],
    ['Anchorage', 'America/Anchorage', 'US'], ['Honolulu', 'Pacific/Honolulu', 'US'],
    ['Toronto', 'America/Toronto', 'CA'], ['Vancouver', 'America/Vancouver', 'CA'], ['Mexico City', 'America/Mexico_City', 'MX'],
    ['Sao Paulo', 'America/Sao_Paulo', 'BR'], ['Buenos Aires', 'America/Argentina/Buenos_Aires', 'AR'], ['Bogota', 'America/Bogota', 'CO'],
    ['London', 'Europe/London', 'GB'], ['Manchester', 'Europe/London', 'GB'], ['Cardiff', 'Europe/London', 'GB'], ['Dublin', 'Europe/Dublin', 'IE'],
    ['Lisbon', 'Europe/Lisbon', 'PT'], ['Madrid', 'Europe/Madrid', 'ES'], ['Paris', 'Europe/Paris', 'FR'], ['Berlin', 'Europe/Berlin', 'DE'],
    ['Amsterdam', 'Europe/Amsterdam', 'NL'], ['Rome', 'Europe/Rome', 'IT'], ['Zurich', 'Europe/Zurich', 'CH'], ['Stockholm', 'Europe/Stockholm', 'SE'],
    ['Warsaw', 'Europe/Warsaw', 'PL'], ['Athens', 'Europe/Athens', 'GR'], ['Istanbul', 'Europe/Istanbul', 'TR'], ['Moscow', 'Europe/Moscow', 'RU'],
    ['Cairo', 'Africa/Cairo', 'EG'], ['Lagos', 'Africa/Lagos', 'NG'], ['Nairobi', 'Africa/Nairobi', 'KE'], ['Johannesburg', 'Africa/Johannesburg', 'ZA'],
    ['Dubai', 'Asia/Dubai', 'AE'], ['Tel Aviv', 'Asia/Jerusalem', 'IL'], ['Karachi', 'Asia/Karachi', 'PK'],
    ['Delhi', 'Asia/Kolkata', 'IN', 'New Delhi'], ['Mumbai', 'Asia/Kolkata', 'IN', 'Bombay'], ['Bengaluru', 'Asia/Kolkata', 'IN', 'Bangalore'],
    ['Hyderabad', 'Asia/Kolkata', 'IN'], ['Chennai', 'Asia/Kolkata', 'IN'], ['Dhaka', 'Asia/Dhaka', 'BD'], ['Bangkok', 'Asia/Bangkok', 'TH'],
    ['Jakarta', 'Asia/Jakarta', 'ID'], ['Singapore', 'Asia/Singapore', 'SG'], ['Kuala Lumpur', 'Asia/Kuala_Lumpur', 'MY'], ['Manila', 'Asia/Manila', 'PH'],
    ['Hong Kong', 'Asia/Hong_Kong', 'HK'], ['Shanghai', 'Asia/Shanghai', 'CN'], ['Beijing', 'Asia/Shanghai', 'CN'], ['Taipei', 'Asia/Taipei', 'TW'],
    ['Seoul', 'Asia/Seoul', 'KR'], ['Tokyo', 'Asia/Tokyo', 'JP'], ['Sydney', 'Australia/Sydney', 'AU'], ['Melbourne', 'Australia/Melbourne', 'AU'],
    ['Perth', 'Australia/Perth', 'AU'], ['Auckland', 'Pacific/Auckland', 'NZ'],
  ];
  const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9/_ -]/g, '').replace(/[ _-]+/g, ' ').trim();
  const INDEX = new Map();
  for (const [name, iana, country, ...aliases] of CITIES) for (const k of [name, ...aliases]) INDEX.set(norm(k), { city: name, iana, country });

  const fmt = {};
  function parts(iana, ms) {
    const f = fmt[iana] || (fmt[iana] = new Intl.DateTimeFormat('en-US', { timeZone: iana, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return o;
  }
  function offsetMinutes(iana, ms) {
    const p = parts(iana, ms);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  }
  function validIana(z) { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return /\//.test(z) || z === 'UTC'; } catch { return false; } }
  const label = (min) => `UTC${min < 0 ? '-' : '+'}${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}:${String(Math.abs(min) % 60).padStart(2, '0')}`;

  function resolve_cities(args) {
    const { cities, on } = args || {};
    if (!Array.isArray(cities) || cities.length === 0) return { ok: false, error: 'resolve_cities needs a non-empty cities[] array' };
    const ref = on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? Date.parse(on + 'T12:00:00Z') : Date.UTC(2026, 0, 15, 12);
    const resolved = [], unknown = [];
    for (const input of cities) {
      const hit = INDEX.get(norm(input));
      if (hit) { const off = offsetMinutes(hit.iana, ref); resolved.push({ input, ...hit, utc_offset_minutes: off, utc_offset: label(off) }); }
      else if (validIana(String(input))) { const off = offsetMinutes(String(input), ref); resolved.push({ input, city: String(input), iana: String(input), country: null, utc_offset_minutes: off, utc_offset: label(off) }); }
      else unknown.push(String(input));
    }
    const countries = [...new Set(resolved.map((r) => r.country).filter(Boolean))].sort();
    return { ok: unknown.length === 0, resolved, unknown, countries, reference_date: on || null, note: unknown.length ? 'Unknown cities are not in the bundled sample list. Use an IANA zone id such as "Europe/Paris".' : undefined };
  }

  g.agenticTools = {
    schemas: {
      resolve_cities: {
        description: 'Map city names (sample list) or IANA zone ids to IANA zone, country and UTC offset on a reference date.',
        parameters: { type: 'object', properties: { cities: { type: 'array', items: { type: 'string' } }, on: { type: 'string', description: 'YYYY-MM-DD reference date for the offset' } }, required: ['cities'] },
      },
    },
    tools: { resolve_cities },
  };
})(globalThis);
