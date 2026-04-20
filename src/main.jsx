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
      // Ensure the backend sends the specific chat URL
      url: data.data?.url || data.url || '/' 
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close(); // Close the notification banner

  const targetUrl = event.notification.data.url;

  event.waitUntil(
    // 1. Look for all open windows (tabs) of your app
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 2. Check if the app is already open in a tab
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        // 3. If the tab is open and has the "navigate" capability
        if (client.url.includes(new URL(targetUrl, self.location.origin).origin) && 'navigate' in client) {
          // Focus the existing tab and navigate it to the chat
          return client.focus().then(() => client.navigate(targetUrl));
        }
      }
      // 4. If no tab was open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});