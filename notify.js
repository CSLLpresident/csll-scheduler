// Notifications: every message lands in the in-app inbox, and goes out by text (Twilio) and email (SMTP)
// when those are configured. Without credentials the app runs in "log only" mode and prints to the console.
const nodemailer = require('nodemailer');
const { run, get, all } = require('./db');

const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM = process.env.TWILIO_FROM;            // +1979xxxxxxx or a Messaging Service SID (MG...)
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
const MAIL_FROM = process.env.MAIL_FROM || 'CSLL Schedules <no-reply@collegestationlittleleague.com>';

const smsEnabled = () => Boolean(TW_SID && TW_TOKEN && TW_FROM);
const emailEnabled = () => Boolean(mailer);

function normalizePhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits ? '+' + digits : null;
}

async function sendSms(to, body) {
  const phone = normalizePhone(to);
  if (!phone) return 'no-phone';
  if (!smsEnabled()) { console.log(`[sms:log] ${phone}: ${body}`); return 'logged'; }
  const params = new URLSearchParams({ To: phone, Body: body });
  if (TW_FROM.startsWith('MG')) params.set('MessagingServiceSid', TW_FROM); else params.set('From', TW_FROM);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64') },
    body: params,
  });
  if (!res.ok) { console.error('[sms:error]', res.status, await res.text()); return 'error'; }
  return 'sent';
}

async function sendEmail(to, subject, text) {
  if (!to) return 'no-email';
  if (!emailEnabled()) { console.log(`[email:log] ${to}: ${subject}\n${text}`); return 'logged'; }
  try {
    await mailer.sendMail({ from: MAIL_FROM, to, subject, text: `${text}\n\n${APP_URL}` });
    return 'sent';
  } catch (e) { console.error('[email:error]', e.message); return 'error'; }
}

/**
 * Notify one or more people.
 * opts: { title, body, link, sms: true|false, email: true|false }
 * sms/email default to true and are also limited by each person's own preferences.
 */
async function notify(personIds, opts) {
  const ids = [...new Set([].concat(personIds).filter(Boolean))];
  const results = [];
  for (const id of ids) {
    const p = get('SELECT * FROM people WHERE id=? AND active=1', id);
    if (!p) continue;
    const wantSms = opts.sms !== false && p.notify_sms;
    const wantEmail = opts.email !== false && p.notify_email;
    let smsStatus = null, emailStatus = null;
    try {
      if (wantSms && p.phone) smsStatus = await sendSms(p.phone, `CSLL: ${opts.title}${opts.body ? ' - ' + opts.body : ''}`.slice(0, 600));
      if (wantEmail && p.email) emailStatus = await sendEmail(p.email, `CSLL: ${opts.title}`, opts.body || opts.title);
    } catch (e) { console.error('[notify]', e.message); }
    run('INSERT INTO notifications(person_id,title,body,link,sms_status,email_status) VALUES(?,?,?,?,?,?)',
      id, opts.title, opts.body || '', opts.link || '', smsStatus, emailStatus);
    results.push({ id, smsStatus, emailStatus });
  }
  return results;
}

// Fire-and-forget wrapper for request handlers
function notifyLater(personIds, opts) { notify(personIds, opts).catch(e => console.error('[notify]', e)); }

const peopleWhere = (cond) => all(`SELECT id FROM people WHERE active=1 AND ${cond}`).map(r => r.id);

module.exports = { notify, notifyLater, sendSms, sendEmail, smsEnabled, emailEnabled, normalizePhone, peopleWhere, APP_URL };
