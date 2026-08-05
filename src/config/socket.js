const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { getRedisClient } = require("./redis");
const socketAuth = require("../middleware/socketAuth");
const { queryAsync } = require("./database");
const chatPermissionService = require("../services/chatPermissionService");
const { createTransportAuthorizationService } = require("../services/transportAuthorizationService");

let io = null;
const transportLocationWriteCache = new Map();
const onlineUsers = new Map();

const CHAT_ROLE = {
    school_admin: "schooladmin",
    teacher: "teacher",
    librarian: "librarian",
    driver: "driver"
};

const { CHAT_ENABLED_ROLES, isGroupAdminSchoolAdminPair, isGroupAdminChatAllowed } = chatPermissionService;
const transportAuthorization = createTransportAuthorizationService({ query: queryAsync });
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const getRolePath = (role) => CHAT_ROLE[role] || String(role || "").replace(/_/g, "");
const toPositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toNullableNumber = (value) => {
    if (value === null || typeof value === "undefined" || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const getUserDisplayName = (user) => `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || "User";
const getChatUnreadCount = async (userId, schoolId) => {
    const rows = await queryAsync(
        `SELECT COUNT(*) AS count
        FROM chat_messages
        WHERE school_id = ?
            AND receiver_id = ?
            AND is_read = 0
            AND deleted_at IS NULL`,
        [schoolId, userId]
    );
    return Number(rows[0]?.count || 0);
};

const emitChatUnreadCount = async (userId, schoolId) => {
    const unreadCount = await getChatUnreadCount(userId, schoolId);
    io.to(`user:${userId}`).emit("chat_unread_count_update", { unreadCount });
    return unreadCount;
};

const validateChatMessageText = (message) => {
    if (typeof message !== "string") {
        return { valid: false, error: "Message content is required." };
    };

    const trimmed = message.trim();
    if (!trimmed) {
        return { valid: false, error: "Message content is required." };
    };

    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
        return { valid: false, error: `Message must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.` };
    };

    // Strip any HTML tags (defense-in-depth against stored XSS)
    const sanitized = trimmed.replace(/<[^>]*>/g, '').trim();
    if (!sanitized) {
        return { valid: false, error: "Message content is required." };
    };
    return { valid: true, message: sanitized };
};

const isValidChatPartner = async (schoolId, partnerId) => {
    const userId = toPositiveInt(partnerId);
    if (!schoolId || !userId || !Array.isArray(CHAT_ENABLED_ROLES) || CHAT_ENABLED_ROLES.length === 0) {
        return null;
    };

    const placeholders = CHAT_ENABLED_ROLES.map(() => "?").join(", ");
    const rows = await queryAsync(
        `SELECT id, school_id, role, first_name, last_name
        FROM users
        WHERE id = ?
            AND school_id = ?
            AND status = 'active'
            AND role IN (${placeholders})
        LIMIT 1`,
        [userId, schoolId, ...CHAT_ENABLED_ROLES]
    );
    return rows[0] || null;
};

const isValidSchoolAdminForGroupAdmin = async (schoolId, userId) => {
    const id = toPositiveInt(userId);
    if (!schoolId || !id) return null;
    const rows = await queryAsync(
        `SELECT u.id, u.school_id, u.role, u.first_name, u.last_name
        FROM users u
        WHERE u.id = ? AND u.school_id = ? AND u.role = 'school_admin'
            AND u.status = 'active' AND u.deleted_at IS NULL
        LIMIT 1`,
        [id, schoolId]
    );
    return rows[0] || null;
};

const groupAdminCanAccessSchool = async (groupAdminUserId, schoolId) => {
    const rows = await queryAsync(
        `SELECT 1
        FROM group_admins ga
        LEFT JOIN group_admin_schools gas ON ga.id = gas.group_admin_id AND gas.status = 'active'
        LEFT JOIN schools s ON s.school_group_id = ga.school_group_id
        WHERE ga.user_id = ? AND ga.status = 'active'
            AND (gas.school_id = ? OR s.id = ?)
        LIMIT 1`,
        [groupAdminUserId, schoolId, schoolId]
    );
    return rows.length > 0;
};

const notifyChatReceiver = async ({ receiverId, receiverRole, schoolId, senderId, senderName, senderRole, message }) => {
    try {
        const NotificationService = require("../services/notificationService");
        await NotificationService.createAndSend({
            recipient_id: receiverId,
            recipient_role: receiverRole,
            school_id: schoolId,
            title: `New Message from ${senderName}`,
            message,
            type: "info",
            category: "general",
            reference_type: "chat",
            reference_id: senderId,
            created_by: senderId,
            action_url: `/${getRolePath(receiverRole)}/chat?role=${getRolePath(senderRole)}`
        });
    } catch (err) {
        console.error("Chat notification error:", err.message);
    };
};

const getSchoolOnlineMap = (schoolId) => {
    const key = String(schoolId);
    if (!onlineUsers.has(key)) {
        onlineUsers.set(key, new Map());
    };
    return onlineUsers.get(key);
};

const addOnlineSocket = (schoolId, userId, socketId) => {
    const schoolMap = getSchoolOnlineMap(schoolId);
    const key = String(userId);
    const sockets = schoolMap.get(key) || new Set();
    const wasAlreadyOnline = sockets.size > 0;

    sockets.add(socketId);
    schoolMap.set(key, sockets);

    return !wasAlreadyOnline;
};

const removeOnlineSocket = (schoolId, userId, socketId) => {
    const schoolKey = String(schoolId);
    const userKey = String(userId);
    const schoolMap = onlineUsers.get(schoolKey);
    if (!schoolMap) return false;

    const sockets = schoolMap.get(userKey);
    if (!sockets) return false;

    sockets.delete(socketId);
    if (sockets.size > 0) return false;

    schoolMap.delete(userKey);
    if (schoolMap.size === 0) {
        onlineUsers.delete(schoolKey);
    };

    return true;
};

const getOnlineUserIds = (schoolId) => {
    const schoolMap = onlineUsers.get(String(schoolId));
    if (!schoolMap) return [];
    return [...schoolMap.keys()].map((id) => Number(id));
};

const canUseTypingEvent = async ({ schoolId, senderRole, senderId, receiverId }) => {
    if (!schoolId || !senderId || !receiverId || senderId === receiverId) return false;

    if (isGroupAdminChatAllowed(senderRole)) {
        const normalizedSender = chatPermissionService.normalizeChatRole(senderRole);
        if (normalizedSender === 'group_admin') {
            const receiver = await isValidSchoolAdminForGroupAdmin(schoolId, receiverId);
            return receiver !== null && await groupAdminCanAccessSchool(senderId, schoolId);
        };

        if (normalizedSender === 'school_admin') {
            const rows = await queryAsync(
                `SELECT 1 FROM users u
                JOIN group_admins ga ON u.id = ga.user_id
                LEFT JOIN group_admin_schools gas ON ga.id = gas.group_admin_id
                LEFT JOIN schools s ON s.school_group_id = ga.school_group_id
                WHERE u.id = ? AND (gas.school_id = ? OR s.id = ?)
                    AND u.status = 'active' AND u.role = 'group_admin' AND ga.status = 'active'
                LIMIT 1`,
                [receiverId, schoolId, schoolId]
            );
            if (rows.length > 0) return true;
        };
    };

    if (!chatPermissionService.isChatEnabledRole(senderRole)) return false;

    const receiver = await isValidChatPartner(schoolId, receiverId);
    if (!receiver) return false;

    return chatPermissionService.canChat(schoolId, senderRole, receiver.role);
};

const getDriverIdForUser = async (userId, schoolId) => {
    const driverRows = await queryAsync(
        `SELECT id
        FROM drivers
        WHERE user_id = ? AND school_id = ?
        LIMIT 1`,
        [userId, schoolId]
    );
    return driverRows[0]?.id || null;
};

const getRunningDriverTrip = async ({ requestedTripId, schoolId, driverId }) => {
    if (requestedTripId) {
        const tripRows = await queryAsync(
            `SELECT tt.id, tt.school_id, tt.route_id, tt.vehicle_id, tt.driver_id, tt.trip_type,
                r.route_name AS routeName, v.vehicle_number AS vehicleNumber
            FROM transport_trips tt
            LEFT JOIN routes r ON r.id = tt.route_id AND r.school_id = tt.school_id
            LEFT JOIN vehicles v ON v.id = tt.vehicle_id AND v.school_id = tt.school_id
            WHERE tt.id = ?
                AND tt.school_id = ?
                AND tt.driver_id = ?
                AND tt.status = 'running'
            LIMIT 1`,
            [requestedTripId, schoolId, driverId]
        );
        return tripRows[0] || null;
    };

    const fallbackRows = await queryAsync(
        `SELECT tt.id, tt.school_id, tt.route_id, tt.vehicle_id, tt.driver_id, tt.trip_type,
            r.route_name AS routeName, v.vehicle_number AS vehicleNumber
        FROM transport_trips tt
        LEFT JOIN routes r ON r.id = tt.route_id AND r.school_id = tt.school_id
        LEFT JOIN vehicles v ON v.id = tt.vehicle_id AND v.school_id = tt.school_id
        WHERE tt.school_id = ?
            AND tt.driver_id = ?
            AND tt.trip_date = CURDATE()
            AND tt.status = 'running'
        ORDER BY tt.id DESC
        LIMIT 1`,
        [schoolId, driverId]
    );

    return fallbackRows[0] || null;
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const proximityNotifyCache = new Map();
const checkProximityAndNotify = async (schoolId, tripId, busLat, busLng, tripType) => {
    try {
        const students = await queryAsync(
            `SELECT s.id AS studentId, u.first_name, u.last_name,
                sta.pickup_latitude AS allocationPickupLat, sta.pickup_longitude AS allocationPickupLng,
                sta.drop_latitude AS allocationDropLat, sta.drop_longitude AS allocationDropLng,
                ps.stop_name AS pickupStop, ps.latitude AS pickupLat, ps.longitude AS pickupLng,
                ds.stop_name AS dropStop, ds.latitude AS dropLat, ds.longitude AS dropLng
            FROM transport_trip_students tts
            JOIN students s ON tts.student_id = s.id AND s.school_id = tts.school_id
            JOIN users u ON s.user_id = u.id
            JOIN student_transport_allocations sta ON sta.student_id = s.id AND sta.school_id = s.school_id AND sta.status = 'active'
            LEFT JOIN transport_route_stops ps ON sta.pickup_stop_id = ps.id AND ps.school_id = s.school_id
            LEFT JOIN transport_route_stops ds ON sta.drop_stop_id = ds.id AND ds.school_id = s.school_id
            WHERE tts.trip_id = ? AND tts.school_id = ? AND tts.status NOT IN ('dropped','absent')
            LIMIT 100`,
            [tripId, schoolId]
        );

        const PROXIMITY_KM = 5;
        const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

        for (const st of students) {
            const isPickup = tripType !== 'drop';
            const preferredLat = isPickup ? st.allocationPickupLat : st.allocationDropLat;
            const preferredLng = isPickup ? st.allocationPickupLng : st.allocationDropLng;
            const fallbackLat = isPickup ? st.pickupLat : st.dropLat;
            const fallbackLng = isPickup ? st.pickupLng : st.dropLng;
            const stopLat = Number.isFinite(parseFloat(preferredLat)) ? parseFloat(preferredLat) : parseFloat(fallbackLat);
            const stopLng = Number.isFinite(parseFloat(preferredLng)) ? parseFloat(preferredLng) : parseFloat(fallbackLng);
            const stopName = isPickup ? st.pickupStop : st.dropStop;

            if (!Number.isFinite(stopLat) || !Number.isFinite(stopLng)) continue;

            const dist = haversineKm(busLat, busLng, stopLat, stopLng);
            if (dist > PROXIMITY_KM) continue;

            const cacheKey = `${schoolId}:${tripId}:${st.studentId}:${isPickup ? 'p' : 'd'}`;
            const lastNotified = proximityNotifyCache.get(cacheKey) || 0;
            const now = Date.now();
            if (now - lastNotified < NOTIFY_COOLDOWN_MS) continue;

            proximityNotifyCache.set(cacheKey, now);
            const parents = await queryAsync(
                `SELECT DISTINCT sf.parent_user_id AS parentUserId
                FROM student_family sf
                JOIN users u ON sf.parent_user_id = u.id AND u.status = 'active'
                WHERE sf.student_id = ?
                    AND sf.school_id = ?
                    AND sf.parent_user_id IS NOT NULL
                LIMIT 5`,
                [st.studentId, schoolId]
            );

            const speedKmph = 25;
            const eventMsg = {
                studentName: `${st.first_name} ${st.last_name}`,
                stopName: stopName || 'your stop',
                etaMin: Math.max(1, Math.round((dist / speedKmph) * 60)),
                type: isPickup ? 'pickup' : 'drop',
                tripId,
                timestamp: new Date().toISOString()
            };

            const proximityInsert = await queryAsync(
                `INSERT IGNORE INTO transport_proximity_notifications
                (school_id, trip_id, student_id, notification_type, threshold_km, distance_km)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [schoolId, tripId, st.studentId, `proximity_${PROXIMITY_KM}km`, PROXIMITY_KM, dist]
            ).catch((err) => {
                console.error('[Socket Proximity DB Save]', err.message);
                return null;
            });
            const shouldCreatePersistentNotification = !proximityInsert || proximityInsert.affectedRows !== 0;

            for (const p of parents) {
                io.to(`user:${p.parentUserId}`).emit('bus_approaching', eventMsg);
                if (!shouldCreatePersistentNotification) continue;
                try {
                    const NotificationService = require("../services/notificationService");
                    await NotificationService.createAndSend({
                        recipient_id: p.parentUserId,
                        recipient_role: "parent",
                        school_id: schoolId,
                        title: "Bus Proximity Alert",
                        message: `Bus is approaching ${eventMsg.studentName || "your child"}'s stop. ETA: ${eventMsg.etaMin || 0} min.`,
                        type: "info",
                        category: "transport",
                        reference_type: "transport_trip",
                        reference_id: tripId,
                        action_url: "/parent/transport"
                    });
                } catch (err) {
                    console.error("[Socket Proximity Notification]", err.message);
                };
            };
        };
    } catch (err) {
        console.error('[Proximity Notify]', err.message);
    };
};

