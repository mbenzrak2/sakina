// Sakina — Adhkar feature: index (/adhkar) and reader (/adhkar/:key).
//
// Devotional texts are displayed verbatim from data/adhkar.json (or from what the user typed).
// Every piece of text goes through h() children → text nodes only, never innerHTML.

import { store, todayKey } from '../store.js';
import {
  loadAdhkar, loadQuran, getCategory, splitPkey, pkeyTitle, normalizeAr, AM_PM_CATEGORY,
  SESSIONS, defaultSession, sessionItems, READ_ONLY, QURAN_PARTS,
} from '../data.js';
import {
  h, icon, toArabicDigits, pageHeader, iconButton, openSheet, confirmSheet, field, toast, navigate, haptic, debounce,
} from '../ui.js';

/* ───────────── shared helpers ───────────── */

/** The Quran passages a dhikr names without quoting them, written out in full (text from data/quran.json). */
function quranParts(parts) {
  const box = h('div', { class: 'dhikr-quran' });
  loadQuran().then((quran) => {
    for (const p of parts) {
      const s = quran[p.s - 1];
      if (!s) continue;
      const from = p.from || 1;
      const to = Math.min(p.to || s.n, s.n);
      const whole = from === 1 && to === s.n;
      const verses = h('p', { class: 'quran-text dhikr-quran-text' });
      for (let a = from; a <= to; a++) {
        verses.append(s.verses[a - 1], ' ', h('span', { class: 'ayah-n' }, toArabicDigits(a)), ' ');
      }
      box.append(h('details', { class: 'dhikr-surah', open: true },
        h('summary', null,
          h('span', { class: 'dhikr-surah-name' }, 'سورة ' + s.name),
          h('span', { class: 'dhikr-surah-range' }, whole ? `${toArabicDigits(s.n)} آية` : `الآيات ${toArabicDigits(from)} – ${toArabicDigits(to)}`),
          icon('chevron', { size: 18, class: 'dhikr-surah-chev' })),
        // the basmala opens every surah but 1 (where it is ayah 1) and 9
        from === 1 && p.s !== 1 && p.s !== 9 && h('p', { class: 'quran-text dhikr-basmala' }, quran[0].verses[0]),
        verses,
        h('a', { class: 'dhikr-surah-link', href: `#/quran/${p.s}` }, 'فتح السورة في المصحف')));
    }
  }).catch(() => box.append(h('p', { class: 'dhikr-note' }, 'تعذّر تحميل نص السورة.')));
  return box;
}

const QUICK = [
  { key: '1:am', title: 'أذكار الصباح', icon: 'sun' },
  { key: '1:pm', title: 'أذكار المساء', icon: 'moon' },
  { key: '2', title: 'أذكار النوم', icon: 'bed' },
  { key: '3', title: 'الاستيقاظ', icon: 'sparkle' },
  { key: '27', title: 'بعد الصلاة', icon: 'beads' },
  { key: '13', title: 'أذكار الأذان', icon: 'star' },
];

const MAX_COUNT = 100000;
const NEW_CAT = '__new__';

// Survive navigation index → reader → back.
let lastQuery = '';
// Set when a search result matched a specific dhikr: the reader scrolls to it.
let pendingFocus = null;
// Normalised search index of the built-in categories (built once).
let builtinIndex = null;

const targetOf = (item) => Math.max(1, parseInt(item.count, 10) || 1);

