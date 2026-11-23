// Home — today's overview.
import { store } from '../store.js';
import { loadQuran } from '../data.js';
import { hijriSupported } from '../hijri.js';
import { nextBid, inDaysLabel } from './bid.js';
import { h, icon, clear, ring, iconButton, navigate, formatDate, formatHijri, daysLabel, haptic } from '../ui.js';

const MARK =
  '<svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="var(--gold-2)"/><stop offset="1" stop-color="var(--gold)"/></linearGradient></defs>' +
  '<g fill="none" stroke="url(#bm)" stroke-width="4" stroke-linejoin="round">' +
  '<rect x="20" y="20" width="60" height="60"/><rect x="20" y="20" width="60" height="60" transform="rotate(45 50 50)"/></g>' +
  '<circle cx="50" cy="50" r="9" fill="url(#bm)"/></svg>';

function goalsLeftLabel(n) {
  if (n === 1) return 'بقي لك هدف واحد اليوم';
  if (n === 2) return 'بقي لك هدفان اليوم';
  if (n <= 10) return `بقيت لك ${n} أهداف اليوم`;
  return `بقي لك ${n} هدفًا اليوم`;
}
function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'ليلة مباركة';
  if (hr < 12) return 'صباح الخير والبركة';
  if (hr < 17) return 'طاب يومك';
  return 'مساء الخير والبركة';
}
function goalHref(g) {
  if (g.target > 0) return '/counter/' + encodeURIComponent(g.id);
  if (!g.link) return '/checklist';
  return g.link.kind === 'quran' ? '/quran' : '/adhkar/' + g.link.key;
}

async function render(root) {
  const now = new Date();
  const hijri = formatHijri(now);
  const brand = h('div', { class: 'brand' });
  brand.innerHTML = MARK;
  brand.append(
    h('div', { style: { flex: '1' } },
      h('div', { class: 'brand-name' }, 'سَكينة'),
      h('div', { class: 'brand-date' }, formatDate(now) + (hijri ? ' · ' + hijri : '')),
    ),
    iconButton('settings', 'الإعدادات', () => navigate('/settings')),
  );

  const hero = h('section', { class: 'card hero' });
  const remainingBox = h('div');
  const bidBox = h('div');
  const paintBid = () => {
    clear(bidBox);
    if (!hijriSupported()) return;
    const n = nextBid();
    if (n.state === 'none') return;
    const near = n.state === 'today' || n.inDays <= 3;
    bidBox.append(h('a', { class: 'card bid-card' + (near ? ' gilded' : ''), href: '#/bid' },
      h('div', { class: 'row-badge' }, icon('moon', { size: 22 })),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, n.state === 'today' ? 'اليوم من الأيام البيض — صيام' : 'الأيام البيض ' + inDaysLabel(n.inDays)),
        h('div', { class: 'row-sub' }, n.state === 'today' ? `اليوم ${n.day} من الشهر الهجري` : formatDate(n.date))),
      h('div', { class: 'row-end' }, icon('chevron', { size: 20 }))));
  };
  const quick = h('div', { class: 'grid-2' });
  const cont = h('div');
  paintBid();
  root.append(brand, hero, bidBox, remainingBox,
    h('div', { class: 'section-title' }, 'وصول سريع'), quick, cont);

  const isMorning = now.getHours() < 15;
  const tiles = [
    isMorning
      ? { href: '/adhkar/1:am', icon: 'sun', title: 'أذكار الصباح', sub: 'ابدأ يومك بذكر الله' }
      : { href: '/adhkar/1:pm', icon: 'moon', title: 'أذكار المساء', sub: 'اختم يومك بذكر الله' },
    { href: '/adhkar/27', icon: 'beads', title: 'بعد الصلاة', sub: 'لكل صلاة أذكارها' },
    { href: '/adhkar/2', icon: 'bed', title: 'أذكار النوم', sub: 'قبل أن تنام' },
    { href: '/adhkar', icon: 'plus', title: 'أذكاري', sub: 'أضف ذكرًا خاصًّا بك' },
  ];
  quick.append(...tiles.map((t) => h('a', { class: 'tile', href: '#' + t.href },
    icon(t.icon, { size: 26 }), h('div', { class: 'tile-title' }, t.title), h('div', { class: 'tile-sub' }, t.sub))));

  async function paintContinue() {
    const q = store.getQuran();
    clear(cont);
    let title = 'القرآن الكريم', sub = 'ابدأ القراءة', href = '/quran';
    if (q.last) {
      try {
        const s = (await loadQuran())[q.last.s - 1];
        if (s) { title = 'متابعة القراءة'; sub = `سورة ${s.name} · الآية ${q.last.a}`; href = `/quran/${q.last.s}/${q.last.a}`; }
      } catch { /* data not available yet */ }
    }
    cont.append(
      h('div', { class: 'section-title' }, 'القرآن الكريم'),
      h('a', { class: 'card gilded continue', href: '#' + href },
        h('div', { class: 'row-badge' }, icon('quran', { size: 24 })),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), h('div', { class: 'row-sub' }, sub)),
        h('div', { class: 'row-end' }, icon('chevron', { size: 20 })),
      ),
    );
  }

  async function paint() {
    const [day, stats] = await Promise.all([store.getDay(), store.stats()]);
    const s = store.dayStats(day);
    const goals = store.goalsFor();
    const left = goals.filter((g) => !(day && day.done[g.id]));

    clear(hero).append(
      h('div', { class: 'hero-day' },
        ring(s.ratio, { size: 112, stroke: 9, label: `${s.done}/${s.total}`, sub: 'وِرد اليوم' }),
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('div', { class: 'small muted' }, greeting()),
          h('h2', null, !s.total ? 'أضف أهدافك اليومية' : left.length ? goalsLeftLabel(left.length) : 'أتممتَ وِرد اليوم، تقبّل الله منك'),
          h('div', { class: 'hero-meta' },
            h('span', { class: 'badge' }, icon('flame', { size: 14 }), stats.current ? 'متتابع: ' + daysLabel(stats.current) : 'ابدأ سلسلتك اليوم'),
            stats.best > 1 && h('span', { class: 'badge ok' }, 'الأفضل: ' + daysLabel(stats.best)),
          ),
        ),
      ),
    );

    clear(remainingBox);
    if (left.length) {
      remainingBox.append(
        h('div', { class: 'section-title' }, 'المتبقي اليوم', h('a', { href: '#/checklist' }, 'عرض الكل')),
        h('div', { class: 'list' }, left.slice(0, 4).map((g) =>
          h('div', { class: 'row' },
            h('button', {
              class: 'check', role: 'checkbox', 'aria-checked': 'false', 'aria-label': 'إنجاز: ' + g.title,
              onclick: async (e) => { e.currentTarget.classList.add('on'); haptic(); await store.toggleGoal(g.id, true); },
            }, icon('check', { size: 16, stroke: 2.4 })),
            h('a', { class: 'row-main', href: '#' + goalHref(g) }, h('div', { class: 'row-title' }, g.title)),
            h('a', { class: 'row-end', href: '#' + goalHref(g), 'aria-label': 'فتح ' + g.title }, icon(g.icon || 'check', { size: 20 }), icon('chevron', { size: 18 })),
          ))),
      );
    }
  }

  await Promise.all([paint(), paintContinue()]);
  return store.on((type) => {
    if (type === 'day' || type === 'goals' || type === 'import') paint();
    if (type === 'quran' || type === 'import') paintContinue();
    if (type === 'settings' || type === 'import') paintBid();
  });
}

export const routes = [{ path: '/', tab: 'home', render }];
