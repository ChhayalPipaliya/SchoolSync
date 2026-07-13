// =====================================================================
//  SchoolSync – Notification System (Client-Side)
//  Handles: Fetch, Badge, Real-time via Socket.io, Toast, Dropdown, Prefs
// =====================================================================

let notificationSocket = null;
window.getAppSocket = () => notificationSocket;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNotifications);
} else {
    initNotifications();
}

function initNotifications() {
    fetchNotifications();
    fetchUnreadCount();

    if (typeof io !== "undefined") {
        initializeSocket();
    }

    // Close dropdown on outside click
    document.addEventListener("click", (event) => {
        const dropdown = document.getElementById("notifDropdown");
        const container = document.getElementById("notifBellContainer");
        if (dropdown && container && !container.contains(event.target)) {
            closeNotifDropdown();
        }
    });
}

// ───────────────────────── SOCKET.IO ─────────────────────────

function initializeSocket() {
    // Socket.IO authenticates via httpOnly cookie — no token needed in JS
    notificationSocket = io({
        withCredentials: true,
        reconnectionDelayMax: 10000,
        randomizationFactor: 0.5
    });

    notificationSocket.on("connect", () => {
        console.log("[Notif] Socket connected.");
    });

    notificationSocket.on("connect_error", (err) => {
        console.error("[Notif] Socket error:", err.message);
    });

    notificationSocket.on("new_notification", (notif) => {
        if (notif.reference_type === "chat") {
            if (!window.location.pathname.includes("/chat")) showToastNotification(notif);
            return;
        }
        prependNotificationToDropdown(notif);
        updateBadge(getNotificationBadgeCount() + 1);
        showToastNotification(notif);
    });

    notificationSocket.on("unread_count_update", (data) => {
        updateBadge(data.unreadCount);
    });

    notificationSocket.on("chat_message", (msg) => {
        const currentUserId = window.currentUser ? window.currentUser.id : null;
        if (!window.location.pathname.includes("/chat") && Number(msg.sender_id) !== Number(currentUserId)) {
            playBeepAlert();
        }
    });

    notificationSocket.on("chat_unread_notification", () => {
        if (!window.location.pathname.includes("/chat")) incrementMessageBadge();
    });

    notificationSocket.on("chat_unread_count_update", (data) => {
        updateMessageBadge(data.unreadCount);
    });

    notificationSocket.on("disconnect", (reason) => {
        console.log("[Notif] Socket disconnected:", reason);
    });
}

// ───────────────────────── BADGE HELPERS ─────────────────────────

function updateBadge(count) {
    const badge = document.getElementById("notifBadge");
    if (!badge) return;
    const n = Math.max(0, Number(count) || 0);
    badge.innerText = n > 99 ? "99+" : n;
    badge.classList.toggle("hidden", n === 0);
}

function getNotificationBadgeCount() {
    const badge = document.getElementById("notifBadge");
    if (!badge || badge.classList.contains("hidden")) return 0;
    return parseInt(badge.innerText, 10) || 0;
}

function updateMessageBadge(count) {
    const badge = document.getElementById("messageBadge");
    if (!badge) return;
    const n = Number(count) || 0;
    badge.innerText = n > 99 ? "99+" : n;
    badge.classList.toggle("hidden", n === 0);
}

function incrementMessageBadge() {
    const badge = document.getElementById("messageBadge");
    if (!badge) return;
    updateMessageBadge((parseInt(badge.innerText, 10) || 0) + 1);
}

function isEnabledPreference(value) {
    return value === true || value === 1 || value === "1" || value === "true";
}

// ───────────────────────── ICON & FORMAT HELPERS ─────────────────────────

const CATEGORY_META = {
    academic:  { icon: "fa-graduation-cap", bg: "#EEF2FF", color: "#4F46E5", label: "Academic" },
    fee:       { icon: "fa-indian-rupee-sign", bg: "#ECFDF5", color: "#10B981", label: "Fee" },
    transport: { icon: "fa-bus", bg: "#FFFBEB", color: "#D97706", label: "Transport" },
    library:   { icon: "fa-book-open", bg: "#FDF2F8", color: "#DB2777", label: "Library" },
    general:   { icon: "fa-bullhorn", bg: "#F0FDF4", color: "#16A34A", label: "General" },
    system:    { icon: "fa-sliders", bg: "#F1F5F9", color: "#475569", label: "System" },
    emergency: { icon: "fa-triangle-exclamation", bg: "#FEF2F2", color: "#DC2626", label: "Emergency" }
};

function getCategoryMeta(category) {
    return CATEGORY_META[category] || { icon: "fa-bell", bg: "#EFF6FF", color: "#2563EB", label: "Notification" };
}