function progressOf(items, counts) {
  const c = counts || {};
  let done = 0;
  for (const it of items) if ((c[it.id] || 0) >= targetOf(it)) done++;
  return { done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** 3 → "3 أذكار" */
function countLabel(n) {
  if (n === 0) return 'لا أذكار بعد';
  if (n === 1) return 'ذكر واحد';
  if (n === 2) return 'ذكران';
  if (n >= 3 && n <= 10) return `${n} أذكار`;
  return `${n} ذكرًا`;
}
/** 3 → "3 مرات" */
function repeatLabel(n) {
  if (n === 1) return 'مرة واحدة';
  if (n === 2) return 'مرتان';
  if (n >= 3 && n <= 10) return `${n} مرات`;
  return `${n} مرة`;
}

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Keeps track of the sheets a view opened so they can be closed when the route is left. */
function sheetTracker() {
  const open = new Set();
  return {
    open(opts) {
      const sheet = openSheet({
        ...opts,
        onClose: (r) => { open.delete(sheet); if (opts.onClose) opts.onClose(r); },
      });
      open.add(sheet);
      return sheet;
    },
    closeAll() { for (const s of [...open]) s.close(); },
  };
}

const errorLine = () => h('p', { class: 'adhkar-error', role: 'alert', hidden: true });
function showError(el, msg) { el.textContent = msg; el.hidden = false; }

/**
 * Add / edit a personal dhikr.
 *   { catId, item }       edit `item` of category `catId`
 *   { catId }             add to category `catId`
 *   { chooseCat: true }   add, letting the user pick (or create) the category
 */
function openDhikrForm(S, { catId = null, item = null, chooseCat = false, onSaved } = {}) {
  const cats = chooseCat ? store.listCustomCats() : [];
  let busy = false;

  const select = chooseCat && cats.length
    ? h('select', { class: 'select', 'aria-label': 'المجموعة' },
      cats.map((c) => h('option', { value: c.id }, c.title)),
      h('option', { value: NEW_CAT }, '＋ مجموعة جديدة…'))
    : null;
  const newTitle = chooseCat
    ? h('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'مثال: أدعيتي المفضلة', value: cats.length ? '' : 'أذكاري الخاصة' })
    : null;
  const newTitleField = newTitle ? field('اسم المجموعة الجديدة', newTitle) : null;
  if (select && catId && cats.some((c) => c.id === catId)) select.value = catId;
  const syncCatField = () => { if (newTitleField && select) newTitleField.hidden = select.value !== NEW_CAT; };
  if (select) select.addEventListener('change', () => { syncCatField(); if (select.value === NEW_CAT) newTitle.focus(); });
  syncCatField();

  const text = h('textarea', { class: 'textarea', rows: '5', dir: 'rtl', placeholder: 'اكتب نص الذكر أو الدعاء…', value: item ? item.text : '' });
  const count = h('input', { class: 'input num adhkar-count-input', type: 'number', min: '1', max: String(MAX_COUNT), step: '1', inputmode: 'numeric', value: String(item ? targetOf(item) : 1) });
  const note = h('input', { class: 'input', type: 'text', maxlength: '300', placeholder: 'المصدر أو الفضل', value: item && item.note ? item.note : '' });
  const err = errorLine();
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save() }, item ? 'حفظ التعديل' : 'إضافة');

  const onEnter = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } };
  for (const el of [newTitle, count, note]) if (el) el.addEventListener('keydown', onEnter);

  const sheet = S.open({
    title: item ? 'تعديل الذكر' : 'إضافة ذكر',
    body: [
      select && field('المجموعة', select),
      newTitleField,
      field('نص الذكر', text),
      field('عدد التكرار', count, 'كم مرة تقرؤه في اليوم.'),
      field('ملاحظة (اختياري)', note, 'تظهر بخط صغير تحت نص الذكر.'),
      err,
    ],
    footer: [
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sheet.close() }, 'إلغاء'),
      saveBtn,
    ],
  });

  async function save() {
    if (busy) return;
    const t = text.value.trim();
    if (!t) { showError(err, 'اكتب نص الذكر أولًا.'); text.focus(); return; }
    const n = Math.min(MAX_COUNT, Math.max(1, parseInt(count.value, 10) || 1));
    const nt = note.value.trim();

    let cat;
    const creating = chooseCat && (!select || select.value === NEW_CAT);
    if (creating) {
      const title = newTitle.value.trim();
      if (!title) { showError(err, 'اكتب اسم المجموعة.'); newTitle.focus(); return; }
      cat = { title, items: [] };
    } else {
      cat = store.getCustomCat(chooseCat ? select.value : catId);
      if (!cat) { showError(err, 'هذه المجموعة لم تعد موجودة.'); return; }
      cat.items = Array.isArray(cat.items) ? cat.items : [];
    }

    if (item) {
      cat.items = cat.items.map((it) => {
        if (it.id !== item.id) return it;
        const next = { ...it, text: t, count: n };
        if (nt) next.note = nt; else delete next.note;
        return next;
      });
    } else {
      const next = { text: t, count: n };
      if (nt) next.note = nt;
      cat.items.push(next);
    }

    busy = true;
    saveBtn.disabled = true;
    try {
      const saved = await store.saveCustomCat(cat);
      sheet.close();
      toast(item ? 'تم حفظ التعديل' : 'تمت إضافة الذكر', { icon: 'check' });
      if (onSaved) onSaved(saved);
    } catch (e) {
      console.error(e);
      busy = false;
      saveBtn.disabled = false;
      showError(err, 'تعذّر الحفظ. حاول مرة أخرى.');
    }
  }
  return sheet;
}

/** Create (no `cat`) or rename a personal category. */
function openCatForm(S, { cat = null, onSaved } = {}) {
  let busy = false;
  const input = h('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'مثال: أدعيتي المفضلة', value: cat ? cat.title : '' });
  const err = errorLine();
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save() }, cat ? 'حفظ' : 'إنشاء');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });

  const sheet = S.open({
    title: cat ? 'إعادة تسمية المجموعة' : 'مجموعة جديدة',
    body: [
      field('اسم المجموعة', input, cat ? null : 'مجموعة خاصة بك تضيف إليها أذكارك وأدعيتك.'),
      err,
    ],
    footer: [
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sheet.close() }, 'إلغاء'),
      saveBtn,
    ],
  });

  async function save() {
    if (busy) return;
    const title = input.value.trim();
    if (!title) { showError(err, 'اكتب اسم المجموعة.'); input.focus(); return; }
    let next;
    if (cat) {
      next = store.getCustomCat(cat.id);
      if (!next) { showError(err, 'هذه المجموعة لم تعد موجودة.'); return; }
      next.title = title;
    } else {
      next = { title, items: [] };
    }
    busy = true;
    saveBtn.disabled = true;
    try {
      const saved = await store.saveCustomCat(next);
      sheet.close();
      if (onSaved) onSaved(saved);
    } catch (e) {
      console.error(e);
      busy = false;
      saveBtn.disabled = false;
      showError(err, 'تعذّر الحفظ. حاول مرة أخرى.');
    }
  }
  return sheet;
}

/* ───────────── index ───────────── */

