const db = require('../../config/database');
const timetableService = require('../../services/timetableService');

exports.myTimetable = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const schoolId = req.session?.user?.school_id || req.user?.school_id;

        const [students] = await db.query(
            'SELECT id, class_id FROM students WHERE user_id = ? AND school_id = ?',
            [userId, schoolId]
        );

        if (students.length === 0 || !students[0].class_id) {
            req.flash('error', 'No class assigned to your student profile yet.');
            return res.redirect('/student/dashboard');
        }

        const classId = students[0].class_id;
        const activeYear = await timetableService.getActiveAcademicYearForSchool(schoolId);
        const resolvedAcademicYearId = activeYear?.id || null;

        const terms = await timetableService.getTermsForAcademicYear(schoolId, resolvedAcademicYearId);
        const activeTerm = terms.find(t => t.status === 'active') || terms[0];
        const resolvedTermId = activeTerm?.id || null;

        const [periods] = await db.query(
            `SELECT * FROM period_slots 
                WHERE school_id = ? AND academic_year_id = ? AND COALESCE(status, 'active') = 'active'
                ORDER BY sort_order, period_number`,
            [schoolId, resolvedAcademicYearId]
        );

        const { entries: timetableEntries } = await timetableService.getStudentTimetable(students[0].id, schoolId, resolvedAcademicYearId, resolvedTermId);

        const current = new Date();
        const day = current.getDay();
        const diff = current.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(current.setDate(diff));
        const weekDates = {};
        const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        dayNames.forEach((dName, idx) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + idx);
            weekDates[dName] = d.toISOString().split('T')[0];
        });

        if (timetableEntries.length > 0) {
            const [subs] = await db.query(
                `SELECT tsub.*, u_sub.first_name AS sub_first_name, u_sub.last_name AS sub_last_name
                FROM timetable_substitutions tsub
                JOIN teachers tchr_sub ON tchr_sub.id = tsub.substitute_teacher_id AND tchr_sub.school_id = tsub.school_id
                JOIN users u_sub ON u_sub.id = tchr_sub.user_id AND u_sub.school_id = tsub.school_id
                WHERE tsub.school_id = ? AND tsub.substitution_date IN (?)`,
                [schoolId, Object.values(weekDates)]
            );
            const subMap = {};
            subs.forEach(s => {
                subMap[`${s.timetable_id}_${s.substitution_date}`] = s;
            });
            timetableEntries.forEach(row => {
                const dayDate = weekDates[row.day_of_week];
                const sub = subMap[`${row.id}_${dayDate}`];
                if (sub) {
                    row.teacher_first_name = sub.sub_first_name;
                    row.teacher_last_name = sub.sub_last_name;
                    row.is_substituted = true;
                }
            });
        }

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
