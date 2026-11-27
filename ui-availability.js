// Availability for coaches (practice times), umpires (game slots) and board members (field duty shifts).
(function () {
  const C = CS, { S, esc } = C;
  let kind = null;
  const CONFIG = {
    coach: { label: 'Coach', dates: 'Dates you can\'t coach', intro: 'When can your team practice? Tap a box: blank = no preference, ✓ = works, ✕ = can\'t. Requests are honored evenly across coaches.',
      days: [1, 2, 4, 5, 6], slots: [['early', 'Early 5:45'], ['late', 'Late 7:30']] },
    umpire: { label: 'Umpire', dates: 'Dates you can\'t umpire', intro: 'When can you umpire? No games on Wednesdays or Sundays. Tap a box: blank = no preference, ✓ = can work, ✕ = can\'t.',
      days: [1, 2, 4, 5, 6], slots: [['early', 'Early'], ['late', 'Late'], ['seven', '7:00 PM']] },
    board: { label: 'Field duty', dates: 'Dates you can\'t work field duty', intro: 'When can you open or close the fields? Example: "no early shifts except Fridays" = ✕ on Mon/Tue/Thu early, ✓ on Fri early.',
      days: [1, 2, 4, 5, 6], slots: [['early', 'Early shift'], ['late', 'Late shift']] },
  };

  CS.S.pages.availability = async el => {
    const r = S.me.roles;
    const kinds = [r.teamScheduler && 'coach', r.umpire && 'umpire', r.board && 'board'].filter(Boolean);
    if (!kinds.length) { el.innerHTML = '<div class="empty">Nothing to set here for your role.</div>'; return; }
    if (!kind || !kinds.includes(kind)) kind = kinds[0];
    const cfg = CONFIG[kind];
    const rules = await C.get(`/api/availability?kind=${kind}`);
    const weekly = {}; rules.filter(x => x.date == null).forEach(x => { weekly[`${x.weekday}|${x.slot_code}`] = x.available; });
    let dated = rules.filter(x => x.date).map(x => ({ date: x.date, slot_code: x.slot_code, available: x.available, note: x.note || '' }));

    el.innerHTML = `<div class="pagehead"><div><h1>Availability</h1><div class="sub">${esc(cfg.intro)}</div></div></div>
      ${kinds.length > 1 ? `<div class="tabs">${kinds.map(k => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${CONFIG[k].label}</button>`).join('')}</div>` : `<div class="label" style="margin-bottom:10px">${CONFIG[kind].label} availability</div>`}
      <div class="card"><h3>Every week</h3>
        <div class="avgrid" style="--cols:${cfg.slots.length};margin-top:10px">
          <div></div>${cfg.slots.map(s => `<div class="h">${s[1]}</div>`).join('')}
          ${cfg.days.map(d => `<div class="d">${C.DOW[d]}</div>${cfg.slots.map(([code]) => {
            if (d === 6 && kind !== 'board' && code !== 'early') return '<div></div>';
            const v = weekly[`${d}|${code}`]; const val = v === undefined ? '' : String(v);
            return `<button class="avcell" data-cell="${d}|${code}" data-v="${val}" aria-label="${C.DOW[d]} ${code}">${val === '1' ? '✓' : val === '0' ? '✕' : ''}</button>`;
          }).join('')}`).join('')}
        </div>${kind !== 'board' ? '<p class="small muted" style="margin-bottom:0">Saturday = morning practices.</p>' : ''}</div>
      <div class="card"><h3>${cfg.dates}</h3><p class="small muted">Vacations, work, family events. These override the weekly pattern.</p>
        <div id="dates"></div>
        <div class="filters" style="align-items:flex-end;margin:8px 0 0">
          <div class="field" style="margin:0;flex:1 1 140px"><label>Date</label><input type="date" id="ddate" min="${C.today()}"></div>
          <div class="field" style="margin:0;flex:1 1 140px"><label>Time</label><select id="dslot"><option value="any">All day</option>${cfg.slots.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('')}</select></div>
          <div class="field" style="margin:0;flex:2 1 180px"><label>Note (optional)</label><input type="text" id="dnote" placeholder="Out of town"></div>
          <button class="btn ghost" id="addd">Add date</button></div></div>
      <div class="btnrow" style="margin-top:14px"><button class="btn" id="save">Save availability</button></div>`;

    const drawDates = () => {
      el.querySelector('#dates').innerHTML = dated.length ? dated.sort((a, b) => a.date.localeCompare(b.date)).map((x, i) => `<div class="item"><div class="main"><div class="title">${C.dLong(x.date)}</div>
        <div class="meta">${x.slot_code === 'any' ? 'All day' : esc((cfg.slots.find(s => s[0] === x.slot_code) || [, x.slot_code])[1])}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
        <button class="btn ghost small" data-rm="${i}">Remove</button></div>`).join('') : '<p class="muted small">None added.</p>';
    };
    drawDates();
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; CS.route(); });
    el.querySelectorAll('.avcell').forEach(b => b.onclick = () => {
      const next = { '': '1', '1': '0', '0': '' }[b.dataset.v];
      b.dataset.v = next; b.textContent = next === '1' ? '✓' : next === '0' ? '✕' : '';
    });
    el.querySelector('#addd').onclick = () => {
      const date = el.querySelector('#ddate').value; if (!date) return C.toast('Pick a date', true);
      dated.push({ date, slot_code: el.querySelector('#dslot').value, available: 0, note: el.querySelector('#dnote').value });
      el.querySelector('#dnote').value = ''; drawDates();
    };
    el.querySelector('#dates').onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { dated.splice(+b.dataset.rm, 1); drawDates(); } };
    el.querySelector('#save').onclick = async () => {
      const out = [];
      el.querySelectorAll('.avcell').forEach(b => { if (b.dataset.v !== '') { const [d, code] = b.dataset.cell.split('|'); out.push({ weekday: +d, slot_code: code, available: +b.dataset.v }); } });
      dated.forEach(x => out.push(x));
      await C.act(el.querySelector('#save'), () => C.put('/api/availability', { kind, rules: out }), 'Availability saved');
    };
  };
})();
