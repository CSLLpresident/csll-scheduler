// Coaches on more than one team: who they are, and where their teams' schedules collide.
//  overlap    = two of their teams at the same time (a real problem)
//  other_park = same night at different parks (a heads-up)
// Same night, same park, different time slots is what we want, so it is not a conflict.
const { all, get, run } = require('./db');
const T = require('./time');

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const overlaps = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const teamsOf = e => [e.home_team_id, e.away_team_id, e.team_id].filter(Boolean);

/** person -> [{team_id, team_name, role}] for people coaching 2+ active teams */
function multiTeamCoaches() {
  const rows = all(`SELECT tc.person_id, tc.team_id, tc.role, t.name AS team_name, d.name AS division_name, p.first, p.last, p.phone, p.email
                    FROM team_coaches tc JOIN teams t ON t.id=tc.team_id JOIN divisions d ON d.id=t.division_id JOIN people p ON p.id=tc.person_id
                    WHERE t.active=1 AND p.active=1 ORDER BY p.last, p.first, d.sort`);
  const by = new Map();
  for (const r of rows) (by.get(r.person_id) || by.set(r.person_id, []).get(r.person_id)).push(r);
  return [...by.entries()].filter(([, list]) => list.length > 1).map(([pid, list]) => ({
    person_id: pid, first: list[0].first, last: list[0].last, phone: list[0].phone, email: list[0].email,
    teams: list.map(r => ({ id: r.team_id, name: r.team_name, division: r.division_name, role: r.role })),
  }));
}

const keyOf = (pid, a, b, kind) => `${pid}|${Math.min(a, b)}|${Math.max(a, b)}|${kind}`;

/** All conflicts between start and end, with whether a board member marked them OK */
function findConflicts(start, end) {
  const coaches = multiTeamCoaches();
  if (!coaches.length) return [];
  const events = all(`SELECT e.*, f.park_id, f.name AS field_name, pk.short AS park_short, d.code AS division_code,
                        th.name AS home_name, ta.name AS away_name, tt.name AS team_name
                      FROM events e JOIN fields f ON f.id=e.field_id JOIN parks pk ON pk.id=f.park_id LEFT JOIN divisions d ON d.id=e.division_id
                      LEFT JOIN teams th ON th.id=e.home_team_id LEFT JOIN teams ta ON ta.id=e.away_team_id LEFT JOIN teams tt ON tt.id=e.team_id
                      WHERE e.date BETWEEN ? AND ? AND e.status='scheduled' ORDER BY e.date, e.start`, start, end);
  const acks = new Map(all('SELECT * FROM conflict_acks').map(a => [a.key, a]));
  const out = [];
  for (const c of coaches) {
    const ids = new Set(c.teams.map(t => t.id));
    const mine = events.filter(e => teamsOf(e).some(t => ids.has(t)));
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      const a = mine[i], b = mine[j];
      if (a.date !== b.date) continue;
      // the coach's team in each event; skip if it's the same team (e.g. a scrimmage between two of their teams)
      const ta = teamsOf(a).filter(t => ids.has(t)), tb = teamsOf(b).filter(t => ids.has(t));
      if (ta.every(t => tb.includes(t))) continue;
      const kind = overlaps(a, b) ? 'overlap' : a.park_id !== b.park_id ? 'other_park' : null;
      if (!kind) continue;
      const key = keyOf(c.person_id, a.id, b.id, kind);
      const ack = acks.get(key);
      out.push({ key, kind, date: a.date, coach: { id: c.person_id, first: c.first, last: c.last, phone: c.phone }, a: brief(a), b: brief(b),
        acknowledged: !!ack, ackNote: ack ? ack.note : null });
    }
  }
  return out;
}
function brief(e) {
  const who = e.type === 'practice' ? e.team_name : `${e.away_name} at ${e.home_name}`;
  return { id: e.id, type: e.type, date: e.date, start: e.start, end: e.end, park: e.park_short, field: e.field_name, who, division: e.division_code };
}

/** Conflicts for the events on screen, keyed by event id (unacknowledged only) */
function conflictsByEvent(start, end) {
  const map = new Map();
  for (const c of findConflicts(start, end)) {
    if (c.acknowledged) continue;
    for (const [me, other] of [[c.a, c.b], [c.b, c.a]]) {
      (map.get(me.id) || map.set(me.id, []).get(me.id)).push({ key: c.key, kind: c.kind, coach: `${c.coach.first} ${c.coach.last}`, other });
    }
  }
  return map;
}

/**
 * Warnings for putting these teams at this date/time/field (never blocks).
 * excludeIds = events being moved or replaced.
 */
function checkPlacement({ teamIds, date, start, end, fieldId, excludeIds = [] }) {
  const teamIdsSet = new Set(teamIds.filter(Boolean));
  if (!teamIdsSet.size || !date || !start || !end) return [];
  const coaches = all(`SELECT DISTINCT tc.person_id, p.first, p.last FROM team_coaches tc JOIN people p ON p.id=tc.person_id WHERE tc.team_id IN (${[...teamIdsSet].join(',')})`);
  if (!coaches.length) return [];
  const park = get('SELECT park_id FROM fields WHERE id=?', fieldId);
  const warnings = [];
  for (const c of coaches) {
    const other = all(`SELECT tc.team_id FROM team_coaches tc JOIN teams t ON t.id=tc.team_id WHERE tc.person_id=? AND t.active=1`, c.person_id)
      .map(r => r.team_id).filter(id => !teamIdsSet.has(id));
    if (!other.length) continue;
    const ids = other.join(',');
    const evs = all(`SELECT e.*, f.park_id, f.name AS field_name, pk.short AS park_short, th.name AS home_name, ta.name AS away_name, tt.name AS team_name
                     FROM events e JOIN fields f ON f.id=e.field_id JOIN parks pk ON pk.id=f.park_id
                     LEFT JOIN teams th ON th.id=e.home_team_id LEFT JOIN teams ta ON ta.id=e.away_team_id LEFT JOIN teams tt ON tt.id=e.team_id
                     WHERE e.date=? AND e.status='scheduled' AND (e.team_id IN (${ids}) OR e.home_team_id IN (${ids}) OR e.away_team_id IN (${ids}))`, date);
    for (const e of evs) {
      if (excludeIds.includes(e.id)) continue;
      const kind = overlaps({ start, end }, e) ? 'overlap' : park && e.park_id !== park.park_id ? 'other_park' : null;
      if (!kind) continue;
      const who = e.type === 'practice' ? `${e.team_name} practice` : `${e.away_name} at ${e.home_name}`;
      warnings.push({ kind, coach: `${c.first} ${c.last}`,
        text: `${c.first} ${c.last} also coaches ${who} ${kind === 'overlap' ? 'at the same time' : 'that night at another park'} (${T.fmt12(e.start)}, ${e.park_short} ${e.field_name}).` });
    }
  }
  return warnings;
}

function acknowledge(key, personId, note) {
  run('INSERT OR REPLACE INTO conflict_acks(key,person_id,note) VALUES(?,?,?)', key, personId, note || null);
}
function unacknowledge(key) { run('DELETE FROM conflict_acks WHERE key=?', key); }

module.exports = { multiTeamCoaches, findConflicts, conflictsByEvent, checkPlacement, acknowledge, unacknowledge };
