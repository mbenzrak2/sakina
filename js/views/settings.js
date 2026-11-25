// Settings — appearance, backup, about.
import { store, parseKey } from '../store.js';
import { h, icon, pageHeader, toast, confirmSheet, formatDate } from '../ui.js';
import { exportBackup } from '../backup.js';

async function render(root) {
  const s = store.getSettings();

  const themes = [['dark', 'داكن'], ['light', 'فاتح'], ['auto', 'تلقائي']];
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'المظهر', style: { minWidth: '210px' } });
  const paintSeg = (cur) => seg.replaceChildren(...themes.map(([v, label]) =>
    h('button', { class: v === cur ? 'active' : '', 'aria-pressed': String(v === cur), onclick: async () => { await store.setSettings({ theme: v }); paintSeg(v); } }, label)));
  paintSeg(s.theme);

  const sample = h('p', { class: 'ar-text', style: { textAlign: 'center', padding: '6px 16px 16px' } }, 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ');
  const range = h('input', {
    class: 'range', type: 'range', min: '0.85', max: '1.6', step: '0.05', value: String(s.arScale), 'aria-label': 'حجم خط الأذكار والقرآن',
    oninput: (e) => document.documentElement.style.setProperty('--ar-scale', e.target.value),
    onchange: (e) => store.setSettings({ arScale: parseFloat(e.target.value) }),
  });

  const file = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { toast('الملف غير صالح'); return; }
      if (!data || data.app !== 'sakina') { toast('هذا ليس ملف نسخة احتياطية لسَكينة'); return; }
      const ok = await confirmSheet({
        title: 'استعادة نسخة احتياطية',
        message: `سيتم استبدال جميع بياناتك الحالية بمحتوى النسخة (${data.days ? data.days.length : 0} يومًا مسجّلًا). هل تريد المتابعة؟`,
        confirmLabel: 'استعادة', danger: true,
      });
      if (!ok) return;
      try { await store.importAll(data); toast('تمت الاستعادة بنجاح', { icon: 'check' }); } catch { toast('تعذّرت الاستعادة'); }
    },
  });

  const persistRow = h('div', { class: 'setting-sub' }, '…');
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => {
      persistRow.textContent = p
        ? 'التخزين الدائم مفعّل: لن يحذف المتصفح بياناتك تلقائيًّا.'
        : 'ثبّت التطبيق على جهازك واحتفظ بنسخة احتياطية دورية لحماية سجلّك.';
    });
  } else persistRow.textContent = 'احتفظ بنسخة احتياطية دورية لحماية سجلّك.';

  const lastRow = h('div', { class: 'row-sub' });
  const paintLast = () => {
    const last = store.getBackup().last;
    lastRow.textContent = last
      ? `آخر نسخة: ${formatDate(parseKey(last))} · يذكّرك التطبيق كل شهر`
      : 'لم تُنزَّل أي نسخة بعد · ملف يضم أهدافك وأذكارك وسجلّك كاملًا';
  };
  paintLast();

  root.append(
    pageHeader({ title: 'الإعدادات', back: '/' }),

    h('div', { class: 'section-title' }, 'المظهر'),
    h('div', { class: 'list' },
      h('div', { class: 'setting' }, h('div', null, h('div', { class: 'setting-title' }, 'السِّمة')), seg),
      h('div', { class: 'setting' },
        h('div', null, h('div', { class: 'setting-title' }, 'حجم خط الأذكار والقرآن')), range),
      sample,
    ),

    h('div', { class: 'section-title' }, 'بياناتك'),
    h('div', { class: 'list' },
      h('div', { class: 'setting' },
        h('div', null, h('div', { class: 'setting-title' }, 'كل شيء محفوظ على جهازك'), persistRow),
        icon('check', { size: 20, class: 'gold' })),
      h('button', {
        class: 'row', onclick: async () => { await exportBackup(); paintLast(); },
      }, h('div', { class: 'row-badge' }, icon('download', { size: 20 })),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, 'تصدير نسخة احتياطية'), lastRow)),
      h('button', { class: 'row', onclick: () => file.click() },
        h('div', { class: 'row-badge' }, icon('upload', { size: 20 })),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, 'استعادة من نسخة احتياطية'), h('div', { class: 'row-sub' }, 'عند تغيير الهاتف أو المتصفح'))),
      h('button', {
        class: 'row', onclick: async () => {
          const ok = await confirmSheet({
            title: 'حذف جميع البيانات',
            message: 'سيُحذف سجلّك وأهدافك وأذكارك الخاصة نهائيًّا من هذا الجهاز. لا يمكن التراجع عن هذا الإجراء.',
            confirmLabel: 'حذف الكل', danger: true,
          });
          if (!ok) return;
          await store.wipe();
          toast('تم حذف البيانات');
        },
      }, h('div', { class: 'row-badge', style: { color: 'var(--danger)', background: 'var(--danger-soft)' } }, icon('trash', { size: 20 })),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, 'حذف جميع البيانات'), h('div', { class: 'row-sub' }, 'إعادة التطبيق إلى حالته الأولى'))),
    ),
    file,

    h('div', { class: 'section-title' }, 'حول التطبيق'),
    h('div', { class: 'card about' },
      h('p', null, 'سَكينة تطبيق يعمل كليًّا بدون إنترنت: لا حسابات، لا إعلانات، ولا يغادر أي شيء جهازك.'),
      h('p', { style: { marginTop: '10px' } }, 'نصوص الأذكار من كتاب «حصن المسلم» لسعيد بن علي بن وهف القحطاني (مجموعة ',
        h('span', { class: 'num' }, 'rn0x/Adhkar-json'), '). نص القرآن الكريم بالرسم العثماني (مجموعة ',
        h('span', { class: 'num' }, 'risan/quran-json'), '). الخطوط: Amiri و Amiri Quran و Tajawal برخصة SIL OFL.'),
      h('p', { class: 'muted', style: { marginTop: '10px' } }, 'الإصدار 1.6.1'),
    ),
  );
}

export const routes = [{ path: '/settings', tab: 'home', immersive: true, render }];
