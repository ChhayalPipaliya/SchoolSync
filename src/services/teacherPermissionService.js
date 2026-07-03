const db = require('../config/database');

const ACTIVE_ASSIGNMENT = "COALESCE(tca.status, 'active') = 'active'";

const normalizeOptionalId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

const getTeacherByUserId = async (userId, schoolId) => {
    const [rows] = await db.execute(
        `SELECT t.*, u.id AS user_id, u.first_name, u.last_name, u.email
         FROM teachers t
         JOIN users u ON u.id = t.user_id
         WHERE t.user_id = ? AND t.school_id = ? AND u.deleted_at IS NULL
         LIMIT 1`,
        [userId, schoolId]
    );
    return rows[0] || null;
};

const getTeacherByUserOrFail = async (userId, schoolId) => {
    const teacher = await getTeacherByUserId(userId, schoolId);
    if (!teacher) {
        const err = new Error('Teacher profile not found. Please contact administration.');
        err.status = 403;
        throw err;
    }
    return teacher;
};

const checkTeacherClassAccess = async (teacherId, schoolId, classId, subjectId = null, options = {}) => {
    const { allowGeneralSubject = true } = options;
    const normalizedSubjectId = normalizeOptionalId(subjectId);
    const params = [teacherId, schoolId, classId];
    let subjectClause = '';

    if (normalizedSubjectId) {
        subjectClause = allowGeneralSubject ? 'AND (tca.subject_id = ? OR tca.subject_id IS NULL)' : 'AND tca.subject_id = ?';
        params.push(normalizedSubjectId);
    }

    const [rows] = await db.execute(
        `SELECT tca.id
         FROM teacher_class_assign tca
         JOIN classes c ON c.id = tca.class_id AND c.school_id = tca.school_id
         WHERE tca.teacher_id = ?
           AND tca.school_id = ?
           AND tca.class_id = ?
           AND ${ACTIVE_ASSIGNMENT}
           ${subjectClause}
         LIMIT 1`,
        params
    );

    return rows.length > 0;
};

const assertTeacherClassAccess = async (teacherId, schoolId, classId, subjectId = null) => {
    const hasAccess = await checkTeacherClassAccess(teacherId, schoolId, classId, subjectId);
    if (!hasAccess) {
        const err = new Error('You are not assigned to this class.');
        err.status = 403;
        throw err;
    }
    return true;
};

const getAssignedClassesForTeacher = async (teacherId, schoolId) => {
    const [rows] = await db.execute(
        `SELECT c.id, c.class_name, c.class_name AS name, c.section, c.section AS section_name,
                c.medium, c.academic_year,
                GROUP_CONCAT(DISTINCT s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_name,
                GROUP_CONCAT(DISTINCT s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject,
                (
                    SELECT COUNT(*)
                    FROM students st
                    WHERE st.class_id = c.id
                      AND st.school_id = c.school_id
                      AND st.status = 'active'
                      AND st.deleted_at IS NULL
                ) AS studentCount
         FROM teacher_class_assign tca
         JOIN classes c ON c.id = tca.class_id AND c.school_id = tca.school_id
         LEFT JOIN subjects s ON s.id = tca.subject_id AND s.school_id = tca.school_id
         WHERE tca.teacher_id = ?
           AND tca.school_id = ?
           AND ${ACTIVE_ASSIGNMENT}
         GROUP BY c.id, c.class_name, c.section, c.medium, c.academic_year, c.school_id
         ORDER BY c.class_name, c.section`,
        [teacherId, schoolId]
    );
    return rows;
};

const getTeacherTimetable = async (teacherUserId, schoolId, options = {}) => {
    const { dayOfWeek = null } = options;
    const params = [teacherUserId, schoolId];
    let dayClause = '';
    if (dayOfWeek) {
        dayClause = 'AND t.day_of_week = ?';
        params.push(dayOfWeek);
    }

    const [rows] = await db.query(
        `SELECT t.*, ps.label, ps.start_time, ps.end_time, ps.is_break,
                s.subject_name,
                c.class_name, c.section AS section_name, c.medium, c.academic_year,
                (
                    SELECT COUNT(*)
                    FROM students st
                    WHERE st.class_id = c.id
                      AND st.school_id = c.school_id
                      AND st.status = 'active'
                      AND st.deleted_at IS NULL
                ) AS studentCount
         FROM timetables t
         JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
         JOIN teachers teacher ON teacher.user_id = t.teacher_id AND teacher.school_id = t.school_id
         JOIN teacher_class_assign tca
              ON tca.teacher_id = teacher.id
             AND tca.school_id = t.school_id
             AND tca.class_id = t.class_id
             AND tca.subject_id = t.subject_id
             AND ${ACTIVE_ASSIGNMENT}
         LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
         LEFT JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
         WHERE t.teacher_id = ?
           AND t.school_id = ?
           ${dayClause}
         ORDER BY FIELD(t.day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
                  ps.sort_order, ps.period_number`,
        params
    );

    return rows;
};

const validateTeacherTimetableConflict = async ({
    schoolId,
    teacherUserId,
    classId,
    subjectId,
    dayOfWeek,
    periodSlotId,
    excludeTimetableId = null
}) => {
    const errors = [];

    const [classConflict] = await db.query(
        `SELECT t.id, s.subject_name
         FROM timetables t
         LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
         WHERE t.school_id = ?
           AND t.class_id = ?
           AND t.day_of_week = ?
           AND t.period_slot_id = ?
           ${excludeTimetableId ? 'AND t.id != ?' : ''}
         LIMIT 1`,
        excludeTimetableId
            ? [schoolId, classId, dayOfWeek, periodSlotId, excludeTimetableId]
            : [schoolId, classId, dayOfWeek, periodSlotId]
    );
    if (classConflict.length > 0) {
        errors.push('This class already has a subject in the selected period.');
    }

    if (teacherUserId) {
        const [[teacher]] = await db.query(
            'SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1',
            [teacherUserId, schoolId]
        );

        if (!teacher) {
            errors.push('Selected teacher does not belong to this school.');
        } else {
            const hasAssignment = await checkTeacherClassAccess(teacher.id, schoolId, classId, subjectId, { allowGeneralSubject: false });
            if (!hasAssignment) {
                errors.push('Selected teacher is not assigned to this class and subject.');
            }
        }

        const [teacherConflict] = await db.query(
            `SELECT t.id, c.class_name, c.section
             FROM timetables t
             JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
             WHERE t.school_id = ?
               AND t.teacher_id = ?
               AND t.day_of_week = ?
               AND t.period_slot_id = ?
               ${excludeTimetableId ? 'AND t.id != ?' : ''}
             LIMIT 1`,
            excludeTimetableId
                ? [schoolId, teacherUserId, dayOfWeek, periodSlotId, excludeTimetableId]
                : [schoolId, teacherUserId, dayOfWeek, periodSlotId]
        );
        if (teacherConflict.length > 0) {
            const conf = teacherConflict[0];
            errors.push(`Teacher is already assigned to Class ${conf.class_name}-${conf.section} at this time.`);
        }
    }

    return {
        ok: errors.length === 0,
        errors
    };
};

module.exports = {
    checkTeacherClassAccess,
    assertTeacherClassAccess,
    getAssignedClassesForTeacher,
    getTeacherByUserId,
    getTeacherByUserOrFail,
    getTeacherTimetable,
    validateTeacherTimetableConflict
};
