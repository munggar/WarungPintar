// Service worker: menyimpan berkas aplikasi agar bisa dibuka tanpa internet.
// Naikkan VERSI setiap kali berkas aplikasi diubah agar cache diperbarui.
const VERSI = 'warungpintar-v37';
const BERKAS = ['./', './index.html', './css/style.css', './js/app.js', './js/db.js', './js/logic.js', './js/receipt.js',
  './js/xlsx.js', './js/config.js', './js/crypto.js', './js/supabase.js', './js/cloud-sync.js',
  './manifest.webmanifest', './icons/app-icon.svg', './icons/icon-128.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/splash-1125x2436.png', './icons/splash-1170x2532.png', './icons/splash-2048x2732.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSI).then((cache) => Promise.all(BERKAS.map(async (file) => {
    const response = await fetch(new Request(file, { cache: 'reload' }));
    if (!response.ok) throw new Error(`Gagal memperbarui cache aplikasi: ${file} (${response.status}).`);
    await cache.put(file, response);
  }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((key) => key.startsWith('warungpintar-') && key !== VERSI)
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});
// Jaringan dulu (agar pembaruan cepat terlihat), cache sebagai cadangan saat offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then((res) => {
      const salin = res.clone();
      caches.open(VERSI).then((c) => c.put(e.request, salin));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
