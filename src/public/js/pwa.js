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
                                            window.dispatchEvent(new CustomEvent('schoolsync-pwa-updated', { detail: { registration } }));
                                        } else {
                                            window.dispatchEvent(new CustomEvent('schoolsync-pwa-cached'));
                                        }
                                    }
                                };
                            }
                        };
                    })
                    .catch(function () { });
            });
        }
    }

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        window.deferredSchoolSyncPrompt = e;
        window.dispatchEvent(new CustomEvent('schoolsync-pwa-installable', { detail: { prompt: e } }));
    });

    window.promptSchoolSyncInstall = function () {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            return deferredPrompt.userChoice.then(function (choiceResult) {
                deferredPrompt = null;
                window.deferredSchoolSyncPrompt = null;
                return choiceResult;
            });
        }
        return Promise.resolve(null);
    };

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        window.deferredSchoolSyncPrompt = null;
        window.dispatchEvent(new CustomEvent('schoolsync-pwa-installed'));
    });
})();