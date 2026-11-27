// Field/slot inventory: which field time slots exist on which dates, and which are free.
const { all, get } = require('./db');
const T = require('./time');

function loadFields() {
  const fields = all(`SELECT f.*, p.short AS park_short, p.name AS park_name FROM fields f JOIN parks p ON p.id=f.park_id WHERE f.active=1 ORDER BY p.sort, f.sort`);
  const slots = all('SELECT * FROM field_slots');
  for (const f of fields) {
    f.divList = (f.divisions || '').split(',').map(s => s.trim()).filter(Boolean);
    f.slots = slots.filter(s => s.field_id === f.id).map(s => ({ ...s, dayList: s.days.split(',').map(Number) }));
  }
  return fields;
}

// "early" side of the night vs "late" side: used for team conflicts, board coverage and field duty
const slotGroup = (start) => (T.minutes(start) < T.minutes('19:00') ? 'early' : 'late');
const overlaps = (a1, a2, b1, b2) => T.minutes(a1) < T.minutes(b2) && T.minutes(b1) < T.minutes(a2);

function loadBlackouts() { return all('SELECT * FROM blackouts'); }
function blocked(blackouts, date, field, slot, use) {
  return blackouts.some(b => b.date === date
    && (!b.field_id || b.field_id === field.id)
    && (!b.park_id || b.park_id === field.park_id)
    && (!b.slot_code || b.slot_code === slot.code)
    && (b.applies === 'all' || b.applies === use || (b.applies === 'practice' && use === 'scrimmage')));
}

/** Every slot instance between two dates. use = 'game' | 'practice' */
function slotInstances(startDate, endDate, use, fields = loadFields(), blackouts = loadBlackouts()) {
  const out = [];
  for (const date of T.range(startDate, endDate)) {
    const wd = T.weekday(date);
    for (const f of fields) for (const s of f.slots) {
      if (!s.dayList.includes(wd)) continue;
      if (s.uses !== 'both' && s.uses !== use) continue;
      if (blocked(blackouts, date, f, s, use)) continue;
      out.push({ date, field_id: f.id, park_id: f.park_id, park_short: f.park_short, field_name: f.name, kind: f.kind,
        divList: f.divList, slot_code: s.code, start: s.start, end: s.end, group: slotGroup(s.start), saturday: wd === 6 });
    }
  }
  return out;
}

function eventsBetween(startDate, endDate) {
  return all(`SELECT * FROM events WHERE date BETWEEN ? AND ? AND status <> 'cancelled'`, startDate, endDate);
}

/** Free = no non-cancelled event overlapping that field and time */
function freeSlots(startDate, endDate, use, opts = {}) {
  const events = opts.events || eventsBetween(startDate, endDate);
  const byKey = new Map();
  for (const e of events) { const k = e.date + '|' + e.field_id; (byKey.get(k) || byKey.set(k, []).get(k)).push(e); }
  return slotInstances(startDate, endDate, use, opts.fields, opts.blackouts).filter(si => {
    const list = byKey.get(si.date + '|' + si.field_id) || [];
    return !list.some(e => overlaps(si.start, si.end, e.start, e.end));
  });
}

module.exports = { loadFields, slotInstances, freeSlots, eventsBetween, slotGroup, overlaps, loadBlackouts, blocked };
