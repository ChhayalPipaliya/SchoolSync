const db = require('../../config/database');
const { classOrderSql, formatClassLabel, sortClasses } = require('../../utils/academicLabels');
const { logSchoolActivity } = require('../../utils/auditLogger');

const VALID_SUBJECT_TYPES = ['theory', 'practical', 'both', 'activity'];

function normalizeSubjectPayload(body) {
    const subjectName = String(body.subject_name || '').trim();
    const subjectCode = String(body.subject_code || body.code || '').trim();
    const subjectType = String(body.subject_type || '').trim() || 'theory';
    const maxMarks = Number.parseInt(body.max_marks || 100, 10);
    const passMarks = Number.parseInt(body.pass_marks || 35, 10);
    return { subjectName, subjectCode, subjectType, maxMarks, passMarks };
};

function validateSubjectPayload(payload) {
    if (!payload.subjectName) return 'Subject name is required';
    if (!Number.isFinite(payload.maxMarks) || payload.maxMarks <= 0) return 'Max marks must be greater than zero';
    if (!Number.isFinite(payload.passMarks) || payload.passMarks < 0) return 'Pass marks cannot be negative';
    if (payload.maxMarks <= payload.passMarks) return 'Max marks must be greater than pass marks';
    if (!VALID_SUBJECT_TYPES.includes(payload.subjectType)) return 'Invalid subject type';
    return null;
};

async function tableHasColumn(tableName, columnName) {
    const [rows] = await db.query(
        `SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?
        LIMIT 1`,
        [tableName, columnName]
    );
    return rows.length > 0;
};

exports.listSubjects = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const [subjects] = await db.query(
            'SELECT * FROM subjects WHERE school_id = ? ORDER BY subject_name ASC',
            [schoolId]
        );

        const [classRows] = await db.query(
            `SELECT * FROM classes WHERE school_id = ?
            ORDER BY ${classOrderSql('classes')}, section, medium, stream`,
            [schoolId]
        );
        const classes = sortClasses(classRows).map(cls => ({
            ...cls,
            label: formatClassLabel(cls)
        }));

        const [teachers] = await db.query(
            `SELECT t.id AS teacher_id, u.first_name AS first_name, u.last_name AS last_name
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            WHERE t.school_id = ? AND u.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name`,
            [schoolId]
        );

        const [classSubjectRows] = await db.query(
            `SELECT cs.*, c.class_name, c.section, c.medium, c.stream,
                s.subject_name, CONCAT_WS(' ', u.first_name, u.last_name) as teacher_name
            FROM class_subjects cs
            JOIN classes c ON cs.class_id = c.id AND c.school_id = cs.school_id
            JOIN subjects s ON cs.subject_id = s.id AND s.school_id = cs.school_id
            LEFT JOIN teachers t ON t.id = cs.teacher_id AND t.school_id = cs.school_id
            LEFT JOIN users u ON u.id = t.user_id AND u.school_id = cs.school_id
            WHERE cs.school_id = ? AND COALESCE(cs.status, 'active') = 'active'
            ORDER BY ${classOrderSql('c')}, c.section, c.medium, c.stream, s.subject_name`,
            [schoolId]
        );
        const classSubjects = classSubjectRows.map(row => ({
            ...row,
            class_label: formatClassLabel(row)
        }));

        res.render('schoolAdmin/subjects/list', {
            title: 'Subjects',
            subjects,
            classes,
            classSubjects,
            teachers
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load subjects');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addSubject = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const payload = normalizeSubjectPayload(req.body);
        const validationError = validateSubjectPayload(payload);
        if (validationError) {
            req.flash('error', validationError);
            return res.redirect('/schooladmin/subjects');
        };

        const [[duplicateName]] = await db.query(
            "SELECT id FROM subjects WHERE school_id = ? AND LOWER(subject_name) = LOWER(?) AND status = 'active' LIMIT 1",
            [schoolId, payload.subjectName]
        );
        if (duplicateName) {
            req.flash('error', 'An active subject with this name already exists');
            return res.redirect('/schooladmin/subjects');
        };

        if (payload.subjectCode) {
            const [[duplicateCode]] = await db.query(
                "SELECT id FROM subjects WHERE school_id = ? AND (LOWER(code) = LOWER(?) OR LOWER(subject_code) = LOWER(?)) AND status = 'active' LIMIT 1",
                [schoolId, payload.subjectCode, payload.subjectCode]
            );
            if (duplicateCode) {
                req.flash('error', 'An active subject with this code already exists');
                return res.redirect('/schooladmin/subjects');
            };
        };

        const inactiveParams = [schoolId, payload.subjectName];
        let inactiveSql = "SELECT id FROM subjects WHERE school_id = ? AND LOWER(subject_name) = LOWER(?) AND status = 'inactive'";
        if (payload.subjectCode) {
            inactiveSql += " OR (school_id = ? AND status = 'inactive' AND (LOWER(code) = LOWER(?) OR LOWER(subject_code) = LOWER(?)))";
            inactiveParams.push(schoolId, payload.subjectCode, payload.subjectCode);
        };
        inactiveSql += ' LIMIT 1';
        const [[inactiveMatch]] = await db.query(inactiveSql, inactiveParams);
        if (inactiveMatch) {
            await db.query(
                `UPDATE subjects
                SET subject_name = ?, code = ?, subject_code = ?, subject_type = ?, max_marks = ?, pass_marks = ?, status = 'active'
                WHERE id = ? AND school_id = ?`,
                [payload.subjectName, payload.subjectCode || null, payload.subjectCode || '', payload.subjectType, payload.maxMarks, payload.passMarks, inactiveMatch.id, schoolId]
            );
            req.flash('success', 'Inactive subject reactivated successfully');
            return res.redirect('/schooladmin/subjects');
        };

        await db.query(
            'INSERT INTO subjects (school_id, subject_name, code, subject_code, subject_type, max_marks, pass_marks) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [schoolId, payload.subjectName, payload.subjectCode || null, payload.subjectCode || '', payload.subjectType, payload.maxMarks, payload.passMarks]
        );

        req.flash('success', 'Subject added successfully');
        res.redirect('/schooladmin/subjects');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to add subject');
        res.redirect('/schooladmin/subjects');
    };
};

