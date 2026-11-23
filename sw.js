// Sakina service worker — precaches the whole app so it runs with no connection at all.
// Bump VERSION whenever any file below changes: clients then pick up the new files.
const VERSION = 'sakina-v1.2.1';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/adhkar.css',
  'css/quran.css',
  'css/checklist.css',
  'css/history.css',
  'js/app.js',
  'js/store.js',
  'js/data.js',
  'js/ui.js',
  'js/hijri.js',
  'js/notify.js',
  'js/views/home.js',
  'js/views/adhkar.js',
  'js/views/quran.js',
  'js/views/checklist.js',
  'js/views/history.js',
  'js/views/counter.js',
  'js/views/bid.js',
  'js/views/settings.js',
  'data/adhkar.json',
  'data/quran.json',
  'fonts/amiri-arabic-400-normal.woff2',
  'fonts/amiri-arabic-700-normal.woff2',
  'fonts/amiri-quran-arabic-400-normal.woff2',
  'fonts/tajawal-arabic-400-normal.woff2',
  'fonts/tajawal-arabic-500-normal.woff2',
  'fonts/tajawal-arabic-700-normal.woff2',
  'fonts/tajawal-latin-400-normal.woff2',
  'fonts/tajawal-latin-500-normal.woff2',
  'fonts/tajawal-latin-700-normal.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== META).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first (instant + offline), refreshed in the background when a connection exists.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? './' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const refresh = fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) { event.waitUntil(refresh); return cached; }
    const res = await refresh;
    return res || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});

/* ───────────── white-days reminder (periodic background sync, installed app on Chrome/Android) ───────────── */
// Same rule as bidMessage() in js/notify.js; duplicated because a classic service worker cannot import modules.
const META = 'sakina-meta';

function readSettings() {
  return new Promise((resolve) => {
    const req = indexedDB.open('sakina', 1);
    req.onupgradeneeded = () => { // keep the schema identical to js/store.js if the worker is first to open it
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('days')) d.createObjectStore('days', { keyPath: 'date' });
    };
    req.onerror = () => resolve({});
    req.onsuccess = () => {
      try {
        const g = req.result.transaction('kv').objectStore('kv').get('settings');
        g.onsuccess = () => { resolve(g.result || {}); req.result.close(); };
        g.onerror = () => { resolve({}); req.result.close(); };
      } catch (e) { resolve({}); }
    };
  });
}
function hijriDay(date, offset) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (offset || 0), 12);
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric' }).formatToParts(d)) {
    if (p.type === 'day') out.d = parseInt(p.value, 10);
    if (p.type === 'month') out.m = parseInt(p.value, 10);
  }
  return out;
}
const isBid = (p) => p.d >= 13 && p.d <= 15 && !(p.m === 12 && p.d === 13);

async function bidReminder() {
  const s = await readSettings();
  if (!s.notify || self.Notification.permission !== 'granted') return;
  const now = new Date();
  const today = hijriDay(now, s.hijriOffset);
  const tomorrow = hijriDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), s.hijriOffset);
  let msg = null;
  if (isBid(tomorrow) && now.getHours() >= 15) msg = { slot: 'eve', title: 'غدًا من الأيام البيض', body: `غدًا يوم ${tomorrow.d} من الشهر الهجري. انوِ الصيام ولا تنسَ السحور.` };
  else if (isBid(today)) msg = { slot: 'day', title: 'اليوم من الأيام البيض', body: `اليوم ${today.d} من الشهر الهجري — يوم صيام.` };
  if (!msg) return;
  const stamp = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}:${msg.slot}`;
  const meta = await caches.open(META);
  const last = await meta.match('notified');
  if (last && (await last.text()) === stamp) return;
  await meta.put('notified', new Response(stamp));
  await self.registration.showNotification(msg.title, {
    body: msg.body, tag: 'bid-reminder', lang: 'ar', dir: 'rtl',
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/bid' },
  });
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'bid-reminder') event.waitUntil(bidReminder().catch(() => {}));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url).catch(() => {}); return; } }
    await self.clients.openWindow(url);
  })());
});
