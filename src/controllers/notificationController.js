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
            };

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
        };
    },

    getUnreadCount: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            };

            const count = await NotificationModel.getUnreadCount(user.id, user.role);
            return res.json({ success: true, count });
        } catch (err) {
            console.error("Get unread count error:", err);
            return res.status(500).json({ success: false, message: "Failed to get unread count" });
        };
    },

    markRead: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            };

            const id = parseId(req.params.id);
            if (!id) {
                return res.status(400).json({ success: false, message: "Invalid notification id" });
            };
            const success = await NotificationModel.markAsRead(id, user.id, user.role);
            if (!success) {
                return res.status(404).json({ success: false, message: "Notification not found or access denied" });
            };

            await emitUnreadCount(user);
            return res.json({ success: true, message: "Notification marked as read" });
        } catch (err) {
            console.error("Mark read error:", err);
            return res.status(500).json({ success: false, message: "Failed to mark read" });
        };
    },

    markAllRead: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            };

            const count = await NotificationModel.markAllAsRead(user.id, user.role);
            await emitUnreadCount(user);
            return res.json({ success: true, message: `Marked ${count} notifications as read` });
        } catch (err) {
            console.error("Mark all read error:", err);
            return res.status(500).json({ success: false, message: "Failed to mark all read" });
        };
    },

    deleteNotification: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            };

            const id = parseId(req.params.id);
            if (!id) {
                return res.status(400).json({ success: false, message: "Invalid notification id" });
            };
            const success = await NotificationModel.delete(id, user.id, user.role);
            if (!success) {
                return res.status(404).json({ success: false, message: "Notification not found or access denied" });
            };

            await emitUnreadCount(user);
            return res.json({ success: true, message: "Notification deleted" });
        } catch (err) {
            console.error("Delete notification error:", err);
            return res.status(500).json({ success: false, message: "Failed to delete notification" });
        };
    },

    getPreferences: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            };

            let pref = await NotificationPreferenceModel.getByUserIdAndRole(user.id, user.role);
            if (!pref) {
                pref = {
                    email_notifications: true,
                    push_notifications: true,
                    sms_notifications: false,
                    categories_enabled: ["academic", "fee", "transport", "library", "general", "system"]
                };
            };

            return res.json({ success: true, data: pref });
        } catch (err) {
            console.error("Get preferences error:", err);
            return res.status(500).json({ success: false, message: "Failed to fetch preferences" });
        };
    },

    updatePreferences: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            };

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
        };
    },

    sendTestNotification: async (req, res) => {
        try {
            const user = req.user || req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            };

            if (user.role !== "super_admin" && user.role !== "school_admin") {
                return res.status(403).json({ success: false, message: "Forbidden" });
            };

            const { recipient_id, recipient_role, title, message, type, category, action_url } = req.body || {};
            const recipientId = parseId(recipient_id);
            if (!recipientId || !recipient_role || !title || !message) {
                return res.status(400).json({ success: false, message: "Missing required fields" });
            };

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
            };

            return res.json({ success: true, message: "Test notification sent successfully", data: result });
        } catch (err) {
            console.error("Test notification error:", err);
            return res.status(500).json({ success: false, message: "Failed to send test notification" });
        };
    },

    getDriverNotifications: async (req, res) => {
        try {
            await ensureDriverNotificationSchema();
            const schoolId = await resolveUserSchoolId(req.user);
            const userId = req.user?.id;
            if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

            const driverRows = await queryAsync(
                `SELECT id FROM drivers WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1`,
                [userId, schoolId]
            ).catch(() => []);
            const driverId = driverRows[0]?.id || 0;

            await queryAsync(`DELETE FROM driver_notifications WHERE created_at < NOW() - INTERVAL 30 DAY`).catch(() => {});
            const notifications = await queryAsync(
                `SELECT id, driver_id, type, priority, title, message, data, link, is_read, created_at 
                FROM driver_notifications 
                WHERE school_id = ? AND (driver_id = ? OR user_id = ?)
                ORDER BY id DESC LIMIT 50`,
                [schoolId, driverId, userId]
            ).catch(() => []);

            const unreadCount = notifications.filter(n => !n.is_read).length;
            return res.json({
                success: true,
                notifications,
                unreadCount
            });
        } catch (err) {
            console.error("Get Driver Notifications Error:", err);
            return res.status(500).json({ success: false, message: "Failed to fetch driver notifications" });
        };
    },

    markDriverNotificationRead: async (req, res) => {
        try {
            await ensureDriverNotificationSchema();
            const schoolId = await resolveUserSchoolId(req.user);
            const userId = req.user?.id;
            const notificationId = req.body?.id || req.body?.notificationId;

            if (notificationId) {
                await queryAsync(
                    `UPDATE driver_notifications SET is_read = 1 WHERE id = ? AND school_id = ?`,
                    [notificationId, schoolId]
                );
            };

            return res.json({ success: true, message: "Notification marked as read" });
        } catch (err) {
            console.error("Mark Driver Notification Read Error:", err);
            return res.status(500).json({ success: false, message: "Failed to mark notification read" });
        };
    },

    markAllDriverNotificationsRead: async (req, res) => {
        try {
            await ensureDriverNotificationSchema();
            const schoolId = await resolveUserSchoolId(req.user);
            const userId = req.user?.id;
            
            const driverRows = await queryAsync(
                `SELECT id FROM drivers WHERE user_id = ? AND school_id = ? LIMIT 1`,
                [userId, schoolId]
            ).catch(() => []);
            const driverId = driverRows[0]?.id || 0;

            await queryAsync(
                `UPDATE driver_notifications SET is_read = 1 WHERE school_id = ? AND (driver_id = ? OR user_id = ?)`,
                [schoolId, driverId, userId]
            );

            return res.json({ success: true, message: "All driver notifications marked as read" });
        } catch (err) {
            console.error("Mark All Driver Notifications Read Error:", err);
            return res.status(500).json({ success: false, message: "Failed to mark all notifications read" });
        };
    },

    sendDriverNotificationApi: async (req, res) => {
        try {
            await ensureDriverNotificationSchema();
            const { driver_id, user_id, type, priority, title, message, link, data } = req.body || {};
            const schoolId = req.body.school_id || (await resolveUserSchoolId(req.user));

            if (!title || !message) {
                return res.status(400).json({ success: false, message: "Title and message are required" });
            };

            const result = await queryAsync(
                `INSERT INTO driver_notifications (driver_id, user_id, school_id, type, priority, title, message, data, link)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    driver_id || 0,
                    user_id || 0,
                    schoolId,
                    type || 'notice',
                    priority || 'medium',
                    title,
                    message,
                    data ? JSON.stringify(data) : null,
                    link || '/driver/dashboard'
                ]
            );

            try {
                const io = getIO();
                if (io) {
                    const targetRoom = user_id ? `driver_${user_id}` : `driver_id_${driver_id}`;
                    io.to(targetRoom).emit("driver_notification", {
                        id: result.insertId,
                        type: type || 'notice',
                        priority: priority || 'medium',
                        title,
                        message,
                        link: link || '/driver/dashboard',
                        created_at: new Date().toISOString()
                    });
                };
            } catch (sockErr) {
                console.warn("[Driver Socket Emit Warn]:", sockErr.message);
            };
            return res.json({ success: true, message: "Notification created", notificationId: result.insertId });
        } catch (err) {
            console.error("Send Driver Notification Error:", err);
            return res.status(500).json({ success: false, message: "Failed to send driver notification" });
        };
    }
};

module.exports = notificationController;