// Passwordless login: phone or email -> 6-digit code by text or email -> session cookie (90 days).
const crypto = require('crypto');
const { get, run, all } = require('./db');
const { sendSms, sendEmail, normalizePhone } = require('./notify');

const SESSION_DAYS = 90;
const CODE_MINUTES = 10;
const DEMO = process.env.DEMO_MODE === 'true';
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function findPerson(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  if (id.includes('@')) return get('SELECT * FROM people WHERE lower(email)=lower(?) AND active=1', id);
  const phone = normalizePhone(id);
  return phone ? get('SELECT * FROM people WHERE phone=? AND active=1', phone) : null;
}

// Simple in-memory rate limit: 5 code requests per identifier per 15 minutes
const hits = new Map();
function limited(key, max = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now); hits.set(key, list);
  return list.length > max;
}

async function requestCode(identifier) {
  if (limited('req:' + String(identifier).toLowerCase())) return { ok: false, error: 'Too many tries. Wait a few minutes and try again.' };
  const person = findPerson(identifier);
  // Same answer whether or not we found someone, so the form can't be used to look up members.
  const generic = { ok: true, via: String(identifier).includes('@') ? 'email' : 'text' };
  if (!person) return generic;
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  run('UPDATE login_codes SET used=1 WHERE person_id=? AND used=0', person.id);
  run('INSERT INTO login_codes(person_id,code_hash,expires_at) VALUES(?,?,?)', person.id, hash(code), Date.now() + CODE_MINUTES * 60000);
  const msg = `Your CSLL Schedules code is ${code}. It expires in ${CODE_MINUTES} minutes.`;
  if (String(identifier).includes('@')) await sendEmail(person.email, 'Your CSLL Schedules login code', msg);
  else await sendSms(person.phone, msg);
  if (DEMO) generic.demoCode = code; // demo/testing only: show the code on screen
  return generic;
}

function verifyCode(identifier, code) {
  if (limited('ver:' + String(identifier).toLowerCase(), 10)) return { ok: false, error: 'Too many tries. Wait a few minutes.' };
  const person = findPerson(identifier);
  if (!person) return { ok: false, error: 'That code is not right or has expired.' };
  const row = get('SELECT * FROM login_codes WHERE person_id=? AND used=0 ORDER BY id DESC LIMIT 1', person.id);
  if (!row || row.expires_at < Date.now() || row.attempts >= 5) return { ok: false, error: 'That code is not right or has expired.' };
  if (row.code_hash !== hash(String(code).trim())) {
    run('UPDATE login_codes SET attempts=attempts+1 WHERE id=?', row.id);
    return { ok: false, error: 'That code is not right or has expired.' };
  }
  run('UPDATE login_codes SET used=1 WHERE id=?', row.id);
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,person_id,expires_at) VALUES(?,?,?)', hash(token), person.id, Date.now() + SESSION_DAYS * 86400000);
  return { ok: true, token, maxAge: SESSION_DAYS * 86400000 };
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}

function sessionPerson(req) {
  const token = parseCookies(req).csll_session;
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token=?', hash(token));
  if (!s || s.expires_at < Date.now()) return null;
  return get('SELECT * FROM people WHERE id=? AND active=1', s.person_id);
}

function logout(req) {
  const token = parseCookies(req).csll_session;
  if (token) run('DELETE FROM sessions WHERE token=?', hash(token));
}

// Roles derived for a person (used by API and UI)
function rolesOf(p) {
  if (!p) return {};
  const coachTeams = all(`SELECT t.id, t.name, t.division_id, tc.role, d.code AS division_code, d.name AS division_name
                          FROM team_coaches tc JOIN teams t ON t.id=tc.team_id JOIN divisions d ON d.id=t.division_id
                          WHERE tc.person_id=? AND t.active=1`, p.id);
  return {
    admin: !!p.is_admin,
    board: !!(p.is_board || p.is_admin),
    coach: coachTeams.length > 0 || !!p.is_coach,
    // head and assistant coaches schedule for their teams; practice coaches only view
    teamScheduler: coachTeams.some(t => t.role !== 'practice'),
    umpire: !!p.is_umpire,
    umpCoord: !!(p.is_ump_coord || p.is_admin),
    president: !!p.is_president,
    scheduler: !!(p.is_admin || p.can_edit_schedule),
    coachTeams,
    manageTeams: coachTeams.filter(t => t.role !== 'practice'),
  };
}

module.exports = { requestCode, verifyCode, sessionPerson, logout, rolesOf, findPerson, DEMO };
