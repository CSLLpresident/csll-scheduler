// App shell, router, login, inbox and "My account".
(function () {
  const C = CS, { S, esc, icon } = C;
  const app = document.getElementById('app');

  function navItems() {
    const r = S.me.roles;
    const items = [
      { hash: 'home', label: 'Home', icon: 'home', show: true, bottom: true },
      { hash: 'schedule', label: 'Schedule', icon: 'cal', show: true, bottom: true },
      { hash: 'umpires', label: 'Umpires', icon: 'whistle', show: r.umpire || r.board, bottom: r.umpire && !r.coach },
      { hash: 'duty', label: 'Field Duty', icon: 'key', show: r.board, bottom: r.board },
      { hash: 'availability', label: 'Availability', icon: 'check', show: r.teamScheduler || r.umpire || r.board, bottom: !r.board || !r.umpire },
      { hash: 'admin', label: 'Admin', icon: 'gear', show: r.admin || r.scheduler, bottom: false },
      { hash: 'me', label: 'My account', icon: 'user', show: true, bottom: false },
    ];
    return items.filter(i => i.show);
  }

  function shell() {
    const items = navItems();
    const bottom = items.filter(i => i.bottom).slice(0, 4);
    app.innerHTML = `
      <header class="topbar">
        <a href="#/home" aria-label="Home"><img src="/logo.png" alt="College Station Little League logo"></a>
        <div class="brand"><b>CSLL SCHEDULES</b><span>${esc(S.meta.settings.season_name || '')}</span></div>
        <div class="spacer"></div>
        <a class="iconbtn" href="#/inbox" aria-label="Notifications">${icon('bell')}<span class="dot ${S.me.unread ? '' : 'hidden'}" id="unread">${S.me.unread}</span></a>
      </header>
      <div class="layout">
        <nav class="sidenav" aria-label="Main">${items.map(i => `<a href="#/${i.hash}" data-nav="${i.hash}">${icon(i.icon)}<span>${i.label}</span></a>`).join('')}</nav>
        <main id="page" tabindex="-1"></main>
      </div>
      <nav class="bottomnav" aria-label="Main">${bottom.map(i => `<a href="#/${i.hash}" data-nav="${i.hash}">${icon(i.icon)}<span>${i.label}</span></a>`).join('')}
        <a href="#/more" data-nav="more">${icon('more')}<span>More</span></a></nav>`;
  }

  async function loadSession() {
    try { S.me = await C.get('/api/me'); S.meta = await C.get('/api/meta'); return true; }
    catch { S.me = null; return false; }
  }
  CS.refreshMeta = async () => { S.meta = await C.get('/api/meta'); };

  // ---------- login ----------
  function loginPage() {
    app.innerHTML = `<div class="login"><img class="wm" src="/logo.png" alt="">
      <div class="box">
        <img class="logo" src="/logo.png" alt="College Station Little League logo">
        <div class="label">College Station Little League</div>
        <h1>SCHEDULES</h1>
        <p class="muted">Games, practices, field duty and umpires in one place.</p>
        <form id="f1" class="card" style="margin-top:18px">
          <div class="field"><label for="ident">Phone number or email</label>
            <input id="ident" type="text" inputmode="email" autocomplete="username" placeholder="(979) 555-0123 or you@example.com" required></div>
          <button class="btn" style="width:100%">Send me a code</button>
          <p class="small muted" style="margin:10px 0 0">We'll text or email you a 6-digit code. No password needed.</p>
        </form>
        <form id="f2" class="card hidden" style="margin-top:18px">
          <div id="demo"></div>
          <div class="field"><label for="code">Enter the 6-digit code</label>
            <input id="code" class="codebox" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>
          <button class="btn" style="width:100%">Log in</button>
          <button type="button" class="btn ghost" id="back" style="width:100%;margin-top:8px">Use a different phone or email</button>
        </form>
      </div><div class="foot"></div></div>`;
    const f1 = app.querySelector('#f1'), f2 = app.querySelector('#f2');
    fetch('/api/demo/accounts').then(r => r.ok ? r.json() : []).then(list => {
      if (!list.length) return;
      const box = document.createElement('div');
      box.className = 'card'; box.style.marginTop = '12px';
      box.innerHTML = `<div class="label" style="margin-bottom:6px">Demo: try the app as</div>` + list.map(a => `<button type="button" class="btn ghost small" style="margin:3px" data-demo="${esc(a.email)}">${esc(a.label)}</button>`).join('') +
        '<p class="small muted" style="margin:8px 0 0">Made-up league. Changes reset when the demo restarts.</p>';
      f1.after(box);
      box.onclick = e => { const b = e.target.closest('[data-demo]'); if (!b) return; app.querySelector('#ident').value = b.dataset.demo; f1.requestSubmit(); };
    }).catch(() => {});
    let ident = '';
    f1.onsubmit = async e => {
      e.preventDefault(); ident = app.querySelector('#ident').value.trim();
      const r = await C.act(f1.querySelector('button'), () => C.post('/api/auth/request', { identifier: ident }));
      if (!r) return;
      f1.classList.add('hidden'); f2.classList.remove('hidden');
      app.querySelector('#demo').innerHTML = r.demoCode ? `<div class="demo">Demo mode: your code is <b>${r.demoCode}</b></div>` :
        `<p class="small muted">If ${esc(ident)} is on the league roster, a code is on its way by ${r.via}.</p>`;
      app.querySelector('#code').focus();
    };
    f2.onsubmit = async e => {
      e.preventDefault();
      const ok = await C.act(f2.querySelector('button'), () => C.post('/api/auth/verify', { identifier: ident, code: app.querySelector('#code').value }));
      if (ok) { await loadSession(); location.hash = '#/home'; route(); }
    };
    app.querySelector('#back').onclick = () => { f2.classList.add('hidden'); f1.classList.remove('hidden'); };
  }

  // ---------- small pages ----------
  CS.S.pages.more = async el => {
    el.innerHTML = `<div class="pagehead"><h1>More</h1></div>` + navItems().map(i => `<a class="item click" href="#/${i.hash}" style="text-decoration:none;color:inherit;align-items:center">
      <span style="width:22px;color:var(--maroon)">${icon(i.icon)}</span><div class="main"><div class="title">${i.label}</div></div>${icon('right')}</a>`).join('');
  };

  CS.S.pages.inbox = async el => {
    const list = await C.get('/api/inbox');
    el.innerHTML = `<div class="pagehead"><div><h1>Notifications</h1><div class="sub">Everything we've texted or emailed you shows here too.</div></div></div>
      ${list.length ? list.map(n => `<div class="item"><div class="main"><div class="title">${esc(n.title)} ${n.read_at ? '' : '<span class="badge maroon">New</span>'}</div>
        <div class="meta">${esc(n.body)}</div><div class="small muted" style="margin-top:4px">${esc(n.created_at)} UTC</div></div>
        ${n.link ? `<a class="btn ghost small" href="${esc(n.link)}">Open</a>` : ''}</div>`).join('') : '<div class="empty">No notifications yet.</div>'}`;
    await C.post('/api/inbox/read');
    S.me.unread = 0; const d = document.getElementById('unread'); if (d) d.classList.add('hidden');
  };

  CS.S.pages.me = async el => {
    const p = S.me.person, r = S.me.roles;
    const roles = [r.admin && 'Admin', r.president && 'President', r.board && 'Board', r.umpCoord && 'Umpire coordinator', r.umpire && 'Umpire', r.coach && 'Coach'].filter(Boolean);
    const calUrl = `${location.origin}/cal/me/${p.cal_token}.ics`;
    el.innerHTML = `<div class="pagehead"><div><h1>${esc(p.first)} ${esc(p.last)}</h1><div class="sub">${roles.map(x => `<span class="badge">${x}</span>`).join(' ')}</div></div></div>
      <div class="grid two">
        <div class="card"><h3>Contact</h3><p class="muted small">You log in with these. Ask an admin to change them.</p>
          <p>${C.telLink(p.phone) || '<span class="muted">No phone</span>'}<br>${esc(p.email || 'No email')}</p></div>
        <div class="card"><h3>How we reach you</h3>
          <label class="check"><input type="checkbox" id="nsms" ${p.notify_sms ? 'checked' : ''}> Text messages</label>
          <label class="check"><input type="checkbox" id="nem" ${p.notify_email ? 'checked' : ''}> Email</label>
          <p class="small muted">Login codes are always sent.</p></div>
        <div class="card"><h3>Add my schedule to my calendar</h3><p class="small muted">Your teams' games and practices, umpire games and field duty. Paste this link into Google, Apple or Outlook calendar as a subscription.</p>
          <input type="text" readonly value="${esc(calUrl)}" onclick="this.select()"><div class="btnrow" style="margin-top:8px"><button class="btn ghost small" id="copy">Copy link</button>
          <a class="btn ghost small" href="${esc(calUrl.replace(/^https?/, 'webcal'))}">Open in calendar app</a></div></div>
        ${r.coachTeams.length ? `<div class="card"><h3>My teams</h3>${r.coachTeams.map(t => `<div class="item"><div class="main"><div class="title">${esc(t.name)}</div><div class="meta">${esc(t.division_name)} · ${t.role === 'head' ? 'Head coach' : t.role === 'practice' ? 'Practice coach' : 'Assistant coach'}</div></div>
          <button class="btn ghost small" data-cal="${t.id}">Team calendar link</button></div>`).join('')}</div>` : ''}
      </div>
      <div class="btnrow" style="margin-top:16px"><button class="btn ghost" id="logout">Log out</button></div>`;
    const save = () => C.patch('/api/me', { notify_sms: el.querySelector('#nsms').checked, notify_email: el.querySelector('#nem').checked }).then(() => C.toast('Saved')).catch(C.fail);
    el.querySelector('#nsms').onchange = save; el.querySelector('#nem').onchange = save;
    el.querySelector('#copy').onclick = () => navigator.clipboard.writeText(calUrl).then(() => C.toast('Link copied'));
    el.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => { const u = `${location.origin}/cal/team/${b.dataset.cal}.ics`; navigator.clipboard.writeText(u).then(() => C.toast('Team calendar link copied')).catch(() => prompt('Copy this link', u)); });
    el.querySelector('#logout').onclick = async () => { await C.post('/api/auth/logout'); S.me = null; location.hash = '#/login'; route(); };
  };

  // ---------- router ----------
  async function route() {
    const hash = (location.hash || '#/home').replace(/^#\/?/, '');
    const [name, ...rest] = hash.split('/');
    if (name === 'login' || !S.me) { if (!S.me && !(await loadSession())) return loginPage(); if (name === 'login') { location.hash = '#/home'; return; } }
    if (!document.getElementById('page')) shell();
    const page = document.getElementById('page');
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
    const fn = S.pages[name] || S.pages.home;
    page.innerHTML = '<div class="spinner" aria-label="Loading"></div>';
    window.scrollTo(0, 0);
    try { await fn(page, rest); } catch (e) { page.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  CS.route = route;
  window.addEventListener('hashchange', route);
  route();
})();
