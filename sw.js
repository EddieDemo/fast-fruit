// Fast Fruit service worker: NETWORK-FIRST with cache fallback.
// Online play always gets the freshest deploy (no sticky-cache deploy
// pain); the cache exists purely so the game keeps working offline.
const CACHE = 'fast-fruit-v2'; // bumped 2026-08-11: anchor law + damage law + flare stick — force refetch of every script (a stale SW serving old shading.js is the likely cause of the green-bots sighting)

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // never intercept cross-origin (fonts etc.)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })
        .then((hit) => hit || caches.match('./')))
  );
});
