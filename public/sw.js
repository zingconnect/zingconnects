// public/sw.js
self.addEventListener('push', function(event) {
  if (!event.data) return;
  const data = event.data.json();
  
  const options = {
    body: data.body,
    icon: '/favicon.png', 
    badge: '/favicon.png', 
    vibrate: [100, 50, 100],
    data: {
      url: data.data?.url || data.url || '/' 
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  // The specific chat URL sent from the backend (e.g., /agent/dashboard?userId=123)
  const targetUrl = new URL(event.notification.data.url, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 1. Check if the app is already open in any tab
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        
        // 2. If it's open, focus it and tell it to go to the chat URL
        if (client.url.includes('/dashboard') && 'navigate' in client) {
          return client.focus().then(() => client.navigate(targetUrl));
        }
      }

      // 3. If no dashboard tab is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});