function formatTimeAgo(dateString) {
    if (!dateString) return "";
    const now = new Date();
    const past = new Date(dateString);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return past.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function safeActionUrl(url) {
    if (!url || typeof url !== "string") return "#";
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    return "#";
}

// ───────────────────────── NOTIFICATION ITEM HTML ─────────────────────────

function createNotificationHTML(notif) {
    if (!notif || !notif.id) return "";

    const meta = getCategoryMeta(notif.category);
    const isUnread = !notif.is_read;
    const href = safeActionUrl(notif.action_url);
    const id = Number(notif.id) || 0;
    const title = escapeHtml(notif.title || "Notification");
    const message = escapeHtml(notif.message || "");

    return `
        <div class="notif-item-wrap ${isUnread ? "unread" : ""}" id="notif-item-${id}">
            <a href="${href}" onclick="markNotificationRead(${id})" class="notif-item-link">
                <div class="notif-icon-circle" style="background:${meta.bg}; color:${meta.color};">
                    <i class="fa-solid ${meta.icon}"></i>
                </div>
                <div class="notif-item-body">
                    <p class="notif-item-title">${title}</p>
                    <p class="notif-item-msg">${message}</p>
                    <span class="notif-item-time">
                        <i class="fa-regular fa-clock"></i> ${formatTimeAgo(notif.created_at)}
                    </span>
                </div>
                ${isUnread ? '<span class="notif-unread-dot"></span>' : ''}
            </a>
            <button class="notif-delete-x" onclick="deleteNotification(event, ${id})" title="Dismiss">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;
}

// ───────────────────────── DROPDOWN LOGIC ─────────────────────────

function toggleNotifDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById("notifDropdown");
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains("hidden");
    if (isHidden) {
        openNotifDropdown(dropdown);
    } else {
        closeNotifDropdown();
    }
}

function openNotifDropdown(dropdown) {
    dropdown.classList.remove("hidden");
    dropdown.classList.add("visible");
    // refresh on open
    fetchNotifications();
}

function closeNotifDropdown() {
    const dropdown = document.getElementById("notifDropdown");
    if (!dropdown) return;
    dropdown.classList.add("hidden");
    dropdown.classList.remove("visible");
}

function prependNotificationToDropdown(notif) {
    const list = document.getElementById("notifList");
    if (!list) return;
    const emptyState = list.querySelector(".notif-empty-state");
    if (emptyState) list.innerHTML = "";
    const html = createNotificationHTML(notif);
    if (!html) return;
    list.insertAdjacentHTML("afterbegin", html);
    const items = list.querySelectorAll(".notif-item-wrap");
    items.forEach((item, i) => { if (i >= 20) item.remove(); });
}

// ───────────────────────── TOAST NOTIFICATION ─────────────────────────

function showToastNotification(notif) {
    const container = document.getElementById("notifToastContainer");
    if (!container) return;

    const meta = getCategoryMeta(notif.category);
    const href = safeActionUrl(notif.action_url);
    const id = Number(notif.id) || 0;
    const markReadAttr = notif.skip_mark_read ? "" : `onclick="markNotificationRead(${id})"`;
    const title = escapeHtml(notif.title || "Notification");
    const message = escapeHtml(notif.message || "");
    const isUrgent = notif.category === "emergency" || notif.type === "emergency";

    if (isUrgent) playBeepAlert();

    const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toastHTML = `
        <div class="notif-toast ${isUrgent ? "toast-urgent" : ""}" id="${toastId}" role="alert">
            <div class="toast-icon" style="background:${meta.bg}; color:${meta.color};">
                <i class="fa-solid ${meta.icon}"></i>
            </div>
            <a href="${href}" ${markReadAttr} class="toast-content">
                <p class="toast-title">${title}</p>
                <p class="toast-msg">${message}</p>
            </a>
            <button class="toast-dismiss" onclick="closeToast('${toastId}', event)" aria-label="Dismiss">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="toast-progress" style="animation-duration:5s;"></div>
        </div>
    `;
    container.insertAdjacentHTML("beforeend", toastHTML);
    setTimeout(() => closeToast(toastId), 5200);
}

function closeToast(id, event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const toast = document.getElementById(id);
    if (toast) {
        toast.classList.add("toast-hide");
        setTimeout(() => toast.remove(), 280);
    }
}

function playBeepAlert() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.7, ctx.currentTime);
        gain.connect(ctx.destination);
        [880, 660, 880].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18);
            osc.connect(gain);
            osc.start(ctx.currentTime + i * 0.18);
            osc.stop(ctx.currentTime + i * 0.18 + 0.16);
        });
        setTimeout(() => ctx.close(), 700);
    } catch (e) {
        try {
            const a = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-like-beep.wav");
            a.volume = 0.7;
            a.play().catch(() => {});
        } catch (e2) {}
    }
}

// ───────────────────────── API CALLS ─────────────────────────

async function fetchNotifications() {
    try {
        const res = await fetch("/api/notifications?limit=15");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = document.getElementById("notifList");
        if (!list) return;

        if (data.success && data.data && data.data.length > 0) {
            list.innerHTML = data.data.map(n => createNotificationHTML(n)).join("");
        } else {
            list.innerHTML = `
                <div class="notif-empty-state">
                    <div class="notif-empty-icon"><i class="fa-solid fa-bell-slash"></i></div>
                    <p class="notif-empty-title">You're all caught up!</p>
                    <p class="notif-empty-sub">No notifications right now.</p>
                </div>
            `;
        }
    } catch (err) {
        console.error("[Notif] fetchNotifications failed:", err);
    }
}

async function fetchUnreadCount() {
    try {
        const res = await fetch("/api/notifications/unread-count");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.success) updateBadge(data.count);
    } catch (err) {
        console.error("[Notif] fetchUnreadCount failed:", err);
    }
}

async function markNotificationRead(id) {
    if (!Number(id)) return;
    try {
        const res = await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
            const wrap = document.getElementById(`notif-item-${id}`);
            if (wrap) {
                wrap.classList.remove("unread");
                const dot = wrap.querySelector(".notif-unread-dot");
                if (dot) dot.remove();
            }
            fetchUnreadCount();
        }
    } catch (err) {
        console.error(`[Notif] markNotificationRead(${id}) failed:`, err);
    }
}

async function markAllNotificationsAsRead() {
    try {
        const res = await fetch("/api/notifications/read-all", { method: "PATCH" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
            document.querySelectorAll(".notif-item-wrap.unread").forEach(el => {
                el.classList.remove("unread");
                const dot = el.querySelector(".notif-unread-dot");
                if (dot) dot.remove();
            });
            updateBadge(0);
        }
    } catch (err) {
        console.error("[Notif] markAllNotificationsAsRead failed:", err);
    }
}

async function deleteNotification(event, id) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    if (!Number(id)) return;
    try {
        const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
            const el = document.getElementById(`notif-item-${id}`);
            if (el) {
                el.style.opacity = "0";
                el.style.transform = "translateX(20px)";
                el.style.transition = "all 0.2s ease";
                setTimeout(() => el.remove(), 210);
            }
            const list = document.getElementById("notifList");
            if (list && list.querySelectorAll(".notif-item-wrap").length <= 1) {
                setTimeout(() => {
                    list.innerHTML = `
                        <div class="notif-empty-state">
                            <div class="notif-empty-icon"><i class="fa-solid fa-bell-slash"></i></div>
                            <p class="notif-empty-title">You're all caught up!</p>
                            <p class="notif-empty-sub">No notifications right now.</p>
                        </div>
                    `;
                }, 230);
            }
            fetchUnreadCount();
        }
    } catch (err) {
        console.error(`[Notif] deleteNotification(${id}) failed:`, err);
    }
}

// ───────────────────────── PREFERENCES MODAL ─────────────────────────

function toggleNotifPrefsModal(show) {
    const modal = document.getElementById("notifPrefsModal");
    if (!modal) return;
    if (show) {
        loadNotificationPreferences();
        modal.classList.remove("hidden");
        modal.classList.add("modal-open");
    } else {
        modal.classList.remove("modal-open");
        modal.classList.add("hidden");
    }
}

async function loadNotificationPreferences() {
    try {
        const res = await fetch("/api/notifications/preferences");
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.data) {
            const pref = data.data;
            const pushEl = document.getElementById("push_notifications");
            const emailEl = document.getElementById("email_notifications");
            if (pushEl) pushEl.checked = isEnabledPreference(pref.push_notifications);
            if (emailEl) emailEl.checked = isEnabledPreference(pref.email_notifications);
            const categories = pref.categories_enabled || [];
            document.querySelectorAll("#notifPrefsForm input[name='categories_enabled']").forEach(box => {
                box.checked = categories.includes(box.value);
            });
        }
    } catch (err) {
        console.error("[Notif] loadNotificationPreferences failed:", err);
    }
}

async function saveNotificationPreferences(event) {
    event.preventDefault();
    try {
        const pushEl = document.getElementById("push_notifications");
        const emailEl = document.getElementById("email_notifications");
        const push_notifications = pushEl ? pushEl.checked : true;
        const email_notifications = emailEl ? emailEl.checked : true;
        const categories_enabled = [];
        document.querySelectorAll("#notifPrefsForm input[name='categories_enabled']:checked").forEach(box => {
            categories_enabled.push(box.value);
        });

        const res = await fetch("/api/notifications/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ push_notifications, email_notifications, categories_enabled })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.success) {
            toggleNotifPrefsModal(false);
            showToastNotification({
                id: 0,
                category: "system",
                title: "Preferences Saved",
                message: "Your notification settings have been updated.",
                skip_mark_read: true,
                created_at: new Date().toISOString()
            });
        } else {
            alert(data.message || "Failed to save settings.");
        }
    } catch (err) {
        console.error("[Notif] saveNotificationPreferences failed:", err);
        alert("Failed to save settings. Please try again.");
    }
}
