const db = require('../../config/database');
const { getWorkingDaysInRange, calculateStudentAttendanceStats } = require('../../services/attendanceEngineService');

exports.admissionReport = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { year, class_id } = req.query;
        const targetYear = year || new Date().getFullYear();
        let sql = `
            SELECT MONTH(admission_date) as month, COUNT(*) as count, gender
            FROM students 
            WHERE school_id = ? AND YEAR(admission_date) = ? AND deleted_at IS NULL
        `;
        
        const params = [schoolId, targetYear];
        if (class_id) {
            sql += ' AND class_id = ?';
            params.push(class_id);
        };

        sql += ' GROUP BY MONTH(admission_date), gender ORDER BY month';
        const [data] = await db.query(sql, params);
        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);
        res.render('schoolAdmin/reports/admission', { title: 'Admission Report', data, classes, year: targetYear });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to generate report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.attendanceReport = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { class_id, section_id, month, year } = req.query;
        const targetMonth = Number(month) || new Date().getMonth() + 1;
        const targetYear = Number(year) || new Date().getFullYear();
        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);

        let sections = [];
        if (class_id) {
            const selectedClass = classes.find(c => c.id == class_id);
            if (selectedClass) {
                sections = classes.filter(c => c.class_name === selectedClass.class_name);
            };
        };

        let summary = [];
        let studentDetails = [];
        if (class_id) {
            const selectedClass = classes.find(c => c.id == class_id);
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

            let totalPresentAll = 0;
            let totalWorkingDaysAll = 0;

            for (const s of students) {
                const stats = await calculateStudentAttendanceStats(schoolId, s.id, startDateStr, endDateStr);
                totalPresentAll += stats.presentDays;
                totalWorkingDaysAll += stats.totalWorkingDays;

                studentDetails.push({
                    ...s,
                    total_days: stats.totalWorkingDays,
                    present_days: stats.presentDays,
                    absent_days: stats.absentDays,
                    late_days: stats.lateDays,
                    half_days: stats.halfDays,
                    leave_days: stats.leaveDays,
                    percentage: stats.percentage.toFixed(2)
                });
            }

            summary = [{
                total_students: students.length,
                total_present: totalPresentAll,
                total_records: totalWorkingDaysAll
            }];
        };

        res.render('schoolAdmin/reports/attendance', {
            title: 'Attendance Report',
            classes,
            sections,
            summary,
            studentDetails,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to generate report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.feeReport = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { month, year, class_id } = req.query;
        const targetMonth = parseInt(month, 10) || (new Date().getMonth() + 1);
        const targetYear = parseInt(year, 10) || new Date().getFullYear();
        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ? ORDER BY class_name ASC, section ASC', [schoolId]);

        let collectionSql = `
            SELECT 
                COALESCE(SUM(fp.amount), 0) AS total,
                COALESCE(SUM(fp.discount), 0) AS total_discount,
                COUNT(DISTINCT fp.id) AS total_transactions,
                COUNT(DISTINCT fp.student_id) AS total_students_paid
            FROM fee_payments fp 
            JOIN students s ON fp.student_id = s.id
            WHERE fp.school_id = ? 
                AND MONTH(COALESCE(fp.payment_date, fp.created_at)) = ? 
                AND YEAR(COALESCE(fp.payment_date, fp.created_at)) = ? 
                AND fp.status IN ('completed', 'paid')
                AND s.deleted_at IS NULL
        `;
        const collectionParams = [schoolId, targetMonth, targetYear];
        if (class_id) {
            collectionSql += ` AND s.class_id = ?`;
            collectionParams.push(class_id);
        };
        const [[collection]] = await db.query(collectionSql, collectionParams);

        let pendingSql = `
            SELECT 
                COALESCE(SUM(sf.total_amount - sf.paid_amount), 0) AS total,
                COUNT(DISTINCT sf.student_id) AS pending_students_count,
                COUNT(sf.id) AS pending_items_count
            FROM student_fees sf 
            JOIN students s ON sf.student_id = s.id
            WHERE sf.school_id = ? 
                AND sf.status IN ('pending', 'partial')
                AND s.deleted_at IS NULL
        `;
        const pendingParams = [schoolId];
        if (class_id) {
            pendingSql += ` AND s.class_id = ?`;
            pendingParams.push(class_id);
        };
        const [[pending]] = await db.query(pendingSql, pendingParams);

        let dailySql = `
            SELECT 
                DATE(COALESCE(fp.payment_date, fp.created_at)) AS date, 
                SUM(fp.amount) AS total,
                COUNT(fp.id) AS count
            FROM fee_payments fp 
            JOIN students s ON fp.student_id = s.id
            WHERE fp.school_id = ? 
                AND fp.status IN ('completed', 'paid') 
                AND MONTH(COALESCE(fp.payment_date, fp.created_at)) = ? 
                AND YEAR(COALESCE(fp.payment_date, fp.created_at)) = ?
                AND s.deleted_at IS NULL
        `;
        const dailyParams = [schoolId, targetMonth, targetYear];
        if (class_id) {
            dailySql += ` AND s.class_id = ?`;
            dailyParams.push(class_id);
        };
        dailySql += ` GROUP BY DATE(COALESCE(fp.payment_date, fp.created_at)) ORDER BY date ASC`;
        const [dailyBreakdown] = await db.query(dailySql, dailyParams);

        let methodSql = `
            SELECT 
                COALESCE(fp.payment_method, 'other') AS payment_method, 
                SUM(fp.amount) AS total, 
                COUNT(fp.id) AS count
            FROM fee_payments fp
            JOIN students s ON fp.student_id = s.id
            WHERE fp.school_id = ? 
                AND fp.status IN ('completed', 'paid')
                AND MONTH(COALESCE(fp.payment_date, fp.created_at)) = ? 
                AND YEAR(COALESCE(fp.payment_date, fp.created_at)) = ?
                AND s.deleted_at IS NULL
        `;
        const methodParams = [schoolId, targetMonth, targetYear];
        if (class_id) {
            methodSql += ` AND s.class_id = ?`;
            methodParams.push(class_id);
        };
        methodSql += ` GROUP BY COALESCE(fp.payment_method, 'other') ORDER BY total DESC`;
        const [methodBreakdown] = await db.query(methodSql, methodParams);

        let recentPaymentsSql = `
            SELECT 
                fp.*,
                u.first_name, u.last_name,
                s.admission_no, s.roll_no,
                c.class_name, c.section
            FROM fee_payments fp
            JOIN students s ON fp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE fp.school_id = ?
                AND fp.status IN ('completed', 'paid')
                AND MONTH(COALESCE(fp.payment_date, fp.created_at)) = ?
                AND YEAR(COALESCE(fp.payment_date, fp.created_at)) = ?
                AND s.deleted_at IS NULL
        `;
        const recentPaymentsParams = [schoolId, targetMonth, targetYear];
        if (class_id) {
            recentPaymentsSql += ` AND s.class_id = ?`;
            recentPaymentsParams.push(class_id);
        };
        recentPaymentsSql += ` ORDER BY COALESCE(fp.payment_date, fp.created_at) DESC, fp.id DESC LIMIT 100`;
        const [recentPayments] = await db.query(recentPaymentsSql, recentPaymentsParams);

        res.render('schoolAdmin/reports/fee', {
            title: 'Fee Collection Report',
            needsCharts: true,
            classes,
            class_id: class_id || '',
            collection,
            pending,
            dailyBreakdown,
            methodBreakdown,
            recentPayments,
            month: targetMonth,
            year: targetYear,
            user: req.user || req.session.user
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to generate report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.examReport = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { exam_id, class_id } = req.query;
        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ? ORDER BY class_name ASC', [schoolId]);

        let examSql = `
            SELECT e.*, c.class_name
            FROM exams e
            LEFT JOIN classes c ON e.class_id = c.id
            WHERE e.school_id = ?
        `;
        const examParams = [schoolId];
        if (class_id) {
            examSql += ` AND e.class_id = ?`;
            examParams.push(class_id);
        };
        const [exams] = await db.query(examSql, examParams);

        let results = [];
        if (exam_id) {
            [results] = await db.query(
                `SELECT u.first_name as first_name, u.last_name as last_name, s.roll_no as roll_number, c.class_name,
                    m.obtained_marks AS marks_obtained, m.grade, e.name as exam_name, e.max_marks
                FROM marks m
                JOIN students s ON m.student_id = s.id
                JOIN users u ON s.user_id = u.id
                JOIN exams e ON m.exam_id = e.id
                JOIN classes c ON s.class_id = c.id
                WHERE m.exam_id = ? AND m.school_id = ?
                ORDER BY m.obtained_marks DESC`,
                [exam_id, schoolId]
            );
        };

        res.render('schoolAdmin/reports/exam', {
            title: 'Exam Report',
            exams,
            classes,
            results,
            exam_id,
            class_id
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to generate report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.financeReport = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { month } = req.query;

        let incomeSql = `
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM fee_payments 
            WHERE school_id = ? AND status IN ('completed', 'paid')
        `;
        
        let expenseSql = `
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM salary_payments 
            WHERE school_id = ?
        `;
        const incomeParams = [schoolId];
        const expenseParams = [schoolId];

        if (month && month.trim()) {
            incomeSql += ` AND DATE_FORMAT(payment_date, '%Y-%m') = ?`;
            incomeParams.push(month.trim());
            expenseSql += ` AND DATE_FORMAT(payment_date, '%Y-%m') = ?`;
            expenseParams.push(month.trim());
        };

        const [[incomeRow]] = await db.query(incomeSql, incomeParams);
        const [[expenseRow]] = await db.query(expenseSql, expenseParams);
        const income = parseFloat(incomeRow.total);
        const expense = parseFloat(expenseRow.total);
        const netBalance = income - expense;

        let txSql = `
            ( 
                SELECT 
                    fp.payment_date,
                    'Fee' as type,
                    u.first_name AS first_name,
                    u.last_name AS last_name,
                    fp.amount
                FROM fee_payments fp
                JOIN students s ON fp.student_id = s.id
                JOIN users u ON s.user_id = u.id
                WHERE fp.school_id = ? AND fp.status IN ('completed', 'paid')
                ${month && month.trim() ? "AND DATE_FORMAT(fp.payment_date, '%Y-%m') = ?" : ""}
            )
            UNION ALL
            (
                SELECT 
                    sp.payment_date,
                    'Salary' as type,
                    u.first_name AS first_name,
                    u.last_name AS last_name,
                    sp.amount
                FROM salary_payments sp
                JOIN monthly_salaries ms ON sp.monthly_salary_id = ms.id
                JOIN users u ON ms.user_id = u.id
                WHERE sp.school_id = ?
                ${month && month.trim() ? "AND DATE_FORMAT(sp.payment_date, '%Y-%m') = ?" : ""}
            )
            ORDER BY payment_date DESC
            LIMIT 50
        `;
        
        const txParams = [];
        if (month && month.trim()) {
            txParams.push(schoolId, month.trim(), schoolId, month.trim());
        } else {
            txParams.push(schoolId, schoolId);
        };

        const [recentTransactions] = await db.query(txSql, txParams);
        res.render('schoolAdmin/reports/finance', {
            title: 'Financial Report',
            month: month || '',
            income,
            expense,
            netBalance,
            recentTransactions,
            user: req.user || req.session.user
        });
    } catch (err) {
        console.error('[financeReport Error]:', err);
        req.flash('error', 'Failed to generate financial report');
        res.redirect('/schooladmin/dashboard');
    };
};