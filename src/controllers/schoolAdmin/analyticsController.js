const db = require('../../config/database');
const { calculateStudentAttendanceStats } = require('../../services/attendanceEngineService');

const getAcademicYearDates = (from, to) => {
    let startDate = from;
    let endDate = to;
    if (!startDate || !endDate) {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        let startYear, endYear;
        
        if (currentMonth >= 3) {
            startYear = currentYear;
            endYear = currentYear + 1;
        } else {
            startYear = currentYear - 1;
            endYear = currentYear;
        };

        if (!startDate) startDate = `${startYear}-04-01`;
        if (!endDate) endDate = `${endYear}-03-31`;
    };
    return { startDate, endDate };
};

exports.getAnalyticsPage = async (req, res) => {
    try {
        res.render('schoolAdmin/analytics', {
            title: 'School Analytics',
            user: req.user || req.session.user,
            currentPath: '/schooladmin/analytics'
        });
    } catch (err) {
        console.error('Analytics page render error:', err);
        req.flash('error', 'Failed to load analytics dashboard');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getAttendanceAnalytics = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);
        const [classAttendance] = await db.query(
            `SELECT c.class_name, c.section, 
                COALESCE(SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 0) as value 
            FROM attendance a 
            JOIN classes c ON a.class_id = c.id 
            WHERE a.school_id = ? AND a.date BETWEEN ? AND ? 
            GROUP BY c.id, c.class_name, c.section 
            ORDER BY value ASC`,
            [schoolId, startDate, endDate]
        );

        const [attendanceTrend] = await db.query(
            `SELECT DATE_FORMAT(a.date, '%Y-%m-%d') as label, 
                COALESCE(SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 0) as value 
            FROM attendance a 
            WHERE a.school_id = ? AND a.date BETWEEN ? AND ? 
            GROUP BY a.date 
            ORDER BY a.date ASC`,
            [schoolId, startDate, endDate]
        );

        const [students] = await db.query(
            `SELECT s.id, u.first_name, u.last_name, c.class_name, c.section 
            FROM students s 
            JOIN users u ON s.user_id = u.id 
            LEFT JOIN classes c ON s.class_id = c.id 
            WHERE s.school_id = ? AND s.deleted_at IS NULL`,
            [schoolId]
        );

        const chronicAbsentees = [];
        for (const student of students) {
            const stats = await calculateStudentAttendanceStats(schoolId, student.id, startDate, endDate);
            if (stats.totalWorkingDays > 0 && stats.percentage < 75.0) {
                chronicAbsentees.push({
                    id: student.id,
                    first_name: student.first_name,
                    last_name: student.last_name,
                    class_name: student.class_name,
                    section: student.section,
                    value: stats.percentage
                });
            }
        }
        chronicAbsentees.sort((a, b) => a.value - b.value);

        const [teacherAttendance] = await db.query(
            `SELECT t.id, u.first_name AS first_name, u.last_name AS last_name, 
                COALESCE(SUM(CASE WHEN ta.status = 'present' THEN 1 ELSE 0 END), 0) as present, 
                COALESCE(SUM(CASE WHEN ta.status = 'absent' THEN 1 ELSE 0 END), 0) as absent, 
                COALESCE(SUM(CASE WHEN ta.status = 'half-day' THEN 1 ELSE 0 END), 0) as half_day,
                COALESCE(SUM(CASE WHEN ta.status = 'leave' THEN 1 ELSE 0 END), 0) as leave_days
            FROM teachers t 
            JOIN users u ON t.user_id = u.id 
            LEFT JOIN teacher_attendance ta ON t.id = ta.teacher_id AND ta.school_id = t.school_id AND ta.date BETWEEN ? AND ? 
            WHERE t.school_id = ? 
            GROUP BY t.id, u.first_name, u.last_name`,
            [startDate, endDate, schoolId]
        );

        res.json({
            success: true,
            data: {
                classAttendance,
                attendanceTrend,
                chronicAbsentees,
                teacherAttendance
            }
        });
    } catch (err) {
        next(err);
    };
};

