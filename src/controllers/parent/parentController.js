const db = require('../../config/database');
const { getStudentTransportViewModel } = require('../../utils/transportProViewModel');

async function getChildren(parentEmail, schoolId) {
    const normalizedParentEmail = String(parentEmail || '').trim().toLowerCase();
    const sql = `
        SELECT s.*, u.first_name AS first_name, u.last_name AS last_name, u.image, c.class_name, c.section,
            sf.father_name, sf.mother_name, sf.guardian_name
        FROM students s
        JOIN users u ON s.user_id = u.id
        JOIN student_family sf ON s.id = sf.student_id
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE (LOWER(sf.father_email) = ? OR LOWER(sf.mother_email) = ? OR LOWER(sf.guardian_email) = ?) 
            AND s.school_id = ? 
            AND s.parent_portal_enabled = 1
            AND s.deleted_at IS NULL
    `;
    const [rows] = await db.query(sql, [normalizedParentEmail, normalizedParentEmail, normalizedParentEmail, schoolId]);
    return rows;
}

function getActiveChild(req, children) {
    if (!children || children.length === 0) return null;
    let selectedId = req.query.studentId || req.session.selectedStudentId;
    let active = children.find(c => c.id == selectedId) || children[0];
    req.session.selectedStudentId = active.id;
    return active;
}

exports.getDashboard = async (req, res) => {
    try {
        const parentEmail = req.user.email;
        const schoolId = req.user.school_id;
        const children = await getChildren(parentEmail, schoolId);
        const activeChild = getActiveChild(req, children);
        let attendanceStats = { present: 0, absent: 0, late: 0, percentage: 0 };
        let homeworks = [];
        let feeSummary = { total: 0, paid: 0, pending: 0 };
        let notices = [];

        if (activeChild) {
            const [attendance] = await db.query(`
                SELECT status FROM attendance 
                WHERE student_id = ? AND school_id = ? AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE())
            `, [activeChild.id, schoolId]);

            const totalDays = attendance.length;
            const present = attendance.filter(a => a.status === 'present').length;
            const absent = attendance.filter(a => a.status === 'absent').length;
            const late = attendance.filter(a => a.status === 'late').length;
            attendanceStats = {
                totalDays,
                present,
                absent,
                late,
                percentage: totalDays > 0 ? Math.round(((present + late) / totalDays) * 100) : 0
            };

            const [hwRows] = await db.query(`
                SELECT h.id, h.title, h.due_date, s.subject_name, sh.status as submission_status
                FROM homeworks h
                JOIN subjects s ON h.subject_id = s.id
                LEFT JOIN homework_submissions sh ON sh.homework_id = h.id AND sh.student_id = ?
                WHERE h.class_id = ? AND h.status = 'active'
                ORDER BY h.due_date DESC LIMIT 5
            `, [activeChild.id, activeChild.class_id]);
            homeworks = hwRows;

            const [fees] = await db.query(`
                SELECT SUM(total_amount) as total, SUM(paid_amount) as paid 
                FROM student_fees 
                WHERE student_id = ?
            `, [activeChild.id]);
            const total = parseFloat(fees[0]?.total || 0);
            const paid = parseFloat(fees[0]?.paid || 0);
            feeSummary = {
                total,
                paid,
                pending: Math.max(0, total - paid)
            };

            const [noticeRows] = await db.query(`
                SELECT n.*, n.content AS message FROM notices n
                WHERE n.school_id = ? AND n.status = 'published'
                ORDER BY n.created_at DESC LIMIT 5
            `, [schoolId]);
            notices = noticeRows;
        };

        res.render('parent/dashboard', {
            title: 'Parent Dashboard',
            children,
            activeChild,
            attendanceStats,
            homeworks,
            feeSummary,
            notices,
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/dashboard'
        });
    } catch (err) {
        console.error('[Parent Controller getDashboard]', err);
        req.flash('error', 'Failed to load parent dashboard.');
        res.redirect('/login');
    };
};

