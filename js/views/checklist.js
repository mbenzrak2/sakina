// Sakina — «وِرد اليوم»: the daily checklist (tick goals, see what remains, manage goals).
import { store, todayKey, SESSION_IDS } from '../store.js';
import { loadAdhkar, SESSIONS } from '../data.js';
import {
  h, icon, clear, ICON_NAMES, pageHeader, iconButton, openSheet, confirmSheet, field, toast, ring,
  formatDate, formatHijri, daysLabel, haptic,
} from '../ui.js';

/* ───────────── constants / small helpers ───────────── */

const ICON_LABELS = {
  check: 'علامة', sun: 'شمس', moon: 'قمر', quran: 'مصحف', beads: 'سبحة', sparkle: 'نجمة لامعة',
  bed: 'نوم', heart: 'قلب', star: 'نجمة', target: 'هدف', flame: 'شعلة', bookmark: 'علامة مرجعية',
};
const ICON_CHOICES = Object.keys(ICON_LABELS).filter((n) => ICON_NAMES.includes(n));

const EASE = 'cubic-bezier(0.22, 0.8, 0.26, 1)';
const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function remainingLabel(n) {
  if (n === 1) return 'بقي لك هدف واحد';
  if (n === 2) return 'بقي لك هدفان';
  if (n >= 3 && n <= 10) return `بقي لك ${n} أهداف`;
  return `بقي لك ${n} هدفًا`;
}
function timeOf(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function headerSub() {
  const now = new Date();
  const hijri = formatHijri(now);
  return formatDate(now) + (hijri ? ' · ' + hijri : '');
}
const linkHref = (link) => (link.kind === 'quran' ? '#/quran' : '#/adhkar/' + link.key);

/* ───────────── view ───────────── */

async function render(root) {
  let alive = true;
  let seq = 0;
  let goals = [];
  let done = {};
  let counts = {};     // counter goals: today's count per goal id
  let completed = {};  // adhkar sessions finished today, by progress key
  let streak = 0;
  let editMode = false;
  let wasComplete = null; // null until the first paint → no celebration on page load
  let sheet = null;
  const builtinTitles = new Map(); // adhkar progress key → title (filled lazily)

  /* static skeleton */
  const editBtn = iconButton('edit', 'تعديل الأهداف', () => setEdit(!editMode));
  editBtn.setAttribute('aria-pressed', 'false');
  const header = pageHeader({ title: 'وِرد اليوم', subtitle: headerSub(), actions: [editBtn] });
  const subEl = header.querySelector('.ph-sub');

  const ringEl = ring(0, { size: 104, stroke: 9, label: '0/0' });
  const ringBar = ringEl.querySelector('.ring-bar');
  const ringLabel = ringEl.querySelector('.ring-label');
  const ringLen = parseFloat(ringBar.getAttribute('stroke-dasharray')) || 0;
  const heroTitle = h('h2', { class: 'cl-hero-title' });
  const heroSub = h('p', { class: 'cl-hero-sub' });
  const heroMeta = h('div', { class: 'cl-hero-meta' });
  const hero = h('section', { class: 'card hero cl-hero', 'aria-live': 'polite' },
    ringEl,
    h('div', { class: 'cl-hero-text' }, heroTitle, heroSub, heroMeta),
  );

  const listsBox = h('div', { class: 'cl-lists' });
  const fab = h('button', { type: 'button', class: 'fab', 'aria-label': 'إضافة هدف', title: 'إضافة هدف', onclick: () => openForm(null) },
    icon('plus', { size: 26, stroke: 2 }));

  root.append(header, hero, listsBox, h('div', { class: 'cl-spacer', 'aria-hidden': 'true' }), fab);

  /* ── link labels ── */
  function linkLabel(link) {
    if (!link) return '';
    if (link.kind === 'quran') return 'القرآن الكريم';
    const key = String(link.key);
    if (key.startsWith('c:')) {
      const c = store.getCustomCat(key.slice(2));
      return c ? c.title : 'الأذكار';
    }
    return builtinTitles.get(key) || 'الأذكار';
  }
  function fillBuiltin(cats) {
    for (const c of cats) builtinTitles.set(String(c.id), c.title);
    for (const [cat, def] of Object.entries(SESSIONS)) for (const o of def.options) builtinTitles.set(`${cat}:${o.id}`, o.title);
    builtinTitles.set('27', 'الأذكار بعد الصلوات الخمس');
  }
  const isCounter = (g) => g.target > 0;
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  /* ── hero ── */
  function drawHero() {
    const total = goals.length;
    const doneCount = goals.filter((g) => done[g.id]).length;
    const left = total - doneCount;
    const ratio = total ? doneCount / total : 0;
    const complete = total > 0 && left === 0;

    hero.hidden = total === 0;
    ringBar.setAttribute('stroke-dashoffset', String(ringLen * (1 - ratio)));
    ringEl.classList.toggle('complete', complete);
    ringLabel.textContent = `${doneCount}/${total}`;
    ringEl.setAttribute('role', 'img');
    ringEl.setAttribute('aria-label', `أُنجز ${doneCount} من ${total}`);

    hero.classList.toggle('is-complete', complete);
    if (complete) {
      heroTitle.textContent = 'أتممتَ وِرد اليوم';
      heroSub.textContent = 'تقبّل الله منك، وزادك ثباتًا.';
    } else if (doneCount === 0) {
      heroTitle.textContent = remainingLabel(left);
      heroSub.textContent = 'ابدأ وِردك باسم الله.';
    } else {
      heroTitle.textContent = remainingLabel(left);
      heroSub.textContent = `أنجزتَ ${doneCount} من ${total} — واصل.`;
    }

    clear(heroMeta);
    if (complete) heroMeta.append(h('span', { class: 'badge' }, icon('sparkle', { size: 14 }), 'يوم مكتمل'));
    if (streak > 0) {
      heroMeta.append(h('a', { class: 'badge cl-streak', href: '#/history', 'aria-label': `السلسلة الحالية: ${daysLabel(streak)}. فتح السجل` },
        icon('flame', { size: 14 }), daysLabel(streak)));
    }

    if (wasComplete === false && complete) celebrate();
    wasComplete = total > 0 ? complete : null;
  }
  function celebrate() {
    haptic([18, 70, 28]);
    toast('أتممتَ وِرد اليوم، تقبّل الله منك', { icon: 'sparkle', duration: 3200 });
    hero.classList.remove('celebrate');
    void hero.offsetWidth; // restart the animation
    hero.classList.add('celebrate');
  }

  /* ── rows ── */
  function goalRow(g) {
    const isDone = !!done[g.id];
    const tick = h('button', {
      type: 'button', class: 'cl-tick', role: 'checkbox', 'aria-checked': String(isDone), 'aria-label': g.title,
      dataset: { act: 'tick' }, onclick: () => toggle(g, !isDone),
    }, h('span', { class: 'check' + (isDone ? ' on' : '') }, icon('check', { size: 16, stroke: 2.6 })));

    let sub = '';
    if (isDone) {
      const t = timeOf(done[g.id]);
      sub = t ? `أُنجز ${t}` : 'أُنجز';
    } else if (isCounter(g)) {
      sub = `${fmt(counts[g.id])} / ${fmt(g.target)}`;
    } else if (g.link && g.link.kind === 'adhkar' && SESSION_IDS[g.link.key]) {
      // linked to a whole multi-session chapter (e.g. after the five prayers): show how many sessions are done
      const ids = SESSION_IDS[g.link.key];
      sub = `${ids.filter((s) => completed[`${g.link.key}:${s}`]).length} / ${ids.length} — اضغط للقراءة`;
    } else if (g.link) {
      const label = linkLabel(g.link);
      sub = label && label !== g.title ? label : 'اضغط للقراءة';
    }
    const inner = [
      h('span', { class: 'row-badge' }, icon(g.icon || 'check', { size: 20 })),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, g.title),
        sub && h('span', { class: 'row-sub' + (isDone ? ' num-sub' : '') }, sub),
      ),
    ];
    const main = g.link || isCounter(g)
      ? h('a', { class: 'cl-main', href: isCounter(g) ? '#/counter/' + encodeURIComponent(g.id) : linkHref(g.link), dataset: { act: 'open' }, 'aria-label': `فتح: ${g.title}`, title: 'فتح' },
        inner, h('span', { class: 'cl-open' }, icon('chevron', { size: 18 })))
      : h('div', { class: 'cl-main', onclick: () => toggle(g, !isDone) }, inner);

    return h('div', { class: 'cl-row' + (isDone ? ' is-done' : ''), dataset: { goal: g.id } }, tick, main);
  }

  function editRow(g, i) {
    return h('div', { class: 'cl-row cl-edit-row', dataset: { goal: g.id } },
      h('button', { type: 'button', class: 'cl-main', dataset: { act: 'edit' }, 'aria-label': `تعديل: ${g.title}`, onclick: () => openForm(g) },
        h('span', { class: 'row-badge' }, icon(g.icon || 'check', { size: 20 })),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, g.title),
          h('span', { class: 'row-sub' }, isCounter(g) ? `عدّاد: ${fmt(g.target)} مرة` : g.link ? `مرتبط: ${linkLabel(g.link)}` : 'بدون ربط'),
        ),
        h('span', { class: 'cl-pencil' }, icon('edit', { size: 17 })),
      ),
      h('button', {
        type: 'button', class: 'cl-move', dataset: { act: 'up' }, disabled: i === 0,
        'aria-label': `تحريك «${g.title}» للأعلى`, title: 'للأعلى', onclick: () => move(i, -1),
      }, icon('chevron', { size: 18, class: 'cl-up' })),
      h('button', {
        type: 'button', class: 'cl-move', dataset: { act: 'down' }, disabled: i === goals.length - 1,
        'aria-label': `تحريك «${g.title}» للأسفل`, title: 'للأسفل', onclick: () => move(i, 1),
      }, icon('chevron', { size: 18, class: 'cl-down' })),
    );
  }

  function sectionTitle(text, count, extra) {
    return h('h2', { class: 'section-title' },
      h('span', { class: 'cl-st' }, text, count != null && h('span', { class: 'badge num' }, String(count))),
      extra,
    );
  }

  function drawLists() {
    clear(listsBox);
    if (!goals.length) {
      listsBox.append(h('div', { class: 'card empty' },
        icon('target', { size: 44, stroke: 1.2 }),
        h('div', { class: 'empty-title' }, 'لا أهداف بعد'),
        h('p', null, 'أضف أول هدف إلى وِردك اليومي، وتابع إنجازك يومًا بيوم.'),
        h('button', { type: 'button', class: 'btn btn-primary cl-empty-btn', onclick: () => openForm(null) },
          icon('plus', { size: 18, stroke: 2 }), 'إضافة هدف'),
      ));
      return;
    }

    if (editMode) {
      listsBox.append(
        sectionTitle('ترتيب الأهداف وتعديلها', null,
          h('button', { type: 'button', class: 'cl-done-edit', onclick: () => setEdit(false) }, 'تمّ')),
        h('div', { class: 'list cl-list' }, goals.map(editRow)),
        h('button', { type: 'button', class: 'btn btn-outline btn-block cl-add', onclick: () => openForm(null) },
          icon('plus', { size: 18, stroke: 2 }), 'إضافة هدف'),
        h('p', { class: 'cl-edit-note' }, 'اضغط على الهدف لتعديله أو حذفه، واستعمل السهمين لتغيير الترتيب.'),
      );
      return;
    }

    const todo = goals.filter((g) => !done[g.id]);
    const fin = goals.filter((g) => done[g.id]);
    if (todo.length) {
      listsBox.append(
        sectionTitle('المتبقي', todo.length),
        h('div', { class: 'list cl-list is-todo' }, todo.map(goalRow)),
      );
    }
    if (fin.length) {
      listsBox.append(
        sectionTitle('تمّ إنجازه', fin.length),
        h('div', { class: 'list cl-list is-fin' }, fin.map(goalRow)),
      );
    }
  }

  /* ── paint with FLIP animation + focus retention ── */
  function draw() {
    const before = new Map();
    listsBox.querySelectorAll('[data-goal]').forEach((el) => before.set(el.dataset.goal, el.getBoundingClientRect()));
    let focus = null;
    const active = document.activeElement;
    if (active && listsBox.contains(active)) {
      const rowEl = active.closest('[data-goal]');
      if (rowEl && active.dataset.act) focus = { id: rowEl.dataset.goal, act: active.dataset.act };
    }

    if (subEl) subEl.textContent = headerSub();
    editBtn.classList.toggle('active', editMode);
    editBtn.setAttribute('aria-pressed', String(editMode));
    drawHero();
    drawLists();

    const rows = new Map();
    listsBox.querySelectorAll('[data-goal]').forEach((el) => rows.set(el.dataset.goal, el));

    if (focus && rows.has(focus.id)) {
      const rowEl = rows.get(focus.id);
      let target = rowEl.querySelector(`[data-act="${focus.act}"]`);
      if (target && target.disabled) target = rowEl.querySelector('.cl-move:not(:disabled)');
      if (target) target.focus({ preventScroll: true });
    }

    if (before.size && !reducedMotion()) {
      for (const [id, el] of rows) {
        if (typeof el.animate !== 'function') break;
        const b = before.get(id);
        if (!b) {
          el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
          continue;
        }
        const a = el.getBoundingClientRect();
        const dx = b.left - a.left;
        const dy = b.top - a.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 360, easing: EASE });
      }
    }
  }

  /* ── data ── */
  async function refresh() {
    const my = ++seq;
    let rec = null;
    let s = null;
    try {
      rec = await store.getDay(todayKey());
      s = await store.stats();
    } catch (e) { console.error(e); }
    if (!alive || my !== seq) return;
    goals = store.listGoals();
    done = { ...((rec && rec.done) || {}) };
    counts = { ...((rec && rec.counts) || {}) };
    completed = { ...((rec && rec.completed) || {}) };
    streak = s ? s.current : 0;
    if (!goals.length) editMode = false;
    draw();
  }

  async function toggle(g, value) {
    haptic(value ? 14 : 8);
    seq++; // drop any in-flight (now stale) refresh; the write below triggers a fresh one
    if (value) done[g.id] = Date.now(); else delete done[g.id];
    draw();
    try {
      await store.toggleGoal(g.id, value);
    } catch (e) {
      console.error(e);
      toast('تعذّر الحفظ، حاول مجددًا');
      refresh();
    }
  }

  async function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= goals.length) return;
    haptic(8);
    seq++;
    [goals[i], goals[j]] = [goals[j], goals[i]];
    draw();
    try {
      await store.reorderGoals(goals.map((g) => g.id));
    } catch (e) {
      console.error(e);
      toast('تعذّر حفظ الترتيب');
      refresh();
    }
  }

  function setEdit(on) {
    editMode = on && goals.length > 0;
    draw();
  }

  /* ── goal form ── */
  async function openForm(goal) {
    let cats = [];
    try { cats = await loadAdhkar(); fillBuiltin(cats); } catch { /* offline data missing: only basic links */ }
    if (!alive) return;
    if (sheet) sheet.close();

    let chosenIcon = goal && ICON_NAMES.includes(goal.icon) ? goal.icon : 'check';
    let autoTitle = '';

    const input = h('input', {
      class: 'input', type: 'text', maxlength: '60', placeholder: 'مثال: صلاة الضحى',
      value: goal ? goal.title : '', autocomplete: 'off', enterkeyhint: 'done',
    });
    const err = h('span', { class: 'field-hint cl-err', role: 'alert', hidden: true }, 'اكتب عنوانًا للهدف.');
    input.addEventListener('input', () => { input.classList.remove('is-invalid'); err.hidden = true; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

    /* icon picker */
    const choices = ICON_CHOICES.includes(chosenIcon) ? ICON_CHOICES : [chosenIcon, ...ICON_CHOICES];
    const iconBtns = choices.map((name) => h('button', {
      type: 'button', class: 'cl-icon-opt', role: 'radio', 'aria-checked': String(name === chosenIcon),
      'aria-label': ICON_LABELS[name] || name, title: ICON_LABELS[name] || name,
      onclick: () => {
        chosenIcon = name;
        haptic(6);
        iconBtns.forEach((b, k) => b.setAttribute('aria-checked', String(choices[k] === name)));
      },
    }, icon(name, { size: 22 })));

    /* link select */
    const opt = (value, label) => h('option', { value }, label);
    const sel = h('select', { class: 'select', 'aria-label': 'الربط' },
      opt('', 'بدون ربط'),
      opt('quran', 'القرآن الكريم'),
    );
    const builtin = h('optgroup', { label: 'الأذكار' },
      opt('a:1:am', 'أذكار الصباح'),
      opt('a:1:pm', 'أذكار المساء'),
      opt('a:27', 'الأذكار بعد الصلوات الخمس'),
      SESSIONS['27'].options.map((o) => opt('a:27:' + o.id, o.title)),
      // chapters of narrations (READ_ONLY) are for reading, not tasks
      cats.filter((c) => !['1', '27', '50', '107', '108', '129', '130', '131', '132'].includes(String(c.id))).map((c) => opt('a:' + c.id, c.title)),
    );
    /* counter target */
    const targetInput = h('input', {
      class: 'input num', type: 'number', min: '1', max: '1000000', step: '1', inputmode: 'numeric',
      placeholder: 'مثال: 1000', value: goal && goal.target > 0 ? String(goal.target) : '',
    });
    sel.append(builtin);
    const custom = store.listCustomCats();
    if (custom.length) {
      sel.append(h('optgroup', { label: 'أذكاري الخاصة' }, custom.map((c) => opt('a:c:' + c.id, c.title))));
    }
    let current = '';
    if (goal && goal.link) current = goal.link.kind === 'quran' ? 'quran' : 'a:' + goal.link.key;
    if (current && ![...sel.options].some((o) => o.value === current)) {
      sel.append(opt(current, `${linkLabel(goal.link)} (غير متوفّر)`));
    }
    sel.value = current;
    sel.addEventListener('change', () => {
      const label = sel.value ? sel.options[sel.selectedIndex].textContent : '';
      const cur = input.value.trim();
      if (label && (!cur || cur === autoTitle)) {
        input.value = label;
        autoTitle = label;
        input.classList.remove('is-invalid');
        err.hidden = true;
      }
    });

    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save() }, goal ? 'حفظ' : 'إضافة');

    async function save() {
      const title = input.value.trim();
      if (!title) {
        input.classList.add('is-invalid');
        err.hidden = false;
        input.focus();
        return;
      }
      const v = sel.value;
      const target = Math.min(1000000, Math.max(0, parseInt(targetInput.value, 10) || 0));
      // a counter goal stands on its own: the target replaces any link
      const link = target ? null : v === 'quran' ? { kind: 'quran' } : v.startsWith('a:') ? { kind: 'adhkar', key: v.slice(2) } : null;
      saveBtn.disabled = true;
      try {
        const data = { ...(goal || {}), title, icon: chosenIcon, link };
        if (target) data.target = target; else delete data.target;
        await store.saveGoal(data);
        mine.close();
        toast(goal ? 'حُفظ التعديل' : 'أُضيف الهدف إلى وِردك', { icon: 'check' });
      } catch (e) {
        console.error(e);
        saveBtn.disabled = false;
        toast('تعذّر الحفظ، حاول مجددًا');
      }
    }
    async function remove() {
      const ok = await confirmSheet({
        title: 'حذف الهدف',
        message: `سيُحذف «${goal.title}» من وِردك اليومي. سجلّ الأيام السابقة يبقى كما هو.`,
        confirmLabel: 'حذف', danger: true,
      });
      if (!ok) return;
      try {
        await store.deleteGoal(goal.id);
        mine.close();
        toast('حُذف الهدف');
      } catch (e) {
        console.error(e);
        toast('تعذّر الحذف');
      }
    }

    const mine = openSheet({
      title: goal ? 'تعديل الهدف' : 'هدف جديد',
      body: [
        h('div', { class: 'field' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'العنوان'), input),
          err,
        ),
        h('div', { class: 'field' },
          h('span', { class: 'field-label', id: 'cl-icon-label' }, 'الأيقونة'),
          h('div', { class: 'cl-icons', role: 'radiogroup', 'aria-labelledby': 'cl-icon-label' }, iconBtns),
        ),
        field('عدد مستهدف في اليوم (اختياري)', targetInput, 'مثال: الاستغفار 1000 مرة. يفتح الهدف عدّادًا، ويُعلَّم منجَزًا عند بلوغ العدد.'),
        field('الربط', h('div', { class: 'cl-select' }, sel, icon('chevron', { size: 16 }))),
        h('div', { class: 'cl-hint' },
          icon('info', { size: 18 }),
          h('span', null, 'الهدف المرتبط يُعلَّم منجَزًا تلقائيًا عند إتمام قراءة الأذكار أو وِرد القرآن المرتبط به، ويمكنك فتحه مباشرة من القائمة.'),
        ),
      ],
      footer: [
        goal
          ? h('button', { type: 'button', class: 'btn btn-danger', onclick: () => remove() }, icon('trash', { size: 18 }), 'حذف')
          : h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => mine.close() }, 'إلغاء'),
        saveBtn,
      ],
      onClose: () => { if (sheet === mine) sheet = null; },
    });
    sheet = mine;
  }

  /* ── live updates ── */
  const off = store.on((type, detail) => {
    if (type === 'day') {
      if (!detail || detail.date === todayKey()) refresh();
    } else if (type === 'goals' || type === 'customCats' || type === 'import') {
      refresh();
    }
  });
  const onVisible = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', onVisible);

  await refresh();

  // resolve the titles of linked adhkar in the background (only used for the small sub-labels)
  loadAdhkar().then((cats) => {
    fillBuiltin(cats);
    if (alive && goals.some((g) => g.link && g.link.kind === 'adhkar')) draw();
  }).catch(() => {});

  return () => {
    alive = false;
    off();
    document.removeEventListener('visibilitychange', onVisible);
    if (sheet) sheet.close();
  };
}

export const routes = [
  { path: '/checklist', tab: 'checklist', render },
];