exports.getFeeAnalytics = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);
        const [classProgress] = await db.query(
            `SELECT c.class_name, c.section, 
                COALESCE(SUM(sf.paid_amount), 0) as collected, 
                COALESCE(SUM(sf.total_amount), 0) as total 
            FROM student_fees sf 
            JOIN students s ON sf.student_id = s.id 
            JOIN classes c ON s.class_id = c.id 
            WHERE sf.school_id = ? AND sf.created_at BETWEEN ? AND ? 
            GROUP BY c.id, c.class_name, c.section`,
            [schoolId, startDate, endDate]
        );

        const [[collectedVsPending]] = await db.query(
            `SELECT COALESCE(SUM(sf.paid_amount), 0) as collected, 
                COALESCE(SUM(sf.total_amount - sf.paid_amount), 0) as pending 
            FROM student_fees sf 
            WHERE sf.school_id = ? AND sf.created_at BETWEEN ? AND ?`,
            [schoolId, startDate, endDate]
        );

        const [collectionTrend] = await db.query(
            `SELECT DATE_FORMAT(fp.created_at, '%b %Y') as label, SUM(fp.amount) as value 
            FROM fee_payments fp 
            WHERE fp.school_id = ? AND fp.status IN ('completed', 'paid') AND fp.created_at BETWEEN ? AND ? 
            GROUP BY DATE_FORMAT(fp.created_at, '%Y-%m'), DATE_FORMAT(fp.created_at, '%b %Y') 
            ORDER BY DATE_FORMAT(fp.created_at, '%Y-%m')`,
            [schoolId, startDate, endDate]
        );

        const [defaulters] = await db.query(
            `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, c.class_name, c.section, 
                COALESCE(SUM(sf.total_amount - sf.paid_amount), 0) as pending_amount, 
                DATEDIFF(CURDATE(), MIN(sf.due_date)) as days_overdue 
            FROM student_fees sf 
            JOIN students s ON sf.student_id = s.id 
            JOIN users u ON s.user_id = u.id 
            JOIN classes c ON s.class_id = c.id 
            WHERE sf.school_id = ? AND sf.status IN ('pending', 'partial') AND sf.due_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY) 
            GROUP BY s.id, u.first_name, u.last_name, c.class_name, c.section 
            ORDER BY pending_amount DESC 
            LIMIT 10`,
            [schoolId]
        );

        res.json({
            success: true,
            data: {
                classProgress,
                collectedVsPending: {
                    collected: parseFloat(collectedVsPending?.collected || 0),
                    pending: parseFloat(collectedVsPending?.pending || 0)
                },
                collectionTrend,
                defaulters
            }
        });
    } catch (err) {
        next(err);
    };
};

