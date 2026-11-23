// الأيام البيض — the white days (13, 14, 15 of each lunar month): dates, reminders, Hijri adjustment.
import { store } from '../store.js';
import { hijriSupported, hijriParts, isBidDay, upcomingBid, formatHijriLong } from '../hijri.js';
import { h, icon, clear, pageHeader, toast, downloadText, formatDate, formatDayMonth } from '../ui.js';
import { notifySupported, notifyPermission, enableNotifications, disableNotifications, checkReminder, buildBidCalendar } from '../notify.js';

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);

/** { state:'today'|'soon'|'none', date, day, inDays } for the nearest white day from today. */
export function nextBid(now = new Date()) {
  const groups = upcomingBid(2, now);
  const first = groups.length && groups[0].days[0];
  if (!first) return { state: 'none' };
  const inDays = dayDiff(first.date, now);
  return { state: inDays === 0 ? 'today' : 'soon', date: first.date, day: first.day, inDays, group: groups[0] };
}
export function inDaysLabel(n) {
  if (n === 1) return 'غدًا';
  if (n === 2) return 'بعد يومين';
  if (n <= 10) return `بعد ${n} أيام`;
  return `بعد ${n} يومًا`;
}

async function render(root) {
  root.append(pageHeader({ title: 'الأيام البيض', subtitle: 'صيام 13 و14 و15 من كل شهر هجري', back: '/' }));
  if (!hijriSupported()) {
    root.append(h('div', { class: 'empty' }, icon('info', { size: 36 }),
      h('div', { class: 'empty-title' }, 'التقويم الهجري غير مدعوم'),
      h('p', null, 'متصفحك لا يوفّر التقويم الهجري، فلا يمكن حساب الأيام البيض على هذا الجهاز.')));
    return undefined;
  }

  const hero = h('section', { class: 'card hero bid-hero' });
  const listBox = h('div');
  const notifyBox = h('div', { class: 'list' });
  const offsetBox = h('div', { class: 'list' });

  function paintHero() {
    const now = new Date();
    const n = nextBid(now);
    const p = hijriParts(now);
    clear(hero).append(
      h('div', { class: 'bid-moon' }, icon('moon', { size: 34 })),
      h('div', { style: { flex: '1', minWidth: '0' } },
        h('div', { class: 'small muted' }, 'اليوم: ' + formatHijriLong(now)),
        h('h2', { class: 'bid-title' },
          n.state === 'today' ? `اليوم ${p.d} — من الأيام البيض`
            : n.state === 'soon' ? `أول الأيام البيض ${inDaysLabel(n.inDays)}`
              : 'لا أيام بيض قريبة'),
        n.state !== 'none' && h('p', { class: 'small muted' }, n.state === 'today' ? 'تقبّل الله صيامك.' : formatDate(n.date)),
      ),
    );
    hero.classList.toggle('is-today', n.state === 'today');
  }

  function paintList() {
    const now = startOfDay(new Date());
    const groups = upcomingBid(6);
    clear(listBox).append(
      h('div', { class: 'section-title' }, 'المواعيد القادمة'),
      h('div', { class: 'list' }, groups.map((g) => h('div', { class: 'row bid-row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, g.monthLabel),
          h('div', { class: 'bid-days' }, g.days.map((d) => h('span', { class: 'bid-day' + (dayDiff(d.date, now) === 0 ? ' today' : '') },
            h('b', { class: 'num' }, String(d.day)), h('span', null, formatDayMonth(d.date))))),
          g.month === 12 && h('div', { class: 'row-sub' }, 'يوم 13 من ذي الحجة من أيام التشريق، فلا يُصام.'),
        )))),
    );
  }

  function paintNotify() {
    const on = store.getSettings().notify && notifyPermission() === 'granted';
    const perm = notifyPermission();
    const toggle = h('button', {
      type: 'button', class: 'btn btn-sm ' + (on ? 'btn-ghost' : 'btn-primary'), disabled: perm === 'unsupported' || perm === 'denied',
      onclick: async () => {
        if (on) { await disableNotifications(); toast('أُوقفت التنبيهات'); }
        else if (await enableNotifications()) { toast('فُعّلت التنبيهات', { icon: 'check' }); checkReminder(); }
        else toast('لم يُسمح بالإشعارات');
        paintNotify();
      },
    }, on ? 'إيقاف' : 'تفعيل');
    const sub = perm === 'unsupported' ? 'هذا المتصفح لا يدعم الإشعارات.'
      : perm === 'denied' ? 'الإشعارات محظورة لهذا الموقع. اسمح بها من إعدادات المتصفح.'
        : 'تنبيه مساء اليوم السابق وفي يوم الصيام. يظهر عند فتح التطبيق، وقد يظهر في الخلفية إذا كان مثبّتًا على أندرويد.';
    clear(notifyBox).append(
      h('div', { class: 'setting' },
        h('div', null, h('div', { class: 'setting-title' }, 'تنبيهات التطبيق'), h('div', { class: 'setting-sub' }, sub)), toggle),
      h('button', {
        type: 'button', class: 'row', onclick: () => {
          const cal = buildBidCalendar(12);
          downloadText('ayyam-al-bid.ics', cal.text, 'text/calendar;charset=utf-8');
          toast(`تم تنزيل ${cal.count} موعدًا — افتح الملف لإضافته إلى تقويمك`, { icon: 'download', duration: 4200 });
        },
      },
      h('div', { class: 'row-badge' }, icon('history', { size: 20 })),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, 'إضافة إلى تقويم الهاتف'),
        h('div', { class: 'row-sub bid-wrap' }, 'الأضمن: مواعيد 12 شهرًا مع منبّه الساعة 8 مساءً قبل كل يوم، يعمل دون فتح التطبيق.')),
      h('div', { class: 'row-end' }, icon('download', { size: 20 }))),
    );
  }

  function paintOffset() {
    const cur = store.getSettings().hijriOffset || 0;
    const set = async (v) => { await store.setSettings({ hijriOffset: v }); paintAll(); };
    const label = cur === 0 ? 'بدون تعديل' : cur > 0 ? `+${cur}` : String(cur);
    clear(offsetBox).append(
      h('div', { class: 'setting' },
        h('div', null,
          h('div', { class: 'setting-title' }, 'تعديل التاريخ الهجري'),
          h('div', { class: 'setting-sub' }, 'التاريخ محسوب (تقويم أم القرى) وقد يختلف يومًا عن رؤية الهلال في بلدك. عدّله حتى يطابق التقويم المحلي.')),
        h('div', { class: 'bid-stepper' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'تأخير يوم', disabled: cur <= -2, onclick: () => set(cur - 1) }, icon('minus', { size: 18 })),
          h('span', { class: 'num bid-offset' }, label),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'تقديم يوم', disabled: cur >= 2, onclick: () => set(cur + 1) }, icon('plus', { size: 18 })),
        )),
    );
  }

  function paintAll() { paintHero(); paintList(); paintNotify(); paintOffset(); }

  root.append(
    hero, listBox,
    h('div', { class: 'section-title' }, 'التذكير'), notifyBox,
    h('div', { class: 'section-title' }, 'ضبط التاريخ'), offsetBox,
    h('p', { class: 'bid-note' }, isBidDay() ? 'هدف «صيام الأيام البيض» ظاهر اليوم في وِردك.' : 'يظهر هدف «صيام الأيام البيض» في وِردك تلقائيًّا في هذه الأيام فقط.'),
  );
  paintAll();
  return store.on((type) => { if (type === 'import') paintAll(); });
}

export const routes = [{ path: '/bid', tab: 'home', immersive: true, render }];
