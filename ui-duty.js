// Field duty: board members sign up; everyone can see who's on duty and how to reach them.
(function () {
  const C = CS, { S, esc } = C;
  let week = null;

  CS.S.pages.duty = async el => {
    const r = S.me.roles;
    if (!week) week = C.mondayOf(C.today() < S.meta.settings.practice_start ? S.meta.settings.practice_start : C.today());
    const shifts = await C.get(`/api/duty?start=${week}&end=${C.addDays(week, 6)}`);
    const open = shifts.filter(s => s.people.length < s.needed).length;
    el.innerHTML = `<div class="pagehead"><div><h1>Field Duty</h1><div class="sub">${r.board ? 'Board members open and lock the fields, handle equipment, and help with umpires and disputes on game nights.' : 'Who is on duty each night. Call them for field, equipment or umpire problems.'}</div></div>
        <div class="btnrow"><a class="btn ghost" href="/export/duty.csv?start=${week}&end=${C.addDays(week, 27)}">${C.icon('down')} Roster CSV</a></div></div>
      ${C.weekNav('wk', week)}
      ${r.board && open ? `<p style="margin:10px 0 0"><span class="badge bad">${open} open shift${open > 1 ? 's' : ''}</span> <span class="small muted">Reminders go out 72, 48, 36, 24, 12 and 6 hours before to board members without a shift that week.</span></p>` : ''}
      <div id="out">${shifts.length ? C.groupByDate(shifts, s => shiftItem(s, r)) : '<div class="empty" style="margin-top:12px">No fields in use this week.</div>'}</div>`;
    el.querySelector('#wk').onclick = e => { const b = e.target.closest('[data-wk]'); if (!b) return; const n = +b.dataset.wk; week = n ? C.addDays(week, n) : C.mondayOf(C.today()); CS.route(); };
    el.querySelector('#out').onclick = async e => {
      const su = e.target.closest('[data-signup]'), wd = e.target.closest('[data-withdraw]'), who = e.target.closest('[data-who]');
      if (su) { await C.act(su, () => C.post(`/api/duty/${su.dataset.signup}/signup`), 'You\'re signed up. Thank you!'); CS.route(); }
      if (wd) { await C.act(wd, () => C.del(`/api/duty/${wd.dataset.withdraw}/signup`), 'Removed'); CS.route(); }
      if (who) whoModal(shifts.find(s => s.id === +who.dataset.who));
    };
  };

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
    const isAdmin = S.me.roles.admin;
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
