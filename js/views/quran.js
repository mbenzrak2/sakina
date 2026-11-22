// Sakina — Quran: surah index + mushaf-style reader.
//
// The Quran text comes from data/quran.json and is rendered verbatim (textContent only):
// nothing here edits, trims, normalises or generates a verse. The basmala shown above a
// surah is taken from the dataset itself (surah 1, ayah 1).
import { store } from '../store.js';
import { loadQuran, normalizeAr } from '../data.js';
import { h, icon, clear, pageHeader, openSheet, toast, toArabicDigits, haptic, debounce } from '../ui.js';

const TYPE_LABEL = { meccan: 'مكية', medinan: 'مدنية' };
const SCALE_MIN = 0.8;
const SCALE_MAX = 1.8;
const SCALE_STEP = 0.1;
const SAVE_EVERY = 1500; // ms between two automatic writes of the reading position

// index filters survive a round trip to the reader
const indexState = { q: '', type: 'all' };

/* ───────────── helpers ───────────── */

const typeLabel = (t) => TYPE_LABEL[t] || '';
/** 7 → "7 آيات", 286 → "286 آية" */
const ayahCount = (n) => (n >= 3 && n <= 10 ? `${n} آيات` : `${n} آية`);
const clampScale = (v) => Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(v) || 1)) * 100) / 100;
const toWesternDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

