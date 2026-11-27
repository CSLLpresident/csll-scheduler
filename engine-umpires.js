// Umpire assignment engine + helpers for sick calls and moves.
const { all, get, run, tx, setting } = require('./db');
const T = require('./time');
const { slotGroup, overlaps } = require('./engine-slots');
const { availScore, availabilityIndex } = require('./engine-practices');
const { seededRandom, shuffle } = require('./engine-context');

// Positions each game needs, from its division's crew settings
function crewFor(div) {
  const out = [];
  for (let i = 0; i < (div.crew_plate || 0); i++) out.push('plate');
  for (let i = 0; i < (div.crew_field || 0); i++) out.push('field');
  return out;
}

/** Create the empty position rows every game needs (keeps anything already there). */
function ensurePositions(start, end) {
  const games = all(`SELECT e.*, d.crew_plate, d.crew_field FROM events e JOIN divisions d ON d.id=e.division_id
                     WHERE e.type='game' AND e.status='scheduled' AND e.date BETWEEN ? AND ?`, start, end);
  let added = 0;
  tx(() => {
    for (const g of games) {
      const have = all(`SELECT position FROM ump_assignments WHERE event_id=? AND status<>'sick'`, g.id);
      const need = crewFor(g);
      for (const pos of ['plate', 'field']) {
        const missing = need.filter(p => p === pos).length - have.filter(h => h.position === pos).length;
        for (let i = 0; i < missing; i++) { run('INSERT INTO ump_assignments(event_id,position) VALUES(?,?)', g.id, pos); added++; }
      }
    }
  });
  return added;
}

function umpireRoster() {
  const umps = all('SELECT * FROM people WHERE is_umpire=1 AND active=1');
  const divs = all('SELECT * FROM umpire_divisions');
  for (const u of umps) u.divisionIds = new Set(divs.filter(d => d.person_id === u.id).map(d => d.division_id));
  return umps;
}

function umpSlotCode(e) { return e.slot_code === 'seven' ? 'seven' : slotGroup(e.start); }
function umpAvail(rules, e) {
  if (!rules || !rules.length) return 0;
  const code = umpSlotCode(e);
  const wd = T.weekday(e.date);
  const m = r => !r.slot_code || r.slot_code === 'any' || r.slot_code === code;
  const dated = rules.filter(r => r.date === e.date && m(r));
  if (dated.length) return dated.some(r => !r.available) ? -1 : 1;
  const weekly = rules.filter(r => r.date == null && r.weekday === wd && m(r));
  if (weekly.length) return weekly.some(r => !r.available) ? -1 : 1;
  return rules.some(r => r.date == null && r.available) ? -1 : 0; // weekly pattern given, this day not in it
}

