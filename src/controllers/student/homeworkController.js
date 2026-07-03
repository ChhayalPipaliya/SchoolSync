const db = require('../../config/database');

exports.myHomework = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const { status } = req.query;

        if (!userId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        }

        const [students] = await db.query(
            'SELECT id, class_id FROM students WHERE user_id = ?',
            [userId]
        );

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        }

        const studentId = students[0].id;
        const classId   = students[0].class_id;

        let extraWhere = '';
        if (status === 'pending') {
            extraWhere = ' AND (sh.id IS NULL OR sh.status = "pending")';
        } else if (status === 'overdue') {
            extraWhere = ' AND h.due_date < CURDATE() AND (sh.id IS NULL OR sh.status = "pending")';
        } else if (status === 'submitted') {
            extraWhere = ' AND sh.id IS NOT NULL AND sh.status != "pending"';
        }

        const [homeworks] = await db.query(`
            SELECT
                h.id,
                h.title,
                h.description,
                h.due_date,
                h.file_path   AS homework_file,
                h.status      AS homework_status,
                h.created_at,
                s.subject_name,
                s.code        AS subject_code,
                CONCAT(tu.first_name, ' ', COALESCE(tu.last_name, '')) AS teacher_name,
                sh.id         AS submission_id,
                sh.file_path  AS submitted_file,
                sh.note       AS student_note,
                sh.submitted_at,
                sh.status     AS submission_status,
                sh.marks_obtained,
                sh.teacher_remark
            FROM homeworks h
            JOIN subjects s ON h.subject_id = s.id
            JOIN teachers t ON h.teacher_id = t.id
            JOIN users tu   ON t.user_id = tu.id
            LEFT JOIN homework_submissions sh
                ON sh.homework_id = h.id
                AND sh.student_id = ?
            WHERE h.class_id = ?
              AND h.status = 'active'
              ${extraWhere}
            ORDER BY h.due_date DESC, h.created_at DESC
        `, [studentId, classId]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const total     = homeworks.length;
        const pending   = homeworks.filter(h => (!h.submission_id || h.submission_status === 'pending') && new Date(h.due_date) >= today).length;
        const overdue   = homeworks.filter(h => (!h.submission_id || h.submission_status === 'pending') && new Date(h.due_date)  < today).length;
        const submitted = homeworks.filter(h =>  h.submission_id && h.submission_status !== 'pending').length;

        return res.render('student/homework', {
            title: 'My Homework',
            homeworks,
            status: status || 'all',
            stats: { total, pending, overdue, submitted },
            user: req.session?.user || req.user
        });

    } catch (error) {
        console.error('Homework Error:', error);
        req.flash('error', 'Failed to load homework');
        return res.redirect('/student/dashboard');
    }
};

exports.submitHomework = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const { homework_id, note } = req.body;

        if (!userId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        }

        let file_path = null;
        if (req.file) {
            file_path = `/uploads/homeworks/${req.file.filename}`;
        }

        const [students] = await db.query(
            'SELECT id, class_id FROM students WHERE user_id = ?',
            [userId]
        );
        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/homework');
        }
        const studentId = students[0].id;
        const classId = students[0].class_id;

        const [hwCheck] = await db.query(
            'SELECT id, due_date FROM homeworks WHERE id = ? AND class_id = ? AND status = "active"',
            [homework_id, classId]
        );
        if (hwCheck.length === 0) {
            req.flash('error', 'Invalid homework or homework is closed');
            return res.redirect('/student/homework');
        }

        const today = new Date();
        const dueDate = new Date(hwCheck[0].due_date);
        dueDate.setHours(23, 59, 59, 999);
        const dueWarning = today > dueDate;

        const [existing] = await db.query(
            'SELECT id FROM homework_submissions WHERE homework_id = ? AND student_id = ?',
            [homework_id, studentId]
        );

        const submissionStatus = dueWarning ? 'late' : 'submitted';

        if (existing.length > 0) {
            await db.query(
                `UPDATE homework_submissions
                 SET file_path    = COALESCE(?, file_path),
                     note         = ?,
                     submitted_at = CURRENT_TIMESTAMP,
                     status       = ?
                 WHERE homework_id = ? AND student_id = ?`,
                [file_path, note, submissionStatus, homework_id, studentId]
            );
        } else {
            await db.query(
                `INSERT INTO homework_submissions (homework_id, student_id, file_path, note, status)
                 VALUES (?, ?, ?, ?, ?)`,
                [homework_id, studentId, file_path, note, submissionStatus]
            );
        }

        const [[hw]] = await db.query(
            "SELECT teacher_id, school_id, title FROM homeworks WHERE id = ?",
            [homework_id]
        );
        if (hw) {
            const studentName = `${req.session?.user?.first_name || req.user?.first_name || 'Student'} ${req.session?.user?.last_name || req.user?.last_name || ''}`;
            const NotificationService = require('../../services/notificationService');
            const templates = require('../../utils/notificationTemplates');
            
            const [[teacherUser]] = await db.query(
                "SELECT user_id FROM teachers WHERE id = ?",
                [hw.teacher_id]
            );
            if (teacherUser) {
                NotificationService.createAndSend({
                    recipient_id: teacherUser.user_id,
                    recipient_role: "teacher",
                    school_id: hw.school_id,
                    created_by: userId,
                    ...templates.homeworkSubmitted(studentName, hw.title, homework_id)
                }).catch(err => console.error("Failed to notify teacher of submission:", err));
            }
        }

        if (dueWarning) {
            req.flash('success', 'Homework submitted, but marked as LATE since the due date has passed.');
        } else {
            req.flash('success', 'Homework submitted successfully');
        }
        return res.redirect('/student/homework');

    } catch (error) {
        console.error('Submit Homework Error:', error);
        req.flash('error', 'Failed to submit homework');
        return res.redirect('/student/homework');
    }
};