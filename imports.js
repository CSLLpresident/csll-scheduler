// CSV imports: people (coaches, board members, umpires) and Sports Connect team/coach exports.
// Every import is previewed first ("what will change"), then applied.
const { all, get, run, tx } = require('./db');
const { normalizePhone } = require('./notify');

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const filtered = rows.filter(r => r.some(c => c.trim()));
  if (!filtered.length) return [];
  const head = filtered[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  return filtered.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

// find a column by any of several possible header names
const pick = (row, ...names) => { for (const n of names) for (const k of Object.keys(row)) if (k === n || k.includes(n)) { if (row[k]) return row[k]; } return ''; };
// "Head Coach"/"Manager" -> head, "Assistant Coach" -> assistant, "Practice Coach" -> practice (views only)
const coachRoleOf = v => /practice/i.test(v || '') ? 'practice' : /assist/i.test(v || '') ? 'assistant' : 'head';
const yes = v => /^(y|yes|true|1|x)$/i.test(String(v || '').trim());

function matchPerson(email, phone, first, last) {
  if (email) { const p = get('SELECT * FROM people WHERE lower(email)=lower(?)', email); if (p) return p; }
  if (phone) { const p = get('SELECT * FROM people WHERE phone=?', phone); if (p) return p; }
  if (first && last) return get('SELECT * FROM people WHERE lower(first)=lower(?) AND lower(last)=lower(?)', first, last);
  return null;
}

function divisionFromText(txt) {
  const t = String(txt || '').toUpperCase().replace(/[^A-Z]/g, '');
  const divs = all('SELECT * FROM divisions');
  const exact = divs.find(d => d.code === t || d.name.toUpperCase().replace(/[^A-Z]/g, '') === t);
  if (exact) return exact;
  const guesses = [
    [/TEE|TBALL/, 'TB'], [/JUNIORMINORAAA|JMAAA/, 'JMAAA'], [/JUNIORMINORAA|JMAA/, 'JMAA'], [/SENIORMINORAAA|SMAAA/, 'SMAAA'],
    [/SENIORMINORAA|SMAA/, 'SMAA'], [/MAJORSAAA|MAJAAA/, 'MAJAAA'], [/MAJORSAA|MAJAA/, 'MAJAA'], [/MAJOR/, 'MAJ'],
    [/INTERMEDIATE|5070/, 'INT'], [/JUNIOR/, 'JR'], [/SENIOR/, 'SR'],
  ];
  for (const [re, code] of guesses) if (re.test(t)) return divs.find(d => d.code === code);
  return null;
}

/**
 * People CSV columns (any order, case-insensitive): First, Last, Phone, Email, Roles (board; umpire; coach; admin; ump coord; president),
 * or yes/no columns Board, Umpire, Coach. Optional: Team, Division, Coach Role (head/assistant), Umpire Divisions (JMAA;SMAA...).
 */
function previewPeople(text) {
  const rows = parseCsv(text);
  const out = [];
  for (const r of rows) {
    const first = pick(r, 'first name', 'first'), last = pick(r, 'last name', 'last');
    if (!first && !last) continue;
    const email = pick(r, 'email').toLowerCase();
    const phone = normalizePhone(pick(r, 'cell', 'mobile', 'phone'));
    const rolesText = pick(r, 'roles', 'role').toLowerCase();
    const roles = {
      is_board: yes(pick(r, 'board')) || /board|duty coord|field duty/.test(rolesText),
      is_umpire: yes(pick(r, 'umpire')) || /ump/.test(rolesText) && !/coord/.test(rolesText) || /umpire/.test(rolesText),
      is_coach: yes(pick(r, 'coach')) || /coach/.test(rolesText),
      is_admin: /admin/.test(rolesText),
      is_ump_coord: /ump\w* coord/.test(rolesText) || (/coord/.test(rolesText) && !/duty|field/.test(rolesText)),
      is_duty_coord: /(duty|field)\w* coord/.test(rolesText),
      is_president: /president/.test(rolesText),
    };
    const existing = matchPerson(email, phone, first, last);
    out.push({ first, last, email, phone, roles, team: pick(r, 'team'), division: pick(r, 'division'), coachRole: coachRoleOf(pick(r, 'coach role', 'volunteer role', 'team role')),
      umpDivs: pick(r, 'umpire divisions', 'ump divisions'), action: existing ? 'update' : 'add', existingId: existing?.id || null });
  }
  return out;
}

function applyPeople(text) {
  const rows = previewPeople(text);
  let added = 0, updated = 0;
  tx(() => {
    for (const r of rows) {
      let id = r.existingId;
      if (id) {
        const p = get('SELECT * FROM people WHERE id=?', id);
        run(`UPDATE people SET first=?, last=?, email=COALESCE(NULLIF(?,''),email), phone=COALESCE(?,phone),
             is_board=?, is_umpire=?, is_coach=?, is_admin=?, is_ump_coord=?, is_president=?, is_duty_coord=? WHERE id=?`,
          r.first, r.last, r.email, r.phone,
          +(p.is_board || r.roles.is_board), +(p.is_umpire || r.roles.is_umpire), +(p.is_coach || r.roles.is_coach),
          +(p.is_admin || r.roles.is_admin), +(p.is_ump_coord || r.roles.is_ump_coord), +(p.is_president || r.roles.is_president), +(p.is_duty_coord || r.roles.is_duty_coord), id);
        updated++;
      } else {
        id = run(`INSERT INTO people(first,last,email,phone,is_board,is_umpire,is_coach,is_admin,is_ump_coord,is_president,is_duty_coord,cal_token)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,lower(hex(randomblob(16))))`,
          r.first, r.last, r.email || null, r.phone || null, +r.roles.is_board, +r.roles.is_umpire, +r.roles.is_coach,
          +r.roles.is_admin, +r.roles.is_ump_coord, +r.roles.is_president, +r.roles.is_duty_coord).lastInsertRowid;
        added++;
      }
      if (r.team) {
        const div = divisionFromText(r.division);
        let team = get('SELECT * FROM teams WHERE active=1 AND lower(name)=lower(?)' + (div ? ' AND division_id=?' : ''), ...(div ? [r.team, div.id] : [r.team]));
        if (!team && div) team = { id: run('INSERT INTO teams(division_id,name) VALUES(?,?)', div.id, r.team).lastInsertRowid };
        if (team) run('INSERT OR REPLACE INTO team_coaches(team_id,person_id,role) VALUES(?,?,?)', team.id, id, r.coachRole);
      }
      if (r.umpDivs) for (const code of r.umpDivs.split(/[;|/ ]+/)) {
        const d = divisionFromText(code); if (d) run('INSERT OR IGNORE INTO umpire_divisions(person_id,division_id) VALUES(?,?)', id, d.id);
      }
    }
  });
  return { added, updated };
}

/**
 * Sports Connect team/volunteer export. Looks for Division, Team, and volunteer (coach) name/email/phone/role columns.
 * Preview lists new teams, new coaches and coach changes; nothing is removed automatically.
 */
function previewSportsConnect(text) {
  const rows = parseCsv(text);
  const teams = new Map();
  for (const r of rows) {
    const divText = pick(r, 'division name', 'division', 'program');
    const teamName = pick(r, 'team name', 'team');
    if (!teamName) continue;
    const div = divisionFromText(divText);
    const key = `${div?.id || divText}|${teamName.toLowerCase()}`;
    const t = teams.get(key) || teams.set(key, { teamName, divText, division: div, coaches: [] }).get(key);
    const first = pick(r, 'volunteer first name', 'coach first name', 'first name');
    const last = pick(r, 'volunteer last name', 'coach last name', 'last name');
    if (first || last) {
      const role = pick(r, 'volunteer role', 'role', 'position').toLowerCase();
      if (role && !/coach|manager/.test(role)) continue; // team parents, scorekeepers etc. stay out
      t.coaches.push({ first, last, email: pick(r, 'volunteer email', 'email').toLowerCase(), phone: normalizePhone(pick(r, 'volunteer cell', 'cell', 'phone')),
        role: coachRoleOf(role) });
    }
  }
  const changes = [];
  for (const t of teams.values()) {
    const existing = t.division ? get('SELECT * FROM teams WHERE active=1 AND lower(name)=lower(?) AND division_id=?', t.teamName, t.division.id) : null;
    const entry = { team: t.teamName, division: t.division?.name || `Unknown: ${t.divText}`, divisionId: t.division?.id || null, teamAction: existing ? 'keep' : 'add', teamId: existing?.id || null, coaches: [] };
    for (const c of t.coaches) {
      const p = matchPerson(c.email, c.phone, c.first, c.last);
      const linked = p && existing ? get('SELECT role FROM team_coaches WHERE team_id=? AND person_id=?', existing.id, p.id) : null;
      entry.coaches.push({ ...c, personId: p?.id || null, action: !p ? 'new person' : !linked ? 'add to team' : linked.role !== c.role ? 'change role' : 'no change' });
    }
    if (existing) {
      const listed = new Set(entry.coaches.map(c => c.personId).filter(Boolean));
      for (const cur of all('SELECT p.first, p.last, p.id, tc.role FROM team_coaches tc JOIN people p ON p.id=tc.person_id WHERE tc.team_id=?', existing.id))
        if (!listed.has(cur.id)) entry.coaches.push({ first: cur.first, last: cur.last, personId: cur.id, role: cur.role, action: 'not in file (left as is)' });
    }
    changes.push(entry);
  }
  return changes;
}

function applySportsConnect(text) {
  const changes = previewSportsConnect(text);
  let teamsAdded = 0, peopleAdded = 0, links = 0;
  tx(() => {
    for (const c of changes) {
      if (!c.divisionId) continue;
      let teamId = c.teamId;
      if (!teamId) { teamId = run('INSERT INTO teams(division_id,name) VALUES(?,?)', c.divisionId, c.team).lastInsertRowid; teamsAdded++; }
      for (const co of c.coaches) {
        if (co.action === 'no change' || co.action.startsWith('not in file')) continue;
        let pid = co.personId;
        if (!pid) {
          pid = run(`INSERT INTO people(first,last,email,phone,is_coach,cal_token) VALUES(?,?,?,?,1,lower(hex(randomblob(16))))`, co.first, co.last, co.email || null, co.phone || null).lastInsertRowid;
          peopleAdded++;
        }
        run('INSERT OR REPLACE INTO team_coaches(team_id,person_id,role) VALUES(?,?,?)', teamId, pid, co.role);
        run('UPDATE people SET is_coach=1 WHERE id=?', pid);
        links++;
      }
    }
  });
  const { renumberRanks } = require('./engine-requests');
  renumberRanks();
  return { teamsAdded, peopleAdded, links };
}

module.exports = { parseCsv, previewPeople, applyPeople, previewSportsConnect, applySportsConnect, divisionFromText };
