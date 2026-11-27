// SQLite storage (built into Node 22+). One file: data/csll.db
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'csll.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  first TEXT NOT NULL, last TEXT NOT NULL,
  phone TEXT, email TEXT,
  is_admin INTEGER DEFAULT 0, is_board INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0,
  is_umpire INTEGER DEFAULT 0, is_ump_coord INTEGER DEFAULT 0, is_president INTEGER DEFAULT 0,
  can_edit_schedule INTEGER DEFAULT 0,
  notify_sms INTEGER DEFAULT 1, notify_email INTEGER DEFAULT 1,
  cal_token TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people(email) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS people_phone ON people(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS divisions (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT, sort INTEGER,
  slot_rule TEXT DEFAULT 'any',          -- early | late | seven | any | tball
  field_kind TEXT DEFAULT 'main',        -- main | tball
  crew_plate INTEGER DEFAULT 1, crew_field INTEGER DEFAULT 1,
  games_per_week INTEGER DEFAULT 2, practices_per_week INTEGER DEFAULT 1,
  color TEXT DEFAULT '#5C1118', active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS parks (id INTEGER PRIMARY KEY, name TEXT, short TEXT, sort INTEGER);
CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY, park_id INTEGER REFERENCES parks(id), name TEXT, kind TEXT DEFAULT 'main',
  divisions TEXT DEFAULT '', sort INTEGER, active INTEGER DEFAULT 1
);
-- What time slots each field offers. days = comma list of weekday numbers (0=Sun..6=Sat)
CREATE TABLE IF NOT EXISTS field_slots (
  id INTEGER PRIMARY KEY, field_id INTEGER REFERENCES fields(id) ON DELETE CASCADE,
  code TEXT, start TEXT, end TEXT, uses TEXT DEFAULT 'both', days TEXT DEFAULT '1,2,4,5'
);

CREATE TABLE IF NOT EXISTS blackouts (
  id INTEGER PRIMARY KEY, date TEXT, park_id INTEGER, field_id INTEGER, slot_code TEXT,
  applies TEXT DEFAULT 'all', reason TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY, division_id INTEGER REFERENCES divisions(id), name TEXT,
  priority_rank INTEGER, external_id TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS team_coaches (
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE, person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'head', PRIMARY KEY (team_id, person_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, type TEXT,          -- game | practice | scrimmage | other
  date TEXT, field_id INTEGER REFERENCES fields(id), slot_code TEXT, start TEXT, end TEXT,
  division_id INTEGER, home_team_id INTEGER, away_team_id INTEGER, team_id INTEGER,
  status TEXT DEFAULT 'scheduled',             -- scheduled | cancelled | rainout
  source TEXT DEFAULT 'manual',                -- generated | extra | manual
  week_label TEXT, title TEXT, notes TEXT, published INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS events_date ON events(date);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY, person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT,                 -- coach | umpire | board
  weekday INTEGER, date TEXT, slot_code TEXT DEFAULT 'any',
  available INTEGER DEFAULT 1, note TEXT
);

CREATE TABLE IF NOT EXISTS practice_requests (
  id INTEGER PRIMARY KEY, team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES people(id), date TEXT, field_id INTEGER, slot_code TEXT,
  preference INTEGER DEFAULT 1, status TEXT DEFAULT 'pending', -- pending | awarded | lost | cancelled
  warned INTEGER DEFAULT 0, event_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, decided_at TEXT
);

CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY, kind TEXT,       -- practice | umpire | scrimmage
  from_person INTEGER, to_person INTEGER, from_team INTEGER, to_team INTEGER,
  event_a INTEGER, event_b INTEGER, assignment_id INTEGER, message TEXT,
  status TEXT DEFAULT 'open',              -- open | done | cancelled | declined
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, done_at TEXT
);

CREATE TABLE IF NOT EXISTS duty_shifts (
  id INTEGER PRIMARY KEY, date TEXT, park_id INTEGER, shift TEXT, start TEXT, end TEXT,
  night_type TEXT, needed INTEGER DEFAULT 1, UNIQUE(date, park_id, shift)
);
CREATE TABLE IF NOT EXISTS duty_signups (
  shift_id INTEGER REFERENCES duty_shifts(id) ON DELETE CASCADE, person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (shift_id, person_id)
);
CREATE TABLE IF NOT EXISTS duty_reminders (shift_id INTEGER, hours INTEGER, sent_at TEXT, PRIMARY KEY (shift_id, hours));

CREATE TABLE IF NOT EXISTS umpire_divisions (
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE, division_id INTEGER REFERENCES divisions(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, division_id)
);
CREATE TABLE IF NOT EXISTS ump_assignments (
  id INTEGER PRIMARY KEY, event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES people(id), position TEXT,   -- plate | field
  status TEXT DEFAULT 'assigned',   -- assigned | sick | present | no_show
  worked_position TEXT, checkin_at TEXT, confirmed_by INTEGER, confirmed_at TEXT, pay_cents INTEGER
);
CREATE TABLE IF NOT EXISTS pay_rates (division_id INTEGER, position TEXT, cents INTEGER, PRIMARY KEY (division_id, position));

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, person_id INTEGER, title TEXT, body TEXT, link TEXT,
  sms_status TEXT, email_status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, read_at TEXT
);
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY, person_id INTEGER, code_hash TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0, used INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, person_id INTEGER, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, person_id INTEGER, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- helpers ----------
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function setting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}
function audit(personId, action, detail) {
  run('INSERT INTO audit_log(person_id,action,detail) VALUES(?,?,?)', personId || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail || {}));
}

module.exports = { db, all, get, run, tx, setting, setSetting, audit, DB_PATH };