const getConfiguredSocketOrigins = () => {
    const configured = process.env.SOCKET_CORS_ORIGIN || process.env.APP_URL || '';
    const origins = configured.split(',').map((value) => value.trim()).filter(Boolean);
    if (process.env.NODE_ENV !== 'production') {
        origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
    };
    return new Set(origins);
};

const isAllowedSocketOrigin = (request, allowedOrigins) => {
    const origin = request.headers.origin;
    if (!origin) return true;
    if (allowedOrigins.has(origin)) return true;

    try {
        return new URL(origin).host === request.headers.host;
    } catch (_) {
        return false;
    };
};

const initSocket = (server) => {
    const allowedOrigins = getConfiguredSocketOrigins();
    io = new Server(server, {
        cors: {
            origin: [...allowedOrigins],
            methods: ["GET", "POST"],
            credentials: true
        },
        allowRequest: (request, callback) => callback(null, isAllowedSocketOrigin(request, allowedOrigins))
    });

    const redisClient = getRedisClient();
    if (redisClient) {
        const pubClient = redisClient.duplicate();
        const subClient = redisClient.duplicate();

        pubClient.on("error", (err) => console.error("Socket.io Redis pub error:", err.message));
        subClient.on("error", (err) => console.error("Socket.io Redis sub error:", err.message));

        Promise.all([pubClient.connect(), subClient.connect()])
            .then(() => {
                io.adapter(createAdapter(pubClient, subClient));
            })
            .catch((err) => {
                console.error("Failed to connect Socket.io Redis duplicate clients:", err.message);
            });
    } else {
        console.warn("Redis client not ready, using default memory adapter for Socket.io.");
    };

    io.use(socketAuth);
    try {
        const gpsTrackingService = require('../services/gpsTrackingService');
        gpsTrackingService.startTimeoutScanner();
    } catch (err) {
        console.error('[GPS Scanner Start Error]:', err.message);
    };
    io.on("connection", (socket) => {
        const user = socket.user;
        if (!user) return socket.disconnect(true);

        const userId = toPositiveInt(user.id);
        const schoolId = toPositiveInt(user.school_id);
        if (!userId) return socket.disconnect(true);

        socket.join(`user:${userId}`);
        if (schoolId) {
            socket.join(`school:${schoolId}`);
            socket.join(`role:${user.role}:school:${schoolId}`);

            const becameOnline = addOnlineSocket(schoolId, userId, socket.id);
            if (becameOnline) {
                socket.to(`school:${schoolId}`).emit("user_online", { userId });
            };

            socket.emit("online_users_list", { userIds: getOnlineUserIds(schoolId) });
        };

        if (user.role === "super_admin") {
            socket.join("superadmin:global");
        };

        socket.on("send_chat_message", async (data = {}) => {
            try {
                const senderId = toPositiveInt(user.id);
                const currentSchoolId = toPositiveInt(user.school_id);
                const receiverId = toPositiveInt(data.receiver_id);

                const senderIsGroupAdmin = user.role === 'group_admin';
                const senderIsSchoolAdmin = user.role === 'school_admin';

                if (!chatPermissionService.isChatEnabledRole(user.role) && !senderIsGroupAdmin) {
                    socket.emit("chat_error", { message: "Chat is not enabled for your role." });
                    return;
                };

                if (!senderIsGroupAdmin && !currentSchoolId) {
                    socket.emit("chat_error", { message: "School context is required for chat." });
                    return;
                };

                const textValidation = validateChatMessageText(data.message);
                if (!textValidation.valid) {
                    socket.emit("chat_error", { message: textValidation.error });
                    return;
                };

                if (!receiverId || receiverId === senderId) {
                    socket.emit("chat_error", { message: "Invalid chat contact." });
                    return;
                };

                if (senderIsGroupAdmin) {
                    const schoolIdFromData = toPositiveInt(data.school_id);
                    if (!schoolIdFromData) {
                        socket.emit("chat_error", { message: "school_id is required for group admin messages." });
                        return;
                    };

                    const hasAccess = await groupAdminCanAccessSchool(senderId, schoolIdFromData);
                    if (!hasAccess) {
                        socket.emit("chat_error", { message: "Access denied: you do not manage this branch." });
                        return;
                    };

                    const receiver = await isValidSchoolAdminForGroupAdmin(schoolIdFromData, receiverId);
                    if (!receiver) {
                        socket.emit("chat_error", { message: "Recipient is not an active school admin for this branch." });
                        return;
                    };

                    const result = await queryAsync(
                        `INSERT INTO chat_messages (school_id, sender_id, receiver_id, message, is_read)
                        VALUES (?, ?, ?, ?, 0)`,
                        [schoolIdFromData, senderId, receiverId, textValidation.message]
                    );

                    const insertId = result.insertId || result.id;
                    const messageData = {
                        id: insertId,
                        school_id: schoolIdFromData,
                        sender_id: senderId,
                        sender_name: getUserDisplayName(user),
                        sender_role: user.role,
                        receiver_id: receiverId,
                        receiver_role: receiver.role,
                        message: textValidation.message,
                        is_read: 0,
                        created_at: new Date().toISOString()
                    };

                    io.to(`user:${receiverId}`).emit("chat_message", messageData);
                    io.to(`user:${senderId}`).emit("chat_message", messageData);
                    io.to(`user:${receiverId}`).emit("chat_unread_notification", { sender_id: senderId });
                    await emitChatUnreadCount(receiverId, schoolIdFromData);
                    socket.emit("chat_message_sent", { success: true, message_id: insertId });
                    await notifyChatReceiver({
                        receiverId,
                        receiverRole: receiver.role,
                        schoolId: schoolIdFromData,
                        senderId,
                        senderName: messageData.sender_name,
                        senderRole: user.role,
                        message: textValidation.message
                    });
                    return;
                };

                if (senderIsSchoolAdmin) {
                    const gaRows = await queryAsync(
                        `SELECT u.id, u.role, u.first_name, u.last_name
                        FROM users u
                        JOIN group_admins ga ON u.id = ga.user_id
                        LEFT JOIN group_admin_schools gas ON ga.id = gas.group_admin_id AND gas.status = 'active'
                        LEFT JOIN schools s ON s.school_group_id = ga.school_group_id
                        WHERE u.id = ? AND (gas.school_id = ? OR s.id = ?)
                            AND u.status = 'active' AND u.role = 'group_admin' AND ga.status = 'active'
                        LIMIT 1`,
                        [receiverId, currentSchoolId, currentSchoolId]
                    );

                    if (gaRows.length > 0) {
                        const gaReceiver = gaRows[0];

                        const sender = await isValidChatPartner(currentSchoolId, senderId);
                        if (!sender || sender.role !== 'school_admin') {
                            socket.emit("chat_error", { message: "Your chat access is not available." });
                            return;
                        };

                        const result = await queryAsync(
                            `INSERT INTO chat_messages (school_id, sender_id, receiver_id, message, is_read)
                            VALUES (?, ?, ?, ?, 0)`,
                            [currentSchoolId, senderId, receiverId, textValidation.message]
                        );

                        const insertId = result.insertId || result.id;
                        const messageData = {
                            id: insertId,
                            school_id: currentSchoolId,
                            sender_id: senderId,
                            sender_name: getUserDisplayName(user),
                            sender_role: user.role,
                            receiver_id: receiverId,
                            receiver_role: gaReceiver.role,
                            message: textValidation.message,
                            is_read: 0,
                            created_at: new Date().toISOString()
                        };

                        io.to(`user:${receiverId}`).emit("chat_message", messageData);
                        io.to(`user:${senderId}`).emit("chat_message", messageData);
                        io.to(`user:${receiverId}`).emit("chat_unread_notification", { sender_id: senderId });
                        socket.emit("chat_message_sent", { success: true, message_id: insertId });
                        await notifyChatReceiver({
                            receiverId,
                            receiverRole: gaReceiver.role,
                            schoolId: currentSchoolId,
                            senderId,
                            senderName: messageData.sender_name,
                            senderRole: user.role,
                            message: textValidation.message
                        });
                        return;
                    };
                };

                const sender = await isValidChatPartner(currentSchoolId, senderId);
                if (!sender || sender.role !== user.role) {
                    socket.emit("chat_error", { message: "Your chat access is not available." });
                    return;
                };

                const receiver = await isValidChatPartner(currentSchoolId, receiverId);
                if (!receiver) {
                    socket.emit("chat_error", { message: "This contact is not available for chat." });
                    return;
                };

                const chatAllowed = await chatPermissionService.canChat(currentSchoolId, user.role, receiver.role);
                if (!chatAllowed) {
                    socket.emit("chat_error", { message: "Chat is not allowed for this role." });
                    return;
                };

                const result = await queryAsync(
                    `INSERT INTO chat_messages (school_id, sender_id, receiver_id, message, is_read)
                    VALUES (?, ?, ?, ?, 0)`,
                    [currentSchoolId, senderId, receiverId, textValidation.message]
                );

                const insertId = result.insertId || result.id;
                const messageData = {
                    id: insertId,
                    school_id: currentSchoolId,
                    sender_id: senderId,
                    sender_name: getUserDisplayName(user),
                    sender_role: user.role,
                    receiver_id: receiverId,
                    receiver_role: receiver.role,
                    message: textValidation.message,
                    is_read: 0,
                    created_at: new Date().toISOString()
                };

                io.to(`user:${receiverId}`).emit("chat_message", messageData);
                io.to(`user:${senderId}`).emit("chat_message", messageData);
                io.to(`user:${receiverId}`).emit("chat_unread_notification", { sender_id: senderId });

                await emitChatUnreadCount(receiverId, currentSchoolId);
                socket.emit("chat_message_sent", { success: true, message_id: insertId });
                await notifyChatReceiver({
                    receiverId,
                    receiverRole: receiver.role,
                    schoolId: currentSchoolId,
                    senderId,
                    senderName: messageData.sender_name,
                    senderRole: user.role,
                    message: textValidation.message
                });
            } catch (err) {
                console.error("Socket send_chat_message error:", err.message);
                socket.emit("chat_error", { message: "Failed to send message." });
            };
        });

        socket.on("typing_start", async (data = {}) => {
            try {
                const receiverId = toPositiveInt(data.receiver_id);
                const allowed = await canUseTypingEvent({
                    schoolId: toPositiveInt(user.school_id),
                    senderRole: user.role,
                    senderId: toPositiveInt(user.id),
                    receiverId
                });

                if (!allowed) return;

                io.to(`user:${receiverId}`).emit("user_typing", {
                    sender_id: userId,
                    sender_name: user.first_name || "Someone"
                });
            } catch (err) {
                console.error("typing_start error:", err.message);
            };
        });

        socket.on("typing_stop", async (data = {}) => {
            try {
                const receiverId = toPositiveInt(data.receiver_id);
                const allowed = await canUseTypingEvent({
                    schoolId: toPositiveInt(user.school_id),
                    senderRole: user.role,
                    senderId: toPositiveInt(user.id),
                    receiverId
                });

                if (!allowed) return;
                io.to(`user:${receiverId}`).emit("user_typing_stopped", {
                    sender_id: userId
                });
            } catch (err) {
                console.error("typing_stop error:", err.message);
            };
        });

        socket.on("get_online_users", () => {
            try {
                const currentSchoolId = toPositiveInt(user.school_id);
                if (!currentSchoolId) return;

                socket.emit("online_users_list", { userIds: getOnlineUserIds(currentSchoolId) });
            } catch (err) {
                console.error("get_online_users error:", err.message);
            };
        });

        socket.on("read_messages", async (data = {}) => {
            try {
                const currentSchoolId = toPositiveInt(user.school_id);
                const currentUserId = toPositiveInt(user.id);
                const senderId = toPositiveInt(data.sender_id);

                if (!currentUserId || !senderId) return;
                const isGA = user.role === 'group_admin';
                const isSA = user.role === 'school_admin';

                if (isGA) {
                    const rows = await queryAsync(
                        `SELECT cm.school_id FROM chat_messages cm
                        JOIN group_admins ga ON ga.user_id = ?
                        LEFT JOIN group_admin_schools gas ON ga.id = gas.group_admin_id AND gas.status = 'active'
                        LEFT JOIN schools s ON s.school_group_id = ga.school_group_id
                        WHERE cm.sender_id = ? AND cm.receiver_id = ? AND cm.is_read = 0
                            AND cm.deleted_at IS NULL AND ga.status = 'active'
                            AND (gas.school_id = cm.school_id OR s.id = cm.school_id)
                        LIMIT 1`,
                        [currentUserId, senderId, currentUserId]
                    );
                    if (rows.length === 0) return;

                    const resolvedSchoolId = rows[0].school_id;
                    await queryAsync(
                        `UPDATE chat_messages
                        SET is_read = 1
                        WHERE school_id = ? AND sender_id = ? AND receiver_id = ?
                            AND is_read = 0 AND deleted_at IS NULL`,
                        [resolvedSchoolId, senderId, currentUserId]
                    );
                    await emitChatUnreadCount(currentUserId, resolvedSchoolId);
                    io.to(`user:${senderId}`).emit("messages_read", { receiver_id: currentUserId });
                    return;
                };

                if (!chatPermissionService.isChatEnabledRole(user.role)) return;
                if (!currentSchoolId) return;

                if (isSA) {
                    const gaRows = await queryAsync(
                        `SELECT u.role FROM users u
                        JOIN group_admins ga ON u.id = ga.user_id
                        LEFT JOIN group_admin_schools gas ON ga.id = gas.group_admin_id AND gas.status = 'active'
                        LEFT JOIN schools s ON s.school_group_id = ga.school_group_id
                        WHERE u.id = ? AND (gas.school_id = ? OR s.id = ?)
                            AND u.status = 'active' AND u.role = 'group_admin' AND ga.status = 'active'
                        LIMIT 1`,
                        [senderId, currentSchoolId, currentSchoolId]
                    );
                    if (gaRows.length > 0) {
                        await queryAsync(
                            `UPDATE chat_messages
                            SET is_read = 1
                            WHERE school_id = ? AND sender_id = ? AND receiver_id = ?
                                AND is_read = 0 AND deleted_at IS NULL`,
                            [currentSchoolId, senderId, currentUserId]
                        );
                        await emitChatUnreadCount(currentUserId, currentSchoolId);
                        io.to(`user:${senderId}`).emit("messages_read", { receiver_id: currentUserId });
                        return;
                    };
                };

                const sender = await isValidChatPartner(currentSchoolId, senderId);
                if (!sender) return;

                const chatAllowed = await chatPermissionService.canChat(currentSchoolId, sender.role, user.role);
                if (!chatAllowed) return;

                await queryAsync(
                    `UPDATE chat_messages
                    SET is_read = 1
                    WHERE school_id = ?
                        AND sender_id = ?
                        AND receiver_id = ?
                        AND is_read = 0
                        AND deleted_at IS NULL`,
                    [currentSchoolId, senderId, currentUserId]
                );

                await emitChatUnreadCount(currentUserId, currentSchoolId);
                io.to(`user:${senderId}`).emit("messages_read", { receiver_id: currentUserId });
            } catch (err) {
                console.error("Socket read_messages error:", err.message);
            };
        });

        socket.on("join_trip", async (data = {}) => {
            try {
                const tripId = toPositiveInt(data.trip_id);
                if (!tripId) return;

                const allowed = await transportAuthorization.canJoinTripRoom({ user, tripId });
                if (!allowed) return;

                socket.join(`trip:${tripId}`);
                socket.emit("trip_joined", { trip_id: tripId });
            } catch (err) {
                console.error("join_trip error:", err.message);
            };
        });

        socket.on("join_school_trips", () => {
            const currentSchoolId = toPositiveInt(user.school_id);
            if (user.role === "school_admin" && currentSchoolId) {
                socket.join(`school:${currentSchoolId}:trips`);
                socket.emit("school_trips_joined", { school_id: currentSchoolId });
            };
        });

        socket.on("update_location", async (data = {}) => {
            if (user.role !== "driver") return;
            const currentSchoolId = toPositiveInt(user.school_id);
            const currentUserId = toPositiveInt(user.id);
            const requestedTripId = toPositiveInt(data.trip_id);
            const latitude = Number(data.latitude);
            const longitude = Number(data.longitude);

            if (!currentSchoolId || !currentUserId) return;
            if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return;
            if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return;

            try {
                const driverId = await getDriverIdForUser(currentUserId, currentSchoolId);
                if (!driverId) return;

                const trip = await getRunningDriverTrip({
                    requestedTripId,
                    schoolId: currentSchoolId,
                    driverId
                });

                if (!trip) return;
                const speed = toNullableNumber(data.speed) || 0;
                const heading = toNullableNumber(data.heading);
                const accuracy = toNullableNumber(data.accuracy);

                const gpsTrackingService = require("../services/gpsTrackingService");
                const etaEngineService = require("../services/etaEngineService");
                const geofenceEngineService = require("../services/geofenceEngineService");

                await gpsTrackingService.recordGpsUpdate({
                    tripId: trip.id,
                    schoolId: trip.school_id,
                    driverId: trip.driver_id,
                    latitude,
                    longitude,
                    speed,
                    heading,
                    driverName: data.driverName || getUserDisplayName(user),
                    vehicleNumber: trip.vehicleNumber || "",
                    routeName: trip.routeName || ""
                });

                const etaProgress = await etaEngineService.calculateTripProgressAndEta({
                    schoolId: trip.school_id,
                    tripId: trip.id,
                    routeId: trip.route_id,
                    busLat: latitude,
                    busLng: longitude,
                    speedKmh: speed
                }).catch(() => null);

                const stopArrivals = await geofenceEngineService.evaluateTripGeofence({
                    schoolId: trip.school_id,
                    tripId: trip.id,
                    routeId: trip.route_id,
                    driverId: trip.driver_id,
                    vehicleId: trip.vehicle_id,
                    busLat: latitude,
                    busLng: longitude,
                    speedKmh: speed
                }).catch(() => []);

                const locationData = {
                    trip_id: trip.id,
                    latitude,
                    longitude,
                    speed,
                    accuracy,
                    heading,
                    gps_status: 'online',
                    routeName: trip.routeName || "",
                    vehicleNumber: trip.vehicleNumber || "",
                    driverName: data.driverName || getUserDisplayName(user),
                    eta_progress: etaProgress || null,
                    stop_arrivals: stopArrivals || [],
                    timestamp: new Date().toISOString()
                };

                io.to(`trip:${trip.id}`).emit("location_updated", locationData);
                io.to(`school:${currentSchoolId}:trips`).emit("school_trip_location_updated", locationData);

                const cacheKey = `${trip.school_id}:${trip.id}`;
                const last = transportLocationWriteCache.get(cacheKey);
                const now = Date.now();
                const movedEnough = !last || Math.abs(last.latitude - latitude) > 0.00015 || Math.abs(last.longitude - longitude) > 0.00015;

                if (last && now - last.savedAt < 20000 && !movedEnough) return;
                await queryAsync(
                    `INSERT INTO transport_trip_locations
                    (school_id, trip_id, vehicle_id, driver_id, latitude, longitude, speed, heading, accuracy, recorded_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [ trip.school_id, trip.id, trip.vehicle_id || null, trip.driver_id || null, latitude, longitude, speed, heading, accuracy]
                );

                transportLocationWriteCache.set(cacheKey, { latitude, longitude, savedAt: now });
                checkProximityAndNotify(
                    trip.school_id,
                    trip.id,
                    latitude,
                    longitude,
                    data.trip_type || trip.trip_type || 'pickup'
                ).catch(() => {});
            } catch (err) {
                console.error("[Transport GPS Store]", err.message);
            };
        });

        socket.on("disconnect", () => {
            if (!schoolId) return;

            const becameOffline = removeOnlineSocket(schoolId, userId, socket.id);
            if (becameOffline) {
                socket.to(`school:${schoolId}`).emit("user_offline", { userId });
            };
        });
    });
    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized yet!");
    }
    return io;
};

module.exports = { initSocket, getIO };