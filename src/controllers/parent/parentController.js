const db = require('../../config/database');
const PDFDocument = require('pdfkit');
const { getStudentTransportViewModel } = require('../../utils/transportProViewModel');
const { getLinkedChildren } = require('../../services/parentStudentService');
const timetableService = require('../../services/timetableService');
const { calculateStudentAttendanceStats } = require('../../services/attendanceEngineService');

const formatCurrency = (amount) => {
    return `₹${parseFloat(amount || 0).toFixed(2)}`;
};

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
    try {
        const children = req.parentChildren || [];
        const activeChild = req.activeChild;
        if (!activeChild) return res.redirect('/parent/dashboard');

        const [studentDetailsRows] = await db.query(
            `SELECT s.*, u.first_name as student_first_name, u.last_name as student_last_name, u.email as student_email, u.phone as student_phone, u.image as student_image,
                    c.class_name, c.section, c.medium, c.stream,
                    sf.father_name, sf.mother_name, sf.guardian_name, sf.father_phone, sf.mother_phone
             FROM students s
             JOIN users u ON s.user_id = u.id AND s.school_id = u.school_id
             LEFT JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
             LEFT JOIN student_family sf ON s.id = sf.student_id AND s.school_id = sf.school_id
             WHERE s.id = ? AND s.school_id = ?
             LIMIT 1`,
            [activeChild.id, req.user.school_id]
        );

        const studentProfile = studentDetailsRows[0] || activeChild;

        return res.render('parent/profile', {
            title: 'Student Profile',
            children,
            activeChild,
            studentProfile,
            user: req.user,
            currentPath: '/parent/profile'
        });
    } catch (err) {
        console.error('[Parent Controller getProfile Error]', err);
        return res.redirect('/parent/dashboard');
    }
};