exports.editSubject = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;
        const { status } = req.body;
        const payload = normalizeSubjectPayload(req.body);
        const validationError = validateSubjectPayload(payload);
        if (validationError) {
            req.flash('error', validationError);
            return res.redirect('/schooladmin/subjects');
        };

        const [[duplicateName]] = await db.query(
            "SELECT id FROM subjects WHERE school_id = ? AND LOWER(subject_name) = LOWER(?) AND status = 'active' AND id != ? LIMIT 1",
            [schoolId, payload.subjectName, id]
        );
        if (duplicateName) {
            req.flash('error', 'An active subject with this name already exists');
            return res.redirect('/schooladmin/subjects');
        };

        if (payload.subjectCode) {
            const [[duplicateCode]] = await db.query(
                "SELECT id FROM subjects WHERE school_id = ? AND (LOWER(code) = LOWER(?) OR LOWER(subject_code) = LOWER(?)) AND status = 'active' AND id != ? LIMIT 1",
                [schoolId, payload.subjectCode, payload.subjectCode, id]
            );
            if (duplicateCode) {
                req.flash('error', 'An active subject with this code already exists');
                return res.redirect('/schooladmin/subjects');
            };
        };

        await db.query(
            'UPDATE subjects SET subject_name = ?, code = ?, subject_code = ?, subject_type = ?, max_marks = ?, pass_marks = ?, status = ? WHERE id = ? AND school_id = ?',
            [payload.subjectName, payload.subjectCode || null, payload.subjectCode || '', payload.subjectType, payload.maxMarks, payload.passMarks, status === 'inactive' ? 'inactive' : 'active', id, schoolId]
        );

        req.flash('success', 'Subject updated successfully');
        res.redirect('/schooladmin/subjects');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update subject');
        res.redirect('/schooladmin/subjects');
    };
};

exports.deleteSubject = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;
        const dependencyChecks = [['class_subjects', 'subject_id'], ['teacher_class_assign', 'subject_id'], ['timetables', 'subject_id'], ['homeworks', 'subject_id'], ['exams', 'subject_id'], ['exam_subjects', 'subject_id'], ['exam_schedules', 'subject_id'], ['marks', 'subject_id'] ];
        let dependencyCount = 0;
        for (const [tableName, columnName] of dependencyChecks) {
            if (!(await tableHasColumn(tableName, columnName)) || !(await tableHasColumn(tableName, 'school_id'))) {
                continue;
            };
            const [[row]] = await db.query(
                `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${columnName} = ? AND school_id = ?`,
                [id, schoolId]
            );
            dependencyCount += Number(row.count || 0);
        };

        if (dependencyCount > 0) {
            await db.query('UPDATE subjects SET status = ? WHERE id = ? AND school_id = ?', ['inactive', id, schoolId]);
            req.flash('success', 'Subject is used in academic records, so it was marked inactive instead of deleted.');
            return res.redirect('/schooladmin/subjects');
        };

        await db.query('DELETE FROM subjects WHERE id = ? AND school_id = ?', [id, schoolId]);
        req.flash('success', 'Subject deleted successfully');
        res.redirect('/schooladmin/subjects');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete subject');
        res.redirect('/schooladmin/subjects');
    };
};

