// Site actions for Meeting Finder, registered with agentify.js (spec section 2.1 "Site action").
// `ui` is an adapter so the same actions run in the browser page and in a headless node host.
import { agentify } from './lib/agentify.js';
import { buildIcs } from './ics.js';

export function createSite(ui) {
  const site = agentify({
    name: 'meeting_coordinator',
    frontAgent: 'meeting_coordinator',
    brand: 'Meeting Finder',
    description: 'Finds meeting times that work for people in different cities.',
  });
  site.action('get_page_state', {
    description: 'Read the current request text and the active router label shown on the page.',
    effect: 'read',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ui.getState(),
  });
  site.action('show_result', {
    description: 'Display the ranked slots from an earlier step of this run on the page.',
    effect: 'ui',
    schema: { type: 'object', properties: { from: { type: 'string', enum: ['slot_ranker'] } }, required: ['from'], additionalProperties: false },
    handler: ({ from }, { blackboard } = {}) => {
      const r = blackboard && blackboard[from];
      if (!r) throw new Error(`nothing to show: "${from}" has not run yet`);
      ui.showResult(r);
      return { shown: true, slots: (r.slots || []).length };
    },
  });
  site.action('export_ics', {
    description: 'Download a calendar (.ics) file for one ranked slot. Writes a file on the visitor\'s device, so the visitor must confirm.',
    effect: 'write',
    schema: { type: 'object', properties: { slot_index: { type: 'integer', minimum: 0, maximum: 9 }, title: { type: 'string', maxLength: 120 } }, required: ['slot_index'], additionalProperties: false },
    handler: ({ slot_index, title }, { blackboard } = {}) => {
      const r = blackboard && blackboard.slot_ranker;
      const s = r && r.slots && r.slots[slot_index];
      if (!s) throw new Error(`no slot at index ${slot_index}`);
      const who = s.locals.map((l) => `${l.name} (${l.city}): ${l.weekday} ${l.date} ${l.start}-${l.end} ${l.zone}`).join('\n');
      const ics = buildIcs({ title: title || 'Meeting', start: s.start_utc, end: s.end_utc, description: who, uid: `${s.start_utc}-${r.participants.map((p) => p.name).join('-')}@meeting-finder`, stamp: ui.now() });
      const file = `meeting-${s.start_utc.slice(0, 16).replace(/[-:T]/g, '')}.ics`;
      ui.download(file, ics, 'text/calendar');
      return { file, bytes: ics.length };
    },
  });
  return site;
}
