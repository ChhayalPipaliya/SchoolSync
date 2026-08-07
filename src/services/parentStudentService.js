const toPositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const createParentStudentService = (database) => {
    if (!database || typeof database.query !== 'function') {
        throw new TypeError('A database query interface is required.');
    };

    const getLinkedChildren = async ({ parentUserId, schoolId }) => {
        const normalizedParentUserId = toPositiveInt(parentUserId);
        const normalizedSchoolId = toPositiveInt(schoolId);
        if (!normalizedParentUserId || !normalizedSchoolId) return [];

        const [rows] = await database.query(
            `SELECT s.*, u.first_name, u.last_name, u.image, c.class_name, c.section,
                sf.father_name, sf.mother_name, sf.guardian_name
            FROM student_family sf
            JOIN students s
                ON s.id = sf.student_id
                AND s.school_id = sf.school_id
            JOIN users u
                ON u.id = s.user_id
                AND u.school_id = s.school_id
            LEFT JOIN classes c
                ON c.id = s.class_id
                AND c.school_id = s.school_id
            WHERE sf.parent_user_id = ?
                AND sf.school_id = ?
                AND s.parent_portal_enabled = 1
                AND s.status = 'active'
                AND s.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name, s.id`,
            [normalizedParentUserId, normalizedSchoolId]
        );
        return rows;
    };

    const canAccessStudent = async ({ parentUserId, schoolId, studentId }) => {
        const normalizedParentUserId = toPositiveInt(parentUserId);
        const normalizedSchoolId = toPositiveInt(schoolId);
        const normalizedStudentId = toPositiveInt(studentId);
        if (!normalizedParentUserId || !normalizedSchoolId || !normalizedStudentId) return false;

        const [rows] = await database.query(
            `SELECT s.id
            FROM student_family sf
            JOIN students s
                ON s.id = sf.student_id
                AND s.school_id = sf.school_id
            WHERE sf.parent_user_id = ?
                AND sf.school_id = ?
                AND s.id = ?
                AND s.parent_portal_enabled = 1
                AND s.status = 'active'
                AND s.deleted_at IS NULL
            LIMIT 1`,
            [normalizedParentUserId, normalizedSchoolId, normalizedStudentId]
        );
        return rows.length > 0;
    };

    return { canAccessStudent, getLinkedChildren };
};

let defaultService;
const getDefaultService = () => {
    if (!defaultService) {
        defaultService = createParentStudentService(require('../config/database'));
    };
    return defaultService;
};

module.exports = {
    canAccessStudent: (...args) => getDefaultService().canAccessStudent(...args),
    getLinkedChildren: (...args) => getDefaultService().getLinkedChildren(...args),
    createParentStudentService,
    toPositiveInt
};