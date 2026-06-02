// 1. LIFECYCLE HANDLERS
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 2. CONSOLIDATED FETCH HANDLER (One single, robust listener)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A. EXCLUSIONS: Bypass Service Worker for these
  if (
    url.pathname.startsWith('/api/') || 
    event.request.destination === 'audio' || 
    url.pathname.endsWith('.mp3') || 
    url.pathname.endsWith('.wav') ||
    event.request.headers.get('range') ||
    url.origin !== self.location.origin
  ) {
    return; // Request proceeds directly to the network without intervention
  }

  // B. CACHING: Handle static assets with error safety
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response if found, otherwise fetch from network
      return cachedResponse || fetch(event.request).catch((err) => {
        console.error('Fetch failed for:', event.request.url, err);
        throw err; // Re-throw to inform the browser the fetch failed
      });
    })
  );
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

// 4. NOTIFICATION CLICK HANDLER
self.addEventListener('notificationclick', function(event) {
  event.notification.close(); 

  if (event.action === 'decline') return; 

  const targetPath = event.notification.data.url || '/dashboard';
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('/dashboard')) {
          client.focus();
          return client.postMessage({ type: 'NAVIGATE', url: targetUrl });
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});