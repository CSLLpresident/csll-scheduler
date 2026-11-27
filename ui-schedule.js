// Schedule: one page for practices, scrimmages and games, with a Practices / Games / Both toggle.
// Everyone sees every event. Schedulers can edit, move, rain out and add. Field duty shows under each day.
(function () {
  const C = CS, { S, esc } = C;
  const st = { week: null, division: '', team: '', park: '', mine: false, view: 'list', day: null, show: 'both' };
  let mode = 'both';

  const SHOW = {
    practices: { label: 'Practices', types: 'practice,scrimmage', empty: 'No practices this week with these filters.' },
    games: { label: 'Games', types: 'game', empty: 'No games this week with these filters.' },
    both: { label: 'Both', types: 'game,practice,scrimmage', empty: 'Nothing scheduled this week with these filters.' },
  };

  // One line per day: who's on field duty at each park (so coaches know who to call)
  function dutyLine(shifts, date) {
    const day = shifts.filter(s => s.date === date);
    if (!day.length) return '';
    const parks = [...new Set(day.map(s => s.park_short))];
    return `<div class="dutyline">${C.icon('key')}<span><b>Field duty</b> ${parks.map(p => {
      const list = day.filter(s => s.park_short === p).sort((a, b) => a.shift.localeCompare(b.shift));
      if (!list.some(s => s.people.length)) return `<span class="dpark">${esc(p)}: <span class="muted">not assigned yet</span></span>`;
      const parts = list.map(s => `${s.shift}: ${s.people.length ? s.people.map(x => `${esc(x.first)} ${esc(x.last)} ${C.telLink(x.phone)}`).join(', ') : '<span class="muted">open</span>'}`);
      return `<span class="dpark">${esc(p)}: ${parts.join(' · ')}</span>`;
    }).join('')}</span></div>`;
  }

  // Renders the schedule into el. opts.embedded = inside another page (no page title).
  async function renderSchedule(el, m, opts = {}) {
    if (m) st.show = m;
    mode = st.show;
    const cfg = SHOW[st.show];
    const r = S.me.roles;
    if (!st.week) {
      const t = C.today(), first = S.meta.settings.practice_start;
      st.week = C.mondayOf(t < first ? first : t);
      st.mine = r.coachTeams.length > 0 && !r.scheduler;
    }
    if (!st.day || st.day < st.week || st.day > C.addDays(st.week, 6)) st.day = st.week;
    const end = C.addDays(st.week, 6);
    const q = new URLSearchParams({ start: st.week, end, type: cfg.types });
    if (st.division) q.set('division', st.division);
    if (st.team) q.set('team', st.team);
    if (st.park) q.set('park', st.park);
    if (st.mine) q.set('mine', '1');
    if (r.scheduler) q.set('status', 'all');
    const [events, shifts] = await Promise.all([C.get('/api/events?' + q), C.get(`/api/duty?start=${st.week}&end=${end}`)]);

    const exportQ = new URLSearchParams({ type: cfg.types }); if (st.division) exportQ.set('division', st.division); if (st.team) exportQ.set('team', st.team);
    el.innerHTML = `
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Show">${Object.entries(SHOW).map(([k, v]) => `<button data-show="${k}" class="${st.show === k ? 'on' : ''}">${v.label}</button>`).join('')}</div>
        ${C.weekNav('wk', st.week)}
      </div>
      <div class="filters">
        <select id="fdiv" aria-label="Division">${C.divisionOptions(st.division)}</select>
        <select id="fteam" aria-label="Team">${C.teamOptions(st.team, st.division)}</select>
        <select id="fpark" aria-label="Park">${C.parkOptions(st.park)}</select>
        ${r.coachTeams.length ? `<label class="check"><input type="checkbox" id="fmine" ${st.mine ? 'checked' : ''}> My teams</label>` : ''}
        <div class="seg small" role="group" aria-label="View"><button data-view="list" class="${st.view === 'list' ? 'on' : ''}">List</button><button data-view="grid" class="${st.view === 'grid' ? 'on' : ''}">Fields by day</button></div>
        <div class="btnrow" style="margin-left:auto">${r.scheduler ? '<button class="btn small" id="add">Add event</button>' : ''}
          <a class="btn ghost small" href="/export/schedule.csv?${exportQ}" aria-label="Download CSV">${C.icon('down')} CSV</a></div>
      </div>
      <div id="out"></div>`;

    const out = el.querySelector('#out');
    if (st.view === 'list') {
      out.innerHTML = events.length ? C.groupByDate(events, e => C.eventItem(e, { click: true, showUmps: r.board || r.umpire }), d => dutyLine(shifts, d)) : `<div class="empty">${cfg.empty}</div>`;
    } else {
      out.innerHTML = dayGrid(events) + dutyLine(shifts, st.day);
    }

    // handlers
    const rerender = () => renderSchedule(el, null, opts).catch(C.fail);
    el.querySelectorAll('[data-show]').forEach(b => b.onclick = () => { st.show = b.dataset.show; rerender(); });
    el.querySelector('#wk').onclick = e => { const b = e.target.closest('[data-wk]'); if (!b) return; const n = +b.dataset.wk; st.week = n ? C.addDays(st.week, n) : C.mondayOf(C.today()); rerender(); };
    el.querySelector('#fdiv').onchange = e => { st.division = e.target.value; st.team = ''; rerender(); };
    el.querySelector('#fteam').onchange = e => { st.team = e.target.value; rerender(); };
    el.querySelector('#fpark').onchange = e => { st.park = e.target.value; rerender(); };
    const fm = el.querySelector('#fmine'); if (fm) fm.onchange = e => { st.mine = e.target.checked; rerender(); };
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { st.view = b.dataset.view; rerender(); });
    el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { st.day = b.dataset.day; rerender(); });
    out.onclick = e => {
      if (e.target.closest('a')) return;
      const it = e.target.closest('[data-event]'); if (!it) return;
      const ev = events.find(x => x.id === +it.dataset.event);
      if (ev) eventModal(ev);
    };
    const add = el.querySelector('#add'); if (add) add.onclick = () => editModal(null);
  }
  CS.renderSchedule = renderSchedule;
  CS.dutyLine = dutyLine;

  function dayGrid(events) {
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => C.addDays(st.week, i)).filter(d => ![0, 3].includes(C.toDate(d).getDay()));
    const dayEvents = events.filter(e => e.date === st.day);
    const wd = C.toDate(st.day).getDay();
    const fields = S.meta.fields.filter(f => f.active && (!st.park || f.park_id === +st.park));
    const codes = wd === 6 ? ['sat1', 'sat2', 'sat3', 'sat4', 'tsat'] : ['tball', 'early', 'seven', 'late'];
    const label = { tball: 'T-Ball', early: 'Early', seven: '7:00', late: 'Late', sat1: '8:00', sat2: '9:30', sat3: '11:00', sat4: '12:30', tsat: 'T-Ball' };
    const used = codes.filter(c => fields.some(f => f.slots.some(s => s.code === c && s.days.split(',').includes(String(wd)))));
    let html = `<div class="tabs">${days.map(d => `<button data-day="${d}" class="${d === st.day ? 'on' : ''}">${C.dShort(d)}</button>`).join('')}</div>`;
    html += `<div class="tablewrap" style="padding:8px"><div class="fgrid" style="grid-template-columns:120px repeat(${used.length},1fr)">
      <div class="cell hd"></div>${used.map(c => `<div class="cell hd">${label[c]}</div>`).join('')}`;
    for (const f of fields) {
      html += `<div class="cell fname">${esc(f.park_short)}<br>${esc(f.name)}</div>`;
      for (const c of used) {
        const slot = f.slots.find(s => s.code === c && s.days.split(',').includes(String(wd)));
        if (!slot) { html += '<div class="cell" style="background:transparent;border:0"></div>'; continue; }
        const evs = dayEvents.filter(e => e.field_id === f.id && (e.slot_code ? e.slot_code === c : e.start === slot.start));
        const overlapping = dayEvents.some(e => e.field_id === f.id && e.start < slot.end && e.end > slot.start);
        if (!evs.length) html += overlapping ? '<div class="cell blocked">In use</div>' : `<div class="cell free">${C.t12s(slot.start)} open</div>`;
        else html += `<div class="stack">${evs.map(e => `<div class="cell ev" style="--c:${esc(e.division_color || '#5C1118')}" data-event="${e.id}"><b>${esc(e.division_code)}</b> ${e.type === 'practice' ? esc(e.team_name) : esc(e.away_name) + ' @ ' + esc(e.home_name)}<br><span class="muted">${e.type}${e.status !== 'scheduled' ? ' · ' + e.status : ''}</span></div>`).join('')}</div>`;
      }
    }
    return html + '</div></div>';
  }

  function eventModal(e) {
    const r = S.me.roles;
    const teams = [e.team_id, e.home_team_id, e.away_team_id].filter(Boolean).map(id => S.meta.teams.find(t => t.id === id)).filter(Boolean);
    const coaches = teams.map(t => `<div style="margin-bottom:6px"><b>${esc(t.name)}</b><br>${t.coaches.map(c => `${esc(c.first)} ${esc(c.last)} (${c.role === 'head' ? 'head' : c.role === 'practice' ? 'practice' : 'asst'}) ${C.telLink(c.phone)}`).join('<br>') || '<span class="muted">No coaches listed</span>'}</div>`).join('');
    const myTeams = r.manageTeams.map(t => t.id);
    const isMinePractice = e.type === 'practice' && myTeams.includes(e.team_id);
    const otherPractice = e.type === 'practice' && myTeams.length && !myTeams.includes(e.team_id);
    C.modal(C.eventTitle(e), `
      <p>${C.typeBadge(e)} ${C.statusBadge(e)} <span class="badge outline">${esc(e.division_name || '')}</span></p>
      <p><b>${C.dLong(e.date)}</b>, ${C.t12(e.start)} to ${C.t12(e.end)}<br>${esc(e.park_short)} ${esc(e.field_name)}</p>
      ${e.umpires ? `<p class="small"><b>Umpires:</b> ${esc(e.umpires)}</p>` : ''}
      ${(e.conflicts || []).length ? `<div class="card" style="margin-bottom:10px;border-color:#EBC3BE"><div class="label" style="margin-bottom:4px">Coach on two teams</div>
        ${e.conflicts.map(c => `<div class="small" style="margin-bottom:6px"><span class="badge ${c.kind === 'overlap' ? 'bad' : 'warn'}">${c.kind === 'overlap' ? 'Same time' : 'Other park'}</span>
          <b>${esc(c.coach)}</b> also has ${esc(c.other.who)}, ${C.t12(c.other.start)} at ${esc(c.other.park)} ${esc(c.other.field)}.
          ${r.board || r.scheduler ? `<button class="btn ghost small" data-ack="${esc(c.key)}">Mark as OK</button>` : ''}</div>`).join('')}</div>` : ''}
      ${e.notes ? `<p class="small">${esc(e.notes)}</p>` : ''}
      <div class="card" style="margin-bottom:12px"><div class="label" style="margin-bottom:6px">Coaches</div>${coaches}</div>
      <div class="btnrow">
        ${isMinePractice ? '<a class="btn ghost" href="#/schedule/swaps">Swap or invite to scrimmage</a>' : ''}
        ${otherPractice ? `<button class="btn ghost" id="askswap">Ask to swap for this time</button>` : ''}
        ${r.scheduler ? '<button class="btn" id="edit">Edit / move</button>' : ''}
        ${r.scheduler && e.type === 'game' && e.status === 'scheduled' ? '<button class="btn bad" id="rain">Rain out</button>' : ''}
        ${r.scheduler && e.status !== 'scheduled' ? '<button class="btn ghost" id="restore">Restore</button>' : ''}
      </div>`, (m, close) => {
      const on = (id, fn) => { const b = m.querySelector(id); if (b) b.onclick = () => fn(b); };
      on('#edit', () => { close(); editModal(e); });
      on('#rain', async b => { await C.act(b, () => C.patch(`/api/events/${e.id}`, { status: 'rainout' }), 'Marked rained out. Coaches and umpires were told.'); close(); makeupModal(e); });
      m.querySelectorAll('[data-ack]').forEach(b => b.onclick = async () => {
        if (await C.act(b, () => C.post('/api/conflicts/ack', { key: b.dataset.ack }), 'Marked as OK. The badge is gone.')) { close(); CS.route(); }
      });
      on('#restore', async b => { await C.act(b, () => C.patch(`/api/events/${e.id}`, { status: 'scheduled' }), 'Restored'); close(); CS.route(); });
      on('#askswap', () => { close(); CS.practiceSwapFrom && CS.practiceSwapFrom(e); });
    });
  }

  async function makeupModal(e) {
    const opts = await C.get(`/api/events/${e.id}/makeup`);
    C.modal('Pick a makeup slot', opts.length ? `<p class="small muted">Open slots that fit this division, makeup week first. Both teams are free on these days.</p>
      ${opts.map((o, i) => `<div class="item"><div class="main"><div class="title">${C.dShort(o.date)} ${C.t12(o.start)}</div><div class="meta">${esc(o.park_short)} ${esc(o.field_name)} ${o.makeupWeek ? '<span class="badge ok">Makeup week</span>' : ''}</div></div>
      <button class="btn small" data-i="${i}">Move here</button></div>`).join('')}` : '<div class="empty">No open slots found. Add the game by hand later.</div>', (m, close) => {
      m.onclick = async ev => {
        const b = ev.target.closest('[data-i]'); if (!b) return;
        const o = opts[+b.dataset.i];
        const ok = await C.act(b, () => C.patch(`/api/events/${e.id}`, { date: o.date, fieldId: o.field_id, slotCode: o.slot_code, status: 'scheduled' }), 'Game moved. Coaches and umpires were told.');
        if (ok) { close(); CS.route(); C.showWarnings(ok); }
      };
    });
    CS.route();
  }

  function slotOptions(fieldId, date, sel) {
    const f = S.meta.fields.find(x => x.id === +fieldId);
    if (!f) return '';
    const wd = date ? String(C.toDate(date).getDay()) : null;
    return f.slots.filter(s => !wd || s.days.split(',').includes(wd)).map(s => `<option value="${s.code}" ${s.code === sel ? 'selected' : ''}>${s.code} (${C.t12(s.start)} - ${C.t12(s.end)})</option>`).join('');
  }

  function editModal(e) {
    const isNew = !e;
    e = e || { type: mode === 'games' ? 'game' : 'practice', date: st.day || C.today(), field_id: S.meta.fields[0].id, slot_code: 'early', division_id: '', published: 1 };
    const fieldOpts = S.meta.fields.map(f => `<option value="${f.id}" ${f.id === e.field_id ? 'selected' : ''}>${esc(f.park_short)} ${esc(f.name)}</option>`).join('');
    C.modal(isNew ? 'Add event' : 'Edit event', `
      <div class="field"><label>Type</label><select id="type">${['game', 'practice', 'scrimmage', 'other'].map(t => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Division</label><select id="div">${C.divisionOptions(e.division_id, 'Choose')}</select></div>
      <div class="grid two"><div class="field"><label>Date</label><input type="date" id="date" value="${e.date}"></div>
        <div class="field"><label>Field</label><select id="fld">${fieldOpts}</select></div></div>
      <div class="field"><label>Time slot</label><select id="slot">${slotOptions(e.field_id, e.date, e.slot_code)}</select></div>
      <div id="teamsbox"></div>
      <div class="field"><label>Title (other events)</label><input type="text" id="title" value="${esc(e.title || '')}"></div>
      <div class="field"><label>Notes</label><input type="text" id="notes" value="${esc(e.notes || '')}"></div>
      <label class="check"><input type="checkbox" id="pub" ${e.published ? 'checked' : ''}> Published (everyone can see it)</label>
      <div class="btnrow" style="margin-top:10px"><button class="btn" id="save">Save</button>${isNew ? '' : '<button class="btn bad" id="del">Delete</button>'}</div>`, (m, close) => {
      const $ = s => m.querySelector(s);
      const teamsBox = () => {
        const t = $('#type').value, d = $('#div').value;
        $('#teamsbox').innerHTML = t === 'practice' ? `<div class="field"><label>Team</label><select id="team">${C.teamOptions(e.team_id, d, 'Choose')}</select></div>`
          : (t === 'game' || t === 'scrimmage') ? `<div class="grid two"><div class="field"><label>Home</label><select id="home">${C.teamOptions(e.home_team_id, d, 'Choose')}</select></div>
            <div class="field"><label>Away</label><select id="away">${C.teamOptions(e.away_team_id, d, 'Choose')}</select></div></div>` : '';
      };
      teamsBox();
      $('#type').onchange = teamsBox; $('#div').onchange = teamsBox;
      const refreshSlots = () => { $('#slot').innerHTML = slotOptions($('#fld').value, $('#date').value, $('#slot').value); };
      $('#fld').onchange = refreshSlots; $('#date').onchange = refreshSlots;
      $('#save').onclick = async () => {
        const body = { type: $('#type').value, divisionId: +$('#div').value || null, date: $('#date').value, fieldId: +$('#fld').value, slotCode: $('#slot').value,
          title: $('#title').value, notes: $('#notes').value, published: $('#pub').checked,
          teamId: $('#team') ? +$('#team').value || null : null, homeTeamId: $('#home') ? +$('#home').value || null : null, awayTeamId: $('#away') ? +$('#away').value || null : null };
        const ok = await C.act($('#save'), () => isNew ? C.post('/api/events', body) : C.patch(`/api/events/${e.id}`, body), 'Saved');
        if (ok) { close(); CS.route(); C.showWarnings(ok); }
      };
      const d = $('#del'); if (d) d.onclick = async () => { close(); if (await C.confirmBox('Delete event?', 'This removes it from everyone\'s schedule.', 'Delete')) { await C.act(null, () => C.del(`/api/events/${e.id}`), 'Deleted'); CS.route(); } };
    });
  }
  CS.editEventModal = editModal;
})();
