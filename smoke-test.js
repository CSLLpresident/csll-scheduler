// End-to-end smoke test on a throwaway copy of the database. Run: npm test
process.env.TZ = 'America/Chicago';
const fs = require('fs'), path = require('path'), os = require('os');
const tmp = path.join(os.tmpdir(), `csll-test-${Date.now()}.db`);
process.env.DB_PATH = tmp; process.env.DEMO_MODE = 'true'; process.env.JOBS = 'off';
require('./seed-demo.js');
const app = require('./server.js');
const { get, all, run } = require('./db');
const T = require('./time');
const assert = require('assert');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const jars = {};
async function call(who, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: jars[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[who] = sc.split(';')[0];
  const txt = await res.text(); let data; try { data = JSON.parse(txt); } catch { data = txt; }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function login(who, ident) {
  const r = await call(who, 'POST', '/api/auth/request', { identifier: ident });
  assert(r.demoCode, 'demo code');
  await call(who, 'POST', '/api/auth/verify', { identifier: ident, code: r.demoCode });
}
const ok = m => console.log('  ✓', m);

(async () => {
  try {
    await login('admin', 'admin@example.com');
    const me = await call('admin', 'GET', '/api/me'); assert(me.roles.admin); ok('admin login with code');
    const meta = await call('admin', 'GET', '/api/meta'); assert(meta.fields.length === 15); ok(`meta: ${meta.fields.length} fields, ${meta.teams.length} teams`);
    const ev = await call('admin', 'GET', `/api/events?start=2027-03-22&end=2027-03-28`); assert(ev.length > 30); ok(`week 1 has ${ev.length} events`);

    // a coach logs in by phone
    const headRow = get(`SELECT p.*, tc.team_id FROM team_coaches tc JOIN people p ON p.id=tc.person_id JOIN teams t ON t.id=tc.team_id JOIN divisions d ON d.id=t.division_id WHERE tc.role='head' AND p.is_board=0 AND d.code='JMAA' LIMIT 1`);
    await login('coach', headRow.phone.slice(2)); ok('coach login with 10-digit phone');
    const cm = await call('coach', 'GET', '/api/me'); assert(cm.roles.coachTeams.length); ok('coach sees their team');

    // ----- extra practice priority queue -----
    // pick an open slot 10 days after a fake "now" by moving the decision clock: request two teams on the same slot
    const R = require('./engine-requests');
    const { fieldFits } = require('./engine-practices');
    const team1 = get('SELECT t.*, d.code FROM teams t JOIN divisions d ON d.id=t.division_id WHERE t.id=?', headRow.team_id);
    const team2 = get('SELECT * FROM teams WHERE division_id=? AND id<>? LIMIT 1', team1.division_id, team1.id);
    const coach2 = get(`SELECT person_id FROM team_coaches WHERE team_id=? AND role='head'`, team2.id);
    const ps = require('./db').setting('practice_start'); const future = T.addDays(T.today() > ps ? T.today() : ps, 20);
    const slot = R.openSlots(future, T.addDays(future, 60)).find(s => fieldFits({ code: team1.code }, s) && !R.teamBusyThatDay(team1.id, s.date) && !R.teamBusyThatDay(team2.id, s.date));
    assert(slot, 'found open slot');
    run('UPDATE teams SET priority_rank=-2 WHERE id=?', team2.id); run('UPDATE teams SET priority_rank=-1 WHERE id=?', team1.id); R.renumberRanks();
    const r1 = await call('coach', 'POST', '/api/practice/requests', { teamId: team1.id, date: slot.date, fieldId: slot.field_id, slotCode: slot.slot_code });
    assert.equal(r1.status, 'pending'); ok('request > 3 days out waits');
    const p2 = get('SELECT * FROM people WHERE id=?', coach2.person_id);
    R.requestPractice(p2, team2.id, slot.date, slot.field_id, slot.slot_code);
    const pend = R.pendingWithStatus(team1.id)[0]; assert(pend.atRisk, 'team1 at risk'); ok('lower-ranked team flagged "at risk" and warned');
    const decide = new Date(R.decisionTime({ date: slot.date, start: slot.start }).getTime() + 1000);
    const res = R.processDeadlines(decide); assert.equal(res.awarded, 1);
    const won = get(`SELECT * FROM practice_requests WHERE team_id=? AND date=? AND field_id=?`, team2.id, slot.date, slot.field_id);
    assert.equal(won.status, 'awarded'); ok('higher-ranked team wins at the deadline');
    const lost = get(`SELECT * FROM practice_requests WHERE team_id=? AND date=? AND field_id=?`, team1.id, slot.date, slot.field_id);
    assert.equal(lost.status, 'lost'); ok('other team marked lost and notified');
    const ranks = all('SELECT id, priority_rank FROM teams ORDER BY priority_rank');
    assert.equal(ranks[ranks.length - 1].id, team2.id); assert.equal(get('SELECT priority_rank FROM teams WHERE id=?', team1.id).priority_rank, 1);
    ok('winner drops to the bottom, everyone else moves up one');

    // inside 3 days: first come, first served
    const soon = T.addDays(T.today(), 1);
    const soonSlot = R.openSlots(soon, T.addDays(soon, 1)).find(s => fieldFits({ code: team1.code }, s) && !R.teamBusyThatDay(team1.id, s.date));
    if (soonSlot) { const r3 = await call('coach', 'POST', '/api/practice/requests', { teamId: team1.id, date: soonSlot.date, fieldId: soonSlot.field_id, slotCode: soonSlot.slot_code }); assert.equal(r3.status, 'awarded'); ok('inside 3 days books immediately'); }

    // ----- practice swap -----
    const pr1 = get(`SELECT * FROM events WHERE type='practice' AND team_id=? AND date>=? ORDER BY date LIMIT 1`, team1.id, T.today());
    const pr2 = get(`SELECT * FROM events WHERE type='practice' AND team_id=? AND date>=? AND date<>? ORDER BY date LIMIT 1`, team2.id, T.today(), pr1.date);
    const sw = await call('coach', 'POST', '/api/swaps/practice', { eventA: pr1.id, eventB: pr2.id });
    await login('coach2', p2.email);
    await call('coach2', 'POST', `/api/swaps/${sw.id}/respond`, { accept: true });
    assert.equal(get('SELECT team_id FROM events WHERE id=?', pr1.id).team_id, team2.id); ok('1-for-1 practice swap after both agree');

    // ----- scrimmage -----
    const pr3 = get(`SELECT * FROM events WHERE type='practice' AND team_id=? AND date>=? ORDER BY date LIMIT 1`, team1.id, T.today());
    if (!R.teamBusyThatDay(team2.id, pr3.date)) {
      const sc = await call('coach', 'POST', '/api/swaps/scrimmage', { eventA: pr3.id, toTeam: team2.id });
      await call('coach2', 'POST', `/api/swaps/${sc.id}/respond`, { accept: true });
      assert.equal(get('SELECT type FROM events WHERE id=?', pr3.id).type, 'scrimmage'); ok('scrimmage invite accepted');
    }

    // ----- umpires: sick call, pickup, swap, attendance, payroll -----
    const a = get(`SELECT a.*, e.division_id FROM ump_assignments a JOIN events e ON e.id=a.event_id WHERE a.person_id IS NOT NULL ORDER BY e.date LIMIT 1`);
    const ump = get('SELECT * FROM people WHERE id=?', a.person_id);
    await login('ump', ump.email);
    const sick = await call('ump', 'POST', `/api/umps/assignments/${a.id}/sick`);
    assert(sick.openId); ok('sick call opens the spot');
    const notes = get(`SELECT COUNT(*) AS n FROM notifications WHERE title='Umpire needed'`).n; assert(notes > 0); ok(`${notes} qualified umpires notified`);
    assert(get(`SELECT COUNT(*) AS n FROM notifications WHERE title LIKE 'Sick call%'`).n > 0); ok('coordinator and president emailed');
    const free = require('./engine-umpires').availableFor(sick.openId)[0];
    if (free) {
      await login('ump2', free.email);
      await call('ump2', 'POST', `/api/umps/assignments/${sick.openId}/assign`, {});
      assert.equal(get('SELECT person_id FROM ump_assignments WHERE id=?', sick.openId).person_id, free.id); ok('another umpire picked up the open spot');
      const offer = await call('ump2', 'POST', `/api/umps/assignments/${sick.openId}/offer`, {});
      const taker = require('./engine-umpires').availableFor(sick.openId).find(u => u.id !== ump.id);
      if (taker) { await login('ump3', taker.email); await call('ump3', 'POST', `/api/umps/swaps/${offer.id}/accept`); assert.equal(get('SELECT person_id FROM ump_assignments WHERE id=?', sick.openId).person_id, taker.id); ok('umpire shift swap: offer + accept'); }
    }
    {
      const UM = require('./engine-umpires');
      const cands = all(`SELECT a.id, a.person_id FROM ump_assignments a JOIN events e ON e.id=a.event_id WHERE a.person_id IS NOT NULL AND a.status='assigned' ORDER BY e.date LIMIT 40`);
      const pick = cands.map(c => ({ c, t: UM.availableFor(c.id)[0] })).find(x => x.t);
      const owner = get('SELECT * FROM people WHERE id=?', pick.c.person_id);
      await login('owner', owner.email);
      const offer = await call('owner', 'POST', `/api/umps/assignments/${pick.c.id}/offer`, {});
      await login('taker', pick.t.email);
      await call('taker', 'POST', `/api/umps/swaps/${offer.id}/accept`);
      assert.equal(get('SELECT person_id FROM ump_assignments WHERE id=?', pick.c.id).person_id, pick.t.id); ok('umpire shift swap: one offers, another accepts, switch made');
    }
    const b = get(`SELECT a.*, e.date FROM ump_assignments a JOIN events e ON e.id=a.event_id WHERE a.person_id IS NOT NULL AND a.status='assigned' ORDER BY e.date LIMIT 2`);
    await call('admin', 'POST', `/api/umps/assignments/${b.id}/attendance`, { status: 'present', position: 'plate' });
    const pay = await call('admin', 'GET', `/api/payroll?start=${b.date}&end=${b.date}`);
    const row = pay.find(p => p.id === b.id); assert(row.cents > 0); ok(`attendance + payroll ($${(row.cents / 100).toFixed(2)} plate)`);
    const ns = get(`SELECT a.*, e.date FROM ump_assignments a JOIN events e ON e.id=a.event_id WHERE a.person_id IS NOT NULL AND a.status='assigned' AND a.id<>? ORDER BY e.date LIMIT 1`, b.id);
    await call('admin', 'POST', `/api/umps/assignments/${ns.id}/attendance`, { status: 'no_show' });
    assert.equal((await call('admin', 'GET', `/api/payroll?start=${ns.date}&end=${ns.date}`)).find(p => p.id === ns.id).cents, 0); ok('no-show is not paid');
    const cand = await call('admin', 'GET', `/api/umps/assignments/${ns.id}/candidates`); ok(`candidates: ${cand.available.length} free, ${cand.pull.length} JM backups to pull`);

    // ----- field duty -----
    const D = require('./engine-duty');
    const shift = get(`SELECT * FROM duty_shifts WHERE night_type='game' ORDER BY date LIMIT 1`);
    assert.equal(shift.shift === 'early' ? shift.start : shift.end, shift.shift === 'early' ? '17:30' : '21:15'); ok(`shift times: ${shift.shift} ${shift.start}-${shift.end}`);
    const avail = D.shiftAvailability(shift.id);
    ok(`duty availability: ${avail.filter(x => x.status === 'coaching_game').length} coaching, ${avail.filter(x => x.canWork).length} can work`);
    const coachingBoard = avail.find(x => x.status === 'coaching_game');
    if (coachingBoard) { let threw = false; try { D.signUp({ id: coachingBoard.id, is_admin: 0 }, shift.id); } catch { threw = true; } assert(threw); ok('board member coaching that slot cannot sign up'); }
    // reminders: pretend it's 70 hours before an open shift at 7 AM vs 9 AM for the 36h point
    const open = get(`SELECT * FROM duty_shifts s WHERE (SELECT COUNT(*) FROM duty_signups d WHERE d.shift_id=s.id)=0 ORDER BY date LIMIT 1`);
    const startAt = T.at(open.date, open.start);
    const pts = () => all('SELECT hours FROM duty_reminders WHERE shift_id=? ORDER BY hours', open.id).map(r => r.hours);
    let sent = await D.sendReminders(new Date(startAt - 70 * 3600000)); assert(pts().includes(72)); ok(`72h reminder sent (${sent} messages across open shifts)`);
    await D.sendReminders(new Date(startAt - 69 * 3600000)); assert.equal(pts().length, 1); ok('no repeat before the next point');
    const at36 = new Date(startAt - 35.5 * 3600000);
    await D.sendReminders(at36);
    if (at36.getHours() < 8) { assert(!pts().includes(36)); ok('36h reminder waits until 8 AM'); } else { assert(pts().includes(36)); ok('36h reminder sent'); }
    await call('admin', 'POST', `/api/duty/${open.id}/signup`);
    const before = pts().length; await D.sendReminders(new Date(startAt - 23 * 3600000)); assert.equal(pts().length, before); ok('filled shift: no more reminders');
    // recipients exclude people already on a shift that week
    const wk = T.mondayOf(open.date);
    const onShift = get(`SELECT d.person_id FROM duty_signups d JOIN duty_shifts s ON s.id=d.shift_id WHERE s.date BETWEEN ? AND ? LIMIT 1`, wk, T.addDays(wk, 6));
    ok(`week-of-shift rule checked (admin ${onShift ? 'is' : 'is not'} on a shift that week)`);

    // ----- exports -----
    for (const u of ['/export/schedule.csv', '/export/umpires.csv?start=2027-03-22&end=2027-03-28', '/export/duty.csv', `/export/payroll.csv?start=2027-03-22&end=2027-05-30`]) { const t = await call('admin', 'GET', u); assert(String(t).length > 50); }
    ok('CSV exports');
    const xl = await fetch(base + '/export/city.xlsx?start=2027-02-15&end=2027-03-28', { headers: { cookie: jars.admin } }); assert(xl.ok); const buf = Buffer.from(await xl.arrayBuffer());
    fs.writeFileSync(path.join(os.tmpdir(), 'city-test.xlsx'), buf); ok(`city schedule xlsx (${buf.length} bytes)`);
    const ics = await (await fetch(base + `/cal/team/${team1.id}.ics`)).text(); assert(ics.includes('BEGIN:VEVENT')); ok('team calendar feed');

    // ----- imports -----
    const csv = 'First,Last,Phone,Email,Roles,Umpire Divisions\nTest,Umpire,979-555-8888,test.ump@example.com,umpire,JMAA; SMAA\n';
    const pv = await call('admin', 'POST', '/api/import/people/preview', { csv }); assert.equal(pv[0].action, 'add');
    await call('admin', 'POST', '/api/import/people/apply', { csv }); assert(get(`SELECT * FROM people WHERE email='test.ump@example.com' AND is_umpire=1`)); ok('people CSV import');
    const sc = 'Division Name,Team Name,Volunteer Role,Volunteer First Name,Volunteer Last Name,Volunteer Email Address,Volunteer Cellphone\nJunior Minor AA,JMAA Rockets,Head Coach,New,Coach,new.coach@example.com,9795557777\n';
    const sp = await call('admin', 'POST', '/api/import/sportsconnect/preview', { csv: sc }); assert.equal(sp[0].teamAction, 'add');
    await call('admin', 'POST', '/api/import/sportsconnect/apply', { csv: sc }); assert(get(`SELECT * FROM teams WHERE name='JMAA Rockets'`)); ok('Sports Connect import');

    // ----- coaches on more than one team -----
    {
      const conf = await call('admin', 'GET', '/api/conflicts');
      assert(conf.coaches.length >= 1); ok(`${conf.coaches.length} coaches on 2+ teams listed; ${conf.conflicts.length} conflicts after building`);
      const co = conf.coaches[0];
      const [tA, tB] = co.teams.map(t => t.id);
      const evA = get(`SELECT * FROM events WHERE (team_id=? OR home_team_id=? OR away_team_id=?) AND status='scheduled' ORDER BY date LIMIT 1`, tA, tA, tA);
      const evB = get(`SELECT * FROM events WHERE (team_id=? OR home_team_id=? OR away_team_id=?) AND status='scheduled' AND date<>? ORDER BY date LIMIT 1`, tB, tB, tB, evA.date);
      // move B onto A's night at the other park, same time -> warning but not blocked
      const otherField = get(`SELECT f.id FROM fields f WHERE f.park_id<>(SELECT park_id FROM fields WHERE id=?) AND f.kind=(SELECT kind FROM fields WHERE id=?) LIMIT 1`, evA.field_id, evB.field_id)
        || get(`SELECT id FROM fields WHERE park_id<>(SELECT park_id FROM fields WHERE id=?) LIMIT 1`, evA.field_id);
      run('DELETE FROM events WHERE date=? AND field_id=? AND id<>?', evA.date, otherField.id, evB.id);
      const mv = await call('admin', 'PATCH', `/api/events/${evB.id}`, { date: evA.date, fieldId: otherField.id, start: evA.start, end: evA.end, notify: false });
      assert(mv.ok && mv.warnings.length && mv.warnings[0].kind === 'overlap'); ok('moving a team on top of the coach\'s other team warns, but is allowed');
      const wk = await call('admin', 'GET', `/api/events?start=${evA.date}&end=${evA.date}`);
      const badge = wk.find(e => e.id === evB.id).conflicts;
      assert(badge.length && badge[0].kind === 'overlap'); ok('conflict badge appears on both events');
      await call('admin', 'POST', '/api/conflicts/ack', { key: badge[0].key });
      const wk2 = await call('admin', 'GET', `/api/events?start=${evA.date}&end=${evA.date}`);
      assert.equal(wk2.find(e => e.id === evB.id).conflicts.length, 0); ok('"Mark as OK" clears the badge');
    }
    // ----- practice coaches can't schedule -----
    {
      const pc = get(`SELECT p.*, tc.team_id FROM team_coaches tc JOIN people p ON p.id=tc.person_id WHERE tc.role='practice' LIMIT 1`);
      await login('pcoach', pc.email);
      const me2 = await call('pcoach', 'GET', '/api/me');
      assert(me2.roles.coach && !me2.roles.teamScheduler); ok('practice coach sees their team but has no scheduling role');
      let refused = false;
      try { await call('pcoach', 'POST', '/api/practice/requests', { teamId: pc.team_id, date: '2030-01-07', fieldId: 1, slotCode: 'early' }); } catch (e) { refused = /head coach or an assistant/.test(e.message); }
      assert(refused); ok('practice coach cannot request practices');
    }
    // ----- seasons -----
    {
      const before = (await call('admin', 'GET', '/api/meta')).teams.length;
      const ns = await call('admin', 'POST', '/api/seasons', { kind: 'All-Stars', year: 2031, practice_start: '2031-06-02', game_start: '2031-06-16', game_weeks: 3, activate: true });
      const meta2 = await call('admin', 'GET', '/api/meta');
      assert.equal(meta2.settings.season_name, 'All-Stars 2031'); assert.equal(meta2.teams.length, 0); assert.equal(meta2.settings.game_start, '2031-06-16');
      ok('new season (All-Stars 2031) starts with no teams and its own dates');
      await call('admin', 'POST', '/api/teams', { divisionId: 2, name: 'All-Stars 10U' });
      assert.equal((await call('admin', 'GET', '/api/meta')).teams.length, 1); ok('teams added go into the current season');
      const list = await call('admin', 'GET', '/api/seasons');
      const old = list.find(x => !x.current && x.teams > 1);
      await call('admin', 'POST', `/api/seasons/${old.id}/activate`);
      assert.equal((await call('admin', 'GET', '/api/meta')).teams.length, before); ok('switching back brings the old season\'s teams back');
    }

    // permissions
    let denied = false; try { await call('coach', 'POST', '/api/build/games', {}); } catch (e) { denied = /403/.test(e.message); } assert(denied); ok('coach cannot rebuild schedules');
    console.log('\nAll checks passed.');
  } catch (e) { console.error('\nFAILED:', e); process.exitCode = 1; }
  finally { server.close(); try { fs.unlinkSync(tmp); } catch { } }
})();
