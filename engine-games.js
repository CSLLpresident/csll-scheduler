// Game schedule generator.
// Rules: JM early only and both JM AA + AAA at both parks each night; Int/Jr/Sr in the 7:00 slot;
// balanced home/away, early/late and parks; no team twice in a night; coach conflicts respected;
// board-coached teams spread out so as many board members as possible are free for field duty.
const { all, run, tx, setting } = require('./db');
const T = require('./time');
const { loadFields, slotInstances, eventsBetween, overlaps, slotGroup } = require('./engine-slots');
const { leagueContext, eventTeams, seededRandom, shuffle, coachOverlapCost } = require('./engine-context');

// Circle-method round robin. Returns array of rounds, each an array of [home, away].
function roundRobin(teamIds, rnd) {
  const ids = shuffle(teamIds, rnd);
  if (ids.length % 2) ids.push(null);
  const n = ids.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i], b = ids[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop());
  }
  return rounds;
}

function slotFits(div, si, smLateOnly) {
  if (!si.divList.includes(div.code)) return false;
  switch (div.slot_rule) {
    case 'early': return si.slot_code === 'early';
    case 'late': return si.slot_code === 'late';
    case 'seven': return si.slot_code === 'seven';
    case 'tball': return si.slot_code === 'tball';
    default:
      if (smLateOnly && div.code.startsWith('SM')) return si.slot_code === 'late';
      return si.slot_code === 'early' || si.slot_code === 'late';
  }
}

/**
 * Build games. opts: { start, weeks, replace (bool), seed, divisionIds? }
 * Returns { created, unplaced: [...], weeks }
 */
