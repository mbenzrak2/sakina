// Builds data/adhkar.json and data/quran.json from the upstream open datasets.
// Usage: node tools/build-data.js <Adhkar-json/adhkar.json> <quran-json/dist/quran.json> <hisn_almuslim_json/hisn_almuslim.json>
// Sources:
//   - https://github.com/rn0x/Adhkar-json         (حصن المسلم — نص الأذكار وعدد التكرار)
//   - https://github.com/rn0x/hisn_almuslim_json  (حصن المسلم — حواشي التخريج)
//   - https://github.com/risan/quran-json         (Uthmani text)
// Texts are copied verbatim; only unused fields (audio paths, links) are dropped.
//
// Takhrij (item.ref): the footnotes come from a second edition of the same book. A reference is attached to
// a dhikr ONLY when it can be verified: the chapter is found, the chapter has exactly one (non-gloss)
// footnote per text, and the dhikr text matches that chapter text closely. Otherwise the item gets no ref —
// nothing is ever guessed or written by hand.
const fs = require('fs');
const path = require('path');

const [, , adhkarSrc, quranSrc, hisnSrc] = process.argv;
if (!adhkarSrc || !quranSrc || !hisnSrc) {
  console.error('usage: node tools/build-data.js <adhkar.json> <quran.json> <hisn_almuslim.json>');
  process.exit(1);
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const out = path.join(__dirname, '..', 'data');
fs.mkdirSync(out, { recursive: true });

/* ───────────── matching helpers ───────────── */
const norm = (s) => String(s).normalize('NFKC')
  .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '')
  .replace(/[آأإٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^ء-ي]/g, '');
function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); }
  return m;
}
function dice(a, b) {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const [k, v] of A) { na += v; if (B.has(k)) inter += Math.min(v, B.get(k)); }
  for (const v of B.values()) nb += v;
  return (2 * inter) / (na + nb);
}

const hisn = read(hisnSrc);
const clean = (f) => String(f).replace(/\s+/g, ' ').trim();

// Two long chapters carry extra footnotes (evening wordings, context of the hadith) between the references,
// so "one footnote per text" does not hold. For these, each chapter text is mapped by hand to the index(es)
// of its reference footnote(s) in the source file — the footnote wording itself is still taken verbatim.
// [expected text count, expected footnote count, footnote indexes per text]
const MANUAL = {
  'أذكار الصباح والمساء': [25, 35, [[0], [1], [2], [5], [7], [9], [11], [13], [14], [15], [16], [17], [18], [19], [20], [23], [25], [26], [27, 28], [29], [30], [31], [32], [33], [34]]],
  'أذكار النوم': [13, 16, [[0], [1], [2], [4], [5], [7], [8], [9], [10], [11], [12], [13], [15]]],
};

const chapters = Object.keys(hisn).map((title) => {
  const texts = hisn[title].text.map(norm);
  const raw = hisn[title].footnote.map(clean);
  // footnotes starting with "*" are vocabulary glosses, not references
  let refs = raw.filter((f) => f && !f.startsWith('*'));
  const m = MANUAL[title.trim()];
  if (m) {
    if (texts.length !== m[0] || raw.length !== m[1] || m[2].length !== m[0]) throw new Error('source changed, re-check manual mapping: ' + title);
    refs = m[2].map((idx) => idx.map((i) => raw[i]).join(' — '));
  }
  return { title, nt: norm(title), texts, refs };
});

function findChapter(title) {
  const nt = norm(title);
  let best = null, score = 0;
  for (const c of chapters) { const d = dice(nt, c.nt); if (d > score) { score = d; best = c; } }
  return score >= 0.8 ? best : null;
}

