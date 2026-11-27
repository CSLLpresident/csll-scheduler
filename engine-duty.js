// Field duty: board-only shifts (early / late per park per night), availability, sign-ups and reminders.
const { all, get, run, tx, setting } = require('./db');
const T = require('./time');
const { slotGroup } = require('./engine-slots');
const { eventTeams, leagueContext } = require('./engine-context');
const { notify } = require('./notify');

/** Build/refresh shifts from the events calendar */
function rebuildShifts(start, end) {
  const lead = Number(setting('duty_lead_minutes', 15));
  const evs = all(`SELECT e.*, f.park_id FROM events e JOIN fields f ON f.id=e.field_id WHERE e.date BETWEEN ? AND ? AND e.status='scheduled'`, start, end);
  const groups = new Map();
  for (const e of evs) {
    const k = `${e.date}|${e.park_id}|${slotGroup(e.start)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  const keep = new Set();
  tx(() => {
    for (const [k, list] of groups) {
      const [date, parkId, shift] = k.split('|');
      const minStart = list.map(e => T.minutes(e.start)).sort((a, b) => a - b)[0];
      const maxEnd = list.map(e => T.minutes(e.end)).sort((a, b) => b - a)[0];
      const s = shift === 'early' ? T.hhmm(minStart - lead) : T.hhmm(minStart);
      const en = shift === 'late' ? T.hhmm(maxEnd + lead) : T.hhmm(maxEnd);
      const nightType = list.some(e => e.type === 'game') ? 'game' : 'practice';
      run(`INSERT INTO duty_shifts(date,park_id,shift,start,end,night_type) VALUES(?,?,?,?,?,?)
           ON CONFLICT(date,park_id,shift) DO UPDATE SET start=excluded.start, end=excluded.end, night_type=excluded.night_type`,
        date, Number(parkId), shift, s, en, nightType);
      keep.add(k);
    }
    // remove shifts that no longer have events and nobody signed up
    for (const sh of all('SELECT * FROM duty_shifts WHERE date BETWEEN ? AND ?', start, end)) {
      if (!keep.has(`${sh.date}|${sh.park_id}|${sh.shift}`) && !get('SELECT 1 FROM duty_signups WHERE shift_id=?', sh.id)) run('DELETE FROM duty_shifts WHERE id=?', sh.id);
    }
  });
  return keep.size;
}

function boardMembers() { return all('SELECT * FROM people WHERE (is_board=1 OR is_admin=1) AND active=1 ORDER BY last, first'); }

function boardRuleScore(rules, date, shift) {
  if (!rules.length) return 0;
  const wd = T.weekday(date);
  const m = r => !r.slot_code || r.slot_code === 'any' || r.slot_code === shift;
  const dated = rules.filter(r => r.date === date && m(r));
  if (dated.length) return dated.some(r => !r.available) ? -1 : 1;
  const weekly = rules.filter(r => r.date == null && r.weekday === wd && m(r));
  if (weekly.length) return weekly.some(r => !r.available) ? -1 : 1;
  return 0;
}

/**
 * Who can work a shift. Status per board member:
 *  signed_up | coaching_game (not allowed) | practicing_here (preferred on practice nights) | free | unavailable (own rule)
 */
function shiftAvailability(shiftId) {
  const sh = get('SELECT * FROM duty_shifts WHERE id=?', shiftId);
  if (!sh) return [];
  const ctx = leagueContext();
  const evs = all(`SELECT e.*, f.park_id, f.name AS field_name FROM events e JOIN fields f ON f.id=e.field_id WHERE e.date=? AND e.status='scheduled'`, sh.date)
    .filter(e => slotGroup(e.start) === sh.shift);
  const rules = all(`SELECT * FROM availability WHERE kind='board'`);
  const signed = new Set(all('SELECT person_id FROM duty_signups WHERE shift_id=?', sh.id).map(r => r.person_id));
  return boardMembers().map(p => {
    const mine = evs.filter(e => eventTeams(e).some(tid => ctx.teamById.get(tid)?.coachIds.includes(p.id)));
    const game = mine.find(e => e.type === 'game' || e.type === 'scrimmage');
    const practiceHere = mine.find(e => e.type === 'practice' && e.park_id === sh.park_id);
    const rule = boardRuleScore(rules.filter(r => r.person_id === p.id), sh.date, sh.shift);
    let status = 'free', note = '';
    if (signed.has(p.id)) status = 'signed_up';
    else if (game) { status = 'coaching_game'; note = `Coaching a ${game.type} (${game.field_name})`; }
    else if (rule < 0) { status = 'unavailable'; note = 'Marked unavailable'; }
    else if (practiceHere) { status = 'practicing_here'; note = `Practice on ${practiceHere.field_name}`; }
    else if (mine.length) { status = 'elsewhere'; note = 'Practice at the other park'; }
    else if (rule > 0) { status = 'free'; note = 'Marked available'; }
    return { id: p.id, first: p.first, last: p.last, phone: p.phone, email: p.email, status, note,
      canWork: status !== 'coaching_game' && status !== 'elsewhere' };
  }).sort((a, b) => order(a.status) - order(b.status) || a.last.localeCompare(b.last));
}
const order = s => ({ signed_up: 0, practicing_here: 1, free: 2, unavailable: 3, elsewhere: 4, coaching_game: 5 }[s] ?? 9);

function signUp(person, shiftId, forPersonId = null) {
  const pid = forPersonId || person.id;
  const target = get('SELECT * FROM people WHERE id=?', pid);
  if (!target || !(target.is_board || target.is_admin)) throw new Error('Field duty is for board members.');
  if (forPersonId && forPersonId !== person.id && !person.is_admin) throw new Error('Only an admin can assign someone else.');
  const av = shiftAvailability(shiftId).find(a => a.id === pid);
  if (av && av.status === 'coaching_game') throw new Error('You are coaching a game during this shift.');
  run('INSERT OR IGNORE INTO duty_signups(shift_id,person_id) VALUES(?,?)', shiftId, pid);
}
function withdraw(person, shiftId, forPersonId = null) {
  const pid = forPersonId || person.id;
  if (pid !== person.id && !person.is_admin) throw new Error('Only an admin can remove someone else.');
  run('DELETE FROM duty_signups WHERE shift_id=? AND person_id=?', shiftId, pid);
}

/**
 * Reminder job. For each open shift, send the latest reminder point that has passed (72/48/36/24/12/6 h).
 * 36 h and 12 h reminders wait until 8 AM. Recipients: board members who can work it and have no shift that Mon-Sun week.
 */
async function sendReminders(now = new Date()) {
  const points = setting('duty_reminder_hours', [72, 48, 36, 24, 12, 6]).slice().sort((a, b) => b - a);
  const quiet = setting('duty_quiet_hours', [36, 12]);
  const quietUntil = Number(setting('duty_quiet_until', 8));
  const horizon = T.ymd(new Date(now.getTime() + (points[0] + 1) * 3600000));
  const shifts = all(`SELECT s.*, p.short AS park_short, (SELECT COUNT(*) FROM duty_signups d WHERE d.shift_id=s.id) AS signed
                      FROM duty_shifts s JOIN parks p ON p.id=s.park_id WHERE s.date BETWEEN ? AND ?`, T.ymd(now), horizon);
  let sent = 0;
  for (const sh of shifts) {
    if (sh.signed >= sh.needed) continue;
    const startAt = T.at(sh.date, sh.start);
    const hoursLeft = (startAt - now) / 3600000;
    if (hoursLeft <= 0) continue;
    const due = points.filter(h => hoursLeft <= h);           // points already reached
    if (!due.length) continue;
    const point = due[due.length - 1];                          // the most recent one reached
    if (get('SELECT 1 FROM duty_reminders WHERE shift_id=? AND hours=?', sh.id, point)) continue;
    if (quiet.includes(point) && now.getHours() < quietUntil) continue;
    const weekStart = T.mondayOf(sh.date), weekEnd = T.addDays(weekStart, 6);
    const busyWeek = new Set(all(`SELECT d.person_id FROM duty_signups d JOIN duty_shifts s ON s.id=d.shift_id WHERE s.date BETWEEN ? AND ?`, weekStart, weekEnd).map(r => r.person_id));
    const recipients = shiftAvailability(sh.id).filter(a => a.canWork && a.status !== 'unavailable' && !busyWeek.has(a.id)).map(a => a.id);
    run('INSERT OR IGNORE INTO duty_reminders(shift_id,hours,sent_at) VALUES(?,?,datetime(\'now\'))', sh.id, point);
    // mark earlier points as done too so they never fire late
    points.filter(h => h > point).forEach(h => run('INSERT OR IGNORE INTO duty_reminders(shift_id,hours,sent_at) VALUES(?,?,datetime(\'now\'))', sh.id, h));
    if (!recipients.length) continue;
    const label = `${sh.park_short} ${sh.shift === 'early' ? 'early' : 'late'} field duty, ${T.shortDate(sh.date)} ${T.fmt12(sh.start)}-${T.fmt12(sh.end)}`;
    await notify(recipients, { title: `Field duty still open (${Math.round(hoursLeft)}h)`, body: `${label} needs someone. Sign up in the app.`, link: '#/duty' });
    sent += recipients.length;
  }
  return sent;
}

module.exports = { rebuildShifts, shiftAvailability, signUp, withdraw, sendReminders, boardMembers };
