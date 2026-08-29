const db = require('../../config/database');
const { isAttendanceLocked, logAttendanceAudit, calculateStudentAttendanceStats, getWorkingDaysInRange, calculateTeacherAttendanceSummary, formatDateISO } = require('../../services/attendanceEngineService');
const NotificationService = require('../../services/notificationService');
const templates = require('../../utils/notificationTemplates');
const NotificationModel = require('../../models/notificationModel');
const { sortClasses, formatClassLabel } = require('../../utils/academicLabels');

const todayLocal = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const normalizeAttendanceDateKey = (value) => {
    if (!value) return '';
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return '';
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    return '';
};

const normalizeStudentAttendanceStatus = (rawStatus) => {
    if (!rawStatus) return null;
    const s = String(rawStatus).toLowerCase().trim();
    if (s === 'present' || s === 'p') return 'present';
    if (s === 'absent' || s === 'a') return 'absent';
    if (s === 'late' || s === 'l') return 'late';
    if (s === 'half-day' || s === 'half_day' || s === 'h') return 'half-day';
    if (s === 'leave' || s === 'lv' || s === 'paid_leave' || s === 'medical_leave' || s === 'unpaid_leave' || s === 'excused') return 'leave';
    return null;
};

const normalizeStaffAttendanceStatus = (rawStatus, allowLate = false) => {
    if (!rawStatus) return null;
    const s = String(rawStatus).toLowerCase().trim();
    if (s === 'absent' || s === 'a') return 'absent';
    if (s === 'present' || s === 'p') return 'present';
    if (s === 'half-day' || s === 'half_day' || s === 'h') return 'half-day';
    if (s === 'leave' || s === 'lv' || s === 'paid_leave' || s === 'medical_leave') return 'leave';
    if (allowLate && (s === 'late' || s === 'l')) return 'late';
    return null;
};

exports.getMarkAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { class_id, section_id, date } = req.query;
        const targetDate = date || todayLocal();

        if (targetDate > todayLocal()) {
            req.flash('error', 'Attendance cannot be marked for future dates.');
            return res.redirect(`/schooladmin/attendance/mark?date=${todayLocal()}${class_id ? '&class_id=' + class_id : ''}${section_id ? '&section_id=' + section_id : ''}`);
        }

        const [rawClasses] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);
        const classes = sortClasses(rawClasses).map(c => ({
            ...c,
            label: formatClassLabel(c)
        }));
        let students = [];
        let existingAttendance = [];
        let sections = [];

        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';
        const lockStatus = await isAttendanceLocked(schoolId, targetDate, userRole);

        if (class_id) {
            const selectedClass = classes.find(c => c.id == class_id);
            if (selectedClass) {
                sections = classes.filter(c =>
                    c.class_name === selectedClass.class_name &&
                    (c.stream || '') === (selectedClass.stream || '') &&
                    (c.medium || '') === (selectedClass.medium || '')
                );
            };

            let studentQuery = `
                SELECT s.id, s.roll_no, s.admission_no, u.first_name as first_name, u.last_name as last_name, u.image as photo, s.roll_no as roll_number 
                FROM students s 
                JOIN users u ON s.user_id = u.id
                WHERE s.school_id = ? AND s.deleted_at IS NULL
            `;
            const queryParams = [schoolId];

            if (section_id === 'all') {
                const classIds = sections.map(c => c.id);
                studentQuery += ` AND s.class_id IN (?)`;
                queryParams.push(classIds);
            } else if (section_id) {
                studentQuery += ` AND s.class_id = ?`;
                queryParams.push(section_id);
            } else {
                studentQuery += ` AND s.class_id = ?`;
                queryParams.push(class_id);
            };

            studentQuery += ` ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC, u.first_name ASC`;
            [students] = await db.query(studentQuery, queryParams);

            const studentIds = students.map(s => s.id);
            if (studentIds.length > 0) {
                [existingAttendance] = await db.query(
                    `SELECT * FROM attendance 
                    WHERE student_id IN (?) AND date = ? AND school_id = ?`,
                    [studentIds, targetDate, schoolId]
                );
            };
        };

        res.render('schoolAdmin/attendance/mark', {
            title: 'Mark Attendance',
            classes,
            sections,
            students,
            class_id,
            section_id: section_id || '',
            date: targetDate,
            existingAttendance,
            lockStatus
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load attendance page');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.postMarkAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { date, attendance, class_id, section_id, unlock_reason, reason: formReason } = req.body;
        const markedBy = req.user?.id || req.session?.user?.id;
        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';
        const absentStudentIds = [];

        const lockStatus = await isAttendanceLocked(schoolId, date, userRole);
        if (lockStatus.isLocked) {
            req.flash('error', lockStatus.reason || 'Attendance is locked for this date.');
            return res.redirect(`/schooladmin/attendance/mark?date=${date}&class_id=${class_id}`);
        }

        const auditReason = unlock_reason || formReason || (lockStatus.requiresReason ? 'School Admin unlock override' : 'Marked via Admin Portal');

        const conn = await db.getConnection();
        await conn.beginTransaction();

        try {
            for (const [key, rawStatus] of Object.entries(attendance || {})) {
                const studentId = Number(String(key).replace('student_', ''));
                if (!studentId || !date) continue;
                if (!rawStatus || rawStatus === '' || rawStatus === 'unmarked') continue;

                const status = normalizeStudentAttendanceStatus(rawStatus);
                if (!status) {
                    console.warn(`[Student Attendance] Skipping invalid status '${rawStatus}' for student ${studentId}`);
                    continue;
                }

                const [existingRows] = await conn.execute(
                    'SELECT status FROM attendance WHERE student_id = ? AND DATE(date) = DATE(?) AND school_id = ? LIMIT 1',
                    [studentId, date, schoolId]
                );
                const existing = existingRows[0] || null;

                const [studentRows] = await conn.execute(
                    'SELECT id, class_id FROM students WHERE id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
                    [studentId, schoolId]
                );
                const student = studentRows[0];
                if (!student) continue;

                await conn.execute(
                    `INSERT INTO attendance (school_id, class_id, student_id, date, status, marked_by, source)
                    VALUES (?, ?, ?, ?, ?, ?, 'web')
                    ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), status = VALUES(status), marked_by = VALUES(marked_by), source = VALUES(source)`,
                    [schoolId, student.class_id || null, studentId, date, status, markedBy]
                );

                if (!existing || existing.status !== status) {
                    logAttendanceAudit({
                        school_id: schoolId,
                        entity_type: 'student',
                        entity_id: studentId,
                        class_id: student.class_id,
                        date,
                        old_status: existing ? existing.status : null,
                        new_status: status,
                        action: existing ? (lockStatus.requiresReason ? 'unlock_edit' : 'update') : 'mark',
                        reason: auditReason,
                        performed_by: markedBy,
                        user_role: userRole,
                        ip_address: req.ip
                    }).catch(err => console.error('[Audit Log Error]', err.message));
                }

                if (status === 'absent') {
                    absentStudentIds.push(studentId);
                };
            };
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        };

        if (absentStudentIds.length > 0) {

            for (const sId of absentStudentIds) {
                db.query(`
                    SELECT s.user_id, sf.father_email, sf.mother_email 
                    FROM students s
                    LEFT JOIN student_family sf ON s.id = sf.student_id
                    WHERE s.id = ?
                `, [sId]).then(([rows]) => {
                    if (rows && rows.length > 0) {
                        const row = rows[0];
                        NotificationService.createAndSend({
                            recipient_id: row.user_id,
                            recipient_role: "student",
                            school_id: schoolId,
                            created_by: markedBy,
                            ...templates.studentAbsent(date)
                        }).catch(err => console.error("Student absent notification error:", err));

                        const parentEmails = [row.father_email, row.mother_email].filter(Boolean);
                        for (const pEmail of parentEmails) {
                            NotificationModel.enqueueEmail(
                                pEmail,
                                `[SchoolSync] Student Absent Notification`,
                                `<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #edf2f7; border-radius: 8px;">
                                    <h2 style="color: #e53e3e;">Absent Alert</h2>
                                    <p>Dear Parent,</p>
                                    <p>Please note that your child was marked <b>ABSENT</b> on <b>${new Date(date).toLocaleDateString('en-IN')}</b>.</p>
                                    <p style="font-size: 12px; color: #a0aec0; margin-top: 20px;">SchoolSync Administration</p>
                                </div>`
                            ).catch(err => console.error("Parent email queue error:", err));
                        };
                    };
                }).catch(err => console.error("Query student parent emails failed:", err));
            };
        };

        req.flash('success', 'Attendance marked successfully');
        res.redirect(`/schooladmin/attendance/mark?date=${date}&class_id=${class_id}&section_id=${section_id || ''}`);
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to mark attendance');
        res.redirect('/schooladmin/attendance/mark');
    };
};

