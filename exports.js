// CSV, calendar (.ics) and city field schedule (.xlsx) exports.
const ExcelJS = require('exceljs');
const { all, get, setting } = require('./db');
const T = require('./time');
const { slotGroup } = require('./engine-slots');

const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function scheduleRows(filter = {}) {
  const where = [`e.status <> 'cancelled'`], p = [];
  if (filter.start) { where.push('e.date >= ?'); p.push(filter.start); }
  if (filter.end) { where.push('e.date <= ?'); p.push(filter.end); }
  if (filter.divisionId) { where.push('e.division_id = ?'); p.push(filter.divisionId); }
  if (filter.teamId) { where.push('(e.team_id=? OR e.home_team_id=? OR e.away_team_id=?)'); p.push(filter.teamId, filter.teamId, filter.teamId); }
  if (filter.type) { const ts = String(filter.type).split(','); where.push(`e.type IN (${ts.map(() => '?').join(',')})`); p.push(...ts); }
  if (filter.publishedOnly) where.push('e.published = 1');
  return all(`SELECT e.*, d.name AS division, d.code AS division_code, f.name AS field, pk.short AS park,
                th.name AS home, ta.name AS away, tt.name AS team
              FROM events e LEFT JOIN divisions d ON d.id=e.division_id LEFT JOIN fields f ON f.id=e.field_id
              LEFT JOIN parks pk ON pk.id=f.park_id LEFT JOIN teams th ON th.id=e.home_team_id
              LEFT JOIN teams ta ON ta.id=e.away_team_id LEFT JOIN teams tt ON tt.id=e.team_id
              WHERE ${where.join(' AND ')} ORDER BY e.date, e.start, pk.sort, f.sort`, ...p);
}

function scheduleCsv(filter) {
  const rows = scheduleRows(filter);
  return toCsv([['Date', 'Day', 'Start', 'End', 'Type', 'Division', 'Home / Team', 'Away', 'Park', 'Field', 'Status'],
    ...rows.map(e => [e.date, T.DOW[T.weekday(e.date)], T.fmt12(e.start), T.fmt12(e.end), e.type, e.division,
      e.type === 'practice' ? e.team : e.home, e.type === 'practice' ? '' : e.away, e.park, e.field, e.status])]);
}

