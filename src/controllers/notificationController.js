const NotificationModel = require("../models/notificationModel");
const NotificationPreferenceModel = require("../models/notificationPreferenceModel");
const NotificationService = require("../services/notificationService");
const { getIO } = require("../config/socket");

const clampInt = (value, fallback, min, max) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

const parseId = (value) => {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const emitUnreadCount = async (user) => {
    try {
        const unreadCount = await NotificationModel.getUnreadCount(user.id, user.role);
        getIO().to(`user:${user.id}`).emit("unread_count_update", { unreadCount });
    } catch (err) {
        // Socket may not be initialized in tests or CLI flows; API response should still succeed.
    }
};

const notificationController = {
    getNotifications: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const limit = clampInt(req.query.limit, 20, 1, 50);
            const page = clampInt(req.query.page, 1, 1, 100000);
            const offset = (page - 1) * limit;

            const notifications = await NotificationModel.getByUser(user.id, user.role, limit, offset);
            return res.json({
                success: true,
                data: notifications,
                pagination: {
                    page,
                    limit
                }
            });
        } catch (err) {
            console.error("Get notifications error:", err);
            return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
        }
    },

    getUnreadCount: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const count = await NotificationModel.getUnreadCount(user.id, user.role);
            return res.json({ success: true, count });
        } catch (err) {
            console.error("Get unread count error:", err);
            return res.status(500).json({ success: false, message: "Failed to get unread count" });
        }
    },

    markRead: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const id = parseId(req.params.id);
            if (!id) {
                return res.status(400).json({ success: false, message: "Invalid notification id" });
            }
            const success = await NotificationModel.markAsRead(id, user.id, user.role);
            if (!success) {
                return res.status(404).json({ success: false, message: "Notification not found or access denied" });
            }

            await emitUnreadCount(user);
            return res.json({ success: true, message: "Notification marked as read" });
        } catch (err) {
            console.error("Mark read error:", err);
            return res.status(500).json({ success: false, message: "Failed to mark read" });
        }
    },

    markAllRead: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const count = await NotificationModel.markAllAsRead(user.id, user.role);
            await emitUnreadCount(user);
            return res.json({ success: true, message: `Marked ${count} notifications as read` });
        } catch (err) {
            console.error("Mark all read error:", err);
            return res.status(500).json({ success: false, message: "Failed to mark all read" });
        }
    },

    deleteNotification: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const id = parseId(req.params.id);
            if (!id) {
                return res.status(400).json({ success: false, message: "Invalid notification id" });
            }
            const success = await NotificationModel.delete(id, user.id, user.role);
            if (!success) {
                return res.status(404).json({ success: false, message: "Notification not found or access denied" });
            }

            await emitUnreadCount(user);
            return res.json({ success: true, message: "Notification deleted" });
        } catch (err) {
            console.error("Delete notification error:", err);
            return res.status(500).json({ success: false, message: "Failed to delete notification" });
        }
    },

    getPreferences: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            let pref = await NotificationPreferenceModel.getByUserIdAndRole(user.id, user.role);
            if (!pref) {
                pref = {
                    email_notifications: true,
                    push_notifications: true,
                    sms_notifications: false,
                    categories_enabled: ["academic", "fee", "transport", "library", "general", "system"]
                };
            }

            return res.json({ success: true, data: pref });
        } catch (err) {
            console.error("Get preferences error:", err);
            return res.status(500).json({ success: false, message: "Failed to fetch preferences" });
        }
    },

    updatePreferences: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const { email_notifications, push_notifications, sms_notifications, categories_enabled } = req.body || {};
            await NotificationPreferenceModel.upsert(user.id, user.role, {
                email_notifications,
                push_notifications,
                sms_notifications,
                categories_enabled
            });

            return res.json({ success: true, message: "Preferences updated successfully" });
        } catch (err) {
            console.error("Update preferences error:", err);
            return res.status(500).json({ success: false, message: "Failed to update preferences" });
        }
    },

    sendTestNotification: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            if (user.role !== "super_admin" && user.role !== "school_admin") {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }

            const { recipient_id, recipient_role, title, message, type, category, action_url } = req.body || {};

            const recipientId = parseId(recipient_id);
            if (!recipientId || !recipient_role || !title || !message) {
                return res.status(400).json({ success: false, message: "Missing required fields" });
            }

            const result = await NotificationService.createAndSend({
                recipient_id: recipientId,
                recipient_role,
                school_id: user.school_id || null,
                title,
                message,
                type: type || "info",
                category: category || "general",
                created_by: user.id,
                action_url: action_url || null
            });
            if (!result) {
                return res.status(404).json({ success: false, message: "Recipient not found, inactive, or notification disabled" });
            }

            return res.json({ success: true, message: "Test notification sent successfully", data: result });
        } catch (err) {
            console.error("Test notification error:", err);
            return res.status(500).json({ success: false, message: "Failed to send test notification" });
        }
    }
};

module.exports = notificationController;
