// Regular practice schedule generator.
// - Fills free practice slots after games are placed.
// - Uses coach availability (weekday / date / early-late) and keeps it fair: each round the team whose
//   requests have been honored least so far picks first, so no coach gets everything while another gets nothing.
// - Spreads teams coached by board members across slots and parks so a board member is on site as often as possible.
const { all, run, tx, setting } = require('./db');
const T = require('./time');
const { loadFields, freeSlots, eventsBetween, slotGroup } = require('./engine-slots');
const { leagueContext, eventTeams, seededRandom, shuffle, coachOverlapCost } = require('./engine-context');

function availabilityIndex(kind) {
  const rows = all('SELECT * FROM availability WHERE kind=?', kind);
  const by = new Map();
  for (const r of rows) (by.get(r.person_id) || by.set(r.person_id, []).get(r.person_id)).push(r);
  return by;
}

// Score a person's availability for a slot: +1 explicitly available, -1 unavailable, 0 no info.
// Specific dates win over weekday rules. slot_code 'any' matches everything.
function availScore(rules, date, group) {
  if (!rules || !rules.length) return 0;
  const wd = T.weekday(date);
  const matchSlot = r => !r.slot_code || r.slot_code === 'any' || r.slot_code === group || (r.slot_code === 'seven' && group === 'late');
  const dated = rules.filter(r => r.date === date && matchSlot(r));
  if (dated.length) return dated.some(r => !r.available) ? -1 : 1;
  const weekly = rules.filter(r => r.date == null && r.weekday === wd && matchSlot(r));
  if (weekly.length) return weekly.some(r => !r.available) ? -1 : 1;
  // has weekly rules but none for this day => treat as not preferred
  return rules.some(r => r.date == null && r.available) ? -0.5 : 0;
}

function fieldFits(div, si) {
  if (!si.divList.includes(div.code)) return false;
  if (div.code === 'TB') return si.slot_code === 'tball' || si.slot_code === 'tsat';
  return si.slot_code !== 'seven';
}

/**
 * opts: { start, end, perWeek (override), saturdays (bool), replace (bool), seed, divisionIds? }
 */
