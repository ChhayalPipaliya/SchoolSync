const db = require('../../config/database');
const { getStudentTransportViewModel } = require('../../utils/transportProViewModel');
const { getLinkedChildren } = require('../../services/parentStudentService');

async function getChildren(parentUserId, schoolId) {
    return getLinkedChildren({ parentUserId, schoolId });
}

function getActiveChild(req, children) {
    if (req.activeChild) return req.activeChild;
    if (!children || children.length === 0) return null;
    let selectedId = req.query.studentId || req.session.selectedStudentId;
    let active = children.find(c => c.id == selectedId) || children[0];
    req.session.selectedStudentId = active.id;
    return active;
}

exports.switchChild = async (req, res) => {
    const child = req.activeChild;
    if (!child) return res.status(404).json({ success: false, message: 'No linked child found.' });
    req.session.selectedStudentId = child.id;
    return res.json({ success: true, student_id: child.id });
};

exports.getProfile = async (req, res) => {
    const children = req.parentChildren || [];
    const activeChild = req.activeChild;
    if (!activeChild) return res.redirect('/parent/dashboard');
    return res.render('parent/profile', { title: 'Student Profile', children, activeChild, user: req.user, currentPath: '/parent/profile' });
};

exports.getTimetable = async (req, res) => {
    try {
        const children = req.parentChildren || [];
        const activeChild = req.activeChild;
        if (!activeChild?.class_id) return res.redirect('/parent/dashboard');
        const [periods] = await db.query('SELECT * FROM period_slots WHERE school_id = ? ORDER BY sort_order, period_number', [req.user.school_id]);
        const [entries] = await db.query(`SELECT tt.*, ps.label, ps.start_time, ps.end_time, ps.is_break,
            s.subject_name, u.first_name teacher_first_name, u.last_name teacher_last_name
            FROM timetables tt JOIN period_slots ps ON ps.id=tt.period_slot_id AND ps.school_id=tt.school_id
            LEFT JOIN subjects s ON s.id=tt.subject_id AND s.school_id=tt.school_id
            LEFT JOIN teachers t ON t.id=tt.teacher_id AND t.school_id=tt.school_id
            LEFT JOIN users u ON u.id=t.user_id AND u.school_id=tt.school_id
            WHERE tt.class_id=? AND tt.school_id=?`, [activeChild.class_id, req.user.school_id]);
        return res.render('parent/timetable', { title: 'Student Timetable', children, activeChild, periods, entries, user: req.user, currentPath: '/parent/timetable' });
    } catch (error) { return res.status(500).render('error', { error }); }
};

exports.getLibrary = async (req, res) => {
    const children = req.parentChildren || [];
    const activeChild = req.activeChild;
    if (!activeChild) return res.redirect('/parent/dashboard');
    const [issues] = await db.query(`SELECT li.id,li.issue_date,li.due_date,li.return_date,li.status,li.fine_amount,b.title,b.author
        FROM library_issues li JOIN library_books b ON b.id=li.book_id AND b.school_id=li.school_id
        JOIN students s ON s.user_id=li.user_id AND s.school_id=li.school_id
        WHERE s.id=? AND li.school_id=? ORDER BY li.issue_date DESC`, [activeChild.id, req.user.school_id]);
    return res.render('parent/library', { title: 'Library Records', children, activeChild, issues, user: req.user, currentPath: '/parent/library' });
};

exports.getCertificates = async (req, res) => {
    const children = req.parentChildren || [];
    const activeChild = req.activeChild;
    if (!activeChild) return res.redirect('/parent/dashboard');
    const [certificates] = await db.query('SELECT id, certificate_no, certificate_type, issue_date, status FROM issued_certificates WHERE school_id=? AND student_id=? ORDER BY issue_date DESC', [req.user.school_id, activeChild.id]);
    return res.render('parent/certificates', { title: 'Certificates', children, activeChild, certificates, user: req.user, currentPath: '/parent/certificates' });
};

exports.getLatestLocation = async (req, res) => {
    const activeChild = req.activeChild;
    if (!activeChild) return res.status(404).json({ success: false, message: 'No linked child found.' });
    const [rows] = await db.query(`SELECT ttl.trip_id,ttl.latitude,ttl.longitude,ttl.speed,ttl.heading,ttl.recorded_at
        FROM transport_trip_locations ttl JOIN transport_trip_students tts ON tts.trip_id=ttl.trip_id AND tts.school_id=ttl.school_id
        JOIN transport_trips tt ON tt.id=ttl.trip_id AND tt.school_id=ttl.school_id AND tt.status='running'
        WHERE tts.student_id=? AND ttl.school_id=? ORDER BY ttl.recorded_at DESC LIMIT 1`, [activeChild.id, req.user.school_id]);
    return res.json({ success: true, location: rows[0] || null });
};

exports.getReceipt = async (req, res) => {
    const activeChild = req.activeChild;
    const paymentId = Number.parseInt(req.params.paymentId, 10);
    const [[payment]] = await db.query(`SELECT fp.id,fp.amount,fp.payment_date,fp.payment_method,
        COALESCE(fp.receipt_no,fp.receipt_number) receipt_no
        FROM fee_payments fp
        WHERE fp.id=? AND fp.school_id=? AND (
            fp.student_id=?
            OR EXISTS (
                SELECT 1 FROM fee_payment_allocations fpa
                JOIN student_fees sf ON sf.id=fpa.student_fee_id AND sf.school_id=fpa.school_id
                WHERE fpa.payment_id=fp.id AND fpa.school_id=fp.school_id AND sf.student_id=?
            )
            OR EXISTS (
                SELECT 1 FROM student_fees legacy_sf
                WHERE legacy_sf.payment_id=fp.id AND legacy_sf.school_id=fp.school_id AND legacy_sf.student_id=?
            )
        ) LIMIT 1`, [paymentId, req.user.school_id, activeChild?.id || 0, activeChild?.id || 0, activeChild?.id || 0]);
    if (!payment) return res.status(404).json({ success: false, message: 'Receipt not found.' });
    return res.json({ success: true, receipt: payment });
};

