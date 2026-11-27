// CSLL Schedules server
process.env.TZ = process.env.TZ || 'America/Chicago';
const path = require('path');
const express = require('express');
const { all, get, run, tx, setting, setSetting, audit } = require('./db');
const { loadDefaults } = require('./defaults');
const T = require('./time');
const auth = require('./auth');
const { notify, notifyLater, smsEnabled, emailEnabled, normalizePhone } = require('./notify');
const { generateGames, makeupOptions } = require('./engine-games');
const { generatePractices } = require('./engine-practices');
const U = require('./engine-umpires');
const R = require('./engine-requests');
const D = require('./engine-duty');
const X = require('./exports');
const I = require('./imports');
const { slotGroup } = require('./engine-slots');
const jobs = require('./jobs');
const CF = require('./engine-conflicts');
const { currentSeason, activateSeason, createSeason } = require('./db');

loadDefaults();
bootstrapAdmin();

const app = express();
app.use(express.json({ limit: '5mb' }));
// Only these files are served to browsers (everything else in this folder is server code)
const PUBLIC_FILES = new Set(['index.html', 'app.css', 'logo.png', 'manifest.json',
  'ui-core.js', 'ui-home.js', 'ui-schedule.js', 'ui-practices.js', 'ui-availability.js', 'ui-duty.js', 'ui-umpires.js', 'ui-admin.js', 'ui-main.js']);
app.get('/:file', (req, res, next) => {
  if (!PUBLIC_FILES.has(req.params.file)) return next();
  res.sendFile(path.join(__dirname, req.params.file), { maxAge: '1h' });
});

// ---------- auth middleware ----------
app.use((req, res, next) => { req.person = auth.sessionPerson(req); req.roles = auth.rolesOf(req.person); next(); });
const need = (check) => (req, res, next) => {
  if (!req.person) return res.status(401).json({ error: 'Please log in.' });
  if (check && !check(req.roles, req)) return res.status(403).json({ error: 'You don\'t have access to that.' });
  next();
};
const isAdmin = r => r.admin, isBoard = r => r.board, isSched = r => r.scheduler, isCoord = r => r.umpCoord;
const wrap = fn => async (req, res) => {
  try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); }
  catch (e) { console.error(e); res.status(400).json({ error: e.message || 'Something went wrong.' }); }
};

function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL, phone = process.env.ADMIN_PHONE;
  if (!email && !phone) return;
  if (get('SELECT 1 FROM people WHERE is_admin=1')) return;
  const existing = auth.findPerson(email || phone);
  if (existing) run('UPDATE people SET is_admin=1, is_board=1 WHERE id=?', existing.id);
  else run(`INSERT INTO people(first,last,email,phone,is_admin,is_board,is_president,cal_token) VALUES(?,?,?,?,1,1,1,lower(hex(randomblob(16))))`,
    process.env.ADMIN_FIRST || 'League', process.env.ADMIN_LAST || 'President', email || null, normalizePhone(phone));
  console.log('[setup] admin account ready for', email || phone);
}

// ---------- auth ----------
app.post('/api/auth/request', wrap(async req => auth.requestCode(req.body.identifier)));
app.post('/api/auth/verify', wrap(async (req, res) => {
  const r = auth.verifyCode(req.body.identifier, req.body.code);
  if (!r.ok) return res.status(400).json({ error: r.error });
  const secure = (process.env.APP_URL || '').startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `csll_session=${r.token}; HttpOnly; Path=/; Max-Age=${Math.floor(r.maxAge / 1000)}; SameSite=Lax${secure}`);
  return { ok: true };
}));
app.post('/api/auth/logout', wrap(async (req, res) => { auth.logout(req); res.setHeader('Set-Cookie', 'csll_session=; Path=/; Max-Age=0'); return { ok: true }; }));

// ---------- me & reference data ----------
app.get('/api/me', need(), wrap(async req => {
  const p = req.person;
  if (!p.cal_token) { const t = require('crypto').randomBytes(16).toString('hex'); run('UPDATE people SET cal_token=? WHERE id=?', t, p.id); p.cal_token = t; }
  return {
    person: { id: p.id, first: p.first, last: p.last, email: p.email, phone: p.phone, notify_sms: p.notify_sms, notify_email: p.notify_email, cal_token: p.cal_token },
    roles: req.roles,
    unread: get('SELECT COUNT(*) AS n FROM notifications WHERE person_id=? AND read_at IS NULL', p.id).n,
    demo: auth.DEMO,
  };
}));
app.patch('/api/me', need(), wrap(async req => {
  const b = req.body;
  run('UPDATE people SET notify_sms=COALESCE(?,notify_sms), notify_email=COALESCE(?,notify_email) WHERE id=?',
    b.notify_sms == null ? null : +!!b.notify_sms, b.notify_email == null ? null : +!!b.notify_email, req.person.id);
  return { ok: true };
}));

app.get('/api/meta', need(), wrap(async req => {
  const fields = all('SELECT f.*, p.short AS park_short FROM fields f JOIN parks p ON p.id=f.park_id ORDER BY p.sort, f.sort');
  const slots = all('SELECT * FROM field_slots');
  fields.forEach(f => { f.slots = slots.filter(s => s.field_id === f.id); });
  const teams = all(`SELECT t.*, d.code AS division_code, d.name AS division_name FROM teams t JOIN divisions d ON d.id=t.division_id WHERE t.active=1 ORDER BY d.sort, t.name`);
  const coaches = all(`SELECT tc.team_id, tc.role, p.id, p.first, p.last, p.phone, p.email, p.is_board FROM team_coaches tc JOIN people p ON p.id=tc.person_id WHERE p.active=1`);
  teams.forEach(t => { t.coaches = coaches.filter(c => c.team_id === t.id); });
  const keys = ['season_name', 'practice_start', 'tball_practice_start', 'game_start', 'game_weeks', 'makeup_weeks', 'tournament_weeks', 'game_nights',
    'request_deadline_days', 'sm_late_only', 'duty_reminder_hours', 'duty_quiet_hours', 'duty_quiet_until', 'duty_lead_minutes', 'jm_pull_order'];
  return {
    divisions: all('SELECT * FROM divisions ORDER BY sort'),
    parks: all('SELECT * FROM parks ORDER BY sort'),
    fields, teams,
    settings: Object.fromEntries(keys.map(k => [k, setting(k)])),
    seasonEnd: R.seasonEnd(),
    season: currentSeason(),
    today: T.today(),
  };
}));