function generatePractices(opts = {}) {
  const start = opts.start || setting('practice_start');
  const end = opts.end || T.addDays(T.mondayOf(setting('game_start')), 7 * setting('game_weeks', 8) - 1);
  const gameStart = setting('game_start');
  const tballStart = setting('tball_practice_start', start);
  const useSaturdays = opts.saturdays !== false;
  const rnd = seededRandom(opts.seed || Date.now());
  const ctx = leagueContext();
  const fields = loadFields();
  const parkOfField = new Map(fields.map(f => [f.id, f.park_id]));
  const avail = availabilityIndex('coach');

  if (opts.replace !== false) run(`DELETE FROM events WHERE type='practice' AND source='generated' AND date BETWEEN ? AND ?`, start, end);

  const placed = eventsBetween(start, end).map(e => ({ ...e, park_id: parkOfField.get(e.field_id), group: slotGroup(e.start) }));
  const teams = ctx.teams.filter(t => t.division.active && (!opts.divisionIds || opts.divisionIds.includes(t.division_id)));
  const fair = new Map(teams.map(t => [t.id, { asked: 0, got: 0 }]));
  const inserts = [];
  const short = [];

  for (let ws = T.mondayOf(start); ws <= end; ws = T.addDays(ws, 7)) {
    const we = T.addDays(ws, 6) > end ? end : T.addDays(ws, 6);
    const from = ws < start ? start : ws;
    const inSeason = ws >= T.mondayOf(gameStart);
    let free = freeSlots(from, we, 'practice', { fields, events: placed }).filter(si => useSaturdays || !si.saturday);
    const perTeam = new Map();
    teams.forEach(t => {
      if (t.division.code === 'TB' && we < tballStart) return perTeam.set(t.id, 0);
      perTeam.set(t.id, opts.perWeek ? Number(opts.perWeek) : (inSeason ? t.division.practices_per_week : Math.max(2, t.division.practices_per_week)));
    });
    const maxRounds = Math.max(0, ...perTeam.values());
    for (let round = 0; round < maxRounds; round++) {
      // fairness: lowest share of honored requests picks first
      const order = shuffle(teams.filter(t => perTeam.get(t.id) > round), rnd).sort((a, b) => {
        const fa = fair.get(a.id), fb = fair.get(b.id);
        const ra = fa.asked ? fa.got / fa.asked : 1, rb = fb.asked ? fb.got / fb.asked : 1;
        return ra - rb;
      });
      for (const t of order) {
        const rulesHead = t.headIds.flatMap(id => avail.get(id) || []);
        const rulesAll = t.coachIds.flatMap(id => avail.get(id) || []);
        const hasRules = rulesHead.length > 0;
        let best = null, bestCost = Infinity, bestScore = 0;
        const teamDates = new Set(placed.filter(e => eventTeams(e).includes(t.id)).map(e => e.date));
        const shared = placed.filter(e => eventTeams(e).some(tid => tid !== t.id && ctx.teamById.get(tid)?.coachIds.some(c => t.coachIds.includes(c))));
        for (const si of free) {
          if (!fieldFits(t.division, si)) continue;
          if (teamDates.has(si.date)) continue;
          if (t.division.code === 'TB' && si.date < tballStart) continue;
          // a coach on two teams: same night at the same park (early + late) is preferred
          let cost = shared.length ? coachOverlapCost(si, t.coachIds, shared, ctx, [t.id], 'practice') : 0;
          const score = availScore(rulesHead, si.date, si.group);
          cost -= 10 * score;
          cost -= 2 * availScore(rulesAll, si.date, si.group);
          if (teamDates.has(T.addDays(si.date, -1)) || teamDates.has(T.addDays(si.date, 1))) cost += 5;
          if (si.saturday) cost += 2;
          // board coverage: prefer slots/parks that don't already have a board member practicing
          if (t.boardCoachIds.length) {
            const covered = placed.some(e => e.date === si.date && e.park_id === si.park_id && e.group === si.group
              && eventTeams(e).some(tid => ctx.teamById.get(tid)?.boardCoachIds.length));
            cost += covered ? 6 : -3;
          }
          cost += rnd() * 0.5;
          if (cost < bestCost) { bestCost = cost; best = si; bestScore = score; }
        }
        if (!best) { short.push({ team: t.name, week: ws }); continue; }
        if (hasRules) { fair.get(t.id).asked++; if (bestScore > 0) fair.get(t.id).got++; }
        const weekNo = inSeason ? null : Math.floor(T.daysBetween(T.mondayOf(start), ws) / 7) + 1;
        const ev = { type: 'practice', date: best.date, field_id: best.field_id, park_id: best.park_id, slot_code: best.slot_code,
          start: best.start, end: best.end, division_id: t.division_id, team_id: t.id, group: best.group,
          week_label: inSeason ? `LL GAME WEEK ${Math.floor(T.daysBetween(T.mondayOf(gameStart), ws) / 7) + 1}` : `LL PRACTICE WEEK ${weekNo}` };
        placed.push(ev); inserts.push(ev);
        free = free.filter(si => !(si.date === best.date && si.field_id === best.field_id && T.minutes(si.start) < T.minutes(best.end) && T.minutes(best.start) < T.minutes(si.end)));
      }
    }
  }

  tx(() => {
    for (const e of inserts) run(`INSERT INTO events(type,date,field_id,slot_code,start,end,division_id,team_id,source,week_label,published)
                                   VALUES('practice',?,?,?,?,?,?,?,'generated',?,0)`, e.date, e.field_id, e.slot_code, e.start, e.end, e.division_id, e.team_id, e.week_label);
  });
  const fairness = teams.map(t => ({ team: t.name, ...fair.get(t.id) })).filter(f => f.asked);
  return { created: inserts.length, short, fairness, start, end };
}

module.exports = { generatePractices, availScore, availabilityIndex, fieldFits };