function generateGames(opts = {}) {
  const start = T.mondayOf(opts.start || setting('game_start'));
  const weeks = Number(opts.weeks || setting('game_weeks', 8));
  const nights = setting('game_nights', [1, 2, 4, 5]);
  const smLateOnly = !!setting('sm_late_only', false);
  const rnd = seededRandom(opts.seed || Date.now());
  const end = T.addDays(start, weeks * 7 - 1);
  const ctx = leagueContext();
  const fields = loadFields();

  if (opts.replace !== false) {
    run(`DELETE FROM events WHERE type='game' AND source='generated' AND date BETWEEN ? AND ?`, start, end);
  }
  const existing = eventsBetween(start, end);
  const parkOfField = new Map(fields.map(f => [f.id, f.park_id]));
  const placed = existing.map(e => ({ ...e, park_id: parkOfField.get(e.field_id), group: slotGroup(e.start) })); // occupancy

  const divisions = ctx.divisions.filter(d => d.active && (!opts.divisionIds || opts.divisionIds.includes(d.id)));
  // matchups per division per week
  const plan = []; // {week, div, home, away}
  for (const d of divisions) {
    const teamIds = ctx.teams.filter(t => t.division_id === d.id).map(t => t.id);
    if (teamIds.length < 2) continue;
    const rounds = roundRobin(teamIds, rnd);
    let r = 0, cycle = 0;
    for (let w = 0; w < weeks; w++) {
      for (let g = 0; g < d.games_per_week; g++) {
        const pairs = rounds[r].map(([h, a]) => (cycle % 2 ? [a, h] : [h, a]));
        pairs.forEach(([h, a]) => plan.push({ week: w, div: d, home: h, away: a }));
        r++; if (r >= rounds.length) { r = 0; cycle++; }
      }
    }
  }

  const ruleOrder = { seven: 0, tball: 1, early: 2, late: 3, any: 4 };
  const stats = new Map(); // teamId -> {early, late, parks:{}, dates:Set}
  const st = id => stats.get(id) || stats.set(id, { early: 0, late: 0, parks: {}, dates: new Set() }).get(id);
  for (const e of placed) for (const t of eventTeams(e)) if (e.type === 'game') st(t).dates.add(e.date);

  const unplaced = [];
  const created = [];
  const inserts = [];

  const cloneStats = src => new Map([...src].map(([k, v]) => [k, { early: v.early, late: v.late, parks: { ...v.parks }, dates: new Set(v.dates) }]));
  const tries = Number(opts.tries || 40);
  const parkIds = [...new Set(fields.filter(f => f.kind === 'main').map(f => f.park_id))];

  for (let w = 0; w < weeks; w++) {
    const ws = T.addDays(start, w * 7), we = T.addDays(ws, 6);
    const candidates = slotInstances(ws, we, 'game', fields).filter(si => nights.includes(T.weekday(si.date)));
    const nightDates = [...new Set(candidates.map(c => c.date))];
    const basePlan = plan.filter(p => p.week === w);
    let bestTry = null;
    // Try several random orders for the week and keep the best one (fewest unplaced games, then JM park coverage)
    for (let attempt = 0; attempt < tries; attempt++) {
      const S = cloneStats(stats);
      const st = id => S.get(id) || S.set(id, { early: 0, late: 0, parks: {}, dates: new Set() }).get(id);
      const P = placed.slice();
      const ins = [], miss = [];
      let totalCost = 0;
      const weekPlan = shuffle(basePlan, rnd).sort((a, b) => ruleOrder[a.div.slot_rule] - ruleOrder[b.div.slot_rule]);
      for (const m of weekPlan) {
        const home = ctx.teamById.get(m.home), away = ctx.teamById.get(m.away);
        const coachIds = [...home.coachIds, ...away.coachIds];
        const boardHere = [...new Set([...home.boardCoachIds, ...away.boardCoachIds])];
        let best = null, bestCost = Infinity;
        for (const si of candidates) {
          if (!slotFits(m.div, si, smLateOnly)) continue;
          if (P.some(e => e.date === si.date && e.field_id === si.field_id && overlaps(e.start, e.end, si.start, si.end))) continue;
          if (st(m.home).dates.has(si.date) || st(m.away).dates.has(si.date)) continue;
          const sameNight = P.filter(e => e.date === si.date);
          // a coach on two teams: other night best; same night only at the same park in another slot
          let cost = coachOverlapCost(si, coachIds, sameNight, ctx, [m.home, m.away], 'game');
          const sameDivNight = sameNight.filter(e => e.type === 'game' && e.division_id === m.div.id);
          if (m.div.code.startsWith('JM')) {
            const atPark = sameDivNight.filter(e => e.park_id === si.park_id).length;
            const otherPark = sameDivNight.length - atPark;
            cost += 10 * Math.max(0, atPark - otherPark);
            if (atPark === 0) cost -= 6;
          }
          cost += 3 * sameDivNight.length;
          cost += 0.5 * sameNight.length;
          for (const tid of [m.home, m.away]) {
            const s2 = st(tid);
            if (s2.dates.has(T.addDays(si.date, -1)) || s2.dates.has(T.addDays(si.date, 1))) cost += 4;
            if (m.div.slot_rule === 'any') cost += 2 * Math.max(0, (si.group === 'early' ? s2.early - s2.late : s2.late - s2.early));
            const parkCount = s2.parks[si.park_id] || 0;
            const total = Object.values(s2.parks).reduce((a, b) => a + b, 0);
            cost += 1.5 * Math.max(0, parkCount - (total - parkCount));
          }
          if (boardHere.length) {
            const busyBoard = new Set();
            for (const e of sameNight) {
              if (e.type !== 'game' || e.group !== si.group) continue;
              for (const tid of eventTeams(e)) { const t = ctx.teamById.get(tid); if (t) t.boardCoachIds.forEach(b => busyBoard.add(b)); }
            }
            cost += 5 * busyBoard.size * boardHere.length;
          }
          cost += rnd() * 0.3;
          if (cost < bestCost) { bestCost = cost; best = si; }
        }
        if (!best) { miss.push({ week: w + 1, division: m.div.name, home: home.name, away: away.name }); continue; }
        totalCost += bestCost;
        const ev = {
          type: 'game', date: best.date, field_id: best.field_id, park_id: best.park_id, slot_code: best.slot_code,
          start: best.start, end: best.end, division_id: m.div.id, home_team_id: m.home, away_team_id: m.away,
          group: best.group, week_label: `LL GAME WEEK ${w + 1}`,
        };
        P.push(ev); ins.push(ev);
        for (const tid of [m.home, m.away]) {
          const s2 = st(tid); s2.dates.add(best.date); s2[best.group]++; s2.parks[best.park_id] = (s2.parks[best.park_id] || 0) + 1;
        }
      }
      // JM goal: each JM division at both parks every game night
      let gaps = 0;
      for (const d of divisions.filter(d => d.code.startsWith('JM'))) {
        if (!basePlan.some(p => p.div.id === d.id)) continue;
        for (const date of nightDates) {
          const g = ins.filter(e => e.division_id === d.id && e.date === date);
          const covered = new Set(g.map(e => e.park_id)).size;
          gaps += Math.max(0, Math.min(parkIds.length, Math.max(g.length, 2)) - covered);
        }
      }
      const score = miss.length * 1000 + gaps * 40 + totalCost;
      if (!bestTry || score < bestTry.score) bestTry = { score, S, ins, miss, gaps };
      if (!miss.length && !gaps && attempt >= 5) break;
    }
    for (const [k, v] of bestTry.S) stats.set(k, v);
    placed.push(...bestTry.ins); inserts.push(...bestTry.ins); unplaced.push(...bestTry.miss);
  }

  tx(() => {
    for (const e of inserts) {
      const r = run(`INSERT INTO events(type,date,field_id,slot_code,start,end,division_id,home_team_id,away_team_id,source,week_label,published)
                     VALUES('game',?,?,?,?,?,?,?,?,'generated',?,0)`,
        e.date, e.field_id, e.slot_code, e.start, e.end, e.division_id, e.home_team_id, e.away_team_id, e.week_label);
      created.push(r.lastInsertRowid);
    }
  });
  return { created: created.length, unplaced, start, end, weeks };
}

