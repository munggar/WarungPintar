// Service worker: menyimpan berkas aplikasi agar bisa dibuka tanpa internet.
// Naikkan VERSI setiap kali berkas aplikasi diubah agar cache diperbarui.
const VERSI = 'warungpintar-v27';
const BERKAS = ['./', './index.html', './css/style.css', './js/app.js', './js/db.js', './js/logic.js', './js/receipt.js',
  './js/seed.js', './js/xlsx.js', './js/config.js', './js/crypto.js', './js/supabase.js', './js/cloud-sync.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => c.addAll(BERKAS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSI).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Jaringan dulu (agar pembaruan cepat terlihat), cache sebagai cadangan saat offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const salin = res.clone();
      caches.open(VERSI).then((c) => c.put(e.request, salin));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
