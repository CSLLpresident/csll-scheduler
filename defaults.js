// League defaults for Spring 2027. Loaded once into an empty database; everything is editable in Admin > Setup.
const { get, run, setSetting, setting, tx, all, currentSeason, createSeason, activateSeason } = require('./db');

const DIVISIONS = [
  // code, name, slot_rule, field_kind, plate, field, games/wk, practices/wk, color, active
  ['TB', 'T-Ball', 'tball', 'tball', 0, 0, 1, 1, '#2F6DB5', 1],
  ['JMAA', 'Junior Minor AA', 'early', 'main', 0, 2, 2, 1, '#C0392B', 1],
  ['JMAAA', 'Junior Minor AAA', 'early', 'main', 0, 2, 2, 1, '#E26A5A', 1],
  ['SMAA', 'Senior Minor AA', 'any', 'main', 1, 1, 2, 1, '#E67E22', 1],
  ['SMAAA', 'Senior Minor AAA', 'any', 'main', 1, 1, 2, 1, '#D35400', 1],
  ['MAJ', 'Majors', 'any', 'main', 1, 1, 2, 1, '#5F5A55', 1],
  ['MAJAA', 'Majors AA', 'any', 'main', 1, 1, 2, 1, '#7A746E', 0],
  ['MAJAAA', 'Majors AAA', 'any', 'main', 1, 1, 2, 1, '#3E3A36', 0],
  ['INT', 'Intermediate', 'seven', 'big', 1, 1, 1, 1, '#2E8B57', 1],
  ['JR', 'Juniors', 'seven', 'big', 1, 1, 1, 1, '#1E6B43', 1],
  ['SR', 'Seniors', 'seven', 'big', 1, 1, 1, 1, '#145A32', 1],
];

const WEEKNIGHTS = '1,2,4,5'; // Mon, Tue, Thu, Fri
const MAIN_SLOTS = [
  ['early', '17:45', '19:15', 'both', WEEKNIGHTS],
  ['late', '19:30', '21:00', 'both', WEEKNIGHTS],
  ['sat1', '08:00', '09:30', 'practice', '6'],
  ['sat2', '09:30', '11:00', 'practice', '6'],
  ['sat3', '11:00', '12:30', 'practice', '6'],
  ['sat4', '12:30', '14:00', 'practice', '6'],
];
const BIG_SLOTS = [
  ['early', '17:45', '19:15', 'practice', WEEKNIGHTS],
  ['late', '19:30', '21:00', 'practice', WEEKNIGHTS],
  ['seven', '19:00', '21:00', 'game', WEEKNIGHTS],
  ['sat1', '08:00', '09:30', 'practice', '6'],
  ['sat2', '09:30', '11:00', 'practice', '6'],
  ['sat3', '11:00', '12:30', 'practice', '6'],
  ['sat4', '12:30', '14:00', 'practice', '6'],
];
const TB_SLOTS = (start, end) => [
  ['tball', start, end, 'both', WEEKNIGHTS],
  ['tsat', '09:00', '10:00', 'practice', '6'],
];

function loadDefaults() {
  if (get('SELECT id FROM divisions LIMIT 1')) { ensureSeason(); return false; }
  tx(() => {
    DIVISIONS.forEach((d, i) => run(
      `INSERT INTO divisions(code,name,slot_rule,field_kind,crew_plate,crew_field,games_per_week,practices_per_week,color,active,sort)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`, ...d, i));
    const bach = run('INSERT INTO parks(name,short,sort) VALUES(?,?,?)', 'Brian Bachmann Community Park', 'Bachmann', 1).lastInsertRowid;
    const ws = run('INSERT INTO parks(name,short,sort) VALUES(?,?,?)', 'Wayne Smith Athletic Complex', 'Wayne Smith', 2).lastInsertRowid;
    const small = 'JMAA,JMAAA,SMAA,SMAAA,MAJ,MAJAA,MAJAAA';
    const big = 'INT,JR,SR';
    let sort = 0;
    const addField = (park, name, kind, divs, slots) => {
      const fid = run('INSERT INTO fields(park_id,name,kind,divisions,sort) VALUES(?,?,?,?,?)', park, name, kind, divs, sort++).lastInsertRowid;
      slots.forEach(s => run('INSERT INTO field_slots(field_id,code,start,end,uses,days) VALUES(?,?,?,?,?,?)', fid, ...s));
      return fid;
    };
    for (let i = 1; i <= 4; i++) addField(bach, `Field ${i}`, 'main', small, MAIN_SLOTS);
    addField(bach, 'Field 5', 'big', big, BIG_SLOTS);
    const f6 = addField(bach, 'Field 6', 'big', big, BIG_SLOTS);
    for (const l of ['A', 'B', 'C', 'D']) addField(bach, `TBall ${l}`, 'tball', 'TB', TB_SLOTS('17:45', '18:45'));
    for (let i = 1; i <= 3; i++) addField(ws, `Field ${i}`, 'main', small, MAIN_SLOTS);
    for (const l of ['1', '2']) addField(ws, `TBall ${l}`, 'tball', 'TB', TB_SLOTS('17:30', '18:30'));

    // BVCHEA games on Field 6 (no practices)
    for (const d of ['2027-03-25', '2027-03-30', '2027-04-02', '2027-04-05', '2027-04-13'])
      run('INSERT INTO blackouts(date,field_id,applies,reason) VALUES(?,?,?,?)', d, f6, 'all', 'BVCHEA games on Field 6');
  });

  const defaults = {
    season_name: 'Spring 2027',
    practice_start: '2027-02-15',
    tball_practice_start: '2027-03-15',
    game_start: '2027-03-22',
    game_weeks: 8,
    makeup_weeks: 1,
    tournament_weeks: 1,
    game_nights: [1, 2, 4, 5],
    request_deadline_days: 3,
    sm_late_only: false,
    duty_reminder_hours: [72, 48, 36, 24, 12, 6],
    duty_quiet_hours: [36, 12],     // these wait until 8 AM if due earlier
    duty_quiet_until: 8,
    duty_lead_minutes: 15,
    jm_pull_order: ['JMAA', 'JMAAA'],
    ump_swap_needs_approval: false,
  };
  for (const [k, v] of Object.entries(defaults)) if (setting(k) === null) setSetting(k, v);
  ensureSeason();
  return true;
}

// Every database has a current season. Older databases get one made from their settings.
function ensureSeason() {
  if (currentSeason()) return;
  const existing = get('SELECT id FROM seasons ORDER BY id DESC LIMIT 1');
  let id = existing && existing.id;
  if (!id) {
    const pick = {};
    for (const k of ['practice_start', 'tball_practice_start', 'game_start', 'game_weeks', 'makeup_weeks', 'tournament_weeks']) pick[k] = setting(k);
    const name = String(setting('season_name') || 'Spring 2027');
    const m = name.match(/(Spring|Fall|All-Stars|Demo)\s+(\d{4})/i);
    id = createSeason(m ? m[1] : 'Spring', m ? Number(m[2]) : 2027, pick);
  }
  run('UPDATE teams SET season_id=? WHERE season_id IS NULL', id);
  activateSeason(id);
}

module.exports = { loadDefaults, ensureSeason };
