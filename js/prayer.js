// Prayer times — computed on the device from the sun's position (no connection needed).
//
// Standard astronomical method: the sun's declination and the equation of time give solar noon; each prayer is
// the moment the sun reaches a given angle (Fajr / Isha: below the horizon, sunrise / Maghrib: 0.833° below,
// Asr: shadow = object length × 1 (or × 2, Hanafi) + noon shadow).
// These are CALCULATED times: they can differ by a minute or two from the official timetable of a country,
// which is why every prayer has a manual adjustment in minutes (settings.prayer.adj).
import { store } from './store.js';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const fix = (a, n) => ((a % n) + n) % n;

/** Methods: Fajr / Isha angles (degrees below the horizon), or Isha as minutes after Maghrib; `adj` = minutes. */
export const METHODS = {
  morocco: { label: 'المغرب (وزارة الأوقاف)', fajr: 19, isha: 17, adj: { dhuhr: 5, maghrib: 5 } },
  mwl: { label: 'رابطة العالم الإسلامي', fajr: 18, isha: 17 },
  egypt: { label: 'الهيئة المصرية العامة للمساحة', fajr: 19.5, isha: 17.5 },
  makkah: { label: 'أم القرى (مكة المكرمة)', fajr: 18.5, ishaMin: 90 },
  karachi: { label: 'جامعة العلوم الإسلامية بكراتشي', fajr: 18, isha: 18 },
  isna: { label: 'أمريكا الشمالية (ISNA)', fajr: 15, isha: 15 },
};

export const PRAYERS = [
  { id: 'fajr', label: 'الفجر' },
  { id: 'sunrise', label: 'الشروق', info: true },
  { id: 'dhuhr', label: 'الظهر' },
  { id: 'asr', label: 'العصر' },
  { id: 'maghrib', label: 'المغرب' },
  { id: 'isha', label: 'العشاء' },
];

export const DEFAULT_PRAYER = { lat: null, lng: null, name: '', method: 'morocco', asr: 1, adj: {}, notify: false, lead: 5 };

/** Cities offered in the location sheet (approximate coordinates of the city centre). */
export const CITIES = [
  ['الدار البيضاء', 33.5731, -7.5898], ['الرباط', 34.0209, -6.8416], ['سلا', 34.0531, -6.7985], ['فاس', 34.0331, -5.0003],
  ['مراكش', 31.6295, -7.9811], ['طنجة', 35.7595, -5.834], ['أكادير', 30.4278, -9.5981], ['مكناس', 33.8935, -5.5473],
  ['وجدة', 34.6814, -1.9086], ['القنيطرة', 34.261, -6.5802], ['تطوان', 35.5889, -5.3626], ['الناظور', 35.1681, -2.9335],
  ['آسفي', 32.2994, -9.2372], ['الجديدة', 33.2316, -8.5007], ['بني ملال', 32.3373, -6.3498], ['المحمدية', 33.6866, -7.383],
  ['خريبكة', 32.8811, -6.9063], ['سطات', 33.001, -7.6166], ['تازة', 34.21, -4.01], ['الحسيمة', 35.2517, -3.9372],
  ['العرائش', 35.1932, -6.1557], ['الصويرة', 31.5085, -9.7595], ['ورزازات', 30.9189, -6.8934], ['الرشيدية', 31.9314, -4.4244],
  ['تزنيت', 29.6974, -9.7316], ['كلميم', 28.987, -10.0574], ['العيون', 27.1253, -13.1625], ['الداخلة', 23.6848, -15.957],
];

/** Sun declination (degrees) and equation of time (hours) for a Julian date. */
function sun(jd) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360);
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g)), 360);
  const e = 23.439 - 0.00000036 * D;
  const ra = fix(deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15, 24);
  const decl = deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L))));
  let eqt = q / 15 - ra;
  if (eqt > 12) eqt -= 24; else if (eqt < -12) eqt += 24;
  return { decl, eqt };
}

/**
 * Times of one local calendar day. → { fajr, sunrise, dhuhr, asr, maghrib, isha } as Date objects
 * (a prayer is null where the sun never reaches its angle that day, at very high latitudes).
 */
