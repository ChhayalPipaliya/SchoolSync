const db = require('../config/database');
const { generatePaySlipPdf } = require('../services/paySlipPdfService');

exports.myPayslips = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        const role = req.user?.role || 'teacher';

        const sql = `
            SELECT ms.*, ms.salary_month, ss.amount AS base_salary
            FROM monthly_salaries ms
            JOIN salary_structures ss ON ss.user_id = ms.user_id AND ss.school_id = ms.school_id
            WHERE ms.user_id = ? AND ms.school_id = ?
            ORDER BY ms.salary_month DESC
        `;
        const [payslips] = await db.query(sql, [userId, schoolId]);

        res.render(`${role}/payslips`, {
            title: 'My Payslips',
            payslips,
            user: req.user,
            currentPath: `/${role}/payslips`
        });
    } catch (err) {
        console.error('[PaySlip Controller myPayslips]', err);
        req.flash('error', 'Failed to load payslips.');
        res.redirect(`/${req.user?.role || 'teacher'}/dashboard`);
    };
};

exports.downloadMyPayslip = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        const { id } = req.params;

        const [[salary]] = await db.query(
            `SELECT ms.*, ms.salary_month,
                u.first_name, u.last_name, u.role, u.email, u.phone,
                ss.amount AS base_salary,
                sch.id AS school_id, sch.school_name, sch.school_address, sch.school_phone, 
                sch.school_email, sch.logo AS school_logo, sch.website AS school_website, sch.school_principal_name
            FROM monthly_salaries ms
            JOIN users u ON ms.user_id = u.id
            JOIN salary_structures ss ON ss.user_id = ms.user_id AND ss.school_id = ms.school_id
            JOIN schools sch ON ms.school_id = sch.id
            WHERE ms.id = ? AND ms.user_id = ? AND ms.school_id = ?`,
            [id, userId, schoolId]
        );

        if (!salary) {
            return res.status(404).render('errors/404', { title: 'Not Found', message: 'Payslip not found' });
        };

        const [payments] = await db.query(
            `SELECT amount, payment_date, payment_method, receipt_no
            FROM salary_payments
            WHERE monthly_salary_id = ? AND school_id = ?
            ORDER BY payment_date ASC`,
            [id, schoolId]
        );

        const safeName = `${salary.first_name || ''}-${salary.last_name || ''}`.replace(/\s+/g, '-');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="payslip-${safeName}-${salary.salary_month}.pdf"`);

        const doc = generatePaySlipPdf({ salary, payments });
        doc.pipe(res);
    } catch (err) {
        console.error('[PaySlip Controller downloadMyPayslip]', err);
        if (!res.headersSent) {
            return res.status(500).render('errors/500', { title: 'Download Error', message: 'Failed to generate pay slip' });
        };
    };
};