exports.getTimetable = async (req, res) => {
    try {
        const children = req.parentChildren || [];
        const activeChild = req.activeChild;
        if (!activeChild?.class_id) return res.redirect('/parent/dashboard');
        const activeYear = await timetableService.getActiveAcademicYearForSchool(req.user.school_id);
        const resolvedAcademicYearId = activeYear?.id || null;

        const terms = await timetableService.getTermsForAcademicYear(req.user.school_id, resolvedAcademicYearId);
        const activeTerm = terms.find(t => t.status === 'active') || terms[0];
        const resolvedTermId = activeTerm?.id || null;

        const [periods] = await db.query(
            'SELECT * FROM period_slots WHERE school_id = ? AND academic_year_id = ? AND COALESCE(status, "active") = "active" ORDER BY sort_order, period_number',
            [req.user.school_id, resolvedAcademicYearId]
        );
        const { entries } = await timetableService.getParentChildTimetable(activeChild.id, req.user.school_id, resolvedAcademicYearId, resolvedTermId);

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

        if (entries.length > 0) {
            const [subs] = await db.query(
                `SELECT tsub.*, u_sub.first_name AS sub_first_name, u_sub.last_name AS sub_last_name
                FROM timetable_substitutions tsub
                JOIN teachers tchr_sub ON tchr_sub.id = tsub.substitute_teacher_id AND tchr_sub.school_id = tsub.school_id
                JOIN users u_sub ON u_sub.id = tchr_sub.user_id AND u_sub.school_id = tsub.school_id
                WHERE tsub.school_id = ? AND tsub.substitution_date IN (?)`,
                [req.user.school_id, Object.values(weekDates)]
            );
            const subMap = {};
            subs.forEach(s => {
                subMap[`${s.timetable_id}_${s.substitution_date}`] = s;
            });
            entries.forEach(row => {
                const dayDate = weekDates[row.day_of_week];
                const sub = subMap[`${row.id}_${dayDate}`];
                if (sub) {
                    row.teacher_first_name = sub.sub_first_name;
                    row.teacher_last_name = sub.sub_last_name;
                    row.is_substituted = true;
                }
            });
        }

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
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        const parentUserId = req.user?.id || req.session.user?.id;

        if (!schoolId || !parentUserId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { paymentId } = req.params;
        const parsedPaymentId = parseInt(paymentId, 10);
        if (!paymentId || isNaN(parsedPaymentId) || parsedPaymentId <= 0) {
            req.flash('error', 'Invalid receipt ID');
            return res.redirect('/parent/fees');
        };

        const children = await getChildren(parentUserId, schoolId);
        const childIds = children.map(c => c.id);
        if (!childIds.length) {
            req.flash('error', 'Receipt not found');
            return res.redirect('/parent/fees');
        };

        const [[payment]] = await db.query(
            `SELECT fp.*, 
                u.first_name AS first_name, u.last_name AS last_name, 
                sfam.father_name, sfam.mother_name, s.roll_no,
                c.class_name, c.section,
                sch.school_name, sch.school_address, sch.school_phone
            FROM fee_payments fp
            JOIN students s ON fp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN student_family sfam ON sfam.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            JOIN schools sch ON fp.school_id = sch.id
            WHERE fp.id = ? AND fp.school_id = ? AND fp.student_id IN (?)`,
            [parsedPaymentId, schoolId, childIds]
        );

        if (!payment) {
            req.flash('error', 'Receipt not found');
            return res.redirect('/parent/fees');
        };

        let [feeItems] = await db.query(
            `SELECT sf.*, fpa.amount AS receipt_amount,
                COALESCE(fs.fee_name, 'School Fee') AS fee_name, fs.frequency
            FROM fee_payment_allocations fpa
            JOIN student_fees sf ON sf.id = fpa.student_fee_id AND sf.school_id = fpa.school_id
            LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            WHERE fpa.payment_id = ? AND fpa.school_id = ?
            ORDER BY COALESCE(fs.fee_name, 'School Fee') ASC`,
            [parsedPaymentId, schoolId]
        );

        if (!feeItems.length) {
            [feeItems] = await db.query(
                `SELECT sf.*, sf.total_amount AS receipt_amount,
                    COALESCE(fs.fee_name, 'School Fee') AS fee_name, fs.frequency
                FROM student_fees sf
                LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
                WHERE sf.payment_id = ? AND sf.school_id = ?
                ORDER BY COALESCE(fs.fee_name, 'School Fee') ASC`,
                [parsedPaymentId, schoolId]
            );
        };

        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="receipt-${parsedPaymentId}-${Date.now()}.pdf"`);

        doc.pipe(res);
        doc.fontSize(22).font('Helvetica-Bold').text(payment.school_name, 50, 40);
        doc.fontSize(10).font('Helvetica').text(payment.school_address || '', 50, 70);
        if (payment.school_phone) {
            doc.text(`Phone: ${payment.school_phone}`, 50, 85);
        };
        doc.moveTo(50, 110).lineTo(550, 110).stroke();
        doc.fontSize(18).font('Helvetica-Bold').text('FEE RECEIPT', 50, 125);
        doc.fontSize(10).font('Helvetica')
            .text(`Receipt No: #${String(payment.id).padStart(6, '0')}`, 400, 125)
            .text(`Date: ${new Date(payment.created_at).toLocaleDateString('en-IN')}`, 400, 140);
        doc.fontSize(11).font('Helvetica-Bold').text('Student Details:', 50, 170);
        doc.fontSize(10).font('Helvetica')
            .text(`Name: ${payment.first_name} ${payment.last_name}`, 50, 190)
            .text(`Father: ${payment.father_name || 'N/A'}`, 50, 205)
            .text(`Class: ${payment.class_name || 'N/A'} ${payment.section ? `(${payment.section})` : ''}`, 50, 220)
            .text(`Roll No: ${payment.roll_no || 'N/A'}`, 300, 220);
        doc.moveTo(50, 250).lineTo(550, 250).stroke();
        doc.fontSize(11).font('Helvetica-Bold').text('Fee Details:', 50, 260);

        let y = 285;
        const colX = { item: 50, amount: 450 };
        doc.fontSize(10).font('Helvetica-Bold')
            .text('Fee Name', colX.item, y)
            .text('Amount', colX.amount, y);
        y += 20;

        let total = 0;
        doc.fontSize(10).font('Helvetica');

        for (const item of feeItems) {
            doc.text(item.fee_name, colX.item, y);
            doc.text(formatCurrency(item.receipt_amount), colX.amount, y);
            total += parseFloat(item.receipt_amount);
            y += 18;
        };

        y += 10;
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 15;

        doc.fontSize(11).font('Helvetica-Bold')
            .text('Total Amount:', 350, y)
            .text(formatCurrency(total), colX.amount, y);

        if (parseFloat(payment.discount) > 0) {
            y += 20;
            doc.fontSize(10).font('Helvetica')
                .text('Discount:', 350, y)
                .text(`-${formatCurrency(payment.discount)}`, colX.amount, y);
            y += 20;
            doc.fontSize(12).font('Helvetica-Bold')
                .text('Net Amount:', 350, y)
                .text(formatCurrency(total - parseFloat(payment.discount)), colX.amount, y);
        };

        y += 40;
        doc.fontSize(10).font('Helvetica')
            .text(`Payment Mode: ${payment.payment_method?.toUpperCase() || 'N/A'}`, 50, y)
            .text(`Received by: ${req.user?.first_name || req.session.user?.first_name || 'System'}`, 50, y + 15)
            .text(`Remarks: ${payment.remarks || 'N/A'}`, 50, y + 30);
        doc.fontSize(9).font('Helvetica')
            .text('This is a computer generated receipt and does not require signature.', 50, 750, { align: 'center' });
        doc.end();
    } catch (err) {
        console.error('[Parent Controller getReceipt Error]', err);
        req.flash('error', 'Failed to generate receipt');
        res.redirect('/parent/fees');
    };
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
        let todayScheduleList = [];
        let transportInfo = null;
        let academicPerf = null;
        let upcomingExams = [];

        if (activeChild) {
            const now = new Date();
            const startDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const attStats = await calculateStudentAttendanceStats(schoolId, activeChild.id, startDateStr, todayStr);

            attendanceStats = {
                totalDays: attStats.totalWorkingDays,
                present: attStats.presentDays,
                absent: attStats.absentDays,
                late: attStats.lateDays,
                halfDays: attStats.halfDays,
                leaveDays: attStats.leaveDays,
                percentage: attStats.percentage
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
                    AND (n.expiry_date IS NULL OR n.expiry_date >= CURDATE())
                ORDER BY n.created_at DESC LIMIT 5
            `, [schoolId]);
            notices = noticeRows;

            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const todayDayName = dayNames[now.getDay()];

            const [ttRows] = await db.query(
                `SELECT t.id as id, t.day_of_week, s.subject_name as subject, 
                    ps.start_time as startTime, ps.end_time as endTime, rm.room_name as room,
                    CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as teacher
                FROM timetables t
                JOIN period_slots ps ON t.period_slot_id = ps.id AND ps.school_id = t.school_id
                JOIN timetable_versions tv ON t.version_id = tv.id AND tv.school_id = t.school_id
                LEFT JOIN subjects s ON t.subject_id = s.id AND s.school_id = t.school_id
                LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
                LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
                LEFT JOIN rooms rm ON t.room_id = rm.id AND rm.school_id = t.school_id
                WHERE t.class_id = ? AND t.school_id = ? AND t.day_of_week = ? AND tv.status = 'published'
                ORDER BY ps.start_time ASC`,
                [activeChild.class_id, schoolId, todayDayName]
            ).catch((err) => {
                console.error('[Parent Controller Today Schedule Error]', err);
                return [[]];
            });
            todayScheduleList = ttRows;

            const [transportRows] = await db.query(`
                SELECT 
                    r.route_name, r.start_point, r.end_point,
                    v.vehicle_number,
                    CONCAT(du.first_name, ' ', COALESCE(du.last_name, '')) AS driver_name,
                    du.phone AS driver_phone,
                    tt.id AS active_trip_id,
                    tt.trip_type,
                    tt.start_at
                FROM student_transport_allocations sta
                JOIN routes r ON sta.route_id = r.id AND r.school_id = sta.school_id
                LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
                LEFT JOIN drivers d ON r.driver_id = d.id AND d.school_id = r.school_id
                LEFT JOIN users du ON d.user_id = du.id
                LEFT JOIN transport_trips tt ON tt.route_id = r.id AND tt.school_id = sta.school_id 
                    AND tt.trip_date = CURDATE() AND tt.status = 'running'
                WHERE sta.student_id = ? AND sta.school_id = ? AND sta.status = 'active'
                LIMIT 1
            `, [activeChild.id, schoolId]).catch(() => [[]]);
            transportInfo = transportRows[0] || null;

            const [perfRows] = await db.query(`
                SELECT s.subject_name,
                    ROUND(AVG((m.obtained_marks / COALESCE(e.max_marks, 100)) * 100), 1) as percentage
                FROM marks m
                JOIN exams e ON m.exam_id = e.id AND e.school_id = m.school_id
                JOIN subjects s ON m.subject_id = s.id AND s.school_id = m.school_id
                WHERE m.student_id = ? AND m.school_id = ? AND e.is_published = 1
                GROUP BY m.subject_id, s.subject_name
                ORDER BY percentage DESC
                LIMIT 5
            `, [activeChild.id, schoolId]).catch((err) => {
                console.error('[Parent Controller Academic Perf Error]', err);
                return [[]];
            });

            academicPerf = null;
            if (perfRows && perfRows.length > 0) {
                const colorList = ['#4f46e5', '#10b981', '#7c3aed', '#f59e0b', '#ec4899'];
                const subjects = perfRows.map((r, idx) => ({
                    subject: r.subject_name,
                    percentage: parseFloat(r.percentage || 0),
                    color: colorList[idx % colorList.length]
                }));
                const totalPct = subjects.reduce((sum, s) => sum + s.percentage, 0);
                const avgPct = Math.round((totalPct / subjects.length) * 10) / 10;
                let gradeName = 'D';
                if (avgPct >= 91) gradeName = 'A1';
                else if (avgPct >= 81) gradeName = 'A2';
                else if (avgPct >= 71) gradeName = 'B1';
                else if (avgPct >= 61) gradeName = 'B2';
                else if (avgPct >= 51) gradeName = 'C1';
                else if (avgPct >= 41) gradeName = 'C2';
                else if (avgPct >= 33) gradeName = 'D';
                else gradeName = 'E';

                academicPerf = {
                    overallGrade: `Grade ${gradeName} (${avgPct}%)`,
                    subjects
                };
            }

            const [examRows] = await db.query(`
                SELECT e.id, e.name AS exam_name, e.start_date AS exam_date,
                    s.subject_name
                FROM exams e
                LEFT JOIN subjects s ON e.subject_id = s.id AND s.school_id = e.school_id
                WHERE e.school_id = ? AND e.class_id = ? AND e.is_published = 1
                    AND e.start_date >= CURDATE()
                ORDER BY e.start_date ASC
                LIMIT 5
            `, [schoolId, activeChild.class_id]).catch((err) => {
                console.error('[Parent Controller Upcoming Exams Error]', err);
                return [[]];
            });
            upcomingExams = examRows;
        };

        res.render('parent/dashboard', {
            title: 'Parent Dashboard',
            children,
            activeChild,
            attendanceStats,
            homeworks,
            feeSummary,
            notices,
            todayScheduleList,
            transportInfo,
            academicPerf,
            upcomingExams,
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
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
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

        const startDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
        const lastDayOfMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const endDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

        const attStats = await calculateStudentAttendanceStats(schoolId, activeChild.id, startDateStr, endDateStr);

        const [approvedLeaves] = await db.query(`
            SELECT from_date, to_date
            FROM leaves
            WHERE user_id = (SELECT user_id FROM students WHERE id = ? LIMIT 1)
            AND school_id = ?
            AND status = 'approved'
            AND from_date <= LAST_DAY(?)
            AND to_date >= ?
        `, [activeChild.id, schoolId, startDateStr, startDateStr]);

        const leaveDaySet = new Set();
        for (const leave of approvedLeaves) {
            const start = new Date(`${String(leave.from_date).slice(0, 10)}T00:00:00`);
            const end = new Date(`${String(leave.to_date).slice(0, 10)}T00:00:00`);
            const cur = new Date(start);
            while (cur <= end) {
                leaveDaySet.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
                cur.setDate(cur.getDate() + 1);
            };
        };

        const daysInMonth = lastDayOfMonth;
        const calendarDays = [];
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const dayAttendance = attendance.find(a => a.day === i);
            const dayDate = new Date(selectedYear, selectedMonth - 1, i);
            const isSunday = dayDate.getDay() === 0;
            
            calendarDays.push({
                day: i,
                date: dateStr,
                status: dayAttendance?.status || (isSunday ? 'holiday' : (leaveDaySet.has(dateStr) ? 'leave' : 'not_marked')),
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
                totalDays: attStats.totalWorkingDays,
                presentDays: attStats.presentDays,
                absentDays: attStats.absentDays,
                lateDays: attStats.lateDays,
                halfDays: attStats.halfDays,
                leaveDays: attStats.leaveDays,
                pendingDays: attStats.pendingDays,
                percentage: attStats.percentage
            },
            monthlySummary: [],
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

        const [[schoolInfo]] = await db.query(
            'SELECT upi_qr_enabled, upi_qr_image, upi_id FROM schools WHERE id = ?',
            [schoolId]
        );
        const schoolUpiQr = (schoolInfo && schoolInfo.upi_qr_enabled && schoolInfo.upi_qr_image) ? {
            enabled: true,
            qr_image: schoolInfo.upi_qr_image,
            upi_id: schoolInfo.upi_id
        } : null;

        const [payments] = await db.query(`
            SELECT fp.id, fp.amount, fp.discount, fp.status, fp.transaction_id, fp.payment_reference,
                COALESCE(fp.payment_date, DATE(fp.paid_at), DATE(fp.created_at)) AS payment_date,
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
                AND fp.status IN ('completed', 'paid', 'pending_verification')
            ORDER BY payment_date DESC, fp.id DESC
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
            schoolUpiQr,
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
                AND (n.expiry_date IS NULL OR n.expiry_date >= CURDATE())
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
