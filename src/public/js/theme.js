(function () {
    const THEME_KEY = 'schoolSyncTheme';
    const THEME_LIGHT = 'light';
    const THEME_DARK = 'dark';

    function getCookieTheme() {
        try {
            const match = document.cookie.match(/(?:^|;\s*)theme=([^;]*)/);
            if (match && (match[1] === THEME_DARK || match[1] === THEME_LIGHT)) {
                return match[1];
            };
        } catch (e) {}
        return null;
    };

    function getStoredTheme() {
        try {
            const local = localStorage.getItem(THEME_KEY);
            if (local === THEME_DARK || local === THEME_LIGHT) return local;
            const cookieVal = getCookieTheme();
            if (cookieVal) return cookieVal;
            const attr = document.documentElement.getAttribute('data-theme');
            if (attr === THEME_DARK || attr === THEME_LIGHT) return attr;
            return THEME_LIGHT;
        } catch (e) {
            return THEME_LIGHT;
        };
    };

    function applyTheme(theme, notify = true) {
        const isDark = theme === THEME_DARK;
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.classList.toggle('light-mode-disabled', isDark);

        updateToggleButtons(theme);

        if (notify) {
            try {
                window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme, isDark } }));
            } catch (e) { }
        };
    };

    function syncBackendTheme(theme) {
        try {
            const secureFlag = window.location.protocol === 'https:' ? '; Secure' : '';
            document.cookie = `theme=${theme}; path=/; max-age=31536000; SameSite=Lax${secureFlag}`;

            const csrfMeta = document.querySelector('meta[name="csrf-token"]');
            const headers = { 'Content-Type': 'application/json' };
            if (csrfMeta && csrfMeta.content) {
                headers['X-CSRF-Token'] = csrfMeta.content;
            };

            fetch('/theme/toggle', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ theme: theme }),
                credentials: 'same-origin'
            }).catch(function() { });
        } catch (e) {}
    };

    function setTheme(theme) {
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (e) {}

        const applyAndSync = () => {
            applyTheme(theme, true);
            syncBackendTheme(theme);
        };

        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (!reduceMotion && document.startViewTransition) {
            document.startViewTransition(applyAndSync);
        } else {
            applyAndSync();
        };
    };

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || getStoredTheme();
        const nextTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
        setTheme(nextTheme);
        return nextTheme;
    };

    function updateToggleButtons(theme) {
        const isDark = theme === THEME_DARK;
        const buttons = document.querySelectorAll('.theme-toggle-btn, [data-action="toggle-theme"], #themeToggleBtn, #themeToggle, .landing-theme-toggle');
        buttons.forEach((btn) => {
            btn.setAttribute('aria-pressed', String(isDark));
            btn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
            btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');

            const icon = btn.querySelector('i, svg');
            if (icon && icon.tagName.toLowerCase() === 'i') {
                if (isDark) {
                    icon.className = 'fa-solid fa-sun';
                } else {
                    icon.className = 'fa-solid fa-moon';
                };
            };
        });
    };

    window.ThemeManager = {
        getTheme: getStoredTheme,
        setTheme: setTheme,
        toggle: toggleTheme,
        isDark: () => (document.documentElement.getAttribute('data-theme') || getStoredTheme()) === THEME_DARK,
    };
    window.toggleTheme = toggleTheme;

    const initialTheme = getStoredTheme();
    applyTheme(initialTheme, false);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            updateToggleButtons(getStoredTheme());
        });
    } else {
        updateToggleButtons(initialTheme);
    };
})();