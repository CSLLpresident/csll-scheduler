// Shared lookups for the scheduling engines.
const { all } = require('./db');

function leagueContext() {
  const divisions = all('SELECT * FROM divisions ORDER BY sort');
  const divById = new Map(divisions.map(d => [d.id, d]));
  const teams = all('SELECT * FROM teams WHERE active=1 ORDER BY division_id, name');
  const coaches = all(`SELECT tc.team_id, tc.role, p.id AS person_id, p.is_board, p.is_admin, p.first, p.last
                       FROM team_coaches tc JOIN people p ON p.id=tc.person_id WHERE p.active=1`);
  const teamById = new Map();
  for (const t of teams) {
    t.division = divById.get(t.division_id);
    t.coaches = coaches.filter(c => c.team_id === t.id);
    t.coachIds = t.coaches.map(c => c.person_id);
    t.headIds = t.coaches.filter(c => c.role === 'head').map(c => c.person_id);
    t.boardCoachIds = t.coaches.filter(c => c.is_board || c.is_admin).map(c => c.person_id);
    t.schedulerIds = t.coaches.filter(c => c.role !== 'practice').map(c => c.person_id);
    teamById.set(t.id, t);
  }
  // person -> teams they coach (to catch coaches on two teams)
  const teamsOfCoach = new Map();
  for (const c of coaches) (teamsOfCoach.get(c.person_id) || teamsOfCoach.set(c.person_id, []).get(c.person_id)).push(c.team_id);
  return { divisions, divById, teams, teamById, teamsOfCoach };
}

function eventTeams(e) { return [e.home_team_id, e.away_team_id, e.team_id].filter(Boolean); }

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
/**
 * Cost of putting a slot on a night when a coach of this team also coaches another team with events that night.
 * Same time = last resort. Different park = avoid. Same park, other slot = fine for games (other nights preferred)
 * and preferred for practices (one trip to the park), same field better still.
 */
function coachOverlapCost(si, coachIds, events, ctx, ownTeamIds, kind) {
  let cost = 0;
  for (const e of events) {
    if (e.date !== si.date) continue;
    const shares = eventTeams(e).some(tid => !ownTeamIds.includes(tid) && ctx.teamById.get(tid)?.coachIds.some(c => coachIds.includes(c)));
    if (!shares) continue;
    if (toMin(si.start) < toMin(e.end) && toMin(e.start) < toMin(si.end)) cost += 1000;
    else if (e.park_id !== si.park_id) cost += 300;
    else if (kind === 'game') cost += e.field_id === si.field_id ? 6 : 8;
    else cost += (e.type === 'game' ? -4 : -12) - (e.field_id === si.field_id ? 3 : 0);
  }
  return cost;
}

// Deterministic shuffle so a rebuild with the same seed gives the same schedule
function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
function shuffle(arr, rnd = Math.random) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

module.exports = { leagueContext, eventTeams, seededRandom, shuffle, coachOverlapCost };