// ---------- schedule ----------
function eventQuery(q, person, roles) {
  const where = ["1=1"], p = [];
  if (q.start) { where.push('e.date >= ?'); p.push(q.start); }
  if (q.end) { where.push('e.date <= ?'); p.push(q.end); }
  if (q.division) { where.push('e.division_id = ?'); p.push(Number(q.division)); }
  if (q.team) { where.push('(e.team_id=? OR e.home_team_id=? OR e.away_team_id=?)'); p.push(+q.team, +q.team, +q.team); }
  if (q.park) { where.push('f.park_id = ?'); p.push(Number(q.park)); }
  if (q.field) { where.push('e.field_id = ?'); p.push(Number(q.field)); }
  if (q.type) { const ts = String(q.type).split(','); where.push(`e.type IN (${ts.map(() => '?').join(',')})`); p.push(...ts); }
  if (q.mine === '1') {
    const ids = roles.coachTeams.map(t => t.id);
    where.push(ids.length ? `(e.team_id IN (${ids.join(',')}) OR e.home_team_id IN (${ids.join(',')}) OR e.away_team_id IN (${ids.join(',')}))` : '0');
  }
  if (!roles.scheduler) where.push('e.published = 1');
  if (q.status !== 'all') where.push("e.status <> 'cancelled'");
  const rows = all(`SELECT e.*, d.name AS division_name, d.code AS division_code, d.color AS division_color, f.name AS field_name, f.park_id, pk.short AS park_short,
                th.name AS home_name, ta.name AS away_name, tt.name AS team_name,
                (SELECT COUNT(*) FROM ump_assignments a WHERE a.event_id=e.id AND a.status<>'sick') AS ump_slots,
                (SELECT COUNT(*) FROM ump_assignments a WHERE a.event_id=e.id AND a.status<>'sick' AND a.person_id IS NOT NULL) AS ump_filled,
                (SELECT GROUP_CONCAT(pp.first || ' ' || pp.last || ' (' || a.position || ')', ', ') FROM ump_assignments a JOIN people pp ON pp.id=a.person_id
                  WHERE a.event_id=e.id AND a.status IN ('assigned','present')) AS umpires
              FROM events e LEFT JOIN divisions d ON d.id=e.division_id LEFT JOIN fields f ON f.id=e.field_id LEFT JOIN parks pk ON pk.id=f.park_id
              LEFT JOIN teams th ON th.id=e.home_team_id LEFT JOIN teams ta ON ta.id=e.away_team_id LEFT JOIN teams tt ON tt.id=e.team_id
              WHERE ${where.join(' AND ')} ORDER BY e.date, e.start, pk.sort, f.sort LIMIT 5000`, ...p).map(e => ({ ...e }));
  if (q.start && q.end && rows.length) {
    const cmap = CF.conflictsByEvent(q.start, q.end);
    for (const e of rows) e.conflicts = cmap.get(e.id) || [];
  }
  return rows;
}
app.get('/api/events', need(), wrap(async req => eventQuery(req.query, req.person, req.roles)));

app.post('/api/events', need(isSched), wrap(async req => {
  const b = req.body;
  const slot = b.slotCode ? get('SELECT * FROM field_slots WHERE field_id=? AND code=?', b.fieldId, b.slotCode) : null;
  const start = b.start || slot?.start, end = b.end || slot?.end;
  if (!b.date || !b.fieldId || !start || !end) throw new Error('Date, field and time are required.');
  if (!R.slotIsFree(b.date, b.fieldId, start, end)) throw new Error('That field is already booked at that time.');
  const r = run(`INSERT INTO events(type,date,field_id,slot_code,start,end,division_id,home_team_id,away_team_id,team_id,title,notes,source,published)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'manual',?)`, b.type || 'practice', b.date, b.fieldId, b.slotCode || null, start, end,
    b.divisionId || null, b.homeTeamId || null, b.awayTeamId || null, b.teamId || null, b.title || null, b.notes || null, b.published === false ? 0 : 1);
  audit(req.person.id, 'event.create', b);
  const warnings = CF.checkPlacement({ teamIds: [b.teamId, b.homeTeamId, b.awayTeamId], date: b.date, start, end, fieldId: b.fieldId, excludeIds: [Number(r.lastInsertRowid)] });
  return { id: r.lastInsertRowid, warnings };
}));

app.patch('/api/events/:id', need(isSched), wrap(async req => {
  const e = get('SELECT * FROM events WHERE id=?', req.params.id);
  if (!e) throw new Error('Not found');
  const b = req.body;
  const next = { ...e };
  if (b.date) next.date = b.date;
  if (b.fieldId) next.field_id = b.fieldId;
  if (b.slotCode) { const s = get('SELECT * FROM field_slots WHERE field_id=? AND code=?', next.field_id, b.slotCode); if (s) { next.slot_code = s.code; next.start = s.start; next.end = s.end; } }
  if (b.start) next.start = b.start; if (b.end) next.end = b.end;
  if ((b.date || b.fieldId || b.slotCode || b.start) && !R.slotIsFree(next.date, next.field_id, next.start, next.end, e.id)) throw new Error('That field is already booked at that time.');
  for (const k of ['status', 'notes', 'title', 'type']) if (b[k] !== undefined) next[k] = b[k];
  for (const [k, col] of [['homeTeamId', 'home_team_id'], ['awayTeamId', 'away_team_id'], ['teamId', 'team_id'], ['divisionId', 'division_id']]) if (b[k] !== undefined) next[col] = b[k];
  if (b.published !== undefined) next.published = +!!b.published;
  run(`UPDATE events SET type=?, date=?, field_id=?, slot_code=?, start=?, end=?, status=?, notes=?, title=?, home_team_id=?, away_team_id=?, team_id=?, division_id=?, published=?, updated_at=datetime('now') WHERE id=?`,
    next.type, next.date, next.field_id, next.slot_code, next.start, next.end, next.status, next.notes, next.title, next.home_team_id, next.away_team_id, next.team_id, next.division_id, next.published, e.id);
  audit(req.person.id, 'event.update', { id: e.id, ...b });
  const warnings = next.status === 'scheduled' ? CF.checkPlacement({ teamIds: [next.team_id, next.home_team_id, next.away_team_id], date: next.date, start: next.start, end: next.end, fieldId: next.field_id, excludeIds: [e.id] }) : [];
  // tell affected coaches and umpires when a published event moves or is cancelled
  const moved = next.date !== e.date || next.field_id !== e.field_id || next.start !== e.start;
  const statusChanged = next.status !== e.status;
  if (e.published && (moved || statusChanged) && b.notify !== false) {
    const teamIds = [next.team_id, next.home_team_id, next.away_team_id].filter(Boolean);
    const people = teamIds.flatMap(R.coachIdsOf).concat(all('SELECT person_id FROM ump_assignments WHERE event_id=? AND person_id IS NOT NULL', e.id).map(r => r.person_id));
    const what = statusChanged && next.status !== 'scheduled' ? `${next.status === 'rainout' ? 'Rained out' : 'Cancelled'}: ` : 'Moved: ';
    notifyLater(people, { title: 'Schedule change', body: `${what}${R.describe(e.date, e.field_id, e.start)}${moved ? ' -> ' + R.describe(next.date, next.field_id, next.start) : ''}` });
  }
  return { ok: true, warnings };
}));
app.delete('/api/events/:id', need(isSched), wrap(async req => { run('DELETE FROM events WHERE id=?', req.params.id); audit(req.person.id, 'event.delete', req.params.id); return { ok: true }; }));
app.get('/api/events/:id/makeup', need(isSched), wrap(async req => makeupOptions(Number(req.params.id))));

