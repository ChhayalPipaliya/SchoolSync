const CACHE_NAME = 'schoolsync-static-v1';
const OFFLINE_URL = '/offline.html';

const PRECACHE_ASSETS = [
    OFFLINE_URL,
    '/manifest.json',
    '/css/common.css',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-192-maskable.png',
    '/icons/icon-512-maskable.png',
    '/images/favicon.ico'
];

const STRICT_NETWORK_PATTERNS = [
    /^\/api\//i,
    /^\/auth\//i,
    /^\/login/i,
    /^\/logout/i,
    /^\/gps/i,
    /^\/socket\.io/i,
    /^\/webhooks\//i,
    /^\/theme\/toggle/i,
    /^\/meeting/i,
    /^\/admission\//i,
    /^\/superadmin/i,
    /^\/groupadmin/i,
    /^\/schooladmin/i,
    /^\/teacher/i,
    /^\/student/i,
    /^\/parent/i,
    /^\/driver/i,
    /^\/librarian/i,
    /^\/uploads\//i
];

function isStrictNetworkRoute(url) {
    const pathname = url.pathname;
    return STRICT_NETWORK_PATTERNS.some((pattern) => pattern.test(pathname));
};

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        })
        .then(() => {
            return self.skipWaiting();
        })
        .catch((err) => {
            console.warn('[SchoolSync SW] Precache warning:', err);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
        .then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName.startsWith('schoolsync-') && cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    };
                })
            );
        })
        .then(() => {
            return self.clients.claim();
        })
    );
});

function isStaticAsset(url) {
    const pathname = url.pathname;
    return (
        pathname.startsWith('/css/') ||
        pathname.startsWith('/images/') ||
        pathname.startsWith('/icons/') ||
        pathname.startsWith('/illustrations/') ||
        (pathname.startsWith('/js/') && !pathname.includes('driver-sw')) ||
        pathname.match(/\.(css|js|png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|eot)$/i)
    );
};

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') {
        return;
    };

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        if (
            url.hostname.includes('fonts.googleapis.com') ||
            url.hostname.includes('fonts.gstatic.com') ||
            url.hostname.includes('cdnjs.cloudflare.com')
        ) {
            event.respondWith(
                fetch(request).catch(() => caches.match(request))
            );
        };
        return;
    };

    if (isStrictNetworkRoute(url)) {
        return;
    };

    if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
        event.respondWith(
            fetch(request)
            .catch(() => {
                return caches.match(OFFLINE_URL);
            })
        );
        return;
    };

    if (isStaticAsset(url)) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                const fetchPromise = fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    };
                    return networkResponse;
                })
                .catch(() => cachedResponse);
                return cachedResponse || fetchPromise;
            })
        );
        return;
    };
    
    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});

self.addEventListener('push', (event) => {
    let data = {
        title: 'SchoolSync Notification',
        message: 'You have a new update from SchoolSync',
        link: '/',
        priority: 'medium'
    };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.message = event.data.text();
        };
    };

    const options = {
        body: data.message || data.body || 'New notification received',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: data.priority === 'high' ? [300, 100, 300, 100, 300] : [200, 100, 200],
        data: { url: data.link || '/' },
        actions: [
            { action: 'open', title: 'Open' },
            { action: 'close', title: 'Dismiss' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'SchoolSync Alert', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'close') return;

    const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if ('focus' in client && client.url.includes(self.location.origin)) {
                    client.navigate(targetUrl);
                    return client.focus();
                };
            };
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            };
        })
    );
});