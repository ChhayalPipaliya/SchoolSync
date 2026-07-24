const { queryAsync } = require("../config/database");

const ROLE_TABLE_MAP = {
    school_admin: { table: "users", column: "id" },
    teacher: { table: "teachers", column: "user_id" },
    student: { table: "students", column: "user_id" },
    librarian: { table: "librarians", column: "user_id" },
    driver: { table: "drivers", column: "user_id" },
    parent: { table: "student_family", column: "parent_user_id" },
    group_admin: { table: "group_admins", column: "user_id" }
};

const resolveUserSchoolId = async (user) => {
    if (user.school_id) return user.school_id;

    const config = ROLE_TABLE_MAP[user.role];
    if (!config) return null;

    if (user.role === "group_admin" || user.role === "super_admin") {
        return null;
    };

    let sql;
    const params = [user.id];

    if (config.table === "users") {
        sql = `SELECT school_id FROM users WHERE id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY id DESC LIMIT 1`;
    } else {
        sql = `SELECT d.school_id FROM ${config.table} d
               JOIN users u ON d.${config.column} = u.id
               WHERE d.${config.column} = ? AND u.deleted_at IS NULL AND u.status = 'active'
               ORDER BY d.id DESC LIMIT 1`;
    };

    const rows = await queryAsync(sql, params);
    return rows[0]?.school_id || null;
};

module.exports = { resolveUserSchoolId, ROLE_TABLE_MAP };
