// public/sw.js
self.addEventListener('push', function(event) {
  const data = event.data.json();
  
  const options = {
    body: data.body,
    icon: '/favicon.ico',
    badge: '/favicon.ico', // Small icon shown in Android status bar
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/' 
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Open the app when the notification is clicked
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});