const db = require('../../config/database');
const teacherModel = require('../../models/teacherModel');
const teacherPermissions = require('../../services/teacherPermissionService');

exports.getDashboard = async (req, res) => {
    try {
        const teacher = await teacherModel.getTeacherByUserId(req.user.id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found');
            return res.redirect('/auth/login');
        }

        const todayDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];

        const assignedClasses = await teacherPermissions.getAssignedClassesForTeacher(teacher.id, teacher.school_id);
        const myClasses = assignedClasses.map((cls) => ({
            ...cls,
            className: cls.class_name,
            subject: cls.subject || 'General'
        }));

        const todaySchedule = (await teacherPermissions.getTeacherTimetable(req.user.id, teacher.school_id, { dayOfWeek: todayDay }))
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

        const [[studentsCountRow]] = await db.execute(
            `SELECT COUNT(DISTINCT s.id) as count 
             FROM students s
             JOIN teacher_class_assign ct
                  ON s.class_id = ct.class_id
                 AND s.school_id = ct.school_id
                 AND COALESCE(ct.status, 'active') = 'active'
             WHERE ct.teacher_id = ?
               AND s.school_id = ?
               AND s.status = 'active'
               AND s.deleted_at IS NULL`,
            [teacher.id, teacher.school_id]
        );
        const totalStudents = studentsCountRow ? studentsCountRow.count : 0;

        const [[pendingHwRow]] = await db.execute(
            `SELECT COUNT(s.id) as count
             FROM homeworks h
             JOIN students s ON h.class_id = s.class_id AND s.status = 'active'
             JOIN teacher_class_assign tca
                  ON tca.teacher_id = ?
                 AND tca.school_id = h.school_id
                 AND tca.class_id = h.class_id
                 AND tca.subject_id = h.subject_id
                 AND COALESCE(tca.status, 'active') = 'active'
             LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = s.id
             WHERE h.teacher_id = ?
               AND h.school_id = ?
               AND h.status = 'active'
               AND (hs.id IS NULL OR hs.status = 'pending')`,
            [teacher.id, teacher.id, teacher.school_id]
        );
        const pendingHomework = pendingHwRow ? pendingHwRow.count : 0;

        const [[avgAttRow]] = await db.execute(
            `SELECT 
                 COALESCE(ROUND(SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1), 0) as rate
             FROM attendance a
             JOIN students s ON a.student_id = s.id
             JOIN teacher_class_assign ct
                  ON s.class_id = ct.class_id
                 AND s.school_id = ct.school_id
                 AND COALESCE(ct.status, 'active') = 'active'
             WHERE ct.teacher_id = ?
               AND a.school_id = ?
               AND MONTH(a.date) = MONTH(CURDATE()) AND YEAR(a.date) = YEAR(CURDATE())`,
            [teacher.id, teacher.school_id]
        );
        const avgAttendance = avgAttRow ? avgAttRow.rate : 0;

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

        const stats = {
            totalStudents,
            todayAttendance: 0,
            weeklyHomeworks: recentHomework.length,
            assignedClasses: myClasses.length
        };

        res.render('teacher/dashboard', {
            title: 'Teacher Dashboard',
            user: req.user,
            teacher,
            stats,
            myClasses,
            todaySchedule,
            recentHomework,
            notices,
            totalStudents,
            pendingHomework,
            avgAttendance,
            hwLabels,
            hwCompleted,
            hwPending,
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        req.flash('error', 'Something went wrong');
        res.redirect('/');
    }
};
