const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const timetableService = require('../../services/timetableService');
const { isTodayWorkingDay, formatDateISO, getWorkingDaysInRange } = require('../../services/attendanceEngineService');

const buildClassLabel = (cls) => {
    if (!cls) return 'Not assigned';
    return [cls.name || cls.class_name, cls.section_name || cls.section].filter(Boolean).join(' - ') || 'Assigned class';
};

exports.getDashboard = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getLoggedInTeacher(req);
        const currentUser = req.session?.user || req.user;

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

        const parseTimeToMinutes = (tStr) => {
            if (!tStr) return 0;
            let str = String(tStr).trim().toUpperCase();
            const isPM = str.includes('PM');
            const isAM = str.includes('AM');
            str = str.replace(/[^\d:]/g, '');
            const parts = str.split(':');
            let h = parseInt(parts[0], 10) || 0;
            let m = parseInt(parts[1], 10) || 0;
            if (isPM && h < 12) h += 12;
            if (isAM && h === 12) h = 0;
            return h * 60 + m;
        };

        const getPeriodStatus = (startTime, endTime) => {
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const startMinutes = parseTimeToMinutes(startTime);
            const endMinutes = parseTimeToMinutes(endTime);

            if (currentMinutes < startMinutes) {
                return { status: 'upcoming', label: 'Upcoming', badgeClass: 'upcoming', dotClass: '' };
            } else if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
                return { status: 'ongoing', label: 'Ongoing', badgeClass: 'ongoing', dotClass: 'ongoing' };
            } else {
                return { status: 'completed', label: 'Completed', badgeClass: 'completed', dotClass: 'completed' };
            }
        };

        const todayDateStr = formatDateISO(new Date());
        const rawSchedule = await timetableService.getTeacherTimetableForDate(teacher.id, teacher.school_id, todayDateStr);
        const todaySchedule = rawSchedule.map((slot) => {
            const statusInfo = getPeriodStatus(slot.start_time, slot.end_time);
            return {
                ...slot,
                subject: slot.subject_name,
                startTime: slot.start_time,
                endTime: slot.end_time,
                className: [slot.class_name, slot.section_name || slot.section].filter(Boolean).join(' - '),
                status: statusInfo.status,
                statusLabel: statusInfo.label,
                badgeClass: statusInfo.badgeClass,
                dotClass: statusInfo.dotClass
            };
        });

        const [recentHomework] = await db.execute(
            `SELECT h.*, h.due_date as dueDate, c.class_name as class, c.section, s.subject_name as subject
            FROM homeworks h 
            JOIN classes c ON h.class_id = c.id 
            JOIN subjects s ON h.subject_id = s.id 
            WHERE h.teacher_id = ?
                AND h.school_id = ?
            ORDER BY h.created_at DESC 
            LIMIT 5`,
            [teacher.id, teacher.school_id]
        );

        const [notices] = await db.execute(
            `SELECT *, content AS message FROM notices 
            WHERE school_id = ? AND (target_type IN ('all', 'teachers'))
                AND (expiry_date IS NULL OR expiry_date >= CURDATE())
            ORDER BY created_at DESC
            LIMIT 5`,
            [teacher.school_id]
        ).catch(() => [[]]);

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
            `SELECT COUNT(DISTINCT s.id, h.id) as count
            FROM homeworks h
            JOIN students s ON h.class_id = s.class_id AND s.status = 'active' AND s.deleted_at IS NULL
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = s.id
            WHERE h.teacher_id = ?
                AND h.school_id = ?
                AND h.status = 'active'
                AND (hs.id IS NULL OR hs.status = 'pending')`,
            [teacher.id, teacher.school_id]
        );
        const pendingHomework = pendingHwRow ? pendingHwRow.count : 0;

        let presentStudentsCount = 0;
        let absentStudentsCount = 0;
        let leaveStudentsCount = 0;

        if (attendanceClass) {
            const [[todayAttSummary]] = await db.execute(
                `SELECT 
                    SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) as present_cnt,
                    SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_cnt,
                    SUM(CASE WHEN status IN ('leave', 'on_leave') THEN 1 ELSE 0 END) as leave_cnt
                FROM attendance
                WHERE class_id = ? AND school_id = ? AND date = ?`,
                [attendanceClass.class_id, teacher.school_id, todayDateStr]
            ).catch(() => [[{ present_cnt: 0, absent_cnt: 0, leave_cnt: 0 }]]);

            if (todayAttSummary) {
                presentStudentsCount = Number(todayAttSummary.present_cnt || 0);
                absentStudentsCount = Number(todayAttSummary.absent_cnt || 0);
                leaveStudentsCount = Number(todayAttSummary.leave_cnt || 0);
            }
        }

        let avgAttendance = 0;
        let monthlyAttendancePct = 0;
        let yearlyAttendancePct = 0;
        let attLabels = [];
        let attPresent = [];
        let attAbsent = [];
        let completedWorkingDaysCount = 0;
        let totalWorkingDaysCount = 0;
        let pendingWorkingDaysCount = 0;

        if (attendanceClass) {
            const now = new Date();
            const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

            const workingDaysInRange = await getWorkingDaysInRange(teacher.school_id, startOfMonth, todayDateStr);
            totalWorkingDaysCount = workingDaysInRange.length;

            const [markedDateRows] = await db.execute(
                `SELECT DISTINCT date FROM attendance WHERE class_id = ? AND school_id = ? AND date BETWEEN ? AND ?`,
                [attendanceClass.class_id, teacher.school_id, startOfMonth, todayDateStr]
            );
            const markedDateSet = new Set(markedDateRows.map(r => formatDateISO(r.date)));

            completedWorkingDaysCount = 0;
            pendingWorkingDaysCount = 0;
            workingDaysInRange.forEach(wd => {
                if (markedDateSet.has(wd.date)) {
                    completedWorkingDaysCount++;
                } else {
                    pendingWorkingDaysCount++;
                }
            });

            const [[monthAttRow]] = await db.execute(
                `SELECT 
                    SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 WHEN a.status IN ('half-day', 'half_day') THEN 0.5 ELSE 0 END) as present_count,
                    COUNT(*) as total_marked
                FROM attendance a
                WHERE a.class_id = ? AND a.school_id = ? AND a.date BETWEEN ? AND ?`,
                [attendanceClass.class_id, teacher.school_id, startOfMonth, todayDateStr]
            );

            const totalMarked = Number(monthAttRow?.total_marked || 0);
            const totalPresent = Number(monthAttRow?.present_count || 0);

            if (totalMarked > 0) {
                avgAttendance = Number(((totalPresent / totalMarked) * 100).toFixed(1));
            } else if (totalStudents > 0 && (presentStudentsCount + absentStudentsCount + leaveStudentsCount) > 0) {
                avgAttendance = Number(((presentStudentsCount / totalStudents) * 100).toFixed(1));
            } else {
                avgAttendance = 0;
            }

            const [attendanceRows] = await db.execute(
                `SELECT DATE_FORMAT(a.date, '%d %b') AS label,
                    SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) AS present_count,
                    SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent_count
                FROM attendance a
                WHERE a.class_id = ?
                    AND a.school_id = ?
                    AND a.date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                GROUP BY a.date
                ORDER BY a.date ASC`,
                [attendanceClass.class_id, teacher.school_id]
            );
            attLabels = attendanceRows.map((row) => row.label);
            attPresent = attendanceRows.map((row) => Number(row.present_count) || 0);
            attAbsent = attendanceRows.map((row) => Number(row.absent_count) || 0);
        }

        const isWorkingDay = await isTodayWorkingDay(teacher.school_id, todayDateStr);
        let todayAttendanceStatus = 'holiday';
        if (isWorkingDay && attendanceClass) {
            const [[todayAtt]] = await db.execute(
                `SELECT COUNT(*) as count FROM attendance WHERE class_id = ? AND school_id = ? AND date = ?`,
                [attendanceClass.class_id, teacher.school_id, todayDateStr]
            );
            todayAttendanceStatus = (todayAtt && todayAtt.count > 0) ? 'completed' : 'pending';
        };

        const pendingWarningCard = {
            show: isWorkingDay && attendanceClass && todayAttendanceStatus === 'pending',
            message: attendanceClass ? `Attendance Pending: You have not marked attendance for ${myClassLabel}.` : 'No attendance class assigned.',
            classId: attendanceClass ? attendanceClass.class_id : null
        };

        const [examsThisWeekRows] = await db.execute(
            `SELECT e.id, e.name AS exam_name, e.exam_date, s.subject_name, c.class_name, c.section
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN subjects s ON e.subject_id = s.id
            WHERE e.school_id = ? AND e.exam_date >= CURDATE()
            ORDER BY e.exam_date ASC
            LIMIT 5`,
            [teacher.school_id]
        ).catch(() => [[]]);

        const [leaveRequestsRows] = await db.execute(
            `SELECT COUNT(*) AS count FROM leave_applications
            WHERE school_id = ? AND applicant_type = 'teacher' AND applicant_id = ? AND status = 'pending'`,
            [teacher.school_id, teacher.id]
        ).catch(() => [[{ count: 0 }]]);
        const leaveRequestsCount = leaveRequestsRows[0]?.count || 0;

        const [birthdaysToday] = await db.execute(
            `SELECT u.first_name, u.last_name, 'student' AS role
            FROM students st
            JOIN users u ON u.id = st.user_id
            WHERE st.school_id = ? AND MONTH(st.date_of_birth) = MONTH(NOW()) AND DAY(st.date_of_birth) = DAY(NOW())
            LIMIT 5`,
            [teacher.school_id]
        ).catch(() => [[]]);

        const [upcomingEvents] = await db.execute(
            `SELECT title, start_date, event_type, color FROM academic_events
            WHERE school_id = ? AND start_date >= CURDATE()
            ORDER BY start_date ASC LIMIT 5`,
            [teacher.school_id]
        ).catch(() => [[]]);

        // Real recent activity for this teacher: last 5 actions (homework created, attendance marked, marks entered)
        let recentActivity = [];
        try {
            const [hwActivity] = await db.execute(
                `SELECT 'homework' AS type, h.title, c.class_name, c.section, h.created_at AS actioned_at
                FROM homeworks h
                JOIN classes c ON h.class_id = c.id AND c.school_id = h.school_id
                WHERE h.teacher_id = ? AND h.school_id = ?
                ORDER BY h.created_at DESC LIMIT 5`,
                [teacher.id, teacher.school_id]
            ).catch(() => [[]]);

            const [attActivity] = await db.execute(
                `SELECT 'attendance' AS type, c.class_name, c.section, MAX(a.updated_at) AS actioned_at
                FROM attendance a
                JOIN classes c ON a.class_id = c.id AND c.school_id = a.school_id
                WHERE a.marked_by = ? AND a.school_id = ?
                GROUP BY a.class_id, a.date
                ORDER BY actioned_at DESC LIMIT 5`,
                [req.user.id, teacher.school_id]
            ).catch(() => [[]]);

            const combined = [
                ...(hwActivity || []).map(r => ({ ...r, actioned_at: r.actioned_at })),
                ...(attActivity || []).map(r => ({ ...r, actioned_at: r.actioned_at }))
            ];
            combined.sort((a, b) => new Date(b.actioned_at) - new Date(a.actioned_at));
            recentActivity = combined.slice(0, 5);
        } catch (_) {}

        const stats = { totalStudents, todayAttendance: presentStudentsCount, weeklyHomeworks: recentHomework.length, assignedClasses: myClasses.length, todayClasses: todaySchedule.length, examsThisWeek: examsThisWeekRows.length, leaveRequests: leaveRequestsCount };


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
            monthlyAttendancePct,
            yearlyAttendancePct,
            attLabels,
            attPresent,
            attAbsent,
            isWorkingDay,
            todayAttendanceStatus,
            pendingWarningCard,
            presentStudentsCount,
            absentStudentsCount,
            leaveStudentsCount,
            completedWorkingDaysCount,
            totalWorkingDaysCount,
            pendingWorkingDaysCount,
            examsThisWeekRows,
            leaveRequestsCount,
            birthdaysToday,
            upcomingEvents,
            recentActivity,
            layout: 'teacher/layout'
        });

    } catch (error) {
        console.error('Dashboard Error:', error);
        req.flash('error', 'Something went wrong');
        res.redirect('/');
    };
};
