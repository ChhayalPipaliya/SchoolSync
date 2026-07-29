const db = require('../config/database');
const AttendanceAuditModel = require('../models/attendanceAuditModel');

const queryAsync = async (sql, params = []) => {
    const [rows] = await db.query(sql, params);
    return rows;
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDateISO(dateObj) {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return String(dateObj).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

async function getWorkingDaysInRange(schoolId, startDateStr, endDateStr) {
    const startDate = new Date(`${startDateStr}T00:00:00`);
    const endDate = new Date(`${endDateStr}T00:00:00`);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return [];
    };

    const workingDayRules = await queryAsync(
        `SELECT day_of_week, is_working_day
        FROM school_working_days
        WHERE school_id = ?`,
        [schoolId]
    ).catch(() => []);

    const ruleMap = {};
    workingDayRules.forEach(r => {
        ruleMap[r.day_of_week] = Number(r.is_working_day) === 1;
    });

    const holidays = await queryAsync(
        `SELECT start_date, end_date, title, event_type
        FROM academic_events
        WHERE school_id = ? 
          AND LOWER(event_type) IN ('holiday', 'public holiday', 'declared holiday', 'school holiday')
          AND COALESCE(status, 'active') IN ('active', 'approved')`,
        [schoolId]
    ).catch(() => []);

    const holidaySet = new Set();
    holidays.forEach(h => {
        const hStart = new Date(`${String(h.start_date).slice(0, 10)}T00:00:00`);
        const hEnd = new Date(`${String(h.end_date).slice(0, 10)}T00:00:00`);
        const cur = new Date(hStart);
        while (cur <= hEnd) {
            holidaySet.add(formatDateISO(cur));
            cur.setDate(cur.getDate() + 1);
        };
    });

    const workingDaysList = [];
    const cur = new Date(startDate);
    while (cur <= endDate) {
        const dateStr = formatDateISO(cur);
        const dayName = DAY_NAMES[cur.getDay()];
        const isSunday = cur.getDay() === 0;
        const isRuleWorking = ruleMap[dayName] !== undefined ? ruleMap[dayName] : !isSunday;
        const isHoliday = holidaySet.has(dateStr);

        if (isRuleWorking && !isHoliday) {
            workingDaysList.push({
                date: dateStr,
                dayName,
                isSunday,
                isHoliday: false
            });
        };
        cur.setDate(cur.getDate() + 1);
    };
    return workingDaysList;
};

async function isTodayWorkingDay(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const workingDays = await getWorkingDaysInRange(schoolId, targetDate, targetDate);
    return workingDays.length > 0;
};

async function isAttendanceLocked(schoolId, dateStr, userRole = 'teacher') {
    const targetDateStr = dateStr || formatDateISO(new Date());
    const todayStr = formatDateISO(new Date());

    let cutoffHour = 17;
    let cutoffMinute = 0;

    try {
        const [[setting]] = await db.query(
            `SELECT setting_value FROM school_settings WHERE school_id = ? AND setting_key = 'attendance_cutoff_time' LIMIT 1`,
            [schoolId]
        );
        if (setting && setting.setting_value) {
            const [h, m] = setting.setting_value.split(':').map(Number);
            if (!isNaN(h)) cutoffHour = h;
            if (!isNaN(m)) cutoffMinute = m;
        }
    } catch (e) { }

    const now = new Date();
    const isPastDate = targetDateStr < todayStr;
    const isToday = targetDateStr === todayStr;
    const cutoffTimeToday = new Date();
    cutoffTimeToday.setHours(cutoffHour, cutoffMinute, 0, 0);

    const isPastCutoff = isToday && now > cutoffTimeToday;

    if (userRole === 'school_admin' || userRole === 'admin' || userRole === 'superadmin' || userRole === 'group_admin') {
        if (isPastDate || isPastCutoff) {
            return { isLocked: false, requiresReason: true, isPastCutoff, isPastDate };
        };
        return { isLocked: false, requiresReason: false, isPastCutoff: false, isPastDate: false };
    };

    if (isPastDate || isPastCutoff) {
        return {
            isLocked: true,
            requiresReason: true,
            reason: `Attendance marking cutoff time (${cutoffHour}:${String(cutoffMinute).padStart(2, '0')}) has passed for today or date is in the past. Only School Admin can edit with an unlock reason.`
        };
    };

    return { isLocked: false, requiresReason: false };
};

async function calculateStudentAttendanceStats(schoolId, studentId, startDateStr, endDateStr) {
    const todayStr = formatDateISO(new Date());
    const effectiveEndDate = endDateStr > todayStr ? todayStr : endDateStr;
    const workingDays = await getWorkingDaysInRange(schoolId, startDateStr, effectiveEndDate);
    const totalWorkingDaysCount = workingDays.length;

    const attendanceRows = await queryAsync(
        `SELECT date, status
        FROM attendance
        WHERE school_id = ? AND student_id = ? AND date BETWEEN ? AND ?`,
        [schoolId, studentId, startDateStr, effectiveEndDate]
    );

    const attMap = {};
    attendanceRows.forEach(a => {
        const dStr = String(a.date).slice(0, 10);
        attMap[dStr] = a.status;
    });

    let presentDays = 0;
    let absentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let pendingDays = 0;

    workingDays.forEach(wd => {
        const st = attMap[wd.date];
        if (st === 'present') {
            presentDays += 1;
        } else if (st === 'late') {
            lateDays += 1;
            presentDays += 1;
        } else if (st === 'half-day' || st === 'half_day') {
            halfDays += 1;
            presentDays += 0.5;
        } else if (st === 'leave' || st === 'paid_leave' || st === 'medical_leave') {
            leaveDays += 1;
        } else if (st === 'absent') {
            absentDays += 1;
        } else {
            pendingDays += 1;
        };
    });

    const percentage = totalWorkingDaysCount > 0 ? Number(((presentDays / totalWorkingDaysCount) * 100).toFixed(1)) : 0;
    return {
        studentId,
        totalWorkingDays: totalWorkingDaysCount,
        presentDays: Math.floor(presentDays),
        effectivePresentDays: presentDays,
        absentDays,
        lateDays,
        halfDays,
        leaveDays,
        pendingDays,
        percentage
    };
};

async function getPendingClassesForSchool(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    if (!isWorking) {
        return { isWorkingDay: false, pendingClasses: [] };
    };

    const classes = await queryAsync(
        `SELECT c.id AS class_id, c.class_name, c.section,
            tca.teacher_id, u.first_name AS teacher_first_name, u.last_name AS teacher_last_name, u.phone AS teacher_phone
        FROM classes c
        LEFT JOIN teacher_class_assign tca ON tca.class_id = c.id AND tca.school_id = c.school_id AND (COALESCE(tca.is_class_teacher, 0) = 1 OR COALESCE(tca.can_mark_attendance, 0) = 1) AND COALESCE(tca.status, 'active') = 'active'
        LEFT JOIN teachers t ON tca.teacher_id = t.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE c.school_id = ?
        ORDER BY c.class_name, c.section`,
        [schoolId]
    );

    const markedClasses = await queryAsync(
        `SELECT DISTINCT class_id
        FROM attendance
        WHERE school_id = ? AND date = ?`,
        [schoolId, targetDate]
    );

    const markedClassSet = new Set(markedClasses.map(m => m.class_id));
    const pendingClasses = classes.filter(c => !markedClassSet.has(c.class_id)).map(c => ({
        class_id: c.class_id,
        className: `${c.class_name} - ${c.section}`,
        teacherId: c.teacher_id || null,
        teacherName: [c.teacher_first_name, c.teacher_last_name].filter(Boolean).join(' ') || 'Unassigned',
        teacherPhone: c.teacher_phone || '—',
        status: 'pending'
    }));

    return {
        isWorkingDay: true,
        pendingClasses
    };
};

async function getSchoolTodayAttendanceSummary(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    if (!isWorking) {
        return {
            isWorkingDay: false,
            statusLabel: 'Holiday / Non-Working Day',
            totalStudents: 0,
            presentStudents: 0,
            absentStudents: 0,
            attendancePct: 0,
            pendingClassesCount: 0
        };
    };

    const [[studentTotal]] = await db.query(
        `SELECT COUNT(*) AS total FROM students WHERE school_id = ? AND deleted_at IS NULL`,
        [schoolId]
    );

    const [[attStats]] = await db.query(
        `SELECT 
            SUM(CASE WHEN status IN ('present', 'late') THEN 1 WHEN status IN ('half-day', 'half_day') THEN 0.5 ELSE 0 END) AS presentCount,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absentCount,
            COUNT(*) AS markedTotal
        FROM attendance
        WHERE school_id = ? AND date = ?`,
        [schoolId, targetDate]
    );

    const totalStudents = Number(studentTotal?.total || 0);
    const presentStudents = Number(attStats?.presentCount || 0);
    const absentStudents = Number(attStats?.absentCount || 0);
    const markedTotal = Number(attStats?.markedTotal || 0);
    const pendingData = await getPendingClassesForSchool(schoolId, targetDate);
    const pendingClassesCount = pendingData.pendingClasses.length;

    const attendancePct = totalStudents > 0 && markedTotal > 0 ? Number(((presentStudents / totalStudents) * 100).toFixed(1)) : 0;
    return {
        isWorkingDay: true,
        statusLabel: pendingClassesCount > 0 ? `${pendingClassesCount} Classes Pending` : 'Attendance Completed',
        totalStudents,
        presentStudents,
        absentStudents,
        attendancePct,
        pendingClassesCount,
        pendingClasses: pendingData.pendingClasses
    };
};

async function calculateAttendanceCompletion(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    const classes = await queryAsync(
        `SELECT c.id AS class_id, c.class_name, c.section,
            tca.teacher_id, u.first_name AS teacher_first_name, u.last_name AS teacher_last_name, u.phone AS teacher_phone
        FROM classes c
        LEFT JOIN teacher_class_assign tca ON tca.class_id = c.id AND tca.school_id = c.school_id AND (COALESCE(tca.is_class_teacher, 0) = 1 OR COALESCE(tca.can_mark_attendance, 0) = 1) AND COALESCE(tca.status, 'active') = 'active'
        LEFT JOIN teachers t ON tca.teacher_id = t.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE c.school_id = ?
        ORDER BY c.class_name, c.section`,
        [schoolId]
    );

    const totalClasses = classes.length;

    if (!isWorking || totalClasses === 0) {
        return {
            isWorkingDay: isWorking,
            statusLabel: 'Holiday / Non-Working Day',
            totalClasses,
            completedClasses: 0,
            pendingClassesCount: 0,
            pendingClasses: [],
            completedClassesList: [],
            completionPct: 0
        };
    };

    const markedClasses = await queryAsync(
        `SELECT DISTINCT class_id
        FROM attendance
        WHERE school_id = ? AND date = ?`,
        [schoolId, targetDate]
    );

    const markedClassSet = new Set(markedClasses.map(m => m.class_id));

    const pendingClasses = [];
    const completedClassesList = [];

    classes.forEach(c => {
        const item = {
            class_id: c.class_id,
            className: `${c.class_name} - ${c.section}`,
            teacherId: c.teacher_id || null,
            teacherName: [c.teacher_first_name, c.teacher_last_name].filter(Boolean).join(' ') || 'Unassigned',
            teacherPhone: c.teacher_phone || '—',
            status: markedClassSet.has(c.class_id) ? 'completed' : 'pending'
        };

        if (markedClassSet.has(c.class_id)) {
            completedClassesList.push(item);
        } else {
            pendingClasses.push(item);
        };
    });

    const completedClassesCount = completedClassesList.length;
    const pendingClassesCount = pendingClasses.length;
    const completionPct = totalClasses > 0 ? Number(((completedClassesCount / totalClasses) * 100).toFixed(1)) : 0;

    return {
        isWorkingDay: true,
        statusLabel: pendingClassesCount > 0 ? `${pendingClassesCount} Classes Pending` : 'Attendance Completed',
        totalClasses,
        completedClasses: completedClassesCount,
        pendingClassesCount,
        pendingClasses,
        completedClassesList,
        completionPct
    };
};

async function logAttendanceAudit(data) {
    return AttendanceAuditModel.log(data);
};

module.exports = { formatDateISO, getWorkingDaysInRange, isTodayWorkingDay, isAttendanceLocked, calculateStudentAttendanceStats, calculateAttendanceCompletion, getPendingClassesForSchool, getSchoolTodayAttendanceSummary, logAttendanceAudit};