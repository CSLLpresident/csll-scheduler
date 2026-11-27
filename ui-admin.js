// Admin: build schedules, league setup, people, teams, imports, exports, status.
(function () {
  const C = CS, { S, esc } = C;
  let tab = 'build';

  CS.S.pages.admin = async (el, rest) => {
    const r = S.me.roles;
    if (rest && rest[0]) tab = rest[0];
    const tabs = [['build', 'Build schedules'], r.admin && ['setup', 'Setup'], r.admin && ['people', 'People'], r.admin && ['teams', 'Teams'], r.admin && ['import', 'Import'], ['exports', 'Exports'], r.admin && ['status', 'Status']].filter(Boolean);
    if (!tabs.some(t => t[0] === tab)) tab = 'build';
    el.innerHTML = `<div class="pagehead"><div><h1>Admin</h1><div class="sub">${esc(S.meta.settings.season_name)} · games start ${C.dLong(S.meta.settings.game_start)}</div></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="out"><div class="spinner"></div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { location.hash = '#/admin/' + b.dataset.tab; });
    return ({ build, setup, people, teams, import: importTab, exports, status })[tab](el.querySelector('#out'));
  };

  // ---------------- build ----------------
  async function build(out) {
    const s = S.meta.settings;
    const gameEnd = C.addDays(C.mondayOf(s.game_start), 7 * s.game_weeks - 1);
    out.innerHTML = `
      <div class="card"><div class="label">Step 1</div><h3>Games</h3>
        <p class="small muted">Round robin inside each division. JM plays early only, with JM AA and AAA at both parks every night. Int/Juniors/Seniors play the 7:00 slot on Fields 5 and 6. Home/away, early/late and parks are balanced, coaches on two teams never overlap, and teams coached by board members are spread out so more board members are free for duty.</p>
        <div class="grid three"><div class="field"><label>First game week (Monday)</label><input type="date" id="gs" value="${s.game_start}"></div>
          <div class="field"><label>Weeks</label><input type="number" id="gw" value="${s.game_weeks}" min="1" max="20"></div>
          <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="smlate" ${s.sm_late_only ? 'checked' : ''}> All SM games in the late slot</label></div></div>
        <button class="btn" id="bg">Build game schedule</button> <span class="small muted">Replaces earlier generated games in those weeks. Hand-entered games stay.</span><div id="rg"></div></div>
      <div class="card"><div class="label">Step 2</div><h3>Practices</h3>
        <p class="small muted">Fills open fields after games. Uses each coach's availability and keeps it even across teams. Teams with board members coaching are spread across slots and parks for field duty coverage. Before games start each team gets at least 2 a week; during the season it uses each division's setting.</p>
        <div class="grid three"><div class="field"><label>From</label><input type="date" id="ps" value="${s.practice_start}"></div>
          <div class="field"><label>To</label><input type="date" id="pe" value="${gameEnd}"></div>
          <div class="field"><label>Per team per week (blank = defaults)</label><input type="number" id="pw" min="1" max="5"></div></div>
        <label class="check"><input type="checkbox" id="psat" checked> Use Saturday morning slots</label>
        <button class="btn" id="bp" style="margin-top:6px">Build practice schedule</button><div id="rp"></div></div>
      <div class="card"><div class="label">Step 3</div><h3>Umpires</h3>
        <p class="small muted">Fills every open umpire spot from availability and assigned divisions. Never two games at once, avoids two parks in one night, spreads games evenly. Existing assignments are kept.</p>
        <div class="grid two"><div class="field"><label>From</label><input type="date" id="us" value="${s.game_start}"></div><div class="field"><label>To</label><input type="date" id="ue" value="${S.meta.seasonEnd}"></div></div>
        <button class="btn" id="bu">Assign umpires</button><div id="ru"></div></div>
      <div class="card"><div class="label">Step 4</div><h3>Field duty shifts</h3>
        <p class="small muted">Makes an early and late shift for each park on every night fields are used (15 minutes before the early slot, 15 minutes after the late slot). The app refreshes these every few minutes for the next three weeks too.</p>
        <button class="btn" id="bd">Build field duty shifts</button><div id="rd"></div></div>
      <div class="card"><div class="label">Step 5</div><h3>Release</h3>
        <p class="small muted">Publishes everything in the season so coaches, umpires and board members can see it, resets the extra-practice priority list (random order, everyone equal), and tells everyone the schedule is out.</p>
        <label class="check"><input type="checkbox" id="rn" checked> Email everyone that the schedule is posted</label>
        <label class="check"><input type="checkbox" id="rr" checked> Reset the priority list</label>
        <button class="btn" id="rel" style="margin-top:6px">Publish and release</button></div>
      <div class="card"><h3>Start over</h3><p class="small muted">Remove generated events in a date range. Hand-entered and extra practices stay.</p>
        <div class="grid three"><div class="field"><label>Type</label><select id="ct"><option value="game">Games</option><option value="practice">Practices</option></select></div>
          <div class="field"><label>From</label><input type="date" id="cs" value="${s.practice_start}"></div><div class="field"><label>To</label><input type="date" id="ce" value="${S.meta.seasonEnd}"></div></div>
        <button class="btn bad" id="clr">Clear generated events</button></div>`;
    const $ = s => out.querySelector(s);
    $('#bg').onclick = async () => {
      await C.put('/api/settings', { sm_late_only: $('#smlate').checked, game_start: $('#gs').value, game_weeks: +$('#gw').value }).catch(C.fail);
      const r = await C.act($('#bg'), () => C.post('/api/build/games', { start: $('#gs').value, weeks: +$('#gw').value }));
      if (r) { await CS.refreshMeta(); $('#rg').innerHTML = `<p><span class="badge ok">${r.created} games created</span> ${r.unplaced.length ? `<span class="badge bad">${r.unplaced.length} could not be placed</span>` : ''}</p>${r.unplaced.length ? `<div class="tablewrap"><table><tr><th>Week</th><th>Division</th><th>Game</th></tr>${r.unplaced.map(u => `<tr><td>${u.week}</td><td>${esc(u.division)}</td><td>${esc(u.away)} at ${esc(u.home)}</td></tr>`).join('')}</table></div>` : ''}<a class="small" href="#/schedule">Review on the Game Schedule</a> (drafts are marked until you release them)`; }
    };
    $('#bp').onclick = async () => {
      const r = await C.act($('#bp'), () => C.post('/api/build/practices', { start: $('#ps').value, end: $('#pe').value, perWeek: $('#pw').value || null, saturdays: $('#psat').checked }));
      if (r) {
        const fair = r.fairness.map(f => f.got / f.asked); const min = fair.length ? Math.round(Math.min(...fair) * 100) : null, max = fair.length ? Math.round(Math.max(...fair) * 100) : null;
        $('#rp').innerHTML = `<p><span class="badge ok">${r.created} practices created</span> ${r.short.length ? `<span class="badge warn">${r.short.length} team-weeks short of a slot</span>` : ''}</p>${min !== null ? `<p class="small">Coach availability honored: ${min}% to ${max}% across coaches who entered it.</p>` : ''}<a class="small" href="#/practices/schedule">Review on the Practice Schedule</a>`;
      }
    };
    $('#bu').onclick = async () => { const r = await C.act($('#bu'), () => C.post('/api/build/umpires', { start: $('#us').value, end: $('#ue').value })); if (r) $('#ru').innerHTML = `<p><span class="badge ok">${r.filled} spots filled</span> ${r.stillOpen ? `<span class="badge bad">${r.stillOpen} still open</span> <a href="#/umpires/assign">Assign by hand</a>` : ''}</p>`; };
    $('#bd').onclick = async () => { const r = await C.act($('#bd'), () => C.post('/api/build/duty', { start: s.practice_start, end: S.meta.seasonEnd })); if (r) $('#rd').innerHTML = `<p><span class="badge ok">${r.shifts} shifts</span> <a href="#/duty">See field duty</a></p>`; };
    $('#rel').onclick = async () => {
      if (!await C.confirmBox('Release the schedule?', 'Everyone will be able to see all published games and practices.', 'Publish')) return;
      const r = await C.act($('#rel'), async () => {
        if ($('#rr').checked) await C.post('/api/priority/reset');
        return C.post('/api/schedule/publish', { start: s.practice_start, end: S.meta.seasonEnd, notifyAll: $('#rn').checked });
      });
      if (r) C.toast(`Published ${r.published} events`);
    };
    $('#clr').onclick = async () => {
      if (!await C.confirmBox('Clear generated events?', 'Umpire assignments on those games are removed too.', 'Clear')) return;
      const r = await C.act($('#clr'), () => C.post('/api/build/clear', { type: $('#ct').value, start: $('#cs').value, end: $('#ce').value }));
      if (r) C.toast(`Removed ${r.deleted}`);
    };
  }

  // ---------------- setup ----------------
  async function setup(out) {
    const s = S.meta.settings;
    const [blackouts, rates] = await Promise.all([C.get('/api/blackouts'), C.get('/api/pay-rates')]);
    const rate = (d, p) => { const r = rates.find(x => x.division_id === d && x.position === p); return r ? (r.cents / 100).toFixed(2) : ''; };
    const rules = { early: 'Early only', late: 'Late only', seven: '7:00 slot', any: 'Early or late', tball: 'T-Ball slot' };
    out.innerHTML = `
      <div class="card"><h3>Season</h3><div class="grid three">
        <div class="field"><label>Season name</label><input type="text" id="season_name" value="${esc(s.season_name)}"></div>
        <div class="field"><label>Practices start</label><input type="date" id="practice_start" value="${s.practice_start}"></div>
        <div class="field"><label>T-Ball practices start</label><input type="date" id="tball_practice_start" value="${s.tball_practice_start}"></div>
        <div class="field"><label>Games start (Monday)</label><input type="date" id="game_start" value="${s.game_start}"></div>
        <div class="field"><label>Game weeks</label><input type="number" id="game_weeks" value="${s.game_weeks}"></div>
        <div class="field"><label>Makeup weeks</label><input type="number" id="makeup_weeks" value="${s.makeup_weeks}"></div>
        <div class="field"><label>Tournament weeks</label><input type="number" id="tournament_weeks" value="${s.tournament_weeks}"></div>
        <div class="field"><label>Extra practice decided (days before)</label><input type="number" id="request_deadline_days" value="${s.request_deadline_days}"></div>
        <div class="field"><label>Field duty lead time (minutes)</label><input type="number" id="duty_lead_minutes" value="${s.duty_lead_minutes}"></div>
        <div class="field"><label>Duty reminders (hours before)</label><input type="text" id="duty_reminder_hours" value="${s.duty_reminder_hours.join(', ')}"></div>
        <div class="field"><label>Reminders that wait until 8 AM</label><input type="text" id="duty_quiet_hours" value="${s.duty_quiet_hours.join(', ')}"></div>
        <div class="field"><label>Game nights</label><div class="btnrow">${[1, 2, 3, 4, 5, 6].map(d => `<label class="check"><input type="checkbox" class="gn" value="${d}" ${s.game_nights.includes(d) ? 'checked' : ''}>${C.DOW[d]}</label>`).join('')}</div></div>
      </div><button class="btn" id="saveS">Save season</button></div>

      <div class="card"><h3>Divisions</h3><p class="small muted">Umpire crew per game, slot rule and how many games/practices each team gets per week. Turn on Majors AA/AAA if there are enough teams.</p>
        <div class="tablewrap"><table><thead><tr><th>On</th><th>Division</th><th>Slot</th><th class="num">Plate</th><th class="num">Field umps</th><th class="num">Games/wk</th><th class="num">Practices/wk</th><th class="num">Plate pay $</th><th class="num">Field pay $</th></tr></thead><tbody>
        ${S.meta.divisions.map(d => `<tr data-div="${d.id}"><td><input type="checkbox" data-k="active" ${d.active ? 'checked' : ''}></td><td><b>${esc(d.name)}</b></td>
          <td><select data-k="slot_rule" style="min-width:120px">${Object.entries(rules).map(([k, l]) => `<option value="${k}" ${d.slot_rule === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          ${['crew_plate', 'crew_field', 'games_per_week', 'practices_per_week'].map(k => `<td class="num"><input type="number" data-k="${k}" value="${d[k]}" min="0" max="5" style="width:64px"></td>`).join('')}
          <td class="num"><input type="number" step="0.01" data-rate="plate" value="${rate(d.id, 'plate')}" style="width:80px"></td><td class="num"><input type="number" step="0.01" data-rate="field" value="${rate(d.id, 'field')}" style="width:80px"></td></tr>`).join('')}
        </tbody></table></div><button class="btn" id="saveD" style="margin-top:10px">Save divisions and pay</button></div>

      <div class="card"><h3>Fields</h3><p class="small muted">Which divisions can use each field. Turn a field off if it's closed for the season.</p>
        <div class="tablewrap"><table><thead><tr><th>On</th><th>Field</th><th>Divisions (codes)</th><th>Slots</th></tr></thead><tbody>
        ${S.meta.fields.map(f => `<tr data-fld="${f.id}"><td><input type="checkbox" data-k="active" ${f.active ? 'checked' : ''}></td><td>${esc(f.park_short)} ${esc(f.name)}</td>
          <td><input type="text" data-k="divisions" value="${esc(f.divisions)}"></td><td class="small">${f.slots.map(x => `${x.code} ${C.t12s(x.start)}`).join(', ')}</td></tr>`).join('')}
        </tbody></table></div><button class="btn" id="saveF" style="margin-top:10px">Save fields</button></div>

      <div class="card"><h3>Blackout dates</h3><p class="small muted">Days a park or field can't be used (city events, other leagues).</p>
        ${blackouts.map(b => `<div class="item"><div class="main"><div class="title">${C.dLong(b.date)}</div><div class="meta">${esc(b.park_short || 'All parks')} ${esc(b.field_name || '')} ${b.slot_code ? '· ' + b.slot_code : ''} · ${esc(b.reason || '')}</div></div><button class="btn ghost small" data-rmb="${b.id}">Remove</button></div>`).join('') || '<p class="muted small">None.</p>'}
        <div class="grid three" style="margin-top:8px"><div class="field"><label>Date</label><input type="date" id="bdate"></div>
          <div class="field"><label>Field</label><select id="bfield"><option value="">All fields</option>${S.meta.fields.map(f => `<option value="${f.id}">${esc(f.park_short)} ${esc(f.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Reason</label><input type="text" id="breason"></div></div>
        <button class="btn ghost" id="addB">Add blackout</button></div>`;
    const $ = q => out.querySelector(q);
    const nums = s => s.split(',').map(x => +x.trim()).filter(x => !isNaN(x) && x > 0);
    $('#saveS').onclick = async () => {
      const body = {};
      ['season_name', 'practice_start', 'tball_practice_start', 'game_start'].forEach(k => body[k] = $('#' + k).value);
      ['game_weeks', 'makeup_weeks', 'tournament_weeks', 'request_deadline_days', 'duty_lead_minutes'].forEach(k => body[k] = +$('#' + k).value);
      body.duty_reminder_hours = nums($('#duty_reminder_hours').value); body.duty_quiet_hours = nums($('#duty_quiet_hours').value);
      body.game_nights = [...out.querySelectorAll('.gn:checked')].map(i => +i.value);
      if (await C.act($('#saveS'), () => C.put('/api/settings', body), 'Season saved')) { await CS.refreshMeta(); }
    };
    $('#saveD').onclick = async () => {
      await C.act($('#saveD'), async () => {
        const rates = [];
        for (const tr of out.querySelectorAll('[data-div]')) {
          const body = {}; tr.querySelectorAll('[data-k]').forEach(i => body[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value);
          await C.patch(`/api/divisions/${tr.dataset.div}`, body);
          tr.querySelectorAll('[data-rate]').forEach(i => rates.push({ division_id: +tr.dataset.div, position: i.dataset.rate, cents: Math.round(+i.value * 100) }));
        }
        await C.put('/api/pay-rates', { rates });
      }, 'Divisions saved');
      await CS.refreshMeta();
    };
    $('#saveF').onclick = async () => {
      await C.act($('#saveF'), async () => { for (const tr of out.querySelectorAll('[data-fld]')) await C.patch(`/api/fields/${tr.dataset.fld}`, { active: tr.querySelector('[data-k=active]').checked, divisions: tr.querySelector('[data-k=divisions]').value }); }, 'Fields saved');
      await CS.refreshMeta();
    };
    $('#addB').onclick = async () => { if (!$('#bdate').value) return C.toast('Pick a date', true); if (await C.act($('#addB'), () => C.post('/api/blackouts', { date: $('#bdate').value, fieldId: +$('#bfield').value || null, reason: $('#breason').value }), 'Added')) CS.route(); };
    out.onclick = async e => { const b = e.target.closest('[data-rmb]'); if (b && await C.act(b, () => C.del(`/api/blackouts/${b.dataset.rmb}`), 'Removed')) CS.route(); };
  }

  // ---------------- people ----------------
  const ROLE_COLS = [['is_admin', 'Admin'], ['is_president', 'President'], ['is_board', 'Board'], ['is_ump_coord', 'Ump coordinator'], ['is_umpire', 'Umpire'], ['is_coach', 'Coach'], ['can_edit_schedule', 'Can edit schedule']];
  async function people(out) {
    const list = await C.get('/api/people');
    let q = '', role = '';
    const draw = () => {
      const rows = list.filter(p => (!q || `${p.first} ${p.last} ${p.email} ${p.phone} ${p.teams || ''}`.toLowerCase().includes(q)) && (!role || p[role]));
      out.querySelector('#plist').innerHTML = rows.map(p => `<tr ${p.active ? '' : 'style="opacity:.5"'}><td><b>${esc(p.first)} ${esc(p.last)}</b>${p.teams ? `<br><span class="small muted">${esc(p.teams)}</span>` : ''}</td>
        <td class="small">${C.telLink(p.phone)}<br>${esc(p.email || '')}</td><td>${ROLE_COLS.filter(([k]) => p[k]).map(([, l]) => `<span class="badge" style="margin:1px">${l}</span>`).join('')}</td>
        <td><button class="btn ghost small" data-edit="${p.id}">Edit</button></td></tr>`).join('');
      out.querySelector('#pcount').textContent = `${rows.length} people`;
    };
    out.innerHTML = `<div class="filters"><input type="text" id="q" placeholder="Search name, phone, email, team"><select id="role"><option value="">Everyone</option>${ROLE_COLS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="btn" id="add">Add person</button><a class="btn ghost" href="#/admin/import">Import CSV</a><span class="small muted" id="pcount"></span></div>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Contact</th><th>Roles</th><th></th></tr></thead><tbody id="plist"></tbody></table></div>`;
    draw();
    out.querySelector('#q').oninput = e => { q = e.target.value.toLowerCase(); draw(); };
    out.querySelector('#role').onchange = e => { role = e.target.value; draw(); };
    out.querySelector('#add').onclick = () => personModal(null);
    out.querySelector('#plist').onclick = e => { const b = e.target.closest('[data-edit]'); if (b) personModal(list.find(p => p.id === +b.dataset.edit)); };
  }
  function personModal(p) {
    const isNew = !p; p = p || { active: 1 };
    C.modal(isNew ? 'Add person' : `${p.first} ${p.last}`, `
      <div class="grid two"><div class="field"><label>First name</label><input type="text" id="first" value="${esc(p.first || '')}"></div><div class="field"><label>Last name</label><input type="text" id="last" value="${esc(p.last || '')}"></div></div>
      <div class="field"><label>Mobile phone (for texts and login)</label><input type="tel" id="phone" value="${esc(p.phone || '')}"></div>
      <div class="field"><label>Email</label><input type="email" id="email" value="${esc(p.email || '')}"></div>
      <div class="label">Roles</div>${ROLE_COLS.map(([k, l]) => `<label class="check"><input type="checkbox" data-r="${k}" ${p[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      ${isNew ? '' : `<label class="check"><input type="checkbox" id="active" ${p.active ? 'checked' : ''}> Active (can log in)</label>`}
      <p class="small muted">Coaches are linked to teams on the Teams tab or by import.</p>
      <button class="btn" id="save">Save</button>`, (m, close) => {
      m.querySelector('#save').onclick = async () => {
        const body = { first: m.querySelector('#first').value.trim(), last: m.querySelector('#last').value.trim(), phone: m.querySelector('#phone').value.trim(), email: m.querySelector('#email').value.trim() };
        m.querySelectorAll('[data-r]').forEach(i => body[i.dataset.r] = i.checked);
        if (!isNew) body.active = m.querySelector('#active').checked;
        if (await C.act(m.querySelector('#save'), () => isNew ? C.post('/api/people', body) : C.patch(`/api/people/${p.id}`, body), 'Saved')) { close(); CS.route(); }
      };
    });
  }

  // ---------------- teams ----------------
  async function teams(out) {
    await CS.refreshMeta();
    const ppl = await C.get('/api/people');
    out.innerHTML = `<div class="btnrow" style="margin-bottom:10px"><button class="btn" id="add">Add team</button><a class="btn ghost" href="#/admin/import">Import from Sports Connect</a></div>
      ${S.meta.divisions.filter(d => d.active).map(d => {
        const ts = S.meta.teams.filter(t => t.division_id === d.id);
        return `<h2>${esc(d.name)} <span class="small muted">(${ts.length})</span></h2>${ts.map(t => `<div class="item"><div class="bar" style="background:${esc(d.color)}"></div><div class="main"><div class="title">${esc(t.name)}</div>
          <div class="meta">${t.coaches.map(c => `${esc(c.first)} ${esc(c.last)} (${c.role === 'head' ? 'head' : 'asst'})${c.is_board ? ' <span class="badge maroon">Board</span>' : ''}`).join(', ') || '<span class="badge bad">No coach</span>'}</div></div>
          <button class="btn ghost small" data-team="${t.id}">Edit</button></div>`).join('') || '<p class="muted small">No teams.</p>'}`;
      }).join('')}`;
    out.querySelector('#add').onclick = () => teamModal(null, ppl);
    out.onclick = e => { const b = e.target.closest('[data-team]'); if (b) teamModal(S.meta.teams.find(t => t.id === +b.dataset.team), ppl); };
  }
  function teamModal(t, ppl) {
    const isNew = !t; t = t || { name: '', division_id: S.meta.divisions[0].id, coaches: [] };
    let coaches = t.coaches.map(c => ({ personId: c.id, role: c.role }));
    const pOpts = sel => '<option value="">Choose person</option>' + ppl.filter(p => p.active).map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.last)}, ${esc(p.first)}</option>`).join('');
    C.modal(isNew ? 'Add team' : t.name, `
      <div class="field"><label>Team name</label><input type="text" id="name" value="${esc(t.name)}"></div>
      <div class="field"><label>Division</label><select id="div">${C.divisionOptions(t.division_id, 'Choose')}</select></div>
      ${isNew ? '' : `<div class="label">Coaches</div><div id="cl"></div><button class="btn ghost small" id="addc">Add coach</button>`}
      <div class="btnrow" style="margin-top:12px"><button class="btn" id="save">Save</button>${isNew ? '' : '<button class="btn bad" id="deact">Remove team</button>'}</div>`, (m, close) => {
      const draw = () => { const cl = m.querySelector('#cl'); if (!cl) return; cl.innerHTML = coaches.map((c, i) => `<div class="grid two" style="grid-template-columns:2fr 1fr auto;margin-bottom:6px"><select data-p="${i}">${pOpts(c.personId)}</select>
        <select data-role="${i}"><option value="head" ${c.role === 'head' ? 'selected' : ''}>Head</option><option value="assistant" ${c.role === 'assistant' ? 'selected' : ''}>Assistant</option></select><button class="btn ghost small" data-x="${i}">${C.icon('x')}</button></div>`).join(''); };
      draw();
      m.onchange = e => { if (e.target.dataset.p) coaches[+e.target.dataset.p].personId = +e.target.value; if (e.target.dataset.role) coaches[+e.target.dataset.role].role = e.target.value; };
      m.onclick = e => { const x = e.target.closest('[data-x]'); if (x) { coaches.splice(+x.dataset.x, 1); draw(); } };
      const ac = m.querySelector('#addc'); if (ac) ac.onclick = () => { coaches.push({ personId: null, role: coaches.length ? 'assistant' : 'head' }); draw(); };
      m.querySelector('#save').onclick = async () => {
        const ok = await C.act(m.querySelector('#save'), async () => {
          if (isNew) return C.post('/api/teams', { name: m.querySelector('#name').value, divisionId: +m.querySelector('#div').value });
          await C.patch(`/api/teams/${t.id}`, { name: m.querySelector('#name').value, divisionId: +m.querySelector('#div').value });
          return C.put(`/api/teams/${t.id}/coaches`, { coaches: coaches.filter(c => c.personId) });
        }, 'Saved');
        if (ok) { close(); await CS.refreshMeta(); CS.route(); }
      };
      const d = m.querySelector('#deact'); if (d) d.onclick = async () => { if (await C.act(d, () => C.patch(`/api/teams/${t.id}`, { active: false }), 'Team removed')) { close(); await CS.refreshMeta(); CS.route(); } };
    });
  }

  // ---------------- import ----------------
  function importTab(out) {
    out.innerHTML = `<div class="grid two">
      <div class="card"><h3>People</h3><p class="small muted">Coaches, board members and umpires. Columns (any order): <b>First, Last, Phone, Email, Roles</b> (e.g. "board; umpire; coach; ump coord; president"). Optional: <b>Team, Division, Coach Role</b> (head/assistant), <b>Umpire Divisions</b> (e.g. "JMAA; JMAAA; SMAA").</p>
        <input type="file" id="pf" accept=".csv,text/csv"><textarea id="pt" placeholder="Or paste CSV here" style="margin-top:8px"></textarea>
        <div class="btnrow" style="margin-top:8px"><button class="btn ghost" id="pp">Preview</button><button class="btn" id="pa" disabled>Import</button></div><div id="pr"></div></div>
      <div class="card"><h3>Sports Connect teams</h3><p class="small muted">Export teams with volunteers (coaches) from Sports Connect as CSV. We match divisions by name, add new teams and coaches, and show changes before anything is saved. Nobody is removed automatically.</p>
        <input type="file" id="sf" accept=".csv,text/csv"><textarea id="stx" placeholder="Or paste CSV here" style="margin-top:8px"></textarea>
        <div class="btnrow" style="margin-top:8px"><button class="btn ghost" id="sp">Preview changes</button><button class="btn" id="sa" disabled>Apply changes</button></div><div id="sr"></div></div></div>`;
    const $ = q => out.querySelector(q);
    const readFile = (inp, ta) => inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { ta.value = r.result; }; r.readAsText(f); };
    readFile($('#pf'), $('#pt')); readFile($('#sf'), $('#stx'));
    $('#pp').onclick = async () => {
      const rows = await C.act($('#pp'), () => C.post('/api/import/people/preview', { csv: $('#pt').value })); if (!rows) return;
      $('#pr').innerHTML = `<p class="small">${rows.filter(r => r.action === 'add').length} new, ${rows.filter(r => r.action === 'update').length} updates</p><div class="tablewrap" style="max-height:300px"><table><tr><th>Name</th><th>Contact</th><th>Roles</th><th></th></tr>${rows.map(r => `<tr><td>${esc(r.first)} ${esc(r.last)}${r.team ? `<br><span class="small muted">${esc(r.team)} (${r.coachRole})</span>` : ''}</td><td class="small">${esc(r.phone || '')}<br>${esc(r.email)}</td><td class="small">${Object.entries(r.roles).filter(([, v]) => v).map(([k]) => k.replace('is_', '')).join(', ')}</td><td><span class="badge ${r.action === 'add' ? 'ok' : ''}">${r.action}</span></td></tr>`).join('')}</table></div>`;
      $('#pa').disabled = !rows.length;
    };
    $('#pa').onclick = async () => { const r = await C.act($('#pa'), () => C.post('/api/import/people/apply', { csv: $('#pt').value })); if (r) { C.toast(`Added ${r.added}, updated ${r.updated}`); await CS.refreshMeta(); $('#pa').disabled = true; } };
    $('#sp').onclick = async () => {
      const rows = await C.act($('#sp'), () => C.post('/api/import/sportsconnect/preview', { csv: $('#stx').value })); if (!rows) return;
      $('#sr').innerHTML = rows.map(t => `<div class="item"><div class="main"><div class="title">${esc(t.team)} <span class="badge ${t.teamAction === 'add' ? 'ok' : ''}">${t.teamAction === 'add' ? 'new team' : 'existing'}</span></div>
        <div class="meta">${esc(t.division)}</div>${t.coaches.map(c => `<div class="small">${esc(c.first)} ${esc(c.last)} (${c.role}) · <b>${esc(c.action)}</b></div>`).join('')}</div></div>`).join('') || '<p class="muted">No teams found. Check the columns include Division and Team.</p>';
      $('#sa').disabled = !rows.length;
    };
    $('#sa').onclick = async () => { const r = await C.act($('#sa'), () => C.post('/api/import/sportsconnect/apply', { csv: $('#stx').value })); if (r) { C.toast(`${r.teamsAdded} teams, ${r.peopleAdded} new people, ${r.links} coach links`); await CS.refreshMeta(); $('#sa').disabled = true; } };
  }

  // ---------------- exports ----------------
  function exports(out) {
    const s = S.meta.settings;
    out.innerHTML = `<div class="grid two">
      <div class="card"><h3>City field schedule</h3><p class="small muted">Same layout as "CSLL Gameday Field Schedules": one sheet per park, each week and day, which fields are used early/late and for which divisions.</p>
        <div class="grid two"><div class="field"><label>From</label><input type="date" id="cs" value="${s.practice_start}"></div><div class="field"><label>To</label><input type="date" id="ce" value="${S.meta.seasonEnd}"></div></div>
        <button class="btn" id="city">${C.icon('down')} Download Excel</button></div>
      <div class="card"><h3>Schedules</h3><p class="small muted">Full schedule or one division at a time (CSV opens in Excel or Google Sheets).</p>
        <div class="btnrow"><a class="btn" href="/export/schedule.csv?type=practice,scrimmage">${C.icon('down')} Practice schedule</a><a class="btn" href="/export/schedule.csv?type=game">${C.icon('down')} Game schedule</a><a class="btn ghost" href="/export/schedule.csv">Everything</a></div>
        <div class="btnrow" style="margin-top:8px">${S.meta.divisions.filter(d => d.active).map(d => `<a class="btn ghost small" href="/export/schedule.csv?division=${d.id}">${esc(d.code)}</a>`).join('')}</div></div>
      <div class="card"><h3>Umpires</h3><a class="btn ghost" href="/export/umpires.csv?start=${s.game_start}&end=${S.meta.seasonEnd}">${C.icon('down')} Umpire schedule</a>
        <p class="small muted" style="margin-top:8px">Payroll for Jackie is on Umpires › Payroll (pick dates).</p></div>
      <div class="card"><h3>Field duty</h3><a class="btn ghost" href="/export/duty.csv?start=${s.practice_start}&end=${S.meta.seasonEnd}">${C.icon('down')} Field duty roster</a></div></div>`;
    out.querySelector('#city').onclick = () => C.download(`/export/city.xlsx?start=${out.querySelector('#cs').value}&end=${out.querySelector('#ce').value}`);
  }

  // ---------------- status ----------------
  async function status(out) {
    const s = await C.get('/api/admin/status');
    out.innerHTML = `<div class="grid three">
      <div class="stat"><b>${s.sms ? 'On' : 'Off'}</b><span>Text messages ${s.sms ? '(Twilio)' : '(not set up: messages are logged only)'}</span></div>
      <div class="stat"><b>${s.email ? 'On' : 'Off'}</b><span>Email ${s.email ? '(SMTP)' : '(not set up: messages are logged only)'}</span></div>
      <div class="stat"><b>${s.counts.people}</b><span>People</span></div></div>
      ${s.demo ? '<p><span class="badge warn">Demo mode is on: login codes show on screen. Turn it off before real use.</span></p>' : ''}
      <div class="btnrow" style="margin:12px 0"><button class="btn ghost" id="test">Send me a test message</button><button class="btn ghost" id="jobs">Run background jobs now</button></div>
      <h2>Recent changes</h2><div class="tablewrap"><table><tr><th>When (UTC)</th><th>Who</th><th>What</th></tr>
      ${s.audit.map(a => `<tr><td class="small nowrap">${esc(a.created_at)}</td><td>${esc((a.first || '') + ' ' + (a.last || ''))}</td><td class="small">${esc(a.action)} <span class="muted">${esc((a.detail || '').slice(0, 120))}</span></td></tr>`).join('')}</table></div>`;
    out.querySelector('#test').onclick = e => C.act(e.target, () => C.post('/api/admin/test-message'), 'Sent. Check your phone and email.');
    out.querySelector('#jobs').onclick = e => C.act(e.target, () => C.post('/api/admin/run-jobs'), 'Done');
  }
})();
