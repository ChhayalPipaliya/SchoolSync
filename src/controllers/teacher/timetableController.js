const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const timetableService = require('../../services/timetableService');

exports.myTimetable = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const schoolId = req.session?.user?.school_id || req.user?.school_id;
        const teacher = await teacherPermissions.getTeacherByUserOrFail(userId, schoolId);
        const assignedClasses = await teacherPermissions.getAssignedClassesForTeacher(teacher.id, schoolId);

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

        const timetableEntriesRaw = await timetableService.getTeacherTimetable(teacher.id, schoolId, resolvedAcademicYearId, resolvedTermId);

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

        const [substituteSlots] = await db.query(
            `SELECT t.id, t.day_of_week, t.period_slot_id, t.subject_id, tsub.substitute_teacher_id AS teacher_id, t.class_id, t.room_id, t.entry_type,
                ps.label, ps.start_time, ps.end_time, ps.is_break,
                s.subject_name,
                c.class_name, c.section AS section_name,
                tsub.reason AS sub_reason
            FROM timetable_substitutions tsub
            JOIN timetables t ON t.id = tsub.timetable_id AND t.school_id = tsub.school_id
            JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
            LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
            LEFT JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
            WHERE tsub.school_id = ? AND tsub.substitute_teacher_id = ? AND tsub.substitution_date IN (?)`,
            [schoolId, teacher.id, Object.values(weekDates)]
        );

        const [substitutedOut] = await db.query(
            `SELECT timetable_id, substitution_date FROM timetable_substitutions
            WHERE school_id = ? AND original_teacher_id = ? AND substitution_date IN (?)`,
            [schoolId, teacher.id, Object.values(weekDates)]
        );

        const substitutedOutMap = {};
        substitutedOut.forEach(so => {
            substitutedOutMap[so.timetable_id] = so.substitution_date;
        });

        const activeRegularEntries = timetableEntriesRaw.filter(row => {
            const dayDate = weekDates[row.day_of_week];
            const subDate = substitutedOutMap[row.id];
            return !subDate || subDate !== dayDate;
        });

        substituteSlots.forEach(slot => {
            slot.is_substitute_duty = true;
            activeRegularEntries.push(slot);
        });

        const days = timetableService.DAYS;
        const timetableGrid = timetableService.buildTimetableGrid({ days, periods, entries: activeRegularEntries });

        const hasEntries = activeRegularEntries.length > 0;
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
