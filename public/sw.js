// Offline-Unterstützung: erst frisch aus dem Netz, im Funkloch aus dem Cache.
// /api/ wird nie zwischengespeichert (den letzten Reisestand hält die App selbst im localStorage).
const CACHE = 'reisebande-v8';
const SHELL = ['/', '/index.html', '/style.css', '/js/app.js', '/js/api.js', '/js/state.js', '/js/ui.js', '/js/components.js', '/js/views.js', '/js/sheets.js', '/js/map.js', '/js/themes.js', '/js/push.js', '/js/plan.js', '/js/story.js', '/js/swipe.js', '/js/images.js', '/js/illus.js', '/js/search.js', '/js/tour.js', '/js/transit/index.js', '/js/transit/router.js', '/js/transit/nyc.js', '/js/frame.js', '/js/weather.js', '/fonts/bricolage.woff2', '/js/mapstyle.js', '/vendor/maplibre/maplibre-gl-csp.js', '/vendor/maplibre/maplibre-gl-csp-worker.js', '/vendor/maplibre/maplibre-gl.css'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && !k.startsWith('tiles')) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Kartenkacheln: aus dem Cache, wenn vorhanden (offline unterwegs)
  if (url.hostname === 'tiles.openfreemap.org') {
    e.respondWith((async () => {
      const cache = await caches.open('tiles-v1');
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; } catch { return Response.error(); }
    })());
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? (await cache.match('/')) || (await cache.match('/index.html')) : Response.error());
    }
  })());
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Reisebande', {
    body: data.body || '',
    tag: data.tag || 'reisebande',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) { all[0].focus(); return all[0].navigate ? all[0].navigate(new URL(target, self.location.origin)).catch(() => {}) : null; }
    return self.clients.openWindow(target);
  })());
});