export function prayerTimes(date, cfg) {
  const { lat, lng } = cfg;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const m = METHODS[cfg.method] || METHODS.morocco;
  const base = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const jd0 = base / 86400000 + 2440587.5;

  const noonAt = (h) => 12 - sun(jd0 + h / 24).eqt - lng / 15;       // UTC hours
  // hour angle (hours) at which the sun's altitude is `alt` degrees
  const hourAngle = (alt, h) => {
    const d = sun(jd0 + h / 24).decl;
    const c = (Math.sin(rad(alt)) - Math.sin(rad(d)) * Math.sin(rad(lat))) / (Math.cos(rad(d)) * Math.cos(rad(lat)));
    return c < -1 || c > 1 ? NaN : deg(Math.acos(c)) / 15;
  };
  const asrAlt = (h) => {
    const d = sun(jd0 + h / 24).decl;
    return deg(Math.atan(1 / ((cfg.asr === 2 ? 2 : 1) + Math.tan(rad(Math.abs(lat - d))))));
  };
  // refine each time with the sun's position at that very time
  const solve = (guess, fn) => { let h = guess; for (let i = 0; i < 3; i++) h = fn(h); return h; };

  const t = {
    fajr: solve(5, (h) => noonAt(h) - hourAngle(-m.fajr, h)),
    sunrise: solve(6, (h) => noonAt(h) - hourAngle(-0.833, h)),
    dhuhr: solve(12, (h) => noonAt(h)),
    asr: solve(15, (h) => noonAt(h) + hourAngle(asrAlt(h), h)),
    maghrib: solve(18, (h) => noonAt(h) + hourAngle(-0.833, h)),
  };
  t.isha = m.ishaMin ? t.maghrib + m.ishaMin / 60 : solve(20, (h) => noonAt(h) + hourAngle(-m.isha, h));

  const out = {};
  for (const p of PRAYERS) {
    const h = t[p.id];
    const adj = ((m.adj && m.adj[p.id]) || 0) + (Number(cfg.adj && cfg.adj[p.id]) || 0);
    // rounded to the minute: up for prayers (never before their time), down for sunrise (end of Fajr)
    const ms = base + h * 3600000;
    out[p.id] = Number.isFinite(h)
      ? new Date((p.id === 'sunrise' ? Math.floor(ms / 60000) : Math.ceil(ms / 60000)) * 60000 + adj * 60000)
      : null;
  }
  return out;
}

/* ───────────── helpers bound to the user's settings ───────────── */

export function prayerConfig() {
  const p = store.getSettings().prayer || {};
  return { ...DEFAULT_PRAYER, ...p, adj: { ...(p.adj || {}) } };
}
export const hasLocation = (cfg = prayerConfig()) => Number.isFinite(cfg.lat) && Number.isFinite(cfg.lng);
export async function savePrayer(patch) {
  await store.setSettings({ prayer: { ...prayerConfig(), ...patch } });
}

export function todayTimes(now = new Date(), cfg = prayerConfig()) {
  return prayerTimes(now, cfg);
}

/** The next prayer (sunrise excluded) from `now`: { id, label, time } — looks into tomorrow after Isha. */
export function nextPrayer(now = new Date(), cfg = prayerConfig()) {
  if (!hasLocation(cfg)) return null;
  for (let d = 0; d < 2; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const t = prayerTimes(day, cfg);
    for (const p of PRAYERS) {
      if (p.info || !t[p.id]) continue;
      if (t[p.id] > now) return { id: p.id, label: p.label, time: t[p.id] };
    }
  }
  return null;
}

/** The prayer whose time has most recently come in (for "adhkar after the prayer"), or null before Fajr. */
export function currentPrayer(now = new Date(), cfg = prayerConfig()) {
  if (!hasLocation(cfg)) return null;
  const t = prayerTimes(now, cfg);
  let cur = null;
  for (const p of PRAYERS) if (!p.info && t[p.id] && t[p.id] <= now) cur = p.id;
  return cur;
}

const pad = (n) => String(n).padStart(2, '0');
export const formatTime = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—');

/** "بعد 1 س 12 د" */
export function untilLabel(time, now = new Date()) {
  const mins = Math.max(0, Math.ceil((time - now) / 60000));
  if (mins < 1) return 'الآن';
  const h = Math.floor(mins / 60), m = mins % 60;
  return 'بعد ' + (h ? `${h} س ` : '') + (m || !h ? `${m} د` : '').trim();
}
