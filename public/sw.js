self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

if (event.request.mode === 'navigate') {
  event.respondWith(
    fetch(event.request) // Always hit the network for navigation
      .catch(() => caches.match('/')) // Fallback to index if truly offline
  );
  return;
}
  if (
    event.request.destination === 'audio' || 
    url.pathname.endsWith('.mp3') || 
    url.pathname.endsWith('.wav') ||
    event.request.headers.get('range')
  ) {
    return; // Let browser handle via network
  }
  
});
// 2. LIFECYCLE HANDLERS (Ensures quick updates)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 3. PUSH NOTIFICATION LOGIC
self.addEventListener('push', function(event) {
  if (!event.data) return;
  
  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'ZingConnect', body: event.data.text() };
  }
  
  const iconUrl = '/logo-s.png'; 
  const isCall = data.type === 'CALL_INVITE' || data.title?.toLowerCase().includes('call');

 const options = {
  body: data.body || 'New Notification',
  icon: iconUrl,
  badge: iconUrl,
  vibrate: isCall ? [500, 200, 500, 200, 500] : [200, 100, 200],
  requireInteraction: isCall,
  tag: isCall ? 'incoming-call' : 'new-msg',
  renotify: true,
  // ADDED: Helps OS decide whether to show a heads-up banner
  priority: 'high', 
  data: {
    url: data.data?.url || data.url || '/dashboard',
    type: data.type || 'message'
  },
  actions: isCall ? [
    { action: 'answer', title: '✅ Answer' },
    { action: 'decline', title: '❌ Decline' }
  ] : []
};
  event.waitUntil(
    self.registration.showNotification(data.title || 'ZingConnect', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close(); 

  const targetPath = event.notification.data.url || '/dashboard';
  const targetUrl = new URL(targetPath, self.location.origin).href;

  if (event.action === 'decline') {
    return; 
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('/dashboard')) {
          return client.focus().then(() => {
            return client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          });
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});