function getBuiltinIndex(cats) {
  if (!builtinIndex) {
    builtinIndex = cats.map((c) => ({
      cat: c,
      key: String(c.id),
      title: normalizeAr(c.title),
      texts: c.items.map((it) => normalizeAr(it.text)),
    }));
  }
  return builtinIndex;
}

const doneBadge = () => h('span', { class: 'badge adhkar-done-badge', title: 'اكتمل اليوم', role: 'img', 'aria-label': 'اكتمل اليوم' }, icon('check', { size: 14, stroke: 2.4 }));

function catRow({ key, title, badge, sub, snippet, done, onclick }) {
  return h('a', { class: 'row', href: '#/adhkar/' + key, onclick },
    h('div', { class: 'row-badge' + (typeof badge === 'string' ? ' num' : '') }, badge),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, title),
      snippet
        ? h('div', { class: 'row-sub adhkar-snippet' }, snippet)
        : h('div', { class: 'row-sub' }, sub),
    ),
    h('div', { class: 'row-end' }, done && doneBadge(), icon('chevron', { size: 18 })),
  );
}

async function renderIndex(root) {
  let alive = true;
  let seq = 0;
  const S = sheetTracker();
  root.classList.add('adhkar-index');

  const addDhikr = () => openDhikrForm(S, { chooseCat: true });
  const addCategory = () => openCatForm(S, {
    onSaved: (saved) => { if (alive) navigate('/adhkar/c:' + saved.id); },
  });

  const body = h('div', { class: 'adhkar-body' });
  const input = h('input', {
    type: 'search', placeholder: 'ابحث في الأذكار…', 'aria-label': 'بحث في الأذكار',
    autocomplete: 'off', enterkeyhint: 'search', value: lastQuery,
  });
  const clearBtn = h('button', {
    type: 'button', class: 'adhkar-search-clear', 'aria-label': 'مسح البحث', hidden: !lastQuery,
    onclick: (e) => { e.preventDefault(); input.value = ''; onQuery(); input.focus(); },
  }, icon('close', { size: 18 }));
  const onQuery = () => { lastQuery = input.value; clearBtn.hidden = !input.value; update(); };
  const onInput = debounce(onQuery, 180);
  input.addEventListener('input', () => { clearBtn.hidden = !input.value; onInput(); });

  root.append(
    pageHeader({
      title: 'الأذكار',
      subtitle: 'حصن المسلم وأذكارك الخاصة',
      actions: [iconButton('plus', 'إضافة ذكر خاص', addDhikr)],
    }),
    h('label', { class: 'search adhkar-search' }, icon('search', { size: 20 }), input, clearBtn),
    body,
    h('button', { type: 'button', class: 'fab', 'aria-label': 'إضافة ذكر خاص', title: 'إضافة ذكر خاص', onclick: addDhikr }, icon('plus', { size: 26, stroke: 2 })),
  );

  function customRow(c, dhikr) {
    const key = 'c:' + c.id;
    const items = c.items || [];
    return catRow({
      key, title: c.title, badge: icon('bookmark', { size: 19 }), sub: countLabel(items.length),
      done: progressOf(items, dhikr[key]).complete,
    });
  }
  function builtinDone(c, dhikr) {
    const key = String(c.id);
    if (READ_ONLY.has(key)) return false;
    if (SESSIONS[key]) {
      return SESSIONS[key].options.every((o) => progressOf(sessionItems(key, o.id, c.items), dhikr[`${key}:${o.id}`]).complete);
    }
    return progressOf(c.items, dhikr[key]).complete;
  }
  const builtinRow = (c, dhikr, extra = {}) => catRow({
    key: String(c.id), title: c.title, badge: String(c.id), sub: countLabel(c.items.length),
    done: builtinDone(c, dhikr), ...extra,
  });

  function sectionNodes(cats, dhikr) {
    const out = [];
    const byId = new Map(cats.map((c) => [String(c.id), c]));

    // quick access
    const tiles = [];
    for (const q of QUICK) {
      const sp = splitPkey(q.key);
      const c = byId.get(sp.catKey);
      if (!c) continue;
      // multi-session chapters opened without a session show the session that fits the current time
      const sess = SESSIONS[sp.catKey] ? (sp.session || defaultSession(sp.catKey)) : null;
      const pk = sess ? `${sp.catKey}:${sess}` : q.key;
      const opt = sess && !sp.session ? SESSIONS[sp.catKey].options.find((o) => o.id === sess) : null;
      const p = progressOf(sessionItems(sp.catKey, sess, c.items), dhikr[pk]);
      tiles.push(h('a', { class: 'tile adhkar-tile' + (p.complete ? ' done' : ''), href: '#/adhkar/' + q.key },
        h('div', { class: 'adhkar-tile-top' }, icon(q.icon, { size: 24 }), p.complete && doneBadge()),
        h('div', { class: 'tile-title' }, opt ? `${q.title} · ${opt.label}` : q.title),
        h('div', { class: 'tile-sub' },
          p.complete ? 'اكتمل اليوم' : p.done > 0 ? h('span', { class: 'num' }, `${p.done} / ${p.total}`) : countLabel(p.total)),
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { style: { width: (p.total ? (p.done / p.total) * 100 : 0) + '%' } })),
      ));
    }
    if (tiles.length) {
      out.push(h('h2', { class: 'section-title' }, 'الأساسية'), h('div', { class: 'adhkar-tiles' }, tiles));
    }

    // favourites
    const customs = store.listCustomCats();
    const favRows = [];
    for (const key of store.listFavs()) {
      if (key.startsWith('c:')) {
        const c = customs.find((x) => 'c:' + x.id === key);
        if (c) favRows.push(customRow(c, dhikr));
      } else if (byId.has(key)) {
        favRows.push(builtinRow(byId.get(key), dhikr, { badge: icon('heart', { size: 19, fill: true }) }));
      }
    }
    if (favRows.length) {
      out.push(h('h2', { class: 'section-title' }, 'المفضلة'), h('div', { class: 'list adhkar-list' }, favRows));
    }

    // the user's own adhkar
    out.push(h('h2', { class: 'section-title' },
      h('span', null, 'أذكاري'),
      h('button', { type: 'button', class: 'adhkar-section-btn', onclick: addCategory }, icon('plus', { size: 16 }), 'مجموعة جديدة'),
    ));
    if (customs.length) {
      out.push(
        h('div', { class: 'list adhkar-list' }, customs.map((c) => customRow(c, dhikr))),
        h('button', { type: 'button', class: 'btn btn-outline btn-block adhkar-add-btn', onclick: addDhikr }, icon('plus', { size: 20 }), 'إضافة ذكر جديد'),
      );
    } else {
      out.push(h('div', { class: 'card gilded adhkar-cta' },
        h('div', { class: 'adhkar-cta-icon' }, icon('edit', { size: 24 })),
        h('div', { class: 'adhkar-cta-text' },
          h('div', { class: 'adhkar-cta-title' }, 'أضف أذكارك الخاصة'),
          h('p', { class: 'adhkar-cta-sub' }, 'اكتب أدعيتك وأورادك، حدّد عدد التكرار، وتابعها كل يوم مع بقية الأذكار.'),
        ),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: addDhikr }, icon('plus', { size: 20 }), 'إضافة ذكر'),
      ));
    }

    // all categories
    out.push(
      h('h2', { class: 'section-title' }, h('span', null, 'حصن المسلم'), h('span', { class: 'adhkar-section-count' }, `${cats.length} بابًا`)),
      h('div', { class: 'list adhkar-list' }, cats.map((c) => builtinRow(c, dhikr))),
    );
    return out;
  }

  function resultNodes(cats, q, dhikr) {
    const hits = [];
    for (const c of store.listCustomCats()) {
      const items = c.items || [];
      const titleHit = normalizeAr(c.title).includes(q);
      const item = items.find((it) => normalizeAr(it.text).includes(q)) || null;
      if (titleHit || item) hits.push({ custom: true, cat: c, titleHit, item });
    }
    for (const e of getBuiltinIndex(cats)) {
      const titleHit = e.title.includes(q);
      const i = e.texts.findIndex((t) => t.includes(q));
      if (titleHit || i >= 0) hits.push({ custom: false, cat: e.cat, titleHit, item: i >= 0 ? e.cat.items[i] : null });
    }
    if (!hits.length) {
      return [h('div', { class: 'empty' },
        icon('search', { size: 40 }),
        h('div', { class: 'empty-title' }, 'لا نتائج'),
        h('p', null, 'جرّب كلمة أخرى، أو اكتبها بدون تشكيل.'),
      )];
    }
    hits.sort((a, b) => Number(b.titleHit) - Number(a.titleHit));
    const rows = hits.map((hit) => {
      const key = hit.custom ? 'c:' + hit.cat.id : String(hit.cat.id);
      // Matched inside a dhikr: preview its (verbatim, CSS-clamped) text and jump to it in the reader.
      const extra = !hit.titleHit && hit.item
        ? { snippet: hit.item.text, onclick: () => { pendingFocus = { key, itemId: hit.item.id }; } }
        : {};
      return hit.custom
        ? catRow({ key, title: hit.cat.title, badge: icon('bookmark', { size: 19 }), sub: countLabel((hit.cat.items || []).length), ...extra })
        : builtinRow(hit.cat, dhikr, extra);
    });
    return [
      h('h2', { class: 'section-title' }, h('span', null, 'نتائج البحث'), h('span', { class: 'adhkar-section-count num' }, String(hits.length))),
      h('div', { class: 'list adhkar-list' }, rows),
    ];
  }

  async function update() {
    const my = ++seq;
    let cats;
    try {
      cats = await loadAdhkar();
    } catch (e) {
      console.error(e);
      if (!alive || my !== seq) return;
      body.replaceChildren(h('div', { class: 'empty' },
        icon('info', { size: 40 }),
        h('div', { class: 'empty-title' }, 'تعذّر تحميل الأذكار'),
        h('p', null, 'تحقق من اكتمال تثبيت التطبيق ثم أعد المحاولة.'),
        h('button', { type: 'button', class: 'btn btn-outline adhkar-empty-btn', onclick: () => update() }, 'إعادة المحاولة'),
      ));
      return;
    }
    let dhikr = {};
    try { dhikr = ((await store.getDay()) || {}).dhikr || {}; } catch (e) { console.error(e); }
    if (!alive || my !== seq) return;
    const q = normalizeAr(input.value);
    body.replaceChildren(...(q ? resultNodes(cats, q, dhikr) : sectionNodes(cats, dhikr)));
  }

  const refresh = debounce(() => { if (alive) update(); }, 140);
  const off = store.on((type) => {
    if (type === 'day' || type === 'favs' || type === 'customCats' || type === 'import') refresh();
  });

  await update();

  return () => {
    alive = false;
    off();
    S.closeAll();
  };
}

