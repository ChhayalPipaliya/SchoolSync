const db = require('../../config/database');

exports.myTimetable = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const schoolId = req.session?.user?.school_id || req.user?.school_id;

        const [students] = await db.query(
            'SELECT class_id FROM students WHERE user_id = ? AND school_id = ?',
            [userId, schoolId]
        );

        if (students.length === 0 || !students[0].class_id) {
            req.flash('error', 'No class assigned to your student profile yet.');
            return res.redirect('/student/dashboard');
        }

        const classId = students[0].class_id;
        const [periods] = await db.query(
            `SELECT * FROM period_slots 
                WHERE school_id = ? 
                ORDER BY sort_order, period_number`,
            [schoolId]
        );

        const [timetableEntries] = await db.query(
            `SELECT t.*, ps.label, ps.start_time, ps.end_time, ps.is_break,
                    s.subject_name as subject_name, 
                    u.first_name as teacher_first_name, u.last_name as teacher_last_name
             FROM timetables t
             JOIN period_slots ps ON t.period_slot_id = ps.id
             LEFT JOIN subjects s ON t.subject_id = s.id
             LEFT JOIN users u ON t.teacher_id = u.id
             WHERE t.class_id = ? AND t.school_id = ?
             ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'),
                      ps.sort_order`,
            [classId, schoolId]
        );

        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const timetableGrid = {};

        days.forEach(day => {
            timetableGrid[day] = {};
            periods.forEach(period => {
                const entry = timetableEntries.find(t => 
                    t.day_of_week === day && t.period_slot_id === period.id
                );
                timetableGrid[day][period.id] = entry || null;
            });
        });

        const hasEntries = timetableEntries.length > 0;

        res.render('student/timetable', {
            title: 'My Timetable',
            periods,
            days,
            timetableGrid,
            hasEntries,
            user: req.session.user || req.user,
            currentPath: '/student/timetable'
        });
    } catch (error) {
        console.error('Student My Timetable error:', error);
        req.flash('error', 'Failed to load timetable');
        res.redirect('/student/dashboard');
    }
};