app.post('/api/schedule/publish', need(isSched), wrap(async req => {
  const { start, end, type } = req.body;
  const r = run(`UPDATE events SET published=1 WHERE published=0 AND date BETWEEN ? AND ?${type ? ' AND type=?' : ''}`, start, end, ...(type ? [type] : []));
  audit(req.person.id, 'schedule.publish', req.body);
  if (req.body.notifyAll) notifyLater(all('SELECT id FROM people WHERE active=1').map(r => r.id), { title: 'Schedule released', body: `The ${type || ''} schedule for ${T.shortDate(start)} to ${T.shortDate(end)} is posted. Open the app to see it.`, sms: false });
  return { published: Number(r.changes) };
}));

// ---------- builders ----------
app.post('/api/build/games', need(isSched), wrap(async req => { const r = generateGames(req.body); audit(req.person.id, 'build.games', r); return r; }));
app.post('/api/build/practices', need(isSched), wrap(async req => { const r = generatePractices(req.body); audit(req.person.id, 'build.practices', { created: r.created }); return r; }));
app.post('/api/build/umpires', need(isCoord), wrap(async req => { const r = U.generateUmpires(req.body); audit(req.person.id, 'build.umpires', r); return r; }));
app.post('/api/build/duty', need(isBoard), wrap(async req => ({ shifts: D.rebuildShifts(req.body.start, req.body.end) })));
app.post('/api/build/clear', need(isAdmin), wrap(async req => {
  const { type, start, end, onlyGenerated } = req.body;
  const r = run(`DELETE FROM events WHERE type=? AND date BETWEEN ? AND ?${onlyGenerated !== false ? " AND source='generated'" : ''}`, type, start, end);
  audit(req.person.id, 'build.clear', req.body);
  return { deleted: Number(r.changes) };
}));

// ---------- availability ----------
app.get('/api/availability', need(), wrap(async req => {
  const pid = req.query.person && (req.roles.board || req.roles.umpCoord) ? Number(req.query.person) : req.person.id;
  return all('SELECT * FROM availability WHERE person_id=? AND kind=? ORDER BY date, weekday', pid, req.query.kind || 'coach');
}));
app.put('/api/availability', need(), wrap(async req => {
  const { kind, rules } = req.body;
  if (!['coach', 'umpire', 'board'].includes(kind)) throw new Error('Unknown availability type');
  tx(() => {
    run('DELETE FROM availability WHERE person_id=? AND kind=?', req.person.id, kind);
    for (const r of rules || []) run('INSERT INTO availability(person_id,kind,weekday,date,slot_code,available,note) VALUES(?,?,?,?,?,?,?)',
      req.person.id, kind, r.date ? null : r.weekday, r.date || null, r.slot_code || 'any', r.available ? 1 : 0, r.note || null);
  });
  return { ok: true };
}));

// ---------- practice requests & priority list ----------
app.get('/api/practice/open', need(), wrap(async req => {
  const team = req.query.team ? get('SELECT t.*, d.code FROM teams t JOIN divisions d ON d.id=t.division_id WHERE t.id=?', req.query.team) : null;
  const start = req.query.start || T.today(), end = req.query.end || T.addDays(start, 13);
  const { fieldFits } = require('./engine-practices');
  let list = R.openSlots(start, end);
  if (team) list = list.filter(si => fieldFits({ code: team.code }, si) && (team.code !== 'TB' || si.date >= setting('tball_practice_start', '0000')));
  const pending = R.pendingWithStatus();
  return list.map(si => {
    const reqs = pending.filter(p => p.date === si.date && p.field_id === si.field_id && p.slot_code === si.slot_code);
    return { ...si, requests: reqs.length, bestRank: reqs.length ? Math.min(...reqs.map(r => r.priority_rank)) : null,
      decidesAt: R.decisionTime({ date: si.date, start: si.start }).toISOString(),
      fcfs: R.decisionTime({ date: si.date, start: si.start }) <= new Date() };
  });
}));
app.get('/api/practice/requests', need(), wrap(async req => {
  const teamId = req.query.team ? Number(req.query.team) : null;
  const mineTeams = req.roles.coachTeams.map(t => t.id);
  const list = R.pendingWithStatus(teamId).filter(r => req.roles.admin || mineTeams.includes(r.team_id));
  const history = all(`SELECT r.*, t.name AS team_name, f.name AS field_name, p.short AS park_short, fs.start FROM practice_requests r JOIN teams t ON t.id=r.team_id
                       JOIN fields f ON f.id=r.field_id JOIN parks p ON p.id=f.park_id JOIN field_slots fs ON fs.field_id=r.field_id AND fs.code=r.slot_code
                       WHERE r.status<>'pending' AND r.team_id IN (${(teamId ? [teamId] : mineTeams).join(',') || 0}) ORDER BY r.decided_at DESC LIMIT 30`);
  return { pending: list, history };
}));
app.post('/api/practice/requests', need(), wrap(async req => {
  const r = R.requestPractice(req.person, Number(req.body.teamId), req.body.date, Number(req.body.fieldId), req.body.slotCode);
  const slot = get('SELECT * FROM field_slots WHERE field_id=? AND code=?', Number(req.body.fieldId), req.body.slotCode);
  r.warnings = CF.checkPlacement({ teamIds: [Number(req.body.teamId)], date: req.body.date, start: slot.start, end: slot.end, fieldId: Number(req.body.fieldId), excludeIds: r.eventId ? [r.eventId] : [] });
  return r;
}));
app.delete('/api/practice/requests/:id', need(), wrap(async req => { R.cancelRequest(req.person, Number(req.params.id)); return { ok: true }; }));
app.post('/api/practice/requests/reorder', need(), wrap(async req => { R.reorderRequests(req.person, Number(req.body.teamId), req.body.ids); return { ok: true }; }));
app.get('/api/priority', need(), wrap(async req => all(`SELECT t.id, t.name, t.priority_rank, d.code AS division_code,
   (SELECT p.first || ' ' || p.last FROM team_coaches tc JOIN people p ON p.id=tc.person_id WHERE tc.team_id=t.id AND tc.role='head' LIMIT 1) AS head_coach
   FROM teams t JOIN divisions d ON d.id=t.division_id WHERE t.active=1 ORDER BY t.priority_rank`)));
app.post('/api/priority/reset', need(isAdmin), wrap(async req => { R.resetPriority(); audit(req.person.id, 'priority.reset'); return { ok: true }; }));
app.post('/api/practice/process', need(isAdmin), wrap(async () => R.processDeadlines()));