exports.getAttendance = async (req, res) => {
    try {
        const parentEmail = req.user.email;
        const schoolId = req.user.school_id;
        const children = await getChildren(parentEmail, schoolId);
        const activeChild = getActiveChild(req, children);

        if (!activeChild) {
            req.flash('error', 'No linked child found');
            return res.redirect('/parent/dashboard');
        };

        const { month, year } = req.query;
        const currentDate = new Date();
        const selectedMonth = month ? parseInt(month) : currentDate.getMonth() + 1;
        const selectedYear = year ? parseInt(year) : currentDate.getFullYear();
        const [attendance] = await db.query(`
            SELECT date, status, DAY(date) as day
            FROM attendance 
            WHERE student_id = ? AND school_id = ? AND MONTH(date) = ? AND YEAR(date) = ?
            ORDER BY date ASC
        `, [activeChild.id, schoolId, selectedMonth, selectedYear]);

        const totalDays = attendance.length;
        const presentDays = attendance.filter(a => a.status === 'present').length;
        const absentDays = attendance.filter(a => a.status === 'absent').length;
        const lateDays = attendance.filter(a => a.status === 'late').length;
        const attendedDays = presentDays + lateDays;
        const [monthlySummary] = await db.query(`
            SELECT MONTH(date) as month, YEAR(date) as year, COUNT(*) as total,
                SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) as present
            FROM attendance 
            WHERE student_id = ? AND school_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY YEAR(date), MONTH(date)
            ORDER BY year DESC, month DESC
        `, [activeChild.id, schoolId]);

        const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const calendarDays = [];
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const dayAttendance = attendance.find(a => a.day === i);
            const dayDate = new Date(selectedYear, selectedMonth - 1, i);
            const isSunday = dayDate.getDay() === 0;
            
            calendarDays.push({
                day: i,
                date: dateStr,
                status: dayAttendance?.status || (isSunday ? 'holiday' : 'not_marked'),
                remark: '',
                isSunday
            });
        };

        res.render('parent/attendance', {
            title: 'Attendance History',
            children,
            activeChild,
            calendarDays,
            selectedMonth,
            selectedYear,
            stats: {
                totalDays,
                presentDays,
                absentDays,
                lateDays,
                halfDays: 0,
                percentage: totalDays > 0 ? Math.round((attendedDays / totalDays) * 100) : 0
            },
            monthlySummary,
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/attendance'
        });
    } catch (err) {
        console.error('[Parent Controller getAttendance]', err);
        req.flash('error', 'Failed to load attendance records');
        res.redirect('/parent/dashboard');
    };
};

exports.getFees = async (req, res) => {
    try {
        const parentEmail = req.user.email;
        const schoolId = req.user.school_id;
        const children = await getChildren(parentEmail, schoolId);
        const activeChild = getActiveChild(req, children);

        if (!activeChild) {
            req.flash('error', 'No linked child found');
            return res.redirect('/parent/dashboard');
        };

        const [fees] = await db.query(`
            SELECT id, fee_month AS fee_name, 'monthly' AS fee_type, total_amount AS amount, paid_amount, status, created_at
            FROM student_fees 
            WHERE student_id = ?
            ORDER BY fee_month DESC
        `, [activeChild.id]);

        const [payments] = await db.query(`
            SELECT fp.id, fp.amount, COALESCE(fp.payment_date, DATE(fp.paid_at), DATE(fp.created_at)) AS payment_date,
                   fp.payment_method, COALESCE(fp.receipt_no, fp.receipt_number) AS receipt_no,
                   GROUP_CONCAT(sf.fee_month SEPARATOR ', ') AS fee_name
            FROM fee_payments fp
            LEFT JOIN student_fees sf ON (fp.student_fee_id = sf.id OR sf.payment_id = fp.id)
            WHERE (sf.student_id = ? OR fp.student_id = ?) AND fp.status IN ('completed', 'paid')
            GROUP BY fp.id
            ORDER BY payment_date DESC
        `, [activeChild.id, activeChild.id]);

        let totalFees = 0;
        let totalPaid = 0;
        fees.forEach(f => {
            totalFees += parseFloat(f.amount || 0);
            totalPaid += parseFloat(f.paid_amount || 0);
        });

        res.render('parent/fees', {
            title: 'Fees Status',
            children,
            activeChild,
            fees,
            payments,
            summary: {
                totalFees,
                totalPaid,
                pendingAmount: Math.max(0, totalFees - totalPaid)
            },
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/fees'
        });
    } catch (err) {
        console.error('[Parent Controller getFees]', err);
        req.flash('error', 'Failed to load fee details');
        res.redirect('/parent/dashboard');
    };
};

