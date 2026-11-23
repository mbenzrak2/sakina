// Sakina — local persistence layer (IndexedDB). Everything stays on the device.
//
// Stores
//   kv   : key → value   (goals, customCats, favs, quran, settings, installedAt)
//   days : one record per calendar day, kept forever (history)
//          { date:'YYYY-MM-DD', goals:[{id,title}], done:{[goalId]:timestamp}, dhikr:{[pkey]:{[itemId]:count}} }
//
// `goals` inside a day record is a snapshot of the goals that existed that day, so the
// history stays truthful even if the user later renames / deletes goals.

import { setHijriOffset, isBidDay } from './hijri.js';

const DB_NAME = 'sakina';
const DB_VERSION = 1;

let db = null;
const kv = new Map();
const listeners = new Set();

/* ───────────── dates ───────────── */

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export const todayKey = () => dateKey();

/* ───────────── low level ───────────── */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('days')) d.createObjectStore('days', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function run(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const os = tx.objectStore(storeName);
    let result;
    const req = fn(os);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function emit(type, detail) {
  for (const fn of listeners) {
    try { fn(type, detail); } catch (e) { console.error(e); }
  }
}
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function kvGet(key, fallback) {
  return kv.has(key) ? clone(kv.get(key)) : fallback;
}
async function kvSet(key, value) {
  kv.set(key, clone(value));
  await run('kv', 'readwrite', (os) => os.put(value, key));
  emit(key);
}

/* ───────────── defaults ───────────── */

// hijriOffset: days added to the calculated Hijri date to match the local moon sighting (-2 … +2)
// notify: remind the user of the white days (see notify.js)
const DEFAULT_SETTINGS = { theme: 'dark', arScale: 1, hijriOffset: 0, notify: false };

// link.kind 'adhkar' → link.key is a progress key ("1:am", "2", "c:<customCatId>")
// link.kind 'quran'  → completed from the Quran reader ("تمّ وِرد اليوم")
// A goal with `target` (a number) is a counter goal: it is done when today's count reaches the target
// (e.g. 1000 × الصلاة على النبي ﷺ). Counter goals have no link.
const COUNTER_GOALS = [
  { id: 'g-istighfar', title: 'الاستغفار', icon: 'sparkle', link: null, target: 12000 },
  { id: 'g-salawat', title: 'الصلاة على النبي ﷺ', icon: 'heart', link: null, target: 1000 },
];
// A goal with `when: 'bid'` only belongs to the white days (13, 14, 15 of the lunar month).
const BID_GOAL = { id: 'g-bid', title: 'صيام الأيام البيض', icon: 'moon', link: null, when: 'bid' };
const goalActive = (g, date) => g.when !== 'bid' || isBidDay(parseKey(date));

const DEFAULT_GOALS = [
  BID_GOAL,
  { id: 'g-am', title: 'أذكار الصباح', icon: 'sun', link: { kind: 'adhkar', key: '1:am' } },
  { id: 'g-quran', title: 'وِرد القرآن', icon: 'quran', link: { kind: 'quran' } },
  { id: 'g-salah', title: 'الأذكار بعد الصلوات الخمس', icon: 'beads', link: { kind: 'adhkar', key: '27' } },
  ...COUNTER_GOALS,
  { id: 'g-pm', title: 'أذكار المساء', icon: 'moon', link: { kind: 'adhkar', key: '1:pm' } },
  { id: 'g-sleep', title: 'أذكار النوم', icon: 'bed', link: { kind: 'adhkar', key: '2' } },
];

/** Categories read in several sessions a day (see SESSIONS in data.js). A goal linked to the bare
 *  category key ("27") is done once every session ("27:fajr" … "27:isha") is completed that day. */
export const SESSION_IDS = { 1: ['am', 'pm'], 27: ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] };

/** v2: the "الاستغفار والتوبة" chapter is a set of narrations, not a task → replaced by counter goals. */
async function migrate() {
  const v = kv.get('schema') || 1;
  if (v >= 3) return;
  if (v === 2) {
    const g = kvGet('goals', null);
    if (g && !g.some((x) => x.id === BID_GOAL.id)) { g.unshift(BID_GOAL); await kvSet('goals', g); }
    await kvSet('schema', 3);
    return;
  }
  const goals = kvGet('goals', null);
  if (goals) {
    const i = goals.findIndex((g) => g.id === 'g-istighfar' && g.link && g.link.kind === 'adhkar');
    if (i >= 0) {
      const add = COUNTER_GOALS.filter((c) => c.id === 'g-istighfar' || !goals.some((g) => g.id === c.id));
      goals.splice(i, 1, ...add);
    }
    const s = goals.find((g) => g.id === 'g-salah' && g.title === 'الأذكار بعد الصلاة');
    if (s) s.title = 'الأذكار بعد الصلوات الخمس';
    if (!goals.some((x) => x.id === BID_GOAL.id)) goals.unshift(BID_GOAL);
    await kvSet('goals', goals);
  }
  await kvSet('schema', 3);
}

/* ───────────── day records ───────────── */

function blankDay(date) {
  return { date, goals: [], done: {}, dhikr: {} };
}
function snapshotGoals(date = todayKey()) {
  return kvGet('goals', []).filter((g) => goalActive(g, date)).map((g) => ({ id: g.id, title: g.title }));
}
async function getDay(date = todayKey()) {
  const rec = await run('days', 'readonly', (os) => os.get(date));
  return rec || null;
}
// Writes are serialised so rapid taps (dhikr counter) can never overwrite each other.
let writeQueue = Promise.resolve();
function updateDay(date, mutator) {
  const job = writeQueue.then(async () => {
    const rec = (await getDay(date)) || blankDay(date);
    if (date === todayKey() || !rec.goals || !rec.goals.length) rec.goals = snapshotGoals(date);
    mutator(rec);
    await run('days', 'readwrite', (os) => os.put(rec));
    emit('day', { date });
    return rec;
  });
  writeQueue = job.catch(() => {});
  return job;
}
function dayStats(rec) {
  if (!rec) return { done: 0, total: 0, ratio: 0 };
  const total = rec.goals.length;
  const done = rec.goals.filter((g) => rec.done && rec.done[g.id]).length;
  return { done, total, ratio: total ? done / total : 0 };
}

/* ───────────── public API ───────────── */

export const store = {
  /** Must be awaited once before anything else. */
  async init() {
    db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { kv.set(c.key, c.value); c.continue(); }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    if (!kv.has('installedAt')) await kvSet('installedAt', todayKey());
    if (!kv.has('goals')) { await kvSet('goals', DEFAULT_GOALS); await kvSet('schema', 3); }
    setHijriOffset(this.getSettings().hijriOffset);
    await migrate();
    await updateDay(todayKey(), () => {}); // make sure today exists with a fresh snapshot
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  },

  /** Subscribe to changes. fn(type, detail); type ∈ 'day' | 'goals' | 'customCats' | 'favs' | 'quran' | 'settings' | 'import'. Returns unsubscribe. */
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  uid,

  /* settings */
  getSettings() { return { ...DEFAULT_SETTINGS, ...kvGet('settings', {}) }; },
  async setSettings(patch) {
    await kvSet('settings', { ...this.getSettings(), ...patch });
    if ('hijriOffset' in patch) {
      setHijriOffset(patch.hijriOffset);
      await updateDay(todayKey(), () => {}); // today's goals may change (white days)
    }
  },
  installedAt() { return kvGet('installedAt', todayKey()); },

  /* goals (the daily checklist definition) */
  /** Every goal the user defined (for managing them). */
  listGoals() { return kvGet('goals', []); },
  /** The goals that apply to a given day (default today): day-specific goals such as the white days are filtered. */
  goalsFor(date = todayKey()) { return kvGet('goals', []).filter((g) => goalActive(g, date)); },
  isGoalActive(g, date = todayKey()) { return goalActive(g, date); },
  /** Create (no id) or update (same id) a goal: { id?, title, icon?, link? }. Returns the saved goal. */
  async saveGoal(goal) {
    const goals = kvGet('goals', []);
    const g = { icon: 'check', link: null, ...goal, title: String(goal.title || '').trim() };
    if (!g.title) throw new Error('title required');
    if (!g.id) { g.id = uid('g-'); goals.push(g); }
    else {
      const i = goals.findIndex((x) => x.id === g.id);
      if (i >= 0) goals[i] = g; else goals.push(g);
    }
    await kvSet('goals', goals);
    await updateDay(todayKey(), () => {});
    return g;
  },
  async deleteGoal(id) {
    await kvSet('goals', kvGet('goals', []).filter((g) => g.id !== id));
    await updateDay(todayKey(), () => {});
  },
  /** ids = full ordered list of goal ids. */
  async reorderGoals(ids) {
    const goals = kvGet('goals', []);
    goals.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    await kvSet('goals', goals);
    await updateDay(todayKey(), () => {});
  },

  /* day records / history */
  getDay,
  dayStats,
  /** Inclusive range, sorted ascending. Days never opened have no record. */
  async getDays(from, to) {
    return (await run('days', 'readonly', (os) => os.getAll(IDBKeyRange.bound(from, to)))) || [];
  },
  async getAllDays() {
    return (await run('days', 'readonly', (os) => os.getAll())) || [];
  },
  /** Mark / unmark a goal for a day (default today). */
  async toggleGoal(goalId, done, date = todayKey()) {
    return updateDay(date, (rec) => {
      if (done) rec.done[goalId] = Date.now(); else delete rec.done[goalId];
    });
  },
  /**
   * Called by the readers when a linked activity is finished today.
   * completeLinked('adhkar', '1:am') or completeLinked('quran').
   * Returns the titles of the goals newly checked (may be empty).
   */
  async completeLinked(kind, key) {
    key = key == null ? '' : String(key);
    const goals = kvGet('goals', []);
    const newly = [];
    await updateDay(todayKey(), (rec) => {
      if (kind === 'adhkar') (rec.completed = rec.completed || {})[key] = rec.completed[key] || Date.now();
      const [cat, session] = key.split(':');
      const sessions = session && !key.startsWith('c:') ? SESSION_IDS[cat] : null;
      const allSessions = sessions && sessions.every((s) => rec.completed[`${cat}:${s}`]);
      for (const g of goals) {
        if (!g.link || g.link.kind !== kind || rec.done[g.id]) continue;
        if (kind === 'adhkar' && g.link.key !== key && !(allSessions && g.link.key === cat)) continue;
        rec.done[g.id] = Date.now();
        newly.push(g.title);
      }
    });
    return newly;
  },
  /** Sessions of a multi-session category completed today, e.g. sessionsDone('27') → ['fajr','asr']. */
  async sessionsDone(cat, date = todayKey()) {
    const rec = await getDay(date);
    const done = (rec && rec.completed) || {};
    return (SESSION_IDS[cat] || []).filter((s) => done[`${cat}:${s}`]);
  },

  /* counter goals (goal.target): today's count per goal */
  async getCount(goalId, date = todayKey()) {
    const rec = await getDay(date);
    return (rec && rec.counts && rec.counts[goalId]) || 0;
  },
  /** Set today's count for a counter goal; ticks / unticks the goal when the target is crossed. Returns { count, done }. */
  async setCount(goalId, count) {
    const goal = kvGet('goals', []).find((g) => g.id === goalId);
    const target = goal && goal.target > 0 ? goal.target : 0;
    const n = Math.max(0, Math.min(10000000, Math.floor(count) || 0));
    let done = false;
    await updateDay(todayKey(), (rec) => {
      (rec.counts = rec.counts || {})[goalId] = n;
      if (target) {
        if (n >= target) rec.done[goalId] = rec.done[goalId] || Date.now();
        else delete rec.done[goalId];
      }
      done = !!rec.done[goalId];
    });
    return { count: n, done };
  },
  /** Streaks and totals over the whole history. A day is "active" when ≥1 goal is done, "perfect" when all are. */
  async stats() {
    const days = await this.getAllDays();
    const map = new Map(days.map((d) => [d.date, dayStats(d)]));
    const today = todayKey();
    const isActive = (k) => (map.get(k)?.done || 0) > 0;
    let current = 0;
    let k = isActive(today) ? today : addDays(today, -1);
    while (isActive(k)) { current++; k = addDays(k, -1); }
    let best = 0, runLen = 0, prev = null, active = 0, perfect = 0, doneGoals = 0, totalGoals = 0;
    for (const d of days) {
      const s = map.get(d.date);
      doneGoals += s.done; totalGoals += s.total;
      if (s.total && s.done === s.total) perfect++;
      if (s.done > 0) {
        active++;
        runLen = prev && addDays(prev, 1) === d.date ? runLen + 1 : 1;
        prev = d.date;
        if (runLen > best) best = runLen;
      }
    }
    return {
      current, best: Math.max(best, current), activeDays: active, perfectDays: perfect,
      trackedDays: days.length, doneGoals, totalGoals,
      rate: totalGoals ? doneGoals / totalGoals : 0, since: this.installedAt(),
    };
  },

  /* dhikr counters (per day, per progress key) */
  async getDhikr(pkey, date = todayKey()) {
    const rec = await getDay(date);
    return (rec && rec.dhikr && rec.dhikr[pkey]) || {};
  },
  async setDhikr(pkey, itemId, count, date = todayKey()) {
    await updateDay(date, (rec) => {
      rec.dhikr = rec.dhikr || {};
      (rec.dhikr[pkey] = rec.dhikr[pkey] || {})[itemId] = count;
    });
  },
  async resetDhikr(pkey, date = todayKey()) {
    await updateDay(date, (rec) => { if (rec.dhikr) delete rec.dhikr[pkey]; });
  },

  /* user-defined adhkar: [{ id, title, items:[{ id, text, count, note? }] }] */
  listCustomCats() { return kvGet('customCats', []); },
  getCustomCat(id) { return this.listCustomCats().find((c) => c.id === id) || null; },
  /** Create (no id) or replace (same id). Items without id get one. Returns the saved category. */
  async saveCustomCat(cat) {
    const cats = kvGet('customCats', []);
    const c = { ...cat, title: String(cat.title || '').trim(), items: (cat.items || []).map((it) => ({
      ...it, id: it.id || uid('d-'), text: String(it.text || '').trim(), count: Math.max(1, parseInt(it.count, 10) || 1),
    })) };
    if (!c.title) throw new Error('title required');
    if (!c.id) { c.id = uid(''); cats.push(c); }
    else {
      const i = cats.findIndex((x) => x.id === c.id);
      if (i >= 0) cats[i] = c; else cats.push(c);
    }
    await kvSet('customCats', cats);
    return c;
  },
  async deleteCustomCat(id) {
    await kvSet('customCats', kvGet('customCats', []).filter((c) => c.id !== id));
  },

  /* favourites: array of category keys ("12", "c:<id>") */
  listFavs() { return kvGet('favs', []); },
  isFav(key) { return this.listFavs().includes(String(key)); },
  async toggleFav(key) {
    key = String(key);
    const favs = kvGet('favs', []);
    const i = favs.indexOf(key);
    if (i >= 0) favs.splice(i, 1); else favs.push(key);
    await kvSet('favs', favs);
    return i < 0;
  },

  /* quran reading state: { last:{s,a,ts}|null, bookmarks:[{s,a,ts}], scale:number } */
  getQuran() { return { last: null, bookmarks: [], scale: 1, ...kvGet('quran', {}) }; },
  async setQuran(patch) { await kvSet('quran', { ...this.getQuran(), ...patch }); },

  /* backup */
  async exportAll() {
    return {
      app: 'sakina', version: 1, exportedAt: new Date().toISOString(),
      kv: Object.fromEntries([...kv.entries()].map(([k, v]) => [k, clone(v)])),
      days: await this.getAllDays(),
    };
  },
  /** Replaces all local data with the backup content. */
  async importAll(data) {
    if (!data || data.app !== 'sakina' || typeof data.kv !== 'object' || !Array.isArray(data.days)) {
      throw new Error('invalid backup');
    }
    const days = data.days.filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date));
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['kv', 'days'], 'readwrite');
      tx.objectStore('kv').clear();
      tx.objectStore('days').clear();
      for (const [k, v] of Object.entries(data.kv)) tx.objectStore('kv').put(v, k);
      for (const d of days) tx.objectStore('days').put({ ...blankDay(d.date), ...d });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    kv.clear();
    for (const [k, v] of Object.entries(data.kv)) kv.set(k, v);
    if (!kv.has('goals')) await kvSet('goals', DEFAULT_GOALS);
    await migrate();
    if (!kv.has('installedAt')) await kvSet('installedAt', days.length ? days.map((d) => d.date).sort()[0] : todayKey());
    await updateDay(todayKey(), () => {});
    emit('import');
  },
  async wipe() {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['kv', 'days'], 'readwrite');
      tx.objectStore('kv').clear();
      tx.objectStore('days').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    kv.clear();
    await kvSet('installedAt', todayKey());
    await kvSet('goals', DEFAULT_GOALS);
    await updateDay(todayKey(), () => {});
    emit('import');
  },
};