// ---------- swaps (practice, scrimmage) ----------
app.get('/api/swaps', need(), wrap(async req => {
  const mine = req.roles.coachTeams.map(t => t.id);
  const ids = mine.length ? mine.join(',') : '0';
  return all(`SELECT s.*, tf.name AS from_team_name, tt.name AS to_team_name,
      ea.date AS a_date, ea.start AS a_start, fa.name AS a_field, pa.short AS a_park,
      eb.date AS b_date, eb.start AS b_start, fb.name AS b_field, pb.short AS b_park
    FROM swaps s LEFT JOIN teams tf ON tf.id=s.from_team LEFT JOIN teams tt ON tt.id=s.to_team
    LEFT JOIN events ea ON ea.id=s.event_a LEFT JOIN fields fa ON fa.id=ea.field_id LEFT JOIN parks pa ON pa.id=fa.park_id
    LEFT JOIN events eb ON eb.id=s.event_b LEFT JOIN fields fb ON fb.id=eb.field_id LEFT JOIN parks pb ON pb.id=fb.park_id
    WHERE s.kind IN ('practice','scrimmage') AND (s.from_team IN (${ids}) OR s.to_team IN (${ids})) ORDER BY s.id DESC LIMIT 50`)
    .map(s => ({ ...s, incoming: mine.includes(s.to_team) }));
}));
// warnings for what a swap or scrimmage would do to coaches on more than one team
function swapWarnings(kind, eventA, eventB, toTeam) {
  const a = get('SELECT * FROM events WHERE id=?', eventA), b = eventB ? get('SELECT * FROM events WHERE id=?', eventB) : null;
  if (!a) return [];
  if (kind === 'practice' && b) return [
    ...CF.checkPlacement({ teamIds: [a.team_id], date: b.date, start: b.start, end: b.end, fieldId: b.field_id, excludeIds: [a.id, b.id] }),
    ...CF.checkPlacement({ teamIds: [b.team_id], date: a.date, start: a.start, end: a.end, fieldId: a.field_id, excludeIds: [a.id, b.id] })];
  return CF.checkPlacement({ teamIds: [toTeam], date: a.date, start: a.start, end: a.end, fieldId: a.field_id, excludeIds: [a.id] });
}
app.post('/api/swaps/practice', need(), wrap(async req => ({ id: R.proposePracticeSwap(req.person, Number(req.body.eventA), Number(req.body.eventB), req.body.message),
  warnings: swapWarnings('practice', Number(req.body.eventA), Number(req.body.eventB)) })));
app.post('/api/swaps/scrimmage', need(), wrap(async req => ({ id: R.inviteScrimmage(req.person, Number(req.body.eventA), Number(req.body.toTeam), req.body.message),
  warnings: swapWarnings('scrimmage', Number(req.body.eventA), null, Number(req.body.toTeam)) })));
app.post('/api/swaps/:id/respond', need(), wrap(async req => {
  const s0 = get('SELECT * FROM swaps WHERE id=?', req.params.id);
  const warnings = s0 && req.body.accept ? swapWarnings(s0.kind, s0.event_a, s0.event_b, s0.to_team) : [];
  return { result: R.respondSwap(req.person, Number(req.params.id), !!req.body.accept), warnings };
}));

// ---------- coaches on more than one team ----------
app.get('/api/conflicts', need(r => r.board || r.scheduler), wrap(async req => {
  const start = req.query.start || setting('practice_start'), end = req.query.end || R.seasonEnd();
  return { coaches: CF.multiTeamCoaches(), conflicts: CF.findConflicts(start, end), start, end };
}));
app.post('/api/conflicts/ack', need(r => r.board || r.scheduler), wrap(async req => { CF.acknowledge(req.body.key, req.person.id, req.body.note); audit(req.person.id, 'conflict.ok', req.body); return { ok: true }; }));
app.post('/api/conflicts/unack', need(r => r.board || r.scheduler), wrap(async req => { CF.unacknowledge(req.body.key); return { ok: true }; }));

// ---------- seasons ----------
app.get('/api/seasons', need(), wrap(async () => {
  const cur = currentSeason();
  return all('SELECT s.*, (SELECT COUNT(*) FROM teams t WHERE t.season_id=s.id AND COALESCE(t.removed,0)=0) AS teams FROM seasons s ORDER BY year DESC, id DESC')
    .map(s => ({ ...s, settings: JSON.parse(s.settings || '{}'), name: `${s.kind} ${s.year}`, current: cur && cur.id === s.id }));
}));
app.post('/api/seasons', need(isAdmin), wrap(async req => {
  const b = req.body;
  if (!['Spring', 'Fall', 'All-Stars', 'Demo'].includes(b.kind)) throw new Error('Pick Spring, Fall, All-Stars or Demo.');
  const year = Number(b.year); if (!(year > 2000 && year < 2100)) throw new Error('Enter a year like 2027.');
  if (get('SELECT 1 FROM seasons WHERE kind=? AND year=?', b.kind, year)) throw new Error(`${b.kind} ${year} already exists.`);
  const cur = currentSeason();
  const settings = { practice_start: b.practice_start, tball_practice_start: b.tball_practice_start || b.practice_start, game_start: b.game_start,
    game_weeks: Number(b.game_weeks) || cur?.settings.game_weeks || 8, makeup_weeks: Number(b.makeup_weeks ?? cur?.settings.makeup_weeks ?? 1), tournament_weeks: Number(b.tournament_weeks ?? cur?.settings.tournament_weeks ?? 1) };
  if (!settings.practice_start || !settings.game_start) throw new Error('Practice start and game start dates are required.');
  const id = createSeason(b.kind, year, settings);
  if (b.copyTeamsFrom) {
    tx(() => {
      for (const t of all('SELECT * FROM teams WHERE season_id=? AND COALESCE(removed,0)=0', Number(b.copyTeamsFrom))) {
        const nid = run('INSERT INTO teams(division_id,name,season_id,active) VALUES(?,?,?,0)', t.division_id, t.name, id).lastInsertRowid;
        if (b.copyCoaches) for (const c of all('SELECT * FROM team_coaches WHERE team_id=?', t.id)) run('INSERT INTO team_coaches(team_id,person_id,role) VALUES(?,?,?)', nid, c.person_id, c.role);
      }
    });
  }
  if (b.activate) { activateSeason(id); R.renumberRanks(); }
  audit(req.person.id, 'season.create', { id, kind: b.kind, year });
  return { id };
}));
app.post('/api/seasons/:id/activate', need(isAdmin), wrap(async req => {
  if (!get('SELECT 1 FROM seasons WHERE id=?', req.params.id)) throw new Error('Season not found.');
  activateSeason(Number(req.params.id)); R.renumberRanks(); audit(req.person.id, 'season.activate', req.params.id);
  return { ok: true };
}));
app.patch('/api/seasons/:id', need(isAdmin), wrap(async req => {
  const b = req.body;
  if (b.kind) run('UPDATE seasons SET kind=? WHERE id=?', b.kind, req.params.id);
  if (b.year) run('UPDATE seasons SET year=? WHERE id=?', Number(b.year), req.params.id);
  return { ok: true };
}));