exports.getHomework = async (req, res) => {
    try {
        const parentEmail = req.user.email;
        const schoolId = req.user.school_id;
        const children = await getChildren(parentEmail, schoolId);
        const activeChild = getActiveChild(req, children);

        if (!activeChild) {
            req.flash('error', 'No linked child found');
            return res.redirect('/parent/dashboard');
        };

        const { status } = req.query;
        let extraWhere = '';
        if (status === 'pending') {
            extraWhere = ' AND (sh.id IS NULL OR sh.status = "pending")';
        } else if (status === 'submitted') {
            extraWhere = ' AND sh.id IS NOT NULL AND sh.status != "pending"';
        };

        const [homeworks] = await db.query(`
            SELECT h.id, h.title, h.description, h.due_date, h.file_path AS homework_file, h.created_at,
                s.subject_name, s.code AS subject_code,
                CONCAT(tu.first_name, ' ', COALESCE(tu.last_name, '')) AS teacher_name,
                sh.id AS submission_id, sh.file_path AS submitted_file, sh.note AS student_note,
                sh.submitted_at, sh.status AS submission_status, sh.marks_obtained, sh.teacher_remark
            FROM homeworks h
            JOIN subjects s ON h.subject_id = s.id
            JOIN teachers t ON h.teacher_id = t.id
            JOIN users tu   ON t.user_id = tu.id
            LEFT JOIN homework_submissions sh ON sh.homework_id = h.id AND sh.student_id = ?
            WHERE h.class_id = ? AND h.status = 'active' ${extraWhere}
            ORDER BY h.due_date DESC, h.created_at DESC
        `, [activeChild.id, activeChild.class_id]);

        const today = new Date();
        today.setHours(0,0,0,0);
        const total = homeworks.length;
        const pending = homeworks.filter(h => (!h.submission_id || h.submission_status === 'pending') && new Date(h.due_date) >= today).length;
        const overdue = homeworks.filter(h => (!h.submission_id || h.submission_status === 'pending') && new Date(h.due_date) < today).length;
        const submitted = homeworks.filter(h => h.submission_id && h.submission_status !== 'pending').length;

        res.render('parent/homework', {
            title: 'Homework & Assignments',
            children,
            activeChild,
            homeworks,
            status: status || 'all',
            stats: { total, pending, overdue, submitted },
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/homework'
        });
    } catch (err) {
        console.error('[Parent Controller getHomework]', err);
        req.flash('error', 'Failed to load homework');
        res.redirect('/parent/dashboard');
    };
};

exports.getNotices = async (req, res) => {
    try {
        const parentEmail = req.user.email;
        const schoolId = req.user.school_id;
        const children = await getChildren(parentEmail, schoolId);
        const activeChild = getActiveChild(req, children);
        const [notices] = await db.query(`
            SELECT n.*, n.content AS message, CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as author_name
            FROM notices n
            LEFT JOIN users u ON n.created_by = u.id
            WHERE n.school_id = ? AND n.status = 'published'
            ORDER BY n.created_at DESC
        `, [schoolId]);

        res.render('parent/notices', {
            title: 'School Notices',
            children,
            activeChild,
            notices,
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/notices'
        });
    } catch (err) {
        console.error('[Parent Controller getNotices]', err);
        req.flash('error', 'Failed to load school notices');
        res.redirect('/parent/dashboard');
    };
};

exports.getTransport = async (req, res) => {
    try {
        const parentEmail = req.user.email;
        const schoolId = req.user.school_id;
        const children = await getChildren(parentEmail, schoolId);
        const activeChild = getActiveChild(req, children);
        if (!activeChild) {
            req.flash('error', 'No linked child found');
            return res.redirect('/parent/dashboard');
        };

        const transportProSql = `
            SELECT tt.id AS trip_id, tt.status AS trip_status, r.route_name AS routeName,
                u.first_name AS driver_first_name, u.last_name AS driver_last_name, u.phone AS driver_phone,
                v.vehicle_number AS vehicleNumber, v.model AS vehicleModel
            FROM students s
            JOIN student_transport_allocations sta ON sta.student_id = s.id AND sta.school_id = s.school_id AND sta.status = 'active'
            JOIN transport_trips tt ON tt.route_id = sta.route_id AND tt.school_id = sta.school_id AND tt.trip_date = CURDATE() AND tt.status = 'running'
            JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
            LEFT JOIN drivers d ON tt.driver_id = d.id AND d.school_id = tt.school_id
            LEFT JOIN users u ON d.user_id = u.id
            LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
            WHERE s.id = ? AND s.school_id = ?
            ORDER BY tt.id DESC
            LIMIT 1
        `;
        let [trips] = await db.query(transportProSql, [activeChild.id, schoolId]);

        if (!trips.length) {
            const legacySql = `
                SELECT dt.id AS trip_id, dt.status AS trip_status, r.route_name AS routeName,
                    u.first_name AS driver_first_name, u.last_name AS driver_last_name, u.phone AS driver_phone,
                    v.vehicle_number AS vehicleNumber, v.model AS vehicleModel
                FROM student_address_transport sat
                JOIN students s ON sat.student_id = s.id
                JOIN routes r ON sat.transport_route = r.route_name AND r.school_id = s.school_id
                JOIN driver_trips dt ON r.driver_id = dt.driver_id AND dt.trip_date = CURDATE() AND dt.status = 'in_progress'
                LEFT JOIN drivers d ON r.driver_id = d.id AND d.school_id = s.school_id
                LEFT JOIN users u ON d.user_id = u.id
                LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.is_active = 1
                LEFT JOIN vehicles v ON v.id = dva.vehicle_id AND v.school_id = s.school_id
                WHERE s.id = ? AND s.school_id = ? AND sat.transport_required = 1
                LIMIT 1
            `;
            [trips] = await db.query(legacySql, [activeChild.id, schoolId]);
        };

        const activeTrip = trips[0] || null;
        const transportInfo = await getStudentTransportViewModel(schoolId, activeChild.id);
        res.render('parent/transport', {
            title: 'Live Bus Tracking',
            children,
            activeChild,
            activeTrip,
            transportInfo,
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/transport'
        });
    } catch (err) {
        console.error('[Parent Controller getTransport]', err);
        req.flash('error', 'Failed to load transport tracking');
        res.redirect('/parent/dashboard');
    };
};

