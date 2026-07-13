const db = require('../config/database');
const NotificationService = require('../services/notificationService');
const chatPermissionService = require('../services/chatPermissionService');

const { CHAT_ENABLED_ROLES } = chatPermissionService;
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const ROLE_PATHS = {
    school_admin: 'schooladmin',
    teacher: 'teacher',
    librarian: 'librarian',
    driver: 'driver'
};

const isValidChatPartner = async (schoolId, partnerId) => {
    const userId = Number.parseInt(partnerId, 10);
    if (!schoolId || !Number.isInteger(userId) || userId <= 0) {
        return null;
    };
    const [rows] = await db.query(
        `SELECT id, school_id, role, first_name, last_name, image
        FROM users
        WHERE id = ? AND school_id = ? AND status = 'active' AND role IN (?, ?, ?, ?)
        LIMIT 1`,
        [userId, schoolId, ...CHAT_ENABLED_ROLES]
    );
    if (rows[0]) return rows[0];

    const [groupAdminRows] = await db.query(
        `SELECT u.id, u.school_id, u.role, u.first_name, u.last_name, u.image
        FROM users u
        JOIN group_admins ga ON u.id = ga.user_id
        JOIN group_admin_schools gas ON ga.id = gas.group_admin_id
        WHERE u.id = ? AND gas.school_id = ? AND u.status = 'active' AND u.role = 'group_admin' AND ga.status = 'active' AND gas.status = 'active'
        LIMIT 1`,
        [userId, schoolId]
    );
    return groupAdminRows[0] || null;
};

const validateChatMessageText = (message) => {
    if (typeof message !== 'string') {
        return { valid: false, message: 'Message content is required.' };
    };
    const trimmed = message.trim();
    if (!trimmed) {
        return { valid: false, message: 'Message content is required.' };
    };
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
        return { valid: false, message: `Message must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.` };
    };
    // Strip any HTML tags (defense-in-depth against stored XSS)
    const sanitized = trimmed.replace(/<[^>]*>/g, '').trim();
    if (!sanitized) {
        return { valid: false, message: 'Message content is required.' };
    };
    return { valid: true, message: sanitized };
};

const getRolePath = (role) => ROLE_PATHS[role] || String(role || '').replace(/_/g, '');
const getDashboardPath = (role) => `/${getRolePath(role)}/dashboard`;
const getChatUnreadCount = async (userId, schoolId) => {
    const [[row]] = await db.query(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE school_id = ? AND receiver_id = ? AND is_read = 0 AND deleted_at IS NULL",
        [schoolId, userId]
    );
    return Number(row?.count || 0);
};

const emitChatUnreadCount = async (userId, schoolId) => {
    try {
        const { getIO } = require('../config/socket');
        const io = getIO();
        const unreadCount = await getChatUnreadCount(userId, schoolId);
        io.to(`user:${userId}`).emit('chat_unread_count_update', { unreadCount });
    } catch (err) {
        console.error('Chat unread count error:', err.message);
    };
};

const notifyChatReceiver = async ({ receiverId, receiverRole, schoolId, senderId, senderName, senderRole, message }) => {
    try {
        await NotificationService.createAndSend({
            recipient_id: receiverId,
            recipient_role: receiverRole,
            school_id: schoolId,
            title: `New Message from ${senderName}`,
            message,
            type: 'info',
            category: 'general',
            reference_type: 'chat',
            reference_id: senderId,
            created_by: senderId,
            action_url: `/${getRolePath(receiverRole)}/chat?role=${getRolePath(senderRole)}`
        });
    } catch (err) {
        console.error('Chat notification error:', err.message);
    };
};