// Items the automatic matching could not place (the chapter is titled differently in the two editions, or one
// dhikr here gathers several texts of the other edition). Each was checked by reading both sources side by side.
// "category.item": [chapter title in hisn_almuslim.json, its expected footnote count, footnote indexes to use]
// Not included on purpose: 72.1 («اللهم أطعم من أطعمني…») — its footnote reads «مسلم3/ 26», which looks truncated.
const MANUAL_ITEMS = {
  '11.1': ['دعاء دخول المسجد', 4, [0, 1, 2, 3]],   // one dhikr here = the four parts referenced separately there
  '13.1': ['أذكار الأذان', 6, [0]],
  '13.2': ['أذكار الأذان', 6, [1, 2]],              // reference + when it is said
  '13.3': ['أذكار الأذان', 6, [3]],
  '13.4': ['أذكار الأذان', 6, [4]],
  '13.5': ['أذكار الأذان', 6, [5]],
  '17.1': ['ما يقول إذا وضع الثوب', 1, [0]],
  '25.1': ['الصلاة على النبي صلى الله عليه وسلم بعد التشهد', 2, [0]],
  '25.2': ['الصلاة على النبي صلى الله عليه وسلم بعد التشهد', 2, [1]],
  '31.1': ['ما يفعل من رأى الرؤيا أو الحلم', 5, [0, 1, 2, 3]], // four actions gathered in one item
  '33.1': ['الذكر عقب السلام من الوتر', 1, [0]],
  '80.1': ['دعاء المتزوج لنفسه ودعاء شراء الدابة', 1, [0]],
  '85.1': ['كفارة المجلس ومايختم به المجالس', 1, [0]],
  '88.1': ['ما يعصم به من الدجال', 2, [0]],         // footnote 1 only points to other hadith numbers of the book
  '95.1': ['دعاء ركوب الدابة', 1, [0]],
  '122.1': ['ما يقول عند التعجب والأمر السار', 2, [0]],
  '122.2': ['ما يقول عند التعجب والأمر السار', 2, [1]],
  '131.1': ['كيف كان النبي صلى الله عليه وسلم يسبح ؟', 1, [0]],
};
function manualRef(key) {
  const m = MANUAL_ITEMS[key];
  if (!m) return null;
  const title = Object.keys(hisn).find((k) => norm(k) === norm(m[0]));
  if (!title) throw new Error('manual reference: chapter not found: ' + m[0]);
  const raw = hisn[title].footnote.map(clean);
  if (raw.length !== m[1]) throw new Error('source changed, re-check manual reference ' + key);
  return [...new Set(m[2].map((i) => raw[i]))].join(' — ');
}

const stats = { items: 0, withRef: 0, manual: 0, catsFull: 0, catsNone: [] };
const adhkar = read(adhkarSrc).map((c) => {
  const title = String(c.category).replace(/\s+/g, ' ').trim();
  const ch = findChapter(title);
  const usable = ch && ch.refs.length === ch.texts.length;
  const taken = new Set();
  let got = 0;
  const items = (c.array || []).map((d) => {
    const item = {
      id: d.id,
      text: String(d.text).trim(),
      count: Number.isFinite(+d.count) && +d.count > 0 ? +d.count : 1,
    };
    // The upstream count is wrong for a few items whose own text ends with an explicit "(N مرات)": trust the text.
    const tail = item.text.replace(/[ً-ْٰـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
      .match(/\((ثلاث|اربع|سبع|عشر|مائه) مر(?:ات|ه)\)\.?$/);
    if (tail) {
      const stated = { 'ثلاث': 3, 'اربع': 4, 'سبع': 7, 'عشر': 10, 'مائه': 100 }[tail[1]];
      if (stated !== item.count) { console.log(`count fixed ${c.id}.${d.id}: ${item.count} → ${stated}`); item.count = stated; }
    }
    stats.items++;
    if (usable) {
      const nd = norm(item.text);
      let bi = -1, bs = 0;
      ch.texts.forEach((t, i) => { const s = dice(nd, t); if (s > bs) { bs = s; bi = i; } });
      if (bi >= 0 && bs >= 0.62 && !taken.has(bi)) { taken.add(bi); item.ref = ch.refs[bi]; got++; stats.withRef++; }
    }
    if (!item.ref) {
      const ref = manualRef(`${c.id}.${d.id}`);
      if (ref) { item.ref = ref; got++; stats.withRef++; stats.manual++; }
    }
    return item;
  });
  if (got === items.length) stats.catsFull++; else stats.catsNone.push(`${c.id} ${title} (${got}/${items.length})`);
  return { id: c.id, title, items };
});
fs.writeFileSync(path.join(out, 'adhkar.json'), JSON.stringify(adhkar));

const quran = read(quranSrc).map((s) => ({
  id: s.id,
  name: s.name,
  tr: s.transliteration,
  type: s.type, // 'meccan' | 'medinan'
  n: s.total_verses,
  verses: s.verses.map((v) => v.text),
}));
if (quran.length !== 114) throw new Error('expected 114 surahs, got ' + quran.length);
const totalAyat = quran.reduce((a, s) => a + s.verses.length, 0);
if (totalAyat !== 6236) throw new Error('expected 6236 ayat, got ' + totalAyat);
for (const s of quran) if (s.verses.length !== s.n) throw new Error('verse count mismatch in surah ' + s.id);
fs.writeFileSync(path.join(out, 'quran.json'), JSON.stringify(quran));

console.log('adhkar categories:', adhkar.length, 'items:', stats.items);
console.log('items with verified reference:', stats.withRef, '| categories fully referenced:', stats.catsFull);
console.log('categories with missing references:\n  ' + stats.catsNone.join('\n  '));
console.log('quran surahs:', quran.length, 'ayat:', totalAyat);
