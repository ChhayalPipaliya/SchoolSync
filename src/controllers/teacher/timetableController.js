const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');

exports.myTimetable = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const schoolId = req.session?.user?.school_id || req.user?.school_id;
        const teacher = await teacherPermissions.getTeacherByUserOrFail(userId, schoolId);
        const assignedClasses = await teacherPermissions.getAssignedClassesForTeacher(teacher.id, schoolId);

        const [periods] = await db.query(
            `SELECT * FROM period_slots 
             WHERE school_id = ? 
             ORDER BY sort_order, period_number`,
            [schoolId]
        );

        const timetableEntries = await teacherPermissions.getTeacherTimetable(userId, schoolId);

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

        res.render('teacher/timetable', {
            title: 'My Timetable',
            periods,
            days,
            timetableGrid,
            hasEntries,
            teacher,
            assignedClasses,
            user: req.session?.user || req.user,
            currentPath: '/teacher/timetable',
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Teacher Timetable Error:', error);
        req.flash('error', 'Failed to load timetable');
        res.redirect('/teacher/dashboard');
    }
};
