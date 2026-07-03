const db = require('../../config/database');

exports.myFees = async (req, res) => {
    try {
        const userId = req.session.user?.id;

        const [students] = await db.query(
            'SELECT id, admission_no FROM students WHERE user_id = ?',
            [userId]
        );

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        }

        const studentId = students[0].id;
        const [fees] = await db.query(`
            SELECT
                sf.id,
                sf.fee_month AS fee_name,
                'monthly' AS fee_type,
                sf.total_amount AS amount,
                sf.paid_amount,
                0 AS discount,
                0 AS fine,
                NULL AS fee_due_date,
                sf.status,
                sf.created_at
            FROM student_fees sf
            WHERE sf.student_id = ?
            ORDER BY sf.fee_month DESC
        `, [studentId]);

        const [payments] = await db.query(`
            SELECT
                fp.id,
                fp.amount,
                COALESCE(fp.payment_date, DATE(fp.paid_at), DATE(fp.created_at)) AS payment_date,
                fp.payment_method,
                COALESCE(fp.receipt_no, fp.receipt_number) AS receipt_no,
                GROUP_CONCAT(sf.fee_month SEPARATOR ', ') AS fee_name
            FROM fee_payments fp
            LEFT JOIN student_fees sf ON (fp.student_fee_id = sf.id OR sf.payment_id = fp.id)
            WHERE (sf.student_id = ? OR fp.student_id = ?)
              AND fp.status IN ('completed', 'paid')
            GROUP BY fp.id
            ORDER BY payment_date DESC
        `, [studentId, studentId]);

        let totalFees = 0;
        let totalPaid = 0;

        fees.forEach(f => {
            totalFees += parseFloat(f.amount     || 0);
            totalPaid += parseFloat(f.paid_amount || 0);
        });

        const pendingAmount = Math.max(0, totalFees - totalPaid);

        res.render('student/fees', {
            title: 'My Fees',
            fees,
            payments,
            receipts: [],
            summary: {
                totalFees,
                totalPaid,
                totalDiscount: 0,
                totalFine:     0,
                pendingAmount
            },
            user: req.session.user
        });

    } catch (error) {
        console.error('Fees Error:', error);
        req.flash('error', 'Failed to load fee details');
        res.redirect('/student/dashboard');
    }
};