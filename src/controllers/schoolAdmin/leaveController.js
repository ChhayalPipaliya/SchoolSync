const db = require('../../config/database');
const NotificationService = require('../../services/notificationService');
const { logAttendanceAudit } = require('../../services/attendanceEngineService');

function toDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    return String(value).slice(0, 10);
};

function formatDateStr(d) {
    const dateStr = toDateOnly(d);
    if (!dateStr) return '';
    const [y, m, day] = dateStr.split('-');
    return `${day}/${m}/${y}`;
};

function getDatesInRange(startDate, endDate) {
    const dates = [];
    const start = new Date(`${toDateOnly(startDate)}T00:00:00`);
    const end = new Date(`${toDateOnly(endDate)}T00:00:00`);
    const current = new Date(start);

    while (!isNaN(current) && !isNaN(end) && current <= end) {
        dates.push(toDateOnly(current));
        current.setDate(current.getDate() + 1);
    };
    return dates;
};

function getSessionUser(req) {
    return req.user || req.session?.user || {};
};

function calcDays(from, to) {
    const d1 = new Date(`${toDateOnly(from)}T00:00:00`);
    const d2 = new Date(`${toDateOnly(to)}T00:00:00`);
    if (isNaN(d1) || isNaN(d2)) return 0;
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : 0;
};


async function markApprovedLeaveAbsent(tx, leave, dates, adminId) {
    if (!dates.length) return;

    if (leave.user_role === 'teacher') {
        const teachers = await tx.query(
            'SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1',
            [leave.user_id, leave.school_id]
        );
        const teacher = teachers[0];
        if (!teacher) throw new Error('Teacher profile not found for this leave applicant');
        for (const dateStr of dates) {
            const [[existing]] = await tx.query(
                `SELECT status FROM teacher_attendance WHERE teacher_id = ? AND DATE(date) = DATE(?) AND school_id = ? LIMIT 1`,
                [teacher.id, dateStr, leave.school_id]
            );
            await tx.query(
                `INSERT INTO teacher_attendance (school_id, teacher_id, date, status, marked_by)
                VALUES (?, ?, ?, 'leave', ?)
                ON DUPLICATE KEY UPDATE status = 'leave', marked_by = VALUES(marked_by)`,
                [leave.school_id, teacher.id, dateStr, adminId]
            );
            logAttendanceAudit({
                school_id: leave.school_id,
                entity_type: 'teacher',
                entity_id: teacher.id,
                date: dateStr,
                old_status: existing ? existing.status : null,
                new_status: 'leave',
                action: existing ? 'update' : 'mark',
                reason: 'Approved Leave Application',
                performed_by: adminId,
                user_role: 'school_admin'
            }).catch(e => console.error('[Leave Audit Error]', e.message));
        };
        return;
    };

    if (leave.user_role === 'student') {
        const students = await tx.query(
            'SELECT id, class_id FROM students WHERE user_id = ? AND school_id = ? LIMIT 1',
            [leave.user_id, leave.school_id]
        );
        const student = students[0];
        if (!student) {
            throw new Error('Student profile not found for this leave applicant');
        };

        const leaveStatus = leave.leave_type === 'sick' ? 'medical_leave' : (leave.leave_type === 'paid' ? 'paid_leave' : 'leave');
        for (const dateStr of dates) {
            const [[existing]] = await tx.query(
                `SELECT status FROM attendance WHERE student_id = ? AND date = ? AND school_id = ? LIMIT 1`,
                [student.id, dateStr, leave.school_id]
            );
            await tx.query(
                `INSERT INTO attendance (school_id, class_id, student_id, date, status, marked_by, source)
                VALUES (?, ?, ?, ?, ?, ?, 'leave_approval')
                ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), source = VALUES(source)`,
                [leave.school_id, student.class_id || null, student.id, dateStr, leaveStatus, adminId]
            );
            logAttendanceAudit({
                school_id: leave.school_id,
                entity_type: 'student',
                entity_id: student.id,
                class_id: student.class_id,
                date: dateStr,
                old_status: existing ? existing.status : null,
                new_status: leaveStatus,
                action: existing ? 'update' : 'mark',
                reason: 'Approved Leave Application',
                performed_by: adminId,
                user_role: 'school_admin'
            }).catch(e => console.error('[Leave Audit Error]', e.message));
        };
        return;
    };

    if (leave.user_role === 'driver') {
        const drivers = await tx.query(
            'SELECT id FROM drivers WHERE user_id = ? AND school_id = ? LIMIT 1',
            [leave.user_id, leave.school_id]
        );
        const driver = drivers[0];
        if (!driver) {
            throw new Error('Driver profile not found for this leave applicant');
        };

        for (const dateStr of dates) {
            const [[existing]] = await tx.query(
                `SELECT status FROM driver_attendance WHERE driver_id = ? AND DATE(date) = DATE(?) AND school_id = ? LIMIT 1`,
                [driver.id, dateStr, leave.school_id]
            );
            await tx.query(
                `INSERT INTO driver_attendance (school_id, driver_id, date, status, marked_by)
                VALUES (?, ?, ?, 'leave', ?)
                ON DUPLICATE KEY UPDATE status = 'leave', marked_by = VALUES(marked_by)`,
                [leave.school_id, driver.id, dateStr, adminId]
            );
            logAttendanceAudit({
                school_id: leave.school_id,
                entity_type: 'driver',
                entity_id: driver.id,
                date: dateStr,
                old_status: existing ? existing.status : null,
                new_status: 'leave',
                action: existing ? 'update' : 'mark',
                reason: 'Approved Leave Application',
                performed_by: adminId,
                user_role: 'school_admin'
            }).catch(e => console.error('[Leave Audit Error]', e.message));
        };
        return;
    };

    if (leave.user_role === 'librarian') {
        const librarians = await tx.query(
            'SELECT id FROM librarians WHERE user_id = ? AND school_id = ? LIMIT 1',
            [leave.user_id, leave.school_id]
        );
        const librarian = librarians[0];
        if (!librarian) {
            throw new Error('Librarian profile not found for this leave applicant');
        };

        for (const dateStr of dates) {
            const [[existing]] = await tx.query(
                `SELECT status FROM librarian_attendance WHERE librarian_id = ? AND DATE(date) = DATE(?) AND school_id = ? LIMIT 1`,
                [librarian.id, dateStr, leave.school_id]
            );
            await tx.query(
                `INSERT INTO librarian_attendance (school_id, librarian_id, date, status, marked_by)
                VALUES (?, ?, ?, 'leave', ?)
                ON DUPLICATE KEY UPDATE status = 'leave', marked_by = VALUES(marked_by)`,
                [leave.school_id, librarian.id, dateStr, adminId]
            );
            logAttendanceAudit({
                school_id: leave.school_id,
                entity_type: 'librarian',
                entity_id: librarian.id,
                date: dateStr,
                old_status: existing ? existing.status : null,
                new_status: 'leave',
                action: existing ? 'update' : 'mark',
                reason: 'Approved Leave Application',
                performed_by: adminId,
                user_role: 'school_admin'
            }).catch(e => console.error('[Leave Audit Error]', e.message));
        };
    };
};

