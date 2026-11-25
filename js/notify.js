// White-days reminders.
//
// An offline web app has no server to push from, so there are three layers, from most to least reliable:
//   1. calendar export (.ics with alarms)  → the phone's own calendar rings, even if the app is never opened;
//   2. periodic background sync            → installed app on Chrome/Android only; the service worker checks about once a day;
//   3. a check every time the app is opened.
// Layers 2 and 3 show at most one notification per day (same logic as `bidMessage` in sw.js).
import { store, todayKey } from './store.js';
import { hijriParts, isBidDay, upcomingBid } from './hijri.js';
import { PRAYERS, prayerConfig, hasLocation, prayerTimes, nextPrayer, formatTime } from './prayer.js';

export const notifySupported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported');

/** What there is to say today, or null. Evening before each white day, and on the day itself. */
export function bidMessage(now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const today = isBidDay(now);
  if (isBidDay(tomorrow) && now.getHours() >= 15) {
    const p = hijriParts(tomorrow);
    return { title: 'غدًا من الأيام البيض', body: `غدًا يوم ${p.d} من الشهر الهجري. انوِ الصيام ولا تنسَ السحور.`, slot: 'eve' };
  }
  if (today) {
    const p = hijriParts(now);
    return { title: 'اليوم من الأيام البيض', body: `اليوم ${p.d} من الشهر الهجري — يوم صيام.`, slot: 'day' };
  }
  return null;
}

/** Ask for permission and switch reminders on. Returns true when notifications are allowed. */
export async function enableNotifications() {
  if (!notifySupported()) return false;
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  await store.setSettings({ notify: true });
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state === 'granted') await reg.periodicSync.register('bid-reminder', { minInterval: 12 * 60 * 60 * 1000 });
    }
  } catch { /* not available: the check at app start still works */ }
  return true;
}
export async function disableNotifications() {
  await store.setSettings({ notify: false });
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.unregister('bid-reminder');
  } catch { /* ignore */ }
}

/** Called when the app starts / comes back to the foreground. */
export async function checkReminder() {
  try {
    if (!store.getSettings().notify || notifyPermission() !== 'granted') return;
    const msg = bidMessage();
    if (!msg) return;
    const stamp = `${todayKey()}:${msg.slot}`;
    if (localStorage.getItem('sakina-notified') === stamp) return;
    localStorage.setItem('sakina-notified', stamp);
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(msg.title, {
      body: msg.body, tag: 'bid-reminder', lang: 'ar', dir: 'rtl',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/bid' },
    });
  } catch (e) { console.warn('reminder failed', e); }
}

/* ───────────── prayer reminders ───────────── */
// A web app cannot schedule a notification for later while it is closed (no server, no alarm API). So:
//   - while the app is open or alive in the background, a timer fires `lead` minutes before the next prayer;
//   - when the app is opened inside that window, the reminder is shown at once;
//   - for a guaranteed alarm with the app closed: the calendar export below.

export async function askNotifyPermission() {
  if (!notifySupported()) return false;
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  return perm === 'granted';
}

let prayerTimer = null;
async function showPrayerReminder(p) {
  const stamp = `${todayKey()}:${p.id}`;
  try {
    if (localStorage.getItem('sakina-prayer-notified') === stamp) return;
    localStorage.setItem('sakina-prayer-notified', stamp);
    const mins = Math.max(0, Math.ceil((p.time - Date.now()) / 60000));
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(`صلاة ${p.label} ${formatTime(p.time)}`, {
      body: mins > 0 ? `بقيت ${mins} د على صلاة ${p.label}.` : `حان وقت صلاة ${p.label}.`,
      tag: 'prayer-reminder', renotify: true, lang: 'ar', dir: 'rtl',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/prayer' },
    });
  } catch (e) { console.warn('prayer reminder failed', e); }
}

/** (Re)arm the timer for the next prayer. Called at start, when the app comes back, and when settings change. */
export function schedulePrayerReminders() {
  clearTimeout(prayerTimer);
  prayerTimer = null;
  const cfg = prayerConfig();
  if (!cfg.notify || !hasLocation(cfg) || notifyPermission() !== 'granted') return;
  const now = new Date();
  const p = nextPrayer(now, cfg);
  if (!p) return;
  const wait = p.time - now - cfg.lead * 60000;
  if (wait <= 0) {
    showPrayerReminder(p);
    prayerTimer = setTimeout(schedulePrayerReminders, p.time - now + 1000); // then arm the following prayer
  } else {
    // timers drift while a phone sleeps: re-check at least every 10 minutes
    prayerTimer = setTimeout(schedulePrayerReminders, Math.min(wait, 600000));
  }
}

/** An .ics file with the five prayers of the coming `days` days, each with an alarm `lead` minutes before. */
export function buildPrayerCalendar(days = 30) {
  const cfg = prayerConfig();
  const now = new Date();
  const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sakina//Mawaqit as-Salat//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:مواقيت الصلاة'];
  let count = 0;
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const t = prayerTimes(day, cfg) || {};
    for (const p of PRAYERS) {
      const at = t[p.id];
      if (p.info || !at || at <= now) continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:sakina-prayer-${ymd(day)}-${p.id}@sakina`,
        `DTSTAMP:${utc(now)}`,
        `DTSTART:${utc(at)}`,
        `DTEND:${utc(new Date(at.getTime() + 15 * 60000))}`,
        `SUMMARY:صلاة ${p.label}`,
        `DESCRIPTION:من تطبيق سَكينة (${cfg.name}). توقيت محسوب.`,
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:صلاة ${p.label} بعد ${cfg.lead} دقائق`, `TRIGGER:-PT${cfg.lead}M`, 'END:VALARM',
        'END:VEVENT',
      );
      count++;
    }
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n') + '\r\n', count };
}

/* ───────────── calendar export ───────────── */

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }

/**
 * An .ics file with one all-day event per white day for the coming `months` lunar months.
 * Each event has an alarm at 20:00 the evening before (to intend the fast and plan suhoor).
 */
export function buildBidCalendar(months = 12) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sakina//Ayyam al-Bid//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:الأيام البيض'];
  let count = 0;
  for (const g of upcomingBid(months)) {
    for (const { date, day } of g.days) {
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      lines.push(
        'BEGIN:VEVENT',
        `UID:sakina-bid-${ymd(date)}@sakina`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(date)}`,
        `DTEND;VALUE=DATE:${ymd(next)}`,
        `SUMMARY:صيام الأيام البيض (${day} ${g.monthLabel})`,
        'DESCRIPTION:تذكير من تطبيق سَكينة. التاريخ الهجري محسوب وقد يختلف يومًا عن رؤية الهلال.',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:غدًا من الأيام البيض — انوِ الصيام', 'TRIGGER:-PT4H', 'END:VALARM',
        'END:VEVENT',
      );
      count++;
    }
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n') + '\r\n', count };
}