exports.getAttendanceReport = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { class_id, section_id, month, year } = req.query;
        const targetYear = Number(year) || new Date().getFullYear();
        const targetMonth = Number(month) || new Date().getMonth() + 1;
        const [rawClasses] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);
        const classes = sortClasses(rawClasses).map(c => ({
            ...c,
            label: formatClassLabel(c)
        }));
        let report = [];
        let sections = [];

        if (class_id) {
            const selectedClass = classes.find(c => c.id == class_id);
            if (selectedClass) {
                sections = classes.filter(c =>
                    c.class_name === selectedClass.class_name && (c.stream || '') === (selectedClass.stream || '') && (c.medium || '') === (selectedClass.medium || '')
                );
            }

            let studentQuery = `
                SELECT s.id, u.first_name as first_name, u.last_name as last_name, s.roll_no as roll_number 
                FROM students s 
                JOIN users u ON s.user_id = u.id
                WHERE s.school_id = ? AND s.deleted_at IS NULL
            `;
            const studentParams = [schoolId];

            if (section_id) {
                studentQuery += ` AND s.class_id = ?`;
                studentParams.push(section_id);
            } else if (selectedClass) {
                const classIds = sections.map(c => c.id);
                studentQuery += ` AND s.class_id IN (?)`;
                studentParams.push(classIds);
            } else {
                studentQuery += ` AND s.class_id = ?`;
                studentParams.push(class_id);
            };

            studentQuery += ` ORDER BY s.roll_no ASC`;
            const [students] = await db.query(studentQuery, studentParams);

            const startDateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
            const lastDay = new Date(targetYear, targetMonth, 0).getDate();
            const endDateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

            for (const student of students) {
                const stats = await calculateStudentAttendanceStats(schoolId, student.id, startDateStr, endDateStr);
                report.push({
                    ...student,
                    total_days: stats.totalWorkingDays,
                    present_days: stats.presentDays,
                    absent_days: stats.absentDays,
                    late_days: stats.lateDays,
                    half_days: stats.halfDays,
                    leave_days: stats.leaveDays,
                    percentage: stats.percentage
                });
            };
        };

        res.render('schoolAdmin/attendance/report', {
            title: 'Attendance Report',
            classes,
            sections,
            report,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getCalendarView = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { student_id, month, year } = req.query;
        const targetMonth = Number(month) || new Date().getMonth() + 1;
        const targetYear = Number(year) || new Date().getFullYear();
        const [students] = await db.query(
            'SELECT s.id, u.first_name as first_name, u.last_name as last_name FROM students s JOIN users u ON s.user_id = u.id WHERE s.school_id = ? AND s.deleted_at IS NULL LIMIT 50',
            [schoolId]
        );

        let calendarData = [];
        if (student_id) {
            [calendarData] = await db.query(
                `SELECT date, status FROM attendance 
                WHERE student_id = ? AND YEAR(date) = ? AND MONTH(date) = ?`,
                [student_id, targetYear, targetMonth]
            );
        };

        res.render('schoolAdmin/attendance/calendar', {
            title: 'Attendance Calendar',
            students,
            student_id,
            month: targetMonth,
            year: targetYear,
            calendarData
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load calendar');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getDefaulters = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { class_id, threshold } = req.query;
        const minPercentage = Number(threshold) || 75;

        const [students] = await db.query(`
            SELECT s.id, u.first_name as first_name, u.last_name as last_name, s.roll_no as roll_number, c.class_name as class_name, c.section as section_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.school_id = ? AND s.deleted_at IS NULL ${class_id ? 'AND s.class_id = ?' : ''}
            ORDER BY s.roll_no ASC
        `, class_id ? [schoolId, class_id] : [schoolId]);

        const startDateStr = `${new Date().getFullYear()}-01-01`;
        const endDateStr = todayLocal();

        const defaulters = [];
        for (const student of students) {
            const stats = await calculateStudentAttendanceStats(schoolId, student.id, startDateStr, endDateStr);
            if (stats.totalWorkingDays > 0 && stats.percentage < minPercentage) {
                defaulters.push({
                    ...student,
                    total_days: stats.totalWorkingDays,
                    present_days: stats.presentDays,
                    percentage: stats.percentage
                });
            }
        }

        const [rawClasses] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);
        const classes = sortClasses(rawClasses).map(c => ({
            ...c,
            label: formatClassLabel(c)
        }));

        res.render('schoolAdmin/attendance/defaulters', {
            title: 'Attendance Defaulters',
            defaulters,
            classes,
            threshold: minPercentage
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load defaulters');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.monthlyReport = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { class_id, month } = req.query;
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const [y, m] = targetMonth.split('-');
        const [rawClasses] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);
        const classes = sortClasses(rawClasses).map(c => ({
            ...c,
            label: formatClassLabel(c)
        }));
        let cls = null;
        let students = [];
        let attendanceMap = {};
        let days = [];

        if (class_id) {
            const [[foundClass]] = await db.query(
                'SELECT * FROM classes WHERE id = ? AND school_id = ?',
                [class_id, schoolId]
            );
            cls = foundClass;

            if (cls) {
                const totalDaysInMonth = new Date(y, m, 0).getDate();
                const startDateStr = `${y}-${String(m).padStart(2, '0')}-01`;
                const endDateStr = `${y}-${String(m).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

                const workingDaysList = await getWorkingDaysInRange(schoolId, startDateStr, endDateStr);
                const workingDaySet = new Set(workingDaysList.map(w => w.date));

                const dayFullNames = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };

                for (let d = 1; d <= totalDaysInMonth; d++) {
                    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const dateObj = new Date(parseInt(y), parseInt(m) - 1, d);
                    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                    const isHoliday = !workingDaySet.has(dateStr);
                    days.push({ date: dateStr, day: d, dayName, isHoliday, isHalfDay: false });
                }

                [students] = await db.query(
                    `SELECT s.id, u.first_name as first_name, u.last_name as last_name, s.roll_no as roll_no 
                    FROM students s 
                    JOIN users u ON s.user_id = u.id 
                    WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL 
                    ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC`,
                    [class_id, schoolId]
                );

                const studentIds = students.map(s => s.id);
                if (studentIds.length > 0) {
                    const nextMonth = new Date(parseInt(y), parseInt(m), 1);
                    const nextY = nextMonth.getFullYear();
                    const nextM = String(nextMonth.getMonth() + 1).padStart(2, '0');
                    const nextStartDateStr = `${nextY}-${nextM}-01`;

                    const [records] = await db.query(
                        `SELECT student_id, date, status 
                        FROM attendance 
                        WHERE student_id IN (?) AND school_id = ? AND date >= ? AND date < ?
                        ORDER BY date ASC, id ASC`,
                        [studentIds, schoolId, startDateStr, nextStartDateStr]
                    );

                    for (const r of records) {
                        const dateKey = normalizeAttendanceDateKey(r.date);
                        if (!dateKey || !dateKey.startsWith(targetMonth)) continue;
                        if (!attendanceMap[r.student_id]) {
                            attendanceMap[r.student_id] = {};
                        }
                        attendanceMap[r.student_id][dateKey] = r.status;
                    };
                };
            };
        };

        res.render('schoolAdmin/attendance/monthly', {
            title: 'Student Monthly Attendance',
            classes,
            cls,
            class_id,
            month: targetMonth,
            students,
            attendanceMap,
            days
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load monthly attendance report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.teacherMonthlyAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { month } = req.query;
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const [y, m] = targetMonth.split('-');
        const totalDaysInMonth = new Date(y, m, 0).getDate();
        const startDateStr = `${y}-${String(m).padStart(2, '0')}-01`;
        const endDateStr = `${y}-${String(m).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

        const workingDaysList = await getWorkingDaysInRange(schoolId, startDateStr, endDateStr);
        const workingDaySet = new Set(workingDaysList.map(w => w.date));

        const days = [];
        for (let d = 1; d <= totalDaysInMonth; d++) {
            const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dateObj = new Date(parseInt(y), parseInt(m) - 1, d);
            const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            const isHoliday = !workingDaySet.has(dateStr);
            days.push({ date: dateStr, day: d, dayName, isHoliday, isHalfDay: false });
        };

        const [teachers] = await db.query(
            `SELECT t.id, u.first_name as first_name, u.last_name as last_name, u.email 
            FROM teachers t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.school_id = ? AND t.deleted_at IS NULL 
            ORDER BY u.first_name ASC, u.last_name ASC`,
            [schoolId]
        );

        const teacherIds = teachers.map(t => t.id);
        const attendanceMap = {};
        if (teacherIds.length > 0) {
            const nextMonth = new Date(parseInt(y), parseInt(m), 1);
            const nextY = nextMonth.getFullYear();
            const nextM = String(nextMonth.getMonth() + 1).padStart(2, '0');
            const nextStartDateStr = `${nextY}-${nextM}-01`;

            const [records] = await db.query(
                `SELECT teacher_id, date, status
                FROM teacher_attendance
                WHERE teacher_id IN (?)
                  AND school_id = ?
                  AND date >= ?
                  AND date < ?
                ORDER BY date ASC, id ASC`,
                [teacherIds, schoolId, startDateStr, nextStartDateStr]
            );

            for (const r of records) {
                const dateKey = normalizeAttendanceDateKey(r.date);
                if (!dateKey || !dateKey.startsWith(targetMonth)) continue;
                const tid = r.teacher_id;
                if (!attendanceMap[tid]) {
                    attendanceMap[tid] = {};
                }
                attendanceMap[tid][dateKey] = r.status;
            };
        };

        res.render('schoolAdmin/attendance/teacherMonthly', {
            title: 'Teacher Monthly Attendance',
            month: targetMonth,
            teachers,
            attendanceMap,
            days
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load teacher monthly attendance report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.driverMonthlyAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { month } = req.query;
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const [y, m] = targetMonth.split('-');
        const totalDaysInMonth = new Date(y, m, 0).getDate();
        const startDateStr = `${y}-${String(m).padStart(2, '0')}-01`;
        const endDateStr = `${y}-${String(m).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

        const workingDaysList = await getWorkingDaysInRange(schoolId, startDateStr, endDateStr);
        const workingDaySet = new Set(workingDaysList.map(w => w.date));

        const days = [];
        for (let d = 1; d <= totalDaysInMonth; d++) {
            const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dateObj = new Date(parseInt(y), parseInt(m) - 1, d);
            const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            const isHoliday = !workingDaySet.has(dateStr);
            days.push({ date: dateStr, day: d, dayName, isHoliday, isHalfDay: false });
        };

        const [drivers] = await db.query(
            `SELECT d.id, d.first_name as first_name, d.last_name as last_name, d.email 
            FROM drivers d 
            WHERE d.school_id = ? AND d.deleted_at IS NULL 
            ORDER BY d.first_name ASC, d.last_name ASC`,
            [schoolId]
        );

        const driverIds = drivers.map(d => d.id);
        const attendanceMap = {};
        if (driverIds.length > 0) {
            const nextMonth = new Date(parseInt(y), parseInt(m), 1);
            const nextY = nextMonth.getFullYear();
            const nextM = String(nextMonth.getMonth() + 1).padStart(2, '0');
            const nextStartDateStr = `${nextY}-${nextM}-01`;

            const [records] = await db.query(
                `SELECT driver_id, date, status
                FROM driver_attendance
                WHERE driver_id IN (?)
                  AND school_id = ?
                  AND date >= ?
                  AND date < ?
                ORDER BY date ASC, id ASC`,
                [driverIds, schoolId, startDateStr, nextStartDateStr]
            );

            for (const r of records) {
                const dateKey = normalizeAttendanceDateKey(r.date);
                if (!dateKey || !dateKey.startsWith(targetMonth)) continue;
                const did = r.driver_id;
                if (!attendanceMap[did]) {
                    attendanceMap[did] = {};
                };
                attendanceMap[did][dateKey] = r.status;
            };
        };

        res.render('schoolAdmin/attendance/driverMonthly', {
            title: 'Driver Monthly Attendance',
            month: targetMonth,
            drivers,
            attendanceMap,
            days
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load driver monthly attendance report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getMarkTeacherAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { date } = req.query;
        const targetDate = date || todayLocal();

        if (targetDate > todayLocal()) {
            req.flash('error', 'Attendance cannot be marked for future dates.');
            return res.redirect(`/schooladmin/attendance/teachers/mark?date=${todayLocal()}`);
        }
        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';
        const lockStatus = await isAttendanceLocked(schoolId, targetDate, userRole);
        const teacherSummary = await calculateTeacherAttendanceSummary(schoolId, targetDate);

        const [teachers] = await db.query(
            `SELECT t.id AS teacher_id, u.first_name AS first_name, u.last_name AS last_name, u.email, ta.status as attendanceStatus
            FROM teachers t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN teacher_attendance ta ON t.id = ta.teacher_id AND DATE(ta.date) = DATE(?) AND ta.school_id = ?
            WHERE t.school_id = ? AND t.deleted_at IS NULL AND u.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name`,
            [targetDate, schoolId, schoolId]
        );

        res.render('schoolAdmin/attendance/teacherMark', {
            title: 'Teacher Attendance',
            teachers,
            date: targetDate,
            lockStatus,
            teacherSummary
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load teacher attendance page');
        res.redirect('/schooladmin/attendance/teachers/mark');
    };
};

exports.postMarkTeacherAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { date, attendance, unlock_reason, reason } = req.body;
        const targetDate = date ? formatDateISO(date) : todayLocal();
        const markedBy = req.user?.id || req.session?.user?.id || null;
        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';

        if (!attendance || typeof attendance !== 'object' || Object.keys(attendance).length === 0) {
            req.flash('error', 'No teacher attendance selected. Please select status for the teachers.');
            return res.redirect(`/schooladmin/attendance/teachers/mark?date=${targetDate}`);
        };

        const lockStatus = await isAttendanceLocked(schoolId, targetDate, userRole);
        if (lockStatus.isLocked) {
            req.flash('error', lockStatus.reason || 'Attendance is locked for this date.');
            return res.redirect(`/schooladmin/attendance/teachers/mark?date=${targetDate}`);
        };

        const auditReason = unlock_reason || reason || (lockStatus.requiresReason ? 'School Admin unlock override' : 'Teacher attendance update by Admin');
        const conn = await db.getConnection();
        await conn.beginTransaction();

        try {
            const skipped = [];
            const savedTeacherIds = [];
            const totalSubmitted = Object.keys(attendance || {}).length;

            for (const [teacherKey, rawStatus] of Object.entries(attendance || {})) {
                const cleanKey = String(teacherKey).replace(/^teacher_/, '').trim();
                const teacherId = Number(cleanKey);

                if (!Number.isInteger(teacherId) || teacherId < 0 || !targetDate) {
                    skipped.push({
                        teacherId: teacherKey,
                        name: `Teacher ID ${teacherKey}`,
                        reason: 'invalid teacher ID or date format'
                    });
                    continue;
                };

                const [teacherRows] = await conn.execute(
                    `SELECT t.id, u.first_name, u.last_name 
                     FROM teachers t 
                     JOIN users u ON t.user_id = u.id 
                     WHERE t.id = ? AND t.school_id = ? AND t.deleted_at IS NULL AND u.deleted_at IS NULL LIMIT 1`,
                    [teacherId, schoolId]
                );

                if (!teacherRows.length) {
                    const [diagRows] = await conn.execute(
                        `SELECT t.id, t.school_id, t.deleted_at, u.first_name, u.last_name, u.deleted_at AS user_deleted 
                         FROM teachers t 
                         LEFT JOIN users u ON t.user_id = u.id 
                         WHERE t.id = ? LIMIT 1`,
                        [teacherId]
                    );
                    let skipReason = 'teacher record not found in system';
                    let tName = `Teacher ID ${teacherId}`;

                    if (diagRows.length === 0) {
                        skipReason = 'teacher record does not exist';
                    } else {
                        const d = diagRows[0];
                        if (d.first_name || d.last_name) {
                            tName = `${d.first_name || ''} ${d.last_name || ''}`.trim();
                        };
                        if (d.deleted_at !== null || d.user_deleted !== null) {
                            skipReason = 'teacher account is deactivated / soft-deleted';
                        } else if (d.school_id !== schoolId) {
                            skipReason = `school ID mismatch (belongs to school ${d.school_id}, current is ${schoolId})`;
                        };
                    };
                    skipped.push({ teacherId, name: tName, reason: skipReason });
                    continue;
                };

                const teacherObj = teacherRows[0];
                const teacherFullName = `${teacherObj.first_name || ''} ${teacherObj.last_name || ''}`.trim();

                const status = normalizeStaffAttendanceStatus(rawStatus);
                if (!status) {
                    skipped.push({
                        teacherId,
                        name: teacherFullName || `Teacher ID ${teacherId}`,
                        reason: `invalid status '${rawStatus}'`
                    });
                    continue;
                };

                const [existingRows] = await conn.execute(
                    `SELECT status FROM teacher_attendance WHERE teacher_id = ? AND DATE(date) = DATE(?) AND school_id = ? LIMIT 1`,
                    [teacherId, targetDate, schoolId]
                );
                const existing = existingRows[0] || null;

                await conn.execute(
                    `INSERT INTO teacher_attendance (school_id, teacher_id, date, status, marked_by)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by)`,
                    [schoolId, teacherId, targetDate, status, markedBy]
                );

                savedTeacherIds.push(teacherId);

                if (!existing || existing.status !== status) {
                    logAttendanceAudit({
                        school_id: schoolId,
                        entity_type: 'teacher',
                        entity_id: teacherId,
                        date: targetDate,
                        old_status: existing ? existing.status : null,
                        new_status: status,
                        action: existing ? (lockStatus.requiresReason ? 'unlock_edit' : 'update') : 'mark',
                        reason: auditReason,
                        performed_by: markedBy,
                        user_role: userRole,
                        ip_address: req.ip
                    }).catch(e => console.error('[Audit Log Error]', e.message));
                };
            };

            if (savedTeacherIds.length > 0) {
                const [verifyRows] = await conn.query(
                    `SELECT teacher_id, status FROM teacher_attendance WHERE school_id = ? AND teacher_id IN (?) AND DATE(date) = DATE(?)`,
                    [schoolId, savedTeacherIds, targetDate]
                );
                if (verifyRows.length !== savedTeacherIds.length) {
                    throw new Error(`Integrity check failed: Expected ${savedTeacherIds.length} records in teacher_attendance, but verified ${verifyRows.length}. Rolling back.`);
                };
            };

            await conn.commit();

            if (skipped.length === 0) {
                req.flash('success', 'Teacher attendance saved successfully');
            } else if (savedTeacherIds.length > 0) {
                const skipDetails = skipped.map(s => `${s.name} (ID: ${s.teacherId}) was not recorded: ${s.reason}`).join('; ');
                req.flash('warning', `Attendance saved for ${savedTeacherIds.length} teacher(s), but ${skipped.length} teacher(s) were skipped: ${skipDetails}`);
            } else {
                const skipDetails = skipped.map(s => `${s.name} (ID: ${s.teacherId}) was not recorded: ${s.reason}`).join('; ');
                req.flash('error', `Attendance was NOT saved for any teacher. ${skipDetails}`);
            }
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        };

        res.redirect(`/schooladmin/attendance/teachers/mark?date=${targetDate}`);
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to save teacher attendance: ' + (err.message || 'Server error'));
        res.redirect('/schooladmin/attendance/teachers/mark');
    };
};

exports.getMarkDriverAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { date } = req.query;
        const targetDate = date || todayLocal();

        if (targetDate > todayLocal()) {
            req.flash('error', 'Attendance cannot be marked for future dates.');
            return res.redirect(`/schooladmin/attendance/drivers/mark?date=${todayLocal()}`);
        };
        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';
        const lockStatus = await isAttendanceLocked(schoolId, targetDate, userRole);
        const [drivers] = await db.query(
            `SELECT d.id, d.first_name, d.last_name, d.phone, d.email, d.image as photo, da.status as attendanceStatus
            FROM drivers d
            LEFT JOIN driver_attendance da ON d.id = da.driver_id AND DATE(da.date) = DATE(?) AND da.school_id = ?
            WHERE d.school_id = ? AND d.deleted_at IS NULL
            ORDER BY d.first_name, d.last_name`,
            [targetDate, schoolId, schoolId]
        );

        res.render('schoolAdmin/attendance/driverMark', {
            title: 'Driver Attendance',
            drivers,
            date: targetDate,
            lockStatus
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load driver attendance page');
        res.redirect('/schooladmin/attendance');
    };
};

exports.postMarkDriverAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { date, attendance, unlock_reason, reason } = req.body;
        const targetDate = date ? formatDateISO(date) : todayLocal();
        const markedBy = req.user?.id || req.session?.user?.id || null;
        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';

        if (!attendance || typeof attendance !== 'object' || Object.keys(attendance).length === 0) {
            req.flash('error', 'No driver attendance selected. Please select status for the drivers.');
            return res.redirect(`/schooladmin/attendance/drivers/mark?date=${targetDate}`);
        };

        const lockStatus = await isAttendanceLocked(schoolId, targetDate, userRole);
        if (lockStatus.isLocked) {
            req.flash('error', lockStatus.reason || 'Attendance is locked for this date.');
            return res.redirect(`/schooladmin/attendance/drivers/mark?date=${targetDate}`);
        };

        const auditReason = unlock_reason || reason || (lockStatus.requiresReason ? 'School Admin unlock override' : 'Driver attendance update by Admin');
        const conn = await db.getConnection();
        await conn.beginTransaction();

        try {
            const skipped = [];
            const savedDriverIds = [];

            for (const [driverKey, rawStatus] of Object.entries(attendance || {})) {
                const cleanKey = String(driverKey).replace(/^driver_/, '').trim();
                const driverId = Number(cleanKey);
                if (!Number.isInteger(driverId) || driverId < 0 || !targetDate) {
                    skipped.push({
                        id: driverKey,
                        name: `Driver ID ${driverKey}`,
                        reason: 'invalid driver ID or date format'
                    });
                    continue;
                };

                const [driverRows] = await conn.execute(
                    'SELECT id, first_name, last_name FROM drivers WHERE id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
                    [driverId, schoolId]
                );
                if (!driverRows.length) {
                    skipped.push({
                        id: driverId,
                        name: `Driver ID ${driverId}`,
                        reason: 'driver not found or inactive for this school'
                    });
                    continue;
                };

                const status = normalizeStaffAttendanceStatus(rawStatus, true);
                if (!status) {
                    skipped.push({
                        id: driverId,
                        name: `${driverRows[0].first_name} ${driverRows[0].last_name}`.trim(),
                        reason: `invalid status '${rawStatus}'`
                    });
                    continue;
                };

                const [existingRows] = await conn.execute(
                    `SELECT status FROM driver_attendance WHERE driver_id = ? AND DATE(date) = DATE(?) AND school_id = ? LIMIT 1`,
                    [driverId, targetDate, schoolId]
                );
                const existing = existingRows[0] || null;

                await conn.execute(
                    `INSERT INTO driver_attendance (school_id, driver_id, date, status, marked_by)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by)`,
                    [schoolId, driverId, targetDate, status, markedBy]
                );

                savedDriverIds.push(driverId);

                if (!existing || existing.status !== status) {
                    logAttendanceAudit({
                        school_id: schoolId,
                        entity_type: 'driver',
                        entity_id: driverId,
                        date: targetDate,
                        old_status: existing ? existing.status : null,
                        new_status: status,
                        action: existing ? (lockStatus.requiresReason ? 'unlock_edit' : 'update') : 'mark',
                        reason: auditReason,
                        performed_by: markedBy,
                        user_role: userRole,
                        ip_address: req.ip
                    }).catch(e => console.error('[Audit Log Error]', e.message));
                };
            };

            if (savedDriverIds.length > 0) {
                const [verifyRows] = await conn.query(
                    `SELECT driver_id FROM driver_attendance WHERE school_id = ? AND driver_id IN (?) AND DATE(date) = DATE(?)`,
                    [schoolId, savedDriverIds, targetDate]
                );
                if (verifyRows.length !== savedDriverIds.length) {
                    throw new Error(`Integrity check failed: Expected ${savedDriverIds.length} records in driver_attendance, but verified ${verifyRows.length}. Rolling back.`);
                };
            };

            await conn.commit();

            if (skipped.length === 0) {
                req.flash('success', 'Driver attendance saved successfully');
            } else if (savedDriverIds.length > 0) {
                const skipDetails = skipped.map(s => `${s.name} (ID: ${s.id}) was not recorded: ${s.reason}`).join('; ');
                req.flash('warning', `Attendance saved for ${savedDriverIds.length} driver(s), but ${skipped.length} were skipped: ${skipDetails}`);
            } else {
                const skipDetails = skipped.map(s => `${s.name} (ID: ${s.id}) was not recorded: ${s.reason}`).join('; ');
                req.flash('error', `Driver attendance was NOT saved. ${skipDetails}`);
            };
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        };

        res.redirect(`/schooladmin/attendance/drivers/mark?date=${targetDate}`);
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to save driver attendance: ' + (err.message || 'Database error'));
        res.redirect('/schooladmin/attendance/drivers/mark');
    };
};

exports.getMarkLibrarianAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { date } = req.query;
        const targetDate = date || todayLocal();

        if (targetDate > todayLocal()) {
            req.flash('error', 'Attendance cannot be marked for future dates.');
            return res.redirect(`/schooladmin/attendance/librarians/mark?date=${todayLocal()}`);
        };
        
        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';
        const lockStatus = await isAttendanceLocked(schoolId, targetDate, userRole);
        const [librarians] = await db.query(
            `SELECT l.id, u.first_name AS first_name, u.last_name AS last_name, u.email, u.phone, la.status as attendanceStatus
            FROM librarians l
            JOIN users u ON l.user_id = u.id
            LEFT JOIN librarian_attendance la ON l.id = la.librarian_id AND DATE(la.date) = DATE(?) AND la.school_id = ?
            WHERE l.school_id = ? AND u.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name`,
            [targetDate, schoolId, schoolId]
        );

        res.render('schoolAdmin/attendance/librarianMark', {
            title: 'Librarian Attendance',
            librarians,
            date: targetDate,
            lockStatus
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load librarian attendance page');
        res.redirect('/schooladmin/attendance');
    };
};

exports.postMarkLibrarianAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { date, attendance, unlock_reason, reason } = req.body;
        const targetDate = date ? formatDateISO(date) : todayLocal();
        const markedBy = req.user?.id || req.session?.user?.id || null;
        const userRole = req.user?.role || req.session?.user?.role || 'school_admin';

        if (!attendance || typeof attendance !== 'object' || Object.keys(attendance).length === 0) {
            req.flash('error', 'No librarian attendance selected. Please select status for the librarians.');
            return res.redirect(`/schooladmin/attendance/librarians/mark?date=${targetDate}`);
        };

        const lockStatus = await isAttendanceLocked(schoolId, targetDate, userRole);
        if (lockStatus.isLocked) {
            req.flash('error', lockStatus.reason || 'Attendance is locked for this date.');
            return res.redirect(`/schooladmin/attendance/librarians/mark?date=${targetDate}`);
        };

        const auditReason = unlock_reason || reason || (lockStatus.requiresReason ? 'School Admin unlock override' : 'Librarian attendance update by Admin');
        const conn = await db.getConnection();
        await conn.beginTransaction();

        try {
            const skipped = [];
            const savedLibrarianIds = [];

            for (const [key, rawStatus] of Object.entries(attendance || {})) {
                const cleanKey = String(key).replace(/^librarian_/, '').trim();
                const librarianId = Number(cleanKey);
                if (!Number.isInteger(librarianId) || librarianId < 0 || !targetDate) {
                    skipped.push({
                        id: key,
                        name: `Librarian ID ${key}`,
                        reason: 'invalid librarian ID or date format'
                    });
                    continue;
                };

                const [librarianRows] = await conn.execute(
                    `SELECT l.id, u.first_name, u.last_name 
                     FROM librarians l 
                     JOIN users u ON l.user_id = u.id 
                     WHERE l.id = ? AND l.school_id = ? AND u.deleted_at IS NULL LIMIT 1`,
                    [librarianId, schoolId]
                );
                if (!librarianRows.length) {
                    skipped.push({
                        id: librarianId,
                        name: `Librarian ID ${librarianId}`,
                        reason: 'librarian not found or inactive for this school'
                    });
                    continue;
                };

                const status = normalizeStaffAttendanceStatus(rawStatus);
                if (!status) {
                    skipped.push({
                        id: librarianId,
                        name: `${librarianRows[0].first_name} ${librarianRows[0].last_name}`.trim(),
                        reason: `invalid status '${rawStatus}'`
                    });
                    continue;
                };

                const [existingRows] = await conn.execute(
                    `SELECT status FROM librarian_attendance WHERE librarian_id = ? AND DATE(date) = DATE(?) AND school_id = ? LIMIT 1`,
                    [librarianId, targetDate, schoolId]
                );
                
                const existing = existingRows[0] || null;
                await conn.execute(
                    `INSERT INTO librarian_attendance (school_id, librarian_id, date, status, marked_by)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by)`,
                    [schoolId, librarianId, targetDate, status, markedBy]
                );

                savedLibrarianIds.push(librarianId);

                if (!existing || existing.status !== status) {
                    logAttendanceAudit({
                        school_id: schoolId,
                        entity_type: 'librarian',
                        entity_id: librarianId,
                        date: targetDate,
                        old_status: existing ? existing.status : null,
                        new_status: status,
                        action: existing ? (lockStatus.requiresReason ? 'unlock_edit' : 'update') : 'mark',
                        reason: auditReason,
                        performed_by: markedBy,
                        user_role: userRole,
                        ip_address: req.ip
                    }).catch(e => console.error('[Audit Log Error]', e.message));
                };
            };

            if (savedLibrarianIds.length > 0) {
                const [verifyRows] = await conn.query(
                    `SELECT librarian_id FROM librarian_attendance WHERE school_id = ? AND librarian_id IN (?) AND DATE(date) = DATE(?)`,
                    [schoolId, savedLibrarianIds, targetDate]
                );
                if (verifyRows.length !== savedLibrarianIds.length) {
                    throw new Error(`Integrity check failed: Expected ${savedLibrarianIds.length} records in librarian_attendance, but verified ${verifyRows.length}. Rolling back.`);
                };
            };

            await conn.commit();

            if (skipped.length === 0) {
                req.flash('success', 'Librarian attendance saved successfully');
            } else if (savedLibrarianIds.length > 0) {
                const skipDetails = skipped.map(s => `${s.name} (ID: ${s.id}) was not recorded: ${s.reason}`).join('; ');
                req.flash('warning', `Attendance saved for ${savedLibrarianIds.length} librarian(s), but ${skipped.length} were skipped: ${skipDetails}`);
            } else {
                const skipDetails = skipped.map(s => `${s.name} (ID: ${s.id}) was not recorded: ${s.reason}`).join('; ');
                req.flash('error', `Librarian attendance was NOT saved. ${skipDetails}`);
            };
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        };

        res.redirect(`/schooladmin/attendance/librarians/mark?date=${targetDate}`);
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to save librarian attendance: ' + (err.message || 'Database error'));
        res.redirect('/schooladmin/attendance/librarians/mark');
    };
};

exports.librarianMonthlyAttendance = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const { month } = req.query;
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const [y, m] = targetMonth.split('-');
        const totalDaysInMonth = new Date(y, m, 0).getDate();
        const startDateStr = `${y}-${String(m).padStart(2, '0')}-01`;
        const endDateStr = `${y}-${String(m).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

        const workingDaysList = await getWorkingDaysInRange(schoolId, startDateStr, endDateStr);
        const workingDaySet = new Set(workingDaysList.map(w => w.date));
        const days = [];
        for (let d = 1; d <= totalDaysInMonth; d++) {
            const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dateObj = new Date(parseInt(y), parseInt(m) - 1, d);
            const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            const isHoliday = !workingDaySet.has(dateStr);
            days.push({ date: dateStr, day: d, dayName, isHoliday, isHalfDay: false });
        };

        const [librarians] = await db.query(
            `SELECT l.id, u.first_name as first_name, u.last_name as last_name, u.email 
            FROM librarians l 
            JOIN users u ON l.user_id = u.id 
            WHERE l.school_id = ? AND u.deleted_at IS NULL 
            ORDER BY u.first_name ASC, u.last_name ASC`,
            [schoolId]
        );

        const librarianIds = librarians.map(l => l.id);
        const attendanceMap = {};
        if (librarianIds.length > 0) {
            const nextMonth = new Date(parseInt(y), parseInt(m), 1);
            const nextY = nextMonth.getFullYear();
            const nextM = String(nextMonth.getMonth() + 1).padStart(2, '0');
            const nextStartDateStr = `${nextY}-${nextM}-01`;

            const [records] = await db.query(
                `SELECT librarian_id, date, status
                FROM librarian_attendance
                WHERE librarian_id IN (?)
                    AND school_id = ?
                    AND date >= ?
                    AND date < ?
                ORDER BY date ASC, id ASC`,
                [librarianIds, schoolId, startDateStr, nextStartDateStr]
            );

            for (const r of records) {
                const dateKey = normalizeAttendanceDateKey(r.date);
                if (!dateKey || !dateKey.startsWith(targetMonth)) continue;
                const lid = r.librarian_id;
                if (!attendanceMap[lid]) {
                    attendanceMap[lid] = {};
                };
                attendanceMap[lid][dateKey] = r.status;
            };
        };

        res.render('schoolAdmin/attendance/librarianMonthly', {
            title: 'Librarian Monthly Attendance',
            month: targetMonth,
            librarians,
            attendanceMap,
            days
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load librarian monthly attendance report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getAttendanceIndex = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const today = todayLocal();
        const [rawClasses] = await db.query(
            'SELECT id, class_name as name, section, stream FROM classes WHERE school_id = ? ORDER BY class_name ASC',
            [schoolId]
        );

        const [markedRows] = await db.query(
            'SELECT DISTINCT class_id FROM attendance WHERE school_id = ? AND date = ?',
            [schoolId, today]
        ).catch(() => [[]]);

        const markedClassIds = new Set((markedRows || []).map(r => r.class_id));

        const classes = (rawClasses || []).map(cls => ({
            ...cls,
            isMarked: markedClassIds.has(cls.id)
        }));

        res.render('schoolAdmin/attendance/index', {
            title: 'Attendance Dashboard',
            classes,
            today
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load attendance dashboard');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getClassAttendanceStatus = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const today = todayLocal();

        const [markedRows] = await db.query(
            'SELECT DISTINCT class_id FROM attendance WHERE school_id = ? AND date = ?',
            [schoolId, today]
        ).catch(() => [[]]);

        const markedClassIds = (markedRows || []).map(r => r.class_id);
        res.json({ success: true, markedClassIds, today });
    } catch (err) {
        console.error('[Class Status API]', err.message);
        res.json({ success: false, markedClassIds: [] });
    };
};