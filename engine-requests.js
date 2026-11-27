// Extra practice requests with a fair priority list, plus practice swaps and scrimmage invites.
//
// Priority list: every team (its head coach) has a rank, 1 = first pick. Requests on open slots wait until
// 3 days before the practice. At that moment the requester highest on the list wins, and that team drops
// to the bottom; everyone below moves up one. Inside the 3-day window open slots are first come, first served.
const { all, get, run, tx, setting, audit } = require('./db');
const T = require('./time');
const { freeSlots, slotGroup, overlaps } = require('./engine-slots');
const { notifyLater } = require('./notify');
const { leagueContext } = require('./engine-context');
const { fieldFits } = require('./engine-practices');

const deadlineDays = () => Number(setting('request_deadline_days', 3));
const slotStart = r => T.at(r.date, r.start || '00:00');
const decisionTime = r => new Date(slotStart(r).getTime() - deadlineDays() * 86400000);

// Head and assistant coaches manage a team's practices; practice coaches only see the schedule.
const MANAGE_SQL = "SELECT 1 FROM team_coaches WHERE team_id=? AND person_id=? AND role IN ('head','assistant')";
function coachIdsOf(teamId) { return all('SELECT person_id FROM team_coaches WHERE team_id=?', teamId).map(r => r.person_id); }

function seasonEnd() {
  const gs = T.mondayOf(setting('game_start'));
  return T.addDays(gs, 7 * (setting('game_weeks', 8) + setting('makeup_weeks', 1) + setting('tournament_weeks', 1)) - 1);
}

/** Open practice slots from now to the end of the season */
function openSlots(from = T.today(), to = seasonEnd()) {
  const now = new Date();
  const ps = setting('practice_start');
  if (ps && from < ps) from = ps;
  if (to > seasonEnd()) to = seasonEnd();
  if (from > to) return [];
  return freeSlots(from, to, 'practice').filter(si => T.at(si.date, si.start) > now);
}

function renumberRanks() {
  const teams = all('SELECT id FROM teams WHERE active=1 ORDER BY COALESCE(priority_rank, 999999), id');
  tx(() => teams.forEach((t, i) => run('UPDATE teams SET priority_rank=? WHERE id=?', i + 1, t.id)));
}
function moveToBottom(teamId) {
  const max = get('SELECT MAX(priority_rank) AS m FROM teams WHERE active=1').m || 0;
  run('UPDATE teams SET priority_rank=? WHERE id=?', max + 1, teamId);
  renumberRanks();
}
/** Start a fresh list when the schedule is released: random order, every team equal */
function resetPriority(seed = Date.now()) {
  const teams = all('SELECT id FROM teams WHERE active=1');
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const shuffled = teams.map(t => [rnd(), t.id]).sort((a, b) => a[0] - b[0]);
  tx(() => shuffled.forEach(([, id], i) => run('UPDATE teams SET priority_rank=? WHERE id=?', i + 1, id)));
}

function slotIsFree(date, fieldId, start, end, ignoreEventId = 0) {
  return !get(`SELECT id FROM events WHERE date=? AND field_id=? AND status<>'cancelled' AND id<>? AND start < ? AND end > ?`, date, fieldId, ignoreEventId, end, start);
}

function teamBusyThatDay(teamId, date) {
  return !!get(`SELECT id FROM events WHERE date=? AND status<>'cancelled' AND (team_id=? OR home_team_id=? OR away_team_id=?)`, date, teamId, teamId, teamId);
}

function createPracticeEvent(teamId, date, fieldId, slotCode, start, end, source = 'extra') {
  const team = get('SELECT * FROM teams WHERE id=?', teamId);
  const r = run(`INSERT INTO events(type,date,field_id,slot_code,start,end,division_id,team_id,source,published)
                 VALUES('practice',?,?,?,?,?,?,?,?,1)`, date, fieldId, slotCode, start, end, team.division_id, teamId, source);
  return r.lastInsertRowid;
}

function describe(date, fieldId, start) {
  const f = get('SELECT f.name, p.short FROM fields f JOIN parks p ON p.id=f.park_id WHERE f.id=?', fieldId);
  return `${T.shortDate(date)} ${T.fmt12(start)}, ${f.short} ${f.name}`;
}

