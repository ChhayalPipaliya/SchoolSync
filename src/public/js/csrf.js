(function () {
    const TOKEN_META = 'meta[name="csrf-token"]';
    const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

    function csrfToken() {
        const meta = document.querySelector(TOKEN_META);
        return meta && meta.content ? meta.content : "";
    }

    function isSameOrigin(input) {
        try {
            const url = typeof input === "string" ? input : input && input.url;
            if (!url) return true;
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch (_) {
            return true;
        }
    }

    function ensureFormToken(form) {
        if (!form || String(form.method || "GET").toUpperCase() === "GET") return;
        if (form.querySelector('input[name="_csrf"]')) return;
        const token = csrfToken();
        if (!token) return;

        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "_csrf";
        input.value = token;
        form.appendChild(input);
    }

    function patchForms() {
        document.querySelectorAll("form").forEach(ensureFormToken);
        document.addEventListener("submit", function (event) {
            ensureFormToken(event.target);
        }, true);
    }

    function patchFetch() {
        if (!window.fetch || window.fetch.__schoolsyncCsrfPatched) return;
        const originalFetch = window.fetch;
        const patchedFetch = function (input, init) {
            const requestMethod = input && input.method ? input.method : null;
            const method = String((init && init.method) || requestMethod || "GET").toUpperCase();
            const token = csrfToken();

            if (token && !SAFE_METHODS.has(method) && isSameOrigin(input)) {
                init = init || {};
                init.headers = new Headers(init.headers || (input && input.headers) || {});
                init.headers.set("X-CSRF-Token", token);
            }

            return originalFetch.call(this, input, init);
        };
        patchedFetch.__schoolsyncCsrfPatched = true;
        window.fetch = patchedFetch;
    }

    function patchXhr() {
        if (!window.XMLHttpRequest || window.XMLHttpRequest.prototype.__schoolsyncCsrfPatched) return;
        const proto = window.XMLHttpRequest.prototype;
        const originalOpen = proto.open;
        const originalSend = proto.send;

        proto.open = function (method, url) {
            this.__schoolsyncCsrfMethod = String(method || "GET").toUpperCase();
            this.__schoolsyncCsrfSameOrigin = isSameOrigin(url);
            return originalOpen.apply(this, arguments);
        };

        proto.send = function () {
            const token = csrfToken();
            if (token && this.__schoolsyncCsrfSameOrigin && !SAFE_METHODS.has(this.__schoolsyncCsrfMethod)) {
                this.setRequestHeader("X-CSRF-Token", token);
            }
            return originalSend.apply(this, arguments);
        };

        proto.__schoolsyncCsrfPatched = true;
    }

    patchFetch();
    patchXhr();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", patchForms);
    } else {
        patchForms();
    }
})();
