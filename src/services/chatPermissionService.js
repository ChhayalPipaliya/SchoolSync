const db = require('../config/database');

const CHAT_ENABLED_ROLES = ['school_admin', 'teacher', 'driver', 'librarian'];
const GROUP_ADMIN_CHAT_ROLES = ['group_admin', 'school_admin'];

const isGroupAdminSchoolAdminPair = (roleA, roleB) => {
    const a = normalizeChatRole(roleA);
    const b = normalizeChatRole(roleB);
    return (
        (a === 'group_admin' && b === 'school_admin') ||
        (a === 'school_admin' && b === 'group_admin')
    );
};

const isGroupAdminChatAllowed = (role) => {
    const r = normalizeChatRole(role);
    return GROUP_ADMIN_CHAT_ROLES.includes(r);
};

const ROLE_LABELS = {
    school_admin: 'School Admin',
    teacher: 'Teacher',
    driver: 'Driver',
    librarian: 'Librarian'
};

const REQUIRED_ADMIN_ROLES = ['school_admin', 'teacher', 'driver', 'librarian'];

const normalizeChatRole = (role) => {
    const normalized = String(role || '').trim().toLowerCase().replace(/-/g, '_');
    if (normalized === 'schooladmin') return 'school_admin';
    if (normalized === 'library' || normalized === 'librarian') return 'librarian';
    return normalized;
};

const isChatEnabledRole = (role) => CHAT_ENABLED_ROLES.includes(normalizeChatRole(role));
const getDefaultPermissionForPair = (senderRole, receiverRole) => {
    const sender = normalizeChatRole(senderRole);
    const receiver = normalizeChatRole(receiverRole);

    if (sender === 'school_admin' && REQUIRED_ADMIN_ROLES.includes(receiver)) {
        return { is_allowed: 1, is_locked: 1 };
    };

    if (receiver === 'school_admin' && REQUIRED_ADMIN_ROLES.includes(sender)) {
        return { is_allowed: 1, is_locked: 1 };
    };

    if (sender === 'teacher' && receiver === 'teacher') {
        return { is_allowed: 1, is_locked: 0 };
    };

    if (sender === 'driver' && receiver === 'driver') {
        return { is_allowed: 1, is_locked: 0 };
    };

    return { is_allowed: 0, is_locked: 0 };
};

const getDefaultPermissionRows = (schoolId) => {
    const rows = [];

    for (const senderRole of CHAT_ENABLED_ROLES) {
        for (const receiverRole of CHAT_ENABLED_ROLES) {
            const defaults = getDefaultPermissionForPair(senderRole, receiverRole);
            rows.push({
                school_id: schoolId,
                sender_role: senderRole,
                receiver_role: receiverRole,
                is_allowed: defaults.is_allowed,
                is_locked: defaults.is_locked
            });
        };
    };
    return rows;
};

const ensureDefaultSchoolChatPermissions = async (schoolId) => {
    if (!schoolId) return;

    const defaultRows = getDefaultPermissionRows(schoolId);
    for (const row of defaultRows) {
        if (row.is_locked) {
            await db.queryAsync(
                `INSERT INTO school_chat_permissions
                (school_id, sender_role, receiver_role, is_allowed, is_locked)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    is_allowed = VALUES(is_allowed),
                    is_locked = VALUES(is_locked)`,
                [row.school_id, row.sender_role, row.receiver_role, row.is_allowed, row.is_locked]
            );
        } else {
            await db.queryAsync(
                `INSERT INTO school_chat_permissions
                (school_id, sender_role, receiver_role, is_allowed, is_locked)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    is_locked = VALUES(is_locked)`,
                [row.school_id, row.sender_role, row.receiver_role, row.is_allowed, row.is_locked]
            );
        };
    };
};