/* ───────────── reader ───────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function notFound(root, { title, message, retry }) {
  root.append(
    pageHeader({ title: 'الأذكار', back: '/adhkar' }),
    h('div', { class: 'empty' },
      icon('info', { size: 40 }),
      h('div', { class: 'empty-title' }, title),
      h('p', null, message),
      retry
        ? h('button', { type: 'button', class: 'btn btn-outline adhkar-empty-btn', onclick: retry }, 'إعادة المحاولة')
        : h('a', { class: 'btn btn-outline adhkar-empty-btn', href: '#/adhkar' }, 'كل الأذكار'),
    ),
  );
}

async function renderReader(root, params) {
  let alive = true;
  const timers = new Set();
  const S = sheetTracker();
  const cleanup = () => {
    alive = false;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    S.closeAll();
  };
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms);
    timers.add(t);
  };

  const rawKey = String(params && params.key != null ? params.key : '');
  let cat = null;
  try {
    cat = await getCategory(rawKey);
  } catch (e) {
    console.error(e);
    notFound(root, {
      title: 'تعذّر تحميل الأذكار',
      message: 'تحقق من اكتمال تثبيت التطبيق ثم أعد المحاولة.',
      retry: () => { root.replaceChildren(); renderReader(root, params); },
    });
    return cleanup;
  }
  if (!cat) {
    notFound(root, { title: 'لم نعثر على هذا الباب', message: 'ربما حُذف أو أن الرابط غير صحيح.' });
    return cleanup;
  }

  root.classList.add('adhkar-reader');
  const isCustom = cat.custom;
  const customId = isCustom ? splitPkey(cat.key).id : null;
  // Multi-session chapters (morning/evening, after each of the five prayers): one set of counters per session.
  const sessDef = !isCustom ? SESSIONS[cat.key] || null : null;
  const isAmPm = !!sessDef;
  const readOnly = !isCustom && READ_ONLY.has(cat.key);
  if (readOnly) root.classList.add('read-only');
  const urlSession = splitPkey(rawKey).session;
  let session = null;
  if (sessDef) session = sessDef.options.some((o) => o.id === urlSession) ? urlSession : defaultSession(cat.key);
  const sessOpt = () => sessDef.options.find((o) => o.id === session);
  const pkeyOf = () => (sessDef ? `${cat.key}:${session}` : cat.key);
  let pkey = pkeyOf();
  const viewItems = () => (isCustom ? cat.items : sessionItems(cat.key, session, cat.items));
  const titleFor = () => (sessDef ? sessOpt().title : cat.title);
  const subFor = () => (isCustom ? 'من أذكاري · ' : '') + countLabel(viewItems().length);

  // Counters: after the first load of a pkey, memory is the source of truth (writes are queued in the store).
  const cache = {};
  let counts = {};
  let loadedDay = todayKey();
  let saveWarned = false;
  let switching = 0; // token of the am/pm switch in flight (0 = none)
  let cards = [];

  /* header */
  let fav = store.isFav(cat.key);
  const favBtn = iconButton('heart', 'المفضلة', async () => {
    try {
      fav = await store.toggleFav(cat.key);
    } catch (e) { console.error(e); return; }
    syncFav();
    toast(fav ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة', { icon: 'heart' });
  }, { fill: fav, active: fav });
  function syncFav() {
    favBtn.classList.toggle('active', fav);
    favBtn.setAttribute('aria-pressed', String(fav));
    favBtn.setAttribute('aria-label', fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة');
    favBtn.title = fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة';
    favBtn.replaceChildren(icon('heart', { fill: fav }));
  }
  syncFav();
  const header = pageHeader({
    title: titleFor(), subtitle: subFor(), back: '/adhkar',
    actions: [favBtn, iconButton('more', 'خيارات', () => openMenu())],
  });
  const titleEl = header.querySelector('.ph-title');
  const subEl = header.querySelector('.ph-sub');
  const syncHeader = () => {
    if (titleEl) titleEl.textContent = titleFor();
    if (subEl) subEl.textContent = subFor();
  };

  /* morning / evening */
  let seg = null;
  const segBtns = {};
  if (sessDef) {
    const mk = (o) => (segBtns[o.id] = h('button', { type: 'button', onclick: () => setSession(o.id) }, o.icon && icon(o.icon, { size: 18 }), o.label));
    seg = h('div', { class: 'seg adhkar-seg' + (sessDef.options.length > 2 ? ' adhkar-seg-many' : ''), role: 'group', 'aria-label': sessDef.label }, sessDef.options.map(mk));
  }
  const syncSeg = () => {
    for (const [s, b] of Object.entries(segBtns)) {
      b.classList.toggle('active', s === session);
      b.setAttribute('aria-pressed', String(s === session));
    }
  };
  syncSeg();

  /* overall progress */
  const progNum = h('span', { class: 'num reader-progress-num' });
  const progBar = h('i');
  const progEl = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'تقدّم اليوم', 'aria-valuemin': '0' }, progBar);
  const progBox = h('div', { class: 'reader-progress' },
    h('div', { class: 'between' }, h('span', { class: 'reader-progress-label' }, 'تقدّم اليوم'), progNum),
    progEl,
  );

  const listEl = h('div', { class: 'dhikr-list' });
  const doneHost = h('div', { class: 'adhkar-complete-host' });

  root.append(...[header, seg, progBox, listEl, doneHost].filter(Boolean));
  if (isCustom) {
    root.classList.add('has-fab');
    root.append(h('button', { type: 'button', class: 'fab', 'aria-label': 'إضافة ذكر', title: 'إضافة ذكر', onclick: () => addItem() }, icon('plus', { size: 26, stroke: 2 })));
  }

  /* state sync */
  function syncProgress() {
    const total = cards.length;
    const done = cards.filter((c) => c.isDone()).length;
    progBox.hidden = total === 0 || readOnly;
    progNum.textContent = `${done} / ${total}`;
    progBar.style.width = (total ? (done / total) * 100 : 0) + '%';
    progEl.setAttribute('aria-valuemax', String(total));
    progEl.setAttribute('aria-valuenow', String(done));
  }
  const allDone = () => !readOnly && cards.length > 0 && cards.every((c) => c.isDone());
  function syncComplete() {
    const done = allDone();
    root.classList.toggle('all-done', done);
    if (!done) { doneHost.replaceChildren(); return; }
    if (doneHost.firstChild) return;
    doneHost.append(h('div', { class: 'card hero adhkar-complete' },
      h('div', { class: 'adhkar-complete-icon' }, icon('check', { size: 30, stroke: 2.2 })),
      h('div', { class: 'adhkar-complete-title' }, 'أتممتَ ' + titleFor()),
      h('p', { class: 'adhkar-complete-sub' }, 'تقبّل الله منك، وجعلك من الذاكرين.'),
      h('div', { class: 'ornament', 'aria-hidden': 'true' }, icon('sparkle', { size: 16 })),
      h('a', { class: 'btn btn-outline', href: '#/adhkar' }, 'العودة إلى الأذكار'),
    ));
  }
  function refreshAll() {
    for (const c of cards) c.sync();
    syncProgress();
    syncComplete();
  }

  function scrollToEl(el) {
    if (!alive || !el || !el.isConnected) return;
    const tall = el.offsetHeight > window.innerHeight * 0.7;
    el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: tall ? 'start' : 'center' });
  }
  function pop(el) {
    if (!el.animate || reducedMotion()) return;
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'cubic-bezier(0.22, 0.8, 0.26, 1)' },
    );
  }

  function persist(key, itemId, n) {
    store.setDhikr(key, itemId, n).catch((e) => {
      console.error(e);
      if (!saveWarned && alive) { saveWarned = true; toast('تعذّر حفظ العدّ على هذا الجهاز'); }
    });
  }
  /** Counters are per day: if midnight passed while the reader was open, start the new day from zero. */
  function checkDay() {
    const today = todayKey();
    if (today === loadedDay) return;
    loadedDay = today;
    for (const k of Object.keys(cache)) delete cache[k];
    counts = cache[pkey] = {};
    refreshAll();
  }

  /** Today's counters for a pkey (read from the store once, then kept in memory). */
  async function countsFor(key) {
    if (!cache[key]) {
      const day = loadedDay;
      let c = {};
      try { c = await store.getDhikr(key); } catch (e) { console.error(e); }
      if (day !== loadedDay) c = {};
      if (!cache[key]) cache[key] = { ...c };
    }
    return cache[key];
  }

  function onAllDone() {
    haptic(60);
    syncComplete();
    later(() => scrollToEl(doneHost.firstChild), 450);
    store.completeLinked('adhkar', pkey).then((titles) => {
      if (!alive || !titles || !titles.length) return;
      toast(
        titles.length === 1 ? `تم تأشير «${titles[0]}» في قائمة اليوم` : 'تم تأشير أهدافك في قائمة اليوم',
        { icon: 'check', duration: 3200 },
      );
    }).catch((e) => console.error(e));
  }

  /* one card per dhikr */
  function buildCard(item, index) {
    const target = targetOf(item);
    const current = () => Math.min(target, Math.max(0, counts[item.id] || 0));

    const numEl = h('span', { class: 'counter-num num' });
    const ringBar = svgEl('circle', { class: 'counter-ring-bar', cx: 50, cy: 50, r: RING_R, 'stroke-dasharray': RING_C });
    const ringSvg = svgEl('svg', { class: 'counter-ring', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
    ringSvg.append(svgEl('circle', { class: 'counter-ring-track', cx: 50, cy: 50, r: RING_R }), ringBar);
    const btn = h('button', { type: 'button', class: 'counter', onclick: () => tap() },
      ringSvg,
      h('span', { class: 'counter-face' },
        numEl,
        h('span', { class: 'counter-of' }, `من ${target}`),
        icon('check', { size: 36, stroke: 2.4, class: 'counter-check' }),
      ),
    );
    const undoBtn = h('button', { type: 'button', class: 'icon-btn dhikr-undo', 'aria-label': 'تراجع عن عدّة واحدة', title: 'تراجع', onclick: () => undo() }, icon('minus', { size: 20 }));
    const statusEl = h('span', { class: 'dhikr-status' });
    const liveEl = h('span', { class: 'adhkar-sr', 'aria-live': 'polite' });

    const el = h('article', { class: 'card dhikr-card', dataset: { item: String(item.id) } },
      h('div', { class: 'dhikr-head' },
        h('span', { class: 'dhikr-index num' }, String(index + 1)),
        !readOnly && h('span', { class: 'badge' }, repeatLabel(target)),
        isCustom && h('span', { class: 'dhikr-actions' },
          iconButton('edit', 'تعديل الذكر', () => editItem(item), { size: 20 }),
          iconButton('trash', 'حذف الذكر', () => deleteItem(item), { size: 20 }),
        ),
      ),
      h('p', { class: 'ar-text dhikr-text' }, item.text),
      item.note && h('p', { class: 'dhikr-note' }, item.note),
      !isCustom && QURAN_PARTS[`${cat.key}.${item.id}`] && quranParts(QURAN_PARTS[`${cat.key}.${item.id}`]),
      // takhrij: taken verbatim from the footnotes of حصن المسلم (see tools/build-data.js)
      item.ref && h('p', { class: 'dhikr-ref' }, h('span', { class: 'dhikr-ref-label' }, 'التخريج'), item.ref),
      !readOnly && h('div', { class: 'dhikr-foot' }, undoBtn, btn, statusEl),
      liveEl,
    );

    function sync() {
      const n = current();
      const done = n >= target;
      el.classList.toggle('done', done);
      numEl.textContent = String(n);
      ringBar.style.strokeDashoffset = String(RING_C * (1 - n / target));
      btn.setAttribute('aria-label', done ? `اكتمل هذا الذكر: ${target} من ${target}` : `عُدّ الذكر: ${n} من ${target}`);
      undoBtn.hidden = n === 0;
      statusEl.textContent = done ? 'اكتمل' : n > 0 ? `المتبقي ${target - n}` : '';
    }
    function tap() {
      checkDay();
      const cur = current();
      if (cur >= target) return;
      const n = cur + 1;
      counts[item.id] = n;
      persist(pkey, item.id, n);
      const done = n >= target;
      haptic(done ? 32 : 12);
      sync();
      pop(done ? btn : numEl);
      liveEl.textContent = done ? 'اكتمل' : `${n} من ${target}`;
      if (!done) return;
      syncProgress();
      const i = cards.indexOf(card);
      const next = [...cards.slice(i + 1), ...cards.slice(0, i)].find((c) => !c.isDone());
      if (next) later(() => { if (!next.isDone()) scrollToEl(next.el); }, 420);
      else onAllDone();
    }
    function undo() {
      checkDay();
      const cur = current();
      if (cur <= 0) return;
      const n = cur - 1;
      counts[item.id] = n;
      persist(pkey, item.id, n);
      haptic(8);
      sync();
      liveEl.textContent = `${n} من ${target}`;
      syncProgress();
      syncComplete();
      if (n === 0) btn.focus();
    }

    const card = { item, el, sync, isDone: () => current() >= target };
    return card;
  }

  function buildList() {
    cards = viewItems().map((it, i) => buildCard(it, i));
    if (cards.length) {
      listEl.replaceChildren(...cards.map((c) => c.el));
    } else {
      listEl.replaceChildren(h('div', { class: 'empty' },
        icon('beads', { size: 40 }),
        h('div', { class: 'empty-title' }, 'لا أذكار في هذه المجموعة بعد'),
        h('p', null, isCustom ? 'أضف أول ذكر أو دعاء لتبدأ العدّ والمتابعة اليومية.' : 'لا يحتوي هذا الباب على أذكار.'),
        isCustom && h('button', { type: 'button', class: 'btn btn-primary adhkar-empty-btn', onclick: () => addItem() }, icon('plus', { size: 20 }), 'إضافة ذكر'),
      ));
    }
  }

  async function setSession(s) {
    if (!isAmPm || (s === session && !switching)) return;
    // pkey and counts are swapped together, only once the new counters are loaded,
    // so a tap during the switch can never be written under the wrong session.
    const my = ++switching;
    const next = await countsFor(`${cat.key}:${s}`);
    if (!alive || my !== switching) return;
    switching = 0;
    session = s;
    pkey = pkeyOf();
    counts = cache[pkey] || next;
    syncSeg();
    syncHeader();
    buildList(); // the adhkar (and some repeat counts) differ from one session to another
    // Keep the URL in sync (reload-safe) without triggering a route re-render.
    try { history.replaceState(history.state, '', '#/adhkar/' + pkey); } catch { /* ignore */ }
    doneHost.replaceChildren(); // its title depends on the session
    refreshAll();
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /* custom category editing */
  function reloadCat(focusItemId) {
    const fresh = store.getCustomCat(customId);
    if (!fresh) { navigate('/adhkar', { replace: true }); return; }
    cat = { key: cat.key, title: fresh.title, items: fresh.items || [], custom: true };
    syncHeader();
    buildList();
    refreshAll();
    if (focusItemId) {
      const c = cards.find((x) => x.item.id === focusItemId);
      if (c) later(() => scrollToEl(c.el), 260);
    }
  }
  function addItem() {
    const before = new Set(cat.items.map((it) => it.id));
    openDhikrForm(S, {
      catId: customId,
      onSaved: (saved) => {
        if (!alive) return;
        const added = (saved.items || []).find((it) => !before.has(it.id));
        reloadCat(added && added.id);
      },
    });
  }
  function editItem(item) {
    openDhikrForm(S, { catId: customId, item, onSaved: () => { if (alive) reloadCat(); } });
  }
  async function deleteItem(item) {
    const ok = await confirmSheet({
      title: 'حذف الذكر', message: 'سيُحذف هذا الذكر من مجموعتك نهائيًا.', confirmLabel: 'حذف', danger: true,
    });
    if (!ok || !alive) return;
    const fresh = store.getCustomCat(customId);
    if (!fresh) { reloadCat(); return; }
    fresh.items = (fresh.items || []).filter((it) => it.id !== item.id);
    try {
      await store.saveCustomCat(fresh);
    } catch (e) { console.error(e); toast('تعذّر الحذف'); return; }
    if (!alive) return;
    reloadCat();
    toast('تم حذف الذكر', { icon: 'trash' });
  }
  function renameCat() {
    openCatForm(S, {
      cat: { id: customId, title: cat.title },
      onSaved: () => { if (alive) { reloadCat(); toast('تم تغيير الاسم', { icon: 'check' }); } },
    });
  }
  async function deleteCat() {
    const ok = await confirmSheet({
      title: 'حذف المجموعة', message: `ستُحذف «${cat.title}» وكل ما فيها من أذكار نهائيًا.`, confirmLabel: 'حذف المجموعة', danger: true,
    });
    if (!ok || !alive) return;
    try {
      await store.deleteCustomCat(customId);
      if (store.isFav(cat.key)) await store.toggleFav(cat.key);
    } catch (e) { console.error(e); toast('تعذّر الحذف'); return; }
    toast('تم حذف المجموعة', { icon: 'trash' });
    navigate('/adhkar', { replace: true });
  }

  /* menu actions */
  async function resetToday() {
    const ok = await confirmSheet({
      title: 'تصفير العدّادات', message: `سيبدأ عدّ اليوم في «${titleFor()}» من الصفر.`, confirmLabel: 'تصفير', danger: true,
    });
    if (!ok || !alive) return;
    const key = pkey;
    cache[key] = {};
    if (key === pkey) counts = cache[key];
    loadedDay = todayKey();
    refreshAll();
    try {
      await store.resetDhikr(key);
    } catch (e) { console.error(e); toast('تعذّر التصفير'); return; }
    if (!alive) return;
    toast('تم تصفير عدّادات اليوم', { icon: 'refresh' });
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
  async function addToChecklist() {
    const key = pkey;
    const exists = store.listGoals().some((g) => g.link && g.link.kind === 'adhkar' && String(g.link.key) === key);
    if (exists) { toast('موجود مسبقًا في قائمة اليوم', { icon: 'checklist' }); return; }
    try {
      const title = (await pkeyTitle(key)) || titleFor();
      await store.saveGoal({ title, icon: 'beads', link: { kind: 'adhkar', key } });
      // Already finished today? Then the new goal starts ticked.
      if (alive && key === pkey && allDone()) await store.completeLinked('adhkar', key);
      toast('أُضيف إلى قائمة اليوم', { icon: 'checklist' });
    } catch (e) {
      console.error(e);
      toast('تعذّرت الإضافة إلى القائمة');
    }
  }
  function openMenu() {
    const action = (ic, label, fn, danger) => h('button', {
      type: 'button', class: 'row' + (danger ? ' danger' : ''),
      onclick: () => { sheet.close(); fn(); },
    },
    h('span', { class: 'row-badge' }, icon(ic, { size: 20 })),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label)));
    const sheet = S.open({
      title: titleFor(),
      body: h('div', { class: 'list adhkar-menu' },
        isCustom && action('plus', 'إضافة ذكر', addItem),
        !readOnly && action('checklist', 'إضافة إلى قائمة اليوم', addToChecklist),
        !readOnly && action('refresh', 'تصفير عدّادات اليوم', resetToday),
        readOnly && h('p', { class: 'sheet-msg' }, 'هذا الباب أحاديث في الفضل تُقرأ للتذكّر، وليس وِردًا يُعدّ.'),
        isCustom && action('edit', 'إعادة تسمية المجموعة', renameCat),
        isCustom && action('trash', 'حذف المجموعة', deleteCat, true),
      ),
    });
  }

  /* first paint */
  counts = await countsFor(pkey);
  buildList();
  refreshAll();

  const focus = pendingFocus && splitPkey(pendingFocus.key).catKey === cat.key ? pendingFocus : null;
  pendingFocus = null;
  if (focus) {
    const c = cards.find((x) => x.item.id === focus.itemId);
    if (c) later(() => { scrollToEl(c.el); c.el.classList.add('flash'); later(() => c.el.classList.remove('flash'), 1800); }, 380);
  } else {
    // Resume where the user stopped earlier today.
    const firstOpen = cards.findIndex((c) => !c.isDone());
    if (firstOpen > 0) later(() => scrollToEl(cards[firstOpen].el), 380);
  }

  return cleanup;
}

/* ───────────── routes ───────────── */

export const routes = [
  { path: '/adhkar', tab: 'adhkar', render: renderIndex },
  { path: '/adhkar/:key', tab: 'adhkar', immersive: true, render: renderReader },
];