/** A coach (head or assistant) asks for an open slot. Returns {status, request|event} */
function requestPractice(person, teamId, date, fieldId, slotCode, preference = null) {
  const team = get('SELECT * FROM teams WHERE id=?', teamId);
  if (!team) throw new Error('Team not found');
  if (!get(MANAGE_SQL, teamId, person.id) && !person.is_admin) throw new Error('Only the head coach or an assistant coach can schedule for this team.');
  const slot = get('SELECT * FROM field_slots WHERE field_id=? AND code=?', fieldId, slotCode);
  if (!slot) throw new Error('That slot does not exist.');
  const field = get('SELECT f.*, p.short FROM fields f JOIN parks p ON p.id=f.park_id WHERE f.id=?', fieldId);
  const div = get('SELECT * FROM divisions WHERE id=?', team.division_id);
  if (!fieldFits(div, { divList: field.divisions.split(','), slot_code: slotCode })) throw new Error(`${field.short} ${field.name} isn't used for ${div.name} practices.`);
  if (div.code === 'TB' && date < setting('tball_practice_start', '0000')) throw new Error(`T-Ball practices start ${T.shortDate(setting('tball_practice_start'))}.`);
  if (!slotIsFree(date, fieldId, slot.start, slot.end)) throw new Error('That slot is already taken.');
  if (T.at(date, slot.start) < new Date()) throw new Error('That slot has already started.');
  if (get(`SELECT id FROM practice_requests WHERE team_id=? AND date=? AND field_id=? AND slot_code=? AND status='pending'`, teamId, date, fieldId, slotCode))
    throw new Error('Your team already asked for this slot.');

  const r = { date, start: slot.start };
  if (decisionTime(r) <= new Date()) {
    // inside the window: first come, first served
    if (teamBusyThatDay(teamId, date)) throw new Error('Your team already has a game or practice that day.');
    const evId = createPracticeEvent(teamId, date, fieldId, slotCode, slot.start, slot.end);
    run(`INSERT INTO practice_requests(team_id,requested_by,date,field_id,slot_code,preference,status,event_id,decided_at)
         VALUES(?,?,?,?,?,1,'awarded',?,datetime('now'))`, teamId, person.id, date, fieldId, slotCode, evId);
    moveToBottom(teamId);
    loseOthers(date, fieldId, slot.start, slot.end, teamId);
    audit(person.id, 'practice.fcfs', { teamId, date, fieldId, slotCode });
    notifyLater(coachIdsOf(teamId), { title: 'Extra practice booked', body: `${team.name}: ${describe(date, fieldId, slot.start)}.`, sms: false });
    return { status: 'awarded', eventId: evId };
  }
  const pref = preference || ((get(`SELECT MAX(preference) AS m FROM practice_requests WHERE team_id=? AND status='pending'`, teamId).m || 0) + 1);
  const ins = run(`INSERT INTO practice_requests(team_id,requested_by,date,field_id,slot_code,preference) VALUES(?,?,?,?,?,?)`,
    teamId, person.id, date, fieldId, slotCode, pref);
  audit(person.id, 'practice.request', { teamId, date, fieldId, slotCode });
  warnAtRisk();
  return { status: 'pending', requestId: ins.lastInsertRowid, decidesAt: decisionTime(r).toISOString() };
}

function loseOthers(date, fieldId, start, end, winnerTeam) {
  const losers = all(`SELECT r.*, fs.start, fs.end FROM practice_requests r JOIN field_slots fs ON fs.field_id=r.field_id AND fs.code=r.slot_code
                      WHERE r.status='pending' AND r.date=? AND r.field_id=? AND r.team_id<>?`, date, fieldId, winnerTeam)
    .filter(r => overlaps(r.start, r.end, start, end));
  for (const l of losers) {
    run(`UPDATE practice_requests SET status='lost', decided_at=datetime('now') WHERE id=?`, l.id);
    const team = get('SELECT name FROM teams WHERE id=?', l.team_id);
    notifyLater(coachIdsOf(l.team_id), { title: 'Practice request not awarded', body: `${team.name}: ${describe(l.date, l.field_id, l.start)} went to a team ahead of you on the list. Pick another open slot in the app.` });
  }
}

/** Requests with someone ahead of them on the list for the same slot: warn once. */
function warnAtRisk() {
  const pending = pendingWithStatus();
  for (const r of pending.filter(p => p.atRisk && !p.warned)) {
    run('UPDATE practice_requests SET warned=1 WHERE id=?', r.id);
    notifyLater(coachIdsOf(r.team_id), {
      title: 'You may miss a practice slot',
      body: `${r.team_name}: another team ahead of you on the priority list asked for ${describe(r.date, r.field_id, r.start)}. You might want to request another slot too.`,
    });
  }
}