exports.assignSubjectToClass = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { class_id, subject_id, teacher_id, is_mandatory } = req.body;
        const [[classRow]] = await db.query(
            'SELECT id, class_name, section, medium, stream, academic_year FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [class_id, schoolId]
        );
        if (!classRow) {
            req.flash('error', 'Invalid class selected');
            return res.redirect('/schooladmin/subjects');
        };

        const [[subjectRow]] = await db.query(
            "SELECT id, subject_name FROM subjects WHERE id = ? AND school_id = ? AND status = 'active' LIMIT 1",
            [subject_id, schoolId]
        );
        if (!subjectRow) {
            req.flash('error', 'Invalid active subject selected');
            return res.redirect('/schooladmin/subjects');
        };

        let teacherRow = null;
        if (teacher_id) {
            const [[teacher]] = await db.query(
                `SELECT t.id AS teacher_table_id
                FROM teachers t
                JOIN users u ON u.id = t.user_id
                WHERE t.id = ? AND t.school_id = ? AND u.school_id = ? AND u.deleted_at IS NULL
                LIMIT 1`,
                [teacher_id, schoolId, schoolId]
            );
            if (!teacher) {
                req.flash('error', 'Invalid teacher selected');
                return res.redirect('/schooladmin/subjects');
            };
            teacherRow = teacher;
        };

        const [[existing]] = await db.query(
            "SELECT id, status FROM class_subjects WHERE school_id = ? AND class_id = ? AND subject_id = ? LIMIT 1",
            [schoolId, class_id, subject_id]
        );

        if (existing && existing.status === 'active') {
            req.flash('error', 'This subject is already assigned to the selected class');
            return res.redirect('/schooladmin/subjects');
        } else if (existing) {
            await db.query(
                `UPDATE class_subjects
                SET teacher_id = ?, is_mandatory = ?, status = 'active'
                WHERE id = ? AND school_id = ?`,
                [teacher_id || null, is_mandatory === 'on' ? 1 : 0, existing.id, schoolId]
            );
        } else {
            await db.query(
                `INSERT INTO class_subjects (school_id, class_id, subject_id, teacher_id, is_mandatory, status)
                VALUES (?, ?, ?, ?, ?, 'active')`,
                [schoolId, class_id, subject_id, teacher_id || null, is_mandatory === 'on' ? 1 : 0]
            );
        };

        if (teacherRow) {
            const [[existingTeacherAssign]] = await db.query(
                `SELECT id, status FROM teacher_class_assign
                WHERE school_id = ? AND teacher_id = ? AND class_id = ? AND subject_id = ?
                LIMIT 1`,
                [schoolId, teacherRow.teacher_table_id, class_id, subject_id]
            );
            if (existingTeacherAssign) {
                await db.query(
                    `UPDATE teacher_class_assign
                    SET status = 'active', assigned_by = ?, medium = ?, academic_year = ?
                    WHERE id = ? AND school_id = ?`,
                    [(req.user?.id || req.session.user?.id), classRow.medium || null, classRow.academic_year || null, existingTeacherAssign.id, schoolId]
                );
            } else {
                await db.query(
                    `INSERT INTO teacher_class_assign
                    (school_id, teacher_id, class_id, subject_id, medium, academic_year, status, assigned_by, is_primary)
                    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0)`,
                    [schoolId, teacherRow.teacher_table_id, class_id, subject_id, classRow.medium || null, classRow.academic_year || null, (req.user?.id || req.session.user?.id)]
                );
            };
        };

        await logSchoolActivity(req, {
            action: 'assign_subject',
            entityType: 'class_subject',
            entityId: existing?.id || null,
            newValues: {
                class_id,
                subject_id,
                teacher_id: teacher_id || null,
                is_mandatory: is_mandatory === 'on' ? 1 : 0
            },
            description: `${subjectRow.subject_name} assigned to ${formatClassLabel(classRow)}`
        });

        req.flash('success', 'Subject assigned to class successfully');
        res.redirect('/schooladmin/subjects');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to assign subject');
        res.redirect('/schooladmin/subjects');
    };
};