exports.getChatPage = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const role = req.user.role;

        const normalizedRole = chatPermissionService.normalizeChatRole(role);

        if (!chatPermissionService.isChatEnabledRole(normalizedRole)) {
            req.flash('error', 'Chat is not enabled for your role.');
            return res.redirect(getDashboardPath(role));
        };

        const allowedChatRoles = await chatPermissionService.getAllowedChatRoles(schoolId, normalizedRole);
        if (role === 'school_admin') {
            allowedChatRoles.push('group_admin');
        };
        const requestedFilterRole = chatPermissionService.normalizeChatRole(req.query.role);
        let filterRole = allowedChatRoles.includes(requestedFilterRole) ? requestedFilterRole : null;


        let sql = `
            SELECT 
                u.id, 
                u.first_name AS first_name, 
                u.last_name AS last_name, 
                u.role, 
                u.image,
                (SELECT message FROM chat_messages 
                    WHERE school_id = ? AND deleted_at IS NULL
                        AND ((sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id))
                    ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM chat_messages 
                    WHERE school_id = ? AND deleted_at IS NULL
                        AND ((sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id))
                    ORDER BY created_at DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM chat_messages 
                    WHERE school_id = ? AND deleted_at IS NULL
                        AND sender_id = u.id 
                        AND receiver_id = ? 
                        AND is_read = 0) as unread_count
                    FROM users u
                    WHERE (u.school_id = ? OR (u.role = 'group_admin' AND u.id IN (
                    SELECT ga.user_id FROM group_admins ga
                    JOIN group_admin_schools gas ON ga.id = gas.group_admin_id
                    WHERE gas.school_id = ? AND ga.status = 'active' AND gas.status = 'active'
                )))
            AND u.id != ? 
            AND u.status = 'active'
        `;
        const params = [
            schoolId, userId, userId,
            schoolId, userId, userId,
            schoolId, userId,
            schoolId, schoolId, userId
        ];

        if (allowedChatRoles.length === 0) {
            sql += ` AND 1 = 0 `;
        } else {
            sql += ` AND u.role IN (${allowedChatRoles.map(() => '?').join(', ')}) `;
            params.push(...allowedChatRoles);
        };

        if (filterRole) {
            sql += ` AND u.role = ? `;
            params.push(filterRole);
        };

        sql += ` ORDER BY (last_message_time IS NULL) ASC, last_message_time DESC, u.first_name ASC `;
        const [contacts] = await db.query(sql, params);
        const roleFolderMap = {
            'school_admin': 'schoolAdmin',
            'super_admin': 'superAdmin',
            'teacher': 'teacher',
            'student': 'student',
            'driver': 'driver',
            'librarian': 'librarian',
            'parent': 'parent'
        };

        const folder = roleFolderMap[role] || role;
        res.render(`${folder}/chat`, {
            title: 'Internal Messages',
            contacts,
            user: req.user,
            layout: `${folder}/layout`,
            currentPath: `/${ROLE_PATHS[role] || role.replace(/_/g, '')}/chat`,
            filterRole: filterRole || '',
            allowedChatRoles
        });
    } catch (err) {
        console.error('[Chat Controller getChatPage]', err);
        req.flash('error', 'Failed to load chat portal');
        res.redirect(getDashboardPath(req.user.role));
    };
};

exports.getChatHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const { receiverId } = req.params;

        const receiver = await isValidChatPartner(schoolId, receiverId);
        if (!receiver) {
            return res.status(403).json({ success: false, message: 'This contact is not available for chat.' });
        };

        const isGroupAdminSchoolAdminPair = (req.user.role === 'group_admin' && receiver.role === 'school_admin') ||
            (req.user.role === 'school_admin' && receiver.role === 'group_admin');
        if (!isGroupAdminSchoolAdminPair) {
            const chatAllowed = await chatPermissionService.canChat(schoolId, req.user.role, receiver.role);
            if (!chatAllowed) {
                return res.status(403).json({ success: false, message: 'Chat is not allowed for this role.' });
            };
        };

        const sql = `
            SELECT * FROM chat_messages 
            WHERE school_id = ? AND deleted_at IS NULL
                AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
            ORDER BY created_at ASC
        `;

        const [messages] = await db.query(sql, [schoolId, userId, receiverId, receiverId, userId]);
        await db.query(
            `UPDATE chat_messages 
            SET is_read = 1 
            WHERE school_id = ? AND sender_id = ? AND receiver_id = ? AND is_read = 0 AND deleted_at IS NULL`,
            [schoolId, receiverId, userId]
        );
        await emitChatUnreadCount(userId, schoolId);

        res.json({ success: true, messages });
    } catch (err) {
        console.error('[Chat Controller getChatHistory]', err);
        res.status(500).json({ success: false, message: 'Failed to retrieve message history.' });
    };
};

