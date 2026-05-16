const CACHE = 'neomail-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/mail.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  // Network-first for API calls
  if (request.url.includes('googleapis.com') || request.url.includes('accounts.google.com')) {
    e.respondWith(fetch(request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }
  // Cache-first for assets
  e.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(resp => {
      if (resp.ok && request.method === 'GET') {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
      }
      return resp;
    }))
  );
});
