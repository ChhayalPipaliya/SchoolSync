const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const { isAttendanceLocked, logAttendanceAudit, getWorkingDaysInRange } = require('../../services/attendanceEngineService');
const NotificationService = require('../../services/notificationService');
const templates = require('../../utils/notificationTemplates');
const NotificationModel = require('../../models/notificationModel');

const todayLocal = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const normalizeStudentAttendanceStatus = (status) => {
    if (['present', 'absent', 'late', 'half-day', 'half_day', 'leave', 'paid_leave', 'medical_leave', 'unpaid_leave', 'excused'].includes(status)) return status;
    return 'absent';
};

exports.getMarkAttendance = async (req, res) => {
    try {
        const currentUser = req.session?.user || req.user;
        const teacher = await teacherPermissions.getLoggedInTeacher(req);
        const date = req.query.date || todayLocal();
        const requestedClassId = req.query.classId || req.query.class_id;
        const attendanceClass = await teacherPermissions.getAttendanceClassForTeacher(teacher.id, teacher.school_id);
        const lockStatus = await isAttendanceLocked(teacher.school_id, date, 'teacher');

        let students = [];
        let attendanceData = [];

        if (attendanceClass) {
            if (requestedClassId && String(requestedClassId) !== String(attendanceClass.class_id)) {
                req.flash('error', 'You are not allowed to mark attendance for this class.');
                return res.redirect('/teacher/attendance');
            };

            const [studentRows] = await db.execute(
                `SELECT s.id, s.roll_no, s.user_id, CONCAT_WS(' ', u.first_name, u.last_name) AS name
                FROM students s 
                JOIN users u ON s.user_id = u.id 
                WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL
                ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC`,
                [attendanceClass.class_id, teacher.school_id]
            );
            students = studentRows;

            const [attRows] = await db.execute(
                `SELECT student_id, status, remark FROM attendance
                WHERE class_id = ? AND date = ? AND school_id = ?`,
                [attendanceClass.class_id, date, teacher.school_id]
            );
            attendanceData = attRows;
        };

        res.render('teacher/attendance', {
            title: 'Mark Attendance',
            user: currentUser,
            attendanceClass,
            students,
            attendanceData,
            selectedClass: attendanceClass ? attendanceClass.class_id : null,
            selectedDate: date,
            lockStatus,
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Attendance Error:', error);
        req.flash('error', 'Failed to load attendance');
        res.redirect('/teacher/dashboard');
    };
};

exports.postMarkAttendance = async (req, res) => {
    try {
        const currentUser = req.session?.user || req.user;
        const teacher = await teacherPermissions.getLoggedInTeacher(req);

        const { class_id, date, attendance } = req.body;
        if (!date) {
            req.flash('error', 'Date is required.');
            return res.redirect('/teacher/attendance');
        };

        const lockStatus = await isAttendanceLocked(teacher.school_id, date, 'teacher');
        if (lockStatus.isLocked) {
            req.flash('error', lockStatus.reason || 'Attendance is locked after cutoff time.');
            return res.redirect(`/teacher/attendance?date=${date}`);
        }

        const attendanceClass = await teacherPermissions.getAttendanceClassForTeacher(teacher.id, teacher.school_id);
        if (!attendanceClass) {
            req.flash('error', 'No attendance class assigned. Please contact School Admin.');
            return res.redirect('/teacher/attendance');
        };

        if (class_id && String(class_id) !== String(attendanceClass.class_id)) {
            req.flash('error', 'You are not allowed to mark attendance for this class.');
            return res.redirect('/teacher/attendance');
        };

        const classId = attendanceClass.class_id;
        const conn = await db.getConnection();
        await conn.beginTransaction();
        const absentStudentIds = [];

        try {
            for (const [key, data] of Object.entries(attendance || {})) {
                const studentId = Number(String(key).replace('student_', ''));
                const rawStatus = typeof data === 'object' ? data?.status : data;
                if (!studentId || !date) continue;
                if (!rawStatus || rawStatus === '' || rawStatus === 'unmarked') continue;

                const status = normalizeStudentAttendanceStatus(rawStatus);
                const remark = typeof data === 'object' ? (data.remark || null) : null;

                const [existingRows] = await conn.execute(
                    'SELECT status FROM attendance WHERE student_id = ? AND date = ? AND school_id = ? LIMIT 1',
                    [studentId, date, teacher.school_id]
                );
                const oldStatus = existingRows.length > 0 ? existingRows[0].status : null;

                const [studentRows] = await conn.execute(
                    'SELECT id FROM students WHERE id = ? AND school_id = ? AND class_id = ? AND deleted_at IS NULL LIMIT 1',
                    [studentId, teacher.school_id, classId]
                );
                if (!studentRows.length) continue;

                await conn.execute(
                    `INSERT INTO attendance (school_id, class_id, student_id, marked_by, date, status, remark, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'teacher')
                    ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), marked_by = VALUES(marked_by), status = VALUES(status), remark = VALUES(remark), source = VALUES(source)`,
                    [teacher.school_id, classId, studentId, currentUser.id, date, status, remark]
                );

                if (oldStatus !== status) {
                    logAttendanceAudit({
                        school_id: teacher.school_id,
                        entity_type: 'student',
                        entity_id: studentId,
                        class_id: classId,
                        date,
                        old_status: oldStatus,
                        new_status: status,
                        action: oldStatus ? 'update' : 'mark',
                        reason: remark || 'Teacher marked attendance',
                        performed_by: currentUser.id,
                        user_role: 'teacher',
                        ip_address: req.ip
                    }).catch(err => console.error('[Teacher Audit Log Error]', err.message));
                }

                if (status === 'absent') {
                    absentStudentIds.push(studentId);
                };
            };
            await conn.commit();
            req.flash('success', 'Attendance marked successfully');
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
                            school_id: teacher.school_id,
                            created_by: currentUser.id,
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
        res.redirect(`/teacher/attendance?date=${date}`);
    } catch (error) {
        console.error('Mark Attendance Error:', error);
        req.flash('error', 'Failed to mark attendance');
        res.redirect('/teacher/attendance');
    };
};

exports.teacherMonthlyReport = async (req, res) => {
    try {
        const { class_id, month } = req.query;
        const currentUser = req.session?.user || req.user;
        const teacher = await teacherPermissions.getLoggedInTeacher(req);
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const [y, m] = targetMonth.split('-');

        const cls = await teacherPermissions.getAttendanceClassForTeacher(teacher.id, teacher.school_id);
        let students = [];
        let attendanceMap = {};
        let days = [];

        const selectedClassId = cls ? cls.class_id : null;
        if (cls) {
            if (class_id && String(class_id) !== String(cls.class_id)) {
                req.flash('error', 'You are not allowed to mark attendance for this class.');
                return res.redirect('/teacher/attendance/monthly');
            };

            const totalDaysInMonth = new Date(y, m, 0).getDate();
            const schoolId = teacher.school_id;
            const startDateStr = `${y}-${String(m).padStart(2, '0')}-01`;
            const endDateStr = `${y}-${String(m).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;
            const workingDaysList = await getWorkingDaysInRange(schoolId, startDateStr, endDateStr);
            const workingDaySet = new Set(workingDaysList.map(w => w.date));

            for (let d = 1; d <= totalDaysInMonth; d++) {
                const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dateObj = new Date(parseInt(y), parseInt(m) - 1, d);
                const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                const isHoliday = !workingDaySet.has(dateStr);
                days.push({ date: dateStr, day: d, dayName, isHoliday, isHalfDay: false });
            };

            const [studentRows] = await db.execute(
                `SELECT s.id, u.first_name as first_name, u.last_name as last_name, s.roll_no as roll_no 
                FROM students s 
                JOIN users u ON s.user_id = u.id 
                WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL
                ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC`,
                [selectedClassId, teacher.school_id]
            );
            students = studentRows;

            const studentIds = students.map(s => s.id);
            if (studentIds.length > 0) {
                const [records] = await db.query(
                    `SELECT student_id, DATE_FORMAT(date, '%Y-%m-%d') as dateStr, status 
                    FROM attendance 
                    WHERE student_id IN (?) AND DATE_FORMAT(date, '%Y-%m') = ? AND school_id = ?`,
                    [studentIds, targetMonth, teacher.school_id]
                );

                for (const r of records) {
                    if (!attendanceMap[r.student_id]) {
                        attendanceMap[r.student_id] = {};
                    };
                    attendanceMap[r.student_id][r.dateStr] = r.status;
                };
            };
        };

        res.render('teacher/attendanceMonthly', {
            title: 'Monthly Attendance Report',
            user: currentUser,
            attendanceClass: cls,
            cls,
            class_id: selectedClassId,
            month: targetMonth,
            students,
            attendanceMap,
            days,
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Monthly Attendance Error:', error);
        req.flash('error', 'Failed to load monthly attendance');
        res.redirect('/teacher/dashboard');
    };
};