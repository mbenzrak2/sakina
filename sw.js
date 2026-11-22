// Sakina service worker — precaches the whole app so it runs with no connection at all.
// Bump VERSION whenever any file below changes: clients then pick up the new files.
const VERSION = 'sakina-v1.1.0';

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
  'js/views/home.js',
  'js/views/adhkar.js',
  'js/views/quran.js',
  'js/views/checklist.js',
  'js/views/history.js',
  'js/views/counter.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
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