/** All pending requests with live "at risk" flag and current rank */
function pendingWithStatus(teamId = null) {
  const rows = all(`SELECT r.*, t.name AS team_name, t.priority_rank, fs.start, fs.end, f.name AS field_name, p.short AS park_short
                    FROM practice_requests r JOIN teams t ON t.id=r.team_id JOIN field_slots fs ON fs.field_id=r.field_id AND fs.code=r.slot_code
                    JOIN fields f ON f.id=r.field_id JOIN parks p ON p.id=f.park_id WHERE r.status='pending' ORDER BY r.date, fs.start`);
  for (const r of rows) {
    const rivals = rows.filter(o => o.id !== r.id && o.date === r.date && o.field_id === r.field_id && overlaps(o.start, o.end, r.start, r.end));
    r.competitors = rivals.length;
    r.atRisk = rivals.some(o => o.priority_rank < r.priority_rank);
    r.decidesAt = decisionTime(r).toISOString();
  }
  return teamId ? rows.filter(r => r.team_id === teamId) : rows;
}

/**
 * Award every request whose decision time has passed. Draft order: the team highest on the list among
 * those waiting gets its first choice, drops to the bottom, and so on until nothing else can be awarded.
 */
function processDeadlines(now = new Date()) {
  const due = pendingWithStatus().filter(r => new Date(r.decidesAt) <= now);
  if (!due.length) return { awarded: 0, lost: 0 };
  let awarded = 0, lost = 0;
  const remaining = due.slice();
  while (remaining.length) {
    // drop requests that can no longer be awarded
    for (let i = remaining.length - 1; i >= 0; i--) {
      const r = remaining[i];
      if (!slotIsFree(r.date, r.field_id, r.start, r.end) || teamBusyThatDay(r.team_id, r.date)) {
        run(`UPDATE practice_requests SET status='lost', decided_at=datetime('now') WHERE id=?`, r.id);
        notifyLater(coachIdsOf(r.team_id), { title: 'Practice request not awarded', body: `${r.team_name}: ${describe(r.date, r.field_id, r.start)} is no longer available.` });
        remaining.splice(i, 1); lost++;
      }
    }
    if (!remaining.length) break;
    const ranks = new Map(all('SELECT id, priority_rank FROM teams').map(t => [t.id, t.priority_rank]));
    const top = remaining.slice().sort((a, b) => ranks.get(a.team_id) - ranks.get(b.team_id) || a.preference - b.preference || a.id - b.id)[0];
    const choice = remaining.filter(r => r.team_id === top.team_id).sort((a, b) => a.preference - b.preference || a.id - b.id)[0];
    const evId = createPracticeEvent(choice.team_id, choice.date, choice.field_id, choice.slot_code, choice.start, choice.end);
    run(`UPDATE practice_requests SET status='awarded', event_id=?, decided_at=datetime('now') WHERE id=?`, evId, choice.id);
    remaining.splice(remaining.indexOf(choice), 1);
    moveToBottom(choice.team_id);
    awarded++;
    notifyLater(coachIdsOf(choice.team_id), { title: 'Extra practice awarded', body: `${choice.team_name}: ${describe(choice.date, choice.field_id, choice.start)}.` });
    loseOthers(choice.date, choice.field_id, choice.start, choice.end, choice.team_id);
    for (let i = remaining.length - 1; i >= 0; i--) {
      const r = remaining[i];
      if (r.date === choice.date && r.field_id === choice.field_id && overlaps(r.start, r.end, choice.start, choice.end)) { remaining.splice(i, 1); lost++; }
    }
  }
  warnAtRisk();
  return { awarded, lost };
}

function cancelRequest(person, requestId) {
  const r = get('SELECT * FROM practice_requests WHERE id=?', requestId);
  if (!r || r.status !== 'pending') throw new Error('Request not found.');
  if (!person.is_admin && !get(MANAGE_SQL, r.team_id, person.id)) throw new Error('Not your team.');
  run(`UPDATE practice_requests SET status='cancelled', decided_at=datetime('now') WHERE id=?`, requestId);
}

function reorderRequests(person, teamId, orderedIds) {
  if (!person.is_admin && !get(MANAGE_SQL, teamId, person.id)) throw new Error('Not your team.');
  tx(() => orderedIds.forEach((id, i) => run(`UPDATE practice_requests SET preference=? WHERE id=? AND team_id=? AND status='pending'`, i + 1, id, teamId)));
}

// ---------------- swaps & scrimmages ----------------
function proposePracticeSwap(person, eventA, eventB, message = '') {
  const a = get('SELECT * FROM events WHERE id=?', eventA), b = get('SELECT * FROM events WHERE id=?', eventB);
  if (!a || !b || a.type !== 'practice' || b.type !== 'practice') throw new Error('Both must be practices.');
  if (!get(MANAGE_SQL, a.team_id, person.id) && !person.is_admin) throw new Error('The first practice must be your team\'s.');
  if (a.team_id === b.team_id) throw new Error('Pick another team\'s practice.');
  const id = run(`INSERT INTO swaps(kind,from_person,from_team,to_team,event_a,event_b,message) VALUES('practice',?,?,?,?,?,?)`,
    person.id, a.team_id, b.team_id, eventA, eventB, message).lastInsertRowid;
  const fromTeam = get('SELECT name FROM teams WHERE id=?', a.team_id).name;
  notifyLater(coachIdsOf(b.team_id), { title: 'Practice swap offered', body: `${fromTeam} offers ${describe(a.date, a.field_id, a.start)} for your ${describe(b.date, b.field_id, b.start)}. Accept or decline in the app.` });
  return id;
}

