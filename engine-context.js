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
    teamById.set(t.id, t);
  }
  // person -> teams they coach (to catch coaches on two teams)
  const teamsOfCoach = new Map();
  for (const c of coaches) (teamsOfCoach.get(c.person_id) || teamsOfCoach.set(c.person_id, []).get(c.person_id)).push(c.team_id);
  return { divisions, divById, teams, teamById, teamsOfCoach };
}

function eventTeams(e) { return [e.home_team_id, e.away_team_id, e.team_id].filter(Boolean); }

// Deterministic shuffle so a rebuild with the same seed gives the same schedule
function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
function shuffle(arr, rnd = Math.random) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

module.exports = { leagueContext, eventTeams, seededRandom, shuffle };
