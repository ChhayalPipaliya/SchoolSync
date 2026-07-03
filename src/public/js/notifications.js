// Real-Time Notifications Handler Client-Side
let notificationSocket = null;
window.getAppSocket = () => notificationSocket;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNotifications);
} else {
    initNotifications();
}

function initNotifications() {
    // 1. Load initial notifications & unread count
    fetchNotifications();
    fetchUnreadCount();

    // 2. Initialize Socket.io connection if library is available
    if (typeof io !== "undefined") {
        initializeSocket();
    } else {
        console.warn("Socket.io client library not loaded. Real-time updates disabled.");
    }

    // 3. Document click listener to close notification dropdown when clicking outside
    document.addEventListener("click", (event) => {
        const dropdown = document.getElementById("notifDropdown");
        const container = document.getElementById("notifBellContainer");
        if (dropdown && container && !container.contains(event.target)) {
            dropdown.classList.add("hidden");
        }
    });
}

function initializeSocket() {
    const token = window.currentUserToken || "";
    notificationSocket = io({
        auth: {
            token: token
        },
        query: {
            token: token
        },
        reconnectionDelayMax: 10000,
        randomizationFactor: 0.5
    });

    notificationSocket.on("connect", () => {
        console.log("[Socket.io] Connected to server successfully.");
    });

    notificationSocket.on("connect_error", (err) => {
        console.error("[Socket.io] Global notification connection error:", err.message);
    });

    notificationSocket.on("new_notification", (notif) => {
        console.log("[Socket.io] Real-time notification received:", notif);
        
        if (notif.reference_type === "chat") {
            // Chat notification: do not add to bell dropdown, do not increment bell badge.
            // Show toast only if NOT on the chat page.
            if (!window.location.pathname.includes("/chat")) {
                showToastNotification(notif);
            }
            return;
        }
        
        // Add to dropdown list
        prependNotificationToDropdown(notif);
        updateBadge(getNotificationBadgeCount() + 1);
        
        // Show toast alert
        showToastNotification(notif);
    });

    notificationSocket.on("unread_count_update", (data) => {
        updateBadge(data.unreadCount);
    });

    notificationSocket.on("chat_message", (msg) => {
        console.log("[Socket.io] Chat message received:", msg);
        
        const currentUserId = window.currentUser ? window.currentUser.id : null;
        
        if (!window.location.pathname.includes("/chat") && Number(msg.sender_id) !== Number(currentUserId)) {
            playBeepAlert();
        }
    });

    notificationSocket.on("chat_unread_notification", () => {
        if (!window.location.pathname.includes("/chat")) {
            incrementMessageBadge();
        }
    });

    notificationSocket.on("chat_unread_count_update", (data) => {
        updateMessageBadge(data.unreadCount);
    });

    notificationSocket.on("disconnect", (reason) => {
        console.log("[Socket.io] Disconnected from server:", reason);
    });
}

// ------------------ DOM RENDERING HELPERS ------------------

function updateBadge(count) {
    const badge = document.getElementById("notifBadge");
    if (!badge) return;

    const safeCount = Math.max(0, Number(count) || 0);
    if (safeCount > 0) {
        badge.innerText = safeCount > 99 ? "99+" : safeCount;
        badge.classList.remove("hidden");
    } else {
        badge.innerText = "0";
        badge.classList.add("hidden");
    }
}

function getNotificationBadgeCount() {
    const badge = document.getElementById("notifBadge");
    if (!badge || badge.classList.contains("hidden")) return 0;
    return parseInt(badge.innerText, 10) || 0;
}

function isEnabledPreference(value) {
    return value === true || value === 1 || value === "1" || value === "true";
}

