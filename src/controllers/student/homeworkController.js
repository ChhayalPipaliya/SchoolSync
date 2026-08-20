const db = require('../../config/database');

exports.myHomework = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const { status } = req.query;

        if (!userId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        };

        const [students] = await db.query(
            `SELECT s.id, s.class_id, s.roll_no, u.first_name, u.last_name, c.class_name, c.section
             FROM students s
             JOIN users u ON s.user_id = u.id
             LEFT JOIN classes c ON s.class_id = c.id
             WHERE s.user_id = ?`,
            [userId]
        );

        if (!students.length || !students[0].class_id) {
            req.flash('error', 'Student or class record not found');
            return res.redirect('/student/dashboard');
        };

        const student = students[0];
        const studentId = student.id;
        const classId   = student.class_id;

        const [allClassHomeworks] = await db.query(`
            SELECT
                h.id,
                h.due_date,
                sh.viewed_at,
                sh.status AS submission_status
            FROM homeworks h
            LEFT JOIN homework_submissions sh
                ON sh.homework_id = h.id
                AND sh.student_id = ?
            WHERE h.class_id = ?
                AND h.status = 'active'
        `, [studentId, classId]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const total = allClassHomeworks.length;
        const pending = allClassHomeworks.filter(h => !h.viewed_at && new Date(h.due_date) >= today).length;
        const overdue = allClassHomeworks.filter(h => !h.viewed_at && new Date(h.due_date) < today).length;
        const seen = allClassHomeworks.filter(h => h.viewed_at).length;

        let extraWhere = '';
        if (status === 'pending') {
            extraWhere = ' AND sh.viewed_at IS NULL AND h.due_date >= CURDATE()';
        } else if (status === 'overdue') {
            extraWhere = ' AND h.due_date < CURDATE() AND sh.viewed_at IS NULL';
        } else if (status === 'seen') {
            extraWhere = ' AND sh.viewed_at IS NOT NULL';
        };

        const [homeworks] = await db.query(`
            SELECT
                h.id,
                h.title,
                h.description,
                h.due_date,
                h.file_path AS homework_file,
                h.status AS homework_status,
                h.created_at,
                s.subject_name,
                s.code AS subject_code,
                CONCAT(tu.first_name, ' ', COALESCE(tu.last_name, '')) AS teacher_name,
                sh.id AS submission_id,
                sh.file_path AS submitted_file,
                sh.note AS student_note,
                sh.submitted_at,
                sh.viewed_at,
                sh.status AS submission_status,
                sh.marks_obtained,
                sh.teacher_remark
            FROM homeworks h
            JOIN subjects s ON h.subject_id = s.id
            JOIN teachers t ON h.teacher_id = t.id
            JOIN users tu ON t.user_id = tu.id
            LEFT JOIN homework_submissions sh
                ON sh.homework_id = h.id
                AND sh.student_id = ?
            WHERE h.class_id = ?
                AND h.status = 'active'
                ${extraWhere}
            ORDER BY h.due_date DESC, h.created_at DESC
        `, [studentId, classId]);

        const subjectsSet = new Set();
        homeworks.forEach(h => {
            if (h.subject_name) subjectsSet.add(h.subject_name);
        });
        const subjectsList = Array.from(subjectsSet);

        return res.render('student/homework', {
            title: 'My Homework',
            homeworks,
            student,
            subjectsList,
            status: status || 'all',
            stats: { total, pending, overdue, seen },
            user: req.session?.user || req.user
        });
    } catch (error) {
        console.error('Homework Error:', error);
        req.flash('error', 'Failed to load homework');
        return res.redirect('/student/dashboard');
    };
};

exports.markHomeworkSeen = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const { homework_id } = req.body;

        if (!userId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        };

        const [students] = await db.query(
            'SELECT id, class_id FROM students WHERE user_id = ?',
            [userId]
        );
        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/homework');
        };
        const studentId = students[0].id;
        const classId = students[0].class_id;

        const [hwCheck] = await db.query(
            'SELECT id FROM homeworks WHERE id = ? AND class_id = ? AND status = "active"',
            [homework_id, classId]
        );
        if (hwCheck.length === 0) {
            req.flash('error', 'Invalid homework or homework is closed');
            return res.redirect('/student/homework');
        };

        const [existing] = await db.query(
            'SELECT id FROM homework_submissions WHERE homework_id = ? AND student_id = ?',
            [homework_id, studentId]
        );

        if (existing.length > 0) {
            await db.query(
                `UPDATE homework_submissions
                 SET viewed_at = COALESCE(viewed_at, CURRENT_TIMESTAMP)
                 WHERE homework_id = ? AND student_id = ?`,
                [homework_id, studentId]
            );
        } else {
            await db.query(
                `INSERT INTO homework_submissions (homework_id, student_id, status, viewed_at)
                 VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`,
                [homework_id, studentId]
            );
        };

        req.flash('success', 'Homework marked as seen');
        return res.redirect('/student/homework');

    } catch (error) {
        console.error('Mark Homework Seen Error:', error);
        req.flash('error', 'Failed to mark homework as seen');
        return res.redirect('/student/homework');
    };
};

exports.submitHomework = async (req, res) => {
    req.flash('error', 'Students can only view and mark homework as seen.');
    return res.redirect('/student/homework');
};
