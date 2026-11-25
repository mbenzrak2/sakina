// Read-only content shipped with the app (cached by the service worker for offline use).
//   adhkar : [{ id:number, title, items:[{ id:number, text, count }] }]        132 categories (حصن المسلم)
//   quran  : [{ id:1..114, name, tr, type:'meccan'|'medinan', n, verses:[text] }]  Uthmani text
import { store } from './store.js';
import { currentPrayer } from './prayer.js';

let adhkarP = null;
let quranP = null;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to load ' + url);
  return res.json();
}

export function loadAdhkar() {
  return (adhkarP = adhkarP || getJson('data/adhkar.json').catch((e) => { adhkarP = null; throw e; }));
}
export function loadQuran() {
  return (quranP = quranP || getJson('data/quran.json').catch((e) => { quranP = null; throw e; }));
}

/**
 * Adhkar whose text only NAMES a passage of the Quran instead of quoting it. The reader shows the passage
 * itself under the dhikr, taken from data/quran.json, for those who have not memorised it.
 * "category.item" → [{ s: surah, from?, to? }]  (whole surah when from/to are absent)
 */
export const QURAN_PARTS = {
  '1.x-mulk': [{ s: 67 }],                 // added to the evening adhkar (see MULK_PM)
  '2.12': [{ s: 32 }, { s: 67 }],         // «يقرأ ﴿الم﴾ تنزيل السجدة، وتبارك الذي بيده الملك»
  '88.1': [{ s: 18, from: 1, to: 10 }],    // «من حفظ عشر آيات من أول سورة الكهف»
};

/**
 * Category keys
 *   "12"      built-in category 12
 *   "c:<id>"  user category
 * Progress keys (pkey) are a category key plus an optional session: "1:am" / "1:pm"
 * (category 1 = أذكار الصباح والمساء, read twice a day).
 */
export const AM_PM_CATEGORY = '1';

export function splitPkey(pkey) {
  const s = String(pkey);
  if (s.startsWith('c:')) return { catKey: s, session: null, custom: true, id: s.slice(2) };
  const [id, session] = s.split(':');
  return { catKey: id, session: session || null, custom: false, id: Number(id) };
}

/** Resolve a category (built-in or custom) from a category key or pkey → { key, title, items, custom } | null */
export async function getCategory(key) {
  const p = splitPkey(key);
  if (p.custom) {
    const c = store.getCustomCat(p.id);
    return c ? { key: p.catKey, title: c.title, items: c.items, custom: true } : null;
  }
  const c = (await loadAdhkar()).find((x) => x.id === p.id);
  return c ? { key: p.catKey, title: c.title, items: c.items, custom: false } : null;
}

/**
 * Categories read at several moments of the day. Each moment ("session") has its own counters:
 * progress key = "<catKey>:<sessionId>". The ids must match SESSION_IDS in store.js.
 */
export const SESSIONS = {
  '1': {
    label: 'وقت الأذكار',
    options: [
      { id: 'am', label: 'الصباح', icon: 'sun', title: 'أذكار الصباح' },
      { id: 'pm', label: 'المساء', icon: 'moon', title: 'أذكار المساء' },
    ],
  },
  '27': {
    label: 'الصلاة',
    options: [
      { id: 'fajr', label: 'الفجر', title: 'أذكار بعد صلاة الفجر' },
      { id: 'dhuhr', label: 'الظهر', title: 'أذكار بعد صلاة الظهر' },
      { id: 'asr', label: 'العصر', title: 'أذكار بعد صلاة العصر' },
      { id: 'maghrib', label: 'المغرب', title: 'أذكار بعد صلاة المغرب' },
      { id: 'isha', label: 'العشاء', title: 'أذكار بعد صلاة العشاء' },
    ],
  },
};

/** A sensible session for "now" (the user can always switch). Prayer slots are approximate clock ranges. */
export function defaultSession(catKey) {
  const hr = new Date().getHours();
  if (catKey === '1') return hr < 15 ? 'am' : 'pm';
  // with a location set, the real prayer times decide which prayer was the last one
  if (catKey === '27') { const cur = currentPrayer(); if (cur) return cur; }
  if (catKey === '27') return hr < 11 ? 'fajr' : hr < 15 ? 'dhuhr' : hr < 18 ? 'asr' : hr < 20 ? 'maghrib' : 'isha';
  return null;
}

/** Chapters that are narrations about the virtue of a deed — shown as reading, without counters. */
export const READ_ONLY = new Set(['50', '107', '108', '129', '130', '131', '132']);

