// PipZen - fonctionne même sans réseau (dernière analyse gardée en mémoire)
const CACHE = 'pipzen-v1';
const FICHIERS = ['./', 'index.html', 'style.css', 'app.js', 'icone.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Réseau d'abord (pour avoir la dernière analyse), mémoire si pas de connexion
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((r) => { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
