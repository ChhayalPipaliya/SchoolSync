const { queryAsync, executeAsync } = require("../config/database");

const DEFAULT_CATEGORIES = ["academic", "fee", "transport", "library", "general", "system"];
const PREFERENCE_ROLES = new Set(["super_admin", "school_admin", "teacher", "student", "driver", "librarian", "parent"]);

const toBoolean = (value, fallback = true) => {
    if (typeof value === "undefined" || value === null) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
        return ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
    };
    return fallback;
};

const normalizeCategories = (categories) => {
    const incoming = Array.isArray(categories) ? categories : [];
    const allowed = incoming.filter(category => DEFAULT_CATEGORIES.includes(category));
    return allowed.length > 0 ? allowed : DEFAULT_CATEGORIES;
};

const NotificationPreferenceModel = {
    async getByUserIdAndRole(userId, role) {
        if (!PREFERENCE_ROLES.has(role)) {
            return null;
        };

        const sql = `
            SELECT * FROM notification_preferences 
            WHERE user_id = ? AND role = ? 
            LIMIT 1
        `;
        const rows = await queryAsync(sql, [userId, role]);
        if (rows.length === 0) {
            return null;
        };

        const pref = rows[0];
        try {
            if (typeof pref.categories_enabled === "string") {
                pref.categories_enabled = JSON.parse(pref.categories_enabled);
            };
            if (!Array.isArray(pref.categories_enabled)) {
                pref.categories_enabled = DEFAULT_CATEGORIES;
            };
        } catch (e) {
            pref.categories_enabled = DEFAULT_CATEGORIES;
        };
        return pref;
    },

    async upsert(userId, role, data) {
        if (!PREFERENCE_ROLES.has(role)) {
            return false;
        };

        const categories = normalizeCategories(data.categories_enabled);
        const sql = `
            INSERT INTO notification_preferences 
            (user_id, role, email_notifications, push_notifications, sms_notifications, categories_enabled)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                email_notifications = VALUES(email_notifications),
                push_notifications = VALUES(push_notifications),
                sms_notifications = VALUES(sms_notifications),
                categories_enabled = VALUES(categories_enabled)
        `;
        const params = [ userId, role, toBoolean(data.email_notifications, true), toBoolean(data.push_notifications, true), toBoolean(data.sms_notifications, false), JSON.stringify(categories)];
        const result = await executeAsync(sql, params);
        return result.affectedRows > 0;
    }
};

NotificationPreferenceModel.DEFAULT_CATEGORIES = DEFAULT_CATEGORIES;
NotificationPreferenceModel.PREFERENCE_ROLES = PREFERENCE_ROLES;
module.exports = NotificationPreferenceModel;