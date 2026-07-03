const { executeAsync } = require("../config/database");

const logSchoolActivity = async (req, { action, entityType, entityId, oldValues, newValues, description }) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id || null;
        const actorId = req.user?.id || req.session?.user?.id || null;
        const actorRole = req.user?.role || req.session?.user?.role || "system";
        const ipAddress = req.ip || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || null;

        if (!schoolId && actorRole !== 'super_admin') return;

        await executeAsync(`
            INSERT INTO school_activity_logs 
                (school_id, actor_id, actor_role, action, entity_type, entity_id, old_values, new_values, description, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            schoolId,
            actorId,
            actorRole,
            action,
            entityType,
            entityId ? parseInt(entityId) : null,
            oldValues ? JSON.stringify(oldValues) : null,
            newValues ? JSON.stringify(newValues) : null,
            description,
            ipAddress
        ]);
    } catch (err) {
        console.error("[AuditLogger-Error] Failed to log school activity:", err.message);
    }
};

module.exports = { logSchoolActivity };