// ---------- field duty ----------
app.get('/api/duty', need(), wrap(async req => {
  const start = req.query.start || T.today(), end = req.query.end || T.addDays(start, 13);
  const shifts = all(`SELECT s.*, p.short AS park_short FROM duty_shifts s JOIN parks p ON p.id=s.park_id WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.shift, p.sort`, start, end);
  const signups = all(`SELECT d.shift_id, p.id, p.first, p.last, p.phone, p.email FROM duty_signups d JOIN people p ON p.id=d.person_id
                       WHERE d.shift_id IN (SELECT id FROM duty_shifts WHERE date BETWEEN ? AND ?)`, start, end);
  return shifts.map(s => ({ ...s, people: signups.filter(x => x.shift_id === s.id) }));
}));
app.get('/api/duty/:id/availability', need(isBoard), wrap(async req => D.shiftAvailability(Number(req.params.id))));
app.post('/api/duty/:id/signup', need(isBoard), wrap(async req => { D.signUp(req.person, Number(req.params.id), req.body.personId ? Number(req.body.personId) : null); return { ok: true }; }));
app.delete('/api/duty/:id/signup', need(isBoard), wrap(async req => { D.withdraw(req.person, Number(req.params.id), req.query.person ? Number(req.query.person) : null); return { ok: true }; }));
app.patch('/api/duty/:id', need(isAdmin), wrap(async req => { run('UPDATE duty_shifts SET needed=? WHERE id=?', Number(req.body.needed) || 1, req.params.id); return { ok: true }; }));

// ---------- umpires ----------
const assignmentSql = `SELECT a.*, e.date, e.start, e.end, e.slot_code, e.field_id, e.division_id, e.home_team_id, e.away_team_id, e.status AS event_status,
   d.name AS division_name, d.code AS division_code, f.name AS field_name, pk.short AS park_short, f.park_id,
   th.name AS home_name, ta.name AS away_name, p.first, p.last, p.phone
   FROM ump_assignments a JOIN events e ON e.id=a.event_id JOIN divisions d ON d.id=e.division_id JOIN fields f ON f.id=e.field_id JOIN parks pk ON pk.id=f.park_id
   LEFT JOIN teams th ON th.id=e.home_team_id LEFT JOIN teams ta ON ta.id=e.away_team_id LEFT JOIN people p ON p.id=a.person_id`;
app.get('/api/umps/assignments', need(), wrap(async req => {
  const start = req.query.start || T.today(), end = req.query.end || T.addDays(start, 13);
  const where = ['e.date BETWEEN ? AND ?', "e.status='scheduled'"], p = [start, end];
  if (req.query.mine === '1') { where.push('a.person_id=?'); p.push(req.person.id); }
  if (req.query.open === '1') where.push("a.person_id IS NULL AND a.status<>'sick'");
  if (req.query.date) { where.push('e.date=?'); p.push(req.query.date); }
  const rows = all(`${assignmentSql} WHERE ${where.join(' AND ')} ORDER BY e.date, e.start, pk.sort, f.sort, a.position DESC`, ...p);
  if (req.query.open === '1' && !req.roles.umpCoord) {
    const mine = new Set(all('SELECT division_id FROM umpire_divisions WHERE person_id=?', req.person.id).map(r => r.division_id));
    return rows.filter(r => mine.has(r.division_id));
  }
  return rows;
}));
app.get('/api/umps/assignments/:id/candidates', need(isCoord), wrap(async req => ({
  available: U.availableFor(Number(req.params.id)).map(u => ({ id: u.id, first: u.first, last: u.last, phone: u.phone })),
  pull: U.pullCandidates(Number(req.params.id)),
})));
app.post('/api/umps/assignments/:id/assign', need(), wrap(async req => {
  const a = get(`${assignmentSql} WHERE a.id=?`, req.params.id);
  if (!a) throw new Error('Not found');
  const target = req.body.personId ? Number(req.body.personId) : req.person.id;
  if (target !== req.person.id || a.person_id) { if (!req.roles.umpCoord) throw new Error('Only an umpire coordinator can do that.'); }
  if (!req.roles.umpCoord && !get('SELECT 1 FROM umpire_divisions WHERE person_id=? AND division_id=?', target, a.division_id)) throw new Error('You are not set up for that division.');
  if (target && !U.availableFor(a.id).some(u => u.id === target) && !req.body.force) {
    if (!req.roles.umpCoord) throw new Error('You already have a game at that time.');
  }
  // moving an umpire from another game (pull)
  if (req.body.fromAssignment) {
    const from = get('SELECT * FROM ump_assignments WHERE id=?', req.body.fromAssignment);
    if (from && from.person_id === target) run('UPDATE ump_assignments SET person_id=NULL, status=\'assigned\' WHERE id=?', from.id);
  }
  run(`UPDATE ump_assignments SET person_id=?, status='assigned' WHERE id=?`, target || null, a.id);
  audit(req.person.id, 'ump.assign', { id: a.id, target });
  if (target && target !== req.person.id) notifyLater([target], { title: 'New umpire assignment', body: `${a.division_name} ${a.position}, ${R.describe(a.date, a.field_id, a.start)}.` });
  if (!req.roles.umpCoord) notifyLater(all('SELECT id FROM people WHERE (is_ump_coord=1 OR is_admin=1) AND active=1').map(r => r.id),
    { title: 'Open umpire spot picked up', body: `${req.person.first} ${req.person.last} took ${a.division_name} ${a.position}, ${R.describe(a.date, a.field_id, a.start)}.`, sms: false });
  return { ok: true };
}));
app.post('/api/umps/assignments/:id/unassign', need(isCoord), wrap(async req => { run(`UPDATE ump_assignments SET person_id=NULL, status='assigned' WHERE id=?`, req.params.id); return { ok: true }; }));

// Sick call: open the spot, tell all qualified umpires, coordinators and the president
app.post('/api/umps/assignments/:id/sick', need(), wrap(async req => {
  const a = get(`${assignmentSql} WHERE a.id=?`, req.params.id);
  if (!a) throw new Error('Not found');
  if (a.person_id !== req.person.id && !req.roles.umpCoord) throw new Error('That is not your game.');
  const who = a.person_id ? `${a.first} ${a.last}` : 'An umpire';
  const openId = tx(() => {
    run(`UPDATE ump_assignments SET status='sick' WHERE id=?`, a.id);
    return run('INSERT INTO ump_assignments(event_id,position) VALUES(?,?)', a.event_id, a.position).lastInsertRowid;
  });
  const when = R.describe(a.date, a.field_id, a.start);
  const qualified = all(`SELECT p.id FROM people p JOIN umpire_divisions ud ON ud.person_id=p.id WHERE ud.division_id=? AND p.is_umpire=1 AND p.active=1 AND p.id<>?`, a.division_id, a.person_id || 0).map(r => r.id);
  await notify(qualified, { title: 'Umpire needed', body: `${a.division_name} ${a.position}, ${when}. First to accept in the app gets it.`, link: '#/umpires' });
  const leaders = all('SELECT id FROM people WHERE (is_ump_coord=1 OR is_president=1) AND active=1').map(r => r.id);
  await notify(leaders, { title: `Sick call: ${who}`, body: `${who} can't work ${a.division_name} ${a.position}, ${when}. Open spot posted to all qualified umpires.`, sms: false, link: '#/umpires' });
  audit(req.person.id, 'ump.sick', { id: a.id });
  return { openId };
}));

