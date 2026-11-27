// Core helpers shared by every page.
window.CS = (function () {
  const S = { me: null, meta: null, pages: {} };

  async function api(method, url, body) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !url.startsWith('/api/auth')) { S.me = null; location.hash = '#/login'; throw new Error('Please log in.'); }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
    return data;
  }
  const get = url => api('GET', url);
  const post = (url, b) => api('POST', url, b || {});
  const put = (url, b) => api('PUT', url, b || {});
  const patch = (url, b) => api('PATCH', url, b || {});
  const del = url => api('DELETE', url);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => ymd(new Date());
  const mondayOf = s => { const wd = toDate(s).getDay(); return addDays(s, wd === 0 ? -6 : 1 - wd); };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const t12 = t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
  const t12s = t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); h = h % 12 || 12; return `${h}:${pad(m)}`; };
  const dShort = s => { const d = toDate(s); return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; };
  const dLong = s => { const d = toDate(s); return `${DOWL[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; };
  const dtShort = iso => { const d = new Date(iso); return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}, ${t12(pad(d.getHours()) + ':' + pad(d.getMinutes()))}`; };
  const money = c => '$' + (Number(c || 0) / 100).toFixed(2);
  const relDay = s => { const n = Math.round((toDate(s) - toDate(today())) / 86400000); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : dShort(s); };

  function toast(msg, isErr) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), isErr ? 4500 : 2600);
  }
  const fail = e => toast(e.message || String(e), true);

  // Run an async action from a button, with a busy state and error toast
  async function act(btn, fn, okMsg) {
    if (btn) btn.disabled = true;
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { fail(e); }
    finally { if (btn) btn.disabled = false; }
  }

  function modal(title, html, onMount) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="mhead"><h3>${esc(title)}</h3><button class="iconbtn" data-close aria-label="Close" style="color:var(--ink)">${icon('x')}</button></div>
      <div class="mbody">${html}</div></div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    if (onMount) onMount(ov.querySelector('.mbody'), close);
    const f = ov.querySelector('input,select,textarea,button:not([data-close])'); if (f) f.focus();
    return close;
  }
  function confirmBox(title, text, yesLabel = 'Yes') {
    return new Promise(resolve => {
      let done = false, ov = null;
      modal(title, `<p>${esc(text)}</p><div class="btnrow"><button class="btn" data-yes>${esc(yesLabel)}</button><button class="btn ghost" data-close>Cancel</button></div>`, (el, cl) => {
        ov = el.closest('.overlay');
        el.querySelector('[data-yes]').onclick = () => { done = true; cl(); resolve(true); };
      });
      const obs = new MutationObserver(() => { if (!document.body.contains(ov)) { obs.disconnect(); if (!done) resolve(false); } });
      obs.observe(document.body, { childList: true });
    });
  }

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    bat: '<path d="M14 4l6 6-9.5 9.5a2 2 0 0 1-2.8 0L4.5 16.3a2 2 0 0 1 0-2.8z"/><circle cx="5" cy="19" r="1.6"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    whistle: '<circle cx="9" cy="14" r="6"/><path d="M13 10l8-4v4l-6 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    down: '<path d="M12 4v12M6 11l6 6 6-6M5 20h14"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
    up: '<path d="M6 15l6-6 6 6"/>', dn: '<path d="M6 9l6 6 6-6"/>',
  };
  const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  // Event helpers
  function eventTitle(e) {
    if (e.type === 'practice') return `${e.team_name || 'Practice'} practice`;
    if (e.type === 'scrimmage') return `Scrimmage: ${e.home_name} vs ${e.away_name}`;
    if (e.type === 'game') return `${e.away_name} at ${e.home_name}`;
    return e.title || 'Event';
  }
  const typeBadge = e => e.type === 'game' ? '<span class="badge maroon">Game</span>' : e.type === 'scrimmage' ? '<span class="badge warn">Scrimmage</span>' : e.type === 'practice' ? '<span class="badge">Practice</span>' : `<span class="badge outline">${esc(e.type)}</span>`;
  const statusBadge = e => e.status === 'rainout' ? '<span class="badge bad">Rained out</span>' : e.status === 'cancelled' ? '<span class="badge bad">Cancelled</span>' : (e.published === 0 ? '<span class="badge warn">Draft</span>' : '');
  function eventItem(e, opts = {}) {
    const umps = e.type === 'game' && e.ump_slots && opts.showUmps ? (e.ump_filled < e.ump_slots ? `<span class="badge bad">Umps ${e.ump_filled}/${e.ump_slots}</span>` : `<span class="badge ok">Umps ${e.ump_filled}/${e.ump_slots}</span>`) : '';
    return `<div class="item ${opts.click ? 'click' : ''}" data-event="${e.id}">
      <div class="bar" style="background:${esc(e.division_color || '#5C1118')}"></div>
      <div class="time">${t12s(e.start)}<small>${opts.showDate ? relDay(e.date) : 'to ' + t12s(e.end)}</small></div>
      <div class="main"><div class="title">${esc(eventTitle(e))}</div>
        <div class="meta">${esc(e.division_name || '')} · ${esc(e.park_short || '')} ${esc(e.field_name || '')}${opts.showUmps && e.umpires ? ' · ' + esc(e.umpires) : ''}</div></div>
      <div class="side">${typeBadge(e)}${statusBadge(e)}${umps}</div></div>`;
  }
  function groupByDate(list, render) {
    let out = '', last = null;
    for (const x of list) {
      if (x.date !== last) { out += `<div class="daygroup"><b>${dLong(x.date)}</b><span>${relDay(x.date) === dShort(x.date) ? '' : relDay(x.date)}</span></div>`; last = x.date; }
      out += render(x);
    }
    return out;
  }
  function weekNav(id, start) {
    const end = addDays(start, 6);
    return `<div class="weeknav" id="${id}"><button class="btn ghost small" data-wk="-7" aria-label="Previous week">${icon('left')}</button>
      <b>${MON[toDate(start).getMonth()]} ${toDate(start).getDate()} – ${MON[toDate(end).getMonth()]} ${toDate(end).getDate()}</b>
      <button class="btn ghost small" data-wk="7" aria-label="Next week">${icon('right')}</button>
      <button class="btn ghost small" data-wk="0">This week</button></div>`;
  }
  const divisionOptions = (sel, all = 'All divisions') => `<option value="">${all}</option>` + S.meta.divisions.filter(d => d.active).map(d => `<option value="${d.id}" ${+sel === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  const teamOptions = (sel, divId, all = 'All teams') => `<option value="">${all}</option>` + S.meta.teams.filter(t => !divId || t.division_id === +divId).map(t => `<option value="${t.id}" ${+sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const parkOptions = (sel) => '<option value="">Both parks</option>' + S.meta.parks.map(p => `<option value="${p.id}" ${+sel === p.id ? 'selected' : ''}>${esc(p.short)}</option>`).join('');
  const fieldName = id => { const f = S.meta.fields.find(f => f.id === id); return f ? `${f.park_short} ${f.name}` : ''; };
  const personName = p => p ? `${p.first} ${p.last}` : '';
  const telLink = p => p ? `<a href="tel:${esc(p)}">${esc(p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3'))}</a>` : '';

  function download(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }

  return { S, api, get, post, put, patch, del, esc, pad, toDate, ymd, addDays, today, mondayOf, DOW, DOWL, MON, t12, t12s, dShort, dLong, dtShort, relDay, money,
    toast, fail, act, modal, confirmBox, icon, eventTitle, eventItem, typeBadge, statusBadge, groupByDate, weekNav, divisionOptions, teamOptions, parkOptions,
    fieldName, personName, telLink, download };
})();
