const db = require('../../config/database');
const PDFDocument = require('pdfkit');

const formatCurrency = (amount) => {
    return `₹${parseFloat(amount || 0).toFixed(2)}`;
};

exports.myFees = async (req, res) => {
    try {
        const userId = req.user?.id || req.session.user?.id;
        const schoolId = req.user?.school_id || req.session.user?.school_id;

        const [students] = await db.query(
            'SELECT id, admission_no FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL',
            [userId, schoolId]
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

        const [students] = await db.query(
            'SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL',
            [userId, schoolId]
        );

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        };

        const studentId = students[0].id;
        const { paymentId } = req.params;

        const parsedPaymentId = parseInt(paymentId, 10);
        if (!paymentId || isNaN(parsedPaymentId) || parsedPaymentId <= 0) {
            req.flash('error', 'Invalid receipt ID');
            return res.redirect('/student/fees');
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
            WHERE fp.id = ? AND fp.student_id = ? AND fp.school_id = ?`,
            [parsedPaymentId, studentId, schoolId]
        );

        if (!payment) {
            req.flash('error', 'Receipt not found');
            return res.redirect('/student/fees');
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
    } catch (error) {
        console.error('[Student FeeController DownloadReceipt Error]:', error);
        req.flash('error', 'Failed to generate receipt');
        res.redirect('/student/fees');
    };
};