// Shift swap: post a shift; another qualified umpire accepts; switch happens when both have agreed
app.post('/api/umps/assignments/:id/offer', need(), wrap(async req => {
  const a = get(`${assignmentSql} WHERE a.id=?`, req.params.id);
  if (!a || a.person_id !== req.person.id) throw new Error('That is not your game.');
  if (get(`SELECT 1 FROM swaps WHERE kind='umpire' AND assignment_id=? AND status='open'`, a.id)) throw new Error('Already offered.');
  const toPerson = req.body.toPerson ? Number(req.body.toPerson) : null;
  const id = run(`INSERT INTO swaps(kind,from_person,to_person,assignment_id,message) VALUES('umpire',?,?,?,?)`, req.person.id, toPerson, a.id, req.body.message || '').lastInsertRowid;
  const targets = toPerson ? [toPerson] : all(`SELECT p.id FROM people p JOIN umpire_divisions ud ON ud.person_id=p.id WHERE ud.division_id=? AND p.active=1 AND p.id<>?`, a.division_id, req.person.id).map(r => r.id);
  notifyLater(targets, { title: 'Umpire shift up for grabs', body: `${req.person.first} ${req.person.last} is offering ${a.division_name} ${a.position}, ${R.describe(a.date, a.field_id, a.start)}.`, sms: !!toPerson });
  return { id };
}));
app.get('/api/umps/swaps', need(), wrap(async req => {
  const rows = all(`SELECT s.*, fp.first AS from_first, fp.last AS from_last, a.position, e.date, e.start, e.field_id, e.division_id, d.name AS division_name, f.name AS field_name, pk.short AS park_short
                    FROM swaps s JOIN ump_assignments a ON a.id=s.assignment_id JOIN events e ON e.id=a.event_id JOIN divisions d ON d.id=e.division_id
                    JOIN fields f ON f.id=e.field_id JOIN parks pk ON pk.id=f.park_id JOIN people fp ON fp.id=s.from_person
                    WHERE s.kind='umpire' AND s.status='open' AND e.date >= ? ORDER BY e.date, e.start`, T.today());
  const mine = new Set(all('SELECT division_id FROM umpire_divisions WHERE person_id=?', req.person.id).map(r => r.division_id));
  return rows.filter(s => req.roles.umpCoord || s.from_person === req.person.id || ((!s.to_person || s.to_person === req.person.id) && mine.has(s.division_id)));
}));
app.post('/api/umps/swaps/:id/accept', need(), wrap(async req => {
  const s = get(`SELECT * FROM swaps WHERE id=? AND kind='umpire' AND status='open'`, req.params.id);
  if (!s) throw new Error('That shift is no longer available.');
  if (s.to_person && s.to_person !== req.person.id) throw new Error('This offer was made to someone else.');
  const a = get(`${assignmentSql} WHERE a.id=?`, s.assignment_id);
  if (!get('SELECT 1 FROM umpire_divisions WHERE person_id=? AND division_id=?', req.person.id, a.division_id)) throw new Error('You are not set up for that division.');
  if (!U.availableFor(a.id).some(u => u.id === req.person.id)) throw new Error('You already have a game at that time.');
  tx(() => {
    run('UPDATE ump_assignments SET person_id=? WHERE id=?', req.person.id, a.id);
    run(`UPDATE swaps SET status='done', to_person=?, done_at=datetime('now') WHERE id=?`, req.person.id, s.id);
  });
  const coords = all('SELECT id FROM people WHERE is_ump_coord=1 AND active=1').map(r => r.id);
  notifyLater([s.from_person], { title: 'Your shift was picked up', body: `${req.person.first} ${req.person.last} took ${a.division_name} ${a.position}, ${R.describe(a.date, a.field_id, a.start)}. You're off that game.` });
  notifyLater(coords, { title: 'Umpire swap', body: `${a.first} ${a.last} -> ${req.person.first} ${req.person.last}: ${a.division_name} ${a.position}, ${R.describe(a.date, a.field_id, a.start)}.`, sms: false });
  return { ok: true };
}));
app.post('/api/umps/swaps/:id/cancel', need(), wrap(async req => { run(`UPDATE swaps SET status='cancelled' WHERE id=? AND (from_person=? OR ?)`, req.params.id, req.person.id, req.roles.umpCoord ? 1 : 0); return { ok: true }; }));

// Attendance: umpire checks in on their phone; board/coordinator confirms who worked which position
app.post('/api/umps/assignments/:id/checkin', need(), wrap(async req => {
  const a = get(`${assignmentSql} WHERE a.id=?`, req.params.id);
  if (!a || a.person_id !== req.person.id) throw new Error('That is not your game.');
  const startAt = T.at(a.date, a.start), now = new Date();
  if (now < new Date(startAt - 90 * 60000) || now > T.at(a.date, a.end)) throw new Error('Check-in opens 90 minutes before the game.');
  run(`UPDATE ump_assignments SET checkin_at=datetime('now','localtime') WHERE id=?`, a.id);
  return { ok: true };
}));
app.post('/api/umps/assignments/:id/attendance', need(isBoard), wrap(async req => {
  const { status, position, payCents } = req.body;
  if (!['present', 'no_show', 'assigned'].includes(status)) throw new Error('Bad status');
  run(`UPDATE ump_assignments SET status=?, worked_position=?, pay_cents=?, confirmed_by=?, confirmed_at=datetime('now','localtime') WHERE id=?`,
    status, position || null, payCents == null || payCents === '' ? null : Number(payCents), req.person.id, req.params.id);
  audit(req.person.id, 'ump.attendance', { id: req.params.id, status, position });
  return { ok: true };
}));
app.get('/api/umps/roster', need(isBoard), wrap(async req => {
  const umps = all('SELECT id, first, last, phone, email, is_ump_coord FROM people WHERE is_umpire=1 AND active=1 ORDER BY last, first');
  const divs = all('SELECT * FROM umpire_divisions');
  const start = req.query.start || T.mondayOf(T.today()), end = req.query.end || T.addDays(start, 6);
  const counts = all(`SELECT a.person_id, COUNT(*) AS n FROM ump_assignments a JOIN events e ON e.id=a.event_id WHERE e.date BETWEEN ? AND ? AND a.status IN ('assigned','present') GROUP BY a.person_id`, start, end);
  const season = all(`SELECT person_id, SUM(status='present') AS worked, SUM(status='no_show') AS no_shows FROM ump_assignments GROUP BY person_id`);
  return umps.map(u => ({ ...u, divisionIds: divs.filter(d => d.person_id === u.id).map(d => d.division_id),
    thisWeek: counts.find(c => c.person_id === u.id)?.n || 0, worked: season.find(s => s.person_id === u.id)?.worked || 0, noShows: season.find(s => s.person_id === u.id)?.no_shows || 0 }));
}));
app.put('/api/umps/:id/divisions', need(isBoard), wrap(async req => {
  tx(() => { run('DELETE FROM umpire_divisions WHERE person_id=?', req.params.id); for (const d of req.body.divisionIds || []) run('INSERT INTO umpire_divisions(person_id,division_id) VALUES(?,?)', req.params.id, d); });
  return { ok: true };
}));
app.get('/api/umps/availability/:id', need(isBoard), wrap(async req => all(`SELECT * FROM availability WHERE person_id=? AND kind='umpire'`, req.params.id)));
app.get('/api/pay-rates', need(isBoard), wrap(async () => all('SELECT * FROM pay_rates')));
app.put('/api/pay-rates', need(isAdmin), wrap(async req => {
  tx(() => { for (const r of req.body.rates || []) run('INSERT OR REPLACE INTO pay_rates(division_id,position,cents) VALUES(?,?,?)', r.division_id, r.position, Math.round(Number(r.cents) || 0)); });
  return { ok: true };
}));
app.get('/api/payroll', need(isBoard), wrap(async req => X.payrollRows(req.query.start, req.query.end)));

