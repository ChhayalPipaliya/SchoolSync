const db = require("../../config/database");
const NotificationService = require("../../services/notificationService");
const { getAssignedSchoolIds } = require("../../utils/groupAdminContext");
const { canAccessSchool } = require("../../utils/schoolAccess");
const { getSubscriptionState } = require("../../services/subscriptionService");

// Standard write-guard pattern for all Group Admin write operations:
// 1. Extract schoolId from req.params / req.body / req.query (whichever applies to the route)
// 2. const hasAccess = await canAccessSchool(req.user, schoolId);
// 3. if (!hasAccess) return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." })
//    (for JSON/AJAX routes) or render errors/403 view (for full-page form submits) — match the existing
//    pattern used in src/utils/groupAdminContext.js's ensureGroupSchoolAccess middleware.
// 4. Only after access is confirmed, perform the INSERT/UPDATE/DELETE.

const MAX_CHAT_MESSAGE_LENGTH = 1000;

const validateChatMessageText = (message) => {
    if (typeof message !== "string") {
        return { valid: false, message: "Message content is required." };
    }
    const trimmed = message.trim();
    if (!trimmed) {
        return { valid: false, message: "Message content is required." };
    }
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
        return { valid: false, message: `Message must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.` };
    }
    return { valid: true, message: trimmed };
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
    }
};

const emitChatUnreadCount = async (userId) => {
    try {
        const { getIO } = require("../../config/socket");
        const io = getIO();
        
        // Sum unread count across all assigned schools
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
    }
};

