# CSLL Schedules

The College Station Little League scheduling app. It handles games, practices, scrimmages, field duty and umpires, and works on phones, tablets and computers.

## Try it on your computer (demo data)

You need Node.js 22.5 or newer.

```bash
npm install
npm run seed:demo                         # made-up teams, coaches, board and umpires
DEMO_MODE=true npm start                  # http://localhost:3000
```

To get in, log in as `admin@example.com`. Demo mode shows the login code on screen. You can also log in as any `demoN@example.com` to see the app as a coach, umpire or board member.

`npm test` runs an end-to-end check of every main feature on a throwaway database.

## Put it online for the league

The app is one small Node server with one database file (SQLite). Any host that runs Node and has a **persistent disk** works:

- **Render.com:** create a Web Service from this folder or a GitHub repo. Set the start command to `npm start`, add a 1 GB disk mounted at `/data`, and set `DB_PATH=/data/csll.db`. This costs about $7–8 a month.
- **Railway or Fly.io:** use the included `Dockerfile` and mount a volume at `/data`.

Then set the settings in `.env.example` in the host's dashboard:

1. `ADMIN_EMAIL` and/or `ADMIN_PHONE`: your login. That account becomes the first admin.
2. `APP_URL`: the web address, for example a subdomain like `schedules.collegestationlittleleague.com`.
3. **Text messages:** create a Twilio account, buy a local 979 number, and register it for A2P 10DLC (US carriers require this for app texts). Then fill in `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`.
4. **Email:** fill in any SMTP account in the `SMTP_*` settings. Google Workspace or a free SendGrid/Postmark tier both work.
5. Leave `DEMO_MODE` off.

If you leave the Twilio or SMTP settings blank, the app still works. Messages land in each person's in-app inbox and the server log, but nothing goes out.

## Season setup (in the app)

1. **Admin › Setup:** check the season dates, game nights, divisions (umpire crew, games and practices per week, plate/field pay), fields and blackout dates. These are preloaded for Spring 2027, including the BVCHEA Field 6 dates.
2. **Admin › Import:** add your coaches, board members and umpires from a CSV, and teams/coaches from a Sports Connect export.
3. **Umpires › Roster:** set which divisions each umpire works. Ask everyone to fill in **Availability**.
4. **Admin › Build schedules:** build games, practices, umpires and field duty shifts, review the drafts on **Practice Schedule** and **Game Schedule**, then **Publish and release**.

## How the main rules work

| Area | Rule |
| --- | --- |
| Games | Round robin per division. JM plays only in the early slot, with JM AA and JM AAA at both parks every game night. Int/Jr/Sr play the 7:00 slot on Fields 5–6. Home/away, early/late and parks are balanced. Coaches on two teams never overlap. Board-coached teams are spread out. |
| Practices | Built from the open slots left after games. Coach availability is honored evenly, using a "least-served picks first" rotation. Board-coached teams are spread across slots and parks so someone can open the fields. |
| Extra practices | Coaches can request any open slot. Three days before, the requesting team highest on the priority list gets it and drops to the bottom. Coaches flagged "at risk" are warned. Inside three days, slots are first come, first served. |
| Swaps | Practices swap 1-for-1 once the other coach accepts. Scrimmage invites use the inviting team's practice slot, with no umpires. Umpires post a shift and another qualified umpire accepts it. |
| Umpires | JM gets 2 field umpires (no plate). Other divisions get plate + field (editable). Assignments are auto-filled from availability and division. A sick call alerts all qualified umpires, and also emails the coordinators and President. To cover a game, the JM AA backup is pulled first, then JM AAA. |
| Attendance | Umpires check in on their phone. Board members or coordinators confirm plate/field or no-show. The payroll CSV pays only confirmed games, at plate or field rates. |
| Field duty | Each park has an early shift (15 min before) and a late shift (15 min after) on nights fields are used. Board members coaching a game in that slot can't take it. Practice nights list board members already at that park first. Reminders go out at 72/48/36/24/12/6 h; the 36 h and 12 h reminders wait until 8 AM. They only go to board members without a shift that week. |
| City schedule | Excel in the "CSLL Gameday Field Schedules" layout, with one sheet per park. |
| Calendars | Each person and each team has an .ics subscription link. |

## Files

- `server.js`: web server and API
- `src/engine/`: games, practices, umpires, requests (priority list and swaps), duty, slots
- `src/exports.js`, `src/imports.js`, `src/notify.js`, `src/auth.js`
- `public/`: the app people see (no build step)
