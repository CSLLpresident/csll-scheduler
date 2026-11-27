// Online demo: fresh made-up league on every start, login codes shown on screen.
process.env.TZ = process.env.TZ || 'America/Chicago';
process.env.DEMO_MODE = 'true';
process.env.DEMO_LIVE_DATES = process.env.DEMO_LIVE_DATES || 'true';
const fs = require('fs'), path = require('path');
const db = process.env.DB_PATH || path.join(__dirname, 'data', 'csll.db');
for (const f of [db, db + '-wal', db + '-shm']) { try { fs.unlinkSync(f); } catch { } }
require('./seed-demo.js');
const app = require('./server.js');
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`CSLL Schedules DEMO on port ${PORT}`));
require('./jobs').start();
