const db = require('../../config/database');
const timetableService = require('../../services/timetableService');

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
                WHERE school_id = ? AND COALESCE(status, 'active') = 'active'
                ORDER BY sort_order, period_number`,
            [schoolId]
        );

        const { entries: timetableEntries } = await timetableService.getStudentTimetable(students[0].id, schoolId);

        const days = timetableService.DAYS;
        const timetableGrid = timetableService.buildTimetableGrid({ days, periods, entries: timetableEntries });

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
    };
};
