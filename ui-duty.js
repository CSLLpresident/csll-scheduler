// Field duty: board members sign up; everyone can see who's on duty and how to reach them.
(function () {
  const C = CS, { S, esc } = C;
  let week = null;

  let tab = null;
  CS.S.pages.duty = async (el, rest) => {
    const r = S.me.roles;
    if (!r.board) { location.hash = '#/schedule'; return; }
    if (rest && rest[0]) tab = rest[0];
    if (!tab) tab = r.dutyCoord ? 'overview' : 'shifts';
    if (!r.dutyCoord) tab = 'shifts';
    el.innerHTML = `<div class="pagehead"><div><h1>Field Duty</h1><div class="sub">Board members open and lock the fields, handle equipment, and help with umpires and disputes on game nights.</div></div></div>
      ${r.dutyCoord ? `<div class="tabs"><button data-tab="overview" class="${tab === 'overview' ? 'on' : ''}">Where we stand</button><button data-tab="shifts" class="${tab === 'shifts' ? 'on' : ''}">Shifts</button></div>` : ''}
      <div id="dout"><div class="spinner"></div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { location.hash = '#/duty/' + b.dataset.tab; });
    const out = el.querySelector('#dout');
    return tab === 'overview' ? overview(out) : shiftsTab(out, r);
  };

  async function shiftsTab(el, r) {
    if (!week) week = C.mondayOf(C.today() < S.meta.settings.practice_start ? S.meta.settings.practice_start : C.today());
    const shifts = await C.get(`/api/duty?start=${week}&end=${C.addDays(week, 6)}`);
    const open = shifts.filter(s => s.people.length < s.needed).length;
    el.innerHTML = `<div class="toolbar">${C.weekNav('wk', week)}
        <a class="btn ghost small" style="margin-left:auto" href="/export/duty.csv?start=${week}&end=${C.addDays(week, 27)}">${C.icon('down')} Roster CSV</a></div>
      ${open ? `<p style="margin:4px 0 0"><span class="badge bad">${open} open shift${open > 1 ? 's' : ''}</span> <span class="small muted">Reminders go out 72, 48, 36, 24, 12 and 6 hours before to board members without a shift that week.</span></p>` : ''}
      <div id="out">${shifts.length ? C.groupByDate(shifts, s => shiftItem(s, r)) : '<div class="empty" style="margin-top:12px">No fields in use this week.</div>'}</div>`;
    el.querySelector('#wk').onclick = e => { const b = e.target.closest('[data-wk]'); if (!b) return; const n = +b.dataset.wk; week = n ? C.addDays(week, n) : C.mondayOf(C.today()); CS.route(); };
    el.querySelector('#out').onclick = async e => {
      const su = e.target.closest('[data-signup]'), wd = e.target.closest('[data-withdraw]'), who = e.target.closest('[data-who]');
      if (su) { await C.act(su, () => C.post(`/api/duty/${su.dataset.signup}/signup`), 'You\'re signed up. Thank you!'); CS.route(); }
      if (wd) { await C.act(wd, () => C.del(`/api/duty/${wd.dataset.withdraw}/signup`), 'Removed'); CS.route(); }
      if (who) whoModal(shifts.find(s => s.id === +who.dataset.who));
    };
  }

  // Field duty coordinator's quick view
  async function overview(el) {
    const d = await C.get('/api/duty-summary');
    const pct = x => x.total ? Math.round(100 * x.filled / x.total) : 100;
    const bar = (x) => `<div class="cov"><div class="covfill ${pct(x) < 60 ? 'low' : pct(x) < 90 ? 'mid' : ''}" style="width:${pct(x)}%"></div></div>`;
    const soon = d.open.filter(s => s.hoursLeft <= 168);
    el.innerHTML = `
      <div class="grid four">
        <div class="stat"><b>${d.next7.filled}/${d.next7.total}</b><span>Shifts filled, next 7 days</span>${bar(d.next7)}</div>
        <div class="stat"><b>${d.next14.filled}/${d.next14.total}</b><span>Filled, next 14 days</span>${bar(d.next14)}</div>
        <div class="stat"><b style="color:${soon.length ? 'var(--bad)' : 'var(--ok)'}">${soon.length}</b><span>Open shifts in the next 7 days</span></div>
        <div class="stat"><b>${d.noShiftThisWeek}</b><span>Board members with no shift this week</span></div>
      </div>
      <h2>Coverage by week</h2>
      <div class="card">${d.weeks.map(w => `<div class="covrow"><span class="small" style="min-width:110px">Week of ${C.dShort(w.start).slice(4)}</span>${bar(w)}<span class="small nowrap" style="min-width:70px;text-align:right">${w.filled}/${w.total} (${pct(w)}%)</span></div>`).join('')}</div>
      <h2>Open shifts (${d.open.length})</h2>
      ${d.open.length ? d.open.slice(0, 15).map(s => `<div class="item"><div class="bar" style="background:${s.hoursLeft <= 24 ? '#B42318' : s.hoursLeft <= 72 ? '#9A5B00' : '#D6CCC0'}"></div>
        <div class="time">${C.t12s(s.start)}<small>${C.relDay(s.date)}</small></div>
        <div class="main"><div class="title">${esc(s.park_short)} · ${s.shift} shift</div>
          <div class="meta">${s.night_type === 'game' ? 'Game night' : 'Practice night'} · ${s.hoursLeft > 0 ? `in ${s.hoursLeft < 48 ? s.hoursLeft + ' hours' : Math.round(s.hoursLeft / 24) + ' days'}` : 'now'}${s.last_reminder ? ` · reminders sent (latest at ${s.last_reminder}h)` : ' · no reminders yet'}</div></div>
        <button class="btn small" data-who="${s.id}">Assign</button></div>`).join('') + (d.open.length > 15 ? `<p class="small muted">and ${d.open.length - 15} more. See the Shifts tab.</p>` : '') : '<div class="empty">Every shift for the next four weeks is covered.</div>'}
      <h2>Who's carrying the load</h2>
      <p class="small muted" style="margin-top:0">Fewest upcoming shifts first, so you know who to ask.</p>
      <div class="tablewrap"><table><thead><tr><th>Board member</th><th class="num">This week</th><th class="num">Next 4 weeks</th><th class="num">Season</th><th>Phone</th></tr></thead><tbody>
        ${d.load.map(p => `<tr><td><b>${esc(p.first)} ${esc(p.last)}</b>${p.coaches ? ' <span class="badge">Coach</span>' : ''}</td><td class="num">${p.thisWeek}</td><td class="num">${p.upcoming}</td><td class="num">${p.season}</td><td>${C.telLink(p.phone)}</td></tr>`).join('')}
      </tbody></table></div>`;
    el.onclick = e => { const b = e.target.closest('[data-who]'); if (b) { const s = d.open.find(x => x.id === +b.dataset.who); whoModal({ ...s, people: [] }); } };
  }
  CS.dutySummary = () => C.get('/api/duty-summary');

  function shiftItem(s, r) {
    const mine = s.people.some(p => p.id === S.me.person.id);
    const full = s.people.length >= s.needed;
    return `<div class="item"><div class="bar" style="background:${full ? '#1E6B43' : '#B42318'}"></div>
      <div class="time">${C.t12s(s.start)}<small>to ${C.t12s(s.end)}</small></div>
      <div class="main"><div class="title">${esc(s.park_short)} · ${s.shift === 'early' ? 'Early' : 'Late'} shift</div>
        <div class="meta">${s.night_type === 'game' ? 'Game night' : 'Practice night'}</div>
        <div style="margin-top:4px">${s.people.length ? s.people.map(p => `<b>${esc(p.first)} ${esc(p.last)}</b> ${C.telLink(p.phone)}`).join('<br>') : '<span class="badge bad">Needs someone</span>'}</div></div>
      ${r.board ? `<div class="side">${mine ? `<button class="btn ghost small" data-withdraw="${s.id}">Withdraw</button>` : full ? '' : `<button class="btn small" data-signup="${s.id}">Sign up</button>`}
        <button class="btn ghost small" data-who="${s.id}">Who can work</button></div>` : ''}</div>`;
  }

  async function whoModal(s) {
    const list = await C.get(`/api/duty/${s.id}/availability`);
    const label = { signed_up: ['ok', 'Signed up'], practicing_here: ['ok', 'At this park'], free: ['', 'Free'], unavailable: ['warn', 'Unavailable'], elsewhere: ['warn', 'Other park'], coaching_game: ['bad', 'Coaching a game'] };
    const isAdmin = S.me.roles.admin || S.me.roles.dutyCoord;
    C.modal(`${s.park_short} ${s.shift} shift, ${C.dShort(s.date)}`, `<p class="small muted">${s.night_type === 'practice' ? 'Practice night: board members already at this park for practice are listed first.' : 'Game night: board members coaching a game in this slot can\'t work duty.'}</p>
      ${list.map(p => `<div class="item"><div class="main"><div class="title">${esc(p.first)} ${esc(p.last)}</div><div class="meta">${esc(p.note)} ${C.telLink(p.phone)}</div></div>
        <span class="badge ${label[p.status][0]}">${label[p.status][1]}</span>
        ${isAdmin && p.canWork && p.status !== 'signed_up' ? `<button class="btn small" data-assign="${p.id}">Assign</button>` : ''}
        ${isAdmin && p.status === 'signed_up' ? `<button class="btn ghost small" data-unassign="${p.id}">Remove</button>` : ''}</div>`).join('')}`, (m, close) => {
      m.onclick = async e => {
        const a = e.target.closest('[data-assign]'), u = e.target.closest('[data-unassign]');
        if (a && await C.act(a, () => C.post(`/api/duty/${s.id}/signup`, { personId: +a.dataset.assign }), 'Assigned')) { close(); CS.route(); }
        if (u && await C.act(u, () => C.del(`/api/duty/${s.id}/signup?person=${u.dataset.unassign}`), 'Removed')) { close(); CS.route(); }
      };
    });
  }
})();
