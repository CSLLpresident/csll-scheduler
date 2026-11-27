// Umpires: my games, open spots and swaps, attendance, assignments, roster and payroll.
(function () {
  const C = CS, { S, esc } = C;
  const st = { tab: null, week: null, date: null, pstart: null, pend: null };

  CS.S.pages.umpires = async (el, rest) => {
    const r = S.me.roles;
    const tabs = [r.umpire && ['mine', 'My games'], r.umpire && ['open', 'Open & swaps'], r.board && ['tonight', 'Attendance'], r.umpCoord && ['assign', 'Assign'], r.board && ['roster', 'Roster'], r.board && ['payroll', 'Payroll']].filter(Boolean);
    if (rest && rest[0]) st.tab = rest[0];
    if (!st.tab || !tabs.some(t => t[0] === st.tab)) st.tab = tabs[0][0];
    if (!st.week) st.week = C.mondayOf(C.today() < S.meta.settings.game_start ? S.meta.settings.game_start : C.today());
    el.innerHTML = `<div class="pagehead"><div><h1>Umpires</h1><div class="sub">${r.umpire ? 'Your games, open spots, sick calls and swaps.' : 'Umpire coverage, attendance and pay.'}</div></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="out"><div class="spinner"></div></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { location.hash = '#/umpires/' + b.dataset.tab; });
    const out = el.querySelector('#out');
    return ({ mine, open, tonight, assign, roster, payroll })[st.tab](out);
  };

  const gameLine = a => `${esc(a.away_name || '')} at ${esc(a.home_name || '')}`;
  const posBadge = p => `<span class="badge ${p === 'plate' ? 'maroon' : ''}">${p === 'plate' ? 'Plate' : 'Field'}</span>`;

  async function mine(out) {
    const list = (await C.get(`/api/umps/assignments?start=${C.today()}&end=${C.addDays(C.today(), 60)}&mine=1`)).filter(a => a.status !== 'sick');
    const swaps = await C.get('/api/umps/swaps');
    const offered = new Set(swaps.filter(s => s.from_person === S.me.person.id).map(s => s.assignment_id));
    out.innerHTML = `<div class="btnrow" style="margin-bottom:6px"><a class="btn ghost small" href="#/availability">Update my availability</a></div>
      ${list.length ? C.groupByDate(list, a => {
        const startMs = new Date(`${a.date}T${a.start}:00`).getTime();
        const canCheck = Date.now() > startMs - 90 * 60000 && Date.now() < new Date(`${a.date}T${a.end}:00`).getTime();
        return `<div class="item"><div class="time">${C.t12s(a.start)}<small>${esc(a.division_code)}</small></div>
        <div class="main"><div class="title">${esc(a.park_short)} ${esc(a.field_name)} ${posBadge(a.position)}</div><div class="meta">${gameLine(a)} · ${esc(a.division_name)}</div>
          ${a.checkin_at ? `<div class="small" style="margin-top:3px"><span class="badge ok">Checked in ${esc(a.checkin_at.slice(11, 16))}</span></div>` : ''}</div>
        <div class="side">${canCheck && !a.checkin_at ? `<button class="btn ok small" data-checkin="${a.id}">Check in</button>` : ''}
          ${offered.has(a.id) ? '<span class="badge warn">Offered</span>' : `<button class="btn ghost small" data-offer="${a.id}">Offer swap</button>`}
          <button class="btn bad small" data-sick="${a.id}">Can't make it</button></div></div>`;
      }) : '<div class="empty">No games assigned to you yet.</div>'}`;
    out.onclick = async e => {
      const ck = e.target.closest('[data-checkin]'), of = e.target.closest('[data-offer]'), sk = e.target.closest('[data-sick]');
      if (ck) { await C.act(ck, () => C.post(`/api/umps/assignments/${ck.dataset.checkin}/checkin`), 'Checked in'); CS.route(); }
      if (of) { await C.act(of, () => C.post(`/api/umps/assignments/${of.dataset.offer}/offer`, {}), 'Posted. You stay on the game until someone takes it.'); CS.route(); }
      if (sk && await C.confirmBox('Call in sick?', 'We\'ll text every qualified umpire to cover your spot and let the umpire coordinators and League President know. You\'ll be taken off this game.', 'Yes, I can\'t make it')) {
        await C.act(sk, () => C.post(`/api/umps/assignments/${sk.dataset.sick}/sick`), 'Got it. Your spot is posted.'); CS.route();
      }
    };
  }

  async function open(out) {
    const [spots, swaps] = await Promise.all([C.get(`/api/umps/assignments?start=${C.today()}&end=${C.addDays(C.today(), 45)}&open=1`), C.get('/api/umps/swaps')]);
    const offers = swaps.filter(s => s.from_person !== S.me.person.id);
    out.innerHTML = `<h2 style="margin-top:0">Open spots (${spots.length})</h2><p class="small muted">Games in your divisions that still need an umpire. First to take it gets it.</p>
      ${spots.length ? C.groupByDate(spots, a => `<div class="item"><div class="time">${C.t12s(a.start)}<small>${esc(a.division_code)}</small></div>
        <div class="main"><div class="title">${esc(a.park_short)} ${esc(a.field_name)} ${posBadge(a.position)}</div><div class="meta">${gameLine(a)}</div></div>
        <button class="btn small" data-take="${a.id}">Take it</button></div>`) : '<div class="empty">No open spots right now.</div>'}
      <h2>Shifts other umpires are offering</h2>
      ${offers.length ? offers.map(s => `<div class="item"><div class="main"><div class="title">${C.dShort(s.date)} ${C.t12(s.start)} · ${esc(s.park_short)} ${esc(s.field_name)} ${posBadge(s.position)}</div>
        <div class="meta">${esc(s.division_name)} · from ${esc(s.from_first)} ${esc(s.from_last)}${s.message ? ' · "' + esc(s.message) + '"' : ''}</div></div>
        <button class="btn small" data-accept="${s.id}">Take this shift</button></div>`).join('') : '<div class="empty">No shifts offered.</div>'}`;
    out.onclick = async e => {
      const t = e.target.closest('[data-take]'), a = e.target.closest('[data-accept]');
      if (t) { await C.act(t, () => C.post(`/api/umps/assignments/${t.dataset.take}/assign`, {}), 'It\'s yours. Thanks!'); CS.route(); }
      if (a) { await C.act(a, () => C.post(`/api/umps/swaps/${a.dataset.accept}/accept`), 'Swap done. It\'s on your schedule.'); CS.route(); }
    };
  }

  async function tonight(out) {
    if (!st.date) st.date = C.today();
    const list = (await C.get(`/api/umps/assignments?date=${st.date}&start=${st.date}&end=${st.date}`)).filter(a => a.status !== 'sick');
    const byGame = new Map(); list.forEach(a => (byGame.get(a.event_id) || byGame.set(a.event_id, []).get(a.event_id)).push(a));
    out.innerHTML = `<div class="filters"><input type="date" id="d" value="${st.date}" style="max-width:200px"><span class="small muted">Mark who worked and in which position. No-shows are not paid.</span></div>
      ${byGame.size ? [...byGame.values()].map(g => `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>${C.t12(g[0].start)} · ${esc(g[0].park_short)} ${esc(g[0].field_name)}</b><div class="small muted">${esc(g[0].division_name)} · ${gameLine(g[0])}</div></div></div>
        ${g.map(a => `<div class="item" style="margin:8px 0 0"><div class="main"><div class="title">${a.person_id ? esc(a.first + ' ' + a.last) : '<span class="badge bad">OPEN</span>'} ${posBadge(a.position)}</div>
          <div class="meta">${a.checkin_at ? 'Checked in ' + esc(a.checkin_at.slice(11, 16)) : 'Not checked in'}${a.status === 'present' ? ' · <b>Worked ' + esc(a.worked_position || a.position) + '</b>' : a.status === 'no_show' ? ' · <b style="color:var(--bad)">No-show</b>' : ''}</div></div>
          ${a.person_id ? `<div class="btnrow"><button class="btn ok small" data-att="${a.id}|present|plate">Plate</button><button class="btn ok small" data-att="${a.id}|present|field">Field</button><button class="btn bad small" data-att="${a.id}|no_show|">No-show</button></div>` : ''}</div>`).join('')}</div>`).join('') : '<div class="empty">No games with umpires on this date.</div>'}`;
    out.querySelector('#d').onchange = e => { st.date = e.target.value; CS.route(); };
    out.onclick = async e => {
      const b = e.target.closest('[data-att]'); if (!b) return;
      const [id, status, position] = b.dataset.att.split('|');
      await C.act(b, () => C.post(`/api/umps/assignments/${id}/attendance`, { status, position: position || null }), 'Saved'); CS.route();
    };
  }

  async function assign(out) {
    const end = C.addDays(st.week, 6);
    const list = (await C.get(`/api/umps/assignments?start=${st.week}&end=${end}`)).filter(a => a.status !== 'sick');
    const openCount = list.filter(a => !a.person_id).length;
    out.innerHTML = `${C.weekNav('wk', st.week)}
      <div class="btnrow" style="margin:10px 0"><button class="btn" id="auto">Auto-fill open spots this week</button>
        <a class="btn ghost" href="/export/umpires.csv?start=${st.week}&end=${C.addDays(st.week, 27)}">${C.icon('down')} Umpire schedule CSV</a>
        <span class="badge ${openCount ? 'bad' : 'ok'}">${openCount} open</span></div>
      <p class="small muted">Auto-fill uses availability, divisions and a fair spread. Tap a spot to choose someone. JM games have two field umpires; the second one is the backup you can pull (JM AA first).</p>
      ${list.length ? C.groupByDate(list, a => `<div class="item click" data-pos="${a.id}"><div class="time">${C.t12s(a.start)}<small>${esc(a.division_code)}</small></div>
        <div class="main"><div class="title">${a.person_id ? esc(a.first + ' ' + a.last) : '<span class="badge bad">OPEN</span>'} ${posBadge(a.position)}</div>
        <div class="meta">${esc(a.park_short)} ${esc(a.field_name)} · ${gameLine(a)}</div></div>${C.icon('right')}</div>`) : '<div class="empty">No games this week.</div>'}`;
    out.querySelector('#wk').onclick = e => { const b = e.target.closest('[data-wk]'); if (!b) return; const n = +b.dataset.wk; st.week = n ? C.addDays(st.week, n) : C.mondayOf(C.today()); CS.route(); };
    out.querySelector('#auto').onclick = async e => { const r = await C.act(e.target, () => C.post('/api/build/umpires', { start: st.week, end })); if (r) { C.toast(`Filled ${r.filled}. ${r.stillOpen} still open.`); CS.route(); } };
    out.onclick = e => { const it = e.target.closest('[data-pos]'); if (it) pickModal(list.find(a => a.id === +it.dataset.pos)); };
  }

  async function pickModal(a) {
    const c = await C.get(`/api/umps/assignments/${a.id}/candidates`);
    C.modal(`${a.division_name} ${a.position}, ${C.dShort(a.date)} ${C.t12(a.start)}`, `
      <p class="small">${esc(a.park_short)} ${esc(a.field_name)} · ${gameLine(a)}${a.person_id ? `<br>Now: <b>${esc(a.first)} ${esc(a.last)}</b>` : ''}</p>
      <div class="label">Available and qualified</div>
      ${c.available.length ? c.available.map(u => `<div class="item"><div class="main"><div class="title">${esc(u.first)} ${esc(u.last)}</div><div class="meta">${C.telLink(u.phone)}</div></div><button class="btn small" data-pick="${u.id}">Assign</button></div>`).join('') : '<p class="small muted">Nobody free and qualified.</p>'}
      ${c.pull.length ? `<div class="label" style="margin-top:12px">Pull a JM backup (same time)</div>${c.pull.map(p => `<div class="item"><div class="main"><div class="title">${esc(p.first)} ${esc(p.last)}</div><div class="meta">${esc(p.division)} on ${esc(p.field)}${p.samePark ? ' · same park' : ' · other park'}</div></div><button class="btn ghost small" data-pull="${p.person_id}|${p.assignment_id}">Move here</button></div>`).join('')}` : ''}
      <div class="btnrow" style="margin-top:12px">${a.person_id ? '<button class="btn ghost" id="clear">Make this spot open</button><button class="btn bad" id="sick">Sick call for this umpire</button>' : ''}</div>`, (m, close) => {
      m.onclick = async e => {
        const p = e.target.closest('[data-pick]'), pl = e.target.closest('[data-pull]');
        if (p && await C.act(p, () => C.post(`/api/umps/assignments/${a.id}/assign`, { personId: +p.dataset.pick }), 'Assigned. They were notified.')) { close(); CS.route(); }
        if (pl) { const [pid, from] = pl.dataset.pull.split('|'); if (await C.act(pl, () => C.post(`/api/umps/assignments/${a.id}/assign`, { personId: +pid, fromAssignment: +from, force: true }), 'Moved')) { close(); CS.route(); } }
      };
      const cl = m.querySelector('#clear'); if (cl) cl.onclick = async () => { if (await C.act(cl, () => C.post(`/api/umps/assignments/${a.id}/unassign`), 'Spot opened')) { close(); CS.route(); } };
      const sk = m.querySelector('#sick'); if (sk) sk.onclick = async () => { if (await C.act(sk, () => C.post(`/api/umps/assignments/${a.id}/sick`), 'Sick call sent to all qualified umpires')) { close(); CS.route(); } };
    });
  }

  async function roster(out) {
    const list = await C.get('/api/umps/roster');
    const divs = S.meta.divisions.filter(d => d.active);
    out.innerHTML = `<p class="small muted" style="margin-top:0">Set which divisions each umpire can work. The schedule only uses umpires in a game's division.</p>
      <div class="tablewrap"><table><thead><tr><th>Umpire</th><th>Divisions</th><th class="num">This week</th><th class="num">Worked</th><th class="num">No-shows</th><th></th></tr></thead><tbody>
      ${list.map(u => `<tr><td><b>${esc(u.first)} ${esc(u.last)}</b><br><span class="small">${C.telLink(u.phone)}</span></td>
        <td>${u.divisionIds.map(id => `<span class="badge" style="margin:1px">${esc((divs.find(d => d.id === id) || {}).code || '')}</span>`).join('') || '<span class="badge bad">None</span>'}</td>
        <td class="num">${u.thisWeek}</td><td class="num">${u.worked}</td><td class="num">${u.noShows}</td><td><button class="btn ghost small" data-edit="${u.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>`;
    out.onclick = async e => {
      const b = e.target.closest('[data-edit]'); if (!b) return;
      const u = list.find(x => x.id === +b.dataset.edit);
      const av = await C.get(`/api/umps/availability/${u.id}`);
      C.modal(`${u.first} ${u.last}`, `<div class="label">Divisions</div>${divs.map(d => `<label class="check"><input type="checkbox" value="${d.id}" ${u.divisionIds.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}
        <div class="label" style="margin-top:12px">Availability</div><p class="small">${av.length ? av.map(x => `${x.date ? C.dShort(x.date) : C.DOW[x.weekday]} ${x.slot_code}: ${x.available ? 'can' : 'can\'t'}`).join(' · ') : 'Not entered yet'}</p>
        <button class="btn" id="save">Save</button>`, (m, close) => {
        m.querySelector('#save').onclick = async () => {
          const ids = [...m.querySelectorAll('input:checked')].map(i => +i.value);
          if (await C.act(m.querySelector('#save'), () => C.put(`/api/umps/${u.id}/divisions`, { divisionIds: ids }), 'Saved')) { close(); CS.route(); }
        };
      });
    };
  }

  async function payroll(out) {
    if (!st.pstart) { st.pstart = C.addDays(C.mondayOf(C.today()), -7); st.pend = C.addDays(st.pstart, 13); }
    const rows = await C.get(`/api/payroll?start=${st.pstart}&end=${st.pend}`);
    const totals = new Map();
    rows.forEach(r => { const k = `${r.first} ${r.last}`; const t = totals.get(k) || { plate: 0, field: 0, no: 0, un: 0, cents: 0 }; if (r.status === 'present') t[r.worked]++; else if (r.status === 'no_show') t.no++; else t.un++; t.cents += r.cents; totals.set(k, t); });
    const grand = [...totals.values()].reduce((a, t) => a + t.cents, 0);
    const unconfirmed = rows.filter(r => r.status === 'assigned').length;
    out.innerHTML = `<div class="filters"><label class="small">From <input type="date" id="ps" value="${st.pstart}"></label><label class="small">To <input type="date" id="pe" value="${st.pend}"></label>
      <a class="btn" href="/export/payroll.csv?start=${st.pstart}&end=${st.pend}">${C.icon('down')} Payroll CSV for Jackie</a></div>
      ${unconfirmed ? `<p><span class="badge warn">${unconfirmed} games not confirmed yet</span> <span class="small muted">Mark attendance so they're paid.</span></p>` : ''}
      <div class="grid three" style="margin-bottom:12px"><div class="stat"><b>${C.money(grand)}</b><span>Total pay</span></div><div class="stat"><b>${totals.size}</b><span>Umpires</span></div><div class="stat"><b>${rows.filter(r => r.status === 'no_show').length}</b><span>No-shows (unpaid)</span></div></div>
      <div class="tablewrap"><table><thead><tr><th>Umpire</th><th class="num">Plate</th><th class="num">Field</th><th class="num">No-show</th><th class="num">Not confirmed</th><th class="num">Pay</th></tr></thead><tbody>
      ${[...totals].map(([k, t]) => `<tr><td>${esc(k)}</td><td class="num">${t.plate}</td><td class="num">${t.field}</td><td class="num">${t.no}</td><td class="num">${t.un}</td><td class="num"><b>${C.money(t.cents)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No games in this range.</td></tr>'}
      </tbody></table></div><p class="small muted">Rates are set in Admin › Setup. Plate and field pay can differ by division.</p>`;
    out.querySelector('#ps').onchange = e => { st.pstart = e.target.value; CS.route(); };
    out.querySelector('#pe').onchange = e => { st.pend = e.target.value; CS.route(); };
  }
})();
