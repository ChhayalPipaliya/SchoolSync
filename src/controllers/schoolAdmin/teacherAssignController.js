const db = require('../../config/database');

const normalizeOptionalId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

const validateAssignmentPayload = async ({ schoolId, teacherId, classId, subjectId, excludeId = null }) => {
    if (!teacherId || !classId) {
        return 'Teacher and class are required';
    }

    const [[teacher]] = await db.query(
        'SELECT id FROM teachers WHERE id = ? AND school_id = ? LIMIT 1',
        [teacherId, schoolId]
    );
    if (!teacher) return 'Invalid teacher selected';

    const [[cls]] = await db.query(
        'SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
        [classId, schoolId]
    );
    if (!cls) return 'Invalid class selected';

    if (subjectId) {
        const [[subject]] = await db.query(
            "SELECT id FROM subjects WHERE id = ? AND school_id = ? AND status = 'active' LIMIT 1",
            [subjectId, schoolId]
        );
        if (!subject) return 'Invalid subject selected';
    }

    const duplicateParams = [schoolId, teacherId, classId, subjectId, subjectId];
    let duplicateSql = `
        SELECT id
        FROM teacher_class_assign
        WHERE school_id = ?
            AND teacher_id = ?
            AND class_id = ?
            AND (subject_id = ? OR (subject_id IS NULL AND ? IS NULL))
    `;
    if (excludeId) {
        duplicateSql += ' AND id != ?';
        duplicateParams.push(excludeId);
    };
    duplicateSql += ' LIMIT 1';

    const [[duplicate]] = await db.query(duplicateSql, duplicateParams);
    if (duplicate) return 'This teacher is already assigned to that class and subject';
    return null;
};

exports.listAssignments = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { teacher_id, class_id, subject_id } = req.query;
        const [teachers] = await db.query(
            `SELECT t.id, u.first_name AS first_name, u.last_name AS last_name
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            WHERE t.school_id = ? AND u.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name`,
            [schoolId]
        );

        const [classes] = await db.query(
            'SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name ASC, section ASC',
            [schoolId]
        );

        const [subjects] = await db.query(
            'SELECT id, subject_name FROM subjects WHERE school_id = ? ORDER BY subject_name ASC',
            [schoolId]
        );

        let sql = `
            SELECT tca.id, tca.created_at, tca.is_primary,
                u.first_name AS first_name, u.last_name AS last_name,
                c.class_name, c.section,
                s.subject_name,
                t.id AS teacher_id, c.id AS class_id, s.id AS subject_id
            FROM teacher_class_assign tca
            JOIN teachers t ON tca.teacher_id = t.id
            JOIN users u ON t.user_id = u.id
            JOIN classes c ON tca.class_id = c.id
            LEFT JOIN subjects s ON tca.subject_id = s.id
            WHERE tca.school_id = ? AND t.school_id = ? AND u.deleted_at IS NULL
        `;
        const params = [schoolId, schoolId];

        if (teacher_id) { sql += ' AND tca.teacher_id = ?'; params.push(teacher_id); }
        if (class_id) { sql += ' AND tca.class_id = ?'; params.push(class_id); }
        if (subject_id) { sql += ' AND tca.subject_id = ?'; params.push(subject_id); }

        sql += ' ORDER BY tca.created_at DESC';
        const [assignments] = await db.query(sql, params);
        res.render('schoolAdmin/teachers/assignments', {
            title: 'Class Assignments',
            assignments,
            teachers,
            classes,
            subjects,
            filters: req.query,
            currentPath: '/schooladmin/teachers'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load assignments');
        res.redirect('/schooladmin/teachers');
    };
};

