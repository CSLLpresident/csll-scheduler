// Schedule page (practices + games) with the coach tabs: open slots, extra practice requests (priority list), swaps and scrimmage invites.
(function () {
  const C = CS, { S, esc } = C;
  const st = { team: null, tab: 'schedule', week: null };
  // old links (#/practices/...) land on the same page
  CS.S.pages.practices = (el, rest) => CS.S.pages.schedule(el, rest);

  CS.S.pages.schedule = async (el, rest) => {
    const r = S.me.roles;
    st.tab = (rest && rest[0]) || 'schedule';
    const myTeams = r.admin ? S.meta.teams.map(t => ({ id: t.id, name: t.name, division_name: t.division_name })) : r.manageTeams;
    const coachTabs = myTeams.length ? [['open', 'Open fields'], ['requests', 'My requests'], ['swaps', 'Swaps & scrimmages'], ['list', 'Priority list']] : [];
    const tabs = [['schedule', 'Schedule'], ...coachTabs];
    if (!tabs.some(t => t[0] === st.tab)) st.tab = 'schedule';

    el.innerHTML = `
      <div class="pagehead"><div><h1>Schedule</h1><div class="sub">Practices start ${C.dShort(S.meta.settings.practice_start)}, games ${C.dShort(S.meta.settings.game_start)}.${myTeams.length ? ' Coaches: ask for extra field time, trade practices or set up a scrimmage in the other tabs.' : ''}</div></div>
        ${myTeams.length > 1 && st.tab !== 'schedule' ? `<select id="team" style="max-width:260px" aria-label="Team">${myTeams.map(t => `<option value="${t.id}" ${t.id === st.team ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}</div>
      ${tabs.length > 1 ? `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div id="out"><div class="spinner"></div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { location.hash = '#/schedule/' + b.dataset.tab; });
    const out = el.querySelector('#out');
    if (st.tab === 'schedule') return CS.renderSchedule(out, null, { embedded: true });

    if (!st.team || !myTeams.some(t => t.id === st.team)) st.team = myTeams[0].id;
    if (!st.week) st.week = C.mondayOf(C.today() < S.meta.settings.practice_start ? S.meta.settings.practice_start : C.today());
    const team = S.meta.teams.find(t => t.id === st.team);
    const priority = await C.get('/api/priority');
    const me = priority.find(p => p.id === st.team);
    const days = S.meta.settings.request_deadline_days;
    const t = el.querySelector('#team'); if (t) { t.value = st.team; t.onchange = () => { st.team = +t.value; CS.route(); }; }
    out.innerHTML = `<div class="card" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <div style="text-align:center;min-width:80px"><div class="label">Your spot</div><div style="font-family:var(--head);font-size:44px;line-height:1;color:var(--maroon)">#${me ? me.priority_rank : '-'}</div><div class="small muted">of ${priority.length}</div></div>
        <div style="flex:1;min-width:220px" class="small">Extra practice requests are decided <b>${days} days before</b> each practice. If more than one team asks for the same time, the team highest on the list gets it and moves to the bottom. Inside ${days} days, open times are first come, first served. Ask for as many times as you like; rank them and you'll get your first choice when it's your turn.</div>
      </div><div id="tabout"><div class="spinner"></div></div>`;
    const inner = out.querySelector('#tabout');
    if (st.tab === 'open') return openTab(inner, team);
    if (st.tab === 'requests') return requestsTab(inner, team);
    if (st.tab === 'swaps') return swapsTab(inner, team);
    return listTab(inner, priority);
  };

  async function openTab(out, team) {
    const slots = await C.get(`/api/practice/open?team=${team.id}&start=${st.week < C.today() ? C.today() : st.week}&end=${C.addDays(st.week, 6)}`);
    const mine = await C.get(`/api/events?start=${st.week}&end=${C.addDays(st.week, 6)}&team=${team.id}`);
    const myDates = new Set(mine.map(e => e.date));
    out.innerHTML = `${C.weekNav('wk', st.week)}
      <p class="small muted" style="margin:8px 0 0">Open ${esc(team.division_name)} fields. Days your team already has something are marked.</p>
      ${slots.length ? C.groupByDate(slots, s => `<div class="item"><div class="time">${C.t12s(s.start)}<small>to ${C.t12s(s.end)}</small></div>
        <div class="main"><div class="title">${esc(s.park_short)} ${esc(s.field_name)}</div>
          <div class="meta">${s.fcfs ? '<span class="badge ok">First come, first served</span>' : `Decided ${C.dtShort(s.decidesAt)}`}
          ${s.requests ? ` · ${s.requests} request${s.requests > 1 ? 's' : ''}, best spot #${s.bestRank}` : ''}${myDates.has(s.date) ? ' · <span class="badge warn">You have something this day</span>' : ''}</div></div>
        <button class="btn small" data-req='${JSON.stringify({ date: s.date, fieldId: s.field_id, slotCode: s.slot_code })}'>${s.fcfs ? 'Book' : 'Request'}</button></div>`) : '<div class="empty" style="margin-top:12px">No open fields this week.</div>'}`;
    out.querySelector('#wk').onclick = e => { const b = e.target.closest('[data-wk]'); if (!b) return; const n = +b.dataset.wk; st.week = n ? C.addDays(st.week, n) : C.mondayOf(C.today()); CS.route(); };
    out.onclick = async e => {
      const b = e.target.closest('[data-req]'); if (!b) return;
      const body = { ...JSON.parse(b.dataset.req), teamId: team.id };
      const r = await C.act(b, () => C.post('/api/practice/requests', body));
      if (r) { C.toast(r.status === 'awarded' ? 'Booked! It\'s on your schedule.' : `Requested. Decided ${C.dtShort(r.decidesAt)}.`); CS.route(); C.showWarnings(r); }
    };
  }

  async function requestsTab(out, team) {
    const data = await C.get(`/api/practice/requests?team=${team.id}`);
    const pending = data.pending.sort((a, b) => a.preference - b.preference);
    out.innerHTML = `<h2 style="margin-top:0">Waiting (${pending.length})</h2>
      <p class="small muted">Ranked by your preference. Use the arrows to reorder. "At risk" means a team ahead of you on the list asked for the same time.</p>
      ${pending.length ? pending.map((q, i) => `<div class="item"><div class="time" style="min-width:28px;color:var(--maroon)">${i + 1}</div>
        <div class="main"><div class="title">${C.dShort(q.date)} ${C.t12(q.start)} · ${esc(q.park_short)} ${esc(q.field_name)}</div>
        <div class="meta">Decided ${C.dtShort(q.decidesAt)} · ${q.competitors ? `${q.competitors} other request${q.competitors > 1 ? 's' : ''}` : 'No one else has asked'}</div></div>
        <div class="side">${q.atRisk ? '<span class="badge bad">At risk</span>' : '<span class="badge ok">Leading</span>'}
          <div class="btnrow"><button class="btn ghost small" data-up="${i}" aria-label="Move up">${C.icon('up')}</button><button class="btn ghost small" data-dn="${i}" aria-label="Move down">${C.icon('dn')}</button><button class="btn bad small" data-cancel="${q.id}">Cancel</button></div></div></div>`).join('')
        : '<div class="empty">No requests waiting. <a href="#/schedule/open">Find an open field</a>.</div>'}
      <h2>Recent results</h2>
      ${data.history.length ? data.history.map(h => `<div class="item"><div class="main"><div class="title">${C.dShort(h.date)} ${C.t12(h.start)} · ${esc(h.park_short)} ${esc(h.field_name)}</div></div>
        <span class="badge ${h.status === 'awarded' ? 'ok' : h.status === 'lost' ? 'bad' : ''}">${h.status}</span></div>`).join('') : '<div class="empty">None yet.</div>'}`;
    const reorder = async (i, d) => {
      const ids = pending.map(p => p.id); const j = i + d; if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await C.act(null, () => C.post('/api/practice/requests/reorder', { teamId: team.id, ids })); CS.route();
    };
    out.onclick = async e => {
      const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-dn]'), cx = e.target.closest('[data-cancel]');
      if (up) reorder(+up.dataset.up, -1);
      if (dn) reorder(+dn.dataset.dn, 1);
      if (cx) { await C.act(cx, () => C.del(`/api/practice/requests/${cx.dataset.cancel}`), 'Request cancelled'); CS.route(); }
    };
  }

  async function swapsTab(out, team) {
    const [swaps, mine] = await Promise.all([C.get('/api/swaps'), C.get(`/api/events?start=${C.today()}&end=${C.addDays(C.today(), 41)}&team=${team.id}&type=practice`)]);
    const open = swaps.filter(s => s.status === 'open');
    out.innerHTML = `
      ${open.length ? `<h2 style="margin-top:0">Offers</h2>${open.map(s => `<div class="item"><div class="main">
        <div class="title">${s.kind === 'scrimmage' ? 'Scrimmage' : 'Swap'}: ${esc(s.from_team_name)} ${s.incoming ? '→ you' : '→ ' + esc(s.to_team_name)}</div>
        <div class="meta">${s.kind === 'scrimmage' ? `Join their practice ${C.dShort(s.a_date)} ${C.t12(s.a_start)} at ${esc(s.a_park)} ${esc(s.a_field)}` :
          `Their ${C.dShort(s.a_date)} ${C.t12(s.a_start)} (${esc(s.a_park)} ${esc(s.a_field)}) for ${s.incoming ? 'your' : 'their'} ${C.dShort(s.b_date)} ${C.t12(s.b_start)} (${esc(s.b_park)} ${esc(s.b_field)})`}
          ${s.message ? `<br>"${esc(s.message)}"` : ''}</div></div>
        <div class="btnrow">${s.incoming ? `<button class="btn ok small" data-acc="${s.id}">Accept</button><button class="btn ghost small" data-dec="${s.id}">Decline</button>` : `<span class="badge">Waiting</span><button class="btn ghost small" data-dec="${s.id}">Withdraw</button>`}</div></div>`).join('')}` : ''}
      <h2 ${open.length ? '' : 'style="margin-top:0"'}>Your upcoming practices</h2>
      <p class="small muted">Trade a practice 1-for-1 with another team, or invite a team from your division to scrimmage during your practice (no umpires).</p>
      ${mine.length ? mine.map(e => `<div class="item"><div class="time">${C.t12s(e.start)}<small>${C.relDay(e.date)}</small></div>
        <div class="main"><div class="title">${C.dShort(e.date)} · ${esc(e.park_short)} ${esc(e.field_name)}</div><div class="meta">${e.type === 'scrimmage' ? 'Scrimmage set' : 'Practice'}</div></div>
        ${e.type === 'practice' ? `<div class="btnrow"><button class="btn ghost small" data-swap="${e.id}">Swap</button><button class="btn ghost small" data-scrim="${e.id}">Scrimmage</button></div>` : ''}</div>`).join('') : '<div class="empty">No practices in the next 6 weeks.</div>'}
      ${swaps.filter(s => s.status !== 'open').length ? `<h2>History</h2>${swaps.filter(s => s.status !== 'open').slice(0, 10).map(s => `<div class="item"><div class="main"><div class="title">${s.kind}: ${esc(s.from_team_name)} → ${esc(s.to_team_name)}</div><div class="meta">${C.dShort(s.a_date)}</div></div><span class="badge">${s.status}</span></div>`).join('')}` : ''}`;
    out.onclick = async e => {
      const acc = e.target.closest('[data-acc]'), dec = e.target.closest('[data-dec]'), sw = e.target.closest('[data-swap]'), sc = e.target.closest('[data-scrim]');
      if (acc) { const r = await C.act(acc, () => C.post(`/api/swaps/${acc.dataset.acc}/respond`, { accept: true }), 'Done. Both schedules are updated.'); CS.route(); C.showWarnings(r); }
      if (dec) { await C.act(dec, () => C.post(`/api/swaps/${dec.dataset.dec}/respond`, { accept: false }), 'Declined'); CS.route(); }
      if (sw) swapPicker(mine.find(x => x.id === +sw.dataset.swap), team);
      if (sc) scrimPicker(mine.find(x => x.id === +sc.dataset.scrim), team);
    };
  }

  async function swapPicker(myEvent, team) {
    const start = C.mondayOf(myEvent.date);
    const others = (await C.get(`/api/events?start=${C.today() > start ? C.today() : start}&end=${C.addDays(start, 13)}&type=practice`)).filter(e => e.team_id !== team.id);
    C.modal('Swap practice', `<p class="small">Your practice: <b>${C.dShort(myEvent.date)} ${C.t12(myEvent.start)}</b>, ${esc(myEvent.park_short)} ${esc(myEvent.field_name)}. Pick the practice you want instead. The other coach has to accept.</p>
      <div class="field"><label>Message (optional)</label><input type="text" id="msg" placeholder="Thanks, coach!"></div>
      ${others.length ? C.groupByDate(others, e => `<div class="item"><div class="time">${C.t12s(e.start)}</div><div class="main"><div class="title">${esc(e.team_name)}</div><div class="meta">${esc(e.park_short)} ${esc(e.field_name)} · ${esc(e.division_name)}</div></div><button class="btn small" data-pick="${e.id}">Offer</button></div>`) : '<div class="empty">No other practices in these two weeks.</div>'}`, (m, close) => {
      m.onclick = async ev => {
        const b = ev.target.closest('[data-pick]'); if (!b) return;
        const ok = await C.act(b, () => C.post('/api/swaps/practice', { eventA: myEvent.id, eventB: +b.dataset.pick, message: m.querySelector('#msg').value }), 'Offer sent');
        if (ok) { close(); CS.route(); C.showWarnings(ok); }
      };
    });
  }
  // from the Schedule page: "ask to swap for this time"
  CS.practiceSwapFrom = async other => {
    const r = S.me.roles;
    const myTeam = r.manageTeams.find(t => t.division_id === other.division_id) || r.manageTeams[0];
    const start = C.mondayOf(other.date);
    const mine = await C.get(`/api/events?start=${C.today() > start ? C.today() : start}&end=${C.addDays(start, 13)}&team=${myTeam.id}&type=practice`);
    C.modal('Offer one of your practices', `<p class="small">You want <b>${C.dShort(other.date)} ${C.t12(other.start)}</b> (${esc(other.team_name)}). Which of your practices will you give them?</p>
      ${mine.length ? mine.map(e => `<div class="item"><div class="main"><div class="title">${C.dShort(e.date)} ${C.t12(e.start)}</div><div class="meta">${esc(e.park_short)} ${esc(e.field_name)}</div></div><button class="btn small" data-pick="${e.id}">Offer this</button></div>`).join('') : '<div class="empty">You have no practices near that date to trade.</div>'}`, (m, close) => {
      m.onclick = async ev => { const b = ev.target.closest('[data-pick]'); if (!b) return; const ok = await C.act(b, () => C.post('/api/swaps/practice', { eventA: +b.dataset.pick, eventB: other.id }), 'Offer sent'); if (ok) { close(); C.showWarnings(ok); } };
    });
  };

  function scrimPicker(myEvent, team) {
    const teams = S.meta.teams.filter(t => t.division_id === team.division_id && t.id !== team.id);
    C.modal('Invite to scrimmage', `<p class="small">During your practice <b>${C.dShort(myEvent.date)} ${C.t12(myEvent.start)}</b>, ${esc(myEvent.park_short)} ${esc(myEvent.field_name)}. No umpires.</p>
      <div class="field"><label>Team</label><select id="tm">${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Message (optional)</label><input type="text" id="msg"></div><button class="btn" id="send">Send invite</button>`, (m, close) => {
      m.querySelector('#send').onclick = async () => {
        const ok = await C.act(m.querySelector('#send'), () => C.post('/api/swaps/scrimmage', { eventA: myEvent.id, toTeam: +m.querySelector('#tm').value, message: m.querySelector('#msg').value }), 'Invite sent');
        if (ok) { close(); CS.route(); C.showWarnings(ok); }
      };
    });
  }

  function listTab(out, priority) {
    const r = S.me.roles;
    out.innerHTML = `<p class="small muted" style="margin-top:0">Everyone starts equal when the schedule is released. When a team gets an extra practice it moves to the bottom.</p>
      <div class="tablewrap"><table><thead><tr><th class="num">#</th><th>Team</th><th>Head coach</th><th>Division</th></tr></thead><tbody>
      ${priority.map(p => `<tr ${r.coachTeams.some(t => t.id === p.id) ? 'style="background:var(--maroon-soft);font-weight:600"' : ''}><td class="num">${p.priority_rank}</td><td>${esc(p.name)}</td><td>${esc(p.head_coach || '')}</td><td>${esc(p.division_code)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
})();