// ---------- people & teams (admin) ----------
app.get('/api/people', need(isBoard), wrap(async () => all(`SELECT p.*, (SELECT GROUP_CONCAT(t.name || ' (' || tc.role || ')', ', ') FROM team_coaches tc JOIN teams t ON t.id=tc.team_id WHERE tc.person_id=p.id AND t.active=1) AS teams FROM people p ORDER BY active DESC, last, first`)));
app.get('/api/directory', need(), wrap(async () => all(`SELECT id, first, last, phone, email, is_board, is_umpire, is_ump_coord, is_president FROM people WHERE active=1 AND (is_board=1 OR is_admin=1 OR is_ump_coord=1) ORDER BY last, first`)));
const personCols = ['first', 'last', 'email', 'phone', 'is_admin', 'is_board', 'is_coach', 'is_umpire', 'is_ump_coord', 'is_president', 'can_edit_schedule', 'active'];
app.post('/api/people', need(isAdmin), wrap(async req => {
  const b = req.body;
  if (!b.first || !b.last) throw new Error('First and last name are required.');
  if (!b.email && !b.phone) throw new Error('Add a phone or email so they can log in.');
  const r = run(`INSERT INTO people(first,last,email,phone,is_admin,is_board,is_coach,is_umpire,is_ump_coord,is_president,can_edit_schedule,cal_token)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,lower(hex(randomblob(16))))`, b.first, b.last, b.email || null, normalizePhone(b.phone),
    +!!b.is_admin, +!!b.is_board, +!!b.is_coach, +!!b.is_umpire, +!!b.is_ump_coord, +!!b.is_president, +!!b.can_edit_schedule);
  return { id: r.lastInsertRowid };
}));
app.patch('/api/people/:id', need(isAdmin), wrap(async req => {
  const b = req.body, sets = [], p = [];
  for (const c of personCols) if (b[c] !== undefined) { sets.push(`${c}=?`); p.push(c === 'phone' ? normalizePhone(b[c]) : (typeof b[c] === 'boolean' ? +b[c] : (b[c] === '' ? null : b[c]))); }
  if (sets.length) run(`UPDATE people SET ${sets.join(',')} WHERE id=?`, ...p, req.params.id);
  return { ok: true };
}));
app.get('/api/teams', need(), wrap(async () => all(`SELECT t.*, d.name AS division_name, d.code AS division_code FROM teams t JOIN divisions d ON d.id=t.division_id WHERE t.season_id=? AND COALESCE(t.removed,0)=0 ORDER BY d.sort, t.name`, currentSeason()?.id || 0)));
app.post('/api/teams', need(isAdmin), wrap(async req => {
  const r = run('INSERT INTO teams(division_id,name) VALUES(?,?)', req.body.divisionId, req.body.name);
  R.renumberRanks();
  return { id: r.lastInsertRowid };
}));
app.patch('/api/teams/:id', need(isAdmin), wrap(async req => {
  const b = req.body;
  run('UPDATE teams SET name=COALESCE(?,name), division_id=COALESCE(?,division_id), active=COALESCE(?,active), removed=COALESCE(?,removed) WHERE id=?',
    b.name ?? null, b.divisionId ?? null, b.active == null ? null : +!!b.active, b.active == null ? null : +!b.active, req.params.id);
  return { ok: true };
}));
app.put('/api/teams/:id/coaches', need(isAdmin), wrap(async req => {
  tx(() => { run('DELETE FROM team_coaches WHERE team_id=?', req.params.id); for (const c of req.body.coaches || []) { run('INSERT INTO team_coaches(team_id,person_id,role) VALUES(?,?,?)', req.params.id, c.personId, c.role || 'head'); run('UPDATE people SET is_coach=1 WHERE id=?', c.personId); } });
  return { ok: true };
}));

// ---------- imports ----------
app.post('/api/import/people/preview', need(isAdmin), wrap(async req => I.previewPeople(req.body.csv)));
app.post('/api/import/people/apply', need(isAdmin), wrap(async req => { const r = I.applyPeople(req.body.csv); audit(req.person.id, 'import.people', r); return r; }));
app.post('/api/import/sportsconnect/preview', need(isAdmin), wrap(async req => I.previewSportsConnect(req.body.csv)));
app.post('/api/import/sportsconnect/apply', need(isAdmin), wrap(async req => { const r = I.applySportsConnect(req.body.csv); audit(req.person.id, 'import.sportsconnect', r); return r; }));

