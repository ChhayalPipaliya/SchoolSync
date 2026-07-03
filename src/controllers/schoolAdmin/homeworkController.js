const db = require('../../config/database');

exports.listHomeworks = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { class_id, subject_id, teacher_id, status, start_date, end_date } = req.query;

        const [classes] = await db.query(
            'SELECT id, class_name as name, section FROM classes WHERE school_id = ? ORDER BY class_name ASC, section ASC',
            [schoolId]
        );

        const [subjects] = await db.query(
            'SELECT id, subject_name as name, code FROM subjects WHERE school_id = ? ORDER BY subject_name ASC',
            [schoolId]
        );

        const [teachers] = await db.query(
            `SELECT t.id, u.first_name AS first_name, u.last_name AS last_name 
            FROM teachers t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.school_id = ? AND u.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name`,
            [schoolId]
        );

        let sql = `
            SELECT h.*, 
                c.class_name as className, c.section,
                s.subject_name as subjectName,
                CONCAT(u.first_name, ' ', u.last_name) as teacherName,
                (SELECT COUNT(*) FROM homework_submissions WHERE homework_id = h.id) as submissionCount,
                (SELECT COUNT(*) FROM students WHERE class_id = h.class_id AND deleted_at IS NULL) as totalStudents
            FROM homeworks h
            JOIN classes c ON h.class_id = c.id
            JOIN subjects s ON h.subject_id = s.id
            JOIN teachers t ON h.teacher_id = t.id
            JOIN users u ON t.user_id = u.id
            WHERE h.school_id = ?
        `;
        const params = [schoolId]
        if (class_id) {
            sql += ' AND h.class_id = ?';
            params.push(class_id);
        };
        if (subject_id) {
            sql += ' AND h.subject_id = ?';
            params.push(subject_id);
        };
        if (teacher_id) {
            sql += ' AND h.teacher_id = ?';
            params.push(teacher_id);
        };
        if (status) {
            sql += ' AND h.status = ?';
            params.push(status);
        };
        if (start_date) {
            sql += ' AND h.due_date >= ?';
            params.push(start_date);
        };
        if (end_date) {
            sql += ' AND h.due_date <= ?';
            params.push(end_date);
        };

        sql += ' ORDER BY h.due_date DESC, h.created_at DESC';
        const [homeworks] = await db.query(sql, params);
        res.render('schoolAdmin/homework/list', {
            title: 'Homework Monitoring',
            homeworks,
            classes,
            subjects,
            teachers,
            filters: req.query,
            currentPath: '/schooladmin/homework'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load homeworks');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.toggleHomeworkStatus = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const [[homework]] = await db.query(
            'SELECT id, status FROM homeworks WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (!homework) {
            req.flash('error', 'Homework assignment not found');
            return res.redirect('/schooladmin/homework');
        };

        const newStatus = homework.status === 'active' ? 'closed' : 'active';
        await db.query(
            'UPDATE homeworks SET status = ? WHERE id = ? AND school_id = ?',
            [newStatus, id, schoolId]
        );

        req.flash('success', `Homework successfully ${newStatus === 'active' ? 'reopened' : 'closed'}`);
        res.redirect('/schooladmin/homework');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to change homework status');
        res.redirect('/schooladmin/homework');
    };
};

exports.homeworkDetail = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const { status } = req.query;
        const [[homework]] = await db.query(
            `SELECT h.*, 
                c.class_name as className, c.section,
                s.subject_name as subjectName,
                CONCAT(u.first_name, ' ', u.last_name) as teacherName, u.email as teacherEmail
            FROM homeworks h
            JOIN classes c ON h.class_id = c.id
            JOIN subjects s ON h.subject_id = s.id
            JOIN teachers t ON h.teacher_id = t.id
            JOIN users u ON t.user_id = u.id
            WHERE h.id = ? AND h.school_id = ? LIMIT 1`,
            [id, schoolId]
        );

        if (!homework) {
            req.flash('error', 'Homework assignment not found');
            return res.redirect('/schooladmin/homework');
        };

        let sql = `
            SELECT s.id as studentId, 
                CONCAT(u.first_name, ' ', u.last_name) as studentName, u.email as studentEmail,
                hs.id as submissionId, hs.file_path, hs.note, hs.submitted_at, hs.marks_obtained, hs.teacher_remark,
                COALESCE(hs.status, 'pending') as status
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN homework_submissions hs ON hs.student_id = s.id AND hs.homework_id = ?
            WHERE s.class_id = ? AND s.deleted_at IS NULL AND s.school_id = ?
        `;
        
        const params = [id, homework.class_id, schoolId];
        if (status) {
            if (status === 'pending') {
                sql += ' AND hs.id IS NULL';
            } else {
                sql += ' AND hs.status = ?';
                params.push(status);
            };
        };

        sql += ' ORDER BY u.first_name ASC, u.last_name ASC';
        const [submissions] = await db.query(sql, params);

        res.render('schoolAdmin/homework/detail', {
            title: 'Homework Submissions',
            homework,
            submissions,
            filters: req.query,
            currentPath: '/schooladmin/homework'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load homework details');
        res.redirect('/schooladmin/homework');
    };
};

exports.homeworkStats = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;

        const [classStats] = await db.query(
            `SELECT c.id, c.class_name, c.section,
                COUNT(DISTINCT h.id) as totalHomeworks,
                COUNT(DISTINCT hs.id) as totalSubmissions,
                SUM(CASE WHEN hs.status = 'late' THEN 1 ELSE 0 END) as lateSubmissions,
                ROUND(COUNT(DISTINCT hs.id) / NULLIF(COUNT(DISTINCT h.id), 0), 1) as avgSubmissions
            FROM classes c
            LEFT JOIN homeworks h ON c.id = h.class_id AND h.school_id = ?
            LEFT JOIN homework_submissions hs ON h.id = hs.homework_id
            WHERE c.school_id = ?
            GROUP BY c.id, c.class_name, c.section
            ORDER BY c.class_name ASC, c.section ASC`,
            [schoolId, schoolId]
        );

        const [teacherStats] = await db.query(
            `SELECT t.id, 
                CONCAT(u.first_name, ' ', u.last_name) as teacherName, u.email as teacherEmail,
                COUNT(DISTINCT h.id) as totalHomeworks,
                COUNT(DISTINCT hs.id) as totalSubmissions
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN homeworks h ON t.id = h.teacher_id AND h.school_id = ?
            LEFT JOIN homework_submissions hs ON h.id = hs.homework_id
            WHERE t.school_id = ? AND u.deleted_at IS NULL
            GROUP BY t.id, u.first_name, u.last_name, u.email
            ORDER BY u.first_name, u.last_name`,
            [schoolId, schoolId]
        );

        res.render('schoolAdmin/homework/stats', {
            title: 'Homework Analytics',
            classStats,
            teacherStats,
            currentPath: '/schooladmin/homework'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load homework stats');
        res.redirect('/schooladmin/homework');
    };
};