const bare = (s) => String(s).replace(/[ً-ْٰـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
const AM_ONLY = /\([^()]*اذا اصبح\)\.?\s*$/;
const PM_ONLY = /\([^()]*اذا امسى\)\.?\s*$/;

/*
 * Morning / evening wording. In the book one text serves both moments: the morning wording, followed by
 * «[وإذا أمسى قال: …]». Each session shows only its own wording:
 *   morning → the bracketed evening notes are removed;
 *   evening → the evening words given by the book replace the morning words they stand for.
 * Nothing is written here: the evening words are read from the brackets of the text itself. PM_FORMS only says,
 * per dhikr, which morning words (matched without tashkeel) each bracket replaces; 'whole' = the bracket is the
 * complete evening dhikr. If anything does not match, the full original text is shown unchanged.
 */
const PM_BRACKET = /\s*\[\s*وإذا أمسى قال:\s*([^\]]*)\]/g;
const PM_FORMS = {
  3: ['اصبحنا واصبح الملك لله', 'رب اسالك خير ما في هذا اليوم وخير ما بعده واعوذ بك من شر ما في هذا اليوم وشر ما بعده'],
  4: 'whole',
  6: ['اللهم اني اصبحت'],
  7: ['اللهم ما اصبح بي'],
  15: 'whole',
  16: ['اصبحنا على فطره الاسلام'],
};
const DIACRITIC = /[ً-ْٰـ]/;
const plainOf = (s) => bare(s).replace(/[^ء-ي]+/g, ' ').trim();

function morningText(text) {
  return text.replace(PM_BRACKET, '');
}

/** [start, end) of the span of `raw` whose letters are `plain` (tashkeel and punctuation ignored), or null. */
function findSpan(raw, plain) {
  let p = '';
  const at = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (DIACRITIC.test(ch)) continue;
    const b = bare(ch);
    if (/[ء-ي]/.test(b)) { p += b; at.push(i); }
    else if (p && !p.endsWith(' ')) { p += ' '; at.push(i); }
  }
  const k = p.indexOf(plain);
  if (k < 0) return null;
  let end = at[k + plain.length - 1] + 1;
  while (end < raw.length && DIACRITIC.test(raw[end])) end++;
  return [at[k], end];
}

function eveningText(id, text) {
  const form = PM_FORMS[id];
  const brackets = [...text.matchAll(PM_BRACKET)].map((m) => m[1].trim().replace(/[.…\s]+$/, ''));
  if (!form || !brackets.length) return text;
  if (form === 'whole') return brackets.length === 1 ? `((${brackets[0]})).` : text;
  if (form.length !== brackets.length) return text;
  let out = morningText(text);
  for (let i = 0; i < form.length; i++) {
    const span = findSpan(out, form[i]);
    if (!span) return text;
    out = out.slice(0, span[0]) + brackets[i] + out.slice(span[1]);
  }
  return out;
}

// Added at the user's request: Surat al-Mulk at the end of the evening adhkar. It is NOT part of that chapter in
// the book (which lists it in أذكار النوم, dhikr 12) — the note under it says so. Its text comes from QURAN_PARTS.
const MULK_PM = {
  id: 'x-mulk',
  text: 'قراءة سورة الملك',
  count: 1,
  note: 'إضافة من التطبيق: ليست من باب أذكار الصباح والمساء في «حصن المسلم»، وقد ذكرها الكتاب في أذكار النوم.',
};

/**
 * The adhkar to read for one session. The rules only apply what the book itself states:
 *  - Morning / evening: a dhikr whose text ends with "(… إذا أصبح)" is morning-only, "(… إذا أمسى)" evening-only.
 *  - After prayer:
 *      · the three Quls: once after each prayer, three times after Fajr and Maghrib
 *        (حصن المسلم: «بعد كل صلاة مرة واحدة، وبعد صلاة المغرب والفجر ثلاث مرات»);
 *      · «… يحيي ويميت …» ten times: after Maghrib and Fajr only (stated in its text);
 *      · «اللهم إني أسألك علمًا نافعًا …»: after Fajr only (stated in its text).
 */
export function sessionItems(catKey, session, items) {
  if (catKey === '1' && session) {
    const out = items.filter((it) => {
      const t = bare(it.text);
      // «… (مائة مرة إذا أصبح)» is counted on its own, as a daily counter goal (TAHLIL_GOAL in store.js)
      if (/\(مائه مره اذا اصبح\)/.test(t)) return false;
      if (AM_ONLY.test(t)) return session === 'am';
      if (PM_ONLY.test(t)) return session === 'pm';
      return true;
    }).map((it) => {
      const text = session === 'am' ? morningText(it.text) : eveningText(it.id, it.text);
      return text === it.text ? it : { ...it, text };
    });
    if (session === 'pm') out.push(MULK_PM);
    return out;
  }
  if (catKey === '27' && session) {
    const dawnOrDusk = session === 'fajr' || session === 'maghrib';
    const out = [];
    for (const it of items) {
      const t = bare(it.text);
      if (t.includes('بعد صلاه المغرب والصبح')) { if (dawnOrDusk) out.push(it); continue; }
      if (/من صلاه الفجر\.?\s*$/.test(t)) { if (session === 'fajr') out.push(it); continue; }
      if (t.includes('قل هو الله احد') && t.includes('قل اعوذ برب الفلق')) { out.push({ ...it, count: dawnOrDusk ? 3 : 1 }); continue; }
      out.push(it);
    }
    return out;
  }
  return items;
}

/** Human title for a pkey, e.g. "1:am" → "أذكار الصباح". */
export async function pkeyTitle(pkey) {
  const p = splitPkey(pkey);
  const opt = p.session && SESSIONS[p.catKey] && SESSIONS[p.catKey].options.find((o) => o.id === p.session);
  if (opt) return opt.title;
  const c = await getCategory(pkey);
  return c ? c.title : '';
}

/** Strip Arabic diacritics / normalise letters so search works without tashkeel. */
export function normalizeAr(s) {
  return String(s)
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
