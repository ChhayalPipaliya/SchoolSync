const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const timetableService = require('../../services/timetableService');

const buildClassLabel = (cls) => {
    if (!cls) return 'Not assigned';
    return [cls.name || cls.class_name, cls.section_name || cls.section].filter(Boolean).join(' - ') || 'Assigned class';
};

exports.getDashboard = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getLoggedInTeacher(req);
        const currentUser = req.session?.user || req.user;
        const todayDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];

        const attendanceClass = await teacherPermissions.getAttendanceClassForTeacher(teacher.id, teacher.school_id);
        const myClassLabel = buildClassLabel(attendanceClass);
        const myClasses = attendanceClass ? [{
            ...attendanceClass,
            className: attendanceClass.class_name,
            subject: 'Attendance class',
            studentCount: attendanceClass.studentCount || 0
        }] : [];

        const lectureAssignments = (await teacherPermissions.getAssignedClassesForTeacher(teacher.id, teacher.school_id)).map((cls) => ({
            ...cls,
            className: cls.class_name,
            subject: cls.subject || 'General'
        }));

        const todayDateStr = new Date().toISOString().split('T')[0];
        const todaySchedule = (await timetableService.getTeacherTimetableForDate(teacher.id, teacher.school_id, todayDateStr))
            .map((slot) => ({
                ...slot,
                subject: slot.subject_name,
                startTime: slot.start_time,
                endTime: slot.end_time,
                className: slot.class_name
            }));

        const [recentHomework] = await db.execute(
            `SELECT h.*, c.class_name as class, c.section, s.subject_name as subject
            FROM homeworks h 
            JOIN classes c ON h.class_id = c.id 
            JOIN subjects s ON h.subject_id = s.id 
            JOIN teacher_class_assign tca
                ON tca.teacher_id = ?
                AND tca.school_id = h.school_id
                AND tca.class_id = h.class_id
                AND tca.subject_id = h.subject_id
                AND COALESCE(tca.is_class_teacher, 0) = 0
                AND COALESCE(tca.can_mark_attendance, 0) = 0
                AND COALESCE(tca.status, 'active') = 'active'
            WHERE h.teacher_id = ?
                AND h.school_id = ?
            ORDER BY h.created_at DESC 
            LIMIT 5`,
            [teacher.id, teacher.id, teacher.school_id]
        );

        const [notices] = await db.execute(
            `SELECT *, content AS message FROM notices 
            WHERE school_id = ? AND (target_type = 'all' OR target_type = 'teachers')
                AND (expiry_date IS NULL OR expiry_date > NOW())
                AND is_active = 1
            ORDER BY created_at DESC
            LIMIT 5`,
            [teacher.school_id]
        );

        let totalStudents = 0;
        if (attendanceClass) {
            const [[studentsCountRow]] = await db.execute(
                `SELECT COUNT(*) as count
                FROM students
                WHERE class_id = ?
                    AND school_id = ?
                    AND status = 'active'
                    AND deleted_at IS NULL`,
                [attendanceClass.class_id, teacher.school_id]
            );
            totalStudents = studentsCountRow ? studentsCountRow.count : 0;
        };

        const [[pendingHwRow]] = await db.execute(
            `SELECT COUNT(s.id) as count
            FROM homeworks h
            JOIN students s ON h.class_id = s.class_id AND s.status = 'active'
            JOIN teacher_class_assign tca
                ON tca.teacher_id = ?
                AND tca.school_id = h.school_id
                AND tca.class_id = h.class_id
                AND tca.subject_id = h.subject_id
                AND COALESCE(tca.is_class_teacher, 0) = 0
                AND COALESCE(tca.can_mark_attendance, 0) = 0
                AND COALESCE(tca.status, 'active') = 'active'
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = s.id
            WHERE h.teacher_id = ?
                AND h.school_id = ?
                AND h.status = 'active'
                AND (hs.id IS NULL OR hs.status = 'pending')`,
            [teacher.id, teacher.id, teacher.school_id]
        );
        const pendingHomework = pendingHwRow ? pendingHwRow.count : 0;

        let avgAttendance = 0;
        let attLabels = [];
        let attPresent = [];
        let attAbsent = [];

        if (attendanceClass) {
            const [[avgAttRow]] = await db.execute(
                `SELECT
                    COALESCE(ROUND(SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1), 0) as rate
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                    AND s.class_id = ?
                    AND s.school_id = a.school_id
                    AND s.deleted_at IS NULL
                WHERE a.class_id = ?
                    AND a.school_id = ?
                    AND MONTH(a.date) = MONTH(CURDATE())
                    AND YEAR(a.date) = YEAR(CURDATE())`,
                [attendanceClass.class_id, attendanceClass.class_id, teacher.school_id]
            );
            avgAttendance = avgAttRow ? avgAttRow.rate : 0;

            const [attendanceRows] = await db.execute(
                `SELECT DATE_FORMAT(a.date, '%d %b') AS label,
                    SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) AS present_count,
                    SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent_count
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                    AND s.class_id = ?
                    AND s.school_id = a.school_id
                    AND s.deleted_at IS NULL
                WHERE a.class_id = ?
                    AND a.school_id = ?
                    AND a.date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                GROUP BY a.date
                ORDER BY a.date ASC`,
                [attendanceClass.class_id, attendanceClass.class_id, teacher.school_id]
            );
            attLabels = attendanceRows.map((row) => row.label);
            attPresent = attendanceRows.map((row) => Number(row.present_count) || 0);
            attAbsent = attendanceRows.map((row) => Number(row.absent_count) || 0);
        };

        const [recentHwStats] = await db.execute(
            `SELECT h.title, s.subject_name as subject,
                (SELECT COUNT(*) FROM students st WHERE st.class_id = h.class_id AND st.status = 'active') as total,
                (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.homework_id = h.id AND hs.status IN ('completed', 'graded', 'submitted', 'late')) as completed
            FROM homeworks h
            JOIN subjects s ON h.subject_id = s.id
            JOIN teacher_class_assign tca
                ON tca.teacher_id = ?
                AND tca.school_id = h.school_id
                AND tca.class_id = h.class_id
                AND tca.subject_id = h.subject_id
                AND COALESCE(tca.is_class_teacher, 0) = 0
                AND COALESCE(tca.can_mark_attendance, 0) = 0
                AND COALESCE(tca.status, 'active') = 'active'
            WHERE h.teacher_id = ?
                AND h.school_id = ?
            ORDER BY h.created_at DESC
            LIMIT 5`,
            [teacher.id, teacher.id, teacher.school_id]
        );

        const hwLabels = recentHwStats.map(h => h.title.length > 15 ? h.title.substring(0, 15) + '...' : h.title);
        const hwCompleted = recentHwStats.map(h => h.completed);
        const hwPending = recentHwStats.map(h => Math.max(0, h.total - h.completed));

        const stats = { totalStudents, todayAttendance: 0, weeklyHomeworks: recentHomework.length, assignedClasses: myClasses.length };
        res.render('teacher/dashboard', {
            title: 'Teacher Dashboard',
            user: currentUser,
            teacher,
            stats,
            attendanceClass,
            myClassLabel,
            myClasses,
            lectureAssignments,
            todaySchedule,
            recentHomework,
            notices,
            totalStudents,
            pendingHomework,
            avgAttendance,
            attLabels,
            attPresent,
            attAbsent,
            hwLabels,
            hwCompleted,
            hwPending,
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        req.flash('error', 'Something went wrong');
        res.redirect('/');
    };
};
