const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const timetableService = require('../../services/timetableService');

exports.myTimetable = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const schoolId = req.session?.user?.school_id || req.user?.school_id;
        const teacher = await teacherPermissions.getTeacherByUserOrFail(userId, schoolId);
        const assignedClasses = await teacherPermissions.getAssignedClassesForTeacher(teacher.id, schoolId);

        const [periods] = await db.query(
            `SELECT * FROM period_slots 
            WHERE school_id = ? AND COALESCE(status, 'active') = 'active'
            ORDER BY sort_order, period_number`,
            [schoolId]
        );

        const timetableEntries = await timetableService.getTeacherTimetable(teacher.id, schoolId);
        const days = timetableService.DAYS;
        const timetableGrid = timetableService.buildTimetableGrid({ days, periods, entries: timetableEntries });

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
    };
};