exports.assignForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [teachers] = await db.query(
            `SELECT t.id, u.first_name AS first_name, u.last_name AS last_name
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            WHERE t.school_id = ? AND u.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name`,
            [schoolId]
        );

        const [classes] = await db.query(
            'SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name ASC, section ASC',
            [schoolId]
        );

        const [subjects] = await db.query(
            'SELECT id, subject_name FROM subjects WHERE school_id = ? ORDER BY subject_name ASC',
            [schoolId]
        );

        let editAssignment = null;
        if (req.query.edit) {
            const [[existing]] = await db.query(
                `SELECT tca.*, t.id AS teacher_id
                FROM teacher_class_assign tca
                JOIN teachers t ON tca.teacher_id = t.id
                WHERE tca.id = ? AND t.school_id = ? LIMIT 1`,
                [req.query.edit, schoolId]
            );
            editAssignment = existing || null;
        };

        res.render('schoolAdmin/teachers/assign', {
            title: editAssignment ? 'Edit Assignment' : 'Assign Teacher',
            teachers,
            classes,
            subjects,
            editAssignment,
            currentPath: '/schooladmin/teachers'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load form');
        res.redirect('/schooladmin/teachers/assignments');
    };
};


exports.createAssignment = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { teacher_id, class_id, subject_id, is_primary } = req.body;
        const subjectVal = normalizeOptionalId(subject_id);
        const validationError = await validateAssignmentPayload({
            schoolId,
            teacherId: teacher_id,
            classId: class_id,
            subjectId: subjectVal
        });

        if (validationError) {
            req.flash('error', validationError);
            return res.redirect('/schooladmin/teachers/assign');
        };

        const [[classMeta]] = await db.query(
            'SELECT medium, academic_year FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [class_id, schoolId]
        );

        await db.query(
            `INSERT INTO teacher_class_assign
            (school_id, teacher_id, class_id, subject_id, medium, academic_year, status, assigned_by, is_primary)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            [ schoolId, teacher_id, class_id, subjectVal, classMeta?.medium || null, classMeta?.academic_year || null, req.session.user.id, is_primary === 'on' ? 1 : 0 ]
        );

        req.flash('success', 'Teacher assigned successfully');
        res.redirect('/schooladmin/teachers/assignments');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to create assignment: ' + err.message);
        res.redirect('/schooladmin/teachers/assign');
    };
};

exports.updateAssignment = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const { teacher_id, class_id, subject_id, is_primary } = req.body;

        const [[existing]] = await db.query(
            `SELECT tca.id FROM teacher_class_assign tca
            JOIN teachers t ON tca.teacher_id = t.id
            WHERE tca.id = ? AND t.school_id = ? LIMIT 1`,
            [id, schoolId]
        );

        if (!existing) {
            req.flash('error', 'Assignment not found');
            return res.redirect('/schooladmin/teachers/assignments');
        };

        const subjectVal = normalizeOptionalId(subject_id);
        const validationError = await validateAssignmentPayload({
            schoolId,
            teacherId: teacher_id,
            classId: class_id,
            subjectId: subjectVal,
            excludeId: id
        });
        if (validationError) {
            req.flash('error', validationError);
            return res.redirect(`/schooladmin/teachers/assign?edit=${id}`);
        };

        const [[classMeta]] = await db.query(
            'SELECT medium, academic_year FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [class_id, schoolId]
        );

        await db.query(
            `UPDATE teacher_class_assign
            SET teacher_id = ?, class_id = ?, subject_id = ?, medium = ?, academic_year = ?, is_primary = ?
            WHERE id = ?`,
            [ teacher_id, class_id, subjectVal, classMeta?.medium || null, classMeta?.academic_year || null, is_primary === 'on' ? 1 : 0, id]
        );
        req.flash('success', 'Assignment updated successfully');
        res.redirect('/schooladmin/teachers/assignments');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update assignment');
        res.redirect('/schooladmin/teachers/assignments');
    };
};

exports.deleteAssignment = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        const [[existing]] = await db.query(
            `SELECT tca.id FROM teacher_class_assign tca
            JOIN teachers t ON tca.teacher_id = t.id
            WHERE tca.id = ? AND t.school_id = ? LIMIT 1`,
            [id, schoolId]
        );
        if (!existing) {
            req.flash('error', 'Assignment not found');
            return res.redirect('/schooladmin/teachers/assignments');
        };

        await db.query('DELETE FROM teacher_class_assign WHERE id = ?', [id]);
        req.flash('success', 'Assignment removed successfully');
        res.redirect('/schooladmin/teachers/assignments');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete assignment');
        res.redirect('/schooladmin/teachers/assignments');
    };
};

exports.byClass = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { classId } = req.params;
        const [[cls]] = await db.query(
            'SELECT id, class_name, section FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [classId, schoolId]
        );
        if (!cls) {
            req.flash('error', 'Class not found');
            return res.redirect('/schooladmin/teachers/assignments');
        }

        const [teachers] = await db.query(
            `SELECT tca.id AS assignment_id, tca.is_primary, tca.created_at,
                u.first_name AS first_name, u.last_name AS last_name, u.email, u.image,
                s.subject_name,
                t.id AS teacher_id, t.qualification, t.experience
            FROM teacher_class_assign tca
            JOIN teachers t ON tca.teacher_id = t.id
            JOIN users u ON t.user_id = u.id
            LEFT JOIN subjects s ON tca.subject_id = s.id
            WHERE tca.class_id = ? AND t.school_id = ? AND u.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name`,
            [classId, schoolId]
        );

        const [allClasses] = await db.query(
            'SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name ASC, section ASC',
            [schoolId]
        );

        res.render('schoolAdmin/teachers/byClass', {
            title: `Class ${cls.class_name}-${cls.section} Teachers`,
            cls,
            teachers,
            allClasses,
            currentPath: '/schooladmin/teachers'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load class teachers');
        res.redirect('/schooladmin/teachers/assignments');
    };
};

exports.teacherClasses = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { teacherId } = req.params;

        const [[teacher]] = await db.query(
            `SELECT t.id, t.qualification, t.experience, u.first_name AS first_name, u.last_name AS last_name, u.email, u.image
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            WHERE t.id = ? AND t.school_id = ? AND u.deleted_at IS NULL LIMIT 1`,
            [teacherId, schoolId]
        );
        if (!teacher) {
            req.flash('error', 'Teacher not found');
            return res.redirect('/schooladmin/teachers/assignments');
        };

        const [assignments] = await db.query(
            `SELECT tca.id AS assignment_id, tca.is_primary, tca.created_at,
                c.id AS class_id, c.class_name, c.section,
                s.id AS subject_id, s.subject_name
            FROM teacher_class_assign tca
            JOIN classes c ON tca.class_id = c.id
            LEFT JOIN subjects s ON tca.subject_id = s.id
            WHERE tca.teacher_id = ? AND c.school_id = ?
            ORDER BY c.class_name ASC, c.section ASC`,
            [teacherId, schoolId]
        );

        res.render('schoolAdmin/teachers/teacherClasses', {
            title: `${teacher.first_name} ${teacher.last_name} — Classes`,
            teacher,
            assignments,
            currentPath: '/schooladmin/teachers'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load teacher classes');
        res.redirect('/schooladmin/teachers/assignments');
    };
};

exports.freeTeachers = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [teachers] = await db.query(
            `SELECT t.id, t.qualification, t.experience, t.joining_date,
                u.first_name AS first_name, u.last_name AS last_name, u.email, u.phone, u.image, u.status
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            WHERE t.school_id = ? AND u.deleted_at IS NULL
                AND t.id NOT IN (
                    SELECT DISTINCT teacher_id FROM teacher_class_assign WHERE school_id = ?
                )
            ORDER BY u.first_name, u.last_name`,
            [schoolId, schoolId]
        );

        res.render('schoolAdmin/teachers/freeTeachers', {
            title: 'Unassigned Teachers',
            teachers,
            currentPath: '/schooladmin/teachers'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load unassigned teachers');
        res.redirect('/schooladmin/teachers/assignments');
    };
};