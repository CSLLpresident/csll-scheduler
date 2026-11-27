// All dates are league-local (America/Chicago). server.js sets process.env.TZ before loading anything.
const pad = n => String(n).padStart(2, '0');
const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const weekday = s => toDate(s).getDay();
const at = (dateStr, hhmm) => { const d = toDate(dateStr); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const mondayOf = s => { const wd = weekday(s); return addDays(s, wd === 0 ? -6 : 1 - wd); };
const today = () => ymd(new Date());
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
function range(start, end) { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push(d); return out; }
const minutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = mins => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
function fmt12(t) { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; }
function short12(t) { let [h, m] = t.split(':').map(Number); h = h % 12 || 12; return `${h}:${pad(m)}`; }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = s => { const d = toDate(s); return `${DOW_LONG[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; };
const shortDate = s => { const d = toDate(s); return `${DOW[d.getDay()]} ${MON[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };

module.exports = { pad, toDate, ymd, addDays, weekday, at, mondayOf, today, daysBetween, range, minutes, hhmm, fmt12, short12, longDate, shortDate, DOW };