exports.sendMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const { receiver_id, message } = req.body;

        if (req.user.role !== 'group_admin' && !chatPermissionService.isChatEnabledRole(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Chat is not enabled for your role.' });
        };

        const sender = await isValidChatPartner(schoolId, userId);
        if (!sender || sender.role !== req.user.role) {
            return res.status(403).json({ success: false, message: 'Your chat access is not available.' });
        };

        const textValidation = validateChatMessageText(message);
        if (!textValidation.valid) {
            return res.status(400).json({ success: false, message: textValidation.message });
        };

        const receiverId = parseInt(receiver_id, 10);
        if (!Number.isInteger(receiverId) || receiverId <= 0 || receiverId === userId) {
            return res.status(400).json({ success: false, message: 'Invalid chat contact.' });
        };

        const receiver = await isValidChatPartner(schoolId, receiverId);
        if (!receiver) {
            return res.status(403).json({ success: false, message: 'This contact is not available for chat.' });
        };

        const isGroupAdminSchoolAdminPair = (req.user.role === 'group_admin' && receiver.role === 'school_admin') || (req.user.role === 'school_admin' && receiver.role === 'group_admin');
        if (!isGroupAdminSchoolAdminPair) {
            const chatAllowed = await chatPermissionService.canChat(schoolId, req.user.role, receiver.role);
            if (!chatAllowed) {
                return res.status(403).json({ success: false, message: 'Chat is not allowed for this role.' });
            };
        };

        const sql = `
            INSERT INTO chat_messages (school_id, sender_id, receiver_id, message, is_read)
            VALUES (?, ?, ?, ?, 0)
        `;
        const [result] = await db.query(sql, [schoolId, userId, receiverId, textValidation.message]);
        const messageData = {
            id: result.insertId,
            school_id: schoolId,
            sender_id: userId,
            sender_name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'User',
            sender_role: req.user.role,
            receiver_id: receiverId,
            message: textValidation.message,
            is_read: 0,
            created_at: new Date()
        };

        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            io.to(`user:${receiverId}`).emit('chat_message', messageData);
            io.to(`user:${userId}`).emit('chat_message', messageData);
            io.to(`user:${receiverId}`).emit('chat_unread_notification', { sender_id: userId });
            await emitChatUnreadCount(receiverId, schoolId);
        } catch (socketErr) {
            console.error('Failed to emit chat message via sockets:', socketErr.message);
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
        console.error('[Chat Controller sendMessage]', err);
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    };
};

exports.deleteMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const messageId = parseInt(req.params.messageId, 10);

        if (!Number.isInteger(messageId) || messageId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid message ID' });
        };

        const [[message]] = await db.query(
            `SELECT id, receiver_id FROM chat_messages
            WHERE id = ? AND sender_id = ? AND school_id = ?
                AND deleted_at IS NULL`,
            [messageId, userId, schoolId]
        );

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found or you are not the sender'
            });
        };

        await db.query(
            `UPDATE chat_messages
            SET deleted_at = NOW()
            WHERE id = ? AND sender_id = ? AND school_id = ?`,
            [messageId, userId, schoolId]
        );

        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            const payload = { message_id: messageId };
            io.to(`user:${userId}`).emit('chat_message_deleted', payload);
            io.to(`user:${message.receiver_id}`).emit('chat_message_deleted', payload);
        } catch (socketErr) {
            console.error('Socket emit failed for deleteMessage:', socketErr.message);
        };

        res.json({ success: true, message_id: messageId });
    } catch (err) {
        console.error('[ChatController deleteMessage]', err);
        res.status(500).json({ success: false, message: 'Failed to delete message' });
    };
};

exports.searchMessages = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const query = (req.query.q || '').trim();
        const withUserId = parseInt(req.query.with, 10);

        if (!query || query.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Search query must be at least 2 characters'
            });
        };

        if (!Number.isInteger(withUserId) || withUserId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid contact ID'
            });
        };

        const searchTerm = `%${query}%`;
        const [messages] = await db.query(
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
            [schoolId, searchTerm, userId, withUserId, withUserId, userId]
        );

        res.json({ success: true, messages, query });
    } catch (err) {
        console.error('[ChatController searchMessages]', err);
        res.status(500).json({ success: false, message: 'Search failed' });
    };
};

exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const [[row]] = await db.query(
            `SELECT COUNT(*) AS count FROM chat_messages
            WHERE school_id = ? AND receiver_id = ?
                AND is_read = 0 AND deleted_at IS NULL`,
            [schoolId, userId]
        );

        res.json({ success: true, count: Number(row?.count || 0) });
    } catch (err) {
        console.error('[ChatController getUnreadCount]', err);
        res.status(500).json({ success: false, message: 'Failed to get unread count' });
    };
};

exports.markAllRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const senderId = parseInt(req.body.sender_id, 10);

        if (!Number.isInteger(senderId) || senderId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid sender ID' });
        };

        await db.query(
            `UPDATE chat_messages
            SET is_read = 1
            WHERE school_id = ? AND sender_id = ? AND receiver_id = ?
                AND is_read = 0 AND deleted_at IS NULL`,
            [schoolId, senderId, userId]
        );

        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            const [[row]] = await db.query(
                `SELECT COUNT(*) AS count FROM chat_messages
                WHERE school_id = ? AND receiver_id = ?
                    AND is_read = 0 AND deleted_at IS NULL`,
                [schoolId, userId]
            );
            const unreadCount = Number(row?.count || 0);
            io.to(`user:${userId}`).emit('chat_unread_count_update', { unreadCount });
        } catch (socketErr) {
            console.error('Socket emit failed for markAllRead:', socketErr.message);
        };

        res.json({ success: true });
    } catch (err) {
        console.error('[ChatController markAllRead]', err);
        res.status(500).json({ success: false, message: 'Failed to mark messages as read' });
    };
};