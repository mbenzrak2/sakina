// Sakina — boot, shell and hash router.
import { store } from './store.js';
import { h, icon, clear, navigate } from './ui.js';
import { routes as homeRoutes } from './views/home.js';
import { routes as adhkarRoutes } from './views/adhkar.js';
import { routes as quranRoutes } from './views/quran.js';
import { routes as checklistRoutes } from './views/checklist.js';
import { routes as historyRoutes } from './views/history.js';
import { routes as counterRoutes } from './views/counter.js';
import { routes as settingsRoutes } from './views/settings.js';

const TABS = [
  { id: 'home', path: '/', label: 'الرئيسية', icon: 'home' },
  { id: 'adhkar', path: '/adhkar', label: 'الأذكار', icon: 'beads' },
  { id: 'quran', path: '/quran', label: 'القرآن', icon: 'quran' },
  { id: 'checklist', path: '/checklist', label: 'وِردي', icon: 'checklist' },
  { id: 'history', path: '/history', label: 'السجل', icon: 'history' },
];

const ROUTES = [homeRoutes, adhkarRoutes, quranRoutes, checklistRoutes, historyRoutes, counterRoutes, settingsRoutes]
  .flat()
  .map((r) => ({ ...r, segs: r.path.split('/').filter(Boolean) }));

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const r of ROUTES) {
    if (r.segs.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = r.segs[i];
      let val = parts[i];
      try { val = decodeURIComponent(val); } catch { /* keep raw */ }
      if (seg.startsWith(':')) params[seg.slice(1)] = val;
      else if (seg !== val) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

/* ───────────── theme ───────────── */

const lightMq = matchMedia('(prefers-color-scheme: light)');
export function applySettings() {
  const s = store.getSettings();
  const theme = s.theme === 'auto' ? (lightMq.matches ? 'light' : 'dark') : s.theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--ar-scale', String(s.arScale || 1));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f5efe2' : '#08100e';
  try { localStorage.setItem('sakina-theme', s.theme); } catch { /* private mode */ }
}
lightMq.addEventListener('change', applySettings);

/* ───────────── router ───────────── */

const view = document.getElementById('view');
const tabsEl = document.getElementById('tabs');
const stack = [];            // in-app navigation stack (for back + scroll restore)
const scrollPos = new Map();
let cleanup = null;
let token = 0;
let currentHash = null;

function currentPath() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

function buildTabs() {
  clear(tabsEl).append(...TABS.map((t) =>
    h('a', { class: 'tab', href: '#' + t.path, dataset: { tab: t.id } }, icon(t.icon, { size: 23 }), h('span', null, t.label))));
}
function setActiveTab(id) {
  for (const a of tabsEl.children) {
    const on = a.dataset.tab === id;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

async function render() {
  const path = currentPath();
  const m = match(path);
  if (!m) { navigate('/', { replace: true }); return; }

  // navigation stack bookkeeping
  if (currentHash !== null) scrollPos.set(currentHash, window.scrollY);
  let restore = 0;
  if (stack.length >= 2 && stack[stack.length - 2] === path) {
    stack.pop();
    restore = scrollPos.get(path) || 0;
  } else if (stack[stack.length - 1] !== path) {
    stack.push(path);
  }
  window.__sakinaDepth = stack.length - 1;
  currentHash = path;

  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  document.body.classList.toggle('immersive', !!m.route.immersive);
  setActiveTab(m.route.tab);

  const page = h('div', { class: 'page view-enter' });
  clear(view).append(page);
  window.scrollTo(0, 0);
  try {
    const c = await m.route.render(page, m.params);
    if (my !== token) { if (typeof c === 'function') c(); return; }
    cleanup = typeof c === 'function' ? c : null;
    if (restore) requestAnimationFrame(() => window.scrollTo(0, restore));
  } catch (e) {
    console.error(e);
    if (my !== token) return;
    clear(page).append(h('div', { class: 'empty' },
      icon('info', { size: 34 }),
      h('div', { class: 'empty-title' }, 'تعذّر عرض الصفحة'),
      h('p', null, 'حدث خطأ غير متوقع.'),
      h('p', { style: { marginTop: '16px' } }, h('a', { class: 'btn btn-outline', href: '#/' }, 'العودة إلى الرئيسية')),
    ));
  }
}

/* ───────────── boot ───────────── */

async function boot() {
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    view.append(h('div', { class: 'empty' },
      h('div', { class: 'empty-title' }, 'تعذّر فتح قاعدة البيانات المحلية'),
      h('p', null, 'تأكد أن المتصفح ليس في وضع التصفح الخاص ثم أعد المحاولة.')));
    return;
  }
  applySettings();
  store.on((type) => { if (type === 'settings' || type === 'import') applySettings(); });
  buildTabs();
  window.addEventListener('hashchange', render);
  await render();

  // a new day may start while the app stays open (installed PWA): refresh today's record
  let lastDay = new Date().toDateString();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const now = new Date().toDateString();
    if (now !== lastDay) { lastDay = now; await store.toggleGoal('__noop__', false); render(); }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}
boot();
