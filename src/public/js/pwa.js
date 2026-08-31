(function () {
    'use strict';
    if (window.__schoolSyncPWAInitialized) return;
    window.__schoolSyncPWAInitialized = true;
    
    let deferredPrompt = null;
    
    if ('serviceWorker' in navigator) {
        const isLocalhost = Boolean(
            window.location.hostname === 'localhost' ||
            window.location.hostname === '[::1]' ||
            window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
        );

        if (window.location.protocol === 'https:' || isLocalhost) {
            window.addEventListener('load', function () {
                navigator.serviceWorker
                    .register('/sw.js', { scope: '/' })
                    .then(function (registration) {
                        registration.onupdatefound = function () {
                            const installingWorker = registration.installing;
                            if (installingWorker) {
                            installingWorker.onstatechange = function () {
                                if (installingWorker.state === 'installed') {
                                    if (navigator.serviceWorker.controller) {
                                        console.log('[SchoolSync PWA] New content is available; please refresh.');
                                    } else {
                                        console.log('[SchoolSync PWA] Content cached for offline use.');
                                    };
                                };
                            };
                        };
                    };
                })
                .catch(function (error) {
                    console.warn('[SchoolSync PWA] Service Worker registration failed:', error.message || error);
                });
            });
        };
    };

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        window.deferredSchoolSyncPrompt = e;
        window.dispatchEvent(new CustomEvent('schoolsync-pwa-installable', { detail: { prompt: e } }));
    });
    
    window.promptSchoolSyncInstall = function () {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (choiceResult) {
                if (choiceResult.outcome === 'accepted') {
                    console.log('[SchoolSync PWA] User accepted the install prompt');
                } else {
                    console.log('[SchoolSync PWA] User dismissed the install prompt');
                }
                deferredPrompt = null;
                window.deferredSchoolSyncPrompt = null;
            });
        }
    };

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        window.deferredSchoolSyncPrompt = null;
    });
})();
