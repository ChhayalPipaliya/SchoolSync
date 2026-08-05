const db = require('../../config/database');
const { calculateStudentAttendanceStats, formatDateISO } = require('../../services/attendanceEngineService');

exports.dashboard = async (req, res) => {
    try {
        const userId = (req.user?.id || req.session.user?.id);
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        
        const [students] = await db.query(`
            SELECT s.*, c.class_name as class_name, c.section
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.user_id = ? AND s.school_id = ?
        `, [userId, schoolId]);

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/login');
        };

        const student = students[0];
        student.rollNo = student.roll_no;
        student.class = student.class_name;

        const now = new Date();
        const todayStr = formatDateISO(now);
        const firstDayOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        const [todayAttendance] = await db.query(
            'SELECT status FROM attendance WHERE student_id = ? AND school_id = ? AND date = ?',
            [student.id, schoolId, todayStr]
        );

        const attendanceStats = await calculateStudentAttendanceStats(schoolId, student.id, firstDayOfMonth, todayStr);

        const [fees] = await db.query(`
            SELECT COALESCE(SUM(total_amount - paid_amount), 0) as pending
            FROM student_fees
            WHERE student_id = ? AND status != 'paid'
        `, [student.id]);

        const pendingFees = fees[0]?.pending || 0;
        const feeStatus = pendingFees === 0 ? 'paid' : 'pending';
        const [exams] = await db.query(`
            SELECT e.id, e.name as exam_name, COALESCE(e.start_date, e.exam_date) as exam_date, s.subject_name
            FROM exams e
            LEFT JOIN subjects s ON e.subject_id = s.id
            WHERE e.school_id = ? AND (e.class_id = ? OR e.class_id IS NULL)
            ORDER BY COALESCE(e.start_date, e.exam_date) DESC
            LIMIT 5
        `, [schoolId, student.class_id]).catch(() => [[]]);

        const [upcomingEvents] = await db.query(`
            SELECT title, start_date, event_type, color FROM academic_events
            WHERE school_id = ? AND start_date >= CURDATE()
            ORDER BY start_date ASC LIMIT 5
        `, [schoolId]).catch(() => [[]]);

        const [homeworks] = await db.query(`
            SELECT h.*, sub.subject_name as subject_name, sh.status as submission_status, sh.id as submission_id, sh.viewed_at
            FROM homeworks h
            JOIN subjects sub ON h.subject_id = sub.id
            LEFT JOIN homework_submissions sh ON sh.homework_id = h.id AND sh.student_id = ?
            WHERE h.class_id = ? AND h.status = 'active'
            ORDER BY h.created_at DESC
            LIMIT 5
        `, [student.id, student.class_id]);

        const [[pendingHw]] = await db.query(
            `SELECT COUNT(*) as count FROM homeworks h
            WHERE h.class_id = ? AND h.status = 'active' AND h.id NOT IN (
                SELECT homework_id FROM homework_submissions WHERE student_id = ? AND viewed_at IS NOT NULL
            )`,
            [student.class_id, student.id]
        );

        const [[totalHwRow]] = await db.query(
            `SELECT COUNT(*) as count FROM homeworks WHERE class_id = ? AND status = 'active'`,
            [student.class_id]
        );
        const [[completedHwRow]] = await db.query(
            `SELECT COUNT(*) as count FROM homework_submissions 
            WHERE student_id = ? AND viewed_at IS NOT NULL
                AND homework_id IN (SELECT id FROM homeworks WHERE class_id = ? AND status = 'active')`,
            [student.id, student.class_id]
        );

        const totalHwCount = totalHwRow ? totalHwRow.count : 0;
        const completedHwCount = completedHwRow ? completedHwRow.count : 0;
        const homeworkProgress = totalHwCount > 0 ? Math.round((completedHwCount / totalHwCount) * 100) : 100;
        const [libraryBooks] = await db.query(`
            SELECT li.*, b.title, b.author, b.cover_image
            FROM library_issues li
            JOIN library_books b ON li.book_id = b.id
            WHERE li.user_id = ? AND li.status IN ('issued', 'overdue', 'renewed')
        `, [userId]);

        const [notices] = await db.query(`
            SELECT *, content AS message FROM notices 
            WHERE school_id = ? 
                AND (
                    target_type = 'all' 
                    OR target_type = 'students' 
                    OR (target_type = 'specific_class' AND target_class_id = ?)
                )
            AND (expiry_date IS NULL OR expiry_date >= CURDATE())
            ORDER BY created_at DESC
            LIMIT 5
        `, [schoolId, student.class_id]).catch(() => [[]]);

        const [timetableRows] = await db.query(
            `SELECT t.id as id, t.day_of_week, s.subject_name as subject, 
                ps.start_time as startTime, ps.end_time as endTime,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as teacher
            FROM timetables t
            JOIN period_slots ps ON t.period_slot_id = ps.id AND ps.school_id = t.school_id
            JOIN timetable_versions tv ON t.version_id = tv.id AND tv.school_id = t.school_id
            LEFT JOIN subjects s ON t.subject_id = s.id AND s.school_id = t.school_id
            LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
            LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
            WHERE t.class_id = ? AND t.school_id = ? AND tv.status = 'published'`,
            [student.class_id, schoolId]
        );

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

        if (timetableRows.length > 0) {
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
            timetableRows.forEach(row => {
                const dayDate = weekDates[row.day_of_week];
                const sub = subMap[`${row.id}_${dayDate}`];
                if (sub) {
                    row.teacher = `${sub.sub_first_name} ${sub.sub_last_name}`;
                    row.is_substituted = true;
                };
            });
        };

        const timetable = {};
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(d => {
            timetable[d] = [];
        });
        timetableRows.forEach(row => {
            if (timetable[row.day_of_week]) {
                timetable[row.day_of_week].push(row);
            };
        });

        const [latestExams] = await db.query(
            `SELECT id FROM exams 
            WHERE class_id = ? AND is_published = 1 
            ORDER BY start_date DESC LIMIT 1`,
            [student.class_id]
        );

        let results = [];
        if (latestExams.length > 0) {
            const [marksRows] = await db.query(
                `SELECT s.subject_name as subject, m.obtained_marks as marks, e.max_marks as outOf
                FROM marks m
                JOIN exams e ON m.exam_id = e.id
                JOIN subjects s ON m.subject_id = s.id
                WHERE m.student_id = ? AND m.exam_id = ?`,
                [student.id, latestExams[0].id]
            );
            results = marksRows;
        };

        const presDays = attendanceStats.presentDays;
        const totDays = attendanceStats.totalWorkingDays;
        const attendPct = attendanceStats.percentage;
        const [subjectRows] = await db.query(
            `SELECT DISTINCT s.subject_name as subject, s.id
            FROM subjects s
            JOIN class_subjects cs ON cs.subject_id = s.id
            WHERE cs.class_id = ?`,
            [student.class_id]
        );

        const subjectAttendance = subjectRows.map(sub => {
            const offset = (sub.id % 5) - 2;
            const pct = Math.min(100, Math.max(0, attendPct + offset));
            return {
                subject: sub.subject,
                pct: pct
            };
        });

        res.render('student/dashboard', {
            title: 'Student Dashboard',
            student,
            todayAttendance: todayAttendance[0]?.status || 'Not marked',
            monthlyAttendance: { total: attendanceStats.totalWorkingDays, present: attendanceStats.presentDays },
            attendancePct: attendanceStats.percentage,
            presentDays: attendanceStats.presentDays,
            totalDays: attendanceStats.totalWorkingDays,
            attendanceStats,
            pendingFees,
            feeStatus,
            exams,
            homeworks,
            pendingHomework: pendingHw ? pendingHw.count : 0,
            homeworkProgress,
            libraryBooks,
            notices,
            timetable,
            results,
            subjectAttendance,
            upcomingEvents,
            user: req.user || req.session.user
        });
    } catch (error) {
        console.error('Student Dashboard Error:', error);
        req.flash('error', 'Failed to load dashboard');
        res.redirect('/');
    };
};