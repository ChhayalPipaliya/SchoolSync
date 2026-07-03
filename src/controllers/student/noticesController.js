const db = require('../../config/database');

exports.myNotices = async (req, res) => {
    try {
        const schoolId = req.session.user?.school_id;
        const userId = req.session.user?.id;

        const [students] = await db.query(
            'SELECT class_id FROM students WHERE user_id = ? AND school_id = ?',
            [userId, schoolId]
        );
        const classId = students[0]?.class_id || null;

        const [notices] = await db.query(`
            SELECT *, content AS message FROM notices 
            WHERE school_id = ? 
              AND (
                target_type = 'all' 
                OR target_type = 'students' 
                OR (target_type = 'specific_class' AND target_class_id = ?)
              )
              AND (expiry_date IS NULL OR expiry_date >= CURDATE())
              AND is_active = 1
            ORDER BY created_at DESC
        `, [schoolId, classId]);

        res.render('student/notices', {
            title: 'Notices',
            notices,
            user: req.session.user
        });
    } catch (error) {
        console.error('Notices Error:', error);
        res.render('student/notices', {
            title: 'Notices',
            notices: [],
            user: req.session.user
        });
    }
};