exports.getAcademicAnalytics = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);

        const [subjectAverages] = await db.query(
            `SELECT c.class_name, c.section, sub.subject_name as subject, 
                COALESCE(AVG(m.obtained_marks * 100.0 / m.total_marks), 0) as value 
            FROM marks m 
            JOIN subjects sub ON m.subject_id = sub.id 
            JOIN students s ON m.student_id = s.id 
            JOIN classes c ON s.class_id = c.id 
            WHERE m.school_id = ? AND m.entry_date BETWEEN ? AND ? 
            GROUP BY c.id, c.class_name, c.section, sub.id, sub.subject_name 
            ORDER BY c.class_name, sub.subject_name`,
            [schoolId, startDate, endDate]
        );

        const [passFailRatio] = await db.query(
            `SELECT e.name as label, 
                COALESCE(SUM(CASE WHEN m.status = 'pass' THEN 1 ELSE 0 END), 0) as passed, 
                COALESCE(SUM(CASE WHEN m.status = 'fail' THEN 1 ELSE 0 END), 0) as failed 
            FROM marks m 
            JOIN exams e ON m.exam_id = e.id 
            WHERE m.school_id = ? AND m.entry_date BETWEEN ? AND ? 
            GROUP BY e.id, e.name`,
            [schoolId, startDate, endDate]
        );

        const [allPerformers] = await db.query(
            `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, c.class_name, c.section, 
                COALESCE(SUM(m.obtained_marks) * 100.0 / NULLIF(SUM(m.total_marks), 0), 0) as value 
            FROM marks m 
            JOIN students s ON m.student_id = s.id 
            JOIN users u ON s.user_id = u.id 
            JOIN classes c ON s.class_id = c.id 
            WHERE m.school_id = ? AND m.entry_date BETWEEN ? AND ? 
            GROUP BY s.id, u.first_name, u.last_name, c.class_name, c.section 
            ORDER BY c.class_name ASC, value DESC`,
            [schoolId, startDate, endDate]
        );

        const topPerformers = {};
        allPerformers.forEach(p => {
            const classKey = `${p.class_name} ${p.section || ''}`.trim();
            if (!topPerformers[classKey]) topPerformers[classKey] = [];
            if (topPerformers[classKey].length < 5) {
                topPerformers[classKey].push({
                    name: `${p.first_name} ${p.last_name}`,
                    percentage: parseFloat(parseFloat(p.value).toFixed(1))
                });
            };
        });

        const [subjectPerformance] = await db.query(
            `SELECT sub.subject_name as label, 
                COALESCE(AVG(m.obtained_marks * 100.0 / m.total_marks), 0) as value 
            FROM marks m 
            JOIN subjects sub ON m.subject_id = sub.id 
            WHERE m.school_id = ? AND m.entry_date BETWEEN ? AND ? 
            GROUP BY sub.id, sub.subject_name`,
            [schoolId, startDate, endDate]
        );

        const [gradeDistribution] = await db.query(
            `SELECT COALESCE(grade, 'N/A') as label, COUNT(*) as value 
            FROM marks 
            WHERE school_id = ? AND entry_date BETWEEN ? AND ? 
            GROUP BY grade`,
            [schoolId, startDate, endDate]
        );

        res.json({
            success: true,
            data: {
                subjectAverages,
                passFailRatio,
                topPerformers,
                subjectPerformance,
                gradeDistribution
            }
        });
    } catch (err) {
        next(err);
    };
};

exports.getStudentAnalytics = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);

        const [admissionsTrend] = await db.query(
            `SELECT DATE_FORMAT(s.admission_date, '%b %Y') as label, COUNT(*) as value 
            FROM students s 
            WHERE s.school_id = ? AND s.deleted_at IS NULL AND s.admission_date BETWEEN ? AND ? 
            GROUP BY DATE_FORMAT(s.admission_date, '%Y-%m'), DATE_FORMAT(s.admission_date, '%b %Y') 
            ORDER BY DATE_FORMAT(s.admission_date, '%Y-%m')`,
            [schoolId, startDate, endDate]
        );

        const [classStrength] = await db.query(
            `SELECT c.class_name, c.section, COUNT(s.id) as value 
            FROM students s 
            JOIN classes c ON s.class_id = c.id 
            WHERE s.school_id = ? AND s.deleted_at IS NULL 
            GROUP BY c.id, c.class_name, c.section 
            ORDER BY c.class_name`,
            [schoolId]
        );

        const [genderRatio] = await db.query(
            `SELECT COALESCE(gender, 'Unknown') as label, COUNT(*) as value 
            FROM students 
            WHERE school_id = ? AND deleted_at IS NULL 
            GROUP BY gender`,
            [schoolId]
        );

        const [[inactiveCount]] = await db.query(
            `SELECT COUNT(*) as count 
            FROM students 
            WHERE school_id = ? AND status = 'inactive' AND deleted_at IS NULL AND updated_at BETWEEN ? AND ?`,
            [schoolId, startDate, endDate]
        );

        res.json({
            success: true,
            data: {
                admissionsTrend,
                classStrength,
                genderRatio,
                inactiveCount: inactiveCount.count
            }
        });
    } catch (err) {
        next(err);
    };
};