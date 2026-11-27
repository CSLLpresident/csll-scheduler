// Background jobs, run every few minutes by the server:
//  - award extra-practice requests that reached their 3-day deadline
//  - refresh field duty shifts and send field duty reminders
const T = require('./time');
const { processDeadlines } = require('./engine-requests');
const { rebuildShifts, sendReminders } = require('./engine-duty');

let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    const r = processDeadlines();
    if (r.awarded || r.lost) console.log(`[jobs] practice requests: ${r.awarded} awarded, ${r.lost} lost`);
    rebuildShifts(T.today(), T.addDays(T.today(), 21));
    const sent = await sendReminders();
    if (sent) console.log(`[jobs] field duty reminders sent to ${sent} people`);
  } catch (e) { console.error('[jobs]', e); }
  finally { running = false; }
}

function start(intervalMs = 5 * 60 * 1000) {
  setTimeout(tick, 5000);
  return setInterval(tick, intervalMs);
}

module.exports = { start, tick };
