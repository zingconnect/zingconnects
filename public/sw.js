// 1. LIFECYCLE
self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

// 2. FETCH HANDLER: Focused only on bypassing, not caching
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ALWAYS bypass for APIs and Audio
  if (url.pathname.startsWith('/api/') || event.request.destination === 'audio' || event.request.headers.get('range')) {
    return; 
  }
});

// 3. PUSH NOTIFICATION: Error-proofed
self.addEventListener('push', function(event) {
  let data = { title: 'ZingConnect', body: 'You have a new message' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const iconUrl = '/logo-s.png'; // Ensure this exists at your root

  const options = {
    body: data.body,
    icon: iconUrl,
    badge: iconUrl,
    vibrate: [200, 100, 200],
    data: { url: data.data?.url || data.url || '/dashboard' }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 4. CLICK HANDLER: Standardized
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});