const chatController = {
    /**
     * Renders the Group Admin combined chat inbox view.
     */
    getChatInboxPage: async (req, res) => {
        try {
            const userId = req.user.id;
            const assignedIds = await getAssignedSchoolIds(userId);

            let contacts = [];
            if (assignedIds.length > 0) {
                // Task 4 Fix: LEFT JOIN users so branches with no admins still return
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
                         (SELECT message FROM chat_messages 
                          WHERE school_id = s.id AND deleted_at IS NULL
                            AND ((sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id))
                          ORDER BY created_at DESC LIMIT 1) as last_message,
                         (SELECT created_at FROM chat_messages 
                          WHERE school_id = s.id AND deleted_at IS NULL
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
            }

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
        }
    },

    /**
     * Gets chat history for a specific branch and admin.
     */
    getChatHistory: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, adminId } = req.params;

            // 1. School access check
            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            }

            // 2. Verify adminId is indeed the school_admin of that branch
            const [adminCheck] = await db.queryAsync(
                "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
                [adminId, schoolId]
            );
            if (!adminCheck) {
                return res.status(404).json({ success: false, message: "School admin contact not found for this branch." });
            }

            // 3. Query history (only non-deleted messages)
            const sql = `
                SELECT * FROM chat_messages 
                WHERE school_id = ? AND deleted_at IS NULL
                  AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
                ORDER BY created_at ASC
            `;
            const messages = await db.queryAsync(sql, [schoolId, userId, adminId, adminId, userId]);

            // 4. Mark unread messages as read
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
        }
    },

    /**
     * Sends a chat message.
     */
    sendMessage: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, receiverId, message } = req.body;

            // 1. School access check
            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            }

            // 2. Validate branch subscription
            const subState = await getSubscriptionState(schoolId);
            if (subState.school?.status === "suspended" || subState.school?.status === "inactive" || subState.subscriptionLocked) {
                return res.status(403).json({ success: false, message: "This branch's subscription has expired or is suspended." });
            }
            if (typeof subState.hasFeature === "function" && !subState.hasFeature("messaging")) {
                return res.status(403).json({ success: false, message: "Messaging feature is not enabled for this branch." });
            }

            // 3. Verify receiverId is school_admin of that branch
            const [receiver] = await db.queryAsync(
                "SELECT id, role, first_name, last_name FROM users WHERE id = ? AND school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
                [receiverId, schoolId]
            );
            if (!receiver) {
                return res.status(404).json({ success: false, message: "Recipient is not an active admin for this school." });
            }

            // 4. Validate message text
            const textValidation = validateChatMessageText(message);
            if (!textValidation.valid) {
                return res.status(400).json({ success: false, message: textValidation.message });
            }

            // 5. Insert message
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

            // 6. Deliver via Socket.IO
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
            }

            // 7. Send notification
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
        }
    },

    /**
     * Marks all messages from a school admin as read.
     */
    markAllRead: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, senderId } = req.body;

            // 1. School access check
            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            }

            // 2. Mark messages
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
        }
    },

    /**
     * Returns total unread messages count across all assigned schools.
     */
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
        }
    },

    /**
     * Searches chat messages.
     */
    searchMessages: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolId, adminId, q } = req.query;

            const queryText = (q || "").trim();
            if (!queryText || queryText.length < 2) {
                return res.status(400).json({ success: false, message: "Search query must be at least 2 characters." });
            }

            // 1. School access check
            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            }

            const targetAdminId = parseInt(adminId, 10);
            if (!Number.isInteger(targetAdminId) || targetAdminId <= 0) {
                return res.status(400).json({ success: false, message: "Invalid school admin selected." });
            }

            const [adminCheck] = await db.queryAsync(
                "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
                [targetAdminId, schoolId]
            );
            if (!adminCheck) {
                return res.status(404).json({ success: false, message: "School admin contact not found for this branch." });
            }

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
        }
    },

    /**
     * Soft deletes a message (own message only).
     */
    deleteMessage: async (req, res) => {
        try {
            const userId = req.user.id;
            const messageId = parseInt(req.params.messageId, 10);

            if (!Number.isInteger(messageId) || messageId <= 0) {
                return res.status(400).json({ success: false, message: "Invalid message ID." });
            }

            // 1. Fetch message and verify owner is sender
            const [message] = await db.queryAsync(
                "SELECT id, school_id, sender_id, receiver_id FROM chat_messages WHERE id = ? AND deleted_at IS NULL LIMIT 1",
                [messageId]
            );

            if (!message) {
                return res.status(404).json({ success: false, message: "Message not found." });
            }

            if (Number(message.sender_id) !== Number(userId)) {
                return res.status(403).json({ success: false, message: "You can only delete your own sent messages." });
            }

            // 2. School access check
            const hasAccess = await canAccessSchool(req.user, message.school_id);
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
            }

            // 3. Soft delete
            await db.queryAsync(
                "UPDATE chat_messages SET deleted_at = NOW() WHERE id = ?",
                [messageId]
            );

            // 4. Emit real-time delete event via Socket.IO
            try {
                const { getIO } = require("../../config/socket");
                const io = getIO();
                const payload = { message_id: messageId };
                io.to(`user:${userId}`).emit("chat_message_deleted", payload);
                io.to(`user:${message.receiver_id}`).emit("chat_message_deleted", payload);
            } catch (socketErr) {
                console.error("Socket emit failed for deleteMessage:", socketErr.message);
            }

            res.json({ success: true, message_id: messageId });
        } catch (err) {
            console.error("[GroupAdmin Chat deleteMessage]", err);
            res.status(500).json({ success: false, message: "Failed to delete message." });
        }
    },

    /**
     * Renders the Broadcast circular page.
     */
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
            }

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
        }
    },

    /**
     * Sends a broadcast message to selected branches' admins.
     */
    sendBroadcast: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolIds, message } = req.body;

            // 1. Validate fields
            const textValidation = validateChatMessageText(message);
            if (!textValidation.valid) {
                req.flash("error", textValidation.message);
                return res.redirect("/groupadmin/chat/broadcast");
            }

            // Normalize schoolIds to array
            let rawSchoolIds = [];
            if (Array.isArray(schoolIds)) {
                rawSchoolIds = schoolIds;
            } else if (schoolIds) {
                rawSchoolIds = [schoolIds];
            }

            if (rawSchoolIds.length === 0) {
                req.flash("error", "Please select at least one branch to broadcast to.");
                return res.redirect("/groupadmin/chat/broadcast");
            }

            const sent = [];
            const skipped = [];
            const selectedSchoolIds = [...new Set(rawSchoolIds
                .map(id => parseInt(id, 10))
                .filter(id => Number.isInteger(id) && id > 0))];
            if (selectedSchoolIds.length === 0) {
                req.flash("error", "Please select at least one valid branch to broadcast to.");
                return res.redirect("/groupadmin/chat/broadcast");
            }

            // 2. Loop over each school ID
            for (const schoolId of selectedSchoolIds) {
                // School access check
                const hasAccess = await canAccessSchool(req.user, schoolId);
                if (!hasAccess) {
                    skipped.push(`ID ${schoolId} (Access Denied)`);
                    continue;
                }

                // Query school details
                const [schoolInfo] = await db.queryAsync(
                    "SELECT school_name, branch_name FROM schools WHERE id = ? LIMIT 1",
                    [schoolId]
                );
                const displayName = schoolInfo ? getBranchDisplayName(schoolInfo) : `Branch ${schoolId}`;

                // Validate subscription
                const subState = await getSubscriptionState(schoolId);
                if (subState.school?.status === "suspended" || subState.school?.status === "inactive" || subState.subscriptionLocked) {
                    skipped.push(`${displayName} (Subscription Inactive)`);
                    continue;
                }
                if (typeof subState.hasFeature === "function" && !subState.hasFeature("messaging")) {
                    skipped.push(`${displayName} (Chat Disabled)`);
                    continue;
                }

                // Query active admins
                const admins = await db.queryAsync(
                    "SELECT id, role FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL",
                    [schoolId]
                );

                if (admins.length === 0) {
                    skipped.push(`${displayName} (No active admin)`);
                    continue;
                }

                // Send to each admin
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

                    // Socket emit
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
                    }

                    // Notification
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
                }

                sent.push(`${displayName} (${admins.length} admin${admins.length === 1 ? "" : "s"})`);
            }

            // 3. Render success message summary
            let flashMsg = "";
            if (sent.length > 0) {
                flashMsg += `Sent to ${sent.length} branch${sent.length === 1 ? "" : "es"}: ${sent.join(", ")}. `;
            }
            if (skipped.length > 0) {
                flashMsg += `Skipped: ${skipped.join(", ")}.`;
            }

            if (sent.length > 0) {
                req.flash("success", flashMsg);
            } else {
                req.flash("error", `Broadcast failed. ${flashMsg}`);
            }

            res.redirect("/groupadmin/chat");
        } catch (err) {
            console.error("[GroupAdmin Chat sendBroadcast]", err);
            req.flash("error", "Failed to broadcast message.");
            res.redirect("/groupadmin/chat/broadcast");
        }
    }
};

module.exports = chatController;
