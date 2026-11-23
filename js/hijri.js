// Hijri dates and the "white days" (الأيام البيض: 13, 14 and 15 of each lunar month).
//
// The Hijri date is CALCULATED (Umm al-Qura calendar, built into the browser). The real month begins with
// the sighting of the moon, which can differ by a day depending on the country — hence `offset`
// (−2 … +2 days), which the user sets so the app matches the local calendar.
// No dependency on the rest of the app: also imported by store.js and ui.js.

let offset = 0;
let partsFmt = null;
let longFmt = null;
try {
  partsFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });
  longFmt = new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
} catch { /* calendar not supported by this browser */ }

export const hijriSupported = () => !!partsFmt;
export function setHijriOffset(n) { offset = Math.max(-2, Math.min(2, parseInt(n, 10) || 0)); }
export const getHijriOffset = () => offset;

function shifted(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  d.setDate(d.getDate() + offset);
  return d;
}

/** { y, m, d } of the Hijri date for a local calendar day (with the user's offset), or null if unsupported. */
export function hijriParts(date = new Date()) {
  if (!partsFmt) return null;
  const out = {};
  for (const p of partsFmt.formatToParts(shifted(date))) {
    if (p.type === 'day') out.d = parseInt(p.value, 10);
    else if (p.type === 'month') out.m = parseInt(p.value, 10);
    else if (p.type === 'year') out.y = parseInt(p.value, 10);
  }
  return out.d && out.m ? out : null;
}

/** "13 جمادى الآخرة 1448 هـ" (with the user's offset), or '' if unsupported. */
export function formatHijriLong(date = new Date()) {
  return longFmt ? longFmt.format(shifted(date)) : '';
}

/**
 * Is this day one of the white days?
 * The 13th of Dhu al-Hijjah is excluded: it is one of the days of Tashriq, on which fasting is not allowed.
 */
export function isBidDay(date = new Date()) {
  const p = hijriParts(date);
  if (!p) return false;
  if (p.m === 12 && p.d === 13) return false;
  return p.d >= 13 && p.d <= 15;
}

/**
 * The coming white days, grouped by lunar month, starting from `from` (inclusive).
 * → [{ monthLabel, year, month, days: [{ date: Date, day: 13|14|15 }] }]
 */
export function upcomingBid(months = 12, from = new Date()) {
  const out = [];
  if (!partsFmt) return out;
  const monthName = new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura-nu-latn', { month: 'long', year: 'numeric' });
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  let cur = null;
  for (let i = 0; i < months * 30 + 20 && out.length <= months; i++) {
    const p = hijriParts(d);
    if (p && p.d >= 13 && p.d <= 15 && !(p.m === 12 && p.d === 13)) {
      const id = p.y * 100 + p.m;
      if (!cur || cur.id !== id) {
        cur = { id, year: p.y, month: p.m, monthLabel: monthName.format(shifted(d)), days: [] };
        out.push(cur);
      }
      cur.days.push({ date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), day: p.d });
    }
    d.setDate(d.getDate() + 1);
  }
  return out.slice(0, months);
}
