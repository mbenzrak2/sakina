// Sakina — «السجل»: look back over a year or more (heat-map year view, month calendar, day detail).
import { store, dateKey, parseKey, addDays, todayKey } from '../store.js';
import {
  h, icon, clear, pageHeader, openSheet, toast,
  formatDate, formatDayMonth, formatMonth, formatHijri, daysLabel, haptic,
} from '../ui.js';

/* ───────────── helpers ───────────── */

// The week starts on Saturday (labelled in the UI).
const WEEKDAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const WEEKDAYS_SHORT = ['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
const satIndex = (d) => (d.getDay() + 1) % 7; // Saturday → 0 … Friday → 6

const fmtMonthName = new Intl.DateTimeFormat('ar-MA-u-nu-latn', { month: 'long' });
const fmtSince = new Intl.DateTimeFormat('ar-MA-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });

const pad2 = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => dateKey(new Date(y, m, d));
const ymOf = (key) => { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1); };

/** 0 = no record / nothing done … 4 = every goal done */
function levelOf(rec) {
  const s = store.dayStats(rec);
  if (!s.total || !s.done) return 0;
  if (s.done >= s.total) return 4;
  if (s.ratio <= 1 / 3) return 1;
  if (s.ratio <= 2 / 3) return 2;
  return 3;
}
function summarize(recs) {
  let active = 0, perfect = 0, done = 0, total = 0;
  for (const rec of recs) {
    const s = store.dayStats(rec);
    done += s.done; total += s.total;
    if (s.done > 0) active++;
    if (s.total && s.done === s.total) perfect++;
  }
  return { active, perfect, rate: total ? Math.round((done / total) * 100) : 0 };
}
function timeOf(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

let lastMode = 'year'; // remembered while the app stays open

/* ───────────── view ───────────── */

async function render(root) {
  let alive = true;
  let token = 0;
  let sheet = null;
  const now = new Date();
  const st = {
    mode: lastMode,
    y: now.getFullYear(),
    m: now.getMonth(),
    today: todayKey(),
    start: todayKey(), // first tracked day (first record or install date)
    view: null,        // { from, to, recs, paint(key), summary() } of the grid on screen
  };

  const statsBox = h('section', { class: 'hs-stats', 'aria-label': 'الإحصاءات' });
  const segYear = h('button', { type: 'button', onclick: () => setMode('year') }, 'سنة');
  const segMonth = h('button', { type: 'button', onclick: () => setMode('month') }, 'شهر');
  const seg = h('div', { class: 'seg hs-seg', role: 'group', 'aria-label': 'طريقة العرض' }, segYear, segMonth);
  const body = h('div', { class: 'hs-body' });
  root.append(pageHeader({ title: 'السجل', subtitle: 'مسيرتك يومًا بيوم' }), statsBox, seg, body);

  function paintSeg() {
    segYear.classList.toggle('active', st.mode === 'year');
    segMonth.classList.toggle('active', st.mode === 'month');
    segYear.setAttribute('aria-pressed', String(st.mode === 'year'));
    segMonth.setAttribute('aria-pressed', String(st.mode === 'month'));
  }
  function setMode(mode) {
    if (st.mode === mode) return;
    st.mode = lastMode = mode;
    haptic(6);
    paintSeg();
    renderView();
  }

  /* ── bounds ── */
  const minYM = () => ymOf(st.start);
  const maxYM = () => ymOf(st.today);
  function clampCursor() {
    const cur = Math.max(minYM(), Math.min(maxYM(), st.y * 12 + st.m));
    st.y = Math.floor(cur / 12);
    st.m = cur % 12;
  }

  /* ── stats ── */
  async function loadStats() {
    let s;
    try { s = await store.stats(); } catch (e) { console.error(e); return; }
    if (!alive) return;
    const stat = (value, label, cls) => h('div', { class: 'stat' },
      h('div', { class: 'stat-value' + (cls ? ' ' + cls : '') }, value),
      h('div', { class: 'stat-label' }, label));
    clear(statsBox).append(
      h('div', { class: 'card hero hs-streak' },
        h('div', { class: 'hs-flame' + (s.current > 0 ? ' is-lit' : '') }, icon('flame', { size: 30 })),
        h('div', { class: 'hs-streak-text' },
          h('div', { class: 'hs-streak-label' }, 'السلسلة الحالية'),
          h('div', { class: 'hs-streak-value' }, daysLabel(s.current)),
          h('div', { class: 'hs-streak-sub' }, s.current > 0 ? 'واصل، بارك الله فيك.' : 'أنجز هدفًا اليوم لتبدأ سلسلتك.'),
        ),
      ),
      h('div', { class: 'grid-2 hs-stats-grid' },
        stat(daysLabel(s.best), 'أفضل سلسلة'),
        stat(daysLabel(s.perfectDays), 'أيام مكتملة'),
        stat(h('span', { class: 'num' }, Math.round(s.rate * 100) + '%'), 'نسبة الإنجاز'),
        stat(fmtSince.format(parseKey(st.start)), 'بداية التتبّع', 'hs-since'),
      ),
    );
  }

  /* ── shared pieces ── */
  function navBar(label, canPrev, canNext, onPrev, onNext, prevLabel, nextLabel) {
    // RTL: the "previous" control sits at the start (right) and points right.
    return h('div', { class: 'hs-nav' },
      h('button', { type: 'button', class: 'icon-btn', dataset: { nav: 'prev' }, 'aria-label': prevLabel, title: prevLabel, disabled: !canPrev, onclick: onPrev }, icon('back')),
      h('h2', { class: 'hs-period num', 'aria-live': 'polite' }, label),
      h('button', { type: 'button', class: 'icon-btn', dataset: { nav: 'next' }, 'aria-label': nextLabel, title: nextLabel, disabled: !canNext, onclick: onNext }, icon('chevron')),
    );
  }
  function fillSummary(el, recs) {
    const s = summarize(recs);
    const item = (value, label) => h('div', { class: 'hs-sum' },
      h('div', { class: 'hs-sum-value num' }, value), h('div', { class: 'hs-sum-label' }, label));
    clear(el).append(
      item(String(s.active), 'أيام نشطة'),
      item(String(s.perfect), 'أيام مكتملة'),
      item(s.rate + '%', 'نسبة الإنجاز'),
    );
  }
  function dayLabel(key, rec) {
    const base = formatDayMonth(parseKey(key));
    if (key > st.today) return `${base}: لم يأتِ بعد`;
    if (rec) {
      const s = store.dayStats(rec);
      return `${base}: ${s.done}/${s.total}`;
    }
    return key < st.start ? `${base}: قبل بدء التتبّع` : `${base}: لا بيانات`;
  }
  function stateClass(key, rec) {
    if (key > st.today) return ' is-future';
    if (!rec && key < st.start) return ' is-untracked';
    return '';
  }

  /* ── year view: heat-map ── */
  async function buildYear() {
    const y = st.y;
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    const recs = new Map((await store.getDays(from, to)).map((r) => [r.date, r]));
    const cells = new Map();

    function paint(key) {
      const cell = cells.get(key);
      if (!cell) return;
      const rec = recs.get(key);
      const state = stateClass(key, rec);
      cell.className = 'hm-cell' + (state || ' l' + levelOf(rec)) + (key === st.today ? ' is-today' : '');
      const label = dayLabel(key, rec);
      cell.title = label;
      cell.setAttribute('aria-label', label);
      cell.disabled = key > st.today;
    }

    const grid = h('div', { class: 'hm-grid', role: 'group', 'aria-label': `خريطة الإنجاز لسنة ${y}` });
    const frag = document.createDocumentFragment();
    const d = new Date(y, 0, 1);
    const offset = satIndex(d);
    for (let i = 0; d.getFullYear() === y; i++, d.setDate(d.getDate() + 1)) {
      const key = dateKey(d);
      const col = String(Math.floor((offset + i) / 7) + 1);
      if (d.getDate() === 1) {
        frag.append(h('span', { class: 'hm-month', 'aria-hidden': 'true', style: { gridColumn: col, gridRow: '1' } }, fmtMonthName.format(d)));
      }
      const cell = h('button', { type: 'button', tabindex: '-1', dataset: { key }, style: { gridColumn: col, gridRow: String(((offset + i) % 7) + 2) } });
      cells.set(key, cell);
      paint(key);
      frag.append(cell);
    }
    grid.append(frag);

    // one roving tab stop + arrow keys (RTL: left = forward in time)
    const inYear = (k) => k >= from && k <= to;
    let tabKey = inYear(st.today) ? st.today : (inYear(st.start) ? st.start : to);
    if (cells.get(tabKey).disabled) tabKey = from;
    cells.get(tabKey).tabIndex = 0;
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.hm-cell');
      if (cell && !cell.disabled) openDay(cell.dataset.key);
    });
    grid.addEventListener('keydown', (e) => {
      const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: 7, ArrowRight: -7 }[e.key];
      const cell = e.target.closest('.hm-cell');
      if (!delta || !cell) return;
      const next = cells.get(addDays(cell.dataset.key, delta));
      if (!next || next.disabled) return;
      e.preventDefault();
      cell.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });

    const scroller = h('div', { class: 'hm-scroll' }, grid);
    const summary = h('div', { class: 'hs-summary' });
    fillSummary(summary, recs.values());

    const minY = Math.floor(minYM() / 12);
    const maxY = Math.floor(maxYM() / 12);
    const go = (dy) => { st.y = y + dy; clampCursor(); renderView(dy < 0 ? 'prev' : 'next'); };
    const sw = (cls) => h('i', { class: 'hm-swatch ' + cls });

    const el = h('section', { class: 'card hs-card' },
      navBar(String(y), y > minY, y < maxY, () => go(-1), () => go(1), 'السنة السابقة', 'السنة التالية'),
      h('div', { class: 'hm' },
        h('div', { class: 'hm-days', 'aria-hidden': 'true' }, h('span'), WEEKDAYS_SHORT.map((w) => h('span', null, w))),
        scroller,
      ),
      h('div', { class: 'hm-legend' },
        h('span', { class: 'hm-scale' }, 'أقل', sw('l0'), sw('l1'), sw('l2'), sw('l3'), sw('l4'), 'أكثر'),
        h('span', { class: 'hm-scale' }, sw('is-untracked'), 'قبل بدء التتبّع'),
        h('span', null, 'يبدأ الأسبوع يوم السبت'),
      ),
      summary,
    );

    return {
      el,
      view: { from, to, recs, paint, summary: () => fillSummary(summary, recs.values()) },
      after() {
        // bring the current month into view (January sits at the right edge in RTL)
        const target = inYear(st.today) ? cells.get(st.today) : null;
        if (!target) return;
        const c = target.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        scroller.scrollLeft += (c.left + c.width / 2) - (s.left + s.width / 2);
      },
    };
  }

  /* ── month view: calendar ── */
  async function buildMonth() {
    const { y, m } = st;
    const first = new Date(y, m, 1);
    const daysIn = new Date(y, m + 1, 0).getDate();
    const from = keyOf(y, m, 1);
    const to = keyOf(y, m, daysIn);
    const recs = new Map((await store.getDays(from, to)).map((r) => [r.date, r]));
    const cells = new Map();

    function paint(key) {
      const cell = cells.get(key);
      if (!cell) return;
      const rec = recs.get(key);
      const s = store.dayStats(rec);
      const full = s.total > 0 && s.done === s.total;
      cell.className = 'cal-day' + stateClass(key, rec) + (full ? ' is-full' : '') + (key === st.today ? ' is-today' : '');
      cell.style.setProperty('--p', String(Math.round(s.ratio * 100)));
      const label = dayLabel(key, rec) + (key === st.today ? ' (اليوم)' : '');
      cell.title = label;
      cell.setAttribute('aria-label', label);
      cell.disabled = key > st.today;
    }

    const grid = h('div', { class: 'cal' });
    const frag = document.createDocumentFragment();
    WEEKDAYS.forEach((w, i) => frag.append(h('div', { class: 'cal-wd', title: w, 'aria-hidden': 'true' }, WEEKDAYS_SHORT[i])));
    for (let i = satIndex(first); i > 0; i--) frag.append(h('span', { class: 'cal-blank', 'aria-hidden': 'true' }));
    for (let day = 1; day <= daysIn; day++) {
      const key = keyOf(y, m, day);
      const cell = h('button', { type: 'button', dataset: { key } },
        h('span', { class: 'cal-ring' }), h('span', { class: 'cal-num' }, String(day)));
      cells.set(key, cell);
      paint(key);
      frag.append(cell);
    }
    grid.append(frag);
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cal-day');
      if (cell && !cell.disabled) openDay(cell.dataset.key);
    });

    const summary = h('div', { class: 'hs-summary' });
    fillSummary(summary, recs.values());
    const cur = y * 12 + m;
    const go = (dm) => {
      const n = cur + dm;
      st.y = Math.floor(n / 12); st.m = n % 12;
      clampCursor();
      renderView(dm < 0 ? 'prev' : 'next');
    };

    const el = h('section', { class: 'card hs-card is-month' },
      navBar(formatMonth(first), cur > minYM(), cur < maxYM(), () => go(-1), () => go(1), 'الشهر السابق', 'الشهر التالي'),
      grid,
      summary,
    );
    return { el, view: { from, to, recs, paint, summary: () => fillSummary(summary, recs.values()) } };
  }

  async function renderView(focusNav) {
    const my = ++token;
    let built;
    try {
      built = st.mode === 'year' ? await buildYear() : await buildMonth();
    } catch (e) {
      console.error(e);
      if (alive && my === token) toast('تعذّر تحميل السجل');
      return;
    }
    if (!alive || my !== token) return;
    st.view = built.view;
    clear(body).append(built.el);
    if (built.after) built.after();
    if (focusNav) {
      const btn = built.el.querySelector(`[data-nav="${focusNav}"]:not(:disabled)`) || built.el.querySelector('[data-nav]:not(:disabled)');
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  async function fullRender() {
    const my = ++token;
    st.today = todayKey();
    const installed = store.installedAt();
    let start = installed;
    try {
      const early = await store.getDays('0000-01-01', installed);
      if (early.length && early[0].date < start) start = early[0].date;
    } catch (e) { console.error(e); }
    if (!alive || my !== token) return;
    st.start = start > st.today ? st.today : start;
    clampCursor();
    paintSeg();
    await Promise.all([loadStats(), renderView()]);
  }

  /* ── day detail sheet ── */
  async function openDay(key) {
    const date = parseKey(key);
    const hijri = formatHijri(date);
    const count = h('span', { class: 'badge ds-count num' });
    const content = h('div', { class: 'ds-content' });
    let busy = false;

    async function draw() {
      const today = todayKey();
      const rec = await store.getDay(key);
      // today always reflects the live goal list (the store re-snapshots it on every write)
      const goals = key === today ? store.listGoals() : ((rec && rec.goals) || []);
      const done = (rec && rec.done) || {};
      const editable = goals.length > 0 && (key === today || (key === addDays(today, -1) && !!rec));
      const nDone = goals.filter((g) => done[g.id]).length;
      count.textContent = `${nDone}/${goals.length}`;
      count.hidden = goals.length === 0;
      count.classList.toggle('ok', goals.length > 0 && nDone === goals.length);

      if (!goals.length) {
        clear(content).append(h('div', { class: 'empty ds-empty' },
          icon('history', { size: 38, stroke: 1.2 }),
          h('div', { class: 'empty-title' }, 'لا توجد بيانات لهذا اليوم'),
          h('p', null, key < st.start ? 'هذا اليوم يسبق بداية التتبّع.' : 'لم يُفتح التطبيق في هذا اليوم.'),
        ));
        return;
      }

      const rows = goals.map((g) => {
        const ts = done[g.id];
        const isDone = !!ts;
        let when = 'لم يُنجَز';
        if (isDone) when = typeof ts === 'number' && dateKey(new Date(ts)) === key ? timeOf(ts) : 'أُضيف لاحقًا';
        const kids = [
          h('span', { class: 'check' + (isDone ? ' on' : '') }, icon('check', { size: 16, stroke: 2.6 })),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, g.title)),
          h('span', { class: 'row-end' + (isDone ? ' num' : '') }, when),
        ];
        const cls = 'row ds-row' + (isDone ? ' is-on' : ' is-off');
        if (!editable) return h('div', { class: cls }, kids);
        return h('button', {
          type: 'button', class: cls, role: 'checkbox', 'aria-checked': String(isDone), dataset: { goal: g.id },
          onclick: async () => {
            if (busy) return;
            busy = true;
            haptic(isDone ? 8 : 14);
            try {
              await store.toggleGoal(g.id, !isDone, key);
              await draw();
              const again = content.querySelector(`[data-goal="${CSS.escape(g.id)}"]`);
              if (again) again.focus({ preventScroll: true });
            } catch (e) {
              console.error(e);
              toast('تعذّر الحفظ، حاول مجددًا');
            }
            busy = false;
          },
        }, kids);
      });
      clear(content).append(
        h('div', { class: 'list ds-list' }, rows),
        h('p', { class: 'ds-note' }, icon('info', { size: 16 }),
          editable ? 'يمكنك تصحيح هذا اليوم: اضغط على الهدف لتغيير حالته.' : 'سجلّ للعرض فقط — يمكن تصحيح اليوم وأمس فقط.'),
      );
    }

    try { await draw(); } catch (e) { console.error(e); toast('تعذّر تحميل اليوم'); return; }
    if (!alive) return;
    if (sheet) sheet.close();
    const mine = openSheet({
      title: key === st.today ? 'اليوم' : 'تفاصيل اليوم',
      body: [
        h('div', { class: 'ds-head' },
          h('div', null,
            h('div', { class: 'ds-date' }, formatDate(date)),
            hijri && h('div', { class: 'ds-hijri' }, hijri),
          ),
          count,
        ),
        content,
      ],
      onClose: () => { if (sheet === mine) sheet = null; },
    });
    sheet = mine;
  }

  /* ── live updates: patch the touched days in place ── */
  const pending = new Set();
  let timer = null;
  async function flush() {
    timer = null;
    if (!alive) return;
    if (todayKey() !== st.today) { pending.clear(); fullRender(); return; }
    const dates = [...pending];
    pending.clear();
    const view = st.view;
    if (view) {
      let touched = false;
      for (const date of dates) {
        if (date < view.from || date > view.to) continue;
        let rec = null;
        try { rec = await store.getDay(date); } catch (e) { console.error(e); continue; }
        if (!alive || st.view !== view) break;
        if (rec) view.recs.set(date, rec); else view.recs.delete(date);
        view.paint(date);
        touched = true;
      }
      if (touched && alive && st.view === view) view.summary();
    }
    loadStats();
  }
  const off = store.on((type, detail) => {
    if (type === 'import') {
      pending.clear();
      fullRender();
    } else if (type === 'day') {
      pending.add((detail && detail.date) || todayKey());
      if (!timer) timer = setTimeout(flush, 120);
    }
  });
  const onVisible = () => { if (!document.hidden && todayKey() !== st.today) fullRender(); };
  document.addEventListener('visibilitychange', onVisible);

  await fullRender();

  return () => {
    alive = false;
    token++;
    off();
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    if (sheet) sheet.close();
  };
}

export const routes = [
  { path: '/history', tab: 'history', render },
];