exports.getResults = async (req, res) => {
    try {
        const parentEmail = req.user.email;
        const schoolId = req.user.school_id;
        const children = await getChildren(parentEmail, schoolId);
        const activeChild = getActiveChild(req, children);

        if (!activeChild) {
            req.flash('error', 'No linked child found');
            return res.redirect('/parent/dashboard');
        };

        const { exam_id } = req.query;
        const [exams] = await db.query(
            `SELECT e.id, e.name, e.exam_type, e.term, e.max_marks, e.pass_marks,
                e.start_date, e.is_published
            FROM exams e
            WHERE e.class_id = ? AND e.is_published = 1
            ORDER BY e.start_date DESC`,
            [activeChild.class_id]
        );

        let selectedExam = null;
        let marks = [];
        let totalMarks = 0;
        let obtainedMarks = 0;
        let percentage = 0;
        let grade = '-';
        let resultStatus = 'N/A';
        let gradeInfo = null;

        const calculateGrade = (marksObtained, maxMarks) => {
            if (!marksObtained || !maxMarks || maxMarks === 0) return { grade: 'E', description: 'Fail', color: '#EF4444' };
            const pct = (parseFloat(marksObtained) / parseFloat(maxMarks)) * 100;
            if (pct >= 91) return { grade: 'A1', description: 'Outstanding', color: '#4F46E5' };
            if (pct >= 81) return { grade: 'A2', description: 'Excellent', color: '#6366F1' };
            if (pct >= 71) return { grade: 'B1', description: 'Very Good', color: '#10B981' };
            if (pct >= 61) return { grade: 'B2', description: 'Good', color: '#34D399' };
            if (pct >= 51) return { grade: 'C1', description: 'Above Average', color: '#F59E0B' };
            if (pct >= 41) return { grade: 'C2', description: 'Average', color: '#FBBF24' };
            if (pct >= 33) return { grade: 'D',  description: 'Pass', color: '#94A3B8' };
            return { grade: 'E', description: 'Fail', color: '#EF4444' };
        };

        if (exam_id) {
            const [[examRow]] = await db.query(
                'SELECT * FROM exams WHERE id = ? AND class_id = ? AND is_published = 1',
                [exam_id, activeChild.class_id]
            );

            if (examRow) {
                selectedExam = examRow;
                const [marksRows] = await db.query(
                    `SELECT m.*, e.name AS exam_name, e.max_marks AS exam_max_marks, e.pass_marks AS exam_pass_marks,
                        s.subject_name, s.code AS subject_code
                    FROM marks m
                    JOIN exams e ON m.exam_id = e.id
                    LEFT JOIN subjects s ON m.subject_id = s.id
                    WHERE m.student_id = ? AND m.exam_id = ?
                    ORDER BY s.subject_name`,
                    [activeChild.id, exam_id]
                );

                if (marksRows.length > 0) {
                    obtainedMarks = marksRows.reduce((sum, m) => sum + parseFloat(m.obtained_marks || 0), 0);
                    totalMarks = marksRows.length * parseFloat(examRow.max_marks || 100);
                    percentage = totalMarks > 0 ? ((obtainedMarks / totalMarks) * 100).toFixed(2) : 0;
                    gradeInfo = calculateGrade(obtainedMarks, totalMarks);
                    grade = gradeInfo.grade;
                    const hasFailed = marksRows.some(m => String(m.status).toLowerCase() === 'fail');
                    resultStatus = hasFailed ? 'Fail' : 'Pass';
                    marks = marksRows;
                };
            };
        } else if (exams.length > 0) {
            return res.redirect(`/parent/results?exam_id=${exams[0].id}`);
        };

        res.render('parent/results', {
            title: 'Child\'s Results',
            children,
            activeChild,
            exams,
            selectedExam,
            marks,
            totalMarks,
            obtainedMarks,
            percentage,
            grade,
            gradeInfo,
            resultStatus,
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/results'
        });
    } catch (err) {
        console.error('[Parent Controller getResults]', err);
        req.flash('error', 'Failed to load results');
        res.redirect('/parent/dashboard');
    };
};