function inviteScrimmage(person, eventA, toTeamId, message = '') {
  const a = get('SELECT * FROM events WHERE id=?', eventA);
  if (!a || a.type !== 'practice') throw new Error('Pick one of your practices.');
  if (!get(MANAGE_SQL, a.team_id, person.id) && !person.is_admin) throw new Error('Not your team\'s practice.');
  const other = get('SELECT * FROM teams WHERE id=?', toTeamId);
  if (!other || other.division_id !== a.division_id) throw new Error('Scrimmages are between two teams in the same division.');
  if (teamBusyThatDay(toTeamId, a.date)) throw new Error(`${other.name} already has something that day.`);
  const id = run(`INSERT INTO swaps(kind,from_person,from_team,to_team,event_a,message) VALUES('scrimmage',?,?,?,?,?)`, person.id, a.team_id, toTeamId, eventA, message).lastInsertRowid;
  const fromTeam = get('SELECT name FROM teams WHERE id=?', a.team_id).name;
  notifyLater(coachIdsOf(toTeamId), { title: 'Scrimmage invite', body: `${fromTeam} invites you to scrimmage ${describe(a.date, a.field_id, a.start)}. Accept or decline in the app.` });
  return id;
}

function respondSwap(person, swapId, accept) {
  const s = get('SELECT * FROM swaps WHERE id=?', swapId);
  if (!s || s.status !== 'open') throw new Error('That offer is no longer open.');
  if (s.kind === 'umpire') throw new Error('Use the umpire shift tools.');
  const isTarget = get(MANAGE_SQL, s.to_team, person.id) || person.is_admin;
  const isSender = s.from_person === person.id;
  if (!accept) {
    if (!isTarget && !isSender) throw new Error('Not your offer.');
    run(`UPDATE swaps SET status=?, done_at=datetime('now') WHERE id=?`, isSender ? 'cancelled' : 'declined', swapId);
    if (!isSender) notifyLater([s.from_person], { title: 'Offer declined', body: 'Your practice offer was declined.', sms: false });
    return 'declined';
  }
  if (!isTarget) throw new Error('Only the other team\'s coaches can accept.');
  const a = get('SELECT * FROM events WHERE id=?', s.event_a);
  if (s.kind === 'practice') {
    const b = get('SELECT * FROM events WHERE id=?', s.event_b);
    if (!a || !b || a.team_id !== s.from_team || b.team_id !== s.to_team) throw new Error('One of those practices has changed. Ask for a new swap.');
    tx(() => {
      run('UPDATE events SET team_id=?, updated_at=datetime(\'now\') WHERE id=?', s.to_team, a.id);
      run('UPDATE events SET team_id=?, updated_at=datetime(\'now\') WHERE id=?', s.from_team, b.id);
      run(`UPDATE swaps SET status='done', to_person=?, done_at=datetime('now') WHERE id=?`, person.id, swapId);
    });
  } else {
    if (!a || a.team_id !== s.from_team) throw new Error('That practice has changed.');
    if (teamBusyThatDay(s.to_team, a.date)) throw new Error('Your team already has something that day.');
    tx(() => {
      run(`UPDATE events SET type='scrimmage', home_team_id=?, away_team_id=?, updated_at=datetime('now') WHERE id=?`, s.from_team, s.to_team, a.id);
      run(`UPDATE swaps SET status='done', to_person=?, done_at=datetime('now') WHERE id=?`, person.id, swapId);
    });
  }
  notifyLater(coachIdsOf(s.from_team).concat(coachIdsOf(s.to_team)), { title: s.kind === 'practice' ? 'Practice swap done' : 'Scrimmage set', body: describe(a.date, a.field_id, a.start), sms: false });
  audit(person.id, 'swap.accept', { swapId });
  return 'done';
}

module.exports = {
  openSlots, requestPractice, processDeadlines, pendingWithStatus, cancelRequest, reorderRequests, warnAtRisk,
  resetPriority, moveToBottom, renumberRanks, proposePracticeSwap, inviteScrimmage, respondSwap, slotIsFree, teamBusyThatDay,
  createPracticeEvent, describe, coachIdsOf, seasonEnd, decisionTime,
};