// ---------- setup (admin) ----------
app.put('/api/settings', need(isAdmin), wrap(async req => { for (const [k, v] of Object.entries(req.body)) setSetting(k, v); audit(req.person.id, 'settings', req.body); return { ok: true }; }));
app.patch('/api/divisions/:id', need(isAdmin), wrap(async req => {
  const cols = ['name', 'slot_rule', 'crew_plate', 'crew_field', 'games_per_week', 'practices_per_week', 'color', 'active'];
  for (const c of cols) if (req.body[c] !== undefined) run(`UPDATE divisions SET ${c}=? WHERE id=?`, typeof req.body[c] === 'boolean' ? +req.body[c] : req.body[c], req.params.id);
  return { ok: true };
}));
app.patch('/api/fields/:id', need(isAdmin), wrap(async req => {
  for (const c of ['name', 'divisions', 'active']) if (req.body[c] !== undefined) run(`UPDATE fields SET ${c}=? WHERE id=?`, typeof req.body[c] === 'boolean' ? +req.body[c] : req.body[c], req.params.id);
  return { ok: true };
}));
app.get('/api/blackouts', need(), wrap(async () => all(`SELECT b.*, f.name AS field_name, p.short AS park_short FROM blackouts b LEFT JOIN fields f ON f.id=b.field_id LEFT JOIN parks p ON p.id=COALESCE(b.park_id, f.park_id) ORDER BY date`)));
app.post('/api/blackouts', need(isAdmin), wrap(async req => {
  const b = req.body;
  const r = run('INSERT INTO blackouts(date,park_id,field_id,slot_code,applies,reason) VALUES(?,?,?,?,?,?)', b.date, b.parkId || null, b.fieldId || null, b.slotCode || null, b.applies || 'all', b.reason || '');
  return { id: r.lastInsertRowid };
}));
app.delete('/api/blackouts/:id', need(isAdmin), wrap(async req => { run('DELETE FROM blackouts WHERE id=?', req.params.id); return { ok: true }; }));
app.get('/api/admin/status', need(isAdmin), wrap(async () => ({
  sms: smsEnabled(), email: emailEnabled(), demo: auth.DEMO,
  counts: {
    people: get('SELECT COUNT(*) AS n FROM people WHERE active=1').n, teams: get('SELECT COUNT(*) AS n FROM teams WHERE active=1').n,
    games: get(`SELECT COUNT(*) AS n FROM events WHERE type='game'`).n, practices: get(`SELECT COUNT(*) AS n FROM events WHERE type='practice'`).n,
    unpublished: get('SELECT COUNT(*) AS n FROM events WHERE published=0').n,
    openUmp: get(`SELECT COUNT(*) AS n FROM ump_assignments a JOIN events e ON e.id=a.event_id WHERE a.person_id IS NULL AND a.status<>'sick' AND e.date>=? AND e.status='scheduled'`, T.today()).n,
    openDuty: get(`SELECT COUNT(*) AS n FROM duty_shifts s WHERE s.date>=? AND (SELECT COUNT(*) FROM duty_signups d WHERE d.shift_id=s.id) < s.needed`, T.today()).n,
  },
  audit: all('SELECT a.*, p.first, p.last FROM audit_log a LEFT JOIN people p ON p.id=a.person_id ORDER BY a.id DESC LIMIT 30'),
})));
app.post('/api/admin/test-message', need(isAdmin), wrap(async req => notify([req.person.id], { title: 'Test message', body: 'If you got this, notifications are working.' })));
app.post('/api/admin/run-jobs', need(isAdmin), wrap(async () => { await jobs.tick(); return { ok: true }; }));

// ---------- inbox ----------
app.get('/api/inbox', need(), wrap(async req => all('SELECT * FROM notifications WHERE person_id=? ORDER BY id DESC LIMIT 100', req.person.id)));
app.post('/api/inbox/read', need(), wrap(async req => { run(`UPDATE notifications SET read_at=datetime('now') WHERE person_id=? AND read_at IS NULL`, req.person.id); return { ok: true }; }));

// ---------- exports ----------
const sendFile = (res, name, type, body) => { res.setHeader('Content-Type', type); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.send(body); };
app.get('/export/schedule.csv', need(), (req, res) => {
  const f = { start: req.query.start, end: req.query.end, divisionId: req.query.division ? +req.query.division : null, teamId: req.query.team ? +req.query.team : null, type: req.query.type, publishedOnly: !req.roles.scheduler };
  const div = f.divisionId ? get('SELECT code FROM divisions WHERE id=?', f.divisionId).code : 'all';
  const kind = f.type === 'game' ? 'games' : f.type ? 'practices' : 'schedule';
  sendFile(res, `csll-${kind}-${div}.csv`, 'text/csv', X.scheduleCsv(f));
});
app.get('/export/city.xlsx', need(isBoard), async (req, res) => {
  const start = req.query.start || setting('practice_start'), end = req.query.end || R.seasonEnd();
  sendFile(res, `CSLL Gameday Field Schedules ${setting('season_name')}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await X.cityWorkbook(start, end)));
});
app.get('/export/umpires.csv', need(isBoard), (req, res) => sendFile(res, 'csll-umpire-schedule.csv', 'text/csv', X.umpireScheduleCsv(req.query.start || T.today(), req.query.end || R.seasonEnd())));
app.get('/export/payroll.csv', need(isBoard), (req, res) => sendFile(res, `csll-umpire-payroll-${req.query.start}-to-${req.query.end}.csv`, 'text/csv', X.payrollCsv(req.query.start, req.query.end)));
app.get('/export/duty.csv', need(), (req, res) => sendFile(res, 'csll-field-duty.csv', 'text/csv', X.dutyCsv(req.query.start || T.today(), req.query.end || R.seasonEnd())));
app.get('/cal/team/:id.ics', (req, res) => { res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.send(X.teamIcs(Number(req.params.id))); });
app.get('/cal/me/:token.ics', (req, res) => {
  const p = get('SELECT * FROM people WHERE cal_token=? AND active=1', req.params.token);
  if (!p) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.send(X.personIcs(p));
});

app.get('/api/demo/accounts', (req, res) => {
  if (!auth.DEMO) return res.status(404).json({ error: 'Not found' });
  const one = sql => get(sql) || null;
  const pick = (label, sql) => { const p = one(sql); return p && p.email ? { label, email: p.email, name: `${p.first} ${p.last}` } : null; };
  res.json([
    pick('League admin', `SELECT * FROM people WHERE is_admin=1 LIMIT 1`),
    pick('Coach', `SELECT p.* FROM people p JOIN team_coaches tc ON tc.person_id=p.id WHERE tc.role='head' AND p.is_board=0 AND p.is_umpire=0 LIMIT 1`),
    pick('Umpire', `SELECT * FROM people WHERE is_umpire=1 AND is_board=0 AND id IN (SELECT person_id FROM ump_assignments) LIMIT 1`),
    pick('Board member who coaches', `SELECT p.* FROM people p JOIN team_coaches tc ON tc.person_id=p.id WHERE p.is_board=1 AND p.is_admin=0 LIMIT 1`),
    pick('Board member (no team)', `SELECT * FROM people p WHERE is_board=1 AND is_admin=0 AND id NOT IN (SELECT person_id FROM team_coaches) LIMIT 1`),
    pick('Umpire coordinator', `SELECT * FROM people WHERE is_ump_coord=1 AND is_admin=0 LIMIT 1`),
  ].filter(Boolean));
});
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CSLL Schedules running on http://localhost:${PORT}`);
    console.log(`Text messages: ${smsEnabled() ? 'Twilio' : 'log only'}  |  Email: ${emailEnabled() ? 'SMTP' : 'log only'}${auth.DEMO ? '  |  DEMO MODE (login codes shown on screen)' : ''}`);
  });
  if (process.env.JOBS !== 'off') jobs.start();
}
module.exports = app;
