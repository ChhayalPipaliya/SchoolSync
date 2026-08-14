const db = require('../config/database');
const AttendanceAuditModel = require('../models/attendanceAuditModel');
const { getActiveAcademicYearForSchool } = require('./academicYearService');

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

async function getWorkingDaysInRange(schoolId, startDateStr, endDateStr, academicYearId = null) {
    const startDate = new Date(`${startDateStr}T00:00:00`);
    const endDate = new Date(`${endDateStr}T00:00:00`);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return [];
    };

    let targetYearId = academicYearId;
    if (!targetYearId) {
        try {
            const activeYear = await getActiveAcademicYearForSchool(schoolId);
            targetYearId = activeYear?.id || null;
        } catch (e) {}
    };

    let workingDaySql = `SELECT day_of_week, is_working_day FROM school_working_days WHERE school_id = ?`;
    const workingDayParams = [schoolId];

    if (targetYearId) {
        workingDaySql += ` AND (academic_year_id = ? OR academic_year_id IS NULL)`;
        workingDayParams.push(targetYearId);
    };

    const workingDayRules = await queryAsync(workingDaySql, workingDayParams).catch(() => []);
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
        const hStartStr = formatDateISO(h.start_date);
        const hEndStr = formatDateISO(h.end_date);
        const hStart = new Date(`${hStartStr}T00:00:00`);
        const hEnd = new Date(`${hEndStr}T00:00:00`);
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

    if (targetDateStr > todayStr) {
        return {
            isLocked: true,
            requiresReason: false,
            reason: 'Attendance cannot be marked for future dates.'
        };
    };

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
        const dStr = formatDateISO(a.date);
        attMap[dStr] = String(a.status || '').toLowerCase();
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
        } else if (st === 'leave' || st === 'paid_leave' || st === 'medical_leave' || st === 'on_leave') {
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
        LEFT JOIN teacher_class_assign tca ON tca.class_id = c.id AND tca.school_id = c.school_id AND COALESCE(tca.is_primary, 0) = 1 AND COALESCE(tca.status, 'active') = 'active'
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

async function getStudentAttendanceSummary(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    const [[studentTotal]] = await db.query(
        `SELECT COUNT(*) AS total FROM students WHERE school_id = ? AND deleted_at IS NULL`,
        [schoolId]
    );
    const total = Number(studentTotal?.total || 0);

    if (!isWorking || total === 0) {
        return {
            isWorkingDay: isWorking,
            statusLabel: 'Holiday / Non-Working Day',
            total,
            present: 0,
            absent: 0,
            late: 0,
            leave: 0,
            halfDay: 0,
            pending: 0,
            percentage: 0
        };
    };

    const [[attStats]] = await db.query(
        `SELECT 
            SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS presentCount,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absentCount,
            SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS lateCount,
            SUM(CASE WHEN status IN ('leave', 'paid_leave', 'medical_leave') THEN 1 ELSE 0 END) AS leaveCount,
            SUM(CASE WHEN status IN ('half-day', 'half_day') THEN 1 ELSE 0 END) AS halfDayCount
        FROM attendance
        WHERE school_id = ? AND date = ?`,
        [schoolId, targetDate]
    );

    const present = Number(attStats?.presentCount || 0);
    const absent = Number(attStats?.absentCount || 0);
    const late = Number(attStats?.lateCount || 0);
    const leave = Number(attStats?.leaveCount || 0);
    const halfDay = Number(attStats?.halfDayCount || 0);

    const markedTotal = present + absent + late + leave + halfDay;
    const pending = Math.max(0, total - markedTotal);
    const effectivePresent = present + late + (0.5 * halfDay);
    const percentage = total > 0 && markedTotal > 0 ? Math.round((effectivePresent / total) * 100) : 0;

    return {
        isWorkingDay: true,
        statusLabel: pending > 0 ? `${pending} Students Unmarked` : 'Attendance Completed',
        total,
        present,
        absent,
        late,
        leave,
        halfDay,
        pending,
        percentage
    };
};

async function calculateTeacherAttendanceSummary(schoolId, dateStr = null) {
    const targetDate = dateStr ? formatDateISO(dateStr) : formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    const [[teacherTotal]] = await db.query(
        `SELECT COUNT(*) AS total
        FROM teachers t
        JOIN users u ON t.user_id = u.id
        WHERE t.school_id = ? AND t.deleted_at IS NULL AND u.deleted_at IS NULL`,
        [schoolId]
    );
    const total = Number(teacherTotal?.total || 0);

    if (!isWorking || total === 0) {
        return {
            isWorkingDay: isWorking,
            statusLabel: total === 0 ? 'No Active Teachers' : 'Holiday / Non-Working Day',
            total,
            present: 0,
            absent: 0,
            late: 0,
            leave: 0,
            halfDay: 0,
            markedTotal: 0,
            pending: 0,
            percentage: 0
        };
    };

    const [[attStats]] = await db.query(
        `SELECT 
            SUM(CASE WHEN LOWER(ta.status) = 'present' THEN 1 ELSE 0 END) AS presentCount,
            SUM(CASE WHEN LOWER(ta.status) = 'absent' THEN 1 ELSE 0 END) AS absentCount,
            SUM(CASE WHEN LOWER(ta.status) = 'late' THEN 1 ELSE 0 END) AS lateCount,
            SUM(CASE WHEN LOWER(ta.status) IN ('leave', 'paid_leave', 'medical_leave', 'on_leave', 'unpaid_leave', 'excused') THEN 1 ELSE 0 END) AS leaveCount,
            SUM(CASE WHEN LOWER(ta.status) IN ('half-day', 'half_day', 'halfday', 'half day') THEN 1 ELSE 0 END) AS halfDayCount
        FROM teacher_attendance ta
        JOIN teachers t ON ta.teacher_id = t.id AND t.school_id = ta.school_id
        JOIN users u ON t.user_id = u.id
        WHERE ta.school_id = ? AND DATE(ta.date) = DATE(?) AND t.deleted_at IS NULL AND u.deleted_at IS NULL`,
        [schoolId, targetDate]
    );

    let present = Number(attStats?.presentCount || 0);
    const absent = Number(attStats?.absentCount || 0);
    const late = Number(attStats?.lateCount || 0);
    const leave = Number(attStats?.leaveCount || 0);
    const halfDay = Number(attStats?.halfDayCount || 0);
    const markedTotal = present + absent + late + leave + halfDay;

    let pending = 0;
    if (markedTotal > 0 && markedTotal < total) {
        present += (total - markedTotal);
        pending = 0;
    } else if (markedTotal === 0) {
        pending = total;
    }

    const effectivePresent = present + late + (0.5 * halfDay);
    const percentage = total > 0 && (markedTotal > 0 || present > 0) ? Math.round((effectivePresent / total) * 100) : 0;

    return {
        isWorkingDay: true,
        statusLabel: pending > 0 ? `${pending} Teachers Pending` : 'Attendance Completed',
        total,
        present,
        absent,
        late,
        leave,
        halfDay,
        markedTotal: present + absent + late + leave + halfDay,
        pending,
        percentage
    };
};

const getTeacherAttendanceSummary = calculateTeacherAttendanceSummary;
async function getDriverAttendanceSummary(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    const [[driverTotal]] = await db.query(
        `SELECT COUNT(*) AS total FROM drivers WHERE school_id = ?`,
        [schoolId]
    );
    const total = Number(driverTotal?.total || 0);

    if (!isWorking || total === 0) {
        return {
            isWorkingDay: isWorking,
            statusLabel: 'Holiday / Non-Working Day',
            total,
            present: 0,
            absent: 0,
            late: 0,
            leave: 0,
            halfDay: 0,
            pending: 0,
            percentage: 0
        };
    };

    const [[attStats]] = await db.query(
        `SELECT 
            SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS presentCount,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absentCount,
            SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS lateCount,
            SUM(CASE WHEN status IN ('leave', 'paid_leave', 'medical_leave') THEN 1 ELSE 0 END) AS leaveCount,
            SUM(CASE WHEN status IN ('half-day', 'half_day') THEN 1 ELSE 0 END) AS halfDayCount
        FROM driver_attendance
        WHERE school_id = ? AND date = ?`,
        [schoolId, targetDate]
    );

    const present = Number(attStats?.presentCount || 0);
    const absent = Number(attStats?.absentCount || 0);
    const late = Number(attStats?.lateCount || 0);
    const leave = Number(attStats?.leaveCount || 0);
    const halfDay = Number(attStats?.halfDayCount || 0);
    const markedTotal = present + absent + late + leave + halfDay;
    const pending = Math.max(0, total - markedTotal);
    const effectivePresent = present + late + (0.5 * halfDay);
    const percentage = total > 0 && markedTotal > 0 ? Math.round((effectivePresent / total) * 100) : 0;

    return {
        isWorkingDay: true,
        statusLabel: pending > 0 ? `${pending} Drivers Pending` : 'Attendance Completed',
        total,
        present,
        absent,
        late,
        leave,
        halfDay,
        pending,
        percentage
    };
};

async function getLibrarianAttendanceSummary(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    const [[librarianTotal]] = await db.query(
        `SELECT COUNT(*) AS total FROM librarians WHERE school_id = ?`,
        [schoolId]
    );
    const total = Number(librarianTotal?.total || 0);

    if (!isWorking || total === 0) {
        return {
            isWorkingDay: isWorking,
            statusLabel: 'Holiday / Non-Working Day',
            total,
            present: 0,
            absent: 0,
            late: 0,
            leave: 0,
            halfDay: 0,
            pending: 0,
            percentage: 0
        };
    };

    const [[attStats]] = await db.query(
        `SELECT 
            SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS presentCount,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absentCount,
            SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS lateCount,
            SUM(CASE WHEN status IN ('leave', 'paid_leave', 'medical_leave') THEN 1 ELSE 0 END) AS leaveCount,
            SUM(CASE WHEN status IN ('half-day', 'half_day') THEN 1 ELSE 0 END) AS halfDayCount
        FROM librarian_attendance
        WHERE school_id = ? AND date = ?`,
        [schoolId, targetDate]
    );

    const present = Number(attStats?.presentCount || 0);
    const absent = Number(attStats?.absentCount || 0);
    const late = Number(attStats?.lateCount || 0);
    const leave = Number(attStats?.leaveCount || 0);
    const halfDay = Number(attStats?.halfDayCount || 0);

    const markedTotal = present + absent + late + leave + halfDay;
    const pending = Math.max(0, total - markedTotal);
    const effectivePresent = present + late + (0.5 * halfDay);
    const percentage = total > 0 && markedTotal > 0 ? Math.round((effectivePresent / total) * 100) : 0;

    return {
        isWorkingDay: true,
        statusLabel: pending > 0 ? `${pending} Librarians Pending` : 'Attendance Completed',
        total,
        present,
        absent,
        late,
        leave,
        halfDay,
        pending,
        percentage
    };
};

async function getSchoolTodayAttendanceSummary(schoolId, dateStr = null) {
    const studentSummary = await getStudentAttendanceSummary(schoolId, dateStr);
    const completionSummary = await calculateAttendanceCompletion(schoolId, dateStr);

    return {
        isWorkingDay: studentSummary.isWorkingDay,
        statusLabel: completionSummary.statusLabel,
        totalStudents: studentSummary.total,
        presentStudents: studentSummary.present,
        absentStudents: studentSummary.absent,
        lateStudents: studentSummary.late,
        leaveStudents: studentSummary.leave,
        pendingStudents: studentSummary.pending,
        attendancePct: studentSummary.percentage,
        pendingClassesCount: completionSummary.pendingClassesCount,
        pendingClasses: completionSummary.pendingClasses
    };
};

async function calculateAttendanceCompletion(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorking = await isTodayWorkingDay(schoolId, targetDate);

    const classes = await queryAsync(
        `SELECT c.id AS class_id, c.class_name, c.section,
            tca.teacher_id, u.first_name AS teacher_first_name, u.last_name AS teacher_last_name, u.phone AS teacher_phone
        FROM classes c
        LEFT JOIN teacher_class_assign tca ON tca.class_id = c.id AND tca.school_id = c.school_id AND COALESCE(tca.is_primary, 0) = 1 AND COALESCE(tca.status, 'active') = 'active'
        LEFT JOIN teachers t ON tca.teacher_id = t.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE c.school_id = ?
        ORDER BY c.class_name, c.section`,
        [schoolId]
    );

    const totalClasses = classes.length;

    if (!isWorking) {
        return {
            isWorkingDay: false,
            statusLabel: 'Holiday / Non-Working Day',
            totalClasses: 0,
            completedClasses: 0,
            pendingClassesCount: 0,
            pendingClasses: [],
            completedClassesList: [],
            completionPct: 0
        };
    };

    if (totalClasses === 0) {
        return {
            isWorkingDay: true,
            statusLabel: 'No Working Classes Today',
            totalClasses: 0,
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
    const completionPct = Math.round((completedClassesCount / totalClasses) * 100);

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

async function getRiskAlertSummary(schoolId, threshold = 90) {
    const [lowAttendanceClass] = await queryAsync(
        `SELECT c.class_name, c.section,
            ROUND(SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as rate
        FROM attendance a
        JOIN classes c ON a.class_id = c.id
        WHERE a.school_id = ? AND a.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY c.id, c.class_name, c.section
        HAVING rate < ?
        ORDER BY rate ASC
        LIMIT 1`,
        [schoolId, threshold]
    ).catch(() => []);

    return lowAttendanceClass || null;
};

async function getSevenDayAttendanceTrends(schoolId) {
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const attLabels = [];
    const attData = [];
    const teacherAttLabels = [];
    const teacherAttData = [];
    const completionTrendLabels = [];
    const completionTrendData = [];

    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = formatDateISO(d);
        const label = `${d.getDate()} ${monthsShort[d.getMonth()]}`;

        attLabels.push(label);
        teacherAttLabels.push(label);
        completionTrendLabels.push(label);

        const studentSummary = await getStudentAttendanceSummary(schoolId, dateStr);
        attData.push(studentSummary.percentage);

        const teacherSummary = await getTeacherAttendanceSummary(schoolId, dateStr);
        teacherAttData.push(teacherSummary.percentage);

        const completionSummary = await calculateAttendanceCompletion(schoolId, dateStr);
        completionTrendData.push(completionSummary.completionPct);
    };
    return { attLabels, attData, teacherAttLabels, teacherAttData, completionTrendLabels, completionTrendData };
};

async function getCompleteAttendanceDashboardData(schoolId, dateStr = null) {
    const targetDate = dateStr || formatDateISO(new Date());
    const isWorkingDay = await isTodayWorkingDay(schoolId, targetDate);

    const [ studentSummary, teacherSummary, driverSummary, librarianSummary, completionSummary, riskAlert, trends] = await Promise.all([
        getStudentAttendanceSummary(schoolId, targetDate),
        getTeacherAttendanceSummary(schoolId, targetDate),
        getDriverAttendanceSummary(schoolId, targetDate),
        getLibrarianAttendanceSummary(schoolId, targetDate),
        calculateAttendanceCompletion(schoolId, targetDate),
        getRiskAlertSummary(schoolId, 90),
        getSevenDayAttendanceTrends(schoolId)
    ]);
    return { isWorkingDay, targetDate, studentSummary, teacherSummary, driverSummary, librarianSummary, completionSummary, riskAlert, trends };
};

async function logAttendanceAudit(data) {
    return AttendanceAuditModel.log(data);
};

module.exports = { formatDateISO, getWorkingDaysInRange, isTodayWorkingDay, isAttendanceLocked, calculateStudentAttendanceStats, calculateAttendanceCompletion, getPendingClassesForSchool, getSchoolTodayAttendanceSummary, getStudentAttendanceSummary, calculateTeacherAttendanceSummary, getTeacherAttendanceSummary, getDriverAttendanceSummary, getLibrarianAttendanceSummary, getRiskAlertSummary, getSevenDayAttendanceTrends, getCompleteAttendanceDashboardData, logAttendanceAudit};