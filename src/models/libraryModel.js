const { queryAsync } = require("../config/database");
const rows = (sql, params = []) => queryAsync(sql, params);

const one = async (sql, params = []) => {
    const result = await rows(sql, params);
    return result[0] || null;
};

exports.getSettings = async (schoolId) => {
    const existing = await one("SELECT * FROM library_settings WHERE school_id=? LIMIT 1", [schoolId]);
    if (existing) {
        return existing;
    };

    await rows("INSERT INTO library_settings (school_id) VALUES (?)", [schoolId]);
    return one("SELECT * FROM library_settings WHERE school_id=? LIMIT 1", [schoolId]);
};

exports.updateSettings = (schoolId, data, actorId) => rows(`
    INSERT INTO library_settings
        (school_id, student_issue_limit, teacher_issue_limit, default_due_days,
        renewal_days, max_renewals, fine_per_day, lost_book_charge_mode,
        fixed_lost_book_charge, due_reminder_days, created_by, updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
        student_issue_limit=VALUES(student_issue_limit),
        teacher_issue_limit=VALUES(teacher_issue_limit),
        default_due_days=VALUES(default_due_days),
        renewal_days=VALUES(renewal_days),
        max_renewals=VALUES(max_renewals),
        fine_per_day=VALUES(fine_per_day),
        lost_book_charge_mode=VALUES(lost_book_charge_mode),
        fixed_lost_book_charge=VALUES(fixed_lost_book_charge),
        due_reminder_days=VALUES(due_reminder_days),
        updated_by=VALUES(updated_by)
`, [schoolId, data.student_issue_limit, data.teacher_issue_limit, data.default_due_days, data.renewal_days, data.max_renewals, data.fine_per_day, data.lost_book_charge_mode, data.fixed_lost_book_charge, data.due_reminder_days, actorId, actorId]);

exports.logActivity = (query, { schoolId, actorId, action, entityType, entityId, metadata, req }) => query(`
    INSERT INTO library_activity_logs
        (school_id, actor_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
    VALUES (?,?,?,?,?,?,?,?)
`, [ schoolId, actorId || null, action, entityType, entityId || null, metadata ? JSON.stringify(metadata) : null, req?.ip || null, req?.headers?.["user-agent"] || null]);

exports.listCategories = (schoolId) => rows(
    "SELECT * FROM library_categories WHERE school_id=? ORDER BY status ASC, type ASC, name ASC",
    [schoolId]
);

exports.listActiveCategories = (schoolId) => rows(
    "SELECT * FROM library_categories WHERE school_id=? AND status='active' ORDER BY name ASC",
    [schoolId]
);

exports.listRacks = (schoolId) => rows(
    "SELECT * FROM library_racks WHERE school_id=? ORDER BY rack_number ASC, shelf_number ASC",
    [schoolId]
);

exports.listActiveRacks = (schoolId) => rows(
    "SELECT * FROM library_racks WHERE school_id=? AND status='active' ORDER BY rack_number ASC, shelf_number ASC",
    [schoolId]
);

exports.getBook = (id, schoolId) => one("SELECT * FROM library_books WHERE id=? AND school_id=? LIMIT 1", [id, schoolId]);
exports.getIssue = (id, schoolId) => one("SELECT * FROM library_issues WHERE id=? AND school_id=? LIMIT 1", [id, schoolId]);
exports.findMember = (userId, schoolId) => one(`
    SELECT lm.*, u.role, u.first_name AS first_name, u.last_name AS last_name
    FROM library_members lm
    JOIN users u ON u.id = lm.user_id
    WHERE lm.user_id=? AND lm.school_id=? AND lm.status='active'
    LIMIT 1
`, [userId, schoolId]);

exports.listMembers = (schoolId, filters = {}) => {
    const args = [schoolId];
    let sql = `
        SELECT lm.*, u.first_name AS first_name, u.last_name AS last_name, u.email, u.role, u.phone
        FROM library_members lm
        JOIN users u ON u.id = lm.user_id
        WHERE lm.school_id=?
    `;

    if (filters.type) {
        sql += " AND lm.member_type=?";
        args.push(filters.type);
    };

    if (filters.search) {
        sql += " AND (lm.library_id LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)";
        const s = `%${filters.search}%`;
        args.push(s, s, s, s);
    };

    sql += " ORDER BY lm.member_type ASC, u.first_name ASC";
    return rows(sql, args);
};