function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function icsTime(date, hhmm) { return date.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00'; }
function eventTitle(e) {
  if (e.type === 'practice') return `${e.team} practice`;
  if (e.type === 'scrimmage') return `Scrimmage: ${e.home} vs ${e.away}`;
  if (e.type === 'game') return `${e.away} at ${e.home} (${e.division_code})`;
  return e.title || 'CSLL event';
}
function ics(name, items) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CSLL//Schedules//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(name)}`, 'X-WR-TIMEZONE:America/Chicago'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  for (const it of items) {
    lines.push('BEGIN:VEVENT', `UID:${it.uid}@csll`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/Chicago:${icsTime(it.date, it.start)}`, `DTEND;TZID=America/Chicago:${icsTime(it.date, it.end)}`,
      `SUMMARY:${icsEscape(it.title)}`, `LOCATION:${icsEscape(it.location)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function teamIcs(teamId) {
  const team = get('SELECT * FROM teams WHERE id=?', teamId);
  const rows = scheduleRows({ teamId, publishedOnly: true });
  return ics(`CSLL ${team ? team.name : 'Team'}`, rows.map(e => ({ uid: 'e' + e.id, date: e.date, start: e.start, end: e.end, title: eventTitle(e), location: `${e.park} ${e.field}` })));
}
function personIcs(person) {
  const teamIds = all('SELECT team_id FROM team_coaches WHERE person_id=?', person.id).map(r => r.team_id);
  const items = [];
  for (const tid of teamIds) for (const e of scheduleRows({ teamId: tid, publishedOnly: true }))
    items.push({ uid: 'e' + e.id, date: e.date, start: e.start, end: e.end, title: eventTitle(e), location: `${e.park} ${e.field}` });
  for (const a of all(`SELECT a.id, a.position, e.date, e.start, e.end, d.code, f.name AS field, p.short AS park FROM ump_assignments a
                       JOIN events e ON e.id=a.event_id JOIN divisions d ON d.id=e.division_id JOIN fields f ON f.id=e.field_id JOIN parks p ON p.id=f.park_id
                       WHERE a.person_id=? AND a.status IN ('assigned','present')`, person.id))
    items.push({ uid: 'u' + a.id, date: a.date, start: a.start, end: a.end, title: `Umpire (${a.position}) ${a.code}`, location: `${a.park} ${a.field}` });
  for (const s of all(`SELECT s.*, p.short FROM duty_signups d JOIN duty_shifts s ON s.id=d.shift_id JOIN parks p ON p.id=s.park_id WHERE d.person_id=?`, person.id))
    items.push({ uid: 'd' + s.id, date: s.date, start: s.start, end: s.end, title: `Field duty (${s.shift})`, location: s.short });
  return ics(`CSLL: ${person.first} ${person.last}`, items);
}

function umpireScheduleCsv(start, end) {
  const rows = all(`SELECT e.date, e.start, d.name AS division, pk.short AS park, f.name AS field, a.position, a.status,
                      COALESCE(p.first || ' ' || p.last, 'OPEN') AS umpire
                    FROM ump_assignments a JOIN events e ON e.id=a.event_id JOIN divisions d ON d.id=e.division_id
                    JOIN fields f ON f.id=e.field_id JOIN parks pk ON pk.id=f.park_id LEFT JOIN people p ON p.id=a.person_id
                    WHERE e.date BETWEEN ? AND ? AND e.status='scheduled' ORDER BY e.date, e.start, pk.sort, f.sort, a.position DESC`, start, end);
  return toCsv([['Date', 'Day', 'Time', 'Division', 'Park', 'Field', 'Position', 'Umpire', 'Status'],
    ...rows.map(r => [r.date, T.DOW[T.weekday(r.date)], T.fmt12(r.start), r.division, r.park, r.field, r.position, r.umpire, r.status])]);
}

function payrollRows(start, end) {
  const rates = new Map(all('SELECT * FROM pay_rates').map(r => [`${r.division_id}|${r.position}`, r.cents]));
  const rows = all(`SELECT a.*, e.date, e.start, e.division_id, d.name AS division, f.name AS field, pk.short AS park, p.first, p.last, p.email, p.phone
                    FROM ump_assignments a JOIN events e ON e.id=a.event_id JOIN divisions d ON d.id=e.division_id
                    JOIN fields f ON f.id=e.field_id JOIN parks pk ON pk.id=f.park_id JOIN people p ON p.id=a.person_id
                    WHERE e.date BETWEEN ? AND ? AND a.status IN ('present','no_show','assigned') ORDER BY p.last, p.first, e.date, e.start`, start, end);
  return rows.map(r => {
    const pos = r.worked_position || r.position;
    const cents = r.status === 'present' ? (r.pay_cents ?? rates.get(`${r.division_id}|${pos}`) ?? 0) : 0;
    return { ...r, worked: pos, cents };
  });
}
function payrollCsv(start, end) {
  const rows = payrollRows(start, end);
  const detail = [['Umpire', 'Date', 'Time', 'Division', 'Park', 'Field', 'Position worked', 'Attendance', 'Pay']];
  const totals = new Map();
  for (const r of rows) {
    const name = `${r.first} ${r.last}`;
    detail.push([name, r.date, T.fmt12(r.start), r.division, r.park, r.field, r.worked, r.status === 'assigned' ? 'NOT CONFIRMED' : r.status, (r.cents / 100).toFixed(2)]);
    const t = totals.get(name) || { plate: 0, field: 0, noShow: 0, unconfirmed: 0, cents: 0 };
    if (r.status === 'present') t[r.worked]++; else if (r.status === 'no_show') t.noShow++; else t.unconfirmed++;
    t.cents += r.cents; totals.set(name, t);
  }
  const summary = [[], ['SUMMARY'], ['Umpire', 'Plate games', 'Field games', 'No-shows', 'Not confirmed yet', 'Total pay']];
  for (const [name, t] of totals) summary.push([name, t.plate, t.field, t.noShow, t.unconfirmed, (t.cents / 100).toFixed(2)]);
  return toCsv([[`CSLL umpire payroll ${start} to ${end}`], [], ...detail, ...summary]);
}

function dutyCsv(start, end) {
  const rows = all(`SELECT s.*, p.short AS park, GROUP_CONCAT(pp.first || ' ' || pp.last || ' (' || COALESCE(pp.phone,'') || ')', '; ') AS who
                    FROM duty_shifts s JOIN parks p ON p.id=s.park_id LEFT JOIN duty_signups d ON d.shift_id=s.id LEFT JOIN people pp ON pp.id=d.person_id
                    WHERE s.date BETWEEN ? AND ? GROUP BY s.id ORDER BY s.date, p.sort, s.shift`, start, end);
  return toCsv([['Date', 'Day', 'Park', 'Shift', 'Time', 'Night', 'Board member(s)'],
    ...rows.map(r => [r.date, T.DOW[T.weekday(r.date)], r.park, r.shift, `${T.fmt12(r.start)} - ${T.fmt12(r.end)}`, r.night_type, r.who || 'OPEN'])]);
}

// ---------------- City field schedule (matches "CSLL Gameday Field Schedules F26") ----------------
const BIG = ['INT', 'JR', 'SR'];
function cityLabel(evs, inGameWeek) {
  if (!evs.length) return 'Not In Use';
  const codes = [...new Set(evs.map(e => e.division_code))];
  const anyGame = evs.some(e => e.type === 'game');
  if (codes.every(c => c === 'TB')) return 'TBall';
  if (!anyGame && inGameWeek) return 'Practice';
  if (codes.every(c => BIG.includes(c))) return codes.length === 1 && codes[0] === 'INT' ? 'Intermediate' : codes.length === 1 && codes[0] === 'SR' ? 'Seniors' : 'Juniors';
  return 'JM -> Majors';
}
const range12 = (s, e) => `${T.short12(s)} - ${T.short12(e)}`;

async function cityWorkbook(start, end) {
  const gameStart = T.mondayOf(setting('game_start'));
  const practiceStart = T.mondayOf(setting('practice_start'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CSLL Schedules';
  const parks = all('SELECT * FROM parks ORDER BY sort');
  const MAROON = 'FF5C1118';
  for (const park of parks) {
    const ws = wb.addWorksheet(park.short.slice(0, 30));
    ws.columns = [{ width: 24 }, { width: 13 }, { width: 16 }, { width: 3 }, { width: 13 }, { width: 16 }, { width: 3 }, { width: 13 }, { width: 16 }, { width: 13 }, { width: 16 }];
    const fields = all('SELECT f.*, (SELECT GROUP_CONCAT(code) FROM field_slots s WHERE s.field_id=f.id) AS codes FROM fields f WHERE park_id=? AND active=1 ORDER BY sort', park.id);
    const slots = all('SELECT * FROM field_slots WHERE field_id IN (SELECT id FROM fields WHERE park_id=?)', park.id);
    const evs = all(`SELECT e.*, d.code AS division_code FROM events e LEFT JOIN divisions d ON d.id=e.division_id JOIN fields f ON f.id=e.field_id
                     WHERE f.park_id=? AND e.date BETWEEN ? AND ? AND e.status='scheduled'`, park.id, start, end);
    let r = ws.addRow([park.short, park.name]); r.font = { bold: true, size: 14, color: { argb: MAROON } };
    ws.addRow(['Date']).font = { bold: true };
    for (let wk = T.mondayOf(start); wk <= end; wk = T.addDays(wk, 7)) {
      const inGameWeek = wk >= gameStart;
      const n = inGameWeek ? Math.floor(T.daysBetween(gameStart, wk) / 7) + 1 : Math.floor(T.daysBetween(practiceStart, wk) / 7) + 1;
      r = ws.addRow([inGameWeek ? `LL GAME WEEK ${n}` : `LL PRACTICE WEEK ${n}`]);
      r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MAROON } };
      for (let i = 0; i < 7; i++) {
        const date = T.addDays(wk, i);
        if (date < start || date > end) continue;
        const wd = T.weekday(date);
        const dayEvs = evs.filter(e => e.date === date);
        const kind = inGameWeek ? 'Game' : 'Practice';
        if (wd === 6) {
          r = ws.addRow([T.longDate(date), '1st Practice', '', '', '2nd Practice', '', '', '3rd Practice', '', '4th Practice', '']);
        } else if (wd === 0 || wd === 3) {
          r = ws.addRow([T.longDate(date), inGameWeek ? 'Not Used' : `Early ${kind}`, '', '', inGameWeek ? '' : `Late ${kind}`]);
        } else {
          r = ws.addRow([T.longDate(date), `Early ${kind}`, '', '', `Late ${kind}`]);
        }
        r.font = { bold: true }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE4E2' } };
        for (const f of fields) {
          const fs = slots.filter(s => s.field_id === f.id && s.days.split(',').map(Number).includes(wd));
          const row = [f.name];
          const fe = dayEvs.filter(e => e.field_id === f.id);
          if (wd === 6) {
            const sat = fs.filter(s => s.code.startsWith('sat') || s.code === 'tsat').sort((a, b) => a.start.localeCompare(b.start));
            sat.forEach((s, idx) => {
              const used = fe.filter(e => e.start === s.start);
              const col = [1, 4, 7, 9][idx];
              row[col] = range12(s.start, s.end); row[col + 1] = used.length ? (used.every(e => e.division_code === 'TB') ? 'TBall' : 'Practice') : '';
            });
          } else if (fs.length) {
            const early = fs.find(s => s.code === 'early' || s.code === 'tball');
            const lateGame = fs.find(s => s.code === 'seven');
            const late = fs.find(s => s.code === 'late');
            if (early) { row[1] = range12(early.start, early.end); row[2] = cityLabel(fe.filter(e => slotGroup(e.start) === 'early'), inGameWeek); }
            const lateSlot = inGameWeek && lateGame ? lateGame : late;
            if (lateSlot) { row[4] = range12(lateSlot.start, lateSlot.end); row[5] = cityLabel(fe.filter(e => slotGroup(e.start) === 'late'), inGameWeek); }
          }
          ws.addRow(row);
        }
      }
    }
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { scheduleCsv, scheduleRows, teamIcs, personIcs, umpireScheduleCsv, payrollCsv, payrollRows, dutyCsv, cityWorkbook, toCsv, eventTitle };
