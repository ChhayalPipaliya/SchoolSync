self.addEventListener('push', function(event) {
  let data = {
    title: 'SchoolSync Driver Alert',
    message: 'You have a new update from SchoolSync',
    link: '/driver/dashboard',
    priority: 'medium'
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.message = event.data.text();
    }
  }

  const options = {
    body: data.message || data.body || 'New notification received',
    icon: '/images/bus-icon.png',
    badge: '/images/notification-badge.png',
    vibrate: data.priority === 'high' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: { url: data.link || '/driver/dashboard' },
    actions: [
      { action: 'open', title: 'View (જુઓ)' },
      { action: 'close', title: 'Dismiss (બંધ કરો)' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Driver Notification', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'close') return;

  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/driver/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if (client.url.includes('/driver') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
