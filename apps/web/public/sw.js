// Service Worker для Web Push уведомлений + офлайн app-shell

// --- App-shell кэш (офлайн-фолбэк) ---
// Версионируем имя кэша, чтобы при обновлении SW старый кэш чистился.
const CACHE = 'ochoba-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)),
  );
  // Активируем новый SW сразу, не дожидаясь закрытия вкладок.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Перехватываем ТОЛЬКО навигационные запросы (переходы между страницами).
  // API, _next/static, кросс-ориджин и не-GET запросы НЕ трогаем —
  // это критично для аутентификации, чанков и push.
  if (event.request.mode !== 'navigate') return;

  // Network-first: при ошибке сети показываем офлайн-страницу.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL)),
  );
});

// --- Web Push (НЕ ИЗМЕНЯТЬ логику) ---

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: event.data.text() };
    }
  }

  const title = data.title || 'Уведомление';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: { url: data.url || '/dashboard' },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
