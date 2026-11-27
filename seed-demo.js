// Fills an empty database with made-up teams, coaches, board members and umpires so you can try every screen.
// Usage: DEMO_MODE=true npm run seed:demo   (then log in as admin@example.com; the code shows on screen)
process.env.TZ = 'America/Chicago';
const { all, get, run, tx } = require('./db');
const { loadDefaults } = require('./defaults');
const T = require('./time');
loadDefaults();
if (process.env.DEMO_LIVE_DATES === 'true') {
  // Online demo: start practices this week and games in 3 weeks so every screen has something "today"
  const T0 = require('./time');
  const { createSeason, activateSeason } = require('./db');
  const mon = T0.mondayOf(T0.today());
  const id = createSeason('Demo', Number(mon.slice(0, 4)), { practice_start: mon, tball_practice_start: mon, game_start: T0.addDays(mon, 21), game_weeks: 8, makeup_weeks: 1, tournament_weeks: 1 });
  activateSeason(id);
  run('DELETE FROM blackouts');
}
if (get('SELECT 1 FROM teams LIMIT 1') && !process.argv.includes('--force')) { console.log('Teams already exist; use --force to add demo data anyway.'); process.exit(0); }

const FIRST = ['Alex', 'Ben', 'Carlos', 'Dana', 'Eli', 'Frank', 'Grace', 'Hank', 'Ivan', 'Jill', 'Kyle', 'Luis', 'Mia', 'Nate', 'Omar', 'Paul', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uri', 'Vic', 'Wade', 'Xena', 'Yuri', 'Zach'];
const LAST = ['Adams', 'Brooks', 'Cruz', 'Diaz', 'Ellis', 'Foster', 'Garcia', 'Hayes', 'Irwin', 'James', 'Klein', 'Lopez', 'Moore', 'Nolan', 'Ortiz', 'Price', 'Reed', 'Shaw', 'Tran', 'Vega', 'Walsh', 'Young'];
let n = 0;
const person = (roles = {}) => {
  n++;
  const first = FIRST[n % FIRST.length], last = LAST[(Math.floor(n / FIRST.length) + n * 3) % LAST.length];
  return run(`INSERT INTO people(first,last,email,phone,is_board,is_coach,is_umpire,is_ump_coord,is_admin,is_president,cal_token)
              VALUES(?,?,?,?,?,?,?,?,?,?,lower(hex(randomblob(16))))`, first, last, `demo${n}@example.com`, `+1979555${String(1000 + n).slice(-4)}`,
    +!!roles.board, +!!roles.coach, +!!roles.umpire, +!!roles.coord, +!!roles.admin, +!!roles.president).lastInsertRowid;
};

tx(() => {
  const admin = run(`INSERT INTO people(first,last,email,phone,is_admin,is_board,is_president,cal_token) VALUES('Demo','President','admin@example.com','+19795550000',1,1,1,lower(hex(randomblob(16))))`).lastInsertRowid;
  const board = Array.from({ length: 12 }, (_, i) => person({ board: true, coord: i === 11 }));
  run('UPDATE people SET is_duty_coord=1 WHERE id=?', board[10]);
  const divs = all('SELECT * FROM divisions WHERE active=1');
  const counts = { TB: 10, JMAA: 8, JMAAA: 8, SMAA: 6, SMAAA: 6, MAJ: 6, INT: 2, JR: 4, SR: 2 };
  const mascots = ['Aggies', 'Bulldogs', 'Cardinals', 'Dodgers', 'Express', 'Falcons', 'Giants', 'Hawks', 'Ironbirds', 'Jays', 'Knights', 'Lions'];
  let boardIdx = 0;
  for (const d of divs) {
    for (let i = 0; i < (counts[d.code] || 0); i++) {
      const team = run('INSERT INTO teams(division_id,name) VALUES(?,?)', d.id, `${d.code} ${mascots[i]}`).lastInsertRowid;
      // about one in five teams has a board member as head or assistant
      const head = (i % 5 === 1 && boardIdx < 8) ? board[boardIdx++] : person({ coach: true });
      run('INSERT INTO team_coaches(team_id,person_id,role) VALUES(?,?,?)', team, head, 'head');
      run('UPDATE people SET is_coach=1 WHERE id=?', head);
      run('INSERT INTO team_coaches(team_id,person_id,role) VALUES(?,?,?)', team, person({ coach: true }), 'assistant');
      // coach availability: weekly preferences
      const prefs = [[1, 'early'], [2, 'late'], [4, 'early'], [5, 'late'], [2, 'early'], [4, 'late']];
      const pick = prefs.slice(i % 3, (i % 3) + 3);
      for (const [wd, slot] of pick) run(`INSERT INTO availability(person_id,kind,weekday,slot_code,available) VALUES(?,?,?,?,1)`, head, 'coach', wd, slot);
    }
  }
  // parents coaching two of their kids' teams (head on one, assistant on the other), plus practice coaches
  const heads = all(`SELECT tc.person_id, t.id AS team_id, d.code FROM team_coaches tc JOIN teams t ON t.id=tc.team_id JOIN divisions d ON d.id=t.division_id WHERE tc.role='head'`);
  const pairs = [['TB', 'JMAA'], ['JMAA', 'SMAA'], ['JMAAA', 'MAJ'], ['SMAAA', 'JR'], ['TB', 'SMAA']];
  pairs.forEach(([a, b], i) => {
    const from = heads.filter(h => h.code === a)[i + 2], to = heads.filter(h => h.code === b)[i + 3];
    if (from && to) run(`INSERT OR IGNORE INTO team_coaches(team_id,person_id,role) VALUES(?,?,'assistant')`, to.team_id, from.person_id);
  });
  for (const t of all('SELECT id FROM teams').filter((_, i) => i % 4 === 0)) run(`INSERT INTO team_coaches(team_id,person_id,role) VALUES(?,?,'practice')`, t.id, person({ coach: true }));
  // umpires
  const umpDivs = all(`SELECT id, code FROM divisions WHERE code<>'TB' AND active=1`);
  for (let i = 0; i < 26; i++) {
    const u = person({ umpire: true });
    const set = i < 10 ? ['JMAA', 'JMAAA'] : i < 18 ? ['JMAA', 'JMAAA', 'SMAA', 'SMAAA'] : ['SMAA', 'SMAAA', 'MAJ', 'INT', 'JR', 'SR'];
    for (const d of umpDivs.filter(d => set.includes(d.code))) run('INSERT INTO umpire_divisions(person_id,division_id) VALUES(?,?)', u, d.id);
    const nights = [[1, 2, 4, 5], [1, 2, 4], [2, 4, 5], [1, 5]][i % 4];
    for (const wd of nights) run(`INSERT INTO availability(person_id,kind,weekday,slot_code,available) VALUES(?,?,?,?,1)`, u, 'umpire', wd, 'any');
  }
  // board rule example: no early shifts except Fridays
  for (const wd of [1, 2, 4]) run(`INSERT INTO availability(person_id,kind,weekday,slot_code,available) VALUES(?,?,?,?,0)`, board[3], 'board', wd, 'early');
  // pay rates (example numbers only; set real ones in Admin > Setup)
  for (const d of all('SELECT id, code FROM divisions')) {
    const base = { JMAA: 2500, JMAAA: 2500, SMAA: 3000, SMAAA: 3000, MAJ: 3500, MAJAA: 3500, MAJAAA: 3500, INT: 4000, JR: 4000, SR: 4000 }[d.code] || 0;
    run('INSERT OR REPLACE INTO pay_rates(division_id,position,cents) VALUES(?,?,?)', d.id, 'plate', base + 1000);
    run('INSERT OR REPLACE INTO pay_rates(division_id,position,cents) VALUES(?,?,?)', d.id, 'field', base);
  }
});

const { generateGames } = require('./engine-games');
const { generatePractices } = require('./engine-practices');
const { generateUmpires } = require('./engine-umpires');
const { rebuildShifts } = require('./engine-duty');
const { resetPriority, seasonEnd } = require('./engine-requests');
const { setting } = require('./db');

const g = generateGames({ seed: 42 });
if (process.env.DEMO_LIVE_DATES === 'true') {
  // games during the practice weeks too, so umpire and field duty screens are busy right away
  generateGames({ seed: 43, start: setting('practice_start'), weeks: 3, replace: false });
}
console.log('games:', g.created, 'unplaced:', g.unplaced.length);
const p = generatePractices({ seed: 7 });
console.log('practices:', p.created, 'short:', p.short.length);
const u = generateUmpires({ start: setting('practice_start'), end: seasonEnd(), seed: 3 });
console.log('umpires filled:', u.filled, 'still open:', u.stillOpen);
console.log('duty shifts:', rebuildShifts(setting('practice_start'), seasonEnd()));
{ // some board members already signed up: most shifts this week, fewer further out
  const { shiftAvailability } = require('./engine-duty');
  const shifts = all('SELECT * FROM duty_shifts WHERE date >= ? ORDER BY date LIMIT 120', T.today());
  let k = 0;
  shifts.forEach((sh, i) => {
    const chance = i < 16 ? 0.8 : i < 40 ? 0.55 : 0.3;
    if (((i * 37) % 100) / 100 >= chance) return;
    const ok = shiftAvailability(sh.id).filter(a => a.canWork && a.status !== 'unavailable');
    if (ok.length) run('INSERT OR IGNORE INTO duty_signups(shift_id,person_id) VALUES(?,?)', sh.id, ok[(k++) % ok.length].id);
  });
}
run('UPDATE events SET published=1');
resetPriority(11);
console.log('Demo data ready. Log in with admin@example.com (DEMO_MODE=true shows the code on screen).');
