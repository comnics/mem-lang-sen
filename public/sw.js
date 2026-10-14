const CACHE_NAME = 'mem-lang-sen-public-v1';
const PUBLIC_ASSETS = [
  '/offline.html',
  '/icons/icon.svg',
  '/icons/maskable.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PUBLIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/') || url.pathname.includes('.rsc') || url.pathname.match(/\.(mp3|wav|m4a|ogg)$/i)) return;

  if (PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(request)));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
  }
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = typeof data.title === 'string' ? data.title : '문장정원';
  const options = {
    body: typeof data.body === 'string' ? data.body : '오늘 학습을 확인하세요.',
    tag: typeof data.tag === 'string' ? data.tag : 'study-reminder',
    data: { url: typeof data.url === 'string' ? data.url : '/today' },
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/today', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url === target && 'focus' in client);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});
