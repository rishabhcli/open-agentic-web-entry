// Minimal RFC 5545 calendar file builder for one event. Pure function: the caller supplies `stamp`.
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function fold(line) {
  const out = []; let cur = '';
  for (const ch of line) { if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch; }
  out.push(cur);
  return out.join('\r\n');
}
export function buildIcs({ title, start, end, description = '', uid, stamp }) {
  if (!title || !start || !end || !uid || !stamp) throw new Error('buildIcs needs title, start, end, uid, stamp');
  if (!(Date.parse(end) > Date.parse(start))) throw new Error('end must be after start');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//open-agentic-web-entry//Meeting Finder//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${esc(uid)}`, `DTSTAMP:${utc(stamp)}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(description)}`, 'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}
