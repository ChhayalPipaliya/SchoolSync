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
        };

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
                COALESCE(
                    (SELECT GROUP_CONCAT(sf_alloc.fee_month SEPARATOR ', ')
                     FROM fee_payment_allocations fpa
                     JOIN student_fees sf_alloc ON sf_alloc.id = fpa.student_fee_id AND sf_alloc.school_id = fpa.school_id
                     WHERE fpa.payment_id = fp.id AND sf_alloc.student_id = ?),
                    (SELECT GROUP_CONCAT(sf_legacy.fee_month SEPARATOR ', ')
                     FROM student_fees sf_legacy
                     WHERE sf_legacy.payment_id = fp.id AND sf_legacy.student_id = ?)
                ) AS fee_name
            FROM fee_payments fp
            WHERE (
                    fp.student_id = ?
                    OR EXISTS (
                        SELECT 1 FROM fee_payment_allocations own_fpa
                        JOIN student_fees own_sf ON own_sf.id = own_fpa.student_fee_id AND own_sf.school_id = own_fpa.school_id
                        WHERE own_fpa.payment_id = fp.id AND own_sf.student_id = ?
                    )
                    OR EXISTS (
                        SELECT 1 FROM student_fees own_legacy
                        WHERE own_legacy.payment_id = fp.id AND own_legacy.student_id = ?
                    )
                )
                AND fp.status IN ('completed', 'paid')
            ORDER BY payment_date DESC
        `, [studentId, studentId, studentId, studentId, studentId]);

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
    };
};
