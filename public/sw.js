// public/sw.js

self.addEventListener('push', function(event) {
  if (!event.data) return;
  
  let data;
  try {
    data = event.data.json();
  } catch (e) {
    // Fallback if data isn't valid JSON
    data = { title: 'New Message', body: event.data.text() };
  }
  
  // Use absolute URL for the logo to ensure it displays correctly
  const iconUrl = new URL('/logo.png', self.location.origin).href;

  const options = {
    body: data.body || 'You have a new message.',
    icon: iconUrl,       // Main brand logo
    badge: iconUrl,      // Small icon for the status bar (Android)
    vibrate: [100, 50, 100],
    tag: 'zing-notification', // Groups multiple messages into one banner
    data: {
      // Fallback to root if no URL is provided
      url: data.data?.url || data.url || '/' 
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ZingConnect', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close(); // Close the notification popup

  // Get the target URL and ensure it's a full absolute path
  const targetPath = event.notification.data.url || '/';
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 1. Check if the dashboard is already open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        
        // If the user is already on a dashboard page, just focus and navigate
        if (client.url.includes('/dashboard') && 'navigate' in client) {
          return client.focus().then(() => client.navigate(targetUrl));
        }
      }

      // 2. If no matching tab is open, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});