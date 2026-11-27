// Home: what's next for me, things that need my attention.
CS.S.pages.home = async el => {
  const C = CS, { S, esc } = C, r = S.me.roles;
  const start = C.today(), end = C.addDays(start, 13);
  const [events, umps, duty, swaps, reqs, umpOpen, umpSwaps, status] = await Promise.all([
    r.coachTeams.length ? C.get(`/api/events?start=${start}&end=${end}&mine=1`) : [],
    r.umpire ? C.get(`/api/umps/assignments?start=${start}&end=${end}&mine=1`) : [],
    C.get(`/api/duty?start=${start}&end=${C.addDays(start, 6)}`),
    r.coachTeams.length ? C.get('/api/swaps') : [],
    r.coachTeams.length ? C.get('/api/practice/requests') : { pending: [] },
    r.umpire ? C.get(`/api/umps/assignments?start=${start}&end=${end}&open=1`) : [],
    r.umpire ? C.get('/api/umps/swaps') : [],
    r.admin ? C.get('/api/admin/status') : null,
  ]);

  // merge everything that's "mine" into one timeline
  const mine = [];
  events.forEach(e => mine.push({ date: e.date, start: e.start, html: C.eventItem(e, { showDate: true }) }));
  umps.filter(a => a.status !== 'sick').forEach(a => mine.push({ date: a.date, start: a.start, html: `<div class="item"><div class="bar" style="background:#1F1D1B"></div>
    <div class="time">${C.t12s(a.start)}<small>${C.relDay(a.date)}</small></div><div class="main"><div class="title">Umpire: ${esc(a.division_name)} (${a.position})</div>
    <div class="meta">${esc(a.away_name || '')} at ${esc(a.home_name || '')} · ${esc(a.park_short)} ${esc(a.field_name)}</div></div><span class="badge">Umpire</span></div>` }));
  duty.filter(s => s.people.some(p => p.id === S.me.person.id)).forEach(s => mine.push({ date: s.date, start: s.start, html: `<div class="item"><div class="bar" style="background:#F2C230"></div>
    <div class="time">${C.t12s(s.start)}<small>${C.relDay(s.date)}</small></div><div class="main"><div class="title">Field duty: ${esc(s.park_short)} (${s.shift})</div>
    <div class="meta">${C.t12(s.start)} to ${C.t12(s.end)}</div></div><span class="badge warn">Duty</span></div>` }));
  mine.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const next = mine[0];

  const alerts = [];
  swaps.filter(s => s.incoming && s.status === 'open').forEach(s => alerts.push(`<a class="item click" href="#/practices/swaps" style="text-decoration:none;color:inherit"><div class="main"><div class="title">${s.kind === 'scrimmage' ? 'Scrimmage invite' : 'Practice swap offer'} from ${esc(s.from_team_name)}</div><div class="meta">${C.dShort(s.a_date)} ${C.t12(s.a_start)} · ${esc(s.a_park)} ${esc(s.a_field)}</div></div><span class="badge warn">Respond</span></a>`));
  (reqs.pending || []).filter(q => q.atRisk).forEach(q => alerts.push(`<a class="item click" href="#/practices/requests" style="text-decoration:none;color:inherit"><div class="main"><div class="title">${esc(q.team_name)} may miss a practice slot</div><div class="meta">${C.dShort(q.date)} ${C.t12(q.start)} · ${esc(q.park_short)} ${esc(q.field_name)}: a team ahead of you asked too.</div></div><span class="badge bad">At risk</span></a>`));
  if (umpOpen.length) alerts.push(`<a class="item click" href="#/umpires/open" style="text-decoration:none;color:inherit"><div class="main"><div class="title">${umpOpen.length} open umpire spot${umpOpen.length > 1 ? 's' : ''} you can take</div><div class="meta">Next: ${C.dShort(umpOpen[0].date)} ${C.t12(umpOpen[0].start)}, ${esc(umpOpen[0].division_name)}</div></div><span class="badge warn">Open</span></a>`);
  if (umpSwaps.filter(s => s.from_person !== S.me.person.id).length) alerts.push(`<a class="item click" href="#/umpires/open" style="text-decoration:none;color:inherit"><div class="main"><div class="title">Umpire shifts offered by other umpires</div></div><span class="badge warn">Swap</span></a>`);
  if (r.board) {
    const open = duty.filter(s => s.people.length < s.needed);
    if (open.length) alerts.push(`<a class="item click" href="#/duty" style="text-decoration:none;color:inherit"><div class="main"><div class="title">${open.length} field duty shift${open.length > 1 ? 's' : ''} still open this week</div><div class="meta">Next: ${C.dShort(open[0].date)}, ${esc(open[0].park_short)} ${open[0].shift}</div></div><span class="badge bad">Needs someone</span></a>`);
  }

  el.innerHTML = `
    <div class="hero"><img class="bg" src="/logo.png" alt=""><div class="label">Welcome back</div><h1>Hi, ${esc(S.me.person.first)}</h1>
      ${next ? `<p style="margin:8px 0 0">Next up: <b>${C.relDay(next.date)} at ${C.t12(next.start)}</b></p>` : '<p style="margin:8px 0 0">Nothing on your calendar in the next two weeks.</p>'}</div>
    ${status ? `<h2>League at a glance</h2><div class="grid four">
      <div class="stat"><b>${status.counts.teams}</b><span>Teams</span></div>
      <div class="stat"><b>${status.counts.games}</b><span>Games scheduled</span></div>
      <div class="stat"><b>${status.counts.openUmp}</b><span>Open umpire spots</span></div>
      <div class="stat"><b>${status.counts.openDuty}</b><span>Open field duty shifts</span></div></div>
      ${status.counts.unpublished ? `<p class="small" style="margin-top:8px"><span class="badge warn">${status.counts.unpublished} draft events</span> <a href="#/admin/build">Review and publish</a></p>` : ''}` : ''}
    ${alerts.length ? `<h2>Needs your attention</h2>${alerts.join('')}` : ''}
    <h2>My next two weeks</h2>
    ${mine.length ? C.groupByDate(mine, x => x.html) : `<div class="empty">Nothing scheduled for you yet. See the <a href="#/practices/schedule">Practice Schedule</a> or <a href="#/schedule">Game Schedule</a>.</div>`}`;
};