function updateMessageBadge(count) {
    const badge = document.getElementById("messageBadge");
    if (!badge) return;

    const safeCount = Number(count) || 0;
    badge.innerText = safeCount > 99 ? "99+" : safeCount;
    if (safeCount > 0) {
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

function incrementMessageBadge() {
    const badge = document.getElementById("messageBadge");
    if (!badge) return;

    const current = parseInt(badge.innerText, 10) || 0;
    updateMessageBadge(current + 1);
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

function getRolePathSegment(role) {
    const map = {
        school_admin: "schooladmin",
        super_admin: "superadmin",
        teacher: "teacher",
        student: "student",
        driver: "driver",
        librarian: "librarian",
        parent: "parent"
    };
    return map[role] || String(role || "").replace(/_/g, "");
}

function getCategoryIconClass(category) {
    const map = {
        academic: "fa-graduation-cap icon-homework",
        fee: "fa-indian-rupee-sign icon-fee",
        transport: "fa-bus icon-transport",
        library: "fa-book-open icon-library",
        general: "fa-bullhorn icon-notice",
        system: "fa-sliders icon-system"
    };
    return map[category] || "fa-bell icon-general";
}

function formatTimeAgo(dateString) {
    const now = new Date();
    const past = new Date(dateString);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

function createNotificationHTML(notif) {
    if (!notif || !notif.id) return "";
    const iconClass = getCategoryIconClass(notif.category);
    const isUnread = !notif.is_read ? "unread" : "";
    const href = safeActionUrl(notif.action_url);
    const id = Number(notif.id) || 0;
    const title = escapeHtml(notif.title || "Notification");
    const message = escapeHtml(notif.message || "");
    const category = escapeHtml(notif.category || "general");
    
    return `
        <div class="notif-item-container flex items-center w-full border-b border-slate-100 hover:bg-slate-50 transition-all" id="notif-item-${id}">
            <a href="${href}" onclick="markNotificationRead(${id})" class="notif-item ${isUnread} flex-1 flex gap-3 p-3 text-slate-700 decoration-none">
                <div class="notif-icon-wrapper ${notif.category ? `icon-${category}` : 'icon-general'}">
                    <i class="fa-solid ${iconClass.split(' ')[0]}"></i>
                </div>
                <div class="notif-content flex-1 min-w-0">
                    <h4 class="notif-title text-sm font-semibold">${title}</h4>
                    <p class="notif-desc text-xs text-slate-500 line-clamp-2">${message}</p>
                    <span class="notif-time text-[10px] text-slate-400">${formatTimeAgo(notif.created_at)}</span>
                </div>
            </a>
            <button class="notif-delete-btn mr-3 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" onclick="deleteNotification(event, ${id})" title="Delete notification">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `;
}

function prependNotificationToDropdown(notif) {
    const list = document.getElementById("notifList");
    if (!list) return;

    // Remove empty state if present
    const emptyState = list.querySelector(".notif-empty");
    if (emptyState) {
        list.innerHTML = "";
    }

    const html = createNotificationHTML(notif);
    if (!html) return;
    list.insertAdjacentHTML("afterbegin", html);

    const items = list.querySelectorAll(".notif-item-container");
    items.forEach((item, index) => {
        if (index >= 20) item.remove();
    });
}

function showToastNotification(notif) {
    const container = document.getElementById("notifToastContainer");
    if (!container) return;

    const iconClass = getCategoryIconClass(notif.category);
    const href = safeActionUrl(notif.action_url);
    const isUrgent = notif.type === "emergency" ? "urgent" : "";
    const id = Number(notif.id) || 0;
    const markReadAttr = notif.skip_mark_read ? "" : `onclick="markNotificationRead(${id})"`;
    const title = escapeHtml(notif.title || "Notification");
    const message = escapeHtml(notif.message || "");
    const category = escapeHtml(notif.category || "general");
    
    // Play beep sound for urgent/emergency alerts
    if (notif.type === "emergency") {
        playBeepAlert();
    }

    const toastId = `toast-${Date.now()}`;
    const toastHTML = `
        <div class="notif-toast ${isUrgent} flex gap-3 p-4" id="${toastId}">
            <div class="toast-icon-wrapper ${notif.category ? `icon-${category}` : 'icon-general'}">
                <i class="fa-solid ${iconClass.split(' ')[0]}"></i>
            </div>
            <a href="${href}" ${markReadAttr} class="toast-body flex-1 min-w-0 text-slate-700 decoration-none">
                <h4 class="toast-title text-sm font-bold">${title}</h4>
                <p class="toast-message text-xs text-slate-500 line-clamp-2">${message}</p>
            </a>
            <button class="toast-close-btn text-slate-400 hover:text-slate-700" onclick="closeToast('${toastId}', event)">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `;

    container.insertAdjacentHTML("beforeend", toastHTML);

    // Auto dismiss after 5 seconds
    setTimeout(() => {
        closeToast(toastId);
    }, 5000);
}

function closeToast(id, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const toast = document.getElementById(id);
    if (toast) {
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 250);
    }
}

function playBeepAlert() {
    // Primary: Web Audio API siren (no external file needed, louder, always works)
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0.8, ctx.currentTime);
        gainNode.connect(ctx.destination);
        [880, 660, 880].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.2);
            osc.connect(gainNode);
            osc.start(ctx.currentTime + i * 0.2);
            osc.stop(ctx.currentTime + i * 0.2 + 0.18);
        });
        setTimeout(() => ctx.close(), 800);
        return;
    } catch (e) {}
    // Fallback: external audio file
    try {
        const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-like-beep.wav");
        audio.volume = 0.8;
        audio.play().catch(() => {});
    } catch (e) {}
}

// ------------------ EVENT HANDLERS & ACTIONS ------------------

function toggleNotifDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById("notifDropdown");
    if (dropdown) {
        dropdown.classList.toggle("hidden");
    }
}

async function fetchNotifications() {
    try {
        const res = await fetch("/api/notifications?limit=10");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resData = await res.json();
        
        if (resData.success) {
            const list = document.getElementById("notifList");
            if (!list) return;

            if (resData.data && resData.data.length > 0) {
                list.innerHTML = resData.data.map(n => createNotificationHTML(n)).join("");
            } else {
                list.innerHTML = `
                    <div class="notif-empty">
                        <i class="fa-solid fa-bell-slash"></i>
                        <p>No new notifications</p>
                    </div>
                `;
            }
        }
    } catch (err) {
        console.error("Failed to fetch notifications list:", err);
    }
}

async function fetchUnreadCount() {
    try {
        const res = await fetch("/api/notifications/unread-count");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resData = await res.json();
        if (resData.success) {
            updateBadge(resData.count);
        }
    } catch (err) {
        console.error("Failed to fetch unread notifications count:", err);
    }
}

async function markNotificationRead(id) {
    if (!Number(id)) return;
    try {
        const res = await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resData = await res.json();
        if (resData.success) {
            const item = document.getElementById(`notif-item-${id}`);
            if (item) {
                const notifLink = item.querySelector(".notif-item");
                if (notifLink) notifLink.classList.remove("unread");
            }
            fetchUnreadCount();
        }
    } catch (err) {
        console.error(`Failed to mark notification ${id} read:`, err);
    }
}

async function markAllNotificationsAsRead() {
    try {
        const res = await fetch("/api/notifications/read-all", { method: "PATCH" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resData = await res.json();
        if (resData.success) {
            // Update UI list items to read
            const unreadItems = document.querySelectorAll(".notif-item.unread");
            unreadItems.forEach(item => item.classList.remove("unread"));
            updateBadge(0);
        }
    } catch (err) {
        console.error("Failed to mark all notifications read:", err);
    }
}

async function deleteNotification(event, id) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!Number(id)) return;
    try {
        const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resData = await res.json();
        if (resData.success) {
            const item = document.getElementById(`notif-item-${id}`);
            if (item) {
                item.remove();
            }
            
            // Check if list is empty
            const list = document.getElementById("notifList");
            if (list && list.children.length === 0) {
                list.innerHTML = `
                    <div class="notif-empty">
                        <i class="fa-solid fa-bell-slash"></i>
                        <p>No new notifications</p>
                    </div>
                `;
            }
            fetchUnreadCount();
        }
    } catch (err) {
        console.error(`Failed to delete notification ${id}:`, err);
    }
}

// ------------------ PREFERENCES MODAL & ACTIONS ------------------

function toggleNotifPrefsModal(show) {
    const modal = document.getElementById("notifPrefsModal");
    if (!modal) return;

    if (show) {
        // Load settings and populate form
        loadNotificationPreferences();
        modal.classList.remove("hidden");
    } else {
        modal.classList.add("hidden");
    }
}

async function loadNotificationPreferences() {
    try {
        const res = await fetch("/api/notifications/preferences");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resData = await res.json();
        
        if (resData.success && resData.data) {
            const pref = resData.data;
            document.getElementById("push_notifications").checked = isEnabledPreference(pref.push_notifications);
            document.getElementById("email_notifications").checked = isEnabledPreference(pref.email_notifications);

            // Categories
            const categories = pref.categories_enabled || [];
            const checkBoxes = document.querySelectorAll("#notifPrefsForm input[name='categories_enabled']");
            checkBoxes.forEach(box => {
                box.checked = categories.includes(box.value);
            });
        }
    } catch (err) {
        console.error("Failed to load preferences:", err);
    }
}

async function saveNotificationPreferences(event) {
    event.preventDefault();
    try {
        const push_notifications = document.getElementById("push_notifications").checked;
        const email_notifications = document.getElementById("email_notifications").checked;
        
        const categories_enabled = [];
        const checkBoxes = document.querySelectorAll("#notifPrefsForm input[name='categories_enabled']:checked");
        checkBoxes.forEach(box => {
            categories_enabled.push(box.value);
        });

        const res = await fetch("/api/notifications/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                push_notifications,
                email_notifications,
                categories_enabled
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const resData = await res.json();
        if (resData.success) {
            toggleNotifPrefsModal(false);
            showToastNotification({
                id: 0,
                type: "success",
                category: "system",
                title: "Settings Saved",
                message: "Notification preferences updated successfully.",
                skip_mark_read: true
            });
        } else {
            alert(resData.message || "Failed to save settings.");
        }
    } catch (err) {
        console.error("Failed to save preferences:", err);
        alert("Failed to save settings. Please try again.");
    }
}
