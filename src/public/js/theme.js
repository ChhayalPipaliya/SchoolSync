(function () {
    const THEME_KEY = 'schoolSyncTheme';
    const THEME_LIGHT = 'light';
    const THEME_DARK = 'dark';

    function getStoredTheme() {
        try {
            return localStorage.getItem(THEME_KEY) || THEME_LIGHT;
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

    function setTheme(theme) {
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (e) { }
        applyTheme(theme, true);
    };

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || getStoredTheme();
        const nextTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
        setTheme(nextTheme);
        return nextTheme;
    };

    function updateToggleButtons(theme) {
        const isDark = theme === THEME_DARK;
        const buttons = document.querySelectorAll('.theme-toggle-btn, [data-action="toggle-theme"], #themeToggleBtn');
        buttons.forEach((btn) => {
            btn.setAttribute('aria-pressed', String(isDark));
            btn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
            btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');

            const icon = btn.querySelector('i, svg');
            if (icon && icon.tagName.toLowerCase() === 'i') {
                if (isDark) {
                    icon.className = 'fas fa-sun';
                } else {
                    icon.className = 'fas fa-moon';
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