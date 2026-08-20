const db = require("../../config/database");
const NotificationService = require("../../services/notificationService");
const { getAssignedSchoolIds } = require("../../utils/groupAdminContext");
const { canAccessSchool } = require("../../utils/schoolAccess");
const { getSubscriptionState } = require("../../services/subscriptionService");

const MAX_CHAT_MESSAGE_LENGTH = 1000;

const validateChatMessageText = (message) => {
    if (typeof message !== "string") {
        return { valid: false, message: "Message content is required." };
    };
    const trimmed = message.trim();
    if (!trimmed) {
        return { valid: false, message: "Message content is required." };
    };
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
        return { valid: false, message: `Message must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.` };
    };

    const sanitized = trimmed.replace(/<[^>]*>/g, '').trim();
    if (!sanitized) {
        return { valid: false, message: "Message content is required." };
    };
    return { valid: true, message: sanitized };
};

const getBranchDisplayName = (branch) => {
    if (!branch) return "Branch";
    return `${branch.school_name} (${branch.branch_name || "Main"})`;
};

const notifyChatReceiver = async ({ receiverId, receiverRole, schoolId, senderId, senderName, senderRole, message, title }) => {
    try {
        const rolePath = senderRole.replace(/_/g, "");
        await NotificationService.createAndSend({
            recipient_id: receiverId,
            recipient_role: receiverRole,
            school_id: schoolId,
            title: title || `New Message from ${senderName}`,
            message,
            type: "info",
            category: "general",
            reference_type: "chat",
            reference_id: senderId,
            created_by: senderId,
            action_url: `/schooladmin/chat?role=${rolePath}`
        });
    } catch (err) {
        console.error("Chat notification error:", err.message);
    };
};

const emitChatUnreadCount = async (userId) => {
    try {
        const { getIO } = require("../../config/socket");
        const io = getIO();
        
        const [row] = await db.queryAsync(
            `SELECT COUNT(*) AS count 
            FROM chat_messages cm
            JOIN group_admin_schools gas ON cm.school_id = gas.school_id
            JOIN group_admins ga ON ga.id = gas.group_admin_id
            WHERE ga.user_id = ? AND ga.status = 'active' AND gas.status = 'active'
                AND cm.receiver_id = ? AND cm.is_read = 0 AND cm.deleted_at IS NULL`,
            [userId, userId]
        );
        const unreadCount = Number(row?.count || 0);
        io.to(`user:${userId}`).emit("chat_unread_count_update", { unreadCount });
    } catch (err) {
        console.error("Chat unread count error:", err.message);
    };
};