exports.getDashboard = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const children = await getChildren(req.user.id, schoolId);
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
                JOIN subjects s ON h.subject_id = s.id AND s.school_id = h.school_id
                LEFT JOIN homework_submissions sh ON sh.homework_id = h.id AND sh.student_id = ?
                WHERE h.class_id = ? AND h.school_id = ? AND h.status = 'active'
                ORDER BY h.due_date DESC LIMIT 5
            `, [activeChild.id, activeChild.class_id, schoolId]);
            homeworks = hwRows;

            const [fees] = await db.query(`
                SELECT SUM(total_amount) as total, SUM(paid_amount) as paid 
                FROM student_fees 
                WHERE student_id = ? AND school_id = ?
            `, [activeChild.id, schoolId]);
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
        const schoolId = req.user.school_id;
        const children = await getChildren(req.user.id, schoolId);
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
        const schoolId = req.user.school_id;
        const children = await getChildren(req.user.id, schoolId);
        const activeChild = getActiveChild(req, children);

        if (!activeChild) {
            req.flash('error', 'No linked child found');
            return res.redirect('/parent/dashboard');
        };

        const [fees] = await db.query(`
            SELECT id, fee_month AS fee_name, 'monthly' AS fee_type, total_amount AS amount, paid_amount, status, created_at
            FROM student_fees 
            WHERE student_id = ? AND school_id = ?
            ORDER BY fee_month DESC
        `, [activeChild.id, schoolId]);

        const [payments] = await db.query(`
            SELECT fp.id, fp.amount, COALESCE(fp.payment_date, DATE(fp.paid_at), DATE(fp.created_at)) AS payment_date,
                fp.payment_method, COALESCE(fp.receipt_no, fp.receipt_number) AS receipt_no,
                COALESCE(
                    (SELECT GROUP_CONCAT(sf_alloc.fee_month SEPARATOR ', ')
                     FROM fee_payment_allocations fpa
                     JOIN student_fees sf_alloc ON sf_alloc.id=fpa.student_fee_id AND sf_alloc.school_id=fpa.school_id
                     WHERE fpa.payment_id=fp.id AND sf_alloc.student_id=?),
                    (SELECT GROUP_CONCAT(sf_legacy.fee_month SEPARATOR ', ')
                     FROM student_fees sf_legacy
                     WHERE sf_legacy.payment_id=fp.id AND sf_legacy.student_id=?)
                ) AS fee_name
            FROM fee_payments fp
            WHERE (fp.student_id = ?
                OR EXISTS (
                    SELECT 1 FROM fee_payment_allocations own_fpa
                    JOIN student_fees own_sf ON own_sf.id=own_fpa.student_fee_id AND own_sf.school_id=own_fpa.school_id
                    WHERE own_fpa.payment_id=fp.id AND own_sf.student_id=?
                )
                OR EXISTS (
                    SELECT 1 FROM student_fees own_legacy
                    WHERE own_legacy.payment_id=fp.id AND own_legacy.student_id=?
                ))
                AND fp.school_id = ?
                AND fp.status IN ('completed', 'paid')
            ORDER BY payment_date DESC
        `, [activeChild.id, activeChild.id, activeChild.id, activeChild.id, activeChild.id, schoolId]);

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
        const schoolId = req.user.school_id;
        const children = await getChildren(req.user.id, schoolId);
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
            JOIN subjects s ON h.subject_id = s.id AND s.school_id = h.school_id
            JOIN teachers t ON h.teacher_id = t.id AND t.school_id = h.school_id
            JOIN users tu ON t.user_id = tu.id AND tu.school_id = h.school_id
            LEFT JOIN homework_submissions sh ON sh.homework_id = h.id AND sh.student_id = ?
            WHERE h.class_id = ? AND h.school_id = ? AND h.status = 'active' ${extraWhere}
            ORDER BY h.due_date DESC, h.created_at DESC
        `, [activeChild.id, activeChild.class_id, schoolId]);

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
        const schoolId = req.user.school_id;
        const children = await getChildren(req.user.id, schoolId);
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
        const schoolId = req.user.school_id;
        const children = await getChildren(req.user.id, schoolId);
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
        const schoolId = req.user.school_id;
        const children = await getChildren(req.user.id, schoolId);
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
            WHERE e.class_id = ? AND e.school_id = ? AND e.is_published = 1
            ORDER BY e.start_date DESC`,
            [activeChild.class_id, schoolId]
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
                'SELECT * FROM exams WHERE id = ? AND class_id = ? AND school_id = ? AND is_published = 1',
                [exam_id, activeChild.class_id, schoolId]
            );

            if (examRow) {
                selectedExam = examRow;
                const [marksRows] = await db.query(
                    `SELECT m.*, e.name AS exam_name, e.max_marks AS exam_max_marks, e.pass_marks AS exam_pass_marks,
                        s.subject_name, s.code AS subject_code
                    FROM marks m
                    JOIN exams e ON m.exam_id = e.id AND e.school_id = m.school_id
                    LEFT JOIN subjects s ON m.subject_id = s.id AND s.school_id = m.school_id
                    WHERE m.student_id = ? AND m.exam_id = ? AND m.school_id = ?
                    ORDER BY s.subject_name`,
                    [activeChild.id, exam_id, schoolId]
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

exports._test = Object.freeze({ getActiveChild, getChildren });
