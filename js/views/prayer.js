// مواقيت الصلاة — today's prayer times, location, calculation method, reminder before each prayer.
import { store } from '../store.js';
import {
  METHODS, PRAYERS, CITIES, prayerConfig, hasLocation, savePrayer, prayerTimes, nextPrayer, formatTime, untilLabel,
} from '../prayer.js';
import { h, icon, clear, pageHeader, openSheet, field, toast, downloadText, formatDate } from '../ui.js';
import { notifySupported, notifyPermission, askNotifyPermission, schedulePrayerReminders, buildPrayerCalendar } from '../notify.js';

const LEADS = [5, 10, 15, 20];
const signed = (n) => (n > 0 ? `+${n}` : String(n));

async function render(root) {
  root.append(pageHeader({ title: 'مواقيت الصلاة', subtitle: formatDate(new Date()), back: '/' }));
  const hero = h('section', { class: 'card hero bid-hero' });
  const timesBox = h('div');
  const setupBox = h('div', { class: 'list' });
  const notifyBox = h('div', { class: 'list' });
  root.append(hero, timesBox,
    h('div', { class: 'section-title' }, 'الموقع والحساب'), setupBox,
    h('div', { class: 'section-title' }, 'التذكير قبل الصلاة'), notifyBox,
    h('p', { class: 'bid-note' }, 'المواقيت محسوبة فلكيًّا على جهازك وقد تختلف دقيقة أو دقيقتين عن التوقيت الرسمي لبلدك. قارنها مرة بتوقيت مسجدك وعدّل الدقائق إن لزم.'));

  function paintHero() {
    const cfg = prayerConfig();
    const n = nextPrayer(new Date(), cfg);
    clear(hero).append(
      h('div', { class: 'bid-moon' }, icon('clock', { size: 34 })),
      h('div', { style: { flex: '1', minWidth: '0' } },
        !hasLocation(cfg)
          ? [h('h2', { class: 'bid-title' }, 'حدّد موقعك أولًا'), h('p', { class: 'small muted' }, 'تُحسب المواقيت من موقعك، دون إنترنت.'),
            h('button', { type: 'button', class: 'btn btn-sm btn-primary bid-fast', onclick: openLocation }, 'تحديد الموقع')]
          : n ? [h('div', { class: 'small muted' }, 'الصلاة القادمة · ' + cfg.name),
            h('h2', { class: 'bid-title' }, n.label, ' ', h('span', { class: 'num' }, formatTime(n.time))),
            h('p', { class: 'small muted' }, untilLabel(n.time))]
            : h('h2', { class: 'bid-title' }, 'تعذّر حساب المواقيت لهذا الموقع')),
    );
  }

  function paintTimes() {
    const cfg = prayerConfig();
    clear(timesBox);
    if (!hasLocation(cfg)) return;
    const now = new Date();
    const t = prayerTimes(now, cfg);
    const n = nextPrayer(now, cfg);
    const nextToday = n && n.time.toDateString() === now.toDateString() ? n.id : null;
    timesBox.append(h('div', { class: 'list pt-list' }, PRAYERS.map((p) => h('div', {
      class: 'row pt-row' + (p.id === nextToday ? ' is-next' : '') + (p.info ? ' is-info' : '') + (t[p.id] && t[p.id] <= now ? ' is-past' : ''),
    },
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, p.label)),
    cfg.adj[p.id] ? h('span', { class: 'badge num' }, signed(cfg.adj[p.id]) + ' د') : null,
    h('div', { class: 'pt-time num' }, formatTime(t[p.id]))))));
  }

  function paintSetup() {
    const cfg = prayerConfig();
    const rowBtn = (ic, title, sub, onclick) => h('button', { type: 'button', class: 'row', onclick },
      h('div', { class: 'row-badge' }, icon(ic, { size: 20 })),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), h('div', { class: 'row-sub bid-wrap' }, sub)),
      h('div', { class: 'row-end' }, icon('chevron', { size: 18 })));
    const nAdj = PRAYERS.filter((p) => cfg.adj[p.id]).length;
    clear(setupBox).append(
      rowBtn('target', 'الموقع', hasLocation(cfg) ? `${cfg.name} (${cfg.lat.toFixed(2)}، ${cfg.lng.toFixed(2)})` : 'لم يُحدَّد بعد', openLocation),
      rowBtn('settings', 'طريقة الحساب', `${(METHODS[cfg.method] || METHODS.morocco).label} · العصر: ${cfg.asr === 2 ? 'الحنفي' : 'الجمهور'}`, openMethod),
      rowBtn('edit', 'تعديل الدقائق', nAdj ? `عدّلتَ ${nAdj} من المواقيت` : 'لمطابقة توقيت مسجدك أو التوقيت الرسمي', openAdjust),
    );
  }

  function paintNotify() {
    const cfg = prayerConfig();
    const perm = notifyPermission();
    const on = cfg.notify && perm === 'granted';
    const toggle = h('button', {
      type: 'button', class: 'btn btn-sm ' + (on ? 'btn-ghost' : 'btn-primary'), disabled: perm === 'unsupported' || perm === 'denied' || !hasLocation(cfg),
      onclick: async () => {
        if (on) { await savePrayer({ notify: false }); toast('أُوقف التذكير'); }
        else if (await askNotifyPermission()) { await savePrayer({ notify: true }); toast('فُعّل التذكير', { icon: 'check' }); }
        else toast('لم يُسمح بالإشعارات');
      },
    }, on ? 'إيقاف' : 'تفعيل');
    const sub = perm === 'unsupported' ? 'هذا المتصفح لا يدعم الإشعارات.'
      : perm === 'denied' ? 'الإشعارات محظورة لهذا الموقع. اسمح بها من إعدادات المتصفح.'
        : !hasLocation(cfg) ? 'حدّد موقعك أولًا.'
          : 'يظهر التنبيه ما دام التطبيق مفتوحًا أو في الخلفية. إذا أغلقه النظام فلن يصل: استعمل تقويم الهاتف أسفله ليكون مضمونًا.';
    const lead = h('div', { class: 'seg', role: 'group', 'aria-label': 'مدة التذكير قبل الصلاة' }, LEADS.map((m) => h('button', {
      type: 'button', class: m === cfg.lead ? 'active' : '', 'aria-pressed': String(m === cfg.lead), onclick: () => savePrayer({ lead: m }),
    }, h('span', { class: 'num' }, String(m)), ' د')));
    clear(notifyBox).append(
      h('div', { class: 'setting' },
        h('div', null, h('div', { class: 'setting-title' }, `تنبيه قبل كل صلاة بـ ${cfg.lead} دقائق`), h('div', { class: 'setting-sub' }, sub)), toggle),
      h('div', { class: 'setting' }, h('div', null, h('div', { class: 'setting-title' }, 'قبل الصلاة بـ')), lead),
      h('button', {
        type: 'button', class: 'row', disabled: !hasLocation(cfg), onclick: () => {
          const cal = buildPrayerCalendar(30);
          downloadText('mawaqit-as-salat.ics', cal.text, 'text/calendar;charset=utf-8');
          toast(`تم تنزيل ${cal.count} موعدًا — افتح الملف لإضافته إلى تقويمك`, { icon: 'download', duration: 4200 });
        },
      },
      h('div', { class: 'row-badge' }, icon('history', { size: 20 })),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, 'إضافة إلى تقويم الهاتف'),
        h('div', { class: 'row-sub bid-wrap' }, `الأضمن: مواقيت 30 يومًا مع منبّه قبل كل صلاة بـ ${cfg.lead} دقائق، يعمل والتطبيق مغلق. جدّده كل شهر.`)),
      h('div', { class: 'row-end' }, icon('download', { size: 20 }))),
    );
  }

  /* sheets */
  function openLocation() {
    const cfg = prayerConfig();
    const sel = h('select', { class: 'select' },
      h('option', { value: '' }, 'اختر مدينة…'),
      CITIES.map(([name], i) => h('option', { value: String(i), selected: name === cfg.name }, name)));
    const lat = h('input', { class: 'input num', type: 'number', step: 'any', inputmode: 'decimal', placeholder: '33.57', value: hasLocation(cfg) ? String(cfg.lat) : '' });
    const lng = h('input', { class: 'input num', type: 'number', step: 'any', inputmode: 'decimal', placeholder: '-7.59', value: hasLocation(cfg) ? String(cfg.lng) : '' });
    let name = cfg.name;
    sel.addEventListener('change', () => {
      const c = CITIES[Number(sel.value)];
      if (sel.value === '' || !c) return;
      name = c[0]; lat.value = String(c[1]); lng.value = String(c[2]);
    });
    const gps = h('button', {
      type: 'button', class: 'btn btn-outline', disabled: !('geolocation' in navigator), onclick: () => {
        gps.disabled = true;
        navigator.geolocation.getCurrentPosition((pos) => {
          gps.disabled = false;
          lat.value = pos.coords.latitude.toFixed(4); lng.value = pos.coords.longitude.toFixed(4);
          name = 'موقعي'; sel.value = '';
          toast('تم تحديد موقعك', { icon: 'check' });
        }, () => { gps.disabled = false; toast('تعذّر تحديد الموقع — اختر مدينتك من القائمة'); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 });
      },
    }, icon('target', { size: 18 }), 'استعمال موقعي الحالي (GPS)');
    const sheet = openSheet({
      title: 'الموقع',
      body: h('div', null,
        field('المدينة', sel),
        h('p', { style: { margin: '12px 0' } }, gps),
        h('div', { class: 'grid-2' }, field('خط العرض', lat), field('خط الطول', lng)),
        h('p', { class: 'setting-sub', style: { marginTop: '10px' } }, 'موقعك يبقى على جهازك ولا يُرسل إلى أي مكان.')),
      footer: [
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sheet.close() }, 'إلغاء'),
        h('button', {
          type: 'button', class: 'btn btn-primary', onclick: async () => {
            const la = parseFloat(lat.value), lo = parseFloat(lng.value);
            if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 66 || Math.abs(lo) > 180) { toast('إحداثيات غير صالحة'); return; }
            const city = CITIES.find((c) => c[1] === la && c[2] === lo);
            await savePrayer({ lat: la, lng: lo, name: city ? city[0] : (name && !CITIES.some((c) => c[0] === name) ? name : 'موقعي') });
            sheet.close();
          },
        }, 'حفظ'),
      ],
    });
  }

  function openMethod() {
    const cfg = prayerConfig();
    const method = h('select', { class: 'select' }, Object.entries(METHODS).map(([id, m]) => h('option', { value: id, selected: id === cfg.method }, m.label)));
    const asr = h('select', { class: 'select' },
      h('option', { value: '1', selected: cfg.asr !== 2 }, 'الجمهور (المالكي، الشافعي، الحنبلي)'),
      h('option', { value: '2', selected: cfg.asr === 2 }, 'الحنفي'));
    const sheet = openSheet({
      title: 'طريقة الحساب',
      body: h('div', null, field('الطريقة', method, 'تحدّد زاوية الفجر والعشاء.'), field('وقت العصر', asr)),
      footer: [
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sheet.close() }, 'إلغاء'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { await savePrayer({ method: method.value, asr: Number(asr.value) }); sheet.close(); } }, 'حفظ'),
      ],
    });
  }

  function openAdjust() {
    const adj = { ...prayerConfig().adj };
    const body = h('div', { class: 'list' });
    const paint = () => clear(body).append(...PRAYERS.map((p) => {
      const v = adj[p.id] || 0;
      const set = (n) => { adj[p.id] = Math.max(-30, Math.min(30, n)); paint(); };
      return h('div', { class: 'setting' },
        h('div', { class: 'setting-title' }, p.label),
        h('div', { class: 'bid-stepper' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'تأخير دقيقة: ' + p.label, onclick: () => set(v - 1) }, icon('minus', { size: 18 })),
          h('span', { class: 'num bid-offset' }, v ? signed(v) + ' د' : '0'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'زيادة دقيقة: ' + p.label, onclick: () => set(v + 1) }, icon('plus', { size: 18 }))));
    }));
    paint();
    const sheet = openSheet({
      title: 'تعديل الدقائق',
      body,
      footer: [
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sheet.close() }, 'إلغاء'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { await savePrayer({ adj }); sheet.close(); } }, 'حفظ'),
      ],
    });
  }

  const paintAll = () => { paintHero(); paintTimes(); paintSetup(); paintNotify(); };
  paintAll();
  const tick = setInterval(() => { paintHero(); paintTimes(); }, 30000);
  const off = store.on((type) => { if (type === 'settings' || type === 'import') { paintAll(); schedulePrayerReminders(); } });
  return () => { clearInterval(tick); off(); };
}

export const routes = [{ path: '/prayer', tab: 'home', immersive: true, render }];