const chatController = {
    getChatInboxPage: async (req, res) => {
        try {
            const userId = req.user.id;
            const assignedIds = await getAssignedSchoolIds(userId);

            let contacts = [];
            if (assignedIds.length > 0) {
                contacts = await db.queryAsync(
                    `SELECT 
                        s.id AS school_id,
                        s.school_name,
                        s.branch_name,
                        u.id AS admin_id,
                        u.first_name,
                        u.last_name,
                        u.image,
                        u.role AS admin_role,
                        (SELECT CASE WHEN deleted_at IS NOT NULL THEN '🚫 This message was deleted' ELSE message END FROM chat_messages 
                            WHERE school_id = s.id
                                AND ((sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id))
                            ORDER BY created_at DESC LIMIT 1) as last_message,
                        (SELECT created_at FROM chat_messages 
                            WHERE school_id = s.id
                                AND ((sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id))
                            ORDER BY created_at DESC LIMIT 1) as last_message_time,
                        (SELECT COUNT(*) FROM chat_messages 
                            WHERE school_id = s.id AND deleted_at IS NULL
                                AND sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
                    FROM schools s
                    LEFT JOIN users u ON u.school_id = s.id AND u.role = 'school_admin' AND u.status = 'active' AND u.deleted_at IS NULL
                    WHERE s.id IN (?)
                    ORDER BY s.school_name ASC, s.branch_name ASC`,
                    [userId, userId, userId, userId, userId, assignedIds]
                );
            };

            res.render("groupAdmin/chat", {
                title: "Internal Messages",
                contacts,
                user: req.user,
                layout: "groupAdmin/layout",
                currentPath: "/groupadmin/chat"
            });
        } catch (err) {
            console.error("[GroupAdmin Chat getChatInboxPage]", err);
            req.flash("error", "Failed to load chat portal.");
            res.redirect("/groupadmin/dashboard");
        };
    },

    getChatHistory: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, adminId } = req.params;

            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            };

            const [adminCheck] = await db.queryAsync(
                "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
                [adminId, schoolId]
            );
            if (!adminCheck) {
                return res.status(404).json({ success: false, message: "School admin contact not found for this branch." });
            };

            const sql = `
                SELECT 
                    id, school_id, sender_id, receiver_id, 
                    CASE WHEN deleted_at IS NOT NULL THEN 'This message was deleted' ELSE message END AS message,
                    is_read, created_at, deleted_at
                FROM chat_messages 
                WHERE school_id = ?
                  AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
                ORDER BY created_at ASC
            `;
            const messages = await db.queryAsync(sql, [schoolId, userId, adminId, adminId, userId]);

            await db.queryAsync(
                `UPDATE chat_messages 
                 SET is_read = 1 
                 WHERE school_id = ? AND sender_id = ? AND receiver_id = ? AND is_read = 0 AND deleted_at IS NULL`,
                [schoolId, adminId, userId]
            );

            await emitChatUnreadCount(userId);
            res.json({ success: true, messages });
        } catch (err) {
            console.error("[GroupAdmin Chat getChatHistory]", err);
            res.status(500).json({ success: false, message: "Failed to retrieve chat history." });
        };
    },

    sendMessage: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, receiverId, message } = req.body;
            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            };

            const subState = await getSubscriptionState(schoolId);
            if (subState.school?.status === "suspended" || subState.school?.status === "inactive" || subState.subscriptionLocked) {
                return res.status(403).json({ success: false, message: "This branch's subscription has expired or is suspended." });
            };
            if (typeof subState.hasFeature === "function" && !subState.hasFeature("messaging")) {
                return res.status(403).json({ success: false, message: "Messaging feature is not enabled for this branch." });
            };

            const [receiver] = await db.queryAsync(
                "SELECT id, role, first_name, last_name FROM users WHERE id = ? AND school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
                [receiverId, schoolId]
            );
            if (!receiver) {
                return res.status(404).json({ success: false, message: "Recipient is not an active admin for this school." });
            };

            const textValidation = validateChatMessageText(message);
            if (!textValidation.valid) {
                return res.status(400).json({ success: false, message: textValidation.message });
            };

            const sql = `
                INSERT INTO chat_messages (school_id, sender_id, receiver_id, message, is_read)
                VALUES (?, ?, ?, ?, 0)
            `;
            const result = await db.queryAsync(sql, [schoolId, userId, receiverId, textValidation.message]);

            const messageData = {
                id: result.insertId,
                school_id: Number(schoolId),
                sender_id: userId,
                sender_name: `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || "Group Admin",
                sender_role: req.user.role,
                receiver_id: Number(receiverId),
                message: textValidation.message,
                is_read: 0,
                created_at: new Date()
            };

            try {
                const { getIO } = require("../../config/socket");
                const io = getIO();
                io.to(`user:${receiverId}`).emit("chat_message", messageData);
                io.to(`user:${userId}`).emit("chat_message", messageData);
                io.to(`user:${receiverId}`).emit("chat_unread_notification", { sender_id: userId });
                
                const [[unreadRow]] = await db.query(
                    "SELECT COUNT(*) AS count FROM chat_messages WHERE school_id = ? AND receiver_id = ? AND is_read = 0 AND deleted_at IS NULL",
                    [schoolId, receiverId]
                );
                io.to(`user:${receiverId}`).emit("chat_unread_count_update", { unreadCount: Number(unreadRow?.count || 0) });
            } catch (socketErr) {
                console.error("Failed to emit chat message via sockets:", socketErr.message);
            };

            await notifyChatReceiver({
                receiverId,
                receiverRole: receiver.role,
                schoolId,
                senderId: userId,
                senderName: messageData.sender_name,
                senderRole: req.user.role,
                message: textValidation.message
            });

            res.json({ success: true, message: messageData });
        } catch (err) {
            console.error("[GroupAdmin Chat sendMessage]", err);
            res.status(500).json({ success: false, message: "Failed to send message." });
        };
    },

    markAllRead: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, senderId } = req.body;

            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            }

            await db.queryAsync(
                `UPDATE chat_messages
                SET is_read = 1
                WHERE school_id = ? AND sender_id = ? AND receiver_id = ?
                    AND is_read = 0 AND deleted_at IS NULL`,
                [schoolId, senderId, userId]
            );

            await emitChatUnreadCount(userId);

            res.json({ success: true });
        } catch (err) {
            console.error("[GroupAdmin Chat markAllRead]", err);
            res.status(500).json({ success: false, message: "Failed to mark messages as read." });
        };
    },

    getUnreadCount: async (req, res) => {
        try {
            const userId = req.user.id;
            const [row] = await db.queryAsync(
                `SELECT COUNT(*) AS count 
                FROM chat_messages cm
                JOIN group_admin_schools gas ON cm.school_id = gas.school_id
                JOIN group_admins ga ON ga.id = gas.group_admin_id
                WHERE ga.user_id = ? AND ga.status = 'active' AND gas.status = 'active'
                    AND cm.receiver_id = ? AND cm.is_read = 0 AND cm.deleted_at IS NULL`,
                [userId, userId]
            );
            res.json({ success: true, unreadCount: Number(row?.count || 0) });
        } catch (err) {
            console.error("[GroupAdmin Chat getUnreadCount]", err);
            res.status(500).json({ success: false, message: "Failed to fetch unread count." });
        };
    },

    searchMessages: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, adminId, q } = req.query;

            const queryText = (q || "").trim();
            if (!queryText || queryText.length < 2) {
                return res.status(400).json({ success: false, message: "Search query must be at least 2 characters." });
            };

            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            };

            const targetAdminId = parseInt(adminId, 10);
            if (!Number.isInteger(targetAdminId) || targetAdminId <= 0) {
                return res.status(400).json({ success: false, message: "Invalid school admin selected." });
            };

            const [adminCheck] = await db.queryAsync(
                "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
                [targetAdminId, schoolId]
            );
            if (!adminCheck) {
                return res.status(404).json({ success: false, message: "School admin contact not found for this branch." });
            };

            const searchTerm = `%${queryText}%`;
            const messages = await db.queryAsync(
                `SELECT id, sender_id, receiver_id, message, is_read, created_at
                FROM chat_messages
                WHERE school_id = ?
                    AND deleted_at IS NULL
                    AND message LIKE ?
                    AND (
                        (sender_id = ? AND receiver_id = ?)
                        OR
                        (sender_id = ? AND receiver_id = ?)
                    )
                ORDER BY created_at DESC
                LIMIT 50`,
                [schoolId, searchTerm, userId, targetAdminId, targetAdminId, userId]
            );
            res.json({ success: true, messages, query: queryText });
        } catch (err) {
            console.error("[GroupAdmin Chat searchMessages]", err);
            res.status(500).json({ success: false, message: "Search failed." });
        };
    },

    deleteMessage: async (req, res) => {
        try {
            const userId = req.user.id;
            const messageId = parseInt(req.params.messageId, 10);

            if (!Number.isInteger(messageId) || messageId <= 0) {
                return res.status(400).json({ success: false, message: "Invalid message ID." });
            };

            const [message] = await db.queryAsync(
                "SELECT id, school_id, sender_id, receiver_id FROM chat_messages WHERE id = ? AND deleted_at IS NULL LIMIT 1",
                [messageId]
            );

            if (!message) {
                return res.status(404).json({ success: false, message: "Message not found." });
            };

            if (Number(message.sender_id) !== Number(userId)) {
                return res.status(403).json({ success: false, message: "You can only delete your own sent messages." });
            };

            const hasAccess = await canAccessSchool(req.user, message.school_id);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            };

            await db.queryAsync(
                "UPDATE chat_messages SET deleted_at = NOW() WHERE id = ?",
                [messageId]
            );

            try {
                const { getIO } = require("../../config/socket");
                const io = getIO();
                const payload = { message_id: messageId };
                io.to(`user:${userId}`).emit("chat_message_deleted", payload);
                io.to(`user:${message.receiver_id}`).emit("chat_message_deleted", payload);
            } catch (socketErr) {
                console.error("Socket emit failed for deleteMessage:", socketErr.message);
            };

            res.json({ success: true, message_id: messageId });
        } catch (err) {
            console.error("[GroupAdmin Chat deleteMessage]", err);
            res.status(500).json({ success: false, message: "Failed to delete message." });
        };
    },

    renderBroadcastForm: async (req, res) => {
        try {
            const userId = req.user.id;
            const assignedIds = await getAssignedSchoolIds(userId);

            let branches = [];
            if (assignedIds.length > 0) {
                branches = await db.queryAsync(
                    `SELECT s.id AS school_id, s.school_name, s.branch_name,
                        COUNT(u.id) AS admin_count,
                        GROUP_CONCAT(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) ORDER BY u.first_name SEPARATOR ', ') AS admin_names
                    FROM schools s
                    LEFT JOIN users u ON u.school_id = s.id AND u.role = 'school_admin' AND u.status = 'active' AND u.deleted_at IS NULL
                    WHERE s.id IN (?)
                    GROUP BY s.id, s.school_name, s.branch_name
                    ORDER BY s.school_name ASC, s.branch_name ASC`,
                    [assignedIds]
                );
            };

            res.render("groupAdmin/chat/broadcast", {
                title: "Broadcast Announcement",
                branches,
                user: req.user,
                layout: "groupAdmin/layout",
                currentPath: "/groupadmin/chat"
            });
        } catch (err) {
            console.error("[GroupAdmin Chat renderBroadcastForm]", err);
            req.flash("error", "Failed to load broadcast screen.");
            res.redirect("/groupadmin/chat");
        };
    },

    sendBroadcast: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolIds, message } = req.body;

            const textValidation = validateChatMessageText(message);
            if (!textValidation.valid) {
                req.flash("error", textValidation.message);
                return res.redirect("/groupadmin/chat/broadcast");
            };

            let rawSchoolIds = [];
            if (Array.isArray(schoolIds)) {
                rawSchoolIds = schoolIds;
            } else if (schoolIds) {
                rawSchoolIds = [schoolIds];
            };

            if (rawSchoolIds.length === 0) {
                req.flash("error", "Please select at least one branch to broadcast to.");
                return res.redirect("/groupadmin/chat/broadcast");
            };

            const sent = [];
            const skipped = [];
            const selectedSchoolIds = [...new Set(rawSchoolIds
                .map(id => parseInt(id, 10))
                .filter(id => Number.isInteger(id) && id > 0))];
            if (selectedSchoolIds.length === 0) {
                req.flash("error", "Please select at least one valid branch to broadcast to.");
                return res.redirect("/groupadmin/chat/broadcast");
            };

            for (const schoolId of selectedSchoolIds) {
                const hasAccess = await canAccessSchool(req.user, schoolId);
                if (!hasAccess) {
                    skipped.push(`ID ${schoolId} (Access Denied)`);
                    continue;
                };

                const [schoolInfo] = await db.queryAsync(
                    "SELECT school_name, branch_name FROM schools WHERE id = ? LIMIT 1",
                    [schoolId]
                );
                const displayName = schoolInfo ? getBranchDisplayName(schoolInfo) : `Branch ${schoolId}`;

                const subState = await getSubscriptionState(schoolId);
                if (subState.school?.status === "suspended" || subState.school?.status === "inactive" || subState.subscriptionLocked) {
                    skipped.push(`${displayName} (Subscription Inactive)`);
                    continue;
                };

                if (typeof subState.hasFeature === "function" && !subState.hasFeature("messaging")) {
                    skipped.push(`${displayName} (Chat Disabled)`);
                    continue;
                };

                const admins = await db.queryAsync(
                    "SELECT id, role FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL",
                    [schoolId]
                );

                if (admins.length === 0) {
                    skipped.push(`${displayName} (No active admin)`);
                    continue;
                };

                for (const admin of admins) {
                    const insertSql = `
                        INSERT INTO chat_messages (school_id, sender_id, receiver_id, message, is_read)
                        VALUES (?, ?, ?, ?, 0)
                    `;
                    const result = await db.queryAsync(insertSql, [schoolId, userId, admin.id, textValidation.message]);

                    const messageData = {
                        id: result.insertId,
                        school_id: schoolId,
                        sender_id: userId,
                        sender_name: `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || "Group Admin",
                        sender_role: req.user.role,
                        receiver_id: admin.id,
                        message: textValidation.message,
                        is_read: 0,
                        created_at: new Date()
                    };

                    try {
                        const { getIO } = require("../../config/socket");
                        const io = getIO();
                        io.to(`user:${admin.id}`).emit("chat_message", messageData);
                        io.to(`user:${userId}`).emit("chat_message", messageData);
                        io.to(`user:${admin.id}`).emit("chat_unread_notification", { sender_id: userId });

                        const [[unreadRow]] = await db.query(
                            "SELECT COUNT(*) AS count FROM chat_messages WHERE school_id = ? AND receiver_id = ? AND is_read = 0 AND deleted_at IS NULL",
                            [schoolId, admin.id]
                        );
                        io.to(`user:${admin.id}`).emit("chat_unread_count_update", { unreadCount: Number(unreadRow?.count || 0) });
                    } catch (socketErr) {
                        console.error("Socket emit failed during broadcast:", socketErr.message);
                    };

                    await notifyChatReceiver({
                        receiverId: admin.id,
                        receiverRole: admin.role,
                        schoolId,
                        senderId: userId,
                        senderName: messageData.sender_name,
                        senderRole: req.user.role,
                        message: textValidation.message,
                        title: "Broadcast Announcement from Group Admin"
                    });
                };

                sent.push(`${displayName} (${admins.length} admin${admins.length === 1 ? "" : "s"})`);
            };

            let flashMsg = "";
            if (sent.length > 0) {
                flashMsg += `Sent to ${sent.length} branch${sent.length === 1 ? "" : "es"}: ${sent.join(", ")}. `;
            };
            if (skipped.length > 0) {
                flashMsg += `Skipped: ${skipped.join(", ")}.`;
            };

            if (sent.length > 0) {
                req.flash("success", flashMsg);
            } else {
                req.flash("error", `Broadcast failed. ${flashMsg}`);
            };

            res.redirect("/groupadmin/chat");
        } catch (err) {
            console.error("[GroupAdmin Chat sendBroadcast]", err);
            req.flash("error", "Failed to broadcast message.");
            res.redirect("/groupadmin/chat/broadcast");
        };
    }
};

module.exports = chatController;