const notifyApplicant = async (leave, status, reason = null) => {
    const isApproved = status === 'approved';
    await NotificationService.createAndSend({
        recipient_id: leave.user_id,
        recipient_role: leave.user_role,
        school_id: leave.school_id,
        title: isApproved ? 'Leave Approved' : 'Leave Rejected',
        message: isApproved ? `Your ${leave.leave_type} leave from ${formatDateStr(leave.from_date)} to ${formatDateStr(leave.to_date)} has been approved.` : `Your ${leave.leave_type} leave from ${formatDateStr(leave.from_date)} to ${formatDateStr(leave.to_date)} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
        type: isApproved ? 'success' : 'warning',
        category: 'general',
        reference_type: 'leave',
        reference_id: leave.id,
        action_url: `/${leave.user_role}/leaves`
    });
};

exports.listLeaves = async (req, res) => {
    try {
        const schoolId = getSessionUser(req).school_id;
        const { status, user_role, from_date, to_date } = req.query;

        let sql = `
            SELECT l.*,
                u.first_name AS first_name, u.last_name AS last_name, u.email, u.image,
                ab.first_name AS approver_first_name, ab.last_name AS approver_last_name
            FROM leaves l
            JOIN users u ON l.user_id = u.id
            LEFT JOIN users ab ON l.approved_by = ab.id
            WHERE l.school_id = ?
        `;
        const params = [schoolId];

        if (status) { sql += ' AND l.status = ?'; params.push(status); }
        if (user_role) { sql += ' AND l.user_role = ?'; params.push(user_role); }
        if (from_date) { sql += ' AND l.from_date >= ?'; params.push(from_date); }
        if (to_date) { sql += ' AND l.to_date <= ?'; params.push(to_date); }
        sql += ' ORDER BY FIELD(l.status, "pending", "approved", "rejected"), l.created_at DESC';
        const [leaves] = await db.query(sql, params);

        leaves.forEach(l => {
            l.days = calcDays(l.from_date, l.to_date);
        });

        const [[stats]] = await db.query(
            `SELECT
                COUNT(*) AS total,
                SUM(status = 'pending') AS pending,
                SUM(status = 'approved') AS approved,
                SUM(status = 'rejected') AS rejected
            FROM leaves WHERE school_id = ?`,
            [schoolId]
        );

        res.render('schoolAdmin/leaves/list', {
            title: 'Leave Applications',
            leaves,
            stats,
            filters: req.query,
            currentPath: req.path
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load leaves');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.approveLeave = async (req, res) => {
    try {
        const sessionUser = getSessionUser(req);
        const schoolId = sessionUser.school_id;
        const adminId = sessionUser.id;
        const id = parseInt(req.params.id, 10);

        if (!Number.isInteger(id) || id <= 0) {
            req.flash('error', 'Invalid leave application');
            return res.redirect('/schooladmin/leaves');
        };

        const leave = await db.withTransaction(async (tx) => {
            const rows = await tx.query(
                'SELECT id, school_id, user_id, user_role, leave_type, from_date, to_date, status FROM leaves WHERE id = ? AND school_id = ? LIMIT 1 FOR UPDATE',
                [id, schoolId]
            );
            
            const currentLeave = rows[0];
            if (!currentLeave) return null;
            if (currentLeave.status !== 'pending') return currentLeave;

            await tx.query(
                `UPDATE leaves
                SET status = 'approved', approved_by = ?, approved_at = NOW(), rejection_reason = NULL
                WHERE id = ?`,
                [adminId, id]
            );

            const dates = getDatesInRange(currentLeave.from_date, currentLeave.to_date);
            await markApprovedLeaveAbsent(tx, currentLeave, dates, adminId);
            return currentLeave;
        });

        if (!leave) {
            req.flash('error', 'Leave application not found');
            return res.redirect('/schooladmin/leaves');
        };
        if (leave.status !== 'pending') {
            req.flash('error', 'Only pending leaves can be approved');
            return res.redirect('/schooladmin/leaves');
        };

        notifyApplicant(leave, 'approved').catch(err => console.error('Leave approval notification failed:', err.message));
        req.flash('success', 'Leave approved successfully');
        res.redirect('/schooladmin/leaves');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to approve leave');
        res.redirect('/schooladmin/leaves');
    };
};

exports.rejectLeave = async (req, res) => {
    try {
        const sessionUser = getSessionUser(req);
        const schoolId = sessionUser.school_id;
        const adminId = sessionUser.id;
        const id = parseInt(req.params.id, 10);
        const { rejection_reason } = req.body;

        if (!Number.isInteger(id) || id <= 0) {
            req.flash('error', 'Invalid leave application');
            return res.redirect('/schooladmin/leaves');
        };

        const [[leave]] = await db.query(
            'SELECT id, school_id, user_id, user_role, leave_type, from_date, to_date, status FROM leaves WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );
        if (!leave) {
            req.flash('error', 'Leave application not found');
            return res.redirect('/schooladmin/leaves');
        };
        if (leave.status !== 'pending') {
            req.flash('error', 'Only pending leaves can be rejected');
            return res.redirect('/schooladmin/leaves');
        };

        await db.query(
            `UPDATE leaves
	        SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = NOW()
	        WHERE id = ?`,
            [rejection_reason || null, adminId, id]
        );
        
        notifyApplicant(leave, 'rejected', rejection_reason || null).catch(err => console.error('Leave rejection notification failed:', err.message));
        req.flash('success', 'Leave rejected');
        res.redirect('/schooladmin/leaves');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to reject leave');
        res.redirect('/schooladmin/leaves');
    };
};

exports.calendarView = async (req, res) => {
    try {
        const schoolId = getSessionUser(req).school_id;
        let { month, year } = req.query;
        const now = new Date();
        year = parseInt(year) || now.getFullYear();
        month = parseInt(month) || (now.getMonth() + 1);

        if (month < 1) { month = 12; year--; }
        if (month > 12) { month = 1; year++; }

        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const [leaves] = await db.query(
            `SELECT l.id, l.user_id, l.user_role, l.leave_type,
                l.from_date, l.to_date, l.reason,
                u.first_name AS first_name, u.last_name AS last_name
            FROM leaves l
            JOIN users u ON l.user_id = u.id
            WHERE l.school_id = ?
                AND l.status = 'approved'
                AND l.from_date <= ? AND l.to_date >= ?
            ORDER BY l.from_date ASC`,
            [schoolId, toDateOnly(lastDay), toDateOnly(firstDay)]
        );

        const [[monthStats]] = await db.query(
            `SELECT
                COUNT(*) AS total,
                SUM(user_role = 'teacher') AS teachers,
                SUM(user_role = 'student') AS students,
                SUM(user_role = 'driver')  AS drivers,
                SUM(user_role = 'librarian') AS librarians
            FROM leaves
            WHERE school_id = ? AND status = 'approved'
                AND from_date <= ? AND to_date >= ?`,
            [schoolId, toDateOnly(lastDay), toDateOnly(firstDay)]
        );

        const calendarDays = [];
        const startDow = firstDay.getDay();
        const totalDays = lastDay.getDate();

        for (let i = 0; i < startDow; i++) calendarDays.push(null);
        for (let d = 1; d <= totalDays; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayLeaves = leaves.filter(l => {
                return dateStr >= toDateOnly(l.from_date) && dateStr <= toDateOnly(l.to_date);
            });
            calendarDays.push({ day: d, date: dateStr, leaves: dayLeaves });
        };

        const monthName = firstDay.toLocaleString('en-US', { month: 'long' });
        res.render('schoolAdmin/leaves/calendar', {
            title: `Leave Calendar — ${monthName} ${year}`,
            calendarDays,
            monthName,
            month,
            year,
            monthStats,
            prevMonth: month === 1 ? 12 : month - 1,
            prevYear: month === 1 ? year - 1 : year,
            nextMonth: month === 12 ? 1 : month + 1,
            nextYear: month === 12 ? year + 1 : year,
            currentPath: req.path
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load calendar');
        res.redirect('/schooladmin/leaves');
    };
};