const getSchoolChatPermissions = async (schoolId) => {
    await ensureDefaultSchoolChatPermissions(schoolId);

    const rows = await db.queryAsync(
        `SELECT id, school_id, sender_role, receiver_role, is_allowed, is_locked
        FROM school_chat_permissions
        WHERE school_id = ?
           AND sender_role IN (?, ?, ?, ?)
           AND receiver_role IN (?, ?, ?, ?)
        ORDER BY FIELD(sender_role, 'school_admin', 'teacher', 'driver', 'librarian'),
            FIELD(receiver_role, 'school_admin', 'teacher', 'driver', 'librarian')`,
        [schoolId, ...CHAT_ENABLED_ROLES, ...CHAT_ENABLED_ROLES]
    );

    return rows.map(row => ({
        ...row,
        is_allowed: Number(row.is_allowed) === 1,
        is_locked: Number(row.is_locked) === 1,
        key: `${row.sender_role}:${row.receiver_role}`,
        sender_label: ROLE_LABELS[row.sender_role] || row.sender_role,
        receiver_label: ROLE_LABELS[row.receiver_role] || row.receiver_role
    }));
};

const getSchoolChatPermissionMatrix = async (schoolId) => {
    const permissions = await getSchoolChatPermissions(schoolId);
    const permissionMap = {};

    for (const permission of permissions) {
        permissionMap[permission.key] = permission;
    };

    return {
        roles: CHAT_ENABLED_ROLES,
        roleLabels: ROLE_LABELS,
        permissions,
        permissionMap
    };
};

const updateSchoolChatPermissions = async (schoolId, allowedPairs = [], updatedBy = null) => {
    await ensureDefaultSchoolChatPermissions(schoolId);

    const allowedPairSet = new Set(Array.isArray(allowedPairs) ? allowedPairs : [allowedPairs]);
    const permissions = await getSchoolChatPermissions(schoolId);

    for (const permission of permissions) {
        if (permission.is_locked) {
            continue;
        };

        const isAllowed = allowedPairSet.has(permission.key) ? 1 : 0;
        await db.queryAsync(
            `UPDATE school_chat_permissions
            SET is_allowed = ?, updated_by = ?, updated_at = NOW()
            WHERE school_id = ?
                AND sender_role = ?
                AND receiver_role = ?
                AND is_locked = 0`,
            [isAllowed, updatedBy, schoolId, permission.sender_role, permission.receiver_role]
        );
    };
};

const getAllowedChatRoles = async (schoolId, senderRole) => {
    const normalizedSenderRole = normalizeChatRole(senderRole);

    if (!isChatEnabledRole(normalizedSenderRole)) {
        return [];
    };

    await ensureDefaultSchoolChatPermissions(schoolId);
    const rows = await db.queryAsync(
        `SELECT receiver_role
        FROM school_chat_permissions
        WHERE school_id = ?
            AND sender_role = ?
            AND receiver_role IN (?, ?, ?, ?)
            AND is_allowed = 1`,
        [schoolId, normalizedSenderRole, ...CHAT_ENABLED_ROLES]
    );

    return rows.map(row => row.receiver_role).filter(isChatEnabledRole);
};

const canChat = async (schoolId, senderRole, receiverRole) => {
    const normalizedSenderRole = normalizeChatRole(senderRole);
    const normalizedReceiverRole = normalizeChatRole(receiverRole);

    if (!schoolId || !isChatEnabledRole(normalizedSenderRole) || !isChatEnabledRole(normalizedReceiverRole)) {
        return false;
    };

    await ensureDefaultSchoolChatPermissions(schoolId);
    const rows = await db.queryAsync(
        `SELECT is_allowed
        FROM school_chat_permissions
        WHERE school_id = ?
            AND sender_role = ?
            AND receiver_role = ?
        LIMIT 1`,
        [schoolId, normalizedSenderRole, normalizedReceiverRole]
    );

    return Number(rows[0]?.is_allowed || 0) === 1;
};

module.exports = { CHAT_ENABLED_ROLES, GROUP_ADMIN_CHAT_ROLES, ROLE_LABELS, normalizeChatRole, isChatEnabledRole, isGroupAdminSchoolAdminPair, isGroupAdminChatAllowed, getAllowedChatRoles, canChat, ensureDefaultSchoolChatPermissions, getSchoolChatPermissions, getSchoolChatPermissionMatrix, updateSchoolChatPermissions };