/** Free slots a rained-out game could move to (makeup week first, then anything after today) */
function makeupOptions(eventId) {
  const { get } = require('./db');
  const e = get('SELECT * FROM events WHERE id=?', eventId);
  if (!e) return [];
  const div = get('SELECT * FROM divisions WHERE id=?', e.division_id);
  const gameStart = setting('game_start');
  const weeks = setting('game_weeks', 8);
  const mStart = T.addDays(T.mondayOf(gameStart), weeks * 7);
  const mEnd = T.addDays(mStart, 7 * setting('makeup_weeks', 1) - 1);
  const from = T.today() > e.date ? T.today() : e.date;
  const { freeSlots } = require('./engine-slots');
  const busyDates = new Set(all(`SELECT date FROM events WHERE status<>'cancelled' AND id<>? AND (home_team_id IN (?,?) OR away_team_id IN (?,?) OR team_id IN (?,?))`,
    e.id, e.home_team_id, e.away_team_id, e.home_team_id, e.away_team_id, e.home_team_id, e.away_team_id).map(r => r.date));
  const list = freeSlots(from > mStart ? from : T.addDays(from, 1), T.addDays(mEnd, 21), 'game')
    .filter(si => slotFits(div, si, false) && !busyDates.has(si.date));
  list.sort((a, b) => {
    const am = a.date >= mStart && a.date <= mEnd ? 0 : 1, bm = b.date >= mStart && b.date <= mEnd ? 0 : 1;
    return am - bm || a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
  });
  return list.slice(0, 40).map(si => ({ ...si, makeupWeek: si.date >= mStart && si.date <= mEnd }));
}

module.exports = { generateGames, makeupOptions, slotFits, roundRobin };