function copyIcon(size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ` +
    'stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="12" rx="2.5"/>' +
    '<path d="M15.5 8.500V6a2.500 2.500 0 0 0-2.500-2.500H7A2.500 2.500 0 0 0 4.500 6v7A2.500 2.500 0 0 0 7 15.500h1.500"/></svg>';
  return span;
}

const diamond = () => h('i', { class: 'q-diamond', 'aria-hidden': 'true' });

function loadingState() {
  return h('div', { class: 'empty q-loading', role: 'status' },
    h('div', { class: 'q-spinner', 'aria-hidden': 'true' }),
    h('p', null, 'جارٍ تحميل المصحف…'));
}
function loadError() {
  return h('div', { class: 'empty' },
    icon('info', { size: 34 }),
    h('p', { class: 'empty-title' }, 'تعذّر تحميل المصحف'),
    h('p', null, 'حاول مرة أخرى.'),
    h('p', { class: 'q-empty-action' },
      h('button', { class: 'btn btn-outline', onclick: () => location.reload() }, icon('refresh', { size: 18 }), 'إعادة المحاولة')));
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = h('textarea', { class: 'q-copy-buffer', readonly: true, 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function validMark(quran, m) {
  if (!m) return null;
  const su = quran[Number(m.s) - 1];
  const a = Number(m.a);
  if (!su || !Number.isInteger(a) || a < 1 || a > su.verses.length) return null;
  return { su, a };
}

/* ───────────── index ───────────── */

async function renderIndex(root) {
  root.classList.add('q-index');
  const dropClass = () => root.classList.remove('q-index');
  root.append(pageHeader({ title: 'القرآن الكريم', subtitle: '114 سورة' }));
  const body = h('div', { class: 'q-body' }, loadingState());
  root.append(body);

  let quran;
  try {
    quran = await loadQuran();
  } catch {
    clear(body).append(loadError());
    return dropClass;
  }
  if (!root.isConnected) return dropClass;

  const entries = quran.map((su) => ({
    su,
    kAr: normalizeAr(su.name),
    kTr: String(su.tr).toLowerCase().replace(/[^a-z0-9]/g, ''),
    row: surahRow(su),
  }));

  const heroHost = h('div', { class: 'q-hero-host' });
  const marksHost = h('div', { class: 'q-marks-host' });
  const listHost = h('div', { class: 'list q-list' });
  const countEl = h('span', { class: 'q-count num' });
  const emptyEl = h('div', { class: 'empty', hidden: true },
    icon('search', { size: 34 }),
    h('p', { class: 'empty-title' }, 'لا توجد نتائج'),
    h('p', null, 'جرّب اسمًا آخر أو رقم السورة.'));

  function matches(e, raw) {
    if (indexState.type !== 'all' && e.su.type !== indexState.type) return false;
    const q = toWesternDigits(raw).trim();
    if (!q) return true;
    if (/^\d+$/.test(q)) return String(e.su.id).startsWith(String(Number(q)));
    const ar = normalizeAr(q).replace(/^سوره\s*/, '');
    const lat = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ar && !lat) return true;
    if (ar && (e.kAr.includes(ar) || e.kAr.replace(/\s/g, '').includes(ar.replace(/\s/g, '')))) return true;
    return !!lat && e.kTr.includes(lat);
  }
  function applyFilter() {
    const rows = entries.filter((e) => matches(e, indexState.q)).map((e) => e.row);
    listHost.replaceChildren(...rows);
    listHost.hidden = rows.length === 0;
    emptyEl.hidden = rows.length !== 0;
    countEl.textContent = String(rows.length);
  }

  function renderHero() {
    clear(heroHost);
    const m = validMark(quran, store.getQuran().last);
    if (!m) return;
    const pct = Math.max(2, Math.round((m.a / m.su.verses.length) * 100));
    heroHost.append(
      h('a', { class: 'card hero q-continue', href: `#/quran/${m.su.id}/${m.a}`, 'aria-label': `متابعة القراءة: سورة ${m.su.name}، الآية ${m.a}` },
        h('div', { class: 'between' },
          h('span', { class: 'badge' }, 'متابعة القراءة'),
          h('span', { class: 'q-continue-go' }, icon('chevron', { size: 20 }))),
        h('h2', { class: 'q-continue-name' }, `سورة ${m.su.name}`),
        h('p', { class: 'q-continue-sub' }, 'الآية ', h('span', { class: 'num' }, String(m.a)), ' من ', h('span', { class: 'num' }, String(m.su.verses.length))),
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } }))));
  }

  function renderMarks() {
    clear(marksHost);
    const marks = (store.getQuran().bookmarks || [])
      .map((b) => ({ b, m: validMark(quran, b) }))
      .filter((x) => x.m)
      .sort((x, y) => (y.b.ts || 0) - (x.b.ts || 0));
    if (!marks.length) return;
    const list = h('div', { class: 'list' });
    for (const { m } of marks) {
      const label = `سورة ${m.su.name} · الآية ${m.a}`;
      list.append(h('div', { class: 'row q-mark' },
        h('a', { class: 'q-mark-link', href: `#/quran/${m.su.id}/${m.a}` },
          h('span', { class: 'row-badge' }, icon('bookmark', { size: 18, fill: true })),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title q-mark-title' }, 'سورة ', m.su.name, ' · الآية ', h('span', { class: 'num' }, String(m.a))),
            // verbatim verse, visually truncated by CSS only
            h('span', { class: 'q-mark-verse' }, m.su.verses[m.a - 1]))),
        h('button', {
          class: 'icon-btn q-mark-remove', 'aria-label': `إزالة العلامة: ${label}`, title: 'إزالة العلامة',
          onclick: async () => {
            const cur = store.getQuran().bookmarks || [];
            await store.setQuran({ bookmarks: cur.filter((x) => !(Number(x.s) === m.su.id && Number(x.a) === m.a)) });
            haptic();
            toast('أُزيلت العلامة', { icon: 'bookmark' });
          },
        }, icon('trash', { size: 19 }))));
    }
    marksHost.append(
      h('div', { class: 'section-title' }, h('span', null, 'العلامات'), h('span', { class: 'q-count num' }, String(marks.length))),
      list);
  }

  const input = h('input', {
    type: 'search', value: indexState.q, placeholder: 'ابحث باسم السورة أو رقمها',
    'aria-label': 'البحث في السور', autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false',
    oninput: debounce(() => { indexState.q = input.value; applyFilter(); }, 150),
  });
  const chipDefs = [['all', 'الكل'], ['meccan', 'مكية'], ['medinan', 'مدنية']];
  const chips = chipDefs.map(([key, label]) => h('button', {
    class: 'chip' + (indexState.type === key ? ' active' : ''), type: 'button',
    'aria-pressed': String(indexState.type === key),
    onclick: () => {
      indexState.type = key;
      chips.forEach((c, i) => {
        const on = chipDefs[i][0] === key;
        c.classList.toggle('active', on);
        c.setAttribute('aria-pressed', String(on));
      });
      applyFilter();
    },
  }, label));

  clear(body).append(
    heroHost,
    h('div', { class: 'q-tools' },
      h('label', { class: 'search' }, icon('search', { size: 20 }), input),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'تصفية السور' }, chips)),
    marksHost,
    h('div', { class: 'section-title' }, h('span', null, 'السور'), countEl),
    listHost,
    emptyEl);

  renderHero();
  renderMarks();
  applyFilter();

  const off = store.on((type) => {
    if (type === 'quran' || type === 'import') { renderHero(); renderMarks(); }
  });
  return () => { off(); dropClass(); };
}

