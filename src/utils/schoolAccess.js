const { queryAsync } = require("../config/database");

async function getAccessibleSchoolIds(user) {
    if (!user) return [];

    if (user.role === "super_admin") {
        return null;
    };

    if (user.role === "group_admin") {
        const rows = await queryAsync(
            `SELECT gas.school_id
            FROM group_admin_schools gas
            JOIN group_admins ga ON ga.id = gas.group_admin_id
            WHERE ga.user_id = ?
                AND ga.status = 'active'
                AND gas.status = 'active'`,
            [user.id]
        );
        return rows.map((row) => row.school_id);
    };

    if (user.school_id) {
        return [user.school_id];
    };
    return [];
};

async function canAccessSchool(user, schoolId) {
    if (!user || !schoolId) return false;
    if (user.role === "super_admin") return true;

    if (user.role === "school_admin") {
        return Number(user.school_id) === Number(schoolId);
    };

    if (user.role === "group_admin") {
        const rows = await queryAsync(
            `SELECT gas.id
            FROM group_admin_schools gas
            JOIN group_admins ga ON ga.id = gas.group_admin_id
            WHERE ga.user_id = ?
                AND gas.school_id = ?
                AND ga.status = 'active'
                AND gas.status = 'active'
            LIMIT 1`,
            [user.id, schoolId]
        );
        return rows.length > 0;
    };

    return Number(user.school_id) === Number(schoolId);
};

function buildSchoolFilter(schoolIds, alias = "") {
    if (schoolIds === null) {
        return { sql: "", params: [] };
    };
    if (!schoolIds || schoolIds.length === 0) {
        return { sql: " AND 1 = 0 ", params: [] };
    };
    const prefix = alias ? `${alias}.` : "";
    return {
        sql: ` AND ${prefix}school_id IN (${schoolIds.map(() => "?").join(",")})`,
        params: schoolIds,
    };
};

module.exports = { getAccessibleSchoolIds, canAccessSchool, buildSchoolFilter };