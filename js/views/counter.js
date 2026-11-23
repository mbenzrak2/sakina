// Counter goal — a daily tasbih with a target (e.g. 1000 × الصلاة على النبي ﷺ).
import { store, todayKey } from '../store.js';
import { loadAdhkar } from '../data.js';
import { h, icon, pageHeader, iconButton, openSheet, confirmSheet, field, toast, haptic } from '../ui.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const R = 54;
const C = 2 * Math.PI * R;

async function render(root, params) {
  const goal = store.listGoals().find((g) => g.id === params.id && g.target > 0);
  if (!goal) {
    root.append(
      pageHeader({ title: 'العدّاد', back: '/checklist' }),
      h('div', { class: 'empty' }, icon('target', { size: 40 }),
        h('div', { class: 'empty-title' }, 'لم نعثر على هذا الهدف'),
        h('p', null, 'ربما حُذف أو لم يعد له عدد مستهدف.'),
        h('p', { style: { marginTop: '16px' } }, h('a', { class: 'btn btn-outline', href: '#/checklist' }, 'العودة إلى وِردي'))),
    );
    return undefined;
  }
  const target = goal.target;
  root.classList.add('counter-page');

  let day = todayKey();
  let count = await store.getCount(goal.id);
  let saved = count;
  let timer = null;
  let alive = true;
  let celebrated = count >= target;

  /* persistence: taps are batched (one write at most every 400 ms) and flushed when leaving */
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (count === saved) return Promise.resolve();
    saved = count;
    return store.setCount(goal.id, count).catch((e) => { console.error(e); if (alive) toast('تعذّر حفظ العدّ على هذا الجهاز'); });
  }
  const schedule = () => { if (!timer) timer = setTimeout(flush, 400); };

  /* view */
  const numEl = h('span', { class: 'tasbih-num num' });
  const ofEl = h('span', { class: 'tasbih-of num' }, 'من ' + fmt(target));
  const bar = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'tasbih-ring');
  svg.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [el, cls] of [[track, 'tasbih-track'], [bar, 'tasbih-bar']]) {
    el.setAttribute('cx', '60'); el.setAttribute('cy', '60'); el.setAttribute('r', String(R)); el.setAttribute('class', cls);
    svg.append(el);
  }
  bar.setAttribute('stroke-dasharray', String(C));

  const tapBtn = h('button', { type: 'button', class: 'tasbih', onclick: () => add(1) },
    svg, h('span', { class: 'tasbih-face' }, numEl, ofEl));
  const status = h('p', { class: 'tasbih-status', 'aria-live': 'polite' });
  const undoBtn = iconButton('minus', 'تراجع عن عدّة واحدة', () => add(-1));

  function sync() {
    const done = count >= target;
    numEl.textContent = fmt(count);
    bar.style.strokeDashoffset = String(C * (1 - Math.min(1, count / target)));
    root.classList.toggle('is-done', done);
    tapBtn.setAttribute('aria-label', `عُدّ: ${count} من ${target}`);
    status.textContent = done
      ? (count > target ? `أتممتَ الهدف وزدتَ ${fmt(count - target)} — تقبّل الله منك` : 'أتممتَ هدف اليوم — تقبّل الله منك')
      : `المتبقي ${fmt(target - count)}`;
    undoBtn.disabled = count === 0;
  }
  function checkDay() {
    const now = todayKey();
    if (now === day) return;
    day = now; count = 0; saved = 0; celebrated = false; // a new day started while the page was open
  }
  function setTo(n, { big = false } = {}) {
    checkDay();
    count = Math.max(0, Math.min(10000000, Math.floor(n) || 0));
    const done = count >= target;
    if (done && !celebrated) {
      celebrated = true;
      haptic(60);
      toast(`تم تأشير «${goal.title}» في قائمة اليوم`, { icon: 'check', duration: 3200 });
      flush();
    } else {
      if (!done) celebrated = false;
      haptic(big ? 20 : 10);
      schedule();
    }
    sync();
  }
  const add = (d) => setTo(count + d, { big: Math.abs(d) > 1 });

  function openManual() {
    const input = h('input', { class: 'input num', type: 'number', min: '0', max: '10000000', step: '1', inputmode: 'numeric', value: String(count) });
    const sheet = openSheet({
      title: 'إدخال العدد',
      body: field('عدد اليوم حتى الآن', input, 'استعمله إن كنتَ تعدّ بمسبحة أو عدّاد آخر.'),
      footer: [
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sheet.close() }, 'إلغاء'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { setTo(parseInt(input.value, 10) || 0, { big: true }); sheet.close(); } }, 'حفظ'),
      ],
    });
  }
  async function reset() {
    const ok = await confirmSheet({ title: 'تصفير العدّاد', message: `سيبدأ عدّ «${goal.title}» لهذا اليوم من الصفر.`, confirmLabel: 'تصفير', danger: true });
    if (ok && alive) setTo(0, { big: true });
  }

  root.append(
    pageHeader({
      title: goal.title, subtitle: `الهدف اليومي: ${fmt(target)} مرة`, back: '/checklist',
      actions: [iconButton('edit', 'إدخال العدد يدويًّا', openManual), iconButton('refresh', 'تصفير عدّاد اليوم', reset)],
    }),
    h('div', { class: 'tasbih-wrap' }, tapBtn, status),
    h('div', { class: 'tasbih-quick' },
      undoBtn,
      [10, 33, 100, 1000].map((n) => h('button', { type: 'button', class: 'chip', onclick: () => add(n) }, h('span', { class: 'num' }, '+' + fmt(n)))),
    ),
    h('p', { class: 'tasbih-hint' }, 'اضغط الدائرة مع كل مرة، أو أضف دفعة واحدة إن عددتَ بغير التطبيق.'),
  );
  // a goal tied to a dhikr of the book shows its full text and takhrij (verbatim from data/adhkar.json)
  if (goal.dhikr) {
    const [c, i] = String(goal.dhikr).split('.').map(Number);
    const box = h('div');
    root.insertBefore(box, root.querySelector('.tasbih-wrap'));
    loadAdhkar().then((all) => {
      const cat = all.find((x) => x.id === c);
      const item = cat && cat.items.find((x) => x.id === i);
      if (!item || !alive) return;
      box.append(h('article', { class: 'card dhikr-card tasbih-dhikr' },
        h('p', { class: 'ar-text dhikr-text' }, item.text),
        item.ref && h('p', { class: 'dhikr-ref' }, h('span', { class: 'dhikr-ref-label' }, 'التخريج'), item.ref)));
    }).catch((e) => console.error(e));
  }
  sync();

  const onHide = () => { flush(); };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    alive = false;
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onHide);
    flush();
  };
}

export const routes = [{ path: '/counter/:id', tab: 'checklist', immersive: true, render }];
