// Backup reminder. Everything lives on this device only, so the app reminds the user to download a backup
// file about once a month (once there is something worth losing: a week of recorded days).
import { store, todayKey, parseKey, addDays } from './store.js';
import { downloadText, toast } from './ui.js';

const EVERY = 30;   // days between two reminders
const MIN_DAYS = 7; // recorded days before the first reminder
const SNOOZE = 7;

const daysSince = (key) => Math.round((parseKey(todayKey()) - parseKey(key)) / 86400000);

/** { due, never, days } — days since the last backup (null when there was none). */
export async function backupStatus() {
  const b = store.getBackup();
  const days = b.last ? daysSince(b.last) : null;
  if (b.snooze && b.snooze > todayKey()) return { due: false, never: !b.last, days };
  if (b.last) return { due: days >= EVERY, never: false, days };
  const recorded = (await store.getAllDays()).length;
  return { due: recorded >= MIN_DAYS, never: true, days: null };
}

/** Download the backup file and remember the date. */
export async function exportBackup() {
  const data = await store.exportAll();
  downloadText(`sakina-backup-${todayKey()}.json`, JSON.stringify(data));
  await store.setBackup({ last: todayKey(), snooze: null });
  toast('تم تنزيل النسخة الاحتياطية — احفظها خارج الهاتف (بريدك أو Drive)', { icon: 'download', duration: 4200 });
}

export const snoozeBackup = () => store.setBackup({ snooze: addDays(todayKey(), SNOOZE) });