function surahRow(su) {
  return h('a', { class: 'row q-row', href: `#/quran/${su.id}` },
    h('span', { class: 'row-badge num' }, String(su.id)),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title q-name' }, su.name),
      h('span', { class: 'row-sub q-row-sub' },
        h('span', { class: 'q-tr', dir: 'ltr', lang: 'en' }, su.tr),
        h('span', { class: 'q-dot', 'aria-hidden': 'true' }, '·'),
        h('span', null, ayahCount(su.verses.length)))),
    h('span', { class: 'row-end' },
      h('span', { class: 'badge q-type' }, typeLabel(su.type)),
      icon('chevron', { size: 18 })));
}

/* ───────────── reader ───────────── */

async function renderReader(root, params) {
  root.classList.add('q-reader');
  const dropClass = () => root.classList.remove('q-reader');

  const sRaw = String(params && params.s != null ? params.s : '');
  const s = /^\d{1,3}$/.test(sRaw) ? Number(sRaw) : 0;
  if (s < 1 || s > 114) {
    root.append(
      pageHeader({ title: 'القرآن الكريم', back: '/quran' }),
      h('div', { class: 'empty' },
        icon('quran', { size: 36 }),
        h('p', { class: 'empty-title' }, 'السورة غير موجودة'),
        h('p', null, 'رقم السورة يجب أن يكون بين 1 و114.'),
        h('p', { class: 'q-empty-action' }, h('a', { class: 'btn btn-outline', href: '#/quran' }, 'العودة إلى الفهرس'))));
    return dropClass;
  }

  const loading = loadingState();
  root.append(loading);
  let quran;
  try {
    quran = await loadQuran();
  } catch {
    loading.remove();
    root.append(pageHeader({ title: 'القرآن الكريم', back: '/quran' }), loadError());
    return dropClass;
  }
  loading.remove();
  if (!root.isConnected) return dropClass;

  const su = quran[s - 1];
  const verses = su.verses;
  const total = verses.length;
  const aRaw = String(params && params.a != null ? params.a : '');
  const targetA = /^\d{1,3}$/.test(aRaw) ? Math.min(total, Math.max(1, Number(aRaw))) : 0;

  /* state */
  let disposed = false;
  let scale = clampScale(store.getQuran().scale);
  let current = targetA || 1;   // ayah nearest the top of the viewport
  let dirty = false;            // `current` not yet persisted
  let lastWrite = 0;
  let saveTimer = 0;
  let scrollTimer = 0;
  let settling = true;          // initial positioning in progress
  let userMoved = false;
  let openSheetRef = null;
  const timers = [];

  /* header */
  const btnMinus = h('button', { class: 'icon-btn q-size', type: 'button', 'aria-label': 'تصغير الخط', title: 'تصغير الخط', onclick: () => setScale(scale - SCALE_STEP) },
    h('span', { class: 'q-size-glyph q-size-sm', dir: 'ltr', 'aria-hidden': 'true' }, 'A−'));
  const btnPlus = h('button', { class: 'icon-btn q-size', type: 'button', 'aria-label': 'تكبير الخط', title: 'تكبير الخط', onclick: () => setScale(scale + SCALE_STEP) },
    h('span', { class: 'q-size-glyph', dir: 'ltr', 'aria-hidden': 'true' }, 'A+'));
  const header = pageHeader({
    title: `سورة ${su.name}`,
    subtitle: `${typeLabel(su.type)} · ${ayahCount(total)}`,
    back: '/quran',
    actions: [btnMinus, btnPlus],
  });

  /* verses — one fragment, no per-ayah listeners */
  const marked = new Set((store.getQuran().bookmarks || []).filter((b) => Number(b.s) === s).map((b) => Number(b.a)));
  const ayahEls = new Array(total);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i++) {
    const a = i + 1;
    const el = document.createElement('span');
    el.className = marked.has(a) ? 'ayah is-marked' : 'ayah';
    el.dataset.a = String(a);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const t = document.createElement('span');
    t.className = 'ayah-t';
    t.textContent = verses[i]; // verbatim
    const n = document.createElement('span');
    n.className = 'ayah-n';
    n.textContent = toArabicDigits(a);
    el.append(t, ' ', n); // no-break space keeps the marker on the line of the last word
    ayahEls[i] = el;
    frag.append(el, ' ');
  }
  const text = h('div', { class: 'quran-text q-verses', lang: 'ar', dir: 'rtl' });
  text.append(frag);

  const showBasmala = s !== 1 && s !== 9;
  const prev = s > 1 ? quran[s - 2] : null;
  const next = s < 114 ? quran[s] : null;

  const doneBtn = h('button', { class: 'btn btn-primary btn-block q-done', type: 'button' }, icon('check', { size: 20 }), 'تمّ وِرد اليوم');
  doneBtn.addEventListener('click', async () => {
    doneBtn.disabled = true;
    try {
      const titles = await store.completeLinked('quran');
      haptic(18);
      if (titles && titles.length) toast(`أُنجز في أهداف اليوم: ${titles.join('، ')}`, { icon: 'check', duration: 3200 });
      else toast('تقبّل الله منك', { icon: 'check' });
    } catch {
      toast('تعذّر الحفظ، حاول مرة أخرى');
    } finally {
      doneBtn.disabled = false;
    }
  });

  const content = h('article', { class: 'q-content', 'aria-label': `سورة ${su.name}` },
    h('div', { class: 'surah-frame' },
      h('div', { class: 'sf-kicker' }, diamond(), h('span', null, 'سورة'), diamond()),
      h('h2', { class: 'sf-name' }, su.name),
      h('div', { class: 'sf-meta' },
        h('span', null, typeLabel(su.type)),
        h('span', { class: 'q-dot', 'aria-hidden': 'true' }, '·'),
        h('span', null, ayahCount(total)),
        h('span', { class: 'q-dot', 'aria-hidden': 'true' }, '·'),
        h('span', null, 'ترتيبها ', h('span', { class: 'num' }, String(s))))),
    // basmala string taken from the dataset (Al-Fatiha, ayah 1) — never typed by hand
    showBasmala && h('p', { class: 'quran-text q-basmala', lang: 'ar' }, quran[0].verses[0]),
    text,
    h('div', { class: 'ornament q-end', 'aria-hidden': 'true' }, diamond()));

  const footer = h('footer', { class: 'q-foot' },
    doneBtn,
    h('p', { class: 'q-done-hint' }, 'يُسجَّل إنجاز وِرد القرآن في أهداف اليوم.'),
    h('nav', { class: 'q-nav', 'aria-label': 'التنقل بين السور' },
      prev
        ? h('a', { class: 'q-nav-btn', href: `#/quran/${prev.id}`, 'aria-label': `السورة السابقة: ${prev.name}` },
          icon('back', { size: 18 }),
          h('span', { class: 'q-nav-text' }, h('span', { class: 'q-nav-label' }, 'السابقة'), h('span', { class: 'q-nav-name' }, prev.name)))
        : h('span', { class: 'q-nav-gap' }),
      next
        ? h('a', { class: 'q-nav-btn q-nav-next', href: `#/quran/${next.id}`, 'aria-label': `السورة التالية: ${next.name}` },
          h('span', { class: 'q-nav-text' }, h('span', { class: 'q-nav-label' }, 'التالية'), h('span', { class: 'q-nav-name' }, next.name)),
          icon('chevron', { size: 18 }))
        : h('span', { class: 'q-nav-gap' })));

  root.append(header, content, footer);
  applyScale();

  /* geometry */
  const headerH = () => header.offsetHeight || 0;
  const startTop = (i) => ayahEls[i].getBoundingClientRect().top; // top of the ayah's first line
  function jump(y) {
    const top = Math.max(0, Math.round(y));
    try { window.scrollTo({ top, behavior: 'instant' }); } catch { window.scrollTo(0, top); }
  }
  function scrollToAyah(a) {
    const el = ayahEls[a - 1];
    if (!el) return;
    jump(window.scrollY + el.getBoundingClientRect().top - headerH() - 12);
  }
  /** Ayah whose text is at the top of the reading area (just under the sticky header). */
  function findCurrent() {
    const hh = headerH();
    const limit = hh + 24;
    let lo = 0, hi = total - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (startTop(mid) <= limit) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    // several short ayat can start on the same visible line: keep the first of them
    const t = startTop(ans);
    if (t >= hh - 4) while (ans > 0 && Math.abs(startTop(ans - 1) - t) < 3) ans--;
    return ans + 1;
  }

  /* persistence of the reading position */
  function writeLast() {
    saveTimer = 0;
    if (!dirty) return;
    dirty = false;
    const last = store.getQuran().last;
    if (last && Number(last.s) === s && Number(last.a) === current) return;
    lastWrite = Date.now();
    store.setQuran({ last: { s, a: current, ts: lastWrite } }).catch(() => {});
  }
  function scheduleSave() {
    if (saveTimer || disposed) return;
    saveTimer = setTimeout(writeLast, Math.max(0, SAVE_EVERY - (Date.now() - lastWrite)));
  }
  function flush() {
    clearTimeout(saveTimer);
    writeLast();
  }
  function track() {
    scrollTimer = 0;
    if (disposed) return;
    const a = findCurrent();
    if (a !== current) current = a;
    dirty = true;
    scheduleSave();
  }
  const onScroll = () => {
    if (settling && !userMoved) return; // ignore our own initial positioning
    if (!scrollTimer) scrollTimer = setTimeout(track, 220);
  };
  const onUserMove = () => { userMoved = true; };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHide);
  const moveEvents = ['wheel', 'touchmove', 'pointerdown', 'keydown'];
  for (const ev of moveEvents) window.addEventListener(ev, onUserMove, { passive: true });

  /* initial position: fonts may still be loading, so place more than once until the user moves */
  function place() {
    if (disposed || userMoved) return;
    if (targetA) scrollToAyah(targetA); else jump(0);
  }
  requestAnimationFrame(() => requestAnimationFrame(place));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place).catch(() => {});
  timers.push(setTimeout(() => {
    place();
    settling = false;
    if (targetA) {
      const el = ayahEls[targetA - 1];
      el.classList.add('is-target');
      timers.push(setTimeout(() => el.classList.remove('is-target'), 2800));
      dirty = true;
      scheduleSave();
    } else {
      // opened at the top: remember this surah once the reader has really settled in
      timers.push(setTimeout(() => { dirty = true; scheduleSave(); }, 3000));
    }
  }, 420));

  /* text size */
  function applyScale() {
    root.style.setProperty('--quran-scale', String(scale));
    btnMinus.disabled = scale <= SCALE_MIN + 0.001;
    btnPlus.disabled = scale >= SCALE_MAX - 0.001;
  }
  function setScale(v) {
    const nextScale = clampScale(v);
    if (nextScale === scale) return;
    const anchor = window.scrollY > 40 ? findCurrent() : 0;
    scale = nextScale;
    applyScale();
    if (anchor) scrollToAyah(anchor); // keep the same ayah under the header after reflow
    haptic(8);
    store.setQuran({ scale }).catch(() => {});
  }

  /* ayah sheet */
  function setMarked(a, on) {
    if (on) marked.add(a); else marked.delete(a);
    ayahEls[a - 1].classList.toggle('is-marked', on);
  }
  function openAyah(a) {
    const el = ayahEls[a - 1];
    const verse = verses[a - 1];
    const isMarked = marked.has(a);
    el.classList.add('is-open');
    const action = (iconNode, label, fn) => h('button', { class: 'row q-action', type: 'button', onclick: fn },
      h('span', { class: 'row-badge' }, iconNode),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label)));
    const sheet = openSheet({
      title: `${su.name} · الآية ${a}`,
      body: [
        h('p', { class: 'quran-text q-sheet-ayah', lang: 'ar' }, verse),
        h('div', { class: 'list q-actions' },
          action(icon('bookmark', { size: 20, fill: isMarked }), isMarked ? 'إزالة العلامة' : 'إضافة علامة', async () => {
            const list = (store.getQuran().bookmarks || []).filter((b) => !(Number(b.s) === s && Number(b.a) === a));
            if (!isMarked) list.push({ s, a, ts: Date.now() });
            sheet.close();
            try {
              await store.setQuran({ bookmarks: list });
              setMarked(a, !isMarked);
              haptic();
              toast(isMarked ? 'أُزيلت العلامة' : 'أُضيفت العلامة', { icon: 'bookmark' });
            } catch { toast('تعذّر الحفظ'); }
          }),
          action(icon('target', { size: 20 }), 'حفظ موضع القراءة هنا', async () => {
            sheet.close();
            clearTimeout(saveTimer);
            saveTimer = 0;
            current = a;
            dirty = false;
            lastWrite = Date.now();
            try {
              await store.setQuran({ last: { s, a, ts: lastWrite } });
              haptic();
              toast(`حُفظ الموضع عند الآية ${a}`, { icon: 'check' });
            } catch { toast('تعذّر الحفظ'); }
          }),
          action(copyIcon(20), 'نسخ', async () => {
            sheet.close();
            const ok = await copyText(`${verse} (${su.name}: ${a})`);
            toast(ok ? 'نُسخت الآية' : 'تعذّر النسخ', ok ? { icon: 'check' } : {});
          })),
      ],
      onClose: () => {
        el.classList.remove('is-open');
        if (openSheetRef === sheet) openSheetRef = null;
      },
    });
    openSheetRef = sheet;
  }
  const ayahFromEvent = (e) => {
    const el = e.target instanceof Element ? e.target.closest('.ayah') : null;
    return el && text.contains(el) ? Number(el.dataset.a) : 0;
  };
  const onClick = (e) => {
    const a = ayahFromEvent(e);
    if (!a) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return; // the user is selecting text
    openAyah(a);
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = ayahFromEvent(e);
    if (!a) return;
    e.preventDefault();
    openAyah(a);
  };
  text.addEventListener('click', onClick);
  text.addEventListener('keydown', onKey);

  return () => {
    disposed = true;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHide);
    for (const ev of moveEvents) window.removeEventListener(ev, onUserMove);
    text.removeEventListener('click', onClick);
    text.removeEventListener('keydown', onKey);
    timers.forEach(clearTimeout);
    clearTimeout(scrollTimer);
    if (openSheetRef) openSheetRef.close();
    flush();
    root.style.removeProperty('--quran-scale');
    dropClass();
  };
}

/* ───────────── routes ───────────── */

export const routes = [
  { path: '/quran', tab: 'quran', render: renderIndex },
  { path: '/quran/:s', tab: 'quran', immersive: true, render: renderReader },
  { path: '/quran/:s/:a', tab: 'quran', immersive: true, render: renderReader },
];
