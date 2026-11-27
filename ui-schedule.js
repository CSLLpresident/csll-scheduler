// Game Schedule and Practice Schedule: everyone sees every game, practice and scrimmage. Schedulers can edit, move, rain out and add.
(function () {
  const C = CS, { S, esc } = C;
  const fresh = () => ({ week: null, division: '', team: '', park: '', type: '', mine: false, view: 'list', day: null });
  const states = { game: fresh(), practice: fresh() };
  let st = states.game;
  let mode = 'game';

  const MODES = {
    game: { title: 'Game Schedule', sub: 'Every game in the league. Coaches can see each other\'s times to work out conflicts.', types: 'game', start: () => S.meta.settings.game_start, empty: 'No games this week with these filters.' },
    practice: { title: 'Practice Schedule', sub: 'Every practice and scrimmage. Practices start before games, so this is the first schedule of the season.', types: 'practice,scrimmage', start: () => S.meta.settings.practice_start, empty: 'No practices this week with these filters.' },
  };

  // Renders a schedule for one mode into el. opts.embedded = inside another page (no page title).
  async function renderSchedule(el, m, opts = {}) {
    mode = m; st = states[m];
    const cfg = MODES[m];
    const r = S.me.roles;
    if (!st.week) {
      const t = C.today(), first = cfg.start();
      st.week = C.mondayOf(t < first ? first : t);
      st.mine = r.coachTeams.length > 0 && !r.scheduler;
    }
    if (!st.day || st.day < st.week || st.day > C.addDays(st.week, 6)) st.day = st.week;
    const q = new URLSearchParams({ start: st.week, end: C.addDays(st.week, 6), type: st.type || cfg.types });
    if (st.division) q.set('division', st.division);
    if (st.team) q.set('team', st.team);
    if (st.park) q.set('park', st.park);
    if (st.mine) q.set('mine', '1');
    if (r.scheduler) q.set('status', 'all');
    const events = await C.get('/api/events?' + q);

    const exportQ = new URLSearchParams({ type: cfg.types }); if (st.division) exportQ.set('division', st.division); if (st.team) exportQ.set('team', st.team);
    const buttons = `<div class="btnrow">${r.scheduler ? `<button class="btn" id="add">Add ${m === 'game' ? 'game' : 'practice'}</button>` : ''}
          <a class="btn ghost" href="/export/schedule.csv?${exportQ}">${C.icon('down')} CSV</a></div>`;
    el.innerHTML = `
      ${opts.embedded ? `<div class="pagehead" style="margin-bottom:8px"><div></div>${buttons}</div>` : `<div class="pagehead"><div><h1>${cfg.title}</h1><div class="sub">${cfg.sub}</div></div>${buttons}</div>`}
      ${C.weekNav('wk', st.week)}
      <div class="filters" style="margin-top:10px">
        <select id="fdiv" aria-label="Division">${C.divisionOptions(st.division)}</select>
        <select id="fteam" aria-label="Team">${C.teamOptions(st.team, st.division)}</select>
        <select id="fpark" aria-label="Park">${C.parkOptions(st.park)}</select>
        ${m === 'practice' ? `<select id="ftype" aria-label="Type"><option value="">Practices and scrimmages</option>
          ${['practice', 'scrimmage'].map(t => `<option value="${t}" ${st.type === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}s only</option>`).join('')}</select>` : ''}
        ${r.coachTeams.length ? `<label class="check"><input type="checkbox" id="fmine" ${st.mine ? 'checked' : ''}> My teams only</label>` : ''}
      </div>
      <div class="tabs" role="tablist"><button data-view="list" class="${st.view === 'list' ? 'on' : ''}">List</button><button data-view="grid" class="${st.view === 'grid' ? 'on' : ''}">Fields by day</button></div>
      <div id="out"></div>`;

    const out = el.querySelector('#out');
    if (st.view === 'list') {
      out.innerHTML = events.length ? C.groupByDate(events, e => C.eventItem(e, { click: true, showUmps: r.board || r.umpire })) : `<div class="empty">${cfg.empty}</div>`;
    } else {
      out.innerHTML = dayGrid(events);
    }

    // handlers
    const rerender = () => renderSchedule(el, m, opts).catch(C.fail);
    el.querySelector('#wk').onclick = e => { const b = e.target.closest('[data-wk]'); if (!b) return; const n = +b.dataset.wk; st.week = n ? C.addDays(st.week, n) : C.mondayOf(C.today()); rerender(); };
    el.querySelector('#fdiv').onchange = e => { st.division = e.target.value; st.team = ''; rerender(); };
    el.querySelector('#fteam').onchange = e => { st.team = e.target.value; rerender(); };
    el.querySelector('#fpark').onchange = e => { st.park = e.target.value; rerender(); };
    const ft = el.querySelector('#ftype'); if (ft) ft.onchange = e => { st.type = e.target.value; rerender(); };
    const fm = el.querySelector('#fmine'); if (fm) fm.onchange = e => { st.mine = e.target.checked; rerender(); };
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { st.view = b.dataset.view; rerender(); });
    el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { st.day = b.dataset.day; rerender(); });
    out.onclick = e => {
      const it = e.target.closest('[data-event]'); if (!it) return;
      const ev = events.find(x => x.id === +it.dataset.event);
      if (ev) eventModal(ev);
    };
    const add = el.querySelector('#add'); if (add) add.onclick = () => editModal(null);
  }
  CS.renderSchedule = renderSchedule;
  CS.S.pages.schedule = el => renderSchedule(el, 'game');

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
    const coaches = teams.map(t => `<div style="margin-bottom:6px"><b>${esc(t.name)}</b><br>${t.coaches.map(c => `${esc(c.first)} ${esc(c.last)} (${c.role === 'head' ? 'head' : 'asst'}) ${C.telLink(c.phone)}`).join('<br>') || '<span class="muted">No coaches listed</span>'}</div>`).join('');
    const myTeams = r.coachTeams.map(t => t.id);
    const isMinePractice = e.type === 'practice' && myTeams.includes(e.team_id);
    const otherPractice = e.type === 'practice' && myTeams.length && !myTeams.includes(e.team_id);
    C.modal(C.eventTitle(e), `
      <p>${C.typeBadge(e)} ${C.statusBadge(e)} <span class="badge outline">${esc(e.division_name || '')}</span></p>
      <p><b>${C.dLong(e.date)}</b>, ${C.t12(e.start)} to ${C.t12(e.end)}<br>${esc(e.park_short)} ${esc(e.field_name)}</p>
      ${e.umpires ? `<p class="small"><b>Umpires:</b> ${esc(e.umpires)}</p>` : ''}
      ${e.notes ? `<p class="small">${esc(e.notes)}</p>` : ''}
      <div class="card" style="margin-bottom:12px"><div class="label" style="margin-bottom:6px">Coaches</div>${coaches}</div>
      <div class="btnrow">
        ${isMinePractice ? '<a class="btn ghost" href="#/practices/swaps">Swap or invite to scrimmage</a>' : ''}
        ${otherPractice ? `<button class="btn ghost" id="askswap">Ask to swap for this time</button>` : ''}
        ${r.scheduler ? '<button class="btn" id="edit">Edit / move</button>' : ''}
        ${r.scheduler && e.type === 'game' && e.status === 'scheduled' ? '<button class="btn bad" id="rain">Rain out</button>' : ''}
        ${r.scheduler && e.status !== 'scheduled' ? '<button class="btn ghost" id="restore">Restore</button>' : ''}
      </div>`, (m, close) => {
      const on = (id, fn) => { const b = m.querySelector(id); if (b) b.onclick = () => fn(b); };
      on('#edit', () => { close(); editModal(e); });
      on('#rain', async b => { await C.act(b, () => C.patch(`/api/events/${e.id}`, { status: 'rainout' }), 'Marked rained out. Coaches and umpires were told.'); close(); makeupModal(e); });
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
        if (ok) { close(); CS.route(); }
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
    e = e || { type: mode === 'game' ? 'game' : 'practice', date: st.day || C.today(), field_id: S.meta.fields[0].id, slot_code: 'early', division_id: '', published: 1 };
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
        if (ok) { close(); CS.route(); }
      };
      const d = $('#del'); if (d) d.onclick = async () => { close(); if (await C.confirmBox('Delete event?', 'This removes it from everyone\'s schedule.', 'Delete')) { await C.act(null, () => C.del(`/api/events/${e.id}`), 'Deleted'); CS.route(); } };
    });
  }
  CS.editEventModal = editModal;
})();
