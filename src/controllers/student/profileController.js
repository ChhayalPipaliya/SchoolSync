const db = require('../../config/database');
const { validationResult } = require('express-validator');
const bcryptjs = require('bcryptjs');
const { isStrongPassword } = require('../../utils/validation');

exports.viewProfile = async (req, res) => {
    try {
        const userId = req.session.user?.id;
        const schoolId = req.session.user?.school_id;

        const [students] = await db.query(`
            SELECT s.*, CONCAT_WS(' ', u.first_name, u.last_name) AS name,
                   u.email, u.phone, u.image as avatar, c.class_name as class_name, c.section
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id AND c.school_id = s.school_id
            WHERE s.user_id = ? AND s.school_id = ?
        `, [userId, schoolId]);

        if (!students.length) {
            req.flash('error', 'Profile not found');
            return res.redirect('/student/dashboard');
        }

        const student = students[0];

        const [family] = await db.query(
            'SELECT * FROM student_family WHERE student_id = ?',
            [student.id]
        );

        const [address] = await db.query(
            'SELECT * FROM student_address_transport WHERE student_id = ?',
            [student.id]
        );

        const [documents] = await db.query(
            'SELECT * FROM student_documents WHERE student_id = ?',
            [student.id]
        );

        // Attendance stats
        const [[attRow]] = await db.query(`
            SELECT COUNT(*) as total,
                   SUM(status='present') as present,
                   SUM(status='absent') as absent,
                   SUM(status='late') as late
            FROM attendance WHERE student_id = ? AND school_id = ?
        `, [student.id, schoolId]);
        const attendanceStats = {
            total:   attRow.total   || 0,
            present: attRow.present || 0,
            absent:  attRow.absent  || 0,
            late:    attRow.late    || 0,
            pct:     attRow.total > 0 ? (((Number(attRow.present || 0) + Number(attRow.late || 0)) / attRow.total) * 100).toFixed(1) : 0
        };

        // Academic year from settings
        const [settingRows] = await db.query(
            "SELECT value FROM settings WHERE key_name='academic_year' AND school_id=? LIMIT 1",
            [student.school_id]
        );
        const academicYear = settingRows.length ? settingRows[0].value : '—';

        res.render('student/profile', {
            title: 'My Profile',
            student,
            family: family[0] || {},
            address: address[0] || {},
            documents,
            attendanceStats,
            academicYear,
            user: req.session.user
        });
    } catch (error) {
        console.error('View Profile Error:', error);
        req.flash('error', 'Failed to load profile');
        res.redirect('/student/dashboard');
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            req.flash('error', 'Please fill all password fields');
            return res.redirect('/student/profile');
        }

        if (newPassword !== confirmPassword) {
            req.flash('error', 'New passwords do not match');
            return res.redirect('/student/profile');
        }

        if (!isStrongPassword(newPassword)) {
            req.flash('error', 'Password must be at least 8 characters and include letters and numbers');
            return res.redirect('/student/profile');
        }

        const userId = req.session.user?.id;
        const [users] = await db.query('SELECT password FROM users WHERE id = ?', [userId]);
        if (!users.length) {
            req.flash('error', 'User not found');
            return res.redirect('/student/profile');
        }

        const user = users[0];
        const isPasswordValid = await bcryptjs.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            req.flash('error', 'Incorrect current password');
            return res.redirect('/student/profile');
        }

        const hashed = await bcryptjs.hash(newPassword, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);

        req.flash('success', 'Password updated successfully');
        res.redirect('/student/profile');
    } catch (error) {
        console.error('Update Password Error:', error);
        req.flash('error', 'Failed to update password');
        res.redirect('/student/profile');
    }
};