/** Fill open positions between dates. Keeps existing assignments unless opts.replace. */
function generateUmpires(opts = {}) {
  const start = opts.start || T.today();
  const end = opts.end || T.addDays(start, 13);
  const rnd = seededRandom(opts.seed || Date.now());
  if (opts.replace) run(`UPDATE ump_assignments SET person_id=NULL WHERE status='assigned' AND event_id IN (SELECT id FROM events WHERE date BETWEEN ? AND ?)`, start, end);
  ensurePositions(start, end);
  const umps = umpireRoster();
  const avail = availabilityIndex('umpire');
  const fieldPark = new Map(all('SELECT id, park_id FROM fields').map(f => [f.id, f.park_id]));
  const rows = all(`SELECT a.*, e.date, e.start, e.end, e.slot_code, e.field_id, e.division_id FROM ump_assignments a JOIN events e ON e.id=a.event_id
                    WHERE e.date BETWEEN ? AND ? AND e.status='scheduled' AND a.status<>'sick'`, start, end);
  const load = new Map(umps.map(u => [u.id, { total: 0, weeks: {} }]));
  const busy = new Map(); // umpId -> [{date,start,end,park}]
  for (const r of rows.filter(r => r.person_id)) {
    const l = load.get(r.person_id); if (!l) continue;
    l.total++; const wk = T.mondayOf(r.date); l.weeks[wk] = (l.weeks[wk] || 0) + 1;
    (busy.get(r.person_id) || busy.set(r.person_id, []).get(r.person_id)).push({ date: r.date, start: r.start, end: r.end, park: fieldPark.get(r.field_id) });
  }
  const open = rows.filter(r => !r.person_id);
  // hardest first: fewest qualified umpires
  const qualified = r => umps.filter(u => u.divisionIds.has(r.division_id));
  const order = shuffle(open, rnd).sort((a, b) => a.date.localeCompare(b.date) || qualified(a).length - qualified(b).length);
  let filled = 0;
  const updates = [];
  for (const r of order) {
    let best = null, bestCost = Infinity;
    const park = fieldPark.get(r.field_id);
    for (const u of qualified(r)) {
      const a = umpAvail(avail.get(u.id), r);
      if (a < 0) continue;
      const b = busy.get(u.id) || [];
      if (b.some(x => x.date === r.date && overlaps(x.start, x.end, r.start, r.end))) continue;
      let cost = 0;
      if (b.some(x => x.date === r.date && x.park !== park)) cost += 25;     // two parks same night
      if (b.some(x => x.date === r.date && x.park === park)) cost -= 2;      // doubleheader at same park is good
      const l = load.get(u.id); const wk = T.mondayOf(r.date);
      cost += 4 * (l.weeks[wk] || 0) + 1 * l.total;
      cost -= 3 * a;
      cost += rnd();
      if (cost < bestCost) { bestCost = cost; best = u; }
    }
    if (!best) continue;
    updates.push([best.id, r.id]); filled++;
    const l = load.get(best.id); l.total++; const wk = T.mondayOf(r.date); l.weeks[wk] = (l.weeks[wk] || 0) + 1;
    (busy.get(best.id) || busy.set(best.id, []).get(best.id)).push({ date: r.date, start: r.start, end: r.end, park });
  }
  tx(() => updates.forEach(([pid, aid]) => run('UPDATE ump_assignments SET person_id=?, status=? WHERE id=?', pid, 'assigned', aid)));
  const stillOpen = open.length - filled;
  return { filled, stillOpen, start, end };
}

/** Umpires free for an assignment's game time and qualified for its division */
function availableFor(assignmentId) {
  const a = get(`SELECT a.*, e.date, e.start, e.end, e.slot_code, e.division_id, e.field_id FROM ump_assignments a JOIN events e ON e.id=a.event_id WHERE a.id=?`, assignmentId);
  if (!a) return [];
  const umps = umpireRoster().filter(u => u.divisionIds.has(a.division_id) && u.id !== a.person_id);
  const avail = availabilityIndex('umpire');
  const sameDay = all(`SELECT a.person_id, e.start, e.end FROM ump_assignments a JOIN events e ON e.id=a.event_id
                       WHERE e.date=? AND a.person_id IS NOT NULL AND a.status IN ('assigned','present')`, a.date);
  return umps.filter(u => umpAvail(avail.get(u.id), a) >= 0 && !sameDay.some(s => s.person_id === u.id && overlaps(s.start, s.end, a.start, a.end)));
}

/** JM umpires at the same park and time who could be moved (JM AA first, then JM AAA) */
function pullCandidates(assignmentId) {
  const a = get(`SELECT a.*, e.date, e.start, e.end, e.field_id, f.park_id FROM ump_assignments a JOIN events e ON e.id=a.event_id JOIN fields f ON f.id=e.field_id WHERE a.id=?`, assignmentId);
  if (!a) return [];
  const order = setting('jm_pull_order', ['JMAA', 'JMAAA']);
  const rows = all(`SELECT a.id AS assignment_id, a.person_id, p.first, p.last, d.code, d.name AS division, e.id AS event_id, fl.name AS field, e.start, f2.park_id
                    FROM ump_assignments a JOIN events e ON e.id=a.event_id JOIN divisions d ON d.id=e.division_id
                    JOIN people p ON p.id=a.person_id JOIN fields fl ON fl.id=e.field_id JOIN fields f2 ON f2.id=e.field_id
                    WHERE e.date=? AND a.status IN ('assigned','present') AND e.id<>? AND d.code IN (${order.map(() => '?').join(',')})`, a.date, a.event_id, ...order);
  // only from JM games that still have both umpires
  const counts = new Map();
  for (const r of rows) counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1);
  return rows.filter(r => counts.get(r.event_id) >= 2 && slotGroup(r.start) === slotGroup(a.start))
    .map(r => ({ ...r, samePark: r.park_id === a.park_id, rank: order.indexOf(r.code) }))
    .sort((x, y) => (y.samePark - x.samePark) || x.rank - y.rank);
}

module.exports = { generateUmpires, ensurePositions, availableFor, pullCandidates, crewFor, umpireRoster, umpAvail };
