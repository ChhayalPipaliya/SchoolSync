(function () {
    const configScript = document.getElementById("file-upload-config") || document.querySelector("script[data-file-upload-enabled]");
    if (configScript) {
        const val = configScript.getAttribute("data-file-upload-enabled") || configScript.dataset?.fileUploadEnabled;
        if (typeof val !== "undefined" && val !== null) {
            const norm = String(val).trim().toLowerCase();
            window.FILE_UPLOAD_ENABLED = norm !== "false" && norm !== "0" && norm !== "no" && norm !== "off";
        }
    }

    if (typeof window.FILE_UPLOAD_ENABLED === "undefined") {
        window.FILE_UPLOAD_ENABLED = true;
    }

    if (window.FILE_UPLOAD_ENABLED) {
        const existingStyles = document.getElementById("file-upload-disabled-styles");
        if (existingStyles) existingStyles.remove();
        document.querySelectorAll(".upload-disabled-badge").forEach(b => b.remove());
        document.querySelectorAll(".upload-disabled").forEach(el => {
            el.classList.remove("upload-disabled");
            el.removeAttribute("data-upload-disabled");
            if (el.tagName === "INPUT" || el.tagName === "BUTTON") {
                el.disabled = false;
                el.removeAttribute("aria-disabled");
            }
        });
        return;
    }

    const style = document.createElement("style");
    style.id = "file-upload-disabled-styles";
    style.textContent = `
        .upload-disabled,
        .upload-disabled-box,
        [data-upload-disabled="true"] {
            opacity: 0.55 !important;
            pointer-events: none !important;
            cursor: not-allowed !important;
            filter: grayscale(80%) !important;
        }
        .upload-disabled-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            font-weight: 700;
            color: #b91c1c;
            background: #fef2f2;
            border: 1px solid #fecaca;
            padding: 4px 10px;
            border-radius: 6px;
            margin-top: 6px;
        }
    `;
    document.head.appendChild(style);

    function disableUploadElements() {
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach((input) => {
            input.disabled = true;
            input.setAttribute("aria-disabled", "true");
            input.title = "File uploads are currently disabled.";

            const wrapper = input.closest(".file-upload-box, .dropzone, .dropzone-container, #dropzone, #dropZone, #dropZoneMore, .file-input-wrapper, .file-upload-wrapper");
            if (wrapper && !wrapper.getAttribute("data-upload-disabled")) {
                wrapper.setAttribute("data-upload-disabled", "true");
                wrapper.classList.add("upload-disabled");

                if (!wrapper.parentElement?.querySelector(".upload-disabled-badge")) {
                    const badge = document.createElement("div");
                    badge.className = "upload-disabled-badge";
                    badge.innerHTML = '<i class="fas fa-ban"></i> File uploads are currently disabled';
                    wrapper.parentElement?.appendChild(badge);
                }
            }

            const relatedButtons = document.querySelectorAll(
                `button[onclick*="'${input.id}'"], button[onclick*='"${input.id}"'], label[for="${input.id}"]`
            );
            relatedButtons.forEach((btn) => {
                btn.classList.add("upload-disabled");
                btn.setAttribute("disabled", "true");
                btn.title = "File uploads are currently disabled.";
            });

            const parentForm = input.closest("form");
            if (parentForm) {
                const textInputs = parentForm.querySelectorAll('input:not([type="file"]):not([type="hidden"]), select, textarea');
                if (textInputs.length === 0) {
                    const submitBtn = parentForm.querySelector('button[type="submit"], input[type="submit"]');
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.title = "File uploads are currently disabled.";
                    }
                } else {
                    parentForm.enctype = "application/x-www-form-urlencoded";
                }
            }
        });

        const uploadOnlyButtons = document.querySelectorAll(
            "#uploadMoreBtn, #startUploadBtn, #bulkImportSubmitBtn"
        );
        uploadOnlyButtons.forEach((btn) => {
            btn.disabled = true;
            btn.classList.add("upload-disabled");
            btn.title = "File uploads are currently disabled.";
        });

        const dropzones = document.querySelectorAll("#dropzone, #dropZone, #dropZoneMore, .dropzone-container");
        dropzones.forEach((zone) => {
            zone.classList.add("upload-disabled");
            zone.setAttribute("data-upload-disabled", "true");
            const preventHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            zone.addEventListener("dragenter", preventHandler, true);
            zone.addEventListener("dragover", preventHandler, true);
            zone.addEventListener("drop", (e) => {
                preventHandler(e);
                if (typeof window.showToast === "function") {
                    window.showToast("File uploads are currently disabled.", "error");
                } else {
                    alert("File uploads are currently disabled.");
                }
            }, true);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", disableUploadElements);
    } else {
        disableUploadElements();
    }

    const observer = new MutationObserver(() => {
        disableUploadElements();
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });
})();
