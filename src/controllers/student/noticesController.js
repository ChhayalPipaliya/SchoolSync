const db = require('../../config/database');

exports.myNotices = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const userId = (req.user?.id || req.session.user?.id);

        const [students] = await db.query(
            `SELECT s.id, s.class_id, s.roll_no, u.first_name, u.last_name, c.class_name, c.section
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.user_id = ? AND s.school_id = ?`,
            [userId, schoolId]
        );
        const student = students[0] || {};
        const classId = student.class_id || null;

        const [notices] = await db.query(`
            SELECT 
                n.*, 
                n.content AS message,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS created_by_name,
                c.class_name AS target_class_name, 
                c.section AS target_class_section
            FROM notices n
            LEFT JOIN users u ON n.created_by = u.id
            LEFT JOIN classes c ON n.target_type = 'specific_class' AND n.target_class_id = c.id
            WHERE n.school_id = ? 
                AND (
                    n.target_type = 'all' 
                    OR n.target_type = 'students' 
                    OR (n.target_type = 'specific_class' AND n.target_class_id = ?)
                ) 
                AND (n.expiry_date IS NULL OR n.expiry_date >= CURDATE())
                AND n.is_active = 1
            ORDER BY n.created_at DESC
        `, [schoolId, classId]);

        res.render('student/notices', {
            title: 'School Notices',
            notices,
            student,
            user: req.user || req.session.user
        });
    } catch (error) {
        console.error('Notices Error:', error);
        res.render('student/notices', {
            title: 'School Notices',
            notices: [],
            student: {},
            user: req.user || req.session.user
        });
    };
};