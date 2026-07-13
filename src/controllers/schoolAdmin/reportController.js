const db = require('../../config/database');

exports.admissionReport = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
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
        const schoolId = req.session.user.school_id;
        const { class_id, section_id, month, year } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
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
            let summarySql = `
                SELECT 
                    COUNT(DISTINCT a.student_id) as total_students,
                    SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) as total_present,
                    COUNT(a.id) as total_records
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                WHERE s.school_id = ? AND MONTH(a.date) = ? AND YEAR(a.date) = ?
            `;
            const summaryParams = [schoolId, targetMonth, targetYear];

            if (section_id) {
                summarySql += ` AND s.class_id = ?`;
                summaryParams.push(section_id);
            } else if (selectedClass) {
                const classIds = sections.map(c => c.id);
                summarySql += ` AND s.class_id IN (?)`;
                summaryParams.push(classIds);
            } else {
                summarySql += ` AND s.class_id = ?`;
                summaryParams.push(class_id);
            };

            const [result] = await db.query(summarySql, summaryParams);
            summary = result;
            let detailsSql = `
                SELECT s.id, u.first_name as first_name, u.last_name as last_name, s.roll_no as roll_number,
                    COUNT(a.id) as total_days,
                    SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) as present_days,
                    SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_days
                FROM students s
                JOIN users u ON s.user_id = u.id
                LEFT JOIN attendance a ON s.id = a.student_id AND MONTH(a.date) = ? AND YEAR(a.date) = ?
                WHERE s.school_id = ? AND s.deleted_at IS NULL
            `;
            const detailsParams = [targetMonth, targetYear, schoolId];

            if (section_id) {
                detailsSql += ` AND s.class_id = ?`;
                detailsParams.push(section_id);
            } else if (selectedClass) {
                const classIds = sections.map(c => c.id);
                detailsSql += ` AND s.class_id IN (?)`;
                detailsParams.push(classIds);
            } else {
                detailsSql += ` AND s.class_id = ?`;
                detailsParams.push(class_id);
            };

            detailsSql += ` GROUP BY s.id ORDER BY s.roll_no ASC`;
            const [details] = await db.query(detailsSql, detailsParams);
            studentDetails = details.map(d => ({
                ...d,
                percentage: d.total_days > 0 ? ((d.present_days / d.total_days) * 100).toFixed(2) : '0.00'
            }));
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
        const schoolId = req.session.user.school_id;
        const { month, year, class_id } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();
        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ? ORDER BY class_name ASC', [schoolId]);

        let collectionSql = `
            SELECT COALESCE(SUM(fp.amount), 0) as total 
            FROM fee_payments fp 
            JOIN student_fees sf ON fp.student_fee_id = sf.id
            JOIN students s ON sf.student_id = s.id
            WHERE fp.school_id = ? AND MONTH(fp.created_at) = ? AND YEAR(fp.created_at) = ? AND fp.status = 'completed'
        `;
        const collectionParams = [schoolId, targetMonth, targetYear];
        if (class_id) {
            collectionSql += ` AND s.class_id = ?`;
            collectionParams.push(class_id);
        };
        const [[collection]] = await db.query(collectionSql, collectionParams);

        let pendingSql = `
            SELECT COALESCE(SUM(sf.total_amount - sf.paid_amount), 0) as total 
            FROM student_fees sf 
            JOIN students s ON sf.student_id = s.id
            WHERE sf.school_id = ? AND sf.status != 'paid'
        `;
        const pendingParams = [schoolId];
        if (class_id) {
            pendingSql += ` AND s.class_id = ?`;
            pendingParams.push(class_id);
        };
        const [[pending]] = await db.query(pendingSql, pendingParams);

        let dailySql = `
            SELECT DATE(fp.created_at) as date, SUM(fp.amount) as total 
            FROM fee_payments fp 
            JOIN student_fees sf ON fp.student_fee_id = sf.id
            JOIN students s ON sf.student_id = s.id
            WHERE fp.school_id = ? AND fp.status IN ('completed', 'paid') AND MONTH(fp.created_at) = ? AND YEAR(fp.created_at) = ?
        `;
        const dailyParams = [schoolId, targetMonth, targetYear];
        
        if (class_id) {
            dailySql += ` AND s.class_id = ?`;
            dailyParams.push(class_id);
        };
        dailySql += ` GROUP BY DATE(fp.created_at) ORDER BY date`;
        const [dailyBreakdown] = await db.query(dailySql, dailyParams);

        res.render('schoolAdmin/reports/fee', {
            title: 'Fee Report',
            classes,
            class_id: class_id || '',
            collection,
            pending,
            dailyBreakdown,
            month: targetMonth,
            year: targetYear
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to generate report');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.examReport = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
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
        const schoolId = req.session.user.school_id;
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
            user: req.session.user
        });
    } catch (err) {
        console.error('[financeReport Error]:', err);
        req.flash('error', 'Failed to generate financial report');
        res.redirect('/schooladmin/dashboard');
    };
};
