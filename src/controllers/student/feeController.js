const db = require('../../config/database');
const PDFDocument = require('pdfkit');

const formatCurrency = (amount) => {
    return `₹${parseFloat(amount || 0).toFixed(2)}`;
};

exports.myFees = async (req, res) => {
    try {
        const userId = req.user?.id || req.session.user?.id;
        const schoolId = req.user?.school_id || req.session.user?.school_id;

        const [students] = await db.query(`
            SELECT s.id, s.admission_no, s.roll_no, s.class_id, c.class_name, c.section
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.user_id = ? AND s.school_id = ? AND s.deleted_at IS NULL
        `, [userId, schoolId]);

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        };

        const student = students[0];
        const studentId = student.id;

        const [[feeStructure]] = await db.query(`
            SELECT fs.amount, fs.fee_name, fs.academic_year
            FROM fee_structures fs
            WHERE fs.class_id = ? AND fs.school_id = ?
            ORDER BY fs.id DESC LIMIT 1
        `, [student.class_id, schoolId]);
        const classAnnualFee = feeStructure ? parseFloat(feeStructure.amount || 0) : 0;

        const [fees] = await db.query(`
            SELECT
                sf.id,
                COALESCE(fs.fee_name, 'Annual Tuition Fee') AS fee_name,
                'annual' AS fee_type,
                sf.academic_year,
                sf.due_date,
                sf.total_amount AS amount,
                sf.paid_amount,
                0 AS discount,
                0 AS fine,
                sf.due_date AS fee_due_date,
                sf.status,
                sf.created_at
            FROM student_fees sf
            LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            WHERE sf.student_id = ?
            ORDER BY sf.created_at DESC
        `, [studentId]);

        const [payments] = await db.query(`
            SELECT
                fp.id,
                fp.amount,
                fp.discount,
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

        if (totalFees === 0 && classAnnualFee > 0) {
            totalFees = classAnnualFee;
        };

        const pendingAmount = Math.max(0, totalFees - totalPaid);

        res.render('student/fees', {
            title: 'My Fees',
            student,
            fees,
            pendingFees: fees,
            payments,
            receipts: [],
            totalFees,
            totalPaid,
            totalPending: pendingAmount,
            classAnnualFee,
            feeStructure: feeStructure || null,
            summary: {
                totalFees,
                totalPaid,
                totalDiscount: 0,
                totalFine:     0,
                pendingAmount,
                classAnnualFee
            },
            user: req.user || req.session.user
        });

    } catch (error) {
        console.error('Fees Error:', error);
        req.flash('error', 'Failed to load fee details');
        res.redirect('/student/dashboard');
    };
};

exports.downloadReceipt = async (req, res) => {
    try {
        const userId = req.user?.id || req.session.user?.id;
        const schoolId = req.user?.school_id || req.session.user?.school_id;

        if (!schoolId || !userId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { paymentId } = req.params;
        const { getReceiptData, generateReceiptPdf } = require('../../services/feeReceiptService');
        const receiptData = await getReceiptData({
            paymentId,
            schoolId,
            userId,
            role: 'student'
        });

        const doc = await generateReceiptPdf(receiptData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Fee-Receipt-${receiptData.payment.receiptNumber}.pdf"`);

        doc.pipe(res);
    } catch (error) {
        console.error('[Student FeeController DownloadReceipt Error]:', error);
        req.flash('error', error.message || 'Failed to generate receipt');
        res.redirect('/student/fees');
    };
};
